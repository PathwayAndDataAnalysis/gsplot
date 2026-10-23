const collectionMetadataUrl = document.currentScript?.dataset.collectionMetadataUrl;
let collectionMetadataRequest;

function loadCollectionMetadata() {
  if (!collectionMetadataUrl) return Promise.resolve({});
  if (!collectionMetadataRequest) {
    collectionMetadataRequest = fetch(collectionMetadataUrl)
      .then(response => {
        if (!response.ok) throw new Error("Unable to load collection descriptions.");
        return response.json();
      })
      .catch(error => {
        console.warn(error);
        collectionMetadataRequest = null;
        return {};
      });
  }
  return collectionMetadataRequest;
}

function renderCollectionSections(treeData, metadata = {}, species = null) {
  const container = document.getElementById("tree-container");
  container.querySelectorAll(".collection-picker, #selected-group-label, #selection-controls, svg").forEach(el => el.remove());
  const picker = document.createElement("div");
  picker.className = "collection-picker";
  container.querySelector("h3").after(picker);
  const selected = new Map();
  const preferenceKey = species ? `collection-selection-${species}` : null;
  let savedPaths = null;
  if (preferenceKey) {
    try {
      const stored = JSON.parse(localStorage.getItem(preferenceKey) || "null");
      if (Array.isArray(stored) && stored.every(path => typeof path === "string")) savedPaths = stored;
    } catch { /* Ignore invalid saved preferences. */ }
  }
  const rows = [];
  const keyOf = gs => JSON.stringify([gs.collection || "", gs.name]);
  const genesOf = node => {
    const unique = new Map();
    (node.geneSets || []).forEach(gs => unique.set(keyOf(gs), gs));
    (node.children || []).forEach(child => genesOf(child).forEach(gs => unique.set(keyOf(gs), gs)));
    return [...unique.values()];
  };
  const toolbar = document.createElement("div");
  toolbar.className = "collection-toolbar";
  const hint = document.createElement("p");
  hint.textContent = "Choose entire collections or individual subcollections.";
  toolbar.append(hint);
  const actions = document.createElement("div");
  actions.className = "collection-actions";
  toolbar.append(actions);
  picker.append(toolbar);
  const grid = document.createElement("div");
  grid.className = "collection-grid";
  picker.append(grid);
  const status = document.createElement("div");
  status.id = "selected-group-label";
  status.className = "collection-status";
  status.setAttribute("role", "status");
  picker.append(status);

  function sync(persist = false) {
    const paths = [];
    const selectedItems = new Set();
    rows.forEach(row => {
      const count = row.genes.filter(gs => selected.has(keyOf(gs))).length;
      row.input.checked = count > 0 && count === row.genes.length;
      row.input.indeterminate = count > 0 && count < row.genes.length;
      row.label.classList.toggle("is-selected", count > 0);
      if (row.input.checked) {
        selectedItems.add(row.path);
        if (!rows.some(parent => parent !== row && row.path.startsWith(parent.path + " > ") && parent.genes.every(gs => selected.has(keyOf(gs))))) paths.push(row.path);
      }
    });
    window.selectedItems = selectedItems;
    window.selectedGeneSets = [...selected.values()];
    window.GSP = window.GSP || {};
    window.GSP.selectedGeneSets = window.selectedGeneSets;
    window.selectedCollectionLabel = paths.join(", ");
    status.textContent = selected.size ? `${selected.size.toLocaleString()} gene sets selected - ${paths.join(", ") || "Partial collection selection"}` : "No gene sets selected. Tick a checkbox to get started.";
    if (persist && preferenceKey) {
      localStorage.setItem(preferenceKey, JSON.stringify(paths));
      hint.textContent = "Your collection selection is saved for next time. You can change it below.";
    }
  }

  function addRow(node, host, path, depth = 0) {
    const genes = genesOf(node);
    const info = metadata[path.split(" > ").join(":")];
    const label = document.createElement("label");
    label.className = depth ? "collection-option" : "collection-heading-label";
    label.style.setProperty("--collection-depth", Math.max(0, depth - 1));
    const input = document.createElement("input");
    input.type = "checkbox";
    input.disabled = genes.length === 0;
    const name = document.createElement("span");
    name.className = "collection-name";
    name.textContent = info ? `${node.name} \u2014 ${info.title}` : node.name;
    const count = document.createElement("span");
    count.className = "collection-count";
    count.textContent = `${genes.length.toLocaleString()} sets`;
    label.append(input, name, count);
    let selectionRow = label;
    let childHost = host;
    if (depth === 0) {
      const heading = document.createElement("div");
      heading.className = "collection-heading";
      selectionRow = heading;
      if (node.children && node.children.length) {
        childHost = document.createElement("div");
        childHost.className = "collection-subcollections";
        childHost.id = `collection-subcollections-${rows.length}`;
        childHost.hidden = true;
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "collection-toggle";
        toggle.setAttribute("aria-expanded", "false");
        toggle.setAttribute("aria-controls", childHost.id);
        toggle.setAttribute("aria-label", `Expand ${node.name} subcollections`);
        const arrow = document.createElement("span");
        arrow.className = "collection-chevron";
        arrow.setAttribute("aria-hidden", "true");
        toggle.append(arrow);
        toggle.addEventListener("click", () => {
          const expanded = childHost.hidden;
          childHost.hidden = !expanded;
          toggle.setAttribute("aria-expanded", String(expanded));
          toggle.setAttribute("aria-label", `${expanded ? "Collapse" : "Expand"} ${node.name} subcollections`);
        });
        heading.append(toggle);
      }
      heading.append(label);
      host.append(heading);
      if (info) host.append(createCollectionDescription(info, node.name));
      if (childHost !== host) host.append(childHost);
    } else {
      host.append(label);
    }
    rows.push({ input, label: selectionRow, genes, path });
    input.addEventListener("change", () => {
      genes.forEach(gs => input.checked ? selected.set(keyOf(gs), gs) : selected.delete(keyOf(gs)));
      sync(true);
    });
    (node.children || []).forEach(child => addRow(child, childHost, `${path} > ${child.name}`, depth + 1));
  }
  (treeData.children || []).slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })).forEach(node => {
    const section = document.createElement("section");
    section.className = "collection-section";
    section.setAttribute("aria-label", node.name);
    grid.append(section);
    addRow(node, section, node.name);
  });
  [["Select all", () => genesOf(treeData).forEach(gs => selected.set(keyOf(gs), gs))], ["Clear all", () => selected.clear()]].forEach(([text, action]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = text;
    button.addEventListener("click", () => { action(); sync(true); });
    actions.append(button);
  });
  if (preferenceKey) {
    const initialPaths = savedPaths ?? [species === "mouse" ? "M5 > GO" : "C5 > GO"];
    rows.filter(row => initialPaths.includes(row.path)).forEach(row => {
      row.genes.forEach(gs => selected.set(keyOf(gs), gs));
    });
    hint.textContent = savedPaths === null
      ? `GO (Gene Ontology) in ${species === "mouse" ? "M5" : "C5"} is selected by default. Change the selection below; we will remember your choice.`
      : "Your previous collection selection has been restored. You can change it below.";
    // Make the selected subcollection visible without requiring an extra click.
    grid.querySelectorAll(".collection-section").forEach(section => {
      if ([...section.querySelectorAll('input[type="checkbox"]')].some(input =>
        rows.some(row => row.input === input && row.genes.some(gs => selected.has(keyOf(gs)))))) {
        section.querySelector(".collection-toggle")?.click();
      }
    });
  }
  sync();
}

