#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-docs-transcript-drift (#15373) — every CLI transcript embedded in
 * `content/docs/**` that quotes a number a LIVE REGISTRY produces must declare
 * which transcript it is, and the number it prints must equal the number the
 * registry derives today.
 *
 *   node scripts/docs-audit/check-docs-transcript-drift.mjs
 *   node scripts/docs-audit/check-docs-transcript-drift.mjs --list       # every transcript block and its verdict
 *   node scripts/docs-audit/check-docs-transcript-drift.mjs --self-test  # prove the battery can go red
 *
 * ## The defect
 *
 * `content/docs` teaches with pasted CLI output. Some of those lines quote a
 * number the CLI computes at runtime from a registry:
 *
 *     `packages/cli/src/commands/validate.ts`
 *       const registered = authoringRulesFor('validate');
 *       printStep(`Running author-time rules (${registered.length})...`);
 *
 * The page writes that number as a literal. Nothing derived it and nothing
 * compared it, so it drifts every time a rule lands — silently. Four published
 * pages carried `41` against a registry holding 42, for as long as it took a
 * customer-simulation upgrade run to notice the CLI printing something else.
 * PR #15369 corrected the four numbers; this gate is the mechanism half.
 *
 * The finding is the SHAPE, not the number: a written value that nothing
 * derives and nothing compares. This file closes it for `content/docs`
 * transcripts, and is built so a second quoted value is one `TOKENS` row.
 *
 * ## How a transcript block says what it is a transcript OF
 *
 * That question had to be answered before either direction could be built, and
 * it was answered by MEASURING the renderer rather than by choosing a syntax.
 * `content/docs` is compiled by `apps/docs` (fumadocs-mdx 15.2.3 / fumadocs-core
 * 16.14.4 / @mdx-js/mdx 3.1.1). Every candidate form below was compiled through
 * the real pipeline — `mdxPreset({})` from `fumadocs-core/content/mdx/
 * preset-bundler`, which is what `defineConfig` in `apps/docs/source.config.ts`
 * resolves to — over the exact transcript body these four pages carry:
 *
 *     A  ```                                  COMPILES
 *     B  ``` transcript=os-validate           COMPILE ERROR — ShikiError:
 *                                             Language `transcript=os-validate`
 *                                             not found, you may need to load it first
 *     C  ```text transcript=os-validate       COMPILES, meta absent from output
 *     D  an HTML comment before the fence     COMPILE ERROR — MDX: "Unexpected
 *                                             character `!` (U+0021) before name
 *                                             … (note: to create a comment in MDX,
 *                                             use {(slash-star) text (star-slash)})"
 *     E  an MDX `{(slash-star) … (star-slash)}` comment before the fence
 *                                             COMPILES, but the text survives INTO
 *                                             the compiled module as a JS comment
 *
 * and two equalities, on the same pipeline:
 *
 *     bare ``` vs ```text                     IDENTICAL compiled output
 *     ```text vs ```text + transcript meta    IDENTICAL compiled output
 *
 * So the declaration is **fence meta on a fence that already names a language**:
 *
 *     ```text transcript=os-validate
 *
 * It costs the reader nothing (the rendered block is byte-identical to the bare
 * fence these pages used) and it costs the renderer nothing (the meta never
 * reaches the output).
 *
 * ⛔ The HTML-comment alternative DOES NOT EXIST in this corpus: MDX rejects
 * HTML comments outright, at parse time, on every page. It was measured rather
 * than assumed because it reads like the obvious fallback.
 *
 * ⛔ And result B is why this gate has a `no-language` finding: a `transcript=`
 * token as the FIRST meta word is read by shiki as the language name and BREAKS
 * THE DOCS BUILD. That is the one way to write this declaration that turns a
 * documentation-accuracy gate into an outage, so the gate refuses it here,
 * where the failure is a line number instead of a red `next build`.
 *
 * ## Why the kind is per COMMAND, and why that is not vocabulary bloat
 *
 * The obvious design is one kind, `os-validate`. It is wrong on this very
 * corpus. Two of the four sites are `os validate` output and one
 * (`deployment/cli.mdx`, under `◆ Compile`) is `os build` output — and those
 * are different derivations:
 *
 *     authoringRulesFor('validate').length   42
 *     authoringRulesFor('build').length      42
 *     authoringRulesFor('lint').length       39      ← measured on d30ccb9bd
 *
 * They agree today for two of the three and DISAGREE for the third, so a single
 * kind would pin a `os lint` transcript to a number that is already wrong, and
 * a rule scoped `commands: ['validate']` would immediately make the other two
 * disagree too. The vocabulary is still tiny: the kinds ARE the registry's own
 * `AuthoringCommand` union, one row each, and a second quoted VALUE is a row in
 * `TOKENS` — not a new kind.
 *
 * ## Why not `check:corpus-claim-drift`
 *
 * Measured against that gate's model rather than assumed (its header is the
 * authority). It is a shrink-only LEXICAL CO-OCCURRENCE ratchet: it asks whether
 * an operator's spelling appears within an N-line window of phrasing naming a
 * semantic the platform does not implement, and it carries a per-file baseline
 * budget. Every part of that model is about WORDS NEAR OTHER WORDS.
 *
 * What is pinned here is an EQUALITY between a decimal literal on a page and an
 * integer a module exports at runtime. There is no phrase to co-occur with, no
 * window to widen, and a baseline row would be exactly wrong: a budget for a
 * count that is simply either right or wrong. Folding this in would have
 * required a second, numeric model inside a lexical gate, keyed on a registry
 * import that gate deliberately does not have (it is dependency-free by design).
 * Two mechanisms, one file, sharing only a corpus.
 *
 * ## Why COMPARE and not STAMP
 *
 * `check:docs-image-tag` stamps, and #15332 was ruled to stamp, and both are
 * right for what they carry: a single generated token whose only true value is
 * the one the release process just produced. A transcript is not that. It is a
 * hand-authored teaching artifact — an elided, annotated, sometimes abbreviated
 * paste — and a stamper would have to own the whole block to own one number
 * inside it. Rewriting prose into a customer-facing page from a script is a
 * much larger claim than checking one integer inside it, and it removes the
 * author's ability to elide. So: compare, name the page and line, let a human
 * type the digit.
 *
 * ## Where this runs, and why NOT next to the other docs gates
 *
 * It derives the number the way the CLI does — by importing the BUILT
 * `@objectstack/lint` — so it needs a `dist/`. Measured on the workflows:
 *
 *   - `lint.yml`'s `Lint & Repo Gates` job, which hosts every other docs gate,
 *     runs `pnpm install` and NEVER builds. Placed there, this gate would exit 3
 *     on every CI run forever — a gate that never measures.
 *   - `ci.yml`'s `Build Core` builds, and hosts `check:dual-build-cjs-loads` for
 *     exactly this reason, but it is gated on the `core` paths filter, which does
 *     NOT include `content/**`. A docs-only PR — the direction that ADDS a stale
 *     transcript — would skip it.
 *   - `lint.yml`'s `Type Check · workspace` lane has NO paths filter, is behind
 *     the required `TypeScript Type Check` context, and already runs
 *     `turbo run build --filter='./packages/*'` (which includes `packages/lint`).
 *
 * So the step sits in that lane, immediately after `Build workspace packages`.
 * It adds no build and no CI minutes; it costs its own wall time only.
 *
 * With no `dist/` it exits 3 (`PREREQUISITE NOT MET`) — never 1 and never a
 * silent 0. An unbuilt tree measured nothing, and that has its own exit code.
 *
 * ## Scope boundary
 *
 * `content/docs/**` only. `docs/audits/**` carries the same transcript lines
 * with `41` in them and is DELIBERATELY out of population: a dated audit record
 * is a historical reading, and "correcting" it would be falsifying it.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { isEntrypoint } from '../invoked-as.mjs';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const REPO_ROOT = resolve(HERE, '..', '..');

