// Settings remains the canonical form consumed by Submit and Apply.
// Build the home form from it so options, labels and constraints stay identical.
(() => {
  const source = document.getElementById("shared-analysis-controls");
  const home = document.getElementById("home-analysis-controls");
  if (!source || !home) return;

  const copy = source.cloneNode(true);
  const pairs = [];
  const originals = [source, ...source.querySelectorAll("*")];
  const mirrors = [copy, ...copy.querySelectorAll("*")];
  originals.forEach((original, index) => {
    const mirror = mirrors[index];
    if (original.id) mirror.id = `home-${original.id}`;
    if (original.hasAttribute("for")) mirror.htmlFor = `home-${original.htmlFor}`;
    if (original.name) mirror.name = `home-${original.name}`;
    // Inline handlers refer to the canonical controls, so dispatch there instead.
    mirror.removeAttribute("onchange");
    mirror.removeAttribute("oninput");
    pairs.push([original, mirror]);
  });
  // Arrange the same controls into three compact columns on the home page.
  const children = [...copy.children];
  const algorithm = document.createElement("div");
  const distance = document.createElement("div");
  const threshold = document.createElement("div");
  algorithm.className = distance.className = threshold.className = "analysis-control-group";
  children.slice(0, 4).forEach(node => algorithm.append(node));
  children.slice(4, 8).forEach(node => distance.append(node));
  children.slice(8).forEach(node => threshold.append(node));
  copy.append(algorithm, distance, threshold);
  home.append(copy);

  function sync() {
    pairs.forEach(([original, mirror]) => {
      if (original.matches("input, select")) {
        // Only shorten the automatically calculated, read-only threshold.
        // Full precision remains in computed-p-value/computed-fdr storage;
        // editable thresholds retain exactly what the user entered.
        if (["fdr-input", "pvalue-input"].includes(original.id) && original.readOnly) {
          const value = Number(original.value);
          if (original.value !== "" && Number.isFinite(value)) {
            original.value = String(Number(value.toPrecision(6)));
          }
        }
        mirror.value = original.value;
        mirror.checked = original.checked;
        mirror.disabled = original.disabled;
        mirror.readOnly = original.readOnly;
      }
      mirror.style.cssText = original.style.cssText;
      mirror.className = original.className;
    });
  }

  pairs.forEach(([original, mirror]) => {
    if (!original.matches("input, select")) return;
    ["input", "change"].forEach(type => {
      mirror.addEventListener(type, () => {
        original.value = mirror.value;
        if (original.type === "radio" || original.type === "checkbox") {
          original.checked = mirror.checked;
        }
        original.dispatchEvent(new Event(type, { bubbles: true }));
        sync();
      });
      original.addEventListener(type, sync);
    });
  });

  // Also reflect visibility changes and computed thresholds from the graph.
  new MutationObserver(sync).observe(source, {
    attributes: true, subtree: true, attributeFilter: ["style", "class", "readonly", "disabled", "value"]
  });
  window.syncAnalysisControls = sync;
  sync();
})();
