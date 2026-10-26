// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 cut 12] The publish backfill pair of
 * `ObjectStackProtocolImplementation` — the judgement half a
 * `publishPackageDrafts` backfill runs before anything is promoted
 * (`planPublishBackfill`) and the write half it runs after the publish has
 * committed (`applyPublishBackfill`) — moved out of `protocol.ts` whole.
 *
 * A MOVE, not a redesign. Each function below is the body of the
 * `ObjectStackProtocolImplementation` method of the same name as it stood,
 * re-indented one level and otherwise unedited: the same reads and writes, in
 * the same order, refusing and stopping exactly where they did with the same
 * statuses and messages.
 *
 * ## How the moved bodies reach the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning), as `protocol-batch-data.ts` applies it.
 * The class keeps every method — the published `dist/*.d.ts` lists each one's
 * name, docblock and declared signature — and each body is one literal of
 * exactly the {@link PublishBackfillHost} members that method reads, plus a
 * `.call`. A method is handed over as a closure that calls it on the
 * protocol at call time, so a test double or spy set on the instance is still
 * the one the body reaches. Every other reader of these two methods keeps
 * calling the class method.
 *
 * The field the bodies read, `engine`, goes as a GETTER, so each read happens
 * when the body makes it: tests replace it on a constructed protocol.
 *
 * The module-level declarations of `protocol.ts` the bodies read stay there
 * and are imported from there: `canonicalMetaType`, `clientFacingFailureText`
 * and `clientFacingFailureCode`, which code that did not move reads too; the
 * types `MetadataIssueEntry`, `PublishBackfillEntry` and
 * `PublishBackfillReceipt`, which the class's own signatures name; the refusal
 * `publishBackfillRefusal`, which the backfill request's shape judgement
 * (`readPublishBackfillRequest`) throws too; and `PUBLISH_BACKFILL_PAGE_SIZE`,
 * which sits with that family's declarations. The module cycle is
 * evaluation-safe because every runtime import is read only inside a function
 * body, never while the two modules are first evaluated. `index.ts` names what
 * it publishes from `protocol.ts` one by one, so the `export` some of them
 * gained for this keeps them off the published surface, and nothing
 * re-exports this module, so the published surface does not move.
 */

import type {
    MetadataIssueEntry,
    ObjectStackProtocolImplementation,
    PublishBackfillEntry,
    PublishBackfillReceipt,
} from './protocol.js';
import {
    PUBLISH_BACKFILL_PAGE_SIZE,
    canonicalMetaType,
    clientFacingFailureCode,
    clientFacingFailureText,
    publishBackfillRefusal,
} from './protocol.js';
import type { UpdateManyDataRequest } from '@objectstack/spec/api';
import { type DroppedFieldsEvent, discriminateDefaultValueShape } from '@objectstack/spec/data';

/**
 * The `ObjectStackProtocolImplementation` members the functions below read —
 * every one of them, and no other; each function's `this` is the `Pick` of the
 * members IT reads. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too, and naming a member the class does not have is a compile error.
 * See the module header for which members are getters.
 */
export interface PublishBackfillHost {
    readonly engine: ObjectStackProtocolImplementation['engine'];
    getOverlayRepo: ObjectStackProtocolImplementation['getOverlayRepo'];
    updateManyData: ObjectStackProtocolImplementation['updateManyData'];
}

/** The body of `ObjectStackProtocolImplementation#planPublishBackfill`; the method's docblock there is its contract. */
export async function planPublishBackfill(
    this: Pick<PublishBackfillHost, 'engine' | 'getOverlayRepo'>,
    packageId: string,
    entries: ReadonlyArray<{ object: string; field: string }>,
    drafts: ReadonlyArray<{ type: string; name: string; member?: string }>,
): Promise<PublishBackfillEntry[]> {
    const repo = this.getOverlayRepo();
    const issues: MetadataIssueEntry[] = [];
    const plan: PublishBackfillEntry[] = [];
    const draftFields = new Map<string, Record<string, any> | undefined>();
    for (const [i, e] of entries.entries()) {
        const path = `backfill.${i}`;
        const draft = drafts.find((d) => canonicalMetaType(d.type) === 'object' && d.name === e.object);
        if (!draft) {
            issues.push({
                path,
                message: `Package '${packageId}' has no pending draft of object '${e.object}': a backfill fills `
                    + 'fields this publish adds, so it names an object drafted in this package.',
                code: 'custom',
            });
            continue;
        }
        if (!draftFields.has(e.object)) {
            const ref = { type: draft.type, name: draft.name, org: 'env' } as unknown as Parameters<typeof repo.get>[0];
            const body = typeof repo.get === 'function'
                ? (await repo.get(ref, { state: 'draft' }))?.body as { fields?: unknown } | undefined
                : undefined;
            const fields = body?.fields;
            draftFields.set(
                e.object,
                fields && typeof fields === 'object' && !Array.isArray(fields) ? fields as Record<string, any> : undefined,
            );
        }
        const def = draftFields.get(e.object)?.[e.field];
        if (!def || typeof def !== 'object') {
            issues.push({
                path,
                message: `The draft of object '${e.object}' declares no field '${e.field}'.`,
                code: 'custom',
            });
            continue;
        }
        const live = this.engine?.registry?.getObject?.(e.object) as { fields?: Record<string, unknown> } | undefined;
        if (live?.fields && Object.prototype.hasOwnProperty.call(live.fields, e.field)) {
            issues.push({
                path,
                message: `Field '${e.object}.${e.field}' already exists on the published object, so this publish does `
                    + 'not add it: a backfill fills only fields a publish adds. Change existing rows through the data API.',
                code: 'custom',
            });
            continue;
        }
        const dv = (def as { defaultValue?: unknown }).defaultValue;
        if (dv === undefined || dv === null) {
            issues.push({
                path,
                message: `Field '${e.object}.${e.field}' declares no defaultValue, so there is no value to write: `
                    + 'declare one on the field, or drop it from the backfill.',
                code: 'custom',
            });
            continue;
        }
        const shape = discriminateDefaultValueShape(dv);
        if (shape !== 'literal') {
            issues.push({
                path,
                message: `Field '${e.object}.${e.field}' declares a ${shape === 'token' ? 'runtime token' : 'expression'} `
                    + 'defaultValue, resolved for each new record as it is created; a backfill writes a literal value only.',
                code: 'custom',
            });
            continue;
        }
        plan.push({ object: e.object, field: e.field, value: dv });
    }
    if (issues.length > 0) throw publishBackfillRefusal(packageId, issues);
    return plan;
}

