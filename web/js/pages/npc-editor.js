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
  document.getElementById('voice-provider').value = definition.voice?.provider || 'cartesia';
  document.getElementById('voice-id').value = definition.voice?.voice_id || '';
  document.getElementById('voice-speed').value = definition.voice?.speed || 1.0;
  document.getElementById('val-voice-speed').textContent = `${definition.voice?.speed || 1.0}x`;
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
      updatePreview();
      updatePersonalitySummary();
    });
  });

  // Voice
  document.getElementById('voice-provider')?.addEventListener('change', (e) => {
    currentDefinition.voice.provider = e.target.value;
  });

  document.getElementById('voice-id')?.addEventListener('input', (e) => {
    currentDefinition.voice.voice_id = e.target.value;
  });

  document.getElementById('voice-speed')?.addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    currentDefinition.voice.speed = value;
    document.getElementById('val-voice-speed').textContent = `${value.toFixed(1)}x`;
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

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

export default { initNpcListPage, initNpcEditorPage };
