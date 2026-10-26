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
import {
    assertEngineDeleteDispatch,
    assertEngineUpdateDispatch,
    assertEngineFindOnePredicate,
    // [#21476] The reason the admin read of a view states — the advisory must carry the same bytes.
    anonymousFormIntakeUnavailableMessage,
} from '@objectstack/metadata-core';
// [#4716] The advisory-tier rule the Q2 fence test proves its body WOULD trip
// — imported from the full barrel deliberately: this is a TEST, not the gate
// (the gate itself may only reach the registry through `@objectstack/lint/runtime`,
// which the wiring guard enforces on the gate's own source).
import { validateSemanticRoles } from '@objectstack/lint';
// [#22019] The build's own entry — the call `os build` makes
// (`runAuthoringRules('build', …)`) — so the formula block compares the door's
// verdict against the build's real output, never a restatement of it.
import { EXPRESSION_INVALID, runAuthoringRules } from '@objectstack/lint';
import { ObjectStackProtocolImplementation } from './protocol.js';
import type { MetadataAuthoringChannel } from './protocol.js';
import { SDUI_MANIFEST_SERVICE } from './index.js';
import { RLS_MEMBERSHIP_RESOLVER_SERVICE } from '@objectstack/spec/contracts';
import { PUBLIC_FORM_INTAKE_UNAVAILABLE, stampHtmlPageRequires } from './runtime-authoring-gate.js';

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
                if (opts.where.type && !whereValueMatches(r.type, opts.where.type)) return false;
                if (opts.where.name !== undefined && r.name !== opts.where.name) return false;
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

