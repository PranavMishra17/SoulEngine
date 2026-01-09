# V2 Feature: Memory Retention System

## Status: ✅ IMPLEMENTED

## Overview

This feature implements per-NPC memory retention settings that affect how well NPCs remember conversations. The system uses a single `salience_threshold` value that controls:
1. How many memories get promoted to long-term memory during Weekly Whisper
2. How detailed conversation summaries are when sessions end

## Features

### Memory Retention Slider

A simple slider in the Personality section of the NPC editor allows developers to set memory retention from 0% (very forgetful) to 100% (exceptional memory).

| Retention | Salience Threshold | Memory Behavior |
|-----------|-------------------|-----------------|
| 80-100% | 0.35-0.47 | Exceptional - remembers small details, longer summaries |
| 60-80% | 0.47-0.59 | Good - remembers important events well |
| 40-60% | 0.59-0.71 | Average - remembers significant events |
| 20-40% | 0.71-0.83 | Poor - only remembers major events |
| 0-20% | 0.83-0.95 | Very forgetful - struggles to recall conversations |

---

## Implementation Details

### 1. Type Definition (`src/types/npc.ts`)

Added `salience_threshold` to `NPCDefinition`:

```typescript
export interface NPCDefinition {
  // ... existing fields ...
  
  /**
   * Salience threshold for memory retention (0.0 - 1.0)
   * Lower value = better memory (remembers more, more detailed summaries)
   * Higher value = worse memory (forgets more, brief summaries)
   * Default: 0.7
   */
  salience_threshold?: number;
}
```

### 2. Storage Defaults (`src/storage/definitions.ts`)

Applied default value when loading NPCs:

```typescript
// Default salience threshold (0.7 = average memory)
if (definition.salience_threshold === undefined) {
  definition.salience_threshold = 0.7;
}
```

Added validation:

```typescript
// Validate salience threshold (optional, defaults to 0.7)
if (def.salience_threshold !== undefined) {
  if (typeof def.salience_threshold !== 'number' || 
      def.salience_threshold < 0 || 
      def.salience_threshold > 1) {
    throw new StorageValidationError(
      'salience_threshold must be a number between 0 and 1'
    );
  }
}
```

### 3. Weekly Whisper Cycle (`src/core/cycles.ts`)

Updated `runWeeklyWhisper` to accept NPC-specific threshold:

```typescript
export async function runWeeklyWhisper(
  instance: NPCInstance,
  retainCount: number = 3,
  salienceThreshold: number = 0.7  // NPC-specific threshold
): Promise<WeeklyWhisperResult> {
  // ...
  
  // Promote memories to LTM using NPC's salience threshold
  // Lower threshold = better memory = more memories promoted
  const toPromote = retained.filter((m) => m.salience >= salienceThreshold);
  
  // ...
}
```

### 4. Cycles Route (`src/routes/cycles.ts`)

Updated route to load NPC definition and pass threshold:

```typescript
cycleRoutes.post('/:instanceId/weekly-whisper', async (c) => {
  // ... load instance ...
  
  // Load NPC definition to get salience threshold
  const definition = await getDefinition(instance.project_id, instance.definition_id);
  const salienceThreshold = definition.salience_threshold ?? 0.7;
  
  // Run weekly whisper with NPC's salience threshold
  const result = await runWeeklyWhisper(instance, retainCount, salienceThreshold);
  
  return c.json({
    ...result,
    salience_threshold: salienceThreshold,  // Include in response
    version: saveResult.version,
  });
});
```

### 5. Conversation Summarizer (`src/core/summarizer.ts`)

Added `salienceThreshold` to `NPCPerspective`:

```typescript
export interface NPCPerspective {
  name: string;
  backstory: string;
  principles: string[];
  salienceThreshold?: number;  // Memory retention affects detail level
}
```

Updated `buildSummarizationPrompt` to adjust detail based on memory:

```typescript
function buildSummarizationPrompt(npc: NPCPerspective): string {
  const threshold = npc.salienceThreshold ?? 0.7;
  
  let detailInstruction: string;
  let sentenceCount: string;
  
  if (threshold <= 0.4) {
    // Excellent memory - very detailed
    detailInstruction = `You have an exceptional memory. Include specific details...`;
    sentenceCount = '4-5 sentences';
  } else if (threshold <= 0.55) {
    // Good memory - detailed
    sentenceCount = '3-4 sentences';
  } else if (threshold <= 0.75) {
    // Average memory - standard
    sentenceCount = '2-3 sentences';
  } else {
    // Poor memory - brief
    sentenceCount = '1-2 sentences';
  }
  
  // ... build prompt with adaptive detail level ...
}
```

