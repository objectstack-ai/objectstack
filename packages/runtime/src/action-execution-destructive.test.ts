// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7828 — `actionLooksDestructive` classifies on declared semantics only.
 *
 * Binding ruling (issue #7828, comment 5265943521, Option A): drop the
 * `confirmText` leg. `mode === 'delete' || variant === 'danger'` remain the
 * signal, because those are closed, declared enumerations an author sets on
 * purpose — `confirmText` is UI dialog copy, and #7278/#7309 are actively
 * migrating authors away from pairing it with `params`-bearing actions (the
 * confirm question now rides `description`). Measured on #7309's branch
 * (merged PR #7827): 6 of its 14 migrated identity actions flipped from
 * destructive to not-destructive the moment their `confirmText` was dropped,
 * because none of them carries `mode: 'delete'` or `variant: 'danger'` to
 * fall back on.
 *
 * ## Is this observable on a live path today?
 *
 * `actionLooksDestructive`'s sole caller is `summarizeAction`, reached only
 * from the MCP `listActions` bridge (`packages/runtime/src/domains/mcp.ts`,
 * the sole production implementer of `packages/mcp`'s `McpActionBridge`).
 * That bridge gates every candidate action through THREE checks before
 * `summarizeAction` ever runs:
 *
 *   1. fail-closed on `sys_*` objects unless the action declares
 *      `ai.exposed: true` (`systemObjectActionExposureError`, #27681)
 *   2. `isHeadlessInvokableAction` — `type: 'script'` (with `target` or
 *      `body`), `type: 'flow'` (with `target` + an automation service), or —
 *      since #27506 — a `type: 'api'` action with a SAME-ORIGIN `target`,
 *      which the doors forward in-process
 *   3. `actionAiExposureError` — excluded unless the author set
 *      `ai.exposed: true`
 *
 * All 14 of #7309's identity actions lived on `sys_*` objects (13 still do), are
 * `type: 'api'` with same-origin targets, and none declares `ai.exposed`. So
 * today's real declarations are excluded before `actionLooksDestructive` ever
 * runs on them (gate 2 was another ground until #27506 admitted same-origin api
 * actions, which is pinned below so the count of grounds is a measurement, not
 * a memory). Since #27681 gates 1 and 3 read ONE fact — the action's own
 * `ai.exposed` — so the exclusion is one ground asserted at both gates, not two
 * independent ones — this fix had zero observable effect on any request a
 * caller could make when it landed. Since ADR-0011's 2026-10-30 addendum seven
 * of the 13 declare `ai.exposed` and reach the classifier; the last `describe`
 * below pins which.
 *
 * That is a fact about *today's platform objects*, not about the heuristic —
 * a future `ai.exposed`, non-`sys_*`, `script`/`flow` action carrying only
 * `confirmText` WOULD have its classification flip live, which is exactly
 * the erosion #7828 was filed to stop before it reaches a reachable action.
 * `describe('the boundary IS reachable in general …')` below proves that
 * with a synthetic action shaped like one, through the real `summarizeAction`
 * boundary — the same function production callers actually go through, and
 * the honest edge of what a unit test can pin without also re-deriving the
 * gate wiring in `domains/mcp.ts`, which this fix does not touch.
 */

import { describe, it, expect } from 'vitest';
import {
    actionLooksDestructive,
    summarizeAction,
    isSystemObjectName,
    systemObjectActionExposureError,
    actionAiExposureError,
    isHeadlessInvokableAction,
    type ActionExecutionDeps,
} from './action-execution.js';
import {
    SysUser,
    SysTwoFactor,
    SysOrganization,
    SysOauthApplication,
    SysAccount,
    SysSsoProvider,
    SysTeamMember,
} from '@objectstack/platform-objects/identity';

const deps: ActionExecutionDeps = {
    resolveService: (async () => undefined) as any,
    getObjectQL: async () => null,
};

function actionByName(obj: any, name: string): any {
    const found = (obj?.actions ?? []).find((a: any) => a?.name === name);
    if (!found) throw new Error(`fixture action '${name}' not found on '${obj?.name}' — object shape moved`);
    return found;
}

// ---------------------------------------------------------------------------
// Required pin, direction 1 — a `confirmText`-only action no longer
// classifies as destructive.
// ---------------------------------------------------------------------------

describe('actionLooksDestructive: confirmText alone is no longer a signal (#7828 Option A)', () => {
    it('confirmText present, no mode/variant signal → not destructive', () => {
        const action = { name: 'ask', confirmText: 'Are you sure?' };
        expect(actionLooksDestructive(deps, action)).toBe(false);
    });

    it('confirmText + a non-danger variant → still not destructive', () => {
        const action = { name: 'ask', confirmText: 'Are you sure?', variant: 'secondary' };
        expect(actionLooksDestructive(deps, action)).toBe(false);
    });

    it('confirmText + a non-delete mode → still not destructive', () => {
        const action = { name: 'ask', confirmText: 'Are you sure?', mode: 'custom' };
        expect(actionLooksDestructive(deps, action)).toBe(false);
    });

    it('no confirmText, no mode/variant signal at all → not destructive (unchanged)', () => {
        expect(actionLooksDestructive(deps, { name: 'noop' })).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Required pin, direction 2 — `mode: 'delete'` and `variant: 'danger'` still
// classify as destructive. This is the direction that stops the fix from
// being "delete the function" — a leg dropped from an OR must not silently
// become "never destructive".
// ---------------------------------------------------------------------------

describe("actionLooksDestructive: mode:'delete' and variant:'danger' still classify destructive", () => {
    it("mode: 'delete', no confirmText → still destructive", () => {
        expect(actionLooksDestructive(deps, { name: 'wipe', mode: 'delete' })).toBe(true);
    });

    it("variant: 'danger', no confirmText → still destructive", () => {
        expect(actionLooksDestructive(deps, { name: 'wipe', variant: 'danger' })).toBe(true);
    });

    it("mode: 'delete' AND confirmText together → still destructive (the leg's removal doesn't touch this combination)", () => {
        expect(actionLooksDestructive(deps, { name: 'wipe', mode: 'delete', confirmText: 'Sure?' })).toBe(true);
    });

    it("variant: 'danger' AND confirmText together → still destructive", () => {
        expect(actionLooksDestructive(deps, { name: 'wipe', variant: 'danger', confirmText: 'Sure?' })).toBe(true);
    });

    it('an explicit `ai.requiresConfirmation` override still wins over everything else (pre-existing behaviour, unchanged by this fix)', () => {
        expect(actionLooksDestructive(deps, { mode: 'delete', ai: { requiresConfirmation: false } })).toBe(false);
        expect(actionLooksDestructive(deps, { confirmText: 'Sure?', ai: { requiresConfirmation: true } })).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// The 6-of-14 flipped identity actions, read off their REAL declarations
// (not hand-rolled fixtures) — the check the ruling explicitly calls for. Five
// are still platform declarations; the sixth, `sys_organization.change_slug`,
// left the platform object (its door is the cloud orchestrator's, and the
// composition that mounts it declares it), so it is pinned absent instead.
// ---------------------------------------------------------------------------

describe('the 5 identity actions #7309 flipped that the platform still declares, off their real declarations', () => {
    const flipped: Array<[string, any, any]> = [
        ['sys_user.generate_backup_codes', SysUser, 'generate_backup_codes'],
        ['sys_two_factor.regenerate_backup_codes', SysTwoFactor, 'regenerate_backup_codes'],
        ['sys_oauth_application.enable_oauth_application', SysOauthApplication, 'enable_oauth_application'],
        ['sys_oauth_application.disable_oauth_application', SysOauthApplication, 'disable_oauth_application'],
        ['sys_oauth_application.rotate_client_secret', SysOauthApplication, 'rotate_client_secret'],
    ];

    // ADR-0011's 2026-10-30 addendum (ruling 6523087116 on #27900) exposes
    // `disable_oauth_application` in bucket C, with `ai.requiresConfirmation:
    // true`: the declared override now decides its classification — the
    // precedence pinned above — so the heuristic's flip is read on the other
    // four, which declare no override.
    const heuristicOnly = flipped.filter(([, obj, name]) => actionByName(obj, name).ai?.requiresConfirmation === undefined);

    it('one of the five now declares an override, and it wins: disable_oauth_application (bucket C) → destructive', () => {
        expect(flipped.filter((row) => !heuristicOnly.includes(row)).map(([label]) => label))
            .toEqual(['sys_oauth_application.disable_oauth_application']);
        const action = actionByName(SysOauthApplication, 'disable_oauth_application');
        expect(action.ai?.requiresConfirmation).toBe(true);
        expect(actionLooksDestructive(deps, action)).toBe(true);
    });

    it.each(heuristicOnly)('%s: no confirmText, no mode:delete/variant:danger, no ai override → not destructive', (_label, obj, name) => {
        const action = actionByName(obj, name);
        // Guard the fixture's own premise: it must actually be the shape
        // #7828 describes, or this pin proves nothing.
        expect(action.confirmText, `${name} still carries confirmText — #7309's migration regressed`).toBeUndefined();
        expect(action.mode).not.toBe('delete');
        expect(action.variant).not.toBe('danger');
        expect(actionLooksDestructive(deps, action)).toBe(false);
    });

    it('sys_organization no longer declares change_slug, the sixth', () => {
        expect(flipped).toHaveLength(5);
        expect((SysOrganization.actions ?? []).map((a: any) => a.name)).not.toContain('change_slug');
    });
});

// ---------------------------------------------------------------------------
// Same identity object family, actions that DO still classify destructive —
// the direct check that the fix did not turn "destructive" off wholesale for
// the family the flipped 6 live in.
// ---------------------------------------------------------------------------

describe('sibling identity actions with a declared destructive signal still read destructive', () => {
    it("sys_two_factor.disable_two_factor (variant: 'danger', confirmText dropped in #7309) → still destructive", () => {
        const action = actionByName(SysTwoFactor, 'disable_two_factor');
        expect(action.variant).toBe('danger');
        expect(actionLooksDestructive(deps, action)).toBe(true);
    });

    it("sys_organization.delete_organization (mode: 'delete' + variant: 'danger' + confirmText) → still destructive", () => {
        const action = actionByName(SysOrganization, 'delete_organization');
        expect(action.mode).toBe('delete');
        expect(action.variant).toBe('danger');
        expect(action.confirmText).toBeTruthy();
        expect(actionLooksDestructive(deps, action)).toBe(true);
    });

    it("sys_organization.leave_organization (variant: 'danger', confirmText, no mode:delete) → still destructive off variant alone", () => {
        const action = actionByName(SysOrganization, 'leave_organization');
        expect(action.variant).toBe('danger');
        expect(action.mode).not.toBe('delete');
        expect(actionLooksDestructive(deps, action)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Observable boundary — `summarizeAction`, the sole caller, is what actually
// produces the `requiresConfirmation` field a caller reads. Pinned at this
// boundary (not just the raw predicate) so the field name/wiring the ruling
// cares about is covered, not just the internal function.
// ---------------------------------------------------------------------------

describe('summarizeAction: requiresConfirmation reflects the same declared-semantics rule', () => {
    const obj = { fields: {} };

    it('confirmText-only action summarizes requiresConfirmation: false', () => {
        const action = { name: 'ask', type: 'script', target: 'x', confirmText: 'Sure?' };
        const summary = summarizeAction(deps, action, obj, 'todo_task');
        expect(summary.requiresConfirmation).toBe(false);
    });

    it("mode: 'delete' action summarizes requiresConfirmation: true", () => {
        const action = { name: 'wipe', type: 'script', target: 'x', mode: 'delete' };
        const summary = summarizeAction(deps, action, obj, 'todo_task');
        expect(summary.requiresConfirmation).toBe(true);
    });

    it("variant: 'danger' action summarizes requiresConfirmation: true", () => {
        const action = { name: 'wipe', type: 'script', target: 'x', variant: 'danger' };
        const summary = summarizeAction(deps, action, obj, 'todo_task');
        expect(summary.requiresConfirmation).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// The boundary IS reachable in general — proven with a synthetic action
// shaped exactly like a future `ai.exposed`, non-`sys_*`, headless-invokable
// action, so "latent today" is pinned as a fact about today's identity
// objects, not mistaken for a fact about the classifier being unreachable in
// principle. This is the shape #7828 was filed to protect against.
// ---------------------------------------------------------------------------

describe('the classification IS live-reachable for a shape gate 1/2/3 all pass — not merely latent by construction', () => {
    it('a real example app action passes all three MCP listActions gates today (todo_task.delete_completed, examples/app-todo)', () => {
        // Mirrors examples/app-todo/src/actions/task.actions.ts `delete_completed`
        // field for field on the properties the three gates and the classifier
        // read — the one non-sys, ai.exposed, headless action in the repo that
        // still carries both confirmText and a mode/variant signal. It does NOT
        // flip (variant: 'danger' already covers it), which is itself evidence
        // that nothing shipped today silently changes behaviour under this fix.
        const action = {
            name: 'delete_completed',
            objectName: 'todo_task',
            type: 'script',
            target: 'deleteCompletedTasks',
            variant: 'danger',
            confirmText: 'Permanently delete all completed tasks? This cannot be undone.',
            ai: { exposed: true, description: 'Permanently delete every completed todo task.' },
        };
        expect(isSystemObjectName(action.objectName)).toBe(false);
        expect(isHeadlessInvokableAction(deps, action, false)).toBe(true);
        expect(actionAiExposureError(deps, action, action.objectName)).toBeNull();
        expect(actionLooksDestructive(deps, action)).toBe(true);
    });

    it('the SAME shape with confirmText only (no mode/variant) — the erosion #7828 stops — would have flipped without this fix, and reads not-destructive now', () => {
        const action = {
            name: 'hypothetical_ai_exposed_action',
            objectName: 'todo_task',
            type: 'script',
            target: 'someHandler',
            confirmText: 'Are you sure?',
            ai: { exposed: true, description: 'A hypothetical AI-exposed action.' },
        };
        expect(isSystemObjectName(action.objectName)).toBe(false);
        expect(isHeadlessInvokableAction(deps, action, false)).toBe(true);
        expect(actionAiExposureError(deps, action, action.objectName)).toBeNull();
        // This is the exact defect class #7828 closes: a UI-copy field must not
        // decide an AI-facing safety property.
        expect(actionLooksDestructive(deps, action)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Documents (with real assertions, not narration) why today's 13 identity
// actions never reach the classifier via the live MCP path — confirming the
// #7828 triage comment's "double-gated dead". The third gate this file once
// recorded (isHeadlessInvokableAction: all 13 are `type: 'api'`) no longer
// holds: #27506 made a same-origin api action server-dispatched, so gate 2
// ADMITS all 13 and gates 1 and 3 carry the exclusion alone.
// #7309 converted 14; `sys_organization.change_slug` left the platform object.
//
// Since ADR-0011's 2026-10-30 addendum (ruling 6523087116 on #27900) seven of
// the 13 declare `ai.exposed` (buckets E and C), so gates 1 and 3 ADMIT them
// and the classifier is reached on a real identity action; the six human-only
// ones (bucket H) declare no `ai` block and stay excluded at both gates.
// ---------------------------------------------------------------------------

describe('the 13 #7309 identity actions the platform still declares: the human-only six are excluded before actionLooksDestructive runs, the exposed seven reach it', () => {
    // The 13 of the 14 sites #7309 converted that the platform still
    // declares — same set pinned by
    // `platform-objects/src/identity/action-confirm-one-dialog.test.ts`'s
    // `CONVERTED` map, reproduced here rather than imported so this suite
    // does not depend on that test file's internals staying exported.
    const allThirteen: Array<[string, string, any, string]> = [
        ['sys_user.ban_user', 'sys_user', SysUser, 'ban_user'],
        ['sys_user.delete_my_account', 'sys_user', SysUser, 'delete_my_account'],
        ['sys_user.disable_two_factor', 'sys_user', SysUser, 'disable_two_factor'],
        ['sys_user.generate_backup_codes', 'sys_user', SysUser, 'generate_backup_codes'],
        ['sys_oauth_application.enable_oauth_application', 'sys_oauth_application', SysOauthApplication, 'enable_oauth_application'],
        ['sys_oauth_application.disable_oauth_application', 'sys_oauth_application', SysOauthApplication, 'disable_oauth_application'],
        ['sys_oauth_application.rotate_client_secret', 'sys_oauth_application', SysOauthApplication, 'rotate_client_secret'],
        ['sys_oauth_application.delete_oauth_application', 'sys_oauth_application', SysOauthApplication, 'delete_oauth_application'],
        ['sys_two_factor.disable_two_factor', 'sys_two_factor', SysTwoFactor, 'disable_two_factor'],
        ['sys_two_factor.regenerate_backup_codes', 'sys_two_factor', SysTwoFactor, 'regenerate_backup_codes'],
        ['sys_account.unlink_account', 'sys_account', SysAccount, 'unlink_account'],
        ['sys_sso_provider.delete_sso_provider', 'sys_sso_provider', SysSsoProvider, 'delete_sso_provider'],
        ['sys_team_member.remove_team_member', 'sys_team_member', SysTeamMember, 'remove_team_member'],
    ];

    it('the fixture reproduces the 13 #7309 sites the platform still declares, no more, no fewer', () => {
        expect(allThirteen).toHaveLength(13);
    });

    const exposed = new Set([
        'sys_user.ban_user',
        'sys_oauth_application.enable_oauth_application',
        'sys_oauth_application.disable_oauth_application',
        'sys_oauth_application.delete_oauth_application',
        'sys_account.unlink_account',
        'sys_sso_provider.delete_sso_provider',
        'sys_team_member.remove_team_member',
    ]);
    const humanOnly = allThirteen.filter(([label]) => !exposed.has(label));
    const exposedRows = allThirteen.filter(([label]) => exposed.has(label));

    it('seven are exposed and six human-only', () => {
        expect(exposedRows).toHaveLength(7);
        expect(humanOnly.map(([label]) => label)).toEqual([
            'sys_user.delete_my_account',
            'sys_user.disable_two_factor',
            'sys_user.generate_backup_codes',
            'sys_oauth_application.rotate_client_secret',
            'sys_two_factor.disable_two_factor',
            'sys_two_factor.regenerate_backup_codes',
        ]);
    });

    it.each(humanOnly)('%s is excluded by systemObjectActionExposureError (gate 1: sys_* fail-closed unless ai.exposed)', (_label, objName, obj, name) => {
        expect(isSystemObjectName(objName)).toBe(true);
        // Since #27681 the name alone no longer decides: the action's own
        // `ai.exposed` does, and a human-only action declares none.
        expect(systemObjectActionExposureError(deps, actionByName(obj, name), objName)).toMatch(/system object/);
    });

    it.each(exposedRows)('%s is admitted at gates 1 and 3 (its own ai.exposed), and its listing classification is the declared one', (_label, objName, obj, name) => {
        const action = actionByName(obj, name);
        expect(action.ai?.exposed).toBe(true);
        expect(systemObjectActionExposureError(deps, action, objName)).toBeNull();
        expect(actionAiExposureError(deps, action)).toBeNull();
        // Bucket C declares `requiresConfirmation: true`; the one bucket E row
        // (`enable_oauth_application`) declares none and carries no
        // mode/variant signal, so it reads not destructive.
        expect(summarizeAction(deps, action, { fields: {} }, objName).requiresConfirmation)
            .toBe(action.ai?.requiresConfirmation === true);
    });

    it.each(allThirteen)('%s is ADMITTED by isHeadlessInvokableAction since #27506 (gate 2: a same-origin api action is server-dispatched)', (_label, _objName, obj, name) => {
        const action = actionByName(obj, name);
        expect(action.type).toBe('api');
        expect(String(action.target).startsWith('/')).toBe(true);
        expect(isHeadlessInvokableAction(deps, action, true)).toBe(true);
    });

    it.each(humanOnly)('%s is excluded by actionAiExposureError (gate 3: ai.exposed not set)', (_label, _objName, obj, name) => {
        const action = actionByName(obj, name);
        expect(action.ai?.exposed).not.toBe(true);
        // Matches the real call site (domains/mcp.ts listActions): 2-arg, no
        // `objectName` — real action declarations don't carry that field
        // inline (it's the enclosing object's `.name`, tracked separately by
        // `collectActionDeclarations`).
        expect(actionAiExposureError(deps, action)).not.toBeNull();
    });
});
