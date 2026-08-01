const { createOAuthState, isGoogleAuthConfigured, redirect, requestOrigin, sendJson } = require("../../_utils");

module.exports = async function handler(req, res) {
  if (!isGoogleAuthConfigured()) {
    sendJson(res, 500, { error: "Google OAuth 환경변수가 설정되지 않았습니다." });
    return;
  }

  const origin = requestOrigin(req);
  const state = createOAuthState(res);
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: `${origin}/api/auth/google/callback`,
    response_type: "code",
    scope: "openid email profile",
    access_type: "offline",
    prompt: "select_account",
    hd: "snu.ac.kr",
    state
  });

  redirect(res, `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
};
