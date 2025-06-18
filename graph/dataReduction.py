import pandas as pd
import umap.umap_ as umap
import numpy as np
import base64
from io import BytesIO
from scipy.stats import fisher_exact
from statsmodels.stats.multitest import multipletests

#python manage.py runserver
#python manage.py migrate


# calculate how different two sets are
# if two sets are exactly the same, the result = 0
# if they have no overlap, the result = 1
# It's used to calculate the distance between gene sets based on the molecules they contain.
def jaccard_distance(set1, set2):
    return 1 - (len(set1.intersection(set2)) / len(set1.union(set2)))

def weighted_jaccard_distance(user_weights, gene_set):
    numerator = 0.0
    denominator = 0.0
    for gene in set(user_weights.keys()).union(gene_set):
        w_list = user_weights.get(gene, 0.0)
        w_set = 1.0 if gene in gene_set else 0.0
        numerator += min(w_list, w_set)
        denominator += max(w_list, w_set)
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
        user_weights[gene.strip().upper()] = norm_rank
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
        user_weights[gene.strip().upper()] = norm_rank
    # Assign 0 to insig genes if not already in sig
    for gene in insig_genes:
        gene = gene.strip().upper()
        user_weights.setdefault(gene, 0.0)

    return user_weights  



def run_fishers_test(filtered_genes,p_val,fdr,sig_genes, insig_genes):
    sig_set = set(sig_genes)
    insig_set = set(insig_genes)

    reject_count = 0
    total = 0

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

        total += 1

        gene_string = ' '.join(str(gene) for gene in gene_set)
        gene_sets_for_umap[set_name] = (gene_string, p_value)
        if not fdr and p_value <= p_val:
            reject_count += 1

    sorted_items = sorted(gene_sets_for_umap.items(), key=lambda item: item[1][1])
    p_vals = np.array([item[1][1] for item in sorted_items])  # Get just the p-values
    if (fdr): # Get Estimate of P-Value
        reject, q_values, _, _ = multipletests(p_vals, method='fdr_bh')
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
    filtered_gene_sets = dict(list(sorted_items)[:threshold_index + 1])

    # round the variables to 3rd decimal point
    p_val = round(p_val, 5)
    fdr = round(fdr, 5)

    return filtered_gene_sets,p_val,fdr

def calculate_pvals(filtered,p_thr,fdr_thr,ranked_genes):
    # Here calculate p value nd then the fdr similr to wht ws done in fishers exct test. be sure to return similr type to fishers test
    # run similr to the fishers exct test
    print('calculating p_values')


def umap_reduction(fileDataOrString, neighbors, minDistance, seed, user_weights=None, distance_type='weighted'):
    # Check if use weighted Jaccard  without weights
    if distance_type == 'weighted' and user_weights is None:
        raise ValueError("user_weights must be provided when using weighted Jaccard distance.")
    
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
            for set_name, (gene_string, score) in fileDataOrString.items():
                all_rows.append({
                    "Name": set_name,
                    "Value": score,
                    "Molecules": gene_string.strip()
                })

            df = pd.DataFrame(all_rows)


        n = df.shape[0]

        distance_matrix = np.zeros((n, n))

        numberOfEnrichedMolecules = []

        print("distance type:", distance_type)
        print(f"user_weights: {user_weights}")

        for i in range(n):
            set1 = set(df.loc[i, "Molecules"].split())
            numberOfEnrichedMolecules.append(len(set1))
            for j in range (i + 1, n):
                set2 = set(df.loc[j, "Molecules"].split())

                if distance_type == 'weighted' and user_weights:
                    dist_i = weighted_jaccard_distance(user_weights, set1)
                    dist_j = weighted_jaccard_distance(user_weights, set2)
                    dist = (dist_i + dist_j) / 2
                else:
                    dist = jaccard_distance(set1, set2)
                
                distance_matrix[i, j] = dist
                distance_matrix[j, i] = dist

        reducer = umap.UMAP(metric='precomputed', n_neighbors=int(neighbors), random_state=int(seed) if int(seed) != 0 else None, min_dist=float(minDistance))


        embedding = reducer.fit_transform(distance_matrix)

        # Make Data Frame for website display with the embedding results
        embedding_df = pd.DataFrame(embedding, columns=['X', 'Y'])
        embedding_df['qValue'] = df['Value'].values
        embedding_df['setName'] = df['Name'].values
        embedding_df['setSize'] = numberOfEnrichedMolecules
        embedding_df['molecules'] = df['Molecules'].values

        # Sort entries by descending order of qValue so if two points overlap, the point with the more significant q value appears on top
        embedding_df = embedding_df.sort_values(by='qValue', ascending=False)

        embedding_df_json = embedding_df.to_json(orient='records')


        # Save the JSON to a file or pass it to your frontend
        return embedding_df_json
    except Exception as e:
        raise e