/**
 * NPC List and Editor Page Handlers
 */

import { npcs, knowledge, projects } from '../api.js';
import { toast, modal, loading, renderTemplate, updateNav, createTagInput, describePersonality } from '../components.js';
import { router } from '../router.js';

let currentProjectId = null;
let currentNpcId = null;
let currentDefinition = null;
let principlesInput = null;
let traumaInput = null;
let voicesCache = { cartesia: null, elevenlabs: null };
let currentVoiceLibraryUrl = '';

// Personality presets (Big Five trait values)
const PERSONALITY_PRESETS = {
  warm_friendly: {
    openness: 0.6,
    conscientiousness: 0.55,
    extraversion: 0.8,
    agreeableness: 0.85,
    neuroticism: 0.25,
  },
  reserved_sweet: {
    openness: 0.5,
    conscientiousness: 0.65,
    extraversion: 0.25,
    agreeableness: 0.8,
    neuroticism: 0.3,
  },
  short_tempered: {
    openness: 0.4,
    conscientiousness: 0.5,
    extraversion: 0.6,
    agreeableness: 0.25,
    neuroticism: 0.75,
  },
  volatile_unpredictable: {
    openness: 0.65,
    conscientiousness: 0.2,
    extraversion: 0.7,
    agreeableness: 0.35,
    neuroticism: 0.9,
  },
  honorable_principled: {
    openness: 0.45,
    conscientiousness: 0.9,
    extraversion: 0.5,
    agreeableness: 0.6,
    neuroticism: 0.2,
  },
  curious_intellectual: {
    openness: 0.95,
    conscientiousness: 0.6,
    extraversion: 0.5,
    agreeableness: 0.55,
    neuroticism: 0.35,
  },
  cautious_anxious: {
    openness: 0.3,
    conscientiousness: 0.7,
    extraversion: 0.3,
    agreeableness: 0.6,
    neuroticism: 0.8,
  },
  bold_confident: {
    openness: 0.6,
    conscientiousness: 0.65,
    extraversion: 0.85,
    agreeableness: 0.4,
    neuroticism: 0.15,
  },
};

/**
 * NPC List Page
 */
export async function initNpcListPage(params) {
  const { projectId } = params;
  currentProjectId = projectId;

  renderTemplate('template-npc-list');

  // Update navigation
  updateNav([
    { href: '/projects', label: 'Projects' },
    { href: `/projects/${projectId}`, label: 'Dashboard' },
    { href: `/projects/${projectId}/npcs`, label: 'NPCs', active: true },
    { href: `/projects/${projectId}/knowledge`, label: 'Knowledge' },
    { href: `/projects/${projectId}/playground`, label: 'Playground' },
  ]);

  // Update breadcrumb
  document.getElementById('breadcrumb-project')?.setAttribute('href', `/projects/${projectId}`);

  // Load NPCs
  await loadNpcList(projectId);

  // Bind event handlers
  document.getElementById('btn-create-npc')?.addEventListener('click', () => {
    router.navigate(`/projects/${projectId}/npcs/new`);
  });

  document.getElementById('btn-empty-create-npc')?.addEventListener('click', () => {
    router.navigate(`/projects/${projectId}/npcs/new`);
  });
}

async function loadNpcList(projectId) {
  const grid = document.getElementById('npc-grid');
  const emptyState = document.getElementById('empty-npcs');

  grid.innerHTML = loading.skeleton(3);

  try {
    const data = await npcs.list(projectId);
    const npcList = data.npcs || [];

    if (npcList.length === 0) {
      grid.innerHTML = '';
      emptyState.style.display = 'block';
      return;
    }

    emptyState.style.display = 'none';
    grid.innerHTML = npcList
      .map(
        (npc) => `
        <div class="npc-card" data-id="${npc.id}">
          <div class="npc-card-avatar">◇</div>
          <h3>${escapeHtml(npc.name)}</h3>
          <p>${escapeHtml(npc.description || 'No description')}</p>
        </div>
      `
      )
      .join('');

    // Bind card clicks
    grid.querySelectorAll('.npc-card').forEach((card) => {
      card.addEventListener('click', () => {
        router.navigate(`/projects/${projectId}/npcs/${card.dataset.id}`);
      });
    });
  } catch (error) {
    toast.error('Failed to Load NPCs', error.message);
    grid.innerHTML = `<div class="empty-state"><p>Failed to load NPCs</p></div>`;
  }
}

