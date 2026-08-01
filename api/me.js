const { handleError, method, requireUser, sendJson } = require("./_utils");

module.exports = async function handler(req, res) {
  try {
    method(req, ["GET"]);
    const user = await requireUser(req);
    sendJson(res, 200, {
      email: user.email,
      isAdmin: user.isAdmin
    });
  } catch (error) {
    await handleError(res, error);
  }
};
