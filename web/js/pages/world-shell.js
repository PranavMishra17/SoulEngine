/**
 * world-shell.js
 *
 * The persistent project "world" — a top-down pixel diorama that is the home
 * of a project. It lives in its own fixed layers behind the normal page
 * content and survives in-project navigation: walking to / clicking a landmark
 * navigates to the matching existing route, which opens over the dimmed,
 * still-mounted world. The canvas only tears down when you leave project
 * context entirely (back to the projects list or landing).
 *
 * Public surface (driven by router.afterEach in app.js):
 *   ensureMounted(projectId) — build + start the world once per project
 *   syncToRoute(path)        — toggle home vs dimmed-overlay state, or unmount
 *   unmount()                — cancel the loop, drop listeners + DOM
 *
 * Pure routing / data helpers live in world-data.js (unit tested); this file
 * owns the canvas + DOM and is verified in the browser.
 */

import { router } from '../router.js';
import * as api from '../api.js';
import {
  ZONES,
  zoneRoute,
  parseProjectRoute,
  adaptProject,
  adaptNpcs,
  npcsFromResponse,
  clampFigures,
} from './world-data.js';

const TILE = 16, COLS = 40, ROWS = 23;
const reduceMotion = (() => {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
})();

/* ---------------------------------------------------------------- colour utils */
function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function shade(hex, p) {
  const [r, g, b] = hexToRgb(hex);
  const f = (c) => Math.max(0, Math.min(255, Math.round(p < 0 ? c * (1 + p) : c + (255 - c) * p)));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

/* ----------------------------------------------------------------- pixel sprites */
const BODY = { '.': null, 'H': '#e9e3d8', 'h': '#b7b1a6', 'F': '#e7b58e', 'e': '#15171c', 'T': '#2b3550', 't': '#1d2438', 'S': '#e07850', 'P': '#222732', 'K': '#121419' };
const HERO = {
  down: ['...HHHHH...', '..HHHHHHH..', '..HHHHHHH..', '..HFFFFFH..', '..HFeFeFH..', '...FFFFF...', '...SSSSS...', '..TTTTTTT..', '..TTTTTTT..', '..TtTTTtT..', '..TTTTTTT..', '..TTTTTTT..', '...TTTTT...', '...PPPPP...', '...PP.PP...', '...PP.PP...', '...KK.KK...'],
  up: ['...HHHHH...', '..HHHHHHH..', '..HHHHHHH..', '..HHHHHHH..', '..HHHHHHH..', '...hhhhh...', '...SSSSS...', '..TTTTTTT..', '..TTTTTTT..', '..TtTTTtT..', '..TTTTTTT..', '..TTTTTTT..', '...TTTTT...', '...PPPPP...', '...PP.PP...', '...PP.PP...', '...KK.KK...'],
  side: ['.HHHHH.....', 'HHHHHHH....', 'HHHFFFF....', 'HHFFFFF....', 'HHFFFeF....', '.FFFFF.....', '.SSSSS.....', '.TTTTT.....', '.TTTTT.....', '.TtTTT.....', '.TTTTT.....', '.TTTTT.....', '.TTTTT.....', '.PPPP......', '.PP.PP.....', '.PP.PP.....', '.KK.KK.....'],
};
const NPC_PAL = { '.': null, 'H': '#e9e3d8', 'F': '#e7b58e', 'e': '#15171c' };
const NPC_MAT = ['............', '....HHHH....', '...HHHHHH...', '...HFFFFH...', '...FeFFeF...', '....FFFF....', '...cCCCCc...', '..CCCCCCCC..', '..CCCCCCCC..', '..CCCCCCCC..', '..cCCCCCCc..', '..CCCCCCCC..', '..CCCCCCCC..', '..cCCCCCCc..', '...CCCCCC...', '............'];
const SCH_PAL = { '.': null, 'H': '#cfcabf', 'F': '#dcb48c', 'e': '#15171c', 'B': '#bdb8ad', 'R': '#5a4a6a', 'r': '#473a54' };
const SCH_MAT = ['............', '....HHHH....', '...HHHHHH...', '...HFFFFH...', '...FeFFeF...', '...FBBBBF...', '....BBBB....', '...rRRRRr...', '..RRRRRRRR..', '..RRRRRRRR..', '..RRRRRRRR..', '..rRRRRRRr..', '..RRRRRRRR..', '...RRRRRR...', '...RR..RR...', '............'];

function drawMatrix(g, mat, pal, dx, dy, scale, mirror) {
  scale = scale || 1;
  for (let r = 0; r < mat.length; r++) {
    const row = mat[r];
    for (let c = 0; c < row.length; c++) {
      const col = pal[row[c]];
      if (!col) continue;
      const x = mirror ? (row.length - 1 - c) : c;
      g.fillStyle = col;
      g.fillRect(dx + x * scale, dy + r * scale, scale, scale);
    }
  }
}
function npcPalette(robe) { return Object.assign({}, NPC_PAL, { 'C': robe, 'c': shade(robe, -0.28) }); }
function drawCape(g, cx, topY, dir, t, moving, scale) {
  scale = scale || 1; const rows = 16, amp = moving ? 1.7 : 0.8, spd = moving ? 9 : 2.4;
  for (let r = 0; r < rows; r++) {
    const y = topY + r * scale, halfW = (3.4 + r * 0.34) * scale;
    const sway = Math.sin(t * spd - r * 0.5) * amp * scale * (r / rows);
    const off = dir === 'left' ? (2.2 + r * 0.18) * scale : (dir === 'right' ? -(2.2 + r * 0.18) * scale : 0);
    const left = Math.round(cx - halfW + sway + off), w = Math.round(halfW * 2);
    g.fillStyle = r % 5 === 4 ? '#b15536' : '#e07850';
    g.fillRect(left, Math.round(y), w, Math.ceil(scale));
    g.fillStyle = '#c0623b';
    g.fillRect(left, Math.round(y), Math.ceil(scale), Math.ceil(scale));
    g.fillRect(left + w - Math.ceil(scale), Math.round(y), Math.ceil(scale), Math.ceil(scale));
  }
}

/* ------------------------------------------------------------------ world layout
 * Geometry + colour per landmark; names/tags come from world-data's ZONES so
 * there is a single source of truth for the routing-facing definitions. */
const GEO = {
  foundry:  { color: '#83e0c6', bx: 3,  by: 3,  bw: 7, bh: 5, door: { x: 6,  y: 8 } },
  archive:  { color: '#b6a6f2', bx: 30, by: 3,  bw: 7, bh: 5, door: { x: 33, y: 8 } },
  workshop: { color: '#e07850', bx: 3,  by: 15, bw: 7, bh: 5, door: { x: 6,  y: 14 } },
  parley:   { color: '#f1a6c4', bx: 30, by: 15, bw: 7, bh: 5, door: { x: 33, y: 14 } },
  core:     { color: '#9fb0c3', bx: 17, by: 18, bw: 6, bh: 4, door: { x: 19, y: 17 } },
  commons:  { color: '#e7c07a', board: { x: 19, y: 9 }, door: { x: 19, y: 10 } },
};
const PROPS = [
  { type: 'lamp', x: 12, y: 11 }, { type: 'lamp', x: 27, y: 11 }, { type: 'lamp', x: 19, y: 15 },
  { type: 'tree', x: 11, y: 6 }, { type: 'tree', x: 34, y: 12 }, { type: 'tree', x: 12, y: 13 }, { type: 'tree', x: 27, y: 6 },
  { type: 'crate', x: 9, y: 18 }, { type: 'crate', x: 10, y: 17 }, { type: 'bush', x: 25, y: 7 }, { type: 'bush', x: 15, y: 13 },
  { type: 'bench', x: 16, y: 11 }, { type: 'bench', x: 22, y: 11 },
];
// Ambient NPC figures cluster near the Foundry (the most-used landmark) and the plaza.
const FIGURE_SPOTS = [{ x: 11, y: 7 }, { x: 13, y: 6 }, { x: 9, y: 10 }, { x: 24, y: 7 }, { x: 27, y: 12 }, { x: 15, y: 12 }];

/* --------------------------------------------------------------------- module state */
let mounted = false;
let projectId = null;
let rafId = 0;
let last = 0;
let ac = null;            // AbortController for all listeners this mount
let overlayActive = false;
let drawerOpen = false;
let onboardOpen = false;
let onboardChecked = false;
let els = null;           // built DOM references
let W = null;             // per-mount world state

const K = (x, y) => x + ',' + y;

/* ----------------------------------------------------------------- world building */
function buildWorld() {
  const zones = ZONES.map((z) => ({ id: z.id, name: z.name, tag: z.tag, ...GEO[z.id] }));
  W = {
    zones,
    props: PROPS,
    chars: [{ kind: 'scholar', x: 29, y: 8, name: 'The Scholar' }],
    player: { x: 9.5 * TILE, y: 10.5 * TILE, dir: 'up', moving: false, speed: 60, w: 8, h: 5, target: null },
    keys: {},
    hintFaded: false,
    bob: 0, bobT: 0,
    hover: null, nearest: null, titleZone: '__x',
    project: { name: 'Your world', tag: 'a project of the SoulEngine' },
    npcList: [],
    loaded: false,
    solids: new Set(),
    paths: new Set(),
    plaza: { x0: 13, y0: 7, x1: 26, y1: 14 },
  };
  buildPaths();
  rebuildSolids();
}

function buildPaths() {
  const line = (x0, y0, x1, y1) => {
    if (x0 === x1) for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) W.paths.add(K(x0, y));
    else for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) W.paths.add(K(x, y0));
  };
  line(6, 8, 33, 8); line(6, 14, 33, 14); line(19, 8, 19, 17); line(6, 8, 6, 14); line(33, 8, 33, 14);
}

