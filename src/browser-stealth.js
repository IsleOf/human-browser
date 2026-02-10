/**
 * Browser stealth patches for rebrowser-playwright.
 *
 * Targets common detection vectors:
 *  - navigator.webdriver removal
 *  - Chrome runtime object spoofing
 *  - WebGL renderer/vendor masking
 *  - Plugin & mimeType array population
 *  - Permission query patching
 *  - Canvas fingerprint noise injection
 *  - CDP (Chrome DevTools Protocol) detection bypass
 *  - Consistent screen/viewport metrics
 *
 * All fingerprint values are configurable via the `fingerprint` option.
 */

const DEFAULT_FINGERPRINT = {
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
  platform: 'MacIntel',
  languages: ['en-US', 'en'],
  hardwareConcurrency: 8,
  deviceMemory: 8,
  webglVendor: 'Google Inc. (Apple)',
  webglRenderer: 'ANGLE (Apple, Apple M1 Pro, OpenGL 4.1)',
  outerHeightOffset: 78, // macOS Chrome UI chrome height
  viewport: { width: 1920, height: 1080 },
  locale: 'en-US',
  timezoneId: 'America/New_York',
  colorScheme: 'no-preference',
};

/**
 * Apply all stealth init scripts to a browser context.
 *
 * @param {Object} context - Playwright BrowserContext
 * @param {Object} fingerprint - Fingerprint overrides (merged with defaults)
 */
async function applyStealthScripts(context, fingerprint = {}) {
  const fp = { ...DEFAULT_FINGERPRINT, ...fingerprint };

  await context.addInitScript((fp) => {
    // ── 1. navigator.webdriver ──
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
      configurable: true,
    });

    // ── 2. Chrome runtime object ──
    if (!window.chrome) {
      window.chrome = {};
    }
    window.chrome.runtime = {
      connect: () => {},
      sendMessage: () => {},
      onMessage: { addListener: () => {}, removeListener: () => {} },
      id: undefined,
    };
    window.chrome.loadTimes = () => ({
      requestTime: Date.now() / 1000 - Math.random() * 5,
      startLoadTime: Date.now() / 1000 - Math.random() * 3,
      commitLoadTime: Date.now() / 1000 - Math.random() * 2,
      finishDocumentLoadTime: Date.now() / 1000 - Math.random(),
      finishLoadTime: Date.now() / 1000,
      firstPaintTime: Date.now() / 1000 - Math.random() * 0.5,
      firstPaintAfterLoadTime: 0,
      navigationType: 'Other',
      wasFetchedViaSpdy: true,
      wasNpnNegotiated: true,
      npnNegotiatedProtocol: 'h2',
      wasAlternateProtocolAvailable: false,
      connectionInfo: 'h2',
    });
    window.chrome.csi = () => ({
      onloadT: Date.now(),
      startE: Date.now() - Math.round(Math.random() * 2000),
      pageT: Math.random() * 5000,
      tran: 15,
    });

    // ── 3. Languages ──
    Object.defineProperty(navigator, 'languages', {
      get: () => fp.languages,
      configurable: true,
    });
    Object.defineProperty(navigator, 'language', {
      get: () => fp.languages[0],
      configurable: true,
    });

    // ── 4. Plugins (non-empty array) ──
    Object.defineProperty(navigator, 'plugins', {
      get: () => {
        const plugins = [
          { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
          { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
          { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
        ];
        plugins.refresh = () => {};
        Object.setPrototypeOf(plugins, PluginArray.prototype);
        return plugins;
      },
      configurable: true,
    });

    // ── 5. MimeTypes ──
    Object.defineProperty(navigator, 'mimeTypes', {
      get: () => {
        const mimes = [
          { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
          { type: 'application/x-google-chrome-pdf', suffixes: 'pdf', description: 'Portable Document Format' },
        ];
        Object.setPrototypeOf(mimes, MimeTypeArray.prototype);
        return mimes;
      },
      configurable: true,
    });

    // ── 6. Hardware concurrency ──
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      get: () => fp.hardwareConcurrency,
      configurable: true,
    });

    // ── 7. Device memory ──
    Object.defineProperty(navigator, 'deviceMemory', {
      get: () => fp.deviceMemory,
      configurable: true,
    });

    // ── 8. Platform ──
    Object.defineProperty(navigator, 'platform', {
      get: () => fp.platform,
      configurable: true,
    });

    // ── 9. Connection ──
    if (navigator.connection) {
      Object.defineProperty(navigator.connection, 'rtt', { get: () => 50, configurable: true });
      Object.defineProperty(navigator.connection, 'downlink', { get: () => 10, configurable: true });
      Object.defineProperty(navigator.connection, 'effectiveType', { get: () => '4g', configurable: true });
    }

    // ── 10. Permissions ──
    const originalQuery = navigator.permissions?.query?.bind(navigator.permissions);
    if (originalQuery) {
      navigator.permissions.query = (params) => {
        if (params.name === 'notifications') {
          return Promise.resolve({ state: Notification.permission, onchange: null });
        }
        return originalQuery(params);
      };
    }

    // ── 11. WebGL renderer masking ──
    const getParameterOrig = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (param) {
      if (param === 0x9245) return fp.webglVendor;
      if (param === 0x9246) return fp.webglRenderer;
      return getParameterOrig.call(this, param);
    };
    if (typeof WebGL2RenderingContext !== 'undefined') {
      const getParam2Orig = WebGL2RenderingContext.prototype.getParameter;
      WebGL2RenderingContext.prototype.getParameter = function (param) {
        if (param === 0x9245) return fp.webglVendor;
        if (param === 0x9246) return fp.webglRenderer;
        return getParam2Orig.call(this, param);
      };
    }

    // ── 12. Canvas fingerprint noise ──
    const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function (type, quality) {
      if (this.width > 16 && this.height > 16) {
        try {
          const ctx = this.getContext('2d');
          if (ctx) {
            const imageData = ctx.getImageData(0, 0, Math.min(this.width, 4), Math.min(this.height, 4));
            for (let i = 0; i < imageData.data.length; i += 4) {
              imageData.data[i] = Math.max(0, Math.min(255, imageData.data[i] + (Math.random() > 0.5 ? 1 : -1)));
            }
            ctx.putImageData(imageData, 0, 0);
          }
        } catch (e) { /* cross-origin canvas, skip */ }
      }
      return origToDataURL.call(this, type, quality);
    };

    // ── 13. Remove automation signals from Error stack traces ──
    const origPrepare = Error.prepareStackTrace;
    Error.prepareStackTrace = function (err, stack) {
      const filtered = stack.filter(frame => {
        const fn = frame.getFileName() || '';
        return !fn.includes('pptr:') && !fn.includes('__playwright');
      });
      if (origPrepare) return origPrepare(err, filtered);
      return err.toString() + '\n' + filtered.map(f => '    at ' + f.toString()).join('\n');
    };

    // ── 14. Consistent window dimensions ──
    Object.defineProperty(window, 'outerWidth', { get: () => window.innerWidth, configurable: true });
    Object.defineProperty(window, 'outerHeight', { get: () => window.innerHeight + fp.outerHeightOffset, configurable: true });
  }, fp);
}

