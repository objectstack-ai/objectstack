/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * MetadataClient
 *
 * Thin, framework-agnostic HTTP client for the ObjectStack metadata
 * API (`/api/v1/meta/*`). Used by the platform Setup app surfaces in
 * `@object-ui/plugin-designer` (Object Manager, Field Designer, etc.)
 * so they can read and write protocol metadata without depending on
 * `ObjectStackAdapter` (which is a generic data-source binding and
 * carries a lot of view/dashboard-specific behaviour we don't need
 * here).
 *
 * Endpoints (see `packages/rest/src/rest-server.ts`):
 *   GET    /api/v1/meta                  — list all metadata types
 *   GET    /api/v1/meta/:type            — list items of a type
 *   GET    /api/v1/meta/:type/:name      — get one item (returns the
 *                                          unwrapped item content)
 *   PUT    /api/v1/meta/:type/:name      — save (overlay) one item
 *                                          honours `If-Match` for OCC
 *   DELETE /api/v1/meta/:type/:name      — reset overlay to artifact
 *   GET    /api/v1/meta/:type/:name/history — durable change log
 *
 * The client deliberately keeps the response shape opaque (typed as
 * `unknown`/generic `T`) so callers explicitly narrow per-metadata-
 * type, mirroring the framework's "single Zod source per type" rule.
 */

import { FlowRegistrationSchema, GetMetaItemLayeredResponseSchema } from '@objectstack/spec/api';
// objectui#8676 - the object-metadata write invariant, applied HERE because this
// is a DOOR and not a writer. Every `client.save('object', ...)` call site in the
// repo passes through this one method, so guarding it covers a writer set that
// nothing has to enumerate. See that module's docblock for why the writers are
// deliberately not listed anywhere.
import { assertObjectMetadataWritable } from './object-metadata-write-guard';
import type { DraftChange } from './draft-envelope';
import type {
  FlowRegistration,
  GetMetaItemLayeredResponse,
  GetMetaItemsResponse,
  ListDraftsResponse,
  PublishPackageDraftsResponse,
  RuntimeAuthoringIssue,
} from '@objectstack/spec/api';
// objectui#12929 — the batch publish door's request options are picked off the
// client's declared `packages.publishDrafts` signature (type-only, erased).
import type { ObjectStackClient } from '@objectstack/client';

/**
 * One advisory finding the framework's runtime authoring gate produced for a
 * save that SUCCEEDED (objectstack#7435, landed as `89d7b35a7`).
 *
 * Re-exported from `@objectstack/spec` rather than restated: this is the D3
 * finding shape, declared once as `RuntimeAuthoringIssueSchema` and shared with
 * the 422 `issues[]` so the two cannot drift apart. Hand-copying the six keys
 * here is exactly the fork `check:spec-symbol-derivation` exists to reject, and
 * it is the same discipline `DroppedFieldsEvent` already follows one module over.
 *
 * `severity` carries the spec's full `error | warning | info` union. On THIS
 * channel it is never `'error'` — an error-severity finding is a 422 and never
 * reaches a 2xx body — but the union is copied whole rather than narrowed,
 * because a consumer-side re-spelling of a producer's enum is the drift the
 * gate above is about.
 */
export type { RuntimeAuthoringIssue };

/**
 * Emitted after a metadata WRITE whose response carried a non-empty
 * `advisories` array. The write SUCCEEDED — the row persisted and the server
 * returned 200 — so this is advisory, never a failure.
 *
 * Deliberately the same shape of seam as `ObjectStackAdapter.onWriteWarning`
 * (objectstack-ai/objectstack#3431 / objectstack-ai/objectstack#3455): a successful write whose response carries something the author
 * needs to be told, surfaced to the shell as an event so the data layer never
 * imports a toaster. The difference is only which door produced it — that one
 * is record CRUD, these are the metadata write doors.
 *
 * ## Both write doors report (#5026)
 *
 * The objectstack-ai/objectstack#4463 runtime authoring gate runs on BOTH metadata write doors by its D1
 * ruling — a draft→active promotion is gated exactly as a direct active save —
 * and its non-blocking findings ride the 2xx of whichever door earned them.
 * `SaveMetaItemResponseSchema` has carried the key since objectstack-ai/objectstack#4717 and
 * `PublishMetaItemResponseSchema` since objectstack#9176; both declare it at
 * the response's TOP level, under the same name and with the same
 * `RuntimeAuthoringIssueSchema` element type, which is what lets one reader and
 * one event serve both. Measured against the installed `@objectstack/spec`
 * rather than assumed — see the PR for the probe.
 *
 * ## And the BATCH publish door (`ce986aafc`)
 *
 * `PublishPackageDraftsResponseSchema` declares the same key with the same
 * element type, riding EACH `published[]` element rather than a parallel
 * top-level map (objectstack#9343's ruled shape). So the reader is still one
 * reader — the object it is handed is one `published[]` element instead of a
 * whole response — and the event is still one event per promoted item.
 *
 * The name keeps its `Save` prefix because it is public API of this package and
 * renaming it would break consumers for no behavioural gain; {@link door} is
 * what says which write produced the event.
 */
export interface MetadataSaveAdvisoryEvent {
  /** Metadata type saved (e.g. `'flow'`). */
  type: string;
  /** Item name saved. */
  name: string;
  /**
   * The bundle member the write named (objectui#12413), when it named one:
   * set by {@link MetadataClient.publishDraft} from its `options.member`, so
   * an advisory raised on one language's publish of an `email_template` is
   * attributed to that member and not to the whole template. Absent for every
   * write that names no member. Typed from {@link MetadataDraftHeader}'s
   * `member`, the value the caller read off the draft row.
   */
  member?: MetadataDraftHeader['member'];
  /**
   * The save mode the call used. `'draft'` writes are **never gated** — the
   * framework returns at `runtime-authoring-gate.ts`'s D1 early-return
   * (`if (args.state !== 'active') return null`), so a draft save produces no
   * findings at all and this event never fires for one. Carried anyway so a
   * consumer reading the event can tell which door it came through.
   */
  mode: 'draft' | 'publish';
  /**
   * Which write door produced this event (#5026).
   *
   * - `'save'` — `PUT /meta/:type/:name` ({@link MetadataClient.save}, and the
   *   SDK's `meta.saveItem` behind `ObjectStackAdapter`).
   * - `'publish'` — the promotion doors: `POST /meta/:type/:name/publish`
   *   ({@link MetadataClient.publish} and {@link MetadataClient.publishDraft}),
   *   and the batch `POST /packages/:id/publish-drafts`
   *   ({@link MetadataClient.publishPackageDrafts}), which emits ONE event per
   *   `published[]` element carrying that element's own `type` / `name`.
   *
   * ## Why the batch route is not a third value (`ce986aafc`)
   *
   * The batch door promotes drafts to active — the author pressed Publish, and
   * every item this event names really was published. What `door` decides is
   * the frame's VERB, and "Published" is the true one for all three routes; a
   * third value would have to render the same word. The per-item identity the
   * author needs to act on is already carried by {@link type} / {@link name},
   * one event per item, so nothing about the batch is lost by sharing the
   * value. ⛔ It is NOT a claim that "one call = one event": the batch emits as
   * many events as it has advised items, which is why each one names its own.
   *
   * Distinct from {@link mode}, which cannot answer this: a direct active save
   * and a draft promotion both report `mode: 'publish'` because both land the
   * body in the active overlay. The renderer needs the DOOR, because the author
   * pressed either Save or Publish and a toast that says "Saved" after a
   * Publish tells them their change is still a draft — the opposite of what
   * happened, and in this product Save and Publish are two different buttons
   * with two different meanings.
   *
   * REQUIRED rather than optional-with-a-default so a future third door cannot
   * be wired without stating which one it is: an omitted discriminator would
   * silently render the save wording.
   */
  door: 'save' | 'publish';
  /** The findings. Never empty — the event is not emitted otherwise. */
  advisories: RuntimeAuthoringIssue[];
}

/** Event listener type for save-advisory events. */
export type MetadataSaveAdvisoryListener = (event: MetadataSaveAdvisoryEvent) => void;

/**
 * Read the `advisories` array off a metadata write response, defensively.
 *
 * Serves EVERY write door unchanged (#5026, `ce986aafc`):
 * `SaveMetaItemResponseSchema` and `PublishMetaItemResponseSchema` declare the
 * key at the same top level, and `PublishPackageDraftsResponseSchema` declares
 * it on each `published[]` element — under the same name, with the same element
 * schema. So there is one reader, not a per-door copy that could drift; the
 * batch caller hands it one element, which is the object that carries the key
 * there.
 *
 * ⛔ It reads the `advisories` key of the object it is GIVEN and never
 * traverses. Choosing the object — a response body at the single-item doors,
 * one `published[]` element at the batch door — is the caller's job precisely
 * because the place is declared per route: a reader that went hunting for
 * findings wherever they might be would be inventing a contract the server
 * never stated.
 *
 * The server omits the key entirely on a clean write, so `undefined` is the
 * common case and means "nothing to say". Anything that is not an array of
 * objects carrying the six required keys is dropped rather than rendered: a
 * half-shaped finding would print blanks at the author, and this channel must
 * never turn a successful save into noise.
 */
export function readSaveAdvisories(body: unknown): RuntimeAuthoringIssue[] {
  if (!body || typeof body !== 'object') return [];
  const raw = (body as { advisories?: unknown }).advisories;
  if (!Array.isArray(raw)) return [];
  return raw.filter((f): f is RuntimeAuthoringIssue => {
    if (!f || typeof f !== 'object') return false;
    const c = f as Record<string, unknown>;
    return (
      typeof c.rule === 'string' &&
      typeof c.path === 'string' &&
      typeof c.where === 'string' &&
      typeof c.message === 'string' &&
      typeof c.hint === 'string' &&
      typeof c.severity === 'string'
    );
  });
}

export interface MetadataClientConfig {
  /** Base URL of the ObjectStack server (no trailing slash needed). */
  baseUrl: string;
  /**
   * Optional environment ID to scope reads/writes to a tenant. When
   * provided, requests use the scoped path
   * `/api/v1/environments/:environmentId/meta/...` and overlays are
   * persisted in the environment's own metadata store.
   */
  environmentId?: string;
  /** Optional custom fetch implementation (defaults to `globalThis.fetch`). */
  fetch?: typeof fetch;
  /** Additional headers (e.g. auth) included on every request. */
  headers?: Record<string, string>;
  /**
   * ADR-0037 Live Canvas — render the world **as-if-published**. When true,
   * `list()` and `get()` append `?preview=draft`, which the framework
   * dispatcher maps to `getMetaItems/getMetaItem({ previewDrafts: true })`:
   * pending ADR-0033 drafts overlay the active registry (draft wins by name,
   * draft-only items surface). Reads only — writes are unaffected, and
   * nothing the preview shows is live until Publish.
   */
  previewDrafts?: boolean;
  /**
   * Called after a {@link MetadataClient.save} whose 2xx response carried a
   * non-empty `advisories` array (objectstack#7435). Since #5026 the SAME sink
   * also receives the publish door's findings (objectstack#9176), and since
   * `ce986aafc` the batch publish door's too, one event per advised
   * `published[]` element (objectstack#9343) — read `event.door` to tell a
   * save from a promotion, and `event.type` / `event.name` for which item. The
   * write already succeeded; this is how the shell learns there is something to
   * tell the author instead of the findings being discarded client-side.
   *
   * Set on the CONFIG rather than exposed as a `subscribe()` method on purpose:
   * console metadata clients are minted per-component by `useMetadataClient`,
   * so there is no long-lived instance to subscribe to — but every one of them
   * is built by the single `createConsoleMetadataClient` factory, which is
   * where this gets wired exactly once for every save call site in the app.
   *
   * A throw from this callback is swallowed — an advisory channel must never
   * be able to fail a save that the server already committed.
   */
  onSaveAdvisory?: MetadataSaveAdvisoryListener;
}

