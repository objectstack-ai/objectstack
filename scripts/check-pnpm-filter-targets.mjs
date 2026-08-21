#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-pnpm-filter-targets (#10853) -- every `pnpm --filter <name>` this repo
 * COMMITS must name a package this workspace actually has.
 *
 *   node scripts/check-pnpm-filter-targets.mjs              # the gate
 *   node scripts/check-pnpm-filter-targets.mjs --list       # the census it judged
 *   node scripts/check-pnpm-filter-targets.mjs --self-test  # prove it can go red
 *
 * ## The defect
 *
 * `pnpm --filter <name>` EXITS 0 when the filter matches nothing:
 *
 *     $ pnpm --filter @objectstack/definitely-not-a-package test; echo $?
 *     No projects matched the filters in "/home/user/objectstack"
 *     0
 *
 * So a workflow step, a `package.json` script or a `scripts/**` helper can name
 * a package that does not exist and stay GREEN forever -- measuring nothing,
 * reporting success. `cmd > log 2>&1; ec=$?` captures 0 faithfully; the log
 * even says what happened, and nothing reads it. The full argument, the
 * measured pnpm matching rule and the shared resolver live in
 * `scripts/pnpm-filter-targets.mjs`; this file is only the sweep over the
 * committed population.
 *
 * ## The population this gate protects -- and the one it does NOT
 *
 * ⛔ Stated plainly because overclaiming here would be the same defect the gate
 * is about. This gate reads SPELLINGS THAT ARE CHECKED IN. It cannot see a
 * filter an agent types at a prompt, and that ad-hoc population is the one that
 * actually bit (a dispatch briefing spelled `@objectstack/adapter-hono`, which
 * is not a package; the real name is `@objectstack/hono`). The ad-hoc half is
 * covered separately and only for callers of the shared verify lock, by
 * `scripts/pm/os-verify-lock.sh`'s filter preflight. Neither substitutes for
 * the other; they protect disjoint populations, and between them they still
 * leave uncovered any ad-hoc command that does not go through the lock.
 *
 * ## What "judged" means, and why the unjudged count is printed
 *
 * A selector is judged only when the answer cannot be argued with -- a plain
 * package name. Globs, path selectors, since-ref selectors and interpolations
 * are refused a verdict BY DESIGN (see the resolver's header), because a wrong
 * red here would make this gate the thing that blocks correct work.
 *
 * That makes silence ambiguous, which is #4690's shape: a scan that judged
 * nothing looks exactly like a scan that found nothing wrong. So the green line
 * prints how many occurrences were judged, how many were not, and why -- and
 * `run()` REFUSES a tree in which the extractor found no `--filter` at all, or
 * judged none of the ones it found. Measured when this gate landed: 148
 * occurrences across 25 files, 120 of them judged, 0 dead -- plus 29 in
 * comments or step labels and 57 in this rule's own three files, counted and
 * not judged.
 *
 * ## Comments are counted, not judged
 *
 * Prose is excluded from the verdict: JS comments are masked with
 * `js-comment-mask.mjs`, and whole-line `#` comments are dropped from shell and
 * YAML. A `--filter` in a comment is usually an illustration, and several are
 * deliberately fake (`--filter <pkg>`). The count is still reported, so the
 * excluded population is visible rather than silent -- a comment that teaches a
 * package name which does not exist is a real defect, just not this gate's.
 *
 * ## Foreign workspaces are a declared exemption, not a hole
 *
 * `scripts/build-console.sh` and `scripts/gen-sdui-manifest.sh` filter
 * `@object-ui/console`, which is not in this workspace and never will be -- they
 * run those commands inside a checkout of `objectstack-ai/objectui`. That scope
 * is declared in the resolver's `FOREIGN_SCOPES`, with the reason. A new
 * foreign scope has to be added there deliberately.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';
import { maskComments } from './js-comment-mask.mjs';
import {
  extractFilters,
  findWorkspaceRoot,
  judgeSelector,
  listWorkspacePackages,
} from './pnpm-filter-targets.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

/**
 * The three files that OWN this rule.
 *
 * Every `--filter` they spell outside a comment is a FIXTURE -- a deliberately
 * dead name, so the guard can be observed going red. (The lock wrapper's are its
 * `--self-test` cases, which drive `echo pnpm --filter @objectstack/adapter-hono`
 * through the real entry point.) Judging them would make this gate fail on its
 * own negative controls, and deleting the fixtures to appease it would delete
 * the only proof either guard can fail at all.
 *
 * Declared as an exact list and pinned in `--self-test`, so it cannot quietly
 * grow into a mute button: a fourth entry fails that assertion.
 */
export const RULE_OWNING_FILES = [
  'scripts/pnpm-filter-targets.mjs',
  'scripts/check-pnpm-filter-targets.mjs',
  'scripts/pm/os-verify-lock.sh',
];

const JS_EXTENSIONS = ['.mjs', '.mts', '.cjs', '.js', '.ts'];
const HASH_COMMENT_EXTENSIONS = ['.sh', '.bash', '.yml', '.yaml'];
const SCANNED_EXTENSIONS = [...JS_EXTENSIONS, ...HASH_COMMENT_EXTENSIONS, '.json'];

/**
 * Blank the regions whose `--filter` spellings are prose rather than commands.
 *
 * Line numbers are PRESERVED (spans are blanked, never deleted), so a finding
 * still points at the line the reader will open.
 *
 * @param {string} text
 * @param {string} file repo-relative path, for the extension
 * @returns {{ code: string, commentText: string }}
 */
export function separateComments(text, file) {
  const extension = file.slice(file.lastIndexOf('.'));
  if (JS_EXTENSIONS.includes(extension)) {
    let masked;
    try {
      masked = maskComments(text);
    } catch {
      return { code: text, commentText: '' };
    }
    // What the mask removed is exactly the comment population.
    const commentLines = [];
    const original = text.split('\n');
    masked.split('\n').forEach((line, i) => {
      if (line !== original[i]) commentLines.push(original[i]);
    });
    return { code: masked, commentText: commentLines.join('\n') };
  }
  if (HASH_COMMENT_EXTENSIONS.includes(extension)) {
    const yaml = extension === '.yml' || extension === '.yaml';
    const code = [];
    const comments = [];
    for (const line of text.split('\n')) {
      // ⚠️ A step `name:` is a LABEL, not a command, and this gate's OWN step
      // is what proved it: `- name: Every committed pnpm --filter names a real
      // package` reads as `--filter names`, a package that does not exist. The
      // same distinction check-required-contexts had to learn (#10877) — prose
      // that survives a correct comment stripper because it is not a comment.
      if (/^\s*#/.test(line) || (yaml && /^\s*-?\s*name:\s/.test(line))) {
        code.push('');
        comments.push(line);
      } else {
        code.push(line);
      }
    }
    return { code: code.join('\n'), commentText: comments.join('\n') };
  }
  return { code: text, commentText: '' };
}

/**
 * Every file this gate reads: `.github/workflows/`, `scripts/**`, and every
 * `package.json` the workspace declares (plus the root one).
 *
 * @param {string} root
 * @returns {string[]} repo-relative posix paths
 */
export function scannedFiles(root) {
  const files = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (SCANNED_EXTENSIONS.some((e) => entry.name.endsWith(e))) {
        files.push(relative(root, full).split('\\').join('/'));
      }
    }
  };
  walk(join(root, 'scripts'));
  walk(join(root, '.github', 'workflows'));
  const rootManifest = join(root, 'package.json');
  if (existsSync(rootManifest)) files.push('package.json');
  for (const dir of listWorkspacePackages(root).dirs) {
    const manifest = join(dir, 'package.json');
    if (existsSync(manifest)) files.push(relative(root, manifest).split('\\').join('/'));
  }
  return [...new Set(files)].sort();
}

