#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Dispatcher error-code vocabulary gate (#8087, ADR-0112).
 *
 *   node scripts/check-dispatcher-error-vocabulary.mjs
 *   node scripts/check-dispatcher-error-vocabulary.mjs --self-test
 *   node scripts/check-dispatcher-error-vocabulary.mjs --report   # print the derivation
 *
 * ## What it guards
 *
 * `ApiErrorSchema.code` parses against `ErrorCode` = `StandardErrorCode` ∪
 * `ERROR_CODE_LEDGER`, and the ledger's own note says an unregistered code
 * "fails schema parse — which fails the envelope conformance suites — which
 * fails CI. That friction is the point."
 *
 * The dispatcher door had no such friction. `HttpDispatcher.errorFromThrown`
 * puts `resolveThrownHttpError(e).declaredCode` — the producer's own string,
 * un-narrowed — into `error.code`, and its conformance suite parsed only the
 * handful of cases it drove. Three suites pinned bodies `ApiErrorSchema` would
 * reject and CI stayed green.
 *
 * The maintainer ruling of 2026-08-12 chose option B **delivered as a gate**:
 * parse every body the door emits, then register what the gate reports. This is
 * the finding half. `packages/runtime/src/dispatcher-error-vocabulary.ts` is the
 * declaration half; `error-envelope.conformance.test.ts` drives every code this
 * gate classifies as dispatcher-reachable through the real builder and parses
 * the body.
 *
 * ## Why a scan plus a declared table, rather than either alone
 *
 * A scan alone cannot answer the question that matters. Whether a stamped code
 * reaches an HTTP response envelope is REACHABILITY, and the two ends of that
 * question are written identically in source: `MEMORY_MULTI_TENANT_UNSUPPORTED`
 * and `FLOW_FAILED` are both `code` on a thrown value, and one of them is a boot
 * refusal the CLI rethrows before any HTTP boundary exists. Inferring a default
 * for an unknown site is exactly how a real emitter hides.
 *
 * A table alone is a snapshot that starts decaying the moment it lands — the
 * card's own objection to a one-time sweep ("an unswept producer just re-opens
 * the hole").
 *
 * So: the scan finds sites, the table records verdicts with evidence, and the
 * two are reconciled in BOTH directions. A site the table does not carry fails.
 * A table row whose site is gone fails. A `pending-registration` row whose code
 * has since been registered fails — which is how #8846 landing ratchets this
 * list down instead of leaving stale rows promising work already done.
 *
 * ## Why textual, not AST
 *
 * The same reasoning `check-error-code-casing` records: the failure mode is a
 * string literal in one of a handful of syntactic positions, and the positions
 * are more varied than an AST shape for "the value of an error's code property"
 * would cover (class field, constructor-side object literal, post-hoc
 * assignment, a constant one module over). The four shapes below are published
 * rather than left inside the implementation, and `--self-test` pins each one —
 * because the price of a source scan is that it sees only the spellings it
 * knows, and an unrecognised one produces no finding, SILENTLY. Reaching for a
 * spelling that is not here? Extend `SHAPES` and add a `--self-test` case in the
 * same edit.
 *
 * ## Declared bounds — printed on every run, so a partial gate cannot read as a
 * ## complete one
 *
 *   - Scanned: `packages/**` non-test TypeScript source. Not `apps/`, not
 *     `examples/`, not tests — a test that CONSTRUCTS a code is not a producer
 *     (the ledger's own rule, and #4984's phantom-check family).
 *   - Reported: only codes the registered vocabulary does NOT contain. A
 *     registered code is by construction parseable, whatever door it reaches.
 *   - Only SCREAMING_SNAKE literals. Lowercase code literals are a different
 *     defect with its own gate (`check:error-code-casing`, ADR-0112 D6/D6b/D6c).
 *   - A constant this gate cannot resolve is REPORTED as unresolved, never
 *     dropped: a deriver that goes quietly blind is the same failure one layer
 *     down.
 *   - The sandbox limb is OUT of this scan's reach by construction — a metadata
 *     app's action code is authored at runtime, not in this repo. See
 *     `SANDBOX_AUTHORED_LIMB` in the declaration file.
 *   - [#9098] The scan answers "is this code registered", never "could an
 *     unregistered one be written here tomorrow". The second question is the
 *     DOOR TYPING half — see `checkDoorTyping` below, which is structural
 *     rather than vocabulary and is why this gate's name now undersells it: it
 *     guards both HTTP doors, not only the dispatcher.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const SCAN_ROOT = 'packages';
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.turbo', 'coverage', 'build']);

const LEDGER_ZOD = 'packages/spec/src/api/error-code-ledger.zod.ts';
const ERRORS_ZOD = 'packages/spec/src/api/errors.zod.ts';
const DECLARATION = 'packages/runtime/src/dispatcher-error-vocabulary.ts';

// ---------------------------------------------------------------------------
// The registered vocabulary — read from spec SOURCE, never from a build
// ---------------------------------------------------------------------------

/**
 * `ERROR_CODE_LEDGER`'s members. Anchored on the declaration and its
 * `} as const` terminator rather than scanning the whole file, so the prose
 * above it (which quotes retired codes by name) cannot leak in.
 */
export function parseLedgerCodes(source) {
  const start = source.indexOf('export const ERROR_CODE_LEDGER');
  if (start < 0) throw new Error(`${LEDGER_ZOD}: ERROR_CODE_LEDGER not found — the deriver's anchor moved.`);
  const body = source.slice(start);
  const end = body.indexOf('\n} as const');
  if (end < 0) throw new Error(`${LEDGER_ZOD}: ERROR_CODE_LEDGER terminator not found — the deriver's anchor moved.`);
  return new Set([...body.slice(0, end).matchAll(/'([A-Z][A-Z0-9_]*)'/g)].map((m) => m[1]));
}

/** `StandardErrorCode`'s members. */
export function parseStandardCodes(source) {
  const block = /export const StandardErrorCode = z\.enum\(\[([\s\S]*?)\]\)/.exec(source);
  if (!block) throw new Error(`${ERRORS_ZOD}: StandardErrorCode enum not found — the deriver's anchor moved.`);
  return new Set([...block[1].matchAll(/'([A-Z][A-Z0-9_]*)'/g)].map((m) => m[1]));
}

// ---------------------------------------------------------------------------
// The scan
// ---------------------------------------------------------------------------

/** Comments stripped: prose naming a retired code is not a producer. */
export function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * The recognised ways this repo stamps a semantic code onto a value.
 * PUBLISHED, and each pinned by `--self-test`. See the header on why.
 */
export const SHAPES = [
  // `err.code = 'X'` — stamped onto a value about to be thrown.
  { name: 'assign', re: /(?:^|[^\w.$])[\w$]+\.code\s*=\s*'([A-Za-z][A-Za-z0-9_]*)'/g, literal: true },
  // `readonly code = 'X'` / `readonly code: T = 'X'` — an error class's identity.
  { name: 'classfield', re: /\breadonly\s+code\s*(?::[^=;\n]+)?=\s*'([A-Za-z][A-Za-z0-9_]*)'/g, literal: true },
  // `readonly code = CONST` — the same, one indirection away.
  { name: 'classconst', re: /\breadonly\s+code\s*(?::[^=;\n]+)?=\s*([A-Z][A-Z0-9_]*)\s*[;,\n]/g, literal: false },
  // `code: 'X'` in an object literal (constructor options, Object.assign, a
  // returned envelope). The broadest shape, and the reason verdicts exist:
  // plenty of these are not wire codes at all.
  { name: 'objlit', re: /\bcode:\s*'([A-Za-z][A-Za-z0-9_]*)'/g, literal: true },
];

const isTestFile = (rel) =>
  /\.(test|spec)\.[cm]?tsx?$/.test(rel) || /(^|\/)(__tests__|__mocks__|fixtures)\//.test(rel);

/**
 * The declaration file is a TABLE ABOUT producers, not a producer: every row
 * spells `code: 'X'` for a code stamped somewhere else, so scanning it makes the
 * gate rediscover its own contents as thirteen brand-new findings in the file
 * that classifies them. Excluded by path, and pinned by `--self-test` so the
 * exclusion cannot be widened into a blanket ignore that hides a real emitter.
 */
const isDeclarationFile = (rel) => rel === DECLARATION;

export function* walkSources(dir, root) {
  for (const entry of readdirSync(dir).sort()) {
    if (SKIP_DIRS.has(entry)) continue;
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) {
      yield* walkSources(abs, root);
      continue;
    }
    if (!/\.[cm]?tsx?$/.test(entry) || /\.d\.[cm]?ts$/.test(entry)) continue;
    const rel = relative(root, abs).replace(/\\/g, '/');
    if (isTestFile(rel) || isDeclarationFile(rel)) continue;
    yield { rel, abs };
  }
}

