/**
 * world-data.js
 *
 * Pure, dependency-free helpers for the project "world" shell.
 * No DOM, no network, no imports — so the routing/adapter logic can be unit
 * tested in isolation while the canvas/rendering lives in world-shell.js.
 *
 * The world is the persistent project home. Each landmark ("zone") maps to an
 * existing app route; walking to / clicking a landmark navigates there and the
 * page opens as an overlay over the still-mounted world.
 */

/**
 * Canonical landmark definitions — the single source of truth shared by the
 * router mapping, the fast-travel drawer and the onboarding legend.
 *
 * `route` is the path suffix appended after `/projects/:projectId`.
 * Order encodes frequency-of-use (Foundry first, Core/Commons last) so the
 * fast-travel list and visual emphasis stay consistent.
 *
 * @typedef {Object} Zone
 * @property {string} id
 * @property {string} name
 * @property {string} tag    Short in-world subtitle.
 * @property {string} what   Plain one-liner for onboarding / a11y labels.
 * @property {string} route  Path suffix under /projects/:projectId.
 */

/** @type {Zone[]} */
export const ZONES = [
  { id: 'foundry',  name: 'The Foundry',  tag: 'Where minds are forged',              what: 'Design your NPCs — their mind, voice, knowledge and ties.', route: 'npcs' },
  { id: 'parley',   name: 'The Parley',   tag: 'The bar where every soul drinks',     what: 'The bar — sit and talk to anyone, in text or voice.',      route: 'playground' },
  { id: 'archive',  name: 'The Archive',  tag: 'The deeper you go, the more they know', what: "Your world's knowledge, gated tier by tier.",            route: 'knowledge' },
  { id: 'workshop', name: 'The Workshop', tag: 'Every lever your NPCs can pull',      what: 'The tools your NPCs are allowed to use.',                  route: 'mcp-tools' },
  { id: 'commons',  name: 'The Commons',  tag: 'The town square — heart of the Hollow', what: 'The town square — your whole project at a glance.',      route: 'overview' },
  { id: 'core',     name: 'The Core',     tag: 'Beneath the floor of the world',      what: 'Project settings, providers and API keys.',                route: 'settings' },
];

/** zone id -> route suffix */
const ZONE_TO_SUFFIX = Object.fromEntries(ZONES.map((z) => [z.id, z.route]));
/** route suffix -> zone id */
const SUFFIX_TO_ZONE = Object.fromEntries(ZONES.map((z) => [z.route, z.id]));

/** Pastel palette used to give ambient NPC figures distinct, stable colors. */
export const NPC_PALETTE = ['#f1a6c4', '#83e0c6', '#b6a6f2', '#e7c07a', '#9fb0c3', '#f5c27a'];

/**
 * Resolve a landmark to the full app path for a project.
 * @param {string} zoneId
 * @param {string} projectId
 * @returns {string|null} e.g. "/projects/p1/npcs", or null if inputs invalid.
 */
export function zoneRoute(zoneId, projectId) {
  if (!projectId) return null;
  const suffix = ZONE_TO_SUFFIX[zoneId];
  if (!suffix) return null;
  return `/projects/${projectId}/${suffix}`;
}

/**
 * Split a pathname into clean, non-empty segments.
 * @param {string} path
 * @returns {string[]}
 */
function segments(path) {
  return String(path || '').split(/[?#]/)[0].split('/').filter(Boolean);
}

/**
 * Classify a pathname relative to the project world.
 *
 *   /projects                 -> null              (the projects list, not a world)
 *   /projects/:id             -> { projectId, view: 'home',    zone: null }
 *   /projects/:id/npcs        -> { projectId, view: 'overlay', zone: 'foundry' }
 *   /projects/:id/npcs/:npcId -> { projectId, view: 'overlay', zone: 'foundry' }
 *   /projects/:id/overview    -> { projectId, view: 'overlay', zone: 'commons' }
 *   /projects/:id/<unknown>   -> { projectId, view: 'overlay', zone: null }
 *
 * @param {string} path
 * @returns {{projectId: string, view: 'home'|'overlay', zone: (string|null)}|null}
 */
export function parseProjectRoute(path) {
  const seg = segments(path);
  if (seg[0] !== 'projects' || seg.length < 2) return null;
  const projectId = seg[1];
  if (seg.length === 2) return { projectId, view: 'home', zone: null };
  const zone = SUFFIX_TO_ZONE[seg[2]] ?? null;
  return { projectId, view: 'overlay', zone };
}

/** @returns {boolean} true for /projects/:id and any /projects/:id/* path. */
export function isProjectRoute(path) {
  return parseProjectRoute(path) !== null;
}

/** @returns {boolean} true only for the bare /projects/:id world home. */
export function isWorldHome(path) {
  const r = parseProjectRoute(path);
  return !!r && r.view === 'home';
}

/** @returns {boolean} true for a zone/overlay path under a project. */
export function isZoneRoute(path) {
  const r = parseProjectRoute(path);
  return !!r && r.view === 'overlay';
}

/**
 * Shape a raw API project into the minimal model the world renders.
 * @param {{id?: string, name?: string}|null|undefined} project
 * @returns {{id: (string|null), name: string, tag: string}}
 */
export function adaptProject(project) {
  return {
    id: project?.id ?? null,
    name: (project && project.name) || 'Untitled project',
    tag: 'a project of the SoulEngine',
  };
}

/**
 * Unwrap the NPC list endpoint, which returns `{ npcs: [...] }` rather than a
 * bare array. Tolerates a bare array or anything unexpected.
 * @param {any} res
 * @returns {Array}
 */
export function npcsFromResponse(res) {
  if (Array.isArray(res)) return res;
  if (res && Array.isArray(res.npcs)) return res.npcs;
  return [];
}

/**
 * Shape raw API NPC definitions into ambient figures for the map.
 * Colors are assigned deterministically by index so a given roster always
 * renders the same.
 * @param {Array<{id?: string, name?: string, description?: string, profile_image?: string}>} npcs
 * @returns {Array<{id: string, name: string, role: string, color: string, hasImage: boolean}>}
 */
export function adaptNpcs(npcs) {
  if (!Array.isArray(npcs)) return [];
  return npcs.map((npc, i) => ({
    id: npc?.id ?? `npc-${i}`,
    name: (npc && npc.name) || 'Unnamed',
    role: (npc && npc.description) || '',
    color: NPC_PALETTE[i % NPC_PALETTE.length],
    hasImage: !!(npc && npc.profile_image),
  }));
}

/**
 * Clamp a raw count to a bounded number of ambient figures to draw.
 * @param {number} n
 * @param {number} [max=6]
 * @returns {number}
 */
export function clampFigures(n, max = 6) {
  const v = Number.isFinite(n) ? Math.floor(n) : 0;
  return Math.max(0, Math.min(max, v));
}
