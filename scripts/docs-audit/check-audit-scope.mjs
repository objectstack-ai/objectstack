#!/usr/bin/env node
// Keep the `docs-accuracy-audit` workflow's default scope list DERIVED from the
// filesystem instead of hand-kept — and fail loudly the moment the two disagree.
//
// It also holds the second half of that scope's contract (#4920): `content/docs/
// releases/**` is IN the scope but is a READ-ONLY target, and this script is what
// keeps that true — see "release-owned pages" below.
//
// Usage:
//   node scripts/docs-audit/check-audit-scope.mjs              # verify; exit 1 naming every drifted entry
//   node scripts/docs-audit/check-audit-scope.mjs --write      # regenerate the block in place
//   node scripts/docs-audit/check-audit-scope.mjs --self-test  # pin the parser/renderer/differ + the read-only routing
//
// ## Why this exists (#4851)
//
// `.claude/workflows/docs-accuracy-audit.js` carries the full list of hand-written
// docs inline, as `ALL_HANDWRITTEN`. It has to: a workflow script runs inside a
// `node:vm` context whose only globals are `log/phase/console/budget/setTimeout/
// clearTimeout` plus `agent/parallel/pipeline/workflow/args`, with `codeGeneration`
// disabled — no `require`, no `import`, no filesystem, no `eval`. The script
// therefore cannot enumerate `content/docs/**` itself, and cannot read the list
// from a JSON artifact either.
//
// So the list was hand-kept, with a comment asking the next author to "keep in sync
// with `affected-docs.mjs --all`" — a promise nothing checked. It rotted, in BOTH
// directions, and neither direction announced itself:
//
//   - 16 listed paths pointed at files that no longer exist (10 of them the whole
//     `content/docs/protocol/objectos/**` directory, renamed to `protocol/kernel/`).
//     A doc path that resolves to nothing produced an audit agent that read nothing
//     and reported `fixCount: 0` — indistinguishable, in the run summary, from a doc
//     that was audited and found accurate. #4781 and #4817 were both real accuracy
//     defects in `protocol/kernel/`, both sat for ~2 months, and both were "covered"
//     by green full-audit runs the entire time.
//   - 48 docs on disk were absent from the list entirely — including all 9 of
//     `protocol/kernel/**` and the whole `content/docs/capabilities/**` directory.
//     A "FULL audit (no args.docs given)" run therefore audited 130 of 178
//     hand-written docs while calling itself full.
//
// The second direction is the larger hole and nobody had asked about it, which is
// the point: a hand-kept list drifts silently both ways. This gate closes both.
// It is the same discipline as #4690 / #4777 / #4804 / #4835 / #4868 / #4890 — a
// check whose subject has gone missing must go red, never green-by-vacancy.
//
// ## What "derived" means here
//
// The scope is not a curation: it is exactly `content/docs/**/*.mdx` minus
// `content/docs/references/**` (generated from packages/spec, audited by
// regenerating them). That definition already exists — `affected-docs.mjs --all`
// computes it for the change-scoped path — so this gate SHELLS OUT to that script
// rather than re-deriving it. One definition of "hand-written doc", one place to
// change it; a second walk here would be the next thing to drift out of sync.
//
// `--write` regenerates the inline block from that derivation, so the array is a
// generated artifact that happens to live inside a hand-written file. Hand-editing
// it is never necessary and this check will reject it.
//
// ## Release-owned pages: in scope, read-only (#4920)
//
// The derived scope contains `content/docs/releases/**`, and AGENTS.md's Documentation
// Guardrails forbid a code PR from editing those pages at all. The audit workflow's
// deliverable is an in-place mdx rewrite, so for those 9 pages the two rules collided
// head-on: a full audit produced exactly the PR the guardrail exists to stop.
//
// The ruling was to keep them in scope and fork the DELIVERABLE — the workflow reviews
// them read-only and emits findings to file as issues. Excluding them instead would
// have created a second definition of "docs this workflow covers" next to the generated
// block, and #4851 is the bill for one subject with two hand-kept lists.
//
// That leaves three things that can quietly break, so this script checks all three:
//
//   1. the guardrail itself moves or is reworded in AGENTS.md, and the workflow keeps
//      protecting a path nothing declares any more;
//   2. the workflow's `RELEASE_OWNED_PREFIX` stops matching that guardrail's path;
//   3. the routing is refactored away, and release pages silently rejoin the editable
//      channel — the failure with no symptom until a PR edits a release note.
//
// (3) is checked by RUNNING the workflow against stub agents and inspecting which
// prompt and schema each doc actually gets, not by grepping for a keyword: a check
// that reads source text would pass on any refactor that keeps the words and drops
// the behaviour. `--self-test` then mutates the routing out of an in-memory copy and
// requires that check to go red, because a guard nobody has ever seen fail is a guard
// nobody has tested (#4868).

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: HERE })
  .toString()
  .trim();

