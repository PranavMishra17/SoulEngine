/**
 * Project Dashboard Page Handler
 */

import { projects, mcpTools } from '../api.js';
import { toast, modal, renderTemplate, updateNav } from '../components.js';
import { router } from '../router.js';
import { getAccessToken } from '../auth.js';

let currentProject = null;
let currentProjectId = null;

// Cache configuration
const STATS_CACHE_KEY = 'soulengine_dashboard_stats';
const STATS_CACHE_TTL = 2 * 60 * 1000; // 2 minutes (shorter TTL for fresher data)

export async function initDashboardPage(params) {
  const { projectId } = params;
  currentProjectId = projectId;

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

  // Bind board clicks
  document.getElementById('board-npcs')?.addEventListener('click', (e) => {
    e.preventDefault();
    router.navigate(`/projects/${projectId}/npcs`);
  });

  document.getElementById('board-knowledge')?.addEventListener('click', (e) => {
    e.preventDefault();
    router.navigate(`/projects/${projectId}/knowledge`);
  });

  document.getElementById('board-mcp')?.addEventListener('click', (e) => {
    e.preventDefault();
    router.navigate(`/projects/${projectId}/mcp-tools`);
  });

  document.getElementById('link-playground')?.addEventListener('click', (e) => {
    e.preventDefault();
    router.navigate(`/projects/${projectId}/playground`);
  });

  // Bind settings button
  document.getElementById('btn-project-settings')?.addEventListener('click', () => {
    router.navigate(`/projects/${projectId}/settings`);
  });

  // Bind copy project ID button
  document.getElementById('btn-copy-project-id')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(projectId);
      toast.success('Copied!', 'Project ID copied to clipboard');
    } catch (err) {
      toast.error('Copy Failed', 'Could not copy to clipboard');
    }
  });

  // Bind starter pack button
  document.getElementById('btn-load-starter-pack')?.addEventListener('click', async () => {
    await loadStarterPack(projectId);
  });

  // Bind refresh button (if exists)
  document.getElementById('btn-refresh-dashboard')?.addEventListener('click', async () => {
    // Clear cache and reload
    sessionStorage.removeItem(`${STATS_CACHE_KEY}_${projectId}`);
    await loadProjectData(projectId);
    toast.success('Refreshed', 'Dashboard data updated');
  });

  // Load project data
  await loadProjectData(projectId);
}

/**
 * Get cached stats or null if expired
 */
function getCachedStats(projectId) {
  try {
    const cached = sessionStorage.getItem(`${STATS_CACHE_KEY}_${projectId}`);
    if (!cached) return null;
    
    const { data, timestamp } = JSON.parse(cached);
    if (Date.now() - timestamp > STATS_CACHE_TTL) {
      sessionStorage.removeItem(`${STATS_CACHE_KEY}_${projectId}`);
      return null;
    }
    
    return data;
  } catch {
    return null;
  }
}

/**
 * Cache stats data
 */
function cacheStats(projectId, data) {
  try {
    sessionStorage.setItem(`${STATS_CACHE_KEY}_${projectId}`, JSON.stringify({
      data,
      timestamp: Date.now(),
    }));
  } catch {
    // Ignore storage errors
  }
}

async function loadProjectData(projectId) {
  try {
    // Check cache first
    let stats = getCachedStats(projectId);
    
    if (!stats) {
      // Fetch fresh stats
      stats = await projects.getStats(projectId);
      cacheStats(projectId, stats);
    }

    currentProject = stats.project;

    // Update page header
    document.getElementById('project-name').textContent = currentProject.name;
    document.getElementById('dashboard-title').textContent = currentProject.name;

    // Update masked project ID (show first 8 chars + ****)
    const maskedId = projectId.substring(0, 8) + '****';
    document.getElementById('project-id-masked').textContent = maskedId;

    // Update API status
    updateApiStatus(stats.apiKeys?.configured);

    // Populate boards
    populateNpcBoard(stats.npcs);
    populateKnowledgeBoard(stats.knowledge);
    populateMcpBoard(stats.tools);

    // Update stats
    document.getElementById('stat-instances').textContent = stats.instances?.total || 0;
    document.getElementById('stat-entries').textContent = stats.knowledge?.totalEntries || 0;
    document.getElementById('stat-conv-tools').textContent = stats.tools?.conversation || 0;
    document.getElementById('stat-game-tools').textContent = stats.tools?.gameEvent || 0;

    // Update flowchart
    updateFlowchart(stats);

    // Show/hide starter pack section based on content
    const starterSection = document.getElementById('starter-pack-section');
    if (starterSection) {
      // Hide if project already has content (NPCs OR knowledge OR tools)
      const hasContent = (stats.npcs?.total > 0) || 
                         (stats.knowledge?.categories > 0) || 
                         (stats.tools?.total > 0);
      starterSection.style.display = hasContent ? 'none' : 'block';
    }

  } catch (error) {
    toast.error('Failed to Load Project', error.message);
    router.navigate('/projects');
  }
}

