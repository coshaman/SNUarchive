const {
  handleError,
  method,
  normalizeCourse,
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
      sendJson(res, 200, { favorites: await store.listFavorites(user) });
      return;
    }

    const body = await readJson(req);
    const course = normalizeCourse(body.course);
    const favorite = body.favorite !== false;
    const favorites = await store.setFavorite(user, course, favorite);
    await recordAction(user, favorite ? "favorite_add" : "favorite_remove", {
      courseTitle: course.course_title,
      instructor: course.instructor
    });
    sendJson(res, 200, {
      favorite,
      favorites
    });
  } catch (error) {
    await handleError(res, error);
  }
};