function createCollectionDescription(info, code) {
  const description = document.createElement("div");
  description.className = "collection-description";
  const brief = document.createElement("p");
  brief.textContent = info.description;
  const details = document.createElement("details");
  details.className = "collection-information";
  const summary = document.createElement("summary");
  summary.textContent = "i";
  summary.setAttribute("aria-label", `More information about ${code} - ${info.title}`);
  summary.title = `About ${info.title}`;
  const content = document.createElement("div");
  content.className = "collection-information-content";
  const text = document.createElement("p");
  text.textContent = info.details;
  const link = document.createElement("a");
  link.textContent = "View on MSigDB";
  link.href = info.detailsUrl || info.sourceUrl;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  content.append(text, link);
  details.append(summary, content);
  description.append(brief, details);
  return description;
}

function uploadAndRenderCustomGeneSets(file) {
  if (!file) return Promise.resolve();

  const formData = new FormData();
  formData.append("file", file);

  return fetch("/api/upload_custom_gene_sets/", {
    method: "POST",
    body: formData
  })
    .then(res => res.json())
    .then(data => {
      if (data.error) {
        throw new Error(data.error);
      }
      if (data.treeType !== "msigdb" || !data.data) {
        throw new Error("Unknown custom gene set format returned by server.");
      }

      window.selectedItems = new Set();
      window.GSP = window.GSP || {};
      window.GSP.selectedGeneSets = [];
      localStorage.setItem("selected", "[]");
      const label = document.getElementById("selected-group-label");
      if (label) label.remove();

      const treeData = buildSimpleTree(data.data);
      renderCollectionSections(treeData);
      window.GSP.customGeneSets = { data: data.data };
    });
}

