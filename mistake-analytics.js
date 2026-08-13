// ─── Ayah-mistake analytics: strength, ranking, and revision clustering ───────
// Shared by review.html and hizb.html. Pure/read-only: nothing here writes to
// localStorage or triggers sync — review.html's own saveHizbLog/saveAyahMistakes
// (which do) are declared separately in its own inline script.
const HIZB_LOG_KEY = LOG_KEYS.review.recitationLog;
const AYAH_MISTAKES_KEY = LOG_KEYS.review.ayahMistakes;

// Mistake "type" legend: a short optional code a user can put at the start of
// an ayah-mistake note (the paste-import box, or the live "+ Mistake" note
// field — see splitMistakeTypeAndNote) to categorize *how* it went wrong.
// S/B/W/M/T are real mistakes and behave exactly like an untyped one
// everywhere (session counts, strength scoring, ranking, revision clusters)
// — just tagged, via the ayahMistakes entry's own `type` field, which can
// hold more than one code at once (e.g. "BS" for an ayah that was both
// forgotten-at-the-start AND stopped mid-recitation — see
// normalizeMistakeTypeCodes). 'A' is different: it flags an ayah that felt
// weak even though nothing was actually missed, so groupAyahMistakesByCount
// excludes it from every mistake-count pipeline, and it can't combine with
// the others (see normalizeMistakeTypeCodes) since "no actual mistake" and
// "a real mistake of type X" are contradictory; it's surfaced instead via
// computeAyatNeedingAttention.
const MISTAKE_TYPE_META = {
  S: { label: 'Stopped', description: 'Blanked mid-ayah, needed a prompt to continue' },
  B: { label: 'Forgot the beginning', description: "Couldn't recall how the ayah starts" },
  W: { label: 'Word slip', description: 'Minor substitution, e.g. فَ instead of وَ' },
  M: { label: 'Multiple mistakes', description: 'More than one mistake landed in this ayah' },
  T: { label: 'Mutashabihat', description: 'Mixed up with a similar-sounding ayah elsewhere' },
  A: { label: 'Needs attention', description: "No actual mistake, but it felt shaky — tracked separately, not counted as a mistake" },
};

// Only characters that are real MISTAKE_TYPE_META codes are ever treated as a
// type — built from its keys (rather than hardcoded) so adding/removing a
// code here can't drift out of sync with the parsing regex below.
const MISTAKE_TYPE_CODE_PATTERN = new RegExp(`^([${Object.keys(MISTAKE_TYPE_META).join('')}]+)(?:\\s+(.*))?$`, 'i');

// Normalizes a raw run of type-code characters (e.g. "bs", "SB", "s") into
// canonical form: uppercased, deduped, and alphabetically sorted so "BS" and
// "SB" both end up stored as "BS" — or null if the run contains no valid
// codes, or mixes 'A' ("needs attention") with any other code, since 'A'
// means "no actual mistake" and can't combine with a real mistake type.
function normalizeMistakeTypeCodes(raw) {
  const codes = [...new Set(String(raw || '').toUpperCase().split(''))].filter(c => MISTAKE_TYPE_META[c]);
  if (codes.length === 0) return null;
  if (codes.includes('A') && codes.length > 1) return null;
  codes.sort();
  return codes.join('');
}

// Splits a leading run of type codes (see MISTAKE_TYPE_META, case-insensitive,
// must stand alone as its own token — no other letters mixed in) off the
// front of a note. "S" -> { type: 'S', note: '' }. "SB forgot ina" ->
// { type: 'BS', note: 'forgot ina' } (ayah had both an S and a B mistake —
// see normalizeMistakeTypeCodes for the canonical ordering). "mutashabihat"
// -> { type: null, note: 'mutashabihat' } (not a run of only valid codes —
// keeps this from misfiring on notes that merely start with type letters,
// e.g. "Slow" stays untyped) so the pre-existing freeform-note convention
// still works unchanged.
function splitMistakeTypeAndNote(text) {
  const trimmed = (text || '').trim();
  const match = trimmed.match(MISTAKE_TYPE_CODE_PATTERN);
  if (match) {
    const type = normalizeMistakeTypeCodes(match[1]);
    if (type) return { type, note: (match[2] || '').trim() };
  }
  return { type: null, note: trimmed };
}

