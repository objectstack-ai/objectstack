#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `merge=os-regen` — the merge driver for generator-owned artifacts (#4675).
 *
 * ## The problem
 *
 * `packages/spec`'s checked-in artifacts are sorted arrays and append-only
 * ledgers. Two PRs each adding a few lines is a set union, semantically
 * composable — but git sees a text conflict. Measured on one afternoon
 * (2026-08-02): four merges, nine conflicts across those files, and NOT ONE of
 * them was a real semantic conflict. Every correct resolution was the same
 * three steps: throw away both sides, re-run the generator, re-run the gates —
 * a dozen-plus minutes each, on a `main` moving fast enough that the rerun could
 * itself go stale.
 *
 * ## Why this driver does not regenerate
 *
 * The obvious implementation — "on conflict, run the generator" — is wrong, and
 * measurably so. Git invokes merge drivers **while** it is merging, in index
 * order, and the worktree still holds the pre-merge sources at that moment.
 * `packages/spec/spec-changes.json` sorts before `packages/spec/src/...`
 * (`'p' < 'r'`), so a driver that shelled out to `gen:spec-changes` would read a
 * `src/migrations/registry.ts` with the incoming side's retirements MISSING and
 * write a confidently wrong artifact. Verified directly:
 *
 *     driver invoked for packages/spec/spec-changes.json
 *     worktree src/registry.ts at that moment:  <ours only — theirs not merged>
 *
 * That is worse than the conflict it replaces. A conflict marker is a visible
 * error; a plausible-looking generated file is an invisible one, and this repo
 * already has the scar: on #4687 a `gen:api-surface` run against an incomplete
 * `dist` silently dropped an unrelated `./studio` export and ratcheted a
 * baseline exemption in to cover the hole. Nothing failed. It was caught by
 * diffing generated files against `main`.
 *
 * ## What it does instead
 *
 * Defer. The driver resolves the path (no text merge, no markers, exit 0) and
 * records it in `$GIT_DIR/os-regen-pending`. Regeneration happens later, from
 * the fully-merged tree — the only state in which it is correct — and the
 * `pre-commit` hook refuses the commit until it has. So the rework disappears
 * without the artifact's currency ever resting on someone remembering.
 *
 * The content left behind is OURS, chosen only because git pre-fills it there.
 * It is a placeholder, not an answer: correctness comes from the mandatory
 * regeneration, and three independent things enforce it — the pending marker,
 * the `pre-commit` hook, and the `check:*` gates that already run on every PR.
 *
 * ## Usage
 *
 *   node scripts/git-merge-regen.mjs %O %A %B %P   # invoked by git, never by hand
 *   node scripts/git-merge-regen.mjs --self-test   # reconcile + end-to-end merge proof
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_OWNER,
  DRIVER_NAME,
  GIT_SETTINGS,
  NOT_DRIVER_MANAGED,
  PENDING_MARKER,
  REGEN_ARTIFACTS,
  ROOT_OWNER,
  entryForPath,
  ownerDir,
  ownerOf,
  ownerRunCommand,
} from './regen-artifacts.mjs';
import { blankAnchorLineNumbers } from './doc-line-anchors.mjs';
import { workspacePackages } from './workspace-enumerator.mjs';

/**
 * The comparators a row's `mixed` field may name (#14064).
 *
 * A comparator answers ONE question: *given two revisions of this file, is their
 * difference confined to the half the generator re-derives?* When it is, dropping
 * either revision loses nothing — which is the entire premise of deferring. When it
 * is not, the difference includes hand-written text that no `gen:` can restore, and
 * a deferral would delete it silently.
 *
 * Keyed by name rather than by function so the TABLE stays free of imports and
 * top-level statements (the shape `check:entry-guard` relies on), and so an
 * unrecognised name is a loud refusal here instead of a silent `undefined` there.
 */
const MIXED_COMPARATORS = Object.freeze({
  /**
   * Equal modulo `file:line` anchor numbers. The generated half of
   * `content/docs/permissions/system-context.mdx` is exactly those numbers:
   * `check-system-context-census.mjs --fix` rewrites them and touches nothing else.
   */
  'line-anchors': blankAnchorLineNumbers,
});

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function gitDir(cwd = process.cwd()) {
  // In a linked worktree this resolves to `.git/worktrees/<name>`, which is what
  // we want: the marker is per-worktree, so parallel agents never see each
  // other's pending regenerations.
  return execFileSync('git', ['rev-parse', '--absolute-git-dir'], { cwd, encoding: 'utf8' }).trim();
}

/** Record `path` as needing regeneration. Idempotent — a path is listed once. */
function markPending(path, cwd = process.cwd()) {
  const marker = join(gitDir(cwd), PENDING_MARKER);
  const existing = existsSync(marker) ? readFileSync(marker, 'utf8').split('\n').filter(Boolean) : [];
  if (existing.includes(path)) return marker;
  appendFileSync(marker, `${path}\n`);
  return marker;
}