### 6. Session Manager (`src/session/manager.ts`)

Passes threshold when summarizing:

```typescript
const npcPerspective: NPCPerspective = {
  name: definition.name,
  backstory: definition.core_anchor.backstory,
  principles: definition.core_anchor.principles,
  salienceThreshold: definition.salience_threshold,  // Pass to summarizer
};

const summaryResult = await summarizeConversation(
  llmProvider,
  state.conversation_history,
  npcPerspective
);
```

### 7. NPC Editor UI (`web/index.html`, `web/js/pages/npc-editor.js`)

Added Memory Retention slider to Personality section:

```html
<div class="memory-retention-section">
  <h3>Memory Retention</h3>
  <p class="section-desc">How well does this NPC remember conversations?</p>
  <div class="slider-group memory-slider">
    <div class="slider-header">
      <label>Memory Retention</label>
      <span class="slider-value" id="val-memory-retention">50%</span>
    </div>
    <div class="slider-labels">
      <span>🧠 Forgetful</span>
      <span>🧠 Sharp Memory</span>
    </div>
    <input type="range" id="memory-retention" min="0" max="100" step="5" value="50">
    <p class="memory-hint" id="memory-hint">Average memory - remembers significant events</p>
  </div>
</div>
```

JavaScript conversion (UI percentage ↔ internal threshold):

```javascript
// UI shows 0-100 as "retention" (higher = better memory)
// Internally stored as salience_threshold (lower = better memory)

// When slider changes:
const retentionPercent = parseInt(e.target.value);
// Convert: 0% retention → 0.95 threshold, 100% retention → 0.35 threshold
const threshold = 0.95 - (retentionPercent / 100) * 0.6;
currentDefinition.salience_threshold = Math.round(threshold * 100) / 100;

// When loading:
const threshold = definition.salience_threshold ?? 0.7;
const retentionPercent = Math.round(((0.95 - threshold) / 0.6) * 100);
```

---

## Effects Summary

| Memory Retention | LTM Promotion | Summary Detail | Example NPC |
|-----------------|---------------|----------------|-------------|
| 80-100% (Genius) | Salience ≥ 0.35-0.47 | 4-5 sentences, includes details | Scholar, detective |
| 60-80% (Smart) | Salience ≥ 0.47-0.59 | 3-4 sentences | Merchant, guard captain |
| 40-60% (Average) | Salience ≥ 0.59-0.71 | 2-3 sentences | Typical villager |
| 20-40% (Forgetful) | Salience ≥ 0.71-0.83 | 1-2 sentences | Elderly NPC, drunk |
| 0-20% (Dimwit) | Salience ≥ 0.83-0.95 | 1 sentence, vague | Simple-minded NPC |

---

## Files Modified

| File | Changes |
|------|---------|
| `src/types/npc.ts` | Added `salience_threshold` field |
| `src/storage/definitions.ts` | Default value + validation |
| `src/core/cycles.ts` | `runWeeklyWhisper` accepts threshold |
| `src/routes/cycles.ts` | Loads NPC definition, passes threshold |
| `src/core/summarizer.ts` | Detail level adapts to threshold |
| `src/session/manager.ts` | Passes threshold to summarizer |
| `web/index.html` | Memory Retention slider in Personality section |
| `web/js/pages/npc-editor.js` | Slider handlers, conversion logic |
| `web/css/pages-app.css` | Styling for memory retention section |

---

## Testing Checklist

- [x] Create NPC with high memory retention (80%+) - verify lower threshold stored
- [x] Create NPC with low memory retention (20%-) - verify higher threshold stored
- [x] Run Weekly Whisper on high-memory NPC - more memories promoted to LTM
- [x] Run Weekly Whisper on low-memory NPC - fewer memories promoted
- [x] End session with high-memory NPC - longer, more detailed summary
- [x] End session with low-memory NPC - shorter, vaguer summary
- [x] Edit existing NPC - slider shows correct retention percentage
- [x] Backward compatibility - NPCs without threshold default to 0.7 (50%)

---

## API Response Changes

### Weekly Whisper Response

Now includes the threshold used:

```json
{
  "success": true,
  "memoriesRetained": 3,
  "memoriesDiscarded": 7,
  "memoriesPromoted": 2,
  "salience_threshold": 0.5,
  "timestamp": "2025-01-08T...",
  "version": 12
}
```

---

## Future Enhancements

1. **Dynamic memory** - Memory could fluctuate based on mood (tired = more forgetful)
2. **Topic-specific** - Better memory for subjects the NPC cares about
3. **Memory decay** - Gradual salience decay over time
4. **Visual indicator** - Show memory quality in playground Mind Viewer
