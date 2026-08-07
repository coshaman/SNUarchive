const fs = require("fs");
const path = require("path");

const baseUrl = process.env.BASE_URL || "http://localhost:3000";
const root = path.resolve(__dirname, "..");
const courses = JSON.parse(fs.readFileSync(path.join(root, "public", "courses.json"), "utf8"));
const course = courses[Math.floor(Math.random() * courses.length)];

async function request(pathname, token, options = {}) {
  const headers = {
    authorization: `Bearer ${token}`,
    ...(options.headers || {})
  };

  let body = options.body;
  if (body && typeof body === "object") {
    headers["content-type"] = "application/json";
    body = JSON.stringify(body);
  }

  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers,
    body
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${options.method || "GET"} ${pathname}: ${payload.error || response.statusText}`);
  }
  return payload;
}

function coursePayload(value) {
  const term = value.offerings?.[0] || { year: value.latestYear, semester: value.latestSemester };
  return {
    id: value.id,
    course_key: value.course_key,
    title: value.title,
    instructor: value.instructor,
    department: value.department,
    year: term.year,
    semester: term.semester
  };
}

async function main() {
  const config = await fetch(`${baseUrl}/api/config`).then((response) => response.json());
  if (!config.demoAuth) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          protectedFlowSkipped: true,
          authMode: config.authMode,
          googleAuth: config.googleAuth,
          reason: "Protected API smoke test needs ALLOW_DEMO_AUTH=true or a browser Google session."
        },
        null,
        2
      )
    );
    return;
  }

  const token = "demo:student@snu.ac.kr";
  const adminToken = "demo:admin@snu.ac.kr";
  const courseBody = coursePayload(course);

  const me = await request("/api/me", token);
  await request("/api/stats", token, {
    method: "POST",
    body: {
      course: courseBody,
      assessmentLabel: "중간",
      nickname: "테스터",
      q1: 70,
      q2: 82,
      q3: 91,
      q4: 98,
      average: 81.2,
      maxScore: 100,
      note: "smoke"
    }
  });
  const stats = await request(`/api/stats?courseKey=${encodeURIComponent(course.course_key)}`, token);

  const opened = await request("/api/polls", token, {
    method: "POST",
    body: { action: "open", course: courseBody }
  });
  const voted = await request("/api/polls", token, {
    method: "POST",
    body: { action: "vote", course: courseBody, rating: 3, tags: ["시험"] }
  });

  const quick = await request("/api/quick-reports", token, {
    method: "POST",
    body: {
      course: courseBody,
      assessmentLabel: "기말",
      nickname: "",
      fileName: "sample.pdf",
      contentType: "application/pdf",
      dataBase64: Buffer.from("%PDF-1.4\n% smoke\n").toString("base64")
    }
  });
  const queue = await request("/api/quick-reports", adminToken);
  await request("/api/quick-reports", adminToken, {
    method: "PATCH",
    body: {
      id: quick.report.id,
      status: "rejected",
      adminNote: "smoke"
    }
  });

  await request("/api/profile", token, {
    method: "POST",
    body: { college: "공과대학", admissionYear: "21" }
  });
  const profile = await request("/api/profile", token);
  const collegeStats = await request("/api/admin-user-stats", adminToken);

  let nonAdminBlocked = false;
  try {
    await request("/api/admin-user-stats", token);
  } catch (error) {
    nonAdminBlocked = /권한/.test(error.message);
  }
  if (!nonAdminBlocked) {
    throw new Error("non-admin was not blocked from /api/admin-user-stats");
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        user: me.email,
        course: courseBody,
        stats: stats.stats.length,
        pollActive: opened.active,
        voteCount: voted.voteCount,
        queuedBeforeReview: queue.reports.length,
        profileCollege: profile.college,
        profiledUsers: collegeStats.profiledUsers,
        nonAdminBlockedFromAdminStats: nonAdminBlocked
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
