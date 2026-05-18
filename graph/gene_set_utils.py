def get_selected_gene_sets_with_relevant_members(
    gene_list: list[str],
    min_members_threshold: int,
    selected_gene_sets: list[dict],
    gene_sets_data: dict
) -> list[dict]:
    result = []

    for gene_set_entry in selected_gene_sets:
        name = gene_set_entry["name"]
        collection = gene_set_entry["collection"]

        gene_set_info = gene_sets_data.get(name)
        if not gene_set_info:
            continue

        if gene_set_info.get("collection") != collection:
            continue

        gene_symbols = gene_set_info.get("geneSymbols", [])
        gene_symbols_set = set(gene_symbols) 

        matched = []
        for gene in gene_list:
            if gene in gene_symbols_set:     
                matched.append(gene)

        if len(matched) >= min_members_threshold:
            result.append({
                "gene_set_name": name,
                "matched_genes": matched,
                "matched_count": len(matched),
                "total_genes_in_set": len(gene_symbols),
                "collection": collection
            })

    return result


def build_gene_universe_from_selected_gene_sets(
    selected_gene_sets: list[dict],
    gene_sets_data: dict,
) -> set[str]:
    universe = set()

    for gene_set_entry in selected_gene_sets:
        name = gene_set_entry["name"]
        collection = gene_set_entry["collection"]

        gene_set_info = gene_sets_data.get(name)
        if not gene_set_info:
            continue

        if gene_set_info.get("collection") != collection:
            continue

        for gene in gene_set_info.get("geneSymbols", []):
            universe.add(gene)

    return universe
