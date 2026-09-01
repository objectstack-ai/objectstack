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
//   node scripts/docs-audit/check-audit-scope.mjs --write      # regenerate the artifact from the filesystem
//   node scripts/docs-audit/check-audit-scope.mjs --self-test  # pin the parser/renderer/differ + the read-only routing + the injection contract
//
// ## Where the list lives, and why it moved (#13591; maintainer 2026-09-01, 「同意」)
//
// THE single source is `scripts/docs-audit/handwritten-docs.json` — one generated
// file, derived from the filesystem here and consumed by two readers: this gate, and
// whoever invokes the `docs-accuracy-audit` workflow, who reads it and hands the list
// to the workflow body as `args.handwritten`.
//
// It used to be inline in `.claude/workflows/docs-accuracy-audit.js`, as
// `ALL_HANDWRITTEN`, and the argument for that was real as far as it went: a workflow
// script runs inside a `node:vm` context whose only globals are `log/phase/console/
// budget/setTimeout/clearTimeout` plus `agent/parallel/pipeline/workflow/args`, with
// `codeGeneration` disabled — no `require`, no `import`, no filesystem, no `eval`. The
// body can neither enumerate `content/docs/**` nor open a JSON file.
//
// What that argument missed is that the body does not have to do the reading. `args`
// IS an injection channel: the runner delivers it verbatim from the invocation, so the
// file read happens in the CALLER, outside the sandbox, and the list arrives as data.
// The sandbox stays exactly as FS-blind as before.
//
// The cost of the inline form was paid by every unrelated PR. `.claude/**` is a
// governed surface — human-merge-only, never armed, never queued — so adding one
// customer documentation page forced an edit to a governed file, through a bookkeeping
// list that merely happened to live there. Worse, it was invisible at dispatch time:
// nothing in such a card's file list showed a governed path until the gate ran. The
// maintainer ruled the list off that surface; the governed register itself is untouched,
// and narrowing it was considered and explicitly rejected.
//
// ## Why the list is generated at all (#4851)
//
// It was once hand-kept, with a comment asking the next author to "keep in sync
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
// `--write` regenerates the artifact from that derivation, byte for byte. Hand-editing
// it is never necessary and this check will reject it — including a merely reordered
// list, because a hand-edited artifact has stopped being generated output whatever it
// happens to contain.
//
// ## The injection contract is checked by RUNNING the workflow, not by grepping it
//
// Moving the list out creates one failure mode that did not exist before: the workflow
// could stop reading what it is handed — an edit that renames the arg, reinstates a
// default, or drops the refusal — and this gate would still report the artifact in
// sync with `content/docs/` while every full audit ran over nothing, or over whatever
// stale shape the body invented. The artifact being correct says nothing about the body
// consuming it. So `checkScopeInjection` runs the real workflow against stub agents and
// observes what it does with an injected list, with a scoped list, and with neither;
// `--self-test` then mutates each of those behaviours out of an in-memory copy and
// requires the check to go red, because a guard nobody has seen fail is a guard nobody
// has tested (#4868).
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
import { isEntrypoint } from '../invoked-as.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: HERE })
  .toString()
  .trim();

const WORKFLOW_REL = '.claude/workflows/docs-accuracy-audit.js';
const AGENTS_REL = 'AGENTS.md';

/**
 * `AGENTS_REL` above, declared for `scripts/pm/dispatch-gates.mjs` (#9979,
 * applying #9964's pattern).
 *
 * That tool derives a card's gate list from the path literals in each gate's
 * own source, and "looks like a path" there means "carries a separator".
 * `WORKFLOW_REL` has one and reaches it; `AGENTS_REL` does not, because a
 * repo-root FILE has no separator to be found by — so an AGENTS.md card
 * derived this gate not at all, while `assertGuardrailAnchored` reddens on
 * exactly the edit such a card is most likely to make (moving or rewording the
 * RELEASE-OWNED guardrail row). `<file>/**` is the form that reaches a root
 * file: the extractor accepts it, and `collapseHint` reduces it back to that
 * one path.
 *
 * ⚠️ Provenance, NOT a lookup key. `assertGuardrailAnchored` opens
 * `AGENTS_REL`; the glob spelling appearing there would send this gate reading
 * a file that does not exist. The self-test pins both halves.
 */