/**
 * NPC Editor Page
 */
export async function initNpcEditorPage(params) {
  const { projectId, npcId } = params;
  currentProjectId = projectId;
  currentNpcId = npcId === 'new' ? null : npcId;

  renderTemplate('template-npc-editor');

  // Update navigation
  updateNav([
    { href: '/projects', label: 'Projects' },
    { href: `/projects/${projectId}`, label: 'Dashboard' },
    { href: `/projects/${projectId}/npcs`, label: 'NPCs', active: true },
    { href: `/projects/${projectId}/knowledge`, label: 'Knowledge' },
    { href: `/projects/${projectId}/playground`, label: 'Playground' },
  ]);

  // Update breadcrumbs
  document.getElementById('breadcrumb-project')?.setAttribute('href', `/projects/${projectId}`);
  document.getElementById('breadcrumb-npcs')?.setAttribute('href', `/projects/${projectId}/npcs`);

  // Initialize form
  await initEditor(projectId, currentNpcId);

  // Bind navigation
  bindEditorNavigation();

  // Bind form handlers
  bindFormHandlers();

  // Bind buttons
  document.getElementById('btn-cancel')?.addEventListener('click', () => {
    router.navigate(`/projects/${projectId}/npcs`);
  });

  document.getElementById('btn-save-npc')?.addEventListener('click', handleSaveNpc);
  document.getElementById('btn-import-npc')?.addEventListener('click', handleImportNpc);
  document.getElementById('btn-export-npc')?.addEventListener('click', handleExportNpc);
  document.getElementById('btn-download-template')?.addEventListener('click', handleDownloadTemplate);
}

async function initEditor(projectId, npcId) {
  if (npcId) {
    // Edit existing NPC
    try {
      currentDefinition = await npcs.get(projectId, npcId);
      document.getElementById('editor-title').textContent = `Edit ${currentDefinition.name}`;
      document.getElementById('breadcrumb-npc').textContent = currentDefinition.name;
      populateForm(currentDefinition);
    } catch (error) {
      toast.error('Failed to Load NPC', error.message);
      router.navigate(`/projects/${projectId}/npcs`);
    }
  } else {
    // Create new NPC
    currentDefinition = getDefaultDefinition();
    document.getElementById('editor-title').textContent = 'Create NPC';
    document.getElementById('breadcrumb-npc').textContent = 'New NPC';
    populateForm(currentDefinition);
  }

  // Initialize tag inputs
  principlesInput = createTagInput(
    document.getElementById('principles-tags').parentElement,
    {
      tags: currentDefinition.core_anchor?.principles || [],
      placeholder: 'Add a principle...',
      onChange: (tags) => {
        currentDefinition.core_anchor.principles = tags;
      },
    }
  );

  traumaInput = createTagInput(
    document.getElementById('trauma-tags').parentElement,
    {
      tags: currentDefinition.core_anchor?.trauma_flags || [],
      placeholder: 'Add a trauma flag...',
      onChange: (tags) => {
        currentDefinition.core_anchor.trauma_flags = tags;
      },
    }
  );

  // Load knowledge categories
  await loadKnowledgeCategories(projectId);

  // Update live preview
  updatePreview();
}

function getDefaultDefinition() {
  return {
    name: '',
    description: '',
    core_anchor: {
      backstory: '',
      principles: [],
      trauma_flags: [],
    },
    personality_baseline: {
      openness: 0.5,
      conscientiousness: 0.5,
      extraversion: 0.5,
      agreeableness: 0.5,
      neuroticism: 0.5,
    },
    voice: {
      provider: 'cartesia',
      voice_id: '',
      speed: 1.0,
    },
    knowledge_access: {},
    mcp_permissions: {
      conversation_tools: [],
      game_event_tools: [],
      denied: [],
    },
    default_mood: '',
    schedule: [],
  };
}

