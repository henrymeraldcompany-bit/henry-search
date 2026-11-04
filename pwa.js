(() => {
  const installButton = document.getElementById("install-app-button");
  const status = document.getElementById("pwa-status");
  if (!installButton) return;

  let installPrompt = null;
  const say = message => {
    if (status) status.textContent = message;
  };

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
    installButton.hidden = false;
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
    installButton.hidden = true;
    say("GOZIE SEARCH has been installed on this device.");
  });
})();