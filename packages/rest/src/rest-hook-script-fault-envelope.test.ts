// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#7543] A sandboxed hook body that CRASHES answers the sanitised server-fault
// envelope, not a 400 carrying its raw `TypeError` as the client-facing message.
//
// ---------------------------------------------------------------------------
// The seam, because the card asked for it to be LOCATED rather than assumed.
//
// The card's investigation note is a negative result: "the observed body —
// status 400, raw message, an `object` key, no `code` — matches NO branch of
// `mapDataError`". That note is wrong, and finding out how it was wrong is the
// whole fix. It missed the two SANDBOX-UNWRAP branches, which are the only ones
// in the file that emit `{ error, object }` with no `code` at 400 — exactly the
// reported shape. Measured on `main` @ `4ed4160` (i.e. AFTER PR #7575 landed
// `declaredHttpStatus`, which does not touch these branches):
//
//   mapDataError(SandboxError(                                  ← rest-server.ts
//     "hook 'showcase_normalize_task_title' threw: TypeError: not a function",
//     innerMessage: 'TypeError: not a function'), 'showcase_task')
//   => {"status":400,"body":{"error":"TypeError: not a function",
//                            "object":"showcase_task"}}
//
// — byte-for-byte the reported response. The full chain, end to end:
//
//   1. `examples/app-showcase/src/data/hooks/index.ts` `NormalizeTaskTitleHook`
//      ran `if (ctx.input.title) ctx.input.title = ctx.input.title.trim();`.
//      The number `12345` is truthy and has no `.trim` ⇒ QuickJS throws.
//   2. `runtime/src/sandbox/quickjs-runner.ts` wraps it as
//      `SandboxError("hook '<name>' threw: TypeError: not a function",
//                    userFacingMessage(...))`. `userFacingMessage` strips only a
//      leading `Error: `, so `innerMessage` KEEPS `TypeError: not a function`.
//   3. `mapDataError`'s `innerMessage` branch answers 400 with that string and
//      deliberately no `code`.
//
// This also answers the card's "so the throw is upstream or downstream of
// `validateOne`". It is UPSTREAM: the hook is `beforeInsert`, so it throws
// before the validator ever sees the record — which is why `validateOne`'s safe
// `String(value)` never got the chance to handle it.
//
// ---------------------------------------------------------------------------
// Why a 500, and why this file does NOT assert `fields[]` on the repro body.
//
// The card's accept bar says `{"title": 12345}` must JOIN its neighbours —
// `{}` → `400 VALIDATION_FAILED` with `fields[]`. It cannot, and asserting that
// it does would pin a false statement. `record-validator.ts:503-504` accepts a
// number in a `text` field:
//
//   if (t === 'text' || …) { const s = typeof value === 'string' ? value : String(value); … }
//
// — the value is COERCED, every length/format check runs against `"12345"`, and
// the branch returns `null`. The shape guard above it (`invalid_value_shape`)
// only refuses filter-operator objects like `{ $in: [...] }`, not scalars. So
// `{"title": 12345}` is a VALID request by the platform's own declared
// contract; there is no offending field to name, and `VALIDATION_FAILED` would
// be a lie about the caller.
//
// What was actually broken is the other two things the card names, and both are
// fixed here: the raw runtime fault no longer reaches the wire, and the body now
// carries a `code` (`INTERNAL_ERROR`) so a client keying on the ledgered
// envelope gets one. §4 pins the family side by side so the three bodies are
// guarded together, each asserted for what it truthfully is.
//
// The 500 is not a new policy either — {@link UNCLASSIFIED_FAULT}'s own docblock
// (#5489) already ruled on this exact case one door down: "or a plain handler
// bug (`TypeError: x is not a function`) … server faults that a caller cannot
// fix and a caller SHOULD retry". The sandbox unwraps sit ABOVE that branch and
// were intercepting the crash before it could reach the answer the file had
// already settled on.
//
// ---------------------------------------------------------------------------
// Mutation table. All 18 cases were PROVEN able to fail — none is covered by
// fewer than one mutation. Directions were predicted BEFORE running; where a
// prediction was wrong it is recorded as MEASURED, and where the measurement
// showed an assertion was not pulling its weight the TEST was strengthened
// rather than the prediction rewritten (see E).
//
// A · BASELINE — the file run against unmodified `main` (`4ed4160`), i.e. the
//     real defect rather than a synthetic mutation.
//       §1 predicted RED,   measured 6/6 red — the reported body and every other
//          native error name answer `400 {error:<raw>,object}`.
//       §2 predicted RED,   measured 1/3 red — prediction said 3/3 and was WRONG
//          about the mechanism: the two cross-door AGREEMENT cases are
//          direction-insensitive on baseline BY CONSTRUCTION, because both doors
//          are broken in the SAME way and so still agree. Mutation D is what
//          moves them, and that is exactly the partial fix they exist to catch.
//       §3 predicted GREEN, measured 4/4 green — the business-refusal branch is
//          what the fix must NOT move, and unmodified `main` already passes it.
//          Green on baseline is the point: this is the regression half, moved by
//          mutations B and E.
//       §4 predicted RED,   measured 3/5 red — the three crash rows. The two
//          control rows pass on baseline; they never entered a sandbox branch.
//          Mutation F moves them.
//     Total: 10 of 18 red.
//
// B · `isScriptFaultMessage` returns `true` for EVERY message (the "sanitise
//     every hook throw" overreach the fix must not become).
//       predicted RED for §3 + §4's distinctness row, measured 6 red — §3's four
//       cases, §4's distinctness row, and §2's refusal-agreement case (the
//       prediction missed that §2 asserts on a refusal too).
//
// C · `isScriptFaultMessage` returns `false` for every message (the fix deleted,
//     call sites left in place).
//       predicted RED for the same set as baseline A, measured 10 red — the same
//       10, confirming the two call sites are the only carriers of the fix.
//
// D · The `innerMessage` door's guard removed, the regex door's KEPT — the
//     partial fix that would make the envelope depend on whether the
//     SandboxError instance happened to survive a rethrow.
//       predicted RED for §1 + §4's crash rows + §2's byte-equality case,
//       measured exactly that: 10 red, with §2's lost-instance and
//       refusal-agreement cases GREEN. This is the mutation that justifies
//       guarding BOTH doors rather than one.
//
// E · The regex anchor `^` dropped from `NATIVE_ERROR_NAME_RE`.
//       predicted RED for §3's "merely mentions a native error name" case,
//       measured 0 red — prediction WRONG, and the finding is the useful part:
//       the `(?::|$)` limb already refuses prose like "produced a TypeError in
//       your template", so the original single-string assertion did not exercise
//       the anchor at all. The case was strengthened with a message that quotes a
//       native name WITH its colon mid-sentence ("rejected with TypeError: check
//       the template"), which only `^` refuses. Re-measured: 1 red.
//
// F · The `VALIDATION_FAILED` branch's `fields` limb hard-coded to `[]` — the
//     mutation that covers §4's two control rows, which no fix-targeting
//     mutation can move.
//       predicted RED for exactly those two, measured 2 red.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { INTERNAL_ERROR_MESSAGE } from '@objectstack/types';
import { mapDataError } from './rest-server.js';

