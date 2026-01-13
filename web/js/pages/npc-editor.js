/**
 * NPC List and Editor Page Handlers
 */

import { npcs, knowledge, projects, mcpTools } from '../api.js';
import { toast, modal, loading, renderTemplate, updateNav, createTagInput, describePersonality } from '../components.js';
import { router } from '../router.js';

let currentProjectId = null;
let currentNpcId = null;
let currentDefinition = null;
let principlesInput = null;
let traumaInput = null;
let voicesCache = { cartesia: null, elevenlabs: null };
let currentVoiceLibraryUrl = '';
let pendingProfileImage = null; // File to upload after NPC creation

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
    { href: `/projects/${projectId}/mcp-tools`, label: 'MCP Tools' },
    { href: `/projects/${projectId}/playground`, label: 'Playground' },
  ]);

  // Update breadcrumb
  document.getElementById('breadcrumb-project')?.setAttribute('href', `/projects/${projectId}`);
  
  // Fetch project name for breadcrumb
  try {
    const project = await projects.get(projectId);
    const projectBreadcrumb = document.getElementById('breadcrumb-project');
    if (projectBreadcrumb) {
      projectBreadcrumb.textContent = project.name || 'Project';
    }
  } catch (e) {
    console.warn('Could not fetch project name for breadcrumb:', e);
  }

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
          <div class="npc-card-avatar">${
            npc.profile_image && npc.profile_image.trim() !== ''
              ? `<img src="/api/projects/${projectId}/npcs/${npc.id}/avatar" alt="${escapeHtml(npc.name)}" onerror="this.parentElement.innerHTML='◇'">`
              : '◇'
          }</div>
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
    { href: `/projects/${projectId}/mcp-tools`, label: 'MCP Tools' },
    { href: `/projects/${projectId}/playground`, label: 'Playground' },
  ]);

  // Update breadcrumbs
  document.getElementById('breadcrumb-project')?.setAttribute('href', `/projects/${projectId}`);
  document.getElementById('breadcrumb-npcs')?.setAttribute('href', `/projects/${projectId}/npcs`);
  
  // Fetch project name for breadcrumb
  try {
    const project = await projects.get(projectId);
    const projectBreadcrumb = document.getElementById('breadcrumb-project');
    if (projectBreadcrumb) {
      projectBreadcrumb.textContent = project.name || 'Project';
    }
  } catch (e) {
    console.warn('Could not fetch project name for breadcrumb:', e);
  }

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

  // Load MCP tools
  await loadMcpToolsForNpc(projectId);

  // Load NPC network
  await loadNetworkTab(projectId);

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
    network: [],
    player_recognition: {
      can_know_player: true, // Always true, not user-configurable
      reveal_player_identity: true,
    },
    salience_threshold: 0.7, // Default: average memory (50% retention)
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

  // Player recognition
  const playerRecognition = definition.player_recognition || {
    can_know_player: true, // Always true
    reveal_player_identity: true,
  };
  document.getElementById('reveal-player-identity').checked = playerRecognition.reveal_player_identity;

  // Memory retention (convert salience_threshold to UI percentage)
  // salience_threshold: 0.35 (best memory) to 0.95 (worst memory)
  // UI retention: 100% (best) to 0% (worst)
  const threshold = definition.salience_threshold ?? 0.7;
  const retentionPercent = Math.round(((0.95 - threshold) / 0.6) * 100);
  const clampedRetention = Math.max(0, Math.min(100, retentionPercent));
  
  const memorySlider = document.getElementById('memory-retention');
  if (memorySlider) {
    memorySlider.value = clampedRetention;
    document.getElementById('val-memory-retention').textContent = `${clampedRetention}%`;
    updateMemoryHint(clampedRetention);
  }

  // Profile image
  if (definition.profile_image && currentNpcId) {
    const imageUrl = `/api/projects/${currentProjectId}/npcs/${currentNpcId}/avatar`;
    updateProfilePreview(imageUrl);
  } else {
    updateProfilePreview(null);
  }
  pendingProfileImage = null;
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

      // Toggle interactive preview for personality section
      toggleInteractivePreview(section === 'personality');
    });
  });
}

/**
 * Toggle between interactive and static preview modes
 */