/**
 * Update API status badge
 */
function updateApiStatus(configured) {
  const statusEl = document.getElementById('api-status');
  if (!statusEl) return;

  if (configured) {
    statusEl.className = 'api-status api-status-success';
    statusEl.innerHTML = `
      <span class="status-icon">&#10003;</span>
      <span class="status-text">API Keys Set</span>
    `;
  } else {
    statusEl.className = 'api-status api-status-warning';
    statusEl.innerHTML = `
      <span class="status-icon">!</span>
      <span class="status-text">API Keys Not Set</span>
    `;
  }
}

/**
 * Populate NPC board
 */
function populateNpcBoard(npcsData) {
  const countEl = document.getElementById('npc-count');
  const gridEl = document.getElementById('npc-grid');
  
  if (countEl) countEl.textContent = npcsData?.total || 0;
  
  if (!gridEl) return;

  const definitions = npcsData?.definitions || [];
  
  if (definitions.length === 0) {
    gridEl.innerHTML = '<div class="board-empty">No NPCs created yet</div>';
    return;
  }

  gridEl.innerHTML = definitions.map(npc => {
    // Handle both full URLs (Supabase) and filenames (local)
    let avatarHtml = '<div class="board-item-icon">&#9671;</div>';
    const profileImg = npc.profile_image;
    if (profileImg && profileImg.trim() !== '') {
      let avatarSrc;
      if (profileImg.startsWith('http://') || profileImg.startsWith('https://')) {
        avatarSrc = profileImg;
      } else {
        avatarSrc = `/api/projects/${currentProjectId}/npcs/${npc.id}/avatar`;
      }
      avatarHtml = `<div class="board-item-avatar"><img src="${avatarSrc}" alt="${escapeHtml(npc.name)}" onerror="this.parentElement.innerHTML='&#9671;'"></div>`;
    }
    
    return `
      <div class="board-item board-item-npc">
        ${avatarHtml}
        <div class="board-item-name">${escapeHtml(npc.name)}</div>
      </div>
    `;
  }).join('');

  // Add "+N more" if there are more than displayed
  if (npcsData.total > definitions.length) {
    gridEl.innerHTML += `
      <div class="board-item board-item-more">
        +${npcsData.total - definitions.length} more
      </div>
    `;
  }
}

/**
 * Populate Knowledge board
 */
function populateKnowledgeBoard(knowledgeData) {
  const countEl = document.getElementById('knowledge-count');
  const gridEl = document.getElementById('knowledge-grid');
  
  if (countEl) countEl.textContent = knowledgeData?.categories || 0;
  
  if (!gridEl) return;

  const categoryNames = knowledgeData?.categoryNames || [];
  
  if (categoryNames.length === 0) {
    gridEl.innerHTML = '<div class="board-empty">No categories defined</div>';
    return;
  }

  gridEl.innerHTML = categoryNames.map(name => `
    <div class="board-item board-item-knowledge">
      <div class="board-item-icon">&#9672;</div>
      <div class="board-item-name">${escapeHtml(name)}</div>
    </div>
  `).join('');

  // Add "+N more" if there are more than displayed
  if (knowledgeData.categories > categoryNames.length) {
    gridEl.innerHTML += `
      <div class="board-item board-item-more">
        +${knowledgeData.categories - categoryNames.length} more
      </div>
    `;
  }
}

/**
 * Populate MCP Tools board
 */
function populateMcpBoard(toolsData) {
  const countEl = document.getElementById('mcp-count');
  const contentEl = document.getElementById('mcp-content');
  
  const total = (toolsData?.conversation || 0) + (toolsData?.gameEvent || 0);
  if (countEl) countEl.textContent = total;
  
  if (!contentEl) return;

  if (total === 0) {
    contentEl.innerHTML = '<div class="board-empty">No tools defined</div>';
    return;
  }

  let html = '';

  // Conversation tools
  if (toolsData.conversationNames?.length > 0) {
    html += `
      <div class="board-tools-section">
        <div class="board-tools-label">Conversation</div>
        <div class="board-tools-list">
          ${toolsData.conversationNames.map(name => `<span class="tool-tag">${escapeHtml(name)}</span>`).join('')}
          ${toolsData.conversation > toolsData.conversationNames.length ? `<span class="tool-tag tool-tag-more">+${toolsData.conversation - toolsData.conversationNames.length}</span>` : ''}
        </div>
      </div>
    `;
  }

  // Game event tools
  if (toolsData.gameEventNames?.length > 0) {
    html += `
      <div class="board-tools-section">
        <div class="board-tools-label">Game Events</div>
        <div class="board-tools-list">
          ${toolsData.gameEventNames.map(name => `<span class="tool-tag tool-tag-game">${escapeHtml(name)}</span>`).join('')}
          ${toolsData.gameEvent > toolsData.gameEventNames.length ? `<span class="tool-tag tool-tag-more">+${toolsData.gameEvent - toolsData.gameEventNames.length}</span>` : ''}
        </div>
      </div>
    `;
  }

  contentEl.innerHTML = html || '<div class="board-empty">No tools defined</div>';
}

