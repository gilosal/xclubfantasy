// Apply the saved theme before first paint without violating script-src 'self'.
(function () {
  try {
    var theme = localStorage.getItem("xcf-theme");
    if (theme !== "light" && theme !== "dark") {
      theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    document.documentElement.dataset.theme = theme;
  } catch (error) {
    document.documentElement.dataset.theme = "light";
  }
})();
