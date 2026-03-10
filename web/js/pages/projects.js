/**
 * Projects List Page Handler
 */

import { projects } from '../api.js';
import { toast, modal, loading, renderTemplate, updateNav, formatDate } from '../components.js';
import { router } from '../router.js';

export async function initProjectsPage() {
  renderTemplate('template-projects');

  // Clear project-specific nav tabs when on projects list
  updateNav([]);

  // Load projects
  await loadProjects();

  // Bind event handlers
  document.getElementById('btn-new-project')?.addEventListener('click', handleCreateProject);
  document.getElementById('btn-empty-create')?.addEventListener('click', handleCreateProject);
}

async function loadProjects() {
  const grid = document.getElementById('projects-grid');
  const emptyState = document.getElementById('empty-projects');

  grid.innerHTML = loading.skeleton(3);

  try {
    const data = await projects.list();
    const projectList = data.projects || [];

    if (projectList.length === 0) {
      grid.innerHTML = '';
      emptyState.style.display = 'block';
      return;
    }

    emptyState.style.display = 'none';

    // Render cards immediately with placeholder stats
    grid.innerHTML = projectList
      .map((project) => renderProjectCard(project, null))
      .join('');

    // Asynchronously load stats for each card (non-blocking)
    const statsPromises = projectList.map(async (project) => {
      try {
        const stats = await projects.getStats(project.id);
        const card = grid.querySelector(`.project-card[data-id="${project.id}"]`);
        if (card) {
          const npcCount = stats.npcs?.total ?? 0;
          const knowledgeCount = stats.knowledge?.categories ?? 0;
          const toolCount = (stats.tools?.conversation ?? 0) + (stats.tools?.gameEvent ?? 0);
          const statsEl = card.querySelector('.project-card-stats');
          if (statsEl) {
            statsEl.innerHTML = buildStatsHtml(npcCount, knowledgeCount, toolCount);
            statsEl.classList.add('loaded');
          }
        }
      } catch {
        // Stats unavailable — leave placeholder dashes
      }
    });

    // Bind card actions immediately
    bindCardActions(grid, projectList);

    // Await all stats (silently — they already updated the DOM inline)
    await Promise.allSettled(statsPromises);

  } catch (error) {
    toast.error('Failed to Load Projects', error.message);
    grid.innerHTML = `<div class="empty-state"><p>Failed to load projects</p></div>`;
  }
}

function buildStatsHtml(npc, knowledge, tools) {
  return `
    <span class="project-stat"><strong>${npc}</strong> NPC${npc !== 1 ? 's' : ''}</span>
    <span class="project-stat-sep"></span>
    <span class="project-stat"><strong>${knowledge}</strong> Categor${knowledge !== 1 ? 'ies' : 'y'}</span>
    <span class="project-stat-sep"></span>
    <span class="project-stat"><strong>${tools}</strong> Tool${tools !== 1 ? 's' : ''}</span>
  `;
}

function renderProjectCard(project, stats) {
  const npc = stats?.npcs?.total ?? '—';
  const knowledge = stats?.knowledge?.categories ?? '—';
  const tools = stats ? ((stats.tools?.conversation ?? 0) + (stats.tools?.gameEvent ?? 0)) : '—';

  return `
    <div class="project-card" data-id="${project.id}">
      <div class="project-card-top">
        <div class="project-card-title-row">
          <h3 class="project-card-name">${escapeHtml(project.name)}</h3>
          <span class="project-card-date">${formatDate(project.created_at)}</span>
        </div>
        <div class="project-card-stats">
          ${buildStatsHtml(npc, knowledge, tools)}
        </div>
        <span class="project-card-id">${project.id}</span>
      </div>
      <div class="project-card-actions">
        <button class="btn btn-sm btn-primary" data-action="open">Open</button>
        <button class="btn btn-sm btn-ghost btn-danger-ghost" data-action="delete">Delete</button>
      </div>
    </div>
  `;
}

function bindCardActions(grid, projectList) {
  grid.querySelectorAll('.project-card').forEach((card) => {
    const projectId = card.dataset.id;

    card.querySelector('[data-action="open"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      router.navigate(`/projects/${projectId}`);
    });

    card.querySelector('[data-action="delete"]')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const name = card.querySelector('.project-card-name')?.textContent || '';
      await handleDeleteProject(projectId, name);
    });

    card.addEventListener('click', () => {
      router.navigate(`/projects/${projectId}`);
    });
  });
}

async function handleCreateProject() {
  const name = await modal.prompt(
    'Create New Project',
    'Enter a name for your project:',
    'My NPC Project'
  );

  if (!name) return;

  try {
    const project = await projects.create(name);
    toast.success('Project Created', `"${project.name}" is ready to use.`);
    router.navigate(`/projects/${project.id}`);
  } catch (error) {
    toast.error('Failed to Create Project', error.message);
  }
}

async function handleDeleteProject(projectId, projectName) {
  const confirmed = await modal.confirm(
    'Delete Project',
    `Are you sure you want to delete "${projectName}"? This action cannot be undone.`
  );

  if (!confirmed) return;

  try {
    await projects.delete(projectId);
    toast.success('Project Deleted', `"${projectName}" has been deleted.`);
    await loadProjects();
  } catch (error) {
    toast.error('Failed to Delete Project', error.message);
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export default { initProjectsPage };
