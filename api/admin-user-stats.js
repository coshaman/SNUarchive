const { handleError, method, repo, requireAdmin, sendJson } = require("./_utils");

module.exports = async function handler(req, res) {
  try {
    method(req, ["GET"]);
    await requireAdmin(req);
    const stats = await repo().collegeStats();
    sendJson(res, 200, stats);
  } catch (error) {
    await handleError(res, error);
  }
};
