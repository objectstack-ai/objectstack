// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 cut 8] The runtime authoring gate of `ObjectStackProtocolImplementation`
 * and the restored-body doors that run it — the plugin-registered authoring
 * gate (`runAuthoringGate`), the shared runtime authoring rules with the
 * collections, package scope and host facts they are judged against
 * (`assertRuntimeAuthoringRules`), and the restore path's body derivation,
 * writer and save-door refusal (`restoredBodyDerivation`, `restoredBodyWriter`,
 * `refuseRestoredBodyTheSaveDoorRefuses`) — moved out of `protocol.ts` whole.
 * The other class members these bodies call are reached through the host
 * below and did not move: the credential channel, the stored-collection fold,
 * the package scope and the host-fact reads belong to groups of their own
 * (the save-door refusals among them already have theirs, cut 6).
 *
 * A MOVE, not a redesign. Each function below is the body of the
 * `ObjectStackProtocolImplementation` method of the same name as it stood,
 * re-indented one level and otherwise unedited: the same reads, made as the
 * same principal, refusing exactly where they did with the same codes and
 * messages. No module-level declaration is read by these bodies alone, so
 * none moved with them.
 *
 * ## How the moved bodies reach the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning), as `protocol-batch-data.ts` applies it.
 * The class keeps every method — the published `dist/*.d.ts` lists each one's
 * name, docblock and declared signature — and each body is one literal of
 * exactly the {@link AuthoringGateHost} members that method reads, plus a
 * `.call`. A method is handed over as a closure that calls it on the protocol
 * at call time, so a test double or spy set on the instance is still the one
 * the body reaches, and the moved bodies that call one another do so through
 * the protocol, exactly as before.
 *
 * The fields the bodies read, `engine`, `authoringChannel` and
 * `authoringGates`, go as GETTERS, so each read happens when the body makes
 * it: tests replace them on a constructed protocol.
 *
 * The other module-level declarations the bodies read
 * (`permissionSetOwnerBindingRefusal`, `runtimeHookWithoutBodyRefusal`) stay in
 * `protocol.ts`, where code that did not move reads them too, and are imported
 * from there: the module cycle is evaluation-safe because each is read only
 * inside a function body, never while the two modules are first evaluated.
 * `index.ts` names what it publishes from `protocol.ts` one by one, so the
 * `export` they gained for this keeps them off the published surface, and
 * nothing re-exports this module, so the published surface does not move.
 */

import type { ObjectStackProtocolImplementation } from './protocol.js';
import { permissionSetOwnerBindingRefusal, runtimeHookWithoutBodyRefusal } from './protocol.js';
import { evaluateRuntimeAuthoringGate } from './runtime-authoring-gate.js';
import type { RuntimeAuthoringIssue, RuntimeAuthoringVerdict, RuntimePendingDeclarations } from './runtime-authoring-gate.js';
import { savedItemNameRefusal } from '@objectstack/metadata/view-container-name';
import { PLURAL_TO_SINGULAR, SINGULAR_TO_PLURAL } from '@objectstack/spec/shared';
import type { IObjectQLEngine } from '@objectstack/spec/contracts';

/**
 * The `ObjectStackProtocolImplementation` members the functions below read —
 * every one of them, and no other; each function's `this` is the `Pick` of the
 * members IT reads. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too, and naming a member the class does not have is a compile error.
 * See the module header for which members are getters.
 */
