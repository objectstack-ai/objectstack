#!/usr/bin/env node
/**
 * Reports when a change MODIFIES or DELETES a `.changeset/*.md` that already
 * existed at its merge base — a changeset it does not own.
 *
 * Run:  node scripts/check-changeset-overwrite.mjs
 * Exit: 0 = nothing pre-existing was touched, the touch is release consumption,
 *           or REPORT-ONLY mode (the default) declined to fail on the findings
 *       1 = the inputs could not be read, or `OS_CHANGESET_OVERWRITE_ENFORCE=1`
 *           and a pre-existing changeset was modified or deleted
 *
 * ## The hazard (objectui#6336)
 *
 * A dev run wrote its changeset to a hand-picked `changesets`-style name,
 * `olive-donkeys-smile.md`. That file already existed on `main`, carrying an
 * unrelated `@object-ui/plugin-charts: minor`. The heredoc overwrote it. It was
 * caught before any commit and no damage occurred — this gate is about the
 * hazard, not that incident.
 *
 * What makes it worth a gate rather than a guideline: **the cost lands on a THIRD
 * PARTY and is invisible at the time it happens.** The agent that picks a
 * colliding name loses nothing; whichever earlier pull request's release
 * declaration vanishes pays, and only discovers it when a package silently fails
 * to bump. Both signals that should catch it fail:
 *
 *  1. `git status` shows ` M` (modified), not `??` (untracked). An agent checking
 *     "did my new file appear" reads a modification as its own write landing.
 *     Nothing says *you replaced someone else's file*.
 *  2. The loss is a DELETED RELEASE DECLARATION. Nothing downstream flags it —
 *     the packages simply do not get bumped, with no red anywhere.
 *
 * The base rate is not small: 424 accumulated `.changeset/*.md` at the time of
 * writing, against an `adjective-animal-verb` name space.
 *
 * What actually caught the near-miss was neither a gate nor a test:
 * `check-changeset-presence` reported "0 changeset(s) added", and the dev read
 * that gate's own detection logic instead of assuming the gate was wrong. This
 * file exists to replace that thread.
 *
 * ## Why REPORT-ONLY, and what would justify flipping it
 *
 * Triage ruled "report-only first if the population has legitimate modify cases,
 * and measure that before choosing". Measured over all 5281 first-parent commits
 * on `main` (2026-01-13 .. 2026-08-25), `--diff-filter=MD` over
 * `:(glob).changeset/*.md`:
 *
 *   - 88 commits DELETE a pre-existing changeset (1644 files). 82 of them also
 *     modify a package `CHANGELOG.md` — release consumption, which is how
 *     changesets are meant to end. The remaining 6 are five hand deletions plus
 *     one hand-versioned release; four of the five delete a declaration and add
 *     a replacement in the same commit.
 *   - 12 commits MODIFY a pre-existing changeset (19 files), and **all 19 are
 *     legitimate**: bump-level corrections (`major` to `minor` when the pending
 *     release line changed, `minor` to `patch` after review — 11 files across 4
 *     commits), factual corrections to prose ("eleven" to "ten" locale packs; a
 *     typo'd package name `@objectstack/console` to `@object-ui/console`), and
 *     authors amending their own not-yet-released changeset after the change
 *     grew.
 *
 * So the premise "a PR modifying a pre-existing changeset is almost always a
 * mistake" is NOT true of this repository's history — 19 for 19 against — and a
 * blocking gate would have failed every one of those pull requests. Hence
 * report-only. `OS_CHANGESET_OVERWRITE_ENFORCE=1` flips it for whoever revisits
 * this with a new measurement; the switch is here so that flip is a decision
 * rather than a rewrite.
 *
 * ⭐ The same sweep did find a NARROWER signal that history does not contradict.
 * Of those 19 legitimate modifications, 18 keep every package NAME they declared
 * at base — a bump level changes, prose changes, names do not disappear. The one
 * exception dropped `@objectstack/console`, a name that resolves to no package in
 * this workspace, because that was the typo being fixed. An overwrite is the
 * opposite shape: the previous declaration's names are simply gone. This gate
 * therefore REPORTS lost declarations separately and loudly, and a future
 * blocking rule scoped to "a workspace package's declaration disappeared" would
 * have been 0-for-19 on this history. Deliberately not built today: one
 * explainable hit is not a measurement, and the ruling was report-only first.
 *
 * ## Why this lives in `changeset-guard.yml`
 *
 * That workflow's trigger is `paths: ['.changeset/**', ...]` — the inverse filter
 * documented in its own header. A path filter is normally a false-negative
 * surface, but not here: a change that modifies or deletes a `.changeset/*.md`
 * touches `.changeset/**` BY DEFINITION, so the filter cannot miss this gate's
 * subject matter. It is a second job rather than a step in `no-major` because it
 * reads a diff and therefore needs `fetch-depth: 0`, which that job does not
 * want.
 *
 * ## Never silent
 *
 * An unreadable input is exit 1, never a pass, even in report-only mode. A diff
 * gate that cannot compute its diff and exits 0 has reported "clean" while
 * looking at nothing (objectstack#4928, objectui#4690). Report-only means it does
 * not fail on FINDINGS; it still fails on not knowing.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntrypoint } from './invoked-as.mjs';
import {
  NOT_A_CHANGESET,
  changedFiles,
  describeDeclaration,
  resolveBaseRef,
  untrackedChangesets,
} from './check-changeset-presence.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));

/** The declarations, as a pathspec. `.changeset/config.json` is not `.md`. */
const CHANGESETS = ':(glob).changeset/*.md';

