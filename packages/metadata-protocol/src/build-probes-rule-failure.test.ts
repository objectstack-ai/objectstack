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
 *
 * ## The `adr0112-ok:` marks below
 *
 * `object_field_ref_rule_failed` is a build-probe diagnostics code shipped
 * inside a 200 receipt (ADR-0112 D6c), not an `error.code` from the closed
 * catalog — the same vocabulary as every other probe code, for which
 * `check:error-code-casing` exempts `build-probes.ts` and
 * `packages/objectql/src/build-probes.test.ts` whole. The marks here are the
 * narrower per-literal spelling of that same exemption, and they are written
 * on the literal's OWN line deliberately: a multi-line comment above the
 * literal was measured to move it out of the gate's recognition window
 * entirely, which reads as a suppression while actually being a blind spot.
 */

import { describe, expect, it, vi, afterEach } from 'vitest';
import type { ProbeEngine } from './build-probes.js';

const OBJECT_BODY = {
    name: 'crm_lead',
    label: 'Leads',
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

async function probeWith(
    validateObjectFieldRefs: (stack: Record<string, unknown>) => unknown,
    userTextLocales?: readonly string[],
) {
    vi.resetModules();
    vi.doMock('@objectstack/lint', () => ({ validateObjectFieldRefs }));
    const { runBuildProbes } = await import('./build-probes.js');
    return runBuildProbes({
        engine,
        getItem,
        published: [{ type: 'object', name: 'crm_lead' }],
        ...(userTextLocales !== undefined ? { userTextLocales } : {}),
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
            code: 'object_field_ref_rule_failed', // adr0112-ok: D6c build-probe diagnostics code
            artifact: { type: 'object', name: 'crm_lead' },
        });
        // The thrown message rides the receipt: without it the report says a
        // rule failed and gives nobody a way to find out which defect.
        expect(report.issues[0].message).toContain("Cannot read properties of null (reading 'name')");
        expect(report.issues[0].message).toContain('crm_lead');
        // ⛔ The one reading that must be impossible.
        expect(report.issues, 'a crash must not read as zero findings').not.toEqual([]);
    });

    it('carries the person\'s sentence beside the crash report: the check failed, not the object', async () => {
        // [ruling record 6929121584] `message` and `fix` are the agent's, and
        // carry the thrown text. `userMessage` is for the person who published:
        // in the request's language, naming the object by its label, and with
        // none of the thrown text in it. Every locale's wording of this code is
        // rendered in `build-probes-user-message.test.ts`; this is its real run.
        const thrown = "Cannot read properties of null (reading 'name')";
        const english = await probeWith(() => {
            throw new TypeError(thrown);
        });
        expect(english.issues[0].userMessage).toBe(
            '"Leads" was published, but its field settings could not be checked. The problem is in the check itself, '
                + 'not necessarily in "Leads"; contact your administrator if it happens again.',
        );
        const chinese = await probeWith(() => {
            throw new TypeError(thrown);
        }, ['zh-CN']);
        expect(chinese.issues[0].userMessage).toBe(
            '“Leads”已发布，但无法检查它的字段设置。问题出在检查本身，不一定出在“Leads”上；如果再次出现，请联系管理员。',
        );
        for (const report of [english, chinese]) {
            expect(report.issues[0].userMessage).not.toContain(thrown);
            expect(report.issues[0].userMessage).not.toContain('crm_lead');
            // The agent's channel is the same in both: it does not read the locale.
            expect(report.issues[0].message).toBe(english.issues[0].message);
            expect(report.issues[0].fix).toBe(english.issues[0].fix);
        }
    });

    it('reports a non-Error throw too — the message is whatever was thrown', async () => {
        const report = await probeWith(() => {
            throw 'rule exploded';
        });
        expect(report.issues[0]).toMatchObject({ code: 'object_field_ref_rule_failed' }); // adr0112-ok: D6c build-probe diagnostics code
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
