#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-settings-deny-roster (#18281) -- pins the `deny` list in
 * `.claude/settings.json` to the roster of MCP GitHub CONTENT-write tools the
 * dispatch charter declares closed.
 *
 *   node scripts/pm/check-settings-deny-roster.mjs                    # the gate
 *   node scripts/pm/check-settings-deny-roster.mjs --settings <path>  # judge another copy of that file
 *   node scripts/pm/check-settings-deny-roster.mjs --self-test        # verify the checker
 *
 * ## Why this exists
 *
 * Three surfaces state one rule and none of them reads another. The dispatch
 * charter says content writes go through the REST proxy and never through an
 * MCP write tool (`.claude/skills/pm-dispatch/SKILL.md`); the dev agent's
 * report contract refuses a run whose `mcp_calls` names one
 * (`.claude/agents/os-dev.md`); and the ENFORCED half -- the only one a running
 * session obeys -- is `permissions.deny` in `.claude/settings.json`. The
 * charter's refusal does not enumerate the tools, it POINTS at that list, so
 * the two halves were reconciled by whoever last read both files.
 *
 * Nothing under `scripts/` read the deny list's MEMBERSHIP before this file.
 * The key `permissions.deny` occurred there only inside comments and one
 * handoff string, and the hook self-tests grep `.claude/settings.json` for hook
 * registration and for two enqueue matchers -- never for a tool name. So a tool
 * the charter declares closed could be absent from `deny` with every gate
 * green, and that is measured rather than hypothetical: #18218 was exactly that
 * state for `update_pull_request`, declared closed in the prose and open in the
 * file, found by a human reading both. Reverting that entry moves zero
 * diagnostics by construction, which is the whole finding.
 *
 * ## What is asserted -- both directions over ONE population
 *
 * The population is the `mcp__github__` namespace and only it: a `deny` entry
 * outside that namespace belongs to another subsystem and is ignored here.
 * Inside it the two sets must be EQUAL.
 *
 *   1. CONTAINMENT -- every tool in the roster appears in `deny`. This is the
 *      #18218 direction: declared closed, enforced open.
 *   2. NO DRIFT -- every `mcp__github__` entry in `deny` is one the roster
 *      declares. A tool denied in the file and unnamed in the roster is
 *      enforcement a charter reader cannot find, and it is the direction under
 *      which this roster quietly stops being the list the charter points at.
 *
 * Equality rather than containment alone is the decided shape: the charter's
 * refusal is worded as "the deny list", so a reader who takes it at its word
 * gets the FILE's membership, and any entry the roster does not carry makes
 * that reader's list and this one differ. The failure text for direction 2
 * therefore sends the author here rather than to the settings file.
 *
 * ⛔ The roster is declared ONCE, in `CONTENT_WRITE_TOOLS` below. Prose that
 * tells a seat which tools are closed POINTS at it; a second enumeration is the
 * hand reconciliation this gate exists to end.
 *
 * ## What is deliberately NOT asserted
 *
 * The ENQUEUE class -- `enable_pr_auto_merge` and `disable_pr_auto_merge` -- is
 * not in the roster. Both are a live fallback channel in
 * `.claude/skills/pm-dispatch/references/rest-channel.md`, so whether they are
 * closed is the maintainer's call and is carded separately (#18282). If they
 * are ruled closed, this gate needs exactly one edit -- two more names in the
 * constant -- and that is the point of a single constant.
 *
 * Also not asserted: that `allow` and `deny` agree, that the tools exist on the
 * MCP server, or that a session honours either list. This gate holds the one
 * property neither prose surface can hold about itself -- that the enforced
 * list still equals the declared one.
 *
 * ## Exit contract
 *
 *   0  declared = enforced.
 *   1  FINDING -- a roster tool missing from `deny`, or an `mcp__github__` deny
 *      entry the roster does not declare. A settings document carrying no
 *      `permissions.deny` at all is this code too, not a skip: that file parses,
 *      and what it says is that nothing is denied.
 *   2  REFUSED -- this gate's OWN roster is unusable (empty, duplicated, or an
 *      entry outside the namespace it judges). An empty roster makes
 *      containment vacuously true, which is the false green this file exists to
 *      remove -- a gate that cannot find its input must fail (#4690).
 *   3  PREREQUISITE NOT MET -- the settings file could not be read, could not be
 *      parsed, or carries a `deny` that is not a list of strings. NOTHING was
 *      measured and the path is named in the message, the same number and the
 *      same words the rest of this lane's gates use.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

import { isEntrypoint } from '../invoked-as.mjs';

/**
 * The MCP GitHub tools the charter classes as CONTENT writes -- the roster this
 * gate holds `permissions.deny` equal to, declared ONCE so that prose can point
 * instead of restating.
 *
 * Membership rule, so the next editor does not have to infer it: a tool is here
 * when invoking it PUBLISHES or MUTATES repository content -- an issue, a
 * comment, a review body, a pull request, a branch, a file, a repository. The
 * enqueue pair is deliberately absent (see the header). Read-only tools are not
 * in this namespace question at all.
 */
export const CONTENT_WRITE_TOOLS = Object.freeze([
  'mcp__github__issue_write',
  'mcp__github__create_pull_request',
  'mcp__github__update_pull_request',
  'mcp__github__add_issue_comment',
  'mcp__github__add_comment_to_pending_review',
  'mcp__github__add_reply_to_pull_request_comment',
  'mcp__github__pull_request_review_write',
  'mcp__github__push_files',
  'mcp__github__create_or_update_file',
  'mcp__github__delete_file',
  'mcp__github__create_branch',
  'mcp__github__sub_issue_write',
  'mcp__github__merge_pull_request',
  'mcp__github__create_repository',
  'mcp__github__fork_repository',
]);

/** The namespace this gate judges. Entries outside it are another subsystem's. */
export const MCP_GITHUB_PREFIX = 'mcp__github__';

/** The settings file this gate reads, as the repo spells it on disk. */
const SETTINGS_PATH = '.claude/settings.json';

/**
 * The population above, declared for `scripts/pm/dispatch-gates.mjs`
 * (`scripts/pm/dispatch-gates.mjs#extractWatchHints`) so that a card editing
 * the settings file derives this gate.
 *
 * ⚠️ Spelled as a LITERAL array, never computed from `SETTINGS_PATH`: the
 * extractor reads SOURCE TEXT, so a computed declaration contributes nothing
 * while every runtime assertion about its value stays green, and this gate
 * would drop out of every dispatch brief silently (`check:watch-hint-literal`
 * holds exactly that). The literal is admissible because it carries a
 * separator and opens on a dotted top-level directory.
 *
 * It names ONE FILE rather than a subtree on purpose. `.claude/**` would place
 * this gate on every card touching an agent file or a hook, which is a
 * fabricated lead in the derivation's own terms; the single-file spelling under
 * this name follows `scripts/check-tenant-audit-census.mjs` and
 * `scripts/check-tenant-chokepoint.mjs`, which declare exact files the gate
 * really opens.
 */
const ROOT_DIR_WATCH_HINTS = ['.claude/settings.json'];

const REPO_ROOT_PATH = fileURLToPath(new URL('../../', import.meta.url));

export const EXIT_OK = 0;
export const EXIT_FINDINGS = 1;
export const EXIT_REFUSED = 2;
export const EXIT_PREREQUISITE_NOT_MET = 3;

/**
 * This gate's own roster, judged before anything else is. Pure. An empty or
 * malformed roster is a REFUSAL rather than a quiet pass, because every
 * assertion below is vacuously true over zero declared tools.
 */
export function rosterProblems(roster) {
  const problems = [];
  if (!Array.isArray(roster) || roster.length === 0) {
    problems.push('the roster is empty — containment over zero tools is vacuously true, so this is refused rather than passed');
    return problems;
  }
  const outside = roster.filter((tool) => typeof tool !== 'string' || !tool.startsWith(MCP_GITHUB_PREFIX));
  if (outside.length > 0) {
    problems.push(`the roster names ${outside.map((t) => JSON.stringify(t)).join(', ')} outside the ${MCP_GITHUB_PREFIX} namespace this gate judges`);
  }
  const seen = new Set();
  const repeated = new Set();
  for (const tool of roster) {
    if (seen.has(tool)) repeated.add(tool);
    seen.add(tool);
  }
  if (repeated.size > 0) {
    problems.push(`the roster repeats ${[...repeated].join(', ')} — a repeated name inflates the count this gate prints`);
  }
  return problems;
}

/**
 * The `permissions.deny` list of a parsed settings document. Pure. Returns a
 * refusal shape rather than throwing, so the caller owns the exit code and the
 * self-test can assert each refusal without a filesystem.
 *
 * `present: false` and `ok: false` are different answers on purpose. A document
 * with no `permissions.deny` is well-formed and says nothing is denied — a
 * finding this gate can state exactly. A `deny` of the wrong TYPE is a file
 * this gate cannot read at all, which is the prerequisite code.
 */
export function denyList(settings) {
  if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) {
    return { ok: false, reason: 'the settings document is not a JSON object' };
  }
  const permissions = settings.permissions;
  if (permissions === undefined) return { ok: true, present: false, absent: 'permissions', deny: [] };
  if (permissions === null || typeof permissions !== 'object' || Array.isArray(permissions)) {
    return { ok: false, reason: '`permissions` is present but is not an object' };
  }
  const deny = permissions.deny;
  if (deny === undefined) return { ok: true, present: false, absent: 'permissions.deny', deny: [] };
  if (!Array.isArray(deny)) return { ok: false, reason: '`permissions.deny` is present but is not an array' };
  const nonStrings = deny.filter((entry) => typeof entry !== 'string');
  if (nonStrings.length > 0) {
    return { ok: false, reason: `\`permissions.deny\` holds ${nonStrings.length} member(s) that are not strings` };
  }
  return { ok: true, present: true, deny };
}

