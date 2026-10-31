// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 E0] Part of the module preamble of `protocol.ts`, moved here verbatim:
 * the shallow diff, destructive object change detection, the metadata write face and the destructive-change remedy.
 *
 * A MOVE, not a redesign: every declaration below is byte-identical to the text
 * that stood above `ObjectStackProtocolImplementation`; only the imports and the
 * export list at the foot are new. `protocol.ts` re-exports what it exported.
 */
import {
    isVirtualSearchField,
    type SearchFieldMeta,
} from '@objectstack/spec/data';

/**
 * Phase 3a-destructive: detect changes between an existing object schema
 * and an incoming overlay that would break runtime data — removed fields,
 * field type narrowing, required toggled on without a default, a stored
 * amount switched to `currencyMode: 'record'` (rows left codeless). Returned
 * issues are surfaced as HTTP 409 `destructive_change` unless the caller
 * sets `force: true`, letting the admin UI render a warning dialog before
 * proceeding.
 *
 * Scope is intentionally narrow for MVP: covers the most common
 * data-loss footguns for `object` and `field` types. Subsequent passes
 * can layer in relationship changes, enum-value removals, etc.
 */
/**
 * Shallow JSON diff used by `diffMetaItem`. Compares the top-level
 * keys of `from` vs `to`; primitive value changes are reported as
 * `changed`, nested objects/arrays that differ structurally are also
 * reported as a single `changed` entry (deep structural diffs are out
 * of scope — Studio renders the full bodies for a side-by-side view).
 */
function diffShallow(
    from: Record<string, unknown>,
    to: Record<string, unknown>,
): {
    added: Array<{ path: string; value: unknown }>;
    removed: Array<{ path: string; value: unknown }>;
    changed: Array<{ path: string; from: unknown; to: unknown }>;
} {
    const added: Array<{ path: string; value: unknown }> = [];
    const removed: Array<{ path: string; value: unknown }> = [];
    const changed: Array<{ path: string; from: unknown; to: unknown }> = [];
    const fromKeys = new Set(Object.keys(from ?? {}));
    const toKeys = new Set(Object.keys(to ?? {}));
    for (const k of toKeys) {
        if (!fromKeys.has(k)) {
            added.push({ path: k, value: (to as any)[k] });
        } else {
            const a = (from as any)[k];
            const b = (to as any)[k];
            const aStr = JSON.stringify(a);
            const bStr = JSON.stringify(b);
            if (aStr !== bStr) {
                changed.push({ path: k, from: a, to: b });
            }
        }
    }
    for (const k of fromKeys) {
        if (!toKeys.has(k)) {
            removed.push({ path: k, value: (from as any)[k] });
        }
    }
    return { added, removed, changed };
}

