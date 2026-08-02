const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "public");
const outFile = path.join(outDir, "courses.json");

function stableHash(value, length = 20) {
  return crypto.createHash("sha1").update(String(value)).digest("hex").slice(0, length);
}

function courseKey(course) {
  const key = [course.title || course.course_title, course.instructor]
    .map((value) => String(value ?? "").replace(/\s+/g, "").trim().toLowerCase())
    .join("|");

  return stableHash(key, 20);
}

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function offeringKey(offering) {
  return `${offering.year}|${offering.semester}|${offering.department}`;
}

function compareOffering(a, b) {
  if (b.year !== a.year) return b.year - a.year;
  if (b.semester !== a.semester) return b.semester - a.semester;
  return a.department.localeCompare(b.department, "ko");
}

const files = fs
  .readdirSync(root)
  .filter((file) => /^20\d{2}-[1-4]\.json$/.test(file))
  .sort();

if (!files.length) {
  throw new Error("No semester JSON files found in project root.");
}

const byCourse = new Map();
const sourceCounts = {};

for (const file of files) {
  const fullPath = path.join(root, file);
  const records = JSON.parse(fs.readFileSync(fullPath, "utf8"));
  sourceCounts[file] = records.length;

  for (const record of records) {
    const course = {
      title: clean(record.course_title),
      instructor: clean(record.instructor) || "미정",
      department: clean(record.department) || "미분류",
      year: Number(record.year),
      semester: Number(record.semester)
    };

    if (!course.title || !course.year || !course.semester) continue;

    const key = courseKey(course);
    const existing =
      byCourse.get(key) ||
      {
        course_key: key,
        title: course.title,
        instructor: course.instructor,
        department: course.department,
        departments: [],
        offerings: []
      };

    if (!existing.departments.includes(course.department)) existing.departments.push(course.department);

    const offering = {
      year: course.year,
      semester: course.semester,
      department: course.department
    };

    if (!existing.offerings.some((item) => offeringKey(item) === offeringKey(offering))) {
      existing.offerings.push(offering);
    }

    existing.offerings.sort(compareOffering);
    existing.departments.sort((a, b) => a.localeCompare(b, "ko"));
    existing.department = existing.offerings[0]?.department || existing.departments[0] || "미분류";
    existing.latestYear = existing.offerings[0]?.year || course.year;
    existing.latestSemester = existing.offerings[0]?.semester || course.semester;

    byCourse.set(key, existing);
  }
}

const courses = [...byCourse.values()].sort((a, b) => {
  if (b.latestYear !== a.latestYear) return b.latestYear - a.latestYear;
  if (b.latestSemester !== a.latestSemester) return b.latestSemester - a.latestSemester;
  return `${a.title} ${a.instructor}`.localeCompare(`${b.title} ${b.instructor}`, "ko");
});

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(courses));

console.log(
  JSON.stringify(
    {
      files,
      sourceCounts,
      courses: courses.length,
      outFile: path.relative(root, outFile)
    },
    null,
    2
  )
);
