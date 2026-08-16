#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * MEASUREMENT INSTRUMENT — not a gate. Deliberately unwired (#8894).
 * ==================================================================
 *
 * Run it: `node scripts/measure-declared-security-keys.mjs`
 *
 * ⛔ This script is NOT in `check:*`, NOT in any workflow, and must not be
 * promoted into one without a maintainer ruling — see §"Verdict" below, which
 * records the measured reason it is not gate-grade today. It exists so the
 * numbers in #8894 are reproducible instead of taken on trust, and so the next
 * seat that revisits the ADR-0049 declaration-side ratchet re-measures rather
 * than re-argues.
 *
 * ## What #8711 half-2 proposed, and what this measures
 *
 * The ADR-0056 D10 authz-conformance matrix cannot ratchet authorization
 * PRIMITIVES: there is no syntactic signature for "a predicate that decides a
 * grant" (`isRowActive` looks exactly like any other `.filter()`), which is why
 * widening it was measured unachievable (#8711). The counter-proposal was to
 * ratchet the DECLARATION side instead — the ADR-0049 defect class is "a
 * declared security key nothing reads", and declared keys were claimed to be
 * mechanically enumerable where primitives are not:
 *
 *   1. platform-object fields on security objects;
 *   2. actions whose label/description text promises an enforcement effect.
 *
 * The maintainer ruled (2026-08-16) that this card produces a MEASUREMENT, not
 * a gate: define the oracle, run it, report the would-be red set and the
 * false-positive surface BEFORE anything enforces (the #6451 discipline).
 *
 * ## The oracle, in three parts, each with its own mechanizability verdict
 *
 * PART A — enumerate the security objects.  MECHANICAL.
 *   `PLATFORM_OBJECTS_BY_PACKAGE` (packages/spec/src/system/constants/
 *   platform-object-names.ts) is a curated registry whose owning packages carry
 *   conformance tests asserting it matches what they register. Its
 *   `plugin-security` + `plugin-sharing` groups ARE the security objects. No
 *   heuristic: a name is in the group or it is not.
 *   ⚠ The boundary itself is a judgement — see `SECURITY_PACKAGES` below.
 *
 * PART B — enumerate the declared keys on those objects.  MECHANICAL.
 *   Every platform object is one `ObjectSchema.create({ ... })` literal, so the
 *   `fields` keys and `actions` entries come off the TypeScript AST exactly.
 *   Nothing here is a guess, and the enumeration is stable under reformatting.
 *
 * PART C — decide whether a declared key is READ.  ✗ NOT MECHANICAL.
 *   This is where the proposal fails, and it fails in BOTH directions at once.
 *   See §"Verdict". Part C is implemented anyway, and reports its own failure,
 *   because "we measured it and here is how badly it does" is the deliverable.
 *
 * ## Verdict (measured 2026-08-16, at the commit this file landed on)
 *
 * Parts A and B hold. Part C does not, and the calibration below proves it on
 * the class's own headline instance rather than on an invented example:
 *
 *   • `sys_permission_set.active` was declared with a Deactivate dialog
 *     promising that access stops, and NOTHING read the column for its whole
 *     pre-#8613 life. Ablate #8613's enforcement seam and re-run Part C: the
 *     key still scores as READ, on five unrelated files. The oracle would have
 *     been GREEN across the entire inert period — it does not detect the class
 *     it claims to.
 *   • Worse, the real enforcement site is INVISIBLE to it. `resolve-authz-
 *     context.ts` — the single seam every transport resolves authorization
 *     through — contains zero occurrences of the token `active`; it calls
 *     `isRowActive(r)`. The indirection that made the primitive un-ratchetable
 *     in #8711 defeats the declaration side too, one layer down.
 *   • The false signals are ordinary co-occurrence: `state: 'active'` (the
 *     METADATA publication state, an unrelated concept), a `z.enum` member, a
 *     docstring example, and a seed that WRITES the column.
 *
 * So Part C is not a gate that needs its threshold tuned; it is a text search
 * standing in for a call graph, which is the exact substitution
 * `packages/spec/liveness/README.md` already records as unsound ("a grep can
 * only prove presence").
 *
 * ## What this does NOT say
 *
 * It does not say a declaration-side ledger is a bad idea — the opposite. The
 * spec liveness ledger (`packages/spec/liveness/`) is a declaration-side
 * ratchet that WORKS, and it works precisely because it never tries to decide
 * liveness mechanically: it enumerates the declared surface mechanically (Parts
 * A+B, which hold here) and requires a HUMAN verdict with evidence for each
 * key, then ratchets that nothing new arrives unclassified. Parts A and B are
 * exactly the enumerator such a ledger would need. What is unavailable is the
 * automatic verdict, and the four true findings below were all reached by hand.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rel = (p) => relative(ROOT, p).split('\\').join('/');

// ---------------------------------------------------------------------------
// PART A — which objects are "security objects"
// ---------------------------------------------------------------------------

/**
 * The `PLATFORM_OBJECTS_BY_PACKAGE` groups whose owning package IS the security
 * model. Mechanical given this list; the LIST is the judgement, and it is
 * stated as data so a reader can disagree with it in one place.
 *
 * ⚠ Deliberately EXCLUDED, and the exclusion is arguable: the identity/auth
 * objects that `platform-objects` owns (`sys_api_key`, `sys_session`,
 * `sys_oauth_*`, `sys_two_factor`, `sys_member`, `sys_team*`, `sys_sso_provider`,
 * `sys_scim_provider`, `sys_invitation`, `sys_jwks`, `sys_device_code`). They
 * carry security-bearing keys too, but they sit in a package whose other 25
 * objects are jobs, settings, email and reports — so "the package is the
 * security model" stops being true there, and no finer mechanical marker exists
 * on the objects themselves (no `security: true`, no category enum). Run with
 * `--include-identity` for the sensitivity number.
 */
const SECURITY_PACKAGES = ['plugin-security', 'plugin-sharing'];

/** Objects added by `--include-identity`. Hand-picked ⇒ NOT mechanical; that is the point. */
const IDENTITY_OBJECTS = [
  'sys_api_key', 'sys_device_code', 'sys_invitation', 'sys_jwks', 'sys_member',
  'sys_oauth_access_token', 'sys_oauth_application', 'sys_oauth_client_assertion',
  'sys_oauth_client_resource', 'sys_oauth_consent', 'sys_oauth_refresh_token',
  'sys_oauth_resource', 'sys_scim_provider', 'sys_session', 'sys_sso_provider',
  'sys_team', 'sys_team_member', 'sys_two_factor', 'sys_verification',
];

const REGISTRY_FILE = 'packages/spec/src/system/constants/platform-object-names.ts';

// ---------------------------------------------------------------------------
// tiny AST helpers
// ---------------------------------------------------------------------------

const objLit = (n) => (n && ts.isObjectLiteralExpression(n) ? n : null);

function propByName(obj, name) {
  for (const p of obj.properties) {
    if (!ts.isPropertyAssignment(p) || !p.name) continue;
    if (!ts.isIdentifier(p.name) && !ts.isStringLiteral(p.name)) continue;
    if (p.name.text === name) return p.initializer;
  }
  return null;
}

function strOf(n) {
  if (!n) return null;
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const l = strOf(n.left);
    const r = strOf(n.right);
    if (l !== null && r !== null) return l + r;
  }
  return null;
}

function parse(file) {
  return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
}

function walk(dir, pred, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    if (e === 'node_modules' || e === 'dist' || e === '.git' || e === '.turbo' || e === '.next') continue;
    const p = join(dir, e);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, pred, out);
    else if (pred(p)) out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------------------
// PART A implementation — read the curated registry off its source
// ---------------------------------------------------------------------------

function readSecurityObjectNames({ includeIdentity }) {
  const src = parse(join(ROOT, REGISTRY_FILE));
  const groups = new Map();
  ts.forEachChild(src, function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) &&
        node.name.text === 'PLATFORM_OBJECTS_BY_PACKAGE') {
      let init = node.initializer;
      while (init && (ts.isAsExpression(init) || ts.isSatisfiesExpression(init))) init = init.expression;
      const lit = objLit(init);
      if (lit) {
        for (const p of lit.properties) {
          if (!ts.isPropertyAssignment(p) || !p.name) continue;
          const key = ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : null;
          if (!key || !ts.isArrayLiteralExpression(p.initializer)) continue;
          groups.set(key, p.initializer.elements.map(strOf).filter(Boolean));
        }
      }
    }
    ts.forEachChild(node, visit);
  });
  if (groups.size === 0) throw new Error(`could not parse PLATFORM_OBJECTS_BY_PACKAGE from ${REGISTRY_FILE}`);

  const names = [];
  for (const pkg of SECURITY_PACKAGES) {
    const g = groups.get(pkg);
    if (!g) throw new Error(`registry has no '${pkg}' group — SECURITY_PACKAGES is stale`);
    names.push(...g);
  }
  if (includeIdentity) names.push(...IDENTITY_OBJECTS);
  return { names: [...new Set(names)].sort(), groups };
}

