'use strict';

const ICONS = {
  top: '🌍', india: '🇮🇳', tech: '💻', business: '📈',
  science: '🔬', sports: '⚽', entertainment: '🎬',
};

const $ = sel => document.querySelector(sel);
const feedEl = $('#feed');
const catsEl = $('#cats');
const searchEl = $('#search');
const emptyEl = $('#empty');
const updatedEl = $('#updated');
const newbar = $('#newbar');

const state = {
  category: 'top',
  query: '',
  items: [],
  pending: null,      // items held back until the user asks to see them
  freshIds: new Set(),
  updatedAt: 0,
  sources: [],
  es: null,
};

// ---------------------------------------------------------------- helpers

function relTime(ts) {
  if (!ts) return '';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return 'just now';
  if (s < 90) return '1 min ago';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr${h > 1 ? 's' : ''} ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} day${d > 1 ? 's' : ''} ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = text;
  return n;
}

function safeUrl(raw) {
  try {
    const u = new URL(raw, location.href);
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : null;
  } catch { return null; }
}

// ---------------------------------------------------------------- rendering

function cardFor(item) {
  const href = safeUrl(item.link);
  const card = el('a', 'card');
  card.href = href || '#';
  card.target = '_blank';
  card.rel = 'noopener noreferrer';
  if (state.freshIds.has(item.id)) card.classList.add('fresh');

  const img = safeUrl(item.image);
  if (img) {
    const thumb = el('img', 'thumb');
    thumb.src = img;
    thumb.alt = '';
    thumb.loading = 'lazy';
    thumb.referrerPolicy = 'no-referrer';
    thumb.addEventListener('error', () => thumb.remove(), { once: true });
    card.appendChild(thumb);
  }

  const body = el('div', 'card-body');
  const meta = el('div', 'meta');
  meta.appendChild(el('span', 'badge', item.source));
  const time = el('span', 'time', relTime(item.publishedAt));
  time.dataset.ts = item.publishedAt || 0;
  meta.appendChild(time);
  if (item.author) meta.appendChild(el('span', null, `· ${item.author}`));
  if (item.alsoIn && item.alsoIn.length) {
    meta.appendChild(el('span', 'also', `· also on ${item.alsoIn.slice(0, 2).join(', ')}`));
  }
  body.appendChild(meta);
  body.appendChild(el('h2', null, item.title));
  if (item.summary) body.appendChild(el('p', null, item.summary));
  card.appendChild(body);
  return card;
}

function visibleItems() {
  const q = state.query.toLowerCase();
  if (!q) return state.items;
  return state.items.filter(i =>
    i.title.toLowerCase().includes(q) ||
    (i.summary && i.summary.toLowerCase().includes(q)) ||
    i.source.toLowerCase().includes(q)
  );
}

function render() {
  const items = visibleItems();
  feedEl.replaceChildren(...items.map(cardFor));
  feedEl.setAttribute('aria-busy', 'false');

  if (!items.length) {
    emptyEl.hidden = false;
    emptyEl.textContent = state.query
      ? `No headlines matching “${state.query}”.`
      : 'No headlines yet — fetching sources…';
  } else {
    emptyEl.hidden = true;
  }
  updatedEl.textContent = state.updatedAt ? `Updated ${relTime(state.updatedAt)}` : '';
  // The flash animation should only play once per arrival.
  setTimeout(() => state.freshIds.clear(), 1800);
}

function renderSkeleton(n = 8) {
  const cards = Array.from({ length: n }, () => {
    const c = el('div', 'card skeleton');
    c.appendChild(el('div', 'sk thumb'));
    const b = el('div', 'card-body');
    b.appendChild(el('div', 'sk line short'));
    b.appendChild(el('div', 'sk line'));
    b.appendChild(el('div', 'sk line'));
    c.appendChild(b);
    return c;
  });
  feedEl.replaceChildren(...cards);
  feedEl.setAttribute('aria-busy', 'true');
  emptyEl.hidden = true;
}

function renderSources() {
  const box = $('#sources');
  box.replaceChildren(...state.sources.map(s => {
    const row = el('div', 'src' + (s.ok ? '' : ' bad'));
    row.appendChild(el('span', null, s.ok ? '●' : '○'));
    row.appendChild(el('b', null, s.name));
    row.appendChild(el('span', 'pill', s.ok ? `${s.count}` : (s.error || 'failed')));
    return row;
  }));
}

