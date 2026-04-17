from django.shortcuts import render, HttpResponse
import os
import json
import hashlib
import numpy as np
from sklearn.cluster import OPTICS
try:
    import hdbscan
except ImportError:
    hdbscan = None
from .cluster_labeling import (
    build_cluster_summaries,
    label_clusters_with_llm,
)
from django.http import JsonResponse, FileResponse
from django.conf import settings
from django.views.decorators.http import require_GET
from django.views.decorators.csrf import csrf_exempt
from django.core.cache import cache
from .dataReduction import (
    umap_reduction,
    build_weights_from_ranked_list,
    build_weights_from_sets,
    build_weights_from_scored_genes,
    annotate_ranked_gene_sets,
    calculate_pvals,
    join_gene_list,
    order_genes_by_reference,
    run_fishers_test,
    filter_gene_sets_by_significance,
    calculate_distance_matrix,
    parse_scored_genes_raw,
    run_gseapy,
)
from .gene_set_utils import get_selected_gene_sets_with_relevant_members
from django.shortcuts import render

# Create views here.
# When someone goes to the website root (/), it shows the homepage (base.html).
def home(request):
    return render(request, 'base.html')


def build_thresholded_display_meta(signif_gene_sets):
    meta = {}
    for set_name, (gene_string, _, _) in signif_gene_sets.items():
        meta[set_name] = {
            "fullMolecules": gene_string,
            "displayMolecules": gene_string,
            "leadingEdgeMolecules": "",
            "direction": "neutral",
            "displayMode": "thresholded",
        }
    return meta


def build_ranked_display_meta(filtered, signif_gene_sets):
    meta = {}
    for geneset in filtered:
        set_name = geneset.get("gene_set_name")
        if set_name not in signif_gene_sets:
            continue

        full_molecules = signif_gene_sets[set_name][0]
        display_molecules = join_gene_list(
            geneset.get("ordered_matched_genes") or geneset.get("matched_genes") or []
        )
        meta[set_name] = {
            "fullMolecules": full_molecules,
            "displayMolecules": display_molecules or full_molecules,
            "leadingEdgeMolecules": "",
            "direction": geneset.get("display_direction", "neutral"),
            "displayMode": "ranked",
        }
    return meta


def build_scored_display_meta(filtered, signif_gene_sets, scored_genes, tail_mode):
    scored_gene_order = [row["gene"] for row in scored_genes]
    meta = {}

    for geneset in filtered:
        set_name = geneset.get("gene_set_name")
        if set_name not in signif_gene_sets:
            continue

        full_molecules = signif_gene_sets[set_name][0]
        full_gene_list = geneset.get("matched_genes") or []
        es_val = float(geneset.get("gsea_es", 0.0) or 0.0)

        if tail_mode == "positive":
            direction = "positive"
        elif tail_mode == "negative":
            direction = "negative"
        elif es_val < 0:
            direction = "negative"
        elif es_val > 0:
            direction = "positive"
        else:
            direction = "neutral"

        reverse = direction == "negative"
        leading_edge = geneset.get("leading_edge_genes") or []
        ordered_leading_edge = order_genes_by_reference(leading_edge, scored_gene_order, reverse=reverse)

        if ordered_leading_edge:
            display_genes = ordered_leading_edge
        else:
            display_genes = order_genes_by_reference(full_gene_list, scored_gene_order, reverse=reverse)

        meta[set_name] = {
            "fullMolecules": full_molecules,
            "displayMolecules": join_gene_list(display_genes) or full_molecules,
            "leadingEdgeMolecules": join_gene_list(ordered_leading_edge),
            "direction": direction,
            "displayMode": "scored",
        }

    return meta


def attach_display_meta(graph_data, display_meta):
    for point in graph_data:
        set_name = point.get("setName")
        meta = display_meta.get(set_name, {})
        full_molecules = meta.get("fullMolecules", point.get("molecules", ""))
        point["molecules"] = full_molecules
        point["fullMolecules"] = full_molecules
        point["displayMolecules"] = meta.get("displayMolecules", full_molecules)
        point["direction"] = meta.get("direction", "neutral")
        point["displayMode"] = meta.get("displayMode", "thresholded")
        point["leadingEdgeMolecules"] = meta.get("leadingEdgeMolecules", "")

def add_clusters_on_embedding(
    points,
    cluster_algorithm="hdbscan",
    min_cluster_size=5,
    min_samples=None,
    xi=0.05,
):
    """
    points: list[dict], each dict contains "X", "Y"
    Adds: point["clusterID"] = int label (noise = -1)
    """

    if not points or len(points) < 4:
        for p in points:
            p["clusterID"] = -1
        return points

    X = np.array([[float(p["X"]), float(p["Y"])] for p in points], dtype=float)
    algo = (cluster_algorithm or "hdbscan").lower()

    if algo == "hdbscan":
        if hdbscan is None:
            raise RuntimeError("hdbscan is not installed on the server. Please add it to requirements and install.")

        clusterer = hdbscan.HDBSCAN(
            min_cluster_size=int(min_cluster_size),
            min_samples=(int(min_samples) if min_samples is not None else None),
            metric="euclidean"
        )

    elif algo == "optics":
        optics_min_samples = int(min_samples) if min_samples is not None else 5
        optics_min_cluster_size = (
            int(min_cluster_size) if min_cluster_size is not None else None
        )

        clusterer = OPTICS(
            min_samples=optics_min_samples,
            min_cluster_size=optics_min_cluster_size,
            xi=float(xi),
            cluster_method="xi",
            metric="euclidean"
        )

    else:
        raise ValueError(f"Unsupported cluster algorithm: {cluster_algorithm}")

    labels = clusterer.fit_predict(X)

    for i, lbl in enumerate(labels):
        points[i]["clusterID"] = int(lbl)

    return points

