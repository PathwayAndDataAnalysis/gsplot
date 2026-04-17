import math
try:
    import gseapy as gp
except ImportError:
    gp = None
import pandas as pd
import umap.umap_ as umap
import numpy as np
from scipy.stats import fisher_exact
from statsmodels.stats.multitest import multipletests
from scipy.stats import norm
from sklearn.manifold import Isomap, TSNE

DISTANCE_RESCALING_CAP = 100.0


# python manage.py runserver
# python manage.py migrate


# calculate how different two sets are
# if two sets are exactly the same, the result = 0
# if they have no overlap, the result = 1
# It's used to calculate the distance between gene sets based on the molecules they contain.
def jaccard_distance(set1, set2):
    return 1 - (len(set1.intersection(set2)) / len(set1.union(set2)))


def weighted_jaccard_distance(user_weights, gene_seta, gene_setb):
    numerator = 0.0
    denominator = 0.0
    all_genes = gene_seta.union(gene_setb)

    for gene in all_genes:
        w_a = user_weights.get(gene, 0.0) if gene in gene_seta else 0.0
        w_b = user_weights.get(gene, 0.0) if gene in gene_setb else 0.0
        numerator += min(w_a, w_b)
        denominator += max(w_a, w_b)

    return 1 - (numerator / denominator) if denominator else 1.0    # distance = 1 - similarity


def rescale_distance(raw_distance, cap=DISTANCE_RESCALING_CAP):
    """
    Convert bounded raw distance d in [0, 1] to d/(1-d), capped to avoid infinities.
    """
    d = float(raw_distance)
    if not np.isfinite(d):
        return cap

    d = max(0.0, d)
    denom = 1.0 - d
    if denom <= 0.0:
        return cap

    return min(d / denom, cap)


def build_weights_from_ranked_list(ranked_genes):
    """
    ranked_genes: list of gene names in order from highest to lowest rank
    Returns: dict {gene: normalized_rank}
    """
    n = len(ranked_genes)
    user_weights = {}
    for i, gene in enumerate(ranked_genes):
        norm_rank = (i + 1 - 0.5) / n
        user_weights[gene.strip()] = 1 - norm_rank
    return user_weights


def build_weights_from_sets(sig_genes, insig_genes):
    """
    sig_genes: list of sig genes in ranked order (high to low)
    insig_genes: list of insig genes (no rank needed, all = 0)
    Returns: dict {gene: normalized_rank}
    """
    user_weights = {}
    k = len(sig_genes)

    # Assign normalized rank to sig_genes
    for i, gene in enumerate(sig_genes):
        user_weights[gene.strip()] = 1 / k

    # Assign 0 to insig genes if not already in sig
    for gene in insig_genes:
        gene = gene.strip()
        user_weights[gene] = 0.0

    return user_weights

def parse_scored_genes_raw(scored_genes_raw):
    """
    Parse raw uploaded scored-genes text into:
    1) scored_genes: ordered list of {"gene": ..., "score": raw_signed_score}
    2) user_weights: dict {gene: abs(score)} for distance weighting

    Expected input: two columns, no header.
    Prefer tab-delimited, but also allow generic whitespace split.
    Duplicate genes: keep first occurrence.
    """
    if not scored_genes_raw or not scored_genes_raw.strip():
        return [], {}

    scored_genes = []
    seen = set()

    lines = scored_genes_raw.splitlines()
    for line_no, raw_line in enumerate(lines, start=1):
        line = raw_line.strip()
        if not line:
            continue

        if "\t" in line:
            parts = [p.strip() for p in line.split("\t") if p.strip()]
        else:
            parts = line.split()

        if len(parts) < 2:
            raise ValueError(
                f"Invalid scored genes file format at line {line_no}. "
                f"Each line must contain exactly 2 columns: gene and score."
            )

        gene = parts[0].strip()
        score_raw = parts[1].strip()

        if not gene:
            continue

        try:
            score = float(score_raw)   # keep raw signed score
        except ValueError:
            raise ValueError(
                f"Invalid score at line {line_no} for gene '{gene}'. "
                f"Score must be numeric."
            )

        if not np.isfinite(score):
            raise ValueError(
                f"Invalid score at line {line_no} for gene '{gene}'. "
                f"Score must be a finite number."
            )

        if gene in seen:
            continue

        seen.add(gene)
        scored_genes.append({
            "gene": gene,
            "score": score,
        })

    if not scored_genes:
        return [], {}

    # Sort by raw signed score: highest positive at top, most negative at bottom
    scored_genes.sort(key=lambda x: x["score"], reverse=True)

    # Keep magnitude-only weights for distance calculations
    user_weights = {row["gene"]: abs(float(row["score"])) for row in scored_genes}
    return scored_genes, user_weights