function populateForm(definition) {
  // Basic info
  document.getElementById('npc-name').value = definition.name || '';
  document.getElementById('npc-description').value = definition.description || '';

  // Core anchor
  document.getElementById('anchor-backstory').value = definition.core_anchor?.backstory || '';

  // Personality
  const traits = definition.personality_baseline || {};
  Object.keys(traits).forEach((trait) => {
    const slider = document.getElementById(`trait-${trait}`);
    if (slider) {
      slider.value = traits[trait];
      document.getElementById(`val-${trait}`).textContent = traits[trait].toFixed(2);
    }
  });

  // Voice
  const voiceProvider = definition.voice?.provider || 'cartesia';
  document.getElementById('voice-provider').value = voiceProvider;
  document.getElementById('voice-speed').value = definition.voice?.speed || 1.0;
  document.getElementById('val-voice-speed').textContent = `${definition.voice?.speed || 1.0}x`;

  // Load voices and select current
  loadVoices(voiceProvider, definition.voice?.voice_id);

  // Schedule & State
  document.getElementById('default-mood').value = definition.default_mood || '';
  renderScheduleBlocks(definition.schedule || []);
}

function bindEditorNavigation() {
  document.querySelectorAll('.editor-nav-item').forEach((item) => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const section = item.dataset.section;

      // Update nav active state
      document.querySelectorAll('.editor-nav-item').forEach((n) => n.classList.remove('active'));
      item.classList.add('active');

      // Update section visibility
      document.querySelectorAll('.editor-section').forEach((s) => s.classList.remove('active'));
      document.getElementById(`section-${section}`)?.classList.add('active');
    });
  });
}

function bindFormHandlers() {
  // Basic info
  document.getElementById('npc-name')?.addEventListener('input', (e) => {
    currentDefinition.name = e.target.value;
    updatePreview();
  });

  document.getElementById('npc-description')?.addEventListener('input', (e) => {
    currentDefinition.description = e.target.value;
    updatePreview();
  });

  // Core anchor
  document.getElementById('anchor-backstory')?.addEventListener('input', (e) => {
    currentDefinition.core_anchor.backstory = e.target.value;
  });

  // Personality sliders
  ['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'neuroticism'].forEach((trait) => {
    const slider = document.getElementById(`trait-${trait}`);
    slider?.addEventListener('input', (e) => {
      const value = parseFloat(e.target.value);
      currentDefinition.personality_baseline[trait] = value;
      document.getElementById(`val-${trait}`).textContent = value.toFixed(2);
      // Reset preset to custom when manually adjusting
      document.getElementById('personality-preset').value = '';
      updatePreview();
      updatePersonalitySummary();
    });
  });

  // Personality preset
  document.getElementById('personality-preset')?.addEventListener('change', (e) => {
    const presetId = e.target.value;
    if (presetId) {
      applyPersonalityPreset(presetId);
    }
  });

  // Voice
  document.getElementById('voice-provider')?.addEventListener('change', (e) => {
    currentDefinition.voice.provider = e.target.value;
    currentDefinition.voice.voice_id = ''; // Reset voice when provider changes
    loadVoices(e.target.value);
  });

  document.getElementById('voice-select')?.addEventListener('change', (e) => {
    currentDefinition.voice.voice_id = e.target.value;
    updatePreviewButton();
  });

  document.getElementById('btn-refresh-voices')?.addEventListener('click', () => {
    const provider = currentDefinition.voice?.provider || 'cartesia';
    voicesCache[provider] = null; // Clear cache
    loadVoices(provider);
  });

  document.getElementById('btn-preview-voice')?.addEventListener('click', () => {
    previewVoice();
  });

  document.getElementById('voice-speed')?.addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    currentDefinition.voice.speed = value;
    document.getElementById('val-voice-speed').textContent = `${value.toFixed(1)}x`;
  });

  // Schedule & State
  document.getElementById('default-mood')?.addEventListener('change', (e) => {
    currentDefinition.default_mood = e.target.value;
  });

  document.getElementById('btn-add-schedule')?.addEventListener('click', () => {
    addScheduleBlock();
  });

  // Initialize personality summary
  updatePersonalitySummary();
}