@csrf_exempt
def cluster_only_view(request):
    if request.method != "POST":
        return JsonResponse({"error": "Only POST allowed"}, status=405)

    try:
        payload = json.loads(request.body or "{}")

        points = payload.get("points")
        if points is None:
            return JsonResponse({"error": "Missing points"}, status=400)

        # Accept dict-of-arrays (localStorage.data) or list[dict]
        if isinstance(points, dict):
            xs = points.get("X", [])
            ys = points.get("Y", [])
            n = min(len(xs), len(ys))
            keys = list(points.keys())

            normalized = []
            for i in range(n):
                p = {}
                for k in keys:
                    arr = points.get(k, [])
                    p[k] = arr[i] if i < len(arr) else None
                normalized.append(p)
            points = normalized

        cluster_algorithm = (payload.get("cluster_algorithm") or "hdbscan").lower()

        min_cluster_size_raw = payload.get("min_cluster_size", 5)
        min_cluster_size = (
            int(min_cluster_size_raw)
            if (min_cluster_size_raw not in [None, "", "null"])
            else None
        )

        min_samples_raw = payload.get("min_samples", None)
        min_samples = (
            int(min_samples_raw)
            if (min_samples_raw not in [None, "", "null"])
            else None
        )

        xi_raw = payload.get("xi", 0.05)
        xi = float(xi_raw) if xi_raw not in [None, "", "null"] else 0.05

        points = add_clusters_on_embedding(
            points,
            cluster_algorithm=cluster_algorithm,
            min_cluster_size=min_cluster_size,
            min_samples=min_samples,
            xi=xi,
        )

        summaries = build_cluster_summaries(points)
        name_by_id = label_clusters_with_llm(summaries, cache_obj=cache)

        cluster_ids = []
        cluster_labels = []
        for p in points:
            try:
                cid = int(p.get("clusterID", -1))
            except Exception:
                cid = -1
            cluster_ids.append(cid)
            cluster_labels.append("" if cid == -1 else name_by_id.get(cid, "Unknown pathway"))

        return JsonResponse({
            "cluster_ids": cluster_ids,
            "cluster_labels": cluster_labels,
        })

    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)

