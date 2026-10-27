// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 cut 14] Two helpers of `ObjectStackProtocolImplementation`'s publish
 * batch: the seed apply that loads a package's seed bodies after the batch
 * promotes (`applySeedBodies`) and the collection of the batch's own pending
 * declarations the runtime-authoring gate judges a draft against
 * (`collectBatchPendingDeclarations`), moved out of `protocol.ts` whole.
 *
 * A MOVE, not a redesign. Each function below is the body of the
 * `ObjectStackProtocolImplementation` method of the same name as it stood,
 * re-indented one level and otherwise unedited: the same reads, in the same
 * order, answering with the same receipts and the same degradations.
 *
 * ## How the moved bodies reach the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning), as `protocol-batch-data.ts` applies it.
 * The class keeps every method — the published `dist/*.d.ts` lists each one's
 * name, docblock and declared signature — and each body is one literal of
 * exactly the {@link PublishBatchHost} members that method reads, plus a
 * `.call`. The engine is handed over as a getter, so the body reads the
 * protocol's engine at call time; a method is handed over as a closure that
 * calls it on the protocol at call time, so a test double or spy set on the
 * instance is still the one the body reaches. Every other reader of these two
 * methods keeps calling the class method.
 *
 * `applySeedBodies` reads `getMetaItem` through an `any` cast inside the
 * loader's metadata adapter, so the host carries it although no `this.X`
 * spelling names it. `warnClosureReadUnavailable` stays in the class: it
 * writes the instance's `closureReadWarned` flag.
 *
 * What the bodies read of `protocol.ts`'s own module-level declarations they
 * import from it; what they import from elsewhere, they import from where
 * `protocol.ts` imported it. Nothing re-exports this module, so the published
 * surface does not move.
 */

import type { IFieldFileService } from '@objectstack/spec/contracts';
import type { ObjectStackProtocolImplementation } from './protocol.js';
import {
    canonicalMetaType,
    clientFacingFailureText,
    declaresClientRefusal,
    memberOption,
    seedRequestValidationError,
} from './protocol.js';
import { CLOSURE_CONTEXT_KEY_BY_TYPE, type RuntimePendingDeclarations } from './runtime-authoring-gate.js';

/**
 * The `ObjectStackProtocolImplementation` members the functions below read —
 * every one of them, and no other; each function's `this` is the `Pick` of the
 * members IT reads. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too, and naming a member the class does not have is a compile error.
 */
export interface PublishBatchHost {
    readonly engine: ObjectStackProtocolImplementation['engine'];
    getMetaItem: ObjectStackProtocolImplementation['getMetaItem'];
    getOverlayRepo: ObjectStackProtocolImplementation['getOverlayRepo'];
    warnClosureReadUnavailable: ObjectStackProtocolImplementation['warnClosureReadUnavailable'];
}

/** The body of `ObjectStackProtocolImplementation#applySeedBodies`; the method's docblock there is its contract. */
export async function applySeedBodies(
    this: Pick<PublishBatchHost, 'engine' | 'getMetaItem'> & {
        /** [#25779] The `field-files` service a seed file is stored through, read from the kernel's registry. */
        getFieldFiles?: () => IFieldFileService | null | undefined;
    },
    bodies: unknown[],
): Promise<{
    success: boolean; inserted: number; updated: number; error?: string; errors?: unknown[];
    issues?: Array<{ path: string; message: string; code?: string | undefined }>;
}> {
    try {
        const seeds = bodies.filter(
            (b: any) => b && typeof b.object === 'string' && Array.isArray(b.records),
        );
        if (seeds.length === 0) {
            return { success: false, inserted: 0, updated: 0, error: 'seed apply: no readable seed bodies' };
        }
        const { SeedLoaderService } = await import('./seed-loader.js');
        const { SeedLoaderRequestSchema } = await import('@objectstack/spec/data');
        // The loader only needs `getObject` from IMetadataService (dependency
        // graph + field introspection); satisfy it from the protocol's own
        // metadata reads so no kernel service lookup is required.
        const metadataAdapter = {
            getObject: async (name: string) => {
                const wrapper: any = await (this as any).getMetaItem({ type: 'object', name });
                return wrapper?.item ?? wrapper ?? null;
            },
        };
        const loader = new SeedLoaderService(
            this.engine as any,
            metadataAdapter as any,
            console as any,
            { getFieldFiles: () => this.getFieldFiles?.() },
        );
        // [#8333 · P9] `safeParse`, not `parse` — see {@link
        // seedRequestValidationError}. A malformed seed body used to reach
        // the catch below as a raw `ZodError`, which declares no `status`
        // and would therefore have been withheld along with the driver text
        // this card is about. Declaring the refusal at its own producer is
        // what keeps the author's feedback AND the positive list intact.
        const parsedRequest = SeedLoaderRequestSchema.safeParse({
            seeds,
            config: {
                defaultMode: 'upsert',
                multiPass: true,
                // [ADR-0131 D6, §12] No caller organization: a seed dataset
                // names the organization it populates itself, and the
                // loader derives the owner only under `single` (D9).
            },
        });
        if (!parsedRequest.success) throw seedRequestValidationError(parsedRequest.error.issues);
        const r = await loader.load(parsedRequest.data);
        return {
            success: r.success,
            inserted: r.summary.totalInserted,
            updated: r.summary.totalUpdated,
            ...(r.errors?.length ? { errors: r.errors } : {}),
        };
    } catch (e: any) {
        // [#8333 · P9] `seedApplied.error` rides on a **200** publish
        // response, so this is a data-path disclosure no HTTP boundary can
        // reach. Measured on `origin/main`: a driver failure under the
        // loader's dependency-graph read (`getMetaItem` → `sys_metadata`)
        // escaped the loader and arrived here, putting `SQLITE_ERROR: no
        // such table: sys_metadata` on the field.
        //
        // The other population this catch receives — the seed bodies' own
        // schema rejection — now DECLARES itself 422 at the parse above, so
        // it is quoted in full and the author still learns which seed and
        // which key. That declaration is the whole reason this site could
        // be converted rather than escalated.
        console.warn(`[protocol.applySeedBodies] seed apply failed: ${e?.message ?? e}`);
        return {
            success: false, inserted: 0, updated: 0,
            error: clientFacingFailureText(e, 'seed apply failed'),
            // [#10524] A DECLARED refusal's structured findings ride the
            // receipt beside the headline `error` — the message is a
            // one-sentence headline now, so this is where the per-key
            // prose reaches the author. Guarded by the same declaration
            // test as the text above: only the declared 422
            // (`seedRequestValidationError`) attaches `issues`; no driver
            // error carries them (the #8441 measurement), so nothing
            // undeclared is routed around the withhold.
            ...(declaresClientRefusal(e) && Array.isArray(e?.issues)
                ? { issues: e.issues }
                : {}),
        };
    }
}

