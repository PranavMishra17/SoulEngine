/**
 * Landing Page Handler
 */

import { projects } from '../api.js';
import { toast, modal, renderTemplate, updateNav } from '../components.js';
import { router } from '../router.js';

export async function initLandingPage() {
  renderTemplate('template-landing');

  // Update navigation
  updateNav([]);

  // Bind event handlers
  const createButtons = document.querySelectorAll('#btn-create-project, #btn-cta-create, #btn-empty-create');
  createButtons.forEach((btn) => {
    btn?.addEventListener('click', handleCreateProject);
  });

  document.getElementById('btn-view-projects')?.addEventListener('click', () => {
    router.navigate('/projects');
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

export default { initLandingPage };
