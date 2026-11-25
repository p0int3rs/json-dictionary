'use strict';

/*
 * Veri katmanı.
 *
 * Kelime dosyası biçimi (boş alanlar dosyaya yazılmaz):
 * {
 *   "hold": {
 *     "senses": { "verb": ["düzenlemek", "tutmak"], "noun": ["tutuş"] },
 *     "primary": "düzenlemek",
 *     "seen": [{ "form": "held", "sentence": "The summit was held in Geneva.", "source": "BBC", "date": "2026-11-24" }],
 *     "base": { "word": "…", "pos": "verb", "meaning": "…" },
 *     "etymology": { "root": "healdan", "lang": "Eski İngilizce", "meaning": "tutmak" },
 *     "note": "…",
 *     "review": ["senses"]
 *   }
 * }
 *
 * - Anahtar kelimenin yalın hâlidir; metinde görülen hâl seen[].form'da durur.
 * - "senses" boş olan kayıt taslaktır: oyunda sorulmaz, YZ ile doldurulmayı bekler.
 * - "primary" kelimenin gördüğün cümledeki anlamıdır (senses içindeki bir anlam).
 * - "review" otomatik dönüştürmenin emin olamadığı noktaları işaretler.
 * - Eski biçim ({ type, meaning, root, root_type, root_meaning, example, source }) okunur ve dönüştürülür.
 *
 * Oyun ilerlemesi (Leitner kutuları) kelime dosyasına yazılmaz; tarayıcıda tutulur,
 * istenirse ayrı bir dosyaya yedeklenir.
 */
