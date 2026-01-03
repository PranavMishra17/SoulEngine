/**
 * Evolve.NPC UI Components
 */

/**
 * Toast notification system
 */
export const toast = {
  container: null,

  init() {
    this.container = document.getElementById('toast-container');
  },

  show(type, title, message, duration = 5000) {
    const icons = {
      success: '✓',
      error: '✕',
      warning: '⚠',
      info: 'ℹ',
    };

    const toastEl = document.createElement('div');
    toastEl.className = `toast toast-${type}`;
    toastEl.innerHTML = `
      <span class="toast-icon">${icons[type] || 'ℹ'}</span>
      <div class="toast-content">
        <div class="toast-title">${title}</div>
        ${message ? `<div class="toast-message">${message}</div>` : ''}
      </div>
      <button class="toast-close">✕</button>
    `;

    // Add close handler
    toastEl.querySelector('.toast-close').addEventListener('click', () => {
      this.dismiss(toastEl);
    });

    this.container.appendChild(toastEl);

    // Auto dismiss
    if (duration > 0) {
      setTimeout(() => this.dismiss(toastEl), duration);
    }

    return toastEl;
  },

  dismiss(toastEl) {
    toastEl.style.animation = 'slideOutRight 0.2s ease forwards';
    setTimeout(() => toastEl.remove(), 200);
  },

  success(title, message) {
    return this.show('success', title, message);
  },

  error(title, message) {
    return this.show('error', title, message);
  },

  warning(title, message) {
    return this.show('warning', title, message);
  },

  info(title, message) {
    return this.show('info', title, message);
  },
};

/**
 * Modal dialog system
 */
export const modal = {
  activeModal: null,

  open(options) {
    const { title, content, footer, onClose, size } = options;

    const template = document.getElementById('template-modal');
    const modalEl = template.content.cloneNode(true).querySelector('.modal-overlay');

    // Apply size class if specified
    if (size === 'large') {
      modalEl.querySelector('.modal').classList.add('modal-large');
    }

    modalEl.querySelector('.modal-title').textContent = title;

    if (typeof content === 'string') {
      modalEl.querySelector('.modal-body').innerHTML = content;
    } else {
      modalEl.querySelector('.modal-body').appendChild(content);
    }

    if (footer) {
      if (typeof footer === 'string') {
        modalEl.querySelector('.modal-footer').innerHTML = footer;
      } else {
        modalEl.querySelector('.modal-footer').appendChild(footer);
      }
    } else {
      modalEl.querySelector('.modal-footer').remove();
    }

    // Close handlers
    const closeModal = () => {
      modalEl.style.animation = 'fadeOut 0.15s ease forwards';
      modalEl.querySelector('.modal').style.animation = 'slideDown 0.15s ease forwards';
      setTimeout(() => {
        modalEl.remove();
        this.activeModal = null;
        if (onClose) onClose();
      }, 150);
    };

    modalEl.querySelector('.modal-close').addEventListener('click', closeModal);
    modalEl.addEventListener('click', (e) => {
      if (e.target === modalEl) closeModal();
    });

    // ESC key to close
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        closeModal();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);

    document.body.appendChild(modalEl);
    this.activeModal = { el: modalEl, close: closeModal };

    return this.activeModal;
  },

  confirm(title, message) {
    return new Promise((resolve) => {
      const footer = document.createElement('div');
      footer.innerHTML = `
        <button class="btn btn-outline" data-action="cancel">Cancel</button>
        <button class="btn btn-danger" data-action="confirm">Confirm</button>
      `;

      const modal = this.open({
        title,
        content: `<p>${message}</p>`,
        footer,
        onClose: () => resolve(false),
      });

      footer.querySelector('[data-action="cancel"]').addEventListener('click', () => {
        modal.close();
        resolve(false);
      });

      footer.querySelector('[data-action="confirm"]').addEventListener('click', () => {
        modal.close();
        resolve(true);
      });
    });
  },

  prompt(title, message, defaultValue = '') {
    return new Promise((resolve) => {
      const content = document.createElement('div');
      content.innerHTML = `
        <p style="margin-bottom: var(--space-4)">${message}</p>
        <input type="text" class="input" value="${defaultValue}">
      `;

      const footer = document.createElement('div');
      footer.innerHTML = `
        <button class="btn btn-outline" data-action="cancel">Cancel</button>
        <button class="btn btn-primary" data-action="submit">Submit</button>
      `;

      const modal = this.open({
        title,
        content,
        footer,
        onClose: () => resolve(null),
      });

      const input = content.querySelector('input');
      input.focus();
      input.select();

      const submit = () => {
        modal.close();
        resolve(input.value);
      };

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submit();
      });

      footer.querySelector('[data-action="cancel"]').addEventListener('click', () => {
        modal.close();
        resolve(null);
      });

      footer.querySelector('[data-action="submit"]').addEventListener('click', submit);
    });
  },
};

/**
 * Loading state helpers
 */
