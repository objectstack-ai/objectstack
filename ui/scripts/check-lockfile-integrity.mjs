#!/usr/bin/env node
/**
 * check-lockfile-integrity -- a pull request's `pnpm-lock.yaml` may not silently
 * DUPLICATE a dependency.
 *
 *   node scripts/check-lockfile-integrity.mjs                    # head = worktree, base = merge-base with origin/main
 *   node scripts/check-lockfile-integrity.mjs --base-ref origin/main
 *   node scripts/check-lockfile-integrity.mjs --base <file> --head <file>
 *   node scripts/check-lockfile-integrity.mjs --json
 *   node scripts/check-lockfile-integrity.mjs --self-test        # offline, no git
 *
 * Exit: 0 = a reading was taken and the change is clean; 1 = FINDINGS;
 *       2 = the reading COULD NOT BE TAKEN (missing base, unparseable lockfile).
 *       2 is never a pass: nothing about the change was judged by that run.
 *
 * ## The incident (objectui#8326, corroborated on #7053, #7054, #7058)
 *
 * Dependabot's regenerated lockfile on #7058 changed 46 package identities,
 * downgrading the whole `@objectstack/*` family 17.3.0 -> 17.2.0 and forking
 * zod into 4.4.3 + 4.5.4. That split the workspace across TWO physical
 * `@objectstack/spec` copies (console / core / runner on one, app-shell /
 * components on the other). Nothing dedupes two real paths, so spec was bundled
 * twice: `vendor-objectstack` 4,030,557 -> 8,423,436 raw bytes (2.09x), the
 * `objectstack/spec` marker count 620 -> 1136.
 *
 * ⭐ The failure mode is what earns the gate, not the byte count: `Bundle
 * Analysis` reds on a dependency bump FOR A REASON THAT HAS NOTHING TO DO WITH
 * THE DEPENDENCY, and the obvious reading -- "this bump bloats the bundle" --
 * is wrong. Two seats each spent a full diagnosis reaching the same answer
 * independently. This gate exists to say that in one line.
 *
 * ⛔ It reports. It does not pin, dedupe, or re-resolve anything: the remedy for
 * a finding is a decision (re-lock from a clean base, pin, accept), and the
 * 2026-09-08 triage ruling on #8326 kept that decision out of the gate.
 *
 * ## The two causes it was built for, and the rule that is left
 *
 *   cause 1  an `@objectstack/*` identity moves BACKWARD   (objectui#8326)
 *   cause 2  a dependency gains a physical COPY            (objectui#8333)
 *
 * ⛔ RULE 1 IS RETIRED (objectui#12957). It judged cause 1 by comparing
 * `@objectstack/*` VERSIONS in the snapshot keys, base against head. Since ruling B
 * on objectui#12955 no `@objectstack/*` package resolves to a registry version:
 * each resolves to the pinned build, a `file:.objectstack-pin/<name>`
 * directory, and the lockfile records it with no version at all
 * (`'@objectstack/spec@file:.objectstack-pin/spec(ai@…)'`). So the
 * rule had nothing left to order and could never fire again. The identity it
 * guarded is now `.objectstack-sha` -- a one-line text file that merges, conflicts
 * and reviews as text, and that no re-lock can carry backward across a rebase,
 * which was #8326's whole mechanism. Whether every `@objectstack/*` package is
 * overridden to that build is refused at build time by `scripts/objectstack-pin.mjs`
 * (`checkOverrideSet`), which every installing CI job runs before `pnpm install`.
 * What is left of cause 1 is its DUPLICATION half -- the downgrade on #7058 also
 * left the workspace on two physical spec copies -- and rule 2 below reads that
 * unchanged: an `@objectstack/*` package resolving both the pinned build and a
 * registry version is two snapshot keys under one name.
 *
 * ⭐ objectui#8333 is the measured proof that cause 1 alone was blind. Floating
 * `better-auth` from 1.7.2 to 1.7.3 -- re-measured on `da5e4f69e`, 2026-09-08 --
 * moves NO `@objectstack/*` identity at all: the delta is the better-auth
 * family, `@mongodb-js/saslprep` 1.5.0->1.5.2, `seroval`(-plugins) 1.6.4->1.6.7,
 * every one of them FORWARD, plus one ADDED `zod@4.5.4`. Rule 1 was green on it.
 *
 * ⭐ And rule 2 is not "a single-copy dependency forks", which is the wording
 * both cards use. Measured on `da5e4f69e`: zod is ALREADY two copies on `main`
 * (`zod@3.25.76` + `zod@4.4.3`), so a rule keyed on "was 1, is now 2" is green
 * on #8333 too. The gate therefore compares COUNTS: head > base is a finding,
 * whatever the base count was.
 *
 * ## Why the unit of rule 2 is the SNAPSHOT key, not the version
 *
 * ⭐ Also measured on that re-resolve: `@objectstack/spec` stays at ONE version
 * (17.3.0) and still ends up as TWO physical directories --
 *
 *   base   '@objectstack/spec@17.3.0(ai@7.0.65(zod@4.4.3))'
 *   head   '@objectstack/spec@17.3.0(ai@7.0.65(zod@4.4.3))'
 *          '@objectstack/spec@17.3.0(ai@7.0.65(zod@4.5.4))'
 *
 * -- because pnpm gives each peer resolution its own directory under `.pnpm`.
 * That is #8326's exact bundling mechanism (two real paths, nothing dedupes
 * them) arriving with no version change anywhere. A gate counting VERSIONS
 * reports one spec and passes; a gate counting snapshot keys reports two.
 *
 * ## Boundary: what this does NOT own
 *
 * ⛔ The absolute invariant "the lockfile resolves exactly one
 * `@objectstack/spec` VERSION" is already owned, and is deliberately not
 * restated here -- `scripts/__tests__/ci-cd-pipeline-doc.test.ts`
 * (`ci-cd-pipeline.md — live-e2e backend pin (#7689)`) asserts it as the
 * precondition of comparing `OBJECTSTACK_VERSION` in `e2e/live/ci/backend.env`
 * against the lockfile. Two definitions of one rule are free to drift, so this
 * gate asks a DIFFERENT question: not "is the tree in the right state" but "did
 * THIS CHANGE make it worse". That guard is absolute, single-package,
 * version-level, and on the unit lane; this one is a delta, over every package,
 * at snapshot-key level, and reads two lockfiles.
 *
 * Consequences of that boundary, stated so nobody reads a green as more:
 *
 *   - A lockfile that is ALREADY duplicated stays green here as long as the
 *     change does not make it worse. This is a ratchet, not an audit.
 *   - A backward move is not judged, for any package. Third-party downgrades
 *     are legitimate (a revert, a yanked release, a security pin), and
 *     `@objectstack/*` has no version here to move (rule 1, retired above).
 *   - It says nothing about bytes. `Bundle Analysis` measures those; this names
 *     the cause so that reading is not attributed to the dependency.
 *
 * ## Anti-vacuity
 *
 * Both lockfiles must parse to a non-empty snapshot set, and the base and head
 * must not be byte-identical-with-zero-identities. A lockfile format change
 * therefore exits 2 (cannot read) instead of green-over-an-empty-set.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import process from 'node:process';

import { isEntrypoint } from './invoked-as.mjs';
import { LOCKFILE, lockfilePath, workspaceRoot } from './workspace-root.mjs';

export const EXIT_CLEAN = 0;
export const EXIT_FINDINGS = 1;
export const EXIT_CANNOT_RUN = 2;

/**
 * The first-party scope. Rule 2 judges it whether or not the workspace declares
 * the name directly: `@objectstack/types` and `@objectstack/core` arrive only
 * through `@objectstack/client`, and a second copy of either is still two real
 * paths in the bundle.
 */
