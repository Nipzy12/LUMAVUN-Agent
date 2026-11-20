'use strict';
const {app, BrowserWindow, ipcMain, dialog, safeStorage, shell} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const defaults = () => ({
  chats: [], projects: [], images: [], library: [], selectedChatId: null, selectedProjectId: null,
  preferences: {
    name: 'Pengguna', language: 'id', theme: 'system', accent: '#7161cf',
    personality: 'Bawaan', warmth: 'normal', enthusiasm: 'normal',
    emoji: 'normal', formatting: 'normal', customInstructions: '',
    memoryEnabled: true, memories: [], suggestions: true, sendShortcut: 'enter'
  },
  provider: {kind: 'openai', baseUrl: 'https://api.openai.com/v1', model: ''}
});
let windowRef;
const activeRequests = new Map();
const stateFile = () => path.join(app.getPath('userData'), 'lumavun-state.json');
const secretFile = () => path.join(app.getPath('userData'), 'provider-key.dpapi');
const imageDirectory = () => path.join(app.getPath('userData'), 'images');
const ensureDirectory = () => fs.mkdirSync(app.getPath('userData'), {recursive: true});

function cleanState(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Data aplikasi tidak valid');
  const base = defaults();
  const out = {
    ...base,
    chats: Array.isArray(input.chats) ? input.chats.slice(0, 2000) : [],
    projects: Array.isArray(input.projects) ? input.projects.slice(0, 500) : [],
    images: Array.isArray(input.images) ? input.images.slice(0, 1000) : [],
    library: Array.isArray(input.library) ? input.library.slice(0, 2000) : [],
    selectedChatId: typeof input.selectedChatId === 'string' ? input.selectedChatId : null,
    selectedProjectId: typeof input.selectedProjectId === 'string' ? input.selectedProjectId : null,
    preferences: {...base.preferences, ...(input.preferences && typeof input.preferences === 'object' ? input.preferences : {})},
    provider: {...base.provider, ...(input.provider && typeof input.provider === 'object' ? input.provider : {})}
  };
  delete out.provider.apiKey;
  delete out.provider.hasKey;
  if (typeof out.preferences.customInstructions !== 'string') out.preferences.customInstructions = '';
  if (!Array.isArray(out.preferences.memories)) out.preferences.memories = [];
  return out;
}
function readState() {
  try { return cleanState(JSON.parse(fs.readFileSync(stateFile(), 'utf8'))); }
  catch { return defaults(); }
}
function writeState(input) {
  const out = cleanState(input);
  const json = JSON.stringify(out);
  if (Buffer.byteLength(json, 'utf8') > 12_000_000) throw Error('Penyimpanan terlalu besar (batas 12 MB)');
  ensureDirectory();
  const temporary = stateFile() + '.tmp';
  fs.writeFileSync(temporary, json, {mode: 0o600});
  fs.renameSync(temporary, stateFile());
  return true;
}
function hasKey() { return fs.existsSync(secretFile()) && fs.statSync(secretFile()).size > 0; }
function secret() {
  if (!hasKey()) return '';
  if (!safeStorage.isEncryptionAvailable()) throw Error('Penyimpanan rahasia sistem tidak tersedia');
  return safeStorage.decryptString(fs.readFileSync(secretFile()));
}
function saveSecret(value) {
  ensureDirectory();
  if (value === null) {
    if (hasKey()) fs.unlinkSync(secretFile());
    return;
  }
  if (typeof value !== 'string') return;
  if (!value.trim()) return; // Empty string leaves existing key untouched.
  if (!safeStorage.isEncryptionAvailable()) throw Error('Windows Credential Protection tidak tersedia');
  fs.writeFileSync(secretFile(), safeStorage.encryptString(value.trim()), {mode: 0o600});
}
function endpoint() {
  const config = readState().provider;
  const base = String(config.baseUrl || '').trim().replace(/\/+$/, '');
  let parsed;
  try { parsed = new URL(base); }
  catch { throw Error('Alamat provider API tidak valid'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw Error('Endpoint provider harus HTTPS dan tanpa kredensial di URL');
  }
  return base;
}
async function readJson(response) {
  const text = await response.text();
  if (text.length > 12_000_000) throw Error('Respons provider terlalu besar');
  let body;
  try { body = JSON.parse(text); }
  catch { throw Error('Provider mengembalikan respons bukan JSON'); }
  if (!response.ok) throw Error(String(body.error?.message || body.message || 'HTTP ' + response.status).slice(0, 500));
  return body;
}
async function requestProvider(route, options = {}, controller) {
  const key = secret();
  if (!key) throw Error('Tambahkan API key di Pengaturan > Provider AI terlebih dahulu');
  const base = endpoint();
  const url = base + route;
  const headers = {Authorization: 'Bearer ' + key, Accept: 'application/json'};
  if (options.body) headers['Content-Type'] = 'application/json';
  if (readState().provider.kind === 'openrouter') {
    headers['HTTP-Referer'] = 'https://lumavun.web.app';
    headers['X-Title'] = 'LUMAVUN Desktop';
  }
  const signal = controller?.signal || AbortSignal.timeout(90000);
  const response = await fetch(url, {...options, headers, signal, redirect: 'error'});
  return readJson(response);
}
function createWindow() {
  windowRef = new BrowserWindow({
    width: 1320, height: 850, minWidth: 760, minHeight: 560,
    title: 'LUMAVUN Desktop', backgroundColor: '#f9f9fb',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false, contextIsolation: true, sandbox: true,
      webSecurity: true
    }
  });
  windowRef.loadFile(path.join(__dirname, 'index.html'));
  windowRef.once('ready-to-show', () => windowRef?.show());
  windowRef.webContents.setWindowOpenHandler(({url}) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return {action: 'deny'};
  });
  windowRef.webContents.on('will-navigate', event => event.preventDefault());
}
if (!app.requestSingleInstanceLock()) app.quit();
else app.on('second-instance', () => windowRef?.focus());

