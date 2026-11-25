'use strict';

/*
 * YZ ile doldurma: seçilen kelimeler için istek metnini oluşturur,
 * YZ'nin cevabını okuyup denetler. DOM'a dokunmaz.
 */
const AI = (() => {
  const { keyOf, normTr, posLabel, isVerbTr, UNSORTED } = Store;
  const str = (v) => (v == null || typeof v === 'object' ? '' : String(v).trim());

  const RULES = [
    'Anahtar, kelimenin YALIN hâli olsun (held → hold, assurances → assurance). Metinde geçen hâli "form" alanına yaz. Deyim ya da kalıpsa olduğu gibi bırak.',
    '"senses": anlamları türe göre grupla. Tür adı yalnızca şunlardan biri olabilir: noun, verb, adjective, adverb, preposition, conjunction, pronoun, determiner, interjection, phrase.',
    'Her türde en fazla 3 YAYGIN Türkçe karşılık yaz; nadir, eskimiş ya da çok teknik anlamları yazma. Kelime bir türde yaygın kullanılmıyorsa o türü hiç yazma.',
    '"primary": kelimenin VERİLEN CÜMLEDEKİ anlamı. "senses" içindeki anlamlardan biriyle harfi harfine aynı olmalı. Cümle verilmemişse en yaygın anlamı seç.',
    'Biçim tutarlı olsun: fiil anlamları -mak/-mek ile bitsin; sıfat anlamları sıfat, isim anlamları isim olsun.',
    '"base": kelime başka bir İngilizce kelimeden türemişse o kelime, türü ve Türkçe anlamı (appearance → appear). Türememişse alanları boş bırak. Kelimenin kendisini ASLA yazma.',
    '"etymology": yalnızca EMİN olduğun köken (root, lang, meaning). "lang" Türkçe yazılsın (Latince, Yunanca, Eski İngilizce, Eski Fransızca…). Emin değilsen alanları boş bırak, uydurma.',
    '"note": Türkçede aynı karşılığa sahip yaygın İngilizce kelimelerden farkı, tek cümle. Yoksa boş bırak.',
    'Aynı kelime birden fazla satırda geçiyorsa tek kayıt yap; "primary" için ilk cümleyi esas al.',
    'SADECE geçerli JSON döndür. Açıklama ya da yorum yazma.',
  ];

  const EXAMPLE = `{
  "hold": {
    "form": "held",
    "senses": { "verb": ["düzenlemek", "tutmak", "elinde bulundurmak"], "noun": ["tutuş", "etki"] },
    "primary": "düzenlemek",
    "base": { "word": "", "pos": "", "meaning": "" },
    "etymology": { "root": "healdan", "lang": "Eski İngilizce", "meaning": "tutmak, korumak" },
    "note": ""
  }
}`;

  // Bir kelime için istek satırları: "- held | "cümle" | kaynak"
  function linesFor(w) {
    const form = (w.seen.find((s) => s.form) || {}).form || w.word;
    const withSentence = w.seen.filter((s) => s.sentence);
    if (!withSentence.length) {
      const src = (w.seen.find((s) => s.source) || {}).source;
      return [`- ${form} | (cümle yok)${src ? ` | ${src}` : ''}`];
    }
    return withSentence.map(
      (s) => `- ${s.form || form} | "${s.sentence.replace(/"/g, "'")}"${s.source ? ` | ${s.source}` : ''}`
    );
  }

  function buildPrompt(words) {
    return [
      'Aşağıdaki İngilizce kelimeler için Türkçe sözlük kaydı hazırla.',
      'Her satır: kelimenin metinde geçtiği hâli | geçtiği cümle | kaynak.',
      '',
      'Kurallar:',
      ...RULES.map((r, i) => `${i + 1}. ${r}`),
      '',
      'Çıktı biçimi (örnek):',
      EXAMPLE,
      '',
      'Kelimeler:',
      ...words.flatMap(linesFor),
    ].join('\n');
  }

  // YZ cevabındaki JSON'u çıkar (kod bloğu ya da açıklama içinde olsa da).
  function extractJson(text) {
    const t = String(text ?? '').trim();
    if (!t) throw new Error('Önce YZ\'nin cevabını yapıştır.');
    const a = t.indexOf('{');
    const b = t.lastIndexOf('}');
    if (a < 0 || b < a) throw new Error('Cevapta JSON bulunamadı. YZ\'nin cevabını olduğu gibi yapıştır.');
    try {
      return JSON.parse(t.slice(a, b + 1));
    } catch (err) {
      throw new Error('JSON okunamadı: ' + err.message + '. Cevabın tamamını kopyaladığından emin ol.');
    }
  }

  const ACTIONS = {
    fill: 'taslak doldurulacak',
    update: 'güncellenecek',
    rename: 'yalın hâline taşınacak',
    merge: 'mevcut kayıtla birleşecek',
    other: 'seçmediğin kayıt güncellenecek',
    new: 'yeni kelime',
  };

  /**
   * Cevabı denetle. selected: istek metnine konan kayıtlar.
   * Döner: { items: [{ key, targetId, fromWord, action, errors, warnings, infos, fields }], missing: [kelime] }
   */
  function check(text, selected) {
    const data = extractJson(text);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('Beklenen biçim: { "kelime": { "senses": …, "primary": … } }');
    }
    const used = new Set();
    const items = [];

    for (const [rawKey, v] of Object.entries(data)) {
      const key = keyOf(rawKey);
      const errors = [];
      const warnings = [];
      const infos = [];
      if (!key) continue;
      if (!v || typeof v !== 'object' || Array.isArray(v)) {
        items.push({ key, action: 'new', errors: ['Kayıt bir nesne değil.'], warnings, infos, fields: null });
        continue;
      }

      // Türler ve anlamlar
      const rawSenses = v.senses && typeof v.senses === 'object' && !Array.isArray(v.senses) ? v.senses : {};
      for (const k of Object.keys(rawSenses)) {
        const p = Store.posKey(k);
        if (!p || p === UNSORTED) warnings.push(`Bilinmeyen tür "${k}"; "belirsiz" olarak kaydedilecek.`);
      }
      const senses = Store.cleanSenses(v.senses);
      for (const p of Object.keys(senses)) if (!senses[p].length) delete senses[p];
      const meanings = Object.values(senses).flat();
      if (!meanings.length) errors.push('Hiç anlam yok.');
      for (const [p, list] of Object.entries(senses)) {
        if (list.length > 3) warnings.push(`${posLabel(p)}: ${list.length} anlam var (en fazla 3 istenmişti).`);
        if (p === 'verb') {
          const odd = list.filter((m) => !isVerbTr(m));
          if (odd.length) warnings.push(`Fiil anlamı -mak/-mek ile bitmiyor: ${odd.join(', ')}`);
        } else if (p !== 'phrase' && p !== UNSORTED) {
          const verbs = list.filter(isVerbTr);
          if (verbs.length) warnings.push(`${posLabel(p)} altında fiil gibi duran anlam: ${verbs.join(', ')}`);
        }
      }

      const primary = str(v.primary);
      if (!primary) warnings.push('"primary" (cümledeki anlam) boş.');
      else if (meanings.length && !meanings.some((m) => normTr(m) === normTr(primary))) {
        warnings.push(`"primary" anlamlar arasında yok ("${primary}"); listeye eklenecek.`);
      }

      let base = Store.cleanBase(v.base);
      if (base.word && keyOf(base.word) === key) {
        warnings.push('"base" kelimenin kendisiydi; silindi.');
        base = { word: '', pos: '', meaning: '' };
      }
      const etymology = Store.cleanEty(v.etymology);
      if (etymology.root && keyOf(etymology.root) === key && !etymology.lang) {
        warnings.push('Köken olarak kelimenin kendisi yazılmış.');
      }

      // Hangi kayda ait? Önce anahtar, sonra metindeki hâl (held -> hold).
      const forms = [v.form, ...(Array.isArray(v.seen) ? v.seen.map((s) => s && s.form) : [])]
        .map((f) => keyOf(str(f)))
        .filter(Boolean);
      const free = (w) => !used.has(w.id);
      let target =
        selected.find((w) => free(w) && w.word === key) ||
        selected.find((w) => free(w) && (forms.includes(w.word) || w.seen.some((s) => forms.includes(s.form))));
      const owner = Store.findByWord(key);
      let action;
      if (target) {
        used.add(target.id);
        if (target.word === key) action = Store.isDraft(target) ? 'fill' : 'update';
        else if (owner && owner.id !== target.id) {
          action = 'merge';
          infos.push(`"${key}" zaten listende; "${target.word}" onunla birleşecek.`);
        } else {
          action = 'rename';
          infos.push(`"${target.word}" → "${key}"; "${target.word}" metindeki hâl olarak saklanır.`);
        }
      } else if (owner) {
        target = owner;
        action = 'other';
        warnings.push('Bu kelimeyi seçmemiştin; mevcut kaydın anlamları değişecek.');
      } else {
        action = 'new';
        infos.push('Listende yok; yeni kelime olarak eklenecek.');
      }

      // Başka kelimelerle ortak anlamlar: ayırt etmesi zor çiftler
      for (const m of meanings) {
        const k = normTr(m);
        const others = Store.all().filter(
          (w) => w !== target && w.word !== key && w.meanings.some((x) => normTr(x) === k)
        );
        if (others.length) infos.push(`"${m}" anlamı şunlarda da var: ${others.map((w) => w.word).join(', ')}`);
      }

      const seen = Store.cleanSeen(v.seen);
      if (forms.length && !seen.some((s) => s.form === forms[0])) seen.unshift({ form: forms[0] });

      items.push({
        key,
        targetId: target ? target.id : null,
        fromWord: target ? target.word : '',
        action,
        errors,
        warnings,
        infos,
        fields: errors.length ? null : { senses, primary, base, etymology, note: str(v.note), seen },
      });
    }

    const missing = selected.filter((w) => !used.has(w.id)).map((w) => w.word);
    return { items, missing };
  }

  return { buildPrompt, check, ACTIONS };
})();