/**
 * The two findings for one deny list against one roster. Pure — the roster is
 * an argument so the self-test can vary it.
 *
 * `missing` keeps roster order and `drift` keeps file order, deduplicated: a
 * name listed twice in the file is one finding, not two.
 */
export function verdict(deny, roster) {
  const denied = new Set(deny);
  const declared = new Set(roster);
  return {
    missing: roster.filter((tool) => !denied.has(tool)),
    drift: [...new Set(deny.filter((entry) => entry.startsWith(MCP_GITHUB_PREFIX) && !declared.has(entry)))],
  };
}

/**
 * Which settings file to judge. Pure apart from `process.cwd()`, which is what
 * a relative `--settings` is relative to.
 *
 * The flag exists for two jobs: judging a copy of the file that is not the
 * working tree's (a sibling branch's version, extracted with `git show`), and
 * giving a reader of this header a way to reproduce a reading without editing
 * anything.
 */
export function settingsPathFromArgv(argv, repoRoot) {
  const at = argv.indexOf('--settings');
  if (at === -1) return { ok: true, path: resolve(repoRoot, SETTINGS_PATH), label: SETTINGS_PATH };
  const value = argv[at + 1];
  if (value === undefined || value.startsWith('--')) {
    return { ok: false, reason: '`--settings` needs a path argument' };
  }
  return { ok: true, path: resolve(process.cwd(), value), label: value };
}

