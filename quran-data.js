// Shared Quran structural data + pure geometry helpers, used by
// quran-tracker.html, review.html, and hizb.html. Having exactly one copy of
// this (instead of one per page) is what it took to fix a real bug: review.html
// used to carry its own copy of SURAHS with a corrupted Arabic character for
// Surah 113 that had silently drifted from quran-tracker.html's copy.

// [num, englishName, arabicName, ayahCount, juz, startPage, endPage]
const SURAHS = [
  [1,"Al-Fatiha","الفاتحة",7,1,1,1],[2,"Al-Baqara","البقرة",286,1,2,49],
  [3,"Aal-i-Imran","آل عمران",200,3,50,76],[4,"An-Nisa","النساء",176,4,77,106],
  [5,"Al-Ma'ida","المائدة",120,6,106,127],[6,"Al-An'am","الأنعام",165,7,128,150],
  [7,"Al-A'raf","الأعراف",206,8,151,176],[8,"Al-Anfal","الأنفال",75,9,177,186],
  [9,"At-Tawba","التوبة",129,10,187,207],[10,"Yunus","يونس",109,11,208,221],
  [11,"Hud","هود",123,11,221,235],[12,"Yusuf","يوسف",111,12,235,248],
  [13,"Ar-Ra'd","الرعد",43,13,249,255],[14,"Ibrahim","إبراهيم",52,13,255,261],
  [15,"Al-Hijr","الحجر",99,14,262,267],[16,"An-Nahl","النحل",128,14,267,281],
  [17,"Al-Isra","الإسراء",111,15,282,293],[18,"Al-Kahf","الكهف",110,15,293,304],
  [19,"Maryam","مريم",98,16,305,312],[20,"Ta-Ha","طه",135,16,312,321],
  [21,"Al-Anbiya","الأنبياء",112,17,322,331],[22,"Al-Hajj","الحج",78,17,332,341],
  [23,"Al-Mu'minun","المؤمنون",118,18,342,349],[24,"An-Nur","النور",64,18,350,359],
  [25,"Al-Furqan","الفرقان",77,18,359,366],[26,"Ash-Shu'ara","الشعراء",227,19,367,376],
  [27,"An-Naml","النمل",93,19,377,385],[28,"Al-Qasas","القصص",88,20,385,396],
  [29,"Al-Ankabut","العنكبوت",69,20,396,404],[30,"Ar-Rum","الروم",60,21,404,410],
  [31,"Luqman","لقمان",34,21,411,414],[32,"As-Sajda","السجدة",30,21,415,417],
  [33,"Al-Ahzab","الأحزاب",73,21,418,427],[34,"Saba","سبأ",54,22,428,434],
  [35,"Fatir","فاطر",45,22,434,440],[36,"Ya-Sin","يس",83,22,440,445],
  [37,"As-Saffat","الصافات",182,23,446,452],[38,"Sad","ص",88,23,453,458],
  [39,"Az-Zumar","الزمر",75,23,458,467],[40,"Ghafir","غافر",85,24,467,476],
  [41,"Fussilat","فصلت",54,24,477,482],[42,"Ash-Shura","الشورى",53,25,483,489],
  [43,"Az-Zukhruf","الزخرف",89,25,489,495],[44,"Ad-Dukhan","الدخان",59,25,496,498],
  [45,"Al-Jathiya","الجاثية",37,25,499,502],[46,"Al-Ahqaf","الأحقاف",35,26,502,506],
  [47,"Muhammad","محمد",38,26,507,510],[48,"Al-Fath","الفتح",29,26,511,515],
  [49,"Al-Hujurat","الحجرات",18,26,515,517],[50,"Qaf","ق",45,26,518,520],
  [51,"Adh-Dhariyat","الذاريات",60,26,520,523],[52,"At-Tur","الطور",49,27,523,525],
  [53,"An-Najm","النجم",62,27,526,528],[54,"Al-Qamar","القمر",55,27,528,531],
  [55,"Ar-Rahman","الرحمن",78,27,531,534],[56,"Al-Waqi'a","الواقعة",96,27,534,537],
  [57,"Al-Hadid","الحديد",29,27,537,541],[58,"Al-Mujadila","المجادلة",22,28,542,545],
  [59,"Al-Hashr","الحشر",24,28,545,548],[60,"Al-Mumtahina","الممتحنة",13,28,549,551],
  [61,"As-Saf","الصف",14,28,551,552],[62,"Al-Jumu'a","الجمعة",11,28,553,554],
  [63,"Al-Munafiqun","المنافقون",11,28,554,555],[64,"At-Taghabun","التغابن",18,28,556,557],
  [65,"At-Talaq","الطلاق",12,28,558,559],[66,"At-Tahrim","التحريم",12,28,560,561],
  [67,"Al-Mulk","الملك",30,29,562,564],[68,"Al-Qalam","القلم",52,29,564,566],
  [69,"Al-Haqqah","الحاقة",52,29,566,568],[70,"Al-Ma'arij","المعارج",44,29,568,570],
  [71,"Nuh","نوح",28,29,570,571],[72,"Al-Jinn","الجن",28,29,572,573],
  [73,"Al-Muzzammil","المزمل",20,29,574,575],[74,"Al-Muddaththir","المدثر",56,29,575,577],
  [75,"Al-Qiyama","القيامة",40,29,577,578],[76,"Al-Insan","الإنسان",31,29,578,580],
  [77,"Al-Mursalat","المرسلات",50,29,580,581],[78,"An-Naba","النبأ",40,30,582,583],
  [79,"An-Nazi'at","النازعات",46,30,583,584],[80,"Abasa","عبس",42,30,585,585],
  [81,"At-Takwir","التكوير",29,30,586,586],[82,"Al-Infitar","الانفطار",19,30,587,587],
  [83,"Al-Mutaffifin","المطففين",36,30,587,589],[84,"Al-Inshiqaq","الانشقاق",25,30,589,589],
  [85,"Al-Buruj","البروج",22,30,590,590],[86,"At-Tariq","الطارق",17,30,591,591],
  [87,"Al-A'la","الأعلى",19,30,591,592],[88,"Al-Ghashiya","الغاشية",26,30,592,592],
  [89,"Al-Fajr","الفجر",30,30,593,594],[90,"Al-Balad","البلد",20,30,594,594],
  [91,"Ash-Shams","الشمس",15,30,595,595],[92,"Al-Layl","الليل",21,30,595,596],
  [93,"Ad-Duha","الضحى",11,30,596,596],[94,"Ash-Sharh","الشرح",8,30,596,596],
  [95,"At-Tin","التين",8,30,597,597],[96,"Al-Alaq","العلق",19,30,597,597],
  [97,"Al-Qadr","القدر",5,30,598,598],[98,"Al-Bayyina","البينة",8,30,598,599],
  [99,"Az-Zalzala","الزلزلة",8,30,599,599],[100,"Al-Adiyat","العاديات",11,30,599,600],
  [101,"Al-Qari'a","القارعة",11,30,600,600],[102,"At-Takathur","التكاثر",8,30,600,600],
  [103,"Al-Asr","العصر",3,30,601,601],[104,"Al-Humaza","الهمزة",9,30,601,601],
  [105,"Al-Fil","الفيل",5,30,601,601],[106,"Quraysh","قريش",4,30,602,602],
  [107,"Al-Ma'un","الماعون",7,30,602,602],[108,"Al-Kawthar","الكوثر",3,30,602,602],
  [109,"Al-Kafirun","الكافرون",6,30,603,603],[110,"An-Nasr","النصر",3,30,603,603],
  [111,"Al-Masad","المسد",5,30,603,603],[112,"Al-Ikhlas","الإخلاص",4,30,604,604],
  [113,"Al-Falaq","الفلق",5,30,604,604],[114,"An-Nas","الناس",6,30,604,604],
];

