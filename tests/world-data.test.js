import { describe, it, expect } from 'vitest';
import {
  ZONES,
  NPC_PALETTE,
  zoneRoute,
  parseProjectRoute,
  isProjectRoute,
  isWorldHome,
  isZoneRoute,
  adaptProject,
  adaptNpcs,
  npcsFromResponse,
  clampFigures,
} from '../web/js/pages/world-data.js';

describe('ZONES', () => {
  it('defines the six canonical landmarks', () => {
    expect(ZONES.map((z) => z.id).sort()).toEqual(
      ['archive', 'commons', 'core', 'foundry', 'parley', 'workshop'].sort(),
    );
  });

  it('leads with the Foundry (highest frequency-of-use)', () => {
    expect(ZONES[0].id).toBe('foundry');
  });

  it('gives every zone a name, tag, what and route', () => {
    for (const z of ZONES) {
      expect(z.name).toBeTruthy();
      expect(z.tag).toBeTruthy();
      expect(z.what).toBeTruthy();
      expect(z.route).toBeTruthy();
    }
  });
});

describe('zoneRoute', () => {
  it('maps each zone to its existing app route', () => {
    expect(zoneRoute('foundry', 'p1')).toBe('/projects/p1/npcs');
    expect(zoneRoute('archive', 'p1')).toBe('/projects/p1/knowledge');
    expect(zoneRoute('workshop', 'p1')).toBe('/projects/p1/mcp-tools');
    expect(zoneRoute('parley', 'p1')).toBe('/projects/p1/playground');
    expect(zoneRoute('core', 'p1')).toBe('/projects/p1/settings');
  });

  it('routes the Commons to the relocated dashboard at /overview', () => {
    expect(zoneRoute('commons', 'p1')).toBe('/projects/p1/overview');
  });

  it('returns null for an unknown zone or missing project', () => {
    expect(zoneRoute('nowhere', 'p1')).toBeNull();
    expect(zoneRoute('foundry', '')).toBeNull();
    expect(zoneRoute('foundry', undefined)).toBeNull();
  });
});

describe('parseProjectRoute', () => {
  it('returns null for non-project paths', () => {
    expect(parseProjectRoute('/')).toBeNull();
    expect(parseProjectRoute('/projects')).toBeNull();
    expect(parseProjectRoute('')).toBeNull();
    expect(parseProjectRoute('/login')).toBeNull();
  });

  it('classifies the bare project path as the world home', () => {
    expect(parseProjectRoute('/projects/abc')).toEqual({
      projectId: 'abc',
      view: 'home',
      zone: null,
    });
  });

  it('classifies each zone path as an overlay with its zone', () => {
    expect(parseProjectRoute('/projects/abc/npcs')).toEqual({ projectId: 'abc', view: 'overlay', zone: 'foundry' });
    expect(parseProjectRoute('/projects/abc/knowledge')).toEqual({ projectId: 'abc', view: 'overlay', zone: 'archive' });
    expect(parseProjectRoute('/projects/abc/mcp-tools')).toEqual({ projectId: 'abc', view: 'overlay', zone: 'workshop' });
    expect(parseProjectRoute('/projects/abc/playground')).toEqual({ projectId: 'abc', view: 'overlay', zone: 'parley' });
    expect(parseProjectRoute('/projects/abc/settings')).toEqual({ projectId: 'abc', view: 'overlay', zone: 'core' });
    expect(parseProjectRoute('/projects/abc/overview')).toEqual({ projectId: 'abc', view: 'overlay', zone: 'commons' });
  });

  it('treats a deep NPC editor path as the Foundry overlay', () => {
    expect(parseProjectRoute('/projects/abc/npcs/npc-7')).toEqual({
      projectId: 'abc',
      view: 'overlay',
      zone: 'foundry',
    });
  });

  it('keeps an unknown sub-path within project context (overlay, no zone)', () => {
    expect(parseProjectRoute('/projects/abc/something')).toEqual({
      projectId: 'abc',
      view: 'overlay',
      zone: null,
    });
  });

  it('ignores query strings and hashes', () => {
    expect(parseProjectRoute('/projects/abc?tab=1')).toEqual({ projectId: 'abc', view: 'home', zone: null });
    expect(parseProjectRoute('/projects/abc/npcs#top')).toEqual({ projectId: 'abc', view: 'overlay', zone: 'foundry' });
  });
});