app.whenReady().then(() => {
  ipcMain.handle('app:load', () => ({...readState(), hasApiKey: hasKey()}));
  ipcMain.handle('app:save', (_event, state) => writeState(state));
  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('provider:save', (_event, payload) => {
    const state = readState();
    const kinds = ['openai', 'openrouter', 'custom'];
    if (!kinds.includes(payload?.kind)) throw Error('Provider tidak dikenal');
    const value = String(payload.baseUrl || '').trim().replace(/\/+$/, '');
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) throw Error('URL provider harus HTTPS');
    state.provider = {kind: payload.kind, baseUrl: value, model: String(payload.model || '').slice(0, 160)};
    if (payload.apiKey === null) saveSecret(null);
    else saveSecret(payload.apiKey);
    writeState(state);
    return {provider: state.provider, hasApiKey: hasKey()};
  });
  ipcMain.handle('provider:models', async () => {
    const json = await requestProvider('/models');
    if (!Array.isArray(json.data)) throw Error('Daftar model tidak tersedia');
    return json.data.slice(0, 3000).map(v => ({id: String(v.id || ''), name: String(v.name || v.id || '')})).filter(v => v.id);
  });
  ipcMain.handle('provider:chat', async (_event, payload) => {
    const requestId = String(payload?.requestId || '');
    if (!/^[\w-]{1,80}$/.test(requestId)) throw Error('ID permintaan tidak valid');
    const state = readState();
    const model = String(payload?.model || state.provider.model || '');
    if (!model) throw Error('Pilih model AI terlebih dahulu');
    if (!Array.isArray(payload.messages) || payload.messages.length > 60) throw Error('Riwayat pesan tidak valid');
    const controller = new AbortController();
    activeRequests.set(requestId, controller);
    try {
      const json = await requestProvider('/chat/completions', {
        method: 'POST', body: JSON.stringify({
          model, stream: false, temperature: 0.7,
          messages: payload.messages.map(m => ({role: m.role, content: m.content})),
          max_tokens: 4096
        })
      }, controller);
      const response = json.choices?.[0]?.message?.content;
      const text = typeof response === 'string' ? response :
        Array.isArray(response) ? response.filter(x => x.type === 'text').map(x => x.text).join('\n') : '';
      if (!text.trim()) throw Error('Model tidak mengembalikan teks');
      return {text, model: json.model || model, usage: json.usage || null};
    } finally { activeRequests.delete(requestId); }
  });
  ipcMain.handle('provider:cancel', (_event, id) => {
    if (activeRequests.has(id)) {activeRequests.get(id).abort(); return true;}
    return false;
  });
  ipcMain.handle('provider:image', async (_event, payload) => {
    if (readState().provider.kind !== 'openai') throw Error('Generator gambar saat ini mendukung API gambar OpenAI saja');
    const prompt = String(payload?.prompt || '').trim().slice(0, 4000);
    if (!prompt) throw Error('Deskripsi gambar kosong');
    const json = await requestProvider('/images/generations', {
      method: 'POST', body: JSON.stringify({model: 'gpt-image-1', prompt, size: '1024x1024'})
    });
    const base64 = json.data?.[0]?.b64_json;
    if (!base64 || base64.length > 22_000_000) throw Error('Model gambar tidak mengembalikan PNG');
    const id = crypto.randomUUID();
    fs.mkdirSync(imageDirectory(), {recursive: true});
    fs.writeFileSync(path.join(imageDirectory(), id + '.png'), Buffer.from(base64, 'base64'));
    return {id, url: 'data:image/png;base64,' + base64};
  });
  ipcMain.handle('provider:read-image', (_event, id) => {
    if (!/^[a-z0-9-]{20,64}$/.test(String(id))) throw Error('ID gambar tidak valid');
    const file = path.join(imageDirectory(), id + '.png');
    return 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');
  });
  ipcMain.handle('app:export', async () => {
    const r = await dialog.showSaveDialog(windowRef, {
      title: 'Ekspor data LUMAVUN', defaultPath: 'LUMAVUN-backup.json',
      filters: [{name: 'JSON', extensions: ['json']}]
    });
    if (r.canceled || !r.filePath) return false;
    fs.writeFileSync(r.filePath, JSON.stringify(readState(), null, 2));
    return true;
  });
  ipcMain.handle('app:import', async () => {
    const r = await dialog.showOpenDialog(windowRef, {
      title: 'Impor data LUMAVUN', properties: ['openFile'],
      filters: [{name: 'JSON', extensions: ['json']}]
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const file = r.filePaths[0];
    if (fs.statSync(file).size > 12_000_000) throw Error('Berkas terlalu besar');
    const data = cleanState(JSON.parse(fs.readFileSync(file, 'utf8')));
    writeState(data);
    return {...data, hasApiKey: hasKey()};
  });
  ipcMain.handle('app:external', async (_event, url) => {
    if (!/^https:\/\//i.test(String(url))) throw Error('Hanya tautan HTTPS yang diizinkan');
    await shell.openExternal(url);
    return true;
  });
  createWindow();
  app.on('activate', () => {if (BrowserWindow.getAllWindows().length === 0) createWindow();});
});
app.on('window-all-closed', () => {if (process.platform !== 'darwin') app.quit();});
