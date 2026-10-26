// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0034 — Runtime metadata persistence seam.
 *
 * Runtime editing of **views / reports / dashboards** is unified with studio's
 * `/meta` per-item **draft → publish → version** model. A runtime edit stages a
 * per-item **draft** (invisible to other users, live in the editor's own
 * preview); an explicit **publish** promotes it to the active overlay and
 * records a version.
 *
 * This module is the single seam every runtime persistence call flows through,
 * so the call sites (ObjectView / ReportView / DashboardView / RuntimeDraftBar)
 * stay decoupled from the `MetadataClient` shape.
 *
 * The bespoke per-type tables (`sys_view` / `sys_report` / `sys_dashboard`) and
 * their shape adapters have been retired — there is no longer a feature flag or
 * a legacy write path here.
 *
 * **This seam is a view WRITER, so it invalidates the DataSource's view caches**
 * (objectui#4373). `ObjectStackAdapter` caches two view-shaped reads, and the
 * rows this module writes are the rows those reads enumerate — but the two
 * writers were disjoint: the adapter's own `createView`/`updateView`/… fixed
 * their key lists in objectui#4363, while the console's real create-and-publish
 * flow comes through HERE and invalidated nothing. Which keys they are stays the
 * adapter's business ({@link ViewCacheInvalidator}); all this module decides is
 * whether a given write is a view write, and it hands the object name down from
 * the call site.
 *
 * **Every write here also changes the pending-drafts ledger, so it announces
 * itself on the assistant bus** (objectui#13139). The draft preview bar, the
 * home banner, the Studio topbar and the chat bar all count pending drafts
 * through `usePendingDrafts`, which re-reads on the `emitMetadataRefresh()`
 * pulse and on nothing a write in this module did. So a runtime Save left the
 * preview bar saying "no unpublished changes", and a runtime Publish left it
 * offering "Publish to see it live", until a reload. The pulse goes out from
 * each write function below, after its write lands and never after a refused
 * one ({@link announceDraftLedgerWrite}).
 */

import { stripReadDecorations } from '@objectstack/spec/kernel';
import { emitMetadataRefresh } from '../assistant/assistantBus.js';
import { slugify } from './metadata-admin/createDerive.js';

/** The runtime-editable artifact types ADR-0034 unifies. `page` (a record
 *  `PageSchema`) joins the original three (#1541): a record page is edited in
 *  the browser and staged/published through the same `/meta` draft model. */
export type RuntimeArtifactType = 'view' | 'report' | 'dashboard' | 'page';

/**
 * The metadata `name` (the `:name` in `/meta/page/:name`) for an object's
 * record page. Prefer an already-assigned record page's name; otherwise mint
 * the convention `<object>_record`. Editing the synthesized default for the
 * first time materialises a real named page under this key so it has something
 * to draft / publish / version against.
 */
export function recordPageName(objectName: string, existingName?: string | null): string {
  return existingName || `${objectName}_record`;
}

/**
 * Wrap an edited `PageSchema` as a persistable **record page** body: ensures the
 * `name` / `object` / `type: 'record'` / `kind: 'full'` identity fields the
 * resolver (`usePageAssignment`) matches on, so a published page overrides the
 * synthesized default for that object on the next render.
 *
 * `type` is the one record-page discriminator. The envelope used to write
 * `type: 'page'` plus `pageType: 'record'`: `PageSchema` refuses both (`'page'`
 * is not a page type, and `pageType` is a declared alias of `type`), and the
 * resolver reads `type` alone (objectui#9674).
 */
export function recordPageEnvelope(
  objectName: string,
  schema: Record<string, any>,
  name?: string,
): Record<string, any> {
  return {
    ...schema,
    type: 'record',
    name: recordPageName(objectName, name ?? (schema?.name as string | undefined)),
    object: objectName,
    kind: 'full',
  };
}

/**
 * The adapter-side cache seam this module routes view writes through.
 *
 * Structural on purpose: the only implementation is `ObjectStackAdapter`
 * (`@object-ui/data-objectstack`), and the call sites already hold it as the
 * `dataSource` prop `AppContent` takes from `useAdapter()` — so this module
 * needs the SHAPE, not the class, and app-shell gains no import it did not have.
 * Every other `dataSource` view call in `ObjectView` is duck-typed the same way.
 */
export interface ViewCacheInvalidator {
  /** Drop `view:{object}:{name}` + `view-overrides:{object}`. */
  invalidateViewKeys(objectName: string, viewName: string): void;
}

/** Everything the seam needs to persist any of the four artifact types. */
export interface RuntimePersistCtx {
  /** Studio metadata client — the `/meta` draft/publish/version API. */
  metadataClient: any;
  /**
   * The DataSource whose view caches this write stales (objectui#4373).
   *
   * `metadataClient` writes the `/meta/view/:name` rows that
   * `ObjectStackAdapter` caches under two view-shaped keys, and until #4373
   * nothing connected the two: a user created a view in the console and
   * published it, and the object's override map kept answering from its
   * pre-publish snapshot for the rest of the cache's 5-minute TTL. It does not
   * self-heal — `loadViewOverrides` treats a RESOLVED map as authoritative and
   * deliberately does not re-probe per view (objectui#3774) — so the per-view
   * `getView` fallback that would have masked it is by design unreachable.
   *
   * Optional: report / dashboard / page writes need nothing here, and a call
   * site without an adapter still persists exactly as before.
   *
   * Declared as what the seam really takes: the host's adapter OBJECT, whatever
   * its class, probed for the one capability named here (objectui#7483). The
   * bare `Partial<ViewCacheInvalidator>` it used to be is a weak type (every
   * member optional), so TypeScript refused a typed `DataSource` for sharing no
   * member with it (TS2559) — the published contract does not declare
   * `invalidateViewKeys`, only the `ObjectStackAdapter` class does. The `object`
   * half admits any adapter; the `Partial` half still refuses a primitive and a
   * wrongly-typed `invalidateViewKeys`.
   */
  dataSource?: (object & Partial<ViewCacheInvalidator>) | null;
  /**
   * The object a `view` write belongs to — the `{object}` half of both keys.
   *
   * Required to invalidate, and taken from the call site rather than parsed out
   * of `name`. A runtime-created view's name is the qualified `<object>.<key>`
   * ({@link viewEnvelope}), but a source-declared view's is not, so splitting
   * the name would be a second, silently-wrong identity rule (AGENTS.md #0.1).
   * Absent → nothing object-scoped can be named, and the write is left alone.
   */
  objectName?: string | null;
}

/**
 * Drop the view-shaped cache keys a just-written view row stales.
 *
 * The key set itself lives in ONE place — the adapter's `invalidateViewKeys`
 * (objectui#4373) — so this module never spells `view-overrides:` and cannot
 * drift from it. Here we only decide WHETHER a write is a view write.
 *
 * Applied uniformly to every function in this module, including the draft-only
 * ones, and that is deliberate over-invalidation: both cached readers enumerate
 * PUBLISHED rows, so a draft save or a discard stales neither. It matches the
 * rule the adapter's own draft half already follows, for the same reason — an
 * unnecessary invalidation costs one refetch, a missed one costs up to the
 * 5-minute TTL, and a per-function exception list is precisely how this key set
 * got forgotten twice already.
 *
 * Never throws: a cache drop that fails must not fail the persist that
 * succeeded. The worst case is the staleness this fix removes.
 */
function invalidateViewCaches(
  type: RuntimeArtifactType,
  name: string,
  ctx: RuntimePersistCtx,
): void {
  if (type !== 'view') return;
  const objectName = ctx.objectName;
  if (!objectName || !name) return;
  const invalidate = ctx.dataSource?.invalidateViewKeys;
  if (typeof invalidate !== 'function') return;
  try {
    invalidate.call(ctx.dataSource, objectName, name);
  } catch (err) {
    console.warn('[runtime-metadata] view cache invalidation failed:', err);
  }
}

/**
 * Announce a landed write to the pending-drafts ledger (objectui#13139).
 *
 * `emitMetadataRefresh()` is the one signal every `usePendingDrafts` surface
 * re-reads on, and it drops the `_drafts` reads already on the wire before
 * they do, so the count they install is read after this write. It is the
 * pulse a publish path raises (Studio, the chat card, the draft preview bar's
 * own Publish), and the one the chat already raises when an agent STAGES a
 * draft (`AiChatPage`, objectui#5801): a draft save here is that second kind.
 *
 * Every function in this module that writes calls it, for the reason
 * {@link invalidateViewCaches} is applied uniformly: a save adds a draft, a
 * discard removes one, a publish promotes one, and a per-function exception
 * list is how a stale count is left behind.
 *
 * Called only after the write resolves, so a refused write announces nothing.
 * Never throws: a listener that fails must not turn a write that landed into
 * a reported failure.
 */
function announceDraftLedgerWrite(): void {
  try {
    emitMetadataRefresh();
  } catch (err) {
    console.warn('[runtime-metadata] metadata refresh announcement failed:', err);
  }
}

/**
 * Unwrap a `?state=draft` GET response into its bare body, or `null` when
 * there is nothing pending.
 *
 * The framework wraps draft reads in a `{ type, name, item }` envelope; a
 * published read is the bare body. This accepts either shape and returns
 * `null` for an empty/absent draft so `!!readRuntimeDraft(...)` is a reliable
 * "has pending changes" check.
 *
 * The tolerant sibling of `@object-ui/data-objectstack`'s `extractDraftBody`,
 * and the tolerance is load-bearing rather than defensive: `readRuntimeDraft`
 * reads through `MetadataClient.get()`, which UNWRAPS the envelope at the
 * client boundary (objectui#4271), so the bare-body limb is the normal path
 * here and the envelope limb covers a body arriving by any other route. That
 * is the only reason this is a separate function; the two split on which
 * client method feeds them, not on what they mean.
 *
 * ⚠️ It mirrors that helper's read-decoration strip too (objectui#8181): the
 * body this returns is handed to `RuntimeDraftBar`'s `onResume`, which seeds
 * the host editor whose next save writes it back, so a served `_diagnostics` /
 * `_draft` would complete the round trip the spec's `stripReadDecorations`
 * exists to break. The key list is the spec's, never a copy; the ADR-0010
 * protection envelope is deliberately not on it and survives untouched.
 *
 * The emptiness verdict is taken BEFORE the strip — what counts as a pending
 * draft is the server's answer, and removing our own decorations must not be
 * able to turn a served draft into "no draft".
 */
export function unwrapDraftBody(
  resp: unknown,
): Record<string, unknown> | null {
  if (!resp || typeof resp !== 'object') return null;
  const env = resp as Record<string, unknown>;
  if ('item' in env) {
    const body = env.item;
    if (!body || typeof body !== 'object') return null;
    return Object.keys(body as object).length > 0
      ? (stripReadDecorations(body) as Record<string, unknown>)
      : null;
  }
  return Object.keys(env).length > 0
    ? (stripReadDecorations(env) as Record<string, unknown>)
    : null;
}

/**
 * Persist a runtime edit of a view / report / dashboard as a per-item DRAFT
 * (invisible to other users until {@link publishRuntimeMetadata}).
 */
export async function persistRuntimeMetadata(
  type: RuntimeArtifactType,
  name: string,
  body: any,
  ctx: RuntimePersistCtx,
): Promise<void> {
  await ctx.metadataClient.save(type, name, body, { mode: 'draft' });
  invalidateViewCaches(type, name, ctx);
  announceDraftLedgerWrite();
}

/**
 * The canonical runtime-created **list view** body (ADR-0017 ViewItem). The
 * same shape Studio's create flow emits (`metadata-admin/anchors.ts`
 * `createBuildBody`), so a view born from the record-list "Add View" dialog is
 * indistinguishable from one authored in the designer.
 */
export interface ViewEnvelope {
  /** Globally-unique qualified id `<object>.<key>` — used as BOTH the URL
   *  segment and the body identity (see {@link viewEnvelope}). */
  name: string;
  object: string;
  viewKind: 'list';
  label: string;
  config: Record<string, any>;
}

/**
 * Derive the machine **key** (the bare `<key>` half of `<object>.<key>`) for a
 * runtime-created view.
 *
 * Order of preference:
 *   1. An explicit machine name the user typed (the CreateViewDialog now
 *      collects one, sanitized). A fully-qualified `<object>.<key>` that slips
 *      in is reduced to its `<key>` so we never double-qualify.
 *   2. `slugify(label)` for Latin labels.
 *   3. A unique last-resort fallback — reached only for a non-Latin (CJK/…)
 *      label with no machine name (`slugify` returns empty for those, #2767 P5).
 *      The dialog requires manual entry in that case, so this is defence in
 *      depth, not the common path.
 */
export function deriveViewKey(opts: {
  name?: string | null;
  label?: string | null;
  type?: string | null;
}): string {
  const explicit = String(opts.name ?? '').trim();
  if (explicit) {
    return explicit.includes('.')
      ? explicit.slice(explicit.lastIndexOf('.') + 1)
      : explicit;
  }
  const fromLabel = slugify(String(opts.label ?? ''));
  if (fromLabel) return fromLabel;
  const type = String(opts.type ?? '').trim() || 'view';
  return `${type}_${Date.now().toString(36)}`;
}

/**
 * Wrap an assembled list-view `spec` (type / columns / sub-config / filter …)
 * as a canonical {@link ViewEnvelope} ready for the `/meta` draft seam.
 *
 * **Identity is unified** (#2767 P1): the returned `name` is the qualified
 * `<object>.<key>`, and callers MUST pass it as BOTH the URL segment and the
 * body — `createRuntimeMetadata('view', env.name, env)`. The server keys the
 * `sys_metadata` row by the URL segment, so a split (bare key as segment,
 * qualified name in the body) writes a row the draft → read → publish loop
 * can't find (404), and a later Studio save forks a second row for the same
 * view. One name, used everywhere, keeps the tab id, the row key, and
 * `body.name` identical.
 *
 * The object binding is stamped under `config.data` so `listViews()` can match
 * the view to its object after publish (it filters on `config.data.object` /
 * top-level `object`).
 */
export function viewEnvelope(
  objectName: string | undefined,
  spec: Record<string, any>,
  opts: { name?: string | null; label?: string | null } = {},
): ViewEnvelope {
  const object = String(objectName ?? '');
  const label = String(opts.label ?? spec?.label ?? '').trim();
  const key = deriveViewKey({ name: opts.name, label, type: spec?.type });
  const qualifiedName = object ? `${object}.${key}` : key;
  // `name` / `label` live at the envelope top level (the canonical ViewItem
  // shape) — strip them from the nested config so the two don't drift.
  const config: Record<string, any> = { ...(spec ?? {}) };
  delete config.name;
  delete config.label;
  config.data = { provider: 'object', ...(spec?.data ?? {}), object };
  return { name: qualifiedName, object, viewKind: 'list', label, config };
}

/**
 * Create a NEW runtime artifact as a per-item draft. Returns its name (for the
 * caller's auto-activation). A new view's spec (default columns, the
 * kanban/gallery sub-config) is built before it gets here, by `buildNewViewSpec`
 * (`newViewSpec.ts`), and the auto-activation stays in the call site.
 */
export async function createRuntimeMetadata(
  type: RuntimeArtifactType,
  name: string,
  body: any,
  ctx: RuntimePersistCtx,
): Promise<string | undefined> {
  if (!name || !String(name).trim()) {
    // Defence in depth against the empty-`:name` 405 (#2767): the server's
    // `PUT /meta/:type/:name` route rejects a missing segment. `viewEnvelope`
    // already guarantees a non-empty qualified name, so hitting this means a
    // caller bypassed it — fail loud rather than emit a malformed URL.
    throw new Error(
      `createRuntimeMetadata: name must be non-empty (type="${type}").` +
        ' The server PUT /meta/:type/:name route requires a name segment.',
    );
  }
  await ctx.metadataClient.save(type, name, body, { mode: 'draft' });
  invalidateViewCaches(type, name, ctx);
  announceDraftLedgerWrite();
  return name;
}

/**
 * Read the pending draft body for a runtime artifact (for the "unpublished
 * changes" indicator and resume-on-open). Returns the bare body, or `null`
 * when nothing is pending.
 */
export async function readRuntimeDraft<T = Record<string, unknown>>(
  type: RuntimeArtifactType,
  name: string,
  ctx: RuntimePersistCtx,
): Promise<T | null> {
  const resp = await ctx.metadataClient.get(type, name, { state: 'draft' });
  return unwrapDraftBody(resp) as T | null;
}

/**
 * Discard the pending draft of a runtime artifact (Studio's "Discard draft").
 * The published overlay is untouched.
 */
export async function discardRuntimeDraft(
  type: RuntimeArtifactType,
  name: string,
  ctx: RuntimePersistCtx,
): Promise<void> {
  await ctx.metadataClient.reset(type, name, { state: 'draft' });
  invalidateViewCaches(type, name, ctx);
  announceDraftLedgerWrite();
}

/**
 * Publish a previously-staged runtime edit: promote the pending draft to the
 * active overlay and record a version.
 *
 * **This is the moment objectui#4373 measures.** Publish is what turns an
 * invisible draft into a published row, which is the world both cached readers
 * enumerate — so it is the write that genuinely stales
 * `view-overrides:{object}`, and the one that used to leave it stale for the
 * full TTL. See {@link RuntimePersistCtx.dataSource}.
 */
export async function publishRuntimeMetadata(
  type: RuntimeArtifactType,
  name: string,
  ctx: RuntimePersistCtx,
): Promise<void> {
  await ctx.metadataClient.publish(type, name);
  invalidateViewCaches(type, name, ctx);
  announceDraftLedgerWrite();
}
