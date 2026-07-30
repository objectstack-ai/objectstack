// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0110 D5] Declaration ↔ executable reconciliation.
 *
 * ADR-0078 outlaws a declaration nothing executes (silently *inert*); ADR-0110
 * D3 outlaws an executable nothing declares (silently *ungoverned*). Together
 * they are one invariant — everything declared runs, everything that runs is
 * declared — and this reconciliation is what makes a violation visible at boot
 * instead of when a caller happens to hit the route.
 *
 * The load-bearing property: reconciliation derives handler keys through the
 * SAME {@link resolveActionHandlerKeys} the router dispatches through, so the
 * inventory can never disagree with what the route actually does. A test that
 * hard-coded its own key derivation would drift silently.
 */

import { describe, it, expect } from 'vitest';
import { reconcileActionRegistrations } from './action-execution.js';

const deps: any = { resolveService: () => undefined, getObjectQL: async () => undefined };

const reconcile = (
    registered: Array<{ objectName: string; actionName: string; package?: string }>,
    declarations: Array<{ action: any; objectName: string }>,
) => reconcileActionRegistrations(deps, registered, declarations);

describe('reconcileActionRegistrations — undeclared handlers (ADR-0110 D5)', () => {
    it('reconciles a target-bound handler to its declaration', async () => {
        // app-todo's real shape: registered under `completeTask`, declared as
        // `complete_task`. The names differ, so a naive name-equality check
        // would report a false orphan on every well-formed app.
        const { undeclaredHandlers } = reconcile(
            [{ objectName: 'todo_task', actionName: 'completeTask' }],
            [{ objectName: 'todo_task', action: { name: 'complete_task', type: 'script', target: 'completeTask' } }],
        );

        expect(undeclaredHandlers).toEqual([]);
    });

    it('reports a handler no declaration covers', async () => {
        const { undeclaredHandlers } = reconcile(
            [
                { objectName: 'todo_task', actionName: 'completeTask' },
                { objectName: 'todo_task', actionName: 'secretRecalc', package: 'app:todo' },
            ],
            [{ objectName: 'todo_task', action: { name: 'complete_task', type: 'script', target: 'completeTask' } }],
        );

        expect(undeclaredHandlers).toEqual([
            { objectName: 'todo_task', actionName: 'secretRecalc', package: 'app:todo' },
        ]);
    });

    it('reconciles a body action registered under its NAME', async () => {
        const { undeclaredHandlers } = reconcile(
            [{ objectName: 'todo_task', actionName: 'archive_task' }],
            [{ objectName: 'todo_task', action: { name: 'archive_task', type: 'script', body: 'return 1;' } }],
        );

        expect(undeclaredHandlers).toEqual([]);
    });

    it('does not let another OBJECT\'s declaration cover a handler', async () => {
        const { undeclaredHandlers } = reconcile(
            [{ objectName: 'crm_contact', actionName: 'completeTask' }],
            [{ objectName: 'todo_task', action: { name: 'complete_task', type: 'script', target: 'completeTask' } }],
        );

        expect(undeclaredHandlers).toHaveLength(1);
    });

    it('lets an object-less declaration cover an object-less handler', async () => {
        const { undeclaredHandlers } = reconcile(
            [{ objectName: 'global', actionName: 'logCall' }],
            [{ objectName: '*', action: { name: 'log_call', type: 'script', target: 'logCall' } }],
        );

        expect(undeclaredHandlers).toEqual([]);
    });
});

describe('reconcileActionRegistrations — unbound declarations (ADR-0078 side)', () => {
    it('reports a declared script action with no handler anywhere', async () => {
        const { unboundDeclarations } = reconcile(
            [],
            [{ objectName: 'todo_task', action: { name: 'complete_task', type: 'script', target: 'completeTask' } }],
        );

        expect(unboundDeclarations).toEqual([{ objectName: 'todo_task', actionName: 'complete_task' }]);
    });

    it('does not report a body action — its handler is synthesized', async () => {
        const { unboundDeclarations } = reconcile(
            [],
            [{ objectName: 'todo_task', action: { name: 'archive_task', type: 'script', body: 'return 1;' } }],
        );

        expect(unboundDeclarations).toEqual([]);
    });

    it('does not report non-script types — they dispatch elsewhere', async () => {
        const { unboundDeclarations } = reconcile(
            [],
            [
                { objectName: 'crm_lead', action: { name: 'convert_lead', type: 'flow', target: 'wizard' } },
                { objectName: 'crm_lead', action: { name: 'open_docs', type: 'url', target: 'https://x.test' } },
                { objectName: 'todo_task', action: { name: 'defer_task', type: 'modal', target: 'defer_modal' } },
            ],
        );

        expect(unboundDeclarations).toEqual([]);
    });

    it('accepts a handler registered under the object-less key for an object-scoped declaration', async () => {
        // `actionHandlerObjectKeys` rotates object → 'global' → '*' at
        // dispatch, so a declaration bound to a global handler IS reachable.
        const { unboundDeclarations } = reconcile(
            [{ objectName: 'global', actionName: 'completeTask' }],
            [{ objectName: 'todo_task', action: { name: 'complete_task', type: 'script', target: 'completeTask' } }],
        );

        expect(unboundDeclarations).toEqual([]);
    });
});
