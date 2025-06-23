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
  "number-of-neighbors": "15",
  "minimum-distance": "0.1",
  "seed": "0"
};

const inputRefrences = {};

const fixedSizeButton = document.getElementById("fixed-size");
const dynamicSizeButton = document.getElementById("dynamic-size");
const weightedJ = document.getElementById("weighted-jaccard");

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

  localStorage.setItem("single-list",JSON.stringify(false));

  if (localStorage.getItem("settings") !== null) {
    const currentSettings = JSON.parse(localStorage.getItem("settings"));
    currentSettings.weighted = true;
    localStorage.setItem("settings", JSON.stringify(currentSettings));
    displayValues(currentSettings);
  } else {
    defaultSettings.weighted = true;
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

  // Display Jaccard type
  if (settings["distance_type"] === "fixed") {
    document.getElementById("fixed-jaccard").checked = true;
  } else if (settings["distance_type"] === "weighted") {
    document.getElementById("weighted-jaccard").checked = true;
  }
}

function updateSettings() {
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

  // Jaccard type
  const distanceMetric = document.getElementById("distance-metric")?.value;
  if (distanceMetric === "jaccard_distance") {
    if (document.getElementById("fixed-jaccard")?.checked) {
      newSettings["distance_type"] = "fixed";
    } else if (document.getElementById("weighted-jaccard")?.checked) {
      newSettings["distance_type"] = "weighted";
    }
  } else {
    newSettings["distance_type"] = "overlapping";
  }

  // Compare UMAP settings
  let oldSettings = JSON.parse(localStorage.getItem("settings"));
  if (isUmapSettingDifferent(newSettings, oldSettings)) {
    newSettings.umapChange = true;
  }

  // Save settings
  localStorage.setItem("settings", JSON.stringify(newSettings));

  // Check data before rendering
  const data = localStorage.getItem("data");
  if (data) {
    // Send signal for iframe to render
    window.graph?.contentWindow?.graph?.();
  } else {
    alert("Settings saved! No graph to redraw yet (no data).");
  }
}

function isUmapSettingDifferent(setting1, setting2) {
  return (
    setting1["number-of-neighbors"] !== setting2["number-of-neighbors"] ||
    setting1["minimum-distance"] !== setting2["minimum-distance"] ||
    setting1["seed"] !== setting2["seed"] ||
    setting1["distance_type"] !== setting2["distance_type"]
  );
}

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