export interface MetadataListOptions {
  /** Filter by source package id (matches the `package` query param). */
  packageId?: string;
  /**
   * Ask the server for what it serves on a list only on request (the
   * `include` query param). `'grants'` on the `position` list adds each
   * position's `_holderCount` and `_grantedPermissionSets`, read where the
   * authorization resolver enforces them (objectstack#25333). A server that
   * predates it, or a type it does not apply to, serves the list unchanged.
   */
  include?: 'grants';
}

/**
 * A list read as {@link MetadataClient.listResponse} returns it: the items, and
 * what the server serves BESIDE them, typed by the spec's
 * `GetMetaItemsResponse` rather than restated (its `type` key is not kept).
 *
 * `registrations` is the automation engine's verdict on each listed flow,
 * keyed by the item's `name` (`FlowRegistrationSchema`, objectstack#23316):
 * `registered`, `refused` with the engine's `reason` verbatim, or
 * `unregistered`. It is absent when the server sent none — a type other than
 * `flow`, a server with no automation service, or one that predates the key —
 * and absence means no engine judged the flow, ⛔ never `registered`. A name
 * the map has no entry for is unjudged in the same way.
 */
export type MetadataListAnswer<T = unknown> = { items: T[] } & Pick<GetMetaItemsResponse, 'registrations'>;

/**
 * Keep the verdicts of a list answer's `registrations` that parse with the
 * spec's `FlowRegistrationSchema`, one entry at a time. An entry that does not
 * parse is not a verdict this client can read, so its flow is left unjudged —
 * what absence already means — instead of guessed at; the others stand.
 */
function readRegistrations(raw: unknown): Record<string, FlowRegistration> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, FlowRegistration> = {};
  for (const [name, verdict] of Object.entries(raw as Record<string, unknown>)) {
    const parsed = FlowRegistrationSchema.safeParse(verdict);
    if (parsed.success) out[name] = parsed.data;
  }
  return out;
}

/**
 * A pending DRAFT metadata item (ADR-0033), as returned by {@link MetadataClient.listDrafts}.
 * Light header — no body — carrying the owning package so the console can group
 * pending changes by app package.
 *
 * DERIVED from the spec's row, `ListDraftsResponseSchema.drafts[]`, rather than
 * re-spelled (objectui#12413): the key names and their types come from the
 * spec symbol, so a key the spec renames or retypes fails the type-check here
 * instead of drifting past it.
 *
 * - `member` — the bundle member this draft is (objectstack#23073): present on
 *   every draft of a type whose identity is a pair (today only
 *   `email_template`, `(name, locale)`), absent for a type identified by its
 *   name alone. It is the value the by-name doors take back as `?member=`
 *   ({@link MetadataClient.publishDraft}'s `options.member`).
 *
 * ⛔ The pick is deliberate: the five keys this interface declared before keep
 * their exact types, and `member` is the one key added. The spec row's `label`
 * is not picked here: it is declared REQUIRED there, and this client talks to
 * runtimes of several vintages, so claiming it would be this client asserting
 * a server version it cannot check.
 */
export interface MetadataDraftHeader
  extends Pick<ListDraftsRow, 'type' | 'name' | 'packageId' | 'updatedAt' | 'updatedBy'> {
  /** The bundle member, typed by the spec row's own `member` (see above). */
  member?: ListDraftsRow['member'];
}

/** One element of `ListDraftsResponseSchema.drafts`, the spec row `MetadataDraftHeader` derives from. */
type ListDraftsRow = ListDraftsResponse['drafts'][number];

/**
 * What {@link MetadataClient.publishPackageDrafts} resolves with — the "publish
 * whole app" body, DERIVED from `PublishPackageDraftsResponseSchema` rather
 * than re-spelled (`ce986aafc`).
 *
 * Derived, and then widened in exactly two ways, each for a measured reason:
 *
 * - `Partial<…>` because this client talks to runtimes of several vintages and
 *   the spec's six required keys are what TODAY's producer sets. Declaring them
 *   required would be this client asserting a server version it cannot check —
 *   and an older runtime that omits one would be a type lie, not a compile
 *   error. Every consumer here already reads these keys defensively.
 * - The index signature because the REST door adds keys on the way out
 *   (ADR-0045 visibility receipts, the `metadata:reloaded` announce receipt),
 *   and because a body this client hands back must stay readable by a caller
 *   that knows about a key this package has never heard of.
 *
 * ⛔ What it is NOT is a second definition of the batch response: the key names
 * and element shapes come from the spec symbol, so a key the spec adds, renames
 * or retypes arrives here with no edit.
 */
export type MetadataPublishPackageDraftsResult = Partial<PublishPackageDraftsResponse> &
  Record<string, unknown>;

/**
 * What {@link MetadataClient.publishPackageDrafts} may ask of the batch door
 * beyond the package id (objectui#12929): today the protocol's opt-in
 * `backfill` (objectstack#24253), and nothing else.
 *
 * Picked off `@objectstack/client`'s own `packages.publishDrafts` signature
 * rather than re-spelled, so the element shape (`{ object, field }`) is the
 * client's declaration. The request has no spec schema of its own; the
 * client's signature is where the protocol declares it. `actor` is not
 * picked: the door writes as the signed-in caller, and no console surface
 * names another.
 *
 * `backfill` names fields this publish ADDS whose literal `defaultValue` the
 * server writes into the object's existing rows, as the caller, after the
 * batch goes live; the receipt comes back as `backfillApplied`. A field that
 * is not new, or declares no literal default, refuses the WHOLE request with a
 * 400 before anything is published, so a caller offers only fields it has
 * judged by the same rule.
 */
export type MetadataPublishPackageDraftsOptions = Pick<
  NonNullable<Parameters<ObjectStackClient['packages']['publishDrafts']>[1]>,
  'backfill'
>;

/**
 * Options for {@link MetadataClient.save} — a WRITE OVER HTTP to
 * `/api/v1/meta/:type/:name`.
 *
 * NOT the spec's `MetadataSaveOptions` (`@objectstack/spec/system` and
 * `/kernel`), whose name this interface wore until objectui#3160
 * (objectstack#4115 ledger batch 6). Both spec copies describe writing a
 * metadata item to a FILE — `format: json|yaml|ts`, `path`, `indent`,
 * `prettify`, `sortKeys`, `backup`, `atomic`, `loader`. Not one of those keys
 * exists here, and not one of these exists there: this is the REST client's
 * request envelope — optimistic concurrency (`ifMatch` → `If-Match`,
 * `ifNoneMatch` → `If-None-Match`), the destructive-change override, the
 * ADR-0033 draft/publish mode, and the owning package. Same words, different
 * layer.
 */
export interface MetadataClientSaveOptions {
  /**
   * Optimistic concurrency (ADR-0008): the `version` token of the stored row
   * this write was built on, sent as the `If-Match` header, so a write over a
   * row that has moved since is refused `409 METADATA_CONFLICT` instead of
   * overwriting it.
   *
   * The `/meta` doors serve that token in three places, each naming the row a
   * save to the SAME address (type, name, `?package=`, lifecycle) compares
   * against: the item read's `version` (`?state=draft` for the draft row,
   * declared on `GetMetaItemResponseSchema`), a save receipt's `version`, and
   * a version conflict's `currentVersion` (`MetadataConflictErrorSchema`). A
   * served `null` means no such row: pin with {@link ifNoneMatch} instead.
   *
   * ⛔ Never together with {@link ifNoneMatch}: {@link MetadataClient.save}
   * throws before sending a request that carries both.
   */
  ifMatch?: string;
  /**
   * The first-write pin, sent as `If-None-Match: *`: write only where no row of
   * this write's lifecycle exists at its address (the draft row, for
   * `mode: 'draft'`). A create sends it, and so does the first draft save of an
   * item with no pending draft; the door refuses it `409 METADATA_CONFLICT`,
   * carrying the existing row's `currentVersion`, when such a row is there.
   *
   * `'*'` alone: the door reads no other value. ⛔ Never together with
   * {@link ifMatch} — the door refuses that pair `400`, and
   * {@link MetadataClient.save} throws before sending it.
   */
  ifNoneMatch?: '*';
  /**
   * Bypass destructive-change protection (Phase 3a). The server returns
   * `409 destructive_change` with `issues[]` if a write would drop or
   * narrow data; setting `force: true` adds `?force=true` to the request
   * so the operator can confirm and proceed.
   */
  force?: boolean;
  /**
   * Save mode — `'draft'` writes a pending draft row (invisible to the
   * runtime until `publish()` is called); `'publish'` writes directly
   * to the active overlay. Omit (or set `'publish'`) for the legacy
   * "save = live" behaviour.
   */
  mode?: 'draft' | 'publish';
  /**
   * Software-package id to bind the saved row to (sent as the `package`
   * query param → `sys_metadata.package_id`). Set when authoring inside a
   * Studio package workspace. Omit for an env-local overlay.
   */
  packageId?: string;
  /**
   * The authoring surface this save is made through (objectui#12725), sent as
   * `?surface=`. A draft save stamps it as `by` on every key path it changes,
   * the entries the strict draft read serves as `draftChanges`; absent, the
   * framework stamps `api`. Studio's own saves send `'studio'`, so a person's
   * edit there is told apart from the AI copilot's (objectstack#24395).
   *
   * DERIVED from the spec's authoring-surface set (the one `draftChanges[].by`
   * reports, `MetadataAuthoringSurface`), minus `'copilot'`: the HTTP doors
   * refuse `?surface=copilot` `400` (only an in-process tool may state it), so
   * this client cannot send it. Omit for any other caller.
   */
  surface?: Exclude<DraftChange['by'], 'copilot'>;
}

export interface MetadataGetOptions {
  /**
   * Read a specific overlay state. `'draft'` returns the pending draft
   * body (no fallback to the published overlay or the registry); omit
   * to read the active (published) value.
   */
  state?: 'active' | 'draft';
  /**
   * Software-package id to scope resolution (sent as the `package` query
   * param → server prefer-local, ADR-0048). Set when reading one item that
   * may collide by name across installed packages (e.g. the Studio editor
   * passes the edited item's owning package). Omit for context-free reads.
   */
  packageId?: string;
}

// `surface` is a SAVE input (`?surface=` on `PUT`); the delete door reads no
// such parameter, so a delete option of that name would be declared and never
// sent (objectui#12725).
export interface MetadataDeleteOptions extends Omit<MetadataClientSaveOptions, 'surface'> {
  /**
   * Target state. `'draft'` discards the pending draft (keeps the
   * published overlay intact). Omit to reset the active overlay back
   * to the artifact default (the legacy behaviour).
   */
  state?: 'active' | 'draft';
}

