const {
  clampLimit,
  clampOffset,
  createError,
  handleError,
  maskDisplayName,
  method,
  normalizeCommentBody,
  normalizeCourse,
  readJson,
  recordAction,
  repo,
  requireAdmin,
  requireUser,
  sendJson,
  visibleComment
} = require("./_utils");

module.exports = async function handler(req, res) {
  try {
    method(req, ["GET", "POST", "DELETE"]);
    const store = repo();

    if (req.method === "GET") {
      await requireUser(req);
      const url = new URL(req.url, "http://localhost");
      const courseKey = url.searchParams.get("courseKey");
      if (!courseKey) {
        sendJson(res, 200, { comments: [] });
        return;
      }

      const limit = clampLimit(url.searchParams.get("limit"), 50, 100);
      const offset = clampOffset(url.searchParams.get("offset"));
      const comments = await store.listComments(courseKey, limit, offset);
      sendJson(res, 200, { comments: comments.map(visibleComment) });
      return;
    }

    if (req.method === "DELETE") {
      const admin = await requireAdmin(req);
      const url = new URL(req.url, "http://localhost");
      const id = url.searchParams.get("id");
      if (!id) throw createError(400, "후기 ID가 필요합니다.");

      await store.deleteComment(id);
      await recordAction(admin, "comment_delete", { commentId: id });
      sendJson(res, 200, { ok: true });
      return;
    }

    const user = await requireUser(req);
    const body = await readJson(req);
    const course = normalizeCourse(body.course);
    const commentBody = normalizeCommentBody(body.body);
    const displayName = maskDisplayName(user.name, user.email);

    const comment = await store.insertComment({
      ...course,
      body: commentBody,
      display_name: displayName,
      author_email_hash: user.emailHash
    });

    await recordAction(user, "course_comment", {
      courseTitle: comment.course_title,
      instructor: comment.instructor
    });

    sendJson(res, 201, { comment: visibleComment(comment) });
  } catch (error) {
    await handleError(res, error);
  }
};
