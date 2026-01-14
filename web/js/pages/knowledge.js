/**
 * Knowledge Base Editor Page Handler
 */

import { knowledge } from '../api.js';
import { toast, modal, loading, renderTemplate, updateNav, debounce } from '../components.js';
import { openJsonEditor } from '../components/json-editor.js';
import { router } from '../router.js';

let currentProjectId = null;
let currentKnowledgeBase = null;

export async function initKnowledgePage(params) {
  const { projectId } = params;
  currentProjectId = projectId;

  renderTemplate('template-knowledge');

  // Update navigation
  updateNav([
    { href: '/projects', label: 'Projects' },
    { href: `/projects/${projectId}`, label: 'Dashboard' },
    { href: `/projects/${projectId}/npcs`, label: 'NPCs' },
    { href: `/projects/${projectId}/knowledge`, label: 'Knowledge', active: true },
    { href: `/projects/${projectId}/mcp-tools`, label: 'MCP Tools' },
    { href: `/projects/${projectId}/playground`, label: 'Playground' },
  ]);

  // Update breadcrumb
  document.getElementById('breadcrumb-project')?.setAttribute('href', `/projects/${projectId}`);

  // Load knowledge base
  await loadKnowledgeBase(projectId);

  // Bind inline form handlers
  bindInlineFormHandlers();

  // Bind event handlers
  document.getElementById('btn-import-knowledge')?.addEventListener('click', handleImportKnowledge);
  document.getElementById('btn-export-knowledge')?.addEventListener('click', handleExportKnowledge);
  document.getElementById('btn-download-kb-template')?.addEventListener('click', handleDownloadTemplate);
  document.getElementById('btn-edit-raw-json')?.addEventListener('click', handleEditRawJson);
}

/**
 * Bind inline form toggle and submission handlers
 */
function bindInlineFormHandlers() {
  const form = document.getElementById('inline-create-form');
  const toggle = document.getElementById('inline-form-toggle');
  const body = document.getElementById('inline-form-body');
  const cancelBtn = document.getElementById('btn-cancel-create');
  const confirmBtn = document.getElementById('btn-confirm-create');

  toggle?.addEventListener('click', () => {
    const isExpanded = !form.classList.contains('collapsed');
    if (isExpanded) {
      collapseInlineForm();
    } else {
      expandInlineForm();
    }
  });

  cancelBtn?.addEventListener('click', collapseInlineForm);
  confirmBtn?.addEventListener('click', handleCreateCategory);
}

function expandInlineForm() {
  const form = document.getElementById('inline-create-form');
  const body = document.getElementById('inline-form-body');
  form.classList.remove('collapsed');
  body.style.display = 'block';
}

function collapseInlineForm() {
  const form = document.getElementById('inline-create-form');
  const body = document.getElementById('inline-form-body');
  form.classList.add('collapsed');
  body.style.display = 'none';
  // Reset form
  document.getElementById('new-cat-id').value = '';
  document.getElementById('new-cat-desc').value = '';
  document.getElementById('new-cat-depth').value = '3';
}

async function handleCreateCategory() {
  const catId = document.getElementById('new-cat-id').value.trim();
  const description = document.getElementById('new-cat-desc').value.trim();
  const depthCount = parseInt(document.getElementById('new-cat-depth').value);

  // Validate category ID
  if (!catId) {
    toast.warning('ID Required', 'Please enter a category ID');
    return;
  }

  if (!/^[a-z][a-z0-9_]*$/.test(catId)) {
    toast.warning('Invalid Category ID', 'Use lowercase letters, numbers, and underscores. Must start with a letter.');
    return;
  }

  // Check if already exists
  if (currentKnowledgeBase.categories?.[catId]) {
    toast.warning('Category Exists', `Category "${catId}" already exists.`);
    return;
  }

  // Create depths object
  const depths = {};
  for (let i = 0; i < depthCount; i++) {
    depths[i] = '';
  }

  // Add category
  currentKnowledgeBase.categories = currentKnowledgeBase.categories || {};
  currentKnowledgeBase.categories[catId] = {
    id: catId,
    description,
    depths,
  };

  await saveKnowledgeBase();
  collapseInlineForm();
  
  // Scroll to the new category
  setTimeout(() => {
    const newCard = document.querySelector(`[data-category="${catId}"]`);
    if (newCard) {
      newCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
      newCard.classList.add('expanded');
    }
  }, 100);
}