/**
 * Which layer an overlay was saved at — `'env'` for an environment-level one,
 * `null` exactly when `overlay` is null. Every metadata read is environment →
 * code since objectstack#15206 S5, which retired the `'org'` tenant scope.
 *
 * DERIVED from `@objectstack/spec`, not restated: the vocabulary lives once, in
 * `GetMetaItemLayeredResponseSchema`'s `overlayScope`
 * (`z.enum(['env']).nullable()`), and this alias indexes the published
 * response type so a scope the spec adds arrives here with no edit. Restating
 * the union locally is the fork `scripts/check-spec-symbol-derivation.mjs`
 * exists to reject, and the mirror-image mistake — a consumer re-spelling a
 * producer's enum — is what this field carried until objectui#4982.
 *
 * What it carried: `string | null`, under a comment naming the vocabulary as
 * `organization | environment | package`. Not one of those three spellings is a
 * value the producer emits (`metadata-protocol`'s two assignment sites write
 * `'org'` / `'env'`); the schema rejects all three by name, and `package` is
 * not a scope this field has ever had. Because the declared type was `string`
 * the compiler had no opinion, so the wrong comment was the only description of
 * the vocabulary — a planted premise rather than stale prose, and the reason
 * the Studio's layer badge shipped the raw value straight to screen.
 */
export type MetadataOverlayScope = GetMetaItemLayeredResponse['overlayScope'];

/**
 * ADR-0010 §3.6 — the four-state metadata protection lock
 * (`none` / `no-overlay` / `no-delete` / `full`), read from
 * `GetMetaItemLayeredResponseSchema`'s own `z.enum` rather than spelled out
 * again here (objectui#5024).
 *
 * It used to be written out twice in this file, 42 lines apart: once as
 * {@link MetadataLayered.lock} (optional) and once as
 * {@link MetadataAuditEntry.lockState} (nullable), identical in every other
 * respect and compared by no gate. A fifth state added to one would have left
 * the other compiling — the same "declared N times, diffed by nothing" failure
 * objectui#4972 and objectui#4984 record for other vocabularies.
 *
 * Deriving beats a local alias the two merely share. The producer of these
 * values is the framework, and `packages/spec` already declares the vocabulary,
 * so the copies were restating a schema that existed rather than filling a gap.
 * The card that reported this recorded the opposite — "`@objectstack/spec` 也没
 * 有对应的 `z.enum` 可派生" — and so did the audit panel's neighbouring comment;
 * both predate the enum, which ships in `@objectstack/spec` 17.1.0. This is the
 * same treatment {@link MetadataOverlayScope} above already gets, and it closes
 * the cross-repo half of the drift, not just the in-repo half.
 *
 * ⚠️ This types what this repo may WRITE. It does NOT constrain what a server
 * may SEND, and it never will — {@link MetadataClient.layered} forwards the
 * wire value rather than dropping it, so every reader must still handle a value
 * outside these four. What changed in objectui#5676 is that the value is no
 * longer forwarded *silently*: the boundary validates it against the producer's
 * own schema and names the field in {@link MetadataLayered._unrecognized} when
 * it does not match. The lock banner in `ResourceEditPage` is the worked
 * example of a reader that labels such a value instead of rendering it blank.
 */
export type MetadataLockState = GetMetaItemLayeredResponse['lock'];

/**
 * Layered view of a metadata item — the body of
 * `GET /meta/:type/:name/layers` (`GetMetaItemLayeredResponseSchema`).
 *
 * A subset by design: the response also carries `type` / `name`, which the
 * caller already knows because it passed them in, so
 * {@link MetadataClient.layered} does not hand them back.
 */
export interface MetadataLayered<T = unknown> {
  /** Code-level (artifact) item; null if the item only exists as an overlay. */
  code: T | null;
  /** Org/environment overlay (just the saved delta or full overlay row). */
  overlay: T | null;
  /**
   * Which layer {@link MetadataLayered.overlay} came from, or null when there
   * is no overlay. Spec-derived — see {@link MetadataOverlayScope}.
   */
  overlayScope: MetadataOverlayScope;
  /** Merged effective view — what the runtime actually sees. */
  effective: T | null;
  /**
   * Load-time validation result for `effective` (server-computed via
   * the same Zod registry used at save time). Undefined for types
   * without a registered Zod schema. Surfaced by the Studio as a
   * banner + inline field errors so operators can spot bad metadata
   * without having to hit Save.
   */
  _diagnostics?: MetadataDiagnostics;
  // ── ADR-0010 Phase 1 — protection envelope ──
  /** 4-state lock: `none` / `no-overlay` / `no-delete` / `full`. */
  lock?: MetadataLockState;
  /** Human-readable reason for the lock (tooltip text). */
  lockReason?: string;
  /** Which layer set the lock: artifact / package / overlay / env-forced. */
  lockSource?: 'artifact' | 'package' | 'overlay' | 'env-forced';
  /** Optional docs URL for the lock reason (rendered as "View docs →"). */
  lockDocsUrl?: string;
  /** Origin of the item: `package` (loader) | `org` (tenant) | `env-forced`. */
  provenance?: 'package' | 'org' | 'env-forced';
  /** Owning package id (denormalised from the loader tag). */
  packageId?: string;
  /** Owning package version. */
  packageVersion?: string;
  /** True when the editor should allow Save (PUT). */
  editable?: boolean;
  /** True when the editor should allow Delete. */
  deletable?: boolean;
  /** True when "Reset to package default" applies (has overlay + artifact). */
  resettable?: boolean;
  /**
   * Protection-envelope keys whose wire value did NOT match `packages/spec`'s
   * schema for them (objectui#5676). Computed HERE, at the boundary — the
   * server never sends this key, and {@link MetadataClient.layered} builds the
   * returned object field by field, so a server that tried could not smuggle
   * one in.
   *
   * Absent when everything the server sent parsed, so its presence is the
   * signal. The offending values are still forwarded on the fields themselves:
   * this is "pass through and label", the treatment objectui#5672 chose for
   * `lock` alone, applied to the whole ADR-0010 envelope. Dropping them would
   * be the reject semantics that card refused — turning a wrong render into no
   * render is a behaviour change for every consumer of this client.
   */
  _unrecognized?: readonly string[];
}

/**
 * The ADR-0010 protection envelope as it reaches this client, listed once so
 * the boundary check below cannot drift from the interface above.
 *
 * The `satisfies` pins each spelling against BOTH ends at compile time: it must
 * be a key {@link MetadataLayered} carries AND a key the producer's
 * `GetMetaItemLayeredResponseSchema` declares. A key renamed upstream, or one
 * added here without a schema to check it against, fails `type-check` naming
 * itself — which is the failure mode objectui#5676 was filed about, one level up.
 */
const PROTECTION_ENVELOPE_KEYS = [
  'overlayScope',
  'lock',
  'lockReason',
  'lockSource',
  'lockDocsUrl',
  'provenance',
  'packageId',
  'packageVersion',
  'editable',
  'deletable',
  'resettable',
] as const satisfies readonly (keyof MetadataLayered & keyof GetMetaItemLayeredResponse)[];

/**
 * Which envelope keys the server sent that its own schema rejects.
 *
 * Per-key on purpose, and the granularity is the whole point. Measured on the
 * installed spec (17.2.0) rather than assumed: `GetMetaItemLayeredResponseSchema
 * .safeParse(body)` is ALL-OR-NOTHING — one unknown `lock` token returns
 * `success: false` with `data` undefined, so the other six fields lose their
 * types too. Degrading the whole envelope because one field is from a newer
 * dialect would be a subtler version of the bug this fixes, so the failure
 * branch re-checks each key against that same schema's own `shape[key]`, where
 * only the offending one fails.
 *
 * A key the server omitted is not "unrecognised" — absence is a legitimate
 * envelope (every field but the four resolved verdicts is optional upstream,
 * and a pre-ADR-0010 backend sends none of them at all).
 */
function unrecognizedEnvelopeKeys(body: Record<string, unknown>): string[] {
  const shape = GetMetaItemLayeredResponseSchema.shape;
  return PROTECTION_ENVELOPE_KEYS.filter(
    (key) => body[key] !== undefined && !shape[key].safeParse(body[key]).success,
  );
}

/**
 * One row in the metadata protection-audit trail
 * (ADR-0010 §3.6 / Phase 4.1). Mirrors `sys_metadata_audit` columns
 * the API exposes.
 */
export interface MetadataAuditEntry {
  /** Stable audit-row id (uuid). */
  id: unknown;
  /** ISO timestamp when the attempt happened. */
  occurredAt: string;
  /**
   * Who attempted the operation — the identity the request was authorized
   * as, or `'system'` for internal machine writes (objectstack#7941).
   */
  actor: string;
  /** Code path that recorded the row (e.g. `protocol.saveMetaItem`). */
  source: string | null;
  /** Which lifecycle op was attempted. */
  operation: 'save' | 'publish' | 'rollback' | 'delete' | 'reset';
  /** Decision: allowed / denied / forced (admin override). */
  outcome: 'allowed' | 'denied' | 'forced';
  /** Machine-readable reason code (`item_locked`, `ok`, …). */
  code: string;
  /** Effective lock at the moment of the attempt. */
  lockState: MetadataLockState | null;
  /** True when admin forced the write through despite the lock. */
  lockOverridden: boolean;
  /** Request-id for trace correlation (if propagated). */
  requestId: string | null;
  /** Free-text note (often the lock reason). */
  note: string | null;
}

/** Response shape for `MetadataClient.audit()`. */
export interface MetadataAuditResponse {
  events: MetadataAuditEntry[];
}

/**
 * Load-time validation envelope attached to metadata items by the
 * framework. Mirrors `MetadataValidationResult` in the kernel spec.
 */
export interface MetadataDiagnostics {
  valid: boolean;
  errors?: Array<{ path: string; message: string; code?: string }>;
  warnings?: Array<{ path: string; message: string }>;
}

/** Options for the cross-type `/meta/diagnostics` sweep call. */
export interface MetadataDiagnosticsOptions {
  /** Restrict the sweep to a single metadata type (e.g. `'view'`). */
  type?: string;
  /**
   * `'error'` (default) returns only items that fail validation.
   * `'warning'` also includes items whose only diagnostics are warnings.
   */
  severity?: 'error' | 'warning';
  /** Restrict to items owned by this package id. */
  packageId?: string;
}

/** One row in the `/meta/diagnostics` response. */
export interface MetadataDiagnosticsEntry {
  type: string;
  name: string;
  diagnostics: MetadataDiagnostics;
}

/** Top-level envelope returned by `/meta/diagnostics`. */
export interface MetadataDiagnosticsSummary {
  entries: MetadataDiagnosticsEntry[];
  /** Number of `entries` returned (post-filter). */
  total: number;
  /** How many metadata types the sweep visited. */
  scannedTypes: number;
  /** How many individual items were validated. */
  scannedItems: number;
  /**
   * Per-type aggregate stats — count of items and the list of
   * packages contributing to each type. Computed in the same sweep
   * so a single call serves both the diagnostics governance page and
   * the directory tile counts / package filter.
   *
   * Optional for backward compatibility with older framework
   * versions that do not yet emit it; clients should fall back to
   * an empty record.
   */
  stats?: Record<string, { count: number; locked?: number; packages: string[] }>;
}