function rebuildSolids() {
  const s = new Set();
  for (let x = 0; x < COLS; x++) { s.add(K(x, 0)); s.add(K(x, ROWS - 1)); }
  for (let y = 0; y < ROWS; y++) { s.add(K(0, y)); s.add(K(COLS - 1, y)); }
  W.zones.forEach((z) => {
    if (z.bw) for (let yy = z.by; yy < z.by + z.bh; yy++) for (let xx = z.bx; xx < z.bx + z.bw; xx++) s.add(K(xx, yy));
    if (z.board) s.add(K(z.board.x, z.board.y));
  });
  W.props.forEach((p) => { if (p.type !== 'bush') s.add(K(p.x, p.y)); });
  W.chars.forEach((c) => s.add(K(c.x, c.y)));
  W.solids = s;
}
const solidAt = (tx, ty) => W.solids.has(K(tx, ty));
const inPlaza = (x, y) => x >= W.plaza.x0 && x <= W.plaza.x1 && y >= W.plaza.y0 && y <= W.plaza.y1;

function collide(nx, ny) {
  const p = W.player, l = nx - p.w / 2, r = nx + p.w / 2, t = ny - p.h, b = ny;
  const tx0 = Math.floor(l / TILE), tx1 = Math.floor((r - 0.01) / TILE), ty0 = Math.floor(t / TILE), ty1 = Math.floor((b - 0.01) / TILE);
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) if (solidAt(tx, ty)) return true;
  return false;
}

/* -------------------------------------------------------------------- interaction */
function screenToWorld(ev) {
  const canvas = els.canvas, rect = canvas.getBoundingClientRect();
  const scale = Math.min(rect.width / canvas.width, rect.height / canvas.height);
  const rw = canvas.width * scale, rh = canvas.height * scale;
  const ox = (rect.width - rw) / 2, oy = (rect.height - rh) / 2;
  const x = (ev.clientX - rect.left - ox) / scale, y = (ev.clientY - rect.top - oy) / scale;
  return { x, y, inside: x >= 0 && y >= 0 && x <= canvas.width && y <= canvas.height };
}
function hitTest(wx, wy) {
  for (const c of W.chars) if (Math.hypot(c.x * TILE + 8 - wx, c.y * TILE + 10 - wy) < 11) return { kind: 'char', ref: c };
  const tx = Math.floor(wx / TILE), ty = Math.floor(wy / TILE);
  for (const z of W.zones) {
    if (z.bw && tx >= z.bx && tx < z.bx + z.bw && ty >= z.by && ty < z.by + z.bh) return { kind: 'zone', ref: z };
    if (z.board && Math.abs(tx - z.board.x) <= 1 && Math.abs(ty - z.board.y) <= 1) return { kind: 'zone', ref: z };
  }
  return null;
}
function fadeHint() {
  if (W.hintFaded) return;
  W.hintFaded = true;
  if (els.hint) els.hint.style.opacity = '0';
}

