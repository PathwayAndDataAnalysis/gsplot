import pandas as pd
import umap.umap_ as umap
import numpy as np
import base64
from io import BytesIO
from scipy.stats import fisher_exact

#python manage.py runserver
#python manage.py migrate


# calculate how different two sets are
# if two sets are exactly the same, the result = 0
# if they have no overlap, the result = 1
# It's used to calculate the distance between gene sets based on the molecules they contain.
def jaccard_distance(set1, set2):
    return 1 - (len(set1.intersection(set2)) / len(set1.union(set2)))



def run_fishers_test(filtered_genes,p_val,sig_genes, insig_genes):
    sig_set = set(sig_genes)
    insig_set = set(insig_genes)


    gene_sets_for_umap = {}

    for geneset in filtered_genes:
        gene_set = set(geneset['matched_genes'])
        set_name = geneset['gene_set_name']

        a = len(sig_set & gene_set)    # sig & in gene set
        b = len(sig_set) - a          # sig & not in gene set
        c = len(insig_set & gene_set)  # insig & in gene set
        d = len(insig_set) - c        # insig & not gene set

        table = [[a, b], [c, d]]

        _, p_value = fisher_exact(table, alternative='greater')

        gene_string = ' '.join(str(gene) for gene in gene_set)
        gene_sets_for_umap[set_name] = (gene_string, p_value)


    ret = umap_reduction(gene_sets_for_umap, "2", "0.1", "0")

    return ret



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