function runGate(argv) {
  const problems = rosterProblems(CONTENT_WRITE_TOOLS);
  if (problems.length > 0) {
    for (const problem of problems) console.error(`✗ check-settings-deny-roster: ${problem}.`);
    return EXIT_REFUSED;
  }

  const target = settingsPathFromArgv(argv, REPO_ROOT_PATH);
  if (!target.ok) {
    console.error(`check-settings-deny-roster: PREREQUISITE NOT MET — ${target.reason}. Nothing was measured.`);
    return EXIT_PREREQUISITE_NOT_MET;
  }

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(target.path, 'utf8'));
  } catch (error) {
    console.error(
      `check-settings-deny-roster: PREREQUISITE NOT MET — ${target.path} could not be read or parsed: ` +
        `${error.message}. Nothing was measured — this is not a green and not a finding.`,
    );
    return EXIT_PREREQUISITE_NOT_MET;
  }

  const list = denyList(parsed);
  if (!list.ok) {
    console.error(
      `check-settings-deny-roster: PREREQUISITE NOT MET — ${target.path}: ${list.reason}. ` +
        'Nothing was measured — this is not a green and not a finding.',
    );
    return EXIT_PREREQUISITE_NOT_MET;
  }

  if (!list.present) {
    console.error(
      `✗ check-settings-deny-roster: ${target.path} carries no \`${list.absent}\`, so every one of the ` +
        `${CONTENT_WRITE_TOOLS.length} content-write tools the charter declares closed is enforced OPEN. ` +
        'The file parses; what it says is that nothing is denied.',
    );
    return EXIT_FINDINGS;
  }

  const { missing, drift } = verdict(list.deny, CONTENT_WRITE_TOOLS);
  const failures = [];
  if (missing.length > 0) {
    failures.push(
      `${target.path} does not deny ${missing.join(', ')} — the charter declares ` +
        `${missing.length === 1 ? 'it' : 'them'} closed while the enforced list leaves ` +
        `${missing.length === 1 ? 'it' : 'them'} open. Add the missing name(s) to the deny list in that file.`,
    );
  }
  if (drift.length > 0) {
    failures.push(
      `${target.path} denies ${drift.join(', ')}, which this gate's roster does not declare — roster drift: ` +
        'declare it in the constant (`CONTENT_WRITE_TOOLS` in this file), or drop the entry from the file. ' +
        'A tool denied in one place and unnamed in the other is enforcement no charter reader can find.',
    );
  }
  if (failures.length > 0) {
    for (const failure of failures) console.error(`✗ check-settings-deny-roster: ${failure}`);
    return EXIT_FINDINGS;
  }

  const outside = list.deny.filter((entry) => !entry.startsWith(MCP_GITHUB_PREFIX)).length;
  console.log(
    `✓ check-settings-deny-roster: ${CONTENT_WRITE_TOOLS.length} content-write tool(s) declared = enforced in ` +
      `${target.label} (${list.deny.length - outside} ${MCP_GITHUB_PREFIX} deny entr(ies), ${outside} outside ` +
      "this gate's population and ignored).",
  );
  return EXIT_OK;
}