export const ROOT_FILE_WATCH_HINTS = ['AGENTS.md/**'];

/**
 * THE single source: the one hand-kept-nowhere, generated-here list of hand-written
 * docs. Two readers — this gate, and the caller that hands it to the workflow body.
 * Deliberately outside `.claude/**` and outside every other governed glob (see the
 * header): an audit's page list is bookkeeping, and it must not make an unrelated
 * docs PR human-merge-only.
 */
export const SCOPE_ARTIFACT_REL = 'scripts/docs-audit/handwritten-docs.json';

/**
 * The `args` key the workflow body reads its full scope from. Named here because
 * `checkScopeInjection` asserts against the REAL workflow through it: rename the arg
 * in one place and the observed run stops matching, which is the point.
 */
export const SCOPE_ARG = 'handwritten';

/**
 * The release-owned boundary — the path column of AGENTS.md's RELEASE-OWNED guardrail
 * row, verbatim. Not a curation of it: `assertGuardrailAnchored` fails if AGENTS.md
 * stops declaring exactly this, so the rule and its enforcement cannot drift apart.
 */
export const RELEASE_OWNED_PREFIX = 'content/docs/releases/';
export const isReleaseOwned = (doc) => doc.startsWith(RELEASE_OWNED_PREFIX);

const args = process.argv.slice(2);

// --- the artifact: parsing / rendering ---------------------------------------

/**
 * The doc paths declared by the artifact, or throw.
 *
 * An unreadable or shapeless artifact is a HARD failure, not a skip. This gate's whole
 * subject is a list that quietly stopped matching reality; a version of it that shrugs
 * when it cannot find that list would reproduce the defect one level up (#4690's shape:
 * no manifest, exit 0).
 */
export function parseArtifact(source) {
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (e) {
    throw new Error(
      `${SCOPE_ARTIFACT_REL}: not valid JSON (${e.message}). It is generated output — ` +
        `regenerate it with \`node scripts/docs-audit/check-audit-scope.mjs --write\` rather ` +
        `than hand-editing it.`,
    );
  }
  const docs = parsed?.docs;
  if (!Array.isArray(docs) || docs.some((d) => typeof d !== 'string')) {
    throw new Error(
      `${SCOPE_ARTIFACT_REL}: no \`docs\` array of string paths. That array IS the audit ` +
        `scope — the workflow is handed it as \`args.${SCOPE_ARG}\` and this gate holds it ` +
        `equal to content/docs/. Regenerate with \`--write\`.`,
    );
  }
  return docs;
}

/**
 * The exact bytes the artifact must contain for a given doc set. Byte-comparing against
 * this is what makes hand-edits — including a merely reordered list — visible.
 *
 * The `readme` block is part of the generated bytes on purpose: JSON carries no
 * comments, and an artifact that cannot say what it is invites the next reader to treat
 * it as a hand-kept list, which is the exact thing it exists to stop being.
 */
