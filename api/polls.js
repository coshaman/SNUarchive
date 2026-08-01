const {
  createError,
  handleError,
  method,
  normalizeAssessment,
  normalizeCourse,
  pollSummary,
  readJson,
  recordAction,
  repo,
  requireUser,
  sendJson
} = require("./_utils");

async function statusFor(store, courseKey, user, assessmentLabel = "") {
  const requestedAssessment = assessmentLabel ? normalizeAssessment(assessmentLabel) : "";
  const poll = await store.activePoll(courseKey, requestedAssessment);
  const selectedAssessment = normalizeAssessment(requestedAssessment || poll?.assessment_label || "기타");
  const votes = courseKey ? await store.votesForCourseAssessment(courseKey, selectedAssessment) : [];
  const voteCountInWindow = await store.voteWindowCount(user);
  const limit = 10;
  return {
    ...pollSummary(poll, votes, user, selectedAssessment),
    voteCountInWindow,
    remainingVoteCount: Math.max(0, limit - voteCountInWindow),
    monthlyVoteCount: voteCountInWindow,
    monthlyVoteLimit: limit
  };
}

module.exports = async function handler(req, res) {
  try {
    method(req, ["GET", "POST"]);
    const user = await requireUser(req);
    const store = repo();

    if (req.method === "GET") {
      const url = new URL(req.url, "http://localhost");
      const courseKey = url.searchParams.get("courseKey");
      const assessmentLabel = url.searchParams.get("assessmentLabel") || "";
      sendJson(res, 200, await statusFor(store, courseKey || "", user, assessmentLabel));
      return;
    }

    const body = await readJson(req);

    if (body.action === "open") {
      const course = normalizeCourse(body.course);
      const assessmentLabel = normalizeAssessment(body.assessmentLabel);
      const poll = await store.createPoll(course, user, assessmentLabel);
      await recordAction(user, "poll_open", {
        courseTitle: poll.course_title,
        instructor: poll.instructor,
        assessmentLabel: poll.assessment_label
      });
      sendJson(res, 201, await statusFor(store, poll.course_key, user, poll.assessment_label));
      return;
    }

    if (body.action === "vote") {
      const course = normalizeCourse(body.course);
      const assessmentLabel = normalizeAssessment(body.assessmentLabel);
      const rating = Number(body.rating);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        throw createError(400, "난이도는 1에서 5 사이로 선택해주세요.");
      }

      const poll = await store.activePoll(course.course_key, assessmentLabel);
      if (!poll) throw createError(404, "열려 있는 투표가 없습니다.");
      await store.insertVote(poll, user, rating, []);
      await recordAction(user, "poll_vote", {
        courseTitle: poll.course_title,
        instructor: poll.instructor,
        assessmentLabel: poll.assessment_label,
        rating
      });
      sendJson(res, 201, await statusFor(store, course.course_key, user, poll.assessment_label));
      return;
    }

    throw createError(400, "요청 동작이 올바르지 않습니다.");
  } catch (error) {
    await handleError(res, error);
  }
};