/**
 * Get browser launch args for stealth.
 * @returns {string[]} Chromium launch arguments
 */
function getStealthArgs() {
  return [
    '--disable-blink-features=AutomationControlled',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-features=IsolateOrigins,site-per-process',
    '--disable-web-security',
    '--disable-setuid-sandbox',
    '--window-size=1920,1080',
    '--disable-features=AutomationControlled',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-ipc-flooding-protection',
    '--enable-features=NetworkService,NetworkServiceInProcess',
    '--force-color-profile=srgb',
    '--metrics-recording-only',
    '--no-first-run',
    '--password-store=basic',
    '--use-mock-keychain',
    '--export-tagged-pdf',
    '--lang=en-US',
  ];
}

/**
 * Create a stealth browser context with realistic fingerprint.
 *
 * @param {Object} browser - Playwright Browser instance
 * @param {Object} opts
 * @param {Object} opts.fingerprint    - Fingerprint overrides (merged with DEFAULT_FINGERPRINT)
 * @param {string} opts.locale         - Browser locale (default: from fingerprint)
 * @param {string} opts.timezoneId     - Timezone (default: from fingerprint)
 * @param {string} opts.colorScheme    - 'dark', 'light', or 'no-preference'
 * @param {Object} opts.storageState   - Playwright storageState to restore cookies/localStorage
 * @returns {Object} Playwright BrowserContext
 */
async function createStealthContext(browser, opts = {}) {
  const fp = { ...DEFAULT_FINGERPRINT, ...(opts.fingerprint || {}) };

  const contextOpts = {
    userAgent: fp.userAgent,
    locale: opts.locale || fp.locale,
    timezoneId: opts.timezoneId || fp.timezoneId,
    viewport: fp.viewport,
    deviceScaleFactor: 1,
    hasTouch: false,
    isMobile: false,
    screen: fp.viewport,
    colorScheme: opts.colorScheme || fp.colorScheme,
    reducedMotion: 'no-preference',
    forcedColors: 'none',
  };

  if (opts.storageState) {
    contextOpts.storageState = opts.storageState;
  }

  const context = await browser.newContext(contextOpts);
  await applyStealthScripts(context, fp);
  return context;
}

module.exports = {
  DEFAULT_FINGERPRINT,
  applyStealthScripts,
  getStealthArgs,
  createStealthContext,
};