// ── The self-test's own battery roster and floor ────────────────────────────
//
// `failures.length === 0` as the only success condition prints the same line
// for "every case held" and "the cases never ran". What is pinned is the
// registered NAMES, not a number: every section opens with `battery('<name>')`,
// every assertion is attributed to the battery most recently opened, and the
// floor requires the OPENED set to equal the DECLARED set with each battery at
// or above its own count.
//
// ⛔ A pinned TOTAL is not the repair: a battery dropping from 9 cases to 3
// keeps a total "right" the moment a sibling grows. The counts are a FLOOR --
// adding cases is ordinary work and must not red.
const SELF_TEST_BATTERIES = Object.freeze({
  'denyList — the shapes a settings document arrives in': 7,
  'verdict — both directions': 7,
  "the roster's own well-formedness": 4,
  'settingsPathFromArgv': 3,
  'the exit contract': 4,
  'the shipped .claude/settings.json': 4,
  'the dispatch-gates declaration': 3,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 7;

// The key an assertion is filed under when no battery is open. It is not a
// declared battery, so it reds by the same set difference rather than silently
// inflating whichever battery happened to run last.
const UNATTRIBUTED_BATTERY = '(no battery open)';

// Set by `selfTest()` only after its verdict is printed, and read at the
// dispatch: a `return` that leaves the function above that line prints nothing
// and still exits 0 — a self-test that never finished, reported as one that
// passed.
let selfTestReachedVerdict = false;

function selfTest() {
  const batterySeen = new Map();
  let openBattery = null;
  const battery = (name) => {
    openBattery = name;
  };
  const registerCase = () => {
    const b = openBattery ?? UNATTRIBUTED_BATTERY;
    batterySeen.set(b, (batterySeen.get(b) ?? 0) + 1);
  };
  const cases = [];
  const assert = (name, actual, expected) => {
    registerCase();
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    cases.push({ name, ok, actual, expected });
  };

  const roster = ['mcp__github__alpha_write', 'mcp__github__beta_write'];
  const settingsWith = (deny) => ({ permissions: { allow: ['Bash(ls:*)'], deny } });

  // --- denyList ----------------------------------------------------------
  battery('denyList — the shapes a settings document arrives in');
  assert('a well-formed document yields its deny list', denyList(settingsWith(['a', 'b'])), { ok: true, present: true, deny: ['a', 'b'] });
  assert('an empty deny list is present, not absent', denyList(settingsWith([])), { ok: true, present: true, deny: [] });
  assert('no permissions key reads as absent, not malformed', denyList({}).absent, 'permissions');
  assert('no deny key reads as absent, not malformed', denyList({ permissions: { allow: [] } }).absent, 'permissions.deny');
  assert('a non-object document is refused', denyList([1, 2]).ok, false);
  assert('a deny of the wrong type is refused, never read as empty', denyList(settingsWith('mcp__github__issue_write')).ok, false);
  assert('a non-string member refuses rather than being skipped', denyList(settingsWith(['a', 7])).ok, false);

  // --- verdict -----------------------------------------------------------
  battery('verdict — both directions');
  assert('an exactly equal list passes both halves', verdict([...roster], roster), { missing: [], drift: [] });
  // The #18218 defect, reproduced: one tool declared closed and left enforced open.
  assert('a roster tool missing from deny is caught', verdict(['mcp__github__alpha_write'], roster).missing, ['mcp__github__beta_write']);
  assert('a deny entry the roster does not declare is caught', verdict([...roster, 'mcp__github__gamma_write'], roster).drift, ['mcp__github__gamma_write']);
  assert('both directions are reported together', verdict(['mcp__github__gamma_write'], roster), {
    missing: ['mcp__github__alpha_write', 'mcp__github__beta_write'],
    drift: ['mcp__github__gamma_write'],
  });
  // The population boundary: another subsystem's deny entries are not this gate's.
  assert('a non-github deny entry is outside the population', verdict([...roster, 'Bash(rm:*)', 'mcp__slack__post'], roster).drift, []);
  assert('a name repeated in the file is one finding, not two', verdict(['mcp__github__gamma_write', 'mcp__github__gamma_write', ...roster], roster).drift, ['mcp__github__gamma_write']);
  assert('an empty deny list reports every roster tool missing', verdict([], roster).missing, roster);

  // --- the roster's own well-formedness ----------------------------------
  battery("the roster's own well-formedness");
  assert('the shipped roster is clean', rosterProblems(CONTENT_WRITE_TOOLS), []);
  assert('an empty roster is refused, not passed', rosterProblems([]).length, 1);
  assert('a name outside the judged namespace is refused', rosterProblems(['mcp__slack__post']).length, 1);
  assert('a repeated name is refused', rosterProblems(['mcp__github__a_write', 'mcp__github__a_write']).length, 1);

  // --- settingsPathFromArgv ----------------------------------------------
  battery('settingsPathFromArgv');
  assert('no flag reads the repo copy', settingsPathFromArgv([], '/repo'), { ok: true, path: '/repo/.claude/settings.json', label: SETTINGS_PATH });
  assert('an absolute flag value is used as given', settingsPathFromArgv(['--settings', '/tmp/x.json'], '/repo').path, '/tmp/x.json');
  assert('a flag with no value is refused rather than defaulted', settingsPathFromArgv(['--settings'], '/repo').ok, false);

  // --- the exit contract --------------------------------------------------
  battery('the exit contract');
  assert('a finding exits 1', EXIT_FINDINGS, 1);
  assert("this gate's own refusal exits 2", EXIT_REFUSED, 2);
  assert('the prerequisite refusal exits 3', EXIT_PREREQUISITE_NOT_MET, 3);
  assert('the three codes are distinct', new Set([EXIT_OK, EXIT_FINDINGS, EXIT_REFUSED, EXIT_PREREQUISITE_NOT_MET]).size, 4);

  // --- the shipped settings file -----------------------------------------
  //
  // ⚠️ What is NOT pinned here is the CONTAINMENT direction. On a tree where a
  // roster tool is still missing from the file, the live run says so and that
  // reading is the gate's product — pinning it in the self-test would either
  // bless the gap or red the moment the gap closes. The direction pinned here
  // is the stable one: the file declares nothing this roster has not.
  battery('the shipped .claude/settings.json');
  const shipped = denyList(JSON.parse(readFileSync(resolve(REPO_ROOT_PATH, SETTINGS_PATH), 'utf8')));
  assert('the shipped settings file parses and carries a deny list', [shipped.ok, shipped.present], [true, true]);
  // A positive control: a name that is on the shipped list proves this battery
  // read the real file rather than an empty or unrelated one.
  assert('the shipped deny list denies the pull-request create tool', shipped.deny.includes('mcp__github__create_pull_request'), true);
  assert('the shipped deny list declares no tool this roster lacks', verdict(shipped.deny, CONTENT_WRITE_TOOLS).drift, []);
  assert('every shipped deny entry is a string', shipped.deny.every((entry) => typeof entry === 'string'), true);

  // --- the dispatch-gates declaration ------------------------------------
  //
  // Enforcement cannot hold any of these from here: the declaration is read by
  // another tool entirely, so a wrong or missing entry runs perfectly green and
  // shows up only as a dev dispatched on a settings card with this gate absent
  // from the brief.
  battery('the dispatch-gates declaration');
  assert('the declaration names the file this gate reads', ROOT_DIR_WATCH_HINTS, [SETTINGS_PATH]);
  assert('every declared hint carries a separator', ROOT_DIR_WATCH_HINTS.every((hint) => hint.includes('/')), true);
  assert('every declared hint opens on a character the extractor admits', ROOT_DIR_WATCH_HINTS.every((hint) => /^[\w.@]/.test(hint)), true);

  // ── The floor: every declared battery RAN, and ran its cases ────────────
  const floorFailure = (message) => {
    cases.push({ name: message, ok: false, actual: 'the battery did not run', expected: 'the battery runs its pinned cases' });
  };
  const declaredBatteries = Object.keys(SELF_TEST_BATTERIES);
  let floorBreached = false;
  if (declaredBatteries.length < SELF_TEST_BATTERY_FLOOR) {
    floorBreached = true;
    floorFailure(
      `SELF_TEST_BATTERIES declares ${declaredBatteries.length} batteries, below the pinned ` +
        `${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`,
    );
  }
  for (const [name, count] of batterySeen) {
    if (declaredBatteries.includes(name)) continue;
    floorBreached = true;
    floorFailure(
      `self-test battery "${name}" registered ${count} case(s) but is not declared in SELF_TEST_BATTERIES — ` +
        'an assertion attributed to no declared battery is one nothing floors.',
    );
  }
  for (const name of declaredBatteries) {
    const count = batterySeen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floorBreached = true;
    floorFailure(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. ` +
          'The verdict below would have claimed those cases hold.'
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of ` +
          `${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }
  if (floorBreached) {
    floorFailure(
      'A battery at or below its floor means cases STOPPED RUNNING — the battery is the bug, not the number. ' +
        'Find what stopped registering (an early return, a deleted block, a guard that now skips) and restore it.',
    );
  }

  const failed = cases.filter((c) => !c.ok);
  for (const c of failed) {
    console.error(`  ✗ ${c.name}\n     expected ${JSON.stringify(c.expected)}\n     actual   ${JSON.stringify(c.actual)}`);
  }
  if (failed.length > 0) {
    console.error(`✗ check-settings-deny-roster self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    return EXIT_FINDINGS;
  }
  console.log(`✓ check-settings-deny-roster self-test: ${cases.length} cases pass.`);

  selfTestReachedVerdict = true;
  return EXIT_OK;
}

if (isEntrypoint(import.meta.url)) {
  const argv = process.argv.slice(2);
  const isSelfTest = argv.includes('--self-test');
  const code = isSelfTest ? selfTest() : runGate(argv);
  if (isSelfTest && !selfTestReachedVerdict) {
    console.error(
      '\n✗ check-settings-deny-roster self-test: selfTest() returned without reaching its verdict,\n' +
        'so no success line was printed. Exiting 0 here would report a self-test\n' +
        'that never finished as a self-test that passed.\n',
    );
    process.exit(EXIT_FINDINGS);
  }
  process.exit(code);
}
