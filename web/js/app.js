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
import { 
  initAuth, 
  signInWithGoogle, 
  signOut, 
  onAuthStateChange, 
  getUserDisplayInfo,
  isAuthEnabled 
} from './auth.js';
import { setAuthFailureHandler } from './api.js';

/**
 * Initialize the application
 */
async function init() {
  // Initialize toast system
  toast.init();

  // Initialize authentication (async - loads config from server)
  const authEnabled = await initAuth();
  console.log('[App] Auth enabled:', authEnabled);

  // Set up auth state change listener
  onAuthStateChange(handleAuthStateChange);

  // Set up auth failure handler for API
  setAuthFailureHandler(() => {
    toast.error('Session Expired', 'Please sign in again');
    updateAuthUI(null);
  });

  // Set up auth button event listeners
  setupAuthListeners();

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

  // Hide auth UI if auth is not enabled (local mode)
  if (!authEnabled) {
    const navAuth = document.getElementById('nav-auth');
    if (navAuth) {
      navAuth.style.display = 'none';
    }
  }

  console.log('Evolve.NPC initialized');
}

/**
 * Handle auth state changes
 */
function handleAuthStateChange(event, session, user) {
  console.log('[App] Auth state changed:', event, user?.email);
  updateAuthUI(user);
}

/**
 * Update the navigation UI based on auth state
 */
function updateAuthUI(user) {
  const authButtons = document.getElementById('auth-buttons');
  const accountMenu = document.getElementById('account-menu');
  const accountName = document.getElementById('account-name');
  const accountAvatar = document.getElementById('account-avatar');
  const dropdownEmail = document.getElementById('dropdown-email');

  if (!authButtons || !accountMenu) {
    return;
  }

  if (user) {
    const displayInfo = getUserDisplayInfo();
    
    // Hide sign in button, show account menu
    authButtons.style.display = 'none';
    accountMenu.style.display = 'flex';

    // Update account info
    if (accountName && displayInfo) {
      accountName.textContent = displayInfo.name || 'User';
    }

    if (dropdownEmail && displayInfo) {
      dropdownEmail.textContent = displayInfo.email || '';
    }

    // Update avatar
    if (accountAvatar && displayInfo) {
      if (displayInfo.avatar) {
        accountAvatar.innerHTML = `<img src="${displayInfo.avatar}" alt="Avatar" class="avatar-img">`;
      } else {
        const initial = (displayInfo.name || displayInfo.email || 'U')[0].toUpperCase();
        accountAvatar.innerHTML = `<span class="avatar-placeholder">${initial}</span>`;
      }
    }
  } else {
    // Show sign in button, hide account menu
    authButtons.style.display = 'flex';
    accountMenu.style.display = 'none';
  }
}

/**
 * Set up auth button event listeners
 */
function setupAuthListeners() {
  // Sign in button
  const signInBtn = document.getElementById('btn-sign-in');
  if (signInBtn) {
    signInBtn.addEventListener('click', async () => {
      signInBtn.disabled = true;
      signInBtn.innerHTML = '<span class="spinner"></span> Signing in...';
      
      const { error } = await signInWithGoogle();
      
      if (error) {
        toast.error('Sign In Failed', error.message);
        signInBtn.disabled = false;
        signInBtn.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="auth-icon">
            <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path>
            <polyline points="10 17 15 12 10 7"></polyline>
            <line x1="15" y1="12" x2="3" y2="12"></line>
          </svg>
          Sign In
        `;
      }
      // If successful, page will redirect to Google OAuth
    });
  }

  // Sign out button
  const signOutBtn = document.getElementById('btn-sign-out');
  if (signOutBtn) {
    signOutBtn.addEventListener('click', async () => {
      const { error } = await signOut();
      
      if (error) {
        toast.error('Sign Out Failed', error.message);
      } else {
        toast.success('Signed Out', 'You have been signed out');
        // Redirect to home page
        router.navigate('/');
      }
    });
  }

  // Account trigger (dropdown toggle)
  const accountTrigger = document.getElementById('account-trigger');
  const accountDropdown = document.getElementById('account-dropdown');
  
  if (accountTrigger && accountDropdown) {
    accountTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      accountDropdown.classList.toggle('open');
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!accountTrigger.contains(e.target) && !accountDropdown.contains(e.target)) {
        accountDropdown.classList.remove('open');
      }
    });

    // Close dropdown on escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        accountDropdown.classList.remove('open');
      }
    });
  }
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