// ---------------------------------------------------------------------------
// Producer fixtures — COPIED from the shipping producers, not invented.
//
// `@objectstack/rest` must not depend on `@objectstack/runtime` or
// `@objectstack/objectql` to run its own tests, so the two thrown shapes are
// reproduced here. What makes them valid fixtures is that each is built the way
// its real producer builds it.
// ---------------------------------------------------------------------------

/**
 * `runtime/src/sandbox/quickjs-runner.ts`'s `SandboxError` — the wrapper on
 * `.message` for server logs, the business message on `.innerMessage`.
 * `innerMessage` is `userFacingMessage(formatErr(err))`, which strips a leading
 * `Error: ` and nothing else.
 */
class SandboxError extends Error {
    readonly innerMessage?: string;
    constructor(message: string, innerMessage?: string) {
        super(message);
        this.name = 'SandboxError';
        this.innerMessage = innerMessage;
    }
}

/** What the sandbox throws when a hook BODY crashes. */
function hookCrash(hook: string, thrown: string) {
    return new SandboxError(`hook '${hook}' threw: ${thrown}`, thrown);
}

/**
 * The same crash after the SandboxError instance was lost crossing a
 * rethrow/serialization boundary — only the wrapper text survives.
 */
function hookCrashInstanceLost(hook: string, thrown: string) {
    return new Error(`hook '${hook}' threw: ${thrown}`);
}

