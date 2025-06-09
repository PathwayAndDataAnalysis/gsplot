window.GSP = window.GSP || {};

function submitSelectedGeneSets() {
    const selectedGeneSets = window.GSP.selectedGeneSets || [];
    const minInput = document.getElementById("min-member-input");
    const minMembers = minInput ? Number(minInputvalue) : 3;

    if (selectedGeneSets.length === 0) {
        alert("Please select at least one category of gene sets from the tree.");
        return;
    }
    if (userGenesInput.length === 0) {
        alert("Gene list is empty. Please enter or provide two lists of gene sets.")
    }

    fetch("/api/filter_gene_sets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            selectedGeneSets: selectedGeneSets,
            userGenes: userGenesInput,
            minMembers: minMembers
        })
    })
        .then(res => {
            if (!res.ok) throw new Error("Failed to fetch filtered gene sets");
            return res.json();
        })
        .then(filteredResults => {
            console.log("Filtered gene sets:", filteredResults);
            renderFilteredGeneSets(filteredResults); // Render to UI
        })
        .catch(err => {
            console.error("Error submitting gene sets:", err);
            alert("Error submitting gene sets. Check console for details.");
        });
}

function renderFilteredGeneSets(geneSets) {
    const container = document.getElementById("filtered-results");
    if (!container) return;
    container.innerHTML = ""; // Clear old results
    if (geneSets.length === 0) {
        container.textContent = "No matching gene sets found.";
        return;
    }
    const list = document.createElement("ul");
    geneSets.forEach(set => {
        const item = document.createElement("li");
        item.innerHTML = `<strong>${set.gene_set_name}</strong> 
      (${set.matched_count} matched / ${set.total_genes_in_set} total): 
      <code>${set.matched_genes.join(", ")}</code>`;
        list.appendChild(item);
    });
    container.appendChild(list);
}