def build_weights_from_scored_genes(scored_genes):
    """
    scored_genes: list of {"gene": ..., "score": raw_signed_score}
    Returns magnitude-only weights for weighted distances.
    """
    if not scored_genes:
        return {}

    return {
        row["gene"].strip(): float(abs(row["score"]))
        for row in scored_genes
        if row.get("gene") and np.isfinite(float(row["score"]))
    }


def run_gseapy(filtered, scored_genes, tail_mode="both"):
    """
    Run GSEApy prerank on raw signed scores.

    tail_mode:
      - "positive": one-sided positive tail using ES sign
      - "negative": one-sided negative tail using ES sign
      - "both": keep original two-sided p-value
    """
    if gp is None:
        raise RuntimeError(
            "gseapy is not installed on the server. "
            "Install it with: pip install gseapy"
        )

    if not filtered or not scored_genes:
        return {}

    if tail_mode not in {"positive", "negative", "both"}:
        raise ValueError(f"Unknown tail_mode: {tail_mode}")

    # Build prerank input from raw signed scores
    rnk = pd.DataFrame(
        [(row["gene"], float(row["score"])) for row in scored_genes],
        columns=["gene", "score"]
    )

    # Keep current in-memory library shape
    gene_sets = {
        geneset["gene_set_name"]: list(geneset["matched_genes"])
        for geneset in filtered
    }

    # Break exact ties very slightly without changing meaningful ordering
    rnk = rnk.copy()
    rnk["tie_breaker"] = np.arange(len(rnk), dtype=float) * 1e-12
    rnk["score"] = rnk["score"] + rnk["tie_breaker"]
    rnk = rnk[["gene", "score"]]

    pre_res = gp.prerank(
        rnk=rnk,
        gene_sets=gene_sets,
        threads=1,
        permutation_num=2000,
        min_size=1,
        max_size=100000,
        seed=1,
        outdir=None,
        no_plot=True,
        verbose=False,
    )

    result = pre_res.res2d
    if result is None or len(result) == 0:
        return {}

    # Normalize column names across GSEApy versions
    cols_lower = {str(c).strip().lower(): c for c in result.columns}

    term_col = None
    for candidate in ["term", "name", "pathway"]:
        if candidate in cols_lower:
            term_col = cols_lower[candidate]
            break

    es_col = None
    for candidate in ["es"]:
        if candidate in cols_lower:
            es_col = cols_lower[candidate]
            break

    p_col = None
    for candidate in ["pval", "p-value", "p value", "nom p-val", "nom_p_val"]:
        if candidate in cols_lower:
            p_col = cols_lower[candidate]
            break

    if term_col is None:
        term_col = result.columns[0]

    if es_col is None:
        raise ValueError(
            f"Could not find ES column in GSEApy result. Columns: {list(result.columns)}"
        )

    if p_col is None:
        raise ValueError(
            f"Could not find p-value column in GSEApy result. Columns: {list(result.columns)}"
        )

    matched_by_name = {
        geneset["gene_set_name"]: " ".join(str(g) for g in geneset["matched_genes"])
        for geneset in filtered
    }

    tmp = {}
    for _, row in result.iterrows():
        set_name = str(row[term_col])
        if set_name not in matched_by_name:
            continue

        es_val = float(row[es_col])
        p_two_sided = float(row[p_col])

        # Clamp just in case
        p_two_sided = max(0.0, min(1.0, p_two_sided))

        if tail_mode == "both":
            p_used = p_two_sided

        elif tail_mode == "positive":
            if es_val > 0:
                p_used = p_two_sided / 2.0
            elif es_val < 0:
                p_used = 1.0 - (p_two_sided / 2.0)
            else:
                p_used = 1.0

        elif tail_mode == "negative":
            if es_val < 0:
                p_used = p_two_sided / 2.0
            elif es_val > 0:
                p_used = 1.0 - (p_two_sided / 2.0)
            else:
                p_used = 1.0

        gene_string = matched_by_name[set_name]
        tmp[set_name] = (gene_string, p_used)

    return add_q_values(tmp)

