import { MessageTypes } from "../shared/protocol.js";

const els = {
  authSection: document.getElementById("auth-section"),
  mainUI: document.getElementById("main-ui"),
  serverUrl: document.getElementById("serverUrl"),
  token: document.getElementById("token"),
  pairingCode: document.getElementById("pairingCode"),
  deviceId: document.getElementById("deviceId"),
  connectBtn: document.getElementById("connectBtn"),
  remember: document.getElementById("remember"),
  status: document.getElementById("connection-status"),
  deviceList: document.getElementById("deviceList"),
  deviceCount: document.querySelector(".device-count"),

  modeTokenBtn: document.getElementById("modeTokenBtn"),
  modePairBtn: document.getElementById("modePairBtn"),
  tokenModeFields: document.getElementById("tokenModeFields"),
  pairModeFields: document.getElementById("pairModeFields"),

  generatePairCodeBtn: document.getElementById("generatePairCodeBtn"),
  pairCodePanel: document.getElementById("pairCodePanel"),
  pairCodeDisplay: document.getElementById("pairCodeDisplay"),
  pairCodeCountdown: document.getElementById("pairCodeCountdown"),
  pairCodeCloseBtn: document.getElementById("pairCodeCloseBtn"),

  quickClipboardBtn: document.getElementById("quickClipboardBtn"),
  quickFileBtn: document.getElementById("quickFileBtn"),

  hostClipboardLatest: document.getElementById("hostClipboardLatest"),
  hostClipboardInput: document.getElementById("hostClipboardInput"),
  setHostClipboardBtn: document.getElementById("setHostClipboardBtn"),

  readLocalClipboardBtn: document.getElementById("readLocalClipboardBtn"),
  localClipboardInput: document.getElementById("localClipboardInput"),
  sendManualClipboardBtn: document.getElementById("sendManualClipboardBtn"),
  clipboardHistory: document.getElementById("clipboardHistory"),

  fsPath: document.getElementById("fsPath"),
  fsListBtn: document.getElementById("fsListBtn"),
  fsEntries: document.getElementById("fsEntries"),
  uploadForm: document.getElementById("uploadForm"),
  uploadInput: document.getElementById("uploadInput"),

  fileTarget: document.getElementById("fileTarget"),
  fileInput: document.getElementById("fileInput"),
  sendFileBtn: document.getElementById("sendFileBtn"),
  dropZone: document.getElementById("dropZone"),
  incomingFiles: document.getElementById("incomingFiles"),

  shellPanel: document.getElementById("shellPanel"),
  shellCommand: document.getElementById("shellCommand"),
  shellArgs: document.getElementById("shellArgs"),
  runShellBtn: document.getElementById("runShellBtn"),
  shellOutput: document.getElementById("shellOutput"),

  disconnectBtn: document.getElementById("disconnectBtn"),
  currentDeviceDisplay: document.getElementById("currentDeviceDisplay"),
};

const tabs = {
  clipboard: document.getElementById("tab-clipboard"),
  files: document.getElementById("tab-files"),
  browser: document.getElementById("tab-browser"),
  shell: document.getElementById("tab-shell"),
};

let ws = null;
let currentDeviceId = null;
let currentToken = null;
let authMode = "token";
const fileTransfers = new Map();
const MAX_CHUNK = 64 * 1024;
const MAX_CLIPBOARD_IMAGE_BYTES = 5 * 1024 * 1024;
let pairCountdownTimer = null;

const CREDS_KEY = "pcLinkCreds";

(function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(CREDS_KEY) || "null");
    if (saved) {
      els.serverUrl.value = saved.serverUrl || "";
      els.token.value = saved.token || "";
      els.deviceId.value = saved.deviceId || "";
      els.remember.checked = true;
    }
  } catch {
    // ignore
  }
})();

function saveCreds(serverUrl, token, deviceId) {
  if (els.remember.checked) {
    localStorage.setItem(
      CREDS_KEY,
      JSON.stringify({ serverUrl, token, deviceId })
    );
  } else {
    localStorage.removeItem(CREDS_KEY);
  }
}

els.modeTokenBtn?.addEventListener("click", () => setAuthMode("token"));
els.modePairBtn?.addEventListener("click", () => setAuthMode("pair"));

