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
  seed: "0",
};

const inputRefrences = {};

const fixedSizeButton = document.getElementById("fixed-size");
const dynamicSizeButton = document.getElementById("dynamic-size");

const fixedInput = document.getElementById("fixed-size-input-reveal");
const dynamicInput = document.getElementById("dynamic-size-input-reveal");

main();

function main() {
  Object.keys(defaultSettings).forEach((key) => {
    if (key !== "umap") {
      inputRefrences[key] = document.getElementById(key);
    }
  });

  addRadioEventListeners();
  addSpinnerOverlay();

  if (localStorage.getItem("settings") !== null) {
    const currentSettings = JSON.parse(localStorage.getItem("settings"));
    displayValues(currentSettings);
  } else {
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

function updateSettings() {
  let newSettings = {};

  newSettings.umapChange = false;

  for (const [key, value] of Object.entries(inputRefrences)) {
    if (key === "fixed-size" || key === "dynamic-size") {
      newSettings[key] = value.checked;
    } else {
      newSettings[key] = value.value;
    }
  }

  let oldSettings = JSON.parse(localStorage.getItem("settings"));

  if (isUmapSettingDifferent(newSettings, oldSettings)) {
    newSettings.umapChange = true;
  }

  localStorage.setItem("settings", JSON.stringify(newSettings));
}

function isUmapSettingDifferent(setting1, setting2) {
  return (
    setting1["number-of-neighbors"] !== setting2["number-of-neighbors"] ||
    setting1["minimum-distance"] !== setting2["minimum-distance"] ||
    setting1["seed"] !== setting2["seed"]
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
