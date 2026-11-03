// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 E2 cut 1a] The audit and UI-view reads of `ObjectStackProtocolImplementation`:
 * `auditMetaItem` (one item's layers, as the audit route answers them) and
 * `getUiView` (the view an object renders with).
 *
 * A MOVE, not a redesign. Each function below is the body of the class method
 * of the same name as it stood, re-indented one level, with `this.<member>`
 * read as `host.<member>` and nothing else changed
 * (`node scripts/host-split.mjs check <base> <member> protocol-meta-audit-ui-view.ts`
 * proves it). Each method stays on the class with its docblock and signature,
 * which the published `.d.ts` prints, and hands its body the host
 * (`protocol-host.ts`).
 *
 * What a body reads from elsewhere, it imports from where `protocol.ts`
 * imports it. Nothing re-exports this module, so the published surface does
 * not move.
 */

import type { MetadataLock } from '@objectstack/spec/kernel';
import type { ProtocolHost } from './protocol-host.js';
import { canonicalizeMetaRequestType } from './protocol-meta-type-schema.js';

/** The body of `ObjectStackProtocolImplementation#auditMetaItem`; the method's docblock there is its contract. */
export async function auditMetaItem(host: Pick<ProtocolHost, 'engine' | 'findEnvironmentRows' | 'rethrowUnlessMetadataStoreUnprovisioned'>, request: {
        type: string;
        name: string;
        limit?: number;
    }): Promise<{
        events: Array<{
            id: unknown;
            occurredAt: string;
            actor: string;
            source: string | null;
            operation: 'save' | 'publish' | 'rollback' | 'delete' | 'reset';
            outcome: 'allowed' | 'denied' | 'forced';
            code: string;
            lockState: MetadataLock | null;
            lockOverridden: boolean;
            requestId: string | null;
            note: string | null;
        }>;
    }> {
    // [#9157] #4432 / #7894 — CANONICAL TYPE KEY, and the first of the three
    // READ verbs to get it. See {@link canonicalMetaType}.
    //
    // `auditMetaItem` serves `GET /api/v1/meta/:type/:name/audit`
    // (`rest-route-ledger.ts:180`, caller-supplied `:type`) and derived its
    // key from `PLURAL_TO_SINGULAR` — the MANIFEST-COLLECTION map #7894
    // moved this boundary off. The one-line replacement #8769
    // (`publishMetaItem`), #8819 (`rollbackMetaItem`) and #8868
    // (`diffMetaItem`) each made on a write verb.
    //
    // Ruled by the maintainer on 2026-08-16 (#9180 step ①): the `/meta`
    // type segment is singular, always. What the fold reaches here,
    // measured rather than assumed:
    //
    //  • the `where.type` of the `sys_metadata_audit` read below. For the
    //    four MANIFEST-ABSENT types (`field`, `seed`, `external_catalog`,
    //    `translation` — legitimately absent from the manifest map because
    //    they are not stack collections) the plural stayed plural all the
    //    way into that `where`, matched no row, and this method answered
    //    `{ events: [] }` for an item that HAS an audit trail. Not a
    //    refusal and not an error: the empty-accumulator shape (#8896)
    //    delivered to an operator who is reading the protection log right
    //    before a rename or a delete.
    //  • the #7894 boundary REFUSAL, which never ran on this verb: it lives
    //    INSIDE `canonicalizeMetaRequestType`, so an unrecognised spelling
    //    of a declared type (`viewes`) was forwarded to the plugin path and
    //    answered 200-empty instead of 400 naming `view` / `views`.
    //
    // ⚠️ What it does NOT do, stated because the filing card claimed
    // otherwise and the claim was measured false: it does not refuse
    // `views`. `metaUrlSpellingRefusal('views')` is `null` — a RECOGNISED
    // plural is in `META_URL_TO_SINGULAR` and therefore FOLDS. Retiring the
    // recognised plural spellings themselves is #9180 step ③, deliberately
    // not bundled here.
    //
    // Placed before the `try` on purpose: the catch below answers
    // `{ events: [] }` for an unprovisioned table, and a caller error
    // swallowed into that shape is exactly the 200-empty this closes.
    request = canonicalizeMetaRequestType(request);
    // Canonical by construction from the fold above. NOT a second fold —
    // the `PLURAL_TO_SINGULAR` lookup that used to stand here is what #7894
    // removed from this boundary. The binding survives under its own name
    // because the read below consumes it as "the key the row is stored
    // under", the shape {@link diffMetaItem} keeps.
    const singular = request.type;
    const limit = Math.min(
        Math.max(1, request.limit ?? 100),
        500,
    );
    // [ADR-0131 D6] The environment's audit trail only — the scope is
    // built here, unconditionally (#8747: nothing below this method
    // scopes the read). A legacy organization-scoped audit row is not
    // read; the v18 migration ceremony carries its organization's rows.
    // [#9638] The FIRST of the two benign causes the catch below used to
    // name, asked as a PRECONDITION rather than as an error shape.
    //
    // `MetadataHostEngine` carries `[key: string]: any`, so a metadata-only
    // store or a partial test double with no `find` satisfies the type and
    // reaches here. That is a real, documented deployment shape and it must
    // keep answering `{ events: [] }`.
    //
    // ⚠️ Asked HERE, before the `try`, because it cannot be asked soundly
    // INSIDE the catch. Measured: a missing method raises
    // `TypeError: this.engine.find is not a function`, which
    // `isMissingTableError` correctly reports as NOT benign — but the only
    // signal separating it from a genuine `TypeError` raised *inside* a
    // real driver's `find` (a malformed row, a null deref — actual faults)
    // is the V8 message text. Sniffing that text would re-open exactly the
    // fail-open this card closes, one error class narrower. A `typeof`
    // probe is a fact about the engine, not a guess about an error, so it
    // cannot misclassify a fault as a capability gap.
    //
    // Same shape as the sibling limb one layer up: the `/audit` route's own
    // capability probe (`typeof p.auditMetaItem !== 'function'`, #9426)
    // likewise decides BEFORE the call rather than classifying its failure.
    if (typeof (host.engine as { find?: unknown }).find !== 'function') {
        console.warn(
            `[Protocol] auditMetaItem: host engine exposes no \`find\`; `
            + `reporting no audit entries for ${request.type}/${request.name}`,
        );
        return { events: [] };
    }
    try {
        // Every row is the environment's (ADR-0131 D6; no organization
        // column since C7b).
        const where: Record<string, unknown> = {
            type: singular,
            name: request.name,
        };
        // `order`, NOT `direction`: the QueryAST sort shape is
        // `SortNodeSchema` = `{ field, order }`, and both drivers normalize
        // off `.order` with no fallback. `direction` is another contract's
        // vocabulary (better-auth's adapter `sortBy`) and is silently DROPPED here (the schema is not
        // `.strict()`), which left this query running ascending — the
        // OLDEST `limit` audit events, i.e. the beginning of an object's
        // life and never its recent changes (#4674). The `as any` is gone
        // for the same reason: `EngineQueryOptionsParsed` rejects the wrong key,
        // and erasing the type is what let it through.
        // [#21908, ADR-0096 D5] The explicit system opt-in: the audit
        // trail is a platform store the audit door already authorized the
        // caller to read; the protocol builds the `where` itself.
        // Principal-less, the engine refuses it and this door answered 503.
        const rows = await host.findEnvironmentRows('sys_metadata_audit', {
            where,
            orderBy: [{ field: 'occurred_at', order: 'desc' }],
            limit,
            context: { isSystem: true },
        });
        const events = (Array.isArray(rows) ? rows : []).map((r: any) => ({
            id: r.id,
            // [#14078] The `Date` arm is TOTAL. Ruled B by the maintainer
            // (2026-09-02): every copy of this shared canonical-ISO
            // spelling guards on `Number.isNaN(value.getTime())`, all five
            // arms in ONE change, because a guard on some arms and not
            // others re-opens the drift the single spelling closed.
            // Reachability is MEASURED (commit `3ecb7dc1a`): mysql2 3.23.1
            // hands back a constant literally named `INVALID_DATE` for a
            // zero `DATETIME`, and postgres-date 1.0.7 builds
            // `new Date(NaN)` for every year in 275760..294276, which
            // Postgres itself stores. Unguarded, `toISOString()` raises
            // `RangeError: Invalid time value` and
            // `GET /api/v1/meta/:type/:name/audit` answers 500 — Studio's
            // 审计日志 tab blank, on a row the error does not name.
            // The terminal value here is the VISIBLE TEXT `"Invalid Date"`:
            // the guard fails, the value falls into the `String(...)` arm
            // already below (which renders exactly that), and
            // `AuditMetaItemResponseSchema.events[].occurredAt` is a
            // REQUIRED plain `z.string()` an operator reads — the ruling's
            // "required and an operator reads it". ⛔ Not `''`: a silent
            // blank hides the producer's bug.
            occurredAt:
                typeof r.occurred_at === 'string'
                    ? r.occurred_at
                    : r.occurred_at instanceof Date && !Number.isNaN(r.occurred_at.getTime())
                        ? r.occurred_at.toISOString()
                        : String(r.occurred_at ?? ''),
            actor: String(r.actor ?? 'system'),
            source: r.source ?? null,
            operation: r.operation,
            outcome: r.outcome,
            code: String(r.code ?? ''),
            lockState: (r.lock_state ?? null) as MetadataLock | null,
            lockOverridden: Boolean(r.lock_overridden),
            requestId: r.request_id ?? null,
            note: r.note ?? null,
        }));
        return { events };
    } catch (err: any) {
        // [#9638] Benign (the table has not been provisioned in this legacy
        // env) falls through to the empty answer; everything else is a read
        // that DID NOT HAPPEN and leaves as a 503. Byte-for-byte the shape
        // the sibling {@link listCommits} carries (#5980), and the same
        // {@link isMissingTableError} predicate `DatabaseLoader` (#5108) and
        // `SysMetadataRepository` (#4867) ask — a driver quirk is taught to
        // the platform once rather than re-spelled per seam.
        //
        // This `catch` used to be UNQUALIFIED. A connection drop, a
        // permission denial, a malformed row, a query bug or a timeout was
        // reported to the caller as the well-formed statement "this item has
        // no audit entries" — ADR-0110 D3 broken (a miss and a fault are
        // different facts) on the COMPLIANCE surface. `auditMetaItem` is the
        // read behind `GET /api/v1/meta/:type/:name/audit`, which exists so
        // Studio's 审计日志 tab can show who tried what and whether a lock
        // blocked it; an empty answer there reads as *nobody touched this
        // item*. Worse than the static capability gap #9426 fixed one layer
        // up, because a transient read failure makes the same item report a
        // full trail one minute and a clean one the next. The `console.warn`
        // below is on the SERVER; it was never an answer to the reader.
        //
        // The second cause the old comment named — a host engine with no
        // `find` — is decided by the precondition probe above the `try`, so
        // it never reaches here and this arm has exactly ONE benign cause.
        host.rethrowUnlessMetadataStoreUnprovisioned(err, 'sys_metadata_audit');
        console.warn(
            `[Protocol] auditMetaItem read failed for ${request.type}/${request.name}: ${err?.message ?? err}`,
        );
        return { events: [] };
    }
}

/** The body of `ObjectStackProtocolImplementation#getUiView`; the method's docblock there is its contract. */
export async function getUiView(host: Pick<ProtocolHost, 'engine'>, request: { object: string, type: 'list' | 'form' }) {
    const schema = host.engine.registry.getObject(request.object);
    if (!schema) throw new Error(`Object ${request.object} not found`);

    const fields = schema.fields || {};
    const fieldKeys = Object.keys(fields);

    if (request.type === 'list') {
        // Intelligent Column Selection
        // 1. Always include 'name' or name-like fields
        // 2. Limit to 6 columns by default
        const priorityFields = ['name', 'title', 'label', 'subject', 'email', 'status', 'type', 'category', 'created_at'];
        
        // [commit 2a75270b1] `!fields[k].hidden` belongs on BOTH passes. It used to
        // sit on the fill pass alone, so a field declared `hidden: true`
        // was dropped for eight of nine spellings and SERVED — label and
        // all — for the ninth: whenever the author happened to name it one
        // of `priorityFields`. `email`, `status`, `type`, `category`,
        // `subject`, `title` are exactly the names an author reaches for,
        // so the failing case was the ordinary one, and nothing at
        // authoring time said otherwise. `hidden` is declared "Hidden from
        // default UI" (`FieldSchema`, `packages/spec/src/data/field.zod.ts`)
        // and this function IS the default UI, so the declaration is a
        // floor here or it is a floor nowhere.
        //
        // The `form` branch below already filtered every hidden field
        // uniformly, so the two branches of ONE producer disagreed about
        // what `hidden` means. This brings the priority pass to the side
        // that already honoured the declaration — restoring a stated
        // invariant, ⛔ not redesigning what `hidden` governs. Dropping a
        // hidden column also removes it from `searchableFields` below,
        // which is derived from `columns`.
        let columns = fieldKeys.filter(k => priorityFields.includes(k) && !fields[k].hidden);
        
        // If few priority fields, add others until 5
        if (columns.length < 5) {
            const remaining = fieldKeys.filter(k => !columns.includes(k) && k !== 'id' && !fields[k].hidden);
            columns = [...columns, ...remaining.slice(0, 5 - columns.length)];
        }
        
        // Sort columns by priority then alphabet or schema order
        // For now, just keep them roughly in order they appear in schema or priority list
        
        return {
            // [#5948] `object` sits on the CONTAINER, not on the view member.
            // `ViewSchema` declares it here ("Object this container binds to")
            // and `ListViewSchema` / `FormViewSchema` are `strictObject` that
            // never declared it — so the old member-level copy made the real
            // response fail its own declared schema with `unrecognized_keys`.
            // Nothing read it (measured: `useView` passes the body through as
            // `any`, objectui never calls `meta.getView`), so this is a
            // relocation, not a removal: readers move up one level.
            object: request.object,
            list: {
                type: 'grid' as const,
                label: schema.label || schema.name,
                columns: columns.map(f => ({
                    field: f,
                    label: fields[f]?.label || f,
                    sortable: true
                })),
                // `hidden` withholds the column; it does not govern the derived default sort (ruled 2026-09-01).
                sort: fields['created_at'] ? ([{ field: 'created_at', order: 'desc' }] as any) : undefined,
                searchableFields: columns.slice(0, 3) // Make first few textual columns searchable
            }
        };
    } else {
         // Form View Generation
         // Simple single-section layout for now
         const formFields = fieldKeys
            .filter(k => k !== 'id' && k !== 'created_at' && k !== 'updated_at' && !fields[k].hidden)
            .map(f => ({
                field: f,
                label: fields[f]?.label,
                required: fields[f]?.required,
                readonly: fields[f]?.readonly,
                type: fields[f]?.type,
                // Default to 2 columns for most, 1 for textareas
                colSpan: (fields[f]?.type === 'textarea' || fields[f]?.type === 'html') ? 2 : 1,
                // `FormField.span` defaults to 'auto'; this view is hand-built
                // rather than run through `FormFieldSchema.parse()`, so the
                // default is spelled out to make the returned object a real
                // parsed `View` (the same reason the section below states its
                // own `collapsible` / `collapsed` / `columns` defaults). Was
                // unnoticed while `FormField` resolved to `any` (#4171).
                span: 'auto' as const
            }));

         return {
            // [#5948] Same relocation as the list branch above. The dropped
            // `label` is NOT relocated: it was `Edit ${…}` — a rendered UI
            // string, not metadata, and `FormViewSchema` deliberately has no
            // `label`. The caller already knows the object it asked for, so
            // the heading is the UI's to compose.
            object: request.object,
            form: {
                type: 'simple' as const,
                sections: [
                    {
                        label: 'General Information',
                        columns: 2 as const,
                        collapsible: false,
                        collapsed: false,
                        fields: formFields
                    }
                ]
            }
        };
    }
}
