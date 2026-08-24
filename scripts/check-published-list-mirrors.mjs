#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-published-list-mirrors (#10855) -- a list a document PUBLISHES must be
 * the list the code actually holds, line for line.
 *
 *   node scripts/check-published-list-mirrors.mjs              # judge the checked-in tree
 *   node scripts/check-published-list-mirrors.mjs --self-test  # prove the battery can go red
 *
 * ## The defect this exists to make impossible
 *
 * `scripts/check-cross-package-test-inputs.mjs` is a SOURCE SCAN: it sees only
 * the path spellings it knows, and a spelling it does not know produces no
 * flag -- so a test whose reads escape its package goes undeclared SILENTLY.
 * That is why the recognised set is published rather than left inside the
 * implementation, and why the constant's own header says it is "printed in the
 * failure text and mirrored in AGENTS.md".
 *
 * Nothing compared the two. The detector could grow a spelling and the
 * published copy could stay short indefinitely; the only signal was a human
 * noticing. It drifted three times:
 *
 *   round 1  #10163 -- three files said the detector recognised TWO seeds; it
 *            recognised five (widened by #8995 / #9763).      closed by #10690
 *   round 2  #10854 -- three files said the detector could not resolve a
 *            `findUp` walk; after PR #10852 it can.           closed by #11891
 *   round 3  #10855 -- this one. Measured on `1a47a5368`: `findUp` occurs 22
 *            times in the detector and 0 times in AGENTS.md, while the control
 *            spelling `__dirname` occurs twice there -- so the zero was a
 *            reading and not a dead grep. The published block was short by 13
 *            of the constant's 24 lines, the two `findUp` ANCHOR seeds among
 *            them.
 *
 * ## Why a gate rather than a fourth fix
 *
 * In rounds 1 and 2 the stale sentence was the stated REASON FOR A
 * PROHIBITION -- #10163's wrong "only two seeds" line was the justification for
 * "this seed may not change". A rotting mirror does not merely misinform: it
 * launders an obsolete rule into a live one, and the next reader obeys it.
 * Round 2's fix (PR #11891) had to keep the prohibition and derive a NEW true
 * reason for it, which is the expensive shape this closes.
 *
 * And one of round 2's three claims was already false BEFORE the PR that
 * supposedly staled it. So this is not only "the code moved and the doc
 * lagged": a published claim can be wrong on arrival, and nothing caught that
 * either.
 *
 * ## Equality, not "every entry appears"
 *
 * Containment -- every entry of the constant appears SOMEWHERE in the block --
 * is the cheaper assertion, and it is not enough, in two directions that both
 * occur in the history above:
 *
 *   - a line the DOC publishes that the constant does not hold tells authors a
 *     spelling is recognised while the scanner is blind to it. That is the
 *     original defect with a published byline, and it is the "wrong on
 *     arrival" case;
 *   - a COMMENT-ONLY drift is invisible to containment, and the comments are
 *     where the prohibitions live. Both rounds above were comment prose, not
 *     code.
 *
 * So the block must equal the constant line for line. The only slack is
 * trailing whitespace, stripped on both sides: an invisible character is not
 * worth an unreadable red, and no meaning in either copy rides on it.
 *
 * ⛔ This gate can only ever go RED. It never repairs, and it never will:
 * `AGENTS.md` is a GOVERNED surface (`scripts/pm/check-governed-merges.mjs`),
 * human-merge-only, so an auto-fix here would write the one file no seat may
 * land on its own. The failure text prints the exact block to paste instead,
 * and the repair rides in the same PR as the code change that caused it.
 *
 * ## What it deliberately does NOT assert
 *
 * Only the fenced block is judged. The prose AROUND it is not comparable to
 * anything mechanically, and a gate that implied otherwise would overstate its
 * coverage -- worse than one that states its limit. Round 2's false claim lived
 * in prose of exactly that kind, in three files; this gate would have caught it
 * in the block and not in the sentence.
 *
 * `RECOGNISED_IMPORT_SPELLINGS` (the same detector's escaping-IMPORT list,
 * #10452) is NOT in the table below, because AGENTS.md does not publish it at
 * all -- there is no mirror to hold in step. Whether it should be published is
 * a governed content decision, not this gate's to make.
 *
 * ## Why every unreadable state is a REFUSAL
 *
 * A gate that locates a block by its heading and fence is exactly the kind that
 * can pass while reading nothing: a renamed heading, a re-tagged fence, a
 * second candidate fence, a block emptied to a placeholder -- each produces an
 * empty comparison, and an empty comparison has no violations in it. Every one
 * of them exits 1 naming what could not be read (#4690). The same rule covers
 * the code side: a constant that is missing, renamed, empty, or no longer an
 * array of strings is a refusal, never a quiet pass -- which matters here
 * because the recognised-set constant has already survived one refactor that
 * moved its neighbours (#11871 moved the declaration table and the glob helpers
 * to `scripts/cross-package-test-inputs.mjs` and `scripts/glob-match.mjs`).
 *
 * `--self-test` pins every refusal AND pins that the ordinary case is green, so
 * a red under ablation is a reading rather than a battery that cannot pass.
 * Nothing here is best-effort, so there is no UNRECOGNISED census (#9747) to
 * print: every input is read or refused.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import process from 'node:process';

import { isEntrypoint } from './invoked-as.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

/**
 * The mirrors, DECLARED. One row per (constant, published block) pair.
 *
 * A row is located STRUCTURALLY -- by its heading and the fence inside that
 * heading's section -- never by line number. Line numbers are the first thing
 * to rot here: this card was filed against `AGENTS.md:96-106` and the block sat
 * at `:92-104` by the time it was implemented, three days later.
 */
export const MIRRORS = [
  {
    id: 'cross-package-path-spellings',
    module: 'scripts/check-cross-package-test-inputs.mjs',
    constant: 'RECOGNISED_PATH_SPELLINGS',
    doc: 'AGENTS.md',
    heading: '### A test that reads outside its own package must be spelled so the gate can see it',
    lang: 'ts',
  },
];

/** A fence line: three or more backticks, then an optional info string. */
const FENCE = /^(`{3,})[ \t]*([^\s`]*)[ \t]*$/;

/** Trailing whitespace is the one difference this gate forgives. See the header. */
const stripEnd = (s) => s.replace(/[ \t]+$/, '');

/**
 * The lines of `spec`'s published block, or a REFUSAL naming what could not be
 * read. Pure: takes the document text, so the self-test drives it on fixtures.
 */
export function locateBlock(docText, spec) {
  const level = (/^(#{1,6})\s/.exec(spec.heading) || [])[1]?.length;
  if (!level) return { refusal: `mirror \`${spec.id}\`: the declared heading is not a markdown heading: ${JSON.stringify(spec.heading)}` };

  const lines = docText.replace(/\r\n/g, '\n').split('\n');
  const at = [];
  for (let i = 0; i < lines.length; i++) if (stripEnd(lines[i]) === stripEnd(spec.heading)) at.push(i);
  if (at.length === 0) {
    return { refusal: `mirror \`${spec.id}\`: heading not found in ${spec.doc} -- ${JSON.stringify(spec.heading)}\n      A renamed or deleted heading is a REFUSAL, never a pass: the block cannot be located, so nothing was compared.` };
  }
  if (at.length > 1) {
    return { refusal: `mirror \`${spec.id}\`: heading occurs ${at.length} times in ${spec.doc} (lines ${at.map((i) => i + 1).join(', ')}); which section holds the mirror is ambiguous.` };
  }

  // The section runs to the next heading of the same or higher rank.
  let end = lines.length;
  for (let i = at[0] + 1; i < lines.length; i++) {
    const m = /^(#{1,6})\s/.exec(lines[i]);
    if (m && m[1].length <= level) { end = i; break; }
  }

  const fences = [];
  let open = null;
  for (let i = at[0] + 1; i < end; i++) {
    const m = FENCE.exec(lines[i]);
    if (!m) continue;
    if (!open) { open = { ticks: m[1].length, info: m[2], start: i }; continue; }
    if (m[1].length >= open.ticks && m[2] === '') { fences.push({ ...open, end: i }); open = null; }
  }
  if (open) {
    return { refusal: `mirror \`${spec.id}\`: an unterminated \`${'`'.repeat(open.ticks)}${open.info}\` fence opens at ${spec.doc}:${open.start + 1} and never closes inside the section; the block boundaries are unknowable.` };
  }

  const candidates = fences.filter((f) => f.info === spec.lang);
  if (candidates.length === 0) {
    return { refusal: `mirror \`${spec.id}\`: no \`${'```'}${spec.lang}\` fence in that section of ${spec.doc} (${fences.length} fence(s) of other kinds: ${fences.map((f) => f.info || '<none>').join(', ') || 'none'}).\n      A re-tagged or moved block is a REFUSAL: an empty comparison has no violations in it.` };
  }
  if (candidates.length > 1) {
    return { refusal: `mirror \`${spec.id}\`: ${candidates.length} \`${'```'}${spec.lang}\` fences in that section of ${spec.doc} (lines ${candidates.map((f) => f.start + 1).join(', ')}); which one is the mirror is ambiguous. Give the section one, or teach this table how to tell them apart.` };
  }

  const block = lines.slice(candidates[0].start + 1, candidates[0].end);
  if (block.every((l) => stripEnd(l) === '')) {
    return { refusal: `mirror \`${spec.id}\`: the \`${'```'}${spec.lang}\` block at ${spec.doc}:${candidates[0].start + 1} holds no content; an empty block passes every containment check ever written.` };
  }
  return { lines: block, at: candidates[0].start + 2 };
}

/**
 * The constant's entries, or a REFUSAL. Pure over the imported value, so the
 * self-test can drive every shape without writing a module to disk.
 */
export function validateEntries(value, spec) {
  const where = `${spec.module} -> ${spec.constant}`;
  if (value === undefined) return { refusal: `mirror \`${spec.id}\`: ${where} is not exported (renamed, moved, or deleted). A vanished constant must be loud -- an absent list compares equal to nothing.` };
  if (!Array.isArray(value)) return { refusal: `mirror \`${spec.id}\`: ${where} is ${typeof value}, not an array of strings.` };
  if (value.length === 0) return { refusal: `mirror \`${spec.id}\`: ${where} is EMPTY; an empty list matches an empty block and reads as a pass.` };
  const bad = value.findIndex((v) => typeof v !== 'string');
  if (bad >= 0) return { refusal: `mirror \`${spec.id}\`: ${where}[${bad}] is ${typeof value[bad]}, not a string.` };
  return { entries: value };
}

/** Line-for-line disagreements between the constant and the published block. */
export function judge(entries, blockLines) {
  const want = entries.map(stripEnd);
  const got = blockLines.map(stripEnd);
  const problems = [];
  for (let i = 0; i < Math.max(want.length, got.length); i++) {
    if (want[i] === got[i]) continue;
    if (i >= want.length) problems.push(`line ${i + 1}: PUBLISHED but not in the constant: ${JSON.stringify(got[i])}`);
    else if (i >= got.length) problems.push(`line ${i + 1}: in the constant but NOT PUBLISHED: ${JSON.stringify(want[i])}`);
    else problems.push(`line ${i + 1}: differs\n        constant : ${JSON.stringify(want[i])}\n        published: ${JSON.stringify(got[i])}`);
  }
  return problems;
}

/** Import `spec.module` and hand back its constant, or a refusal. */
async function loadEntries(spec) {
  const modPath = join(REPO_ROOT, spec.module);
  if (!existsSync(modPath)) return { refusal: `mirror \`${spec.id}\`: ${spec.module} does not exist; the constant it publishes cannot be read.` };
  let mod;
  try {
    mod = await import(pathToFileURL(modPath).href);
  } catch (err) {
    return { refusal: `mirror \`${spec.id}\`: ${spec.module} could not be imported -- ${err?.message ?? err}` };
  }
  return validateEntries(mod[spec.constant], spec);
}

/** Read `spec.doc` from the repo root, or refuse. */
function readDoc(spec) {
  const docPath = join(REPO_ROOT, spec.doc);
  if (!existsSync(docPath)) return { refusal: `mirror \`${spec.id}\`: ${spec.doc} does not exist.` };
  return { text: readFileSync(docPath, 'utf8') };
}

async function main() {
  if (MIRRORS.length === 0) {
    console.error('REFUSE: the mirror table is empty, so this gate compared nothing. Absence must be loud (AGENTS.md, Route & surface ownership §3).');
    process.exit(1);
  }

  const refusals = [];
  const failures = [];

  for (const spec of MIRRORS) {
    const doc = readDoc(spec);
    if (doc.refusal) { refusals.push(doc.refusal); continue; }
    const loaded = await loadEntries(spec);
    if (loaded.refusal) { refusals.push(loaded.refusal); continue; }
    const block = locateBlock(doc.text, spec);
    if (block.refusal) { refusals.push(block.refusal); continue; }

    const problems = judge(loaded.entries, block.lines);
    if (problems.length) failures.push({ spec, problems, entries: loaded.entries, at: block.at });
  }

  if (refusals.length) {
    console.error('REFUSE: a published-list mirror could not be READ, so it was not judged.\n');
    for (const r of refusals) console.error(`  - ${r}\n`);
    console.error(
      'A gate that cannot find its block must never pass: an empty comparison has no\n' +
        'violations in it, which is the dormant-gate shape this repo keeps paying for\n' +
        '(#4690). Fix the document, or update the table in this file (#10855).\n',
    );
    process.exit(1);
  }

  if (failures.length) {
    console.error('FAIL: a published list has drifted from the constant it mirrors.\n');
    for (const f of failures) {
      console.error(`  ${f.spec.doc} (block at :${f.at}) vs ${f.spec.module} -> ${f.spec.constant}:\n`);
      for (const p of f.problems) console.error(`      ${p}`);
      console.error('\n  The block below is what the constant holds today. Paste it between the fences:\n');
      console.error(f.entries.map((l) => `  | ${l}`).join('\n'));
      console.error('');
    }
    console.error(
      'Why this gate exists: the detector is a SOURCE SCAN, so a spelling it does not\n' +
        'know produces no flag and a cross-package read goes undeclared SILENTLY. The\n' +
        'published list is the only thing telling authors what it can see, and it has\n' +
        'drifted three times (#10163, #10854, #10855) -- twice while being the stated\n' +
        'reason for a prohibition.\n' +
        '\n' +
        '⛔ This gate cannot repair the document: AGENTS.md is GOVERNED, human-merge-only.\n' +
        'Edit it by hand, in the same PR as the change that moved the constant.\n',
    );
    process.exit(1);
  }

  const rows = MIRRORS.map((m) => `${m.doc} <- ${m.module} -> ${m.constant}`);
  console.log(
    `OK: ${MIRRORS.length} published list mirror(s) match their constants line for line.\n  ${rows.join('\n  ')}\n` +
      `  (Only the fenced block is judged — the prose around it is not machine-comparable; see this file's header.)`,
  );
}

async function selfTest() {
  const cases = [];
  const ok = (label, cond) => cases.push({ label, cond });

  const SPEC = { id: 'fixture', module: 'scripts/nonexistent.mjs', constant: 'FIXTURE', doc: 'FIXTURE.md', heading: '### The mirror heading', lang: 'ts' };
  const doc = (body) => [
    '# Title',
    '',
    '## Another section',
    '',
    'prose that mentions const A = 1; in passing',
    '',
    SPEC.heading,
    '',
    'lead-in prose:',
    '',
    ...body,
    '',
    'trailing prose',
    '',
    '### A later section',
    '',
    '```ts',
    'const DECOY = 0;',
    '```',
    '',
  ].join('\n');
  const FENCED = ['```ts', 'const A = 1;   // seed', '  ⛔ NOT a manifest name belonging to some OTHER package', '```'];
  const ENTRIES = ['const A = 1;   // seed', '  ⛔ NOT a manifest name belonging to some OTHER package'];

  // ── the positive control: the ordinary case is GREEN, and it reads the right block ──
  const good = locateBlock(doc(FENCED), SPEC);
  ok('the ordinary case locates a block', Array.isArray(good.lines));
  ok('and it is the block under the declared heading, not the decoy in a later section', !good.lines?.includes('const DECOY = 0;'));
  ok('and prose OUTSIDE the fence is not collected', !good.lines?.some((l) => l.includes('in passing')));
  ok('and an exact copy judges clean', judge(ENTRIES, good.lines ?? []).length === 0);

  // ── direction 1: the constant grew and the doc did not (the card's own case) ──
  ok(
    'a spelling in the constant and absent from the doc is RED',
    judge([...ENTRIES, "const REPO = findUp((dir) => existsSync(join(dir, 'pnpm-workspace.yaml')));"], good.lines ?? [])
      .some((p) => p.includes('NOT PUBLISHED')),
  );

  // ── direction 2: the doc publishes a spelling the scanner cannot see (wrong on arrival) ──
  ok(
    'a spelling published that the constant does not hold is RED',
    judge(ENTRIES, [...(good.lines ?? []), 'const P = process.cwd();']).some((p) => p.includes('PUBLISHED but not in the constant')),
  );

  // ── the nastiest drift: comment/prohibition prose only, which containment cannot see ──
  ok(
    "a COMMENT-only drift is RED (round 1 and round 2 were both comment prose)",
    judge(['const A = 1;   // seed (ESM)', ENTRIES[1]], good.lines ?? []).some((p) => p.includes('differs')),
  );
  ok(
    'a reworded ⛔ PROHIBITION is RED — a stale prohibition reason is what launders an obsolete rule into a live one',
    judge([ENTRIES[0], '  ⛔ NOT a manifest name belonging to ANOTHER package'], good.lines ?? []).some((p) => p.includes('differs')),
  );
  ok('trailing whitespace alone is NOT a difference (the one stated slack)', judge(ENTRIES, [`${ENTRIES[0]}   `, `${ENTRIES[1]}\t`]).length === 0);

  // ── every unreadable state REFUSES rather than passing empty ──
  ok('a renamed heading REFUSES', locateBlock(doc(FENCED).replace(SPEC.heading, '### A different heading entirely'), SPEC).refusal?.includes('heading not found'));
  ok('a duplicated heading REFUSES as ambiguous', locateBlock(`${doc(FENCED)}\n${SPEC.heading}\n`, SPEC).refusal?.includes('occurs 2 times'));
  ok('a re-tagged fence REFUSES', locateBlock(doc(['```js', ...FENCED.slice(1)]), SPEC).refusal?.includes('no ````ts` fence'));
  ok('an unterminated fence REFUSES', locateBlock(doc(FENCED.slice(0, 3)), SPEC).refusal?.includes('unterminated'));
  ok('an empty fence REFUSES rather than matching an empty list', locateBlock(doc(['```ts', '```']), SPEC).refusal?.includes('holds no content'));
  ok('a blank-only fence REFUSES too', locateBlock(doc(['```ts', '   ', '```']), SPEC).refusal?.includes('holds no content'));
  ok('two candidate fences in one section REFUSE as ambiguous', locateBlock(doc([...FENCED, '', ...FENCED]), SPEC).refusal?.includes('2 ````ts` fences'));
  ok('a block that moved to a LATER section is not silently accepted', locateBlock(doc(['prose only, no fence at all']), SPEC).refusal?.includes('no ````ts` fence'));
  ok('a heading spec that is not a heading REFUSES', locateBlock(doc(FENCED), { ...SPEC, heading: 'not a heading' }).refusal?.includes('not a markdown heading'));

  // ── the code side refuses just as loudly (the #11871 refactor shape) ──
  ok('a renamed or vanished constant REFUSES', validateEntries(undefined, SPEC).refusal?.includes('not exported'));
  ok('an EMPTY constant REFUSES', validateEntries([], SPEC).refusal?.includes('EMPTY'));
  ok('a non-array constant REFUSES', validateEntries('a string', SPEC).refusal?.includes('not an array'));
  ok('a non-string entry REFUSES', validateEntries(['fine', 42], SPEC).refusal?.includes('not a string'));

  // ── the live table, which is what actually rots ──
  ok('the mirror table is not empty', MIRRORS.length >= 1);
  for (const spec of MIRRORS) {
    const live = readDoc(spec);
    ok(`live: ${spec.doc} exists`, !live.refusal);
    const loaded = await loadEntries(spec);
    ok(`live: ${spec.module} still exports ${spec.constant} as a non-empty string list`, !loaded.refusal);
    const located = live.text ? locateBlock(live.text, spec) : { refusal: 'unreadable' };
    ok(`live: the block still LOCATES in ${spec.doc} (heading + fence, never a line number)`, Array.isArray(located.lines));
  }

  const failed = cases.filter((c) => !c.cond);
  for (const c of cases) console.log(`${c.cond ? 'ok  ' : 'FAIL'} ${c.label}`);
  if (failed.length) {
    console.error(`\n${failed.length}/${cases.length} self-test case(s) failed.`);
    process.exit(1);
  }
  console.log(`\nAll ${cases.length} self-test cases passed.`);
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) await selfTest();
  else await main();
}
