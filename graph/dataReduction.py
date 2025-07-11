import math

import pandas as pd
import umap.umap_ as umap
import numpy as np
import base64
from io import BytesIO
from scipy.stats import fisher_exact
from statsmodels.stats.multitest import multipletests
from scipy.stats import norm

from sklearn.manifold import Isomap, TSNE


#python manage.py runserver
#python manage.py migrate


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

def build_weights_from_ranked_list(ranked_genes):
    """
    ranked_genes: list of gene names in order from highest to lowest rank
    Returns: dict {gene: normalized_rank}
    """
    n = len(ranked_genes)
    user_weights = {}
    for i, gene in enumerate(ranked_genes):
        norm_rank = (i + 1 - 0.5) / n
        user_weights[gene.strip()] = norm_rank
    return user_weights

def build_weights_from_sets(sig_genes, insig_genes):
    """
    sig_genes: list of sig genes in ranked order (high to low)
    insig_genes: list of insig genes (no rank needed, all = 0)
    Returns: dict {gene: normalized_rank}
    """
    user_weights = {}
    n = len(sig_genes)

    # Assign normalized rank to sig_genes
    for i, gene in enumerate(sig_genes):
        norm_rank = (i + 1 - 0.5) / n
        user_weights[gene.strip()] = norm_rank
    # Assign 0 to insig genes if not already in sig
    for gene in insig_genes:
        gene = gene.strip()
        user_weights.setdefault(gene, 0.0)

    return user_weights

def get_vals(gene_sets_for_umap,reject_count,total,p_val,fdr):
    sorted_items = sorted(gene_sets_for_umap.items(), key=lambda item: item[1][1])
    p_vals = np.array([item[1][1] for item in sorted_items])  # Get just the p-values
    if (fdr): # Get Estimate of P-Value
        reject, q_values, _, _ = multipletests(p_vals, method='fdr_bh', alpha=fdr)
        if not (reject.any()):
            print("No p-values passed the FDR threshold.")
            gene_sets_for_umap = {}  # Or keep as is
            return
        threshold_index = np.where(reject)[0].max()
        p_val = p_vals[threshold_index]

        print(f"pval_threshold @ {threshold_index} w val {p_val}")

    else:
        # Get Estimate of FDR
        if reject_count <= 0:  # number of p values under threshold
            print("no values are under the threshold")
            return

        fdr = (p_val * total) / reject_count
        print(f"Estimated FDR at threshold {p_val}: {fdr:.4f}")

        # find threshold_index
        threshold_index = max((i for i, (_, val) in enumerate(sorted_items) if val[1] <= p_val), default=-1)
    filtered_gene_sets = {}
    for i in range(threshold_index + 1):
        set_name, (gene_string, p_raw) = sorted_items[i]
        q_val = q_values[i]
        filtered_gene_sets[set_name] = (gene_string, p_raw, float(q_val))

    return filtered_gene_sets,p_val,fdr

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

    if min_size == 0:
        return 1.0

    raw_dist = 1 - (len(common) / min_size)
    dist = max(0.0, min(1.0, raw_dist))  # Clamp to [0,1]
    return dist

# Weighted overlapping coefficient distance 
def weighted_overlap_coef(user_weights, set1, set2):
    if not set1 or not set2:
        raise ValueError("One of the sets is empty in overlap coefficient calc.")

    common = set1.intersection(set2)
    sum_common = sum(user_weights.get(gene, 0.0) for gene in common)
    sum1 = sum(user_weights.get(gene, 0.0) for gene in set1)
    sum2 = sum(user_weights.get(gene, 0.0) for gene in set2)
    min_sum = min(sum1, sum2)

    if min_sum == 0:
        return 1.0

    raw_dist = 1 - (sum_common / min_sum)
    dist = max(0.0, min(1.0, raw_dist)) # Clamp to [0, 1]
    return dist

def run_fishers_test(filtered_genes,p_val,fdr,sig_genes, insig_genes):
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
        if not fdr and p_value <= p_val:
            reject_count += 1

    filtered_gene_sets,p_val,fdr = get_vals(gene_sets_for_umap,reject_count,total,p_val,fdr)

    return filtered_gene_sets,p_val,fdr