def get_vals(gene_sets_for_umap, reject_count, total, p_val, fdr):
    sorted_items = sorted(gene_sets_for_umap.items(), key=lambda item: item[1][1])
    p_vals = np.array([item[1][1] for item in sorted_items])  # Get just the p-values

    reject, q_values, _, _ = multipletests(p_vals, method='fdr_bh', alpha=(fdr if fdr else 1.0))

    if fdr:
        if not reject.any():
            print("No p-values passed the FDR threshold.")
            return {}, p_val, fdr
        threshold_index = np.where(reject)[0].max()
        p_val = p_vals[threshold_index]
        print(f"pval_threshold @ {threshold_index} w val {p_val}")
    else:
        if reject_count <= 0:
            print("no values are under the threshold")
            return {}, p_val, fdr
        fdr = (p_val * total) / reject_count
        print(f"Estimated FDR at threshold {p_val}: {fdr:.4f}")
        threshold_index = max((i for i, (_, val) in enumerate(sorted_items) if val[1] <= p_val), default=-1)

    filtered_gene_sets = {}
    for i in range(threshold_index + 1):
        set_name, (gene_string, p_raw) = sorted_items[i]
        q_val = float(q_values[i])
        filtered_gene_sets[set_name] = (gene_string, p_raw, q_val)

    return filtered_gene_sets, p_val, fdr


def get_reducer(settings):
    reduction = settings['reduction']
    algorithm = reduction['mode']
    if algorithm == 'umap':
        seed = reduction['seed']
        reducer = umap.UMAP(
            metric='precomputed',
            n_neighbors=int(reduction['n_neighbors']),
            random_state=int(seed) if seed and int(seed) != 0 else None,
            min_dist=float(reduction['min_dist']),
        )
    elif algorithm == 'isomap':
        # n_neighbors is used to build the neighborhood graph.
        reducer = Isomap(
            n_components=2,
            n_neighbors=int(reduction['n_neighbors']),
            metric='precomputed',
            eigen_solver='auto',
        )
    elif algorithm == 'tsne':
        # t-SNE also accepts precomputed distances
        reducer = TSNE(
            n_components=2,
            metric='precomputed',
            perplexity=float(reduction['perplexity']),
            early_exaggeration=float(reduction['early_ex']),
            learning_rate='auto',
            max_iter=int(reduction['max_iter']),
            init='random',
            random_state=None,
        )
    else:
        reducer = None
    return reducer


# Overlapping coefficient distance 
# Plain overlapping coefficient distance
def overlap_coef(set1, set2):
    if not set1 or not set2:
        raise ValueError("One of the sets is empty in plain overlap coefficient calc.")

    common = set1.intersection(set2)
    min_size = min(len(set1), len(set2))

    if min_size == 0:  # this should never happen. check and delete if not needed.
        return 1.0

    dist = 1 - (len(common) / min_size)
    dist = max(0.0, min(1.0, dist))  # Clamp to [0,1]
    return dist


# Weighted overlapping coefficient distance 
def weighted_overlap_coef(user_weights, set1, set2):
    if not set1 or not set2:
        raise ValueError("One of the sets is empty in overlap coefficient calc.")

    common = set1.intersection(set2)
    sum_common = sum(user_weights.get(gene) for gene in common)
    sum1 = sum(user_weights.get(gene) for gene in set1)
    sum2 = sum(user_weights.get(gene) for gene in set2)
    min_sum = min(sum1, sum2)

    if min_sum == 0:  # this can happen if all the member genes of a set are insignificant
        return 1.0

    dist = 1 - (sum_common / min_sum)
    dist = max(0.0, min(1.0, dist))  # Clamp to [0,1]
    return dist


