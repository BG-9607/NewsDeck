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
  activeStoryId: null,
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

function articleUrl(item) {
  const params = new URLSearchParams();
  if (item.link) params.set('url', item.link);
  params.set('category', state.category);
  if (item.id) params.set('id', item.id);
  if (item.title) params.set('title', item.title);
  if (item.source) params.set('source', item.source);
  if (item.summary) params.set('summary', item.summary);
  if (item.image) params.set('image', item.image);
  if (item.author) params.set('author', item.author);
  if (item.publishedAt) params.set('publishedAt', String(item.publishedAt));
  if (item.alsoIn && item.alsoIn.length) params.set('also', item.alsoIn.join(','));
  return `/article.html?${params.toString()}`;
}

// ---------------------------------------------------------------- rendering

function cardFor(item) {
  const card = el('a', 'card');
  card.href = articleUrl(item);
  card.setAttribute('aria-label', `Read story: ${item.title}`);
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

// ---------------------------------------------------------------- reader modal

const readerBackdrop = () => $('#readerBackdrop');
const readerModal = () => $('#readerModal');
const readerIsOpen = () => !readerBackdrop().hidden && readerBackdrop().classList.contains('show');

function estimateReadTime(text) {
  if (!text) return '1 min read';
  const words = text.trim().split(/\s+/).length;
  const mins = Math.max(1, Math.round(words / 40));
  return `${mins} min read`;
}

function openReader(item) {
  state.activeStoryId = item.id;
  const items = visibleItems();
  const index = items.findIndex(i => i.id === item.id);

  // Position indicator
  const posEl = $('#readerPos');
  if (posEl) {
    posEl.textContent = index >= 0 ? `${index + 1} of ${items.length}` : '';
  }

  // Prev / Next button states
  const prevBtn = $('#readerPrevBtn');
  const nextBtn = $('#readerNextBtn');
  if (prevBtn) prevBtn.disabled = items.length <= 1;
  if (nextBtn) nextBtn.disabled = items.length <= 1;

  // Hero image
  const heroEl = $('#readerHero');
  const imgEl = $('#readerImg');
  const imgUrl = safeUrl(item.image);
  if (imgUrl) {
    heroEl.hidden = false;
    imgEl.src = imgUrl;
    imgEl.onerror = () => { heroEl.hidden = true; };
  } else {
    heroEl.hidden = true;
    imgEl.src = '';
  }

  // Metadata
  $('#readerSource').textContent = item.source || 'News';
  const timeEl = $('#readerTime');
  timeEl.textContent = relTime(item.publishedAt);
  timeEl.dataset.ts = item.publishedAt || 0;

  const authorEl = $('#readerAuthor');
  authorEl.textContent = item.author ? `· by ${item.author}` : '';

  const readTimeEl = $('#readerReadTime');
  readTimeEl.textContent = estimateReadTime((item.title || '') + ' ' + (item.summary || ''));

  // Title & Summary
  $('#readerTitle').textContent = item.title;
  $('#readerSummary').textContent = item.summary || 'No further summary available in the feed. You can read the full report directly on the publisher’s website using the link below.';

  // Also covered on
  const alsoEl = $('#readerAlso');
  const alsoTags = $('#readerAlsoTags');
  if (item.alsoIn && item.alsoIn.length) {
    alsoEl.hidden = false;
    alsoTags.replaceChildren(...item.alsoIn.map(src => el('span', 'reader-also-tag', src)));
  } else {
    alsoEl.hidden = true;
    alsoTags.replaceChildren();
  }

  // Action links
  const href = safeUrl(item.link) || '#';
  const extBtn = $('#readerExtBtn');
  extBtn.href = href;

  const primLink = $('#readerPrimaryLink');
  primLink.href = href;
  $('#readerPrimarySource').textContent = item.source || 'source';

  // Open modal
  const bd = readerBackdrop();
  bd.hidden = false;
  requestAnimationFrame(() => bd.classList.add('show'));
  $('#readerContent').scrollTop = 0;
  readerModal().focus();
}

function closeReader() {
  if (!readerIsOpen()) return;
  state.activeStoryId = null;
  const bd = readerBackdrop();
  bd.classList.remove('show');
  setTimeout(() => { if (!state.activeStoryId) bd.hidden = true; }, 220);
}

function navigateReader(delta) {
  const items = visibleItems();
  if (!items.length) return;
  let idx = items.findIndex(i => i.id === state.activeStoryId);
  if (idx === -1) idx = 0;
  let nextIdx = idx + delta;
  if (nextIdx < 0) nextIdx = items.length - 1;
  else if (nextIdx >= items.length) nextIdx = 0;
  openReader(items[nextIdx]);
}

async function copyReaderLink() {
  const items = visibleItems();
  const cur = items.find(i => i.id === state.activeStoryId);
  if (!cur || !cur.link) return;
  const copyBtn = $('#readerCopyBtn');
  try {
    await navigator.clipboard.writeText(cur.link);
    const prev = copyBtn.textContent;
    copyBtn.textContent = '✓';
    copyBtn.title = 'Link copied!';
    setTimeout(() => {
      copyBtn.textContent = prev;
      copyBtn.title = 'Copy article link';
    }, 1400);
  } catch {
    copyBtn.title = 'Could not copy';
  }
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

  // Reader modal listeners
  $('#readerCloseBtn').addEventListener('click', closeReader);
  $('#readerBackdrop').addEventListener('click', e => {
    if (e.target === $('#readerBackdrop')) closeReader();
  });
  $('#readerPrevBtn').addEventListener('click', () => navigateReader(-1));
  $('#readerNextBtn').addEventListener('click', () => navigateReader(1));
  $('#readerCopyBtn').addEventListener('click', copyReaderLink);

  const sourcesBtn = $('#sourcesBtn');
  sourcesBtn.addEventListener('click', () => {
    const box = $('#sources');
    box.hidden = !box.hidden;
    sourcesBtn.setAttribute('aria-expanded', String(!box.hidden));
  });

  // Keyboard shortcuts.
  document.addEventListener('keydown', e => {
    // Reader modal shortcuts take precedence when modal is open.
    if (readerIsOpen()) {
      if (e.key === 'Escape') { e.preventDefault(); closeReader(); return; }
      if (e.key === 'ArrowLeft' || e.key === 'j' || e.key === 'J') { e.preventDefault(); navigateReader(-1); return; }
      if (e.key === 'ArrowRight' || e.key === 'k' || e.key === 'K') { e.preventDefault(); navigateReader(1); return; }
    }

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
    const readerTime = $('#readerTime');
    if (readerTime && readerTime.dataset.ts) {
      readerTime.textContent = relTime(Number(readerTime.dataset.ts));
    }
    if (state.updatedAt) updatedEl.textContent = `Updated ${relTime(state.updatedAt)}`;
  }, 30_000);

  // A tab that slept can miss SSE events — resync on focus.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) load(state.category, { skeleton: false });
  });
}

main();

