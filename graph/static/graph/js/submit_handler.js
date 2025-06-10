window.GSP = window.GSP || {};

function submitGenes() {
  const sigRaw = document.getElementById("id_significant_genes").value;
  const insigRaw = document.getElementById("id_insignificant_genes").value;

  const sigGenes = sigRaw.split(/[\n,]+/).map(g => g.trim()).filter(g => g);
  const insigGenes = insigRaw.split(/[\n,]+/).map(g => g.trim()).filter(g => g);

  window.GSP.userGenes = [...new Set([...sigGenes, ...insigGenes])];
  localStorage.setItem("userGenes", JSON.stringify(window.GSP.userGenes));

  console.log("Saved genes to window.GSP.userGenes:", window.GSP.userGenes);
  alert("Gene input saved. You can now select gene sets and submit.");
}

function submitSelectedGeneSets() {
  const selectedGeneSets = window.GSP.selectedGeneSets || [];
  let userGenesInput = window.GSP.userGenes;
  if (!userGenesInput || userGenesInput.length === 0) {
    const fromStorage = localStorage.getItem("userGenes");
    userGenesInput = fromStorage ? JSON.parse(fromStorage) : [];
  }

  const minInput = document.getElementById("min-member-input");
  const minMembers = minInput ? Number(minInput.value) : 3;

  if (selectedGeneSets.length === 0) {
    alert("Please select at least one category of gene sets from the tree.");
    return;
  }
  if (userGenesInput.length === 0) {
    alert("Gene list is empty. Please enter or provide two lists of gene sets.");
    return;
  }

  fetch("/api/filter_gene_sets/", {
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
      console.log("Filtered gene sets (hidden):", filteredResults);
      const statusBox = document.getElementById("submit-status");
      statusBox.textContent = `Successfully generated ${filteredResults.length} gene sets.`;
      statusBox.style.color = "green";
    })
    .catch(err => {
      console.error("Error submitting gene sets:", err);
      alert("Error submitting gene sets. Check console for details.");
    });
}

document.addEventListener("DOMContentLoaded", () => {
    const savedGenes = localStorage.getItem("userGenes");
    if (savedGenes) {
        window.GSP.userGenes = JSON.parse(savedGenes);
        console.log("Restored userGenes from localStorage:", window.GSP.userGenes);
    }

    const submitBtn = document.getElementById("submit-gene-button");
    if (submitBtn) {
        submitBtn.addEventListener("click", submitGenes);
    }
});