/** [#24371] One `where` value as the store reads it: `{ $in: [...] }` (the by-name read's both-spellings `type`) or equality. */
const whereValueMatches = (actual: unknown, want: unknown): boolean =>
    want !== null && typeof want === 'object' && Array.isArray((want as { $in?: unknown }).$in)
        ? (want as { $in: unknown[] }).$in.includes(actual)
        : actual === want;

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
    // surfaces (PR #8390) and commit 018d22cc3 put `object` in its `runtimeTypes`, so
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

    // [#21459] `requires` exists only on the kinds this door compiles. On any
    // other kind the spec parse refuses it before the compile runs, so the
    // refusal is the spec's own issue at `requires` — not a compile finding.
    it.each(['react', 'full', 'slotted', undefined])(
        'refuses `requires` on a `%s` page with a 422 at `requires`, and persists nothing (#21459)',
        async (kind) => {
            const { protocol, rows } = hostWith(new Map([['sdui-manifest', manifest()]]));
            const page = {
                name: 'landing', label: 'Landing', requires: ['ui'],
                ...(kind === undefined ? {} : { kind }),
                ...(kind === 'react' ? { source: KNOWN } : {}),
            };
            const err = await savePage(protocol, page).catch((e: any) => e);
            expect(refusal(err)).toEqual({ code: 'INVALID_METADATA', status: 422 });
            const issues = err.issues.filter((i: any) => i.path === 'requires');
            expect(issues, JSON.stringify(err.issues)).toHaveLength(1);
            expect(issues[0].code).toBe('custom');
            expect(issues[0].message).toContain(`\`kind: '${kind ?? 'full'}'\``);
            expect(err.issues.some((i: any) => String(i.rule ?? '').startsWith('jsx-'))).toBe(false);
            expect(pageRows(rows)).toEqual([]);
        },
    );

    it('CONTROL: the same `requires` on an html page still saves, and the compile stamps it (#21459)', async () => {
        const { protocol, rows } = hostWith(new Map([['sdui-manifest', manifest()]]));
        await expect(savePage(protocol, htmlPage(KNOWN, { requires: ['ui'] }))).resolves.toMatchObject({ success: true });
        expect(storedPage(rows)?.requires).toEqual(['ui']);
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

    // [#21459] A row stored before `requires` was narrowed to the compiled
    // kinds: a react page carrying the key, which the save door now refuses, so
    // it is seeded straight into the store. The stored-row seam replays the D2
    // conversion `page-requires-non-compiled-kind-removed` before anything reads
    // the body — so the row loads with the key gone and a notice saying so, the
    // spec check finds nothing to report, and the load report never sees a list.
    it('at load, a stored react page carrying `requires` is read without it — converted, not reported or badged (#21459)', async () => {
        const services = new Map<string, unknown>([['sdui-manifest', manifest(false)]]);
        const { protocol, rows, registered } = hostWith(services);
        const body = { name: 'workbench', label: 'Workbench', kind: 'react', source: '<Workbench />', requires: ['plugin-kanban'] };
        rows.set(keyOf({ type: 'page', name: 'workbench', organization_id: null, state: 'active' }), {
            id: 'r_seed', type: 'page', name: 'workbench', organization_id: null, state: 'active', metadata: JSON.stringify(body),
        });

        const result = await protocol.loadMetaFromDb();

        expect(result).toMatchObject({ loaded: 1, errors: 0, invalid: 0 });
        expect(registered).toContainEqual({ type: 'page', name: 'workbench' });
        const lines = (warn.mock.calls as unknown[][]).map((c) => String(c[0]));
        const converted = lines.filter((m) => m.includes('stored page/workbench carries a pre-protocol shape'));
        expect(converted, JSON.stringify(lines)).toHaveLength(1);
        expect(converted[0]).toContain("ADR-0087 conversion 'page-requires-non-compiled-kind-removed'");
        expect(converted[0]).toContain('page.requires at pages[0].requires');
        // The manifest carries no `plugin-kanban`, so an unconverted list WOULD
        // have been reported — its absence is the conversion's doing.
        expect(loadReports(warn)).toEqual([]);
        expect(lines.filter((m) => m.includes('[metadata_spec_invalid]'))).toEqual([]);
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

/**
 * [#21476] The public-form intake advisory, end to end through the two write
 * doors: `saveMetaItem` (REST `PUT /meta/view/:name`) and the draft → active
 * promotion `publishMetaItem` (REST `POST /meta/view/:name/publish`).
 *
 * The posture is read off a `tenancy` service in the protocol's own services
 * table — the service, and the reader (`anonymousFormIntakePosture`), the
 * anonymous form doors read. The rows pin both halves: on a walled posture in
 * force the write SUCCEEDS with exactly one warning, located at the form's
 * `sharing` and carrying the admin read's reason byte for byte; every control
 * the doors serve the form on raises nothing, the degraded deployment included
 * — whose REQUESTED posture (`OS_TENANCY_POSTURE`) walls while its in-force
 * posture does not.
 */
describe('public-form intake advisory on save and publish (#21476)', () => {
    const SLUG = 'contact-us';
    const NAME = 'showcase_inquiry';
    /** The showcase's contact form: a container whose public form is `formViews.contact`. */
    const contactContainer = () => ({
        list: { type: 'grid', data: { provider: 'object', object: NAME }, columns: [{ field: 'name' }] },
        formViews: {
            contact: {
                type: 'simple',
                data: { provider: 'object', object: NAME },
                sections: [{ name: 'about', fields: [{ field: 'name' }, { field: 'email' }] }],
                sharing: { enabled: true, allowAnonymous: true, publicLink: `/forms/${SLUG}` },
            },
        },
    });
    /** The bound object as the live registry holds it — `organization_id` injected at registration. */
    const inquiry = (tenancyDisabled: boolean) => ({
        name: NAME,
        label: 'Inquiry',
        ...(tenancyDisabled ? { tenancy: { enabled: false } } : {}),
        fields: {
            organization_id: { type: 'lookup', reference: 'sys_organization' },
            name: { type: 'text', label: 'Name' },
            email: { type: 'email', label: 'Email' },
        },
    });

    type Tenancy = 'isolated' | 'group' | 'degraded' | 'single' | 'no-service';
    /** A `tenancy` service as plugin-auth registers it: `posture` is the posture IN FORCE. */
    const tenancyService = (t: Exclude<Tenancy, 'no-service'>) => ({
        posture: t === 'degraded' ? 'single' : t,
        requestedPosture: t === 'degraded' ? 'isolated' : t,
        defaultOrgId: async () => (t === 'single' ? 'org_alpha' : null),
    });

    function hostOn(tenancy: Tenancy, tenancyDisabled = false) {
        const { engine, rows } = makeStubEngine();
        engine.registry.listItems = (type: string) => (type === 'object' ? [inquiry(tenancyDisabled)] : []);
        const services = new Map<string, unknown>(
            tenancy === 'no-service' ? [] : [['tenancy', tenancyService(tenancy)]],
        );
        const protocol = new ObjectStackProtocolImplementation(engine, () => services, 'env_test') as any;
        return { protocol, rows };
    }

    const put = (protocol: any, extra: Record<string, unknown> = {}) =>
        protocol.saveMetaItem({ type: 'view', name: NAME, item: contactContainer(), ...extra });
    const publish = async (protocol: any) => {
        await expect(put(protocol, { mode: 'draft' })).resolves.toMatchObject({ success: true });
        return protocol.publishMetaItem({ type: 'view', name: NAME });
    };
    const intake = (response: { advisories?: Array<{ rule: string }> }) =>
        (response.advisories ?? []).filter((a) => a.rule === PUBLIC_FORM_INTAKE_UNAVAILABLE);

    let warn: ReturnType<typeof vi.spyOn>;
    const savedPosture = process.env.OS_TENANCY_POSTURE;
    beforeEach(() => {
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        delete process.env.OS_ALLOW_UNLINTED_METADATA_WRITES;
    });
    afterEach(() => {
        warn.mockRestore();
        if (savedPosture === undefined) delete process.env.OS_TENANCY_POSTURE;
        else process.env.OS_TENANCY_POSTURE = savedPosture;
    });

    for (const posture of ['isolated', 'group'] as const) {
        for (const [door, write] of [['PUT', put], ['publish', publish]] as const) {
            it(`'${posture}' in force, walled object — ${door} succeeds with exactly one warning, the admin read's reason at the form's sharing`, async () => {
                const { protocol, rows } = hostOn(posture);
                const response = await write(protocol);
                expect(response.success).toBe(true);
                expect(response.advisories).toEqual([{
                    severity: 'warning',
                    rule: PUBLIC_FORM_INTAKE_UNAVAILABLE,
                    where: `view "${NAME}" · public form "/forms/${SLUG}"`,
                    path: 'views[0].formViews.contact.sharing',
                    message: anonymousFormIntakeUnavailableMessage(SLUG, {
                        object: NAME, posture, tenantField: 'organization_id',
                    }),
                    hint: expect.stringContaining('tenancy: { enabled: false }'),
                }]);
                // Never a refusal: the row landed active.
                expect([...rows.values()].filter((r) => r.type === 'view' && r.state === 'active')).toHaveLength(1);
            });
        }
    }

    it.each<[string, Tenancy, boolean]>([
        ['walled posture, object declared tenancy: { enabled: false }', 'isolated', true],
        ["the 'single' posture", 'single', false],
        ['no tenancy service registered', 'no-service', false],
    ])('CONTROL — %s: PUT and publish raise no intake advisory', async (_label, tenancy, tenancyDisabled) => {
        const { protocol } = hostOn(tenancy, tenancyDisabled);
        const saved = await put(protocol);
        expect(saved.success).toBe(true);
        expect(intake(saved)).toEqual([]);
        const published = await publish(protocol);
        expect(published.success).toBe(true);
        expect(intake(published)).toEqual([]);
    });

    it('CONTROL — a degraded walled deployment: the REQUESTED posture walls, the posture in force does not; the doors serve, so nothing is raised', async () => {
        process.env.OS_TENANCY_POSTURE = 'isolated';
        const { protocol } = hostOn('degraded');
        const saved = await put(protocol);
        expect(saved.success).toBe(true);
        expect(intake(saved)).toEqual([]);
        const published = await publish(protocol);
        expect(published.success).toBe(true);
        expect(intake(published)).toEqual([]);
    });
});

/**
 * [#22019] The object save door gives the build's verdict on a formula field.
 *
 * `content/docs/data-modeling/formulas.mdx` says "the same `validateExpression`
 * validator backs `os build` and metadata registration". At this door it did
 * not: an object whose formula field calls an unregistered function
 * (`sqrt(record.amount)`) saved with a 200 and read `null` on every row, while
 * `os build` refused the same expression as an unknown function.
 *
 * The cause was one registry declaration, not this door's code: the build's
 * expression rule (`validateStackExpressions`) declared `runtimeTypes` for
 * flows, actions and hooks and never `object`, so `runtimeAuthoringRulesFor`
 * never dispatched it on an object write. The fix is in `@objectstack/lint`,
 * narrowed to the field-formula pass; this block pins it here, through the
 * REAL `saveMetaItem` / `publishMetaItem`:
 *
 *  (a) the door refuses `sqrt(record.amount)` — a 422 carrying the build's
 *      located finding — on an active save AND on a draft's promotion, and
 *      nothing lands;
 *  (b) a registered call (`floor(record.amount)`) still saves;
 *  (d) the door's issue and the build's finding for the same expression are
 *      the same finding: rule, location, message and hint.
 *
 * The read-path half — a row stored before the gate still reads `null`, and
 * the engine says so once per (object, field) — is `@objectstack/objectql`'s
 * `engine-formula-fault-log.test.ts`. Every other pass over the object's body
 * joined this door in #22032's passes 1–4 (the blocks below), and the pin that
 * all of them judge here — and no pass over another collection of the stack —
 * is in `@objectstack/lint`'s `runtime-gate.object-formula-writes.test.ts`.
 *
 * ⚠️ This package's tests reach `@objectstack/lint` through its `exports`, i.e.
 * its built `dist/` (no vitest alias pulls it back to source — the pair is on
 * `KNOWN_UNALIASED_TEST_IMPORTS`). An edit to the rule registry is invisible
 * here until `pnpm --filter @objectstack/lint build` has run.
 */
describe('runtime authoring gate on OBJECT writes — the formula field verdict (#22019)', () => {
    /** `sharingModel` is authored so `security-owd-unset` stays quiet and the refusal is the formula's. */
    const fxSqrt = (expression: string) => ({
        name: 'fx_sqrt',
        label: 'Formula Probe',
        sharingModel: 'private',
        fields: {
            name: { type: 'text', label: 'Name' },
            amount: { type: 'number', label: 'Amount' },
            score: { type: 'formula', label: 'Score', expression },
        },
    });
    const UNREGISTERED = 'sqrt(record.amount)';
    const REGISTERED = 'floor(record.amount)';
    /** Where the build locates a formula finding — the KEY the author edits. */
    const WHERE = "object 'fx_sqrt' · field 'score' expression";

    const fxRows = (rows: Map<string, Row>) =>
        Array.from(rows.values()).filter((r) => r.type === 'object' && r.name === 'fx_sqrt');

    /** The build's findings for one object, through the build's own entry. */
    const buildFindings = (obj: unknown) => {
        const stack = { objects: [obj] };
        return runAuthoringRules('build', { normalized: stack, parsed: stack })
            .filter((f) => f.rule === EXPRESSION_INVALID && f.where === WHERE);
    };

    it("(a) REFUSES an active save of `sqrt(record.amount)` with a 422 carrying the build's located finding", async () => {
        const { protocol, rows } = makeProtocol();

        const err = await protocol
            .saveMetaItem({ type: 'object', name: 'fx_sqrt', item: fxSqrt(UNREGISTERED) })
            .catch((e: any) => e);

        expect(err, 'the save resolved — the door still accepts an unregistered function').toBeInstanceOf(Error);
        expect(err.status).toBe(422);
        expect(err.code).toBe('INVALID_METADATA');
        expect(err.rulesRun).toContain('validateStackExpressions');
        const issue = err.issues.find((i: any) => i.rule === EXPRESSION_INVALID);
        expect(issue, `issues: ${JSON.stringify(err.issues)}`).toBeDefined();
        expect(issue.path).toBe(WHERE);
        expect(issue.where).toBe(WHERE);
        expect(issue.severity).toBe('error');
        // The named subject: the function the author typed, as the build names it.
        expect(issue.message).toContain('`sqrt` is not a callable name here');
        // And nothing landed — a gate that refuses after persisting is a log line.
        expect(fxRows(rows)).toEqual([]);
    });

    it("(a) REFUSES the same body on a draft's PROMOTION — the draft door is not a bypass", async () => {
        const { protocol } = makeProtocol();
        // A draft save is never gated (#4463 D1): the author may keep a half-finished object.
        await expect(
            protocol.saveMetaItem({ type: 'object', name: 'fx_sqrt', item: fxSqrt(UNREGISTERED), mode: 'draft' }),
        ).resolves.toMatchObject({ success: true });

        const err = await protocol.publishMetaItem({ type: 'object', name: 'fx_sqrt' }).catch((e: any) => e);

        expect(err?.status).toBe(422);
        expect(err.code).toBe('INVALID_METADATA');
        const issue = err.issues.find((i: any) => i.rule === EXPRESSION_INVALID);
        expect(issue, `issues: ${JSON.stringify(err.issues)}`).toBeDefined();
        expect(issue.path).toBe(WHERE);
    });

    it('(b) a registered call — `floor(record.amount)` — still saves, and the row lands', async () => {
        const { protocol, rows } = makeProtocol();

        const result = await protocol.saveMetaItem({ type: 'object', name: 'fx_sqrt', item: fxSqrt(REGISTERED) });

        expect(result.success).toBe(true);
        expect(fxRows(rows).map((r) => r.state)).toEqual(['active']);
    });

    it('(d) the door and `os build` give the SAME finding for the same expression', async () => {
        const { protocol } = makeProtocol();
        const err = await protocol
            .saveMetaItem({ type: 'object', name: 'fx_sqrt', item: fxSqrt(UNREGISTERED) })
            .catch((e: any) => e);
        const atDoor = (err.issues ?? []).filter((i: any) => i.rule === EXPRESSION_INVALID);

        const atBuild = buildFindings(fxSqrt(UNREGISTERED));

        // Non-vacuous on both sides: one finding each, and an error at the build.
        expect(atBuild).toHaveLength(1);
        expect(atBuild[0]!.severity).toBe('error');
        expect(atDoor).toHaveLength(1);
        // Compared key by key — the door reuses the build's call, so a reworded
        // or relocated door verdict is a second dialect, and red.
        for (const key of ['rule', 'where', 'path', 'message', 'hint'] as const) {
            expect(atDoor[0][key], `door and build disagree on '${key}'`).toBe(atBuild[0]![key]);
        }
        // And the registered call is clean at the build too, not just at the door.
        expect(buildFindings(fxSqrt(REGISTERED))).toEqual([]);
    });
});

/**
 * [#22032, pass 1] The object save door gives the build's verdict on a
 * validation rule's predicates.
 *
 * The same `formulas.mdx` sentence covers a validation rule's `condition`:
 * the shared validator backs `os build` and metadata registration. #22019's
 * crossing put the build's expression rule on this door for formula fields
 * alone, so a rule whose `condition` called an unregistered function
 * (`sqrt(record.amount) > 1`) or read a bare field (`amount > 1`) still saved
 * with a 200, while `os build` refused both at `error`.
 *
 * The lift is in `@objectstack/lint` (the rule's object-write fence admits its
 * validation-rule pass); no code here moves. Pinned through the REAL
 * `saveMetaItem` / `publishMetaItem`:
 *
 *  (a) the door refuses both card bodies — a 422 `INVALID_METADATA` carrying
 *      the build's located finding — on an active save AND on a draft's
 *      promotion, and nothing lands;
 *  (b) a valid, guarded `condition` still saves;
 *  (d) for each refused body the door's issues and the build's findings are
 *      the same findings: rule, location, message and hint.
 *
 * The `when` / nested `then` / `otherwise` reach and the pin over every
 * object-borne pass (the others joined in passes 2–4, the blocks below) are
 * pinned in `@objectstack/lint`'s
 * `runtime-gate.object-validation-writes.test.ts` and
 * `runtime-gate.object-formula-writes.test.ts`.
 *
 * ⚠️ As in the #22019 block above: this package reaches `@objectstack/lint`
 * through its built `dist/`, so an edit to the rule is invisible here until
 * `pnpm --filter @objectstack/lint build` has run.
 */
describe('runtime authoring gate on OBJECT writes — the validation-rule verdict (#22032)', () => {
    /** `sharingModel` is authored so `security-owd-unset` stays quiet and the refusal is the rule's. */
    const fxRule = (condition: string) => ({
        name: 'fx_rule',
        label: 'Rule Probe',
        sharingModel: 'private',
        fields: {
            name: { type: 'text', label: 'Name' },
            amount: { type: 'number', label: 'Amount' },
        },
        validations: [{ name: 'amount_rule', type: 'script', condition, message: 'Amount rule' }],
    });
    /** The card's two bodies, each refused by `os build` at `error`. */
    const REFUSED = [
        { condition: 'sqrt(record.amount) > 1', subject: '`sqrt` is not a callable name here' },
        { condition: 'amount > 1', subject: 'bare reference `amount`' },
    ] as const;
    const VALID = 'record.amount != null && record.amount > 100';
    /** Where the build locates a validation-rule finding — the rule the author edits. */
    const WHERE = "object 'fx_rule' · validation 'amount_rule'";

    const ruleRows = (rows: Map<string, Row>) =>
        Array.from(rows.values()).filter((r) => r.type === 'object' && r.name === 'fx_rule');

    /** The build's findings for one object, through the build's own entry. */
    const buildFindings = (obj: unknown) => {
        const stack = { objects: [obj] };
        return runAuthoringRules('build', { normalized: stack, parsed: stack })
            .filter((f) => f.rule === EXPRESSION_INVALID);
    };

    for (const { condition, subject } of REFUSED) {
        it(`(a) REFUSES an active save of \`${condition}\` with a 422 carrying the build's located finding`, async () => {
            const { protocol, rows } = makeProtocol();

            const err = await protocol
                .saveMetaItem({ type: 'object', name: 'fx_rule', item: fxRule(condition) })
                .catch((e: any) => e);

            expect(err, 'the save resolved — the door still accepts the rule').toBeInstanceOf(Error);
            expect(err.status).toBe(422);
            expect(err.code).toBe('INVALID_METADATA');
            expect(err.rulesRun).toContain('validateStackExpressions');
            const issue = err.issues.find((i: any) => i.rule === EXPRESSION_INVALID);
            expect(issue, `issues: ${JSON.stringify(err.issues)}`).toBeDefined();
            expect(issue.path).toBe(WHERE);
            expect(issue.where).toBe(WHERE);
            expect(issue.severity).toBe('error');
            // The named subject: what the author typed, as the build names it.
            expect(issue.message).toContain(subject);
            // And nothing landed — a gate that refuses after persisting is a log line.
            expect(ruleRows(rows)).toEqual([]);
        });
    }

    it("(a) REFUSES the same body on a draft's PROMOTION — the draft door is not a bypass", async () => {
        const { protocol } = makeProtocol();
        // A draft save is never gated (#4463 D1): the author may keep a half-finished object.
        await expect(
            protocol.saveMetaItem({ type: 'object', name: 'fx_rule', item: fxRule(REFUSED[0].condition), mode: 'draft' }),
        ).resolves.toMatchObject({ success: true });

        const err = await protocol.publishMetaItem({ type: 'object', name: 'fx_rule' }).catch((e: any) => e);

        expect(err?.status).toBe(422);
        expect(err.code).toBe('INVALID_METADATA');
        const issue = err.issues.find((i: any) => i.rule === EXPRESSION_INVALID);
        expect(issue, `issues: ${JSON.stringify(err.issues)}`).toBeDefined();
        expect(issue.path).toBe(WHERE);
    });

    it('(b) a valid, guarded `condition` still saves, and the row lands', async () => {
        const { protocol, rows } = makeProtocol();

        const result = await protocol.saveMetaItem({ type: 'object', name: 'fx_rule', item: fxRule(VALID) });

        expect(result.success).toBe(true);
        expect(ruleRows(rows).map((r) => r.state)).toEqual(['active']);
    });

    it('(d) the door and `os build` give the SAME findings for each refused body', async () => {
        for (const { condition } of REFUSED) {
            const { protocol } = makeProtocol();
            const err = await protocol
                .saveMetaItem({ type: 'object', name: 'fx_rule', item: fxRule(condition) })
                .catch((e: any) => e);
            const atDoor = (err.issues ?? []).filter((i: any) => i.rule === EXPRESSION_INVALID);

            const atBuild = buildFindings(fxRule(condition));

            // Non-vacuous on both sides: one finding each, and an error at the build.
            expect(atBuild, condition).toHaveLength(1);
            expect(atBuild[0]!.severity).toBe('error');
            expect(atDoor, condition).toHaveLength(1);
            // Compared key by key — the door reuses the build's call, so a reworded
            // or relocated door verdict is a second dialect, and red.
            for (const key of ['rule', 'where', 'path', 'message', 'hint'] as const) {
                expect(atDoor[0][key], `door and build disagree on '${key}' for ${condition}`).toBe(atBuild[0]![key]);
            }
        }
        // And the valid rule is clean at the build too, not just at the door.
        expect(buildFindings(fxRule(VALID))).toEqual([]);
    });
});

/**
 * [#22032, pass 2] The object save door gives the build's verdict on a
 * field's rule slots.
 *
 * The same `formulas.mdx` sentence covers a field's `requiredWhen`,
 * `readonlyWhen` and `visibleWhen`: the shared validator backs `os build` and
 * metadata registration. After pass 1 the build's expression rule judged
 * formula fields and validation-rule predicates on this door and fenced the
 * field-rule slots off, so a bare `requiredWhen: 'amount > 1'` — the card's
 * measured body — still saved with a 200, while `os build` refused it at
 * `error`.
 *
 * The lift is in `@objectstack/lint` (the rule's object-write fence admits its
 * field-rule-slot pass); no code here moves. Pinned through the REAL
 * `saveMetaItem` / `publishMetaItem` / `publishPackageDrafts`:
 *
 *  (a) the door refuses a bare reference in `requiredWhen`, an unregistered
 *      function in `visibleWhen` and a `parent` read on an object with no
 *      master in `readonlyWhen` — a 422 `INVALID_METADATA` carrying the
 *      build's located finding — on an active save, on a draft's promotion and
 *      on a package's draft publish, and nothing lands;
 *  (b) valid predicates on the three slots still save;
 *  (d) for each refused body the door's issues and the build's findings are
 *      the same findings: rule, location, message and hint.
 *
 * Every gate of the pass (the root verdict, the null guard, the traversal
 * refusal, the retired `conditionalRequired`) and the pin over every
 * object-borne pass are pinned in `@objectstack/lint`'s
 * `runtime-gate.object-field-rule-writes.test.ts` and
 * `runtime-gate.object-formula-writes.test.ts`; option `visibleWhen` and the
 * object's own action predicates joined the door in passes 3 and 4 (the
 * blocks below).
 *
 * ⚠️ As in the #22019 block above: this package reaches `@objectstack/lint`
 * through its built `dist/`, so an edit to the rule is invisible here until
 * `pnpm --filter @objectstack/lint build` has run.
 */
describe('runtime authoring gate on OBJECT writes — the field-rule-slot verdict (#22032 pass 2)', () => {
    /** `sharingModel` is authored so `security-owd-unset` stays quiet and the refusal is the slot's. */
    const fxField = (slots: Record<string, unknown>) => ({
        name: 'fx_field',
        label: 'Field Rule Probe',
        sharingModel: 'private',
        fields: {
            name: { type: 'text', label: 'Name', ...slots },
            amount: { type: 'number', label: 'Amount' },
            status: {
                type: 'select',
                label: 'Status',
                options: [{ label: 'Open', value: 'open' }, { label: 'Closed', value: 'closed' }],
            },
        },
    });
    /** One refused body per slot, each refused by `os build` at `error`; the first is the card's. */
    const REFUSED = [
        { slot: 'requiredWhen', slots: { requiredWhen: 'amount > 1' }, subject: 'bare reference `amount`' },
        { slot: 'visibleWhen', slots: { visibleWhen: 'sqrt(record.amount) > 1' }, subject: '`sqrt`' },
        { slot: 'readonlyWhen', slots: { readonlyWhen: "parent.status == 'paid'" }, subject: 'reads `parent`' },
    ] as const;
    const VALID = {
        requiredWhen: 'record.amount != null && record.amount > 100',
        readonlyWhen: "record.status == 'closed'",
        visibleWhen: "record.status == 'open'",
    };
    /** Where the build locates a field-rule finding — the slot the author edits. */
    const whereOf = (slot: string) => `object 'fx_field' · field 'name' ${slot}`;

    const fieldRows = (rows: Map<string, Row>) =>
        Array.from(rows.values()).filter((r) => r.type === 'object' && r.name === 'fx_field');

    /** The build's findings for one object, through the build's own entry. */
    const buildFindings = (obj: unknown) => {
        const stack = { objects: [obj] };
        return runAuthoringRules('build', { normalized: stack, parsed: stack })
            .filter((f) => f.rule === EXPRESSION_INVALID);
    };

    for (const { slot, slots, subject } of REFUSED) {
        it(`(a) REFUSES an active save of \`${slot}: ${Object.values(slots)[0]}\` with a 422 carrying the build's located finding`, async () => {
            const { protocol, rows } = makeProtocol();

            const err = await protocol
                .saveMetaItem({ type: 'object', name: 'fx_field', item: fxField(slots) })
                .catch((e: any) => e);

            expect(err, 'the save resolved — the door still accepts the slot').toBeInstanceOf(Error);
            expect(err.status).toBe(422);
            expect(err.code).toBe('INVALID_METADATA');
            expect(err.rulesRun).toContain('validateStackExpressions');
            const issue = err.issues.find((i: any) => i.rule === EXPRESSION_INVALID);
            expect(issue, `issues: ${JSON.stringify(err.issues)}`).toBeDefined();
            expect(issue.path).toBe(whereOf(slot));
            expect(issue.where).toBe(whereOf(slot));
            expect(issue.severity).toBe('error');
            // The named subject: what the author typed, as the build names it.
            expect(issue.message).toContain(subject);
            // And nothing landed — a gate that refuses after persisting is a log line.
            expect(fieldRows(rows)).toEqual([]);
        });
    }

    it("(a) REFUSES the card's body on a draft's PROMOTION — the draft door is not a bypass", async () => {
        const { protocol } = makeProtocol();
        // A draft save is never gated (#4463 D1): the author may keep a half-finished object.
        await expect(
            protocol.saveMetaItem({ type: 'object', name: 'fx_field', item: fxField(REFUSED[0].slots), mode: 'draft' }),
        ).resolves.toMatchObject({ success: true });

        const err = await protocol.publishMetaItem({ type: 'object', name: 'fx_field' }).catch((e: any) => e);

        expect(err?.status).toBe(422);
        expect(err.code).toBe('INVALID_METADATA');
        const issue = err.issues.find((i: any) => i.rule === EXPRESSION_INVALID);
        expect(issue, `issues: ${JSON.stringify(err.issues)}`).toBeDefined();
        expect(issue.path).toBe(whereOf('requiredWhen'));
    });

    it("(a) REFUSES the card's body on a PACKAGE's draft publish — nothing goes live", async () => {
        const { protocol, rows } = makeProtocol();
        await expect(
            protocol.saveMetaItem({
                type: 'object', name: 'fx_field', item: fxField(REFUSED[0].slots), mode: 'draft', packageId: 'app.fx',
            }),
        ).resolves.toMatchObject({ success: true });

        const res = await protocol.publishPackageDrafts({ packageId: 'app.fx' });

        expect(res.outcome, JSON.stringify(res)).toBe('refused');
        expect(res.publishedCount).toBe(0);
        expect(res.failed).toEqual([expect.objectContaining({ type: 'object', name: 'fx_field', code: 'INVALID_METADATA' })]);
        expect(fieldRows(rows).map((r) => r.state)).toEqual(['draft']);
    });

    it('(b) valid predicates on the three slots still save, and the row lands', async () => {
        const { protocol, rows } = makeProtocol();

        const result = await protocol.saveMetaItem({ type: 'object', name: 'fx_field', item: fxField(VALID) });

        expect(result.success).toBe(true);
        expect(fieldRows(rows).map((r) => r.state)).toEqual(['active']);
    });

    it('(d) the door and `os build` give the SAME findings for each refused body', async () => {
        for (const { slots } of REFUSED) {
            const { protocol } = makeProtocol();
            const err = await protocol
                .saveMetaItem({ type: 'object', name: 'fx_field', item: fxField(slots) })
                .catch((e: any) => e);
            const atDoor = (err.issues ?? []).filter((i: any) => i.rule === EXPRESSION_INVALID);

            const atBuild = buildFindings(fxField(slots));

            const label = JSON.stringify(slots);
            // Non-vacuous on both sides: one finding each, and an error at the build.
            expect(atBuild, label).toHaveLength(1);
            expect(atBuild[0]!.severity).toBe('error');
            expect(atDoor, label).toHaveLength(1);
            // Compared key by key — the door reuses the build's call, so a reworded
            // or relocated door verdict is a second dialect, and red.
            for (const key of ['rule', 'where', 'path', 'message', 'hint'] as const) {
                expect(atDoor[0][key], `door and build disagree on '${key}' for ${label}`).toBe(atBuild[0]![key]);
            }
        }
        // And the valid slots are clean at the build too, not just at the door.
        expect(buildFindings(fxField(VALID))).toEqual([]);
    });
});

/**
 * [#22032, pass 3] The object save door gives the build's verdict on a
 * field option's `visibleWhen`.
 *
 * The same `formulas.mdx` sentence covers an option's `visibleWhen`: the
 * shared validator backs `os build` and metadata registration. After pass 2
 * the build's expression rule ran the whole field walk on this door except the
 * per-option loop, which kept its own fence, so an option whose `visibleWhen`
 * read a bare field (`amount > 1`) still saved with a 200, while `os build`
 * refused it at `error`.
 *
 * The lift is in `@objectstack/lint` (the option loop's object-write guard is
 * gone); no code here moves. Pinned through the REAL `saveMetaItem` /
 * `publishMetaItem` / `publishPackageDrafts`:
 *
 *  (a) the door refuses a bare reference, an unregistered function and a read
 *      through a reference field — a 422 `INVALID_METADATA` carrying the
 *      build's located finding — on an active save, on a draft's promotion and
 *      on a package's draft publish, and nothing lands;
 *  (b) the showcase's two option shapes still save: a `record.country`
 *      cascade and the `'org_admin' in current_user.positions` role gate — the
 *      option evaluator binds `current_user` (ADR-0068 D1), so the build
 *      accepts it there, and so does this door;
 *  (d) for each refused body the door's issues and the build's findings are
 *      the same findings: rule, location, message and hint.
 *
 * The rest of the pass's findings, the `current_user` contrast with the
 * field's own slot, and the pin over every object-borne pass are pinned in
 * `@objectstack/lint`'s `runtime-gate.object-option-visibility-writes.test.ts`
 * and `runtime-gate.object-formula-writes.test.ts`; the object's own action
 * predicates joined the door in pass 4 (the last block of this file).
 *
 * ⚠️ As in the #22019 block above: this package reaches `@objectstack/lint`
 * through its built `dist/`, so an edit to the rule is invisible here until
 * `pnpm --filter @objectstack/lint build` has run.
 */
describe('runtime authoring gate on OBJECT writes — the option visibleWhen verdict (#22032 pass 3)', () => {
    /** `sharingModel` is authored so `security-owd-unset` stays quiet and the refusal is the option's. */
    const fxOption = (provinceZj: unknown, restricted: unknown = "'org_admin' in current_user.positions") => ({
        name: 'fx_option',
        label: 'Option Probe',
        sharingModel: 'private',
        fields: {
            name: { type: 'text', label: 'Name' },
            amount: { type: 'number', label: 'Amount' },
            // A self-reference, so the reference resolves in the write's own snapshot.
            account: { type: 'lookup', label: 'Account', reference: 'fx_option' },
            country: {
                type: 'select',
                label: 'Country',
                options: [{ label: 'China', value: 'cn' }, { label: 'United States', value: 'us' }],
            },
            province: {
                type: 'select',
                label: 'Province',
                options: [
                    { label: 'Zhejiang', value: 'zj', visibleWhen: provinceZj },
                    { label: 'California', value: 'ca', visibleWhen: "record.country == 'us'" },
                ],
            },
            tier: {
                type: 'select',
                label: 'Tier',
                options: [
                    { label: 'Standard', value: 'standard' },
                    { label: 'Restricted', value: 'restricted', visibleWhen: restricted },
                ],
            },
        },
    });
    /** One refused body per finding kind, each refused by `os build` at `error`; the first is the card's shape. */
    const REFUSED = [
        { body: 'amount > 1', subject: 'bare reference `amount`' },
        { body: 'sqrt(record.amount) > 1', subject: '`sqrt`' },
        { body: "record.account.name == 'x'", subject: 'reads `name` through `record.account`' },
    ] as const;
    /** The showcase's cascade; the role gate rides every body as `tier`'s `restricted` option. */
    const CASCADE = "record.country == 'cn'";
    /** Where the build locates the refused option's finding — the option the author edits. */
    const WHERE = "object 'fx_option' · field 'province' option 'zj' visibleWhen";

    const optionRows = (rows: Map<string, Row>) =>
        Array.from(rows.values()).filter((r) => r.type === 'object' && r.name === 'fx_option');

    /** The build's findings for one object, through the build's own entry. */
    const buildFindings = (obj: unknown) => {
        const stack = { objects: [obj] };
        return runAuthoringRules('build', { normalized: stack, parsed: stack })
            .filter((f) => f.rule === EXPRESSION_INVALID);
    };

    for (const { body, subject } of REFUSED) {
        it(`(a) REFUSES an active save of an option's \`visibleWhen: ${body}\` with a 422 carrying the build's located finding`, async () => {
            const { protocol, rows } = makeProtocol();

            const err = await protocol
                .saveMetaItem({ type: 'object', name: 'fx_option', item: fxOption(body) })
                .catch((e: any) => e);

            expect(err, 'the save resolved — the door still accepts the option predicate').toBeInstanceOf(Error);
            expect(err.status).toBe(422);
            expect(err.code).toBe('INVALID_METADATA');
            expect(err.rulesRun).toContain('validateStackExpressions');
            const issues = err.issues.filter((i: any) => i.rule === EXPRESSION_INVALID);
            expect(issues, `issues: ${JSON.stringify(err.issues)}`).toHaveLength(1);
            expect(issues[0].path).toBe(WHERE);
            expect(issues[0].where).toBe(WHERE);
            expect(issues[0].severity).toBe('error');
            // The named subject: what the author typed, as the build names it.
            expect(issues[0].message).toContain(subject);
            // And nothing landed — a gate that refuses after persisting is a log line.
            expect(optionRows(rows)).toEqual([]);
        });
    }

    it("(a) REFUSES the card-shaped body on a draft's PROMOTION — the draft door is not a bypass", async () => {
        const { protocol } = makeProtocol();
        // A draft save is never gated (#4463 D1): the author may keep a half-finished object.
        await expect(
            protocol.saveMetaItem({ type: 'object', name: 'fx_option', item: fxOption(REFUSED[0].body), mode: 'draft' }),
        ).resolves.toMatchObject({ success: true });

        const err = await protocol.publishMetaItem({ type: 'object', name: 'fx_option' }).catch((e: any) => e);

        expect(err?.status).toBe(422);
        expect(err.code).toBe('INVALID_METADATA');
        const issue = err.issues.find((i: any) => i.rule === EXPRESSION_INVALID);
        expect(issue, `issues: ${JSON.stringify(err.issues)}`).toBeDefined();
        expect(issue.path).toBe(WHERE);
    });

    it("(a) REFUSES the card-shaped body on a PACKAGE's draft publish — nothing goes live", async () => {
        const { protocol, rows } = makeProtocol();
        await expect(
            protocol.saveMetaItem({
                type: 'object', name: 'fx_option', item: fxOption(REFUSED[0].body), mode: 'draft', packageId: 'app.fx',
            }),
        ).resolves.toMatchObject({ success: true });

        const res = await protocol.publishPackageDrafts({ packageId: 'app.fx' });

        expect(res.outcome, JSON.stringify(res)).toBe('refused');
        expect(res.publishedCount).toBe(0);
        expect(res.failed).toEqual([expect.objectContaining({ type: 'object', name: 'fx_option', code: 'INVALID_METADATA' })]);
        expect(optionRows(rows).map((r) => r.state)).toEqual(['draft']);
    });

    it("(b) the showcase's cascade and its `current_user` role gate still save, and the row lands", async () => {
        const { protocol, rows } = makeProtocol();

        const result = await protocol.saveMetaItem({ type: 'object', name: 'fx_option', item: fxOption(CASCADE) });

        expect(result.success).toBe(true);
        expect(optionRows(rows).map((r) => r.state)).toEqual(['active']);
    });

    it('(d) the door and `os build` give the SAME findings for each refused body', async () => {
        for (const { body } of REFUSED) {
            const { protocol } = makeProtocol();
            const err = await protocol
                .saveMetaItem({ type: 'object', name: 'fx_option', item: fxOption(body) })
                .catch((e: any) => e);
            const atDoor = (err.issues ?? []).filter((i: any) => i.rule === EXPRESSION_INVALID);

            const atBuild = buildFindings(fxOption(body));

            // Non-vacuous on both sides: one finding each, and an error at the build.
            expect(atBuild, body).toHaveLength(1);
            expect(atBuild[0]!.severity).toBe('error');
            expect(atDoor, body).toHaveLength(1);
            // Compared key by key — the door reuses the build's call, so a reworded
            // or relocated door verdict is a second dialect, and red.
            for (const key of ['rule', 'where', 'path', 'message', 'hint'] as const) {
                expect(atDoor[0][key], `door and build disagree on '${key}' for ${body}`).toBe(atBuild[0]![key]);
            }
        }
        // And the still-accepted options are clean at the build too, not just at the door.
        expect(buildFindings(fxOption(CASCADE))).toEqual([]);
    });
});

/**
 * [#22157] The object save door refuses a field option's `visibleWhen` that
 * reads `parent`, as `os build` does.
 *
 * The server's option check (`evaluateOptionVisibility` in ObjectQL) binds
 * `record`, `previous` and the acting user, never `parent`. Measured before
 * this change: on a detail with exactly one `master_detail` (where the
 * field-rule slots DO bind `parent`), an option whose `visibleWhen` read
 * `parent.status` saved through this door with a 200 and landed `active`, and
 * every write that then picked the option faulted and was admitted unchecked.
 *
 * The refusal is in `@objectstack/lint` (the option pass's root verdict); no
 * code here moves. Pinned through the REAL `saveMetaItem`, the header stored
 * in the registry so the write is judged against the universe it lands in:
 *
 *  (a) the measured body is refused on an active save — a 422
 *      `INVALID_METADATA` carrying the build's located finding — and nothing
 *      lands;
 *  (b) the same body still saves as a DRAFT (drafts are never gated), and the
 *      draft's promotion and a package's draft publish are refused;
 *  (c) control: an option reading `record` saves, and the row lands;
 *  (d) the door's issue and the build's finding are the same finding.
 *
 * ⚠️ As in the blocks above: this package reaches `@objectstack/lint` through
 * its built `dist/`, so an edit to the rule is invisible here until
 * `pnpm --filter @objectstack/lint build` has run.
 */
describe('runtime authoring gate on OBJECT writes — an option visibleWhen reading parent (#22157)', () => {
    const header = {
        name: 'fx_header',
        label: 'Header',
        sharingModel: 'private',
        fields: { name: { type: 'text', label: 'Name' }, status: { type: 'text', label: 'Status' } },
    };
    const line = (visibleWhen: unknown) => ({
        name: 'fx_line',
        label: 'Line',
        sharingModel: 'private',
        fields: {
            hdr: { type: 'master_detail', label: 'Header', reference: 'fx_header' },
            x: { type: 'text', label: 'X' },
            tier: {
                type: 'select',
                label: 'Tier',
                options: [{ label: 'Standard', value: 'standard' }, { label: 'Gold', value: 'gold', visibleWhen }],
            },
        },
    });
    /** The card's measured body. */
    const PARENT = "parent.status == 'closed'";
    /** Where the build locates it — the option the author edits. */
    const WHERE = "object 'fx_line' · field 'tier' option 'gold' visibleWhen";

    /** A protocol whose live registry holds the header — the stored universe. */
    const hostWithHeader = () => {
        const { engine, rows } = makeStubEngine();
        engine.registry.listItems = (type: string) => (type === 'object' ? [header] : []);
        const protocol = new ObjectStackProtocolImplementation(engine, () => new Map(), 'env_test') as any;
        return { protocol, rows };
    };
    const lineRows = (rows: Map<string, Row>) =>
        Array.from(rows.values()).filter((r) => r.type === 'object' && r.name === 'fx_line');
    const saveLine = (protocol: any, item: unknown, extra: Record<string, unknown> = {}) =>
        protocol.saveMetaItem({ type: 'object', name: 'fx_line', item, ...extra });
    const buildFindings = (obj: unknown) => {
        const stack = { objects: [header, obj] };
        return runAuthoringRules('build', { normalized: stack, parsed: stack })
            .filter((f) => f.rule === EXPRESSION_INVALID);
    };

    it('(a) REFUSES an active save with a 422 carrying the build\'s located finding, and nothing lands', async () => {
        const { protocol, rows } = hostWithHeader();

        const err = await saveLine(protocol, line(PARENT)).catch((e: any) => e);

        expect(err, 'the save resolved — the door still accepts the option predicate').toBeInstanceOf(Error);
        expect({ code: err.code, status: err.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
        expect(err.rulesRun).toContain('validateStackExpressions');
        const issues = err.issues.filter((i: any) => i.rule === EXPRESSION_INVALID);
        expect(issues, `issues: ${JSON.stringify(err.issues)}`).toHaveLength(1);
        expect(issues[0].path).toBe(WHERE);
        expect(issues[0].severity).toBe('error');
        // The named subject: the option, the field and the root.
        expect(issues[0].message).toContain("option 'gold' on field 'tier' reads `parent`");
        expect(lineRows(rows)).toEqual([]);
    });

    it('(b) the same body still saves as a DRAFT — drafts are never gated — and its PROMOTION is refused', async () => {
        const { protocol, rows } = hostWithHeader();

        await expect(saveLine(protocol, line(PARENT), { mode: 'draft' })).resolves.toMatchObject({ success: true });
        expect(lineRows(rows).map((r) => r.state)).toEqual(['draft']);

        const err = await protocol.publishMetaItem({ type: 'object', name: 'fx_line' }).catch((e: any) => e);

        expect({ code: err?.code, status: err?.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
        const issue = err.issues.find((i: any) => i.rule === EXPRESSION_INVALID);
        expect(issue, `issues: ${JSON.stringify(err.issues)}`).toBeDefined();
        expect(issue.path).toBe(WHERE);
        expect(lineRows(rows).map((r) => r.state)).toEqual(['draft']);
    });

    it("(b) a PACKAGE's draft publish of the same body is refused — nothing goes live", async () => {
        const { protocol, rows } = hostWithHeader();
        await expect(
            saveLine(protocol, line(PARENT), { mode: 'draft', packageId: 'app.fx' }),
        ).resolves.toMatchObject({ success: true });

        const res = await protocol.publishPackageDrafts({ packageId: 'app.fx' });

        expect(res.outcome, JSON.stringify(res)).toBe('refused');
        expect(res.publishedCount).toBe(0);
        expect(res.failed).toEqual([expect.objectContaining({ type: 'object', name: 'fx_line', code: 'INVALID_METADATA' })]);
        expect(lineRows(rows).map((r) => r.state)).toEqual(['draft']);
    });

    it('(c) control: an option reading `record` saves, and the row lands', async () => {
        const { protocol, rows } = hostWithHeader();

        const result = await saveLine(protocol, line("record.x == 'a'"));

        expect(result.success).toBe(true);
        expect(lineRows(rows).map((r) => r.state)).toEqual(['active']);
    });

    it('(d) the door and `os build` give the SAME finding', async () => {
        const { protocol } = hostWithHeader();
        const err = await saveLine(protocol, line(PARENT)).catch((e: any) => e);
        const atDoor = (err.issues ?? []).filter((i: any) => i.rule === EXPRESSION_INVALID);

        const atBuild = buildFindings(line(PARENT));

        // Non-vacuous on both sides.
        expect(atBuild).toHaveLength(1);
        expect(atBuild[0]!.severity).toBe('error');
        expect(atDoor).toHaveLength(1);
        for (const key of ['rule', 'where', 'path', 'message', 'hint'] as const) {
            expect(atDoor[0][key], `door and build disagree on '${key}'`).toBe(atBuild[0]![key]);
        }
        // And the control is clean at the build too, not just at the door.
        expect(buildFindings(line("record.x == 'a'"))).toEqual([]);
    });
});

/**
 * [#22274] The object save door refuses a field option's `visibleWhen` that
 * reads a member of `ctx` or `os` the server's option check never binds, as
 * `os build` does.
 *
 * The option check (`evaluateOptionVisibility` in ObjectQL) fills `ctx` and
 * `os` with their `user` member only. Measured before this change: an option
 * whose `visibleWhen` read `os.org.id`, `os.env` or `ctx.locale` saved through
 * this door, and every write that picked the option faulted (`No such key`)
 * and was admitted unchecked.
 *
 * The refusal is in `@objectstack/lint` (the option pass's member verdict); no
 * code here moves. Pinned through the REAL `saveMetaItem`:
 *
 *  (a) each measured body is refused on an active save, a 422
 *      `INVALID_METADATA` carrying the build's located finding, and nothing
 *      lands;
 *  (b) control: the acting user under every ADR-0068 spelling, `record`,
 *      `previous` and `current_user.can(…)` save, and the row lands;
 *  (c) the door's issue and the build's finding are the same finding.
 *
 * ⚠️ As in the blocks above: this package reaches `@objectstack/lint` through
 * its built `dist/`, so an edit to the rule is invisible here until
 * `pnpm --filter @objectstack/lint build` has run.
 */
describe('runtime authoring gate on OBJECT writes — an option visibleWhen reading an unbound ctx/os member (#22274)', () => {
    const item = (visibleWhen: unknown) => ({
        name: 'fx_item',
        label: 'Item',
        sharingModel: 'private',
        fields: {
            x: { type: 'text', label: 'X' },
            tier: {
                type: 'select',
                label: 'Tier',
                options: [{ label: 'Standard', value: 'standard' }, { label: 'Gold', value: 'gold', visibleWhen }],
            },
        },
    });
    /** The card's measured bodies, each with the member path the finding names. */
    const REFUSED: Array<[string, string]> = [
        ["os.org.id != ''", '`os.org`'],
        ["os.env == 'prod'", '`os.env`'],
        ["ctx.locale == 'en'", '`ctx.locale`'],
    ];
    /** Where the build locates it — the option the author edits. */
    const WHERE = "object 'fx_item' · field 'tier' option 'gold' visibleWhen";

    const host = () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine, () => new Map(), 'env_test') as any;
        return { protocol, rows };
    };
    const itemRows = (rows: Map<string, Row>) =>
        Array.from(rows.values()).filter((r) => r.type === 'object' && r.name === 'fx_item');
    const save = (protocol: any, visibleWhen: unknown) =>
        protocol.saveMetaItem({ type: 'object', name: 'fx_item', item: item(visibleWhen) });
    const buildFindings = (visibleWhen: unknown) => {
        const stack = { objects: [item(visibleWhen)] };
        return runAuthoringRules('build', { normalized: stack, parsed: stack })
            .filter((f) => f.rule === EXPRESSION_INVALID);
    };

    it.each(REFUSED)('(a) REFUSES %s on an active save with a 422 carrying the located finding, and nothing lands', async (body, path) => {
        const { protocol, rows } = host();

        const err = await save(protocol, body).catch((e: any) => e);

        expect(err, 'the save resolved — the door still accepts the option predicate').toBeInstanceOf(Error);
        expect({ code: err.code, status: err.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
        const issues = err.issues.filter((i: any) => i.rule === EXPRESSION_INVALID);
        expect(issues, `issues: ${JSON.stringify(err.issues)}`).toHaveLength(1);
        expect(issues[0].path).toBe(WHERE);
        expect(issues[0].severity).toBe('error');
        // The named subject: the option, the field, the member, and what IS bound under its root.
        expect(issues[0].message).toContain(`option 'gold' on field 'tier' reads ${path}`);
        expect(issues[0].message).toContain('the `user` member and nothing else');
        expect(itemRows(rows)).toEqual([]);
    });

    it('(b) control: the acting user under every ADR-0068 spelling, `record`, `previous` and `can` save, and the row lands', async () => {
        for (const body of [
            "current_user.id != ''",
            "os.user.id != ''",
            "'org_admin' in ctx.user.positions",
            "user.id != ''",
            "record.x == 'a'",
            "previous.x == 'a'",
            "current_user.can('fx_item', 'edit')",
            "current_user.organizationId != ''",
        ]) {
            const { protocol, rows } = host();
            const result = await save(protocol, body);
            expect(result.success, body).toBe(true);
            expect(itemRows(rows).map((r) => r.state), body).toEqual(['active']);
        }
    });

    it.each(REFUSED)('(c) the door and `os build` give the SAME finding for %s', async (body) => {
        const { protocol } = host();
        const err = await save(protocol, body).catch((e: any) => e);
        const atDoor = (err.issues ?? []).filter((i: any) => i.rule === EXPRESSION_INVALID);

        const atBuild = buildFindings(body);

        // Non-vacuous on both sides.
        expect(atBuild).toHaveLength(1);
        expect(atBuild[0]!.severity).toBe('error');
        expect(atDoor).toHaveLength(1);
        for (const key of ['rule', 'where', 'path', 'message', 'hint'] as const) {
            expect(atDoor[0][key], `door and build disagree on '${key}'`).toBe(atBuild[0]![key]);
        }
    });
});

/**
 * [#22394] The object save door refuses a field option's `visibleWhen` that
 * reads a member of the acting user the server's option check never binds, as
 * `os build` does — the last card of the #22157 (roots) → #22274 (`ctx` / `os`
 * members) family.
 *
 * The option check binds the acting user under `current_user`, `user`,
 * `ctx.user` and `os.user`, carrying what `EvalUserSchema` declares AND the
 * engine sets: its id, `positions`, `isPlatformAdmin` and `organizationId`.
 * Measured before this change: an option whose `visibleWhen` read
 * `current_user.roles` (renamed `positions` by ADR-0090 D3), `ctx.user.roles`
 * or `current_user.email` (declared, never set there) saved through this door,
 * and every write that picked the option faulted (`No such key`) and was
 * admitted unchecked.
 *
 * The refusal is in `@objectstack/lint` (the option pass's member verdict); no
 * code here moves. Pinned through the REAL `saveMetaItem`:
 *
 *  (a) each measured body is refused on an active save, a 422
 *      `INVALID_METADATA` carrying the build's located finding, and nothing
 *      lands;
 *  (b) control: every member the option check binds, under every ADR-0068
 *      spelling, and `current_user.can(…)` save, and the row lands;
 *  (c) the door's issue and the build's finding are the same finding.
 *
 * ⚠️ As in the blocks above: this package reaches `@objectstack/lint` through
 * its built `dist/`, so an edit to the rule is invisible here until
 * `pnpm --filter @objectstack/lint build` has run.
 */
describe('runtime authoring gate on OBJECT writes — an option visibleWhen reading an unbound member of the acting user (#22394)', () => {
    const item = (visibleWhen: unknown) => ({
        name: 'fx_item',
        label: 'Item',
        sharingModel: 'private',
        fields: {
            x: { type: 'text', label: 'X' },
            tier: {
                type: 'select',
                label: 'Tier',
                options: [{ label: 'Standard', value: 'standard' }, { label: 'Gold', value: 'gold', visibleWhen }],
            },
        },
    });
    /** The card's measured bodies, each with the member path the finding names. */
    const REFUSED: Array<[string, string]> = [
        ["'admin' in current_user.roles", '`current_user.roles`'],
        ["ctx.user.roles == ['a']", '`ctx.user.roles`'],
        ["current_user.email == 'a@b.c'", '`current_user.email`'],
    ];
    /** Where the build locates it — the option the author edits. */
    const WHERE = "object 'fx_item' · field 'tier' option 'gold' visibleWhen";

    const host = () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine, () => new Map(), 'env_test') as any;
        return { protocol, rows };
    };
    const itemRows = (rows: Map<string, Row>) =>
        Array.from(rows.values()).filter((r) => r.type === 'object' && r.name === 'fx_item');
    const save = (protocol: any, visibleWhen: unknown) =>
        protocol.saveMetaItem({ type: 'object', name: 'fx_item', item: item(visibleWhen) });
    const buildFindings = (visibleWhen: unknown) => {
        const stack = { objects: [item(visibleWhen)] };
        return runAuthoringRules('build', { normalized: stack, parsed: stack })
            .filter((f) => f.rule === EXPRESSION_INVALID);
    };

    it.each(REFUSED)('(a) REFUSES %s on an active save with a 422 carrying the located finding, and nothing lands', async (body, path) => {
        const { protocol, rows } = host();

        const err = await save(protocol, body).catch((e: any) => e);

        expect(err, 'the save resolved — the door still accepts the option predicate').toBeInstanceOf(Error);
        expect({ code: err.code, status: err.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
        const issues = err.issues.filter((i: any) => i.rule === EXPRESSION_INVALID);
        expect(issues, `issues: ${JSON.stringify(err.issues)}`).toHaveLength(1);
        expect(issues[0].path).toBe(WHERE);
        expect(issues[0].severity).toBe('error');
        // The named subject: the option, the field, the member, and the members that ARE bound.
        expect(issues[0].message).toContain(`option 'gold' on field 'tier' reads ${path}`);
        for (const m of ['id', 'positions', 'isPlatformAdmin', 'organizationId']) {
            expect(issues[0].message, m).toContain('`' + m + '`');
        }
        expect(itemRows(rows)).toEqual([]);
    });

    it('(b) control: every bound member under every ADR-0068 spelling, and `can`, save, and the row lands', async () => {
        for (const body of [
            "'org_admin' in current_user.positions",
            "'org_admin' in ctx.user.positions",
            "user.isPlatformAdmin == true",
            "os.user.organizationId != ''",
            "current_user.id != ''",
            "current_user.can('fx_item', 'edit')",
        ]) {
            const { protocol, rows } = host();
            const result = await save(protocol, body);
            expect(result.success, body).toBe(true);
            expect(itemRows(rows).map((r) => r.state), body).toEqual(['active']);
        }
    });

    it.each(REFUSED)('(c) the door and `os build` give the SAME finding for %s', async (body) => {
        const { protocol } = host();
        const err = await save(protocol, body).catch((e: any) => e);
        const atDoor = (err.issues ?? []).filter((i: any) => i.rule === EXPRESSION_INVALID);

        const atBuild = buildFindings(body);

        // Non-vacuous on both sides.
        expect(atBuild).toHaveLength(1);
        expect(atBuild[0]!.severity).toBe('error');
        expect(atDoor).toHaveLength(1);
        for (const key of ['rule', 'where', 'path', 'message', 'hint'] as const) {
            expect(atDoor[0][key], `door and build disagree on '${key}'`).toBe(atBuild[0]![key]);
        }
    });
});

/**
 * [#22118] The object save door judges a stored sibling's finding against the
 * STORED universe — the registry's objects WITH the written object's stored
 * self — so a label-only save of a master is not refused for a detail the
 * author never touched.
 *
 * The fix is in `@objectstack/lint` (`buildRuntimeWriteSnapshots` /
 * `runRuntimeAuthoringRules`); no code here moves. Pinned through the REAL
 * `saveMetaItem` with the registry holding the stored universe:
 *
 *  (a) the two measured cases — a detail's unknown `lookupColumns` entry, and
 *      a detail's `readonlyWhen` read through `parent` — save, and the row
 *      lands;
 *  (b) a write that newly breaks a sibling, and a write whose object carries
 *      its own finding (which its stored self carries too), are still refused
 *      with the 422 `INVALID_METADATA` envelope, and nothing lands.
 *
 * Every spelling of a finding's location and the create path are pinned in
 * `@objectstack/lint`'s `runtime-gate.stored-self-baseline.test.ts`.
 *
 * ⚠️ As in the blocks above: this package reaches `@objectstack/lint` through
 * its built `dist/`, so an edit to the gate is invisible here until
 * `pnpm --filter @objectstack/lint build` has run.
 */
describe('runtime authoring gate on OBJECT writes — the stored-self baseline (#22118)', () => {
    const master = (fields: Record<string, unknown> = {}, label = 'Master') => ({
        name: 'fx_master',
        label,
        sharingModel: 'private',
        fields: {
            name: { type: 'text', label: 'Name' },
            code: { type: 'text', label: 'Code' },
            acct: { type: 'lookup', label: 'Account', reference: 'fx_account' },
            ...fields,
        },
    });
    const account = {
        name: 'fx_account',
        label: 'Account',
        sharingModel: 'private',
        fields: { name: { type: 'text', label: 'Name' } },
    };
    const pickerDetail = (columns: string[]) => ({
        name: 'fx_detail2',
        label: 'Picker Detail',
        sharingModel: 'private',
        fields: { m: { type: 'lookup', label: 'Master', reference: 'fx_master', lookupColumns: columns } },
    });
    const parentDetail = {
        name: 'fx_detail',
        label: 'Parent Detail',
        sharingModel: 'private',
        fields: {
            hdr: { type: 'master_detail', label: 'Header', reference: 'fx_master' },
            qty: { type: 'number', label: 'Quantity', readonlyWhen: "parent.acct.name == 'x'" },
        },
    };

    /** A protocol whose live registry holds `objects` — the stored universe. */
    const hostWith = (objects: unknown[]) => {
        const { engine, rows } = makeStubEngine();
        engine.registry.listItems = (type: string) => (type === 'object' ? objects : []);
        const protocol = new ObjectStackProtocolImplementation(engine, () => new Map(), 'env_test') as any;
        return { protocol, rows };
    };
    const masterRows = (rows: Map<string, Row>) =>
        Array.from(rows.values()).filter((r) => r.type === 'object' && r.name === 'fx_master');
    const saveMaster = (protocol: any, item: unknown) =>
        protocol.saveMetaItem({ type: 'object', name: 'fx_master', item });

    for (const [label, detail] of [
        ['an unknown `lookupColumns` entry on a detail', pickerDetail(['nope_col'])],
        ['a `readonlyWhen` read through `parent`', parentDetail],
    ] as const) {
        it(`(a) a label-only master save SAVES beside a stored detail with ${label}`, async () => {
            const { protocol, rows } = hostWith([master(), account, detail]);

            const result = await saveMaster(protocol, master({}, 'Master (renamed)'));

            expect(result.success).toBe(true);
            expect(masterRows(rows).map((r) => r.state)).toEqual(['active']);
        });
    }

    it('(b) a write that newly breaks a sibling is still REFUSED with the 422 envelope', async () => {
        // The stored master has `code`; the write drops it, so the detail's
        // picker column now names nothing.
        const { protocol, rows } = hostWith([master(), account, pickerDetail(['code'])]);
        const dropped = master({}, 'Master (renamed)');
        delete (dropped.fields as Record<string, unknown>).code;

        const err = await saveMaster(protocol, dropped).catch((e: any) => e);

        expect({ code: err?.code, status: err?.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
        const issue = err.issues.find((i: any) => i.rule === 'object-field-ref-unknown');
        expect(issue, `issues: ${JSON.stringify(err.issues)}`).toBeDefined();
        expect(issue.path).toBe('objects.fx_detail2.fields.m.lookupColumns[0]');
        expect(masterRows(rows)).toEqual([]);
    });

    it('(b) a finding on the written object itself is still REFUSED, though its stored self carries it', async () => {
        const broken = master({ acct: { type: 'lookup', label: 'Account', reference: 'fx_account', lookupColumns: ['nope'] } });
        const { protocol, rows } = hostWith([broken, account]);

        const err = await saveMaster(protocol, { ...broken, label: 'Master (renamed)' }).catch((e: any) => e);

        expect({ code: err?.code, status: err?.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
        const issue = err.issues.find((i: any) => i.rule === 'object-field-ref-unknown');
        expect(issue, `issues: ${JSON.stringify(err.issues)}`).toBeDefined();
        expect(issue.path).toBe('objects.fx_master.fields.acct.lookupColumns[0]');
        expect(masterRows(rows)).toEqual([]);
    });
});

/**
 * [#22042] The object save door gives the build's verdict on a `conditional`
 * validation rule's NESTED predicates.
 *
 * After #22032 pass 1 this door ran the build's validation-rule pass, and that
 * pass judged a rule's own `condition` / `when` but reached a `conditional`
 * rule's `then` / `otherwise` with the null-guard gate alone. So a nested
 * `condition` calling an unregistered function (`sqrt(record.amount) > 1`) or
 * reading a bare field (`amont > 1`) saved with a 200 and landed `active`,
 * while the same predicate one level up was refused.
 *
 * The fix is in `@objectstack/lint` (the pass runs `check()` on every nested
 * predicate); no code here moves. Pinned through the REAL `saveMetaItem` /
 * `publishMetaItem`:
 *
 *  (a) the door refuses a nested `then` with an unregistered function, a nested
 *      `otherwise` with a bare field and a predicate two levels down — a 422
 *      `INVALID_METADATA` carrying the build's finding, located at the nested
 *      rule — on an active save AND on a draft's promotion, and nothing lands;
 *  (b) valid nested predicates still save;
 *  (d) for each refused body the door's issues and the build's findings are
 *      the same findings: rule, location, message and hint.
 *
 * The per-slot traversal checks and the no-double-report count are pinned in
 * `@objectstack/lint`'s `runtime-gate.object-validation-writes.test.ts`.
 *
 * ⚠️ As in the #22019 block above: this package reaches `@objectstack/lint`
 * through its built `dist/`, so an edit to the rule is invisible here until
 * `pnpm --filter @objectstack/lint build` has run.
 */
describe('runtime authoring gate on OBJECT writes — a conditional rule\'s nested predicates (#22042)', () => {
    /** `sharingModel` is authored so `security-owd-unset` stays quiet and the refusal is the rule's. */
    const fxNested = (rule: Record<string, unknown>) => ({
        name: 'fx_nested',
        label: 'Nested Rule Probe',
        sharingModel: 'private',
        fields: {
            name: { type: 'text', label: 'Name' },
            amount: { type: 'number', label: 'Amount' },
        },
        validations: [rule],
    });
    const outer = (branches: Record<string, unknown>) => ({
        type: 'conditional', name: 'outer', when: 'record.amount != null', message: 'Outer', ...branches,
    });
    const GUARDED = { type: 'script', name: 'guarded', condition: 'record.amount != null && record.amount > 100', message: 'G' };
    /** Each body refused by `os build` at `error`, one level or two below the rule's own `when`. */
    const REFUSED = [
        {
            label: 'an unregistered function in `then`',
            rule: outer({ then: { type: 'script', name: 'inner', condition: 'sqrt(record.amount) > 1', message: 'I' }, otherwise: GUARDED }),
            where: "object 'fx_nested' · validation rule 'outer' then → 'inner'",
            subject: '`sqrt` is not a callable name here',
        },
        {
            label: 'a bare field in `otherwise`',
            rule: outer({ then: GUARDED, otherwise: { type: 'script', name: 'other', condition: 'amont > 1', message: 'O' } }),
            where: "object 'fx_nested' · validation rule 'outer' otherwise → 'other'",
            subject: 'bare reference `amont`',
        },
        {
            label: 'an unregistered function two levels down',
            rule: outer({
                then: {
                    type: 'conditional', name: 'mid', when: "record.name != null && record.name != ''", message: 'M',
                    then: { type: 'script', name: 'deep', condition: 'sqrt(record.amount) > 1', message: 'D' },
                },
            }),
            where: "object 'fx_nested' · validation rule 'outer' then → 'mid' then → 'deep'",
            subject: '`sqrt` is not a callable name here',
        },
    ] as const;
    const VALID = outer({
        then: {
            type: 'conditional', name: 'mid', when: "record.name != null && record.name != ''", message: 'M',
            then: GUARDED,
        },
        otherwise: { ...GUARDED, name: 'other' },
    });

    const nestedRows = (rows: Map<string, Row>) =>
        Array.from(rows.values()).filter((r) => r.type === 'object' && r.name === 'fx_nested');

    /** The build's findings for one object, through the build's own entry. */
    const buildFindings = (obj: unknown) => {
        const stack = { objects: [obj] };
        return runAuthoringRules('build', { normalized: stack, parsed: stack })
            .filter((f) => f.rule === EXPRESSION_INVALID);
    };

    for (const { label, rule, where, subject } of REFUSED) {
        it(`(a) REFUSES an active save of ${label} with a 422 carrying the build's finding at the nested rule`, async () => {
            const { protocol, rows } = makeProtocol();

            const err = await protocol
                .saveMetaItem({ type: 'object', name: 'fx_nested', item: fxNested(rule) })
                .catch((e: any) => e);

            expect(err, 'the save resolved — the door still accepts the nested predicate').toBeInstanceOf(Error);
            expect(err.status).toBe(422);
            expect(err.code).toBe('INVALID_METADATA');
            expect(err.rulesRun).toContain('validateStackExpressions');
            const issues = err.issues.filter((i: any) => i.rule === EXPRESSION_INVALID);
            expect(issues, `issues: ${JSON.stringify(err.issues)}`).toHaveLength(1);
            expect(issues[0].path).toBe(where);
            expect(issues[0].where).toBe(where);
            expect(issues[0].severity).toBe('error');
            // The named subject: what the author typed, as the build names it.
            expect(issues[0].message).toContain(subject);
            // And nothing landed — a gate that refuses after persisting is a log line.
            expect(nestedRows(rows)).toEqual([]);
        });
    }

    it("(a) REFUSES a nested body on a draft's PROMOTION — the draft door is not a bypass", async () => {
        const { protocol } = makeProtocol();
        // A draft save is never gated (#4463 D1): the author may keep a half-finished object.
        await expect(
            protocol.saveMetaItem({ type: 'object', name: 'fx_nested', item: fxNested(REFUSED[0].rule), mode: 'draft' }),
        ).resolves.toMatchObject({ success: true });

        const err = await protocol.publishMetaItem({ type: 'object', name: 'fx_nested' }).catch((e: any) => e);

        expect(err?.status).toBe(422);
        expect(err.code).toBe('INVALID_METADATA');
        const issue = err.issues.find((i: any) => i.rule === EXPRESSION_INVALID);
        expect(issue, `issues: ${JSON.stringify(err.issues)}`).toBeDefined();
        expect(issue.path).toBe(REFUSED[0].where);
    });

    it('(b) valid nested predicates — both branches, two levels down — still save, and the row lands', async () => {
        const { protocol, rows } = makeProtocol();

        const result = await protocol.saveMetaItem({ type: 'object', name: 'fx_nested', item: fxNested(VALID) });

        expect(result.success).toBe(true);
        expect(nestedRows(rows).map((r) => r.state)).toEqual(['active']);
    });

    it('(d) the door and `os build` give the SAME findings for each refused body', async () => {
        for (const { label, rule } of REFUSED) {
            const { protocol } = makeProtocol();
            const err = await protocol
                .saveMetaItem({ type: 'object', name: 'fx_nested', item: fxNested(rule) })
                .catch((e: any) => e);
            const atDoor = (err.issues ?? []).filter((i: any) => i.rule === EXPRESSION_INVALID);

            const atBuild = buildFindings(fxNested(rule));

            // Non-vacuous on both sides: one finding each, and an error at the build.
            expect(atBuild, label).toHaveLength(1);
            expect(atBuild[0]!.severity).toBe('error');
            expect(atDoor, label).toHaveLength(1);
            // Compared key by key — the door reuses the build's call, so a reworded
            // or relocated door verdict is a second dialect, and red.
            for (const key of ['rule', 'where', 'path', 'message', 'hint'] as const) {
                expect(atDoor[0][key], `door and build disagree on '${key}' for ${label}`).toBe(atBuild[0]![key]);
            }
        }
        // And the valid rule is clean at the build too, not just at the door.
        expect(buildFindings(fxNested(VALID))).toEqual([]);
    });
});

/**
 * [#22032, pass 4] The object save door gives the build's verdict on the
 * object's own action predicates.
 *
 * The same `formulas.mdx` sentence covers an action's `visible` and
 * `disabled`: the shared validator backs `os build` and metadata registration.
 * After pass 3 the build's expression rule ran every other pass over the
 * object's body on this door and kept the object action loop fenced, so an
 * action whose `visible` read a bare field (`amount > 1`) still saved with a
 * 200, while `os build` refused it at `error`.
 *
 * The lift is in `@objectstack/lint` (the object action loop's object-write
 * guard is gone); no code here moves. Pinned through the REAL `saveMetaItem` /
 * `publishMetaItem` / `publishPackageDrafts`:
 *
 *  (a) the door refuses a bare reference and an unregistered function in
 *      `visible`, and a bare reference in `disabled` — a 422
 *      `INVALID_METADATA` carrying the build's located finding — on an active
 *      save, on a draft's promotion and on a package's draft publish, and
 *      nothing lands;
 *  (b) the shapes the platform and the examples ship still save: a `record`
 *      comparison, a `current_user.positions` role gate, a
 *      `current_user.isPlatformAdmin` check, a `features.*` switch and a
 *      boolean `disabled`;
 *  (c) a stored sibling whose actions the build refuses does not block a clean
 *      save of this object (#22118's baseline);
 *  (d) for each refused object body the door's issues and the build's findings
 *      are the same findings: rule, location, message and hint.
 *
 * The rest of the pass's findings, the location an action also declared
 * top-level takes at each door, and the stored-self cases are pinned in
 * `@objectstack/lint`'s `runtime-gate.object-action-predicate-writes.test.ts`;
 * the pin over every object-borne pass is in
 * `runtime-gate.object-formula-writes.test.ts`.
 *
 * ⚠️ As in the #22019 block above: this package reaches `@objectstack/lint`
 * through its built `dist/`, so an edit to the rule is invisible here until
 * `pnpm --filter @objectstack/lint build` has run.
 */
describe('runtime authoring gate on OBJECT writes — the object action predicate verdict (#22032 pass 4)', () => {
    /** `sharingModel` is authored so `security-owd-unset` stays quiet and the refusal is the action's. */
    const fxAction = (visible: unknown, disabled?: unknown, name = 'fx_action') => ({
        name,
        label: 'Action Probe',
        sharingModel: 'private',
        fields: {
            name: { type: 'text', label: 'Name' },
            amount: { type: 'number', label: 'Amount' },
            status: { type: 'text', label: 'Status' },
        },
        actions: [
            {
                name: 'fx_close',
                label: 'Close',
                type: 'script',
                target: 'close',
                visible,
                ...(disabled === undefined ? {} : { disabled }),
            },
        ],
    });
    /** The clean `visible` every `disabled` body rides beside. */
    const OPEN = "record.status == 'open'";
    /** One refused body per key and finding kind, each refused by `os build` at `error`; the first is the card's shape. */
    const REFUSED = [
        { key: 'visible', body: 'amount > 1', subject: 'bare reference `amount`' },
        { key: 'visible', body: 'sqrt(record.amount) > 1', subject: '`sqrt`' },
        { key: 'disabled', body: 'amount > 1', subject: 'bare reference `amount`' },
    ] as const;
    const bodyFor = ({ key, body }: { key: 'visible' | 'disabled'; body: unknown }) =>
        key === 'visible' ? fxAction(body) : fxAction(OPEN, body);
    /** Where the build locates the refused action's finding — the action the author edits. */
    const whereOf = (key: 'visible' | 'disabled') => `object 'fx_action' · action 'fx_close' ${key}`;
    /** The shapes the platform's objects and the examples ship. */
    const ACCEPTED = [
        fxAction(OPEN, "record.status == 'closed'"),
        fxAction("'org_admin' in current_user.positions", true),
        fxAction('current_user.isPlatformAdmin == true'),
        fxAction('features.organization != false'),
    ];

    const actionRows = (rows: Map<string, Row>) =>
        Array.from(rows.values()).filter((r) => r.type === 'object' && r.name === 'fx_action');

    /** The build's findings for one object, through the build's own entry. */
    const buildFindings = (obj: unknown) => {
        const stack = { objects: [obj] };
        return runAuthoringRules('build', { normalized: stack, parsed: stack })
            .filter((f) => f.rule === EXPRESSION_INVALID);
    };

    for (const refused of REFUSED) {
        const { key, body, subject } = refused;
        it(`(a) REFUSES an active save of an action's \`${key}: ${body}\` with a 422 carrying the build's located finding`, async () => {
            const { protocol, rows } = makeProtocol();

            const err = await protocol
                .saveMetaItem({ type: 'object', name: 'fx_action', item: bodyFor(refused) })
                .catch((e: any) => e);

            expect(err, 'the save resolved — the door still accepts the action predicate').toBeInstanceOf(Error);
            expect({ code: err.code, status: err.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
            expect(err.rulesRun).toContain('validateStackExpressions');
            const issues = err.issues.filter((i: any) => i.rule === EXPRESSION_INVALID);
            expect(issues, `issues: ${JSON.stringify(err.issues)}`).toHaveLength(1);
            expect(issues[0].path).toBe(whereOf(key));
            expect(issues[0].where).toBe(whereOf(key));
            expect(issues[0].severity).toBe('error');
            // The named subject: what the author typed, as the build names it.
            expect(issues[0].message).toContain(subject);
            // And nothing landed — a gate that refuses after persisting is a log line.
            expect(actionRows(rows)).toEqual([]);
        });
    }

    it("(a) REFUSES the card-shaped body on a draft's PROMOTION — the draft door is not a bypass", async () => {
        const { protocol } = makeProtocol();
        // A draft save is never gated (#4463 D1): the author may keep a half-finished object.
        await expect(
            protocol.saveMetaItem({ type: 'object', name: 'fx_action', item: bodyFor(REFUSED[0]), mode: 'draft' }),
        ).resolves.toMatchObject({ success: true });

        const err = await protocol.publishMetaItem({ type: 'object', name: 'fx_action' }).catch((e: any) => e);

        expect({ code: err?.code, status: err?.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
        const issue = err.issues.find((i: any) => i.rule === EXPRESSION_INVALID);
        expect(issue, `issues: ${JSON.stringify(err.issues)}`).toBeDefined();
        expect(issue.path).toBe(whereOf('visible'));
    });

    it("(a) REFUSES the card-shaped body on a PACKAGE's draft publish — nothing goes live", async () => {
        const { protocol, rows } = makeProtocol();
        await expect(
            protocol.saveMetaItem({
                type: 'object', name: 'fx_action', item: bodyFor(REFUSED[0]), mode: 'draft', packageId: 'app.fx',
            }),
        ).resolves.toMatchObject({ success: true });

        const res = await protocol.publishPackageDrafts({ packageId: 'app.fx' });

        expect(res.outcome, JSON.stringify(res)).toBe('refused');
        expect(res.publishedCount).toBe(0);
        expect(res.failed).toEqual([expect.objectContaining({ type: 'object', name: 'fx_action', code: 'INVALID_METADATA' })]);
        expect(actionRows(rows).map((r) => r.state)).toEqual(['draft']);
    });

    for (const [i, item] of ACCEPTED.entries()) {
        it(`(b) a shipped action shape still saves, and the row lands (#${i}: ${JSON.stringify(item.actions[0].visible)})`, async () => {
            const { protocol, rows } = makeProtocol();

            const result = await protocol.saveMetaItem({ type: 'object', name: 'fx_action', item });

            expect(result.success).toBe(true);
            expect(actionRows(rows).map((r) => r.state)).toEqual(['active']);
            // Clean at the build too, not only at this door.
            expect(buildFindings(item)).toEqual([]);
        });
    }

    it("(c) a stored sibling whose actions the build refuses does not block a clean save", async () => {
        const sibling = fxAction(REFUSED[0].body, REFUSED[2].body, 'fx_sibling');
        // Non-vacuous: the sibling is refused at the build.
        expect(buildFindings(sibling).length).toBeGreaterThan(0);
        const { engine, rows } = makeStubEngine();
        engine.registry.listItems = (type: string) => (type === 'object' ? [sibling] : []);
        const protocol = new ObjectStackProtocolImplementation(engine, () => new Map(), 'env_test') as any;

        const result = await protocol.saveMetaItem({ type: 'object', name: 'fx_action', item: fxAction(OPEN) });

        expect(result.success).toBe(true);
        expect(actionRows(rows).map((r) => r.state)).toEqual(['active']);
    });

    it('(d) the door and `os build` give the SAME findings for each refused object body', async () => {
        for (const refused of REFUSED) {
            const { protocol } = makeProtocol();
            const err = await protocol
                .saveMetaItem({ type: 'object', name: 'fx_action', item: bodyFor(refused) })
                .catch((e: any) => e);
            const atDoor = (err.issues ?? []).filter((i: any) => i.rule === EXPRESSION_INVALID);

            const atBuild = buildFindings(bodyFor(refused));

            // Non-vacuous on both sides: one finding each, and an error at the build.
            expect(atBuild, `${refused.key}: ${refused.body}`).toHaveLength(1);
            expect(atBuild[0]!.severity).toBe('error');
            expect(atDoor, `${refused.key}: ${refused.body}`).toHaveLength(1);
            // Compared key by key — the door reuses the build's call, so a reworded
            // or relocated door verdict is a second dialect, and red.
            for (const k of ['rule', 'where', 'path', 'message', 'hint'] as const) {
                expect(atDoor[0][k], `door and build disagree on '${k}' for ${refused.key}: ${refused.body}`).toBe(atBuild[0]![k]);
            }
        }
    });
});

/**
 * [#24677] The object save door refuses a `lookup` or `master_detail` whose
 * `reference` is a stored-metadata-body table.
 *
 * The engine never hydrates such a field (`expand` keeps the stored id; a
 * master-detail `parent` root over a family header stays unbound), and this
 * door saved it with a 200, as `os validate` and `os build` built it. The
 * refusal is in `@objectstack/lint`'s expression rule, beside the refusal of a
 * formula reading through such a field; no code here moves. Pinned through
 * the REAL `saveMetaItem` / `publishMetaItem`:
 *
 *  (a) each family table, as a `lookup` and as a `master_detail`, is refused
 *      with the 422 `INVALID_METADATA` envelope carrying the build's located
 *      finding, on an active save AND on a draft's promotion, and nothing
 *      lands;
 *  (b) the control: a reference to an ordinary platform table still saves;
 *  (d) the door's issue and the build's finding are the same finding.
 *
 * The rule's own pins are `@objectstack/lint`'s
 * `validate-expressions.stored-metadata-body-reference.test.ts`.
 *
 * ⚠️ As in the #22019 block above: this package reaches `@objectstack/lint`
 * through its built `dist/`, so an edit to the rule is invisible here until
 * `pnpm --filter @objectstack/lint build` has run.
 */
describe('runtime authoring gate on OBJECT writes — a relationship into a stored-metadata-body table (#24677)', () => {
    /** `sharingModel` is authored so `security-owd-unset` stays quiet and the refusal is the reference's. */
    const fxRef = (type: string, target: string) => ({
        name: 'fx_ref',
        label: 'Reference Probe',
        sharingModel: 'private',
        fields: {
            name: { type: 'text', label: 'Name' },
            meta: { type, label: 'Meta', reference: target },
        },
    });
    const FAMILY = ['sys_metadata', 'sys_metadata_history'] as const;
    const TYPES = ['lookup', 'master_detail'] as const;
    /** Where the build locates the refusal — the KEY the author edits. */
    const WHERE = "object 'fx_ref' · field 'meta' reference";

    const refRows = (rows: Map<string, Row>) =>
        Array.from(rows.values()).filter((r) => r.type === 'object' && r.name === 'fx_ref');
    const buildFindings = (obj: unknown) => {
        const stack = { objects: [obj] };
        return runAuthoringRules('build', { normalized: stack, parsed: stack })
            .filter((f) => f.rule === EXPRESSION_INVALID && f.where === WHERE);
    };

    for (const target of FAMILY) {
        for (const type of TYPES) {
            it(`(a) REFUSES an active save of a \`${type}\` to '${target}' with a 422 carrying the build's located finding`, async () => {
                const { protocol, rows } = makeProtocol();

                const err = await protocol
                    .saveMetaItem({ type: 'object', name: 'fx_ref', item: fxRef(type, target) })
                    .catch((e: any) => e);

                expect(err, 'the save resolved — the door still accepts the reference').toBeInstanceOf(Error);
                expect({ code: err.code, status: err.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
                expect(err.rulesRun).toContain('validateStackExpressions');
                const issue = err.issues.find((i: any) => i.rule === EXPRESSION_INVALID && i.where === WHERE);
                expect(issue, `issues: ${JSON.stringify(err.issues)}`).toBeDefined();
                expect(issue.path).toBe(WHERE);
                expect(issue.severity).toBe('error');
                // The named subjects: the field, its type and the target.
                expect(issue.message).toContain(`\`meta\` is a \`${type}\` whose \`reference\` names '${target}'`);
                // And nothing landed.
                expect(refRows(rows)).toEqual([]);
            });
        }
    }

    it("(a) REFUSES the same body on a draft's PROMOTION — the draft door is not a bypass", async () => {
        const { protocol, rows } = makeProtocol();
        await expect(
            protocol.saveMetaItem({ type: 'object', name: 'fx_ref', item: fxRef('master_detail', 'sys_metadata'), mode: 'draft' }),
        ).resolves.toMatchObject({ success: true });

        const err = await protocol.publishMetaItem({ type: 'object', name: 'fx_ref' }).catch((e: any) => e);

        expect({ code: err?.code, status: err?.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
        const issue = err.issues.find((i: any) => i.rule === EXPRESSION_INVALID && i.where === WHERE);
        expect(issue, `issues: ${JSON.stringify(err.issues)}`).toBeDefined();
        expect(refRows(rows).map((r) => r.state)).not.toContain('active');
    });

    for (const type of TYPES) {
        it(`(b) the control: a \`${type}\` to an ordinary platform table (\`sys_user\`) still saves, and the row lands`, async () => {
            const { protocol, rows } = makeProtocol();

            const result = await protocol.saveMetaItem({ type: 'object', name: 'fx_ref', item: fxRef(type, 'sys_user') });

            expect(result.success).toBe(true);
            expect(refRows(rows).map((r) => r.state)).toEqual(['active']);
        });
    }

    it('(d) the door and `os build` give the SAME finding for the same field', async () => {
        const { protocol } = makeProtocol();
        const err = await protocol
            .saveMetaItem({ type: 'object', name: 'fx_ref', item: fxRef('lookup', 'sys_metadata') })
            .catch((e: any) => e);
        const atDoor = (err.issues ?? []).filter((i: any) => i.rule === EXPRESSION_INVALID && i.where === WHERE);

        const atBuild = buildFindings(fxRef('lookup', 'sys_metadata'));

        expect(atBuild).toHaveLength(1);
        expect(atBuild[0]!.severity).toBe('error');
        expect(atDoor).toHaveLength(1);
        for (const k of ['rule', 'where', 'path', 'message', 'hint'] as const) {
            expect(atDoor[0][k], `door and build disagree on '${k}'`).toBe(atBuild[0]![k]);
        }
        expect(buildFindings(fxRef('lookup', 'sys_user'))).toEqual([]);
    });
});

// #23388 — the two page component rules at the runtime save door, ruling of
// record 6161173492 (letter B): `validateComponentProps` and
// `validateComponentTypes` run on a `page` write (`runtimeTypes: ['page']`),
// so a page saved through Studio, REST `/meta` or MCP meets the refusal
// `os validate` / `os build` / `os lint` give, with the same fix. The
// maintainer's principle: a page with a finding is fixed, then saved. Stored
// pages keep loading and serving — the gate judges writes, never the read
// path — and only the next save of a page with a finding is refused.
describe('runtime authoring gate on PAGE writes — the component props and type rules (#23388)', () => {
    const page = (components: unknown[]) => ({
        name: 'deals_home',
        label: 'Deals',
        type: 'app',
        regions: [{ name: 'main', components }],
    });
    /** Clean: every prop is one `page:header` declares. */
    const cleanPage = () => page([{ type: 'page:header', properties: { title: 'Deals', subtitle: 'Open pipeline' } }]);
    /** An undeclared prop: the near-miss `titel` of the declared `title`. */
    const undeclaredPropPage = () => page([{ type: 'page:header', properties: { titel: 'Deals' } }]);
    /** A type inside the reserved `page:` namespace the platform does not declare. */
    const reservedTypePage = () => page([{ type: 'page:headr', properties: { title: 'Deals' } }]);

    const savePage = (protocol: any, item: unknown, extra: Record<string, unknown> = {}) =>
        protocol.saveMetaItem({ type: 'page', name: 'deals_home', item, ...extra });
    const activePageRows = (rows: Map<string, Row>) =>
        Array.from(rows.values()).filter((r) => r.type === 'page' && r.state === 'active');

    let warn: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        delete process.env.OS_ALLOW_UNLINTED_METADATA_WRITES;
    });
    afterEach(() => {
        warn.mockRestore();
        delete process.env.OS_ALLOW_UNLINTED_METADATA_WRITES;
    });

    it('(a) refuses a page carrying an undeclared component prop, and the refusal carries the fix', async () => {
        const { protocol, rows } = makeProtocol();

        const err = await savePage(protocol, undeclaredPropPage()).catch((e: any) => e);

        expect(err).toBeInstanceOf(Error);
        expect(err.status).toBe(422);
        expect(err.code).toBe('INVALID_METADATA');
        expect(err.message).toMatch(/^page\/deals_home failed author-time validation: 1 issue — /);
        const issue = err.issues.find((i: any) => i.rule === 'component-props-unknown-key');
        expect(issue, `issues: ${JSON.stringify(err.issues)}`).toBeDefined();
        expect(issue.path).toBe('pages[0].regions[0].components[0].properties.titel');
        // The fix: the declared spelling, named in the verdict, and the remedy line.
        expect(issue.message).toContain('`titel` → `title`');
        expect(issue.hint).toContain('Remove `titel`');
        expect(err.rulesRun).toEqual(expect.arrayContaining(['validateComponentProps', 'validateComponentTypes']));
        // Nothing landed.
        expect(activePageRows(rows)).toEqual([]);
    });

    it('(a) gates the draft → active promotion of the same page, so the draft door is no bypass', async () => {
        const { protocol } = makeProtocol();
        await expect(savePage(protocol, undeclaredPropPage(), { mode: 'draft' }))
            .resolves.toMatchObject({ success: true });

        const err = await protocol.publishMetaItem({ type: 'page', name: 'deals_home' }).catch((e: any) => e);

        expect(err?.status).toBe(422);
        expect(err.code).toBe('INVALID_METADATA');
        expect(err.issues.map((i: any) => i.rule)).toContain('component-props-unknown-key');
    });

    it('(c) refuses a page carrying an undeclared type inside a reserved namespace, naming the declared type', async () => {
        const { protocol, rows } = makeProtocol();

        const err = await savePage(protocol, reservedTypePage()).catch((e: any) => e);

        expect(err).toBeInstanceOf(Error);
        expect(err.status).toBe(422);
        expect(err.code).toBe('INVALID_METADATA');
        const issue = err.issues.find((i: any) => i.rule === 'component-type-unknown');
        expect(issue, `issues: ${JSON.stringify(err.issues)}`).toBeDefined();
        expect(issue.path).toBe('pages[0].regions[0].components[0].type');
        expect(issue.hint).toBe('Rename `page:headr` → `page:header`.');
        expect(activePageRows(rows)).toEqual([]);
    });

    it('the control: the same page with its declared prop and type saves', async () => {
        const { protocol, rows } = makeProtocol();

        await expect(savePage(protocol, cleanPage())).resolves.toMatchObject({ success: true });

        expect(activePageRows(rows)).toHaveLength(1);
        // A type outside the spec's reserved namespaces is the open arm's story
        // and stays untouched (custom/registered component types).
        await expect(savePage(protocol, page([{ type: 'acme:pipeline_board' }])))
            .resolves.toMatchObject({ success: true });
    });

    it('(b) a stored page with a finding keeps loading and serving; its next save is refused until fixed', async () => {
        const { engine, rows } = makeStubEngine();
        const registered: Array<{ type: string; name: unknown }> = [];
        engine.registry.registerItem = (type: string, item: { name?: unknown }) => {
            registered.push({ type, name: item?.name });
        };
        const protocol = new ObjectStackProtocolImplementation(engine, () => new Map(), 'env_test') as any;
        // Stored before the crossing: both findings at once, seeded straight
        // into the store because the save door now refuses this body.
        const stored = page([
            { type: 'page:header', properties: { titel: 'Deals' } },
            { type: 'page:headr' },
        ]);
        rows.set(keyOf({ type: 'page', name: 'deals_home', organization_id: null, state: 'active' }), {
            id: 'r_seed', type: 'page', name: 'deals_home', organization_id: null, state: 'active',
            metadata: JSON.stringify(stored),
        });

        // Loads: the boot path runs no authoring rule.
        const result = await protocol.loadMetaFromDb();
        expect(result).toMatchObject({ loaded: 1, errors: 0, invalid: 0 });
        expect(registered).toContainEqual({ type: 'page', name: 'deals_home' });
        // Serves: the read door hands the stored body back as stored.
        const served: any = (await protocol.getMetaItem({ type: 'page', name: 'deals_home' })).item;
        expect(served?.regions?.[0]?.components?.map((c: any) => c.type)).toEqual(['page:header', 'page:headr']);

        // The next save of the same body is a write, and is judged.
        const err = await savePage(protocol, stored).catch((e: any) => e);
        expect(err?.status).toBe(422);
        expect(err.code).toBe('INVALID_METADATA');
        expect(err.issues.map((i: any) => i.rule).sort()).toEqual(['component-props-unknown-key', 'component-type-unknown']);
        // The stored row is untouched by the refusal.
        expect(JSON.parse(activePageRows(rows)[0]!.metadata)).toEqual(stored);

        // Fixed, then saved.
        await expect(savePage(protocol, cleanPage())).resolves.toMatchObject({ success: true });
        expect(JSON.parse(activePageRows(rows)[0]!.metadata)).toEqual(cleanPage());
    });
});

// #24491 — the visibility-predicate family at the runtime save door for a
// `page`, on the principle of the ruling of record above (6161173492, letter
// B): a page with a finding is fixed, then saved. `validateVisibilityPredicates`
// and `validatePredicatePathRefs` declare `runtimeTypes: ['view', 'page']`, so
// a page component `visibleWhen` that `os validate` / `os build` / `os lint`
// refuse is refused at Studio, REST `/meta` and MCP with the build's own
// finding. Stored pages keep loading and serving; only the next save of a page
// with such a predicate is refused. The lint-level pins (every finding kind,
// the path half on a page, the `view` control) are `@objectstack/lint`'s
// `runtime-gate.page-visibility-predicate-writes.test.ts`.
//
// ⚠️ This package reaches `@objectstack/lint` through its built `dist/`, so a
// registry edit is invisible here until `pnpm --filter @objectstack/lint build`
// has run.
describe('runtime authoring gate on PAGE writes — the component visibleWhen verdict (#24491)', () => {
    const UNKNOWN_FUNCTION = 'visibility-predicate-unknown-function';
    const FAMILY = ['validateVisibilityPredicates', 'validatePredicatePathRefs'];
    /** One `page:header` whose props are declared, so a refusal is the predicate's. */
    const page = (visibleWhen: unknown) => ({
        name: 'pipeline_home',
        label: 'Pipeline',
        type: 'app',
        regions: [{ name: 'main', components: [{ type: 'page:header', properties: { title: 'Pipeline' }, visibleWhen }] }],
    });
    /** The card's shape: parses, is rooted nowhere wrong, and calls a function nothing registers. */
    const bogusPage = () => page('totallyBogusFn(1)');
    /** Registered functions, the shapes the examples and the platform's pages ship. */
    const ACCEPTED = [
        "has(record.status) && record.status == 'in_review'",
        { dialect: 'cel', source: 'has(record.id) && has(record.email_verified) && record.email_verified == false' },
        'size(record.name) > 0',
    ];

    const savePage = (protocol: any, item: unknown, extra: Record<string, unknown> = {}) =>
        protocol.saveMetaItem({ type: 'page', name: 'pipeline_home', item, ...extra });
    const activePageRows = (rows: Map<string, Row>) =>
        Array.from(rows.values()).filter((r) => r.type === 'page' && r.state === 'active');
    /** The build's error findings for one page, through the build's own entry. */
    const buildErrors = (item: unknown) => {
        const stack = { pages: [item] };
        return runAuthoringRules('build', { normalized: stack, parsed: stack }).filter((f) => f.severity === 'error');
    };

    let warn: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        delete process.env.OS_ALLOW_UNLINTED_METADATA_WRITES;
    });
    afterEach(() => {
        warn.mockRestore();
        delete process.env.OS_ALLOW_UNLINTED_METADATA_WRITES;
    });

    it('(a) REFUSES an active save of a component `visibleWhen` calling an unknown function, with the build\'s located finding; nothing stored', async () => {
        const { protocol, rows } = makeProtocol();

        const err = await savePage(protocol, bogusPage()).catch((e: any) => e);

        expect(err, 'the save resolved — the door still accepts the page predicate').toBeInstanceOf(Error);
        expect({ code: err.code, status: err.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
        expect(err.message).toMatch(/^page\/pipeline_home failed author-time validation: 1 issue — /);
        expect(err.rulesRun).toEqual(expect.arrayContaining(FAMILY));
        const issues = err.issues.filter((i: any) => i.rule === UNKNOWN_FUNCTION);
        expect(issues, `issues: ${JSON.stringify(err.issues)}`).toHaveLength(1);
        expect(issues[0]).toMatchObject({
            severity: 'error',
            where: 'page "pipeline_home"',
            path: 'pages[0].regions[0].components[0]',
        });
        expect(issues[0].message).toContain('`totallyBogusFn`');
        // A gate that refuses after persisting is a log line.
        expect(activePageRows(rows)).toEqual([]);
    });

    it('(a) gates the draft → active promotion of the same page, so the draft door is no bypass', async () => {
        const { protocol } = makeProtocol();
        await expect(savePage(protocol, bogusPage(), { mode: 'draft' })).resolves.toMatchObject({ success: true });

        const err = await protocol.publishMetaItem({ type: 'page', name: 'pipeline_home' }).catch((e: any) => e);

        expect({ code: err?.code, status: err?.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
        expect(err.issues.map((i: any) => i.rule)).toContain(UNKNOWN_FUNCTION);
    });

    it('(b) the door and `os build` give the SAME finding for the refused page', async () => {
        const { protocol } = makeProtocol();
        const err = await savePage(protocol, bogusPage()).catch((e: any) => e);
        const atDoor = (err.issues ?? []).filter((i: any) => i.rule === UNKNOWN_FUNCTION);

        const atBuild = buildErrors(bogusPage());

        // Non-vacuous on both sides: the build refuses the page with this one finding.
        expect(atBuild.map((f) => f.rule)).toEqual([UNKNOWN_FUNCTION]);
        expect(atDoor).toHaveLength(1);
        // Compared key by key: a reworded or relocated door verdict is a second dialect.
        for (const k of ['rule', 'where', 'path', 'message', 'hint'] as const) {
            expect(atDoor[0][k], `door and build disagree on '${k}'`).toBe(atBuild[0]![k]);
        }
    });

    for (const [i, visibleWhen] of ACCEPTED.entries()) {
        it(`(c) a page calling only registered functions saves, and the row lands (#${i}: ${JSON.stringify(visibleWhen)})`, async () => {
            const { protocol, rows } = makeProtocol();

            await expect(savePage(protocol, page(visibleWhen))).resolves.toMatchObject({ success: true });

            expect(activePageRows(rows)).toHaveLength(1);
            // Clean at the build too, not only at this door.
            expect(buildErrors(page(visibleWhen))).toEqual([]);
        });
    }

    it('(d) a stored page with such a predicate keeps loading and serving; its next save is refused until fixed', async () => {
        const { engine, rows } = makeStubEngine();
        const registered: Array<{ type: string; name: unknown }> = [];
        engine.registry.registerItem = (type: string, item: { name?: unknown }) => {
            registered.push({ type, name: item?.name });
        };
        const protocol = new ObjectStackProtocolImplementation(engine, () => new Map(), 'env_test') as any;
        // Stored before the crossing, seeded straight into the store because the
        // save door now refuses this body.
        const stored = bogusPage();
        rows.set(keyOf({ type: 'page', name: 'pipeline_home', organization_id: null, state: 'active' }), {
            id: 'r_seed', type: 'page', name: 'pipeline_home', organization_id: null, state: 'active',
            metadata: JSON.stringify(stored),
        });

        // Loads: the boot path runs no authoring rule.
        const result = await protocol.loadMetaFromDb();
        expect(result).toMatchObject({ loaded: 1, errors: 0, invalid: 0 });
        expect(registered).toContainEqual({ type: 'page', name: 'pipeline_home' });
        // Serves: the read door hands the stored predicate back as stored.
        const served: any = (await protocol.getMetaItem({ type: 'page', name: 'pipeline_home' })).item;
        expect(served?.regions?.[0]?.components?.[0]?.visibleWhen).toEqual(stored.regions[0]!.components[0]!.visibleWhen);

        // The next save of the same body is a write, and is judged.
        const err = await savePage(protocol, stored).catch((e: any) => e);
        expect({ code: err?.code, status: err?.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
        expect(err.issues.map((i: any) => i.rule)).toEqual([UNKNOWN_FUNCTION]);
        // The stored row is untouched by the refusal.
        expect(JSON.parse(activePageRows(rows)[0]!.metadata)).toEqual(stored);

        // Fixed, then saved.
        const fixed = page(ACCEPTED[0]);
        await expect(savePage(protocol, fixed)).resolves.toMatchObject({ success: true });
        expect(JSON.parse(activePageRows(rows)[0]!.metadata)).toEqual(fixed);
    });
});

// #25002 — a CEL slot INSIDE a page component's `properties` bag that overruns
// the platform's parse bounds (`page-predicate-over-budget`,
// `validatePagePredicateBounds`) is refused at the runtime save door, as
// `os build` refuses it. #24953 shipped it as an advisory (the door admitted the
// save and listed the finding); the amended 「甲」 (record 6303865025) ships
// the refusal in 18.x. The card's shape: a `page:tabs` item `visibleWhen` of
// ~390 AST nodes, over `maxAstNodes` (256). Pinned through the REAL
// `saveMetaItem`:
//
//  (a) the active save is refused — 422 `INVALID_METADATA`, the door's own
//      envelope — naming the slot and the bound, and nothing lands; the draft
//      promotion is refused the same way;
//  (b) the door's finding IS the build's;
//  (c) control: a within-bounds tab predicate saves, and the row lands.
//
// ⚠️ As above: this package reaches `@objectstack/lint` through its built
// `dist/`, so a registry or rule edit is invisible here until
// `pnpm --filter @objectstack/lint build` has run.
describe('runtime authoring gate on PAGE writes — a props-bag CEL slot over the parse bounds (#25002)', () => {
    const RULE = 'page-predicate-over-budget';
    const TAB_PATH = 'pages[0].regions[0].components[0].properties.items[1].visibleWhen';
    /** 78 `||` terms, five AST nodes each — the card's ~390-node class. */
    const OVER = Array.from({ length: 78 }, (_, i) => `record.f${i} == ${i}`).join(' || ');
    const WITHIN = "record.stage == 'won' || page.tab != ''";
    const page = (tabVisibleWhen: string) => ({
        name: 'deal_home',
        label: 'Deal',
        type: 'app',
        regions: [{
            name: 'main',
            components: [{
                type: 'page:tabs',
                properties: {
                    items: [
                        { label: 'Overview', value: 'overview', children: [] },
                        { label: 'Finance', value: 'finance', visibleWhen: tabVisibleWhen, children: [] },
                    ],
                },
            }],
        }],
    });

    const savePage = (protocol: any, item: unknown, extra: Record<string, unknown> = {}) =>
        protocol.saveMetaItem({ type: 'page', name: 'deal_home', item, ...extra });
    const activePageRows = (rows: Map<string, Row>) =>
        Array.from(rows.values()).filter((r) => r.type === 'page' && r.state === 'active');

    let warn: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        delete process.env.OS_ALLOW_UNLINTED_METADATA_WRITES;
    });
    afterEach(() => {
        warn.mockRestore();
        delete process.env.OS_ALLOW_UNLINTED_METADATA_WRITES;
    });

    it('(a) REFUSES an active save of the card\'s tab-item `visibleWhen`, naming the bound; nothing stored', async () => {
        const { protocol, rows } = makeProtocol();

        const err = await savePage(protocol, page(OVER)).catch((e: any) => e);

        expect(err, 'the save resolved — the door still admits the over-budget slot').toBeInstanceOf(Error);
        expect({ code: err.code, status: err.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
        expect(err.rulesRun).toContain('validatePagePredicateBounds');
        const issues = (err.issues ?? []).filter((i: any) => i.rule === RULE);
        expect(issues, `issues: ${JSON.stringify(err.issues)}`).toHaveLength(1);
        expect(issues[0]).toMatchObject({ severity: 'error', path: TAB_PATH });
        expect(issues[0].message).toContain('`maxAstNodes` budget (platform limit 256)');
        expect(activePageRows(rows)).toEqual([]);
    });

    it('(a) gates the draft → active promotion of the same page', async () => {
        const { protocol, rows } = makeProtocol();
        await expect(savePage(protocol, page(OVER), { mode: 'draft' })).resolves.toMatchObject({ success: true });

        const err = await protocol.publishMetaItem({ type: 'page', name: 'deal_home' }).catch((e: any) => e);

        expect({ code: err?.code, status: err?.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
        expect((err.issues ?? []).map((i: any) => i.rule)).toContain(RULE);
        expect(activePageRows(rows)).toEqual([]);
    });

    it('(b) the door and `os build` give the SAME finding', async () => {
        const { protocol } = makeProtocol();
        const err = await savePage(protocol, page(OVER)).catch((e: any) => e);
        const atDoor = (err?.issues ?? []).filter((i: any) => i.rule === RULE);

        const stack = { pages: [page(OVER)] };
        const atBuild = runAuthoringRules('build', { normalized: stack, parsed: stack })
            .filter((f) => f.severity === 'error');

        expect(atBuild.map((f) => f.rule)).toEqual([RULE]);
        expect(atDoor).toHaveLength(1);
        for (const k of ['rule', 'where', 'path', 'message', 'hint'] as const) {
            expect(atDoor[0][k], `door and build disagree on '${k}'`).toBe(atBuild[0]![k]);
        }
    });

    it('(c) CONTROL — a within-bounds tab predicate saves, and the row lands', async () => {
        const { protocol, rows } = makeProtocol();

        await expect(savePage(protocol, page(WITHIN))).resolves.toMatchObject({ success: true });

        expect(activePageRows(rows)).toHaveLength(1);
        const stack = { pages: [page(WITHIN)] };
        expect(runAuthoringRules('build', { normalized: stack, parsed: stack }).filter((f) => f.rule === RULE)).toEqual([]);
    });
});

// A page component's `data` prop naming the retired view-level `api` provider,
// at the runtime save door. `object-grid`, `object-map`, `object-gantt` and
// `object-tree` take a view data source (`ViewDataSchema`) as `data`, so the
// step-18 retirement of that provider reaches them through their
// `ComponentPropsMap` rows. The page parse leaves `properties` an open record;
// the rule that judges the bag is `validateComponentProps`, which runs on a
// `page` write by the ruling of record above (6161173492, letter B). One
// operation, one implementation: the refusal is that rule's
// `component-props-invalid`, carrying the retirement's own prescription.
//
// Stored pages: the boot and read paths run no authoring rule, so a stored
// page with the binding loads, is registered and is served with no read
// diagnostic for it; its next save is refused until the binding is fixed.
describe('runtime authoring gate on PAGE writes — a component `data` naming the retired view-level api source', () => {
    // Spelled through a constant: the spec's tree-scoped absence pin reads
    // authored literals, and these bodies are refusals, not authorings.
    const RETIRED_PROVIDER = 'api' as const;
    const RETIRED_BINDING = {
        provider: RETIRED_PROVIDER,
        read: { url: 'https://partner.example.com/cases', headers: { Authorization: 'Bearer s3cr3t' } },
    };
    const PRESCRIPTION = "`view.data.provider: 'api'` was removed in @objectstack/spec 18 (ADR-0049";
    const block = (type: string, data: unknown, id = 'cases') => ({ id, type, properties: { objectName: 'crm_case', data } });
    const page = (components: unknown[], extra: Record<string, unknown> = {}) => ({
        name: 'partner_page',
        label: 'Partner',
        type: 'app',
        regions: [{ name: 'main', components }],
        ...extra,
    });
    const savePage = (protocol: any, item: unknown) =>
        protocol.saveMetaItem({ type: 'page', name: 'partner_page', item });
    const activePageRows = (rows: Map<string, Row>) =>
        Array.from(rows.values()).filter((r) => r.type === 'page' && r.state === 'active');
    const retirementIssues = (err: any) =>
        (err?.issues ?? []).filter((i: any) => i.rule === 'component-props-invalid' && String(i.message).includes(PRESCRIPTION));

    let warn: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        delete process.env.OS_ALLOW_UNLINTED_METADATA_WRITES;
    });
    afterEach(() => {
        warn.mockRestore();
        delete process.env.OS_ALLOW_UNLINTED_METADATA_WRITES;
    });

    it.each(['object-grid', 'object-map', 'object-gantt', 'object-tree'])(
        '%s: 422 INVALID_METADATA from the props rule at the component\'s `data.provider`, with the prescription; nothing stored',
        async (type) => {
            const { protocol, rows } = makeProtocol();

            const err = await savePage(protocol, page([block(type, RETIRED_BINDING)])).catch((e: any) => e);

            expect(err).toBeInstanceOf(Error);
            expect(err.status).toBe(422);
            expect(err.code).toBe('INVALID_METADATA');
            expect(err.rulesRun).toContain('validateComponentProps');
            expect(retirementIssues(err).map((i: any) => i.path)).toEqual([
                'pages[0].regions[0].components[0].properties.data.provider',
            ]);
            expect(activePageRows(rows)).toEqual([]);
        },
    );

    it('reaches a component in a `page:tabs` item, one nested in containers, and one in a slot', async () => {
        const { protocol, rows } = makeProtocol();
        const body = page([
            { id: 'tabs', type: 'page:tabs', properties: { items: [{ label: 'Cases', children: [block('object-grid', RETIRED_BINDING, 'in_tab')] }] } },
            { id: 'row', type: 'flex', properties: { children: [{ id: 'card', type: 'page:card', properties: { children: [block('object-tree', RETIRED_BINDING, 'deep')] } }] } },
        ], { kind: 'slotted', type: 'record', object: 'crm_case', slots: { details: block('object-map', RETIRED_BINDING, 'slotted') } });

        const err = await savePage(protocol, body).catch((e: any) => e);

        expect(err?.status).toBe(422);
        expect(err.code).toBe('INVALID_METADATA');
        expect(retirementIssues(err).map((i: any) => i.path).sort()).toEqual([
            'pages[0].regions[0].components[0].properties.items[0].children[0].properties.data.provider',
            'pages[0].regions[0].components[1].properties.children[0].properties.children[0].properties.data.provider',
            'pages[0].slots.details.properties.data.provider',
        ]);
        expect(activePageRows(rows)).toEqual([]);
    });

    it('the control: the same page with the `object` or `value` provider saves, one row', async () => {
        for (const data of [{ provider: 'object', object: 'crm_case' }, { provider: 'value', items: [{ name: 'a' }] }]) {
            const { protocol, rows } = makeProtocol();
            await expect(savePage(protocol, page([block('object-grid', data)]))).resolves.toMatchObject({ success: true });
            expect(activePageRows(rows), JSON.stringify(data)).toHaveLength(1);
        }
    });

    it('a stored page with the binding loads, registers and is served with no read diagnostic; its next save is refused until fixed', async () => {
        const { engine, rows } = makeStubEngine();
        const registered: Array<{ type: string; name: unknown }> = [];
        engine.registry.registerItem = (type: string, item: { name?: unknown }) => {
            registered.push({ type, name: item?.name });
        };
        const protocol = new ObjectStackProtocolImplementation(engine, () => new Map(), 'env_test') as any;
        const stored = page([block('object-grid', RETIRED_BINDING)]);
        rows.set(keyOf({ type: 'page', name: 'partner_page', organization_id: null, state: 'active' }), {
            id: 'r_seed', type: 'page', name: 'partner_page', organization_id: null, state: 'active',
            metadata: JSON.stringify(stored),
        });

        // Boot: no authoring rule runs, and the page parse no longer judges the bag.
        const result = await protocol.loadMetaFromDb();
        expect(result).toMatchObject({ loaded: 1, errors: 0, invalid: 0 });
        expect(registered).toContainEqual({ type: 'page', name: 'partner_page' });
        // Read: served as stored, with no diagnostic for the binding.
        const served: any = (await protocol.getMetaItem({ type: 'page', name: 'partner_page' })).item;
        expect(served?.regions?.[0]?.components?.[0]?.properties?.data?.provider).toBe(RETIRED_PROVIDER);
        expect(served?._diagnostics?.valid).toBe(true);
        expect(served?._diagnostics?.errors ?? []).toEqual([]);
        // No `[metadata_spec_invalid]` registration either: that came from the page parse.
        expect((warn.mock.calls as unknown[][]).map((c) => String(c[0])).filter((m) => m.includes('metadata_spec_invalid'))).toEqual([]);

        // The next save of the same body is a write, and is judged.
        const err = await savePage(protocol, stored).catch((e: any) => e);
        expect(err?.status).toBe(422);
        expect(err.code).toBe('INVALID_METADATA');
        expect(retirementIssues(err).map((i: any) => i.path)).toEqual([
            'pages[0].regions[0].components[0].properties.data.provider',
        ]);
        expect(JSON.parse(activePageRows(rows)[0]!.metadata)).toEqual(stored);

        // Fixed, then saved.
        const fixed = page([block('object-grid', { provider: 'object', object: 'crm_case' })]);
        await expect(savePage(protocol, fixed)).resolves.toMatchObject({ success: true });
        expect(JSON.parse(activePageRows(rows)[0]!.metadata)).toEqual(fixed);
    });
});

// A list view written into a PACKAGE is judged against that package's closure
// (ruling #9612): the package, its declared dependencies, platform objects and
// provenance-less rows. Through the real `saveMetaItem`, `publishMetaItem` and
// `publishPackageDrafts`: a binding outside the closure — an object of a
// package this one never declared, or an object that exists nowhere — is
// REFUSED `422 INVALID_METADATA` at the binding, with the remedy (declare the
// dependency), never skipped; it is the verdict the dataset door gives an
// out-of-closure base object under the same closure (the flow door's trigger
// advisory, `protocol.package-closure-gate.test.ts`, is a separate question).
// A binding inside the closure keeps its field verdict, so an unknown
// `columns` field is refused `422 list-view-field-unknown` as the overlay door
// refuses it. A write that names no package is judged against the whole
// collection, exactly as before. Drafts are not gated; a stored row is judged
// at its next save.
describe('runtime authoring gate on VIEW writes into a package — the closure verdict (#24563)', () => {
    const OWN = 'com.acme.crm';
    const DEP = 'com.acme.core';
    const STRANGER = 'com.other.analytics';
    const PLATFORM = 'com.objectstack.platform';
    const OUTSIDE = 'list-view-object-outside-closure';
    const FIELD_UNKNOWN = 'list-view-field-unknown';

    const object = (name: string, packageId: string) => ({
        name,
        label: name,
        _packageId: packageId,
        fields: [{ name: 'title', type: 'text', label: 'Title' }],
    });
    /** The card's body: a flattened list overlay bound to `bound`, one known and one unknown column by default. */
    const listView = (bound: string, columns: readonly string[] = ['title', 'zzz_nope']) => ({
        name: `${bound}.qavfy_r1`,
        object: bound,
        viewKind: 'list',
        label: 'r1',
        type: 'grid',
        data: { provider: 'object', object: bound },
        columns: columns.map((field) => ({ field })),
    });

    /** A registry holding three packages — the written one, the one it declares, a stranger — and a platform object. */
    function makePackagedProtocol() {
        const { engine, rows } = makeStubEngine();
        const packages: Record<string, { manifest: Record<string, unknown> }> = {
            [OWN]: { manifest: { name: OWN, version: '1.0.0', dependencies: { [DEP]: '^1.0.0' } } },
            [DEP]: { manifest: { name: DEP, version: '1.0.0' } },
            [STRANGER]: { manifest: { name: STRANGER, version: '1.0.0' } },
        };
        engine.registry.listItems = (type: string) =>
            type === 'object'
                ? [
                    object('crm_account', OWN),
                    object('core_user', DEP),
                    object('showcase_task', STRANGER),
                    object('sys_widget_log', PLATFORM),
                ]
                : [];
        engine.registry.getPackage = (id: string) => packages[id];
        const protocol = new ObjectStackProtocolImplementation(engine, () => new Map(), 'env_test') as any;
        return { protocol, rows };
    }

    const saveView = (protocol: any, item: { name: string }, extra: Record<string, unknown> = {}) =>
        protocol.saveMetaItem({ type: 'view', name: item.name, item, ...extra });
    const activeViewRows = (rows: Map<string, Row>) =>
        Array.from(rows.values()).filter((r) => r.type === 'view' && r.state === 'active');
    const rulesOf = (findings: any[] | undefined) => (findings ?? []).map((f: any) => f.rule);
    /** The one outside-closure refusal issue, with the shape the door returns. */
    const expectOutsideClosure = (issues: any[] | undefined) => {
        expect(rulesOf(issues), JSON.stringify(issues)).toEqual([OUTSIDE]);
        expect(issues![0]).toMatchObject({ severity: 'error', path: 'views[0].data.object' });
        // The fix names the remedy and the package it applies to.
        expect(issues![0].hint).toContain(OWN);
        expect(issues![0].hint).toContain('dependencies');
    };
    /** A refused publish-mode write: the 422 envelope, carrying the closure issue. */
    const expectRefusedOutsideClosure = (err: any, what: string) => {
        expect(err, `${what}: the write resolved — the door still accepts the out-of-closure binding`).toBeInstanceOf(Error);
        expect({ code: err.code, status: err.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
        expectOutsideClosure(err.issues);
    };

    let warn: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        delete process.env.OS_ALLOW_UNLINTED_METADATA_WRITES;
    });
    afterEach(() => {
        warn.mockRestore();
        delete process.env.OS_ALLOW_UNLINTED_METADATA_WRITES;
    });

    it('(a) REFUSES an active save bound to a package the written one never declared — 422 at the binding, nothing stored', async () => {
        const { protocol, rows } = makePackagedProtocol();

        const err = await saveView(protocol, listView('showcase_task'), { packageId: OWN }).catch((e: any) => e);

        expectRefusedOutsideClosure(err, 'stranger object');
        // A gate that refuses after persisting is a log line.
        expect(activeViewRows(rows)).toEqual([]);
    });

    it('(a) REFUSES an active save bound to an object that exists nowhere the same way', async () => {
        const { protocol, rows } = makePackagedProtocol();

        const err = await saveView(protocol, listView('nosuch_obj'), { packageId: OWN }).catch((e: any) => e);

        expectRefusedOutsideClosure(err, 'nosuch_obj');
        expect(activeViewRows(rows)).toEqual([]);
    });

    it('(a) a DRAFT save of the same body is not gated — the draft door stays open, its promotion is judged', async () => {
        const { protocol } = makePackagedProtocol();

        await expect(saveView(protocol, listView('showcase_task'), { packageId: OWN, mode: 'draft' }))
            .resolves.toMatchObject({ success: true });
    });

    it('(b) REFUSES an unknown `columns` field on an object inside the closure — own, declared dependency, platform', async () => {
        for (const bound of ['crm_account', 'core_user', 'sys_widget_log']) {
            const { protocol, rows } = makePackagedProtocol();

            const err = await saveView(protocol, listView(bound), { packageId: OWN }).catch((e: any) => e);

            expect(err, `${bound}: the save resolved — the field verdict was skipped`).toBeInstanceOf(Error);
            expect({ code: err.code, status: err.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
            expect(err.issues.map((i: any) => [i.rule, i.path])).toEqual([[FIELD_UNKNOWN, 'views[0].columns[1].field']]);
            expect(activeViewRows(rows)).toEqual([]);
        }
    });

    it('(b) admits a known `columns` field on an object inside the closure, with no advisory', async () => {
        for (const bound of ['crm_account', 'core_user', 'sys_widget_log']) {
            const { protocol, rows } = makePackagedProtocol();

            const result = await saveView(protocol, listView(bound, ['title']), { packageId: OWN });

            expect(result, bound).toMatchObject({ success: true });
            expect(rulesOf(result.advisories), bound).toEqual([]);
            expect(activeViewRows(rows)).toHaveLength(1);
        }
    });

    it('(c) a write that names no package gets no closure verdict — the overlay door refuses the stranger column, and nowhere as nowhere', async () => {
        const overlay = makePackagedProtocol();
        const err = await saveView(overlay.protocol, listView('showcase_task')).catch((e: any) => e);
        expect({ code: err?.code, status: err?.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
        expect(err.issues.map((i: any) => [i.rule, i.path])).toEqual([[FIELD_UNKNOWN, 'views[0].columns[1].field']]);
        expect(activeViewRows(overlay.rows)).toEqual([]);

        // [#24668] No closure, so no closure verdict: the binding is judged
        // against the whole collection and refused as existing nowhere (the
        // block below pins that door in full).
        const nowhere = makePackagedProtocol();
        const refused = await saveView(nowhere.protocol, listView('nosuch_obj')).catch((e: any) => e);
        expect({ code: refused?.code, status: refused?.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
        expect(rulesOf(refused.issues)).toEqual(['list-view-object-unknown']);
        expect(activeViewRows(nowhere.rows)).toEqual([]);
    });

    it('(d) the draft → active promotion refuses the out-of-closure binding, and the in-closure unknown field', async () => {
        const outside = makePackagedProtocol();
        await expect(saveView(outside.protocol, listView('showcase_task'), { packageId: OWN, mode: 'draft' }))
            .resolves.toMatchObject({ success: true });
        const promoted = await outside.protocol
            .publishMetaItem({ type: 'view', name: 'showcase_task.qavfy_r1', packageId: OWN })
            .catch((e: any) => e);
        expectRefusedOutsideClosure(promoted, 'promotion');
        expect(activeViewRows(outside.rows)).toEqual([]);

        const inside = makePackagedProtocol();
        await saveView(inside.protocol, listView('crm_account'), { packageId: OWN, mode: 'draft' });
        const err = await inside.protocol
            .publishMetaItem({ type: 'view', name: 'crm_account.qavfy_r1', packageId: OWN })
            .catch((e: any) => e);
        expect({ code: err?.code, status: err?.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
        expect(rulesOf(err.issues)).toEqual([FIELD_UNKNOWN]);
    });

    it('(e) a package draft publish refuses the out-of-closure binding, and the in-closure unknown field', async () => {
        const outside = makePackagedProtocol();
        await saveView(outside.protocol, listView('showcase_task'), { packageId: OWN, mode: 'draft' });
        const published = await outside.protocol.publishPackageDrafts({ packageId: OWN });
        expect(published).toMatchObject({ success: false, publishedCount: 0 });
        expect(published.failed[0]).toMatchObject({ name: 'showcase_task.qavfy_r1', code: 'INVALID_METADATA' });
        expectOutsideClosure(published.failed[0].issues);
        expect(activeViewRows(outside.rows)).toEqual([]);

        const inside = makePackagedProtocol();
        await saveView(inside.protocol, listView('crm_account'), { packageId: OWN, mode: 'draft' });
        const refused = await inside.protocol.publishPackageDrafts({ packageId: OWN });
        expect(refused).toMatchObject({ success: false, publishedCount: 0 });
        expect(refused.failed[0]).toMatchObject({ name: 'crm_account.qavfy_r1', code: 'INVALID_METADATA' });
        expect(rulesOf(refused.failed[0].issues)).toEqual([FIELD_UNKNOWN]);
    });

    it('(g) a stored view with the binding keeps loading; its next save into the package is refused, the row untouched', async () => {
        const { protocol, rows } = makePackagedProtocol();
        // Stored before the crossing, seeded straight into the store because the
        // save door now refuses this body.
        const stored = listView('showcase_task', ['title']);
        rows.set(keyOf({ type: 'view', name: stored.name, organization_id: null, state: 'active' }), {
            id: 'r_seed', type: 'view', name: stored.name, organization_id: null, state: 'active',
            metadata: JSON.stringify(stored),
        });

        // The boot path runs no authoring rule.
        await expect(protocol.loadMetaFromDb()).resolves.toMatchObject({ loaded: 1, errors: 0, invalid: 0 });

        // The next save is a write, and is judged.
        const err = await saveView(protocol, stored, { packageId: OWN }).catch((e: any) => e);
        expectRefusedOutsideClosure(err, 'next save of a stored row');
        expect(JSON.parse(activeViewRows(rows)[0]!.metadata)).toEqual(stored);
    });

    it('(f) a view bound to an object drafted in the SAME batch is inside the closure — no phantom refusal, its fields judged', async () => {
        const batchObject = {
            name: 'crm_ticket',
            label: 'Ticket',
            sharingModel: 'private',
            fields: { title: { type: 'text', label: 'Title' } },
        };

        const clean = makePackagedProtocol();
        await clean.protocol.saveMetaItem({ type: 'object', name: 'crm_ticket', item: batchObject, packageId: OWN, mode: 'draft' });
        await saveView(clean.protocol, listView('crm_ticket', ['title']), { packageId: OWN, mode: 'draft' });
        const res = await clean.protocol.publishPackageDrafts({ packageId: OWN });
        expect(res.failed).toEqual([]);
        expect(rulesOf(res.published.find((p: any) => p.name === 'crm_ticket.qavfy_r1')?.advisories)).not.toContain(OUTSIDE);

        const broken = makePackagedProtocol();
        await broken.protocol.saveMetaItem({ type: 'object', name: 'crm_ticket', item: batchObject, packageId: OWN, mode: 'draft' });
        await saveView(broken.protocol, listView('crm_ticket'), { packageId: OWN, mode: 'draft' });
        const refused = await broken.protocol.publishPackageDrafts({ packageId: OWN });
        const causal = refused.failed.find((f: any) => f.name === 'crm_ticket.qavfy_r1');
        expect(causal?.code).toBe('INVALID_METADATA');
        expect(rulesOf(causal.issues)).toEqual([FIELD_UNKNOWN]);
    });
});

// [#24668] The overlay twin of the block above: a list view written with NO
// package is judged against the WHOLE collection the host serves — every
// registry object (every package's and the platform's) folded with the stored
// rows — so a binding missing from it exists nowhere, and the real
// `saveMetaItem` refuses it `422 INVALID_METADATA` at the binding
// (`list-view-object-unknown`), with nothing stored. The verdict the closure
// door gives the same body (`list-view-object-outside-closure`) and the dataset
// door gives an unknown base object (`object-reference-unknown`). A binding
// that resolves — a package's object, a platform object, a stored overlay
// object — is admitted with its field verdict unchanged. Drafts are not gated;
// a stored row is judged at its next save.
describe('runtime authoring gate on VIEW writes that name no package — the whole-collection verdict (#24668)', () => {
    const OWN = 'com.acme.crm';
    const STRANGER = 'com.other.analytics';
    const PLATFORM = 'com.objectstack.platform';
    const UNKNOWN = 'list-view-object-unknown';
    const FIELD_UNKNOWN = 'list-view-field-unknown';

    const object = (name: string, packageId?: string) => ({
        name,
        label: name,
        ...(packageId === undefined ? {} : { _packageId: packageId }),
        fields: [{ name: 'title', type: 'text', label: 'Title' }],
    });
    /** The card's body: a flattened list overlay bound to `bound`, one known and by default one unknown column. */
    const listView = (bound: string, columns: readonly string[] = ['title', 'zzz_nope']) => ({
        name: `${bound}.qavfy_r1`,
        object: bound,
        viewKind: 'list',
        label: 'r1',
        type: 'grid',
        data: { provider: 'object', object: bound },
        columns: columns.map((field) => ({ field })),
    });

    /** A registry holding two packages' objects and a platform object; `tenant_ticket` lives only in the store. */
    function makeOverlayProtocol() {
        const { engine, rows } = makeStubEngine();
        const packages: Record<string, { manifest: Record<string, unknown> }> = {
            [OWN]: { manifest: { name: OWN, version: '1.0.0' } },
            [STRANGER]: { manifest: { name: STRANGER, version: '1.0.0' } },
        };
        engine.registry.listItems = (type: string) =>
            type === 'object'
                ? [object('crm_account', OWN), object('showcase_task', STRANGER), object('sys_widget_log', PLATFORM)]
                : [];
        engine.registry.getPackage = (id: string) => packages[id];
        // A tenant-authored object, stored and never registered: the gate's
        // universe is the registry FOLDED with the store, so it is there.
        rows.set(keyOf({ type: 'object', name: 'tenant_ticket', organization_id: null, state: 'active' }), {
            id: 'r_obj', type: 'object', name: 'tenant_ticket', organization_id: null, state: 'active',
            metadata: JSON.stringify({
                name: 'tenant_ticket',
                label: 'Tenant Ticket',
                sharingModel: 'private',
                fields: { title: { type: 'text', label: 'Title' } },
            }),
        });
        const protocol = new ObjectStackProtocolImplementation(engine, () => new Map(), 'env_test') as any;
        return { protocol, rows };
    }

    const saveView = (protocol: any, item: { name: string }, extra: Record<string, unknown> = {}) =>
        protocol.saveMetaItem({ type: 'view', name: item.name, item, ...extra });
    const activeViewRows = (rows: Map<string, Row>) =>
        Array.from(rows.values()).filter((r) => r.type === 'view' && r.state === 'active');
    const rulesOf = (findings: any[] | undefined) => (findings ?? []).map((f: any) => f.rule);
    /** A refused publish-mode write: the 422 envelope, carrying the one unknown-object issue at the binding. */
    const expectRefusedUnknown = (err: any, what: string) => {
        expect(err, `${what}: the write resolved — the overlay door still accepts a binding that exists nowhere`).toBeInstanceOf(Error);
        expect({ code: err.code, status: err.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
        expect(rulesOf(err.issues), JSON.stringify(err.issues)).toEqual([UNKNOWN]);
        expect(err.issues[0]).toMatchObject({ severity: 'error', path: 'views[0].data.object' });
        expect(err.issues[0].message).toContain('"nosuch_obj"');
    };

    let warn: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        delete process.env.OS_ALLOW_UNLINTED_METADATA_WRITES;
    });
    afterEach(() => {
        warn.mockRestore();
        delete process.env.OS_ALLOW_UNLINTED_METADATA_WRITES;
    });

    it('(a) REFUSES an active overlay save bound to an object that exists nowhere — 422 at the binding, nothing stored', async () => {
        const { protocol, rows } = makeOverlayProtocol();

        const err = await saveView(protocol, listView('nosuch_obj')).catch((e: any) => e);

        expectRefusedUnknown(err, 'overlay write');
        // A gate that refuses after persisting is a log line.
        expect(activeViewRows(rows)).toEqual([]);
    });

    it('(a) the control: a binding that resolves is admitted — package, stranger, platform and stored overlay objects', async () => {
        for (const bound of ['crm_account', 'showcase_task', 'sys_widget_log', 'tenant_ticket']) {
            const { protocol, rows } = makeOverlayProtocol();

            const result = await saveView(protocol, listView(bound, ['title']));

            expect(result, bound).toMatchObject({ success: true });
            expect(rulesOf(result.advisories), bound).toEqual([]);
            expect(activeViewRows(rows), bound).toHaveLength(1);
        }
    });

    it('(b) a binding that resolves keeps its field verdict: an unknown column is refused as before', async () => {
        for (const bound of ['crm_account', 'tenant_ticket']) {
            const { protocol, rows } = makeOverlayProtocol();

            const err = await saveView(protocol, listView(bound)).catch((e: any) => e);

            expect({ code: err?.code, status: err?.status }, bound).toEqual({ code: 'INVALID_METADATA', status: 422 });
            expect(err.issues.map((i: any) => [i.rule, i.path]), bound).toEqual([[FIELD_UNKNOWN, 'views[0].columns[1].field']]);
            expect(activeViewRows(rows), bound).toEqual([]);
        }
    });

    it('(c) a DRAFT save of the same body is not gated; its promotion is judged and refused', async () => {
        const { protocol, rows } = makeOverlayProtocol();

        await expect(saveView(protocol, listView('nosuch_obj'), { mode: 'draft' })).resolves.toMatchObject({ success: true });
        const promoted = await protocol
            .publishMetaItem({ type: 'view', name: 'nosuch_obj.qavfy_r1' })
            .catch((e: any) => e);

        expectRefusedUnknown(promoted, 'promotion');
        expect(activeViewRows(rows)).toEqual([]);
    });

    it('(d) a write naming a package the registry cannot produce narrows nothing — the whole-collection verdict', async () => {
        const { protocol, rows } = makeOverlayProtocol();

        const err = await saveView(protocol, listView('nosuch_obj'), { packageId: 'com.unregistered.pkg' }).catch((e: any) => e);

        expectRefusedUnknown(err, 'unresolvable package');
        expect(activeViewRows(rows)).toEqual([]);
    });

    it('(e) a stored view with the binding keeps loading; its next save is refused, the row untouched', async () => {
        const { protocol, rows } = makeOverlayProtocol();
        // Stored before the crossing, seeded straight into the store because the
        // save door now refuses this body.
        const stored = listView('nosuch_obj', ['title']);
        rows.set(keyOf({ type: 'view', name: stored.name, organization_id: null, state: 'active' }), {
            id: 'r_seed', type: 'view', name: stored.name, organization_id: null, state: 'active',
            metadata: JSON.stringify(stored),
        });

        // The boot path runs no authoring rule.
        await expect(protocol.loadMetaFromDb()).resolves.toMatchObject({ loaded: 2, errors: 0, invalid: 0 });

        // The next save is a write, and is judged.
        const err = await saveView(protocol, stored).catch((e: any) => e);
        expectRefusedUnknown(err, 'next save of a stored row');
        expect(JSON.parse(activeViewRows(rows)[0]!.metadata)).toEqual(stored);
    });
});

/**
 * [#24957] The object save door refuses a `validations[]` rule whose predicate
 * reads `parent`, as `os build` does.
 *
 * ObjectQL evaluates every `validations[]` predicate against `record` and
 * `previous` only; the master-detail header is bound as `parent` for a field's
 * own `readonlyWhen` / `requiredWhen` alone. Such a rule faults on every write
 * it judges and fails closed. #24720 reported it at `warning` (the door listed
 * it among its advisories and admitted the save); this card makes it the
 * refusal.
 *
 * The refusal is in `@objectstack/lint` (the validation pass's root verdict);
 * no code here moves. Pinned through the REAL `saveMetaItem`, the header stored
 * in the registry:
 *
 *  (a) the measured body is refused on an active save — a 422
 *      `INVALID_METADATA` carrying the build's located finding — and nothing
 *      lands;
 *  (b) the same body still saves as a DRAFT (drafts are never gated), and the
 *      draft's promotion and a package's draft publish are refused;
 *  (c) control: `parent` on the field's own `readonlyWhen` saves, and so does a
 *      rule reading `record`.
 *
 * ⚠️ As in the blocks above: this package reaches `@objectstack/lint` through
 * its built `dist/`, so an edit to the rule is invisible here until
 * `pnpm --filter @objectstack/lint build` has run.
 */
describe('runtime authoring gate on OBJECT writes — a validations[] predicate reading parent (#24957)', () => {
    const header = {
        name: 'fx_header',
        label: 'Header',
        sharingModel: 'private',
        fields: { name: { type: 'text', label: 'Name' }, status: { type: 'text', label: 'Status' } },
    };
    const line = (validations: unknown[], extraFields: Record<string, unknown> = {}) => ({
        name: 'fx_line',
        label: 'Line',
        sharingModel: 'private',
        fields: {
            hdr: { type: 'master_detail', label: 'Header', reference: 'fx_header' },
            amount: { type: 'number', label: 'Amount' },
            ...extraFields,
        },
        validations,
    });
    /** The measured body. */
    const PARENT = "parent.status == 'paid'";
    const rule = (condition: string) => ({ name: 'paid_lock', type: 'script', condition, message: 'Locked.' });
    /** Where the build locates it — the rule the author edits. */
    const WHERE = "object 'fx_line' · validation 'paid_lock'";

    const hostWithHeader = () => {
        const { engine, rows } = makeStubEngine();
        engine.registry.listItems = (type: string) => (type === 'object' ? [header] : []);
        const protocol = new ObjectStackProtocolImplementation(engine, () => new Map(), 'env_test') as any;
        return { protocol, rows };
    };
    const lineRows = (rows: Map<string, Row>) =>
        Array.from(rows.values()).filter((r) => r.type === 'object' && r.name === 'fx_line');
    const saveLine = (protocol: any, item: unknown, extra: Record<string, unknown> = {}) =>
        protocol.saveMetaItem({ type: 'object', name: 'fx_line', item, ...extra });

    it('(a) REFUSES an active save with a 422 carrying the build\'s located finding, and nothing lands', async () => {
        const { protocol, rows } = hostWithHeader();

        const err = await saveLine(protocol, line([rule(PARENT)])).catch((e: any) => e);

        expect(err, 'the save resolved — the door still admits the rule').toBeInstanceOf(Error);
        expect({ code: err.code, status: err.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
        const issues = err.issues.filter((i: any) => i.rule === EXPRESSION_INVALID);
        expect(issues, `issues: ${JSON.stringify(err.issues)}`).toHaveLength(1);
        expect(issues[0].path).toBe(WHERE);
        expect(issues[0].severity).toBe('error');
        expect(issues[0].message).toContain("validation rule 'paid_lock' reads `parent`");
        expect(lineRows(rows)).toEqual([]);

        // The door's issue IS the build's finding.
        const stack = { objects: [header, line([rule(PARENT)])] };
        const atBuild = runAuthoringRules('build', { normalized: stack, parsed: stack })
            .filter((f) => f.rule === EXPRESSION_INVALID);
        expect(atBuild).toHaveLength(1);
        for (const key of ['rule', 'where', 'path', 'message', 'severity'] as const) {
            expect(issues[0][key], `door and build disagree on '${key}'`).toBe(atBuild[0]![key]);
        }
    });

    it('(b) the same body still saves as a DRAFT, and its PROMOTION is refused', async () => {
        const { protocol, rows } = hostWithHeader();

        await expect(saveLine(protocol, line([rule(PARENT)]), { mode: 'draft' })).resolves.toMatchObject({ success: true });
        expect(lineRows(rows).map((r) => r.state)).toEqual(['draft']);

        const err = await protocol.publishMetaItem({ type: 'object', name: 'fx_line' }).catch((e: any) => e);

        expect({ code: err?.code, status: err?.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
        const issue = err.issues.find((i: any) => i.rule === EXPRESSION_INVALID);
        expect(issue, `issues: ${JSON.stringify(err.issues)}`).toBeDefined();
        expect(issue.path).toBe(WHERE);
        expect(lineRows(rows).map((r) => r.state)).toEqual(['draft']);
    });

    it("(b) a PACKAGE's draft publish of the same body is refused — nothing goes live", async () => {
        const { protocol, rows } = hostWithHeader();
        await expect(
            saveLine(protocol, line([rule(PARENT)]), { mode: 'draft', packageId: 'app.fx' }),
        ).resolves.toMatchObject({ success: true });

        const res = await protocol.publishPackageDrafts({ packageId: 'app.fx' });

        expect(res.outcome, JSON.stringify(res)).toBe('refused');
        expect(res.publishedCount).toBe(0);
        expect(res.failed).toEqual([expect.objectContaining({ type: 'object', name: 'fx_line', code: 'INVALID_METADATA' })]);
        expect(lineRows(rows).map((r) => r.state)).toEqual(['draft']);
    });

    it('(c) control: `parent` on the field\'s own `readonlyWhen`, and a rule reading `record`, save and land', async () => {
        for (const body of [
            line([], { note: { type: 'text', label: 'Note', readonlyWhen: PARENT } }),
            line([rule('record.amount != null && record.amount > 0')]),
        ]) {
            const { protocol, rows } = hostWithHeader();

            const result = await saveLine(protocol, body);

            expect(result.success, JSON.stringify(body)).toBe(true);
            expect(lineRows(rows).map((r) => r.state)).toEqual(['active']);
        }
    });
});

// #25205 — a list-view bulk action's `confirmText` is an ADR-0032 `template`
// slot over a closed scope (`count` and the def's params by name, #24798). A
// hole over an unbound root, a single-brace token, a hole holding logic and a
// blank sentence are refused at the runtime save door, as `os build` refuses
// them. #24798 shipped them as advisories (the door admitted the save and
// listed the finding); the amended 「甲」 (record 6303865025) ships the refusal
// in 18.x. Pinned through the REAL `saveMetaItem`:
//
//  (a) the active save is refused — 422 `INVALID_METADATA`, the door's own
//      envelope — naming the slot, and nothing lands; the draft promotion is
//      refused the same way;
//  (b) the door's finding IS the build's;
//  (c) control: the HotCRM sentence saves, and the row lands;
//  (d) the parse is not narrowed: a stored view carrying such a sentence (a
//      blank one included) keeps loading, and its next save is judged.
//
// ⚠️ As above: this package reaches `@objectstack/lint` through its built
// `dist/`, so a rule edit is invisible here until
// `pnpm --filter @objectstack/lint build` has run.
describe('runtime authoring gate on VIEW writes — a bulk confirmText template hole (#25205)', () => {
    const NAME = 'crm_account';
    const UNBOUND = 'Move {{count}} account(s) to {{ owner }}?';
    const HOTCRM = 'Update tier on {{count}} account(s) to {{tier}}?';
    const view = (confirmText: string) => ({
        name: NAME,
        object: NAME,
        list: {
            type: 'grid',
            columns: ['name'],
            bulkActionDefs: [{
                name: 'update_tier',
                label: 'Update Tier',
                operation: 'update',
                params: [{ name: 'tier', type: 'select', options: [{ label: 'Gold', value: 'gold' }] }],
                confirmText,
            }],
        },
    });
    const account = { name: NAME, label: 'Account', fields: { name: { type: 'text', label: 'Name' } } };

    function viewProtocol() {
        const { engine, rows } = makeStubEngine();
        engine.registry.listItems = (type: string) => (type === 'object' ? [account] : []);
        const protocol = new ObjectStackProtocolImplementation(engine, () => new Map(), 'env_test') as any;
        return { protocol, rows };
    }
    const saveView = (protocol: any, item: unknown, extra: Record<string, unknown> = {}) =>
        protocol.saveMetaItem({ type: 'view', name: NAME, item, ...extra });
    const activeViewRows = (rows: Map<string, Row>) =>
        Array.from(rows.values()).filter((r) => r.type === 'view' && r.state === 'active');
    const confirmIssues = (issues: any[] | undefined) =>
        (issues ?? []).filter((i: any) => String(i.where).includes('confirmText'));

    let warn: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        delete process.env.OS_ALLOW_UNLINTED_METADATA_WRITES;
    });
    afterEach(() => {
        warn.mockRestore();
        delete process.env.OS_ALLOW_UNLINTED_METADATA_WRITES;
    });

    for (const [label, text] of [
        ['a hole over an unbound root', UNBOUND],
        ['a single-brace token', 'Update {count} account(s)?'],
        ['a hole holding logic', '{{ count * 2 }} account(s)?'],
        ['a blank sentence', ''],
    ] as const) {
        it(`(a) REFUSES an active save of ${label}; nothing stored`, async () => {
            const { protocol, rows } = viewProtocol();

            const err = await saveView(protocol, view(text)).catch((e: any) => e);

            expect(err, 'the save resolved — the door still admits the sentence').toBeInstanceOf(Error);
            expect({ code: err.code, status: err.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
            const issues = confirmIssues(err.issues);
            expect(issues, `issues: ${JSON.stringify(err.issues)}`).toHaveLength(1);
            expect(issues[0]).toMatchObject({ rule: EXPRESSION_INVALID, severity: 'error' });
            expect(activeViewRows(rows)).toEqual([]);
        });
    }

    it('(a) gates the draft → active promotion of the same view', async () => {
        const { protocol, rows } = viewProtocol();
        await expect(saveView(protocol, view(UNBOUND), { mode: 'draft' })).resolves.toMatchObject({ success: true });

        const err = await protocol.publishMetaItem({ type: 'view', name: NAME }).catch((e: any) => e);

        expect({ code: err?.code, status: err?.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
        expect(confirmIssues(err.issues)).toHaveLength(1);
        expect(activeViewRows(rows)).toEqual([]);
    });

    it('(b) the door and `os build` give the SAME finding', async () => {
        const { protocol } = viewProtocol();
        const err = await saveView(protocol, view(UNBOUND)).catch((e: any) => e);
        const atDoor = confirmIssues(err?.issues);

        const stack = { objects: [account], views: [view(UNBOUND)] };
        const atBuild = confirmIssues(runAuthoringRules('build', { normalized: stack, parsed: stack })
            .filter((f) => f.severity === 'error'));

        expect(atBuild).toHaveLength(1);
        expect(atDoor).toHaveLength(1);
        for (const k of ['rule', 'where', 'message'] as const) {
            expect(atDoor[0][k], `door and build disagree on '${k}'`).toBe(atBuild[0]![k]);
        }
    });

    it('(c) CONTROL — the HotCRM sentence saves, and the row lands', async () => {
        const { protocol, rows } = viewProtocol();

        const res = await saveView(protocol, view(HOTCRM));

        expect(res).toMatchObject({ success: true });
        expect(confirmIssues(res.advisories)).toEqual([]);
        expect(activeViewRows(rows)).toHaveLength(1);
    });

    for (const [label, text] of [['an unbound hole', UNBOUND], ['a blank sentence', '']] as const) {
        it(`(d) a stored view with ${label} keeps loading; its next save is refused, the row untouched`, async () => {
            const { protocol, rows } = viewProtocol();
            // Stored before the crossing, seeded straight into the store because
            // the save door now refuses this body.
            const stored = view(text);
            rows.set(keyOf({ type: 'view', name: NAME, organization_id: null, state: 'active' }), {
                id: 'r_seed', type: 'view', name: NAME, organization_id: null, state: 'active',
                metadata: JSON.stringify(stored),
            });

            // The boot path runs no authoring rule, and the parse still accepts the text.
            await expect(protocol.loadMetaFromDb()).resolves.toMatchObject({ loaded: 1, errors: 0, invalid: 0 });

            const err = await saveView(protocol, stored).catch((e: any) => e);
            expect({ code: err?.code, status: err?.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
            expect(JSON.parse(activeViewRows(rows)[0]!.metadata)).toEqual(stored);
        });
    }
});

// #25680 — an action's person-facing copy (`confirmText`, `successMessage`,
// `errorMessage` on a page action row; `confirmText` / `successMessage` on a
// registered action) is an ADR-0032 `template` slot over the roots the
// console's runner binds (#24814). #24814 shipped its findings as advisories;
// this card refuses them at the runtime save door, as `os build` refuses them,
// and #25709 refuses the last one too: a `${…}` token in a sentence with no
// `{{ }}` hole, which the runner now shows as written. Pinned through the REAL
// `saveMetaItem`:
//
//  (a) an active page save carrying a refused sentence is refused — 422
//      `INVALID_METADATA` — naming the slot, and nothing lands; an action
//      write is refused the same way; the draft promotion is refused too;
//  (b) the door's finding IS the build's;
//  (c) the holeless `${record.*}` sentence is refused the same way, with no
//      advisory left for it;
//  (d) the parse is not narrowed: a stored page carrying a blank or an
//      unbound sentence keeps loading, and its next save is judged.
//
// ⚠️ As above: this package reaches `@objectstack/lint` through its built
// `dist/`, so a rule edit is invisible here until
// `pnpm --filter @objectstack/lint build` has run.
describe('runtime authoring gate on PAGE and ACTION writes — an action\'s copy template (#25680)', () => {
    const NAME = 'deals_home';
    const UNBOUND = 'Delete {{ result.name }}?';
    const page = (confirmText: string) => ({
        name: NAME,
        label: 'Deals',
        type: 'app',
        regions: [{ name: 'main', components: [
            { type: 'action:button', properties: { label: 'Run', actionType: 'script', target: 'run', confirmText } },
        ] }],
    });
    const savePage = (protocol: any, item: unknown, extra: Record<string, unknown> = {}) =>
        protocol.saveMetaItem({ type: 'page', name: NAME, item, ...extra });
    const activePageRows = (rows: Map<string, Row>) =>
        Array.from(rows.values()).filter((r) => r.type === 'page' && r.state === 'active');
    const copyIssues = (issues: any[] | undefined) =>
        (issues ?? []).filter((i: any) => /confirmText|successMessage|errorMessage/.test(String(i.where)));

    let warn: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        delete process.env.OS_ALLOW_UNLINTED_METADATA_WRITES;
    });
    afterEach(() => {
        warn.mockRestore();
        delete process.env.OS_ALLOW_UNLINTED_METADATA_WRITES;
    });

    for (const [label, text] of [
        ['a hole over an unbound root', UNBOUND],
        ['a single-brace token', 'Delete {record.name}?'],
        ['a hole holding logic', 'Delete {{ record.count * 2 }}?'],
        ['a blank sentence', ''],
    ] as const) {
        it(`(a) REFUSES an active page save of ${label}; nothing stored`, async () => {
            const { protocol, rows } = makeProtocol();

            const err = await savePage(protocol, page(text)).catch((e: any) => e);

            expect(err, 'the save resolved — the door still admits the sentence').toBeInstanceOf(Error);
            expect({ code: err.code, status: err.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
            const issues = copyIssues(err.issues);
            expect(issues, `issues: ${JSON.stringify(err.issues)}`).toHaveLength(1);
            expect(issues[0]).toMatchObject({ rule: EXPRESSION_INVALID, severity: 'error' });
            expect(activePageRows(rows)).toEqual([]);
        });
    }

    it('(a) REFUSES an active action save whose successMessage names an unbound root', async () => {
        const { protocol, rows } = makeProtocol();
        const action = { name: 'invite', label: 'Invite', type: 'api', target: '/api/v1/invite', successMessage: 'Sent to {{ owner.email }}' };

        const err = await protocol.saveMetaItem({ type: 'action', name: 'invite', item: action }).catch((e: any) => e);

        expect({ code: err?.code, status: err?.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
        expect(copyIssues(err.issues)).toHaveLength(1);
        expect(Array.from(rows.values()).filter((r) => r.type === 'action' && r.state === 'active')).toEqual([]);
    });

    it('(a) gates the draft → active promotion of the same page', async () => {
        const { protocol, rows } = makeProtocol();
        await expect(savePage(protocol, page(UNBOUND), { mode: 'draft' })).resolves.toMatchObject({ success: true });

        const err = await protocol.publishMetaItem({ type: 'page', name: NAME }).catch((e: any) => e);

        expect({ code: err?.code, status: err?.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
        expect(copyIssues(err.issues)).toHaveLength(1);
        expect(activePageRows(rows)).toEqual([]);
    });

    it('(b) the door and `os build` give the SAME finding', async () => {
        const { protocol } = makeProtocol();
        const err = await savePage(protocol, page(UNBOUND)).catch((e: any) => e);
        const atDoor = copyIssues(err?.issues);

        const stack = { pages: [page(UNBOUND)] };
        const atBuild = copyIssues(runAuthoringRules('build', { normalized: stack, parsed: stack })
            .filter((f) => f.severity === 'error'));

        expect(atBuild).toHaveLength(1);
        expect(atDoor).toHaveLength(1);
        for (const k of ['rule', 'where', 'message'] as const) {
            expect(atDoor[0][k], `door and build disagree on '${k}'`).toBe(atBuild[0]![k]);
        }
    });

    it('(c) REFUSES the holeless `${record.*}` sentence the runner shows as written — 422, prescribing its hole; nothing stored', async () => {
        const { protocol, rows } = makeProtocol();

        const err = await savePage(protocol, page('Delete ${record.name}?')).catch((e: any) => e);

        expect(err, 'the save resolved — the door still admits the holeless `${…}` sentence').toBeInstanceOf(Error);
        expect({ code: err.code, status: err.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
        const issues = copyIssues(err.issues);
        expect(issues, `issues: ${JSON.stringify(err.issues)}`).toHaveLength(1);
        expect(issues[0]).toMatchObject({ rule: EXPRESSION_INVALID, severity: 'error' });
        expect(issues[0].message).toContain('as `Delete {{ record.name }}?`');
        expect(activePageRows(rows)).toEqual([]);
    });

    for (const [label, text] of [['an unbound hole', UNBOUND], ['a blank sentence', '']] as const) {
        it(`(d) a stored page with ${label} keeps loading; its next save is refused, the row untouched`, async () => {
            const { protocol, rows } = makeProtocol();
            // Stored before the crossing, seeded straight into the store because
            // the save door now refuses this body.
            const stored = page(text);
            rows.set(keyOf({ type: 'page', name: NAME, organization_id: null, state: 'active' }), {
                id: 'r_seed', type: 'page', name: NAME, organization_id: null, state: 'active',
                metadata: JSON.stringify(stored),
            });

            // The boot path runs no authoring rule, and the parse still accepts the text.
            await expect(protocol.loadMetaFromDb()).resolves.toMatchObject({ loaded: 1, errors: 0, invalid: 0 });

            const err = await savePage(protocol, stored).catch((e: any) => e);
            expect({ code: err?.code, status: err?.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
            expect(JSON.parse(activePageRows(rows)[0]!.metadata)).toEqual(stored);
        });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// #25234 refusal 12 — the HOST fact the door judges membership-key ownership
// with. `assertRuntimeAuthoringRules` reads the registered membership
// resolver's `keys` per publish (`RLS_MEMBERSHIP_RESOLVER_SERVICE`), `[]` when
// none is registered; with that list the gate refuses a policy reading
// `current_user.KEY` as a set that no kernel key, declaration or resolver owns.
// Without a readable list (no registry, or a resolver whose `keys` is not a
// string list) the door judges no ownership, as the CLI does.
// ─────────────────────────────────────────────────────────────────────────────

describe('runtime authoring gate on PERMISSION writes — membership-key ownership (#25234)', () => {
    let warn: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        delete process.env.OS_ALLOW_UNLINTED_METADATA_WRITES;
    });
    afterEach(() => {
        warn.mockRestore();
        delete process.env.OS_ALLOW_UNLINTED_METADATA_WRITES;
    });

    const policySet = () => ({
        name: 'portal_team',
        label: 'Portal Team',
        objects: { leave_request: { allowRead: true, readScope: 'own' } },
        rowLevelSecurity: [
            { name: 'portal_rows', object: 'leave_request', operation: 'select', using: 'owner in current_user.portal_ids' },
        ],
    });

    const publish = (services: (() => Map<string, any>) | undefined) => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine, services as any, 'env_test') as any;
        const saved = protocol
            .saveMetaItem({ type: 'permission', name: 'portal_team', item: policySet() })
            .then((r: unknown) => ({ result: r, err: null }), (e: unknown) => ({ result: null, err: e }));
        return { rows, saved };
    };
    const permissionRows = (rows: Map<string, Row>) =>
        Array.from(rows.values()).filter((r) => r.type === 'permission');

    it('no resolver registered: a key nothing owns is refused, and nothing is written', async () => {
        const { rows, saved } = publish(() => new Map());
        const { err } = await saved;
        expect({ code: (err as any)?.code, status: (err as any)?.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
        const issues = (err as { issues: Array<{ rule: string; path: string; message: string }> }).issues;
        expect(issues.map((i) => ({ rule: i.rule, path: i.path }))).toEqual([
            { rule: 'rls-predicate-unknown-user-variable', path: 'permissions.portal_team.rowLevelSecurity[0].using' },
        ]);
        expect(issues[0]!.message).toContain('current_user.portal_ids');
        expect(permissionRows(rows)).toHaveLength(0);
    });

    it('a registered resolver that owns the key: the same policy publishes', async () => {
        const { rows, saved } = publish(
            () => new Map([[RLS_MEMBERSHIP_RESOLVER_SERVICE, { keys: ['portal_ids'], resolve: async () => ({}) }]]),
        );
        const { result, err } = await saved;
        expect(err).toBeNull();
        expect((result as { success: boolean }).success).toBe(true);
        expect(permissionRows(rows)).toHaveLength(1);
    });

    it('a resolver owning OTHER keys does not own this one', async () => {
        const { saved } = publish(
            () => new Map([[RLS_MEMBERSHIP_RESOLVER_SERVICE, { keys: ['team_ids'], resolve: async () => ({}) }]]),
        );
        const { err } = await saved;
        expect((err as { issues: Array<{ rule: string }> }).issues.map((i) => i.rule)).toEqual([
            'rls-predicate-unknown-user-variable',
        ]);
    });

    it('no readable ownership fact (no registry, or unreadable `keys`): no ownership is judged', async () => {
        for (const services of [
            undefined,
            () => new Map([[RLS_MEMBERSHIP_RESOLVER_SERVICE, { resolve: async () => ({}) }]]),
            () => new Map([[RLS_MEMBERSHIP_RESOLVER_SERVICE, { keys: [42] }]]),
        ]) {
            const { rows, saved } = publish(services);
            const { result, err } = await saved;
            expect(err).toBeNull();
            expect((result as { success: boolean }).success).toBe(true);
            expect(permissionRows(rows)).toHaveLength(1);
        }
    });
});

// #25650 — ruling C on #25572: a form open to anonymous intake that declares a
// file field is refused at publish. `validatePublicFormFileFields` declares
// `runtimeTypes: ['view']`, and a view write's snapshot carries the live
// `objects`, so the field's type resolves at this door exactly as it does at
// `os build`. The lint-level pins (every shape, every file type, the switches)
// are `@objectstack/lint`'s `validate-public-form-file-fields.test.ts`.
//
// ⚠️ This package reaches `@objectstack/lint` through its built `dist/`, so a
// registry edit is invisible here until `pnpm --filter @objectstack/lint build`
// has run.
describe('runtime authoring gate on VIEW writes — a public form declaring a file field (#25650)', () => {
    const NAME = 'supplier_application';
    const RULE = 'public-form-file-field';
    /** A container whose `formViews.apply` is open to anonymous intake. */
    const container = (fields: unknown[]) => ({
        list: { type: 'grid', data: { provider: 'object', object: NAME }, columns: [{ field: 'company' }] },
        formViews: {
            apply: {
                type: 'simple',
                data: { provider: 'object', object: NAME },
                sections: [{ name: 'about', fields }],
                sharing: { enabled: true, allowAnonymous: true, publicLink: '/forms/apply' },
            },
        },
    });
    const withCertificate = () => container([{ field: 'company' }, { field: 'email' }, { field: 'certificate' }]);
    const withoutCertificate = () => container([{ field: 'company' }, { field: 'email' }]);
    const supplier = {
        name: NAME,
        label: 'Supplier application',
        tenancy: { enabled: false },
        fields: {
            company: { type: 'text', label: 'Company' },
            email: { type: 'email', label: 'Email' },
            certificate: { type: 'file', label: 'Certificate' },
        },
    };

    function viewProtocol() {
        const { engine, rows } = makeStubEngine();
        engine.registry.listItems = (type: string) => (type === 'object' ? [supplier] : []);
        const protocol = new ObjectStackProtocolImplementation(engine, () => new Map(), 'env_test') as any;
        return { protocol, rows };
    }
    const saveView = (protocol: any, item: unknown, extra: Record<string, unknown> = {}) =>
        protocol.saveMetaItem({ type: 'view', name: NAME, item, ...extra });
    const activeViewRows = (rows: Map<string, Row>) =>
        Array.from(rows.values()).filter((r) => r.type === 'view' && r.state === 'active');

    let warn: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        delete process.env.OS_ALLOW_UNLINTED_METADATA_WRITES;
    });
    afterEach(() => {
        warn.mockRestore();
        delete process.env.OS_ALLOW_UNLINTED_METADATA_WRITES;
    });

    it('(a) REFUSES an active save naming the file field at its entry; nothing stored', async () => {
        const { protocol, rows } = viewProtocol();

        const err = await saveView(protocol, withCertificate()).catch((e: any) => e);

        expect(err, 'the save resolved — the door still publishes the file field').toBeInstanceOf(Error);
        expect({ code: err.code, status: err.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
        const issues = (err.issues ?? []).filter((i: any) => i.rule === RULE);
        expect(issues, `issues: ${JSON.stringify(err.issues)}`).toHaveLength(1);
        expect(issues[0].severity).toBe('error');
        expect(issues[0].path).toContain('formViews.apply.sections[0].fields[2]');
        expect(issues[0].message).toContain('"certificate"');
        expect(activeViewRows(rows)).toEqual([]);
    });

    it('(a) gates the draft → active promotion, so the draft door is no bypass', async () => {
        const { protocol } = viewProtocol();
        await expect(saveView(protocol, withCertificate(), { mode: 'draft' })).resolves.toMatchObject({ success: true });

        const err = await protocol.publishMetaItem({ type: 'view', name: NAME }).catch((e: any) => e);

        expect({ code: err?.code, status: err?.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
        expect(err.issues.map((i: any) => i.rule)).toContain(RULE);
    });

    it('(b) the door and `os build` give the same finding', async () => {
        const { protocol } = viewProtocol();
        const err = await saveView(protocol, withCertificate()).catch((e: any) => e);
        const atDoor = (err.issues ?? []).filter((i: any) => i.rule === RULE);

        const stack = { objects: [supplier], views: [{ name: NAME, ...withCertificate() }] };
        const atBuild = runAuthoringRules('build', { normalized: stack, parsed: stack }).filter((f) => f.rule === RULE);

        expect(atBuild).toHaveLength(1);
        expect(atDoor).toHaveLength(1);
        expect(atDoor[0].message).toBe(atBuild[0]!.message);
        expect(atDoor[0].hint).toBe(atBuild[0]!.hint);
    });

    it('(c) the same form without the file field saves', async () => {
        const { protocol, rows } = viewProtocol();
        await expect(saveView(protocol, withoutCertificate())).resolves.toMatchObject({ success: true });
        expect(activeViewRows(rows)).toHaveLength(1);
    });
});
