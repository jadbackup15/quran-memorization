// GitHub bot integration works

// Site version, shown in the header of every page.
// Bump on every commit: patch (v1.v2.V3) for tiny changes, minor (v1.V2.v3)
// for larger changes, major (V1.v2.v3) for main/breaking changes.
//
// The MINOR ROLLS OVER AT 100: 5.99.0 + a minor bump is 6.0.0, not 5.100.0.
// Strict semver would let the minor grow without limit, but this is a version
// badge people read, and "a hundred features since the last generation" is
// itself worth marking — waiting for a breaking change meant the first number
// might never move at all. isNewerVersion() compares each segment
// NUMERICALLY, so nothing depended on the minor staying below 100; this is a
// readability decision, not a correctness one.
const APP_VERSION = "6.8.2";

// The newest version that has been live long enough to be considered settled
// (housekeeping's rule: the newest version at least 3 days old). review.html
// shows a β badge whenever APP_VERSION is AHEAD of this.
//
// It lives here, beside APP_VERSION, rather than buried in review.html — it is
// version metadata, this file is what every page loads and what the update
// check re-fetches, and keeping the two numbers apart is why this one sat at
// 5.66.2 for twenty-two releases while nobody noticed.
//
// It then did it AGAIN, sitting at 5.76.1 through twenty-three releases, and
// the test guarding it could not tell: it only asserted "ahead of stable",
// which is true whether stable is one release behind or fifty. The test now
// bounds the gap as well, which is the part that was actually missing.
const STABLE_VERSION = "5.87.0";
// The date STABLE_VERSION shipped. Kept beside it so the staleness guard can
// measure AGE, which is what the rule is actually about — an earlier guard
// counted RELEASES behind and cried wolf the moment sixteen of them shipped
// inside three days, while stable was in fact correct. /housekeeping updates
// both lines together.
const STABLE_VERSION_DATE = "2026-09-24";

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