export interface AuthoringGateHost {
    anonymousElevatedFlowRefusal: ObjectStackProtocolImplementation['anonymousElevatedFlowRefusal'];
    assertRuntimeAuthoringRules: ObjectStackProtocolImplementation['assertRuntimeAuthoringRules'];
    readonly authoringChannel: ObjectStackProtocolImplementation['authoringChannel'];
    readonly authoringGates: ObjectStackProtocolImplementation['authoringGates'];
    collectBatchPendingDeclarations: ObjectStackProtocolImplementation['collectBatchPendingDeclarations'];
    credentialChannelFor: ObjectStackProtocolImplementation['credentialChannelFor'];
    defaultRecordPageSaveRefusal: ObjectStackProtocolImplementation['defaultRecordPageSaveRefusal'];
    readonly engine: ObjectStackProtocolImplementation['engine'];
    externalBindingSaveRefusal: ObjectStackProtocolImplementation['externalBindingSaveRefusal'];
    foldStoredCollection: ObjectStackProtocolImplementation['foldStoredCollection'];
    getOverlayRepo: ObjectStackProtocolImplementation['getOverlayRepo'];
    hierarchyResolverMounted: ObjectStackProtocolImplementation['hierarchyResolverMounted'];
    isArtifactBacked: ObjectStackProtocolImplementation['isArtifactBacked'];
    orgWallEnforced: ObjectStackProtocolImplementation['orgWallEnforced'];
    permissionSetNameCollisionRefusal: ObjectStackProtocolImplementation['permissionSetNameCollisionRefusal'];
    refuseRestoredBodyTheSaveDoorRefuses: ObjectStackProtocolImplementation['refuseRestoredBodyTheSaveDoorRefuses'];
    resolveSduiManifest: ObjectStackProtocolImplementation['resolveSduiManifest'];
    resolveWritePackageScope: ObjectStackProtocolImplementation['resolveWritePackageScope'];
    restoredBodyDerivation: ObjectStackProtocolImplementation['restoredBodyDerivation'];
    rlsMembershipResolverKeys: ObjectStackProtocolImplementation['rlsMembershipResolverKeys'];
    runAuthoringGate: ObjectStackProtocolImplementation['runAuthoringGate'];
    tenancyPostureInForce: ObjectStackProtocolImplementation['tenancyPostureInForce'];
    unknownDatasourceSaveRefusal: ObjectStackProtocolImplementation['unknownDatasourceSaveRefusal'];
}

/** The body of `ObjectStackProtocolImplementation#restoredBodyDerivation`; the method's docblock there is its contract. */
export function restoredBodyDerivation(
    this: Pick<AuthoringGateHost, 'credentialChannelFor'>,
    type: string): ((body: unknown) => unknown) | undefined {
    const channel = this.credentialChannelFor(type);
    return channel ? (body) => channel.strip(body) : undefined;
}

/** The body of `ObjectStackProtocolImplementation#restoredBodyWriter`; the method's docblock there is its contract. */
export function restoredBodyWriter(
    this: Pick<AuthoringGateHost, 'refuseRestoredBodyTheSaveDoorRefuses' | 'restoredBodyDerivation'>,
    type: string, name: string, binding: string | null, source: string): (historyBody: unknown) => Promise<unknown> {
    const derive = this.restoredBodyDerivation(type);
    return async (historyBody) => {
        const nameRefusal = savedItemNameRefusal(type, historyBody, name, 'restore');
        if (nameRefusal) throw nameRefusal;
        const ownerRefusal = permissionSetOwnerBindingRefusal(type, historyBody, name, binding, 'restore');
        if (ownerRefusal) throw ownerRefusal;
        await this.refuseRestoredBodyTheSaveDoorRefuses(type, name, historyBody, binding, source);
        return derive ? derive(historyBody) : historyBody;
    };
}

