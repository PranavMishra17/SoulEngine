/**
 * Project Settings Page Handler
 */

import { projects } from '../api.js';
import { toast, modal, renderTemplate, updateNav } from '../components.js';
import { router } from '../router.js';

let currentProject = null;
let currentProjectId = null;

// LLM models by provider (Feb 2026 — keep in sync with src/providers/llm/factory.ts)
const LLM_MODELS = {
  gemini: [
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash (Fast)' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro (Smart)' },
    { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash Preview (Latest)' },
  ],
  openai: [
    { id: 'gpt-4o', name: 'GPT-4o (Recommended)' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini (Fast)' },
    { id: 'gpt-4.1', name: 'GPT-4.1 (Latest)' },
    { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini (Economy)' },
  ],
  anthropic: [
    { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6 (Recommended)' },
    { id: 'claude-opus-4-6', name: 'Claude Opus 4.6 (Most Capable)' },
    { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5 (Fast)' },
  ],
  grok: [
    { id: 'grok-3', name: 'Grok 3 (Recommended)' },
    { id: 'grok-4', name: 'Grok 4 (Most Capable)' },
    { id: 'grok-3-mini', name: 'Grok 3 Mini (Economy)' },
  ],
};

export async function initSettingsPage(params) {
  const { projectId } = params;
  currentProjectId = projectId;

  renderTemplate('template-settings');

  // Update navigation
  updateNav([
    { href: '/projects', label: 'Projects' },
    { href: `/projects/${projectId}`, label: 'Dashboard' },
    { href: `/projects/${projectId}/npcs`, label: 'NPCs' },
    { href: `/projects/${projectId}/knowledge`, label: 'Knowledge' },
    { href: `/projects/${projectId}/mcp-tools`, label: 'MCP Tools' },
    { href: `/projects/${projectId}/playground`, label: 'Playground' },
    { href: `/projects/${projectId}/settings`, label: 'Settings', active: true },
  ]);

  // Load project data
  await loadSettings(projectId);

  // Bind event handlers
  bindEventHandlers(projectId);
}

async function loadSettings(projectId) {
  try {
    // Load project info
    currentProject = await projects.get(projectId);

    // Update breadcrumb
    const breadcrumbProject = document.getElementById('breadcrumb-project');
    if (breadcrumbProject) {
      breadcrumbProject.textContent = currentProject.name;
      breadcrumbProject.href = `/projects/${projectId}`;
    }

    // Populate project info
    document.getElementById('settings-project-name').value = currentProject.name || '';
    document.getElementById('settings-project-id').value = projectId;

    // Set provider selections
    const settings = currentProject.settings || {};
    document.getElementById('settings-llm-provider').value = settings.llm_provider || 'gemini';
    document.getElementById('settings-tts-provider').value = settings.tts_provider || 'cartesia';
    document.getElementById('settings-stt-provider').value = settings.stt_provider || 'deepgram';

    // Update model dropdown based on LLM provider
    updateModelOptions(settings.llm_provider || 'gemini', settings.llm_model);

    // Fetch and display API key status
    await loadKeyStatus(projectId);

  } catch (error) {
    toast.error('Failed to Load Settings', error.message);
    router.navigate('/projects');
  }
}

async function loadKeyStatus(projectId) {
  try {
    const keyStatus = await projects.getKeyStatus(projectId);
    
    // Update all key status indicators
    const keys = ['gemini', 'openai', 'anthropic', 'grok', 'deepgram', 'cartesia', 'elevenlabs'];
    keys.forEach(key => {
      const statusEl = document.getElementById(`status-${key}`);
      if (statusEl) {
        if (keyStatus[key]) {
          statusEl.textContent = '✓ Configured';
          statusEl.className = 'key-status configured';
        } else {
          statusEl.textContent = 'Not set';
          statusEl.className = 'key-status not-configured';
        }
      }
      
      // Update placeholder
      const inputEl = document.getElementById(`settings-key-${key}`);
      if (inputEl) {
        inputEl.placeholder = keyStatus[key] ? '•••••••••••••••• (configured)' : 'Enter API key...';
      }
    });
  } catch (error) {
    console.warn('Failed to fetch key status:', error);
  }
}

function updateModelOptions(provider, selectedModel) {
  const modelSelect = document.getElementById('settings-llm-model');
  const models = LLM_MODELS[provider] || [];
  
  modelSelect.innerHTML = models.map(m => 
    `<option value="${m.id}" ${m.id === selectedModel ? 'selected' : ''}>${m.name}</option>`
  ).join('');
}

function bindEventHandlers(projectId) {
  // LLM provider change -> update model options
  document.getElementById('settings-llm-provider')?.addEventListener('change', (e) => {
    updateModelOptions(e.target.value, null);
  });

  // Copy project ID
  document.getElementById('btn-copy-project-id')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(projectId);
      toast.success('Copied', 'Project ID copied to clipboard.');
    } catch (err) {
      const input = document.getElementById('settings-project-id');
      input.select();
      document.execCommand('copy');
      toast.success('Copied', 'Project ID copied to clipboard.');
    }
  });

  // Toggle password visibility
  document.querySelectorAll('.btn-toggle-visibility').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target;
      const input = document.getElementById(targetId);
      if (input) {
        input.type = input.type === 'password' ? 'text' : 'password';
        btn.querySelector('.icon').textContent = input.type === 'password' ? '👁' : '🙈';
      }
    });
  });

  // Save settings
  document.getElementById('btn-save-settings')?.addEventListener('click', saveSettings);

  // Delete project
  document.getElementById('btn-delete-project')?.addEventListener('click', () => {
    confirmDeleteProject(projectId);
  });
}

