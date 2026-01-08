/**
 * SoulEngine Header Component
 * Reusable navigation header with social links
 */

export const SOCIAL_LINKS = {
  github: {
    url: 'https://github.com/PranavMishra17/SoulEngine',
    label: 'GitHub',
    icon: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>`
  },
  sponsor: {
    url: 'https://github.com/sponsors/PranavMishra17',
    label: 'Sponsor',
    icon: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`
  }
};

export const DEVELOPER_LINKS = {
  portfolio: {
    url: 'https://portfolio-pranav-mishra-paranoid.vercel.app',
    label: 'Portfolio'
  },
  github: {
    url: 'https://github.com/PranavMishra17',
    label: 'GitHub'
  },
  linkedin: {
    url: 'https://www.linkedin.com/in/pranavgamedev',
    label: 'LinkedIn'
  },
  huggingface: {
    url: 'https://huggingface.co/Paranoiid',
    label: 'Hugging Face'
  },
  scholar: {
    url: 'https://scholar.google.com/citations?hl=en&user=_Twn_owAAAAJ',
    label: 'Google Scholar'
  }
};

export function renderHeader(options = {}) {
  const { showNavLinks = true, activePage = '' } = options;
  
  const navLinksHTML = showNavLinks ? `
    <div class="nav-links" id="nav-links"></div>
  ` : '';
  
  return `
    <nav class="main-nav" id="main-nav">
      <div class="nav-brand">
        <a href="/" class="brand-link">
          <span class="brand-icon">S</span>
          <span class="brand-text">Soul<span class="brand-accent">Engine</span></span>
        </a>
      </div>
      ${navLinksHTML}
      <div class="nav-actions">
        <div class="nav-social-links">
          <a href="${SOCIAL_LINKS.github.url}" target="_blank" rel="noopener" class="nav-social-link" title="${SOCIAL_LINKS.github.label}">
            ${SOCIAL_LINKS.github.icon}
          </a>
          <a href="${SOCIAL_LINKS.sponsor.url}" target="_blank" rel="noopener" class="nav-social-link" title="${SOCIAL_LINKS.sponsor.label}">
            ${SOCIAL_LINKS.sponsor.icon}
          </a>
        </div>
        <div class="nav-divider"></div>
        <button class="btn btn-ghost" id="theme-toggle" title="Toggle theme">
          <span class="icon">&#9680;</span>
        </button>
      </div>
    </nav>
  `;
}

export function renderFooter() {
  return `
    <footer class="footer">
      <div class="container">
        <div class="footer-grid">
          <div class="footer-brand">
            <div class="footer-brand-header">
              <span class="brand-icon">S</span>
              <span class="brand-text">Soul<span class="brand-accent">Engine</span></span>
            </div>
            <p>Memory-driven NPCs with layered psychological cycles, real-time voice interaction, and emergent personality evolution.</p>
            <div class="footer-social-links">
              <a href="${SOCIAL_LINKS.github.url}" target="_blank" rel="noopener" class="footer-social-link" title="GitHub">
                ${SOCIAL_LINKS.github.icon}
              </a>
              <a href="${SOCIAL_LINKS.sponsor.url}" target="_blank" rel="noopener" class="footer-social-link" title="Sponsor">
                ${SOCIAL_LINKS.sponsor.icon}
              </a>
            </div>
          </div>
          <div class="footer-links">
            <h4>Resources</h4>
            <a href="${SOCIAL_LINKS.github.url}" target="_blank" rel="noopener">GitHub Repository</a>
            <a href="${SOCIAL_LINKS.github.url}#readme" target="_blank" rel="noopener">Documentation</a>
            <a href="${SOCIAL_LINKS.github.url}/issues" target="_blank" rel="noopener">Report Issues</a>
          </div>
          <div class="footer-links">
            <h4>Product</h4>
            <a href="#pillars">Five Pillars</a>
            <a href="#pipeline">Voice Pipeline</a>
            <a href="#features">Features</a>
          </div>
          <div class="footer-links">
            <h4>Developer</h4>
            <a href="${DEVELOPER_LINKS.portfolio.url}" target="_blank" rel="noopener">Portfolio</a>
            <a href="${DEVELOPER_LINKS.linkedin.url}" target="_blank" rel="noopener">LinkedIn</a>
            <a href="${DEVELOPER_LINKS.scholar.url}" target="_blank" rel="noopener">Publications</a>
            <a href="${DEVELOPER_LINKS.huggingface.url}" target="_blank" rel="noopener">Hugging Face</a>
          </div>
        </div>
        <div class="footer-bottom">
          <p>Built by <a href="${DEVELOPER_LINKS.portfolio.url}" target="_blank" rel="noopener">Pranav Mishra</a>. Open source under MIT license.</p>
          <div class="footer-bottom-links">
            <a href="${SOCIAL_LINKS.github.url}/blob/main/LICENSE" target="_blank" rel="noopener">License</a>
            <a href="${SOCIAL_LINKS.sponsor.url}" target="_blank" rel="noopener">Support Development</a>
          </div>
        </div>
      </div>
    </footer>
  `;
}

export function initHeaderScrollEffect() {
  const nav = document.getElementById('main-nav');
  if (!nav) return;
  
  let lastScroll = 0;
  
  window.addEventListener('scroll', () => {
    const currentScroll = window.pageYOffset;
    
    if (currentScroll > 50) {
      nav.classList.add('scrolled');
    } else {
      nav.classList.remove('scrolled');
    }
    
    lastScroll = currentScroll;
  }, { passive: true });
}

export default {
  renderHeader,
  renderFooter,
  initHeaderScrollEffect,
  SOCIAL_LINKS,
  DEVELOPER_LINKS
};