function npcEditorPath(npcId) { return `${zoneRoute('foundry', projectId)}/${npcId}`; }
function openHit(hit) {
  if (!hit) return;
  if (hit.kind === 'char') {
    if (hit.ref.kind === 'scholar') router.navigate(zoneRoute('archive', projectId));
    else if (hit.ref.npc) router.navigate(npcEditorPath(hit.ref.npc.id));
    return;
  }
  router.navigate(zoneRoute(hit.ref.id, projectId));
}
function interact() { if (W.nearest) openHit(W.nearest); }

function updateNearest() {
  const p = W.player;
  let best = null, bd = 24;
  for (const z of W.zones) { const d = Math.hypot(z.door.x * TILE + 8 - p.x, z.door.y * TILE + 8 - (p.y - 6)); if (d < bd) { bd = d; best = { kind: 'zone', ref: z }; } }
  for (const c of W.chars) { const d = Math.hypot(c.x * TILE + 8 - p.x, c.y * TILE + 10 - (p.y - 6)); if (d < bd) { bd = d; best = { kind: 'char', ref: c }; } }
  W.nearest = best;
  let near = null, nd = 58;
  for (const z of W.zones) { const d = Math.hypot(z.door.x * TILE + 8 - p.x, z.door.y * TILE + 8 - p.y); if (d < nd) { nd = d; near = z; } }
  setTitle(near);
}
function setTitle(z) {
  const id = z ? z.id : '__none';
  if (id === W.titleZone) return;
  W.titleZone = id;
  const wrap = els.title, name = els.titleName, tag = els.titleTag;
  if (!wrap) return;
  wrap.style.opacity = '0';
  setTimeout(() => {
    if (z) { name.textContent = z.name; tag.textContent = z.tag; name.style.color = z.color; }
    else { name.textContent = W.project.name; tag.textContent = W.project.tag; name.style.color = 'var(--ink)'; }
    wrap.style.opacity = '1';
  }, 170);
}

/* ----------------------------------------------------------------------- update */
function update(dt) {
  const p = W.player;
  let vx = 0, vy = 0;
  if (!onboardOpen && !overlayActive) {
    if (W.keys.up) vy -= 1; if (W.keys.down) vy += 1; if (W.keys.left) vx -= 1; if (W.keys.right) vx += 1;
    if (!vx && !vy && p.target) {
      const dx = p.target.x - p.x, dy = p.target.y - p.y, d = Math.hypot(dx, dy);
      if (d < 3) p.target = null; else { vx = dx / d; vy = dy / d; }
    }
  }
  p.moving = !!(vx || vy);
  if (p.moving) {
    if (Math.abs(vy) >= Math.abs(vx)) p.dir = vy < 0 ? 'up' : 'down'; else p.dir = vx < 0 ? 'left' : 'right';
    const len = Math.hypot(vx, vy) || 1, sx = (vx / len) * p.speed * dt, sy = (vy / len) * p.speed * dt;
    let moved = false;
    if (!collide(p.x + sx, p.y)) { p.x += sx; moved = true; }
    if (!collide(p.x, p.y + sy)) { p.y += sy; moved = true; }
    if (!moved && p.target) p.target = null;
    W.bobT += dt * 9; W.bob = Math.sin(W.bobT) < 0 ? 1 : 0;
  } else W.bob = 0;
  updateNearest();
}

/* ------------------------------------------------------------------------ render */
function drawGround(ctx) {
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    let base;
    if (x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1) base = '#090b0e';
    else {
      const h = ((x * 73856093) ^ (y * 19349663)) & 7;
      base = h === 0 ? '#161b22' : (h === 1 ? '#11151b' : '#13171d');
      if (inPlaza(x, y)) base = (h & 1) ? '#1b2027' : '#1d232b';
      if (W.paths.has(K(x, y))) base = (h & 1) ? '#2a2620' : '#2f2a22';
    }
    ctx.fillStyle = base; ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
    if ((((x * 12) ^ (y * 7)) & 15) === 0 && !solidAt(x, y)) { ctx.fillStyle = 'rgba(236,230,220,0.05)'; ctx.fillRect(x * TILE + 5, y * TILE + 9, 1, 1); }
  }
  ctx.strokeStyle = 'rgba(231,192,122,0.14)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(19.5 * TILE, 11 * TILE, 40, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = 'rgba(231,192,122,0.07)'; ctx.beginPath(); ctx.arc(19.5 * TILE, 11 * TILE, 56, 0, Math.PI * 2); ctx.stroke();
}
function label(ctx, text, cx, cy, color) {
  ctx.font = '7px "Silkscreen", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(0,0,0,0.85)'; ctx.fillText(text, cx + 0.6, cy + 0.6);
  ctx.fillStyle = color || '#ece6dc'; ctx.fillText(text, cx, cy);
}
function lightPool(ctx, cx, cy, r, color, a) {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, color.replace(')', ',' + a + ')').replace('rgb', 'rgba'));
  g.addColorStop(1, color.replace(')', ',0)').replace('rgb', 'rgba'));
  ctx.fillStyle = g; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
}
function drawShadow(ctx, cx, cy, w) { ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(cx, cy, w, w * 0.4, 0, 0, 7); ctx.fill(); }