def run_fishers_test(filtered_genes, sig_genes, insig_genes):
    sig_set = set(sig_genes)
    insig_set = set(insig_genes)

    reject_count = 0
    total = len(filtered_genes)

    gene_sets_for_umap = {}

    for geneset in filtered_genes:
        gene_set = geneset['matched_genes']
        set_name = geneset['gene_set_name']
        set_gene_set = set(geneset['matched_genes'])

        a = len(sig_set & set_gene_set)    # sig & in gene set
        b = len(sig_set) - a          # sig & not in gene set
        c = len(insig_set & set_gene_set)  # insig & in gene set
        d = len(insig_set) - c        # insig & not gene set

        table = [[a, b], [c, d]]

        _, p_value = fisher_exact(table, alternative='greater')

        gene_string = ' '.join(str(gene) for gene in gene_set)
        gene_sets_for_umap[set_name] = (gene_string, p_value)

    return add_q_values(gene_sets_for_umap)


def add_q_values(gene_sets_with_p):
    sorted_items = sorted(gene_sets_with_p.items(), key=lambda item: item[1][1])
    p_vals = np.array([item[1][1] for item in sorted_items])  # Get just the p-values
    _, q_values, _, _ = multipletests(p_vals, method='fdr_bh')

    gene_sets_with_p_and_q = {}
    for i in range(len(sorted_items)):
        set_name, (gene_string, p_raw) = sorted_items[i]
        q_val = float(q_values[i])
        gene_sets_with_p_and_q[set_name] = (gene_string, p_raw, q_val)
    return gene_sets_with_p_and_q


def filter_gene_sets_by_significance(gene_sets_with_p, pval_thr, fdr_thr):
    filtered_gene_sets = {}
    if pval_thr:
        filtered_gene_sets = {key: value for key, value in gene_sets_with_p.items() if value[1] <= pval_thr}
        if not filtered_gene_sets:
            return None
        fdr_thr = (pval_thr * len(gene_sets_with_p)) / len(filtered_gene_sets)
    elif fdr_thr:
        filtered_gene_sets = {key: value for key, value in gene_sets_with_p.items() if value[2] <= fdr_thr}
        if not filtered_gene_sets:
            return None
        pval_thr = max(value[1] for value in filtered_gene_sets.values())
    else:
        filtered_gene_sets = gene_sets_with_p
        if not filtered_gene_sets:
            return None

    return filtered_gene_sets, pval_thr, fdr_thr


def calculate_pvals(filtered, ranked_genes, tail_mode='positive'):
    if tail_mode not in {'positive', 'negative', 'both'}:
        raise ValueError(f"Unknown tail_mode: {tail_mode}")

    n = len(ranked_genes)
    if n == 0:
        return {}

    ranks = {}
    gene_sets_with_p = {}

    # normalized rank: top is near 0, bottom is near 1
    for i, gene in enumerate(ranked_genes):
        rank = i + 1
        norm_rank = (rank - 0.5) / n
        ranks[gene] = norm_rank

    for geneset in filtered:
        gene_set = geneset['matched_genes']
        set_name = geneset['gene_set_name']

        inside_ranks = [ranks[gene] for gene in gene_set if gene in ranks]
        if not inside_ranks:
            continue

        gene_n = len(inside_ranks)
        mean_rank = sum(inside_ranks) / gene_n

        # calculate sd
        sd = math.sqrt(((n + 1) * (n - gene_n)) / (12 * (n**2) * gene_n))

        # handle weird edge cases
        if sd <= 0 or not np.isfinite(sd):
            continue

        if tail_mode == 'positive':
            # top enrichment = smaller mean rank
            p_value = norm.cdf(mean_rank, loc=0.5, scale=sd)

        elif tail_mode == 'negative':
            # bottom enrichment = larger mean rank
            p_value = 1.0 - norm.cdf(mean_rank, loc=0.5, scale=sd)

        elif tail_mode == 'both':
            # two-sided distance from center
            z = abs((mean_rank - 0.5) / sd)
            p_value = 2.0 * (1.0 - norm.cdf(z))

        # clamp just in case
        p_value = max(0.0, min(1.0, p_value))

        print(f"Ranked mode p-value for {set_name}: {p_value}")

        gene_string = ' '.join(str(gene) for gene in gene_set)
        gene_sets_with_p[set_name] = (gene_string, p_value)

    return add_q_values(gene_sets_with_p)


