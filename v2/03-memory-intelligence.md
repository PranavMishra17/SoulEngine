# V2 Feature: Memory & Intelligence System

## Overview

This cluster implements per-NPC salience thresholds for the Weekly Whisper memory cycle. Different NPCs will have different memory retention abilities based on their "intelligence" - smart characters remember more details while dim-witted ones forget more easily. This creates more varied and realistic NPC behaviors.

## Features

### 1. Per-NPC Salience Threshold
- **Purpose**: Allow NPCs to have different memory retention abilities
- **Implementation**: Add `salience_threshold` to NPC definition (default: 0.7)
- **Effect**: Lower threshold = remember more, Higher threshold = forget more

### 2. Intelligence Metrics
- **Purpose**: Store intelligence-related metrics in NPC state
- **Implementation**: Add `intelligence_profile` to NPC definition
- **Effect**: Provides context for memory behavior and can influence other systems

### 3. Weekly Whisper Customization
- **Purpose**: Make memory pruning use per-NPC thresholds
- **Implementation**: Pass NPC-specific threshold to `runWeeklyWhisper`
- **Effect**: Smart NPCs retain more memories, dim ones retain fewer

---

## Implementation Steps

### Step 1: Update Type Definitions

**File: `src/types/npc.ts`**

Add intelligence and memory settings to NPC definition:

```typescript
/**
 * Intelligence profile affecting memory and cognitive behaviors
 */
export interface IntelligenceProfile {
  /**
   * Salience threshold for LTM promotion (0.0 - 1.0)
   * Lower = remembers more, Higher = forgets more
   * Default: 0.7
   */
  salience_threshold: number;
  
  /**
   * Maximum short-term memories to retain per Weekly Whisper cycle
   * Default: 3
   */
  stm_retain_count: number;
  
  /**
   * Description of cognitive style (for prompt context)
   * e.g., "sharp and observant", "forgetful and distracted"
   */
  cognitive_style?: string;
}

/**
 * Preset intelligence profiles
 */
export const INTELLIGENCE_PRESETS = {
  genius: {
    salience_threshold: 0.4,
    stm_retain_count: 5,
    cognitive_style: 'exceptionally sharp memory, notices and remembers small details',
  },
  smart: {
    salience_threshold: 0.5,
    stm_retain_count: 4,
    cognitive_style: 'good memory, remembers important conversations well',
  },
  average: {
    salience_threshold: 0.7,
    stm_retain_count: 3,
    cognitive_style: 'typical memory, remembers significant events',
  },
  forgetful: {
    salience_threshold: 0.8,
    stm_retain_count: 2,
    cognitive_style: 'often forgets things, only remembers major events',
  },
  dimwit: {
    salience_threshold: 0.9,
    stm_retain_count: 1,
    cognitive_style: 'poor memory, struggles to recall past conversations',
  },
} as const;

export type IntelligencePreset = keyof typeof INTELLIGENCE_PRESETS;

export interface NPCDefinition {
  // ... existing fields ...
  
  /**
   * Intelligence profile affecting memory behavior
   * If not specified, defaults to 'average' preset
   */
  intelligence_profile: IntelligenceProfile;
}
```

### Step 2: Update Memory System

**File: `src/core/memory.ts`**

Add functions for intelligence-aware memory operations:

```typescript
import type { IntelligenceProfile, INTELLIGENCE_PRESETS } from '../types/npc.js';

/**
 * Default intelligence profile (average)
 */
export const DEFAULT_INTELLIGENCE: IntelligenceProfile = {
  salience_threshold: 0.7,
  stm_retain_count: 3,
  cognitive_style: 'typical memory, remembers significant events',
};

/**
 * Get effective intelligence profile with defaults
 */
export function getEffectiveIntelligence(
  profile: IntelligenceProfile | undefined
): IntelligenceProfile {
  if (!profile) {
    return DEFAULT_INTELLIGENCE;
  }
  
  return {
    salience_threshold: profile.salience_threshold ?? DEFAULT_INTELLIGENCE.salience_threshold,
    stm_retain_count: profile.stm_retain_count ?? DEFAULT_INTELLIGENCE.stm_retain_count,
    cognitive_style: profile.cognitive_style ?? DEFAULT_INTELLIGENCE.cognitive_style,
  };
}

/**
 * Check if a memory should be promoted to LTM based on intelligence
 */
export function shouldPromoteToLTM(
  memorySalience: number,
  intelligenceProfile: IntelligenceProfile
): boolean {
  return memorySalience >= intelligenceProfile.salience_threshold;
}

/**
 * Get the number of STM memories to retain during Weekly Whisper
 */
export function getRetainCount(intelligenceProfile: IntelligenceProfile): number {
  return intelligenceProfile.stm_retain_count;
}
```