function detectDestructiveObjectChanges(prev: any, next: any): Array<{
    code: string;
    field?: string;
    message: string;
}> {
    if (!prev || typeof prev !== 'object' || !next || typeof next !== 'object') return [];
    const prevFields = (prev.fields && typeof prev.fields === 'object') ? prev.fields as Record<string, any> : {};
    const nextFields = (next.fields && typeof next.fields === 'object') ? next.fields as Record<string, any> : {};

    const issues: Array<{ code: string; field?: string; message: string }> = [];

    // [#24411] Every finding below names STORED data a save makes unreachable,
    // so a field with no stored column (a `formula`, computed on read —
    // ADR-0079 addendum, item 9) loses nothing when it is removed or retyped.
    // "Stored" is the spec's storage predicate — the one the sortability
    // projection reads — judged from the field's own declaration, ⛔ never a
    // type list kept here. A false finding trains callers to send `force=true`
    // by reflex, which silences the true one on a stored field.
    const isStored = (field: SearchFieldMeta | undefined): boolean => !isVirtualSearchField(field);

    // Removed fields — silently dropping a column is a data-loss event.
    for (const fname of Object.keys(prevFields)) {
        // Skip system fields — those are managed by applySystemFields and
        // re-injected on every registerObject call; they will look "removed"
        // in any user-supplied overlay.
        if (prevFields[fname]?.system) continue;
        if (!isStored(prevFields[fname])) continue;
        if (!(fname in nextFields)) {
            issues.push({
                code: 'field_removed',
                field: fname,
                message: `Field '${fname}' removed — existing data in this column will become inaccessible.`,
            });
        }
    }

    // Field type changes — narrowing or incompatible conversions.
    const TYPE_COMPATIBILITY: Record<string, Set<string>> = {
        text: new Set(['textarea', 'markdown', 'html', 'code']),
        number: new Set([]),
        boolean: new Set([]),
        date: new Set(['datetime']),
        datetime: new Set(['date']),
    };
    for (const fname of Object.keys(nextFields)) {
        const prevField = prevFields[fname];
        const nextField = nextFields[fname];
        if (!prevField) continue; // brand-new field — non-destructive
        const prevType = prevField.type;
        const nextType = nextField.type;
        // Judged by what the STORED side loses: an unstored previous field held
        // no values, so retyping it into anything starts from an empty column.
        if (prevType && nextType && prevType !== nextType && isStored(prevField)) {
            const compatible = TYPE_COMPATIBILITY[prevType]?.has(nextType);
            if (!compatible) {
                issues.push({
                    code: 'field_type_change',
                    field: fname,
                    message: `Field '${fname}' type changed from '${prevType}' to '${nextType}' — existing values may not convert cleanly.`,
                });
            }
        }
        // required toggled on without a default — new inserts will start
        // to fail validation, and any null rows already in the table will
        // fail on next save.
        if (!prevField.required && nextField.required && nextField.defaultValue === undefined) {
            issues.push({
                code: 'field_required_no_default',
                field: fname,
                message: `Field '${fname}' is now required but has no default value — existing rows with null values may fail validation.`,
            });
        }
        // [ADR-0144, ruling 6492000994] An existing amount switched to
        // `currencyMode: 'record'` — the sibling of `field_required_no_default`:
        // a one-word config edit that leaves every stored row owing a value.
        // The rows already stored hold an amount and no code; the switch is
        // allowed (the write guard refuses such a row only when a write
        // touches the pair), so this finding acknowledges it and names the
        // explicit backfill. Like its siblings it reads no row: whether the
        // table holds any is not this gate's to judge, and a finding over an
        // empty table costs one `force`. Judged by what the STORED side holds,
        // so a previously unstored field (a formula) raises nothing.
        if (
            nextField?.type === 'currency'
            && nextField.currencyConfig?.currencyMode === 'record'
            && prevField.currencyConfig?.currencyMode !== 'record'
            && isStored(prevField)
        ) {
            const objectName = typeof next.name === 'string' && next.name ? next.name : prev.name;
            const codeField = typeof nextField.currencyConfig.currencyField === 'string'
                ? `'${nextField.currencyConfig.currencyField}'`
                : 'its currency code field';
            issues.push({
                code: 'currency_mode_to_record',
                field: fname,
                message: `Field '${fname}' switched to currencyMode 'record' — rows already stored with an amount and a blank ${codeField} `
                    + 'display as a plain number, fall into the null group of a grouped aggregate, and sit outside every '
                    + 'currency-paired filter until they hold a code; once saved, write it with '
                    + `\`os migrate record-currency-codes --object ${objectName} --field ${fname} --code <ISO 4217 code>\``
                    + ' (a dry run; add --apply to write).',
            });
        }
    }
    return issues;
}

