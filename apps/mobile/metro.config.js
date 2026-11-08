const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Apply the COOP header before Metro handles every request, including the
// web document used to open the Google OAuth popup.
config.server.unstable_priorityMiddleware = [
  ...(config.server.unstable_priorityMiddleware ?? []),
  (req, res, next) => {
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
    next();
  },
];

module.exports = config;
