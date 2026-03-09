/**
 * Testing Playground Page Handler
 */

import { npcs, projects, knowledge, mcpTools, session, conversation, cycles, VoiceClient } from '../api.js';
import { toast, renderTemplate, updateNav, getMoodEmoji, getMoodLabel, modal } from '../components.js';
import { router } from '../router.js';

// Mind tab state
let activeChatTab = 'chat'; // 'chat' | 'mind'
let mindTurnCount = 0;

let currentProjectId = null;
let currentNpcId = null;
let currentSessionId = null;
let currentInstanceId = null; // For cycles - stored after session or fetched
let currentMode = 'text';
let currentConversationMode = { input: 'text', output: 'text' }; // Current conversation mode
let voiceClient = null;
let isVoiceActive = false;
let micVAD = null; // @ricky0123/vad-web instance
let messageCount = 0;
let responseBuffer = '';
let currentNpcInfo = null; // Store {name, profile_image, id} for chat bubbles and header
let voiceUserTranscript = ''; // Accumulates STT final segments for one utterance
let followupBuffer = ''; // Accumulates Mind follow-up text chunks
let isInFollowup = false; // True between followup_start and generation_end(followup)

// Audio playback state
let audioContext = null;
let audioQueue = [];
let isPlayingAudio = false;
let currentVoiceConfig = null; // Stores sample rate from server
let currentAudioSource = null; // Track current playing source for interruption

// Mind viewer modal state — tracked so cycles can auto-refresh it
let mindModalInstance = null;

// VAD state for UI updates
const vadState = {
  isSpeaking: false,
};

// Mood presets (VAD values: valence, arousal, dominance)
const MOOD_PRESETS = {
  neutral: { valence: 0.5, arousal: 0.5, dominance: 0.5, emoji: '😐', label: 'Neutral' },
  happy: { valence: 0.8, arousal: 0.6, dominance: 0.6, emoji: '😊', label: 'Happy' },
  sad: { valence: 0.2, arousal: 0.3, dominance: 0.3, emoji: '😢', label: 'Sad' },
  angry: { valence: 0.2, arousal: 0.8, dominance: 0.7, emoji: '😠', label: 'Angry' },
  fearful: { valence: 0.2, arousal: 0.7, dominance: 0.2, emoji: '😨', label: 'Fearful' },
  excited: { valence: 0.8, arousal: 0.9, dominance: 0.7, emoji: '🤩', label: 'Excited' },
  tired: { valence: 0.4, arousal: 0.2, dominance: 0.3, emoji: '😴', label: 'Tired' },
  content: { valence: 0.7, arousal: 0.3, dominance: 0.5, emoji: '😌', label: 'Content' },
};

export async function initPlaygroundPage(params) {
  const { projectId } = params;
  currentProjectId = projectId;

  renderTemplate('template-playground');

  // Update navigation
  updateNav([
    { href: '/projects', label: 'Projects' },
    { href: `/projects/${projectId}`, label: 'Dashboard' },
    { href: `/projects/${projectId}/npcs`, label: 'NPCs' },
    { href: `/projects/${projectId}/knowledge`, label: 'Knowledge' },
    { href: `/projects/${projectId}/mcp-tools`, label: 'MCP Tools' },
    { href: `/projects/${projectId}/playground`, label: 'Playground', active: true },
    { href: `/projects/${projectId}/settings`, label: 'Settings' },
  ]);

  // Update breadcrumb
  document.getElementById('breadcrumb-project')?.setAttribute('href', `/projects/${projectId}`);

  // Load NPCs into selector
  await loadNpcSelector(projectId);

  // Bind event handlers
  bindEventHandlers();

  // Load world context panel (project info, NPC roster, MCP tools)
  await loadContextPanel();

  // Graceful session end: fire a beacon to /api/session/:id/end when the page is closing.
  // sendBeacon works even if the browser tab closes abruptly or the JS event loop is blocked.
  function sendEndBeacon() {
    if (!currentSessionId) return;
    const url = `/api/session/${currentSessionId}/end`;
    const body = JSON.stringify({ exit_convo_used: false });
    try {
      navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
    } catch {
      // Beacon may not be available in all environments; silently fail
    }
  }

  // beforeunload: fires when the tab/window is about to close or navigate away.
  // sendBeacon guarantees delivery even when the page is unloading.
  window.addEventListener('beforeunload', () => {
    sendEndBeacon();
  });
}

async function loadNpcSelector(projectId) {
  const select = document.getElementById('npc-select');

  try {
    const data = await npcs.list(projectId);
    const npcList = data.npcs || [];

    select.innerHTML = `
      <option value="">Choose an NPC...</option>
      ${npcList.map((npc) => `<option value="${npc.id}">${escapeHtml(npc.name)}</option>`).join('')}
    `;
  } catch (error) {
    toast.error('Failed to Load NPCs', error.message);
  }
}

function bindEventHandlers() {
  // NPC selection
  let _npcSelectBusy = false;
  document.getElementById('npc-select')?.addEventListener('change', async (e) => {
    if (_npcSelectBusy) return;
    _npcSelectBusy = true;
    currentNpcId = e.target.value || null;
    const infoPanel = document.getElementById('npc-info-panel');
    const cyclesPanel = document.getElementById('cycles-panel');

    try {
      if (currentNpcId) {
        infoPanel.style.display = 'block';
        cyclesPanel.style.display = 'block';
        await loadNpcInfo(currentNpcId);
        updateCyclesPanel(); // Enable/disable based on session state
        await refreshMindPanel(); // Show NPC State panel with latest instance data
        await loadContextPanel(); // Refresh context panel with NPC knowledge tiers
      } else {
        infoPanel.style.display = 'none';
        cyclesPanel.style.display = 'none';
        const mindPanel = document.getElementById('npc-mind-panel');
        if (mindPanel) mindPanel.style.display = 'none';
      }
    } finally {
      _npcSelectBusy = false;
    }
  });

  // Start session
  document.getElementById('btn-start-session')?.addEventListener('click', handleStartSession);

  // End session
  document.getElementById('btn-end-session')?.addEventListener('click', handleEndSession);

  // Conversation mode selection (input/output row buttons)
  document.querySelectorAll('.mode-btn[data-mode-type]').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.modeType;
      const value = btn.dataset.modeValue;
      // Deactivate siblings in same group
      document.querySelectorAll(`.mode-btn[data-mode-type="${type}"]`).forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      // Update mode
      const inputVal = document.querySelector('.mode-btn[data-mode-type="input"].active')?.dataset.modeValue || 'text';
      const outputVal = document.querySelector('.mode-btn[data-mode-type="output"].active')?.dataset.modeValue || 'text';
      setConversationMode(inputVal, outputVal);
    });
  });

  // Mode toggle (legacy text/voice buttons in chat input area)
  document.querySelectorAll('.mode-btn[data-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setMode(btn.dataset.mode);
    });
  });

  // Custom task toggle
  document.getElementById('current-task')?.addEventListener('change', (e) => {
    const customInput = document.getElementById('custom-task');
    if (customInput) {
      customInput.style.display = e.target.value === 'custom' ? 'block' : 'none';
    }
  });

  // Text input
  document.getElementById('btn-send')?.addEventListener('click', handleSendMessage);
  document.getElementById('message-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  });

  // Voice input - toggle live voice mode
  document.getElementById('btn-voice-toggle')?.addEventListener('click', toggleLiveVoice);

  // Interrupt button
  document.getElementById('btn-voice-interrupt')?.addEventListener('click', handleVoiceInterrupt);

  // X-Ray toggle
  document.getElementById('btn-toggle-xray')?.addEventListener('click', () => {
    document.getElementById('xray-panel')?.classList.toggle('collapsed');
  });

  // Memory Cycles buttons
  document.getElementById('btn-daily-pulse')?.addEventListener('click', () => handleCycle('daily-pulse'));
  document.getElementById('btn-weekly-whisper')?.addEventListener('click', () => handleCycle('weekly-whisper'));
  document.getElementById('btn-persona-shift')?.addEventListener('click', () => handleCycle('persona-shift'));

  // Cycles info modal
  document.getElementById('btn-cycles-info')?.addEventListener('click', showCyclesInfoModal);

  // Mind viewer
  document.getElementById('btn-view-mind')?.addEventListener('click', showMindViewer);
}

