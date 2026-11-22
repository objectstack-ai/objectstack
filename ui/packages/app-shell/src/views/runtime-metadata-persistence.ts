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
import { isDraftVersionConflict } from './metadata-admin/DraftConflictDialog.js';
import { ensureCustomizationPackage, fetchListedPackageManifests } from './studio-design/packages-io.js';
import { listedPackageVersion, type ListedPackageManifest } from './studio-design/packages-io.js';
import { overrideDraftBody } from './studio-design/StudioCustomizeControls.js';

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
  /**
   * objectstack#35624 — the app the console is in, for a NEW view
   * ({@link createRuntimeMetadata}). Absent (outside any app, or a caller that
   * creates no view) → the create saves as before, naming no package.
   */
  app?: RuntimeCreateApp | null;
}

/**
 * objectstack#35624 — the app a console create runs in, and what it is told
 * when the create cannot be saved there.
 */
export interface RuntimeCreateApp {
  /**
   * The routed app's package — the one the draft preview bar counts
   * (`draftBarPackageOf`), so a view saved into it, or into its customization
   * package, is a view that bar counts and publishes. `null` outside any app.
   */
  packageId: string | null;
  /**
   * Called after a create that had an app but was saved naming no package (no
   * writable package of the app could be had, {@link resolveRuntimeCreatePackage}).
   * The save itself landed; this says where it went.
   */
  onSavedOutsideApp?: () => void;
}

/** The two package doors {@link resolveRuntimeCreatePackage} asks. */
export interface RuntimeCreatePackageDoors {
  /** Every listed package by id, with the server's `writable` verdict. */
  listPackages: () => Promise<ReadonlyMap<string, { writable: boolean }>>;
  /** `POST /packages/:base/ensure-customization`: the base's pair, created on first use. */
  ensureCustomization: (basePackageId: string) => Promise<{ packageId: string; writable: boolean }>;
}

const PACKAGE_DOORS: RuntimeCreatePackageDoors = {
  listPackages: fetchListedPackageManifests,
  ensureCustomization: ensureCustomizationPackage,
};

/**
 * objectstack#35624 (ruling C, 「C 存进应用定制包」) — where a view created in
 * an app's console is saved: the app's own package when it is writable, else
 * the app's customization package `<base>.custom` (ADR-0146 D3, the App is the
 * customization unit), asked of the ensure door, which creates it on first use
 * and names it, so its id is never spelled here. `null` when neither can be
 * had: the app's package is not listed, or the ensure door refuses (a walled
 * deployment answers a tenant administrator `403`; a kernel base is refused
 * too). The caller then saves naming no package, as before this card, and says
 * so ({@link RuntimeCreateApp.onSavedOutsideApp}).
 *
 * A refusal here never fails the create: the ruling's fallback is the
 * package-less save, so a door that answers no is reported and passed over.
 */