/**
 * Resolve `NAME` to its string value: the declaring file first, then the module
 * it is imported from. Two packages export a `MULTI_TENANT_UNSUPPORTED_CODE`
 * with DIFFERENT values, so a repo-wide name lookup would answer confidently
 * and wrongly — the in-file declaration has to win, and the import has to be
 * followed to its own file rather than guessed.
 *
 * Returns `null` when it cannot be resolved; the caller reports that, never
 * drops it.
 */
export function resolveConstant(name, fileSource, fileRel, readFile) {
  const local = new RegExp(`\\b(?:export\\s+)?const\\s+${name}\\s*(?::[^=]+)?=\\s*'([A-Za-z][A-Za-z0-9_]*)'`).exec(
    fileSource,
  );
  if (local) return local[1];

  // `import { A, NAME, B } from './x.js'` — find the specifier that names it.
  const imports = [...fileSource.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*'([^']+)'/g)];
  for (const [, clause, spec] of imports) {
    const named = clause.split(',').map((s) => s.trim().split(/\s+as\s+/)[0].trim());
    if (!named.includes(name)) continue;
    if (!spec.startsWith('.')) return null; // a dependency's constant — out of scan reach
    const base = join(dirname(fileRel), spec.replace(/\.[cm]?js$/, ''));
    for (const cand of [`${base}.ts`, `${base}.mts`, `${base}/index.ts`]) {
      const abs = join(ROOT, cand);
      if (!existsSync(abs)) continue;
      const target = stripComments(readFile(abs));
      const hit = new RegExp(
        `\\bexport\\s+const\\s+${name}\\s*(?::[^=]+)?=\\s*'([A-Za-z][A-Za-z0-9_]*)'`,
      ).exec(target);
      if (hit) return hit[1];
    }
    return null;
  }
  return null;
}

