/**
 * Testing Playground Page Handler
 */

import { npcs, session, conversation, cycles, VoiceClient } from '../api.js';
import { toast, renderTemplate, updateNav, getMoodEmoji, getMoodLabel, modal } from '../components.js';
import { router } from '../router.js';

let currentProjectId = null;
let currentNpcId = null;
let currentSessionId = null;
let currentInstanceId = null; // For cycles - stored after session or fetched
let currentMode = 'text';
let voiceClient = null;
let isVoiceActive = false;
let micVAD = null; // @ricky0123/vad-web instance
let messageCount = 0;
let responseBuffer = '';

// Audio playback state
let audioContext = null;
let audioQueue = [];
let isPlayingAudio = false;
let currentVoiceConfig = null; // Stores sample rate from server
let currentAudioSource = null; // Track current playing source for interruption

// VAD state for UI updates
const vadState = {
  isSpeaking: false,
};

// Mood presets (VAD values: valence, arousal, dominance)
const MOOD_PRESETS = {
  neutral:  { valence: 0.5, arousal: 0.5, dominance: 0.5, emoji: '😐', label: 'Neutral' },
  happy:    { valence: 0.8, arousal: 0.6, dominance: 0.6, emoji: '😊', label: 'Happy' },
  sad:      { valence: 0.2, arousal: 0.3, dominance: 0.3, emoji: '😢', label: 'Sad' },
  angry:    { valence: 0.2, arousal: 0.8, dominance: 0.7, emoji: '😠', label: 'Angry' },
  fearful:  { valence: 0.2, arousal: 0.7, dominance: 0.2, emoji: '😨', label: 'Fearful' },
  excited:  { valence: 0.8, arousal: 0.9, dominance: 0.7, emoji: '🤩', label: 'Excited' },
  tired:    { valence: 0.4, arousal: 0.2, dominance: 0.3, emoji: '😴', label: 'Tired' },
  content:  { valence: 0.7, arousal: 0.3, dominance: 0.5, emoji: '😌', label: 'Content' },
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
  ]);

  // Update breadcrumb
  document.getElementById('breadcrumb-project')?.setAttribute('href', `/projects/${projectId}`);

  // Load NPCs into selector
  await loadNpcSelector(projectId);

  // Bind event handlers
  bindEventHandlers();
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
  document.getElementById('npc-select')?.addEventListener('change', async (e) => {
    currentNpcId = e.target.value || null;
    const infoPanel = document.getElementById('npc-info-panel');
    const cyclesPanel = document.getElementById('cycles-panel');

    if (currentNpcId) {
      infoPanel.style.display = 'block';
      cyclesPanel.style.display = 'block';
      await loadNpcInfo(currentNpcId);
      updateCyclesPanel(); // Enable/disable based on session state
    } else {
      infoPanel.style.display = 'none';
      cyclesPanel.style.display = 'none';
    }
  });

  // Start session
  document.getElementById('btn-start-session')?.addEventListener('click', handleStartSession);

  // End session
  document.getElementById('btn-end-session')?.addEventListener('click', handleEndSession);

  // Mode toggle
  document.querySelectorAll('.mode-btn').forEach((btn) => {
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
  } catch (error) {
    console.error('Failed to load NPC info:', error);
  }
}