/** The body of `ObjectStackProtocolImplementation#refuseRestoredBodyTheSaveDoorRefuses`; the method's docblock there is its contract. */
export async function refuseRestoredBodyTheSaveDoorRefuses(
    this: Pick<AuthoringGateHost, 'anonymousElevatedFlowRefusal' | 'assertRuntimeAuthoringRules' | 'authoringChannel' | 'credentialChannelFor' | 'defaultRecordPageSaveRefusal' | 'externalBindingSaveRefusal' | 'permissionSetNameCollisionRefusal' | 'runAuthoringGate' | 'unknownDatasourceSaveRefusal'>,
    type: string,
    name: string,
    body: unknown,
    binding: string | null,
    source: string,
): Promise<void> {
    const nameCollision = await this.permissionSetNameCollisionRefusal(type, name, binding, 'restore');
    if (nameCollision) throw nameCollision;
    const hookRefusal = runtimeHookWithoutBodyRefusal(type, body, name);
    if (hookRefusal) throw hookRefusal;
    const defaultPageRefusal = await this.defaultRecordPageSaveRefusal(type, body, name, 'restored');
    if (defaultPageRefusal) throw defaultPageRefusal;
    const bindingRefusal = await this.externalBindingSaveRefusal(type, body, name);
    if (bindingRefusal) throw bindingRefusal;
    const datasourceRefusal = await this.unknownDatasourceSaveRefusal(type, body, name);
    if (datasourceRefusal) throw datasourceRefusal;
    const elevatedRefusal = await this.anonymousElevatedFlowRefusal(type, body, name);
    if (elevatedRefusal) throw elevatedRefusal;
    const channel = this.credentialChannelFor(type);
    await this.assertRuntimeAuthoringRules({
        type,
        name,
        state: 'active',
        body,
        source,
        packageId: binding,
        ...(channel
            ? { restoredCredentialPaths: () => channel.heldPaths({ name, state: 'active', item: body }) }
            : {}),
    });
    if (this.authoringChannel !== 'package-author') {
        await this.runAuthoringGate({ type, name, state: 'active', body });
    }
}

/** The body of `ObjectStackProtocolImplementation#runAuthoringGate`; the method's docblock there is its contract. */
export async function runAuthoringGate(
    this: Pick<AuthoringGateHost, 'authoringGates' | 'engine' | 'isArtifactBacked'>,
    evt: {
    type: string; name: string; state: 'draft' | 'active'; body: unknown;
}): Promise<void> {
    const singular = PLURAL_TO_SINGULAR[evt.type] ?? evt.type;
    const gate = this.authoringGates.get(singular);
    if (!gate) return;
    const artifactBacked = this.isArtifactBacked(evt.type, evt.name);
    let declaredBody: unknown;
    if (artifactBacked && typeof this.engine.registry?.getItem === 'function') {
        const alt = PLURAL_TO_SINGULAR[evt.type] ?? SINGULAR_TO_PLURAL[evt.type];
        declaredBody = this.engine.registry.getItem(evt.type, evt.name)
            ?? (alt ? this.engine.registry.getItem(alt, evt.name) : undefined);
    }
    await gate({
        type: singular,
        name: evt.name,
        state: evt.state,
        body: evt.body,
        isArtifactBacked: artifactBacked,
        ...(declaredBody !== undefined ? { declaredBody } : {}),
    });
}

/**
 * The members {@link judgeRuntimeAuthoringRules} reads: the host facts and
 * collections every judgement of the shared rules is made against.
 */
type RuntimeRulesHost = Pick<AuthoringGateHost, 'authoringChannel' | 'engine' | 'foldStoredCollection' | 'hierarchyResolverMounted' | 'orgWallEnforced' | 'resolveSduiManifest' | 'resolveWritePackageScope' | 'rlsMembershipResolverKeys' | 'tenancyPostureInForce'>;

/** The body of `ObjectStackProtocolImplementation#assertRuntimeAuthoringRules`; the method's docblock there is its contract. */
export async function assertRuntimeAuthoringRules(
    this: RuntimeRulesHost,
    evt: Parameters<typeof judgeRuntimeAuthoringRules>[0],
): Promise<RuntimeAuthoringIssue[]> {
    const verdict = await judgeRuntimeAuthoringRules.call(this, evt);
    if (verdict.error) throw verdict.error;
    return verdict.advisories;
}

