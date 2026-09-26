// GitHub bot integration works

// Site version, shown in the header of every page.
// Bump on every commit: patch (v1.v2.V3) for tiny changes, minor (v1.V2.v3)
// for larger changes, major (V1.v2.v3) for main/breaking changes.
const APP_VERSION = "5.90.1";

// The newest version that has been live long enough to be considered settled
// (housekeeping's rule: the newest version at least 3 days old). review.html
// shows a β badge whenever APP_VERSION is AHEAD of this.
//
// It lives here, beside APP_VERSION, rather than buried in review.html — it is
// version metadata, this file is what every page loads and what the update
// check re-fetches, and keeping the two numbers apart is why this one sat at
// 5.66.2 for twenty-two releases while nobody noticed.
const STABLE_VERSION = "5.76.1";

// Compares two "v1.v2.v3" strings. Top-level (not nested in the IIFE below)
// because review.html's badge needs it too — a function declaration here is
// visible to every page that loads this file.
function isNewerVersion(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return true;
    if (pa[i] < pb[i]) return false;
  }
  return false;
}

// Check for a newer version by re-fetching this file from the server.
// Runs on every page (this file is included everywhere). Silently no-ops
// when running via file://, offline, or if already on the latest version.
(function checkForAppUpdate() {
  if (location.protocol === 'file:') return;
  window.addEventListener('DOMContentLoaded', function () {
    fetch('version.js?_=' + Date.now(), { cache: 'no-store' })
      .then(r => r.ok ? r.text() : null)
      .then(text => {
        if (!text) return;
        const m = text.match(/APP_VERSION\s*=\s*"([^"]+)"/);
        if (!m) return;
        const latest = m[1];
        if (latest === APP_VERSION) return;
        // Only notify if the server version is actually newer (not a rollback)
        if (!isNewerVersion(latest, APP_VERSION)) return;
        showUpdateBanner(latest);
      })
      .catch(() => {});
  });

  function showUpdateBanner(latest) {
    const el = document.createElement('div');
    el.id = 'app-update-banner';
    el.style.cssText = [
      'position:fixed', 'bottom:20px', 'right:20px', 'z-index:9999',
      'background:#192847', 'color:#fff', 'padding:12px 16px',
      'border-radius:10px', 'font-size:0.82rem', 'line-height:1.4',
      'box-shadow:0 4px 16px rgba(0,0,0,0.35)',
      'display:flex', 'align-items:center', 'gap:12px',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
    ].join(';');
    el.innerHTML =
      '<span>🆕 v' + latest + ' available</span>' +
      '<button onclick="location.reload()" style="background:#5a9fd4;color:#fff;border:none;' +
        'padding:5px 12px;border-radius:6px;cursor:pointer;font-size:0.8rem;font-weight:600;">Reload</button>' +
      '<button onclick="document.getElementById(\'app-update-banner\').remove()" style="background:none;' +
        'border:none;color:#9dbfaa;cursor:pointer;font-size:1.1rem;line-height:1;padding:0;">✕</button>';
    document.body.appendChild(el);
  }
}());
