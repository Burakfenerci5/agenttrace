/**
 * AgentTrace desktop — Electron main process.
 *
 * The whole product already exists as a local HTTP server that renders a
 * complete dashboard (src/dashboard.ts). So the app does the minimum: start
 * that server on a free loopback port, then load it in a native window. No
 * rewrite — the desktop app is just a new front door for non-terminal users.
 *
 * The core (parse/correlate/dashboard) is bundled to plain JS at build time
 * into ./core.cjs by scripts/build.mjs (Electron's Node won't run raw .ts).
 */
const { app, BrowserWindow, shell, dialog } = require("electron");
const { createServer } = require("node:net");
const { URL } = require("node:url");

// Bundled core: exposes serve(port, loadSessions) and loadSessions().
const core = require("./core.cjs");

// The one origin this app is ever allowed to load. Set once the server binds.
let APP_ORIGIN = null;

/** True only for our own loopback dashboard origin. */
function isOwnOrigin(rawUrl) {
  if (!APP_ORIGIN) return false;
  try {
    return new URL(rawUrl).origin === APP_ORIGIN;
  } catch {
    return false;
  }
}

/** Open a URL in the user's real browser — only http(s)/mailto, nothing else. */
function openExternalSafely(rawUrl) {
  let scheme = "";
  try {
    scheme = new URL(rawUrl).protocol;
  } catch {
    return; // unparseable → ignore
  }
  if (scheme === "http:" || scheme === "https:" || scheme === "mailto:") {
    shell.openExternal(rawUrl);
  }
}

/** Ask the OS for a free loopback port so we never collide with a dev server. */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

// Harden every web-contents the app ever creates (defense in depth, applies to
// the main window and any child): keep the renderer pinned to our own origin
// and route every external link through the OS browser, never a new Electron
// window loading remote content.
app.on("web-contents-created", (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (isOwnOrigin(url)) return { action: "allow" };
    openExternalSafely(url);
    return { action: "deny" };
  });
  // Block in-window navigation to anything that isn't our dashboard origin.
  contents.on("will-navigate", (event, url) => {
    if (!isOwnOrigin(url)) {
      event.preventDefault();
      openExternalSafely(url);
    }
  });
  // Never attach a webview.
  contents.on("will-attach-webview", (event) => event.preventDefault());
});

async function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: "AgentTrace",
    backgroundColor: "#0b0d12",
    titleBarStyle: "hiddenInset", // native Mac traffic-lights over our dark UI
    show: false,
    webPreferences: {
      // The window only ever loads our own localhost origin; no remote content,
      // no Node integration in the renderer. Defense in depth.
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      // Run the renderer in the OS sandbox and keep web security on. The UI is
      // pure HTML/CSS/JS served from our own origin, so nothing here needs to
      // be relaxed.
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
    },
  });

  win.once("ready-to-show", () => win.show());

  try {
    const port = await freePort();
    await core.serve(port, core.loadSessions);
    APP_ORIGIN = `http://127.0.0.1:${port}`;
    await win.loadURL(`${APP_ORIGIN}/`);
  } catch (err) {
    dialog.showErrorBox(
      "AgentTrace failed to start",
      String(err && err.stack ? err.stack : err),
    );
    app.quit();
  }
}

// Single-instance lock: a second launch just focuses the existing window
// instead of spinning up a second server on a second port.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(createWindow);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  app.on("window-all-closed", () => {
    // Standard Mac behavior is to stay in the dock, but AgentTrace is a
    // single-window utility — quitting on close is the least surprising.
    app.quit();
  });
}
