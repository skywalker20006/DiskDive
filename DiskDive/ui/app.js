'use strict';

/* ============================================================ bridge to the C# backend */

const native = window.chrome && window.chrome.webview;
const pending = new Map();
let seq = 1;

if (native) native.addEventListener('message', e => settle(e.data));

function settle(msg) {
  const p = pending.get(msg.id);
  if (!p) return;
  pending.delete(msg.id);
  if (msg.ok) p.resolve(msg.data); else p.reject(new Error(msg.error || 'Something went wrong'));
}

function call(cmd, args) {
  const id = seq++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const msg = { id, cmd, args: args || {} };
    if (native) { native.postMessage(msg); return; }
    // Developer mode (app started with --dev): same API over loopback HTTP.
    fetch('/api', { method: 'POST', headers: { 'X-DQ': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(msg) })
      .then(r => r.json()).then(settle)
      .catch(err => { pending.delete(id); reject(err); });
  });
}

/* ============================================================ helpers */

const $ = s => document.querySelector(s);
const KB = 1024, MB = KB * 1024, GB = MB * 1024;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmt(b) {
  if (b < KB) return Math.round(b) + ' B';
  const units = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  do { b /= KB; i++; } while (b >= KB && i < units.length - 1);
  return (b >= 100 ? b.toFixed(0) : b >= 10 ? b.toFixed(1) : b.toFixed(2)) + ' ' + units[i];
}
const num = n => Math.round(n).toLocaleString('en-US');
function ago(ms) {
  if (!ms || ms < 0) return 'unknown';
  const days = (Date.now() - ms) / 864e5;
  if (days < 1) return 'today';
  if (days < 2) return 'yesterday';
  if (days < 31) return Math.floor(days) + ' days ago';
  if (days < 365) return Math.floor(days / 30.4) + ' months ago';
  const y = Math.floor(days / 365);
  return y + (y === 1 ? ' year ago' : ' years ago');
}
/** Turns a byte count into something you can picture. */
function like(b) {
  if (b >= 60 * GB) return '≈ ' + (b / (60 * GB)).toFixed(1) + ' big game installs';
  if (b >= 2 * GB) return '≈ ' + (b / (4 * GB)).toFixed(1) + ' HD movies';
  if (b >= 6 * MB) return '≈ ' + num(b / (3 * MB)) + ' phone photos';
  if (b >= 200 * KB) return '≈ ' + num(b / (2 * KB)) + ' pages of text';
  return '';
}

/* ============================================================ categories (colour = file type) */

// Fixed order: a type always keeps its colour. Hues are a validated colour-blind-safe set for dark surfaces;
// "Other" and "System" are neutral greys.
const CATS = [
  { name: 'Other', color: '#5a5955', icon: '📄' },
  { name: 'Video', color: '#3987e5', icon: '🎬' },
  { name: 'Images', color: '#d95926', icon: '🖼️' },
  { name: 'Audio', color: '#199e70', icon: '🎵' },
  { name: 'Documents', color: '#c98500', icon: '📑' },
  { name: 'Archives & disk images', color: '#d55181', icon: '🗜️' },
  { name: 'Code & dev files', color: '#0ca30c', icon: '🧩' },
  { name: 'Apps & libraries', color: '#9085e9', icon: '⚙️' },
  { name: 'Game data', color: '#e66767', icon: '🎮' },
  { name: 'System & temp', color: '#85837c', icon: '🧱' },
];
const LEGEND_ORDER = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];

/* ============================================================ progression */

const LEVELS = [
  [0, 'Dust Bunny'], [100, 'Tidy Rookie'], [500, 'Byte Sweeper'], [2000, 'Cache Crusher'],
  [5000, 'Gigabyte Hunter'], [15000, 'Storage Ranger'], [50000, 'Disk Sage'], [200000, 'Terabyte Legend'],
];
const TROPHIES = [
  { k: 'scout', icon: '🧭', name: 'First Expedition', desc: 'Finish your first scan', test: p => p.scans >= 1 },
  { k: 'sweep', icon: '🧹', name: 'First Sweep', desc: 'Recycle your first item', test: p => p.itemsTrashed >= 1 },
  { k: 'gig', icon: '⚔️', name: 'Gigabyte Slayer', desc: 'Free 1 GB in total', test: p => p.freedBytes >= GB },
  { k: 'ten', icon: '🛡️', name: 'Ten-Gig Titan', desc: 'Free 10 GB in total', test: p => p.freedBytes >= 10 * GB },
  { k: 'hundred', icon: '👑', name: 'Hundred-Gig Hero', desc: 'Free 100 GB in total', test: p => p.freedBytes >= 100 * GB },
  { k: 'boss', icon: '🐗', name: 'Big Game', desc: 'Recycle one item over 1 GB', test: p => p.biggestTrash >= GB },
  { k: 'haul', icon: '🧺', name: 'One Fell Swoop', desc: 'Free 5 GB with a single bag', test: p => p.biggestHaul >= 5 * GB },
  { k: 'tidy', icon: '🌱', name: 'Spring Cleaner', desc: 'Recycle 50 items', test: p => p.itemsTrashed >= 50 },
  { k: 'deep', icon: '🤿', name: 'Deep Diver', desc: 'Dive 8 folders deep', test: p => p.maxDepth >= 8 },
  { k: 'carto', icon: '🗺️', name: 'Cartographer', desc: 'Complete 5 scans', test: p => p.scans >= 5 },
  { k: 'hoard', icon: '🐉', name: "Dragon's Hoard", desc: 'Map 250 GB in one scan', test: p => p.biggestScan >= 250 * GB },
  { k: 'whale', icon: '🐋', name: 'Whale Watcher', desc: 'Map 1 TB across all scans', test: p => p.scannedBytes >= 1024 * GB },
];
const QUESTS = {
  old: { icon: '🕸️', title: 'Forgotten Giants', desc: "Files over 100 MB you haven't touched in a year." },
  installers: { icon: '📦', title: 'Installer Graveyard', desc: 'Setup files and archives left behind in Downloads.' },
  dev: { icon: '🧪', title: 'Dev Leftovers', desc: 'node_modules, virtual envs and caches. A reinstall brings them back.' },
  temp: { icon: '🧹', title: 'Temp Piles', desc: 'Big items sitting in temp folders.' },
  twins: { icon: '👯', title: 'Suspected Twins', desc: 'Large files with the same name and size. Probably copies: keep one.' },
};
const STAT_KEYS = ['scans', 'itemsTrashed', 'freedBytes', 'biggestTrash', 'biggestHaul', 'maxDepth', 'biggestScan', 'scannedBytes'];