export const FIRST_PARTY_SCOPE = '@objectstack/';

// ── parsing ─────────────────────────────────────────────────────────────────

/**
 * Split a pnpm snapshot key into its package name, version and peer suffix.
 *
 * `'@objectstack/spec@17.3.0(ai@7.0.65(zod@4.4.3))'` ->
 *   { name: '@objectstack/spec', version: '17.3.0', peers: '(ai@7.0.65(zod@4.4.3))' }
 *
 * A key whose version does not start with a digit (a git or URL dependency, or
 * the pinned `@objectstack/*` build's `file:` directory) is returned with
 * `version: null`. Such a key still counts as a physical copy — it is a directory
 * like any other.
 *
 * @param {string} key
 * @returns {{ name: string, version: string|null, peers: string }}
 */
export function parseSnapshotKey(key) {
  const paren = key.indexOf('(');
  const base = paren === -1 ? key : key.slice(0, paren);
  const peers = paren === -1 ? '' : key.slice(paren);
  const at = base.lastIndexOf('@');
  if (at <= 0) return { name: base, version: null, peers };
  const version = base.slice(at + 1);
  return {
    name: base.slice(0, at),
    version: /^[0-9]/.test(version) ? version : null,
    peers,
  };
}

/**
 * Every `snapshots:` key of a lockfile, in file order.
 *
 * The `snapshots:` section is read rather than `packages:` because a snapshot
 * key IS the physical directory pnpm creates; two snapshot keys of one version
 * are two directories, and that is the duplication the incident is about.
 * Keys sit at exactly two spaces of indentation, optionally single-quoted; the
 * section ends at the next column-0 key.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function readSnapshotKeys(text) {
  const lines = text.split('\n');
  const start = lines.indexOf('snapshots:');
  if (start === -1) return [];
  const keys = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^[^\s#]/.test(line)) break; // next top-level section
    const m = line.match(/^ {2}('?)([^\s'].*?)\1:(?:\s.*)?$/);
    if (m) keys.push(m[2]);
  }
  return keys;
}

/**
 * The importer blocks whose contents can reach a shipped bundle.
 *
 * ⛔ `devDependencies` is excluded, and that is the second half of the same
 * measurement. Over the 40 most recent lockfile-changing commits on `main`,
 * scoping rule 2 to every declared name reds on three: `1bae75bb8`
 * (`@vitejs/plugin-react` 1 -> 2), `90bc5d16a` (`vite` and `vitest` 2 -> 3) and
 * `bde6483b1` (`lucide-react` 1 -> 2). The first two are build tooling — a
 * second copy of vitest ships nothing and costs no bytes anywhere `Bundle
 * Analysis` can see. The third is a real runtime dependency of nine packages,
 * and is the kind of finding this gate is for. Excluding devDependencies keeps
 * the third and drops the first two.
 */
