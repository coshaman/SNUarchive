const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

let firebaseAppModule = null;
let firebaseFirestoreModule = null;
let firebaseStorageModule = null;
let firebaseAppInstance = null;
let firebaseSettingsApplied = false;

const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
const QUICK_BUCKET = "quick-reports";
const STAT_FIELDS = ["q1", "q2", "q3", "q4", "average", "max_score"];
const VOTE_LIMIT = 10;
const SESSION_COOKIE = "snu_archive_session";
const OAUTH_STATE_COOKIE = "snu_oauth_state";
const SNU_COLLEGES = [
  "인문대학",
  "사회과학대학",
  "자연과학대학",
  "간호대학",
  "경영대학",
  "공과대학",
  "농업생명과학대학",
  "미술대학",
  "사범대학",
  "생활과학대학",
  "수의과대학",
  "약학대학",
  "음악대학",
  "의과대학",
  "자유전공학부",
  "법학전문대학원",
  "치의학대학원",
  "대학원/기타"
];

function firebaseProjectIdFromEnv() {
  if (process.env.FIREBASE_PROJECT_ID) return process.env.FIREBASE_PROJECT_ID;
  const account = readFirebaseServiceAccount();
  return account?.project_id || account?.projectId || "";
}

function readFirebaseServiceAccount() {
  function normalizeAccount(account) {
    if (!account) return null;
    return {
      projectId: account.projectId || account.project_id,
      clientEmail: account.clientEmail || account.client_email,
      privateKey: String(account.privateKey || account.private_key || "").replace(/\\n/g, "\n")
    };
  }

  const encoded = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (encoded) {
    return normalizeAccount(JSON.parse(Buffer.from(encoded, "base64").toString("utf8")));
  }

  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return normalizeAccount(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON));
  }

  if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    return normalizeAccount({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
    });
  }

  return null;
}

function isFirebaseConfigured() {
  return Boolean(readFirebaseServiceAccount() || process.env.GOOGLE_APPLICATION_CREDENTIALS);
}

function isGoogleAuthConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function isDemoAuthAllowed() {
  return process.env.ALLOW_DEMO_AUTH === "true";
}

function createError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function method(req, allowed) {
  if (!allowed.includes(req.method)) throw createError(405, "지원하지 않는 요청입니다.");
}

function normalizeText(value, max = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function compactText(value) {
  return normalizeText(value, 300).toLowerCase().replace(/\s+/g, "");
}

function stableHash(value, length = 20) {
  return crypto.createHash("sha1").update(String(value)).digest("hex").slice(0, length);
}

function courseKey(title, instructor) {
  return stableHash(`${compactText(title)}|${compactText(instructor || "미정")}`, 20);
}

function currentAcademicTerm(date = new Date()) {
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  if (month <= 2) return { year: year - 1, semester: 4 };
  if (month <= 6) return { year, semester: 1 };
  if (month <= 8) return { year, semester: 3 };
  return { year, semester: 2 };
}

function voteWindowStart(date = new Date()) {
  const year = date.getFullYear();
  const monthDay = (date.getMonth() + 1) * 100 + date.getDate();
  if (monthDay >= 1210) return new Date(Date.UTC(year, 11, 10));
  if (monthDay >= 1015) return new Date(Date.UTC(year, 9, 15));
  if (monthDay >= 610) return new Date(Date.UTC(year, 5, 10));
  if (monthDay >= 415) return new Date(Date.UTC(year, 3, 15));
  return new Date(Date.UTC(year - 1, 11, 10));
}

function voteWindowStartIso(date = new Date()) {
  return voteWindowStart(date).toISOString();
}

function voteWindowLabel(date = new Date()) {
  const monthDay = (date.getMonth() + 1) * 100 + date.getDate();
  if ((monthDay >= 415 && monthDay < 610) || (monthDay >= 1015 && monthDay < 1210)) return "중간고사 기간";
  return "기말고사 기간";
}

function normalizeNickname(value) {
  const nickname = normalizeText(value, 10);
  if (!nickname) return "(익명)";
  if ([...nickname].length > 10) throw createError(400, "닉네임은 10자 이하로 입력해주세요.");
  return nickname;
}

function normalizeAssessment(value) {
  return normalizeText(value, 24) || "기타";
}

const MAX_COMMENT_LENGTH = 50;

function normalizeCommentBody(value) {
  const collapsed = String(value ?? "").replace(/\s+/g, " ").trim();
  const chars = [...collapsed];
  if (!chars.length) throw createError(400, "후기 내용을 입력해주세요.");
  if (chars.length > MAX_COMMENT_LENGTH) {
    throw createError(400, `후기는 ${MAX_COMMENT_LENGTH}자 이하로 입력해주세요.`);
  }
  return collapsed;
}

function maskDisplayName(name, email) {
  const source = normalizeText(name, 60) || String(email || "").split("@")[0];
  const chars = [...source];
  if (!chars.length) return "익명";
  if (chars.length === 1) return chars[0];
  if (chars.length === 2) return `${chars[0]}*`;
  return `${chars[0]}${"*".repeat(chars.length - 2)}${chars[chars.length - 1]}`;
}

function sameAssessment(row, assessmentLabel) {
  return normalizeAssessment(row.assessment_label || row.assessmentLabel) === normalizeAssessment(assessmentLabel);
}

function parseOptionalNumber(value, label) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw createError(400, `${label} 값이 올바르지 않습니다.`);
  return number;
}