/**
 * Update flowchart counts and NPC grid
 */
function updateFlowchart(stats) {
  // Knowledge Base count
  const knowledgeCount = document.getElementById('flow-knowledge-count');
  if (knowledgeCount) knowledgeCount.textContent = stats.knowledge?.categories || 0;

  // MCP Tools count
  const toolsCount = document.getElementById('flow-tools-count');
  if (toolsCount) toolsCount.textContent = stats.tools?.total || 0;

  // NPCs count
  const npcCount = document.getElementById('flow-npc-count');
  if (npcCount) npcCount.textContent = stats.npcs?.total || 0;

  // Update NPC grid with actual NPCs
  const npcGrid = document.getElementById('flow-npc-grid');
  if (npcGrid && stats.npcs?.definitions?.length > 0) {
    const npcs = stats.npcs.definitions.slice(0, 5);
    let gridHtml = npcs.map((npc, i) => `
      <div class="npc-instance-placeholder">
        <span class="npc-placeholder-icon">${npc.hasImage ? '&#128100;' : '&#9671;'}</span>
        <span class="npc-placeholder-label">${escapeHtml(npc.name.substring(0, 8))}</span>
      </div>
    `).join('');
    
    // Add "more" placeholder if there are more NPCs
    if (stats.npcs.total > 5) {
      gridHtml += `
        <div class="npc-instance-placeholder npc-placeholder-more">
          <span class="npc-placeholder-icon">+${stats.npcs.total - 5}</span>
          <span class="npc-placeholder-label">more</span>
        </div>
      `;
    } else if (stats.npcs.total === 0) {
      gridHtml = `
        <div class="npc-instance-placeholder npc-placeholder-more">
          <span class="npc-placeholder-icon">&#9671;</span>
          <span class="npc-placeholder-label">NPC 1</span>
        </div>
        <div class="npc-instance-placeholder npc-placeholder-more">
          <span class="npc-placeholder-icon">&#9671;</span>
          <span class="npc-placeholder-label">NPC n</span>
        </div>
      `;
    }
    
    npcGrid.innerHTML = gridHtml;
  }
}

/**
 * Load starter pack examples into the project
 */
async function loadStarterPack(projectId) {
  const btn = document.getElementById('btn-load-starter-pack');
  if (!btn) return;
  
  // Show custom confirmation modal
  const confirmContent = document.createElement('div');
  confirmContent.innerHTML = `
    <div class="starter-pack-confirm">
      <p style="margin-bottom: var(--space-4);">Load the <strong>Stellar Haven Station</strong> example content into your project?</p>
      <div class="starter-pack-confirm-details">
        <div class="confirm-item">&#9671; <strong>5</strong> interconnected NPCs</div>
        <div class="confirm-item">&#9672; <strong>6</strong> knowledge categories</div>
        <div class="confirm-item">&#11043; <strong>15</strong> MCP tools</div>
      </div>
      <p class="text-secondary" style="margin-top: var(--space-4); font-size: var(--text-sm);">Existing content will NOT be overwritten.</p>
    </div>
  `;
  
  const confirmFooter = document.createElement('div');
  confirmFooter.innerHTML = `
    <button class="btn btn-outline" data-action="cancel">Cancel</button>
    <button class="btn btn-primary" data-action="confirm">Load Examples</button>
  `;
  
  const confirmModal = modal.open({
    title: 'Load Starter Pack',
    content: confirmContent,
    footer: confirmFooter,
  });
  
  // Handle cancel
  confirmFooter.querySelector('[data-action="cancel"]')?.addEventListener('click', () => {
    confirmModal.close();
  });
  
  // Handle confirm
  confirmFooter.querySelector('[data-action="confirm"]')?.addEventListener('click', async () => {
    confirmModal.close();
    
    try {
      btn.disabled = true;
      btn.textContent = 'Loading...';
      
      const response = await fetch(`/api/projects/${projectId}/load-starter-pack`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to load starter pack');
      }
      
      const result = await response.json();
      
      toast.success(
        'Starter Pack Loaded!', 
        `Added ${result.npcs_added} NPCs, ${result.knowledge_categories_added} categories, ${result.conversation_tools_added + result.game_event_tools_added} tools`
      );
      
      // Clear cache and reload dashboard
      sessionStorage.removeItem(`${STATS_CACHE_KEY}_${projectId}`);
      await loadProjectData(projectId);
      
      // Hide the starter pack section after loading
      const starterSection = document.getElementById('starter-pack-section');
      if (starterSection) {
        starterSection.style.display = 'none';
      }
      
    } catch (error) {
      toast.error('Failed to Load Starter Pack', error.message);
      btn.disabled = false;
      btn.textContent = 'Load Examples';
    }
  });
}

/**
 * Get auth headers if logged in
 */
function getAuthHeaders() {
  const token = getAccessToken();
  return token ? { 'Authorization': `Bearer ${token}` } : {};
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

export default { initDashboardPage };