def umap_reduction(gene_sets_with_stats, settings, user_weights, distance_type, distance_matrix):
    if distance_type in ['jaccard_weighted', 'overlap_weighted'] and user_weights is None:
        raise ValueError("user_weights must be provided when using weighted option.")

    try:
        all_rows = []
        for set_name, (gene_string, p_raw, q_val) in gene_sets_with_stats.items():
            all_rows.append({
                "Name": set_name,
                "pValue": p_raw,
                "qValue": q_val,
                "Molecules": gene_string.strip()
            })

        df = pd.DataFrame(all_rows)

        n = df.shape[0]

        molecule_sets = [set(df.loc[i, "Molecules"].split()) for i in range(n)]

        # Always compute number of enriched molecules, regardless of distances['use']
        numberOfEnrichedMolecules = [len(mol_set) for mol_set in molecule_sets]

        print(n)

        if distance_matrix is not None and getattr(distance_matrix, "shape", None) is not None:
            if distance_matrix.shape[0] != n or distance_matrix.shape[1] != n:
                print(f"Cached distance_matrix mismatch: {distance_matrix.shape} vs expected ({n},{n}). Recomputing.")
                distance_matrix = None

        if distance_matrix is None:
            print("Computing new distance matrix.")
            distance_matrix = np.zeros((n, n))
            for i in range(n):
                set1 = molecule_sets[i]
                for j in range(i + 1, n):
                    set2 = molecule_sets[j]
                    if distance_type == 'jaccard_weighted' and user_weights:
                        dist = weighted_jaccard_distance(user_weights, set1, set2)
                    elif distance_type == "jaccard_plain":
                        dist = jaccard_distance(set1, set2)
                    elif distance_type == "overlap_weighted":
                        dist = weighted_overlap_coef(user_weights, set1, set2)
                    elif distance_type == "overlap_plain":
                        dist = overlap_coef(set1, set2)
                    else:
                        raise ValueError(f"Unknown distance_type: {distance_type}")
                    scaled_dist = rescale_distance(dist)
                    distance_matrix[i, j] = scaled_dist
                    distance_matrix[j, i] = scaled_dist
            if i % 50 == 0:
                print(f"{i}/{n}")

        reducer = get_reducer(settings)
        print("applying reducer...")

        # Safe reducer
        try:
            embedding = reducer.fit_transform(distance_matrix)
        except Exception as e:
            raise ValueError(f"Dimensionality reduction failed: {str(e)}")

        if embedding is None or len(embedding) < 4:
            raise ValueError("Reducer returned too few points. Please check your settings.")

        # Make Data Frame for website display with the embedding results
        embedding_df = pd.DataFrame(embedding, columns=['X', 'Y'])
        embedding_df['qValue'] = df['qValue'].values
        embedding_df['pValue'] = df['pValue'].values
        embedding_df['setName'] = df['Name'].values
        embedding_df['setSize'] = numberOfEnrichedMolecules
        embedding_df['molecules'] = df['Molecules'].values

        embedding_df = embedding_df.sort_values(by='qValue', ascending=False)
        embedding_df_json = embedding_df.to_json(orient='records')
        return embedding_df_json, distance_matrix

    except Exception as e:
        raise e


def calculate_distance_matrix(sigif_gene_sets, distance_type, user_weights):
    n = len(sigif_gene_sets)

    molecule_sets = [set(gene_string.split()) for _, (gene_string, _, _) in sigif_gene_sets.items()]

    print("Computing new distance matrix.")
    distance_matrix = np.zeros((n, n))
    for i in range(n):
        set1 = molecule_sets[i]
        for j in range(i + 1, n):
            set2 = molecule_sets[j]
            if distance_type == 'jaccard_weighted' and user_weights:
                dist = weighted_jaccard_distance(user_weights, set1, set2)
            elif distance_type == "jaccard_plain":
                dist = jaccard_distance(set1, set2)
            elif distance_type == "overlap_weighted":
                dist = weighted_overlap_coef(user_weights, set1, set2)
            elif distance_type == "overlap_plain":
                dist = overlap_coef(set1, set2)
            else:
                raise ValueError(f"Unknown distance_type: {distance_type}")
            scaled_dist = rescale_distance(dist)
            distance_matrix[i, j] = scaled_dist
            distance_matrix[j, i] = scaled_dist

    if i % 50 == 0:
        print(f"{i}/{n}")

    return distance_matrix
