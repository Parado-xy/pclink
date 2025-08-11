import { MessageTypes } from '../shared/protocol.js';

const els = {
  authSection: document.getElementById('auth-section'),
  mainUI: document.getElementById('main-ui'),
  serverUrl: document.getElementById('serverUrl'),
  token: document.getElementById('token'),
  deviceId: document.getElementById('deviceId'),
  connectBtn: document.getElementById('connectBtn'),
  remember: document.getElementById('remember'),
  status: document.getElementById('connection-status'),
  deviceList: document.getElementById('deviceList'),
  hostClipboardLatest: document.getElementById('hostClipboardLatest'),
  hostClipboardInput: document.getElementById('hostClipboardInput'),
  setHostClipboardBtn: document.getElementById('setHostClipboardBtn'),

  readLocalClipboardBtn: document.getElementById('readLocalClipboardBtn'),
  localClipboardInput: document.getElementById('localClipboardInput'),
  sendManualClipboardBtn: document.getElementById('sendManualClipboardBtn'),
  clipboardHistory: document.getElementById('clipboardHistory'),

  fsPath: document.getElementById('fsPath'),
  fsListBtn: document.getElementById('fsListBtn'),
  fsEntries: document.getElementById('fsEntries'),
  uploadForm: document.getElementById('uploadForm'),
  uploadInput: document.getElementById('uploadInput'),

  fileTarget: document.getElementById('fileTarget'),
  fileInput: document.getElementById('fileInput'),
  sendFileBtn: document.getElementById('sendFileBtn'),
  dropZone: document.getElementById('dropZone'),
  incomingFiles: document.getElementById('incomingFiles'),

  shellPanel: document.getElementById('shellPanel'),
  shellCommand: document.getElementById('shellCommand'),
  shellArgs: document.getElementById('shellArgs'),
  runShellBtn: document.getElementById('runShellBtn'),
  shellOutput: document.getElementById('shellOutput'),

  disconnectBtn: document.getElementById('disconnectBtn')
};

let ws = null;
let currentDeviceId = null;
const fileTransfers = new Map();
const MAX_CHUNK = 64 * 1024;

(function restore() {
  const saved = JSON.parse(localStorage.getItem('pcLinkCreds') || 'null');
  if (saved) {
    els.serverUrl.value = saved.serverUrl || '';
    els.token.value = saved.token || '';
    els.deviceId.value = saved.deviceId || '';
    els.remember.checked = true;
  }
})();

els.connectBtn.addEventListener('click', () => connect());
els.disconnectBtn.addEventListener('click', () => { if (ws) ws.close(); });

function setStatus(state) {
  els.status.textContent = state;
  els.status.classList.toggle('connected', state === 'Connected');
  els.status.classList.toggle('disconnected', state !== 'Connected');
}

function connect() {
  const server = els.serverUrl.value.trim();
  const token = els.token.value.trim();
  const deviceId = (els.deviceId.value.trim() || 'browser-device');
  if (!/^wss?:\/\//.test(server)) return alert('Server URL must start with ws:// or wss://');
  if (!token) return alert('Token required');

  if (els.remember.checked) {
    localStorage.setItem('pcLinkCreds', JSON.stringify({ serverUrl: server, token, deviceId }));
  } else {
    localStorage.removeItem('pcLinkCreds');
  }

  ws = new WebSocket(server);
  setStatus('Connecting...');
  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({ type: MessageTypes.AUTH, token, deviceId }));
  });
  ws.addEventListener('message', e => handleMessage(e.data));
  ws.addEventListener('close', () => {
    setStatus('Disconnected');
    els.authSection.classList.remove('hidden');
    els.mainUI.classList.add('hidden');
    currentDeviceId = null;
  });
  ws.addEventListener('error', () => setStatus('Error'));
}