function toggleInteractivePreview(interactive) {
  const interactivePanel = document.getElementById('preview-traits-interactive');
  const staticTraits = document.getElementById('preview-traits-static');
  const staticMood = document.getElementById('preview-mood-static');

  if (interactive) {
    if (interactivePanel) interactivePanel.style.display = 'block';
    if (staticTraits) staticTraits.style.display = 'none';
    if (staticMood) staticMood.style.display = 'none';
    syncPreviewSliders();
  } else {
    if (interactivePanel) interactivePanel.style.display = 'none';
    if (staticTraits) staticTraits.style.display = 'block';
    if (staticMood) staticMood.style.display = 'block';
  }
}

/**
 * Sync preview sliders with current definition values
 */
function syncPreviewSliders() {
  const traits = ['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'neuroticism'];
  
  traits.forEach(trait => {
    const slider = document.getElementById(`preview-${trait}`);
    const valEl = document.getElementById(`pval-${trait}`);
    const value = currentDefinition.personality_baseline?.[trait] ?? 0.5;
    
    if (slider) {
      slider.value = value;
    }
    if (valEl) {
      valEl.textContent = value.toFixed(1);
    }
  });
  
  // Sync mood dropdown
  const moodSelect = document.getElementById('preview-default-mood');
  if (moodSelect) {
    moodSelect.value = currentDefinition.default_mood || '';
  }
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

  // Profile picture upload
  document.getElementById('btn-upload-profile')?.addEventListener('click', () => {
    document.getElementById('npc-profile-input')?.click();
  });

  document.getElementById('npc-profile-input')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate size
    if (file.size > 1 * 1024 * 1024) {
      toast.error('File Too Large', 'Maximum file size is 1MB.');
      e.target.value = '';
      return;
    }

    // Validate type
    const allowedTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type)) {
      toast.error('Invalid File Type', 'Please use PNG, JPG, WebP, or GIF.');
      e.target.value = '';
      return;
    }

    // Show preview immediately
    const reader = new FileReader();
    reader.onload = (ev) => {
      updateProfilePreview(ev.target.result);
    };
    reader.readAsDataURL(file);

    // Upload if NPC already exists
    if (currentNpcId) {
      try {
        const formData = new FormData();
        formData.append('avatar', file);
        
        const response = await fetch(`/api/projects/${currentProjectId}/npcs/${currentNpcId}/avatar`, {
          method: 'POST',
          body: formData,
        });
        
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Upload failed');
        }
        
        const result = await response.json();
        currentDefinition.profile_image = result.filename;
        toast.success('Avatar Uploaded', 'Profile picture saved.');
      } catch (error) {
        toast.error('Upload Failed', error.message);
      }
    } else {
      // Store file for upload after NPC is created
      pendingProfileImage = file;
      toast.info('Avatar Ready', 'Will be saved when you save the NPC.');
    }
  });

  document.getElementById('btn-remove-profile')?.addEventListener('click', async () => {
    if (currentNpcId && currentDefinition.profile_image) {
      try {
        await fetch(`/api/projects/${currentProjectId}/npcs/${currentNpcId}/avatar`, {
          method: 'DELETE',
        });
        toast.success('Avatar Removed', 'Profile picture deleted.');
      } catch (error) {
        toast.error('Delete Failed', error.message);
      }
    }
    
    currentDefinition.profile_image = undefined;
    pendingProfileImage = null;
    updateProfilePreview(null);
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

  // Memory retention slider
  // UI shows 0-100 as "retention" (higher = better memory)
  // Internally stored as salience_threshold (lower = better memory)
  document.getElementById('memory-retention')?.addEventListener('input', (e) => {
    const retentionPercent = parseInt(e.target.value);
    // Convert retention (0-100) to salience_threshold (0.95-0.35)
    // 0% retention = 0.95 threshold (very forgetful)
    // 100% retention = 0.35 threshold (excellent memory)
    const threshold = 0.95 - (retentionPercent / 100) * 0.6;
    currentDefinition.salience_threshold = Math.round(threshold * 100) / 100;
    
    document.getElementById('val-memory-retention').textContent = `${retentionPercent}%`;
    updateMemoryHint(retentionPercent);
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
    
    // Sync preview mood dropdown
    const previewMood = document.getElementById('preview-default-mood');
    if (previewMood) previewMood.value = e.target.value;
    
    updateMoodPreview();
  });

  document.getElementById('btn-add-schedule')?.addEventListener('click', () => {
    addScheduleBlock();
  });

  // Player recognition
  document.getElementById('reveal-player-identity')?.addEventListener('change', (e) => {
    if (!currentDefinition.player_recognition) {
      currentDefinition.player_recognition = {
        can_know_player: true, // Always true
        reveal_player_identity: true,
      };
    }
    currentDefinition.player_recognition.reveal_player_identity = e.target.checked;
  });

  // Preview panel interactive sliders
  ['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'neuroticism'].forEach((trait) => {
    const previewSlider = document.getElementById(`preview-${trait}`);
    previewSlider?.addEventListener('input', (e) => {
      const value = parseFloat(e.target.value);
      currentDefinition.personality_baseline[trait] = value;
      
      // Update preview value display
      const pvalEl = document.getElementById(`pval-${trait}`);
      if (pvalEl) pvalEl.textContent = value.toFixed(1);
      
      // Sync main slider
      const mainSlider = document.getElementById(`trait-${trait}`);
      if (mainSlider) mainSlider.value = value;
      document.getElementById(`val-${trait}`).textContent = value.toFixed(2);
      
      // Reset preset to custom
      document.getElementById('personality-preset').value = '';
      updatePreview();
      updatePersonalitySummary();
    });
  });

  // Preview mood dropdown
  document.getElementById('preview-default-mood')?.addEventListener('change', (e) => {
    currentDefinition.default_mood = e.target.value;
    
    // Sync main mood dropdown
    const mainMood = document.getElementById('default-mood');
    if (mainMood) mainMood.value = e.target.value;
    
    updateMoodPreview();
  });

  // Initialize personality summary
  updatePersonalitySummary();
}

