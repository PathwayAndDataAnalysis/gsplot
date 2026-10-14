// Keep the analysis document alive while browsing Help and About.
(() => {
  const analysis = document.getElementById("analysis-page");
  const information = document.getElementById("information-page");
  const graphLink = document.getElementById("nav-graph");
  const settings = document.querySelector(".settings-button");
  let analysisScroll = 0;
  let analysisView = "input";

  function markActive(page) {
    document.querySelectorAll(".nav-links > .nav-button").forEach((link) => {
      const name = link.id === "nav-import" ? "input" :
        link.id === "nav-graph" ? "graph" : link.dataset.page;
      if (name === page) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
  }

  function navigate(url, push = true) {
    const path = url.pathname.replace(/\/$/, "") || "/";
    const isInformation = path === "/help" || path === "/about";
    if (isInformation) {
      if (!analysis.hidden) analysisScroll = window.scrollY;
      information.title = path === "/help" ? "Help" : "About";
      const source = `${path}/?embedded=1`;
      if (information.getAttribute("src") !== source) information.src = source;
    }
    analysis.hidden = isInformation;
    information.hidden = !isInformation;
    settings.classList.toggle("nav-placeholder", isInformation);
    settings.setAttribute("aria-hidden", String(isInformation));
    if (!isInformation && url.hash === "#graph" && hasCachedGraphData()) {
      analysisView = "graph";
      hideUpload();
      hideInput();
      if (graphAndSettingsContainer.style.display === "none") showGraph();
    }
    if (!isInformation && url.hash !== "#graph" && analysisView === "graph") {
      analysisView = "input";
      importFile();
    }
    markActive(isInformation ? path.slice(1) : analysisView);
    if (push) history.pushState(null, "", url.pathname + url.hash);
    window.scrollTo(0, isInformation ? 0 : analysisScroll);
  }

  document.addEventListener("click", (event) => {
    const link = event.target.closest("a");
    if (!link || event.button !== 0 || event.ctrlKey || event.metaKey ||
        event.shiftKey || event.altKey || link.target || link.hasAttribute("download")) return;
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin) return;
    const path = url.pathname.replace(/\/$/, "") || "/";
    if (!["/", "/help", "/about"].includes(path)) return;
    event.preventDefault();
    if (link.getAttribute("aria-disabled") === "true") return;
    navigate(url);
  });

  window.addEventListener("popstate", () => navigate(new URL(location.href), false));
  window.addEventListener("analysis-view-changed", (event) => {
    analysisView = event.detail;
    if (!analysis.hidden) {
      markActive(analysisView);
      history.replaceState(null, "", analysisView === "graph" ? "/#graph" : "/");
    }
  });
  window.addEventListener("graph-cache-changed", () => {
    graphLink.setAttribute("aria-disabled", String(!hasCachedGraphData()));
  });
  graphLink.setAttribute("aria-disabled", String(!hasCachedGraphData()));
  markActive(analysisView);
})();