async function loadKnowledgeBase(projectId) {
  const container = document.getElementById('knowledge-categories');
  const emptyState = document.getElementById('empty-knowledge');

  container.innerHTML = loading.skeleton(2);

  try {
    currentKnowledgeBase = await knowledge.get(projectId);
    const categories = Object.entries(currentKnowledgeBase.categories || {});

    if (categories.length === 0) {
      container.innerHTML = '';
      emptyState.style.display = 'block';
      return;
    }

    emptyState.style.display = 'none';
    renderCategories(categories);
  } catch (error) {
    toast.error('Failed to Load Knowledge Base', error.message);
    container.innerHTML = `<div class="empty-state"><p>Failed to load knowledge base</p></div>`;
  }
}

function renderCategories(categories) {
  const container = document.getElementById('knowledge-categories');

  container.innerHTML = categories
    .map(([catId, category]) => {
      const depths = category.depths || {};
      const depthCount = Object.keys(depths).length;
      const entryCount = Object.values(depths).filter(d => d && d.trim()).length;
      
      return `
        <div class="knowledge-category-card" data-category="${catId}">
          <div class="category-card-header">
            <div class="category-card-icon">◈</div>
            <div class="category-card-info">
              <div class="category-card-name">${escapeHtml(catId)}</div>
              <div class="category-card-meta">
                <span>${depthCount} depth${depthCount !== 1 ? 's' : ''}</span>
                <span>•</span>
                <span>${entryCount} with content</span>
              </div>
            </div>
            <div class="category-card-actions">
              <button class="btn btn-sm btn-ghost" data-action="delete" title="Delete category">✕</button>
            </div>
            <div class="category-card-expand">▼</div>
          </div>
          <div class="category-card-body">
            <div class="category-description">
              <label>Description</label>
              <textarea class="input textarea category-description-edit" data-desc-cat="${catId}" rows="2" 
                placeholder="What kind of knowledge does this category contain?">${escapeHtml(category.description || '')}</textarea>
            </div>
            <div class="depth-tier-list">
              ${renderDepthTiers(catId, depths)}
            </div>
            <button class="btn btn-sm btn-outline" data-action="add-depth" style="margin-top: var(--space-3)">
              <span class="icon">+</span>
              Add Depth Level
            </button>
          </div>
        </div>
      `;
    })
    .join('');

  // Bind category interactions
  container.querySelectorAll('.knowledge-category-card').forEach((categoryEl) => {
    const catId = categoryEl.dataset.category;

    // Toggle expand/collapse
    categoryEl.querySelector('.category-card-header')?.addEventListener('click', (e) => {
      if (e.target.closest('[data-action]')) return;
      categoryEl.classList.toggle('expanded');
    });

    // Delete category
    categoryEl.querySelector('[data-action="delete"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      handleDeleteCategory(catId);
    });

    // Add depth
    categoryEl.querySelector('[data-action="add-depth"]')?.addEventListener('click', () => {
      handleAddDepth(catId);
    });

    // Description change
    categoryEl.querySelector('.category-description-edit')?.addEventListener('input', debounce((e) => {
      const category = currentKnowledgeBase.categories[catId];
      if (category) {
        category.description = e.target.value;
        saveKnowledgeBase(false);
      }
    }, 500));

    // Bind depth tier text changes
    categoryEl.querySelectorAll('.depth-tier-content textarea').forEach((textarea) => {
      textarea.addEventListener('input', debounce((e) => {
        const depth = parseInt(e.target.dataset.depth);
        handleUpdateDepth(catId, depth, e.target.value);
      }, 500));
    });

    // Delete depth
    categoryEl.querySelectorAll('[data-action="delete-depth"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const depth = parseInt(btn.dataset.depth);
        handleDeleteDepth(catId, depth);
      });
    });
  });
}

