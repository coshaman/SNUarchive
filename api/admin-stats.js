const {
  buildStatUpdatePayload,
  clampLimit,
  clampOffset,
  createError,
  handleError,
  method,
  publicStat,
  readJson,
  recordAction,
  repo,
  requireAdmin,
  sendJson
} = require("./_utils");

module.exports = async function handler(req, res) {
  try {
    method(req, ["GET", "PATCH"]);
    const admin = await requireAdmin(req);
    const store = repo();

    if (req.method === "GET") {
      const url = new URL(req.url, "http://localhost");
      const limit = clampLimit(url.searchParams.get("limit"), 10, 100);
      const offset = clampOffset(url.searchParams.get("offset"));
      const stats = await store.listAllStats(limit, offset);
      sendJson(res, 200, {
        stats: stats.map(publicStat),
        limit,
        offset,
        hasMore: stats.length === limit
      });
      return;
    }

    const body = await readJson(req);
    const id = String(body.id || "").trim();
    if (!id) throw createError(400, "통계량 ID가 필요합니다.");

    const stat = await store.updateStat(id, buildStatUpdatePayload(body));
    await recordAction(admin, "stat_update", {
      statId: id,
      courseTitle: stat.course_title,
      assessmentLabel: stat.assessment_label
    });
    sendJson(res, 200, { stat: publicStat(stat) });
  } catch (error) {
    await handleError(res, error);
  }
};
