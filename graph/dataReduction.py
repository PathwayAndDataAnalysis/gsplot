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



def run_fishers_test(filtered_genes,p_val,fdr,sig_genes, insig_genes):
    sig_set = set(sig_genes)
    insig_set = set(insig_genes)

    reject_count = 0
    total = 0
    fdr_val = False

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

    # Optional: overwrite or use elsewhere
    gene_sets_for_umap = filtered_gene_sets

    # round the variables to 3rd decimal point
    p_val = round(p_val, 3)
    fdr = round(fdr, 3)

    ret = umap_reduction(gene_sets_for_umap, "2", "0.1", "0")
    return ret,p_val,fdr



def umap_reduction(fileDataOrString, neighbors, minDistance, seed):
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

        for i in range(n):
            set1 = set(df.loc[i, "Molecules"].split())
            numberOfEnrichedMolecules.append(len(set1))
            for j in range (i + 1, n):
                set2 = set(df.loc[j, "Molecules"].split())
                dist = jaccard_distance(set1, set2)
                distance_matrix[i, j] = dist
                distance_matrix[j, i] = dist

        seed = int(seed)
        if seed == 0:
            seed = None

        n_rows = df.shape[0]
        neighbors = int(neighbors)

        reducer = umap.UMAP(metric='precomputed', n_neighbors=int(neighbors), random_state=seed, min_dist=float(minDistance))


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