/**
 * [commit 82cb6e849] The remedy clause the Phase 3a-destructive refusal ends with — one
 * sentence per FACE, because the mechanism that lifts the refusal is not the
 * same on every door that raises it.
 *
 * The refusal is raised in ONE place ({@link ObjectStackProtocolImplementation.saveMetaItem}'s
 * Phase 3a-destructive gate) and is quoted onto whatever response the caller's
 * catch builds, so the clause used to read `re-submit with ?force=true to
 * proceed.` on every face. That is correct prose for exactly one of them —
 * `PUT /api/v1/meta/:type/:name`, whose route reads `?force` and threads it
 * into the request — and a caller on any OTHER face who does what the sentence
 * says gets the identical refusal back.
 *
 * MEASURED on the face this card was filed on: `POST /packages/:id/duplicate`
 * accepts `targetPackageId`, `targetName`, `targetNamespace`, `organizationId`
 * and `actor` — no `force`, in the query string or the body — and
 * {@link ObjectStackProtocolImplementation.duplicatePackage}'s own request type
 * has no `force` field either, so its internal `saveMetaItem` call cannot carry
 * one. There is nothing on that door for the caller to set.
 *
 * ⛔ What is repaired is the CLAUSE, not the door. Giving the duplicate route a
 * `force` would widen a public surface and is a contract decision, deliberately
 * NOT taken here. Nor is the clause deleted on that face: commit 809e61221 measured that
 * `duplicatePackage`'s `failed[].error` is the SOLE carrier of this
 * prescription, so deleting the remedy there deletes it from the wire outright.
 * Each face therefore states the remedy it actually has.
 *
 * ⚠️ An absent `face` renders the `?force=true` wording, byte-identical to what
 * every face carried before. That default is right on BOTH REST `PUT` doors and
 * on nothing else that reaches this gate today — see the `[#11095]` section of
 * `protocol.destructive-409-face-inventory.test.ts` for the full inventory.
 *
 * ## [#11095] The two doors commit 82cb6e849 left open, and why they were split
 *
 * Commit 82cb6e849's note recorded two further faces that reached this gate and never
 * threaded `force`, and filed the disposition as a contract question rather
 * than guessing it. The ruling was a SPLIT — one door repaired by threading the
 * parameter, the other by telling the truth — and the split is the decision,
 * not an accident of convenience:
 *
 *  - `@objectstack/rest`'s compound-name `PUT /meta/:type/:a/:b` now THREADS
 *    `?force=true`, so the default clause became TRUE there instead of being
 *    reworded. That half is #7019's ruling applied once more, with its reason:
 *    the compound route is "word for word the same operation" as its
 *    single-segment twin — one generic `saveMetaItem` reached by a name spelled
 *    in two segments — and gating only the single-segment door was MEASURED to
 *    leave the compound one a bypass of it. Every divergence found between the
 *    pair since has been closed for that same reason (#6603/#7019's capability
 *    gate, #8805's write-side organization, #7035's 501 envelope). One door
 *    reading `?force` and its literal twin ignoring it was the same shape.
 *  - `@objectstack/runtime`'s dispatcher `PUT /meta` does NOT gain `force`, and
 *    states `'meta-dispatch'` below instead. It has no twin precedent and a
 *    different call shape: that branch is reached with a path, a method and a
 *    body — there is no query string on the transport at all, so `?force=true`
 *    names a slot that does not exist rather than one that was forgotten. Its
 *    clause says so, and prescribes what a caller can actually do there.
 *
 * ⛔ Do not "harmonise" these two later by giving the dispatcher a `force`
 * field. The compound door's parity argument is a statement about ONE pair of
 * routes that spell one name two ways; it is not a general licence, and the
 * dispatcher is not the third member of that pair.
 *
 * ## [#21841] The external-table import, and why it went the dispatcher's way
 *
 * "Import as Object" (`@objectstack/service-datasource`) saves through this
 * gate since #21788, so a re-import that would shrink an object it created is
 * refused here and relayed as `400 EXTERNAL_IMPORT_ERROR`. The import route
 * reads no `force`, so the default clause sent that caller round in a circle.
 * It states `'external-import'` and gets a clause of its own rather than a
 * `force`, for the reasons the dispatcher did and one more: the route has no
 * twin that reads `?force`, and no first-party caller re-imports through it
 * (the console's import dialog saves its draft through
 * `PUT /api/v1/meta/object/:name`, the very door this clause names), so a
 * `force` there would be a new capability with nothing pulling on it. Unlike
 * the dispatcher, a door that DOES read `?force` exists for the same item, so
 * the clause names it instead of only telling the caller to reconcile.
 *
 * ⛔ Same warning as above: the import is not a twin of the `PUT` door, and
 * giving it a `force` to "match" would be a new surface, not a repair.
 */
/**
 * [commit 82cb6e849 / commit d806081dd] Which write door a `saveMetaItem` refusal is being
 * rendered FOR. Stated by the SERVER — either by the protocol's own internal
 * call ({@link ObjectStackProtocolImplementation.duplicatePackage}) or by the
 * in-process HTTP boundary that owns the response envelope — never by a remote
 * caller: no write door spreads a request body into the `saveMetaItem` request
 * object, so there is no path for a client to smuggle a face in (pinned in
 * both face-inventory suites).
 *
 * Two refusals read this, and they read it for DIFFERENT questions:
 *
 *  - {@link destructiveChangeRemedy} (409) — which remedy actually exists on
 *    this door;
 *  - {@link specValidationFindings} (422) — whether a structured `issues[]`
 *    channel reaches the consumer beside the message.
 *
 * A door therefore answers both questions by naming itself once, and neither
 * switch may assume the other's default. `'meta-envelope'` deliberately keeps
 * the 409's `?force=true` wording (it is both REST `PUT` doors' genuine remedy,
 * since #11095 threaded the parameter on the compound-name twin) while changing
 * the 422's clause.
 *
 * ⚠️ [#11095] `'meta-dispatch'` is the first face that differs from another on
 * ONE of the two questions and agrees with it on the other: the runtime
 * dispatcher carries `issues[]` structurally exactly as the REST doors do
 * (`errorFromThrown` → `details.issues`), so its 422 clause is `'meta-envelope'`'s,
 * while its 409 clause must differ because that door has no `force` to name.
 * That is the two-switch independence this comment asserts, arriving as a real
 * case rather than a hypothetical — which is why {@link specValidationFindings}
 * lists the two faces on one `case` instead of letting `'meta-dispatch'` fall
 * to a default that was never written for it.
 *
 * ⚠️ [#21841] `'external-import'` differs from `'meta-dispatch'` on that SAME
 * second question, in the other direction: the import route relays a refusal
 * as `sendError(res, 400, 'EXTERNAL_IMPORT_ERROR', message)` and nothing else,
 * so no `issues[]` reaches its caller and the message is the sole carrier of
 * the findings. It therefore stays OUT of {@link specValidationFindings}'
 * trimming case and keeps the full-prose default — the polarity that comment
 * defends, working as designed for a door added after it.
 *
 * ⚠️ [ADR-0131 D6] `'package-unmanaged-import'` is stated by
 * {@link ObjectStackProtocolImplementation.importUnmanagedPackage}, the
 * `unmanaged` install mode's copy-once import, for every item it writes. Its
 * refusal is relayed by that verb's own thrown error. The thrown value does
 * forward the save door's `issues` (the rollback keeps the cause's code,
 * status and issues), but the one door that calls the verb —
 * `POST /api/v1/marketplace/install-local` with `installMode: 'unmanaged'`
 * (`@objectstack/cloud-connection`) — answers with the message, the code and
 * `details` only, so no `issues[]` reaches its caller beside the message and
 * the message is the sole carrier of the findings: it keeps the full-prose
 * default on the 422, the polarity `'external-import'` keeps for the same
 * reason. A door that starts relaying `issues` moves this face into
 * {@link specValidationFindings}' trimming case in the same change. Its 409
 * clause is its own: the import accepts no `force`, and it writes only names
 * no environment row held when it began.
 */
