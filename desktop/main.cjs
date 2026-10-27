const { app, BrowserWindow } = require('electron');
const { fork } = require('node:child_process');
const path = require('node:path');

let backend;
async function startServer() {
  try { const r=await fetch('http://127.0.0.1:4317/api/health'); if(r.ok)return; } catch {}
  const serverPath = path.join(app.getAppPath(), 'server', 'index.js');
  backend = fork(serverPath, [], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: app.isPackaged ? 'production' : 'development',
      PORT: '4317',
      WORKLOG_DATA_DIR: path.join(app.getPath('userData'), 'data')
    },
    stdio: 'ignore'
  });
  backend.on('error', e => console.error('Could not start local server:', e));
  for (let i=0; i<50; i++) {
    try { const r=await fetch('http://127.0.0.1:4317/api/health'); if(r.ok)return; } catch {}
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  throw new Error('The local WorkLog service did not start.');
}
app.whenReady().then(async()=>{
  try {
    await startServer();
    const win=new BrowserWindow({width:1280,height:850,minWidth:800,minHeight:600,backgroundColor:'#f7f8fb',title:'WorkLog AI',webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});
    await win.loadURL(app.isPackaged?'http://127.0.0.1:4317':'http://127.0.0.1:5173');
  } catch(e) { console.error(e); app.quit(); }
});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',()=>{if(backend&&!backend.killed)backend.kill()});