@csrf_exempt
def gene_input_view(request):
    if request.method == 'POST':
        try:
            # Parse JSON body
            data = json.loads(request.body)

            cache_timeout = 1000

            # Get gene inputs
            sig_input = data.get('significant_genes', '')
            insig_input = data.get('insignificant_genes', '')
            selected_gene_sets = data.get("selected_genes_sets")
            min_members = int(data.get("minMembers", 5))
            p_thr = (data.get("p_thr"))
            fdr_thr = (data.get("fdr_thr"))
            species = data.get("species", "human")
            custom_data = data.get("custom_data")   # Fetch custom data if user provides it
            settings = data.get("settings")

            cache_key_data = {
                "sig_genes": sig_input,
                "insig_genes": insig_input,
                "sel_gene_sets": selected_gene_sets,
                "min_members": min_members,
                "species": species,
                "custom_data": custom_data,
            }
            serialized_data = json.dumps(cache_key_data, separators=(",", ":"))
            key_hash = hashlib.md5(serialized_data.encode('utf-8')).hexdigest()

            analysis_cache_key = f"analysis:thresholded:{key_hash}"
            sig_genes_cache_key = f"inputs:thresholded:{key_hash}:sig_genes"
            insig_genes_cache_key = f"inputs:thresholded:{key_hash}:insig_genes"
            filtered_cache_key = f"filtered:thresholded:{key_hash}"

            gene_sets_with_p = cache.get(analysis_cache_key)
            sig_genes = []
            insig_genes = []
            filtered = []

            if gene_sets_with_p is None:
                # Split inputs into cleaned gene lists
                sig_genes = [gene.strip() for gene in sig_input.replace(',', '\n').splitlines() if gene.strip()]
                insig_genes = [gene.strip() for gene in insig_input.replace(',', '\n').splitlines() if gene.strip()]

                # Load gene set data
                species = species.lower()
                if species == "custom":
                    if not custom_data:
                        return JsonResponse({"error": "Missing custom_data for custom species"}, status=400)
                    gene_sets_data = custom_data
                else:
                    file_map = {
                        "human": "msigdb.v2025.1.Hs.json",
                        "mouse": "msigdb.v2025.1.Mm.json"
                    }
                    filename = file_map.get(species)
                    if not filename:
                        return JsonResponse({"error": "Invalid species"}, status=400)

                    file_path = os.path.join(os.path.dirname(__file__), 'static', 'resources', filename)
                    with open(file_path, 'r') as f:
                        gene_sets_data = json.load(f)

                genes = sig_genes + insig_genes

                print("collecting selected genes w revelnt members")

                # Filter selected gene sets
                filtered = get_selected_gene_sets_with_relevant_members(
                    gene_list=genes,
                    min_members_threshold=min_members,
                    selected_gene_sets=selected_gene_sets,
                    gene_sets_data=gene_sets_data,
                )

                # If there is no matching gene set after filtering, return error
                if not filtered:
                    return JsonResponse({"error": "No gene sets matched after filtering. Please select other categories or adjust your input."}, status=400)

                # Run Fisher's test analysis
                print("running fishers test")
                gene_sets_with_p = run_fishers_test(filtered, sig_genes, insig_genes)
                print("fisher test done")
                cache.set(analysis_cache_key, gene_sets_with_p, timeout=cache_timeout - 50)
                cache.set(sig_genes_cache_key, sig_genes, timeout=cache_timeout)
                cache.set(insig_genes_cache_key, insig_genes, timeout=cache_timeout)
                cache.set(filtered_cache_key, filtered, timeout=cache_timeout)
            else:
                sig_genes = cache.get(sig_genes_cache_key) or []
                insig_genes = cache.get(insig_genes_cache_key) or []
                filtered = cache.get(filtered_cache_key) or []

            # Convert thresholds to float if provided
            thr_key = ""
            if p_thr not in [None, ""]:
                p_thr = float(p_thr)
                fdr_thr = None
                thr_key = f"p-thresholded-{p_thr}"
            elif fdr_thr not in [None, ""]:
                fdr_thr = float(fdr_thr)
                p_thr = None
                thr_key = f"fdr-thresholded-{fdr_thr}"

            print("thr_key = " + thr_key)

            threshold_cache_key = f"threshold:thresholded:{key_hash}:{thr_key}"
            fisher_result_filtered = cache.get(threshold_cache_key)
            if fisher_result_filtered is None:
                print("filtering gene sets")
                fisher_result_filtered = filter_gene_sets_by_significance(gene_sets_with_p, p_thr, fdr_thr)
                print("filtering gene sets done")
                cache.set(threshold_cache_key, fisher_result_filtered, timeout=cache_timeout)

            if fisher_result_filtered is None:
                return JsonResponse({
                    "error": "No gene sets passed the selected threshold. Please choose another collection or increase the p-value/FDR threshold."
                }, status=400)
            
            signif_gene_sets, pvl, fdr = fisher_result_filtered

            try:
                if len(signif_gene_sets) < 4: # if we have less than 4 points
                    # Raise ValueError because umap, tsne can't work with fewer than 3-4 points
                    raise ValueError(
                        "Not enough gene sets passed the threshold to render a graph. Please increase your FDR or p-value.")

            except ValueError as e:
                return JsonResponse({'error': str(e)}, status=400)

            # Run Ump
            distance_type = (data.get('distance_type') or 'jaccard_weighted').lower()
            print("building weights")
            user_weights = build_weights_from_sets(sig_genes, insig_genes) if sig_genes else None
            print("building weights done")

            dist_key = f"distance:thresholded:{key_hash}:{thr_key}:{distance_type}:rescaled"
            distance_matrix = cache.get(dist_key)
            expected_n = len(signif_gene_sets)

            if distance_matrix is not None:
                try:
                    if distance_matrix.shape[0] != expected_n:
                        distance_matrix = None
                except Exception:
                    distance_matrix = None

            if distance_matrix is None:
                print("generating distance matrix")
                distance_matrix = calculate_distance_matrix(signif_gene_sets, distance_type, user_weights)
                print("distance matrix generated")
                cache.set(dist_key, distance_matrix, timeout=cache_timeout)

            print("running umap")
            mapped_result, _ = umap_reduction(signif_gene_sets, settings, user_weights, distance_type, distance_matrix)
            print("completed umap")

            # Return result as JSON
            data = json.loads(mapped_result)  # or skip if already a Python object
            attach_display_meta(data, build_thresholded_display_meta(signif_gene_sets))

            # Only run HDBSCAN + LLM if cluster-mode is ON
            cluster_on = False
            if isinstance(settings, dict):
                cluster_on = bool(settings.get("cluster-mode", False))

            if cluster_on:
                cluster_algorithm = (settings.get("cluster-algorithm") or "hdbscan").lower()

                if cluster_algorithm == "hdbscan":
                    min_cluster_size_raw = settings.get("hdbscan-min-cluster-size", 5)
                    min_samples_raw = settings.get("hdbscan-min-samples", None)
                    xi = 0.05
                elif cluster_algorithm == "optics":
                    min_cluster_size_raw = settings.get("optics-min-cluster-size", None)
                    min_samples_raw = settings.get("optics-min-samples", 5)
                    xi = float(settings.get("optics-xi", 0.05))
                else:
                    return JsonResponse({"error": f"Unsupported cluster algorithm: {cluster_algorithm}"}, status=400)

                min_cluster_size = (
                    int(min_cluster_size_raw)
                    if (min_cluster_size_raw not in [None, "", "null"])
                    else None
                )
                min_samples = (
                    int(min_samples_raw)
                    if (min_samples_raw not in [None, "", "null"])
                    else None
                )

                data = add_clusters_on_embedding(
                    data,
                    cluster_algorithm=cluster_algorithm,
                    min_cluster_size=min_cluster_size,
                    min_samples=min_samples,
                    xi=xi,
                )

                summaries = build_cluster_summaries(data)
                name_by_id = label_clusters_with_llm(summaries, cache_obj=cache)

                for p in data:
                    try:
                        cid = int(p.get("clusterID", -1))
                    except Exception:
                        cid = -1
                    p["clusterLabel"] = "" if cid == -1 else name_by_id.get(cid, "Unknown pathway")
            else:
                for p in data:
                    p["clusterID"] = -1
                    p["clusterLabel"] = ""

            #DEBUG2
            if len(data) > 0:
                print("DEBUG sample points after attach:")
                for i in range(min(3, len(data))):
                    print("  ", i, "cid=", data[i].get("clusterID"), "label=", data[i].get("clusterLabel"))

            print("grphing")
            return JsonResponse({
                "umap": data,
                "p_value": pvl,
                "fdr_value": fdr
            })

        except Exception as e:
            return JsonResponse({'error': str(e)}, status=400)

    # Method not allowed
    return JsonResponse({'error': 'Method not allowed'}, status=405)


