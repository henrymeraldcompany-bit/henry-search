(() => {
  const installButton = document.getElementById("install-app-button");
  const status = document.getElementById("pwa-status");
  if (!installButton) return;

  const installedKey = "gozie-search-pwa-installed";
  let installPrompt = null;
  let statusTimer = null;
  const say = message => {
    if (!status) return;
    if (statusTimer) window.clearTimeout(statusTimer);
    status.textContent = message;
    statusTimer = window.setTimeout(() => {
      status.textContent = "";
      statusTimer = null;
    }, 5000);
  };
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
      navigator.serviceWorker.register("./service-worker.js", { scope: "./" })
        .then(() => say("GOZIE SEARCH is ready to install and can open offline. Search requires internet."))
        .catch(() => say("Install from your browser menu. Offline page caching could not be enabled."));
    });
  }

  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    installPrompt = event;
    showInstallButton();
    installButton.textContent = "Install app";
  });

  installButton.addEventListener("click", async () => {
    if (!installPrompt) {
      say("To install: open your browser menu and choose Install app or Add to Home screen.");
      return;
    }
    installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    say(choice.outcome === "accepted" ? "GOZIE SEARCH installation started." : "Installation was cancelled.");
    installPrompt = null;
  });

  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    try {
      localStorage.setItem(installedKey, "true");
    } catch (_) {}
    hideInstallButton();
    say("GOZIE SEARCH has been installed in this browser.");
  });
})();