function drawBuilding(ctx, z, t) {
  const px = z.bx * TILE, py = z.by * TILE, pw = z.bw * TILE, ph = z.bh * TILE;
  ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(px + 3, py + ph - 2, pw, 7);
  ctx.fillStyle = shade(z.color, -0.8); ctx.fillRect(px, py, pw, ph);
  ctx.fillStyle = shade(z.color, -0.58); ctx.fillRect(px, py, pw, Math.floor(ph * 0.4));
  ctx.fillStyle = shade(z.color, -0.32); ctx.fillRect(px, py, pw, 3);
  ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1; ctx.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1);
  zoneDecor(ctx, z, px, py, pw, ph, t);
  const topDoor = z.door.y > z.by, dpx = z.door.x * TILE + 2, dw = TILE - 4, dy = topDoor ? py + ph - 9 : py + 2;
  ctx.fillStyle = '#1a1206'; ctx.fillRect(dpx, dy, dw, 9);
  ctx.fillStyle = 'rgba(224,120,80,0.85)'; ctx.fillRect(dpx + 2, dy + 2, dw - 4, 7);
  ctx.fillStyle = 'rgba(255,200,150,0.5)'; ctx.fillRect(dpx + 2, dy + 2, dw - 4, 2);
  lightPool(ctx, z.door.x * TILE + 8, z.door.y * TILE + 8, 16, 'rgb(224,120,80)', 0.22);
  if (W.hover && W.hover.kind === 'zone' && W.hover.ref === z) { ctx.strokeStyle = 'rgba(236,230,220,0.8)'; const o = 2 + (Math.sin(t * 4) + 1); ctx.strokeRect(px - o, py - o, pw + o * 2, ph + o * 2); }
  label(ctx, z.name, px + pw / 2, py - 5, z.color);
}

function zoneDecor(ctx, z, px, py, pw, ph, t) {
  const fy = py + Math.floor(ph * 0.42);
  if (z.id === 'foundry') {
    for (let i = 0; i < 3; i++) { const vx = px + 12 + i * 22, vy = fy + 6; ctx.fillStyle = '#0d1a18'; ctx.fillRect(vx, vy, 12, 22); ctx.fillStyle = shade('#83e0c6', -0.4); ctx.fillRect(vx + 1, vy + 8, 10, 13); ctx.fillStyle = '#83e0c6'; ctx.globalAlpha = 0.5; for (let b = 0; b < 3; b++) { const by = vy + 20 - ((t * 22 + i * 9 + b * 14) % 14); ctx.fillRect(vx + 3 + b * 3, by, 2, 2); } ctx.globalAlpha = 1; ctx.fillStyle = '#cfeee4'; ctx.fillRect(vx, vy, 12, 2); }
    if (Math.sin(t * 7) > 0.85) { ctx.strokeStyle = 'rgba(131,224,196,0.9)'; ctx.beginPath(); ctx.moveTo(px + 20, py + 8); ctx.lineTo(px + 26, py + 14); ctx.lineTo(px + 22, py + 16); ctx.stroke(); }
  } else if (z.id === 'archive') {
    ctx.fillStyle = 'rgba(231,192,122,0.16)'; ctx.fillRect(px + pw / 2 - 9, py + 5, 18, ph * 0.34); ctx.beginPath(); ctx.arc(px + pw / 2, py + 5, 9, Math.PI, 0); ctx.fill();
    const spines = ['#b6a6f2', '#83e0c6', '#e7c07a', '#f1a6c4', '#9fb0c3'];
    for (let row = 0; row < 3; row++) { const ry = fy + 4 + row * 10; ctx.fillStyle = '#1c1726'; ctx.fillRect(px + 6, ry, pw - 12, 8); for (let s = 0; s < (pw - 16) / 4; s++) { ctx.fillStyle = shade(spines[(row + s) % spines.length], -0.12); ctx.fillRect(px + 8 + s * 4, ry + 1, 3, 6); } }
    ctx.globalAlpha = 0.6; ctx.fillStyle = '#e7c07a'; for (let m = 0; m < 5; m++) { const mx = px + 14 + (m * 23) % (pw - 20), my = py + 8 + (((-t * 9 + m * 30) % (ph - 10)) + (ph - 10)) % (ph - 10); ctx.fillRect(mx, my, 1, 1); } ctx.globalAlpha = 1;
    lightPool(ctx, px + pw - 12, fy + 6, 10, 'rgb(231,192,122)', 0.18 + Math.sin(t * 3) * 0.05);
  } else if (z.id === 'workshop') {
    for (let p = 0; p < 2; p++) { const cy = fy + 8 + p * 12; ctx.fillStyle = '#241a12'; ctx.fillRect(px + 6, cy, pw - 12, 5); ctx.fillStyle = '#3a2a1c'; ctx.fillRect(px + 6, cy, pw - 12, 1); for (let d = 0; d < 4; d++) { const dx = px + 8 + ((t * 40 + d * 30 + p * 15) % (pw - 16)); ctx.fillStyle = '#e07850'; ctx.fillRect(dx, cy + 1, 3, 3); } }
    const gx = px + pw - 14, gy = fy + 4, ga = t * 1.6; ctx.save(); ctx.translate(gx, gy); ctx.rotate(ga); ctx.strokeStyle = '#9fb0c3'; ctx.lineWidth = 2; for (let a = 0; a < 4; a++) { ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a * 1.57) * 6, Math.sin(a * 1.57) * 6); ctx.stroke(); } ctx.restore();
  } else if (z.id === 'parley') {
    ctx.fillStyle = 'rgba(231,192,122,0.5)'; ctx.fillRect(px + 8, fy + 6, 9, 8); ctx.fillRect(px + pw - 17, fy + 6, 9, 8);
    ctx.fillStyle = '#2a1c12'; ctx.fillRect(px + pw / 2 - 8, fy + 4, 16, 11);
    ctx.fillStyle = '#e7c07a'; ctx.fillRect(px + pw / 2 - 4, fy + 6, 6, 7); ctx.fillStyle = '#caa85f'; ctx.fillRect(px + pw / 2 + 2, fy + 7, 2, 4);
    ctx.fillStyle = 'rgba(180,180,180,0.25)'; for (let s = 0; s < 3; s++) { const sy = py - 2 - ((t * 10 + s * 7) % 14); ctx.fillRect(px + pw - 10 + Math.sin(t * 2 + s) * 2, sy, 3, 3); }
    lightPool(ctx, px + pw / 2, fy + 16, 18, 'rgb(241,166,196)', 0.14 + Math.sin(t * 5) * 0.04);
  } else if (z.id === 'core') {
    for (let r = 0; r < 3; r++) { const rx = px + 8 + r * 14, ry = fy + 4; ctx.fillStyle = '#0e1318'; ctx.fillRect(rx, ry, 10, ph - (fy - py) - 8); for (let l = 0; l < 4; l++) { const on = ((Math.floor(t * 3) + r + l) % 3) === 0; ctx.fillStyle = on ? '#83e0c6' : '#1f2730'; ctx.fillRect(rx + 2, ry + 3 + l * 4, 6, 2); } }
    const sl = fy + 4 + ((t * 20) % (ph - (fy - py) - 8)); ctx.fillStyle = 'rgba(131,224,196,0.18)'; ctx.fillRect(px + 4, sl, pw - 8, 1);
  }
}