@csrf_exempt
def gene_input_view2(request):
    if request.method == 'POST':
        try:
            # Parse JSON body
            data = json.loads(request.body)

            print("Clled")
            cache_timeout = 1000

            # Get gene inputs
            genes_input = data.get('ranked_genes', '')
            selected_gene_sets = data.get("selected_genes_sets", [])
            min_members = int(data.get("minMembers", 5))
            p_thr = (data.get("p_thr"))
            fdr_thr = (data.get("fdr_thr"))
            species = data.get("species", "human")
            custom_data = data.get("custom_data")  # Fetch custom data if user provides it
            settings = data.get("settings")
            tail_mode = (data.get("tail_mode") or "positive").lower()

            if tail_mode not in {"positive", "negative", "both"}:
                return JsonResponse({"error": f"Invalid tail_mode: {tail_mode}"}, status=400)

            cache_key_data = {
                "ranked_genes": genes_input,
                "sel_gene_sets": selected_gene_sets,
                "min_members": min_members,
                "species": species,
                "custom_data": custom_data,
                "tail_mode": tail_mode,
            }
            serialized_data = json.dumps(cache_key_data, separators=(",", ":"))
            key_hash = hashlib.md5(serialized_data.encode('utf-8')).hexdigest()

            analysis_cache_key = f"analysis:ranked:{key_hash}"
            ranked_genes_cache_key = f"inputs:ranked:{key_hash}:ranked_genes"
            filtered_cache_key = f"filtered:ranked:{key_hash}"

            gene_sets_with_p = cache.get(analysis_cache_key)
            ranked_genes = []
            filtered = []

            if gene_sets_with_p is None:
                # Split inputs into cleaned gene lists
                ranked_genes = [gene.strip() for gene in genes_input.replace(',', '\n').splitlines() if gene.strip()]

                # Load gene set data
                species = species.lower()
                if species == "custom":
                    if not custom_data:
                        return JsonResponse({"error": "Missing custom_data for custom species"}, status=400)
                    gene_sets_data = custom_data
                else:
                    file_map = {
                        "human": "msigdb.v2025.1.Hs.json",
                        "mouse": "msigdb.v2025.1.Mm.json"
                    }
                    filename = file_map.get(species)
                    if not filename:
                        return JsonResponse({"error": "Invalid species"}, status=400)

                    file_path = os.path.join(os.path.dirname(__file__), 'static', 'resources', filename)
                    with open(file_path, 'r') as f:
                        gene_sets_data = json.load(f)

                # Filter selected gene sets
                filtered = get_selected_gene_sets_with_relevant_members(
                    gene_list=ranked_genes,
                    min_members_threshold=min_members,
                    selected_gene_sets=selected_gene_sets,
                    gene_sets_data=gene_sets_data,
                )
                print(len(gene_sets_data))

                if not filtered:
                    return JsonResponse({
                        "error": "No gene sets matched after filtering. Please select other categories or adjust your input."
                    }, status=400)

                gene_sets_with_p = calculate_pvals(filtered, ranked_genes, tail_mode=tail_mode)
                annotate_ranked_gene_sets(filtered, ranked_genes, tail_mode=tail_mode)

                preview = sorted(
                    gene_sets_with_p.items(),
                    key=lambda item: item[1][1]
                )[:10]

                print("Top 10 ranked gene sets by p-value:")
                for name, (genes, p_raw, q_val) in preview:
                    print(name, "p =", p_raw, "q =", q_val)

                print("Number of filtered gene sets before ranked process =", len(filtered))
                print("Number of gene sets with p/q =", len(gene_sets_with_p))

                cache.set(analysis_cache_key, gene_sets_with_p, timeout=cache_timeout - 50)
                cache.set(ranked_genes_cache_key, ranked_genes, timeout=cache_timeout)
                cache.set(filtered_cache_key, filtered, timeout=cache_timeout)
            else:
                ranked_genes = cache.get(ranked_genes_cache_key) or []
                filtered = cache.get(filtered_cache_key) or []

            annotate_ranked_gene_sets(filtered, ranked_genes, tail_mode=tail_mode)

            # Convert thresholds to float if provided
            thr_key = ""
            if p_thr not in [None, ""]:
                p_thr = float(p_thr)
                fdr_thr = None
                thr_key = f"p-thresholded-{p_thr}"
            elif fdr_thr not in [None, ""]:
                fdr_thr = float(fdr_thr)
                p_thr = None
                thr_key = f"fdr-thresholded-{fdr_thr}"

            print("thr_key = " + thr_key)

            threshold_cache_key = f"threshold:ranked:{key_hash}:{thr_key}"
            result_filtered = cache.get(threshold_cache_key)
            if result_filtered is None:
                print("filtering gene sets")
                result_filtered = filter_gene_sets_by_significance(gene_sets_with_p, p_thr, fdr_thr)
                print("filtering gene sets done")
                cache.set(threshold_cache_key, result_filtered, timeout=cache_timeout)

            if result_filtered is None:
                return JsonResponse({
                    "error": "No gene sets passed the selected threshold. "
                    "Please choose another collection or increase the p-value/FDR threshold."
                }, status=400)

            print("completed p clcultions")
            signif_gene_sets, pvl, fdr = result_filtered
            print(len(signif_gene_sets), pvl, fdr)
            try:
                if len(signif_gene_sets) < 4:  # if we have less than 4 points
                    # You raise ValueError, it's caught, and HttpResponseBadRequest is returned
                    raise ValueError(
                        "Not enough gene sets passed the threshold to render a graph. Please increase your FDR or p-value.")

            except ValueError as e:
                return JsonResponse({'error': str(e)}, status=400)


            # Run Ump
            distance_type = (data.get('distance_type') or 'jaccard_weighted').lower()
            print("building user_weights")
            user_weights = build_weights_from_ranked_list(ranked_genes) if len(ranked_genes) > 0 else None
            print("weights built")

            dist_key = f"distance:ranked:{key_hash}:{thr_key}:{distance_type}:rescaled"
            distance_matrix = cache.get(dist_key)
            expected_n = len(signif_gene_sets)

            if distance_matrix is not None:
                try:
                    if distance_matrix.shape[0] != expected_n:
                        distance_matrix = None
                except Exception:
                    distance_matrix = None
                    
            if distance_matrix is None:
                print("generating distance matrix")
                distance_matrix = calculate_distance_matrix(signif_gene_sets, distance_type, user_weights)
                print("distance matrix generated")
                cache.set(dist_key, distance_matrix, timeout=cache_timeout)

            print("running reduction")
            mapped_result, _ = umap_reduction(signif_gene_sets, settings, user_weights, distance_type, distance_matrix)
            print("completed reduction")

            # Return result as JSON
            print("loding result into json")
            data = json.loads(mapped_result)  # or skip if already a Python object
            attach_display_meta(data, build_ranked_display_meta(filtered, signif_gene_sets))
            print("returning teh response")

            # Only run HDBSCAN + LLM if cluster-mode is ON
            cluster_on = False
            if isinstance(settings, dict):
                cluster_on = bool(settings.get("cluster-mode", False))

            if cluster_on:
                cluster_algorithm = (settings.get("cluster-algorithm") or "hdbscan").lower()

                if cluster_algorithm == "hdbscan":
                    min_cluster_size_raw = settings.get("hdbscan-min-cluster-size", 5)
                    min_samples_raw = settings.get("hdbscan-min-samples", None)
                    xi = 0.05
                elif cluster_algorithm == "optics":
                    min_cluster_size_raw = settings.get("optics-min-cluster-size", None)
                    min_samples_raw = settings.get("optics-min-samples", 5)
                    xi = float(settings.get("optics-xi", 0.05))
                else:
                    return JsonResponse({"error": f"Unsupported cluster algorithm: {cluster_algorithm}"}, status=400)

                min_cluster_size = (
                    int(min_cluster_size_raw)
                    if (min_cluster_size_raw not in [None, "", "null"])
                    else None
                )
                min_samples = (
                    int(min_samples_raw)
                    if (min_samples_raw not in [None, "", "null"])
                    else None
                )

                data = add_clusters_on_embedding(
                    data,
                    cluster_algorithm=cluster_algorithm,
                    min_cluster_size=min_cluster_size,
                    min_samples=min_samples,
                    xi=xi,
                )

                summaries = build_cluster_summaries(data)
                name_by_id = label_clusters_with_llm(summaries, cache_obj=cache)

                for p in data:
                    try:
                        cid = int(p.get("clusterID", -1))
                    except Exception:
                        cid = -1
                    p["clusterLabel"] = "" if cid == -1 else name_by_id.get(cid, "Unknown pathway")
            else:
                for p in data:
                    p["clusterID"] = -1
                    p["clusterLabel"] = ""

            print("grphing")
            return JsonResponse({
                "umap": data,
                "p_value": pvl,
                "fdr_value": fdr
            })

        except Exception as e:
            return JsonResponse({'error': str(e)}, status=400)

    # Method not allowed
    return JsonResponse({'error': 'Method not allowed'}, status=405)