/** What the sandbox throws when a hook body DELIBERATELY refuses a write. */
function hookRefusal(hook: string, businessMessage: string) {
    // The real path: the author writes `throw new Error('…')`, `formatErr`
    // renders `Error: …`, and `userFacingMessage` strips that prefix.
    return new SandboxError(`hook '${hook}' threw: Error: ${businessMessage}`, businessMessage);
}

/** `objectql/src/validation/record-validator.ts`'s `ValidationError`. */
function validationError(fields: Array<Record<string, unknown>>) {
    const err: any = new Error(
        fields.map((f: any) => (f.message?.trim() ? f.message : `${f.field} (${f.code})`)).join('; '),
    );
    err.name = 'ValidationError';
    err.code = 'VALIDATION_FAILED';
    err.fields = fields;
    return err;
}

/** The exact hook the report tripped, with the exact thrown text. */
const REPORTED = () => hookCrash('showcase_normalize_task_title', 'TypeError: not a function');

// ---------------------------------------------------------------------------
// §1 The reported defect — the `innerMessage` door
// ---------------------------------------------------------------------------

describe('[#7543] a crashing hook body does not put its runtime fault on the wire', () => {
    it('the reported request no longer answers `400 "TypeError: not a function"`', () => {
        const r = mapDataError(REPORTED(), 'showcase_task');

        // The measured defect, pinned as a NEGATIVE so a partial fix cannot pass.
        expect(r.body.error).not.toBe('TypeError: not a function');
        expect(String(r.body.error)).not.toContain('TypeError');
        expect(r.status).not.toBe(400);

        expect(r.status).toBe(500);
        expect(r.body.error).toBe(INTERNAL_ERROR_MESSAGE);
    });

    it('the body joins the ledgered envelope — it carries a `code`', () => {
        // The card's second contract break: a client keying on `code` got
        // nothing at all from this response.
        const r = mapDataError(REPORTED(), 'showcase_task');
        expect(r.body.code).toBe('INTERNAL_ERROR');
        expect(r.body).toHaveProperty('code');
    });

    it('no part of the internal fault survives — not the name, not the object key', () => {
        const r = mapDataError(REPORTED(), 'showcase_task');
        // `UNCLASSIFIED_FAULT`'s envelope is deliberately minimal, and this
        // branch emits it byte-identically rather than a near-duplicate with an
        // `object` key bolted on: one wire answer for "server fault, no
        // attribution to the caller".
        expect(r.body).toEqual({ error: INTERNAL_ERROR_MESSAGE, code: 'INTERNAL_ERROR' });
        expect(r.body).not.toHaveProperty('object');
    });

    it('every native error constructor name is a crash, not a refusal', () => {
        // Matched by CONSTRUCTOR NAME rather than by phrasing — the sandbox
        // stringifies a thrown error as `<name>: <message>`, so the name is
        // structural evidence, not a keyword heuristic over prose.
        const nativeCrashes = [
            'TypeError: not a function',
            "TypeError: cannot read property 'x' of undefined",
            'ReferenceError: foo is not defined',
            'RangeError: Maximum call stack size exceeded',
            'SyntaxError: unexpected token',
            'URIError: URI malformed',
            'EvalError: eval is not permitted',
            'InternalError: stack overflow',
            'AggregateError: All promises were rejected',
        ];
        for (const thrown of nativeCrashes) {
            const r = mapDataError(hookCrash('h', thrown), 'showcase_task');
            expect(r.status, thrown).toBe(500);
            expect(r.body.code, thrown).toBe('INTERNAL_ERROR');
            expect(String(r.body.error), thrown).toBe(INTERNAL_ERROR_MESSAGE);
        }
    });

    it('a bare constructor name with no message is still a crash', () => {
        // QuickJS can stringify a thrown error with an empty message. The `(?::|$)`
        // limb is what keeps that from falling through to the verbatim 400.
        const r = mapDataError(hookCrash('h', 'TypeError'), 'showcase_task');
        expect(r.status).toBe(500);
        expect(r.body.code).toBe('INTERNAL_ERROR');
    });

    it('an ACTION body crashes the same way a hook body does', () => {
        // The unwrap branches read `hook|action` in one regex; the innerMessage
        // door does not read the kind at all. One classification for both.
        const err = new SandboxError(
            "action 'showcase_recalc' threw: TypeError: not a function",
            'TypeError: not a function',
        );
        const r = mapDataError(err, 'showcase_task');
        expect(r.status).toBe(500);
        expect(r.body.code).toBe('INTERNAL_ERROR');
    });
});

