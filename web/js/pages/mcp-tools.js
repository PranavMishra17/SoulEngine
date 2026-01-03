/**
 * MCP Tools Page Handler
 */

import { mcpTools } from '../api.js';
import { toast, modal, renderTemplate, updateNav } from '../components.js';
import { router } from '../router.js';

let currentProjectId = null;
let currentTools = {
  conversation_tools: [],
  game_event_tools: [],
};

/**
 * Initialize MCP Tools Page
 */
export async function initMcpToolsPage(params) {
  const { projectId } = params;
  currentProjectId = projectId;

  renderTemplate('template-mcp-tools');

  // Update navigation
  updateNav([
    { href: '/projects', label: 'Projects' },
    { href: `/projects/${projectId}`, label: 'Dashboard' },
    { href: `/projects/${projectId}/npcs`, label: 'NPCs' },
    { href: `/projects/${projectId}/knowledge`, label: 'Knowledge' },
    { href: `/projects/${projectId}/mcp-tools`, label: 'MCP Tools', active: true },
    { href: `/projects/${projectId}/playground`, label: 'Playground' },
  ]);

  // Update breadcrumb
  document.getElementById('breadcrumb-project')?.setAttribute('href', `/projects/${projectId}`);

  // Load tools
  await loadTools(projectId);

  // Bind event handlers
  document.getElementById('btn-add-conv-tool')?.addEventListener('click', () => {
    openToolModal('conversation');
  });

  document.getElementById('btn-add-game-tool')?.addEventListener('click', () => {
    openToolModal('game_event');
  });

  document.getElementById('btn-download-tools-template')?.addEventListener('click', handleDownloadTemplate);
  document.getElementById('btn-import-tools')?.addEventListener('click', handleImport);
  document.getElementById('btn-export-tools')?.addEventListener('click', handleExport);
}

/**
 * Load tools from API
 */
async function loadTools(projectId) {
  try {
    currentTools = await mcpTools.get(projectId);
    renderToolsList();
  } catch (error) {
    // If no tools exist yet, start with empty
    if (error.status === 404) {
      currentTools = { conversation_tools: [], game_event_tools: [] };
      renderToolsList();
    } else {
      toast.error('Failed to Load Tools', error.message);
    }
  }
}

/**
 * Render tools lists
 */
function renderToolsList() {
  renderToolsSection('conversation-tools', currentTools.conversation_tools || [], 'empty-conv-tools', 'conversation');
  renderToolsSection('game-event-tools', currentTools.game_event_tools || [], 'empty-game-tools', 'game_event');
}

/**
 * Render a single tools section
 */
function renderToolsSection(containerId, tools, emptyId, toolType) {
  const container = document.getElementById(containerId);
  const emptyEl = document.getElementById(emptyId);

  if (!container) return;

  if (tools.length === 0) {
    container.innerHTML = '';
    if (emptyEl) emptyEl.style.display = 'block';
    return;
  }

  if (emptyEl) emptyEl.style.display = 'none';

  container.innerHTML = tools.map((tool, index) => `
    <div class="tool-card" data-type="${toolType}" data-index="${index}">
      <div class="tool-card-header">
        <div class="tool-info">
          <h4 class="tool-name">${escapeHtml(tool.name)}</h4>
          <code class="tool-id">${escapeHtml(tool.id)}</code>
        </div>
        <div class="tool-actions">
          <button class="btn btn-sm btn-ghost btn-edit-tool" title="Edit">
            <span class="icon">✎</span>
          </button>
          <button class="btn btn-sm btn-ghost btn-delete-tool" title="Delete">
            <span class="icon">×</span>
          </button>
        </div>
      </div>
      <p class="tool-description">${escapeHtml(tool.description)}</p>
      ${tool.parameters ? `
        <div class="tool-params">
          <span class="params-label">Parameters:</span>
          <code>${formatParameters(tool.parameters)}</code>
        </div>
      ` : ''}
    </div>
  `).join('');

  // Bind edit/delete handlers
  container.querySelectorAll('.tool-card').forEach((card) => {
    const type = card.dataset.type;
    const index = parseInt(card.dataset.index);

    card.querySelector('.btn-edit-tool')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const toolsArray = type === 'conversation' ? currentTools.conversation_tools : currentTools.game_event_tools;
      openToolModal(type, toolsArray[index], index);
    });

    card.querySelector('.btn-delete-tool')?.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteTool(type, index);
    });
  });
}

/**
 * Format parameters for display
 */
function formatParameters(params) {
  if (!params || !params.properties) return 'none';
  const props = Object.keys(params.properties);
  const required = params.required || [];
  return props.map(p => required.includes(p) ? `${p}*` : p).join(', ');
}