export async function resolveRuntimeCreatePackage(
  appPackageId: string | null | undefined,
  doors: RuntimeCreatePackageDoors = PACKAGE_DOORS,
): Promise<string | null> {
  if (!appPackageId) return null;
  try {
    const listed = (await doors.listPackages()).get(appPackageId);
    if (!listed) return null;
    if (listed.writable) return appPackageId;
    const pair = await doors.ensureCustomization(appPackageId);
    return pair.writable ? pair.packageId : null;
  } catch (err) {
    console.warn(
      `[runtime-metadata] the customization package of "${appPackageId}" could not be had; the view is saved naming no package:`,
      err,
    );
    return null;
  }
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
 *
 * objectstack#35624 — a NEW VIEW created in an app ({@link RuntimePersistCtx.app})
 * is saved into the app ({@link resolveRuntimeCreatePackage}): into a package
 * the app's draft preview bar counts and publishes, and that travels with the
 * app's customization. Its later edit, read, discard and publish name no
 * package, as every call of this module does: the `/meta` doors address a
 * name's one holding package when the request names none (ADR-0146 D8), so
 * they reach this draft in the pair, and a view saved package-less before this
 * card keeps its package-less address (a `?package=` there would fork it).
 * Only the view callers pass an app; a report, dashboard or page is created
 * exactly as before.
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
  const app = type === 'view' ? ctx.app : null;
  const packageId = app?.packageId ? await resolveRuntimeCreatePackage(app.packageId) : null;
  await ctx.metadataClient.save(type, name, body, packageId ? { mode: 'draft', packageId } : { mode: 'draft' });
  invalidateViewCaches(type, name, ctx);
  announceDraftLedgerWrite();
  if (app?.packageId && !packageId) {
    // The write landed: a notice that fails must not report it as refused.
    try {
      app.onSavedOutsideApp?.();
    } catch (err) {
      console.warn('[runtime-metadata] the saved-outside-app notice failed:', err);
    }
  }
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

/** What {@link saveAndPublishRuntimeMetadata} did. */
export type SaveAndPublishOutcome = 'published' | 'pending-draft';

/**
 * objectstack#35955 — a confirmed save that everyone sees at once (ruling
 * record 7058616478 on that card): the body is staged as the item's draft and
 * published in the same act.
 *
 * Only over NO pending draft. The draft write carries the first-write pin
 * (`ifNoneMatch: '*'`), so the server refuses it `409 METADATA_CONFLICT` when
 * a draft is already pending — whoever saved it, the reader included: the
 * door does not say who did — and nothing is written: resolves
 * `'pending-draft'`. That draft is never published on its saver's behalf.
 *
 * A publish the server refuses leaves no draft of this call behind: the draft
 * it wrote is discarded (it was the only one, by the pin) and the refusal is
 * rethrown. Any other refusal is rethrown as it came.
 */
export async function saveAndPublishRuntimeMetadata(
  type: RuntimeArtifactType,
  name: string,
  body: any,
  ctx: RuntimePersistCtx,
): Promise<SaveAndPublishOutcome> {
  try {
    await ctx.metadataClient.save(type, name, body, { mode: 'draft', ifNoneMatch: '*' });
  } catch (err) {
    if (isDraftVersionConflict(err)) {
      return 'pending-draft';
    }
    throw err;
  }
  try {
    await ctx.metadataClient.publish(type, name);
  } catch (err) {
    try {
      await ctx.metadataClient.reset(type, name, { state: 'draft' });
    } catch (discardErr) {
      // The draft this call wrote stays pending: the view settings' draft
      // bar shows it, and its Discard removes it.
      console.error('[runtime-metadata] a refused publish left its draft pending:', discardErr);
    }
    invalidateViewCaches(type, name, ctx);
    announceDraftLedgerWrite();
    throw err;
  }
  invalidateViewCaches(type, name, ctx);
  announceDraftLedgerWrite();
  return 'published';
}

/**
 * objectstack#36372 — where a dashboard edited on its own page is saved: the
 * package that owns it when that package is writable, else the app's
 * customization package `<base>.custom` (ADR-0146 D2/D3), asked of the ensure
 * door, the layer Studio's Customize writes. `refused` when neither can be
 * had (the owner is not listed, the ensure door refuses, or the pair it
 * answers is not writable): the editor then offers no save.
 *
 * `unbound` is a dashboard that names no package: it is saved where it lives,
 * naming none.
 */
export type DashboardSaveTarget =
  | { kind: 'unbound' }
  | { kind: 'package'; packageId: string }
  | { kind: 'customization'; packageId: string; base: string; basedOn: string | null }
  | { kind: 'refused'; reason: string };

/** The two package doors {@link resolveDashboardSaveTarget} asks. */
export interface DashboardSaveTargetDoors {
  listPackages: () => Promise<ReadonlyMap<string, Pick<ListedPackageManifest, 'writable' | 'manifest'>>>;
  ensureCustomization: (basePackageId: string) => Promise<{ packageId: string; writable: boolean }>;
}

const DASHBOARD_TARGET_DOORS: DashboardSaveTargetDoors = {
  listPackages: fetchListedPackageManifests,
  ensureCustomization: ensureCustomizationPackage,
};

/** {@link DashboardSaveTarget} for a dashboard `ownerPackageId` owns. */
export async function resolveDashboardSaveTarget(
  ownerPackageId: string | null | undefined,
  doors: DashboardSaveTargetDoors = DASHBOARD_TARGET_DOORS,
): Promise<DashboardSaveTarget> {
  if (!ownerPackageId) return { kind: 'unbound' };
  let listed: ReadonlyMap<string, Pick<ListedPackageManifest, 'writable' | 'manifest'>>;
  try {
    listed = await doors.listPackages();
  } catch (err) {
    return { kind: 'refused', reason: err instanceof Error ? err.message : String(err) };
  }
  const owner = listed.get(ownerPackageId);
  if (!owner) return { kind: 'refused', reason: `The package '${ownerPackageId}' is not listed.` };
  if (owner.writable) return { kind: 'package', packageId: ownerPackageId };
  try {
    const pair = await doors.ensureCustomization(ownerPackageId);
    if (!pair.writable) return { kind: 'refused', reason: `The customization package '${pair.packageId}' is not writable.` };
    return {
      kind: 'customization',
      packageId: pair.packageId,
      base: ownerPackageId,
      basedOn: listedPackageVersion(listed as ReadonlyMap<string, ListedPackageManifest>, ownerPackageId),
    };
  } catch (err) {
    return { kind: 'refused', reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * The body an in-page dashboard save writes: `doc` without its top-level `_`
 * keys (the read's decorations belong to the served item), and, into a
 * customization package, declaring the override of its base
 * (`overrideDraftBody`, the body Studio's Customize writes). `null` when an
 * override is owed and there is no version to declare it at.
 */
export function dashboardSaveBody(
  doc: Record<string, unknown>,
  target: Exclude<DashboardSaveTarget, { kind: 'refused' }>,
): Record<string, unknown> | null {
  if (target.kind === 'customization') return overrideDraftBody(doc, target.base, target.basedOn);
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(doc)) {
    if (!key.startsWith('_')) body[key] = value;
  }
  return body;
}

/**
 * objectstack#36372 — save a dashboard edited on its page so everyone sees it
 * at once: staged as its draft in `target`'s package and published from it in
 * the same act ({@link saveAndPublishRuntimeMetadata}, the confirmed-save door
 * of ruling record 7058616478). One item's publish: no package-wide
 * publish-drafts. Over a draft already pending there nothing is written
 * (`'pending-draft'`), so a Studio draft is never published on its saver's
 * behalf.
 */
export async function saveDashboardInPlace(
  name: string,
  body: Record<string, unknown>,
  target: Exclude<DashboardSaveTarget, { kind: 'refused' }>,
  ctx: RuntimePersistCtx,
): Promise<SaveAndPublishOutcome> {
  if (target.kind === 'unbound') return saveAndPublishRuntimeMetadata('dashboard', name, body, ctx);
  return saveAndPublishRuntimeMetadata('dashboard', name, body, {
    ...ctx,
    metadataClient: boundToPackage(ctx.metadataClient, target.packageId),
  });
}

/**
 * `client` with `packageId` named on every write {@link saveAndPublishRuntimeMetadata}
 * makes (`save`, `publish`, `reset`: `?package=` on the draft, the publish and
 * the discard of a refused publish), so the one door serves a package-bound save
 * unchanged. Only those three: they are all the door calls.
 */
function boundToPackage(client: any, packageId: string): any {
  return {
    save: (type: string, name: string, body: unknown, options: Record<string, unknown> = {}) =>
      client.save(type, name, body, { ...options, packageId }),
    publish: (type: string, name: string, options: Record<string, unknown> = {}) =>
      client.publish(type, name, { ...options, packageId }),
    reset: (type: string, name: string, options: Record<string, unknown> = {}) =>
      client.reset(type, name, { ...options, packageId }),
  };
}