async function loadKnowledgeCategories(projectId) {
  const grid = document.getElementById('knowledge-access-grid');
  const emptyEl = document.getElementById('empty-knowledge');

  try {
    const kb = await knowledge.get(projectId);
    const categories = Object.entries(kb.categories || {});

    if (categories.length === 0) {
      grid.innerHTML = '';
      emptyEl.style.display = 'block';
      document.getElementById('link-create-knowledge').href = `/projects/${projectId}/knowledge`;
      return;
    }

    emptyEl.style.display = 'none';

    grid.innerHTML = categories
      .map(
        ([catId, category]) => `
        <div class="knowledge-access-item">
          <div class="access-header">
            <label class="checkbox-item">
              <input type="checkbox" data-category="${catId}"
                ${currentDefinition.knowledge_access?.[catId] !== undefined ? 'checked' : ''}>
              <span>${escapeHtml(catId)}</span>
            </label>
            <select class="input select" data-category-depth="${catId}"
              ${currentDefinition.knowledge_access?.[catId] === undefined ? 'disabled' : ''}>
              ${Object.keys(category.depths || {})
                .map(
                  (depth) =>
                    `<option value="${depth}" ${currentDefinition.knowledge_access?.[catId] === parseInt(depth) ? 'selected' : ''}>
                      Depth ${depth}
                    </option>`
                )
                .join('')}
            </select>
          </div>
          <p class="access-description">${escapeHtml(category.description || '')}</p>
        </div>
      `
      )
      .join('');

    // Bind checkbox and dropdown handlers
    grid.querySelectorAll('[data-category]').forEach((checkbox) => {
      checkbox.addEventListener('change', (e) => {
        const catId = e.target.dataset.category;
        const depthSelect = grid.querySelector(`[data-category-depth="${catId}"]`);

        if (e.target.checked) {
          depthSelect.disabled = false;
          currentDefinition.knowledge_access[catId] = parseInt(depthSelect.value) || 0;
        } else {
          depthSelect.disabled = true;
          delete currentDefinition.knowledge_access[catId];
        }
      });
    });

    grid.querySelectorAll('[data-category-depth]').forEach((select) => {
      select.addEventListener('change', (e) => {
        const catId = e.target.dataset.categoryDepth;
        currentDefinition.knowledge_access[catId] = parseInt(e.target.value);
      });
    });
  } catch (error) {
    console.error('Failed to load knowledge categories:', error);
  }
}

function updatePreview() {
  document.getElementById('preview-name').textContent = currentDefinition.name || 'NPC Name';
  document.getElementById('preview-description').textContent =
    currentDefinition.description || 'Description will appear here...';

  // Update trait bars
  const traitsContainer = document.getElementById('preview-traits');
  const traits = currentDefinition.personality_baseline || {};

  traitsContainer.innerHTML = Object.entries(traits)
    .map(
      ([trait, value]) => `
      <div class="trait-bar">
        <span class="trait-bar-label">${trait.charAt(0).toUpperCase() + trait.slice(1, 4)}</span>
        <div class="trait-bar-track">
          <div class="trait-bar-fill" style="width: ${value * 100}%"></div>
        </div>
      </div>
    `
    )
    .join('');
}

function updatePersonalitySummary() {
  const summary = document.getElementById('personality-summary');
  if (summary) {
    const description = describePersonality(currentDefinition.personality_baseline);
    summary.innerHTML = `<p>${description}</p>`;
  }
}

/**
 * Apply a personality preset to the sliders
 */
function applyPersonalityPreset(presetId) {
  const preset = PERSONALITY_PRESETS[presetId];
  if (!preset) return;

  // Update definition and sliders
  Object.keys(preset).forEach((trait) => {
    const value = preset[trait];
    currentDefinition.personality_baseline[trait] = value;

    // Update slider
    const slider = document.getElementById(`trait-${trait}`);
    if (slider) {
      slider.value = value;
    }

    // Update value display
    const valueEl = document.getElementById(`val-${trait}`);
    if (valueEl) {
      valueEl.textContent = value.toFixed(2);
    }
  });

  // Update preview and summary
  updatePreview();
  updatePersonalitySummary();
}

