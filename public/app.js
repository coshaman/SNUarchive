const STAT_FIELDS = ["q1", "q2", "q3", "q4", "average", "maxScore"];
const RATING_OPTIONS = [
  { value: 1, label: "매우 쉬움" },
  { value: 2, label: "쉬움" },
  { value: 3, label: "보통" },
  { value: 4, label: "어려움" },
  { value: 5, label: "매우 어려움" }
];
const ASSESSMENT_OPTIONS = ["중간", "기말", "1차", "2차", "3차", "퀴즈", "과제", "기타"];
const MOBILE_QUERY = "(max-width: 1068px)";
const COURSE_BATCH_SIZE = 10;
const ADMIN_PAGE_SIZE = 10;
const ADMIN_LOG_PAGE_SIZE = 50;
const DIRECT_DRAFT_KEY = "snu-archive:direct-report-draft";
const SELECTED_COURSE_KEY = "snu-archive:selected-course-key";
const NICKNAME_KEY = "snu-archive:last-nickname";

const state = {
  config: null,
  token: "",
  user: null,
  view: "archive",
  courses: [],
  selected: null,
  stats: [],
  poll: null,
  pollAssessment: "",
  selectedRating: null,
  activity: {
    recentStats: {},
    activePolls: new Set()
  },
  courseVisibleCount: COURSE_BATCH_SIZE,
  favorites: new Set(),
  adminReports: [],
  courseAdminReports: [],
  adminStats: [],
  adminLogs: [],
  adminTab: "work",
  adminHasMore: {
    reports: false,
    stats: false,
    logs: false
  },
  toastTimer: null
};

const els = {};
const $ = (selector) => document.querySelector(selector);

function cacheElements() {
  Object.assign(els, {
    signinTile: $("#signinTile"),
    viewTabs: $("#viewTabs"),
    archiveView: $("#archiveView"),
    adminView: $("#adminView"),
    authPanel: $("#authPanel"),
    searchPane: $("#searchPane"),
    searchToggle: $("#searchToggle"),
    searchContent: $("#searchContent"),
    searchInput: $("#searchInput"),
    resultList: $("#resultList"),
    courseDetail: $("#courseDetail"),
    courseMeta: $("#courseMeta"),
    courseTitle: $("#courseTitle"),
    favoriteButton: $("#favoriteButton"),
    refreshButton: $("#refreshButton"),
    statsCount: $("#statsCount"),
    statsBody: $("#statsBody"),
    directForm: $("#directForm"),
    quickForm: $("#quickForm"),
    voteQuota: $("#voteQuota"),
    pollBox: $("#pollBox"),
    courseAdminSection: $("#courseAdminSection"),
    courseAdminReports: $("#courseAdminReports"),
    courseAdminRefreshButton: $("#courseAdminRefreshButton"),
    adminSubTabs: $("#adminSubTabs"),
    adminWorkPanel: $("#adminWorkPanel"),
    adminStatsPanel: $("#adminStatsPanel"),
    adminLogPanel: $("#adminLogPanel"),
    adminRefreshButton: $("#adminRefreshButton"),
    adminReportCount: $("#adminReportCount"),
    adminReports: $("#adminReports"),
    adminReportsMore: $("#adminReportsMore"),
    adminStatsCount: $("#adminStatsCount"),
    adminStatsList: $("#adminStatsList"),
    adminStatsMore: $("#adminStatsMore"),
    adminLogCount: $("#adminLogCount"),
    adminLogs: $("#adminLogs"),
    adminLogsMore: $("#adminLogsMore"),
    adminLogsExport: $("#adminLogsExport"),
    adminLogsClear: $("#adminLogsClear"),
    toast: $("#toast")
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, "");
}

function searchTerms(value) {
  return String(value ?? "")
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .map(normalize)
    .filter(Boolean);
}

function semesterLabel(value) {
  return {
    1: "1학기",
    2: "2학기",
    3: "여름",
    4: "겨울"
  }[Number(value)] || `${value}학기`;
}

function currentAcademicTerm(date = new Date()) {
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  if (month <= 2) return { year: year - 1, semester: 4 };
  if (month <= 6) return { year, semester: 1 };
  if (month <= 8) return { year, semester: 3 };
  return { year, semester: 2 };
}

function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(value));
}

function ratingLabel(value) {
  return RATING_OPTIONS.find((option) => option.value === Number(value))?.label || "-";
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2600);
}

function authHeaders() {
  return state.token ? { authorization: `Bearer ${state.token}` } : {};
}

async function request(path, options = {}) {
  const headers = {
    ...(options.auth === false ? {} : authHeaders()),
    ...(options.headers || {})
  };

  let body = options.body;
  if (body && typeof body === "object" && !(body instanceof FormData)) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(body);
  }

  const response = await fetch(path, { ...options, credentials: "same-origin", headers, body });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "요청에 실패했습니다.");
  return payload;
}

async function refreshMe() {
  state.user = await request("/api/me");
}

async function loadActivity() {
  if (!state.user) {
    state.activity = { recentStats: {}, activePolls: new Set() };
    return;
  }

  const activity = await request("/api/course-activity");
  state.activity = {
    recentStats: activity.recentStats || {},
    activePolls: new Set(activity.activePolls || [])
  };
}

async function loadFavorites() {
  if (!state.user) {
    state.favorites = new Set();
    return;
  }

  const response = await request("/api/favorites");
  state.favorites = new Set((response.favorites || []).map((favorite) => favorite.course_key));
}

function defaultAssessmentByDate(date = new Date()) {
  const md = (date.getMonth() + 1) * 100 + date.getDate();
  if ((md >= 415 && md <= 505) || (md >= 1015 && md <= 1105)) return "중간";
  if ((md >= 610 && md <= 630) || (md >= 1210 && md <= 1230)) return "기말";
  return "중간";
}

function signInWithGoogle() {
  window.location.href = state.config?.loginUrl || "/api/auth/google/start";
}

async function demoLogin(email) {
  state.token = `demo:${email}`;
  await refreshMe();
  await Promise.all([loadActivity(), loadFavorites()]);
  renderAll();
  showToast(`${email} 로그인`);
}

async function signOut() {
  await request("/api/auth/logout", { method: "POST", auth: false });
  state.token = "";
  state.user = null;
  state.selected = null;
  state.view = "archive";
  state.stats = [];
  state.poll = null;
  state.pollAssessment = "";
  state.favorites = new Set();
  state.activity = { recentStats: {}, activePolls: new Set() };
  renderAll();
}

function setSearchEnabled(enabled) {
  els.searchInput.disabled = !enabled;
}

