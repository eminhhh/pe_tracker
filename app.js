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
  getCountFromServer,
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

const DEFAULT_PROBLEM = {
  statusLabel: "unsolved",
  solvedCount: 0,
  lastSolvedAt: null,
};

const DEFAULT_MAX_PROBLEM_NUMBER = 985;
const DEFAULT_MIN_LEVEL = 0;
const DEFAULT_MAX_LEVEL = 38;

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

const loginCard = document.getElementById("loginCard");
const loginForm = document.getElementById("loginForm");
const loginStatus = document.getElementById("loginStatus");
const displayNameInput = document.getElementById("displayName");
const pinInput = document.getElementById("pin");
const themeToggleBtn = document.getElementById("themeToggleBtn");

const mainApp = document.getElementById("mainApp");
const appStatus = document.getElementById("appStatus");
const searchInput = document.getElementById("searchInput");
const minLevelSelect = document.getElementById("minLevelSelect");
const maxLevelSelect = document.getElementById("maxLevelSelect");
const branchSelect = document.getElementById("branchSelect");
const filterBar = document.getElementById("filterBar");
const problemGrid = document.getElementById("problemGrid");
const logoutBtn = document.getElementById("logoutBtn");
const registeredUsersLabel = document.getElementById("registeredUsersLabel");

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
let branchesByProblem = new Map();
let confidenceByProblem = new Map();
let topicTagsByProblem = new Map();
let currentFilter = "all";
let activeProblemNumber = null;
let listenersStarted = false;
let unSubProblems = null;
let unSubMySolveEventsByNameKey = null;
let unSubMySolveEventsByName = null;
let opProgressTimer = null;
let opHideTimer = null;
let maxProblemNumber = DEFAULT_MAX_PROBLEM_NUMBER;
let solvedByCurrentUser = new Set();
let solvedByCurrentUserByNameKey = new Set();
let solvedByCurrentUserByName = new Set();
let autoResumeAttempted = false;

boot();

