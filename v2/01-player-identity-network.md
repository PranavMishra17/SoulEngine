# V2 Feature: Player Identity & Social Network

## Overview

This cluster implements enhanced player-NPC relationship initialization and bidirectional social network awareness. It allows developers to specify whether an NPC should "know" the player before conversation starts, and enriches the existing NPC network system with bidirectional awareness logic.

## Features

### 1. Player Initialization Flag
- **Purpose**: Let developers/users choose if the NPC knows the player before starting a conversation
- **Use Cases**:
  - In games: Specify if NPC recognizes the player character by name
  - In playground: Test conversations where NPC already knows the player

### 2. Bidirectional Network Awareness
- **Purpose**: Differentiate between "you know them" vs "they know you" relationships
- **Use Cases**:
  - NPCs can recognize famous players without the player knowing them
  - One-sided relationships (celebrity/fan, guard/citizen)

### 3. Player as Network Entity
- **Purpose**: Integrate the player into the same network structure as NPCs
- **Use Cases**:
  - Track player-NPC relationships using the same data model
  - Enable NPCs to have tiered knowledge of the player

---

## Implementation Steps

### Step 1: Update Type Definitions

**File: `src/types/npc.ts`**

Add player recognition settings to NPCDefinition:

```typescript
/**
 * Player recognition settings for an NPC
 */
export interface PlayerRecognition {
  /** If true, NPC can be told who the player is before conversation */
  can_know_player: boolean;
  /** Default familiarity tier if player is known (1-3) */
  default_player_tier: 1 | 2 | 3;
  /** If true, player info is included in system prompt */
  reveal_player_identity: boolean;
}

/**
 * NPC network entry with bidirectional awareness
 */
export interface NPCNetworkEntry {
  npc_id: string;
  familiarity_tier: 1 | 2 | 3;
  /** Does this NPC know that the other NPC knows them back? */
  mutual_awareness: boolean;
  /** How the other NPC knows this one (if different from how we know them) */
  reverse_context?: string;
}

export interface NPCDefinition {
  // ... existing fields ...
  
  /** Player recognition settings */
  player_recognition: PlayerRecognition;
  
  /** NPCs this character knows (max 5) - now with bidirectional support */
  network: NPCNetworkEntry[];
}
```

### Step 2: Update Session Types

**File: `src/types/session.ts`**

Add player info to session initialization:

```typescript
export interface PlayerInfo {
  /** Player's character name (for NPC to address them) */
  name: string;
  /** Brief description visible to NPC */
  description?: string;
  /** Player's role/title if relevant */
  role?: string;
  /** Custom context for this conversation */
  context?: string;
}

export interface SessionInitRequest {
  project_id: string;
  npc_id: string;
  player_id: string;
  /** If provided and NPC has can_know_player=true, NPC will know the player */
  player_info?: PlayerInfo;
}

export interface SessionState {
  // ... existing fields ...
  
  /** Player info passed at session start (if any) */
  player_info: PlayerInfo | null;
}
```

### Step 3: Update Session Manager

**File: `src/session/manager.ts`**

Modify `startSession` to accept and store player info:

```typescript
export async function startSession(
  projectId: string,
  npcId: string,
  playerId: string,
  playerInfo?: PlayerInfo  // New parameter
): Promise<SessionStartResult> {
  // ... existing code ...

  // Load NPC definition
  const definition = await getDefinition(projectId, npcId);
  
  // Determine if player info should be used
  const effectivePlayerInfo = definition.player_recognition?.can_know_player && playerInfo
    ? playerInfo
    : null;

  // Create session state
  const sessionState: SessionState = {
    // ... existing fields ...
    player_info: effectivePlayerInfo,
  };

  // ... rest of function ...
}
```

### Step 4: Update Context Assembly

**File: `src/core/context.ts`**

Add player identity formatting to system prompt:

