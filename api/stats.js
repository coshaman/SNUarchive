const {
  buildStatPayload,
  handleError,
  method,
  publicStat,
  readJson,
  recordAction,
  repo,
  requireUser,
  sendJson
} = require("./_utils");

module.exports = async function handler(req, res) {
  try {
    method(req, ["GET", "POST"]);
    const user = await requireUser(req);
    const store = repo();

    if (req.method === "GET") {
      const url = new URL(req.url, "http://localhost");
      const courseKey = url.searchParams.get("courseKey");
      if (!courseKey) {
        sendJson(res, 200, { stats: [] });
        return;
      }

      const stats = await store.listStats(courseKey);
      sendJson(res, 200, { stats: stats.map(publicStat) });
      return;
    }

    const body = await readJson(req);
    const payload = buildStatPayload(body, user, "direct");
    const stat = await store.insertStat(payload);
    await recordAction(user, "direct_report", {
      courseTitle: stat.course_title,
      instructor: stat.instructor,
      assessmentLabel: stat.assessment_label
    });
    sendJson(res, 201, { stat: publicStat(stat) });
  } catch (error) {
    await handleError(res, error);
  }
};