const WORKFLOW_REL = '.claude/workflows/docs-accuracy-audit.js';
const AGENTS_REL = 'AGENTS.md';
const BEGIN = '// <generated:docs-audit-scope>';
const END = '// </generated:docs-audit-scope>';

/**
 * The release-owned boundary — the path column of AGENTS.md's RELEASE-OWNED guardrail
 * row, verbatim. Not a curation of it: `assertGuardrailAnchored` fails if AGENTS.md
 * stops declaring exactly this, so the rule and its enforcement cannot drift apart.
 */
export const RELEASE_OWNED_PREFIX = 'content/docs/releases/';
export const isReleaseOwned = (doc) => doc.startsWith(RELEASE_OWNED_PREFIX);

const args = process.argv.slice(2);

// --- block extraction / rendering -------------------------------------------

/**
 * The generated block's body (everything strictly between the markers), or throw.
 *
 * A missing marker is a HARD failure, not a skip. This gate's whole subject is a
 * list that quietly stopped matching reality; a version of it that shrugs when it
 * cannot find that list would reproduce the defect one level up (#4690's shape:
 * no manifest, exit 0).
 */
export function extractBlock(source) {
  const begin = source.indexOf(BEGIN);
  const end = source.indexOf(END);
  if (begin === -1 || end === -1 || end < begin) {
    throw new Error(
      `${WORKFLOW_REL}: could not find the generated scope block. Expected a region ` +
        `delimited by "${BEGIN}" and "${END}". The audit workflow's default scope is ` +
        `generated by this script; if the block was renamed or removed, restore it (or ` +
        `update the markers here) — do NOT hand-maintain the list.`,
    );
  }
  return source.slice(begin + BEGIN.length, end);
}

/** The doc paths declared inside the generated block. */
export function parseBlock(source) {
  const body = extractBlock(source);
  // No doc path contains `]`, so "up to the first bracket" is unambiguous — and it
  // parses the legacy single-line form too, so an old block is reported as drift
  // rather than as a parse crash.
  const m = body.match(/const ALL_HANDWRITTEN = (\[[^\]]*])/);
  if (!m) {
    throw new Error(
      `${WORKFLOW_REL}: the generated scope block contains no \`const ALL_HANDWRITTEN = [...]\` ` +
        `array literal. Regenerate it with \`node scripts/docs-audit/check-audit-scope.mjs --write\`.`,
    );
  }
  // The rendered form keeps a trailing comma on the last entry (smaller diffs when a
  // doc is added); that is the one thing between it and plain JSON, so drop it.
  const json = m[1].replace(/,(\s*])$/, '$1');
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    throw new Error(
      `${WORKFLOW_REL}: ALL_HANDWRITTEN is not a plain array of string literals (${e.message}). ` +
        `It is generated output — regenerate with \`--write\` rather than hand-editing it.`,
    );
  }
  return parsed;
}

/**
 * The exact text the block must contain for a given doc set. Byte-comparing against
 * this is what makes hand-edits — including a merely reordered list — visible.
 */
export function renderBlock(docs) {
  const entries = [...docs].sort();
  return [
    '',
    '// GENERATED — do not hand-edit. `node scripts/docs-audit/check-audit-scope.mjs --write`',
    '// derives this from the filesystem (every content/docs/**/*.mdx except',
    '// references/, via `affected-docs.mjs --all`); the same script run without',
    '// --write fails CI when the two disagree in either direction. See #4851: this',
    '// list was hand-kept, 16 entries pointed at files that no longer existed and 48',
    '// existing docs were absent from it, and a "FULL audit" reported green over both.',
    'const ALL_HANDWRITTEN = [',
    ...entries.map((d) => `  ${JSON.stringify(d)},`),
    ']',
    '',
  ].join('\n');
}

