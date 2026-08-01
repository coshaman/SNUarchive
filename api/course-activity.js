const { handleError, method, repo, requireUser, sendJson } = require("./_utils");

module.exports = async function handler(req, res) {
  try {
    method(req, ["GET"]);
    await requireUser(req);
    const activity = await repo().courseActivity();
    sendJson(res, 200, activity);
  } catch (error) {
    await handleError(res, error);
  }
};
