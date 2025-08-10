import clipboardy from "clipboardy";
import crypto from "crypto";
import { MessageTypes } from "../shared/protocol.js";
import fs from "fs";
import path from "path";
import { CONFIG } from "./config.js";
import { spawn } from "child_process";

export class HostIntegration {
  constructor({ broadcastFn }) {
    this.broadcastFn = broadcastFn;
    this.clipboardHash = null;
    this.clipboardInterval = null;
  }

  startClipboardWatcher(intervalMs = 2000) {
    this.clipboardInterval = setInterval(async () => {
      try {
        const text = await clipboardy.read();
        const hash = sha256(text);
        if (hash !== this.clipboardHash) {
          this.clipboardHash = hash;
          this.broadcastFn({
            type: MessageTypes.HOST_CLIPBOARD_UPDATE,
            data: text,
            timestamp: Date.now(),
          });
        }
      } catch {
        // ignore
      }
    }, intervalMs);
  }

  stopClipboardWatcher() {
    if (this.clipboardInterval) clearInterval(this.clipboardInterval);
  }

  async setClipboard(text) {
    await clipboardy.write(text);
  }

  // Secure path resolution within ROOT_DIR
  resolvePath(rel) {
    const p = path.resolve(CONFIG.RootOverride || CONFIG.ROOT_DIR, rel || ".");
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
    // Whitelist enforcement (optional)
    if (CONFIG.SHELL_WHITELIST.length) {
      const base = path.basename(command);
      if (!CONFIG.SHELL_WHITELIST.includes(base)) {
        throw new Error("Command not allowed");
      }
    }

    // On Windows, use cmd.exe for built-in commands
    let spawnCommand = command;
    let spawnArgs = args;
    let spawnOptions = { shell: false };

    if (process.platform === "win32") {
      // Check if it's a built-in command that needs cmd.exe
      const builtInCommands = [
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
      ];
      const baseCommand = path.basename(command).toLowerCase();

      if (builtInCommands.includes(baseCommand)) {
        spawnCommand = "cmd";
        spawnArgs = ["/c", command, ...args];
      } else {
        // For other commands, still use shell to handle PATH resolution
        spawnOptions.shell = true;
      }
    } else {
      // On Unix-like systems, use shell for command resolution
      spawnOptions.shell = true;
    }

    const proc = spawn(spawnCommand, spawnArgs, spawnOptions);
    proc.stdout.on("data", (d) => onData("stdout", d.toString()));
    proc.stderr.on("data", (d) => onData("stderr", d.toString()));
    proc.on("close", (code) => onClose(code));
    return proc;
  }
}

function sha256(str) {
  return crypto.createHash("sha256").update(str).digest("hex");
}
