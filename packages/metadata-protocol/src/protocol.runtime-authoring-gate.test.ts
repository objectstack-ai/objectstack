// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4463 — the runtime authoring gate, end to end through `saveMetaItem`.
 *
 * The measured example from the issue, run at the door it was measured at: a
 * tenant saves an approval flow whose `expression` approver is broken CEL
 * (`record.owner ==`). `ApproverSchema.value` is a `z.string()`, so the
 * per-type Zod gate is green; before this change the body landed in
 * `sys_metadata`, `registerFlow` registered it, and the node failed at its
 * entry the first time the flow fired. `os lint` had rejected that exact body
 * since #4409 — and there is no `os lint` for a Studio tenant, because a
 * `sys_metadata` overlay row is not in the CLI's config file at all.
 *
 * These tests pin all four decisions, not just the refusal:
 *   D1 — `active` is gated, `draft` is not, and publishing a draft IS gated.
 *   D3 — the refusal is a 422 in the existing structured-issues envelope.
 *   D4 — `OS_ALLOW_UNLINTED_METADATA_WRITES=1` degrades it to a loud log.
 *   plus: nothing persists on a refusal.
 *
 * Harness: the real repository write path over a stub engine — the same shape
 * as `protocol.save-flow-canonicalization.test.ts`, because a gate INSIDE
 * `saveMetaItem` cannot be tested against a harness that mocks `saveMetaItem`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// [#5619] The producer's OWN write-verb dispatch decisions (#4550 delete /
// #5480 update), so the fake engine below cannot accept a call ObjectQL
// refuses. Imported from `@objectstack/metadata-core` and not from
// `@objectstack/objectql`: objectql DEPENDS ON this package, so that import
// would close a dependency cycle turbo rejects outright — which is why all 26
// of this package's (file, verb) pairs sat in the gate's DEBT ledger until
// #5619 sank the two predicates into a package both sides already depend on.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';
// [#4716] The advisory-tier rule the Q2 fence test proves its body WOULD trip
// — imported from the full barrel deliberately: this is a TEST, not the gate
// (the gate itself may only reach the registry through `@objectstack/lint/runtime`,
// which the wiring guard enforces on the gate's own source).
import { validateSemanticRoles } from '@objectstack/lint';
import { ObjectStackProtocolImplementation } from './protocol.js';
import type { MetadataAuthoringChannel } from './protocol.js';
import { SDUI_MANIFEST_SERVICE } from './index.js';
import { stampHtmlPageRequires } from './runtime-authoring-gate.js';

/** The issue's body. Zod-valid: `approvers[].value` is just a string to the schema. */
const brokenApprovalFlow = () => ({
    name: 'leave_approval',
    label: 'Leave Approval',
    type: 'autolaunched',
    status: 'active',
    nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        {
            id: 'approve',
            type: 'approval',
            label: 'Approve',
            config: { approvers: [{ type: 'expression', value: 'record.owner ==' }] },
        },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'approve' }],
});

/** The same flow with an approver expression that parses and uses a legal root. */
const validApprovalFlow = () => {
    const flow = brokenApprovalFlow();
    flow.nodes[1]!.config = {
        approvers: [{ type: 'expression', value: 'current.owner' }],
        emptyApproverPolicy: 'reject',
    } as any;
    return flow;
};

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    state: string;
    metadata: string;
    checksum?: string;
}

const keyOf = (w: Record<string, unknown>) =>
    `${w.type}|${w.name}|${w.organization_id ?? '__env__'}|${w.state ?? 'active'}`;

function makeStubEngine() {
    // ⚠️ Keyed BY TABLE, and that is a correctness property of this harness
    // rather than tidiness. One flat row map answers a read of `sys_metadata`
    // with rows the protocol wrote to `sys_metadata_history` and
    // `sys_metadata_commit`: a DRAFT save appends a history row carrying no
    // `state`, the declared `defaultValue: 'active'` modelled below fills it
    // in, and the draft comes back as an ACTIVE metadata row. Measured in
    // #16223, where one assertion's polarity was the only thing that caught it.
    const tables = new Map<string, Map<string, Row>>();
    const tableOf = (table: string): Map<string, Row> => {
        const existing = tables.get(table);
        if (existing) return existing;
        const created = new Map<string, Row>();
        tables.set(table, created);
        return created;
    };
    /** The store table these tests assert on; the journals get their own. */
    const rows = tableOf('sys_metadata');
    let nextId = 0;
    const findRow = (table: string, w: Record<string, unknown>): { key: string; row: Row } | null => {
        if (w.id !== undefined) {
            for (const [k, r] of tableOf(table)) if (r.id === w.id) return { key: k, row: r };
            return null;
        }
        for (const [k, r] of tableOf(table)) {
            if (w.type !== undefined && r.type !== w.type) continue;
            if (w.name !== undefined && r.name !== w.name) continue;
            if (w.organization_id !== undefined && r.organization_id !== w.organization_id) continue;
            if (w.state !== undefined && r.state !== w.state) continue;
            return { key: k, row: r };
        }
        return null;
    };
    const engine: any = {
        async findOne(table: string, opts: { where: Record<string, unknown> }) {
            assertEngineFindOnePredicate(table, opts);
            return findRow(table, opts.where)?.row ?? null;
        },
        async find(table: string, opts: { where: Record<string, unknown> }) {
            return Array.from(tableOf(table).values()).filter((r) => {
                if (opts.where.type && r.type !== opts.where.type) return false;
                if (opts.where.organization_id !== undefined
                    && r.organization_id !== opts.where.organization_id) return false;
                if (opts.where.state && r.state !== opts.where.state) return false;
                return true;
            });
        },
        async insert(table: string, data: Record<string, unknown>) {
            nextId += 1;
            const row = { id: `r_${nextId}`, ...(data as any) } as Row;
            tableOf(table).set(keyOf(data), row);
            return { id: row.id };
        },
        async update(table: string, data: Record<string, unknown>, opts: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(data, opts);
            const found = findRow(table, opts.where);
            if (!found) return { id: null };
            tableOf(table).set(found.key, { ...found.row, ...(data as any) });
            return { id: found.row.id };
        },
        async delete(table: string, opts: { where: Record<string, unknown> }) {
            assertEngineDeleteDispatch(opts);
            const found = findRow(table, opts.where);
            if (!found) return { deleted: 0 };
            tableOf(table).delete(found.key);
            return { deleted: 1 };
        },
        registry: {
            registerItem: () => {},
            registerObject: () => {},
            // The live object universe the rules resolve names against — the
            // input `os lint` cannot have and this surface can (#4463 D2).
            listItems: (type: string) =>
                type === 'object'
                    ? [{ name: 'leave_request', fields: { owner: { type: 'text' } } }]
                    : [],
            getItem: () => undefined,
        },
    };
    return { engine, rows };
}

/**
 * A protocol on the ordinary tenant posture: an environment id AND the default
 * (undeclared ⇒ `'environment'`) authoring channel.
 */
function makeProtocol() {
    const { engine, rows } = makeStubEngine();
    const protocol = new ObjectStackProtocolImplementation(engine, () => new Map(), 'env_test');
    return { protocol: protocol as any, rows };
}

/**
 * [#6710] The two activation inputs, driven independently. `environmentId` is
 * row scope; `authoringChannel` is what decides whether the #4463 gate runs.
 * Passing `undefined` for the channel exercises the constructor DEFAULT — the
 * fail-safe direction — not an explicit `'environment'`.
 */
function makeProtocolOn(
    environmentId: string | undefined,
    authoringChannel?: MetadataAuthoringChannel,
) {
    const { engine, rows } = makeStubEngine();
    const protocol = authoringChannel === undefined
        ? new ObjectStackProtocolImplementation(engine, () => new Map(), environmentId)
        : new ObjectStackProtocolImplementation(engine, () => new Map(), environmentId, authoringChannel);
    return { protocol: protocol as any, rows };
}

const flowRows = (rows: Map<string, Row>) =>
    Array.from(rows.values()).filter((r) => r.type === 'flow');

const save = (protocol: any, item: unknown, extra: Record<string, unknown> = {}) =>
    protocol.saveMetaItem({ type: 'flow', name: 'leave_approval', item, ...extra });