function drawTownSquare(ctx, z, t) {
  const cx = z.board.x * TILE + 8, cy = z.board.y * TILE + 8;
  ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.beginPath(); ctx.ellipse(cx, cy + 6, 13, 5, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#3a3f4a'; ctx.beginPath(); ctx.ellipse(cx, cy + 4, 12, 5, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#1a2a30'; ctx.beginPath(); ctx.ellipse(cx, cy + 3, 9, 3.5, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#2b3550'; ctx.fillRect(cx - 2, cy - 8, 4, 11);
  ctx.fillStyle = 'rgba(131,224,196,0.7)'; for (let j = 0; j < 4; j++) { const a = j * 1.57 + t, jx = cx + Math.cos(a) * 4, jy = cy - 7 - ((t * 18 + j * 5) % 6); ctx.fillRect(Math.round(jx), Math.round(jy), 1, 2); }
  ctx.fillStyle = '#2a2018'; ctx.fillRect(cx + 14, cy - 12, 2, 18);
  ctx.fillStyle = z.color; const wv = Math.sin(t * 3) * 1; ctx.fillRect(cx + 16, cy - 12 + wv, 8, 6);
  lightPool(ctx, cx, cy, 22, 'rgb(231,192,122)', 0.12 + Math.sin(t * 2) * 0.03);
  if (W.hover && W.hover.kind === 'zone' && W.hover.ref === z) { ctx.strokeStyle = 'rgba(236,230,220,0.8)'; ctx.strokeRect(cx - 14, cy - 14, 28, 24); }
  label(ctx, z.name, cx, cy - 16, z.color);
}

function drawProp(ctx, p, t) {
  const x = p.x * TILE, y = p.y * TILE;
  if (p.type === 'lamp') { ctx.fillStyle = '#15171c'; ctx.fillRect(x + 7, y + 4, 2, 11); ctx.fillStyle = '#e7c07a'; ctx.fillRect(x + 5, y + 1, 6, 4); lightPool(ctx, x + 8, y + 4, 22, 'rgb(231,192,122)', 0.12 + Math.sin(t * 4 + p.x) * 0.03); }
  else if (p.type === 'tree') { ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(x + 8, y + 15, 6, 2, 0, 0, 7); ctx.fill(); ctx.fillStyle = '#2a2018'; ctx.fillRect(x + 7, y + 9, 2, 6); const sway = Math.sin(t * 1.5 + p.x); ctx.fillStyle = '#2f4a3a'; ctx.beginPath(); ctx.arc(x + 8 + sway, y + 6, 6, 0, 7); ctx.fill(); ctx.fillStyle = '#3c5e48'; ctx.beginPath(); ctx.arc(x + 6 + sway, y + 4, 3, 0, 7); ctx.fill(); }
  else if (p.type === 'crate') { ctx.fillStyle = '#3a2c1c'; ctx.fillRect(x + 3, y + 5, 10, 10); ctx.strokeStyle = '#241a10'; ctx.strokeRect(x + 3.5, y + 5.5, 9, 9); ctx.beginPath(); ctx.moveTo(x + 3, y + 10); ctx.lineTo(x + 13, y + 10); ctx.stroke(); }
  else if (p.type === 'bush') { ctx.fillStyle = '#26402f'; ctx.beginPath(); ctx.arc(x + 8, y + 11, 4, 0, 7); ctx.fill(); ctx.fillStyle = '#32543d'; ctx.beginPath(); ctx.arc(x + 6, y + 10, 2.5, 0, 7); ctx.fill(); ctx.fillStyle = '#f1a6c4'; ctx.fillRect(x + 8, y + 9, 1, 1); ctx.fillRect(x + 5, y + 11, 1, 1); }
  else if (p.type === 'bench') { ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(x + 2, y + 13, 12, 2); ctx.fillStyle = '#3a2c1c'; ctx.fillRect(x + 2, y + 9, 12, 3); ctx.fillStyle = '#4a3826'; ctx.fillRect(x + 2, y + 9, 12, 1); ctx.fillStyle = '#2a2018'; ctx.fillRect(x + 3, y + 12, 1, 3); ctx.fillRect(x + 12, y + 12, 1, 3); }
}

function drawChar(ctx, c, t) {
  const cx = c.x * TILE + 8, cy = c.y * TILE + 14;
  if (c.kind === 'scholar') {
    drawShadow(ctx, cx, cy, 6); drawMatrix(ctx, SCH_MAT, SCH_PAL, cx - 6, cy - 16, 1, false);
    ctx.fillStyle = 'rgba(231,192,122,0.5)'; ctx.fillRect(cx + 5, cy - 4, 3, 4);
    label(ctx, 'The Scholar', cx, cy - 19, '#cfcabf');
  } else {
    const robe = (c.npc && c.npc.color) || '#9fb0c3';
    drawShadow(ctx, cx, cy, 6); drawMatrix(ctx, NPC_MAT, npcPalette(robe), cx - 6, cy - 16, 1, false);
    ctx.fillStyle = 'rgba(200,200,200,0.3)'; for (let s = 0; s < 2; s++) { const sy = cy - 14 - ((t * 8 + s * 6 + c.x) % 10); ctx.fillRect(cx + 4 + Math.sin(t * 2 + s), sy, 2, 2); }
    ctx.fillStyle = '#e07850'; ctx.fillRect(cx + 4, cy - 11, 1, 1);
    label(ctx, (c.npc && c.npc.name) || 'Soul', cx, cy - 19, '#ece6dc');
  }
  if (W.hover && W.hover.kind === 'char' && W.hover.ref === c) { ctx.strokeStyle = 'rgba(236,230,220,0.7)'; ctx.beginPath(); ctx.arc(cx, cy - 6, 11, 0, 7); ctx.stroke(); }
}

function drawPlayer(ctx, t) {
  const p = W.player, cx = Math.round(p.x), cy = Math.round(p.y - W.bob); drawShadow(ctx, p.x, p.y, 7); const dir = p.dir, bodyTop = cy - 19;
  if (dir === 'up') { drawMatrix(ctx, HERO.up, BODY, cx - 5, bodyTop, 1, false); drawCape(ctx, cx, bodyTop + 6, 'up', t, p.moving, 1); }
  else if (dir === 'down') { drawCape(ctx, cx, bodyTop + 6, 'down', t, p.moving, 1); drawMatrix(ctx, HERO.down, BODY, cx - 5, bodyTop, 1, false); }
  else { drawCape(ctx, cx, bodyTop + 6, dir, t, p.moving, 1); drawMatrix(ctx, HERO.side, BODY, cx - 5, bodyTop, 1, dir === 'left'); }
}

function drawPrompt(ctx) {
  if (!W.nearest || onboardOpen || overlayActive) return;
  const r = W.nearest; let cx, cy, text;
  if (r.kind === 'zone') { cx = r.ref.door.x * TILE + 8; cy = r.ref.door.y * TILE; text = 'Enter ' + r.ref.name; }
  else { cx = r.ref.x * TILE + 8; cy = r.ref.y * TILE - 6; text = r.ref.kind === 'scholar' ? 'The Archive' : 'Open ' + ((r.ref.npc && r.ref.npc.name) || 'mind'); }
  ctx.font = '7px "Silkscreen", monospace'; const tw = ctx.measureText(text).width, bw = tw + 22, bh = 13, bx = Math.round(cx - bw / 2), by = Math.round(cy - bh - 2);
  ctx.fillStyle = 'rgba(10,11,14,0.92)'; ctx.fillRect(bx, by, bw, bh); ctx.strokeStyle = 'rgba(224,120,80,0.7)'; ctx.lineWidth = 1; ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
  ctx.fillStyle = '#e07850'; ctx.fillRect(bx + 3, by + 3, 7, 7); ctx.fillStyle = '#1b1006'; ctx.textAlign = 'center'; ctx.fillText('E', bx + 6.5, by + 9); ctx.fillStyle = '#ece6dc'; ctx.textAlign = 'left'; ctx.fillText(text, bx + 13, by + 9);
}

function render(t) {
  if (!els) return;
  const ctx = els.ctx;
  ctx.fillStyle = '#0a0c10'; ctx.fillRect(0, 0, els.canvas.width, els.canvas.height); drawGround(ctx);
  const items = [];
  W.zones.forEach((z) => { if (z.bw) items.push({ y: (z.by + z.bh) * TILE, draw: () => drawBuilding(ctx, z, t) }); if (z.board) items.push({ y: (z.board.y + 1) * TILE, draw: () => drawTownSquare(ctx, z, t) }); });
  W.props.forEach((p) => items.push({ y: (p.y + 1) * TILE, draw: () => drawProp(ctx, p, t) }));
  W.chars.forEach((c) => items.push({ y: c.y * TILE + 14, draw: () => drawChar(ctx, c, t) }));
  items.push({ y: W.player.y, draw: () => drawPlayer(ctx, t) });
  items.sort((a, b) => a.y - b.y); items.forEach((it) => it.draw());
  if (W.loaded && W.npcList.length === 0) {
    label(ctx, 'No minds yet — enter the Foundry', GEO.foundry.door.x * TILE + 30, GEO.foundry.door.y * TILE + 28, '#83e0c6');
  }
  drawPrompt(ctx);
}

function loop(ts) {
  if (!mounted) { rafId = 0; return; }
  const dt = last ? Math.min(0.05, (ts - last) / 1000) : 0.016; last = ts;
  update(dt); render(reduceMotion ? 0 : ts / 1000);
  rafId = requestAnimationFrame(loop);
}
function startLoop() { if (!rafId && mounted) { last = 0; rafId = requestAnimationFrame(loop); } }
function stopLoop() { if (rafId) { cancelAnimationFrame(rafId); rafId = 0; } }

/* --------------------------------------------------------------- fast-travel drawer */
function teleportTo(zoneId) {
  const z = W.zones.find((zz) => zz.id === zoneId);
  if (!z) return;
  W.player.x = z.door.x * TILE + 8; W.player.y = z.door.y * TILE + 14; W.player.target = null;
}
function navigateZone(zoneId) {
  teleportTo(zoneId);
  closeDrawer();
  const path = zoneRoute(zoneId, projectId);
  if (path) router.navigate(path);
}
function openDrawer(focusFilter) {
  drawerOpen = true; els.drawer.classList.add('open'); els.menuBtn.setAttribute('aria-expanded', 'true');
  if (focusFilter && els.filter) { els.filter.value = ''; filterDrawer(''); els.filter.focus(); }
}
function closeDrawer() {
  if (!drawerOpen) return;
  drawerOpen = false; els.drawer.classList.remove('open'); els.menuBtn.setAttribute('aria-expanded', 'false');
}
function toggleDrawer() { drawerOpen ? closeDrawer() : openDrawer(false); }
function filterDrawer(q) {
  const term = q.trim().toLowerCase();
  els.ftList.querySelectorAll('.world-ft-item').forEach((el) => {
    const hit = !term || el.dataset.search.includes(term);
    el.hidden = !hit;
  });
}

/* ------------------------------------------------------------------- onboarding */
function openOnboard() {
  onboardOpen = true;
  closeDrawer();
  els.obLegend.innerHTML = W.zones.map((z) => `<div class="world-ob-li"><span class="d" style="background:${z.color};color:${z.color}"></span><b>${z.name}</b><span>${zoneWhat(z.id)}</span></div>`).join('');
  els.onboard.classList.add('open');
  if (els.obGo) els.obGo.focus();
}
function closeOnboard() {
  onboardOpen = false; els.onboard.classList.remove('open');
  try { sessionStorage.setItem('se_hollow_onboarded', '1'); } catch (e) { /* private mode */ }
}
function zoneWhat(id) { const z = ZONES.find((zz) => zz.id === id); return z ? z.what : ''; }
function maybeOnboard() {
  if (onboardChecked) return;
  onboardChecked = true;
  let seen = false;
  try { seen = sessionStorage.getItem('se_hollow_onboarded') === '1'; } catch (e) { /* private mode */ }
  if (!seen) openOnboard();
}

/* ------------------------------------------------------------------- return / esc */
function returnToWorld() { router.navigate(`/projects/${projectId}`); }

/* ----------------------------------------------------------------------- keyboard */
const MOVE = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
function onKeydown(e) {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '') || (e.target && e.target.isContentEditable);
  if (e.code === 'Escape') {
    if (onboardOpen) { closeOnboard(); return; }
    if (drawerOpen) { closeDrawer(); return; }
    if (overlayActive && !e.defaultPrevented) { returnToWorld(); return; }
    return;
  }
  if (typing) return;
  // Fast travel works from anywhere in the project.
  if (e.code === 'KeyM') { e.preventDefault(); toggleDrawer(); return; }
  if (e.code === 'Slash') { e.preventDefault(); openDrawer(true); return; }
  if (onboardOpen || overlayActive) return;
  // World-home only: walking + enter + quick jumps.
  if (e.code in MOVE || e.code === 'Space') e.preventDefault();
  if (e.code in MOVE) { W.keys[MOVE[e.code]] = true; W.player.target = null; fadeHint(); return; }
  if (e.code === 'KeyE' || e.code === 'Enter') { interact(); return; }
  if (/^Digit[1-6]$/.test(e.code)) { const z = ZONES[+e.code.slice(5) - 1]; if (z) navigateZone(z.id); }
}
function onKeyup(e) { if (W && e.code in MOVE) W.keys[MOVE[e.code]] = false; }