let availableKnowledgeCategories = {};

async function loadKnowledgeCategories(projectId) {
  const cardsContainer = document.getElementById('knowledge-cards');
  const emptyEl = document.getElementById('knowledge-empty');
  const addBtn = document.getElementById('btn-add-knowledge');
  const dropdown = document.getElementById('knowledge-add-dropdown');
  const categoryList = document.getElementById('knowledge-category-list');

  try {
    const kb = await knowledge.get(projectId);
    availableKnowledgeCategories = kb.categories || {};
    const allCategories = Object.entries(availableKnowledgeCategories);

    // Set up manage link
    document.getElementById('link-create-knowledge').href = `/projects/${projectId}/knowledge`;

    // Render the added knowledge cards
    renderKnowledgeCards();

    // Set up add button
    addBtn?.addEventListener('click', () => {
      renderKnowledgeDropdown();
      dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
    });

    // Close dropdown button
    document.getElementById('btn-close-knowledge-dropdown')?.addEventListener('click', () => {
      dropdown.style.display = 'none';
    });

  } catch (error) {
    console.error('Failed to load knowledge categories:', error);
    if (cardsContainer) cardsContainer.innerHTML = '<p class="error-hint">Failed to load knowledge categories</p>';
  }
}

function renderKnowledgeCards() {
  const cardsContainer = document.getElementById('knowledge-cards');
  const emptyEl = document.getElementById('knowledge-empty');
  
  if (!cardsContainer) return;

  const addedCategories = Object.entries(currentDefinition.knowledge_access || {});

  if (addedCategories.length === 0) {
    cardsContainer.innerHTML = '';
    if (emptyEl) emptyEl.style.display = 'block';
    return;
  }

  if (emptyEl) emptyEl.style.display = 'none';

  cardsContainer.innerHTML = addedCategories
    .map(([catId, depth]) => {
      const category = availableKnowledgeCategories[catId] || {};
      const maxDepth = Object.keys(category.depths || {}).length || 3;
      const isActive = depth > 0;
      
      return `
        <div class="knowledge-card ${isActive ? '' : 'inactive'}" data-cat-id="${catId}">
          <div class="knowledge-card-header">
            <span class="knowledge-card-name">${escapeHtml(catId)}</span>
            <button type="button" class="btn-icon-sm btn-delete-knowledge" data-cat-id="${catId}" title="Remove">
              &#128465;
            </button>
          </div>
          <div class="knowledge-card-body">
            <div class="depth-control">
              <label>Depth</label>
              <input type="range" class="depth-slider" data-cat-depth="${catId}" 
                min="0" max="${maxDepth}" step="1" value="${depth}">
              <span class="depth-value" id="depth-val-${catId}">${depth}</span>
            </div>
            <p class="knowledge-card-desc">${escapeHtml(category.description || 'No description')}</p>
          </div>
        </div>
      `;
    })
    .join('');

  // Bind delete handlers
  cardsContainer.querySelectorAll('.btn-delete-knowledge').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const catId = e.currentTarget.dataset.catId;
      delete currentDefinition.knowledge_access[catId];
      renderKnowledgeCards();
    });
  });

  // Bind depth slider handlers
  cardsContainer.querySelectorAll('.depth-slider').forEach((slider) => {
    slider.addEventListener('input', (e) => {
      const catId = e.target.dataset.catDepth;
      const value = parseInt(e.target.value);
      currentDefinition.knowledge_access[catId] = value;
      
      const valEl = document.getElementById(`depth-val-${catId}`);
      if (valEl) valEl.textContent = value;
      
      // Toggle inactive class
      const card = e.target.closest('.knowledge-card');
      if (card) {
        card.classList.toggle('inactive', value === 0);
      }
    });
  });
}

