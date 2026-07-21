const { appendFile, mkdir, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { app, BrowserWindow, ipcMain } = require("electron");

const projectRoot = path.resolve(__dirname, "..");
const outputPath = path.join(projectRoot, "artifacts", "smart-codex-routing-matrix.png");
const autoOutputPath = path.join(projectRoot, "artifacts", "smart-codex-routing-auto.png");
const runningOutputPath = path.join(projectRoot, "artifacts", "smart-codex-mission-running.png");
const doneOutputPath = path.join(projectRoot, "artifacts", "smart-codex-mission-done.png");
const logPath = path.join(projectRoot, "artifacts", "smart-codex-routing-matrix.log");

async function checkpoint(message) {
  await appendFile(logPath, `${new Date().toISOString()} ${message}\n`, "utf8");
}

async function capture() {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    backgroundColor: "#F6F4F1",
    webPreferences: {
      preload: path.join(projectRoot, "dist", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  await checkpoint("window-created");
  await window.loadFile(path.join(projectRoot, "dist", "ui", "index.html"));
  await checkpoint("page-loaded");
  await window.webContents.executeJavaScript(`
    document.querySelector('#routing-pill')?.click();
  `);
  await new Promise((resolve) => setTimeout(resolve, 500));
  const autoState = await window.webContents.executeJavaScript(`({ matrixHidden: document.querySelector('#manual-routing-settings')?.hidden, autoActive: document.querySelector('#routing-mode-luna')?.dataset.active })`);
  await checkpoint(`auto-state ${JSON.stringify(autoState)}`);
  const autoImage = await window.webContents.capturePage();
  await writeFile(autoOutputPath, autoImage.toPNG());
  await window.webContents.executeJavaScript(`
    document.querySelector('[data-manual-intent="implementation"]')?.click();
    window.scrollTo(0, 0);
  `);
  await new Promise((resolve) => setTimeout(resolve, 700));
  const image = await window.webContents.capturePage();
  await writeFile(outputPath, image.toPNG());
  await window.webContents.executeJavaScript(`
    document.querySelector('#routing-popover').hidden = true;
    document.querySelector('#routing-popover').style.display = 'none';
    const beacon = document.querySelector('#mission-beacon');
    beacon.hidden = false;
    beacon.style.animation = 'none';
    beacon.dataset.state = 'running';
    document.querySelector('#app-status').className = 'app-status is-running';
    document.querySelector('#app-status span').textContent = '1 mission en cours';
    document.querySelector('#beacon-title').textContent = 'Mission en cours';
    document.querySelector('#beacon-detail').textContent = 'Modification de l’interface';
    document.querySelector('#beacon-duration').textContent = '1:24';
  `);
  await new Promise((resolve) => setTimeout(resolve, 300));
  await window.webContents.capturePage();
  await new Promise((resolve) => setTimeout(resolve, 100));
  const runningImage = await window.webContents.capturePage();
  await writeFile(runningOutputPath, runningImage.toPNG());
  await window.webContents.executeJavaScript(`
    document.querySelector('#mission-beacon').dataset.state = 'done';
    document.querySelector('#app-status').className = 'app-status is-done';
    document.querySelector('#app-status span').textContent = 'Terminée';
    document.querySelector('#beacon-title').textContent = 'Mission terminée';
    document.querySelector('#beacon-detail').textContent = 'L’interface est prête';
    document.querySelector('#beacon-duration').textContent = '1:42';
  `);
  await new Promise((resolve) => setTimeout(resolve, 300));
  await window.webContents.capturePage();
  await new Promise((resolve) => setTimeout(resolve, 100));
  const doneImage = await window.webContents.capturePage();
  await writeFile(doneOutputPath, doneImage.toPNG());
  await checkpoint("captured-manual-auto-running-and-done");
  window.destroy();
  app.exit(0);
}

app.setPath("userData", path.join(tmpdir(), `smart-codex-ui-capture-${process.pid}`));
ipcMain.handle("history:list", () => []);
mkdir(path.dirname(outputPath), { recursive: true })
  .then(() => writeFile(logPath, "", "utf8"))
  .then(() => checkpoint("waiting-ready"));
app.whenReady().then(capture).catch(async (error) => {
  await checkpoint(`error ${error instanceof Error ? error.stack : String(error)}`);
  app.exit(1);
});