async function loadNpcInfo(npcId) {
  try {
    const npc = await npcs.get(currentProjectId, npcId);
    document.getElementById('info-npc-name').textContent = npc.name;
    document.getElementById('info-npc-description').textContent = npc.description || 'No description';

    // Set sidebar avatar
    const avatarImg = document.getElementById('info-npc-avatar-img');
    const avatarInitials = document.getElementById('info-npc-avatar-initials');
    const avatarContainer = document.getElementById('info-npc-avatar');

    if (npc.profile_image && npc.profile_image.trim() !== '') {
      const src = (npc.profile_image.startsWith('http://') || npc.profile_image.startsWith('https://'))
        ? npc.profile_image
        : `/api/projects/${currentProjectId}/npcs/${npcId}/avatar`;
      avatarImg.src = src;
      avatarImg.alt = npc.name;
      avatarImg.style.display = 'block';
      avatarInitials.style.display = 'none';
      avatarContainer.style.background = '';
      avatarImg.onerror = () => {
        avatarImg.style.display = 'none';
        avatarInitials.style.display = 'flex';
        avatarInitials.textContent = npc.name.charAt(0).toUpperCase();
        avatarContainer.style.background = 'linear-gradient(135deg, var(--color-accent-primary), var(--color-accent-secondary))';
      };
    } else {
      avatarImg.style.display = 'none';
      avatarInitials.style.display = 'flex';
      avatarInitials.textContent = npc.name.charAt(0).toUpperCase();
      avatarContainer.style.background = 'linear-gradient(135deg, var(--color-accent-primary), var(--color-accent-secondary))';
    }

    // Enable/disable player name field based on NPC settings
    const playerNameField = document.getElementById('player-name');
    const playerCheckbox = document.getElementById('enable-player-recognition');

    if (playerNameField && playerCheckbox) {
      const supportsRecognition = npc.player_recognition?.reveal_player_identity !== false;
      playerNameField.disabled = !supportsRecognition;
      playerCheckbox.disabled = !supportsRecognition;

      if (!supportsRecognition) {
        playerNameField.placeholder = 'This NPC does not support player recognition';
        playerCheckbox.checked = false;
      } else {
        playerNameField.placeholder = 'Player Character Name (optional)';
      }
    }
  } catch (error) {
    console.error('Failed to load NPC info:', error);
  }
}

async function handleStartSession() {
  const playerId = 'test-player'; // Fixed player ID for playground
  const btn = document.getElementById('btn-start-session');

  if (!currentNpcId) {
    toast.warning('Select NPC', 'Please select an NPC first.');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';

  try {
    // Get mood from dropdown
    const moodKey = document.getElementById('starting-mood')?.value || 'neutral';
    const moodPreset = MOOD_PRESETS[moodKey] || MOOD_PRESETS.neutral;
    const { valence, arousal, dominance } = moodPreset;

    // Get task
    const taskSelect = document.getElementById('current-task')?.value || 'idle';
    const customTask = document.getElementById('custom-task')?.value || '';
    const task = taskSelect === 'custom' ? customTask : taskSelect;

    // Get player info if recognition is enabled
    const enableRecognition = document.getElementById('enable-player-recognition')?.checked;
    const playerName = document.getElementById('player-name')?.value?.trim();
    let playerInfo = null;

    if (enableRecognition && playerName) {
      playerInfo = {
        name: playerName,
      };
    }

    // Start session with player info and mode
    const result = await session.start(currentProjectId, currentNpcId, playerId, playerInfo, currentConversationMode);
    currentSessionId = result.session_id;

    // Fetch NPC data for avatar (may already be loaded in sidebar, but need it here for header/bubbles)
    let npc;
    try {
      npc = await npcs.get(currentProjectId, currentNpcId);
    } catch (e) {
      npc = { name: result.npc_name, profile_image: null, id: currentNpcId };
    }

    // Store NPC info for chat bubbles
    currentNpcInfo = { name: npc.name, profile_image: npc.profile_image, id: currentNpcId };

    // Update UI
    document.getElementById('npc-info-panel').style.display = 'none';
    document.getElementById('session-panel').style.display = 'block';
    document.getElementById('session-id-display').textContent = currentSessionId.slice(0, 12) + '...';
    document.getElementById('chat-input-area').style.display = 'block';
    document.getElementById('session-setup-panel').style.display = 'none';
    messageCount = 0;
    updateMessageCount();

    // Clear chat
    const messages = document.getElementById('chat-messages');
    messages.innerHTML = '';

    // Show and populate chat NPC header
    const chatHeader = document.getElementById('chat-npc-header');
    chatHeader.style.display = 'flex';
    document.getElementById('chat-header-name').textContent = npc.name;
    document.getElementById('chat-header-mood').textContent = `${moodPreset.emoji} ${moodPreset.label}`;

    const headerImg = document.getElementById('chat-header-avatar-img');
    const headerInitials = document.getElementById('chat-header-avatar-initials');
    const headerAvatar = document.getElementById('chat-header-avatar');
    if (npc.profile_image && npc.profile_image.trim() !== '') {
      const src = (npc.profile_image.startsWith('http://') || npc.profile_image.startsWith('https://'))
        ? npc.profile_image
        : `/api/projects/${currentProjectId}/npcs/${currentNpcId}/avatar`;
      headerImg.src = src;
      headerImg.alt = npc.name;
      headerImg.style.display = 'block';
      headerInitials.style.display = 'none';
      headerAvatar.style.background = '';
      headerImg.onerror = () => {
        headerImg.style.display = 'none';
        headerInitials.style.display = 'flex';
        headerInitials.textContent = npc.name.charAt(0).toUpperCase();
        headerAvatar.style.background = 'linear-gradient(135deg, var(--color-accent-primary), var(--color-accent-secondary))';
      };
    } else {
      headerImg.style.display = 'none';
      headerInitials.style.display = 'flex';
      headerInitials.textContent = npc.name.charAt(0).toUpperCase();
      headerAvatar.style.background = 'linear-gradient(135deg, var(--color-accent-primary), var(--color-accent-secondary))';
    }

    // Wire up end session button in header
    const btnEndHeader = document.getElementById('btn-end-session-header');
    // Remove old listener to avoid stacking
    btnEndHeader.replaceWith(btnEndHeader.cloneNode(true));
    document.getElementById('btn-end-session-header').addEventListener('click', () => handleEndSession());

    // Reset Mind panel for new session
    resetMindPanel();

    // Wire Chat / Mind tab switching
    wireChatTabs();

    // Add system message with context
    const taskLabel = taskSelect === 'custom' ? customTask : taskSelect.replace('_', ' ');
    addChatMessage('system', `Session started. You are now chatting with ${result.npc_name}. (Mood: ${moodPreset.label}, Task: ${taskLabel})`);

    // Update mood display
    updateMoodDisplay(valence, arousal, dominance);

    // Configure chat interface based on conversation mode
    configureChatInterface();

    // Connect WebSocket if ANY voice is involved (input OR output)
    if (currentConversationMode.input === 'voice' || currentConversationMode.output === 'voice') {
      await connectVoice();
    }

    // Update cycles panel (disable during session)
    updateCyclesPanel();

    toast.success('Session Started', `Connected to ${result.npc_name}`);
  } catch (error) {
    toast.error('Failed to Start Session', error.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span class="icon">▶</span> Start Session';
  }
}

async function handleEndSession(exitConvoUsed = false) {
  if (!currentSessionId) return;

  // Capture and clear session ID immediately to prevent double-triggers
  // (WS close auto-ends server-side, beacon + manual click = double call is expected)
  const sessionIdToEnd = currentSessionId;
  currentSessionId = null;

  try {
    // Stop live voice if active
    if (isVoiceActive) {
      stopLiveVoice();
    }

    // Stop any audio playback
    stopAudioPlayback();

    // End session — 404 means the server already ended it (WS cleanup), which is fine
    try {
      await session.end(sessionIdToEnd, exitConvoUsed);
    } catch (endErr) {
      if (endErr?.status !== 404) {
        // Real error — re-throw so outer catch can report it
        throw endErr;
      }
      // 404 = already ended by WS cleanup — continue with UI cleanup normally
    }

    // Disconnect voice if connected
    if (voiceClient) {
      voiceClient.close();
      voiceClient = null;
    }

    // Update UI
    document.getElementById('session-panel').style.display = 'none';
    document.getElementById('npc-info-panel').style.display = 'block';
    document.getElementById('chat-input-area').style.display = 'none';

    // Hide chat NPC header and mind panel
    const chatHeader = document.getElementById('chat-npc-header');
    if (chatHeader) chatHeader.style.display = 'none';
    const mindPanel = document.getElementById('mind-panel');
    if (mindPanel) mindPanel.style.display = 'none';
    const chatMessages = document.getElementById('chat-messages');
    if (chatMessages) chatMessages.style.display = 'flex';

    // Clear stored NPC info
    currentNpcInfo = null;

    // Show session setup panel again for next session
    const setupPanel = document.getElementById('session-setup-panel');
    if (setupPanel) setupPanel.style.display = 'block';

    // Reset chat interface (show mode toggle again for next session)
    resetChatInterface();

    // Add system message (only if not already shown by exit_convo)
    if (!exitConvoUsed) {
      addChatMessage('system', 'Session ended. State has been saved.');
    }

    currentSessionId = null;

    // Update cycles panel (enable after session ends)
    updateCyclesPanel();

    // Refresh inline NPC mind panel to show updated state
    await refreshMindPanel();

    toast.success('Session Ended', 'Conversation has been saved.');
  } catch (error) {
    toast.error('Failed to End Session', error.message);
  }
}

/**
 * Set conversation mode (input and output separately)
 */
function setConversationMode(input, output) {
  currentConversationMode = { input, output };

  // Update session-setup mode-row buttons
  document.querySelectorAll('.mode-btn[data-mode-type="input"]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.modeValue === input);
  });
  document.querySelectorAll('.mode-btn[data-mode-type="output"]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.modeValue === output);
  });

  // Update legacy mode buttons in chat input area to match input mode
  currentMode = input;
  document.querySelectorAll('.mode-btn[data-mode]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === input);
  });

  console.log('[Playground] Mode set:', currentConversationMode);
}

