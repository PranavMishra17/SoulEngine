/**
 * Evolve.NPC API Client
 */

const API_BASE = '/api';

/**
 * Generic fetch wrapper with error handling
 */
async function request(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const config = {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  };

  try {
    const response = await fetch(url, config);

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new ApiError(error.error || 'Request failed', response.status, error);
    }

    return await response.json();
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(error.message || 'Network error', 0, null);
  }
}

/**
 * Custom API Error class
 */
export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

/**
 * Projects API
 */
export const projects = {
  list: () => request('/projects'),

  get: (projectId) => request(`/projects/${projectId}`),

  create: (name) => request('/projects', {
    method: 'POST',
    body: JSON.stringify({ name }),
  }),

  update: (projectId, updates) => request(`/projects/${projectId}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  }),

  delete: (projectId) => request(`/projects/${projectId}`, {
    method: 'DELETE',
  }),

  updateKeys: (projectId, keys) => request(`/projects/${projectId}/keys`, {
    method: 'PUT',
    body: JSON.stringify(keys),
  }),
};

/**
 * Knowledge Base API
 */
export const knowledge = {
  get: (projectId) => request(`/projects/${projectId}/knowledge`),

  update: (projectId, knowledgeBase) => request(`/projects/${projectId}/knowledge`, {
    method: 'PUT',
    body: JSON.stringify(knowledgeBase),
  }),
};

/**
 * NPCs API
 */
export const npcs = {
  list: (projectId) => request(`/projects/${projectId}/npcs`),

  get: (projectId, npcId) => request(`/projects/${projectId}/npcs/${npcId}`),

  create: (projectId, definition) => request(`/projects/${projectId}/npcs`, {
    method: 'POST',
    body: JSON.stringify(definition),
  }),

  update: (projectId, npcId, updates) => request(`/projects/${projectId}/npcs/${npcId}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  }),

  delete: (projectId, npcId) => request(`/projects/${projectId}/npcs/${npcId}`, {
    method: 'DELETE',
  }),
};

/**
 * Session API
 */
export const session = {
  start: (projectId, npcId, playerId) => request('/session/start', {
    method: 'POST',
    body: JSON.stringify({ project_id: projectId, npc_id: npcId, player_id: playerId }),
  }),

  end: (sessionId, exitConvoUsed = false) => request(`/session/${sessionId}/end`, {
    method: 'POST',
    body: JSON.stringify({ exit_convo_used: exitConvoUsed }),
  }),

  get: (sessionId) => request(`/session/${sessionId}`),

  getStats: () => request('/session/stats'),
};

/**
 * Conversation API
 */
export const conversation = {
  sendMessage: (sessionId, content) => request(`/session/${sessionId}/message`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  }),

  getHistory: (sessionId) => request(`/session/${sessionId}/history`),
};

/**
 * Instance Cycles API
 */
export const cycles = {
  dailyPulse: (instanceId, gameContext) => request(`/instances/${instanceId}/daily-pulse`, {
    method: 'POST',
    body: JSON.stringify({ game_context: gameContext }),
  }),

  weeklyWhisper: (instanceId, retainCount) => request(`/instances/${instanceId}/weekly-whisper`, {
    method: 'POST',
    body: JSON.stringify({ retain_count: retainCount }),
  }),

  personaShift: (instanceId) => request(`/instances/${instanceId}/persona-shift`, {
    method: 'POST',
  }),
};

/**
 * History API
 */
export const history = {
  getVersions: (instanceId) => request(`/instances/${instanceId}/history`),

  rollback: (instanceId, version) => request(`/instances/${instanceId}/rollback`, {
    method: 'POST',
    body: JSON.stringify({ version }),
  }),
};

/**
 * WebSocket Voice Client
 */
export class VoiceClient {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.ws = null;
    this.callbacks = {
      onReady: () => {},
      onTranscript: () => {},
      onTextChunk: () => {},
      onAudioChunk: () => {},
      onToolCall: () => {},
      onGenerationEnd: () => {},
      onExitConvo: () => {},
      onSync: () => {},
      onError: () => {},
      onClose: () => {},
    };
  }

  connect() {
    return new Promise((resolve, reject) => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${protocol}//${window.location.host}/ws/voice?session_id=${this.sessionId}`;

      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.send({ type: 'init', session_id: this.sessionId });
      };

      this.ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        this.handleMessage(message, resolve, reject);
      };

      this.ws.onerror = (error) => {
        reject(error);
        this.callbacks.onError('CONNECTION_ERROR', 'WebSocket connection error');
      };

      this.ws.onclose = () => {
        this.callbacks.onClose();
      };
    });
  }

  handleMessage(message, resolveConnect, rejectConnect) {
    switch (message.type) {
      case 'ready':
        resolveConnect(message);
        this.callbacks.onReady(message);
        break;
      case 'transcript':
        this.callbacks.onTranscript(message.text, message.is_final);
        break;
      case 'text_chunk':
        this.callbacks.onTextChunk(message.text);
        break;
      case 'audio_chunk':
        this.callbacks.onAudioChunk(message.data);
        break;
      case 'tool_call':
        this.callbacks.onToolCall(message.name, message.args);
        break;
      case 'generation_end':
        this.callbacks.onGenerationEnd();
        break;
      case 'exit_convo':
        this.callbacks.onExitConvo(message.reason, message.cooldown_seconds);
        break;
      case 'sync':
        this.callbacks.onSync(message.success, message.version);
        break;
      case 'error':
        if (rejectConnect) {
          rejectConnect(new Error(message.message));
        }
        this.callbacks.onError(message.code, message.message);
        break;
    }
  }

  send(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  sendAudio(base64Audio) {
    this.send({ type: 'audio', data: base64Audio });
  }

  commit() {
    this.send({ type: 'commit' });
  }

  sendText(content) {
    this.send({ type: 'text', content });
  }

  interrupt() {
    this.send({ type: 'interrupt' });
  }

  end() {
    this.send({ type: 'end' });
  }

  close() {
    if (this.ws) {
      this.ws.close();
    }
  }

  on(event, callback) {
    const key = `on${event.charAt(0).toUpperCase()}${event.slice(1)}`;
    if (key in this.callbacks) {
      this.callbacks[key] = callback;
    }
    return this;
  }
}

export default {
  projects,
  knowledge,
  npcs,
  session,
  conversation,
  cycles,
  history,
  VoiceClient,
  ApiError,
};
