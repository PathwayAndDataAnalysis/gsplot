def get_selected_gene_sets_with_relevant_members(
    gene_list: list[str],
    min_members_threshold: int,
    selected_gene_sets: list[dict],
    gene_sets_data: dict
) -> list[dict]:
    result = []

    print("seen gene_set_util")
    for gene_set_entry in selected_gene_sets:
        name = gene_set_entry["name"]
        collection = gene_set_entry["collection"]

        gene_set_info = gene_sets_data.get(name)
        if not gene_set_info:
            continue

        if gene_set_info.get("collection") != collection:
            continue

        gene_symbols = gene_set_info.get("geneSymbols", [])

        matched = []

        for gene in gene_list:
            if gene in gene_symbols:
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