function normalizeCourse(value) {
  const course = value || {};
  const term = currentAcademicTerm();
  const courseTitle = normalizeText(course.title || course.course_title, 200);
  const instructor = normalizeText(course.instructor, 120) || "미정";
  const normalized = {
    course_id: normalizeText(course.id || course.course_id || course.course_key, 80),
    course_title: courseTitle,
    instructor,
    department: normalizeText(course.department || course.departments?.[0], 120) || "미분류",
    year: Number(course.year || term.year),
    semester: Number(course.semester || term.semester)
  };
  normalized.course_key = course.course_key || courseKey(normalized.course_title, normalized.instructor);
  if (!normalized.course_id) normalized.course_id = normalized.course_key;

  if (
    !normalized.course_id ||
    !normalized.course_title ||
    !Number.isInteger(normalized.year) ||
    !Number.isInteger(normalized.semester)
  ) {
    throw createError(400, "강의 정보가 올바르지 않습니다.");
  }

  return normalized;
}

function secret() {
  return process.env.AUTH_SESSION_SECRET || process.env.EMAIL_HASH_SECRET || "local-dev-secret";
}

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function sign(value) {
  return crypto.createHmac("sha256", secret()).update(value).digest("base64url");
}

function hashEmail(email) {
  return crypto.createHmac("sha256", secret()).update(String(email).toLowerCase()).digest("hex");
}

function adminEmails() {
  const fallback = isFirebaseConfigured() || isGoogleAuthConfigured() ? "" : "admin@snu.ac.kr,coshaman@snu.ac.kr";
  return new Set(
    String(process.env.ADMIN_EMAILS || fallback)
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
}

function isSnuEmail(email) {
  return String(email || "").toLowerCase().endsWith("@snu.ac.kr");
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return String(forwarded).split(",")[0].trim();
  return req.socket?.remoteAddress || req.connection?.remoteAddress || "";
}

function normalizeCollege(value) {
  const college = normalizeText(value, 40);
  if (!college) return null;
  if (!SNU_COLLEGES.includes(college)) throw createError(400, "올바른 단과대학을 선택해주세요.");
  return college;
}

function normalizeAdmissionYear(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (!/^\d{2}$|^\d{4}$/.test(text)) {
    throw createError(400, "입학년도는 2자리 또는 4자리 숫자로 입력해주세요.");
  }
  const year = text.length === 2 ? 2000 + Number(text) : Number(text);
  const currentYear = new Date().getFullYear();
  if (year < 1980 || year > currentYear + 1) {
    throw createError(400, "입학년도 값이 올바르지 않습니다.");
  }
  return year;
}

function guessAdmissionYearFromEmail(email) {
  const local = String(email || "").split("@")[0];
  const match = local.match(/^(\d{4})[-_]?\d{4,}/) || local.match(/^(\d{2})[-_]\d{4,}/);
  if (!match) return null;
  const raw = match[1];
  const year = raw.length === 2 ? 2000 + Number(raw) : Number(raw);
  const currentYear = new Date().getFullYear();
  if (year < 1980 || year > currentYear + 1) return null;
  return year;
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        if (index === -1) return ["", ""];
        return [decodeURIComponent(part.slice(0, index)), decodeURIComponent(part.slice(index + 1))];
      })
      .filter(([key]) => key)
  );
}

function appendSetCookie(res, cookie) {
  const existing = res.getHeader?.("set-cookie");
  if (!existing) {
    res.setHeader("set-cookie", cookie);
    return;
  }
  res.setHeader("set-cookie", Array.isArray(existing) ? [...existing, cookie] : [existing, cookie]);
}

function cookieOptions({ maxAge = 0, httpOnly = true } = {}) {
  const secure = process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL);
  return [
    "Path=/",
    "SameSite=Lax",
    httpOnly ? "HttpOnly" : "",
    secure ? "Secure" : "",
    maxAge ? `Max-Age=${maxAge}` : "Max-Age=0"
  ]
    .filter(Boolean)
    .join("; ");
}

function createSessionToken(email, name = "", maxAgeSeconds = 7 * 24 * 60 * 60) {
  const payload = base64url(
    JSON.stringify({
      email: String(email).toLowerCase(),
      name: normalizeText(name, 120),
      exp: Math.floor(Date.now() / 1000) + maxAgeSeconds
    })
  );
  return `${payload}.${sign(payload)}`;
}

function readSessionToken(token) {
  const [payload, signature] = String(token || "").split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload);
  if (Buffer.byteLength(signature) !== Buffer.byteLength(expected)) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;

  const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (!data.email || Number(data.exp) < Math.floor(Date.now() / 1000)) return null;
  return { email: String(data.email).toLowerCase(), name: normalizeText(data.name, 120) };
}

function setSessionCookie(res, email, name = "") {
  appendSetCookie(
    res,
    `${SESSION_COOKIE}=${encodeURIComponent(createSessionToken(email, name))}; ${cookieOptions({
      maxAge: 7 * 24 * 60 * 60
    })}`
  );
}

function clearSessionCookie(res) {
  appendSetCookie(res, `${SESSION_COOKIE}=; ${cookieOptions()}`);
}

function createOAuthState(res) {
  const state = crypto.randomBytes(24).toString("base64url");
  appendSetCookie(
    res,
    `${OAUTH_STATE_COOKIE}=${encodeURIComponent(`${state}.${sign(state)}`)}; ${cookieOptions({
      maxAge: 10 * 60
    })}`
  );
  return state;
}