const RUNTIME_BLOCKS = new Set(['dependencies', 'peerDependencies', 'optionalDependencies']);

/**
 * Every package name THIS REPOSITORY declares, read from the lockfile's own
 * `importers:` section (name at six spaces, `specifier:` on the next line).
 *
 * ⭐ This is the scope of rule 2, and the scope is a measurement, not taste.
 * Run repo-wide, rule 2 reds on ordinary merged history: `5505aec1a`
 * (mermaid 11.17.1 -> 11.17.2, merged, nothing wrong with it) adds a fourth
 * `tinyexec` to the three already there. A gate that reds on that gets turned
 * off, and then it is not there for the one that matters.
 *
 * A name the workspace declares is one this repository chose, with one range,
 * in one place — `zod` is declared `^4.4.3` by five packages — so a copy of it
 * nobody declared is a fact about the resolution rather than about a bump. A
 * name only some transitive subtree asks for has no such author here.
 *
 * ⛔ The boundary that follows: a purely transitive package duplicating is NOT
 * judged. Read from the lockfile rather than by walking `package.json` files so
 * a base revision can be read with `git show` and no checkout.
 *
 * @param {string} text
 * @returns {Set<string>}
 */
export function readDeclaredNames(text) {
  const lines = text.split('\n');
  const start = lines.indexOf('importers:');
  const names = new Set();
  if (start === -1) return names;
  let runtime = false;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^[^\s#]/.test(lines[i])) break; // next top-level section
    const block = lines[i].match(/^ {4}([A-Za-z]+):\s*$/);
    if (block) {
      runtime = RUNTIME_BLOCKS.has(block[1]);
      continue;
    }
    if (!runtime) continue;
    const m = lines[i].match(/^ {6}('?)([^\s'].*?)\1:\s*$/);
    if (m && /^ {8}specifier:/.test(lines[i + 1] ?? '')) names.add(m[2]);
  }
  return names;
}

