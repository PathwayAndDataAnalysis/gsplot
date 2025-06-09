import pandas as pd
import umap.umap_ as umap
import numpy as np
import base64
from io import BytesIO
from scipy.stats import fisher_exact

#python manage.py runserver
#python manage.py migrate

#Ex gene sets for testing
gene_sets = {
    'Pathway_A': {'ABCA1','ABCB8','ACAA2','ACADL','ACADM','ACADS','ACLY','ACO2',"ACOX1",'ADCY6','ADIG','ADIPOQ','ADIPOR2','AGPAT3','GPAT4','AIFM1','AK2','ALDH2','ALDOA','ANGPT1','ANGPTL4','SOWAHC','APLP2','APOE','ARAF','ARL4A','ATL2','ATP1B3','ATP5PO','BAZ2A','BCKDHA','BCL2L13','BCL6','C3',"CAT",'CCNG2','CD151','CD302','CD36','CDKN2C','CHCHD10','CHUK','CIDEA','CMBL','CMPK1','COL15A1','COL4A1','COQ3','COQ5','COQ9','COX6A1','COX7B','COX8A','CPT2','CRAT','CS','CYC1','CYP4B1','DBT','DDT','DECR1','DGAT1','DHCR7','DHRS7','DHRS7B','DLAT','DLD','DNAJB9','DNAJC15','DRAM2','ECH1','ECHS1','ELMOD3','ELOVL6','ENPP2','EPHX2','ESRRA','ESYT1','ETFB','FABP4','FAH','MIGA2','RMDN3','FZD4','G3BP2','GADD45A','GBE1','GHITM','GPAM','GPD2','GPHN','GPX3','GPX4','GRPEL1','HADH','HIBCH','HSPB8','IDH1','IDH3A','IDH3G','IFNGR1','IMMT','ITGA7','ITIH5','ITSN1','JAGN1','LAMA4','LEP','LIFR','LIPE','LPCAT3','LPL','LTC4S','MAP4K3','MCCC1','MDH2','ME1','MGLL','MGST3','MTARC2','MRAP','MRPL15','MTCH2','MYLK','NDUFA5','NDUFAB1','NDUFB7','NDUFS3','NKIRAS1','NMT1','NABP1','OMD','ORM1','PDCD4','PEMT','PEX14','PFKFB3','PFKL','PGM1','PHLDB1','PHYH','PIM3','PLIN2','POR','PPARG','PPM1B','PPP1R15B','SLC66A3','PRDX3','PREB','PTCD3','PTGER3','CAVIN1','QDPR','RAB34','REEP5','REEP6','RETN','RETSAT','RIOK3','RNF11','RREB1','RTN3','SAMM50','SCARB1','SCP2','SDHB','SDHC','CAVIN2','SLC19A1','SLC1A5','SLC25A1','SLC25A10','SLC27A1','SLC5A6','SNCG','SOD1','SORBS1','SPARCL1','SQOR','SSPN','STAT5A','STOM','SUCLG1','SULT1A1','TALDO1','TANK','TKT','TOB1','TST','UBC','UBQLN1','UCK1','UCP2','UQCR10','UQCR11','UQCRC1','UQCRQ','VEGFB','YWHAG'},
    'Pathway_B': {'BTRC', 'PSEN1', 'APC', 'HNF1A', 'CTNNB1', 'CTNNB1', 'APC', 'APC', 'GSK3B', 'BTRC', 'CTNNB1', 'GSK3B','ADAM17', 'AXIN1', 'FZD1', 'BTRC', 'DVL1', 'RBPJ', 'WNT1', 'DLL1', 'PSEN1', 'RBPJ', 'NOTCH1', 'BTRC','AXIN1', 'RBPJ', 'RBPJ'},
    'Pathway_C': {'NFATC1', 'FOS', 'IFNG', 'IL2RA', 'CSF2', 'IL4', 'JUN', 'IL3', 'POU2F1', 'FOSL1', 'PPP3CB', 'JUNB', 'PRKACA','AKAP5', 'CD40LG', 'PTGS2', 'FASLG', 'RCAN1', 'IL2', 'FKBP1A', 'PPP3R1', 'PPP3CA', 'NFATC3', 'NFATC2', 'RCAN2','CHP1', 'BATF3', 'CABIN1'},
    'Pathway_D': {'DLD', 'OGDH', 'DLST', 'MRPS36', 'GCSH', 'AMT', 'GLDC', 'MRPS36'},
    'Pathway_E': {'PHKA2', 'GYG2', 'PHKA1', 'PYGM', 'PGM1', 'PYGL', 'PYGB', 'PHKB', 'PHKG2', 'AGL', 'GYG1', 'PHKG1', 'GAA', 'CALM1'},
    'Pathway_F': {'PHKA2', 'GYG2', 'PHKA1', 'PYGM', 'PGM1', 'PYGL', 'PYGB', 'PHKB', 'GYS1', 'GYS2', 'EPM2A', 'GBE1', 'PPP1R3C', 'RPS27A', 'UBC', 'PHKG2', 'AGL', 'GYG1', 'PHKG1', 'UGP2', 'UBB', 'GAA', 'NHLRC1', 'CALM1', 'UBA52'},
    'Pathway_G': {'GYG2', 'GYS1', 'GYS2', 'EPM2A', 'GBE1', 'PPP1R3C', 'G6PC1', 'G6PC3', 'RPS27A', 'UBC', 'GYG1', 'UBB', 'GAA', 'NHLRC1', 'UBA52', 'SLC37A4'},
    'Pathway_H': {'GYG2', 'PGM1', 'GYS1', 'GYS2', 'EPM2A', 'GBE1', 'PPP1R3C', 'RPS27A', 'UBC', 'GYG1', 'UGP2', 'UBB', 'NHLRC1', 'UBA52'}

}


# calculate how different two sets are
# if two sets are exactly the same, the result = 0
# if they have no overlap, the result = 1
# It's used to calculate the distance between gene sets based on the molecules they contain.
def jaccard_distance(set1, set2):
    return 1 - (len(set1.intersection(set2)) / len(set1.union(set2)))



def run_fishers_test(sig_genes, insig_genes):
    sig_set = set(sig_genes)
    insig_set = set(insig_genes)

    # Define total gene universe (all genes in your gene sets)
    # Dictionary of only the relevant gene sets (that share genes with input)
    input_genes = sig_set.union(insig_set)
    filtered_gene_sets = {
        set_name: geneset
        for set_name, geneset in gene_sets.items()
        if input_genes.intersection(geneset)
    }

    # Build the universe of genes from just the matching gene sets + user input
    universe_genes = set().union(*filtered_gene_sets.values(), sig_genes, insig_genes)
    N = len(universe_genes)

    gene_sets_for_umap = {}

    for set_name, geneset in filtered_gene_sets.items():
        geneset = set(geneset)

        a = len(sig_set & geneset)    # sig & in gene set
        b = len(sig_set) - a          # sig & not in gene set
        c = len(insig_set & geneset)  # insig & in gene set
        d = len(insig_set) - c        # insig & not gene set

        table = [[a, b], [c, d]]

        _, p_value = fisher_exact(table, alternative='greater')
        score = 1 - p_value

        gene_string = ' '.join(str(gene) for gene in geneset)
        gene_sets_for_umap[set_name] = (gene_string, score)

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