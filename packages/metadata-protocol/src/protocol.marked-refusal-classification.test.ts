// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#12536] A producer-MARKED application refusal and a genuine store fault are
// two different conversations, and this file holds them apart.
//
// ---------------------------------------------------------------------------
// The defect, measured on `origin/main` (aef1b7e64) before the fix
// ---------------------------------------------------------------------------
// A metadata app's sandboxed hook on `sys_metadata` may refuse a read and mark
// its refusal with `userMessage` — the #9934 producer-side opt-in where the
// field's PRESENCE is the marking (maintainer ruling 2026-08-19,
// objectui#5210 option 1). `metadataStoreUnavailableError` built a fresh error
// carrying only `code` / `status` / `cause`, and `declaredUserMessage` reads
// the TOP level and never `cause` — so the mark died at the producer. Driven
// through the real `ObjectStackProtocolImplementation` with an engine whose
// read rejects, the two failures were indistinguishable:
//
//   getMetaItems / MARKED hook refusal
//     -> status=503 code=SERVICE_UNAVAILABLE declaredUserMessage=undefined
//        message="The metadata store could not be read, ..."
//   getMetaItems / driver fault (connect ECONNREFUSED 10.0.0.5:5432)
//     -> status=503 code=SERVICE_UNAVAILABLE declaredUserMessage=undefined
//        message="The metadata store could not be read, ..."   <- byte-identical
//
//   deletePackage / MARKED hook refusal on the per-item delete
//     -> failed[0] = { type, name, error: "Failed to delete customization
//        overlay for object/acct. The metadata store rejected the delete; ..." }
//        — no channel for the mark on the row at all.
//
// ---------------------------------------------------------------------------
// The ruling under test (maintainer, 2026-08-27, verbatim 「同意」 — option B)
// ---------------------------------------------------------------------------
// Classify AT THE PRODUCER: a marked refusal travels its own refusal category
// with the author's text intact; a genuine store fault keeps #8136's
// deliberately non-quoting 503, untouched. `deletePackage`'s per-item
// `failed[]` / `cleanups[]` path follows the same classification.
//
// ⛔ The declined fallback, pinned here so it cannot be reintroduced as a
// shortcut: forwarding the mark ACROSS the 503. Section 2 asserts the store
// fault carries no `userMessage` at all, and that the underlying failure text
// appears in NO field outside the door.
//
// ---------------------------------------------------------------------------
// Why every zero here is paired
// ---------------------------------------------------------------------------
// Section 2's negative pin is an absence claim, so it runs the SAME scanner
// over a case where the term is present (§2.0) — and the two sentinels are
// chosen so neither is a substring of the other, which is the failure mode a
// shared prefix would hide.
//
// ---------------------------------------------------------------------------
// Reverse verification — direction predicted BEFORE running
// ---------------------------------------------------------------------------
// With `protocol.ts` restored from origin/main, predicted:
//   - RED: §1 (every marked case — they assert the refusal category and the
//     author's text, which the unfixed producer replaces with the 503), and
//     §3's marked cases (`failed[].userMessage` / `cleanups[].userMessage` do
//     not exist on the unfixed row).
//   - GREEN in both directions, and therefore [GUARD] rather than evidence:
//     §2 in its entirety. The store fault is unchanged BY DESIGN, so a green
//     §2 before and after is exactly the claim — it is the over-reach bound,
//     and it is what turns "I did not break the 503" into a measurement.

import { describe, it, expect, vi } from 'vitest';
import { declaredUserMessage, resolveThrownHttpError } from '@objectstack/types';
import { ErrorCode } from '@objectstack/spec/api';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';
import { ObjectStackProtocolImplementation } from './protocol.js';
import { assertEngineDeleteDispatch, assertEngineFindOnePredicate, type EngineFindOneQueryInput } from '@objectstack/metadata-core';

// ---------------------------------------------------------------------------
// Sentinels — deliberately disjoint, neither a substring of the other
// ---------------------------------------------------------------------------