/**
 * @typedef {{ file: string, line: number, value: string, judgement: ReturnType<typeof judgeSelector> }} Occurrence
 */

/**
 * Judge one file's text.
 *
 * @param {string} text
 * @param {string} file
 * @param {string[]} names
 * @returns {{ occurrences: Occurrence[], commented: number }}
 */
export function scanText(text, file, names) {
  const { code, commentText } = separateComments(text, file);
  const occurrences = extractFilters(code).map(({ value, line }) => ({
    file,
    line,
    value,
    judgement: judgeSelector(value, names),
  }));
  return { occurrences, commented: extractFilters(commentText).length };
}

/**
 * @param {string} root
 */
export function scanRepo(root) {
  const { names } = listWorkspacePackages(root);
  /** @type {Occurrence[]} */
  const occurrences = [];
  let commented = 0;
  let filesWithFilters = 0;
  let exemptOccurrences = 0;
  for (const file of scannedFiles(root)) {
    let text;
    try {
      text = readFileSync(join(root, file), 'utf8');
    } catch {
      continue;
    }
    if (!text.includes('--filter')) continue;
    if (RULE_OWNING_FILES.includes(file)) {
      exemptOccurrences += extractFilters(text).length;
      continue;
    }
    const out = scanText(text, file, names);
    commented += out.commented;
    if (out.occurrences.length > 0) filesWithFilters++;
    occurrences.push(...out.occurrences);
  }
  const dead = occurrences.filter((o) => o.judgement.verdict === 'zero');
  const judged = occurrences.filter((o) => o.judgement.verdict !== 'unjudged');
  /** @type {Record<string, number>} */
  const unjudgedByKind = {};
  for (const occurrence of occurrences) {
    if (occurrence.judgement.verdict !== 'unjudged') continue;
    const kind = occurrence.judgement.selector.kind;
    unjudgedByKind[kind] = (unjudgedByKind[kind] ?? 0) + 1;
  }
  return { names, occurrences, judged, dead, commented, unjudgedByKind, filesWithFilters, exemptOccurrences };
}

