// Native app bridge — SHARED BY iOS AND ANDROID, and inert in a browser.
//
// This file is the whole reason the native shells can stay thin. Everything a
// WebView breaks is repaired HERE, in one place, by shimming the web API the
// app already calls — so `review.html`'s 128 alert/confirm/prompt sites, its
// 12 print flows and its 9 clipboard calls need no edits, and the same repair
// ships to both platforms.
//
// It must keep working on GitHub Pages in an ordinary browser. Every shim is
// therefore behind `isNative()`, and with no host present this file does
// nothing at all.
//
// The host contract is one function, which both shells implement identically:
//
//     Native.post(name, payload)   ->  a message to the native side
//     window.__nativeReply(id, v)  <-  native answering a request
//
// iOS provides `window.webkit.messageHandlers.native.postMessage({...})`.
// Android provides `window.AndroidNative.post(json)`.

(function () {
  'use strict';

  // ── Host detection ────────────────────────────────────────────────────────
  const iosHost = () =>
    window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.native;
  const androidHost = () => window.AndroidNative;

  function isNative() { return !!(iosHost() || androidHost()); }

  let _seq = 0;
  const _pending = new Map();

  function post(name, payload) {
    const msg = { name, payload: payload || {} };
    const ios = iosHost();
    if (ios) { ios.postMessage(msg); return; }
    const android = androidHost();
    if (android) { android.post(JSON.stringify(msg)); }
  }

  /** Posts and waits for the native side to call back with a value. */
  function request(name, payload) {
    if (!isNative()) return Promise.reject(new Error('not running natively'));
    const id = ++_seq;
    return new Promise((resolve, reject) => {
      _pending.set(id, { resolve, reject });
      post(name, Object.assign({ __id: id }, payload || {}));
      // A host that never answers must not leave the caller hanging forever —
      // every one of these sits behind a button the user is waiting on.
      setTimeout(() => {
        if (_pending.has(id)) { _pending.delete(id); reject(new Error('native timeout')); }
      }, 20000);
    });
  }

  window.__nativeReply = function (id, value, error) {
    const entry = _pending.get(id);
    if (!entry) return;
    _pending.delete(id);
    if (error) entry.reject(new Error(error)); else entry.resolve(value);
  };

  const Native = {
    isNative,
    platform: iosHost() ? 'ios' : androidHost() ? 'android' : 'web',
    post,
    request,
    /** A short tap of feedback. Silently nothing on the web. */
    haptic(kind) { if (isNative()) post('haptic', { kind: kind || 'light' }); },
    /** The platform share sheet. Falls back to the clipboard on the web. */
    share(text, title) {
      if (isNative()) return request('share', { text, title: title || '' });
      if (navigator.share) return navigator.share({ text, title });
      return navigator.clipboard.writeText(text);
    },
  };
  window.Native = Native;

  if (!isNative()) return;   // ── everything below is app-only ──

  document.documentElement.classList.add('is-native-app', 'is-native-' + Native.platform);

  // The app's own chrome. A real stylesheet served from the same origin
  // rather than a string in the shell, so it is shared with Android AND
  // reaches the phone through the ordinary web update — which means the look
  // can be changed without rebuilding or reinstalling anything.
  (function loadAppCss() {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'native-app.css';
    document.head.appendChild(link);
  })();

  // ── Keyboard ──────────────────────────────────────────────────────────────
  // The tab bar is fixed to the bottom, so with the keyboard up it floats in
  // the middle of the screen over the content. visualViewport is the only
  // thing that reports the keyboard's real height — but it also moves for
  // zoom and for scroll transients, which is what `apply` below guards.
  (function keyboard() {
    const vv = window.visualViewport;
    if (!vv) return;
    const apply = () => {
      // `vv.height` shrinks when the page is ZOOMED as well as when a keyboard
      // appears, and the two are indistinguishable from the numbers alone. At
      // 1.5x on an 844pt phone the difference is ~281px — far over any
      // sensible threshold — so pinching the mushaf used to slide the tab bar
      // off the screen. A zoomed viewport is never a keyboard.
      if (vv.scale > 1.01) {
        document.documentElement.classList.remove('kb-open');
        return;
      }
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      // Only a focused text field can raise a keyboard, which rules out the
      // rubber-band and toolbar-collapse transients that also move the
      // visual viewport.
      const el = document.activeElement;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'
                            || el.isContentEditable);
      document.documentElement.classList.toggle('kb-open', !!typing && inset > 120);
    };
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    document.addEventListener('focusin', apply);
    document.addEventListener('focusout', () =>
      document.documentElement.classList.remove('kb-open'));
    apply();
  })();

  // ── 1. Print ─────────────────────────────────────────────────────────────
  // Every print flow in the app does the same three things: open a blank
  // window, document.write() a complete HTML document into it, then call
  // print() on it. In a WebView `window.open('', '_blank')` returns null, so
  // all twelve of them die at the first line.
  //
  // Rather than teach the native side to vend real windows, this hands back a
  // STUB that collects what is written and ships the finished HTML to the
  // platform printer. The app's own `printHtmlDocument()` already inlines all
  // of its print CSS into that string, so what gets printed is exactly what
  // the browser would have shown.
  const realOpen = window.open;
  window.open = function (url, name, features) {
    // Only the blank-window case is ours. A real URL should still behave
    // normally, so the native side can open it in the system browser.
    if (url && url !== '' && url !== 'about:blank') {
      post('openExternal', { url: String(url) });
      return null;
    }
    let html = '';
    let closed = false;
    const stub = {
      document: {
        write(chunk) { html += chunk; },
        writeln(chunk) { html += chunk + '\n'; },
        close() { closed = true; },
        get title() { return ''; },
        set title(_v) { /* the written document carries its own <title> */ },
      },
      focus() {},
      blur() {},
      close() { closed = true; },
      print() {
        Native.haptic('light');
        post('print', { html: html, title: document.title || 'Quran Review' });
      },
      get closed() { return closed; },
    };
    return stub;
  };
  if (realOpen) window.open.__real = realOpen;

  // `window.print()` on the page itself (not used today, but free to support).
  window.print = function () {
    post('print', { html: '<!doctype html>' + document.documentElement.outerHTML,
                    title: document.title || 'Quran Review' });
  };

  // ── 2. Clipboard ─────────────────────────────────────────────────────────
  // The loopback origin IS a secure context, so `navigator.clipboard` exists —
  // but WebKit still refuses a write that it cannot tie to a user gesture, and
  // the app has nine call sites with no fallback, each of which reports
  // failure to the user as an error. Routing through the native pasteboard
  // makes them all reliable, and costs nothing.
  const nativeClipboard = {
    writeText(text) { return request('clipboard', { text: String(text) }); },
    readText() { return request('clipboardRead', {}); },
  };
  try {
    Object.defineProperty(navigator, 'clipboard', {
      value: nativeClipboard, configurable: true,
    });
  } catch (_) {
    // Some engines refuse to redefine it; the real one is good enough there.
  }

  // ── 3. Fullscreen ────────────────────────────────────────────────────────
  // The mushaf has two fullscreen toggles. iOS has no Fullscreen API for
  // ordinary elements, and the app calls `req.call(el)` unguarded, so the
  // call throws. Give it a promise-returning stub that asks the native side
  // to hide its chrome instead; the app's own `.is-faux-fullscreen` fallback
  // then handles the layout, which is exactly what it was written for.
  if (!Element.prototype.requestFullscreen) {
    Element.prototype.requestFullscreen = function () {
      post('fullscreen', { on: true });
      return Promise.reject(new Error('use faux fullscreen'));
    };
  }
  if (!document.exitFullscreen) {
    document.exitFullscreen = function () {
      post('fullscreen', { on: false });
      return Promise.resolve();
    };
  }

  // ── 4. Theme → status bar ────────────────────────────────────────────────
  // The status bar is the native side's to draw, so it has to be told which
  // way the page went. Reported on load and whenever the theme attribute
  // changes, rather than polled.
  function reportTheme() {
    const bg = getComputedStyle(document.body).backgroundColor || '';
    const dark = document.documentElement.getAttribute('data-theme') === 'dark'
      || (!document.documentElement.getAttribute('data-theme')
          && window.matchMedia('(prefers-color-scheme: dark)').matches);
    post('theme', { dark: !!dark, background: bg });
  }
  document.addEventListener('DOMContentLoaded', reportTheme);
  new MutationObserver(reportTheme).observe(document.documentElement,
    { attributes: true, attributeFilter: ['data-theme', 'class'] });
  try {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', reportTheme);
  } catch (_) {}

  // ── 5. Haptics on the actions that deserve them ──────────────────────────
  // Deliberately a short, specific list rather than every tap. Feedback on
  // everything is noise; feedback on the two things you do dozens of times a
  // day — ticking a cluster done, revealing an answer — is what stops the app
  // feeling like a page. Bound by delegation so it survives every re-render.
  document.addEventListener('click', function (e) {
    const el = e.target.closest && e.target.closest(
      '.mdp-check, .mob-hizb-action-btn, .mob-action-btn, .plan-walk-done, ' +
      '.memtest-verdict-btn, .tester-grade-btn, .mob-mut-chip, .hm-cell');
    if (el) Native.haptic('light');
  }, true);

  // ── 6. Backup safety net ─────────────────────────────────────────────────
  // All of the user's data lives in localStorage, and iOS can evict a
  // WebView's storage — "Offload App" wipes it outright. On the web the File
  // System Access API was the local safety net; it does not exist here, so
  // the native side keeps a rolling JSON copy in the app's own Documents
  // directory, which is included in device and iCloud backups.
  function pushBackup() {
    if (typeof buildFullLogData !== 'function') return;
    try { post('backup', { json: JSON.stringify(buildFullLogData()) }); } catch (_) {}
  }
  window.nativeBackupNow = pushBackup;
  document.addEventListener('DOMContentLoaded', () => setTimeout(pushBackup, 4000));
  // And whenever the app goes to the background, which is when it is most
  // likely to be killed.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') pushBackup();
  });

  // ── 7. Back gesture / hardware back ──────────────────────────────────────
  // Android's back button and iOS's edge swipe must do something sensible
  // rather than quitting the app from anywhere. One ordered list of "things
  // that can be dismissed", most-modal first — the native side calls this and
  // only exits when it returns false.
  window.__nativeBack = function () {
    const overlay = document.getElementById('mushaf-overlay');
    if (overlay && overlay.style.display !== 'none' && overlay.style.display !== '') {
      if (typeof closeMushaf === 'function') { closeMushaf(); return true; }
    }
    const history = document.getElementById('ayah-history-panel');
    if (history && typeof closeAyahHistory === 'function' && history.offsetParent !== null) {
      closeAyahHistory(); return true;
    }
    const home = document.getElementById('mobile-home');
    if (home && !home.classList.contains('mob-active') && typeof mobShowHome === 'function') {
      mobShowHome(); return true;
    }
    return false;    // nothing left to dismiss — the shell may exit
  };
})();
