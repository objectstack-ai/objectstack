// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29985 codemod] The "Data CRUD" facet of
 * `ObjectStackProtocolImplementation`: the bodies of `probeRecord` moved out of
 * `protocol.ts` whole by `scripts/codemod-split-protocol.mjs`.
 *
 * A MOVE, not a redesign. `ProtocolDataCrudFacet` is a stateless facet over the host
 * (ruling 6624345766): each static method below is the body of the class
 * member of the same name as `packages/metadata-protocol/scripts/host-split.mjs`
 * moves one (ruling E, item E1), with `this.<member>` read as `host.<member>`
 * and nothing else changed. The facet holds no state: the fields stay on the
 * class, and a body reaches them through the host (`protocol-host.ts`).
 *
 * The class keeps every member as a one-line delegation. A public member
 * keeps its docblock there, which the published `.d.ts` prints; a private
 * member's docblock moved here with its body (docblock ownership).
 *
 * What a body reads from elsewhere, it imports from where `protocol.ts`
 * imports it. Nothing re-exports this module, so the published surface does
 * not move.
 */

import type { ProtocolHost } from './protocol-host.js';

export class ProtocolDataCrudFacet {
    /**
     * [#4435] Does this row EXIST? A fact about the database — deliberately
     * NOT "may this caller see it".
     *
     * Read with a system context so no row-level policy narrows it. That is
     * load-bearing, and the first version of this fix got it wrong: probing
     * with the CALLER's context turns the existence gate into an authorization
     * gate, because a row the caller cannot read comes back `null` and the
     * PATCH answers 404. Two things break when it does.
     *
     * 1. It silently changes RLS semantics. Whether an unreadable row may be
     *    written by id is the #1994 pre-image check's decision, made inside
     *    `engine.update` where the write policy lives. A probe in front of it
     *    quietly adds a second, different rule — scope creep into the security
     *    model, from a bug fix about missing records.
     *
     * 2. It disarms a revert-provable security proof. `@proof: rls-by-id-write`
     *    (`packages/qa/dogfood/test/rls-fixture.dogfood.test.ts`, referenced by
     *    the `permission.rowLevelSecurity.using` liveness ledger entry) boots a
     *    fixture whose member can read nothing but has no write policy, and
     *    asserts the runner reports `rls-hole`. A caller-scoped probe 404s that
     *    PATCH, so the RED half goes green — and the gate can no longer prove
     *    it is able to go red. If the #1994 fix were ever reverted, this probe
     *    would MASK it. Accidentally hardening one path is not worth
     *    permanently blinding the gate that watches the whole class.
     *
     * So the probe answers existence only, and authorization stays exactly
     * where it was. The one behaviour this adds is the 404 the issue asked for:
     * an id that names no row at all.
     *
     * ⛔ And what it finds never answers IN FRONT of the write's
     * authorization. Its readers are OCC's `updated_at` comparison, asked only
     * when the caller sent a token ({@link assertVersionMatch}) and answering
     * only for a row the caller's own read returns ({@link assertVersionOf}),
     * and the by-id update's existence check, asked only after `engine.update`
     * has judged and resolved the write (`updateData`, and the bulk faces
     * through {@link assertRecordExists}) — so an update by id answers the same
     * refusal whether or not the id exists, as delete does. With a mismatched
     * token, a caller whose read of the row is refused gets that read refusal.
     */
    static async probeRecord(host: Pick<ProtocolHost, 'engine'>, object: string, id: string): Promise<any> {
        return host.engine.findOne(object, { where: { id }, context: { isSystem: true } });
    }
}
