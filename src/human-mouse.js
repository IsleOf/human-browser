/**
 * Human-like mouse movement using cubic Bezier curves with noise, overshoot,
 * and Fitts's Law speed modulation.
 *
 * Key principles:
 *  - Bezier curves with perpendicular-offset control points (not straight lines)
 *  - Overshoot + correction for distant targets (Fitts's Law)
 *  - Micro-jitter / tremor on every point (Gaussian noise)
 *  - Variable speed: accelerate in the middle, decelerate near target
 *  - Random click offset within element bounds (never dead-center)
 *  - Natural pauses: hover hesitation, pre-click dwell
 */

// ── Vector math ──

const vec = {
  add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y }),
  sub: (a, b) => ({ x: a.x - b.x, y: a.y - b.y }),
  mult: (a, s) => ({ x: a.x * s, y: a.y * s }),
  mag: (a) => Math.sqrt(a.x * a.x + a.y * a.y),
  unit: (a) => { const m = vec.mag(a); return m === 0 ? { x: 0, y: 0 } : { x: a.x / m, y: a.y / m }; },
  perp: (a) => ({ x: a.y, y: -a.x }),
  setMag: (a, m) => vec.mult(vec.unit(a), m),
  lerp: (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }),
};

// ── Random helpers ──

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

/** Box-Muller Gaussian random with mean=0, stddev=1 */
function gaussRandom() {
  let u, v, s;
  do {
    u = Math.random() * 2 - 1;
    v = Math.random() * 2 - 1;
    s = u * u + v * v;
  } while (s >= 1 || s === 0);
  return u * Math.sqrt(-2 * Math.log(s) / s);
}

/** Gaussian random with given mean and stddev */
function gauss(mean, stddev) {
  return mean + gaussRandom() * stddev;
}

// ── Bezier curve generation ──

/**
 * Generate cubic Bezier control points with perpendicular offset.
 * Control points are placed on the same side of the line (humans don't
 * make S-curves when moving to a target).
 */
function bezierControlPoints(start, end, spread) {
  const dir = vec.sub(end, start);
  const dist = vec.mag(dir);
  const clampedSpread = Math.max(2, Math.min(dist * 0.5, spread || dist * 0.3));

  const side = Math.random() > 0.5 ? 1 : -1;

  const makeCP = () => {
    const t = rand(0.2, 0.8);
    const midPoint = vec.lerp(start, end, t);
    const normal = vec.setMag(vec.perp(dir), clampedSpread * rand(0.3, 1.0) * side);
    return vec.add(midPoint, normal);
  };

  const cp1 = makeCP();
  const cp2 = makeCP();

  const proj = (p) => {
    const d = vec.sub(p, start);
    return (d.x * dir.x + d.y * dir.y) / (dist * dist);
  };
  return proj(cp1) <= proj(cp2) ? [cp1, cp2] : [cp2, cp1];
}

/**
 * Evaluate cubic Bezier at parameter t in [0, 1].
 */
