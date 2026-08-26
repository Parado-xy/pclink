import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORE_PATH = path.join(__dirname, "..", "devices.json");

/** @typedef {{ tokenHash: string, name: string, createdAt: number, lastSeen: number }} DeviceRecord */

class DeviceStore {
  constructor() {
    /** @type {Map<string, DeviceRecord>} */
    this.devices = new Map();
    /** @type {Map<string, { expires: number, used: boolean }>} */
    this.pairingCodes = new Map();
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(STORE_PATH)) {
        const raw = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
        for (const [id, rec] of Object.entries(raw)) {
          this.devices.set(id, rec);
        }
      }
    } catch (e) {
      console.warn("deviceStore: failed to load devices.json", e.message);
    }
  }

  save() {
    try {
      const obj = Object.fromEntries(this.devices);
      fs.writeFileSync(STORE_PATH, JSON.stringify(obj, null, 2), "utf8");
    } catch (e) {
      console.warn("deviceStore: failed to save devices.json", e.message);
    }
  }

  hashToken(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  generateToken() {
    return crypto.randomBytes(32).toString("hex");
  }

  /**
   * Create a new device and return the plaintext token (only shown once).
   * @param {string} deviceId
   * @param {string} [name]
   */
  createDevice(deviceId, name = "") {
    const token = this.generateToken();
    const now = Date.now();
    this.devices.set(deviceId, {
      tokenHash: this.hashToken(token),
      name: name || deviceId,
      createdAt: now,
      lastSeen: now,
    });
    this.save();
    return token;
  }

  /**
   * Validate a token. Returns deviceId if valid, null otherwise.
   * Master token is checked by the caller; this only handles per-device tokens.
   */
  validateToken(token) {
    if (!token || typeof token !== "string") return null;
    const hash = this.hashToken(token);
    for (const [id, rec] of this.devices) {
      if (rec.tokenHash === hash) {
        rec.lastSeen = Date.now();
        this.save();
        return id;
      }
    }
    return null;
  }

  hasDevice(deviceId) {
    return this.devices.has(deviceId);
  }

  touch(deviceId) {
    const rec = this.devices.get(deviceId);
    if (rec) {
      rec.lastSeen = Date.now();
      this.save();
    }
  }

  revoke(deviceId) {
    const ok = this.devices.delete(deviceId);
    if (ok) this.save();
    return ok;
  }

  list() {
    return [...this.devices.entries()].map(([id, rec]) => ({
      deviceId: id,
      name: rec.name,
      createdAt: rec.createdAt,
      lastSeen: rec.lastSeen,
    }));
  }

  // --- Pairing codes ---

  /**
   * Mint a one-time 6-digit pairing code (TTL default 2 minutes).
   */
  createPairingCode(ttlMs = 120_000) {
    // Clean expired codes first
    const now = Date.now();
    for (const [code, meta] of this.pairingCodes) {
      if (meta.expires < now || meta.used) this.pairingCodes.delete(code);
    }

    let code;
    do {
      code = String(Math.floor(100000 + Math.random() * 900000));
    } while (this.pairingCodes.has(code));

    this.pairingCodes.set(code, { expires: now + ttlMs, used: false });
    return { code, expiresAt: now + ttlMs };
  }

  /**
   * Consume a pairing code. Returns true if valid and not yet used.
   */
  consumePairingCode(code) {
    if (!code || typeof code !== "string") return false;
    const normalized = code.trim();
    const meta = this.pairingCodes.get(normalized);
    if (!meta) return false;
    if (meta.used || meta.expires < Date.now()) {
      this.pairingCodes.delete(normalized);
      return false;
    }
    meta.used = true;
    this.pairingCodes.delete(normalized);
    return true;
  }
}

export const deviceStore = new DeviceStore();
