const { isDemoAuthAllowed, isGoogleAuthConfigured, sendJson } = require("./_utils");

module.exports = async function handler(req, res) {
  sendJson(res, 200, {
    authMode: isGoogleAuthConfigured() ? "google" : "none",
    googleAuth: isGoogleAuthConfigured(),
    loginUrl: "/api/auth/google/start",
    demoAuth: isDemoAuthAllowed(),
    uploadLimitMb: 3
  });
};
