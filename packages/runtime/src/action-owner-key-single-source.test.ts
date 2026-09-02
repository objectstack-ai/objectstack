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