/**
 * Open tool editor modal
 */
function openToolModal(toolType, existingTool = null, editIndex = null) {
  const isEdit = existingTool !== null;
  const title = isEdit ? 'Edit Tool' : 'Add Tool';

  const content = document.createElement('div');
  content.className = 'tool-modal-content';
  content.innerHTML = `
    <div class="form-group">
      <label for="tool-id">Tool ID</label>
      <input type="text" id="tool-id" class="input" placeholder="e.g., lock_door, give_item" value="${escapeHtml(existingTool?.id || '')}">
      <span class="input-hint">Unique identifier used in code (snake_case recommended)</span>
    </div>

    <div class="form-group">
      <label for="tool-name">Display Name</label>
      <input type="text" id="tool-name" class="input" placeholder="e.g., Lock Door" value="${escapeHtml(existingTool?.name || '')}">
    </div>

    <div class="form-group">
      <label for="tool-description">Description</label>
      <textarea id="tool-description" class="input textarea" rows="3" placeholder="What does this tool do? When should the NPC use it?">${escapeHtml(existingTool?.description || '')}</textarea>
      <span class="input-hint">This description helps the LLM decide when to use the tool</span>
    </div>

    <div class="form-group">
      <label>Parameters</label>
      <div id="params-container">
        ${renderParamsEditor(existingTool?.parameters)}
      </div>
      <button type="button" class="btn btn-sm btn-outline" id="btn-add-param">
        <span class="icon">+</span>
        Add Parameter
      </button>
    </div>
  `;

  const footer = document.createElement('div');
  footer.innerHTML = `
    <button class="btn btn-outline" data-action="cancel">Cancel</button>
    <button class="btn btn-primary" data-action="save">${isEdit ? 'Update' : 'Add'} Tool</button>
  `;

  const modalInstance = modal.open({
    title,
    content,
    footer,
    size: 'large',
  });

  // Bind param add button
  content.querySelector('#btn-add-param')?.addEventListener('click', () => {
    addParamRow(content.querySelector('#params-container'));
  });

  // Bind param delete buttons
  bindParamDeleteButtons(content);

  footer.querySelector('[data-action="cancel"]')?.addEventListener('click', () => {
    modalInstance.close();
  });

  footer.querySelector('[data-action="save"]')?.addEventListener('click', async () => {
    const tool = {
      id: content.querySelector('#tool-id').value.trim(),
      name: content.querySelector('#tool-name').value.trim(),
      description: content.querySelector('#tool-description').value.trim(),
      parameters: collectParameters(content),
    };

    // Validate
    if (!tool.id) {
      toast.warning('ID Required', 'Please enter a tool ID');
      return;
    }
    if (!tool.name) {
      toast.warning('Name Required', 'Please enter a tool name');
      return;
    }
    if (!tool.description) {
      toast.warning('Description Required', 'Please enter a tool description');
      return;
    }

    // Check for duplicate ID
    const allTools = [...currentTools.conversation_tools, ...currentTools.game_event_tools];
    const duplicate = allTools.find((t, i) => {
      // Allow same ID if we're editing the same tool
      if (isEdit) {
        const toolsArray = toolType === 'conversation' ? currentTools.conversation_tools : currentTools.game_event_tools;
        if (toolsArray[editIndex]?.id === tool.id) return false;
      }
      return t.id === tool.id;
    });

    if (duplicate) {
      toast.warning('Duplicate ID', 'A tool with this ID already exists');
      return;
    }

    // Save
    if (isEdit) {
      if (toolType === 'conversation') {
        currentTools.conversation_tools[editIndex] = tool;
      } else {
        currentTools.game_event_tools[editIndex] = tool;
      }
    } else {
      if (toolType === 'conversation') {
        currentTools.conversation_tools.push(tool);
      } else {
        currentTools.game_event_tools.push(tool);
      }
    }

    try {
      await mcpTools.update(currentProjectId, currentTools);
      toast.success('Tool Saved', `"${tool.name}" has been saved.`);
      modalInstance.close();
      renderToolsList();
    } catch (error) {
      toast.error('Failed to Save', error.message);
    }
  });
}

/**
 * Render parameters editor HTML
 */
