// Get needed refrences to document objects
const settingsButton = document.querySelector(".settings-button"); // Gear icon in top right
const settingsContainer = document.querySelector(".settings-container"); // Container for settings area
const speciesSelector = document.getElementById("species-selector");
const geneContainer = document.getElementById("manual-gene-input"); // Container for the gene input box
const submitContainer = document.getElementById("submit-section-wrapper");
const graphAndSettingsContainer = document.getElementById(
  "graph-settings-container"
); // Container for Graph and Settings area
const loadingSpinner = document.getElementById("loading-spinner"); // Spinner element
const treeContainer = document.getElementById("tree-container");  // Container for collection tree
//const valsContainer = document.getElementById("graph-text-info");

let currentActiveGeneInputTabId = '';
let hasUnsavedSettings = false;
let settingsNeedApply = false;
let allTablesContainer2 = document.getElementById("selected-points-container");
let parsedScoredGenes = [];
const inputTestModeStorageKeys = {
  "scored-genes": "gene-test-mode-scored",
  "single-textarea": "gene-test-mode-input",
};

const uploadContainer = document.getElementById("upload-container"); // Container for the upload file button
const selectedPoints = document.getElementById("selected-section"); // Container for selected points below graph
const graph = document.getElementById("graph"); // Graph iframe
const importNavButton = document.getElementById("nav-import"); // nav button in top right
const fileInput = document.getElementById("initial-file-input"); // Select file button

const transitionDuration = 300;

// Add this function to check settings
function checkSettingsNeedApply() {
  try {
    return frame.checkSettingsNeedApply();
  } catch (e) {
    console.error("Couldn't check settings:", e);
    return false;
  }
}

// To cler storge for testing purposes
clearLocalStorageExceptSettings()

// Ensure default tab and id
LoadInput();

if (!localStorage.getItem("gene-input-mode")) {
  currentActiveGeneInputTabId = "scored-genes";
  localStorage.setItem("single-list", JSON.stringify(false));
  localStorage.setItem("gene-input-mode", "scored-genes");
}

initializeInputTestModes();

// This becomes a refrence to the iframe once it has loaded
let frame;
graph.onload = () => {
  frame = graph.contentWindow;
  main();
};

// Entry point
async function main() {
  const hasData = localStorage.getItem("data") !== null;

  const sigGenes = (localStorage.getItem("sigGenes") || "").trim();
  const insigGenes = (localStorage.getItem("insigGenes") || "").trim();
  const rankedGenes = (localStorage.getItem("rankedGenes") || "").trim();
  const scoredGenesRaw = (localStorage.getItem("scoredGenesRaw") || "").trim();

  const hasGeneInput =
    sigGenes !== "" ||
    insigGenes !== "" ||
    rankedGenes !== "" ||
    scoredGenesRaw !== "";

  if (hasData && hasGeneInput) {
    loadingSpinner.style.display = "flex";

    clearPoints();

    await frame.main();

    loadingSpinner.style.display = "none";

    hideUpload();
    hideInput();
    showGraph();
  } else {
    showUpload();
    showInput();
    hideGraph();
  }
}

document.querySelectorAll(".settings input, .settings select").forEach((el) => {
  el.addEventListener("change", () => {
    hasUnsavedSettings = true;
    settingsNeedApply = true;
  });
});

// Import file button script
function importFile() {
  // Clear selected points and remove local storage
  localStorage.setItem("selected", "[]");
  localStorage.removeItem("camera");
  localStorage.removeItem("data");
  localStorage.removeItem("annotations");
  localStorage.setItem("reset", JSON.stringify(true));
  clearPoints()
  // Show upload screen
  hideGraph();
  setTimeout(() => {
    LoadInput();
    showUpload();
    showInput();
  }, transitionDuration);
}

// When the user clicks the settings button, add classes to trigger css animation
settingsButton.addEventListener("click", function () {
  settingsContainer.classList.toggle("visible");
  graph.classList.toggle("settings-open");
});

function convertToExpectedFormat(arrayOfObjects) {
  const keys = Object.keys(arrayOfObjects[0]);
  const result = {};
  for (const key of keys) {
    result[key] = arrayOfObjects.map((obj) => obj[key]);
  }
  return result;
}