// ---------------------------------------------------------------------------
// PART B implementation — enumerate declared keys off the AST
// ---------------------------------------------------------------------------

function enumerateObjects() {
  const files = walk(join(ROOT, 'packages'), (p) => p.endsWith('.object.ts'));
  const found = [];
  for (const f of files) {
    const src = parse(f);
    ts.forEachChild(src, function visit(node) {
      if (ts.isCallExpression(node)) {
        const ex = node.expression;
        if (ts.isPropertyAccessExpression(ex) && ex.name.text === 'create' &&
            ts.isIdentifier(ex.expression) && ex.expression.text === 'ObjectSchema') {
          const lit = objLit(node.arguments[0]);
          if (lit) found.push(readObject(src, f, lit));
        }
      }
      ts.forEachChild(node, visit);
    });
  }
  return found;
}

function readObject(src, file, lit) {
  const lineOf = (n) => src.getLineAndCharacterOfPosition(n.getStart()).line + 1;
  const name = strOf(propByName(lit, 'name'));

  const fields = [];
  const fl = objLit(propByName(lit, 'fields'));
  if (fl) {
    for (const p of fl.properties) {
      if (!ts.isPropertyAssignment(p) || !p.name) continue;
      if (!ts.isIdentifier(p.name) && !ts.isStringLiteral(p.name)) continue;
      const argLit = ts.isCallExpression(p.initializer)
        ? objLit(p.initializer.arguments.find((a) => ts.isObjectLiteralExpression(a)))
        : null;
      fields.push({
        key: p.name.text,
        line: lineOf(p),
        label: argLit ? strOf(propByName(argLit, 'label')) : null,
        description: argLit ? strOf(propByName(argLit, 'description')) : null,
      });
    }
  }

  const actions = [];
  const al = propByName(lit, 'actions');
  if (al && ts.isArrayLiteralExpression(al)) {
    for (const el of al.elements) {
      const a = objLit(el);
      if (!a) continue;
      actions.push({
        name: strOf(propByName(a, 'name')),
        label: strOf(propByName(a, 'label')),
        description: strOf(propByName(a, 'description')),
        confirmText: strOf(propByName(a, 'confirmText')),
        successMessage: strOf(propByName(a, 'successMessage')),
        line: lineOf(el),
      });
    }
  }

  return { name, file: rel(file), fields, actions };
}

