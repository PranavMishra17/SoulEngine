/**
 * Project Dashboard Page Handler
 */

import { projects, npcs, knowledge, session } from '../api.js';
import { toast, renderTemplate, updateNav } from '../components.js';
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
    { href: `/projects/${projectId}/mcp-tools`, label: 'MCP Tools' },
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

  document.getElementById('link-mcp-tools')?.addEventListener('click', (e) => {
    e.preventDefault();
    router.navigate(`/projects/${projectId}/mcp-tools`);
  });

  // Bind settings button - navigate to settings page
  document.getElementById('btn-project-settings')?.addEventListener('click', () => {
    router.navigate(`/projects/${projectId}/settings`);
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

export default { initDashboardPage };
