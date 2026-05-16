/*
This file handles displaying the data of the seleced molecules as a table below the graph
*/

// Get needed refrences to table container and iframe
let allTablesContainer = document.getElementById("selected-points-container");
let iframe = document.getElementById("graph").contentWindow;

main();

// Entry point
function main() {
  // Call the function initially to load any already selected points from local storage
  updateContent();
}

// Find the intersection of all selected points and display them on screen
function updateContent() {
  // Get selected items
  let selecteditems = localStorage.getItem("selected");
  let showSigOnly = document.getElementById("show-sig-only")?.checked;
  const showEnrichmentOrder = document.getElementById("show-enrichment-order")?.checked;


  // If nothing is selected then set empty list into local storage
  if (selecteditems !== null) {
    selecteditems = JSON.parse(selecteditems);
  } else {
    selecteditems = [];
    localStorage.setItem("selected", JSON.stringify(selecteditems));
  }

  let intersection = new Set();

  // Clear table
  allTablesContainer.innerHTML = "";

  if (selecteditems.length === 0) {
    displayPlaceholder();
    return;
  }

  // Compare all sets in selected items and find the shared molecules
  for (let i = 0; i < selecteditems.length; i++) {
    let set1 = new Set(selecteditems[i]["molecules"].split(" "));
    for (let j = i + 1; j < selecteditems.length; j++) {
      let set2 = new Set(selecteditems[j]["molecules"].split(" "));
      intersection = findIntersection(set1, set2, intersection);
    }
  }

  // Display sets with the molecules in the intersection bolded
  for (let i = 0; i < selecteditems.length; i++) {
    tableCreator(selecteditems[i], intersection, showSigOnly, showEnrichmentOrder);
  }
}

// Listen for changes in local storage and update content accordingly
window.addEventListener("storage", function (e) {
  if (e.key === "selected") {
    updateContent();
  }
});

// Generate HTML table object of molecules
function tableCreator(selectedPoint, intersection, displayGenesToggleOn, showEnrichmentOrder) {
  // Create table container div and table inside of it
  const tableContainer = document.createElement("div");
  tableContainer.classList.add("table-container");
  const table = document.createElement("table");

  // Create header for whole table - creates that first row that has the name of gene set
  const tableHeader = document.createElement("thead");
  const firstRow = document.createElement("tr");
  const setName = document.createElement("th");
  setName.colSpan = 2;
  setName.textContent = selectedPoint["setName"]; // Apply set name
  firstRow.appendChild(setName);
  tableHeader.appendChild(firstRow);
  table.appendChild(tableHeader);

  // tableBody has the rows of the data
  const tableBody = document.createElement("tbody");

  // Create second row in table containing the p-value
  const secondRow = document.createElement("tr");
  const pValueHeader = document.createElement("th");
  pValueHeader.textContent = "P-Value";
  const pValue = document.createElement("td");
  pValue.textContent = selectedPoint["pValue"];
  secondRow.appendChild(pValueHeader);
  secondRow.appendChild(pValue);
  tableBody.appendChild(secondRow);

  // Create third row in table containing the q-value
  const thirdRow = document.createElement("tr");
  const qValueHeader = document.createElement("th");
  qValueHeader.textContent = "Q-Value";
  const qValue = document.createElement("td");
  qValue.textContent = selectedPoint["qValue"];
  thirdRow.appendChild(qValueHeader);
  thirdRow.appendChild(qValue);
  tableBody.appendChild(thirdRow);

  // Create fourth row showing enrichment direction
  const fourthRow = document.createElement("tr");
  const directionHeader = document.createElement("th");
  directionHeader.textContent = "Enrichment";
  const directionValue = document.createElement("td");
  const direction = selectedPoint["direction"] || "neutral";
  directionValue.textContent = direction.charAt(0).toUpperCase() + direction.slice(1);
  fourthRow.appendChild(directionHeader);
  fourthRow.appendChild(directionValue);
  tableBody.appendChild(fourthRow);

  // Creates molecules row
  const moleculesRow = document.createElement("tr");
  const moleculesHeader = document.createElement("th");
  moleculesHeader.textContent = "Molecules";
  const molecules = document.createElement("td");
  const displayMode = selectedPoint["displayMode"] || "thresholded";
  let sourceMolecules = selectedPoint["molecules"] || "";

  if (displayMode === "ranked") {
    sourceMolecules = displayGenesToggleOn
      ? (selectedPoint["displayMolecules"] || selectedPoint["molecules"] || "")
      : (selectedPoint["molecules"] || "");
  } else if (displayMode === "scored") {
    if (displayGenesToggleOn) {
      sourceMolecules = showEnrichmentOrder
        ? (selectedPoint["leadingEdgeOrderedMolecules"] || selectedPoint["leadingEdgeDefaultMolecules"] || "")
        : (selectedPoint["leadingEdgeDefaultMolecules"] || "");
    } else {
      sourceMolecules = showEnrichmentOrder
        ? (selectedPoint["orderedFullMolecules"] || selectedPoint["molecules"] || "")
        : (selectedPoint["molecules"] || "");
    }
  }

  let moleculeList = sourceMolecules.split(" ").filter(Boolean);

  if (displayGenesToggleOn && displayMode === "thresholded") {
    const sigGenes = selectedPoint["sigGenes"] || [];
    moleculeList = moleculeList.filter(g => sigGenes.includes(g));
  }

  molecules.innerHTML = boldSharedGenes(
    moleculeList.join(" "),
    intersection
  );
  moleculesRow.appendChild(moleculesHeader);
  moleculesRow.appendChild(molecules);
  tableBody.appendChild(moleculesRow);

  // Append table body to table, then table to table container, then table container to all table contianer
  table.appendChild(tableBody);
  tableContainer.appendChild(table);
  allTablesContainer.appendChild(tableContainer);

  // Debug
  console.log("Selected Point:", selectedPoint);
  console.log("Intersection:", intersection);
  console.log("DisplayGenesToggleOn:", displayGenesToggleOn);
  console.log("sigGenes in point:", selectedPoint["sigGenes"]);
}

function displayPlaceholder() {
  const placeholder = document.createElement("p");
  placeholder.textContent = "Please select a point above by clicking it.";
  allTablesContainer.appendChild(placeholder);
}

// Apply bolding to molecules via HTML
function boldSharedGenes(molecules, intersection) {
  // Break up string with whitespace
  let moleculeList = molecules.split(" ");

  // Loop through molecules, if gene in intersection apply bolding to it
  for (let i = 0; i < moleculeList.length; i++) {
    if (intersection.has(moleculeList[i])) {
      moleculeList[i] = "<b>" + moleculeList[i] + "</b>";
    }
  }

  // Return a string of list joined by spaces
  return moleculeList.join(" ");
}

// Loop through one of the sets and check to see if the other set has the same gene
function findIntersection(set1, set2, intersection) {
  for (let i of set1) {
    if (set2.has(i)) {
      intersection.add(i);
    }
  }

  return intersection;
}

// Below functions are just wrapper functions to call iframe functions for on screen buttons.

function clearSelected() {
  iframe.clearSelected();
}

function toggleLabels() {
  iframe.toggleLabels();
}

const sigToggle = document.getElementById("show-sig-only");
if (sigToggle) {
  sigToggle.addEventListener("change", updateContent);
}

const enrichmentOrderToggle = document.getElementById("show-enrichment-order");
if (enrichmentOrderToggle) {
  enrichmentOrderToggle.addEventListener("change", updateContent);
}