function renderAuth() {
  els.viewTabs.hidden = !state.user?.isAdmin;

  if (state.user) {
    els.authPanel.innerHTML = `
      <span class="auth-email">${escapeHtml(state.user.email)}${state.user.isAdmin ? " · 관리자" : ""}</span>
      <button class="subtle" type="button" data-auth="logout">로그아웃</button>
    `;
    setSearchEnabled(true);
    return;
  }

  setSearchEnabled(false);
  if (!state.config) {
    els.authPanel.innerHTML = "";
    return;
  }

  if (state.config?.googleAuth) {
    els.authPanel.innerHTML = `<button class="primary" type="button" data-auth="google">Google 로그인</button>`;
    return;
  }

  if (state.config?.demoAuth) {
    els.authPanel.innerHTML = `
      <button class="primary" type="button" data-auth="demo">데모</button>
      <button class="subtle" type="button" data-auth="demo-admin">관리자</button>
    `;
    return;
  }

  els.authPanel.innerHTML = "";
}

function setView(view) {
  if (!state.user) {
    els.signinTile.hidden = false;
    els.archiveView.hidden = true;
    els.adminView.hidden = true;
    return;
  }

  state.view = view === "admin" && state.user?.isAdmin ? "admin" : "archive";
  els.signinTile.hidden = true;
  els.archiveView.hidden = state.view !== "archive";
  els.adminView.hidden = state.view !== "admin";
  els.viewTabs.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === state.view);
  });
  if (state.view === "admin") {
    setAdminTab(state.adminTab);
    loadAdminData().catch((error) => showToast(error.message));
  }
}

function renderAll() {
  renderAuth();
  renderSearch();
  setView(state.view);
  els.archiveView.classList.toggle("has-selection", Boolean(state.selected));
  if (state.user && !state.selected) renderEmpty();
}

function renderEmpty() {
  els.courseDetail.hidden = true;
  els.archiveView.classList.remove("has-selection");
}

async function loadCourses() {
  const response = await fetch("/courses.json");
  const courses = await response.json();
  state.courses = courses.map((course) => {
    const departments = course.departments?.length ? course.departments : [course.department].filter(Boolean);
    return {
      ...course,
      departments,
      searchText: normalize(`${course.title} ${course.instructor} ${departments.join(" ")}`)
    };
  });
  renderSearch();
}

function departmentsText(course) {
  const departments = course?.departments?.length ? course.departments : [course?.department].filter(Boolean);
  if (!departments.length) return "미분류";
  if (departments.length <= 2) return departments.join(", ");
  return `${departments.slice(0, 2).join(", ")} 외 ${departments.length - 2}`;
}

function latestOffering(course) {
  return course?.offerings?.[0] || {
    year: course?.latestYear || course?.year || currentAcademicTerm().year,
    semester: course?.latestSemester || course?.semester || currentAcademicTerm().semester
  };
}

function activePoll(course) {
  return state.activity.activePolls.has(course.course_key);
}

function favoriteCourse(course) {
  return state.favorites.has(course.course_key);
}

function recentStatTime(course) {
  return Date.parse(state.activity.recentStats[course.course_key]?.latestStatAt || "") || 0;
}

function compareCourses(a, b) {
  const favoriteDiff = Number(favoriteCourse(b)) - Number(favoriteCourse(a));
  if (favoriteDiff) return favoriteDiff;

  const activeDiff = Number(activePoll(b)) - Number(activePoll(a));
  if (activeDiff) return activeDiff;

  const recentDiff = recentStatTime(b) - recentStatTime(a);
  if (recentDiff) return recentDiff;

  const aOffering = latestOffering(a);
  const bOffering = latestOffering(b);
  if (bOffering.year !== aOffering.year) return bOffering.year - aOffering.year;
  if (bOffering.semester !== aOffering.semester) return bOffering.semester - aOffering.semester;
  return `${a.title} ${a.instructor}`.localeCompare(`${b.title} ${b.instructor}`, "ko");
}

function matchingCourses() {
  if (!state.user) return [];
  const terms = searchTerms(els.searchInput.value);
  const searching = terms.length > 0;

  let results = state.courses.filter((course) => {
    return !searching || terms.every((term) => course.searchText.includes(term));
  });

  results = results.sort(compareCourses);
  return results;
}

function filteredCourses() {
  return matchingCourses().slice(0, state.courseVisibleCount);
}

function resetCoursePagination() {
  state.courseVisibleCount = COURSE_BATCH_SIZE;
}

function maybeLoadMoreCourses() {
  if (!state.user || !els.resultList) return;
  const total = matchingCourses().length;
  if (state.courseVisibleCount >= total) return;
  const remaining = els.resultList.scrollHeight - els.resultList.scrollTop - els.resultList.clientHeight;
  if (remaining > 180) return;
  state.courseVisibleCount = Math.min(total, state.courseVisibleCount + COURSE_BATCH_SIZE);
  renderSearch({ preserveScroll: true });
}

function renderSearch(options = {}) {
  const previousScroll = options.preserveScroll ? els.resultList.scrollTop : 0;
  const totalResults = matchingCourses();
  const results = filteredCourses();

  if (!state.user) {
    els.resultList.innerHTML = "";
    return;
  }

  if (!results.length) {
      const searching = searchTerms(els.searchInput.value).length > 0;
      els.resultList.innerHTML = `<div class="empty-small">${searching ? "검색 결과가 없습니다." : "검색어를 입력하거나 즐겨찾기를 추가하세요."}</div>`;
    return;
  }

  els.resultList.innerHTML = results
    .map((course) => {
      const statInfo = state.activity.recentStats[course.course_key];
      const badges = [
        favoriteCourse(course) ? "즐겨찾기" : "",
        activePoll(course) ? "투표중" : "",
        statInfo?.latestStatAt ? `최근 제보 ${formatDate(statInfo.latestStatAt)}` : ""
      ].filter(Boolean);

      return `
        <article class="result-item ${state.selected?.course_key === course.course_key ? "active" : ""}">
          <button class="result-main" type="button" data-course-id="${escapeHtml(course.id)}">
            <span class="result-title-line">
              <strong>${escapeHtml(course.title)}</strong>
            </span>
            <span>${escapeHtml(course.instructor)} · ${escapeHtml(departmentsText(course))}</span>
            ${badges.length ? `<span class="result-badges">${badges.map((badge) => `<em>${escapeHtml(badge)}</em>`).join("")}</span>` : ""}
          </button>
          <button
            class="favorite-inline"
            type="button"
            data-favorite-course-id="${escapeHtml(course.id)}"
            aria-pressed="${favoriteCourse(course) ? "true" : "false"}"
            title="즐겨찾기"
          >${favoriteCourse(course) ? "★" : "☆"}</button>
        </article>
      `;
    })
    .join("") +
    (results.length < totalResults.length ? `<div class="load-sentinel" aria-hidden="true"></div>` : "");

  if (options.preserveScroll) els.resultList.scrollTop = previousScroll;
}

function reportTermValue(form) {
  const fallback = currentAcademicTerm();
  return {
    year: Number(form?.elements.year?.value || fallback.year),
    semester: Number(form?.elements.semester?.value || fallback.semester)
  };
}

function coursePayload(course = state.selected, form = null) {
  if (!course) return null;
  const term = reportTermValue(form);
  return {
    id: course.id || course.course_key,
    course_key: course.course_key,
    title: course.title,
    instructor: course.instructor,
    department: course.department || course.departments?.[0] || "미분류",
    year: term.year,
    semester: term.semester
  };
}

