// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * This package spells the standalone-action owner-key ladder ONCE (#14422).
 *
 * `ObjectQLPlugin` carried a private `actionObjectKey` that repeated
 * {@link standaloneActionOwnerKey}'s three rungs, and the only thing holding
 * the two equal was a sentence in each docblock. It had already drifted in the
 * one way a copy can drift without any test noticing: the plugin's terminal
 * rung returned the bare literal `'global'` while the canonical helper returns
 * `GLOBAL_ACTION_OBJECT_KEY`. Equal in value on the day it was measured, and
 * silently different the first time that constant moves.
 *
 * `@objectstack/runtime` carries the matching weld for its own copy
 * (`action-owner-key-single-source.test.ts` there). The LADDER halves below are
 * scoped to this package's source so they stay package-local test inputs; the
 * absence half is not, and the section on it explains why.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { GLOBAL_ACTION_OBJECT_KEY, standaloneActionOwnerKey } from './action-governance.js';

/** Rung 1 exactly as `action-governance.ts` writes it. */
const LADDER_RUNG_1 = "typeof action?.objectName === 'string' && action.objectName.length > 0";
/** Rung 2, likewise. */
const LADDER_RUNG_2 = "typeof action?.object === 'string' && action.object.length > 0";

/**
 * This package's `src` directory, located from the test file's own path via
 * vitest's runner state rather than `import.meta.url`: this package builds to
 * CommonJS, where `import.meta` is a TS1470 that would bill the TEST_DEBT
 * ledger for a config error saying nothing about this test.
 */
function srcDir(): string {
    const testPath = expect.getState().testPath;
    if (!testPath) {
        throw new Error('vitest did not report a testPath — the #14422 weld cannot locate this package.');
    }
    return dirname(testPath);
}

function nonTestSources(): Array<{ file: string; text: string }> {
    const dir = srcDir();
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    if (files.length === 0) {
        throw new Error(`No sources found under ${dir} — the #14422 weld would pass vacuously. Fix this scan.`);
    }
    return files.map((file) => ({ file, text: readFileSync(join(dir, file), 'utf8') }));
}

describe('standalone-action owner key — one spelling in @objectstack/objectql (#14422)', () => {
    it('writes each ladder rung in exactly one file, and that file is action-governance.ts', () => {
        const sources = nonTestSources();
        // Anti-vacuity: the scan must be able to SEE the canonical spelling.
        // A rung constant that matched nothing would make both counts zero and
        // the assertion below green for the wrong reason.
        const canonical = sources.find((s) => s.file === 'action-governance.ts');
        expect(canonical, 'action-governance.ts is missing from the scan').toBeDefined();
        expect(canonical!.text).toContain(LADDER_RUNG_1);
        expect(canonical!.text).toContain(LADDER_RUNG_2);

        for (const rung of [LADDER_RUNG_1, LADDER_RUNG_2]) {
            const carriers = sources.filter((s) => s.text.includes(rung)).map((s) => s.file);
            expect(carriers, `ladder rung re-inlined: ${rung}`).toEqual(['action-governance.ts']);
        }
    });

    it('derives the plugin owner key through the canonical helper', () => {
        const plugin = nonTestSources().find((s) => s.file === 'plugin.ts');
        expect(plugin, 'plugin.ts is missing from the scan').toBeDefined();
        // The negative that used to live here — "plugin.ts does not name the
        // deleted member" — moved to the TREE-scoped section at the bottom of
        // this file (#14878). Its scope was the defect, not its subject. What
        // stays here is the positive half: the plugin still derives owner keys,
        // it just does it through the canonical helper now.
        expect(plugin!.text).toContain('standaloneActionOwnerKey(');
    });

    it('terminates the ladder on the constant, never on a bare literal', () => {
        expect(standaloneActionOwnerKey({})).toBe(GLOBAL_ACTION_OBJECT_KEY);
        const canonical = nonTestSources().find((s) => s.file === 'action-governance.ts')!.text;
        const body = canonical.match(/export function standaloneActionOwnerKey\([^)]*\): string \{([\s\S]*?)\n\}/);
        if (!body) {
            throw new Error(
                'Could not locate `standaloneActionOwnerKey` in action-governance.ts. '
                + 'The #14422 weld cannot verify itself — fix this parse rather than deleting it.',
            );
        }
        expect(body[1]).toContain('return GLOBAL_ACTION_OBJECT_KEY;');
        expect(body[1]).not.toContain("'global'");
    });
});