/**
 * Where a release writes its output. A modification here is what separates
 * `changeset version` emptying the queue from a pull request deleting somebody
 * else's declaration — measured across the whole history of `main`: 93 commits
 * modify a package `CHANGELOG.md`, 92 of them are release commits, and the one
 * that is not (`e5537d1cb`, a repo-wide reference rename) deletes no changeset.
 */
const CHANGELOGS = [':(glob)packages/*/CHANGELOG.md', ':(glob)apps/*/CHANGELOG.md'];

const isDeclaration = (file) => !NOT_A_CHANGESET.has(file.slice(file.lastIndexOf('/') + 1));

/**
 * The `name: bump` entries a changeset's frontmatter declares.
 *
 * The same hand-parsed dialect as `describeDeclaration`, which counts these
 * entries without naming them, and hand-parsed for the same reason it is there:
 * this gate runs on a bare checkout with no `pnpm install`, so it may not import
 * a YAML parser or `@changesets/*`. `describeDeclaration` stays the authority on
 * whether a file declares anything at all; this only reads the names out of a
 * block it has already accepted.
 *
 * @returns {{ name: string, bump: string }[]}
 */
export function declaredEntries(source) {
  if (describeDeclaration(source).kind === 'none') return [];
  const lines = source.split(/\r?\n/);
  const open = lines.findIndex((line) => line.trim() === '---');
  const entries = [];
  for (let i = open + 1; i < lines.length; i++) {
    const text = lines[i].trim();
    if (text === '---') break;
    const match = /^(?:"([^"]+)"|'([^']+)'|([^:]+?))\s*:\s*(major|minor|patch)\s*$/.exec(text);
    if (match) entries.push({ name: match[1] ?? match[2] ?? match[3], bump: match[4] });
  }
  return entries;
}

/**
 * One file's content at a revision, or `null` when the path is not there.
 *
 * `ref === null` means the WORKING TREE, matching `check-changeset-presence`: an
 * author running this locally gets the answer before committing. A file deleted
 * in the working tree is absent from disk, which is the same `null` a path
 * missing from a commit gives — the caller already knows which side it asked
 * about.
 */