// Human-readable label for a (possibly multi-code, e.g. "BS") mistake type
// string — "S · Stopped" for a single code, "B+S · Forgot the beginning,
// Stopped" for a combo. Returns '' for a falsy/unrecognized type, so callers
// can drop it inline without a null check.
function mistakeTypeLabel(type) {
  if (!type) return '';
  const codes = type.split('').filter(c => MISTAKE_TYPE_META[c]);
  if (codes.length === 0) return '';
  return `${codes.join('+')} · ${codes.map(c => MISTAKE_TYPE_META[c].label).join(', ')}`;
}

// True if `type` is a valid mistake-type code string per normalizeMistakeTypeCodes
// (real codes only, no dupes, 'A' never combined) — used to validate a type
// coming from an untrusted source like a hand-edited import file, where it
// might not have gone through splitMistakeTypeAndNote at all.
function isValidMistakeType(type) {
  return Boolean(type) && normalizeMistakeTypeCodes(type) === type;
}

function loadHizbLog() {
  try {
    const raw = localStorage.getItem(HIZB_LOG_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function loadAyahMistakes() {
  try {
    const raw = localStorage.getItem(AYAH_MISTAKES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function daysSince(isoDate) {
  return Math.floor((Date.now() - new Date(isoDate).getTime()) / 86400000);
}

const STRENGTH_LABELS = { strong: 'Strong', moderate: 'Moderate', weak: 'Weak', none: 'Not Logged' };

// Strength score (0-100): starts at 100 and loses points for mistakes on the
// last recitation (up to 60 pts, 6 pts/mistake) and for days since that
// recitation (up to 40 pts, 1 pt/day) — so both "how clean was it" and
// "how fresh is it" pull a Hizb toward weak. Never logged = weakest (0).
function computeHizbStrength(hizb) {
  const entries = loadHizbLog().filter(e => e.hizb === hizb).sort((a, b) => new Date(a.date) - new Date(b.date));
  if (entries.length === 0) {
    return { score: 0, label: 'none', entries: [], lastRecitedDate: null, daysSinceLast: null };
  }
  const last = entries[entries.length - 1];
  const daysSinceLast = daysSince(last.date);
  const mistakesPenalty = Math.min(60, last.mistakes * 6);
  const stalenessPenalty = Math.min(40, daysSinceLast);
  const score = Math.max(0, 100 - mistakesPenalty - stalenessPenalty);
  const label = score >= 80 ? 'strong' : score >= 50 ? 'moderate' : 'weak';
  return { score, label, entries, lastRecitedDate: last.date, daysSinceLast };
}

// 'improving' | 'regressing' | 'steady' | 'none' — compares the average
// mistake count of the most recent half of `entries` (see computeHizbStrength,
// which sorts these ascending by date) against the earlier half, so a single
// noisy sitting doesn't flip the classification. An odd entry count leaves
// the extra entry in the earlier half. Fewer than 2 entries can't show a
// trend at all ('none'), which callers should render distinctly from 'steady'.
function computeMistakeTrend(entries) {
  if (entries.length < 2) return 'none';
  const mid = Math.ceil(entries.length / 2);
  const avg = (list) => list.reduce((sum, e) => sum + e.mistakes, 0) / list.length;
  const earlierAvg = avg(entries.slice(0, mid));
  const recentAvg = avg(entries.slice(mid));
  if (recentAvg < earlierAvg) return 'improving';
  if (recentAvg > earlierAvg) return 'regressing';
  return 'steady';
}

// Groups a list of ayah-mistake entries by surah:ayah, counting occurrences,
// most-mistaken first. Used both for a whole Hizb's history and for a single
// session's mistakes (see ayahMistakesForSession). Type 'A' ("needs
// attention" — see MISTAKE_TYPE_META) entries are excluded since they aren't
// actual mistakes; this is the one place that's enforced, so it applies
// everywhere this feeds into: per-Hizb ranking, session tallies, revision
// clusters, and the mutashabihat "confused most" ranking.
function groupAyahMistakesByCount(mistakes) {
  const counts = new Map(); // "surah:ayah" -> { surah, ayah, count }
  mistakes.forEach(m => {
    if (m.type === 'A') return;
    const key = `${m.surah}:${m.ayah}`;
    if (!counts.has(key)) counts.set(key, { surah: m.surah, ayah: m.ayah, count: 0 });
    counts.get(key).count++;
  });
  return Array.from(counts.values()).sort((a, b) => b.count - a.count);
}

// One row per ayah currently flagged type 'A' ("needs attention"), most-
// recently-flagged first — the retrieval path for entries groupAyahMistakesByCount
// deliberately excludes. Each entry also carries whatever note the last "A" tap
// had (if any).
function computeAyatNeedingAttention() {
  const latest = new Map(); // "surah:ayah" -> { surah, ayah, note, date }
  loadAyahMistakes()
    .filter(m => m.type === 'A')
    .forEach(m => {
      const key = `${m.surah}:${m.ayah}`;
      const existing = latest.get(key);
      if (!existing || m.date > existing.date) {
        latest.set(key, { surah: m.surah, ayah: m.ayah, note: m.note || '', date: m.date });
      }
    });
  return Array.from(latest.values()).sort((a, b) => new Date(b.date) - new Date(a.date));
}

function computeAyahMistakeRankingForHizb(hizb) {
  return groupAyahMistakesByCount(loadAyahMistakes().filter(m => m.hizb === hizb));
}

// Ayah mistakes tied to one specific Recitation Log session — by explicit
// sessionId when the mistake has one (tapped live, or added by a
// paste-import, both of which set it), falling back to "same Hizb, same
// calendar day" for older mistakes logged before sessionId existed.
function ayahMistakesForSession(sessionEntry) {
  const sameHizb = loadAyahMistakes().filter(m => m.hizb === sessionEntry.hizb);
  const linked = sameHizb.filter(m => m.sessionId === sessionEntry.id);
  if (linked.length > 0) return linked;
  const day = new Date(sessionEntry.date).toDateString();
  return sameHizb.filter(m => !m.sessionId && new Date(m.date).toDateString() === day);
}

// Timeframes available for the revision-clusters views — 'all' skips
// filtering entirely; any other key looks up a window in ms.
const TIMEFRAME_WINDOWS_MS = {
  '1d': 1 * 24 * 60 * 60 * 1000,
  '3d': 3 * 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

function filterMistakesByTimeframe(mistakes, timeframe) {
  const windowMs = TIMEFRAME_WINDOWS_MS[timeframe];
  if (!windowMs) return mistakes; // 'all' (or unrecognized) — no filtering
  const cutoff = Date.now() - windowMs;
  return mistakes.filter(m => new Date(m.date).getTime() >= cutoff);
}

// Two mistaken ayat within this many ayat of each other are treated as one
// revision passage — close enough that reviewing them together makes more
// sense than treating each as an isolated weak spot.
const REVISION_CLUSTER_MAX_GAP = 5;

// A cluster stops growing once it would cover more than this many ayat
// total, even if the next mistake is within maxGap — without this, chaining
// mistakes that are each individually close to their neighbor (but spread
// out over many separate sessions/months) could merge into one sprawling
// "cluster" spanning far more clean ayat than actually-mistaken ones, which
// stops being a useful single sitting's revision target.
const REVISION_CLUSTER_MAX_SPAN = 15;

// Groups ayah mistakes into nearby passages worth revising as a block, using
// global (whole-mushaf) ayah numbers so a cluster can span a surah boundary.
// Isolated mistakes are included too, as their own size-1 group, so this is
// a complete ranked list of everything worth revising — not just multi-ayah
// passages. Sorted by total mistakes (most in need of revision first).
function clusterAyahMistakes(mistakes, maxGap, maxSpan = REVISION_CLUSTER_MAX_SPAN) {
  const withGlobal = groupAyahMistakesByCount(mistakes)
    .map(m => ({ ...m, global: SURAH_OFFSETS[m.surah] + m.ayah - 1 }))
    .sort((a, b) => a.global - b.global);

  const clusters = [];
  let current = null;
  for (const m of withGlobal) {
    const withinGap = current && m.global - current.lastGlobal <= maxGap;
    const withinSpan = current && m.global - current.firstGlobal <= maxSpan;
    if (withinGap && withinSpan) {
      current.ayat.push(m);
      current.totalMistakes += m.count;
      current.lastGlobal = m.global;
    } else {
      current = { ayat: [m], totalMistakes: m.count, firstGlobal: m.global, lastGlobal: m.global };
      clusters.push(current);
    }
  }

  return clusters
    .map(c => ({
      startSurah: c.ayat[0].surah, startAyah: c.ayat[0].ayah,
      endSurah: c.ayat[c.ayat.length - 1].surah, endAyah: c.ayat[c.ayat.length - 1].ayah,
      // distinctCount: how many ayat within the range actually have a
      // logged mistake. totalAyatInRange: the range's real length (e.g.
      // 2:166-174 is 9 ayat) — gap-chaining can bridge a few clean ayat
      // between mistakes, so these two numbers can genuinely differ; UI
      // should show totalAyatInRange next to a start-end range so the two
      // always agree, reserving distinctCount for "N of them were mistaken."
      distinctCount: c.ayat.length,
      totalAyatInRange: c.lastGlobal - c.firstGlobal + 1,
      totalMistakes: c.totalMistakes,
      ayat: c.ayat.map(({ surah, ayah, count }) => ({ surah, ayah, count })),
    }))
    .sort((a, b) => b.totalMistakes - a.totalMistakes);
}

// Global (all-time or timeframe-limited) clusters for one Hizb.
function computeRevisionClustersForHizb(hizb, timeframe) {
  const mistakes = filterMistakesByTimeframe(loadAyahMistakes().filter(m => m.hizb === hizb), timeframe);
  return clusterAyahMistakes(mistakes, REVISION_CLUSTER_MAX_GAP);
}

// Clusters within a single recitation session only — "which nearby ayat did
// I get wrong together in this one sitting," as opposed to the global,
// across-all-time view.
function computeSessionRevisionClusters(sessionEntry) {
  return clusterAyahMistakes(ayahMistakesForSession(sessionEntry), REVISION_CLUSTER_MAX_GAP);
}

// Every session's clusters for one Hizb, flattened into one ranked list and
// tagged with which session (id + date) each came from — a "which specific
// sitting had this weak passage" view, as opposed to computeRevisionClustersForHizb's
// all-sessions-pooled one.
function computeSessionClustersForHizb(hizb, timeframe) {
  const sessions = filterMistakesByTimeframe(loadHizbLog().filter(e => e.hizb === hizb), timeframe);
  return sessions
    .flatMap(session => computeSessionRevisionClusters(session).map(c => ({ ...c, sessionId: session.id, sessionDate: session.date })))
    .sort((a, b) => b.totalMistakes - a.totalMistakes);
}

// Every Hizb's clusters in one flat, ranked list — clustering only makes
// sense within a single Hizb (that's the unit you'd actually sit and
// revise), so this groups per-Hizb same as computeRevisionClustersForHizb
// and just tags each result with which Hizb it came from before merging
// and re-ranking across all of them by total mistakes.
function computeAllRevisionClusters(timeframe) {
  const mistakes = filterMistakesByTimeframe(loadAyahMistakes(), timeframe);
  const hizbs = [...new Set(mistakes.map(m => m.hizb))];
  return hizbs
    .flatMap(hizb => clusterAyahMistakes(mistakes.filter(m => m.hizb === hizb), REVISION_CLUSTER_MAX_GAP).map(c => ({ ...c, hizb })))
    .sort((a, b) => b.totalMistakes - a.totalMistakes);
}

// For every Hizb that's been recited at least once, only that Hizb's single
// most recent session's clusters — "what did I get wrong last time I sat
// with this Hizb," across every Hizb at once — as opposed to
// computeAllRevisionClusters, which pools every session ever logged (or
// within a timeframe) together. A single session can genuinely have more
// than one weak spot (e.g. a mistake early on and another much later, with
// a long clean stretch between), so this still runs the normal gap/span-
// capped clustering per session — it just never lets sessions OTHER than
// the latest one contribute. Flattened into one ranked list tagged by
// Hizb (+ that session's id/date), same shape as computeAllRevisionClusters
// so callers can reuse the same rendering.
function computeLatestSessionClustersForAllHizb() {
  const log = loadHizbLog();
  const hizbs = [...new Set(log.map(e => e.hizb))];
  return hizbs
    .map(hizb => log.filter(e => e.hizb === hizb).sort((a, b) => new Date(b.date) - new Date(a.date))[0])
    .flatMap(latest => computeSessionRevisionClusters(latest).map(c => ({ ...c, hizb: latest.hizb, sessionId: latest.id, sessionDate: latest.date })))
    .sort((a, b) => b.totalMistakes - a.totalMistakes);
}

// Every logged ayah mistake across every Hizb, grouped by Hizb and ranked
// most-mistakes-first — the flat, unclustered counterpart to
// computeAllRevisionClusters/computeLatestSessionClustersForAllHizb (those
// group nearby ayat into passages; this is just "show me everything"). Same
// timeframe vocabulary as the clusters views: 'all', '7d'/'3d'/'1d', or
// 'last-session' (each Hizb's single most recent sitting only, via
// ayahMistakesForSession's session-linked + same-day-fallback matching —
// NOT a date window). Type 'A' ("needs attention") entries are excluded,
// same as every other mistake-count view.
function computeAllHizbsMistakes(timeframe) {
  let mistakes;
  if (timeframe === 'last-session') {
    const log = loadHizbLog();
    const hizbs = [...new Set(log.map(e => e.hizb))];
    mistakes = hizbs.flatMap(hizb => {
      const latest = log.filter(e => e.hizb === hizb).sort((a, b) => new Date(b.date) - new Date(a.date))[0];
      return latest ? ayahMistakesForSession(latest) : [];
    });
  } else {
    mistakes = filterMistakesByTimeframe(loadAyahMistakes(), timeframe);
  }
  mistakes = mistakes.filter(m => m.type !== 'A');

  const byHizb = new Map();
  mistakes.forEach(m => {
    if (!byHizb.has(m.hizb)) byHizb.set(m.hizb, []);
    byHizb.get(m.hizb).push(m);
  });

  return Array.from(byHizb.entries())
    .map(([hizb, list]) => ({
      hizb,
      mistakes: list.slice().sort((a, b) => new Date(b.date) - new Date(a.date)),
    }))
    .sort((a, b) => b.mistakes.length - a.mistakes.length);
}

function clusterRangeKey(c) {
  return `${c.startSurah}:${c.startAyah}-${c.endSurah}:${c.endAyah}`;
}

function clusterRangeLabel(c) {
  if (c.startSurah === c.endSurah) {
    return c.startAyah === c.endAyah ? `${c.startSurah}:${c.startAyah}` : `${c.startSurah}:${c.startAyah}–${c.endAyah}`;
  }
  return `${c.startSurah}:${c.startAyah}–${c.endSurah}:${c.endAyah}`;
}

// Where a timestamp falls between minTime and maxTime, as a 0-100 position —
// the core of placing a bar (or axis tick) at its real chronological spot
// instead of evenly spacing entries by index. An empty range (a single
// session, or several logged at the exact same instant) centers everything.
function timeToPositionPct(t, minTime, maxTime) {
  const span = maxTime - minTime;
  return span === 0 ? 50 : ((t - minTime) / span) * 100;
}

// N evenly time-spaced fractions (0-1) across the range, always including
// both ends — used for axis ticks, independent of where any bar actually
// lands. A single-point range (count <= 1) is just the center.
function trendTickFractions(count) {
  if (count <= 1) return [0.5];
  return Array.from({ length: count }, (_, i) => i / (count - 1));
}

// First few words of an ayah — shown by default under every mistake row (not
// just on click) so you can recognize it at a glance. `text.split()` walks
// the string in logical (recitation) order regardless of RTL rendering, so
// slicing the front of that array is genuinely "the beginning," not an
// artifact of how it's displayed.
const MISTAKE_PREVIEW_WORD_LIMIT = 6;
function ayahBeginning(text, wordLimit) {
  const words = text.trim().split(/\s+/);
  return words.length <= wordLimit ? text.trim() : words.slice(0, wordLimit).join(' ') + ' …';
}