// ─── Global ayah offsets (SURAH_OFFSETS[n] = first global ayah# of surah n) ──
// Index 0 unused; index 115 is sentinel (6237)
const SURAH_OFFSETS = [
  0,
  1,    8,    294,  494,  670,  790,  955,  1161, 1236, 1365,
  1474, 1597, 1708, 1751, 1803, 1902, 2030, 2141, 2251, 2349,
  2484, 2596, 2674, 2792, 2856, 2933, 3160, 3253, 3341, 3410,
  3470, 3504, 3534, 3607, 3661, 3706, 3789, 3971, 4059, 4134,
  4219, 4273, 4326, 4415, 4474, 4511, 4546, 4584, 4613, 4631,
  4676, 4736, 4785, 4847, 4902, 4980, 5076, 5105, 5127, 5151,
  5164, 5178, 5189, 5200, 5218, 5230, 5242, 5272, 5324, 5376,
  5420, 5448, 5476, 5496, 5552, 5592, 5623, 5673, 5713, 5759,
  5801, 5830, 5849, 5885, 5910, 5932, 5949, 5968, 5994, 6024,
  6044, 6059, 6080, 6091, 6099, 6107, 6126, 6131, 6139, 6147,
  6158, 6169, 6177, 6180, 6189, 6194, 6198, 6205, 6208, 6214,
  6217, 6222, 6226, 6231,
  6237, // sentinel
];

