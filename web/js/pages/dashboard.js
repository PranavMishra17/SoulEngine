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

  // Bind API key buttons
  document.querySelectorAll('[data-key]').forEach((btn) => {
    btn.addEventListener('click', () => {
      openApiKeyModal(projectId, btn.dataset.key);
    });
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
  content.innerHTML = `
    <div class="form-group">
      <label for="project-name-input">Project Name</label>
      <input type="text" id="project-name-input" class="input" value="${escapeHtml(currentProject?.name || '')}">
    </div>
    <div class="form-group">
      <label for="tts-provider">Default TTS Provider</label>
      <select id="tts-provider" class="input select">
        <option value="cartesia" ${currentProject?.settings?.tts_provider === 'cartesia' ? 'selected' : ''}>Cartesia (Default)</option>
        <option value="elevenlabs" ${currentProject?.settings?.tts_provider === 'elevenlabs' ? 'selected' : ''}>ElevenLabs</option>
      </select>
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
  });

  footer.querySelector('[data-action="cancel"]').addEventListener('click', () => {
    modalInstance.close();
  });

  footer.querySelector('[data-action="save"]').addEventListener('click', async () => {
    const name = content.querySelector('#project-name-input').value;
    const ttsProvider = content.querySelector('#tts-provider').value;

    try {
      await projects.update(projectId, {
        name,
        settings: { tts_provider: ttsProvider },
      });
      toast.success('Settings Saved', 'Project settings have been updated.');
      modalInstance.close();
      await loadProjectData(projectId);
    } catch (error) {
      toast.error('Failed to Save Settings', error.message);
    }
  });
}

function openApiKeyModal(projectId, keyType) {
  const keyNames = {
    gemini: 'Gemini API Key',
    deepgram: 'Deepgram API Key',
    cartesia: 'Cartesia API Key',
    elevenlabs: 'ElevenLabs API Key',
  };

  const content = document.createElement('div');
  content.innerHTML = `
    <div class="form-group">
      <label for="api-key-input">${keyNames[keyType]}</label>
      <input type="password" id="api-key-input" class="input" placeholder="Enter API key...">
      <span class="input-hint">Your API key will be encrypted and stored securely.</span>
    </div>
  `;

  const footer = document.createElement('div');
  footer.innerHTML = `
    <button class="btn btn-outline" data-action="cancel">Cancel</button>
    <button class="btn btn-primary" data-action="save">Save Key</button>
  `;

  const modalInstance = modal.open({
    title: `Configure ${keyNames[keyType]}`,
    content,
    footer,
  });

  footer.querySelector('[data-action="cancel"]').addEventListener('click', () => {
    modalInstance.close();
  });

  footer.querySelector('[data-action="save"]').addEventListener('click', async () => {
    const apiKey = content.querySelector('#api-key-input').value;

    if (!apiKey) {
      toast.warning('No Key Entered', 'Please enter an API key.');
      return;
    }

    try {
      await projects.updateKeys(projectId, { [keyType]: apiKey });
      toast.success('API Key Saved', `${keyNames[keyType]} has been configured.`);
      modalInstance.close();

      // Update status indicator
      const statusEl = document.getElementById(`key-${keyType}-status`);
      if (statusEl) {
        statusEl.textContent = 'Configured';
        statusEl.classList.add('configured');
      }
    } catch (error) {
      toast.error('Failed to Save API Key', error.message);
    }
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export default { initDashboardPage };