let profile = null;

function normalise(p) {
  const out = {};
  for (const k of STAT_KEYS) out[k] = (p && p[k]) || 0;
  return out;
}
const xpOf = p => Math.floor(p.freedBytes / MB) + p.scans * 25;
function levelOf(p) {
  const xp = xpOf(p);
  let i = 0;
  while (i + 1 < LEVELS.length && xp >= LEVELS[i + 1][0]) i++;
  const next = LEVELS[i + 1];
  return { n: i + 1, title: LEVELS[i][1], xp, floor: LEVELS[i][0], next: next ? next[0] : null };
}

/** Stores the latest stats and celebrates anything newly earned. */
function setProfile(raw, announce) {
  const before = profile;
  profile = normalise(raw);
  if (announce && before) {
    const was = levelOf(before), now = levelOf(profile);
    if (now.n > was.n) {
      toast('⭐', 'Level ' + now.n + ': ' + now.title, 'You levelled up!', true);
      confetti();
    }
    for (const t of TROPHIES)
      if (t.test(profile) && !t.test(before)) toast(t.icon, 'Trophy: ' + t.name, t.desc, true);
  }
  renderPlayer();
  if (tab === 'trophies' && view) renderPanel();
}

function renderPlayer() {
  const l = levelOf(profile);
  const pct = l.next ? Math.min(100, ((l.xp - l.floor) / (l.next - l.floor)) * 100) : 100;
  $('#player').innerHTML =
    `<div class="lvl" title="Level ${l.n}">${l.n}</div>
     <div class="pl-main">
       <div class="pl-title"><b>${esc(l.title)}</b><span>${num(l.xp)}${l.next ? ' / ' + num(l.next) : ''} XP</span></div>
       <div class="xp"><i style="width:${pct}%"></i></div>
     </div>
     <div class="pl-freed"><b>${fmt(profile.freedBytes)}</b>reclaimed</div>`;
}

/* ============================================================ state */

let view = null;            // current folder payload from the backend
let byId = new Map();       // node id -> laid-out node
let sel = null;             // item shown in the detail card (from `info`)
let hover = null;           // node under the cursor
let pulse = -1;             // node id highlighted from a list
let filterCat = -1;         // category highlighted from the legend / types tab
let tab = 'hogs';
let busy = false;
let hogs = [], types = [], quests = [];
let openQuest = null;
const bag = new Map();      // id -> item queued for the Recycle Bin
const known = new Map();    // id -> item metadata seen in lists

/* ============================================================ screens */

function show(screen) {
  for (const s of ['home', 'scanning', 'explore']) $('#' + s).classList.toggle('hidden', s !== screen);
  $('#btnNew').classList.toggle('hidden', screen !== 'explore');
  if (screen !== 'explore') $('#crumbs').innerHTML = '';
}

async function loadHome() {
  const home = await call('home');
  setProfile(home.profile, false);
  $('#drives').innerHTML = home.drives.map(d => {
    const used = d.total - d.free, pct = d.total ? (used / d.total) * 100 : 0;
    return `<button class="drive" data-scan="${esc(d.path)}" data-expect="${used}">
        <div class="drive-head"><span class="drive-letter">${esc(d.path.replace(/\\$/, ''))}</span>
          <span class="drive-label">${esc(d.label || 'Local disk')}</span></div>
        <div class="meter ${pct > 90 ? 'full' : ''}"><i style="width:${pct}%"></i></div>
        <div class="drive-nums"><span><b>${fmt(used)}</b> used of ${fmt(d.total)}</span><span>${fmt(d.free)} free</span></div>
      </button>`;
  }).join('');
  $('#places').innerHTML = home.places.map(p =>
    `<button class="place" data-scan="${esc(p.path)}" title="${esc(p.path)}">${esc(p.name)}</button>`).join('') +
    `<button class="place pick" id="pick">Choose a folder…</button>`;
}

document.addEventListener('click', async e => {
  const scanBtn = e.target.closest('[data-scan]');
  if (scanBtn) { startScan(scanBtn.dataset.scan, Number(scanBtn.dataset.expect) || 0); return; }
  if (e.target.closest('#pick')) {
    const r = await call('pick');
    if (r.path) startScan(r.path, 0);
  }
});
$('#brand').addEventListener('click', goHome);
$('#btnNew').addEventListener('click', goHome);
function goHome() {
  if (!$('#scanning').classList.contains('hidden')) return;
  show('home');
  loadHome().catch(fail);
}

/* ---------- scanning ---------- */

const TIPS = [
  'Colour shows the file type. Size shows, well, the size.',
  'Everything you clean up goes to the Recycle Bin first.',
  'Check the Quests tab after the scan for the easy wins.',
  'Right-click anywhere on the map to climb back up a level.',
  'Online-only cloud files are skipped: they take no disk space.',
  'Reclaimed space earns XP. Big game hunting pays best.',
];
let scanTimer = 0;

async function startScan(path, expect) {
  try { await call('scan', { path }); } catch (err) { fail(err); return; }
  view = null; sel = null; bag.clear(); known.clear(); openQuest = null;
  renderBag();
  show('scanning');
  $('#scanRoot').textContent = path;
  $('#scanBar').classList.toggle('hidden', !expect);
  let tip = Math.floor(Math.random() * TIPS.length);
  $('#scanTip').textContent = TIPS[tip];
  let ticks = 0, finished = false;
  clearInterval(scanTimer);
  scanTimer = setInterval(async () => {
    let s;
    try { s = await call('status'); } catch { return; }
    if (++ticks % 28 === 0) $('#scanTip').textContent = TIPS[++tip % TIPS.length];
    $('#scBytes').textContent = fmt(s.bytes || 0);
    $('#scFiles').textContent = num(s.files || 0);
    $('#scDirs').textContent = num(s.dirs || 0);
    $('#scTime').textContent = ((s.ms || 0) / 1000).toFixed(1) + ' s';
    $('#scanPath').textContent = s.current || '';
    if (expect) $('#scanBar').firstElementChild.style.width = Math.min(100, (s.bytes / expect) * 100) + '%';
    if (s.state === 'scanning' || finished) return;
    finished = true;
    clearInterval(scanTimer);
    if (s.state === 'done') {
      show('explore');
      resize();
      await go(0, 'jump');
      setProfile(s.profile, true);
      toast('🗺️', 'Map ready: ' + fmt(s.bytes), num(s.files) + ' files in ' + (s.ms / 1000).toFixed(1) + ' s');
      if (s.cloud > 0) toast('☁️', fmt(s.cloud) + ' is online-only', 'Cloud files that take no disk space were skipped.');
      loadQuests();
    } else {
      if (s.state === 'error') toast('⚠️', "Couldn't scan that", s.error || '');
      show('home');
      loadHome().catch(fail);
    }
  }, 120);
}
$('#btnCancel').addEventListener('click', () => call('cancel'));