function verifyOAuthState(req, state) {
  const cookie = parseCookies(req)[OAUTH_STATE_COOKIE];
  const [cookieState, signature] = String(cookie || "").split(".");
  if (!cookieState || !signature || cookieState !== state) return false;
  return sign(cookieState) === signature;
}

function clearOAuthStateCookie(res) {
  appendSetCookie(res, `${OAUTH_STATE_COOKIE}=; ${cookieOptions()}`);
}

function requestOrigin(req) {
  if (process.env.APP_ORIGIN) return process.env.APP_ORIGIN.replace(/\/$/, "");
  const proto = req.headers["x-forwarded-proto"] || "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost:3000";
  return `${proto}://${host}`;
}

function redirect(res, location, status = 302) {
  res.statusCode = status;
  res.setHeader("location", location);
  res.end();
}

function getBearer(req) {
  const value = req.headers.authorization || req.headers.Authorization || "";
  const match = String(value).match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : "";
}

async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_UPLOAD_BYTES + 100_000) {
      throw createError(413, "파일은 3MB 이하만 업로드할 수 있습니다.");
    }
    chunks.push(chunk);
  }

  const text = Buffer.concat(chunks).toString("utf8").trim();
  return text ? JSON.parse(text) : {};
}

async function getUser(req) {
  const cookies = parseCookies(req);
  const sessionUser = readSessionToken(cookies[SESSION_COOKIE]);
  if (sessionUser) return sessionUser;

  const token = getBearer(req);
  if (isDemoAuthAllowed() && token.startsWith("demo:")) {
    const email = token.slice("demo:".length).trim().toLowerCase();
    return email ? { email } : null;
  }

  return null;
}

async function requireUser(req) {
  const user = await getUser(req);
  if (!user) throw createError(401, "로그인이 필요합니다.");
  if (!isSnuEmail(user.email)) throw createError(403, "snu.ac.kr 계정만 사용할 수 있습니다.");

  return {
    email: user.email,
    name: normalizeText(user.name, 120),
    emailHash: hashEmail(user.email),
    isAdmin: adminEmails().has(user.email)
  };
}

async function requireAdmin(req) {
  const user = await requireUser(req);
  if (!user.isAdmin) throw createError(403, "관리자 권한이 필요합니다.");
  return user;
}

function readStatNumbers(body) {
  return {
    q1: parseOptionalNumber(body.q1, "Q1"),
    q2: parseOptionalNumber(body.q2 ?? body.median, "Q2"),
    q3: parseOptionalNumber(body.q3, "Q3"),
    q4: parseOptionalNumber(body.q4, "Q4"),
    average: parseOptionalNumber(body.average, "평균"),
    max_score: parseOptionalNumber(body.maxScore ?? body.max_score, "만점")
  };
}

function hasAnyStatValue(payload) {
  return STAT_FIELDS.some((field) => payload[field] !== null && payload[field] !== undefined);
}

function buildStatPayload(body, user, source = "direct") {
  const course = normalizeCourse(body.course);
  const payload = {
    ...course,
    ...readStatNumbers(body),
    assessment_label: normalizeAssessment(body.assessmentLabel ?? body.assessment_label),
    nickname: normalizeNickname(body.nickname),
    note: normalizeText(body.note, 500) || null,
    source,
    reporter_email_hash: user.emailHash
  };

  if (!hasAnyStatValue(payload) && !payload.note) {
    throw createError(400, "통계량 또는 비고 중 하나 이상을 입력해주세요.");
  }
  return payload;
}

function buildStatUpdatePayload(body) {
  return {
    ...readStatNumbers(body),
    assessment_label: normalizeAssessment(body.assessmentLabel ?? body.assessment_label),
    nickname: normalizeNickname(body.nickname),
    note: normalizeText(body.note, 500) || null
  };
}

function normalizeTags(value) {
  const tags = Array.isArray(value) ? value : String(value || "").split(",");
  return tags.map((tag) => normalizeText(tag, 20)).filter(Boolean).slice(0, 5);
}

function firebaseApp() {
  if (firebaseAppInstance) return firebaseAppInstance;
  if (!firebaseAppModule) firebaseAppModule = require("firebase-admin/app");
  const existing = firebaseAppModule.getApps();
  if (existing.length) {
    firebaseAppInstance = existing[0];
    return firebaseAppInstance;
  }
  const account = readFirebaseServiceAccount();
  const projectId = firebaseProjectIdFromEnv();
  const storageBucket = process.env.FIREBASE_STORAGE_BUCKET || (projectId ? `${projectId}.firebasestorage.app` : "");
  const options = {};
  if (account) options.credential = firebaseAppModule.cert(account);
  if (projectId) options.projectId = projectId;
  if (storageBucket) options.storageBucket = storageBucket;

  firebaseAppInstance = firebaseAppModule.initializeApp(options);
  return firebaseAppInstance;
}

function firebaseDb() {
  if (process.env.VERCEL && !isFirebaseConfigured()) {
    throw createError(500, "Firebase 서버 환경변수가 설정되지 않았습니다.");
  }
  if (!firebaseFirestoreModule) firebaseFirestoreModule = require("firebase-admin/firestore");
  const db = firebaseFirestoreModule.getFirestore(firebaseApp());
  if (!firebaseSettingsApplied) {
    db.settings({ ignoreUndefinedProperties: true });
    firebaseSettingsApplied = true;
  }
  return db;
}