/**
 * Configure the chat interface based on current conversation mode
 * Called after session starts to set up correct input/output areas
 */
function configureChatInterface() {
  const { input, output } = currentConversationMode;

  const textInputContainer = document.getElementById('text-input-container');
  const voiceInputContainer = document.getElementById('voice-input-container');
  const inputModeToggle = document.querySelector('.input-mode-toggle');

  // Hide the legacy mode toggle buttons - mode is already selected
  if (inputModeToggle) {
    inputModeToggle.style.display = 'none';
  }

  // Configure INPUT area
  if (input === 'text') {
    if (textInputContainer) textInputContainer.style.display = 'flex';
    if (voiceInputContainer) voiceInputContainer.style.display = 'none';
    if (isVoiceActive) {
      stopLiveVoice();
    }
  } else {
    // Voice input
    if (textInputContainer) textInputContainer.style.display = 'none';
    if (voiceInputContainer) voiceInputContainer.style.display = 'flex';
  }

  // Update placeholder text based on output mode
  const messageInput = document.getElementById('message-input');
  if (messageInput) {
    if (output === 'voice') {
      messageInput.placeholder = 'Type a message... (NPC will respond with voice)';
    } else {
      messageInput.placeholder = 'Type a message...';
    }
  }

  // Update voice hint based on output mode
  const voiceHint = document.querySelector('.voice-hint');
  if (voiceHint) {
    if (output === 'voice') {
      voiceHint.textContent = 'Voice is live - speak naturally. NPC will respond with voice.';
    } else {
      voiceHint.textContent = 'Voice is live - speak naturally. NPC will respond with text.';
    }
  }

  console.log('[Playground] Chat interface configured for:', currentConversationMode);
}

/**
 * Reset chat interface to default state (for session end)
 */
function resetChatInterface() {
  const inputModeToggle = document.querySelector('.input-mode-toggle');
  const textInputContainer = document.getElementById('text-input-container');
  const voiceInputContainer = document.getElementById('voice-input-container');
  const messageInput = document.getElementById('message-input');
  const voiceHint = document.querySelector('.voice-hint');

  // Show mode toggle again (in case it was hidden)
  if (inputModeToggle) {
    inputModeToggle.style.display = 'flex';
  }

  // Reset to text input by default
  if (textInputContainer) textInputContainer.style.display = 'flex';
  if (voiceInputContainer) voiceInputContainer.style.display = 'none';

  // Reset placeholder text
  if (messageInput) {
    messageInput.placeholder = 'Type a message...';
  }

  // Reset voice hint
  if (voiceHint) {
    voiceHint.textContent = 'Voice is live - just speak naturally.';
  }

  console.log('[Playground] Chat interface reset');
}

/**
 * Legacy setMode function - updates conversation mode
 */
function setMode(mode) {
  // When using legacy buttons, keep output same as input
  setConversationMode(mode, mode);
}

async function handleSendMessage() {
  const input = document.getElementById('message-input');
  const content = input.value.trim();

  if (!content || !currentSessionId) return;

  input.value = '';
  input.disabled = true;
  document.getElementById('btn-send').disabled = true;

  // Add user message
  addChatMessage('user', content);
  messageCount++;
  updateMessageCount();

  // Update pipeline trace
  updatePipelineStep('security', 'active');

  try {
    // If output is voice, send through WebSocket for TTS response
    if (currentConversationMode.output === 'voice' && voiceClient && voiceClient.isReady()) {
      console.log('[Playground] Sending text via WebSocket for voice output');
      voiceClient.sendText(content);
      // Response will come through WebSocket events (textChunk, audioChunk, generationEnd)
      // Re-enable input immediately since WebSocket handles async response
      input.disabled = false;
      document.getElementById('btn-send').disabled = false;
      input.focus();
      return;
    }

    // Otherwise, use REST API for text response
    const response = await conversation.sendMessage(currentSessionId, content);

    updatePipelineStep('security', 'complete');
    updatePipelineStep('context', 'complete');
    updatePipelineStep('llm', 'complete');

    // Add speaker response (or combined if no follow-up)
    if (response.speaker_response) {
      addChatMessage('assistant', response.speaker_response);
    } else {
      addChatMessage('assistant', response.response);
    }
    messageCount++;
    updateMessageCount();

    // Show Mind activity (tool call chips) between speaker and follow-up
    if (response.mind?.tools_called?.length > 0) {
      addMindActivityDisplay(response.mind);
    }

    // Show follow-up response if Mind generated one
    if (response.followup_response) {
      addChatMessage('assistant', response.followup_response);
      messageCount++;
      updateMessageCount();
    }

    // Update mood
    if (response.mood) {
      updateMoodDisplay(response.mood.valence, response.mood.arousal, response.mood.dominance);
    }

    // Handle exit_convo (now via Mind)
    if (response.exit_convo) {
      addChatMessage('system', `NPC ended conversation: ${response.exit_convo.reason}`);
      setTimeout(async () => {
        try {
          await handleEndSession(true);
        } catch (error) {
          console.error('Auto-end session failed:', error);
        }
      }, 1000);
    }

    resetPipelineTrace();
  } catch (error) {
    toast.error('Failed to Send Message', error.message);
    addSecurityLog('error', error.message);
    resetPipelineTrace();
  } finally {
    input.disabled = false;
    document.getElementById('btn-send').disabled = false;
    input.focus();
  }
}

async function connectVoice() {
  console.log('[Playground] connectVoice() called');
  console.log('[Playground] Current session ID:', currentSessionId);

  if (!currentSessionId) {
    console.error('[Playground] No session ID - cannot connect voice');
    toast.error('No Session', 'Start a session first before enabling voice.');
    return;
  }

  try {
    updateVoiceStatus('Connecting...');
    const voiceToggleBtn = document.getElementById('btn-voice-toggle');
    if (voiceToggleBtn) voiceToggleBtn.disabled = true;
    const voiceStatusRow = document.getElementById('voice-status-row');
    if (voiceStatusRow) voiceStatusRow.style.display = 'none';
    console.log('[Playground] Creating VoiceClient with mode:', currentConversationMode);
    voiceClient = new VoiceClient(currentSessionId);

    voiceClient
      .on('ready', async (data) => {
        console.log('[Playground] Voice ready:', data);
        // Store voice config for audio playback (contains provider info for sample rate)
        currentVoiceConfig = data.voice_config;
        console.log('[Playground] Voice config:', currentVoiceConfig);
        console.log('[Playground] Server confirmed mode:', data.mode);
        updateVoiceStatus('');
        const readyBtn = document.getElementById('btn-voice-toggle');
        if (readyBtn) readyBtn.disabled = false;
        const interruptBtn = document.getElementById('btn-voice-interrupt');
        if (interruptBtn) interruptBtn.style.display = '';

        // Only auto-start live voice if input mode is voice
        if (currentConversationMode.input === 'voice') {
          await startLiveVoice();
        }
      })
      .on('transcript', (text, isFinal) => {
        updatePipelineStep('stt', isFinal ? 'complete' : 'active');

        if (isFinal && text.trim()) {
          // Accumulate finals — Deepgram may emit several is_final=true events
          // for one utterance (fragmented speech). Display consolidated on generationEnd.
          voiceUserTranscript += (voiceUserTranscript ? ' ' : '') + text.trim();
          console.log('[Transcript] Final segment accumulated:', JSON.stringify(text.trim()), '| total:', JSON.stringify(voiceUserTranscript));
          removeInterimTranscript();
        } else if (!isFinal && text.trim()) {
          // Show interim transcript as user is speaking
          showInterimTranscript(text);
        }
      })
      .on('textChunk', (text) => {
        updatePipelineStep('llm', 'active');
        if (isInFollowup) {
          followupBuffer += text;
        } else {
          responseBuffer += text;
        }
      })
      .on('audioChunk', (data) => {
        updatePipelineStep('tts', 'active');
        queueAudioChunk(data);
      })
      .on('toolCall', (name, args) => {
        console.log('[ToolCall] Received tool call:', name, args);
        addToolCallLog(name, args);
      })
      .on('mindActivity', (toolsCalled, durationMs, completed) => {
        console.log('[MindActivity] Tools called:', toolsCalled, 'Duration:', durationMs, 'Completed:', completed);
        addMindActivityDisplay({ tools_called: toolsCalled, duration_ms: durationMs, completed });
      })
      .on('followupStart', () => {
        console.log('[FollowupStart] Mind follow-up beginning');
        isInFollowup = true;
        followupBuffer = '';
        liveFollowupBubble = null;
      })
      .on('generationEnd', (phase) => {
        if (phase === 'speaker') {
          // Flush user transcript only in voice-input mode — text input already showed it
          if (voiceUserTranscript && currentConversationMode.input === 'voice') {
            addChatMessage('user', voiceUserTranscript);
            messageCount++;
            updateMessageCount();
            voiceUserTranscript = '';
          }
          if (responseBuffer) {
            addChatMessage('assistant', responseBuffer);
            messageCount++;
            updateMessageCount();
            responseBuffer = '';
          }
          // Don't reset pipeline -- Mind may still be working
          return;
        }

        if (phase === 'followup') {
          // Follow-up done -- flush follow-up buffer
          if (followupBuffer) {
            addChatMessage('assistant', followupBuffer);
            messageCount++;
            updateMessageCount();
            followupBuffer = '';
          }
          isInFollowup = false;
          resetPipelineTrace();
          return;
        }

        // No phase (backward compatible / Mind had no output)
        if (voiceUserTranscript && currentConversationMode.input === 'voice') {
          addChatMessage('user', voiceUserTranscript);
          messageCount++;
          updateMessageCount();
          voiceUserTranscript = '';
        }
        if (responseBuffer) {
          addChatMessage('assistant', responseBuffer);
          messageCount++;
          updateMessageCount();
          responseBuffer = '';
        }
        resetPipelineTrace();
      })
      .on('exitConvo', (reason, cooldown) => {
        addChatMessage('system', `NPC ended conversation: ${reason}`);
        if (cooldown) {
          addChatMessage('system', `Cooldown: ${cooldown} seconds`);
        }
      })
      .on('error', (code, message) => {
        console.error('[Playground] Voice error:', code, message);
        toast.error('Voice Error', message);
        addSecurityLog('error', `${code}: ${message}`);
        updateVoiceStatus('Error');
      })
      .on('close', () => {
        console.log('[Playground] Voice connection closed');
        updateVoiceStatus('Disconnected');
        voiceClient = null;
      });

    console.log('[Playground] Calling voiceClient.connect() with mode...');
    await voiceClient.connect(currentConversationMode);
    console.log('[Playground] voiceClient.connect() completed');
  } catch (error) {
    console.error('[Playground] connectVoice() error:', error);
    toast.error('Voice Connection Failed', error.message);
    updateVoiceStatus('Failed');
    voiceClient = null;
  }
}