/* ============================================================ treemap */

const wrap = $('#mapWrap'), map = $('#map'), ctx = map.getContext('2d');
let W = 0, H = 0, dpr = 1;
const SHADES = ['#242422', '#2c2c2a', '#343431', '#3b3b38'];
const HEAD = 17, PAD = 3;

function resize() {
  const r = wrap.getBoundingClientRect();
  if (!r.width || !r.height) return;
  dpr = window.devicePixelRatio || 1;
  W = Math.floor(r.width); H = Math.floor(r.height);
  map.width = Math.round(W * dpr); map.height = Math.round(H * dpr);
  map.style.width = W + 'px'; map.style.height = H + 'px';
  if (view) { layoutAll(); draw(); }
}
new ResizeObserver(resize).observe(wrap);

function layoutAll() {
  baseDirty = true;
  byId = new Map();
  if (view && W && H) layout(view.tree, 0, 0, W, H, 0, null);
}

function layout(n, x, y, w, h, depth, parent) {
  n.x = x; n.y = y; n.w = w; n.h = h; n.depth = depth; n.parent = parent; n.open = false;
  if (!n.rest) byId.set(n.id, n);
  if (!n.kids || !n.kids.length) return;
  if (depth > 0 && (w < 56 || h < 46)) return;          // too small to open: draw as one block
  const head = depth ? HEAD : 0, pad = depth ? PAD : 0;
  if (!n.items) {
    n.items = n.kids.slice();
    if (n.restSize > 0) n.items.push({ id: -1 - n.id, rest: true, size: n.restSize, count: n.restCount, cat: 0, name: num(n.restCount) + ' smaller items' });
    n.items.sort((a, b) => b.size - a.size);
  }
  n.open = true;
  squarify(n.items, x + pad, y + head, w - pad * 2, h - head - pad, (it, rx, ry, rw, rh) => layout(it, rx, ry, rw, rh, depth + 1, n));
}

/** Squarified treemap: fills the rectangle with blocks that stay as close to square as possible. */
function squarify(items, x, y, w, h, place) {
  let total = 0;
  for (const it of items) total += it.size;
  if (total <= 0 || w <= 0 || h <= 0) { for (const it of items) place(it, x, y, 0, 0); return; }
  const scale = (w * h) / total;
  let i = 0;
  while (i < items.length) {
    const short = Math.min(w, h);
    let area = 0, max = 0, min = Infinity, best = Infinity, j = i;
    while (j < items.length) {
      const a = items[j].size * scale;
      const na = area + a, nmax = Math.max(max, a), nmin = Math.min(min, a);
      const worst = Math.max((short * short * nmax) / (na * na), (na * na) / (short * short * Math.max(nmin, 1e-9)));
      if (j > i && worst > best) break;
      best = worst; area = na; max = nmax; min = nmin; j++;
    }
    const thick = short > 0 ? area / short : 0;
    if (w >= h) {
      let yy = y;
      for (let k = i; k < j; k++) { const hh = thick ? (items[k].size * scale) / thick : 0; place(items[k], x, yy, thick, hh); yy += hh; }
      x += thick; w -= thick;
    } else {
      let xx = x;
      for (let k = i; k < j; k++) { const ww = thick ? (items[k].size * scale) / thick : 0; place(items[k], xx, y, ww, thick); xx += ww; }
      y += thick; h -= thick;
    }
    i = j;
  }
}

function rr(c, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  c.beginPath();
  c.roundRect(x, y, w, h, r);
}

/** Shortens a label to fit. Widths are cached on the node so animation frames rarely measure text. */
function clip(c, n, text, maxW) {
  if (n._text !== text) { n._text = text; n._tw = c.measureText(text).width; n._cw = -1; }
  if (n._tw <= maxW) return text;
  const key = Math.round(maxW);
  if (n._cw === key) return n._cut;
  let k = Math.floor((text.length * maxW) / n._tw) - 1;
  while (k > 1 && c.measureText(text.slice(0, k) + '…').width > maxW) k--;
  n._cw = key;
  return (n._cut = k > 1 ? text.slice(0, k) + '…' : '');
}

/** Paints the whole map (no hover/selection overlays) onto any 2D context. */
function render(c, tree) {
  c.clearRect(0, 0, W, H);
  c.textBaseline = 'middle';
  if (tree || view) paint(c, tree || view.tree);
  c.globalAlpha = 1;
}

function paint(c, n) {
  if (n.w < 0.6 || n.h < 0.6) return;
  if (n.x >= W || n.y >= H || n.x + n.w <= 0 || n.y + n.h <= 0) return;   // off screen (mid-zoom)
  if (n.open) {
    if (n.depth > 0 && n.w > 2 && n.h > 2) {
      c.globalAlpha = 1;
      c.fillStyle = SHADES[Math.min(n.depth - 1, SHADES.length - 1)];
      rr(c, n.x + 1, n.y + 1, n.w - 2, n.h - 2, 5);
      c.fill();
      if (n.w > 44 && n.h > HEAD + 4) {
        c.font = '600 11px system-ui, "Segoe UI", sans-serif';
        if (n._sw === undefined) { n._size = fmt(n.size); n._sw = c.measureText(n._size).width; }
        const room = n.w - 14, withSize = room > n._sw + 60;
        c.fillStyle = '#c3c2b7';
        const name = clip(c, n, n.name, room - (withSize ? n._sw + 10 : 0));
        if (name) c.fillText(name, n.x + 7, n.y + HEAD / 2 + 1.5);
        if (withSize) {
          c.fillStyle = '#898781';
          c.textAlign = 'right';
          c.fillText(n._size, n.x + n.w - 7, n.y + HEAD / 2 + 1.5);
          c.textAlign = 'left';
        }
      }
    }
    for (const k of n.items) paint(c, k);
    return;
  }

  // Leaf block: a file, a folder too small to open, or the "smaller items" roll-up.
  const g = n.w > 6 && n.h > 6 ? 1 : 0.25;
  const x = n.x + g, y = n.y + g, w = n.w - g * 2, h = n.h - g * 2;
  if (w <= 0 || h <= 0) return;
  const dim = filterCat >= 0 && (n.rest || n.cat !== filterCat);
  c.globalAlpha = (dim ? 0.13 : n.rest ? 0.5 : n.dir ? 0.72 : 1);
  c.fillStyle = n.rest ? '#3d3d3a' : CATS[n.cat].color;
  rr(c, x, y, w, h, 4);
  c.fill();
  if (w >= 54 && h >= 20) {
    c.globalAlpha = (dim ? 0.3 : 1);
    c.fillStyle = '#ffffff';
    c.font = '600 12px system-ui, "Segoe UI", sans-serif';
    const two = h >= 38;
    if (n._label === undefined) { n._label = (n.dir ? '▸ ' : '') + n.name; n._size = fmt(n.size); }
    const label = clip(c, n, n._label, w - 12);
    if (label) c.fillText(label, x + 6, y + (two ? 13 : h / 2 + 0.5));
    if (two && label) {
      c.globalAlpha = (dim ? 0.25 : 0.82);
      c.font = '11px system-ui, "Segoe UI", sans-serif';
      c.fillText(n._size, x + 6, y + 28);
    }
  }
}

