import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  browserLocalPersistence,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  signInAnonymously,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  collection,
  deleteField,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyB4gnU1SL-OKpAexNj80QZK31ZISFSCJAM",
  authDomain: "petracker-a65e6.firebaseapp.com",
  projectId: "petracker-a65e6",
  storageBucket: "petracker-a65e6.firebasestorage.app",
  messagingSenderId: "476103965548",
  appId: "1:476103965548:web:f8cad9cbe3d62130ac5149",
};

const STATUS_VALUES = [
  "assignment",
  "solved in lecture",
  "solved",
  "unsolved",
];

const MARK_SOLVABLE_STATUSES = new Set(["unsolved", "solved"]);

const DEFAULT_PROBLEM = {
  statusLabel: "unsolved",
  solvedCount: 0,
  lastSolvedAt: null,
};

const DEFAULT_MAX_PROBLEM_NUMBER = 986;
const DEFAULT_MIN_LEVEL = 0;
const DEFAULT_MAX_LEVEL = 38;
const PIN_HASH_ITERATIONS = 120000;
const PIN_SALT_BYTES = 16;

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

const loginCard = document.getElementById("loginCard");
const loginForm = document.getElementById("loginForm");
const loginStatus = document.getElementById("loginStatus");
const displayNameInput = document.getElementById("displayName");
const pinInput = document.getElementById("pin");
const themeToggleBtn = document.getElementById("themeToggleBtn");
const viewSwitch = document.getElementById("viewSwitch");
const trackerViewBtn = document.getElementById("trackerViewBtn");
const leaderboardBtn = document.getElementById("leaderboardBtn");

const mainApp = document.getElementById("mainApp");
const appStatus = document.getElementById("appStatus");
const trackerView = document.getElementById("trackerView");
const leaderboardView = document.getElementById("leaderboardView");
const searchInput = document.getElementById("searchInput");
const minLevelSelect = document.getElementById("minLevelSelect");
const maxLevelSelect = document.getElementById("maxLevelSelect");
const branchSelect = document.getElementById("branchSelect");
const filterBar = document.getElementById("filterBar");
const problemGrid = document.getElementById("problemGrid");
const logoutBtn = document.getElementById("logoutBtn");

const panelBackdrop = document.getElementById("panelBackdrop");
const problemPanel = document.getElementById("problemPanel");
const panelTitle = document.getElementById("panelTitle");
const panelProblemLink = document.getElementById("panelProblemLink");
const metaLevel = document.getElementById("metaLevel");
const metaBranch = document.getElementById("metaBranch");
const metaConfidence = document.getElementById("metaConfidence");
const metaTags = document.getElementById("metaTags");
const metaSolvedBy = document.getElementById("metaSolvedBy");
const metaSolvedCount = document.getElementById("metaSolvedCount");
const metaLastSolved = document.getElementById("metaLastSolved");
const statusEditor = document.getElementById("statusEditor");
const panelStatusSelect = document.getElementById("panelStatusSelect");
const panelSaveBtn = document.getElementById("panelSaveBtn");
const panelSolveBtn = document.getElementById("panelSolveBtn");
const panelDeleteBtn = document.getElementById("panelDeleteBtn");
const panelCloseBtn = document.getElementById("panelCloseBtn");
const leaderboardSortBar = document.getElementById("leaderboardSortBar");
const leaderboardGrid = document.getElementById("leaderboardGrid");
const leaderboardEmpty = document.getElementById("leaderboardEmpty");
const leaderboardCurrentUserLabel = document.getElementById("leaderboardCurrentUserLabel");
const opFeedback = document.getElementById("opFeedback");
const opMessage = document.getElementById("opMessage");
const opProgressBar = document.getElementById("opProgressBar");

const rememberedDisplayNameKey = "pe_tracker_display_name";
const explicitLogoutKey = "pe_tracker_explicit_logout";
const themePreferenceKey = "pe_tracker_theme";

let authReady = false;
let currentUid = null;
let currentDisplayName = "";
let allProblems = new Map();
let levelsByProblem = new Map();
let titlesByProblem = new Map();
let solvedByPeByProblem = new Map();
let questionSearchByProblem = new Map();
let branchesByProblem = new Map();
let confidenceByProblem = new Map();
let topicTagsByProblem = new Map();
let currentFilter = "all";
let activeProblemNumber = null;
let listenersStarted = false;
let unSubProblems = null;
let unSubMySolveEventsByNameKey = null;
let unSubMySolveEventsByName = null;
let unSubLeaderboardSolveEvents = null;
let opProgressTimer = null;
let opHideTimer = null;
let maxProblemNumber = DEFAULT_MAX_PROBLEM_NUMBER;
let solvedByCurrentUser = new Set();
let solvedByCurrentUserByNameKey = new Set();
let solvedByCurrentUserByName = new Set();
let leaderboardEvents = [];
let leaderboardSort = "score";
let activeView = "tracker";
let autoResumeAttempted = false;
let searchInputDebounceTimer = null;
let loginInProgress = false;
let hasReceivedProblemsSnapshot = false;
let hasReceivedLeaderboardSnapshot = false;
let hasInitializedLevelRange = false;

boot();

function boot() {
  setPersistence(auth, browserLocalPersistence).catch((error) => {
    loginStatus.textContent = `Auth persistence warning: ${error.message}`;
  });

  onAuthStateChanged(auth, async (user) => {
    if (user) {
      currentUid = user.uid;
      authReady = true;
      await tryAutoResumeLogin();
      return;
    }

    try {
      await signInAnonymously(auth);
    } catch (error) {
      loginStatus.textContent = `Auth error: ${error.message}`;
    }
  });

  const rememberedDisplayName = localStorage.getItem(rememberedDisplayNameKey);
  if (typeof rememberedDisplayName === "string" && rememberedDisplayName.trim()) {
    displayNameInput.value = rememberedDisplayName.trim();
  }

  loginForm.addEventListener("submit", onLoginSubmit);
  displayNameInput.addEventListener("input", onDisplayNameInputChange);
  themeToggleBtn.addEventListener("click", onThemeToggle);
  trackerViewBtn.addEventListener("click", () => setActiveView("tracker"));
  leaderboardBtn.addEventListener("click", () => setActiveView("leaderboard"));
  restoreThemePreference();
  requestAnimationFrame(() => {
    document.documentElement.classList.add("theme-ready");
  });
  searchInput.addEventListener("input", onSearchInput);
  pinInput.addEventListener("input", onPinInput);
  minLevelSelect.addEventListener("change", onLevelRangeChange);
  maxLevelSelect.addEventListener("change", onLevelRangeChange);
  branchSelect.addEventListener("change", renderGrid);
  populateLevelFilterOptions(buildInclusiveRange(DEFAULT_MIN_LEVEL, DEFAULT_MAX_LEVEL));
  populateBranchFilterOptions([]);
  filterBar.addEventListener("click", onFilterClick);
  problemGrid.addEventListener("click", onGridClick);
  panelSaveBtn.addEventListener("click", onPanelSave);
  panelSolveBtn.addEventListener("click", onPanelSolve);
  panelDeleteBtn.addEventListener("click", onPanelDeleteSolve);
  panelCloseBtn.addEventListener("click", closePanel);
  panelBackdrop.addEventListener("click", closePanel);
  leaderboardSortBar.addEventListener("click", onLeaderboardSortClick);
  logoutBtn.addEventListener("click", onLogout);

  loadLevelsData();
  loadQuestionSearchIndex();
  loadQuestionCategories();
}

function restoreThemePreference() {
  const storedTheme = localStorage.getItem(themePreferenceKey);
  const preferred = storedTheme === "dark" || storedTheme === "light"
    ? storedTheme
    : "light";
  applyTheme(preferred);
}

function onThemeToggle() {
  const currentTheme = document.documentElement.getAttribute("data-theme") === "dark"
    ? "dark"
    : "light";
  const nextTheme = currentTheme === "dark" ? "light" : "dark";
  applyTheme(nextTheme);
  localStorage.setItem(themePreferenceKey, nextTheme);
}