// ---------------------------------------------------------------------------
// PART C implementation — read-detection (the part that does NOT hold)
// ---------------------------------------------------------------------------

const isTsSource = (p) => /\.(ts|tsx|mts)$/.test(p) && !/\.d\.ts$/.test(p);
const isTestLike = (p) =>
  /\.(test|spec)\.tsx?$/.test(p) || /\/__tests__\//.test(p) ||
  /\/packages\/qa\//.test(p) || /\.dogfood\./.test(p);
const isDeclaration = (p) => p.endsWith('.object.ts');

function buildCorpus() {
  const all = [
    ...walk(join(ROOT, 'packages'), isTsSource),
    ...walk(join(ROOT, 'apps'), isTsSource),
    ...walk(join(ROOT, 'examples'), isTsSource),
  ];
  return {
    all,
    runtime: all.filter((p) => !isTestLike(p) && !isDeclaration(p)),
  };
}

/**
 * Blank out comments while preserving byte offsets. A doc comment is prose, not
 * a read — and this distinction is load-bearing here: `row-active.ts`, the ONE
 * predicate that reads `sys_permission_set.active`, names the object only in
 * its JSDoc. Object-scoping that counts comments is therefore counting an
 * English sentence as evidence of a call graph.
 */
const codeCache = new Map();
function codeOf(file) {
  const hit = codeCache.get(file);
  if (hit) return hit;
  const full = readFileSync(file, 'utf8');
  const out = { full, code: stripNonTokens(full, file) };
  codeCache.set(file, out);
  return out;
}

/**
 * Blank every byte that is not part of a real token, preserving offsets.
 *
 * PARSER-driven on purpose. The obvious implementation — `ts.createScanner` in
 * a loop, blanking `SingleLine`/`MultiLineCommentTrivia` — is what this started
 * as, and it is WRONG on real files: a standalone scanner has no parser to tell
 * it whether `/` opens a regex or a division, so one ambiguous token desyncs it
 * and every later comment is emitted as something else. Measured here: it left
 * `bootstrap-platform-admin.ts`'s line-93 JSDoc intact, which then scored as a
 * code-level "read" of `sys_permission_set.active` — a prose backtick counted
 * as a call graph, the exact substitution this whole measurement is about.
 *
 * Walking the parsed tree's leaf tokens has no such ambiguity: whatever is not
 * inside a token is trivia, and blanking trivia blanks comments exactly — with
 * ONE correction that also had to be measured rather than assumed. `getChildren()`
 * exposes JSDoc as child NODES, so a naive leaf walk keeps every `/** … *\/`
 * block and reproduces the same bug through a different door. JSDoc kinds are
 * skipped explicitly below.
 */
function stripNonTokens(text, file) {
  const src = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const keep = new Uint8Array(text.length);
  (function visit(node) {
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return;
    if (node.getChildCount(src) === 0) {
      const start = node.getStart(src);
      for (let i = start; i < node.getEnd(); i++) keep[i] = 1;
      return;
    }
    for (const child of node.getChildren(src)) visit(child);
  })(src);
  const chars = [...text];
  for (let i = 0; i < chars.length; i++) if (!keep[i] && chars[i] !== '\n') chars[i] = ' ';
  return chars.join('');
}