function firebaseBucket() {
  const projectId = firebaseProjectIdFromEnv();
  const bucketName = process.env.FIREBASE_STORAGE_BUCKET || (projectId ? `${projectId}.firebasestorage.app` : "");
  if (!bucketName) throw createError(500, "Firebase Storage bucket 환경변수가 설정되지 않았습니다.");
  if (!firebaseStorageModule) firebaseStorageModule = require("firebase-admin/storage");
  return firebaseStorageModule.getStorage(firebaseApp()).bucket(bucketName);
}

function firebaseRow(doc) {
  return { id: doc.id, ...doc.data() };
}

async function firebaseDocs(query) {
  const snapshot = await query.get();
  return snapshot.docs.map(firebaseRow);
}

async function firebaseInsert(collectionName, payload) {
  const ref = firebaseDb().collection(collectionName).doc();
  const row = { created_at: new Date().toISOString(), ...payload };
  await ref.set(row);
  return { id: ref.id, ...row };
}

async function firebasePatch(collectionName, id, payload) {
  const ref = firebaseDb().collection(collectionName).doc(id);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw createError(404, "대상을 찾을 수 없습니다.");
  await ref.update({ ...payload, updated_at: new Date().toISOString() });
  return firebaseRow(await ref.get());
}

async function firebaseDelete(collectionName, id) {
  await firebaseDb().collection(collectionName).doc(id).delete();
  return { deleted: true };
}

async function firebaseDeleteAll(collectionName) {
  const db = firebaseDb();
  let cleared = 0;
  while (true) {
    const snapshot = await db.collection(collectionName).limit(450).get();
    if (snapshot.empty) return { cleared };
    const batch = db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    cleared += snapshot.size;
  }
}

function byCreatedDesc(a, b) {
  return new Date(b.created_at || 0) - new Date(a.created_at || 0);
}

function slicePage(rows, limit, offset) {
  return rows.slice(offset, offset + limit);
}

function favoriteDocId(user, course) {
  return stableHash(`favorite|${user.emailHash}|${course.course_key}`, 40);
}

function voteDocId(poll, user) {
  return stableHash(`vote|${poll.id}|${user.emailHash}`, 40);
}

function clampLimit(value, fallback, max = 500) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.min(Math.floor(number), max);
}

function clampOffset(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.floor(number);
}

