// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#4435] The 404 a single-record operation answers when the id names no row.
 *
 * Extracted so the READ and the two WRITE paths cannot disagree about it. They
 * did: `getData` answered `404 RECORD_NOT_FOUND` while `updateData` returned
 * `200 { record: null }` and `deleteData` returned `200 { success: true }` for
 * any string in the path — so a typo'd id, an already-deleted row and a real
 * deletion were indistinguishable, and a client PATCHing a concurrently deleted
 * record was told its write had landed.
 *
 * That is the same silent-no-op shape the v17 train removed everywhere else
 * this window (#4240/#4303/#4315 refuse missing fields, #4169 refuses unknown
 * params, #4190 stopped dropping filters) — a write that touched zero rows
 * reporting 200 is that shape one level up, on the verb where it costs the
 * most.
 *
 * [#5138] EXPORTED, for the same "cannot disagree about it" reason one layer
 * out. `@objectstack/runtime`'s `callData` is protocol-first with an ObjectQL
 * FALLBACK, and the fallback had reinvented this fact three incompatible ways
 * (`get` → `null`, `update` → a bare `Error` with no status ⇒ 500, `delete` →
 * no check at all ⇒ `200 { deleted: true }` for a row that never existed). It
 * now calls THIS function, so the two paths behind one `callData` answer a
 * missing id identically — which is the only reason a caller may stop caring
 * which of them served it. Re-spelling the envelope there would have been a
 * second not-found envelope; `RECORD_NOT_FOUND` (#5088) is the one this repo
 * has.
 *
 * ── [#7867] Why it lives in `@objectstack/core` and not where it was written ──
 *
 * Because the THIRD path that needed it could not reach the second one. An
 * action body's `ctx.api.object(name).update({ id, … })` traverses neither
 * `protocol.updateData` nor `callData`: it reaches `ObjectQL.update()`'s by-id
 * branch directly, which had no existence gate at all, so a ghost id was a
 * silent no-op that then died on whatever the pipeline complained about first
 * (a `HookConditionError` 400 on a hooked object, a required-field
 * `VALIDATION_FAILED` 400 on an unhooked one — the 400 class varied with the
 * object's declarations; the missing 404 was the constant).
 *
 * The gate for that path belongs in the engine, and `packages/objectql` cannot
 * import `@objectstack/metadata-protocol` where this function was written:
 * ADR-0076 D2's boundary ratchet (`core-boundary.ratchet.test.ts`) forbids the
 * whole `@objectstack/objectql/core` closure — `engine.ts` included — from
 * pulling that package in. So the choice was a FOURTH spelling of the envelope
 * or one home both layers already depend on. #5138's own sentence rules the
 * first out, so this is the second: the factory moved down to the lowest
 * package the three producers share, and `@objectstack/metadata-protocol`
 * re-exports it unchanged for every existing importer.
 *
 * This is the same move `engineCanRollBack` made for the same reason — a fact
 * two layers must agree on lives in the layer beneath both, not in a copy each.
 */
export function recordNotFoundError(object: string, id: string | number): Error {
    const err = new Error(`Record ${id} not found in ${object}`) as Error & {
        code?: string;
        status?: number;
        object?: string;
    };
    err.code = 'RECORD_NOT_FOUND';
    err.status = 404;
    err.object = object;
    return err;
}
