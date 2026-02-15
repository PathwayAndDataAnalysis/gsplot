const defaultSettings = {
  "insignificant-color": "#CDCDCD",
  "significant-color": "#000000",
  "selected-color": "#6bfc03",
  "fixed-size": true,
  "dynamic-size": false,
  "fixed-size-input": "6",
  "dynamic-size-scalar": "1",
  "cluster-mode": false,
  "hdbscan-min-cluster-size": "5",
  "hdbscan-min-samples": "5",
};

const inputRefrences = {};
const defaultUmap = {
  'mode': "umap",
  'n_neighbors': 15,
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
let lastPValue = document.getElementById("pvalue-input")?.value || "0.05";
let lastFDR = document.getElementById("fdr-input")?.value || "0.05";

const fixedSizeButton = document.getElementById("fixed-size");
const dynamicSizeButton = document.getElementById("dynamic-size");
const clusterModeToggle = document.getElementById("cluster-mode");
const hdbscanParamsContainer = document.getElementById("hdbscan-params-container");


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
    const raw = JSON.parse(localStorage.getItem("settings"));

    // MERGE defaults so new keys (like cluster-mode) always exist
    const currentSettings = { ...defaultSettings, ...raw };

    currentSettings.reduction = raw.reduction ?? defaultUmap;

    localStorage.setItem("settings", JSON.stringify(currentSettings));
    displayValues(currentSettings);
  } else {
    defaultSettings.reduction = defaultUmap;
    localStorage.setItem("settings", JSON.stringify(defaultSettings));
    displayValues(defaultSettings);
  }
  toggleSizeVisibility();
  toggleClusterParamsVisibility();

  document.querySelectorAll('input[name="threshold-type"]').forEach((radio) => {
    radio.addEventListener("change", updateThresholdInputs);
  });
  updateThresholdInputs(); // Call on load
  // --- Instant Cluster Mode toggle (no Apply needed) ---
  const clusterEl = document.getElementById("cluster-mode");
  if (clusterEl) {
    clusterEl.addEventListener("change", async () => {
      toggleClusterParamsVisibility();
      const hasRendered = localStorage.getItem("data") !== null;

      // Keep settings state in sync without toast side-effects.
      updateSettings(true);

      // No graph yet: just save the setting; submit will fetch as usual.
      if (!hasRendered) {
        return;
      }

      // Force backend relabel pipeline when turning cluster mode ON.
      if (clusterEl.checked) {
        await applySettingsAndRender();
        return;
      }

      // Turning OFF cluster mode stays frontend-only.
      if (typeof frame !== "undefined" && frame?.updateGraphStyling) {
        frame.updateGraphStyling();
      }
      // Keep applied-baseline settings in sync for instant frontend-only toggles.
      try {
        const currentSettings = JSON.parse(localStorage.getItem("settings") || "{}");
        localStorage.setItem("previous_settings", JSON.stringify(currentSettings));
      } catch (e) {
        console.warn("Failed to sync previous_settings after cluster mode OFF toggle:", e);
      }
    });
  }
}

