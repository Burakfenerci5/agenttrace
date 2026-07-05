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

// Bundled core: exposes serve(port, loadSessions) and loadSessions().
const core = require("./core.cjs");

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
    },
  });

  // Open external links (docs, GitHub, ActionProof) in the real browser, not
  // inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://127.0.0.1") || url.startsWith("http://localhost")) {
      return { action: "allow" };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });

  win.once("ready-to-show", () => win.show());

  try {
    const port = await freePort();
    await core.serve(port, core.loadSessions);
    await win.loadURL(`http://127.0.0.1:${port}/`);
  } catch (err) {
    dialog.showErrorBox(
      "AgentTrace failed to start",
      String(err && err.stack ? err.stack : err),
    );
    app.quit();
  }
}

app.whenReady().then(createWindow);

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("window-all-closed", () => {
  // Standard Mac behavior is to stay in the dock, but AgentTrace is a
  // single-window utility — quitting on close is the least surprising.
  app.quit();
});