document.getElementById("submit-gene-button").addEventListener("click", async function (e) {
  const shouldToast = hasUnsavedSettings || checkSettingsNeedApply();
  try {
    if (window.update_settings?.updateSettings) {
      window.update_settings.updateSettings(true);
      hasUnsavedSettings = false;
      settingsNeedApply = false;

      if (shouldToast) {
        const toast = document.getElementById("toast-message");
        if (toast) {
          toast.style.color = "#2ecc71";
          toast.textContent = "New settings automatically applied.";
          toast.style.display = "block";
          setTimeout(() => {
            toast.style.display = "none";
          }, 3000);
        }
      }
    } else {
      console.warn("updateSettings not available yet");
    }
  } catch (error) {
    console.error("Error auto-applying settings:", error);
  }

  const sigGenes = document.getElementById("id_significant_genes").value;
  const insigGenes = document.getElementById("id_insignificant_genes").value;
  const rankedGenes = document.getElementById("id_single_gene_list").value;
  const scoredGenesRaw = localStorage.getItem("scoredGenesRaw") || "";
  const species = document.getElementById("species-select").value;
  const pvThr = document.getElementById("pvalue-input").value;
  const fdrThr = document.getElementById("fdr-input").value;
  const selectedGeneSets = window?.GSP?.selectedGeneSets || [];

  const inputMode = currentActiveGeneInputTabId || localStorage.getItem("gene-input-mode") || "scored-genes";
  const singleList = inputMode === "single-textarea";
  const selectedTestMode = getInputTestMode(inputMode);

  const minInput = document.getElementById("min-member-input");
  let minMembers = 5;
  if (minInput) {
    const raw = minInput.value.trim();
    if (raw !== "" && !isNaN(raw)) {
      const val = Number(raw);
      if (val >= 5) {
        minMembers = val;
      }
    }
  }

  // ==== Validate input ====
  if (pvThr === "" && fdrThr === "") {
    alert("Please enter either a p-value or an FDR threshold in settings.");
    return;
  }

  if (inputMode === "scored-genes") {
    if (!scoredGenesRaw.trim()) {
      alert("Please upload a scored genes .tsv or .txt file.");
      return;
    }
  } else if (inputMode === "two-textareas") {
    if (!sigGenes.trim() && !insigGenes.trim()) {
      alert("Please enter at least one gene in either field.");
      return;
    }
  } else if (inputMode === "single-textarea") {
    if (!rankedGenes.trim()) {
      alert("Please enter ranked genes in the single list.");
      return;
    }
  }

  if (!sigGenes.trim() && !insigGenes.trim() && !rankedGenes.trim() && !scoredGenesRaw.trim()) {
    alert("Please enter at least one gene.");
    return;
  }

  if (selectedGeneSets.length === 0) {
    alert("Please select at least one category of gene sets from the tree.");
    return;
  }

  // Save inputs
  localStorage.setItem("gene-input-mode", inputMode);
  localStorage.setItem("minMembers", minMembers);
  localStorage.setItem("species", species);
  localStorage.setItem("gene-test-mode-current", selectedTestMode);
  localStorage.setItem("gene-test-mode-current-input", inputMode);

  if (inputMode === "scored-genes") {
    localStorage.setItem("scoredGenesRaw", scoredGenesRaw);
    clearInsignificantGenes();
    clearSignificantGenes();
    clearSingleGeneList();
  } else if (singleList) {
    if (rankedGenes !== "") {
      localStorage.setItem("rankedGenes", rankedGenes);
      localStorage.removeItem("scoredGenesRaw");
      clearInsignificantGenes();
      clearSignificantGenes();
    } else {
      alert("Please enter genes");
      return;
    }
  } else {
    localStorage.setItem("sigGenes", sigGenes.trim());
    localStorage.setItem("insigGenes", insigGenes.trim());
    localStorage.removeItem("scoredGenesRaw");
  }

  if (species === "custom") {
    const customData = window?.GSP?.customGeneSets?.data || window?.GSP?.customGeneSets;
    if (!customData || typeof customData !== "object") {
      alert("Custom data missing. Please reupload your JSON file.");
      return;
    }
    window.GSP.customGeneSets = customData;
  }

  // Decide which threshold to keep based on selected type
  const thresholdType = localStorage.getItem("threshold-type");

  if (thresholdType === "pvalue") {
    localStorage.setItem("p-value", parseFloat(pvThr));
    localStorage.removeItem("fdr");
  } else if (thresholdType === "fdr") {
    localStorage.setItem("fdr", parseFloat(fdrThr));
    localStorage.removeItem("p-value");
  }

  try {
    loadingSpinner.style.display = "flex";

    // Check if we have existing data
    const hasData = localStorage.getItem("data") !== null;

    if (!hasData) {
      // First time submission - need to generate the graph
      await frame.main();
      hideUpload();
      hideInput();
      setTimeout(() => showGraph(), transitionDuration);

      // Hide the submit button after first render
      document.getElementById("submit-section-wrapper").style.display = "none";
    } else {
      // Subsequent submissions - just update the graph
      await frame.applySettingsAndRender();
    }

    loadingSpinner.style.display = "none";

  } catch (error) {
    loadingSpinner.style.display = "none";
    alert("Error submitting genes: " + error.message);
  }
});