function displayValues(settings) {
  for (const [key, value] of Object.entries(inputRefrences)) {
    if (key === "fixed-size" || key === "dynamic-size" || key === "cluster-mode") {
      value.checked = !!settings[key];
    } else {
      value.value = settings[key];
    }
  }
  toggleClusterParamsVisibility();
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
    if (value === null) continue;
    if (key === "fixed-size" || key === "dynamic-size" || key === "cluster-mode") {
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

  // Compare against last applied settings (graph state), not current draft settings
  let oldSettings = JSON.parse(
    localStorage.getItem("previous_settings") ||
    localStorage.getItem("settings") ||
    "{}"
  );
  if (isEmbeddingChanged(newSettings, oldSettings)) {
    newSettings.umapChange = true;
  }
  let distancesM = JSON.parse(localStorage.getItem("distances-M"));
  distancesM = !(newSettings["distance_type"] !== oldSettings["distance_type"]);
  localStorage.setItem("distances-M", JSON.stringify(distancesM));

  const pvThr = document.getElementById("pvalue-input")?.value;
  const fdrThr = document.getElementById("fdr-input")?.value;

  const selectedType = document.querySelector('input[name="threshold-type"]:checked')?.value;
  if (selectedType === "pvalue") {
    newSettings["p_value_threshold"] = parseFloat(pvThr);
    delete newSettings["fdr_threshold"];
    localStorage.setItem("p-value", newSettings["p_value_threshold"]);
    localStorage.removeItem("fdr");
  } else if (selectedType === "fdr") {
    newSettings["fdr_threshold"] = parseFloat(fdrThr);
    delete newSettings["p_value_threshold"];
    localStorage.setItem("fdr", newSettings["fdr_threshold"]);
    localStorage.removeItem("p-value");
  }

  // Save draft settings; previous_settings is updated after successful apply
  localStorage.setItem("settings", JSON.stringify(newSettings));

  const stylingOnly = detectFrontendOnlyChanges();
  const isDataChange = isEmbeddingChanged(newSettings, oldSettings);
  const thresholdChange = isThresholdChanged(newSettings, oldSettings);
  const clusterModeChanged = !!newSettings["cluster-mode"] !== !!oldSettings["cluster-mode"];
  const clusterParamsChanged = areClusterParamsChanged(newSettings, oldSettings);
  const requiresClusterRelabel =
    (clusterModeChanged && !!newSettings["cluster-mode"]) || clusterParamsChanged;
  const clusterVisualOnlyChange = clusterModeChanged && !newSettings["cluster-mode"];
  const relabelOnly =
    clusterModeChanged &&
    !!newSettings["cluster-mode"] &&
    !clusterParamsChanged &&
    !isDataChange &&
    !thresholdChange;
  const reclusterOnly =
    clusterParamsChanged &&
    !clusterModeChanged &&
    !isDataChange &&
    !thresholdChange;

  localStorage.setItem(
    "justStyling",
    ((stylingOnly || clusterVisualOnlyChange) && !isDataChange && !thresholdChange && !requiresClusterRelabel)
      ? "true"
      : "false"
  );
  localStorage.setItem("relabelOnly", relabelOnly ? "true" : "false");
  localStorage.setItem("reclusterOnly", reclusterOnly ? "true" : "false");

  if (!stylingOnly && !isDataChange && !thresholdChange && !clusterModeChanged && !clusterParamsChanged) {
    if (!suppressToast) {
      const toast = document.getElementById("toast-message");
      if (toast) {
        toast.style.display = "block";
        toast.style.color = "#2ecc71";
        toast.textContent = "No changes detected.";
        setTimeout(() => {
          toast.style.display = "none";
        }, 2000);
      }
    }
    hasUnsavedSettings = false;
    return;
  }

  const hasRendered = localStorage.getItem("data") !== null;
  if (hasRendered && !suppressToast) {
    applySettingsAndRender();
  }

  const toast = document.getElementById("toast-message");
  if (toast && !suppressToast) {
    toast.style.display = "block";
    toast.style.color = "#2ecc71";
    toast.textContent = hasRendered
      ? "Settings applied! Graph will update..."
      : "Settings saved! Click Submit to generate the graph.";

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
  const loadingSpinner = document.getElementById("loading-spinner");
  loadingSpinner.style.display = "flex";

  const backupData = localStorage.getItem("data");

  try {
    const newSettings = JSON.parse(localStorage.getItem("settings"));

    const stylingOnly = localStorage.getItem("justStyling") === "true";
    const relabelOnly = localStorage.getItem("relabelOnly") === "true";
    const reclusterOnly = localStorage.getItem("reclusterOnly") === "true";
    localStorage.removeItem("justStyling");
    localStorage.removeItem("relabelOnly");
    localStorage.removeItem("reclusterOnly");

    const hasRendered = localStorage.getItem("data") !== null;

    if (relabelOnly && hasRendered) {
      console.log("Cluster relabel-only change -> calling lightweight cluster labeling endpoint.");
      await relabelCurrentClusters(newSettings);
      localStorage.setItem("previous_settings", JSON.stringify(newSettings));
      loadingSpinner.style.display = "none";
      return;
    }

    if (reclusterOnly && hasRendered) {
      console.log("Cluster parameter change -> reclustering + relabeling without full pipeline.");
      await reclusterCurrentGraph(newSettings);
      localStorage.setItem("previous_settings", JSON.stringify(newSettings));
      loadingSpinner.style.display = "none";
      return;
    }

    if (stylingOnly && hasRendered) {
      console.log("Styling-only change → updating graph visuals.");
      frame.updateGraphStyling();
      localStorage.setItem("previous_settings", JSON.stringify(newSettings));
      loadingSpinner.style.display = "none";
      return;
    }

    const singleList = JSON.parse(localStorage.getItem("single-list"));

    if (singleList) {
      await frame.getGeneData(newSettings);
    } else {
      await frame.getGeneInputData(newSettings);
    }

    const fullData = JSON.parse(localStorage.getItem("data") || "null");

    if (
      !fullData ||
      !Array.isArray(fullData["X"]) ||
      fullData["X"].length < 4 ||
      fullData["X"].includes(null)
    ) {
      throw new Error("Not enough valid data points returned. Try lowering your threshold or neighbors.");
    }

    localStorage.removeItem("camera");
    localStorage.removeItem("annotations");
    localStorage.setItem("selected", "[]");
    localStorage.setItem("reset", JSON.stringify(true));

    clearPoints();

    frame.graph();
    localStorage.setItem("previous_settings", JSON.stringify(newSettings));

    loadingSpinner.style.display = "none";

  } catch (error) {
    const parsedBackup = JSON.parse(backupData || "null");
    if (
      parsedBackup &&
      Array.isArray(parsedBackup["X"]) &&
      parsedBackup["X"].length >= 4
    ) {
      localStorage.setItem("data", backupData);
      const oldSettings = JSON.parse(localStorage.getItem("previous_settings"));
      localStorage.setItem("settings", JSON.stringify(oldSettings));

      localStorage.removeItem("camera");
      localStorage.removeItem("annotations");
      localStorage.setItem("selected", "[]");
      localStorage.setItem("reset", JSON.stringify(true));
      clearPoints();
      frame.graph();
    }

    loadingSpinner.style.display = "none";
    alert("Error applying settings: " + error.message);
  }
}

async function relabelCurrentClusters(settings) {
  const fullData = JSON.parse(localStorage.getItem("data") || "null");
  if (!fullData || !Array.isArray(fullData["X"])) {
    throw new Error("No graph data available for cluster relabeling.");
  }

  const n = fullData["X"].length;
  const points = [];
  for (let i = 0; i < n; i++) {
    points.push({
      X: fullData["X"]?.[i],
      Y: fullData["Y"]?.[i],
      clusterID: fullData["clusterID"]?.[i],
      setName: fullData["setName"]?.[i],
      molecules: fullData["molecules"]?.[i],
      pValue: fullData["pValue"]?.[i],
    });
  }

  const response = await fetch("/cluster-labels/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      points: points,
      settings: settings,
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || "Cluster relabel request failed.");
  }
  if (!payload || !Array.isArray(payload.points)) {
    throw new Error("Invalid cluster relabel response.");
  }

  fullData["clusterLabel"] = payload.points.map((p) => p?.clusterLabel ?? "");
  if (Array.isArray(fullData["clusterID"])) {
    fullData["clusterID"] = payload.points.map((p, idx) =>
      p?.clusterID !== undefined ? p.clusterID : fullData["clusterID"][idx]
    );
  }
  localStorage.setItem("data", JSON.stringify(fullData));

  if (typeof frame !== "undefined" && frame?.updateGraphStyling) {
    frame.updateGraphStyling();
  } else if (typeof frame !== "undefined" && frame?.graph) {
    frame.graph();
  }
}

async function reclusterCurrentGraph(settings) {
  const fullData = JSON.parse(localStorage.getItem("data") || "null");
  if (!fullData || !Array.isArray(fullData["X"])) {
    throw new Error("No graph data available for reclustering.");
  }

  const n = fullData["X"].length;
  const points = [];
  for (let i = 0; i < n; i++) {
    points.push({
      X: fullData["X"]?.[i],
      Y: fullData["Y"]?.[i],
      clusterID: fullData["clusterID"]?.[i],
      setName: fullData["setName"]?.[i],
      molecules: fullData["molecules"]?.[i],
      pValue: fullData["pValue"]?.[i],
    });
  }

  const response = await fetch("/cluster-recluster/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      points: points,
      settings: settings,
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || "Cluster recluster request failed.");
  }
  if (!payload || !Array.isArray(payload.points)) {
    throw new Error("Invalid cluster recluster response.");
  }

  fullData["clusterID"] = payload.points.map((p, idx) =>
    p?.clusterID !== undefined ? p.clusterID : (fullData["clusterID"]?.[idx] ?? -1)
  );
  fullData["clusterLabel"] = payload.points.map((p) => p?.clusterLabel ?? "");
  localStorage.setItem("data", JSON.stringify(fullData));

  if (typeof frame !== "undefined" && frame?.updateGraphStyling) {
    frame.updateGraphStyling();
  } else if (typeof frame !== "undefined" && frame?.graph) {
    frame.graph();
  }
}

