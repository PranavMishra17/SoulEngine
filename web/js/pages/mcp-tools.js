/**
 * MCP Tools Page Handler
 */

import { mcpTools } from '../api.js';
import { toast, modal, renderTemplate, updateNav } from '../components.js';
import { openJsonEditor } from '../components/json-editor.js';
import { router } from '../router.js';

let currentProjectId = null;
let currentTools = {
  conversation_tools: [],
  game_event_tools: [],
};

// System tools - always available, disabled by default
const SYSTEM_TOOLS = {
  conversation: [
    {
      id: 'exit_conversation',
      name: 'Exit Conversation',
      description: 'End conversation immediately when player crosses serious boundaries. Ends the session.',
      system: true,
      enabled: false,
    },
    {
      id: 'refuse_service',
      name: 'Refuse Service',
      description: 'Politely decline to help or continue interaction with the player.',
      system: true,
      enabled: false,
    },
  ],
  game_event: [
    {
      id: 'call_security',
      name: 'Call Security/Police',
      description: 'Alert security or authorities about threatening player behavior.',
      system: true,
      enabled: false,
    },
    {
      id: 'give_item',
      name: 'Give Item to Player',
      description: 'Transfer an item from NPC inventory to the player.',
      system: true,
      enabled: false,
      parameters: {
        type: 'object',
        properties: {
          item_id: { type: 'string', description: 'ID of the item to give' },
          quantity: { type: 'number', description: 'Number of items to give' },
        },
        required: ['item_id'],
      },
    },
  ],
};

// Track which system tools are enabled for this project
let enabledSystemTools = {
  conversation: new Set(),
  game_event: new Set(),
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

  // Bind inline form handlers
  bindInlineFormHandlers();

  // Bind event handlers
  document.getElementById('btn-download-tools-template')?.addEventListener('click', handleDownloadTemplate);
  document.getElementById('btn-import-tools')?.addEventListener('click', handleImport);
  document.getElementById('btn-export-tools')?.addEventListener('click', handleExport);
  document.getElementById('btn-edit-tools-json')?.addEventListener('click', handleEditRawJson);
}

/**
 * Bind inline form toggle and submission handlers
 */
function bindInlineFormHandlers() {
  const form = document.getElementById('inline-tool-form');
  const toggle = document.getElementById('inline-tool-toggle');
  const body = document.getElementById('inline-tool-body');
  const cancelBtn = document.getElementById('btn-cancel-tool');
  const confirmBtn = document.getElementById('btn-confirm-tool');

  toggle?.addEventListener('click', () => {
    const isExpanded = !form.classList.contains('collapsed');
    if (isExpanded) {
      collapseInlineForm();
    } else {
      expandInlineForm();
    }
  });

  cancelBtn?.addEventListener('click', collapseInlineForm);
  confirmBtn?.addEventListener('click', handleCreateTool);
}

function expandInlineForm() {
  const form = document.getElementById('inline-tool-form');
  const body = document.getElementById('inline-tool-body');
  form.classList.remove('collapsed');
  body.style.display = 'block';
}

function collapseInlineForm() {
  const form = document.getElementById('inline-tool-form');
  const body = document.getElementById('inline-tool-body');
  form.classList.add('collapsed');
  body.style.display = 'none';
  // Reset form
  document.getElementById('new-tool-id').value = '';
  document.getElementById('new-tool-name').value = '';
  document.getElementById('new-tool-desc').value = '';
  document.getElementById('new-tool-type').value = 'conversation';
}

async function handleCreateTool() {
  const toolId = document.getElementById('new-tool-id').value.trim();
  const toolName = document.getElementById('new-tool-name').value.trim();
  const toolDesc = document.getElementById('new-tool-desc').value.trim();
  const toolType = document.getElementById('new-tool-type').value;

  // Validate
  if (!toolId) {
    toast.warning('ID Required', 'Please enter a tool ID');
    return;
  }
  if (!toolName) {
    toast.warning('Name Required', 'Please enter a tool name');
    return;
  }
  if (!toolDesc) {
    toast.warning('Description Required', 'Please enter a tool description');
    return;
  }

  // Check for duplicate ID
  const allTools = [...currentTools.conversation_tools, ...currentTools.game_event_tools];
  const duplicate = allTools.find(t => t.id === toolId);
  if (duplicate) {
    toast.warning('Duplicate ID', 'A tool with this ID already exists');
    return;
  }

  // Also check system tools
  const systemDuplicate = [...SYSTEM_TOOLS.conversation, ...SYSTEM_TOOLS.game_event].find(t => t.id === toolId);
  if (systemDuplicate) {
    toast.warning('Reserved ID', 'This ID is reserved for a system tool');
    return;
  }

  const newTool = {
    id: toolId,
    name: toolName,
    description: toolDesc,
  };

  if (toolType === 'conversation') {
    currentTools.conversation_tools.push(newTool);
  } else {
    currentTools.game_event_tools.push(newTool);
  }

  try {
    await mcpTools.update(currentProjectId, currentTools);
    toast.success('Tool Created', `"${toolName}" has been added.`);
    collapseInlineForm();
    renderToolsList();
  } catch (error) {
    toast.error('Failed to Save', error.message);
  }
}

