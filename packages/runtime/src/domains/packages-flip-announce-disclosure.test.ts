// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8516 — the two remaining undeclared-driver-text fields on the publish-drafts
 * 200 body: `unhideError` (the ADR-0045 visibility flip) and `rebindError` (the
 * `metadata:reloaded` announce).
 *
 * Same response, same rule, same argument as #8443's `seedApplied` next door:
 * both fields ride a **200** as DATA, and every 5xx message withhold in the
 * stack reads a *thrown* error's message — none of them can see a field on a
 * successful body. So every case here asserts the CONTENTS of that 200, never a
 * status code and never that something threw.
 *
 * ## The defect, as measured on `origin/main` BEFORE the change
 *
 * The card was explicit that both sites were read from source, not reproduced —
 * found by grepping for the string shape #8443's site used. They were driven
 * for real first, through `HttpDispatcher.handlePackages`:
 *
 * | # | injection | pre-change field |
 * |:--|:--|:--|
 * | B | `getMetaItems` throws (the flip's app read) | `unhideError: "SQLITE_ERROR: no such table: sys_metadata"` |
 * | C | `saveMetaItem` throws on app 2 of 2 | the same text, beside `unhiddenApps: ["crm"]` |
 * | E | a subscriber throws on the announce | `rebindError: "TypeError: … at AutomationPlugin.rebind (/srv/objectstack/…/dist/index.js:412:31)"` |
 * | D | a DECLARED 403 refusal on `saveMetaItem` | the authored sentence, verbatim — correct, and must stay |
 * | F | a DECLARED 422 refusal on the announce | likewise |
 *
 * E is the worse of the two disclosures and the one no boundary could ever have
 * caught: an internal stack frame plus a server filesystem path, handed to
 * whoever pressed Publish.
 *
 * ## Both halves of the rule, because the two sites started in different states
 *
 * ADR-0112 is "quote only what declared a 4xx client refusal, and send the
 * original to the log" — one rule with two halves. `unhideError`'s block
 * already logged its cause in full at `error` (a durability seam: `saveMetaItem`
 * is in the `check:durability-log-level` vocabulary), so only the payload half
 * was open there and the log is left untouched. `rebindError` had **no log
 * line at all**, so withholding alone would have converted an over-disclosure
 * into a silent failure — strictly worse. Section 2 pins both halves so neither
 * can be dropped later.
 *
 * That new line is `warn`, not `error`, on three independent grounds: nothing
 * here claimed to persist and did not (the drafts are published, the flip is
 * stored — what is lost is an in-memory re-sync); AGENTS.md's worked example of
 * a FUNCTIONAL degradation is verbatim "a trigger is not armed"; and the
 * sibling announce of this same event (`MetadataPlugin._reloadAndAnnounce`)
 * already logs it at `warn`.
 *
 * ## The authored population — measured, not assumed
 *
 * The question that decided the shape of #8333 and #8443: does either catch
 * receive an **authored** population that declares nothing and would be blanked?
 *
 *  - `unhideError`: **yes, and it declares.** `saveMetaItem`'s refusals all
 *    carry 4xx (`NOT_OVERRIDABLE`/403, `ITEM_LOCKED`/403,
 *    `OBJECT_OVERLAY_PACKAGE_MISMATCH`/422, …), so the withhold blanks none of
 *    them — case D.
 *  - `rebindError`: **no.** `context.trigger` dispatch is PROPAGATING, and every
 *    subscriber of `metadata:reloaded` is platform code doing internal re-sync
 *    (`resyncFlowsFromProtocol`, `resyncAuthoredHooks`/`…Actions`,
 *    `ingestReloadedObjects`, the authored translation sync). What arrives is
 *    internal text an author cannot act on. Case F is the bound anyway: if a
 *    subscriber ever does declare 4xx, the positive list quotes it, with no
 *    change here.
 *
 * ## Reverse verification — direction predicted BEFORE running
 *
 * Variant 1, `domains/packages.ts` reverted to `origin/main`:
 *  - RED: section 1's three withholds (B, C, E) and section 2's rebind log,
 *    which does not exist on `main` = 4.
 *  - GREEN IN BOTH DIRECTIONS: section 0 (the positive control — it proves the
 *    injections sit on the live path, and the live path is not what changed),
 *    section 2's unhide log (already there, and must stay), and section 3's two
 *    guards (a declared refusal is quoted before and after) = 4.
 *  Predicted 4 failed | 4 passed. Measured 4 failed | 4 passed.
 *
 * Variant 2, both call sites forced to withhold unconditionally (the "withhold
 * everything" shortcut this file must not accept):
 *  - RED: section 3's two guards, and nothing else = 2.
 *  Predicted 2 failed | 6 passed. Measured 2 failed | 6 passed.
 *
 * Both predictions held. Without section 3 this file would be satisfied by
 * blanking every message, which deletes the #4277 self-correcting refusals the
 * positive list exists to preserve.
 *
 * ⛔ Never a bare `toThrow()` here: this door does not throw, it REPORTS, and
 * the whole defect is what the report says.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpDispatcher } from '../http-dispatcher.js';

/** The sqlite phrasing of "`sys_metadata` is not there" — a bare driver `Error`. */
const DRIVER_TEXT = 'SQLITE_ERROR: no such table: sys_metadata';

/**
 * What a `metadata:reloaded` subscriber actually throws: an internal stack
 * frame carrying a server filesystem path and the shipped module layout. The
 * shape matters more than the wording — there is no version of this sentence a
 * publishing author could act on.
 */
const SUBSCRIBER_TEXT =
    "TypeError: Cannot read properties of undefined (reading 'triggers') "
    + 'at AutomationPlugin.rebind (/srv/objectstack/packages/services/service-automation/dist/index.js:412:31)';

/** Fragments that must never appear anywhere in a client-facing payload. */
const LEAKED_FRAGMENTS = [
    'SQLITE_ERROR', 'no such table', 'sys_metadata',
    'TypeError', '/srv/objectstack', 'dist/index.js', 'AutomationPlugin',
];

/** The whole 200 body, the way the door ships it. */
function expectNothingLeaked(payload: unknown): void {
    const wire = JSON.stringify(payload) ?? '';
    for (const fragment of LEAKED_FRAGMENTS) expect(wire).not.toContain(fragment);
}

/**
 * [#7033 / #7023] `/packages` carries an anonymous-deny floor plus per-route
 * capability predicates; every state-changing route demands `manage_metadata`.
 * Without a caller these cases would stop at the 401 before reaching the
 * behaviour they are named after.
 */
const PKG_ADMIN = () => ({
    request: {},
    executionContext: {
        userId: 'u_pkg_admin',
        systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'],
    },
}) as any;

/** A self-correcting refusal `saveMetaItem` really raises — DECLARED 403. */
const DECLARED_FLIP_REFUSAL = () => {
    const e: any = new Error('[item_locked] app "ops" is locked by another publish');
    e.code = 'ITEM_LOCKED';
    e.status = 403;
    return e;
};

/**
 * A subscriber refusal that DOES declare 4xx. No shipped subscriber mints one
 * today (measured above), which is exactly why it is here: the rule must keep
 * quoting a declared refusal without this file being edited the day one appears.
 */
const DECLARED_ANNOUNCE_REFUSAL = () => {
    const e: any = new Error('[flow_invalid] flow "nightly_rollup" declares an unknown trigger object "projeckt"');
    e.code = 'FLOW_INVALID';
    e.status = 422;
    return e;
};

/**
 * The door with a protocol that self-applies seeds (`seedApplied` already set),
 * so this file exercises the flip and the announce and nothing else — #8443
 * owns the seed path. The engine, metadata service and protocol are doubled;
 * the flip loop, the announce and the response assembly under test are shipping
 * code.
 */
function makeDoor(opts: {
    failGetMetaItems?: boolean;
    failSaveMetaItem?: boolean;
    refusalOnSaveMetaItem?: boolean;
    failTrigger?: boolean;
    refusalOnTrigger?: boolean;
} = {}) {
    const publishPackageDrafts = vi.fn().mockResolvedValue({
        success: true, publishedCount: 1, failedCount: 0,
        published: [{ type: 'flow', name: 'nightly_rollup', version: 'h' }], failed: [],
        seedApplied: { success: true, inserted: 0 },
    });
    const apps = [
        { name: 'crm', label: 'CRM', _unpublished: true },
        { name: 'ops', label: 'Ops', _unpublished: true },
    ];
    const getMetaItems = vi.fn().mockImplementation(async () => {
        if (opts.failGetMetaItems) throw new Error(DRIVER_TEXT);
        return { items: apps.map((a) => ({ ...a })) };
    });
    // Fails on app 2 of 2, so the failure is measured MID-LOOP: #5242's split
    // report (`unhiddenApps` naming what did persist) must survive the withhold.
    let saves = 0;
    const saveMetaItem = vi.fn().mockImplementation(async () => {
        saves += 1;
        if (saves === 2) {
            if (opts.refusalOnSaveMetaItem) throw DECLARED_FLIP_REFUSAL();
            if (opts.failSaveMetaItem) throw new Error(DRIVER_TEXT);
        }
        return { ok: true };
    });
    const trigger = vi.fn().mockImplementation(async () => {
        if (opts.failTrigger) throw new Error(SUBSCRIBER_TEXT);
        if (opts.refusalOnTrigger) throw DECLARED_ANNOUNCE_REFUSAL();
    });

    const kernel: any = {
        getService: (name: string) => {
            if (name === 'protocol') {
                return Promise.resolve({ publishPackageDrafts, getMetaItems, saveMetaItem });
            }
            if (name === 'objectql') {
                return Promise.resolve({
                    insert: vi.fn(), find: vi.fn(), update: vi.fn(),
                    registry: { getAllPackages: vi.fn().mockReturnValue([]) },
                });
            }
            if (name === 'metadata') return Promise.resolve({ getObject: vi.fn() });
            return null;
        },
        // `announceKernelEvent` calls exactly this. Dispatch is PROPAGATING
        // (#5170 / #5282) — a subscriber's throw reaches the door unwrapped,
        // which is what makes `rebindError` reachable at all.
        context: { getService: () => null, trigger },
    };
    return { dispatcher: new HttpDispatcher(kernel), getMetaItems, saveMetaItem, trigger };
}

async function publishDrafts(opts: Parameters<typeof makeDoor>[0] = {}) {
    const door = makeDoor(opts);
    const result = await door.dispatcher.handlePackages(
        '/com.workspace/publish-drafts', 'POST', {}, {}, PKG_ADMIN(),
    );
    // The fields under test are DATA on a success body — assert that framing
    // once here so every case below reads as "what the 200 said".
    expect(result.response?.status).toBe(200);
    const body: any = (result.response as any)?.body;
    return { ...door, body, data: body?.data };
}

// The door resolves `deps.logger ?? console`, and `HttpDispatcher` sets no
// logger — so the server-side half of the rule lands on `console`.
const spyLogs = () => ({
    warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
    error: vi.spyOn(console, 'error').mockImplementation(() => {}),
});
afterEach(() => vi.restoreAllMocks());

// ---------------------------------------------------------------------------
// Section 0 — the positive control
// ---------------------------------------------------------------------------

describe('#8516 · 0 · the flip and the announce really run (positive control)', () => {
    it('a healthy publish flips both apps and announces them', async () => {
        const { data, saveMetaItem, trigger } = await publishDrafts();

        // Both injections below perturb a path that genuinely runs — without
        // this, "no driver text" is indistinguishable from "nothing happened".
        expect(saveMetaItem).toHaveBeenCalledTimes(2);
        expect(data?.unhiddenApps).toEqual(['crm', 'ops']);
        expect(trigger).toHaveBeenCalledWith('metadata:reloaded', {
            changed: ['flow/nightly_rollup', 'app/crm', 'app/ops'],
        });
        expect(data?.unhideError).toBeUndefined();
        expect(data?.rebindError).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// Section 1 — the withhold, at both fields
// ---------------------------------------------------------------------------

describe('#8516 · 1 · undeclared driver/subscriber text never rides the 200', () => {
    it('B · unhideError — a driver failure reading the package apps', async () => {
        spyLogs();
        const { data, body, getMetaItems } = await publishDrafts({ failGetMetaItems: true });

        expect(getMetaItems).toHaveBeenCalled();
        // Withholding must not turn into silence: the caller is still told the
        // flip failed, just not with the driver's sentence.
        expect(data?.unhideError).toBe('visibility flip failed');
        expectNothingLeaked(body);
    });

    it('C · unhideError — a driver failure mid-flip keeps the #5242 split report', async () => {
        spyLogs();
        const { data, body } = await publishDrafts({ failSaveMetaItem: true });

        expect(data?.unhideError).toBe('visibility flip failed');
        // The half that DID persist is a fact the caller must keep receiving —
        // the withhold touches the sentence, never the report beside it.
        expect(data?.unhiddenApps).toEqual(['crm']);
        expectNothingLeaked(body);
    });

    it('E · rebindError — a subscriber throw on the announce', async () => {
        spyLogs();
        const { data, body, trigger } = await publishDrafts({ failTrigger: true });

        expect(trigger).toHaveBeenCalledTimes(1);
        expect(data?.rebindError).toBe('metadata:reloaded announce failed');
        // The flip is unaffected and still reported: the announce is the last
        // step, and its failure must not eat the rest of the body.
        expect(data?.unhiddenApps).toEqual(['crm', 'ops']);
        expectNothingLeaked(body);
    });
});

// ---------------------------------------------------------------------------
// Section 2 — the OTHER half: the original reaches the server log
// ---------------------------------------------------------------------------

describe('#8516 · 2 · the withheld cause is not lost — it goes to the log', () => {
    it('the announce failure is logged at `warn`, with cause and remedy', async () => {
        const logs = spyLogs();
        await publishDrafts({ failTrigger: true });

        // The line this card ADDED. Without it the withhold would have made an
        // over-disclosure into a silent failure.
        const line = logs.warn.mock.calls.map((c) => String(c[0]))
            .find((l) => l.includes("'metadata:reloaded' announce FAILED"));
        expect(line).toBeDefined();
        // ① the cause, whole — this is the only place it now exists;
        expect(line).toContain(SUBSCRIBER_TEXT);
        // ② the consequence, concretely: a published flow will not fire;
        expect(line).toContain('does not bind its trigger');
        // ③ the fix, so the line is actionable on its own.
        expect(line).toContain('publish-drafts');
        // `warn`, NOT `error`: nothing that claimed to persist failed to. See
        // the header — AGENTS.md's own functional-degradation example, and the
        // level the sibling announce site already uses for this same event.
        expect(logs.error).not.toHaveBeenCalled();
    });

    it('the visibility flip keeps its pre-existing `error` log and its remedy', async () => {
        const logs = spyLogs();
        await publishDrafts({ failGetMetaItems: true });

        // Green before and after this card — a BOUND, not evidence. The flip is
        // a durability seam (`saveMetaItem` is in the `check:durability-log-level`
        // vocabulary), so this line must never be softened to `warn` or dropped
        // while the payload half is being changed.
        const line = logs.error.mock.calls.map((c) => String(c[0]))
            .find((l) => l.includes('the ADR-0045 visibility flip FAILED'));
        expect(line).toBeDefined();
        expect(line).toContain(DRIVER_TEXT);
        expect(line).toContain('still STORED with `_unpublished: true`');
    });
});

// ---------------------------------------------------------------------------
// Section 3 — the over-block bound
// ---------------------------------------------------------------------------

describe('#8516 · 3 · [GUARD] a DECLARED 4xx refusal is quoted verbatim', () => {
    it('D · the flip quotes a declared refusal, and still names what flipped', async () => {
        spyLogs();
        const { data } = await publishDrafts({ refusalOnSaveMetaItem: true });

        // The author must still learn WHICH app and WHY — a problem they can
        // fix. Measured red under the "withhold everything" variant, which is
        // what makes this case load-bearing rather than decorative.
        expect(data?.unhideError).toBe(DECLARED_FLIP_REFUSAL().message);
        expect(data?.unhiddenApps).toEqual(['crm']);
    });

    it('F · the announce quotes a declared refusal', async () => {
        spyLogs();
        const { data } = await publishDrafts({ refusalOnTrigger: true });

        // No shipped subscriber declares 4xx today; this pins that the rule —
        // not an enumeration of today's subscribers — is what decides, so the
        // first one that does needs no change here.
        expect(data?.rebindError).toBe(DECLARED_ANNOUNCE_REFUSAL().message);
    });
});