/**
 * Toggle live voice mode on/off
 */
async function toggleLiveVoice() {
  console.log('[Playground] toggleLiveVoice() called');
  console.log('[Playground] isVoiceActive:', isVoiceActive);
  console.log('[Playground] voiceClient:', !!voiceClient);

  if (isVoiceActive) {
    stopLiveVoice();
  } else {
    await startLiveVoice();
  }
}

/**
 * Start live voice with Silero VAD (@ricky0123/vad-web)
 */
async function startLiveVoice() {
  console.log('[Playground] startLiveVoice() called');
  console.log('[Playground] voiceClient exists:', !!voiceClient);
  console.log('[Playground] voiceClient.isReady():', voiceClient?.isReady?.());

  if (!voiceClient || !voiceClient.isReady()) {
    console.warn('[Playground] VoiceClient not ready');
    toast.warning('Voice Not Connected', 'Please wait for voice connection.');
    return;
  }

  // Check if vad-web is loaded
  if (typeof vad === 'undefined') {
    console.error('[Playground] vad-web library not loaded');
    toast.error('VAD Not Available', 'Voice activity detection library failed to load.');
    return;
  }

  try {
    console.log('[Playground] Initializing Silero VAD...');
    updateVoiceStatus('Loading VAD model...');

    let audioChunkCount = 0;

    // Create MicVAD instance with Silero model
    micVAD = await vad.MicVAD.new({
      // Speech detection thresholds (Silero model outputs 0-1 probability)
      positiveSpeechThreshold: 0.5,  // Start speech when probability > 0.5
      negativeSpeechThreshold: 0.35, // End speech when probability < 0.35

      // Timing settings
      minSpeechFrames: 3,            // Min frames (30ms each) to confirm speech start
      redemptionFrames: 8,           // Frames of silence before ending speech (~240ms)
      preSpeechPadFrames: 1,         // Include 1 frame before speech start

      // Called when speech starts
      onSpeechStart: () => {
        console.log('[VAD] Speech started (Silero)');
        vadState.isSpeaking = true;
        updateVadIndicator(true);
        updatePipelineStep('stt', 'active');
        audioChunkCount = 0;
        // Reset accumulator for new utterance
        voiceUserTranscript = '';
      },

      // Called when speech ends - commit for STT processing
      onSpeechEnd: (audio) => {
        console.log('[VAD] Speech ended, total samples:', audio.length);
        vadState.isSpeaking = false;
        updateVadIndicator(false);

        // Check if voiceClient still exists (WebSocket may have closed)
        if (!voiceClient) {
          console.warn('[VAD] Speech ended but voiceClient is null, stopping VAD');
          stopLiveVoice();
          return;
        }

        // Note: Audio was already streamed via onFrameProcessed
        // Just commit to signal end of utterance
        voiceClient.commit();
        updateVoiceStatus('Processing...');
      },

      // Called for each frame - use for real-time streaming and visualization
      onFrameProcessed: (probabilities, frame) => {
        // Update visualizer with current audio frame
        if (frame) {
          updateVisualizer(frame);
        }

        // Stream audio while speaking (for real-time STT)
        if (vadState.isSpeaking && frame) {
          // Check if voiceClient still exists (WebSocket may have closed)
          if (!voiceClient) {
            console.warn('[VAD] Frame processed but voiceClient is null, stopping VAD');
            stopLiveVoice();
            return;
          }

          const pcm16 = float32ToPcm16(frame);
          const base64 = arrayBufferToBase64(pcm16.buffer);
          voiceClient.sendAudio(base64);
          audioChunkCount++;

          // Log every 50 chunks (~1.5 seconds at 30ms frames)
          if (audioChunkCount % 50 === 0) {
            console.log('[VAD] Streaming audio, chunks sent:', audioChunkCount, 'speech prob:', probabilities.isSpeech.toFixed(3));
          }
        }
      },
    });

    // Start the VAD
    await micVAD.start();
    isVoiceActive = true;

    // Update UI
    const btn = document.getElementById('btn-voice-toggle');
    btn?.classList.add('active');
    btn.querySelector('.label').textContent = 'Stop Voice';
    const statusRow = document.getElementById('voice-status-row');
    if (statusRow) statusRow.style.display = 'flex';
    updateVoiceStatus('');

    console.log('[Playground] Silero VAD started successfully');
    toast.success('Live Voice Active', 'Speak naturally - Silero VAD will detect your speech.');
  } catch (error) {
    console.error('[Playground] startLiveVoice() error:', error);

    if (error.name === 'NotAllowedError') {
      toast.error('Microphone Denied', 'Please allow microphone access in your browser.');
    } else if (error.name === 'NotFoundError') {
      toast.error('No Microphone', 'No microphone found on this device.');
    } else {
      toast.error('Microphone Error', error.message);
    }

    stopLiveVoice();
  }
}

/**
 * Stop live voice mode
 */
function stopLiveVoice() {
  isVoiceActive = false;

  // Reset VAD state
  vadState.isSpeaking = false;

  // Destroy micVAD instance (handles mic cleanup internally)
  if (micVAD) {
    micVAD.destroy();
    micVAD = null;
    console.log('[Playground] MicVAD destroyed');
  }

  // Update UI
  const btn = document.getElementById('btn-voice-toggle');
  btn?.classList.remove('active');
  btn.querySelector('.label').textContent = 'Start Live Voice';
  btn.disabled = false;
  const statusRow = document.getElementById('voice-status-row');
  if (statusRow) statusRow.style.display = 'none';
  const interruptBtn = document.getElementById('btn-voice-interrupt');
  if (interruptBtn) interruptBtn.style.display = 'none';
  updateVadIndicator(false);
  updateVoiceStatus('');
  resetPipelineTrace();
}

/**
 * Handle voice interrupt (stop NPC from speaking)
 */
function handleVoiceInterrupt() {
  if (voiceClient) {
    voiceClient.interrupt();
    stopAudioPlayback(); // Stop any audio currently playing
    toast.info('Interrupted', 'NPC speech stopped.');
  }
}

/**
 * Update VAD indicator UI
 */