### Step 3: Update Weekly Whisper Cycle

**File: `src/core/cycles.ts`**

Modify `runWeeklyWhisper` to use per-NPC thresholds:

```typescript
import { 
  getEffectiveIntelligence, 
  shouldPromoteToLTM, 
  getRetainCount 
} from './memory.js';
import type { IntelligenceProfile } from '../types/npc.js';

/**
 * Run the Weekly Whisper cycle with intelligence-aware thresholds.
 *
 * This cycle:
 * 1. Reviews all STM memories
 * 2. Selects the most salient ones to retain (based on intelligence)
 * 3. REPLACES STM with the retained memories (aggressive pruning)
 * 4. Promotes high-salience memories to LTM (based on intelligence threshold)
 *
 * Token cost: ~500 tokens
 */
export async function runWeeklyWhisper(
  instance: NPCInstance,
  intelligenceProfile?: IntelligenceProfile  // New parameter
): Promise<WeeklyWhisperResult> {
  const startTime = Date.now();
  
  // Get effective intelligence profile
  const intelligence = getEffectiveIntelligence(intelligenceProfile);
  const retainCount = getRetainCount(intelligence);
  
  logger.info({ 
    instanceId: instance.id, 
    retainCount,
    salienceThreshold: intelligence.salience_threshold,
  }, 'Running weekly whisper with intelligence profile');

  try {
    const originalSTMCount = instance.short_term_memory.length;

    // Sort by salience (highest first)
    const sortedMemories = [...instance.short_term_memory].sort(
      (a, b) => b.salience - a.salience
    );

    // Retain top N memories based on intelligence
    const retained = sortedMemories.slice(0, retainCount);
    const discarded = sortedMemories.slice(retainCount);

    // Promote high-salience memories to LTM using intelligence threshold
    const toPromote = retained.filter((m) => 
      shouldPromoteToLTM(m.salience, intelligence)
    );
    let promoted = 0;

    for (const memory of toPromote) {
      const promotedMemory = promoteToLTM(memory);
      instance.long_term_memory.push(promotedMemory);
      promoted++;
    }

    // Prune LTM if over limit
    const ltmPruneResult = pruneLTM(instance.long_term_memory);
    instance.long_term_memory = ltmPruneResult.kept;

    // REPLACE STM with retained memories
    instance.short_term_memory = retained;

    // Update cycle metadata
    instance.cycle_metadata.last_weekly = new Date().toISOString();

    const duration = Date.now() - startTime;
    logger.info(
      {
        instanceId: instance.id,
        duration,
        originalSTM: originalSTMCount,
        retained: retained.length,
        discarded: discarded.length,
        promoted,
        finalLTM: instance.long_term_memory.length,
        salienceThreshold: intelligence.salience_threshold,
      },
      'Weekly whisper completed'
    );

    return {
      success: true,
      memoriesRetained: retained.length,
      memoriesDiscarded: discarded.length,
      memoriesPromoted: promoted,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ instanceId: instance.id, error: errorMessage, duration }, 'Weekly whisper failed');

    return {
      success: false,
      memoriesRetained: instance.short_term_memory.length,
      memoriesDiscarded: 0,
      memoriesPromoted: 0,
      timestamp: new Date().toISOString(),
    };
  }
}
```

### Step 4: Update Cycles Route

**File: `src/routes/cycles.ts`**

Pass intelligence profile to Weekly Whisper:

```typescript
import { getDefinition } from '../storage/definitions.js';
import { getEffectiveIntelligence } from '../core/memory.js';

cyclesRoutes.post('/:instanceId/weekly', async (c) => {
  const instanceId = c.req.param('instanceId');
  
  try {
    // Load instance
    const instance = await getInstance(instanceId);
    
    // Load definition to get intelligence profile
    const definition = await getDefinition(instance.project_id, instance.definition_id);
    const intelligence = getEffectiveIntelligence(definition.intelligence_profile);
    
    // Run weekly whisper with NPC's intelligence
    const result = await runWeeklyWhisper(instance, intelligence);
    
    if (result.success) {
      await saveInstance(instance);
    }
    
    return c.json({
      success: result.success,
      retained: result.memoriesRetained,
      discarded: result.memoriesDiscarded,
      promoted: result.memoriesPromoted,
      salience_threshold: intelligence.salience_threshold,
      timestamp: result.timestamp,
    });
  } catch (error) {
    // ... error handling ...
  }
});
```

### Step 5: Update Context Assembly

**File: `src/core/context.ts`**

Include cognitive style in system prompt:

```typescript
/**
 * Format intelligence/cognitive style for the prompt
 */
function formatCognitiveStyle(
  intelligenceProfile: IntelligenceProfile | undefined
): string {
  const intelligence = getEffectiveIntelligence(intelligenceProfile);
  
  if (!intelligence.cognitive_style) {
    return '';
  }
  
  return `[YOUR MENTAL TRAITS]
Memory style: ${intelligence.cognitive_style}
(This affects how well you recall past conversations - roleplay accordingly)`;
}

// Update assembleSystemPrompt to include cognitive style
export async function assembleSystemPrompt(
  definition: NPCDefinition,
  instance: NPCInstance,
  resolvedKnowledge: string,
  securityContext: SecurityContext,
  options: ContextAssemblyOptions = {},
  playerInfo?: PlayerInfo | null
): Promise<string> {
  // ... existing code ...

  // Add cognitive style after personality section
  const cognitiveSection = formatCognitiveStyle(definition.intelligence_profile);
  if (cognitiveSection) {
    sections.push(cognitiveSection);
  }

  // ... rest of function ...
}
```

### Step 6: Update NPC Definition Validation

**File: `src/storage/definitions.ts`**

Add validation for intelligence profile:

```typescript
function validateDefinition(def: NPCDefinition): void {
  // ... existing validation ...

  // Validate intelligence profile (optional field)
  if (def.intelligence_profile) {
    const intel = def.intelligence_profile;
    
    if (intel.salience_threshold !== undefined) {
      if (typeof intel.salience_threshold !== 'number' || 
          intel.salience_threshold < 0 || 
          intel.salience_threshold > 1) {
        throw new StorageValidationError(
          'intelligence_profile.salience_threshold must be a number between 0 and 1'
        );
      }
    }
    
    if (intel.stm_retain_count !== undefined) {
      if (!Number.isInteger(intel.stm_retain_count) || 
          intel.stm_retain_count < 1 || 
          intel.stm_retain_count > 10) {
        throw new StorageValidationError(
          'intelligence_profile.stm_retain_count must be an integer between 1 and 10'
        );
      }
    }
    
    if (intel.cognitive_style !== undefined && 
        typeof intel.cognitive_style !== 'string') {
      throw new StorageValidationError(
        'intelligence_profile.cognitive_style must be a string'
      );
    }
  }
}
```

### Step 7: Update NPC Editor UI

**File: `web/js/pages/npc-editor.js`**

Add intelligence settings to the editor:

```javascript
// Intelligence presets
const INTELLIGENCE_PRESETS = {
  genius: {
    salience_threshold: 0.4,
    stm_retain_count: 5,
    cognitive_style: 'exceptionally sharp memory, notices and remembers small details',
  },
  smart: {
    salience_threshold: 0.5,
    stm_retain_count: 4,
    cognitive_style: 'good memory, remembers important conversations well',
  },
  average: {
    salience_threshold: 0.7,
    stm_retain_count: 3,
    cognitive_style: 'typical memory, remembers significant events',
  },
  forgetful: {
    salience_threshold: 0.8,
    stm_retain_count: 2,
    cognitive_style: 'often forgets things, only remembers major events',
  },
  dimwit: {
    salience_threshold: 0.9,
    stm_retain_count: 1,
    cognitive_style: 'poor memory, struggles to recall past conversations',
  },
};

// In getDefaultDefinition()
function getDefaultDefinition() {
  return {
    // ... existing fields ...
    intelligence_profile: {
      salience_threshold: 0.7,
      stm_retain_count: 3,
      cognitive_style: 'typical memory, remembers significant events',
    },
  };
}

// Bind intelligence handlers
function bindIntelligenceHandlers() {
  // Preset selector
  document.getElementById('intelligence-preset')?.addEventListener('change', (e) => {
    const preset = INTELLIGENCE_PRESETS[e.target.value];
    if (preset) {
      applyIntelligencePreset(preset);
    }
  });

  // Manual sliders
  document.getElementById('salience-threshold')?.addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    currentDefinition.intelligence_profile.salience_threshold = value;
    document.getElementById('val-salience-threshold').textContent = value.toFixed(2);
    // Reset preset to custom
    document.getElementById('intelligence-preset').value = '';
  });

  document.getElementById('stm-retain-count')?.addEventListener('input', (e) => {
    const value = parseInt(e.target.value);
    currentDefinition.intelligence_profile.stm_retain_count = value;
    document.getElementById('val-stm-retain-count').textContent = value;
    document.getElementById('intelligence-preset').value = '';
  });

  document.getElementById('cognitive-style')?.addEventListener('input', (e) => {
    currentDefinition.intelligence_profile.cognitive_style = e.target.value;
  });
}

function applyIntelligencePreset(preset) {
  currentDefinition.intelligence_profile = { ...preset };
  
  // Update UI
  const thresholdSlider = document.getElementById('salience-threshold');
  const retainSlider = document.getElementById('stm-retain-count');
  const cognitiveInput = document.getElementById('cognitive-style');
  
  if (thresholdSlider) {
    thresholdSlider.value = preset.salience_threshold;
    document.getElementById('val-salience-threshold').textContent = 
      preset.salience_threshold.toFixed(2);
  }
  
  if (retainSlider) {
    retainSlider.value = preset.stm_retain_count;
    document.getElementById('val-stm-retain-count').textContent = 
      preset.stm_retain_count;
  }
  
  if (cognitiveInput) {
    cognitiveInput.value = preset.cognitive_style;
  }
}
```

**File: `web/index.html`**

Add intelligence section to NPC editor template:

```html
<!-- In template-npc-editor, add new section -->
<div class="editor-section" id="section-intelligence">
  <h3>Intelligence & Memory</h3>
  <p class="section-description">
    Configure how well this NPC remembers conversations. Affects the Weekly Whisper memory cycle.
  </p>

  <div class="form-group">
    <label for="intelligence-preset">Intelligence Preset</label>
    <select id="intelligence-preset" class="input">
      <option value="">Custom</option>
      <option value="genius">Genius - Remembers everything</option>
      <option value="smart">Smart - Good memory</option>
      <option value="average" selected>Average - Normal memory</option>
      <option value="forgetful">Forgetful - Poor memory</option>
      <option value="dimwit">Dimwit - Very poor memory</option>
    </select>
  </div>

  <div class="form-group">
    <label for="salience-threshold">
      Salience Threshold
      <span class="value-display" id="val-salience-threshold">0.70</span>
    </label>
    <input type="range" id="salience-threshold" class="slider" 
      min="0.3" max="0.95" step="0.05" value="0.7">
    <p class="hint">
      Lower = remembers more (genius), Higher = forgets more (dimwit)
    </p>
  </div>

  <div class="form-group">
    <label for="stm-retain-count">
      Memories Per Cycle
      <span class="value-display" id="val-stm-retain-count">3</span>
    </label>
    <input type="range" id="stm-retain-count" class="slider" 
      min="1" max="5" step="1" value="3">
    <p class="hint">
      Short-term memories retained during Weekly Whisper
    </p>
  </div>

  <div class="form-group">
    <label for="cognitive-style">Cognitive Style Description</label>
    <input type="text" id="cognitive-style" class="input" 
      placeholder="e.g., sharp and observant, easily distracted"
      value="typical memory, remembers significant events">
    <p class="hint">
      Describes how this NPC's memory works (used in prompts)
    </p>
  </div>

  <div class="intelligence-preview">
    <h4>Memory Behavior Preview</h4>
    <div class="preview-stats">
      <div class="stat">
        <span class="stat-label">Will promote to LTM if salience ≥</span>
        <span class="stat-value" id="preview-ltm-threshold">0.70</span>
      </div>
      <div class="stat">
        <span class="stat-label">STM retained per cycle</span>
        <span class="stat-value" id="preview-stm-count">3</span>
      </div>
    </div>
  </div>
</div>

<!-- Add navigation item for the new section -->
<a href="#" class="editor-nav-item" data-section="intelligence">
  <span class="nav-icon">🧠</span>
  <span class="nav-label">Intelligence</span>
</a>
```