/** The three read shapes a platform-object column can plausibly take in source. */
function readShaped(code, key) {
  const k = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (
    new RegExp(`\\.${k}\\b`).test(code) ||               // row.active
    new RegExp(`\\[\\s*['"\`]${k}['"\`]\\s*\\]`).test(code) || // row['active']
    new RegExp(`['"\`]${k}['"\`]`).test(code)            // 'active' as a projection / where key
  );
}

/**
 * Score one declared key under three scopings, from widest to narrowest.
 *   anywhere    — the token appears anywhere in runtime source
 *   scoped      — …in a file that also mentions the object name (comments count)
 *   scopedCode  — …in a file that mentions the object name in CODE
 */
function scoreKey(runtime, objectName, key, exclude = new Set()) {
  const anywhere = [], scoped = [], scopedCode = [];
  for (const p of runtime) {
    if (exclude.has(rel(p))) continue;
    const { full, code } = codeOf(p);
    if (!readShaped(code, key)) continue;
    anywhere.push(rel(p));
    if (full.includes(objectName)) scoped.push(rel(p));
    if (code.includes(objectName)) scopedCode.push(rel(p));
  }
  return { anywhere, scoped, scopedCode };
}

// ---------------------------------------------------------------------------
// PART C' — the action-text half ("does this prose promise enforcement?")
// ---------------------------------------------------------------------------

/**
 * A keyword oracle over an action's author-visible prose. This is the half the
 * card flagged as most likely to defeat mechanization, and it does — see
 * `ACTION_GROUND_TRUTH`: on nine real actions it inverts on the one whose text
 * DENIES an enforcement effect, because keyword matching has no negation.
 */
const ENFORCEMENT_WORDS = [
  'grant', 'granting', 'grants', 'access', 'permission', 'permissions',
  'authoriz', 'enforce', 'revoke', 'deny', 'denies', 'privilege', 'entitle',
];

function promisesEnforcement(action) {
  const prose = [action.label, action.description, action.confirmText, action.successMessage]
    .filter(Boolean).join(' ').toLowerCase();
  const hits = ENFORCEMENT_WORDS.filter((w) => prose.includes(w));
  return { flagged: hits.length > 0, hits, prose, hasProse: Boolean(action.confirmText || action.description) };
}

/**
 * Hand-labelled truth for the nine declared actions on the security objects, so
 * the keyword oracle's precision is MEASURED rather than asserted. `expected`
 * answers: does this action's own prose promise an enforcement effect?
 */
const ACTION_GROUND_TRUTH = {
  'sys_capability.activate_capability': { expected: false, why: 'label + "Capability activated" only; no effect claimed' },
  'sys_capability.deactivate_capability': { expected: false, why: 'the confirm text DENIES an enforcement effect verbatim ("Authorization is NOT affected") — #8535 withdrew the old promise' },
  'sys_permission_set.activate_permission_set': { expected: false, why: 'label + "Permission set activated" only' },
  'sys_permission_set.deactivate_permission_set': { expected: true, why: '"stop granting access until re-activated"' },
  'sys_permission_set.clone_permission_set': { expected: false, why: 'a copy operation' },
  'sys_position.activate_position': { expected: false, why: 'label + "Position activated" only' },
  'sys_position.deactivate_position': { expected: true, why: '"stops granting permissions until re-activated"' },
  'sys_position.set_default_position': { expected: false, why: 'defaulting for new users, not an enforcement boundary' },
  'sys_position.clone_position': { expected: false, why: 'a copy operation' },
};

// ---------------------------------------------------------------------------
// CALIBRATION — the ablation the ruling asks for
// ---------------------------------------------------------------------------

/**
 * Ground-truth instances from #8894, each with the COMPLETE set of files that
 * genuinely read the key today. Ablating them reconstructs the key's inert
 * state without needing a historical checkout — necessary here, because this
 * repo's git history is shallow: its root commit already contains #8613, so the
 * pre-enforcement tree cannot be checked out at all.
 *
 * ⚠ Each seam is HAND-ADJUDICATED, one file at a time, and the `via` note says
 * what the read is. That work is the calibration; a seam guessed from the
 * oracle's own output would only prove the oracle agrees with itself. The first
 * pass of this table WAS under-specified — it omitted `approval-service.ts` for
 * `sys_position.active` and five real readers for `valid_until`, which turned
 * genuine readers into fake "false signals" and overstated the failure. Fixing
 * that moved the score from 3-missed to 2-missed. Re-adjudicate before trusting
 * any future change to it.
 *
 * The test an oracle must pass: with the seam ablated, the key must go RED. A
 * key that still scores as READ while inert is a key the oracle would never
 * have caught in the state the class is defined by.
 */
