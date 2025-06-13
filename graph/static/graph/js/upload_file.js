// Get needed refrences to document objects
const settingsButton = document.querySelector(".settings-button"); // Gear icon in top right
const settingsContainer = document.querySelector(".settings-container"); // Container for settings area
const graphAndSettingsContainer = document.getElementById(
  "graph-settings-container"
); // Container for Graph and Settings area
const loadingSpinner = document.getElementById("loading-spinner"); // Spinner element
const treeContainer = document.getElementById("tree-container");
const InputContainer = document.getElementById("threshold-container");
const valsContainer = document.getElementById("graph-text-info");

const submitContainer = document.getElementById("manual-gene-input"); // Container for the submit text button

const uploadContainer = document.getElementById("upload-container"); // Container for the upload file button
const selectedPoints = document.getElementById("selected-section"); // Container for selected points below graph
const graph = document.getElementById("graph"); // Graph iframe
const importNavButton = document.getElementById("nav-import"); // nav button in top right
const fileInput = document.getElementById("initial-file-input"); // Select file button

const transitionDuration = 300;

// To cler storge for testing purposes
clearLocalStorageExceptSettings()
//localStorage.clear();

// This becomes a refrence to the iframe once it has loaded
let frame;
graph.onload = () => {
  frame = graph.contentWindow;
  main();
};

// Entry point
async function main() {
  // If there is alreadt a file and UMAP data in local storage, call iframe.main()
  if (
    localStorage.getItem("data") !== null &&
    localStorage.getItem("rawFile") !== null
  ) {
    // Show loading spinner
    loadingSpinner.style.display = "block";

    await frame.main();

    // Hide spinner after graph is ready
    loadingSpinner.style.display = "none";


    // Hide upload and show graph
    hideUpload();
    hideInput();
    hideSubmit();
    hideGenes();
    showGraph();
  } else {
    // Show upload screen
    showUpload();
    showSubmit();
    showGenes();
    showInput();
    hideGraph();
  }
}

// Import file button script
function importFile() {
  // Warn user that if they have data stored, it will be deleted
  if (
    localStorage.getItem("data") === null ||
    confirm("Do you want to import new data?\nThis erases current saved data.")
  ) {
    // Clear selected points and remove local storage
    localStorage.setItem("selected", "[]");
    localStorage.removeItem("rawFile");
    localStorage.removeItem("camera");
    localStorage.removeItem("data");
    localStorage.removeItem("annotations");
    // Show upload screen
    hideGraph();
    setTimeout(() => {
      showUpload();
      showGenes();
      showSubmit();
      showInput();
      //showSubmit
    }, transitionDuration);
  }
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

document.getElementById("submit-gene-button").addEventListener("click", async function () {
  const sigGenes = document.getElementById("id_significant_genes").value;
  const insigGenes = document.getElementById("id_insignificant_genes").value;

  const species = document.getElementById("species-select").value;

  const pvThr = document.getElementById("pvalue-input").value;
  const fdrThr = document.getElementById("fdr-input").value;

  const selectedGeneSets = window?.GSP?.selectedGeneSets || [];

  const minInput = document.getElementById("min-member-input");
  let minMembers = 5; // default

  if (pvThr === "" && fdrThr === "") {
    alert("Please enter either a p-value or an FDR threshold.");
    return;
  }

  if (!sigGenes.trim() && !insigGenes.trim()) {
    alert("Please enter at least one gene in either field.");
    return;
  }

  if (pvThr !== "") localStorage.setItem("p-value", parseFloat(pvThr));
  if (fdrThr !== "") localStorage.setItem("fdr", parseFloat(fdrThr));

  // Save values to localStorage so the iframe can access them
  localStorage.setItem("sigGenes", sigGenes.trim());
  localStorage.setItem("insigGenes", insigGenes.trim());
  localStorage.setItem("species", species)

  if (minInput) {
    const raw = minInput.value.trim();
    if (raw !== "" && !isNaN(raw)) {
      const val = Number(raw);
      if (val >= 5) {
        minMembers = val;
      }
    }
  }

  localStorage.setItem("minInput", minMembers);

  if (selectedGeneSets.length === 0) {
    alert("Please select at least one category of gene sets from the tree.");
    return;
  }

  try {
    loadingSpinner.style.display = "block";
    await frame.main();
    loadingSpinner.style.display = "none";
  } catch (error) {
    alert("Error submitting genes: " + error.message);
  }

  hideUpload();
  hideGenes();
  hideSubmit();
  hideInput();
  setTimeout(() => showGraph(), transitionDuration);

});


function showGraph() {
  graphAndSettingsContainer.classList.add("no-click");
  graphAndSettingsContainer.style.display = "flex";
  selectedPoints.style.display = "block";
  valsContainer.style.display = "flex";
  setTimeout(() => {
    selectedPoints.style.opacity = "1";
    graphAndSettingsContainer.style.opacity = "1";
    graphAndSettingsContainer.classList.remove("no-click");
  }, 100);
}

function hideGraph() {
  graphAndSettingsContainer.classList.add("no-click");
  selectedPoints.style.opacity = "0";
  graphAndSettingsContainer.style.opacity = "0";
  setTimeout(() => {
    graphAndSettingsContainer.style.display = "none";
    valsContainer.style.display = "none";
    selectedPoints.style.display = "none";
    graphAndSettingsContainer.classList.remove("no-click");
  }, transitionDuration);
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

function showGenes() {
  treeContainer.style.display = "block";
}

function hideGenes() {
  treeContainer.style.display = "none";
}
function showSubmit() {
  submitContainer.style.display = "block";
}
function hideSubmit() {
  submitContainer.style.display = "none";
}
function showInput() {
  InputContainer.style.display = "flex";
}
function hideInput() {
  InputContainer.style.display = "none";
}
function clearSignificantGenes() {
  document.getElementById("id_significant_genes").value = "";
}

function clearInsignificantGenes() {
  document.getElementById("id_insignificant_genes").value = "";
}



function clearLocalStorageExceptSettings() {
  const settingsBackup = localStorage.getItem("settings");
  localStorage.clear();
  if (settingsBackup) {
    localStorage.setItem("settings", settingsBackup);
  }
}
