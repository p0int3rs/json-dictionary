'use strict';

(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const { normTr, keyOf, posLabel } = Store;

  /* ================= Tema ================= */

  const THEME_KEY = 'jsondictionary.theme';
  function applyTheme(t) {
    if (t) document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
  }
  try {
    applyTheme(localStorage.getItem(THEME_KEY));
  } catch {}
  $('#theme-btn').addEventListener('click', () => {
    const current =
      document.documentElement.dataset.theme ||
      (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    const next = current === 'light' ? 'dark' : 'light';
    applyTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {}
  });

  /* ================= Bildirim ve onay penceresi ================= */

  let toastTimer = null;
  function toast(msg, kind = 'info') {
    const el = $('#toast');
    el.textContent = msg;
    el.className = 'toast' + (kind === 'error' ? ' error' : '');
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), kind === 'error' ? 5000 : 3200);
  }

  // buttons: [{ label, value, kind }]. Esc ile kapatılırsa null döner.
  function ask({ title, html, buttons }) {
    const dlg = $('#dlg');
    $('#dlg-title').textContent = title;
    $('#dlg-body').innerHTML = html || '';
    const actions = $('#dlg-actions');
    actions.innerHTML = '';
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.className = 'btn ' + (b.kind ? 'btn-' + b.kind : '');
      btn.value = b.value;
      btn.textContent = b.label;
      actions.appendChild(btn);
    }
    dlg.returnValue = '';
    dlg.showModal();
    actions.lastElementChild?.focus();
    return new Promise((resolve) => {
      dlg.addEventListener('close', () => resolve(dlg.returnValue || null), { once: true });
    });
  }

  const isAbort = (err) => err && (err.name === 'AbortError' || err.name === 'NotAllowedError');

  /* ================= Ortak gösterim parçaları ================= */

  function highlight(text, form) {
    if (!form) return esc(text);
    // Kelimeyi ve çekimli hâllerini (ubiquitously, running…) vurgula
    const stem = form.length > 4 ? form.replace(/(e|y|ing|ed|s)$/i, '') : form;
    const parts = text.split(new RegExp(`(${reEsc(stem)}\\w*)`, 'gi'));
    return parts.map((p, i) => (i % 2 ? `<mark>${esc(p)}</mark>` : esc(p))).join('');
  }

  // Anlamlar, türlerine göre gruplu. Ana anlam vurgulanır.
  function sensesHtml(senses, primary, { skipEmpty = false } = {}) {
    const p = normTr(primary);
    return Object.entries(senses)
      .filter(([, list]) => list.length || !skipEmpty)
      .map(
        ([pos, list]) => `
        <div class="sense">
          <span class="pos pos-${esc(pos)}">${esc(posLabel(pos))}</span>
          <span class="chips">${
            list.length
              ? list
                  .map((m) =>
                    p && normTr(m) === p
                      ? `<span class="chip is-primary" title="Ana anlam: gördüğün cümledeki anlam">${esc(m)}</span>`
                      : `<span class="chip">${esc(m)}</span>`
                  )
                  .join('')
              : '<span class="muted small">bu türde anlam yok</span>'
          }</span>
        </div>`
      )
      .join('');
  }

  const baseText = (b) =>
    b.word || b.meaning ? [b.word, b.pos && `(${posLabel(b.pos)})`, b.meaning && `= ${b.meaning}`].filter(Boolean).join(' ') : '';
  const etyText = (e) =>
    e.root || e.meaning ? [e.root, e.lang && `(${e.lang})`, e.meaning && `= ${e.meaning}`].filter(Boolean).join(' ') : '';

  // Kök, köken ve not satırları
  function extrasHtml(x) {
    const base = baseText(x.base);
    const ety = etyText(x.etymology);
    return [
      base && `<div class="root-line">Türediği: <strong>${esc(base)}</strong></div>`,
      ety && `<div class="root-line">Köken: <strong>${esc(ety)}</strong></div>`,
      x.note && `<div class="note-line">${esc(x.note)}</div>`,
    ]
      .filter(Boolean)
      .join('');
  }

  function seenHtml(w, max = 2) {
    const withSentence = w.seen.filter((s) => s.sentence);
    const shown = withSentence.slice(0, max);
    const sources = [...new Set(w.seen.filter((s) => s.source && !s.sentence).map((s) => s.source))];
    return (
      shown
        .map(
          (s) =>
            `<p class="example">${highlight(s.sentence, s.form || w.word)}${
              s.source ? `<span class="example-src"> — ${esc(s.source)}</span>` : ''
            }</p>`
        )
        .join('') +
      (withSentence.length > max ? `<div class="meta">+${withSentence.length - max} cümle daha</div>` : '') +
      (sources.length ? `<div class="meta">Kaynak: ${esc(sources.join(', '))}</div>` : '')
    );
  }

  /* ================= Görünümler ================= */

  function showView(name) {
    $$('.tab').forEach((t) => {
      const on = t.dataset.view === name;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', String(on));
    });
    for (const v of ['today', 'words', 'game']) $(`#view-${v}`).hidden = name !== v;
    if (name === 'game' && !session) showSetup();
    if (name === 'today') renderToday();
    window.scrollTo(0, 0);
  }
  $$('.tab').forEach((t) => t.addEventListener('click', () => showView(t.dataset.view)));

  function renderStats() {
    const s = Store.stats();
    $('#stat-total').textContent = s.total;
    $('#stat-due').textContent = s.due;
    $('#stat-mastered').textContent = s.mastered;
    $('#stat-drafts').textContent = `${s.drafts} / ${s.review}`;
    $('#pending-text').innerHTML =
      s.drafts || s.review
        ? `<strong>${s.drafts}</strong> taslak ve <strong>${s.review}</strong> gözden geçirilecek kelime var. İstek metnini kopyala, YZ'ye yapıştır, cevabı geri yapıştır.`
        : 'Bekleyen taslak yok. Mevcut kelimeleri de seçip yeniden doldurtabilirsin.';
  }

  $('#stat-pending').addEventListener('click', () => showWordsWith({ status: 'pending' }));

  /* ================= Hızlı ekleme ================= */

  const quick = $('#quick-form');

  quick.addEventListener('submit', (e) => {
    e.preventDefault();
    const E = quick.elements;
    try {
      const res = Store.quickAdd({ form: E.form.value, sentence: E.sentence.value, source: E.source.value });
      if (res.duplicate) toast(`"${res.word.word}" bu cümleyle zaten kayıtlı`);
      else if (res.added) toast(`"${res.word.word}" taslak olarak eklendi`);
      else toast(`"${res.word.word}" kaydına yeni bağlam eklendi`);
      // Kaynak korunur: aynı metinden art arda kelime eklemek kolay olsun.
      E.form.value = '';
      E.sentence.value = '';
      $('#dup-hint').hidden = true;
      $('#quick-error').hidden = true;
      E.form.focus();
    } catch (err) {
      const el = $('#quick-error');
      el.textContent = err.message;
      el.hidden = false;
    }
  });

  quick.elements.sentence.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) quick.requestSubmit();
  });

  quick.elements.form.addEventListener('input', () => {
    const hint = $('#dup-hint');
    const value = quick.elements.form.value;
    const existing = Store.findByForm(value);
    if (existing) {
      const via = existing.word !== keyOf(value) ? ` ("${esc(keyOf(value))}" hâliyle)` : '';
      hint.innerHTML = `"${esc(existing.word)}" zaten listede${via}; cümleyi eklersen o kayda bağlam olarak eklenir. <button type="button" class="link" data-edit="${esc(existing.id)}">Düzenle</button>`;
      hint.hidden = false;
    } else {
      hint.hidden = true;
    }
    $('#quick-error').hidden = true;
  });
  $('#dup-hint').addEventListener('click', (e) => {
    const id = e.target.dataset?.edit;
    if (id) openEdit(id);
  });

  $('#manual-btn').addEventListener('click', () => openEdit(null, quick.elements.form.value));

  /* ================= Düzenleme penceresi ================= */

  const editDlg = $('#edit-dlg');
  const editForm = $('#edit-form');
  let editingId = null;

  function renderPrimaryOptions(selected) {
    const sel = editForm.elements.primary;
    const cur = normTr(selected ?? sel.value);
    const senses = Store.parseSensesText(editForm.elements.senses.value);
    const options = Object.entries(senses).flatMap(([p, list]) =>
      list.map(
        (m) => `<option value="${esc(m)}"${normTr(m) === cur ? ' selected' : ''}>${esc(m)} (${esc(posLabel(p))})</option>`
      )
    );
    sel.innerHTML = '<option value="">— seçilmedi —</option>' + options.join('');
  }

  function seenRowHtml(s = {}) {
    return `
      <div class="seen-row" data-date="${esc(s.date || '')}">
        <div class="seen-row-top">
          <input data-k="form" placeholder="metindeki hâli" value="${esc(s.form || '')}" spellcheck="false" aria-label="Metindeki hâli">
          <input data-k="source" placeholder="kaynak" value="${esc(s.source || '')}" aria-label="Kaynak">
          <button type="button" class="btn btn-ghost btn-sm btn-icon" data-remove aria-label="Bu bağlamı sil" title="Bu bağlamı sil">✕</button>
        </div>
        <textarea data-k="sentence" rows="2" placeholder="gördüğün cümle" aria-label="Cümle">${esc(s.sentence || '')}</textarea>
      </div>`;
  }

  const readSeen = () =>
    $$('#seen-rows .seen-row').map((r) => ({
      form: $('[data-k="form"]', r).value,
      source: $('[data-k="source"]', r).value,
      sentence: $('[data-k="sentence"]', r).value,
      date: r.dataset.date,
    }));

  function openEdit(id, prefillWord = '') {
    const w = id ? Store.get(id) : null;
    editingId = w ? w.id : null;
    const E = editForm.elements;
    $('#edit-title').textContent = w ? `"${w.word}" düzenle` : 'Yeni kelime (elle)';
    E.word.value = w ? w.word : keyOf(prefillWord);
    E.senses.value = w ? Store.sensesToText(w.senses) : '';
    renderPrimaryOptions(w ? w.primary : '');
    $('#seen-rows').innerHTML = (w && w.seen.length ? w.seen : [{}]).map(seenRowHtml).join('');
    E.base_word.value = w ? w.base.word : '';
    E.base_pos.value = w && w.base.pos ? posLabel(w.base.pos) : '';
    E.base_meaning.value = w ? w.base.meaning : '';
    E.ety_root.value = w ? w.etymology.root : '';
    E.ety_lang.value = w ? w.etymology.lang : '';
    E.ety_meaning.value = w ? w.etymology.meaning : '';
    E.note.value = w ? w.note : '';
    $('#base-details').open = Boolean(w && (w.base.word || w.base.meaning));
    $('#ety-details').open = Boolean(w && (w.etymology.root || w.etymology.meaning));

    const review = $('#edit-review');
    if (w && w.review.length) {
      review.innerHTML =
        '<strong>Gözden geçir</strong><ul>' +
        w.review.map((c) => `<li>${esc(Store.reviewInfo(c).text)}</li>`).join('') +
        '</ul><small>Kaydettiğinde bu işaretler kalkar.</small>';
      review.hidden = false;
    } else review.hidden = true;

    $('#edit-error').hidden = true;
    editDlg.showModal();
    (w && !Store.isDraft(w) ? E.senses : E.word.value ? E.senses : E.word).focus();
  }

  editForm.elements.senses.addEventListener('input', () => renderPrimaryOptions());
  $('#seen-add').addEventListener('click', () => {
    $('#seen-rows').insertAdjacentHTML('beforeend', seenRowHtml());
    $('#seen-rows .seen-row:last-child [data-k="form"]').focus();
  });
  $('#seen-rows').addEventListener('click', (e) => {
    if (e.target.closest('[data-remove]')) e.target.closest('.seen-row').remove();
  });
  $('#edit-cancel').addEventListener('click', () => editDlg.close());
  editForm.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      editForm.requestSubmit();
    }
  });

  editForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const E = editForm.elements;
    const fields = {
      word: E.word.value,
      senses: Store.parseSensesText(E.senses.value),
      primary: E.primary.value,
      seen: readSeen(),
      base: { word: E.base_word.value, pos: E.base_pos.value, meaning: E.base_meaning.value },
      etymology: { root: E.ety_root.value, lang: E.ety_lang.value, meaning: E.ety_meaning.value },
      note: E.note.value,
    };
    try {
      const old = editingId ? Store.get(editingId) : null;
      if (old && old.etymology.pos) fields.etymology.pos = old.etymology.pos;
      const w = Store.save(editingId, fields);
      editDlg.close();
      toast(old ? `"${w.word}" kaydedildi` : `"${w.word}" eklendi`);
    } catch (err) {
      const el = $('#edit-error');
      el.textContent = err.message;
      el.hidden = false;
    }
  });

  /* ================= Kelime listesi ================= */

  const searchEl = $('#search');
  const sortEl = $('#sort');
  const filterEl = $('#filter');

  function levelHtml(box) {
    const dots = Array.from({ length: Store.MAX_BOX }, (_, i) => `<i class="${i < box ? 'on' : ''}"></i>`).join('');
    const label = box >= Store.MAX_BOX ? 'öğrenildi' : `seviye ${box}`;
    return `<span class="level" title="Leitner kutusu ${box}/${Store.MAX_BOX}">${dots}<span class="level-label">${label}</span></span>`;
  }

  function reviewHtml(w) {
    if (!w.review.length) return '';
    const items = w.review.map((code) => {
      const r = Store.reviewInfo(code);
      const actions = r.lemma
        ? `<button class="link" data-action="lemma" data-to="${esc(r.lemma)}">"${esc(r.lemma)}" yap</button> · <button class="link" data-action="dismiss" data-code="${esc(code)}">böyle kalsın</button>`
        : `<button class="link" data-action="dismiss" data-code="${esc(code)}">tamam</button>`;
      return `<li>${esc(r.text)} <span class="review-actions">${actions}</span></li>`;
    });
    return `<ul class="review-list">${items.join('')}</ul>`;
  }

  function cardHtml(w) {
    const draft = Store.isDraft(w);
    const forms = [...new Set(w.seen.map((s) => s.form).filter((f) => f && f !== w.word))];
    return `
      <article class="card${draft ? ' is-draft' : ''}" data-id="${esc(w.id)}">
        <div class="card-head">
          <div class="card-word">${esc(w.word)}</div>
          <div class="card-badges">
            ${draft ? '<span class="badge badge-draft">taslak</span>' : ''}
            ${w.review.length ? '<span class="badge badge-warn">gözden geçir</span>' : ''}
          </div>
        </div>
        ${forms.length ? `<div class="meta">Metindeki hâli: ${esc(forms.join(', '))}</div>` : ''}
        ${draft ? '<p class="muted small draft-text">Anlamı yok. "YZ ile doldur" ile tamamla ya da düzenle.</p>' : `<div class="senses">${sensesHtml(w.senses, w.primary)}</div>`}
        ${seenHtml(w)}
        ${extrasHtml(w)}
        ${reviewHtml(w)}
        <div class="card-foot">
          <div>
            ${draft ? '' : levelHtml(w.box)}
            ${w.correct || w.wrong ? `<div class="meta">${w.correct} doğru · ${w.wrong} yanlış</div>` : ''}
          </div>
          <div class="card-actions">
            <button class="btn btn-sm" data-action="edit">Düzenle</button>
            <button class="btn btn-sm btn-danger" data-action="delete" aria-label="${esc(w.word)} sil">Sil</button>
          </div>
        </div>
      </article>`;
  }

  const searchText = (w) =>
    [
      w.word,
      ...w.meanings,
      ...w.seen.flatMap((s) => [s.form, s.sentence, s.source]),
      w.base.word,
      w.base.meaning,
      w.etymology.root,
      w.etymology.meaning,
      w.note,
    ]
      .map(normTr)
      .join('\n');

  const FILTERS = {
    all: () => true,
    draft: (w) => Store.isDraft(w),
    review: (w) => w.review.length > 0,
    pending: (w) => Store.isDraft(w) || w.review.length > 0,
    ready: (w) => !Store.isDraft(w) && !w.review.length,
  };

  const posFilterEl = $('#pos-filter');
  const levelFilterEl = $('#level-filter');
  const dateFilterEl = $('#date-filter');

  const LEVELS = {
    due: (w) => !Store.isDraft(w) && w.due <= Date.now(),
    new: (w) => !Store.isDraft(w) && !w.correct && !w.wrong,
    weak: (w) => !Store.isDraft(w) && (w.correct || w.wrong) && w.box <= 2,
    mid: (w) => w.box >= 3 && w.box < Store.MAX_BOX,
    mastered: (w) => w.box >= Store.MAX_BOX,
  };

  const DAY = 24 * 60 * 60 * 1000;
  const startOfToday = () => new Date().setHours(0, 0, 0, 0);
  // "Son n gün": bugün dahil n takvim günü
  const sinceDays = (n) => startOfToday() - (n - 1) * DAY;

  function filteredWords() {
    const q = normTr(searchEl.value);
    let list = Store.all().filter(FILTERS[filterEl.value] || FILTERS.all);
    const pos = posFilterEl.value;
    if (pos) list = list.filter((w) => (w.senses[pos] || []).length > 0);
    const level = LEVELS[levelFilterEl.value];
    if (level) list = list.filter(level);
    const days = Number(dateFilterEl.value);
    if (days) list = list.filter((w) => w.createdAt >= sinceDays(days));
    if (q) list = list.filter((w) => searchText(w).includes(q));
    const sorted = list.slice();
    switch (sortEl.value) {
      case 'az':
        sorted.sort((a, b) => a.word.localeCompare(b.word, 'en'));
        break;
      case 'weak':
        sorted.sort((a, b) => a.box - b.box || b.wrong - a.wrong || a.word.localeCompare(b.word, 'en'));
        break;
      default:
        sorted.sort((a, b) => b.createdAt - a.createdAt);
    }
    return sorted;
  }

  const filterEls = () => [filterEl, posFilterEl, levelFilterEl, dateFilterEl];
  const filtersActive = () =>
    filterEl.value !== 'all' || posFilterEl.value || levelFilterEl.value || dateFilterEl.value || searchEl.value;

  // Kelimeler görünümünü belirli süzgeçlerle aç (Bugün ekranından ve özet kutusundan).
  function showWordsWith({ status = 'all', pos = '', level = '', days = '', search = '' } = {}) {
    filterEl.value = status;
    posFilterEl.value = pos;
    levelFilterEl.value = level;
    dateFilterEl.value = days;
    searchEl.value = search;
    showView('words');
    renderList();
  }

  function renderList() {
    const total = Store.all().length;
    const list = filteredWords();
    $('#clear-filters').hidden = !filtersActive();
    $('#word-grid').innerHTML = list.map(cardHtml).join('');
    $('#empty-state').hidden = total > 0;
    $('#list-count').textContent = total ? (list.length === total ? `${total} kelime` : `${list.length} / ${total}`) : '';
    if (total > 0 && list.length === 0) {
      $('#word-grid').innerHTML = `<p class="muted">Bu süzgeçle eşleşen kelime yok.</p>`;
    }
  }

  searchEl.addEventListener('input', renderList);
  sortEl.addEventListener('change', renderList);
  filterEls().forEach((el) => el.addEventListener('change', renderList));
  $('#clear-filters').addEventListener('click', () => showWordsWith());

  $('#word-grid').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const id = btn.closest('.card').dataset.id;
    const w = Store.get(id);
    if (!w) return;
    switch (btn.dataset.action) {
      case 'edit':
        openEdit(id);
        break;
      case 'lemma': {
        const target = btn.dataset.to;
        const exists = Store.findByWord(target);
        const res = Store.rename(id, target);
        toast(exists ? `"${w.word}", "${res.word}" kaydıyla birleştirildi` : `"${target}" olarak kaydedildi`);
        break;
      }
      case 'dismiss':
        Store.dismissReview(id, btn.dataset.code);
        break;
      case 'delete': {
        const res = await ask({
          title: `"${w.word}" silinsin mi?`,
          html: '<p>Kelime ve ilerleme bilgisi kalıcı olarak silinir.</p>',
          buttons: [
            { label: 'Vazgeç', value: 'cancel', kind: 'ghost' },
            { label: 'Sil', value: 'delete', kind: 'danger' },
          ],
        });
        if (res === 'delete') {
          Store.remove(id);
          toast(`"${w.word}" silindi`);
        }
        break;
      }
    }
  });

  /* ================= YZ ile doldurma ================= */

  const aiDlg = $('#ai-dlg');
  let aiSelected = new Set();
  let aiResult = null;

  function aiStep(n) {
    $('#ai-step1').hidden = n !== 1;
    $('#ai-step2').hidden = n !== 2;
  }

  function openAI() {
    const pending = Store.all().filter((w) => Store.isDraft(w));
    aiSelected = new Set(pending.map((w) => w.id));
    $('#ai-filter').value = '';
    $('#ai-answer').value = '';
    $('#ai-error').hidden = true;
    aiStep(1);
    renderAIPick();
    updatePrompt();
    aiDlg.showModal();
  }
  $('#ai-btn').addEventListener('click', openAI);
  $('#ai-close').addEventListener('click', () => aiDlg.close());

  const aiRank = (w) => (Store.isDraft(w) ? 0 : w.review.length ? 1 : 2);

  function renderAIPick() {
    const q = normTr($('#ai-filter').value);
    const list = Store.all()
      .filter((w) => !q || w.word.includes(q))
      .sort((a, b) => aiRank(a) - aiRank(b) || a.word.localeCompare(b.word, 'en'));
    $('#ai-pick').innerHTML =
      list
        .map(
          (w) => `
          <label class="ai-pick-item">
            <input type="checkbox" value="${esc(w.id)}"${aiSelected.has(w.id) ? ' checked' : ''}>
            <span class="ai-pick-word">${esc(w.word)}</span>
            ${Store.isDraft(w) ? '<span class="badge badge-draft">taslak</span>' : ''}
            ${w.review.length ? '<span class="badge badge-warn">gözden geçir</span>' : ''}
            ${w.seen.some((s) => s.sentence) ? '' : '<span class="muted small">cümle yok</span>'}
          </label>`
        )
        .join('') || '<p class="muted small">Kelime yok.</p>';
  }

  const aiWords = () => Store.all().filter((w) => aiSelected.has(w.id));

  function updatePrompt() {
    const words = aiWords();
    $('#ai-sel-count').textContent = words.length ? `${words.length} kelime seçili` : 'Kelime seçilmedi';
    $('#ai-prompt').value = words.length ? AI.buildPrompt(words) : '';
    $('#ai-copy').disabled = !words.length;
  }

  $('#ai-filter').addEventListener('input', renderAIPick);
  $('#ai-pick').addEventListener('change', (e) => {
    if (e.target.type !== 'checkbox') return;
    if (e.target.checked) aiSelected.add(e.target.value);
    else aiSelected.delete(e.target.value);
    updatePrompt();
  });
  $$('[data-pick]').forEach((b) =>
    b.addEventListener('click', () => {
      const kind = b.dataset.pick;
      if (kind === 'none') aiSelected.clear();
      else {
        const match = kind === 'drafts' ? Store.isDraft : (w) => w.review.length > 0;
        Store.all().filter(match).forEach((w) => aiSelected.add(w.id));
      }
      renderAIPick();
      updatePrompt();
    })
  );

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Panoya erişim yoksa metni seçip eski yöntemle kopyala.
      $('#ai-prompt-details').open = true;
      const ta = $('#ai-prompt');
      ta.focus();
      ta.select();
      try {
        return document.execCommand('copy');
      } catch {
        return false;
      }
    }
  }

  $('#ai-copy').addEventListener('click', async () => {
    const ok = await copyText($('#ai-prompt').value);
    if (ok) toast('İstek kopyalandı. YZ\'ye yapıştır, cevabını aşağıya yapıştır.');
    else toast('Kopyalanamadı; "İstek metnini göster" bölümünden elle kopyala.', 'error');
    if (ok) $('#ai-answer').focus();
  });

  const ACTION_KIND = { fill: 'ok', update: 'ok', rename: 'ok', merge: 'warn', other: 'warn', new: 'info' };

  function aiItemHtml(it, i) {
    const f = it.fields;
    const blocked = it.errors.length > 0;
    const lint = [
      ...it.errors.map((t) => `<li class="lint-error">${esc(t)}</li>`),
      ...it.warnings.map((t) => `<li class="lint-warn">${esc(t)}</li>`),
      ...it.infos.map((t) => `<li class="lint-info">${esc(t)}</li>`),
    ].join('');
    return `
      <div class="ai-item${blocked ? ' has-error' : ''}">
        <label class="ai-item-head">
          <input type="checkbox" data-i="${i}"${blocked ? ' disabled' : ' checked'}>
          <strong>${esc(it.key)}</strong>
          ${it.fromWord && it.fromWord !== it.key ? `<span class="muted">← ${esc(it.fromWord)}</span>` : ''}
          <span class="badge badge-${ACTION_KIND[it.action] || 'info'}">${esc(AI.ACTIONS[it.action] || it.action)}</span>
        </label>
        ${f ? `<div class="senses">${sensesHtml(f.senses, f.primary)}</div>${extrasHtml(f)}` : ''}
        ${lint ? `<ul class="lint">${lint}</ul>` : ''}
      </div>`;
  }

  $('#ai-check').addEventListener('click', () => {
    const errEl = $('#ai-error');
    try {
      aiResult = AI.check($('#ai-answer').value, aiWords());
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
      return;
    }
    errEl.hidden = true;
    const { items, missing } = aiResult;
    const warned = items.filter((it) => it.warnings.length).length;
    $('#ai-summary').innerHTML =
      `${items.length} kayıt okundu${warned ? `, ${warned} tanesinde uyarı var` : ''}. Kaydetmek istemediklerinin işaretini kaldır.` +
      (missing.length ? `<br><span class="text-warn">YZ şu kelimeleri döndürmedi: ${esc(missing.join(', '))}</span>` : '');
    $('#ai-preview').innerHTML = items.map(aiItemHtml).join('') || '<p class="muted">Cevapta kayıt yok.</p>';
    updateApplyBtn();
    aiStep(2);
  });

  function updateApplyBtn() {
    const n = $$('#ai-preview input[data-i]:checked').length;
    $('#ai-apply').disabled = n === 0;
    $('#ai-apply').textContent = n ? `${n} kelimeyi kaydet` : 'Seçilenleri kaydet';
  }
  $('#ai-preview').addEventListener('change', updateApplyBtn);
  $('#ai-back').addEventListener('click', () => aiStep(1));

  $('#ai-apply').addEventListener('click', () => {
    const chosen = $$('#ai-preview input[data-i]:checked')
      .map((el) => aiResult.items[Number(el.dataset.i)])
      .filter((it) => it && it.fields);
    if (!chosen.length) return;
    const n = Store.applyAI(chosen.map((it) => ({ targetId: it.targetId, key: it.key, fields: it.fields })));
    aiDlg.close();
    toast(`${n} kelime kaydedildi`);
  });

  /* ================= Oyun ================= */

  let session = null;

  const gameMode = () => $('input[name="mode"]:checked').value;

  function showSetup() {
    session = null;
    $('#game-setup').hidden = false;
    $('#game-play').hidden = true;
    $('#game-summary').hidden = true;
    renderSetupInfo();
  }

  // Mod için uygun kelime yoksa nedenini açıkla.
  const EMPTY_MODE = {
    cloze: 'Bu mod, cümlesi kaydedilmiş kelimelerle oynanır. Hızlı ekle ile kelimeyi gördüğün cümleyle birlikte kaydet.',
    confuse: 'Bu mod, aynı Türkçe anlamı paylaşan kelimelerle oynanır; şu an böyle bir çift yok.',
    root: 'Bu mod, kökü ya da türediği kelimesi girilmiş kelimelerle oynanır.',
  };

  function renderSetupInfo() {
    const all = Store.all();
    const mode = gameMode();
    const playable = Quiz.playable(all);
    const pool = Quiz.eligible(all, mode);
    const drafts = all.length - playable.length;
    const due = pool.filter((w) => w.due <= Date.now()).length;
    const info = $('#setup-info');
    const start = $('#start-btn');
    const minOthers = mode === 'card' ? 0 : 1;
    if (pool.length === 0 || playable.length < 1 + minOthers) {
      info.textContent =
        pool.length === 0 && EMPTY_MODE[mode]
          ? EMPTY_MODE[mode]
          : 'Oynamak için anlamı girilmiş en az 2 kelime gerekli (4+ önerilir).';
      start.disabled = true;
    } else {
      info.textContent =
        `${pool.length} kelime bu modda oynanabilir, ${due} tanesinin tekrar zamanı gelmiş.` +
        (drafts ? ` ${drafts} taslak, doldurulana kadar sorulmaz.` : '');
      start.disabled = false;
    }
  }
  $$('input[name="mode"]').forEach((r) => r.addEventListener('change', renderSetupInfo));

  function startGame(onlyWords) {
    const all = Store.all();
    const mode = gameMode();
    const countVal = $('#q-count').value;
    const count = countVal === 'all' ? Infinity : Number(countVal);
    const words = onlyWords
      ? Quiz.shuffle(Quiz.eligible(onlyWords, mode))
      : Quiz.pickWords(all, count, $('#q-strategy').value, mode);
    const questions = words.map((w) => Quiz.buildQuestion(w, all, mode)).filter(Boolean);
    if (questions.length === 0) {
      toast('Bu modda soru üretilemedi.', 'error');
      return;
    }
    session = { mode, questions, i: 0, score: 0, results: [], answered: false, flipped: false };
    $('#game-setup').hidden = true;
    $('#game-summary').hidden = true;
    $('#game-play').hidden = false;
    renderQuestion();
  }

  const KBD_HINTS = {
    choice: 'Kısayollar: <kbd>1</kbd>–<kbd>4</kbd> şık seçer, <kbd>Enter</kbd> devam eder.',
    type: 'Kısayollar: <kbd>Enter</kbd> kontrol eder, sonra devam eder.',
    card: 'Kısayollar: <kbd>Boşluk</kbd> kartı çevirir, <kbd>1</kbd> bilemedim, <kbd>2</kbd> bildim.',
  };

  function renderPrompt(q, revealed) {
    const el = $('#q-prompt');
    el.classList.toggle('is-sentence', q.mode === 'cloze');
    if (q.mode === 'cloze') {
      const c = q.cloze;
      el.innerHTML =
        esc(c.before) +
        (revealed ? `<mark>${esc(c.hidden)}</mark>` : '<span class="blank" aria-label="boşluk">_____</span>') +
        esc(c.after);
    } else {
      el.textContent = q.prompt;
    }
  }

  function renderQuestion() {
    const s = session;
    const q = s.questions[s.i];
    s.answered = false;
    s.flipped = false;
    $('#q-progress').textContent = `Soru ${s.i + 1} / ${s.questions.length}`;
    $('#q-bar').style.width = `${(s.i / s.questions.length) * 100}%`;
    $('#q-score').textContent = `${s.score} doğru`;
    $('#q-label').textContent = q.label;
    renderPrompt(q, false);
    $('#q-hint').textContent = q.hint || '';
    const ctx = $('#q-context');
    ctx.hidden = !q.context;
    ctx.innerHTML = q.context
      ? `<p class="example">${highlight(q.context.sentence, q.context.form)}${
          q.context.source ? `<span class="example-src"> — ${esc(q.context.source)}</span>` : ''
        }</p>`
      : '';
    $('#feedback').hidden = true;
    $('.kbd-hint').innerHTML = KBD_HINTS[q.kind];

    const choicesEl = $('#choices');
    const typeForm = $('#type-form');
    choicesEl.hidden = q.kind !== 'choice';
    typeForm.hidden = q.kind !== 'type';
    $('#card-bar').hidden = q.kind !== 'card';

    if (q.kind === 'choice') {
      choicesEl.innerHTML = q.choices
        .map(
          (c, i) =>
            `<button class="choice" data-index="${i}"><span class="key">${i + 1}</span><span>${esc(c.text)}</span></button>`
        )
        .join('');
    } else if (q.kind === 'type') {
      const input = $('#type-input');
      input.value = '';
      input.disabled = false;
      input.className = '';
      $$('#type-form button').forEach((b) => (b.disabled = false));
      input.focus();
    } else {
      $('#flip-btn').focus();
    }
  }

  function answerChoice(index) {
    const s = session;
    if (!s || s.answered) return;
    const q = s.questions[s.i];
    if (q.kind !== 'choice') return;
    const chosen = q.choices[index];
    if (!chosen) return;
    $$('#choices .choice').forEach((b, i) => {
      b.disabled = true;
      if (q.choices[i].correct) b.classList.add('is-correct');
      else if (i === index) b.classList.add('is-wrong');
      else b.classList.add('is-dim');
    });
    finishAnswer(chosen.correct);
  }

  function answerTyped(giveUp) {
    const s = session;
    if (!s || s.answered) return;
    const q = s.questions[s.i];
    const input = $('#type-input');
    if (!giveUp && !input.value.trim()) return;
    const res = giveUp ? { correct: false } : Quiz.checkTyped(q, input.value);
    input.disabled = true;
    input.className = res.correct ? 'is-correct' : 'is-wrong';
    $$('#type-form button').forEach((b) => (b.disabled = true));
    let note = '';
    if (res.typo) note = `Küçük bir yazım hatası var, doğrusu: <strong>${esc(res.expected)}</strong>`;
    else if (res.correct && q.accepted.length > 1)
      note = `Bu anlama gelen diğer kelimeler: ${q.accepted.filter((a) => a !== keyOf(input.value)).map(esc).join(', ')}`;
    finishAnswer(res.correct, note);
  }

  // Kart modu: önce çevir, sonra kendini puanla.
  function flipCard() {
    const s = session;
    if (!s || s.answered || s.flipped) return;
    const q = s.questions[s.i];
    if (q.kind !== 'card') return;
    s.flipped = true;
    $('#card-bar').hidden = true;
    showFeedback(null, q);
  }

  function gradeCard(knew) {
    const s = session;
    if (!s || s.answered || !s.flipped) return;
    s.answered = true;
    record(knew);
    nextQuestion();
  }

  function record(correct) {
    const s = session;
    const q = s.questions[s.i];
    if (correct) s.score += 1;
    s.results.push({ word: q.target, correct });
    Store.recordAnswer(q.target.id, correct);
    $('#q-score').textContent = `${s.score} doğru`;
    $('#q-bar').style.width = `${((s.i + 1) / s.questions.length) * 100}%`;
  }

  // Doğru da olsa otomatik geçilmez: bilgileri okuyup Enter ya da "Devam" ile geçersin.
  function finishAnswer(correct, note = '') {
    const s = session;
    const q = s.questions[s.i];
    s.answered = true;
    record(correct);
    if (q.mode === 'cloze') renderPrompt(q, true);
    showFeedback(correct, q, note);
  }

  function relatedHtml(q) {
    if (!q.related || !q.related.length) return '';
    return `
      <div class="related">
        <div class="related-title">${esc(q.relatedTitle)}</div>
        ${q.related
          .map(
            (o) => `
            <div class="related-item">
              <strong>${esc(o.word)}</strong>
              <span class="muted">${esc(o.meanings.join(', '))}</span>
              ${o.note ? `<div class="note-line">${esc(o.note)}</div>` : ''}
            </div>`
          )
          .join('')}
      </div>`;
  }

  // correct: true | false | null (kart modunda çevrilmiş kart)
  function showFeedback(correct, q, note = '') {
    const w = q.target;
    const fb = $('#feedback');
    const isCard = correct === null;
    fb.className = 'feedback ' + (isCard ? 'neutral' : correct ? 'ok' : 'bad');
    const last = session.i + 1 >= session.questions.length;
    const actions = isCard
      ? `<div class="grade-row">
           <button class="btn btn-danger" id="grade-no"><span class="key">1</span> Bilemedim</button>
           <button class="btn btn-primary" id="grade-yes"><span class="key">2</span> Bildim</button>
         </div>`
      : `<button class="btn btn-primary" id="next-btn">${last ? 'Sonuçlar' : 'Devam'} ↵</button>`;
    fb.innerHTML = `
      ${isCard ? '' : `<div class="feedback-title">${correct ? 'Doğru!' : 'Yanlış'}</div>`}
      ${note ? `<div class="small">${note}</div>` : ''}
      <div class="feedback-row">
        <div class="feedback-body">
          <div><strong>${esc(w.word)}</strong></div>
          <div class="senses">${sensesHtml(w.senses, w.primary, { skipEmpty: true })}</div>
          ${q.mode === 'cloze' || q.mode === 'card' ? '' : seenHtml(w, 1)}
          ${extrasHtml(w)}
          ${relatedHtml(q)}
        </div>
        ${actions}
      </div>`;
    fb.hidden = false;
    if (isCard) {
      $('#grade-no').addEventListener('click', () => gradeCard(false));
      $('#grade-yes').addEventListener('click', () => gradeCard(true));
      $('#grade-yes').focus();
    } else {
      $('#next-btn').addEventListener('click', nextQuestion);
      $('#next-btn').focus();
    }
  }

  function nextQuestion() {
    const s = session;
    if (!s || !s.answered) return;
    s.i += 1;
    if (s.i >= s.questions.length) showSummary();
    else renderQuestion();
  }

  function showSummary() {
    const s = session;
    const answered = s.results.length;
    if (answered === 0) {
      showSetup();
      return;
    }
    const missed = s.results.filter((r) => !r.correct).map((r) => r.word);
    const pct = Math.round((s.score / answered) * 100);
    const el = $('#game-summary');
    el.innerHTML = `
      <h2>Oyun bitti</h2>
      <div class="summary-score">${s.score} / ${answered}</div>
      <p class="summary-sub">%${pct} başarı${missed.length ? ` · ${missed.length} kelimeyi tekrar etmelisin` : ' · Hepsini bildin!'}</p>
      ${
        missed.length
          ? `<h4>Yanlış yaptıkların</h4><div class="miss-list">${missed
              .map((w) => `<div class="miss"><strong>${esc(w.word)}</strong>${esc(w.primary || w.meanings.join(', '))}</div>`)
              .join('')}</div>`
          : ''
      }
      <div class="btn-row">
        ${missed.length ? '<button class="btn btn-primary" id="retry-missed">Yanlışları tekrar et</button>' : ''}
        <button class="btn ${missed.length ? '' : 'btn-primary'}" id="play-again">Yeni oyun</button>
        <button class="btn btn-ghost" id="to-setup">Ayarlar</button>
      </div>`;
    $('#game-play').hidden = true;
    el.hidden = false;
    const missedWords = missed.map((w) => Store.get(w.id)).filter(Boolean);
    session = { ...s, finished: true };
    $('#retry-missed')?.addEventListener('click', () => startGame(missedWords));
    $('#play-again').addEventListener('click', () => startGame());
    $('#to-setup').addEventListener('click', showSetup);
    ($('#retry-missed') || $('#play-again')).focus();
  }

  $('#start-btn').addEventListener('click', () => startGame());
  $('#quit-btn').addEventListener('click', () => {
    if (session && !session.answered && session.results.length === 0) showSetup();
    else showSummary();
  });
  $('#choices').addEventListener('click', (e) => {
    const btn = e.target.closest('.choice');
    if (btn) answerChoice(Number(btn.dataset.index));
  });
  $('#type-form').addEventListener('submit', (e) => {
    e.preventDefault();
    answerTyped(false);
  });
  $('#dont-know').addEventListener('click', () => answerTyped(true));
  $('#flip-btn').addEventListener('click', flipCard);

  document.addEventListener('keydown', (e) => {
    if ($('#view-game').hidden || $('#game-play').hidden || !session || session.finished) return;
    if (document.querySelector('dialog[open]')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const q = session.questions[session.i];
    if (q.kind === 'card' && !session.answered) {
      if (!session.flipped && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        flipCard();
      } else if (session.flipped && (e.key === '1' || e.key === '2')) {
        e.preventDefault();
        gradeCard(e.key === '2');
      } else if (session.flipped && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault(); // odaktaki puan butonuna yanlışlıkla basılmasın
      }
      return;
    }
    if (session.answered && e.key === 'Enter') {
      e.preventDefault(); // odaktaki "Devam" butonunun ikinci kez tetiklenmesini önler
      nextQuestion();
      return;
    }
    if (!session.answered && q.kind === 'choice' && /^[1-9]$/.test(e.key)) {
      answerChoice(Number(e.key) - 1);
    }
  });

  /* ================= Veri: içe/dışa aktarma ve dosya ================= */

  const FS = Store.FileSync;
  const dataDlg = $('#data-dlg');
  const fileInput = $('#file-input');

  function renderDataStatus() {
    const n = Store.all().length;
    let text = `${n} kelime bu tarayıcıda saklanıyor.`;
    if (FS.status === 'connected') text += ` Bağlı dosya: ${FS.fileName} (otomatik kaydediliyor).`;
    else if (FS.status === 'needs-permission') text += ` ${FS.fileName} dosyasına yeniden bağlanman gerekiyor.`;
    else if (FS.status === 'error') text += ` ${FS.fileName} dosyasına yazılamadı.`;
    $('#data-status').textContent = text;
    $('#fs-section').hidden = !FS.supported;
    $('#fs-unsupported').hidden = FS.supported;
    $('#unbind-btn').hidden = FS.status === 'none';
    $('#reconnect-btn').hidden = !(FS.status === 'needs-permission' || FS.status === 'error');
    $('#reconnect-btn').textContent = `${FS.fileName || 'Dosyaya'} yeniden bağlan`;
  }
  FS.onStatus(renderDataStatus);

  $('#data-btn').addEventListener('click', () => {
    renderDataStatus();
    dataDlg.showModal();
  });

  function download(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const today = () => new Date().toISOString().slice(0, 10);

  $('#export-btn').addEventListener('click', () => download(`kelimeler-${today()}.json`, Store.exportWords()));
  $('#progress-export-btn').addEventListener('click', () =>
    download(`ilerleme-${today()}.json`, Store.exportProgress())
  );

  // Gelen kelimeler mevcut listeyle nasıl birleşsin?
  async function chooseImportMode(incoming, sourceLabel) {
    if (Store.all().length === 0) return 'replace';
    return ask({
      title: 'Kelimeler nasıl eklensin?',
      html: `<p>${esc(sourceLabel)}: <strong>${incoming}</strong> kelime. Tarayıcıda: <strong>${Store.all().length}</strong> kelime.</p>
             <p><strong>Birleştir</strong>: yeni kelimeler eklenir, aynı kelimelerin anlamları ve bağlamları birleşir, ilerlemen korunur.<br>
             <strong>Değiştir</strong>: tarayıcıdaki liste tamamen silinip dosyadaki yüklenir.</p>`,
      buttons: [
        { label: 'Vazgeç', value: 'cancel', kind: 'ghost' },
        { label: 'Değiştir', value: 'replace' },
        { label: 'Birleştir', value: 'merge', kind: 'primary' },
      ],
    });
  }

  // Eski biçimden dönüştürme sonucu için kısa açıklama
  const legacyNote = (parsed) =>
    parsed.legacy
      ? ` · ${parsed.legacy} kelime eski biçimden dönüştürüldü${parsed.flagged ? `, ${parsed.flagged} tanesi gözden geçirilmeli` : ''}`
      : '';

  // Bağlı dosya eski biçimdeyse üzerine yeni biçimde yazmadan önce sor ve yedeğini indir.
  async function confirmLegacyFile(parsed) {
    if (!parsed.legacy) return true;
    const backupName = FS.fileName.replace(/\.json$/i, '') + '-eski-bicim-yedek.json';
    const res = await ask({
      title: 'Dosya eski biçimde',
      html: `<p><strong>${esc(FS.fileName)}</strong> eski biçimde (<code>type</code>, <code>meaning</code>, <code>root</code>…). Bağlı kalırsa yeni biçimde yazılır.</p>
             <p>Devam edersen önce dosyanın bugünkü hâli <code>${esc(backupName)}</code> olarak indirilir.</p>`,
      buttons: [
        { label: 'Vazgeç', value: 'cancel', kind: 'ghost' },
        { label: 'Yedeği indir ve dönüştür', value: 'convert', kind: 'primary' },
      ],
    });
    if (res !== 'convert') return false;
    download(backupName, parsed.text);
    return true;
  }

  let filePurpose = 'words'; // words | progress
  const openFile = (purpose) => {
    filePurpose = purpose;
    fileInput.value = '';
    fileInput.click();
  };
  $('#import-btn').addEventListener('click', () => openFile('words'));
  $('#empty-import').addEventListener('click', () => openFile('words'));
  $('#progress-import-btn').addEventListener('click', () => openFile('progress'));

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    try {
      if (filePurpose === 'progress') {
        const n = Store.importProgress(await file.text());
        dataDlg.close();
        toast(`${n} kelimenin ilerlemesi geri yüklendi`);
        return;
      }
      const parsed = Store.parse(await file.text());
      if (parsed.words.length === 0) throw new Error('Dosyada kelime bulunamadı.');
      const mode = await chooseImportMode(parsed.words.length, file.name);
      if (mode !== 'merge' && mode !== 'replace') return;
      Store.importWords(parsed.words, mode);
      dataDlg.close();
      toast(`${parsed.words.length} kelime içe aktarıldı${legacyNote(parsed)}`);
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  $('#bind-open-btn').addEventListener('click', async () => {
    try {
      const parsed = await FS.pickExisting();
      if (!(await confirmLegacyFile(parsed))) return FS.abandonPick();
      const mode = await chooseImportMode(parsed.words.length, FS.fileName);
      if (mode === 'replace') Store.replaceFromFile(parsed.words, parsed.lastModified);
      else if (mode === 'merge') Store.importWords(parsed.words, 'merge');
      else return FS.abandonPick();
      await FS.confirmBinding();
      toast(`${FS.fileName} bağlandı${legacyNote(parsed)}`);
    } catch (err) {
      FS.abandonPick();
      if (!isAbort(err)) toast(err.message, 'error');
    }
  });

  $('#bind-new-btn').addEventListener('click', async () => {
    try {
      await FS.createNew();
      toast(`${FS.fileName} oluşturuldu, değişiklikler otomatik kaydedilecek`);
    } catch (err) {
      if (!isAbort(err)) toast(err.message, 'error');
    }
  });

  $('#unbind-btn').addEventListener('click', async () => {
    await FS.disconnect();
    toast('Dosya bağlantısı kesildi; veriler tarayıcıda kalmaya devam ediyor');
  });

  // Dosya ile tarayıcıdaki veriyi eşitle: içerik farklıysa hangisi daha yeni değiştiyse o kazanır.
  async function reconcile(parsed) {
    if (parsed.legacy) {
      if (!(await confirmLegacyFile(parsed))) {
        await FS.disconnect();
        toast('Bağlantı kesildi; dosyaya dokunulmadı');
        return;
      }
      if (parsed.lastModified > Store.savedAt) Store.replaceFromFile(parsed.words, parsed.lastModified);
      await FS.writeNow();
      toast(`${FS.fileName} yeni biçime dönüştürüldü${legacyNote(parsed)}`);
      return;
    }
    if (Store.exportWords(parsed.words) === Store.exportWords()) return;
    if (parsed.lastModified > Store.savedAt) {
      Store.replaceFromFile(parsed.words, parsed.lastModified);
      toast(`${FS.fileName} dosyasından ${parsed.words.length} kelime yüklendi`);
    } else {
      await FS.writeNow();
      toast(`${FS.fileName} güncellendi`);
    }
  }

  $('#reconnect-btn').addEventListener('click', async () => {
    try {
      const parsed = await FS.reconnect();
      if (parsed) await reconcile(parsed);
    } catch (err) {
      if (!isAbort(err)) toast(err.message, 'error');
    }
  });

  /* ================= Bugün ================= */

  const MODE_KEY = 'jsondictionary.mode';
  function setMode(mode) {
    const radio = $(`input[name="mode"][value="${mode}"]`);
    if (!radio) return;
    radio.checked = true;
    $('#today-mode').value = mode;
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {}
  }
  try {
    setMode(localStorage.getItem(MODE_KEY) || 'en-tr');
  } catch {}
  $$('input[name="mode"]').forEach((r) => r.addEventListener('change', () => setMode(r.value)));
  $('#today-mode').addEventListener('change', (e) => {
    setMode(e.target.value);
    renderToday();
  });

  const miniItem = (w, extra = '') => `
    <button type="button" class="mini-item" data-word="${esc(w.word)}">
      <strong>${esc(w.word)}</strong>
      <span class="muted">${Store.isDraft(w) ? 'taslak' : esc(w.primary || w.meanings.slice(0, 3).join(', '))}</span>
      ${extra}
    </button>`;

  // Bugün çalışılacak kelimeler: tekrar zamanı gelenler (en fazla 20), yoksa 10 kelimelik serbest tekrar.
  function todayPlan() {
    const all = Store.all();
    const mode = $('#today-mode').value;
    const pool = Quiz.eligible(all, mode);
    const due = pool.filter((w) => w.due <= Date.now());
    if (due.length) return { free: false, due: due.length, words: Quiz.pickWords(due, 20, 'smart', mode) };
    return { free: true, due: 0, words: Quiz.pickWords(all, 10, 'smart', mode) };
  }

  function renderToday() {
    if ($('#view-today').hidden) return;
    const all = Store.all();
    const s = Store.stats();
    const today = startOfToday();
    $('#today-date').textContent = new Date().toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });

    const plan = todayPlan();
    $('#today-due').textContent = plan.due;
    $('#today-due-label').textContent = plan.due ? 'kelimenin tekrar zamanı geldi' : 'tekrar bekleyen kelime yok';
    const studied = all.filter((w) => w.lastSeen && w.lastSeen >= today).length;
    const added = all.filter((w) => w.createdAt >= today).length;
    $('#today-studied').textContent =
      [studied && `Bugün ${studied} kelime çalıştın.`, added && `Bugün ${added} kelime ekledin.`].filter(Boolean).join(' ') ||
      'Bugün henüz çalışmadın.';
    const start = $('#today-start');
    start.disabled = plan.words.length === 0 || Quiz.playable(all).length < 2;
    start.textContent = plan.free ? 'Serbest tekrar' : 'Tekrara başla';
    $('#today-start-info').textContent = start.disabled
      ? 'Bu modda oynanabilecek kelime yok.'
      : plan.free
        ? `Tekrar zamanı gelen kelime yok; en zayıf ${plan.words.length} kelimeyle çalışabilirsin.`
        : `${plan.words.length} kelime sorulacak${plan.due > plan.words.length ? ` (kalan ${plan.due - plan.words.length} sonraki turda)` : ''}.`;

    $('#today-drafts').textContent = s.drafts;
    $('#today-review').textContent = s.review;
    $('#today-added').textContent = all.filter((w) => w.createdAt >= sinceDays(7)).length;

    const weak = all
      .filter((w) => w.wrong > 0)
      .sort((a, b) => a.box - b.box || b.wrong - b.correct - (a.wrong - a.correct) || (b.lastSeen || 0) - (a.lastSeen || 0))
      .slice(0, 6);
    $('#today-weak').innerHTML = weak.length
      ? weak.map((w) => miniItem(w, `<span class="mini-meta">${w.wrong} yanlış</span>`)).join('')
      : '<p class="muted small">Henüz yanlış yaptığın kelime yok.</p>';

    const recent = all
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 6);
    $('#today-recent').innerHTML = recent.length
      ? recent.map((w) => miniItem(w)).join('')
      : '<p class="muted small">Henüz kelime yok.</p>';
  }

  $('#today-start').addEventListener('click', () => {
    const plan = todayPlan();
    if (!plan.words.length) return;
    setMode($('#today-mode').value);
    showView('game');
    startGame(plan.words);
  });
  $('#today-ai').addEventListener('click', openAI);
  $('#today-show-review').addEventListener('click', () => showWordsWith({ status: 'review' }));
  $('#today-show-recent').addEventListener('click', () => showWordsWith({ days: '7' }));
  $('#today-quick').addEventListener('click', () => {
    showView('words');
    quick.elements.form.focus();
  });
  $('#view-today').addEventListener('click', (e) => {
    const item = e.target.closest('.mini-item');
    if (item) showWordsWith({ search: item.dataset.word });
  });

  /* ================= Sayfadan ekleme (yer imi) ================= */

  // Yer imi: seçili kelimeyi ve içinde geçtiği cümleyi alıp uygulamayı #add?… adresiyle açar.
  function bookmarkletCode(appUrl) {
    const src = `(()=>{const U=${JSON.stringify(appUrl)};const s=getSelection();const w=String(s).trim().replace(/\\s+/g,' ');if(!w){alert('Önce bir kelime seç.');return}let n=s.anchorNode;while(n&&n.nodeType!==1)n=n.parentNode;while(n&&n!==document.body&&!/^(P|LI|DD|TD|BLOCKQUOTE|H[1-6]|FIGCAPTION|ARTICLE|SECTION|DIV)$/.test(n.tagName))n=n.parentNode;const t=n?(n.innerText||'').replace(/\\s+/g,' '):'';const lw=w.toLowerCase();const p=t.split(/(?<=[.!?…])\\s+/).find(x=>x.toLowerCase().includes(lw))||'';const q=new URLSearchParams({w,s:p.slice(0,500),src:document.title||location.hostname});window.open(U+'#add?'+q,'jsondictionary')})()`;
    return 'javascript:' + encodeURIComponent(src);
  }

  function setupBookmarklet() {
    const link = $('#bookmarklet');
    const appUrl = location.href.split('#')[0].split('?')[0];
    if (location.protocol === 'file:') {
      link.removeAttribute('href');
      link.classList.add('is-disabled');
      $('#bookmarklet-note').textContent =
        'Yer imi, uygulama bir adresten açıldığında çalışır (localhost ya da GitHub Pages). Dosyayı doğrudan açtığında kullanılamaz.';
      return;
    }
    link.href = bookmarkletCode(appUrl);
    link.addEventListener('click', (e) => {
      e.preventDefault();
      toast('Bu düğmeyi tıklamak yerine yer imleri çubuğuna sürükle.');
    });
    $('#bookmarklet-note').textContent = `Yer imi şu adresi açar: ${appUrl}`;
  }

  // #add?w=…&s=…&src=… ile açıldıysa hızlı ekleme formunu doldur.
  function handleAddHash() {
    if (!location.hash.startsWith('#add?')) return;
    const p = new URLSearchParams(location.hash.slice(5));
    history.replaceState(null, '', location.pathname + location.search);
    const word = (p.get('w') || '').trim();
    if (!word) return;
    for (const d of $$('dialog[open]')) d.close();
    showView('words');
    const E = quick.elements;
    E.form.value = word;
    E.sentence.value = p.get('s') || '';
    E.source.value = p.get('src') || '';
    E.form.dispatchEvent(new Event('input'));
    quick.querySelector('button[type="submit"]').focus();
    toast('Seçtiğin kelime forma yazıldı. Enter ile taslağa ekle.');
  }
  window.addEventListener('hashchange', handleAddHash);

  /* ================= Uygulama olarak yükleme (PWA) ================= */

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker kaydedilemedi', err));
  }
  let installPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e;
    $('#install-btn').hidden = false;
  });
  $('#install-btn').addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    $('#install-btn').hidden = true;
  });
  window.addEventListener('appinstalled', () => ($('#install-btn').hidden = true));

  /* ================= Başlangıç ================= */

  function renderAll() {
    renderStats();
    renderList();
    renderToday();
    if (!$('#view-game').hidden && $('#game-setup').hidden === false) renderSetupInfo();
  }
  Store.onChange(renderAll);
  renderAll();
  renderDataStatus();
  setupBookmarklet();
  handleAddHash();

  const mig = Store.migratedOnLoad;
  if (mig && mig.count) {
    toast(
      `Kayıtların yeni biçime dönüştürüldü: ${mig.count} kelime` +
        (mig.flagged ? `, ${mig.flagged} tanesi gözden geçirilmeli` : '')
    );
  }

  FS.init()
    .then(async () => {
      renderDataStatus();
      if (FS.status === 'connected') {
        try {
          const parsed = await FS.reconnect();
          if (parsed) await reconcile(parsed);
        } catch (err) {
          console.warn(err);
        }
      }
    })
    .catch((err) => console.warn(err));
})();