let hatch = null;
function hatchPattern() {
  if (hatch) return hatch;
  const p = document.createElement('canvas');
  p.width = p.height = 10;
  const pc = p.getContext('2d');
  pc.strokeStyle = 'rgba(255,255,255,.75)';
  pc.lineWidth = 2;
  pc.beginPath();
  pc.moveTo(-2, 12); pc.lineTo(12, -2); pc.moveTo(-7, 7); pc.lineTo(7, -7); pc.moveTo(3, 17); pc.lineTo(17, 3);
  pc.stroke();
  return (hatch = ctx.createPattern(p, 'repeat'));
}

function outline(n, color, width) {
  ctx.globalAlpha = 1;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  rr(ctx, n.x + 1, n.y + 1, Math.max(1, n.w - 2), Math.max(1, n.h - 2), 5);
  ctx.stroke();
}

// The map itself is painted once into `base`; hover, selection and bag overlays are drawn over a copy
// of it, so moving the mouse never repaints thousands of blocks.
const base = document.createElement('canvas');
let baseDirty = true;

function draw() {
  if (baseDirty || base.width !== map.width || base.height !== map.height) {
    base.width = map.width; base.height = map.height;
    const bc = base.getContext('2d');
    bc.setTransform(dpr, 0, 0, dpr, 0, 0);
    render(bc);
    baseDirty = false;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, map.width, map.height);
  ctx.drawImage(base, 0, 0);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // Items waiting in the bag are struck through with a hatch.
  for (const id of bag.keys()) {
    const n = byId.get(id);
    if (!n || n.w < 2 || n.h < 2) continue;
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(13,13,13,.6)';
    rr(ctx, n.x + 1, n.y + 1, n.w - 2, n.h - 2, 5);
    ctx.fill();
    ctx.fillStyle = hatchPattern();
    ctx.fill();
  }
  if (hover && !hover.rest && hover !== view.tree) {
    ctx.globalAlpha = 0.14;
    ctx.fillStyle = '#fff';
    rr(ctx, hover.x + 1, hover.y + 1, hover.w - 2, hover.h - 2, 5);
    ctx.fill();
    outline(hover, 'rgba(255,255,255,.85)', 1.5);
  }
  const s = sel && byId.get(sel.id);
  if (s && s !== view.tree) outline(s, '#ffffff', 2.5);
  const p = pulse >= 0 && byId.get(pulse);
  if (p && p !== view.tree) { outline(p, '#0d0d0d', 5); outline(p, '#fab219', 2.5); }
  ctx.globalAlpha = 1;
}

function hit(px, py) {
  let n = view && view.tree;
  if (!n || px < 0 || py < 0 || px > W || py > H) return null;
  for (;;) {
    if (!n.open) return n;
    let next = null;
    for (const k of n.items) {
      if (px >= k.x && px < k.x + k.w && py >= k.y && py < k.y + k.h) { next = k; break; }
    }
    if (!next) return n;
    n = next;
  }
}

/** The deepest block on screen for an item, walking up its ancestors if it is too small to be drawn. */
function visibleId(chain) {
  for (let i = chain.length - 1; i >= 0; i--) if (byId.has(chain[i])) return chain[i];
  return -1;
}

/* ---------- navigation with zoom animation ---------- */

let ZOOM_MS = 420;

async function go(id, how) {
  if (busy) return;
  busy = true;
  try {
    let next;
    try { next = await call('view', { id, depth: 8 }); }
    catch (err) { fail(err); return; }
    const old = view;
    const animate = !!old && W > 0 && how !== 'jump' && !reduceMotion;
    const snap = animate ? snapshot() : null;
    const from = animate && how === 'in' ? contentRect(byId.get(next.tree.id)) : null;

    view = next; hover = null; pulse = -1; sel = null;
    hideTip();
    layoutAll();
    renderCrumbs();
    const lists = fetchLists(view.tree.id);   // ask now, show after the animation so it never stutters
    const to = animate && how === 'out' ? contentRect(byId.get(old.tree.id)) : null;

    if (from) await zoom(old.tree, from, true, null);
    else if (to) await zoom(view.tree, to, false, snap);
    draw();

    selectCurrent();
    lists.then(showLists);
    const depth = view.crumbs.length - 1;
    if (profile && depth > profile.maxDepth) call('bump', { key: 'maxDepth', value: depth, mode: 'max' }).then(p => setProfile(p, true));
  } finally { busy = false; }
}

function snapshot() {
  const c = document.createElement('canvas');
  c.width = map.width; c.height = map.height;
  c.getContext('2d').drawImage(map, 0, 0);
  return c;
}

/** The part of a folder's block that holds its contents (inside the title strip and border). */
function contentRect(n) {
  if (!n || n.w < 8 || n.h < 8) return null;
  const r = n.open && n.depth > 0
    ? { x: n.x + PAD, y: n.y + HEAD, w: n.w - PAD * 2, h: n.h - HEAD - PAD }
    : { x: n.x, y: n.y, w: n.w, h: n.h };
  return r.w > 4 && r.h > 4 ? r : null;
}