/**
 * Load tools from API
 */
async function loadTools(projectId) {
  try {
    const data = await mcpTools.get(projectId);
    currentTools = {
      conversation_tools: data.conversation_tools || [],
      game_event_tools: data.game_event_tools || [],
    };
    
    // Check which system tools are enabled (stored in the tools list)
    loadSystemToolStates();
    
    renderToolsList();
    renderSystemTools();
  } catch (error) {
    // If no tools exist yet, start with empty
    if (error.status === 404) {
      currentTools = { conversation_tools: [], game_event_tools: [] };
      renderToolsList();
      renderSystemTools();
    } else {
      toast.error('Failed to Load Tools', error.message);
    }
  }
}

/**
 * Load system tool enabled states from current tools
 */
function loadSystemToolStates() {
  enabledSystemTools = {
    conversation: new Set(),
    game_event: new Set(),
  };
  
  // Check which system tools are in the current tools list
  for (const tool of currentTools.conversation_tools) {
    const systemTool = SYSTEM_TOOLS.conversation.find(st => st.id === tool.id);
    if (systemTool) {
      enabledSystemTools.conversation.add(tool.id);
    }
  }
  
  for (const tool of currentTools.game_event_tools) {
    const systemTool = SYSTEM_TOOLS.game_event.find(st => st.id === tool.id);
    if (systemTool) {
      enabledSystemTools.game_event.add(tool.id);
    }
  }
}

/**
 * Render system tools with toggles
 */
function renderSystemTools() {
  renderSystemToolsSection('system-conv-tools-list', SYSTEM_TOOLS.conversation, 'conversation');
  renderSystemToolsSection('system-game-tools-list', SYSTEM_TOOLS.game_event, 'game_event');
}

function renderSystemToolsSection(containerId, systemTools, toolType) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = systemTools.map(tool => {
    const isEnabled = enabledSystemTools[toolType].has(tool.id);
    return `
      <div class="system-tool-item">
        <div class="system-tool-info">
          <span class="system-tool-name">${escapeHtml(tool.name)}</span>
          <span class="system-tool-desc">${escapeHtml(tool.description)}</span>
        </div>
        <span class="system-tool-badge system">System</span>
        <label class="toggle-switch">
          <input type="checkbox" data-system-tool="${tool.id}" data-tool-type="${toolType}" ${isEnabled ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
      </div>
    `;
  }).join('');

  // Bind toggle handlers
  container.querySelectorAll('input[data-system-tool]').forEach(input => {
    input.addEventListener('change', async (e) => {
      const toolId = e.target.dataset.systemTool;
      const type = e.target.dataset.toolType;
      const enabled = e.target.checked;
      
      await toggleSystemTool(toolId, type, enabled);
    });
  });
}

/**
 * Toggle a system tool on/off
 */
async function toggleSystemTool(toolId, toolType, enabled) {
  const systemTool = (toolType === 'conversation' ? SYSTEM_TOOLS.conversation : SYSTEM_TOOLS.game_event)
    .find(t => t.id === toolId);
  
  if (!systemTool) return;
  
  const toolsArray = toolType === 'conversation' ? currentTools.conversation_tools : currentTools.game_event_tools;
  
  if (enabled) {
    // Add to tools list
    if (!toolsArray.find(t => t.id === toolId)) {
      toolsArray.push({
        id: systemTool.id,
        name: systemTool.name,
        description: systemTool.description,
        parameters: systemTool.parameters,
        system: true,
      });
      enabledSystemTools[toolType].add(toolId);
    }
  } else {
    // Remove from tools list
    const index = toolsArray.findIndex(t => t.id === toolId);
    if (index > -1) {
      toolsArray.splice(index, 1);
      enabledSystemTools[toolType].delete(toolId);
    }
  }
  
  try {
    await mcpTools.update(currentProjectId, currentTools);
    toast.success(enabled ? 'Tool Enabled' : 'Tool Disabled', `"${systemTool.name}" ${enabled ? 'enabled' : 'disabled'}.`);
    renderToolsList();
  } catch (error) {
    toast.error('Failed to Save', error.message);
  }
}

