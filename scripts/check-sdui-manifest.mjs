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
 *      — the same moment `check-sdui-lockstep` already forces a parser parity
 *      re-verification, and the moment an objectui checkout is guaranteed to
 *      exist (the bump required one).
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
 *   3.   STALENESS is a SOURCE DIGEST PER PACKAGE (#26051) —
 *        `registrySourceDigests` reads each registry package's `src/` as the
 *        index holds them, and each package's digest must equal its own
 *        one-line record under `scripts/sdui-manifest.sources/`, which also
 *        names the artefact sha256 it was verified against. A registry source
 *        edit without regeneration reds HERE naming the package, and so does a
 *        package the registry reaches with no record (a new package or a new
 *        dependency edge), a record the registry no longer reaches (a removed
 *        package or edge), and a record verified against another artefact.
 *        Each red prints the one command that clears it: the generator, which
 *        builds the registry from this tree, regenerates, and re-records only
 *        what moved. Nothing is built in this gate — the digest is a
 *        `git ls-files` over the index, with no dist and no node_modules read.
 *
 *        Why one file per package, one line per file: with one digest over
 *        the whole registry, any two ui PRs that touched registry packages
 *        conflicted on that line in the merge queue. Now two PRs on different
 *        packages touch different files. Two PRs on one package touch the same
 *        line, and so does a PR that moves the artefact (it re-records every
 *        package against the new sha256): those still conflict, on purpose,
 *        because only a regeneration on the merged tree can say what the
 *        manifest of the combination is. What is NOT forced is the case where
 *        two PRs on different packages each leave the artefact unchanged and
 *        their combination would not; the next regeneration of any registry
 *        package sees the combination.
 *   4.   none. The in-tree `@object-ui/core` version moves with every release
 *        of the one fixed version group while the registry does not, so the
 *        record carries it as provenance and the success line prints it.
 *
 * No pin AND no in-tree console is RED, naming both: a tree with neither has
 * nothing to be fresh against, which is a broken tree, not a skip.
 *
 * ## What this deliberately does NOT do, and where that risk is held
 *
 * No per-PR regeneration: that would put an objectui clone and build (network,
 * minutes) inside a required lint job — the shape `check-sdui-lockstep`'s
 * header declines, for the same reasons. Under an unchanged pin the pinned
 * commit's registry is immutable, so content drift per-PR is not a live axis.
 * The residual axis — this repo's OWN adapter (`manifestFromConfigs`) changing
 * while the pin stands still — is held by `packages/sdui-parser`'s lockstep
 * gate and unit suite, and by regeneration being byte-deterministic (two runs
 * over one built tree, identical bytes), so the remedy this gate prints always
 * converges.
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
  readdirSync,
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

import { gitFreeEnv } from './git-env.mjs';
import { isEntrypoint } from './invoked-as.mjs';

const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The directory objectui's tree is imported under (#25677), as a bare segment. */
const UI_TREE = 'ui';

/** The in-tree console the generator reads when the tree has no pin (#25712). */
const UI_CONSOLE = 'ui/apps/console';

/** Where the `@object-ui/*` workspace packages live in the merged layout. */
const UI_PACKAGES = 'ui/packages';

/**
 * Where the in-tree producer writes one record per registry package (#26051),
 * repo-relative and POSIX-separated: this string is also what the record's
 * `inTree.registryRecords` says.
 */
export const REGISTRY_RECORDS = 'scripts/sdui-manifest.sources';

/**
 * What `checkTree` reads, repo-relative: three files with a pin; without one,
 * the same artefact and record plus the in-tree console's manifest (presence),
 * the registry packages (the digests) and their per-package records.
 */
const READ_PATHS = {
  artefact: 'sdui.manifest.json',
  record: join('scripts', 'sdui-manifest.record.json'),
  pin: '.objectui-sha',
  console: join(UI_CONSOLE, 'package.json'),
  packages: UI_PACKAGES,
  sources: join(...REGISTRY_RECORDS.split('/')),
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
const IN_TREE_FIELDS = ['modulesRoot', 'objectuiWorkspaceVersion', 'registryRecords'];

/**
 * The single-digest layout's `inTree` fields, retired by #26051: one digest
 * over every registry package, which every ui PR that touched one re-recorded.
 * A record still carrying them is RED, never read as the same claim.
 */
const RETIRED_IN_TREE_FIELDS = ['registryPackages', 'registrySources', 'registrySourcesSha256'];

/** The one command that clears each mode's freshness reds. */
const PIN_REGENERATE = 'pnpm objectui:build && node scripts/gen-sdui-manifest-node.mjs';
const IN_TREE_REGENERATE = 'node scripts/gen-sdui-manifest-node.mjs';

/** The registry the generator enumerates, besides `@object-ui/core` itself — its `REGISTRY_MODULES`, in its order. */
const REGISTRY_CORE = '@object-ui/core';
export const REGISTRY_MODULES = Object.freeze([
  '@object-ui/components',
  '@object-ui/plugin-grid',
  '@object-ui/plugin-form',
  '@object-ui/plugin-view',
  '@object-ui/plugin-list',
  '@object-ui/plugin-detail',
  '@object-ui/plugin-dashboard',
  '@object-ui/plugin-charts',
  '@object-ui/plugin-kanban',
  '@object-ui/plugin-calendar',
  '@object-ui/plugin-gantt',
  '@object-ui/plugin-timeline',
  '@object-ui/plugin-map',
  '@object-ui/plugin-markdown',
  '@object-ui/plugin-report',
  '@object-ui/plugin-tree',
]);

/**
 * The one producer, repo-relative. Read by the SELF-TEST only — copied into a
 * fixture tree and run there (see the header) — never by `checkTree`, so it is
 * not a `READ_PATHS` entry. Spelled as one literal at module scope so that
 * `scripts/pm/dispatch-gates.mjs` derives this gate for an edit to the producer.
 */
const PRODUCER = 'scripts/gen-sdui-manifest-node.mjs';

/** The repo helpers the producer (and this gate, which it imports in-tree) import: copied beside it in the self-test's fixtures. */
const PRODUCER_IMPORTS = ['scripts/git-env.mjs', 'scripts/invoked-as.mjs'];

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
 * Without a pin it also reads the in-tree console's manifest and the registry
 * packages under `ui/packages/` (#25712) — the subtree the digest walks, so a
 * UI package edit derives this gate; on a tree with no `ui/` both hints match
 * nothing and only display. The per-package records (#26051) are a directory,
 * declared with the subtree suffix.
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
  'ui/packages/**',
  'scripts/sdui-manifest.sources/**',
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
 * above, keyed to the in-tree producer's record; check 3 becomes each registry
 * package's source digest against its own record under `REGISTRY_RECORDS`
 * (#26051). There is no check 4 here: the in-tree `@object-ui/core` version
 * moves with every release of the fixed group while the registry does not, so
 * the record carries it as provenance and the success line prints both. No pin
 * and no in-tree console is RED, naming both.
 */
function checkTreeWithoutPin(root) {
  const problems = [];
  if (!existsSync(join(root, UI_CONSOLE, 'package.json'))) {
    problems.push(
      `.objectui-sha is MISSING and there is no in-tree console (${UI_CONSOLE}) either — no oracle to judge freshness\n` +
        '  against. With the pin, the manifest is held to objectui\'s build at that commit; without it, to the\n' +
        `  registry sources under ${UI_TREE}/. A tree with neither cannot be called fresh.`,
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
      `record \`inTree\` still carries ${retired.map((field) => `\`${field}\``).join(', ')} — the retired single-digest layout. Each\n` +
        `  registry package now has its own record under ${REGISTRY_RECORDS}/, so ui PRs that touch different packages\n` +
        '  do not conflict on one shared line.',
    );
  }
  if (!missing.includes('modulesRoot') && inTree.modulesRoot !== UI_CONSOLE) {
    shape.push(`record \`inTree.modulesRoot\` is ${JSON.stringify(inTree.modulesRoot)}, not ${JSON.stringify(UI_CONSOLE)} — the in-tree producer reads only that.`);
  }
  if (!missing.includes('registryRecords') && inTree.registryRecords !== REGISTRY_RECORDS) {
    shape.push(`record \`inTree.registryRecords\` is ${JSON.stringify(inTree.registryRecords)}, not ${JSON.stringify(REGISTRY_RECORDS)} — the in-tree producer writes only there.`);
  }
  if (shape.length > 0) {
    problems.push(...shape, `  Regenerate in-tree — one command builds what the generator reads and re-records:\n    ${IN_TREE_REGENERATE}`);
    return problems;
  }

  const now = registrySourceDigests(root);
  if (now.problem) {
    problems.push(`cannot digest the registry sources under ${UI_TREE}/: ${now.problem}`);
    return problems;
  }
  const recorded = readRegistryRecords(root);
  if (recorded.problem) {
    problems.push(`${recorded.problem}\n  Regenerate in-tree — one command builds what the generator reads and re-records:\n    ${IN_TREE_REGENERATE}`);
    return problems;
  }
  problems.push(...recorded.malformed);

  const stale = [];
  const unrecorded = [];
  const otherArtefact = [];
  for (const pkg of now.packages) {
    const was = recorded.records.get(pkg.dir);
    if (!was) unrecorded.push(pkg);
    else if (was.sha256 !== pkg.sha256 || was.sources !== pkg.files) stale.push({ pkg, was });
    else if (was.manifestSha256 !== record.sha256) otherArtefact.push({ pkg, was });
  }
  const reached = new Set(now.packages.map(({ dir }) => dir));
  const unreached = [...recorded.records.keys()].filter((dir) => !reached.has(dir));

  if (stale.length > 0) {
    problems.push(
      `registry sources under ${UI_TREE}/ have changed since sdui.manifest.json was generated, in ${stale.length} package(s):\n` +
        stale
          .map(({ pkg, was }) => `    ${pkg.dir}: now ${pkg.files} file(s) sha256 ${pkg.sha256.slice(0, 12)}…, recorded ${was.sources} file(s) sha256 ${String(was.sha256).slice(0, 12)}…`)
          .join('\n') +
        '\n  A registry change can change which components and inputs the shipped console declares, so the manifest\n' +
        '  must follow it (同步一次就烂).',
    );
  }
  if (unrecorded.length > 0) {
    problems.push(
      `the registry reaches ${unrecorded.length} package(s) with no record under ${REGISTRY_RECORDS}/ — a new package, a new\n` +
        '  dependency edge into the registry, or a deleted record:\n' +
        unrecorded.map((pkg) => `    ${pkg.dir} (${pkg.files} source file(s))`).join('\n'),
    );
  }
  if (unreached.length > 0) {
    problems.push(
      `${unreached.length} record(s) under ${REGISTRY_RECORDS}/ name a package the registry no longer reaches — a removed\n` +
        '  package or a dropped dependency edge:\n' +
        unreached.map((dir) => `    ${registryRecordPath(dir)} (${dir})`).join('\n'),
    );
  }
  if (otherArtefact.length > 0) {
    problems.push(
      `${otherArtefact.length} package record(s) were verified against a different sdui.manifest.json than the committed one\n` +
        `  (sha256 ${String(record.sha256).slice(0, 12)}…):\n` +
        otherArtefact.map(({ pkg, was }) => `    ${pkg.dir}: verified against ${String(was.manifestSha256).slice(0, 12)}…`).join('\n') +
        '\n  Two branches regenerated on different bases, and no run has seen their combination.',
    );
  }
  if (stale.length + unrecorded.length + unreached.length + otherArtefact.length + recorded.malformed.length > 0) {
    problems.push(
      '  One command builds what the generator reads, regenerates, and re-records only the packages that moved:\n' +
        `    ${IN_TREE_REGENERATE}`,
    );
  }
  return problems;
}

/** Paths under a registry package's `src/` that never reach its build: tests and their mocks. */
const TEST_SOURCE = /(^|\/)(__tests__|__mocks__)\/|\.(test|spec)\.[cm]?[jt]sx?$/;

/**
 * The in-tree freshness oracle: one sha256 PER REGISTRY PACKAGE over its
 * sources as git has them (#26051). Which packages: every `@object-ui/*`
 * workspace package under `ui/packages/` that `@object-ui/core` and the
 * generator's `REGISTRY_MODULES` reach through `dependencies`,
 * `peerDependencies` or `optionalDependencies` naming another member. Which
 * files: each one's own `src/`, tests excluded (`TEST_SOURCE`) — never its
 * dependencies': an edit anywhere in the reached set still moves exactly one
 * package's digest, so detection is the same as one digest over the whole set,
 * and an edit to a low-level package (`core`, `types`, `react`) moves one
 * record rather than every dependent's. Which bytes: the INDEX — `git ls-files
 * -s` gives the path-sorted list and each file's blob id, so the reading is the
 * committed content, never a working-tree edit, an untracked file or a build
 * output.
 *
 * `{ packages: [{ dir, files, sha256 }] }` in `dir` order, or `{ problem }`
 * naming what could not be read — a registry module that is not a package
 * here, an unreadable manifest, a failed listing, or a reached package with no
 * source (zero sources is a broken read, not a fresh one).
 */
export function registrySourceDigests(root) {
  const base = join(root, UI_PACKAGES);
  if (!existsSync(base)) return { problem: `${UI_PACKAGES}/ does not exist` };
  const byName = new Map();
  for (const dir of readdirSync(base).sort()) {
    const manifestPath = join(base, dir, 'package.json');
    if (!existsSync(manifestPath)) continue;
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch (e) {
      return { problem: `${UI_PACKAGES}/${dir}/package.json does not parse: ${e.message}` };
    }
    if (typeof manifest?.name === 'string') byName.set(manifest.name, { dir: `${UI_PACKAGES}/${dir}`, manifest });
  }

  const seeds = [REGISTRY_CORE, ...REGISTRY_MODULES];
  const missing = seeds.filter((name) => !byName.has(name));
  if (missing.length > 0) return { problem: `registry module(s) ${missing.join(', ')} are not packages under ${UI_PACKAGES}/` };
  const reached = new Set();
  const queue = [...seeds];
  while (queue.length > 0) {
    const name = queue.shift();
    if (reached.has(name)) continue;
    reached.add(name);
    const { manifest } = byName.get(name);
    for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const dep of Object.keys(manifest[field] ?? {})) if (byName.has(dep)) queue.push(dep);
    }
  }
  const dirs = [...reached].map((name) => byName.get(name).dir).sort();

  let listing;
  try {
    listing = execFileSync('git', ['-C', root, 'ls-files', '-s', '-z', '--', ...dirs.map((dir) => `${dir}/src`)], {
      // #16644: `-C root` alone names the index read — the self-test hands this
      // mkdtemp fixtures, and an inherited GIT_DIR / GIT_INDEX_FILE outranks it.
      env: gitFreeEnv(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (e) {
    return { problem: `git ls-files over ${dirs.length} package src/ trees failed: ${String(e?.stderr || e?.message || e).trim().split('\n')[0]}` };
  }
  const entries = listing
    .split('\0')
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf('\t');
      return { path: line.slice(tab + 1), blob: line.slice(0, tab).split(' ')[1] };
    })
    .filter(({ path }) => !TEST_SOURCE.test(path));
  const packages = [];
  for (const dir of dirs) {
    const own = entries.filter(({ path }) => path.startsWith(`${dir}/src/`));
    if (own.length === 0) {
      return { problem: `git lists no source under ${dir}/src — zero sources is a broken read, not a fresh one` };
    }
    const hash = createHash('sha256');
    for (const { path, blob } of own) hash.update(`${blob} ${path}\n`);
    packages.push({ dir, files: own.length, sha256: hash.digest('hex') });
  }
  return { packages };
}

/** A package's record file, repo-relative: its directory's basename under `REGISTRY_RECORDS`. */
export function registryRecordPath(dir) {
  return `${REGISTRY_RECORDS}/${dir.slice(dir.lastIndexOf('/') + 1)}.json`;
}

/**
 * The one form a package record takes: ONE line of JSON, keys in this order,
 * plus a newline. One line is the point — two branches that re-record the same
 * package differently always touch the same line, so git reports a conflict
 * instead of merging a digest from one side with an artefact sha256 from the
 * other.
 */
export function registryRecordLine({ dir, files, sha256 }, manifestSha256) {
  return `${JSON.stringify({ package: dir, sources: files, sha256, manifestSha256 })}\n`;
}

/**
 * Read every record under `REGISTRY_RECORDS`. `{ problem }` when the directory
 * is absent; otherwise `{ records, malformed }` — `records` maps a package dir
 * to its parsed record, `malformed` lists each entry that is not one package
 * record in the producer's one-line form (it is left out of `records`, so its
 * package also reads as unrecorded).
 */
export function readRegistryRecords(root) {
  const dir = join(root, ...REGISTRY_RECORDS.split('/'));
  if (!existsSync(dir)) {
    return { problem: `${REGISTRY_RECORDS}/ is MISSING — no registry package has a record, so no source can be judged fresh.` };
  }
  const records = new Map();
  const malformed = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const where = `${REGISTRY_RECORDS}/${entry.name}`;
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      malformed.push(`${where} is not a package record (only one .json file per registry package lives there).`);
      continue;
    }
    const raw = readFileSync(join(dir, entry.name), 'utf8');
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      malformed.push(`${where} does not parse: ${e.message}`);
      continue;
    }
    const pkgDir = `${UI_PACKAGES}/${entry.name.slice(0, -'.json'.length)}`;
    if (
      parsed?.package !== pkgDir
      || !Number.isInteger(parsed.sources)
      || typeof parsed.sha256 !== 'string'
      || typeof parsed.manifestSha256 !== 'string'
      || raw !== registryRecordLine({ dir: pkgDir, files: parsed.sources, sha256: parsed.sha256 }, parsed.manifestSha256)
    ) {
      malformed.push(
        `${where} is not ${pkgDir}'s record in the producer's one-line form ({"package","sources","sha256","manifestSha256"}).`,
      );
      continue;
    }
    records.set(pkgDir, parsed);
  }
  return { records, malformed };
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
  'no pin: an in-tree record over unchanged registry sources passes': 1,
  'no pin and no in-tree console is RED, naming both': 1,
  'no pin: a pin-mode record (no inTree block) is RED with the in-tree command': 1,
  'no pin: a staged edit to one registry package is RED naming that package alone': 1,
  'no pin: an edit the index does not hold is not a registry change': 1,
  'no pin: a test file or a package the registry does not reach is not a registry change': 1,
  'no pin: a new workspace edge into the registry is RED': 1,
  'no pin: a new package the registry reaches is RED naming it': 1,
  'no pin: a removed registry package is RED naming its record': 1,
  'no pin: a deleted package record is RED naming the package': 1,
  'no pin: a package record verified against another artefact is RED': 1,
  'no pin: a package record out of its one-line form is RED': 1,
  'no pin: a record from the single-digest layout is RED with the in-tree command': 1,
  'no pin: a hand-edited artefact is RED': 1,
  'no pin: the in-tree producer builds, then writes a tree this gate passes': 1,
  'no pin: the producer re-records only the package whose sources moved': 1,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too. This pin is also half of
// the duplicate-label refusal: two rows sharing a label collapse to ONE key in
// the literal above, so the roster falls below this number; the table
// cross-check in the floor block is the other half, and names WHICH label
// collided.
const SELF_TEST_BATTERY_FLOOR = 29;

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
    for (const file of [PRODUCER, ...PRODUCER_IMPORTS]) copyFileSync(join(DEFAULT_ROOT, file), join(root, file));
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
   * The merged layout (#25712): no pin, an in-tree console, and one package
   * per registry name under `ui/packages/`, each with one source — plus
   * `@object-ui/types`, which `@object-ui/core` reaches through a dependency
   * (so the closure, not only the seed list, is under test), and
   * `@object-ui/unrelated`, which nothing reaches. A real git repository: the
   * digest reads the INDEX, so a stub would leave exactly that reading
   * unexercised. Every git child here runs with `gitFreeEnv()` (#16644).
   */
  const UI_FIXTURE_NAMES = [REGISTRY_CORE, ...REGISTRY_MODULES, '@object-ui/types', '@object-ui/unrelated'];
  const pkgDir = (name) => join(UI_PACKAGES, name.slice('@object-ui/'.length));
  const gitIn = (root) => (...args) =>
    execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: gitFreeEnv() });
  const mkUiSources = (prefix) => {
    const root = mkdtempSync(join(tmpdir(), prefix));
    const git = gitIn(root);
    git('init', '-q');
    writeFileSync(join(root, '.gitignore'), 'node_modules/\n');
    mkdirSync(join(root, UI_CONSOLE), { recursive: true });
    writeFileSync(join(root, READ_PATHS.console), JSON.stringify({ name: '@object-ui/console', private: true }, null, 2));
    for (const name of UI_FIXTURE_NAMES) {
      const dir = join(root, pkgDir(name));
      mkdirSync(join(dir, 'src'), { recursive: true });
      const dependencies = name === REGISTRY_CORE ? { '@object-ui/types': 'workspace:*' } : {};
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: '0.0.0-selftest', dependencies }, null, 2));
      writeFileSync(join(dir, 'src', 'index.ts'), `export const id = ${JSON.stringify(name)};\n`);
    }
    git('add', '-A');
    return { root, git };
  };
  const mkInTree = (mutate) => {
    const { root, git } = mkUiSources('sdui-manifest-in-tree-');
    const manifest = { components: { flex: { type: 'flex', inputs: [] } } };
    const raw = JSON.stringify(manifest, null, 2);
    mkdirSync(join(root, READ_PATHS.sources), { recursive: true });
    writeFileSync(join(root, READ_PATHS.artefact), raw);
    const sha256 = createHash('sha256').update(raw).digest('hex');
    for (const pkg of registrySourceDigests(root).packages) {
      writeFileSync(join(root, registryRecordPath(pkg.dir)), registryRecordLine(pkg, sha256));
    }
    writeFileSync(
      join(root, READ_PATHS.record),
      JSON.stringify(
        {
          source: RECORD_SOURCE,
          sha256,
          components: 1,
          inTree: { modulesRoot: UI_CONSOLE, objectuiWorkspaceVersion: '0.0.0-selftest', registryRecords: REGISTRY_RECORDS },
        },
        null,
        2,
      ),
    );
    mutate?.(root, git);
    return root;
  };
  const editRecord = (root, edit) => {
    const p = join(root, READ_PATHS.record);
    writeFileSync(p, JSON.stringify(edit(JSON.parse(readFileSync(p, 'utf8'))), null, 2));
  };
  const packageRecord = (root, name) => join(root, registryRecordPath(pkgDir(name).split(sep).join('/')));

  /**
   * The PRODUCER's in-tree run (no pin): the real generator, this gate and the
   * two helpers they import, copied into the merged-layout fixture beside a
   * stub adapter and a stub `node_modules/.bin/turbo`. The stub is what writes
   * `@object-ui/core`'s dist into the console, so a producer that skipped its
   * build exits 1 on the missing dist and the row reads RED (missing artefact)
   * with the producer's stderr above it.
   *
   * With `rerunAfter`, the producer runs a second time after that edit, and
   * the returned `moved` lists every path under `scripts/` whose bytes the
   * second run changed — the re-record row's reading.
   */
  const mkProducedInTree = ({ rerunAfter } = {}) => {
    const { root, git } = mkUiSources('sdui-manifest-in-tree-producer-');
    mkdirSync(join(root, 'scripts'), { recursive: true });
    for (const file of [PRODUCER, 'scripts/check-sdui-manifest.mjs', ...PRODUCER_IMPORTS]) {
      copyFileSync(join(DEFAULT_ROOT, file), join(root, file));
    }
    const parserDist = join(root, 'packages', 'sdui-parser', 'dist');
    mkdirSync(parserDist, { recursive: true });
    writeFileSync(
      join(parserDist, 'index.mjs'),
      'export const manifestFromConfigs = (configs) => ({ components: Object.fromEntries(configs.map((c) => [c.type, { type: c.type, inputs: [] }])) });\n',
    );
    for (const name of [REGISTRY_CORE, ...REGISTRY_MODULES]) {
      const pkg = join(root, UI_CONSOLE, 'node_modules', ...name.split('/'));
      mkdirSync(join(pkg, 'dist'), { recursive: true });
      writeFileSync(
        join(pkg, 'package.json'),
        JSON.stringify({ name, version: '0.0.0-selftest', type: 'module', exports: { '.': { import: './dist/index.js' } } }),
      );
      if (name !== REGISTRY_CORE) writeFileSync(join(pkg, 'dist', 'index.js'), 'export {};\n');
    }
    const coreDist = `${UI_CONSOLE}/node_modules/${REGISTRY_CORE}/dist`;
    mkdirSync(join(root, 'node_modules', '.bin'), { recursive: true });
    writeFileSync(
      join(root, 'node_modules', '.bin', 'turbo'),
      '#!/bin/sh\n' +
        `mkdir -p '${coreDist}' && printf '%s\\n' "export const ComponentRegistry = { getPublicConfigs: () => [{ type: 'selftest_flex' }] };" > '${coreDist}/index.js'\n`,
      { mode: 0o755 },
    );
    const produce = () => {
      const run = spawnSync(process.execPath, [join(root, PRODUCER)], { encoding: 'utf8', env: gitFreeEnv() });
      if (run.status !== 0) {
        console.error(`  the in-tree producer exited ${run.status ?? run.signal}:`);
        for (const line of String(run.stderr ?? run.error ?? '').trim().split('\n')) console.error(`    ${line}`);
      }
    };
    produce();
    if (!rerunAfter) return { root };
    const written = () => {
      const files = [READ_PATHS.artefact, READ_PATHS.record];
      if (existsSync(join(root, READ_PATHS.sources))) {
        for (const name of readdirSync(join(root, READ_PATHS.sources)).sort()) files.push(join(READ_PATHS.sources, name));
      }
      return new Map(files.map((file) => [file.split(sep).join('/'), existsSync(join(root, file)) ? readFileSync(join(root, file), 'utf8') : null]));
    };
    const first = written();
    rerunAfter(root, git);
    produce();
    const second = written();
    const moved = [...new Set([...first.keys(), ...second.keys()])].filter((file) => first.get(file) !== second.get(file)).sort();
    return { root, moved };
  };
  const producedInTree = mkProducedInTree();

  // The re-record row (#26051): one registry package's source moves and the
  // artefact does not, so the second run must rewrite that package's record
  // and nothing else — no other package record, not the shared header (its
  // `generatedAt` is carried while the artefact is byte-identical), not the
  // artefact. A producer that rewrites every record, or stamps a fresh date,
  // names the extra path here; one that skips the moved package names that.
  const rerecorded = mkProducedInTree({
    rerunAfter: (r, git) => {
      writeFileSync(join(r, pkgDir('@object-ui/plugin-grid'), 'src', 'index.ts'), 'export const id = "moved";\n');
      git('add', '-A');
    },
  });
  const rerecordedWant = [`${REGISTRY_RECORDS}/plugin-grid.json`];
  const rerecordedProblems = JSON.stringify(rerecorded.moved) === JSON.stringify(rerecordedWant)
    ? []
    : [`the second producer run changed ${JSON.stringify(rerecorded.moved)}, not exactly ${JSON.stringify(rerecordedWant)}.`];

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
    ['no pin: an in-tree record over unchanged registry sources passes', mkInTree(), 0, blind],
    ['no pin and no in-tree console is RED, naming both', mkInTree((r) => rmSync(join(r, UI_CONSOLE), { recursive: true })), 1, blind, [READ_PATHS.pin, UI_CONSOLE]],
    // The tree the pin deletion lands on before it regenerates: the record is
    // the pin producer's, whole and intact, and still not this mode's.
    ['no pin: a pin-mode record (no inTree block) is RED with the in-tree command', mkInTree((r) => editRecord(r, ({ inTree, ...rest }) => ({
      objectuiSha: 'a'.repeat(40),
      ...rest,
      modulesRoot: `.cache/objectui-${'a'.repeat(12)}/apps/console`,
      objectuiWorkspaceVersion: '0.0.0-selftest',
    }))), 1, blind, ['`inTree`', IN_TREE_REGENERATE]],
    // The sixth column is text NO problem may carry: the red names the package
    // that moved and no other, which is what lets a reader re-record only it.
    ['no pin: a staged edit to one registry package is RED naming that package alone', mkInTree((r, git) => {
      writeFileSync(join(r, pkgDir('@object-ui/plugin-grid'), 'src', 'index.ts'), 'export const id = "moved";\n');
      git('add', '-A');
    }), 1, blind, ['ui/packages/plugin-grid:', IN_TREE_REGENERATE], ['ui/packages/plugin-form', 'ui/packages/core']],
    ['no pin: an edit the index does not hold is not a registry change', mkInTree((r) => {
      writeFileSync(join(r, pkgDir('@object-ui/plugin-grid'), 'src', 'index.ts'), 'export const id = "unstaged";\n');
      writeFileSync(join(r, pkgDir('@object-ui/plugin-grid'), 'src', 'untracked.ts'), 'export {};\n');
    }), 0, blind],
    ['no pin: a test file or a package the registry does not reach is not a registry change', mkInTree((r, git) => {
      mkdirSync(join(r, pkgDir('@object-ui/plugin-grid'), 'src', '__tests__'), { recursive: true });
      writeFileSync(join(r, pkgDir('@object-ui/plugin-grid'), 'src', '__tests__', 'grid.ts'), 'export {};\n');
      writeFileSync(join(r, pkgDir('@object-ui/types'), 'src', 'types.spec.tsx'), 'export {};\n');
      writeFileSync(join(r, pkgDir('@object-ui/unrelated'), 'src', 'more.ts'), 'export {};\n');
      git('add', '-A');
    }), 0, blind],
    ['no pin: a new workspace edge into the registry is RED', mkInTree((r) => {
      const p = join(r, pkgDir('@object-ui/plugin-grid'), 'package.json');
      const manifest = JSON.parse(readFileSync(p, 'utf8'));
      writeFileSync(p, JSON.stringify({ ...manifest, peerDependencies: { '@object-ui/unrelated': 'workspace:*' } }, null, 2));
    }), 1, blind, ['ui/packages/unrelated', IN_TREE_REGENERATE]],
    ['no pin: a new package the registry reaches is RED naming it', mkInTree((r, git) => {
      const dir = join(r, UI_PACKAGES, 'plugin-new');
      mkdirSync(join(dir, 'src'), { recursive: true });
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@object-ui/plugin-new', version: '0.0.0-selftest' }, null, 2));
      writeFileSync(join(dir, 'src', 'index.ts'), 'export {};\n');
      const p = join(r, pkgDir('@object-ui/plugin-grid'), 'package.json');
      writeFileSync(p, JSON.stringify({ ...JSON.parse(readFileSync(p, 'utf8')), dependencies: { '@object-ui/plugin-new': 'workspace:*' } }, null, 2));
      git('add', '-A');
    }), 1, blind, ['ui/packages/plugin-new', IN_TREE_REGENERATE]],
    ['no pin: a removed registry package is RED naming its record', mkInTree((r, git) => {
      rmSync(join(r, pkgDir('@object-ui/types')), { recursive: true });
      const p = join(r, pkgDir(REGISTRY_CORE), 'package.json');
      writeFileSync(p, JSON.stringify({ ...JSON.parse(readFileSync(p, 'utf8')), dependencies: {} }, null, 2));
      git('add', '-A');
    }), 1, blind, [`${REGISTRY_RECORDS}/types.json`, IN_TREE_REGENERATE]],
    ['no pin: a deleted package record is RED naming the package', mkInTree((r) => rmSync(packageRecord(r, '@object-ui/plugin-map'))), 1, blind, [
      'ui/packages/plugin-map',
      IN_TREE_REGENERATE,
    ]],
    // Two branches regenerated on different bases: this package's digest is
    // current, but the artefact it was verified against is not the one committed.
    ['no pin: a package record verified against another artefact is RED', mkInTree((r) => {
      const p = packageRecord(r, '@object-ui/plugin-form');
      const was = JSON.parse(readFileSync(p, 'utf8'));
      writeFileSync(p, registryRecordLine({ dir: was.package, files: was.sources, sha256: was.sha256 }, 'f'.repeat(64)));
    }), 1, blind, ['ui/packages/plugin-form: verified against ffffffffffff', IN_TREE_REGENERATE]],
    // Pretty-printed, one record spans lines, and two branches can merge a
    // digest from one with an artefact sha256 from the other without a conflict.
    ['no pin: a package record out of its one-line form is RED', mkInTree((r) => {
      const p = packageRecord(r, '@object-ui/plugin-grid');
      writeFileSync(p, `${JSON.stringify(JSON.parse(readFileSync(p, 'utf8')), null, 2)}\n`);
    }), 1, blind, [`${REGISTRY_RECORDS}/plugin-grid.json`, IN_TREE_REGENERATE]],
    ['no pin: a record from the single-digest layout is RED with the in-tree command', mkInTree((r) => editRecord(r, (rec) => ({
      ...rec,
      inTree: { ...rec.inTree, registryPackages: [], registrySources: 1, registrySourcesSha256: '0'.repeat(64) },
    }))), 1, blind, ['`registrySourcesSha256`', IN_TREE_REGENERATE]],
    ['no pin: a hand-edited artefact is RED', mkInTree((r) => writeFileSync(join(r, READ_PATHS.artefact), '{"components":{"flex":{"type":"flex"}}}')), 1, blind, [IN_TREE_REGENERATE]],
    ['no pin: the in-tree producer builds, then writes a tree this gate passes', producedInTree.root, 0, blind],
    ['no pin: the producer re-records only the package whose sources moved', rerecorded.root, 0, { ...blind, extra: rerecordedProblems }],
  ];

  // The ledger this self-test's floor is evaluated against (#13489).
  const batterySeen = new Map();
  const registerCase = (name) => {
    batterySeen.set(name, (batterySeen.get(name) ?? 0) + 1);
  };

  let failures = 0;
  for (const [name, root, want, { extra = [], ...options } = {}, mustName = [], mustNotName = []] of cases) {
    registerCase(name);
    const problems = [...checkTree(root, options), ...extra];
    const got = problems.length ? 1 : 0;
    const unnamed = got ? mustName.filter((text) => !problems.join('\n').includes(text)) : [];
    const misnamed = got ? mustNotName.filter((text) => problems.join('\n').includes(text)) : [];
    if (got !== want || unnamed.length > 0 || misnamed.length > 0) {
      failures++;
      console.error(
        got !== want
          ? `✗ self-test: ${name} — expected ${want ? 'RED' : 'GREEN'}, got ${got ? 'RED' : 'GREEN'}`
          : unnamed.length > 0
            ? `✗ self-test: ${name} — RED, but no problem names ${unnamed.map((text) => JSON.stringify(text)).join(', ')}`
            : `✗ self-test: ${name} — RED, but a problem also names ${misnamed.map((text) => JSON.stringify(text)).join(', ')}`,
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
  // The digest is only a reading of what the producer enumerates while the two
  // registry lists are one list. The producer refuses a mismatch on its own
  // in-tree run; this holds it on every run, with or without a pin.
  const producerList = /const REGISTRY_MODULES = \[([^\]]*)\];/.exec(readFileSync(join(DEFAULT_ROOT, PRODUCER), 'utf8'));
  const producerModules = producerList ? [...producerList[1].matchAll(/'(@object-ui\/[a-z0-9-]+)'/g)].map((m) => m[1]) : [];
  if (JSON.stringify(producerModules) !== JSON.stringify(REGISTRY_MODULES)) {
    declFail(`REGISTRY_MODULES here and in ${PRODUCER} disagree (or its list is unreadable) — the in-tree digest `
      + 'would describe a different registry than the one the producer enumerates.');
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
      'the producer, run under a symlinked TMPDIR, writes a tree that passes; with no pin, the per-package registry digests red a ' +
      'staged edit naming only its package, a new package, a new workspace edge, a removed package, a deleted, malformed or ' +
      'other-artefact record and the retired single-digest record, and ignore tests, unreached packages and unstaged bytes, no pin ' +
      'and no console is RED naming both, and the in-tree producer builds, writes a tree that passes, and re-records only the ' +
      'package that moved).',
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
      // No pin: checkTree ran the in-tree leg, which has no check 4 to report.
      const { inTree } = record;
      let declared = 'unreadable';
      try {
        declared = JSON.stringify(JSON.parse(readFileSync(join(DEFAULT_ROOT, UI_PACKAGES, 'core', 'package.json'), 'utf8')).version);
      } catch {
        // display only — the verdict above did not read it
      }
      // display only — checkTree has already held every record to its package
      const { records } = readRegistryRecords(DEFAULT_ROOT);
      const sources = [...records.values()].reduce((sum, rec) => sum + rec.sources, 0);
      console.log(
        `✓ check-sdui-manifest: sdui.manifest.json is present, intact (sha256 ${String(record.sha256).slice(0, 12)}…, ` +
          `${record.components} components) and generated from the in-tree registry as it stands: ${sources} ` +
          `source(s) in ${records.size} package(s) under ${UI_PACKAGES}/, each package's digest current in its record under ` +
          `${REGISTRY_RECORDS}/ (no .objectui-sha in this tree).`,
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