@csrf_exempt
def scored_genes_view(request):
    if request.method == 'POST':
        try:
            data = json.loads(request.body)

            print("Called scored_genes_view")
            cache_timeout = 1000

            scored_genes_raw = data.get("scored_genes_raw", "")
            selected_gene_sets = data.get("selected_genes_sets", [])
            min_members = int(data.get("minMembers", 5))
            p_thr = data.get("p_thr")
            fdr_thr = data.get("fdr_thr")
            species = data.get("species", "human")
            custom_data = data.get("custom_data")
            settings = data.get("settings")
            tail_mode = (data.get("tail_mode") or "positive").lower()

            if tail_mode not in {"positive", "negative", "both"}:
                return JsonResponse({"error": f"Invalid tail_mode: {tail_mode}"}, status=400)

            cache_key_data = {
                "scored_genes_raw": scored_genes_raw,
                "sel_gene_sets": selected_gene_sets,
                "min_members": min_members,
                "species": species,
                "custom_data": custom_data,
                "tail_mode": tail_mode,
            }
            serialized_data = json.dumps(cache_key_data, separators=(",", ":"))
            key_hash = hashlib.md5(serialized_data.encode("utf-8")).hexdigest()

            analysis_cache_key = f"analysis:scored:{key_hash}"
            scored_genes_cache_key = f"inputs:scored:{key_hash}:scored_genes"
            user_weights_cache_key = f"weights:scored:{key_hash}"
            filtered_cache_key = f"filtered:scored:{key_hash}"

            gene_sets_with_p = cache.get(analysis_cache_key)
            filtered = []
            scored_genes = []
            user_weights = {}

            if gene_sets_with_p is None:
                if not scored_genes_raw.strip():
                    return JsonResponse({"error": "Missing scored genes input."}, status=400)

                # Parse uploaded scored genes text into ordered rows + weight map
                scored_genes, user_weights = parse_scored_genes_raw(scored_genes_raw)

                if not scored_genes:
                    return JsonResponse({"error": "No valid scored genes were found in the uploaded file."}, status=400)

                ranked_genes = [row["gene"] for row in scored_genes]

                species = species.lower()
                if species == "custom":
                    if not custom_data:
                        return JsonResponse({"error": "Missing custom_data for custom species"}, status=400)
                    gene_sets_data = custom_data
                else:
                    file_map = {
                        "human": "msigdb.v2025.1.Hs.json",
                        "mouse": "msigdb.v2025.1.Mm.json"
                    }
                    filename = file_map.get(species)
                    if not filename:
                        return JsonResponse({"error": "Invalid species"}, status=400)

                    file_path = os.path.join(os.path.dirname(__file__), "static", "resources", filename)
                    with open(file_path, "r") as f:
                        gene_sets_data = json.load(f)

                print("collecting selected genes with relevant members for scored genes")
                filtered = get_selected_gene_sets_with_relevant_members(
                    gene_list=ranked_genes,
                    min_members_threshold=min_members,
                    selected_gene_sets=selected_gene_sets,
                    gene_sets_data=gene_sets_data,
                )

                if not filtered:
                    return JsonResponse({
                        "error": "No gene sets matched after filtering. Please select other categories or adjust your input."
                    }, status=400)

                print("running GSEApy prerank")
                gene_sets_with_p = run_gseapy(filtered, scored_genes, tail_mode=tail_mode)

                preview = sorted(
                    gene_sets_with_p.items(),
                    key=lambda item: item[1][1]
                )[:10]

                print("Top 10 scored gene sets by p-value:")
                for name, (genes, p_raw, q_val) in preview:
                    print(name, "p =", p_raw, "q =", q_val)

                print("Number of filtered gene sets before GSEAPY =", len(filtered))
                print("Number of gene sets with p/q =", len(gene_sets_with_p))

                all_q = sorted([v[2] for v in gene_sets_with_p.values()])[:10]
                print("Top 10 q-values:", all_q)

                print("GSEApy done")

                if not gene_sets_with_p:
                    return JsonResponse({
                        "error": "GSEApy returned no enrichment results for the selected gene sets."
                    }, status=400)

                cache.set(analysis_cache_key, gene_sets_with_p, timeout=cache_timeout - 50)
                cache.set(scored_genes_cache_key, scored_genes, timeout=cache_timeout)
                cache.set(user_weights_cache_key, user_weights, timeout=cache_timeout)
                cache.set(filtered_cache_key, filtered, timeout=cache_timeout)

            else:
                scored_genes = cache.get(scored_genes_cache_key) or []
                user_weights = cache.get(user_weights_cache_key) or {}
                filtered = cache.get(filtered_cache_key) or []

            # Convert thresholds to float if provided
            thr_key = ""
            if p_thr not in [None, ""]:
                p_thr = float(p_thr)
                fdr_thr = None
                thr_key = f"p-thresholded-{p_thr}"
            elif fdr_thr not in [None, ""]:
                fdr_thr = float(fdr_thr)
                p_thr = None
                thr_key = f"fdr-thresholded-{fdr_thr}"

            print("thr_key = " + thr_key)

            threshold_cache_key = f"threshold:scored:{key_hash}:{thr_key}"
            result_filtered = cache.get(threshold_cache_key)

            if result_filtered is None:
                print("filtering gene sets")
                result_filtered = filter_gene_sets_by_significance(gene_sets_with_p, p_thr, fdr_thr)
                print("filtering gene sets done")
                cache.set(threshold_cache_key, result_filtered, timeout=cache_timeout)

            if result_filtered is None:
                return JsonResponse({
                    "error": "No gene sets passed the selected threshold. Please choose another collection or increase the p-value/FDR threshold."
                }, status=400)

            signif_gene_sets, pvl, fdr = result_filtered

            try:
                if len(signif_gene_sets) < 4:
                    raise ValueError(
                        "Not enough gene sets passed the threshold to render a graph. Please increase your FDR or p-value."
                    )
            except ValueError as e:
                return JsonResponse({"error": str(e)}, status=400)

            distance_type = (data.get("distance_type") or "jaccard_weighted").lower()

            # For scored genes mode, weighted distances must use the natural score-based weights
            if distance_type in ["jaccard_weighted", "overlap_weighted"] and not user_weights:
                user_weights = build_weights_from_scored_genes(scored_genes)

            dist_key = f"distance:scored:{key_hash}:{thr_key}:{distance_type}:rescaled"
            distance_matrix = cache.get(dist_key)
            expected_n = len(signif_gene_sets)

            if distance_matrix is not None:
                try:
                    if distance_matrix.shape[0] != expected_n:
                        distance_matrix = None
                except Exception:
                    distance_matrix = None

            if distance_matrix is None:
                print("generating distance matrix")
                distance_matrix = calculate_distance_matrix(signif_gene_sets, distance_type, user_weights)
                print("distance matrix generated")
                cache.set(dist_key, distance_matrix, timeout=cache_timeout)

            print("running umap")
            mapped_result, _ = umap_reduction(signif_gene_sets, settings, user_weights, distance_type, distance_matrix)
            print("completed umap")

            graph_data = json.loads(mapped_result)
            attach_display_meta(
                graph_data,
                build_scored_display_meta(filtered, signif_gene_sets, scored_genes, tail_mode),
            )

            cluster_on = False
            if isinstance(settings, dict):
                cluster_on = bool(settings.get("cluster-mode", False))

            if cluster_on:
                cluster_algorithm = (settings.get("cluster-algorithm") or "hdbscan").lower()

                if cluster_algorithm == "hdbscan":
                    min_cluster_size_raw = settings.get("hdbscan-min-cluster-size", 5)
                    min_samples_raw = settings.get("hdbscan-min-samples", None)
                    xi = 0.05
                elif cluster_algorithm == "optics":
                    min_cluster_size_raw = settings.get("optics-min-cluster-size", None)
                    min_samples_raw = settings.get("optics-min-samples", 5)
                    xi = float(settings.get("optics-xi", 0.05))
                else:
                    return JsonResponse({"error": f"Unsupported cluster algorithm: {cluster_algorithm}"}, status=400)

                min_cluster_size = (
                    int(min_cluster_size_raw)
                    if (min_cluster_size_raw not in [None, "", "null"])
                    else None
                )
                min_samples = (
                    int(min_samples_raw)
                    if (min_samples_raw not in [None, "", "null"])
                    else None
                )

                graph_data = add_clusters_on_embedding(
                    graph_data,
                    cluster_algorithm=cluster_algorithm,
                    min_cluster_size=min_cluster_size,
                    min_samples=min_samples,
                    xi=xi,
                )

                summaries = build_cluster_summaries(graph_data)
                name_by_id = label_clusters_with_llm(summaries, cache_obj=cache)

                for p in graph_data:
                    try:
                        cid = int(p.get("clusterID", -1))
                    except Exception:
                        cid = -1
                    p["clusterLabel"] = "" if cid == -1 else name_by_id.get(cid, "Unknown pathway")
            else:
                for p in graph_data:
                    p["clusterID"] = -1
                    p["clusterLabel"] = ""

            print("graphing scored genes result")
            return JsonResponse({
                "umap": graph_data,
                "p_value": pvl,
                "fdr_value": fdr
            })

        except Exception as e:
            return JsonResponse({"error": str(e)}, status=400)

    return JsonResponse({"error": "Method not allowed"}, status=405)

