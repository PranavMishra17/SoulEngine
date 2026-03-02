/**
 * Starter Pack Registry
 *
 * Loads all starter packs from data/starter-pack/{id}/ at startup.
 * Each subdirectory must contain: meta.json, npcs.json, knowledge-base.json, mcp-tools.json
 *
 * The data/starter-pack/ folder is committed to git and deployed to production,
 * so file-system reading works in all environments.
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { createLogger } from '../logger.js';

const logger = createLogger('starter-packs');

// ─── Types ───────────────────────────────────────────────────────────────────

export interface StarterPackPreviewNpc {
  name: string;
  role: string;
  description: string;
}

export interface StarterPackMeta {
  id: string;
  name: string;
  description: string;
  theme: string;
  npc_count: number;
  preview_npcs: StarterPackPreviewNpc[];
  knowledge_categories: string[];
  tool_count: number;
}

export interface StarterPack {
  meta: StarterPackMeta;
  npcs: unknown[];
  knowledge: { categories: Record<string, unknown> };
  tools: { conversation_tools: unknown[]; game_event_tools: unknown[] };
}

// ─── Internal cache ───────────────────────────────────────────────────────────

let _catalog: StarterPack[] | null = null;

function getPacksDir(): string {
  return join(process.cwd(), 'data', 'starter-pack');
}

function readJsonFile(filePath: string): unknown {
  const raw = readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function loadPack(packDir: string, packId: string): StarterPack | null {
  try {
    const meta = readJsonFile(join(packDir, 'meta.json')) as StarterPackMeta;
    // Ensure the id in meta matches the directory name
    meta.id = packId;

    const npcsData = readJsonFile(join(packDir, 'npcs.json')) as { npcs: unknown[] };
    const knowledgeData = readJsonFile(join(packDir, 'knowledge-base.json')) as { categories: Record<string, unknown> };
    const toolsData = readJsonFile(join(packDir, 'mcp-tools.json')) as { conversation_tools: unknown[]; game_event_tools: unknown[] };

    // Support both { npcs: [...] } and [...] array formats
    const npcs = Array.isArray(npcsData) ? npcsData : npcsData.npcs ?? [];

    return {
      meta,
      npcs,
      knowledge: knowledgeData,
      tools: toolsData,
    };
  } catch (error) {
    logger.error({ packId, error: String(error) }, 'Failed to load starter pack');
    return null;
  }
}

/**
 * Load all starter packs from the data/starter-pack/ directory.
 * Results are cached after first load.
 */
export function getStarterPackCatalog(): StarterPack[] {
  if (_catalog) return _catalog;

  const packsDir = getPacksDir();
  if (!existsSync(packsDir)) {
    logger.warn({ packsDir }, 'Starter pack directory not found');
    _catalog = [];
    return _catalog;
  }

  const entries = readdirSync(packsDir, { withFileTypes: true });
  const packs: StarterPack[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const packId = entry.name;
    const packDir = join(packsDir, packId);

    // Validate required files exist
    const required = ['meta.json', 'npcs.json', 'knowledge-base.json', 'mcp-tools.json'];
    const hasAll = required.every((f) => existsSync(join(packDir, f)));
    if (!hasAll) {
      logger.warn({ packId }, 'Starter pack directory missing required files — skipping');
      continue;
    }

    const pack = loadPack(packDir, packId);
    if (pack) {
      packs.push(pack);
      logger.info({ packId, name: pack.meta.name, npcs: pack.npcs.length }, 'Starter pack loaded');
    }
  }

  // Stable sort: space first, then alphabetical
  packs.sort((a, b) => {
    if (a.meta.id === 'space') return -1;
    if (b.meta.id === 'space') return 1;
    return a.meta.id.localeCompare(b.meta.id);
  });

  logger.info({ count: packs.length }, 'Starter pack catalog ready');
  _catalog = packs;
  return _catalog;
}

/**
 * Get a single starter pack by ID.
 */
export function getStarterPack(id: string): StarterPack | null {
  return getStarterPackCatalog().find((p) => p.meta.id === id) ?? null;
}

/**
 * Return only metadata for all packs (for the catalog API endpoint).
 */
export function getStarterPackMetaList(): StarterPackMeta[] {
  return getStarterPackCatalog().map((p) => p.meta);
}
