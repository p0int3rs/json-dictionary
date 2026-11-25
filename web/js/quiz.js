'use strict';

/*
 * Oyun mantığı: hangi kelimelerin sorulacağı ve soruların üretilmesi.
 * Saf fonksiyonlar; DOM'a dokunmaz.
 *
 * Modlar:
 *  en-tr       İngilizce kelime, Türkçe anlamı seç
 *  tr-en       Türkçe anlam, İngilizce kelimeyi seç
 *  tr-en-type  Türkçe anlam, İngilizce kelimeyi yaz
 *  cloze       Gördüğün cümlede boşluğa gelen kelimeyi seç
 *  card        Kartı çevir, bilip bilmediğini kendin söyle
 *  confuse     Aynı Türkçe anlamı paylaşan kelimeleri ayırt et
 *  root        Kökten (ya da türediği kelimeden) kelimeyi bul
 */
const Quiz = (() => {
  const { normTr, keyOf: normEn, UNSORTED, posLabel } = Store;
  // Ana anlam (gördüğün cümledeki anlam) bu olasılıkla sorulur; kalan sorular diğer anlamlardan.
  const PRIMARY_WEIGHT = 0.7;

  const rand = (n) => Math.floor(Math.random() * n);
  const sample = (arr) => arr[rand(arr.length)];
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = rand(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  const hasPos = (w, pos) => pos && pos !== UNSORTED && (w.senses[pos] || []).length > 0;
  const posHint = (pos) => (pos && pos !== UNSORTED ? `(${posLabel(pos)})` : '');
  const mainPos = (w) => Object.keys(w.senses).find((p) => p !== UNSORTED && w.senses[p].length) || UNSORTED;

  // Taslaklar (anlamı olmayan kelimeler) oyunda sorulmaz.
  const playable = (words) => words.filter((w) => w.meanings.length > 0);

  /* ---------- yardımcılar ---------- */

  // Sorulacak anlam: çoğunlukla ana anlam, bazen diğerleri.
  function pickSense(w, list = Store.senseList(w)) {
    if (w.primary && Math.random() < PRIMARY_WEIGHT) {
      const p = list.find((s) => s.text === w.primary);
      if (p) return p;
    }
    return sample(list);
  }

  // Türkçe ek sınıfı: yanlış şıklar doğru cevapla aynı ekle bitsin ki ekten elenmesin.
  const SUFFIXES = [
    ['mak', /m[ae]k$/],
    ['miş', /m[ıiuü]ş$/],
    ['lik', /l[ıiuü]k$/],
    ['siz', /s[ıiuü]z$/],
    ['ici', /[ıiuü][cç][ıiuü]$/],
    ['ci', /[cç][ıiuü]$/],
    ['li', /l[ıiuü]$/],
    ['sel', /s[ae]l$/],
    ['an', /[ae]n$/],
    ['ma', /m[ae]$/],
    ['ca', /[cç][ae]$/],
  ];
  function suffixOf(text) {
    const last = normTr(String(text).replace(/\([^)]*\)/g, '')).split(' ').pop() || '';
    const hit = SUFFIXES.find(([, re]) => re.test(last));
    return hit ? hit[0] : '';
  }

  // Farklı kelimelerden, `score` değeri yüksek olanlar önce gelmek üzere en fazla `k` çeldirici seç.
  function chooseDistractors(candidates, k, score) {
    const sorted = shuffle(candidates).sort((a, b) => score(b) - score(a));
    const picked = [];
    const usedText = new Set();
    const usedOwner = new Set();
    // 1. tur: her kelimeden en fazla bir şık; 2. tur: gerekirse kalanlar.
    for (const pass of [true, false]) {
      for (const c of sorted) {
        if (picked.length >= k) break;
        if (usedText.has(c.key) || (pass && usedOwner.has(c.owner.id))) continue;
        usedText.add(c.key);
        usedOwner.add(c.owner.id);
        picked.push(c.text);
      }
    }
    return picked;
  }

  // İngilizce kelime şıkları: `exclude` dışındaki kelimelerden, tercihen aynı türden.
  function wordDistractors(others, exclude, pos, k = 3) {
    const candidates = others.filter((o) => !exclude.has(o.id)).map((o) => ({ text: o.word, key: o.word, owner: o }));
    return chooseDistractors(candidates, k, (c) => (hasPos(c.owner, pos) ? 1 : 0));
  }

  function choiceQuestion(base, correctText, distractors) {
    if (!distractors.length) return null;
    return {
      kind: 'choice',
      ...base,
      choices: shuffle([correctText, ...distractors]).map((text) => ({ text, correct: text === correctText })),
    };
  }

  // Bu anlamı taşıyan diğer kelimeler (eşanlamlılar)
  const sharing = (others, meaning) => {
    const k = normTr(meaning);
    return others.filter((w) => w.meanings.some((m) => normTr(m) === k));
  };

  // Cümlede kelimeyi bul ve boşluğa çevir. Çekimli hâller de bulunur (held, devised…).
  function blank(sentence, ...forms) {
    for (const f of forms.filter(Boolean)) {
      const stem = f.length > 4 ? f.replace(/(e|y|ing|ed|s)$/i, '') : f;
      const m = sentence.match(new RegExp(`\\b${reEsc(stem)}[a-z]*`, 'i'));
      if (m) return { before: sentence.slice(0, m.index), hidden: m[0], after: sentence.slice(m.index + m[0].length) };
    }
    return null;
  }
  const cloze = (w) => {
    for (const s of shuffle(w.seen.filter((x) => x.sentence))) {
      const b = blank(s.sentence, s.form, w.word);
      if (b) return { ...b, source: s.source };
    }
    return null;
  };

  // Aynı Türkçe anlamı paylaşan kelimeler
  function siblingsOf(w, words) {
    const ks = new Set(w.meanings.map(normTr));
    return words.filter((o) => o.id !== w.id && o.meanings.some((m) => ks.has(normTr(m))));
  }
  // Kardeşlerinde olmayan anlamlar: bunlar sorulunca tek doğru cevap kalır.
  function uniqueSenses(w, siblings) {
    const taken = new Set(siblings.flatMap((o) => o.meanings.map(normTr)));
    return Store.senseList(w).filter((s) => !taken.has(normTr(s.text)));
  }

  // Kök: önce köken (Latince…), yoksa türediği İngilizce kelime.
  function rootOf(w) {
    const e = w.etymology;
    if (e.root) return { key: 'e:' + normEn(e.root), text: e.root + (e.lang ? ` (${e.lang})` : ''), meaning: e.meaning };
    const b = w.base;
    if (b.word && normEn(b.word) !== w.word) {
      return { key: 'b:' + normEn(b.word), text: b.word + (b.pos ? ` (${posLabel(b.pos)})` : ''), meaning: b.meaning };
    }
    return null;
  }

  /* ---------- modlar ---------- */

  const MODES = {
    'en-tr': {
      eligible: playable,
      build(target, others) {
        const pick = pickSense(target);
        // Doğru kelimenin HİÇBİR anlamı çeldirici olamaz (eşanlamlı tuzağını önler).
        const forbidden = new Set(target.meanings.map(normTr));
        const suf = suffixOf(pick.text);
        const candidates = [];
        for (const w of others) {
          for (const s of Store.senseList(w)) {
            if (forbidden.has(normTr(s.text))) continue;
            candidates.push({ text: s.text, key: normTr(s.text), owner: w, pos: s.pos, suf: suffixOf(s.text) });
          }
        }
        // Önce aynı türden, sonra aynı ekle biten anlamlar.
        const score = (c) => (c.pos === pick.pos ? 2 : 0) + (suf && c.suf === suf ? 1 : 0);
        return choiceQuestion(
          { mode: 'en-tr', target, label: 'Bu kelimenin anlamı ne?', prompt: target.word, hint: posHint(pick.pos) },
          pick.text,
          chooseDistractors(candidates, 3, score)
        );
      },
    },

    'tr-en': {
      eligible: playable,
      build(target, others) {
        const pick = pickSense(target);
        const synonyms = sharing(others, pick.text);
        const exclude = new Set(synonyms.map((w) => w.id));
        return choiceQuestion(
          { mode: 'tr-en', target, label: 'Bu anlamın İngilizcesi ne?', prompt: pick.text, hint: posHint(pick.pos) },
          target.word,
          wordDistractors(others, exclude, pick.pos)
        );
      },
    },

    'tr-en-type': {
      eligible: playable,
      build(target, others) {
        const pick = pickSense(target);
        // Bu anlamı taşıyan diğer kelimeler de doğru kabul edilir.
        const accepted = [target.word, ...sharing(others, pick.text).map((w) => w.word)];
        return { kind: 'type', mode: 'tr-en-type', target, label: 'İngilizcesini yaz', prompt: pick.text, hint: posHint(pick.pos), accepted };
      },
    },

    cloze: {
      eligible: (words) => playable(words).filter((w) => w.seen.some((s) => s.sentence && blank(s.sentence, s.form, w.word))),
      build(target, others) {
        const c = cloze(target);
        if (!c) return null;
        const pos = target.primary ? (Store.senseList(target).find((s) => s.text === target.primary) || {}).pos : mainPos(target);
        // Aynı anlamı paylaşan kelimeler de boşluğa uyabilir: şık olmasın.
        const exclude = new Set(siblingsOf(target, others).map((w) => w.id));
        const q = choiceQuestion(
          { mode: 'cloze', target, label: 'Boşluğa hangi kelime gelir?', prompt: '', hint: posHint(pos), cloze: c },
          target.word,
          wordDistractors(others, exclude, pos)
        );
        return q;
      },
    },

    card: {
      eligible: playable,
      build(target) {
        const s = target.seen.find((x) => x.sentence);
        return {
          kind: 'card',
          mode: 'card',
          target,
          label: 'Anlamını hatırlıyor musun?',
          prompt: target.word,
          hint: '',
          context: s ? { sentence: s.sentence, form: s.form || target.word, source: s.source } : null,
        };
      },
    },

    confuse: {
      eligible(words) {
        const pool = playable(words);
        return pool.filter((w) => {
          const sib = siblingsOf(w, pool);
          return sib.length > 0 && uniqueSenses(w, sib).length > 0;
        });
      },
      build(target, others) {
        const sib = siblingsOf(target, others);
        const uniq = uniqueSenses(target, sib);
        if (!sib.length || !uniq.length) return null;
        const pick = pickSense(target, uniq);
        // Şıklar: önce karıştırılabilecek kelimeler, eksik kalırsa bu anlamı taşımayan aynı türden kelimeler.
        const fromSiblings = shuffle(sib).slice(0, 3).map((w) => w.word);
        const exclude = new Set([...sib, ...sharing(others, pick.text)].map((w) => w.id));
        const fill = wordDistractors(others, exclude, pick.pos, 3 - fromSiblings.length);
        const shared = target.meanings.filter((m) => sib.some((o) => o.meanings.some((x) => normTr(x) === normTr(m))));
        return choiceQuestion(
          {
            mode: 'confuse',
            target,
            label: 'Hangisi bu anlama gelir?',
            prompt: pick.text,
            hint: posHint(pick.pos),
            related: sib,
            relatedTitle: `Karıştırılabilecek kelimeler (ortak anlam: ${shared.join(', ')})`,
          },
          target.word,
          [...fromSiblings, ...fill]
        );
      },
    },

    root: {
      eligible: (words) => playable(words).filter(rootOf),
      build(target, others) {
        const r = rootOf(target);
        if (!r) return null;
        const family = others.filter((o) => (rootOf(o) || {}).key === r.key);
        // Aynı kökten gelenler de doğru olurdu; kökün kendisi de şık olmasın.
        const rootWord = normEn(r.text.replace(/\s*\(.*$/, ''));
        const exclude = new Set([...family, ...others.filter((o) => o.word === rootWord)].map((w) => w.id));
        return choiceQuestion(
          {
            mode: 'root',
            target,
            label: 'Bu kökten türeyen kelime hangisi?',
            prompt: r.text,
            hint: r.meaning ? `= ${r.meaning}` : '',
            related: family,
            relatedTitle: 'Aynı kökten',
          },
          target.word,
          wordDistractors(others, exclude, mainPos(target))
        );
      },
    },
  };

  const eligible = (words, mode) => (MODES[mode] || MODES['en-tr']).eligible(words);

  /**
   * Sorulacak kelimeleri seç.
   * strategy 'smart': önce tekrar zamanı gelmiş, düşük kutudaki kelimeler.
   * strategy 'random': tamamen rastgele.
   */
  function pickWords(words, count, strategy, mode = 'en-tr', now = Date.now()) {
    const pool = eligible(words, mode);
    const n = Math.min(count, pool.length);
    if (strategy === 'random') return shuffle(pool).slice(0, n);

    const byPriority = (list) =>
      shuffle(list).sort((a, b) => a.box - b.box || (a.lastSeen || 0) - (b.lastSeen || 0));
    const due = byPriority(pool.filter((w) => w.due <= now));
    const notDue = byPriority(pool.filter((w) => w.due > now));
    return shuffle([...due, ...notDue].slice(0, n));
  }

  function buildQuestion(target, allWords, mode = 'en-tr') {
    const others = playable(allWords).filter((w) => w.id !== target.id);
    return (MODES[mode] || MODES['en-tr']).build(target, others);
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      let diag = prev[0];
      prev[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const tmp = prev[j];
        prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
        diag = tmp;
      }
    }
    return prev[b.length];
  }

  // Yazma modunda cevabı kontrol et. 6+ harfli kelimelerde tek harf hatası tolere edilir.
  function checkTyped(question, input) {
    const ans = normEn(input);
    if (!ans) return { correct: false, typo: false };
    for (const acc of question.accepted) {
      if (ans === acc) return { correct: true, typo: false };
    }
    for (const acc of question.accepted) {
      if (acc.length >= 6 && levenshtein(ans, acc) === 1) return { correct: true, typo: true, expected: acc };
    }
    return { correct: false, typo: false };
  }

  return { pickWords, buildQuestion, checkTyped, playable, eligible, shuffle, suffixOf };
})();
