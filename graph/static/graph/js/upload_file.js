// Get needed refrences to document objects
const settingsButton = document.querySelector(".settings-button"); // Gear icon in top right
const settingsContainer = document.querySelector(".settings-container"); // Container for settings area
const graphAndSettingsContainer = document.getElementById(
  "graph-settings-container"
); // Container for Graph and Settings area
const loadingSpinner = document.getElementById("loading-spinner"); // Spinner element

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
    hideSubmit()
    showGraph();
  } else {
    // Show upload screen
    showUpload();
    showSubmit
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
      showSubmit
    }, transitionDuration);
  }
}

// When the user clicks the settings button, add classes to trigger css animation
settingsButton.addEventListener("click", function () {
  settingsContainer.classList.toggle("visible");
  graph.classList.toggle("settings-open");
});

// When user selects a file, save it in local storage in base64 to send to backend endpoint
fileInput.addEventListener("change", function (event) {
  const file = event.target.files[0];
  const reader = new FileReader();
  reader.onload = function (e) {
    const fileData = e.target.result;
    localStorage.setItem("rawFile", fileData);
  };
  reader.readAsDataURL(file);
});

// When user clicks upload, call iframe.main() which will use file in local storage
document
  .getElementById("initial-upload-button")
  .addEventListener("click", async function () {
    // If there is no file saved or selected, return
    if (!localStorage.getItem("rawFile") || fileInput.value === "") {
      return;
    }

    // Try to draw graph, catch any error that comes up and display it
    try {
      loadingSpinner.style.display = "block";
      await frame.main();
      loadingSpinner.style.display = "none";

    } catch (error) {
      alert(`Check that file was formatted correctly, error: ${error}`);
      return;
    }

    // Clear the fileInput button and show graph
    fileInput.value = "";
    hideUpload();
    hideSubmit()
    setTimeout(() => {
      showGraph();
    }, transitionDuration);
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

  if (!sigGenes.trim() && !insigGenes.trim()) {
    alert("Please enter at least one gene in either field.");
    return;
  }

  // Save values to localStorage so the iframe can access them
  localStorage.setItem("sigGenes", sigGenes.trim());
  localStorage.setItem("insigGenes", insigGenes.trim());

  try {
    loadingSpinner.style.display = "block";
    await frame.main();
    loadingSpinner.style.display = "none";
  } catch (error) {
    alert("Error submitting genes: " + error.message);
  }

  hideUpload();
  hideSubmit()
  setTimeout(() => showGraph(), transitionDuration);

});


function showGraph() {
  graphAndSettingsContainer.classList.add("no-click");
  graphAndSettingsContainer.style.display = "flex";
  selectedPoints.style.display = "block";
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

function showSubmit() {
  submitContainer.classList.add("no-click");
  submitContainer.style.display = "flex";
  setTimeout(() => {
    submitContainer.style.opacity = "1";
    submitContainer.classList.remove("no-click");
  }, 100);
}
function hideSubmit() {
  submitContainer.classList.add("no-click");
  submitContainer.style.opacity = "0";
  setTimeout(() => {
    submitContainer.style.display = "none";
    submitContainer.classList.remove("no-click");
  }, transitionDuration);
}

function clearLocalStorageExceptSettings() {
  const settingsBackup = localStorage.getItem("settings");
  localStorage.clear();
  if (settingsBackup) {
    localStorage.setItem("settings", settingsBackup);
  }
}
