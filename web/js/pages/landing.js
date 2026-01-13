/**
 * SoulEngine Landing Page
 * Handles hero interactions, brain visualization, and pillar tabs
 */

import { BrainVisualization } from '../components/BrainVisualization.js';
import { renderTemplate, updateNav } from '../components.js';
import { router } from '../router.js';

let brainViz = null;

export function initLandingPage() {
  renderTemplate('template-landing');
  
  // Clear project-specific nav tabs when on landing page
  updateNav([]);

  requestAnimationFrame(() => {
    setTimeout(() => {
      initBrainVisualization();
      initPillarTabs();
      initPillarDetails();
      initHeroButtons();
      initSmoothScroll();
      initNavScrollEffect();
    }, 50);
  });
}

// Also export as init for compatibility
export const init = initLandingPage;

export function cleanup() {
  if (brainViz) {
    brainViz.destroy();
    brainViz = null;
  }
}

function initBrainVisualization() {
  const canvas = document.getElementById('brain-canvas');
  if (!canvas) return;

  brainViz = new BrainVisualization('brain-canvas');
}

function initPillarTabs() {
  const tabs = document.querySelectorAll('.pillar-tab');
  if (!tabs.length) return;

  tabs.forEach(tab => {
    tab.addEventListener('mouseenter', () => {
      const pillar = tab.dataset.pillar;
      if (brainViz && pillar) {
        brainViz.setPillarColor(pillar);
      }
      highlightPillarDetail(pillar);
    });

    tab.addEventListener('mouseleave', () => {
      if (brainViz) {
        brainViz.clearPillarColor();
      }
      clearPillarDetailHighlight();
    });

    tab.addEventListener('click', () => {
      const pillar = tab.dataset.pillar;
      scrollToPillarDetail(pillar);
    });
  });
}

function highlightPillarDetail(pillarName) {
  const details = document.querySelectorAll('.pillar-detail');
  details.forEach(detail => {
    if (detail.dataset.pillar === pillarName) {
      detail.style.transform = 'translateY(-8px)';
      detail.style.boxShadow = 'var(--shadow-lg)';
    } else {
      detail.style.transform = '';
      detail.style.boxShadow = '';
    }
  });
}

function clearPillarDetailHighlight() {
  const details = document.querySelectorAll('.pillar-detail');
  details.forEach(detail => {
    detail.style.transform = '';
    detail.style.boxShadow = '';
  });
}

function scrollToPillarDetail(pillarName) {
  const detail = document.querySelector(`.pillar-detail[data-pillar="${pillarName}"]`);
  if (detail) {
    detail.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function initPillarDetails() {
  const details = document.querySelectorAll('.pillar-detail');
  if (!details.length) return;
  
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
      }
    });
  }, {
    threshold: 0.2,
    rootMargin: '0px 0px -50px 0px'
  });
  
  details.forEach((detail, index) => {
    detail.style.transitionDelay = `${index * 0.1}s`;
    observer.observe(detail);
    
    detail.addEventListener('mouseenter', () => {
      const pillar = detail.dataset.pillar;
      if (brainViz && pillar) {
        brainViz.setPillarColor(pillar);
      }
    });
    
    detail.addEventListener('mouseleave', () => {
      if (brainViz) {
        brainViz.clearPillarColor();
      }
    });
  });
}

function initHeroButtons() {
  const btnCreate = document.getElementById('btn-create-project');
  const btnView = document.getElementById('btn-view-projects');
  const btnCta = document.getElementById('btn-cta-create');

  if (btnCreate) {
    btnCreate.addEventListener('click', () => router.navigate('/projects/new'));
  }

  if (btnView) {
    btnView.addEventListener('click', () => router.navigate('/projects'));
  }

  if (btnCta) {
    btnCta.addEventListener('click', () => router.navigate('/projects/new'));
  }
}

function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', (e) => {
      const href = anchor.getAttribute('href');
      if (href === '#') return;
      
      const target = document.querySelector(href);
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth' });
      }
    });
  });
}

function initNavScrollEffect() {
  const nav = document.getElementById('main-nav');
  if (!nav) return;
  
  let ticking = false;
  
  const handleScroll = () => {
    if (!ticking) {
      window.requestAnimationFrame(() => {
        if (window.pageYOffset > 50) {
          nav.classList.add('scrolled');
        } else {
          nav.classList.remove('scrolled');
        }
        ticking = false;
      });
      ticking = true;
    }
  };
  
  window.addEventListener('scroll', handleScroll, { passive: true });
  handleScroll();
}

export default { init, cleanup };