/* ----------------------------------------------------------------------- DOM build */
function svgIcon(name) {
  if (name === 'menu') return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>';
  if (name === 'info') return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><circle cx="12" cy="7.5" r="0.6" fill="currentColor"/></svg>';
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>';
}
function buildDom() {
  const shell = document.createElement('div');
  shell.id = 'world-shell'; shell.className = 'world-stage'; shell.setAttribute('aria-hidden', 'true');
  shell.innerHTML = `
    <canvas id="world-canvas" class="world-canvas" width="640" height="368"></canvas>
    <div class="world-fx world-vignette"></div>
    <div class="world-fx world-grain"></div>
    <div id="world-title" class="world-title"><div class="name" id="world-title-name">Your world</div><div class="tag" id="world-title-tag">a project of the SoulEngine</div></div>
    <div id="world-hint" class="world-hint"><span class="key">W</span><span class="key">A</span><span class="key">S</span><span class="key">D</span><span>move ·</span><span class="mouse">click</span><span>to walk or open ·</span><span class="key">E</span><span>enter</span></div>`;

  const nav = document.createElement('div');
  nav.id = 'world-nav'; nav.className = 'world-controls';
  nav.innerHTML = `
    <button id="world-menu" class="world-btn" title="Fast travel (M)" aria-label="Fast travel" aria-haspopup="true" aria-expanded="false" aria-controls="world-drawer">${svgIcon('menu')}</button>
    <button id="world-info" class="world-btn world-info" title="How this works" aria-label="How this works">${svgIcon('info')}</button>
    <button id="world-return" class="world-return" hidden>${svgIcon('back')}<span>The Hollow</span></button>
    <nav id="world-drawer" class="world-drawer" aria-label="Fast travel">
      <h2>Fast travel</h2>
      <input id="world-filter" class="world-filter" type="text" placeholder="Jump to a place…" aria-label="Filter landmarks" autocomplete="off" />
      <div id="world-ft-list" class="world-ft-list" role="list">
        ${ZONES.map((z, i) => {
          const color = GEO[z.id].color;
          const search = `${z.name} ${z.tag} ${z.what}`.toLowerCase();
          return `<button class="world-ft-item" role="listitem" data-zone="${z.id}" data-search="${search}"><span class="dot" style="background:${color};color:${color}"></span><span class="meta"><span class="name">${z.name}</span><span class="tag">${z.tag}</span></span><span class="kbd">${i + 1}</span></button>`;
        }).join('')}
      </div>
    </nav>`;

  const onboard = document.createElement('div');
  onboard.id = 'world-onboard'; onboard.setAttribute('role', 'dialog'); onboard.setAttribute('aria-modal', 'true'); onboard.setAttribute('aria-label', 'How the world works');
  onboard.innerHTML = `
    <div class="world-ob-card">
      <div class="world-ob-eyebrow">WELCOME TO THE HOLLOW</div>
      <h2 class="world-ob-title">Your project is a <span>little world</span> — walk it.</h2>
      <p class="world-ob-sub">Every part of your project is a place here. Stroll over on foot, or just click where you want to go. Whatever you open stays inside this world — close it and you are right back here.</p>
      <div class="world-ob-controls">
        <div class="world-ob-ctl"><div class="keys"><span class="kbd">W</span><span class="kbd">A</span><span class="kbd">S</span><span class="kbd">D</span></div><div class="t"><b>Move around</b><span>or use the arrow keys</span></div></div>
        <div class="world-ob-ctl"><div class="keys"><span class="click">CLICK</span></div><div class="t"><b>Walk or open, fast</b><span>click the ground to walk there — or a building or person to open it straight away</span></div></div>
        <div class="world-ob-ctl"><div class="keys"><span class="kbd">E</span></div><div class="t"><b>Enter</b><span>step up to a glowing door and press E (or ↵)</span></div></div>
        <div class="world-ob-ctl"><div class="keys"><span class="kbd">M</span> <span class="kbd">/</span></div><div class="t"><b>Fast travel</b><span>jump straight to any landmark (also the ☰ menu)</span></div></div>
      </div>
      <div class="world-ob-legend-h">WHAT EACH PLACE IS</div>
      <div class="world-ob-legend" id="world-ob-legend"></div>
      <button class="world-ob-go" id="world-ob-go">Enter the Hollow</button>
      <div class="world-ob-foot">Reopen this anytime with the ⓘ button.</div>
    </div>`;

  document.body.appendChild(shell);
  document.body.appendChild(nav);
  document.body.appendChild(onboard);

  const canvas = shell.querySelector('#world-canvas');
  const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false;
  els = {
    shell, nav, onboard, canvas, ctx,
    title: shell.querySelector('#world-title'),
    titleName: shell.querySelector('#world-title-name'),
    titleTag: shell.querySelector('#world-title-tag'),
    hint: shell.querySelector('#world-hint'),
    menuBtn: nav.querySelector('#world-menu'),
    infoBtn: nav.querySelector('#world-info'),
    returnBtn: nav.querySelector('#world-return'),
    drawer: nav.querySelector('#world-drawer'),
    filter: nav.querySelector('#world-filter'),
    ftList: nav.querySelector('#world-ft-list'),
    obLegend: onboard.querySelector('#world-ob-legend'),
    obGo: onboard.querySelector('#world-ob-go'),
  };
}

