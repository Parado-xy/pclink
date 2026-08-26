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
    this._imageReadWarned = false;
  }

  startClipboardWatcher(intervalMs = 2000) {
    // Avoid overlapping polls (image reads can be slow)
    let busy = false;
    this.clipboardInterval = setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        const payload = await this.readClipboard();
        if (!payload) return;

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
      } catch (e) {
        if (!this._imageReadWarned) {
          console.warn("[clipboard] poll error:", e.message);
          this._imageReadWarned = true;
        }
      } finally {
        busy = false;
      }
    }, intervalMs);
  }

  stopClipboardWatcher() {
    if (this.clipboardInterval) clearInterval(this.clipboardInterval);
  }

  /**
   * Prefer image when the OS reports one; only then fall back to text.
   * If an image is present but cannot be decoded, do not broadcast stale text.
   */
  async readClipboard() {
    const imagePresent = await this.hasClipboardImage();
    if (imagePresent) {
      const image = await this.readClipboardImage();
      if (image && image.size > 0) {
        return {
          contentType: "image/png",
          data: image.base64,
          size: image.size,
        };
      }
      // Image advertised but unreadable — skip this tick (don't send text/plain)
      if (!this._imageReadWarned) {
        console.warn(
          "[clipboard] Image present on clipboard but could not be read. " +
            "On Linux install xclip; on Windows STA clipboard access is required."
        );
        this._imageReadWarned = true;
      }
      return null;
    }

    // No image — try text
    try {
      const text = await clipboardy.read();
      if (text == null || text === "") return null;
      return { contentType: "text/plain", data: text };
    } catch {
      return null;
    }
  }

  async hasClipboardImage() {
    const platform = process.platform;
    try {
      if (platform === "darwin") {
        // clipboard info lists type codes; PNGf / TIFF / JPEG appear when image is set
        const { stdout } = await execFileAsync(
          "osascript",
          ["-e", "clipboard info"],
          { timeout: 3000 }
        );
        const s = String(stdout || "");
        return /PNGf|TIFF|JPEG|picture/i.test(s);
      }
      if (platform === "linux") {
        // Wayland
        try {
          const { stdout } = await execFileAsync(
            "wl-paste",
            ["--list-types"],
            { timeout: 2000 }
          );
          if (/image\//i.test(String(stdout))) return true;
        } catch {
          // not wayland or wl-clipboard missing
        }
        try {
          const { stdout } = await execFileAsync(
            "xclip",
            ["-selection", "clipboard", "-t", "TARGETS", "-o"],
            { timeout: 2000 }
          );
          return /image\/(png|jpeg|jpg|bmp|tiff)/i.test(String(stdout));
        } catch {
          return false;
        }
      }
      if (platform === "win32") {
        // ContainsImage is reliable under STA
        const ps =
          "Add-Type -AssemblyName System.Windows.Forms; " +
          "if ([System.Windows.Forms.Clipboard]::ContainsImage()) { '1' } else { '0' }";
        const { stdout } = await execFileAsync(
          "powershell.exe",
          ["-NoProfile", "-NonInteractive", "-STA", "-Command", ps],
          { timeout: 4000 }
        );
        return String(stdout).trim().startsWith("1");
      }
    } catch {
      return false;
    }
    return false;
  }

  async readClipboardImage() {
    const platform = process.platform;
    try {
      if (platform === "darwin") return await this._readImageMac();
      if (platform === "linux") return await this._readImageLinux();
      if (platform === "win32") return await this._readImageWindows();
    } catch (e) {
      if (!this._imageReadWarned) {
        console.warn("[clipboard] image read failed:", e.message);
        this._imageReadWarned = true;
      }
      return null;
    }
    return null;
  }

  async _readImageMac() {
    const tmp = path.join(
      os.tmpdir(),
      `pclink-clip-${process.pid}-${Date.now()}.png`
    );
    // Prefer pngpaste if installed (more reliable than AppleScript class coercion)
    try {
      await execFileAsync("pngpaste", [tmp], { timeout: 5000 });
      if (fs.existsSync(tmp)) {
        const buf = fs.readFileSync(tmp);
        try {
          fs.unlinkSync(tmp);
        } catch {}
        if (buf.length && isPng(buf)) {
          return { base64: buf.toString("base64"), size: buf.length };
        }
      }
    } catch {
      // fall through to osascript
    }

    const posix = tmp.replace(/\\/g, "/");
    // Write script to a file so «class PNGf» isn't mangled by shell layers
    const scriptPath = tmp + ".applescript";
    const script = `
try
  set png_data to (the clipboard as «class PNGf»)
  set fp to POSIX file "${posix}"
  set outFile to open for access fp with write permission
  set eof of outFile to 0
  write png_data to outFile
  close access outFile
  return "ok"
on error errMsg
  try
    close access POSIX file "${posix}"
  end try
  return "empty:" & errMsg
end try
`;
    fs.writeFileSync(scriptPath, script, "utf8");
    try {
      const { stdout } = await execFileAsync("osascript", [scriptPath], {
        timeout: 8000,
        maxBuffer: 4 * 1024 * 1024,
      });
      if (!String(stdout).includes("ok") || !fs.existsSync(tmp)) return null;
      const buf = fs.readFileSync(tmp);
      if (!buf.length || !isPng(buf)) return null;
      return { base64: buf.toString("base64"), size: buf.length };
    } finally {
      try {
        fs.unlinkSync(tmp);
      } catch {}
      try {
        fs.unlinkSync(scriptPath);
      } catch {}
    }
  }

  async _readImageLinux() {
    // Wayland first
    for (const type of ["image/png", "image/jpeg", "image/bmp"]) {
      try {
        const buf = await execCaptureBuffer("wl-paste", ["--type", type], 8000);
        if (buf && buf.length) {
          if (type === "image/png" && isPng(buf)) {
            return { base64: buf.toString("base64"), size: buf.length };
          }
          // Convert jpeg/bmp via no dependency: only accept png for now
          if (type === "image/png") {
            return { base64: buf.toString("base64"), size: buf.length };
          }
        }
      } catch {
        // continue
      }
    }

    // X11 xclip — try png then jpeg
    for (const type of ["image/png", "image/jpeg"]) {
      try {
        const buf = await execCaptureBuffer(
          "xclip",
          ["-selection", "clipboard", "-t", type, "-o"],
          8000
        );
        if (buf && buf.length) {
          if (type === "image/png" || isPng(buf)) {
            return { base64: buf.toString("base64"), size: buf.length };
          }
          // jpeg on clipboard: wrap as data still labeled image/png only if PNG magic;
          // otherwise skip (client expects png). Keep raw and label carefully:
          if (type === "image/jpeg") {
            // Send as base64 but we only advertise image/png in protocol — skip jpeg
            // unless we can leave it; better skip than mislabel.
            continue;
          }
        }
      } catch {
        // continue
      }
    }
    return null;
  }

  async _readImageWindows() {
    const tmp = path.join(
      os.tmpdir(),
      `pclink-clip-${process.pid}-${Date.now()}.png`
    );
    const tmpPs = tmp + ".ps1";
    // STA is required for WinForms clipboard. Script file avoids quoting issues.
    const ps = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
if (-not [System.Windows.Forms.Clipboard]::ContainsImage()) { exit 2 }
$img = [System.Windows.Forms.Clipboard]::GetImage()
if ($null -eq $img) { exit 3 }
$img.Save('${tmp.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)
$img.Dispose()
exit 0
`;
    fs.writeFileSync(tmpPs, ps, "utf8");
    try {
      await execFileAsync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-STA",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          tmpPs,
        ],
        { timeout: 10000 }
      );
      if (!fs.existsSync(tmp)) return null;
      const buf = fs.readFileSync(tmp);
      if (!buf.length || !isPng(buf)) return null;
      return { base64: buf.toString("base64"), size: buf.length };
    } catch {
      return null;
    } finally {
      try {
        fs.unlinkSync(tmp);
      } catch {}
      try {
        fs.unlinkSync(tmpPs);
      } catch {}
    }
  }

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
    if (!isPng(buf)) {
      throw new Error("Data is not a valid PNG");
    }
    const platform = process.platform;
    const tmp = path.join(
      os.tmpdir(),
      `pclink-set-${process.pid}-${Date.now()}.png`
    );
    fs.writeFileSync(tmp, buf);
    try {
      if (platform === "darwin") {
        const posix = tmp.replace(/\\/g, "/");
        const scriptPath = tmp + ".applescript";
        fs.writeFileSync(
          scriptPath,
          `set the clipboard to (read (POSIX file "${posix}") as «class PNGf»)\n`,
          "utf8"
        );
        try {
          await execFileAsync("osascript", [scriptPath], { timeout: 5000 });
        } finally {
          try {
            fs.unlinkSync(scriptPath);
          } catch {}
        }
      } else if (platform === "linux") {
        // Prefer wl-copy on Wayland
        let wrote = false;
        try {
          await new Promise((resolve, reject) => {
            const proc = spawn("wl-copy", ["--type", "image/png"], {
              stdio: ["pipe", "ignore", "pipe"],
            });
            let err = "";
            proc.stderr.on("data", (d) => (err += d.toString()));
            proc.on("close", (code) =>
              code === 0 ? resolve() : reject(new Error(err || `wl-copy ${code}`))
            );
            proc.stdin.write(buf);
            proc.stdin.end();
          });
          wrote = true;
        } catch {
          // fall back to xclip
        }
        if (!wrote) {
          await new Promise((resolve, reject) => {
            const proc = spawn(
              "xclip",
              ["-selection", "clipboard", "-t", "image/png"],
              { stdio: ["pipe", "ignore", "pipe"] }
            );
            let err = "";
            proc.stderr.on("data", (d) => (err += d.toString()));
            proc.on("close", (code) =>
              code === 0 ? resolve() : reject(new Error(err || `xclip ${code}`))
            );
            proc.stdin.write(buf);
            proc.stdin.end();
          });
        }
      } else if (platform === "win32") {
        const tmpPs = tmp + ".ps1";
        const ps = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile('${tmp.replace(/'/g, "''")}')
[System.Windows.Forms.Clipboard]::SetImage($img)
$img.Dispose()
`;
        fs.writeFileSync(tmpPs, ps, "utf8");
        try {
          await execFileAsync(
            "powershell.exe",
            [
              "-NoProfile",
              "-NonInteractive",
              "-STA",
              "-ExecutionPolicy",
              "Bypass",
              "-File",
              tmpPs,
            ],
            { timeout: 10000 }
          );
        } finally {
          try {
            fs.unlinkSync(tmpPs);
          } catch {}
        }
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

    if (SHELL_META.test(trimmed) || trimmed.includes("/") || trimmed.includes("\\")) {
      if (CONFIG.SHELL_WHITELIST.length || SHELL_META.test(trimmed)) {
        throw new Error("Command contains disallowed characters or path separators");
      }
    }

    for (const a of args) {
      if (typeof a !== "string") throw new Error("All args must be strings");
      if (SHELL_META.test(a)) {
        throw new Error("Argument contains disallowed shell metacharacters");
      }
    }

    const base = path.basename(trimmed);

    if (CONFIG.SHELL_WHITELIST.length) {
      const allowed = CONFIG.SHELL_WHITELIST.some(
        (w) => w === base || w === trimmed
      );
      if (!allowed) throw new Error("Command not allowed");
    }

    let spawnCommand = trimmed;
    let spawnArgs = [...args];
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
        spawnCommand = process.env.ComSpec || "cmd.exe";
        spawnArgs = ["/d", "/s", "/c", base, ...args];
        spawnOptions.shell = false;
      } else if (!CONFIG.SHELL_WHITELIST.length) {
        spawnOptions.shell = true;
      } else {
        spawnCommand = base;
        spawnArgs = [...args];
        spawnOptions.shell = false;
      }
    } else {
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

function isPng(buf) {
  return (
    Buffer.isBuffer(buf) &&
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  );
}

function execCaptureBuffer(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks = [];
    let err = "";
    const t = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error(`${cmd} timed out`));
    }, timeoutMs);
    proc.stdout.on("data", (d) => chunks.push(d));
    proc.stderr.on("data", (d) => (err += d.toString()));
    proc.on("error", (e) => {
      clearTimeout(t);
      reject(e);
    });
    proc.on("close", (code) => {
      clearTimeout(t);
      if (code !== 0) return reject(new Error(err || `${cmd} exit ${code}`));
      resolve(Buffer.concat(chunks));
    });
  });
}