/** Reference back-pointer — Phase 3a `/references`. */
export interface MetadataReference {
  /** Referencing item's metadata type. */
  fromType: string;
  /** Referencing item's name. */
  fromName: string;
  /** JSON path within the referencing item that holds the reference. */
  path: string;
  /** The actual value seen at `path` (the referenced name). */
  value: string;
}

export interface MetadataHistoryOptions {
  /** Only return events after this sequence number. */
  sinceSeq?: number;
  /** Limit the number of events returned. */
  limit?: number;
}

/** A single field-anchored spec-validation issue (server `error.details.issues`). */
export interface MetadataValidationIssue {
  /** Dot-path to the offending field, e.g. `fields.amount.type` (`''` = root). */
  path: string;
  message: string;
  code?: string;
}

export interface MetadataError extends Error {
  status: number;
  code?: string;
  body?: unknown;
  /** Structured spec-validation issues, when the failure was a validation error. */
  issues?: MetadataValidationIssue[];
}

const META_PREFIX = '/meta';
const API_PREFIX = '/api/v1';

function buildBase(config: MetadataClientConfig): string {
  const trimmed = config.baseUrl.replace(/\/+$/, '');
  const scoped = config.environmentId
    ? `${API_PREFIX}/environments/${encodeURIComponent(config.environmentId)}${META_PREFIX}`
    : `${API_PREFIX}${META_PREFIX}`;
  // Allow baseUrl to already include `/api/v1`; collapse the duplicate.
  if (/\/api\/v\d+$/i.test(trimmed)) {
    const stripped = trimmed.replace(/\/api\/v\d+$/i, '');
    const scopedNoApi = config.environmentId
      ? `${API_PREFIX}/environments/${encodeURIComponent(config.environmentId)}${META_PREFIX}`
      : `${API_PREFIX}${META_PREFIX}`;
    return `${stripped}${scopedNoApi}`;
  }
  return `${trimmed}${scoped}`;
}

/**
 * The `/api/v1/packages` sibling of this client's `/meta` base (`ce986aafc`).
 *
 * Derived from the base rather than stored, so the two clone methods carry it
 * for free. It keeps the ORIGIN the client was configured with (split-origin
 * dev points the console at another port) and drops everything this client
 * appended after it.
 *
 * ⚠️ The environment segment is dropped deliberately: the path built here is
 * byte-for-byte the one the two batch-publish call sites in app-shell have
 * always fired at, and an `/environments/:id/packages` mirror is a route this
 * repo has no reading on. Scoping a call to a path nobody has shown exists
 * would trade a working call for a 404.
 */
function packagesBaseOf(metaBase: string): string {
  const origin = metaBase
    .replace(/\/api\/v\d+(?:\/environments\/[^/]+)?\/meta$/, '')
    .replace(/\/+$/, '');
  return `${origin}${API_PREFIX}/packages`;
}

/**
 * Unwrap the HTTP dispatcher's `{ success, data }` envelope — for the ONE route
 * whose spec declaration says it arrives inside one (`ce986aafc`).
 *
 * ⛔ Not a general tolerance, and the difference is per-route rather than per
 * file: {@link MetadataClient.publishDraft} refuses to unwrap because
 * `PublishMetaItemResponseSchema` describes the full body of a route the REST
 * server answers verbatim, so an envelope there is a shape that door does not
 * serve. `PublishPackageDraftsResponseSchema` says the opposite in as many
 * words — it "describes the FULL body … inside the dispatcher's
 * `{ success, data }` envelope" — so the declared object is the INNER one, and
 * unwrapping is how a caller gets the shape the spec declares.
 *
 * A body with no object-valued `data` is returned as-is: the REST composition
 * answers this route unenveloped, and the ADR-0112 failure envelope
 * (`{ success: false, error }`) has no `data` either, so its `error` stays
 * where the caller's reader expects it.
 */
function unwrapDispatcherEnvelope(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object') return {};
  const root = body as Record<string, unknown>;
  const data = root.data;
  return data && typeof data === 'object' && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : root;
}

async function parseError(res: Response): Promise<MetadataError> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = await res.text().catch(() => undefined);
  }
  const bodyObj = body && typeof body === 'object' ? (body as Record<string, any>) : undefined;
  // The dispatcher error shape is `{ success:false, error:{ message, code,
  // details:{ code, issues } } }` — `error` is an OBJECT. Older/other surfaces
  // send `error` as a plain string or a top-level `message`. Accept all three
  // (reading `.message` off the object case, not `String(object)` which yields
  // "[object Object]").
  const errNode = bodyObj?.error;
  const message =
    (errNode && typeof errNode === 'object' ? errNode.message : errNode) ??
    bodyObj?.message ??
    `Metadata request failed: ${res.status} ${res.statusText}`;
  const err = new Error(String(message)) as MetadataError;
  err.status = res.status;
  err.body = body;
  // Field-anchored spec-validation issues. Two live server shapes carry them:
  // the REST server puts them at top-level `body.issues` (with `error` a string),
  // the HTTP dispatcher nests them under `error.details.issues` (with `error` an
  // object). Accept both (plus a defensive `error.issues`) so the caller can
  // point at the offending field regardless of which transport served the error.
  const details = errNode && typeof errNode === 'object' ? errNode.details : undefined;
  const issues =
    details?.issues ??
    (errNode && typeof errNode === 'object' ? errNode.issues : undefined) ??
    bodyObj?.issues;
  if (Array.isArray(issues)) err.issues = issues as MetadataValidationIssue[];
  const code =
    details?.code ??
    (errNode && typeof errNode === 'object' ? errNode.code : undefined) ??
    bodyObj?.code;
  if (code != null) err.code = String(code);
  return err;
}

/**
 * Is this the single-item response envelope, as opposed to a metadata document?
 *
 * Matched by the PRESENCE of the three keys `GetMetaItemResponseSchema`
 * declares — `type: string`, `name: string`, and an `item` slot — never by
 * guessing from the payload's contents. The distinction matters in both
 * directions:
 *
 *  - A metadata document may legitimately carry its own `type` and `name`
 *    (a view is `{ name, type: 'grid', … }`). Without an `item` key it is the
 *    body, and unwrapping it would destroy it.
 *  - A document could carry an `item` property of its own. Without the
 *    envelope's identity keys it is likewise left whole.
 *
 * Key COUNT is deliberately not part of the test: a real envelope also spreads
 * `MetadataProtectionEnvelopeFields` (`lock`, `provenance`, …), so it routinely
 * has more than three keys.
 */
function isMetaItemEnvelope(
  value: unknown,
): value is { type: string; name: string; item: unknown } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const env = value as Record<string, unknown>;
  return typeof env.type === 'string' && typeof env.name === 'string' && 'item' in env;
}

/**
 * Metadata GETs currently on the wire, per transport (objectui#11797).
 *
 * Keyed by the `fetch` a client was built with, not by the client: the console
 * mints a client per component (`useMetadataClient`), and every one of them is
 * built on the same authenticated fetch, so a per-instance map would never see
 * the sibling that is asking the same question. See
 * {@link MetadataClient.shareRead} for the rules.
 */
const pendingReads = new WeakMap<typeof fetch, Map<string, PendingRead>>();

interface PendingRead {
  /** The one request every sharer waits on. ⛔ Never handed to a caller itself. */
  read: Promise<unknown>;
  /** Sharers that have asked and not yet been handed their answer. */
  waiting: number;
}

function pendingReadsOn(transport: typeof fetch): Map<string, PendingRead> {
  let reads = pendingReads.get(transport);
  if (!reads) {
    reads = new Map();
    pendingReads.set(transport, reads);
  }
  return reads;
}

/**
 * Every sharer gets an answer no other sharer holds, so sharing the request
 * never means sharing the object: before the request was shared every caller
 * parsed its own body, and one caller editing what it got back must still not
 * change what another caller holds.
 *
 * Each sharer is handed its answer in its own reaction on the pending read,
 * registered when it asked — the request's first caller included, whose code
 * would otherwise run ahead of the copies and could edit the very object they
 * are taken from. The LAST sharer to be handed the answer takes the parsed
 * original and every earlier one a copy of it, so nothing is copied when
 * nobody joined. The count is final by the first hand-out: a caller can only
 * join while the entry is in the map, and the entry's own settle reaction,
 * registered before any hand-out, takes it out.
 */
function handOut(entry: PendingRead): Promise<unknown> {
  entry.waiting += 1;
  return entry.read.then((value) => {
    entry.waiting -= 1;
    return entry.waiting === 0 ? value : ownCopy(value);
  });
}

/** The answers are parsed JSON, which `structuredClone` copies exactly. */
function ownCopy<R>(value: R): R {
  if (value === null || typeof value !== 'object') return value;
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : (JSON.parse(JSON.stringify(value)) as R);
}

/**
 * MetadataClient — read/write protocol metadata via the framework REST API.
 *
 * @example
 * ```ts
 * const client = new MetadataClient({ baseUrl: 'http://localhost:3000' });
 * const objects = await client.list<{ name: string; label?: string }>('object');
 * const account = await client.get<{ fields: Record<string, unknown> }>('object', 'account');
 * await client.save('object', 'account', { ...account, label: 'Customer' });
 * ```
 */
export class MetadataClient {
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;
  private readonly headers: Record<string, string>;
  /** ADR-0037: when true, reads render the draft-overlaid world. */
  readonly previewDrafts: boolean;
  /** #4133 / #5026 — sink for every write door's advisory findings; see the config field. */
  private readonly onSaveAdvisory: MetadataSaveAdvisoryListener | undefined;

  constructor(config: MetadataClientConfig) {
    this.base = buildBase(config);
    this.fetchImpl = config.fetch ?? globalThis.fetch.bind(globalThis);
    this.headers = { Accept: 'application/json', ...(config.headers ?? {}) };
    this.previewDrafts = config.previewDrafts === true;
    this.onSaveAdvisory = config.onSaveAdvisory;
  }

  /** Update the client's environment scope at runtime. */
  withEnvironment(environmentId: string | undefined): MetadataClient {
    return new MetadataClient({
      baseUrl: this.base
        .replace(/\/api\/v\d+(?:\/environments\/[^/]+)?\/meta$/, '')
        .replace(/\/+$/, ''),
      environmentId,
      fetch: this.fetchImpl,
      headers: this.headers,
      previewDrafts: this.previewDrafts,
      // #4133: the advisory sink must survive the clone. `useMetadataClient`
      // routes EVERY environment-scoped console client through here, so
      // dropping it would silently disable the channel for exactly the
      // multi-environment tenants the gate is loudest for.
      ...(this.onSaveAdvisory ? { onSaveAdvisory: this.onSaveAdvisory } : {}),
    });
  }

  /**
   * Derive a client whose reads render the draft-overlaid world (or not).
   * Same base/fetch/headers; used by the app-shell to switch the whole
   * renderer tree into ADR-0037 preview mode off one URL flag.
   */
  withPreviewDrafts(previewDrafts: boolean): MetadataClient {
    if (previewDrafts === this.previewDrafts) return this;
    // Preserve the environment scope baked into the base path (unlike
    // `withEnvironment`, which exists to REPLACE it).
    const envMatch = this.base.match(/\/api\/v\d+\/environments\/([^/]+)\/meta$/);
    return new MetadataClient({
      baseUrl: this.base
        .replace(/\/api\/v\d+(?:\/environments\/[^/]+)?\/meta$/, '')
        .replace(/\/+$/, ''),
      ...(envMatch ? { environmentId: decodeURIComponent(envMatch[1]) } : {}),
      fetch: this.fetchImpl,
      headers: this.headers,
      previewDrafts,
      // #4133: carried for the same reason as in `withEnvironment` — preview
      // mode swaps the whole renderer tree's client, and writes are unaffected
      // by ADR-0037, so the save door behind this clone still advises.
      ...(this.onSaveAdvisory ? { onSaveAdvisory: this.onSaveAdvisory } : {}),
    });
  }

