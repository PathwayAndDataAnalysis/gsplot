from django.shortcuts import render, HttpResponse
import os
import json
import hashlib
import numpy as np
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
from .dataReduction import umap_reduction, build_weights_from_ranked_list, build_weights_from_sets
from .dataReduction import calculate_pvals
from .gene_set_utils import get_selected_gene_sets_with_relevant_members
from django.shortcuts import render
from .dataReduction import run_fishers_test
from .dataReduction import filter_gene_sets_by_significance
from .dataReduction import calculate_distance_matrix

# Create your views here.
# When someone goes to the website root (/), it shows the homepage (base.html).
def home(request):
    return render(request, 'base.html')

# This is the most important function.
# It receives a POST request with:
    # the uploaded .tsv file (base64 encoded),
    # UMAP settings (neighbors, minDistance, seed).
# Calls umap_reduction() with that data.
# Sends back JSON data (the reduced coordinates + info) to the frontend.

def add_hdbscan_clusters_on_embedding(points, min_cluster_size=5, min_samples=None):
    """
    points: list[dict] each dict contains "X", "Y"
    Adds: point["clusterID"] = int label (noise = -1)
    """
    if hdbscan is None:
        raise RuntimeError("hdbscan is not installed on the server. Please add it to requirements and install.")

    if not points or len(points) < 4:
        for p in points:
            p["clusterID"] = -1
        return points

    X = np.array([[float(p["X"]), float(p["Y"])] for p in points], dtype=float)

    # If min_samples is not provided, HDBSCAN uses min_cluster_size by default behavior
    clusterer = hdbscan.HDBSCAN(
        min_cluster_size=int(min_cluster_size),
        min_samples=(int(min_samples) if min_samples is not None else None),
        metric="euclidean"
    )

    labels = clusterer.fit_predict(X)  # noise = -1
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

        min_cluster_size = int(payload.get("min_cluster_size", 5))
        min_samples_raw = payload.get("min_samples", None)
        min_samples = int(min_samples_raw) if (min_samples_raw not in [None, "", "null"]) else None

        points = add_hdbscan_clusters_on_embedding(
            points,
            min_cluster_size=min_cluster_size,
            min_samples=min_samples
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
            relevant_members = data.get("relevant_members") or []

            cache_key_data = {
                "sig_genes": sig_input,
                "insig_genes": insig_input,
                "sel_gene_sets": selected_gene_sets,
                "min_members": min_members,
                "species": species,
                "custom_data": custom_data
            }
            serialized_data = json.dumps(cache_key_data, separators=(",", ":"))
            key_hash = hashlib.md5(serialized_data.encode('utf-8')).hexdigest()

            gene_sets_with_p = cache.get(key_hash)
            sig_genes = []
            insig_genes = []
            filtered = []

            if gene_sets_with_p is None:
                cache.clear()

                # Split inputs into cleaned gene lists
                sig_genes = [gene.strip() for gene in sig_input.replace(',', '\n').splitlines() if gene.strip()]
                insig_genes = [gene.strip() for gene in insig_input.replace(',', '\n').splitlines() if gene.strip()]

                if relevant_members:
                    filtered = json.loads(relevant_members) if isinstance(relevant_members, str) else relevant_members
                else:

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
                cache.set(key_hash, gene_sets_with_p, timeout=cache_timeout - 50)
                cache.set("sig_genes", sig_genes, timeout=cache_timeout)
                cache.set("insig_genes", insig_genes, timeout=cache_timeout)
                cache.set("filtered_sets", filtered, timeout=cache_timeout)
            else:
                sig_genes = cache.get("sig_genes")
                insig_genes = cache.get("insig_genes")
                filtered = cache.get("filtered_sets")

            # Convert thresholds to float if provided
            thr_key = ''
            if p_thr:
                p_thr = float(p_thr)
                thr_key = f'p-thresholded-{p_thr}'
            if fdr_thr:
                fdr_thr = float(fdr_thr)
                thr_key = f'fdr-thresholded-{fdr_thr}'

            print("thr_key = " + thr_key)

            fisher_result_filtered = cache.get(thr_key)
            if fisher_result_filtered is None:
                print("filtering gene sets")
                fisher_result_filtered = filter_gene_sets_by_significance(gene_sets_with_p, p_thr, fdr_thr)
                print("filtering gene sets done")
                cache.set(thr_key, fisher_result_filtered, timeout=cache_timeout)

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

            dist_key = f"{key_hash}|{thr_key}|{distance_type}|rescaled_v1"
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

            # Only run HDBSCAN + LLM if cluster-mode is ON
            cluster_on = False
            if isinstance(settings, dict):
                cluster_on = bool(settings.get("cluster-mode", False))

            if cluster_on:
                min_cluster_size = int(settings.get("hdbscan-min-cluster-size", 5))
                min_samples_raw = settings.get("hdbscan-min-samples", None)
                min_samples = int(min_samples_raw) if (min_samples_raw not in [None, "", "null"]) else None

                data = add_hdbscan_clusters_on_embedding(
                    data,
                    min_cluster_size=min_cluster_size,
                    min_samples=min_samples
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
                "relevant_members": json.dumps(filtered),
                "distancesM": [],
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
            relevant_members = data.get("relevant_members") or []

            cache_key_data = {
                "ranked_genes": genes_input,
                "sel_gene_sets": selected_gene_sets,
                "min_members": min_members,
                "species": species,
                "custom_data": custom_data
            }
            serialized_data = json.dumps(cache_key_data, separators=(",", ":"))
            key_hash = hashlib.md5(serialized_data.encode('utf-8')).hexdigest()

            gene_sets_with_p = cache.get(key_hash)
            ranked_genes = []
            filtered = []

            if gene_sets_with_p is None:
                cache.clear()

                # Split inputs into cleaned gene lists
                ranked_genes = [gene.strip() for gene in genes_input.replace(',', '\n').splitlines() if gene.strip()]

                if relevant_members:
                    filtered = json.loads(relevant_members) if isinstance(relevant_members, str) else relevant_members
                else:
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

                gene_sets_with_p = calculate_pvals(filtered, ranked_genes)
                cache.set(key_hash, gene_sets_with_p, timeout=cache_timeout - 50)
                cache.set("ranked_genes", ranked_genes, timeout=cache_timeout)
                cache.set("filtered_sets", filtered, timeout=cache_timeout)
            else:
                ranked_genes = cache.get("ranked_genes")
                filtered = cache.get("filtered_sets")

            # Convert thresholds to float if provided
            thr_key = ''
            if p_thr:
                p_thr = float(p_thr)
                thr_key = f'p-thresholded-{p_thr}'
            if fdr_thr:
                fdr_thr = float(fdr_thr)
                thr_key = f'fdr-thresholded-{fdr_thr}'

            print("thr_key = " + thr_key)

            result_filtered = cache.get(thr_key)
            if result_filtered is None:
                print("filtering gene sets")
                result_filtered = filter_gene_sets_by_significance(gene_sets_with_p, p_thr, fdr_thr)
                print("filtering gene sets done")
                cache.set(thr_key, result_filtered, timeout=cache_timeout)

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

            dist_key = f"{key_hash}|{thr_key}|{distance_type}|rescaled_v1"
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
            print("returning teh response")

            # Only run HDBSCAN + LLM if cluster-mode is ON
            cluster_on = False
            if isinstance(settings, dict):
                cluster_on = bool(settings.get("cluster-mode", False))

            if cluster_on:
                min_cluster_size = int(settings.get("hdbscan-min-cluster-size", 5))
                min_samples_raw = settings.get("hdbscan-min-samples", None)
                min_samples = int(min_samples_raw) if (min_samples_raw not in [None, "", "null"]) else None

                data = add_hdbscan_clusters_on_embedding(
                    data,
                    min_cluster_size=min_cluster_size,
                    min_samples=min_samples
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
                "distancesM": [],
                "relevant_members": json.dumps(filtered),
                "p_value": pvl,
                "fdr_value": fdr
            })

        except Exception as e:
            return JsonResponse({'error': str(e)}, status=400)

    # Method not allowed
    return JsonResponse({'error': 'Method not allowed'}, status=405)

@csrf_exempt
def preview_threshold(request):
    if request.method != "POST":
        return JsonResponse({"error": "POST request required"}, status=400)

    try:
        data = json.loads(request.body)

        p_val = data.get("p_val")
        fdr = data.get("fdr")
        ranked_genes = data.get("ranked_genes", [])
        sig_genes = data.get("sig_genes", [])
        insig_genes = data.get("insig_genes", [])

        p_val = float(p_val) if p_val else None
        fdr = float(fdr) if fdr else None

        if ranked_genes:
            filtered = [{"matched_genes": [g], "gene_set_name": f"Gene {i}"} for i, g in enumerate(ranked_genes)]
            gene_sets_with_p = calculate_pvals(filtered, ranked_genes)
        elif sig_genes or insig_genes:
            filtered = [{
                "matched_genes": list(set(sig_genes + insig_genes)),
                "gene_set_name": "combined"
            }]
            gene_sets_with_p = run_fishers_test(filtered, sig_genes, insig_genes)
        else:
            return JsonResponse({"error": "Missing gene input"}, status=400)

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

def read_output(request):
    if request.method == 'POST':
        try:
            data = json.loads(request.body)
            fileData = data.get('file')
            neighbors = data.get('neighbors')
            seed = data.get('seed')
            minDistance = data.get('minDistance')
            output = umap_reduction(fileData, neighbors, minDistance, seed)
            data = json.loads(output)
            return JsonResponse(data, safe=False)
        except Exception as e:
            error_response = {
                'error': str(e)
            }
            return JsonResponse(error_response, status=400)
    else:
        return JsonResponse({'error': 'Method not allowed'}, status=405)

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
