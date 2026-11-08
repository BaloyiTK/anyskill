const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
const enhanceMiddleware = config.server.enhanceMiddleware;

config.server.enhanceMiddleware = (middleware, metroServer) => {
  const enhancedMiddleware = enhanceMiddleware
    ? enhanceMiddleware(middleware, metroServer)
    : middleware;

  return (req, res, next) => {
    // Keep the Google OAuth popup connected to the Expo web app so
    // expo-auth-session can detect and complete the redirect.
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
    return enhancedMiddleware(req, res, next);
  };
};

module.exports = config;