@csrf_exempt
def preview_threshold(request):
    if request.method != "POST":
        return JsonResponse({"error": "POST request required"}, status=400)

    try:
        data = json.loads(request.body)

        mode = (data.get("mode") or "").lower()
        tail_mode = (data.get("tail_mode") or "positive").lower()

        if tail_mode not in {"positive", "negative", "both"}:
            return JsonResponse({"error": f"Invalid tail_mode: {tail_mode}"}, status=400)

        p_val = data.get("p_val")
        fdr = data.get("fdr")

        p_val = float(p_val) if p_val not in [None, ""] else None
        fdr = float(fdr) if fdr not in [None, ""] else None

        # ---------- Ranked mode ----------
        if mode == "ranked":
            ranked_genes = data.get("ranked_genes", [])
            if not ranked_genes:
                return JsonResponse({"error": "Missing ranked_genes input"}, status=400)

            filtered = [
                {"matched_genes": [g], "gene_set_name": f"Gene {i}"}
                for i, g in enumerate(ranked_genes)
            ]

            gene_sets_with_p = calculate_pvals(
                filtered,
                ranked_genes,
                tail_mode=tail_mode
            )

        # ---------- Thresholded mode ----------
        elif mode == "thresholded":
            sig_genes = data.get("sig_genes", [])
            insig_genes = data.get("insig_genes", [])

            if not (sig_genes or insig_genes):
                return JsonResponse({"error": "Missing sig_genes / insig_genes input"}, status=400)

            filtered = [{
                "matched_genes": list(set(sig_genes + insig_genes)),
                "gene_set_name": "combined"
            }]

            gene_sets_with_p = run_fishers_test(
                filtered,
                sig_genes,
                insig_genes
            )

        # ---------- Scored mode ----------
        elif mode == "scored":
            scored_genes_raw = data.get("scored_genes_raw", "")
            if not scored_genes_raw or not scored_genes_raw.strip():
                return JsonResponse({"error": "Missing scored_genes_raw input"}, status=400)

            scored_genes, _ = parse_scored_genes_raw(scored_genes_raw)

            if not scored_genes:
                return JsonResponse({"error": "No valid scored genes were found."}, status=400)

            filtered = [
                {"matched_genes": [row["gene"]], "gene_set_name": f"Gene {i}"}
                for i, row in enumerate(scored_genes)
            ]

            gene_sets_with_p = run_gseapy(filtered, scored_genes, tail_mode=tail_mode)

        else:
            return JsonResponse({
                "error": "Invalid mode. Expected one of: ranked, thresholded, scored"
            }, status=400)

        result_filtered = filter_gene_sets_by_significance(gene_sets_with_p, p_val, fdr)

        if result_filtered is None:
            return JsonResponse({
                "error": "No gene sets passed the selected threshold. "
                         "Please choose another collection or increase the p-value/FDR threshold."
            }, status=400)

        _, computed_p, computed_fdr = result_filtered

        return JsonResponse({
            "p_val": computed_p,
            "fdr": computed_fdr
        })

    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)