/** Lives only in the DRIVER's sentence. Must never cross the 503 door. */
const DRIVER_SENTINEL = 'Zzdriverfault9';
/** Lives only in the AUTHOR's marked text. Must cross, verbatim. */
const MARK_SENTINEL = 'Qqauthormark7';
/**
 * Lives only in the marked refusal's DIAGNOSTIC `message` — the sandbox's own
 * debug wrapper. Held apart from the marked text on purpose: the classified
 * refusal must carry the MARK and take nothing else from its cause, and a
 * fixture whose two strings coincided could not tell those apart.
 */
const DIAG_SENTINEL = 'Wwhookdiag5';

const DRIVER_TEXT = `connect ECONNREFUSED 10.0.0.5:5432 [${DRIVER_SENTINEL}]`;
const AUTHOR_TEXT =
    `Your trial plan does not include custom objects — ask your admin to upgrade. [${MARK_SENTINEL}]`;

// No sentinel may contain another, or every "absent" below could be an artifact
// of one overlapping the other. Asserted, not assumed.
for (const a of [DRIVER_SENTINEL, MARK_SENTINEL, DIAG_SENTINEL]) {
    for (const b of [DRIVER_SENTINEL, MARK_SENTINEL, DIAG_SENTINEL]) {
        if (a !== b && (a.includes(b) || b.includes(a))) {
            throw new Error(`sentinels ${a} / ${b} overlap — every absence assertion here would be unsound`);
        }
    }
}

/**
 * The exact bytes today's non-quoting 503 says. Written out rather than
 * imported: the point of §2 is that this sentence did not move, and importing
 * the constant would make the assertion true by construction.
 */
const STORE_UNAVAILABLE_MESSAGE =
    'The metadata store could not be read, so whether this item exists is unknown. '
    + 'Retry once the metadata database is reachable.';

// ---------------------------------------------------------------------------
// Error shapes
// ---------------------------------------------------------------------------

/**
 * What a sandboxed hook that MARKS its refusal produces. The canonical #9934
 * authoring shape is `const e = new Error(msg); e.userMessage = msg`, and the
 * QuickJS side-channel carries `code` / `status` / `userMessage` out of the VM
 * onto `SandboxError`. The `message` here is deliberately the sandbox's own
 * debug wrapper — DIFFERENT from the marked text, so a test that passes cannot
 * be passing because the two strings happen to coincide.
 */
const markedRefusal = (extra: Record<string, unknown> = {}) =>
    Object.assign(new Error(`hook 'trial-gate' threw: Error: quota exceeded [${DIAG_SENTINEL}]`), {
        userMessage: AUTHOR_TEXT,
        ...extra,
    });

/** A genuine store fault: no mark anywhere. */
const driverFault = () => Object.assign(new Error(DRIVER_TEXT), { code: 'ECONNREFUSED' });

// ---------------------------------------------------------------------------
// The scanner used by every absence claim, and its own positive control
// ---------------------------------------------------------------------------

/**
 * Everything a caller could see on a thrown error — its own enumerable and
 * non-enumerable properties plus `message` / `name` / `stack`, and the wire
 * projection an HTTP boundary actually resolves.
 *
 * `cause` is EXCLUDED on purpose, and that exclusion is the contract rather
 * than a loophole: the withheld text is not lost, it is relocated to `cause`,
 * which `handleRouteError` / `logWithheldServerFault` print for the operator.
 * "Outside the door" means everything else.
 */
function outsideTheDoor(err: unknown): string {
    const e = err as Record<string, unknown> | null;
    const view: Record<string, unknown> = {};
    for (const key of Object.getOwnPropertyNames(e ?? {})) {
        if (key === 'cause') continue;
        view[key] = (e as any)?.[key];
    }
    view.message = (e as any)?.message;
    view.name = (e as any)?.name;
    view.stack = (e as any)?.stack;
    // What the boundary resolves is the projection that actually reaches a
    // client, so it is scanned too rather than reasoned about.
    view.__resolved = resolveThrownHttpError(err, 500);
    return JSON.stringify(view);
}