function applyTheme(theme) {
  const normalizedTheme = theme === "dark" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", normalizedTheme);
  if (!themeToggleBtn) {
    return;
  }
  const nextLabel = normalizedTheme === "dark" ? "Light mode" : "Dark mode";
  themeToggleBtn.textContent = nextLabel;
  themeToggleBtn.setAttribute("aria-label", `Switch to ${nextLabel.toLowerCase()}`);
}

function formatProblemTitle(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.replaceAll("$", "").replace(/\s{2,}/g, " ").trim();
}

function onSearchInput() {
  if (searchInputDebounceTimer) {
    clearTimeout(searchInputDebounceTimer);
  }
  searchInputDebounceTimer = setTimeout(() => {
    searchInputDebounceTimer = null;
    renderGrid();
  }, 150);
}

function onDisplayNameInputChange() {
  autoResumeAttempted = false;
  if (!listenersStarted && loginStatus.textContent.startsWith("Session changed.")) {
    loginStatus.textContent = "";
  }
}

async function loadLevelsData() {
  try {
    const response = await fetch("data/levels.json", { cache: "no-store" });
    if (!response.ok) {
      return;
    }
    const raw = await response.json();
    const levelMap = new Map();
    const titleMap = new Map();
    const solvedByMap = new Map();
    const meta = raw._meta;

    Object.entries(raw).forEach(([key, value]) => {
      const number = Number(key);
      if (!number || typeof value !== "object" || value === null) {
        return;
      }

      const rawDifficulty = value.difficulty;
      const rawTitle = formatProblemTitle(value.title);
      const rawSolvedBy = value.solved_by;
      titleMap.set(number, rawTitle);

      if (rawSolvedBy === null || rawSolvedBy === undefined || rawSolvedBy === "") {
        solvedByMap.set(number, null);
      } else {
        const parsedSolvedBy = Number(rawSolvedBy);
        solvedByMap.set(
          number,
          Number.isFinite(parsedSolvedBy) && parsedSolvedBy >= 0 ? parsedSolvedBy : null
        );
      }

      if (rawDifficulty === null || rawDifficulty === undefined || rawDifficulty === "") {
        levelMap.set(number, null);
        return;
      }

      const parsedDifficulty = Number(rawDifficulty);
      levelMap.set(number, Number.isFinite(parsedDifficulty) ? parsedDifficulty : null);
    });

    const metaMaxProblem = Number(meta?.max_problem_number);
    maxProblemNumber = Number.isInteger(metaMaxProblem) && metaMaxProblem > 0
      ? metaMaxProblem
      : DEFAULT_MAX_PROBLEM_NUMBER;

    levelsByProblem = levelMap;
    titlesByProblem = titleMap;
    solvedByPeByProblem = solvedByMap;
    populateLevelFilterOptions(getAvailableLevels(levelsByProblem));
    renderGrid();
    renderLeaderboard();
    refreshPanelMeta();
  } catch (_error) {
    // Keep default level fallback when file is unavailable.
  }
}

async function loadQuestionSearchIndex() {
  try {
    const response = await fetch("data/question_search_index.json", { cache: "no-store" });
    if (!response.ok) {
      return;
    }

    const payload = await response.json();
    if (!payload || typeof payload !== "object") {
      return;
    }

    const indexMap = new Map();
    Object.entries(payload).forEach(([key, value]) => {
      if (key === "_meta") {
        return;
      }
      const number = Number(key);
      if (!Number.isInteger(number) || number < 1) {
        return;
      }
      if (!value || typeof value !== "object") {
        return;
      }

      const raw = typeof value.search_text === "string" ? value.search_text : "";
      indexMap.set(number, normalizeSearchText(raw));
    });

    if (!indexMap.size) {
      return;
    }

    questionSearchByProblem = indexMap;
    renderGrid();
  } catch (_error) {
    // Search falls back to title/tags when index is unavailable.
  }
}

async function loadQuestionCategories() {
  const sources = [
    { path: "data/question_categories.jsonl", format: "jsonl" },
    { path: "data/question_categories.json", format: "json" },
  ];

  for (const source of sources) {
    try {
      const response = await fetch(source.path, { cache: "no-store" });
      if (!response.ok) {
        continue;
      }

      const payload = await response.text();
      const parsed = source.format === "jsonl"
        ? parseBranchCategoriesFromJsonl(payload)
        : parseBranchCategoriesFromJson(payload);

      if (!parsed.branchMap.size) {
        continue;
      }

      branchesByProblem = parsed.branchMap;
      confidenceByProblem = parsed.confidenceMap;
      topicTagsByProblem = parsed.tagsMap;
      populateBranchFilterOptions(Array.from(parsed.branchSet));
      renderGrid();
      refreshPanelMeta();
      return;
    } catch (_error) {
      // Try next source.
    }
  }
}

function parseBranchCategoriesFromJsonl(text) {
  const branchMap = new Map();
  const confidenceMap = new Map();
  const tagsMap = new Map();
  const branchSet = new Set();
  text.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch (_error) {
      return;
    }

    collectBranchCategoryRecord(parsed, branchMap, confidenceMap, tagsMap, branchSet);
  });
  return { branchMap, confidenceMap, tagsMap, branchSet };
}

function parseBranchCategoriesFromJson(text) {
  const branchMap = new Map();
  const confidenceMap = new Map();
  const tagsMap = new Map();
  const branchSet = new Set();

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (_error) {
    return { branchMap, confidenceMap, tagsMap, branchSet };
  }

  if (Array.isArray(parsed)) {
    parsed.forEach((item) => {
      collectBranchCategoryRecord(item, branchMap, confidenceMap, tagsMap, branchSet);
    });
    return { branchMap, confidenceMap, tagsMap, branchSet };
  }

  if (parsed && typeof parsed === "object") {
    Object.values(parsed).forEach((item) => {
      collectBranchCategoryRecord(item, branchMap, confidenceMap, tagsMap, branchSet);
    });
  }

  return { branchMap, confidenceMap, tagsMap, branchSet };
}

function collectBranchCategoryRecord(record, branchMap, confidenceMap, tagsMap, branchSet) {
  if (!record || typeof record !== "object") {
    return;
  }
  const number = Number(record.problem_id ?? record.problemId ?? record.id);
  const branch = typeof record.primary_branch === "string"
    ? record.primary_branch.trim()
    : (typeof record.primaryBranch === "string" ? record.primaryBranch.trim() : "");
  if (!Number.isInteger(number) || number < 1 || !branch) {
    return;
  }

  const rawConfidence = Number(record.confidence);
  const confidence = Number.isFinite(rawConfidence)
    ? Math.max(0, Math.min(1, rawConfidence))
    : null;
  const rawTags = Array.isArray(record.topic_tags)
    ? record.topic_tags
    : (Array.isArray(record.topicTags) ? record.topicTags : []);
  const tags = rawTags
    .filter((tag) => typeof tag === "string")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)
    .slice(0, 6);

  branchMap.set(number, branch);
  confidenceMap.set(number, confidence);
  tagsMap.set(number, tags);
  branchSet.add(branch);
}

function getAvailableLevels(levelMap) {
  const levels = new Set();
  levelMap.forEach((difficulty) => {
    if (typeof difficulty === "number" && Number.isFinite(difficulty)) {
      levels.add(difficulty);
    }
  });
  return Array.from(levels).sort((a, b) => a - b);
}

function buildInclusiveRange(start, end) {
  const values = [];
  for (let value = start; value <= end; value += 1) {
    values.push(value);
  }
  return values;
}