function showNewbar(count) {
  $('#newCount').textContent = count;
  newbar.hidden = false;
}

// ---------------------------------------------------------------- menu

const sidebar = () => $('#sidebar');
const backdrop = () => $('#backdrop');
const menuBtn = () => $('#menuBtn');
const menuIsOpen = () => sidebar().classList.contains('open');

function openMenu() {
  if (menuIsOpen()) return;
  const sb = sidebar(), bd = backdrop(), btn = menuBtn();
  sb.classList.add('open');
  sb.removeAttribute('inert');
  btn.setAttribute('aria-expanded', 'true');
  btn.setAttribute('aria-label', 'Close menu');
  bd.hidden = false;
  // Unhide first, fade next frame — a display change can't be transitioned.
  requestAnimationFrame(() => bd.classList.add('show'));
  const focusTarget = sb.querySelector('.cat[aria-current="true"]') || sb.querySelector('.cat');
  if (focusTarget) focusTarget.focus();
}

function closeMenu({ restoreFocus = true } = {}) {
  if (!menuIsOpen()) return;
  const sb = sidebar(), bd = backdrop(), btn = menuBtn();
  sb.classList.remove('open');
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-label', 'Open menu');
  bd.classList.remove('show');
  setTimeout(() => { if (!menuIsOpen()) bd.hidden = true; }, 260);
  // inert pulls focus out of the panel; put it somewhere sensible first.
  if (restoreFocus && sb.contains(document.activeElement)) btn.focus();
  sb.setAttribute('inert', '');
}

const toggleMenu = () => (menuIsOpen() ? closeMenu() : openMenu());

// Mirrors the sidebar's live status into the topbar, which stays visible.
function setLive(state, text) {
  const cls = state ? ` ${state}` : '';
  $('#live').className = `live${cls}`;
  $('#liveMini').className = `live live-mini${cls}`;
  $('#liveMini').title = text;
  $('#liveText').textContent = text;
}

// ---------------------------------------------------------------- data

