function drawD3Tree(treeData) {
  let i = 0;  // Unique ID counter for each node
  const container = document.getElementById('tree-container');
  const containerWidth = container.clientWidth;
  const width = Math.min(1000, containerWidth - 60); // Increased max width
  const dx = 35; // Increased vertical spacing between nodes
  const dy = width / 4; // Increased horizontal spacing between levels
  const margin = { top: 20, right: 40, bottom: 20, left: 40 };

  const diagonal = d3.linkHorizontal().x(d => d.y).y(d => d.x);
  const treeLayout = d3.tree().nodeSize([dx, dy]);

  const root = d3.hierarchy(treeData);
  root.x0 = 0;
  root.y0 = 0;

  // Collapse after second level
  if (root.children) {
    root.children.forEach(collapse);
  }

  // Clear any existing SVG and buttons
  d3.select("#tree-container").select("svg").remove();
  const existingButtons = document.querySelector("#selection-controls");
  if (existingButtons) existingButtons.remove();

  // Initialize selected items tracking
  if (!window.selectedItems) {
    window.selectedItems = new Set();
  }

  // Create control buttons
  createSelectionControls();

  const svg = d3
    .select("#tree-container")
    .append("svg")
    .attr("width", "100%")
    .style("font", "0.8em sans-serif")
    .style("user-select", "none");

  const g = svg.append("g");

  const gLink = g.append("g")
    .attr("fill", "none")
    .attr("stroke", "#555")
    .attr("stroke-opacity", 0.4)
    .attr("stroke-width", 1.5);

  const gNode = g.append("g")
    .attr("cursor", "pointer")
    .attr("pointer-events", "all");

  update(root);

  function update(source) {
    const nodes = root.descendants().reverse();
    const links = root.links();

    // Compute the tree layout
    treeLayout(root);

    // Find the bounds of the tree
    let left = root;
    let right = root;
    let top = root;
    let bottom = root;

    root.eachBefore(node => {
      if (node.x < left.x) left = node;
      if (node.x > right.x) right = node;
      if (node.y < top.y) top = node;
      if (node.y > bottom.y) bottom = node;
    });

    // Calculate the actual tree dimensions
    const treeHeight = right.x - left.x + 80; // Increased padding for node boxes
    const treeWidth = bottom.y - top.y + 200; // Increased padding for node boxes

    // Update SVG height
    const containerHeight = treeHeight + 80;
    svg.attr("height", containerHeight);

    // Calculate centering offsets - make tree larger by reducing centering
    const offsetX = Math.max(margin.left, (width - treeWidth) / 3) - top.y + margin.left;
    const offsetY = Math.max(margin.top, (containerHeight - treeHeight) / 3) - left.x + margin.top;

    // Update the viewBox to center the tree
    svg.attr("viewBox", `0 0 ${width + margin.left + margin.right} ${containerHeight}`);

    // Apply the centering transform to the main group
    const transition = svg.transition().duration(750);
    g.transition(transition).attr("transform", `translate(${offsetX}, ${offsetY})`);

    const node = gNode.selectAll("g").data(nodes, d => d.id || (d.id = ++i));

    // Dynamic box sizing based on content
    const getBoxDimensions = (d) => {
      const name = d.data.name;
      const isRoot = !d.parent;
      return {
        width: isRoot ? Math.max(160, name.length * 8) : Math.max(110, name.length * 7),
        height: isRoot ? 32 : 28
      };
    };

    const nodeEnter = node
      .enter()
      .append("g")
      .attr("transform", d => `translate(${source.y0},${source.x0})`)
      .attr("fill-opacity", 0)
      .attr("stroke-opacity", 0)
      .on("click", (event, d) => {
        if (!d.parent) return;  // Skip root

        const nodeId = d.id || (d.id = ++i);

        if (event.ctrlKey || event.metaKey) {
          // 1. Remove all ancestors of this node from the selection
          let current = d.parent;
          while (current) {
            if (window.selectedItems.has(current.id)) {
              window.selectedItems.delete(current.id);
            }
            current = current.parent;
          }

          // 2. Remove all descendants of this node from the selection
          d.descendants().forEach(desc => {
            if (desc !== d && window.selectedItems.has(desc.id)) {
              window.selectedItems.delete(desc.id);
            }
          });

          // 3. Toggle this node
          if (window.selectedItems.has(nodeId)) {
            window.selectedItems.delete(nodeId); // Unselect if selected
          } else {
            window.selectedItems.add(nodeId);    // Add new selection
          }

        } else {
          // Just expand/collapse
          if (d.children) {
            d._children = d.children;
            d.children = null;
          } else if (d._children) {
            d.children = d._children;
            d._children = null;
          }
        }

        update(d);
        updateSelectionDisplay();
        updateNodeStyles();

        console.log("Selected items:", Array.from(window.selectedItems));
      });

    // Draw rectangles for nodes with dynamic sizing
    nodeEnter.append("rect")
      .attr("x", d => -getBoxDimensions(d).width / 2)
      .attr("y", d => -getBoxDimensions(d).height / 2)
      .attr("width", d => getBoxDimensions(d).width)
      .attr("height", d => getBoxDimensions(d).height)
      .attr("rx", 4)
      .attr("ry", 4)
      .attr("fill", d => {
        if (!d.parent) return "#4a90e2"; // Root node color
        if (d._children || d.children) return "#a6cee3";
        return "#b2df8a"; // Leaf color
      })
      .attr("stroke", "#333")
      .attr("stroke-width", 1.2);

    // Add text labels with dynamic sizing
    nodeEnter.append("text")
      .attr("dy", "0.31em")
      .attr("text-anchor", "middle")
      .style("font-weight", d => !d.parent ? "bold" : "bold")
      .style("font-size", d => !d.parent ? "0.85em" : "0.8em")
      .style("fill", d => !d.parent ? "white" : "#333")
      .text(d => {
        const name = d.data.name;
        const isRoot = !d.parent;
        const maxLength = isRoot ? 20 : 15;
        return name.length > maxLength ? name.substring(0, maxLength - 3) + "..." : name;
      });

    // Merge and update existing nodes
    const nodeUpdate = node
      .merge(nodeEnter)
      .transition(transition)
      .attr("transform", d => `translate(${d.y},${d.x})`)
      .attr("fill-opacity", 1)
      .attr("stroke-opacity", 1);

    // Remove exiting nodes
    const nodeExit = node
      .exit()
      .transition(transition)
      .remove()
      .attr("transform", d => `translate(${source.y},${source.x})`)
      .attr("fill-opacity", 0)
      .attr("stroke-opacity", 0);

    // Update links
    const link = gLink.selectAll("path").data(links, d => d.target.id);

    const linkEnter = link.enter().append("path").attr("d", d => {
      const o = { x: source.x0, y: source.y0 };
      return diagonal({ source: o, target: o });
    });

    link.merge(linkEnter).transition(transition).attr("d", d => {
      return diagonal({ source: { x: d.source.x, y: d.source.y }, target: { x: d.target.x, y: d.target.y } });
    });

    link.exit()
      .transition(transition)
      .remove()
      .attr("d", d => {
        const o = { x: source.x, y: source.y };
        return diagonal({ source: o, target: o });
      });

    // Store the old positions for transition
    root.eachBefore(d => {
      d.x0 = d.x;
      d.y0 = d.y;
    });

    // Update node styles after each update
    updateNodeStyles();
  }

  function updateNodeStyles() {
    // Reset all node styles
    gNode.selectAll("rect")
      .attr("stroke-width", 1.2)
      .attr("stroke", "#333");

    // Highlight selected nodes
    window.selectedItems.forEach(nodeId => {
      gNode.selectAll("g")
        .filter(d => d.id === nodeId)
        .select("rect")
        .attr("stroke-width", 3)
        .attr("stroke", "#ff6b35");
    });
  }

  function createSelectionControls() {
    const container = document.getElementById("tree-container");
    const controlsDiv = document.createElement("div");
    controlsDiv.id = "selection-controls";
    controlsDiv.style.cssText = `
     margin-bottom: 15px;
     display: flex;
     gap: 10px;
     align-items: center;
   `;

    const instruction = document.createElement("span");
    instruction.textContent = "Hold Ctrl/Cmd to select the option(s)";
    instruction.style.cssText = `
     font-size: 0.9em;
     color: #666;
     margin-right: 15px;
   `;

    const selectAllBtn = document.createElement("button");
    selectAllBtn.textContent = "Select All";
    selectAllBtn.style.cssText = `
     padding: 6px 12px;
     background-color: #4a90e2;
     color: white;
     border: none;
     border-radius: 4px;
     cursor: pointer;
     font-size: 0.85em;
   `;
    selectAllBtn.onclick = selectAllNodes;

    const clearAllBtn = document.createElement("button");
    clearAllBtn.textContent = "Clear All";
    clearAllBtn.style.cssText = `
     padding: 6px 12px;
     background-color: #e74c3c;
     color: white;
     border: none;
     border-radius: 4px;
     cursor: pointer;
     font-size: 0.85em;
   `;
    clearAllBtn.onclick = clearAllSelections;

    controlsDiv.appendChild(instruction);
    controlsDiv.appendChild(selectAllBtn);
    controlsDiv.appendChild(clearAllBtn);

    // Insert after the h3 element
    const h3 = container.querySelector("h3");
    h3.parentNode.insertBefore(controlsDiv, h3.nextSibling);
  }

  function selectAllNodes() {
    window.selectedItems.clear();

    const selectedGeneSetNames = new Set();

    root.descendants().forEach(d => {
      // Only allow top-level nodes with geneSets
      if (
        d.parent &&
        d.parent.data.name === "Gene Set Collections" && // Top-level only
        Array.isArray(d.data.geneSets)
      ) {
        const id = d.id || (d.id = ++i);
        window.selectedItems.add(id);

        // Track geneSet names to avoid duplicates
        d.data.geneSets.forEach(gs => {
          selectedGeneSetNames.add(`${gs.collection}:::${gs.name}`);
        });
      }
    });

    updateSelectionDisplay();
    updateNodeStyles();
  }

  function clearAllSelections() {
    window.selectedItems.clear();
    updateSelectionDisplay();
    updateNodeStyles();
  }

  function updateSelectionDisplay() {
    let label = document.getElementById("selected-group-label");
    if (!label) {
      const container = document.getElementById("tree-container");
      label = document.createElement("div");
      label.id = "selected-group-label";
      label.style.cssText = `
       margin-top: 15px;
       padding: 10px;
       background-color: #e8f4f8;
       border: 1px solid #4a90e2;
       border-radius: 5px;
       font-weight: bold;
       color: #2c5282;
       max-height: 120px;
       overflow-y: auto;
     `;
      container.appendChild(label);
    }

    if (window.selectedItems.size === 0) {
      label.textContent = "No items selected";
      label.style.backgroundColor = "#f8f9fa";
      label.style.borderColor = "#dee2e6";
      label.style.color = "#6c757d";
    } else {
      const selectedPaths = [];
      const selectedGeneSets = [];

      window.selectedItems.forEach(nodeId => {
        const node = root.descendants().find(d => d.id === nodeId);
        if (node) {
          selectedPaths.push(getFullPath(node));
          const isLeaf = !node.children && !node._children;
          if (node.data.geneSets && Array.isArray(node.data.geneSets)) {
            selectedGeneSets.push(...node.data.geneSets.map(gs => ({
              name: gs.name,
              collection: gs.collection
            })));
          } else {
            const descendants = (node.children || node._children || []);
            descendants.forEach(child => {
              if (child.data.geneSets) {
                selectedGeneSets.push(...child.data.geneSets.map(gs => ({
                  name: gs.name,
                  collection: gs.collection
                })));
              }
            });
          }
        }
      });

      // Remove duplicates
      const uniqueGeneSets = [...new Set(selectedGeneSets)];

      window.selectedGeneSets = uniqueGeneSets;
      window.GSP = window.GSP || {};
      window.GSP.selectedGeneSets = uniqueGeneSets;
      window.selectedCollectionLabel = selectedPaths.join(", ");

      label.innerHTML = `
       <strong>Selected (${window.selectedItems.size} items):</strong><br>
       ${selectedPaths.join("<br>")}
       <br><br>
       <strong>Total Gene Sets:</strong> ${uniqueGeneSets.length}
     `;
      label.style.backgroundColor = "#e8f4f8";
      label.style.borderColor = "#4a90e2";
      label.style.color = "#2c5282";
    }
  }

  function collapse(d) {
    if (d.children) {
      d._children = d.children;
      d._children.forEach(collapse);
      d.children = null;
    }
  }

  function getFullPath(d) {
    const names = [];
    while (d) {
      names.unshift(d.data.name);
      d = d.parent;
    }
    return names.join(" > ");
  }
}