function renderParamsEditor(parameters) {
  if (!parameters || !parameters.properties) {
    return '<p class="params-empty">No parameters defined</p>';
  }

  const props = parameters.properties;
  const required = parameters.required || [];

  return Object.entries(props).map(([name, prop]) => `
    <div class="param-row">
      <input type="text" class="input param-name" placeholder="Name" value="${escapeHtml(name)}">
      <select class="input select param-type">
        <option value="string" ${prop.type === 'string' ? 'selected' : ''}>String</option>
        <option value="number" ${prop.type === 'number' ? 'selected' : ''}>Number</option>
        <option value="boolean" ${prop.type === 'boolean' ? 'selected' : ''}>Boolean</option>
      </select>
      <input type="text" class="input param-desc" placeholder="Description" value="${escapeHtml(prop.description || '')}">
      <label class="checkbox-item param-required">
        <input type="checkbox" ${required.includes(name) ? 'checked' : ''}>
        <span>Required</span>
      </label>
      <button type="button" class="btn btn-sm btn-ghost btn-remove-param">×</button>
    </div>
  `).join('');
}

/**
 * Add a new parameter row
 */
function addParamRow(container) {
  const emptyMsg = container.querySelector('.params-empty');
  if (emptyMsg) emptyMsg.remove();

  const row = document.createElement('div');
  row.className = 'param-row';
  row.innerHTML = `
    <input type="text" class="input param-name" placeholder="Name">
    <select class="input select param-type">
      <option value="string">String</option>
      <option value="number">Number</option>
      <option value="boolean">Boolean</option>
    </select>
    <input type="text" class="input param-desc" placeholder="Description">
    <label class="checkbox-item param-required">
      <input type="checkbox">
      <span>Required</span>
    </label>
    <button type="button" class="btn btn-sm btn-ghost btn-remove-param">×</button>
  `;

  container.appendChild(row);
  bindParamDeleteButtons(container.closest('.tool-modal-content'));
}

/**
 * Bind delete buttons for param rows
 */
function bindParamDeleteButtons(container) {
  container.querySelectorAll('.btn-remove-param').forEach((btn) => {
    btn.onclick = () => {
      btn.closest('.param-row').remove();
      // Show empty message if no params left
      const paramsContainer = container.querySelector('#params-container');
      if (paramsContainer && !paramsContainer.querySelector('.param-row')) {
        paramsContainer.innerHTML = '<p class="params-empty">No parameters defined</p>';
      }
    };
  });
}

/**
 * Collect parameters from the form
 */
function collectParameters(container) {
  const rows = container.querySelectorAll('.param-row');
  if (rows.length === 0) return undefined;

  const properties = {};
  const required = [];

  rows.forEach((row) => {
    const name = row.querySelector('.param-name').value.trim();
    if (!name) return;

    const type = row.querySelector('.param-type').value;
    const description = row.querySelector('.param-desc').value.trim();
    const isRequired = row.querySelector('.param-required input').checked;

    properties[name] = { type };
    if (description) {
      properties[name].description = description;
    }

    if (isRequired) {
      required.push(name);
    }
  });

  if (Object.keys(properties).length === 0) return undefined;

  return {
    type: 'object',
    properties,
    required: required.length > 0 ? required : undefined,
  };
}

/**
 * Delete a tool
 */
async function deleteTool(toolType, index) {
  const toolsArray = toolType === 'conversation' ? currentTools.conversation_tools : currentTools.game_event_tools;
  const tool = toolsArray[index];

  if (!confirm(`Delete "${tool.name}"? This cannot be undone.`)) return;

  toolsArray.splice(index, 1);

  try {
    await mcpTools.update(currentProjectId, currentTools);
    toast.success('Tool Deleted', `"${tool.name}" has been removed.`);
    renderToolsList();
  } catch (error) {
    toast.error('Failed to Delete', error.message);
  }
}

/**
 * Download MCP tools template
 */
async function handleDownloadTemplate() {
  try {
    const response = await fetch('/data/templates/mcp-tools.json');
    if (!response.ok) throw new Error('Template not found');

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'mcp-tools-template.json';
    a.click();

    URL.revokeObjectURL(url);
    toast.success('Template Downloaded', 'MCP tools template saved to file.');
  } catch (error) {
    toast.error('Download Failed', error.message);
  }
}

/**
 * Import tools from JSON
 */
function handleImport() {
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
      if (!imported.conversation_tools || !imported.game_event_tools) {
        throw new Error('Invalid format - expected conversation_tools and game_event_tools arrays');
      }

      currentTools = imported;
      await mcpTools.update(currentProjectId, currentTools);
      renderToolsList();
      toast.success('Tools Imported', 'MCP tools have been imported.');
    } catch (error) {
      toast.error('Import Failed', error.message);
    }
  };

  input.click();
}

/**
 * Export tools to JSON
 */
function handleExport() {
  const json = JSON.stringify(currentTools, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = 'mcp-tools.json';
  a.click();

  URL.revokeObjectURL(url);
  toast.success('Tools Exported', 'MCP tools saved to file.');
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

export default { initMcpToolsPage };
