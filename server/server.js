import express from "express";
import { WebSocketServer } from "ws";
import path from "path";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";
import multer from "multer";
import fs from "fs";
import { CONFIG } from "./config.js";
import { MessageTypes, safeParse } from "../shared/protocol.js";
import { HostIntegration } from "./hostIntegration.js";
import { deviceStore } from "./deviceStore.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: "12mb" }));

function resolveAuth(token) {
  if (!token || typeof token !== "string") return null;
  if (token === CONFIG.TOKEN) return { kind: "master" };
  const deviceId = deviceStore.validateToken(token);
  if (deviceId) return { kind: "device", deviceId };
  return null;
}

function authMiddleware(req, res, next) {
  const token = req.headers["x-auth-token"];
  const auth = resolveAuth(token);
  if (!auth) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  req.auth = auth;
  next();
}

app.get("/shared/protocol.js", (req, res) => {
  res.sendFile("./shared/protocol.js", { root: "./" });
});

app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/api/pair/start", authMiddleware, (_req, res) => {
  const { code, expiresAt } = deviceStore.createPairingCode(CONFIG.PAIRING_TTL_MS);
  res.json({
    code,
    expiresAt,
    expiresInSeconds: Math.round((expiresAt - Date.now()) / 1000),
  });
});

app.post("/api/pair/complete", (req, res) => {
  const { code, deviceId: requestedId, name } = req.body || {};
  if (!code) {
    return res.status(400).json({ error: "code required" });
  }
  if (!deviceStore.consumePairingCode(String(code))) {
    return res.status(401).json({ error: "Invalid or expired pairing code" });
  }

  let deviceId = (requestedId || "").trim();
  if (!deviceId) {
    deviceId = `device-${uuidv4().slice(0, 8)}`;
  }
  if (deviceStore.hasDevice(deviceId)) {
    deviceId = `${deviceId}-${uuidv4().slice(0, 4)}`;
  }

  const token = deviceStore.createDevice(deviceId, name || deviceId);
  res.json({
    deviceId,
    token,
    message:
      "Save this token — it will not be shown again. Use it as your authentication token.",
  });
});

app.get("/api/devices", authMiddleware, (_req, res) => {
  res.json({ devices: deviceStore.list() });
});

app.delete("/api/devices/:deviceId", authMiddleware, (req, res) => {
  const ok = deviceStore.revoke(req.params.deviceId);
  if (!ok) return res.status(404).json({ error: "Device not found" });
  const entry = devices.get(req.params.deviceId);
  if (entry) {
    try {
      entry.ws.close(4001, "Revoked");
    } catch {}
    devices.delete(req.params.deviceId);
    broadcastPresence(req.params.deviceId, "offline");
    sendDeviceListAll();
  }
  res.json({ ok: true });
});

app.get("/api/dir", authMiddleware, (req, res) => {
  try {
    const rel = req.query.path || ".";
    const info = host.listDir(rel);
    res.json(info);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/download", authMiddleware, (req, res) => {
  const rel = req.query.path;
  if (!rel) return res.status(400).json({ error: "path required" });
  try {
    const abs = host.resolvePath(rel);
    const stat = fs.statSync(abs);
    if (!stat.isFile()) return res.status(400).json({ error: "Not a file" });
    res.setHeader("Content-Length", stat.size);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${path.basename(abs)}"`
    );
    fs.createReadStream(abs).pipe(res);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: CONFIG.MAX_FILE_SIZE },
});

