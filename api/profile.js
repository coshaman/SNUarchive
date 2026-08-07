const {
  createError,
  getClientIp,
  guessAdmissionYearFromEmail,
  handleError,
  method,
  normalizeAdmissionYear,
  normalizeCollege,
  readJson,
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
      const profile = await store.getUserProfile(user);
      sendJson(res, 200, {
        college: profile?.college || null,
        admissionYear: profile?.admission_year || null,
        suggestedAdmissionYear: guessAdmissionYearFromEmail(user.email)
      });
      return;
    }

    const body = await readJson(req);
    const existing = await store.getUserProfile(user);
    const college = body.college !== undefined ? normalizeCollege(body.college) : existing?.college || null;
    const admissionYear =
      body.admissionYear !== undefined ? normalizeAdmissionYear(body.admissionYear) : existing?.admission_year || null;

    if (!college && !admissionYear) {
      throw createError(400, "단과대학 또는 입학년도 중 하나 이상을 입력해주세요.");
    }

    const profile = await store.upsertUserProfile(user, { college, admissionYear }, getClientIp(req));
    sendJson(res, 200, { college: profile.college, admissionYear: profile.admission_year });
  } catch (error) {
    await handleError(res, error);
  }
};