function mobileViewport() {
  return window.matchMedia(MOBILE_QUERY).matches;
}

function setSearchCollapsed(collapsed) {
  const shouldCollapse = collapsed && mobileViewport();
  els.searchPane.classList.toggle("collapsed", shouldCollapse);
  els.searchToggle.setAttribute("aria-expanded", String(!shouldCollapse));
  els.searchToggle.setAttribute("aria-label", `강의 검색 ${shouldCollapse ? "열기" : "접기"}`);
  const text = els.searchToggle.querySelector(".sr-only");
  if (text) text.textContent = shouldCollapse ? "검색 열기" : "접기";
}

async function selectCourse(id) {
  const course = state.courses.find((item) => item.id === id || item.course_key === id);
  if (!course) return;
  state.selected = course;
  state.selectedRating = null;
  state.pollAssessment = defaultAssessmentByDate();
  resetReportForms();
  storageSet(SELECTED_COURSE_KEY, state.selected.course_key);
  restoreDirectDraftForSelected();
  els.archiveView.classList.add("has-selection");
  renderSearch();
  renderFavoriteButton();
  setSearchCollapsed(true);
  await loadDetail();
}

async function restoreLastSelectedCourse() {
  if (!state.user || state.selected) return;
  const courseKey = storageGet(SELECTED_COURSE_KEY);
  if (!courseKey) return;
  const course = state.courses.find((item) => item.course_key === courseKey || item.id === courseKey);
  if (!course) return;
  await selectCourse(course.id);
}

async function toggleFavorite(course) {
  if (!course) return;
  const next = !favoriteCourse(course);
  const response = await request("/api/favorites", {
    method: "POST",
    body: {
      favorite: next,
      course: coursePayload(course)
    }
  });
  state.favorites = new Set((response.favorites || []).map((favorite) => favorite.course_key));
  renderSearch();
  renderFavoriteButton();
  showToast(next ? "즐겨찾기에 추가했습니다." : "즐겨찾기에서 제거했습니다.");
}

function renderFavoriteButton() {
  if (!state.selected) return;
  const favorited = favoriteCourse(state.selected);
  els.favoriteButton.textContent = favorited ? "★" : "☆";
  els.favoriteButton.setAttribute("aria-pressed", String(favorited));
}

async function loadDetail() {
  if (!state.user || !state.selected) {
    renderEmpty();
    return;
  }

  els.courseDetail.hidden = false;
  els.courseTitle.textContent = state.selected.title;
  els.courseMeta.textContent = `${state.selected.instructor} · ${departmentsText(state.selected)}`;
  els.statsBody.innerHTML = `<tr><td colspan="10">불러오는 중</td></tr>`;
  els.pollBox.innerHTML = `<div class="empty-small">불러오는 중</div>`;

  try {
    const pollAssessment = state.pollAssessment || defaultAssessmentByDate();
    const statsPromise = request(`/api/stats?courseKey=${encodeURIComponent(state.selected.course_key)}`);
    let pollResponse = await request(`/api/polls?courseKey=${encodeURIComponent(state.selected.course_key)}`);
    if (!pollResponse.active) {
      pollResponse = await request(
        `/api/polls?courseKey=${encodeURIComponent(state.selected.course_key)}&assessmentLabel=${encodeURIComponent(pollAssessment)}`
      );
    }
    const statsResponse = await statsPromise;
    state.stats = statsResponse.stats || [];
    state.poll = pollResponse;
    state.pollAssessment = pollResponse.assessmentLabel || pollAssessment;
    renderStats();
    renderPoll();
    renderFavoriteButton();
    await renderCourseAdminSection();
  } catch (error) {
    showToast(error.message);
  }
}

function valueOrDash(value) {
  return value === null || value === undefined || value === "" ? "-" : value;
}

function statNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function displayNumber(value) {
  const number = statNumber(value);
  if (number === null) return "-";
  return Number.isInteger(number) ? String(number) : String(Math.round(number * 10) / 10);
}

function percentOf(value, max) {
  const number = statNumber(value);
  if (number === null || !max) return null;
  return Math.max(0, Math.min(100, (number / max) * 100));
}

function statGraph(stat) {
  const graphPoints = [
    { key: "q1", label: "Q1", value: statNumber(stat.q1), className: "quartile q1" },
    { key: "q2", label: "Q2", value: statNumber(stat.q2 ?? stat.median), className: "quartile q2" },
    { key: "q3", label: "Q3", value: statNumber(stat.q3), className: "quartile q3" },
    { key: "average", label: "평균", value: statNumber(stat.average), className: "average" }
  ];
  const values = [stat.q1, stat.q2 ?? stat.median, stat.q3, stat.q4, stat.average]
    .map(statNumber)
    .filter((value) => value !== null);
  if (!values.length) return `<div class="stat-graph-empty">표시할 점수 정보가 없습니다.</div>`;

  const maxScore = statNumber(stat.max_score);
  const axisMax = Math.max(maxScore || 0, ...values, 1);
  const q1Position = percentOf(stat.q1, axisMax);
  const q3Position = percentOf(stat.q3, axisMax);
  const rangeStart = q1Position !== null && q3Position !== null ? Math.min(q1Position, q3Position) : null;
  const rangeWidth = q1Position !== null && q3Position !== null ? Math.abs(q3Position - q1Position) : null;
  const markers = graphPoints
    .map((point) => {
      const position = percentOf(point.value, axisMax);
      if (position === null) return "";
      return `
        <span
          class="stat-marker ${point.className}"
          style="left:${position}%"
          data-label="${escapeHtml(point.label)}"
          title="${escapeHtml(`${point.label} ${displayNumber(point.value)}`)}"
        ></span>
      `;
    })
    .join("");

  return `
    <div class="stat-graph" aria-label="Q1 Q2 Q3 평균 분포">
      <div class="stat-axis">
        ${rangeStart !== null ? `<span class="stat-range" style="left:${rangeStart}%;width:${rangeWidth}%"></span>` : ""}
        ${markers}
      </div>
      <div class="stat-scale">
        <span>0</span>
        <span>${maxScore ? `만점 ${displayNumber(maxScore)}` : `기준 ${displayNumber(axisMax)}`}</span>
      </div>
    </div>
  `;
}

function renderStats() {
  els.statsCount.textContent = `${state.stats.length}건`;
  if (!state.stats.length) {
    els.statsBody.innerHTML = `<tr><td colspan="10">등록된 통계량이 없습니다.</td></tr>`;
    return;
  }

  els.statsBody.innerHTML = state.stats
    .map(
      (stat) => `
        <tr class="stat-data-row">
          <td data-label="시험">${escapeHtml(stat.assessment_label || "기타")}</td>
          <td data-label="연도/학기">${escapeHtml(`${stat.year} ${semesterLabel(stat.semester)}`)}</td>
          <td data-label="Q1">${escapeHtml(valueOrDash(stat.q1))}</td>
          <td data-label="Q2">${escapeHtml(valueOrDash(stat.q2 ?? stat.median))}</td>
          <td data-label="Q3">${escapeHtml(valueOrDash(stat.q3))}</td>
          <td data-label="Q4">${escapeHtml(valueOrDash(stat.q4))}</td>
          <td data-label="평균">${escapeHtml(valueOrDash(stat.average))}</td>
          <td data-label="만점">${escapeHtml(valueOrDash(stat.max_score))}</td>
          <td data-label="제보자">${escapeHtml(stat.nickname || "(익명)")}</td>
          <td data-label="비고" class="stat-note-cell" title="${escapeHtml(stat.note || "")}">${escapeHtml(stat.note || "-")}</td>
        </tr>
        <tr class="stat-graph-row">
          <td data-label="분포" class="stat-graph-cell" colspan="10">${statGraph(stat)}</td>
        </tr>
      `
    )
    .join("");
}

