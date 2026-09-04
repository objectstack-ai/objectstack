// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The standalone-action owner-key ladder has ONE spelling (#14422).
 *
 * `action.objectName` -> `action.object` -> the object-less
 * `GLOBAL_ACTION_OBJECT_KEY` decides which engine key a standalone `action`
 * declaration is filed under. It used to be written out three times — the
 * canonical `standaloneActionOwnerKey` in `@objectstack/objectql`, this
 * package's `standaloneActionObjectName`, and a private `actionObjectKey` on
 * `ObjectQLPlugin` — and the only thing holding them equal was a sentence in
 * each one's docblock saying it must stay in lockstep with the others.
 *
 * That is documentation standing in for a check, and it had already been paid
 * for once: #14123 was two readers of "where does this declaration live"
 * answering from different code. The plugin copy had also drifted in the one
 * way a copy can drift invisibly — it terminated on a bare `'global'` literal
 * instead of the shared constant, equal in value today and silently different
 * the day the constant moves.
 *
 * So this file is the check. Half A pins the BEHAVIOUR (the surviving alias
 * agrees with the canonical helper across the whole ladder, and its
 * object-less rung is the CONSTANT, not a literal that happens to match it).
 * Half B pins the STRUCTURE, because behaviour alone cannot see a re-inlined
 * copy: a byte-identical second spelling passes every assertion in half A. Half
 * B reads this package's own source and fails if the ladder grows a second
 * body here.
 *
 * Half C closes the same hole one level down (#14678). #14422 converged the
 * LADDER, and the runtime kept three bare `'global'` spellings elsewhere in
 * `action-execution.ts` that the ladder check could not see: a live comparison
 * in `seedFlowActionParams`, a warn-once log key in `enforceActionParams`, and
 * a docblock. All three were equal in value and invisible to every test in the
 * repo, which is the whole shape #14422 was filed to remove — so the same
 * convergence needed the same weld, or the next reader re-inlines one and
 * nothing says so.
 *
 * Half D (#14878) is the odd one out and says so at its own section below: it
 * is not about this package's source at all. It is the TREE-scoped absence pin
 * for the plugin member this convergence deleted, carried here as well as in
 * `@objectstack/objectql` so that losing either copy still leaves a guard.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { GLOBAL_ACTION_OBJECT_KEY, standaloneActionOwnerKey } from '@objectstack/objectql';
import {
    standaloneActionObjectName,
    standaloneActionOwnerKey as reExportedOwnerKey,
    type ActionExecutionDeps,
} from './action-execution.js';

/** `standaloneActionObjectName` ignores its first parameter — see its docblock. */
const NO_DEPS = undefined as unknown as ActionExecutionDeps;

/**
 * Every rung, plus the guards that decide which rung answers. The empty-string
 * and wrong-type rows are the ones a re-spelling gets wrong: `objectName: ''`
 * must FALL THROUGH to `object` rather than answering `''`.
 */
const LADDER_CASES: Array<{ label: string; action: any; expected: string }> = [
    { label: 'rung 1 — spec `objectName`', action: { objectName: 'todo_task' }, expected: 'todo_task' },
    { label: 'rung 1 wins over rung 2', action: { objectName: 'a', object: 'b' }, expected: 'a' },
    { label: 'rung 2 — bundle-collector `object`', action: { object: 'todo_task' }, expected: 'todo_task' },
    { label: 'empty `objectName` falls through', action: { objectName: '', object: 'b' }, expected: 'b' },
    { label: 'non-string `objectName` falls through', action: { objectName: 42, object: 'b' }, expected: 'b' },
    { label: 'rung 3 — no keys at all', action: {}, expected: GLOBAL_ACTION_OBJECT_KEY },
    { label: 'rung 3 — both empty', action: { objectName: '', object: '' }, expected: GLOBAL_ACTION_OBJECT_KEY },
    { label: 'rung 3 — undefined action', action: undefined, expected: GLOBAL_ACTION_OBJECT_KEY },
    { label: 'rung 3 — null action', action: null, expected: GLOBAL_ACTION_OBJECT_KEY },
];

describe('standalone-action owner key — half A: one behaviour (#14422)', () => {
    it.each(LADDER_CASES)('$label', ({ action, expected }) => {
        expect(standaloneActionOwnerKey(action)).toBe(expected);
        expect(standaloneActionObjectName(NO_DEPS, action)).toBe(expected);
    });

    it('re-exports the engine helper itself, not a copy of it', () => {
        expect(reExportedOwnerKey).toBe(standaloneActionOwnerKey);
    });

    it('answers the object-less rung with the CONSTANT, so a moved constant moves both', () => {
        // Asserting against the imported constant rather than the string
        // `'global'` is the whole point: a spelling that hard-codes the literal
        // agrees with this today and stops agreeing the day the constant moves.
        expect(standaloneActionObjectName(NO_DEPS, {})).toBe(GLOBAL_ACTION_OBJECT_KEY);
        expect(standaloneActionOwnerKey({})).toBe(GLOBAL_ACTION_OBJECT_KEY);
    });
});

/**
 * The rung-1 test as it is actually written, in `action-governance.ts`. Half B
 * searches THIS package for it; finding it here would mean the ladder had been
 * re-inlined rather than delegated.
 */
const LADDER_RUNG_1 = "typeof action?.objectName === 'string' && action.objectName.length > 0";

function readActionExecutionSource(): string {
    const here = dirname(fileURLToPath(import.meta.url));
    return readFileSync(join(here, 'action-execution.ts'), 'utf8');
}

/**
 * Quote spellings of the object-less key as a bare literal, DERIVED from the
 * constant rather than hard-coded.
 *
 * Deriving it is the point, not a flourish. A hard-coded `'global'` here would
 * be a fourth copy of the very literal this file exists to forbid, and it
 * would go stale in the same silence the day the constant moves. Derived, the
 * guard follows the constant: whatever `GLOBAL_ACTION_OBJECT_KEY` becomes,
 * that is the spelling `action-execution.ts` may not write out by hand. The
 * re-inlining it catches is caught at the moment it happens, while the two
 * spellings are still equal — which is the only moment a reader can tell they
 * were ever meant to be one thing.
 */
const BARE_LITERALS: readonly string[] = [
    `'${GLOBAL_ACTION_OBJECT_KEY}'`,
    `"${GLOBAL_ACTION_OBJECT_KEY}"`,
    `\`${GLOBAL_ACTION_OBJECT_KEY}\``,
];

describe('standalone-action owner key — half B: one spelling (#14422)', () => {
    it('keeps no ladder body of its own in action-execution.ts', () => {
        const src = readActionExecutionSource();
        // A parse that silently matches nothing would restore exactly the
        // can-never-fail property this file replaced, so prove the anchor first.
        expect(src).toContain('export function standaloneActionObjectName');
        expect(src).not.toContain(LADDER_RUNG_1);
    });

    it('resolves `standaloneActionObjectName` by delegation', () => {
        const src = readActionExecutionSource();
        const body = src.match(
            /export function standaloneActionObjectName\([^)]*\): string \{([\s\S]*?)\n\}/,
        );
        if (!body) {
            throw new Error(
                'Could not locate `standaloneActionObjectName` in action-execution.ts. '
                + 'The #14422 single-source weld cannot verify itself — fix this parse rather than deleting it.',
            );
        }
        expect(body[1].trim()).toBe('return standaloneActionOwnerKey(action);');
    });
});

describe('standalone-action owner key — half C: no bare literal (#14678)', () => {
    it('spells the object-less key as the CONSTANT everywhere in action-execution.ts', () => {
        const src = readActionExecutionSource();

        // Anti-vacuity, twice over. An empty read, or a file that does not
        // import the constant at all, would make every negative below pass for
        // exactly the wrong reason — the can-never-fail property this whole
        // file was written to replace. Both controls are positive assertions
        // against text the converged file must carry.
        //
        // [#14864] The second control used to be the `seedFlowActionParams`
        // comparison `objectName !== GLOBAL_ACTION_OBJECT_KEY`. That guard is
        // gone — it was one of the two rival answers to "is this route
        // object-less", and it now delegates to `isObjectLessActionKey` like
        // its neighbours. Re-anchored rather than deleted, and deliberately
        // onto a site this file's own subject does not move: the warn-once log
        // key in `enforceActionParams`, which is the SECOND of the three bare
        // literals #14678 converged and is untouched by the predicate work.
        // ⛔ Do not re-anchor a control onto the thing the next change is most
        // likely to edit — a control that moves with its subject stops being a
        // control.
        expect(src).toContain('GLOBAL_ACTION_OBJECT_KEY');
        expect(src).toContain('where.objectName ?? GLOBAL_ACTION_OBJECT_KEY');

        for (const literal of BARE_LITERALS) {
            expect(
                src.includes(literal),
                `action-execution.ts writes the object-less action key as the bare literal `
                + `${literal}. It is equal in value to GLOBAL_ACTION_OBJECT_KEY today and parts `
                + `from it in silence the day the constant moves (#14422, #14678). Import the `
                + `constant — this file already does — and compare or interpolate that instead.`,
            ).toBe(false);
        }
    });
});

/**
 * ── Half D [#14878]: the absence assertion is TREE-scoped, not FILE-scoped ───
 *
 * #14667 deleted a private `actionObjectKey` member from `ObjectQLPlugin` and
 * DID write a guard for it — `not.toContain(...)` against `plugin.ts`. The kind
 * of guard was right; its SCOPE was the defect. A pin written by the deleting PR
 * can only look where its author thought to look, and the whole failure mode is
 * references the author did not know about: five files in three other packages
 * went on naming the dead member as something that reads a key TODAY, and one
 * deletion produced two separate follow-up cards.
 *
 * Widening to the tree also covers the half nothing keyed on the deleting diff
 * can see. Three of those five references already existed when the member died.
 * The other two were written 1 h 41 min AFTER it, by a later PR, into a file
 * that was clean at deletion time — so a check that greps the deleting PR's own
 * post-image is structurally blind to them. A pin that runs on every PR is not.
 *
 * ⛔ AN ASSERTION OF ABSENCE IS NOT A STALE MENTION. This file and its twin in
 * `@objectstack/objectql` name the dead member because naming it is how they
 * hunt for it; "repairing" those lines deletes the guard. Both pins therefore
 * exclude themselves below, with the reason written beside the rule.
 *
 * ── Why this is carried twice, on purpose ───────────────────────────────────
 *
 * Either copy alone catches everything — the scan is the same tree both times.
 * The redundancy is against the ONE failure the file-scoped pin already
 * demonstrated: a guard disappearing with the file that held it. Two packages
 * hold it, so deleting one leaves the property still pinned. Sharing the scan
 * through a helper module would undo exactly that, and it would put a new
 * always-loaded module in `scripts/` for a pin — which is the machinery this
 * shape was chosen to avoid.
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
 * cannot reach the population it judges. Measured on c4d1354e3: all 41 tracked
 * test files outside `packages/` are under `examples/`, so that one glob empties
 * the NARROW class the specimen case stands for — test files outside
 * `packages/**`, 41 → 0 — and exactly one case reds: that specimen. It does NOT
 * empty the residue class the CLASS-LEVEL case guards, which counts every
 * tracked test file no hint of that gate reaches: that one goes 13 → 3 and stays
 * GREEN, the survivors being the three `.tsx` tests inside `packages/`. So the
 * specimen COULD be re-pointed at one of those three — that is option B on
 * #15097, ruled OUT for now: ruling A accepts `packages/` as this pin's radius.
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
 * `scripts/cross-package-test-inputs.mjs`. A THIRD edit — a matching ci.yml
 * `crosspkg:` entry, which `check-ci-filter-parity.mjs` gates — is owed only by
 * a root that NEITHER `core:` nor `crosspkg:` already covers, because that
 * gate's `SCHEDULING_FILTERS` is those two judged as an OR. It does not bind for
 * `examples/`: ci.yml's `core:` filter already carries that root, and measured
 * on c4d1354e3 with the examples glob planted, `check-ci-filter-parity.mjs`
 * exits 0 — "OK: all 144 declared cross-package glob(s) (100 unique) are covered
 * by `core` or `crosspkg`". Read the two filters before assuming the third edit.
 * Widening the scanner alone reads as coverage while turbo never re-runs this
 * suite for the files it now claims to judge.
 */

/**
 * The member #14667 deleted from `ObjectQLPlugin`. Held as DATA: naming a symbol
 * in a string cannot resurrect it, and this file is excluded from its own scan
 * precisely so it may carry the name.
 */
const DELETED_PLUGIN_MEMBER = 'actionObjectKey';

/**
 * The live spelling that replaced it, used as the scan's reach control below. It
 * is the one symbol the convergence guarantees in both scanned roots, so if it
 * ever stops being there this pin says so loudly rather than quietly stopping.
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
 * ⛔ A scan-SCOPE decision written where the scan lives, and it must stay that.
 * An allowlist FILE — one more path pasted in whenever a report is inconvenient
 * — is the permission slip this shape exists to avoid. A rule here has to be a
 * statement about a CLASS of file that is true by construction, never "this one
 * site is fine".
 *
 * The first two rules cannot fire while `SCANNED_EXTENSION` is `.ts`, and they
 * are kept anyway: they are the ruled exclusions, and the day someone widens the
 * extension set they are what stops the release record from being re-admitted as
 * a pile of false reds.
 */
const NOT_A_STALE_MENTION: ReadonlyArray<{ readonly covers: (file: string) => boolean; readonly why: string }> = [
    {
        // A published CHANGELOG entry is the record OF the removal: true in the
        // past tense, and what a consumer reads to learn the member is gone.
        covers: (file) => file === 'CHANGELOG.md' || file.endsWith('/CHANGELOG.md'),
        why: 'a published CHANGELOG is the record of the removal itself',
    },
    {
        // The same record before the release process compiles it into the above.
        covers: (file) => file.startsWith('.changeset/'),
        why: 'a changeset is that record before it is compiled into a CHANGELOG',
    },
    {
        // The pins carry the name as their own search string. Excluding them is
        // what lets the pin exist at all: a scan that flagged its own needle
        // would have no green state.
        covers: (file) => PIN_FILES.includes(file),
        why: 'the pin carries the name as its own search string — repairing it deletes the guard',
    },
];

/** …/packages/runtime/src → repo root, by arithmetic from this file. */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** The tree this pin binds. See the scope note above before changing it. */
const SCANNED_ROOTS: readonly string[] = ['packages'];

/** Spelled once so the declared glob and the scan stay in correspondence. */
const SCANNED_EXTENSION = '.ts';

/**
 * Generous on purpose. The scan is one `git grep` and a handful of file reads,
 * so this is headroom against a merge-queue runner doing a full monorepo build
 * at the same time, not a budget. A pin that times out before its assertion runs
 * reports nothing, and reporting nothing is indistinguishable from finding
 * nothing.
 */
const SCAN_TIMEOUT_MS = 60_000;

function git(args: string[]): string[] {
    let stdout: string;
    try {
        stdout = execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
    } catch (error) {
        const failure = error as { status?: number; stderr?: string };
        // `git grep` exits 1 for "found nothing", which is data. Anything else is
        // a BROKEN scan and must never read as "no stale mentions".
        if (failure.status === 1) return [];
        throw new Error(
            `git ${args.join(' ')} failed with status ${String(failure.status)}: ${failure.stderr ?? ''}`,
        );
    }
    return stdout.split('\0').filter((entry) => entry.length > 0);
}

/**
 * Every scanned file that so much as mentions `symbol`. Tracked files PLUS
 * untracked ones with ignored paths excluded (`--untracked`) — exactly the files
 * a human authored, never build output. A file written but not yet `git add`ed
 * still reddens, which keeps this a local-loop guard.
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

describe('standalone-action owner key — half D: the deleted member is dead TREE-WIDE (#14878)', () => {
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
                          'member deleted when the standalone-action owner-key ladder was converged',
                          'onto one spelling:',
                          '',
                          ...sites.map((site) => `  - ${site}`),
                          '',
                          `The live spelling is \`${CANONICAL_HELPER}\`, exported from`,
                          '`@objectstack/objectql` (packages/objectql/src/action-governance.ts). If the',
                          'sentence is otherwise accurate, rename the one word rather than rewriting',
                          'the clause — the neighbouring names are usually alive.',
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
            // Anti-vacuity, at both stages a tree scan can go silently blind. A
            // grep that matched nothing — wrong repo root, git missing, a
            // pathspec naming no tree — yields the same empty violation set as a
            // clean repo, and the assertion above cannot tell them apart. That is
            // exactly the property the file-scoped pin lost.
            expect(filesMentioning(DELETED_PLUGIN_MEMBER)).toContain(PIN_FILES[1]);

            // ...and it must LEAVE this package, which is the half a file-scoped
            // pin never had. The CLI site below is one of the files that carried
            // the DEAD name until it was repaired, so a scan that cannot see it
            // is a scan that would not have caught the defect this pin is for.
            const reached = filesMentioning(CANONICAL_HELPER);
            expect(reached).toContain('packages/cli/src/commands/lint.ts');
            expect(reached).toContain('packages/objectql/src/action-governance.ts');
        },
        SCAN_TIMEOUT_MS,
    );
});