# Sends the graph.html file to be shown as a webpage — most likely inside an <iframe> on the main page.    
def read_graph(request):
    file_path = os.path.join(settings.BASE_DIR, 'graph', 'templates', 'graph.html')
    return FileResponse(open(file_path, 'rb'), content_type='text/html')

# Just return the Help page
def help(request):
    return render(request, 'help.html')

# Show the About page
def about(request):
    return render(request, 'about.html')

@require_GET
def serve_msigdb(request):
    try:
        species = request.GET.get("species", "human").lower()

        file_map = {
            "human": "msigdb.v2025.1.Hs.json",
            "mouse": "msigdb.v2025.1.Mm.json"
        }
        filename = file_map.get(species)
        if not filename:
            return JsonResponse({"error": "Invalid species"}, status=400)
        
        file_path = os.path.join(os.path.dirname(__file__), 'static', 'resources', filename)
        if not os.path.exists(file_path):
            return JsonResponse({"error": "MSigDB file not found"}, status=404)
        
        with open(file_path, 'r') as f:
            msigdb_data = json.load(f)

        return JsonResponse(msigdb_data)
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)
    
@csrf_exempt
def upload_custom_gene_sets(request):
    if request.method != 'POST':
        return JsonResponse({"error": "Only POST allowed"}, status=405)

    uploaded_file = request.FILES.get("file")
    if not uploaded_file:
        return JsonResponse({"error": "No file provided"}, status=400)

    try:
        data = json.load(uploaded_file)

        # Format 1: MSigDB-style (has nested structure)
        if isinstance(data, dict) and all(isinstance(v, dict) for v in data.values()):
            return JsonResponse({
                "treeType": "msigdb",
                "data": data
            })

        # Format 2: Flat list of {name, genes}
        elif isinstance(data, list) and all("name" in gs and "genes" in gs for gs in data):
            return JsonResponse({
                "treeType": "flat",
                "count": len(data)
            })

        else:
            raise ValueError("Unrecognized format")

    except Exception as e:
        return JsonResponse({"error": f"Invalid JSON format: {str(e)}"}, status=400)
