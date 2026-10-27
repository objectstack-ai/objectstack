#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-sdui-manifest — freshness + integrity gate for the repo-root
 * `sdui.manifest.json` (#12924, ruled 2026-08-29: wire it, 签入 + 新鲜度门禁).
 *
 *   node scripts/check-sdui-manifest.mjs                     # gate this tree
 *   node scripts/check-sdui-manifest.mjs --require-objectui  # …and REFUSE to skip check 4
 *   node scripts/check-sdui-manifest.mjs --self-test         # verify the checker itself
 *
 * Check 4 reads an objectui checkout: `OBJECTUI_ROOT`, else the `../objectui`
 * sibling — the same two places `scripts/bump-objectui.sh` and
 * `scripts/objectui-range.mjs` look, deliberately NOT a second env spelling for
 * one checkout.
 *
 * ## What rots here, and which check catches it
 *
 * The artefact is a SYNC of objectui's public-tier registry, generated from
 * objectui's BUILT tree at the commit `.objectui-sha` pins
 * (`.cache/objectui-<SHA12>/apps/console`, materialised by `pnpm objectui:build`
 * — see `scripts/gen-sdui-manifest-node.mjs`, the one producer since ruling 丙 on
 * #17735). Checked-in syncs rot; the ruling's words for the failure mode are
 * 「同步一次就烂」. Offline, per-PR:
 *
 *   1. ABSENCE / SHAPE — the artefact exists at the repo root, parses, and
 *      carries a non-empty `components` map whose entries agree with their
 *      keys. An absent artefact silently reverts `validateJsxPages` to
 *      parse-only (`resolveSduiManifest()` degrades by design), so absence
 *      here is the loudest failure, never a skip. Same for the record file,
 *      whose fields are keyed to that one producer: `source` must read
 *      `built-tree`, and `modulesRoot` and `objectuiWorkspaceVersion` must be
 *      present. A record from the retired npm-install route (it carried
 *      `objectuiPackagesVersion` and no `source`) is RED here, never read as
 *      the same claim under an older name.
 *   2. TAMPER — sha256(artefact) equals the record. The manifest is
 *      generator-owned; a hand edit is invisible to every consumer (the
 *      resolver JSON.parses whatever is there), so the hash is the only
 *      instrument that notices one.
 *   3. STALENESS — the record's `objectuiSha` equals the live `.objectui-sha`.
 *      A pin bump changes which registry the shipped console runs, so the bump
 *      PR goes red HERE until the manifest is regenerated against the new pin
 *      — the moment an objectui checkout is guaranteed to exist (the bump
 *      required one).
 *   4. VERSION ↔ PIN CORRESPONDENCE — the record's `objectuiWorkspaceVersion`
 *      is the version `packages/core/package.json` DECLARES at the pinned
 *      commit. Checks 1-3 reach both fields and relate neither: the version is
 *      otherwise read as a presence check only, so the record could name pin C
 *      and version V with nothing asking whether V is C's version at all
 *      (#18611). The generator does not write such a record — it reads the
 *      version off the built tree AT the pin, and refuses a tree whose HEAD is
 *      not the pin — but a hand edit still produces one, and checks 1-3 stay
 *      green throughout.
 *      This is the only check here that needs an input from outside this tree,
 *      so it is the only one that can report NOT CHECKED — see below.
 *
 * ## With no pin: the in-tree registry (#25712)
 *
 * Once objectui's tree lives under `ui/` and `.objectui-sha` is gone (#25677),
 * there is no pin to build and no checkout to ask, so the oracle is the
 * registry in this tree. The mode is decided by `.objectui-sha` alone: with it
 * present, nothing above reads differently. Without it:
 *
 *   1–2. unchanged — the same shape and tamper checks, against a record keyed
 *        to the in-tree producer (`IN_TREE_RECORD_FIELDS`: the pin-keyed
 *        fields are not required, the `inTree` block is).
 *   3.   none HERE. Whether the committed artefact is the one this tree
 *        generates is decided by generating it, which needs the registry
 *        built: ci.yml's Build & E2E UI step (below) does that on every PR the
 *        registry's inputs move and on the merge queue's combined tree
 *        (#26137). It replaced a source digest per registry package, checked
 *        here against one-line records under `scripts/sdui-manifest.sources/`
 *        (#26051): two PRs on one package conflicted on its record even when
 *        neither moved the artefact, and no digest saw the parser, the
 *        `@objectstack` packages the registry imports, or two queued PRs
 *        together. A record that still names those records is RED (1–2).
 *   4.   none. The in-tree `@object-ui/core` version moves with every release
 *        of the one fixed version group while the registry does not, so the
 *        record carries it as provenance and the success line prints it.
 *
 * No pin AND no in-tree console is RED, naming both: a tree with neither has
 * nothing to be fresh against, which is a broken tree, not a skip.
 *
 * ## What this deliberately does NOT do, and where that risk is held
 *
 * No regeneration in this gate: it runs in a required lint job that builds
 * nothing, and the registry takes minutes to build. The regeneration runs where
 * the registry is built: ci.yml's Build & E2E UI step "The committed SDUI
 * manifest is the one this tree generates" (#26137) runs the generator and
 * compares the committed artefact with its output byte for byte, on
 * pull_request and on the merge queue's combined tree. It serialises through
 * the built `@objectstack/sdui-parser`, so an edit to this repo's OWN adapter
 * (`manifestFromConfigs`) moves its verdict too. Regeneration is
 * byte-deterministic (two runs over one built tree, identical bytes), so that
 * comparison and the remedy this gate prints both converge.
 * With a pin, the pinned commit's registry is immutable, so content drift
 * per-PR is not a live axis there.
 *
 * Check 4 relates two fields of the record; it does not re-run the producer.
 * That the artefact describes the pinned SOURCE (rather than a tarball objectui
 * published from an earlier commit under the same version string) is the
 * producer's guarantee, not this gate's: the generator reads only the built
 * tree at the pin (ruling 丙 on #17735). The claim printed on success is kept as
 * narrow as what ran.
 *
 * Check 4's oracle is an objectui CHECKOUT, which a required lint job does not
 * have and must not clone (network in a required job — the shape declined
 * above). So absence of the checkout is REPORTED, never converted into a
 * verdict: the success line then states which leg did not run and how to run
 * it, and `--require-objectui` makes that absence an exit 1 for the callers
 * that DO hold a checkout (a pin bump; any job that has already cloned
 * objectui). An unreadable answer with the checkout in hand is a failure, not a
 * gap — see `readPinnedDeclaredVersion`'s three outcomes.
 *
 * Absence is loud, everywhere (#13014/#4690): every input THIS TREE owns is
 * asserted before any verdict; a missing one exits 1 naming which. No `⚠` +
 * exit 0 — and no line claiming a leg that did not run, which is the same
 * failure with better manners.
 *
 * ## The one place the producer IS run: the self-test
 *
 * No production run here executes the generator. The self-test runs it once,
 * over a fixture: the real `PRODUCER` file, copied byte for byte into a
 * throwaway repo root beside a stub registry, under a TMPDIR reached through a
 * symlink, with its output then held to `checkTree`. A symlinked temp base is
 * the shape of macOS's default TMPDIR (`/var` -> `/private/var`), and it breaks
 * the generator's one path comparison: its resolve hook re-anchors a runner
 * import only when the import's parent URL equals the runner's, and Node
 * reports that URL by its realpath. A Linux runner's own TMPDIR is no symlink,
 * so without this row no CI run reaches that comparison.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';

const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The directory objectui's tree is imported under (#25677), as a bare segment. */
const UI_TREE = 'ui';

/** The in-tree console the generator reads when the tree has no pin (#25712). */
const UI_CONSOLE = 'ui/apps/console';

/** Where the `@object-ui/*` workspace packages live in the merged layout (display only). */
const UI_PACKAGES = 'ui/packages';

/**
 * What `checkTree` reads, repo-relative: three files with a pin; without one,
 * the same artefact and record plus the in-tree console's manifest (presence).
 */
const READ_PATHS = {
  artefact: 'sdui.manifest.json',
  record: join('scripts', 'sdui-manifest.record.json'),
  pin: '.objectui-sha',
  console: join(UI_CONSOLE, 'package.json'),
};

/**
 * Where check 4 looks for an objectui checkout when `OBJECTUI_ROOT` is unset.
 *
 * ⛔ Not a `READ_PATHS` entry and not a watch hint: it is outside this tree, so
 * no diff of THIS repo can move it and `dispatch-gates` has nothing to derive
 * from it. The pin hint below is what makes a `.objectui-sha` bump derive this
 * gate, which is the diff check 4 exists for.
 */
const OBJECTUI_SIBLING = '../objectui';

/**
 * The file whose `version` names the `@object-ui/*` set one objectui commit
 * declares — the same file the moved-pin remedy has always told operators to
 * read, now read by the gate instead of by hand.
 */
const OBJECTUI_VERSION_FILE = 'packages/core/package.json';

/**
 * The record's fields, keyed to the one producer (`scripts/gen-sdui-manifest-node.mjs`,
 * which reads objectui's built tree at the pin): absence of any is RED, and so is
 * a `source` other than `RECORD_SOURCE`.
 */
const RECORD_FIELDS = ['objectuiSha', 'source', 'modulesRoot', 'objectuiWorkspaceVersion', 'sha256', 'components'];
const RECORD_SOURCE = 'built-tree';

/**
 * The same, for the in-tree producer (no pin): the pin-keyed fields name a pin
 * and are not required, the `inTree` block (`IN_TREE_FIELDS`) is. The pin-keyed
 * fields survive an in-tree regeneration only while the artefact they describe
 * is byte-identical — see the generator.
 */
const IN_TREE_RECORD_FIELDS = ['source', 'sha256', 'components', 'inTree'];
const IN_TREE_FIELDS = ['modulesRoot', 'objectuiWorkspaceVersion'];

/**
 * `inTree` fields of retired freshness layouts. A record still carrying one is
 * RED, never read as the same claim: `registryPackages`, `registrySources` and
 * `registrySourcesSha256` are the single digest over every registry package
 * (retired by #26051), and `registryRecords` named the per-package records
 * that replaced it (retired by #26137, when CI began regenerating the
 * artefact instead).
 */
const RETIRED_IN_TREE_FIELDS = ['registryPackages', 'registrySources', 'registrySourcesSha256', 'registryRecords'];

/** The one command that clears each mode's freshness reds. */
const PIN_REGENERATE = 'pnpm objectui:build && node scripts/gen-sdui-manifest-node.mjs';
const IN_TREE_REGENERATE = 'node scripts/gen-sdui-manifest-node.mjs';

/**
 * The one producer, repo-relative. Read by the SELF-TEST only — copied into a
 * fixture tree and run there (see the header) — never by `checkTree`, so it is
 * not a `READ_PATHS` entry. Spelled as one literal at module scope so that
 * `scripts/pm/dispatch-gates.mjs` derives this gate for an edit to the producer.
 */
const PRODUCER = 'scripts/gen-sdui-manifest-node.mjs';

/**
 * The population this gate reads, declared for `scripts/pm/dispatch-gates.mjs`.
 *
 * With a pin, `checkTree` opens exactly three files. None of them was visible to the
 * derivation: it reads SOURCE TEXT, and a literal with no separator is refused
 * by `hintCovers` as too generic (`sdui.manifest.json`), while `.objectui-sha`
 * is not one of the dot-prefixed names the extractor admits and the record path
 * is assembled with `join()`. So both of this gate's CI invocations — the scan
 * and its `--self-test` — were scored `undetermined` for EVERY card, absent from
 * every dispatch brief and every `--commands` harvest, while CI ran them on each
 * pull request. That cost is sharpest here: the cards that implicate this gate
 * are exactly the ones that move the objectui pin or regenerate the manifest.
 *
 * `ROOT_WATCH_HINTS` is the mixed-roots spelling of the idiom, which is what
 * this population is: two repo-ROOT files and one under `scripts/`. The
 * repo-root pair carries the `/**` suffix because a bare single-segment literal
 * is refused; the collapse reduces each one back to the single file it names and
 * to nothing else.
 *
 * ⛔ Not a whole-tree marker, and not `scripts/**`: three files are three files.
 * Without a pin it also reads the in-tree console's manifest (#25712); on a
 * tree with no `ui/` that hint matches nothing and only displays. A registry
 * package edit no longer derives this gate: no digest walks `ui/packages/`
 * since #26137, and the CI regeneration holds freshness instead.
 *
 * The self-test derives the coupling from `READ_PATHS` — the same object
 * `checkTree` reads — so a moved or added read reds here rather than leaving the
 * declaration describing the old population.
 */
const ROOT_WATCH_HINTS = [
  'sdui.manifest.json/**',
  'scripts/sdui-manifest.record.json',
  '.objectui-sha/**',
  'ui/apps/console/package.json',
];

/**
 * What the PINNED objectui commit declares as its `@object-ui/*` version.
 *
 * THREE outcomes, kept apart on purpose — collapsing them is how a check like
 * this reads a false zero:
 *
 *   - `resolved`    — the checkout answered; `version` is what the pin declares.
 *   - `unreachable` — nothing could be asked: no checkout, or one that does not
 *     carry the pinned commit (a shallow clone usually will not). NOT a
 *     disagreement — `checkTree` never converts it into one.
 *   - `unsupported` — a checkout IS in hand, carries the commit, and still
 *     cannot answer: no `packages/core/package.json` there, or one that does
 *     not parse or declares no `version`. That is a broken pin, so it is RED.
 *
 * `objectuiRoot` wins over `OBJECTUI_ROOT` so a caller (the self-test) can pin
 * the oracle and be immune to the ambient environment.
 */
export function readPinnedDeclaredVersion(pin, { root = DEFAULT_ROOT, objectuiRoot } = {}) {
  const where = objectuiRoot ?? process.env.OBJECTUI_ROOT ?? join(root, OBJECTUI_SIBLING);
  const short = String(pin).slice(0, 12);

  // Shape first: `.objectui-sha` is hand-editable, and `git cat-file` on a
  // malformed ref fails the same way a missing commit does. Naming the real
  // reason beats reporting "the checkout does not carry it".
  if (!/^[0-9a-f]{40}$/.test(String(pin))) {
    return { status: 'unreachable', where, reason: `.objectui-sha does not hold a 40-character commit sha, so no checkout can be asked what it declares.` };
  }
  if (!existsSync(join(where, '.git'))) {
    return { status: 'unreachable', where, reason: `no objectui checkout at ${where} (no .git there). Set OBJECTUI_ROOT to one that carries the pin.` };
  }

  const git = (args) => {
    try {
      return { ok: true, out: execFileSync('git', ['-C', where, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 }) };
    } catch (e) {
      return { ok: false, err: String(e?.stderr || e?.message || e).trim().split('\n')[0] };
    }
  };

  if (!git(['cat-file', '-e', `${pin}^{commit}`]).ok) {
    return { status: 'unreachable', where, reason: `the objectui checkout at ${where} does not carry commit ${short}… (a shallow clone will not — 'git -C ${where} fetch --depth=1 origin ${pin}' brings it in).` };
  }
  const shown = git(['show', `${pin}:${OBJECTUI_VERSION_FILE}`]);
  if (!shown.ok) {
    return { status: 'unsupported', where, reason: `objectui commit ${short}… has no ${OBJECTUI_VERSION_FILE} (git: ${shown.err}). The pin names a commit that cannot declare an @object-ui version.` };
  }
  let declared;
  try {
    declared = JSON.parse(shown.out)?.version;
  } catch (e) {
    return { status: 'unsupported', where, reason: `${OBJECTUI_VERSION_FILE} at objectui ${short}… does not parse as JSON: ${e.message}` };
  }
  if (typeof declared !== 'string' || declared === '') {
    return { status: 'unsupported', where, reason: `${OBJECTUI_VERSION_FILE} at objectui ${short}… declares no string \`version\`.` };
  }
  return { status: 'resolved', where, version: declared };
}

/**
 * Gate one tree. Returns a list of problems; empty = green.
 *
 * `onVersionLeg` is called exactly once with check 4's outcome whenever the leg
 * is evaluated, so the caller can print a success line that claims only what
 * ran. `requireObjectui` turns an `unreachable` oracle into a problem, for the
 * callers that hold a checkout.
 */
export function checkTree(root, { objectuiRoot, requireObjectui = false, onVersionLeg } = {}) {
  const pinPath = join(root, READ_PATHS.pin);
  if (!existsSync(pinPath)) return checkTreeWithoutPin(root);

  const problems = [];
  const read = checkArtefactAndRecord(root, problems, {
    fields: RECORD_FIELDS,
    producerReads: "objectui's built tree at the pin",
    regenerate: PIN_REGENERATE,
  });
  if (read === null) return problems;
  const { record } = read;

  const pin = readFileSync(pinPath, 'utf8').trim();

  // Check 4's oracle, read once, about the LIVE pin.
  const versionLeg = readPinnedDeclaredVersion(pin, { root, objectuiRoot });
  onVersionLeg?.(versionLeg);

  if (pin !== record.objectuiSha) {
    problems.push(
      `.objectui-sha has moved to ${pin.slice(0, 12)}… but sdui.manifest.json was generated at ${String(record.objectuiSha).slice(0, 12)}…\n` +
        '  A pin bump changes which registry the shipped console runs; the manifest must follow it (同步一次就烂 is\n' +
        '  the failure mode this gate exists for). Build objectui at the new pin, then regenerate from that tree:\n' +
        '    pnpm objectui:build && node scripts/gen-sdui-manifest-node.mjs\n' +
        `  (the generator reads .cache/objectui-${pin.slice(0, 12)}/apps/console — it takes no version and no path).`,
    );
    // The version leg is NOT reported on top of this one: with the pin moved,
    // the record describes a different commit by construction, so a second
    // problem would restate this one rather than add a finding.
    return problems;
  }

  // ── Check 4 (#18611) ────────────────────────────────────────────────────
  if (versionLeg.status === 'resolved' && versionLeg.version !== record.objectuiWorkspaceVersion) {
    problems.push(
      `the record's two objectui fields describe different commits: objectuiWorkspaceVersion is ${JSON.stringify(record.objectuiWorkspaceVersion)},\n` +
        `  but objectui ${pin.slice(0, 12)}… — the pin the record itself names — declares ${JSON.stringify(versionLeg.version)} in ${OBJECTUI_VERSION_FILE}\n` +
        `  (read from ${versionLeg.where}). The generator reads this version off the built tree AT the pin and refuses a\n` +
        '  tree checked out anywhere else, so a disagreement came from outside it: a hand edit.\n' +
        '  Regenerate against the pin: pnpm objectui:build && node scripts/gen-sdui-manifest-node.mjs',
    );
  } else if (versionLeg.status === 'unsupported') {
    problems.push(
      `cannot judge objectuiWorkspaceVersion against the pin, with an objectui checkout in hand: ${versionLeg.reason}\n` +
        '  An oracle that is present and cannot answer is a failure, never a skip.',
    );
  } else if (versionLeg.status === 'unreachable' && requireObjectui) {
    problems.push(
      `--require-objectui was passed and check 4 could not run: ${versionLeg.reason}\n` +
        '  Point OBJECTUI_ROOT at a checkout that carries the pin, or drop the flag where no checkout exists.',
    );
  }
  return problems;
}

/**
 * Checks 1–2, the same in both modes: the artefact exists, parses and is a
 * component manifest; the record exists, parses, carries `fields` and the one
 * producer's `source`; the artefact's sha256 and component count are the
 * record's. Pushes onto `problems`; returns `null` where today's checks stop
 * early, otherwise `{ record }` for the mode's own freshness leg.
 */
function checkArtefactAndRecord(root, problems, { fields, producerReads, regenerate }) {
  const artefactPath = join(root, READ_PATHS.artefact);
  const recordPath = join(root, READ_PATHS.record);

  if (!existsSync(artefactPath)) {
    problems.push(
      'sdui.manifest.json is MISSING at the repo root. `resolveSduiManifest()` degrades to parse-only\n' +
        `  silently, so this gate is the thing that notices. Regenerate: ${regenerate}`,
    );
    return null; // every later check reads it
  }
  const raw = readFileSync(artefactPath, 'utf8');

  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (e) {
    problems.push(`sdui.manifest.json does not parse as JSON: ${e.message}`);
    return null;
  }
  const components = manifest?.components;
  if (!components || typeof components !== 'object' || Array.isArray(components)) {
    problems.push('sdui.manifest.json has no `components` object — not a component manifest.');
    return null;
  }
  const keys = Object.keys(components);
  if (keys.length === 0) problems.push('sdui.manifest.json declares 0 components — an empty whitelist would red every page.');
  for (const k of keys) {
    if (components[k]?.type !== k) {
      problems.push(`components[${JSON.stringify(k)}].type is ${JSON.stringify(components[k]?.type)} — key/type disagree.`);
      break; // one example is enough; this shape is generator-owned
    }
  }

  if (!existsSync(recordPath)) {
    problems.push('scripts/sdui-manifest.record.json is MISSING — provenance unknown. Regenerate to re-record.');
    return null;
  }
  let record;
  try {
    record = JSON.parse(readFileSync(recordPath, 'utf8'));
  } catch (e) {
    problems.push(`scripts/sdui-manifest.record.json does not parse: ${e.message}`);
    return null;
  }
  for (const field of fields) {
    if (record[field] === undefined) problems.push(`record is missing \`${field}\`.`);
  }
  if (record.source !== undefined && record.source !== RECORD_SOURCE) {
    problems.push(`record \`source\` is ${JSON.stringify(record.source)}, not ${JSON.stringify(RECORD_SOURCE)} — no producer in this repo writes that.`);
  }
  if (problems.length) {
    problems.push(
      `  The record is keyed to the one producer, which reads ${producerReads}. Regenerate:\n` +
        `    ${regenerate}`,
    );
    return null;
  }

  const sha256 = createHash('sha256').update(raw).digest('hex');
  if (sha256 !== record.sha256) {
    problems.push(
      `sdui.manifest.json sha256 ${sha256.slice(0, 12)}… does not match the record ${String(record.sha256).slice(0, 12)}…\n` +
        `  The artefact is generator-owned — never hand-edit it. Regenerate: ${regenerate}`,
    );
  }
  if (keys.length !== record.components) {
    problems.push(`artefact has ${keys.length} components, record says ${record.components}.`);
  }
  return { record };
}

/**
 * Gate a tree that has no pin (the merged layout, #25712). Checks 1–2 as
 * above, keyed to the in-tree producer's record, and the record's `inTree`
 * block in the producer's shape. There is no check 3 here: whether the
 * artefact is the one this tree generates is decided by generating it, in
 * ci.yml's Build & E2E UI step (#26137). There is no check 4 either: the
 * in-tree `@object-ui/core` version moves with every release of the fixed
 * group while the registry does not, so the record carries it as provenance
 * and the success line prints both. No pin and no in-tree console is RED,
 * naming both.
 */
function checkTreeWithoutPin(root) {
  const problems = [];
  if (!existsSync(join(root, UI_CONSOLE, 'package.json'))) {
    problems.push(
      `.objectui-sha is MISSING and there is no in-tree console (${UI_CONSOLE}) either — no oracle to judge freshness\n` +
        '  against. With the pin, the manifest is held to objectui\'s build at that commit; without it, to the\n' +
        `  registry under ${UI_TREE}/. A tree with neither cannot be called fresh.`,
    );
    return problems;
  }
  const read = checkArtefactAndRecord(root, problems, {
    fields: IN_TREE_RECORD_FIELDS,
    producerReads: `the in-tree console build (${UI_CONSOLE})`,
    regenerate: IN_TREE_REGENERATE,
  });
  if (read === null) return problems;
  const { record } = read;

  const inTree = record.inTree ?? {};
  const missing = IN_TREE_FIELDS.filter((field) => inTree[field] === undefined);
  const retired = RETIRED_IN_TREE_FIELDS.filter((field) => inTree[field] !== undefined);
  const shape = [];
  for (const field of missing) shape.push(`record \`inTree\` is missing \`${field}\`.`);
  if (retired.length > 0) {
    shape.push(
      `record \`inTree\` still carries ${retired.map((field) => `\`${field}\``).join(', ')} — a retired freshness layout (the\n` +
        '  single registry digest, #26051, or the per-package records that replaced it, #26137). No committed digest\n' +
        "  judges freshness now: ci.yml's Build & E2E UI step regenerates the artefact and compares the bytes.",
    );
  }
  if (!missing.includes('modulesRoot') && inTree.modulesRoot !== UI_CONSOLE) {
    shape.push(`record \`inTree.modulesRoot\` is ${JSON.stringify(inTree.modulesRoot)}, not ${JSON.stringify(UI_CONSOLE)} — the in-tree producer reads only that.`);
  }
  if (shape.length > 0) {
    problems.push(...shape, `  Regenerate in-tree — one command builds what the generator reads and re-records:\n    ${IN_TREE_REGENERATE}`);
  }
  return problems;
}

// Returned by `selfTest()` only after its verdict is printed. The dispatch
// refuses anything else: a `return` that leaves the function above that line
// prints nothing and still exits 0 — a self-test that never finished, reported
// as one that passed (#13798).
const SELF_TEST_VERDICT = 'check-sdui-manifest self-test reached its verdict';

// ── The self-test's own battery roster and floor (#13489) ──────────────────
//
// `failures === 0` used to be this self-test's ONLY success condition, so "every
// case held" and "the cases never ran" printed the same line. Closed the PR
// #13487 way: what is pinned is the registered NAMES, not a number.
//
// This self-test is TABLE-DRIVEN — one literal `cases` table, one loop over it,
// and a sink (`failures++`) that writes only when a case FAILS. Routing THAT
// sink through `registerCase()` would register a case only when it fails: a
// fully green run would register 0 and every battery would read DID NOT RUN, the
// floor inverted rather than installed. So the roster is the table's own rows.
// Each row LABEL is a declared battery, verbatim, with a floor of 1, and
// `registerCase(name)` is the first statement of the driving loop body — so the
// case is attributed to the row actually being run, whatever that row asserts
// afterwards. There is no `battery()` opener: for a table-driven self-test the
// ROW is the battery, so attribution is the loop variable rather than a
// most-recently-opened section.
//
// ⛔ A pinned TOTAL is not the repair, and neither is a roster DERIVED from the
// table: `cases.length` moves with the table, so a deleted row would delete its
// own floor. The roster below is a LITERAL the table is checked against, which
// is what lets a deleted or renamed row name ITSELF in the refusal.
//
// The counts are a FLOOR, not an equality — a row that grows into several
// registrations must not red. 1 is the honest floor for a table row: the loop
// reaches it exactly once per run.
const SELF_TEST_BATTERIES = Object.freeze({
  'green fixture passes': 1,
  'missing artefact is RED': 1,
  'hand-edited artefact (hash mismatch) is RED': 1,
  'moved pin is RED': 1,
  'empty components is RED': 1,
  'missing record is RED': 1,
  'a record from the retired npm-install route is RED': 1,
  'pin-declared version agreeing with the record passes': 1,
  'pin-declared version disagreeing with the record is RED': 1,
  'an unreachable objectui checkout is not a version verdict': 1,
  '--require-objectui turns an unreachable checkout RED': 1,
  'a pinned commit with no packages/core/package.json is RED': 1,
  'the producer, run under a TMPDIR behind a symlink, writes a tree this gate passes': 1,
  'no pin: an in-tree record passes': 1,
  'no pin and no in-tree console is RED, naming both': 1,
  'no pin: a pin-mode record (no inTree block) is RED with the in-tree command': 1,
  'no pin: a record from the single-digest layout is RED with the in-tree command': 1,
  'no pin: a record from the per-package layout is RED with the in-tree command': 1,
  'no pin: a hand-edited artefact is RED': 1,
  'no pin: the in-tree producer builds, then writes a tree this gate passes': 1,
  'no pin: a producer run whose artefact did not move leaves the record as it was': 1,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too. This pin is also half of
// the duplicate-label refusal: two rows sharing a label collapse to ONE key in
// the literal above, so the roster falls below this number; the table
// cross-check in the floor block is the other half, and names WHICH label
// collided.
const SELF_TEST_BATTERY_FLOOR = 21;

function selfTest() {
  const mk = (mutate, { pin = 'a'.repeat(40), version = '0.0.0-selftest' } = {}) => {
    const root = mkdtempSync(join(tmpdir(), 'sdui-manifest-check-'));
    // fixture tree: artefact + record + pin, green by construction
    const manifest = { components: { flex: { type: 'flex', inputs: [] } } };
    const raw = JSON.stringify(manifest, null, 2);
    const scriptsDir = join(root, 'scripts');
    mkdirSync(scriptsDir, { recursive: true });
    writeFileSync(join(root, '.objectui-sha'), pin + '\n');
    writeFileSync(join(root, 'sdui.manifest.json'), raw);
    writeFileSync(
      join(scriptsDir, 'sdui-manifest.record.json'),
      JSON.stringify(
        {
          objectuiSha: pin,
          source: RECORD_SOURCE,
          modulesRoot: `.cache/objectui-${pin.slice(0, 12)}/apps/console`,
          objectuiWorkspaceVersion: version,
          sha256: createHash('sha256').update(raw).digest('hex'),
          components: 1,
        },
        null,
        2,
      ),
    );
    mutate?.(root);
    return root;
  };

  /**
   * A throwaway objectui: ONE commit, declaring `version` in
   * `packages/core/package.json` — or, with `omitVersionFile`, declaring
   * nothing, which is the `unsupported` outcome's fixture.
   *
   * A real git repository, not a stub: check 4 resolves the pin through `git
   * cat-file` / `git show`, and a stubbed resolver would leave exactly that
   * resolution unexercised — the half where a missing commit must read
   * `unreachable` rather than "the versions differ".
   */
  const mkObjectui = ({ version = '0.0.0-selftest', omitVersionFile = false } = {}) => {
    const dir = mkdtempSync(join(tmpdir(), 'sdui-manifest-objectui-'));
    const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    execFileSync('git', ['init', '-q', '-b', 'main', dir], { stdio: ['ignore', 'pipe', 'pipe'] });
    if (omitVersionFile) {
      writeFileSync(join(dir, 'README.md'), 'an objectui commit that declares no @object-ui version\n');
    } else {
      mkdirSync(join(dir, 'packages', 'core'), { recursive: true });
      writeFileSync(join(dir, OBJECTUI_VERSION_FILE), JSON.stringify({ name: '@object-ui/core', version }, null, 2));
    }
    git('add', '-A');
    git('-c', 'user.name=selftest', '-c', 'user.email=selftest@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '-m', 'fixture');
    return { dir, sha: git('rev-parse', 'HEAD').trim() };
  };

  // An oracle path that CANNOT resolve: a never-created child of a fresh temp
  // dir. Every row passes its oracle explicitly, so `OBJECTUI_ROOT` in the
  // ambient environment can neither green nor red this self-test.
  const NO_OBJECTUI = join(mkdtempSync(join(tmpdir(), 'sdui-manifest-no-objectui-')), 'objectui');
  const blind = { objectuiRoot: NO_OBJECTUI };

  // Check 4's oracles (#18611). The fixture tree pins the throwaway commit, so
  // the ONLY thing varying across these rows is the version relation itself.
  const agreeing = mkObjectui({ version: '0.0.0-selftest' });
  const disagreeing = mkObjectui({ version: '9.9.9-not-the-recorded-one' });
  const noVersionFile = mkObjectui({ omitVersionFile: true });

  /**
   * The PRODUCER's own output, written under a TMPDIR reached through a
   * symlink (see the header for why that shape).
   *
   * The fixture is a built tree as the producer expects one: a throwaway
   * objectui commit AT the pin under `.cache/objectui-<SHA12>/`, with one stub
   * per `@object-ui/*` name the producer spells, under
   * `apps/console/node_modules/`, and a stub adapter at the parser dist path.
   * Every one of those names is a BARE import issued from the runner, so each
   * resolves only if the hook re-anchors it. A producer whose runner URL is
   * built from the unresolved temp path exits 1 with `Cannot find package`,
   * writes nothing, and the row reads RED (missing artefact) with the
   * producer's stderr printed above it.
   *
   * The stub names are read off the producer's source, not restated here, so
   * a registry module it gains cannot red this row for a stub nobody added.
   */
  const mkProduced = () => {
    const base = mkdtempSync(join(tmpdir(), 'sdui-manifest-producer-'));
    const realTmp = join(base, 'tmp-real');
    const linkTmp = join(base, 'tmp-link');
    mkdirSync(realTmp);
    symlinkSync(realTmp, linkTmp, 'dir');
    const root = join(base, 'repo');
    mkdirSync(join(root, 'scripts'), { recursive: true });
    // Only a fixture while the TMPDIR it hands over is NOT its own realpath:
    // a plain directory here would turn the row into a Linux-default run that
    // passes with or without the fix.
    if (realpathSync(linkTmp) === linkTmp) {
      console.error(`  fixture: ${linkTmp} resolves to itself, so it exercises no symlink — the producer was not run.`);
      return { root, objectuiRoot: NO_OBJECTUI };
    }

    const producerSource = readFileSync(join(DEFAULT_ROOT, PRODUCER), 'utf8');
    copyFileSync(join(DEFAULT_ROOT, PRODUCER), join(root, PRODUCER));
    const parserDist = join(root, 'packages', 'sdui-parser', 'dist');
    mkdirSync(parserDist, { recursive: true });
    writeFileSync(
      join(parserDist, 'index.mjs'),
      'export const manifestFromConfigs = (configs) => ({ components: Object.fromEntries(configs.map((c) => [c.type, { type: c.type, inputs: [] }])) });\n',
    );

    const objectui = mkObjectui({ version: '0.0.0-selftest' });
    const tree = join(root, '.cache', `objectui-${objectui.sha.slice(0, 12)}`);
    mkdirSync(dirname(tree), { recursive: true });
    renameSync(objectui.dir, tree);
    writeFileSync(join(root, '.objectui-sha'), objectui.sha + '\n');
    const names = new Set(['@object-ui/core', ...[...producerSource.matchAll(/'(@object-ui\/[a-z0-9-]+)'/g)].map((m) => m[1])]);
    for (const name of names) {
      const pkg = join(tree, 'apps', 'console', 'node_modules', ...name.split('/'));
      mkdirSync(join(pkg, 'dist'), { recursive: true });
      writeFileSync(
        join(pkg, 'package.json'),
        JSON.stringify({ name, version: '0.0.0-selftest', type: 'module', exports: { '.': { import: './dist/index.js' } } }),
      );
      writeFileSync(
        join(pkg, 'dist', 'index.js'),
        name === '@object-ui/core'
          ? "export const ComponentRegistry = { getPublicConfigs: () => [{ type: 'selftest_flex' }] };\n"
          : 'export {};\n',
      );
    }

    const run = spawnSync(process.execPath, [join(root, PRODUCER)], {
      encoding: 'utf8',
      env: { ...process.env, TMPDIR: linkTmp },
    });
    if (run.status !== 0) {
      console.error(`  the producer under TMPDIR=${linkTmp} (a symlink) exited ${run.status ?? run.signal}:`);
      for (const line of String(run.stderr ?? run.error ?? '').trim().split('\n')) console.error(`    ${line}`);
    }
    return { root, objectuiRoot: tree };
  };
  const produced = mkProduced();

  /**
   * The merged layout (#25712): no pin, an in-tree console, an artefact and
   * the in-tree producer's record. Nothing under `ui/packages/`: this gate
   * reads none of it since #26137.
   */
  const mkInTree = (mutate) => {
    const root = mkdtempSync(join(tmpdir(), 'sdui-manifest-in-tree-'));
    mkdirSync(join(root, UI_CONSOLE), { recursive: true });
    mkdirSync(join(root, 'scripts'), { recursive: true });
    writeFileSync(join(root, READ_PATHS.console), JSON.stringify({ name: '@object-ui/console', private: true }, null, 2));
    const manifest = { components: { flex: { type: 'flex', inputs: [] } } };
    const raw = JSON.stringify(manifest, null, 2);
    writeFileSync(join(root, READ_PATHS.artefact), raw);
    writeFileSync(
      join(root, READ_PATHS.record),
      JSON.stringify(
        {
          source: RECORD_SOURCE,
          sha256: createHash('sha256').update(raw).digest('hex'),
          components: 1,
          inTree: { modulesRoot: UI_CONSOLE, objectuiWorkspaceVersion: '0.0.0-selftest' },
        },
        null,
        2,
      ),
    );
    mutate?.(root);
    return root;
  };
  const editRecord = (root, edit) => {
    const p = join(root, READ_PATHS.record);
    writeFileSync(p, JSON.stringify(edit(JSON.parse(readFileSync(p, 'utf8'))), null, 2));
  };

  /**
   * The PRODUCER's in-tree run (no pin): the real generator, copied into a
   * merged-layout fixture beside a stub adapter and a stub
   * `node_modules/.bin/turbo`. The stub is what writes `@object-ui/core`'s dist
   * into the console, so a producer that skipped its build exits 1 on the
   * missing dist and the row reads RED (missing artefact) with the producer's
   * stderr above it. The stub names are read off the producer's source, as
   * `mkProduced` reads them.
   *
   * With `rerunAfter`, the producer runs a second time after that edit, and
   * the returned `moved` lists each file the producer writes whose bytes the
   * second run changed — the carry row's reading.
   */
  const mkProducedInTree = ({ rerunAfter } = {}) => {
    const root = mkdtempSync(join(tmpdir(), 'sdui-manifest-in-tree-producer-'));
    mkdirSync(join(root, UI_CONSOLE), { recursive: true });
    mkdirSync(join(root, 'scripts'), { recursive: true });
    writeFileSync(join(root, READ_PATHS.console), JSON.stringify({ name: '@object-ui/console', private: true }, null, 2));
    const producerSource = readFileSync(join(DEFAULT_ROOT, PRODUCER), 'utf8');
    copyFileSync(join(DEFAULT_ROOT, PRODUCER), join(root, PRODUCER));
    const parserDist = join(root, 'packages', 'sdui-parser', 'dist');
    mkdirSync(parserDist, { recursive: true });
    writeFileSync(
      join(parserDist, 'index.mjs'),
      'export const manifestFromConfigs = (configs) => ({ components: Object.fromEntries(configs.map((c) => [c.type, { type: c.type, inputs: [] }])) });\n',
    );
    const core = '@object-ui/core';
    const names = new Set([core, ...[...producerSource.matchAll(/'(@object-ui\/[a-z0-9-]+)'/g)].map((m) => m[1])]);
    for (const name of names) {
      const pkg = join(root, UI_CONSOLE, 'node_modules', ...name.split('/'));
      mkdirSync(join(pkg, 'dist'), { recursive: true });
      writeFileSync(
        join(pkg, 'package.json'),
        JSON.stringify({ name, version: '0.0.0-selftest', type: 'module', exports: { '.': { import: './dist/index.js' } } }),
      );
      if (name !== core) writeFileSync(join(pkg, 'dist', 'index.js'), 'export {};\n');
    }
    const coreDist = `${UI_CONSOLE}/node_modules/${core}/dist`;
    mkdirSync(join(root, 'node_modules', '.bin'), { recursive: true });
    writeFileSync(
      join(root, 'node_modules', '.bin', 'turbo'),
      '#!/bin/sh\n' +
        `mkdir -p '${coreDist}' && printf '%s\\n' "export const ComponentRegistry = { getPublicConfigs: () => [{ type: 'selftest_flex' }] };" > '${coreDist}/index.js'\n`,
      { mode: 0o755 },
    );
    const produce = () => {
      const run = spawnSync(process.execPath, [join(root, PRODUCER)], { encoding: 'utf8' });
      if (run.status !== 0) {
        console.error(`  the in-tree producer exited ${run.status ?? run.signal}:`);
        for (const line of String(run.stderr ?? run.error ?? '').trim().split('\n')) console.error(`    ${line}`);
      }
    };
    produce();
    if (!rerunAfter) return { root };
    const written = () =>
      new Map(
        [READ_PATHS.artefact, READ_PATHS.record].map((file) => [file.split(sep).join('/'), existsSync(join(root, file)) ? readFileSync(join(root, file), 'utf8') : null]),
      );
    rerunAfter(root);
    const first = written();
    produce();
    const second = written();
    const moved = [...first.keys()].filter((file) => first.get(file) !== second.get(file)).sort();
    return { root, moved };
  };
  const producedInTree = mkProducedInTree();

  // The carry row: the record describes an ARTEFACT, so a run whose artefact
  // did not move must leave the record as it was, or every ui PR that
  // regenerates rewrites the one shared file and any two of them conflict on
  // it. Between the runs the record is back-dated, as a run on an earlier day
  // left it, and the built `@object-ui/core` moves to another version, as a
  // release of the fixed group moves it: `generatedAt` and the provenance
  // version are carried while the artefact is byte-identical, so a producer
  // that stamps today's date or re-reads the version names the record here.
  const carried = mkProducedInTree({
    rerunAfter: (r) => {
      const p = join(r, READ_PATHS.record);
      writeFileSync(p, JSON.stringify({ ...JSON.parse(readFileSync(p, 'utf8')), generatedAt: '2000-01-01' }, null, 2) + '\n');
      const core = join(r, UI_CONSOLE, 'node_modules', '@object-ui', 'core', 'package.json');
      writeFileSync(core, JSON.stringify({ ...JSON.parse(readFileSync(core, 'utf8')), version: '0.0.1-moved' }));
    },
  });
  const carriedProblems = carried.moved.length === 0
    ? []
    : [`the second producer run, over an artefact that did not move, changed ${JSON.stringify(carried.moved)}.`];

  const cases = [
    ['green fixture passes', mk(), 0, blind],
    ['missing artefact is RED', mk((r) => rmSync(join(r, 'sdui.manifest.json'))), 1, blind],
    ['hand-edited artefact (hash mismatch) is RED', mk((r) => writeFileSync(join(r, 'sdui.manifest.json'), '{"components":{"flex":{"type":"flex"}}}')), 1, blind],
    ['moved pin is RED', mk((r) => writeFileSync(join(r, '.objectui-sha'), 'b'.repeat(40))), 1, blind],
    ['empty components is RED', mk((r) => {
      const raw = JSON.stringify({ components: {} }, null, 2);
      writeFileSync(join(r, 'sdui.manifest.json'), raw);
      const rec = JSON.parse(readFileSync(join(r, 'scripts', 'sdui-manifest.record.json'), 'utf8'));
      rec.sha256 = createHash('sha256').update(raw).digest('hex');
      rec.components = 0;
      writeFileSync(join(r, 'scripts', 'sdui-manifest.record.json'), JSON.stringify(rec));
    }), 1, blind],
    ['missing record is RED', mk((r) => rmSync(join(r, 'scripts', 'sdui-manifest.record.json'))), 1, blind],
    // The re-keying (ruling 丙 on #17735): a record shaped by the retired npm
    // route — `objectuiPackagesVersion`, no `source`, no `modulesRoot` — is not
    // this producer's record under an older name, whatever its hash says.
    ['a record from the retired npm-install route is RED', mk((r) => {
      const p = join(r, 'scripts', 'sdui-manifest.record.json');
      const { source, modulesRoot, objectuiWorkspaceVersion, ...rest } = JSON.parse(readFileSync(p, 'utf8'));
      writeFileSync(p, JSON.stringify({ ...rest, objectuiPackagesVersion: objectuiWorkspaceVersion }, null, 2));
    }), 1, blind],

    // ── Check 4: the version the PIN declares (#18611) ────────────────────
    //
    // The RED row is the one that carries this check: before it existed, a
    // record naming pin C and a version C never declared was green here, and
    // the two rows below it are the controls that keep the red honest — the
    // same disagreeing tree reads GREEN with no oracle (so `unreachable` is not
    // silently scored as a match) and RED under --require-objectui (so the
    // reported gap is one a caller can refuse).
    ['pin-declared version agreeing with the record passes', mk(undefined, { pin: agreeing.sha, version: '0.0.0-selftest' }), 0, { objectuiRoot: agreeing.dir }],
    ['pin-declared version disagreeing with the record is RED', mk(undefined, { pin: disagreeing.sha, version: '0.0.0-selftest' }), 1, { objectuiRoot: disagreeing.dir }],
    ['an unreachable objectui checkout is not a version verdict', mk(undefined, { pin: disagreeing.sha, version: '0.0.0-selftest' }), 0, blind],
    ['--require-objectui turns an unreachable checkout RED', mk(undefined, { pin: disagreeing.sha, version: '0.0.0-selftest' }), 1, { objectuiRoot: NO_OBJECTUI, requireObjectui: true }],
    ['a pinned commit with no packages/core/package.json is RED', mk(undefined, { pin: noVersionFile.sha, version: '0.0.0-selftest' }), 1, { objectuiRoot: noVersionFile.dir }],

    // ── The producer, under a symlinked TMPDIR ────────────────────────────
    //
    // GREEN is the assertion: the generator ran to completion and its artefact
    // and record pass all four checks, check 4 included — `requireObjectui`
    // with the fixture's own objectui as the oracle, so the version leg cannot
    // read `unreachable` and pass by not running.
    ['the producer, run under a TMPDIR behind a symlink, writes a tree this gate passes', produced.root, 0, { objectuiRoot: produced.objectuiRoot, requireObjectui: true }],

    // ── No pin: the in-tree registry (#25712) ──────────────────────────────
    //
    // The fifth column is text every problem of a RED row must carry between
    // them: a red that does not name both missing oracles, or the one command
    // that clears it, is a red its reader cannot act on.
    ['no pin: an in-tree record passes', mkInTree(), 0, blind],
    ['no pin and no in-tree console is RED, naming both', mkInTree((r) => rmSync(join(r, UI_CONSOLE), { recursive: true })), 1, blind, [READ_PATHS.pin, UI_CONSOLE]],
    // The tree the pin deletion lands on before it regenerates: the record is
    // the pin producer's, whole and intact, and still not this mode's.
    ['no pin: a pin-mode record (no inTree block) is RED with the in-tree command', mkInTree((r) => editRecord(r, ({ inTree, ...rest }) => ({
      objectuiSha: 'a'.repeat(40),
      ...rest,
      modulesRoot: `.cache/objectui-${'a'.repeat(12)}/apps/console`,
      objectuiWorkspaceVersion: '0.0.0-selftest',
    }))), 1, blind, ['`inTree`', IN_TREE_REGENERATE]],
    ['no pin: a record from the single-digest layout is RED with the in-tree command', mkInTree((r) => editRecord(r, (rec) => ({
      ...rec,
      inTree: { ...rec.inTree, registryPackages: [], registrySources: 1, registrySourcesSha256: '0'.repeat(64) },
    }))), 1, blind, ['`registrySourcesSha256`', IN_TREE_REGENERATE]],
    // A branch cut before #26137 that regenerated keeps writing the field that
    // named the per-package records; its record is that layout's claim, RED.
    ['no pin: a record from the per-package layout is RED with the in-tree command', mkInTree((r) => editRecord(r, (rec) => ({
      ...rec,
      inTree: { ...rec.inTree, registryRecords: 'scripts/sdui-manifest.sources' },
    }))), 1, blind, ['`registryRecords`', IN_TREE_REGENERATE]],
    ['no pin: a hand-edited artefact is RED', mkInTree((r) => writeFileSync(join(r, READ_PATHS.artefact), '{"components":{"flex":{"type":"flex"}}}')), 1, blind, [IN_TREE_REGENERATE]],
    ['no pin: the in-tree producer builds, then writes a tree this gate passes', producedInTree.root, 0, blind],
    ['no pin: a producer run whose artefact did not move leaves the record as it was', carried.root, 0, { ...blind, extra: carriedProblems }],
  ];

  // The ledger this self-test's floor is evaluated against (#13489).
  const batterySeen = new Map();
  const registerCase = (name) => {
    batterySeen.set(name, (batterySeen.get(name) ?? 0) + 1);
  };

  let failures = 0;
  for (const [name, root, want, { extra = [], ...options } = {}, mustName = []] of cases) {
    registerCase(name);
    const problems = [...checkTree(root, options), ...extra];
    const got = problems.length ? 1 : 0;
    const unnamed = got ? mustName.filter((text) => !problems.join('\n').includes(text)) : [];
    if (got !== want || unnamed.length > 0) {
      failures++;
      console.error(
        got !== want
          ? `✗ self-test: ${name} — expected ${want ? 'RED' : 'GREEN'}, got ${got ? 'RED' : 'GREEN'}`
          : `✗ self-test: ${name} — RED, but no problem names ${unnamed.map((text) => JSON.stringify(text)).join(', ')}`,
      );
      for (const p of problems) console.error(`    ${p}`);
    }
  }
  // ── The dispatch-gates population declaration ──────────────────────────
  // Filed outside the cases table, deliberately: each table ROW is a declared
  // battery here, so an assertion added as a row would owe a roster entry for a
  // case that gates nothing about `checkTree`'s verdicts.
  const declFail = (message) => { console.error(`✗ self-test: ${message}`); failures++; };
  const readPosix = Object.values(READ_PATHS).map((f) => f.split(sep).join('/'));
  const declared = ROOT_WATCH_HINTS.map((h) => h.replace(/\/\*+$/, ''));
  if (!readPosix.every((f) => declared.includes(f))) {
    declFail('a file checkTree reads is not declared for dispatch-gates — an unreadable literal is how '
      + 'this gate came to declare nothing at all, and it scores `undetermined` for every card again.');
  }
  if (!declared.every((h) => readPosix.includes(h))) {
    declFail('ROOT_WATCH_HINTS declares a path this gate does not read — a declaration that has drifted '
      + 'from the reads replaces a silent gate with a lying one.');
  }
  if (!ROOT_WATCH_HINTS.filter((h) => !h.replace(/\/\*+$/, '').includes('/')).every((h) => h.endsWith('/**'))) {
    declFail('a repo-ROOT file is declared without the subtree suffix — a bare single-segment literal is '
      + 'refused by hintCovers as too generic, so it would contribute no hint at all.');
  }

  // ── The floor: every declared row RAN, and ran its case (#13489) ───────
  //
  // Evaluated after every row has had its chance and BEFORE the verdict, so the
  // success line below can only be printed by a run in which the set of rows
  // that registered EQUALS the set declared. A set difference names WHICH row
  // stopped; a count says only that something did.
  const floorFailure = (message) => {
    console.error(`✗ self-test floor: ${message}`);
    failures++;
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
  const rowLabels = cases.map(([name]) => name);
  const duplicated = [...new Set(rowLabels.filter((name, i) => rowLabels.indexOf(name) !== i))];
  if (duplicated.length > 0) {
    floorBreached = true;
    floorFailure(
      `the cases table uses ${duplicated.map((n) => JSON.stringify(n)).join(', ')} as a row label more than once — ` +
        'two rows sharing a label are ONE battery, so the second can stop running while the first keeps the floor met.',
    );
  }
  for (const [name, count] of batterySeen) {
    if (declaredBatteries.includes(name)) continue;
    floorBreached = true;
    floorFailure(
      `self-test battery "${name}" registered ${count} case(s) but is not declared in ` +
        'SELF_TEST_BATTERIES — a case attributed to no declared battery is one nothing floors.',
    );
  }
  for (const name of declaredBatteries) {
    const count = batterySeen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floorBreached = true;
    floorFailure(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. ` +
          'The verdict below would have claimed that case holds.'
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of ` +
          `${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }
  if (floorBreached) {
    floorFailure(
      'A battery at or below its floor means cases STOPPED RUNNING — the battery is the bug, not the ' +
        'number. Find what stopped registering (a deleted row, a renamed label, a loop that no longer ' +
        'reaches it) and restore it.',
    );
  }

  if (failures) {
    console.error(`✗ check-sdui-manifest self-test: ${failures} failure(s) (cases and floor).`);
    process.exit(1);
  }
  console.log(
    `✓ check-sdui-manifest self-test: ${cases.length} cases behave (green passes; absence, tamper, moved pin, emptiness, a retired-route record, ` +
      'a version the pin does not declare, and an oracle that cannot answer are RED; an absent oracle is reported, not scored; ' +
      'the producer, run under a symlinked TMPDIR, writes a tree that passes; with no pin, an in-tree record passes, a pin-mode ' +
      'record, a record from either retired freshness layout and a hand-edited artefact are RED with the in-tree command, no pin ' +
      'and no console is RED naming both, and the in-tree producer builds, writes a tree that passes, and leaves the record as ' +
      'it was when the artefact did not move).',
  );

  return SELF_TEST_VERDICT;
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    if (selfTest() !== SELF_TEST_VERDICT) {
        console.error(
            '\n✗ check-sdui-manifest self-test: selfTest() returned without reaching its verdict,\n'
                + 'so no success line was printed. Exiting 0 here would report a self-test\n'
                + 'that never finished as a self-test that passed.\n',
        );
        process.exit(1);
    }
  } else {
    let versionLeg;
    const problems = checkTree(DEFAULT_ROOT, {
      requireObjectui: process.argv.includes('--require-objectui'),
      onVersionLeg: (leg) => { versionLeg = leg; },
    });
    if (problems.length) {
      console.error('✗ check-sdui-manifest:');
      for (const p of problems) console.error(`  ${p}`);
      process.exit(1);
    }
    const record = JSON.parse(readFileSync(join(DEFAULT_ROOT, 'scripts', 'sdui-manifest.record.json'), 'utf8'));
    if (!existsSync(join(DEFAULT_ROOT, READ_PATHS.pin))) {
      // No pin: checkTree ran the in-tree leg, which has no check 3 or 4 to report.
      const { inTree } = record;
      let declared = 'unreadable';
      try {
        declared = JSON.stringify(JSON.parse(readFileSync(join(DEFAULT_ROOT, UI_PACKAGES, 'core', 'package.json'), 'utf8')).version);
      } catch {
        // display only — the verdict above did not read it
      }
      console.log(
        `✓ check-sdui-manifest: sdui.manifest.json is present and intact (sha256 ${String(record.sha256).slice(0, 12)}…, ` +
          `${record.components} components), recorded by the in-tree producer from ${inTree.modulesRoot} (no .objectui-sha in this tree).`,
      );
      console.log(
        "  Not judged here: whether it is the manifest this tree generates. ci.yml's Build & E2E UI step regenerates it and " +
          'compares the bytes (#26137).',
      );
      console.log(
        `  Provenance, not a verdict: the generator read @object-ui/core ${JSON.stringify(inTree.objectuiWorkspaceVersion)}; ` +
          `${UI_PACKAGES}/core declares ${declared} now — a release of the fixed group moves that without moving the registry.`,
      );
    } else {
      console.log(
        `✓ check-sdui-manifest: sdui.manifest.json is present, intact (sha256 ${String(record.sha256).slice(0, 12)}…, ` +
          `${record.components} components) and recorded at the live objectui pin ${String(record.objectuiSha).slice(0, 12)}….`,
      );
      // The claim is only ever as wide as the leg that ran (#18611): a run without
      // an objectui checkout says so, in the same breath, rather than letting the
      // line above be read as "fresh at the pin" in every sense.
      if (versionLeg?.status === 'resolved') {
        console.log(
          `  @object-ui ${record.objectuiWorkspaceVersion} is the version objectui ${String(record.objectuiSha).slice(0, 12)}… declares ` +
            `in ${OBJECTUI_VERSION_FILE} (read from ${versionLeg.where}).`,
        );
      } else {
        console.log(
          `  NOT CHECKED — objectuiWorkspaceVersion ${JSON.stringify(record.objectuiWorkspaceVersion)} was not compared with what the pin declares: ` +
            `${versionLeg?.reason ?? 'the version leg did not run.'}\n` +
            '  Re-run with an objectui checkout (OBJECTUI_ROOT=… or a ../objectui sibling); add --require-objectui to make this gap an exit 1.',
        );
      }
    }
  }
}