### Step 8: Update Mind Viewer

**File: `web/js/pages/playground.js`**

Show intelligence info in Mind Viewer:

```javascript
function renderMindViewerContent(instance) {
  // ... existing sections ...

  // Add intelligence profile section (if available from definition)
  const intelligenceHtml = `
    <div class="mind-section">
      <h4><span class="icon">🧠</span> Intelligence Profile</h4>
      <div class="intelligence-stats">
        <div class="stat-item">
          <span class="stat-label">Salience Threshold</span>
          <span class="stat-value">${(instance._intelligence?.salience_threshold ?? 0.7).toFixed(2)}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">STM Retain Count</span>
          <span class="stat-value">${instance._intelligence?.stm_retain_count ?? 3}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Cognitive Style</span>
          <span class="stat-value">${instance._intelligence?.cognitive_style ?? 'Average'}</span>
        </div>
      </div>
    </div>
  `;

  return `
    <div class="mind-viewer-content">
      ${moodHtml}
      ${intelligenceHtml}
      ${traitModsHtml}
      ${shortMemHtml}
      ${longMemHtml}
      ${relationshipsHtml}
      ${cycleMetaHtml}
    </div>
  `;
}
```

---

## Migration Notes

### Default Values for Existing NPCs

When loading existing NPCs without `intelligence_profile`:

```typescript
// In getDefinition() or when loading
const definition = yaml.load(content) as NPCDefinition;

// Apply defaults for missing intelligence profile
if (!definition.intelligence_profile) {
  definition.intelligence_profile = {
    salience_threshold: 0.7,
    stm_retain_count: 3,
    cognitive_style: 'typical memory, remembers significant events',
  };
}
```

---

## Intelligence Effects Summary

| Preset | Salience Threshold | STM Retain | LTM Promotion | Behavior |
|--------|-------------------|------------|---------------|----------|
| Genius | 0.4 | 5 | Salience ≥ 0.4 | Remembers most things, detailed recall |
| Smart | 0.5 | 4 | Salience ≥ 0.5 | Good memory, recalls important events |
| Average | 0.7 | 3 | Salience ≥ 0.7 | Normal memory, major events only |
| Forgetful | 0.8 | 2 | Salience ≥ 0.8 | Poor memory, only very significant events |
| Dimwit | 0.9 | 1 | Salience ≥ 0.9 | Very poor memory, trauma-level events only |

---

## Testing Checklist

1. [ ] Create NPC with "genius" intelligence - verify low threshold is used
2. [ ] Create NPC with "dimwit" intelligence - verify high threshold is used
3. [ ] Run Weekly Whisper on genius NPC - verify more memories promoted
4. [ ] Run Weekly Whisper on dimwit NPC - verify fewer memories promoted
5. [ ] Verify STM retain count is respected during Weekly Whisper
6. [ ] Verify cognitive style appears in system prompt
7. [ ] Verify backward compatibility with NPCs without intelligence_profile
8. [ ] Test preset application in NPC editor
9. [ ] Test manual slider adjustments override preset

---

## API Changes Summary

| Component | Change |
|-----------|--------|
| NPCDefinition | Added `intelligence_profile` object |
| Weekly Whisper | Now accepts optional `intelligenceProfile` parameter |
| Cycles API | Returns `salience_threshold` in response |
| System Prompt | Includes cognitive style when available |

---

## Future Enhancements

1. **Dynamic Intelligence**: Intelligence could fluctuate based on mood (tired = more forgetful)
2. **Topic-specific Memory**: Better memory for subjects the NPC cares about
3. **Memory Decay**: Gradual salience decay over time based on intelligence
4. **Learning**: NPCs could improve memory for repeated topics