app.post("/api/upload", authMiddleware, upload.any(), (req, res) => {
  const dest = req.query.dest || ".";
  try {
    const destAbs = host.resolvePath(dest);
    if (!fs.existsSync(destAbs)) fs.mkdirSync(destAbs, { recursive: true });
    if (!fs.statSync(destAbs).isDirectory())
      throw new Error("Destination not a directory");

    const saved = [];
    for (const f of req.files) {
      const outPath = path.join(destAbs, f.originalname);
      fs.writeFileSync(outPath, f.buffer);
      saved.push({ file: f.originalname, size: f.size });
    }
    res.json({ saved });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

const server = app.listen(CONFIG.PORT, CONFIG.HOST, () => {
  console.log(`Server listening on http://${CONFIG.HOST}:${CONFIG.PORT}`);
  console.log("Sandbox root:", CONFIG.ROOT_DIR);
  console.log(
    "Shell allowed:",
    CONFIG.ALLOW_SHELL,
    "Clipboard set allowed:",
    CONFIG.ALLOW_REMOTE_CLIPBOARD_SET
  );
  console.log(
    "Registered devices:",
    deviceStore.list().length,
    "(devices.json)"
  );
});

const wss = new WebSocketServer({ server });

const devices = new Map();
const activeSends = new Map();

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}
function forward(deviceId, msg) {
  const entry = devices.get(deviceId);
  if (entry) send(entry.ws, msg);
}
function broadcast(msg, excludeId = null) {
  for (const [id, entry] of devices.entries()) {
    if (id === excludeId) continue;
    send(entry.ws, msg);
  }
}
function sendDeviceListAll() {
  const list = [...devices.keys()];
  broadcast({ type: MessageTypes.DEVICE_LIST, devices: list });
}
function broadcastPresence(deviceId, status) {
  broadcast({
    type: MessageTypes.PRESENCE,
    deviceId,
    status,
    timestamp: Date.now(),
  });
}

const host = new HostIntegration({
  broadcastFn: (msg) => {
    broadcast({ ...msg, from: "host" });
  },
});

host.startClipboardWatcher(2000);

wss.on("connection", (ws) => {
  let authed = false;
  let deviceId = null;

  ws.on("message", (raw) => {
    const msg = safeParse(raw);
    if (!msg)
      return send(ws, { type: MessageTypes.ERROR, error: "Invalid JSON" });

    if (msg.type === MessageTypes.AUTH) {
      const auth = resolveAuth(msg.token);
      if (!auth) {
        return send(ws, { type: MessageTypes.ERROR, error: "Unauthorized" });
      }

      authed = true;

      if (auth.kind === "device") {
        deviceId =
          (msg.deviceId || "").trim() ||
          auth.deviceId ||
          `device-${uuidv4().slice(0, 8)}`;
      } else {
        deviceId =
          (msg.deviceId || "").trim() || `device-${uuidv4().slice(0, 8)}`;
      }

      if (devices.has(deviceId)) {
        try {
          devices.get(deviceId).ws.close(4000, "Replaced");
        } catch {}
      }
      devices.set(deviceId, { ws, lastSeen: Date.now() });

      send(ws, {
        type: MessageTypes.ACK,
        deviceId,
        role: deviceId === "host" ? "host" : "client",
        shell: CONFIG.ALLOW_SHELL,
        authKind: auth.kind,
      });

      broadcastPresence(deviceId, "online");
      sendDeviceListAll();
      return;
    }

    if (!authed) {
      return send(ws, { type: MessageTypes.ERROR, error: "Not authenticated" });
    }

    const entry = devices.get(deviceId);
    if (entry) entry.lastSeen = Date.now();

    switch (msg.type) {
      case MessageTypes.PAIR_REQUEST: {
        const { code, expiresAt } = deviceStore.createPairingCode(
          CONFIG.PAIRING_TTL_MS
        );
        send(ws, {
          type: MessageTypes.PAIR_CODE,
          code,
          expiresAt,
          expiresInSeconds: Math.round((expiresAt - Date.now()) / 1000),
        });
        break;
      }

      case MessageTypes.CLIPBOARD_UPDATE: {
        const contentType = msg.contentType || "text/plain";
        if (contentType === "image/png") {
          if (typeof msg.data !== "string") {
            return send(ws, {
              type: MessageTypes.ERROR,
              error: "Invalid image data",
            });
          }
          const approxBytes = Math.floor((msg.data.length * 3) / 4);
          if (approxBytes > CONFIG.MAX_CLIPBOARD_IMAGE_BYTES) {
            return send(ws, {
              type: MessageTypes.ERROR,
              error: "Image exceeds size limit",
            });
          }
        }
        const enriched = {
          ...msg,
          contentType,
          from: deviceId,
          timestamp: Date.now(),
        };
        if (msg.to) {
          forward(msg.to, enriched);
        } else {
          broadcast(enriched, deviceId);
        }
        break;
      }
      case MessageTypes.CLIPBOARD_REQUEST: {
        if (!msg.targetDevice) {
          return send(ws, {
            type: MessageTypes.ERROR,
            error: "targetDevice required",
          });
        }
        forward(msg.targetDevice, { ...msg, from: deviceId });
        break;
      }
      case MessageTypes.CLIPBOARD_RESPONSE: {
        if (msg.requesterDevice)
          forward(msg.requesterDevice, { ...msg, from: deviceId });
        break;
      }

      case MessageTypes.HOST_CLIPBOARD_SET: {
        if (!CONFIG.ALLOW_REMOTE_CLIPBOARD_SET) {
          return send(ws, {
            type: MessageTypes.ERROR,
            error: "Host clipboard setting disabled",
          });
        }
        const contentType = msg.contentType || "text/plain";
        if (typeof msg.data !== "string") {
          return send(ws, {
            type: MessageTypes.ERROR,
            error: "Invalid clipboard data",
          });
        }
        if (contentType === "image/png") {
          const approxBytes = Math.floor((msg.data.length * 3) / 4);
          if (approxBytes > CONFIG.MAX_CLIPBOARD_IMAGE_BYTES) {
            return send(ws, {
              type: MessageTypes.ERROR,
              error: "Image exceeds size limit",
            });
          }
        }
        host.setClipboard(msg.data, contentType).catch((e) => {
          send(ws, { type: MessageTypes.ERROR, error: e.message });
        });
        break;
      }

      case MessageTypes.FILE_SEND_INIT: {
        const { fileId, to, size } = msg;
        if (!fileId || !to || !size) {
          return send(ws, {
            type: MessageTypes.ERROR,
            error: "Missing file init params",
          });
        }
        if (size > CONFIG.MAX_FILE_SIZE) {
          return send(ws, {
            type: MessageTypes.ERROR,
            error: "File too large",
          });
        }
        activeSends.set(fileId, { from: deviceId, to, size, receivedBytes: 0 });
        forward(to, { ...msg, from: deviceId });
        break;
      }
      case MessageTypes.FILE_CHUNK: {
        const { fileId, data } = msg;
        const state = activeSends.get(fileId);
        if (!state)
          return send(ws, {
            type: MessageTypes.ERROR,
            error: "Unknown fileId",
          });
        const bytes = Buffer.from(data, "base64").length;
        state.receivedBytes += bytes;
        if (state.receivedBytes > state.size) {
          activeSends.delete(fileId);
          return send(ws, {
            type: MessageTypes.ERROR,
            error: "File size exceeded",
          });
        }
        forward(state.to, { ...msg, from: deviceId });
        break;
      }
      case MessageTypes.FILE_COMPLETE: {
        const { fileId } = msg;
        const state = activeSends.get(fileId);
        if (state) {
          forward(state.to, { ...msg, from: deviceId });
          activeSends.delete(fileId);
        }
        break;
      }
      case MessageTypes.FILE_CANCEL: {
        const { fileId } = msg;
        const state = activeSends.get(fileId);
        if (state) {
          forward(state.to, {
            ...msg,
            from: deviceId,
            reason: msg.reason || "",
          });
          activeSends.delete(fileId);
        }
        break;
      }

      case MessageTypes.FS_LIST: {
        try {
          const rel = msg.path || ".";
          const data = host.listDir(rel);
          send(ws, {
            type: MessageTypes.FS_LIST_RESULT,
            requestId: msg.requestId,
            data,
          });
        } catch (e) {
          send(ws, {
            type: MessageTypes.ERROR,
            error: e.message,
            requestId: msg.requestId,
          });
        }
        break;
      }

      case MessageTypes.SHELL_RUN: {
        if (!CONFIG.ALLOW_SHELL) {
          return send(ws, {
            type: MessageTypes.ERROR,
            error: "Shell disabled",
            requestId: msg.requestId,
          });
        }
        const { command, args = [] } = msg;
        if (typeof command !== "string" || !command.length) {
          return send(ws, {
            type: MessageTypes.ERROR,
            error: "Invalid command",
            requestId: msg.requestId,
          });
        }
        try {
          host.runShell(
            command,
            args,
            (stream, text) => {
              send(ws, {
                type: MessageTypes.SHELL_OUTPUT,
                requestId: msg.requestId,
                stream,
                data: text,
              });
            },
            (code) => {
              send(ws, {
                type: MessageTypes.SHELL_DONE,
                requestId: msg.requestId,
                code,
              });
            }
          );
        } catch (e) {
          send(ws, {
            type: MessageTypes.ERROR,
            error: e.message,
            requestId: msg.requestId,
          });
        }
        break;
      }

      default:
        send(ws, { type: MessageTypes.ERROR, error: "Unknown message type" });
    }
  });

  ws.on("close", () => {
    if (authed && deviceId && devices.get(deviceId)?.ws === ws) {
      devices.delete(deviceId);
      broadcastPresence(deviceId, "offline");
      sendDeviceListAll();
    }
  });
});
