const defaultSettings = {
  "insignificant-color": "#CDCDCD",
  "significant-color": "#000000",
  "selected-color": "#6bfc03",
  "q-value-maximum": "0.45",
  "q-value-minimum": "0.0",
  "fixed-size": true,
  "dynamic-size": false,
  "fixed-size-input": "6",
  "dynamic-size-scalar": "1",
};

const inputRefrences = {};
const defaultUmap = {
  'mode': "umap",
  'n_neighbors': 5,
  'seed': 0,
  'min_dist': 0.1,
};
const defaultTsne = {
  'mode': "tsne",
  'perplexity': 15.0,
  'early_ex': 12.0,
  'max_iter': 1000,
}

const defaultIsoMap = {
  'mode': "isomap",
  'n_neighbors': 5,
}

const fixedSizeButton = document.getElementById("fixed-size");
const dynamicSizeButton = document.getElementById("dynamic-size");


const algorithmSelect = document.getElementById('algorithmSelect');
const umapParams = document.getElementById('umapParams');
const tsneParams = document.getElementById('tsneParams');
const isomapParams = document.getElementById('isomapParams');

const fixedInput = document.getElementById("fixed-size-input-reveal");
const dynamicInput = document.getElementById("dynamic-size-input-reveal");

main();

function main() {
  Object.keys(defaultSettings).forEach((key) => {
    const el = document.getElementById(key);
    if (el) {
      inputRefrences[key] = el;
    } else {
      console.warn(`Element with id "${key}" not found in DOM`);
    }
  });

  addRadioEventListeners();
  addSpinnerOverlay();

  localStorage.setItem("single-list", JSON.stringify(false));

  if (localStorage.getItem("settings") !== null) {
    const currentSettings = JSON.parse(localStorage.getItem("settings"));
    currentSettings.reduction = defaultUmap;
    localStorage.setItem("settings", JSON.stringify(currentSettings));
    displayValues(currentSettings);
  } else {
    defaultSettings.reduction = defaultUmap;
    localStorage.setItem("settings", JSON.stringify(defaultSettings));
    displayValues(defaultSettings);
  }
  toggleSizeVisibility();
}

function displayValues(settings) {
  for (const [key, value] of Object.entries(inputRefrences)) {
    if (key === "fixed-size" || key === "dynamic-size") {
      value.checked = settings[key];
    } else {
      value.value = settings[key];
    }
  }
}
function getReduction() { // get input based on user input on sidebar
  const selectedAlgorithm = algorithmSelect.value;
  let setReduction = {}
  setReduction['mode'] = selectedAlgorithm;
  if (selectedAlgorithm === 'umap') {
    setReduction['n_neighbors'] = parseInt(document.getElementById("umapNNeighbors")?.value);
    setReduction['seed'] = parseInt(document.getElementById("umapRandomState")?.value);
    setReduction['min_dist'] = parseFloat(document.getElementById("umapMinDist")?.value);
  } else if (selectedAlgorithm === 'tsne') {
    setReduction['perplexity'] = parseFloat(document.getElementById("tsnePerplexity")?.value);
    setReduction['early_ex'] = parseFloat(document.getElementById("tsneEarlyExaggeration")?.value);
    setReduction['max_iter'] = parseInt(document.getElementById("tsneNIters")?.value);
  } else if (selectedAlgorithm === 'isomap') {
    setReduction['n_neighbors'] = parseInt(document.getElementById("isomapNNeighbors")?.value);
  }
  return setReduction
}
function getReductionDiff(setting1, setting2) { // compare to find potential differences to then update the graph
  const reduction1 = setting1['reduction']
  const reduction2 = setting2['reduction']
  const selectedAlgorithm = setting1['mode'];
  if (reduction1['mode'] !== reduction2['mode']) return true
  if (selectedAlgorithm === 'umap') {
    return (
      reduction1['n_neighbors'] !== reduction2['n_neighbors'] ||
      reduction1['seed'] !== reduction2['seed'] ||
      reduction1['min_dist'] !== reduction2['min_dist']
    )
  } else if (selectedAlgorithm === 'tsne') {
    return (
      reduction1['perplexity'] !== reduction2['perplexity'] ||
      reduction1['early_ex'] !== reduction2['early_ex'] ||
      reduction1['max_iter'] !== reduction2['max_iter']
    )
  } else if (selectedAlgorithm === 'isomap') {
    return (reduction1['n_neighbors'] !== reduction2['n_neighbors'])
  }
}

