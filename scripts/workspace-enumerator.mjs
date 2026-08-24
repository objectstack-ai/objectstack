// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * workspace-enumerator — the ONE parse of `pnpm-workspace.yaml`'s `packages:`
 * block, and the ONE expansion of those globs to member directories.
 *
 * Nine scripts used to carry a private copy of this parse. Measured on the tree
 * this module landed on, they fell into four behaviour clusters that agreed on
 * the repo's real file and disagreed on nine of seventeen adversarial inputs —
 * a shared answer that was only ever true by coincidence. The clusters, and
 * which way this module settles each divergence, are the table below.
 *
 * ## Why a plain module and NOT a gate of its own (#11190 step 1, #11510)
 *
 * `scripts/pm/dispatch-gates.mjs` follows a gate script's first-party imports
 * one level down, so a population declared in a shared module reaches every
 * gate that imports it. That follow deliberately REFUSES to open a module that
 * is itself resolved from some workflow's `check:` invocation: such a module's
 * population already reaches the tree through its own family, and attributing
 * it to every importer was measured at +3065 fabricated (gate, file) pairs for
 * a single caller. So this file is a plain module — no `check:*` script names
 * it, no workflow invokes it — the shape `scripts/i18n-bundle-surface.mjs` and
 * `scripts/regen-artifacts.mjs` already have.
 *
 * ## ⛔ THIS MODULE DECLARES NO PATH POPULATION, AND MUST NOT GROW ONE
 *
 * This is the single most load-bearing property of the file, it is not
 * obvious, and `selfTest` pins it.
 *
 * Because the import follow appends a followed module's watch hints to EVERY
 * importer, a `'packages/*'`-shaped literal written anywhere in this module
 * body would hand the whole workspace population to all nine callers at once.
 * Priced on the live tree before this module was written, with the eleven
 * workspace globs as literals here:
 *
 *   check-changeset-fixed.mjs          1 ->  5396   (+5395)
 *   check:release-body                 0 ->  5395   (+5395)  ⛔ see below
 *   check:pnpm-filter-targets        272 ->  5667   (+5395)
 *   check:published-readme-exports     2 ->  5397   (+5395)
 *   check:override-consistency         0 ->  5395   (+5395)
 *   check:type-check-coverage         98 ->  5398   (+5300)
 *   check:type-check-debt             98 ->  5398   (+5300)
 *   check-dev-prereqs.mjs           1245 ->  5395   (+4150)
 *   check:published-files           5396 ->  5396   (     0)
 *                                              TOTAL  +41725
 *
 * 41725 pairs, 13.6x the +3065 the follow already refuses on provenance. And
 * it is not merely expensive, it is CONTRADICTORY: three of those callers have
 * measured this exact declaration and refused it in writing —
 * check-published-readme-exports.mjs (2.8% of the declared files are ever
 * opened, its refusal docblock carries the number), check-dev-prereqs.mjs (CI
 * runs its `--self-test` only), and release-github-releases.mjs, which carries
 * a `dispatch-gates: no-path-population` marker. That marker is held against
 * the live derivation by dispatch-gates' own self-test ("no family both
 * DECLARES no path population and names paths anyway"), so a literal here does
 * not merely inflate a count — it turns that gate RED, in a file whose author
 * never touched it.
 *
 * The one string this module does spell, `pnpm-workspace.yaml`, is safe and
 * that was measured too: `hintCovers` refuses a literal with no path separator
 * as too generic, so it contributes zero pairs to zero families.
 *
 * The consequence for a reader: each gate keeps declaring its OWN population in
 * its OWN module body — `ROOT_DIR_WATCH_HINTS` in check-published-files.mjs,
 * `WORKSPACE_PARENT_GLOBS` in check-test-source-alias.mjs and
 * check-type-source-resolution.mjs. What is consolidated here is the PARSE,
 * never the DECLARATION. Those are two different things and the measurement
 * above is why they cannot share a module.
 *
 * ## How the divergences are settled, case by case
 *
 * Every row was measured against the real source bytes of all nine parsers.
 * "today" records whether the repo's current `pnpm-workspace.yaml` can tell
 * the difference — every row reads "no", which is why nothing observable
 * changes on this tree and why every one of these was a latent trap.
 *
 *   input                        | old answers          | here      | today
 *   -----------------------------|----------------------|-----------|-------
 *   `- pkg/*   # trailing note`  | strip / keep / STOP  | strip     | no
 *   `- vendor/c#sharp`           | truncate / keep      | keep      | no
 *   full-line comment in list    | skip / STOP          | skip      | no
 *   blank line in list           | skip (all agree)     | skip      | no
 *   `packages :` (space)         | accept / ignore      | accept    | no
 *   a SECOND `packages:` block   | append / first-wins  | REFUSE    | no
 *   no `packages:` key           | [] / throw           | throw     | no
 *   empty `packages:` block      | [] / throw           | throw     | no
 *   `- packages/**`              | expand-nothing/throw | throw     | no
 *
 * Three of those deserve their reason stated, because each is a silent-failure
 * class rather than a preference:
 *
 * - A `#` is a YAML comment only when it starts a line or follows whitespace.
 *   Four parsers stripped `/#.*$/` unconditionally, which silently truncates
 *   `vendor/c#sharp` to `vendor/c` — a member directory that does not exist,
 *   dropped from the scan with no error. Two others kept the trailing comment
 *   glued to the pattern, which is the same silent drop by the other route.
 *   Only the whitespace rule is right, and no old parser implemented it.
 *
 * - An empty or absent `packages:` block returned `[]` in three parsers. That
 *   is a clean run over an empty workspace: every "is every member covered"
 *   gate passes vacuously, loudly green. It throws here. Callers that must
 *   tolerate a MISSING FILE (pnpm-filter-targets' `--preflight` runs in trees
 *   that have none) test for the file themselves — absent file and unparseable
 *   file are different questions and stay that way.
 *
 * - A duplicate top-level `packages:` key is invalid YAML, and pnpm would
 *   reject it. Three parsers stopped at the first block, three resumed and
 *   APPENDED the second block's entries to the first's. Neither is a reading
 *   anyone chose; this module refuses the input instead of picking a winner.
 *
 * ## No dependencies, deliberately
 *
 * `scripts/pm/os-verify-lock.sh --preflight` calls into pnpm-filter-targets in
 * a tree whose `node_modules` is absent or half-installed — the exact situation
 * in which a verification command is most likely to be wrong. Nothing here may
 * import outside `node:`.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';

