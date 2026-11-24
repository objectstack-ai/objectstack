#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * install-settings-deny-roster -- writes the MCP GitHub content-write deny
 * roster into the USER-scope Claude Code settings file, so a session that never
 * reads this repository's settings still refuses those tools.
 *
 *   node scripts/pm/install-settings-deny-roster.mjs                     # ~/.claude/settings.json
 *   node scripts/pm/install-settings-deny-roster.mjs --settings <path>   # another file
 *   node scripts/pm/install-settings-deny-roster.mjs --dry-run           # say what would change, write nothing
 *   node scripts/pm/install-settings-deny-roster.mjs --self-test         # verify the installer
 *
 * ## Why this exists
 *
 * Lock 1 of the write-identity locks is `permissions.deny` in the repository's
 * Claude settings file: it refuses the MCP GitHub tools that publish as the
 * account that connected GitHub, so the fleet relay under `scripts/pm/` stays
 * the only write path. A cloud thread of a claude.ai project never applies a
 * repository's settings file -- not its permission rules, not its hooks, not
 * its `env` -- however many repositories the project has. That is the
 * platform's documented design, not a bug this tree can fix. In such a thread
 * the deny list is simply absent, every content-write tool is offered, and a
 * call through one lands under the maintainer's personal login.
 *
 * What such a session DOES read is the user scope. Measured in a project
 * thread: with no user settings file present, the 17 roster tools were
 * offered; the moment this file's output was written to
 * `~/.claude/settings.json`, the next tool listing dropped exactly those 17
 * and kept every read tool. The settings watcher picks the file up live, so
 * running this mid-session closes the lock for that session too, not only for
 * the next one.
 *
 * So the repo-side half of the lock is this installer, and the
 * environment-side half is one line in the project's cloud-environment setup
 * script that runs it before the session launches.
 *
 * ## One roster, never a second copy
 *
 * The population is `CONTENT_WRITE_TOOLS`, imported from
 * `check-settings-deny-roster.mjs`, the gate that already holds the repo's
 * settings deny list equal to it. This file enumerates no tool name, so a
 * roster change reaches the user scope through the next run of this script
 * with no edit here.
 *
 * ## What a run does
 *
 * - File absent: creates it (and its folder) holding only the deny roster.
 * - File present: parses it, keeps EVERY key and every existing deny entry,
 *   and appends the roster tools it is missing, in roster order. Nothing is
 *   ever removed: removing a deny entry widens what a session may call, and
 *   no installer of a lock should do that.
 * - Nothing missing: writes nothing (the bytes and the mtime stay), exit 0.
 * - The write is atomic (temporary file + rename), and the file is re-read and
 *   judged by the gate's own `verdict` afterwards; the exit code is that
 *   judgement, never the write's success.
 *
 * ## Exit contract (the same numbers the gate uses)
 *
 *   0  the file denies every roster tool and no undeclared `mcp__github__`
 *      tool: the gate run with `--settings` on the same file exits 0 too.
 *   1  FINDING -- the roster is now denied, but the file also denies an
 *      `mcp__github__` tool the roster does not declare. Left in place (see
 *      above); the gate's equality check will name it.
 *   2  REFUSED -- the imported roster is unusable (empty, repeated, or outside
 *      its namespace). Nothing was written.
 *   3  PREREQUISITE NOT MET -- the file exists but cannot be read or parsed,
 *      or carries a `permissions`/`deny` of the wrong shape. Nothing was
 *      written: overwriting a file this script cannot read would destroy
 *      whatever else it holds.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';

import { isEntrypoint } from '../invoked-as.mjs';
import {
  CONTENT_WRITE_TOOLS,
  EXIT_FINDINGS,
  EXIT_OK,
  EXIT_PREREQUISITE_NOT_MET,
  EXIT_REFUSED,
  MCP_GITHUB_PREFIX,
  denyList,
  rosterProblems,
  verdict,
} from './check-settings-deny-roster.mjs';