describe('runtime authoring gate on saveMetaItem (#4463)', () => {
    let warn: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        delete process.env.OS_ALLOW_UNLINTED_METADATA_WRITES;
    });
    afterEach(() => {
        warn.mockRestore();
        delete process.env.OS_ALLOW_UNLINTED_METADATA_WRITES;
    });

    // ── D1 + D3: the refusal ─────────────────────────────────────────────

    it('refuses an ACTIVE save of the broken approval flow with a 422', async () => {
        const { protocol, rows } = makeProtocol();

        const err = await save(protocol, brokenApprovalFlow()).catch((e: any) => e);
        expect(err).toBeInstanceOf(Error);
        // The token rides `code`; the message is the human sentence and opens
        // with it — no bracketed restatement of the code in front. Asserted as
        // the sentence that opens, the count and the `[rule]` locator, so this
        // cannot go green by the message turning empty or generic.
        expect(err.status).toBe(422);
        expect(err.code).toBe('INVALID_METADATA');
        expect(err.message).toMatch(/^flow\/leave_approval failed author-time validation: 1 issue — /);
        expect(err.message).toContain('flows[0].nodes[1].config.approvers[0].value [approval-expression-invalid]');

        // D3 — the structured envelope Studio already renders for a Zod
        // failure, carrying the four keys an author needs to act.
        const issue = err.issues.find((i: any) => i.rule === 'approval-expression-invalid');
        expect(issue, `issues: ${JSON.stringify(err.issues)}`).toBeDefined();
        expect(issue.path).toBe('flows[0].nodes[1].config.approvers[0].value');
        expect(issue.where).toContain('leave_approval');
        expect(issue.message).toMatch(/does not parse as CEL/);
        expect(issue.hint.length).toBeGreaterThan(10);

        // Which rules produced the verdict — so "clean" and "nothing ran" are
        // distinguishable from the outside.
        expect(err.rulesRun).toContain('validateApprovalApprovers');

        // And nothing landed. A gate that rejects AFTER persisting is a log line.
        expect(flowRows(rows)).toEqual([]);
    });

    it('allows the same flow once the expression is valid', async () => {
        const { protocol, rows } = makeProtocol();
        const result = await save(protocol, validApprovalFlow());
        expect(result.success).toBe(true);
        expect(flowRows(rows).length).toBe(1);
    });

    // ── D1: drafts are never gated ───────────────────────────────────────

    it('lets the identical body through as a DRAFT', async () => {
        const { protocol, rows } = makeProtocol();

        const result = await save(protocol, brokenApprovalFlow(), { mode: 'draft' });

        expect(
            result.success,
            `a draft is allowed to be half-finished — gating one would destroy the Studio editing loop ` +
                `for no safety gain, because a draft cannot execute (#4463 D1).`,
        ).toBe(true);
        const states = flowRows(rows).map((r) => r.state);
        expect(states).toContain('draft');
        expect(states, 'a draft save must not mint an active row').not.toContain('active');
    });

    it('gates the draft→active PROMOTION, so the draft door is not a bypass', async () => {
        const { protocol } = makeProtocol();
        await save(protocol, brokenApprovalFlow(), { mode: 'draft' });

        const err = await protocol
            .publishMetaItem({ type: 'flow', name: 'leave_approval' })
            .catch((e: any) => e);

        expect(
            err?.status,
            `without this, anyone could save ?mode=draft and POST /publish to walk straight past the ` +
                `gate — which is exactly what Studio's designer does on every edit.`,
        ).toBe(422);
        expect(err.issues.map((i: any) => i.rule)).toContain('approval-expression-invalid');
    });

    it('publishes a draft that is clean', async () => {
        const { protocol } = makeProtocol();
        await save(protocol, validApprovalFlow(), { mode: 'draft' });
        const result = await protocol.publishMetaItem({ type: 'flow', name: 'leave_approval' });
        expect(result.success).toBe(true);
    });

    // ── D4: the escape hatch ─────────────────────────────────────────────

    it('OS_ALLOW_UNLINTED_METADATA_WRITES=1 allows the write and says so loudly', async () => {
        process.env.OS_ALLOW_UNLINTED_METADATA_WRITES = '1';
        const { protocol, rows } = makeProtocol();

        const result = await save(protocol, brokenApprovalFlow());
        expect(result.success).toBe(true);
        expect(flowRows(rows).length).toBe(1);

        const shouted = (warn.mock.calls as unknown[][])
            .map((c) => String(c[0]))
            .filter((m) => m.includes('OS_ALLOW_UNLINTED_METADATA_WRITES'));
        expect(shouted.length, 'the hatch makes a violation TOLERATED, never invisible').toBe(1);
        expect(shouted[0]).toContain('approval-expression-invalid');
        expect(shouted[0]).toContain('leave_approval');
    });

    // ── Scope: what the gate must NOT do ─────────────────────────────────

    it('does not gate a DECLARED package-author (control-plane) channel', async () => {
        // The ADR-0005 carve-out itself is unchanged and still legitimate: a
        // control-plane kernel installing a package is not an author
        // publishing into a live tenant. What #6710 changed is that the kernel
        // has to SAY SO — this is the one posture in the matrix below that
        // may skip all 26 rules.
        const { protocol, rows } = makeProtocolOn(undefined, 'package-author');
        const result = await protocol.saveMetaItem({
            type: 'flow',
            name: 'leave_approval',
            item: brokenApprovalFlow(),
        });
        expect(result.success).toBe(true);
        expect(flowRows(rows).length).toBe(1);
    });

    it('does not gate `os migrate meta --stored`, which rewrites rows that already exist', async () => {
        // D4's other half. The migration heals stored bodies into the current
        // dialect; it is not an author publishing anything. Gating it would
        // mean a tenant holding one pre-existing violation could never
        // canonicalize that row — the migration would report `failed` and
        // leave the body in the OLDER dialect, which is worse than the state
        // it was asked to improve. `source` is server-stated (never forwarded
        // from a request), so this cannot be spelled past the gate by a caller.
        const { protocol, rows } = makeProtocol();
        const result = await save(protocol, brokenApprovalFlow(), { source: 'migrate-stored' });
        expect(result.success).toBe(true);
        expect(flowRows(rows).length).toBe(1);
    });

    it('DOES gate an ordinary save that merely looks like one (no source spoofing)', async () => {
        // The carve-out is on one exact server-stated token; anything else —
        // including a caller's guess at it — still meets the gate.
        const { protocol } = makeProtocol();
        for (const source of [undefined, 'protocol.saveMetaItem', 'migrate', 'migrate-stored-ish']) {
            const err = await save(protocol, brokenApprovalFlow(), source ? { source } : {})
                .catch((e: any) => e);
            expect(err?.status, `source=${String(source)} must still be gated`).toBe(422);
        }
    });

    it('publishes a clean object write through the fully widened door (#4716)', async () => {
        // HISTORY: this case was born as "does not gate a metadata type no
        // rule declares (P1 wires `flow` only)". That premise ended twice —
        // #8310 put `validateSecurityPosture` on `object` writes, and #4716
        // crossed the five gating object rules — so what it pins now is the
        // accept side of the widened door: a body clean under ALL SEVEN
        // object-gated rules (authored `sharingModel`, no broken validation /
        // autonumber / summary / apiMethods shape) publishes exactly as it
        // did when nothing ran. The refusal side lives in the #4716 block
        // below. A dedicated ungated-type case is deliberately not minted
        // here: `runtime-gate.test.ts` pins `runtimeAuthoringRulesFor` on an
        // undeclared type returning [], at the layer that owns dispatch.
        const { protocol } = makeProtocol();
        const result = await protocol.saveMetaItem({
            type: 'object',
            name: 'leave_request',
            item: {
                name: 'leave_request',
                label: 'Leave Request',
                sharingModel: 'private',
                fields: { owner: { type: 'text', label: 'Owner' } },
            },
        });
        expect(result.success).toBe(true);
    });

    it('survives a host whose registry cannot list objects', async () => {
        // Context gathering is best-effort: a metadata-only store still writes,
        // it just gets the rules that need no object universe. It must never be
        // the reason a write fails.
        const { engine, rows } = makeStubEngine();
        engine.registry.listItems = () => { throw new Error('no registry here'); };
        const protocol = new ObjectStackProtocolImplementation(engine, () => new Map(), 'env_test') as any;

        await expect(
            protocol.saveMetaItem({ type: 'flow', name: 'leave_approval', item: validApprovalFlow() }),
        ).resolves.toMatchObject({ success: true });
        expect(flowRows(rows).length).toBe(1);

        // …and the refusal still happens without that context.
        const err = await protocol
            .saveMetaItem({ type: 'flow', name: 'other_flow', item: { ...brokenApprovalFlow(), name: 'other_flow' } })
            .catch((e: any) => e);
        expect(err.status).toBe(422);
    });
});