/**
 * Camera-style zoom. The map is redrawn every frame with its blocks moved and resized, so everything
 * stays sharp and labels never stretch.
 *   Diving in:    the old map zooms until the chosen folder fills the view, then the more detailed
 *                 picture of that folder fades in over it.
 *   Climbing out: the new map starts zoomed in on the folder we came from and pulls back, while the
 *                 old picture shrinks into that folder's block and fades.
 */
function zoom(tree, rect, diving, snap) {
  return new Promise(done => {
    const nodes = [];
    (function walk(n) {
      n.b = { x: n.x, y: n.y, w: n.w, h: n.h };
      nodes.push(n);
      if (n.open) for (const k of n.items) walk(k);
    })(tree);

    let fresh = null;           // finished picture of the new view, faded in at the end of a dive
    if (diving) {
      fresh = document.createElement('canvas');
      fresh.width = map.width; fresh.height = map.height;
      const fc = fresh.getContext('2d');
      fc.setTransform(dpr, 0, 0, dpr, 0, 0);
      render(fc);
      fc.globalCompositeOperation = 'destination-over';
      fc.fillStyle = '#1a1a19';
      fc.fillRect(0, 0, W, H);
    }

    const full = { x: 0, y: 0, w: W, h: H };
    const a = diving ? rect : full, b = diving ? full : rect;
    const smooth = v => { v = Math.min(1, Math.max(0, v)); return v * v * (3 - 2 * v); };
    const t0 = performance.now();
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;
      for (const n of nodes) { n.x = n.b.x; n.y = n.b.y; n.w = n.b.w; n.h = n.b.h; }
      baseDirty = true;
      done();
    };
    setTimeout(finish, ZOOM_MS + 300);   // never get stuck if the window is hidden

    const frame = now => {
      if (finished) return;
      const t = Math.min(1, Math.max(0, (now - t0) / ZOOM_MS));
      const z = 1 - Math.pow(1 - t, 3);
      // Where `rect` sits on screen right now.
      const cx = a.x + (b.x - a.x) * z, cy = a.y + (b.y - a.y) * z;
      const cw = a.w + (b.w - a.w) * z, ch = a.h + (b.h - a.h) * z;
      const sx = cw / rect.w, sy = ch / rect.h;
      for (const n of nodes) {
        n.x = cx + (n.b.x - rect.x) * sx; n.y = cy + (n.b.y - rect.y) * sy;
        n.w = n.b.w * sx; n.h = n.b.h * sy;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      render(ctx, tree);
      if (diving) {
        const alpha = smooth((t - 0.35) / 0.65);
        if (alpha > 0) { ctx.globalAlpha = alpha; ctx.drawImage(fresh, 0, 0, W, H); }
      } else {
        const alpha = 1 - smooth(t / 0.55);
        if (alpha > 0) { ctx.globalAlpha = alpha; ctx.drawImage(snap, cx, cy, cw, ch); }
      }
      ctx.globalAlpha = 1;
      if (t < 1) requestAnimationFrame(frame); else finish();
    };
    frame(t0);
  });
}

function up() {
  if (view && view.parent >= 0) go(view.parent, 'out');
}

function renderCrumbs() {
  const c = view.crumbs;
  let html = `<button class="up" data-up title="Up one level (Backspace)" ${c.length > 1 ? '' : 'disabled'}>↑</button>`;
  const start = Math.max(0, c.length - 5);
  if (start > 0) html += `<span class="sep">…</span>`;
  for (let i = start; i < c.length; i++) {
    if (i > start || start > 0) html += `<span class="sep">›</span>`;
    const here = i === c.length - 1;
    html += `<button class="${here ? 'here' : ''}" data-go="${c[i].id}" title="${esc(c[i].name)}">${esc(c[i].name)}</button>`;
  }
  $('#crumbs').innerHTML = html;
}
$('#crumbs').addEventListener('click', e => {
  if (e.target.closest('[data-up]')) { up(); return; }
  const b = e.target.closest('[data-go]');
  if (b && !b.classList.contains('here')) go(Number(b.dataset.go), 'out');
});

/* ---------- map interaction ---------- */

const tipEl = $('#tip');
function hideTip() { tipEl.classList.add('hidden'); }

function showTip(n, px, py) {
  const root = view.tree;
  const pct = root.size ? (n.size / root.size) * 100 : 0;
  let sub, hint;
  if (n.rest) { sub = 'Too small to draw one by one'; hint = n.parent === root ? '' : 'Click to open this folder'; }
  else if (n.dir || n.kids) { sub = `Folder · ${num(n.files)} files · mostly ${esc(CATS[n.cat].name.toLowerCase())}`; hint = 'Click to dive in · Shift-click to select'; }
  else { sub = `<i class="sw" style="background:${CATS[n.cat].color}"></i>${esc(CATS[n.cat].name)}`; hint = bag.has(n.id) ? 'In your bag' : 'Click to select'; }
  tipEl.innerHTML = `<b>${esc(n.name)}</b><div class="t-size">${fmt(n.size)} <span style="color:var(--muted);font-size:12px;font-weight:400">${pct >= 0.1 ? pct.toFixed(1) : '<0.1'}% of this view</span></div>
    <div class="t-sub">${sub}</div>${hint ? `<div class="t-hint">${hint}</div>` : ''}`;
  tipEl.classList.remove('hidden');
  const tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
  let x = px + 16, y = py + 18;
  if (x + tw > W - 6) x = px - tw - 12;
  if (y + th > H - 6) y = py - th - 12;
  tipEl.style.left = Math.max(6, x) + 'px';
  tipEl.style.top = Math.max(6, y) + 'px';
}

function pos(e) {
  const r = map.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}

map.addEventListener('mousemove', e => {
  if (busy || !view) return;
  const [px, py] = pos(e);
  const n = hit(px, py);
  const target = n && n !== view.tree ? n : null;
  if (target !== hover) { hover = target; draw(); }
  if (target) showTip(target, px, py); else hideTip();
});
map.addEventListener('mouseleave', () => { hover = null; hideTip(); if (view && !busy) draw(); });

map.addEventListener('click', e => {
  if (busy || !view) return;
  const n = hit(...pos(e));
  if (!n || n === view.tree) return;
  if (n.rest) {
    if (n.parent !== view.tree) go(n.parent.id, 'in');
    else toast('🔍', n.name, 'They are too small to draw. Dive into a folder to see more detail.');
    return;
  }
  const isDir = n.dir || n.kids;
  if (isDir && !e.shiftKey) go(n.id, 'in');
  else select(n.id);
});
map.addEventListener('contextmenu', e => { e.preventDefault(); if (!busy) up(); });