function populateBranchFilterOptions(branches) {
  const preferredOrder = [
    "Algebra",
    "Geometry",
    "Trigonometry",
    "Calculus",
    "Probability_Statistics",
    "Number_Theory",
    "Discrete_Math",
    "Linear_Algebra",
    "Analytic_Geometry",
    "Mixed_or_Interdisciplinary",
  ];
  const previousValue = branchSelect.value;
  const branchSet = new Set(branches.filter((branch) => typeof branch === "string" && branch.trim()));
  const ordered = preferredOrder.filter((branch) => branchSet.has(branch));
  const extras = [...branchSet]
    .filter((branch) => !preferredOrder.includes(branch))
    .sort((a, b) => a.localeCompare(b));
  const allBranches = [...ordered, ...extras];

  branchSelect.innerHTML = "";
  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.dataset.baseLabel = "All branches";
  allOption.textContent = "All branches";
  branchSelect.append(allOption);

  allBranches.forEach((branch) => {
    const option = document.createElement("option");
    const baseLabel = formatBranchLabel(branch);
    option.value = branch;
    option.dataset.baseLabel = baseLabel;
    option.textContent = baseLabel;
    branchSelect.append(option);
  });

  if (previousValue && (previousValue === "all" || allBranches.includes(previousValue))) {
    branchSelect.value = previousValue;
  } else {
    branchSelect.value = "all";
  }
}

function populateLevelFilterOptions(levels) {
  if (!levels.length) {
    return;
  }
  const previousMin = minLevelSelect.value;
  const previousMax = maxLevelSelect.value;
  const levelValues = levels.map(String);
  const firstLevel = levelValues[0];
  const lastLevel = levelValues[levelValues.length - 1];

  minLevelSelect.innerHTML = "";
  maxLevelSelect.innerHTML = "";

  levels.forEach((level) => {
    const value = String(level);
    minLevelSelect.insertAdjacentHTML("beforeend", `<option value="${value}">${value}</option>`);
    maxLevelSelect.insertAdjacentHTML("beforeend", `<option value="${value}">${value}</option>`);
  });

  const hasLoadedLevelsData = levelsByProblem.size > 0;
  if (!hasInitializedLevelRange && hasLoadedLevelsData) {
    minLevelSelect.value = firstLevel;
    maxLevelSelect.value = lastLevel;
    hasInitializedLevelRange = true;
    return;
  }

  if (levelValues.includes(previousMin)) {
    minLevelSelect.value = previousMin;
  } else {
    minLevelSelect.value = firstLevel;
  }
  if (levelValues.includes(previousMax)) {
    maxLevelSelect.value = previousMax;
  } else {
    maxLevelSelect.value = lastLevel;
  }
}

function parseLevelSelectValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeLevelRange(minLevel, maxLevel) {
  if (minLevel !== null && maxLevel !== null && minLevel > maxLevel) {
    return [maxLevel, minLevel];
  }
  return [minLevel, maxLevel];
}

function onLevelRangeChange() {
  const minLevel = parseLevelSelectValue(minLevelSelect.value);
  const maxLevel = parseLevelSelectValue(maxLevelSelect.value);
  const [normalizedMin, normalizedMax] = normalizeLevelRange(minLevel, maxLevel);

  minLevelSelect.value = normalizedMin === null ? minLevelSelect.value : String(normalizedMin);
  maxLevelSelect.value = normalizedMax === null ? maxLevelSelect.value : String(normalizedMax);
  renderGrid();
}