/** Splice a freshly rendered block back into the workflow source. */
export function replaceBlock(source, docs) {
  const begin = source.indexOf(BEGIN);
  const end = source.indexOf(END);
  if (begin === -1 || end === -1 || end < begin) throw new Error('missing markers'); // extractBlock already explains
  return source.slice(0, begin + BEGIN.length) + renderBlock(docs) + source.slice(end);
}

// --- the comparison ----------------------------------------------------------

/**
 * Both directions, always. `dead` is what #4851 was filed about; `unlisted` is the
 * direction nobody asked about and where 3x more drift had accumulated. Reporting
 * only one of them would leave a gate that goes green while half-blind.
 */
export function diffScope(listed, derived) {
  const listedSet = new Set(listed);
  const derivedSet = new Set(derived);
  const seen = new Set();
  const duplicates = [];
  for (const d of listed) {
    if (seen.has(d)) duplicates.push(d);
    seen.add(d);
  }
  return {
    dead: listed.filter((d) => !derivedSet.has(d)),
    unlisted: derived.filter((d) => !listedSet.has(d)),
    duplicates,
  };
}

/** The hand-written doc set, from the ONE script that defines it. */
function deriveDocs() {
  const out = execFileSync(
    process.execPath,
    [join(REPO_ROOT, 'scripts/docs-audit/affected-docs.mjs'), '--all', '--json'],
    { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'ignore'] },
  ).toString();
  const docs = JSON.parse(out).docs;
  if (!Array.isArray(docs) || docs.length === 0) {
    throw new Error(
      'affected-docs.mjs --all --json returned no docs. Refusing to rewrite the audit ' +
        'scope to an empty list — an audit of nothing must not be able to report success.',
    );
  }
  return docs;
}

// --- release-owned pages: the rule, the constant, the routing ----------------

/**
 * AGENTS.md must still declare exactly this path RELEASE-OWNED. The workflow's
 * read-only fork is an ENFORCEMENT of that row; if the row is renamed, moved or
 * softened, the enforcement is protecting a rule that no longer says what it is
 * quoting, and that must be noticed here rather than by a reader years later.
 */
export function findGuardrailRow(agentsMd) {
  return (
    agentsMd
      .split('\n')
      .find((line) => line.includes(`\`${RELEASE_OWNED_PREFIX}\``) && line.includes('RELEASE-OWNED')) ?? null
  );
}

/**
 * The prefix a consumer actually routes on.
 *
 * `label` names the file being parsed, because there is now more than one consumer:
 * the audit workflow (read-only channel, #4920) and the drift-check mapper (read-only
 * SECTION in its PR comment, #6893). Both hold their own literal copy — the workflow
 * because it is evaluated in a sandbox VM that cannot import, the mapper because a
 * shared module importable by only one of the two would leave the other unanchored.
 * `checkReleaseOwned` below is what keeps every copy equal to AGENTS.md's guardrail row.
 */
export function parseReleaseOwnedPrefix(source, label = WORKFLOW_REL) {
  const m = source.match(/const RELEASE_OWNED_PREFIX = '([^']*)'/);
  if (!m) {
    throw new Error(
      `${label}: no \`const RELEASE_OWNED_PREFIX = '...'\` declaration. That constant is ` +
        `how it tells release-owned pages (read-only) from editable ones; without it every ` +
        `page it reports is editable, including ${RELEASE_OWNED_PREFIX}** — the collision ` +
        `#4920 was filed for, and the one #6893 hit again in the drift comment. Restore it.`,
    );
  }
  return m[1];
}

/**
 * Every file that holds its own literal copy of the release-owned prefix. Adding a
 * consumer means adding it here — that is the whole cost of the "copies, anchored"
 * shape, and it is cheaper than the alternative #4851 billed us for.
 */
const RELEASE_OWNED_CONSUMERS = [WORKFLOW_REL, 'scripts/docs-audit/affected-docs.mjs'];

