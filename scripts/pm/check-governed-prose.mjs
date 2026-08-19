#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-governed-prose — pins the hand-written governed-surface enumerations
 * in the agent instruction surfaces to the `GOVERNED_SURFACES` register in
 * `scripts/pm/check-governed-merges.mjs` (#9525). Per-PR, offline, no network.
 *
 *   node scripts/pm/check-governed-prose.mjs              # the gate
 *   node scripts/pm/check-governed-prose.mjs --self-test  # verify the checker
 *
 * ## Why this exists
 *
 * The register is machine-read on every path decision, but the sentences that
 * TELL a seat which surfaces are governed are prose, duplicated out of it by
 * hand. That duplicate went stale twice in two days: `AGENTS.md` enumerated
 * one prefix (`docs/adr/**`) while the register had grown to three (#9395,
 * #9511), and both times a human — not a gate — noticed. The whole derived
 * gate union was run against the stale file and came back green on every
 * check (#9525 measured it, with a positive control proving the file IS
 * scanned: an unrelated edit to the same file turns `check:pm-skill-id-lint`
 * red). The gates read these files. None of them read the prefix list.
 *
 * The failure direction that matters is the second one. A directive that
 * UNDER-claims coverage is an omission a careful seat routes around. A
 * directive that claims coverage the register does not have manufactures a
 * false sense of enforcement, and readers stop judging for themselves. Both
 * are reachable from an unpinned enumeration, so both are asserted here.
 *
 * ## What is asserted, and what is deliberately NOT
 *
 * Per region (see `PROSE_SURFACES`), over the region's **backtick code spans**
 * only — never over bare prose:
 *
 *   1. CONTAINMENT — every `glob` in the register appears verbatim as a code
 *      span in the region. Drop a surface out of the prose and this goes red.
 *   2. NO OVER-CLAIM — every code span SHAPED like a governed-surface glob
 *      (a path ending in `**`) is a register entry. A prefix the register
 *      retired, or one that was never in it, goes red here.
 *
 * ⛔ The over-claim half is deliberately bounded to `**`-shaped spans. The
 * register's two `exact` entries are bare filenames (`AGENTS.md`,
 * `CLAUDE.md`) and these regions mention many other filenames in passing
 * (`scripts/pm/check-governed-merges.mjs`, `get_files`, `origin/main`), so
 * "every filename-shaped span must be a governed surface" would be false on
 * correct prose. Recognising a governed prefix inside free bilingual prose is
 * the intractability #9491 hit and cut, and this check does not re-attempt it:
 * it inverts the assertion instead — the REGISTER is the thing enumerated, the
 * prose is only searched. Containment covers all five entries; over-claim
 * covers the three glob-shaped ones. That boundary is the honest claim, and it
 * is stated here rather than implied by the code.
 *
 * ## Regions, and why a missing anchor is RED
 *
 * A region is delimited by two literal anchors that already exist in the file,
 * so pinning costs the instruction surfaces zero lines (`AGENTS.md` is itself
 * ratcheted). Both anchors are load-bearing directive text, not markers added
 * for this check.
 *
 * If an anchor cannot be found, or the register is empty, this check is RED —
 * never a skip and never a pass (#4690: a gate that cannot find its input must
 * fail). An empty register would otherwise make containment vacuously true,
 * which is the exact false-green this check exists to remove.
 *
 * ## When this goes red
 *
 * The fix is an edit to the PROSE, not to the register and not to this file —
 * the register is the source of truth (`AGENTS.md` Prime Directive #14 says so
 * itself: "adding a surface is an edit *there*, never here"). ⚠️ And in
 * `AGENTS.md` the enumeration sits inside a VERBATIM, untranslated maintainer
 * quotation: ⛔ never edit the quote to satisfy this gate — rewriting a quoted
 * ruling is rewriting the ruling. Name the new surface in the editable prose
 * that follows it. That is why the region spans the whole directive and not
 * just the quoted line.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

// `check-governed-merges.mjs` runs its OWN self-test at module scope when it
// sees `--self-test` in `process.argv` — it has no entry-point guard, and this
// is its first importer. Left alone, running THIS file's `--self-test` would
// also run the sibling's, and a failure there calls `process.exit(1)` before a
// single case of ours reports: our result would be masked by another script's
// name. So the flag is withheld for the duration of the import only.
const realArgv = process.argv;
process.argv = realArgv.filter((arg) => arg !== '--self-test');
const { GOVERNED_SURFACES } = await import('./check-governed-merges.mjs');
process.argv = realArgv;

const REPO_ROOT = new URL('../../', import.meta.url);

/**
 * The instruction surfaces that enumerate governed prefixes in prose, and the
 * region of each that does. Anchors are existing directive text: `start` is
 * matched first, `end` is the first line AFTER it that matches, and the region
 * is start-inclusive / end-EXCLUSIVE.
 */
export const PROSE_SURFACES = Object.freeze([
  Object.freeze({
    path: 'AGENTS.md',
    what: 'Prime Directive #14 — the definition every seat reads before a ready-flip',
    start: 'A governed surface is confirmed and merged by the maintainer, by hand',
    end: 'A version release is performed by the maintainer, by hand',
  }),
  Object.freeze({
    path: '.claude/skills/pm-dispatch/SKILL.md',
    what: "the PM skill's ACCEPT path-fork — the same enumeration, read once per landing",
    start: '**ACCEPT 之后的路径分叉',
    end: '本段只适用本循环派发的 dev PR',
  }),
]);

/**
 * The region between two anchors. Pure. Returns `{ ok: false, reason }` rather
 * than throwing, so the caller decides the exit code and the self-test can
 * assert the refusal shapes without a filesystem.
 */
export function sliceRegion(text, start, end) {
  const lines = String(text ?? '').split('\n');
  const from = lines.findIndex((line) => line.includes(start));
  if (from === -1) return { ok: false, reason: `start anchor not found: ${JSON.stringify(start)}` };
  const rel = lines.slice(from + 1).findIndex((line) => line.includes(end));
  if (rel === -1) return { ok: false, reason: `end anchor not found after line ${from + 1}: ${JSON.stringify(end)}` };
  const to = from + 1 + rel;
  return { ok: true, text: lines.slice(from, to).join('\n'), startLine: from + 1, endLine: to };
}

/** Every backtick code span's contents, in order, duplicates included. Pure. */
export function codeSpansIn(text) {
  return [...String(text ?? '').matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);
}

/**
 * Whether a code span is shaped like a governed-surface glob — a path ending
 * in `**`. The bounded half of the over-claim assertion (see header). Pure.
 */
export function looksLikeGovernedGlob(span) {
  return /^[A-Za-z0-9._/@-]+\*\*$/.test(String(span ?? ''));
}

/**
 * The two findings for one region, against one register. Pure — takes the
 * register as an argument so the self-test can vary it.
 */
export function verdict(regionText, registerGlobs) {
  const spans = new Set(codeSpansIn(regionText));
  const register = new Set(registerGlobs);
  return {
    missing: [...register].filter((glob) => !spans.has(glob)),
    unknown: [...spans].filter((span) => looksLikeGovernedGlob(span) && !register.has(span)),
  };
}

function registerGlobs() {
  return GOVERNED_SURFACES.map((surface) => surface.glob);
}

function runGate() {
  const globs = registerGlobs();
  const failures = [];

  if (globs.length === 0) {
    console.error(
      '✗ check-governed-prose: GOVERNED_SURFACES is empty — red, not a pass. An empty register makes ' +
        'containment vacuously true, which is the false green this check exists to remove.',
    );
    return 1;
  }

  for (const surface of PROSE_SURFACES) {
    const path = fileURLToPath(new URL(surface.path, REPO_ROOT));
    let text;
    try {
      text = readFileSync(path, 'utf8');
    } catch (error) {
      failures.push(`${surface.path}: cannot read — ${error.message}. Red, not a skip (#4690).`);
      continue;
    }

    const region = sliceRegion(text, surface.start, surface.end);
    if (!region.ok) {
      failures.push(
        `${surface.path}: cannot locate the enumeration region (${surface.what}) — ${region.reason}. ` +
          'Red, not a skip: an unlocatable region is an unchecked one. If the directive was legitimately ' +
          'restructured, update the anchors in PROSE_SURFACES in the same PR.',
      );
      continue;
    }

    const { missing, unknown } = verdict(region.text, globs);
    if (missing.length > 0) {
      failures.push(
        `${surface.path}:${region.startLine}-${region.endLine} (${surface.what}) does not name ` +
          `${missing.map((g) => `\`${g}\``).join(', ')} — the register governs ${missing.length === 1 ? 'it' : 'them'} ` +
          'and this prose under-claims. Add to the EDITABLE prose in the region; ⛔ never edit a verbatim ' +
          'maintainer quotation to satisfy a gate.',
      );
    }
    if (unknown.length > 0) {
      failures.push(
        `${surface.path}:${region.startLine}-${region.endLine} (${surface.what}) claims ` +
          `${unknown.map((g) => `\`${g}\``).join(', ')}, which the register does not govern — this prose ` +
          'OVER-claims enforcement. Either add the surface to GOVERNED_SURFACES in ' +
          'scripts/pm/check-governed-merges.mjs, or drop the claim from the prose.',
      );
    }
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(`✗ check-governed-prose: ${failure}`);
    return 1;
  }

  console.log(
    `✓ check-governed-prose: ${PROSE_SURFACES.length} instruction surface(s) name all ${globs.length} ` +
      `registered governed surfaces (${globs.join(' · ')}) and claim no others.`,
  );
  return 0;
}

function selfTest() {
  const cases = [];
  const assert = (name, actual, expected) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    cases.push({ name, ok, actual, expected });
  };

  // --- sliceRegion -------------------------------------------------------
  const doc = ['intro', 'START here', '`a/**` and `b/**`', 'tail', 'END there', 'after'].join('\n');
  assert('region is start-inclusive/end-exclusive', sliceRegion(doc, 'START', 'END').text, 'START here\n`a/**` and `b/**`\ntail');
  assert('region reports 1-based bounds', [sliceRegion(doc, 'START', 'END').startLine, sliceRegion(doc, 'START', 'END').endLine], [2, 4]);
  assert('missing start anchor refuses', sliceRegion(doc, 'NOPE', 'END').ok, false);
  assert('missing end anchor refuses', sliceRegion(doc, 'START', 'NOPE').ok, false);
  // An end anchor that only appears BEFORE the start anchor must not match.
  assert('end anchor is searched after start only', sliceRegion('END first\nSTART x\nz', 'START', 'END').ok, false);

  // --- codeSpansIn -------------------------------------------------------
  assert('code spans are extracted in order', codeSpansIn('see `x/**` then `y`'), ['x/**', 'y']);
  assert('a span never crosses a newline', codeSpansIn('`open\nclose`'), []);
  assert('bold markers around a span do not leak in', codeSpansIn('**`docs/adr/**`**'), ['docs/adr/**']);

  // --- looksLikeGovernedGlob --------------------------------------------
  assert('a **-glob is glob-shaped', ['docs/adr/**', '.claude/**', 'skills/**'].every(looksLikeGovernedGlob), true);
  assert('a bare filename is not glob-shaped', looksLikeGovernedGlob('AGENTS.md'), false);
  assert('a trailing-slash prefix is not glob-shaped', looksLikeGovernedGlob('docs/adr/'), false);
  assert('a code identifier is not glob-shaped', looksLikeGovernedGlob('enable_pr_auto_merge'), false);
  assert('a span with spaces is not glob-shaped', looksLikeGovernedGlob('node -e "**"'), false);

  // --- verdict -----------------------------------------------------------
  const register = ['docs/adr/**', '.claude/**', 'skills/**', 'AGENTS.md', 'CLAUDE.md'];
  const good = 'governed: `docs/adr/**` + `.claude/**` + `skills/**` + `AGENTS.md` + `CLAUDE.md`. See `origin/main`.';
  assert('complete prose passes both halves', verdict(good, register), { missing: [], unknown: [] });

  // The exact #9403 defect, reproduced: a surface dropped out of the prose.
  const dropped = good.replace(' + `skills/**`', '');
  assert('a dropped surface is caught', verdict(dropped, register).missing, ['skills/**']);

  // The over-claim direction — prose asserting enforcement the register lacks.
  const overclaims = `${good} Also \`docs/rfc/**\`.`;
  assert('an unregistered claim is caught', verdict(overclaims, register).unknown, ['docs/rfc/**']);

  // A RETIRED entry left behind in prose is the same shape, and is caught by
  // the same half — this is the negative control the card asked for.
  const retired = good.replace('`.claude/**`', '`.claude/skills/**`');
  assert('a retired prefix left in prose is caught', verdict(retired, register), {
    missing: ['.claude/**'],
    unknown: ['.claude/skills/**'],
  });

  // Prose naming a surface WITHOUT a code span does not satisfy containment —
  // the enumeration is a literal list, not an allusion.
  assert('an un-spanned mention does not satisfy containment', verdict('skills/** matters', ['skills/**']).missing, ['skills/**']);

  // Non-enumeration spans in the same region are ignored by both halves.
  assert('unrelated spans are ignored', verdict(`${good} run \`pnpm check:adr-anchors\``, register), { missing: [], unknown: [] });

  // --- the shipped register + regions, end to end ------------------------
  const globs = registerGlobs();
  assert('the register is non-empty', globs.length > 0, true);
  for (const surface of PROSE_SURFACES) {
    const text = readFileSync(fileURLToPath(new URL(surface.path, REPO_ROOT)), 'utf8');
    const region = sliceRegion(text, surface.start, surface.end);
    assert(`${surface.path}: region resolves`, region.ok, true);
    if (region.ok) assert(`${surface.path}: region is clean`, verdict(region.text, globs), { missing: [], unknown: [] });
  }

  const failed = cases.filter((c) => !c.ok);
  for (const c of failed) {
    console.error(`  ✗ ${c.name}\n     expected ${JSON.stringify(c.expected)}\n     actual   ${JSON.stringify(c.actual)}`);
  }
  if (failed.length > 0) {
    console.error(`✗ check-governed-prose self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    return 1;
  }
  console.log(`✓ check-governed-prose self-test: ${cases.length} cases pass.`);
  return 0;
}

const isSelfTest = process.argv.slice(2).includes('--self-test');
process.exit(isSelfTest ? selfTest() : runGate());
