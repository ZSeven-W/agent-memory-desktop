const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow;
let serverProcess;

function startServer() {
  return new Promise((resolve) => {
    serverProcess = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PORT: '3000' }
    });

    let resolved = false;
    const doResolve = () => {
      if (!resolved) { resolved = true; resolve(); }
    };

    serverProcess.stdout.on('data', (data) => {
      const msg = data.toString();
      process.stdout.write('[server] ' + msg);
      if (msg.includes('running at')) doResolve();
    });

    serverProcess.stderr.on('data', (data) => {
      const err = data.toString();
      if (!err.includes('ExperimentalWarning')) process.stderr.write('[server] ' + err);
    });

    serverProcess.on('error', (err) => {
      process.stderr.write('Server spawn error: ' + err.message + '\n');
      doResolve();
    });

    // Fallback: resolve after 4s if server doesn't announce itself
    setTimeout(doResolve, 4000);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#0f1117',
    title: 'AgentMemory Desktop',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadURL('http://localhost:3000');

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  await startServer();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (serverProcess) serverProcess.kill();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (serverProcess) serverProcess.kill();
});
