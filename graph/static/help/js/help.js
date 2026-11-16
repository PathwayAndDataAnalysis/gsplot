document.querySelectorAll("#help-button-container, .tabs").forEach((group) => {
  const buttons = group.querySelectorAll("button[aria-controls]");
  group.addEventListener("click", (event) => {
    const selected = event.target.closest("button[aria-controls]");
    if (!selected) return;

    buttons.forEach((button) => {
      const active = button === selected;
      button.setAttribute("aria-pressed", String(active));
      document.getElementById(button.getAttribute("aria-controls")).hidden = !active;
    });
  });
});

document.querySelectorAll(".collapsible").forEach((button) => {
  button.addEventListener("click", () => {
    const content = document.getElementById(button.getAttribute("aria-controls"));
    content.hidden = !content.hidden;
    button.setAttribute("aria-expanded", String(!content.hidden));
  });
});

function renderPlotlyModebarIcons() {
  if (typeof Plotly === "undefined" || !Plotly.Icons) {
    return;
  }

  const iconNameFallbacks = {
    camera: ["camera"],
    zoom: ["zoom", "zoom_plus", "zoom2d"],
    pan: ["pan", "pan2d"],
    boxSelect: ["selectbox", "select", "select2d"],
    lasso: ["lasso", "lasso2d"],
    autoscale: ["autoscale", "autoScale2d"],
    reset: ["home", "resetScale2d"],
  };

  function findIconByName(name) {
    const candidates = iconNameFallbacks[name] || [name];
    for (let i = 0; i < candidates.length; i++) {
      const icon = Plotly.Icons[candidates[i]];
      if (icon && icon.path) {
        return icon;
      }
    }
    return null;
  }

  const iconNodes = document.querySelectorAll(".plotly-icon[data-icon]");
  iconNodes.forEach((node) => {
    const iconName = node.getAttribute("data-icon");
    const icon = findIconByName(iconName);
    if (!icon) {
      return;
    }

    const width = icon.width || 1000;
    const ascent = icon.ascent || 1000;
    const descent = icon.descent || 0;
    const height = ascent - descent;
    const viewHeight = height > 0 ? height : 1000;

    node.innerHTML = `
      <svg viewBox="0 0 ${width} ${viewHeight}" role="img" aria-hidden="true">
        <path d="${icon.path}" transform="matrix(1 0 0 -1 0 ${ascent})"></path>
      </svg>
    `;
  });
}

renderPlotlyModebarIcons();