async function load(category, { skeleton = true } = {}) {
  if (skeleton) renderSkeleton();
  newbar.hidden = true;
  state.pending = null;
  try {
    const res = await fetch(`/api/news?category=${encodeURIComponent(category)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.category !== state.category) return; // user switched mid-flight
    state.items = data.items;
    state.updatedAt = data.updatedAt;
    state.sources = data.sources || [];
    renderSources();
    render();
  } catch (err) {
    feedEl.replaceChildren();
    feedEl.setAttribute('aria-busy', 'false');
    emptyEl.hidden = false;
    emptyEl.textContent = `Could not load headlines (${err.message}). Retrying automatically…`;
  }
}

function connectStream(category) {
  if (state.es) state.es.close();
  setLive('', 'Connecting…');

  const es = new EventSource(`/api/stream?category=${encodeURIComponent(category)}`);
  state.es = es;

  es.onopen = () => setLive('on', 'Live — auto-updating');
  es.onerror = () => setLive('off', 'Reconnecting…'); // EventSource retries on its own
  es.addEventListener('update', ev => {
    let data;
    try { data = JSON.parse(ev.data); } catch { return; }
    if (data.category !== state.category) return;
    state.updatedAt = data.updatedAt;
    // Don't yank the page out from under someone mid-scroll.
    if (window.scrollY > 240) {
      state.pending = data.items;
      showNewbar(data.newCount);
    } else {
      const known = new Set(state.items.map(i => i.id));
      state.freshIds = new Set(data.items.filter(i => !known.has(i.id)).map(i => i.id));
      state.items = data.items;
      render();
    }
  });
}

function selectCategory(cat) {
  if (cat === state.category) return;
  state.category = cat;
  for (const b of catsEl.children) b.setAttribute('aria-current', String(b.dataset.cat === cat));
  history.replaceState(null, '', `#${cat}`);
  load(cat);
  connectStream(cat);
}

// ---------------------------------------------------------------- setup

async function initCategories() {
  const res = await fetch('/api/categories');
  const { categories } = await res.json();
  catsEl.replaceChildren(...categories.map(c => {
    const b = el('button', 'cat');
    b.type = 'button';
    b.dataset.cat = c.id;
    b.title = c.sources.join(' · ');
    b.setAttribute('aria-current', String(c.id === state.category));
    b.appendChild(el('span', 'cat-icon', ICONS[c.id] || '•'));
    b.appendChild(el('span', null, c.label));
    b.addEventListener('click', () => {
      selectCategory(c.id);
      closeMenu({ restoreFocus: false });
    });
    return b;
  }));
  return categories.map(c => c.id);
}

function applyTheme(mode) {
  if (mode) document.documentElement.dataset.theme = mode;
  else delete document.documentElement.dataset.theme;
}

async function main() {
  applyTheme(localStorage.getItem('newsdeck-theme'));
  renderSkeleton();

  const ids = await initCategories();
  const hash = location.hash.slice(1);
  if (ids.includes(hash)) {
    state.category = hash;
    for (const b of catsEl.children) b.setAttribute('aria-current', String(b.dataset.cat === hash));
  }

  await load(state.category);
  connectStream(state.category);

  // Search (debounced).
  let t;
  searchEl.addEventListener('input', () => {
    $('#clearSearch').hidden = !searchEl.value;
    clearTimeout(t);
    t = setTimeout(() => { state.query = searchEl.value.trim(); render(); }, 120);
  });
  $('#clearSearch').addEventListener('click', () => {
    searchEl.value = '';
    state.query = '';
    $('#clearSearch').hidden = true;
    render();
    searchEl.focus();
  });

  // Show held-back items.
  $('#newbarBtn').addEventListener('click', () => {
    if (state.pending) {
      const known = new Set(state.items.map(i => i.id));
      state.freshIds = new Set(state.pending.filter(i => !known.has(i.id)).map(i => i.id));
      state.items = state.pending;
      state.pending = null;
      render();
    }
    newbar.hidden = true;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // Manual refresh.
  const refreshBtn = $('#refreshBtn');
  refreshBtn.addEventListener('click', async () => {
    refreshBtn.classList.add('spin');
    try {
      await fetch(`/api/refresh?category=${encodeURIComponent(state.category)}`, { method: 'POST' });
      await load(state.category, { skeleton: false });
    } finally {
      refreshBtn.classList.remove('spin');
    }
  });

  // Theme toggle: light → dark → system.
  $('#themeBtn').addEventListener('click', () => {
    const cur = localStorage.getItem('newsdeck-theme');
    const next = cur === 'dark' ? 'light' : cur === 'light' ? '' : 'dark';
    if (next) localStorage.setItem('newsdeck-theme', next);
    else localStorage.removeItem('newsdeck-theme');
    applyTheme(next);
  });

  sidebar().setAttribute('inert', '');   // closed on load
  menuBtn().addEventListener('click', toggleMenu);
  backdrop().addEventListener('click', () => closeMenu());

  const sourcesBtn = $('#sourcesBtn');
  sourcesBtn.addEventListener('click', () => {
    const box = $('#sources');
    box.hidden = !box.hidden;
    sourcesBtn.setAttribute('aria-expanded', String(!box.hidden));
  });

  // Keyboard shortcuts.
  document.addEventListener('keydown', e => {
    // Escape closes the menu from anywhere, including the search box.
    if (e.key === 'Escape' && menuIsOpen()) { closeMenu(); return; }
    if (e.target.tagName === 'INPUT' || e.metaKey || e.ctrlKey || e.altKey) {
      if (e.key === 'Escape' && e.target === searchEl) searchEl.blur();
      return;
    }
    if (e.key === '/') { e.preventDefault(); searchEl.focus(); }
    else if (e.key === 'm') toggleMenu();
    else if (e.key === 'r') refreshBtn.click();
    else if (e.key === 't') $('#themeBtn').click();
    else if (/^[1-9]$/.test(e.key)) {
      const btn = catsEl.children[Number(e.key) - 1];
      if (btn) btn.click();
    }
  });

  // Keep relative timestamps honest.
  setInterval(() => {
    for (const n of feedEl.querySelectorAll('.time')) {
      n.textContent = relTime(Number(n.dataset.ts));
    }
    if (state.updatedAt) updatedEl.textContent = `Updated ${relTime(state.updatedAt)}`;
  }, 30_000);

  // A tab that slept can miss SSE events — resync on focus.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) load(state.category, { skeleton: false });
  });
}

main();