  /**
   * Share one in-flight GET among the callers asking the same method for the
   * same URL with the same headers through the same transport (objectui#11797).
   *
   * Opening a Studio package mounts several readers that ask the same
   * question at once, and each one sent its own request. The first call for a
   * key sends `read()`; a call that arrives while it is pending waits for that
   * request instead of sending another.
   *
   * ⛔ Not a response cache, deliberately — the rules `findOne` keeps on the
   * data adapter (objectui#11699):
   *  - the entry goes the moment the read settles, so a call made after an
   *    answer always reaches the network (there is no reuse window: a client
   *    cannot see every write that changes metadata, an agent's server-side
   *    edits among them, and a window would answer the read after such a write
   *    with the state from before it);
   *  - a rejection reaches every caller already waiting and is not remembered;
   *  - a write sent through the same transport drops every pending read when
   *    it lands (see {@link sendWrite}), so a read asked after a save or a
   *    publish is never answered by a request sent before it;
   *  - every caller, the first one included, gets an answer no other caller
   *    holds (see {@link handOut}).
   */
  private shareRead<R>(reader: string, url: string, read: () => Promise<R>): Promise<R> {
    const reads = pendingReadsOn(this.fetchImpl);
    // `reader` names the method: two methods reading one URL read different
    // answers out of it (`list('_drafts')` and `listDrafts()` share a URL).
    const key = JSON.stringify([reader, url, Object.entries(this.headers).sort(([a], [b]) => a.localeCompare(b))]);
    let entry = reads.get(key);
    if (!entry) {
      const created: PendingRead = { read: read(), waiting: 0 };
      reads.set(key, created);
      const settle = () => {
        if (reads.get(key) === created) reads.delete(key);
      };
      created.read.then(settle, settle);
      entry = created;
    }
    return handOut(entry) as Promise<R>;
  }