describe('[#12536 §2.0] the scanner used by every absence claim finds a term that IS there', () => {
    it('finds a sentinel carried on a NON-message field', () => {
        // The control that matters: if `outsideTheDoor` only ever read
        // `message`, §2's zeros would be vacuous for every other field.
        const carrier = Object.assign(new Error('a sentence with no sentinel in it'), {
            userMessage: `refused [${MARK_SENTINEL}]`,
        });
        expect(outsideTheDoor(carrier)).toContain(MARK_SENTINEL);
        expect(outsideTheDoor(carrier)).not.toContain(DRIVER_SENTINEL);
    });

    it('finds a sentinel carried on `message`', () => {
        expect(outsideTheDoor(new Error(DRIVER_TEXT))).toContain(DRIVER_SENTINEL);
    });
});

// ---------------------------------------------------------------------------
// Harness — the real protocol over an engine that fails the way a hook does
// ---------------------------------------------------------------------------

function emptyRegistry() {
    return {
        getObject: () => undefined,
        getItem: () => undefined,
        getArtifactItem: () => undefined,
        listItems: () => [],
        applyNavContributions: (x: any) => x,
        isPackageDisabled: () => false,
        getObjectOwner: () => undefined,
        registerItem: () => {},
        registerObject: () => {},
        removeRuntimeShadow: () => false,
        removeOverlayEntry: () => {},
        uninstallPackage: () => {},
    };
}

/** Every read rejects with `error()` — a metadata store the protocol cannot read. */
function unreadableEngine(error: () => unknown) {
    const reject = vi.fn(async (object: string, query?: EngineFindOneQueryInput) => {
        assertEngineFindOnePredicate(object, query);
        throw error();
    });
    return { registry: emptyRegistry(), find: reject, findOne: reject } as any;
}

/**
 * `deleteMetaItem` picks its path from the registry's own flags, so the type
 * under test is DERIVED (Prime Directive #8) rather than named.
 */
const REPO_PATH_TYPE = DEFAULT_METADATA_TYPE_REGISTRY
    .filter((e) => e.allowOrgOverride || e.allowRuntimeCreate)
    .map((e) => e.type)
    .sort()[0]!;

/** The uninstall reads one row and then fails the per-item delete underneath it. */
function uninstallEngine(error: () => unknown) {
    const row = {
        id: 'row_1',
        type: REPO_PATH_TYPE,
        name: 'acct',
        organization_id: null,
        package_id: 'com.acme.crm',
        state: 'active',
        metadata: JSON.stringify({ name: 'acct' }),
        checksum: 'sha256_marked_refusal_fixture',
    };
    return {
        registry: emptyRegistry(),
        find: vi.fn(async (table: string) => (table === 'sys_metadata' ? [row] : [])),
        findOne: vi.fn(async (table: string, q?: EngineFindOneQueryInput) => {
            assertEngineFindOnePredicate(table, q);
            throw error();
        }),
        delete: vi.fn(async (_t: string, o?: Record<string, unknown>) => {
            assertEngineDeleteDispatch(o);
            throw error();
        }),
    } as any;
}

async function captureThrow(run: () => Promise<unknown>): Promise<any> {
    let resolved: unknown;
    let didResolve = false;
    try {
        resolved = await run();
        didResolve = true;
    } catch (e) {
        return e;
    }
    expect(didResolve, `expected a rejection, got ${JSON.stringify(resolved)}`).toBe(false);
}

// ---------------------------------------------------------------------------
// 1. The marked refusal leaves by its own door, with the author's text intact
// ---------------------------------------------------------------------------