/** Read a merge input, or `null` when git supplied nothing for that side. */
function readSide(file) {
  if (!file || !existsSync(file)) return null;
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/**
 * For a MIXED row: would deferring — keeping OURS whole and dropping THEIRS whole —
 * lose anything a later regeneration cannot restore? (#14064)
 *
 * Two shapes are lossless, and they are the ones the comparator can PROVE:
 *
 *   1. THEIRS differs from the ANCESTOR only in the generated half. Then theirs
 *      contributes nothing but numbers `--fix` will re-derive from the merged tree,
 *      and dropping it drops nothing. This is the common case by a wide margin —
 *      24 of the last 25 main commits to `system-context.mdx`.
 *   2. THEIRS and OURS agree once the generated half is blanked. Then whatever
 *      hand-written change theirs carries, ours carries too, so keeping ours keeps
 *      it. (Two branches landing the same doc edit, or one rebased onto the other.)
 *
 * Everything else — including every case where a side is missing or unreadable — is
 * reported unsafe. ⛔ The default must be unsafe rather than safe: the failure this
 * exists to stop is invisible (exit 0, no markers, gates green over deleted prose),
 * so an unreadable input has to become a conflict a human sees, never a deferral
 * nobody does.
 *
 * @returns {{ safe: true, why: string } | { safe: false, why: string }}
 */
function deferralIsLossless(entry, ancestorFile, oursFile, theirsFile) {
  const normalize = MIXED_COMPARATORS[entry.mixed];
  if (!normalize) {
    return {
      safe: false,
      why: `\`mixed: '${entry.mixed}'\` names no comparator in git-merge-regen.mjs`
        + ` (known: ${Object.keys(MIXED_COMPARATORS).join(', ') || 'none'})`,
    };
  }
  const ours = readSide(oursFile);
  const theirs = readSide(theirsFile);
  if (ours === null || theirs === null) {
    return { safe: false, why: 'one side of the merge could not be read, so nothing can be proven about it' };
  }
  const nTheirs = normalize(theirs);
  const ancestor = readSide(ancestorFile);
  if (ancestor !== null && nTheirs === normalize(ancestor)) {
    return { safe: true, why: 'the incoming side changed nothing but the generated half' };
  }
  if (nTheirs === normalize(ours)) {
    return { safe: true, why: 'both sides carry the same hand-written text; only the generated half differs' };
  }
  return { safe: false, why: 'the incoming side carries hand-written changes that no regeneration can restore' };
}

/**
 * The MIXED path's answer when deferral would lose prose: give the file a REAL text
 * merge instead of dropping a side (#14064).
 *
 * `git merge-file` writes its result into `%A`, which is also git's output file, so
 * a clean merge leaves the union of both sides' prose on disk and the deferral's
 * only remaining job — re-deriving the generated half from the merged tree — is
 * still done by the mandatory regeneration. That is exactly the resolution a human
 * performed by hand on the merge that found this defect, and it is why this limb
 * can succeed rather than merely fail loudly.
 *
 * A conflicting text merge leaves markers and returns non-zero, which is the right
 * outcome for "two people edited the same prose": loud, and addressed to someone who
 * can actually adjudicate it.
 *
 * @returns {boolean} true when the text merge was clean
 */
function textMergeInPlace(ancestorFile, oursFile, theirsFile) {
  try {
    execFileSync('git', ['merge-file', '-L', 'ours', '-L', 'base', '-L', 'theirs', oursFile, ancestorFile, theirsFile], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

function drive(argv) {
  // %O %A %B %P — ancestor, ours (also the OUTPUT file), theirs, pathname.
  const path = argv[3];
  if (!path) {
    console.error('git-merge-regen: no %P pathname — check the `merge.os-regen.driver` config.');
    return 1;
  }

  const entry = entryForPath(path);
  if (!entry) {
    // `.gitattributes` routed a path here that the table does not own. Refusing
    // is the only safe answer: resolving it would silently keep one side of a
    // file nobody proved is regenerable.
    console.error(
      `git-merge-regen: ${path} is mapped to merge=os-regen but is absent from scripts/regen-artifacts.mjs.\n`
        + '  Leaving it CONFLICTED rather than guessing. Run `node scripts/git-merge-regen.mjs --self-test`.',
    );
    return 1;
  }

  // ⭐ A MIXED row (#14064) is only deferrable for the merges where the side being
  // dropped carried nothing but the generated half. The unconditional deferral
  // below is correct for every wholly-generated row and is a silent deletion here.
  if (entry.mixed) {
    const verdict = deferralIsLossless(entry, argv[0], argv[1], argv[2]);
    if (!verdict.safe) {
      const clean = textMergeInPlace(argv[0], argv[1], argv[2]);
      if (!clean) {
        console.error(
          `  ⚠ ${path}\n`
            + `     NOT deferred: ${verdict.why}.\n`
            + '     This file is MIXED — a generated half plus hand-written prose — so keeping one\n'
            + '     side whole would delete the other side\'s prose with no conflict and no red gate.\n'
            + '     Text-merged instead, and it CONFLICTS. Resolve the prose by hand; the anchor\n'
            + `     numbers do not matter here — take either side and then run:\n`
            + `       ${ownerRunCommand(ownerOf(entry), entry.gen)}\n`
            + '     which re-derives them from the merged tree.',
        );
        return 1;
      }
      markPending(path);
      console.error(
        `  ⟳ ${path}\n`
          + `     NOT deferred: ${verdict.why}.\n`
          + '     This file is MIXED, so it was TEXT-MERGED (cleanly — both sides\' prose is in the\n'
          + '     result) rather than resolved to one side. The generated half still needs:\n'
          + `       ${ownerRunCommand(ownerOf(entry), entry.gen)}\n`
          + '     The pre-commit hook will not let this commit through until you do.',
      );
      return 0;
    }
  }

  markPending(path);

  const dist = entry.readsDist
    ? '\n     (this one is built from dist/*.d.ts — the regeneration will refuse on a stale build)'
    : '';
  // The json-schema/ tree is gitignored, so a merge never carries it: whatever is
  // on disk describes one side of the merge. Name the prerequisite here rather
  // than let the reader discover it from the generator's refusal (#4723).
  const tree = entry.readsSchemaTree
    ? '\n     (this one renders from the gitignored packages/spec/json-schema/ tree —'
      + '\n      run `pnpm --filter @objectstack/spec gen:schema` first, or it will refuse)'
    : '';
  console.error(
    `  ⟳ ${path}\n`
      + `     not text-merged — it is generated. Regenerate from the merged tree:\n`
      + `       ${ownerRunCommand(ownerOf(entry), entry.gen)}${dist}${tree}\n`
      + `     The pre-commit hook will not let this commit through until you do.`,
  );
  return 0;
}

/* ------------------------------------------------------------------ self-test */

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exitCode = 1;
  return false;
}

/** `.gitattributes` and the table must name the same paths — in both directions. */
function reconcileAttributes() {
  const file = join(REPO_ROOT, '.gitattributes');
  if (!existsSync(file)) return fail('.gitattributes is missing — the driver is mapped to nothing.');
  const mapped = readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .filter((l) => /\bmerge=os-regen\b/.test(l))
    .map((l) => l.trim().split(/\s+/)[0]);

  const declared = REGEN_ARTIFACTS.map((e) => e.path);
  const missing = declared.filter((p) => !mapped.includes(p));
  const extra = mapped.filter((p) => !declared.includes(p));
  let ok = true;
  if (missing.length) {
    ok = fail(`declared in regen-artifacts.mjs but not mapped in .gitattributes: ${missing.join(', ')}\n`
      + '  Those paths still text-merge — the table says otherwise.');
  }
  if (extra.length) {
    ok = fail(`mapped to merge=os-regen but not declared in regen-artifacts.mjs: ${extra.join(', ')}\n`
      + '  The driver refuses unknown paths, so those merges would CONFLICT with no explanation.');
  }
  // A path cannot be both driver-managed and deliberately excluded.
  const overlap = NOT_DRIVER_MANAGED.map((e) => e.path).filter((p) => declared.includes(p));
  if (overlap.length) ok = fail(`listed as BOTH driver-managed and NOT_DRIVER_MANAGED: ${overlap.join(', ')}`);
  if (ok) console.log(`✓ .gitattributes ↔ regen-artifacts.mjs agree on ${declared.length} path(s)`);
  return ok;
}

/** Where an owner's manifest lives, repo-relative, given a resolved directory. */
function manifestFor(dir) {
  return dir === '.' ? 'package.json' : `${dir}/package.json`;
}

/**
 * Every `gen:`/`check:` the table names must still exist **in the manifest of the
 * row's declared owner**, or the driver's advice is a dead command.
 *
 * Resolution read `packages/spec/package.json` and nothing else until #13585, which
 * made a root-owned artifact unregisterable and said so in a way that pointed at the
 * wrong repair — "you named a script that does not exist" when the truth was "this
 * artifact is not owned by packages/spec". Two things follow from that, and the
 * second is the one worth guarding:
 *
 *   - resolution reads the owner's manifest, whichever that is; and
 *   - the refusal NAMES the manifests it searched, so the reader can see that the
 *     lookup went somewhere else rather than conclude the script is missing.
 *
 * It stays exact in the direction that matters. A name is looked for in ONE
 * manifest — the declared owner's — never in "any manifest that has it", so a row
 * that names a root-only script while claiming a package owner still fails, and the
 * command the driver prints for it is the command the `pre-commit` gate spawns.
 */
function reconcileScripts() {
  const workspace = workspacePackages(REPO_ROOT);
  const byOwner = new Map();
  for (const e of REGEN_ARTIFACTS) {
    const owner = ownerOf(e);
    if (!byOwner.has(owner)) byOwner.set(owner, []);
    byOwner.get(owner).push(e);
  }

  const dead = [];
  const unresolved = [];
  const searched = [];
  for (const [owner, entries] of byOwner) {
    const dir = ownerDir(owner, workspace);
    const file = dir === null ? null : join(REPO_ROOT, manifestFor(dir));
    if (file === null || !existsSync(file)) {
      unresolved.push(`${owner} — declared by ${entries.map((e) => e.path).join(', ')}`);
      continue;
    }
    searched.push(`${owner} (${manifestFor(dir)})`);
    const scripts = JSON.parse(readFileSync(file, 'utf8')).scripts ?? {};
    for (const e of entries) {
      for (const name of [e.gen, e.check]) {
        if (!scripts[name]) dead.push(`${e.path} → ${name}   [owner ${owner}, ${manifestFor(dir)}]`);
      }
    }
  }

  if (unresolved.length) {
    return fail(`owner(s) named by the table resolve to no manifest:\n  ${unresolved.join('\n  ')}\n`
      + '  An owner is a workspace package name, or ROOT_OWNER for the root manifest.\n'
      + '  Unresolved is a REFUSAL, not a skip: those rows\' scripts were never verified.');
  }
  if (dead.length) {
    return fail(`script(s) named by the table do not exist in their declared owner:\n  ${dead.join('\n  ')}\n`
      + `  Manifests searched: ${searched.join(', ')}\n`
      + `  A row that declares no \`owner\` defaults to ${DEFAULT_OWNER}, so this can mean the row is\n`
      + '  in the wrong package rather than that the script is gone. If ROOT tooling owns the\n'
      + '  artifact, declare it — `owner: ROOT_OWNER` in scripts/regen-artifacts.mjs. ⛔ Do NOT move\n'
      + '  the scripts into a package to satisfy the lookup: that lets this tool decide code ownership.');
  }
  console.log(`✓ all ${REGEN_ARTIFACTS.length * 2} gen:/check: names resolve in their declared owner`
    + ` (${searched.join(', ')})`);
  return true;
}

/**
 * The owner-resolution rule itself, pinned — the half a live tree cannot show.
 *
 * `reconcileScripts` above is green on this tree for the same reason it was green
 * before #13585: every row is spec-owned, so it exercises exactly one manifest and
 * would keep passing if the loosening were reverted. These cases read the REAL root
 * manifest through the same functions the driver and the `pre-commit` gate use, so
 * the root path is measured on every run rather than the first time somebody
 * registers a root-owned artifact.
 *
 * The two-way case is the third one. A permissive lookup — "resolve the name in any
 * manifest" — passes every other assertion here and fails that one, which is the
 * whole difference between a resolution and a search.
 */
/**
 * ⭐ The third reconciliation (#13731): every GENERATOR must have a recorded
 * disposition, not merely every declared path.
 *
 * ## What was invisible, and why the two reconciliations above could not see it
 *
 * `reconcileAttributes` holds `.gitattributes` equal to `REGEN_ARTIFACTS`, and
 * `reconcileScripts` holds every declared name to its owner's manifest. Both are
 * exact, both were green — and both are closed over the paths somebody already
 * declared. An artifact in NEITHER ledger is not a disagreement between them; it
 * is absent from both, so the gate returned green while saying nothing about it.
 * That is this repo's recurring shape (an instrument reporting green where it
 * cannot see) and the price was paid twice by hand: #13646 and #13335 were each
 * discovered by hitting a merge conflict, on unrelated PRs.
 *
 * ## The population, and the one thing it cannot see
 *
 * A generator-ish script is a manifest `scripts` key spelled `gen:*`, or one whose
 * command carries a `--fix` / `--update` mode — #13731's definition, reproduced
 * here so the count is the card's count. It is enumerated from the manifests
 * themselves (78 workspace members plus the root), never from a hand-kept list, so
 * generator number 12 enters this population by existing.
 *
 * ⚠️ Its bound, stated because a bound nobody wrote down is a bound nobody checks:
 * a generator that NO manifest script names is invisible here. `scripts/*.mjs`
 * invoked directly by a workflow is the shape this misses; that population belongs
 * to `check:ratchet-remedy-authority`, which builds its own from `readdirSync`.
 * This gate answers "is every generator the manifests declare accounted for", and
 * that is the question the two ledgers are keyed to.
 *
 * The `--fix`/`--update` limb currently adds ZERO members beyond the `gen:*` keys
 * (measured on this tree: all 21 members carry a `gen:` key). It is kept because it
 * fails CLOSED — a future generator spelled `fix:foo` still lands here — and its
 * false-positive class is bounded and cheap: a transform that rewrites hand-written
 * source (`eslint --fix` and friends) would be caught and costs one ledger line
 * saying it writes nothing generated. A gate that asks for one line is not a noisy
 * gate; a silent gap that costs a merge conflict is the alternative being priced.
 *
 * ## Accounting is per (owner, script), never per bare name
 *
 * `gen:test-typecheck-debt` is defined in THREE manifests and writes three separate
 * ledgers. Keyed by name alone, declaring the `packages/spec` copy would have
 * accounted for the `client` and `rest` copies too — and those two were 2 of the 11
 * gaps this gate exists to find, so a name-keyed version of this check would have
 * been born unable to see its own motivating case.
 */
function reconcileGenerators() {
  const workspace = workspacePackages(REPO_ROOT);
  const manifests = [
    { dir: '.', manifest: JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) },
    ...workspace,
  ];

  const key = (owner, script) => `${owner} :: ${script}`;

  // Everything the two ledgers account for, with the owner as part of the key.
  const accounted = new Map();
  for (const e of REGEN_ARTIFACTS) {
    for (const name of [e.gen, ...(e.alsoWrittenBy ?? [])]) {
      accounted.set(key(ownerOf(e), name), `driver-managed: ${e.path}`);
    }
  }
  for (const e of NOT_DRIVER_MANAGED) {
    if (!e.gen) continue;
    accounted.set(key(ownerOf(e), e.gen), `NOT_DRIVER_MANAGED: ${e.path}`);
  }

  const population = [];
  for (const p of manifests) {
    const owner = p?.manifest?.name;
    if (!owner) continue;
    for (const [name, cmd] of Object.entries(p.manifest.scripts ?? {})) {
      const generatorish = name.startsWith('gen:') || /(^|\s)--(fix|update)(\s|$|=)/.test(String(cmd));
      if (generatorish) population.push({ owner, name });
    }
  }

  const unaccounted = population.filter((g) => !accounted.has(key(g.owner, g.name)));
  // Two-way, for the same reason `reconcileScripts` is: a disposition naming a
  // generator that no longer exists is a reason nobody can act on, and it makes the
  // ledger read as covering a case the tree dropped.
  const live = new Set(population.map((g) => key(g.owner, g.name)));
  const dead = [...accounted.keys()].filter((k) => !live.has(k));

  let ok = true;
  if (unaccounted.length) {
    ok = fail(`generator(s) with NO recorded merge disposition:\n  ${unaccounted
      .map((g) => `${g.name}   [${g.owner}]`).join('\n  ')}\n`
      + '  Every generator must be in ONE of the two ledgers in scripts/regen-artifacts.mjs.\n'
      + '  ⛔ Routing it is NOT the default answer. Ask the question this file exists to ask:\n'
      + '     would "discard both sides and re-run the generator" ever lose a decision a human\n'
      + '     made? If yes — a hand-written region, a shrink-only ratchet, a vendored record —\n'
      + '     add a NOT_DRIVER_MANAGED entry with `gen` and a per-path `why`. If no, add a\n'
      + '     REGEN_ARTIFACTS row AND the matching .gitattributes line (both, in one commit).\n'
      + '  ⚠️ And routing is LOCAL: it never protects a path in the merge queue. If the real\n'
      + '     problem is queue eviction, say so in the reason — sharding is the precedent.');
  }
  if (dead.length) {
    ok = fail(`disposition(s) naming a generator that no manifest defines:\n  ${dead.join('\n  ')}\n`
      + '  The script was renamed or removed; the recorded reason now covers nothing.');
  }
  if (ok) {
    console.log(`✓ all ${population.length} generator(s) across ${manifests.length} manifest(s)`
      + ' have a recorded disposition');
  }
  return ok;
}

/**
 * The `untracked: true` dispositions, held against git rather than against their own
 * prose (#13731).
 *
 * "git never merges it" is a legitimate answer to this ledger's question and an
 * expiring one: the day somebody commits `sbom.json`, the recorded reason becomes
 * false and the path silently rejoins the population with a disposition that reads
 * as settled. Asserting it here means that day reddens a gate instead of surfacing,
 * later, as the merge conflict this whole file exists to pre-empt.
 */
function reconcileUntrackedDispositions() {
  const claims = NOT_DRIVER_MANAGED.filter((e) => e.untracked);
  const wrong = [];
  for (const e of claims) {
    const spec = e.path.endsWith('/**') ? e.path.slice(0, -3) : e.path;
    const tracked = execFileSync('git', ['ls-files', '--', spec], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    }).trim();
    if (tracked) wrong.push(`${e.path} — declared untracked, but git tracks ${tracked.split('\n').length} file(s)`);
  }
  if (wrong.length) {
    return fail(`untracked disposition(s) no longer true:\n  ${wrong.join('\n  ')}\n`
      + '  The reason recorded for these paths was "git never merges it". It does now.\n'
      + '  Replace the entry with a real disposition: route it, or say why a text merge is right.');
  }
  console.log(`✓ ${claims.length} untracked disposition(s) still hold — git tracks none of those paths`);
  return true;
}

/**
 * `entryForPath` and GIT must read a declared path the same way (#13731).
 *
 * The table path and the `.gitattributes` pattern are the same string, so a
 * divergence in what that string MEANS is invisible to `reconcileAttributes` — it
 * compares bytes, and the bytes agree. The failure it lets through is specific and
 * bad: git routes a real file to the driver, `entryForPath` fails to resolve it, and
 * the driver REFUSES with a message blaming a missing table row that is right there.
 * Discovered at merge time, on a path whose whole purpose was to make merges cheaper.
 *
 * Measured against `git check-attr` — git's own answer, not a second implementation
 * of it — over the tracked files the table claims. A row matching NOTHING is a
 * failure too: it is either a typo or an artifact that left the tree, and both read
 * as "covered" until someone looks.
 */
function reconcileAttributeSemantics() {
  const tracked = execFileSync('git', ['ls-files', '-z'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  }).split('\u0000').filter(Boolean);

  const attrs = execFileSync('git', ['check-attr', '-z', 'merge', '--stdin'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    input: tracked.map((t) => t + '\u0000').join(''),
    maxBuffer: 64 * 1024 * 1024,
  }).split('\u0000');

  // `-z` output is a flat stream of (path, attr, value) triples.
  const gitSays = new Set();
  for (let i = 0; i + 2 < attrs.length; i += 3) {
    if (attrs[i + 1] === 'merge' && attrs[i + 2] === DRIVER_NAME) gitSays.add(attrs[i]);
  }

  const tableSays = new Set(tracked.filter((p) => entryForPath(p)));
  const gitOnly = [...gitSays].filter((p) => !tableSays.has(p));
  const tableOnly = [...tableSays].filter((p) => !gitSays.has(p));

  let ok = true;
  if (gitOnly.length) {
    ok = fail(`git routes these to merge=${DRIVER_NAME} but entryForPath does not resolve them:\n  `
      + `${gitOnly.slice(0, 20).join('\n  ')}\n`
      + '  The driver would REFUSE them mid-merge, blaming an absent table row that is present.\n'
      + '  entryForPath understands `a/b/**` and one `*` segment — teach it the form, or\n'
      + '  respell the path in BOTH files.');
  }
  if (tableOnly.length) {
    ok = fail(`entryForPath claims these but git does not route them:\n  `
      + `${tableOnly.slice(0, 20).join('\n  ')}\n`
      + '  Those files text-merge today while the table reads as covering them.');
  }
  // A row that matches nothing is not "covered", it is unmeasured.
  const empty = REGEN_ARTIFACTS
    .filter((e) => !tracked.some((p) => entryForPath(p)?.path === e.path))
    .map((e) => e.path);
  if (empty.length) {
    ok = fail(`declared path(s) matching no tracked file: ${empty.join(', ')}\n`
      + '  A typo, or the artifact left the tree. Either way nothing here is being protected.');
  }
  if (ok) {
    console.log(`✓ entryForPath agrees with git check-attr on all ${gitSays.size} routed file(s)`);
  }
  return ok;
}

function reconcileOwnership() {
  const workspace = workspacePackages(REPO_ROOT);
  const rootScripts = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
  const specDir = ownerDir(DEFAULT_OWNER, workspace);
  const specScripts = specDir === null
    ? {}
    : JSON.parse(readFileSync(join(REPO_ROOT, manifestFor(specDir)), 'utf8')).scripts ?? {};
  // A name this repo defines at the ROOT and nowhere else. Asserted, not assumed:
  // if it ever moves into a package, the assertion below says so instead of quietly
  // testing nothing.
  const rootOnly = 'check:merge-driver';

  const cases = [
    ['ROOT_OWNER is the root manifest\'s own name', rootScripts.name === ROOT_OWNER],
    ['the root manifest resolves to the repo root', ownerDir(ROOT_OWNER, workspace) === '.'],
    [`${DEFAULT_OWNER} resolves to a workspace directory`, specDir !== null && specDir !== '.'],
    ['a row with no owner defaults to DEFAULT_OWNER', ownerOf({ path: 'x' }) === DEFAULT_OWNER],
    ['a declared owner is used verbatim', ownerOf({ owner: ROOT_OWNER }) === ROOT_OWNER],
    [`${rootOnly} exists in the root manifest`, Boolean(rootScripts.scripts?.[rootOnly])],
    // ⭐ The two-way case: resolution is per-owner, not "wherever the name turns up".
    [`${rootOnly} is NOT resolvable under ${DEFAULT_OWNER}`, !specScripts[rootOnly]],
    ['an unknown owner refuses rather than skipping', ownerDir('@objectstack/not-a-package', workspace) === null],
    ['the root command takes no --filter', ownerRunCommand(ROOT_OWNER, 'gen:x') === 'pnpm gen:x'],
    [
      'a package command filters to its owner',
      ownerRunCommand(DEFAULT_OWNER, 'gen:x') === `pnpm --filter ${DEFAULT_OWNER} gen:x`,
    ],
    ['a spawn asks for silence', ownerRunCommand(ROOT_OWNER, 'check:x', { silent: true }) === 'pnpm -s check:x'],
  ];

  const failures = cases.filter(([, ok]) => !ok).map(([name]) => name);
  if (failures.length) return fail(`owner resolution:\n  ${failures.join('\n  ')}`);
  console.log(`✓ owner resolution: ${cases.length} case(s) pinned, root manifest read as ${ROOT_OWNER}`);
  return true;
}

/**
 * The hook must be executable **in the index**, not just on this disk. Git
 * silently ignores a non-executable hook — it prints an `advice.ignoredHook`
 * hint and proceeds, so the deferred regeneration stops being mandatory and
 * nothing fails. Caught exactly that way while testing this change: both e2e
 * commits went through with the hook installed and inert.
 */
function hookIsExecutable() {
  try {
    const mode = execFileSync('git', ['ls-files', '-s', '.githooks/pre-commit'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    }).trim().split(/\s+/)[0];
    if (mode !== '100755') {
      return fail(`.githooks/pre-commit is mode ${mode || '<untracked>'} in the index, not 100755.\n`
        + '  Git IGNORES a non-executable hook — the pre-commit half is disarmed and says nothing.\n'
        + '  Fix: git update-index --chmod=+x .githooks/pre-commit');
    }
    console.log('✓ .githooks/pre-commit is executable in the index (100755)');
    return true;
  } catch (err) {
    return fail(`could not stat .githooks/pre-commit: ${err?.message ?? err}`);
  }
}

/**
 * The driver registered in THIS clone must resolve — here, now (#4868).
 *
 * Every other check in this self-test builds a throwaway repo and registers its own
 * driver into it, so all of them stayed green for weeks while the real
 * `merge.os-regen.driver` in the shared `.git/config` pointed at a DELETED worktree
 * and every real merge of a `merge=os-regen` path died with MODULE_NOT_FOUND. The
 * self-test and the live merge path were simply not the same path. This check reads
 * the live one, which is the only reason it can catch that class of failure.
 *
 * It fails in three distinguishable ways, all of which have happened or are one
 * `pnpm install` away:
 *   - the script the value names does not exist (the dangling-worktree bug);
 *   - it exists but lives outside this worktree (bound to someone else's worktree —
 *     green for whoever installed last, broken for everyone else, so this is the
 *     check that catches the bug *before* the other worktree is removed);
 *   - the value has drifted from what `setup-git-hooks.mjs` registers.
 */
function registeredDriverResolves() {
  const { key, value: expected } = GIT_SETTINGS.find((s) => s.key === `merge.${DRIVER_NAME}.driver`);

  let actual = '';
  try {
    actual = execFileSync('git', ['config', '--get', key], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    actual = ''; // unset — `git config --get` exits 1
  }

  if (!actual) {
    // A supported state, not a failure: git falls back to a text merge, which is
    // exactly the pre-#4675 behaviour. `pnpm install` registers it.
    console.log(`✓ ${key} is unregistered — merges text-merge as they did before #4675`);
    return true;
  }

  const expansion = expandDriverScript(actual);
  if (expansion.skip) {
    console.log(`✓ ${key} not checked for resolution (${expansion.skip})`);
    return true;
  }
  if (expansion.error) return fail(`could not expand ${key} ("${actual}"): ${expansion.error}`);

  const script = expansion.path;
  if (!existsSync(script)) {
    return fail(`${key} names a script that does not exist:\n`
      + `    ${script}\n`
      + `  Registered value: ${actual}\n`
      + '  Every merge touching a merge=os-regen path in this clone dies with MODULE_NOT_FOUND,\n'
      + '  and git leaves the path CONFLICTED with ours in it and no conflict markers.\n'
      + '  Fix: pnpm install  (re-registers the driver for this worktree)');
  }

  const root = realpath(REPO_ROOT);
  if (relative(root, realpath(script)).startsWith('..')) {
    return fail(`${key} points OUTSIDE this worktree:\n`
      + `    ${script}\n`
      + `  Linked worktrees share one .git/config, so this is bound to another worktree and\n`
      + '  breaks for everyone the moment that one is removed.\n'
      + '  Fix: pnpm install  (re-registers the driver for this worktree)');
  }

  if (actual !== expected) {
    return fail(`${key} has drifted from what setup-git-hooks.mjs registers.\n`
      + `    registered: ${actual}\n`
      + `    expected:   ${expected}\n`
      + '  Fix: pnpm install');
  }

  console.log(`✓ merge.${DRIVER_NAME}.driver resolves in THIS worktree (${relative(root, realpath(script))})`);
  return true;
}

/**
 * Expand the driver value's script path the way git will: git hands a merge driver
 * command to a shell, so `$(git rev-parse --show-toplevel)` is only meaningful once
 * a shell has run it, from inside the worktree being merged.
 */
function expandDriverScript(value) {
  // Drop the trailing %O %A %B %P placeholders; what remains is `node <script>`.
  const command = value.replace(/(\s+%[A-Za-z])+\s*$/, '');
  const expr = /^\s*node\s+(\S.*)$/.exec(command)?.[1];
  if (!expr) return { skip: `not a \`node <script>\` command: "${value}"` };
  try {
    return {
      path: execFileSync('sh', ['-c', `printf '%s' ${expr}`], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim(),
    };
  } catch (err) {
    // No POSIX shell (some Windows setups). Git could not run the driver either,
    // so there is nothing this check could assert that would still be true.
    if (err?.code === 'ENOENT') return { skip: 'no POSIX shell available to expand it' };
    return { error: err?.stderr?.toString().trim() || err?.message || String(err) };
  }
}

/** Best-effort realpath: symlinked checkouts otherwise read as "outside the worktree". */
function realpath(p) {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * Prove the driver end to end against real git: a conflicting change on both
 * sides of a mapped path must come out resolved, marker-free, and recorded.
 * Asserting the behaviour rather than the wiring is the point — the wiring
 * (`%P` order, git-dir resolution in a worktree) is exactly what silently rots.
 */
function endToEnd() {
  const dir = mkdtempSync(join(tmpdir(), 'os-regen-selftest-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    git('init', '-q', '--initial-branch=main', '.');
    git('config', 'user.email', 'selftest@objectstack.ai');
    git('config', 'user.name', 'self-test');
    git('config', 'merge.os-regen.name', 'regenerate instead of text-merging');
    // Absolute on purpose, and NOT the value we register in a real clone: this temp
    // repo is not the ObjectStack worktree, so the registered
    // `$(git rev-parse --show-toplevel)` would resolve to `dir` — which has no
    // scripts/. Here we want the driver under test, i.e. this clone's copy.
    // Checking the value real clones get is `registeredDriverResolves()`'s job (#4868).
    git('config', 'merge.os-regen.driver', `node "${join(REPO_ROOT, 'scripts/git-merge-regen.mjs')}" %O %A %B %P`);

    const target = REGEN_ARTIFACTS[0].path;
    mkdirSync(join(dir, dirname(target)), { recursive: true });
    writeFileSync(join(dir, '.gitattributes'), `${target} merge=os-regen\n`);
    writeFileSync(join(dir, target), '["base"]\n');
    git('add', '-A');
    git('commit', '-qm', 'base');

    git('checkout', '-qb', 'incoming');
    writeFileSync(join(dir, target), '["base","theirs"]\n');
    git('commit', '-qam', 'theirs');

    git('checkout', '-q', 'main');
    writeFileSync(join(dir, target), '["base","ours"]\n');
    git('commit', '-qam', 'ours');

    git('merge', 'incoming', '-m', 'merge');

    const merged = readFileSync(join(dir, target), 'utf8');
    if (/^<{7}|^={7}$|^>{7}/m.test(merged)) return fail(`self-test: conflict markers survived in ${target}`);
    if (git('status', '--porcelain').match(/^(UU|AA)/m)) return fail('self-test: path left conflicted after merge');

    const marker = join(gitDir(dir), PENDING_MARKER);
    if (!existsSync(marker)) return fail(`self-test: no pending marker written at ${marker}`);
    if (!readFileSync(marker, 'utf8').includes(target)) return fail(`self-test: ${target} absent from the pending marker`);

    console.log(`✓ end-to-end: conflicting ${target} merged without markers and recorded as pending`);
    return true;
  } catch (err) {
    return fail(`self-test: ${err?.stderr?.toString() || err?.message || err}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Every `mixed` row names a comparator that EXISTS and DISCRIMINATES (#14064).
 *
 * The second half is the one worth writing down. Resolving the name proves only
 * that a function is there; a comparator that collapsed everything to the same
 * value — `() => ''`, or one whose parser silently stopped finding anchors — would
 * report every deferral lossless and restore the exact defect this field was added
 * to close, with the driver, this reconciliation and every doc gate still green.
 * So each comparator is run against a pair it MUST call equal and a pair it MUST
 * call different, which is the firing control the "safe" verdict rests on.
 */
function reconcileMixedComparators() {
  const rows = REGEN_ARTIFACTS.filter((e) => e.mixed);
  const unknown = rows.filter((e) => !MIXED_COMPARATORS[e.mixed]);
  if (unknown.length) {
    return fail(`row(s) declare a \`mixed\` comparator that does not exist:\n  `
      + unknown.map((e) => `${e.path} → ${e.mixed}`).join('\n  ')
      + `\n  Known comparators: ${Object.keys(MIXED_COMPARATORS).join(', ')}\n`
      + '  The driver CONFLICTS on an unknown name rather than deferring, so this is red, not silent —\n'
      + '  but a routed mixed file that cannot be adjudicated is a hand-merge every time until it is fixed.');
  }

  // The controls are per comparator, not per row: they pin the comparator's
  // discrimination, which is what every row naming it depends on.
  const controls = {
    'line-anchors': {
      same: ['Prose.\n\n`pkg/src/a.ts:100` and `:205`.\n', 'Prose.\n\n`pkg/src/a.ts:117` and `:990`.\n'],
      different: ['Prose.\n\n`pkg/src/a.ts:100`.\n', 'Prose. Extra sentence.\n\n`pkg/src/a.ts:100`.\n'],
    },
  };
  for (const name of new Set(rows.map((e) => e.mixed))) {
    const control = controls[name];
    if (!control) {
      return fail(`comparator '${name}' has no firing control in reconcileMixedComparators.\n`
        + '  An unexercised comparator is one that cannot be shown to discriminate, and a comparator\n'
        + '  that does not discriminate reports every deferral safe. Add both control pairs.');
    }
    const cmp = MIXED_COMPARATORS[name];
    if (cmp(control.same[0]) !== cmp(control.same[1])) {
      return fail(`comparator '${name}' calls an anchors-only pair DIFFERENT.\n`
        + '  Every merge of a purely re-anchored file would now hand-conflict.');
    }
    if (cmp(control.different[0]) === cmp(control.different[1])) {
      return fail(`comparator '${name}' calls a prose-changing pair EQUAL.\n`
        + '  ⛔ This is the #14064 defect restored: the driver would silently drop the prose again.');
    }
  }
  console.log(`✓ ${rows.length} mixed row(s) name a comparator that exists and discriminates`
    + ` (${[...new Set(rows.map((e) => e.mixed))].join(', ')})`);
  return true;
}

/**
 * Prove BOTH limbs of the mixed-row guard against real git (#14064).
 *
 * `endToEnd` above proves the deferral; this proves the two things the deferral
 * must NOT do. Behaviour, not wiring, for the same reason: the failure being
 * guarded is a merge that exits 0 with no markers, which is indistinguishable from
 * success unless something reads the resulting bytes.
 */
function endToEndMixed() {
  const entry = REGEN_ARTIFACTS.find((e) => e.mixed);
  if (!entry) {
    console.log('✓ end-to-end (mixed): no mixed rows declared — nothing to prove');
    return true;
  }
  const target = entry.path;
  const BASE = '# Page\n\nIntro prose.\n\nThe guard is at `packages/rest/src/rest-server.ts:100`.\n';
  const OURS = '# Page\n\nIntro prose.\n\nThe guard is at `packages/rest/src/rest-server.ts:140`.\n';

  const run = (theirs, label) => {
    const dir = mkdtempSync(join(tmpdir(), 'os-regen-mixed-'));
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      git('init', '-q', '--initial-branch=main', '.');
      git('config', 'user.email', 'selftest@objectstack.ai');
      git('config', 'user.name', 'self-test');
      git('config', 'merge.os-regen.name', 'regenerate instead of text-merging');
      git('config', 'merge.os-regen.driver', `node "${join(REPO_ROOT, 'scripts/git-merge-regen.mjs')}" %O %A %B %P`);
      mkdirSync(join(dir, dirname(target)), { recursive: true });
      writeFileSync(join(dir, '.gitattributes'), `${target} merge=os-regen\n`);
      writeFileSync(join(dir, target), BASE);
      git('add', '-A');
      git('commit', '-qm', 'base');
      git('checkout', '-qb', 'incoming');
      writeFileSync(join(dir, target), theirs);
      git('commit', '-qam', 'theirs');
      git('checkout', '-q', 'main');
      writeFileSync(join(dir, target), OURS);
      git('commit', '-qam', 'ours');
      let conflicted = false;
      try {
        git('merge', 'incoming', '-m', 'merge');
      } catch {
        conflicted = true;
      }
      return { merged: readFileSync(join(dir, target), 'utf8'), conflicted, status: git('status', '--porcelain') };
    } catch (err) {
      return { error: err?.stderr?.toString() || err?.message || String(err) };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  // (1) THEIRS re-anchored only — the 24-in-25 case. Must still defer to OURS.
  const anchorsOnly = run('# Page\n\nIntro prose.\n\nThe guard is at `packages/rest/src/rest-server.ts:212`.\n', 'anchors-only');
  if (anchorsOnly.error) return fail(`self-test (mixed, anchors-only): ${anchorsOnly.error}`);
  if (anchorsOnly.conflicted) return fail('self-test (mixed): an anchors-only incoming change CONFLICTED — #13646\'s win is gone.');
  if (anchorsOnly.merged !== OURS) {
    return fail('self-test (mixed): an anchors-only incoming change was not deferred to OURS.');
  }

  // (2) THEIRS added prose. Whatever happens, that prose must not vanish silently.
  const NEEDLE = 'A paragraph only main has.';
  const withProse = run(`# Page\n\nIntro prose.\n\n${NEEDLE}\n\nThe guard is at \`packages/rest/src/rest-server.ts:100\`.\n`, 'prose');
  if (withProse.error) return fail(`self-test (mixed, prose): ${withProse.error}`);
  const kept = withProse.merged.includes(NEEDLE);
  const loud = withProse.conflicted || /^<{7}|^={7}$|^>{7}/m.test(withProse.merged) || /^(UU|AA)/m.test(withProse.status);
  if (!kept && !loud) {
    return fail('self-test (mixed): ⛔ incoming PROSE was dropped with no conflict and no marker.\n'
      + '  This is #14064 exactly — the merge exits 0, the gates stay green, the documentation is gone.');
  }
  if (!kept) {
    return fail('self-test (mixed): incoming prose is absent from a merge that could have kept it cleanly.');
  }

  console.log('✓ end-to-end (mixed): anchors-only deferred to OURS; incoming prose survived instead of being dropped');
  return true;
}

if (process.argv.includes('--self-test')) {
  console.log('git-merge-regen --self-test\n');
  const results = [
    reconcileAttributes(),
    reconcileAttributeSemantics(),
    reconcileScripts(),
    reconcileGenerators(),
    reconcileUntrackedDispositions(),
    reconcileOwnership(),
    hookIsExecutable(),
    registeredDriverResolves(),
    reconcileMixedComparators(),
    endToEnd(),
    endToEndMixed(),
  ];
  console.log(
    results.every(Boolean)
      ? `\n✓ merge driver wiring is consistent (${NOT_DRIVER_MANAGED.length} path(s) deliberately excluded).`
      : '\n✗ merge driver wiring is inconsistent — see above.',
  );
} else {
  try {
    process.exit(drive(process.argv.slice(2)));
  } catch (err) {
    // Non-zero leaves the path conflicted with OURS in it and no markers. That
    // is a degraded state a human must look at — which is the right outcome for
    // "the driver itself broke", and never a silently-wrong artifact.
    console.error(`git-merge-regen: ${err?.message ?? err}\n  Leaving the path conflicted.`);
    process.exit(1);
  }
}