// Load the tree based on dataset selection
function handleSpeciesChange() {
  const species = document.getElementById("species-select").value;
  const uploadSection = document.getElementById("custom-upload-section");

  // CLEAR SELECTION before loading new tree
  window.selectedItems = new Set();
  window.GSP = window.GSP || {};
  window.GSP.selectedGeneSets = [];
  localStorage.setItem("selected", "[]");

  // Remove label under tree
  const label = document.getElementById("selected-group-label");
  if (label) label.remove();

  if (species === "custom") {
    uploadSection.style.display = "block";
    d3.select("#tree-container").select("svg").remove();

    // Force re-process if a file was already selected before
    const fileInput = document.getElementById("custom-json-input");
    if (fileInput && fileInput.files.length > 0) {
      const file = fileInput.files[0];
      const formData = new FormData();
      formData.append("file", file);

      fetch("/api/upload_custom_gene_sets/", {
        method: "POST",
        body: formData
      })
        .then(res => res.json())
        .then(data => {
          if (data.treeType === "msigdb") {
            window.selectedItems = new Set();
            window.GSP = window.GSP || {};
            window.GSP.selectedGeneSets = [];
            localStorage.setItem("selected", "[]");
            const label = document.getElementById("selected-group-label");
            if (label) label.remove();

            const treeData = buildSimpleTree(data.data);
            drawD3Tree(treeData);

            window.GSP.customGeneSets = {
              data: data.data
            };
          } else if (data.treeType === "flat") {
            d3.select("#tree-container").select("svg").remove();
            alert(`Successfully loaded ${data.count} gene sets. All will be used.`);
            window.selectedItems = new Set();
            window.GSP = window.GSP || {};
            window.GSP.selectedGeneSets = [];
            localStorage.setItem("selected", "[]");
            const label = document.getElementById("selected-group-label");
            if (label) label.remove();

            window.GSP.customGeneSets = data;
            localStorage.setItem("customGeneSetsData", JSON.stringify(data.data));
          }
        })
        .catch(error => {
          console.error("Error reloading custom gene sets:", error);
          alert("Failed to re-load custom gene sets.");
        });
    }
    return;
  } else {
    uploadSection.style.display = "none";

    fetch(`/api/msigdb/?species=${species}`)
      .then(res => res.json())
      .then(msigdb => {
        const data = buildSimpleTree(msigdb);
        drawD3Tree(data);
      })
      .catch(error => {
        console.error("Error loading MSigDB data:", error);
      });
  }
}