// ─── Juz global ranges [start, end] (1-indexed) ──────────────────────────────
const JUZ_RANGES = [
  null,           // 0 unused
  [1,    148],    // Juz 1:  Al-Fatiha 1 → Al-Baqara 141
  [149,  259],    // Juz 2:  Al-Baqara 142 → 252
  [260,  385],    // Juz 3:  Al-Baqara 253 → Aal-Imran 92
  [386,  516],    // Juz 4:  Aal-Imran 93 → An-Nisa 23
  [517,  640],    // Juz 5:  An-Nisa 24 → 147
  [641,  750],    // Juz 6:  An-Nisa 148 → Al-Ma'ida 81
  [751,  899],    // Juz 7:  Al-Ma'ida 82 → Al-An'am 110
  [900,  1041],   // Juz 8:  Al-An'am 111 → Al-A'raf 87
  [1042, 1200],   // Juz 9:  Al-A'raf 88 → Al-Anfal 40
  [1201, 1327],   // Juz 10: Al-Anfal 41 → At-Tawba 92
  [1328, 1478],   // Juz 11: At-Tawba 93 → Hud 5
  [1479, 1648],   // Juz 12: Hud 6 → Yusuf 52
  [1649, 1802],   // Juz 13: Yusuf 53 → Ibrahim 52
  [1803, 2029],   // Juz 14: Al-Hijr 1 → An-Nahl 128
  [2030, 2214],   // Juz 15: Al-Isra 1 → Al-Kahf 74
  [2215, 2483],   // Juz 16: Al-Kahf 75 → Ta-Ha 135
  [2484, 2673],   // Juz 17: Al-Anbiya 1 → Al-Hajj 78
  [2674, 2875],   // Juz 18: Al-Mu'minun 1 → Al-Furqan 20
  [2876, 3214],   // Juz 19: Al-Furqan 21 → An-Naml 55
  [3215, 3385],   // Juz 20: An-Naml 56 → Al-Ankabut 45
  [3386, 3563],   // Juz 21: Al-Ankabut 46 → Al-Ahzab 30
  [3564, 3732],   // Juz 22: Al-Ahzab 31 → Ya-Sin 27
  [3733, 4089],   // Juz 23: Ya-Sin 28 → Az-Zumar 31
  [4090, 4264],   // Juz 24: Az-Zumar 32 → Fussilat 46
  [4265, 4510],   // Juz 25: Fussilat 47 → Al-Jathiya 37
  [4511, 4705],   // Juz 26: Al-Ahqaf 1 → Adh-Dhariyat 30
  [4706, 5104],   // Juz 27: Adh-Dhariyat 31 → Al-Hadid 29
  [5105, 5241],   // Juz 28: Al-Mujadila 1 → At-Tahrim 12
  [5242, 5672],   // Juz 29: Al-Mulk 1 → Al-Mursalat 50
  [5673, 6236],   // Juz 30: An-Naba 1 → An-Nas 6
];

