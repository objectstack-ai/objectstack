#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-drift-comment (#11357) — pin what the docs-drift advisory's HEADLINE says about
 * the part of a diff it could not see, by RUNNING the comment script the workflow ships
 * against real mapper output from fixture diffs.
 *
 *   node scripts/docs-audit/check-drift-comment.mjs           # verdict
 *   node scripts/docs-audit/check-drift-comment.mjs --print   # + every rendered headline
 *
 * ## The defect this pins closed
 *
 * `affected-docs.mjs` derives an anchor from a symbol, a wire route, an SDK method, a CLI
 * command phrase or a `@docs-rule` block. A README has none of those, so a README-only
 * diff derives nothing, and the advisory used to answer it with:
 *
 *   Nothing in this diff resolved to a documentable surface (no symbol, route or SDK
 *   anchor derived from 1 changed package(s)), so **this run has no opinion** about the docs.
 *
 * The run was already honest — it named the unanchorable file — but only inside the
 * collapsed "What this run could not see" fold. The headline a reviewer actually reads
 * said "no opinion", which reads as "nothing to check". Two real README defects landed
 * that way on one day (#11180, #11262), neither detectable by this check on any run.
 *
 * ## Why this file spawns fixtures instead of grepping the workflow
 *
 * The wording lives in an inline `actions/github-script` block, so nothing type-checks it
 * and no unit test imports it. A source grep would pass on text that is never REACHED, and
 * — the failure mode that matters here — it would also pass on text emitted
 * UNCONDITIONALLY, which is not a report at all. A blind-spot notice that renders on every
 * run says nothing about any run.
 *
 * So both directions are measured end to end, from a git diff:
 *
 *   diff → the real affected-docs.mjs → its real --json → the real comment script → bytes
 *
 * Each case declares the mapper facts it depends on (`anchors` / `anchorless` / `docs`)
 * and those are asserted BEFORE the rendered text is. Without that, a change in how the
 * mapper classifies a `.md` file would quietly move every case onto the same branch and
 * leave this gate green while testing nothing — the vacuity it exists to prevent.
 *
 * Dependency-free on purpose: `docs-drift-check.yml` runs no `pnpm install` (see
 * `check-affected-docs.mjs`), so this gate must run on a bare checkout with node + git.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';

const HERE = dirname(new URL(import.meta.url).pathname);
const REPO_ROOT = join(HERE, '..', '..');
const WORKFLOW = join(REPO_ROOT, '.github', 'workflows', 'docs-drift-check.yml');
const MAPPER = join(HERE, 'affected-docs.mjs');
const PRINT = process.argv.includes('--print');

let failed = 0;
let total = 0;
function check(scope, label, want, got) {
  total++;
  const ok = want === got;
  if (!ok) {
    failed++;
    console.error(`✗ ${scope}: ${label}\n    expected: ${JSON.stringify(want)}\n    actual:   ${JSON.stringify(got)}`);
  }
  return ok;
}

// ---------------------------------------------------------------------------
// 1. The script the workflow actually ships.
//
// Hand-rolled block-scalar read rather than a YAML dependency — see the no-install
// contract above. It is deliberately strict: an unrecognised shape ABORTS. A parser that
// shrugs and returns nothing here would hand every assertion below an empty string to
// pass against, which is this gate failing open on the one file it exists to read.
// ---------------------------------------------------------------------------
function commentScriptFrom(yamlText) {
  const lines = yamlText.split('\n');
  const stepAt = lines.findIndex((l) => /^\s*- name: Comment on PR\s*$/.test(l));
  if (stepAt === -1) throw new Error('no `- name: Comment on PR` step in docs-drift-check.yml — the advisory comment moved or was renamed');
  const scriptAt = lines.findIndex((l, i) => i > stepAt && /^\s*script: \|\s*$/.test(l));
  if (scriptAt === -1) throw new Error('the `Comment on PR` step no longer carries a `script: |` block');
  const indent = (lines[scriptAt].match(/^\s*/) || [''])[0].length + 2;
  const body = [];
  for (let i = scriptAt + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') { body.push(''); continue; }
    if ((line.match(/^\s*/) || [''])[0].length < indent) break;
    body.push(line.slice(indent));
  }
  const text = body.join('\n').trim();
  if (!text) throw new Error('the `Comment on PR` script block is empty');
  return text;
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const realRequire = createRequire(import.meta.url);

/**
 * Run the comment script the way `actions/github-script` does — as an async function body
 * over `github` / `context` / `core` / `require` — and return the comment body it posted.
 * Every stub is inert except the two that carry the answer out: `fs.readFileSync` feeds it
 * this case's `affected.json`, and `issues.createComment` captures the bytes.
 */
async function renderComment(scriptText, affectedJson, { headSha = 'f'.repeat(40) } = {}) {
  let posted = null;
  const fsStub = {
    ...realRequire('fs'),
    readFileSync: (path, enc) => (String(path).endsWith('affected.json') ? affectedJson : realRequire('fs').readFileSync(path, enc)),
  };
  const github = {
    rest: {
      issues: {
        listComments: async () => ({ data: [] }),
        createComment: async ({ body }) => { posted = body; return { data: {} }; },
        updateComment: async ({ body }) => { posted = body; return { data: {} }; },
      },
    },
  };
  const context = {
    payload: { pull_request: { base: { ref: 'main' }, head: { sha: headSha } } },
    repo: { owner: 'objectstack-ai', repo: 'objectstack' },
    issue: { number: 1 },
  };
  const core = {
    info: () => {},
    warning: () => {},
    summary: { addRaw() { return this; }, async write() { return this; } },
  };
  const fn = new AsyncFunction('github', 'context', 'core', 'require', scriptText);
  await fn(github, context, core, (id) => (id === 'fs' || id === 'node:fs' ? fsStub : realRequire(id)));
  if (posted === null) throw new Error('the comment script posted nothing — no createComment/updateComment call');
  return posted;
}

// ---------------------------------------------------------------------------
// 2. Fixture diffs, run through the real mapper.
//
// A throwaway git repo per case, because the mapper's answer IS a git diff: anything less
// than a real one would be this file asserting against its own idea of the JSON shape.
// `MAX_WIDGETS` is the anchorable symbol on purpose — an ALL-CAPS name is excluded from
// the sdk route bridge, so these repos (which declare no route ledger) do not trip the
// bridge's broken-scan verdicts and the fixture stays about the headline.
// ---------------------------------------------------------------------------
const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'fixture', GIT_AUTHOR_EMAIL: 'fixture@objectstack.ai',
  GIT_COMMITTER_NAME: 'fixture', GIT_COMMITTER_EMAIL: 'fixture@objectstack.ai',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
};
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env: GIT_ENV, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
const put = (root, rel, text) => { mkdirSync(join(root, dirname(rel)), { recursive: true }); writeFileSync(join(root, rel), text); };

const BASE_TREE = {
  'packages/demo/package.json': '{ "name": "@objectstack/demo", "version": "1.0.0" }\n',
  'packages/demo/src/widget.ts': 'export function renderWidget(x: number) {\n  return x + 1;\n}\n',
  'packages/demo/README.md': '# @objectstack/demo\n\nRun `os demo` to start.\n',
};

/** Build the repo, apply the case's change, and return the mapper's real `--json`. */
function mapperJsonFor(caseDef, workdir) {
  const root = join(workdir, caseDef.id);
  mkdirSync(root, { recursive: true });
  git(root, 'init', '-q', '-b', 'main', '.');
  for (const [rel, text] of Object.entries({ ...BASE_TREE, ...caseDef.base })) put(root, rel, text);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'base');
  const base = git(root, 'rev-parse', 'HEAD').trim();
  for (const [rel, text] of Object.entries(caseDef.change)) put(root, rel, text);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'change');
  // Written OUTSIDE the fixture repo: an untracked artefact inside it would make the
  // mapper report `dirty: true` and change the comment it renders.
  return execFileSync(process.execPath, [MAPPER, '--json', base], { cwd: root, env: GIT_ENV, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
}

const NAMES_NOTHING = '# Guide\n\nThis page documents the demo package in prose only.\n';
const NAMES_THE_ANCHOR = '# Guide\n\nThe cap is `MAX_WIDGETS`, and it bounds the widget list.\n';
const ADDS_ANCHOR = 'export function renderWidget(x: number) {\n  return x + 1;\n}\n\nexport const MAX_WIDGETS = 5;\n';
const README_EDITED = '# @objectstack/demo\n\nRun `os demo` to start. Then run `os demo studio` for the UI.\n';

/**
 * `want` is the mapper contract each case rides on — asserted before any text is, so a
 * case that silently stopped exercising its branch fails here instead of passing there.
 */
const CASES = [
  {
    id: 'readme-only',
    what: 'a README-only diff — the specimen from #11180 / #11262',
    base: { 'content/docs/guide.mdx': NAMES_NOTHING },
    change: { 'packages/demo/README.md': README_EDITED },
    want: { anchors: 0, anchorless: ['packages/demo/README.md'], docs: 0 },
    expect: (headline, body) => {
      check('readme-only', 'the headline names the blind spot', true, headline.includes('NOT COVERED by this run'));
      check('readme-only', 'the headline names the file that went unanchored', true, headline.includes('packages/demo/README.md'));
      check('readme-only', 'the headline no longer leads with "no opinion"', false, headline.includes('this run has no opinion'));
      check('readme-only', 'and it refuses the clean-bill reading in words', true, headline.includes('not a clean bill of health'));
      check('readme-only', 'the honest detail line survives in the fold', true, body.includes('pages documenting those are invisible to this run'));
    },
  },
  {
    id: 'anchored-source',
    what: 'an anchorable source file, no page naming it — the ✅ arm',
    base: { 'content/docs/guide.mdx': NAMES_NOTHING },
    change: { 'packages/demo/src/widget.ts': ADDS_ANCHOR },
    want: { anchors: 1, anchorless: [], docs: 0 },
    expect: (headline) => {
      check('anchored-source', 'the blind-spot sentence does NOT render — it is a report, not boilerplate',
        false, headline.includes('NOT COVERED'));
      check('anchored-source', 'the headline is the untouched ✅ text', true,
        headline === '**1** anchor(s) derived from **1** changed package(s); no hand-written page names any of them. ✅');
    },
  },
  {
    id: 'anchored-and-anchorless',
    what: 'a mixed diff — an anchor derived AND a file left unanchored',
    base: { 'content/docs/guide.mdx': NAMES_NOTHING },
    change: { 'packages/demo/src/widget.ts': ADDS_ANCHOR, 'packages/demo/README.md': README_EDITED },
    want: { anchors: 1, anchorless: ['packages/demo/README.md'], docs: 0 },
    expect: (headline) => {
      check('anchored-and-anchorless', 'the derived anchors are still reported', true, headline.startsWith('**1** anchor(s) derived'));
      check('anchored-and-anchorless', 'and the unanchored file is reported beside them', true, headline.includes('NOT COVERED by this run'));
      check('anchored-and-anchorless', 'the ✅ is withheld — a partial look is not a clean bill', false, headline.includes('✅'));
    },
  },
  {
    id: 'docs-listed',
    what: 'an anchor a page names — the work-list branch, nothing unanchored',
    base: { 'content/docs/guide.mdx': NAMES_THE_ANCHOR },
    change: { 'packages/demo/src/widget.ts': ADDS_ANCHOR },
    want: { anchors: 1, anchorless: [], docs: 1 },
    expect: (headline, body) => {
      check('docs-listed', 'the work-list headline is unchanged', true,
        headline === 'This PR changes **1** package(s): `@objectstack/demo`, touching **1** documentable anchor(s).');
      check('docs-listed', 'the page is still listed', true, body.includes('- `content/docs/guide.mdx`'));
    },
  },
  {
    id: 'no-package-change',
    what: 'nothing under packages/ changed — the benign "no opinion" run',
    base: { 'content/docs/guide.mdx': NAMES_NOTHING },
    change: { 'content/docs/guide.mdx': `${NAMES_NOTHING}\nOne more line.\n` },
    want: { anchors: 0, anchorless: [], docs: 0 },
    expect: (headline) => {
      check('no-package-change', 'the original headline is preserved byte-for-byte', true,
        headline === 'Nothing in this diff resolved to a documentable surface (no symbol, route or SDK anchor derived from **0** changed package(s)), so **this run has no opinion** about the docs.');
      check('no-package-change', 'and it carries no blind-spot sentence', false, headline.includes('NOT COVERED'));
    },
  },
];

// ---------------------------------------------------------------------------
// 3. Run them.
// ---------------------------------------------------------------------------
if (!existsSync(WORKFLOW)) {
  console.error(`✗ check-drift-comment: ${WORKFLOW} does not exist.`);
  process.exit(2);
}
const scriptText = commentScriptFrom(readFileSync(WORKFLOW, 'utf8'));
const workdir = mkdtempSync(join(tmpdir(), 'drift-comment-'));
try {
  for (const c of CASES) {
    const json = mapperJsonFor(c, workdir);
    const data = JSON.parse(json);
    // The mapper contract first — see `want` above.
    check(c.id, `mapper: ${c.what} derives ${c.want.anchors} anchor(s)`, c.want.anchors, (data.anchors || []).length);
    check(c.id, 'mapper: the anchorless set is what this case rides on', JSON.stringify(c.want.anchorless), JSON.stringify(data.anchorlessChanges || []));
    check(c.id, 'mapper: the doc row count is what this case rides on', c.want.docs, (data.docs || []).length);
    const body = await renderComment(scriptText, json);
    const lines = body.split('\n');
    check(c.id, 'the comment keeps its dedup marker', '<!-- docs-drift-check -->', lines[0]);
    check(c.id, 'the comment keeps its heading', '### 📓 Docs Drift Check', lines[1]);
    const headline = lines[2];
    if (PRINT) console.log(`\n── ${c.id} — ${c.what}\n${headline}\n`);
    c.expect(headline, body);
  }
} finally {
  rmSync(workdir, { recursive: true, force: true });
}

if (failed) {
  console.error(`\n✗ check-drift-comment: ${failed} of ${total} case(s) failed.`);
  process.exit(1);
}
console.log(`✓ check-drift-comment: ${total} cases pass across ${CASES.length} fixture diff(s).`);