// One level per scroll gesture: a trackpad flick sends dozens of wheel events, which must not
// turn into dozens of dives.
let wheelLast = 0, wheelSum = 0, wheelUsed = false;
map.addEventListener('wheel', e => {
  e.preventDefault();
  const now = performance.now();
  if (now - wheelLast > 220) { wheelSum = 0; wheelUsed = false; }
  wheelLast = now;
  if (wheelUsed || busy || !view) return;
  wheelSum += e.deltaY;
  if (Math.abs(wheelSum) < 30) return;
  wheelUsed = true;
  if (wheelSum > 0) { up(); return; }
  let n = hit(...pos(e));                       // scroll up: dive one level towards the cursor
  while (n && n.parent && n.parent !== view.tree) n = n.parent;
  if (n && n !== view.tree && !n.rest && (n.dir || n.kids)) go(n.id, 'in');
}, { passive: false });

document.addEventListener('keydown', e => {
  if (!$('#modal').classList.contains('hidden')) { if (e.key === 'Escape') closeModal(); return; }
  if ($('#explore').classList.contains('hidden')) return;
  if (e.key === 'Backspace' || e.key === 'Escape') { e.preventDefault(); up(); }
  if (e.key === 'Delete' && sel && !sel.locked) toggleBag(sel.id);
});

/* ============================================================ selection + detail card */

let selSeq = 0;
async function select(id) {
  const token = ++selSeq;
  let item;
  try { item = await call('info', { id }); } catch (err) { fail(err); return; }
  if (token !== selSeq) return;          // a newer selection won the race
  known.set(id, item);
  sel = item;
  renderDetail();
  markRows();
  if (!busy) draw();
}
function selectCurrent() {
  if (view) select(view.tree.id);
}

function renderDetail() {
  const el = $('#detail');
  if (!sel) { el.innerHTML = ''; return; }
  const isRoot = view && sel.id === view.tree.id;
  const inBag = bag.has(sel.id);
  const meta = sel.dir
    ? `<span>${num(sel.files)} files</span><span><i class="sw" style="background:${CATS[sel.cat].color}"></i>mostly ${esc(CATS[sel.cat].name.toLowerCase())}</span>`
    : `<span><i class="sw" style="background:${CATS[sel.cat].color}"></i>${esc(CATS[sel.cat].name)}</span><span>changed ${ago(sel.mod)}</span>`;
  const comparison = like(sel.size);
  el.innerHTML =
    `<div class="d-head"><div class="d-icon">${sel.dir ? '📁' : CATS[sel.cat].icon}</div>
       <div style="min-width:0;flex:1"><div class="d-name">${esc(sel.name)}</div>
       <div class="d-path" title="${esc(sel.folder)}">&lrm;${esc(sel.folder)}</div></div></div>
     <div class="d-size">${fmt(sel.size)}</div>
     <div class="d-like">${comparison || '&nbsp;'}</div>
     <div class="d-meta">${meta}</div>
     <div class="d-actions">
       ${sel.locked
      ? `<div class="d-lock">🔒 ${esc(sel.why || 'Protected')}</div>`
      : `<button class="btn ${inBag ? '' : 'primary'}" data-bag="${sel.id}">${inBag ? 'Take out of bag' : '🧺 Add to bag'}</button>`}
       <button class="btn" data-reveal="${sel.id}">Show in Explorer</button>
       ${!isRoot && sel.pid >= 0 && (!view || sel.pid !== view.tree.id) ? `<button class="btn ghost" data-locate="${sel.id}">Find on map</button>` : ''}
     </div>`;
}

/* ============================================================ side panel */

document.querySelector('.tabs').addEventListener('click', e => {
  const b = e.target.closest('[data-tab]');
  if (!b) return;
  tab = b.dataset.tab;
  for (const t of document.querySelectorAll('.tabs button')) t.classList.toggle('on', t === b);
  renderPanel();
});

async function fetchLists(id) {
  try {
    const [h, t] = await Promise.all([call('top', { id, n: 40 }), call('types', { id })]);
    return { id, h, t };
  } catch (err) { fail(err); return null; }
}

function showLists(r) {
  if (!r || !view || view.tree.id !== r.id) return;
  hogs = r.h; types = r.t;
  for (const it of hogs) known.set(it.id, it);
  renderPanel();
  renderLegend();
}

async function loadQuests() {
  try { quests = await call('quests'); } catch { quests = []; }
  for (const q of quests) for (const it of q.items) known.set(it.id, it);
  const live = quests.filter(q => q.count > 0).length;
  const badge = $('#questBadge');
  badge.textContent = live;
  badge.classList.toggle('hidden', !live);
  if (tab === 'quests') renderPanel();
}

function rowHtml(it, rank, max) {
  const cls = ['row'];
  if (sel && sel.id === it.id) cls.push('sel');
  if (bag.has(it.id)) cls.push('bagged');
  return `<div class="${cls.join(' ')}" data-row="${it.id}">
      ${rank ? `<span class="rank ${rank <= 3 ? 'top' : ''}">${rank}</span>` : ''}
      <i class="sw" style="background:${CATS[it.cat].color}" title="${esc(CATS[it.cat].name)}"></i>
      <div class="r-main"><div class="r-name">${it.dir ? '📁 ' : ''}${esc(it.name)}</div>
        <div class="r-sub" title="${esc(it.folder)}">&lrm;${esc(it.folder)}</div>
        ${max ? `<div class="r-bar"><i style="width:${Math.max(1, (it.size / max) * 100)}%;background:${CATS[it.cat].color}"></i></div>` : ''}</div>
      <span class="r-size">${fmt(it.size)}</span>
      <button class="mini ${bag.has(it.id) ? 'on' : ''}" data-bag="${it.id}" title="${bag.has(it.id) ? 'Take out of bag' : 'Add to bag'}">${bag.has(it.id) ? '✓' : '+'}</button>
    </div>`;
}