function cubicBezier(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

// ── Path generation ──

/**
 * Generate a human-like mouse path between two points.
 *
 * @param {Object} from - {x, y} start position
 * @param {Object} to   - {x, y} end position
 * @param {Object} opts
 * @param {number} opts.steps        - approximate number of points (default: auto via Fitts's Law)
 * @param {number} opts.tremor       - micro-jitter stddev in pixels (default: 1.2)
 * @param {number} opts.spread       - bezier control point spread (default: auto)
 * @param {number} opts.targetWidth  - target element width for Fitts's Law (default: 50)
 * @returns {Array<{x: number, y: number, dt: number}>} path points with inter-point delay in ms
 */
function generatePath(from, to, opts = {}) {
  const dist = vec.mag(vec.sub(to, from));
  if (dist < 1) return [{ x: to.x, y: to.y, dt: 0 }];

  const targetWidth = opts.targetWidth || 50;
  const tremor = opts.tremor ?? 1.2;

  // Fitts's Law: movement time proportional to log2(distance / width + 1)
  const fittsTime = Math.log2(dist / targetWidth + 1);
  const baseSteps = opts.steps || Math.max(15, Math.round(fittsTime * 18 + rand(5, 15)));

  const [cp1, cp2] = bezierControlPoints(from, to, opts.spread);
  const points = [];

  for (let i = 0; i <= baseSteps; i++) {
    const t = i / baseSteps;

    // Smootherstep ease-in-out (Ken Perlin)
    const eased = t * t * t * (t * (t * 6 - 15) + 10);

    const p = cubicBezier(from, cp1, cp2, to, eased);

    // Micro-tremor decreases near target
    const tremorScale = 1 - Math.pow(t, 2);
    const jx = gauss(0, tremor * tremorScale);
    const jy = gauss(0, tremor * tremorScale);

    // Variable speed: slower at start/end, faster in middle
    const speedFactor = 0.3 + 0.7 * Math.sin(Math.PI * t);
    const baseDt = rand(4, 12);
    const dt = baseDt / Math.max(speedFactor, 0.3);

    points.push({
      x: Math.round(p.x + jx),
      y: Math.round(p.y + jy),
      dt: Math.round(dt),
    });
  }

  // Snap last point to exact target
  points[points.length - 1] = { x: Math.round(to.x), y: Math.round(to.y), dt: rand(2, 6) };

  return points;
}

/**
 * Generate an overshoot path: move past the target, then correct back.
 * Triggered for distant targets (>300px).
 */
function generateOvershootPath(from, to, opts = {}) {
  const dist = vec.mag(vec.sub(to, from));
  const overshootDist = rand(8, Math.min(35, dist * 0.08));

  const dir = vec.unit(vec.sub(to, from));
  const overshootPoint = vec.add(to, vec.mult(dir, overshootDist));
  const perpOffset = vec.mult(vec.perp(dir), gauss(0, overshootDist * 0.4));
  const overshootTarget = vec.add(overshootPoint, perpOffset);

  // First leg: fast move to overshoot point
  const leg1 = generatePath(from, overshootTarget, { ...opts, tremor: (opts.tremor ?? 1.2) * 1.3 });

  // Brief pause at overshoot (micro-hesitation)
  if (leg1.length > 0) {
    leg1[leg1.length - 1].dt = Math.round(rand(40, 120));
  }

  // Second leg: slow correction to actual target
  const leg2 = generatePath(overshootTarget, to, {
    ...opts,
    steps: Math.max(8, Math.round(rand(8, 18))),
    tremor: (opts.tremor ?? 1.2) * 0.6,
  });

  return [...leg1, ...leg2];
}

// ── High-level mouse controller ──

/**
 * Create a human mouse controller for a Playwright page.
 *
 * @param {Object} page - Playwright page instance
 * @param {Object} opts
 * @param {boolean} opts.debug       - Show visible red cursor dot (default: false)
 * @param {Function} opts.log        - Logging function (default: no-op). Set to console.log for output.
 * @param {Object} opts.startPos     - Initial cursor position {x, y}
 */
function createHumanMouse(page, opts = {}) {
  const log = opts.log || (() => {});
  const debug = opts.debug ?? false;
  let cursorPos = opts.startPos || { x: Math.round(rand(100, 350)), y: Math.round(rand(300, 500)) };

  async function ensureVisibleCursor() {
    if (!debug) return;
    try {
      const exists = await page.evaluate(() => !!document.getElementById('ghost-cursor'));
      if (exists) return;

      await page.evaluate(() => {
        const dot = document.createElement('div');
        dot.id = 'ghost-cursor';
        dot.style.cssText = 'pointer-events:none;position:fixed;z-index:99999;width:20px;height:20px;background:rgba(255,0,0,0.5);border:2px solid white;border-radius:50%;margin:-10px 0 0 -10px;transition:left 0.05s,top 0.05s;left:-50px;top:-50px;';
        document.body.appendChild(dot);
        document.addEventListener('mousemove', e => {
          dot.style.left = e.clientX + 'px';
          dot.style.top = e.clientY + 'px';
        });
      });
    } catch (e) {
      // Context may have been destroyed, retry next time
    }
  }

  /**
   * Move mouse along a human-like path to target coordinates.
   */
  async function moveTo(x, y, moveOpts = {}) {
    const target = { x, y };
    const dist = vec.mag(vec.sub(target, cursorPos));

    const overshootThreshold = moveOpts.overshootThreshold ?? 300;
    const shouldOvershoot = dist > overshootThreshold && Math.random() > 0.3;

    const path = shouldOvershoot
      ? generateOvershootPath(cursorPos, target, moveOpts)
      : generatePath(cursorPos, target, moveOpts);

    await ensureVisibleCursor();

    for (const point of path) {
      await page.mouse.move(point.x, point.y);
      if (point.dt > 0) {
        await page.waitForTimeout(point.dt);
      }
    }

    cursorPos = { x, y };
  }

  /**
   * Move to a random point within an element's bounding box (never dead center).
   * @param {Object} box - {x, y, width, height}
   * @returns {{x: number, y: number}} the actual target point
   */
  async function moveToElement(box, moveOpts = {}) {
    const padX = box.width * 0.15;
    const padY = box.height * 0.15;
    const targetX = Math.round(box.x + padX + rand(0, box.width - 2 * padX));
    const targetY = Math.round(box.y + padY + rand(0, box.height - 2 * padY));

    await moveTo(targetX, targetY, { ...moveOpts, targetWidth: box.width });
    return { x: targetX, y: targetY };
  }

  /**
   * Click at current position with human-like press/release timing.
   */
  async function click(clickOpts = {}) {
    await page.waitForTimeout(Math.round(rand(60, 180)));
    await page.mouse.down({ button: clickOpts.button || 'left' });
    await page.waitForTimeout(Math.round(rand(50, 120)));
    await page.mouse.up({ button: clickOpts.button || 'left' });
    await page.waitForTimeout(Math.round(rand(80, 200)));
  }

  /**
   * Move to element and click.
   */
  async function moveAndClick(box, label, clickOpts = {}) {
    const target = await moveToElement(box, clickOpts);
    log(`[mouse] ${label || 'element'} -> (${target.x}, ${target.y})`);
    await page.waitForTimeout(Math.round(rand(100, 400)));
    await click(clickOpts);
    return target;
  }

  /**
   * Perform idle/ambient mouse movement (small drifts to look alive).
   * @param {number} durationMs - How long to drift in milliseconds
   */
  async function idleDrift(durationMs = 2000) {
    const steps = Math.round(durationMs / rand(200, 500));
    for (let i = 0; i < steps; i++) {
      const dx = gauss(0, 3);
      const dy = gauss(0, 3);
      const next = {
        x: Math.round(cursorPos.x + dx),
        y: Math.round(cursorPos.y + dy),
      };
      await page.mouse.move(next.x, next.y);
      cursorPos = next;
      await page.waitForTimeout(Math.round(rand(150, 400)));
    }
  }

  /**
   * Scroll with human-like behavior (variable speed, small overshoots).
   * @param {number} deltaY - Pixels to scroll (positive = down, negative = up)
   */
  async function humanScroll(deltaY) {
    const steps = Math.round(rand(3, 6));
    const perStep = deltaY / steps;

    for (let i = 0; i < steps; i++) {
      const scrollAmount = perStep + gauss(0, Math.abs(perStep) * 0.15);
      await page.mouse.wheel(0, Math.round(scrollAmount));
      await page.waitForTimeout(Math.round(rand(60, 150)));
    }

    await page.waitForTimeout(Math.round(rand(200, 500)));
  }

  return {
    moveTo,
    moveToElement,
    click,
    moveAndClick,
    idleDrift,
    humanScroll,
    get position() { return { ...cursorPos }; },
    set position(p) { cursorPos = { x: p.x, y: p.y }; },
  };
}

// ── Human-like keyboard typing ──

/**
 * Type text with human-like per-character delays, occasional micro-pauses,
 * and variable key press/release timing.
 *
 * @param {Object} page - Playwright page instance
 * @param {string} text - Text to type
 * @param {Object} opts
 * @param {number} opts.baseDelay - ms between keystrokes (default: 65)
 * @param {number} opts.variance  - random variance (default: 35)
 */
async function humanType(page, text, opts = {}) {
  const baseDelay = opts.baseDelay || 65;
  const variance = opts.variance || 35;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    // Occasional pause (thinking hesitation) - ~8% chance
    if (Math.random() < 0.08 && i > 0) {
      await page.waitForTimeout(Math.round(rand(200, 600)));
    }

    // Pause slightly longer after punctuation
    if (',. ;:!?'.includes(text[i - 1] || '')) {
      await page.waitForTimeout(Math.round(rand(80, 200)));
    }

    await page.keyboard.press(char);

    const delay = Math.max(20, gauss(baseDelay, variance));
    await page.waitForTimeout(Math.round(delay));
  }
}

module.exports = {
  createHumanMouse,
  humanType,
  generatePath,
  generateOvershootPath,
  vec,
  gauss,
  bezierControlPoints,
  cubicBezier,
};