/**
 * The page population, as the repo-relative subtree this gate really reads.
 *
 * Spelled as a subtree WITH a separator on purpose: `scripts/pm/dispatch-gates.mjs`
 * derives a dispatch's gate list from the path literals a gate's module body
 * carries, and refuses a separator-less literal as a WORD rather than a path.
 * Same reasoning, same spelling, as `check-docs-single-h1.mjs`.
 */
const PAGE_GLOB = 'content/docs/**';

/** The tree `PAGE_GLOB` names, derived from it so the two cannot drift apart. */
const PAGE_ROOT = PAGE_GLOB.slice(0, PAGE_GLOB.lastIndexOf('/'));

/** `.mdx` only — `defineDocs` compiles these, and `content/docs` holds nothing else. */
const PAGE_EXTENSION = '.mdx';

/**
 * The registry package this gate derives from, and its manifest.
 *
 * Both are here as literals so the dispatch derivation names this gate on a
 * change to EITHER side of the equality it pins — the page, or the registry.
 */
const REGISTRY_PACKAGE_DIR = 'packages/lint';
const REGISTRY_MANIFEST = 'packages/lint/package.json';
const REGISTRY_SOURCE = 'packages/lint/src/authoring-rules.ts';

/** Exit codes. 3 is "nothing was measured" and is NOT a pass and NOT a finding. */
const EXIT_OK = 0;
const EXIT_FINDINGS = 1;
const EXIT_PREREQ = 3;