/**
 * Run the workflow the way it really runs — free globals, stub agents — and report
 * what each doc in scope was actually handed.
 *
 * The workflow body uses top-level `await` and a top-level `return`, so its runner
 * evaluates it as a function body with `log`/`phase`/`agent`/`pipeline`/`args` supplied
 * as globals; `export const meta` is lifted out separately. This mirrors that shape
 * closely enough to exercise the real routing expressions, which is the point — the
 * alternative, matching source text, cannot tell a working fork from a dead one.
 */
async function runWorkflow(source, { workflowArgs, respond }) {
  const logs = [];
  const calls = [];
  const context = createContext({
    console: { log() {}, error() {} },
    args: workflowArgs,
    budget: { remaining: () => Number.POSITIVE_INFINITY },
    workflow: {},
    log: (m) => logs.push(String(m)),
    phase: () => {},
    parallel: async (items, fn) => Promise.all(items.map(fn)),
    // Two-stage pipeline, sequential: order does not matter to any assertion here and
    // sequencing keeps a failing case readable.
    pipeline: async (items, stage1, stage2) => {
      const out = [];
      for (const item of items) out.push(await stage2(await stage1(item), item));
      return out;
    },
    agent: async (prompt, opts = {}) => {
      calls.push({ prompt, ...opts });
      return respond({ prompt, ...opts });
    },
  });
  const body = source.replace(/^export const meta =/m, 'const meta =');
  try {
    const result = await runInContext(`(async () => {\n${body}\n})()`, context, {
      filename: WORKFLOW_REL,
    });
    return { result, logs, calls, error: null };
  } catch (e) {
    return { result: null, logs, calls, error: e };
  }
}

/** A minimal object satisfying a workflow schema's `required` list. */
function stubFor(schema, overrides = {}) {
  const bools = { docExists: true, implementationFound: true, buildSafe: true, filesEdited: false };
  const out = {};
  for (const key of schema?.required ?? []) {
    const type = schema.properties?.[key]?.type;
    out[key] =
      type === 'string' ? '' : type === 'number' ? 0 : type === 'array' ? [] : type === 'boolean' ? bools[key] ?? true : {};
  }
  return { ...out, ...overrides };
}

/** Echo the preflight's own path list back as fully present. */
function preflightResponse(prompt) {
  const head = prompt.lastIndexOf('PATHS (');
  const paths = prompt
    .slice(prompt.indexOf('\n', head) + 1)
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  return { command: 'stub', present: paths, missing: [] };
}

const PROBE_EDITABLE = 'content/docs/api/index.mdx';
const PROBE_RELEASE = `${RELEASE_OWNED_PREFIX}v9.mdx`;

/**
 * Every way the read-only channel can be broken, checked by observing a real run.
 * Returns a list of human-readable problems; empty means the fork is intact.
 */
