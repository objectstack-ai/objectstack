// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #15494 — the object probe plane must never convert a rule CRASH into
 * "nothing wrong".
 *
 * ## What this pins, and the state it replaces
 *
 * `runBuildProbes`' object plane re-runs `validateObjectFieldRefs` over each
 * published object's ACTIVE body and counts it in `checked.objects`. The call
 * was wrapped in `catch { findings = [] }`, so a rule that threw produced the
 * byte-identical receipt a genuinely clean object produces: the count went up,
 * the issue list stayed empty. That is the one reading this plane exists to
 * make impossible — it was added (#15254) precisely because a count that
 * cannot go up is indistinguishable from a plane that found nothing wrong, and
 * the silent catch reinstated the same ambiguity one layer in.
 *
 * The crash that motivated the card is a null entry in `stack.objects`
 * dereferenced by the shared `indexObjectGraph` seam, repaired in
 * `@objectstack/lint` in the same change. This file pins the OTHER half, which
 * outlives that bug: whatever the next rule failure is, the receipt says the
 * object was not checked, and says why.
 *
 * ## Why the rule is mocked rather than provoked
 *
 * With the seam repaired there is no longer a published body that makes the
 * real rule throw — which is the point of the repair. Reaching the branch
 * therefore means substituting a throwing rule, and `build-probes.ts` imports
 * `@objectstack/lint` LAZILY (`await import`) at call time, so `vi.doMock`
 * plus a fresh module graph per test is exact: nothing else in the file, and
 * no other suite, sees a mocked lint package.
 */

import { describe, expect, it, vi, afterEach } from 'vitest';
import type { ProbeEngine } from './build-probes.js';

const OBJECT_BODY = {
    name: 'crm_lead',
    fields: { name: { type: 'text', label: 'Name' } },
    highlightFields: ['name'],
};

const getItem = async (type: string, name: string) =>
    type === 'object' && name === 'crm_lead' ? OBJECT_BODY : undefined;

/**
 * The probes' single engine read. The object plane never calls it, but the
 * double still honours the caller's `limit` by presence rather than ignoring
 * it — a `find` double that answers more rows than it was asked for is how a
 * limit regression rides through a green suite (`check:objectql-double-limit`).
 */
const engine: ProbeEngine = {
    find: async (_object: string, query: unknown) => {
        const rows = [{ id: 'r1' }, { id: 'r2' }];
        const limit = (query as { limit?: unknown } | undefined)?.limit;
        return typeof limit === 'number' ? rows.slice(0, limit) : rows;
    },
};

afterEach(() => {
    vi.doUnmock('@objectstack/lint');
    vi.resetModules();
});

async function probeWith(validateObjectFieldRefs: (stack: Record<string, unknown>) => unknown) {
    vi.resetModules();
    vi.doMock('@objectstack/lint', () => ({ validateObjectFieldRefs }));
    const { runBuildProbes } = await import('./build-probes.js');
    return runBuildProbes({
        engine,
        getItem,
        published: [{ type: 'object', name: 'crm_lead' }],
    });
}

describe('runBuildProbes — a throwing object rule is reported, never swallowed', () => {
    it('surfaces the crash as a runtime-layer error naming the object and the thrown message', async () => {
        const report = await probeWith(() => {
            throw new TypeError("Cannot read properties of null (reading 'name')");
        });

        // The count still goes up — the object WAS reached; what failed is the
        // judgement. Reporting one without the other is the ambiguity again.
        expect(report.checked.objects).toBe(1);
        expect(report.issues).toHaveLength(1);
        expect(report.issues[0]).toMatchObject({
            layer: 'runtime',
            severity: 'error',
            code: 'object_field_ref_rule_failed',
            artifact: { type: 'object', name: 'crm_lead' },
        });
        // The thrown message rides the receipt: without it the report says a
        // rule failed and gives nobody a way to find out which defect.
        expect(report.issues[0].message).toContain("Cannot read properties of null (reading 'name')");
        expect(report.issues[0].message).toContain('crm_lead');
        // ⛔ The one reading that must be impossible.
        expect(report.issues, 'a crash must not read as zero findings').not.toEqual([]);
    });

    it('reports a non-Error throw too — the message is whatever was thrown', async () => {
        const report = await probeWith(() => {
            throw 'rule exploded';
        });
        expect(report.issues[0]).toMatchObject({ code: 'object_field_ref_rule_failed' });
        expect(report.issues[0].message).toContain('rule exploded');
    });

    it('a clean rule still produces the clean receipt — the contrast case', async () => {
        // Without this the test above would pass just as well against a probe
        // that reported a failure for every object.
        const report = await probeWith(() => []);
        expect(report.checked.objects).toBe(1);
        expect(report.issues).toEqual([]);
    });

    it('a rule that finds a dangling reference still reports THAT, not a failure', async () => {
        const report = await probeWith(() => [
            { path: 'objects.crm_lead.highlightFields[0]', message: 'no such field', hint: 'add it' },
        ]);
        expect(report.issues).toHaveLength(1);
        expect(report.issues[0].code).toBe('object_field_ref_unknown');
    });
});