// ---------------------------------------------------------------------------
// §2 The same defect through the OTHER door — the regex fallback
// ---------------------------------------------------------------------------

describe('[#7543] the lost-instance fallback classifies identically', () => {
    it('the reported crash answers the same envelope when `innerMessage` is gone', () => {
        const r = mapDataError(
            hookCrashInstanceLost('showcase_normalize_task_title', 'TypeError: not a function'),
            'showcase_task',
        );
        expect(r.status).toBe(500);
        expect(r.body.code).toBe('INTERNAL_ERROR');
        expect(String(r.body.error)).not.toContain('TypeError');
    });

    it('the two doors produce BYTE-EQUAL bodies for the same crash', () => {
        // This is the assertion that makes the fix independent of whether the
        // SandboxError instance survived a rethrow. Without it, a fix applied to
        // one door only would look complete.
        const viaInnerMessage = mapDataError(REPORTED(), 'showcase_task');
        const viaRawMessage = mapDataError(
            hookCrashInstanceLost('showcase_normalize_task_title', 'TypeError: not a function'),
            'showcase_task',
        );
        expect(viaRawMessage).toEqual(viaInnerMessage);
    });

    it('the two doors also agree on a REFUSAL — the unwrap still works', () => {
        const msg = 'this task cannot be renamed after it is closed';
        const viaInnerMessage = mapDataError(hookRefusal('h', msg), 'showcase_task');
        const viaRawMessage = mapDataError(
            hookCrashInstanceLost('h', `Error: ${msg}`),
            'showcase_task',
        );
        expect(viaRawMessage).toEqual(viaInnerMessage);
        expect(viaRawMessage.body.error).toBe(msg);
    });
});

// ---------------------------------------------------------------------------
// §3 What must NOT move — a deliberate business refusal
// ---------------------------------------------------------------------------

describe('[#7543] a hook that deliberately refuses still speaks in its own words', () => {
    it('a business message reaches the caller verbatim at 400', () => {
        // The entire reason the unwrap branches exist. #5423's verbatim rule:
        // a hook refusal is an answer addressed TO the caller and its message
        // IS the remedy.
        const r = mapDataError(hookRefusal('h', '删除被阻断：仍有未结清的发票'), 'showcase_task');
        expect(r.status).toBe(400);
        expect(r.body.error).toBe('删除被阻断：仍有未结清的发票');
        expect(r.body.object).toBe('showcase_task');
        expect(r.body.error).not.toBe(INTERNAL_ERROR_MESSAGE);
    });

    it('the refusal envelope still carries NO `code` — #7543 did not relitigate that', () => {
        // Deliberate and load-bearing: older @objectstack/client builds prepend
        // any `code` to the human-readable message, which would reintroduce the
        // English noise the unwrap removes. The fix changes WHICH errors take
        // this branch, not what the branch emits.
        const r = mapDataError(hookRefusal('h', 'month-end close is in progress'), 'showcase_task');
        expect(r.body).not.toHaveProperty('code');
    });

    it('an English refusal that merely MENTIONS a native error name is still a refusal', () => {
        // The regex is anchored at `^`, and the second case is the one that
        // actually needs the anchor: prose can quote a native name WITH its
        // colon (a hook re-reporting what a downstream call told it), which an
        // unanchored pattern would match mid-sentence and sanitise away.
        for (const msg of [
            'the imported row produced a TypeError in your template — fix the template',
            'row 14 was rejected with TypeError: check the template before re-importing',
            'the upstream feed answered with a RangeError',
        ]) {
            const r = mapDataError(hookRefusal('h', msg), 'showcase_task');
            expect(r.status, msg).toBe(400);
            expect(r.body.error, msg).toBe(msg);
        }
    });

    it('a refusal whose message is empty-ish is untouched by the new guard', () => {
        const r = mapDataError(hookRefusal('h', 'no'), 'showcase_task');
        expect(r.status).toBe(400);
        expect(r.body.error).toBe('no');
    });
});