function renderPanel() {
  const el = $('#panel');
  if (!view) { el.innerHTML = ''; return; }
  if (tab === 'hogs') {
    el.innerHTML = hogs.length
      ? `<div class="p-title">Biggest files in this folder</div>` + hogs.map((it, i) => rowHtml(it, i + 1, hogs[0].size)).join('')
      : `<div class="empty">No files in here.</div>`;
  } else if (tab === 'quests') {
    const live = quests.filter(q => q.count > 0);
    el.innerHTML = `<div class="p-title">Easy wins across the whole scan</div>` + (live.length ? '' : `<div class="empty">Nothing obvious to clear. This place is tidy!</div>`) +
      quests.map(q => {
        const d = QUESTS[q.key];
        const open = openQuest === q.key && q.count > 0;
        return `<div class="quest ${q.count ? '' : 'done'}">
          <div class="q-head" data-quest="${q.key}"><div class="q-icon">${d.icon}</div>
            <div class="q-main"><b>${d.title}</b><span>${d.desc}</span></div>
            <div class="q-loot"><b>${q.count ? fmt(q.total) : '✓'}</b><span>${q.count ? num(q.count) + (q.count === 1 ? ' item' : ' items') : 'clear'}</span></div></div>
          ${open ? `<div class="q-items">${q.items.map(it => rowHtml(it, 0, 0)).join('')}</div>
            ${q.count > q.items.length ? `<div class="q-more">Showing the ${q.items.length} largest of ${num(q.count)}.</div>` : ''}` : ''}
        </div>`;
      }).join('');
  } else if (tab === 'types') {
    const total = types.reduce((s, t) => s + t.size, 0);
    const list = types.filter(t => t.size > 0).sort((a, b) => b.size - a.size);
    el.innerHTML = `<div class="p-title">What this folder is made of</div>` + (list.length ? list.map(t => {
      const pct = total ? (t.size / total) * 100 : 0;
      return `<div class="type" data-cat="${t.cat}">
        <div class="type-top"><i class="sw" style="background:${CATS[t.cat].color}"></i><b>${esc(CATS[t.cat].name)}</b>
          <span>${fmt(t.size)}</span><em>${pct >= 0.1 ? pct.toFixed(1) : '<0.1'}%</em></div>
        <div class="type-bar"><i style="width:${pct}%;background:${CATS[t.cat].color}"></i></div>
        <div class="type-sub">${num(t.files)} files</div></div>`;
    }).join('') : `<div class="empty">No files in here.</div>`);
  } else {
    const l = levelOf(profile);
    const got = TROPHIES.filter(t => t.test(profile)).length;
    el.innerHTML = `<div class="p-title">Lifetime stats</div>
      <div class="stats">
        <div class="stat"><b>${fmt(profile.freedBytes)}</b><span>reclaimed</span></div>
        <div class="stat"><b>${num(profile.itemsTrashed)}</b><span>items recycled</span></div>
        <div class="stat"><b>${fmt(profile.biggestTrash)}</b><span>biggest catch</span></div>
        <div class="stat"><b>${num(profile.scans)}</b><span>scans · ${fmt(profile.scannedBytes)} mapped</span></div>
      </div>
      <div class="p-title">Level ${l.n} · ${esc(l.title)}${l.next ? ' · ' + num(l.next - l.xp) + ' XP to next' : ''}</div>
      <div class="p-title">Trophies ${got} / ${TROPHIES.length}</div>
      <div class="trophies">${TROPHIES.map(t => `<div class="trophy ${t.test(profile) ? 'got' : ''}">
        <div class="t-ic">${t.icon}</div><div><b>${t.name}</b><span>${t.desc}</span></div></div>`).join('')}</div>`;
  }
}

function markRows() {
  for (const r of document.querySelectorAll('[data-row]')) {
    const id = Number(r.dataset.row);
    r.classList.toggle('sel', !!sel && sel.id === id);
    r.classList.toggle('bagged', bag.has(id));
    const b = r.querySelector('.mini');
    if (b) { b.classList.toggle('on', bag.has(id)); b.textContent = bag.has(id) ? '✓' : '+'; }
  }
}

function renderLegend() {
  const present = new Set(types.filter(t => t.size > 0).map(t => t.cat));
  $('#legend').innerHTML = LEGEND_ORDER.filter(c => present.has(c)).map(c =>
    `<button data-cat="${c}"><i class="sw" style="background:${CATS[c].color}"></i>${esc(CATS[c].name)}</button>`).join('');
}

// Hovering a type (legend or Types tab) spotlights it on the map; hovering a list row points at it.
for (const host of [$('#legend'), $('#panel')]) {
  host.addEventListener('mouseover', e => {
    const c = e.target.closest('[data-cat]');
    const r = e.target.closest('[data-row]');
    const cat = c ? Number(c.dataset.cat) : -1;
    const it = r && known.get(Number(r.dataset.row));
    const p = it && view ? visibleId(it.chain) : -1;
    if (cat !== filterCat || p !== pulse) {
      if (cat !== filterCat) baseDirty = true;
      filterCat = cat; pulse = p;
      if (view && !busy) draw();
    }
  });
  host.addEventListener('mouseleave', () => {
    if (filterCat >= 0 || pulse >= 0) { baseDirty = baseDirty || filterCat >= 0; filterCat = -1; pulse = -1; if (view && !busy) draw(); }
  });
}

// One click handler for everything in the sidebar and the modal.
document.addEventListener('click', e => {
  const t = e.target;
  const bagBtn = t.closest('[data-bag]');
  if (bagBtn) { e.stopPropagation(); toggleBag(Number(bagBtn.dataset.bag)); return; }
  const reveal = t.closest('[data-reveal]');
  if (reveal) { call('reveal', { id: Number(reveal.dataset.reveal) }).catch(fail); return; }
  const locate = t.closest('[data-locate]');
  if (locate) { locateItem(Number(locate.dataset.locate)); return; }
  const quest = t.closest('[data-quest]');
  if (quest) { openQuest = openQuest === quest.dataset.quest ? null : quest.dataset.quest; renderPanel(); return; }
  const row = t.closest('[data-row]');
  if (row) {
    const id = Number(row.dataset.row);
    if ($('#modal').contains(row)) return;
    if (tab === 'quests') locateItem(id); else select(id);
  }
});

/** Jumps the map to the folder holding an item and selects it. */
async function locateItem(id) {
  const it = known.get(id) || (sel && sel.id === id ? sel : null);
  if (!it || it.pid < 0) return;
  if (!view || view.tree.id !== it.pid) await go(it.pid, 'jump');
  await select(id);
  pulse = visibleId(it.chain);
  draw();
}

/* ============================================================ the bag (staging area for the Recycle Bin) */

