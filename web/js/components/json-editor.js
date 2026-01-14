/**
 * JSON Editor Modal Component
 * 
 * A reusable modal for viewing and editing JSON data with validation.
 * Includes search/replace functionality.
 */

import { modal, toast } from '../components.js';

/**
 * Open a JSON editor modal
 * @param {string} title - Modal title
 * @param {object} jsonData - The JSON data to edit
 * @param {object} options - Options
 * @param {boolean} options.readOnly - If true, the editor is read-only
 * @param {function} options.onSave - Callback when saving (receives parsed JSON)
 * @param {function} options.validate - Optional custom validation function
 */
export function openJsonEditor(title, jsonData, options = {}) {
  const { readOnly = false, onSave, validate } = options;
  
  const jsonString = JSON.stringify(jsonData, null, 2);
  
  const content = document.createElement('div');
  content.className = 'json-editor-container';
  content.innerHTML = `
    <div class="json-editor-toolbar">
      <div class="json-toolbar-left">
        <button type="button" class="btn btn-sm btn-ghost" id="btn-json-copy" title="Copy to clipboard">
          <span class="icon">📋</span> Copy
        </button>
        <button type="button" class="btn btn-sm btn-ghost" id="btn-json-format" title="Format JSON">
          <span class="icon">⚡</span> Format
        </button>
        <button type="button" class="btn btn-sm btn-ghost" id="btn-json-search" title="Search & Replace (Ctrl+F)">
          <span class="icon">🔍</span> Find
        </button>
      </div>
      <span class="json-editor-status" id="json-status"></span>
    </div>
    
    <!-- Search/Replace Bar -->
    <div class="json-search-bar" id="json-search-bar" style="display: none;">
      <div class="json-search-row">
        <input type="text" class="input input-sm" id="json-search-input" placeholder="Find...">
        <span class="json-search-count" id="json-search-count">0 of 0</span>
        <button type="button" class="btn btn-sm btn-ghost" id="btn-search-prev" title="Previous">▲</button>
        <button type="button" class="btn btn-sm btn-ghost" id="btn-search-next" title="Next">▼</button>
        <button type="button" class="btn btn-sm btn-ghost" id="btn-search-close" title="Close">✕</button>
      </div>
      ${!readOnly ? `
      <div class="json-replace-row">
        <input type="text" class="input input-sm" id="json-replace-input" placeholder="Replace with...">
        <button type="button" class="btn btn-sm btn-outline" id="btn-replace-one">Replace</button>
        <button type="button" class="btn btn-sm btn-outline" id="btn-replace-all">Replace All</button>
      </div>
      ` : ''}
    </div>
    
    <div class="json-editor-wrapper">
      <div class="json-editor-lines" id="json-lines"></div>
      <textarea 
        class="json-editor-textarea" 
        id="json-textarea" 
        spellcheck="false"
        ${readOnly ? 'readonly' : ''}
      >${escapeHtml(jsonString)}</textarea>
    </div>
    <div class="json-editor-error" id="json-error" style="display: none;"></div>
  `;
  
  let footer = null;
  if (!readOnly) {
    footer = document.createElement('div');
    footer.innerHTML = `
      <button class="btn btn-outline" data-action="cancel">Cancel</button>
      <button class="btn btn-primary" data-action="save">Save Changes</button>
    `;
  } else {
    footer = document.createElement('div');
    footer.innerHTML = `
      <button class="btn btn-outline" data-action="close">Close</button>
    `;
  }
  
  const modalInstance = modal.open({
    title,
    content,
    footer,
    size: 'large',
  });
  
  const textarea = content.querySelector('#json-textarea');
  const statusEl = content.querySelector('#json-status');
  const errorEl = content.querySelector('#json-error');
  const linesEl = content.querySelector('#json-lines');
  const searchBar = content.querySelector('#json-search-bar');
  const searchInput = content.querySelector('#json-search-input');
  const searchCount = content.querySelector('#json-search-count');
  const replaceInput = content.querySelector('#json-replace-input');
  
  // Search state
  let searchMatches = [];
  let currentMatchIndex = -1;
  
  // Initial line numbers
  updateLineNumbers(textarea, linesEl);
  
  // Sync scroll between textarea and line numbers
  textarea.addEventListener('scroll', () => {
    linesEl.scrollTop = textarea.scrollTop;
  });
  
  // Update line numbers on input
  textarea.addEventListener('input', () => {
    updateLineNumbers(textarea, linesEl);
    validateJson(textarea.value, statusEl, errorEl, validate);
    // Update search if active
    if (searchBar.style.display !== 'none' && searchInput.value) {
      performSearch(textarea, searchInput.value, searchCount, searchMatches, currentMatchIndex);
    }
  });
  
  // Handle tab key for indentation and Ctrl+F for search
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      textarea.value = textarea.value.substring(0, start) + '  ' + textarea.value.substring(end);
      textarea.selectionStart = textarea.selectionEnd = start + 2;
      updateLineNumbers(textarea, linesEl);
    }
    if (e.ctrlKey && e.key === 'f') {
      e.preventDefault();
      toggleSearchBar(searchBar, searchInput);
    }
  });
  
  // Search button
  content.querySelector('#btn-json-search')?.addEventListener('click', () => {
    toggleSearchBar(searchBar, searchInput);
  });
  
  // Close search
  content.querySelector('#btn-search-close')?.addEventListener('click', () => {
    searchBar.style.display = 'none';
    searchMatches = [];
    currentMatchIndex = -1;
  });
  
  // Search input
  searchInput?.addEventListener('input', () => {
    const result = performSearch(textarea, searchInput.value, searchCount);
    searchMatches = result.matches;
    currentMatchIndex = result.currentIndex;
  });
  
  // Next/Prev buttons
  content.querySelector('#btn-search-next')?.addEventListener('click', () => {
    if (searchMatches.length > 0) {
      currentMatchIndex = (currentMatchIndex + 1) % searchMatches.length;
      goToMatch(textarea, searchMatches, currentMatchIndex, searchCount);
    }
  });
  
  content.querySelector('#btn-search-prev')?.addEventListener('click', () => {
    if (searchMatches.length > 0) {
      currentMatchIndex = (currentMatchIndex - 1 + searchMatches.length) % searchMatches.length;
      goToMatch(textarea, searchMatches, currentMatchIndex, searchCount);
    }
  });
  
  // Replace buttons
  content.querySelector('#btn-replace-one')?.addEventListener('click', () => {
    if (searchMatches.length > 0 && currentMatchIndex >= 0) {
      const match = searchMatches[currentMatchIndex];
      const replaceText = replaceInput?.value || '';
      textarea.value = textarea.value.substring(0, match.start) + replaceText + textarea.value.substring(match.end);
      updateLineNumbers(textarea, linesEl);
      validateJson(textarea.value, statusEl, errorEl, validate);
      // Re-search
      const result = performSearch(textarea, searchInput.value, searchCount);
      searchMatches = result.matches;
      currentMatchIndex = Math.min(currentMatchIndex, searchMatches.length - 1);
      toast.success('Replaced', '1 occurrence replaced');
    }
  });
  
  content.querySelector('#btn-replace-all')?.addEventListener('click', () => {
    if (searchInput?.value) {
      const searchText = searchInput.value;
      const replaceText = replaceInput?.value || '';
      const regex = new RegExp(escapeRegex(searchText), 'g');
      const count = (textarea.value.match(regex) || []).length;
      textarea.value = textarea.value.replace(regex, replaceText);
      updateLineNumbers(textarea, linesEl);
      validateJson(textarea.value, statusEl, errorEl, validate);
      searchMatches = [];
      currentMatchIndex = -1;
      searchCount.textContent = '0 of 0';
      toast.success('Replaced All', `${count} occurrences replaced`);
    }
  });
  
  // Copy button
  content.querySelector('#btn-json-copy')?.addEventListener('click', () => {
    navigator.clipboard.writeText(textarea.value).then(() => {
      toast.success('Copied', 'JSON copied to clipboard');
    }).catch(() => {
      toast.error('Copy Failed', 'Could not copy to clipboard');
    });
  });
  
  // Format button
  content.querySelector('#btn-json-format')?.addEventListener('click', () => {
    try {
      const parsed = JSON.parse(textarea.value);
      textarea.value = JSON.stringify(parsed, null, 2);
      updateLineNumbers(textarea, linesEl);
      validateJson(textarea.value, statusEl, errorEl, validate);
      toast.success('Formatted', 'JSON formatted successfully');
    } catch (err) {
      toast.error('Format Failed', 'Fix JSON errors before formatting');
    }
  });
  
  // Initial validation
  validateJson(textarea.value, statusEl, errorEl, validate);
  
  // Footer buttons
  if (!readOnly) {
    footer.querySelector('[data-action="cancel"]')?.addEventListener('click', () => {
      modalInstance.close();
    });
    
    footer.querySelector('[data-action="save"]')?.addEventListener('click', () => {
      try {
        const parsed = JSON.parse(textarea.value);
        
        // Custom validation
        if (validate) {
          const validationErrors = validate(parsed);
          if (validationErrors && validationErrors.length > 0) {
            errorEl.textContent = validationErrors.join('; ');
            errorEl.style.display = 'block';
            toast.error('Validation Failed', validationErrors[0]);
            return;
          }
        }
        
        if (onSave) {
          onSave(parsed);
        }
        modalInstance.close();
      } catch (err) {
        errorEl.textContent = `JSON Parse Error: ${err.message}`;
        errorEl.style.display = 'block';
        toast.error('Invalid JSON', err.message);
      }
    });
  } else {
    footer.querySelector('[data-action="close"]')?.addEventListener('click', () => {
      modalInstance.close();
    });
  }
  
  // Focus textarea
  setTimeout(() => textarea.focus(), 100);
  
  return modalInstance;
}

