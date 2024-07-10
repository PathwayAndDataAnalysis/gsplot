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