function renderDepthTiers(catId, depths) {
  return Object.entries(depths)
    .sort(([a], [b]) => parseInt(a) - parseInt(b))
    .map(
      ([depth, content]) => `
      <div class="depth-tier-item" data-depth="${depth}">
        <div class="depth-tier-badge">${depth}</div>
        <div class="depth-tier-content">
          <textarea class="input textarea" data-depth="${depth}" rows="3"
            placeholder="Knowledge content for depth ${depth}...">${escapeHtml(content)}</textarea>
        </div>
        <div class="depth-tier-actions">
          <button class="btn btn-sm btn-ghost" data-action="delete-depth" data-depth="${depth}" title="Remove depth">✕</button>
        </div>
      </div>
    `
    )
    .join('');
}

async function handleDeleteCategory(catId) {
  const confirmed = await modal.confirm(
    'Delete Category',
    `Are you sure you want to delete "${catId}"? All knowledge in this category will be lost.`
  );

  if (!confirmed) return;

  delete currentKnowledgeBase.categories[catId];
  await saveKnowledgeBase();
}

async function handleAddDepth(catId) {
  const category = currentKnowledgeBase.categories[catId];
  const existingDepths = Object.keys(category.depths || {}).map(Number);
  const nextDepth = existingDepths.length > 0 ? Math.max(...existingDepths) + 1 : 0;

  if (nextDepth >= 5) {
    toast.warning('Max Depths Reached', 'Categories can have at most 5 depth levels (0-4).');
    return;
  }

  category.depths = category.depths || {};
  category.depths[nextDepth] = '';

  await saveKnowledgeBase();
}

async function handleUpdateDepth(catId, depth, content) {
  const category = currentKnowledgeBase.categories[catId];
  if (category && category.depths) {
    category.depths[depth] = content;
    await saveKnowledgeBase(false); // Silent save
  }
}

async function handleDeleteDepth(catId, depth) {
  const category = currentKnowledgeBase.categories[catId];
  const depthCount = Object.keys(category.depths || {}).length;

  if (depthCount <= 1) {
    toast.warning('Cannot Delete', 'Categories must have at least one depth level.');
    return;
  }

  const confirmed = await modal.confirm(
    'Delete Depth Level',
    `Are you sure you want to delete depth ${depth}? This knowledge will be lost.`
  );

  if (!confirmed) return;

  delete category.depths[depth];
  await saveKnowledgeBase();
}

async function saveKnowledgeBase(showToast = true) {
  try {
    await knowledge.update(currentProjectId, currentKnowledgeBase);
    if (showToast) {
      toast.success('Knowledge Base Saved', 'Changes have been saved.');
    }
    // Re-render to update UI
    const categories = Object.entries(currentKnowledgeBase.categories || {});
    const emptyState = document.getElementById('empty-knowledge');

    if (categories.length === 0) {
      document.getElementById('knowledge-categories').innerHTML = '';
      emptyState.style.display = 'block';
    } else {
      emptyState.style.display = 'none';
      renderCategories(categories);
    }
  } catch (error) {
    toast.error('Failed to Save', error.message);
  }
}

/**
 * Open raw JSON editor for the knowledge base
 */
function handleEditRawJson() {
  openJsonEditor('Edit Knowledge Base JSON', currentKnowledgeBase, {
    readOnly: false,
    onSave: async (parsedJson) => {
      // Validate and update
      const errors = validateKnowledgeBase(parsedJson);
      if (errors.length > 0) {
        toast.error('Validation Failed', errors.join('; '));
        return;
      }
      
      // Ensure each category has an id field
      const processedCategories = {};
      for (const [catId, category] of Object.entries(parsedJson.categories || {})) {
        processedCategories[catId] = {
          ...category,
          id: catId,
        };
      }
      
      currentKnowledgeBase = {
        ...parsedJson,
        categories: processedCategories,
      };
      
      await saveKnowledgeBase();
      toast.success('JSON Applied', 'Knowledge base updated from JSON.');
    },
    validate: validateKnowledgeBase,
  });
}