// ─── Juz page ranges [startPage, endPage] (1-indexed, from the same
// mushaf-uthmani pagination as SURAHS' startPage/endPage) ────────────────────
// A Juz boundary can fall mid-page, so a page may appear as the end of one
// Juz and the start of the next (e.g. Juz 3 ends on 62, Juz 4 also starts on
// 62) — sourced from api.alquran.cloud's /juz/{n}/quran-uthmani endpoint
// (first/last ayah's page), the same source used for fetchSurahData/
// fetchPageData in quran-cache.js, so it lines up with SURAHS' own page data.
const JUZ_PAGE_RANGES = [
  null,        // 0 unused
  [1,   21],   // Juz 1
  [22,  41],   // Juz 2
  [42,  62],   // Juz 3
  [62,  81],   // Juz 4
  [82,  101],  // Juz 5
  [102, 121],  // Juz 6
  [121, 141],  // Juz 7
  [142, 161],  // Juz 8
  [162, 181],  // Juz 9
  [182, 201],  // Juz 10
  [201, 221],  // Juz 11
  [222, 241],  // Juz 12
  [242, 261],  // Juz 13
  [262, 281],  // Juz 14
  [282, 301],  // Juz 15
  [302, 321],  // Juz 16
  [322, 341],  // Juz 17
  [342, 361],  // Juz 18
  [362, 381],  // Juz 19
  [382, 401],  // Juz 20
  [402, 421],  // Juz 21
  [422, 441],  // Juz 22
  [442, 461],  // Juz 23
  [462, 481],  // Juz 24
  [482, 502],  // Juz 25
  [502, 521],  // Juz 26
  [522, 541],  // Juz 27
  [542, 561],  // Juz 28
  [562, 581],  // Juz 29
  [582, 604],  // Juz 30
];

/** Converts a global (whole-mushaf) ayah number (1-based) to { surah, ayah }. */
function globalToSurahAyah(g) {
  let lo = 1, hi = 114;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (SURAH_OFFSETS[mid] <= g) lo = mid;
    else hi = mid - 1;
  }
  return { surah: lo, ayah: g - SURAH_OFFSETS[lo] + 1 };
}