function wireDom() {
  const sig = { signal: ac.signal };
  els.canvas.addEventListener('mousemove', (ev) => {
    if (onboardOpen || overlayActive) { W.hover = null; els.canvas.classList.remove('clickable'); return; }
    const w = screenToWorld(ev);
    if (!w.inside) { W.hover = null; els.canvas.classList.remove('clickable'); return; }
    W.hover = hitTest(w.x, w.y); els.canvas.classList.toggle('clickable', !!W.hover);
  }, sig);
  els.canvas.addEventListener('click', (ev) => {
    if (onboardOpen || overlayActive) return;
    const w = screenToWorld(ev); if (!w.inside) return;
    const hit = hitTest(w.x, w.y);
    if (hit) { openHit(hit); return; }
    const tx = Math.floor(w.x / TILE), ty = Math.floor(w.y / TILE);
    if (!solidAt(tx, ty)) { W.player.target = { x: w.x, y: w.y }; fadeHint(); }
  }, sig);
  els.canvas.addEventListener('mouseleave', () => { W.hover = null; els.canvas.classList.remove('clickable'); }, sig);

  els.menuBtn.addEventListener('click', toggleDrawer, sig);
  els.infoBtn.addEventListener('click', openOnboard, sig);
  els.returnBtn.addEventListener('click', returnToWorld, sig);
  els.obGo.addEventListener('click', closeOnboard, sig);
  els.filter.addEventListener('input', () => filterDrawer(els.filter.value), sig);
  els.filter.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const first = els.ftList.querySelector('.world-ft-item:not([hidden])'); if (first) navigateZone(first.dataset.zone); }
    else if (e.key === 'Escape') { closeDrawer(); els.menuBtn.focus(); }
  }, sig);
  els.ftList.querySelectorAll('.world-ft-item').forEach((el) => {
    el.addEventListener('click', () => navigateZone(el.dataset.zone), sig);
  });

  addEventListener('keydown', onKeydown, sig);
  addEventListener('keyup', onKeyup, sig);
}