function handleMessage(raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }
  switch (msg.type) {
    case MessageTypes.ACK:
      currentDeviceId = msg.deviceId;
      setStatus('Connected');
      els.authSection.classList.add('hidden');
      els.mainUI.classList.remove('hidden');
      // If shell not allowed server side, hide panel.
      if(!msg.shell) els.shellPanel.classList.add('hidden'); 
      break;

    case MessageTypes.ERROR:
      console.error('Error:', msg.error);
      break;

    case MessageTypes.DEVICE_LIST:
      updateDeviceList(msg.devices);
      break;

    case MessageTypes.PRESENCE:
      // Could highlight online/offline; skipped for brevity.
      break;

    case MessageTypes.CLIPBOARD_UPDATE:
      addClipboardEntry(msg, false);
      break;

    case MessageTypes.HOST_CLIPBOARD_UPDATE:
      updateHostClipboard(msg);
      addClipboardEntry({ ...msg, host: true }, false);
      break;

    case MessageTypes.FILE_SEND_INIT:
      initIncomingFile(msg);
      break;

    case MessageTypes.FILE_CHUNK:
      handleFileChunk(msg);
      break;

    case MessageTypes.FILE_COMPLETE:
      finalizeFile(msg);
      break;

    case MessageTypes.FILE_CANCEL:
      cancelIncomingFile(msg);
      break;

    case MessageTypes.SHELL_OUTPUT:
      appendShellOutput(msg.stream, msg.data);
      break;

    case MessageTypes.SHELL_DONE:
      appendShellOutput('status', `Process exited code=${msg.code}\n`);
      break;

    case MessageTypes.FS_LIST_RESULT:
      renderFsList(msg.data);
      break;
  }
}

function updateDeviceList(devices) {
  els.deviceList.innerHTML = '';
  const selected = els.fileTarget.value;
  els.fileTarget.innerHTML = '<option value="">Choose target device</option>';
  devices.forEach(d => {
    const li = document.createElement('li');
    li.textContent = d + (d === currentDeviceId ? ' (You)' : '');
    li.addEventListener('click', () => {
      els.deviceList.querySelectorAll('li').forEach(l => l.classList.remove('active'));
      li.classList.add('active');
    });
    els.deviceList.appendChild(li);
    if (d !== currentDeviceId) {
      const opt = document.createElement('option');
      opt.value = d;
      opt.textContent = d;
      els.fileTarget.appendChild(opt);
    }
  });
  if ([...els.fileTarget.options].some(o => o.value === selected)) {
    els.fileTarget.value = selected;
  }
}

/* Clipboard (Browser) */
els.readLocalClipboardBtn.addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    sendClipboard(text);
    addClipboardEntry({ from: currentDeviceId, data: text, timestamp: Date.now(), local: true }, true);
  } catch (e) {
    alert('Clipboard read failed: ' + e.message);
  }
});

els.sendManualClipboardBtn.addEventListener('click', () => {
  const text = els.localClipboardInput.value;
  if (!text) return;
  sendClipboard(text);
  addClipboardEntry({ from: currentDeviceId, data: text, timestamp: Date.now(), local: true }, true);
});

function sendClipboard(text) {
  ws.send(JSON.stringify({
    type: MessageTypes.CLIPBOARD_UPDATE,
    data: text,
    contentType: 'text/plain'
  }));
}

function addClipboardEntry(msg, localOrigin) {
  // If localOrigin is set to true, don't add to the clipboard panel
  if(localOrigin) return; 

  // If not of localorigin, add to the clipboard panel. 
  const li = document.createElement('li');
  const ts = new Date(msg.timestamp || Date.now()).toLocaleTimeString();
  const from = msg.host ? 'HOST' : (msg.from || 'unknown');
  li.innerHTML = `<strong>${from}</strong> <small>${ts}</small><pre>${escapeHtml(msg.data || '')}</pre>`;
  const btn = document.createElement('button');
  btn.textContent = 'Copy';
  btn.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(msg.data || ''); } catch (e) { alert(e.message); }
  });
  li.appendChild(btn);
  els.clipboardHistory.prepend(li);
  while (els.clipboardHistory.children.length > 80) {
    els.clipboardHistory.removeChild(els.clipboardHistory.lastChild);
  }
}

function updateHostClipboard(msg) {
  els.hostClipboardLatest.textContent = msg.data.slice(0, 5000);
}

els.setHostClipboardBtn.addEventListener('click', () => {
  const text = els.hostClipboardInput.value;
  ws.send(JSON.stringify({
    type: MessageTypes.HOST_CLIPBOARD_SET,
    data: text
  }));
});