/**
 * @param {Occurrence} occurrence
 * @returns {string}
 */
export function describe(occurrence) {
  const { file, line, value, judgement } = occurrence;
  const suggestion = judgement.suggestion ? ` Did you mean \`${judgement.suggestion}\`?` : '';
  return (
    `${file}:${line}: \`--filter ${value}\` names no package in this workspace.${suggestion} `
    + 'pnpm EXITS 0 on a filter that matched nothing, so this command reports success while '
    + 'measuring nothing (#10853) — a red here is a run that was never happening.'
  );
}

function run() {
  const root = findWorkspaceRoot(HERE) ?? REPO_ROOT;
  const { names, occurrences, judged, dead, commented, unjudgedByKind, filesWithFilters, exemptOccurrences } = scanRepo(root);

  // #4690: a scan that read nothing must not report as a scan that found
  // nothing wrong. Both axes, because either one can go to zero on its own.
  if (names.length === 0) {
    console.error(
      '✗ check:pnpm-filter-targets — the workspace resolved to ZERO packages, so every filter would '
        + 'read as dead. That is a broken reader, not a broken tree.',
    );
    return 1;
  }
  if (occurrences.length === 0) {
    console.error(
      '✗ check:pnpm-filter-targets — found NO `--filter` occurrence anywhere in `scripts/**`, '
        + '`.github/workflows/**` or the workspace manifests. Measured when this gate landed: 148 '
        + 'occurrences across 25 files. Zero means the extractor stopped reading, not that the tree '
        + 'stopped spelling filters (#4690).',
    );
    return 1;
  }
  if (judged.length === 0) {
    console.error(
      `✗ check:pnpm-filter-targets — found ${occurrences.length} \`--filter\` occurrence(s) and judged `
        + 'NONE of them. A gate that judges nothing is indistinguishable from a clean tree (#4690).',
    );
    return 1;
  }

  if (dead.length > 0) {
    console.error(`✗ check:pnpm-filter-targets — ${dead.length} filter(s) name no package in this workspace\n`);
    for (const occurrence of dead) console.error(`  • ${describe(occurrence)}\n`);
    console.error(
      '  Fix the spelling, or — if the command deliberately runs against ANOTHER repo\'s workspace —\n'
        + '  declare that scope in `FOREIGN_SCOPES` in scripts/pnpm-filter-targets.mjs, with the reason.\n',
    );
    return 1;
  }

  const unjudged = Object.entries(unjudgedByKind)
    .sort()
    .map(([kind, count]) => `${count} ${kind}`)
    .join(', ');
  console.log(
    `✓ check:pnpm-filter-targets: ${judged.length}/${occurrences.length} \`--filter\` occurrence(s) across `
      + `${filesWithFilters} file(s) resolve against ${names.length} workspace package(s); `
      + `${occurrences.length - judged.length} not judged (${unjudged || 'none'}); `
      + `${commented} more in comments or step labels and ${exemptOccurrences} in this rule's own files, `
      + 'counted and not judged.',
  );
  return 0;
}