// ---------------------------------------------------------------------------
// §4 The family, side by side — the card's control table
//
// The card measured three bodies on ONE route in ONE run and the defect is only
// visible as the odd one out, so they are pinned together rather than in three
// files that could drift apart.
// ---------------------------------------------------------------------------

describe('[#7543] the control table from the report, guarded as one family', () => {
    it('`{}` → 400 VALIDATION_FAILED with `fields[]` (control, unchanged)', () => {
        const r = mapDataError(
            validationError([{ field: 'title', code: 'required', message: 'Title is required' }]),
            'showcase_task',
        );
        expect(r.status).toBe(400);
        expect(r.body.code).toBe('VALIDATION_FAILED');
        expect(r.body.fields).toEqual([
            { field: 'title', code: 'required', message: 'Title is required' },
        ]);
    });

    it('a bad enum value → 400 with `invalid_option` and the allowed list (control, unchanged)', () => {
        const r = mapDataError(
            validationError([{
                field: 'status',
                code: 'invalid_option',
                message: 'Status must be one of: open, done',
                options: ['open', 'done'],
            }]),
            'showcase_task',
        );
        expect(r.status).toBe(400);
        expect(r.body.code).toBe('VALIDATION_FAILED');
        expect((r.body.fields as any[])[0].code).toBe('invalid_option');
        expect((r.body.fields as any[])[0].options).toEqual(['open', 'done']);
    });

    it('`{"title": 12345}` → the sanitised server fault, and it carries a `code` like its neighbours', () => {
        const r = mapDataError(REPORTED(), 'showcase_task');

        // It does NOT join the 400 VALIDATION_FAILED family, and pinning that it
        // does not is the honest half: `record-validator.ts:503-504` COERCES a
        // number in a `text` field via `String(value)`, so this request breaks
        // no declared contract and names no offending field. What was wrong was
        // the raw fault text and the missing `code`; both are fixed.
        expect(r.body.code).toBe('INTERNAL_ERROR');
        expect(r.body.code).not.toBe('VALIDATION_FAILED');
        expect(r.body).not.toHaveProperty('fields');
    });

    it('every member of the family carries a machine-readable `code`', () => {
        // The card's second contract break, stated as the family invariant it
        // actually is: no body on this route leaves without a `code`.
        const family = [
            validationError([{ field: 'title', code: 'required', message: 'Title is required' }]),
            validationError([{ field: 'status', code: 'invalid_option', message: 'bad', options: ['a'] }]),
            REPORTED(),
        ];
        for (const err of family) {
            const r = mapDataError(err, 'showcase_task');
            expect(typeof r.body.code, String(err.message)).toBe('string');
            expect(String(r.body.code).length).toBeGreaterThan(0);
        }
    });

    it('a crash and a refusal are DISTINGUISHABLE on the wire', () => {
        // The one thing the defect made impossible: both used to be
        // `400 {error, object}` with no `code`, so a client could not tell an
        // app-authored business rule from a platform-side fault.
        const crash = mapDataError(REPORTED(), 'showcase_task');
        const refusal = mapDataError(hookRefusal('h', 'not allowed while closed'), 'showcase_task');

        expect(crash.status).not.toBe(refusal.status);
        expect(crash.body).not.toEqual(refusal.body);
    });
});
