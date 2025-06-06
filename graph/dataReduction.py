import pandas as pd
import umap.umap_ as umap
import numpy as np
import base64
from io import BytesIO

# calculate how different two sets are
# if two sets are exactly the same, the result = 0
# if they have no overlap, the result = 1
# It's used to calculate the distance between gene sets based on the molecules they contain.
def jaccard_distance(set1, set2):
    return 1 - (len(set1.intersection(set2)) / len(set1.union(set2)))

# reduces complex TSV data into 2D coordinates for visualization using UMAP
def umap_reduction(fileData, neighbors, minDistance, seed):
    try:
        # Takes a base64-encoded .tsv file, decodes it, and prepares it like a file object so pandas can read it.
        format, tsvData = fileData.split(';base64,') 
        file_content = base64.b64decode(tsvData)

        tsvFile = BytesIO(file_content)

        # Reads the TSV file into a DataFrame.
        # n is the number of rows (gene sets).
        df = pd.read_csv(tsvFile, sep='\t', header=0)
        n = df.shape[0]

        distance_matrix = np.zeros((n, n))  # Initializes a square matrix n x n for storing Jaccard distances.

        numberOfEnrichedMolecules = []      # will store the size of each molecule set.

        # For every pair of rows, compute how different their "Molecules" lists are using Jaccard.
        for i in range(n):
            set1 = set(df.loc[i, "Molecules"].split())
            numberOfEnrichedMolecules.append(len(set1))
            for j in range (i + 1, n):
                set2 = set(df.loc[j, "Molecules"].split())
                dist = jaccard_distance(set1, set2)

                # Fill that into the matrix.
                distance_matrix[i, j] = dist
                distance_matrix[j, i] = dist

        # Converts seed to int or sets it to None if it's 0 (for random behavior).
        seed = int(seed) 
        if seed == 0:
            seed = None
        
        # Runs UMAP on the distance matrix to reduce it from n x n to just 2D coordinates.
        reducer = umap.UMAP(metric='precomputed', n_neighbors=int(neighbors), random_state=seed, min_dist=float(minDistance))
        
        # Output: embedding — each row is (X, Y) for a gene set.
        embedding = reducer.fit_transform(distance_matrix)

        # Make Data Frame for website display with the embedding results
        # Adds back info like gene set name, value (e.g., p-value), and molecule list.
        embedding_df = pd.DataFrame(embedding, columns=['X', 'Y'])
        embedding_df['qValue'] = df['Value'].values
        embedding_df['setName'] = df['Name'].values
        embedding_df['setSize'] = numberOfEnrichedMolecules
        embedding_df['molecules'] = df['Molecules'].values
        
        # Sort entries by descending order of qValue so if two points overlap, the point with the more significant q value appears on top
        embedding_df = embedding_df.sort_values(by='qValue', ascending=False)

        embedding_df_json = embedding_df.to_json(orient='records')  # Converts to JSON format for frontend to consume.

        # Save the JSON to a file or pass it to your frontend
        return embedding_df_json
    except Exception as e:
        raise e
    