const {
  createHumanMouse,
  humanType,
  generatePath,
  generateOvershootPath,
  vec,
  gauss,
  bezierControlPoints,
  cubicBezier,
} = require('./human-mouse');

const {
  DEFAULT_FINGERPRINT,
  applyStealthScripts,
  getStealthArgs,
  createStealthContext,
} = require('./browser-stealth');

module.exports = {
  // Mouse
  createHumanMouse,
  humanType,
  generatePath,
  generateOvershootPath,

  // Stealth
  DEFAULT_FINGERPRINT,
  applyStealthScripts,
  getStealthArgs,
  createStealthContext,

  // Low-level (for advanced use / testing)
  vec,
  gauss,
  bezierControlPoints,
  cubicBezier,
};