function renderKnowledgeDropdown() {
  const categoryList = document.getElementById('knowledge-category-list');
  if (!categoryList) return;

  const addedCategories = new Set(Object.keys(currentDefinition.knowledge_access || {}));
  const availableToAdd = Object.entries(availableKnowledgeCategories)
    .filter(([catId]) => !addedCategories.has(catId));

  if (availableToAdd.length === 0) {
    categoryList.innerHTML = '<p class="dropdown-empty">All categories already added</p>';
    return;
  }

  categoryList.innerHTML = availableToAdd
    .map(([catId, category]) => `
      <button type="button" class="dropdown-item" data-add-cat="${catId}">
        <span class="dropdown-item-name">${escapeHtml(catId)}</span>
        <span class="dropdown-item-desc">${escapeHtml(category.description || '')}</span>
      </button>
    `)
    .join('');

  // Bind add handlers
  categoryList.querySelectorAll('[data-add-cat]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const catId = e.currentTarget.dataset.addCat;
      if (!currentDefinition.knowledge_access) {
        currentDefinition.knowledge_access = {};
      }
      currentDefinition.knowledge_access[catId] = 1; // Default depth 1
      
      document.getElementById('knowledge-add-dropdown').style.display = 'none';
      renderKnowledgeCards();
    });
  });
}

// Built-in tools that are always available (security escape hatch)
const BUILTIN_TOOLS = [
  {
    id: 'exit_convo',
    name: 'Exit Conversation',
    description: 'End conversation immediately when player crosses serious boundaries. Ends the session.',
    builtin: true,
  },
];

let availableConvTools = [];
let availableGameTools = [];

/**
 * Load MCP tools from project and render in NPC editor
 */
async function loadMcpToolsForNpc(projectId) {
  const convPills = document.getElementById('conv-tool-pills');
  const gamePills = document.getElementById('game-tool-pills');

  try {
    const projectTools = await mcpTools.get(projectId);
    availableConvTools = [...BUILTIN_TOOLS, ...(projectTools.conversation_tools || [])];
    availableGameTools = projectTools.game_event_tools || [];

    // Set up manage link
    document.getElementById('link-manage-tools')?.addEventListener('click', (e) => {
      e.preventDefault();
      router.navigate(`/projects/${projectId}/mcp-tools`);
    });

    // Render pills
    renderToolPills();

    // Set up add buttons and dropdowns
    setupToolDropdown('conv', availableConvTools, 'conversation_tools');
    setupToolDropdown('game', availableGameTools, 'game_event_tools');

  } catch (error) {
    console.error('Failed to load MCP tools:', error);
    if (convPills) convPills.innerHTML = '<span class="empty-hint">Failed to load tools</span>';
  }
}

function setupToolDropdown(prefix, allTools, permissionKey) {
  const addBtn = document.getElementById(`btn-add-${prefix}-tool`);
  const dropdown = document.getElementById(`${prefix}-tool-dropdown`);
  const list = document.getElementById(`${prefix}-tool-list`);

  addBtn?.addEventListener('click', () => {
    renderToolDropdown(prefix, allTools, permissionKey);
    dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
  });

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (dropdown && !addBtn?.contains(e.target) && !dropdown?.contains(e.target)) {
      dropdown.style.display = 'none';
    }
  });
}