function updateVadIndicator(speaking) {
  const indicator = document.getElementById('vad-indicator');
  const label = indicator?.querySelector('.vad-label');

  if (speaking) {
    indicator?.classList.add('speaking');
    if (label) label.textContent = 'Speaking';
    updateVoiceStatus('Listening...');
  } else {
    indicator?.classList.remove('speaking');
    if (label) label.textContent = 'Listening';
  }
}

function float32ToPcm16(float32Array) {
  const pcm16 = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return pcm16;
}

/**
 * Initialize AudioContext for playback
 */
function initAudioContext(sampleRate = 44100) {
  if (!audioContext || audioContext.state === 'closed') {
    audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate });
    console.log('[Audio] AudioContext created, sample rate:', audioContext.sampleRate);
  }
  // Resume if suspended (browser autoplay policy)
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
  return audioContext;
}

/**
 * Convert base64 PCM to Float32Array for Web Audio API
 */
function base64ToFloat32(base64, isFloat32 = false) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  if (isFloat32) {
    // Already float32, just create view
    return new Float32Array(bytes.buffer);
  } else {
    // PCM s16le - convert to float32
    const int16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768.0;
    }
    return float32;
  }
}

/**
 * Queue and play audio chunk
 */
function queueAudioChunk(base64Data) {
  if (!currentVoiceConfig) {
    console.warn('[Audio] No voice config, cannot determine sample rate');
    return;
  }

  // Determine sample rate based on provider
  // Cartesia: 44100 Hz, ElevenLabs: 16000 Hz
  const provider = currentVoiceConfig.provider || 'cartesia';
  const sampleRate = provider === 'elevenlabs' ? 16000 : 44100;

  // Initialize audio context with correct sample rate
  const ctx = initAudioContext(sampleRate);

  // Convert base64 PCM to float32
  const audioData = base64ToFloat32(base64Data, false);

  if (audioData.length === 0) {
    return;
  }

  // Create audio buffer
  const audioBuffer = ctx.createBuffer(1, audioData.length, sampleRate);
  audioBuffer.getChannelData(0).set(audioData);

  // Queue the buffer
  audioQueue.push(audioBuffer);

  // Start playback if not already playing
  if (!isPlayingAudio) {
    playNextInQueue();
  }
}

/**
 * Play next audio buffer in queue
 */
function playNextInQueue() {
  if (audioQueue.length === 0) {
    isPlayingAudio = false;
    currentAudioSource = null;
    return;
  }

  isPlayingAudio = true;
  const buffer = audioQueue.shift();

  const source = audioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(audioContext.destination);

  // Track current source for interruption
  currentAudioSource = source;

  source.onended = () => {
    if (currentAudioSource === source) {
      currentAudioSource = null;
    }
    playNextInQueue();
  };

  source.start(0);
}

/**
 * Stop all audio playback
 */
