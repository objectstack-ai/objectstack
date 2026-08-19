// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `CoreServiceName` → the contract a slot's occupant must satisfy.
 *
 * [#4127] The ledger this repo was missing. `CoreServiceName` names the slots
 * and `contracts/*` describes them, but nothing connected the two — so a caller
 * resolving a slot got back `any`, and "does this domain call a method the
 * contract declares?" had no mechanical answer. It was answered by a human
 * sweeping the dispatcher by hand, which is how #4087 (a `/storage` handler
 * calling `upload(key, data, options?)` as `upload(file, { request })`) survived
 * months, and how the four gaps in #4127 survived until someone looked.
 *
 * A sweep is not repeatable. This map makes the compiler do it: a lookup
 * through {@link CoreServiceContract} returns the contract, so a call outside it
 * is a compile error at the call site.
 *
 * **An entry is a claim, so it is only made where the binding is evidenced** —
 * by the provider that registers the slot, or by dispatcher work that already
 * proved the correspondence. A slot with no entry resolves to `unknown`, which
 * forces the caller to cast visibly rather than silently receiving `any`: the
 * remaining gap stays legible instead of looking finished. Add an entry when
 * the binding is established, not to fill the table.
 */

import type { IMetadataService } from './metadata-service';
import type { IDataEngine } from './data-engine';
import type { IAuthService } from './auth-service';
import type { IStorageService } from './storage-service';
import type { ISearchService } from './search-service';
import type { ICacheService } from './cache-service';
import type { IQueueService } from './queue-service';
import type { IAutomationService } from './automation-service';
import type { IAnalyticsService } from './analytics-service';
import type { IRealtimeService } from './realtime-service';
import type { IJobService } from './job-service';
import type { INotificationService } from './notification-service';
import type { IAIService } from './ai-service';
import type { II18nService } from './i18n-service';
import type { ISecurityService } from './security-service';
import type { IShareLinkService } from './share-link-service';
import type { IHttpServer } from './http-server';
import type { IObjectQLEngine } from './objectql-engine';

/**
 * The evidenced slot → contract bindings.
 *
 * Every key here is a `CoreServiceName` member; the type is checked against that
 * enum in `core-service-contracts.test.ts`, so a slot renamed in
 * `core-services.zod.ts` breaks this map rather than silently orphaning it.
 *
 * `ui` is deliberately absent: the slot exists and `domains/ui.ts` serves it,
 * but no `IUiService` contract has been written. That absence is the honest
 * state — mapping it to a hand-rolled shape here would be a second, unwritten
 * contract, the exact failure #4127 catalogued.
 */
export interface CoreServiceContracts {
    /** `packages/metadata` registers the object/field definition manager. */
    metadata: IMetadataService;
    /** `packages/objectql` registers ObjectQL — "ObjectQL implements IDataEngine". */
    data: IDataEngine;
    /** `plugin-auth` registers its auth manager. */
    auth: IAuthService;
    /** `service-storage` registers the storage driver; the slot #4087 was about. */
    storage: IStorageService;
    /**
     * **Deprecated alias** of {@link CoreServiceContracts.storage} — the same
     * instance under the old compound spelling (maintainer ruling 2026-08-18,
     * issue #9683: 「9683 file-storage 可以叫 storage」). `service-storage`
     * registers both names, exactly the `http.server` / `http-server` pattern
     * below. New code resolves `storage`; the alias is retired through the
     * standard retirement flow at the next major.
     */
    'file-storage': IStorageService;
    search: ISearchService;
    /** `service-cache`'s own error text names `ICacheService` as the slot's contract. */
    cache: ICacheService;
    queue: IQueueService;
    /** `service-automation` registers the flow engine (#4143, #4150). */
    automation: IAutomationService;
    /** `service-analytics` registers the semantic layer. */
    analytics: IAnalyticsService;
    realtime: IRealtimeService;
    job: IJobService;
    /** `service-messaging` registers the notification slot (#4143). */
    notification: INotificationService;
    ai: IAIService;
    /** `service-i18n`, or the `app-plugin` in-memory fallback (#4143). */
    i18n: II18nService;
    // `workflow: IWorkflowService` removed with the slot (#4451, v17) — no
    // implementation ever existed, so there was no evidenced binding here.
}