/**
 * Import knowledge base from JSON file
 */
function handleImportKnowledge() {
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
      const errors = validateKnowledgeBase(imported);
      if (errors.length > 0) {
        toast.error('Invalid Knowledge Base', errors.join(', '));
        return;
      }

      // Confirm if replacing existing data
      if (Object.keys(currentKnowledgeBase.categories || {}).length > 0) {
        const confirmed = await modal.confirm(
          'Replace Knowledge Base',
          'This will replace all existing categories. Continue?'
        );
        if (!confirmed) return;
      }

      // Merge imported data, ensuring each category has an id field
      const processedCategories = {};
      for (const [catId, category] of Object.entries(imported.categories || {})) {
        processedCategories[catId] = {
          ...category,
          id: catId, // Ensure id matches the key
        };
      }
      currentKnowledgeBase = {
        ...currentKnowledgeBase,
        categories: processedCategories,
      };

      await saveKnowledgeBase();
      toast.success('Knowledge Imported', `Loaded ${Object.keys(imported.categories || {}).length} categories.`);
    } catch (error) {
      toast.error('Import Failed', 'Invalid JSON file: ' + error.message);
    }
  };

  input.click();
}

/**
 * Export knowledge base to JSON file
 */
function handleExportKnowledge() {
  const categories = currentKnowledgeBase.categories || {};
  if (Object.keys(categories).length === 0) {
    toast.warning('No Data', 'Add categories before exporting.');
    return;
  }

  const exportData = { categories };
  const json = JSON.stringify(exportData, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `knowledge-base-${currentProjectId}.json`;
  a.click();

  URL.revokeObjectURL(url);
  toast.success('Knowledge Exported', `Saved ${Object.keys(categories).length} categories to file.`);
}

/**
 * Download knowledge base template JSON
 */
async function handleDownloadTemplate() {
  try {
    const response = await fetch('/data/templates/knowledge-base.json');
    if (!response.ok) throw new Error('Template not found');

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'knowledge-template.json';
    a.click();

    URL.revokeObjectURL(url);
    toast.success('Template Downloaded', 'Knowledge template saved to file.');
  } catch (error) {
    toast.error('Download Failed', error.message);
  }
}

/**
 * Validate knowledge base structure
 */
function validateKnowledgeBase(data) {
  const errors = [];

  if (!data || typeof data !== 'object') {
    errors.push('Invalid JSON structure');
    return errors;
  }

  if (!data.categories || typeof data.categories !== 'object') {
    errors.push('Missing or invalid "categories" object');
    return errors;
  }

  for (const [catId, category] of Object.entries(data.categories)) {
    // Validate category ID format
    if (!/^[a-z][a-z0-9_]*$/.test(catId)) {
      errors.push(`Invalid category ID "${catId}" - use lowercase, numbers, underscores`);
    }

    if (typeof category !== 'object') {
      errors.push(`Category "${catId}" must be an object`);
      continue;
    }

    if (category.depths) {
      if (typeof category.depths !== 'object') {
        errors.push(`Category "${catId}" depths must be an object`);
      } else {
        for (const [depth, content] of Object.entries(category.depths)) {
          const depthNum = parseInt(depth);
          if (isNaN(depthNum) || depthNum < 0 || depthNum > 4) {
            errors.push(`Category "${catId}" has invalid depth ${depth} (must be 0-4)`);
          }
          if (typeof content !== 'string') {
            errors.push(`Category "${catId}" depth ${depth} content must be a string`);
          }
        }
      }
    }
  }

  return errors;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

export default { initKnowledgePage };