function toggleJaccardOptions() {
  const distanceMetricSelect = document.getElementById('distance-metric');
  const jaccardOptionsContainer = document.getElementById('jaccard-options-container');
  const overlapOptionsContainer = document.getElementById('overlap-options-container');

  if (distanceMetricSelect.value === 'jaccard-distance') {
    // Set a default for the Jaccard type if it becomes visible
    jaccardOptionsContainer.style.display = 'block';
    overlapOptionsContainer.style.display = 'none';
  } else {
    jaccardOptionsContainer.style.display = 'none';
    overlapOptionsContainer.style.display = 'block';
  }
}

function showGeneInputTab(tabId, event = null) {
  // Assign the tabId to the global variable
  currentActiveGeneInputTabId = tabId;
  const isSingleTextArea = currentActiveGeneInputTabId === "single-textarea";
  localStorage.setItem("single-list", JSON.stringify(isSingleTextArea));
  localStorage.setItem("gene-input-mode", tabId);

  // Hide sall content divs
  document.getElementById('scored-genes-content').style.display = 'none';
  document.getElementById('two-textareas-content').style.display = 'none';
  document.getElementById('single-textarea-content').style.display = 'none';

  // Deactivate all tab buttons
  document.querySelectorAll('.gene-input-tab-button').forEach(button => {
    button.classList.remove('active');
  });

  // Show the selected content div
  document.getElementById(tabId + '-content').style.display = 'block';

  // Activate the clicked tab button
  if (event) {
    event.currentTarget.classList.add('active');
  } else {
    // Fallback: activate button by matching tabId
    const buttons = document.querySelectorAll(`.gene-input-tab-button[onclick*="${tabId}"]`);
    if (buttons && buttons.length > 0) {
      buttons[0].classList.add('active');
    }
  }
  updateDisplayGenesSetting(tabId);

  syncCurrentInputTestMode(tabId);

}

function updateDisplayGenesSetting(tabId) {
  const displayGenesContainer = document.getElementById("display-genes-container");
  const displayGenesLabel = document.getElementById("display-genes-label");
  const displayGenesTooltip = document.getElementById("display-genes-tooltip");

  if (!displayGenesContainer || !displayGenesLabel || !displayGenesTooltip) {
    return;
  }

  displayGenesContainer.style.display = "block";

  if (tabId === "single-textarea") {
    displayGenesLabel.textContent = "Show genes in enrichment order";
    displayGenesTooltip.innerHTML =
      "For a single selected point, show the matched genes in enrichment order.<br>" +
      "Multi-select overlap still uses the full matched gene set.";
    return;
  }

  if (tabId === "scored-genes") {
    displayGenesLabel.textContent = "Show leading-edge genes";
    displayGenesTooltip.innerHTML =
      "For a single selected point, show leading-edge genes when available.<br>" +
      "Multi-select overlap still uses the full matched gene set.";
    return;
  }

  displayGenesLabel.textContent = "Show significant genes only";
  displayGenesTooltip.innerHTML =
    "This option filters the selected point(s) to show only significant genes.<br>" +
    "Only available when you use thresholded genes.";
}

