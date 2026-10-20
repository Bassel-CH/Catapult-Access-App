/*
 * Runs the original prototype's own logic over a CSV, for
 * tools/compare_backend_to_prototype.py.
 *
 * Lifts `parseCSV` and `groupUser` verbatim out of prototype/option1-ui.html
 * (so we are testing the prototype's real logic, not a re-implementation of
 * it), runs them over a CSV, applies a decision recipe, replays the
 * prototype's click-time Access cascade, and counts kept / revoked /
 * no-decision exactly the way its buildReport() does.
 *
 * Driven by tools/compare_backend_to_prototype.py — see that file for usage.
 *
 *   node tools/run_prototype_logic.js <csv-path> <recipe.json> <out.json>
 */
const fs = require('fs');
const path = require('path');

const [csvPath, recipePath, outPath] = process.argv.slice(2);
if (!csvPath || !recipePath || !outPath) {
  console.error('usage: node run_prototype_logic.js <csv> <recipe.json> <out.json>');
  process.exit(2);
}

// ── Lift the two pure functions out of the prototype ────────────────────────
// Matched on their own top-level `function name(...){ ... }` blocks: both start
// and end at column 0 in that file, so this survives edits above or below them.
const protoHtml = fs.readFileSync(
  path.join(__dirname, '..', 'prototype', 'option1-ui.html'), 'utf8');
function lift(name) {
  const re = new RegExp('^function ' + name + '\\([\\s\\S]*?^\\}', 'm');
  const m = protoHtml.match(re);
  if (!m) throw new Error(`could not lift ${name}() out of the prototype`);
  return m[0];
}
const { parseCSV, groupUser } = (new Function(
  `${lift('parseCSV')}\n${lift('groupUser')}\nreturn { parseCSV, groupUser };`))();

const recipe = JSON.parse(fs.readFileSync(recipePath, 'utf8'));
const revokeDomains = new Set(recipe.revoke_access_domains);
const isAccess = (n) => String(n || '').trim().toLowerCase() === 'access';

// The prototype loads the file with FileReader.readAsText(), i.e. decoded as
// UTF-8 — it has no cp1252 handling. Reproduce that faithfully; it is one of
// the real divergences from the backend.
const rows = parseCSV(fs.readFileSync(csvPath).toString('utf8'));

// ── ingest(), minus the DOM: users keyed by StaffId, no junk-row filtering ──
const users = new Map();
for (const r of rows) {
  if (!users.has(r.StaffId)) users.set(r.StaffId, {
    id: r.StaffId, name: r.StaffName, rows: [], permCount: 0,
  });
  const u = users.get(r.StaffId);
  u.rows.push({
    position: r.PositionName, domain: r.DomainName,
    permission: r.PermissionName, source: r.PermissionSource,
  });
  u.permCount++;
}
const tree = new Map();
users.forEach((u) => tree.set(u.id, groupUser(u)));

const VALID = /^(Position-Based|Direct Assignment)$/;
const phantom = [...users.values()]
  .filter((u) => !u.rows.some((r) => VALID.test(r.source)))
  .map((u) => u.id);

// ── Selection (recipe is name-based; StaffName<->StaffId is 1:1 in this data) ─
const wanted = new Set(recipe.selected);
const chosen = [...users.values()].filter((u) => wanted.has(u.name))
  .sort((a, b) => a.name.localeCompare(b.name));      // buildReport sorts by name
const missing = recipe.selected.filter((n) => !chosen.some((u) => u.name === n));

// ── Decisions: rule pass, then the prototype's cascadeRevokeApp() behaviour ──
const decisions = new Map();
for (const u of chosen) {
  for (const g of tree.get(u.id)) {
    for (const a of g.apps) {
      for (const ac of a.actions) {
        if (isAccess(ac.name) && revokeDomains.has(a.app)) decisions.set(ac.id, 'revoke');
        else if (ac.name.startsWith(recipe.keep_prefix)) decisions.set(ac.id, 'keep');
      }
      // Revoking an app's Access revokes (and locks) every sibling. The
      // prototype does this at click time; the backend does it at report time.
      const access = a.actions.find((ac) => isAccess(ac.name));
      if (access && decisions.get(access.id) === 'revoke') {
        for (const ac of a.actions) decisions.set(ac.id, 'revoke');
      }
    }
  }
}

// ── buildReport()'s counting loop ───────────────────────────────────────────
let kept = 0, revoked = 0, no_decision = 0, total = 0;
for (const u of chosen) {
  for (const g of tree.get(u.id)) {
    for (const a of g.apps) {
      for (const ac of a.actions) {
        total++;
        const d = decisions.get(ac.id);
        if (d === 'keep') kept++; else if (d === 'revoke') revoked++; else no_decision++;
      }
    }
  }
}

const result = {
  summary: { users_reviewed: chosen.length, total_permissions: total, kept, revoked, no_decision },
  ingest: { rows_parsed: rows.length, users: users.size, phantom_users: phantom },
  matched: chosen.map((u) => u.name),
  missing,
};
fs.writeFileSync(outPath, JSON.stringify(result, null, 1));
console.log('prototype:', JSON.stringify(result.summary));
if (missing.length) console.log('prototype could NOT match:', JSON.stringify(missing));