function renderToolPills() {
  const convPills = document.getElementById('conv-tool-pills');
  const gamePills = document.getElementById('game-tool-pills');

  if (!currentDefinition.mcp_permissions) {
    currentDefinition.mcp_permissions = { conversation_tools: [], game_event_tools: [], denied: [] };
  }

  const enabledConv = currentDefinition.mcp_permissions.conversation_tools || [];
  const enabledGame = currentDefinition.mcp_permissions.game_event_tools || [];

  // Render conversation tool pills
  if (convPills) {
    if (enabledConv.length === 0) {
      convPills.innerHTML = '<span class="tool-pills-empty">No tools assigned</span>';
    } else {
      convPills.innerHTML = enabledConv.map(toolId => {
        const tool = availableConvTools.find(t => t.id === toolId) || { id: toolId, name: toolId };
        const isBuiltin = tool.builtin;
        return `
          <div class="tool-pill ${isBuiltin ? 'builtin' : ''}" title="${escapeHtml(tool.description || '')}">
            <span class="tool-pill-name">${escapeHtml(tool.name)}</span>
            ${isBuiltin ? '<span class="tool-pill-badge">Built-in</span>' : ''}
            <button type="button" class="tool-pill-remove" data-remove-conv="${toolId}">&#10005;</button>
          </div>
        `;
      }).join('');

      // Bind remove handlers
      convPills.querySelectorAll('[data-remove-conv]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const toolId = e.currentTarget.dataset.removeConv;
          const arr = currentDefinition.mcp_permissions.conversation_tools;
          const idx = arr.indexOf(toolId);
          if (idx > -1) arr.splice(idx, 1);
          renderToolPills();
        });
      });
    }
  }

  // Render game tool pills
  if (gamePills) {
    if (enabledGame.length === 0) {
      gamePills.innerHTML = '<span class="tool-pills-empty">No tools assigned</span>';
    } else {
      gamePills.innerHTML = enabledGame.map(toolId => {
        const tool = availableGameTools.find(t => t.id === toolId) || { id: toolId, name: toolId };
        return `
          <div class="tool-pill" title="${escapeHtml(tool.description || '')}">
            <span class="tool-pill-name">${escapeHtml(tool.name)}</span>
            <button type="button" class="tool-pill-remove" data-remove-game="${toolId}">&#10005;</button>
          </div>
        `;
      }).join('');

      // Bind remove handlers
      gamePills.querySelectorAll('[data-remove-game]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const toolId = e.currentTarget.dataset.removeGame;
          const arr = currentDefinition.mcp_permissions.game_event_tools;
          const idx = arr.indexOf(toolId);
          if (idx > -1) arr.splice(idx, 1);
          renderToolPills();
        });
      });
    }
  }
}

function renderToolDropdown(prefix, allTools, permissionKey) {
  const list = document.getElementById(`${prefix}-tool-list`);
  if (!list) return;

  const enabledTools = currentDefinition.mcp_permissions?.[permissionKey] || [];
  const availableToAdd = allTools.filter(t => !enabledTools.includes(t.id));

  if (availableToAdd.length === 0) {
    list.innerHTML = '<p class="dropdown-empty">All tools already added</p>';
    return;
  }

  list.innerHTML = availableToAdd.map(tool => `
    <button type="button" class="dropdown-item" data-add-tool="${tool.id}" data-tool-type="${permissionKey}">
      <span class="dropdown-item-name">${escapeHtml(tool.name)}${tool.builtin ? ' <span class="badge badge-sm">Built-in</span>' : ''}</span>
      <span class="dropdown-item-desc">${escapeHtml(tool.description || '')}</span>
    </button>
  `).join('');

  // Bind add handlers
  list.querySelectorAll('[data-add-tool]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const toolId = e.currentTarget.dataset.addTool;
      const type = e.currentTarget.dataset.toolType;
      
      if (!currentDefinition.mcp_permissions[type]) {
        currentDefinition.mcp_permissions[type] = [];
      }
      if (!currentDefinition.mcp_permissions[type].includes(toolId)) {
        currentDefinition.mcp_permissions[type].push(toolId);
      }
      
      document.getElementById(`${prefix}-tool-dropdown`).style.display = 'none';
      renderToolPills();
    });
  });
}

let availableNetworkNpcs = [];

/**
 * Load other NPCs and render network selection
 */