/** The body of `ObjectStackProtocolImplementation#collectBatchPendingDeclarations`; the method's docblock there is its contract. */
export async function collectBatchPendingDeclarations(
    this: Pick<PublishBatchHost, 'getOverlayRepo' | 'warnClosureReadUnavailable'>,
    drafts: ReadonlyArray<{ type: string; name: string; member?: string }>,
): Promise<RuntimePendingDeclarations | undefined> {
    // [#13216] Typed as a mapped type over `RuntimePendingDeclarations`
    // with `-?`, not as a hand-listed literal. The literal it replaces was
    // the third place the collection set is written down, and the only one
    // that could fall behind SILENTLY: a key added to `RuntimeStackContext`
    // and routed by `CLOSURE_CONTEXT_KEY_BY_TYPE` would simply never be
    // accumulated here, so a package publishing a dataset beside the
    // dashboard that binds it would keep being refused for the sibling in
    // its own batch — the `shyx_customer_ds` shape #10377 was filed for.
    // `-?` makes every key REQUIRED, so the next widening is a compile error
    // at this line instead — and [#17063]'s NARROWING was one too, which is
    // how `pages` left this literal in the same edit it left
    // `RuntimeStackContext`.
    const pending: { [K in keyof RuntimePendingDeclarations]-?: unknown[] } = {
        objects: [], permissions: [], books: [], datasets: [],
    };
    let any = false;
    for (const d of drafts) {
        // The canonical fold, same boundary the promote applies: a stored
        // manifest-plural spelling must route to the same collection its
        // singular does, or one row's shape would decide whether the
        // package is judged against itself.
        const singular = canonicalMetaType(d.type);
        const key = (CLOSURE_CONTEXT_KEY_BY_TYPE as Record<string, keyof RuntimePendingDeclarations>)[singular];
        if (!key) continue;
        const repo = this.getOverlayRepo();
        // ── The repository-shape guard, and why it degrades ALL-OR-NOTHING
        //
        // This method introduced the batch door's first dependency on
        // `repo.get`. `SysMetadataRepository` has always had it, but the
        // seam is overridable (`getOverlayRepo` is the injection point every
        // publish double replaces), and the door's only previous body read —
        // the `seed` capture — fires solely when a seed draft is in the
        // batch, so a repository shape without `get` had never been asked
        // for one. Measured: nine `publishPackageDrafts` cases in
        // `@objectstack/objectql` drive a double declaring `listDrafts`
        // alone, and this call turned every one of them into
        // `TypeError: repo.get is not a function` — thrown BEFORE any
        // promotion, so the batch door died on a shape it used to accept.
        //
        // The answer is a declared capability check, not a wider `try`: a
        // missing member is a fact about the repository, knowable up front,
        // and it must not read like a failed read. Degrading returns the
        // closure to its pre-#10377 state (the live universe alone), which
        // is the safe direction — the gate keeps judging and can only be
        // MORE strict, never fail open.
        //
        // ⛔ All-or-nothing on purpose. Bailing out of the whole collection
        // rather than skipping this one draft is what keeps the verdict from
        // depending on WHICH org a draft happens to live in: a partial
        // closure would resolve some of a package's own names and not
        // others, which is a third behaviour nobody declared and nobody
        // could reproduce.
        if (typeof repo.get !== 'function') {
            this.warnClosureReadUnavailable(singular, d.name);
            return undefined;
        }
        const ref = {
            type: singular, name: d.name, org: 'env',
        } as unknown as Parameters<typeof repo.get>[0];
        // [#22877] The draft's own bundle member, as listed.
        const draft = await repo.get(ref, { state: 'draft', ...memberOption(d.member) });
        if (draft?.body === undefined || draft.body === null) continue;
        pending[key].push(draft.body);
        any = true;
    }
    // Absent, not empty: `undefined` is what keeps a batch with no
    // closure-relevant drafts byte-identical to the pre-#10377 gate call,
    // rather than routing it through a merge that would be a no-op.
    return any ? pending : undefined;
}
