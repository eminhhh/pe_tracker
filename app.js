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
  addDoc,
  collection,
  deleteField,
  deleteDoc,
  doc,
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

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

const loginCard = document.getElementById("loginCard");
const loginForm = document.getElementById("loginForm");
const loginStatus = document.getElementById("loginStatus");
const displayNameInput = document.getElementById("displayName");
const pinInput = document.getElementById("pin");

const mainApp = document.getElementById("mainApp");
const appStatus = document.getElementById("appStatus");
const databaseUpdatedLabel = document.getElementById("databaseUpdatedLabel");
const searchInput = document.getElementById("searchInput");
const filterBar = document.getElementById("filterBar");
const problemGrid = document.getElementById("problemGrid");
const logoutBtn = document.getElementById("logoutBtn");

const panelBackdrop = document.getElementById("panelBackdrop");
const problemPanel = document.getElementById("problemPanel");
const panelTitle = document.getElementById("panelTitle");
const panelProblemLink = document.getElementById("panelProblemLink");
const metaLevel = document.getElementById("metaLevel");
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

const profileKey = "pe_tracker_profile";
const profileCookieName = "pe_tracker_profile";

let authReady = false;
let currentUid = null;
let currentDisplayName = "";
let allProblems = new Map();
let levelsByProblem = new Map();
let currentFilter = "all";
let activeProblemNumber = null;
let listenersStarted = false;
let unSubProblems = null;
let unSubMySolveEventsByNameKey = null;
let unSubMySolveEventsByName = null;
let pendingProfile = null;
let opProgressTimer = null;
let opHideTimer = null;
let maxProblemNumber = DEFAULT_MAX_PROBLEM_NUMBER;
let autoLoginInProgress = false;
let solvedByCurrentUser = new Set();
let solvedByCurrentUserByNameKey = new Set();
let solvedByCurrentUserByName = new Set();

boot();

function boot() {
  setPersistence(auth, browserLocalPersistence).catch((error) => {
    loginStatus.textContent = `Auth persistence warning: ${error.message}`;
  });

  onAuthStateChanged(auth, async (user) => {
    if (user) {
      currentUid = user.uid;
      authReady = true;
      await tryAutoLogin();
      return;
    }

    try {
      await signInAnonymously(auth);
    } catch (error) {
      loginStatus.textContent = `Auth error: ${error.message}`;
    }
  });

  const cookieProfile = readProfileCookie();
  const saved = cookieProfile || localStorage.getItem(profileKey);
  if (saved) {
    try {
      const parsed = typeof saved === "string" ? JSON.parse(saved) : saved;
      if (isValidProfile(parsed)) {
        displayNameInput.value = parsed.displayName;
        pinInput.value = parsed.pin;
        pendingProfile = parsed;
        void tryAutoLogin();
      }
    } catch (_e) {
      localStorage.removeItem(profileKey);
      clearProfileCookie();
    }
  }

  loginForm.addEventListener("submit", onLoginSubmit);
  searchInput.addEventListener("input", renderGrid);
  searchInput.max = String(maxProblemNumber);
  filterBar.addEventListener("click", onFilterClick);
  problemGrid.addEventListener("click", onGridClick);
  panelSaveBtn.addEventListener("click", onPanelSave);
  panelSolveBtn.addEventListener("click", onPanelSolve);
  panelDeleteBtn.addEventListener("click", onPanelDeleteSolve);
  panelCloseBtn.addEventListener("click", closePanel);
  panelBackdrop.addEventListener("click", closePanel);
  logoutBtn.addEventListener("click", onLogout);

  loadLevelsData();
}

async function tryAutoLogin() {
  if (
    autoLoginInProgress ||
    !pendingProfile ||
    !authReady ||
    !currentUid ||
    !mainApp.classList.contains("hidden")
  ) {
    return;
  }

  autoLoginInProgress = true;
  try {
    await completeLogin(pendingProfile, true);
  } catch (error) {
    loginStatus.textContent = `Auto-login failed: ${error.message}`;
    pendingProfile = null;
    clearProfileCookie();
    localStorage.removeItem(profileKey);
  } finally {
    autoLoginInProgress = false;
  }
}

async function loadLevelsData() {
  try {
    const response = await fetch("data/levels.json", { cache: "no-store" });
    if (!response.ok) {
      return;
    }
    const raw = await response.json();
    const map = new Map();
    let inferredMaxProblem = 0;
    const meta = raw._meta;
    if (meta && typeof meta === "object" && typeof meta.last_updated_utc === "string") {
      databaseUpdatedLabel.textContent = `Database last updated at ${formatUtcLabel(meta.last_updated_utc)} UTC`;
    }

    Object.entries(raw).forEach(([key, value]) => {
      const number = Number(key);
      if (!number || typeof value !== "object" || value === null) {
        return;
      }

      inferredMaxProblem = Math.max(inferredMaxProblem, number);
      const rawDifficulty = value.difficulty;
      if (rawDifficulty === null || rawDifficulty === undefined || rawDifficulty === "") {
        map.set(number, null);
        return;
      }

      const parsedDifficulty = Number(rawDifficulty);
      map.set(number, Number.isFinite(parsedDifficulty) ? parsedDifficulty : null);
    });

    const metaMaxProblem = Number(meta?.max_problem_number);
    if (Number.isInteger(metaMaxProblem) && metaMaxProblem > 0) {
      maxProblemNumber = metaMaxProblem;
    } else if (inferredMaxProblem > 0) {
      maxProblemNumber = inferredMaxProblem;
    }

    searchInput.max = String(maxProblemNumber);
    levelsByProblem = map;
    renderGrid();
    refreshPanelMeta();
  } catch (_error) {
    // Keep default level fallback when file is unavailable.
  }
}