function contentAt(root, ref, file) {
  if (ref === null) {
    try {
      return readFileSync(join(root, file), 'utf8');
    } catch {
      return null;
    }
  }
  try {
    return execFileSync('git', ['show', `${ref}:${file}`], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    return null;
  }
}

/**
 * @typedef {object} Hit
 * @property {string} file
 * @property {{ name: string, bump: string }[]} before what it declared at `base`
 * @property {{ name: string, bump: string }[]} after  what it declares now (`[]` when deleted)
 * @property {string[]} lost package names declared at `base` and gone now
 */

/**
 * @typedef {object} Analysis
 * @property {Hit[]} modified
 * @property {Hit[]} deleted
 * @property {string[]} added
 * @property {number} changelogsTouched
 * @property {boolean} releaseConsumption
 */

/**
 * What this change does to changesets it did not create.
 *
 * `base` is the merge base, so "pre-existing" needs no ownership bookkeeping: a
 * changeset this change ADDED and then edited on the same branch is an `A`
 * against the merge base, never an `M`. Only somebody else's file can be `M`.
 *
 * Throws on any unreadable input; the CLI turns that into exit 1.
 *
 * @returns {Analysis}
 */
export function collisions(root, { base, head = null }) {
  const list = (filter, pathspecs) => changedFiles(root, { base, head, filter, pathspecs }).filter(isDeclaration);

  const at = (ref, file) => {
    const source = contentAt(root, ref, file);
    return source === null ? [] : declaredEntries(source);
  };

  const modified = list('M', [CHANGESETS]).map((file) => {
    const before = at(base, file);
    const after = at(head, file);
    const names = new Set(after.map((entry) => entry.name));
    return { file, before, after, lost: before.map((entry) => entry.name).filter((name) => !names.has(name)) };
  });

  const deleted = list('D', [CHANGESETS]).map((file) => {
    const before = at(base, file);
    return { file, before, after: [], lost: before.map((entry) => entry.name) };
  });

  const changelogsTouched = changedFiles(root, { base, head, filter: 'M', pathspecs: CHANGELOGS }).length;

  // Untracked files join the ADDED count for the same reason `check-changeset-
  // presence` counts them: `git diff` against the working tree cannot see one,
  // and `pnpm changeset` leaves precisely that. Without it an author running
  // this locally right after writing a changeset is told "0 added", which is the
  // misleading half of the very summary line this gate uses to orient them.
  // Empty in CI, where the checkout has no untracked files. It changes no
  // verdict — an untracked file cannot be a modification of somebody else's.
  const added = [...list('A', [CHANGESETS]), ...(head === null ? untrackedChangesets(root).filter(isDeclaration) : [])];

  return {
    modified,
    deleted,
    added: [...new Set(added)].sort(),
    changelogsTouched,
    // A release consumes the queue and writes the CHANGELOGs in one change.
    // Modifications are deliberately NOT covered by this: `changeset version`
    // deletes changesets, it never edits them, so a modification riding along
    // with a release is the same finding as any other.
    releaseConsumption: deleted.length > 0 && changelogsTouched > 0,
  };
}

/** What this gate speaks up about; release consumption is not a finding. */
export const findings = (analysis) =>
  analysis.releaseConsumption ? analysis.modified : [...analysis.modified, ...analysis.deleted];

/**
 * `0` unless enforcement is switched on AND there is something to report.
 *
 * Report-only is the DEFAULT and the shipped behaviour — see the header for the
 * measurement that chose it. Note what this does NOT gate on: an unreadable
 * input never reaches here, because the CLI exits 1 before calling it.
 */
export function verdict(analysis, { enforce = false } = {}) {
  return enforce && findings(analysis).length > 0 ? 1 : 0;
}

const describe = (entries) =>
  entries.length === 0 ? 'nothing (no frontmatter entries)' : entries.map((e) => `${e.name}: ${e.bump}`).join(', ');

// -- CLI ----------------------------------------------------------------------

if (isEntrypoint(import.meta.url)) {
  const argOf = (name) => {
    const index = process.argv.indexOf(name);
    return index > -1 ? process.argv[index + 1] : null;
  };

  // `--root` points the gate at another checkout — a worktree, or one of the
  // throwaway repositories `check-changeset-overwrite.test.ts` builds to
  // exercise these exit codes end to end. `--base` / `--head` name the two
  // commits; both default to "this branch against its merge base with the
  // target branch", reading the working tree as the head side.
  const root = resolve(argOf('--root') ?? resolve(scriptDir, '..'));
  const head = argOf('--head');
  const enforce = process.env.OS_CHANGESET_OVERWRITE_ENFORCE === '1';

  const base = resolveBaseRef(root, { explicit: argOf('--base') });
  if (!base.ok) {
    console.error(
      '❌  Cannot resolve the commit to compare against, so there is nothing to diff.\n' +
        `    tried: ${base.tried.join(', ')}\n` +
        (base.named
          ? '    That base was named EXPLICITLY, so it is not guessed around: comparing against\n' +
            '    some other commit would answer a question nobody asked, and answer it\n' +
            '    confidently. Name a commit that exists in this clone, or pass none.\n'
          : base.shallow
            ? '    This clone is SHALLOW. In CI, give the checkout `fetch-depth: 0`; locally,\n' +
              '    run `git fetch --no-tags origin main` (or `git fetch --unshallow`).\n'
            : '    Fetch the base branch (`git fetch --no-tags origin main`) and re-run.\n') +
        '    A failure, not a skip: report-only means this gate declines to fail on its\n' +
        '    FINDINGS, never that it passes without looking (objectstack#4928, objectui#4690).',
    );
    process.exit(1);
  }

  let analysis;
  try {
    analysis = collisions(root, { base: base.ref, head });
  } catch (error) {
    console.error(
      `❌  ${error.message}\n\n` +
        '    Reported as a failure rather than a pass: losing an input means this gate\n' +
        '    cannot tell whether anything was overwritten (objectui#4690).',
    );
    process.exit(1);
  }

  console.log(
    `Compared ${head ?? 'the working tree'} with ${base.ref.slice(0, 9)} (${base.how}): ` +
      `${analysis.added.length} changeset(s) added, ${analysis.modified.length} modified, ` +
      `${analysis.deleted.length} deleted.`,
  );

  if (analysis.releaseConsumption) {
    console.log(
      `✅  Release consumption: ${analysis.deleted.length} changeset(s) deleted alongside ` +
        `${analysis.changelogsTouched} package CHANGELOG.md update(s). That is how the queue is ` +
        'emptied at release time, not a collision.',
    );
  }

  const reported = findings(analysis);
  if (reported.length === 0) {
    console.log('✅  No pre-existing changeset was modified or deleted.');
    process.exit(0);
  }

  const say = enforce ? console.error : console.log;

  say(
    `\n${enforce ? '❌' : '⚠️'}  This change touches ${reported.length} changeset(s) it did not add — ` +
      `they already existed at ${base.ref.slice(0, 9)}:\n`,
  );
  for (const hit of reported) {
    say(`      ${analysis.deleted.includes(hit) ? 'D' : 'M'}  ${hit.file}`);
    say(`             declared at base: ${describe(hit.before)}`);
    say(`             declares now:     ${describe(hit.after)}`);
    if (hit.lost.length > 0) say(`         ⚠️  GONE from the declaration: ${hit.lost.join(', ')}`);
  }

  say(`
    A changeset is APPEND-ONLY by nature: written once, consumed by the release. A
    change that edits or removes one it did not add is usually one of three things.

      1. You picked a FILENAME THAT ALREADY EXISTED and wrote over somebody else's
         declaration (objectui#6336). This is the one that costs a THIRD PARTY a
         release: their packages silently do not bump, and nothing downstream says
         so. \`git status\` shows \` M\`, not \`??\`, so it reads like your own new file
         landing. If the "declared at base" line above names packages your change
         has nothing to do with, this is what happened — restore the file with
         \`git checkout ${base.ref.slice(0, 9)} -- <path>\` and write yours under a
         name that cannot collide.

      2. You are CORRECTING a declaration on purpose — a bump level after review, a
         wrong package name, prose that no longer matches the change. Legitimate,
         and the reason this gate reports instead of failing.

      3. You are SUPERSEDING one with a replacement added in the same change.
         Legitimate.

    ⭐ Name a changeset after the issue it settles — \`.changeset/<issue>-<slug>.md\` —
    and case 1 cannot happen. That is the convention this repository already
    follows; the \`adjective-animal-verb\` names come from \`pnpm changeset\`, which
    allocates them against the files already present, and hand-picking one does not.

    Report-only: this gate does not fail the build on the findings above. See the
    header of scripts/check-changeset-overwrite.mjs for the measurement behind that,
    and for OS_CHANGESET_OVERWRITE_ENFORCE.`);

  process.exit(verdict(analysis, { enforce }));
}