/**
 * ── [#14878] The absence assertion is TREE-scoped, not FILE-scoped ──────────
 *
 * The negative that used to sit in the plugin test above read `plugin.ts` and
 * nothing else, and THAT SCOPE was the defect. A pin written by the deleting PR
 * can only look where its author thought to look, and the whole failure mode is
 * references the author did not know about: the file-scoped pin stayed green
 * while five other files in three other packages went on naming the deleted
 * member as something that reads a key TODAY, and the one deletion produced two
 * separate follow-up cards.
 *
 * Widening to the tree also covers the half that nothing keyed on the deleting
 * diff can ever see. Three of those five references already existed when the
 * member died. The other two were written 1 h 41 min AFTER it, by a later PR,
 * into a file that was clean at deletion time — so a check that greps the
 * deleting PR's own post-image is structurally blind to them. A pin that runs on
 * every PR is not: it reddens on the second kind at the moment it is written,
 * which is the only moment the person who can classify the mention is present.
 *
 * ⛔ AN ASSERTION OF ABSENCE IS NOT A STALE MENTION. This file and its twin in
 * `@objectstack/runtime` name the dead member because naming it is how they hunt
 * for it. "Repairing" those lines deletes the guard — a naive fixer turning a
 * pin into its own removal. That is why the two pins exclude themselves below,
 * with the reason written beside the rule; it is the first thing to get right
 * about this shape, not a refinement of it.
 *
 * ── Scope, and where it stops ───────────────────────────────────────────────
 *
 * `.ts` under `packages/`, and that boundary is a MEASURED TRADE rather than a
 * default — read this before widening it.
 *
 * `examples/` was in the scan for one commit. It is the right radius on the
 * evidence (one of the five surviving references lived there), and the repo's
 * gate farm refused it: declaring an examples-wide `.ts` glob in
 * `scripts/cross-package-test-inputs.mjs` makes that glob an inherited watch
 * hint on every importer of that table, `check:cross-package-test-inputs`
 * included — and `dispatch-gates.mjs`'s self-test pins that no hint of that gate
 * reaches a test file outside `packages/**`, because the whole reason it is
 * listed as a change-KIND rather than a path derivation is that the hint route
 * cannot reach the population it judges. Measured on this tree: all 41 tracked
 * test files outside `packages/` are under `examples/`, so that one glob does
 * not shrink the residue class, it EMPTIES it, and the case cannot be
 * re-pointed at another member because there is none.
 *
 * ⇒ Widening this pin to `examples/` is not a two-line change and ⛔ must not be
 * done by editing that self-test case. It needs the residue measurement behind
 * that case redone, which is a `scripts/pm/` decision owned by another lane.
 * What it costs today, stated rather than discovered later: of this symbol's
 * five surviving references, four were `packages/**` and one was a test under
 * the showcase example — which this pin would not have caught.
 *
 * ⚠️ Any widening — `examples/`, `docs/`, `content/`, `skills/`, `apps/` — is
 * TWO edits, never one: `SCANNED_ROOTS` here AND this package's globs in
 * `scripts/cross-package-test-inputs.mjs` (a NEW top-level root needs a matching
 * ci.yml `crosspkg:` entry too, which `check-ci-filter-parity.mjs` gates).
 * Widening the scanner alone reads as coverage while turbo never re-runs this
 * suite for the files it now claims to judge.
 */

/**
 * The member PR #14667 deleted from `ObjectQLPlugin`. Held as DATA: naming a
 * symbol in a string cannot resurrect it, and this file is excluded from its own
 * scan precisely so it may carry the name.
 */
const DELETED_PLUGIN_MEMBER = 'actionObjectKey';

/**
 * The live spelling that replaced it. Used as the scan's reach control below —
 * it is the one symbol guaranteed to sit in both scanned roots for as long as
 * the convergence holds, and if it ever stops doing so this pin should say so
 * loudly rather than quietly stop reaching.
 */
const CANONICAL_HELPER = 'standaloneActionOwnerKey';

