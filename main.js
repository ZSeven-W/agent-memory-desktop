const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, nativeImage } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow;
let tray;
let quickAddWindow;
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

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  // Create a simple tray icon (16x16 purple square)
  const iconSize = 16;
  const iconDataURL = `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAIklEQVQ4T2NkoBAwUqifYdQAhtEwYKCE0QCMJgOqAQAw7gERp7WqLgAAAABJRU5ErkJggg==`;
  const icon = nativeImage.createFromDataURL(iconDataURL);
  tray = new Tray(icon);
  tray.setToolTip('AgentMemory Desktop');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open AgentMemory',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    {
      label: 'Quick Add Memory',
      click: () => createQuickAddWindow()
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function createQuickAddWindow() {
  if (quickAddWindow) {
    quickAddWindow.focus();
    return;
  }

  quickAddWindow = new BrowserWindow({
    width: 500,
    height: 300,
    resizable: false,
    alwaysOnTop: true,
    frame: true,
    backgroundColor: '#0f1117',
    title: 'Quick Add Memory',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  quickAddWindow.loadURL('http://localhost:3000?quickadd=1');

  quickAddWindow.on('closed', () => {
    quickAddWindow = null;
  });

  quickAddWindow.on('blur', () => {
    if (quickAddWindow) quickAddWindow.close();
  });
}

function registerGlobalShortcut() {
  const shortcut = process.platform === 'darwin' ? 'Command+Shift+M' : 'Ctrl+Shift+M';
  const registered = globalShortcut.register(shortcut, () => {
    createQuickAddWindow();
  });

  if (!registered) {
    console.log('Global shortcut registration failed:', shortcut);
  } else {
    console.log('Global shortcut registered:', shortcut);
  }
}

app.whenReady().then(async () => {
  await startServer();
  createWindow();
  createTray();
  registerGlobalShortcut();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // Don't quit on window close — we stay in tray
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (serverProcess) serverProcess.kill();
  globalShortcut.unregisterAll();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