/**
 * Every site in scanned source that stamps a code the registered vocabulary
 * does not contain.
 */
export function deriveSites({ registered, files, readFile }) {
  const sites = [];
  const unresolved = [];
  for (const { rel, source } of files) {
    const stripped = stripComments(source);
    for (const shape of SHAPES) {
      shape.re.lastIndex = 0;
      for (const m of stripped.matchAll(shape.re)) {
        let code = m[1];
        if (!shape.literal) {
          const value = resolveConstant(code, stripped, rel, readFile);
          if (value === null) {
            unresolved.push({ file: rel, shape: shape.name, constant: code });
            continue;
          }
          code = value;
        }
        if (!/^[A-Z][A-Z0-9_]*$/.test(code)) continue; // lowercase → check:error-code-casing
        if (registered.has(code)) continue;
        if (sites.some((s) => s.code === code && s.file === rel && s.shape === shape.name)) continue;
        sites.push({ code, file: rel, shape: shape.name });
      }
    }
  }
  sites.sort((a, b) => a.code.localeCompare(b.code) || a.file.localeCompare(b.file));
  return { sites, unresolved };
}

// ---------------------------------------------------------------------------
// The declaration
// ---------------------------------------------------------------------------

/**
 * Read the declared table out of the TypeScript source. Textual for the same
 * reason the rest of this file is, and anchored on the array so the doc prose
 * (which names codes) cannot leak in.
 */