function list() {
  const root = findWorkspaceRoot(HERE) ?? REPO_ROOT;
  const { occurrences } = scanRepo(root);
  for (const occurrence of occurrences) {
    const { judgement } = occurrence;
    const note = judgement.verdict === 'unjudged' ? `unjudged (${judgement.selector.kind})` : judgement.verdict;
    console.log(`${occurrence.file}:${occurrence.line}\t${note}\t${occurrence.value}`);
  }
  console.log(`\n${occurrences.length} occurrence(s).`);
  return 0;
}

export function selfTest() {
  const failures = [];
  let checked = 0;
  const ok = (description, condition) => {
    checked++;
    if (!condition) failures.push(description);
  };

  const root = findWorkspaceRoot(HERE) ?? REPO_ROOT;
  const { names } = listWorkspacePackages(root);
  ok(`the workspace reads (found ${names.length} packages)`, names.length > 50);

  // ---- ⭐ THE NEGATIVE CONTROL: the card's own reproduction ----------------
  // A fixture that names a package which does not exist MUST red, and the same
  // fixture with the real name must be silent. Both directions, or the gate is
  // not shown to work.
  const deadFixture = 'jobs:\n  test:\n    steps:\n      - run: pnpm --filter @objectstack/adapter-hono test\n';
  const deadScan = scanText(deadFixture, 'fixture.yml', names);
  ok('NEGATIVE CONTROL: a dead filter in a workflow yields exactly one occurrence', deadScan.occurrences.length === 1);
  ok('and it is judged zero', deadScan.occurrences[0]?.judgement.verdict === 'zero');
  ok('and the message names the file and line', describe(deadScan.occurrences[0]).startsWith('fixture.yml:4:'));
  ok('and the message suggests the real package', describe(deadScan.occurrences[0]).includes('@objectstack/hono'));
  ok('and the message says pnpm EXITS 0 — the reason this is a defect at all', describe(deadScan.occurrences[0]).includes('EXITS 0'));

  const liveFixture = deadFixture.replace('@objectstack/adapter-hono', '@objectstack/hono');
  const liveScan = scanText(liveFixture, 'fixture.yml', names);
  ok('POSITIVE CONTROL: the same fixture with a real name yields no finding', liveScan.occurrences.every((o) => o.judgement.verdict === 'matches'));

  // The other three carriers, each with a dead name.
  ok(
    'a dead filter in a package.json script is judged zero',
    scanText('{"scripts":{"test":"pnpm --filter @objectstack/nope test"}}', 'package.json', names).occurrences[0]?.judgement.verdict === 'zero',
  );
  ok(
    'a dead filter in a shell script is judged zero',
    scanText('#!/usr/bin/env bash\npnpm --filter @objectstack/nope build\n', 'scripts/x.sh', names).occurrences[0]?.judgement.verdict === 'zero',
  );
  ok(
    'a dead filter in a JS string is judged zero',
    scanText("const cmd = 'pnpm --filter @objectstack/nope test';\n", 'scripts/x.mjs', names).occurrences[0]?.judgement.verdict === 'zero',
  );

  // ---- comments are counted, not judged -----------------------------------
  const shellComment = scanText('#   pnpm --filter @objectstack/nope test\npnpm --filter @objectstack/spec test\n', 'scripts/x.sh', names);
  ok('a `#` comment line is not judged', shellComment.occurrences.length === 1 && shellComment.occurrences[0].value === '@objectstack/spec');
  ok('but it IS counted', shellComment.commented === 1);
  const jsComment = scanText("// pnpm --filter @objectstack/nope test\nconst x = 'pnpm --filter @objectstack/spec test';\n", 'scripts/x.mjs', names);
  ok('a JS line comment is not judged', jsComment.occurrences.length === 1 && jsComment.occurrences[0].value === '@objectstack/spec');
  ok('but it IS counted', jsComment.commented === 1);
  const jsBlock = scanText("/**\n * pnpm --filter @objectstack/nope test\n */\nconst x = 'pnpm --filter @objectstack/spec test';\n", 'scripts/x.mjs', names);
  ok('a JSDoc block comment is not judged', jsBlock.occurrences.length === 1);
  ok('a masked comment does NOT shift the line numbers of the code below it', jsBlock.occurrences[0]?.line === 4);
  ok(
    'a STRING survives the mask — a filter in a JS string literal is code, not prose',
    scanText("const x = 'pnpm --filter @objectstack/nope test';\n", 'scripts/x.mjs', names).occurrences.length === 1,
  );

  // A YAML step `name:` is prose. Measured on this gate's own step, which is
  // where the false positive came from.
  const labelFixture = 'jobs:\n  lint:\n    steps:\n      - name: Every committed pnpm --filter names a real package\n        run: pnpm check:pnpm-filter-targets\n';
  const labelScan = scanText(labelFixture, 'lint.yml', names);
  ok('a YAML step `name:` is a LABEL, not a command, and yields no finding', labelScan.occurrences.length === 0);
  ok('but it IS counted, so the excluded population stays visible', labelScan.commented === 1);
  ok(
    'and a `run:` on the very next line is still judged',
    scanText('      - name: run pnpm --filter names a real package\n        run: pnpm --filter @objectstack/adapter-hono test\n', 'lint.yml', names)
      .occurrences.filter((o) => o.judgement.verdict === 'zero').length === 1,
  );

  // ---- discrimination: the shapes that must NOT produce a finding ----------
  for (const [text, why] of [
    ['pnpm --filter ./packages/* typecheck', 'a path glob'],
    ['pnpm --filter "@objectstack/*" build', 'a name glob'],
    ['pnpm --filter "@objectstack/spec[origin/main]" test', 'a since-ref selector'],
    ['pnpm --filter @object-ui/console build', 'a declared foreign scope'],
    ['pnpm --filter "${pkg}" test', 'an interpolation'],
    ['pnpm --filter <pkg> test', 'a prose placeholder'],
  ]) {
    const scan = scanText(`${text}\n`, 'scripts/x.sh', names);
    ok(`${why} yields no finding`, scan.occurrences.every((o) => o.judgement.verdict === 'unjudged'));
  }
  ok(
    'a dependency selector on a dead name is STILL a finding — the suffix does not excuse the typo',
    scanText('pnpm --filter @objectstack/adapter-hono... build\n', 'scripts/x.sh', names).occurrences[0]?.judgement.verdict === 'zero',
  );
  ok(
    'a dependency selector on a live name is not',
    scanText('pnpm --filter @objectstack/hono... build\n', 'scripts/x.sh', names).occurrences[0]?.judgement.verdict === 'matches',
  );

  // ---- the real tree, and the vacuity refusals -----------------------------
  const live = scanRepo(root);
  ok(`the live tree yields occurrences (found ${live.occurrences.length})`, live.occurrences.length > 50);
  ok(`and judges a real share of them (judged ${live.judged.length})`, live.judged.length > 30);
  ok(`and the checked-in tree is clean (dead: ${live.dead.map((d) => d.value).join(', ') || 'none'})`, live.dead.length === 0);
  ok('and the foreign scope is present and unjudged, not silently missing', (live.unjudgedByKind.foreign ?? 0) > 0);
  ok(
    'the self-exemption is exactly the three files that own the rule — never a fourth',
    RULE_OWNING_FILES.length === 3
      && RULE_OWNING_FILES.includes('scripts/pnpm-filter-targets.mjs')
      && RULE_OWNING_FILES.includes('scripts/check-pnpm-filter-targets.mjs')
      && RULE_OWNING_FILES.includes('scripts/pm/os-verify-lock.sh'),
  );
  ok(
    'and both exempted files really exist, so the exemption names something',
    RULE_OWNING_FILES.every((f) => existsSync(join(root, f))),
  );
  ok(
    'and the exempted occurrences are COUNTED, not silently dropped',
    live.exemptOccurrences > 0,
  );
  ok(
    'the file sweep reaches all three carriers',
    ['package.json', 'scripts/', '.github/workflows/'].every((prefix) =>
      scannedFiles(root).some((f) => f === prefix || f.startsWith(prefix)),
    ),
  );

  if (failures.length === 0) {
    console.log(
      `✓ check-pnpm-filter-targets --self-test: ${checked} assertions — a dead filter observed RED in all `
        + 'four carriers (workflow, package.json, shell, JS) and the same fixtures observed SILENT with a '
        + `real name; ${live.occurrences.length} live occurrence(s) swept.`,
    );
    return 0;
  }
  console.error(`✗ check-pnpm-filter-targets --self-test — ${failures.length} failure(s)\n`);
  for (const failure of failures) console.error(`  • ${failure}`);
  return 1;
}

if (isEntrypoint(import.meta.url)) {
  const flag = process.argv[2];
  if (flag === '--self-test') process.exit(selfTest());
  else if (flag === '--list') process.exit(list());
  else process.exit(run());
}