function formValue(form, name) {
  return form.elements[name]?.value || "";
}

function assessmentValue(form) {
  const selected = formValue(form, "assessmentLabel");
  if (selected === "__custom") return formValue(form, "customAssessment").trim() || "기타";
  return selected || "기타";
}

function syncCustomAssessment(form) {
  if (!form) return;
  const select = form.elements.assessmentLabel;
  const input = form.elements.customAssessment;
  const wrap = input?.closest(".custom-assessment-wrap");
  const isCustom = select?.value === "__custom";
  if (wrap) wrap.hidden = !isCustom;
  if (input) {
    input.disabled = !isCustom;
    if (!isCustom) input.value = "";
  }
}

function termYearsForSelected() {
  const current = currentAcademicTerm();
  const years = new Set([current.year]);
  for (const offering of state.selected?.offerings || []) years.add(Number(offering.year));
  return [...years].filter(Boolean).sort((a, b) => b - a);
}

function populateTermSelects(form) {
  const current = currentAcademicTerm();
  const years = termYearsForSelected();
  form.elements.year.innerHTML = years.map((year) => `<option value="${year}">${year}</option>`).join("");
  form.elements.semester.innerHTML = [1, 2, 3, 4]
    .map((semester) => `<option value="${semester}">${semesterLabel(semester)}</option>`)
    .join("");
  form.elements.year.value = String(current.year);
  form.elements.semester.value = String(current.semester);
}

function resetAssessmentPicker(form) {
  form.elements.assessmentLabel.value = defaultAssessmentByDate();
  syncCustomAssessment(form);
}

function resetReportForm(form) {
  form.reset();
  populateTermSelects(form);
  resetAssessmentPicker(form);
  applySavedNickname(form);
  setReportCardOpen(form, !form.classList.contains("collapsed"));
}

function resetReportForms() {
  [els.directForm, els.quickForm].forEach(resetReportForm);
  updateDirectSubmit();
  updateQuickSubmit();
}

function directHasContent() {
  return STAT_FIELDS.some((field) => formValue(els.directForm, field).trim()) || formValue(els.directForm, "note").trim();
}

function updateDirectSubmit() {
  els.directForm.querySelector('button[type="submit"]').disabled = !state.selected || !directHasContent();
}

function updateQuickSubmit() {
  const file = els.quickForm.elements.file.files[0];
  els.quickForm.querySelector('button[type="submit"]').disabled = !state.selected || !file;
}

function sanitizeNumberInput(input) {
  const cleaned = input.value
    .replace(/[^\d.]/g, "")
    .replace(/(\..*)\./g, "$1");
  if (input.value !== cleaned) input.value = cleaned;
}

function storageGet(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Draft persistence is helpful, not critical.
  }
}

function storageRemove(key) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore storage failures.
  }
}

function directDraftValues() {
  const names = [
    "nickname",
    "assessmentLabel",
    "customAssessment",
    "year",
    "semester",
    "q1",
    "q2",
    "q3",
    "q4",
    "average",
    "maxScore",
    "note"
  ];
  return Object.fromEntries(names.map((name) => [name, formValue(els.directForm, name)]));
}

function directDraftHasUserInput(values) {
  return ["nickname", "customAssessment", "q1", "q2", "q3", "q4", "average", "maxScore", "note"].some(
    (name) => String(values?.[name] || "").trim()
  );
}

function saveDirectDraft() {
  if (!state.selected) return;
  const values = directDraftValues();
  storageSet(
    DIRECT_DRAFT_KEY,
    JSON.stringify({
      courseKey: state.selected.course_key,
      values,
      savedAt: new Date().toISOString()
    })
  );
}