/**
 * [#26707] The judgement {@link assertRuntimeAuthoringRules} enforces, handed
 * back instead of thrown: the gate's {@link RuntimeAuthoringVerdict}, its
 * refusal (`error`) beside its advisories. The assert above is this function
 * plus the throw, so a caller that only needs to KNOW the verdict — the draft
 * read's publish verdict ({@link draftPublishVerdict}) — reads the same
 * collections, the same host facts and the same early returns as the publish
 * that enforces it, and there is no second account of either.
 */
export async function judgeRuntimeAuthoringRules(
    this: RuntimeRulesHost,
    evt: {
    type: string; name: string; state: 'draft' | 'active'; body: unknown; source?: string;
    /**
     * [#9612] The package this write belongs to (`saveMetaItem`'s
     * `packageId`, or the promoted draft row's). It decides the CLOSURE the
     * write is judged against — see {@link resolveWritePackageScope}.
     * Absent, unknown to the registry, or the `sys_metadata` overlay
     * sentinel ⇒ nothing is narrowed.
     */
    packageId?: string | null;
    /**
     * [#10377] The declarations this write's own BATCH is publishing
     * alongside it, when the caller HAS a batch. Only
     * `publishPackageDrafts` does; every other door writes one item, so its
     * closure is the live universe and it states nothing here.
     *
     * Threaded rather than gathered: the batch's pending drafts are
     * `sys_metadata` rows the caller has already listed and is about to
     * consume, and re-deriving them from this side would mean guessing
     * WHICH batch a write belongs to — which is the question the caller is
     * the only one holding the answer to.
     */
    pending?: RuntimePendingDeclarations;
    /**
     * [#20611] How to learn the positions in `body` that this write's
     * carry-forward will fill from the stored row — the credentials the read
     * path withheld, which a body saved back after a read arrives without.
     * Stated by `saveMetaItem`, the one door whose body can arrive that way,
     * and [#20790] by the draft→active promotion for a type with a
     * write-only credential channel: the stored draft row holds what its own
     * save carried forward, but not what that save moved into the channel.
     *
     * A function, called only once the gate is known to run (after the
     * early returns below): a draft save, the package-author channel and
     * the `migrate-stored` pass pay no stored-row read for it. ⛔ It is NOT
     * wrapped in the best-effort guard the collections get: a stored-row read
     * that fails fails this save, as the carry-forward's own read does —
     * answering "nothing is stored" instead would refuse a signed flow's
     * round trip for a secret it still holds.
     */
    restoredCredentialPaths?: () => Promise<readonly string[]>;
}): Promise<RuntimeAuthoringVerdict> {
    const clean: RuntimeAuthoringVerdict = { error: null, advisories: [] };
    // [#6710] The ADR-0005 carve-out, now DECLARED instead of inferred.
    //
    // This line used to read `if (this.environmentId === undefined)
    // return;` — the carve-out keyed off a ROW-SCOPING key. #6285 measured
    // that short-circuit and found every *regular* serving path safely on
    // the gated side (`os dev` / `os start` and the standalone artifact
    // stack bind `env_local`, a cloud per-project kernel its own), and
    // concluded the only thing behind it was the
    // control-plane bootstrap kernel. That conclusion was incomplete, and
    // #6710 measured the counter-example at boot level: the CLI's
    // lightweight host-config assembler (`serve.ts`'s
    // `config.objects && !hasObjectQL` branch → `new ObjectQLPlugin()`
    // with no options) ALSO leaves `environmentId` undefined, and it
    // serves an end-user `PUT /api/v1/meta/*`. `isHostConfig` →
    // `shouldBootWithLibrary === false` is the flagship showcase's own
    // boot shape, so a self-hosted app server ran all the shared
    // `AUTHORING_RULES` on exactly nothing — and for a Studio tenant or an
    // MCP/AI author this gate is not the weakest of four doors, it is the
    // ONLY one (#4463's filing reason).
    //
    // Two topologies, one key, opposite intents: that is the definition of
    // a proxy signal, and #5086 had already retired the same proxy for the
    // code-only refusal a few hundred lines below. So the channel is now
    // stated by the assembly (`assembleMetadataProtocol` ← the plugin
    // option) rather than guessed from row scope, and the DEFAULT is the
    // gated one. An assembly that forgets to declare gets more
    // enforcement, never less — the direction matters more than the
    // mechanism, because the failure mode being designed out is precisely
    // "a new assembly variant nobody thought about".
    //
    // `environmentId` keeps its topology jobs — the ADR-0005
    // overlay-whitelist gate and the registry / provisioning postures. It
    // never stamps or filters an `environment_id` column: ADR-0005 (revised
    // 2026-05) retired that job when each environment got its own database.
    // [#7674] It no longer keys the #3050 authoring gate below either:
    // #6710 re-keyed this activation and left that one on the retired
    // proxy, which cost the ADR-0090 D11 object posture gate every
    // host-config deployment until #7674 finished the move.
    if (this.authoringChannel === 'package-author') return clean;
    if (evt.state !== 'active') {
        // [#26188] D1: no rule gates a draft. The one finding a draft does hear
        // is a hierarchy scope this runtime cannot enforce, as a warning on the
        // 2xx; it needs no collection read, so the draft keeps paying none.
        // A `migrate-stored` pass heals storage and hears nothing (see below).
        if (evt.source === 'migrate-stored') return clean;
        const hierarchyResolverMounted = this.hierarchyResolverMounted();
        return {
            error: null,
            advisories: evaluateRuntimeAuthoringGate({
                type: PLURAL_TO_SINGULAR[evt.type] ?? evt.type,
                name: evt.name,
                state: evt.state,
                body: evt.body,
                ...(hierarchyResolverMounted !== undefined ? { hierarchyResolverMounted } : {}),
            }).advisories,
        };
    }
    // `os migrate meta --stored --apply` rewrites rows that ALREADY EXIST
    // into the current dialect. It is not an author publishing anything —
    // it is the platform healing its own storage — and #4463 D4 is explicit
    // that the gate blocks new writes while stored rows keep their
    // ADR-0087 path. Gating it would invert the tool: a tenant with one
    // pre-existing violation could never canonicalize that row, and the
    // migration would report `failed` while leaving the body in the OLDER
    // dialect — strictly worse than the state it was asked to improve.
    //
    // Safe as a carve-out because `source` is stated by the SERVER, never
    // forwarded from a request (see the note at the top of `saveMetaItem`):
    // no caller can spell its way past the gate. `duplicatePackage` is
    // deliberately NOT here — it mints brand-new rows under new names, and
    // a copy of a broken flow is a new broken flow.
    if (evt.source === 'migrate-stored') return clean;
    const singular = PLURAL_TO_SINGULAR[evt.type] ?? evt.type;

    // Resolution context. Best-effort: a host without a registry (a
    // metadata-only test double) still writes, it just gets the rules that
    // need no object universe. Never let context-gathering fail a write.
    //
    // [#8309] `permissions`/`books` join `objects` — the sibling
    // collections the three cross-collection security rules compare
    // against (RuntimeStackContext's own docblock carries the 38-vs-4
    // measurement). Gathered PER WRITE like `objects` always was, never
    // cached: it runs only on an `active`-state publish (D1), and a cache
    // would need invalidation across every org's overlay writes.
    // Each collection is guarded independently so a registry that can
    // answer one question still answers the others.
    //
    // [#15950] The cost sentence that stood here — "a registry map walk
    // plus one array copy of item references" — described only the FIRST
    // of the two halves below, and it was the reason the second one was
    // never taken. It now reads: a registry map walk plus one array copy,
    // PLUS one indexed `sys_metadata` read per collection, all five issued
    // together. That is a real added cost and it is paid deliberately: the
    // cheaper gather was answering with a universe the platform's own read
    // API contradicts, and a per-write snapshot that is cheap and wrong
    // refuses legitimate writes (the phantom this whole context exists to
    // prevent). It is still bounded by the number of TENANT-AUTHORED rows
    // of one type — code-package metadata lives in the registry and never
    // reaches this read — and it never runs on a draft.
    const listRegisteredCollection = (singularType: string, pluralType: string): unknown[] => {
        try {
            if (typeof this.engine.registry?.listItems !== 'function') return [];
            const items = [...this.engine.registry.listItems(singularType)];
            return items.length > 0 ? items : [...this.engine.registry.listItems(pluralType)];
        } catch {
            return [];
        }
    };
    // [#15950] …and the STORED half folded on top of it. The registry is
    // only ONE of the two homes live metadata has; see
    // {@link foldStoredCollection} for the measured disagreement, and
    // [#16224] for why the fold is the read API's own merge rather than a
    // second account of it.
    const listCollection = (singularType: string, pluralType: string): Promise<unknown[]> =>
        this.foldStoredCollection(
            listRegisteredCollection(singularType, pluralType),
            singularType,
            pluralType,
        );
    // Resolved together rather than in sequence: each is one indexed
    // `sys_metadata` read and they do not depend on one another, so the
    // store leg costs one round trip of latency for the whole context
    // instead of five.
    const [restoredCredentialPaths, objects, permissions, books, datasets] = await Promise.all([
        // [#20611] The host's half of the redaction context — positions
        // only, read from the row at rest; see the evt field.
        evt.restoredCredentialPaths?.(),
        listCollection('object', 'objects'),
        listCollection('permission', 'permissions'),
        listCollection('book', 'books'),
        // [#7529] The resolution universe validateWidgetBindings needs for a
        // dashboard publish — without it every legitimate board reads as
        // dangling (see RuntimeStackContext.datasets).
        listCollection('dataset', 'datasets'),
        // [#17063] A fifth read, `listCollection('page', 'pages')`, stood
        // here for `validateViewPageRefs`. Both it and the `type: 'page'`
        // view mount it resolved were retired under ADR-0049
        // enforce-or-remove, so no runtime-crossed rule reads `stack.pages`
        // and this publish no longer pays a `sys_metadata` round trip for a
        // collection nothing would consult.
    ]);

    // [#9612] The closure this write is judged against. Resolved from the
    // package registry — the impure read — and handed to the pure gate as
    // an argument, the same shape `orgWallEnforced` uses below.
    const packageScope = this.resolveWritePackageScope(evt.packageId);

    // [#20158] The live engine's judge-only filter admission — the third
    // host fact of the #6285 kind, probed here and passed in so the gate
    // stays pure. OPTIONAL on `IObjectQLEngine` by ruling (#19995 C): a host
    // whose engine lacks it (a metadata-only store, a test double) passes
    // nothing and the rules skip the engine's judgement. Bound, because
    // `judgeFilter` reads the engine's own registry through `this`.
    //
    // ⚠️ It reads the LIVE registry, not the snapshot the rules resolve
    // names against. An object that exists only in this write's pending
    // batch or in an organization overlay row is one the engine does not
    // know, and the engine's answer for that is its own: the field-map
    // doors answer nothing and the schema-free doors still judge. The
    // runtime read-scope withhold (#5367) stays the backstop there.
    const engineJudge: IObjectQLEngine['judgeFilter'] =
        typeof this.engine.judgeFilter === 'function'
            ? (objectName, where, options) => this.engine.judgeFilter(objectName, where, options)
            : undefined;

    // [#20312] The host's SDUI component manifest — a host fact of the
    // #6285 kind, read here per publish and passed in so the gate stays pure.
    const sduiManifest = this.resolveSduiManifest();

    // [#21476] The tenancy posture in force — a host fact of the same kind,
    // read here per publish and passed in so the gate stays pure.
    const tenancyPostureInForce = this.tenancyPostureInForce();

    // [#25234] The keys the registered membership resolver owns — a host
    // fact of the same kind, read here per publish and passed in so the
    // gate stays pure.
    const rlsMembershipResolverKeys = this.rlsMembershipResolverKeys();

    // [#26188] Is a hierarchy resolver mounted — a host fact of the same kind,
    // read here per publish and passed in so the gate stays pure.
    const hierarchyResolverMounted = this.hierarchyResolverMounted();

    const verdict = evaluateRuntimeAuthoringGate({
        type: singular,
        name: evt.name,
        state: evt.state,
        body: evt.body,
        objects,
        permissions,
        books,
        datasets,
        // [#10377] The batch's own pending drafts join the
        // collections above. Absent on every non-batch door.
        ...(evt.pending !== undefined ? { pending: evt.pending } : {}),
        ...(packageScope !== undefined ? { packageScope } : {}),
        orgWallEnforced: this.orgWallEnforced(),
        // [#21476] The posture IN FORCE, for the public-form intake
        // advisory — a separate input from the requested one above, on
        // purpose: see `tenancyPostureInForce()`.
        ...(tenancyPostureInForce !== undefined ? { tenancyPostureInForce } : {}),
        ...(engineJudge !== undefined ? { judgeFilter: engineJudge } : {}),
        ...(restoredCredentialPaths !== undefined ? { restoredCredentialPaths } : {}),
        // [#20312] The deployment's component manifest, read per publish;
        // with it the gate compiles an html page's source (ADR-0080 §5).
        ...(sduiManifest !== undefined ? { sduiManifest } : {}),
        // [#25234] The resolver's keys, read per publish; with them the
        // gate judges who owns each membership key.
        ...(rlsMembershipResolverKeys !== undefined ? { rlsMembershipResolverKeys } : {}),
        // [#26188] With it the gate refuses a hierarchy scope no resolver enforces.
        ...(hierarchyResolverMounted !== undefined ? { hierarchyResolverMounted } : {}),
    });
    return verdict;
}

