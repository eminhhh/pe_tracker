"use strict";

const { logger } = require("firebase-functions");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");

admin.initializeApp();

const db = admin.firestore();
const LEVELS_URL = "https://eminhhh.github.io/pe_tracker/data/levels.json";
const BATCH_LIMIT = 450;
const FUNCTION_REGION = "europe-west1";
const PROBLEM_SUMMARY_REF = db.collection("publicStats").doc("problemSummary");

exports.updateLeaderboardUsers = onSchedule(
  {
    schedule: "17 * * * *",
    timeZone: "Etc/UTC",
    region: FUNCTION_REGION,
    timeoutSeconds: 180,
    memory: "256MiB",
    maxInstances: 1,
  },
  async () => {
    const problemScores = await loadProblemScores();
    const aggregates = await buildLeaderboardAggregates(problemScores);
    const existingDocs = await loadExistingLeaderboardUsers();
    const result = await writeLeaderboardUsers(aggregates, existingDocs);
    const summaryResult = await rebuildProblemSummary();

    logger.info("Leaderboard aggregate update complete", {
      users: aggregates.size,
      writes: result.writes,
      deletes: result.deletes,
      summaryProblems: summaryResult.problemCount,
    });
  }
);

exports.syncProblemSummaryOnSolveWrite = onDocumentWritten(
  {
    document: "solveEvents/{eventId}",
    region: FUNCTION_REGION,
    timeoutSeconds: 60,
    memory: "256MiB",
    maxInstances: 10,
  },
  async (event) => {
    const before = event.data?.before?.data() || null;
    const after = event.data?.after?.data() || null;
    const problemNumber = getChangedProblemNumber(before, after);
    if (!problemNumber) {
      return;
    }

    await rebuildProblemSummaryEntry(problemNumber);
    logger.info("Problem summary entry refreshed from solve write", {
      problemNumber,
      eventId: event.params.eventId,
    });
  }
);

exports.syncProblemSummaryOnProblemWrite = onDocumentWritten(
  {
    document: "problems/{problemId}",
    region: FUNCTION_REGION,
    timeoutSeconds: 60,
    memory: "256MiB",
    maxInstances: 10,
  },
  async (event) => {
    const problemNumber = Number(event.params.problemId);
    if (!Number.isInteger(problemNumber) || problemNumber < 1) {
      return;
    }

    await rebuildProblemSummaryEntry(problemNumber);
    logger.info("Problem summary entry refreshed from problem metadata write", {
      problemNumber,
    });
  }
);