export const loading = {
  button(btn, isLoading) {
    if (isLoading) {
      btn.disabled = true;
      btn.dataset.originalText = btn.innerHTML;
      btn.innerHTML = '<span class="spinner"></span>';
    } else {
      btn.disabled = false;
      btn.innerHTML = btn.dataset.originalText || btn.innerHTML;
    }
  },

  skeleton(count = 3) {
    return Array(count)
      .fill(0)
      .map(() => `<div class="skeleton" style="height: 60px; margin-bottom: var(--space-4);"></div>`)
      .join('');
  },
};

/**
 * Tag input component
 */
export function createTagInput(container, { tags = [], placeholder = 'Add tag...', onChange }) {
  const tagsContainer = container.querySelector('.tag-input-tags') || document.createElement('div');
  tagsContainer.className = 'tag-input-tags';

  const input = container.querySelector('.tag-input') || document.createElement('input');
  input.className = 'input tag-input';
  input.placeholder = placeholder;

  let currentTags = [...tags];

  function render() {
    tagsContainer.innerHTML = currentTags
      .map(
        (tag, index) => `
        <span class="tag">
          ${tag}
          <span class="tag-remove" data-index="${index}">✕</span>
        </span>
      `
      )
      .join('');
  }

  function addTag(value) {
    const trimmed = value.trim();
    if (trimmed && !currentTags.includes(trimmed)) {
      currentTags.push(trimmed);
      render();
      if (onChange) onChange(currentTags);
    }
    input.value = '';
  }

  function removeTag(index) {
    currentTags.splice(index, 1);
    render();
    if (onChange) onChange(currentTags);
  }

  // Event handlers
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTag(input.value);
    } else if (e.key === 'Backspace' && !input.value && currentTags.length > 0) {
      removeTag(currentTags.length - 1);
    }
  });

  tagsContainer.addEventListener('click', (e) => {
    const removeBtn = e.target.closest('.tag-remove');
    if (removeBtn) {
      removeTag(parseInt(removeBtn.dataset.index));
    }
  });

  // Initial render
  render();

  return {
    getTags: () => [...currentTags],
    setTags: (newTags) => {
      currentTags = [...newTags];
      render();
    },
    clear: () => {
      currentTags = [];
      render();
    },
  };
}

/**
 * Navigation updater
 */
export function updateNav(links) {
  const navLinks = document.getElementById('nav-links');
  navLinks.innerHTML = links
    .map(
      (link) => `
      <a href="${link.href}" class="nav-link ${link.active ? 'active' : ''}">${link.label}</a>
    `
    )
    .join('');
}

/**
 * Render a template into a container
 */
export function renderTemplate(templateId, containerId = 'main-content') {
  const template = document.getElementById(templateId);
  const container = document.getElementById(containerId);

  if (!template || !container) {
    console.error('Template or container not found:', templateId, containerId);
    return null;
  }

  const content = template.content.cloneNode(true);
  container.innerHTML = '';
  container.appendChild(content);

  return container;
}

/**
 * Format date helper
 */
export function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Format time helper
 */
export function formatTime(dateString) {
  const date = new Date(dateString);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Debounce helper
 */
export function debounce(fn, delay) {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Generate personality description from traits
 */
export function describePersonality(traits) {
  const descriptions = [];

  const { openness, conscientiousness, extraversion, agreeableness, neuroticism } = traits;

  // Openness
  if (openness > 0.7) descriptions.push('curious and imaginative');
  else if (openness < 0.3) descriptions.push('practical and grounded');

  // Conscientiousness
  if (conscientiousness > 0.7) descriptions.push('organized and disciplined');
  else if (conscientiousness < 0.3) descriptions.push('spontaneous and flexible');

  // Extraversion
  if (extraversion > 0.7) descriptions.push('outgoing and energetic');
  else if (extraversion < 0.3) descriptions.push('reserved and thoughtful');

  // Agreeableness
  if (agreeableness > 0.7) descriptions.push('cooperative and trusting');
  else if (agreeableness < 0.3) descriptions.push('competitive and skeptical');

  // Neuroticism
  if (neuroticism > 0.7) descriptions.push('emotionally sensitive');
  else if (neuroticism < 0.3) descriptions.push('emotionally stable');

  if (descriptions.length === 0) {
    return 'Balanced personality with moderate traits across all dimensions.';
  }

  return `This character is ${descriptions.join(', ')}.`;
}

/**
 * Get mood emoji
 */
export function getMoodEmoji(valence, arousal) {
  if (valence > 0.6) {
    return arousal > 0.6 ? '😄' : '😊';
  } else if (valence < 0.4) {
    return arousal > 0.6 ? '😠' : '😔';
  }
  return arousal > 0.6 ? '😐' : '😌';
}

/**
 * Get mood label
 */
export function getMoodLabel(valence, arousal, dominance) {
  if (valence > 0.6) {
    if (arousal > 0.6) return 'Excited';
    return 'Content';
  } else if (valence < 0.4) {
    if (arousal > 0.6) return 'Agitated';
    return 'Sad';
  }
  if (arousal > 0.6) return 'Alert';
  return 'Calm';
}

// Initialize components on load
document.addEventListener('DOMContentLoaded', () => {
  toast.init();
});

export default {
  toast,
  modal,
  loading,
  createTagInput,
  updateNav,
  renderTemplate,
  formatDate,
  formatTime,
  debounce,
  describePersonality,
  getMoodEmoji,
  getMoodLabel,
};
