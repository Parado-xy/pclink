/** Small UI enhancements that do not depend on app.js internals. */

const historyEl = document.getElementById("clipboardHistory");
const clearBtn = document.getElementById("clearHistoryBtn");
const searchInput = document.getElementById("historySearch");

clearBtn?.addEventListener("click", () => {
  if (!historyEl) return;
  historyEl.innerHTML = "";
});

searchInput?.addEventListener("input", () => {
  if (!historyEl) return;
  const q = (searchInput.value || "").trim().toLowerCase();
  historyEl.querySelectorAll("li").forEach((li) => {
    const text = (li.textContent || "").toLowerCase();
    li.style.display = !q || text.includes(q) ? "" : "none";
  });
});

// Improve pairing code input UX: digits only, auto-format feel
const pairingCode = document.getElementById("pairingCode");
pairingCode?.addEventListener("input", () => {
  pairingCode.value = pairingCode.value.replace(/\D/g, "").slice(0, 6);
});

// Submit connection form on Enter in pairing code field
document.getElementById("connectionForm")?.addEventListener("submit", (e) => {
  // connectBtn click handler in app.js is on the button; ensure form submit triggers it
  const btn = document.getElementById("connectBtn");
  if (btn && e.submitter !== btn) {
    // native submit already reaches the button if type=submit
  }
});
