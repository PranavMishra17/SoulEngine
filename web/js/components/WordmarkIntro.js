/**
 * SoulEngine wordmark intro — the pinned "sine settle" (Option A).
 *
 * Ten thick equalizer bars ride one smooth traveling sine wave for two loops,
 * the amplitude eases to zero so the motion glides to rest, the bars resize and
 * recolor (Soul = ivory, Engine = ember; the capital S and E sit taller), then
 * the letters grow out of the bars into the "SoulEngine" wordmark.
 *
 * Reusable at any size via opts.fontSize. Plays once when first on-screen with
 * the tab foregrounded; respects prefers-reduced-motion (renders the final
 * wordmark instantly). Rests as the wordmark either way.
 */

const WORD = 'SoulEngine';
const LETTERS = WORD.split('');
const SOUL_COUNT = 4;                 // indices 0..3 ivory (Soul), 4..9 ember (Engine)
const TALL = { 0: true, 4: true };    // capital S and E bars sit taller
const PASTELS = ['#f1a6c4', '#83e0c6', '#b6a6f2'];
const INK = '#ece6dc';
const EMBER = '#e07850';
const SPEED = 4.8;                     // wave temporal speed (rad/s) — 1.5x
const PHASE_STEP = 0.62;              // phase offset per bar -> traveling wave
const LOOP_PERIOD = (2 * Math.PI) / SPEED;
const WAVE_LOOPS = 2;

function safe(v, f) { return (typeof v === 'number' && isFinite(v)) ? v : f; }
function clampPos(v, f) { const s = safe(v, f); return s < 0.5 ? 0.5 : s; }

function measureCenters(surface, fontSize) {
  const rig = document.createElement('div');
  rig.className = 'wm-measure';
  rig.style.fontSize = fontSize + 'px';
  surface.appendChild(rig);
  const spans = LETTERS.map((ch) => {
    const s = document.createElement('span');
    s.textContent = ch;
    rig.appendChild(s);
    return s;
  });
  const rigRect = rig.getBoundingClientRect();
  const totalW = safe(rigRect.width, fontSize * LETTERS.length * 0.6);
  const x = spans.map((s) => {
    const r = s.getBoundingClientRect();
    return clampPos((r.left - rigRect.left) + r.width / 2, totalW / 2);
  });
  surface.removeChild(rig);
  return { x, totalW };
}

/**
 * Mount the animated wordmark into `container`.
 * @param {HTMLElement} container
 * @param {{fontSize?:number, autoplay?:boolean}} [opts]
 */