function normalizeSearchText(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeSearchQuery(value) {
  const normalized = normalizeSearchText(value);
  if (!normalized) {
    return [];
  }
  return normalized.split(" ").filter(Boolean);
}

function getSearchBlobForProblem(number) {
  const indexed = questionSearchByProblem.get(number);
  if (typeof indexed === "string" && indexed) {
    return indexed;
  }

  const rawTitle = titlesByProblem.get(number) || "";
  const tags = topicTagsByProblem.get(number) || [];
  return normalizeSearchText(`${rawTitle} ${tags.join(" ")}`);
}

function matchesSearchQuery(number, queryTokens) {
  if (!queryTokens.length) {
    return true;
  }

  const numberText = String(number);
  const searchBlob = getSearchBlobForProblem(number);

  for (const token of queryTokens) {
    if (!token) {
      continue;
    }

    if (/^\d+$/.test(token)) {
      if (!numberText.includes(token) && !searchBlob.includes(token)) {
        return false;
      }
      continue;
    }

    if (!searchBlob.includes(token)) {
      return false;
    }
  }

  return true;
}

function onPinInput() {
  const digitsOnly = pinInput.value.replace(/\D/g, "").slice(0, 4);
  if (pinInput.value !== digitsOnly) {
    pinInput.value = digitsOnly;
  }
  if (digitsOnly.length > 0 && loginStatus.textContent.startsWith("Session changed.")) {
    loginStatus.textContent = "";
  }

  if (digitsOnly.length === 4 && displayNameInput.value.trim() && !loginInProgress) {
    void attemptLogin();
  }
}

async function onLoginSubmit(event) {
  event.preventDefault();

  await attemptLogin();
}

function setLoginInputsDisabled(disabled) {
  displayNameInput.disabled = disabled;
  pinInput.disabled = disabled;
}

async function attemptLogin() {
  if (loginInProgress) {
    return;
  }

  loginInProgress = true;
  setLoginInputsDisabled(true);

  const displayName = displayNameInput.value.trim();
  const pin = pinInput.value.trim();

  if (!displayName) {
    loginStatus.textContent = "Display name is required.";
    setLoginInputsDisabled(false);
    loginInProgress = false;
    return;
  }
  if (!/^\d{4}$/.test(pin)) {
    loginStatus.textContent = "PIN must be exactly 4 digits.";
    setLoginInputsDisabled(false);
    loginInProgress = false;
    return;
  }

  try {
    await completeLogin({ displayName, pin }, false);
  } catch (error) {
    loginStatus.textContent = `Login failed: ${error.message}`;
    pinInput.focus();
    pinInput.select();
  } finally {
    setLoginInputsDisabled(false);
    loginInProgress = false;
  }
}

async function completeLogin(profile, silent) {
  if (!silent) {
    loginStatus.textContent = "Signing in...";
  }
  await waitForAuth();

  const normalizedDisplayName = normalizeDisplayName(profile.displayName);
  if (!normalizedDisplayName) {
    throw new Error("Display name is invalid.");
  }

  const resolvedDisplayName = await claimDisplayName(
    profile.displayName,
    normalizedDisplayName,
    profile.pin
  );

  localStorage.removeItem(explicitLogoutKey);
  localStorage.setItem(rememberedDisplayNameKey, resolvedDisplayName.trim());

  currentDisplayName = resolvedDisplayName;
  displayNameInput.value = resolvedDisplayName;
  showMainApp();
  startRealtimeListeners();
  loginStatus.textContent = "";
}

async function tryAutoResumeLogin() {
  if (autoResumeAttempted || listenersStarted || currentDisplayName) {
    return;
  }
  if (localStorage.getItem(explicitLogoutKey) === "1") {
    return;
  }

  const rememberedDisplayName = displayNameInput.value.trim();
  if (!rememberedDisplayName) {
    return;
  }

  const normalizedDisplayName = normalizeDisplayName(rememberedDisplayName);
  if (!normalizedDisplayName || !currentUid) {
    return;
  }

  autoResumeAttempted = true;
  loginStatus.textContent = "Restoring your session...";
  let requiresPinRelogin = false;

  try {
    const nameRef = doc(db, "displayNames", normalizedDisplayName);
    const nameSnap = await getDoc(nameRef);
    if (!nameSnap.exists()) {
      return;
    }

    const stored = nameSnap.data();
    if (stored.ownerUid !== currentUid) {
      requiresPinRelogin = true;
      loginStatus.textContent = `Session changed. Enter PIN to continue as ${rememberedDisplayName}.`;
      return;
    }

    const resolvedName = typeof stored.displayName === "string" && stored.displayName.trim()
      ? stored.displayName.trim()
      : rememberedDisplayName;

    currentDisplayName = resolvedName;
    displayNameInput.value = resolvedName;
    localStorage.setItem(rememberedDisplayNameKey, resolvedName);

    showMainApp();
    startRealtimeListeners();
    loginStatus.textContent = "";
  } catch (_error) {
    // Keep manual login available if auto-resume check fails.
  } finally {
    if (!listenersStarted && !requiresPinRelogin) {
      loginStatus.textContent = "";
    }
  }
}

function showMainApp() {
  loginCard.classList.add("hidden");
  mainApp.classList.remove("hidden");
  viewSwitch.classList.remove("hidden");
  logoutBtn.classList.remove("hidden");
  updateLeaderboardLegend();
  setActiveView(activeView);
}

function startRealtimeListeners() {
  if (listenersStarted) {
    return;
  }
  listenersStarted = true;
  hasReceivedProblemsSnapshot = false;
  hasReceivedLeaderboardSnapshot = false;
  appStatus.textContent = "Loading problems from Firebase...";
  renderGrid();
  renderLeaderboard();

  unSubProblems = onSnapshot(
    collection(db, "problems"),
    (snapshot) => {
      hasReceivedProblemsSnapshot = true;
      allProblems = new Map();
      snapshot.forEach((item) => {
        allProblems.set(Number(item.id), item.data());
      });
      appStatus.textContent = "";
      renderGrid();
      refreshPanelMeta();
    },
    handleError
  );

  const currentNameKey = normalizeDisplayName(currentDisplayName);
  if (currentNameKey) {
    unSubMySolveEventsByNameKey = onSnapshot(
      query(collection(db, "solveEvents"), where("solverNameKey", "==", currentNameKey)),
      (snapshot) => {
        const solved = new Set();
        snapshot.forEach((item) => {
          const number = Number(item.data().problemNumber);
          if (Number.isInteger(number) && number > 0) {
            solved.add(number);
          }
        });
        solvedByCurrentUserByNameKey = solved;
        rebuildSolvedByCurrentUser();
        renderGrid();
      },
      handleError
    );
  }

  if (currentDisplayName) {
    unSubMySolveEventsByName = onSnapshot(
      query(collection(db, "solveEvents"), where("solverName", "==", currentDisplayName)),
      (snapshot) => {
        const solved = new Set();
        snapshot.forEach((item) => {
          const number = Number(item.data().problemNumber);
          if (Number.isInteger(number) && number > 0) {
            solved.add(number);
          }
        });
        solvedByCurrentUserByName = solved;
        rebuildSolvedByCurrentUser();
        renderGrid();
      },
      handleError
    );
  }

  unSubLeaderboardSolveEvents = onSnapshot(
    collection(db, "solveEvents"),
    (snapshot) => {
      hasReceivedLeaderboardSnapshot = true;
      leaderboardEvents = [];
      snapshot.forEach((item) => {
        leaderboardEvents.push({ id: item.id, data: item.data() });
      });
      renderLeaderboard();
    },
    handleError
  );
}

function stopRealtimeListeners() {
  if (unSubProblems) {
    unSubProblems();
    unSubProblems = null;
  }
  if (unSubMySolveEventsByNameKey) {
    unSubMySolveEventsByNameKey();
    unSubMySolveEventsByNameKey = null;
  }
  if (unSubMySolveEventsByName) {
    unSubMySolveEventsByName();
    unSubMySolveEventsByName = null;
  }
  if (unSubLeaderboardSolveEvents) {
    unSubLeaderboardSolveEvents();
    unSubLeaderboardSolveEvents = null;
  }
  solvedByCurrentUser = new Set();
  solvedByCurrentUserByNameKey = new Set();
  solvedByCurrentUserByName = new Set();
  leaderboardEvents = [];
  hasReceivedProblemsSnapshot = false;
  hasReceivedLeaderboardSnapshot = false;
  listenersStarted = false;
  renderLeaderboard();
}

function renderGrid() {
  if (!hasReceivedProblemsSnapshot) {
    const counts = {
      all: 0,
      "my-solves": 0,
      solved: 0,
      unsolved: 0,
      assignment: 0,
      "solved in lecture": 0,
    };
    updateFilterButtonCounts(counts);
    updateBranchOptionLabels(0, new Map());
    problemGrid.innerHTML = '<p class="status">Loading problems from Firebase...</p>';
    return;
  }

  const queryTokens = tokenizeSearchQuery(searchInput.value);
  const selectedMinLevel = parseLevelSelectValue(minLevelSelect.value);
  const selectedMaxLevel = parseLevelSelectValue(maxLevelSelect.value);
  const selectedBranch = branchSelect.value;
  const selectedSpecificBranch = selectedBranch && selectedBranch !== "all";
  const [minLevel, maxLevel] = normalizeLevelRange(selectedMinLevel, selectedMaxLevel);
  const tiles = [];
  let allBranchesCount = 0;
  const branchCounts = new Map();
  const counts = {
    all: 0,
    "my-solves": 0,
    solved: 0,
    unsolved: 0,
    assignment: 0,
    "solved in lecture": 0,
  };

  for (let number = 1; number <= maxProblemNumber; number += 1) {
    const data = allProblems.get(number) || DEFAULT_PROBLEM;
    const status = resolveProblemStatus(number, data);
    const difficulty = levelsByProblem.has(number) ? levelsByProblem.get(number) : null;
    const branch = branchesByProblem.get(number) || "";

    if (!matchesSearchQuery(number, queryTokens)) {
      continue;
    }
    if (!isDifficultyInRange(difficulty, minLevel, maxLevel)) {
      continue;
    }

    const matchesCurrentFilter = currentFilter === "my-solves"
      ? solvedByCurrentUser.has(number)
      : (currentFilter === "all" || status === currentFilter);
    if (matchesCurrentFilter) {
      allBranchesCount += 1;
      if (branch) {
        branchCounts.set(branch, (branchCounts.get(branch) || 0) + 1);
      }
    }

    if (selectedBranch !== "all" && branch !== selectedBranch) {
      continue;
    }

    counts.all += 1;
    if (Object.prototype.hasOwnProperty.call(counts, status)) {
      counts[status] += 1;
    }
    if (solvedByCurrentUser.has(number)) {
      counts["my-solves"] += 1;
    }
    if (currentFilter === "my-solves" && !solvedByCurrentUser.has(number)) {
      continue;
    }
    if (currentFilter !== "all" && currentFilter !== "my-solves" && status !== currentFilter) {
      continue;
    }
    tiles.push(tileTemplate(number, data, selectedBranch));
  }

  updateFilterButtonCounts(counts);
  updateBranchOptionLabels(allBranchesCount, branchCounts);

  problemGrid.classList.toggle("problem-grid-compact", !selectedSpecificBranch);

  if (!tiles.length) {
    problemGrid.innerHTML = '<p class="status">No matching problems found.</p>';
    return;
  }

  problemGrid.innerHTML = tiles.join("");
}

function updateBranchOptionLabels(allCount, branchCounts) {
  const normalizedAllCount = Number.isFinite(allCount) ? Math.max(0, Math.floor(allCount)) : 0;
  const allOption = branchSelect.querySelector('option[value="all"]');
  if (allOption instanceof HTMLOptionElement) {
    const allBaseLabel = allOption.dataset.baseLabel || "All branches";
    allOption.textContent = `${allBaseLabel} (${normalizedAllCount})`;
  }

  branchSelect.querySelectorAll("option").forEach((option) => {
    if (!(option instanceof HTMLOptionElement)) {
      return;
    }
    if (option.value === "all") {
      return;
    }

    const baseLabel = option.dataset.baseLabel || option.textContent || "";
    const count = branchCounts.get(option.value) || 0;
    option.textContent = `${baseLabel} (${count})`;
  });
}

function isDifficultyInRange(difficulty, minLevel, maxLevel) {
  if (!levelsByProblem.size) {
    return true;
  }

  const hasNumericLevel = typeof difficulty === "number" && Number.isFinite(difficulty);
  if (!hasNumericLevel) {
    return true;
  }
  if (minLevel === null && maxLevel === null) {
    return true;
  }
  if (minLevel !== null && difficulty < minLevel) {
    return false;
  }
  if (maxLevel !== null && difficulty > maxLevel) {
    return false;
  }
  return true;
}

function updateFilterButtonCounts(counts) {
  filterBar.querySelectorAll(".filter-btn").forEach((btn) => {
    if (!(btn instanceof HTMLButtonElement)) {
      return;
    }
    const filterKey = btn.dataset.filter;
    if (!filterKey) {
      return;
    }

    const existingLabel = btn.dataset.baseLabel || btn.textContent || "";
    const baseLabel = existingLabel.replace(/\s*\(\d+\)\s*$/, "").trim();
    btn.dataset.baseLabel = baseLabel;

    const count = Number.isInteger(counts[filterKey]) ? counts[filterKey] : 0;
    btn.textContent = `${baseLabel} (${count})`;
  });
}

function tileTemplate(number, data, selectedBranch) {
  const difficulty = levelsByProblem.has(number) ? levelsByProblem.get(number) : null;
  const difficultyText = difficulty === null ? "" : String(difficulty);
  const rawTitle = titlesByProblem.get(number) || "";
  const tileTitle = rawTitle ? rawTitle.toLowerCase() : "";
  const solvedCount = Number(data.solvedCount || 0);
  const status = resolveProblemStatus(number, data);
  const statusClass = chipClassName(status);
  const statusText = formatStatus(status, solvedCount);
  const confidence = confidenceByProblem.get(number);
  const confidenceText = formatConfidence(confidence);
  const selectedSpecificBranch = selectedBranch && selectedBranch !== "all";
  const hasLevel = difficultyText.length > 0;
  const topMetaText = hasLevel ? `level ${difficultyText}` : "no level";
  const topMetaClass = hasLevel ? "tile-meta" : "tile-meta tile-meta-level-missing";
  const topMeta = `<span class="${topMetaClass}">${escapeHtml(topMetaText)}</span>`;
  const hasTitleMeta = status === "unsolved";
  const statusMetaText = hasTitleMeta ? (tileTitle || "\u00A0") : statusText;
  const statusMetaClass = hasTitleMeta ? "tile-meta tile-meta-title" : "tile-meta";
  const extraMetaText = selectedSpecificBranch ? `conf ${confidenceText}` : "\u00A0";
  const extraMeta = selectedSpecificBranch
    ? `<span class="tile-meta">${escapeHtml(extraMetaText)}</span>`
    : "";
  return `
    <button type="button" class="tile ${statusClass}" data-role="problem-tile" data-problem="${number}">
      <span class="tile-number">${number}</span>
      ${topMeta}
      <span class="${statusMetaClass}">${escapeHtml(statusMetaText)}</span>
      ${extraMeta}
    </button>
  `;
}

function onFilterClick(event) {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) {
    return;
  }
  const nextFilter = target.dataset.filter;
  if (!nextFilter) {
    return;
  }

  currentFilter = nextFilter;
  filterBar.querySelectorAll(".filter-btn").forEach((btn) => {
    if (btn instanceof HTMLButtonElement) {
      btn.classList.toggle("active", btn.dataset.filter === nextFilter);
    }
  });

  renderGrid();
}

