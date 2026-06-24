/**
 * SoulEngine Landing Page
 * Handles hero interactions, brain visualization, and pillar tabs
 */

import { BrainVisualization } from '../components/BrainVisualization.js';
import { mountWordmark } from '../components/WordmarkIntro.js';
import { renderTemplate, updateNav } from '../components.js';
import { router } from '../router.js';
import { isAuthenticated, signInWithGoogle, getUserDisplayInfo } from '../auth.js';

let brainViz = null;

export function initLandingPage() {
  renderTemplate('template-landing');

  // Clear project-specific nav tabs when on landing page
  updateNav([]);

  requestAnimationFrame(() => {
    setTimeout(() => {
      initBrainVisualization();
      initPillarTabs();
      initWordmarks();
      initScrollReveal();
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
  document.querySelectorAll('.lx-layer').forEach(layer => {
    layer.classList.toggle('is-lit', layer.dataset.pillar === pillarName);
  });
}

function clearPillarDetailHighlight() {
  document.querySelectorAll('.lx-layer.is-lit').forEach(layer => layer.classList.remove('is-lit'));
}

function scrollToPillarDetail(pillarName) {
  const layer = document.querySelector(`.lx-layer[data-pillar="${pillarName}"]`);
  if (layer) {
    layer.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function initWordmarks() {
  const header = document.getElementById('brand-wordmark');
  const whip = document.getElementById('brand-whip');

  const mountAll = () => {
    if (header) {
      let played = false;
      try { played = sessionStorage.getItem('se_wm_intro') === '1'; } catch (e) { /* ignore */ }
      const inst = mountWordmark(header, { fontSize: 20, autoplay: !played });
      if (played && inst) {
        inst.showFinal();
      } else {
        try { sessionStorage.setItem('se_wm_intro', '1'); } catch (e) { /* ignore */ }
      }
    }
    if (whip) {
      const fs = Math.max(40, Math.min(72, Math.round(window.innerWidth * 0.07)));
      mountWordmark(whip, { fontSize: fs, loop: true });
    }
  };

  // Fonts must be loaded before measuring letter widths, or centers are wrong.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(mountAll).catch(mountAll);
  } else {
    mountAll();
  }
}

function initScrollReveal() {
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Staggered groups: each element fades/slides up as it scrolls in.
  const staggered = ['.lx-layer', '.lx-stage', '.lx-benefits li'];
  const singles = ['.lx-head', '.lx-code', '.lx-cta h2', '.lx-cta p'];

  const all = [];

  staggered.forEach(sel => {
    document.querySelectorAll(sel).forEach((el, i) => {
      el.classList.add('reveal');
      el.style.transitionDelay = `${Math.min(i, 6) * 0.06}s`;
      all.push(el);
    });
  });

  singles.forEach(sel => {
    document.querySelectorAll(sel).forEach(el => {
      el.classList.add('reveal');
      all.push(el);
    });
  });

  if (!all.length) return;

  // Reduced motion: CSS keeps everything visible; just mark and bail.
  if (prefersReduced) {
    all.forEach(el => el.classList.add('visible'));
    return;
  }

  const observer = new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        obs.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });

  all.forEach(el => observer.observe(el));
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

  const getScroll = () => Math.max(
    window.pageYOffset || 0,
    document.documentElement.scrollTop || 0,
    document.body.scrollTop || 0
  );

  let ticking = false;
  const apply = () => {
    const y = getScroll();
    const max = Math.max(1, (document.documentElement.scrollHeight || 0) - window.innerHeight);
    const pct = Math.max(0, Math.min(100, (y / max) * 100));
    nav.style.setProperty('--nav-progress', pct + '%');
    nav.classList.toggle('scrolled', y > 40);
    ticking = false;
  };

  const onScroll = () => {
    if (!ticking) {
      ticking = true;
      window.requestAnimationFrame(apply);
    }
  };

  // Capture phase catches scroll whether it fires on window, document, or body.
  window.addEventListener('scroll', onScroll, { passive: true, capture: true });
  window.addEventListener('resize', onScroll, { passive: true });
  apply();
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

function openWaitlistModal() {
  const overlay = document.getElementById('waitlist-overlay');
  const emailInput = document.getElementById('waitlist-email');
  const form = document.getElementById('waitlist-form');
  const result = document.getElementById('waitlist-result');
  if (!overlay) return;

  // Pre-fill email if signed in
  if (emailInput) {
    const info = getUserDisplayInfo();
    emailInput.value = info?.email || '';
  }

  // Reset state
  if (form) form.style.display = '';
  if (result) { result.style.display = 'none'; result.className = 'waitlist-result'; }

  overlay.classList.add('open');
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
    void cloud.offsetWidth;
    cloud.classList.add('wobble');

    const ripple = document.createElement('div');
    ripple.className = 'unity-cloud-ripple';
    cloud.appendChild(ripple);
    ripple.addEventListener('animationend', () => ripple.remove());
  }

  cloud.addEventListener('animationend', (e) => {
    if (e.animationName === 'nudgeWobble') {
      cloud.classList.remove('wobble');
    }
  });

  // --- Click: pop + particle burst + open modal ---
  cloud.addEventListener('click', () => {
    if (isPopped) return;
    isPopped = true;
    if (wobbleTimer) clearTimeout(wobbleTimer);

    const rect = cloud.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    cloud.classList.add('popping');

    setTimeout(() => {
      spawnParticles(cx, cy, rect.width);
      anchor.style.display = 'none';

      setTimeout(() => {
        if (badge) badge.classList.add('visible');
        // Open waitlist modal after cloud pops
        openWaitlistModal();
      }, 400);
    }, 220);
  });

  // Badge button also opens modal
  if (badge) {
    badge.addEventListener('click', () => openWaitlistModal());
  }

  // --- Waitlist modal close + submit ---
  const overlay = document.getElementById('waitlist-overlay');
  const closeBtn = document.getElementById('waitlist-close');
  const submitBtn = document.getElementById('waitlist-submit');
  const emailInput = document.getElementById('waitlist-email');

  if (closeBtn && overlay) {
    closeBtn.addEventListener('click', () => overlay.classList.remove('open'));
  }

  // Close on overlay background click
  if (overlay) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.remove('open');
    });
  }

  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay?.classList.contains('open')) {
      overlay.classList.remove('open');
    }
  });

  if (submitBtn && emailInput) {
    submitBtn.addEventListener('click', () => submitWaitlist(emailInput, submitBtn));
    emailInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submitWaitlist(emailInput, submitBtn);
    });
  }

  scheduleWobble();
}

async function submitWaitlist(emailInput, submitBtn) {
  const email = emailInput.value.trim();
  if (!email || !email.includes('@')) {
    emailInput.focus();
    return;
  }

  const form = document.getElementById('waitlist-form');
  const result = document.getElementById('waitlist-result');

  submitBtn.disabled = true;
  submitBtn.textContent = '...';

  try {
    const res = await fetch('/api/waitlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });

    const data = await res.json();

    if (form) form.style.display = 'none';
    if (result) {
      result.style.display = 'block';
      if (res.ok) {
        if (data.already_registered) {
          result.className = 'waitlist-result already';
          result.textContent = 'This email is already on the waitlist. You will be notified when the Unity package is ready.';
        } else {
          result.className = 'waitlist-result success';
          result.textContent = 'You are on the list. We will email you when the Unity package is ready.';
        }
      } else {
        result.className = 'waitlist-result error';
        result.textContent = data.error || 'Something went wrong. Please try again.';
      }
    }
  } catch {
    if (result) {
      if (form) form.style.display = 'none';
      result.style.display = 'block';
      result.className = 'waitlist-result error';
      result.textContent = 'Network error. Please try again.';
    }
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Join';
  }
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