/**
 * @param {string} text
 * @param {string} label
 * @returns {{ label: string, keys: string[], declared: Set<string>, copies: Map<string, string[]> }}
 */
export function indexLockfile(text, label) {
  const keys = readSnapshotKeys(text);
  const declared = readDeclaredNames(text);
  /** @type {Map<string, string[]>} */ const copies = new Map();
  for (const key of keys) {
    const { name } = parseSnapshotKey(key);
    if (!copies.has(name)) copies.set(name, []);
    copies.get(name).push(key);
  }
  return { label, keys, declared, copies };
}

// ── the rule ────────────────────────────────────────────────────────────────

/**
 * @typedef {{ rule: 'duplicated', name: string, baseCount: number, headCount: number, base: string[], head: string[], added: string[] }} DuplicationFinding
 */

/**
 * @param {ReturnType<typeof indexLockfile>} base
 * @param {ReturnType<typeof indexLockfile>} head
 * @returns {{ findings: DuplicationFinding[], duplicated: DuplicationFinding[] }}
 */
export function compareLockfiles(base, head) {
  /**
   * Rule 2 — a package this repository declares gained a physical copy.
   *
   * A name absent from the base has no baseline to have "gained" against, so it
   * is judged only when it ARRIVES already multiplied (> 1 copy at once) —
   * otherwise every newly declared dependency is a finding. Measured: without
   * that carve-out, `639114c4d` reds because `@objectstack/types` goes 0 -> 1.
   */
  const inScope = new Set([...base.declared, ...head.declared]);
  /** @type {DuplicationFinding[]} */
  const duplicated = [];
  for (const [name, headKeys] of head.copies) {
    if (!inScope.has(name) && !name.startsWith(FIRST_PARTY_SCOPE)) continue;
    const baseKeys = base.copies.get(name) ?? [];
    if (headKeys.length <= baseKeys.length) continue;
    if (baseKeys.length === 0 && headKeys.length <= 1) continue;
    duplicated.push({
      rule: 'duplicated',
      name,
      baseCount: baseKeys.length,
      headCount: headKeys.length,
      base: baseKeys.slice().sort(),
      head: headKeys.slice().sort(),
      added: headKeys.filter((k) => !baseKeys.includes(k)).sort(),
    });
  }

  duplicated.sort((a, b) => a.name.localeCompare(b.name));
  return { findings: [...duplicated], duplicated };
}

// ── reporting ───────────────────────────────────────────────────────────────

/**
 * The verdict line, plus the named packages. One line is the point of the gate:
 * the incident cost two seats a day each because the red they got named the
 * wrong subject.
 *
 * @param {{ duplicated: DuplicationFinding[] }} reading
 * @param {{ base: string, head: string, baseKeys: number, headKeys: number }} sources
 * @returns {string}
 */
export function renderReading(reading, sources) {
  const lines = [];
  const total = reading.duplicated.length;
  lines.push(
    `base: ${sources.base} (${sources.baseKeys} resolutions)  head: ${sources.head} (${sources.headKeys} resolutions)`,
  );

  for (const f of reading.duplicated) {
    lines.push('');
    lines.push(`✗ ${f.name} gained a physical copy: ${f.baseCount} -> ${f.headCount}`);
    for (const k of f.base) lines.push(`    base  ${k}`);
    for (const k of f.head) lines.push(`    head  ${k}${f.added.includes(k) ? '   <- added' : ''}`);
  }

  lines.push('');
  if (total === 0) {
    lines.push(
      `VERDICT clean — no package gained a copy.`,
    );
  } else {
    lines.push(
      `VERDICT ${total} lockfile-integrity finding(s): ${total} duplication(s).`,
    );
    lines.push(
      'Two physical copies of one package are two real paths, and nothing dedupes those — a',
    );
    lines.push(
      'bundle-size red downstream of this is caused by THIS, not by the dependency being bumped.',
    );
    lines.push(
      '⛔ This gate reports only. Re-locking from a clean base, pinning, or accepting the split',
    );
    lines.push('is a decision for the pull request, not for this check.');
  }
  return lines.join('\n');
}