function loadDirectDraft() {
  const raw = storageGet(DIRECT_DRAFT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function clearDirectDraft() {
  storageRemove(DIRECT_DRAFT_KEY);
}

function savedNickname() {
  return (storageGet(NICKNAME_KEY) || "").trim().slice(0, 10);
}

function saveNicknameFromForm(form) {
  const nickname = formValue(form, "nickname").trim().slice(0, 10);
  if (nickname) storageSet(NICKNAME_KEY, nickname);
}

function applySavedNickname(form) {
  const field = form?.elements.nickname;
  if (!field || field.value) return;
  const nickname = savedNickname();
  if (nickname) field.value = nickname;
}

function ensureSelectValue(select, value, label = value) {
  if (!select || value === undefined || value === null || value === "") return;
  if (![...select.options].some((option) => option.value === String(value))) {
    select.insertAdjacentHTML("afterbegin", `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`);
  }
  select.value = String(value);
}

function setReportCardOpen(card, open) {
  if (!card) return;
  card.classList.toggle("collapsed", !open);
  const body = card.querySelector(".report-body");
  const button = card.querySelector("[data-report-toggle]");
  if (body) body.setAttribute("aria-hidden", String(!open));
  if (button) {
    button.setAttribute("aria-expanded", String(open));
    button.setAttribute("aria-label", `${card === els.directForm ? "직접 제보" : "간편 제보"} ${open ? "접기" : "펼치기"}`);
    const text = button.querySelector(".sr-only");
    if (text) text.textContent = open ? "접기" : "펼치기";
  }
}

function restoreDirectDraftForSelected() {
  const draft = loadDirectDraft();
  if (!draft || draft.courseKey !== state.selected?.course_key) return;
  const values = draft.values || {};

  ensureSelectValue(els.directForm.elements.year, values.year);
  ensureSelectValue(els.directForm.elements.semester, values.semester, semesterLabel(values.semester));

  for (const [name, value] of Object.entries(values)) {
    const field = els.directForm.elements[name];
    if (field && value !== undefined && value !== null) field.value = value;
  }

  syncCustomAssessment(els.directForm);
  updateDirectSubmit();
  if (directDraftHasUserInput(values)) setReportCardOpen(els.directForm, true);
}

async function submitDirect(event) {
  event.preventDefault();
  if (!state.selected || !directHasContent()) return;
  const form = event.currentTarget;

  await request("/api/stats", {
    method: "POST",
    body: {
      course: coursePayload(state.selected, form),
      assessmentLabel: assessmentValue(form),
      nickname: formValue(form, "nickname"),
      q1: formValue(form, "q1"),
      q2: formValue(form, "q2"),
      q3: formValue(form, "q3"),
      q4: formValue(form, "q4"),
      average: formValue(form, "average"),
      maxScore: formValue(form, "maxScore"),
      note: formValue(form, "note")
    }
  });

  saveNicknameFromForm(form);
  clearDirectDraft();
  resetReportForm(form);
  updateDirectSubmit();
  showToast("통계량을 등록했습니다.");
  await loadActivity();
  renderSearch();
  await loadDetail();
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function submitQuick(event) {
  event.preventDefault();
  if (!state.selected) return;
  const form = event.currentTarget;
  const file = form.elements.file.files[0];
  if (!file) return;
  if (file.size > (state.config.uploadLimitMb || 3) * 1024 * 1024) {
    showToast(`파일은 ${state.config.uploadLimitMb || 3}MB 이하만 가능합니다.`);
    return;
  }

  await request("/api/quick-reports", {
    method: "POST",
    body: {
      course: coursePayload(state.selected, form),
      assessmentLabel: assessmentValue(form),
      nickname: formValue(form, "nickname"),
      fileName: file.name,
      contentType: file.type || "application/octet-stream",
      dataBase64: await fileToBase64(file)
    }
  });

  saveNicknameFromForm(form);
  resetReportForm(form);
  updateQuickSubmit();
  showToast("간편 제보를 접수했습니다.");
  if (state.user?.isAdmin) await renderCourseAdminSection();
}

function assessmentOptionsHtml(selected) {
  const normalized = selected || defaultAssessmentByDate();
  const known = ASSESSMENT_OPTIONS.includes(normalized);
  return `
    ${ASSESSMENT_OPTIONS.map((option) => `<option value="${option}" ${known && option === normalized ? "selected" : ""}>${option}</option>`).join("")}
    <option value="__custom" ${known ? "" : "selected"}>직접 입력</option>
  `;
}

function pollAssessmentFromBox() {
  const select = els.pollBox.querySelector("[data-poll-assessment]");
  const custom = els.pollBox.querySelector("[data-poll-custom-assessment]");
  if (select?.value === "__custom") return custom?.value.trim() || "기타";
  return select?.value || state.pollAssessment || defaultAssessmentByDate();
}

function syncPollCustomAssessment() {
  const select = els.pollBox.querySelector("[data-poll-assessment]");
  const input = els.pollBox.querySelector("[data-poll-custom-assessment]");
  const wrap = input?.closest(".poll-custom-assessment-wrap");
  const isCustom = select?.value === "__custom";
  if (wrap) wrap.hidden = !isCustom;
  if (input) {
    input.disabled = !isCustom;
    if (!isCustom) input.value = "";
  }
}

async function loadPollStatus(assessmentLabel = state.pollAssessment || defaultAssessmentByDate()) {
  if (!state.selected) return;
  const response = await request(
    `/api/polls?courseKey=${encodeURIComponent(state.selected.course_key)}&assessmentLabel=${encodeURIComponent(assessmentLabel)}`
  );
  state.poll = response;
  state.pollAssessment = response.assessmentLabel || assessmentLabel;
  state.selectedRating = null;
  renderPoll();
}

function renderPoll() {
  const poll = state.poll || {};
  const assessmentLabel = poll.assessmentLabel || state.pollAssessment || defaultAssessmentByDate();
  const remainingVotes = poll.remainingVoteCount ?? Math.max(0, (poll.monthlyVoteLimit || 10) - (poll.voteCountInWindow ?? poll.monthlyVoteCount ?? 0));
  const quotaLimit = poll.monthlyVoteLimit || 10;
  els.voteQuota.textContent = poll.userVote ? `남은 투표권: ${remainingVotes}/${quotaLimit}` : "";
  els.courseDetail.classList.toggle("poll-active", Boolean(poll.active));

  const max = Math.max(1, ...(poll.distribution || [0]));
  const bars = RATING_OPTIONS.map((option, index) => {
    const count = poll.distribution?.[index] || 0;
    return `
      <div class="bar-row">
        <span>${option.label}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.round((count / max) * 100)}%"></div></div>
        <span>${count}</span>
      </div>
    `;
  }).join("");

  const ratingButtons = RATING_OPTIONS.map(
    (option) => `
      <button type="button" data-rating="${option.value}" class="${state.selectedRating === option.value || (!state.selectedRating && Number(poll.userVote?.rating) === option.value) ? "active" : ""}">
        <span>${option.label}</span>
      </button>
    `
  ).join("");

  const summaryHtml =
    poll.active || poll.voteCount
      ? `
        <div class="poll-summary">
          <div class="poll-score">
            <span>${escapeHtml(assessmentLabel)} 누적 난이도</span>
            <strong>${poll.average ?? "-"}</strong>
            <span>${poll.voteCount || 0}표</span>
          </div>
          <div class="bars">${bars}</div>
        </div>
      `
      : `<div class="empty-small">${escapeHtml(assessmentLabel)} 난이도 투표 결과가 없습니다.</div>`;

  if (!poll.active) {
    els.pollBox.innerHTML = `
      <div class="poll-open-panel">
        <label>
          투표 대상
          <select data-poll-assessment>
            ${assessmentOptionsHtml(assessmentLabel)}
          </select>
        </label>
        <label class="poll-custom-assessment-wrap" hidden>
          직접 입력
          <input data-poll-custom-assessment placeholder="예: 2차 퀴즈" disabled />
        </label>
        <button class="primary" type="button" data-poll="open">투표 열기</button>
      </div>
      ${summaryHtml}
    `;
    syncPollCustomAssessment();
    return;
  }

  els.pollBox.innerHTML = `
    <div class="poll-status">
      <strong>${escapeHtml(assessmentLabel)} 난이도 투표 진행중</strong>
      <span>${formatDate(poll.poll?.closes_at)} 종료</span>
    </div>
    ${summaryHtml}
    <div class="rating-area">
      <div class="rating-buttons" aria-label="난이도 선택">${ratingButtons}</div>
      <button class="primary" type="button" data-poll="vote">${poll.userVote ? "다시 투표" : "투표"}</button>
      <span class="muted">${formatDate(poll.poll?.closes_at)} 종료</span>
    </div>
  `;
}

async function openPoll() {
  const assessmentLabel = pollAssessmentFromBox();
  state.poll = await request("/api/polls", {
    method: "POST",
    body: { action: "open", course: coursePayload(), assessmentLabel }
  });
  state.pollAssessment = state.poll.assessmentLabel || assessmentLabel;
  showToast(`${state.pollAssessment} 투표를 열었습니다.`);
  if (state.selected?.course_key) state.activity.activePolls.add(state.selected.course_key);
  renderSearch();
  renderPoll();
}

async function submitVote() {
  if (!state.selectedRating) {
    showToast("난이도를 선택해주세요.");
    return;
  }

  state.poll = await request("/api/polls", {
    method: "POST",
    body: {
      action: "vote",
      course: coursePayload(),
      assessmentLabel: state.poll?.assessmentLabel || state.pollAssessment,
      rating: state.selectedRating
    }
  });
  showToast("투표했습니다.");
  renderPoll();
}

async function renderCourseAdminSection() {
  const show = Boolean(state.user?.isAdmin && state.selected);
  els.courseAdminSection.hidden = !show;
  if (!show) return;
  const response = await request(`/api/quick-reports?courseKey=${encodeURIComponent(state.selected.course_key)}&status=pending`);
  state.courseAdminReports = response.reports || [];
  renderQuickReports(els.courseAdminReports, state.courseAdminReports);
}

async function loadAdminData() {
  if (!state.user?.isAdmin) return;
  if (state.adminTab === "stats") {
    await loadAdminStats();
    return;
  }
  if (state.adminTab === "logs") {
    await loadAdminLogs();
    return;
  }
  await loadAdminReports();
}

async function loadAdminReports({ append = false } = {}) {
  if (!append) state.adminReports = [];
  const offset = append ? state.adminReports.length : 0;
  const response = await request(`/api/quick-reports?status=all&limit=${ADMIN_PAGE_SIZE}&offset=${offset}`);
  const reports = response.reports || [];
  state.adminReports = append ? [...state.adminReports, ...reports] : reports;
  state.adminHasMore.reports = Boolean(response.hasMore);
  renderQuickReports(els.adminReports, state.adminReports);
}

async function loadAdminStats({ append = false } = {}) {
  if (!append) state.adminStats = [];
  const offset = append ? state.adminStats.length : 0;
  const response = await request(`/api/admin-stats?limit=${ADMIN_PAGE_SIZE}&offset=${offset}`);
  const stats = response.stats || [];
  state.adminStats = append ? [...state.adminStats, ...stats] : stats;
  state.adminHasMore.stats = Boolean(response.hasMore);
  renderAdminStats();
}

async function loadAdminLogs({ append = false } = {}) {
  if (!append) state.adminLogs = [];
  const offset = append ? state.adminLogs.length : 0;
  const response = await request(`/api/admin-logs?limit=${ADMIN_LOG_PAGE_SIZE}&offset=${offset}`).catch(() => ({ logs: [], hasMore: false }));
  const logs = response.logs || [];
  state.adminLogs = append ? [...state.adminLogs, ...logs] : logs;
  state.adminHasMore.logs = Boolean(response.hasMore);
  renderAdminLogs();
}

function setAdminTab(tab) {
  state.adminTab = ["work", "stats", "logs"].includes(tab) ? tab : "work";
  els.adminSubTabs?.querySelectorAll("[data-admin-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.adminTab === state.adminTab);
  });
  if (els.adminWorkPanel) els.adminWorkPanel.hidden = state.adminTab !== "work";
  if (els.adminStatsPanel) els.adminStatsPanel.hidden = state.adminTab !== "stats";
  if (els.adminLogPanel) els.adminLogPanel.hidden = state.adminTab !== "logs";
}

function actionLabel(action) {
  return {
    login: "로그인",
    direct_report: "직접 제보",
    quick_report: "간편 제보",
    quick_report_approved: "간편 제보 승인",
    quick_report_rejected: "간편 제보 반려",
    poll_open: "투표 열기",
    poll_vote: "난이도 투표",
    favorite_add: "즐겨찾기 추가",
    favorite_remove: "즐겨찾기 제거",
    stat_update: "통계량 수정"
  }[action] || action || "-";
}

function logMetadataText(metadata) {
  const data = metadata && typeof metadata === "object" ? metadata : {};
  return [data.courseTitle, data.instructor, data.assessmentLabel, data.rating ? `난이도 ${data.rating}` : ""]
    .filter(Boolean)
    .map(escapeHtml)
    .join(" · ");
}

function renderAdminLogs() {
  els.adminLogCount.textContent = `${state.adminLogs.length}건${state.adminHasMore.logs ? "+" : ""}`;
  els.adminLogsMore.hidden = !state.adminHasMore.logs;
  if (!state.adminLogs.length) {
    els.adminLogs.innerHTML = `<div class="empty-small">로그가 없습니다.</div>`;
    return;
  }

  els.adminLogs.innerHTML = state.adminLogs
    .map((log) => {
      const meta = logMetadataText(log.metadata);
      return `
        <article class="admin-item log-item">
          <header>
            <div>
              <h3>${escapeHtml(actionLabel(log.action))}</h3>
              <p>${escapeHtml(log.user_email || "-")}${log.google_name ? ` · ${escapeHtml(log.google_name)}` : ""}</p>
              ${meta ? `<p>${meta}</p>` : ""}
            </div>
            <time>${formatDate(log.created_at)}</time>
          </header>
        </article>
      `;
    })
    .join("");
}

async function exportAdminLogs() {
  const response = await request("/api/admin-logs?export=1&limit=5000");
  const payload = {
    exportedAt: new Date().toISOString(),
    logs: response.logs || []
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `SNU-Archive-logs-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function clearAdminLogs() {
  if (!window.confirm("로그를 모두 비울까요? 이 작업은 되돌릴 수 없습니다.")) return;
  await request("/api/admin-logs", { method: "DELETE" });
  state.adminLogs = [];
  state.adminHasMore.logs = false;
  renderAdminLogs();
  showToast("로그를 비웠습니다.");
}

function reportMeta(report) {
  return `${escapeHtml(report.instructor)} · ${escapeHtml(report.department)} · ${report.year} ${semesterLabel(report.semester)} · ${escapeHtml(report.assessment_label || "기타")} · ${escapeHtml(report.nickname || "(익명)")}`;
}

function reportFileKind(report) {
  const contentType = String(report.content_type || "").toLowerCase();
  const fileName = String(report.file_name || report.file_url || "").toLowerCase().split("?")[0];
  if (contentType.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp)$/i.test(fileName)) return "image";
  if (contentType.includes("pdf") || fileName.endsWith(".pdf")) return "pdf";
  return "";
}

function quickReportViewer(report) {
  if (!report.file_url) return "";
  const fileUrl = String(report.file_url);
  const kind = reportFileKind(report);
  if (kind === "image") {
    return `
      <div class="report-file-viewer">
        <img src="${escapeHtml(fileUrl)}" alt="${escapeHtml(report.file_name || "업로드 이미지")}" loading="lazy" />
      </div>
    `;
  }
  if (kind === "pdf") {
    const src = fileUrl.includes("#") ? fileUrl : `${fileUrl}#toolbar=0&navpanes=0`;
    return `
      <div class="report-file-viewer pdf-viewer">
        <iframe src="${escapeHtml(src)}" title="${escapeHtml(report.file_name || "업로드 PDF")}"></iframe>
      </div>
    `;
  }
  return "";
}

function quickReportCard(report) {
  const pending = report.status === "pending";
  return `
    <article class="admin-item" data-report-id="${escapeHtml(report.id)}">
      <header>
        <div>
          <h3>${escapeHtml(report.course_title)}</h3>
          <p>${reportMeta(report)}</p>
          <p>${escapeHtml(report.status)} · ${formatDate(report.created_at)}</p>
        </div>
        <a class="subtle" href="${escapeHtml(report.file_url || "#")}" target="_blank" rel="noreferrer">파일</a>
      </header>
      ${quickReportViewer(report)}
      ${
        pending
          ? `
            <div class="admin-edit-grid">
              <label>시험<input data-admin-field="assessmentLabel" value="${escapeHtml(report.assessment_label || "기타")}" /></label>
              <label>닉네임<input data-admin-field="nickname" maxlength="10" value="${escapeHtml(report.nickname || "(익명)")}" /></label>
              <label>Q1<input data-admin-field="q1" type="number" min="0" step="any" data-number-input /></label>
              <label>Q2<input data-admin-field="q2" type="number" min="0" step="any" data-number-input /></label>
              <label>Q3<input data-admin-field="q3" type="number" min="0" step="any" data-number-input /></label>
              <label>Q4<input data-admin-field="q4" type="number" min="0" step="any" data-number-input /></label>
              <label>평균<input data-admin-field="average" type="number" min="0" step="any" data-number-input /></label>
              <label>만점<input data-admin-field="maxScore" type="number" min="0" step="any" data-number-input /></label>
              <label>메모<input data-admin-field="adminNote" /></label>
            </div>
            <label>비고<textarea data-admin-field="note" rows="2"></textarea></label>
            <div class="admin-actions">
              <button class="primary" type="button" data-admin-action="approve">승인 등록</button>
              <button class="danger" type="button" data-admin-action="reject">반려</button>
            </div>
          `
          : ""
      }
    </article>
  `;
}

function renderQuickReports(container, reports) {
  if (container === els.adminReports) {
    els.adminReportCount.textContent = `${reports.length}건${state.adminHasMore.reports ? "+" : ""}`;
    els.adminReportsMore.hidden = !state.adminHasMore.reports;
  }
  if (!reports.length) {
    container.innerHTML = `<div class="empty-small">제보가 없습니다.</div>`;
    return;
  }
  container.innerHTML = reports.map(quickReportCard).join("");
}

function reportCourse(report) {
  return {
    id: report.course_id,
    course_key: report.course_key,
    title: report.course_title,
    instructor: report.instructor,
    department: report.department,
    year: report.year,
    semester: report.semester
  };
}

function adminField(card, name) {
  return card.querySelector(`[data-admin-field="${name}"]`)?.value || "";
}

async function handleQuickAdminAction(button) {
  const card = button.closest("[data-report-id]");
  const id = card?.dataset.reportId;
  const report = [...state.adminReports, ...state.courseAdminReports].find((item) => item.id === id);
  if (!report) return;

  if (button.dataset.adminAction === "reject") {
    await request("/api/quick-reports", {
      method: "PATCH",
      body: { id, status: "rejected", adminNote: adminField(card, "adminNote") }
    });
    showToast("반려 처리했습니다.");
  } else {
    await request("/api/quick-reports", {
      method: "PATCH",
      body: {
        id,
        status: "approved",
        adminNote: adminField(card, "adminNote"),
        stat: {
          course: reportCourse(report),
          assessmentLabel: adminField(card, "assessmentLabel"),
          nickname: adminField(card, "nickname"),
          q1: adminField(card, "q1"),
          q2: adminField(card, "q2"),
          q3: adminField(card, "q3"),
          q4: adminField(card, "q4"),
          average: adminField(card, "average"),
          maxScore: adminField(card, "maxScore"),
          note: adminField(card, "note")
        }
      }
    });
    showToast("통계량으로 등록했습니다.");
  }

  await loadActivity();
  renderSearch();
  if (state.view === "admin") await loadAdminData();
  if (state.selected) await loadDetail();
}

function renderAdminStats() {
  els.adminStatsCount.textContent = `${state.adminStats.length}건${state.adminHasMore.stats ? "+" : ""}`;
  els.adminStatsMore.hidden = !state.adminHasMore.stats;
  if (!state.adminStats.length) {
    els.adminStatsList.innerHTML = `<div class="empty-small">통계량이 없습니다.</div>`;
    return;
  }

  els.adminStatsList.innerHTML = state.adminStats
    .map(
      (stat) => `
        <article class="admin-item" data-stat-id="${escapeHtml(stat.id)}">
          <header>
            <div>
              <h3>${escapeHtml(stat.course_title)}</h3>
              <p>${escapeHtml(stat.instructor)} · ${stat.year} ${semesterLabel(stat.semester)} · ${formatDate(stat.created_at)}</p>
            </div>
          </header>
          <div class="admin-edit-grid">
            <label>시험<input data-stat-field="assessmentLabel" value="${escapeHtml(stat.assessment_label || "기타")}" /></label>
            <label>닉네임<input data-stat-field="nickname" maxlength="10" value="${escapeHtml(stat.nickname || "(익명)")}" /></label>
            <label>Q1<input data-stat-field="q1" type="number" min="0" step="any" data-number-input value="${escapeHtml(valueOrDash(stat.q1) === "-" ? "" : stat.q1)}" /></label>
            <label>Q2<input data-stat-field="q2" type="number" min="0" step="any" data-number-input value="${escapeHtml(valueOrDash(stat.q2 ?? stat.median) === "-" ? "" : stat.q2 ?? stat.median)}" /></label>
            <label>Q3<input data-stat-field="q3" type="number" min="0" step="any" data-number-input value="${escapeHtml(valueOrDash(stat.q3) === "-" ? "" : stat.q3)}" /></label>
            <label>Q4<input data-stat-field="q4" type="number" min="0" step="any" data-number-input value="${escapeHtml(valueOrDash(stat.q4) === "-" ? "" : stat.q4)}" /></label>
            <label>평균<input data-stat-field="average" type="number" min="0" step="any" data-number-input value="${escapeHtml(valueOrDash(stat.average) === "-" ? "" : stat.average)}" /></label>
            <label>만점<input data-stat-field="maxScore" type="number" min="0" step="any" data-number-input value="${escapeHtml(valueOrDash(stat.max_score) === "-" ? "" : stat.max_score)}" /></label>
          </div>
          <label>비고<textarea data-stat-field="note" rows="2">${escapeHtml(stat.note || "")}</textarea></label>
          <div class="admin-actions">
            <button class="primary" type="button" data-stat-action="save">수정 저장</button>
          </div>
        </article>
      `
    )
    .join("");
}

function statField(card, name) {
  return card.querySelector(`[data-stat-field="${name}"]`)?.value || "";
}

async function handleStatSave(button) {
  const card = button.closest("[data-stat-id]");
  const id = card?.dataset.statId;
  if (!id) return;

  await request("/api/admin-stats", {
    method: "PATCH",
    body: {
      id,
      assessmentLabel: statField(card, "assessmentLabel"),
      nickname: statField(card, "nickname"),
      q1: statField(card, "q1"),
      q2: statField(card, "q2"),
      q3: statField(card, "q3"),
      q4: statField(card, "q4"),
      average: statField(card, "average"),
      maxScore: statField(card, "maxScore"),
      note: statField(card, "note")
    }
  });
  showToast("통계량을 수정했습니다.");
  await loadActivity();
  renderSearch();
  await loadAdminData();
  if (state.selected) await loadDetail();
}

function toggleReportCard(button) {
  const card = button.closest("[data-report-card]");
  const nextOpen = card?.classList.contains("collapsed");
  setReportCardOpen(card, nextOpen);
}

function handleDirectDraftChange() {
  updateDirectSubmit();
  saveNicknameFromForm(els.directForm);
  saveDirectDraft();
}

function handleQuickFormChange() {
  saveNicknameFromForm(els.quickForm);
  updateQuickSubmit();
}

function bindEvents() {
  document.addEventListener("click", async (event) => {
    if (event.target.closest("[data-auth-trigger]")) {
      signInWithGoogle();
      return;
    }

    const reportToggle = event.target.closest("[data-report-toggle]");
    if (reportToggle) {
      toggleReportCard(reportToggle);
      return;
    }

    const authAction = event.target.closest("[data-auth]")?.dataset.auth;
    if (authAction) {
      try {
        if (authAction === "google") signInWithGoogle();
        if (authAction === "demo") await demoLogin("student@snu.ac.kr");
        if (authAction === "demo-admin") await demoLogin("admin@snu.ac.kr");
        if (authAction === "logout") await signOut();
      } catch (error) {
        showToast(error.message);
      }
    }
  });

  els.viewTabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-view]");
    if (button) setView(button.dataset.view);
  });

  els.adminSubTabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-admin-tab]");
    if (!button) return;
    setAdminTab(button.dataset.adminTab);
    loadAdminData().catch((error) => showToast(error.message));
  });

  els.searchInput.addEventListener("input", () => {
    resetCoursePagination();
    renderSearch();
  });
  els.resultList.addEventListener("scroll", maybeLoadMoreCourses);
  els.searchToggle.addEventListener("click", () => setSearchCollapsed(!els.searchPane.classList.contains("collapsed")));
  window.addEventListener("resize", () => {
    if (!mobileViewport()) setSearchCollapsed(false);
  });

  els.resultList.addEventListener("click", async (event) => {
    const favoriteButton = event.target.closest("[data-favorite-course-id]");
    const courseButton = event.target.closest("[data-course-id]");
    try {
      if (favoriteButton) {
        const course = state.courses.find((item) => item.id === favoriteButton.dataset.favoriteCourseId);
        await toggleFavorite(course);
        return;
      }
      if (courseButton) await selectCourse(courseButton.dataset.courseId);
    } catch (error) {
      showToast(error.message);
    }
  });

  els.favoriteButton.addEventListener("click", () => {
    toggleFavorite(state.selected).catch((error) => showToast(error.message));
  });

  document.addEventListener("keydown", (event) => {
    if (event.target.matches("[data-number-input]") && ["e", "E", "+", "-"].includes(event.key)) {
      event.preventDefault();
    }
  });

  document.addEventListener("input", (event) => {
    if (event.target.matches("[data-number-input]")) sanitizeNumberInput(event.target);
  });

  document.addEventListener("change", (event) => {
    if (event.target.matches('select[name="assessmentLabel"]')) {
      const form = event.target.closest("form");
      syncCustomAssessment(form);
      if (form === els.directForm) handleDirectDraftChange();
      if (form === els.quickForm) handleQuickFormChange();
    }
    if (event.target.matches("[data-poll-assessment]")) {
      syncPollCustomAssessment();
      if (event.target.value !== "__custom") {
        loadPollStatus(event.target.value).catch((error) => showToast(error.message));
      }
    }
    if (event.target.matches("[data-poll-custom-assessment]") && event.target.value.trim()) {
      loadPollStatus(event.target.value.trim()).catch((error) => showToast(error.message));
    }
  });

  els.refreshButton.addEventListener("click", () => loadDetail());
  els.directForm.addEventListener("input", handleDirectDraftChange);
  els.directForm.addEventListener("change", handleDirectDraftChange);
  els.directForm.addEventListener("submit", (event) => submitDirect(event).catch((error) => showToast(error.message)));
  els.quickForm.addEventListener("change", handleQuickFormChange);
  els.quickForm.addEventListener("input", handleQuickFormChange);
  els.quickForm.addEventListener("submit", (event) => submitQuick(event).catch((error) => showToast(error.message)));

  els.pollBox.addEventListener("click", async (event) => {
    const rating = event.target.closest("[data-rating]");
    const pollButton = event.target.closest("[data-poll]");
    try {
      if (rating) {
        state.selectedRating = Number(rating.dataset.rating);
        renderPoll();
      }
      if (pollButton?.dataset.poll === "open") await openPoll();
      if (pollButton?.dataset.poll === "vote") await submitVote();
    } catch (error) {
      showToast(error.message);
    }
  });

  els.courseAdminRefreshButton.addEventListener("click", () => {
    renderCourseAdminSection().catch((error) => showToast(error.message));
  });
  els.adminRefreshButton.addEventListener("click", () => {
    loadAdminData().catch((error) => showToast(error.message));
  });
  els.adminReportsMore.addEventListener("click", () => {
    loadAdminReports({ append: true }).catch((error) => showToast(error.message));
  });
  els.adminStatsMore.addEventListener("click", () => {
    loadAdminStats({ append: true }).catch((error) => showToast(error.message));
  });
  els.adminLogsMore.addEventListener("click", () => {
    loadAdminLogs({ append: true }).catch((error) => showToast(error.message));
  });
  els.adminLogsExport.addEventListener("click", () => {
    exportAdminLogs().catch((error) => showToast(error.message));
  });
  els.adminLogsClear.addEventListener("click", () => {
    clearAdminLogs().catch((error) => showToast(error.message));
  });
  [els.adminReports, els.courseAdminReports].forEach((container) => {
    container.addEventListener("click", (event) => {
      const button = event.target.closest("[data-admin-action]");
      if (button) handleQuickAdminAction(button).catch((error) => showToast(error.message));
    });
  });
  els.adminStatsList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-stat-action='save']");
    if (button) handleStatSave(button).catch((error) => showToast(error.message));
  });
}

async function init() {
  cacheElements();
  bindEvents();
  renderAuth();
  renderEmpty();
  resetReportForms();

  try {
    state.config = await request("/api/config", { auth: false });
    await loadCourses();
    await refreshMe().catch(() => {
      state.user = null;
    });
    await Promise.all([loadActivity(), loadFavorites()]);
    renderAll();
    await restoreLastSelectedCourse();

    const authStatus = new URLSearchParams(window.location.search).get("auth");
    if (authStatus === "ok") {
      showToast("로그인되었습니다.");
      window.history.replaceState({}, "", window.location.pathname);
    } else if (authStatus === "forbidden") {
      showToast("snu.ac.kr 계정만 사용할 수 있습니다.");
      window.history.replaceState({}, "", window.location.pathname);
    } else if (authStatus === "error") {
      showToast("Google 로그인을 완료하지 못했습니다.");
      window.history.replaceState({}, "", window.location.pathname);
    }
  } catch (error) {
    showToast(error.message);
  }
}

init();