// Load the tree based on dataset selection
function handleSpeciesChange() {
  const species = document.getElementById("species-select").value;
  if (species !== "custom") localStorage.setItem("collection-dataset", species);
  const uploadSection = document.getElementById("custom-upload-section");

  // CLEAR SELECTION before loading new tree
  window.selectedItems = new Set();
  window.GSP = window.GSP || {};
  window.GSP.selectedGeneSets = [];
  window.selectedGeneSets = [];
  window.selectedCollectionLabel = "";
  localStorage.setItem("selected", "[]");

  // Remove label under tree
  const label = document.getElementById("selected-group-label");
  if (label) label.remove();

  if (species === "custom") {
    uploadSection.style.display = "block";
    document.querySelectorAll("#tree-container .collection-picker").forEach(el => el.remove());

    // Force re-process if a file was already selected before
    const fileInput = document.getElementById("custom-json-input");
    if (fileInput && fileInput.files.length > 0) {
      const file = fileInput.files[0];
      uploadAndRenderCustomGeneSets(file)
        .catch(error => {
          console.error("Error reloading custom gene sets:", error);
          alert("Failed to re-load custom gene sets. " + (error?.message || ""));
        });
    }
    return;
  } else {
    uploadSection.style.display = "none";

    Promise.all([
      fetch(`/api/msigdb/?species=${species}`).then(res => res.json()),
      loadCollectionMetadata()
    ])
      .then(([msigdb, metadata]) => {
        if (document.getElementById("species-select").value !== species) return;
        const data = buildSimpleTree(msigdb);
        renderCollectionSections(data, metadata[species] || {}, species);
      })
      .catch(error => {
        console.error("Error loading MSigDB data:", error);
      });
  }
}

window.handleSpeciesChange = handleSpeciesChange;

// Auto draw human tree when server starts
document.addEventListener("DOMContentLoaded", () => {
  const savedSpecies = localStorage.getItem("collection-dataset");
  if (["human", "mouse"].includes(savedSpecies)) {
    document.getElementById("species-select").value = savedSpecies;
  }
  handleSpeciesChange();
});

function buildSimpleTree(msigdb) {
  const root = { name: "Gene Set Collections", children: [] };

  for (const [setName, info] of Object.entries(msigdb)) {
    const collection = String(info.collection || "").trim();
    const subcollection = String(info.subcollection || "").trim();
    const levels = collection
      ? collection.split(":").map(s => s.trim()).filter(Boolean)
      : ["Custom"];
    if (subcollection) {
      subcollection.split(":").map(s => s.trim()).filter(Boolean).forEach((level) => levels.push(level));
    }
    const geneSetEntry = { name: setName, collection };

    let currentLevel = root;

    for (let i = 0; i < levels.length; i++) {
      const levelName = levels[i];
      if (!currentLevel.children) currentLevel.children = [];

      let existingChild = currentLevel.children.find(child => child.name === levelName);
      if (!existingChild) {
        existingChild = { name: levelName };
        currentLevel.children.push(existingChild);
      }

      if (!existingChild.geneSets) existingChild.geneSets = [];
      existingChild.geneSets.push(geneSetEntry);

      currentLevel = existingChild;
    }
  }

  return root;
}

document.addEventListener("DOMContentLoaded", () => {
  const fileInput = document.getElementById("custom-json-input");

  if (fileInput) {
    fileInput.addEventListener("change", () => {
      const file = fileInput.files[0];
      if (!file) {
        // User cancelled file picker
        if (window.lastUploadedFile) {
          fileInput.files = createFileList(window.lastUploadedFile);
        }
        return;
      }

      // Save the file in memory for cancel-recovery
      window.lastUploadedFile = file;

      uploadAndRenderCustomGeneSets(file)
        .catch(err => {
          console.error("Upload error:", err);
          alert("Error: upload failed. " + (err?.message || ""));
        });
    });
  }
});

function createFileList(file) {
  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(file);
  return dataTransfer.files;
}