describe('[#12536 §1] a producer-marked refusal is classified as a refusal, not as a store fault', () => {
    for (const [label, call] of [
        ['getMetaItems', (p: any) => p.getMetaItems({ type: 'object' })],
        ['getMetaItem', (p: any) => p.getMetaItem({ type: 'object', name: 'acct' })],
        ['getMetaItem?state=draft', (p: any) => p.getMetaItem({ type: 'object', name: 'acct', state: 'draft' })],
    ] as const) {
        it(`${label} carries the author's text VERBATIM`, async () => {
            const cause = markedRefusal();
            const p = new ObjectStackProtocolImplementation(unreadableEngine(() => cause));

            const caught = await captureThrow(() => call(p));

            // The whole point of the card: the mark survives to the top level,
            // which is the only level `declaredUserMessage` reads.
            expect(declaredUserMessage(caught)).toBe(AUTHOR_TEXT);
            // …and it is the author's bytes, not a paraphrase.
            expect(caught.userMessage).toBe(AUTHOR_TEXT);
            // It is NOT the store-unavailable category any more.
            expect(caught.status).not.toBe(503);
            expect(caught.code).not.toBe('SERVICE_UNAVAILABLE');
            expect(caught.message).not.toBe(STORE_UNAVAILABLE_MESSAGE);
            // The diagnostic still reaches the operator.
            expect(caught.cause).toBe(cause);
        });
    }

    it('answers the undeclared refusal with the hook door\'s own default status', async () => {
        const p = new ObjectStackProtocolImplementation(unreadableEngine(() => markedRefusal()));
        const caught = await captureThrow(() => p.getMetaItems({ type: 'object' } as any));

        // 400 is not chosen here — it is `error-response.ts`'s `declared ?? 400`
        // for a sandbox hook refusal that named no status (#9967), reused so the
        // two doors classify one undeclared refusal identically.
        expect(caught.status).toBe(400);
        // ADR-0112 D4: whatever code ships must be in the closed vocabulary.
        expect(ErrorCode.safeParse(caught.code).success).toBe(true);
    });

    it('keeps a status the hook DECLARED for itself (#7867), in both spellings', async () => {
        const declared = new ObjectStackProtocolImplementation(
            unreadableEngine(() => markedRefusal({ status: 403 })));
        const caughtStatus = await captureThrow(() => declared.getMetaItems({ type: 'object' } as any));
        expect(caughtStatus.status).toBe(403);
        expect(declaredUserMessage(caughtStatus)).toBe(AUTHOR_TEXT);

        const spelled = new ObjectStackProtocolImplementation(
            unreadableEngine(() => markedRefusal({ statusCode: 409 })));
        const caughtSpelling = await captureThrow(() => spelled.getMetaItems({ type: 'object' } as any));
        // Reading one spelling is how `/api/v1/data` answered 500 to a
        // deliberate 409 until #7525; this door reads both because it asks
        // `resolveThrownHttpError` rather than spelling the chain again.
        expect(caughtSpelling.status).toBe(409);
    });

    it('passes a CATALOGUED code from the hook through, and demotes one the ledger does not know', async () => {
        const catalogued = new ObjectStackProtocolImplementation(
            unreadableEngine(() => markedRefusal({ status: 403, code: 'FORBIDDEN' })));
        const a = await captureThrow(() => catalogued.getMetaItems({ type: 'object' } as any));
        expect(a.code).toBe('FORBIDDEN');

        const dialect = new ObjectStackProtocolImplementation(
            unreadableEngine(() => markedRefusal({ status: 403, code: 'SQLITE_ERROR' })));
        const b = await captureThrow(() => dialect.getMetaItems({ type: 'object' } as any));
        // A driver's own dialect must never enter `ApiErrorSchema.code`.
        expect(b.code).not.toBe('SQLITE_ERROR');
        expect(ErrorCode.safeParse(b.code).success).toBe(true);
        // …and the mark is unaffected by the code demotion.
        expect(declaredUserMessage(b)).toBe(AUTHOR_TEXT);
    });

    it('does NOT treat a blank or non-string `userMessage` as a marking', async () => {
        for (const notADeclaration of ['', '   ', 42, null, undefined]) {
            const p = new ObjectStackProtocolImplementation(
                unreadableEngine(() => Object.assign(new Error(DRIVER_TEXT), { userMessage: notADeclaration })));
            const caught = await captureThrow(() => p.getMetaItems({ type: 'object' } as any));
            // Absent means the consumer keeps its generic substitution (#3821),
            // so an unmarked failure must stay the 503 — nothing invents a mark.
            expect(caught.status, `userMessage=${JSON.stringify(notADeclaration)}`).toBe(503);
            expect(caught.code).toBe('SERVICE_UNAVAILABLE');
        }
    });
});

