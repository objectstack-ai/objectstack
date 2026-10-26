// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #26188 — a HIERARCHY scope (`own_and_reports` / `unit` / `unit_and_below`) on
 * a runtime with no hierarchy resolver: refused on publish, a `warning` on a
 * draft save, nothing at all when a resolver is mounted.
 *
 * Harness: none. `evaluateRuntimeAuthoringGate` is pure — resolver presence
 * arrives as an argument. The rows through `saveMetaItem` / `publishMetaItem`
 * and a real service registry are in `protocol.runtime-authoring-gate.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { findHierarchyScopeGrants } from '@objectstack/spec/security';

import {
    evaluateRuntimeAuthoringGate,
    HIERARCHY_SCOPE_CAPABILITY_REQUIRED,
    type RuntimeAuthoringIssue,
} from './runtime-authoring-gate.js';

const managerSet = (grant: Record<string, unknown> = { allowRead: true, readScope: 'unit_and_below' }) => ({
    name: 'sales_manager',
    label: 'Sales Manager',
    objects: { opportunity: grant },
});

const judge = (over: Partial<Parameters<typeof evaluateRuntimeAuthoringGate>[0]> = {}) =>
    evaluateRuntimeAuthoringGate({
        type: 'permission',
        name: 'sales_manager',
        state: 'active',
        body: managerSet(),
        hierarchyResolverMounted: false,
        ...over,
    });

const hierarchyIssues = (issues: ReadonlyArray<RuntimeAuthoringIssue>) =>
    issues.filter((i) => i.rule === HIERARCHY_SCOPE_CAPABILITY_REQUIRED);

describe('#26188 — hierarchy scope without a resolver (pure gate)', () => {
    it('resolver absent, publish: refused in the gate\'s one 422 envelope, located at the grant', () => {
        const verdict = judge();
        const err = verdict.error as (Error & { code?: string; status?: number; issues?: any[]; rulesRun?: string[] }) | null;
        expect(err).toBeInstanceOf(Error);
        expect({ code: err!.code, status: err!.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
        expect(hierarchyIssues(err!.issues ?? [])).toEqual([
            expect.objectContaining({
                severity: 'error',
                rule: HIERARCHY_SCOPE_CAPABILITY_REQUIRED,
                path: 'permissions.sales_manager.objects.opportunity.readScope',
            }),
        ]);
        expect(err!.rulesRun).toContain(HIERARCHY_SCOPE_CAPABILITY_REQUIRED);
    });

    it('the message opens with the sentence `defineStack` refuses the same grant with, and names the enterprise capability', () => {
        const [issue] = hierarchyIssues((judge().error as any).issues);
        const [grant] = findHierarchyScopeGrants([managerSet()]);
        expect(issue.message.startsWith(`${grant!.finding}. `)).toBe(true);
        expect(issue.message).toContain('`hierarchy-security`');
    });

    it('resolver absent, draft: the save is let through with the same finding as a warning advisory', () => {
        const published = hierarchyIssues((judge().error as any).issues)[0];
        const verdict = judge({ state: 'draft' });
        expect(verdict.error).toBeNull();
        expect(verdict.advisories).toEqual([{ ...published, severity: 'warning' }]);
    });

    it('every hierarchy depth, on either axis, is judged; own and org are not', () => {
        for (const scope of ['own_and_reports', 'unit', 'unit_and_below'] as const) {
            for (const key of ['readScope', 'writeScope'] as const) {
                const issues = hierarchyIssues((judge({ body: managerSet({ allowRead: true, allowEdit: true, [key]: scope }) }).error as any)?.issues ?? []);
                expect(issues.map((i: any) => i.path), `${key}=${scope}`).toEqual([`permissions.sales_manager.objects.opportunity.${key}`]);
            }
        }
        for (const scope of ['own', 'org'] as const) {
            const verdict = judge({ body: managerSet({ allowRead: true, readScope: scope }) });
            expect(verdict.error, scope).toBeNull();
            expect(verdict.advisories, scope).toEqual([]);
        }
    });

    it('resolver mounted: nothing changes on either door', () => {
        expect(judge({ hierarchyResolverMounted: true }).error).toBeNull();
        expect(judge({ hierarchyResolverMounted: true }).advisories).toEqual([]);
        expect(judge({ state: 'draft', hierarchyResolverMounted: true }).advisories).toEqual([]);
    });

    it('presence unknown (a host with no service registry, as the CLI): nothing is judged', () => {
        expect(judge({ hierarchyResolverMounted: undefined }).error).toBeNull();
        expect(judge({ state: 'draft', hierarchyResolverMounted: undefined }).advisories).toEqual([]);
    });

    it('only a permission write is judged', () => {
        const verdict = judge({ type: 'object', state: 'draft' });
        expect(verdict.advisories).toEqual([]);
    });
});
