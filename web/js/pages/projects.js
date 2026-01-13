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
    grid.innerHTML = projectList
      .map(
        (project) => `
        <div class="project-card" data-id="${project.id}">
          <div class="project-card-header">
            <h3>${escapeHtml(project.name)}</h3>
            <span class="badge badge-outline">${project.id}</span>
          </div>
          <div class="project-card-meta">
            <span>Created ${formatDate(project.created_at)}</span>
          </div>
          <div class="project-card-actions">
            <button class="btn btn-sm btn-outline" data-action="open">Open</button>
            <button class="btn btn-sm btn-ghost" data-action="delete">Delete</button>
          </div>
        </div>
      `
      )
      .join('');

    // Bind card actions
    grid.querySelectorAll('.project-card').forEach((card) => {
      const projectId = card.dataset.id;

      card.querySelector('[data-action="open"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        router.navigate(`/projects/${projectId}`);
      });

      card.querySelector('[data-action="delete"]')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        await handleDeleteProject(projectId, card.querySelector('h3').textContent);
      });

      card.addEventListener('click', () => {
        router.navigate(`/projects/${projectId}`);
      });
    });
  } catch (error) {
    toast.error('Failed to Load Projects', error.message);
    grid.innerHTML = `<div class="empty-state"><p>Failed to load projects</p></div>`;
  }
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
