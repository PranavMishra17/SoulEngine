/**
 * Knowledge Base Editor Page Handler
 */

import { knowledge } from '../api.js';
import { toast, modal, loading, renderTemplate, updateNav, debounce } from '../components.js';
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

  // Bind event handlers
  document.getElementById('btn-add-category')?.addEventListener('click', handleAddCategory);
  document.getElementById('btn-empty-add-category')?.addEventListener('click', handleAddCategory);
  document.getElementById('btn-import-knowledge')?.addEventListener('click', handleImportKnowledge);
  document.getElementById('btn-export-knowledge')?.addEventListener('click', handleExportKnowledge);
  document.getElementById('btn-download-kb-template')?.addEventListener('click', handleDownloadTemplate);
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
    .map(
      ([catId, category]) => `
      <div class="knowledge-category" data-category="${catId}">
        <div class="category-header">
          <h3>
            <span class="category-icon">◈</span>
            ${escapeHtml(catId)}
          </h3>
          <div class="category-actions">
            <button class="btn btn-sm btn-ghost" data-action="edit" title="Edit category">✎</button>
            <button class="btn btn-sm btn-ghost" data-action="delete" title="Delete category">✕</button>
            <span class="category-toggle">▼</span>
          </div>
        </div>
        <div class="category-content">
          <div class="category-description">
            <p>${escapeHtml(category.description || 'No description')}</p>
          </div>
          <div class="depth-tiers">
            ${renderDepthTiers(catId, category.depths || {})}
          </div>
          <button class="btn btn-sm btn-outline" data-action="add-depth" style="margin-top: var(--space-3)">
            <span class="icon">+</span>
            Add Depth Level
          </button>
        </div>
      </div>
    `
    )
    .join('');

  // Bind category interactions
  container.querySelectorAll('.knowledge-category').forEach((categoryEl) => {
    const catId = categoryEl.dataset.category;

    // Toggle expand/collapse
    categoryEl.querySelector('.category-header')?.addEventListener('click', (e) => {
      if (e.target.closest('[data-action]')) return;
      categoryEl.classList.toggle('expanded');
    });

    // Edit category
    categoryEl.querySelector('[data-action="edit"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      handleEditCategory(catId);
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

    // Bind depth tier text changes
    categoryEl.querySelectorAll('.depth-content textarea').forEach((textarea) => {
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
      <div class="depth-tier" data-depth="${depth}">
        <div class="depth-level">${depth}</div>
        <div class="depth-content">
          <textarea class="input textarea" data-depth="${depth}" rows="3"
            placeholder="Knowledge content for depth ${depth}...">${escapeHtml(content)}</textarea>
        </div>
        <button class="btn btn-sm btn-ghost" data-action="delete-depth" data-depth="${depth}" title="Remove depth">✕</button>
      </div>
    `
    )
    .join('');
}

async function handleAddCategory() {
  const categoryId = await modal.prompt(
    'Add Knowledge Category',
    'Enter an ID for the category (e.g., "world_history", "local_gossip"):',
    ''
  );

  if (!categoryId) return;

  // Validate category ID
  if (!/^[a-z][a-z0-9_]*$/.test(categoryId)) {
    toast.warning('Invalid Category ID', 'Use lowercase letters, numbers, and underscores. Must start with a letter.');
    return;
  }

  // Check if already exists
  if (currentKnowledgeBase.categories?.[categoryId]) {
    toast.warning('Category Exists', `Category "${categoryId}" already exists.`);
    return;
  }

  // Add category
  currentKnowledgeBase.categories = currentKnowledgeBase.categories || {};
  currentKnowledgeBase.categories[categoryId] = {
    id: categoryId,
    description: '',
    depths: {
      0: '',
    },
  };

  await saveKnowledgeBase();
}

async function handleEditCategory(catId) {
  const category = currentKnowledgeBase.categories[catId];

  const description = await modal.prompt(
    'Edit Category Description',
    `Description for "${catId}":`,
    category.description || ''
  );

  if (description === null) return;

  category.description = description;
  await saveKnowledgeBase();
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
