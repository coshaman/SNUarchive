const {
  clearOAuthStateCookie,
  createError,
  isGoogleAuthConfigured,
  redirect,
  recordAction,
  requestOrigin,
  setSessionCookie,
  verifyOAuthState
} = require("../../_utils");

function decodeJwtPayload(token) {
  const payload = String(token || "").split(".")[1];
  if (!payload) throw createError(401, "Google 응답을 확인할 수 없습니다.");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

function safeRedirect(res, origin, status) {
  const target = new URL("/", origin);
  if (status) target.searchParams.set("auth", status);
  redirect(res, target.toString());
}

module.exports = async function handler(req, res) {
  const origin = requestOrigin(req);

  try {
    if (!isGoogleAuthConfigured()) throw createError(500, "Google OAuth 환경변수가 설정되지 않았습니다.");

    const url = new URL(req.url, origin);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const oauthError = url.searchParams.get("error");

    clearOAuthStateCookie(res);
    if (oauthError) throw createError(401, "Google 로그인이 취소되었습니다.");
    if (!code || !state || !verifyOAuthState(req, state)) {
      throw createError(401, "로그인 요청을 확인할 수 없습니다.");
    }

    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: `${origin}/api/auth/google/callback`,
        grant_type: "authorization_code"
      })
    });
    const token = await response.json();
    if (!response.ok || !token.id_token) {
      throw createError(401, token.error_description || "Google 토큰 교환에 실패했습니다.");
    }

    const claims = decodeJwtPayload(token.id_token);
    const email = String(claims.email || "").toLowerCase();
    const name = String(claims.name || "").trim();
    const verified = claims.email_verified === true || claims.email_verified === "true";
    const issuerOk = claims.iss === "https://accounts.google.com" || claims.iss === "accounts.google.com";
    const audienceOk = claims.aud === process.env.GOOGLE_CLIENT_ID;
    const notExpired = Number(claims.exp || 0) > Math.floor(Date.now() / 1000);

    if (!issuerOk || !audienceOk || !notExpired || !verified) {
      throw createError(401, "Google 계정을 검증하지 못했습니다.");
    }
    if (!email.endsWith("@snu.ac.kr")) {
      throw createError(403, "snu.ac.kr 계정만 사용할 수 있습니다.");
    }

    setSessionCookie(res, email, name);
    await recordAction({ email, name }, "login", { provider: "google" });
    safeRedirect(res, origin, "ok");
  } catch (error) {
    safeRedirect(res, origin, error.statusCode === 403 ? "forbidden" : "error");
  }
};
