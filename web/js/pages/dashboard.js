/**
 * Project Dashboard Page Handler
 */

import { projects, mcpTools, starterPacks, ApiError } from '../api.js';
import { toast, modal, renderTemplate, updateNav } from '../components.js';
import { router } from '../router.js';

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
    { href: `/projects/${projectId}/settings`, label: 'Settings' },
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

    // Load usage data async (non-blocking — never throws to user)
    loadUsageData(projectId).catch(() => { });

    // Show/hide starter pack section based on content
    const starterSection = document.getElementById('starter-pack-section');
    if (starterSection) {
      const hasContent = (stats.npcs?.total > 0) ||
        (stats.knowledge?.categories > 0) ||
        (stats.tools?.total > 0);
      if (hasContent) {
        starterSection.style.display = 'none';
      } else {
        starterSection.style.display = 'block';
        renderStarterPackCatalog(projectId);
      }
    }

  } catch (error) {
    toast.error('Failed to Load Project', error.message);
    router.navigate('/projects');
  }
}

/**
 * Load project usage totals and recent transcripts.
 * Non-blocking and fully graceful — never throws.
 */
async function loadUsageData(projectId) {
  try {
    const [usageRes, transcriptsRes] = await Promise.all([
      projects.getUsage(projectId).catch(() => null),
      projects.listTranscripts(projectId, 20).catch(() => null),
    ]);

    const section = document.getElementById('usage-section');
    if (!section) return;

    // Update usage stats
    if (usageRes) {
      section.style.display = 'block';
      const fmt = (n) => Number(n || 0).toLocaleString();
      document.getElementById('usage-total-convos').textContent = fmt(usageRes.total_conversations);
      document.getElementById('usage-text-in').textContent = fmt(usageRes.text_input_tokens);
      document.getElementById('usage-text-out').textContent = fmt(usageRes.text_output_tokens);
      document.getElementById('usage-voice-in').textContent = fmt(usageRes.voice_input_chars);
      document.getElementById('usage-voice-out').textContent = fmt(usageRes.voice_output_chars);
    }

    // Render transcript list
    const transcripts = transcriptsRes?.transcripts || [];
    const countEl = document.getElementById('transcripts-count');
    const listEl = document.getElementById('transcripts-list');
    if (!countEl || !listEl) return;

    if (transcripts.length > 0) {
      section.style.display = 'block';
      countEl.textContent = `${transcripts.length} conversation${transcripts.length !== 1 ? 's' : ''}`;
      const rows = transcripts.map(t => {
        const date = new Date(t.started_at).toLocaleString();
        const textTok = Number(t.token_usage?.text_input_tokens || 0) + Number(t.token_usage?.text_output_tokens || 0);
        const voiceCh = Number(t.token_usage?.voice_input_chars || 0) + Number(t.token_usage?.voice_output_chars || 0);
        const modeLabel = t.mode || 'text-text';
        return `<div class="transcript-row">
          <div class="transcript-meta">
            <span class="transcript-npc">${t.npc_id || 'NPC'}</span>
            <span class="transcript-mode badge-mode badge-mode-${modeLabel.startsWith('voice') ? 'voice' : 'text'}">${modeLabel}</span>
            <span class="transcript-msgs">${t.message_count} msg${t.message_count !== 1 ? 's' : ''}</span>
          </div>
          <div class="transcript-tokens">
            ${textTok > 0 ? `<span title="Text tokens (est.)">&#128196; ${textTok.toLocaleString()} tok</span>` : ''}
            ${voiceCh > 0 ? `<span title="Voice chars">&#127908; ${voiceCh.toLocaleString()} ch</span>` : ''}
          </div>
          <span class="transcript-date">${date}</span>
        </div>`;
      }).join('');
      listEl.innerHTML = rows;
    } else {
      countEl.textContent = 'No transcripts yet';
    }
  } catch {
    // Silently fail — usage section is optional
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
 * Fetch and render all starter pack cards into #pack-grid.
 * Called only when the starter-pack-section is visible (project is empty).
 */
async function renderStarterPackCatalog(projectId) {
  const grid = document.getElementById('pack-grid');
  if (!grid) return;

  // Only render once per page load
  if (grid.dataset.rendered === projectId) return;
  grid.dataset.rendered = projectId;

  try {
    const packs = await starterPacks.list();
    if (!packs.length) {
      grid.innerHTML = '<p class="text-secondary">No starter packs available.</p>';
      return;
    }

    grid.innerHTML = packs.map((pack) => `
      <div class="pack-card" data-pack-id="${escapeHtml(pack.id)}">
        <div class="pack-card-body">
          <div class="pack-card-theme">${escapeHtml(pack.theme)}</div>
          <div class="pack-card-name">${escapeHtml(pack.name)}</div>
          <div class="pack-card-desc">${escapeHtml(pack.description)}</div>
          <div class="pack-card-stats">
            <span>${pack.npc_count} NPCs</span>
            <span>${pack.tool_count} tools</span>
            <span>${pack.knowledge_categories.length} categories</span>
          </div>
        </div>
        <div class="pack-card-actions">
          <button class="btn btn-outline btn-sm" data-action="preview" data-pack-id="${escapeHtml(pack.id)}">Preview</button>
          <button class="btn btn-primary btn-sm" data-action="load" data-pack-id="${escapeHtml(pack.id)}" data-pack-name="${escapeHtml(pack.name)}">Load</button>
        </div>
      </div>
    `).join('');

    // Attach click handlers
    grid.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      const packId = btn.dataset.packId;
      const packName = btn.dataset.packName;
      if (action === 'preview') {
        const pack = packs.find((p) => p.id === packId);
        if (pack) showPackPreview(pack);
      } else if (action === 'load') {
        doLoadPack(projectId, packId, packName);
      }
    });
  } catch (error) {
    grid.innerHTML = '<p class="text-secondary">Failed to load starter packs.</p>';
  }
}

/**
 * Show a preview modal for a starter pack (metadata only).
 */
function showPackPreview(pack) {
  const previewContent = document.createElement('div');
  const npcList = (pack.preview_npcs || []).map((npc) => `
    <div class="pack-preview-npc">
      <div class="pack-preview-npc-name">${escapeHtml(npc.name)}</div>
      <div class="pack-preview-npc-role">${escapeHtml(npc.role)}</div>
      <div class="pack-preview-npc-desc text-secondary">${escapeHtml(npc.description)}</div>
    </div>
  `).join('');

  const categories = (pack.knowledge_categories || []).map((c) =>
    `<span class="tag">${escapeHtml(c.replace(/_/g, ' '))}</span>`
  ).join('');

  previewContent.innerHTML = `
    <div class="pack-preview">
      <div class="pack-preview-meta">
        <span class="pack-card-theme">${escapeHtml(pack.theme)}</span>
        <span class="text-secondary">${pack.npc_count} NPCs &middot; ${pack.tool_count} tools</span>
      </div>
      <p class="pack-preview-desc">${escapeHtml(pack.description)}</p>
      <h4>Characters</h4>
      <div class="pack-preview-npcs">${npcList}</div>
      <h4>Knowledge Categories</h4>
      <div class="pack-preview-categories">${categories}</div>
    </div>
  `;

  const footer = document.createElement('div');
  footer.innerHTML = '<button class="btn btn-outline" data-action="close">Close</button>';

  const m = modal.open({ title: pack.name, content: previewContent, footer });
  footer.querySelector('[data-action="close"]')?.addEventListener('click', () => m.close());
}

/**
 * Load a starter pack into the project.
 */
async function doLoadPack(projectId, packId, packName) {
  const loadBtn = document.querySelector(`.pack-card[data-pack-id="${packId}"] button[data-action="load"]`);

  const confirmContent = document.createElement('div');
  confirmContent.innerHTML = `
    <p>Load <strong>${escapeHtml(packName)}</strong> into this project?</p>
    <p class="text-secondary" style="margin-top: var(--space-3); font-size: var(--text-sm);">This will add NPCs, knowledge, and tools. Existing content is not overwritten.</p>
  `;

  const confirmFooter = document.createElement('div');
  confirmFooter.innerHTML = `
    <button class="btn btn-outline" data-action="cancel">Cancel</button>
    <button class="btn btn-primary" data-action="confirm">Load Pack</button>
  `;

  const confirmModal = modal.open({
    title: 'Load Starter Pack',
    content: confirmContent,
    footer: confirmFooter,
  });

  confirmFooter.querySelector('[data-action="cancel"]')?.addEventListener('click', () => {
    confirmModal.close();
  });

  confirmFooter.querySelector('[data-action="confirm"]')?.addEventListener('click', async () => {
    confirmModal.close();
    if (loadBtn) {
      loadBtn.disabled = true;
      loadBtn.textContent = 'Loading...';
    }
    try {
      const result = await projects.loadStarterPack(projectId, packId);
      toast.success(
        'Starter Pack Loaded',
        `Added ${result.npcs_added} NPCs, ${result.knowledge_categories_added} categories, ${result.conversation_tools_added + result.game_event_tools_added} tools`
      );
      sessionStorage.removeItem(`${STATS_CACHE_KEY}_${projectId}`);
      await loadProjectData(projectId);
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 0;
      if (status === 409) {
        toast.error('Pack Already Loaded', 'This project already has content. Only one starter pack can be loaded per project.');
      } else {
        toast.error('Failed to Load Pack', error.message);
      }
      if (loadBtn) {
        loadBtn.disabled = false;
        loadBtn.textContent = 'Load';
      }
    }
  });
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
