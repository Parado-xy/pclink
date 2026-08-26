import clipboardy from "clipboardy";
import crypto from "crypto";
import { MessageTypes } from "../shared/protocol.js";
import fs from "fs";
import os from "os";
import path from "path";
import { CONFIG } from "./config.js";
import { spawn, execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/** Characters that enable shell metacharacter injection */
const SHELL_META = /[;&|`$<>(){}\[\]\n\r\\]/;

export class HostIntegration {
  constructor({ broadcastFn }) {
    this.broadcastFn = broadcastFn;
    this.clipboardHash = null;
    this.clipboardInterval = null;
  }

  startClipboardWatcher(intervalMs = 2000) {
    this.clipboardInterval = setInterval(async () => {
      try {
        const payload = await this.readClipboard();
        if (!payload) return;

        // Cheap change detection: type + size + hash of data (or prefix for large images)
        const hashInput =
          payload.contentType === "image/png"
            ? `img:${payload.size}:${payload.data.slice(0, 64)}`
            : `txt:${payload.data}`;
        const hash = sha256(hashInput);

        if (hash === this.clipboardHash) return;
        this.clipboardHash = hash;

        if (
          payload.contentType === "image/png" &&
          payload.size > CONFIG.MAX_CLIPBOARD_IMAGE_BYTES
        ) {
          // Announce oversized image without shipping bytes
          this.broadcastFn({
            type: MessageTypes.HOST_CLIPBOARD_UPDATE,
            contentType: "image/png",
            data: null,
            size: payload.size,
            skipped: true,
            reason: "Image exceeds MAX_CLIPBOARD_IMAGE_BYTES",
            timestamp: Date.now(),
          });
          return;
        }

        this.broadcastFn({
          type: MessageTypes.HOST_CLIPBOARD_UPDATE,
          contentType: payload.contentType,
          data: payload.data,
          size: payload.size ?? undefined,
          timestamp: Date.now(),
        });
      } catch {
        // ignore transient clipboard errors
      }
    }, intervalMs);
  }

  stopClipboardWatcher() {
    if (this.clipboardInterval) clearInterval(this.clipboardInterval);
  }

  /**
   * Read host clipboard: prefer image/png, fall back to text/plain.
   * @returns {Promise<{ contentType: string, data: string, size?: number }|null>}
   */
  async readClipboard() {
    const image = await this.readClipboardImage();
    if (image) {
      return {
        contentType: "image/png",
        data: image.base64,
        size: image.size,
      };
    }
    try {
      const text = await clipboardy.read();
      if (text == null || text === "") return null;
      return { contentType: "text/plain", data: text };
    } catch {
      return null;
    }
  }

  /**
   * Platform-specific image clipboard read → PNG base64.
   */
  async readClipboardImage() {
    const platform = process.platform;
    try {
      if (platform === "darwin") {
        return await this._readImageMac();
      }
      if (platform === "linux") {
        return await this._readImageLinux();
      }
      if (platform === "win32") {
        return await this._readImageWindows();
      }
    } catch {
      return null;
    }
    return null;
  }

  async _readImageMac() {
    // osascript → write PNGf clipboard to a temp file
    const tmp = path.join(
      os.tmpdir(),
      `pclink-clip-${process.pid}-${Date.now()}.png`
    );
    const script = `
      try
        set png_data to (the clipboard as «class PNGf»)
        set outFile to open for access POSIX file "${tmp.replace(/\\/g, "/")}" with write permission
        set eof outFile to 0
        write png_data to outFile
        close access outFile
        return "ok"
      on error
        try
          close access POSIX file "${tmp.replace(/\\/g, "/")}"
        end try
        return "empty"
      end try
    `;
    try {
      const { stdout } = await execFileAsync("osascript", ["-e", script], {
        timeout: 5000,
        maxBuffer: 2 * 1024 * 1024,
      });
      if (!String(stdout).includes("ok") || !fs.existsSync(tmp)) return null;
      const buf = fs.readFileSync(tmp);
      if (!buf.length) return null;
      return { base64: buf.toString("base64"), size: buf.length };
    } finally {
      try {
        fs.unlinkSync(tmp);
      } catch {}
    }
  }

  async _readImageLinux() {
    // Requires xclip with image/png target
    try {
      const { stdout } = await execFileAsync(
        "xclip",
        ["-selection", "clipboard", "-t", "image/png", "-o"],
        { encoding: "buffer", timeout: 5000, maxBuffer: 12 * 1024 * 1024 }
      );
      if (!stdout || !stdout.length) return null;
      return { base64: Buffer.from(stdout).toString("base64"), size: stdout.length };
    } catch {
      return null;
    }
  }

  async _readImageWindows() {
    const tmp = path.join(
      os.tmpdir(),
      `pclink-clip-${process.pid}-${Date.now()}.png`
    );
    const ps = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$img = [System.Windows.Forms.Clipboard]::GetImage()
if ($null -eq $img) { exit 2 }
$img.Save('${tmp.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)
`;
    try {
      await execFileAsync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", ps],
        { timeout: 8000 }
      );
      if (!fs.existsSync(tmp)) return null;
      const buf = fs.readFileSync(tmp);
      if (!buf.length) return null;
      return { base64: buf.toString("base64"), size: buf.length };
    } finally {
      try {
        fs.unlinkSync(tmp);
      } catch {}
    }
  }

  /**
   * Set host clipboard to text or image.
   * @param {string} data - text or base64 PNG
   * @param {string} [contentType='text/plain']
   */
  async setClipboard(data, contentType = "text/plain") {
    if (contentType === "image/png") {
      await this.writeClipboardImage(data);
      return;
    }
    await clipboardy.write(typeof data === "string" ? data : String(data));
  }

  async writeClipboardImage(base64Png) {
    const buf = Buffer.from(base64Png, "base64");
    if (buf.length > CONFIG.MAX_CLIPBOARD_IMAGE_BYTES) {
      throw new Error("Image too large for clipboard");
    }
    const platform = process.platform;
    const tmp = path.join(
      os.tmpdir(),
      `pclink-set-${process.pid}-${Date.now()}.png`
    );
    fs.writeFileSync(tmp, buf);
    try {
      if (platform === "darwin") {
        await execFileAsync(
          "osascript",
          [
            "-e",
            `set the clipboard to (read (POSIX file "${tmp.replace(/\\/g, "/")}") as «class PNGf»)`,
          ],
          { timeout: 5000 }
        );
      } else if (platform === "linux") {
        await new Promise((resolve, reject) => {
          const proc = spawn(
            "xclip",
            ["-selection", "clipboard", "-t", "image/png"],
            { stdio: ["pipe", "ignore", "pipe"] }
          );
          let err = "";
          proc.stderr.on("data", (d) => (err += d.toString()));
          proc.on("close", (code) =>
            code === 0 ? resolve() : reject(new Error(err || `xclip exit ${code}`))
          );
          proc.stdin.write(buf);
          proc.stdin.end();
        });
      } else if (platform === "win32") {
        const ps = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile('${tmp.replace(/'/g, "''")}')
[System.Windows.Forms.Clipboard]::SetImage($img)
$img.Dispose()
`;
        await execFileAsync(
          "powershell.exe",
          ["-NoProfile", "-NonInteractive", "-Command", ps],
          { timeout: 8000 }
        );
      } else {
        throw new Error("Image clipboard not supported on this platform");
      }
    } finally {
      try {
        fs.unlinkSync(tmp);
      } catch {}
    }
  }

  resolvePath(rel) {
    const p = path.resolve(CONFIG.ROOT_DIR, rel || ".");
    if (!p.startsWith(CONFIG.ROOT_DIR)) {
      throw new Error("Path outside sandbox");
    }
    return p;
  }

  listDir(relPath = ".") {
    const abs = this.resolvePath(relPath);
    const stats = fs.statSync(abs);
    if (!stats.isDirectory()) {
      throw new Error("Not a directory");
    }
    const entries = fs.readdirSync(abs, { withFileTypes: true }).map((d) => ({
      name: d.name,
      type: d.isDirectory() ? "dir" : "file",
    }));
    return {
      path: relPath,
      abs,
      entries,
    };
  }

  /**
   * Run a command with hardened whitelist enforcement.
   * - Rejects shell metacharacters in command and args
   * - When SHELL_WHITELIST is set: shell:false always, basename must match list
   * - Never passes user input through a shell string
   */
  runShell(command, args = [], onData, onClose) {
    if (!CONFIG.ALLOW_SHELL) {
      throw new Error("Shell disabled");
    }
    if (typeof command !== "string" || !command.trim()) {
      throw new Error("Invalid command");
    }
    if (!Array.isArray(args)) {
      throw new Error("args must be an array");
    }

    const trimmed = command.trim();

    // Block path tricks and metacharacters in the command name
    if (SHELL_META.test(trimmed) || trimmed.includes("/") || trimmed.includes("\\")) {
      // Allow absolute paths only when whitelist is empty (admin mode)
      if (CONFIG.SHELL_WHITELIST.length || SHELL_META.test(trimmed)) {
        throw new Error("Command contains disallowed characters or path separators");
      }
    }

    for (const a of args) {
      if (typeof a !== "string") {
        throw new Error("All args must be strings");
      }
      if (SHELL_META.test(a)) {
        throw new Error("Argument contains disallowed shell metacharacters");
      }
    }

    const base = path.basename(trimmed);

    if (CONFIG.SHELL_WHITELIST.length) {
      const allowed = CONFIG.SHELL_WHITELIST.some(
        (w) => w === base || w === trimmed
      );
      if (!allowed) {
        throw new Error("Command not allowed");
      }
    }

    let spawnCommand = trimmed;
    let spawnArgs = [...args];
    // Default: never use a shell when whitelist is active
    let spawnOptions = {
      shell: false,
      cwd: CONFIG.ROOT_DIR,
      env: process.env,
    };

    if (process.platform === "win32") {
      const builtInCommands = new Set([
        "dir",
        "cd",
        "copy",
        "move",
        "del",
        "type",
        "echo",
        "cls",
        "md",
        "rd",
        "mkdir",
        "rmdir",
      ]);
      const baseLower = base.toLowerCase();

      if (builtInCommands.has(baseLower)) {
        // cmd /c with separate argv — not a single interpolated string
        spawnCommand = process.env.ComSpec || "cmd.exe";
        spawnArgs = ["/d", "/s", "/c", base, ...args];
        spawnOptions.shell = false;
        spawnOptions.windowsVerbatimArguments = false;
      } else if (!CONFIG.SHELL_WHITELIST.length) {
        // No whitelist: allow PATH resolution via shell (documented risk)
        spawnOptions.shell = true;
      } else {
        // Whitelisted external binary — shell:false, rely on PATH
        spawnCommand = base;
        spawnArgs = [...args];
        spawnOptions.shell = false;
      }
    } else {
      // Unix: always shell:false when whitelist set; otherwise also prefer false
      // so metacharacters in command never get interpreted.
      spawnCommand = CONFIG.SHELL_WHITELIST.length ? base : trimmed;
      spawnArgs = [...args];
      spawnOptions.shell = false;
    }

    const proc = spawn(spawnCommand, spawnArgs, spawnOptions);
    proc.stdout.on("data", (d) => onData("stdout", d.toString()));
    proc.stderr.on("data", (d) => onData("stderr", d.toString()));
    proc.on("error", (err) => {
      onData("stderr", err.message + "\n");
      onClose(1);
    });
    proc.on("close", (code) => onClose(code));
    return proc;
  }
}

function sha256(str) {
  return crypto.createHash("sha256").update(str).digest("hex");
}