/**
 * [#6710] What ACTIVATES the gate — the posture matrix.
 *
 * Until #6710 the answer was `environmentId !== undefined`, and the whole
 * defect is that this key cannot tell two topologies apart: the genuine
 * control plane and the CLI's host-config assembler
 * (`serve.ts`'s `config.objects && !hasObjectQL` branch → `new ObjectQLPlugin()`
 * with no options) BOTH leave it undefined, and only the first one is the
 * package author's own channel. The second serves an end-user
 * `PUT /api/v1/meta/*` — measured at boot level on `origin/main` @ `68feaadd6`:
 * `protocol.environmentId === undefined` and the broken approval flow ran
 * straight past this gate into persistence.
 *
 * So activation is now keyed on a DECLARED channel, and this matrix is the
 * contract. The row that matters most is the first: **undeclared ⇒ gated**.
 * An assembly that forgets gets more enforcement, never less.
 */
describe('#6710 — gate activation is keyed on the declared authoring channel', () => {
    let warn: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        delete process.env.OS_ALLOW_UNLINTED_METADATA_WRITES;
    });
    afterEach(() => {
        warn.mockRestore();
        delete process.env.OS_ALLOW_UNLINTED_METADATA_WRITES;
    });

    /**
     * `undefined` = the option omitted entirely, which is the posture every
     * assembly that has not been told about this option is in.
     */
    const matrix: Array<{
        environmentId: string | undefined;
        channel: MetadataAuthoringChannel | undefined;
        gated: boolean;
        why: string;
    }> = [
        {
            environmentId: undefined, channel: undefined, gated: true,
            why: 'THE #6710 FIX — the host-config topology (serve.ts, showcase). '
                + 'Undeclared is the gated channel: this row going green in the other '
                + 'direction is the defect this card exists to close.',
        },
        {
            environmentId: undefined, channel: 'environment', gated: true,
            why: 'the default, stated out loud — must agree with the omitted case',
        },
        {
            environmentId: undefined, channel: 'package-author', gated: false,
            why: 'the ADR-0005 carve-out, now declared — the genuine control plane',
        },
        {
            environmentId: 'env_test', channel: undefined, gated: true,
            why: 'the ordinary tenant kernel — gated before #6710 and gated after',
        },
        {
            environmentId: 'env_test', channel: 'environment', gated: true,
            why: 'same, stated out loud',
        },
        {
            environmentId: 'env_test', channel: 'package-author', gated: false,
            why: 'the DECLARATION decides on its own. Row scope is orthogonal and is '
                + 'deliberately not AND-ed in here: re-admitting environmentId as a '
                + 'co-condition would put the retired proxy key back into the '
                + 'activation judgment, and a control plane that later gained a row '
                + 'scope would silently change gate posture. No in-repo assembly is '
                + 'in this posture; it is pinned so the rule reads one way only.',
        },
    ];

    for (const { environmentId, channel, gated, why } of matrix) {
        const label = `environmentId=${environmentId ?? 'undefined'}, `
            + `authoringChannel=${channel ?? '<omitted>'} ⇒ ${gated ? 'GATED' : 'bypassed'}`;

        it(label, async () => {
            const { protocol, rows } = makeProtocolOn(environmentId, channel);
            const outcome = await protocol
                .saveMetaItem({ type: 'flow', name: 'leave_approval', item: brokenApprovalFlow() })
                .then((r: any) => ({ ok: true as const, r }))
                .catch((e: any) => ({ ok: false as const, e }));

            if (!gated) {
                expect(outcome.ok, `${why}\nunexpected refusal: ${String((outcome as any).e?.message)}`).toBe(true);
                expect(flowRows(rows).length).toBe(1);
                return;
            }

            expect(outcome.ok, why).toBe(false);
            const err = (outcome as { ok: false; e: any }).e;
            // ADR-0112 envelope, both halves. `rejects.toThrow()` alone would
            // stay green on any throw at all — including the engine's own
            // "no driver available", which is exactly how the ungated
            // host-config topology fails today.
            expect(err.code, why).toBe('INVALID_METADATA');
            expect(err.status, why).toBe(422);
            expect(err.issues.map((i: any) => i.rule)).toContain('approval-expression-invalid');
            // A gate that rejects after persisting is a log line.
            expect(flowRows(rows), 'nothing may land on a refusal').toEqual([]);
        });
    }

    it('the gated postures are gated by the RULES, not by a blanket refusal', async () => {
        // Guards against the lazy fix: "gate everything undeclared" is only
        // correct if a clean body still publishes. Both undeclared postures
        // must accept the valid flow.
        for (const environmentId of [undefined, 'env_test']) {
            const { protocol, rows } = makeProtocolOn(environmentId, undefined);
            const result = await protocol.saveMetaItem({
                type: 'flow', name: 'leave_approval', item: validApprovalFlow(),
            });
            expect(result.success, `environmentId=${String(environmentId)}`).toBe(true);
            expect(flowRows(rows).length).toBe(1);
        }
    });

    it('D4 hatch still covers the newly-gated topology (the cross-repo window depends on it)', async () => {
        // Until `cloud`'s control-plane-preset declares the channel, the
        // control plane runs on the undeclared (gated) posture. The maintainer
        // accepted that window explicitly BECAUSE this hatch exists — so the
        // hatch has to work on precisely the posture the window puts it in:
        // environmentId undefined, channel undeclared.
        process.env.OS_ALLOW_UNLINTED_METADATA_WRITES = '1';
        const { protocol, rows } = makeProtocolOn(undefined, undefined);

        const result = await protocol.saveMetaItem({
            type: 'flow', name: 'leave_approval', item: brokenApprovalFlow(),
        });
        expect(result.success).toBe(true);
        expect(flowRows(rows).length).toBe(1);

        const shouted = (warn.mock.calls as unknown[][])
            .map((c) => String(c[0]))
            .filter((m) => m.includes('OS_ALLOW_UNLINTED_METADATA_WRITES'));
        expect(shouted.length, 'tolerated, never invisible').toBe(1);
        expect(shouted[0]).toContain('approval-expression-invalid');
    });

    // [#7674] REPLACED, not re-spelled. The case that stood here asserted the
    // opposite invariant — "the #3050 authoring gate keeps its own
    // `environmentId !== undefined` scope check, and it must stay keyed there"
    // — and that sentence was the defect, written down as a pin. #6710 retired
    // the proxy for the #4463 gate and left its sibling on it, so the ADR-0090
    // D11 object posture gate (`owd_widening_forbidden` / `owd_external_wider`)
    // ran on NO host-config deployment: `new ObjectQLPlugin()` leaves
    // `environmentId` undefined and serves an end-user `PUT /api/v1/meta/*`.
    // The old case could not see that, because it drove the control-plane row
    // (undefined) only through the `package-author` channel — the one column
    // where both keys agree.
    //
    // The four-cell matrix below is what makes the two keys distinguishable.
    // Note the one cell whose verdict FLIPS: `('env_test', 'package-author')`
    // was gated and is not any more. That is #6710's direction applied
    // honestly rather than half-applied — a kernel that claims to BE the
    // package author is treated as one by both doors, because package
    // authoring is judged at BUILD time by the same rules, on their CLI
    // surface, before anything is published (R1's own message prescribes
    // exactly that route: "widen it in the package source and publish through
    // the package pipeline"). No assembly in this repo declares that channel
    // today; only the genuine control plane may.
    //
    // [#8310] That build-time reason is the carve-out's ONLY footing. It does
    // not also rest on the runtime door lacking the rule, and must not be
    // re-founded on one: `validateSecurityPosture` declares both authoring
    // surfaces (PR #8390) and PR #8600 put `object` in its `runtimeTypes`, so
    // it answers at the runtime publish door as well as on every CLI command.
    // What skips a `package-author` write is the CHANNEL —
    // `assertRuntimeAuthoringRules` returns early on it at every call site,
    // and the single `runAuthoringGate` call is guarded by the same check —
    // never a gap in that rule's reach. The reach moves with every #7891
    // slice; the channel does not, which is the whole reason to state the
    // carve-out this way round. What the object door then does with the writes
    // it DOES judge — the order of the two doors, and ADR-0094's R1/R2 outcome
    // — is pinned in `packages/rest/src/meta-object-owd-gate.test.ts` rather
    // than restated here.
    it.each([
        { envId: undefined, channel: undefined, gated: true, why: 'THE DEFECT: the host-config assembler — `new ObjectQLPlugin()`, no environment id, undeclared channel ⇒ the fail-safe default' },
        { envId: 'env_test', channel: undefined, gated: true, why: 'the ordinary tenant kernel, unchanged' },
        { envId: undefined, channel: 'package-author' as const, gated: false, why: 'the genuine control-plane bootstrap kernel' },
        { envId: 'env_test', channel: 'package-author' as const, gated: false, why: 'a declared package author that also carries a row scope — the cell that flips' },
    ])('#3050 gate: environmentId=$envId channel=$channel ⇒ gated=$gated ($why)', async ({ envId, channel, gated }) => {
        const seen: string[] = [];
        const { protocol } = makeProtocolOn(envId, channel);
        protocol.registerAuthoringGate('flow', (ctx: { type: string; name: string }) => {
            seen.push(`${ctx.type}/${ctx.name}`);
        });

        // A body the #4463 rules ACCEPT, so what this matrix measures is the
        // #3050 dispatch alone: a broken body would be refused upstream on the
        // two `'environment'` rows and the gate would never be reached, which
        // would make the two keys look identical again.
        await protocol.saveMetaItem({ type: 'flow', name: 'leave_approval', item: validApprovalFlow() });

        expect(seen).toEqual(gated ? ['flow/leave_approval'] : []);
    });

    it('the #3050 gate and the #4463 gate now read ONE key, and `environmentId` keeps only row scope', async () => {
        // The positive statement of the matrix above: the two doors that ask
        // "is this an author publishing?" can no longer disagree, which is the
        // property whose absence let #7674 outlive #6710 by one gate.
        const seen: string[] = [];
        const gate = (ctx: { type: string; name: string }) => { seen.push(`${ctx.type}/${ctx.name}`); };

        // Host config: #4463 refuses the broken body (422) AND #3050 would have
        // run — the write never reaches persistence either way, and both gates
        // are live on the topology that had neither.
        const host = makeProtocolOn(undefined);
        host.protocol.registerAuthoringGate('flow', gate);
        const err = await host.protocol
            .saveMetaItem({ type: 'flow', name: 'leave_approval', item: brokenApprovalFlow() })
            .catch((e: any) => e);
        expect(err.status).toBe(422);
        expect(err.code).toBe('INVALID_METADATA');
        expect(flowRows(host.rows), 'refused before persistence').toEqual([]);

        // …and the same host config, given a body the rules accept, runs the
        // #3050 gate and stores the row. "Gated" must not mean "refuses
        // everything".
        await host.protocol.saveMetaItem({ type: 'flow', name: 'leave_approval', item: validApprovalFlow() });
        expect(seen).toEqual(['flow/leave_approval']);
        expect(flowRows(host.rows)).toHaveLength(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// #4716 — the OBJECT write door, end to end through `saveMetaItem`.
//
// The narrowed, adjudicated scope (2026-08-18): the five GATING rules carrying
// the object-writes reason cross onto `object` writes; the six advisory-tier
// object rules do NOT ride. The lint layer pins dispatch and the six refusal
// controls (`runtime-gate.object-writes.test.ts`); this block pins what a
// Studio/REST/MCP author actually experiences at the door — the 422 envelope,
// D1's draft carve-out, the clean-save wire shape, and the Q2 fence.
// ─────────────────────────────────────────────────────────────────────────────

describe('runtime authoring gate on OBJECT writes (#4716)', () => {
    let warn: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        delete process.env.OS_ALLOW_UNLINTED_METADATA_WRITES;
    });
    afterEach(() => {
        warn.mockRestore();
        delete process.env.OS_ALLOW_UNLINTED_METADATA_WRITES;
    });

    const objectRows = (rows: Map<string, Row>) =>
        Array.from(rows.values()).filter((r) => r.type === 'object');

    const saveObject = (protocol: any, item: unknown, extra: Record<string, unknown> = {}) =>
        protocol.saveMetaItem({ type: 'object', name: 'task', item, ...extra });

    /**
     * Zod-green at the per-type parse, broken only where `lintAutonumberFormats`
     * judges: the autonumber interpolates a field the object does not carry, so
     * the counter is broken from the first record. Before #4716 this exact body
     * published clean through Studio.
     */
    const brokenAutonumberObject = () => ({
        name: 'task',
        label: 'Task',
        sharingModel: 'private',
        fields: {
            owner: { type: 'text', label: 'Owner' },
            task_no: { type: 'autonumber', label: 'Task No', autonumberFormat: '{plan_no}{000}' },
        },
    });

    /** The same shape with the referenced field declared and required. */
    const cleanTaskObject = () => ({
        name: 'task',
        label: 'Task',
        sharingModel: 'private',
        fields: {
            owner: { type: 'text', label: 'Owner' },
        },
    });

    it('refuses an ACTIVE object publish with a 422 in the structured envelope', async () => {
        const { protocol, rows } = makeProtocol();

        const err = await saveObject(protocol, brokenAutonumberObject()).catch((e: any) => e);
        expect(err.status).toBe(422);
        expect(err.code).toBe('INVALID_METADATA');

        const issue = err.issues.find((i: any) => i.rule === 'autonumber-references-unknown-field');
        expect(issue, `issues: ${JSON.stringify(err.issues)}`).toBeDefined();
        expect(issue.severity).toBe('error');
        expect(String(issue.path).length).toBeGreaterThan(0);
        expect(issue.message).toContain('plan_no');
        expect(issue.hint.length).toBeGreaterThan(10);

        // Which rules produced the verdict — "clean" and "nothing ran" stay
        // distinguishable from the outside.
        expect(err.rulesRun).toContain('lintAutonumberFormats');

        // Nothing landed. A gate that rejects AFTER persisting is a log line.
        expect(objectRows(rows)).toEqual([]);
    });

    it('refuses a json_schema validation ajv cannot compile — the lazy-compiler leg, end to end', async () => {
        // The runtime's `checkJsonSchema` would log "uncompilable — skipped"
        // and enforce NOTHING for every record, forever (#4762). ajv loads
        // lazily inside the rule to judge exactly this; the boot-path contract
        // around that load is pinned in `runtime-lazy-deps.test.ts`.
        const { protocol, rows } = makeProtocol();
        const err = await saveObject(protocol, {
            ...cleanTaskObject(),
            validations: [
                {
                    name: 'payload_shape',
                    type: 'json_schema',
                    field: 'owner',
                    message: 'payload must match the declared shape',
                    schema: { required: 'name' },
                },
            ],
        }).catch((e: any) => e);

        expect(err.status).toBe(422);
        expect(err.code).toBe('INVALID_METADATA');
        const issue = err.issues.find((i: any) => i.rule === 'validation-rule-json-schema-uncompilable');
        expect(issue, `issues: ${JSON.stringify(err.issues)}`).toBeDefined();
        expect(err.rulesRun).toContain('validateRuleCompilability');
        expect(objectRows(rows)).toEqual([]);
    });

    it('lets the same broken body through as a DRAFT (D1 unchanged for object writes)', async () => {
        const { protocol, rows } = makeProtocol();
        const result = await saveObject(protocol, brokenAutonumberObject(), { mode: 'draft' });
        expect(result.success).toBe(true);
        const states = objectRows(rows).map((r) => r.state);
        expect(states).toContain('draft');
        expect(states, 'a draft save must not mint an active row').not.toContain('active');
    });

    it('publishes a clean object with no advisories key — the clean save stays byte-identical', async () => {
        const { protocol, rows } = makeProtocol();
        const result = await saveObject(protocol, cleanTaskObject());
        expect(result.success).toBe(true);
        expect('advisories' in result, `response carried: ${JSON.stringify(result.advisories)}`).toBe(false);
        expect(objectRows(rows)).toHaveLength(1);
    });

    it('the six advisory-tier object rules do NOT ride — the Q2 fence, at the wire', async () => {
        // A field `group` naming a fieldGroup the object never declares is
        // exactly what `validateSemanticRoles` (advisory tier) flags. First
        // prove the body WOULD trip it — a fence test over a body no fenced
        // rule objects to would pin nothing…
        const body = {
            ...cleanTaskObject(),
            fields: { owner: { type: 'text', label: 'Owner', group: 'main_info' } },
        };
        const wouldFire = validateSemanticRoles({ objects: [body] });
        expect(
            wouldFire.some((f: any) => f.rule === 'field-group-undeclared'),
            `the fixture stopped tripping validateSemanticRoles (${JSON.stringify(wouldFire)}) — ` +
                'restore a body the fenced tier flags, or this fence test is vacuous',
        ).toBe(true);

        // …then that the door neither refuses NOR advises: the adjudication's
        // Q2 resolution is that the measured ~8-advisories-per-object-write
        // designer noise never materialises at this scope. An `advisories` key
        // appearing here means an advisory rule crossed the wall — that is a
        // UX/volume decision with its own card, not a drive-by.
        const { protocol, rows } = makeProtocol();
        const result = await saveObject(protocol, body);
        expect(result.success).toBe(true);
        expect('advisories' in result, `advisories leaked: ${JSON.stringify(result.advisories)}`).toBe(false);
        expect(objectRows(rows)).toHaveLength(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// #17936 — the PERMISSION write door, advisory tier.
//
// #17425's ruling D named a population: authors who write permission metadata
// as JSON through Studio / REST `/meta` / MCP and never run `os lint`. For that
// population `validateRetiredPermissionResidue` was registered CLI_ONLY, so the
// one door they have gave no signal at all — `allowRestore: false` parsed
// clean, the residue stage swallowed it in silence, and the line they wrote had
// no effect and nothing said so.
//
// THE MEASUREMENT THIS BLOCK EXISTS TO TAKE. The entry's `surfaceReason` held
// the crossing back on an open question: does the gate's `body` reach the rule
// BEFORE the per-type `safeParse`, whose residue stage strips the only evidence
// the rule reads? It does — and not by luck. For every type but `view` (a
// permission set among them; a `view` stores its parsed body since #20051),
// `saveMetaItem` keeps the AUTHORED body verbatim and grafts back exactly two normalizations,
// each a walk over the authored keys that adds nothing and drops nothing else.
// So the residue is still there at the gate call, and the persisted row proves
// it from the other side. Post-parse the rule would indeed be structurally
// silent — which is why this is pinned end to end at the door rather than
// argued from the registry.
//
// The severity is ruling D's: an advisory on the 2xx the write earns. A residue
// key must NEVER refuse a publish.
// ─────────────────────────────────────────────────────────────────────────────

describe('runtime authoring gate on PERMISSION writes — retired lifecycle residue (#17936)', () => {
    let warn: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        delete process.env.OS_ALLOW_UNLINTED_METADATA_WRITES;
    });
    afterEach(() => {
        warn.mockRestore();
        delete process.env.OS_ALLOW_UNLINTED_METADATA_WRITES;
    });

    const RESIDUE_RULE = 'permission-retired-lifecycle-residue';

    const permissionRows = (rows: Map<string, Row>) =>
        Array.from(rows.values()).filter((r) => r.type === 'permission');

    /** A permission set carrying the ONE value the tombstone's residue stage swallows. */
    const residuePermissionSet = () => ({
        name: 'sales_team',
        label: 'Sales Team',
        objects: {
            // `readScope` is authored on purpose: without it `validateSecurityPosture`
            // adds its own `security-private-no-readscope` info advisory to every
            // one of these writes, and the DARK reading below would then be "one
            // advisory instead of two" rather than a true zero.
            leave_request: { allowRead: true, allowEdit: true, readScope: 'own', allowRestore: false },
        },
    });

    /** The same set with the retired key removed — the document the hint asks for. */
    const cleanPermissionSet = () => ({
        name: 'sales_team',
        label: 'Sales Team',
        objects: {
            leave_request: { allowRead: true, allowEdit: true, readScope: 'own' },
        },
    });

    const savePermission = (protocol: any, item: unknown, extra: Record<string, unknown> = {}) =>
        protocol.saveMetaItem({ type: 'permission', name: 'sales_team', item, ...extra });

    it('advises on a residue write, in the door\'s existing envelope, and STILL PUBLISHES', async () => {
        const { protocol, rows } = makeProtocol();

        const result = await savePermission(protocol, residuePermissionSet());

        // Ruling D: advisory, never a refusal. The write lands.
        expect(result.success).toBe(true);
        expect(permissionRows(rows)).toHaveLength(1);

        const advisory = (result.advisories ?? []).find((a: any) => a.rule === RESIDUE_RULE);
        expect(
            advisory,
            `advisories: ${JSON.stringify(result.advisories)} — this is the #17425 ruling D population's ONLY door`,
        ).toBeDefined();
        // A true reading, not a filtered one: with `readScope` authored the
        // residue advisory is the ONLY thing this write earns.
        expect((result.advisories ?? []).map((a: any) => a.rule)).toEqual([RESIDUE_RULE]);
        expect(advisory.severity).toBe('warning');
        // The key, the site and the remedy — the three things the author needs
        // to act, in the same six-key shape Studio and MCP already render for
        // the 422's `issues[]`.
        expect(advisory.message).toContain('allowRestore');
        expect(advisory.where).toContain('sales_team');
        expect(advisory.where).toContain('leave_request');
        expect(advisory.path).toBe('permissions.sales_team.objects.leave_request.allowRestore');
        expect(advisory.hint.length, 'the prescription is read from the tombstone, not retyped')
            .toBeGreaterThan(10);
    });

    it('THE MEASUREMENT: the residue survives the per-type safeParse to reach the gate', async () => {
        // The premise the crossing rests on, read off the persisted row: the
        // body `saveMetaItem` hands the gate is the AUTHORED one, so the key
        // the parse would have stripped is still present where the rule reads.
        // Were it otherwise the advisory above could not exist, and wiring the
        // rule here would have published a phantom check.
        const { protocol, rows } = makeProtocol();
        await savePermission(protocol, residuePermissionSet());

        const row = permissionRows(rows)[0]!;
        const stored = JSON.parse(row.metadata);
        expect(
            stored.objects.leave_request,
            'the door persists the authored body verbatim — `parsed.data` would have stripped this',
        ).toHaveProperty('allowRestore', false);
    });

    it('`allowPurge` is the second arm, and both keys together advise twice', async () => {
        const { protocol } = makeProtocol();
        const result = await savePermission(protocol, {
            name: 'sales_team',
            objects: {
                leave_request: { allowRead: true, readScope: 'own', allowRestore: false, allowPurge: false },
            },
        });

        expect(result.success).toBe(true);
        const paths = (result.advisories ?? [])
            .filter((a: any) => a.rule === RESIDUE_RULE)
            .map((a: any) => a.path)
            .sort();
        expect(paths).toEqual([
            'permissions.sales_team.objects.leave_request.allowPurge',
            'permissions.sales_team.objects.leave_request.allowRestore',
        ]);
    });

    it('a CLEAN permission write carries no advisories key at all', async () => {
        const { protocol, rows } = makeProtocol();
        const result = await savePermission(protocol, cleanPermissionSet());

        expect(result.success).toBe(true);
        expect(
            'advisories' in result,
            `advisories leaked on a clean write: ${JSON.stringify(result.advisories)}`,
        ).toBe(false);
        expect(permissionRows(rows)).toHaveLength(1);
    });

    it('a DRAFT save of the same body is not judged (D1 unchanged)', async () => {
        const { protocol } = makeProtocol();
        const result = await savePermission(protocol, residuePermissionSet(), { mode: 'draft' });

        expect(result.success).toBe(true);
        expect(
            'advisories' in result,
            `a draft is allowed to be half-finished: ${JSON.stringify(result.advisories)}`,
        ).toBe(false);
    });

    it('the advisory reaches the operator log once, deduped per type|name|rule|path', async () => {
        // The gate's own operator channel, unchanged by this crossing — kept
        // because the wire advisory is the AUTHOR's channel and the log is the
        // operator's, and Studio republishes the same body a lot.
        //
        // ⚠️ A NAME OF ITS OWN, and that is a correctness property of this case
        // rather than tidiness: `_advisoryWarned` is a module-level Set keyed
        // `type|name|rule|path` for the whole PROCESS, so reusing `sales_team`
        // here would read 0 lines because an earlier case in this file already
        // spent that key — a dedupe working exactly as designed, misread as a
        // missing log.
        const { protocol } = makeProtocol();
        await protocol.saveMetaItem({
            type: 'permission',
            name: 'audit_team',
            item: { ...residuePermissionSet(), name: 'audit_team' },
        });

        const lines = (warn.mock.calls as unknown[][])
            .map((c) => String(c[0]))
            .filter((m) => m.includes(RESIDUE_RULE));
        expect(lines.length).toBe(1);
        expect(lines[0]).toContain('audit_team');
        expect(lines[0]).toContain('allowRestore');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// #20158 — the RLS read-scope judge at the PERMISSION write door.
//
// `validateRlsPredicateEnforceability` crossed to this door for `permission`
// writes, and it judges every read-scope `using` with the engine's judge-only
// admission (`IObjectQLEngine.judgeFilter`), which this door takes from its
// HOST: `assertRuntimeAuthoringRules` probes `typeof engine.judgeFilter` and
// hands the bound method through the pure gate. The stub host below stands in
// for the engine's STORAGE only; the judge it carries records what it is asked.
// The engine's real verdicts over the fifteen classes, at both doors, are
// pinned in `packages/cli/test/rls-policy-authoring-admission.test.ts`, which
// holds a real engine (this package may not load one: the engine depends on it).
// ─────────────────────────────────────────────────────────────────────────────

describe('runtime authoring gate on PERMISSION writes — the engine judge (#20158)', () => {
    let warn: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        delete process.env.OS_ALLOW_UNLINTED_METADATA_WRITES;
    });
    afterEach(() => {
        warn.mockRestore();
        delete process.env.OS_ALLOW_UNLINTED_METADATA_WRITES;
    });

    const permissionRows = (rows: Map<string, Row>) =>
        Array.from(rows.values()).filter((r) => r.type === 'permission');

    /** A permission set with one read-scope policy on the stub's `leave_request`. */
    const policySet = (using: string) => ({
        name: 'sales_team',
        label: 'Sales Team',
        objects: { leave_request: { allowRead: true, readScope: 'own' } },
        rowLevelSecurity: [{ name: 'own_rows', object: 'leave_request', operation: 'select', using }],
    });

    const REFUSAL = {
        ok: false as const,
        code: 'FILTER_TOKEN_UNRESOLVED',
        status: 400,
        message: 'Filter placeholder "{current_user_id}" cannot be resolved: the request has no authenticated user.',
    };

    function hostWithJudge(verdict: { ok: true } | typeof REFUSAL) {
        const { engine, rows } = makeStubEngine();
        const calls: Array<{ self: unknown; object: string; where: unknown; options: unknown }> = [];
        engine.judgeFilter = function judgeFilter(this: unknown, object: string, where: unknown, options: unknown) {
            calls.push({ self: this, object, where, options });
            return verdict;
        };
        const protocol = new ObjectStackProtocolImplementation(engine, () => new Map(), 'env_test') as any;
        return { engine, rows, calls, protocol };
    }

    it('probes the host engine for `judgeFilter` and hands it through, BOUND to that engine', async () => {
        const { engine, rows, calls, protocol } = hostWithJudge({ ok: true });

        const result = await protocol.saveMetaItem({
            type: 'permission', name: 'sales_team', item: policySet('owner == current_user.id'),
        });

        expect(result.success).toBe(true);
        expect(permissionRows(rows)).toHaveLength(1);
        // Asked about the lowered read scope, on the policy's object, as a read.
        expect(calls.map(({ object, where, options }) => ({ object, where, options }))).toEqual([
            { object: 'leave_request', where: { owner: '__objectstack_lint_probe__' }, options: { operation: 'find' } },
        ]);
        // `judgeFilter` reads its engine's registry through `this`.
        expect(calls[0]!.self).toBe(engine);
    });

    it('a judge refusal refuses the publish in the gate\'s own 422 envelope, the engine\'s sentence verbatim', async () => {
        const { rows, protocol } = hostWithJudge(REFUSAL);

        const err = await protocol.saveMetaItem({
            type: 'permission', name: 'sales_team', item: policySet("owner == '{current_user_id}'"),
        }).then(() => null, (e: unknown) => e);

        expect({ code: (err as any)?.code, status: (err as any)?.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
        const issues = (err as { issues: Array<{ rule: string; path: string; message: string }> }).issues;
        expect(issues.map((i) => ({ rule: i.rule, path: i.path }))).toEqual([
            { rule: 'rls-predicate-unenforceable', path: 'permissions.sales_team.rowLevelSecurity[0].using' },
        ]);
        expect(issues[0]!.message).toContain(`(${REFUSAL.code} / ${REFUSAL.status}): ${REFUSAL.message}`);
        expect(permissionRows(rows), 'a refused publish writes nothing').toHaveLength(0);
    });

    it('a host engine WITHOUT the member keeps its answer on a judge-only class, and the rule still runs here', async () => {
        // The optional member's ruling (#19995 C): a host without it keeps its
        // existing behaviour for what only the engine can judge…
        const { engine, rows } = makeStubEngine();
        expect(typeof engine.judgeFilter).toBe('undefined');
        const protocol = new ObjectStackProtocolImplementation(engine, () => new Map(), 'env_test') as any;
        const kept = await protocol.saveMetaItem({
            type: 'permission', name: 'sales_team', item: policySet("owner == '{current_user_id}'"),
        });
        expect(kept.success).toBe(true);
        expect(permissionRows(rows)).toHaveLength(1);

        // …while the rule itself now runs at this door: a predicate that does
        // not parse as CEL was ACCEPTED here before this crossing.
        const err = await protocol.saveMetaItem({
            type: 'permission', name: 'audit_team',
            item: { ...policySet("owner = 'x' AND owner = 'y'"), name: 'audit_team' },
        }).then(() => null, (e: unknown) => e);
        expect({ code: (err as any)?.code, status: (err as any)?.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
        expect((err as { issues: Array<{ rule: string }> }).issues.map((i) => i.rule)).toEqual([
            'rls-predicate-unparseable',
        ]);
    });

    it('a DRAFT save is not judged (D1 unchanged)', async () => {
        const { calls, protocol } = hostWithJudge(REFUSAL);
        const result = await protocol.saveMetaItem({
            type: 'permission', name: 'sales_team', item: policySet("owner == '{current_user_id}'"), mode: 'draft',
        });
        expect(result.success).toBe(true);
        expect(calls).toEqual([]);
    });
});

/**
 * [#20312] ADR-0080 §5 at the save door — an html page's `source` is compiled
 * against the deployment's SDUI component manifest, read per publish from the
 * `SDUI_MANIFEST_SERVICE` key the host (`os serve`) registers.
 *
 * The manifest here is a minimal stand-in with the real one's shape: `flex` and
 * `box` in the `ui` namespace (as in the pinned console's manifest) and one
 * plugin component in `plugin-kanban`.
 */
describe('html page source compiled at the save door against the SDUI manifest (#20312)', () => {
    const slot = { name: 'children', type: 'slot' };
    const manifest = () => ({
        components: {
            flex: { type: 'flex', namespace: 'ui', isContainer: true, inputs: [slot] },
            box: { type: 'box', namespace: 'ui', isContainer: true, inputs: [slot] },
            kanban: { type: 'kanban', namespace: 'plugin-kanban', inputs: [] },
        },
    });
    const htmlPage = (source: string, extra: Record<string, unknown> = {}) => ({
        name: 'landing', label: 'Landing', kind: 'html', source, ...extra,
    });
    const KNOWN = '<flex><box>hello</box></flex>';
    const UNKNOWN = '<flex><plugin-nonexistent /></flex>';

    /** A protocol whose services table the test holds, so the key can be set and changed per publish. */
    function hostWith(services: Map<string, unknown>) {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine, () => services, 'env_test') as any;
        return { protocol, rows };
    }
    const pageRows = (rows: Map<string, Row>) => Array.from(rows.values()).filter((r) => r.type === 'page');
    const storedPage = (rows: Map<string, Row>, state = 'active') => {
        const row = pageRows(rows).find((r) => r.state === state);
        return row ? JSON.parse(row.metadata) : undefined;
    };
    const savePage = (protocol: any, item: unknown, extra: Record<string, unknown> = {}) =>
        protocol.saveMetaItem({ type: 'page', name: 'landing', item, ...extra });
    const refusal = (e: any) => ({ code: e?.code, status: e?.status });

    let warn: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        delete process.env.OS_ALLOW_UNLINTED_METADATA_WRITES;
    });
    afterEach(() => {
        warn.mockRestore();
    });

    it('the exported key is the one the save door reads', () => {
        expect(SDUI_MANIFEST_SERVICE).toBe('sdui-manifest');
    });

    it('refuses an unknown component with a 422 whose issues name it, and persists nothing', async () => {
        const { protocol, rows } = hostWith(new Map([['sdui-manifest', manifest()]]));
        const err = await savePage(protocol, htmlPage(UNKNOWN)).catch((e: any) => e);
        expect(refusal(err)).toEqual({ code: 'INVALID_METADATA', status: 422 });
        const named = err.issues.filter((i: any) => i.rule.startsWith('jsx-'));
        expect(named.length, JSON.stringify(err.issues)).toBeGreaterThan(0);
        for (const issue of named) {
            expect(issue.where).toBe('page "landing" › <plugin-nonexistent>');
            expect(issue.message).toContain('<plugin-nonexistent>');
            expect(issue.path).toBe('pages.landing.source');
        }
        expect(err.rulesRun).toContain('html-page-source-compile');
        expect(pageRows(rows)).toEqual([]);
    });

    it('saves a page built from known components and stamps `requires` from the compile', async () => {
        const { protocol, rows } = hostWith(new Map([['sdui-manifest', manifest()]]));
        const result = await savePage(protocol, htmlPage(`<flex><box>a</box><kanban /></flex>`));
        expect(result.success).toBe(true);
        expect(storedPage(rows)?.requires).toEqual(['ui', 'plugin-kanban']);
    });

    it('keeps a hand-written `requires` that agrees with the source, in the compiled order', async () => {
        const { protocol, rows } = hostWith(new Map([['sdui-manifest', manifest()]]));
        const result = await savePage(protocol, htmlPage(`<flex><kanban /></flex>`, { requires: ['plugin-kanban', 'ui'] }));
        expect(result.success).toBe(true);
        expect(storedPage(rows)?.requires).toEqual(['ui', 'plugin-kanban']);
    });

    it('refuses a hand-written `requires` that disagrees with the source, naming each namespace', async () => {
        const { protocol, rows } = hostWith(new Map([['sdui-manifest', manifest()]]));

        const unused = await savePage(protocol, htmlPage(KNOWN, { requires: ['ui', 'plugin-kanban'] })).catch((e: any) => e);
        expect(refusal(unused)).toEqual({ code: 'INVALID_METADATA', status: 422 });
        const unusedIssue = unused.issues.find((i: any) => i.rule === 'page-requires-disagrees-with-source');
        expect(unusedIssue?.path).toBe('pages.landing.requires');
        expect(unusedIssue?.message).toContain(`'plugin-kanban' is not used by the source`);

        const unprovided = await savePage(protocol, htmlPage(KNOWN, { requires: ['ui', 'plugin-absent'] })).catch((e: any) => e);
        expect(refusal(unprovided)).toEqual({ code: 'INVALID_METADATA', status: 422 });
        expect(unprovided.issues.map((i: any) => i.message).join('\n'))
            .toContain(`'plugin-absent' is a namespace no component in this deployment's manifest carries`);

        const missing = await savePage(protocol, htmlPage(`<flex><kanban /></flex>`, { requires: ['ui'] })).catch((e: any) => e);
        expect(refusal(missing)).toEqual({ code: 'INVALID_METADATA', status: 422 });
        expect(missing.issues.map((i: any) => i.message).join('\n'))
            .toContain(`'plugin-kanban' is used by the source but not listed`);

        expect(pageRows(rows)).toEqual([]);
    });

    it('a host with no manifest saves exactly as before: nothing compiled, nothing stamped', async () => {
        const { protocol, rows } = hostWith(new Map());
        const result = await savePage(protocol, htmlPage(UNKNOWN, { requires: ['plugin-absent'] }));
        expect(result.success).toBe(true);
        const stored = storedPage(rows);
        expect(stored?.source).toBe(UNKNOWN);
        expect(stored?.requires).toEqual(['plugin-absent']);
    });

    it('reads the key per publish: registering, fixing or removing it takes effect on the next save', async () => {
        const services = new Map<string, unknown>();
        const { protocol } = hostWith(services);

        await expect(savePage(protocol, htmlPage(UNKNOWN))).resolves.toMatchObject({ success: true });

        services.set('sdui-manifest', manifest());
        const refused = await savePage(protocol, htmlPage(UNKNOWN)).catch((e: any) => e);
        expect(refusal(refused)).toEqual({ code: 'INVALID_METADATA', status: 422 });

        const widened = manifest() as any;
        widened.components['plugin-nonexistent'] = { type: 'plugin-nonexistent', namespace: 'plugin-extra', inputs: [] };
        services.set('sdui-manifest', widened);
        await expect(savePage(protocol, htmlPage(UNKNOWN))).resolves.toMatchObject({ success: true });

        services.delete('sdui-manifest');
        await expect(savePage(protocol, htmlPage('<nothing-known />'))).resolves.toMatchObject({ success: true });
    });

    it('a draft is not gated but its publish is — the draft door is not a bypass', async () => {
        const { protocol, rows } = hostWith(new Map([['sdui-manifest', manifest()]]));
        await expect(savePage(protocol, htmlPage(KNOWN, { requires: ['plugin-absent'] }), { mode: 'draft' }))
            .resolves.toMatchObject({ success: true });
        // Left as written for the publish to refuse, not silently re-stamped.
        expect(storedPage(rows, 'draft')?.requires).toEqual(['plugin-absent']);

        const err = await protocol.publishMetaItem({ type: 'page', name: 'landing' }).catch((e: any) => e);
        expect(refusal(err)).toEqual({ code: 'INVALID_METADATA', status: 422 });
        expect(err.issues.map((i: any) => i.rule)).toContain('page-requires-disagrees-with-source');
    });

    it('a draft that compiles is stamped at its save, and publishes clean', async () => {
        const { protocol, rows } = hostWith(new Map([['sdui-manifest', manifest()]]));
        await savePage(protocol, htmlPage(KNOWN), { mode: 'draft' });
        expect(storedPage(rows, 'draft')?.requires).toEqual(['ui']);
        await expect(protocol.publishMetaItem({ type: 'page', name: 'landing' }))
            .resolves.toMatchObject({ success: true });
    });

    it('a registered value that is not a manifest is warned about once and compiled against never', async () => {
        const { protocol, rows } = hostWith(new Map([['sdui-manifest', { oops: true }]]));
        await expect(savePage(protocol, htmlPage(UNKNOWN))).resolves.toMatchObject({ success: true });
        await expect(savePage(protocol, htmlPage(UNKNOWN))).resolves.toMatchObject({ success: true });
        expect(storedPage(rows)?.requires).toBeUndefined();
        const lines = (warn.mock.calls as unknown[][]).map((c) => String(c[0])).filter((m) => m.includes(`'sdui-manifest' service`));
        expect(lines).toHaveLength(1);
    });
});

/**
 * [#20312] ADR-0080 §5 — `requires` is "validated at save and load", and it is
 * derived from the source, never carried. The save door's half is pinned in
 * the block above; this block pins the other two moments a stored page's
 * `requires` meets the deployment's manifest:
 *
 *  - **At load** (`loadMetaFromDb`, the boot hydration of stored rows): a page
 *    whose `requires` names a namespace no component in the manifest carries —
 *    a plugin this deployment's console does not load — is reported with the
 *    page and the namespace named, and the page still loads. It reads the same
 *    `SDUI_MANIFEST_SERVICE` key the save door reads; with no manifest
 *    registered nothing is judged, exactly as at the save door.
 *  - **At draft → active promotion** (`publishMetaItem` and
 *    `publishPackageDrafts`, both through `promoteDraftForPublish`): the
 *    promoted body carries the `requires` the save door computes for it
 *    (`stampHtmlPageRequires`), not the draft's.
 */
describe('stored html page `requires` at load and at draft promotion (#20312)', () => {
    const slot = { name: 'children', type: 'slot' };
    const manifest = (withKanban = true) => ({
        components: {
            flex: { type: 'flex', namespace: 'ui', isContainer: true, inputs: [slot] },
            box: { type: 'box', namespace: 'ui', isContainer: true, inputs: [slot] },
            ...(withKanban ? { kanban: { type: 'kanban', namespace: 'plugin-kanban', inputs: [] } } : {}),
        },
    });
    const htmlPage = (source: string, extra: Record<string, unknown> = {}) => ({
        name: 'landing', label: 'Landing', kind: 'html', source, ...extra,
    });
    const WITH_KANBAN = '<flex><box>a</box><kanban /></flex>';

    /** A protocol whose services table the test holds, plus the registry writes boot hydration makes. */
    function hostWith(services: Map<string, unknown>) {
        const { engine, rows } = makeStubEngine();
        const registered: Array<{ type: string; name: unknown }> = [];
        engine.registry.registerItem = (type: string, item: { name?: unknown }) => {
            registered.push({ type, name: item?.name });
        };
        const protocol = new ObjectStackProtocolImplementation(engine, () => services, 'env_test') as any;
        return { protocol, rows, registered };
    }
    const storedPage = (rows: Map<string, Row>, state = 'active') => {
        const row = Array.from(rows.values()).find((r) => r.type === 'page' && r.state === state);
        return row ? JSON.parse(row.metadata) : undefined;
    };
    const savePage = (protocol: any, item: unknown, extra: Record<string, unknown> = {}) =>
        protocol.saveMetaItem({ type: 'page', name: 'landing', item, ...extra });
    const loadReports = (warn: ReturnType<typeof vi.spyOn>) =>
        (warn.mock.calls as unknown[][]).map((c) => String(c[0])).filter((m) => m.includes('[page_requires_plugin_absent]'));

    let warn: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        delete process.env.OS_ALLOW_UNLINTED_METADATA_WRITES;
    });
    afterEach(() => {
        warn.mockRestore();
    });

    // ── At load ──────────────────────────────────────────────────────────

    it('at load, a stored page naming a plugin the manifest does not carry is reported — page and plugin named — and still loads', async () => {
        const services = new Map<string, unknown>();
        const { protocol, rows, registered } = hostWith(services);
        // Stored on a host with no manifest, so stored as written…
        await savePage(protocol, htmlPage(WITH_KANBAN, { requires: ['ui', 'plugin-kanban'] }));
        expect(storedPage(rows)?.requires).toEqual(['ui', 'plugin-kanban']);
        // …and the deployment's console now carries no `plugin-kanban` component.
        services.set('sdui-manifest', manifest(false));

        const result = await protocol.loadMetaFromDb();

        expect(result).toMatchObject({ loaded: 1, errors: 0, storeUnavailable: false });
        expect(registered).toContainEqual({ type: 'page', name: 'landing' });
        const lines = loadReports(warn);
        expect(lines, JSON.stringify(warn.mock.calls)).toHaveLength(1);
        expect(lines[0]).toContain('page/landing');
        expect(lines[0]).toContain(`'plugin-kanban'`);
        expect(lines[0]).not.toContain(`'ui'`);
    });

    it('at load, a stored page whose every plugin is present is not reported (the control)', async () => {
        const services = new Map<string, unknown>();
        const { protocol, registered } = hostWith(services);
        await savePage(protocol, htmlPage(WITH_KANBAN, { requires: ['ui', 'plugin-kanban'] }));
        services.set('sdui-manifest', manifest(true));

        const result = await protocol.loadMetaFromDb();

        expect(result).toMatchObject({ loaded: 1, errors: 0 });
        expect(registered).toContainEqual({ type: 'page', name: 'landing' });
        expect(loadReports(warn)).toEqual([]);
    });

    it('at load, a host with no manifest judges nothing — the save door\'s posture', async () => {
        const { protocol, registered } = hostWith(new Map());
        await savePage(protocol, htmlPage(WITH_KANBAN, { requires: ['ui', 'plugin-absent'] }));

        const result = await protocol.loadMetaFromDb();

        expect(result).toMatchObject({ loaded: 1, errors: 0 });
        expect(registered).toContainEqual({ type: 'page', name: 'landing' });
        expect(loadReports(warn)).toEqual([]);
    });

    // ── At draft → active promotion ──────────────────────────────────────

    it('a draft saved before the manifest arrived is promoted with the `requires` the save door computes', async () => {
        const services = new Map<string, unknown>();
        const { protocol, rows } = hostWith(services);
        const body = htmlPage(WITH_KANBAN);
        await savePage(protocol, body, { mode: 'draft' });
        expect(storedPage(rows, 'draft')?.requires).toBeUndefined();
        services.set('sdui-manifest', manifest());

        await expect(protocol.publishMetaItem({ type: 'page', name: 'landing' }))
            .resolves.toMatchObject({ success: true });

        const saveDoor = stampHtmlPageRequires('page', body, manifest()) as { requires?: unknown };
        expect(saveDoor.requires).toEqual(['ui', 'plugin-kanban']);
        expect(storedPage(rows)?.requires).toEqual(saveDoor.requires);
    });

    it('an agreeing draft `requires` is promoted as the save door spells it, not as the draft carried it', async () => {
        const services = new Map<string, unknown>();
        const { protocol, rows } = hostWith(services);
        const body = htmlPage(WITH_KANBAN, { requires: ['plugin-kanban', 'ui', 'ui'] });
        await savePage(protocol, body, { mode: 'draft' });
        services.set('sdui-manifest', manifest());

        await expect(protocol.publishMetaItem({ type: 'page', name: 'landing' }))
            .resolves.toMatchObject({ success: true });

        expect(storedPage(rows)?.requires)
            .toEqual((stampHtmlPageRequires('page', body, manifest()) as { requires?: unknown }).requires);
        expect(storedPage(rows)?.requires).toEqual(['ui', 'plugin-kanban']);
    });

    it('the package batch promotion re-stamps too', async () => {
        const services = new Map<string, unknown>();
        const { protocol, rows } = hostWith(services);
        const body = htmlPage(WITH_KANBAN);
        await savePage(protocol, body, { mode: 'draft', packageId: 'com.example.pages' });
        services.set('sdui-manifest', manifest());

        const result = await protocol.publishPackageDrafts({ packageId: 'com.example.pages' });

        expect(result, JSON.stringify(result.failed)).toMatchObject({ success: true, publishedCount: 1 });
        expect(storedPage(rows)?.requires)
            .toEqual((stampHtmlPageRequires('page', body, manifest()) as { requires?: unknown }).requires);
    });

    it('a promotion on a host with no manifest stores the draft as written — the save door\'s posture', async () => {
        const { protocol, rows } = hostWith(new Map());
        await savePage(protocol, htmlPage(WITH_KANBAN, { requires: ['plugin-absent'] }), { mode: 'draft' });

        await expect(protocol.publishMetaItem({ type: 'page', name: 'landing' }))
            .resolves.toMatchObject({ success: true });

        expect(storedPage(rows)?.requires).toEqual(['plugin-absent']);
    });
});