/**
 * Toggle search bar visibility
 */
function toggleSearchBar(searchBar, searchInput) {
  if (searchBar.style.display === 'none') {
    searchBar.style.display = 'block';
    searchInput?.focus();
  } else {
    searchBar.style.display = 'none';
  }
}

/**
 * Perform search and highlight matches
 */
function performSearch(textarea, searchText, countEl) {
  const matches = [];
  
  if (!searchText) {
    countEl.textContent = '0 of 0';
    return { matches, currentIndex: -1 };
  }
  
  const text = textarea.value;
  const regex = new RegExp(escapeRegex(searchText), 'gi');
  let match;
  
  while ((match = regex.exec(text)) !== null) {
    matches.push({
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  
  const currentIndex = matches.length > 0 ? 0 : -1;
  countEl.textContent = matches.length > 0 ? `1 of ${matches.length}` : '0 of 0';
  
  if (matches.length > 0) {
    goToMatch(textarea, matches, 0, countEl);
  }
  
  return { matches, currentIndex };
}

/**
 * Go to a specific match
 */
function goToMatch(textarea, matches, index, countEl) {
  if (index < 0 || index >= matches.length) return;
  
  const match = matches[index];
  textarea.focus();
  textarea.setSelectionRange(match.start, match.end);
  
  // Scroll to match
  const lines = textarea.value.substring(0, match.start).split('\n');
  const lineHeight = parseInt(getComputedStyle(textarea).lineHeight) || 20;
  textarea.scrollTop = (lines.length - 3) * lineHeight;
  
  countEl.textContent = `${index + 1} of ${matches.length}`;
}

/**
 * Escape regex special characters
 */
function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Update line numbers in the editor
 */
function updateLineNumbers(textarea, linesEl) {
  const lines = textarea.value.split('\n');
  const lineCount = lines.length;
  
  let html = '';
  for (let i = 1; i <= lineCount; i++) {
    html += `<div class="json-line-number">${i}</div>`;
  }
  linesEl.innerHTML = html;
}

/**
 * Validate JSON and update status
 */
function validateJson(value, statusEl, errorEl, customValidate) {
  try {
    const parsed = JSON.parse(value);
    statusEl.textContent = '✓ Valid JSON';
    statusEl.className = 'json-editor-status valid';
    errorEl.style.display = 'none';
    
    // Custom validation
    if (customValidate) {
      const errors = customValidate(parsed);
      if (errors && errors.length > 0) {
        statusEl.textContent = '⚠ Validation warnings';
        statusEl.className = 'json-editor-status warning';
        errorEl.textContent = errors.join('; ');
        errorEl.style.display = 'block';
      }
    }
    
    return true;
  } catch (err) {
    statusEl.textContent = '✕ Invalid JSON';
    statusEl.className = 'json-editor-status invalid';
    errorEl.textContent = err.message;
    errorEl.style.display = 'block';
    return false;
  }
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

export default { openJsonEditor };