function boot() {
  setPersistence(auth, browserLocalPersistence).catch((error) => {
    loginStatus.textContent = `Auth persistence warning: ${error.message}`;
  });

  onAuthStateChanged(auth, async (user) => {
    if (user) {
      currentUid = user.uid;
      authReady = true;
      loadRegisteredUsersCount();
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
  themeToggleBtn.addEventListener("click", onThemeToggle);
  restoreThemePreference();
  requestAnimationFrame(() => {
    document.documentElement.classList.add("theme-ready");
  });
  searchInput.addEventListener("input", renderGrid);
  pinInput.addEventListener("input", onPinInput);
  minLevelSelect.addEventListener("change", onLevelRangeChange);
  maxLevelSelect.addEventListener("change", onLevelRangeChange);
  branchSelect.addEventListener("change", renderGrid);
  searchInput.max = String(maxProblemNumber);
  populateLevelFilterOptions(buildInclusiveRange(DEFAULT_MIN_LEVEL, DEFAULT_MAX_LEVEL));
  populateBranchFilterOptions([]);
  filterBar.addEventListener("click", onFilterClick);
  problemGrid.addEventListener("click", onGridClick);
  panelSaveBtn.addEventListener("click", onPanelSave);
  panelSolveBtn.addEventListener("click", onPanelSolve);
  panelDeleteBtn.addEventListener("click", onPanelDeleteSolve);
  panelCloseBtn.addEventListener("click", closePanel);
  panelBackdrop.addEventListener("click", closePanel);
  logoutBtn.addEventListener("click", onLogout);

  loadLevelsData();
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

async function loadRegisteredUsersCount() {
  if (!registeredUsersLabel) {
    return;
  }

  try {
    const snapshot = await getCountFromServer(collection(db, "displayNames"));
    const count = snapshot.data().count;
    if (!Number.isFinite(count)) {
      return;
    }
    const normalizedCount = Math.max(0, Math.floor(count));
    const noun = normalizedCount === 1 ? "user" : "users";
    registeredUsersLabel.textContent = `${normalizedCount.toLocaleString("en-US")} ${noun} registered`;
  } catch (_error) {
    // Keep default label when count is unavailable.
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
    let inferredMaxProblem = 0;
    const meta = raw._meta;

    Object.entries(raw).forEach(([key, value]) => {
      const number = Number(key);
      if (!number || typeof value !== "object" || value === null) {
        return;
      }

      inferredMaxProblem = Math.max(inferredMaxProblem, number);
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
    if (Number.isInteger(metaMaxProblem) && metaMaxProblem > 0) {
      maxProblemNumber = metaMaxProblem;
    } else if (inferredMaxProblem > 0) {
      maxProblemNumber = inferredMaxProblem;
    }

    searchInput.max = String(maxProblemNumber);
    levelsByProblem = levelMap;
    titlesByProblem = titleMap;
    solvedByPeByProblem = solvedByMap;
    populateLevelFilterOptions(getAvailableLevels(levelsByProblem));
    renderGrid();
    refreshPanelMeta();
  } catch (_error) {
    // Keep default level fallback when file is unavailable.
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
  branchSelect.insertAdjacentHTML("beforeend", '<option value="all">All branches</option>');

  allBranches.forEach((branch) => {
    const value = escapeHtml(branch);
    const label = escapeHtml(formatBranchLabel(branch));
    branchSelect.insertAdjacentHTML("beforeend", `<option value="${value}">${label}</option>`);
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

function onPinInput() {
  const digitsOnly = pinInput.value.replace(/\D/g, "").slice(0, 4);
  if (pinInput.value !== digitsOnly) {
    pinInput.value = digitsOnly;
  }
}

async function onLoginSubmit(event) {
  event.preventDefault();

  const displayName = displayNameInput.value.trim();
  const pin = pinInput.value.trim();

  if (!displayName) {
    loginStatus.textContent = "Display name is required.";
    return;
  }
  if (!/^\d{4}$/.test(pin)) {
    loginStatus.textContent = "PIN must be exactly 4 digits.";
    return;
  }

  try {
    await completeLogin({ displayName, pin }, false);
  } catch (error) {
    loginStatus.textContent = `Login failed: ${error.message}`;
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

  await claimDisplayName(profile.displayName, normalizedDisplayName, profile.pin);

  localStorage.removeItem(explicitLogoutKey);
  localStorage.setItem(rememberedDisplayNameKey, profile.displayName.trim());

  currentDisplayName = profile.displayName;
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

  try {
    const nameRef = doc(db, "displayNames", normalizedDisplayName);
    const nameSnap = await getDoc(nameRef);
    if (!nameSnap.exists()) {
      return;
    }

    const stored = nameSnap.data();
    if (stored.ownerUid !== currentUid) {
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
    if (!listenersStarted) {
      loginStatus.textContent = "";
    }
  }
}

function showMainApp() {
  loginCard.classList.add("hidden");
  mainApp.classList.remove("hidden");
  logoutBtn.classList.remove("hidden");
}

function startRealtimeListeners() {
  if (listenersStarted) {
    return;
  }
  listenersStarted = true;

  unSubProblems = onSnapshot(
    collection(db, "problems"),
    (snapshot) => {
      allProblems = new Map();
      snapshot.forEach((item) => {
        allProblems.set(Number(item.id), item.data());
      });
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
  solvedByCurrentUser = new Set();
  solvedByCurrentUserByNameKey = new Set();
  solvedByCurrentUserByName = new Set();
  listenersStarted = false;
}

function renderGrid() {
  const searchText = searchInput.value.trim();
  const selectedMinLevel = parseLevelSelectValue(minLevelSelect.value);
  const selectedMaxLevel = parseLevelSelectValue(maxLevelSelect.value);
  const selectedBranch = branchSelect.value;
  const selectedSpecificBranch = selectedBranch && selectedBranch !== "all";
  const [minLevel, maxLevel] = normalizeLevelRange(selectedMinLevel, selectedMaxLevel);
  const tiles = [];
  let allBranchesCount = 0;
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
    const status = normalizeStatus(data.statusLabel);
    const difficulty = levelsByProblem.has(number) ? levelsByProblem.get(number) : null;
    const branch = branchesByProblem.get(number) || "";

    if (searchText && !String(number).includes(searchText)) {
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
  updateAllBranchesOptionLabel(allBranchesCount);

  problemGrid.classList.toggle("problem-grid-compact", !selectedSpecificBranch);

  if (!tiles.length) {
    problemGrid.innerHTML = '<p class="status">No matching problems found.</p>';
    return;
  }

  problemGrid.innerHTML = tiles.join("");
}

function updateAllBranchesOptionLabel(count) {
  const allOption = branchSelect.querySelector('option[value="all"]');
  if (!(allOption instanceof HTMLOptionElement)) {
    return;
  }
  const normalized = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  allOption.textContent = `All branches (${normalized})`;
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
  const solvedCount = Number(data.solvedCount || 0);
  const status = normalizeStatus(data.statusLabel);
  const statusClass = chipClassName(status);
  const statusText = formatStatus(status, solvedCount);
  const confidence = confidenceByProblem.get(number);
  const confidenceText = formatConfidence(confidence);
  const selectedSpecificBranch = selectedBranch && selectedBranch !== "all";
  const topMetaText = difficultyText ? `level ${difficultyText}` : "\u00A0";
  const topMeta = `<span class="tile-meta">${escapeHtml(topMetaText)}</span>`;
  const hasTitleMeta = status === "unsolved";
  const statusMetaText = hasTitleMeta ? (rawTitle || "\u00A0") : statusText;
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
    metaLevel.textContent = difficulty === null ? "" : String(difficulty);
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

  setPanelBusy(true);
  showOperationLoading(`Saving solve for #${number}...`);
  try {
    appStatus.textContent = `Saving solve for #${number}...`;
    const solverNameKey = normalizeDisplayName(currentDisplayName);
    if (!solverNameKey) {
      throw new Error("Display name is invalid.");
    }
    const eventRef = doc(collection(db, "solveEvents"));

    await runTransaction(db, async (tx) => {
      const problemRef = doc(db, "problems", String(number));
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
      if (nextCount > 0 && currentStatus === "unsolved") {
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
    await signOut(auth);
    currentUid = null;
    currentDisplayName = "";
    stopRealtimeListeners();
    closePanel();
    opFeedback.classList.add("hidden");
    mainApp.classList.add("hidden");
    loginCard.classList.remove("hidden");
    logoutBtn.classList.add("hidden");
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
  if (status === "solved") {
    return "s-solved";
  }
  return "s-unsolved";
}

function normalizeStatus(status) {
  if (status === "solved by xx person") {
    return "solved";
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
  panelSolveBtn.disabled = busy;
  panelDeleteBtn.disabled = busy || !canDeleteOwnSolveForActiveProblem();
  panelCloseBtn.disabled = busy;
  panelStatusSelect.disabled = busy || !isAdminUser();
}

function applyPanelPermissions() {
  const admin = isAdminUser();
  statusEditor.classList.toggle("hidden", !admin);
  panelSaveBtn.classList.toggle("hidden", !admin);
  panelSaveBtn.disabled = !admin;
  panelDeleteBtn.disabled = !canDeleteOwnSolveForActiveProblem();
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
  const pinHash = await hashPin(pin);

  await runTransaction(db, async (tx) => {
    const nameRef = doc(db, "displayNames", normalizedDisplayName);
    const nameSnap = await tx.get(nameRef);

    if (nameSnap.exists()) {
      const ownerUid = nameSnap.data().ownerUid;
      const storedPinHash = String(nameSnap.data().pinHash || "");
      const legacyPin = String(nameSnap.data().pin || "");
      const pinMatches = storedPinHash ? storedPinHash === pinHash : legacyPin === pin;
      if (ownerUid !== currentUid && !pinMatches) {
        throw new Error("Display name is already in use or PIN is incorrect.");
      }
    }

    tx.set(
      nameRef,
      {
        ownerUid: currentUid,
        displayName,
        pinHash,
        pin: deleteField(),
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      },
      { merge: true }
    );
  });
}

async function hashPin(pin) {
  const encoded = new TextEncoder().encode(String(pin));
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  const bytes = new Uint8Array(digest);
  let hex = "";
  bytes.forEach((value) => {
    hex += value.toString(16).padStart(2, "0");
  });
  return hex;
}

function normalizeDisplayName(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}
