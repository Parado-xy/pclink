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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Middleware: token check for REST
function authMiddleware(req, res, next) {
  const token = req.headers["x-auth-token"];
  if (token !== CONFIG.TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// Send shared protocol file.
app.get("/shared/protocol.js", (req, res) => {
  res.sendFile("./shared/protocol.js", { root: "./" });
});

app.use(express.static(path.join(__dirname, "..", "public")));

// TODO: Make this endpoint actually produce something important.
app.get("/health", (_req, res) => res.json({ ok: true }));

// File system API
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

// Configure mutler for file upload.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: CONFIG.MAX_FILE_SIZE },
});

app.post("/api/upload", authMiddleware, upload.any(), (req, res) => {
  // The file being uploaded to the host will either land in the
  // query destination or the "root" of the user's given ROOT_DIR
  const dest = req.query.dest || ".";
  try {
    // NOTE: The dest passed here must be  in the users specified ROOT_DIR
    const destAbs = host.resolvePath(dest);
    // If the directory does not exist, make the directory.
    if (!fs.existsSync(destAbs)) fs.mkdirSync(destAbs, { recursive: true });
    // If the destination path exists, but is not a directory throw an error.
    if (!fs.statSync(destAbs).isDirectory())
      throw new Error("Destination not a directory");

    // We write every file synchronously to the output
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
});

const wss = new WebSocketServer({ server });

// Device registry: deviceId -> { ws, lastSeen }
const devices = new Map();
// Active file sends: fileId -> { from, to, size, receivedBytes }
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

// Host integration instance
const host = new HostIntegration({
  broadcastFn: (msg) => {
    // Only broadcast host clipboard to others
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
      if (msg.token !== CONFIG.TOKEN) {
        return send(ws, { type: MessageTypes.ERROR, error: "Unauthorized" });
      }
      authed = true;
      deviceId = (msg.deviceId || "").trim() || `device-${randomUUID()}`;
      if (devices.has(deviceId)) {
        // Replace
        try {
          devices.get(deviceId).ws.close(4000, "Replaced");
        } catch {}
      }
      devices.set(deviceId, { ws, lastSeen: Date.now() });

      // Let's send shell: true | false depending on the user's config.
      send(ws, {
        type: MessageTypes.ACK,
        deviceId,
        role: deviceId === "host" ? "host" : "client",
        shell: CONFIG.ALLOW_SHELL,
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
      // Existing clipboard broadcast (client ↔ client)
      case MessageTypes.CLIPBOARD_UPDATE: {
        const enriched = { ...msg, from: deviceId, timestamp: Date.now() };
        // If the message has a Destination, forward to that client.
        if (msg.to) {
          forward(msg.to, enriched);
        } else {
          // Else, broadcast the message.
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

      // Host clipboard set request
      case MessageTypes.HOST_CLIPBOARD_SET: {
        if (!CONFIG.ALLOW_REMOTE_CLIPBOARD_SET) {
          return send(ws, {
            type: MessageTypes.ERROR,
            error: "Host clipboard setting disabled",
          });
        }
        if (typeof msg.data !== "string") {
          return send(ws, {
            type: MessageTypes.ERROR,
            error: "Invalid clipboard data",
          });
        }
        // Set the host's clipboard
        host
          .setClipboard(msg.data)
          .then(() => {
            // Force immediate broadcast
            broadcast({
              type: MessageTypes.HOST_CLIPBOARD_UPDATE,
              data: msg.data,
              from: "host",
              timestamp: Date.now(),
            });
          })
          .catch((e) => {
            send(ws, { type: MessageTypes.ERROR, error: e.message });
          });
        break;
      }

      // File transfers (browser ↔ browser)
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

      // File system listing via WebSocket (optional; REST already exists)
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

      // Shell commands
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
            // stream: ["stdout" | "stderr"]
            // text: [string output]
            (stream, text) => {
              send(ws, {
                type: MessageTypes.SHELL_OUTPUT,
                requestId: msg.requestId,
                stream,
                data: text,
              });
            },
            // code: ["Shell Exit Code"]
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