async function toggleBag(id) {
  if (bag.has(id)) { bag.delete(id); afterBagChange(); return; }
  let it;
  try { it = await call('info', { id }); } catch (err) { fail(err); return; }
  if (it.locked) { toast('🔒', "Can't bag that", it.why || 'Protected'); return; }
  for (const other of bag.values()) {
    if (it.chain.includes(other.id)) { toast('🧺', 'Already covered', `It is inside "${other.name}", which is in your bag.`); return; }
  }
  for (const [oid, other] of bag) if (other.chain.includes(id)) bag.delete(oid);   // folder swallows its bagged contents
  bag.set(id, it);
  known.set(id, it);
  afterBagChange();
}

function afterBagChange() {
  renderBag();
  renderDetail();
  markRows();
  if (view && !busy) draw();
}

function bagTotal() {
  let t = 0;
  for (const it of bag.values()) t += it.size;
  return t;
}

function renderBag() {
  const el = $('#bagBar');
  if (!bag.size) { el.classList.add('hidden'); return; }
  const was = el.classList.contains('hidden');
  el.innerHTML = `<span>🧺 <b>${bag.size}</b> ${bag.size === 1 ? 'item' : 'items'} · <b>${fmt(bagTotal())}</b></span>
    <button class="btn ghost" id="bagClear">Empty</button><button class="btn primary" id="bagReview">Review &amp; recycle</button>`;
  el.classList.remove('hidden');
  if (!was) el.style.animation = 'none';
}
$('#bagBar').addEventListener('click', e => {
  if (e.target.closest('#bagClear')) { bag.clear(); afterBagChange(); }
  if (e.target.closest('#bagReview')) reviewBag();
});

function reviewBag() {
  const items = [...bag.values()].sort((a, b) => b.size - a.size);
  openModal(`<div class="sheet">
      <h3>Send ${items.length} ${items.length === 1 ? 'item' : 'items'} to the Recycle Bin?</h3>
      <p>Nothing is deleted for good. You can restore anything from the Recycle Bin until you empty it.</p>
      <div class="sheet-list">${items.map(it => rowHtml(it, 0, 0)).join('')}</div>
      <div class="sheet-foot"><div class="sum">You'll free <b>${fmt(bagTotal())}</b></div>
        <button class="btn" data-close>Not yet</button>
        <button class="btn danger" id="doTrash">Recycle ${items.length === 1 ? 'it' : 'them'}</button></div>
    </div>`);
  // In the review list the row button removes the item from the bag.
  for (const b of document.querySelectorAll('#modal .mini')) { b.textContent = '×'; b.title = 'Take out of bag'; }
}

function openModal(html) {
  const m = $('#modal');
  m.innerHTML = html;
  m.classList.remove('hidden');
}
function closeModal() { $('#modal').classList.add('hidden'); $('#modal').innerHTML = ''; }
$('#modal').addEventListener('click', e => {
  if (e.target === $('#modal') || e.target.closest('[data-close]')) { closeModal(); return; }
  if (e.target.closest('#doTrash')) { doTrash(); return; }
  if (e.target.closest('[data-bag]')) setTimeout(() => { if (bag.size) reviewBag(); else closeModal(); }, 0);
});

async function doTrash() {
  const btn = $('#doTrash');
  btn.disabled = true;
  btn.textContent = 'Recycling…';
  const ids = [...bag.keys()];
  let res;
  try { res = await call('trash', { ids }); }
  catch (err) { closeModal(); fail(err); return; }

  const failed = res.results.filter(r => r.error);
  for (const r of res.results) if (!r.error) { bag.delete(r.id); known.delete(r.id); }
  const xp = Math.floor(res.freed / MB);
  closeModal();

  if (res.count > 0) {
    confetti();
    const comparison = like(res.freed);
    openModal(`<div class="sheet win">
        <div class="w-ic">🎉</div><h3>Space reclaimed</h3>
        <div class="w-big">${fmt(res.freed)}</div>
        <div class="w-xp">+${num(xp)} XP</div>
        <p>${res.count} ${res.count === 1 ? 'item is' : 'items are'} now in the Recycle Bin${comparison ? ' (' + comparison.replace('≈ ', 'about ') + ')' : ''}.
           Empty the bin when you're sure, and the space is yours.</p>
        <button class="btn primary" data-close>Keep hunting</button></div>`);
  }
  for (const f of failed.slice(0, 3)) {
    const it = known.get(f.id);
    toast('⚠️', "Couldn't recycle " + (it ? it.name : 'an item'), f.error);
  }
  setProfile(res.profile, true);

  // Refresh the map: if the folder we were looking at is gone, fall back to the nearest surviving parent.
  renderBag();
  const trail = view.crumbs.map(c => c.id).reverse();
  view = null;
  for (const id of trail) {
    busy = false;
    try { await call('info', { id }); } catch { continue; }
    await go(id, 'jump');
    break;
  }
  loadQuests();
}

/* ============================================================ toasts + confetti */

function toast(icon, title, text, gold) {
  const el = document.createElement('div');
  el.className = 'toast' + (gold ? ' gold' : '');
  el.innerHTML = `<div class="ti">${icon}</div><div><b>${esc(title)}</b><span>${esc(text || '')}</span></div>`;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, gold ? 5200 : 4200);
}
function fail(err) {
  toast('⚠️', 'Hmm', err && err.message ? err.message : String(err));
}

function confetti() {
  if (reduceMotion) return;
  const c = $('#fx'), x = c.getContext('2d');
  const w = (c.width = window.innerWidth), h = (c.height = window.innerHeight);
  const colors = CATS.slice(1, 9).map(k => k.color);
  const bits = Array.from({ length: 130 }, () => ({
    x: w / 2 + (Math.random() - 0.5) * 160, y: h * 0.42,
    vx: (Math.random() - 0.5) * 17, vy: -Math.random() * 15 - 4,
    s: 5 + Math.random() * 7, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4,
    color: colors[Math.floor(Math.random() * colors.length)],
  }));
  const t0 = performance.now();
  (function frame(now) {
    const t = (now - t0) / 1900;
    x.clearRect(0, 0, w, h);
    if (t >= 1) return;
    for (const b of bits) {
      b.vy += 0.45; b.vx *= 0.99; b.x += b.vx; b.y += b.vy; b.r += b.vr;
      x.save();
      x.globalAlpha = Math.max(0, 1 - t * t);
      x.translate(b.x, b.y); x.rotate(b.r);
      x.fillStyle = b.color;
      x.fillRect(-b.s / 2, -b.s / 3, b.s, b.s * 0.66);
      x.restore();
    }
    requestAnimationFrame(frame);
  })(t0);
}

/* ============================================================ go */

loadHome().catch(fail);