async function loadNetworkTab(projectId) {
  const connectionsContainer = document.getElementById('network-connections');
  const emptyMsg = document.getElementById('network-empty');
  const addBtn = document.getElementById('btn-add-connection');
  const dropdown = document.getElementById('network-add-dropdown');

  try {
    const allNpcs = await npcs.list(projectId);
    
    // Filter out current NPC
    availableNetworkNpcs = (allNpcs.npcs || []).filter(npc => npc.id !== currentNpcId);

    // Render connection cards
    renderNetworkConnections();

    // Set up add button
    addBtn?.addEventListener('click', () => {
      renderNetworkDropdown();
      dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
    });

    // Close dropdown button
    document.getElementById('btn-close-network-dropdown')?.addEventListener('click', () => {
      dropdown.style.display = 'none';
    });

  } catch (error) {
    console.error('Failed to load NPCs for network:', error);
    if (connectionsContainer) connectionsContainer.innerHTML = '<p class="error-hint">Failed to load NPCs</p>';
  }
}

function renderNetworkConnections() {
  const container = document.getElementById('network-connections');
  const emptyMsg = document.getElementById('network-empty');
  
  if (!container) return;

  const connections = currentDefinition.network || [];

  if (connections.length === 0) {
    container.innerHTML = '';
    if (emptyMsg) emptyMsg.style.display = 'block';
    updateNetworkCount();
    return;
  }

  if (emptyMsg) emptyMsg.style.display = 'none';

  container.innerHTML = connections.map(conn => {
    const npc = availableNetworkNpcs.find(n => n.id === conn.npc_id) || { id: conn.npc_id, name: conn.npc_id };
    const tier = conn.familiarity_tier || 1;
    
    return `
      <div class="network-card" data-npc-id="${conn.npc_id}">
        <div class="network-card-header">
          <div class="network-card-info">
            <span class="network-card-name">${escapeHtml(npc.name)}</span>
            <span class="network-card-desc">${escapeHtml(npc.description || '')}</span>
          </div>
          <button type="button" class="btn-icon-sm btn-remove-connection" data-remove-npc="${conn.npc_id}" title="Remove">
            &#128465;
          </button>
        </div>
        <div class="network-card-body">
          <label>Familiarity</label>
          <select class="input select network-tier-select" data-tier-npc="${conn.npc_id}">
            <option value="1" ${tier === 1 ? 'selected' : ''}>1 - Acquaintance</option>
            <option value="2" ${tier === 2 ? 'selected' : ''}>2 - Familiar</option>
            <option value="3" ${tier === 3 ? 'selected' : ''}>3 - Close</option>
          </select>
        </div>
      </div>
    `;
  }).join('');

  updateNetworkCount();

  // Bind remove handlers
  container.querySelectorAll('.btn-remove-connection').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const npcId = e.currentTarget.dataset.removeNpc;
      const idx = currentDefinition.network.findIndex(n => n.npc_id === npcId);
      if (idx > -1) {
        currentDefinition.network.splice(idx, 1);
        renderNetworkConnections();
      }
    });
  });

  // Bind tier handlers
  container.querySelectorAll('.network-tier-select').forEach(select => {
    select.addEventListener('change', (e) => {
      const npcId = e.target.dataset.tierNpc;
      const tier = parseInt(e.target.value);
      const conn = currentDefinition.network.find(n => n.npc_id === npcId);
      if (conn) {
        conn.familiarity_tier = tier;
      }
    });
  });
}

function renderNetworkDropdown() {
  const list = document.getElementById('network-npc-list');
  if (!list) return;

  const addedNpcs = new Set((currentDefinition.network || []).map(n => n.npc_id));
  const availableToAdd = availableNetworkNpcs.filter(npc => !addedNpcs.has(npc.id));

  if (availableToAdd.length === 0) {
    list.innerHTML = '<p class="dropdown-empty">No other NPCs available to add</p>';
    return;
  }

  // Check limit
  if ((currentDefinition.network || []).length >= 5) {
    list.innerHTML = '<p class="dropdown-empty">Maximum 5 connections reached</p>';
    return;
  }

  list.innerHTML = availableToAdd.map(npc => `
    <button type="button" class="dropdown-item" data-add-npc="${npc.id}">
      <span class="dropdown-item-name">${escapeHtml(npc.name)}</span>
      <span class="dropdown-item-desc">${escapeHtml(npc.description || '')}</span>
    </button>
  `).join('');

  // Bind add handlers
  list.querySelectorAll('[data-add-npc]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const npcId = e.currentTarget.dataset.addNpc;
      
      if (!currentDefinition.network) {
        currentDefinition.network = [];
      }
      
      if (currentDefinition.network.length >= 5) {
        toast.warning('Limit Reached', 'NPCs can only know up to 5 other NPCs');
        return;
      }
      
      currentDefinition.network.push({ npc_id: npcId, familiarity_tier: 1 });
      
      document.getElementById('network-add-dropdown').style.display = 'none';
      renderNetworkConnections();
    });
  });
}

