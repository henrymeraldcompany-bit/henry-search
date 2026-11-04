(() => {
  const installButton = document.getElementById("install-app-button");
  if (!installButton) return;

  const installedKey = "gozie-search-pwa-installed";
  let installPrompt = null;
  const isRunningInstalled = () =>
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    window.navigator.standalone === true;

  const hideInstallButton = () => {
    installButton.hidden = true;
    installButton.setAttribute("aria-hidden", "true");
  };
  const showInstallButton = () => {
    if (isRunningInstalled()) return hideInstallButton();
    try {
      if (localStorage.getItem(installedKey) === "true") return hideInstallButton();
    } catch (_) {}
    installButton.hidden = false;
    installButton.removeAttribute("aria-hidden");
  };

  if (isRunningInstalled()) {
    hideInstallButton();
  } else {
    try {
      if (localStorage.getItem(installedKey) === "true") hideInstallButton();
    } catch (_) {}
  }

  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./service-worker.js?v=5", { scope: "./" }).catch(() => {});
    });
  }

  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    installPrompt = event;
    showInstallButton();
    installButton.textContent = "Install app";
  });

  installButton.addEventListener("click", async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    try {
      await installPrompt.userChoice;
    } finally {
      installPrompt = null;
    }
  });

  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    try {
      localStorage.setItem(installedKey, "true");
    } catch (_) {}
    hideInstallButton();
  });
})();