export async function checkReadOnlyRouting(source) {
  const problems = [];
  const docs = [PROBE_EDITABLE, PROBE_RELEASE];
  const audits = (calls) => calls.filter((c) => c.phase === 'Audit & Fix');

  // 1. Routing: which prompt and which schema does each doc get?
  const run = await runWorkflow(source, {
    workflowArgs: { docs },
    respond: ({ prompt, phase, schema }) =>
      phase === 'Scope Preflight' ? preflightResponse(prompt) : stubFor(schema, { doc: '' }),
  });
  if (run.error) {
    problems.push(`the workflow threw on a clean two-doc run: ${run.error.message}`);
    return problems;
  }

  const seen = audits(run.calls);
  if (seen.length !== docs.length) {
    problems.push(`expected ${docs.length} audit-phase agent(s), saw ${seen.length}`);
    return problems;
  }
  const releaseCall = seen.find((c) => String(c.label).includes('releases/'));
  const editableCall = seen.find((c) => !String(c.label).includes('releases/'));

  if (!releaseCall) {
    problems.push(`${PROBE_RELEASE} was handed to no audit-phase agent at all — a page in scope that produces nothing has been dropped from the audit, which is the outcome #4920 rejected`);
  } else {
    // The editable channel's rule 1 is "Edit the doc FILE IN PLACE"; its presence in a
    // release page's prompt IS the bug, whatever else the prompt says.
    if (releaseCall.prompt.includes('Edit the doc FILE IN PLACE')) {
      problems.push(`${PROBE_RELEASE} was given the EDITABLE audit prompt ("Edit the doc FILE IN PLACE") — release notes are RELEASE-OWNED and must never be edited by a code PR (AGENTS.md; #4920)`);
    }
    if (!releaseCall.prompt.includes('READ-ONLY') || !releaseCall.prompt.includes(`DO NOT edit`)) {
      problems.push(`${PROBE_RELEASE}'s prompt does not tell the agent the page is read-only`);
    }
    // The schema is the structural half: a read-only channel that still reports
    // `fixesApplied` is one Edit call away from writing to a release page.
    const req = releaseCall.schema?.required ?? [];
    if (req.includes('fixesApplied') || !req.includes('filesEdited')) {
      problems.push(`${PROBE_RELEASE} was given the edit-log schema (fixesApplied), not the finding schema (filesEdited)`);
    }
  }

  if (!editableCall) {
    problems.push(`${PROBE_EDITABLE} was handed to no audit-phase agent`);
  } else if (!editableCall.prompt.includes('Edit the doc FILE IN PLACE')) {
    problems.push(`${PROBE_EDITABLE} lost the editable audit prompt — the read-only fork must not swallow ordinary docs`);
  }

  // 2. The run summary must SAY so. A silent read-only channel is indistinguishable
  //    from having excluded the pages, which is the option that was rejected.
  const headline = 'releases (read-only): 0 finding(s) — file issues, do not edit';
  if (!run.logs.some((l) => l.includes(headline))) {
    problems.push(`no run-summary line "${headline}" — findings on release pages have to be visible enough to file, or the audit of those pages produced nothing anyone can act on`);
  }
  const readOnly = run.result?.releaseOwnedReadOnly;
  if (!readOnly || readOnly.docsReviewed !== 1) {
    problems.push(`the result's releaseOwnedReadOnly section did not report the 1 release page reviewed (got ${JSON.stringify(readOnly?.docsReviewed)})`);
  }
  const entry = (run.result?.perDoc ?? []).find((d) => d.doc === PROBE_RELEASE);
  if (!entry || entry.channel !== 'read-only') {
    problems.push(`${PROBE_RELEASE} is not marked channel:"read-only" in perDoc (got ${JSON.stringify(entry?.channel)})`);
  } else if ('fixes' in entry) {
    problems.push(`${PROBE_RELEASE}'s perDoc entry carries a \`fixes\` count — a read-only page reporting "0 fixes" reads exactly like an audited-and-clean one (#4851)`);
  }

  // 3. No result at all for a release page must FAIL the run, not shrink the summary.
  const skipped = await runWorkflow(source, {
    workflowArgs: { docs },
    respond: ({ prompt, phase, schema, label }) =>
      phase === 'Scope Preflight'
        ? preflightResponse(prompt)
        : String(label).includes('releases/')
          ? null
          : stubFor(schema, { doc: '' }),
  });
  if (!skipped.error || !/produced no review result/.test(skipped.error.message)) {
    problems.push('a release page whose review returned nothing did not fail the run — it was silently dropped from the summary instead');
  }

  // 4. An agent that admits it edited a release page must fail the run by name.
  const edited = await runWorkflow(source, {
    workflowArgs: { docs },
    respond: ({ prompt, phase, schema, label }) =>
      phase === 'Scope Preflight'
        ? preflightResponse(prompt)
        : stubFor(schema, { doc: '', filesEdited: String(label).includes('releases/') }),
  });
  if (!edited.error || !edited.error.message.includes(PROBE_RELEASE)) {
    problems.push('a read-only agent reporting filesEdited:true did not fail the run naming the page — an edit to a release note would ride into the PR unannounced');
  }

  return problems;
}

// --- main --------------------------------------------------------------------

try {
  if (args.includes('--self-test')) {
    await selfTest();
    process.exit(0);
  }
  await main();
} catch (e) {
  // A structural failure (markers gone, list unparseable, derivation empty) is a
  // RED result with a readable reason — never a stack trace, and never a pass.
  console.error(`✗ ${e.message}`);
  process.exit(1);
}