export function renderArtifact(docs) {
  return `${JSON.stringify(
    {
      readme: [
        'GENERATED — do not hand-edit. `node scripts/docs-audit/check-audit-scope.mjs --write`',
        'derives this from the filesystem (every content/docs/**/*.mdx except references/,',
        'via `affected-docs.mjs --all`); the same script without --write is a CI gate that',
        'fails when this file and content/docs/ disagree in EITHER direction.',
        '',
        'THIS FILE IS THE SINGLE SOURCE for "which docs are hand-written". Two consumers:',
        '  1. .claude/workflows/docs-accuracy-audit.js — its body runs in a sandbox with no',
        '     filesystem, so the CALLER reads this file and passes `docs` as args.handwritten.',
        '  2. scripts/docs-audit/check-audit-scope.mjs — the gate that keeps it honest.',
        'There is deliberately no second copy anywhere; one subject, one list.',
        '',
        'It lives here, outside .claude/** and outside every other governed surface, by',
        'maintainer ruling (2026-09-01). Inline, it made every PR that added a documentation',
        'page a human-merge-only PR — a governed edit forced by bookkeeping, invisible until',
        'the gate ran. Moving it is NOT a narrowing of the governed register, which is',
        'unchanged; do not treat this file as precedent for relocating anything else.',
      ],
      generator: 'node scripts/docs-audit/check-audit-scope.mjs --write',
      gate: 'pnpm check:docs-audit-scope',
      docs: [...docs].sort(),
    },
    null,
    2,
  )}\n`;
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

/** The two probe docs, as a list handed in the way a real full audit hands one in. */
const INJECTION_PROBE = [PROBE_EDITABLE, PROBE_RELEASE];

/**
 * The injection contract, observed on a real run.
 *
 * The artifact being in sync with `content/docs/` says NOTHING about the workflow body
 * consuming it — that is the one new failure mode created by moving the list out, and
 * it is silent by construction: a body that ignored `args.${SCOPE_ARG}` would leave this
 * gate green while every full audit ran over the wrong set. Grepping the source cannot
 * tell a working read from a dead one, so this observes behaviour: what a handed-in list
 * is actually audited, what a run with nothing handed in does, and whether the narrowing
 * channel still narrows.
 *
 * Returns a list of human-readable problems; empty means the contract holds.
 */
export async function checkScopeInjection(source) {
  const problems = [];
  const stub = ({ prompt, phase, schema }) =>
    phase === 'Scope Preflight' ? preflightResponse(prompt) : stubFor(schema, { doc: '' });
  const audits = (calls) => calls.filter((c) => c.phase === 'Audit & Fix');

  // 1. The injected list IS the scope, and the run says which list it audited.
  const injected = await runWorkflow(source, { workflowArgs: { [SCOPE_ARG]: INJECTION_PROBE }, respond: stub });
  if (injected.error) {
    problems.push(`the workflow threw on a run whose scope was handed in as args.${SCOPE_ARG}: ${injected.error.message}`);
  } else {
    const seen = audits(injected.calls);
    if (seen.length !== INJECTION_PROBE.length) {
      problems.push(
        `args.${SCOPE_ARG} carried ${INJECTION_PROBE.length} doc(s) but ${seen.length} reached an ` +
          'audit-phase agent — the body is not auditing what it was handed',
      );
    }
    if (!injected.logs.some((l) => l.includes('FULL audit') && l.includes(SCOPE_ARTIFACT_REL))) {
      problems.push(
        `a run scoped by args.${SCOPE_ARG} did not report itself as a FULL audit naming ` +
          `${SCOPE_ARTIFACT_REL} — the summary has to say which list it audited, or a truncated ` +
          'list reads exactly like the whole corpus',
      );
    }
  }

  // 2. Nothing handed in must REFUSE, naming the artifact and the arg. A body that
  //    invents a default here is how the list silently rots back into existence.
  for (const [label, workflowArgs] of [
    ['no args at all', undefined],
    ['an args object carrying neither key', {}],
  ]) {
    const bare = await runWorkflow(source, { workflowArgs, respond: stub });
    if (!bare.error) {
      problems.push(
        `${label}: the workflow ran instead of refusing — with no list handed in it cannot know ` +
          'what "everything" is, so whatever it audited it would report as a result',
      );
      continue;
    }
    if (!bare.error.message.includes(SCOPE_ARTIFACT_REL) || !bare.error.message.includes(`args.${SCOPE_ARG}`)) {
      problems.push(
        `${label}: the refusal names neither ${SCOPE_ARTIFACT_REL} nor args.${SCOPE_ARG}, so it does ` +
          `not tell the caller what to pass — got: ${bare.error.message.slice(0, 160)}`,
      );
    }
    if (audits(bare.calls).length) problems.push(`${label}: audit-phase agents were spawned before the refusal`);
  }

  // 3. A malformed injected list is a CALLER BUG, never an empty audit.
  for (const [label, value] of [
    ['an empty array', []],
    ['a bare string', PROBE_EDITABLE],
    ['an array holding a non-string', [PROBE_EDITABLE, 7]],
  ]) {
    const bad = await runWorkflow(source, { workflowArgs: { [SCOPE_ARG]: value }, respond: stub });
    if (!bad.error) {
      problems.push(`args.${SCOPE_ARG} = ${label} did not fail the run — an audit of nothing must never report success`);
    } else if (!bad.error.message.includes(`args.${SCOPE_ARG}`)) {
      // It failed, but not BY NAME. A body with no shape guard still dies somewhere
      // downstream on a malformed list, with a message that sends the caller reading
      // the audit instead of their own invocation.
      problems.push(
        `args.${SCOPE_ARG} = ${label} failed without naming args.${SCOPE_ARG} as the caller bug — ` +
          `got: ${bad.error.message.slice(0, 160)}`,
      );
    }
  }

  // 4. The narrowing channel still narrows, and does not claim to be a full audit.
  const scoped = await runWorkflow(source, { workflowArgs: { docs: [PROBE_EDITABLE] }, respond: stub });
  if (scoped.error) {
    problems.push(`args.docs no longer scopes a run: ${scoped.error.message}`);
  } else if (scoped.logs.some((l) => l.includes('FULL audit'))) {
    problems.push('a run scoped by args.docs called itself a FULL audit — the two channels have collapsed into one');
  }

  return problems;
}

// --- main --------------------------------------------------------------------

// Exports bindings, so an import for those exports alone must run nothing (#10667).
if (isEntrypoint(import.meta.url)) {
  try {
    if (args.includes('--self-test')) {
      await selfTest();
      process.exit(0);
    }
    await main();
  } catch (e) {
    // A structural failure (markers gone, list unparseable, derivation empty) is
    // a RED result with a readable reason — never a stack trace, never a pass.
    console.error(`✗ ${e.message}`);
    process.exit(1);
  }
}

/** The artifact's bytes, or null when it does not exist yet (`--write` seeds it). */
function readArtifact(artifactPath) {
  try {
    return readFileSync(artifactPath, 'utf8');
  } catch (e) {
    if (e?.code === 'ENOENT') return null;
    throw e;
  }
}

async function main() {
  const workflowPath = join(REPO_ROOT, WORKFLOW_REL);
  const artifactPath = join(REPO_ROOT, SCOPE_ARTIFACT_REL);
  const source = readFileSync(workflowPath, 'utf8');
  const derived = deriveDocs();

  if (args.includes('--write')) {
    const existing = readArtifact(artifactPath);
    const before = existing === null ? [] : parseArtifact(existing);
    writeFileSync(artifactPath, renderArtifact(derived));
    const { dead, unlisted } = diffScope(before, derived);
    console.log(
      `✓ regenerated ${SCOPE_ARTIFACT_REL}: ${derived.length} hand-written doc(s) ` +
        `(+${unlisted.length} added, -${dead.length} removed).`,
    );
    return;
  }

  const raw = readArtifact(artifactPath);
  if (raw === null) {
    console.error(
      `✗ ${SCOPE_ARTIFACT_REL} does not exist.\n\n` +
        `  That file is THE single source for the audit's page scope — the workflow is handed\n` +
        `  its \`docs\` array as \`args.${SCOPE_ARG}\`, and this gate holds it equal to content/docs/.\n` +
        `  A missing subject is a RED result, never a pass by vacancy.\n\n` +
        `  Fix: node scripts/docs-audit/check-audit-scope.mjs --write\n`,
    );
    process.exit(1);
  }
  const listed = parseArtifact(raw);
  const { dead, unlisted, duplicates } = diffScope(listed, derived);
  // Byte-compare too: correct paths in a hand-edited shape still means the artifact
  // stopped being generated output, and the next `--write` would churn.
  const blockDrift = raw !== renderArtifact(derived);

  if (!dead.length && !unlisted.length && !duplicates.length && !blockDrift) {
    console.log(
      `✓ docs-accuracy-audit scope is in sync with content/docs/: ${listed.length} hand-written doc(s) ` +
        `(${SCOPE_ARTIFACT_REL}).`,
    );
    await checkReleaseOwned(source, derived);
    await checkInjection(source);
    return;
  }

  console.error(`✗ ${SCOPE_ARTIFACT_REL}: the hand-written doc list has drifted from content/docs/.\n`);
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
      '  The listed paths are correct but the file does not match its rendered form —\n' +
        '  ordering, formatting or the readme block was hand-edited.\n',
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

/**
 * The other half of "one list, correctly consumed": the artifact is in sync, and the
 * workflow really reads what it is handed. Neither implies the other.
 */
async function checkInjection(source) {
  const problems = await checkScopeInjection(source);
  if (problems.length) {
    console.error(`✗ ${WORKFLOW_REL}: it does not consume the scope it is handed.\n`);
    for (const p of problems) console.error(`    - ${p}`);
    console.error(
      `\n  Observed by running the workflow against stub agents. ${SCOPE_ARTIFACT_REL} is THE\n` +
        `  single source; the body runs in a sandbox with no filesystem, so the caller reads that\n` +
        `  file and hands the list in as \`args.${SCOPE_ARG}\`. An artifact in sync with content/docs/\n` +
        `  proves nothing about a body that has stopped reading it.\n`,
    );
    process.exit(1);
  }
  console.log(
    `✓ scope injection is live: the workflow audits the list handed in as args.${SCOPE_ARG}, ` +
      `and refuses an invocation that hands in no scope at all.`,
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
  const artifact = renderArtifact(docs);

  check('parseArtifact round-trips the rendered artifact', docs, parseArtifact(artifact));
  check('renderArtifact sorts', ['a', 'b'], parseArtifact(renderArtifact(['b', 'a'])));
  check('renderArtifact is order-insensitive byte-for-byte', artifact, renderArtifact([...docs].reverse()));
  // The artifact carries no comments (JSON), so the bytes have to say what it is —
  // otherwise the next reader treats a generated file as a hand-kept one.
  check(
    'the rendered artifact declares itself the single source and names its consumer arg',
    [true, true, true],
    [artifact.includes('SINGLE SOURCE'), artifact.includes(`args.${SCOPE_ARG}`), artifact.includes('--write')],
  );
  check('…and ends with exactly one trailing newline', [true, false], [artifact.endsWith('}\n'), artifact.endsWith('\n\n')]);

  // A gate that cannot find its subject must fail, not pass. This is the exact
  // failure mode the gate exists to prevent, applied to the gate itself.
  throws('unparseable JSON throws', () => parseArtifact('{ not json'), 'not valid JSON');
  throws('an artifact with no docs array throws', () => parseArtifact('{"readme":[]}'), 'no `docs` array of string paths');
  throws(
    'a docs array holding a non-string throws',
    () => parseArtifact('{"docs":["content/docs/a.mdx",7]}'),
    'no `docs` array of string paths',
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
  // The dispatch-gates declaration (#9979). Enforcement cannot hold either of
  // these: the declaration is read by another tool entirely, so a wrong or
  // missing entry runs perfectly green here and shows up only as a dev
  // dispatched on an AGENTS.md card with this gate absent from the brief.
  check('the repo-root file this gate reads is declared for dispatch-gates', [`${AGENTS_REL}/**`], ROOT_FILE_WATCH_HINTS);
  // Provenance, never a lookup key: `assertGuardrailAnchored` opens
  // `AGENTS_REL`, so the glob form appearing there would read a missing file.
  check('…and the declared form is not the path the gate opens', false, ROOT_FILE_WATCH_HINTS.includes(AGENTS_REL));

  throws(
    'a workflow without the prefix constant throws',
    () => parseReleaseOwnedPrefix('const SCOPE_SOURCE = ""'),
    'no `const RELEASE_OWNED_PREFIX',
  );

  const workflowSource = readFileSync(join(REPO_ROOT, WORKFLOW_REL), 'utf8');

  // The list left this file by ruling, and nothing may quietly bring it back: a second
  // copy inside the sandbox body is the "one subject, two hand-kept lists" bill again,
  // and this time it would also restore the governed-edit toll on every docs PR.
  check(
    'the workflow body carries no inline copy of the list',
    [false, false],
    [/const ALL_HANDWRITTEN\s*=/.test(workflowSource), workflowSource.includes('generated:docs-audit-scope')],
  );
  check(
    'the workflow names the artifact it is handed, and the arg it arrives in',
    [true, true],
    [workflowSource.includes(SCOPE_ARTIFACT_REL), workflowSource.includes(`const SCOPE_ARG = '${SCOPE_ARG}'`)],
  );

  // (1) Still in scope. #4920's rejected option was deleting these pages from the
  //     audit; that would show up right here, as an empty list.
  check(
    'release pages are still IN the audit scope',
    true,
    parseArtifact(readFileSync(join(REPO_ROOT, SCOPE_ARTIFACT_REL), 'utf8')).filter(isReleaseOwned).length > 0,
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

  // --- the injection contract (#13591) ---------------------------------------
  //
  // Same discipline, one layer over: the list now arrives from outside, so the thing
  // that can silently break is the BODY's consumption of it, not the list. Observed on
  // the real workflow, then broken four ways in memory — each way is a shape a
  // plausible future edit takes, and each must be seen to go red.
  check('the workflow consumes the scope it is handed', [], await checkScopeInjection(workflowSource));

  const injectionMutants = [
    // The read goes dead: the body is handed a list and ignores it.
    ['the injected list is ignored', [
      ['args && Array.isArray(args[SCOPE_ARG]) && args[SCOPE_ARG].length ? args[SCOPE_ARG] : null', 'null'],
    ]],
    // The refusal is replaced by a silent default — an audit of nothing, reported as a
    // result. This is the exact shape the loud-failure rule above exists to stop.
    ['a silent default replaces the no-scope refusal', [
      ['if (!SCOPED && !HANDWRITTEN) {', 'if (false) {'],
      ['const DOCS = SCOPED ?? HANDWRITTEN', 'const DOCS = SCOPED ?? HANDWRITTEN ?? []'],
    ]],
    // The summary stops saying WHICH list it audited: a truncated hand-in then reads
    // exactly like the whole corpus.
    ['the FULL-audit line stops naming the scope source', [
      [' — FULL audit (whole hand-written set from ${SCOPE_SOURCE})', ' — FULL audit'],
    ]],
    // The shape guard goes: a malformed hand-in dies somewhere downstream instead of
    // naming the caller's own key.
    ['the malformed-list guard is removed', [
      ["for (const key of ['docs', SCOPE_ARG]) {", 'for (const key of []) {'],
    ]],
  ];
  for (const [label, replacements] of injectionMutants) {
    total++;
    let mutated = workflowSource;
    let missed = null;
    for (const [from, to] of replacements) {
      const next = mutated.replace(from, to);
      if (next === mutated) { missed = from; break; }
      mutated = next;
    }
    if (missed !== null) {
      console.error(`  ✗ injection mutation "${label}" did not apply (anchor not found: ${JSON.stringify(missed)}) — it cannot prove anything. Update the mutation to match the current source.`);
      failed++;
      continue;
    }
    const problems = await checkScopeInjection(mutated);
    if (!problems.length) {
      console.error(`  ✗ injection mutation "${label}": checkScopeInjection stayed GREEN with the hand-in broken`);
      failed++;
    }
  }

  if (failed) {
    console.error(`\n✗ check-audit-scope self-test failed (${failed} case(s)).`);
    process.exit(1);
  }
  console.log(`✓ check-audit-scope self-test: ${total} cases pass.`);
}