async function saveSettings() {
  const btn = document.getElementById('btn-save-settings');
  const originalText = btn.innerHTML;
  btn.innerHTML = '<span class="icon">⏳</span> Saving...';
  btn.disabled = true;

  try {
    // Gather settings
    const name = document.getElementById('settings-project-name').value;
    const llmProvider = document.getElementById('settings-llm-provider').value;
    const llmModel = document.getElementById('settings-llm-model').value;
    const ttsProvider = document.getElementById('settings-tts-provider').value;
    const sttProvider = document.getElementById('settings-stt-provider').value;

    // Update project settings
    await projects.update(currentProjectId, {
      name,
      settings: {
        llm_provider: llmProvider,
        llm_model: llmModel,
        tts_provider: ttsProvider,
        stt_provider: sttProvider,
      },
    });

    // Collect API keys (only non-empty ones)
    const apiKeys = {};
    const keyTypes = ['gemini', 'openai', 'anthropic', 'grok', 'deepgram', 'cartesia', 'elevenlabs'];
    keyTypes.forEach((keyType) => {
      const keyValue = document.getElementById(`settings-key-${keyType}`)?.value;
      if (keyValue && !keyValue.includes('•')) {
        apiKeys[keyType] = keyValue;
      }
    });

    // Update API keys if any were provided
    if (Object.keys(apiKeys).length > 0) {
      await projects.updateKeys(currentProjectId, apiKeys);
    }

    toast.success('Settings Saved', 'Project settings have been updated.');
    
    // Refresh key status
    await loadKeyStatus(currentProjectId);

    // Clear API key inputs (security)
    keyTypes.forEach(keyType => {
      const input = document.getElementById(`settings-key-${keyType}`);
      if (input) input.value = '';
    });

  } catch (error) {
    toast.error('Failed to Save Settings', error.message);
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
}

function confirmDeleteProject(projectId) {
  const content = document.createElement('div');
  content.innerHTML = `
    <p>This action <strong>cannot be undone</strong>. This will permanently delete:</p>
    <ul style="margin: 1rem 0; padding-left: 1.5rem;">
      <li>All NPCs in this project</li>
      <li>All knowledge base entries</li>
      <li>All saved states and memories</li>
      <li>All configuration and settings</li>
    </ul>
    <p>Please type <strong>${currentProject?.name || projectId}</strong> to confirm:</p>
    <input type="text" id="confirm-delete-input" class="input" placeholder="Type project name to confirm" style="margin-top: 0.5rem;">
  `;

  const footer = document.createElement('div');
  footer.innerHTML = `
    <button class="btn btn-outline" data-action="cancel">Cancel</button>
    <button class="btn btn-danger" data-action="delete" disabled>Delete Project</button>
  `;

  const modalInstance = modal.open({
    title: 'Delete Project',
    content,
    footer,
    size: 'medium',
  });

  // Enable delete button only when name matches
  const confirmInput = content.querySelector('#confirm-delete-input');
  const deleteBtn = footer.querySelector('[data-action="delete"]');
  
  confirmInput.addEventListener('input', () => {
    const matches = confirmInput.value === (currentProject?.name || projectId);
    deleteBtn.disabled = !matches;
  });

  footer.querySelector('[data-action="cancel"]').addEventListener('click', () => {
    modalInstance.close();
  });

  footer.querySelector('[data-action="delete"]').addEventListener('click', async () => {
    try {
      await projects.delete(projectId);
      modalInstance.close();
      toast.success('Project Deleted', 'The project has been permanently deleted.');
      router.navigate('/projects');
    } catch (error) {
      toast.error('Failed to Delete Project', error.message);
    }
  });
}

export default { initSettingsPage };
