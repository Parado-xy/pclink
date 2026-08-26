

# PC Link – Your PC, Anywhere

**PC Link** turns any computer into a secure, web-accessible control center.
From any browser, anywhere, you can:

* **Sync clipboards in real time** between your PC and all connected devices.
* **Browse and transfer files** instantly across platforms.
* **Run remote shell commands** (securely whitelisted) for powerful admin control.

No heavy installs. No vendor lock-in. Just Node.js, your PC, and a secure connection.
Whether you’re on your phone, tablet, or another laptop halfway across the world — if you can open a browser, you can control your PC.

---

##  Core Features

### Real-Time Clipboard Synchronization

* Automatic clipboard monitoring and broadcasting from host to connected browsers.
* Optional remote clipboard modification (configurable).
* Cross-device clipboard sharing between browser clients.

### Secure File System Access

* Sandboxed file browsing with a configurable root directory.
* Bidirectional file transfer between host and browsers.
* Peer-to-peer file sharing through a server relay for browser-to-browser transfers.
* Drag-and-drop file upload support.

### Remote System Control

* Optional remote shell command execution with whitelist support.
* Multi-device connection management with presence tracking.
* Real-time WebSocket communication for instant updates.

### Per-device tokens & easy pairing

* Long-lived **per-device tokens** (stored as hashes in `devices.json`) instead of sharing one master token with every client.
* **6-digit pairing codes** (2-minute TTL, one-time use) so you can onboard a new PC without typing or emailing the long secret.
* Master `SERVER_TOKEN` still works for bootstrap / admin; new devices never need to see it.

---

##  Quick Start

### Prerequisites

* Node.js 14+
* npm or yarn

### Installation

```bash
npm install
```

### Configuration

Create a `.env` file in the project root:

```bash
# Required: secure server token (bootstrap / admin)
SERVER_TOKEN=$(openssl rand -hex 32)

# Optional: file system root directory (defaults to user home)
ROOT_DIR=/Users/username/Shared

# Optional: enable remote clipboard modification
ALLOW_REMOTE_CLIPBOARD_SET=true

# Optional: enable shell access (disabled by default)
ALLOW_SHELL=false

# Optional: whitelist shell commands (if ALLOW_SHELL=true)
SHELL_WHITELIST=ls,pwd,whoami,git

# Optional: server port (default: 8443)
PORT=8443

# Optional: pairing code lifetime in ms (default: 120000 = 2 min)
PAIRING_TTL_MS=120000
```

### Run the Server

```bash
npm start
```

Server will be available at:

```
http://localhost:8443
```

### Pairing a new device (PC-to-PC friendly)

1. On an **already connected** device, click the key icon in the device bar ("Generate pairing code").
2. A **6-digit code** appears (valid ~2 minutes, one-time use).
3. On the **new device**, open the UI, switch to **Pairing code**, enter the server WebSocket URL and the 6-digit code, then Connect.
4. The server exchanges the code for a unique per-device token. That token is stored locally if "Remember credentials" is checked. The master `SERVER_TOKEN` is never sent to the new device.

You can still connect with the master token or any existing per-device token via the **Token** tab.

### Remote Access via Internet (ngrok recommended)

```bash
npm install -g ngrok
ngrok http 8443
```

Use the provided HTTPS URL, replacing `https://` with `wss://` for WebSocket connections.

---

##  Security Best Practices

* **Tokens**: Treat `SERVER_TOKEN` like a password. Use `openssl rand -hex 32` to generate it. Prefer per-device tokens for day-to-day clients so you can revoke one device without rotating everyone.
* **devices.json**: Contains only token **hashes**. Still keep the file private; it is gitignored by default.
* **File System**: Never set `ROOT_DIR` to `/` or `C:\\`. Use dedicated, low-risk directories.
* **Shell Access**: Keep disabled unless required. Always whitelist commands.
* **Network**: Use HTTPS/WSS in production and consider VPN access.

---

## 🛠 Architecture Overview

**Server** (`server/server.js`)

* Express.js HTTP server with WebSocket support
* Token-based authentication (master or per-device)
* RESTful API endpoints for file operations and pairing
* Real-time WebSocket routing

**Device store** (`server/deviceStore.js`)

* Persistent per-device token hashes (`devices.json`)
* Short-lived pairing codes

**Host Integration** (`server/hostIntegration.js`)

* Cross-platform clipboard monitoring and manipulation
* Sandboxed file system operations with path traversal protection
* Optional shell command execution with whitelisting

**Web Client** (`public/app.js`)

* Modern JavaScript ES6 modules
* WebSocket client
* Token or pairing-code auth modes
* File drag-and-drop interface
* Real-time clipboard and device status updates

**Protocol Layer** (`shared/protocol.js`)

* Standardized message types for client-server communication
* Error handling and validation

---

##  Data Flow

1. **Authentication**: Client connects with master or per-device token (or completes pairing first).
2. **Registration**: Server validates and registers the device.
3. **Real-time Sync**: WebSocket messages manage clipboard, file transfers, and commands.
4. **File Ops**: HTTP endpoints stream uploads/downloads.
5. **Cleanup**: Device deregisters automatically on disconnect. Tokens can be revoked via `DELETE /api/devices/:deviceId`.

---

##  API Reference

### Pairing

* `POST /api/pair/start` (auth required) – mint a 6-digit code `{ code, expiresAt, expiresInSeconds }`
* `POST /api/pair/complete` (public) – body `{ code, deviceId?, name? }` → `{ deviceId, token }`
* `GET /api/devices` (auth) – list registered devices
* `DELETE /api/devices/:deviceId` (auth) – revoke a device token

### WebSocket Messages

```json
{ "type": "auth", "token": "your-token", "deviceId": "unique-device-id" }
{ "type": "pair_request" }
{ "type": "pair_code", "code": "123456", "expiresInSeconds": 120 }
{ "type": "clipboard_update", "data": "clipboard-content" }
{ "type": "host_clipboard_set", "data": "new-content" }
{ "type": "file_send_init", "fileId": "...", "to": "device-id", "name": "doc.pdf", "size": 1024 }
```

### HTTP Endpoints

* `GET /api/dir?path=.` – List directory contents
* `GET /api/download?path=./file.txt` – Download file
* `POST /api/upload?dest=.` – Upload files

---

##  Deployment Options

**Local Network**

```bash
npm start
```

Access via: `http://your-local-ip:8443`

**Internet (ngrok)**

```bash
npm start
ngrok http 8443
```

**Reverse Proxy (nginx)**

```nginx
location / {
    proxy_pass http://localhost:8443;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
}
```

---

##  Future Enhancements

**Security**

* End-to-end encryption with X25519 + AES-GCM
* Token rotation and session timeout

**Performance**

* Binary WebSocket frames for file transfers
* Transfer resumption and integrity checking
* Payload compression

**Features**

* Image clipboard support
* File system change notifications
* Remote process monitoring and management
* Screen sharing and remote desktop

**UX**

* Mobile-optimized interface
* File transfer progress visualization
* Keyboard shortcuts

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch:

   ```bash
   git checkout -b feature-name
   ```
3. Implement changes with tests
4. Follow security best practices
5. Submit a pull request with a detailed description

---

## ⚠ Security Disclaimer

PC Link provides remote access to your computer’s file system and potentially shell access.
Only use trusted networks, secure tokens, and review configurations carefully.
The authors are not responsible for breaches due to misconfiguration.