async function loadProblemScores() {
  const response = await fetch(LEVELS_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch levels.json: ${response.status}`);
  }

  const payload = await response.json();
  const scores = new Map();
  Object.entries(payload).forEach(([key, value]) => {
    if (key === "_meta" || !value || typeof value !== "object") {
      return;
    }

    const problemNumber = Number(key);
    const difficulty = Number(value.difficulty);
    scores.set(
      problemNumber,
      Number.isInteger(problemNumber) && problemNumber > 0 && Number.isFinite(difficulty) && difficulty > 0
        ? difficulty
        : 0
    );
  });
  return scores;
}

async function buildLeaderboardAggregates(problemScores) {
  const aggregates = new Map();
  const snapshot = await db.collection("solveEvents").get();

  snapshot.forEach((doc) => {
    const data = doc.data() || {};
    const solverNameKey = getSolverNameKey(doc.id, data);
    const problemNumber = Number(data.problemNumber);
    if (!solverNameKey || !Number.isInteger(problemNumber) || problemNumber < 1) {
      return;
    }

    if (!aggregates.has(solverNameKey)) {
      aggregates.set(solverNameKey, {
        solverNameKey,
        problemScores: new Map(),
      });
    }

    const aggregate = aggregates.get(solverNameKey);
    const eventScore = getEventScore(data, problemNumber, problemScores);
    const currentScore = aggregate.problemScores.get(problemNumber) || 0;
    aggregate.problemScores.set(problemNumber, Math.max(currentScore, eventScore));
  });

  return aggregates;
}

async function rebuildProblemSummary() {
  const [eventsSnapshot, problemsSnapshot] = await Promise.all([
    db.collection("solveEvents").get(),
    db.collection("problems").get(),
  ]);
  const metadataByProblem = getProblemMetadataMap(problemsSnapshot);
  const entriesByProblem = new Map();

  eventsSnapshot.forEach((doc) => {
    const data = doc.data() || {};
    const problemNumber = Number(data.problemNumber);
    const solverNameKey = getSolverNameKey(doc.id, data);
    if (!solverNameKey || !Number.isInteger(problemNumber) || problemNumber < 1) {
      return;
    }

    if (!entriesByProblem.has(problemNumber)) {
      entriesByProblem.set(problemNumber, {
        solverKeys: new Set(),
        lastSolvedAt: null,
      });
    }
    const entry = entriesByProblem.get(problemNumber);
    entry.solverKeys.add(solverNameKey);
    if (isNewerTimestamp(data.solvedAt, entry.lastSolvedAt)) {
      entry.lastSolvedAt = data.solvedAt;
    }
  });

  metadataByProblem.forEach((_metadata, problemNumber) => {
    if (!entriesByProblem.has(problemNumber)) {
      entriesByProblem.set(problemNumber, {
        solverKeys: new Set(),
        lastSolvedAt: null,
      });
    }
  });

  const problems = {};
  [...entriesByProblem.entries()]
    .sort(([a], [b]) => a - b)
    .forEach(([problemNumber, entry]) => {
      problems[String(problemNumber)] = buildProblemSummaryEntry(
        problemNumber,
        entry.solverKeys.size,
        entry.lastSolvedAt,
        metadataByProblem.get(problemNumber)
      );
    });

  await PROBLEM_SUMMARY_REF.set({
    problems,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { problemCount: Object.keys(problems).length };
}

async function rebuildProblemSummaryEntry(problemNumber) {
  const [eventsSnapshot, problemSnapshot] = await Promise.all([
    db.collection("solveEvents").where("problemNumber", "==", problemNumber).get(),
    db.collection("problems").doc(String(problemNumber)).get(),
  ]);
  const solverKeys = new Set();
  let lastSolvedAt = null;

  eventsSnapshot.forEach((doc) => {
    const data = doc.data() || {};
    const solverNameKey = getSolverNameKey(doc.id, data);
    if (!solverNameKey) {
      return;
    }
    solverKeys.add(solverNameKey);
    if (isNewerTimestamp(data.solvedAt, lastSolvedAt)) {
      lastSolvedAt = data.solvedAt;
    }
  });

  const metadata = problemSnapshot.exists ? problemSnapshot.data() : null;
  await PROBLEM_SUMMARY_REF.set(
    {
      [`problems.${problemNumber}`]: buildProblemSummaryEntry(
        problemNumber,
        solverKeys.size,
        lastSolvedAt,
        metadata
      ),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

function getProblemMetadataMap(snapshot) {
  const metadataByProblem = new Map();
  snapshot.forEach((doc) => {
    const problemNumber = Number(doc.id);
    if (!Number.isInteger(problemNumber) || problemNumber < 1) {
      return;
    }
    metadataByProblem.set(problemNumber, doc.data() || {});
  });
  return metadataByProblem;
}

function buildProblemSummaryEntry(problemNumber, solvedCount, lastSolvedAt, metadata) {
  const rawStatus = typeof metadata?.statusLabel === "string" ? metadata.statusLabel : "";
  const normalizedStatus = normalizeStatus(rawStatus);
  const metadataSolvedCount = Number(metadata?.solvedCount);
  const resolvedSolvedCount = Math.max(
    solvedCount,
    Number.isInteger(metadataSolvedCount) && metadataSolvedCount > 0 ? metadataSolvedCount : 0
  );
  const resolvedLastSolvedAt = lastSolvedAt || metadata?.lastSolvedAt || null;
  return {
    solvedCount: resolvedSolvedCount,
    statusLabel: resolvedSolvedCount > 0 && normalizedStatus === "unsolved" ? "solved" : normalizedStatus,
    lastSolvedAt: resolvedLastSolvedAt,
  };
}

async function loadExistingLeaderboardUsers() {
  const existing = new Map();
  const snapshot = await db.collection("leaderboardUsers").get();
  snapshot.forEach((doc) => {
    existing.set(doc.id, doc.data() || {});
  });
  return existing;
}

async function writeLeaderboardUsers(aggregates, existingDocs) {
  let batch = db.batch();
  let pending = 0;
  let writes = 0;
  let deletes = 0;
  const now = admin.firestore.FieldValue.serverTimestamp();

  for (const [solverNameKey, aggregate] of [...aggregates.entries()].sort()) {
    const ref = db.collection("leaderboardUsers").doc(solverNameKey);
    const current = existingDocs.get(solverNameKey) || null;
    const target = buildLeaderboardUserDoc(aggregate, current, now);

    if (!leaderboardDocNeedsWrite(current, target)) {
      continue;
    }

    batch.set(ref, target);
    pending += 1;
    writes += 1;
    if (pending >= BATCH_LIMIT) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }

  const staleKeys = [...existingDocs.keys()]
    .filter((solverNameKey) => !aggregates.has(solverNameKey))
    .sort();
  for (const solverNameKey of staleKeys) {
    batch.delete(db.collection("leaderboardUsers").doc(solverNameKey));
    pending += 1;
    deletes += 1;
    if (pending >= BATCH_LIMIT) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }

  if (pending > 0) {
    await batch.commit();
  }

  return { writes, deletes };
}

function buildLeaderboardUserDoc(aggregate, current, now) {
  const score = [...aggregate.problemScores.values()].reduce((total, value) => total + value, 0);
  return {
    solverNameKey: aggregate.solverNameKey,
    solvedCount: aggregate.problemScores.size,
    score: Number.isInteger(score) ? score : Number(score.toFixed(6)),
    updatedAt: now,
    createdAt: current && current.createdAt ? current.createdAt : now,
  };
}

function leaderboardDocNeedsWrite(current, target) {
  if (!current) {
    return true;
  }

  return (
    current.solverNameKey !== target.solverNameKey
    || Number(current.solvedCount) !== target.solvedCount
    || Number(current.score) !== target.score
  );
}

function getEventScore(data, problemNumber, problemScores) {
  const levelScore = problemScores.has(problemNumber) ? problemScores.get(problemNumber) : 0;
  const scoreValue = Number(data.scoreValue);
  return Math.max(levelScore, Number.isFinite(scoreValue) && scoreValue > 0 ? scoreValue : 0);
}

function getChangedProblemNumber(before, after) {
  const afterNumber = Number(after?.problemNumber);
  if (Number.isInteger(afterNumber) && afterNumber > 0) {
    return afterNumber;
  }

  const beforeNumber = Number(before?.problemNumber);
  if (Number.isInteger(beforeNumber) && beforeNumber > 0) {
    return beforeNumber;
  }

  return 0;
}

function normalizeStatus(status) {
  if (typeof status === "string") {
    const normalized = status.trim().toLowerCase();
    if (normalized === "assignment") {
      return "assignment";
    }
    if (normalized === "solved in lecture" || normalized === "class") {
      return "solved in lecture";
    }
    if (normalized === "solved" || normalized === "solved by xx person") {
      return "solved";
    }
  }
  return "unsolved";
}

function isNewerTimestamp(candidate, current) {
  return timestampToMillis(candidate) > timestampToMillis(current);
}

function timestampToMillis(value) {
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

function getSolverNameKey(docId, data) {
  const nameKey = normalizeDisplayName(data.solverNameKey);
  if (nameKey) {
    return nameKey;
  }

  const solverName = normalizeDisplayName(data.solverName);
  if (solverName) {
    return solverName;
  }

  if (typeof docId === "string" && docId.includes("__")) {
    const rawNameKey = docId.split("__", 1)[0];
    try {
      return normalizeDisplayName(decodeURIComponent(rawNameKey));
    } catch (_error) {
      return normalizeDisplayName(rawNameKey);
    }
  }

  return "";
}

function normalizeDisplayName(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}
