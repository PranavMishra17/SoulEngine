/**
 * Testing Playground Page Handler
 */

import { npcs, session, conversation, VoiceClient } from '../api.js';
import { toast, renderTemplate, updateNav, getMoodEmoji, getMoodLabel } from '../components.js';
import { router } from '../router.js';

let currentProjectId = null;
let currentNpcId = null;
let currentSessionId = null;
let currentMode = 'text';
let voiceClient = null;
let isVoiceActive = false;
let audioContext = null;
let mediaStream = null;
let audioProcessor = null;
let audioSource = null;
let messageCount = 0;
let responseBuffer = '';

// VAD (Voice Activity Detection) state
const vadState = {
  isSpeaking: false,
  silenceStart: null,
  speechStart: null,
  energyThreshold: 0.015,     // Minimum energy to consider as speech
  silenceTimeout: 700,        // ms of silence before committing
  speechMinDuration: 150,     // ms of speech before we consider it valid
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

    if (currentNpcId) {
      infoPanel.style.display = 'block';
      await loadNpcInfo(currentNpcId);
    } else {
      infoPanel.style.display = 'none';
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
    toast.success('Session Ended', 'Conversation has been saved.');
  } catch (error) {
    toast.error('Failed to End Session', error.message);
  }
}

function setMode(mode) {
  currentMode = mode;

  // Update button states
  document.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  // Show/hide input containers
  document.getElementById('text-input-container').style.display = mode === 'text' ? 'flex' : 'none';
  document.getElementById('voice-input-container').style.display = mode === 'voice' ? 'flex' : 'none';

  // Connect voice if session active and switching to voice
  if (mode === 'voice' && currentSessionId && !voiceClient) {
    connectVoice();
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
  try {
    updateVoiceStatus('Connecting...');
    voiceClient = new VoiceClient(currentSessionId);

    voiceClient
      .on('ready', async (data) => {
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
        // Audio playback would go here
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
        toast.error('Voice Error', message);
        addSecurityLog('error', `${code}: ${message}`);
        updateVoiceStatus('Error');
      })
      .on('close', () => {
        updateVoiceStatus('Disconnected');
        voiceClient = null;
      });

    await voiceClient.connect();
  } catch (error) {
    toast.error('Voice Connection Failed', error.message);
    updateVoiceStatus('Failed');
    voiceClient = null;
  }
}

/**
 * Toggle live voice mode on/off
 */
async function toggleLiveVoice() {
  if (isVoiceActive) {
    stopLiveVoice();
  } else {
    await startLiveVoice();
  }
}

/**
 * Start live voice with VAD
 */
async function startLiveVoice() {
  if (!voiceClient) {
    toast.warning('Voice Not Connected', 'Please wait for voice connection.');
    return;
  }

  try {
    // Initialize audio context
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 16000,
      });
    }

    // Resume audio context if suspended (browser autoplay policy)
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    // Get microphone stream
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    // Create audio processing pipeline
    audioSource = audioContext.createMediaStreamSource(mediaStream);
    audioProcessor = audioContext.createScriptProcessor(4096, 1, 1);

    // Process audio with VAD
    audioProcessor.onaudioprocess = (e) => {
      if (!isVoiceActive) return;

      const inputData = e.inputBuffer.getChannelData(0);

      // Calculate energy level for VAD
      const energy = calculateEnergy(inputData);
      const isSpeech = energy > vadState.energyThreshold;
      const now = Date.now();

      // Update visualizer
      updateVisualizer(inputData);

      if (isSpeech) {
        // Speech detected
        if (!vadState.isSpeaking) {
          // Start of speech
          vadState.speechStart = now;
          vadState.silenceStart = null;
        }

        // Check if speech has been going long enough
        if (vadState.speechStart && (now - vadState.speechStart) > vadState.speechMinDuration) {
          if (!vadState.isSpeaking) {
            vadState.isSpeaking = true;
            updateVadIndicator(true);
            updatePipelineStep('stt', 'active');
          }

          // Send audio to server
          const pcm16 = float32ToPcm16(inputData);
          const base64 = arrayBufferToBase64(pcm16.buffer);
          voiceClient.sendAudio(base64);
        }
      } else {
        // Silence detected
        if (vadState.isSpeaking) {
          if (!vadState.silenceStart) {
            vadState.silenceStart = now;
          }

          // Still send audio during brief silence (might be mid-word pause)
          const pcm16 = float32ToPcm16(inputData);
          const base64 = arrayBufferToBase64(pcm16.buffer);
          voiceClient.sendAudio(base64);

          // Check if silence has lasted long enough to commit
          if ((now - vadState.silenceStart) > vadState.silenceTimeout) {
            // End of utterance - commit
            vadState.isSpeaking = false;
            vadState.speechStart = null;
            vadState.silenceStart = null;
            updateVadIndicator(false);
            voiceClient.commit();
            updateVoiceStatus('Processing...');
          }
        }
      }
    };

    audioSource.connect(audioProcessor);
    audioProcessor.connect(audioContext.destination);

    isVoiceActive = true;

    // Update UI
    const btn = document.getElementById('btn-voice-toggle');
    btn?.classList.add('active');
    btn.querySelector('.label').textContent = 'Stop Voice';
    updateVoiceStatus('Listening...');

    toast.success('Live Voice Active', 'Speak naturally - VAD will detect your speech.');
  } catch (error) {
    toast.error('Microphone Access Failed', error.message);
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
  vadState.speechStart = null;
  vadState.silenceStart = null;

  // Disconnect audio processing
  if (audioProcessor) {
    audioProcessor.disconnect();
    audioProcessor = null;
  }
  if (audioSource) {
    audioSource.disconnect();
    audioSource = null;
  }

  // Stop media stream
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
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
    toast.info('Interrupted', 'NPC speech stopped.');
  }
}

/**
 * Calculate RMS energy of audio buffer
 */
function calculateEnergy(audioData) {
  let sum = 0;
  for (let i = 0; i < audioData.length; i++) {
    sum += audioData[i] * audioData[i];
  }
  return Math.sqrt(sum / audioData.length);
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

export default { initPlaygroundPage };