/** The body of `ObjectStackProtocolImplementation#applyPublishBackfill`; the method's docblock there is its contract. */
export async function applyPublishBackfill(
    this: Pick<PublishBackfillHost, 'engine' | 'updateManyData'>,
    packageId: string,
    plan: ReadonlyArray<PublishBackfillEntry>,
    context: unknown,
): Promise<PublishBackfillReceipt> {
    const fields: PublishBackfillReceipt['fields'] = [];
    for (const e of plan) {
        let updated = 0;
        const written = new Set<string>();
        try {
            for (;;) {
                const rows = (await this.engine.find(e.object, {
                    where: { [e.field]: { $null: true } },
                    limit: PUBLISH_BACKFILL_PAGE_SIZE,
                    context,
                } as never)) as Array<{ id?: unknown }> | null | undefined;
                const ids = (rows ?? []).map((r) => r?.id).filter((id): id is string | number =>
                    typeof id === 'string' || typeof id === 'number').map(String);
                if (ids.length === 0) break;
                const stuck = ids.find((id) => written.has(id));
                if (stuck !== undefined) {
                    throw Object.assign(new Error(
                        `Record '${stuck}' of '${e.object}' still has no '${e.field}' after it was written, so a hook `
                        + 'or rule on the object cleared it; the backfill stopped there.',
                    ), { status: 422 });
                }
                const res = await this.updateManyData({
                    object: e.object,
                    records: ids.map((id) => ({ id, data: { [e.field]: e.value } })),
                    options: { continueOnError: false } as UpdateManyDataRequest['options'],
                    context,
                });
                for (const r of res.results ?? []) {
                    if (!r.success) continue;
                    const dropped = (r as { droppedFields?: DroppedFieldsEvent[] }).droppedFields
                        ?.find((ev) => ev.fields.includes(e.field));
                    if (dropped) {
                        throw Object.assign(new Error(
                            `The write of '${e.field}' to record '${String(r.id)}' of '${e.object}' was dropped `
                            + `(${dropped.reason}): this caller cannot set the field; the backfill stopped there.`,
                        ), { status: 403 });
                    }
                    const kept = (r as { data?: Record<string, unknown> }).data;
                    if (kept && Object.prototype.hasOwnProperty.call(kept, e.field) && kept[e.field] == null) {
                        throw Object.assign(new Error(
                            `Record '${String(r.id)}' of '${e.object}' was written with '${e.field}' left empty, so a `
                            + 'hook or rule on the object cleared it; the backfill stopped there.',
                        ), { status: 422 });
                    }
                    written.add(String(r.id));
                    updated++;
                }
                if (!res.success) {
                    const failedRow = (res.results ?? []).find((r) => !r.success);
                    const rowError = (failedRow as { errors?: Array<{ code?: string; message?: string }> } | undefined)?.errors?.[0];
                    const failure = {
                        error: `Record '${String(failedRow?.id)}' of '${e.object}' was not written: `
                            + `${rowError?.message ?? 'the write failed'}; the backfill stopped there.`,
                        ...(rowError?.code ? { code: rowError.code } : {}),
                    };
                    fields.push({ object: e.object, field: e.field, updated, ...failure });
                    console.warn(`[Protocol] publishPackageDrafts backfill of '${e.object}.${e.field}' (package '${packageId}'): ${failure.error}`);
                    break;
                }
            }
            if (!fields.some((f) => f.object === e.object && f.field === e.field)) {
                fields.push({ object: e.object, field: e.field, updated });
            }
        } catch (err: unknown) {
            const code = clientFacingFailureCode(err);
            console.warn(
                `[Protocol] publishPackageDrafts backfill of '${e.object}.${e.field}' (package '${packageId}') `
                + `stopped after ${updated} row(s): ${(err as Error)?.message ?? String(err)}`,
            );
            fields.push({
                object: e.object, field: e.field, updated,
                error: clientFacingFailureText(err, 'the backfill failed; the reason is in the server log'),
                ...(code ? { code } : {}),
            });
        }
    }
    return { success: fields.every((f) => f.error === undefined), fields };
}