function isEmbeddingChanged(setting1, setting2) {
  return (
    setting1["distance_type"] !== setting2["distance_type"] ||
    getReductionDiff(setting1, setting2)
  );
}

function isThresholdChanged(newSettings, oldSettings) {
  return (
    newSettings["p_value_threshold"] !== oldSettings["p_value_threshold"] ||
    newSettings["fdr_threshold"] !== oldSettings["fdr_threshold"]
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

function normalizeClusterSettingInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  return parsed;
}

function getEffectiveClusterParams(settings) {
  return {
    minClusterSize: normalizeClusterSettingInt(settings?.["hdbscan-min-cluster-size"], 5),
    minSamples: normalizeClusterSettingInt(settings?.["hdbscan-min-samples"], 5),
  };
}

function areClusterParamsChanged(newSettings, oldSettings) {
  if (!newSettings?.["cluster-mode"]) {
    return false;
  }

  const nextParams = getEffectiveClusterParams(newSettings);
  const prevParams = getEffectiveClusterParams(oldSettings || {});
  return (
    nextParams.minClusterSize !== prevParams.minClusterSize ||
    nextParams.minSamples !== prevParams.minSamples
  );
}

function toggleClusterParamsVisibility() {
  if (!hdbscanParamsContainer || !clusterModeToggle) {
    return;
  }
  hdbscanParamsContainer.style.display = clusterModeToggle.checked ? "block" : "none";
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
  isEmbeddingChanged: isEmbeddingChanged,
  collectCurrentSettings: function () {
    let newSettings = {};
    for (const [key, value] of Object.entries(inputRefrences)) {
      if (value === null) continue;
      if (key === "fixed-size" || key === "dynamic-size" || key === "cluster-mode") {
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
  updateSettings: updateSettings, // Expose the updateSettings function
  displayValues: displayValues
};

function updateThresholdInputs() {
  const selectedType = document.querySelector('input[name="threshold-type"]:checked')?.value;
  const pInput = document.getElementById("pvalue-input");
  const fdrInput = document.getElementById("fdr-input");
  const pWrapper = document.getElementById("pvalue-wrapper");
  const fWrapper = document.getElementById("fdr-wrapper");

  if (selectedType === "pvalue") {
    // Restore p-value from computed if available
    const storedComputedP = localStorage.getItem("computed-p-value");
    if (storedComputedP !== null) {
      pInput.value = storedComputedP;
    } else if (lastPValue !== "") {
      pInput.value = lastPValue;
    }

    pInput.removeAttribute("readonly");

    // Save current fdr, then clear display
    lastFDR = fdrInput.value;
    fdrInput.setAttribute("readonly", true);

    pWrapper.classList.remove("grayed-out");
    fWrapper.classList.add("grayed-out");
  } else {
    // Restore fdr from computed if available
    const storedComputedFDR = localStorage.getItem("computed-fdr");
    if (storedComputedFDR !== null) {
      fdrInput.value = storedComputedFDR;
    } else if (lastFDR !== "") {
      fdrInput.value = lastFDR;
    }

    fdrInput.removeAttribute("readonly");

    // Save current p-value, then clear display
    lastPValue = pInput.value;
    pInput.setAttribute("readonly", true);

    fWrapper.classList.remove("grayed-out");
    pWrapper.classList.add("grayed-out");
  }

  localStorage.setItem("threshold-type", selectedType);
}