window.handleSpeciesChange = handleSpeciesChange;

// Auto draw human tree when server starts
document.addEventListener("DOMContentLoaded", () => {
  handleSpeciesChange();
});

function buildSimpleTree(msigdb) {
  const root = { name: "Gene Set Collections", children: [] };

  for (const [setName, info] of Object.entries(msigdb)) {
    const collection = info.collection || "";
    const levels = collection.split(":");
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

      const formData = new FormData();
      formData.append("file", file);

      fetch("/api/upload_custom_gene_sets/", {
        method: "POST",
        body: formData
      })
        .then(res => res.json())
        .then(data => {
          if (data.treeType === "msigdb") {
            // Reset selection state before drawing new tree
            window.selectedItems = new Set();
            window.GSP = window.GSP || {};
            window.GSP.selectedGeneSets = [];
            localStorage.setItem("selected", "[]");
            const label = document.getElementById("selected-group-label");
            if (label) label.remove();

            const treeData = buildSimpleTree(data.data);
            drawD3Tree(treeData);

            // Save custom gene sets
            window.GSP.customGeneSets = {
              data: data.data
            };

          } else if (data.treeType === "flat") {
            // Flat = not a tree, still should clear old tree
            d3.select("#tree-container").select("svg").remove();

            // Reset selection state
            window.selectedItems = new Set();
            window.GSP = window.GSP || {};
            window.GSP.selectedGeneSets = [];
            localStorage.setItem("selected", "[]");
            const label = document.getElementById("selected-group-label");
            if (label) label.remove();

            alert(`Successfully loaded ${data.count} gene sets. All will be used.`);

            // Store for later filtering step
            window.GSP.customGeneSets = data;
            localStorage.setItem("customGeneSetsData", JSON.stringify(data.data));
          } else {
            throw new Error("Unknown tree type");
          }
        })
        .catch(err => {
          console.error("Upload error:", err);
          alert("Error: Invalid JSON format or upload failed.");
        });
    });
  }
});

function createFileList(file) {
  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(file);
  return dataTransfer.files;
}