function onGridClick(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  const tile = target.closest('[data-role="problem-tile"]');
  if (!tile) {
    return;
  }
  const number = Number(tile.getAttribute("data-problem"));
  if (!number) {
    return;
  }
  openPanel(number);
}

function openPanel(number) {
  activeProblemNumber = number;
  const data = allProblems.get(number) || DEFAULT_PROBLEM;
  const problemTitle = titlesByProblem.get(number) || "";
  panelTitle.textContent = problemTitle ? `Problem ${number}: ${problemTitle}` : `Problem ${number}`;
  panelProblemLink.href = `https://projecteuler.net/problem=${number}`;
  panelStatusSelect.value = normalizeStatus(data.statusLabel);
  applyPanelPermissions();
  renderPanelMeta(number, data);
  panelBackdrop.classList.remove("hidden");
  problemPanel.classList.remove("hidden");
}

function refreshPanelMeta() {
  if (!activeProblemNumber) {
    return;
  }
  if (problemPanel.classList.contains("hidden")) {
    return;
  }

  const data = allProblems.get(activeProblemNumber) || DEFAULT_PROBLEM;
  panelStatusSelect.value = normalizeStatus(data.statusLabel);
  applyPanelPermissions();
  renderPanelMeta(activeProblemNumber, data);
}

function renderPanelMeta(number, data) {
  const difficulty = levelsByProblem.has(number) ? levelsByProblem.get(number) : null;
  const solvedByPe = solvedByPeByProblem.has(number) ? solvedByPeByProblem.get(number) : null;
  const branch = branchesByProblem.get(number) || "-";
  const confidence = confidenceByProblem.get(number);
  const tags = topicTagsByProblem.get(number) || [];
  if (metaLevel) {
    if (difficulty === null) {
      metaLevel.textContent = "-";
    } else {
      metaLevel.textContent = String(difficulty);
    }
  }
  if (metaBranch) {
    metaBranch.textContent = formatBranchLabel(branch);
  }
  if (metaConfidence) {
    metaConfidence.textContent = formatConfidence(confidence);
  }
  if (metaTags) {
    if (tags.length) {
      metaTags.textContent = tags.map((tag) => formatTagLabel(tag)).join(", ");
    } else {
      metaTags.textContent = "-";
    }
  }
  if (metaSolvedBy) {
    metaSolvedBy.textContent = typeof solvedByPe === "number" && Number.isFinite(solvedByPe)
      ? solvedByPe.toLocaleString("en-US")
      : "-";
  }
  metaSolvedCount.textContent = String(Number(data.solvedCount || 0));
  metaLastSolved.textContent = formatTimestamp(data.lastSolvedAt);
}

function formatTagLabel(tag) {
  if (typeof tag !== "string") {
    return "";
  }
  return tag.trim().replaceAll("_", " ");
}

function formatConfidence(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  const normalized = Math.max(0, Math.min(1, value));
  return normalized.toFixed(2);
}

function formatBranchLabel(rawBranch) {
  if (typeof rawBranch !== "string" || !rawBranch.trim()) {
    return "-";
  }
  const normalized = rawBranch.trim();
  const labels = {
    Algebra: "Algebra",
    Geometry: "Geometry",
    Trigonometry: "Trigonometry",
    Calculus: "Calculus",
    Probability_Statistics: "Probability & Statistics",
    Number_Theory: "Number Theory",
    Discrete_Math: "Discrete Math",
    Linear_Algebra: "Linear Algebra",
    Analytic_Geometry: "Analytic Geometry",
    Mixed_or_Interdisciplinary: "Mixed / Interdisciplinary",
  };
  if (Object.prototype.hasOwnProperty.call(labels, normalized)) {
    return labels[normalized];
  }
  return normalized.replaceAll("_", " ");
}

function closePanel() {
  activeProblemNumber = null;
  panelBackdrop.classList.add("hidden");
  problemPanel.classList.add("hidden");
}

function setActiveView(view) {
  const nextView = view === "leaderboard" ? "leaderboard" : "tracker";
  activeView = nextView;

  if (nextView === "leaderboard") {
    closePanel();
    renderLeaderboard();
  }

  trackerView.classList.toggle("hidden", nextView !== "tracker");
  leaderboardView.classList.toggle("hidden", nextView !== "leaderboard");
  trackerViewBtn.classList.toggle("active", nextView === "tracker");
  leaderboardBtn.classList.toggle("active", nextView === "leaderboard");

  trackerViewBtn.setAttribute("aria-pressed", String(nextView === "tracker"));
  leaderboardBtn.setAttribute("aria-pressed", String(nextView === "leaderboard"));
}

function onLeaderboardSortClick(event) {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) {
    return;
  }
  const nextSort = target.dataset.leaderboardSort;
  if (nextSort !== "solutions" && nextSort !== "score") {
    return;
  }
  leaderboardSort = nextSort;
  updateLeaderboardSortButtons();
  renderLeaderboard();
}

