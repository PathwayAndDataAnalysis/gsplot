import pandas as pd
import umap
import numpy as np
import base64
from io import BytesIO

def jaccard_distance(set1, set2):
    return 1 - (len(set1.intersection(set2)) / len(set1.union(set2)))

def umap_reduction(fileData, neighbors, minDistance, seed):
    try:
        format, tsvData = fileData.split(';base64,') 
        file_content = base64.b64decode(tsvData)

        tsvFile = BytesIO(file_content)

        df = pd.read_csv(tsvFile, sep='\t', header=0)
        n = df.shape[0]

        distance_matrix = np.zeros((n, n))

        numberOfEnrichedMolecules = []

        for i in range(n):
            set1 = set(df.loc[i, "Enriched Molecules"].split())
            numberOfEnrichedMolecules.append(len(set1))
            for j in range (i + 1, n):
                set2 = set(df.loc[j, "Enriched Molecules"].split())
                dist = jaccard_distance(set1, set2)
                distance_matrix[i, j] = dist
                distance_matrix[j, i] = dist

        seed = int(seed) 
        if seed == 0:
            seed = None
        
        reducer = umap.UMAP(metric='precomputed', n_neighbors=int(neighbors), random_state=seed, min_dist=float(minDistance))
        
        

        embedding = reducer.fit_transform(distance_matrix)

        # Make Data Frame for website display with the embedding results
        embedding_df = pd.DataFrame(embedding, columns=['X', 'Y'])
        embedding_df['qValue'] = df['Q Value'].values
        embedding_df['setName'] = df['Set Name'].values
        embedding_df['setSize'] = numberOfEnrichedMolecules
        embedding_df['molecules'] = df['Enriched Molecules'].values
        
        # Sort entries by descending order of qValue so if two points overlap, the point with the more significant q value appears on top
        embedding_df = embedding_df.sort_values(by='qValue', ascending=False)

        embedding_df_json = embedding_df.to_json(orient='records')

        # Save the JSON to a file or pass it to your frontend
        return embedding_df_json
    except Exception as e:
        raise e
    