/**
 * The transcript kinds. The key is what an author writes after `transcript=`;
 * `command` is the `AuthoringCommand` the registry filters by.
 *
 * One row per command, because the counts differ per command (see the header).
 * A second transcript FAMILY — a plugin total, a version banner — is a row in
 * `TOKENS` below, not a row here.
 */
const TRANSCRIPT_KINDS = Object.freeze({
  'os-validate': Object.freeze({ command: 'validate', headline: '`os validate` console output' }),
  'os-build': Object.freeze({ command: 'build', headline: '`os build` / `os compile` console output' }),
  'os-lint': Object.freeze({ command: 'lint', headline: '`os lint` console output' }),
});

/**
 * The registry-derived values a transcript can quote.
 *
 * `pattern` is deliberately narrower than the CLI's whole line: it matches the
 * quoted VALUE in its immediate context, so an elided or reflowed paste still
 * matches while `✗ Author-time rules failed (1 issue)` — a different sentence
 * carrying a different number — does not.
 *
 * `derive` takes the loaded registry module and the kind, so one row serves
 * every kind without the row knowing which kinds exist.
 */
const TOKENS = Object.freeze([
  Object.freeze({
    id: 'author-time-rule-count',
    label: 'the author-time rule count',
    pattern: /author-time rules \((\d+)\)/gi,
    printedAt: 'packages/cli/src/commands/validate.ts / packages/cli/src/commands/compile.ts',
    registrySource: REGISTRY_SOURCE,
    derive: (registry, kind) => registry.authoringRulesFor(kind.command).length,
  }),
]);

/** The declaration token, as it appears in a fence's info string. */
const DECLARATION = /(?:^|\s)transcript=([A-Za-z0-9][A-Za-z0-9._-]*)(?=\s|$)/;

/* ------------------------------------------------------------------ scanning */

/** Every `.mdx` page under `root`, in a stable order. */
export function listPages(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith(PAGE_EXTENSION)) out.push(p);
    }
  };
  if (existsSync(root)) walk(root);
  return out;
}

/**
 * Every fenced code block in `src`, with 1-based line numbers.
 *
 * CommonMark rules this deliberately honours, because getting any of them wrong
 * turns a finding into a miss: up to three leading spaces; a run of three or
 * more backticks or tildes; a closing run of the SAME character, at least as
 * long, with nothing after it; a backtick info string may not contain a
 * backtick. An unclosed fence runs to end of file.
 */
export function fencedBlocks(src) {
  const lines = src.split('\n');
  const blocks = [];
  let open = null;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const m = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(raw);
    if (!open) {
      if (!m) continue;
      const info = m[3];
      if (m[2][0] === '`' && info.includes('`')) continue; // not a fence per CommonMark
      open = { line: i + 1, indent: m[1].length, marker: m[2][0], length: m[2].length, info: info.trim(), body: [] };
      continue;
    }
    if (m && m[2][0] === open.marker && m[2].length >= open.length && m[3].trim() === '') {
      blocks.push({ ...open, closeLine: i + 1 });
      open = null;
      continue;
    }
    open.body.push({ line: i + 1, text: raw });
  }
  if (open) blocks.push({ ...open, closeLine: null });
  return blocks;
}

/**
 * The declaration a fence's info string carries, or `null`.
 *
 * `firstToken` records whether the declaration is the FIRST word of the info
 * string, i.e. whether the fence names no language. That is not a style
 * preference: measured through the real docs pipeline, shiki reads the first
 * meta word as the LANGUAGE and the docs build fails to compile. See the header.
 */
export function declarationOf(info) {
  const m = DECLARATION.exec(info ?? '');
  if (!m) return null;
  const first = (info ?? '').trim().split(/\s+/)[0] ?? '';
  return { kind: m[1], firstToken: first === m[0].trim() };
}

/** Every registry-derived value quoted inside one block. */
export function tokenHits(block) {
  const hits = [];
  for (const token of TOKENS) {
    for (const entry of block.body) {
      // A fresh regex per line: the shared literal is /g and carries lastIndex.
      const re = new RegExp(token.pattern.source, token.pattern.flags);
      let m;
      while ((m = re.exec(entry.text)) !== null) {
        hits.push({ token, line: entry.line, printed: Number(m[1]), matched: m[0] });
      }
    }
  }
  return hits;
}