function renderLeaderboard() {
  if (!leaderboardGrid || !leaderboardEmpty) {
    return;
  }

  updateLeaderboardLegend();
  updateLeaderboardSortButtons();

  if (!listenersStarted || !hasReceivedLeaderboardSnapshot) {
    leaderboardGrid.innerHTML = '<p class="status">Loading leaderboard...</p>';
    leaderboardEmpty.classList.add("hidden");
    return;
  }

  const rows = buildLeaderboardRows();
  if (!rows.length) {
    leaderboardGrid.innerHTML = "";
    leaderboardEmpty.classList.remove("hidden");
    return;
  }

  leaderboardEmpty.classList.add("hidden");
  leaderboardGrid.innerHTML = rows.map(leaderboardTileTemplate).join("");
}

function updateLeaderboardSortButtons() {
  if (!leaderboardSortBar) {
    return;
  }
  leaderboardSortBar.querySelectorAll(".filter-btn").forEach((btn) => {
    if (btn instanceof HTMLButtonElement) {
      btn.classList.toggle("active", btn.dataset.leaderboardSort === leaderboardSort);
    }
  });
}

function updateLeaderboardLegend() {
  if (!leaderboardCurrentUserLabel) {
    return;
  }
  leaderboardCurrentUserLabel.textContent = currentDisplayName
    ? currentDisplayName
    : "You";
}

function buildLeaderboardRows() {
  const currentKeys = getCurrentLeaderboardKeys();
  const aggregates = new Map();

  leaderboardEvents.forEach((event) => {
    const data = event.data || {};
    const number = Number(data.problemNumber);
    if (!Number.isInteger(number) || number < 1) {
      return;
    }

    const userKey = getLeaderboardUserKey(data, event.id);
    if (!userKey) {
      return;
    }

    if (!aggregates.has(userKey)) {
      aggregates.set(userKey, {
        userKey,
        isCurrentUser: false,
        problems: new Set(),
      });
    }

    const aggregate = aggregates.get(userKey);
    aggregate.problems.add(number);
    if (currentKeys.has(userKey)) {
      aggregate.isCurrentUser = true;
    }
  });

  const sortedOtherKeys = [...aggregates.values()]
    .filter((entry) => !entry.isCurrentUser)
    .map((entry) => entry.userKey)
    .sort((a, b) => a.localeCompare(b));
  const aliasesByKey = new Map();
  sortedOtherKeys.forEach((userKey, index) => {
    aliasesByKey.set(userKey, `User ${index + 1}`);
  });

  const rows = [...aggregates.values()].map((entry) => {
    const solvedCount = entry.problems.size;
    let score = 0;
    entry.problems.forEach((number) => {
      const difficulty = levelsByProblem.has(number) ? levelsByProblem.get(number) : null;
      if (typeof difficulty === "number" && Number.isFinite(difficulty)) {
        score += difficulty;
      }
    });

    return {
      label: entry.isCurrentUser ? "You" : aliasesByKey.get(entry.userKey),
      isCurrentUser: entry.isCurrentUser,
      solvedCount,
      score,
    };
  });

  rows.sort(compareLeaderboardRows);
  return rows.map((row, index) => ({ ...row, rank: index + 1 }));
}

function getCurrentLeaderboardKeys() {
  const keys = new Set();
  const nameKey = normalizeDisplayName(currentDisplayName);
  if (nameKey) {
    keys.add(`name:${nameKey}`);
  }
  if (currentUid) {
    keys.add(`uid:${currentUid}`);
  }
  return keys;
}

function getLeaderboardUserKey(data, fallbackId) {
  const nameKey = normalizeDisplayName(data.solverNameKey);
  if (nameKey) {
    return `name:${nameKey}`;
  }

  const displayNameKey = normalizeDisplayName(data.solverName);
  if (displayNameKey) {
    return `name:${displayNameKey}`;
  }

  const uid = typeof data.solverUid === "string" ? data.solverUid.trim() : "";
  if (uid) {
    return `uid:${uid}`;
  }

  if (typeof fallbackId === "string" && fallbackId.includes("__")) {
    const [rawNameKey] = fallbackId.split("__");
    let decodedNameKey = rawNameKey;
    try {
      decodedNameKey = decodeURIComponent(rawNameKey);
    } catch (_error) {
      decodedNameKey = rawNameKey;
    }
    const fallbackNameKey = normalizeDisplayName(decodedNameKey);
    if (fallbackNameKey) {
      return `name:${fallbackNameKey}`;
    }
  }

  return "";
}

function compareLeaderboardRows(a, b) {
  if (leaderboardSort === "score") {
    return (
      b.score - a.score
      || b.solvedCount - a.solvedCount
      || a.label.localeCompare(b.label, undefined, { numeric: true })
    );
  }

  return (
    b.solvedCount - a.solvedCount
    || b.score - a.score
    || a.label.localeCompare(b.label, undefined, { numeric: true })
  );
}

function leaderboardTileTemplate(row) {
  const solvedLabel = row.solvedCount === 1 ? "1 solved" : `${row.solvedCount} solved`;
  const tileClass = row.isCurrentUser ? "s-solved" : "s-unsolved";
  return `
    <article class="tile leaderboard-tile ${tileClass}" aria-label="Rank ${row.rank}, ${escapeHtml(row.label)}, ${solvedLabel}, ${row.score} score">
      <span class="tile-number">#${row.rank}</span>
      <span class="tile-meta leaderboard-alias">${escapeHtml(row.label)}</span>
      <span class="tile-meta">${row.score.toLocaleString("en-US")} score</span>
      <span class="tile-meta">${escapeHtml(solvedLabel)}</span>
    </article>
  `;
}

async function onPanelSave() {
  if (!isAdminUser()) {
    showOperationError("Only admin can change status label.");
    return;
  }

  const number = activeProblemNumber;
  if (!number) {
    return;
  }
  const statusLabel = panelStatusSelect.value;
  if (!STATUS_VALUES.includes(statusLabel)) {
    showOperationError("Invalid status label.");
    appStatus.textContent = "Invalid status label.";
    return;
  }

  setPanelBusy(true);
  showOperationLoading(`Updating label for #${number}...`);
  try {
    await updateDoc(doc(db, "problems", String(number)), { statusLabel, difficulty: deleteField() });
    showOperationSuccess(`Status updated for #${number}.`);
    appStatus.textContent = `Status updated for #${number}.`;
  } catch (_error) {
    try {
      await setDoc(
        doc(db, "problems", String(number)),
        {
          ...DEFAULT_PROBLEM,
          statusLabel,
        },
        { merge: true }
      );
      showOperationSuccess(`Status saved for #${number}.`);
      appStatus.textContent = `Status created for #${number}.`;
    } catch (error) {
      showOperationError(`Status update failed for #${number}.`);
      appStatus.textContent = `Status update failed: ${error.message}`;
    }
  } finally {
    setPanelBusy(false);
  }
}

async function onPanelSolve() {
  const number = activeProblemNumber;
  if (!number) {
    return;
  }
  if (solvedByCurrentUser.has(number)) {
    showOperationError("You already marked this problem solved.");
    appStatus.textContent = `Problem #${number} is already marked solved by you.`;
    return;
  }
  if (!canMarkSolveForActiveProblem()) {
    showOperationError("Only unsolved or solved problems can be marked solved.");
    appStatus.textContent = `Problem #${number} cannot be marked solved from its current status.`;
    return;
  }

  setPanelBusy(true);
  showOperationLoading(`Saving solve for #${number}...`);
  try {
    appStatus.textContent = `Saving solve for #${number}...`;
    const solverNameKey = normalizeDisplayName(currentDisplayName);
    if (!solverNameKey) {
      throw new Error("Display name is invalid.");
    }
    const eventId = buildSolveEventId(number, solverNameKey);
    const eventRef = doc(db, "solveEvents", eventId);

    await runTransaction(db, async (tx) => {
      const problemRef = doc(db, "problems", String(number));
      const existingSolveRef = await tx.get(eventRef);
      if (existingSolveRef.exists()) {
        throw new Error("You already marked this problem solved.");
      }
      const snap = await tx.get(problemRef);
      const current = snap.exists() ? snap.data() : DEFAULT_PROBLEM;
      const nextCount = Number(current.solvedCount || 0) + 1;

      tx.set(
        problemRef,
        {
          solvedCount: nextCount,
          statusLabel: "solved",
          lastSolvedAt: serverTimestamp(),
          difficulty: deleteField(),
        },
        { merge: true }
      );
      tx.set(eventRef, {
        problemNumber: number,
        solvedAt: serverTimestamp(),
        solverUid: currentUid,
        solverName: currentDisplayName,
        solverNameKey,
      });
    });

    markProblemSolvedByCurrentUser(number);
    applyPanelPermissions();
    renderGrid();

    showOperationSuccess(`Solved count updated for #${number}.`);
    appStatus.textContent = `Problem #${number} marked solved.`;
  } catch (error) {
    showOperationError(`Solve failed for #${number}.`);
    appStatus.textContent = `Solve failed: ${error.message}`;
  } finally {
    setPanelBusy(false);
  }
}

