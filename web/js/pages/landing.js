/**
 * SoulEngine Landing Page
 * Handles hero interactions, brain visualization, and pillar tabs
 */

import { BrainVisualization } from '../components/BrainVisualization.js';
import { renderTemplate, updateNav } from '../components.js';
import { router } from '../router.js';
import { isAuthenticated, signInWithGoogle } from '../auth.js';

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
      initBewareTrigger();
      initUnityCloud();
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
  const authActions = document.getElementById('hero-actions-auth');
  const unauthActions = document.getElementById('hero-actions-unauth');

  // Show the correct hero actions based on auth state
  if (isAuthenticated()) {
    if (authActions) authActions.style.display = '';
    if (unauthActions) unauthActions.style.display = 'none';
  } else {
    if (authActions) authActions.style.display = 'none';
    if (unauthActions) unauthActions.style.display = '';
  }

  const btnCreate = document.getElementById('btn-create-project');
  const btnView = document.getElementById('btn-view-projects');
  const btnCta = document.getElementById('btn-cta-create');
  const btnHeroSignIn = document.getElementById('btn-hero-sign-in');

  if (btnCreate) {
    btnCreate.addEventListener('click', () => router.navigate('/projects/new'));
  }

  if (btnView) {
    btnView.addEventListener('click', () => router.navigate('/projects'));
  }

  if (btnCta) {
    btnCta.addEventListener('click', () => router.navigate('/projects/new'));
  }

  if (btnHeroSignIn) {
    btnHeroSignIn.addEventListener('click', async () => {
      btnHeroSignIn.disabled = true;
      btnHeroSignIn.textContent = 'Signing in...';
      const { error } = await signInWithGoogle();
      if (error) {
        btnHeroSignIn.disabled = false;
        btnHeroSignIn.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:20px;height:20px;margin-right:8px;">
            <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path>
            <polyline points="10 17 15 12 10 7"></polyline>
            <line x1="15" y1="12" x2="3" y2="12"></line>
          </svg>
          Sign In`;
      }
    });
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

function initBewareTrigger() {
  const trigger = document.getElementById('beware-trigger');
  const popup = document.getElementById('beware-popup');
  if (!trigger || !popup) return;

  trigger.addEventListener('click', () => {
    popup.classList.toggle('open');
  });

  document.addEventListener('click', (e) => {
    if (!trigger.contains(e.target) && !popup.contains(e.target)) {
      popup.classList.remove('open');
    }
  });
}

function initUnityCloud() {
  const cloud = document.getElementById('unity-cloud');
  const anchor = document.getElementById('unity-cloud-anchor');
  const badge = document.getElementById('hero-badge-unity');
  if (!cloud || !anchor) return;

  let wobbleTimer = null;
  let isPopped = false;

  // --- Periodic wobble + ripple ---
  function scheduleWobble() {
    if (isPopped) return;
    const delay = 4000 + Math.random() * 3000;
    wobbleTimer = setTimeout(() => {
      if (isPopped) return;
      triggerWobble();
      scheduleWobble();
    }, delay);
  }

  function triggerWobble() {
    cloud.classList.remove('wobble');
    // Force reflow so re-adding the class restarts the animation
    void cloud.offsetWidth;
    cloud.classList.add('wobble');

    // Ripple ring
    const ripple = document.createElement('div');
    ripple.className = 'unity-cloud-ripple';
    cloud.appendChild(ripple);
    ripple.addEventListener('animationend', () => ripple.remove());
  }

  // Remove wobble class when animation ends to allow re-trigger
  cloud.addEventListener('animationend', (e) => {
    if (e.animationName === 'nudgeWobble') {
      cloud.classList.remove('wobble');
    }
  });

  // --- Click: pop + particle burst ---
  cloud.addEventListener('click', (e) => {
    if (isPopped) return;
    isPopped = true;
    if (wobbleTimer) clearTimeout(wobbleTimer);

    const rect = cloud.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    // Start pop animation on cloud
    cloud.classList.add('popping');

    // After pop scale completes, spawn particles and remove cloud
    setTimeout(() => {
      spawnParticles(cx, cy, rect.width);
      anchor.style.display = 'none';

      // Reveal the badge after a short delay
      setTimeout(() => {
        if (badge) {
          badge.classList.add('visible');
        }
      }, 400);
    }, 220);
  });

  scheduleWobble();
}


// --- Particle burst system ---
function spawnParticles(cx, cy, cloudWidth) {
  const container = document.createElement('div');
  container.className = 'unity-cloud-particles';
  document.body.appendChild(container);

  const particleCount = 28;
  const particles = [];

  // Colors sampled from pillar palette + white
  const colors = [
    'rgba(122, 224, 196, 0.9)',   // teal (persona)
    'rgba(196, 165, 245, 0.9)',   // purple (mcp)
    'rgba(245, 194, 122, 0.85)',  // orange (daily)
    'rgba(245, 226, 122, 0.8)',   // yellow (weekly)
    'rgba(255, 255, 255, 0.7)',   // white
    'rgba(245, 165, 184, 0.85)',  // pink (core)
  ];

  for (let i = 0; i < particleCount; i++) {
    const el = document.createElement('div');
    el.className = 'unity-particle';

    const size = 4 + Math.random() * 8;
    const angle = (Math.PI * 2 * i) / particleCount + (Math.random() - 0.5) * 0.6;
    const speed = 80 + Math.random() * 160;
    const color = colors[Math.floor(Math.random() * colors.length)];

    el.style.width = size + 'px';
    el.style.height = size + 'px';
    el.style.background = color;
    el.style.left = cx + 'px';
    el.style.top = cy + 'px';
    el.style.boxShadow = '0 0 ' + (size * 2) + 'px ' + color;

    container.appendChild(el);

    particles.push({
      el,
      x: cx,
      y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 40, // slight upward bias
      gravity: 120 + Math.random() * 60,
      drag: 0.96 + Math.random() * 0.03,
      opacity: 1,
      fadeRate: 0.9 + Math.random() * 0.8, // per-second opacity drain
    });
  }

  const startTime = performance.now();
  const duration = 900;

  function tick(now) {
    const elapsed = now - startTime;
    if (elapsed > duration) {
      container.remove();
      return;
    }

    const dt = 1 / 60; // approximate fixed timestep

    for (const p of particles) {
      p.vy += p.gravity * dt;
      p.vx *= p.drag;
      p.vy *= p.drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.opacity -= p.fadeRate * dt;
      if (p.opacity < 0) p.opacity = 0;

      p.el.style.transform = `translate(${p.x - parseFloat(p.el.style.left)}px, ${p.y - parseFloat(p.el.style.top)}px)`;
      p.el.style.opacity = p.opacity;
    }

    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}

export default { init, cleanup };