/** The body of `ObjectStackProtocolImplementation#draftPublishVerdict`; the method's docblock there is its contract. */
export async function draftPublishVerdict(
    this: RuntimeRulesHost & Pick<AuthoringGateHost, 'collectBatchPendingDeclarations' | 'credentialChannelFor' | 'getOverlayRepo'>,
    draft: { type: string; name: string; body: unknown; packageId: string | null },
): Promise<RuntimeAuthoringIssue[]> {
    const singular = PLURAL_TO_SINGULAR[draft.type] ?? draft.type;
    // The closure "Publish all" judges this draft against: its package's other
    // drafts, collected by the batch door's own collector from the batch door's
    // own listing. A package-unbound draft has no batch; its publish is the
    // per-item door's, which states none.
    let pending: RuntimePendingDeclarations | undefined;
    if (draft.packageId) {
        const repo = this.getOverlayRepo();
        if (typeof repo.listDrafts === 'function') {
            pending = await this.collectBatchPendingDeclarations(await repo.listDrafts({ packageId: draft.packageId }));
        }
    }
    // The promotion's restored-credential read: the stored draft holds no
    // credential the write-only channel holds, so the gate is told where one is.
    const channel = this.credentialChannelFor(singular);
    const verdict = await judgeRuntimeAuthoringRules.call(this, {
        type: singular,
        name: draft.name,
        state: 'active',
        body: draft.body,
        packageId: draft.packageId,
        ...(pending !== undefined ? { pending } : {}),
        ...(channel
            ? { restoredCredentialPaths: () => channel.heldPaths({ name: draft.name, state: 'draft', item: draft.body }) }
            : {}),
    });
    return (verdict.error as { issues?: RuntimeAuthoringIssue[] } | null)?.issues ?? [];
}
