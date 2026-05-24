const allTabContent = document.getElementsByClassName("tabcontent");
const allTabs = document.getElementsByClassName("tablinks");

document.getElementById("defaultTab").click();

function openTool(event, tool) {
  for (let i = 0; i < allTabContent.length; i++) {
    allTabContent[i].style.display = "none";
    allTabs[i].classList.remove("active");
  }
  event.currentTarget.classList.add("active");
  document.getElementById(tool).style.display = "block";
}

function collapseSection(event, title) {
  event.currentTarget.classList.toggle("active");
  let content = document.getElementById(title);
  if (content.style.maxHeight) {
    content.style.maxHeight = null;
  } else {
    console.log(content.scrollHeight);
    content.style.maxHeight = content.scrollHeight + "px";
  }
}

const contentSections = document.getElementById(
  "help-content-container"
).children;
const sectionButtons = document.getElementById(
  "help-button-container"
).children;

sectionButtons[0].click();
function openSection(event, section) {
  for (let i = 0; i < sectionButtons.length; i++) {
    contentSections[i].style.display = "none";
    sectionButtons[i].classList.remove("selected");
  }
  event.currentTarget.classList.add("selected");
  document.getElementById(section).style.display = "block";
}

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