function initializeInputTestModes() {
  document.querySelectorAll(".test-mode-group").forEach((group) => {
    const modeKey = group.dataset.modeKey;
    const storageKey = `gene-test-mode-${modeKey}`;
    const savedMode = localStorage.getItem(storageKey) || "positive";
    const matchingInput = group.querySelector(`input[type="radio"][value="${savedMode}"]`);
    if (matchingInput) {
      matchingInput.checked = true;
    }

    group.querySelectorAll('input[type="radio"]').forEach((radio) => {
      radio.addEventListener("change", () => {
        if (radio.checked) {
          localStorage.setItem(storageKey, radio.value);
          syncCurrentInputTestMode(currentActiveGeneInputTabId || localStorage.getItem("gene-input-mode") || "scored-genes");
        }
      });
    });
  });
}

function getInputTestMode(tabId) {
  const storageKey = inputTestModeStorageKeys[tabId];
  if (!storageKey) {
    return "positive";
  }
  return localStorage.getItem(storageKey) || "positive";
}

function syncCurrentInputTestMode(tabId) {
  const selectedMode = getInputTestMode(tabId);
  localStorage.setItem("gene-test-mode-current", selectedMode);
  localStorage.setItem("gene-test-mode-current-input", tabId);
}

function parseScoredGenesFileContent(content) {
  const parsedRows = [];
  const lines = content.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) {
      continue;
    }

    const columns = line.includes("\t")
      ? line.split("\t").map((value) => value.trim()).filter(Boolean)
      : line.split(/\s+/).map((value) => value.trim()).filter(Boolean);

    if (columns.length !== 2) {
      throw new Error(`Line ${index + 1} must contain exactly two columns: gene and score.`);
    }

    const [gene, scoreRaw] = columns;
    const score = Number(scoreRaw);
    if (!gene) {
      throw new Error(`Line ${index + 1} is missing a gene name.`);
    }
    if (Number.isNaN(score)) {
      throw new Error(`Line ${index + 1} has a non-numeric score.`);
    }

    parsedRows.push({ gene, score });
  }

  if (parsedRows.length === 0) {
    throw new Error("The file is empty.");
  }

  return parsedRows;
}

function handleScoredGenesFileSelect(event) {
  const file = event.target.files?.[0];
  const statusEl = document.getElementById("scored-genes-file-status");

  if (!file) {
    clearScoredGenesFile();
    return;
  }

  const lowerName = file.name.toLowerCase();
  if (!(lowerName.endsWith(".tsv") || lowerName.endsWith(".txt"))) {
    clearScoredGenesFile();
    alert("Please upload a .tsv or .txt file for scored genes.");
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const content = typeof reader.result === "string" ? reader.result : "";
      parsedScoredGenes = parseScoredGenesFileContent(content);
      localStorage.setItem("scoredGenesRaw", content);
      if (statusEl) {
        statusEl.style.color = "green";
        statusEl.textContent = `${file.name}: ${parsedScoredGenes.length} scored genes loaded.`;
      }
    } catch (error) {
      clearScoredGenesFile();
      alert(`Invalid scored genes file: ${error.message}`);
    }
  };

  reader.onerror = () => {
    clearScoredGenesFile();
    alert("Unable to read the scored genes file.");
  };

  reader.readAsText(file);
}

function clearScoredGenesFile() {
  const input = document.getElementById("id_scored_genes_file");
  const statusEl = document.getElementById("scored-genes-file-status");
  parsedScoredGenes = [];
  if (input) {
    input.value = "";
  }
  if (statusEl) {
    statusEl.style.color = "gray";
    statusEl.textContent = "";
  }
  localStorage.removeItem("scoredGenesRaw");
}

function clearSingleGeneList() {
  document.getElementById('id_single_gene_list').value = '';
}
function LoadInput() {
  const savedMode = localStorage.getItem("gene-input-mode") || "scored-genes";
  showGeneInputTab(savedMode);
}


function showGraph() {
  graphAndSettingsContainer.classList.add("no-click");
  graphAndSettingsContainer.style.display = "flex";
  selectedPoints.style.display = "block";
  //valsContainer.style.display = "flex";

  // Reset settings flags
  hasUnsavedSettings = false;
  settingsNeedApply = false;

  setTimeout(() => {
    selectedPoints.style.opacity = "1";
    graphAndSettingsContainer.style.opacity = "1";
    graphAndSettingsContainer.classList.remove("no-click");
  }, 100);

  // Show download button in iframe
  try {
    const iframeDownloadBtn = graph.contentWindow.document.getElementById("download-button-wrapper");
    if (iframeDownloadBtn) iframeDownloadBtn.style.display = "block";
  } catch (e) {
    console.warn("Couldn't show download button:", e);
  }
}