/* File Transfer (peer) */
els.sendFileBtn.addEventListener('click', () => {
  const target = els.fileTarget.value;
  if (!target) return alert('Choose a target device');
  const files = els.fileInput.files;
  [...files].forEach(f => sendFilePeer(f, target));
});

function sendFilePeer(file, target) {
  const fileId = crypto.randomUUID();
  ws.send(JSON.stringify({
    type: MessageTypes.FILE_SEND_INIT,
    fileId, to: target, name: file.name, size: file.size, chunkSize: MAX_CHUNK
  }));
  const reader = file.stream().getReader();
  let seq = 0;
  const pump = () => reader.read().then(({ value, done }) => {
    if (done) {
      ws.send(JSON.stringify({ type: MessageTypes.FILE_COMPLETE, fileId }));
      return;
    }
    ws.send(JSON.stringify({
      type: MessageTypes.FILE_CHUNK,
      fileId,
      seq,
      data: arrayBufferToBase64(value)
    }));
    seq++;
    return pump();
  }).catch(err => {
    ws.send(JSON.stringify({ type: MessageTypes.FILE_CANCEL, fileId, reason: err.message }));
  });
  pump();
}

function initIncomingFile(msg) {
  fileTransfers.set(msg.fileId, { name: msg.name, size: msg.size, receivedBytes: 0, chunks: [] });
  addIncomingFileRow(msg.fileId, msg.name, 0, msg.size);
}
function handleFileChunk(msg) {
  const ft = fileTransfers.get(msg.fileId);
  if (!ft) return;
  const bin = base64ToUint8Array(msg.data);
  ft.chunks.push(bin);
  ft.receivedBytes += bin.length;
  updateIncomingFileRow(msg.fileId, ft.receivedBytes, ft.size);
}
function finalizeFile(msg) {
  const ft = fileTransfers.get(msg.fileId);
  if (!ft) return;
  const blob = new Blob(ft.chunks, { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const li = document.querySelector(`#incomingFiles li[data-file-id="${msg.fileId}"]`);
  if (li) {
    const a = document.createElement('a');
    a.href = url;
    a.download = ft.name;
    a.textContent = 'Download ' + ft.name;
    a.className = 'download-link';
    li.appendChild(document.createElement('br'));
    li.appendChild(a);
  }
  fileTransfers.delete(msg.fileId);
}
function cancelIncomingFile(msg) {
  fileTransfers.delete(msg.fileId);
  const li = document.querySelector(`#incomingFiles li[data-file-id="${msg.fileId}"]`);
  if (li) {
    li.classList.add('canceled');
    li.appendChild(document.createTextNode(' (Canceled)'));
  }
}
function addIncomingFileRow(fileId, name, received, size) {
  const li = document.createElement('li');
  li.dataset.fileId = fileId;
  li.innerHTML = `<strong>${name}</strong> <span class="progress">${received}/${size}</span>`;
  els.incomingFiles.prepend(li);
  while (els.incomingFiles.children.length > 50) {
    els.incomingFiles.removeChild(els.incomingFiles.lastChild);
  }
}
function updateIncomingFileRow(fileId, received, size) {
  const li = document.querySelector(`#incomingFiles li[data-file-id="${fileId}"]`);
  if (!li) return;
  const progress = li.querySelector('.progress');
  if (progress) {
    const pct = ((received / size) * 100).toFixed(1);
    progress.textContent = `${received}/${size} (${pct}%)`;
  }
}

/* Host File Browser (REST) */
els.fsListBtn.addEventListener('click', () => listDir(els.fsPath.value));
els.fsEntries.addEventListener('click', (e) => {
  const li = e.target.closest('li');
  if (!li) return;
  const type = li.dataset.type;
  const name = li.dataset.name;
  const current = els.fsPath.value || '.';
  if (type === 'dir') {
    const next = current === '.' ? name : (current + '/' + name);
    els.fsPath.value = next;
    listDir(next);
  } else if (type === 'file') {
    downloadFile(current === '.' ? name : current + '/' + name);
  } else if (li.dataset.up === 'true') {
    // go up
    const parts = current.split('/').filter(Boolean);
    parts.pop();
    const parent = parts.join('/') || '.';
    els.fsPath.value = parent;
    listDir(parent);
  }
});

function listDir(rel) {
  fetch(apiUrl(`/api/dir?path=${encodeURIComponent(rel)}`), authFetch())
    .then(r => r.json())
    .then(data => {
      if (data.error) return alert(data.error);
      renderFsList(data);
    })
    .catch(e => alert(e.message));
}

function renderFsList(data) {
  els.fsEntries.innerHTML = '';
  if (data.path !== '.') {
    const up = document.createElement('li');
    up.textContent = '..';
    up.dataset.up = 'true';
    els.fsEntries.appendChild(up);
  }
  data.entries.sort((a,b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name))
    .forEach(entry => {
      const li = document.createElement('li');
      li.dataset.type = entry.type;
      li.dataset.name = entry.name;
      li.textContent = entry.type === 'dir' ? `[${entry.name}]` : entry.name;
      els.fsEntries.appendChild(li);
    });
}

function downloadFile(rel) {
  const link = document.createElement('a');
  link.href = apiUrl(`/api/download?path=${encodeURIComponent(rel)}`);
  link.download = rel.split('/').pop();
  link.target = '_blank';
  link.rel = 'noopener';
  link.click();
}

els.uploadForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const files = els.uploadInput.files;
  if (!files.length) return;
  const form = new FormData();
  [...files].forEach(f => form.append('file', f));
  const dest = els.fsPath.value || '.';
  fetch(apiUrl(`/api/upload?dest=${encodeURIComponent(dest)}`), {
    method: 'POST',
    headers: { 'x-auth-token': getToken() },
    body: form
  }).then(r => r.json())
    .then(data => {
      if (data.error) return alert(data.error);
      listDir(dest);
    })
    .catch(e2 => alert(e2.message));
});

