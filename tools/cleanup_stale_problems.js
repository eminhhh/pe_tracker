/**
 * One-off cleanup script.
 * Deletes problems docs where statusLabel is "unsolved" and solvedCount is 0.
 *
 * Usage: paste this into the browser console while logged in,
 * or run from the browser console after the app has loaded:
 *   await cleanupStaleProblems();
 */

/* global firebase */
/* eslint-disable no-console */

async function cleanupStaleProblems() {
  const { collection, getDocs, deleteDoc, doc, getFirestore } = await import(
    "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js"
  );

  const db = getFirestore();
  const snapshot = await getDocs(collection(db, "problems"));

  const stale = [];
  snapshot.forEach((d) => {
    const data = d.data();
    const status = (data.statusLabel || "").trim().toLowerCase();
    const count = Number(data.solvedCount || 0);
    if (status === "unsolved" && count === 0) {
      stale.push(d.id);
    }
  });

  if (!stale.length) {
    console.log("No stale problem docs found. Nothing to clean.");
    return;
  }

  console.log(`Found ${stale.length} stale problem docs:`, stale);

  let deleted = 0;
  for (const id of stale) {
    await deleteDoc(doc(db, "problems", id));
    deleted++;
    console.log(`Deleted problems/${id} (${deleted}/${stale.length})`);
  }

  console.log(`Done. Deleted ${deleted} stale problem docs.`);
}

cleanupStaleProblems();