/** The two pins that hunt the dead member, and therefore have to name it. */
const PIN_FILES: readonly string[] = [
    'packages/objectql/src/action-owner-key-single-source.test.ts',
    'packages/runtime/src/action-owner-key-single-source.test.ts',
];

/**
 * Where a mention of the dead member is NOT a defect, each with its reason
 * beside it.
 *
 * ⛔ This is a scan-SCOPE decision written where the scan lives, and it must
 * stay that: an allowlist FILE — one more path pasted in whenever a report is
 * inconvenient — is the permission slip this whole shape exists to avoid. A rule
 * here has to be a statement about a CLASS of file that is true by construction,
 * never "this one site is fine".
 *
 * The first two rules cannot fire while `SCANNED_EXTENSION` is `.ts`, and they
 * are kept anyway: they are the ruled exclusions, and the day someone widens the
 * extension set they are what stops the release record from being re-admitted as
 * a pile of false reds.
 */
const NOT_A_STALE_MENTION: ReadonlyArray<{ readonly covers: (file: string) => boolean; readonly why: string }> = [
    {
        // A published CHANGELOG entry is the record OF the removal. It is true in
        // the past tense, it is what a consumer reads to find out the member is
        // gone, and rewriting it would falsify shipped release history.
        covers: (file) => file === 'CHANGELOG.md' || file.endsWith('/CHANGELOG.md'),
        why: 'a published CHANGELOG is the record of the removal itself',
    },
    {
        // The same record before the release process compiles it into the above.
        covers: (file) => file.startsWith('.changeset/'),
        why: 'a changeset is that record before it is compiled into a CHANGELOG',
    },
    {
        // The pins carry the name as their own search string and as accurate
        // history of what they pin. Excluding them is what lets the pin exist:
        // a scan that flagged its own needle would have no green state at all.
        covers: (file) => PIN_FILES.includes(file),
        why: 'the pin carries the name as its own search string — repairing it deletes the guard',
    },
];

/**
 * This package is CJS-typed (no `"type": "module"`), so `module: NodeNext`
 * forbids `import.meta` here — the same constraint `srcDir()` above records.
 * Walk up from the CWD to this package's own manifest instead, which works
 * wherever vitest is invoked from.
 */
function findUp(marker: (dir: string) => boolean, what: string): string {
    let dir = process.cwd();
    for (;;) {
        if (marker(dir)) return dir;
        const parent = dirname(dir);
        if (parent === dir) throw new Error(`could not locate ${what} walking up from ${process.cwd()}`);
        dir = parent;
    }
}

const PACKAGE_ROOT = findUp((dir) => {
    const manifest = join(dir, 'package.json');
    if (!existsSync(manifest)) return false;
    const { name } = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string };
    return name === '@objectstack/objectql';
}, 'the @objectstack/objectql package root');

/**
 * The repo root by ARITHMETIC from this package rather than by a second
 * marker-file walk, deliberately: a walk keyed on a workspace-root marker would
 * NAME that root file, and a declared root-level path is a new top-level root
 * that ci.yml's `crosspkg:` filter would then have to carry. Anchoring off the
 * manifest keeps this pin's declared radius inside roots that already exist.
 *
 * The arithmetic is not trusted on faith — the reach test below fails on any
 * wrong root, because no wrong root can see both scanned trees.
 */
const REPO_ROOT = resolve(PACKAGE_ROOT, '../..');

/** The tree this pin binds. See the scope note above before changing it. */
const SCANNED_ROOTS: readonly string[] = ['packages'];

/** Spelled once so the declared glob and the scan stay in correspondence. */
const SCANNED_EXTENSION = '.ts';

/**
 * Generous on purpose. The scan is one `git grep` and a handful of file reads —
 * tens of milliseconds — so this is not a budget, it is headroom against a
 * merge-queue runner doing a full monorepo build at the same time. A pin that
 * times out before its assertion runs reports nothing, and reporting nothing is
 * indistinguishable from finding nothing.
 */
const SCAN_TIMEOUT_MS = 60_000;

