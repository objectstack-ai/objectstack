// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0144 D2 and D6, amended] Which metadata doors ask the registry the
 * question that reads its OTHER objects — in one place.
 *
 * The registry's pre-flight (`SchemaRegistry.objectRegistrationRefusal`)
 * judges an object body ALONE unless the caller names `againstRegistry`
 * (#29673): a batch writes its rows in an order a later sibling can still
 * complete, so a question about the other end of a pair, asked before the
 * batch registers, answers both ways wrong. Only a SINGLE save or publish that
 * makes one body live and relays the refusal to its author asks it; on a
 * sealed registry it then also asks the record-currency doors that read other
 * objects (D6's roll-up half, and the follow door, which nothing else asks),
 * so a refused body is answered `422 INVALID_METADATA` and nothing is stored
 * or promoted.
 *
 * Every other producer (a draft save, the batch writers, a package publish)
 * keeps the body-only question; their registration refusals are still only
 * logged at the write-through (#32369). A NEW producer of a published
 * `saveMetaItem`, or of `promoteDraftForPublish`, states its choice here and
 * in {@link REGISTRY_QUESTION_PRODUCERS}; `registry-question.test.ts` fails
 * until it does.
 */

import type { MetadataWriteFace } from './protocol-write-face.js';

/** The registry pre-flight a door asks: `'against-registry'` (single save or publish) or `'body-only'`. */
export type RegistryQuestion = 'against-registry' | 'body-only';

/**
 * The save faces that are one object made live at once and answered to its
 * author: `PUT /meta/:type/:name` (`meta-envelope`) and the runtime `/meta`
 * dispatcher (`meta-dispatch`). Each is stated at exactly one call site.
 */
export const AGAINST_REGISTRY_SAVE_FACES: ReadonlySet<MetadataWriteFace> = new Set<MetadataWriteFace>(['meta-envelope', 'meta-dispatch']);

/** The registry question a `saveMetaItem` asks: a published save on an {@link AGAINST_REGISTRY_SAVE_FACES} face asks against the registry. */
export function saveRegistryQuestion(request: { mode?: 'draft' | 'publish'; writeFace?: MetadataWriteFace }): RegistryQuestion {
    return request.mode === 'publish' && request.writeFace !== undefined && AGAINST_REGISTRY_SAVE_FACES.has(request.writeFace)
        ? 'against-registry'
        : 'body-only';
}

/**
 * The registry question each producer of `promoteDraftForPublish` states (its
 * request's required `registryQuestion`): the per-item publish
 * (`POST /meta/:type/:name/publish`) has no sibling and asks against the
 * registry; a package publish promotes its drafts as one batch.
 */
export const PROMOTION_REGISTRY_QUESTION = {
    'item-publish': 'against-registry',
    'package-publish': 'body-only',
} as const satisfies Record<string, RegistryQuestion>;

/** One producer of a registry pre-flight: a call site, keyed by file and callee, with how many calls it holds there. */
export interface RegistryQuestionProducer {
    /** Repository-relative path. */
    readonly file: string;
    readonly callee: 'saveMetaItem' | 'promoteDraftForPublish';
    readonly calls: number;
    /** `'by-face'`: the request's own `writeFace` and `mode` decide ({@link saveRegistryQuestion}). */
    readonly question: RegistryQuestion | 'by-face';
    readonly why: string;
}

/**
 * Every producer of a `saveMetaItem` or `promoteDraftForPublish` call in the
 * repository's package sources, and the question it asks.
 */
export const REGISTRY_QUESTION_PRODUCERS: readonly RegistryQuestionProducer[] = [
    { file: 'packages/rest/src/meta-item-write-routes.ts', callee: 'saveMetaItem', calls: 1, question: 'by-face', why: '`PUT /meta/:type/:name`, face `meta-envelope`: against the registry when published.' },
    { file: 'packages/runtime/src/domains/meta.ts', callee: 'saveMetaItem', calls: 1, question: 'by-face', why: 'the runtime `/meta` dispatcher, face `meta-dispatch`: against the registry when published.' },
    { file: 'packages/runtime/src/domains/automation.ts', callee: 'saveMetaItem', calls: 1, question: 'body-only', why: 'a flow clone writes a flow, never an object.' },
    { file: 'packages/runtime/src/domains/packages.ts', callee: 'saveMetaItem', calls: 1, question: 'body-only', why: 'a package publish/unpublish flips each of its apps\' visibility: writes an app, never an object.' },
    { file: 'packages/runtime/src/domains/permission-set-clone.ts', callee: 'saveMetaItem', calls: 1, question: 'body-only', why: 'a permission-set clone writes a permission set, never an object.' },
    { file: 'packages/services/service-datasource/src/plugin.ts', callee: 'saveMetaItem', calls: 1, question: 'body-only', why: 'face `external-import`: an import pass over a datasource\'s tables (batch).' },
    { file: 'packages/services/service-automation/src/flow-credential-migration.ts', callee: 'saveMetaItem', calls: 1, question: 'body-only', why: 'a stored-flow migration pass writes flows, never an object.' },
    { file: 'packages/metadata-protocol/src/protocol-package-commits.ts', callee: 'saveMetaItem', calls: 2, question: 'body-only', why: 'faces `package-duplicate` and `package-unmanaged-import`: a package copied or imported row by row (batch).' },
    { file: 'packages/metadata-protocol/src/protocol-packageless-overlay-migration.ts', callee: 'saveMetaItem', calls: 2, question: 'body-only', why: 'the packageless overlay migration rewrites stored rows (batch).' },
    { file: 'packages/metadata-protocol/src/protocol-save.ts', callee: 'saveMetaItem', calls: 1, question: 'body-only', why: 'the stored-object migration pass re-saves stored rows (batch).' },
    { file: 'packages/cli/src/commands/migrate/organization-ownership.ts', callee: 'saveMetaItem', calls: 1, question: 'body-only', why: 'the CLI organization-ownership migration re-saves stored rows (batch).' },
    { file: 'packages/metadata-protocol/src/protocol-history-and-publish.ts', callee: 'promoteDraftForPublish', calls: 2, question: 'by-face', why: 'states `registryQuestion` per call: the per-item publish `item-publish` (against the registry), `publishPackageDrafts` `package-publish` (body-only).' },
];