// ── sources ─────────────────────────────────────────────────────────────────

/**
 * @param {string[]} args
 * @param {string} flag
 * @returns {string|null}
 */
function flagValue(args, flag) {
  const i = args.indexOf(flag);
  return i === -1 ? null : (args[i + 1] ?? null);
}

/**
 * Read a lockfile from the worktree or from a git revision (`<ref>:<path>`).
 *
 * @param {string} spec
 * @returns {string}
 */
function readSource(spec) {
  if (spec.includes(':') && !fs.existsSync(spec)) {
    const [rev, file] = [spec.slice(0, spec.indexOf(':')), spec.slice(spec.indexOf(':') + 1)];
    const out = spawnSync('git', ['show', `${rev}:${file}`], {
      cwd: workspaceRoot(),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    if (out.status !== 0) {
      throw new Error(`git show ${rev}:${file} failed: ${(out.stderr || '').trim()}`);
    }
    return out.stdout;
  }
  return fs.readFileSync(spec, 'utf8');
}

/**
 * @param {string[]} argv
 * @returns {{ base: string, head: string }}
 */
export function resolveSources(argv) {
  // The one lockfile sits at the workspace root -- this repository's own, or
  // the monorepo's one level up (objectstack#25723). `<rev>:<path>` below is
  // relative to the repository root, which in both layouts is that same directory.
  const head = flagValue(argv, '--head') ?? lockfilePath();
  const explicitBase = flagValue(argv, '--base');
  if (explicitBase) return { base: explicitBase, head };

  const baseRef = flagValue(argv, '--base-ref') ?? 'origin/main';
  const mergeBase = spawnSync('git', ['merge-base', baseRef, 'HEAD'], {
    cwd: workspaceRoot(),
    encoding: 'utf8',
  });
  const rev = mergeBase.status === 0 ? mergeBase.stdout.trim() : null;
  if (!rev) {
    throw new Error(
      `could not find a merge base with ${baseRef}: ${(mergeBase.stderr || '').trim()}\n` +
        'A shallow checkout has no merge base — fetch the base branch with enough depth, ' +
        'or pass --base <file>.',
    );
  }
  return { base: `${rev}:${LOCKFILE}`, head };
}

/**
 * @param {string[]} argv
 */
export function main(argv = process.argv.slice(2)) {
  const { base, head } = resolveSources(argv);
  const baseIndex = indexLockfile(readSource(base), base);
  const headIndex = indexLockfile(readSource(head), head);

  // Anti-vacuity: an empty snapshot set means the format moved, not that the
  // change is clean. Reported as "cannot run", never as a pass.
  for (const idx of [baseIndex, headIndex]) {
    if (idx.keys.length === 0) {
      throw new Error(
        `no \`snapshots:\` entries parsed out of ${idx.label}. Every comparison below would ` +
          'run against an empty set and pass whatever the change did. The lockfile format ' +
          'moved, or the path is not a pnpm lockfile — fix readSnapshotKeys(), do not ' +
          'read this as a clean lockfile.',
      );
    }
  }

  const reading = compareLockfiles(baseIndex, headIndex);
  const sources = {
    base,
    head,
    baseKeys: baseIndex.keys.length,
    headKeys: headIndex.keys.length,
  };

  if (argv.includes('--json')) {
    console.log(JSON.stringify({ sources, ...reading }, null, 2));
  } else {
    console.log(renderReading(reading, sources));
  }
  if (reading.findings.length) {
    console.error(
      `::error title=Lockfile integrity::${[...new Set(reading.findings.map((f) => f.name))].join(', ')} — ` +
        'see the run log; this is a lockfile regression, not a bundle regression (objectui#8326).',
    );
  }
  return reading.findings.length ? EXIT_FINDINGS : EXIT_CLEAN;
}

// ── self-test ───────────────────────────────────────────────────────────────

const lock = (snapshots, declared = ['zod', '@objectstack/spec', '@objectstack/client', 'lucide-react', 'better-auth']) =>
  `lockfileVersion: '9.0'\n\nimporters:\n\n  .:\n    dependencies:\n` +
  declared.map((d) => `      ${/[@/]/.test(d) ? `'${d}'` : d}:\n        specifier: '*'\n        version: 0.0.0\n`).join('') +
  `\nsnapshots:\n${snapshots.map((s2) => `  ${/[@(]/.test(s2) ? `'${s2}'` : s2}: {}`).join('\n')}\n`;

export function selfTest() {
  const cases = [];
  const t = (name, ok, detail) => cases.push({ name, ok: Boolean(ok), detail });
  const run = (baseKeys, headKeys) =>
    compareLockfiles(indexLockfile(lock(baseKeys), 'base'), indexLockfile(lock(headKeys), 'head'));

  // ── the parser ────────────────────────────────────────────────────────────
  const parsed = parseSnapshotKey('@objectstack/spec@17.3.0(ai@7.0.65(zod@4.4.3))');
  t('scoped key splits at the version', parsed.name === '@objectstack/spec' && parsed.version === '17.3.0');
  t('the peer suffix survives', parsed.peers === '(ai@7.0.65(zod@4.4.3))');
  t('unscoped key splits', parseSnapshotKey('zod@4.4.3').name === 'zod');
  t('a non-numeric version is not ordered', parseSnapshotKey('pkg@github:o/r#abc').version === null);
  const pinned = parseSnapshotKey('@objectstack/spec@file:.objectstack-pin/spec(ai@7.0.65(zod@4.6.7))');
  t('the pinned build key keeps its name and has no version (objectui#12957)', pinned.name === '@objectstack/spec' && pinned.version === null);
  t('sub-keys are not read as snapshots', readSnapshotKeys("snapshots:\n  zod@4.4.3:\n    dependencies:\n      foo: 1.0.0\n").join() === 'zod@4.4.3');
  t('the section ends at the next top-level key', readSnapshotKeys("snapshots:\n  zod@4.4.3: {}\nother:\n  nope@1.0.0: {}\n").join() === 'zod@4.4.3');

  // ── cause 1: what is left of objectui#8326's downgrade (rule 1 retired) ──
  const a = run(
    ['@objectstack/spec@17.3.0', '@objectstack/client@17.3.0'],
    ['@objectstack/spec@17.2.0', '@objectstack/spec@17.3.0', '@objectstack/client@17.2.0'],
  );
  t('cause 1 — the duplication the downgrade left is named', a.duplicated.some((f) => f.name === '@objectstack/spec' && f.headCount === 2));
  t('cause 1 — a version moving alone is no longer judged (rule 1 retired)', !a.duplicated.some((f) => f.name === '@objectstack/client'));
  const PIN = '@objectstack/spec@file:.objectstack-pin/spec';
  const p = run([PIN], [PIN, '@objectstack/spec@18.0.0-next.3']);
  t('pin — a registry copy beside the pinned build is a duplication (objectui#12957)', p.duplicated.some((f) => f.name === '@objectstack/spec' && f.added.includes('@objectstack/spec@18.0.0-next.3')));
  t('pin — moving from a registry version onto the pinned build is clean', run(['@objectstack/spec@18.0.0-next.3'], [PIN]).findings.length === 0);

  // ── cause 2: objectui#8333, no @objectstack/* movement at all ─────────────
  const b = run(
    ['zod@3.25.76', 'zod@4.4.3', '@objectstack/spec@17.3.0(ai@7.0.65(zod@4.4.3))', 'better-auth@1.7.2'],
    [
      'zod@3.25.76',
      'zod@4.4.3',
      'zod@4.5.4',
      '@objectstack/spec@17.3.0(ai@7.0.65(zod@4.4.3))',
      '@objectstack/spec@17.3.0(ai@7.0.65(zod@4.5.4))',
      'better-auth@1.7.3',
    ],
  );
  t('cause 2 — zod 2 -> 3 is a finding, though it was never single-copy', b.duplicated.some((f) => f.name === 'zod' && f.baseCount === 2 && f.headCount === 3));
  t('cause 2 — the peer-forked spec is a finding at one version', b.duplicated.some((f) => f.name === '@objectstack/spec' && f.headCount === 2));
  t('cause 2 — the gate is red on it', b.findings.length > 0);

  // ── the control: a clean forward bump ─────────────────────────────────────
  const c = run(
    ['lucide-react@1.35.0', 'zod@3.25.76', 'zod@4.4.3', '@objectstack/spec@17.3.0'],
    ['lucide-react@1.41.0', 'zod@3.25.76', 'zod@4.4.3', '@objectstack/spec@17.3.0'],
  );
  t('control — a forward third-party bump is clean', c.findings.length === 0);
  const d = run(['left-pad@1.0.0'], ['left-pad@0.9.0']);
  t('control — a third-party DOWNGRADE is not judged (stated boundary)', d.findings.length === 0);
  const e = run(['@objectstack/spec@17.2.0', '@objectstack/spec@17.3.0'], ['@objectstack/spec@17.2.0', '@objectstack/spec@17.3.0']);
  t('control — an already-duplicated base stays clean when unchanged (ratchet, not audit)', e.findings.length === 0);
  const f = run(['@objectstack/spec@17.2.0', '@objectstack/spec@17.3.0'], ['@objectstack/spec@17.3.0']);
  t('control — repairing a duplication is clean', f.findings.length === 0);

  // ── the scope of rule 2 is what the workspace declares ────────────────────
  t('importers are read as the declared set', readDeclaredNames(lock([], ['zod'])).has('zod'));
  t('a peerDependencies line in packages: is not a declaration', !readDeclaredNames("importers:\n\n  .:\n    dependencies:\n      zod:\n        specifier: '*'\n        version: 1\npackages:\n  foo@1.0.0:\n    peerDependencies:\n      react: '*'\n").has('react'));
  t('devDependencies are out of scope (measured: vite/vitest on 90bc5d16a)', !readDeclaredNames("importers:\n\n  .:\n    devDependencies:\n      vitest:\n        specifier: '*'\n        version: 1\n").has('vitest'));
  t('peerDependencies of an importer ARE in scope', readDeclaredNames("importers:\n\n  .:\n    peerDependencies:\n      react:\n        specifier: '*'\n        version: 1\n").has('react'));
  const g = run(['tinyexec@1.2.4', 'tinyexec@1.3.0'], ['tinyexec@1.2.4', 'tinyexec@1.3.0', 'tinyexec@1.3.1']);
  t('scope — an undeclared transitive package gaining a copy is not judged (measured: 5505aec1a)', g.findings.length === 0);
  const h = run(['@objectstack/client@17.3.0'], ['@objectstack/client@17.3.0', '@objectstack/types@17.3.0']);
  t('scope — a package ARRIVING at one copy is not a duplication (measured: 639114c4d)', h.findings.length === 0);
  const i = run(['@objectstack/client@17.3.0'], ['@objectstack/client@17.3.0', 'zod@4.4.3', 'zod@4.5.4']);
  t('scope — a declared package ARRIVING already multiplied is judged', i.duplicated.some((f2) => f2.name === 'zod' && f2.headCount === 2));

  // ── the verdict line renders what it found ────────────────────────────────
  const sources = { base: 'b', head: 'h', baseKeys: 1, headKeys: 1 };
  t('a clean reading says clean', renderReading(c, sources).includes('VERDICT clean'));
  t('a finding names the package in the report', renderReading(b, sources).includes('zod gained a physical copy: 2 -> 3'));

  const failed = cases.filter((c2) => !c2.ok);
  for (const c2 of failed) console.error(`  ✗ ${c2.name}${c2.detail ? ` — ${c2.detail}` : ''}`);
  if (failed.length) {
    console.error(`✗ check-lockfile-integrity self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    return 1;
  }
  console.log(
    `✓ check-lockfile-integrity self-test: ${cases.length} cases pass ` +
      "(the duplication half of both incident causes, the peer-fork that moves no version, the pinned build, and the controls a red-on-everything gate would fail).",
  );
  return 0;
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    process.exitCode = selfTest();
  } else {
    try {
      process.exitCode = main();
    } catch (error) {
      console.error(
        `::error::check-lockfile-integrity could not take a reading: ${error instanceof Error ? error.message : String(error)}`,
      );
      console.error(
        'A reading that could not be taken is NOT a clean lockfile. Nothing about this change was judged by this run.',
      );
      process.exitCode = EXIT_CANNOT_RUN;
    }
  }
}
