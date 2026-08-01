const { clearSessionCookie, sendJson } = require("../_utils");

module.exports = async function handler(_req, res) {
  clearSessionCookie(res);
  sendJson(res, 200, { ok: true });
};
