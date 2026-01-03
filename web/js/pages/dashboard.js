/**
 * Project Dashboard Page Handler
 */

import { projects, npcs, knowledge, session } from '../api.js';
import { toast, modal, loading, renderTemplate, updateNav } from '../components.js';
import { router } from '../router.js';

let currentProject = null;

export async function initDashboardPage(params) {
  const { projectId } = params;

  renderTemplate('template-dashboard');

  // Update navigation
  updateNav([
    { href: '/projects', label: 'Projects' },
    { href: `/projects/${projectId}`, label: 'Dashboard', active: true },
    { href: `/projects/${projectId}/npcs`, label: 'NPCs' },
    { href: `/projects/${projectId}/knowledge`, label: 'Knowledge' },
    { href: `/projects/${projectId}/playground`, label: 'Playground' },
  ]);

  // Load project data
  await loadProjectData(projectId);

  // Bind action links
  document.getElementById('link-npcs')?.addEventListener('click', (e) => {
    e.preventDefault();
    router.navigate(`/projects/${projectId}/npcs`);
  });

  document.getElementById('link-knowledge')?.addEventListener('click', (e) => {
    e.preventDefault();
    router.navigate(`/projects/${projectId}/knowledge`);
  });

  document.getElementById('link-playground')?.addEventListener('click', (e) => {
    e.preventDefault();
    router.navigate(`/projects/${projectId}/playground`);
  });

  // Bind settings button
  document.getElementById('btn-project-settings')?.addEventListener('click', () => {
    openSettingsModal(projectId);
  });

}

async function loadProjectData(projectId) {
  try {
    // Load project info
    currentProject = await projects.get(projectId);

    // Update page header
    document.getElementById('project-name').textContent = currentProject.name;
    document.getElementById('dashboard-title').textContent = currentProject.name;

    // Load stats in parallel
    const [npcList, knowledgeBase, stats] = await Promise.all([
      npcs.list(projectId).catch(() => ({ npcs: [] })),
      knowledge.get(projectId).catch(() => ({ categories: {} })),
      session.getStats().catch(() => ({ projectSessions: {} })),
    ]);

    // Update stats
    document.getElementById('stat-npcs').textContent = npcList.npcs?.length || 0;
    document.getElementById('stat-categories').textContent = Object.keys(knowledgeBase.categories || {}).length;
    document.getElementById('stat-sessions').textContent = stats.projectSessions?.[projectId] || 0;

    // Update API key status indicators
    // Note: We can't actually check if keys are set from the client side
    // This would need a dedicated endpoint

  } catch (error) {
    toast.error('Failed to Load Project', error.message);
    router.navigate('/projects');
  }
}

function openSettingsModal(projectId) {
  const content = document.createElement('div');
  content.className = 'settings-modal-content';
  content.innerHTML = `
    <div class="settings-section">
      <div class="form-group">
        <label for="project-name-input">Project Name</label>
        <input type="text" id="project-name-input" class="input" value="${escapeHtml(currentProject?.name || '')}">
      </div>
      <div class="form-group">
        <label>Project ID</label>
        <div class="input-with-button">
          <input type="text" id="project-id-display" class="input" value="${projectId}" readonly>
          <button type="button" class="btn btn-sm btn-outline" id="btn-copy-project-id">Copy</button>
        </div>
      </div>
      <div class="form-group">
        <label for="tts-provider">Default TTS Provider</label>
        <select id="tts-provider" class="input select">
          <option value="cartesia" ${currentProject?.settings?.tts_provider === 'cartesia' ? 'selected' : ''}>Cartesia (Default)</option>
          <option value="elevenlabs" ${currentProject?.settings?.tts_provider === 'elevenlabs' ? 'selected' : ''}>ElevenLabs</option>
        </select>
      </div>
    </div>

    <div class="settings-divider"></div>

    <div class="settings-section">
      <h3 class="settings-section-title">API Keys</h3>
      <p class="settings-hint">API keys are encrypted and stored securely.</p>

      <div class="form-group">
        <label for="key-gemini">Gemini API Key</label>
        <input type="password" id="key-gemini" class="input" placeholder="Enter Gemini API key...">
        <span class="input-hint">LLM provider for NPC cognition</span>
      </div>

      <div class="form-group">
        <label for="key-deepgram">Deepgram API Key</label>
        <input type="password" id="key-deepgram" class="input" placeholder="Enter Deepgram API key...">
        <span class="input-hint">Speech-to-text for voice input</span>
      </div>

      <div class="form-group">
        <label for="key-cartesia">Cartesia API Key</label>
        <input type="password" id="key-cartesia" class="input" placeholder="Enter Cartesia API key...">
        <span class="input-hint">Text-to-speech (default provider)</span>
      </div>

      <div class="form-group">
        <label for="key-elevenlabs">ElevenLabs API Key</label>
        <input type="password" id="key-elevenlabs" class="input" placeholder="Enter ElevenLabs API key...">
        <span class="input-hint">Text-to-speech (alternative provider)</span>
      </div>
    </div>
  `;

  const footer = document.createElement('div');
  footer.innerHTML = `
    <button class="btn btn-outline" data-action="cancel">Cancel</button>
    <button class="btn btn-primary" data-action="save">Save Changes</button>
  `;

  const modalInstance = modal.open({
    title: 'Project Settings',
    content,
    footer,
    size: 'large',
  });

  // Copy project ID
  content.querySelector('#btn-copy-project-id').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(projectId);
      toast.success('Copied', 'Project ID copied to clipboard.');
    } catch (err) {
      // Fallback for older browsers
      const input = content.querySelector('#project-id-display');
      input.select();
      document.execCommand('copy');
      toast.success('Copied', 'Project ID copied to clipboard.');
    }
  });

  footer.querySelector('[data-action="cancel"]').addEventListener('click', () => {
    modalInstance.close();
  });

  footer.querySelector('[data-action="save"]').addEventListener('click', async () => {
    const name = content.querySelector('#project-name-input').value;
    const ttsProvider = content.querySelector('#tts-provider').value;

    // Collect API keys (only non-empty ones)
    const apiKeys = {};
    const keyTypes = ['gemini', 'deepgram', 'cartesia', 'elevenlabs'];
    keyTypes.forEach((keyType) => {
      const keyValue = content.querySelector(`#key-${keyType}`).value;
      if (keyValue) {
        apiKeys[keyType] = keyValue;
      }
    });

    try {
      // Update project settings
      await projects.update(projectId, {
        name,
        settings: { tts_provider: ttsProvider },
      });

      // Update API keys if any were provided
      if (Object.keys(apiKeys).length > 0) {
        await projects.updateKeys(projectId, apiKeys);
      }

      toast.success('Settings Saved', 'Project settings have been updated.');
      modalInstance.close();
      await loadProjectData(projectId);
    } catch (error) {
      toast.error('Failed to Save Settings', error.message);
    }
  });
}


function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export default { initDashboardPage };
