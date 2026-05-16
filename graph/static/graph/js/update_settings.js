const defaultSettings = {
  "insignificant-color": "#CDCDCD",
  "significant-color": "#000000",
  "negative-significant-color": "#2166ac",
  "selected-color": "#6bfc03",
  "fixed-size": true,
  "dynamic-size": false,
  "fixed-size-input": "6",
  "dynamic-size-scalar": "1",

  "cluster-mode": false,
  "cluster-algorithm": "hdbscan",

  "hdbscan-min-cluster-size": "5",
  "hdbscan-min-samples": "",

  "optics-min-cluster-size": "",
  "optics-min-samples": "5",
  "optics-xi": "0.05",
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


const algorithmSelect = document.getElementById('algorithmSelect');
const umapParams = document.getElementById('umapParams');
const tsneParams = document.getElementById('tsneParams');
const isomapParams = document.getElementById('isomapParams');

const clusterAlgorithmSelect = document.getElementById("cluster-algorithm");
const hdbscanOptionsContainer = document.getElementById("hdbscan-options-container");
const opticsOptionsContainer = document.getElementById("optics-options-container");

const fixedInput = document.getElementById("fixed-size-input-reveal");
const dynamicInput = document.getElementById("dynamic-size-input-reveal");

function cloneJSON(value) {
  if (value === null || value === undefined) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function getRuntimeGraphData() {
  if (window.getCachedGraphData) {
    return window.getCachedGraphData();
  }
  return cloneJSON(window.GSPRuntime?.graphData || null);
}

function setRuntimeGraphData(data) {
  if (window.setCachedGraphData) {
    window.setCachedGraphData(data);
    return;
  }
  window.GSPRuntime = window.GSPRuntime || {};
  window.GSPRuntime.graphData = cloneJSON(data);
}

function hasRuntimeGraphData() {
  const data = getRuntimeGraphData();
  return !!(data && Array.isArray(data["X"]) && data["X"].length > 0);
}

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

  document.querySelectorAll('input[name="threshold-type"]').forEach((radio) => {
    radio.addEventListener("change", updateThresholdInputs);
  });
  updateThresholdInputs(); // Call on load
  toggleClusterParamsVisibility();
  toggleClusterAlgorithmParams();
  refreshDirectionColorControls();

  const clusterEl = document.getElementById("cluster-mode");
  if (clusterEl) {
    clusterEl.addEventListener("change", () => {
      toggleClusterParamsVisibility();

      // Turning OFF can update visuals immediately (no backend)
      const hasRendered = hasRuntimeGraphData();
      if (!clusterEl.checked && hasRendered && frame?.updateGraphStyling) {
        frame.updateGraphStyling();
      }
    });
  }
  if (clusterAlgorithmSelect) {
    clusterAlgorithmSelect.addEventListener("change", () => {
      toggleClusterAlgorithmParams();
    });
  }

  if (!localStorage.getItem("previous_settings")) {
    const cur = localStorage.getItem("settings") || JSON.stringify(defaultSettings);
    localStorage.setItem("previous_settings", cur);
  }
}

function toggleClusterParamsVisibility() {
  const clusterEl = document.getElementById("cluster-mode");
  const box = document.getElementById("cluster-params");

  if (!clusterEl || !box) return;

  if (!clusterEl.checked) {
    box.style.display = "none";
    return;
  }

  box.style.display = "block";
  toggleClusterAlgorithmParams();
}

function toggleClusterAlgorithmParams() {
  if (!clusterAlgorithmSelect || !hdbscanOptionsContainer || !opticsOptionsContainer) return;

  const selected = clusterAlgorithmSelect.value;

  if (selected === "hdbscan") {
    hdbscanOptionsContainer.style.display = "block";
    opticsOptionsContainer.style.display = "none";
  } else if (selected === "optics") {
    hdbscanOptionsContainer.style.display = "none";
    opticsOptionsContainer.style.display = "block";
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

  // Restore reduction UI too
  const reduction = settings.reduction || defaultUmap;

  if (algorithmSelect) {
    algorithmSelect.value = reduction.mode || "umap";
  }

  if (reduction.mode === "umap") {
    const nn = document.getElementById("umapNNeighbors");
    const seed = document.getElementById("umapRandomState");
    const minDist = document.getElementById("umapMinDist");

    if (nn) nn.value = reduction.n_neighbors ?? 15;
    if (seed) seed.value = reduction.seed ?? 0;
    if (minDist) minDist.value = reduction.min_dist ?? 0.1;
  } else if (reduction.mode === "tsne") {
    const perplexity = document.getElementById("tsnePerplexity");
    const earlyEx = document.getElementById("tsneEarlyExaggeration");
    const maxIter = document.getElementById("tsneNIters");

    if (perplexity) perplexity.value = reduction.perplexity ?? 15.0;
    if (earlyEx) earlyEx.value = reduction.early_ex ?? 12.0;
    if (maxIter) maxIter.value = reduction.max_iter ?? 1000;
  } else if (reduction.mode === "isomap") {
    const nn = document.getElementById("isomapNNeighbors");
    if (nn) nn.value = reduction.n_neighbors ?? 5;
  }

  toggleAlgorithmParams();
  toggleClusterParamsVisibility();
  toggleClusterAlgorithmParams();
  refreshDirectionColorControls();
}

function getCurrentDirectionalMode() {
  const inputMode = localStorage.getItem("gene-input-mode") || "scored-genes";
  const testModeMap = {
    "scored-genes": localStorage.getItem("gene-test-mode-scored") || "positive",
    "single-textarea": localStorage.getItem("gene-test-mode-input") || "positive",
  };

  return {
    inputMode,
    testMode: testModeMap[inputMode] || "positive",
  };
}

function refreshDirectionColorControls() {
  const wrapper = document.getElementById("negative-significant-color-wrapper");
  const positiveLabel = document.getElementById("significant-color-label");
  if (!wrapper || !positiveLabel) {
    return;
  }

  const { inputMode, testMode } = getCurrentDirectionalMode();
  const useDirectionalColors =
    (inputMode === "scored-genes" || inputMode === "single-textarea") &&
    testMode === "both";

  wrapper.style.display = useDirectionalColors ? "flex" : "none";
  positiveLabel.textContent = useDirectionalColors ? "Most Positive:" : "Most Significant:";
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

function getReductionDiff(setting1, setting2) {
  const reduction1 = setting1["reduction"] || {};
  const reduction2 = setting2["reduction"] || {};
  const selectedAlgorithm = reduction1["mode"];

  if (reduction1["mode"] !== reduction2["mode"]) return true;

  if (selectedAlgorithm === "umap") {
    return (
      reduction1["n_neighbors"] !== reduction2["n_neighbors"] ||
      reduction1["seed"] !== reduction2["seed"] ||
      reduction1["min_dist"] !== reduction2["min_dist"]
    );
  } else if (selectedAlgorithm === "tsne") {
    return (
      reduction1["perplexity"] !== reduction2["perplexity"] ||
      reduction1["early_ex"] !== reduction2["early_ex"] ||
      reduction1["max_iter"] !== reduction2["max_iter"]
    );
  } else if (selectedAlgorithm === "isomap") {
    return reduction1["n_neighbors"] !== reduction2["n_neighbors"];
  }

  return false;
}

function updateSettings(suppressToast = false) {
  let newSettings = {};
  newSettings.umapChange = false;

  const appliedSettings = JSON.parse(localStorage.getItem("previous_settings") || "{}");

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
  newSettings["reduction"] = reduction;
  newSettings["mode"] = reduction["mode"];

  // Distance type
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

  // Threshold type
  const pvThr = document.getElementById("pvalue-input")?.value;
  const fdrThr = document.getElementById("fdr-input")?.value;
  const selectedType = document.querySelector('input[name="threshold-type"]:checked')?.value;

  if (selectedType === "pvalue") {
    newSettings["p_value_threshold"] = parseFloat(pvThr);
    delete newSettings["fdr_threshold"];
    localStorage.setItem("p-value", newSettings["p_value_threshold"]);
    localStorage.removeItem("fdr");
  } else {
    newSettings["fdr_threshold"] = parseFloat(fdrThr);
    delete newSettings["p_value_threshold"];
    localStorage.setItem("fdr", newSettings["fdr_threshold"]);
    localStorage.removeItem("p-value");
  }

  // Detect changes vs applied baseline
  const isDataChange = isEmbeddingChanged(newSettings, appliedSettings);
  const thresholdChange = isThresholdChanged(newSettings, appliedSettings);

  const clusterChanged =
    (newSettings["cluster-mode"] !== appliedSettings["cluster-mode"]) ||
    (newSettings["cluster-algorithm"] !== appliedSettings["cluster-algorithm"]) ||
    (newSettings["hdbscan-min-cluster-size"] !== appliedSettings["hdbscan-min-cluster-size"]) ||
    (newSettings["hdbscan-min-samples"] !== appliedSettings["hdbscan-min-samples"]) ||
    (newSettings["optics-min-cluster-size"] !== appliedSettings["optics-min-cluster-size"]) ||
    (newSettings["optics-min-samples"] !== appliedSettings["optics-min-samples"]) ||
    (newSettings["optics-xi"] !== appliedSettings["optics-xi"]);

  const stylingOnly = detectFrontendOnlyChanges();

  // decide justStyling
  const justStyling = stylingOnly && !isDataChange && !thresholdChange && !clusterChanged;
  localStorage.setItem("justStyling", justStyling ? "true" : "false");

  // mark umapChange based on applied baseline
  if (isDataChange) {
    newSettings.umapChange = true;
  }

  // Save ONLY current UI settings
  localStorage.setItem("settings", JSON.stringify(newSettings));

  const anythingChanged = stylingOnly || isDataChange || thresholdChange || clusterChanged;

  // --------------------
  // FORCE CLUSTER APPLY when:
  // - graph already rendered
  // - cluster-mode is ON
  // - BUT current in-memory graph data has no clusterID (or clusterID empty / all -1)
  // This fixes: submit with cluster OFF, later turn ON and apply with same params => should still run HDBSCAN.
  // --------------------
  const hasRendered = hasRuntimeGraphData();

  let needClusterCompute = false;
  if (hasRendered && newSettings["cluster-mode"] === true) {
    try {
      const d = getRuntimeGraphData() || {};
      const cids = d.clusterID;

      if (!Array.isArray(cids) || cids.length === 0) {
        needClusterCompute = true;
      } else {
        const allEmpty = cids.every(v => v === -1 || v === null || v === undefined);
        if (allEmpty) needClusterCompute = true;
      }
    } catch (e) {
      needClusterCompute = true;
    }
  }

  localStorage.setItem("forceClusterApply", needClusterCompute ? "true" : "false");

  // If nothing changed in settings BUT we need cluster, still apply.
  if (!anythingChanged && needClusterCompute) {
    if (!suppressToast) {
      const toast = document.getElementById("toast-message");
      if (toast) {
        toast.style.display = "block";
        toast.style.color = "#2ecc71";
        toast.textContent = "Cluster mode enabled — computing clusters...";
        setTimeout(() => { toast.style.display = "none"; }, 2000);
      }
    }

    hasUnsavedSettings = false;
    applySettingsAndRender(); // will run cluster-only path
    return;
  }

  if (!anythingChanged) {
    if (!suppressToast) {
      const toast = document.getElementById("toast-message");
      if (toast) {
        toast.style.display = "block";
        toast.style.color = "#2ecc71";
        toast.textContent = "No changes detected.";
        setTimeout(() => { toast.style.display = "none"; }, 2000);
      }
    }
    hasUnsavedSettings = false;
    return;
  }

  const toast = document.getElementById("toast-message");
  if (toast && !suppressToast) {
    toast.style.display = "block";
    toast.style.color = "#2ecc71";

    const hasRendered = hasRuntimeGraphData();

    if (hasRendered) {
      toast.textContent = "Settings applied! Graph will update...";
      applySettingsAndRender();
    } else {
      toast.textContent = "Settings saved! Click Submit to generate the graph.";
    }

    setTimeout(() => { toast.style.display = "none"; }, 2000);
  }

  hasUnsavedSettings = false;
}

function detectFrontendOnlyChanges() {
  const current = {
    sigColor: document.getElementById("significant-color")?.value,
    negSigColor: document.getElementById("negative-significant-color")?.value,
    insigColor: document.getElementById("insignificant-color")?.value,
    selectedColor: document.getElementById("selected-color")?.value,
    fixed: document.getElementById("fixed-size")?.checked,
    dynamic: document.getElementById("dynamic-size")?.checked,
    fixedSizeVal: document.getElementById("fixed-size-input")?.value,
    dynamicScalar: document.getElementById("dynamic-size-scalar")?.value,
    showSigOnly: document.getElementById("show-sig-only")?.checked,
    showEnrichmentOrder: document.getElementById("show-enrichment-order")?.checked,
  };

  const previousRaw = localStorage.getItem("previous_styling");
  const previous = previousRaw ? JSON.parse(previousRaw) : current;

  const changed = Object.keys(current).some((key) => current[key] !== previous[key]);

  localStorage.setItem("previous_styling", JSON.stringify(current));
  return changed;
}

async function applyClusterOnly() {
  const settings = JSON.parse(localStorage.getItem("settings") || "{}");
  const clusterAlgorithm = settings["cluster-algorithm"] || "hdbscan";

  const fullData = getRuntimeGraphData();
  if (!fullData || !Array.isArray(fullData["X"]) || fullData["X"].length < 4) {
    throw new Error("Missing graph data. Please click Submit once to generate the graph first.");
  }

  const totalPoints = fullData["X"].length;
  const pointsForClustering = {
    X: fullData["X"],
    Y: fullData["Y"],
    setName: Array.isArray(fullData["setName"])
      ? fullData["setName"]
      : new Array(totalPoints).fill(""),
    molecules: Array.isArray(fullData["molecules"])
      ? fullData["molecules"]
      : new Array(totalPoints).fill(""),
    pValue: Array.isArray(fullData["pValue"])
      ? fullData["pValue"]
      : new Array(totalPoints).fill(null),
  };

  let payload = {
    points: pointsForClustering,
    cluster_algorithm: clusterAlgorithm,
  };

  if (clusterAlgorithm === "hdbscan") {
    const minClusterSize = parseInt(settings["hdbscan-min-cluster-size"] || "5", 10);
    const minSamplesRaw = settings["hdbscan-min-samples"];
    const minSamples =
      (minSamplesRaw === "" || minSamplesRaw == null) ? null : parseInt(minSamplesRaw, 10);

    payload.min_cluster_size = minClusterSize;
    payload.min_samples = minSamples;
  } else if (clusterAlgorithm === "optics") {
    const minClusterSizeRaw = settings["optics-min-cluster-size"];
    const minClusterSize =
      (minClusterSizeRaw === "" || minClusterSizeRaw == null) ? null : parseInt(minClusterSizeRaw, 10);

    const minSamples = parseInt(settings["optics-min-samples"] || "5", 10);
    const xi = parseFloat(settings["optics-xi"] || "0.05");

    payload.min_cluster_size = minClusterSize;
    payload.min_samples = minSamples;
    payload.xi = xi;
  }

  const res = await fetch("/cluster_only/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const out = await res.json();
  if (!res.ok) throw new Error(out?.error || "Cluster-only request failed.");

  fullData["clusterID"] = out.cluster_ids;
  fullData["clusterLabel"] = out.cluster_labels;
  setRuntimeGraphData(fullData);

  localStorage.removeItem("camera");
  localStorage.removeItem("annotations");
  localStorage.setItem("selected", "[]");
  localStorage.setItem("reset", JSON.stringify(true));

  clearPoints();
  frame.graph();
}

async function applySettingsAndRender() {
  const loadingSpinner = document.getElementById("loading-spinner");
  loadingSpinner.style.display = "flex";

  const backupData = getRuntimeGraphData();
  const backupSettings = localStorage.getItem("settings");
  const backupPrevSettings = localStorage.getItem("previous_settings");

  try {
    const newSettings = JSON.parse(localStorage.getItem("settings") || "{}");
    const oldSettings = JSON.parse(localStorage.getItem("previous_settings") || "{}");

    const stylingOnly = localStorage.getItem("justStyling") === "true";
    localStorage.removeItem("justStyling");

    const hasRendered = hasRuntimeGraphData();

    const dataChange = isEmbeddingChanged(newSettings, oldSettings);
    const thresholdChange = isThresholdChanged(newSettings, oldSettings);

    const clusterChanged =
      (newSettings["cluster-mode"] !== oldSettings["cluster-mode"]) ||
      (newSettings["cluster-algorithm"] !== oldSettings["cluster-algorithm"]) ||
      (newSettings["hdbscan-min-cluster-size"] !== oldSettings["hdbscan-min-cluster-size"]) ||
      (newSettings["hdbscan-min-samples"] !== oldSettings["hdbscan-min-samples"]) ||
      (newSettings["optics-min-cluster-size"] !== oldSettings["optics-min-cluster-size"]) ||
      (newSettings["optics-min-samples"] !== oldSettings["optics-min-samples"]) ||
      (newSettings["optics-xi"] !== oldSettings["optics-xi"]);

    const forceClusterApply = localStorage.getItem("forceClusterApply") === "true";
    localStorage.removeItem("forceClusterApply");

    // 1) Styling-only update (fast path)
    if (hasRendered && stylingOnly && !dataChange && !thresholdChange && !clusterChanged) {
      if (frame?.updateGraphStyling) frame.updateGraphStyling();
      localStorage.setItem("previous_settings", JSON.stringify(newSettings));
      loadingSpinner.style.display = "none";
      return;
    }

    // 2) Cluster-only apply (Option 2)
    // Run when clusterChanged OR forceClusterApply.
    // If analysis_id missing/expired => fallback to full rerun below.
    if (
      hasRendered &&
      newSettings["cluster-mode"] === true &&
      (clusterChanged || forceClusterApply) &&
      !dataChange &&
      !thresholdChange
    ) {
      await applyClusterOnly();
      localStorage.setItem("previous_settings", JSON.stringify(newSettings));
      const fp = window.computeCurrentAnalysisFingerprint?.();
      if (fp) {
        window.setLastComputeFingerprint?.(fp);
      }
      loadingSpinner.style.display = "none";
      return;
    }

    // 3) Cluster turned OFF (only cluster settings changed) => no backend; just restyle
    if (hasRendered && newSettings["cluster-mode"] === false && clusterChanged && !dataChange && !thresholdChange) {
      if (frame?.updateGraphStyling) frame.updateGraphStyling();
      localStorage.setItem("previous_settings", JSON.stringify(newSettings));
      const fp = window.computeCurrentAnalysisFingerprint?.();
      if (fp) {
        window.setLastComputeFingerprint?.(fp);
      }
      loadingSpinner.style.display = "none";
      return;
    }

    // 4) Otherwise: full rerun pipeline (Submit-like)
    const inputMode = localStorage.getItem("gene-input-mode");
    const singleList = JSON.parse(localStorage.getItem("single-list") || "false");

    if (inputMode === "scored-genes") {
      await frame.getScoredGenesData(newSettings);
    } else if (singleList) {
      await frame.getGeneData(newSettings);
    } else {
      await frame.getGeneInputData(newSettings);
    }

    const fullData = getRuntimeGraphData();
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
    const fp = window.computeCurrentAnalysisFingerprint?.();
    if (fp) {
      window.setLastComputeFingerprint?.(fp);
    }
    loadingSpinner.style.display = "none";
  } catch (error) {
    // Roll back to backup if possible
    try {
      const parsedBackup = backupData;
      if (parsedBackup && Array.isArray(parsedBackup["X"]) && parsedBackup["X"].length >= 4) {
        setRuntimeGraphData(backupData);

        if (backupSettings != null) localStorage.setItem("settings", backupSettings);
        if (backupPrevSettings != null) localStorage.setItem("previous_settings", backupPrevSettings);

        localStorage.removeItem("camera");
        localStorage.removeItem("annotations");
        localStorage.setItem("selected", "[]");
        localStorage.setItem("reset", JSON.stringify(true));

        clearPoints();
        frame.graph();
      }
    } catch (e) {
      // ignore rollback errors
    }

    loadingSpinner.style.display = "none";
    alert("Error applying settings: " + (error?.message || String(error)));
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

    const checkboxKeys = new Set([
      "fixed-size",
      "dynamic-size",
      "cluster-mode"
    ]);

    for (const [key, element] of Object.entries(inputRefrences)) {
      if (!element) continue;

      if (checkboxKeys.has(key)) {
        newSettings[key] = element.checked;
      } else {
        newSettings[key] = element.value;
      }
    }

    const reduction = getReduction();
    newSettings["reduction"] = reduction;
    newSettings["mode"] = reduction["mode"];

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
  displayValues: displayValues,
  refreshDirectionColorControls: refreshDirectionColorControls,
};

function updateThresholdInputs() {
  const selectedType = document.querySelector('input[name="threshold-type"]:checked')?.value;
  const pInput = document.getElementById("pvalue-input");
  const fdrInput = document.getElementById("fdr-input");
  const pWrapper = document.getElementById("pvalue-wrapper");
  const fWrapper = document.getElementById("fdr-wrapper");

  const storedAppliedP = localStorage.getItem("p-value");
  const storedAppliedFDR = localStorage.getItem("fdr");
  const storedComputedP = localStorage.getItem("computed-p-value");
  const storedComputedFDR = localStorage.getItem("computed-fdr");

  if (selectedType === "pvalue") {
    if (storedAppliedP !== null) {
      pInput.value = storedAppliedP;
    } else if (storedComputedP !== null) {
      pInput.value = storedComputedP;
    } else if (lastPValue !== "") {
      pInput.value = lastPValue;
    } else {
      pInput.value = "0.05";
    }

    lastFDR = fdrInput.value;

    pInput.removeAttribute("readonly");
    fdrInput.setAttribute("readonly", true);

    pWrapper.classList.remove("grayed-out");
    fWrapper.classList.add("grayed-out");
  } else {
    if (storedAppliedFDR !== null) {
      fdrInput.value = storedAppliedFDR;
    } else if (storedComputedFDR !== null) {
      fdrInput.value = storedComputedFDR;
    } else if (lastFDR !== "") {
      fdrInput.value = lastFDR;
    } else {
      fdrInput.value = "0.05";
    }

    lastPValue = pInput.value;

    fdrInput.removeAttribute("readonly");
    pInput.setAttribute("readonly", true);

    fWrapper.classList.remove("grayed-out");
    pWrapper.classList.add("grayed-out");
  }

  localStorage.setItem("threshold-type", selectedType);
}

window.addEventListener("load", () => {
  if (!localStorage.getItem("previous_settings")) {
    const cur = localStorage.getItem("settings") || JSON.stringify(defaultSettings);
    localStorage.setItem("previous_settings", cur);
    console.log("[update_settings] re-seeded previous_settings on window.load");
  }
});