function updateSettings(suppressToast = false) {
  let newSettings = {};
  newSettings.umapChange = false;

  // Collect input
  for (const [key, value] of Object.entries(inputRefrences)) {
    if (value === null) continue;  // Skip input not found
    if (key === "fixed-size" || key === "dynamic-size") {
      newSettings[key] = value.checked;
    } else {
      newSettings[key] = value.value;
    }
  }
  const reduction = getReduction(newSettings);
  newSettings['reduction'] = reduction;
  newSettings['mode'] = reduction['mode'];

  // Jaccard type
  const distanceMetric = document.getElementById("distance-metric")?.value;
  if (distanceMetric === "jaccard-distance") {
    if (document.getElementById("plain-jaccard")?.checked) {
      newSettings["distance_type"] = "jaccard_plain";
    } else if (document.getElementById("weighted-jaccard")?.checked) {
      newSettings["distance_type"] = "jaccard_weighted";
    }
  } else {
    if (document.getElementById("plain-overlap")?.checked) {
      newSettings["distance_type"] = "overlap_plain";
    } else if (document.getElementById("weighted-overlap")?.checked) {
      newSettings["distance_type"] = "overlap_weighted";
    }
  }

  // Compare UMAP settings
  let oldSettings = JSON.parse(localStorage.getItem("settings"));
  if (isUmapSettingDifferent(newSettings, oldSettings)) {
    newSettings.umapChange = true;
  }
  let distancesM = JSON.parse(localStorage.getItem("distances-M"));
  distancesM = !(newSettings["distance_type"] !== oldSettings["distance_type"]);
  localStorage.setItem("distances-M", JSON.stringify(distancesM));

  const pvThr = document.getElementById("pvalue-input")?.value;
  const fdrThr = document.getElementById("fdr-input")?.value;
  if (pvThr !== "") localStorage.setItem("p-value", parseFloat(pvThr));
  if (fdrThr !== "") localStorage.setItem("fdr", parseFloat(fdrThr));

  // Save settings
  localStorage.setItem("settings", JSON.stringify(newSettings));
  localStorage.setItem("previous_settings", JSON.stringify(newSettings));

  const stylingOnly = detectFrontendOnlyChanges();
  localStorage.setItem("justStyling", stylingOnly ? "true" : "false");

  const toast = document.getElementById("toast-message");
  if (toast && !suppressToast) {
    toast.style.display = "block";
    toast.style.color = "#2ecc71";

    // Check if graph has been rendered before
    const hasRendered = localStorage.getItem("data") !== null;

    if (hasRendered) {
      // If graph exists, Apply will trigger a re-render
      toast.textContent = "Settings applied! Graph will update...";
      // Trigger the graph update
      applySettingsAndRender();
    } else {
      // If no graph yet, just save settings
      toast.textContent = "Settings saved! Click Submit to generate the graph.";
    }

    setTimeout(() => {
      toast.style.display = "none";
    }, 2000);
  }
  hasUnsavedSettings = false;
}

function detectFrontendOnlyChanges() {
  const current = {
    sigColor: document.getElementById("significant-color")?.value,
    insigColor: document.getElementById("insignificant-color")?.value,
    selectedColor: document.getElementById("selected-color")?.value,
    qMin: document.getElementById("q-value-minimum")?.value,
    qMax: document.getElementById("q-value-maximum")?.value,
    fixed: document.getElementById("fixed-size")?.checked,
    dynamic: document.getElementById("dynamic-size")?.checked,
    fixedSizeVal: document.getElementById("fixed-size-input")?.value,
    dynamicScalar: document.getElementById("dynamic-size-scalar")?.value,
    showSigOnly: document.getElementById("show-sig-only")?.checked,
  };

  const previousRaw = localStorage.getItem("previous_styling");
  const previous = previousRaw ? JSON.parse(previousRaw) : current;

  const changed = Object.keys(current).some((key) => current[key] !== previous[key]);

  localStorage.setItem("previous_styling", JSON.stringify(current));
  return changed;
}