async function handleStartSession() {
  const playerId = document.getElementById('player-id')?.value || 'test-player';
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

    // Start session (mood and task can be passed to server in the future)
    const result = await session.start(currentProjectId, currentNpcId, playerId);
    currentSessionId = result.session_id;

    // Update UI
    document.getElementById('npc-info-panel').style.display = 'none';
    document.getElementById('session-panel').style.display = 'block';
    document.getElementById('session-id-display').textContent = currentSessionId.slice(0, 12) + '...';
    document.getElementById('chat-input-area').style.display = 'block';
    messageCount = 0;
    updateMessageCount();

    // Clear chat
    const messages = document.getElementById('chat-messages');
    messages.innerHTML = '';

    // Add system message with context
    const taskLabel = taskSelect === 'custom' ? customTask : taskSelect.replace('_', ' ');
    addChatMessage('system', `Session started. You are now chatting with ${result.npc_name}. (Mood: ${moodPreset.label}, Task: ${taskLabel})`);

    // Update mood display
    updateMoodDisplay(valence, arousal, dominance);

    // If voice mode, connect WebSocket
    if (currentMode === 'voice') {
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

async function handleEndSession() {
  if (!currentSessionId) return;

  try {
    // Stop live voice if active
    if (isVoiceActive) {
      stopLiveVoice();
    }

    // Stop any audio playback
    stopAudioPlayback();

    // End session
    await session.end(currentSessionId);

    // Disconnect voice if connected
    if (voiceClient) {
      voiceClient.close();
      voiceClient = null;
    }

    // Update UI
    document.getElementById('session-panel').style.display = 'none';
    document.getElementById('npc-info-panel').style.display = 'block';
    document.getElementById('chat-input-area').style.display = 'none';

    // Add system message
    addChatMessage('system', 'Session ended. State has been saved.');

    currentSessionId = null;

    // Update cycles panel (enable after session ends)
    updateCyclesPanel();

    toast.success('Session Ended', 'Conversation has been saved.');
  } catch (error) {
    toast.error('Failed to End Session', error.message);
  }
}

function setMode(mode) {
  console.log('[Playground] setMode() called:', mode);
  currentMode = mode;

  // Update button states
  document.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  // Show/hide input containers
  document.getElementById('text-input-container').style.display = mode === 'text' ? 'flex' : 'none';
  document.getElementById('voice-input-container').style.display = mode === 'voice' ? 'flex' : 'none';

  // Connect voice if session active and switching to voice
  // FIX: Check if voice client is actually connected, not just exists
  if (mode === 'voice' && currentSessionId) {
    const needsConnection = !voiceClient ||
                            !voiceClient.ws ||
                            voiceClient.ws.readyState !== WebSocket.OPEN;

    console.log('[Playground] Voice mode selected, needs connection:', needsConnection);
    console.log('[Playground] voiceClient:', !!voiceClient);
    console.log('[Playground] ws readyState:', voiceClient?.ws?.readyState);

    if (needsConnection) {
      console.log('[Playground] Voice mode selected, connecting...');
      connectVoice();
    }
  }
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
    // Send message
    const response = await conversation.sendMessage(currentSessionId, content);

    // Update pipeline
    updatePipelineStep('security', 'complete');
    updatePipelineStep('context', 'complete');
    updatePipelineStep('llm', 'complete');

    // Add response
    addChatMessage('assistant', response.response);
    messageCount++;
    updateMessageCount();

    // Update mood
    if (response.mood) {
      updateMoodDisplay(response.mood.valence, response.mood.arousal, response.mood.dominance);
    }

    // Log tool calls
    if (response.tool_calls?.length > 0) {
      response.tool_calls.forEach((tc) => {
        addToolCallLog(tc.name, tc.arguments);
      });
    }

    // Handle exit_convo
    if (response.exit_convo) {
      addChatMessage('system', `NPC ended conversation: ${response.exit_convo.reason}`);
      if (response.exit_convo.cooldown_seconds) {
        addChatMessage('system', `Cooldown: ${response.exit_convo.cooldown_seconds} seconds`);
      }
    }

    // Reset pipeline
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
    console.log('[Playground] Creating VoiceClient...');
    voiceClient = new VoiceClient(currentSessionId);

    voiceClient
      .on('ready', async (data) => {
        console.log('[Playground] Voice ready:', data);
        // Store voice config for audio playback (contains provider info for sample rate)
        currentVoiceConfig = data.voice_config;
        console.log('[Playground] Voice config:', currentVoiceConfig);
        updateVoiceStatus('Connected');
        // Auto-start live voice after connection
        await startLiveVoice();
      })
      .on('transcript', (text, isFinal) => {
        updatePipelineStep('stt', isFinal ? 'complete' : 'active');
        if (isFinal && text.trim()) {
          addChatMessage('user', text);
          messageCount++;
          updateMessageCount();
        }
      })
      .on('textChunk', (text) => {
        updatePipelineStep('llm', 'active');
        responseBuffer += text;
      })
      .on('audioChunk', (data) => {
        updatePipelineStep('tts', 'active');
        // Play the audio chunk
        queueAudioChunk(data);
      })
      .on('toolCall', (name, args) => {
        addToolCallLog(name, args);
      })
      .on('generationEnd', () => {
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

    console.log('[Playground] Calling voiceClient.connect()...');
    await voiceClient.connect();
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
    updateVoiceStatus('Listening...');

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
  updateVadIndicator(false);
  updateVoiceStatus('Stopped');
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

  const durationMs = (audioData.length / sampleRate) * 1000;
  console.log(`[Audio] Queued: ${audioData.length} samples (${durationMs.toFixed(0)}ms), queue: ${audioQueue.length}`);

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
    console.log('[Audio] Queue empty, playback stopped');
    return;
  }

  isPlayingAudio = true;
  const buffer = audioQueue.shift();
  const durationMs = (buffer.length / buffer.sampleRate) * 1000;
  console.log(`[Audio] Playing: ${buffer.length} samples (${durationMs.toFixed(0)}ms), remaining: ${audioQueue.length}`);

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
  messageEl.textContent = content;

  messages.appendChild(messageEl);
  messages.scrollTop = messages.scrollHeight;
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

function addToolCallLog(name, args) {
  const log = document.getElementById('tool-calls-log');
  log.querySelector('.log-empty')?.remove();

  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML = `
    <span class="log-entry-time">${new Date().toLocaleTimeString()}</span>
    <span class="log-entry-content">${escapeHtml(name)}(${JSON.stringify(args).slice(0, 50)}...)</span>
  `;

  log.appendChild(entry);
  log.scrollTop = log.scrollHeight;
}

function addSecurityLog(type, message) {
  const log = document.getElementById('security-log');
  log.querySelector('.log-empty')?.remove();

  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.innerHTML = `
    <span class="log-entry-time">${new Date().toLocaleTimeString()}</span>
    <span class="log-entry-content">${escapeHtml(message)}</span>
  `;

  log.appendChild(entry);
  log.scrollTop = log.scrollHeight;
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

  const playerId = document.getElementById('player-id')?.value || 'test-player';
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
        toast.success('Daily Pulse Complete', `Mood updated: ${getMoodLabel(result.new_mood?.valence, result.new_mood?.arousal, result.new_mood?.dominance)}`);
        break;
      case 'weekly-whisper':
        result = await cycles.weeklyWhisper(instance.id);
        toast.success('Weekly Whisper Complete', `Consolidated ${result.consolidated_count || 0} memories`);
        break;
      case 'persona-shift':
        result = await cycles.personaShift(instance.id);
        toast.success('Persona Shift Complete', 'Traits have been adjusted based on experiences');
        break;
    }

    console.log(`[Playground] ${cycleType} result:`, result);
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
async function showMindViewer() {
  if (!currentNpcId || !currentProjectId) {
    toast.warning('No NPC Selected', 'Please select an NPC first.');
    return;
  }

  const playerId = document.getElementById('player-id')?.value || 'test-player';

  try {
    const instance = await session.getInstance(currentProjectId, currentNpcId, playerId);
    currentInstanceId = instance.id;

    const content = renderMindViewerContent(instance);
    modal.open({ title: 'NPC Mind Viewer', content, large: true });
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

  // Mood section
  const moodHtml = `
    <div class="mind-section">
      <h4><span class="icon">◐</span> Current Mood</h4>
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
      <h4><span class="icon">◈</span> Trait Modifiers</h4>
      ${traitModsEntries.length > 0 ? `
        <div class="trait-modifiers-list">
          ${traitModsEntries.map(([trait, value]) => `
            <span class="trait-modifier ${value >= 0 ? 'positive' : 'negative'}">
              ${trait}: ${value >= 0 ? '+' : ''}${value.toFixed(2)}
            </span>
          `).join('')}
        </div>
      ` : '<p class="trait-modifier-empty">No active modifiers</p>'}
    </div>
  `;

  // Short-term memory section
  const shortMemHtml = `
    <div class="mind-section">
      <h4><span class="icon">◔</span> Short-Term Memory (${shortMem.length})</h4>
      ${shortMem.length > 0 ? `
        <div class="memory-list">
          ${shortMem.slice(0, 5).map(mem => `
            <div class="memory-item">
              <div class="memory-item-content">${escapeHtml(mem.content)}</div>
              <div class="memory-item-meta">
                <span>${formatTimestamp(mem.timestamp)}</span>
                <span class="memory-item-salience">
                  Salience:
                  <span class="salience-bar">
                    <span class="salience-fill" style="width: ${(mem.salience || 0.5) * 100}%"></span>
                  </span>
                </span>
              </div>
            </div>
          `).join('')}
          ${shortMem.length > 5 ? `<p class="memory-empty">+ ${shortMem.length - 5} more...</p>` : ''}
        </div>
      ` : '<p class="memory-empty">No short-term memories</p>'}
    </div>
  `;

  // Long-term memory section
  const longMemHtml = `
    <div class="mind-section">
      <h4><span class="icon">◑</span> Long-Term Memory (${longMem.length})</h4>
      ${longMem.length > 0 ? `
        <div class="memory-list">
          ${longMem.slice(0, 5).map(mem => `
            <div class="memory-item">
              <div class="memory-item-content">${escapeHtml(mem.content)}</div>
              <div class="memory-item-meta">
                <span>${formatTimestamp(mem.timestamp)}</span>
                <span class="memory-item-salience">
                  Salience:
                  <span class="salience-bar">
                    <span class="salience-fill" style="width: ${(mem.salience || 0.5) * 100}%"></span>
                  </span>
                </span>
              </div>
            </div>
          `).join('')}
          ${longMem.length > 5 ? `<p class="memory-empty">+ ${longMem.length - 5} more...</p>` : ''}
        </div>
      ` : '<p class="memory-empty">No long-term memories</p>'}
    </div>
  `;

  // Relationships section
  const relationshipEntries = Object.entries(relationships);
  const relationshipsHtml = `
    <div class="mind-section">
      <h4><span class="icon">◇</span> Relationships (${relationshipEntries.length})</h4>
      ${relationshipEntries.length > 0 ? `
        <div class="relationships-list">
          ${relationshipEntries.map(([entityId, rel]) => `
            <div class="relationship-item">
              <span class="relationship-name">${escapeHtml(entityId)}</span>
              <div class="relationship-stats">
                <span class="relationship-stat">
                  <span class="relationship-stat-label">Trust:</span> ${(rel.trust || 0).toFixed(2)}
                </span>
                <span class="relationship-stat">
                  <span class="relationship-stat-label">Familiarity:</span> ${(rel.familiarity || 0).toFixed(2)}
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
      <h4><span class="icon">◐</span> Cycle History</h4>
      <div class="cycle-metadata-list">
        <div class="cycle-meta-item">
          <span class="cycle-meta-label">Last Daily Pulse</span>
          <span class="cycle-meta-value ${!instance.daily_pulse ? 'never' : ''}">
            ${instance.daily_pulse ? formatTimestamp(instance.daily_pulse.timestamp) : 'Never'}
          </span>
        </div>
        <div class="cycle-meta-item">
          <span class="cycle-meta-label">Last Weekly Whisper</span>
          <span class="cycle-meta-value ${!cycleMeta.last_weekly ? 'never' : ''}">
            ${cycleMeta.last_weekly ? formatTimestamp(cycleMeta.last_weekly) : 'Never'}
          </span>
        </div>
        <div class="cycle-meta-item">
          <span class="cycle-meta-label">Last Persona Shift</span>
          <span class="cycle-meta-value ${!cycleMeta.last_persona_shift ? 'never' : ''}">
            ${cycleMeta.last_persona_shift ? formatTimestamp(cycleMeta.last_persona_shift) : 'Never'}
          </span>
        </div>
      </div>
    </div>
  `;

  return `
    <div class="mind-viewer-content">
      ${moodHtml}
      ${traitModsHtml}
      ${shortMemHtml}
      ${longMemHtml}
      ${relationshipsHtml}
      ${cycleMetaHtml}
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