export type MetadataWriteFace =
    | 'package-duplicate'
    | 'meta-envelope'
    | 'meta-dispatch'
    | 'external-import'
    | 'package-unmanaged-import';

function destructiveChangeRemedy(
    face: MetadataWriteFace | undefined,
    name: string,
): string {
    switch (face) {
        case 'package-duplicate':
            // The duplicate-AGAIN workflow: the target namespace already holds
            // the renamed item this copy is about to overwrite. Both remedies
            // are things the caller can actually do on THIS door — choose a
            // free target namespace, or make the collision non-destructive.
            return `this copy cannot be forced: the duplicate door accepts no \`force\`. `
                + `Duplicate into a target namespace that does not already hold '${name}', `
                + `or reconcile that item with the source first.`;
        case 'meta-dispatch':
            // [#11095] The runtime dispatcher's `/meta` PUT. Unlike the two REST
            // `PUT` doors — which read `?force` off a query string and, since
            // this card, BOTH thread it — this branch is reached with a path, a
            // method and a body and nothing else. `?force=true` does not name a
            // parameter this door forgot to read; it names a channel the
            // transport does not have, which is why threading it here would be
            // a new surface rather than a repair, and was ruled out.
            //
            // Both clauses are things the caller can do on THIS door: send a
            // body that does not drop what the stored item still carries, or go
            // and reconcile that item first. Same grammar as the duplicate face
            // above — name the door, deny the mechanism, then prescribe.
            return `this save cannot be forced: the dispatcher's \`PUT /meta\` accepts no \`force\`. `
                + `Re-submit '${name}' with a body that keeps the fields and types named above, `
                + `or reconcile that stored item first.`;
        case 'external-import':
            // [#21841] "Import as Object" (`@objectstack/service-datasource`),
            // relayed by the import route as `400 EXTERNAL_IMPORT_ERROR`. That
            // route reads no `force` and was deliberately not given one (see the
            // section above `MetadataWriteFace`). Both remedies are things the
            // caller can do from where they stand: import the table under a
            // name nothing stores yet, or save the changed definition through
            // the metadata door, which reads `?force=true` for this very item
            // and is where a destructive change is acknowledged on purpose.
            // Same grammar as the two faces above — name the door, deny the
            // mechanism, then prescribe.
            return `this import cannot be forced: the external-table import route accepts no \`force\`. `
                + `Import the table under a new \`name\`, or save the changed definition of '${name}' `
                + `through \`PUT /api/v1/meta/object/${name}?force=true\`, which accepts the destructive change on purpose.`;
        case 'package-unmanaged-import':
            // [ADR-0131 D6] The `unmanaged` install mode's copy-once import.
            // It refuses every name an environment row already holds before
            // it writes anything, so reaching this gate means a row appeared
            // under the name while the import ran. The import accepts no
            // `force`; what the caller can do is reconcile the item that
            // appeared, then import again. What became of the base is the
            // verb's own sentence around this one, which it writes only once
            // it has read the rollback's outcome — never claimed here. Same
            // grammar as the faces above — name the door, deny the mechanism,
            // then prescribe.
            return `this import cannot be forced: the unmanaged install accepts no \`force\`. `
                + `Reconcile the environment item '${name}' that appeared while the import ran, then install again.`;
        default:
            return 're-submit with ?force=true to proceed.';
    }
}

// Shared with `protocol.ts` and the sibling preamble modules; module-private before the move.
export { destructiveChangeRemedy, detectDestructiveObjectChanges, diffShallow };