function teardownDom() {
  [els && els.shell, els && els.nav, els && els.onboard].forEach((n) => { if (n && n.parentNode) n.parentNode.removeChild(n); });
}

/* ------------------------------------------------------------------------- data */
async function loadData() {
  const pid = projectId;
  try {
    const project = await api.projects.get(pid);
    if (!mounted || projectId !== pid) return;
    W.project = adaptProject(project);
    if (W.titleZone === '__none' || W.titleZone === '__x') { els.titleName.textContent = W.project.name; els.titleTag.textContent = W.project.tag; }
  } catch (e) { console.warn('[world] could not load project', e); }
  try {
    const list = adaptNpcs(npcsFromResponse(await api.npcs.list(pid)));
    if (!mounted || projectId !== pid) return;
    W.npcList = list;
    const n = clampFigures(list.length, FIGURE_SPOTS.length);
    const figures = list.slice(0, n).map((npc, i) => ({ kind: 'npc', x: FIGURE_SPOTS[i].x, y: FIGURE_SPOTS[i].y, npc }));
    W.chars = figures.concat([{ kind: 'scholar', x: 29, y: 8, name: 'The Scholar' }]);
    W.loaded = true;
    rebuildSolids();
  } catch (e) {
    console.warn('[world] could not load NPCs', e);
    W.loaded = true;
  }
}

/* ------------------------------------------------------------------ public surface */
function ensureMounted(pid) {
  if (mounted && projectId === pid) return;
  if (mounted) unmount();
  projectId = pid;
  ac = new AbortController();
  buildWorld();
  buildDom();
  wireDom();
  document.body.classList.add('world-active');
  mounted = true;
  onboardChecked = false;
  startLoop();
  render(0);
  loadData();
  exposeDebug();
}

function setOverlay(on) {
  overlayActive = on;
  document.body.classList.toggle('world-overlay', on);
  document.body.classList.toggle('world-home', !on);
  els.shell.classList.toggle('is-dim', on);
  if (on) {
    els.shell.setAttribute('inert', '');
    els.returnBtn.hidden = false;
    closeDrawer();
    stopLoop();
    for (const k in W.keys) W.keys[k] = false;
  } else {
    els.shell.removeAttribute('inert');
    els.returnBtn.hidden = true;
    startLoop();
    maybeOnboard();
  }
}

function syncToRoute(path) {
  const r = parseProjectRoute(path);
  if (!r) { if (mounted) unmount(); return; }
  ensureMounted(r.projectId);
  setOverlay(r.view !== 'home');
}

function unmount() {
  stopLoop();
  if (ac) { ac.abort(); ac = null; }
  teardownDom();
  document.body.classList.remove('world-active', 'world-home', 'world-overlay');
  if (window.__world) { try { delete window.__world; } catch (e) { window.__world = undefined; } }
  mounted = false; projectId = null; overlayActive = false; drawerOpen = false; onboardOpen = false; els = null; W = null;
}

function exposeDebug() {
  window.__world = {
    get player() { return W && W.player; },
    get zones() { return W && W.zones; },
    get chars() { return W && W.chars; },
    get npcList() { return W && W.npcList; },
    get nearest() { return W && W.nearest; },
    get hover() { return W && W.hover; },
    get state() { return { mounted, projectId, overlayActive, drawerOpen, onboardOpen, rafRunning: !!rafId }; },
    interact, openOnboard, closeOnboard, toggleDrawer, navigateZone, hitTest,
    step: (dt) => { if (W) { update(typeof dt === 'number' ? dt : 0.1); render(0); } },
  };
}

export { ensureMounted, syncToRoute, unmount };
export default { ensureMounted, syncToRoute, unmount };
