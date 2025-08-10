# PC Link - Cross-Platform Remote PC Management

PC Link transforms your personal computer into a remotely accessible host agent with comprehensive OS integrations. Access your PC's clipboard, file system, and shell commands from any web browser across different devices and networks.

## Core Features

**Real-Time Clipboard Synchronization**
- Automatic clipboard monitoring and broadcasting from host to all connected browsers
- Optional remote clipboard modification (configurable)
- Cross-device clipboard sharing between browser clients

**Secure File System Access**
- Sandboxed file system browsing with configurable root directory
- Bidirectional file transfer between host and browsers
- Peer-to-peer file sharing through server relay for browser-to-browser transfers
- Drag-and-drop file upload support

**Remote System Control**
- Optional remote shell command execution with whitelist support
- Multi-device connection management with presence tracking
- Real-time WebSocket communication for instant updates

## Installation and Setup

### Prerequisites
- Node.js 14+ 
- npm or yarn package manager

### Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment variables:**
   Create a `.env` file in the project root:
   ```bash
   # Required: Generate a secure server token
   SERVER_TOKEN=$(openssl rand -hex 32)
   
   # Optional: Set file system root directory (defaults to user home)
   ROOT_DIR=/Users/username/Shared
   
   # Optional: Enable remote clipboard modification
   ALLOW_REMOTE_CLIPBOARD_SET=true
   
   # Optional: Enable shell access (disabled by default for security)
   ALLOW_SHELL=false
   
   # Optional: Whitelist allowed shell commands (if ALLOW_SHELL=true)
   SHELL_WHITELIST=ls,pwd,whoami,git
   
   # Optional: Configure server port (defaults to 8443)
   PORT=8443
   ```

3. **Start the server:**
   ```bash
   npm start
   ```
   Server will be available at `http://localhost:8443`

4. **Expose to internet (recommended: ngrok):**
   ```bash
   # Install ngrok if not already installed
   npm install -g ngrok
   
   # Expose local server
   ngrok http 8443
   ```
   Use the provided HTTPS URL, replacing `https://` with `wss://` for WebSocket connections.

5. **Connect from remote devices:**
   - Open the ngrok URL in any web browser
   - Enter your SERVER_TOKEN and a unique device identifier
   - Access all PC Link features through the web interface

## Configuration Options

### Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `SERVER_TOKEN` | Authentication token for all connections | None | Yes |
| `PORT` | Server listening port | 8443 | No |
| `ROOT_DIR` | File system access root directory | User home directory | No |
| `ALLOW_REMOTE_CLIPBOARD_SET` | Allow browsers to modify host clipboard | false | No |
| `ALLOW_SHELL` | Enable remote shell command execution | false | No |
| `SHELL_WHITELIST` | Comma-separated list of allowed commands | None | No |

### Security Recommendations

**Token Management:**
- Generate cryptographically secure tokens using `openssl rand -hex 32`
- Treat SERVER_TOKEN as a password - never share publicly
- Consider implementing token rotation for enhanced security

**Network Security:**
- Always use HTTPS/WSS in production (ngrok provides this automatically)
- Consider VPN access for additional network-level security
- Monitor connection logs for unauthorized access attempts