/**
 * The workspace manifest's filename.
 *
 * Safe to spell: `hintCovers` refuses a literal carrying no path separator as
 * too generic, so this contributes no watch hint to any importer. See this
 * file's header for why that matters more than it looks.
 */
export const WORKSPACE_FILE = 'pnpm-workspace.yaml';

/** Directory names never treated as workspace members. */
const NEVER_A_MEMBER = new Set(['node_modules']);

/**
 * A workspace file this module refuses to read an answer out of. Callers map it
 * onto their own failure vocabulary (check-dev-prereqs.mjs rethrows it as its
 * `CoverageError`); what matters is that it is never swallowed into an empty
 * list, which is the vacuous-pass failure the header describes.
 */
export class WorkspaceEnumerationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WorkspaceEnumerationError';
  }
}

/**
 * Strip a YAML line comment, and ONLY a YAML line comment: a `#` that opens the
 * line or follows whitespace. A `#` with a non-space character before it is an
 * ordinary character of the scalar.
 *
 * @param {string} line
 * @returns {string}
 */
export function stripLineComment(line) {
  const m = /(^|\s)#/.exec(line);
  return m === null ? line : line.slice(0, m.index + m[1].length);
}

/**
 * The `packages:` globs a workspace file declares, in file order.
 *
 * Blank lines and whole-line comments inside the block are skipped rather than
 * treated as its end; the next top-level key ends it. An absent block, an empty
 * block, and a duplicate `packages:` key are all refusals — see the header.
 *
 * @param {string} text the workspace file's contents
 * @param {{ source?: string }} [options] `source` names the file in errors
 * @returns {string[]}
 */