const NAME = 'install-settings-deny-roster';

/** The user-scope settings file a Claude Code session reads. */
export function defaultSettingsPath(home = homedir()) {
  return join(home, '.claude', 'settings.json');
}

/**
 * Which file to write and whether to write at all. Pure apart from
 * `process.cwd()`, which a relative `--settings` is relative to.
 */
export function parseArgv(argv, home = homedir()) {
  const dryRun = argv.includes('--dry-run');
  const at = argv.indexOf('--settings');
  if (at === -1) return { ok: true, path: defaultSettingsPath(home), dryRun };
  const value = argv[at + 1];
  if (value === undefined || value.startsWith('--')) {
    return { ok: false, reason: '`--settings` needs a path argument' };
  }
  return { ok: true, path: resolve(process.cwd(), value), dryRun };
}

/**
 * The merged document for one parsed settings document (or `null` when the
 * file is absent) against one roster. Pure; the input is never mutated.
 *
 * Returns `{ ok: true, doc, added }` -- `added` lists the roster tools the
 * document lacked, in roster order, and is empty when nothing would change --
 * or `{ ok: false, reason }` for a document whose shape this installer must
 * not overwrite.
 */
export function mergeDenyRoster(settings, roster) {
  if (settings === null) {
    return { ok: true, doc: { permissions: { deny: [...roster] } }, added: [...roster] };
  }
  const list = denyList(settings);
  if (!list.ok) return { ok: false, reason: list.reason };
  const have = new Set(list.deny);
  const added = roster.filter((tool) => !have.has(tool));
  const doc = { ...settings, permissions: { ...(settings.permissions ?? {}), deny: [...list.deny, ...added] } };
  return { ok: true, doc, added };
}