function stopAudioPlayback() {
  // Stop current playing source immediately
  if (currentAudioSource) {
    try {
      currentAudioSource.stop();
    } catch (e) {
      // Already stopped
    }
    currentAudioSource = null;
  }

  // Clear queue
  audioQueue = [];
  isPlayingAudio = false;

  // Close audio context
  if (audioContext && audioContext.state !== 'closed') {
    audioContext.close();
    audioContext = null;
  }

  console.log('[Audio] Playback interrupted and queue cleared');
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function updateVisualizer(audioData) {
  const bars = document.querySelectorAll('.visualizer-bars .bar');
  const samples = 5;
  const step = Math.floor(audioData.length / samples);

  bars.forEach((bar, i) => {
    let sum = 0;
    for (let j = 0; j < step; j++) {
      sum += Math.abs(audioData[i * step + j]);
    }
    const avg = sum / step;
    const height = Math.min(40, avg * 200);
    bar.style.height = `${Math.max(4, height)}px`;
  });
}

function addChatMessage(role, content) {
  const messages = document.getElementById('chat-messages');

  // Remove placeholder if present
  const placeholder = messages.querySelector('.chat-placeholder');
  if (placeholder) {
    placeholder.remove();
  }

  const messageEl = document.createElement('div');
  messageEl.className = `chat-message ${role}`;

  if (role === 'assistant' && currentNpcInfo) {
    // Inline avatar circle at the start of the message bubble
    const avatarDiv = document.createElement('div');
    avatarDiv.className = 'msg-avatar-inline';

    if (currentNpcInfo.profile_image && currentNpcInfo.profile_image.trim() !== '') {
      const img = document.createElement('img');
      img.src = (currentNpcInfo.profile_image.startsWith('http://') || currentNpcInfo.profile_image.startsWith('https://'))
        ? currentNpcInfo.profile_image
        : `/api/projects/${currentProjectId}/npcs/${currentNpcInfo.id}/avatar`;
      img.alt = currentNpcInfo.name;
      img.onerror = () => { img.remove(); avatarDiv.textContent = currentNpcInfo.name.charAt(0).toUpperCase(); };
      avatarDiv.appendChild(img);
    } else {
      avatarDiv.textContent = currentNpcInfo.name.charAt(0).toUpperCase();
    }

    const textSpan = document.createElement('span');
    textSpan.textContent = content;
    messageEl.classList.add('with-avatar');
    messageEl.appendChild(avatarDiv);
    messageEl.appendChild(textSpan);
  } else {
    messageEl.textContent = content;
  }

  messages.appendChild(messageEl);

  messages.scrollTop = messages.scrollHeight;
}

/**
 * Build a small avatar element for chat message rows
 */
function buildMiniAvatar(npc) {
  if (npc.profile_image && npc.profile_image.trim() !== '') {
    const src = (npc.profile_image.startsWith('http://') || npc.profile_image.startsWith('https://'))
      ? npc.profile_image
      : `/api/projects/${currentProjectId}/npcs/${npc.id}/avatar`;
    return `<div class="msg-avatar"><img src="${src}" alt="${escapeHtml(npc.name)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';"><span class="msg-avatar-fallback" style="display:none;">${escapeHtml(npc.name.charAt(0).toUpperCase())}</span></div>`;
  }
  return `<div class="msg-avatar msg-avatar-initials">${escapeHtml(npc.name.charAt(0).toUpperCase())}</div>`;
}

/**
 * Show interim (real-time) transcript while user is speaking
 * This gives visual feedback of what the STT is hearing
 */
function showInterimTranscript(text) {
  const messages = document.getElementById('chat-messages');

  // Remove placeholder if present
  const placeholder = messages.querySelector('.chat-placeholder');
  if (placeholder) {
    placeholder.remove();
  }

  // Find or create interim transcript element
  let interimEl = messages.querySelector('.chat-message.interim');

  if (!interimEl) {
    interimEl = document.createElement('div');
    interimEl.className = 'chat-message user interim';
    messages.appendChild(interimEl);
  }

  // Update with current interim text
  interimEl.innerHTML = `<span class="interim-text">${escapeHtml(text)}</span><span class="interim-indicator">...</span>`;
  messages.scrollTop = messages.scrollHeight;
}

/**
 * Remove interim transcript (called when final transcript is ready)
 */
function removeInterimTranscript() {
  const messages = document.getElementById('chat-messages');
  const interimEl = messages.querySelector('.chat-message.interim');

  if (interimEl) {
    interimEl.remove();
  }
}

function updateMessageCount() {
  document.getElementById('message-count').textContent = messageCount;
}

function updateMoodDisplay(valence, arousal, dominance) {
  const emoji = getMoodEmoji(valence, arousal);
  const label = getMoodLabel(valence, arousal, dominance);

  document.getElementById('current-mood-display').innerHTML = `
    <span class="mood-emoji">${emoji}</span>
    <span class="mood-label">${label}</span>
  `;
}

function updateVoiceStatus(status) {
  document.getElementById('voice-status').textContent = status;
}

function updatePipelineStep(step, state) {
  const stepEl = document.querySelector(`.trace-step[data-step="${step}"]`);
  if (stepEl) {
    stepEl.classList.remove('active', 'complete');
    if (state) {
      stepEl.classList.add(state);
    }
  }
}

function resetPipelineTrace() {
  document.querySelectorAll('.trace-step').forEach((el) => {
    el.classList.remove('active', 'complete');
  });
}

/**
 * Render an MCP tool call as a distinct chat bubble.
 * Uses a special .msg-tool-call style so it's clearly not a regular message.
 * exit_convo gets an extra .msg-tool-call--exit class for visual emphasis.
 */
function addToolCallLog(name, args) {
  const messages = document.getElementById('chat-messages');
  if (!messages) return;

  const isExit = name === 'exit_convo';
  const extraClass = isExit ? ' msg-tool-call--exit' : '';

  // Format args as pretty JSON, truncated for readability
  let argsText = '';
  try {
    argsText = JSON.stringify(args || {}, null, 2);
    if (argsText.length > 300) {
      argsText = argsText.substring(0, 300) + '\n...}';
    }
  } catch {
    argsText = String(args || '{}');
  }

  const div = document.createElement('div');
  div.className = `msg msg-tool-call${extraClass}`;
  div.innerHTML = `
    <div class="msg-tool-call-header">
      <span class="msg-tool-call-icon">${isExit ? '⛔' : '⚙'}</span>
      <span class="msg-tool-call-name">${escapeHtml(name)}</span>
      <span class="msg-tool-call-label">${isExit ? 'Conversation Ending Tool' : 'MCP Tool Call'}</span>
    </div>
    <pre class="msg-tool-call-args">${escapeHtml(argsText)}</pre>
  `;

  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

/**
 * Add a Mind turn entry to the Mind panel tab.
 * Replaces the old inline chat-bubble approach.
 * @param {Object} mindActivity - { tools_called: [{name, args, status}], duration_ms, completed }
 */
function addMindActivityDisplay(mindActivity) {
  if (!mindActivity?.tools_called?.length) return;

  const entriesEl = document.getElementById('mind-panel-entries');
  const emptyEl = document.getElementById('mind-panel-empty');
  const badge = document.getElementById('mind-tab-badge');
  if (!entriesEl) return;

  // Hide empty state
  if (emptyEl) emptyEl.style.display = 'none';

  mindTurnCount++;

  // Update badge (only show when on Chat tab so user knows Mind fired)
  if (badge) {
    badge.textContent = mindTurnCount;
    badge.style.display = activeChatTab === 'chat' ? 'inline-block' : 'none';
  }

  const isCompleted = mindActivity.completed !== false;
  const durationLabel = mindActivity.duration_ms ? `${mindActivity.duration_ms}ms` : '';
  const statusClass = isCompleted ? 'status-ok' : 'status-partial';
  const statusLabel = isCompleted ? 'ok' : 'partial';

  const toolRows = mindActivity.tools_called.map(tc => {
    const isExit = tc.name === 'exit_convo';
    const hasError = tc.status === 'error';
    const icon = isExit ? '&#x26D4;' : (hasError ? '&#x26A0;' : '&#x2713;');
    const nameClass = hasError ? 'mind-tool-name tool-error' : 'mind-tool-name';

    // Show arg key: value pairs, truncated
    const args = tc.args || {};
    const argParts = Object.entries(args).map(([k, v]) =>
      `${escapeHtml(k)}: ${escapeHtml(String(v).substring(0, 50))}`
    );
    const argLine = argParts.length > 0
      ? `<div class="mind-tool-arg">${argParts.join(' &nbsp;|&nbsp; ')}</div>`
      : '';
    const errorLine = hasError && tc.error
      ? `<div class="mind-tool-error-msg">${escapeHtml(tc.error)}</div>`
      : '';

    return `<div class="mind-tool-row">
      <span class="mind-tool-icon">${icon}</span>
      <div class="mind-tool-body">
        <span class="${nameClass}">${escapeHtml(tc.name)}</span>
        ${argLine}
        ${errorLine}
      </div>
    </div>`;
  }).join('');

  const entry = document.createElement('div');
  entry.className = 'mind-entry';
  entry.innerHTML = `
    <div class="mind-entry-header">
      <span class="mind-entry-label">Turn ${mindTurnCount}</span>
      <span class="mind-entry-status ${statusClass}">${statusLabel}</span>
      <span class="mind-entry-meta">${escapeHtml(durationLabel)}</span>
    </div>
    <div class="mind-entry-tools">${toolRows}</div>
  `;

  entriesEl.appendChild(entry);

  // Auto-scroll mind panel if it's visible
  const panel = document.getElementById('mind-panel');
  if (panel && panel.style.display !== 'none') {
    panel.scrollTop = panel.scrollHeight;
  }
}

/**
 * Reset the Mind panel to empty state for a new session.
 */
function resetMindPanel() {
  mindTurnCount = 0;
  activeChatTab = 'chat';

  const entriesEl = document.getElementById('mind-panel-entries');
  const emptyEl = document.getElementById('mind-panel-empty');
  const badge = document.getElementById('mind-tab-badge');
  const panel = document.getElementById('mind-panel');
  const chatMessages = document.getElementById('chat-messages');

  if (entriesEl) entriesEl.innerHTML = '';
  if (emptyEl) emptyEl.style.display = 'block';
  if (badge) { badge.textContent = ''; badge.style.display = 'none'; }
  if (panel) panel.style.display = 'none';
  if (chatMessages) chatMessages.style.display = 'flex';

  // Reset tab buttons
  document.getElementById('tab-chat')?.classList.add('active');
  document.getElementById('tab-mind')?.classList.remove('active');
}

/**
 * Wire the Chat / Mind tab buttons.
 * Uses replaceWith to clear any stale listeners from previous sessions.
 */
function wireChatTabs() {
  ['tab-chat', 'tab-mind'].forEach(id => {
    const btn = document.getElementById(id);
    if (!btn) return;
    const fresh = btn.cloneNode(true);
    btn.replaceWith(fresh);
  });

  document.getElementById('tab-chat')?.addEventListener('click', () => switchChatTab('chat'));
  document.getElementById('tab-mind')?.addEventListener('click', () => switchChatTab('mind'));
}

/**
 * Switch between Chat and Mind tabs.
 * @param {'chat'|'mind'} tab
 */
function switchChatTab(tab) {
  activeChatTab = tab;

  const chatMessages = document.getElementById('chat-messages');
  const chatInput = document.getElementById('chat-input-area');
  const mindPanel = document.getElementById('mind-panel');
  const badge = document.getElementById('mind-tab-badge');

  document.getElementById('tab-chat')?.classList.toggle('active', tab === 'chat');
  document.getElementById('tab-mind')?.classList.toggle('active', tab === 'mind');

  if (tab === 'chat') {
    if (chatMessages) chatMessages.style.display = 'flex';
    if (chatInput) chatInput.style.display = 'block';
    if (mindPanel) mindPanel.style.display = 'none';
  } else {
    if (chatMessages) chatMessages.style.display = 'none';
    if (chatInput) chatInput.style.display = 'none';
    if (mindPanel) mindPanel.style.display = 'flex';
    // Clear badge when user opens Mind tab
    if (badge) badge.style.display = 'none';
    // Scroll to bottom of mind panel
    if (mindPanel) mindPanel.scrollTop = mindPanel.scrollHeight;
  }
}

function addSecurityLog(_type, _message) {
  // Security logging removed — panel replaced with World Context
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

// ========================================
// Memory Cycles & Mind Viewer Functions
// ========================================

/**
 * Update cycles panel - enable/disable buttons based on session state
 */
function updateCyclesPanel() {
  const hasSession = !!currentSessionId;
  const hasNpc = !!currentNpcId;

  // Cycles only work when NO active session
  const cyclesEnabled = hasNpc && !hasSession;

  document.getElementById('btn-daily-pulse').disabled = !cyclesEnabled;
  document.getElementById('btn-weekly-whisper').disabled = !cyclesEnabled;
  document.getElementById('btn-persona-shift').disabled = !cyclesEnabled;
  document.getElementById('btn-view-mind').disabled = !hasNpc;

  // Update hint text
  const hint = document.querySelector('.cycles-hint');
  if (hint) {
    hint.textContent = hasSession
      ? 'End session to run cycles'
      : 'Run between sessions only';
  }

  // Hide mind panel when no NPC selected or session is starting
  if (!hasNpc) {
    const mindPanel = document.getElementById('npc-mind-panel');
    if (mindPanel) mindPanel.style.display = 'none';
  }
}

/**
 * Handle running a memory cycle
 */
async function handleCycle(cycleType) {
  if (!currentNpcId || !currentProjectId) {
    toast.warning('No NPC Selected', 'Please select an NPC first.');
    return;
  }

  if (currentSessionId) {
    toast.warning('Session Active', 'End the current session before running memory cycles.');
    return;
  }

  const playerId = 'test-player';
  const btn = document.getElementById(`btn-${cycleType}`);

  btn.classList.add('loading');
  btn.disabled = true;

  try {
    // Get or create instance first
    const instance = await session.getInstance(currentProjectId, currentNpcId, playerId);
    currentInstanceId = instance.id;

    let result;
    switch (cycleType) {
      case 'daily-pulse':
        result = await cycles.dailyPulse(instance.id);
        toast.success('Daily Pulse Complete', `Mood updated: ${getMoodLabel(result.newMood?.valence, result.newMood?.arousal, result.newMood?.dominance)}`);
        break;
      case 'weekly-whisper':
        result = await cycles.weeklyWhisper(instance.id);
        toast.success('Weekly Whisper Complete', `Retained ${result.memoriesRetained || 0} memories, promoted ${result.memoriesPromoted || 0} to long-term`);
        break;
      case 'persona-shift':
        result = await cycles.personaShift(instance.id);
        toast.success('Persona Shift Complete', 'Traits have been adjusted based on experiences');
        break;
    }

    console.log(`[Playground] ${cycleType} result:`, result);

    // Refresh inline mind panel and modal if open
    await refreshMindPanel();
    if (mindModalInstance) {
      const updatedInstance = await session.getInstance(currentProjectId, currentNpcId, 'test-player');
      const bodyEl = mindModalInstance.el?.querySelector('.modal-body');
      if (bodyEl) bodyEl.innerHTML = renderMindViewerContent(updatedInstance);
    }
  } catch (error) {
    console.error(`[Playground] ${cycleType} error:`, error);
    toast.error('Cycle Failed', error.message);
  } finally {
    btn.classList.remove('loading');
    updateCyclesPanel();
  }
}

/**
 * Show cycles info modal
 */
function showCyclesInfoModal() {
  const content = `
    <div class="cycles-info-content">
      <p>Memory Cycles permanently modify NPC state. Run these between sessions, not during active conversations.</p>

      <div class="cycles-info-list">
        <div class="cycles-info-item">
          <span class="cycles-info-icon">◑</span>
          <div class="cycles-info-text">
            <h4>Daily Pulse</h4>
            <p>Captures mood baseline and a single-sentence takeaway from recent interactions. Updates the NPC's emotional state.</p>
          </div>
        </div>

        <div class="cycles-info-item">
          <span class="cycles-info-icon">◔</span>
          <div class="cycles-info-text">
            <h4>Weekly Whisper</h4>
            <p>Consolidates short-term memories into long-term storage. Prunes low-salience memories to keep the NPC's mind focused.</p>
          </div>
        </div>

        <div class="cycles-info-item">
          <span class="cycles-info-icon">◇</span>
          <div class="cycles-info-text">
            <h4>Persona Shift</h4>
            <p>Recalibrates personality traits based on accumulated experiences. Can modify relationships and behavioral tendencies.</p>
          </div>
        </div>
      </div>
    </div>
  `;

  modal.open({ title: 'Memory Cycles', content });
}

/**
 * Show NPC Mind Viewer modal
 */
/**
 * Refresh the inline NPC mind summary panel in the sidebar
 */
async function refreshMindPanel() {
  if (!currentNpcId || !currentProjectId) return;

  const panel = document.getElementById('npc-mind-panel');
  const summaryEl = document.getElementById('mind-summary-content');
  const viewBtn = document.getElementById('btn-view-mind');
  if (!panel || !summaryEl) return;

  try {
    const instance = await session.getInstance(currentProjectId, currentNpcId, 'test-player');
    currentInstanceId = instance.id;

    const mood = instance.current_mood || { valence: 0.5, arousal: 0.5, dominance: 0.5 };
    const stmCount = (instance.short_term_memory || []).length;
    const ltmCount = (instance.long_term_memory || []).length;
    const latestMem = (instance.short_term_memory || []).slice(-1)[0];
    const takeaway = instance.daily_pulse?.takeaway;
    const moodLabel = getMoodLabel(mood.valence, mood.arousal, mood.dominance);
    const moodEmoji = getMoodEmoji(mood.valence, mood.arousal, mood.dominance);

    summaryEl.innerHTML = `
      <div class="mind-stat-row">
        <span class="mind-stat-label">Mood</span>
        <span class="mind-stat-value">${moodEmoji} ${moodLabel} <span class="mind-stat-sub">(${mood.valence.toFixed(2)})</span></span>
      </div>
      <div class="mind-stat-row">
        <span class="mind-stat-label">Memory</span>
        <span class="mind-stat-value">STM: ${stmCount} &nbsp;|&nbsp; LTM: ${ltmCount}</span>
      </div>
      ${latestMem ? `
      <div class="mind-latest-memory">
        <span class="mind-stat-label">Latest memory</span>
        <p class="mind-memory-snippet">${escapeHtml(latestMem.content.slice(0, 90))}${latestMem.content.length > 90 ? '...' : ''}</p>
      </div>` : ''}
      ${takeaway ? `
      <div class="mind-latest-memory">
        <span class="mind-stat-label">Daily pulse</span>
        <p class="mind-memory-snippet mind-takeaway">${escapeHtml(takeaway)}</p>
      </div>` : ''}
    `;

    panel.style.display = 'block';
    if (viewBtn) viewBtn.disabled = false;
  } catch (error) {
    console.warn('[Playground] Failed to refresh mind panel:', error);
  }
}

/**
 * Load the World Context panel with project, NPC roster, knowledge tiers, and MCP tools.
 * Called when a project loads and again when an NPC is selected.
 */
async function loadContextPanel() {
  if (!currentProjectId) return;

  // Project section
  const projectEl = document.getElementById('ctx-project-info');
  const npcListEl = document.getElementById('ctx-npc-list');
  const knowledgeEl = document.getElementById('ctx-knowledge-list');
  const mcpEl = document.getElementById('ctx-mcp-list');

  try {
    const project = await projects.get(currentProjectId);
    if (projectEl) {
      const provider = project.settings?.llm_provider || 'default';
      const model = project.settings?.llm_model || '';
      projectEl.innerHTML = `
        <div class="ctx-item">
          <span class="ctx-item-name">${escapeHtml(project.name)}</span>
          <p class="ctx-item-desc">LLM: ${escapeHtml(provider)}${model ? ` / ${escapeHtml(model)}` : ''}</p>
        </div>
      `;
    }
  } catch {
    if (projectEl) projectEl.innerHTML = '<p class="log-empty">Could not load project</p>';
  }

  // NPC roster — response shape: { npcs: [...] }
  try {
    const data = await npcs.list(currentProjectId);
    const npcArray = data?.npcs || [];
    if (npcListEl) {
      if (!npcArray.length) {
        npcListEl.innerHTML = '<p class="log-empty">No NPCs in this project</p>';
      } else {
        npcListEl.innerHTML = npcArray.map(npc => `
          <div class="ctx-item ${npc.id === currentNpcId ? 'ctx-item-active' : ''}">
            <span class="ctx-item-name">${escapeHtml(npc.name)}${npc.core_anchor?.role ? `<span class="ctx-item-badge">${escapeHtml(npc.core_anchor.role)}</span>` : ''}</span>
          </div>
        `).join('');
      }
    }
  } catch {
    if (npcListEl) npcListEl.innerHTML = '<p class="log-empty">Could not load NPCs</p>';
  }

  // MCP tools — response shape: { conversation_tools: [...], game_event_tools: [...] }
  try {
    const toolsData = await mcpTools.get(currentProjectId);
    const convTools = toolsData?.conversation_tools || [];
    const gameTools = toolsData?.game_event_tools || [];
    const allTools = [...convTools, ...gameTools];
    if (mcpEl) {
      if (!allTools.length) {
        mcpEl.innerHTML = '<p class="log-empty">No MCP tools configured</p>';
      } else {
        const convSection = convTools.length ? `<p class="ctx-item-desc" style="font-weight:500;margin:0 0 2px;">Conversation (${convTools.length})</p>${convTools.map(t => `<div class="ctx-item" style="padding:var(--space-2) 0"><span class="ctx-item-name">${escapeHtml(t.name)}</span>${t.description ? `<p class="ctx-item-desc">${escapeHtml(t.description)}</p>` : ''}</div>`).join('')}` : '';
        const gameSection = gameTools.length ? `<p class="ctx-item-desc" style="font-weight:500;margin:var(--space-3) 0 2px;">Game Events (${gameTools.length})</p>${gameTools.map(t => `<div class="ctx-item" style="padding:var(--space-2) 0"><span class="ctx-item-name">${escapeHtml(t.name)}</span>${t.description ? `<p class="ctx-item-desc">${escapeHtml(t.description)}</p>` : ''}</div>`).join('')}` : '';
        mcpEl.innerHTML = convSection + gameSection;
      }
    }
  } catch {
    if (mcpEl) mcpEl.innerHTML = '<p class="log-empty">No MCP tools configured</p>';
  }

  // Knowledge tiers — only when an NPC is selected
  if (currentNpcId) {
    await loadKnowledgeContext();
  }
}

async function loadKnowledgeContext() {
  const knowledgeEl = document.getElementById('ctx-knowledge-list');
  if (!knowledgeEl || !currentProjectId) return;

  try {
    // Response shape: { categories: Record<string, { id, description, depths: {0,1,2,...} }> }
    const kb = await knowledge.get(currentProjectId);
    const categories = kb?.categories ? Object.values(kb.categories) : [];
    if (!categories.length) {
      knowledgeEl.innerHTML = '<p class="log-empty">No knowledge configured</p>';
    } else {
      knowledgeEl.innerHTML = categories.map(cat => {
        const tierCount = cat.depths ? Object.keys(cat.depths).length : 0;
        return `
          <div class="ctx-item">
            <span class="ctx-item-name">${escapeHtml(cat.id)}<span class="ctx-item-badge">${tierCount} tier${tierCount !== 1 ? 's' : ''}</span></span>
            ${cat.description ? `<p class="ctx-item-desc">${escapeHtml(cat.description)}</p>` : ''}
          </div>
        `;
      }).join('');
    }
  } catch {
    knowledgeEl.innerHTML = '<p class="log-empty">Could not load knowledge</p>';
  }
}

async function showMindViewer() {
  if (!currentNpcId || !currentProjectId) {
    toast.warning('No NPC Selected', 'Please select an NPC first.');
    return;
  }

  try {
    const instance = await session.getInstance(currentProjectId, currentNpcId, 'test-player');
    currentInstanceId = instance.id;

    const content = renderMindViewerContent(instance);
    const footer = document.createElement('div');
    footer.innerHTML = `<button class="btn btn-ghost btn-sm" id="btn-mind-refresh">Refresh</button>`;

    mindModalInstance = modal.open({
      title: 'NPC Mind Viewer',
      content,
      footer,
      size: 'large',
      onClose: () => { mindModalInstance = null; },
    });

    footer.querySelector('#btn-mind-refresh')?.addEventListener('click', async () => {
      try {
        const fresh = await session.getInstance(currentProjectId, currentNpcId, 'test-player');
        const bodyEl = mindModalInstance?.el?.querySelector('.modal-body');
        if (bodyEl) bodyEl.innerHTML = renderMindViewerContent(fresh);
      } catch (err) {
        toast.error('Refresh Failed', err.message);
      }
    });
  } catch (error) {
    console.error('[Playground] Mind viewer error:', error);
    toast.error('Failed to Load', error.message);
  }
}

/**
 * Render mind viewer modal content
 */
function renderMindViewerContent(instance) {
  const mood = instance.current_mood || { valence: 0.5, arousal: 0.5, dominance: 0.5 };
  const traitMods = instance.trait_modifiers || {};
  const shortMem = instance.short_term_memory || [];
  const longMem = instance.long_term_memory || [];
  const relationships = instance.relationships || {};
  const cycleMeta = instance.cycle_metadata || {};
  const moodLabel = getMoodLabel(mood.valence, mood.arousal, mood.dominance);
  const moodEmoji = getMoodEmoji(mood.valence, mood.arousal, mood.dominance);

  // Daily pulse takeaway — shown prominently at the top if available
  const takeawayHtml = instance.daily_pulse?.takeaway ? `
    <div class="mind-takeaway-banner">
      <span class="mind-takeaway-icon">◑</span>
      <blockquote class="daily-pulse-quote">${escapeHtml(instance.daily_pulse.takeaway)}</blockquote>
      <span class="mind-takeaway-meta">Daily Pulse — ${formatTimestamp(instance.daily_pulse.timestamp)}</span>
    </div>
  ` : '';

  // Mood section
  const moodHtml = `
    <div class="mind-section">
      <h4>Current Mood <span class="mind-section-badge">${moodEmoji} ${moodLabel}</span></h4>
      <div class="mood-bars">
        <div class="mood-bar">
          <span class="mood-bar-label">Valence</span>
          <div class="mood-bar-track">
            <div class="mood-bar-fill valence" style="width: ${mood.valence * 100}%"></div>
          </div>
          <span class="mood-bar-value">${mood.valence.toFixed(2)}</span>
        </div>
        <div class="mood-bar">
          <span class="mood-bar-label">Arousal</span>
          <div class="mood-bar-track">
            <div class="mood-bar-fill arousal" style="width: ${mood.arousal * 100}%"></div>
          </div>
          <span class="mood-bar-value">${mood.arousal.toFixed(2)}</span>
        </div>
        <div class="mood-bar">
          <span class="mood-bar-label">Dominance</span>
          <div class="mood-bar-track">
            <div class="mood-bar-fill dominance" style="width: ${mood.dominance * 100}%"></div>
          </div>
          <span class="mood-bar-value">${mood.dominance.toFixed(2)}</span>
        </div>
      </div>
    </div>
  `;

  // Trait modifiers section
  const traitModsEntries = Object.entries(traitMods);
  const traitModsHtml = `
    <div class="mind-section">
      <h4>Trait Modifiers <span class="mind-section-badge">${traitModsEntries.length} active</span></h4>
      ${traitModsEntries.length > 0 ? `
        <div class="trait-modifiers-list">
          ${traitModsEntries.map(([trait, value]) => `
            <span class="trait-modifier ${value >= 0 ? 'positive' : 'negative'}">
              ${trait}: ${value >= 0 ? '+' : ''}${Number(value).toFixed(2)}
            </span>
          `).join('')}
        </div>
      ` : '<p class="trait-modifier-empty">No active modifiers — run Persona Shift to develop traits</p>'}
    </div>
  `;

  // Memory renderer (shared for STM and LTM)
  const renderMemories = (mems) => mems.map(mem => `
    <div class="memory-item">
      <div class="memory-item-content">${escapeHtml(mem.content)}</div>
      <div class="memory-item-meta">
        <span>${formatTimestamp(mem.timestamp)}</span>
        <span class="memory-item-salience">
          <span class="salience-bar"><span class="salience-fill" style="width: ${(mem.salience || 0.5) * 100}%"></span></span>
          <span class="salience-value">${((mem.salience || 0.5) * 100).toFixed(0)}%</span>
        </span>
      </div>
    </div>
  `).join('');

  // Short-term memory section
  const shortMemHtml = `
    <div class="mind-section mind-section-memory">
      <h4>Short-Term Memory <span class="mind-section-badge">${shortMem.length}</span></h4>
      ${shortMem.length > 0
      ? `<div class="memory-list">${renderMemories(shortMem)}</div>`
      : '<p class="memory-empty">No short-term memories — end a session to create one</p>'}
    </div>
  `;

  // Long-term memory section
  const longMemHtml = `
    <div class="mind-section mind-section-memory">
      <h4>Long-Term Memory <span class="mind-section-badge">${longMem.length}</span></h4>
      ${longMem.length > 0
      ? `<div class="memory-list">${renderMemories(longMem)}</div>`
      : '<p class="memory-empty">No long-term memories — run Weekly Whisper to promote memories</p>'}
    </div>
  `;

  // Relationships section
  const relationshipEntries = Object.entries(relationships);
  const relationshipsHtml = `
    <div class="mind-section">
      <h4>Relationships <span class="mind-section-badge">${relationshipEntries.length}</span></h4>
      ${relationshipEntries.length > 0 ? `
        <div class="relationships-list">
          ${relationshipEntries.map(([entityId, rel]) => `
            <div class="relationship-item">
              <span class="relationship-name">${escapeHtml(entityId)}</span>
              <div class="relationship-stats">
                <span class="relationship-stat">
                  <span class="relationship-stat-label">Trust</span>
                  <span class="salience-bar"><span class="salience-fill trust" style="width: ${(rel.trust || 0) * 100}%"></span></span>
                  ${(rel.trust || 0).toFixed(2)}
                </span>
                <span class="relationship-stat">
                  <span class="relationship-stat-label">Familiarity</span>
                  <span class="salience-bar"><span class="salience-fill familiarity" style="width: ${(rel.familiarity || 0) * 100}%"></span></span>
                  ${(rel.familiarity || 0).toFixed(2)}
                </span>
              </div>
            </div>
          `).join('')}
        </div>
      ` : '<p class="memory-empty">No relationships recorded</p>'}
    </div>
  `;

  // Cycle metadata section
  const cycleMetaHtml = `
    <div class="mind-section">
      <h4>Cycle History</h4>
      <div class="cycle-metadata-list">
        <div class="cycle-meta-item">
          <span class="cycle-meta-label">Daily Pulse</span>
          <span class="cycle-meta-value ${!instance.daily_pulse ? 'never' : ''}">
            ${instance.daily_pulse ? formatTimestamp(instance.daily_pulse.timestamp) : 'Never run'}
          </span>
        </div>
        <div class="cycle-meta-item">
          <span class="cycle-meta-label">Weekly Whisper</span>
          <span class="cycle-meta-value ${!cycleMeta.last_weekly ? 'never' : ''}">
            ${cycleMeta.last_weekly ? formatTimestamp(cycleMeta.last_weekly) : 'Never run'}
          </span>
        </div>
        <div class="cycle-meta-item">
          <span class="cycle-meta-label">Persona Shift</span>
          <span class="cycle-meta-value ${!cycleMeta.last_persona_shift ? 'never' : ''}">
            ${cycleMeta.last_persona_shift ? formatTimestamp(cycleMeta.last_persona_shift) : 'Never run'}
          </span>
        </div>
      </div>
    </div>
  `;

  return `
    <div class="mind-viewer-content">
      ${takeawayHtml}
      <div class="mind-viewer-grid">
        ${moodHtml}
        ${traitModsHtml}
        ${shortMemHtml}
        ${longMemHtml}
        ${relationshipsHtml}
        ${cycleMetaHtml}
      </div>
    </div>
  `;
}

/**
 * Format a timestamp for display
 */
function formatTimestamp(timestamp) {
  if (!timestamp) return 'Unknown';
  const date = new Date(timestamp);
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default { initPlaygroundPage };
