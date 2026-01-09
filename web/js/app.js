/**
 * Evolve.NPC Web Application
 * Main entry point
 */

import { router } from './router.js';
import { toast } from './components.js';
import { initLandingPage } from './pages/landing.js';
import { initProjectsPage } from './pages/projects.js';
import { initDashboardPage } from './pages/dashboard.js';
import { initNpcListPage, initNpcEditorPage } from './pages/npc-editor.js';
import { initKnowledgePage } from './pages/knowledge.js';
import { initMcpToolsPage } from './pages/mcp-tools.js';
import { initPlaygroundPage } from './pages/playground.js';
import { initSettingsPage } from './pages/project-settings.js';

/**
 * Initialize the application
 */
function init() {
  // Initialize toast system
  toast.init();

  // Set up routes
  router
    // Landing page
    .on('/', initLandingPage)

    // Projects
    .on('/projects', initProjectsPage)

    // Project dashboard
    .on('/projects/:projectId', initDashboardPage)

    // NPCs
    .on('/projects/:projectId/npcs', initNpcListPage)
    .on('/projects/:projectId/npcs/:npcId', initNpcEditorPage)

    // Knowledge Base
    .on('/projects/:projectId/knowledge', initKnowledgePage)

    // MCP Tools
    .on('/projects/:projectId/mcp-tools', initMcpToolsPage)

    // Playground
    .on('/projects/:projectId/playground', initPlaygroundPage)

    // Settings
    .on('/projects/:projectId/settings', initSettingsPage)

    // Start router
    .start();

  // Theme toggle
  document.getElementById('theme-toggle')?.addEventListener('click', toggleTheme);

  // Load saved theme
  loadTheme();

  console.log('Evolve.NPC initialized');
}

/**
 * Theme management
 */
function toggleTheme() {
  const isDark = document.documentElement.classList.toggle('light-theme');
  localStorage.setItem('theme', isDark ? 'light' : 'dark');
}

function loadTheme() {
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'light') {
    document.documentElement.classList.add('light-theme');
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Global error handler
window.addEventListener('error', (event) => {
  console.error('Global error:', event.error);
  toast.error('An Error Occurred', event.error?.message || 'Something went wrong');
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled rejection:', event.reason);
  toast.error('An Error Occurred', event.reason?.message || 'Something went wrong');
});