/** The bytes written for a document: two-space JSON and a final newline. */
export function serialise(doc) {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

/**
 * One run against one file. Returns `{ code, lines }`; the caller prints. The
 * roster is an argument so the self-test can drive the refusal path.
 */
export function install(path, { dryRun = false, roster = CONTENT_WRITE_TOOLS } = {}) {
  const lines = [];
  const problems = rosterProblems(roster);
  if (problems.length > 0) {
    for (const problem of problems) lines.push(`✗ ${NAME}: ${problem}. Nothing was written.`);
    return { code: EXIT_REFUSED, lines };
  }

  let current = null;
  if (existsSync(path)) {
    try {
      current = JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
      lines.push(
        `${NAME}: PREREQUISITE NOT MET — ${path} could not be read or parsed: ${error.message}. ` +
          'Nothing was written: overwriting a file this script cannot read would destroy what else it holds.',
      );
      return { code: EXIT_PREREQUISITE_NOT_MET, lines };
    }
  }

  const merged = mergeDenyRoster(current, roster);
  if (!merged.ok) {
    lines.push(`${NAME}: PREREQUISITE NOT MET — ${path}: ${merged.reason}. Nothing was written.`);
    return { code: EXIT_PREREQUISITE_NOT_MET, lines };
  }

  let judged = merged.doc;
  if (merged.added.length === 0) {
    lines.push(`${NAME}: ${path} already denies all ${roster.length} roster tool(s); nothing written.`);
  } else if (dryRun) {
    lines.push(
      `${NAME}: --dry-run — would ${current === null ? 'create' : 'update'} ${path}, adding ` +
        `${merged.added.length} deny entr(ies): ${merged.added.join(', ')}. Nothing was written.`,
    );
  } else {
    mkdirSync(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, serialise(merged.doc));
    renameSync(temporary, path);
    // Judge what is ON DISK, not what was meant to be written.
    judged = JSON.parse(readFileSync(path, 'utf8'));
    lines.push(
      `${NAME}: ${current === null ? 'created' : 'updated'} ${path}, adding ${merged.added.length} deny ` +
        `entr(ies) (${roster.length} roster tool(s) in all).`,
    );
  }

  const after = denyList(judged);
  const { missing, drift } = after.ok ? verdict(after.deny, roster) : { missing: [...roster], drift: [] };
  if (missing.length > 0) {
    // Reachable only under --dry-run: a real write that left a tool out is a
    // defect in this file, and it reads the same way.
    lines.push(`${dryRun ? '' : '✗ '}${NAME}: ${path} does not yet deny ${missing.join(', ')}.`);
    return { code: dryRun ? EXIT_OK : EXIT_FINDINGS, lines };
  }
  if (drift.length > 0) {
    lines.push(
      `✗ ${NAME}: ${path} also denies ${drift.join(', ')}, which the roster does not declare. ` +
        `Left in place (this installer never removes a deny entry); declare it in CONTENT_WRITE_TOOLS or drop it from the file.`,
    );
    return { code: EXIT_FINDINGS, lines };
  }
  lines.push(`✓ ${NAME}: ${path} denies exactly the ${roster.length}-tool ${MCP_GITHUB_PREFIX} roster.`);
  return { code: EXIT_OK, lines };
}

// ── The self-test's own battery roster and floor ────────────────────────────
//
// Copied from the landed shape in `check-settings-deny-roster.mjs`: every
// assertion is filed under the battery most recently opened, the opened set
// must equal the declared set with each battery at or above its count, the
// roster's own size is pinned, and the verdict sets a handshake flag the
// dispatch reads.
const SELF_TEST_BATTERIES = Object.freeze({
  'mergeDenyRoster — the shapes a settings document arrives in': 8,
  'mergeDenyRoster — refusals leave the shape alone': 4,
  'install — on a real filesystem': 12,
  'install — refusals write nothing': 5,
  'one roster — imported, never restated': 3,
  'parseArgv': 4,
});

const SELF_TEST_BATTERY_FLOOR = 6;

const UNATTRIBUTED_BATTERY = '(no battery open)';

let selfTestReachedVerdict = false;

function selfTest() {
  const batterySeen = new Map();
  let openBattery = null;
  const battery = (name) => {
    openBattery = name;
  };
  const cases = [];
  const assert = (name, actual, expected) => {
    const b = openBattery ?? UNATTRIBUTED_BATTERY;
    batterySeen.set(b, (batterySeen.get(b) ?? 0) + 1);
    cases.push({ name, ok: JSON.stringify(actual) === JSON.stringify(expected), actual, expected });
  };

  const roster = ['mcp__github__alpha_write', 'mcp__github__beta_write'];

  // --- merge ----------------------------------------------------------------
  battery('mergeDenyRoster — the shapes a settings document arrives in');
  assert('an absent file becomes the roster alone', mergeDenyRoster(null, roster), {
    ok: true,
    doc: { permissions: { deny: roster } },
    added: roster,
  });
  assert('an empty document gains permissions.deny', mergeDenyRoster({}, roster).doc, { permissions: { deny: roster } });
  const rich = { model: 'x', hooks: { Stop: [] }, permissions: { allow: ['Skill'], deny: ['Read(/secret)'] } };
  const mergedRich = mergeDenyRoster(rich, roster);
  assert('other top-level keys are kept', [mergedRich.doc.model, mergedRich.doc.hooks], ['x', { Stop: [] }]);
  assert('permissions.allow is kept', mergedRich.doc.permissions.allow, ['Skill']);
  assert('existing deny entries are kept, first, in their order', mergedRich.doc.permissions.deny, ['Read(/secret)', ...roster]);
  assert('the input document is not mutated', rich.permissions.deny, ['Read(/secret)']);
  assert('a partial roster gains only the missing tool', mergeDenyRoster({ permissions: { deny: ['mcp__github__beta_write'] } }, roster).added, [
    'mcp__github__alpha_write',
  ]);
  assert('a document already holding the roster adds nothing', mergeDenyRoster({ permissions: { deny: [...roster] } }, roster).added, []);

  battery('mergeDenyRoster — refusals leave the shape alone');
  assert('a non-object document is refused', mergeDenyRoster([1], roster).ok, false);
  assert('a non-object permissions is refused', mergeDenyRoster({ permissions: 'all' }, roster).ok, false);
  assert('a deny of the wrong type is refused, never replaced', mergeDenyRoster({ permissions: { deny: 'x' } }, roster).ok, false);
  assert('a non-string deny member is refused', mergeDenyRoster({ permissions: { deny: [7] } }, roster).ok, false);

  // --- install on disk ------------------------------------------------------
  battery('install — on a real filesystem');
  const scratch = mkdtempSync(join(tmpdir(), `${NAME}-`));
  try {
    const fresh = join(scratch, 'nested', '.claude', 'settings.json');
    const created = install(fresh, { roster });
    assert('an absent file in an absent folder is created, exit 0', [created.code, existsSync(fresh)], [EXIT_OK, true]);
    assert('the created file holds exactly the roster', JSON.parse(readFileSync(fresh, 'utf8')), { permissions: { deny: roster } });
    assert('no temporary file is left beside it', existsSync(`${fresh}.${process.pid}.tmp`), false);

    const before = readFileSync(fresh, 'utf8');
    const mtime = statSync(fresh).mtimeMs;
    const again = install(fresh, { roster });
    assert('a second run exits 0', again.code, EXIT_OK);
    assert('a second run leaves the bytes', readFileSync(fresh, 'utf8'), before);
    assert('a second run leaves the mtime (nothing was written)', statSync(fresh).mtimeMs, mtime);

    const existing = join(scratch, 'existing.json');
    writeFileSync(existing, serialise({ permissions: { allow: ['Skill'], deny: ['Edit(~/x)'] }, env: { A: '1' } }));
    const updated = install(existing, { roster });
    assert('an existing file is updated, exit 0', updated.code, EXIT_OK);
    assert('the update keeps every other key and entry', JSON.parse(readFileSync(existing, 'utf8')), {
      permissions: { allow: ['Skill'], deny: ['Edit(~/x)', ...roster] },
      env: { A: '1' },
    });

    const dry = join(scratch, 'dry.json');
    const dryRun = install(dry, { roster, dryRun: true });
    assert('--dry-run writes nothing', [dryRun.code, existsSync(dry)], [EXIT_OK, false]);

    const drifted = join(scratch, 'drift.json');
    writeFileSync(drifted, serialise({ permissions: { deny: ['mcp__github__gamma_write'] } }));
    const drift = install(drifted, { roster });
    assert('an undeclared github deny entry is a finding, exit 1', drift.code, EXIT_FINDINGS);
    assert('the drifted entry is kept and the roster still added', JSON.parse(readFileSync(drifted, 'utf8')).permissions.deny, [
      'mcp__github__gamma_write',
      ...roster,
    ]);

    // The real roster, end to end: what this writes is what the gate passes.
    const real = join(scratch, 'real.json');
    const realRun = install(real);
    const realDeny = denyList(JSON.parse(readFileSync(real, 'utf8')));
    assert('with the shipped roster, the written file passes the gate verdict', [realRun.code, verdict(realDeny.deny, CONTENT_WRITE_TOOLS)], [
      EXIT_OK,
      { missing: [], drift: [] },
    ]);

    battery('install — refusals write nothing');
    const broken = join(scratch, 'broken.json');
    writeFileSync(broken, '{ "permissions": ');
    assert('an unparseable file exits 3', install(broken, { roster }).code, EXIT_PREREQUISITE_NOT_MET);
    assert('an unparseable file is left byte-for-byte', readFileSync(broken, 'utf8'), '{ "permissions": ');
    const wrongShape = join(scratch, 'wrong.json');
    writeFileSync(wrongShape, serialise({ permissions: { deny: 'mcp__github__alpha_write' } }));
    assert('a deny of the wrong type exits 3', install(wrongShape, { roster }).code, EXIT_PREREQUISITE_NOT_MET);
    assert('a deny of the wrong type is left in place', JSON.parse(readFileSync(wrongShape, 'utf8')).permissions.deny, 'mcp__github__alpha_write');
    const refusedPath = join(scratch, 'refused.json');
    assert('an empty roster is refused (exit 2) and creates no file', [install(refusedPath, { roster: [] }).code, existsSync(refusedPath)], [
      EXIT_REFUSED,
      false,
    ]);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  // --- one roster -------------------------------------------------------------
  battery('one roster — imported, never restated');
  assert('the imported roster is well-formed', rosterProblems(CONTENT_WRITE_TOOLS), []);
  // A positive control on the population, spelled as a suffix so that the
  // literal check below stays meaningful: the issue-write tool must be there.
  assert('the imported roster names the issue-write tool', CONTENT_WRITE_TOOLS.some((tool) => tool.endsWith('__issue_write')), true);
  const ownSource = readFileSync(new URL(import.meta.url), 'utf8');
  const restated = CONTENT_WRITE_TOOLS.filter((tool) => ownSource.includes(`'${tool}'`));
  assert('this file spells no roster tool as a string literal', restated, []);

  battery('parseArgv');
  assert('no flag targets the user scope', parseArgv([], '/home/u').path, '/home/u/.claude/settings.json');
  assert('an absolute --settings is used as given', parseArgv(['--settings', '/tmp/s.json'], '/home/u').path, '/tmp/s.json');
  assert('--settings with no value is refused, not defaulted', parseArgv(['--settings'], '/home/u').ok, false);
  assert('--dry-run is read', parseArgv(['--dry-run'], '/home/u').dryRun, true);

  // ── The floor ─────────────────────────────────────────────────────────────
  const floorFailure = (message) => cases.push({ name: message, ok: false, actual: 'did not run', expected: 'runs' });
  const declared = Object.keys(SELF_TEST_BATTERIES);
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    floorFailure(`SELF_TEST_BATTERIES declares ${declared.length} batteries, below the pinned ${SELF_TEST_BATTERY_FLOOR}.`);
  }
  for (const [name, count] of batterySeen) {
    if (!declared.includes(name)) floorFailure(`battery "${name}" registered ${count} case(s) but is not declared.`);
  }
  for (const name of declared) {
    const count = batterySeen.get(name) ?? 0;
    if (count < SELF_TEST_BATTERIES[name]) {
      floorFailure(`battery "${name}" registered ${count} case(s), below its pinned ${SELF_TEST_BATTERIES[name]} — cases stopped running.`);
    }
  }

  const failed = cases.filter((c) => !c.ok);
  for (const c of failed) {
    console.error(`  ✗ ${c.name}\n     expected ${JSON.stringify(c.expected)}\n     actual   ${JSON.stringify(c.actual)}`);
  }
  if (failed.length > 0) {
    console.error(`✗ ${NAME} self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    return EXIT_FINDINGS;
  }
  console.log(`✓ ${NAME} self-test: ${cases.length} cases pass.`);

  selfTestReachedVerdict = true;
  return EXIT_OK;
}

if (isEntrypoint(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) {
    const code = selfTest();
    if (!selfTestReachedVerdict) {
      console.error(`\n✗ ${NAME} self-test: selfTest() returned without reaching its verdict; refusing to exit 0.\n`);
      process.exit(EXIT_FINDINGS);
    }
    process.exit(code);
  }
  const args = parseArgv(argv);
  if (!args.ok) {
    console.error(`${NAME}: PREREQUISITE NOT MET — ${args.reason}. Nothing was written.`);
    process.exit(EXIT_PREREQUISITE_NOT_MET);
  }
  const { code, lines } = install(args.path, { dryRun: args.dryRun });
  for (const line of lines) (code === EXIT_OK ? console.log : console.error)(line);
  process.exit(code);
}