function formatUtcLabel(value) {
  if (typeof value !== "string") {
    return "-";
  }
  const normalized = value.trim().replace("T", " ").replace(/Z$/i, "");
  return normalized || "-";
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
    pendingProfile = { displayName, pin };
    await completeLogin(pendingProfile, false);
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

  localStorage.setItem(profileKey, JSON.stringify(profile));
  writeProfileCookie(profile);

  currentDisplayName = profile.displayName;
  showMainApp();
  startRealtimeListeners();
  pendingProfile = null;
  loginStatus.textContent = "";
}

function showMainApp() {
  loginCard.classList.add("hidden");
  mainApp.classList.remove("hidden");
  databaseUpdatedLabel.classList.remove("hidden");
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
  const tiles = [];

  for (let number = 1; number <= maxProblemNumber; number += 1) {
    const data = allProblems.get(number) || DEFAULT_PROBLEM;
    const status = normalizeStatus(data.statusLabel);

    if (searchText && !String(number).includes(searchText)) {
      continue;
    }
    if (currentFilter === "my-solves" && !solvedByCurrentUser.has(number)) {
      continue;
    }
    if (currentFilter !== "all" && currentFilter !== "my-solves" && status !== currentFilter) {
      continue;
    }

    tiles.push(tileTemplate(number, data));
  }

  if (!tiles.length) {
    problemGrid.innerHTML = '<p class="status">No matching problems found.</p>';
    return;
  }

  problemGrid.innerHTML = tiles.join("");
}

function tileTemplate(number, data) {
  const difficulty = levelsByProblem.has(number) ? levelsByProblem.get(number) : null;
  const difficultyText = difficulty === null ? "-" : String(difficulty);
  const solvedCount = Number(data.solvedCount || 0);
  const status = normalizeStatus(data.statusLabel);
  const statusClass = chipClassName(status);
  const statusText = formatStatus(status, solvedCount);
  return `
    <button type="button" class="tile ${statusClass}" data-role="problem-tile" data-problem="${number}">
      <span class="tile-number">${number}</span>
      <span class="tile-meta">Level ${escapeHtml(difficultyText)}</span>
      <span class="tile-meta">${escapeHtml(statusText)}</span>
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
  panelTitle.textContent = `Problem ${number}`;
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
  metaLevel.textContent = difficulty === null ? "-" : String(difficulty);
  metaSolvedCount.textContent = String(Number(data.solvedCount || 0));
  metaLastSolved.textContent = formatTimestamp(data.lastSolvedAt);
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
    await runTransaction(db, async (tx) => {
      const ref = doc(db, "problems", String(number));
      const snap = await tx.get(ref);
      const current = snap.exists() ? snap.data() : DEFAULT_PROBLEM;
      const nextCount = Number(current.solvedCount || 0) + 1;

      tx.set(
        ref,
        {
          solvedCount: nextCount,
          statusLabel: "solved",
          lastSolvedAt: serverTimestamp(),
          difficulty: deleteField(),
        },
        { merge: true }
      );
    });

    await addDoc(collection(db, "solveEvents"), {
      problemNumber: number,
      solvedAt: serverTimestamp(),
      solverUid: currentUid,
      solverName: currentDisplayName,
      solverNameKey: normalizeDisplayName(currentDisplayName),
    });

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
    await signOut(auth);
    currentUid = null;
    currentDisplayName = "";
    localStorage.removeItem(profileKey);
    clearProfileCookie();
    stopRealtimeListeners();
    closePanel();
    opFeedback.classList.add("hidden");
    mainApp.classList.add("hidden");
    loginCard.classList.remove("hidden");
    databaseUpdatedLabel.classList.add("hidden");
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

function isValidProfile(profile) {
  return (
    profile &&
    typeof profile.displayName === "string" &&
    profile.displayName.trim().length > 0 &&
    typeof profile.pin === "string" &&
    /^\d{4}$/.test(profile.pin)
  );
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

function writeProfileCookie(profile) {
  const value = encodeURIComponent(JSON.stringify(profile));
  document.cookie = `${profileCookieName}=${value}; Max-Age=2592000; Path=/; SameSite=Lax`;
}

function readProfileCookie() {
  const nameEq = `${profileCookieName}=`;
  const parts = document.cookie.split(";");
  for (const raw of parts) {
    const part = raw.trim();
    if (part.startsWith(nameEq)) {
      const value = part.slice(nameEq.length);
      try {
        return JSON.parse(decodeURIComponent(value));
      } catch (_e) {
        return null;
      }
    }
  }
  return null;
}

function clearProfileCookie() {
  document.cookie = `${profileCookieName}=; Max-Age=0; Path=/; SameSite=Lax`;
}

function handleError(error) {
  appStatus.textContent = `Realtime error: ${error.message}`;
}

async function claimDisplayName(displayName, normalizedDisplayName, pin) {
  await runTransaction(db, async (tx) => {
    const nameRef = doc(db, "displayNames", normalizedDisplayName);
    const nameSnap = await tx.get(nameRef);

    if (nameSnap.exists()) {
      const ownerUid = nameSnap.data().ownerUid;
      const storedPin = String(nameSnap.data().pin || "");
      if (ownerUid !== currentUid && storedPin !== pin) {
        throw new Error("Display name is already in use or PIN is incorrect.");
      }
    }

    tx.set(
      nameRef,
      {
        ownerUid: currentUid,
        displayName,
        pin,
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      },
      { merge: true }
    );
  });
}

function normalizeDisplayName(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}