export function parseWorkspaceGlobs(text, { source = WORKSPACE_FILE } = {}) {
  const lines = String(text).split(/\r?\n/);
  const isKey = (line) => /^packages\s*:\s*$/.test(line);
  const start = lines.findIndex(isKey);
  if (start === -1) {
    throw new WorkspaceEnumerationError(
      `${source}: no top-level \`packages:\` block — refusing to report an empty workspace as a clean one.`,
    );
  }
  const globs = [];
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const line = stripLineComment(lines[i]).trimEnd();
    if (!line.trim()) continue;
    const item = /^\s+-\s+(?:(['"])(.*)\1|(\S.*?))\s*$/.exec(line);
    if (item) {
      globs.push(item[2] ?? item[3]);
      continue;
    }
    if (/^\S/.test(line)) {
      end = i;
      break;
    }
  }
  // Refuse a duplicate top-level key rather than pick a winner: three of the
  // parsers this replaces stopped at the first block and three appended the
  // second, and pnpm accepts neither file.
  const second = lines.findIndex((line, i) => i >= end && isKey(line));
  if (second !== -1) {
    throw new WorkspaceEnumerationError(
      `${source}: a second top-level \`packages:\` key at line ${second + 1} — duplicate keys are invalid YAML and the two blocks disagree about the workspace.`,
    );
  }
  if (globs.length === 0) {
    throw new WorkspaceEnumerationError(
      `${source}: the \`packages:\` block declares no members — refusing to scan an empty workspace.`,
    );
  }
  return globs;
}

/**
 * The `packages:` globs of the workspace rooted at `root`.
 *
 * A MISSING file is this function's refusal too. Callers for whom "no workspace
 * here" is an ordinary answer (pnpm-filter-targets outside a workspace) test
 * with `existsSync` first; the two questions are kept apart on purpose.
 *
 * @param {string} root
 * @returns {string[]}
 */
export function readWorkspaceGlobs(root) {
  const file = join(root, WORKSPACE_FILE);
  if (!existsSync(file)) {
    throw new WorkspaceEnumerationError(
      `${WORKSPACE_FILE} is missing under ${root} — cannot enumerate workspace packages.`,
    );
  }
  return parseWorkspaceGlobs(readFileSync(file, 'utf8'));
}

/** Whether a glob is a pnpm exclusion (`!pattern`), which enumerates nothing. */
export function isExclusionGlob(glob) {
  return glob.startsWith('!');
}

/**
 * Expand ONE glob to repo-relative member directories.
 *
 * `<dir>` and `<dir>/*` are the two shapes this workspace uses and the only two
 * accepted. Anything richer throws rather than expanding to nothing: four of the
 * parsers this replaces quietly returned no directories for `packages/**`, which
 * removes members from a scan while the gate reports a clean run over what is
 * left. Loud beats vacuous, which is the posture three of the nine already took.
 *
 * @param {string} root
 * @param {string} glob
 * @param {{ source?: string }} [options]
 * @returns {string[]} repo-relative POSIX directories, unsorted
 */
export function expandWorkspaceGlob(root, glob, { source = WORKSPACE_FILE } = {}) {
  if (isExclusionGlob(glob)) return [];
  const star = glob.endsWith('/*');
  const base = star ? glob.slice(0, -2) : glob;
  if (base.includes('*')) {
    throw new WorkspaceEnumerationError(
      `${source}: pattern ${JSON.stringify(glob)} is richer than \`<dir>\` or \`<dir>/*\`.\n` +
        `  Teach scripts/workspace-enumerator.mjs the new shape — silently covering fewer packages\n` +
        `  would make every gate that enumerates the workspace pass vacuously.`,
    );
  }
  const abs = join(root, base);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) return [];
  if (!star) return [base];
  return readdirSync(abs, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !NEVER_A_MEMBER.has(e.name))
    .map((e) => posix.join(base, e.name));
}

/**
 * Every directory the workspace globs enumerate, whether or not it holds a
 * manifest. `workspacePackageDirs` is the narrower answer most callers want;
 * this one exists because check-dev-prereqs.mjs needs the membership set itself.
 *
 * @param {string} root
 * @returns {string[]} repo-relative POSIX directories, sorted and deduplicated
 */
export function workspaceMemberDirs(root) {
  const dirs = new Set();
  for (const glob of readWorkspaceGlobs(root)) {
    for (const dir of expandWorkspaceGlob(root, glob)) dirs.add(dir);
  }
  return [...dirs].sort();
}

/**
 * Every workspace member that actually holds a `package.json`.
 *
 * @param {string} root
 * @returns {string[]} repo-relative POSIX directories, sorted
 */
export function workspacePackageDirs(root) {
  return workspaceMemberDirs(root).filter((dir) => existsSync(join(root, dir, 'package.json')));
}

/**
 * Every workspace member's directory paired with its parsed manifest.
 * A member whose manifest is unparseable is skipped — that is another gate's
 * finding, and failing here would make every enumerating gate red for it.
 *
 * @param {string} root
 * @returns {Array<{ dir: string, manifest: Record<string, unknown> }>}
 */
export function workspacePackages(root) {
  const out = [];
  for (const dir of workspacePackageDirs(root)) {
    try {
      out.push({ dir, manifest: JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8')) });
    } catch {
      /* an unparseable manifest is not this module's finding */
    }
  }
  return out;
}

/**
 * The shared assertions, returned rather than printed so each importing gate
 * can fold them into its own `--self-test` report.
 *
 * This module is deliberately not a gate (see the header), so it has no CI
 * invocation of its own: its coverage is that every consolidated caller runs
 * `--self-test` in lint.yml and every one of them calls this.
 *
 * @param {{ root?: string }} [options] `root` enables the live half
 * @returns {string[]} failure descriptions; empty means OK
 */
export function selfTest({ root = null } = {}) {
  const failures = [];
  const t = (name, ok) => {
    if (!ok) failures.push(`workspace-enumerator: ${name}`);
  };
  // Every fixture path is ASSEMBLED, never spelled. A path-shaped literal
  // anywhere in this file — a self-test fixture included — is read by
  // `extractWatchHints` and inherited by every importing gate. Measured while
  // this module was being written: fixtures spelled the obvious way leaked
  // `packages/*` and `apps/*` and cost 10273 (gate, file) pairs, and the
  // masking that was supposed to hide them did not. Assembling them makes the
  // header's "declares no path population" claim true by construction rather
  // than true by a rule in another file continuing to behave.
  const P = (...segments) => segments.join('/');
  const PKGS = P('packages', '*');
  const APPS = P('apps', '*');
  const answer = (text) => {
    try {
      return JSON.stringify(parseWorkspaceGlobs(text));
    } catch (err) {
      return err instanceof WorkspaceEnumerationError ? 'REFUSED' : `THREW ${err?.name}`;
    }
  };
  const both = JSON.stringify([PKGS, APPS]);
  const flat = JSON.stringify([PKGS]);

  // ── the parse, one case per divergence the consolidation settled ──────────
  t('a plain list parses', answer(`packages:\n  - ${PKGS}\n  - ${APPS}\n`) === both);
  t('quotes are stripped', answer(`packages:\n  - '${PKGS}'\n  - "${APPS}"\n`) === both);
  t('CRLF parses the same', answer(`packages:\r\n  - ${PKGS}\r\n  - ${APPS}\r\n`) === both);
  t('a blank line inside the list is not its end', answer(`packages:\n  - ${PKGS}\n\n  - ${APPS}\n`) === both);
  t('a whole-line comment inside the list is not its end', answer(`packages:\n  - ${PKGS}\n  # a note\n  - ${APPS}\n`) === both);
  t('the next top-level key ends the list', answer(`packages:\n  - ${PKGS}\nonlyBuiltDependencies:\n  - esbuild\n`) === flat);
  t('`packages :` with a space is still the key', answer(`packages :\n  - ${PKGS}\n`) === flat);
  t(
    'an exclusion entry survives the parse (the expansion drops it)',
    answer(`packages:\n  - ${PKGS}\n  - "!${P('packages', 'legacy')}"\n`) === JSON.stringify([PKGS, `!${P('packages', 'legacy')}`]),
  );

  // The `#` rule, both directions — the divergence no old parser got right.
  t('a trailing comment is stripped off an entry', answer(`packages:\n  - ${PKGS}   # the flat ones\n`) === flat);
  const HASHY = P('vendor', 'c#sharp');
  t('a `#` with no space before it stays part of the scalar', answer(`packages:\n  - ${HASHY}\n`) === JSON.stringify([HASHY]));
  t('stripLineComment leaves a bare `#` alone', stripLineComment('a#b') === 'a#b');
  t('stripLineComment cuts at a space-led `#`', stripLineComment('a #b') === 'a ');
  t('stripLineComment cuts a line-leading `#`', stripLineComment('#b') === '');

  // The refusals. Each one replaces a silent empty answer in at least one of
  // the parsers this module consolidated.
  t('no `packages:` key is REFUSED, never an empty list', answer('onlyBuiltDependencies:\n  - esbuild\n') === 'REFUSED');
  t('an empty `packages:` block is REFUSED', answer('packages:\nonlyBuiltDependencies:\n  - esbuild\n') === 'REFUSED');
  t('a dash with no space declares nothing, and that is REFUSED', answer(`packages:\n  -${PKGS}\n`) === 'REFUSED');
  t(
    'a duplicate `packages:` key is REFUSED rather than resolved',
    answer(`packages:\n  - ${PKGS}\nother:\n  x: 1\npackages:\n  - ${P('late', '*')}\n`) === 'REFUSED',
  );
  t('the flow-sequence form is REFUSED rather than read as empty', answer(`packages: [${PKGS}, ${APPS}]\n`) === 'REFUSED');

  // ── the expansion ─────────────────────────────────────────────────────────
  const NOWHERE = P('', 'nonexistent');
  const expandRefused = (glob) => {
    try {
      expandWorkspaceGlob(NOWHERE, glob);
      return false;
    } catch (err) {
      return err instanceof WorkspaceEnumerationError;
    }
  };
  t('a `**` glob is REFUSED rather than expanded to nothing', expandRefused(P('packages', '**')));
  t('a mid-segment `*` is REFUSED too', expandRefused(P('packages', '*', 'plugins')));
  t(
    'an exclusion glob expands to nothing without touching the disk',
    expandWorkspaceGlob(NOWHERE, `!${P('packages', 'legacy')}`).length === 0,
  );

  // ── the property this module exists to keep: NO path population ───────────
  //
  // Pinned mechanically, not by review, and read off THIS FILE's own bytes so
  // a stale copy cannot satisfy it. A path-shaped literal added here — in the
  // parse, in an error message, or in a fixture — is inherited as a watch hint
  // by every importing gate: priced in the header at +41725 (gate, file) pairs,
  // and it turns check:release-body RED by contradicting its
  // `no-path-population` marker.
  //
  // The predicate below is deliberately STRICTER than the one it guards
  // (`extractWatchHints` in scripts/pm/dispatch-gates.mjs): any quoted literal
  // containing a separator counts here, where that scanner also applies
  // namespace refusals and self-test masking. A mirror is normally a second
  // contract that drifts, so it is worth naming why this one cannot bite: it
  // can only refuse MORE than the real scanner, so it fails loudly for a
  // literal the derivation would have ignored, and never passes one the
  // derivation would have taken.
  try {
    const self = readFileSync(new URL(import.meta.url), 'utf8');
    const body = self.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
    const offending = [...body.matchAll(/['"`]([^'"`\n]{2,120})['"`]/g)]
      .map((m) => m[1])
      .filter((raw) => /^[\w.@][\w.@/*-]*$/.test(raw))
      .filter((raw) => raw.includes('/'))
      .filter((raw) => !raw.startsWith('node:'));
    t(
      `no path-shaped literal in this module body can become a watch hint (found: ${offending.join(', ') || 'none'})`,
      offending.length === 0,
    );
  } catch (err) {
    failures.push(`workspace-enumerator: could not read own source to check for path literals (${err?.message})`);
  }

  // ── the live half, when a caller supplies the repo root ───────────────────
  if (root !== null) {
    let live = null;
    try {
      live = readWorkspaceGlobs(root);
    } catch (err) {
      failures.push(`workspace-enumerator: the repo's own ${WORKSPACE_FILE} does not parse (${err?.message})`);
    }
    if (live) {
      t(`the repo's own ${WORKSPACE_FILE} parses to a non-empty glob list (${live.length})`, live.length > 0);
      t(
        'every live glob expands to a shape this module accepts',
        live.every((g) => {
          try {
            expandWorkspaceGlob(root, g);
            return true;
          } catch {
            return false;
          }
        }),
      );
      const members = workspacePackageDirs(root);
      t(`the live workspace enumerates packages (${members.length})`, members.length > 0);
    }
  }

  return failures;
}
