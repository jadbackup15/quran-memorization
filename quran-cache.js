// ─── Offline Quran text cache (IndexedDB) ──────────────────────────────────────
// Every ayah/page fetch from alquran.cloud goes through here first. Once a
// surah or page has been queried, it's stored on-device — later requests
// (including on a future visit, and while offline) are served from the cache
// instead of the network. Caching failures (private browsing, old browsers)
// are swallowed; the caller just falls back to a live fetch.
//
// Shared by review.html and hizb.html.
const QURAN_CACHE_DB = 'quranTextCache';
const QURAN_CACHE_VERSION = 1;
const SURAH_CACHE_STORE = 'surahs'; // key = surah number (1-114)
const PAGE_CACHE_STORE = 'pages';   // key = mushaf page number (1-604)

function openQuranCacheDB() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
    const req = indexedDB.open(QURAN_CACHE_DB, QURAN_CACHE_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SURAH_CACHE_STORE)) db.createObjectStore(SURAH_CACHE_STORE);
      if (!db.objectStoreNames.contains(PAGE_CACHE_STORE)) db.createObjectStore(PAGE_CACHE_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet(storeName, key) {
  return openQuranCacheDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  })).catch(() => null); // cache miss on any failure — caller re-fetches
}

function idbPut(storeName, key, value) {
  return openQuranCacheDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value, key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  })).catch(() => {}); // best-effort — a failed cache write shouldn't break the app
}

// Fetches (Arabic + translation) ayat for a whole surah, using the on-device
// cache once that surah has been queried before.
async function fetchSurahData(surahNum) {
  const cached = await idbGet(SURAH_CACHE_STORE, surahNum);
  if (cached) return cached;

  const res = await fetch(`https://api.alquran.cloud/v1/surah/${surahNum}/editions/quran-uthmani,en.sahih`);
  if (!res.ok) throw new Error(`API error ${res.status}`);
  const data = await res.json();
  if (data.code !== 200 || !data.data || data.data.length < 2) {
    throw new Error('Unexpected API response');
  }
  const record = {
    arabicAyahs: data.data[0].ayahs,
    transAyahs: data.data[1].ayahs,
    surahInfo: { number: data.data[0].number, name: data.data[0].name, englishName: data.data[0].englishName },
  };
  idbPut(SURAH_CACHE_STORE, surahNum, record); // fire-and-forget
  return record;
}

// Fetches all ayat on a single mushaf page (can span two surahs) — used by
// "By Page" mode, which picks a random ayah from a specific page.
async function fetchPageData(pageNum) {
  const cached = await idbGet(PAGE_CACHE_STORE, pageNum);
  if (cached) return cached;

  const res = await fetch(`https://api.alquran.cloud/v1/page/${pageNum}/quran-uthmani`);
  if (!res.ok) throw new Error(`API error ${res.status}`);
  const data = await res.json();
  const ayahs = data.data.ayahs;
  idbPut(PAGE_CACHE_STORE, pageNum, ayahs); // fire-and-forget
  return ayahs;
}
