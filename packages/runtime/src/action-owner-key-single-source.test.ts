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
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