/**
 * Update the network count display
 */
function updateNetworkCount() {
  const count = currentDefinition.network?.length || 0;
  const countEl = document.getElementById('network-count');
  if (countEl) {
    countEl.textContent = `${count} / 5`;
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

/**
 * Update mood display in preview panel
 */
function updateMoodPreview() {
  const moodValue = currentDefinition.default_mood || 'neutral';
  const moodDisplay = document.getElementById('preview-mood');
  
  if (moodDisplay) {
    const moodLabels = {
      '': 'Neutral',
      'neutral': 'Neutral',
      'happy': 'Happy 😊',
      'sad': 'Sad 😢',
      'angry': 'Angry 😠',
      'fearful': 'Fearful 😨',
      'excited': 'Excited 🤩',
      'tired': 'Tired 😴',
      'content': 'Content 😌',
    };
    
    moodDisplay.innerHTML = `<span class="mood-valence">${moodLabels[moodValue] || 'Neutral'}</span>`;
  }
}

/**
 * Update profile picture preview
 */
function updateProfilePreview(imageSrc) {
  const preview = document.getElementById('profile-preview');
  const removeBtn = document.getElementById('btn-remove-profile');
  const previewAvatar = document.querySelector('.preview-avatar');
  
  if (imageSrc) {
    preview.innerHTML = `<img src="${imageSrc}" alt="Profile" class="profile-img">`;
    if (removeBtn) removeBtn.style.display = 'block';
    if (previewAvatar) previewAvatar.innerHTML = `<img src="${imageSrc}" alt="Avatar" class="avatar-img">`;
  } else {
    preview.innerHTML = '<span class="placeholder-icon">&#128100;</span>';
    if (removeBtn) removeBtn.style.display = 'none';
    if (previewAvatar) previewAvatar.innerHTML = '<span class="avatar-placeholder">&#9671;</span>';
  }
}

function updatePersonalitySummary() {
  const summary = document.getElementById('personality-summary');
  if (summary) {
    const description = describePersonality(currentDefinition.personality_baseline);
    summary.innerHTML = `<p>${description}</p>`;
  }
}

/**
 * Update the memory hint text based on retention percentage
 */
function updateMemoryHint(retentionPercent) {
  const hint = document.getElementById('memory-hint');
  if (!hint) return;
  
  let text;
  if (retentionPercent >= 80) {
    text = '🧠 Exceptional memory - remembers small details, longer conversation summaries';
  } else if (retentionPercent >= 60) {
    text = '🧠 Good memory - remembers important events well';
  } else if (retentionPercent >= 40) {
    text = '🧠 Average memory - remembers significant events';
  } else if (retentionPercent >= 20) {
    text = '🧠 Poor memory - only remembers major events';
  } else {
    text = '🧠 Very forgetful - struggles to recall past conversations';
  }
  
  hint.textContent = text;
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
  // Validate required fields
  const errors = [];

  if (!currentDefinition.name?.trim()) {
    errors.push('Name is required');
  }

  if (!currentDefinition.description?.trim()) {
    errors.push('Description is required');
  }

  if (!currentDefinition.core_anchor?.backstory?.trim()) {
    errors.push('Backstory is required (Core Anchor section)');
  }

  if (!currentDefinition.core_anchor?.principles?.length) {
    errors.push('At least one principle is required (Core Anchor section)');
  }

  if (!currentDefinition.voice?.voice_id) {
    errors.push('Voice selection is required (Voice section)');
  }

  if (errors.length > 0) {
    toast.warning('Missing Required Fields', errors.join('\n'));
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
      currentNpcId = created.id;
      
      // Upload pending profile image if any
      if (pendingProfileImage) {
        try {
          const formData = new FormData();
          formData.append('avatar', pendingProfileImage);
          await fetch(`/api/projects/${currentProjectId}/npcs/${currentNpcId}/avatar`, {
            method: 'POST',
            body: formData,
          });
        } catch (err) {
          console.warn('Failed to upload avatar:', err);
        }
        pendingProfileImage = null;
      }
      
      toast.success('NPC Created', `"${currentDefinition.name}" has been created.`);
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