function encodePath(value) {
  return String(value)
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function safeFileName(name) {
  const ext = path.extname(name || "").slice(0, 12);
  const base = path.basename(name || "upload", ext).replace(/[^a-zA-Z0-9가-힣._-]/g, "_");
  return `${base.slice(0, 60) || "upload"}${ext || ".bin"}`;
}

function decodeUpload(body) {
  const contentType = normalizeText(body.contentType || body.mimeType || "application/octet-stream", 100);
  const fileName = safeFileName(body.fileName || "upload");
  const raw = String(body.dataBase64 || "").replace(/^data:[^;]+;base64,/, "");
  if (!raw) throw createError(400, "업로드할 파일을 선택해주세요.");

  const buffer = Buffer.from(raw, "base64");
  if (!buffer.length) throw createError(400, "업로드 파일을 읽을 수 없습니다.");
  if (buffer.length > MAX_UPLOAD_BYTES) throw createError(413, "파일은 3MB 이하만 업로드할 수 있습니다.");
  return { buffer, contentType, fileName };
}

function localDir() {
  return path.join(process.cwd(), ".local-data");
}

function localDbPath() {
  return path.join(localDir(), "db.json");
}

function defaultDb() {
  return { stats: [], quickReports: [], polls: [], votes: [], favorites: [], logs: [], comments: [], profiles: [] };
}

function readLocalDb() {
  fs.mkdirSync(localDir(), { recursive: true });
  if (!fs.existsSync(localDbPath())) fs.writeFileSync(localDbPath(), JSON.stringify(defaultDb(), null, 2));
  return { ...defaultDb(), ...JSON.parse(fs.readFileSync(localDbPath(), "utf8")) };
}

function writeLocalDb(db) {
  fs.mkdirSync(localDir(), { recursive: true });
  fs.writeFileSync(localDbPath(), JSON.stringify(db, null, 2));
}

function rowCourseKey(row) {
  return row.course_key || courseKey(row.course_title, row.instructor);
}

function visibleQuickReport(report) {
  const copy = { ...report };
  delete copy.reporter_email_hash;
  delete copy.reviewed_by_hash;
  return copy;
}

function publicStat(row) {
  const copy = { ...row };
  delete copy.reporter_email_hash;
  return copy;
}

function publicFavorite(row) {
  const copy = { ...row };
  delete copy.user_email_hash;
  return copy;
}

function visibleComment(row) {
  const copy = { ...row };
  delete copy.author_email_hash;
  return copy;
}

async function signedUploadUrl(filePath) {
  if (!filePath) return null;
  const [url] = await firebaseBucket()
    .file(filePath)
    .getSignedUrl({ action: "read", expires: Date.now() + 60 * 60 * 1000 });
  return url;
}

const firebaseRepo = {
  async listStats(courseKeyValue) {
    const rows = await firebaseDocs(
      firebaseDb().collection("stat_reports").where("course_key", "==", courseKeyValue)
    );
    return rows.sort(
      (a, b) =>
        Number(b.year || 0) - Number(a.year || 0) ||
        Number(b.semester || 0) - Number(a.semester || 0) ||
        byCreatedDesc(a, b)
    );
  },

  async listAllStats(limit = 200, offset = 0) {
    return firebaseDocs(
      firebaseDb().collection("stat_reports").orderBy("created_at", "desc").offset(offset).limit(limit)
    );
  },

  async listLogs(limit = 200, offset = 0) {
    return firebaseDocs(
      firebaseDb().collection("activity_logs").orderBy("created_at", "desc").offset(offset).limit(limit)
    );
  },

  async clearLogs() {
    return firebaseDeleteAll("activity_logs");
  },

  async courseActivity() {
    const [stats, polls] = await Promise.all([
      this.listAllStats(1000, 0),
      firebaseDocs(firebaseDb().collection("difficulty_polls").orderBy("closes_at", "desc").limit(1000))
    ]);

    return summarizeActivity(
      stats,
      polls.filter((poll) => new Date(poll.closes_at).getTime() > Date.now())
    );
  },

  async listFavorites(user) {
    const rows = await firebaseDocs(
      firebaseDb().collection("course_favorites").where("user_email_hash", "==", user.emailHash)
    );
    return rows.sort(byCreatedDesc).map(publicFavorite);
  },

  async setFavorite(user, course, favorite) {
    const ref = firebaseDb().collection("course_favorites").doc(favoriteDocId(user, course));
    if (!favorite) {
      await ref.delete();
      return this.listFavorites(user);
    }

    await ref.set(
      {
        user_email_hash: user.emailHash,
        course_key: course.course_key,
        course_id: course.course_id,
        course_title: course.course_title,
        instructor: course.instructor,
        department: course.department,
        created_at: new Date().toISOString()
      },
      { merge: true }
    );

    return this.listFavorites(user);
  },

  async insertStat(payload) {
    return firebaseInsert("stat_reports", payload);
  },

  async insertLog(payload) {
    return firebaseInsert("activity_logs", payload);
  },

  async updateStat(id, payload) {
    return firebasePatch("stat_reports", id, payload);
  },

  async createQuickReport(payload, upload) {
    const objectPath = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${upload.fileName}`;
    await firebaseBucket().file(objectPath).save(upload.buffer, {
      contentType: upload.contentType,
      metadata: {
        cacheControl: "private, max-age=3600"
      },
      resumable: false
    });

    const row = await firebaseInsert("quick_reports", {
      ...payload,
      file_path: objectPath,
      file_name: upload.fileName,
      content_type: upload.contentType,
      status: "pending"
    });
    return visibleQuickReport(row);
  },

  async listQuickReports({ status = "pending", courseKeyValue = "", limit = 10, offset = 0 } = {}) {
    let query = firebaseDb().collection("quick_reports");
    if (courseKeyValue) query = query.where("course_key", "==", courseKeyValue);
    else if (status && status !== "all") query = query.where("status", "==", status);
    const rows = slicePage(
      (await firebaseDocs(query))
        .filter((row) => {
          if (status && status !== "all" && row.status !== status) return false;
          if (courseKeyValue && rowCourseKey(row) !== courseKeyValue) return false;
          return true;
        })
        .sort(byCreatedDesc),
      limit,
      offset
    );

    return Promise.all(
      rows.map(async (row) =>
        visibleQuickReport({
          ...row,
          file_url: await signedUploadUrl(row.file_path)
        })
      )
    );
  },

  async updateQuickReport(id, payload) {
    const row = await firebasePatch("quick_reports", id, { ...payload, reviewed_at: new Date().toISOString() });
    return visibleQuickReport(row);
  },

  async activePoll(courseKeyValue, assessmentLabel = "") {
    const normalizedAssessment = assessmentLabel ? normalizeAssessment(assessmentLabel) : "";
    const rows = await firebaseDocs(
      firebaseDb().collection("difficulty_polls").where("course_key", "==", courseKeyValue)
    );
    return (
      rows
        .filter((row) => {
          if (new Date(row.closes_at).getTime() <= Date.now()) return false;
          return !normalizedAssessment || sameAssessment(row, normalizedAssessment);
        })
        .sort((a, b) => new Date(b.closes_at) - new Date(a.closes_at))[0] || null
    );
  },

  async createPoll(course, user, assessmentLabel = "기타") {
    const normalizedAssessment = normalizeAssessment(assessmentLabel);
    const active = await this.activePoll(course.course_key, normalizedAssessment);
    if (active) return active;

    const openedAt = new Date();
    return firebaseInsert("difficulty_polls", {
      ...course,
      assessment_label: normalizedAssessment,
      opened_by_hash: user.emailHash,
      opened_at: openedAt.toISOString(),
      closes_at: new Date(openedAt.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
    });
  },

  async votesForPoll(pollId) {
    const rows = await firebaseDocs(
      firebaseDb().collection("difficulty_votes").where("poll_id", "==", pollId)
    );
    return rows.sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
  },

  async votesForCourseAssessment(courseKeyValue, assessmentLabel) {
    const normalizedAssessment = normalizeAssessment(assessmentLabel);
    const rows = await firebaseDocs(
      firebaseDb().collection("difficulty_votes").where("course_key", "==", courseKeyValue)
    );
    return rows
      .filter((row) => sameAssessment(row, normalizedAssessment))
      .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
  },

  async voteWindowCount(user) {
    const start = new Date(voteWindowStartIso()).getTime();
    const rows = await firebaseDocs(
      firebaseDb().collection("difficulty_votes").where("voter_email_hash", "==", user.emailHash)
    );
    return rows.filter((row) => new Date(row.created_at || 0).getTime() >= start).length;
  },

  async insertVote(poll, user, rating, tags) {
    const ref = firebaseDb().collection("difficulty_votes").doc(voteDocId(poll, user));
    const existing = await ref.get();
    if (existing.exists) {
      await ref.update({
        rating,
        difficulty_tags: tags.join(","),
        updated_at: new Date().toISOString()
      });
      return firebaseRow(await ref.get());
    }

    const voteCount = await this.voteWindowCount(user);
    if (voteCount >= VOTE_LIMIT) throw createError(429, `이번 시험 기간 투표 가능 횟수 ${VOTE_LIMIT}회를 모두 사용했습니다.`);

    const row = {
      poll_id: poll.id,
      course_key: poll.course_key,
      course_id: poll.course_id,
      assessment_label: normalizeAssessment(poll.assessment_label),
      year: poll.year,
      semester: poll.semester,
      voter_email_hash: user.emailHash,
      rating,
      difficulty_tags: tags.join(","),
      created_at: new Date().toISOString()
    };
    await ref.set(row);
    return { id: ref.id, ...row };
  },

  async listComments(courseKeyValue, limit = 50, offset = 0) {
    const rows = await firebaseDocs(
      firebaseDb().collection("course_comments").where("course_key", "==", courseKeyValue)
    );
    return slicePage(rows.sort(byCreatedDesc), limit, offset);
  },

  async insertComment(payload) {
    return firebaseInsert("course_comments", payload);
  },

  async deleteComment(id) {
    return firebaseDelete("course_comments", id);
  },

  async getUserProfile(user) {
    const snapshot = await firebaseDb().collection("user_profiles").doc(user.emailHash).get();
    return snapshot.exists ? firebaseRow(snapshot) : null;
  },

  async upsertUserProfile(user, payload, ip) {
    const data = {
      user_email_hash: user.emailHash,
      college: payload.college,
      admission_year: payload.admissionYear,
      last_ip: ip || null,
      updated_at: new Date().toISOString()
    };
    const ref = firebaseDb().collection("user_profiles").doc(user.emailHash);
    const existing = await ref.get();
    await ref.set(existing.exists ? data : { ...data, created_at: new Date().toISOString() }, { merge: true });
    return firebaseRow(await ref.get());
  },

  async collegeStats() {
    const [profiles, loginRows] = await Promise.all([
      firebaseDocs(firebaseDb().collection("user_profiles").limit(5000)),
      firebaseDocs(firebaseDb().collection("activity_logs").where("action", "==", "login").limit(5000))
    ]);
    return summarizeCollegeStats(profiles, loginRows);
  }
};

const localRepo = {
  async listStats(courseKeyValue) {
    return readLocalDb()
      .stats.filter((row) => rowCourseKey(row) === courseKeyValue)
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  },

  async listAllStats(limit = 200, offset = 0) {
    return readLocalDb()
      .stats.slice()
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
      .slice(offset, offset + limit);
  },

  async listLogs(limit = 200, offset = 0) {
    return readLocalDb()
      .logs.slice()
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
      .slice(offset, offset + limit);
  },

  async clearLogs() {
    const db = readLocalDb();
    const cleared = db.logs.length;
    db.logs = [];
    writeLocalDb(db);
    return { cleared };
  },

  async courseActivity() {
    const db = readLocalDb();
    const now = Date.now();
    return summarizeActivity(
      db.stats.slice().sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)),
      db.polls.filter((poll) => new Date(poll.closes_at).getTime() > now)
    );
  },

  async listFavorites(user) {
    return readLocalDb()
      .favorites.filter((row) => row.user_email_hash === user.emailHash)
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
      .map(publicFavorite);
  },

  async setFavorite(user, course, favorite) {
    const db = readLocalDb();
    db.favorites = db.favorites.filter(
      (row) => !(row.user_email_hash === user.emailHash && row.course_key === course.course_key)
    );

    if (favorite) {
      db.favorites.push({
        id: crypto.randomUUID(),
        user_email_hash: user.emailHash,
        course_key: course.course_key,
        course_id: course.course_id,
        course_title: course.course_title,
        instructor: course.instructor,
        department: course.department,
        created_at: new Date().toISOString()
      });
    }

    writeLocalDb(db);
    return this.listFavorites(user);
  },

  async insertStat(payload) {
    const db = readLocalDb();
    const row = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...payload };
    db.stats.push(row);
    writeLocalDb(db);
    return row;
  },

  async insertLog(payload) {
    const db = readLocalDb();
    const row = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...payload };
    db.logs.push(row);
    writeLocalDb(db);
    return row;
  },

  async updateStat(id, payload) {
    const db = readLocalDb();
    const index = db.stats.findIndex((row) => row.id === id);
    if (index === -1) throw createError(404, "통계량을 찾을 수 없습니다.");
    db.stats[index] = { ...db.stats[index], ...payload, updated_at: new Date().toISOString() };
    writeLocalDb(db);
    return db.stats[index];
  },

  async createQuickReport(payload, upload) {
    const db = readLocalDb();
    const uploadDir = path.join(localDir(), "uploads");
    fs.mkdirSync(uploadDir, { recursive: true });
    const storedName = `${crypto.randomUUID()}-${upload.fileName}`;
    fs.writeFileSync(path.join(uploadDir, storedName), upload.buffer);

    const row = {
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      ...payload,
      file_path: storedName,
      file_name: upload.fileName,
      content_type: upload.contentType,
      file_url: `/uploads/${encodeURIComponent(storedName)}`,
      status: "pending"
    };
    db.quickReports.push(row);
    writeLocalDb(db);
    return visibleQuickReport(row);
  },

  async listQuickReports({ status = "pending", courseKeyValue = "", limit = 10, offset = 0 } = {}) {
    return readLocalDb()
      .quickReports.filter((row) => {
        if (status && status !== "all" && row.status !== status) return false;
        if (courseKeyValue && rowCourseKey(row) !== courseKeyValue) return false;
        return true;
      })
      .map((row) =>
        visibleQuickReport({
          ...row,
          file_url: `/uploads/${encodeURIComponent(row.file_path)}`
        })
      )
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
      .slice(offset, offset + limit);
  },

  async updateQuickReport(id, payload) {
    const db = readLocalDb();
    const index = db.quickReports.findIndex((row) => row.id === id);
    if (index === -1) throw createError(404, "간편 제보를 찾을 수 없습니다.");
    db.quickReports[index] = { ...db.quickReports[index], ...payload, reviewed_at: new Date().toISOString() };
    writeLocalDb(db);
    return visibleQuickReport(db.quickReports[index]);
  },

  async activePoll(courseKeyValue, assessmentLabel = "") {
    const now = Date.now();
    const normalizedAssessment = assessmentLabel ? normalizeAssessment(assessmentLabel) : "";
    return (
      readLocalDb()
        .polls.filter((row) => {
          if (rowCourseKey(row) !== courseKeyValue) return false;
          if (new Date(row.closes_at).getTime() <= now) return false;
          return !normalizedAssessment || sameAssessment(row, normalizedAssessment);
        })
        .sort((a, b) => new Date(b.closes_at) - new Date(a.closes_at))[0] || null
    );
  },

  async createPoll(course, user, assessmentLabel = "기타") {
    const normalizedAssessment = normalizeAssessment(assessmentLabel);
    const active = await this.activePoll(course.course_key, normalizedAssessment);
    if (active) return active;

    const db = readLocalDb();
    const openedAt = new Date();
    const row = {
      id: crypto.randomUUID(),
      ...course,
      assessment_label: normalizedAssessment,
      opened_by_hash: user.emailHash,
      opened_at: openedAt.toISOString(),
      closes_at: new Date(openedAt.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
    };
    db.polls.push(row);
    writeLocalDb(db);
    return row;
  },

  async votesForPoll(pollId) {
    return readLocalDb().votes.filter((row) => row.poll_id === pollId);
  },

  async votesForCourseAssessment(courseKeyValue, assessmentLabel) {
    const normalizedAssessment = normalizeAssessment(assessmentLabel);
    return readLocalDb()
      .votes.filter((row) => rowCourseKey(row) === courseKeyValue && sameAssessment(row, normalizedAssessment))
      .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
  },

  async voteWindowCount(user) {
    const start = new Date(voteWindowStartIso()).getTime();
    return readLocalDb().votes.filter(
      (row) => row.voter_email_hash === user.emailHash && new Date(row.created_at).getTime() >= start
    ).length;
  },

  async insertVote(poll, user, rating, tags) {
    const db = readLocalDb();
    const existing = db.votes.find((row) => row.poll_id === poll.id && row.voter_email_hash === user.emailHash);
    if (existing) {
      existing.rating = rating;
      existing.difficulty_tags = tags.join(",");
      existing.updated_at = new Date().toISOString();
      writeLocalDb(db);
      return existing;
    }

    const voteCount = await this.voteWindowCount(user);
    if (voteCount >= VOTE_LIMIT) throw createError(429, `이번 시험 기간 투표 가능 횟수 ${VOTE_LIMIT}회를 모두 사용했습니다.`);

    const row = {
      id: crypto.randomUUID(),
      poll_id: poll.id,
      course_key: poll.course_key,
      course_id: poll.course_id,
      assessment_label: normalizeAssessment(poll.assessment_label),
      year: poll.year,
      semester: poll.semester,
      voter_email_hash: user.emailHash,
      rating,
      difficulty_tags: tags.join(","),
      created_at: new Date().toISOString()
    };
    db.votes.push(row);
    writeLocalDb(db);
    return row;
  },

  async listComments(courseKeyValue, limit = 50, offset = 0) {
    return readLocalDb()
      .comments.filter((row) => rowCourseKey(row) === courseKeyValue)
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
      .slice(offset, offset + limit);
  },

  async insertComment(payload) {
    const db = readLocalDb();
    const row = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...payload };
    db.comments.push(row);
    writeLocalDb(db);
    return row;
  },

  async deleteComment(id) {
    const db = readLocalDb();
    db.comments = db.comments.filter((row) => row.id !== id);
    writeLocalDb(db);
    return { deleted: true };
  },

  async getUserProfile(user) {
    return readLocalDb().profiles.find((row) => row.user_email_hash === user.emailHash) || null;
  },

  async upsertUserProfile(user, payload, ip) {
    const db = readLocalDb();
    const index = db.profiles.findIndex((row) => row.user_email_hash === user.emailHash);
    const data = {
      college: payload.college,
      admission_year: payload.admissionYear,
      last_ip: ip || null
    };

    if (index === -1) {
      const row = {
        id: crypto.randomUUID(),
        user_email_hash: user.emailHash,
        created_at: new Date().toISOString(),
        ...data
      };
      db.profiles.push(row);
      writeLocalDb(db);
      return row;
    }

    db.profiles[index] = { ...db.profiles[index], ...data, updated_at: new Date().toISOString() };
    writeLocalDb(db);
    return db.profiles[index];
  },

  async collegeStats() {
    const db = readLocalDb();
    return summarizeCollegeStats(db.profiles, db.logs.filter((row) => row.action === "login"));
  }
};

function repo() {
  return isFirebaseConfigured() ? firebaseRepo : localRepo;
}

async function recordAction(user, action, metadata = {}) {
  if (!user?.email || !action) return null;
  const payload = {
    user_email: normalizeText(user.email, 200).toLowerCase(),
    google_name: normalizeText(user.name || user.googleName, 120),
    action: normalizeText(action, 80),
    metadata: metadata && typeof metadata === "object" ? metadata : {}
  };

  try {
    return await repo().insertLog(payload);
  } catch (error) {
    console.error("activity log failed", error.message);
    return null;
  }
}

function summarizeActivity(stats, polls) {
  const recentStats = {};
  for (const stat of stats) {
    const key = stat.course_key || rowCourseKey(stat);
    if (!key) continue;
    if (!recentStats[key]) {
      recentStats[key] = {
        latestStatAt: stat.created_at || null,
        statCount: 0
      };
    }
    recentStats[key].statCount += 1;
  }

  const activePolls = [
    ...new Set(
      polls
        .map((poll) => poll.course_key || rowCourseKey(poll))
        .filter(Boolean)
    )
  ];

  return { recentStats, activePolls };
}

function summarizeCollegeStats(profiles, loginRows) {
  const byCollege = new Map();
  const byYear = new Map();
  for (const row of profiles) {
    if (row.college) byCollege.set(row.college, (byCollege.get(row.college) || 0) + 1);
    if (row.admission_year) byYear.set(row.admission_year, (byYear.get(row.admission_year) || 0) + 1);
  }

  const totalLoginUsers = new Set(loginRows.map((row) => row.user_email).filter(Boolean)).size;

  return {
    totalLoginUsers,
    profiledUsers: profiles.length,
    byCollege: [...byCollege.entries()]
      .map(([college, count]) => ({ college, count }))
      .sort((a, b) => b.count - a.count || a.college.localeCompare(b.college, "ko")),
    byAdmissionYear: [...byYear.entries()]
      .map(([year, count]) => ({ year, count }))
      .sort((a, b) => a.year - b.year)
  };
}

function pollSummary(poll, votes, user, assessmentLabel = "기타") {
  const distribution = [1, 2, 3, 4, 5].map(
    (rating) => votes.filter((vote) => Number(vote.rating) === rating).length
  );
  const tagMap = new Map();
  for (const vote of votes) {
    for (const tag of normalizeTags(vote.difficulty_tags)) {
      tagMap.set(tag, (tagMap.get(tag) || 0) + 1);
    }
  }
  const voteCount = votes.length;
  const total = votes.reduce((sum, vote) => sum + Number(vote.rating || 0), 0);
  const userVote = poll
    ? votes.find((vote) => vote.poll_id === poll.id && vote.voter_email_hash === user.emailHash)
    : null;

  return {
    active: poll ? new Date(poll.closes_at).getTime() > Date.now() : false,
    poll,
    assessmentLabel: normalizeAssessment(poll?.assessment_label || assessmentLabel),
    voteCount,
    average: voteCount ? Math.round((total / voteCount) * 10) / 10 : null,
    distribution,
    tagCounts: [...tagMap.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "ko")),
    userVote: userVote ? { rating: userVote.rating, tags: normalizeTags(userVote.difficulty_tags) } : null
  };
}

async function handleError(res, error) {
  sendJson(res, error.statusCode || 500, {
    error: error.message || "요청을 처리하지 못했습니다."
  });
}

module.exports = {
  MAX_COMMENT_LENGTH,
  MAX_UPLOAD_BYTES,
  OAUTH_STATE_COOKIE,
  SESSION_COOKIE,
  SNU_COLLEGES,
  STAT_FIELDS,
  buildStatPayload,
  buildStatUpdatePayload,
  clearOAuthStateCookie,
  clearSessionCookie,
  courseKey,
  createError,
  createOAuthState,
  decodeUpload,
  getClientIp,
  guessAdmissionYearFromEmail,
  handleError,
  isDemoAuthAllowed,
  isFirebaseConfigured,
  isGoogleAuthConfigured,
  maskDisplayName,
  method,
  clampLimit,
  clampOffset,
  normalizeAdmissionYear,
  normalizeAssessment,
  normalizeCollege,
  normalizeCommentBody,
  normalizeCourse,
  normalizeNickname,
  normalizeTags,
  normalizeText,
  pollSummary,
  publicStat,
  readJson,
  recordAction,
  redirect,
  repo,
  requestOrigin,
  requireAdmin,
  requireUser,
  sendJson,
  setSessionCookie,
  verifyOAuthState,
  visibleComment
};
