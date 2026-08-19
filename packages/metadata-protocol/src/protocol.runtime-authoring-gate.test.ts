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
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
// [#4716] The advisory-tier rule the Q2 fence test proves its body WOULD trip
// — imported from the full barrel deliberately: this is a TEST, not the gate
// (the gate itself may only reach the registry through `@objectstack/lint/runtime`,
// which the wiring guard enforces on the gate's own source).
import { validateSemanticRoles } from '@objectstack/lint';
import { ObjectStackProtocolImplementation } from './protocol.js';
import type { MetadataAuthoringChannel } from './protocol.js';

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
    const rows = new Map<string, Row>();
    let nextId = 0;
    const findRow = (w: Record<string, unknown>): { key: string; row: Row } | null => {
        if (w.id !== undefined) {
            for (const [k, r] of rows) if (r.id === w.id) return { key: k, row: r };
            return null;
        }
        for (const [k, r] of rows) {
            if (w.type !== undefined && r.type !== w.type) continue;
            if (w.name !== undefined && r.name !== w.name) continue;
            if (w.organization_id !== undefined && r.organization_id !== w.organization_id) continue;
            if (w.state !== undefined && r.state !== w.state) continue;
            return { key: k, row: r };
        }
        return null;
    };
    const engine: any = {
        async findOne(_t: string, opts: { where: Record<string, unknown> }) {
            return findRow(opts.where)?.row ?? null;
        },
        async find(_t: string, opts: { where: Record<string, unknown> }) {
            return Array.from(rows.values()).filter((r) => {
                if (opts.where.type && r.type !== opts.where.type) return false;
                if (opts.where.organization_id !== undefined
                    && r.organization_id !== opts.where.organization_id) return false;
                if (opts.where.state && r.state !== opts.where.state) return false;
                return true;
            });
        },
        async insert(_t: string, data: Record<string, unknown>) {
            if (_t === 'sys_metadata_audit') return { id: 'audit_skip' };
            nextId += 1;
            const row = { id: `r_${nextId}`, ...(data as any) } as Row;
            rows.set(keyOf(data), row);
            return { id: row.id };
        },
        async update(_t: string, data: Record<string, unknown>, opts: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(data, opts);
            const found = findRow(opts.where);
            if (!found) return { id: null };
            rows.set(found.key, { ...found.row, ...(data as any) });
            return { id: found.row.id };
        },
        async delete(_t: string, opts: { where: Record<string, unknown> }) {
            assertEngineDeleteDispatch(opts);
            const found = findRow(opts.where);
            if (!found) return { deleted: 0 };
            rows.delete(found.key);
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

        await expect(save(protocol, brokenApprovalFlow())).rejects.toThrow(/invalid_metadata/);

        const err = await save(protocol, brokenApprovalFlow()).catch((e: any) => e);
        expect(err.status).toBe(422);
        expect(err.code).toBe('INVALID_METADATA');

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