async function main() {
  const workflowPath = join(REPO_ROOT, WORKFLOW_REL);
  const source = readFileSync(workflowPath, 'utf8');
  const derived = deriveDocs();

  if (args.includes('--write')) {
    const before = parseBlock(source);
    writeFileSync(workflowPath, replaceBlock(source, derived));
    const { dead, unlisted } = diffScope(before, derived);
    console.log(
      `✓ regenerated ${WORKFLOW_REL} scope: ${derived.length} hand-written doc(s) ` +
        `(+${unlisted.length} added, -${dead.length} removed).`,
    );
    return;
  }

  const listed = parseBlock(source);
  const { dead, unlisted, duplicates } = diffScope(listed, derived);
  // Byte-compare too: correct paths in a hand-edited shape still means the block
  // stopped being generated output, and the next `--write` would churn.
  const blockDrift = extractBlock(source) !== renderBlock(derived);

  if (!dead.length && !unlisted.length && !duplicates.length && !blockDrift) {
    console.log(
      `✓ docs-accuracy-audit scope is in sync with content/docs/: ${listed.length} hand-written doc(s).`,
    );
    await checkReleaseOwned(source, derived);
    return;
  }

  console.error(`✗ ${WORKFLOW_REL}: ALL_HANDWRITTEN has drifted from content/docs/.\n`);
  if (dead.length) {
    console.error(
      `  ${dead.length} listed path(s) do not exist — an audit agent pointed at one reads\n` +
        `  nothing and reports "0 fixes", which in the run summary is indistinguishable\n` +
        `  from a doc that was checked and found accurate:`,
    );
    for (const d of dead) console.error(`    - ${d}`);
    console.error('');
  }
  if (unlisted.length) {
    console.error(
      `  ${unlisted.length} hand-written doc(s) exist but are not listed — a run that calls\n` +
        `  itself a "FULL audit" silently skips every one of them:`,
    );
    for (const d of unlisted) console.error(`    + ${d}`);
    console.error('');
  }
  if (duplicates.length) {
    console.error(`  ${duplicates.length} duplicate entr(ies): ${duplicates.join(', ')}\n`);
  }
  if (!dead.length && !unlisted.length && !duplicates.length && blockDrift) {
    console.error(
      '  The listed paths are correct but the block does not match its rendered form —\n' +
        '  ordering, formatting or the header comment was hand-edited.\n',
    );
  }
  console.error('  Fix: node scripts/docs-audit/check-audit-scope.mjs --write');
  process.exit(1);
}

/**
 * The release-owned half of the contract: the rule still says it, the workflow still
 * encodes the same path, the pages are still in scope, and the read-only fork still
 * works on a real run.
 */
async function checkReleaseOwned(source, derived) {
  const guardrail = findGuardrailRow(readFileSync(join(REPO_ROOT, AGENTS_REL), 'utf8'));
  if (!guardrail) {
    console.error(
      `✗ ${AGENTS_REL}: no Documentation Guardrails row marking \`${RELEASE_OWNED_PREFIX}\` RELEASE-OWNED.\n\n` +
        `  ${WORKFLOW_REL} routes that exact prefix down a read-only channel BECAUSE of that row\n` +
        `  (#4920). If the guardrail moved, was renamed or was softened, the workflow is now\n` +
        `  enforcing a rule the repo no longer states — update both together, in that order.\n`,
    );
    process.exit(1);
  }

  // Every consumer's literal copy must equal the guardrail row's path. One drifting
  // copy is silent by construction: the file keeps running, it just protects a set of
  // pages the repo no longer marks read-only.
  for (const rel of RELEASE_OWNED_CONSUMERS) {
    const consumerSource = rel === WORKFLOW_REL ? source : readFileSync(join(REPO_ROOT, rel), 'utf8');
    const prefix = parseReleaseOwnedPrefix(consumerSource, rel);
    if (prefix !== RELEASE_OWNED_PREFIX) {
      console.error(
        `✗ ${rel}: RELEASE_OWNED_PREFIX is "${prefix}", but ${AGENTS_REL} marks\n` +
          `  "${RELEASE_OWNED_PREFIX}" RELEASE-OWNED. It would treat the wrong set of pages as\n` +
          `  read-only — the audit would edit release notes it no longer recognises (#4920), and\n` +
          `  the drift comment would list them as ordinary work (#6893).\n`,
      );
      process.exit(1);
    }
  }

  // The pages must still BE in scope. Zero of them is not "nothing to protect": it is
  // option A from #4920 (exclude releases from the audit), which was rejected — the
  // most-read pages in the docs would go permanently unaudited, silently.
  const inScope = derived.filter(isReleaseOwned);
  if (!inScope.length) {
    console.error(
      `✗ no ${RELEASE_OWNED_PREFIX}** page is in the audit scope.\n\n` +
        `  Release pages are meant to be IN scope and READ-ONLY (#4920): audited, never edited,\n` +
        `  findings filed as issues. An empty set means either the pages moved, or they were\n` +
        `  excluded from the scope — the option that ruling rejected, because it leaves the\n` +
        `  most-read pages in the docs unaudited with nothing to say so.\n`,
    );
    process.exit(1);
  }

  const problems = await checkReadOnlyRouting(source);
  if (problems.length) {
    console.error(`✗ ${WORKFLOW_REL}: the read-only channel for ${RELEASE_OWNED_PREFIX}** is broken.\n`);
    for (const p of problems) console.error(`    - ${p}`);
    console.error(
      `\n  Observed by running the workflow against stub agents. Release notes are RELEASE-OWNED\n` +
        `  (${AGENTS_REL}: "${guardrail.trim().slice(0, 96)}…"); the audit reviews them and reports,\n` +
        `  it never edits them (#4920).\n`,
    );
    process.exit(1);
  }

  console.log(
    `✓ release-owned pages are in scope and read-only: ${inScope.length} page(s) under ` +
      `${RELEASE_OWNED_PREFIX} review-only (findings → issues, never edited).`,
  );
}