async function applySettingsAndRender() {
  try {
    const loadingSpinner = document.getElementById("loading-spinner");
    loadingSpinner.style.display = "flex";

    const newSettings = JSON.parse(localStorage.getItem("settings"));
    const oldSettings = JSON.parse(localStorage.getItem("previous_settings") || "{}");

    const stylingOnly = localStorage.getItem("justStyling") === "true";
    localStorage.removeItem("justStyling"); // consume once

    const settingsChanged = JSON.stringify(newSettings) !== JSON.stringify(oldSettings);

    const hasRendered = localStorage.getItem("data") !== null;

    if (stylingOnly && !settingsChanged && hasRendered) {
      console.log("Styling-only change → updating graph visuals.");
      frame.updateGraphStyling();
      loadingSpinner.style.display = "none";
      return;
    }

    // Clear local states
    localStorage.removeItem("data");
    localStorage.removeItem("camera");
    localStorage.removeItem("annotations");
    localStorage.setItem("selected", "[]");
    localStorage.setItem("reset", JSON.stringify(true));

    const singleList = JSON.parse(localStorage.getItem("single-list"));

    if (singleList) {
      await frame.getGeneData(newSettings);
    } else {
      await frame.getGeneInputData(newSettings);
    }

    localStorage.setItem("selected", "[]");
    clearPoints();

    frame.graph();
    loadingSpinner.style.display = "none";
  } catch (error) {
    loadingSpinner.style.display = "none";
    alert("Error applying settings: " + error.message);
  }
}

function isUmapSettingDifferent(setting1, setting2) {
  return (
    setting1["distance_type"] !== setting2["distance_type"] ||
    getReductionDiff(setting1, setting2)
  );
}

// Add this new function
function toggleAlgorithmParams() {
  const selectedAlgorithm = algorithmSelect.value;

  // Hide all parameter sections first
  umapParams.style.display = 'none';
  tsneParams.style.display = 'none';
  isomapParams.style.display = 'none';

  // Then show only the selected one
  if (selectedAlgorithm === 'umap') {
    umapParams.style.display = 'block';
  } else if (selectedAlgorithm === 'tsne') {
    tsneParams.style.display = 'block';
  } else if (selectedAlgorithm === 'isomap') {
    isomapParams.style.display = 'block';
  }
}

toggleAlgorithmParams(); // Call once on load to set initial state


function addRadioEventListeners() {
  fixedSizeButton.addEventListener("change", () => {
    toggleSizeVisibility();
  });

  dynamicSizeButton.addEventListener("change", () => {
    toggleSizeVisibility();
  });
}

function toggleSizeVisibility() {
  if (fixedSizeButton.checked) {
    fixedInput.style.display = "block";
    dynamicInput.style.display = "none";
  } else if (dynamicSizeButton.checked) {
    dynamicInput.style.display = "block";
    fixedInput.style.display = "none";
  }
}

function addSpinnerOverlay() {
  const spinnerOverlay = document.getElementById("loading-spinner");

  // Prevent interaction with the site while spinner is shown
  spinnerOverlay.addEventListener("click", function (event) {
    event.stopPropagation();
    event.preventDefault();
  });

  document.body.addEventListener(
    "click",
    function (event) {
      if (spinnerOverlay.style.display === "flex") {
        event.stopPropagation();
        event.preventDefault();
      }
    },
    true
  );
}

// Expose necessary functions to window and iframe
window.update_settings = {
  isUmapSettingDifferent: isUmapSettingDifferent,
  collectCurrentSettings: function () {
    let newSettings = {};
    for (const [key, value] of Object.entries(inputRefrences)) {
      if (value === null) continue;
      if (key === "fixed-size" || key === "dynamic-size") {
        newSettings[key] = value.checked;
      } else {
        newSettings[key] = value.value;
      }
    }

    const reduction = getReduction();
    newSettings['reduction'] = reduction;
    newSettings['mode'] = reduction['mode'];

    const distanceMetric = document.getElementById("distance-metric")?.value;
    if (distanceMetric === "jaccard-distance") {
      if (document.getElementById("plain-jaccard")?.checked) {
        newSettings["distance_type"] = "jaccard_plain";
      } else if (document.getElementById("weighted-jaccard")?.checked) {
        newSettings["distance_type"] = "jaccard_weighted";
      }
    } else {
      if (document.getElementById("plain-overlap")?.checked) {
        newSettings["distance_type"] = "overlap_plain";
      } else if (document.getElementById("weighted-overlap")?.checked) {
        newSettings["distance_type"] = "overlap_weighted";
      }
    }

    return newSettings;
  },
  updateSettings: updateSettings // Expose the updateSettings function
};