def calculate_pvals(filtered,p_thr,fdr_thr,ranked_genes):
    n = len(ranked_genes)
    ranks = dict()
    gene_sets_for_umap = {}
    reject_count = 0
    for i in range(n):
        rank = i + 1
        gene = ranked_genes[i]
        norm_rank = (rank-0.5)/n
        ranks[gene] = norm_rank
    total = len(filtered)
    for geneset in filtered:
        gene_set = geneset['matched_genes']
        set_name = geneset['gene_set_name']

        gene_n = len(gene_set)
        total_w = 0
        for gene in gene_set:
            total_w += ranks[gene]
        geneset_mw = total_w/gene_n
        sd = math.sqrt(((n + 1) * (n - gene_n)) / (12 * (n**2) * gene_n))
        # Calculate CDF for a normal distribution with mean 76 and std dev 2.5 at x = 80
        p_value = norm.cdf(geneset_mw, loc=0.5, scale=sd)

        gene_string = ' '.join(str(gene) for gene in gene_set)
        gene_sets_for_umap[set_name] = (gene_string, p_value)
        if not fdr_thr and p_value <= p_thr:
            reject_count += 1

    print(reject_count)
    vals = get_vals(gene_sets_for_umap, reject_count, total, p_thr, fdr_thr)
    if vals is None:
        return None
    filtered_gene_sets, p_val, fdr = vals

    return filtered_gene_sets, p_val, fdr

def umap_reduction(fileDataOrString, settings, user_weights , distance_type, distances):
    # Check if use weighted option without weights
    if (distance_type in ['jaccard_weighted', 'overlap_weighted']) and user_weights is None:
        raise ValueError("user_weights must be provided when using weighted option.")
    try:
        # Check if input looks like a base64-encoded file
        if ';base64,' in fileDataOrString:
            # --- FILE MODE ---
            format, tsvData = fileDataOrString.split(';base64,')
            file_content = base64.b64decode(tsvData)
            tsvFile = BytesIO(file_content)
            df = pd.read_csv(tsvFile, sep="\t")  # assumes TSV
        else:
            # --- RAW STRING MODE ---
            all_rows = []
            for set_name, (gene_string, p_raw, q_val) in fileDataOrString.items():
                all_rows.append({
                    "Name": set_name,
                    "pValue": p_raw,
                    "qValue": q_val,
                    "Molecules": gene_string.strip()
                })

            df = pd.DataFrame(all_rows)


        n = df.shape[0]

        distance_matrix = np.zeros((n, n))

        molecule_sets = [set(df.loc[i, "Molecules"].split()) for i in range(n)]

        # Always compute number of enriched molecules, regardless of distances['use']
        numberOfEnrichedMolecules = [len(mol_set) for mol_set in molecule_sets]

        print(n)

        if distances['use'] and len(distances["m"]) == n:
            print("Using cached distances.")
            distance_matrix = np.array(distances["m"])
        else:
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
                    distance_matrix[i, j] = dist
                    distance_matrix[j, i] = dist
            if i % 50 == 0:
                print(f"{i}/{n}")

        if (distances['use']):
            distance_matrix = np.array(distances["m"])

        reducer = get_reducer(settings)
        print("applying reducer...")
        embedding = reducer.fit_transform(distance_matrix)

        # Make Data Frame for website display with the embedding results
        embedding_df = pd.DataFrame(embedding, columns=['X', 'Y'])
        embedding_df['qValue'] = df['qValue'].values
        embedding_df['pValue'] = df['pValue'].values
        embedding_df['setName'] = df['Name'].values
        embedding_df['setSize'] = numberOfEnrichedMolecules
        embedding_df['molecules'] = df['Molecules'].values

        # Sort entries by descending order of qValue so if two points overlap, the point with the more significant q value appears on top
        embedding_df = embedding_df.sort_values(by='qValue', ascending=False)
        embedding_df_json = embedding_df.to_json(orient='records')


        # Save the JSON to a file or pass it to your frontend
        return embedding_df_json, distance_matrix
    except Exception as e:
        raise e