// ─── Hizb global ranges [start, end] (1-indexed) ─────────────────────────────
// Each Juz splits into exactly 2 Hizbs, but NOT at the midpoint of its ayah
// count — a Hizb boundary is a fixed point in the Uthmani mushaf (each Hizb
// further divides into 4 quarters/ruku of roughly equal recitation length,
// not equal ayah count), so bisecting JUZ_RANGES by ayah count (the previous
// approach here) silently misattributes ayat near a Hizb's start/end. e.g.
// Juz 1 (global 1-148, Al-Fatiha + Al-Baqara 1-141) splits unevenly into
// Hizb 1 = Al-Fatiha 1 - Al-Baqara 74 (81 ayat) and Hizb 2 = Al-Baqara 75-141
// (67 ayat) — bisecting 148 ayat exactly in half instead put the boundary at
// Al-Baqara 67/68, silently mis-Hizbing ayat 68-74 into Hizb 2. Sourced from
// api.alquran.cloud's /hizbQuarter/{n} endpoint (each Hizb's first quarter,
// n = (hizb-1)*4+1, gives that Hizb's own starting global ayah; the next
// Hizb's start minus 1 gives this one's end) — the same source already used
// for JUZ_PAGE_RANGES above, so it lines up with this file's other data.
const HIZB_RANGES = [
  null,          // 0 unused
  [1,    81],    // Hizb 1
  [82,   148],   // Hizb 2
  [149,  209],   // Hizb 3
  [210,  259],   // Hizb 4
  [260,  307],   // Hizb 5
  [308,  385],   // Hizb 6
  [386,  463],   // Hizb 7
  [464,  516],   // Hizb 8
  [517,  580],   // Hizb 9
  [581,  640],   // Hizb 10
  [641,  695],   // Hizb 11
  [696,  750],   // Hizb 12
  [751,  824],   // Hizb 13
  [825,  899],   // Hizb 14
  [900,  954],   // Hizb 15
  [955,  1041],  // Hizb 16
  [1042, 1124],  // Hizb 17
  [1125, 1200],  // Hizb 18
  [1201, 1268],  // Hizb 19
  [1269, 1327],  // Hizb 20
  [1328, 1389],  // Hizb 21
  [1390, 1478],  // Hizb 22
  [1479, 1556],  // Hizb 23
  [1557, 1648],  // Hizb 24
  [1649, 1725],  // Hizb 25
  [1726, 1802],  // Hizb 26
  [1803, 1951],  // Hizb 27
  [1952, 2029],  // Hizb 28
  [2030, 2127],  // Hizb 29
  [2128, 2214],  // Hizb 30
  [2215, 2348],  // Hizb 31
  [2349, 2483],  // Hizb 32
  [2484, 2595],  // Hizb 33
  [2596, 2673],  // Hizb 34
  [2674, 2811],  // Hizb 35
  [2812, 2875],  // Hizb 36
  [2876, 3042],  // Hizb 37
  [3043, 3214],  // Hizb 38
  [3215, 3302],  // Hizb 39
  [3303, 3385],  // Hizb 40
  [3386, 3490],  // Hizb 41
  [3491, 3563],  // Hizb 42
  [3564, 3629],  // Hizb 43
  [3630, 3732],  // Hizb 44
  [3733, 3932],  // Hizb 45
  [3933, 4089],  // Hizb 46
  [4090, 4173],  // Hizb 47
  [4174, 4264],  // Hizb 48
  [4265, 4348],  // Hizb 49
  [4349, 4510],  // Hizb 50
  [4511, 4600],  // Hizb 51
  [4601, 4705],  // Hizb 52
  [4706, 4901],  // Hizb 53
  [4902, 5104],  // Hizb 54
  [5105, 5177],  // Hizb 55
  [5178, 5241],  // Hizb 56
  [5242, 5447],  // Hizb 57
  [5448, 5672],  // Hizb 58
  [5673, 5948],  // Hizb 59
  [5949, 6236],  // Hizb 60
];

/** Returns [globalStart, globalEnd] for a Hizb (1-60). */
function hizbRange(hizb) {
  return HIZB_RANGES[hizb];
}

/** Inverse of hizbRange(): which Hizb (1-60) does a global ayah fall in? */
function hizbOfGlobalAyah(g) {
  for (let h = 60; h >= 1; h--) {
    if (g >= HIZB_RANGES[h][0]) return h;
  }
  return 1;
}

/** Which Juz does a global ayah belong to? */
function globalToJuz(g) {
  for (let j = 30; j >= 1; j--) {
    if (g >= JUZ_RANGES[j][0]) return j;
  }
  return 1;
}

/** True if surah:ayah falls within the given Hizb's ayah range. */
function ayahIsInHizb(surah, ayah, hizb) {
  if (!SURAH_OFFSETS[surah] || !HIZB_RANGES[hizb]) return true; // can't validate garbage input — don't block on it
  const globalAyah = SURAH_OFFSETS[surah] + ayah - 1;
  const [start, end] = hizbRange(hizb);
  return globalAyah >= start && globalAyah <= end;
}

/** True if `ayah` is a real ayah number (1..count) within `surah`. False for an unrecognized surah too, unlike ayahIsInHizb, since here the surah itself is the only thing being checked against. */
function ayahIsInSurah(surah, ayah) {
  const entry = SURAHS[surah - 1];
  if (!entry) return false;
  return Number.isInteger(ayah) && ayah >= 1 && ayah <= entry[3];
}
