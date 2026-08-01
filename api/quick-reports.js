const {
  buildStatPayload,
  clampLimit,
  clampOffset,
  createError,
  decodeUpload,
  handleError,
  method,
  normalizeCourse,
  normalizeNickname,
  normalizeText,
  publicStat,
  readJson,
  recordAction,
  repo,
  requireAdmin,
  requireUser,
  sendJson
} = require("./_utils");

module.exports = async function handler(req, res) {
  try {
    method(req, ["GET", "POST", "PATCH"]);
    const store = repo();

    if (req.method === "GET") {
      await requireAdmin(req);
      const url = new URL(req.url, "http://localhost");
      const reports = await store.listQuickReports({
        status: url.searchParams.get("status") || "pending",
        courseKeyValue: url.searchParams.get("courseKey") || "",
        limit: clampLimit(url.searchParams.get("limit"), 10, 100),
        offset: clampOffset(url.searchParams.get("offset"))
      });
      const limit = clampLimit(url.searchParams.get("limit"), 10, 100);
      const offset = clampOffset(url.searchParams.get("offset"));
      sendJson(res, 200, {
        reports,
        limit,
        offset,
        hasMore: reports.length === limit
      });
      return;
    }

    if (req.method === "POST") {
      const user = await requireUser(req);
      const body = await readJson(req);
      const upload = decodeUpload(body);
      const course = normalizeCourse(body.course);
      const report = await store.createQuickReport(
        {
          ...course,
          assessment_label: normalizeText(body.assessmentLabel || body.assessment_label || "기타", 24),
          nickname: normalizeNickname(body.nickname),
          reporter_email_hash: user.emailHash
        },
        upload
      );
      await recordAction(user, "quick_report", {
        courseTitle: report.course_title,
        instructor: report.instructor,
        assessmentLabel: report.assessment_label,
        fileName: report.file_name
      });
      sendJson(res, 201, { report });
      return;
    }

    const admin = await requireAdmin(req);
    const body = await readJson(req);
    const id = normalizeText(body.id, 80);
    const status = normalizeText(body.status, 20);

    if (!id) throw createError(400, "간편 제보 ID가 필요합니다.");
    if (!["approved", "rejected"].includes(status)) throw createError(400, "처리 상태가 올바르지 않습니다.");

    let stat = null;
    if (status === "approved" && body.stat) {
      const payload = buildStatPayload(body.stat, admin, "quick_report");
      stat = await store.insertStat(payload);
    }

    const report = await store.updateQuickReport(id, {
      status,
      admin_note: normalizeText(body.adminNote, 500) || null,
      reviewed_by_hash: admin.emailHash,
      linked_stat_id: stat?.id || null
    });

    await recordAction(admin, status === "approved" ? "quick_report_approved" : "quick_report_rejected", {
      reportId: id,
      courseTitle: report.course_title,
      status
    });

    sendJson(res, 200, {
      report,
      stat: stat ? publicStat(stat) : null
    });
  } catch (error) {
    await handleError(res, error);
  }
};
