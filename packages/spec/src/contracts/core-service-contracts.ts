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
import type { IWorkflowService } from './workflow-service';

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
    workflow: IWorkflowService;
}

/**
 * The contract for slot `K`, or `unknown` when no binding has been evidenced
 * yet. `unknown` — not `any` — on purpose: an unmapped slot must be cast
 * deliberately at the call site, so it reads as an open gap rather than as a
 * checked lookup.
 */
export type CoreServiceContract<K extends string> =
    K extends keyof CoreServiceContracts ? CoreServiceContracts[K] : unknown;