async function handleSaveNpc() {
  // Validate
  if (!currentDefinition.name.trim()) {
    toast.warning('Name Required', 'Please enter a name for the NPC.');
    return;
  }

  const saveBtn = document.getElementById('btn-save-npc');
  loading.button(saveBtn, true);

  try {
    if (currentNpcId) {
      // Update existing
      await npcs.update(currentProjectId, currentNpcId, currentDefinition);
      toast.success('NPC Updated', `"${currentDefinition.name}" has been saved.`);
    } else {
      // Create new
      const created = await npcs.create(currentProjectId, currentDefinition);
      toast.success('NPC Created', `"${currentDefinition.name}" has been created.`);
      currentNpcId = created.id;
    }

    router.navigate(`/projects/${currentProjectId}/npcs`);
  } catch (error) {
    toast.error('Failed to Save NPC', error.message);
  } finally {
    loading.button(saveBtn, false);
  }
}

/**
 * Import NPC from JSON file
 */
function handleImportNpc() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';

  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const imported = JSON.parse(text);

      // Validate structure
      const errors = validateNpcDefinition(imported);
      if (errors.length > 0) {
        toast.error('Invalid NPC Definition', errors.join(', '));
        return;
      }

      // Merge into current definition
      currentDefinition = {
        ...getDefaultDefinition(),
        ...imported,
        core_anchor: {
          ...getDefaultDefinition().core_anchor,
          ...(imported.core_anchor || {}),
        },
        personality_baseline: {
          ...getDefaultDefinition().personality_baseline,
          ...(imported.personality_baseline || {}),
        },
        voice: {
          ...getDefaultDefinition().voice,
          ...(imported.voice || {}),
        },
        mcp_permissions: {
          ...getDefaultDefinition().mcp_permissions,
          ...(imported.mcp_permissions || {}),
        },
      };

      // Update form
      populateForm(currentDefinition);

      // Re-init tag inputs
      principlesInput?.destroy?.();
      traumaInput?.destroy?.();

      principlesInput = createTagInput(
        document.getElementById('principles-tags').parentElement,
        {
          tags: currentDefinition.core_anchor?.principles || [],
          placeholder: 'Add a principle...',
          onChange: (tags) => {
            currentDefinition.core_anchor.principles = tags;
          },
        }
      );

      traumaInput = createTagInput(
        document.getElementById('trauma-tags').parentElement,
        {
          tags: currentDefinition.core_anchor?.trauma_flags || [],
          placeholder: 'Add a trauma flag...',
          onChange: (tags) => {
            currentDefinition.core_anchor.trauma_flags = tags;
          },
        }
      );

      updatePreview();
      updatePersonalitySummary();

      toast.success('NPC Imported', `Loaded "${currentDefinition.name}" from file.`);
    } catch (error) {
      toast.error('Import Failed', 'Invalid JSON file: ' + error.message);
    }
  };

  input.click();
}

/**
 * Export current NPC to JSON file
 */