async function onPanelDeleteSolve() {
  const number = activeProblemNumber;
  if (!number) {
    return;
  }

  setPanelBusy(true);
  showOperationLoading(`Deleting one solve for #${number}...`);
  try {
    const currentNameKey = normalizeDisplayName(currentDisplayName);
    const ownEventsByNameKeyQuery = query(
      collection(db, "solveEvents"),
      where("solverNameKey", "==", currentNameKey)
    );
    const ownEventsByNameQuery = query(
      collection(db, "solveEvents"),
      where("solverName", "==", currentDisplayName)
    );

    const ownByNameKeySnapshot = await getDocs(ownEventsByNameKeyQuery);
    const ownByNameSnapshot = await getDocs(ownEventsByNameQuery);
    const ownDocsById = new Map();
    ownByNameKeySnapshot.docs.forEach((item) => {
      ownDocsById.set(item.id, item);
    });
    ownByNameSnapshot.docs.forEach((item) => {
      ownDocsById.set(item.id, item);
    });

    const ownDocs = [...ownDocsById.values()]
      .filter((item) => Number(item.data().problemNumber) === number)
      .sort((a, b) => {
        const aTs = toMillis(a.data().solvedAt);
        const bTs = toMillis(b.data().solvedAt);
        return bTs - aTs;
      });

    if (!ownDocs.length) {
      const allEventsQuery = query(
        collection(db, "solveEvents"),
        where("problemNumber", "==", number)
      );
      const allEventsSnapshot = await getDocs(allEventsQuery);
      const hasLegacyEvents = allEventsSnapshot.docs.some(
        (item) => typeof item.data().solverUid !== "string" || !item.data().solverUid
      );

      if (hasLegacyEvents) {
        showOperationError("This problem only has legacy solves without owner info.");
        appStatus.textContent = `Legacy solves on #${number} cannot be deleted per-user.`;
      } else {
        showOperationError("You have no solve to remove for this problem.");
        appStatus.textContent = `No personal solve found for #${number}.`;
      }
      return;
    }

    await deleteDoc(ownDocs[0].ref);

    if (ownDocs.length === 1) {
      unmarkProblemSolvedByCurrentUser(number);
      applyPanelPermissions();
      renderGrid();
    }

    const allEventsQuery = query(
      collection(db, "solveEvents"),
      where("problemNumber", "==", number)
    );
    const allEventsSnapshot = await getDocs(allEventsQuery);
    const allDocs = [...allEventsSnapshot.docs].sort((a, b) => {
      const aTs = toMillis(a.data().solvedAt);
      const bTs = toMillis(b.data().solvedAt);
      return bTs - aTs;
    });
    const latestSolvedAt = allDocs.length > 0 ? allDocs[0].data().solvedAt : null;

    await runTransaction(db, async (tx) => {
      const ref = doc(db, "problems", String(number));
      const snap = await tx.get(ref);
      const current = snap.exists() ? snap.data() : DEFAULT_PROBLEM;
      const currentCount = Number(current.solvedCount || 0);
      const nextCount = Math.max(0, currentCount - 1);
      const currentStatus = normalizeStatus(current.statusLabel);

      let nextStatus = currentStatus;
      if (nextCount === 0 && currentStatus === "solved") {
        nextStatus = "unsolved";
      }
      if (
        nextCount > 0
        && currentStatus === "unsolved"
      ) {
        nextStatus = "solved";
      }

      tx.set(
        ref,
        {
          solvedCount: nextCount,
          statusLabel: nextStatus,
          lastSolvedAt: nextCount === 0 ? null : (latestSolvedAt || null),
          difficulty: deleteField(),
        },
        { merge: true }
      );
    });

    showOperationSuccess(`Removed one solve from #${number}.`);
    appStatus.textContent = `Removed one solve from #${number}.`;
  } catch (error) {
    showOperationError(`Delete solve failed for #${number}.`);
    appStatus.textContent = `Delete solve failed: ${error.message}`;
  } finally {
    setPanelBusy(false);
  }
}

function toMillis(value) {
  if (!value) {
    return 0;
  }
  if (typeof value.toMillis === "function") {
    return value.toMillis();
  }
  const date = value.toDate ? value.toDate() : new Date(value);
  const ms = date.getTime();
  return Number.isFinite(ms) ? ms : 0;
}

async function seedProblems() {
  try {
    appStatus.textContent = "Checking existing problems...";
    const snapshot = await getDocs(collection(db, "problems"));
    const existing = new Set(snapshot.docs.map((d) => Number(d.id)));

    let created = 0;
    let batch = writeBatch(db);
    let opCount = 0;

    for (let number = 1; number <= maxProblemNumber; number += 1) {
      if (existing.has(number)) {
        continue;
      }

      const ref = doc(db, "problems", String(number));
      batch.set(ref, { ...DEFAULT_PROBLEM });
      created += 1;
      opCount += 1;

      if (opCount === 450) {
        await batch.commit();
        batch = writeBatch(db);
        opCount = 0;
      }
    }

    if (opCount > 0) {
      await batch.commit();
    }

    appStatus.textContent = `Seed complete. Created ${created} missing problems.`;
  } catch (error) {
    appStatus.textContent = `Seed failed: ${error.message}`;
  }
}

async function onLogout() {
  try {
    localStorage.setItem(explicitLogoutKey, "1");
    localStorage.removeItem(rememberedDisplayNameKey);
    await signOut(auth);
    currentUid = null;
    currentDisplayName = "";
    stopRealtimeListeners();
    closePanel();
    activeView = "tracker";
    setActiveView(activeView);
    opFeedback.classList.add("hidden");
    mainApp.classList.add("hidden");
    loginCard.classList.remove("hidden");
    viewSwitch.classList.add("hidden");
    logoutBtn.classList.add("hidden");
    displayNameInput.value = "";
    pinInput.value = "";
    loginStatus.textContent = "Signed out.";
    appStatus.textContent = "";
  } catch (error) {
    appStatus.textContent = `Sign out failed: ${error.message}`;
  }
}

function chipClassName(status) {
  if (status === "assignment") {
    return "s-assignment";
  }
  if (status === "solved in lecture") {
    return "s-lecture";
  }
  if (status === "not eligible for final") {
    return "s-not-eligible";
  }
  if (status === "solved") {
    return "s-solved";
  }
  return "s-unsolved";
}

function normalizeStatus(status) {
  if (typeof status === "string") {
    const normalized = status.trim().toLowerCase();
    if (normalized === "not eligable for final" || normalized === "not eligible for final") {
      return "unsolved";
    }
  }
  if (status === "solved by xx person") {
    return "solved";
  }
  if (typeof status === "string" && status.trim().toLowerCase() === "class") {
    return "solved in lecture";
  }
  if (STATUS_VALUES.includes(status)) {
    return status;
  }
  return "unsolved";
}

function formatStatus(status, solvedCount) {
  if (status === "solved") {
    return `solved x${Math.max(1, solvedCount)}`;
  }
  if (status === "solved in lecture") {
    return "class";
  }
  return status;
}

