'use strict';
/* global api */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const api = window.api;
  if (navigator.userAgent.includes('Electron')) document.documentElement.classList.add('electron');

  const ICONS = {
    overview: '<path d="M2.5 9.5a5.5 5.5 0 1 1 11 0" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M8 9.5 10.6 6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="8" cy="9.5" r="1" fill="currentColor"/><path d="M2.5 12.5h11" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
    build: '<path d="M3 13 9.2 6.8M8.4 3.2l4.4 4.4-1.6 1.6-4.4-4.4zM10 2.6l3.4 3.4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>',
    deps: '<path d="M8 1.8 13.5 4.8v6.4L8 14.2 2.5 11.2V4.8zM2.5 4.8 8 7.8l5.5-3M8 7.8v6.4" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>',
    leftovers: '<rect x="5" y="5" width="8.5" height="8.5" rx="1.8" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M11 3.2V3a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 3v5.5A1.5 1.5 0 0 0 4 10h.8" fill="none" stroke="currentColor" stroke-width="1.2"/>',
    pkg: '<path d="M8 2v7.5M5 6.8 8 9.8l3-3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.5 10.5v1.8c0 .7.5 1.2 1.2 1.2h8.6c.7 0 1.2-.5 1.2-1.2v-1.8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
    apps: '<rect x="2.3" y="2.3" width="4.6" height="4.6" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="9.1" y="2.3" width="4.6" height="4.6" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="2.3" y="9.1" width="4.6" height="4.6" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="9.1" y="9.1" width="4.6" height="4.6" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.2"/>',
    files: '<path d="M2.5 9.5 4 3.6c.1-.5.6-.9 1.1-.9h5.8c.5 0 1 .4 1.1.9l1.5 5.9v2.8c0 .7-.5 1.2-1.2 1.2H3.7c-.7 0-1.2-.5-1.2-1.2z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M2.6 9.5h3.2l.7 1.4h3l.7-1.4h3.2" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>',
    chev: '<path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
    lock: '<rect x="3.5" y="7" width="9" height="6.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" fill="none" stroke="currentColor" stroke-width="1.3"/>',
    done: '<circle cx="8" cy="8" r="6.4" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M5.3 8.2 7.2 10l3.5-3.8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>',
    tick: '<path d="M3.5 8.3 6.6 11.3 12.5 4.8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
    shield: '<path d="M8 1.8 13 3.6v4.1c0 3.1-2.1 5.4-5 6.5-2.9-1.1-5-3.4-5-6.5V3.6z" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/><path d="M5.8 8.1 7.4 9.6 10.3 6.5" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/>',
    eye: '<path d="M1.8 8C3.2 5.2 5.4 3.8 8 3.8s4.8 1.4 6.2 4.2c-1.4 2.8-3.6 4.2-6.2 4.2S3.2 10.8 1.8 8z" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/><circle cx="8" cy="8" r="1.9" fill="none" stroke="currentColor" stroke-width="1.25"/>',
    undo: '<path d="M5.5 4 2.5 7l3 3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.8 7h6.7a3.8 3.8 0 0 1 0 7.5H7" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
    arrow: '<path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>',
    folder: '<path d="M2 4.5c0-.8.6-1.5 1.5-1.5h2.8l1.4 1.5h4.8c.8 0 1.5.7 1.5 1.5v5.5c0 .8-.7 1.5-1.5 1.5h-9c-.9 0-1.5-.7-1.5-1.5z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>',
  };
  const svg = (name, cls = 'ico') => `<svg class="${cls}" viewBox="0 0 16 16" aria-hidden="true">${ICONS[name]}</svg>`;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // `code` spans in catalog text
  const rich = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');

  function fmt(bytes, { approx = false } = {}) {
    if (bytes == null) return '—';
    const u = [['TB', 1e12], ['GB', 1e9], ['MB', 1e6], ['KB', 1e3]];
    for (const [name, v] of u) {
      if (bytes >= v) {
        const n = bytes / v;
        const digits = name === 'GB' || name === 'TB' ? (n >= 100 ? 0 : 1) : 0;
        return `${approx ? '~' : ''}${n.toFixed(digits)} ${name}`;
      }
    }
    return `${bytes} B`;
  }
  function splitFmt(bytes) {
    const s = fmt(bytes);
    const i = s.lastIndexOf(' ');
    return [s.slice(0, i), s.slice(i + 1)];
  }
  // CSP forbids inline style attributes; widths are applied through the CSSOM instead.
  const applyWidths = (root = document) => root.querySelectorAll('[data-w]').forEach((e) => { e.style.width = e.dataset.w; });
  const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
  function timeAgo(ms) {
    if (!ms) return '';
    const s = Math.round((Date.now() - ms) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  const METHOD = {
    delete: 'Deleted permanently',
    empty: 'Folder emptied (contents deleted permanently)',
    trash: 'Moved to the Trash',
    worktree: 'Removed with git worktree remove',
    'pnpm-prune': 'Runs pnpm store prune',
    'empty-trash': 'Finder empties the Trash',
  };
  const METHOD_GROUP = {
    delete: 'Deleted permanently', empty: 'Deleted permanently', worktree: 'Removed with git (branches kept)',
    trash: 'Moved to the Trash', 'pnpm-prune': 'Commands', 'empty-trash': 'Commands',
  };
  const RISK = { safe: 'Safe', check: 'Check first', locked: 'Locked' };

  const sheet = $('#sheet');

  // ---------- state ----------
  const state = {
    view: 'overview',
    scan: null,
    scanning: false,
    progress: null,
    selected: new Set(),
    open: new Set(),
    disk: null,
    settings: null,
    history: [],
    error: null,
    lastClean: null, // { freed, items } from the clean that just finished, shown until the next scan
  };

  const items = () => (state.scan ? state.scan.items : []);
  const byId = (id) => items().find((i) => i.id === id);
  const inside = (c, p) => c !== p && c.startsWith(p.endsWith('/') ? p : p + '/');

  /** Selected items, minus ones fully contained in another selected item (no double counting). */
  function effectiveSelection() {
    const sel = items().filter((i) => state.selected.has(i.id));
    const all = sel.flatMap((i) => i.paths.map((p) => ({ p, id: i.id })));
    return sel.filter((i) => !i.paths.every((p) => all.some((o) => o.id !== i.id && inside(p, o.p))));
  }
  const selSize = () => effectiveSelection().reduce((a, i) => a + (i.size || 0), 0);
  const recommendedIds = () => items().filter((i) => i.recommended && i.risk !== 'locked').map((i) => i.id);

  // ---------- rendering ----------
  function renderNav() {
    const cats = state.scan ? state.scan.categories : [];
    const navItem = (id, label, icon, size, hasSel) => `
      <button class="nav-item" data-view="${id}" ${state.view === id ? 'aria-current="page"' : ''}>
        ${svg(icon)}<span>${esc(label)}</span>
        ${size != null ? `<span class="nav-size ${hasSel ? 'has-sel' : ''}" ${hasSel ? 'title="Has selected items"' : ''}>${fmt(size)}</span>` : ''}
      </button>`;
    let html = navItem('overview', 'Overview', 'overview', null, false);
    html += '<div class="nav-group">Categories</div>';
    const names = { build: 'Build caches', deps: 'Dependencies', leftovers: 'Leftover copies', pkg: 'Developer caches', apps: 'App caches', files: 'Downloads & Trash' };
    for (const id of Object.keys(names)) {
      const c = cats.find((x) => x.id === id);
      const hasSel = items().some((i) => i.category === id && state.selected.has(i.id));
      html += navItem(id, names[id], id, c ? c.size : null, hasSel);
    }
    $('#nav').innerHTML = html;
    const s = $('#nav-settings');
    if (state.view === 'settings') s.setAttribute('aria-current', 'page'); else s.removeAttribute('aria-current');
  }

  function renderCapacity() {
    const d = state.disk;
    const el = $('#capacity');
    if (!d) { el.innerHTML = ''; return; }
    const sel = Math.min(selSize(), d.used);
    const pct = (v) => `${(v / d.total) * 100}%`;
    el.innerHTML = `
      <div class="cap-head">
        <div><strong>Macintosh HD</strong> <span class="muted">${fmt(d.total)}</span></div>
        <div class="num"><strong>${fmt(d.free)}</strong> <span class="muted">free</span>${sel ? `<span class="after">${fmt(d.free + sel)} after cleaning</span>` : ''}</div>
      </div>
      <div class="bar ${state.scanning ? 'indeterminate' : ''}" role="img" aria-label="${fmt(d.used)} used, ${fmt(sel)} of it selected to clean, ${fmt(d.free)} free">
        <span class="seg-used" data-w="${pct(d.used - sel)}"></span>
        <span class="seg-sel" data-w="${pct(sel)}"></span>
      </div>
      <div class="legend num">
        <span><i class="k-used"></i>Used ${fmt(d.used)}</span>
        ${sel ? `<span><i class="k-sel"></i>Selected to clean ${fmt(sel)}</span>` : ''}
        <span><i class="k-free"></i>Free ${fmt(d.free)}</span>
      </div>`;
  }

  function renderActionBar() {
    const el = $('#actionbar');
    if (state.view === 'settings' || state.view === 'overview' || !state.scan || state.scanning) { el.hidden = true; return; }
    el.hidden = false;
    const sel = effectiveSelection();
    const size = selSize();
    el.innerHTML = `
      <div>
        ${sel.length
          ? `<span class="sel-size">${fmt(size)}</span><span class="sel-count">${plural(sel.length, 'item')} selected</span>`
          : '<span class="sel-count">Nothing selected</span>'}
      </div>
      <div class="actions">
        ${sel.length ? '<button class="btn btn-quiet" data-act="clear-all">Clear selection</button>' : ''}
        <button class="btn btn-primary btn-large" data-act="review" ${sel.length ? '' : 'disabled'}>Review and clean</button>
      </div>`;
  }

  function renderScanning() {
    const p = state.progress || {};
    const determinate = p.phase === 'measure' && p.total;
    const label = { walk: 'Looking through your project folders', git: 'Checking worktrees and project activity', measure: 'Measuring sizes' }[p.phase] || 'Starting';
    return `
      <div class="state">
        <h2>Scanning your Mac</h2>
        <p>${esc(label)}${determinate ? ` (${p.done} of ${p.total})` : ''}</p>
        <div class="progress ${determinate ? '' : 'indeterminate'}"><span data-w="${determinate ? (p.done / p.total) * 100 : 35}%"></span></div>
        <div class="detail">${esc(p.detail || '')}</div>
      </div>`;
  }

  // Scan warnings. The Full Disk Access one gets a button that opens the right System Settings pane.
  const needsFda = (text) => /Full Disk Access/.test(text || '');
  const fdaButton = '<button class="btn" data-act="fda">Open Full Disk Access</button>';
  function renderWarning(w) {
    if (!needsFda(w)) return `<div class="notice"><span>${esc(w)}</span></div>`;
    return `<div class="notice notice-action">
      <span><strong>The Trash was not measured.</strong> Clearspace needs Full Disk Access to read it.
      Turn on Clearspace in the list that opens, then quit and reopen Clearspace.</span>
      ${fdaButton}
    </div>`;
  }

  function emptyState({ art, title, text, button }) {
    return `<div class="state">
      ${art || ''}
      <h2>${title}</h2><p>${text}</p>
      ${button || ''}</div>`;
  }
  const brandArt = '<img class="state-mark" src="brand/clearspace-mark.svg" width="56" height="56" alt="">';

  function renderOverview() {
    if (state.scanning) return renderScanning();
    if (state.error) {
      return emptyState({ title: 'The scan stopped', text: esc(state.error), button: '<button class="btn btn-primary btn-large" data-act="scan">Scan again</button>' });
    }
    if (!state.scan && state.lastClean) {
      const lc = state.lastClean;
      return emptyState({
        art: svg('tick', 'ico state-done'),
        title: lc.freed != null ? `${fmt(lc.freed)} freed` : 'Cleaning finished',
        text: `${plural(lc.items, 'item')} cleaned${state.disk ? `. You now have <strong>${fmt(state.disk.free)}</strong> free` : ''}. Scan again whenever you want to see what is left.`,
        button: '<button class="btn btn-primary btn-large" data-act="scan">Scan again</button>',
      });
    }
    if (!state.scan) {
      return emptyState({
        art: brandArt,
        title: 'See what is taking up space',
        text: 'Clearspace looks through your project folders and caches, explains every item and cleans only what you approve.',
        button: '<button class="btn btn-primary btn-large" data-act="scan">Scan now</button>',
      });
    }

    const recIds = recommendedIds();
    const recSize = items().filter((i) => recIds.includes(i.id)).reduce((a, i) => a + (i.size || 0), 0);
    const eff = effectiveSelection();
    const size = selSize();
    const isRecSel = recIds.length && recIds.every((id) => state.selected.has(id)) && state.selected.size === recIds.length;
    const [n, unit] = splitFmt(size || recSize);

    // ---- Summary card: what is selected, and what it does to free space
    let eyebrow, line, actions;
    if (size) {
      eyebrow = 'Ready to clean';
      line = isRecSel ? plural(eff.length, 'recommended item') : `${plural(eff.length, 'item')} selected`;
      actions = `<button class="btn btn-primary btn-large" data-act="review">Review and clean</button>
        ${isRecSel ? '' : '<button class="btn btn-large" data-act="select-rec">Use recommended</button>'}
        <button class="btn btn-quiet" data-act="clear-all">Clear selection</button>`;
    } else if (recSize) {
      eyebrow = 'Safe to clean';
      line = 'Marked Safe and not in active use';
      actions = '<button class="btn btn-primary btn-large" data-act="select-rec">Select recommended</button>';
    } else {
      eyebrow = null; // the tidy card below replaces the figure
      line = '';
      actions = '';
    }
    const d = state.disk;
    const side = d ? (() => {
      const sel = Math.min(size, d.used);
      return `
        <div class="ov-side">
          <div class="ov-stat"><span class="k">Free now</span><span class="v num">${fmt(d.free)}</span>${sel ? '' : `<span class="s num">${Math.round((d.free / d.total) * 100)}% of ${fmt(d.total)}</span>`}</div>
          ${sel ? `
          ${svg('arrow', 'ico ov-arrow')}
          <div class="ov-stat after"><span class="k">After cleaning</span><span class="v num">${fmt(d.free + sel)}</span></div>` : ''}
        </div>`;
    })() : '';
    const hero = eyebrow === null ? `
      <section class="ov-hero tidy">
        <div class="ov-main">
          <div class="tidy-title">${svg('done', 'ico tidy-ico')}<h2>Your Mac is tidy</h2></div>
          <p class="hero-line">Nothing safe to remove is waiting. Items in use or worth a check are listed below.</p>
        </div>
        ${side}
      </section>` : `
      <section class="ov-hero ${size ? 'has-sel' : ''}">
        <div class="ov-main">
          <div class="eyebrow">${eyebrow}</div>
          <div class="hero-figure">${esc(n)}<small>${esc(unit)}</small></div>
          <p class="hero-line">${esc(line)}</p>
          ${actions ? `<div class="ov-actions">${actions}</div>` : ''}
        </div>
        ${side}
      </section>`;

    // ---- Categories
    const warn = (state.scan.warnings || []).map(renderWarning).join('');
    const rows = state.scan.categories.map((c) => {
      const list = items().filter((i) => i.category === c.id);
      const selN = list.filter((i) => state.selected.has(i.id)).length;
      return `
        <button class="cat-row" data-view="${c.id}">
          <div><div class="cat-name">${esc(c.name)}</div><div class="cat-blurb">${esc(c.blurb)}</div></div>
          <div class="cat-sel">${c.count ? `${selN} of ${c.count} selected` : 'Nothing found'}</div>
          <div class="cat-size">${c.count ? fmt(c.size) : ''}</div>
          ${svg('chev', 'chev')}
        </button>`;
    }).join('');
    return `${hero}${warn}
      <div class="section-title">Where the space is</div>
      <div class="cat-list">${rows}</div>`;
  }

  function groupsFor(catId, list) {
    const days = state.settings ? state.settings.inactiveDays : 14;
    if (catId === 'deps') {
      return [
        [`Not used in the last ${days} days`, list.filter((i) => !i.active)],
        ['Used recently', list.filter((i) => i.active)],
      ];
    }
    if (catId === 'leftovers') {
      return [
        ['AI-agent worktrees', list.filter((i) => i.group === 'worktree')],
        ['Duplicate project folders', list.filter((i) => i.group === 'duplicate')],
        ['Worktree folders copied inside duplicates', list.filter((i) => i.group === 'wtcopy')],
      ];
    }
    if (catId === 'files') {
      return [
        ['Trash', list.filter((i) => i.action === 'empty-trash')],
        ['iPhone and iPad backups', list.filter((i) => i.group === 'backup')],
        ['Large items in Downloads', list.filter((i) => i.action === 'trash' && i.group !== 'backup')],
      ];
    }
    return [[null, list]];
  }

  function renderItem(it) {
    const open = state.open.has(it.id);
    const locked = it.risk === 'locked';
    const checked = state.selected.has(it.id);
    const tags = (it.tags || []).map((t) => `<span class="tag ${/today|yesterday/i.test(t) && it.category !== 'files' ? 'warm' : ''}">${esc(t)}</span>`).join('');
    return `
      <div class="item ${open ? 'open' : ''} ${locked ? 'locked' : ''}" data-id="${it.id}">
        <div class="item-row" data-act="toggle-open">
          <input type="checkbox" class="check" data-act="select" aria-label="Select ${esc(it.title)}" ${checked ? 'checked' : ''} ${locked ? 'disabled' : ''}>
          <div class="item-main">
            <div class="item-title">${esc(it.title)}${it.kindLabel ? `<span class="kind">${esc(it.kindLabel)}</span>` : ''}</div>
            ${locked && it.lockedReason
              ? `<div class="lock-reason">${esc(it.lockedReason)}</div>`
              : `<div class="item-path"><bdi>${esc(it.subtitle)}</bdi></div>`}
          </div>
          <div class="item-tags">${tags}</div>
          <div class="item-size">${it.sizeLabel ? `<span class="pre">${esc(it.sizeLabel)}</span>` : ''}${fmt(it.size)}</div>
          <span class="badge risk-${it.risk}">${locked ? svg('lock') : ''}${RISK[it.risk]}</span>
          <button class="expander" data-act="toggle-open" aria-expanded="${open}" aria-label="Details">${svg('chev')}</button>
        </div>
        ${open ? `
          <div class="details">
            <dl>
              <dt>What it is</dt><dd>${rich(it.what)}</dd>
              <dt>After cleaning</dt><dd>${rich(it.after)}</dd>
              <dt>Will you lose anything?</dt><dd>${rich(it.lose)}</dd>
              <dt>How it is cleaned</dt><dd>${esc(METHOD[it.action])}</dd>
            </dl>
            ${it.note ? `<div class="note">${rich(it.note)}</div>` : ''}
            <div class="paths">${it.paths.slice(0, 8).map((p) => `<div>${esc(p)}</div>`).join('')}${it.paths.length > 8 ? `<div>and ${it.paths.length - 8} more</div>` : ''}</div>
            ${it.action !== 'empty-trash' && it.action !== 'pnpm-prune' ? `<div class="detail-foot"><button class="link" data-act="reveal">Show in Finder</button></div>` : ''}
          </div>` : ''}
      </div>`;
  }

  function renderCategory(catId) {
    if (state.scanning) return renderScanning();
    if (!state.scan) return renderOverview();
    const cat = state.scan.categories.find((c) => c.id === catId);
    const list = items().filter((i) => i.category === catId);
    const head = `
      <div class="cat-head">
        <div><h1>${esc(cat.name)}</h1><p>${esc(cat.blurb)}</p></div>
        ${list.length ? `<div class="cat-tools">
          <button class="link" data-act="cat-rec" data-cat="${catId}">Select recommended</button>
          <button class="link" data-act="cat-all" data-cat="${catId}">Select all</button>
          <button class="link" data-act="cat-none" data-cat="${catId}">Select none</button>
        </div>` : ''}
      </div>`;
    if (!list.length) {
      return head + '<div class="state"><h2>Nothing to clean here</h2><p>This category is already tidy.</p></div>';
    }
    const groups = groupsFor(catId, list).filter(([, l]) => l.length);
    return head + groups.map(([title, l]) => `
      ${title ? `<div class="group-title"><span>${esc(title)}</span><span class="num">${fmt(l.reduce((a, i) => a + (i.size || 0), 0))}</span></div>` : ''}
      <div class="list">${l.map(renderItem).join('')}</div>`).join('');
  }

  function renderSettings() {
    const s = state.settings;
    if (!s) return '';
    const roots = s.projectRoots.map((r, i) => `
      <div class="set-row">
        <div class="folder">${svg('folder')}<span>${esc(r)}</span></div>
        <button class="btn btn-quiet" data-act="root-remove" data-i="${i}" ${s.projectRoots.length === 1 ? 'disabled title="Keep at least one folder"' : ''}>Remove</button>
      </div>`).join('');
    const hist = state.history.length
      ? state.history.slice(0, 8).map((h) => `
        <div class="history-row"><span>${new Date(h.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span>
        <span class="num">${h.freed != null ? `Freed ${fmt(h.freed)}` : ''} <span class="muted">(${plural(h.items, 'item')})</span></span></div>`).join('')
      : '<div class="history-row"><span class="muted">No cleanups yet</span><span></span></div>';
    return `
      <div class="settings">
        <h1>Settings</h1>
        <div class="set-title">Project folders</div>
        <div class="set-block">
          ${roots}
          <div class="set-row"><div class="hint">Clearspace looks for build caches, node_modules and worktrees inside these folders.</div>
          <button class="btn" data-act="root-add">Add folder</button></div>
        </div>
        <div class="set-title">Scanning</div>
        <div class="set-block">
          <div class="set-row">
            <div><div class="label">Treat a project as inactive after</div><div class="hint">node_modules of inactive projects are recommended for cleaning.</div></div>
            <div class="stepper"><input type="number" min="1" max="365" value="${s.inactiveDays}" data-act="days" aria-label="Days"><span>days</span></div>
          </div>
          <div class="set-row">
            <div><div class="label">Scan when Clearspace opens</div><div class="hint">Nothing is ever cleaned without your review.</div></div>
            <input type="checkbox" class="switch" data-act="scan-on-launch" ${s.scanOnLaunch ? 'checked' : ''} aria-label="Scan when Clearspace opens">
          </div>
          <div class="set-row">
            <div><div class="label">Full Disk Access</div><div class="hint">Needed only to measure and empty the Trash. Turn on Clearspace in the list that opens.</div></div>
            <button class="btn" data-act="fda">Open System Settings</button>
          </div>
        </div>
        <div class="set-title">Recent cleanups</div>
        <div class="set-block">${hist}</div>
      </div>`;
  }

  function render() {
    renderNav();
    renderCapacity();
    const titles = { overview: 'Overview', settings: 'Settings' };
    const cat = state.scan && state.scan.categories.find((c) => c.id === state.view);
    $('#toolbar-title').textContent = titles[state.view] || (cat ? cat.name : '');
    $('#scanned-at').textContent = state.scan && !state.scanning ? `Scanned ${timeAgo(state.scan.scannedAt)}` : '';
    $('#btn-rescan').disabled = state.scanning;
    const view = $('#view');
    const keepScroll = view.scrollTop;
    view.innerHTML = state.view === 'overview' ? renderOverview()
      : state.view === 'settings' ? renderSettings()
      : renderCategory(state.view);
    view.scrollTop = keepScroll;
    renderActionBar();
    applyWidths();
  }

  // ---------- actions ----------
  let unsubScan = null;
  async function startScan() {
    if (state.scanning || sheet.open) return; // never change the selection under an open review
    state.scanning = true;
    state.error = null;
    state.progress = null;
    if (state.view === 'settings') state.view = 'overview';
    render();
    unsubScan = api.onScanProgress((p) => {
      state.progress = p;
      if (state.view !== 'settings') { $('#view').innerHTML = renderScanning(); applyWidths($('#view')); }
    });
    const res = await api.scan();
    unsubScan && unsubScan();
    state.scanning = false;
    if (!res || res.error) {
      state.error = (res && res.error) || 'Unknown error';
    } else {
      state.scan = res;
      state.lastClean = null;
      state.disk = res.disk || state.disk;
      state.selected = new Set(recommendedIds());
      state.open.clear();
    }
    render();
  }

  function setView(v) {
    state.view = v;
    $('#view').scrollTop = 0;
    render();
    $('#view').focus({ preventScroll: true });
  }

  function closeSheet() { if (sheet.open) sheet.close(); }

  // After a clean, however the result sheet is closed (Done or Escape): refresh the disk
  // figures and show the overview. No automatic re-scan; the person scans again when they want.
  let afterClean = false;
  sheet.addEventListener('close', async () => {
    if (!afterClean) return;
    afterClean = false;
    state.view = 'overview';
    render();
    try { state.disk = await api.getDisk(); state.history = await api.getHistory(); } catch {}
    render();
  });

  let reviewIds = null;
  function openReview() {
    const sel = effectiveSelection();
    if (!sel.length) return;
    reviewIds = sel.map((i) => i.id); // exactly what the user is looking at
    const pnpmItem = items().find((i) => i.key === 'pnpm-prune');
    const pnpmDeps = sel.some((i) => i.category === 'deps' && i.pm === 'pnpm');
    const suggestPrune = pnpmItem && pnpmDeps && !state.selected.has(pnpmItem.id);
    const warnings = [];
    for (const i of sel) {
      if (i.category === 'deps' && i.active) {
        const cmd = i.installCmd || (i.pm ? `${i.pm} install` : null);
        warnings.push(`${esc(i.title)} was used recently. ${cmd ? `Run <code>${esc(cmd)}</code>` : 'Install its packages again'} before you work on it again.`);
      }
      if (i.action === 'empty-trash') warnings.push('Everything in the Trash will be deleted for good.');
      if (i.category === 'build' && (i.tags || []).includes('Used today')) warnings.push(`Stop anything running in ${esc(i.title)} (a dev server, build or tests) before cleaning.`);
    }
    const groups = {};
    for (const i of sel) (groups[METHOD_GROUP[i.action]] = groups[METHOD_GROUP[i.action]] || []).push(i);
    const order = ['Deleted permanently', 'Removed with git (branches kept)', 'Moved to the Trash', 'Commands'];
    const body = order.filter((g) => groups[g]).map((g) => `
      <div class="rv-group">
        <h3><span>${esc(g)} (${groups[g].length})</span><span>${fmt(groups[g].reduce((a, i) => a + (i.size || 0), 0))}</span></h3>
        <div class="rv-list">${groups[g].map((i) => `
          <div class="rv-item"><div class="t">${esc(i.title)}<em>${esc(i.kindLabel || i.subtitle)}</em></div><div class="s">${i.sizeLabel ? esc(i.sizeLabel) + ' ' : ''}${fmt(i.size)}</div></div>`).join('')}
        </div>
      </div>`).join('');
    const size = selSize();
    sheet.innerHTML = `
      <div class="sheet-head">
        <h2 id="sheet-title">Clean ${fmt(size)}?</h2>
        <p>${plural(sel.length, 'item')}. Check the list below. Items moved to the Trash can be put back until you empty it.</p>
      </div>
      <div class="sheet-body">
        ${suggestPrune ? `
          <label class="rv-check"><input type="checkbox" class="check" id="add-prune" checked>
            <span><strong>Also remove unused packages from the pnpm store</strong><br>
            <span class="muted">pnpm keeps the real files in its store, so this is where most node_modules space is freed. Projects you still have installed keep working.</span></span></label>` : ''}
        ${warnings.length ? `<div class="warn-list">${[...new Set(warnings)].map((w) => `<div>${w}</div>`).join('')}</div>` : ''}
        ${body}
      </div>
      <div class="sheet-foot">
        <button class="btn btn-large" data-act="sheet-cancel">Cancel</button>
        <button class="btn btn-primary btn-large" data-act="clean-go">Clean ${fmt(size)}</button>
      </div>`;
    sheet.showModal();
    $('[data-act="sheet-cancel"]', sheet).focus(); // never default to the destructive button
  }

  async function runClean() {
    if (!reviewIds) return;
    const ids = [...reviewIds];
    reviewIds = null;
    const scanId = state.scan && state.scan.scanId;
    const addPrune = $('#add-prune', sheet);
    if (addPrune && addPrune.checked) {
      const p = items().find((i) => i.key === 'pnpm-prune');
      if (p && !ids.includes(p.id)) ids.push(p.id);
    }
    const total = ids.length;
    sheet.innerHTML = `
      <div class="sheet-head"><h2 id="sheet-title">Cleaning</h2><p id="cl-line">Starting</p></div>
      <div class="sheet-body"><div class="progress progress-wide"><span id="cl-bar"></span></div>
      <p class="muted small">Keep Clearspace open until this finishes.</p></div>`;
    sheet.addEventListener('cancel', blockEsc);
    document.addEventListener('keydown', blockEscKey, true);
    const unsub = api.onCleanProgress((p) => {
      $('#cl-line', sheet).textContent = `${p.title} (${p.index} of ${p.total})`;
      $('#cl-bar', sheet).style.width = `${((p.index - 1) / p.total) * 100}%`;
    });
    const res = await api.clean(ids, scanId);
    unsub();
    sheet.removeEventListener('cancel', blockEsc);
    document.removeEventListener('keydown', blockEscKey, true);
    // The old list is no longer accurate: nothing stays selected until the next scan.
    state.selected.clear();
    state.scan = null;
    afterClean = true;
    showResult(res, total);
  }
  function blockEsc(e) { e.preventDefault(); }
  function blockEscKey(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); } }

  function showResult(res, total) {
    if (!res || res.error) {
      sheet.innerHTML = `
        <div class="sheet-head"><h2 id="sheet-title">Cleaning did not start</h2><p>${esc((res && res.error) || 'Unknown error')}</p></div>
        <div class="sheet-foot"><button class="btn btn-primary btn-large" data-act="result-done">Close</button></div>`;
      return;
    }
    const problems = res.results.filter((r) => r.status !== 'done' && !(r.status === 'skipped' && /^Included in/.test(r.message || '')));
    const doneN = res.results.filter((r) => r.status === 'done').length;
    state.lastClean = { freed: res.freed, items: doneN };
    const stLabel = { error: 'Failed', refused: 'Not cleaned', partial: 'Partly done', skipped: 'Skipped' };
    sheet.innerHTML = `
      <div class="sheet-head">
        <h2 id="sheet-title">Cleaned</h2>
        <div class="result-figure">${fmt(res.freed)}</div>
        <p>freed on your disk. Free space went from ${fmt(res.before && res.before.free)} to ${fmt(res.after && res.after.free)}.
        ${plural(doneN, 'item')} of ${total} cleaned.</p>
      </div>
      ${problems.length ? `<div class="sheet-body">
        <div class="rv-group"><h3><span>Needs your attention</span></h3>
        ${problems.map((r) => `<div class="res-item"><span class="st-${r.status}">${stLabel[r.status] || r.status}</span><span><strong>${esc(r.title)}</strong> ${esc(r.message || '')}</span></div>`).join('')}
        ${problems.some((r) => needsFda(r.message)) ? `<div class="res-action">${fdaButton}</div>` : ''}
        </div></div>` : ''}
      ${res.freed != null && res.estimated && res.freed < res.estimated * 0.5 ? `<div class="sheet-body"><p class="muted small">
        Less space was freed than the folder sizes suggested. This is normal for pnpm projects: their files are shared with the pnpm store, and they are freed when the store is pruned.</p></div>` : ''}
      <div class="sheet-foot"><button class="btn btn-primary btn-large" data-act="result-done">Done</button></div>`;
    $('[data-act="result-done"]', sheet).focus();
  }

  async function saveSettings(patch) {
    state.settings = await api.saveSettings({ ...state.settings, ...patch });
    render();
  }

  // ---------- events ----------
  document.addEventListener('click', async (e) => {
    const nav = e.target.closest('[data-view]');
    if (nav) { setView(nav.dataset.view); return; }
    const a = e.target.closest('[data-act]');
    if (!a) return;
    const act = a.dataset.act;
    const itemEl = a.closest('.item');
    const id = itemEl && itemEl.dataset.id;
    switch (act) {
      case 'scan': startScan(); break;
      case 'select': {
        e.stopPropagation();
        if (a.checked) state.selected.add(id); else state.selected.delete(id);
        render();
        break;
      }
      case 'toggle-open': {
        if (e.target.closest('[data-act="select"]')) return;
        if (state.open.has(id)) state.open.delete(id); else state.open.add(id);
        render();
        break;
      }
      case 'reveal': {
        const it = byId(id);
        if (it) api.reveal(it.paths[0]);
        break;
      }
      case 'select-rec': state.selected = new Set(recommendedIds()); render(); break;
      case 'clear-all': state.selected.clear(); render(); break;
      case 'cat-rec': case 'cat-all': case 'cat-none': {
        const list = items().filter((i) => i.category === a.dataset.cat);
        for (const i of list) {
          state.selected.delete(i.id);
          if (i.risk === 'locked') continue;
          if (act === 'cat-all' || (act === 'cat-rec' && i.recommended)) state.selected.add(i.id);
        }
        render();
        break;
      }
      case 'review': openReview(); break;
      case 'sheet-cancel': reviewIds = null; closeSheet(); break;
      case 'clean-go': runClean(); break;
      case 'result-done': closeSheet(); break; // the sheet's close handler refreshes the view
      case 'root-add': {
        const p = await api.pickFolder();
        if (p && !state.settings.projectRoots.includes(p)) saveSettings({ projectRoots: [...state.settings.projectRoots, p] });
        break;
      }
      case 'root-remove': {
        const roots = state.settings.projectRoots.filter((_, i) => i !== Number(a.dataset.i));
        if (roots.length) saveSettings({ projectRoots: roots });
        break;
      }
      case 'fda': api.openFullDiskAccess(); break;
      default: break;
    }
  });
  document.addEventListener('change', (e) => {
    const act = e.target.dataset && e.target.dataset.act;
    if (act === 'days') saveSettings({ inactiveDays: Number(e.target.value) });
    if (act === 'scan-on-launch') saveSettings({ scanOnLaunch: e.target.checked });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('check')) {
      e.target.click();
    }
  });
  $('#btn-rescan').addEventListener('click', startScan);
  api.onMenu((m) => { if (m === 'rescan') startScan(); });

  // ---------- boot ----------
  (async () => {
    const [settings, disk, history] = await Promise.all([api.getSettings(), api.getDisk(), api.getHistory()]);
    state.settings = settings;
    state.disk = disk;
    state.history = history || [];
    render();
    if (settings.scanOnLaunch) startScan();
  })();
})();