**File System Security:**
- Never set ROOT_DIR to system root (`/` or `C:\`) 
- Use dedicated shared directories with minimal sensitive content
- Regularly audit accessible directories for sensitive files

**Shell Access Security:**
- Keep ALLOW_SHELL disabled unless absolutely necessary
- Use SHELL_WHITELIST to restrict available commands
- Monitor shell command execution logs
- Consider read-only operations where possible

## Architecture Overview

### Components

**Server (`server/server.js`)**
- Express.js HTTP server with WebSocket support
- Token-based authentication middleware
- RESTful API endpoints for file operations
- Real-time WebSocket message routing

**Host Integration (`server/hostIntegration.js`)**
- Cross-platform clipboard monitoring and manipulation
- Sandboxed file system operations with path traversal protection
- Shell command execution with optional whitelisting
- OS-specific integrations for Windows, macOS, and Linux

**Web Client (`public/app.js`)**
- Modern JavaScript ES6 modules
- WebSocket client with automatic reconnection
- File drag-and-drop interface
- Real-time UI updates for clipboard and device status

**Protocol Layer (`shared/protocol.js`)**
- Standardized message types for all client-server communication
- Type-safe message structure definitions
- Error handling and validation schemas

### Data Flow

1. **Authentication:** Client connects with SERVER_TOKEN and device ID
2. **Registration:** Server validates token and registers device session
3. **Real-time Updates:** WebSocket messages handle clipboard, file transfers, and commands
4. **File Operations:** HTTP endpoints serve file downloads/uploads with streaming support
5. **Cleanup:** Automatic device deregistration on disconnect

## API Reference

### WebSocket Messages

**Authentication:**
```javascript
{ type: "AUTH", token: "your-token", deviceId: "unique-device-id" }
```

**Clipboard Operations:**
```javascript
{ type: "CLIPBOARD_UPDATE", data: "clipboard-content", source: "device-id" }
{ type: "SET_HOST_CLIPBOARD", data: "new-content" }
```

**File Transfer:**
```javascript
{ type: "FILE_START", fileName: "document.pdf", fileSize: 1024000, target: "device-id" }
{ type: "FILE_CHUNK", data: "base64-encoded-chunk", chunkIndex: 0 }
{ type: "FILE_END", fileName: "document.pdf" }
```

### HTTP Endpoints

**File System:**
- `GET /api/fs/list?path=./Documents` - List directory contents
- `GET /api/fs/download?path=./file.txt` - Download file
- `POST /api/fs/upload` - Upload files (multipart/form-data)

**System:**
- `GET /health` - Server health check
- `POST /api/shell` - Execute shell command (if enabled)

## Deployment Options

### Local Network
```bash
npm start
# Access via http://your-local-ip:8443
```

### Internet Access via ngrok
```bash
npm start
ngrok http 8443
# Use provided ngrok URL
```

### Reverse Proxy (nginx/Apache)
Configure your reverse proxy to handle HTTPS termination and WebSocket upgrades:
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

## Development and Extension

### Project Structure
```
pclink/
├── server/
│   ├── server.js          # Main server application
│   ├── hostIntegration.js # OS-level integrations
│   └── config.js          # Configuration management
├── public/
│   ├── index.html         # Web client interface
│   ├── app.js             # Client-side JavaScript
│   └── style.css          # UI styling
├── shared/
│   └── protocol.js        # Message type definitions
└── package.json
```

### Future Enhancement Ideas

**Security Enhancements:**
- End-to-end encryption using X25519 key exchange and AES-GCM
- Per-device token authentication with JWT
- Session timeout and automatic token rotation
- Audit logging with tamper protection

**Performance Optimizations:**
- Binary WebSocket frames for file transfers
- File transfer resumption and integrity checking
- Compressed message payloads for large clipboard content
- Connection pooling for multiple simultaneous file operations

**Feature Extensions:**
- Image clipboard support with automatic format conversion
- File system change notifications using fs.watch()
- Directory pagination and search functionality
- Remote process monitoring and management
- Screen sharing and remote desktop capabilities

**User Experience:**
- Mobile-optimized responsive interface
- Offline file queue with automatic retry
- File transfer progress visualization
- Keyboard shortcuts for common operations

### Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Implement changes with appropriate tests
4. Ensure security best practices are followed
5. Submit a pull request with detailed description

## Troubleshooting

### Common Issues

**Connection Failures:**
- Verify SERVER_TOKEN matches between client and server
- Check firewall settings allow traffic on configured port
- Ensure WebSocket URL uses `wss://` for HTTPS deployments

**File Transfer Issues:**
- Confirm ROOT_DIR has appropriate read/write permissions
- Check available disk space for large file transfers
- Verify file paths don't contain invalid characters

**Clipboard Problems:**
- Some browsers require user interaction before clipboard access
- Check browser permissions for clipboard API usage
- Ensure host system allows clipboard access for the application

**Performance Issues:**
- Monitor memory usage during large file transfers
- Consider reducing concurrent connection limits
- Check network bandwidth for slow transfer speeds

## License

This project is provided as-is for educational and personal use. Review all security implications before deploying in production environments.

## Security Disclaimer

PC Link provides remote access to your computer's file system and potentially shell access. Only use trusted networks and secure authentication tokens. The authors are not responsible for security breaches resulting from misconfiguration