```typescript
/**
 * Format player identity section for the prompt
 */
function formatPlayerIdentity(
  playerInfo: PlayerInfo | null,
  playerRecognition: PlayerRecognition | undefined
): string {
  if (!playerInfo || !playerRecognition?.reveal_player_identity) {
    return `[THE PERSON YOU'RE TALKING TO]
- You don't know who this person is
- Treat them as a stranger unless they introduce themselves`;
  }

  let section = `[THE PERSON YOU'RE TALKING TO]
- Name: ${playerInfo.name}`;

  if (playerInfo.description) {
    section += `\n- ${playerInfo.description}`;
  }

  if (playerInfo.role) {
    section += `\n- They are known as: ${playerInfo.role}`;
  }

  if (playerInfo.context) {
    section += `\n- ${playerInfo.context}`;
  }

  return section;
}

/**
 * Format bidirectional network awareness
 */
function formatBidirectionalNetwork(entry: NPCNetworkEntry, npc: NPCDefinition): string {
  let text = formatTierNpc(entry.familiarity_tier, npc);
  
  if (entry.mutual_awareness) {
    text += `\n  (They know you too - you've met before)`;
  } else if (entry.reverse_context) {
    text += `\n  (${entry.reverse_context})`;
  }
  
  return text;
}

// Update assembleSystemPrompt to include player identity
export async function assembleSystemPrompt(
  definition: NPCDefinition,
  instance: NPCInstance,
  resolvedKnowledge: string,
  securityContext: SecurityContext,
  options: ContextAssemblyOptions = {},
  playerInfo?: PlayerInfo | null  // New parameter
): Promise<string> {
  // ... existing code ...

  // Add player identity section after relationship section
  sections.push(formatPlayerIdentity(playerInfo, definition.player_recognition));

  // ... rest of function ...
}
```

### Step 5: Update Session Routes

**File: `src/routes/session.ts`**

Update the start session endpoint to accept player info:

```typescript
const StartSessionSchema = z.object({
  project_id: z.string().min(1),
  npc_id: z.string().min(1),
  player_id: z.string().min(1),
  player_info: z.object({
    name: z.string().min(1).max(50),
    description: z.string().max(200).optional(),
    role: z.string().max(50).optional(),
    context: z.string().max(500).optional(),
  }).optional(),
});

sessionRoutes.post('/start', async (c) => {
  // ... existing validation ...
  
  const { project_id, npc_id, player_id, player_info } = parsed.data;
  
  const result = await startSession(project_id, npc_id, player_id, player_info);
  
  // ... rest of handler ...
});
```

### Step 6: Update NPC Definition Storage

**File: `src/storage/definitions.ts`**

Add validation for new fields:

```typescript
function validateDefinition(def: NPCDefinition): void {
  // ... existing validation ...

  // Validate player recognition (optional field)
  if (def.player_recognition) {
    if (typeof def.player_recognition.can_know_player !== 'boolean') {
      throw new StorageValidationError('player_recognition.can_know_player must be boolean');
    }
    if (![1, 2, 3].includes(def.player_recognition.default_player_tier)) {
      throw new StorageValidationError('player_recognition.default_player_tier must be 1, 2, or 3');
    }
  }

  // Validate network bidirectional fields
  if (def.network) {
    for (const entry of def.network) {
      if (entry.mutual_awareness !== undefined && typeof entry.mutual_awareness !== 'boolean') {
        throw new StorageValidationError('Network entry mutual_awareness must be boolean');
      }
      if (entry.reverse_context && entry.reverse_context.length > 200) {
        throw new StorageValidationError('Network entry reverse_context too long (max 200)');
      }
    }
  }
}
```

### Step 7: Update NPC Editor UI

**File: `web/js/pages/npc-editor.js`**

Add player recognition settings to the editor:

```javascript
// In getDefaultDefinition()
function getDefaultDefinition() {
  return {
    // ... existing fields ...
    player_recognition: {
      can_know_player: true,
      default_player_tier: 1,
      reveal_player_identity: true,
    },
    network: [],
  };
}

// Add new section in editor HTML template
// Section: Player Recognition (add to template-npc-editor in index.html)
/*
<div class="editor-section" id="section-player">
  <h3>Player Recognition</h3>
  
  <div class="form-group">
    <label class="checkbox-item">
      <input type="checkbox" id="can-know-player">
      <span>NPC can know who the player is</span>
    </label>
    <p class="hint">When enabled, player name/info can be passed at session start</p>
  </div>

  <div class="form-group">
    <label class="checkbox-item">
      <input type="checkbox" id="reveal-player-identity">
      <span>Include player identity in NPC's context</span>
    </label>
    <p class="hint">If disabled, NPC treats player as stranger even if info is passed</p>
  </div>

  <div class="form-group">
    <label for="default-player-tier">Default Player Familiarity</label>
    <select id="default-player-tier" class="input">
      <option value="1">Acquaintance (knows name only)</option>
      <option value="2">Familiar (knows some background)</option>
      <option value="3">Close (knows well)</option>
    </select>
    <p class="hint">How well NPC knows the player when identity is provided</p>
  </div>
</div>
*/

// Bind handlers for player recognition
document.getElementById('can-know-player')?.addEventListener('change', (e) => {
  currentDefinition.player_recognition.can_know_player = e.target.checked;
});

document.getElementById('reveal-player-identity')?.addEventListener('change', (e) => {
  currentDefinition.player_recognition.reveal_player_identity = e.target.checked;
});

document.getElementById('default-player-tier')?.addEventListener('change', (e) => {
  currentDefinition.player_recognition.default_player_tier = parseInt(e.target.value);
});
```

### Step 8: Update Playground UI

**File: `web/js/pages/playground.js`**

Add player name input field:

```javascript
// In handleStartSession()
async function handleStartSession() {
  const playerId = document.getElementById('player-id')?.value || 'test-player';
  const playerName = document.getElementById('player-name')?.value?.trim() || null;
  const playerDescription = document.getElementById('player-description')?.value?.trim() || null;
  
  // ... existing code ...

  // Build player info if name provided
  const playerInfo = playerName ? {
    name: playerName,
    description: playerDescription || undefined,
  } : undefined;

  // Start session with player info
  const result = await session.start(currentProjectId, currentNpcId, playerId, playerInfo);
  
  // ... rest of function ...
}
```

**File: `web/index.html`**

Add player info fields to playground template:

```html
<!-- In template-playground, add after player-id field -->
<div class="form-group">
  <label for="player-name">Player Character Name (optional)</label>
  <input type="text" id="player-name" class="input" placeholder="e.g., Sir Aldric">
  <p class="hint">If set, NPC may recognize and address the player by name</p>
</div>

<div class="form-group">
  <label for="player-description">Player Description (optional)</label>
  <textarea id="player-description" class="input" rows="2" 
    placeholder="e.g., A knight wearing silver armor with the royal crest"></textarea>
  <p class="hint">Brief description visible to the NPC</p>
</div>
```

### Step 9: Update Network Tab with Bidirectional UI

**File: `web/js/pages/npc-editor.js`**

Enhance network entry to show bidirectional options:

```javascript
// In loadNetworkTab(), update the entry rendering
container.innerHTML = otherNpcs.map(npc => {
  const existing = currentNetwork.find(n => n.npc_id === npc.id);
  const isKnown = !!existing;
  const tier = existing?.familiarity_tier || 1;
  const mutualAwareness = existing?.mutual_awareness ?? true;
  const reverseContext = existing?.reverse_context || '';

  return `
    <div class="network-entry ${isKnown ? 'active' : ''}" data-npc-id="${npc.id}">
      <label class="network-toggle">
        <input type="checkbox" class="network-checkbox" ${isKnown ? 'checked' : ''}>
        <div class="network-npc-info">
          <span class="network-npc-name">${escapeHtml(npc.name)}</span>
          <span class="network-npc-desc">${escapeHtml(npc.description || 'No description')}</span>
        </div>
      </label>
      
      <div class="network-options ${!isKnown ? 'hidden' : ''}">
        <select class="input network-tier">
          <option value="1" ${tier === 1 ? 'selected' : ''}>Acquaintance</option>
          <option value="2" ${tier === 2 ? 'selected' : ''}>Familiar</option>
          <option value="3" ${tier === 3 ? 'selected' : ''}>Close</option>
        </select>
        
        <label class="checkbox-item network-mutual">
          <input type="checkbox" class="mutual-checkbox" ${mutualAwareness ? 'checked' : ''}>
          <span>They know you back</span>
        </label>
        
        <input type="text" class="input network-reverse-context" 
          placeholder="How they know you (if one-sided)" 
          value="${escapeHtml(reverseContext)}"
          ${mutualAwareness ? 'disabled' : ''}>
      </div>
    </div>
  `;
}).join('');

// Update bindNetworkHandlers to handle new fields
function bindNetworkHandlers() {
  document.querySelectorAll('.network-entry').forEach(entry => {
    const npcId = entry.dataset.npcId;
    const checkbox = entry.querySelector('.network-checkbox');
    const tierSelect = entry.querySelector('.network-tier');
    const mutualCheckbox = entry.querySelector('.mutual-checkbox');
    const reverseInput = entry.querySelector('.network-reverse-context');
    const optionsDiv = entry.querySelector('.network-options');

    checkbox.addEventListener('change', (e) => {
      const isChecked = e.target.checked;
      entry.classList.toggle('active', isChecked);
      optionsDiv.classList.toggle('hidden', !isChecked);
      
      updateNetworkEntry(npcId, isChecked, {
        tier: parseInt(tierSelect.value),
        mutual: mutualCheckbox.checked,
        reverseContext: reverseInput.value,
      });
    });

    tierSelect.addEventListener('change', (e) => {
      updateNetworkEntry(npcId, true, {
        tier: parseInt(e.target.value),
        mutual: mutualCheckbox.checked,
        reverseContext: reverseInput.value,
      });
    });

    mutualCheckbox.addEventListener('change', (e) => {
      reverseInput.disabled = e.target.checked;
      updateNetworkEntry(npcId, true, {
        tier: parseInt(tierSelect.value),
        mutual: e.target.checked,
        reverseContext: e.target.checked ? '' : reverseInput.value,
      });
    });

    reverseInput.addEventListener('input', (e) => {
      updateNetworkEntry(npcId, true, {
        tier: parseInt(tierSelect.value),
        mutual: false,
        reverseContext: e.target.value,
      });
    });
  });
}

function updateNetworkEntry(npcId, isKnown, options) {
  if (!currentDefinition.network) {
    currentDefinition.network = [];
  }

  const existingIdx = currentDefinition.network.findIndex(n => n.npc_id === npcId);

  if (isKnown) {
    const entry = {
      npc_id: npcId,
      familiarity_tier: options.tier,
      mutual_awareness: options.mutual,
      reverse_context: options.mutual ? undefined : options.reverseContext || undefined,
    };

    if (existingIdx >= 0) {
      currentDefinition.network[existingIdx] = entry;
    } else {
      currentDefinition.network.push(entry);
    }
  } else {
    if (existingIdx >= 0) {
      currentDefinition.network.splice(existingIdx, 1);
    }
  }

  updateNetworkCount();
}
```

### Step 10: Update API Client

**File: `web/js/api.js`**

Update session.start to accept player info:

```javascript
export const session = {
  async start(projectId, npcId, playerId, playerInfo = null) {
    const body = {
      project_id: projectId,
      npc_id: npcId,
      player_id: playerId,
    };
    
    if (playerInfo) {
      body.player_info = playerInfo;
    }
    
    return fetchApi('/api/session/start', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
  // ... other methods ...
};
```

---

## Migration Notes

### Default Values for Existing NPCs

When loading existing NPCs without `player_recognition`:

```typescript
// In getDefinition() or when loading
const definition = yaml.load(content) as NPCDefinition;

// Apply defaults for missing fields
if (!definition.player_recognition) {
  definition.player_recognition = {
    can_know_player: true,
    default_player_tier: 1,
    reveal_player_identity: true,
  };
}

// Apply defaults for network entries
if (definition.network) {
  definition.network = definition.network.map(entry => ({
    ...entry,
    mutual_awareness: entry.mutual_awareness ?? true,
  }));
}
```

---

## Testing Checklist

1. [ ] Create NPC with player recognition enabled
2. [ ] Start session with player info - verify NPC uses player name
3. [ ] Start session without player info - verify NPC treats player as stranger
4. [ ] Test with can_know_player=false - verify player info is ignored
5. [ ] Test bidirectional network - mutual awareness case
6. [ ] Test bidirectional network - one-sided case with reverse context
7. [ ] Verify backward compatibility with existing NPCs

---

## API Changes Summary

| Endpoint | Change |
|----------|--------|
| `POST /api/session/start` | Added optional `player_info` in request body |
| NPC Definition | Added `player_recognition` object |
| NPC Network Entry | Added `mutual_awareness` and `reverse_context` fields |

