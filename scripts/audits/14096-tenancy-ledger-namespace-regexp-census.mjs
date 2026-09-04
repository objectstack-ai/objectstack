#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #14096 step 1 (census) — the maintainer ruling's whole first deliverable
 * (director seat, 总监批 #25, 2026-09-01, maintainer verbatim 「同意」, issue
 * comment 5494594783): does `PLATFORM_OBJECT_TENANCY` (the hand-adjudicated
 * ledger the RUNTIME write path reads, `packages/objectql/src/tenancy/
 * platform-object-tenancy.ts`) judge any platform-namespace object
 * DIFFERENTLY than the namespace regexp `/^(sys_|cloud_|ai_)/` (what the two
 * SEED paths — `seed-loader.ts`'s `fallbackOrgId` and
 * `seed-tenancy-backfill.ts`'s own `PLATFORM_NAMESPACE` — still cut by)?
 *
 * MEASUREMENT ONLY on a healthy read: exit 0, this is a census, not a gate.
 * Requires the `@objectstack/objectql` dependency closure built (`pnpm
 * --filter '@objectstack/objectql^...' build && pnpm --filter
 * @objectstack/objectql build`) — this script does not build.
 *
 * ⚠️ NOT measurement-only on a BROKEN ledger read. `disagreement_count` is
 * downstream of `PLATFORM_OBJECT_TENANCY`, the one input this script does not
 * independently re-derive (§2's header control is an AST census of the
 * OBJECT FILES — it never reads this ledger, so it validates the population
 * and tenant-field logic and proves nothing about the ledger import). An
 * emptied, stale, or mis-imported ledger therefore reports a clean
 * `disagreement_count: 0` indistinguishable from a genuine zero, WHILE
 * `reproduced_matches_header` still prints `true` — reproduced against a PR
 * #15122 reviewer experiment: `PLATFORM_OBJECT_TENANCY = {}`, rebuilt, run;
 * exit 0, header control "passes", 0 disagreements. Because the ruling this
 * script serves branches on the number (a zero closes #14096 as "keep the
 * regexp", non-zero re-opens it p1 — see the audit doc's `## Branch
 * verdict`), a false zero would close a p1 tenancy question as decided with
 * no visible sign anything had gone wrong. `LEDGER_ENTRY_COUNT_FLOOR` below
 * turns that failure mode into a thrown error (non-zero exit) instead.
 *
 * ## The predicate (stated, not left implicit — dispatch Zone 2.1)
 *
 * The regexp is used at both seed sites as a UNIFORM rule: every name it
 * matches stays global/cross-tenant (no fallback org at seed-load, no
 * backfill adoption) — confirmed by reading both sites (see §3 below). So
 * "the regexp's verdict" for every object IN the population this script
 * builds (every registered platform-namespace object — the population is
 * defined BY the regexp match) is uniformly "out of scope" (global).
 *
 * "The ledger's verdict" is `classifyPlatformObjectTenancy(name)`, which
 * answers one of three states: `tenant-scoped` (in scope — the runtime path
 * derives/refuses an organization for it), `global`, or `unclassified` (not
 * adjudicated — stays out of scope, same as `global`, per the ledger's own
 * documented policy).
 *
 * The honest mapping onto the regexp's binary: `tenant-scoped` -> "in scope"
 * (disagrees with the regexp's uniform "out of scope"); `global` and
 * `unclassified` both -> "out of scope" (agree with the regexp). A disagreement
 * is therefore exactly a ledger entry classified `tenant-scoped` — nothing
 * about `global` vs `unclassified` changes which population disagrees, since
 * both map to the SAME binary answer the regexp gives every one of them.
 *
 * ## The trap this script does NOT fall into (dispatch Zone 2.2)
 *
 * `resolveTenantFieldName` never reads `managedBy`. Three better-auth-managed
 * objects (`sys_member`, `sys_team`, `sys_invitation`) declare their OWN
 * `organization_id` field despite `managedBy: 'better-auth'`, so they resolve
 * a real tenant column (`declaresOrgId` below checks the object's OWN
 * `fields:` block for a literal `organization_id: Field...`, not `managedBy`).
 * This matters for the header control (§2) — it does NOT change the
 * disagreement count (§4), because none of the three is in the ledger at all
 * (`unclassified`), and `unclassified` already maps to "out of scope" same as
 * `global` above. The script still computes it, printed for that control.
 *
 * ## A second precedence subtlety, caught only by failing to reproduce the
 *    header on a first pass (exactly the failure mode §2's own comment warns
 *    about, so kept as a comment rather than quietly fixed)
 *
 * `resolveTenantFieldName` checks `tenancy.enabled === false` FIRST and
 * returns `null` UNCONDITIONALLY on it — before it ever looks at `fields`.
 * So an object can carry `tenancy: { enabled: false }` **and** its own
 * declared `organization_id` field (`sys_sso_provider` does exactly this)
 * and still resolve NO tenant field: the explicit opt-out overrides a
 * self-declared column, it does not merely withhold injection of one. A
 * first draft of `hasResolvableTenantField` below read `declaresOrgId`
 * through that branch (treating the opt-out like the `managedBy` skip,
 * which does NOT override a self-declared field) and undercounted
 * `no_tenant_field` by one (24 instead of 25) against the header control —
 * caught by §2's own mismatch check, not by review.
 */

import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../..');

// ---------------------------------------------------------------------------
// §1. Discover every registered platform-namespace object by AST-lite census
//     of `ObjectSchema.create(` calls — the same method the ledger's own
//     header (`platform-object-tenancy.ts:32-37`) documents using.
// ---------------------------------------------------------------------------

/** Blank out `//` and `/* *\/` comments and string contents (chars only,
 * preserving quote delimiters) so a paren mentioned in PROSE ("(255, 768]")
 * cannot desync a naive bracket-depth scan. This is the exact bug that made
 * an earlier pass of this census undercount by 2 (`sys_oauth_client_resource`,
 * `sys_oauth_resource` — both carry a numeric-range comment shaped like
 * `(N, M]`) — left in as a comment because the failure mode is easy to
 * reintroduce by "simplifying" this function. */
function blankNonCode(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let inSL = false, inML = false, inStr = null;
  while (i < n) {
    const c = src[i], c2 = src[i + 1];
    if (inSL) { out += c === '\n' ? c : ' '; if (c === '\n') inSL = false; i++; continue; }
    if (inML) { if (c === '*' && c2 === '/') { out += '  '; i += 2; inML = false; continue; } out += c === '\n' ? c : ' '; i++; continue; }
    if (inStr) { out += c; if (c === '\\') { out += src[i + 1] ?? ''; i += 2; continue; } if (c === inStr) inStr = null; i++; continue; }
    if (c === '/' && c2 === '/') { inSL = true; out += '  '; i += 2; continue; }
    if (c === '/' && c2 === '*') { inML = true; out += '  '; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; out += c; i++; continue; }
    out += c; i++;
  }
  return out;
}

function findObjectSchemaCreateCalls() {
  const files = execSync(
    `grep -rl "ObjectSchema.create(" packages/ --include="*.ts" | grep -v "\\.test\\.\\|node_modules\\|/migrations/registry.ts\\|/migrations/entries/"`,
    { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 1024 * 1024 * 50 },
  ).trim().split('\n').filter(Boolean);

  const results = [];
  for (const file of files) {
    const rawSrc = readFileSync(resolve(REPO_ROOT, file), 'utf8');
    const src = blankNonCode(rawSrc);
    let idx = 0;
    while (true) {
      const start = src.indexOf('ObjectSchema.create(', idx);
      if (start === -1) break;
      const parenStart = src.indexOf('(', start + 'ObjectSchema.create'.length - 1);
      let depth = 0, i = parenStart, end = -1;
      for (; i < src.length; i++) {
        if (src[i] === '(') depth++;
        else if (src[i] === ')') { depth--; if (depth === 0) { end = i; break; } }
      }
      if (end === -1) { idx = start + 1; continue; }
      const rawBlock = rawSrc.slice(parenStart, end + 1);
      const m = rawBlock.match(/name:\s*['"]([a-zA-Z0-9_]+)['"]/);
      if (m && /^(sys_|cloud_|ai_)/.test(m[1])) {
        results.push({
          name: m[1],
          file,
          managedBy: rawBlock.match(/managedBy:\s*['"]([a-zA-Z0-9_-]+)['"]/)?.[1] ?? null,
          tenancyEnabledFalse: /tenancy:\s*\{[^}]*enabled:\s*false/s.test(rawBlock),
          systemFieldsFalse: /systemFields:\s*false/.test(rawBlock),
          systemFieldsTenantFalse: /systemFields:\s*\{[^}]*tenant:\s*false/s.test(rawBlock),
          declaresOrgId: /\borganization_id\s*:\s*Field\./.test(rawBlock),
        });
      }
      idx = end + 1;
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// §2. Reproduce the ledger header's positive control (84 / 25 / 59) —
//     dispatch Zone 2.3: "if your own reading cannot reproduce the header's
//     numbers, your instrument is wrong, not the header."
//
//     Replicates `applySystemFields`'s real precedence
//     (`packages/objectql/src/registry.ts`): the `organization_id` COLUMN is
//     injected UNCONDITIONALLY except for `tenancy.enabled: false`,
//     `systemFields: false`, `systemFields.tenant: false`, or
//     `managedBy: 'better-auth'` (whose column layout is better-auth's own
//     migrations) — and even then, an object that already DECLARES its own
//     `organization_id` field keeps it regardless of the skip.
// ---------------------------------------------------------------------------
function hasResolvableTenantField(entry) {
  // `resolveTenantFieldName`'s FIRST check, and it is UNCONDITIONAL: an
  // explicit `tenancy.enabled: false` wins even over a self-declared
  // `organization_id` field (see the module doc comment above).
  if (entry.tenancyEnabledFalse) return false;
  // Past that gate, a self-declared field always counts — this is what
  // keeps `sys_member`/`sys_team`/`sys_invitation` OUT of this branch's
  // false side despite `managedBy: 'better-auth'` (the Zone-2.2 trap).
  if (entry.declaresOrgId) return true;
  if (entry.managedBy === 'better-auth') return false; // injection skipped, no self-declared field
  if (entry.systemFieldsFalse) return false;
  if (entry.systemFieldsTenantFalse) return false;
  return true; // injected unconditionally otherwise
}

// ---------------------------------------------------------------------------
// §3. Confirm the two seed sites still cut by the SAME uniform regexp rule
//     (dispatch Zone 2.5 — re-derive, don't assume).
// ---------------------------------------------------------------------------
function confirmSeedSitesCutByRegexp() {
  const seedLoader = readFileSync(resolve(REPO_ROOT, 'packages/metadata-protocol/src/seed-loader.ts'), 'utf8');
  const backfill = readFileSync(resolve(REPO_ROOT, 'packages/metadata-protocol/src/migrations/seed-tenancy-backfill.ts'), 'utf8');
  const seedLoaderCuts = /\(\/\^\(sys_\|cloud_\|ai_\)\/\.test\(objectName\)\s*\?\s*undefined\s*:\s*this\.fallbackOrgId\)/.test(seedLoader);
  const backfillDeclares = /const PLATFORM_NAMESPACE = \/\^\(sys_\|cloud_\|ai_\)\//.test(backfill);
  const backfillFilters = /\.filter\(\(r\)\s*=>\s*!PLATFORM_NAMESPACE\.test\(String\(r\.object\)\)\)/.test(backfill);
  return { seedLoaderCuts, backfillDeclares, backfillFilters };
}

// ---------------------------------------------------------------------------
// §4. The ledger's real verdict, from the REAL built module — not
//     re-transcribed by hand.
// ---------------------------------------------------------------------------
async function main() {
  const entries = findObjectSchemaCreateCalls();
  const names = entries.map((e) => e.name).sort();

  const withTenantField = entries.filter(hasResolvableTenantField).map((e) => e.name).sort();
  const withoutTenantField = entries.filter((e) => !hasResolvableTenantField(e)).map((e) => e.name).sort();

  const seedSites = confirmSeedSitesCutByRegexp();

  const { classifyPlatformObjectTenancy, PLATFORM_OBJECT_TENANCY, isPlatformNamespaceObject } =
    await import(resolve(REPO_ROOT, 'packages/objectql/dist/index.js'));

  // Hard floor on the ledger read (see the module doc comment above for why
  // this is not optional): an empty, stale, or mis-imported
  // `PLATFORM_OBJECT_TENANCY` must fail LOUDLY, not report a clean
  // `disagreement_count: 0` that is indistinguishable from a genuine zero.
  // As of 2026-09-04 the ledger holds 9 entries (8 tenant-scoped +
  // `sys_permission_set` global) -- §5 of the audit doc. The floor is set
  // well below that so a handful of future legitimate edits (a new verdict
  // added, or even one or two retired) does not trip it, while zero -- and
  // anything close enough to zero to be a broken read rather than a real
  // ledger -- does. If the ledger legitimately shrinks below this floor,
  // raise it deliberately in its own PR; do not lower it to silence a real
  // failure.
  const LEDGER_ENTRY_COUNT_FLOOR = 5;
  const ledgerEntryCount = Object.keys(PLATFORM_OBJECT_TENANCY).length;
  if (ledgerEntryCount < LEDGER_ENTRY_COUNT_FLOOR) {
    throw new Error(
      `PLATFORM_OBJECT_TENANCY imported with only ${ledgerEntryCount} ` +
      `${ledgerEntryCount === 1 ? 'entry' : 'entries'} (floor: ${LEDGER_ENTRY_COUNT_FLOOR}). ` +
      'This looks like an empty, stale, or mis-imported ledger, not a real low-entry ' +
      'state -- refusing to compute a disagreement count against it, because a false ' +
      'zero here would silently close a p1 tenancy question as "decided, nothing to ' +
      'do" (see the module doc comment and the audit doc\'s `## Branch verdict`). ' +
      'Rebuild the dependency closure (`pnpm --filter \'@objectstack/objectql^...\' ' +
      'build && pnpm --filter @objectstack/objectql build`) and re-run. If the ledger ' +
      `has legitimately shrunk below ${LEDGER_ENTRY_COUNT_FLOOR} entries, raise ` +
      'LEDGER_ENTRY_COUNT_FLOOR deliberately -- do not lower it to make a real failure go away.',
    );
  }

  const allMatchRegexp = names.every((n) => isPlatformNamespaceObject(n));

  const disagreements = names
    .map((name) => ({ name, ledger: classifyPlatformObjectTenancy(name) }))
    .filter((r) => r.ledger === 'tenant-scoped');

  // The trap-check objects named in the dispatch (Zone 2.2): resolve a real
  // tenant field despite `managedBy: 'better-auth'`, but are NOT in the
  // ledger (unclassified) -- so they do not appear in `disagreements` above.
  const trapObjects = ['sys_member', 'sys_team', 'sys_invitation'].map((n) => ({
    name: n,
    resolvesTenantField: withTenantField.includes(n),
    ledgerVerdict: classifyPlatformObjectTenancy(n),
  }));

  const report = {
    population_size: names.length,
    header_claims: { total: 84, no_tenant_field: 25, has_tenant_field: 59 },
    reproduced: { total: names.length, no_tenant_field: withoutTenantField.length, has_tenant_field: withTenantField.length },
    reproduced_matches_header:
      names.length === 84 && withoutTenantField.length === 25 && withTenantField.length === 59,
    all_discovered_names_match_regexp: allMatchRegexp,
    seed_sites_still_cut_by_regexp: seedSites,
    ledger_entry_count: ledgerEntryCount,
    disagreement_count: disagreements.length,
    disagreements: disagreements.map((d) => d.name),
    trap_check: trapObjects,
    no_tenant_field_objects: withoutTenantField,
  };

  console.log(JSON.stringify(report, null, 2));
  console.error('\n--- human-readable summary ---');
  console.error(`Population (registered platform-namespace objects): ${report.population_size}`);
  console.error(`Header claims 84/25/59; reproduced ${report.reproduced.total}/${report.reproduced.no_tenant_field}/${report.reproduced.has_tenant_field} -> ${report.reproduced_matches_header ? 'MATCH (control passes)' : 'MISMATCH (investigate before trusting anything else in this report)'}`);
  console.error(`Both seed sites still cut by the uniform namespace regexp: ${JSON.stringify(seedSites)}`);
  console.error(`Ledger vs regexp disagreement count: ${report.disagreement_count}`);
  console.error(`Disagreeing objects: ${report.disagreements.join(', ') || '(none)'}`);
  console.error(`Trap check (resolve a tenant field despite managedBy:'better-auth', but ledger-unclassified so NOT a disagreement): ${JSON.stringify(trapObjects)}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