/**
 * Render tools lists
 */
function renderToolsList() {
  // Filter out system tools from custom tools list
  const customConvTools = currentTools.conversation_tools.filter(t => !t.system);
  const customGameTools = currentTools.game_event_tools.filter(t => !t.system);
  
  renderToolsSection('conversation-tools', customConvTools, 'empty-conv-tools', 'conversation');
  renderToolsSection('game-event-tools', customGameTools, 'empty-game-tools', 'game_event');
  
  // Update counts
  document.getElementById('conv-tools-count').textContent = 
    `${currentTools.conversation_tools.length} tool${currentTools.conversation_tools.length !== 1 ? 's' : ''}`;
  document.getElementById('game-tools-count').textContent = 
    `${currentTools.game_event_tools.length} tool${currentTools.game_event_tools.length !== 1 ? 's' : ''}`;
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
    <div class="tool-card" data-type="${toolType}" data-id="${tool.id}">
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
    const toolId = card.dataset.id;

    card.querySelector('.btn-edit-tool')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const toolsArray = type === 'conversation' ? currentTools.conversation_tools : currentTools.game_event_tools;
      const tool = toolsArray.find(t => t.id === toolId);
      const index = toolsArray.findIndex(t => t.id === toolId);
      if (tool) openToolModal(type, tool, index);
    });

    card.querySelector('.btn-delete-tool')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const toolsArray = type === 'conversation' ? currentTools.conversation_tools : currentTools.game_event_tools;
      const index = toolsArray.findIndex(t => t.id === toolId);
      if (index > -1) deleteTool(type, index);
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
      <input type="text" id="tool-id" class="input" placeholder="e.g., lock_door, give_item" value="${escapeHtml(existingTool?.id || '')}" ${isEdit ? 'readonly' : ''}>
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

    // Check for duplicate ID (only if not editing)
    if (!isEdit) {
      const allTools = [...currentTools.conversation_tools, ...currentTools.game_event_tools];
      const duplicate = allTools.find(t => t.id === tool.id);
      if (duplicate) {
        toast.warning('Duplicate ID', 'A tool with this ID already exists');
        return;
      }
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

  const confirmed = await modal.confirm('Delete Tool', `Delete "${tool.name}"? This cannot be undone.`);
  if (!confirmed) return;

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
 * Open raw JSON editor for MCP tools
 */
function handleEditRawJson() {
  openJsonEditor('Edit MCP Tools JSON', currentTools, {
    readOnly: false,
    onSave: async (parsedJson) => {
      // Validate structure
      if (!parsedJson.conversation_tools || !Array.isArray(parsedJson.conversation_tools)) {
        toast.error('Invalid Format', 'Missing conversation_tools array');
        return;
      }
      if (!parsedJson.game_event_tools || !Array.isArray(parsedJson.game_event_tools)) {
        toast.error('Invalid Format', 'Missing game_event_tools array');
        return;
      }
      
      currentTools = parsedJson;
      loadSystemToolStates();
      
      try {
        await mcpTools.update(currentProjectId, currentTools);
        toast.success('JSON Applied', 'MCP tools updated from JSON.');
        renderToolsList();
        renderSystemTools();
      } catch (error) {
        toast.error('Failed to Save', error.message);
      }
    },
    validate: (data) => {
      const errors = [];
      if (!data.conversation_tools || !Array.isArray(data.conversation_tools)) {
        errors.push('Missing conversation_tools array');
      }
      if (!data.game_event_tools || !Array.isArray(data.game_event_tools)) {
        errors.push('Missing game_event_tools array');
      }
      return errors;
    },
  });
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
      loadSystemToolStates();
      
      await mcpTools.update(currentProjectId, currentTools);
      renderToolsList();
      renderSystemTools();
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