function defaultStatusForProblem(number) {
  const difficulty = levelsByProblem.has(number) ? levelsByProblem.get(number) : null;
  return difficulty === 0 ? "not eligible for final" : "unsolved";
}

function resolveProblemStatus(number, data) {
  const normalizedStatus = normalizeStatus(data.statusLabel);
  if (normalizedStatus !== "unsolved") {
    return normalizedStatus;
  }
  return defaultStatusForProblem(number);
}

function formatTimestamp(value) {
  if (!value) {
    return "-";
  }
  const date = value.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleString();
}

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function waitForAuth() {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (authReady && currentUid) {
        window.clearInterval(timer);
        resolve();
        return;
      }

      if (Date.now() - started > 8000) {
        window.clearInterval(timer);
        reject(new Error("Anonymous auth timeout."));
      }
    }, 50);
  });
}

function setPanelBusy(busy) {
  panelSaveBtn.disabled = busy || !isAdminUser();
  panelSolveBtn.disabled = busy || !canMarkSolveForActiveProblem();
  panelDeleteBtn.disabled = busy || !canDeleteOwnSolveForActiveProblem();
  panelCloseBtn.disabled = busy;
  panelStatusSelect.disabled = busy || !isAdminUser();
}

function applyPanelPermissions() {
  const admin = isAdminUser();
  const canMarkSolve = canMarkSolveForActiveProblem();
  const canDeleteSolve = canDeleteOwnSolveForActiveProblem();
  statusEditor.classList.toggle("hidden", !admin);
  panelSaveBtn.classList.toggle("hidden", !admin);
  panelSolveBtn.classList.toggle("hidden", !canMarkSolve);
  panelDeleteBtn.classList.toggle("hidden", !canDeleteSolve);
  panelSaveBtn.disabled = !admin;
  panelSolveBtn.disabled = !canMarkSolve;
  panelDeleteBtn.disabled = !canDeleteSolve;
}

function canMarkSolveForActiveProblem() {
  if (!activeProblemNumber) {
    return false;
  }
  const data = allProblems.get(activeProblemNumber) || DEFAULT_PROBLEM;
  const status = resolveProblemStatus(activeProblemNumber, data);
  return MARK_SOLVABLE_STATUSES.has(status) && !solvedByCurrentUser.has(activeProblemNumber);
}

function buildSolveEventId(problemNumber, solverNameKey) {
  return `${encodeURIComponent(solverNameKey)}__${problemNumber}`;
}

function canDeleteOwnSolveForActiveProblem() {
  return Boolean(
    currentUid &&
    activeProblemNumber &&
    solvedByCurrentUser.has(activeProblemNumber)
  );
}

function rebuildSolvedByCurrentUser() {
  const merged = new Set();
  solvedByCurrentUserByNameKey.forEach((number) => {
    merged.add(number);
  });
  solvedByCurrentUserByName.forEach((number) => {
    merged.add(number);
  });
  solvedByCurrentUser = merged;
}

function markProblemSolvedByCurrentUser(number) {
  if (!Number.isInteger(number) || number < 1) {
    return;
  }
  const nameKey = normalizeDisplayName(currentDisplayName);
  if (nameKey) {
    solvedByCurrentUserByNameKey.add(number);
  }
  if (currentDisplayName) {
    solvedByCurrentUserByName.add(number);
  }
  rebuildSolvedByCurrentUser();
}

function unmarkProblemSolvedByCurrentUser(number) {
  if (!Number.isInteger(number) || number < 1) {
    return;
  }
  solvedByCurrentUserByNameKey.delete(number);
  solvedByCurrentUserByName.delete(number);
  rebuildSolvedByCurrentUser();
}

function isAdminUser() {
  return currentDisplayName.trim().toLowerCase() === "admin";
}

function showOperationLoading(message) {
  clearTimeout(opHideTimer);
  clearInterval(opProgressTimer);
  opFeedback.classList.remove("hidden", "success", "error");
  opMessage.textContent = message;
  opProgressBar.style.width = "14%";
  let progress = 14;
  opProgressTimer = window.setInterval(() => {
    progress = Math.min(progress + Math.random() * 12, 86);
    opProgressBar.style.width = `${progress}%`;
  }, 180);
}

function showOperationSuccess(message) {
  clearInterval(opProgressTimer);
  opFeedback.classList.remove("error");
  opFeedback.classList.add("success");
  opMessage.textContent = message;
  opProgressBar.style.width = "100%";
  opHideTimer = window.setTimeout(() => {
    opFeedback.classList.add("hidden");
  }, 1800);
}

function showOperationError(message) {
  clearInterval(opProgressTimer);
  opFeedback.classList.remove("success");
  opFeedback.classList.add("error");
  opFeedback.classList.remove("hidden");
  opMessage.textContent = message;
  opProgressBar.style.width = "100%";
}

function handleError(error) {
  appStatus.textContent = `Realtime error: ${error.message}`;
}

async function claimDisplayName(displayName, normalizedDisplayName, pin) {
  const pinHashLegacy = await hashPinLegacy(pin);
  const nextPinSalt = generatePinSalt();
  const nextPinHash = await hashPin(pin, normalizedDisplayName, nextPinSalt);
  let resolvedDisplayName = displayName;

  await runTransaction(db, async (tx) => {
    const nameRef = doc(db, "displayNames", normalizedDisplayName);
    const nameSnap = await tx.get(nameRef);
    const existingCreatedAt = nameSnap.exists() ? nameSnap.data().createdAt : null;

    if (nameSnap.exists()) {
      const ownerUid = nameSnap.data().ownerUid;
      const storedPinHash = String(nameSnap.data().pinHash || "");
      const storedPinSalt = String(nameSnap.data().pinSalt || "");
      const legacyPin = String(nameSnap.data().pin || "");
      const storedDisplayName = String(nameSnap.data().displayName || "").trim();
      if (storedDisplayName) {
        resolvedDisplayName = storedDisplayName;
      }

      let pinMatches = false;
      if (storedPinHash) {
        if (storedPinSalt) {
          const computedHash = await hashPin(pin, normalizedDisplayName, storedPinSalt);
          pinMatches = computedHash ? computedHash === storedPinHash : storedPinHash === pinHashLegacy;
        } else {
          pinMatches = storedPinHash === pinHashLegacy;
        }
      } else {
        pinMatches = legacyPin === pin;
      }

      if (ownerUid !== currentUid && !pinMatches) {
        throw new Error("Display name is already in use or PIN is incorrect.");
      }
    }

    tx.set(
      nameRef,
      {
        ownerUid: currentUid,
        displayName: resolvedDisplayName,
        pinHash: nextPinHash,
        pinSalt: nextPinSalt,
        pin: deleteField(),
        updatedAt: serverTimestamp(),
        createdAt: existingCreatedAt || serverTimestamp(),
      },
      { merge: true }
    );
  });

  return resolvedDisplayName;
}

function bytesToHex(bytes) {
  let hex = "";
  bytes.forEach((value) => {
    hex += value.toString(16).padStart(2, "0");
  });
  return hex;
}

function hexToBytes(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{32}$/i.test(value)) {
    return null;
  }
  const out = new Uint8Array(value.length / 2);
  for (let i = 0; i < value.length; i += 2) {
    out[i / 2] = Number.parseInt(value.slice(i, i + 2), 16);
  }
  return out;
}

function generatePinSalt() {
  const bytes = new Uint8Array(PIN_SALT_BYTES);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

async function hashPinLegacy(pin) {
  const encoded = new TextEncoder().encode(String(pin));
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  const bytes = new Uint8Array(digest);
  return bytesToHex(bytes);
}

async function hashPin(pin, normalizedDisplayName, pinSaltHex) {
  const salt = hexToBytes(pinSaltHex);
  if (!salt) {
    return "";
  }

  const password = `${normalizedDisplayName}:${String(pin)}`;
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations: PIN_HASH_ITERATIONS,
    },
    keyMaterial,
    256
  );

  return bytesToHex(new Uint8Array(bits));
}

function normalizeDisplayName(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}