// --- self-test ---------------------------------------------------------------

/**
 * Pin the three things that can silently break this gate: the block parser, the
 * render round-trip, and the differ's SECOND direction. All hermetic — fixtures,
 * no repo state — so a regression here fails on its own PR rather than being
 * discovered the next time a directory is renamed.
 */
async function selfTest() {
  let failed = 0;
  let total = 0;
  const check = (label, want, got) => {
    total++;
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      console.error(`  ✗ ${label}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
      failed++;
    }
  };
  const throws = (label, fn, needle) => {
    total++;
    try {
      fn();
      console.error(`  ✗ ${label}: expected a throw, got none`);
      failed++;
    } catch (e) {
      if (!String(e.message).includes(needle)) {
        console.error(`  ✗ ${label}: throw did not mention "${needle}" — got: ${e.message}`);
        failed++;
      }
    }
  };

  const docs = ['content/docs/a.mdx', 'content/docs/b.mdx'];
  const file = `header\n${BEGIN}${renderBlock(docs)}${END}\nfooter\n`;

  check('parseBlock round-trips the rendered block', docs, parseBlock(file));
  check('renderBlock sorts', ['a', 'b'], parseBlock(`${BEGIN}${renderBlock(['b', 'a'])}${END}`));
  check(
    'replaceBlock preserves the surrounding file',
    ['header', 'footer', ''],
    (() => {
      const out = replaceBlock(file, ['content/docs/c.mdx']);
      return [out.split('\n')[0], out.split('\n').at(-2), out.split('\n').at(-1)];
    })(),
  );
  check('replaceBlock installs the new list', ['content/docs/c.mdx'], parseBlock(replaceBlock(file, ['content/docs/c.mdx'])));

  // A gate that cannot find its subject must fail, not pass. This is the exact
  // failure mode the gate exists to prevent, applied to the gate itself.
  throws('missing markers throw', () => extractBlock('no markers here'), 'could not find the generated scope block');
  throws(
    'a block with no array literal throws',
    () => parseBlock(`${BEGIN}\n// nothing here\n${END}`),
    'no `const ALL_HANDWRITTEN = [...]` array literal',
  );
  throws(
    'a hand-edited (non-JSON) array literal throws',
    () => parseBlock(`${BEGIN}\nconst ALL_HANDWRITTEN = [\n  'a.mdx',\n]\n${END}`),
    'not a plain array of string literals',
  );

  // Both directions of drift, each pinned on its own — #4851 asked only about
  // `dead`, and `unlisted` was where 3x more of the rot actually was.
  const d1 = diffScope(['x.mdx', 'gone.mdx'], ['x.mdx', 'new.mdx']);
  check('dead entries are reported', ['gone.mdx'], d1.dead);
  check('unlisted docs are reported', ['new.mdx'], d1.unlisted);
  check('no false positives when in sync', { dead: [], unlisted: [], duplicates: [] }, diffScope(['x.mdx'], ['x.mdx']));
  check('duplicates are reported', ['x.mdx'], diffScope(['x.mdx', 'x.mdx'], ['x.mdx']).duplicates);

  // The renamed-directory case that opened #4851, end to end through the differ.
  const renamed = diffScope(
    ['content/docs/protocol/objectos/index.mdx'],
    ['content/docs/protocol/kernel/index.mdx'],
  );
  check('a renamed directory shows up on BOTH sides', 1, renamed.dead.length);
  check('…and its new home is flagged as unlisted', 1, renamed.unlisted.length);

  // --- release-owned pages: in scope, read-only (#4920) ----------------------
  //
  // The predicate and the guardrail parser are hermetic. The three cases after them
  // deliberately are NOT: they run the REAL workflow, because the thing being pinned
  // is that release pages take the read-only fork on the real path, and a fixture
  // proves nothing about that (#4868 — a self-check running somewhere other than the
  // real path proves nothing about the real path).
  check('the prefix routes release pages', [true, true], [
    isReleaseOwned('content/docs/releases/v9.mdx'),
    isReleaseOwned('content/docs/releases/index.mdx'),
  ]);
  check('…and nothing else', [false, false, false], [
    isReleaseOwned('content/docs/api/index.mdx'),
    // Neither a sibling directory whose name merely starts the same way…
    isReleaseOwned('content/docs/releases-notes/v9.mdx'),
    // …nor a page that only mentions releases deeper in its path.
    isReleaseOwned('content/docs/deployment/releases/v9.mdx'),
  ]);
  check(
    'the AGENTS.md guardrail row is found by path + RELEASE-OWNED',
    true,
    findGuardrailRow('| `content/docs/releases/` | **RELEASE-OWNED** | ❌ Never edit in a code PR. |') !== null,
  );
  check(
    'a row that no longer says RELEASE-OWNED is not the guardrail',
    null,
    findGuardrailRow('| `content/docs/releases/` | generated | see the release process |'),
  );
  throws(
    'a workflow without the prefix constant throws',
    () => parseReleaseOwnedPrefix('const ALL_HANDWRITTEN = []'),
    'no `const RELEASE_OWNED_PREFIX',
  );

  const workflowSource = readFileSync(join(REPO_ROOT, WORKFLOW_REL), 'utf8');

  // (1) Still in scope. #4920's rejected option was deleting these pages from the
  //     audit; that would show up right here, as an empty list.
  check(
    'release pages are still IN the audit scope',
    true,
    parseBlock(workflowSource).filter(isReleaseOwned).length > 0,
  );

  // (2) …and routed read-only, observed on a real run of the workflow.
  check('release pages take the read-only channel', [], await checkReadOnlyRouting(workflowSource));

  // (3) Mutations. A guard that has never been seen to fail is a guard nobody has
  //     tested — so break the fork two ways in memory and require each to go red.
  const mutants = [
    // The fork itself: every doc becomes editable, release notes included.
    ['routing removed', 'doc.startsWith(RELEASE_OWNED_PREFIX)', 'false'],
    // The fork survives but says nothing, which reads exactly like the pages having
    // been excluded — the outcome the ruling rejected.
    ['read-only headline removed', 'releases (read-only): ${totalFindings} finding(s)', 'audited ${totalFindings} page(s)'],
  ];
  for (const [label, from, to] of mutants) {
    total++;
    const mutated = workflowSource.replace(from, to);
    if (mutated === workflowSource) {
      console.error(`  ✗ mutation "${label}" did not apply — it cannot prove anything. Update the mutation to match the current source.`);
      failed++;
      continue;
    }
    const problems = await checkReadOnlyRouting(mutated);
    if (!problems.length) {
      console.error(`  ✗ mutation "${label}": checkReadOnlyRouting stayed GREEN with the read-only channel broken`);
      failed++;
    }
  }

  if (failed) {
    console.error(`\n✗ check-audit-scope self-test failed (${failed} case(s)).`);
    process.exit(1);
  }
  console.log(`✓ check-audit-scope self-test: ${total} cases pass.`);
}
