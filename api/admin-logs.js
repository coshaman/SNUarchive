const {
  clampLimit,
  clampOffset,
  handleError,
  method,
  repo,
  requireAdmin,
  sendJson
} = require("./_utils");

module.exports = async function handler(req, res) {
  try {
    method(req, ["GET", "DELETE"]);
    await requireAdmin(req);
    const store = repo();

    if (req.method === "DELETE") {
      await store.clearLogs();
      sendJson(res, 200, { ok: true });
      return;
    }

    const url = new URL(req.url, "http://localhost");
    const exportMode = url.searchParams.get("export") === "1";
    const limit = exportMode ? clampLimit(url.searchParams.get("limit"), 5000, 5000) : clampLimit(url.searchParams.get("limit"), 50, 500);
    const offset = exportMode ? 0 : clampOffset(url.searchParams.get("offset"));
    const logs = await store.listLogs(limit, offset);
    sendJson(res, 200, {
      logs,
      limit,
      offset,
      hasMore: !exportMode && logs.length === limit
    });
  } catch (error) {
    await handleError(res, error);
  }
};
