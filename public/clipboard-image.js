/**
 * Helpers for putting a PNG onto the system clipboard from the browser.
 * Linux/Firefox often reject ClipboardItem image writes; we fall back
 * through several strategies and finally offer a file download.
 */

export function base64ToUint8Array(b64) {
  const bin = atob(b64);
  const len = bin.length;
  const arr = new Uint8Array(len);
  for (let i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

/**
 * @param {string} base64Png
 * @returns {Promise<'clipboard'|'download'>}
 */
export async function copyPngBase64ToClipboard(base64Png) {
  const bytes = base64ToUint8Array(base64Png);
  const blob = new Blob([bytes], { type: "image/png" });

  // Strategy 1: modern Clipboard API (Promise value — required by Safari, fine on Chromium)
  if (navigator.clipboard && typeof ClipboardItem !== "undefined") {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "image/png": Promise.resolve(blob),
        }),
      ]);
      return "clipboard";
    } catch (_e1) {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": blob }),
        ]);
        return "clipboard";
      } catch (_e2) {
        // continue to fallbacks
      }
    }
  }

  // Strategy 2: paint to canvas + legacy copy (works in some Chromium builds)
  try {
    await copyBlobViaContentEditable(blob);
    return "clipboard";
  } catch (_e3) {
    // continue
  }

  // Strategy 3: download — always works; user can open/paste from file manager
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "pclink-clipboard.png";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return "download";
}

function copyBlobViaContentEditable(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const holder = document.createElement("div");
      holder.contentEditable = "true";
      holder.style.cssText =
        "position:fixed;left:-9999px;top:0;opacity:0;pointer-events:none";
      holder.appendChild(img);
      document.body.appendChild(holder);

      const range = document.createRange();
      range.selectNode(img);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);

      let ok = false;
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }

      sel.removeAllRanges();
      holder.remove();
      URL.revokeObjectURL(url);

      if (ok) resolve();
      else reject(new Error("execCommand copy failed"));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image load failed"));
    };
    img.src = url;
  });
}