/* Shell */
els.runShellBtn.addEventListener('click', () => {
  const command = els.shellCommand.value.trim();
  if (!command) return;
  const args = els.shellArgs.value.trim().length ? els.shellArgs.value.trim().split(/\s+/) : [];
  const requestId = crypto.randomUUID();
  els.shellOutput.textContent = '';
  ws.send(JSON.stringify({ type: MessageTypes.SHELL_RUN, requestId, command, args }));
});

function appendShellOutput(stream, text) {
  els.shellOutput.textContent += `[${stream}] ${text}`;
  els.shellOutput.scrollTop = els.shellOutput.scrollHeight;
}

/* Drag & Drop upload to host directory not implemented here intentionally
   to avoid accidental mass uploads. Could add similar to peer transfer. */

/* Peer File Drag & Drop */
['dragenter','dragover'].forEach(ev => {
  els.dropZone.addEventListener(ev, e => {
    e.preventDefault();
    els.dropZone.classList.add('dragover');
  });
});
['dragleave','drop'].forEach(ev => {
  els.dropZone.addEventListener(ev, e => {
    e.preventDefault();
    if (ev === 'drop') {
      const target = els.fileTarget.value;
      if (!target) return alert('Choose target device first');
      const dt = e.dataTransfer;
      if (dt?.files?.length) [...dt.files].forEach(f => sendFilePeer(f, target));
    }
    els.dropZone.classList.remove('dragover');
  });
});

/* Utilities */
function escapeHtml(str) {
  return str.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
}
function arrayBufferToBase64(buf) {
  let binary = '';
  const bytes = new Uint8Array(buf);
  for (let i=0;i<bytes.length;i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
function base64ToUint8Array(b64) {
  const bin = atob(b64);
  const len = bin.length;
  const arr = new Uint8Array(len);
  for (let i=0;i<len;i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

function apiBase() {
  const url = els.serverUrl.value.trim();
  // Convert wss:// -> https://  ws:// -> http://
  return url.replace(/^ws/, 'http');
}
function apiUrl(path) {
  return apiBase() + path;
}
function getToken() {
  return els.token.value.trim();
}
function authFetch() {
  return { headers: { 'x-auth-token': getToken() } };
}