function hideGraph() {
  graphAndSettingsContainer.classList.add("no-click");
  selectedPoints.style.opacity = "0";
  graphAndSettingsContainer.style.opacity = "0";
  setTimeout(() => {
    graphAndSettingsContainer.style.display = "none";
    //valsContainer.style.display = "none";
    selectedPoints.style.display = "none";
    graphAndSettingsContainer.classList.remove("no-click");
  }, transitionDuration);

  // Hide download button in iframe
  try {
    const iframeDownloadBtn = graph.contentWindow.document.getElementById("download-button-wrapper");
    if (iframeDownloadBtn) iframeDownloadBtn.style.display = "none";
  } catch (e) {
    console.warn("Couldn't hide download button:", e);
  }
}

function showUpload() {
  uploadContainer.classList.add("no-click");
  uploadContainer.style.display = "flex";
  setTimeout(() => {
    uploadContainer.style.opacity = "1";
    uploadContainer.classList.remove("no-click");
  }, 100);
}
function hideUpload() {
  uploadContainer.classList.add("no-click");
  uploadContainer.style.opacity = "0";
  setTimeout(() => {
    uploadContainer.style.display = "none";
    uploadContainer.classList.remove("no-click");
  }, transitionDuration);
}

function showInput() {
  treeContainer.style.display = "block";
  speciesSelector.style.display = "block";
  geneContainer.style.display = "block";
  submitContainer.style.display = "block";
}
function hideInput() {
  treeContainer.style.display = "none";
  speciesSelector.style.display = "none";
  geneContainer.style.display = "none";
  submitContainer.style.display = "none";
}
function clearSignificantGenes() {
  document.getElementById("id_significant_genes").value = "";
}

function clearInsignificantGenes() {
  document.getElementById("id_insignificant_genes").value = "";
}

document.addEventListener('DOMContentLoaded', () => {
  toggleJaccardOptions();
});

function clearLocalStorageExceptSettings() {
  const settingsBackup = localStorage.getItem("settings");
  const listBackup = localStorage.getItem("single-list");
  const modeBackup = localStorage.getItem("gene-input-mode");
  const scoredTestModeBackup = localStorage.getItem("gene-test-mode-scored");
  const inputTestModeBackup = localStorage.getItem("gene-test-mode-input");
  const currentTestModeBackup = localStorage.getItem("gene-test-mode-current");
  const currentTestModeInputBackup = localStorage.getItem("gene-test-mode-current-input");
  localStorage.clear();
  if (settingsBackup) {
    if (listBackup !== null) {
      localStorage.setItem("single-list", listBackup);
    }
    if (modeBackup !== null) {
      localStorage.setItem("gene-input-mode", modeBackup);
    }
    localStorage.setItem("settings", settingsBackup);
  }
  if (scoredTestModeBackup !== null) {
    localStorage.setItem("gene-test-mode-scored", scoredTestModeBackup);
  }
  if (inputTestModeBackup !== null) {
    localStorage.setItem("gene-test-mode-input", inputTestModeBackup);
  }
  if (currentTestModeBackup !== null) {
    localStorage.setItem("gene-test-mode-current", currentTestModeBackup);
  }
  if (currentTestModeInputBackup !== null) {
    localStorage.setItem("gene-test-mode-current-input", currentTestModeInputBackup);
  }
  localStorage.removeItem("gene-test-mode-thresholded");
  localStorage.setItem("selected", "[]");

}

document.addEventListener("DOMContentLoaded", () => {
  const scoredGenesFileInput = document.getElementById("id_scored_genes_file");
  if (scoredGenesFileInput) {
    scoredGenesFileInput.addEventListener("change", handleScoredGenesFileSelect);
  }
});

function clearPoints() {
  allTablesContainer2.innerHTML = "";
  const placeholder = document.createElement("p");
  placeholder.textContent = "Please select a point above by clicking it.";
  allTablesContainer2.appendChild(placeholder);
}
window.clearPoints = clearPoints;
