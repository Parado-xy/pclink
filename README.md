

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
# Required: secure server token
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
```

### Run the Server

```bash
npm start
```

Server will be available at:

```
http://localhost:8443
```

### Remote Access via Internet (ngrok recommended)

```bash
npm install -g ngrok
ngrok http 8443
```

Use the provided HTTPS URL, replacing `https://` with `wss://` for WebSocket connections.

---

##  Security Best Practices

* **Tokens**: Treat `SERVER_TOKEN` like a password. Use `openssl rand -hex 32` to generate it.
* **File System**: Never set `ROOT_DIR` to `/` or `C:\`. Use dedicated, low-risk directories.
* **Shell Access**: Keep disabled unless required. Always whitelist commands.
* **Network**: Use HTTPS/WSS in production and consider VPN access.

---

## 🛠 Architecture Overview

**Server** (`server/server.js`)

* Express.js HTTP server with WebSocket support
* Token-based authentication middleware
* RESTful API endpoints for file operations
* Real-time WebSocket routing

**Host Integration** (`server/hostIntegration.js`)

* Cross-platform clipboard monitoring and manipulation
* Sandboxed file system operations with path traversal protection
* Optional shell command execution with whitelisting

**Web Client** (`public/app.js`)

* Modern JavaScript ES6 modules
* WebSocket client with auto-reconnection
* File drag-and-drop interface
* Real-time clipboard and device status updates

**Protocol Layer** (`shared/protocol.js`)

* Standardized message types for client-server communication
* Error handling and validation

---

##  Data Flow

1. **Authentication**: Client connects with `SERVER_TOKEN` and device ID.
2. **Registration**: Server validates and registers the device.
3. **Real-time Sync**: WebSocket messages manage clipboard, file transfers, and commands.
4. **File Ops**: HTTP endpoints stream uploads/downloads.
5. **Cleanup**: Device deregisters automatically on disconnect.

---

##  API Reference

### WebSocket Messages

```json
{ "type": "AUTH", "token": "your-token", "deviceId": "unique-device-id" }
{ "type": "CLIPBOARD_UPDATE", "data": "clipboard-content", "source": "device-id" }
{ "type": "SET_HOST_CLIPBOARD", "data": "new-content" }
{ "type": "FILE_START", "fileName": "document.pdf", "fileSize": 1024000, "target": "device-id" }
```

### HTTP Endpoints

* `GET /api/fs/list?path=./Documents` – List directory contents
* `GET /api/fs/download?path=./file.txt` – Download file
* `POST /api/fs/upload` – Upload files
* `POST /api/shell` – Execute shell command (if enabled)

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
* Per-device JWT authentication
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