/* --------------------------------------------------------------- derivation */

/**
 * Load the derivation the CLI itself uses.
 *
 * Resolved through the package's OWN manifest — the `exports['.']` import
 * condition, falling back to `main` — rather than a hard-coded `dist/index.js`,
 * so a package that re-points its entry cannot leave this gate importing a file
 * no consumer loads. Same reading `check-dual-build-cjs-loads` takes.
 *
 * Returns `{ registry }` or `{ prereq }`. A MISSING build is a prerequisite,
 * never a finding. A build that exists but does not export `authoringRulesFor`
 * is a real breakage and is returned as an error, because that is a fact about
 * a tree that WAS measured.
 */
export async function loadRegistry(repoRoot = REPO_ROOT) {
  const manifestPath = join(repoRoot, REGISTRY_MANIFEST);
  if (!existsSync(manifestPath)) {
    return { prereq: `${REGISTRY_MANIFEST} does not exist — this gate cannot find the registry package.` };
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const entryRel = manifest?.exports?.['.']?.import?.default ?? manifest?.main ?? 'dist/index.js';
  const entryPath = join(repoRoot, REGISTRY_PACKAGE_DIR, entryRel.replace(/^\.\//, ''));
  if (!existsSync(entryPath)) {
    return {
      prereq:
        `${REGISTRY_PACKAGE_DIR}/${entryRel.replace(/^\.\//, '')} does not exist — @objectstack/lint is not built.`,
    };
  }
  const registry = await import(pathToFileURL(entryPath).href);
  if (typeof registry.authoringRulesFor !== 'function') {
    return {
      error:
        `${REGISTRY_PACKAGE_DIR}/${entryRel.replace(/^\.\//, '')} exports no \`authoringRulesFor\` — the registry's `
        + 'public entry point moved. The CLI derives the printed count through that function '
        + `(${TOKENS[0].printedAt}); this gate must derive it the same way or it is comparing against a guess.`,
    };
  }
  return { registry };
}

/** `derive(kindName, token)` over a loaded registry module. */
export function derivationFrom(registry) {
  return (kindName, token) => token.derive(registry, TRANSCRIPT_KINDS[kindName]);
}

/* ------------------------------------------------------------------ the scan */

/**
 * Judge one tree. `derive` is a parameter, not a module read, so the self-test
 * can drive every branch on a synthetic registry — the live corpus is green by
 * construction and cannot tell a working gate from a blind one.
 *
 * Returns `{ findings, declared, scanned }`.
 */
export function scanTree(root, derive, repoRoot = REPO_ROOT) {
  const findings = [];
  const declared = [];
  let scanned = 0;

  for (const abs of listPages(root)) {
    const rel = relative(repoRoot, abs).split('\\').join('/');
    scanned += 1;
    const src = readFileSync(abs, 'utf8');
    for (const block of fencedBlocks(src)) {
      const decl = declarationOf(block.info);
      const hits = tokenHits(block);

      if (!decl) {
        // The RATCHET. A transcript that forgot its declaration is precisely the
        // silent-drift case: the number is there, nothing derives it, nothing
        // compares it, and the corpus reads as fully gated.
        for (const hit of hits) {
          findings.push({
            kind: 'undeclared',
            rel,
            line: hit.line,
            text: hit.matched,
            detail:
              `this fenced block quotes ${hit.token.label} but declares no transcript kind, so nothing `
              + 'compares it to the registry. Add a declaration to the opening fence, e.g. '
              + '```text transcript=os-validate (fence at line ' + block.line + ').',
          });
        }
        continue;
      }

      const kind = TRANSCRIPT_KINDS[decl.kind];
      if (!kind) {
        findings.push({
          kind: 'unknown-kind',
          rel,
          line: block.line,
          text: `transcript=${decl.kind}`,
          detail:
            `no such transcript kind. Known kinds: ${Object.keys(TRANSCRIPT_KINDS).join(', ')}. `
            + 'A kind nothing recognises pins nothing.',
        });
        continue;
      }

      if (decl.firstToken) {
        // Measured, not stylistic — see the header. This spelling BREAKS the docs build.
        findings.push({
          kind: 'no-language',
          rel,
          line: block.line,
          text: '```' + block.info,
          detail:
            'the declaration is the first meta word, so shiki reads `transcript=' + decl.kind + '` as the code '
            + 'block\'s LANGUAGE and the docs build fails to compile the page. Name a language first: '
            + '```text transcript=' + decl.kind + '.',
        });
        continue;
      }

      if (!hits.length) {
        // A declaration on a block carrying nothing derivable checks nothing,
        // and reads — to the next author, and to `--list` — as a gated block.
        findings.push({
          kind: 'declared-nothing',
          rel,
          line: block.line,
          text: `transcript=${decl.kind}`,
          detail:
            'this block declares a transcript kind but quotes no registry-derived value, so the declaration '
            + 'pins nothing. Either the value was edited out (restore it) or the block is an ordinary '
            + 'transcript (remove the declaration).',
        });
        continue;
      }

      for (const hit of hits) {
        const live = derive(decl.kind, hit.token);
        declared.push({ rel, line: hit.line, kind: decl.kind, token: hit.token.id, printed: hit.printed, live });
        if (hit.printed === live) continue;
        findings.push({
          kind: 'stale',
          rel,
          line: hit.line,
          text: hit.matched,
          detail:
            `prints ${hit.printed}, and ${hit.token.label} for \`${kind.command}\` derives ${live} today `
            + `(${hit.token.registrySource}, through \`authoringRulesFor('${kind.command}')\`). `
            + `The CLI prints the derived value at ${hit.token.printedAt}.`,
        });
      }
    }
  }
  return { findings, declared, scanned };
}

/* ---------------------------------------------------------------------- main */

async function main(argv) {
  const root = join(REPO_ROOT, PAGE_ROOT);

  const loaded = await loadRegistry();
  if (loaded.prereq) {
    console.error(
      '\ncheck-docs-transcript-drift: PREREQUISITE NOT MET — this gate derives its numbers from the BUILT\n'
      + `registry, exactly as the CLI does, and ${loaded.prereq}\n\n`
      + `Run \`pnpm --filter '@objectstack/lint...' build\` first.\n`
      + '⛔ This is NOT a pass and NOT a finding: nothing was measured.\n',
    );
    return EXIT_PREREQ;
  }
  if (loaded.error) {
    console.error(`✗ check-docs-transcript-drift: ${loaded.error}`);
    return EXIT_FINDINGS;
  }

  const derive = derivationFrom(loaded.registry);
  const { findings, declared, scanned } = scanTree(root, derive);

  if (argv.includes('--list')) {
    for (const d of declared) {
      console.log(
        `${d.printed === d.live ? 'ok      ' : 'STALE   '}  ${d.rel}:${d.line}  ${d.kind}  ${d.token}  `
        + `printed=${d.printed} derived=${d.live}`,
      );
    }
    for (const f of findings.filter((x) => x.kind !== 'stale')) {
      console.log(`${f.kind.toUpperCase().padEnd(8)}  ${f.rel}:${f.line}  ${f.text}`);
    }
    console.log(
      `\n${declared.length} declared transcript value(s) across ${scanned} page(s) under ${PAGE_ROOT}/; `
      + `${Object.keys(TRANSCRIPT_KINDS).length} kind(s), ${TOKENS.length} token(s).`,
    );
    return EXIT_OK;
  }

  // ── Anti-vacuity, before any verdict ────────────────────────────────────
  //
  // Two ways this gate can read nothing while exiting 0, and neither may pass
  // for a clean corpus: the tree moved, or every declaration was removed. The
  // second is only PARTLY covered by the `undeclared` ratchet — that fires on a
  // block still carrying the phrase, so a run that saw no declarations at all
  // and no undeclared hits either has measured nothing and must say so.
  if (scanned === 0) {
    console.error(
      `✗ check-docs-transcript-drift read ZERO pages under ${PAGE_ROOT}/.\n`
      + '  Nothing was measured, so this exit code says nothing about the corpus. The tree moved.',
    );
    return EXIT_FINDINGS;
  }
  if (declared.length === 0 && findings.length === 0) {
    console.error(
      `✗ check-docs-transcript-drift found NO declared transcript value in ${scanned} page(s) under ${PAGE_ROOT}/.\n`
      + '  A corpus with no declaration and no undeclared quote is one this gate cannot have judged.\n'
      + '  Either every declaration was removed, or the fence parser stopped seeing them.',
    );
    return EXIT_FINDINGS;
  }

  if (findings.length) {
    console.error(
      `✗ check-docs-transcript-drift: ${findings.length} finding(s) in CLI transcripts under ${PAGE_ROOT}/:\n`,
    );
    for (const f of findings) {
      console.error(`  ${f.rel}:${f.line}  [${f.kind}]`);
      console.error(`    ${f.text}`);
      console.error(`    → ${f.detail}\n`);
    }
    return EXIT_FINDINGS;
  }

  console.log(
    `✓ check-docs-transcript-drift: ${declared.length} declared transcript value(s) across ${scanned} page(s) `
    + `under ${PAGE_ROOT}/ equal what the registry derives today, and no undeclared block quotes one.`,
  );
  return EXIT_OK;
}

/* ----------------------------------------------------------------- self-test */

// Set by `selfTest()` only after its verdict is printed, and read at the
// dispatch: a `return` that leaves the function above that line prints nothing
// and still exits 0 — a self-test that never finished, reported as one that
// passed. The self-test's own exit code stays load-bearing, so the handshake is
// a flag rather than a returned sentinel.
let selfTestReachedVerdict = false;

// ── The self-test's own battery roster and floor ───────────────────────────
//
// `cases.filter((c) => !c.ok)` alone makes "every case held" and "the cases
// never ran" print the same line. The floor requires the OPENED set to equal
// the DECLARED set with each battery at or above its own count. A pinned TOTAL
// is not the repair: one battery dropping to zero keeps a total "right" the
// moment a sibling grows. The counts are FLOORS — adding cases is ordinary work.
const SELF_TEST_BATTERIES = Object.freeze({
  'The fence parser and the declaration reader': 14,
  'The gate over a real tree': 13,
  'At the PROGRAM level (real exit codes, real trees)': 6,
});
// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 3;

function selfTest() {
  const cases = [];
  const batterySeen = new Map();
  let openBattery = '(no battery open)';
  const battery = (name) => {
    openBattery = name;
    if (!batterySeen.has(name)) batterySeen.set(name, 0);
  };
  const t = (name, ok, detail) => {
    batterySeen.set(openBattery, (batterySeen.get(openBattery) ?? 0) + 1);
    cases.push({ name: `${openBattery} · ${name}`, ok: Boolean(ok), detail });
  };

  const TRANSCRIPT = ['◆ Validate', '  → Running author-time rules (42)...', '  ✓ Validation passed (64ms)'].join('\n');

  // ── 1. The parser ───────────────────────────────────────────────────────
  battery('The fence parser and the declaration reader');

  const simple = fencedBlocks('intro\n\n```text transcript=os-validate\n' + TRANSCRIPT + '\n```\n\nafter\n');
  t('one fenced block is found', simple.length === 1, String(simple.length));
  t('its opening fence line is 1-based', simple[0]?.line === 3, String(simple[0]?.line));
  t('its info string is captured', simple[0]?.info === 'text transcript=os-validate', simple[0]?.info);
  t('its closing fence is recorded', simple[0]?.closeLine === 7, String(simple[0]?.closeLine));
  t('body line numbers are absolute in the file', simple[0]?.body?.[1]?.line === 5, String(simple[0]?.body?.[1]?.line));

  t('a tilde fence is a fence', fencedBlocks('~~~text transcript=os-lint\nx\n~~~\n').length === 1);
  t('a longer closing run closes a shorter opening one',
    fencedBlocks('```text\na\n`````\n').length === 1);
  t('a shorter run does NOT close a longer opening fence',
    fencedBlocks('````text\na\n```\nb\n````\n')[0]?.body?.length === 3);
  t('a backtick info string containing a backtick is not a fence (CommonMark)',
    fencedBlocks('``` `js`\na\n').length === 0);
  t('an unclosed fence still yields a block (its closeLine is null)',
    fencedBlocks('```text transcript=os-validate\n' + TRANSCRIPT + '\n')[0]?.closeLine === null);

  t('a declaration is read off the info string',
    declarationOf('text transcript=os-validate')?.kind === 'os-validate');
  t('a fence with no declaration reads as none', declarationOf('text') === null);
  t('a declaration in FIRST position is flagged (it would be read as the language)',
    declarationOf('transcript=os-validate')?.firstToken === true);
  t('a declaration after a language is NOT flagged',
    declarationOf('text transcript=os-validate')?.firstToken === false);

  // ── 2. The gate over a real tree ────────────────────────────────────────
  battery('The gate over a real tree');

  // The kind decides the number, which is the whole point of the per-command
  // table: a synthetic registry where `lint` and `validate` disagree.
  const derive = (kindName) => (kindName === 'os-lint' ? 39 : 42);

  const tree = mkdtempSync(join(tmpdir(), 'check-docs-transcript-drift-'));
  try {
    const pageRoot = join(tree, PAGE_ROOT);
    const page = (rel, body) => {
      const abs = join(pageRoot, rel);
      mkdirSync(resolve(abs, '..'), { recursive: true });
      writeFileSync(abs, body);
    };
    const fence = (info, n = 42) =>
      '```' + info + '\n◆ Validate\n  → Running author-time rules (' + n + ')...\n```\n';

    page('ok.mdx', '---\ntitle: ok\n---\n\n' + fence('text transcript=os-validate'));
    page('stale.mdx', '---\ntitle: stale\n---\n\n' + fence('text transcript=os-validate', 41));
    page('undeclared.mdx', '---\ntitle: u\n---\n\n' + fence('text'));
    page('prose.mdx', '---\ntitle: p\n---\n\nThe CLI runs author-time rules (42) before it writes.\n');
    page('nolang.mdx', '---\ntitle: n\n---\n\n' + fence('transcript=os-validate'));
    page('unknown.mdx', '---\ntitle: k\n---\n\n' + fence('text transcript=os-deploy'));
    page('empty-decl.mdx', '---\ntitle: e\n---\n\n```text transcript=os-validate\n◆ Validate\n  ✓ passed\n```\n');
    page('lint-kind.mdx', '---\ntitle: l\n---\n\n' + fence('text transcript=os-lint', 39));

    const { findings, declared, scanned } = scanTree(pageRoot, derive, tree);
    const at = (rel, kind) => findings.find((f) => f.rel.endsWith(rel) && f.kind === kind);

    t('every page was read', scanned === 8, String(scanned));
    t('a declared, matching transcript produces no finding', !findings.some((f) => f.rel.endsWith('ok.mdx')));
    t('a declared, matching transcript IS counted as judged',
      declared.some((d) => d.rel.endsWith('ok.mdx') && d.printed === 42 && d.live === 42));

    const stale = at('stale.mdx', 'stale');
    t('a declared, STALE transcript reds', Boolean(stale));
    t('and the finding names the page and the LINE of the number',
      stale?.line === 7, `${stale?.rel}:${stale?.line}`);
    t('and it names both numbers',
      Boolean(stale?.detail.includes('prints 41') && stale?.detail.includes('derives 42')), stale?.detail);

    t('an UNDECLARED block quoting the value reds — the ratchet', Boolean(at('undeclared.mdx', 'undeclared')));
    t('and it names the line the value is on, not the fence',
      at('undeclared.mdx', 'undeclared')?.line === 7, String(at('undeclared.mdx', 'undeclared')?.line));

    t('a prose mention OUTSIDE any fence is ignored', !findings.some((f) => f.rel.endsWith('prose.mdx')));
    t('a declaration in first position reds as `no-language` (it breaks the docs build)',
      Boolean(at('nolang.mdx', 'no-language')));
    t('an unknown kind reds rather than passing', Boolean(at('unknown.mdx', 'unknown-kind')));
    t('a declaration on a block quoting nothing reds — a declaration that pins nothing',
      Boolean(at('empty-decl.mdx', 'declared-nothing')));
    t('the kind selects the derivation: `os-lint` at 39 is clean where `os-validate` would not be',
      !findings.some((f) => f.rel.endsWith('lint-kind.mdx'))
        && declared.some((d) => d.rel.endsWith('lint-kind.mdx') && d.live === 39));
  } finally {
    rmSync(tree, { recursive: true, force: true });
  }

  // ── 3. Program level ────────────────────────────────────────────────────
  //
  // Everything above drives exported predicates. A predicate the PROGRAM never
  // consults would satisfy all of it, so this battery builds real trees, runs
  // the real file in them as a child process, and reads a real exit status —
  // never a pipe's. The script copy is written INTO the scratch tree's own
  // `scripts/` so its `REPO_ROOT` resolves there and nothing reaches back here.
  battery('At the PROGRAM level (real exit codes, real trees)');

  const sandbox = mkdtempSync(join(tmpdir(), 'check-docs-transcript-drift-prog-'));
  try {
    mkdirSync(join(sandbox, 'scripts', 'docs-audit'), { recursive: true });
    const SELF = fileURLToPath(import.meta.url);
    writeFileSync(join(sandbox, 'scripts', 'docs-audit', 'gate.mjs'), readFileSync(SELF, 'utf8'));
    writeFileSync(join(sandbox, 'scripts', 'invoked-as.mjs'), readFileSync(join(HERE, '..', 'invoked-as.mjs'), 'utf8'));

    mkdirSync(join(sandbox, PAGE_ROOT), { recursive: true });
    const writePage = (name, n) =>
      writeFileSync(
        join(sandbox, PAGE_ROOT, name),
        '---\ntitle: t\n---\n\n```text transcript=os-validate\n  → Running author-time rules (' + n + ')...\n```\n',
      );
    writePage('page.mdx', 42);

    mkdirSync(join(sandbox, REGISTRY_PACKAGE_DIR), { recursive: true });
    writeFileSync(
      join(sandbox, REGISTRY_MANIFEST),
      JSON.stringify({ name: '@objectstack/lint', main: 'dist/index.js' }),
    );

    const run = () => {
      const r = spawnSync(process.execPath, [join(sandbox, 'scripts', 'docs-audit', 'gate.mjs')], { encoding: 'utf8' });
      return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
    };

    const unbuilt = run();
    t('an UNBUILT registry exits 3, not 1 and not 0', unbuilt.status === EXIT_PREREQ, String(unbuilt.status));
    t('and says PREREQUISITE NOT MET in those words', unbuilt.out.includes('PREREQUISITE NOT MET'), unbuilt.out.slice(0, 200));
    t('and refuses to be read as a pass or a finding',
      unbuilt.out.includes('NOT a pass and NOT a finding'), unbuilt.out.slice(0, 200));

    mkdirSync(join(sandbox, REGISTRY_PACKAGE_DIR, 'dist'), { recursive: true });
    writeFileSync(
      join(sandbox, REGISTRY_PACKAGE_DIR, 'dist', 'index.js'),
      'export function authoringRulesFor(c) { return new Array(c === \'lint\' ? 39 : 42).fill(0); }\n',
    );
    const built = run();
    t('a built registry with a matching page exits 0', built.status === EXIT_OK, built.out.slice(0, 300));

    writePage('page.mdx', 41);
    const drifted = run();
    t('the same tree with a drifted number exits 1', drifted.status === EXIT_FINDINGS, String(drifted.status));
    t('and the failure names the page and line', drifted.out.includes('content/docs/page.mdx:6'), drifted.out.slice(0, 400));
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }

  // ── The floor: every declared battery RAN, and ran its cases ─────────────
  //
  // Evaluated after every battery has had its chance and BEFORE the verdict, so
  // the success line below can only be printed by a run in which the set of
  // batteries that registered assertions EQUALS the set declared.
  const floorFailure = (message) => { cases.push({ name: message, ok: false }); };
  const declaredBatteries = Object.keys(SELF_TEST_BATTERIES);
  let floorBreached = false;
  if (declaredBatteries.length < SELF_TEST_BATTERY_FLOOR) {
    floorBreached = true;
    floorFailure(
      `SELF_TEST_BATTERIES declares ${declaredBatteries.length} batteries, below the pinned `
      + `${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`,
    );
  }
  for (const [name, count] of batterySeen) {
    if (declaredBatteries.includes(name)) continue;
    floorBreached = true;
    floorFailure(
      `self-test battery "${name}" registered ${count} case(s) but is not declared in SELF_TEST_BATTERIES `
      + '— an assertion attributed to no declared battery is one nothing floors.',
    );
  }
  for (const name of declaredBatteries) {
    const count = batterySeen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floorBreached = true;
    floorFailure(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. `
          + 'The verdict below would have claimed those cases hold.'
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of `
          + `${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }
  if (floorBreached) {
    floorFailure(
      'A battery at or below its floor means cases STOPPED RUNNING — the battery is the bug, not the number.',
    );
  }

  const failed = cases.filter((c) => !c.ok);
  for (const c of failed) console.error(`  ✗ ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  if (failed.length) {
    console.error(`✗ check-docs-transcript-drift self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    return EXIT_FINDINGS;
  }
  console.log(
    `✓ check-docs-transcript-drift self-test: ${cases.length} cases pass (fence parsing in both marker `
    + 'spellings, the declaration reader, all five finding kinds over a real tree, per-command derivation, '
    + 'and the real exit codes 3 / 0 / 1 from a child process).',
  );
  selfTestReachedVerdict = true;
  return EXIT_OK;
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    const selfTestCode = selfTest();
    if (!selfTestReachedVerdict) {
      console.error(
        '\n✗ check-docs-transcript-drift self-test: selfTest() returned without reaching its verdict,\n'
        + 'so no success line was printed. Exiting 0 here would report a self-test\n'
        + 'that never finished as a self-test that passed.\n',
      );
      process.exit(EXIT_FINDINGS);
    }
    process.exit(selfTestCode);
  }
  process.exit(await main(process.argv.slice(2)));
}