  /**
   * Send a write, then drop every read still pending on this transport
   * (objectui#11797): a read on the wire when the write lands was asked before
   * it, so a caller asking after the write must not join it. Dropped however
   * the write ends — a refused or interrupted write may still have changed
   * something. The callers already holding a pending read keep its answer.
   */
  private async sendWrite(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(url, init);
    } finally {
      pendingReads.get(this.fetchImpl)?.clear();
    }
  }

  /** List all registered metadata types (returns the registry rows). */
  async listTypes(): Promise<unknown[]> {
    return this.shareRead('listTypes', this.base, async () => {
      const res = await this.fetchImpl(this.base, { method: 'GET', headers: this.headers, cache: 'no-store' });
      if (!res.ok) throw await parseError(res);
      const data = await res.json();
      if (Array.isArray(data)) return data;
      // Framework REST returns `{ types: string[], entries: TypeEntry[] }`
      // where `entries` is the rich per-type registry row. Older / scoped
      // shapes may use `items`. Prefer `entries` (rich), fall back to
      // `items` (legacy), then synthesize stub entries from `types[]`
      // if neither is present.
      if (data && Array.isArray((data as any).entries)) return (data as any).entries;
      if (data && Array.isArray((data as any).items)) return (data as any).items;
      if (data && Array.isArray((data as any).types)) {
        return (data as any).types.map((t: string) => ({ type: t }));
      }
      return [];
    });
  }

  /** List items of a metadata type (e.g. `object`, `field`, `view`). */
  async list<T = unknown>(type: string, options: MetadataListOptions = {}): Promise<T[]> {
    return (await this.listResponse<T>(type, options)).items;
  }

  /**
   * The same list read as {@link list}, with what the server serves beside
   * the items (objectui#12349): today that is the automation engine's
   * `registrations` on a `flow` list — see {@link MetadataListAnswer}.
   *
   * One request for both methods: `list` is this read with the items picked
   * out, so a caller asking both at once shares one in-flight GET.
   */
  async listResponse<T = unknown>(type: string, options: MetadataListOptions = {}): Promise<MetadataListAnswer<T>> {
    const params: string[] = [];
    if (options.packageId) params.push(`package=${encodeURIComponent(options.packageId)}`);
    if (options.include) params.push(`include=${encodeURIComponent(options.include)}`);
    if (this.previewDrafts) params.push('preview=draft');
    const qs = params.length ? `?${params.join('&')}` : '';
    const url = `${this.base}/${encodeURIComponent(type)}${qs}`;
    return this.shareRead('list', url, async (): Promise<MetadataListAnswer<T>> => {
      const res = await this.fetchImpl(url, { method: 'GET', headers: this.headers, cache: 'no-store' });
      if (!res.ok) throw await parseError(res);
      const data = await res.json();
      if (Array.isArray(data)) return { items: data as T[] };
      if (data && Array.isArray((data as { items?: unknown[] }).items)) {
        const registrations = readRegistrations((data as { registrations?: unknown }).registrations);
        return { items: (data as { items: T[] }).items, ...(registrations ? { registrations } : {}) };
      }
      return { items: [] };
    });
  }

  /**
   * List pending DRAFT items (ADR-0033) — what an AI authored but nobody
   * published yet. `list()` only sees published/active metadata, so a
   * just-built app package looks empty there; this surfaces the drafts so the
   * console can show a "pending changes" view and draft-aware package contents.
   * Optionally narrow by `packageId` and/or `type`. Returns light headers
   * (no body) carrying `packageId` for grouping.
   */
  async listDrafts(
    options: { packageId?: string; type?: string } = {},
  ): Promise<MetadataDraftHeader[]> {
    const params: string[] = [];
    if (options.packageId) params.push(`packageId=${encodeURIComponent(options.packageId)}`);
    if (options.type) params.push(`type=${encodeURIComponent(options.type)}`);
    const qs = params.length ? `?${params.join('&')}` : '';
    const url = `${this.base}/_drafts${qs}`;
    return this.shareRead('listDrafts', url, async () => {
      const res = await this.fetchImpl(url, { method: 'GET', headers: this.headers, cache: 'no-store' });
      if (!res.ok) throw await parseError(res);
      const data = (await res.json()) as
        | MetadataDraftHeader[]
        | { drafts?: MetadataDraftHeader[]; data?: { drafts?: MetadataDraftHeader[] } };
      if (Array.isArray(data)) return data;
      return data?.drafts ?? data?.data?.drafts ?? [];
    });
  }

  /**
   * Fetch a single metadata item and return the response body EXACTLY as the
   * server sent it — envelope and all.
   *
   * The one transport both {@link get} (which unwraps) and {@link getDraft}
   * (which does not) sit on, so the two can differ in what they hand back
   * without differing in how they ask. Private on purpose: the envelope is a
   * wire detail, and the two published contracts above are the supported ways
   * to read an item.
   */
  private async readItemResponse<T = unknown>(
    type: string,
    name: string,
    options: MetadataGetOptions = {},
  ): Promise<T | null> {
    const params: string[] = [];
    if (options.state === 'draft') params.push('state=draft');
    // `state=draft` reads the raw draft row explicitly; the overlay flag is
    // redundant (and the dispatcher resolves `state` first), so skip it.
    else if (this.previewDrafts) params.push('preview=draft');
    if (options.packageId) params.push(`package=${encodeURIComponent(options.packageId)}`);
    const qs = params.length ? `?${params.join('&')}` : '';
    const url = `${this.base}/${encodeURIComponent(type)}/${encodeURIComponent(name)}${qs}`;
    return this.shareRead('readItemResponse', url, async () => {
      const res = await this.fetchImpl(url, { method: 'GET', headers: this.headers, cache: 'no-store' });
      if (res.status === 404) return null;
      if (!res.ok) throw await parseError(res);
      return (await res.json()) as T;
    });
  }

  /**
   * Get a single metadata item. Returns the unwrapped item CONTENT — the
   * metadata document itself, so `obj.fields` / `obj.label` are reachable
   * directly.
   *
   * The framework answers `GET /meta/:type/:name` with the spec-declared
   * envelope `{ type, name, item, …protection fields }`
   * (`GetMetaItemResponseSchema`; objectstack#5563 collapsed this read to that
   * ONE shape), so the envelope is unwrapped here — at the client boundary,
   * once — rather than by each caller.
   *
   * **This method used to return the envelope while promising the body**
   * (objectui#4271). Nothing detected the disagreement, because the test
   * doubles across the repo were written against this docblock: every consumer
   * reading `obj.fields` got `undefined` in production and a field list in
   * unit tests. The visible cost was the entire field half of the permission
   * matrix reporting "No fields registered for this object." for every object,
   * plus dead RLS CEL autocomplete, an inert report drill-down and a designer
   * that saved the envelope back over the object body.
   *
   * A response that is NOT the envelope (an older server answering the bare
   * document, or a body of its own shape) passes through untouched, and `null`
   * still comes back on 404 to keep the call site ergonomic.
   */
  async get<T = unknown>(
    type: string,
    name: string,
    options: MetadataGetOptions = {},
  ): Promise<T | null> {
    const resp = await this.readItemResponse<unknown>(type, name, options);
    if (isMetaItemEnvelope(resp)) return (resp.item ?? null) as T | null;
    return resp as T | null;
  }

  /**
   * Read the pending draft body for an item (`?state=draft`). Returns
   * `null` when there is no draft pending. Draft reads do NOT fall
   * back to the published overlay or the artifact registry — a `null`
   * unambiguously means "nothing to publish".
   *
   * Note: this method hands back the `{ type, name, item }` envelope the
   * framework sends, NOT the body — callers read `.item`. That asymmetry with
   * {@link get} is deliberate and long-standing (the draft envelope's identity
   * and protection carriers are part of what a draft reader inspects), so it
   * is preserved by reading the transport directly instead of going through
   * `get()`'s unwrap.
   *
   * ⛔ Do NOT hand `.item` to a gate or a write yourself: the body this serves
   * is DECORATED (`_draft`, then `_diagnostics` from `decorateMetadataItem`),
   * and the spec says a served body is not a valid input to the schema that
   * produced it until those come off. {@link extractDraftBody} is the one
   * reader for this method's answer — it takes the presence verdict and then
   * the strip, in that order. That function used to be copy-pasted into four
   * views and only one copy knew the rule (objectui#8181).
   *
   * Its tolerant siblings exist for the OTHER client method: `unwrapDraftBody`
   * (app-shell) and `unwrapViewDraft` (this package) read a draft that arrived
   * through {@link get}, which already unwrapped the envelope. They split on
   * which method feeds them, not on what they mean — all three strip.
   *
   * objectui#11799 — whether a draft exists is answered by the pending-drafts
   * ledger first (see {@link draftLedgerMayHold}), and `?state=draft` is sent
   * only when the ledger lists the name. The item read answers 404 when there
   * is no draft, so opening every item in Studio used to log one error per
   * item for an answer the ledger gives with a 200.
   */
  async getDraft<T = unknown>(
    type: string,
    name: string,
    options: { packageId?: string } = {},
  ): Promise<T | null> {
    if (!(await this.draftLedgerMayHold(name))) return null;
    return this.readItemResponse<T>(type, name, {
      state: 'draft',
      ...(options.packageId ? { packageId: options.packageId } : {}),
    });
  }

  /**
   * Whether the pending-drafts ledger (`GET /meta/_drafts`) may hold a draft
   * named `name` (objectui#11799).
   *
   * Read through {@link listDrafts}, the shared read objectui#11797 made: a
   * question asked while a ledger read is pending waits for it, and a write
   * through this transport drops it when the write lands ({@link sendWrite}),
   * so a draft saved a moment ago is never reported absent by a read sent
   * before the save.
   *
   * The WHOLE ledger, matched by name. The `?state=draft` read finds a row
   * under either spelling of the type, and, when it names a package, that
   * package's row or the package-less one. The ledger's `type` and `packageId`
   * filters are exact, so a filtered ledger could miss a draft the item read
   * would serve, and the editor would open the published body over a pending
   * draft. Unfiltered, every miss here is a real absence; a same-name row of
   * another type or package only costs the item read that was always sent.
   *
   * A ledger that cannot be read (403 without an authoring capability, 501 on
   * a kernel without drafts, a network fault) is UNKNOWN, not empty: the item
   * read is sent, as before.
   */
  private async draftLedgerMayHold(name: string): Promise<boolean> {
    let drafts: MetadataDraftHeader[];
    try {
      drafts = await this.listDrafts();
    } catch {
      return true;
    }
    return drafts.some((d) => d?.name === name);
  }

  /**
   * Report the runtime authoring gate's advisory findings for a write the
   * server has ALREADY committed (#4133 for the save door, #5026 for the
   * publish door).
   *
   * Everything here is best-effort by construction, and that is the whole
   * contract: the row is committed server-side before this runs, so neither a
   * malformed body, nor a missing key, nor a throwing sink may change what the
   * calling method returns or whether it throws. The server emits `advisories`
   * ONLY when non-empty, so a clean write costs one absent-key check.
   *
   * One helper rather than a copy per door: every door's response declares the
   * key identically, so a second inline copy could only ever drift. The batch
   * door (`ce986aafc`) calls it once per `published[]` element, handing it
   * the element — the object that carries the key there — and the same
   * best-effort contract covers that loop unchanged.
   */
  private emitAdvisories(
    body: unknown,
    event: Omit<MetadataSaveAdvisoryEvent, 'advisories'>,
  ): void {
    if (!this.onSaveAdvisory) return;
    try {
      const advisories = readSaveAdvisories(body);
      if (advisories.length > 0) this.onSaveAdvisory({ ...event, advisories });
    } catch {
      /* an advisory must never turn a committed write into a thrown error */
    }
  }

  /**
   * Save (PUT) a metadata item. The framework accepts both the bare
   * item payload and the `{ item: ... }` / `{ metadata: ... }`
   * envelopes; we send bare for consistency. Pass `mode: 'draft'` to
   * stage the change without publishing (Studio's "Save" button).
   */
  async save<T = unknown>(
    type: string,
    name: string,
    item: unknown,
    options: MetadataClientSaveOptions = {},
  ): Promise<T> {
    if (!name || !String(name).trim()) {
      // The `PUT /meta/:type/:name` route rejects a missing `:name` segment
      // with 405. Fail with a clear contextual error at the call boundary
      // instead of firing a malformed request at the server (#2767).
      throw new Error(
        `MetadataClient.save: name must be non-empty (type="${type}").` +
          ' The PUT /meta/:type/:name route requires a name segment.',
      );
    }
    if (options.ifMatch && options.ifNoneMatch) {
      // objectui#11773 — the two pins can never both hold (the door refuses the
      // pair `400`), so a caller holding both is confused about which row it
      // was built on. Refused before any request, like the name above.
      throw new Error(
        `MetadataClient.save: ifMatch and ifNoneMatch are mutually exclusive (type="${type}", name="${name}").` +
          ' Send ifMatch with the version you read, or ifNoneMatch: "*" when no row is there.',
      );
    }
    // objectui#8676 - before the request, so a refused body issues no PUT and the
    // half-filled draft stays in the client (objectui#7714's ruled behaviour).
    assertObjectMetadataWritable(type, item, 'MetadataClient.save');
    const params: string[] = [];
    if (options.force) params.push('force=true');
    if (options.mode === 'draft') params.push('mode=draft');
    if (options.packageId) params.push(`package=${encodeURIComponent(options.packageId)}`);
    // objectui#12725 - once, and only when stated: the doors refuse a repeated
    // `?surface=` (the arity rule), and an absent one is recorded as `api`.
    if (options.surface) params.push(`surface=${encodeURIComponent(options.surface)}`);
    const qs = params.length ? `?${params.join('&')}` : '';
    const url = `${this.base}/${encodeURIComponent(type)}/${encodeURIComponent(name)}${qs}`;
    const headers: Record<string, string> = {
      ...this.headers,
      'Content-Type': 'application/json',
    };
    if (options.ifMatch) headers['If-Match'] = options.ifMatch;
    if (options.ifNoneMatch) headers['If-None-Match'] = options.ifNoneMatch;
    const res = await this.sendWrite(url, {
      method: 'PUT',
      headers,
      body: JSON.stringify(item),
    });
    if (!res.ok) throw await parseError(res);
    const body = await res.json();
    // #4133 — the runtime authoring gate's advisory findings (objectstack#7435).
    this.emitAdvisories(body, {
      type,
      name,
      door: 'save',
      mode: options.mode === 'draft' ? 'draft' : 'publish',
    });
    return body as T;
  }

  /**
   * Publish a single pending draft BY REFERENCE — promotes the draft row for
   * `(type, name)` into the active overlay and drops the draft. Works for ANY
   * draft, including ones with no `packageId` binding (which the package-scoped
   * `/packages/:id/publish-drafts` flow cannot reach). Use this to publish the
   * exact set returned by {@link listDrafts} without needing a package.
   *
   * Returns the server result. For `seed` drafts the protocol also materializes
   * the rows and reports under `seedApplied` — a data problem never fails the
   * publish, so callers should check `seedApplied?.success` and warn the user
   * rather than assume the data went live.
   *
   * Same door as {@link publish} (`POST /meta/:type/:name/publish`), so it
   * reports the gate's advisories the same way (#5026).
   *
   * The BATCH door (`POST /packages/:id/publish-drafts`) is a different route
   * with a method of its own — {@link publishPackageDrafts} — and it reports
   * too. It did not when this paragraph was first written: it discarded
   * per-draft advisories server-side, which was objectstack#9343, and that card
   * has since landed with a ruling that each `published[]` element carries
   * them (`ce986aafc` is the client half).
   *
   * What survives that change is the READING RULE, which is about this method
   * rather than about the other route: it reads the top level of the
   * single-item body and nothing else. A batch-shaped body arriving HERE still
   * reports nothing, because `PublishMetaItemResponse` declares no
   * `published[]` and a client that went looking for findings wherever they
   * might be would be inventing a contract instead of reading one.
   *
   * ## Why there is no `{ success, data }` unwrapping here (`7b433197d`)
   *
   * This method used to unwrap a dispatcher-shaped envelope before returning,
   * while {@link publish} — the same route, a couple of hundred lines down —
   * did not. Two spellings of one wire contract, and nothing said which was
   * right. The tolerance is gone because the route was MEASURED, at the
   * producer rather than inferred from the response schema:
   *
   *  - The only mount of `POST /api/v1/meta/:type/:name/publish` is the REST
   *    server's own route-manager registration, which answers
   *    `res.json(await protocol.publishMetaItem(...))` — the protocol's object
   *    verbatim, with no envelope branch. The project-scoped mirror
   *    (`/api/v1/environments/:environmentId/...`) re-mounts that same handler.
   *  - The `{ success, data }` envelope has exactly one producer, the runtime
   *    `HttpDispatcher`, and it does not serve this route: its `/meta` domain
   *    has no publish branch, the dispatcher's own route ledger has no row for
   *    it, and a three-segment `/meta` path that is not `/published` terminates
   *    in a located `routeNotFound`. So no composition — REST server, the
   *    dispatcher-only Hono adapter, or both — puts an envelope on this body.
   *  - `packages/spec` states the same split in the two docstrings side by
   *    side: `PublishMetaItemResponseSchema` describes "the FULL body" this
   *    route returns and records that the REST route hands the producer's
   *    object to `res.json()` verbatim, while its batch sibling
   *    `PublishPackageDraftsResponseSchema` describes a body answered
   *    explicitly "inside the dispatcher's `{ success, data }` envelope".
   *
   * ⛔ So an enveloped body on THIS route is not a shape the platform emits,
   * and unwrapping one is not a kindness: it is Commandment #0.1's lenient
   * fallback, a second de-facto contract for a route that declares one. It
   * also fails in the direction that hides the problem — a body that arrived
   * enveloped is one this door did not actually serve, and unwrapping it
   * would present that as a successful promotion.
   *
   * ⚠️ Sibling tolerances in this file are NOT this defect and must stay:
   * {@link listDrafts} reads `data?.data?.drafts` because `GET /meta/_drafts`
   * IS a dispatcher route, and `publishHealthFromResponse` unwraps because the
   * batch door really is enveloped. The rule is per-route, not per-file.
   *
   * ## The bundle member (objectui#12402)
   *
   * Pass `member` to publish one member of a type whose identity is a pair
   * (today only `email_template`, `(name, locale)`), sent as `?member=` — the
   * selector the by-name doors read since objectstack `038d4c958`, and the
   * value a `GET /meta/_drafts` row carries as `member`. A publish that names
   * none promotes the CANONICAL member's draft, so two languages of one
   * template drafted outside a package cannot both be published by name
   * without it. The parameter is OMITTED, never sent empty, when the caller
   * has no member: the door refuses a blank selector, and refuses any
   * selector on a type with no members.
   */
  async publishDraft(
    type: string,
    name: string,
    options: { member?: string } = {},
  ): Promise<{
    success?: boolean;
    seedApplied?: { success: boolean; inserted?: number; updated?: number; error?: string; errors?: unknown[] };
  } & Record<string, unknown>> {
    // Same param-building shape as `reset()`, same wire spelling as the
    // by-name reads in `DraftChangesPanel` (`member=`): present only when the
    // caller has a member, absent otherwise.
    const params: string[] = [];
    if (options.member) params.push(`member=${encodeURIComponent(options.member)}`);
    const qs = params.length ? `?${params.join('&')}` : '';
    const url = `${this.base}/${encodeURIComponent(type)}/${encodeURIComponent(name)}/publish${qs}`;
    const res = await this.sendWrite(url, {
      method: 'POST',
      headers: { ...this.headers, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: '{}',
    });
    if (!res.ok) throw await parseError(res);
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    // #5026 — this is the SAME single-item publish door `publish()` uses, so it
    // reports the same way, and now off the SAME object: the response body
    // itself. `advisories` is declared at the TOP LEVEL of
    // `PublishMetaItemResponse`, which is what this route answers (`7b433197d`).
    this.emitAdvisories(body, {
      type,
      name,
      // objectui#12413 — the member this publish named, under the same rule as
      // the query parameter above: present only when the caller had one.
      ...(options.member ? { member: options.member } : {}),
      door: 'publish',
      mode: 'publish',
    });
    return body as any;
  }

  /**
   * Publish EVERY pending draft bound to one package — Studio's "publish whole
   * app" door, `POST /api/v1/packages/:id/publish-drafts` (ADR-0033; the route
   * that orders structure-before-seeds server-side and runs the ADR-0038 L3
   * runtime probes).
   *
   * ## Why it is expressed here at all (`ce986aafc`)
   *
   * It was not, and that was the defect. Two app-shell call sites fired this
   * route with a bare `fetch` / a page-private `apiJson`, outside the seam that
   * covers every other metadata write — so when objectstack#9343 landed and the
   * server began sending per-draft advisories, the author publishing a whole
   * app was told nothing, while the SAME button's client-side capability lint
   * still raised a toast. A door that cannot report is not a door the gate can
   * reach, however loudly the server speaks.
   *
   * ## What it reports, and what it refuses to invent
   *
   * `PublishPackageDraftsResponseSchema` declares `advisories` on EACH
   * `published[]` element — objectstack#9343's ruled shape, the same element
   * type and the same omitted-when-empty discipline as the single-item door,
   * and explicitly not a parallel top-level map. So this method emits one
   * {@link MetadataSaveAdvisoryEvent} per advised element, each naming that
   * element's own `type` / `name`, through the same sink, event and renderer
   * the save and single-item publish doors use.
   *
   * ⛔ It renders only what the server sent where the schema says it sits:
   *
   * - `advisories` is read off the element, by the one shared reader, which
   *   drops anything that is not a complete finding.
   * - An element that does not carry the `type` and `name` the schema states as
   *   REQUIRED is skipped rather than reported under invented identity — the
   *   event names the item the author has to go fix, and an event that cannot
   *   name it truthfully is worse than silence.
   * - Nothing is derived, counted or summarised from the batch: no advisory
   *   exists here that the server did not put in the body.
   *
   * ## The failure shapes stay the callers'
   *
   * Non-2xx throws {@link MetadataError}, like every other method. A 2xx is
   * RETURNED unexamined — `success: false` is not a failure on this route
   * (`outcome: 'nothing_to_publish'` answers it too, and the spec's own text
   * says to read `outcome`, not the boolean), and the two callers have their
   * own, different rules for the refusal and rolled-back cases. Deciding that
   * here would change behaviour this card is not about.
   *
   * ## The opt-in backfill (objectui#12929)
   *
   * `options.backfill` is sent as the body's `backfill` key, as given, and only
   * when the caller passes one ({@link MetadataPublishPackageDraftsOptions}).
   * Without it the body is `{}`, byte for byte what every caller sent before,
   * so a caller that names nothing writes nothing into existing rows. The
   * receipt is `backfillApplied` on the returned body, unexamined like the rest
   * of a 2xx: one element per named field with the rows written, and `error`
   * on a field that stopped short (the publish itself stands).
   */
  async publishPackageDrafts(
    packageId: string,
    options: MetadataPublishPackageDraftsOptions = {},
  ): Promise<MetadataPublishPackageDraftsResult> {
    if (!packageId || !String(packageId).trim()) {
      throw new Error(
        'MetadataClient.publishPackageDrafts: packageId must be non-empty.' +
          ' The POST /packages/:id/publish-drafts route requires an id segment.',
      );
    }
    const url = `${packagesBaseOf(this.base)}/${encodeURIComponent(packageId)}/publish-drafts`;
    const res = await this.sendWrite(url, {
      method: 'POST',
      // Both call sites this replaces sent the session cookie, and the client's
      // own fetch adds the console's Bearer token — so the routed call carries a
      // superset of what the bare doors carried, never less.
      credentials: 'include',
      headers: { ...this.headers, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(options.backfill !== undefined ? { backfill: options.backfill } : {}),
    });
    if (!res.ok) throw await parseError(res);
    const body = unwrapDispatcherEnvelope(await res.json().catch(() => ({})));
    for (const element of Array.isArray(body.published) ? body.published : []) {
      if (!element || typeof element !== 'object') continue;
      const { type, name } = element as { type?: unknown; name?: unknown };
      if (typeof type !== 'string' || typeof name !== 'string') continue;
      this.emitAdvisories(element, { type, name, door: 'publish', mode: 'publish' });
    }
    return body as MetadataPublishPackageDraftsResult;
  }

  /**
   * Get the 3-state layered view of a metadata item: `code` (the packaged
   * artifact baseline), `overlay` (the tenant customisation row alone) and
   * `effective` (the merged value the runtime sees).
   *
   * Reads **`GET /meta/:type/:name/layers`** — the path the framework declares
   * for this projection, with a response schema of its own
   * (`GetMetaItemLayeredResponseSchema`, objectstack#5882 ruling B). It used to
   * be reached by hanging a `layers` flag on the ordinary item read, which made
   * one route answer two unrelated representations while `packages/spec`
   * declared only one of them. That spelling still answers this same body
   * inside its deprecation window (the response carries RFC 9745
   * `Deprecation: true` and an RFC 8288 `Link: rel="successor-version"` back to
   * this path) and is scheduled for removal upstream, so nothing here may
   * depend on it — the repo-wide ratchet is
   * `scripts/__tests__/layered-read-declared-path-4016.test.ts`.
   *
   * The request is built here rather than delegated to `@objectstack/client`
   * because the SDK expresses no layered read in EITHER spelling: the
   * framework's REST route ledger records this route as `server-only`,
   * "consumed by objectui over plain HTTP", and whether the SDK should express
   * it is an open upstream product call.
   *
   * One behaviour delta rides along with the path, and it is the server's
   * choice rather than ours: the retired flag FELL THROUGH to the plain item
   * read on a backend whose protocol implementation had no layered support,
   * answering the `{ type, name, item }` envelope. A dedicated path refuses to
   * answer a different resource under this one's declared shape, so it returns
   * 501 `NOT_IMPLEMENTED` instead — which surfaces here as a thrown error
   * rather than a view with `code` and `overlay` silently blank.
   */
  async layered<T = unknown>(
    type: string,
    name: string,
    options: { packageId?: string } = {},
  ): Promise<MetadataLayered<T>> {
    // ADR-0048 — `?package=` scopes resolution to one installed package (the
    // editor passes the edited item's owning package, not the Studio app's).
    // It leads the query string now that the flag it used to trail is gone:
    // keeping the `&` would have appended it to the last PATH segment
    // (`…/layers&package=crm`), which matches no route — a 404 that this
    // method turns into an empty-but-successful layered view.
    const qs = options.packageId ? `?package=${encodeURIComponent(options.packageId)}` : '';
    const url = `${this.base}/${encodeURIComponent(type)}/${encodeURIComponent(name)}/layers${qs}`;
    const res = await this.fetchImpl(url, { method: 'GET', headers: this.headers, cache: 'no-store' });
    if (res.status === 404) {
      return { code: null, overlay: null, overlayScope: null, effective: null };
    }
    if (!res.ok) throw await parseError(res);
    const body = (await res.json()) as MetadataLayered<T> & Record<string, unknown>;
    // `typeof body === 'object'` rather than a bare truthiness check: `in`
    // throws a TypeError on a primitive, so a server answering 200 with a bare
    // JSON string or number REJECTED this promise (objectui#5676). That is the
    // one outcome the boundary ruling forbids outright — a malformed body must
    // degrade, never throw — and it fired before any of the validation below
    // could be reached.
    const hasEnvelope =
      typeof body === 'object' &&
      body !== null &&
      (('code' in body) || ('overlay' in body) || ('effective' in body));
    // Left standing, but no longer reachable from a conforming server: the only
    // producer of a 200 body WITHOUT these keys was the retired flag's
    // fall-through to the plain item read, and the declared path answers 501
    // there. Kept out of this migration's scope on purpose — deleting it is a
    // behaviour change for a non-conforming backend, not part of moving the
    // request — and filed as objectui#4983 for removal once the upstream
    // deprecation window closes.
    if (!hasEnvelope) {
      return {
        code: null,
        overlay: null,
        overlayScope: null,
        effective: body as unknown as T,
      };
    }
    // ADR-0010 Phase 4 — the metadata-protection envelope, so the editor can
    // render lock affordances without a second round trip. objectui#5676: it is
    // now VALIDATED here against the producer's own schema instead of cast
    // through unchecked. `safeParse`, never `parse` — a metadata console that
    // rejected every dialect it had not been compiled against would turn a
    // newer server into a blank page, which is strictly worse than the wrong
    // render this fixes.
    const parsed = GetMetaItemLayeredResponseSchema.safeParse(body);
    if (parsed.success) {
      // The conforming path: every value below is the producer's schema output,
      // so the ten `as` assertions this block used to carry are simply gone.
      // `code` / `overlay` / `effective` stay asserted — upstream declares them
      // `z.unknown()`, and `T` is the caller's own choice of narrowing, not
      // something any schema here can check.
      const envelope = parsed.data;
      return {
        code: (envelope.code ?? null) as T | null,
        overlay: (envelope.overlay ?? null) as T | null,
        overlayScope: envelope.overlayScope,
        effective: (envelope.effective ?? null) as T | null,
        ...(body._diagnostics ? { _diagnostics: body._diagnostics as MetadataDiagnostics } : {}),
        lock: envelope.lock,
        ...(envelope.lockReason !== undefined ? { lockReason: envelope.lockReason } : {}),
        ...(envelope.lockSource !== undefined ? { lockSource: envelope.lockSource } : {}),
        ...(envelope.lockDocsUrl !== undefined ? { lockDocsUrl: envelope.lockDocsUrl } : {}),
        ...(envelope.provenance !== undefined ? { provenance: envelope.provenance } : {}),
        ...(envelope.packageId !== undefined ? { packageId: envelope.packageId } : {}),
        ...(envelope.packageVersion !== undefined ? { packageVersion: envelope.packageVersion } : {}),
        editable: envelope.editable,
        deletable: envelope.deletable,
        resettable: envelope.resettable,
      };
    }

    // Degrade and label — never throw, never reject. The body still reaches the
    // caller field for field exactly as it did before this check existed, so
    // nothing that rendered yesterday stops rendering today; what is added is
    // `_unrecognized`, naming the fields the server's own schema refuses. That
    // is the operator's only route to "which state did my server actually
    // send", and the reason the offending value is forwarded rather than
    // dropped (objectui#5672's treatment of `lock`, applied to the envelope).
    //
    // This branch is NOT rare, and must not be read as the error case: the
    // four resolved verdicts (`lock` / `editable` / `deletable` / `resettable`)
    // are required upstream on this path, so any backend older than ADR-0010
    // Phase 4 lands here with nothing unrecognised at all.
    const unrecognized = unrecognizedEnvelopeKeys(body);
    return {
      code: body.code ?? null,
      overlay: body.overlay ?? null,
      overlayScope: body.overlayScope ?? null,
      effective: body.effective ?? null,
      ...(body._diagnostics ? { _diagnostics: body._diagnostics as MetadataDiagnostics } : {}),
      ...(body.lock !== undefined ? { lock: body.lock as MetadataLayered['lock'] } : {}),
      ...(body.lockReason !== undefined ? { lockReason: body.lockReason as string } : {}),
      ...(body.lockSource !== undefined ? { lockSource: body.lockSource as MetadataLayered['lockSource'] } : {}),
      ...(body.lockDocsUrl !== undefined ? { lockDocsUrl: body.lockDocsUrl as string } : {}),
      ...(body.provenance !== undefined ? { provenance: body.provenance as MetadataLayered['provenance'] } : {}),
      ...(body.packageId !== undefined ? { packageId: body.packageId as string } : {}),
      ...(body.packageVersion !== undefined ? { packageVersion: body.packageVersion as string } : {}),
      ...(body.editable !== undefined ? { editable: body.editable as boolean } : {}),
      ...(body.deletable !== undefined ? { deletable: body.deletable as boolean } : {}),
      ...(body.resettable !== undefined ? { resettable: body.resettable as boolean } : {}),
      ...(unrecognized.length > 0 ? { _unrecognized: unrecognized } : {}),
    };
  }

  /**
   * Cross-type sweep of load-time validation results — calls
   * `GET /meta/diagnostics`. Returns every entry the framework
   * considers invalid (or, when `severity: 'warning'`, also entries
   * with only warnings).
   *
   * Used by the Studio's governance overview page and by the
   * directory page to show "N invalid" badges per metadata type.
   */
  async diagnostics(
    options: MetadataDiagnosticsOptions = {},
  ): Promise<MetadataDiagnosticsSummary> {
    const params: string[] = [];
    if (options.type) params.push(`type=${encodeURIComponent(options.type)}`);
    if (options.severity) params.push(`severity=${encodeURIComponent(options.severity)}`);
    if (options.packageId) params.push(`package=${encodeURIComponent(options.packageId)}`);
    const qs = params.length ? `?${params.join('&')}` : '';
    const url = `${this.base}/diagnostics${qs}`;
    const res = await this.fetchImpl(url, { method: 'GET', headers: this.headers, cache: 'no-store' });
    if (res.status === 404) {
      // Older server without the sweep endpoint — caller should treat
      // as "no diagnostics available", not as an error.
      return { entries: [], total: 0, scannedTypes: 0, scannedItems: 0, stats: {} };
    }
    if (!res.ok) throw await parseError(res);
    const data = (await res.json()) as Partial<MetadataDiagnosticsSummary>;
    return {
      entries: Array.isArray(data.entries) ? data.entries : [],
      total: typeof data.total === 'number' ? data.total : 0,
      scannedTypes: typeof data.scannedTypes === 'number' ? data.scannedTypes : 0,
      scannedItems: typeof data.scannedItems === 'number' ? data.scannedItems : 0,
      stats: data.stats && typeof data.stats === 'object' ? data.stats : {},
    };
  }

  /**
   * Find every metadata item that references this one (Phase 3a). Useful
   * for pre-delete impact analysis: "Are any views pointing at this
   * object before I drop it?".
   */
  async references(type: string, name: string): Promise<MetadataReference[]> {
    const url = `${this.base}/${encodeURIComponent(type)}/${encodeURIComponent(name)}/references`;
    const res = await this.fetchImpl(url, { method: 'GET', headers: this.headers, cache: 'no-store' });
    if (res.status === 404) return [];
    if (!res.ok) throw await parseError(res);
    const data = await res.json();
    return Array.isArray(data) ? (data as MetadataReference[]) : (data?.items ?? []);
  }

  /**
   * Reset a metadata customization overlay back to the artifact default.
   * Idempotent: returns the result even when no overlay row existed.
   * Pass `state: 'draft'` to discard the pending draft only (keeps the
   * published overlay intact) — useful for a Studio "Discard draft" button.
   *
   * Pass `packageId` to name the package whose row the delete removes, sent
   * as `?package=`. A delete that names none addresses the one package that
   * holds the item; when two or more packages hold it the door refuses it
   * `409 RESOURCE_CONFLICT`, deletes nothing, and names `?package=` as the
   * remedy. That refusal is thrown like any other {@link MetadataError}.
   */
  async reset<T = unknown>(
    type: string,
    name: string,
    options: MetadataDeleteOptions = {},
  ): Promise<T> {
    // objectui#12335 — the delete door reads `?package=` since objectstack
    // `543b33dee` (`@objectstack/rest` 18.0.0-next.1). Before it the door
    // refused the parameter 400 as unknown, so this method sent none, and the
    // `packageId` its options type already inherited was silently dropped.
    // Same wire spelling and same conditional as `save()` and `publish()`:
    // present when the caller has a binding, OMITTED (never empty) when not.
    const params: string[] = [];
    if (options.state === 'draft') params.push('state=draft');
    if (options.packageId) params.push(`package=${encodeURIComponent(options.packageId)}`);
    const qs = params.length ? `?${params.join('&')}` : '';
    const url = `${this.base}/${encodeURIComponent(type)}/${encodeURIComponent(name)}${qs}`;
    const headers: Record<string, string> = { ...this.headers };
    if (options.ifMatch) headers['If-Match'] = options.ifMatch;
    const res = await this.sendWrite(url, { method: 'DELETE', headers });
    if (!res.ok) throw await parseError(res);
    return (await res.json()) as T;
  }

  /**
   * Promote the pending draft of an item to the active overlay
   * (POST `/meta/:type/:name/publish`). Returns
   * `{ success, version, seq, message }`. Throws a `404 no_draft` if
   * nothing is pending and `409 metadata_conflict` if the published
   * overlay moved while the draft was sitting.
   *
   * Reports the runtime authoring gate's advisory findings through
   * {@link MetadataClientConfig.onSaveAdvisory} when the response carries them
   * (#5026 / objectstack#9176), with `door: 'publish'`. This is the door the
   * Studio designer takes on every edit, so it is the one whose findings an
   * author actually sees.
   */
  async publish<T = unknown>(
    type: string,
    name: string,
    options: { message?: string; packageId?: string } = {},
  ): Promise<T> {
    // objectstack `9e04c3e35` (`@objectstack/rest` 17.2.0) — this door accepts
    // `?package=<id>` and forwards it as the promotion's package binding, so
    // objectstack-ai/objectstack#9612's package-closure narrowing at the runtime publish gate is
    // reachable from an HTTP-driven promotion at all. Deliberately the SAME
    // wire spelling and the same conditional as `save()` a few hundred lines
    // up: ONE value, ONE spelling, both steps of the save->publish loop.
    //
    // The parameter is OMITTED, never sent empty, when there is no binding.
    // `?package=` with an empty value and no `package` key at all are folded
    // together by the framework's normaliser today (`all` and the empty value
    // both mean "env-local overlay, no package"), so this is not a behaviour
    // difference on the current server — it is the shape the save door already
    // follows, and the two calls of one loop must not disagree about it.
    const qs = options.packageId ? `?package=${encodeURIComponent(options.packageId)}` : '';
    const url = `${this.base}/${encodeURIComponent(type)}/${encodeURIComponent(name)}/publish${qs}`;
    const headers: Record<string, string> = {
      ...this.headers,
      'Content-Type': 'application/json',
    };
    const res = await this.sendWrite(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(options.message ? { message: options.message } : {}),
    });
    if (!res.ok) throw await parseError(res);
    const body = await res.json();
    // #5026 — the runtime authoring gate's advisory findings on the publish
    // door (objectstack#9176). This is the door Studio's designer takes on
    // every edit: it saves a draft (never gated — the gate's D1 early-return
    // fires before a single rule runs) and then promotes it HERE, which is the
    // write the gate actually grades. Wiring only the save door therefore left
    // the one flow most tenants use silent, which is what this closes.
    //
    // `mode` is `'publish'` because the promotion lands the body in the active
    // overlay; `door` is what distinguishes it from a direct active save.
    this.emitAdvisories(body, { type, name, door: 'publish', mode: 'publish' });
    return body as T;
  }

  /**
   * Restore an item to a previous version (POST `/meta/:type/:name/rollback`).
   * The server reads the history row at `toVersion`, writes its body back
   * as the active overlay with `operation_type='revert'`. Returns
   * `{ success, version, seq, restoredFromVersion, message }`. Throws
   * `404 version_not_found` for unknown versions and `409 version_not_restorable`
   * when the target version is a delete tombstone.
   */
  async rollback<T = unknown>(
    type: string,
    name: string,
    toVersion: number,
    options: { message?: string } = {},
  ): Promise<T> {
    const url = `${this.base}/${encodeURIComponent(type)}/${encodeURIComponent(name)}/rollback`;
    const headers: Record<string, string> = {
      ...this.headers,
      'Content-Type': 'application/json',
    };
    const res = await this.sendWrite(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        toVersion,
        ...(options.message ? { message: options.message } : {}),
      }),
    });
    if (!res.ok) throw await parseError(res);
    return (await res.json()) as T;
  }

  /**
   * Compute a structured top-level key diff between two history versions
   * (GET `/meta/:type/:name/diff?from=&to=`). Returns
   * `{ added, removed, changed }` where each entry carries a `path` and
   * the relevant value(s). Useful for "what changed in this draft?" and
   * pre-rollback previews.
   */
  async diff<T = unknown>(
    type: string,
    name: string,
    fromVersion?: number,
    toVersion?: number,
  ): Promise<T> {
    const params = new URLSearchParams();
    if (fromVersion !== undefined) params.set('from', String(fromVersion));
    if (toVersion !== undefined) params.set('to', String(toVersion));
    const qs = params.toString();
    const url = `${this.base}/${encodeURIComponent(type)}/${encodeURIComponent(name)}/diff${qs ? `?${qs}` : ''}`;
    const res = await this.fetchImpl(url, {
      method: 'GET',
      headers: this.headers,
      cache: 'no-store',
    });
    if (!res.ok) throw await parseError(res);
    return (await res.json()) as T;
  }

  /** Fetch the durable history (change log) for one metadata item. */
  async history<T = unknown>(
    type: string,
    name: string,
    options: MetadataHistoryOptions = {},
  ): Promise<T> {
    const params = new URLSearchParams();
    if (options.sinceSeq !== undefined) params.set('sinceSeq', String(options.sinceSeq));
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    const qs = params.toString();
    const url = `${this.base}/${encodeURIComponent(type)}/${encodeURIComponent(name)}/history${qs ? `?${qs}` : ''}`;
    const res = await this.fetchImpl(url, { method: 'GET', headers: this.headers, cache: 'no-store' });
    if (!res.ok) throw await parseError(res);
    return (await res.json()) as T;
  }

  /**
   * Fetch the protection-audit trail for one metadata item
   * (ADR-0010 §3.6 / Phase 4.1). Shows every save/publish/rollback/
   * delete/reset attempt — allowed, denied, or forced — so the
   * Studio "审计日志 / Audit log" tab can render who tried what
   * and whether a lock blocked it.
   */
  async audit(
    type: string,
    name: string,
    options: { limit?: number } = {},
  ): Promise<MetadataAuditResponse> {
    const params = new URLSearchParams();
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    const qs = params.toString();
    const url = `${this.base}/${encodeURIComponent(type)}/${encodeURIComponent(name)}/audit${qs ? `?${qs}` : ''}`;
    const res = await this.fetchImpl(url, { method: 'GET', headers: this.headers, cache: 'no-store' });
    if (!res.ok) throw await parseError(res);
    return (await res.json()) as MetadataAuditResponse;
  }
}