function handleExportNpc() {
  if (!currentDefinition.name) {
    toast.warning('No NPC Data', 'Create or load an NPC first.');
    return;
  }

  const json = JSON.stringify(currentDefinition, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `${currentDefinition.name.toLowerCase().replace(/\s+/g, '-')}.json`;
  a.click();

  URL.revokeObjectURL(url);
  toast.success('NPC Exported', `Saved "${currentDefinition.name}" to file.`);
}

/**
 * Download NPC template JSON
 */
async function handleDownloadTemplate() {
  try {
    const response = await fetch('/data/templates/npc-definition.json');
    if (!response.ok) throw new Error('Template not found');

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'npc-template.json';
    a.click();

    URL.revokeObjectURL(url);
    toast.success('Template Downloaded', 'NPC template saved to file.');
  } catch (error) {
    toast.error('Download Failed', error.message);
  }
}

/**
 * Validate NPC definition structure
 */
function validateNpcDefinition(def) {
  const errors = [];

  if (!def || typeof def !== 'object') {
    errors.push('Invalid JSON structure');
    return errors;
  }

  if (!def.name || typeof def.name !== 'string') {
    errors.push('Missing or invalid "name" field');
  }

  if (def.core_anchor) {
    if (def.core_anchor.backstory && typeof def.core_anchor.backstory !== 'string') {
      errors.push('Invalid backstory type');
    }
    if (def.core_anchor.principles && !Array.isArray(def.core_anchor.principles)) {
      errors.push('Principles must be an array');
    }
    if (def.core_anchor.trauma_flags && !Array.isArray(def.core_anchor.trauma_flags)) {
      errors.push('Trauma flags must be an array');
    }
  }

  if (def.personality_baseline) {
    const traits = ['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'neuroticism'];
    for (const trait of traits) {
      if (def.personality_baseline[trait] !== undefined) {
        const val = def.personality_baseline[trait];
        if (typeof val !== 'number' || val < 0 || val > 1) {
          errors.push(`${trait} must be a number between 0 and 1`);
        }
      }
    }
  }

  if (def.voice) {
    if (def.voice.speed !== undefined) {
      if (typeof def.voice.speed !== 'number' || def.voice.speed < 0.5 || def.voice.speed > 2) {
        errors.push('Voice speed must be between 0.5 and 2');
      }
    }
  }

  return errors;
}

/**
 * Load voices from the TTS provider API
 */
async function loadVoices(provider, selectedVoiceId = null) {
  const select = document.getElementById('voice-select');
  const loadingEl = document.getElementById('voice-loading');
  const errorEl = document.getElementById('voice-error');
  const libraryLink = document.getElementById('link-voice-library');

  if (!select) return;

  // Show loading state
  loadingEl.style.display = 'inline';
  errorEl.style.display = 'none';
  select.disabled = true;
  select.innerHTML = '<option value="">Loading voices...</option>';

  // Check cache first
  if (voicesCache[provider]) {
    populateVoiceSelect(voicesCache[provider], selectedVoiceId);
    return;
  }

  try {
    const data = await projects.getVoices(currentProjectId, provider);

    // Cache the results
    voicesCache[provider] = data.voices || [];
    currentVoiceLibraryUrl = data.library_url || '';

    // Update library link
    if (libraryLink && data.library_url) {
      libraryLink.href = data.library_url;
      libraryLink.style.display = 'inline';
    }

    populateVoiceSelect(data.voices || [], selectedVoiceId);
  } catch (error) {
    loadingEl.style.display = 'none';
    errorEl.style.display = 'inline';
    errorEl.textContent = error.message || 'Failed to load voices';
    select.disabled = false;
    select.innerHTML = '<option value="">Failed to load voices</option>';

    // Show manual entry fallback
    if (libraryLink) {
      libraryLink.style.display = 'inline';
    }
  }
}

/**
 * Populate the voice select dropdown
 */
function populateVoiceSelect(voices, selectedVoiceId = null) {
  const select = document.getElementById('voice-select');
  const loadingEl = document.getElementById('voice-loading');

  if (!select) return;

  loadingEl.style.display = 'none';
  select.disabled = false;

  // Build options
  let html = '<option value="">Select a voice...</option>';

  voices.forEach((voice) => {
    const selected = voice.id === selectedVoiceId ? 'selected' : '';
    const desc = voice.description ? ` - ${voice.description.substring(0, 50)}` : '';
    html += `<option value="${escapeHtml(voice.id)}" ${selected} data-preview="${escapeHtml(voice.preview_url || '')}">${escapeHtml(voice.name)}${desc}</option>`;
  });

  select.innerHTML = html;

  // Update preview button state
  updatePreviewButton();
}

/**
 * Update preview button enabled state
 */
function updatePreviewButton() {
  const select = document.getElementById('voice-select');
  const previewBtn = document.getElementById('btn-preview-voice');

  if (!select || !previewBtn) return;

  const selectedOption = select.options[select.selectedIndex];
  const hasPreview = selectedOption?.dataset?.preview;
  const hasVoice = select.value;

  // Enable if we have a voice selected (preview URL optional - some providers don't have previews)
  previewBtn.disabled = !hasVoice;
}

/**
 * Preview the selected voice
 */
function previewVoice() {
  const select = document.getElementById('voice-select');
  const audio = document.getElementById('voice-preview-audio');

  if (!select || !audio) return;

  const selectedOption = select.options[select.selectedIndex];
  const previewUrl = selectedOption?.dataset?.preview;

  if (previewUrl) {
    // Play preview URL if available
    audio.src = previewUrl;
    audio.play().catch((err) => {
      toast.error('Preview Failed', 'Could not play voice preview');
    });
  } else {
    toast.info('No Preview', 'This voice does not have a preview sample. Save the NPC and test in the playground.');
  }
}

/**
 * Render schedule blocks from definition
 */
function renderScheduleBlocks(schedule) {
  const container = document.getElementById('schedule-blocks');
  if (!container) return;

  if (!schedule || schedule.length === 0) {
    container.innerHTML = '<p class="empty-state-small">No schedule defined. Add time blocks to specify where this NPC will be.</p>';
    return;
  }

  container.innerHTML = schedule.map((block, index) => `
    <div class="schedule-block" data-index="${index}">
      <div class="schedule-block-header">
        <span class="schedule-time">${block.start_time || '00:00'} - ${block.end_time || '00:00'}</span>
        <button type="button" class="btn btn-sm btn-ghost btn-remove-schedule" data-index="${index}">×</button>
      </div>
      <div class="schedule-block-fields">
        <div class="form-row">
          <input type="time" class="input schedule-start" value="${block.start_time || '09:00'}" placeholder="Start">
          <span class="time-separator">to</span>
          <input type="time" class="input schedule-end" value="${block.end_time || '17:00'}" placeholder="End">
        </div>
        <input type="text" class="input schedule-location" value="${escapeHtml(block.location || '')}" placeholder="Location ID (e.g., tavern, market_square)">
        <input type="text" class="input schedule-activity" value="${escapeHtml(block.activity || '')}" placeholder="Activity (e.g., Working, Resting, Patrolling)">
      </div>
    </div>
  `).join('');

  // Bind schedule block events
  bindScheduleBlockEvents();
}

/**
 * Add a new schedule block
 */
function addScheduleBlock() {
  if (!currentDefinition.schedule) {
    currentDefinition.schedule = [];
  }

  currentDefinition.schedule.push({
    start_time: '09:00',
    end_time: '17:00',
    location: '',
    activity: '',
  });

  renderScheduleBlocks(currentDefinition.schedule);
}

/**
 * Bind events for schedule block inputs
 */
function bindScheduleBlockEvents() {
  // Remove buttons
  document.querySelectorAll('.btn-remove-schedule').forEach((btn) => {
    btn.addEventListener('click', () => {
      const index = parseInt(btn.dataset.index);
      currentDefinition.schedule.splice(index, 1);
      renderScheduleBlocks(currentDefinition.schedule);
    });
  });

  // Input changes
  document.querySelectorAll('.schedule-block').forEach((block) => {
    const index = parseInt(block.dataset.index);

    block.querySelector('.schedule-start')?.addEventListener('change', (e) => {
      currentDefinition.schedule[index].start_time = e.target.value;
      updateScheduleHeader(block);
    });

    block.querySelector('.schedule-end')?.addEventListener('change', (e) => {
      currentDefinition.schedule[index].end_time = e.target.value;
      updateScheduleHeader(block);
    });

    block.querySelector('.schedule-location')?.addEventListener('input', (e) => {
      currentDefinition.schedule[index].location = e.target.value;
    });

    block.querySelector('.schedule-activity')?.addEventListener('input', (e) => {
      currentDefinition.schedule[index].activity = e.target.value;
    });
  });
}

/**
 * Update schedule block header display
 */
function updateScheduleHeader(blockEl) {
  const start = blockEl.querySelector('.schedule-start')?.value || '00:00';
  const end = blockEl.querySelector('.schedule-end')?.value || '00:00';
  const header = blockEl.querySelector('.schedule-time');
  if (header) {
    header.textContent = `${start} - ${end}`;
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

export default { initNpcListPage, initNpcEditorPage };
