// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#10462] `publishPackageDrafts` return-site pins the objectql-side
 * conformance suite cannot stage against the real engine:
 *
 * - the Phase-1 UNWIND's `outcome` — staging a real mid-transaction promotion
 *   failure through the real engine rides the undeclared `failed[].issues`
 *   key on the causal element (#10524's surface, deliberately not this
 *   card's), so the unwind is pinned here with the promotion seam mocked and
 *   a plain Error (no `issues`);
 * - the no-op TRACE — the `console.info` line is the no-op exit's only
 *   record: the audit ledger stays silent on purpose (`sys_metadata_audit`
 *   rows are keyed on `(type, name)`, and a batch with zero items has no
 *   honest identity to mint — the limiting case of the rule both refusal
 *   sites already follow). This file goes red if the line is dropped, and
 *   pins that it does NOT fire on the exits that leave their own records;
 * - the zero-draft machinery edge — the one return whose `outcome` is not
 *   fixed by the site it sits on: a transaction-machinery failure over an
 *   EMPTY batch answers `nothing_to_publish` (nothing was pending, nothing
 *   was refused; the unwind's `console.warn` stays the record of the
 *   failure), which is what keeps the producer invariant
 *   `outcome === 'refused'` iff `failed.length > 0` true on every return.
 *
 * Harness copied from
 * `packages/objectql/src/protocol-publish-package-drafts.test.ts` (the #8896
 * capture double) — copied, NOT imported: metadata-protocol cannot depend on
 * objectql, and each pin must be able to fail independently.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ObjectStackProtocolImplementation } from './protocol.js';

/**
 * [#8896] A real double for the two engine calls `publishPackageDrafts` makes
 * on its own — the ADR-0067 pre-publish CAPTURE read (`findOne`, answering an
 * explicit `null` for "no active row"), and the commit write (`insert`).
 */
function makeCaptureEngine() {
    const engine = {
        findOne: async (table: string, opts?: { where?: Record<string, unknown> }) => {
            void table; void opts;
            // Every artifact is new here: `null` is the truthful capture answer.
            return null;
        },
        insert: async (table: string) => ({ id: `${table}_1` }),
    };
    return engine;
}

function makeProtocol(drafts: Array<{ type: string; name: string }>) {
    const protocol = new ObjectStackProtocolImplementation({} as never);
    (protocol as any).ensureOverlayIndex = async () => {};
    (protocol as any).getOverlayRepo = () => ({ listDrafts: async () => drafts });
    (protocol as any).engine = makeCaptureEngine();
    const promote = vi.spyOn(protocol as any, 'promoteDraftForPublish');
    const sideEffects = vi
        .spyOn(protocol as any, 'runPublishSideEffects')
        .mockResolvedValue({});
    const promoteOk = (req: any) => ({
        singularType: req.type,
        orgId: null,
        advisories: [],
        result: { version: 'h', seq: 1, item: { body: { name: req.name } }, packageId: null },
    });
    return { protocol, promote, sideEffects, promoteOk };
}

const NOOP_LINE = /\[Protocol\] publishPackageDrafts: nothing to publish/;

afterEach(() => vi.restoreAllMocks());

describe('[#10462] the Phase-1 unwind names its outcome', () => {
    it("a mid-batch promotion failure answers outcome 'refused' with the whole batch in failed[]", async () => {
        const { protocol, promote } = makeProtocol([
            { type: 'view', name: 'cases' },
            { type: 'view', name: 'leads' },
        ]);
        // A plain Error, deliberately without `issues` — see the header.
        promote.mockImplementation(async (req: any) => {
            if (req.name === 'cases') throw new Error('promotion refused');
            return {
                singularType: req.type, orgId: null, advisories: [],
                result: { version: 'h', seq: 1, item: { body: { name: req.name } }, packageId: null },
            };
        });

        const res: any = await protocol.publishPackageDrafts({ packageId: 'app.edu' });

        expect(res.success).toBe(false);
        expect(res.outcome).toBe('refused');
        expect(res.publishedCount).toBe(0);
        expect(res.published).toEqual([]);
        // ADR-0067 D2: the causal item plus its BATCH_ABORTED sibling.
        expect(res.failedCount).toBe(2);
        expect(res.failed.map((f: any) => f.name).sort()).toEqual(['cases', 'leads']);
        // The invariants hold at this site too (both directions).
        expect(res.outcome === 'refused').toBe(res.failed.length > 0);
        expect(res.success).toBe(res.outcome === 'published');
    });

    it("a transaction-machinery failure over an EMPTY batch answers 'nothing_to_publish', keeping the invariant universal", async () => {
        const { protocol } = makeProtocol([]);
        (protocol as any).engine = {
            ...makeCaptureEngine(),
            transaction: async () => { throw new Error('connection lost'); },
        };
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const res: any = await protocol.publishPackageDrafts({ packageId: 'app.empty' });

        // Truthful on both axes: nothing was pending, nothing was refused —
        // and `refused` with `failed: []` would break invariant (i).
        expect(res).toMatchObject({
            success: false, outcome: 'nothing_to_publish',
            publishedCount: 0, failedCount: 0, published: [], failed: [],
        });
        // The machinery failure is NOT silent: the unwind's warn is its record.
        expect(warn.mock.calls.some((c) => String(c[0]).includes('rolled back'))).toBe(true);
    });
});

describe('[#10462] the no-op exit leaves a trace', () => {
    it('TRACE CONTROL: the no-op logs one info line naming the package and BOTH facts', async () => {
        const { protocol } = makeProtocol([]);
        const info = vi.spyOn(console, 'info').mockImplementation(() => {});

        const res: any = await protocol.publishPackageDrafts({ packageId: 'app.empty' });

        expect(res.outcome).toBe('nothing_to_publish');
        const line = info.mock.calls.map((c) => String(c[0])).find((m) => NOOP_LINE.test(m));
        // Fails if the log line is dropped — the exit would be traceless again.
        expect(line).toBeDefined();
        // Names the packageId…
        expect(line).toContain("'app.empty'");
        // …and states the two facts `success: false` cannot carry alone:
        // nothing was pending, and nothing was refused.
        expect(line).toMatch(/no pending drafts/);
        expect(line).toMatch(/nothing was refused/);
    });

    it('the trace is SPECIFIC to the no-op: a successful publish and a refusal do not emit it', async () => {
        const info = vi.spyOn(console, 'info').mockImplementation(() => {});
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        void warn;

        const ok = makeProtocol([{ type: 'view', name: 'cases' }]);
        ok.promote.mockImplementation(async (req: any) => ok.promoteOk(req));
        const okRes: any = await ok.protocol.publishPackageDrafts({ packageId: 'app.edu' });
        expect(okRes.outcome).toBe('published');

        const refused = makeProtocol([{ type: 'view', name: 'cases' }]);
        refused.promote.mockImplementation(async () => { throw new Error('promotion refused'); });
        const refusedRes: any = await refused.protocol.publishPackageDrafts({ packageId: 'app.edu' });
        expect(refusedRes.outcome).toBe('refused');

        // Those two exits leave their own records (audit rows / warn) — the
        // info line belongs to the no-op alone.
        expect(info.mock.calls.map((c) => String(c[0])).some((m) => NOOP_LINE.test(m))).toBe(false);
    });
});