function git(args: string[]): string[] {
    let stdout: string;
    try {
        stdout = execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
    } catch (error) {
        const failure = error as { status?: number; stderr?: string };
        // `git grep` exits 1 for "found nothing", which is data. Anything else is
        // a BROKEN scan and must never read as "no stale mentions" — throwing
        // here, plus the reach test below, is what keeps a green result meaning
        // "looked and found nothing" rather than "never looked".
        if (failure.status === 1) return [];
        throw new Error(
            `git ${args.join(' ')} failed with status ${String(failure.status)}: ${failure.stderr ?? ''}`,
        );
    }
    return stdout.split('\0').filter((entry) => entry.length > 0);
}

/**
 * Every scanned file that so much as mentions `symbol`.
 *
 * Tracked files PLUS untracked ones with ignored paths excluded (`--untracked`)
 * — i.e. exactly the files a human authored, never build output. A file written
 * but not yet `git add`ed still reddens, which is what makes this a local-loop
 * guard rather than something you find out about in the merge queue.
 */
function filesMentioning(symbol: string): string[] {
    return git([
        'grep',
        '--files-with-matches',
        '-z',
        '--untracked',
        '--text',
        '--fixed-strings',
        '-e',
        symbol,
        '--',
        ...SCANNED_ROOTS,
    ]).filter((file) => file.endsWith(SCANNED_EXTENSION));
}

/** `<file>:<line>` for every mention that no rule above excuses. */
function staleMentionSites(symbol: string): string[] {
    const sites: string[] = [];
    for (const file of filesMentioning(symbol)) {
        if (NOT_A_STALE_MENTION.some((rule) => rule.covers(file))) continue;
        const lines = readFileSync(join(REPO_ROOT, file), 'utf8').split('\n');
        lines.forEach((text, index) => {
            if (text.includes(symbol)) sites.push(`${file}:${index + 1}`);
        });
    }
    return sites;
}

describe('standalone-action owner key — the deleted member is dead TREE-WIDE (#14878)', () => {
    it(
        'is named nowhere outside the release record and the two pins',
        () => {
            const sites = staleMentionSites(DELETED_PLUGIN_MEMBER);
            expect(
                sites,
                sites.length === 0
                    ? ''
                    : [
                          `These files name \`${DELETED_PLUGIN_MEMBER}\`, a private \`ObjectQLPlugin\``,
                          'member that was DELETED when the standalone-action owner-key ladder was',
                          'converged onto one spelling:',
                          '',
                          ...sites.map((site) => `  - ${site}`),
                          '',
                          `The live spelling is \`${CANONICAL_HELPER}\`, exported from`,
                          '`@objectstack/objectql` (packages/objectql/src/action-governance.ts). If the',
                          'sentence is otherwise accurate, rename the one word rather than rewriting',
                          'the clause — the neighbouring names in these sentences are usually alive.',
                          '',
                          '⛔ Before you touch a site, decide which of three it is:',
                          '  (a) a LIVE CLAIM that the member exists  -> fix it',
                          '  (b) accurate HISTORY naming it in the past -> reword so it no longer',
                          '      carries the dead name, or add a rule to NOT_A_STALE_MENTION above',
                          '      with the reason beside it — never an allowlist file',
                          '  (c) an ASSERTION THAT IT IS GONE -> ⛔ leave it alone. It is the guard.',
                      ].join('\n'),
            ).toEqual([]);
        },
        SCAN_TIMEOUT_MS,
    );

    it(
        'the scan reaches both roots and can see the name it hunts',
        () => {
            // Anti-vacuity, at both stages a tree scan can go silently blind.
            //
            // A grep that matched nothing — wrong repo root, git missing, a
            // pathspec that names no tree — yields the same empty violation set
            // as a clean repo, and the assertion above cannot tell them apart.
            // That is the exact property the file-scoped pin lost.
            expect(filesMentioning(DELETED_PLUGIN_MEMBER)).toContain(PIN_FILES[0]);

            // ...and it must LEAVE this package, which is the half a file-scoped
            // pin never had. The live helper is the reach control: it is the one
            // symbol the convergence guarantees outside this package, and the CLI
            // site below is one of the files that carried the DEAD name until it
            // was repaired — so a scan that cannot see it is a scan that would
            // not have caught the defect this pin exists for.
            const reached = filesMentioning(CANONICAL_HELPER);
            expect(reached).toContain('packages/cli/src/commands/lint.ts');
            expect(reached).toContain('packages/runtime/src/action-execution.ts');
        },
        SCAN_TIMEOUT_MS,
    );
});