const CALIBRATION = [
  {
    key: 'sys_permission_set.active',
    origin: '#8613 — inert for its whole pre-#8613 life; the Deactivate dialog promised access stops and nothing read the column',
    seam: [
      ['packages/core/src/security/row-active.ts', 'isRowActive — `row.active`, the ONE predicate'],
      ['packages/core/src/security/resolve-authz-context.ts', 'step 6b isRowActive filter — carries NO `active` token, invisible to the oracle'],
      ['packages/core/src/security/admin-standing-surface.ts', "'active' in PERMISSION_SET_STANDING_KEYS (#8734)"],
      ['packages/plugins/plugin-security/src/security-plugin.ts', 'dbLoader isRowActive — also token-free'],
      ['packages/plugins/plugin-auth/src/last-admin-guard.ts', 'isRowActive in the break-glass guard'],
      ['packages/plugins/plugin-sharing/src/sharing-rule-service.ts', '`row.active !== false` (#8710)'],
    ],
  },
  {
    key: 'sys_position.active',
    origin: '#8613 — the same defect on the sibling grant catalogue',
    seam: [
      ['packages/core/src/security/row-active.ts', 'isRowActive'],
      ['packages/core/src/security/resolve-authz-context.ts', 'step 6a isRowActive filter — token-free'],
      ['packages/core/src/security/admin-standing-surface.ts', 'standing-key list'],
      ['packages/plugins/plugin-security/src/security-plugin.ts', 'dbLoader'],
      ['packages/plugins/plugin-auth/src/last-admin-guard.ts', 'break-glass guard'],
      ['packages/plugins/plugin-sharing/src/sharing-rule-service.ts', 'sharing gate (#8710)'],
      ['packages/plugins/plugin-approvals/src/approval-service.ts', "projects `fields: ['id','active']` and drops `seedRow.active === false`"],
    ],
  },
  {
    key: 'sys_user_permission_set.valid_from',
    origin: '#8811 / ADR-0091 validity windows — the second instance named in #8894',
    seam: [
      ['packages/core/src/security/grant-validity.ts', 'isGrantActive — the window predicate'],
      ['packages/core/src/security/resolve-authz-context.ts', 'step 6 call site'],
      ['packages/core/src/security/admin-standing-surface.ts', 'standing-key list'],
      ['packages/plugins/plugin-auth/src/last-admin-guard.ts', 'break-glass guard'],
    ],
  },
  {
    key: 'sys_user_position.valid_until',
    origin: '#8811 / ADR-0091 validity windows — the widest-read of the four',
    seam: [
      ['packages/core/src/security/grant-validity.ts', 'isGrantActive'],
      ['packages/core/src/security/resolve-authz-context.ts', 'step 4 call site'],
      ['packages/core/src/security/admin-standing-surface.ts', 'standing-key list'],
      ['packages/plugins/plugin-auth/src/last-admin-guard.ts', 'break-glass guard'],
      ['packages/lint/src/validate-security-posture.ts', '`rec.valid_until` — authoring-time D2 check'],
      ['packages/plugins/plugin-approvals/src/approval-service.ts', 'projects and compares `valid_until`'],
      ['packages/plugins/plugin-security/src/delegated-admin-gate.ts', '`row?.valid_until` ceiling check (D3)'],
      ['packages/plugins/plugin-security/src/explain-engine.ts', '`r?.valid_until` — the expiry the panel prints'],
      ['packages/plugins/plugin-sharing/src/position-graph.ts', "projects `fields: [… 'valid_until']`"],
    ],
  },
];

/**
 * Framework-managed columns every object carries. NOT security keys: the engine
 * writes them generically and no ADR-0049 promise attaches. Reported separately
 * so they never inflate either the red set or the clean set.
 */
