const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const requiredFiles = [
  "public/index.html",
  "public/styles.css",
  "public/app.js",
  "public/courses.json",
  "api/config.js",
  "api/me.js",
  "api/auth/google/start.js",
  "api/auth/google/callback.js",
  "api/auth/logout.js",
  "api/course-activity.js",
  "api/favorites.js",
  "api/stats.js",
  "api/quick-reports.js",
  "api/admin-stats.js",
  "api/polls.js",
  "api/comments.js",
  "supabase/schema.sql"
];

const missing = requiredFiles.filter((file) => !fs.existsSync(path.join(root, file)));
if (missing.length) {
  console.error(`Missing files: ${missing.join(", ")}`);
  process.exit(1);
}

const courses = JSON.parse(fs.readFileSync(path.join(root, "public/courses.json"), "utf8"));
const requiredKeys = ["course_key", "title", "instructor", "department", "departments", "offerings"];
const invalidCourse = courses.find((course) => {
  if (requiredKeys.some((key) => course[key] === undefined || course[key] === "")) return true;
  if (!Array.isArray(course.departments) || !course.departments.length) return true;
  if (!Array.isArray(course.offerings) || !course.offerings.length) return true;
  return course.offerings.some((offering) => !offering.year || !offering.semester || !offering.department);
});

if (invalidCourse) {
  console.error("Invalid course record:", invalidCourse);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      courses: courses.length,
      sample: courses[0]
    },
    null,
    2
  )
);