/**
 * The contract for slot `K`, or `unknown` when no binding has been evidenced
 * yet. `unknown` — not `any` — on purpose: an unmapped slot must be cast
 * deliberately at the call site, so it reads as an open gap rather than as a
 * checked lookup.
 */
export type CoreServiceContract<K extends string> =
    K extends keyof CoreServiceContracts ? CoreServiceContracts[K] : unknown;

/**
 * Every evidenced slot → contract binding, including slots that are **not**
 * `CoreServiceName` members.
 *
 * [#4127 batch 3] `CoreServiceName` and this ledger answer two different
 * questions, and conflating them is what left these slots untyped:
 *
 *  - **`CoreServiceName`** answers *"what happens at boot when this slot is
 *    empty?"* — it sits beside `ServiceCriticality` and drives startup
 *    orchestration and discovery. Adding a member changes runtime behaviour.
 *  - **This ledger** answers *"what shape is whatever occupies this slot?"* —
 *    pure type information, zero runtime effect.
 *
 * `security`, `shareLinks` and `objectql` need only the second. Widening the
 * enum to type them would pay for a type answer with a runtime-vocabulary
 * change, and enum members are effectively permanent once added. So the ledger
 * extends past the enum instead, and each side keeps its own meaning.
 *
 * This is not a permanent split: if one of these is later promoted to a genuine
 * core service — criticality semantics and all — its entry moves up into
 * {@link CoreServiceContracts} and nothing else changes.
 *
 * The evidence bar is unchanged from {@link CoreServiceContracts}: an entry is a
 * claim, made only where the binding is established.
 */
export interface ServiceSlotContracts extends CoreServiceContracts {
    /**
     * `plugin-security` registers it (`security-plugin.ts`), and
     * `ISecurityService`'s own doc names the registration — `ctx.registerService('security', …)`.
     * The contract, the provider and the three methods `domains/security.ts`
     * calls all already agreed; only the binding was unwritten.
     */
    security: ISecurityService;
    /** `plugin-sharing` registers `ShareLinkService`, which declares `implements IShareLinkService`. */
    shareLinks: IShareLinkService;
    /**
     * The SAME instance as `data`, seen whole. `packages/objectql`'s plugin
     * registers one object under both names, two lines apart — and the two
     * entries deliberately differ: `data` is the engine as
     * {@link IDataEngine} (the data plane, what most consumers should ask
     * for), `objectql` is the full engine — registry, hook/middleware seams,
     * runners, boot wiring, ops probes.
     *
     * [#4251 B3] Was `IDataEngine` here too, with the remainder recorded as
     * "wider, contract unwritten" on `DomainHandlerContext.getObjectQL` and
     * seven consumer-local surface declarations standing in for it. The
     * contract exists now and `ObjectQL implements IObjectQLEngine` checks it,
     * so the slot resolves to what its occupant actually is.
     */
    objectql: IObjectQLEngine;
    /**
     * The HTTP server slot — **`http.server` is the canonical name**.
     *
     * [#4251] Entered when the false `UNCONTRACTED_SLOTS` exemption was
     * revoked: the exemption claimed "no IHttpServer contract exists" while
     * this contract existed and eight call sites already resolved the slot
     * through it. Every provider registers the canonical name — hono-plugin's
     * own registration comment reads "Register HTTP server service as
     * IHttpServer" — and it is the ONLY name present on all provider paths
     * (`runtime.ts`'s `config.server` path registers no alias).
     */
    'http.server': IHttpServer;
    /**
     * **Deprecated alias** of {@link ServiceSlotContracts['http.server']} —
     * the same instance under a second name. plugin-hono-server and qa's
     * node-plugin register both, two lines apart, the alias explicitly
     * commented "for backward compatibility"; `runtime.ts`'s `config.server`
     * path registers ONLY the canonical name, so a reader of this alias alone
     * finds an empty slot there. New code reads `http.server`; readers of the
     * alias migrate as touched, and the alias registrations are dropped at a
     * release boundary once none remain.
     */
    'http-server': IHttpServer;
}

/**
 * The contract for any evidenced slot `K` — core or not — or `unknown` when no
 * binding has been evidenced. Same deliberate `unknown` as
 * {@link CoreServiceContract}: `protocol` and `mcp` have no written contract, so
 * they stay unmapped and visible rather than being given a shape nothing checks.
 */
export type ServiceSlotContract<K extends string> =
    K extends keyof ServiceSlotContracts ? ServiceSlotContracts[K] : unknown;
