// Get needed refrences to document objects
const settingsButton = document.querySelector(".settings-button"); // Gear icon in top right
const settingsContainer = document.querySelector(".settings-container"); // Container for settings area
const graphAndSettingsContainer = document.getElementById(
  "graph-settings-container"
); // Container for Graph and Settings area
const uploadContainer = document.getElementById("upload-container"); // Container for the upload file button
const selectedPoints = document.getElementById("selected-section"); // Container for selected points below graph
const graph = document.getElementById("graph"); // Graph iframe
const importNavButton = document.getElementById("nav-import"); // nav button in top right
const fileInput = document.getElementById("initial-file-input"); // Select file button

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
    await frame.main();

    // Hide upload and show graph
    hideUpload();
    showGraph();
  } else {
    // Show upload screen
    showUpload();
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
    frame.clearSelected();
    localStorage.removeItem("rawFile");
    localStorage.removeItem("camera");
    localStorage.removeItem("data");
    localStorage.removeItem("annotations");
    // Show upload screen
    hideGraph();
    showUpload();
  }
}

// Redirect to help page for help button
function redirectToHelp() {
  window.location.href = "/help";
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
      await frame.main();
    } catch (error) {
      alert(`Check that file was formatted correctly, error: ${error}`);
      return;
    }

    // Clear the fileInput button and show graph
    fileInput.value = "";
    hideUpload();
    showGraph();
  });

function showGraph() {
  graphAndSettingsContainer.style.display = "flex";
  selectedPoints.style.display = "block";
}

function hideGraph() {
  graphAndSettingsContainer.style.display = "none";
  selectedPoints.style.display = "none";
}

function showUpload() {
  uploadContainer.style.display = "flex";
}

function hideUpload() {
  uploadContainer.style.display = "none";
}
