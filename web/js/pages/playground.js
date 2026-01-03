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
let isRecording = false;
let audioContext = null;
let mediaStream = null;
let messageCount = 0;
let responseBuffer = '';

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

  // Text input
  document.getElementById('btn-send')?.addEventListener('click', handleSendMessage);
  document.getElementById('message-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  });

  // Voice input
  document.getElementById('btn-voice-toggle')?.addEventListener('mousedown', startVoiceRecording);
  document.getElementById('btn-voice-toggle')?.addEventListener('mouseup', stopVoiceRecording);
  document.getElementById('btn-voice-toggle')?.addEventListener('mouseleave', stopVoiceRecording);
  document.getElementById('btn-voice-toggle')?.addEventListener('touchstart', startVoiceRecording);
  document.getElementById('btn-voice-toggle')?.addEventListener('touchend', stopVoiceRecording);

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
    // Get mood settings
    const valence = parseFloat(document.getElementById('mood-valence')?.value || 0.5);
    const arousal = parseFloat(document.getElementById('mood-arousal')?.value || 0.5);
    const dominance = parseFloat(document.getElementById('mood-dominance')?.value || 0.5);

    // Start session
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

    // Add system message
    addChatMessage('system', `Session started. You are now chatting with ${result.npc_name}.`);

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
      .on('ready', (data) => {
        updateVoiceStatus('Connected');
        toast.success('Voice Connected', 'Ready for voice conversation');
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

async function startVoiceRecording(e) {
  e.preventDefault();
  if (!voiceClient || isRecording) return;

  try {
    // Initialize audio context
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 16000,
      });
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

    // Create processor
    const source = audioContext.createMediaStreamSource(mediaStream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);

    processor.onaudioprocess = (e) => {
      if (!isRecording) return;

      const inputData = e.inputBuffer.getChannelData(0);
      const pcm16 = float32ToPcm16(inputData);
      const base64 = arrayBufferToBase64(pcm16.buffer);

      voiceClient.sendAudio(base64);

      // Update visualizer
      updateVisualizer(inputData);
    };

    source.connect(processor);
    processor.connect(audioContext.destination);

    isRecording = true;
    document.getElementById('btn-voice-toggle')?.classList.add('active');
    updateVoiceStatus('Recording...');
    updatePipelineStep('stt', 'active');
  } catch (error) {
    toast.error('Microphone Access Failed', error.message);
  }
}

function stopVoiceRecording() {
  if (!isRecording) return;

  isRecording = false;
  document.getElementById('btn-voice-toggle')?.classList.remove('active');
  updateVoiceStatus('Processing...');

  // Stop media stream
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }

  // Commit the utterance
  if (voiceClient) {
    voiceClient.commit();
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