const FRAMEWORK_COLUMNS = new Set(['id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'organization_id']);

/**
 * HAND-ADJUDICATED verdict for every key Part C flags red under the narrowest
 * scoping. This is the false-positive surface the promotion decision turns on,
 * and the ruling asked for it MEASURED, so each row was settled by reading the
 * code — not by re-running the oracle.
 *
 *   true-positive  — genuinely declared with no runtime read
 *   false-positive — the oracle is wrong: something does read it, or it is not
 *                    a security key at all (write-only provenance/telemetry
 *                    that promises no enforcement boundary)
 */
const RED_SET_ADJUDICATION = {
  'sys_user_permission_set.last_certified_at': { truePositive: true, why: 'ADR-0091 D5 recertification attestation. Zero occurrences anywhere in packages/apps/examples outside the declaration and the generated i18n bundles — never written, never read.' },
  'sys_user_permission_set.certified_by': { truePositive: true, why: 'same — the D5 reviewer pointer has no producer and no consumer' },
  'sys_user_position.last_certified_at': { truePositive: true, why: 'same defect on the sibling grant table' },
  'sys_user_position.certified_by': { truePositive: true, why: 'same' },
  'sys_capability.active': { truePositive: true, why: 'genuinely unenforced — but ALREADY adjudicated: the maintainer ruled 2026-08-13 (#8535) that enforcement is not the answer and the Deactivate prose was rewritten to state the non-effect. Under a ratchet this is not a finding, it is a row needing a named exemption.' },
  'sys_record_share.granted_by': { truePositive: false, why: 'READ at runtime — sharing-plugin.ts:873 filters `{ $or: [{ recipient_id: … }, { granted_by: exec.userId }] }`, deciding which shares a caller may see. The oracle cannot see it because the read is an UNQUOTED object-literal key in a where clause, which none of its three patterns match.' },
  'sys_audience_binding_suggestion.resolved_by': { truePositive: false, why: 'written at suggested-audience-bindings.ts:687,721 as an object-literal key; workflow provenance, not an enforcement boundary. The oracle misses the write for the same reason it misses `granted_by`\'s read.' },
  'sys_audience_binding_suggestion.resolved_at': { truePositive: false, why: 'written at suggested-audience-bindings.ts:342,377,688,722; same shape' },
  'sys_share_link.last_used_at': { truePositive: false, why: 'written at share-link-service.ts:492,621 (the redemption touch); admin-facing telemetry, promises no boundary' },
};

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

function measure({ includeIdentity }) {
  const { names } = readSecurityObjectNames({ includeIdentity });
  const all = enumerateObjects();
  const byName = new Map(all.map((o) => [o.name, o]));
  const objects = names.map((n) => byName.get(n)).filter(Boolean);
  const missing = names.filter((n) => !byName.has(n));
  const { all: allFiles, runtime } = buildCorpus();

  const keys = [];
  for (const o of objects) {
    for (const f of o.fields) {
      const s = scoreKey(runtime, o.name, f.key);
      keys.push({ object: o.name, ...f, framework: FRAMEWORK_COLUMNS.has(f.key), score: s });
    }
  }
  return { names, objects, missing, allFiles, runtime, keys };
}

function main() {
  const argv = process.argv.slice(2);
  const has = (f) => argv.includes(f);
  if (has('--self-test')) return selfTest();

  const includeIdentity = has('--include-identity');
  const m = measure({ includeIdentity });
  const { objects, missing, allFiles, runtime, keys } = m;

  if (has('--json')) {
    console.log(JSON.stringify({
      objects: objects.map((o) => ({ name: o.name, file: o.file, fields: o.fields.length, actions: o.actions.length })),
      keys: keys.map((k) => ({
        object: k.object, key: k.key, framework: k.framework,
        anywhere: k.score.anywhere.length, scoped: k.score.scoped.length, scopedCode: k.score.scopedCode.length,
      })),
    }, null, 2));
    return;
  }

  const line = (s = '') => console.log(s);
  line('declared-security-key oracle — MEASUREMENT ONLY, not a gate (#8894)');
  line('='.repeat(78));
  line();
  line(`corpus: ${allFiles.length} TypeScript files, ${runtime.length} runtime (non-test, non-declaration)`);
  line();

  // ---- Part A + B ---------------------------------------------------------
  line('PART A+B — enumeration (MECHANICAL)');
  line('-'.repeat(78));
  line(`security packages: ${SECURITY_PACKAGES.join(', ')}${includeIdentity ? ' + hand-picked identity objects' : ''}`);
  if (missing.length) line(`⚠ registered but no ObjectSchema.create found: ${missing.join(', ')}`);
  const fieldCount = objects.reduce((n, o) => n + o.fields.length, 0);
  const actionCount = objects.reduce((n, o) => n + o.actions.length, 0);
  line(`objects: ${objects.length}   declared field keys: ${fieldCount}   declared actions: ${actionCount}`);
  const security = keys.filter((k) => !k.framework);
  line(`of the ${fieldCount} field keys, ${keys.length - security.length} are framework columns (${[...FRAMEWORK_COLUMNS].join(', ')}) ⇒ ${security.length} candidate security keys`);
  line();

  // ---- Part C -------------------------------------------------------------
  line('PART C — read-detection (NOT MECHANICAL — reported so the failure is measured)');
  line('-'.repeat(78));
  for (const mode of ['anywhere', 'scoped', 'scopedCode']) {
    const red = security.filter((k) => k.score[mode].length === 0);
    line(`${mode.padEnd(11)} would-be RED: ${String(red.length).padStart(3)}/${security.length}`);
    for (const r of red) line(`                 · ${r.object}.${r.key}`);
  }
  line();
  const narrow = security.filter((k) => k.score.scopedCode.length === 0);
  line('false-positive surface of that red set, HAND-ADJUDICATED (the number promotion turns on):');
  let tpN = 0, fpN = 0, unjudged = 0;
  for (const k of narrow) {
    const id = `${k.object}.${k.key}`;
    const v = RED_SET_ADJUDICATION[id];
    if (!v) { unjudged++; line(`  ?  ${id} — NOT ADJUDICATED; the red set moved, re-read the code`); continue; }
    v.truePositive ? tpN++ : fpN++;
    line(`  ${v.truePositive ? 'TP' : 'FP'} ${id}`);
    line(`     ${v.why}`);
  }
  line(`  ⇒ true positives ${tpN}/${narrow.length}, FALSE POSITIVES ${fpN}/${narrow.length}` +
       (narrow.length ? ` (${Math.round((fpN / narrow.length) * 100)}%)` : '') +
       (unjudged ? `, ${unjudged} unadjudicated` : ''));
  const stale = Object.keys(RED_SET_ADJUDICATION).filter((id) => !narrow.some((k) => `${k.object}.${k.key}` === id));
  if (stale.length) line(`  ⚠ adjudicated rows no longer red (stale, re-check): ${stale.join(', ')}`);
  line();

  // ---- the card's LITERAL design, which is a different proposal -----------
  line('DESIGN 1 — the card\'s literal proposal: enumerate + require a HUMAN claim');
  line('-'.repeat(78));
  line('  #8894 proposes "every enumerated declared key must be claimed by a matrix row or a');
  line('  named exemption". That design contains NO automatic read-detection — it is the shape');
  line('  packages/spec/liveness/ already uses for spec schema properties. Measured separately,');
  line('  because it succeeds and fails for entirely different reasons than Part C.');
  line();
  line(`  · mechanizable? YES — it needs only Parts A+B, which hold.`);
  line(`  · would-be red set at landing: ${security.length}/${security.length} security keys (${keys.length} incl. framework columns).`);
  line('    No ledger for platform-object ROW columns exists, so every key is unclaimed on day one.');
  line('  · does it catch the ground truth? YES, by construction — an unclaimed key is red, so');
  line(`    ${CALIBRATION.length}/${CALIBRATION.length} instances are caught while inert, including the two Part C misses.`);
  line('  · what it costs: 88 human verdicts with evidence, then per-key maintenance forever.');
  line('  · what it cannot do: make those verdicts true. The sibling ledger measured its own');
  line('    human-verdict error rate at 10 wrong out of 13 re-verified entries (77%), and');
  line('    `sys_capability.active` is the local proof — its Deactivate prose ASSERTED enforcement');
  line('    that never existed, so a ledger row written from the declaration would have said "live".');
  line();

  line('per-key evidence counts (security keys only):');
  const w = Math.max(...security.map((k) => k.object.length)) + 2;
  line(`  ${'object'.padEnd(w)}${'key'.padEnd(22)}${'anywhere'.padEnd(10)}${'scoped'.padEnd(8)}scopedCode`);
  for (const k of security) {
    line(`  ${k.object.padEnd(w)}${k.key.padEnd(22)}${String(k.score.anywhere.length).padEnd(10)}${String(k.score.scoped.length).padEnd(8)}${k.score.scopedCode.length}`);
  }
  line();

  // ---- calibration --------------------------------------------------------
  line('CALIBRATION — ablate the enforcement seam, demand the key goes RED');
  line('-'.repeat(78));
  let failures = 0;
  for (const c of CALIBRATION) {
    const [objName, keyName] = [c.key.slice(0, c.key.lastIndexOf('.')), c.key.slice(c.key.lastIndexOf('.') + 1)];
    const seamFiles = c.seam.map(([f]) => f);
    const missingSeam = seamFiles.filter((f) => !runtime.some((p) => rel(p) === f));
    const exclude = new Set(seamFiles);
    const before = scoreKey(runtime, objName, keyName);
    const after = scoreKey(runtime, objName, keyName, exclude);
    const pass = after.scopedCode.length === 0 && after.scoped.length === 0;
    if (!pass) failures++;
    line(`${pass ? '✓ DETECTS' : '✗ MISSES '}  ${c.key}`);
    line(`            ${c.origin}`);
    if (missingSeam.length) line(`            ⚠ seam file(s) no longer in the corpus — re-adjudicate: ${missingSeam.join(', ')}`);
    line(`            live now:  anywhere=${before.anywhere.length} scoped=${before.scoped.length} scopedCode=${before.scopedCode.length}`);
    line(`            ablated (${seamFiles.length} real readers removed): anywhere=${after.anywhere.length} scoped=${after.scoped.length} scopedCode=${after.scopedCode.length}`);
    if (!pass) {
      line('            residual score while the key is INERT — none of these reads the key:');
      for (const f of after.scoped) line(`              · ${f}`);
    }
  }
  line();
  line(failures === 0
    ? 'calibration: all instances detected.'
    : `calibration: ${failures}/${CALIBRATION.length} ground-truth instances MISSED ⇒ Part C does not detect the ADR-0049 class.`);
  line();

  // ---- action half --------------------------------------------------------
  line("PART C' — action prose (\"does this text promise an enforcement effect?\")");
  line('-'.repeat(78));
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const o of objects) {
    for (const a of o.actions) {
      const id = `${o.name}.${a.name}`;
      const r = promisesEnforcement(a);
      const truth = ACTION_GROUND_TRUTH[id];
      if (!truth) { line(`  ? ${id} — no hand label; keyword oracle says ${r.flagged}`); continue; }
      const verdict = r.flagged === truth.expected ? 'ok' : (r.flagged ? 'FALSE POSITIVE' : 'FALSE NEGATIVE');
      if (r.flagged && truth.expected) tp++;
      else if (r.flagged && !truth.expected) fp++;
      else if (!r.flagged && truth.expected) fn++;
      else tn++;
      line(`  ${verdict === 'ok' ? '  ' : '!!'} ${id.padEnd(46)} oracle=${String(r.flagged).padEnd(5)} truth=${String(truth.expected).padEnd(5)} ${verdict}`);
      if (verdict !== 'ok') line(`       why: ${truth.why}`);
      if (verdict !== 'ok') line(`       matched words: ${r.hits.join(', ') || '(none)'}`);
    }
  }
  const labelled = tp + fp + fn + tn;
  line();
  line(`  labelled actions: ${labelled}   TP=${tp} FP=${fp} FN=${fn} TN=${tn}`);
  line(`  precision: ${tp + fp === 0 ? 'n/a' : `${tp}/${tp + fp}`}   recall: ${tp + fn === 0 ? 'n/a' : `${tp}/${tp + fn}`}`);
  const proseBearing = objects.flatMap((o) => o.actions).filter((a) => a.confirmText || a.description).length;
  line(`  actions carrying prose beyond a one-word label: ${proseBearing}/${actionCount} — the rest have no text to read at all`);
  line();
  line('  ⛔ The false positives are two distinct prose failures, neither tunable away:');
  line('     · NEGATION — `deactivate_capability`\'s confirm text says "Authorization is NOT');
  line('       affected". Keyword matching has no negation, so the one action whose prose was');
  line('       DELIBERATELY rewritten (#8535) to WITHDRAW a false promise is flagged as making');
  line('       one. Reading English for a promise is the half that defeats mechanization, and');
  line('       this is the shape it takes.');
  line('     · THE OBJECT\'S OWN NOUN — "Permission set activated" / "New permission set"');
  line('       contain "permission" because the object is called a permission set, not because');
  line('       the action claims anything. Every security object leaks its own domain vocabulary');
  line('       into every one of its action strings, so the signal is inseparable from the noise.');
  line();

  line('VERDICT: Parts A+B are mechanical and reusable. Part C and C\' are not gate-grade.');
  line('         See this file\'s header. ⛔ Do not wire this into check:* without a ruling.');
}

// ---------------------------------------------------------------------------
// self-test — pure assertions, no repo scan
// ---------------------------------------------------------------------------

function selfTest() {
  const fails = [];
  const eq = (a, b, what) => { if (a !== b) fails.push(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

  eq(readShaped("const x = row.active;", 'active'), true, 'readShaped property access');
  eq(readShaped("row['active']", 'active'), true, 'readShaped index access');
  eq(readShaped("select: ['active']", 'active'), true, 'readShaped string literal');
  eq(readShaped('const inactive = 1;', 'active'), false, 'readShaped must not match a substring');
  eq(readShaped('isRowActive(r)', 'active'), false, 'readShaped must not match the indirected predicate — this is the measured blind spot');
  eq(readShaped('const valid_from_x = 1;', 'valid_from'), false, 'readShaped underscore boundary');

  const stripped = (() => {
    const f = join(ROOT, 'package.json');
    void f;
    return null;
  })();
  void stripped;

  eq(promisesEnforcement({ label: 'Deactivate', confirmText: 'stop granting access' }).flagged, true, 'action oracle flags a grant promise');
  eq(promisesEnforcement({ label: 'Clone', successMessage: 'Cloned' }).flagged, false, 'action oracle ignores a copy operation');
  eq(promisesEnforcement({ label: 'Deactivate', confirmText: 'Authorization is NOT affected.' }).flagged, true,
     'action oracle INVERTS on negation — asserted so the defect cannot be silently "fixed" away');

  eq(Object.keys(ACTION_GROUND_TRUTH).length, 9, 'hand-labelled action count');
  eq(CALIBRATION.length, 4, 'calibration instance count');
  eq(SECURITY_PACKAGES.length, 2, 'security package count');

  if (fails.length) {
    console.error('self-test FAILED:');
    for (const f of fails) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log(`self-test OK (${9} action labels, ${CALIBRATION.length} calibration instances)`);
}

main();