const Store = (() => {
  const LS_KEY = 'jsondictionary.v4';
  const LEGACY_LS_KEY = 'jsondictionary.v3';
  const MAX_BOX = 5;
  // Kelime bu kutuya geçtiğinde kaç gün sonra tekrar sorulacak.
  const INTERVAL_DAYS = [0, 0, 1, 3, 7, 21];
  const DAY = 24 * 60 * 60 * 1000;
  const PROGRESS_FIELDS = ['box', 'due', 'correct', 'wrong', 'lastSeen'];

  let state = { savedAt: 0, words: [] };
  let migratedOnLoad = null; // { count, flagged } eski yerel veri dönüştürüldüyse
  const listeners = new Set();

  /* ---------- yardımcılar ---------- */

  const uid = () =>
    crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);

  // İngilizce anahtar: kültürden bağımsız küçük harf ("I" -> "i", "ı" değil).
  const keyOf = (word) => String(word ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  // Türkçe metin karşılaştırma: Türkçe kurallarıyla küçük harf.
  const normTr = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('tr');
  const str = (v) => (v == null || typeof v === 'object' ? '' : String(v).trim().replace(/\s+/g, ' '));
  const num = (v, d = 0) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
  const pad = (n) => String(n).padStart(2, '0');
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };

  // Parantez dışındaki ayraçlardan böl: "a, b (x, y); c" -> ["a", "b (x, y)", "c"]
  function splitTop(text, seps) {
    const parts = [];
    let depth = 0;
    let cur = '';
    for (const ch of String(text ?? '')) {
      if (ch === '(') depth++;
      if (ch === ')') depth = Math.max(0, depth - 1);
      if (depth === 0 && seps.includes(ch)) {
        parts.push(cur);
        cur = '';
      } else cur += ch;
    }
    parts.push(cur);
    return parts.map((p) => p.trim().replace(/\s+/g, ' ')).filter(Boolean);
  }
  function uniqTr(list) {
    const seen = new Set();
    return list.filter((m) => {
      const k = normTr(m);
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  const splitMeanings = (text) => uniqTr(splitTop(text, ',;'));

  // Türkçe fiil mastarı mı? ("takdim etmek", "kaçınmak (bir şeyden)")
  const isVerbTr = (m) => /m[ae]k$/.test(normTr(String(m).replace(/\([^)]*\)/g, '')));

  /* ---------- sözcük türleri ---------- */

  const POS_LIST = [
    'noun', 'verb', 'adjective', 'adverb', 'preposition',
    'conjunction', 'pronoun', 'determiner', 'interjection', 'phrase',
  ];
  const UNSORTED = 'unsorted';
  // Prototipsiz sözlük: dosyadan gelen "__proto__", "constructor" gibi anahtarlar yerleşik özelliklere çarpmasın.
  const dict = (o = {}) => Object.assign(Object.create(null), o);

  const POS_TR = dict({
    noun: 'isim', verb: 'fiil', adjective: 'sıfat', adverb: 'zarf', preposition: 'edat',
    conjunction: 'bağlaç', pronoun: 'zamir', determiner: 'belirleyici', interjection: 'ünlem',
    phrase: 'kalıp', unsorted: 'belirsiz',
  });
  const POS_ALIAS = dict({
    n: 'noun', isim: 'noun', ad: 'noun',
    v: 'verb', fiil: 'verb', eylem: 'verb',
    adj: 'adjective', 'sıfat': 'adjective', sifat: 'adjective',
    adv: 'adverb', zarf: 'adverb',
    prep: 'preposition', edat: 'preposition',
    conj: 'conjunction', 'bağlaç': 'conjunction', baglac: 'conjunction',
    zamir: 'pronoun',
    det: 'determiner', belirleyici: 'determiner', determinant: 'determiner',
    'ünlem': 'interjection', unlem: 'interjection',
    deyim: 'phrase', 'kalıp': 'phrase', kalip: 'phrase', idiom: 'phrase', phrasal: 'phrase', expression: 'phrase',
    unsorted: UNSORTED, belirsiz: UNSORTED, 'türü belirsiz': UNSORTED, '?': UNSORTED,
  });
  for (const p of POS_LIST) POS_ALIAS[p] = p;

  // Tek bir tür adını kanonik İngilizce ada çevir; tanınmazsa null.
  function posKey(token) {
    const t = String(token ?? '').trim();
    if (!t) return null;
    return (
      POS_ALIAS[t.toLowerCase().replace(/̇/g, '')] || // "İsim".toLowerCase() -> "i̇sim" düzeltmesi
      POS_ALIAS[t.toLocaleLowerCase('tr')] ||
      null
    );
  }
  // Serbest metindeki türler, sırayla: "adjective-noun-verb/sıfat-isim-fiil" -> [adjective, noun, verb]
  function posListOf(text) {
    const out = [];
    const tokens = String(text ?? '')
      .replace(/\([^)]*\)/g, ' ')
      .split(/[\s\-/,;]+/);
    for (const t of tokens) {
      const p = posKey(t);
      if (p && p !== UNSORTED && !out.includes(p)) out.push(p);
    }
    return out;
  }
  const posLabel = (p) => POS_TR[p] || p;

  /* ---------- alan temizleme ---------- */

  // { "verb": ["a", "b"], "isim": "c, d" } -> { verb: [a, b], noun: [c, d] }. Aynı anlam iki kez yazılmaz.
  function cleanSenses(input) {
    const out = {};
    const seen = new Set();
    const add = (pos, list) => {
      if (!out[pos]) out[pos] = [];
      for (const m of list) {
        const t = str(m);
        const k = normTr(t);
        if (!k || seen.has(k)) continue;
        seen.add(k);
        out[pos].push(t);
      }
    };
    if (typeof input === 'string') add(UNSORTED, splitMeanings(input));
    else if (Array.isArray(input)) add(UNSORTED, input);
    else if (input && typeof input === 'object') {
      for (const [k, v] of Object.entries(input)) {
        add(posKey(k) || UNSORTED, Array.isArray(v) ? v : splitMeanings(v));
      }
    }
    // "belirsiz" grubu her zaman en sonda
    if (out[UNSORTED]) {
      const u = out[UNSORTED];
      delete out[UNSORTED];
      out[UNSORTED] = u;
    }
    return out;
  }

  function cleanSeen(input) {
    const arr = Array.isArray(input) ? input : input ? [input] : [];
    const out = [];
    const keys = new Set();
    for (const s of arr) {
      const o = typeof s === 'string' ? { sentence: s } : s && typeof s === 'object' ? s : null;
      if (!o) continue;
      const e = { form: keyOf(str(o.form)), sentence: str(o.sentence), source: str(o.source), date: str(o.date) };
      if (!e.form && !e.sentence && !e.source) continue;
      const k = e.form + '|' + normTr(e.sentence) + '|' + normTr(e.source);
      if (keys.has(k)) continue;
      keys.add(k);
      out.push(e);
    }
    return out;
  }

  function cleanBase(b) {
    const o = typeof b === 'string' ? { word: b } : b && typeof b === 'object' ? b : {};
    return { word: str(o.word), pos: posListOf(o.pos)[0] || '', meaning: str(o.meaning) };
  }

  function cleanEty(e) {
    const o = typeof e === 'string' ? { root: e } : e && typeof e === 'object' ? e : {};
    return { root: str(o.root), lang: str(o.lang), pos: posListOf(o.pos)[0] || '', meaning: str(o.meaning) };
  }

  function makeWord(f, now = Date.now()) {
    const senses = cleanSenses(f.senses);
    let primary = str(f.primary);
    if (primary) {
      const hit = Object.values(senses).flat().find((m) => normTr(m) === normTr(primary));
      if (hit) primary = hit;
      else {
        // Ana anlam listede yoksa kaybolmasın: ilk türün başına eklenir.
        const first = Object.keys(senses).find((p) => p !== UNSORTED) || Object.keys(senses)[0] || UNSORTED;
        senses[first] = [primary, ...(senses[first] || [])];
      }
    }
    const review = [...new Set((Array.isArray(f.review) ? f.review : []).map(str).filter(Boolean))];
    return {
      id: f.id || uid(),
      word: keyOf(f.word),
      createdAt: num(f.createdAt, now),
      updatedAt: num(f.updatedAt, now),
      box: Math.min(MAX_BOX, Math.max(1, num(f.box, 1))),
      due: num(f.due, now),
      correct: num(f.correct),
      wrong: num(f.wrong),
      lastSeen: f.lastSeen ? num(f.lastSeen) : null,
      senses,
      primary,
      seen: cleanSeen(f.seen),
      base: cleanBase(f.base),
      etymology: cleanEty(f.etymology),
      note: str(f.note),
      review,
      meanings: Object.values(senses).flat(),
    };
  }

  const isDraft = (w) => w.meanings.length === 0;
  const senseList = (w) => Object.entries(w.senses).flatMap(([pos, list]) => list.map((text) => ({ pos, text })));

  /* ---------- eski biçimden dönüştürme ---------- */

  const LANGS = dict({
    latin: 'Latince', latince: 'Latince',
    yunanca: 'Yunanca', 'antik yunanca': 'Yunanca', 'eski yunanca': 'Yunanca', greek: 'Yunanca',
    'eski ingilizce': 'Eski İngilizce', 'old english': 'Eski İngilizce',
    'eski fransızca': 'Eski Fransızca', 'old french': 'Eski Fransızca',
    'fransızca': 'Fransızca', french: 'Fransızca',
    almanca: 'Almanca', german: 'Almanca', 'eski norsça': 'Eski Norsça', 'old norse': 'Eski Norsça',
  });
  function langOf(...texts) {
    for (const t of texts) {
      for (const m of String(t ?? '').matchAll(/\(([^)]*)\)/g)) {
        const l = LANGS[normTr(m[1])];
        if (l) return l;
      }
    }
    return '';
  }
  const noParens = (s) => str(s).replace(/\s*\([^)]*\)/g, '').trim();

  // Eski "meaning" metnini türlere ayır.
  function legacySenses(posList, meaningText) {
    const all = splitMeanings(meaningText);
    if (!all.length) return { senses: {}, unsure: false };
    if (!posList.length) return { senses: { [UNSORTED]: all }, unsure: true };
    if (posList.length === 1) {
      // Tek tür ama biçim uymuyor: isim altında "arama yapmak" ya da fiil altında "tutulan"
      const p = posList[0];
      const odd = p === 'verb' ? all.some((m) => !isVerbTr(m)) : p !== 'phrase' && all.some(isVerbTr);
      return { senses: { [p]: all }, unsure: odd };
    }
    // "taslak, özet; özetlemek" + "noun-verb": ";" grupları türlerle sırayla eşlenir
    const groups = splitTop(meaningText, ';').map(splitMeanings).filter((g) => g.length);
    if (groups.length === posList.length) {
      return { senses: Object.fromEntries(posList.map((p, i) => [p, groups[i]])), unsure: false };
    }
    // Aksi hâlde -mak/-mek ile bitenler fiil, kalanlar diğer tür (tek ise) ya da "belirsiz"
    const senses = Object.fromEntries(posList.map((p) => [p, []]));
    const others = posList.filter((p) => p !== 'verb');
    const rest = [];
    for (const m of all) {
      if (senses.verb && isVerbTr(m)) senses.verb.push(m);
      else if (others.length === 1) senses[others[0]].push(m);
      else rest.push(m);
    }
    if (rest.length) senses[UNSORTED] = rest;
    return { senses, unsure: rest.length > 0 || posList.some((p) => senses[p].length === 0) };
  }

  // Kelime çekimli bir hâl gibi görünüyorsa olası yalın hâlini döndür.
  function lemmaGuess(word, posList, typeText, baseWord) {
    const b = keyOf(baseWord);
    if (b && b !== word && /v2|v3|past|participle|geçmiş/i.test(String(typeText ?? ''))) return b;
    if (b && b !== word && posList.includes('verb')) {
      const stem = b.replace(/e$/, '');
      const last = b.slice(-1);
      const forms = [b + 'ed', b + 'd', b + 'ing', stem + 'ing', b + last + 'ing', b + last + 'ed', b + 's', b + 'es', b.replace(/y$/, 'ied')];
      if (forms.includes(word)) return b;
    }
    if (posList.length === 1 && posList[0] === 'noun' && !word.includes(' ')) {
      if (/ies$/.test(word)) return word.slice(0, -3) + 'y';
      if (/[^su]s$/.test(word) && !/(ss|us|is|ics|ness)$/.test(word)) return word.slice(0, -1);
    }
    return '';
  }

  function fromLegacy(key, e) {
    const word = keyOf(key);
    const review = [];
    const posList = posListOf(e.type);
    const { senses, unsure } = legacySenses(posList, e.meaning);
    if (unsure) review.push('senses');

    const seen = str(e.example) || str(e.source) ? [{ form: word, sentence: str(e.example), source: str(e.source) }] : [];

    let base = {};
    let etymology = {};
    const root = noParens(e.root);
    if (root || str(e.root_meaning)) {
      const lang = langOf(e.root, e.root_type);
      const pos = posListOf(e.root_type)[0] || '';
      const isRoot = String(e.root_type ?? '')
        .toLocaleLowerCase('tr')
        .split(/[\s\-/,;()]+/)
        .some((t) => t === 'root' || t === 'kök');
      if (lang || isRoot) {
        etymology = { root, lang, pos, meaning: str(e.root_meaning) };
      } else {
        base = { word: root, pos, meaning: str(e.root_meaning) };
        if (keyOf(root) === word) review.push('base-self');
      }
    }

    const lemma = lemmaGuess(word, posList, e.type, base.word);
    if (lemma) review.push('lemma:' + lemma);
    return { word, senses, primary: '', seen, base, etymology, note: '', review };
  }

  const LEGACY_KEYS = ['type', 'meaning', 'root', 'root_type', 'root_meaning', 'example', 'source'];
  const isLegacyEntry = (v) =>
    !('senses' in v) && !('seen' in v) && !('primary' in v) && LEGACY_KEYS.some((k) => k in v);

  function reviewInfo(code) {
    if (code === 'senses') return { text: 'Anlamlar türlere tam ayrılamadı; türleri kontrol et.' };
    if (code === 'base-self') return { text: 'Türediği kelime olarak kelimenin kendisi yazılmış.' };
    if (code.startsWith('lemma:')) {
      const lemma = code.slice(6);
      return { text: `Çekimli hâl olabilir; yalın hâli "${lemma}" mi?`, lemma };
    }
    return { text: code };
  }

  /* ---------- kalıcılık ---------- */

  function load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        state = { savedAt: num(parsed.savedAt), words: (parsed.words || []).map((w) => makeWord(w)) };
        return;
      }
      // Önceki sürümün yerel verisi: dönüştür, ilerlemeyi koru. Eski anahtar yedek olarak kalır.
      const legacy = localStorage.getItem(LEGACY_LS_KEY);
      if (legacy) {
        const parsed = JSON.parse(legacy);
        const words = (parsed.words || []).map((w) => makeWord({ ...w, ...fromLegacy(w.word, w) }));
        state = { savedAt: num(parsed.savedAt), words };
        migratedOnLoad = { count: words.length, flagged: words.filter((w) => w.review.length).length };
        saveLocal();
      }
    } catch (err) {
      console.warn('Yerel veri okunamadı', err);
    }
  }

  function saveLocal() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(state));
    } catch (err) {
      console.warn('Yerel veri yazılamadı', err);
    }
  }

  // savedAt yalnızca kelime içeriği değişince güncellenir; oyun oynamak dosyayla
  // eşitlemede tarayıcıyı "daha yeni" göstermesin (diğer bilgisayardaki eklemeler ezilmesin).
  function persist({ contentChanged = true } = {}) {
    if (contentChanged) state.savedAt = Date.now();
    saveLocal();
    if (contentChanged) FileSync.scheduleWrite();
    listeners.forEach((fn) => fn());
  }

  const onChange = (fn) => listeners.add(fn);

  /* ---------- kayıt işlemleri ---------- */

  const all = () => state.words;
  const get = (id) => state.words.find((w) => w.id === id);
  const findByWord = (word) => {
    const k = keyOf(word);
    return k ? state.words.find((w) => w.word === k) : undefined;
  };
  // Anahtar ya da metinde görülen hâllerden biri eşleşen kayıt (held -> hold).
  const findByForm = (form) => {
    const k = keyOf(form);
    if (!k) return undefined;
    return findByWord(k) || state.words.find((w) => w.seen.some((s) => s.form === k));
  };

  function replaceWord(old, next) {
    state.words[state.words.indexOf(old)] = next;
    return next;
  }

  // Okurken hızlı ekleme: yalnızca kelime, cümle, kaynak. Kelime zaten varsa bağlam olarak eklenir.
  function quickAdd({ form, sentence, source }) {
    const f = keyOf(form);
    if (!f) throw new Error('Kelime boş olamaz.');
    const entry = { form: f, sentence: str(sentence), source: str(source), date: today() };
    const existing = findByForm(f);
    if (existing) {
      const before = existing.seen.length;
      const seen = cleanSeen([...existing.seen, entry]);
      if (seen.length === before) return { word: existing, added: false, duplicate: true };
      existing.seen = seen;
      existing.updatedAt = Date.now();
      persist();
      return { word: existing, added: false };
    }
    const w = makeWord({ word: f, seen: [entry] });
    state.words.push(w);
    persist();
    return { word: w, added: true };
  }

  // Eski adı, metinde görülen hâl olarak sakla (yeniden adlandırmada bilgi kaybolmasın).
  function keepFormOf(seen, oldWord) {
    if (seen.some((s) => s.form === oldWord)) return seen;
    const blank = seen.find((s) => !s.form);
    if (blank) blank.form = oldWord;
    else seen.push({ form: oldWord, sentence: '', source: '', date: '' });
    return seen;
  }

  // Düzenleme formundan tam kayıt. id yoksa yeni kayıt. İnceleme işaretleri temizlenir.
  function save(id, fields) {
    const word = keyOf(fields.word);
    if (!word) throw new Error('Kelime boş olamaz.');
    const dup = findByWord(word);
    if (dup && dup.id !== id) throw new Error(`"${word}" zaten listede.`);
    const old = id ? get(id) : null;
    if (id && !old) throw new Error('Kelime bulunamadı.');
    let seen = cleanSeen(fields.seen);
    if (old && old.word !== word) seen = keepFormOf(seen, old.word);
    const now = Date.now();
    const next = makeWord({
      ...(old || {}),
      ...fields,
      seen,
      word,
      id: old ? old.id : undefined,
      createdAt: old ? old.createdAt : now,
      updatedAt: now,
      box: old ? old.box : 1,
      due: old ? old.due : now,
      review: fields.review || [],
    });
    if (old) replaceWord(old, next);
    else state.words.push(next);
    persist();
    return next;
  }

  // src'yi dst'ye kat: bağlamlar birleşir, dst taslaksa src'nin içeriği alınır. src silinir.
  function mergeInto(src, dst) {
    const content = isDraft(dst) && !isDraft(src) ? src : dst;
    const next = makeWord({
      ...dst,
      senses: content.senses,
      primary: content.primary,
      base: content.base.word || content.base.meaning ? content.base : dst.base.word ? dst.base : src.base,
      etymology: content.etymology.root ? content.etymology : dst.etymology.root ? dst.etymology : src.etymology,
      note: dst.note || src.note,
      seen: keepFormOf(cleanSeen([...dst.seen, ...src.seen]), src.word),
      review: [...dst.review, ...src.review].filter((c) => !c.startsWith('lemma:')),
      updatedAt: Date.now(),
    });
    state.words = state.words.filter((w) => w !== src);
    return replaceWord(dst, next);
  }

  // Kelimeyi yalın hâline taşı. O ad zaten varsa iki kayıt birleşir.
  function rename(id, newWord) {
    const w = get(id);
    const k = keyOf(newWord);
    if (!w || !k || k === w.word) return w;
    w.review = w.review.filter((c) => !c.startsWith('lemma:'));
    const other = findByWord(k);
    let result;
    if (other) result = mergeInto(w, other);
    else {
      w.seen = keepFormOf(w.seen, w.word);
      w.word = k;
      w.updatedAt = Date.now();
      result = w;
    }
    persist();
    return result;
  }

  function dismissReview(id, code) {
    const w = get(id);
    if (!w) return;
    w.review = w.review.filter((c) => c !== code);
    persist();
  }

  /**
   * YZ'den gelen kayıtları uygula.
   * items: [{ targetId, key, fields: { senses, primary, base, etymology, note, seen } }]
   * Anlam, ana anlam, kök ve not YZ'nin cevabıyla değişir; bağlamlar ve ilerleme korunur.
   */
  function applyAI(items) {
    let n = 0;
    for (const it of items) {
      const key = keyOf(it.key);
      if (!key) continue;
      let target = it.targetId ? get(it.targetId) : null;
      const owner = findByWord(key);
      if (target && owner && owner !== target) target = mergeInto(target, owner);
      if (!target) target = owner;
      const f = it.fields;
      if (!target) {
        state.words.push(makeWord({ word: key, ...f, seen: f.seen || [] }));
        n++;
        continue;
      }
      let seen = target.seen.slice();
      if (target.word !== key) seen = keepFormOf(seen, target.word);
      for (const s of cleanSeen(f.seen)) {
        const known = s.sentence
          ? seen.some((t) => normTr(t.sentence) === normTr(s.sentence))
          : s.form === key || seen.some((t) => t.form === s.form);
        if (!known) seen.push(s);
      }
      replaceWord(
        target,
        makeWord({
          ...target,
          word: key,
          senses: f.senses,
          primary: f.primary,
          base: f.base,
          etymology: f.etymology,
          note: f.note,
          seen,
          review: [],
          updatedAt: Date.now(),
        })
      );
      n++;
    }
    persist();
    return n;
  }

  function remove(id) {
    state.words = state.words.filter((w) => w.id !== id);
    persist();
  }

  /* ---------- aralıklı tekrar ---------- */

  function recordAnswer(id, isCorrect, now = Date.now()) {
    const w = get(id);
    if (!w) return;
    w.lastSeen = now;
    if (isCorrect) {
      w.correct += 1;
      w.box = Math.min(MAX_BOX, w.box + 1);
      w.due = now + INTERVAL_DAYS[w.box] * DAY;
    } else {
      w.wrong += 1;
      w.box = 1;
      w.due = now;
    }
    persist({ contentChanged: false });
  }

  function stats(now = Date.now()) {
    const words = state.words;
    const ready = words.filter((w) => !isDraft(w));
    return {
      total: words.length,
      due: ready.filter((w) => w.due <= now).length,
      mastered: ready.filter((w) => w.box >= MAX_BOX).length,
      drafts: words.length - ready.length,
      review: words.filter((w) => w.review.length).length,
    };
  }

  /* ---------- kelime dosyası ---------- */

  const FORMAT_HINT =
    'Beklenen biçim: { "kelime": { "senses": { "verb": ["…"] }, "primary": "…", "seen": [ … ] } } ya da eski biçim { "kelime": { "type": "…", "meaning": "…" } }';

  function parse(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      throw new Error('Dosya geçerli bir JSON değil: ' + err.message);
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(FORMAT_HINT);
    const now = Date.now();
    const words = [];
    let legacy = 0;
    Object.entries(data).forEach(([key, v], i) => {
      let f;
      if (typeof v === 'string') {
        // Kısa yazım: "kelime": "anlam1, anlam2"
        f = fromLegacy(key, { meaning: v });
        legacy++;
      } else if (v && typeof v === 'object' && !Array.isArray(v)) {
        if (isLegacyEntry(v)) {
          f = fromLegacy(key, v);
          legacy++;
        } else {
          const { senses, primary, seen, base, etymology, note, review } = v;
          f = { senses, primary, seen, base, etymology, note, review };
        }
      } else return;
      const w = makeWord({ ...f, word: key, createdAt: i, updatedAt: now });
      // Eklenme tarihi dosyada yok: ilk görülme tarihinden al. Tarihsiz eski kelimeler
      // "bugün eklendi" sayılmasın diye dosyadaki sırayla en eskiye konur.
      const dates = w.seen.map((s) => Date.parse(s.date)).filter(Number.isFinite);
      if (dates.length) w.createdAt = Math.min(...dates) + i;
      if (w.word) words.push(w);
    });
    if (words.length === 0 && Object.keys(data).length > 0) throw new Error(FORMAT_HINT);
    return { words, legacy, flagged: words.filter((w) => w.review.length).length };
  }

  // Okunaklı JSON: düz değer dizileri ve kısa düz nesneler tek satırda, diğerleri girintili.
  const flat = (x) => x === null || typeof x !== 'object';
  function pretty(v, ind = '') {
    if (v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every(flat)) {
      const keys = Object.keys(v);
      const line = '{ ' + keys.map((k) => JSON.stringify(k) + ': ' + JSON.stringify(v[k])).join(', ') + ' }';
      if (keys.length && ind.length + line.length <= 100) return line;
    }
    if (Array.isArray(v)) {
      if (v.every((x) => x === null || typeof x !== 'object')) return '[' + v.map((x) => JSON.stringify(x)).join(', ') + ']';
      const inner = ind + '  ';
      return '[\n' + v.map((x) => inner + pretty(x, inner)).join(',\n') + '\n' + ind + ']';
    }
    if (v && typeof v === 'object') {
      const keys = Object.keys(v);
      if (!keys.length) return '{}';
      const inner = ind + '  ';
      return '{\n' + keys.map((k) => inner + JSON.stringify(k) + ': ' + pretty(v[k], inner)).join(',\n') + '\n' + ind + '}';
    }
    return JSON.stringify(v);
  }

  // Yalnızca dolu alanları, sabit sırada al.
  const compact = (o, keys) => Object.fromEntries(keys.filter((k) => o[k]).map((k) => [k, o[k]]));

  function entryOf(w) {
    const e = { senses: w.senses };
    if (w.primary) e.primary = w.primary;
    if (w.seen.length) e.seen = w.seen.map((s) => compact(s, ['form', 'sentence', 'source', 'date']));
    const base = compact(w.base, ['word', 'pos', 'meaning']);
    if (base.word || base.meaning) e.base = base;
    const ety = compact(w.etymology, ['root', 'lang', 'pos', 'meaning']);
    if (ety.root || ety.meaning) e.etymology = ety;
    if (w.note) e.note = w.note;
    if (w.review.length) e.review = w.review;
    return e;
  }

  function exportWords(words = state.words) {
    const out = dict();
    for (const w of words) out[w.word] = entryOf(w);
    return pretty(out) + '\n';
  }

  // Aynı kelimenin ilerlemesini ve kimliğini yeni kayda taşı.
  function carryProgress(words) {
    const old = new Map(state.words.map((w) => [w.word, w]));
    for (const w of words) {
      const o = old.get(w.word);
      if (!o) continue;
      w.id = o.id;
      w.createdAt = o.createdAt;
      for (const k of PROGRESS_FIELDS) w[k] = o[k];
    }
  }

  function dedupe(words) {
    const map = new Map();
    for (const w of words) if (!map.has(w.word)) map.set(w.word, w);
    return [...map.values()];
  }

  // Gelen kaydı mevcut kayda kat: eksik anlamlar eklenir, boş alanlar doldurulur, bağlamlar birleşir.
  function mergeContent(cur, inc) {
    let senses = cur.senses;
    let { primary, base, etymology, note } = cur;
    if (isDraft(cur) && !isDraft(inc)) {
      ({ senses, primary, base, etymology, note } = inc);
    } else {
      const have = new Set(cur.meanings.map(normTr));
      senses = { ...cur.senses };
      for (const [pos, list] of Object.entries(inc.senses)) {
        const extra = list.filter((m) => !have.has(normTr(m)));
        if (extra.length || !senses[pos]) senses[pos] = [...(senses[pos] || []), ...extra];
      }
      primary = primary || inc.primary;
      if (!base.word && !base.meaning) base = inc.base;
      if (!etymology.root && !etymology.meaning) etymology = inc.etymology;
      note = note || inc.note;
    }
    return makeWord({
      ...cur,
      senses,
      primary,
      base,
      etymology,
      note,
      seen: [...cur.seen, ...inc.seen],
      review: [...cur.review, ...inc.review],
    });
  }

  // mode: 'replace' (listeyi dosyadakiyle değiştir) | 'merge' (birleştir)
  function importWords(words, mode) {
    if (mode === 'replace') {
      const next = dedupe(words);
      carryProgress(next);
      state.words = next;
    } else {
      for (const inc of words) {
        const cur = findByWord(inc.word);
        if (!cur) state.words.push(inc);
        else replaceWord(cur, mergeContent(cur, inc));
      }
    }
    persist();
  }

  // Bağlı dosyadan gelen içerikle değiştir; dosyaya geri yazma.
  function replaceFromFile(words, savedAt) {
    const next = dedupe(words);
    carryProgress(next);
    state.words = next;
    state.savedAt = savedAt || Date.now();
    saveLocal();
    listeners.forEach((fn) => fn());
  }

  /* ---------- düzenleme formu için metin biçimi ---------- */

  // { verb: [a, b], noun: [c] } -> "fiil: a, b\nisim: c"
  const sensesToText = (senses) =>
    Object.entries(senses)
      .map(([p, list]) => `${posLabel(p)}: ${list.join(', ')}`)
      .join('\n');

  // "fiil: a, b\nisim: c" -> { verb: [a, b], noun: [c] }. Türü yazılmamış satırlar "belirsiz" olur.
  function parseSensesText(text) {
    const out = {};
    for (const line of String(text ?? '').split(/\n+/)) {
      if (!line.trim()) continue;
      const m = line.match(/^\s*([^:()]{1,25}):(.*)$/);
      let pos = UNSORTED;
      let body = line;
      if (m && posKey(m[1])) {
        pos = posKey(m[1]);
        body = m[2];
      }
      const list = splitMeanings(body);
      if (list.length) out[pos] = [...(out[pos] || []), ...list];
    }
    return cleanSenses(out);
  }

  /* ---------- ilerleme yedeği ---------- */

  function exportProgress() {
    const progress = dict();
    for (const w of state.words) {
      progress[w.word] = Object.fromEntries(PROGRESS_FIELDS.map((k) => [k, w[k]]));
    }
    return JSON.stringify({ kind: 'jsondictionary-progress', savedAt: Date.now(), progress }, null, 2) + '\n';
  }

  function importProgress(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('Dosya geçerli bir JSON değil.');
    }
    if (!data || data.kind !== 'jsondictionary-progress' || typeof data.progress !== 'object') {
      throw new Error('Bu bir ilerleme yedeği değil.');
    }
    let n = 0;
    for (const [word, p] of Object.entries(data.progress)) {
      // Kelime yalın hâline taşındıysa eski adıyla da bulunur (held -> hold).
      const w = findByForm(word);
      if (!w || !p) continue;
      w.box = Math.min(MAX_BOX, Math.max(1, num(p.box, 1)));
      w.due = num(p.due, Date.now());
      w.correct = num(p.correct);
      w.wrong = num(p.wrong);
      w.lastSeen = p.lastSeen ? num(p.lastSeen) : null;
      n++;
    }
    persist({ contentChanged: false });
    return n;
  }

  /* ---------- dosyaya bağlama (Chrome / Edge / Brave) ---------- */

  const FileSync = (() => {
    const supported = typeof window.showOpenFilePicker === 'function';
    let handle = null;
    // Seçilen ama henüz onaylanmamış dosya. Onaylanana kadar ona hiçbir şey yazılmaz.
    let pending = null;
    let timer = null;
    let status = 'none'; // none | needs-permission | connected | error
    const statusListeners = new Set();

    const setStatus = (s) => {
      status = s;
      statusListeners.forEach((fn) => fn());
    };

    // Dosya tutamacını IndexedDB'de sakla ki sayfa yenilenince tekrar bağlanabilsin.
    function idb(mode, fn) {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open('jsondictionary', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('kv');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const tx = req.result.transaction('kv', mode);
          const r = fn(tx.objectStore('kv'));
          tx.oncomplete = () => resolve(r && r.result);
          tx.onerror = () => reject(tx.error);
        };
      });
    }
    const saveHandle = (h) => idb('readwrite', (s) => (h ? s.put(h, 'file') : s.delete('file'))).catch(() => {});
    const loadHandle = () => idb('readonly', (s) => s.get('file')).catch(() => null);

    async function init() {
      if (!supported) return;
      const h = await loadHandle();
      if (!h) return;
      handle = h;
      const p = await h.queryPermission({ mode: 'readwrite' });
      setStatus(p === 'granted' ? 'connected' : 'needs-permission');
    }

    async function read(h) {
      const file = await h.getFile();
      const text = await file.text();
      return { ...parse(text), text, lastModified: file.lastModified };
    }

    async function writeNow() {
      if (!handle || status !== 'connected') return;
      try {
        const w = await handle.createWritable();
        await w.write(exportWords());
        await w.close();
      } catch (err) {
        console.error(err);
        setStatus('error');
      }
    }

    function scheduleWrite() {
      if (!handle || status !== 'connected') return;
      clearTimeout(timer);
      timer = setTimeout(writeNow, 400);
    }

    async function hasWrite(h, ask) {
      if ((await h.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
      return ask && (await h.requestPermission({ mode: 'readwrite' })) === 'granted';
    }

    const jsonTypes = [{ description: 'JSON', accept: { 'application/json': ['.json'] } }];

    async function pickExisting() {
      const [h] = await window.showOpenFilePicker({ types: jsonTypes });
      if (!(await hasWrite(h, true))) throw new Error('Dosyaya yazma izni verilmedi.');
      pending = h;
      return read(h);
    }

    async function createNew() {
      handle = await window.showSaveFilePicker({ suggestedName: 'kelimeler.json', types: jsonTypes });
      pending = null;
      await saveHandle(handle);
      setStatus('connected');
      await writeNow();
    }

    async function confirmBinding() {
      if (!pending) return;
      handle = pending;
      pending = null;
      await saveHandle(handle);
      setStatus('connected');
      await writeNow();
    }

    async function reconnect() {
      if (!handle) return null;
      if (!(await hasWrite(handle, true))) throw new Error('Dosyaya erişim izni verilmedi.');
      setStatus('connected');
      return read(handle);
    }

    async function disconnect() {
      clearTimeout(timer);
      handle = null;
      pending = null;
      await saveHandle(null);
      setStatus('none');
    }

    return {
      supported,
      init,
      pickExisting,
      createNew,
      confirmBinding,
      reconnect,
      disconnect,
      scheduleWrite,
      writeNow,
      abandonPick() {
        pending = null;
      },
      onStatus: (fn) => statusListeners.add(fn),
      get status() {
        return status;
      },
      get fileName() {
        const h = pending || handle;
        return h ? h.name : '';
      },
    };
  })();

  load();

  return {
    MAX_BOX,
    POS_LIST,
    UNSORTED,
    keyOf,
    normTr,
    posKey,
    posLabel,
    posListOf,
    splitMeanings,
    isVerbTr,
    isDraft,
    senseList,
    cleanSenses,
    cleanSeen,
    cleanBase,
    cleanEty,
    reviewInfo,
    sensesToText,
    parseSensesText,
    all,
    get,
    findByWord,
    findByForm,
    quickAdd,
    save,
    rename,
    dismissReview,
    applyAI,
    remove,
    recordAnswer,
    stats,
    parse,
    importWords,
    replaceFromFile,
    exportWords,
    exportProgress,
    importProgress,
    onChange,
    get savedAt() {
      return state.savedAt;
    },
    get migratedOnLoad() {
      return migratedOnLoad;
    },
    FileSync,
  };
})();