// ---------------------------------------------------------------------------
// 2. The genuine store fault is byte-for-byte what it was — the over-reach bound
// ---------------------------------------------------------------------------

describe('[#12536 §2] an UNMARKED store fault keeps the deliberately non-quoting 503 (#8136 untouched)', () => {
    it('answers the same envelope, byte for byte', async () => {
        const cause = driverFault();
        const p = new ObjectStackProtocolImplementation(unreadableEngine(() => cause));

        const caught = await captureThrow(() => p.getMetaItems({ type: 'object' } as any));

        expect(caught.status).toBe(503);
        expect(caught.code).toBe('SERVICE_UNAVAILABLE');
        expect(caught.message).toBe(STORE_UNAVAILABLE_MESSAGE);
        expect(caught.cause).toBe(cause);
    });

    it('NEGATIVE PIN — the underlying failure text appears in no field outside the door', async () => {
        const p = new ObjectStackProtocolImplementation(unreadableEngine(driverFault));
        const caught = await captureThrow(() => p.getMetaItems({ type: 'object' } as any));

        const seen = outsideTheDoor(caught);
        // The scanner is proven alive by §2.0 on both a message field and a
        // non-message field, so this zero is a measurement rather than a
        // dead scan.
        expect(seen).not.toContain(DRIVER_SENTINEL);
        expect(seen).not.toContain('ECONNREFUSED');
        expect(seen).not.toContain('10.0.0.5');
        // The declined fallback, pinned: nothing forwards a mark across this
        // door — the 503 does not even own the property.
        expect(Object.prototype.hasOwnProperty.call(caught, 'userMessage')).toBe(false);
        expect(declaredUserMessage(caught)).toBeUndefined();
    });

    it('POSITIVE CONTROL — the same scan over the MARKED refusal does find its text', async () => {
        const p = new ObjectStackProtocolImplementation(unreadableEngine(() => markedRefusal()));
        const caught = await captureThrow(() => p.getMetaItems({ type: 'object' } as any));

        const seen = outsideTheDoor(caught);
        expect(seen).toContain(MARK_SENTINEL);
        // …and the marked refusal takes nothing ELSE from its cause: the
        // sandbox wrapper's own debug sentence carries `DIAG_SENTINEL`, and
        // that stays on `cause` for the operator.
        expect(seen).not.toContain(DIAG_SENTINEL);
    });

    it('the two conversations are now distinguishable, which they were not before', async () => {
        const marked = new ObjectStackProtocolImplementation(unreadableEngine(() => markedRefusal()));
        const fault = new ObjectStackProtocolImplementation(unreadableEngine(driverFault));

        const a = await captureThrow(() => marked.getMetaItems({ type: 'object' } as any));
        const b = await captureThrow(() => fault.getMetaItems({ type: 'object' } as any));

        expect(a.status).not.toBe(b.status);
        expect(a.code).not.toBe(b.code);
        expect(a.message).not.toBe(b.message);
        expect(declaredUserMessage(a) !== undefined).toBe(true);
        expect(declaredUserMessage(b) !== undefined).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// 3. The per-item path of the uninstall follows the same classification
// ---------------------------------------------------------------------------

describe('[#12536 §3] `deletePackage` reports a marked refusal as a refusal on the row', () => {
    it('carries the mark onto `failed[]`, where no HTTP boundary could put it', async () => {
        const p = new ObjectStackProtocolImplementation(uninstallEngine(() => markedRefusal())) as any;

        const res = await p.deletePackage({ packageId: 'com.acme.crm', allTenants: true });

        expect(res.failedCount).toBe(1);
        expect(declaredUserMessage(res.failed[0])).toBe(AUTHOR_TEXT);
        // `failed[]` rides inside a PACKAGE_DELETE_PARTIAL 400's `details`, so
        // the channel has to be on the ROW — there is no envelope to carry it.
        expect(res.failed[0].userMessage).toBe(AUTHOR_TEXT);
    });

    it('leaves the row unmarked — and unleaked — for a genuine driver fault', async () => {
        const p = new ObjectStackProtocolImplementation(uninstallEngine(driverFault)) as any;

        const res = await p.deletePackage({ packageId: 'com.acme.crm', allTenants: true });

        expect(res.failedCount).toBe(1);
        expect(res.failed[0].userMessage).toBeUndefined();
        // NEGATIVE PIN over the whole response — with the positive control in
        // the case above proving the same JSON scan does surface a mark.
        expect(JSON.stringify(res)).not.toContain(DRIVER_SENTINEL);
        expect(JSON.stringify(res)).not.toContain('ECONNREFUSED');
    });

    it('classifies the uninstall\'s own overlay READ the same way', async () => {
        const marked = new ObjectStackProtocolImplementation(unreadableEngine(() => markedRefusal())) as any;
        const caughtMarked = await captureThrow(
            () => marked.deletePackage({ packageId: 'com.acme.crm', allTenants: true }));
        expect(declaredUserMessage(caughtMarked)).toBe(AUTHOR_TEXT);
        expect(caughtMarked.status).not.toBe(503);

        const fault = new ObjectStackProtocolImplementation(unreadableEngine(driverFault)) as any;
        const caughtFault = await captureThrow(
            () => fault.deletePackage({ packageId: 'com.acme.crm', allTenants: true }));
        expect(caughtFault.status).toBe(503);
        expect(caughtFault.message).toBe(STORE_UNAVAILABLE_MESSAGE);
        expect(outsideTheDoor(caughtFault)).not.toContain(DRIVER_SENTINEL);
    });

    it('carries the mark onto `cleanups[]` too, beside whatever #8136 licenses in `error`', async () => {
        const p = new ObjectStackProtocolImplementation(uninstallEngine(driverFault)) as any;
        p.registerUninstallCleanup('marked-cleanup', async () => { throw markedRefusal({ status: 403 }); });
        p.registerUninstallCleanup('faulting-cleanup', async () => { throw driverFault(); });

        const res = await p.deletePackage({ packageId: 'com.acme.crm', allTenants: true });

        const marked = res.cleanups.find((c: any) => c.name === 'marked-cleanup');
        const faulting = res.cleanups.find((c: any) => c.name === 'faulting-cleanup');
        expect(declaredUserMessage(marked)).toBe(AUTHOR_TEXT);
        expect(faulting.userMessage).toBeUndefined();
        // The withhold rule on `error` is untouched: an undeclared fault still
        // gets the stable fallback, never the driver's sentence.
        expect(faulting.error).toBe('cleanup failed');
        expect(JSON.stringify(res.cleanups)).not.toContain(DRIVER_SENTINEL);
        expect(JSON.stringify(res.cleanups)).toContain(MARK_SENTINEL);
        // MEASURED, and left standing rather than reconciled: the marked
        // cleanup ALSO declared 403, and #8136's existing rule quotes a
        // 4xx-declaring producer's own sentence into `error`. So its diagnostic
        // travels here — by that older rule, not by this card's change, which
        // adds only the `userMessage` member. Recorded so a future reader does
        // not mistake it for a leak this classification opened.
        expect(marked.error).toContain(DIAG_SENTINEL);
    });
});