describe('route classifiers', () => {
  it('isProjectRoute covers home and zone paths but not the list', () => {
    expect(isProjectRoute('/projects/abc')).toBe(true);
    expect(isProjectRoute('/projects/abc/npcs')).toBe(true);
    expect(isProjectRoute('/projects')).toBe(false);
    expect(isProjectRoute('/')).toBe(false);
  });

  it('isWorldHome is true only for the bare project path', () => {
    expect(isWorldHome('/projects/abc')).toBe(true);
    expect(isWorldHome('/projects/abc/npcs')).toBe(false);
    expect(isWorldHome('/projects')).toBe(false);
  });

  it('isZoneRoute is true only for overlay sub-paths', () => {
    expect(isZoneRoute('/projects/abc/knowledge')).toBe(true);
    expect(isZoneRoute('/projects/abc')).toBe(false);
    expect(isZoneRoute('/projects')).toBe(false);
  });
});

describe('zoneRoute <-> parseProjectRoute round-trip', () => {
  it('every zone resolves back to itself', () => {
    for (const z of ZONES) {
      const path = zoneRoute(z.id, 'p1');
      expect(path).toBeTruthy();
      expect(parseProjectRoute(path)).toEqual({ projectId: 'p1', view: 'overlay', zone: z.id });
    }
  });
});

describe('adaptProject', () => {
  it('maps a real project', () => {
    expect(adaptProject({ id: 'p1', name: 'Verdant Hollow' })).toEqual({
      id: 'p1',
      name: 'Verdant Hollow',
      tag: 'a project of the SoulEngine',
    });
  });

  it('falls back gracefully for null / missing name', () => {
    expect(adaptProject(null)).toEqual({ id: null, name: 'Untitled project', tag: 'a project of the SoulEngine' });
    expect(adaptProject({ id: 'p2' }).name).toBe('Untitled project');
  });
});

describe('npcsFromResponse', () => {
  it('unwraps the { npcs: [...] } envelope returned by the list endpoint', () => {
    expect(npcsFromResponse({ npcs: [{ id: 'a' }, { id: 'b' }] })).toEqual([{ id: 'a' }, { id: 'b' }]);
  });
  it('passes a bare array through', () => {
    expect(npcsFromResponse([{ id: 'a' }])).toEqual([{ id: 'a' }]);
  });
  it('returns an empty array for null / unexpected shapes', () => {
    expect(npcsFromResponse(null)).toEqual([]);
    expect(npcsFromResponse(undefined)).toEqual([]);
    expect(npcsFromResponse({})).toEqual([]);
    expect(npcsFromResponse({ npcs: 'nope' })).toEqual([]);
  });
});

describe('adaptNpcs', () => {
  it('shapes definitions and assigns deterministic palette colors', () => {
    const out = adaptNpcs([
      { id: 'a', name: 'Elara', description: 'Innkeeper' },
      { id: 'b', name: 'Bram', description: 'Blacksmith', profile_image: 'bram.png' },
    ]);
    expect(out).toEqual([
      { id: 'a', name: 'Elara', role: 'Innkeeper', color: NPC_PALETTE[0], hasImage: false },
      { id: 'b', name: 'Bram', role: 'Blacksmith', color: NPC_PALETTE[1], hasImage: true },
    ]);
  });

  it('cycles the palette beyond its length', () => {
    const many = Array.from({ length: NPC_PALETTE.length + 1 }, (_, i) => ({ id: `n${i}`, name: `N${i}` }));
    const out = adaptNpcs(many);
    expect(out[NPC_PALETTE.length].color).toBe(NPC_PALETTE[0]);
  });

  it('returns an empty array for non-array / empty input', () => {
    expect(adaptNpcs(null)).toEqual([]);
    expect(adaptNpcs(undefined)).toEqual([]);
    expect(adaptNpcs([])).toEqual([]);
  });
});

describe('clampFigures', () => {
  it('bounds a count between 0 and max', () => {
    expect(clampFigures(3)).toBe(3);
    expect(clampFigures(99)).toBe(6);
    expect(clampFigures(99, 10)).toBe(10);
    expect(clampFigures(-5)).toBe(0);
    expect(clampFigures(NaN)).toBe(0);
    expect(clampFigures(2.9)).toBe(2);
  });
});