export function mountWordmark(container, opts = {}) {
  if (!container) return null;

  const fontSize = opts.fontSize || 64;
  const k = fontSize / 64;                       // scale vs the pinned reference
  const BAR_W = Math.max(4, Math.round(18 * k));
  const BASE_H = 26 * k;
  const WAVE_AMP = 34 * k;
  const FINAL_SHORT = 30 * k;
  const FINAL_TALL = 58 * k;
  const TALL_EXTRA = 12 * k;

  let reduce = false;
  try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { reduce = false; }
  const loop = opts.loop === true;

  container.innerHTML = '';
  container.classList.add('wm-host');
  const surface = document.createElement('div');
  surface.className = 'wm-surface';
  surface.style.height = Math.round(fontSize * 1.55) + 'px';
  container.appendChild(surface);

  const centers = measureCenters(surface, fontSize);
  surface.style.width = Math.ceil(centers.totalW) + 'px';

  const bars = [];
  const letters = [];
  for (let i = 0; i < LETTERS.length; i++) {
    const bar = document.createElement('div');
    bar.className = 'wm-bar';
    bar.style.width = BAR_W + 'px';
    bar.style.left = centers.x[i] + 'px';
    bar.style.height = BASE_H + 'px';
    bar.style.background = i < SOUL_COUNT ? INK : EMBER;
    surface.appendChild(bar);
    bars.push(bar);

    const letter = document.createElement('div');
    letter.className = 'wm-letter ' + (i < SOUL_COUNT ? 'wm-soul' : 'wm-engine');
    letter.textContent = LETTERS[i];
    letter.style.fontSize = fontSize + 'px';
    letter.style.left = centers.x[i] + 'px';
    surface.appendChild(letter);
    letters.push(letter);
  }

  let rafId = null;
  const timers = [];
  const later = (fn, ms) => { timers.push(setTimeout(fn, ms)); };

  function showFinal() {
    for (let i = 0; i < bars.length; i++) {
      bars[i].style.opacity = '0';
      bars[i].style.height = '0px';
      letters[i].style.transition = 'none';
      letters[i].style.opacity = '1';
      letters[i].style.transform = 'translate(-50%, 50%) scale(1)';
    }
  }

  function runWave(durationSec, onDone) {
    let start = null;
    const settleStart = durationSec * 0.62;
    function frame(ts) {
      if (start === null) start = ts;
      const t = (ts - start) / 1000;
      let amp = WAVE_AMP;
      if (t >= settleStart) {
        let p = (t - settleStart) / (durationSec - settleStart);
        if (p > 1) p = 1;
        const e = 1 - (p * p * p * (p * (p * 6 - 15) + 10)); // smootherstep ease-out
        amp = WAVE_AMP * e;
      }
      for (let i = 0; i < bars.length; i++) {
        const wave = 0.5 + 0.5 * Math.sin(t * SPEED - i * PHASE_STEP);
        const extra = TALL[i] ? TALL_EXTRA : 0;
        bars[i].style.height = clampPos(BASE_H + amp * wave + extra, BASE_H) + 'px';
        if (amp > 1.2 * k) {
          const phase = (t * SPEED - i * PHASE_STEP) / (2 * Math.PI);
          const idx = Math.floor((((phase % 1) + 1) % 1) * PASTELS.length) % PASTELS.length;
          bars[i].style.background = PASTELS[idx];
        }
      }
      if (t < durationSec) rafId = requestAnimationFrame(frame);
      else { rafId = null; if (onDone) onDone(); }
    }
    rafId = requestAnimationFrame(frame);
  }

  function resetToStart() {
    for (let i = 0; i < bars.length; i++) {
      const b = bars[i];
      b.style.transition = 'none';
      b.style.height = BASE_H + 'px';
      b.style.opacity = '1';
      b.style.background = i < SOUL_COUNT ? INK : EMBER;
      const l = letters[i];
      l.style.transition = 'none';
      l.style.opacity = '0';
      l.style.transform = 'translate(-50%, 50%) scale(0.2)';
    }
  }

  function run() {
    runWave(WAVE_LOOPS * LOOP_PERIOD + 0.6, () => {
      // settle: resize + recolor to resting bars
      for (let i = 0; i < bars.length; i++) {
        bars[i].style.transition = 'height 0.33s cubic-bezier(0.25,0.9,0.3,1), background-color 0.33s ease';
        bars[i].style.height = (TALL[i] ? FINAL_TALL : FINAL_SHORT) + 'px';
        bars[i].style.background = i < SOUL_COUNT ? INK : EMBER;
      }
      // emerge: letters grow from the bars in place, bars hand off
      later(() => {
        for (let i = 0; i < letters.length; i++) {
          ((idx) => later(() => {
            const l = letters[idx];
            l.style.transition = 'transform 0.37s cubic-bezier(0.2,0.8,0.25,1), opacity 0.3s ease';
            l.style.opacity = '1';
            l.style.transform = 'translate(-50%, 50%) scale(1)';
            const b = bars[idx];
            b.style.transition = 'height 0.33s ease, opacity 0.33s ease';
            b.style.opacity = '0';
            b.style.height = '0px';
          }, idx * 70))(i);
        }
        // loop: hold the resolved wordmark, fade out, then run the wave again
        if (loop) {
          later(() => {
            letters.forEach((l) => { l.style.transition = 'opacity 0.4s ease'; l.style.opacity = '0'; });
            later(() => { resetToStart(); run(); }, 440);
          }, letters.length * 70 + 2800);
        }
      }, 520);
    });
  }

  let played = false;
  function play() {
    if (played) return;
    if (document.visibilityState === 'hidden') return; // rAF is paused while hidden
    played = true;
    run();
  }

  if (reduce) {
    showFinal();
    played = true;
  } else if (opts.autoplay !== false) {
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (e.isIntersecting && e.intersectionRatio > 0.25) { play(); io.disconnect(); break; }
        }
      }, { threshold: [0, 0.25, 0.5] });
      io.observe(container);
    } else {
      play();
    }
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'hidden') play();
    });
  }

  return {
    play: () => { played = false; play(); },
    showFinal,
    destroy: () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      timers.forEach(clearTimeout);
    }
  };
}

export default { mountWordmark };