export function parseDeclaration(source) {
  const start = source.indexOf('export const UNREGISTERED_CODE_SITES');
  if (start < 0) throw new Error(`${DECLARATION}: UNREGISTERED_CODE_SITES not found — the anchor moved.`);
  const body = stripComments(source.slice(start));
  const end = body.indexOf('\n];');
  if (end < 0) throw new Error(`${DECLARATION}: UNREGISTERED_CODE_SITES terminator not found — the anchor moved.`);
  const rows = [];
  for (const entry of body.slice(0, end).split(/\}\s*,/)) {
    const code = /\bcode:\s*'([^']+)'/.exec(entry);
    const file = /\bfile:\s*'([^']+)'/.exec(entry);
    const shape = /\bshape:\s*'([^']+)'/.exec(entry);
    const door = /\bdoor:\s*'([^']+)'/.exec(entry);
    const verdict = /\bverdict:\s*'([^']+)'/.exec(entry);
    if (!code || !file || !shape || !door || !verdict) continue;
    rows.push({
      code: code[1],
      file: file[1],
      shape: shape[1],
      door: door[1],
      verdict: verdict[1],
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

const key = (s) => `${s.code}@${s.file}#${s.shape}`;

export function reconcile({ sites, declared, registered, unresolved }) {
  const findings = [];
  const declaredByKey = new Map(declared.map((d) => [key(d), d]));
  const siteKeys = new Set(sites.map(key));

  for (const site of sites) {
    if (declaredByKey.has(key(site))) continue;
    findings.push({
      kind: 'unclassified-site',
      text:
        `${site.file} stamps unregistered code '${site.code}' (${site.shape}) and ` +
        `${DECLARATION} does not classify it.\n` +
        `      Add a row with a verdict and its evidence. If it reaches a wire, the verdict is ` +
        `'pending-registration' and the code belongs in #8846's ledger batch.`,
    });
  }

  for (const row of declared) {
    if (!siteKeys.has(key(row))) {
      findings.push({
        kind: 'stale-row',
        text:
          `${DECLARATION} declares '${row.code}' at ${row.file} (${row.shape}) but the scan no longer ` +
          `finds it. The producer moved or went away — delete the row.`,
      });
    }
    if (row.verdict === 'pending-registration' && registered.has(row.code)) {
      findings.push({
        kind: 'now-registered',
        text:
          `'${row.code}' is registered now — the row in ${DECLARATION} has done its job and must come ` +
          `out. (This is the ratchet: #8846 landing a registration turns its row stale.)`,
      });
    }
  }

  for (const u of unresolved) {
    findings.push({
      kind: 'unresolved-constant',
      text:
        `${u.file}: the code constant '${u.constant}' (${u.shape}) could not be resolved to a literal. ` +
        `Reported rather than dropped — see the header's bounds. Resolve it, or teach ` +
        `resolveConstant() the spelling.`,
    });
  }

  findings.sort((a, b) => a.kind.localeCompare(b.kind) || a.text.localeCompare(b.text));
  return findings;
}

// ---------------------------------------------------------------------------
// The REST door's TYPING (#9098)
// ---------------------------------------------------------------------------

/**
 * [#9098] The vocabulary half of this gate answers "is this code registered".
 * It cannot answer "could an unregistered one be written here tomorrow" — and
 * that second question is what the REST door failed.
 *
 * The history, because it is the whole argument for these three assertions:
 * `packages/rest` exported a `sendError(res, error: any)` whose name collided
 * with `@objectstack/types`' strict `sendError(res, status, code: ErrorCode,
 * message)`. A cross-door parity note cited the strict one's closed parameter
 * as the reason the REST door was safe; route modules used the loose one. The
 * door read as closed for as long as anyone cared to look, and the hole was
 * eventually found by this scan (`FIELD_VISIBILITY_UNRESOLVED`) rather than by
 * the door. #9098 split the two responsibilities by name and typed the
 * author-side one.
 *
 * Typing alone does not stay put — it is three keystrokes from `any`, and the
 * scan above would go on passing because a code that IS registered is invisible
 * to it. So the structure is pinned here:
 *
 *   ① the author-side door exists and narrows `code` to the closed `ErrorCode`;
 *   ② nothing in that file re-exports the name `sendError`, so the collision
 *      that hid the hole cannot be reintroduced;
 *   ③ no author-declared literal is handed to the CLASSIFICATION door — that
 *      parameter is `any` by design (narrowing a caught error's `code` is an
 *      ADR-0112 contract decision, not this gate's), which is exactly why a
 *      decided refusal must not travel through it.
 *
 * ⛔ An anchor this cannot find is a FINDING, never a pass — the same rule the
 * header states for unresolvable constants. A structural gate that silently
 * matches nothing is the failure it exists to prevent, one layer down.
 */
export const REST_DOOR_FILE = 'packages/rest/src/error-response.ts';

/** Author-declared literal handed to the classification door. Flat object literal on purpose. */
const DECIDED_THROUGH_THROWN_RE =
  /\bsendThrownError\s*\(\s*[A-Za-z_$][\w$]*\s*,\s*\{[^{}]*\bcode\s*:\s*'([A-Za-z][A-Za-z0-9_]*)'/g;

export function checkDoorTyping({ doorSource, files }) {
  const findings = [];
  const add = (text) => findings.push({ kind: 'door-typing', text });

  if (doorSource === null || doorSource === undefined) {
    add(`${REST_DOOR_FILE} could not be read — this gate's door-typing anchor moved. ` +
        `Point REST_DOOR_FILE at the file that now owns the REST error doors.`);
    return findings;
  }
  const stripped = stripComments(doorSource);

  // ① the author-side door narrows to the closed vocabulary
  const decl = /export\s+function\s+sendDeclaredFault\s*\(([\s\S]*?)\)\s*:\s*void/.exec(stripped);
  if (!decl) {
    add(`${REST_DOOR_FILE}: no \`export function sendDeclaredFault(...): void\` found. ` +
        `That is the REST door's typed author-side responder (#9098); without it a decided ` +
        `refusal has no narrowed door and an unregistered code reaches the wire silently.`);
  } else if (!/\bcode\s*:\s*ErrorCode\b/.test(decl[1])) {
    add(`${REST_DOOR_FILE}: \`sendDeclaredFault\` no longer types its \`code\` as \`ErrorCode\`. ` +
        `The closed ADR-0112 union is the only thing making an unregistered code a BUILD failure ` +
        `at this door — widening it re-opens #9098 while every test here stays green.`);
  }

  // ② the collision that hid the hole cannot come back
  if (/export\s+(?:function|const)\s+sendError\b/.test(stripped)) {
    add(`${REST_DOOR_FILE} exports \`sendError\` again. That name belongs to the SHARED strict ` +
        `writer in \`@objectstack/types\`; a second one here is the #9098 collision, which is how ` +
        `the door's own looseness came to be documented as strictness. Name the local doors ` +
        `\`sendThrownError\` (caught values) and \`sendDeclaredFault\` (decided refusals).`);
  }

  // ③ decided refusals do not travel through the `any` door
  for (const { rel, source } of files) {
    if (!rel.startsWith('packages/rest/')) continue;
    const s = stripComments(source);
    DECIDED_THROUGH_THROWN_RE.lastIndex = 0;
    for (const m of s.matchAll(DECIDED_THROUGH_THROWN_RE)) {
      add(`${rel}: hands the author-declared code '${m[1]}' to \`sendThrownError\`, whose \`error\` ` +
          `parameter is \`any\` by design (it takes CAUGHT values). A refusal this repo decides must ` +
          `go through \`sendDeclaredFault\`, which narrows \`code\` to the closed union. Same wire ` +
          `answer, checked at compile time.`);
    }
  }

  findings.sort((a, b) => a.text.localeCompare(b.text));
  return findings;
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

function selfTest() {
  const fail = [];
  let cases = 0;
  const ok = (cond, what) => { cases += 1; if (!cond) fail.push(what); };

  // Each published SHAPE matches what it claims to.
  const samples = {
    assign: `const err = new Error('x'); err.code = 'FLOW_FAILED'; throw err;`,
    classfield: `class E extends Error { readonly code = 'ERR_X' as const; }`,
    classconst: `const ERR_CONST = 'RESOLVED_ONE';\nclass E { readonly code = ERR_CONST; }`,
    objlit: `throw Object.assign(new Error('x'), { code: 'OBJ_LIT_ONE' });`,
  };
  const registered = new Set(['ALREADY_REGISTERED']);
  for (const [name, source] of Object.entries(samples)) {
    const { sites } = deriveSites({
      registered,
      files: [{ rel: 'packages/x/src/a.ts', source }],
      readFile: () => '',
    });
    ok(sites.some((s) => s.shape === name), `SHAPE '${name}' matched nothing in its own sample`);
  }

  // A resolved constant reports its VALUE, not the constant's name.
  {
    const { sites } = deriveSites({
      registered,
      files: [{ rel: 'packages/x/src/a.ts', source: samples.classconst }],
      readFile: () => '',
    });
    ok(
      sites.some((s) => s.code === 'RESOLVED_ONE'),
      'classconst resolved to the constant name instead of its value',
    );
  }

  // The in-file declaration WINS over an import of the same name — the
  // two-drivers-one-constant-name case that a repo-wide lookup gets wrong.
  {
    const source = `import { MULTI_TENANT_UNSUPPORTED_CODE } from './other.js';\nexport const MULTI_TENANT_UNSUPPORTED_CODE = 'MEMORY_ONE';\nclass G { readonly code = MULTI_TENANT_UNSUPPORTED_CODE; }`;
    const { sites } = deriveSites({
      registered,
      files: [{ rel: 'packages/x/src/a.ts', source }],
      readFile: () => `export const MULTI_TENANT_UNSUPPORTED_CODE = 'MONGO_ONE';`,
    });
    ok(sites.some((s) => s.code === 'MEMORY_ONE'), 'in-file constant did not win over the imported one');
    ok(!sites.some((s) => s.code === 'MONGO_ONE'), 'resolved through the import when a local declaration existed');
  }

  // An unresolvable constant is REPORTED, never silently dropped.
  {
    const { sites, unresolved } = deriveSites({
      registered,
      files: [{ rel: 'packages/x/src/a.ts', source: `class E { readonly code = SOME_UNKNOWN_CONST; }` }],
      readFile: () => '',
    });
    ok(unresolved.length === 1, 'an unresolvable code constant produced no finding');
    ok(sites.length === 0, 'an unresolvable constant leaked into the site list');
  }

  // A registered code produces no finding; comments never do.
  {
    const { sites } = deriveSites({
      registered: new Set(['ALREADY_REGISTERED']),
      files: [
        { rel: 'packages/x/src/a.ts', source: `err.code = 'ALREADY_REGISTERED';` },
        { rel: 'packages/x/src/b.ts', source: `// err.code = 'IN_A_COMMENT';\n/* code: 'BLOCK_COMMENT' */` },
      ],
      readFile: () => '',
    });
    ok(sites.length === 0, `registered/commented codes produced findings: ${JSON.stringify(sites)}`);
  }

  // Lowercase belongs to check:error-code-casing, not here.
  {
    const { sites } = deriveSites({
      registered,
      files: [{ rel: 'packages/x/src/a.ts', source: `err.code = 'lowercase_thing';` }],
      readFile: () => '',
    });
    ok(sites.length === 0, 'a lowercase literal was claimed by this gate');
  }

  // Reconciliation: both directions, plus the now-registered ratchet.
  {
    const sites = [{ code: 'NEW_ONE', file: 'packages/x/src/a.ts', shape: 'assign' }];
    const findings = reconcile({ sites, declared: [], registered: new Set(), unresolved: [] });
    ok(findings.some((f) => f.kind === 'unclassified-site'), 'an unclassified site did not fail');
  }
  {
    const declared = [{ code: 'GONE', file: 'packages/x/src/a.ts', shape: 'assign', door: 'dispatcher', verdict: 'pending-registration' }];
    const findings = reconcile({ sites: [], declared, registered: new Set(), unresolved: [] });
    ok(findings.some((f) => f.kind === 'stale-row'), 'a stale declared row did not fail');
  }
  {
    const site = { code: 'FLOW_FAILED', file: 'packages/x/src/a.ts', shape: 'assign' };
    const declared = [{ ...site, door: 'dispatcher', verdict: 'pending-registration' }];
    const findings = reconcile({
      sites: [site],
      declared,
      registered: new Set(['FLOW_FAILED']),
      unresolved: [],
    });
    ok(findings.some((f) => f.kind === 'now-registered'), 'a registered pending row did not ratchet down');
  }
  {
    const site = { code: 'STILL_PENDING', file: 'packages/x/src/a.ts', shape: 'assign' };
    const findings = reconcile({
      sites: [site],
      declared: [{ ...site, door: 'dispatcher', verdict: 'pending-registration' }],
      registered: new Set(),
      unresolved: [],
    });
    ok(findings.length === 0, `a matched declaration still failed: ${JSON.stringify(findings)}`);
  }

  // The two path exclusions are exactly as narrow as they claim to be — a
  // blanket directory ignore is what lets a real emitter hide.
  {
    ok(isTestFile('packages/x/src/a.test.ts'), 'a .test.ts file was not treated as a test');
    ok(isTestFile('packages/x/src/__tests__/a.ts'), 'a __tests__/ file was not treated as a test');
    ok(!isTestFile('packages/x/src/testing-helpers.ts'), 'a source file with "test" in its name was skipped');
    ok(isDeclarationFile(DECLARATION), 'the declaration file is not excluded from its own scan');
    ok(
      !isDeclarationFile('packages/runtime/src/dispatcher-error-vocabulary-extra.ts'),
      'the declaration exclusion matched by prefix instead of exactly',
    );
    ok(!isDeclarationFile('packages/runtime/src/http-dispatcher.ts'), 'the declaration exclusion is too wide');
  }

  // The spec anchors still parse — a moved anchor must throw, not return empty.
  {
    const ledger = parseLedgerCodes(readFileSync(join(ROOT, LEDGER_ZOD), 'utf8'));
    ok(ledger.size > 100, `ledger parse returned ${ledger.size} codes — the anchor probably moved`);
    ok(ledger.has('DESTRUCTIVE_CHANGE'), 'ledger parse missed a known member');
    const standard = parseStandardCodes(readFileSync(join(ROOT, ERRORS_ZOD), 'utf8'));
    ok(standard.size > 20, `StandardErrorCode parse returned ${standard.size} codes — the anchor probably moved`);
    ok(standard.has('INTERNAL_ERROR'), 'StandardErrorCode parse missed a known member');
    let threw = false;
    try { parseLedgerCodes('export const SOMETHING_ELSE = {};'); } catch { threw = true; }
    ok(threw, 'a missing ledger anchor returned quietly instead of throwing');
  }

  // The declaration file parses into rows with every field present.
  {
    const rows = parseDeclaration(readFileSync(join(ROOT, DECLARATION), 'utf8'));
    ok(rows.length > 0, 'the declaration parsed to zero rows');
    ok(
      rows.every((r) => r.code && r.file && r.shape && r.door && r.verdict),
      'a declaration row parsed with a missing field',
    );
  }

  // [#9098] Door typing. Each assertion is pinned in BOTH directions: the
  // healthy shape passes, and the specific regression it names fails. A
  // structural gate that only ever ran against a healthy tree would be a
  // phantom check — it must be shown capable of failing.
  {
    const healthy = `
      import type { ErrorCode } from '@objectstack/spec/api';
      export function sendThrownError(res: any, error: any, object?: string): void {}
      export function sendDeclaredFault(
          res: any,
          fault: { code: ErrorCode; status: number; message: string },
      ): void { sendThrownError(res, fault); }
      export function sendFieldVisibilityFault(res: any, o: string): void {
          sendDeclaredFault(res, { code: 'FIELD_VISIBILITY_UNRESOLVED', message: o, status: 503 });
      }`;
    ok(
      checkDoorTyping({ doorSource: healthy, files: [] }).length === 0,
      'the healthy door shape produced a door-typing finding',
    );

    const widened = healthy.replace('code: ErrorCode;', 'code: string;');
    ok(
      checkDoorTyping({ doorSource: widened, files: [] }).some((f) => /no longer types/.test(f.text)),
      'widening sendDeclaredFault\'s `code` to string did not fail',
    );

    const missing = healthy.replace(/export function sendDeclaredFault[\s\S]*?\): void \{[^}]*\}/, '');
    ok(
      checkDoorTyping({ doorSource: missing, files: [] }).some((f) => /no .*sendDeclaredFault/.test(f.text)),
      'deleting the typed author-side door did not fail',
    );

    const collided = `${healthy}\nexport function sendError(res: any, error: any): void {}`;
    ok(
      checkDoorTyping({ doorSource: collided, files: [] }).some((f) => /collision/.test(f.text)),
      'reintroducing the `sendError` collision did not fail',
    );

    // ③ both directions, and the CAUGHT-value call must stay legal.
    const bypass = `sendThrownError(res, { code: 'SOMETHING_NEW', message: 'x', status: 400 });`;
    ok(
      checkDoorTyping({
        doorSource: healthy,
        files: [{ rel: 'packages/rest/src/some-routes.ts', source: bypass }],
      }).some((f) => /SOMETHING_NEW/.test(f.text)),
      'an author-declared literal sent through the `any` door did not fail',
    );
    ok(
      checkDoorTyping({
        doorSource: healthy,
        files: [{ rel: 'packages/rest/src/some-routes.ts', source: `sendThrownError(res, error, object);` }],
      }).length === 0,
      'passing a CAUGHT error through the classification door was flagged — that is its job',
    );
    ok(
      checkDoorTyping({
        doorSource: healthy,
        files: [{ rel: 'packages/rest/src/x.ts', source: `// sendThrownError(res, { code: 'IN_A_COMMENT' });` }],
      }).length === 0,
      'a commented-out bypass produced a door-typing finding',
    );

    // A missing door file is a FINDING, never a quiet pass.
    ok(
      checkDoorTyping({ doorSource: null, files: [] }).some((f) => /anchor moved/.test(f.text)),
      'an unreadable door file passed quietly instead of failing',
    );

    // And the real file on disk satisfies all three.
    ok(
      existsSync(join(ROOT, REST_DOOR_FILE)),
      `${REST_DOOR_FILE} does not exist — the door-typing anchor moved`,
    );
  }

  if (fail.length) {
    console.error('check-dispatcher-error-vocabulary --self-test FAILED:');
    for (const f of fail) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(
    `check-dispatcher-error-vocabulary --self-test: ${Object.keys(samples).length} shapes ` +
    `+ ${cases} assertions OK (vocabulary + #9098 door typing)`,
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) return selfTest();

  const readFile = (abs) => readFileSync(abs, 'utf8');
  const ledger = parseLedgerCodes(readFileSync(join(ROOT, LEDGER_ZOD), 'utf8'));
  const standard = parseStandardCodes(readFileSync(join(ROOT, ERRORS_ZOD), 'utf8'));
  const registered = new Set([...ledger, ...standard]);

  const files = [];
  for (const { rel, abs } of walkSources(join(ROOT, SCAN_ROOT), ROOT)) {
    files.push({ rel, source: readFile(abs) });
  }

  const { sites, unresolved } = deriveSites({ registered, files, readFile });
  const declared = parseDeclaration(readFileSync(join(ROOT, DECLARATION), 'utf8'));
  const findings = reconcile({ sites, declared, registered, unresolved });

  // [#9098] The door-typing half. `walkSources` skips the door file only if it
  // is a test or the declaration — it is neither, so read it from the scanned
  // set and fall back to disk rather than assuming either.
  const doorEntry = files.find((f) => f.rel === REST_DOOR_FILE);
  const doorAbs = join(ROOT, REST_DOOR_FILE);
  const doorSource = doorEntry?.source ?? (existsSync(doorAbs) ? readFile(doorAbs) : null);
  findings.push(...checkDoorTyping({ doorSource, files }));

  const pending = declared.filter((d) => d.verdict === 'pending-registration');
  const bounds =
    `  scope: ${files.length} non-test source files under ${SCAN_ROOT}/; ` +
    `${registered.size} registered codes (${ledger.size} ledger + ${standard.size} standard); ` +
    `${sites.length} unregistered code-stamping site(s) found; ${declared.length} classified.\n` +
    `  door typing (#9098): ${REST_DOOR_FILE} checked for the typed author-side responder, the ` +
    `absence of a second \`sendError\`, and decided refusals bypassing it.\n` +
    `  the sandbox limb (author-thrown codes from metadata-app action code) is outside this scan ` +
    `by construction — see SANDBOX_AUTHORED_LIMB in ${DECLARATION}.`;

  if (argv.includes('--report')) {
    console.log('Derived sites (code / shape / file):');
    for (const s of sites) {
      const row = declared.find((d) => key(d) === key(s));
      console.log(`  ${s.code.padEnd(40)} ${s.shape.padEnd(11)} ${row ? row.verdict : 'UNCLASSIFIED'}  ${s.file}`);
    }
    console.log(`\nPending ledger registration (#8846's input): ${pending.length}`);
    for (const p of [...new Set(pending.map((d) => d.code))].sort()) {
      const doors = [...new Set(pending.filter((d) => d.code === p).map((d) => d.door))].join(',');
      console.log(`  ${p.padEnd(40)} door=${doors}`);
    }
    console.log(`\n${bounds}`);
  }

  if (findings.length) {
    console.error(`\ncheck-dispatcher-error-vocabulary: ${findings.length} finding(s)\n`);
    for (const f of findings) console.error(`  [${f.kind}] ${f.text}\n`);
    console.error(bounds);
    process.exit(1);
  }

  console.log(
    `check-dispatcher-error-vocabulary: OK — ${sites.length} unregistered code-stamping site(s), all classified; ` +
      `${new Set(pending.map((d) => d.code)).size} awaiting a ledger entry (#8846).`,
  );
  console.log(bounds);
}

main();