function setAuthMode(mode) {
  authMode = mode;
  els.modeTokenBtn.classList.toggle("active", mode === "token");
  els.modePairBtn.classList.toggle("active", mode === "pair");
  els.tokenModeFields.classList.toggle("hidden", mode !== "token");
  els.pairModeFields.classList.toggle("hidden", mode !== "pair");
  if (mode === "token") {
    els.token.required = true;
    els.pairingCode.required = false;
  } else {
    els.token.required = false;
    els.pairingCode.required = true;
  }
}

els.connectBtn.addEventListener("click", (e) => connect(e));
els.disconnectBtn.addEventListener("click", () => {
  if (ws) ws.close();
});

function setStatus(state, details = "") {
  els.status.textContent = state + (details ? ` - ${details}` : "");
  els.status.classList.toggle("connected", state === "Connected");
  els.status.classList.toggle("disconnected", state !== "Connected");
  els.status.classList.toggle("connecting", state === "Connecting...");
}

async function connect(e) {
  e.preventDefault();
  const url = els.serverUrl.value.trim();
  let deviceId = els.deviceId.value.trim();

  if (!url) {
    setStatus("Error", "Server URL required");
    return;
  }

  if (!deviceId) {
    deviceId = "browser-" + Math.random().toString(36).substr(2, 8);
    els.deviceId.value = deviceId;
  }

  let token;

  if (authMode === "pair") {
    const code = (els.pairingCode.value || "").trim();
    if (!/^[0-9]{6}$/.test(code)) {
      setStatus("Error", "Enter a valid 6-digit pairing code");
      return;
    }
    setStatus("Connecting...", "exchanging pairing code");
    try {
      const httpBase = url.replace(/^ws/, "http");
      const res = await fetch(`${httpBase}/api/pair/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, deviceId, name: deviceId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus("Error", data.error || "Pairing failed");
        return;
      }
      token = data.token;
      deviceId = data.deviceId || deviceId;
      els.deviceId.value = deviceId;
      els.token.value = token;
      showToast(
        "Paired! Token saved for this device. Keep it if you clear browser storage.",
        "success"
      );
    } catch (err) {
      setStatus("Error", err.message || "Pairing request failed");
      return;
    }
  } else {
    token = els.token.value.trim();
    if (!token) {
      setStatus("Error", "Token required");
      return;
    }
  }

  currentDeviceId = deviceId;
  currentToken = token;
  els.currentDeviceDisplay.textContent = deviceId;
  saveCreds(url, token, deviceId);
  setStatus("Connecting...");

  try {
    ws = new WebSocket(url);
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: MessageTypes.AUTH, token, deviceId }));
    };
    ws.onmessage = (e) => handleMessage(e.data);
    ws.onclose = () => {
      setStatus("Disconnected");
      els.authSection.classList.remove("hidden");
      els.mainUI.classList.add("hidden");
      els.currentDeviceDisplay.textContent = "-";
      hidePairCodePanel();
    };
    ws.onerror = () => setStatus("Error", "Connection failed");
  } catch (err) {
    setStatus("Error", err.message);
  }
}

function handleMessage(raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }

  switch (msg.type) {
    case MessageTypes.ACK:
      currentDeviceId = msg.deviceId;
      setStatus("Connected");
      els.authSection.classList.add("hidden");
      els.mainUI.classList.remove("hidden");
      els.currentDeviceDisplay.textContent = currentDeviceId || "Unknown";
      if (!msg.shell) els.shellPanel?.classList.add("hidden");
      break;

    case MessageTypes.ERROR:
      console.error("Error:", msg.error);
      if (els.mainUI.classList.contains("hidden")) {
        setStatus("Error", msg.error);
      } else {
        showToast(msg.error || "Server error", "error");
      }
      break;

    case MessageTypes.DEVICE_LIST:
      updateDeviceList(msg.devices);
      break;

    case MessageTypes.PRESENCE:
      break;

    case MessageTypes.PAIR_CODE:
      showPairCode(msg.code, msg.expiresInSeconds || 120);
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
      appendShellOutput("status", `Process exited code=${msg.code}\n`);
      break;

    case MessageTypes.FS_LIST_RESULT:
      renderFsList(msg.data);
      break;
  }
}

els.generatePairCodeBtn?.addEventListener("click", () => {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    showToast("Not connected", "error");
    return;
  }
  ws.send(JSON.stringify({ type: MessageTypes.PAIR_REQUEST }));
});

els.pairCodeCloseBtn?.addEventListener("click", hidePairCodePanel);

function showPairCode(code, seconds) {
  els.pairCodeDisplay.textContent = code;
  els.pairCodePanel.classList.remove("hidden");
  let remaining = seconds;
  els.pairCodeCountdown.textContent = String(remaining);
  if (pairCountdownTimer) clearInterval(pairCountdownTimer);
  pairCountdownTimer = setInterval(() => {
    remaining -= 1;
    els.pairCodeCountdown.textContent = String(Math.max(0, remaining));
    if (remaining <= 0) hidePairCodePanel();
  }, 1000);
}

function hidePairCodePanel() {
  els.pairCodePanel?.classList.add("hidden");
  if (pairCountdownTimer) {
    clearInterval(pairCountdownTimer);
    pairCountdownTimer = null;
  }
}

function updateDeviceList(devices) {
  els.deviceList.innerHTML = "";
  const selected = els.fileTarget.value;
  els.fileTarget.innerHTML = '<option value="">Choose target device</option>';

  devices.forEach((d) => {
    const li = document.createElement("li");
    li.textContent = d + (d === currentDeviceId ? " (You)" : "");
    li.addEventListener("click", () => {
      els.deviceList
        .querySelectorAll("li")
        .forEach((l) => l.classList.remove("active"));
      li.classList.add("active");
    });
    els.deviceList.appendChild(li);
    if (d !== currentDeviceId) {
      const opt = document.createElement("option");
      opt.value = d;
      opt.textContent = d;
      els.fileTarget.appendChild(opt);
    }
  });

  if ([...els.fileTarget.options].some((o) => o.value === selected)) {
    els.fileTarget.value = selected;
  }

  const deviceCount = devices.length;
  if (els.deviceCount) {
    els.deviceCount.textContent = `${deviceCount} device${deviceCount === 1 ? "" : "s"} connected`;
  }
}

/* -------- Clipboard (text + image) -------- */

async function readLocalClipboardPayload() {
  // Prefer ClipboardItems so we can pick up images
  if (navigator.clipboard?.read) {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((t) => t.startsWith("image/"));
        if (imageType) {
          const blob = await item.getType(imageType);
          if (blob.size > MAX_CLIPBOARD_IMAGE_BYTES) {
            throw new Error("Image too large to sync");
          }
          // Normalize to PNG for host tools
          const pngBlob =
            imageType === "image/png"
              ? blob
              : await convertBlobToPng(blob);
          const base64 = await blobToBase64(pngBlob);
          return {
            contentType: "image/png",
            data: base64,
            size: pngBlob.size,
          };
        }
        if (item.types.includes("text/plain")) {
          const blob = await item.getType("text/plain");
          const text = await blob.text();
          return { contentType: "text/plain", data: text };
        }
      }
    } catch (e) {
      // Fall through to readText (permissions / non-secure context)
      if (e.message === "Image too large to sync") throw e;
    }
  }
  const text = await navigator.clipboard.readText();
  return { contentType: "text/plain", data: text };
}

function convertBlobToPng(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        canvas.toBlob(
          (b) => {
            URL.revokeObjectURL(url);
            if (b) resolve(b);
            else reject(new Error("PNG conversion failed"));
          },
          "image/png"
        );
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image"));
    };
    img.src = url;
  });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function sendClipboardPayload(payload) {
  ws.send(
    JSON.stringify({
      type: MessageTypes.CLIPBOARD_UPDATE,
      data: payload.data,
      contentType: payload.contentType || "text/plain",
      size: payload.size,
    })
  );
}

function sendClipboardText(text) {
  sendClipboardPayload({ contentType: "text/plain", data: text });
}

els.readLocalClipboardBtn.addEventListener("click", async () => {
  try {
    const payload = await readLocalClipboardPayload();
    sendClipboardPayload(payload);
    showToast(
      payload.contentType === "image/png"
        ? "Image clipboard synced"
        : "Clipboard synced",
      "success"
    );
  } catch (e) {
    alert("Clipboard read failed: " + e.message);
  }
});

els.sendManualClipboardBtn.addEventListener("click", () => {
  const text = els.localClipboardInput.value;
  if (!text) return;
  sendClipboardText(text);
});

function addClipboardEntry(msg, localOrigin) {
  if (localOrigin) return;

  const li = document.createElement("li");
  li.className = "clipboard-entry";
  const ts = new Date(msg.timestamp || Date.now()).toLocaleTimeString();
  const from = msg.host ? "HOST" : msg.from || "unknown";
  const contentType = msg.contentType || "text/plain";

  const header = document.createElement("div");
  header.className = "clipboard-entry-header";
  header.innerHTML = `<strong>${escapeHtml(from)}</strong> <small>${ts}</small> <span class="content-type-badge">${escapeHtml(contentType)}</span>`;
  li.appendChild(header);

  if (msg.skipped) {
    const note = document.createElement("p");
    note.className = "muted small";
    note.textContent =
      msg.reason ||
      `Image skipped (${formatBytes(msg.size || 0)}) — over size limit`;
    li.appendChild(note);
  } else if (contentType === "image/png" && msg.data) {
    const img = document.createElement("img");
    img.className = "clipboard-image";
    img.alt = "Clipboard image";
    img.src = `data:image/png;base64,${msg.data}`;
    li.appendChild(img);
  } else {
    const pre = document.createElement("pre");
    pre.textContent = msg.data || "";
    li.appendChild(pre);
  }

  const btn = document.createElement("button");
  btn.textContent = contentType === "image/png" ? "Copy image" : "Copy";
  btn.addEventListener("click", async () => {
    try {
      if (contentType === "image/png" && msg.data) {
        const bytes = base64ToUint8Array(msg.data);
        const blob = new Blob([bytes], { type: "image/png" });
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": blob }),
        ]);
        showToast("Image copied", "success");
      } else {
        await navigator.clipboard.writeText(msg.data || "");
        showToast("Copied", "success");
      }
    } catch (e) {
      alert(e.message);
    }
  });
  li.appendChild(btn);

  els.clipboardHistory.prepend(li);
  while (els.clipboardHistory.children.length > 80) {
    els.clipboardHistory.removeChild(els.clipboardHistory.lastChild);
  }
}

function updateHostClipboard(msg) {
  const contentType = msg.contentType || "text/plain";
  if (msg.skipped) {
    els.hostClipboardLatest.textContent =
      msg.reason || `Image too large (${formatBytes(msg.size || 0)})`;
    return;
  }
  if (contentType === "image/png" && msg.data) {
    els.hostClipboardLatest.innerHTML = "";
    const img = document.createElement("img");
    img.className = "clipboard-image";
    img.alt = "Host clipboard image";
    img.src = `data:image/png;base64,${msg.data}`;
    els.hostClipboardLatest.appendChild(img);
  } else {
    els.hostClipboardLatest.textContent = (msg.data || "").slice(0, 5000);
  }
}

els.setHostClipboardBtn.addEventListener("click", () => {
  const text = els.hostClipboardInput.value;
  ws.send(
    JSON.stringify({
      type: MessageTypes.HOST_CLIPBOARD_SET,
      data: text,
      contentType: "text/plain",
    })
  );
});

/* File Transfer (peer) */
els.sendFileBtn.addEventListener("click", () => {
  const target = els.fileTarget.value;
  if (!target) return alert("Choose a target device");
  const files = els.fileInput.files;
  [...files].forEach((f) => sendFilePeer(f, target));
});

function sendFilePeer(file, target) {
  const fileId = crypto.randomUUID();
  ws.send(
    JSON.stringify({
      type: MessageTypes.FILE_SEND_INIT,
      fileId,
      to: target,
      name: file.name,
      size: file.size,
      chunkSize: MAX_CHUNK,
    })
  );
  const reader = file.stream().getReader();
  let seq = 0;
  const pump = () =>
    reader
      .read()
      .then(({ value, done }) => {
        if (done) {
          ws.send(JSON.stringify({ type: MessageTypes.FILE_COMPLETE, fileId }));
          return;
        }
        ws.send(
          JSON.stringify({
            type: MessageTypes.FILE_CHUNK,
            fileId,
            seq,
            data: arrayBufferToBase64(value),
          })
        );
        seq++;
        return pump();
      })
      .catch((err) => {
        ws.send(
          JSON.stringify({
            type: MessageTypes.FILE_CANCEL,
            fileId,
            reason: err.message,
          })
        );
      });
  pump();
}

function initIncomingFile(msg) {
  fileTransfers.set(msg.fileId, {
    name: msg.name,
    size: msg.size,
    receivedBytes: 0,
    chunks: [],
  });
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
  const blob = new Blob(ft.chunks, { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const li = document.querySelector(
    `#incomingFiles li[data-file-id="${msg.fileId}"]`
  );
  if (li) {
    const a = document.createElement("a");
    a.href = url;
    a.download = ft.name;
    a.textContent = "Download " + ft.name;
    a.className = "download-link";
    li.appendChild(document.createElement("br"));
    li.appendChild(a);
  }
  fileTransfers.delete(msg.fileId);
}
function cancelIncomingFile(msg) {
  fileTransfers.delete(msg.fileId);
  const li = document.querySelector(
    `#incomingFiles li[data-file-id="${msg.fileId}"]`
  );
  if (li) {
    li.classList.add("canceled");
    li.appendChild(document.createTextNode(" (Canceled)"));
  }
}

function addIncomingFileRow(fileId, name, received, size) {
  const li = document.createElement("li");
  li.dataset.fileId = fileId;
  li.className = "file-transfer-item";
  li.innerHTML = `
    <div class="file-info">
      <div class="file-name">${escapeHtml(name)}</div>
      <div class="file-progress">
        <div class="progress-bar">
          <div class="progress-fill" style="width: 0%"></div>
        </div>
        <div class="progress-text">0 / ${formatBytes(size)} (0%)</div>
      </div>
    </div>
    <button class="cancel-btn" onclick="cancelFileTransfer('${fileId}')">✕</button>
  `;
  els.incomingFiles.prepend(li);
  while (els.incomingFiles.children.length > 50) {
    els.incomingFiles.removeChild(els.incomingFiles.lastChild);
  }
}

function updateIncomingFileRow(fileId, received, size) {
  const li = document.querySelector(
    `#incomingFiles li[data-file-id="${fileId}"]`
  );
  if (!li) return;
  const percentage = Math.round((received / size) * 100);
  const progressFill = li.querySelector(".progress-fill");
  const progressText = li.querySelector(".progress-text");
  if (progressFill) progressFill.style.width = `${percentage}%`;
  if (progressText)
    progressText.textContent = `${formatBytes(received)} / ${formatBytes(size)} (${percentage}%)`;
}

function formatBytes(bytes) {
  if (!bytes) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

/* Host File Browser (REST) */
els.fsListBtn.addEventListener("click", () => listDir(els.fsPath.value));
els.fsEntries.addEventListener("click", (e) => {
  const li = e.target.closest("li");
  if (!li) return;
  const type = li.dataset.type;
  const name = li.dataset.name;
  const current = els.fsPath.value || ".";
  if (type === "dir") {
    const next = current === "." ? name : current + "/" + name;
    els.fsPath.value = next;
    listDir(next);
  } else if (type === "file") {
    downloadFile(current === "." ? name : current + "/" + name);
  } else if (li.dataset.up === "true") {
    const parts = current.split("/").filter(Boolean);
    parts.pop();
    const parent = parts.join("/") || ".";
    els.fsPath.value = parent;
    listDir(parent);
  }
});

function listDir(rel) {
  fetch(apiUrl(`/api/dir?path=${encodeURIComponent(rel)}`), authFetch())
    .then((r) => r.json())
    .then((data) => {
      if (data.error) return alert(data.error);
      renderFsList(data);
    })
    .catch((e) => alert(e.message));
}

function renderFsList(data) {
  els.fsEntries.innerHTML = "";
  if (data.path !== ".") {
    const up = document.createElement("li");
    up.textContent = "..";
    up.dataset.up = "true";
    els.fsEntries.appendChild(up);
  }
  data.entries
    .sort(
      (a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name)
    )
    .forEach((entry) => {
      const li = document.createElement("li");
      li.dataset.type = entry.type;
      li.dataset.name = entry.name;
      li.textContent = entry.type === "dir" ? `[${entry.name}]` : entry.name;
      els.fsEntries.appendChild(li);
    });
}

function downloadFile(rel) {
  const link = document.createElement("a");
  link.href = apiUrl(`/api/download?path=${encodeURIComponent(rel)}`);
  link.download = rel.split("/").pop();
  link.target = "_blank";
  link.rel = "noopener";
  link.click();
}

els.uploadForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const files = els.uploadInput.files;
  if (!files.length) return;
  const form = new FormData();
  [...files].forEach((f) => form.append("file", f));
  const dest = els.fsPath.value || ".";
  fetch(apiUrl(`/api/upload?dest=${encodeURIComponent(dest)}`), {
    method: "POST",
    headers: { "x-auth-token": getToken() },
    body: form,
  })
    .then((r) => r.json())
    .then((data) => {
      if (data.error) return alert(data.error);
      listDir(dest);
    })
    .catch((e2) => alert(e2.message));
});

/* Shell */
els.runShellBtn.addEventListener("click", () => {
  const command = els.shellCommand.value.trim();
  if (!command) return;
  const args = els.shellArgs.value.trim().length
    ? els.shellArgs.value.trim().split(/\s+/)
    : [];
  const requestId = crypto.randomUUID();
  els.shellOutput.textContent = "";
  ws.send(
    JSON.stringify({ type: MessageTypes.SHELL_RUN, requestId, command, args })
  );
});

function appendShellOutput(stream, text) {
  els.shellOutput.textContent += `[${stream}] ${text}`;
  els.shellOutput.scrollTop = els.shellOutput.scrollHeight;
}

["dragenter", "dragover"].forEach((ev) => {
  els.dropZone.addEventListener(ev, (e) => {
    e.preventDefault();
    els.dropZone.classList.add("dragover");
  });
});
["dragleave", "drop"].forEach((ev) => {
  els.dropZone.addEventListener(ev, (e) => {
    e.preventDefault();
    if (ev === "drop") {
      const target = els.fileTarget.value;
      if (!target) return alert("Choose target device first");
      const dt = e.dataTransfer;
      if (dt?.files?.length)
        [...dt.files].forEach((f) => sendFilePeer(f, target));
    }
    els.dropZone.classList.remove("dragover");
  });
});

function escapeHtml(str) {
  return String(str).replace(
    /[&<>]/g,
    (c) => ({ "&": "&", "<": "<", ">": ">" })[c]
  );
}
function arrayBufferToBase64(buf) {
  let binary = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++)
    binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
function base64ToUint8Array(b64) {
  const bin = atob(b64);
  const len = bin.length;
  const arr = new Uint8Array(len);
  for (let i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

function apiBase() {
  return els.serverUrl.value.trim().replace(/^ws/, "http");
}
function apiUrl(path) {
  return apiBase() + path;
}
function getToken() {
  return currentToken || els.token.value.trim();
}
function authFetch() {
  return { headers: { "x-auth-token": getToken() } };
}

function switchTab(activeTab) {
  document
    .querySelectorAll(".tab-panel")
    .forEach((panel) => panel.classList.add("hidden"));
  document
    .querySelectorAll(".tab-button")
    .forEach((btn) => btn.classList.remove("active"));
  document.getElementById(`panel-${activeTab}`).classList.remove("hidden");
  document.getElementById(`tab-${activeTab}`).classList.add("active");
}

Object.keys(tabs).forEach((tab) => {
  tabs[tab]?.addEventListener("click", () => switchTab(tab));
});

els.quickClipboardBtn?.addEventListener("click", async () => {
  try {
    const payload = await readLocalClipboardPayload();
    sendClipboardPayload(payload);
    showToast(
      payload.contentType === "image/png"
        ? "Image clipboard synced!"
        : "Clipboard synced successfully!",
      "success"
    );
  } catch (e) {
    showToast("Clipboard sync failed: " + e.message, "error");
  }
});

els.quickFileBtn?.addEventListener("click", () => {
  switchTab("files");
  setTimeout(() => {
    els.fileInput?.click();
  }, 100);
});

function showToast(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  const container = document.getElementById("toast-container");
  if (container) {
    container.appendChild(toast);
    setTimeout(() => toast.classList.add("show"), 100);
    setTimeout(() => {
      toast.classList.remove("show");
      setTimeout(() => {
        if (container.contains(toast)) container.removeChild(toast);
      }, 300);
    }, 3000);
  }
}
