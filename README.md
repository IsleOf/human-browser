# human-browser

> Drop-in human behavior layer for Playwright. Bezier-curve mouse movement, natural typing, and browser fingerprint stealth — so your automation looks like a real person.

Most bot detection (DataDome, hCaptcha, PerimeterX, Cloudflare Turnstile) catches automation through two signals: **behavioral analysis** (straight-line mouse paths, instant clicks, robotic typing) and **browser fingerprinting** (navigator.webdriver, missing Chrome APIs, WebGL mismatches). This library defeats both.

Built on [rebrowser-playwright-core](https://github.com/nicknisi/rebrowser-playwright-core), a Playwright fork that patches the `Runtime.enable` CDP leak — the most common headless detection vector.

## Why not just use Puppeteer Extra / Stealth Plugin?

- **Puppeteer Stealth** only patches fingerprints. It doesn't make your mouse move like a human — you still teleport and click at element centers.
- **ghost-cursor** generates nice paths but doesn't integrate stealth, doesn't handle typing, and doesn't work with rebrowser's CDP-patched architecture.
- **human-browser** gives you both in one package: realistic input behavior + fingerprint stealth, designed to work together.

---

## Install

```bash
npm install human-browser rebrowser-playwright-core
```

You also need a Chromium binary. rebrowser-playwright ships one, or point to your own Chrome install.

## Quick Start

```js
const { chromium } = require('rebrowser-playwright-core');
const {
  createHumanMouse,
  humanType,
  getStealthArgs,
  createStealthContext,
} = require('human-browser');

(async () => {
  const browser = await chromium.launch({
    headless: false,
    executablePath: '/path/to/chrome', // or let rebrowser find it
    args: getStealthArgs(),
  });

  // Creates a context with all 14 stealth patches applied
  const context = await createStealthContext(browser);
  const page = await context.newPage();

  // Create mouse controller (debug: true shows a red dot cursor)
  const mouse = createHumanMouse(page, {
    debug: true,
    log: console.log,
  });

  await page.goto('https://example.com');

  // Click a button — moves along a Bezier curve, not a straight line
  const btn = await page.locator('button').boundingBox();
  await mouse.moveAndClick(btn, 'Submit');

  // Type in a field — with per-key delays, hesitations, punctuation pauses
  await page.locator('input[name="search"]').click();
  await humanType(page, 'searching for something');

  // Scroll down naturally (variable speed, micro-overshoots)
  await mouse.humanScroll(500);

  // Keep the cursor alive during a wait (small ambient drifts)
  await mouse.idleDrift(3000);

  await browser.close();
})();
```

## Features

### Mouse Movement

Real humans don't move mice in straight lines. They follow curved paths, overshoot targets, jitter slightly, and slow down as they approach. This library replicates all of that:

| Behavior | How it works |
|----------|-------------|
| **Curved paths** | Cubic Bezier curves with perpendicular-offset control points. Both control points are on the same side (humans don't make S-curves). |
| **Speed profile** | Smootherstep ease-in-out (Ken Perlin). Starts slow, accelerates through the middle, decelerates near the target. |
| **Fitts's Law** | Movement duration scales with `log2(distance / targetWidth + 1)`. Farther targets get more path points = longer, more realistic movement. |
| **Micro-tremor** | Gaussian noise (Box-Muller) on every path point. Tremor decreases near the target — just like a real hand stabilizing. |
| **Overshoot** | For targets >300px away, 70% chance of overshooting by 8-35px, pausing briefly (40-120ms), then correcting with a slower, steadier path. |
| **Click targeting** | Clicks land at a random point within the inner 70% of the element — never dead-center, never at the edge. |
| **Click timing** | Pre-click dwell (60-180ms), mouse-down hold (50-120ms), post-click settle (80-200ms). |
| **Idle drift** | Small Gaussian drifts (~3px stddev) during wait periods so the cursor looks "alive". |
| **Scrolling** | Broken into 3-6 variable-speed steps with Gaussian variation per step. |

### Keyboard

| Behavior | How it works |
|----------|-------------|
| **Per-key delay** | Gaussian distribution around 65ms (configurable) with 35ms variance |
| **Thinking pauses** | ~8% chance of a 200-600ms pause between characters (simulating thought) |
| **Punctuation pauses** | Extra 80-200ms delay after `, . ; : ! ?` |

### Browser Stealth

14 detection vectors patched via `addInitScript` (survives navigations):

| # | Vector | Patch |
|---|--------|-------|
| 1 | `navigator.webdriver` | Returns `undefined` |
| 2 | Chrome runtime | Spoofs `chrome.runtime`, `chrome.loadTimes()`, `chrome.csi()` |
| 3 | Languages | Configurable `navigator.languages` / `navigator.language` |
| 4 | Plugins | Populates with Chrome PDF Plugin, PDF Viewer, Native Client |
| 5 | MimeTypes | Populates with `application/pdf` types |
| 6 | Hardware concurrency | Configurable (default: 8 cores) |
| 7 | Device memory | Configurable (default: 8 GB) |
| 8 | Platform | Configurable (default: `MacIntel`) |
| 9 | Connection | Sets `rtt: 50`, `downlink: 10`, `effectiveType: '4g'` |
| 10 | Permissions | Patches `navigator.permissions.query` for notifications |
| 11 | WebGL | Masks `UNMASKED_VENDOR` and `UNMASKED_RENDERER` (configurable) |
| 12 | Canvas | Injects +-1 noise on RGB channels (invisible, changes fingerprint hash) |
| 13 | Stack traces | Strips `pptr:` and `__playwright` frames from `Error.prepareStackTrace` |
| 14 | Window dimensions | `outerWidth` matches `innerWidth`, `outerHeight` = `innerHeight` + chrome offset |

---

## API Reference

### `createHumanMouse(page, opts?)`

Creates a mouse controller bound to a Playwright page. Tracks cursor position internally — no teleporting.

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `debug` | `boolean` | `false` | Injects a visible red dot that follows the cursor |
| `log` | `function` | no-op | Called with movement labels, e.g. `log('[mouse] Submit -> (423, 189)')` |
| `startPos` | `{x, y}` | random | Initial cursor position (defaults to random spot in upper-left area) |

**Methods:**

| Method | Description |
|--------|-------------|
| `moveTo(x, y, opts?)` | Move along a Bezier curve to exact coordinates |
| `moveToElement(box, opts?)` | Move to a random point within a `{x, y, width, height}` bounding box |
| `click(opts?)` | Click at current position with realistic press/release timing |
| `moveAndClick(box, label?, opts?)` | Combine `moveToElement` + hover pause + `click` |
| `idleDrift(durationMs?)` | Ambient micro-movements for `durationMs` (default 2000) |
| `humanScroll(deltaY)` | Scroll by `deltaY` pixels with variable speed (positive = down) |
| `position` | Getter/setter for current cursor `{x, y}` |

### `humanType(page, text, opts?)`

Type text character-by-character with human timing.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `baseDelay` | `number` | `65` | Average ms between keystrokes |
| `variance` | `number` | `35` | Gaussian standard deviation for delay |

### `createStealthContext(browser, opts?)`

Create a Playwright `BrowserContext` with all stealth patches pre-applied.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `fingerprint` | `object` | `DEFAULT_FINGERPRINT` | Override any fingerprint value (see below) |
| `locale` | `string` | `'en-US'` | Browser locale |
| `timezoneId` | `string` | `'America/New_York'` | Timezone ID |
| `colorScheme` | `string` | `'no-preference'` | `'dark'`, `'light'`, or `'no-preference'` |
| `storageState` | `object` | — | Playwright storageState to restore cookies/localStorage |

### `DEFAULT_FINGERPRINT`

Ships with a macOS Chrome 133 profile. Override any field:

```js
const { DEFAULT_FINGERPRINT } = require('human-browser');

// Use Windows fingerprint instead
const context = await createStealthContext(browser, {
  fingerprint: {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    platform: 'Win32',
    webglVendor: 'Google Inc. (NVIDIA)',
    webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3080, OpenGL 4.5)',
    outerHeightOffset: 40, // Windows Chrome UI height
  },
  colorScheme: 'dark',
});
```

All defaults:

| Field | Default |
|-------|---------|
| `userAgent` | Chrome 133 macOS |
| `platform` | `'MacIntel'` |
| `languages` | `['en-US', 'en']` |
| `hardwareConcurrency` | `8` |
| `deviceMemory` | `8` |
| `webglVendor` | `'Google Inc. (Apple)'` |
| `webglRenderer` | `'ANGLE (Apple, Apple M1 Pro, OpenGL 4.1)'` |
| `outerHeightOffset` | `78` (macOS Chrome toolbar height) |
| `viewport` | `{ width: 1920, height: 1080 }` |
| `locale` | `'en-US'` |
| `timezoneId` | `'America/New_York'` |
| `colorScheme` | `'no-preference'` |

### `getStealthArgs()`

Returns an array of Chromium CLI flags for stealth mode. Pass to `chromium.launch({ args })`.

### `applyStealthScripts(context, fingerprint?)`

Apply stealth init scripts to an existing context. Called automatically by `createStealthContext`, but available if you need to apply patches to a context you created yourself.

### Low-level Exports

For advanced use, path visualization, or testing:

| Export | Description |
|--------|-------------|
| `generatePath(from, to, opts?)` | Generate a Bezier path as an array of `{x, y, dt}` points |
| `generateOvershootPath(from, to, opts?)` | Generate a path with overshoot + correction leg |
| `vec` | 2D vector math utilities (`add`, `sub`, `mult`, `mag`, `unit`, `perp`, `lerp`, `setMag`) |
| `gauss(mean, stddev)` | Gaussian random number (Box-Muller transform) |
| `bezierControlPoints(start, end, spread?)` | Generate cubic Bezier control points |
| `cubicBezier(p0, p1, p2, p3, t)` | Evaluate cubic Bezier at parameter `t` |

---

## Examples

### Session Persistence

Save and restore browser state between runs to maintain cookies and appear as a returning user:

```js
const fs = require('fs');

// Save after a session
const state = await context.storageState();
fs.writeFileSync('state.json', JSON.stringify(state));

// Restore on next run
const savedState = JSON.parse(fs.readFileSync('state.json', 'utf8'));
const context = await createStealthContext(browser, {
  storageState: savedState,
});
```

### Form Filling

```js
const mouse = createHumanMouse(page, { log: console.log });

// Click into a field, then type
const emailBox = await page.locator('input[name="email"]').boundingBox();
await mouse.moveAndClick(emailBox, 'Email field');
await humanType(page, 'user@example.com');

// Tab to next field
await page.keyboard.press('Tab');
await page.waitForTimeout(200);
await humanType(page, 'my-password-123');

// Click submit
const submitBox = await page.locator('button[type="submit"]').boundingBox();
await mouse.moveAndClick(submitBox, 'Submit');
```

### Warm-up Browsing

Make the session look natural before performing the target action:

```js
const mouse = createHumanMouse(page);

await page.goto('https://example.com');
await page.waitForTimeout(3000);

// Browse around naturally
await mouse.humanScroll(300);
await mouse.idleDrift(2000);
await mouse.humanScroll(200);
await mouse.idleDrift(1500);
await mouse.humanScroll(-250); // scroll back up

// Now navigate to the actual target page
```

---

## How It Works Under the Hood

### Path Generation

```
Start ●                                    ● End
       \                                  /
        \   cp1 ○                        /
         \       \                      /
          --------○ cp2 ---------------
                    (Bezier curve with perpendicular offset)
```

1. Two control points are generated at random positions along the start-end line, offset perpendicularly to the same side (no S-curves).
2. The path is sampled at N points using the cubic Bezier formula, where N is determined by Fitts's Law: `log2(distance / targetWidth + 1) * 18 + random(5, 15)`.
3. Each point gets Gaussian tremor noise that fades as `t` approaches 1 (stabilizing near target).
4. Inter-point delays follow a sinusoidal speed profile — slow at edges, fast in the middle.
5. For distant targets (>300px), the path overshoots by 8-35px, pauses 40-120ms, then generates a second shorter correction path with reduced tremor.

### Stealth Architecture

All 14 patches are applied via Playwright's `context.addInitScript()`, which means they:
- Execute before any page JavaScript
- Survive navigations and SPA route changes
- Apply to all pages opened in the context
- Cannot be detected by the page (they run in the main world, not an isolated world)

Combined with rebrowser-playwright-core's CDP leak patches, this makes the automation browser indistinguishable from a regular Chrome instance in standard detection tests.

## License

MIT
