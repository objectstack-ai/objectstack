import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  type ReactNode,
} from 'react';
import { expandViewContainer } from '@objectstack/spec/ui';
import { ActiveOrganizationStorage, TokenStorage, useAuth } from '@object-ui/auth';
import { isMetaItemAbsentError, MetadataNotFoundError, type ObjectStackAdapter } from '@object-ui/data-objectstack';
import { normalizeSchemaReferenceKeys } from '@object-ui/core';
import { errorCodeIs } from '@object-ui/types';
import { resolveInlineMode } from '@object-ui/plugin-form';
import { MetadataCtx, useMetadata, type MetadataContextValue, type MetadataCacheState, type MetadataTypeStatus } from '@object-ui/react';
import { usePreviewDrafts } from '../preview/PreviewModeContext.js';
import { createConsoleMetadataClient } from '../views/metadata-admin/metadataClientFactory.js';
import { subscribeCanvasInvalidate, subscribeMetadataRefresh } from '../assistant/assistantBus.js';

// `MetadataTypeStatus` is `@object-ui/react`'s, the one authority: the status
// `MetadataContextValue.getTypeStatus` returns is the same four words this
// provider's cache entries carry, so this module re-exports it rather than
// declaring a second copy (objectui#6349, batch 9).
export type { MetadataCacheState, MetadataContextValue, MetadataTypeStatus };
export { useMetadataItem } from '@object-ui/react';
export { useMetadata };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TypeCacheEntry {
  status: MetadataTypeStatus;
  items: any[];
  byName: Map<string, any>;
  error: Error | null;
  fetchedAt: number;
  promise: Promise<any[]> | null;
}

/**
 * One by-name read's outcome (objectui#13009). `item` is the definition, or
 * `null` when none came back; `failed` tells WHICH `null` it is: `false` when
 * the server answered without one (the item-less envelope, a thrown
 * `RESOURCE_NOT_FOUND`, or a thrown {@link ANSWERED_REFUSAL_CODES} refusal),
 * `true` when no answer was obtained at all (a 5xx, a network drop, a 404
 * carrying no declared code or a code this build does not know).
 * `refusal` names the refusal code when the answer was one (objectui#13052).
 * `getItem` hands its callers `item` alone, as it always has; the object scope
 * needs the difference, because only an answer may record a name as missing.
 */
interface ItemRead {
  item: any | null;
  failed: boolean;
  refusal?: string;
}

/**
 * objectui#13052 — the refusals a by-name read takes as a definite ANSWER
 * besides the plain absence (`isMetaItemAbsentError`, whose published meaning
 * "does not exist" stays exactly that). `OBJECT_PACKAGE_DISABLED` is the
 * ADR-0112 code the metadata route answers for an object whose owning package
 * is disabled: the object exists and is not being served. Classified here, at
 * the console's read site, so a route can say which of the two it was. Any
 * other code is not an answer this build understands: the read failed.
 */
const ANSWERED_REFUSAL_CODES: readonly string[] = ['OBJECT_PACKAGE_DISABLED'];

type ItemPromiseMap = Map<string, Promise<ItemRead>>;

/**
 * One package's object definitions, plus the objects outside it that a reader
 * named (objectui#12811): what `readObjectScope` answers from.
 *
 * `items` is the package list followed by the by-name extras. Like every cache
 * array here it is REPLACED on each write, never mutated, because
 * `composeObjects` keys its composed list on it. No timestamp: an entry is
 * dropped or refetched only with the `object` type (`invalidate`, `refresh`,
 * an organization or preview-mode switch).
 */
interface ObjectScopeEntry {
  status: MetadataTypeStatus;
  items: any[];
  /** The package list has answered once; a refetch keeps this, and the items. */
  answered: boolean;
  /**
   * The names read by name for this scope, and how each read stands.
   * `failed` (objectui#13052): the last read obtained no answer. It is not
   * asked again by a later read, only by `invalidate`, `refresh` or a scope
   * refetch, so a failure settles the route once instead of re-asking on every
   * render it causes.
   */
  names: Map<string, 'pending' | 'answered' | 'failed'>;
  /** The names the server answered without a definition. Replaced on change. */
  missing: string[];
  /**
   * The names in `missing` whose answer was a refusal, with its code
   * (objectui#13052). Replaced on change.
   */
  refused: Readonly<Record<string, string>>;
}

const NO_REFUSALS: Readonly<Record<string, string>> = Object.freeze({});

/** `refused` without `name`: a new record, the stored one is never mutated. */
function withoutRefusal(refused: Readonly<Record<string, string>>, name: string): Readonly<Record<string, string>> {
  const next = { ...refused };
  delete next[name];
  return next;
}

const NO_NAMES: readonly string[] = Object.freeze([]) as readonly string[];

/**
 * The key of the names-only object scope (objectui#12980): the objects a
 * reader names when it has no package to scope by (a page route in an app
 * item without `_packageId`). A package id is never empty, so it cannot
 * collide with one. It has no package list: each name is read by name.
 */
const NAMES_ONLY_SCOPE = '';

interface MetadataProviderProps {
  children: ReactNode;
  adapter: ObjectStackAdapter;
  ttlMs?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const EAGER_TYPES = ['app', 'view'] as const;

/**
 * How long a FAILED type stays un-retried (objectui#4042).
 *
 * `entry.promise` already collapses callers that arrive while a request is in
 * flight — but callers that arrive just AFTER a failure found `status: 'error'`
 * with `promise: null` and each started a fresh attempt. That is a real
 * sequence, not a hypothetical: the mount effect walks EAGER_TYPES serially, so
 * by the time it reaches `view` the render-phase read of `view` has already
 * failed, and it re-requested it. Signed out, that was a second doomed 401 per
 * type; signed in, a second doomed request on any transient failure.
 *
 * Deliberately ~1s and NOT `ttlMs`: this exists to collapse the burst of
 * callers that start together during one mount, not to cache failures. A later
 * caller (route change, remount) still retries on its own, and `refresh()` /
 * `invalidate()` — which zero `fetchedAt` / reset the status — retry
 * immediately and unconditionally, so no explicit recovery path is affected.
 */
const ERROR_RETRY_COOLDOWN_MS = 1000;

const TYPE_BY_STATE_KEY: Record<keyof Omit<MetadataCacheState, 'loading' | 'error'>, string> = {
  apps: 'app',
  objects: 'object',
  dashboards: 'dashboard',
  reports: 'report',
  pages: 'page',
};

const SESSION_STORAGE_PREFIX = 'objectui:metadata:';

/**
 * Storage scope for a deployment with no active organization — a single-tenant
 * install, or a brand-new user before provisioning. A real org id can never
 * collide with it (`@` is not produced by the id generator), and the moment an
 * org DOES become active the scope changes, so a list cached with no org is
 * never served to one.
 */
const NO_ORG_SCOPE = '@none';

/**
 * The active organization id, read the SAME way the request that filled this
 * cache reads it (objectui#4486).
 *
 * `createAuthenticatedFetch` stamps `X-Tenant-ID` from
 * `ActiveOrganizationStorage` on every `/api/v1/meta/*` call, so deriving the
 * cache scope from that same storage makes the key equal to the tenant the
 * items were fetched under — the cache cannot describe itself as belonging to
 * an org other than the one the server filtered for.
 *
 * Deliberately NOT `useAuth().activeOrganization?.id`: that resolves
 * ASYNCHRONOUSLY (AuthProvider fetches the membership list after mount), so at
 * seed time — the whole point of this cache — it is still `null` and every boot
 * would miss its own entry. The storage value is already correct at mount
 * because the previous session wrote it.
 */
function activeOrgScope(): string {
  try {
    return ActiveOrganizationStorage.get() || NO_ORG_SCOPE;
  } catch {
    return NO_ORG_SCOPE;
  }
}

/**
 * Storage scope for "nobody is signed in" — see {@link principalScope}. Shares
 * the `@` convention with {@link NO_ORG_SCOPE}; {@link fingerprintToken} emits
 * base-36 digits only, so a real principal can never produce it.
 */
const ANON_PRINCIPAL = '@anon';

/**
 * 64 bits of non-reversible key material derived from the session token — two
 * FNV-1a passes with different constants and finalizers, each emitted as a
 * zero-padded base-36 word so the halves cannot re-associate into a colliding
 * pair.
 *
 * Deliberately NOT `crypto.subtle.digest`: that is ASYNC and this value is
 * needed synchronously on the mount path. It is not standing in for a security
 * primitive either — the token itself already sits in same-origin
 * `localStorage`, so hashing hides nothing from anyone who can read this key.
 * It exists so the key can DISCRIMINATE principals without printing a live
 * credential into a storage key name.
 */
function fingerprintToken(token: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0xc2b2ae35;
  for (let i = 0; i < token.length; i += 1) {
    const code = token.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193);
    h2 = Math.imul(h2 ^ code, 0x85ebca6b);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 15), 0x2545f491);
  h2 = Math.imul(h2 ^ (h2 >>> 13), 0x27d4eb2f);
  const word = (h: number) => (h >>> 0).toString(36).padStart(7, '0');
  return `${word(h1)}${word(h2)}`;
}

/**
 * Fingerprint of the session this cache was filled under (objectui#5198).
 *
 * `sessionStorage` is per-TAB, not per-session, and no sign-out call site
 * reloads the page — so signing out and signing a DIFFERENT person in inside
 * the same tab used to seed them from the previous user's entry. What sits
 * there is that user's PERMISSION-FILTERED app list (the server filters
 * `GET /api/v1/meta/:type` per session), which makes it a cross-principal
 * disclosure rather than ordinary staleness. Org-scoping does not close it:
 * two users in the SAME org compute the same {@link activeOrgScope}.
 *
 * `AuthProvider.signOut` purges these entries, and that is the commissioned
 * fix; this scope is the half that does not depend on remembering it. An entry
 * written under one session is not AT the key the next session computes, so it
 * is unreadable by construction however sign-out paths evolve.
 *
 * Why the TOKEN rather than `useAuth().user?.id` — the same reason
 * {@link activeOrgScope} reads storage instead of the context: the user
 * resolves ASYNCHRONOUSLY (`AuthProvider` fetches the session after mount), so
 * at seed time, which is the entire point of this cache, it is still `null`
 * and every boot would miss its own entry. `TokenStorage` is the one identity
 * already correct synchronously at mount, and it is the SAME credential the
 * request that filled the cache authenticated with — so, exactly as with the
 * tenant scope, the key cannot claim a principal the server did not filter for.
 *
 * A token ROTATION (impersonation, objectui#4467) changes the fingerprint,
 * which is correct — the principal genuinely changed. The cost of any change
 * here is one cache MISS, i.e. a refetch, never stale data.
 *
 * Client-local by construction: no new field on the session response and no
 * extra request — see the issue's scope ruling.
 */
function principalScope(): string {
  let token: string | null = null;
  try {
    token = TokenStorage.get();
  } catch {
    /* SSR / storage unavailable */
  }
  return token ? fingerprintToken(token) : ANON_PRINCIPAL;
}

/**
 * `objectui:metadata:<type>:<orgId>:<principal>` — see {@link activeOrgScope}
 * and {@link principalScope}. Both scopes come from the same client-local
 * storage the request that filled the entry tenanted and authenticated itself
 * with, so a key can never describe a principal/tenant pair the server did not
 * filter for.
 */
function sessionKeyForOrg(type: string, orgScope: string): string {
  return `${SESSION_STORAGE_PREFIX}${type}:${orgScope}:${principalScope()}`;
}

function sessionKeyFor(type: string): string {
  return sessionKeyForOrg(type, activeOrgScope());
}

/**
 * Delete every seed entry belonging to a principal other than the one reading
 * now — the pre-#4486 unscoped entry (`objectui:metadata:<type>`), the
 * pre-#5198 principal-blind one (`objectui:metadata:<type>:<orgId>`), and
 * anything a previous user of this tab left behind.
 *
 * Re-keying alone only fixes tabs going FORWARD: a tab already open across the
 * upgrade — or across a sign-out on a build without the purge — still holds
 * the older blob under its old key. Nothing reads those keys any more, so they
 * are inert; but an inert blob is still another organization's (objectui#4486)
 * or another person's (objectui#5198) app list sitting in storage, and the
 * cheapest correct answer to "does already cached data need invalidating" is to
 * delete it the first time the new code looks.
 *
 * Entries of the CURRENT principal are kept whatever their org: those are this
 * user's own other workspaces, which #4486 already keys correctly and which a
 * switch back is entitled to seed from.
 */
function dropForeignPrincipalEntries(): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    const mine = `:${principalScope()}`;
    // Snapshot the keys first (`Object.keys`) — removing entries during a live
    // index walk shifts the ones behind it, skipping half of them. Same idiom
    // as the `MarketplacePackagePage` purge loop.
    for (const key of Object.keys(sessionStorage)) {
      if (key.startsWith(SESSION_STORAGE_PREFIX) && !key.endsWith(mine)) {
        sessionStorage.removeItem(key);
      }
    }
  } catch {
    /* storage unavailable */
  }
}

function isDev(): boolean {
  try {
    const meta: any = (import.meta as any);
    if (meta && meta.env && typeof meta.env.MODE === 'string') {
      return meta.env.MODE !== 'production';
    }
  } catch {
    /* import.meta unavailable */
  }
  if (typeof process !== 'undefined' && process.env && typeof process.env.NODE_ENV === 'string') {
    return process.env.NODE_ENV !== 'production';
  }
  return false;
}
const DEV = isDev();
function debug(...args: unknown[]) {
  if (DEV) {
    // eslint-disable-next-line no-console
    console.debug('[MetadataProvider]', ...args);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Exported for tests — both metadata sources must normalize identically. */
export function extractItems(res: unknown): any[] {
  // Both source shapes must parse: the adapter SDK returns the wrapped
  // `{ type, items: [...] }` envelope, while the ADR-0037 preview path's
  // MetadataClient.list() returns the already-unwrapped array. Dropping the
  // bare-array shape silently emptied the ENTIRE draft-preview world (every
  // type read 0 items), stranding the Live Canvas on "No Apps Configured".
  if (Array.isArray(res)) return res;
  if (res && typeof res === 'object' && 'items' in res && Array.isArray((res as { items: unknown[] }).items)) {
    return (res as { items: unknown[] }).items;
  }
  return [];
}

function extractItem(res: unknown): any | null {
  if (res == null) return null;
  if (typeof res === 'object' && 'item' in res) {
    return (res as { item: any }).item ?? null;
  }
  return res;
}

function isNamedItem(item: unknown): item is { name: string } {
  return (
    !!item &&
    typeof item === 'object' &&
    'name' in item &&
    typeof (item as { name: unknown }).name === 'string'
  );
}

/**
 * Merge `view` metadata into object definitions so that `objectDef.listViews`
 * is populated for the renderer (`@object-ui/plugin-view`) which expects it.
 *
 * Two view shapes coexist in the `view` metadata type — **both deliberate, and
 * neither one a leftover** (objectstack#4959 settled this end-to-end; see
 * framework `objectql/engine.ts` registration). Each belongs to a different
 * authoring gate, so this merge has to read both:
 *
 *  1. Independent **ViewItem** — the RECORD gate (ADR-0017, "Object has-many
 *     View"): one first-class metadata record per named view, as authored by
 *     `defineViewItem` or written through the runtime `/meta` seam.
 *       { name: '<object>.<key>', object, viewKind: 'list' | 'form',
 *         label, isDefault?, config: { type, data, columns, … } }
 *     `viewKind` is the family discriminant and the view body lives under
 *     `config`. We route `viewKind: 'list'` items into `listViews` and
 *     `viewKind: 'form'` items into `formViews` — so FORM-family views never
 *     surface in the list-view switcher (which only reads `listViews`).
 *
 *  2. Aggregated **container** `{ list?, form?, listViews?, formViews? }` keyed
 *     by the bare object name — the STACK gate's packaging shape: what
 *     `defineView` emits and what a stack carries in
 *     `defineStack({ views: [...] })`. The spec treats it as first class
 *     (`isAggregatedViewContainer` / `expandViewContainer` in
 *     `@objectstack/spec/ui`), so it is NOT legacy and this branch is NOT dead
 *     code — delete it and stack-packaged views stop reaching the renderer.
 *     A container is served UNEXPANDED on purpose (the platform's write
 *     chokepoint states it: "container bodies are left untouched —
 *     `expandViewContainer` derives identity itself"), so this branch asks the
 *     composer for each view's identity rather than deriving one of its own
 *     (objectui#3770). Both gates therefore produce the same canonical
 *     `<object>.<key>` ids — including the default `list`'s implicit
 *     `<object>.default` — and the container inherits the composer's folding and
 *     collision-renaming rules for free.
 *     When an object already has expanded ViewItems the container is skipped for
 *     THAT object: it restates the same identities, and the ViewItem rows are
 *     the authoritative ones (the runtime heals personalization overlays onto
 *     them).
 *
 * Existing `obj.listViews` / `obj.list_views` win to preserve overrides.
 */
interface ViewBucket {
  primary?: any;
  form?: any;
  listViews: Record<string, any>;
  formViews: Record<string, any>;
}

/**
 * Is this row BOUND to an object — either persisted ViewItem spelling?
 *
 * This answers binding only ("does it belong in an object's bucket?"). WHERE
 * its body lives is a separate question with a separate answer, {@link
 * viewItemBody} — and conflating the two is exactly what silently ate a flat
 * overlay's author-written `columns` (objectui#8411).
 *
 * `viewKind && object` is sound for binding, and that is measured against
 * `ViewMetadataSchema` (@objectstack/spec 17.3.0) rather than assumed: both
 * ViewItem-family members carry both keys, so neither can be dropped to widen
 * this. A body with a nested `config` but no `viewKind` is refused by the
 * record member's `viewKind` discriminator ("No matching discriminator"), and a
 * flat overlay without `object` is refused as well. The aggregated container
 * carries neither key and still falls through to the stack gate below.
 */
function isViewItem(view: any): boolean {
  return !!view && typeof view === 'object' && !!view.viewKind && !!view.object;
}

/**
 * WHERE a bound row's body lives — `ViewMetadataSchema`'s OWN discriminant,
 * asked in ONE place (objectui#8411).
 *
 * The spec union spells one view body three ways and tells them apart by shape.
 * Two of those three reach this merge as bound rows:
 *
 *  - **standalone ViewItem record** — recognised by a nested `config`, which
 *    holds the body (`type`/`data`/`columns`/`sections`);
 *  - **flattened runtime overlay** — spec's own table recognises it as "an
 *    inline view config; no `config`, no container slot". There is nothing to
 *    unwrap: the row IS the body, and its `object` / `viewKind` / `name` /
 *    `label` ride along on it.
 *
 * (The third, the aggregated container, is not bound and never reaches here.)
 *
 * This used to be a `{}` fallback, so the overlay's branch read a `config` it
 * does not have and the entry collapsed to `{ name, label, isDefault }` — every
 * top-level `columns` / `type` / `data` the author wrote was dropped, with no
 * diagnostic, while the tab still rendered (binding is by `object` +
 * `viewKind`, which is why nothing looked broken from the outside).
 *
 * Reading the `config` discriminant here closes a drift rather than opening a
 * new dialect: the sibling read paths already ask it this way — `listViews` in
 * `@object-ui/data-objectstack` unwraps a nested `config` and returns a flat
 * row verbatim, and `viewDisplayType` (metadata-admin) reads `config.type`
 * first and top-level `type` second.
 */
function viewItemBody(view: any): Record<string, any> {
  return view.config && typeof view.config === 'object' ? view.config : view;
}

/**
 * Route ONE view identity into its object's bucket — shared by both gates: the
 * record gate's stored ViewItems and the views `expandViewContainer` materialises
 * out of a stack-packaged container. Both shapes are
 * `{ name, object, viewKind, label?, isDefault?, config }`, so both are keyed by
 * the canonical `<object>.<key>` name the composer owns.
 *
 * The body is resolved by {@link viewItemBody} — a record's nested `config` is
 * flattened to the legacy NamedListView/FormView shape the renderer consumes
 * (type/data/columns/sections at top level), and a flat overlay is already in
 * that shape — the item-level label/isDefault ride along and `name` is stamped
 * with the id so primary-view promotion (which matches on `list.name`) finds
 * this entry by its listViews key.
 * FORM-family views land in `formViews` only, never in the list-view switcher.
 *
 * `bucket.form` — what create and edit render — is set ONLY from a form item
 * that carries `isDefault` (objectui#11539). `@objectstack/spec` `ViewSchema`
 * calls a container's `form` its "Default form view" and `formViews`
 * "Additional named form views", and the served rows say which one is default:
 * `OBJECT.form` alone carries `isDefault`. There is no "first form wins"
 * fallback, so arrival order decides nothing: a default arriving after a named
 * form still takes `.form`, and a named form arriving after the default does
 * not displace it. A container with no `form` serves its named forms with no
 * `isDefault`, and `.form` stays unset. Create and edit then take the path an
 * object with no default form view takes: `resolveFormViewLayout` returns no
 * sections, and the dialog lays out the object's own fields. A named form —
 * which can be a public anonymous intake form or a wizard — is reached only by
 * its name, through `formViews`.
 */
function applyViewItem(bucket: ViewBucket, view: any): void {
  const key = view.name || `${view.object}.${view.viewKind}`;
  const body = viewItemBody(view);
  const entry = {
    ...body,
    name: key,
    label: view.label ?? (body as any).label,
    isDefault: !!view.isDefault,
  };
  if (view.viewKind === 'form') {
    bucket.formViews[key] = entry;
    if (view.isDefault) bucket.form = entry;
  } else {
    bucket.listViews[key] = entry;
    if (view.isDefault) bucket.primary = entry;
  }
}

export function mergeViewsIntoObjects(objects: any[], views: any[]): any[] {
  if (!objects.length || !views.length) return objects;
  const byObject: Record<string, ViewBucket> = {};
  // Objects that received expanded ViewItems — the aggregated container for
  // those objects (also present in the `view` list) restates the same views, so
  // it is skipped per-object. Other objects still depend on it.
  const hasViewItems = new Set<string>();
  for (const view of views) {
    if (isViewItem(view)) hasViewItems.add(view.object);
  }
  for (const view of views) {
    // ── Record gate: independent ViewItem ({ name, object, viewKind, config }) ──
    if (isViewItem(view)) {
      // The canonical `<object>.<key>` name doubles as the view id, so
      // `/view/<name>` URLs resolve directly against the switcher tab ids.
      applyViewItem((byObject[view.object] ||= { listViews: {}, formViews: {} }), view);
      continue;
    }
    // ── Stack gate: aggregated container ({ list, form, listViews, formViews }) ──
    const objName = view?.name || view?.list?.data?.object || view?.form?.data?.object;
    if (!objName) continue;
    // Expanded ViewItems supersede the bare container for this object.
    if (hasViewItems.has(objName)) continue;
    const bucket = (byObject[objName] ||= { listViews: {}, formViews: {} });
    // Ask the composer which views this container declares and what each one's
    // runtime identity is (objectui#3770) — the default `list` implicitly claims
    // `<object>.default`, and a `listViews` entry that merely restates it folds
    // into that entry's own name. The primary list keeps arriving on `obj.list`
    // per @objectstack/spec ViewSchema (below) AND is mirrored into `listViews`
    // under that identity, so consumers that only iterate `listViews` still see
    // it and consumers honoring `obj.list` dedup by the same id.
    for (const item of expandViewContainer(objName, view)) {
      applyViewItem(bucket, item);
    }
  }
  return objects.map(obj => {
    const extra = byObject[obj.name];
    if (!extra) return obj;
    // `listViews` is canonical (#5362; @objectstack/spec declares only camelCase). The
    // `list_views` / `form_views` legs are compatibility READS for stored pre-settlement
    // documents (that stock has never been censused: objectstack#7917). Never WRITE snake keys
    // — the merge below emits camelCase only.
    const existingListViews = obj.listViews || obj.list_views || {};
    const existingFormViews = obj.formViews || obj.form_views || {};
    const merged: any = {
      ...obj,
      listViews: { ...extra.listViews, ...existingListViews },
    };
    if (Object.keys(extra.formViews).length || Object.keys(existingFormViews).length) {
      merged.formViews = { ...extra.formViews, ...existingFormViews };
    }
    if (extra.primary && !obj.list) {
      merged.list = extra.primary;
    }
    if (extra.form && !obj.form) {
      merged.form = extra.form;
    }
    return merged;
  });
}

/**
 * Relationship-driven master-detail: a child object's `master_detail`/`lookup`
 * field can carry `inlineEdit: true` to declare "edit me inline within my
 * parent's form". This pass scans every object for such fields and merges the
 * resulting child collections into each parent object's form view as
 * `subforms` — so the parent's standard create/edit form renders an atomic
 * master-detail form with NO view config and NO bespoke page. The intent lives
 * in the data model (where it's defined once, e.g. by an AI modelling the
 * schema); forms just follow. An explicit `form.subforms` entry for the same
 * child overrides the model-derived one.
 */
export function attachInlineSubforms(objects: any[]): any[] {
  if (!objects?.length) return objects;
  const inlineByParent: Record<string, any[]> = {};
  for (const child of objects) {
    const fields = child?.fields;
    if (!fields) continue;
    const entries: Array<[string, any]> = Array.isArray(fields)
      ? fields.map((f: any) => [f?.name, f])
      : Object.entries(fields);
    for (const [fname, fdef] of entries) {
      const d: any = fdef;
      if (!fname || !d?.inlineEdit) continue;
      if (d.type !== 'master_detail' && d.type !== 'lookup') continue;
      // `reference` is the only target spelling read (objectui#11070 round 4);
      // a legacy def was folded onto it at ingestion (`ensureType` runs
      // `normalizeSchemaReferenceKeys` over every `object` item it stores).
      const parent = d.reference;
      if (!parent) continue;
      (inlineByParent[parent] ||= []).push({
        childObject: child.name,
        relationshipField: fname,
        // Resolve the inline-edit form factor (grid vs per-row form) from the
        // declared value, falling back to the smart default by child shape.
        inlineMode: resolveInlineMode(child, d.inlineEdit, { relationshipField: fname }),
        ...(d.inlineTitle ? { title: d.inlineTitle } : {}),
        ...(Array.isArray(d.inlineColumns) ? { columns: d.inlineColumns } : {}),
        ...(typeof d.inlineAmountField === 'string' ? { amountField: d.inlineAmountField } : {}),
      });
    }
  }
  if (!Object.keys(inlineByParent).length) return objects;
  return objects.map((obj) => {
    const derived = inlineByParent[obj.name];
    if (!derived?.length) return obj;
    const form: any = { ...(obj.form || { type: 'simple' }) };
    const explicit: any[] = Array.isArray(form.subforms) ? form.subforms : [];
    const explicitChildren = new Set(explicit.map((s: any) => s.childObject));
    // Model-derived first; an explicit view subform for the same child wins.
    form.subforms = [...derived.filter((d) => !explicitChildren.has(d.childObject)), ...explicit];
    const next: any = { ...obj, form };
    if (obj.formViews?.default) {
      next.formViews = { ...obj.formViews, default: { ...obj.formViews.default, subforms: form.subforms } };
    }
    return next;
  });
}

/**
 * The composed object list, keyed on the two STORED arrays it is built from
 * (objectui#11699).
 *
 * The context value's `objects` getter used to run `mergeViewsIntoObjects` +
 * `attachInlineSubforms` on every READ, and both hand back a new wrapper for
 * every object they touch. So each re-render of a host that reads `objects`
 * handed its children a new object for an unchanged definition — measured on a
 * showcase record page, where the record-load effect read the record a second
 * time for a definition that was JSON-equal, from the same context version.
 * AGENTS.md #10: a provider may not republish an equal payload as a new
 * object.
 *
 * The key is the payload, not a React memo: `entry.items` for `object` and for
 * `view`. Every write to a cache entry REPLACES that array (a landed fetch, a
 * by-name or whole-type invalidation, an org or preview-mode clear), and none
 * mutates it in place, so a new array is exactly "this input changed" and the
 * same array is exactly "it did not". ⚠️ Nothing re-checks that (AGENTS.md
 * #9): it was read off this file and the list's readers once, when this cache
 * was written. A write that pushes, splices, sorts or index-assigns into a
 * stored `object` / `view` array would make this hand out the list as it was
 * — replace the array instead. A discarded `useMemo` around the context
 * value cannot move either array, so it cannot move the composed list.
 * Module-level and weak, so an entry lives only as long as the stored list it
 * was built from.
 */
const COMPOSED_OBJECTS = new WeakMap<unknown[], { views: unknown[]; composed: unknown[] }>();

function composeObjects(objs: unknown[], views: unknown[]): unknown[] {
  const cached = COMPOSED_OBJECTS.get(objs);
  if (cached && cached.views === views) return cached.composed;
  const merged = views.length ? mergeViewsIntoObjects(objs, views) : objs;
  const composed = attachInlineSubforms(merged);
  COMPOSED_OBJECTS.set(objs, { views, composed });
  return composed;
}

function emptyEntry(): TypeCacheEntry {
  return {
    status: 'idle',
    items: [],
    byName: new Map(),
    error: null,
    fetchedAt: 0,
    promise: null,
  };
}

function loadFromSession(type: string): any[] | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(sessionKeyFor(type));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function saveToSession(type: string, items: any[], orgScope: string = activeOrgScope()): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(sessionKeyForOrg(type, orgScope), JSON.stringify(items));
  } catch {
    /* quota or serialization failure */
  }
}

/**
 * Delete the entry a type wrote while the active organization was still
 * unknown — see {@link NO_ORG_SCOPE} and objectui#5243.
 */
function removeNoOrgSeedEntry(type: string): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.removeItem(sessionKeyForOrg(type, NO_ORG_SCOPE));
  } catch {
    /* storage unavailable */
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function MetadataProvider({ children, adapter, ttlMs = DEFAULT_TTL_MS }: MetadataProviderProps) {
  const cacheRef = useRef<Map<string, TypeCacheEntry>>(new Map());
  const itemPromisesRef = useRef<Map<string, ItemPromiseMap>>(new Map());
  // objectui#12811 — the package-scoped object reads, keyed by package id,
  // and the names-only scope under NAMES_ONLY_SCOPE (objectui#12980).
  const scopesRef = useRef<Map<string, ObjectScopeEntry>>(new Map());
  // Types whose session entry this boot wrote under NO_ORG_SCOPE because the
  // active organization had not resolved yet (objectui#5243).
  const unscopedSeedTypesRef = useRef<Set<string>>(new Set<string>());
  const adapterRef = useRef(adapter);
  adapterRef.current = adapter;

  // ADR-0037 Live Canvas: when the tree is in draft-preview mode, metadata
  // reads come from the REST `?preview=draft` overlay (pending ADR-0033
  // drafts win over active) instead of the adapter SDK. The MetadataClient
  // is used because the SDK's meta API doesn't carry the preview flag; same
  // endpoints, same authenticated fetch (Bearer token) as every other console
  // client — see `createConsoleMetadataClient`. Reads only — every write path
  // is unchanged.
  const previewDrafts = usePreviewDrafts();
  const previewClient = useMemo(() => {
    if (!previewDrafts) return null;
    return createConsoleMetadataClient({ previewDrafts: true });
  }, [previewDrafts]);
  const previewClientRef = useRef(previewClient);
  previewClientRef.current = previewClient;

  // ── objectui#13044 — one request per object document ─────────────────────
  //
  // `GET /meta/object/NAME` is also what the adapter's `getObjectSchema` reads,
  // and the record form, `useSettledSchema` and the field widgets read it
  // there, so one page open asked the server for the same document twice: once
  // here for the page's object scope, once there. The published by-name object
  // read therefore goes through `getObjectSchema`, and the two share its cache
  // entry, its in-flight request and its revalidating fetch (`cache:
  // 'no-cache'`), whichever asks first.
  //
  // What a reader of THIS context sees is unchanged. The answer is copied, so
  // it does not carry the adapter's per-column sortability projection (a
  // non-enumerable symbol on the adapter's copy) and nothing done to one copy
  // reaches the other; it is handed back in the `{ item }` envelope the
  // client's `getItem` answered, so `extractItem` below unwraps it exactly as
  // before. A 404 reaches the catch below as the transport's own error, which
  // `getObjectSchema` keeps as the cause of its `MetadataNotFoundError`, so an
  // absence is still told apart from a failure by the declared code.
  //
  // Every name read through the adapter is remembered, so a path below that
  // asks this context to read objects again also drops the adapter's entry for
  // each: otherwise the next read would be answered from that entry instead of
  // the server. The preview client's reads never touch the adapter.
  const adapterObjectNamesRef = useRef<Set<string>>(new Set());
  const readObjectThroughAdapter = useCallback((name: string): Promise<unknown> => {
    adapterObjectNamesRef.current.add(name);
    return adapterRef.current.getObjectSchema(name).then(
      (schema: unknown) => ({ item: schema == null ? schema : structuredClone(schema) }),
      (err: unknown) => {
        throw err instanceof MetadataNotFoundError ? (err.details?.originalError ?? err) : err;
      },
    );
  }, []);
  /** Drop the adapter's entry for `name`, or for every name read through it. */
  const dropAdapterObjectReads = useCallback((name?: string): void => {
    const names = name ? [name] : Array.from(adapterObjectNamesRef.current);
    for (const n of names) {
      adapterObjectNamesRef.current.delete(n);
      try { adapterRef.current?.invalidateCache?.(n); } catch { /* adapter mid-swap */ }
    }
  }, []);
  /**
   * An organization or session switch swaps the world every `/meta/*` request
   * resolves in. The adapter's own metadata cache is the one the provider now
   * reads objects through, so it is dropped whole (objectui#13044, ruling
   * 6268839381): one organization's documents, or a request in flight for one,
   * must not answer a read made in another.
   */
  const dropAdapterWorld = useCallback((): void => {
    adapterObjectNamesRef.current.clear();
    try { adapterRef.current?.clearCache?.(); } catch { /* adapter mid-swap */ }
  }, []);

  const [version, setVersion] = useState(0);
  // Defer state bumps so they never occur synchronously during a consumer's
  // render phase. `ensureType` may be invoked from inside `useMemo` getters
  // (e.g. when a list-page renders and triggers a lazy fetch), and React
  // forbids cross-component setState during render. queueMicrotask schedules
  // the update after the current render has committed.
  const bump = useCallback(() => {
    if (typeof queueMicrotask === 'function') {
      queueMicrotask(() => setVersion(v => v + 1));
    } else {
      Promise.resolve().then(() => setVersion(v => v + 1));
    }
  }, []);

  // Entering/leaving preview swaps the entire metadata source — the published
  // and draft-overlaid worlds must never mix in one cache. Drop everything and
  // let consumers refetch through the new source.
  //
  // ⚠️ Deliberately skipped on MOUNT (objectui#4042). Consumers read metadata
  // during the FIRST render — a reader of `objects` (as `useActionModal` was
  // until objectui#12811) kicks
  // `ensureType('object')` and `ensureType('view')` from a render-phase getter,
  // before any effect has run. Clearing unconditionally in this mount effect
  // threw those two entries away while their requests were still in flight, so
  // the very next render found them `idle` again and refetched BOTH. That is
  // the "same round, `meta/object` / `meta/view` each fired twice" the card
  // reported — and it is not an unauthenticated-only artefact: it doubled the
  // two requests on every mount, signed in as well. There is nothing to drop on
  // mount anyway (the cache is per-provider-instance and starts empty), so the
  // clear only ever had meaning on a LATER `previewDrafts` change.
  const previewModeMounted = useRef(false);
  useEffect(() => {
    if (!previewModeMounted.current) {
      previewModeMounted.current = true;
      return;
    }
    cacheRef.current.clear();
    itemPromisesRef.current.clear();
    scopesRef.current.clear();
    dropAdapterObjectReads();
    bump();
  }, [previewDrafts, bump, dropAdapterObjectReads]);

  const getEntry = useCallback((type: string): TypeCacheEntry => {
    let entry = cacheRef.current.get(type);
    if (!entry) {
      entry = emptyEntry();
      cacheRef.current.set(type, entry);
    }
    return entry;
  }, []);

  const ensureType = useCallback(
    (type: string): Promise<any[]> => {
      const entry = getEntry(type);

      if (entry.promise) return entry.promise;

      if (entry.status === 'ready' && Date.now() - entry.fetchedAt < ttlMs) {
        debug(`cache hit (fresh) type=${type} items=${entry.items.length}`);
        return Promise.resolve(entry.items);
      }

      // Just failed — see ERROR_RETRY_COOLDOWN_MS. `refresh()`/`invalidate()`
      // zero `fetchedAt` / reset the status, so explicit retries fall straight
      // through this.
      if (entry.status === 'error' && Date.now() - entry.fetchedAt < ERROR_RETRY_COOLDOWN_MS) {
        debug(`cache hit (recent failure) type=${type}`);
        return Promise.resolve(entry.items);
      }

      const started = Date.now();
      entry.status = 'loading';
      entry.error = null;
      // Preview mode reads the draft-overlaid world (`?preview=draft`);
      // normal mode reads the adapter SDK as before.
      const preview = previewClientRef.current;
      const fetchItems: Promise<unknown> = preview
        ? preview.list(type)
        : adapterRef.current.getClient().meta.getItems(type);
      const promise = fetchItems
        .then((res: unknown) => {
          const items = extractItems(res);
          // Fold a legacy `reference_to` / `referenceTo` onto `reference` on
          // object field defs at ingestion (the store-side choke point,
          // mirroring the adapter's getObjectSchema pass), so
          // `useMetadata().objects` consumers read `reference` alone
          // (objectui#11070 round 4). Idempotent, in place.
          if (type === 'object') {
            for (const it of items) normalizeSchemaReferenceKeys(it);
          }
          entry.items = items;
          entry.status = 'ready';
          entry.error = null;
          entry.fetchedAt = Date.now();
          entry.promise = null;
          entry.byName.clear();
          for (const it of items) {
            if (isNamedItem(it)) {
              entry.byName.set(it.name, it);
            }
          }
          // Never let the draft-overlaid world poison the published session
          // cache — preview is ephemeral by design.
          if (type === 'app' && !preview) {
            const orgScope = activeOrgScope();
            saveToSession(type, items, orgScope);
            // objectui#5243 — remember that THIS boot wrote the entry before
            // the active organization was known, so the org-resolution effect
            // below can move it onto the key the next boot will look under.
            // Recorded per write (not per mount) because it is the write that
            // either did or did not know its scope; a later write that DOES
            // know it retires the note.
            if (orgScope === NO_ORG_SCOPE) {
              unscopedSeedTypesRef.current.add(type);
            } else {
              unscopedSeedTypesRef.current.delete(type);
            }
          }
          debug(`fetched type=${type} items=${items.length} in ${Date.now() - started}ms`);
          bump();
          return items;
        })
        .catch((err: unknown) => {
          const error = err instanceof Error ? err : new Error(String(err));
          entry.status = 'error';
          entry.error = error;
          entry.promise = null;
          // Stamped on failure too, so ERROR_RETRY_COOLDOWN_MS has a clock to
          // measure from. `refresh()` zeroes it, which is what makes an
          // explicit retry immediate.
          entry.fetchedAt = Date.now();
          debug(`fetch failed type=${type}`, error);
          bump();
          return [] as any[];
        });

      entry.promise = promise;
      // No synchronous bump here: the only externally-visible state change at
      // this point is `status: 'loading'`, which no consumer reads. Bumping
      // from inside a render-phase getter (see useMemo below) would trigger
      // React's "Cannot update a component while rendering" warning.
      return promise;
    },
    [bump, getEntry, ttlMs],
  );

  const readItem = useCallback(
    (type: string, name: string): Promise<ItemRead> => {
      const entry = getEntry(type);

      if (entry.byName.has(name)) {
        debug(`item cache hit type=${type} name=${name}`);
        return Promise.resolve({ item: entry.byName.get(name) ?? null, failed: false });
      }

      let pending = itemPromisesRef.current.get(type);
      if (!pending) {
        pending = new Map();
        itemPromisesRef.current.set(type, pending);
      }
      const existing = pending.get(name);
      if (existing) return existing;

      const started = Date.now();
      const preview = previewClientRef.current;
      const fetchItem: Promise<unknown> = preview
        ? preview.get(type, name)
        : type === 'object'
          ? readObjectThroughAdapter(name)
          : adapterRef.current.getClient().meta.getItem(type, name);
      const promise = fetchItem
        .then((res: unknown) => {
          const item = extractItem(res);
          // objectui#7650 — the BY-NAME serve path needs the same
          // canonicalization the LIST path applies in `ensureType` above.
          //
          // `extractItem` only unwraps the `{ item }` envelope; it normalizes
          // nothing. So an object def fetched by name reached readers carrying
          // whichever single spelling its producer stored, while the very same
          // def arriving through `ensureType` carried both. Which one a reader
          // got depended on cache order, not on the document — a cold
          // `useMetadataItem('object', name)` took this path, a warm one hit
          // the list-populated `byName` entry above and saw the stamped def.
          //
          // This is a serve path, not an ingestion path in miniature: the
          // published `useMetadataItem` hook is exported from
          // `@object-ui/app-shell`, so the raw def reaches out-of-repo
          // consumers too. Idempotent and in place, so a def the list pass
          // already stamped is untouched.
          if (type === 'object' && item) normalizeSchemaReferenceKeys(item);
          if (item) entry.byName.set(name, item);
          debug(`fetched item type=${type} name=${name} in ${Date.now() - started}ms`);
          pending!.delete(name);
          return { item, failed: false };
        })
        .catch((err: unknown) => {
          pending!.delete(name);
          debug(`fetch item failed type=${type} name=${name}`, err);
          // A thrown absence is an answer; anything else is not (objectui#13009).
          if (isMetaItemAbsentError(err)) return { item: null, failed: false };
          // objectui#13052 — and so is a definite refusal, named.
          const refusal = ANSWERED_REFUSAL_CODES.find((code) => errorCodeIs(err, code));
          if (refusal) return { item: null, failed: false, refusal };
          return { item: null, failed: true };
        });

      pending.set(name, promise);
      return promise;
    },
    [getEntry, readObjectThroughAdapter],
  );

  // The published read: `null` for "none came back", whichever way.
  const getItem = useCallback(
    (type: string, name: string): Promise<any | null> => readItem(type, name).then((read) => read.item),
    [readItem],
  );

  // ── objectui#12811 — package-scoped object reads ─────────────────────────
  //
  // The list goes through the same ingestion as the whole list
  // (`normalizeSchemaReferenceKeys` here, `composeObjects` on read), and a
  // by-name extra through `getItem`, which applies the same normalization. So
  // a scoped definition is shaped exactly like the same object in `objects`.
  // A landing for an entry that was dropped meanwhile (an invalidation, an
  // organization switch) is discarded: the entry it would write to is gone.
  const fetchScopeList = useCallback(
    (packageId: string, entry: ObjectScopeEntry): Promise<void> => {
      entry.status = 'loading';
      const preview = previewClientRef.current;
      const fetchItems: Promise<unknown> = preview
        ? preview.list('object', { packageId })
        : adapterRef.current.getClient().meta.getItems('object', { packageId });
      return fetchItems
        .then((res: unknown) => {
          if (scopesRef.current.get(packageId) !== entry) return;
          const items = extractItems(res);
          for (const it of items) normalizeSchemaReferenceKeys(it);
          const listed = new Set(items.map((it: any) => it?.name));
          // The by-name extras stay until their own answer replaces them.
          const extras = entry.items.filter((it: any) => !listed.has(it?.name) && entry.names.has(it?.name));
          entry.items = [...items, ...extras];
          entry.status = 'ready';
          entry.answered = true;
          debug(`fetched object scope package=${packageId} items=${items.length}`);
          bump();
        })
        .catch((err: unknown) => {
          if (scopesRef.current.get(packageId) !== entry) return;
          entry.status = 'error';
          entry.answered = true;
          debug(`fetch failed object scope package=${packageId}`, err);
          bump();
        });
    },
    [bump],
  );

  const fetchScopeName = useCallback(
    (packageId: string, entry: ObjectScopeEntry, name: string): Promise<void> => {
      entry.names.set(name, 'pending');
      return readItem('object', name).then(({ item, failed, refusal }) => {
        if (scopesRef.current.get(packageId) !== entry) return;
        // objectui#13009 — a read that obtained no answer records no answer:
        // the name is not missing (so the scope stays unsettled and
        // `useObjectPresence` reads `unknown`, never `absent`).
        //
        // objectui#13052 — it records the failure instead, once, so a route
        // waiting on the name can stop waiting and say so. A failed name is
        // not asked again by the re-render this bump causes (`readObjectScope`
        // skips it), so there is no retry loop paced by the failures
        // themselves; `invalidate`, `refresh` and a scope refetch ask it again.
        if (failed) {
          entry.names.set(name, 'failed');
          bump();
          return;
        }
        entry.names.set(name, 'answered');
        const rest = entry.items.filter((it: any) => it?.name !== name);
        if (item) {
          entry.items = [...rest, item];
          if (entry.missing.includes(name)) entry.missing = entry.missing.filter(n => n !== name);
        } else {
          if (rest.length !== entry.items.length) entry.items = rest;
          if (!entry.missing.includes(name)) entry.missing = [...entry.missing, name];
        }
        if (refusal ? entry.refused[name] !== refusal : name in entry.refused) {
          entry.refused = refusal ? { ...entry.refused, [name]: refusal } : withoutRefusal(entry.refused, name);
        }
        bump();
      });
    },
    [bump, readItem],
  );

  /** Refetch every scope in place: the items stay until the answers replace them. */
  const refreshScopes = useCallback((): Promise<void>[] => {
    // `getItem` answers from the `object` entry's by-name cache; a refresh
    // must ask the server again.
    getEntry('object').byName.clear();
    itemPromisesRef.current.get('object')?.clear();
    dropAdapterObjectReads();
    const pending: Promise<void>[] = [];
    for (const [packageId, entry] of scopesRef.current) {
      if (entry.status === 'idle') continue;
      if (packageId !== NAMES_ONLY_SCOPE) pending.push(fetchScopeList(packageId, entry));
      for (const name of Array.from(entry.names.keys())) pending.push(fetchScopeName(packageId, entry, name));
    }
    return pending;
  }, [dropAdapterObjectReads, fetchScopeList, fetchScopeName, getEntry]);

  const refresh = useCallback(
    async (type?: string): Promise<void> => {
      if (type) {
        const entry = getEntry(type);
        entry.fetchedAt = 0;
        entry.byName.clear();
        const scoped = type === 'object' ? refreshScopes() : [];
        await Promise.all([ensureType(type), ...scoped]);
        return;
      }
      const types = Array.from(cacheRef.current.keys()).filter(
        t => cacheRef.current.get(t)!.status !== 'idle',
      );
      const scoped = refreshScopes();
      await Promise.all([
        ...types.map(t => {
          const entry = cacheRef.current.get(t)!;
          entry.fetchedAt = 0;
          entry.byName.clear();
          return ensureType(t);
        }),
        ...scoped,
      ]);
    },
    [ensureType, getEntry, refreshScopes],
  );

  const invalidate = useCallback(
    (type: string, name?: string): void => {
      const entry = type === 'object' ? getEntry(type) : cacheRef.current.get(type);
      if (!entry) return;
      if (name) {
        entry.byName.delete(name);
        entry.items = entry.items.filter((it: any) => it?.name !== name);
        if (type === 'object') {
          dropAdapterObjectReads(name);
          for (const scope of scopesRef.current.values()) {
            if (scope.items.some((it: any) => it?.name === name)) {
              scope.items = scope.items.filter((it: any) => it?.name !== name);
            }
            scope.names.delete(name);
            if (scope.missing.includes(name)) scope.missing = scope.missing.filter(n => n !== name);
            if (name in scope.refused) scope.refused = withoutRefusal(scope.refused, name);
          }
        }
        debug(`invalidated type=${type} name=${name}`);
      } else {
        if (type === 'object') {
          scopesRef.current.clear();
          dropAdapterObjectReads();
        }
        entry.status = 'idle';
        entry.items = [];
        entry.byName.clear();
        entry.error = null;
        entry.fetchedAt = 0;
        debug(`invalidated type=${type}`);
      }
      bump();
    },
    [bump, dropAdapterObjectReads, getEntry],
  );

  // ADR-0037 P2.5 — same-document live refresh: while this tree renders the
  // draft overlay, chat hosts announce each drafted artifact on the assistant
  // bus; drop that type's cache entry so the next read refetches the updated
  // draft world. Published-mode trees ignore the events entirely.
  useEffect(() => {
    if (!previewDrafts) return;
    return subscribeCanvasInvalidate(({ type }) => {
      invalidate(type);
    });
  }, [previewDrafts, invalidate]);

  // Live-metadata-changed refresh: a publish (drafts → live) or a marketplace
  // install changed the registry out-of-band, so the schema this tree cached
  // is stale. Refetch every loaded type — open forms/views/nav then reflect
  // the new live world without a manual page reload (the chat-card "Publish"
  // and Browse-page install paths do not reload, unlike the DraftPreviewBar).
  // NOT gated to preview-drafts mode: the live world every tree reads changed.
  useEffect(() => {
    return subscribeMetadataRefresh(() => {
      // The adapter keeps its OWN object-schema cache (getObjectSchema) that the
      // context refresh below does not touch. A publish/install just changed the
      // live schema, so drop it too — otherwise create/edit forms (which read
      // the adapter's getObjectSchema, NOT this context) keep showing the
      // pre-publish field set until the adapter cache's 5-minute TTL lapses.
      try { adapterRef.current?.clearCache?.(); } catch { /* adapter mid-swap */ }
      void refresh();
    });
  }, [refresh]);

  const [initialLoading, setInitialLoading] = useState(true);
  const [initialError, setInitialError] = useState<Error | null>(null);

  // ── An org change drops the whole cache (objectui#4486) ───────────────────
  //
  // Scoping the sessionStorage seed by org covers the RELOADING switch paths
  // (`WorkspaceSwitcher` and `OrganizationsPage` both full-page-navigate to the
  // console root after `switchOrganization` resolves). It does NOT cover the
  // switch path that stays inside the SPA:
  // `console/organizations/manage/OrganizationLayout` calls `switchOrganization`
  // from an effect whenever the `/organizations/:slug` segment names a
  // different org, with no reload at all. On that path the IN-MEMORY cache
  // below is what answers `useMetadata().apps`, and it would keep serving the
  // previous org's items until the 5-minute TTL lapsed.
  //
  // The card's invariant is about the data, not the storage key, so it is
  // enforced where the data actually lives: one organization's metadata never
  // survives into another organization's reads. Same shape as the preview-mode
  // clear above — swapping the active org swaps the world every `/meta/*`
  // request resolves in.
  const { activeOrganization, user } = useAuth();
  const activeOrgId = activeOrganization?.id ?? null;
  const lastOrgId = useRef<string | null>(null);
  useEffect(() => {
    const previous = lastOrgId.current;
    lastOrgId.current = activeOrgId;
    // The FIRST resolution (unknown → known) is NOT a switch. AuthProvider
    // resolves the active organization asynchronously after mount, so this
    // effect sees `null → <id>` on every normal boot; clearing there would
    // throw away the eager `app`/`object`/`view` fetches while they are still
    // in flight and make the next render refetch all three — precisely the
    // doubled-request regression objectui#4042 pinned.
    if (previous === null || previous === activeOrgId) {
      // ── The seed written before the org was known (objectui#5243) ────────
      //
      // Not a switch, but it IS the moment the scope of this boot's own seed
      // entry becomes known. On a browser that has never signed in,
      // `ActiveOrganizationStorage` is empty at mount and the eager `app`
      // fetch — one round trip — lands long before AuthProvider's
      // `getSession` → `listOrganizations` → `getActiveOrganization` chain
      // stamps it. So the entry goes to `…:@none:…`, every later boot computes
      // the real org id, and the seed misses the boot right after a first
      // login while the `@none` entry is orphaned until the tab closes.
      //
      // Moving the label is sound because the entry is correctly SCOPED and
      // merely mislabelled: that first request carried no `X-Tenant-ID` (same
      // empty storage), and the server does not read that header for tenant
      // scoping — `resolveAuthzContext` takes `tenantId` from
      // `session.activeOrganizationId` and nothing else, and the environment
      // chain reads only the hostname and `X-Environment-Id`. The response was
      // therefore computed for exactly the organization being stamped here.
      //
      // Deliberately NOT "wait for the org before seeding": the docblock on
      // `activeOrgScope` already records why the async context value cannot
      // gate the seed — it resolves after mount, so gating on it makes EVERY
      // boot miss its own entry, which is the optimization's whole point.
      // And deliberately not a refetch: that would trade this card's miss for
      // the objectui#4042 request-budget regression.
      if (previous === null && activeOrgId && unscopedSeedTypesRef.current.size > 0) {
        for (const type of unscopedSeedTypesRef.current) {
          const entry = cacheRef.current.get(type);
          if (entry && entry.status === 'ready' && entry.items.length > 0) {
            // Written from the LIVE entry rather than copied through storage:
            // the items are already in hand, so no parse, and a cached EMPTY
            // list stays a miss exactly as objectui#4486 requires.
            saveToSession(type, entry.items, activeOrgId);
          }
          removeNoOrgSeedEntry(type);
        }
        unscopedSeedTypesRef.current.clear();
      }
      return;
    }

    let cancelled = false;
    cacheRef.current.clear();
    itemPromisesRef.current.clear();
    scopesRef.current.clear();
    dropAdapterWorld();
    // `apps` is the one collection read straight off the entry
    // (`getEntry('app').items`) instead of through `readType`, so unlike every
    // lazy type it is NOT re-armed by a consumer reading it. Without this kick
    // the clear above would leave the nav permanently empty on the no-reload
    // path. And `initialLoading` goes back up for the same reason the cached-
    // empty case is a miss: while the new org's list is in flight, "no apps" is
    // not yet an answer.
    setInitialLoading(true);
    void ensureType('app').finally(() => {
      if (!cancelled) setInitialLoading(false);
    });
    bump();
    return () => {
      cancelled = true;
    };
  }, [activeOrgId, bump, dropAdapterWorld, ensureType]);

  // ── A session switch drops the adapter's metadata too (objectui#13044) ────
  //
  // Same reasoning as the organization switch above, for the principal: the
  // first resolution (unknown → known) is not a switch, any later change of
  // the signed-in user (another user, or none) is. Only the adapter's cache is
  // dropped here — the provider's own cache keeps the behaviour it had.
  const sessionUserId = user?.id ?? null;
  const lastSessionUserId = useRef<string | null>(null);
  useEffect(() => {
    const previous = lastSessionUserId.current;
    lastSessionUserId.current = sessionUserId;
    if (previous === null || previous === sessionUserId) return;
    dropAdapterWorld();
  }, [sessionUserId, dropAdapterWorld]);

  useEffect(() => {
    let cancelled = false;

    // Session-cached apps are PUBLISHED-world data — seeding them while in
    // draft preview would flash the wrong universe before the fetch lands.
    const cached = previewDrafts ? null : loadFromSession('app');
    dropForeignPrincipalEntries();
    // A cached EMPTY list is a MISS, not a hit (objectui#4486).
    //
    // `[]` is truthy, so an empty cached list used to take this branch and
    // clear `initialLoading` — which made "no apps (cached, possibly stale)"
    // indistinguishable from "no apps (fresh)" for every consumer that gates on
    // `loading`. There is also nothing to gain: seeding zero items saves no
    // render, while the `status: 'ready'` it stamped made `getTypeStatus('app')`
    // claim a settled answer the provider did not have. Falling through leaves
    // the entry `idle` and `initialLoading` true until the fetch below lands.
    if (cached && cached.length > 0) {
      const entry = getEntry('app');
      entry.items = cached;
      entry.status = 'ready';
      entry.fetchedAt = 0;
      for (const it of cached) {
        if (isNamedItem(it)) {
          entry.byName.set(it.name, it);
        }
      }
      bump();
      setInitialLoading(false);
    }

    (async () => {
      for (const type of EAGER_TYPES) {
        try {
          await ensureType(type);
          if (!cancelled) setInitialError(null);
        } catch (err) {
          if (!cancelled) {
            setInitialError(err instanceof Error ? err : new Error(String(err)));
          }
        }
      }
      if (!cancelled) setInitialLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [adapter, ensureType, getEntry, bump, previewDrafts]);

  const readType = useCallback(
    (type: string): any[] => {
      const entry = getEntry(type);
      if (entry.status === 'idle') {
        void ensureType(type);
      }
      return entry.items;
    },
    [ensureType, getEntry],
  );

  // objectui#12811 — see `MetadataContextValue.readObjectScope`. Reading it
  // starts what it needs and nothing more: the package list once, and a name
  // by name only after that list has answered without it. When the whole
  // registry is already loaded (Studio was opened, say), the scope is cut from
  // it and nothing is requested. With `names` and no `packageId` it is the
  // names-only scope (objectui#12980): no package list, each name by name.
  const readObjectScope = useCallback(
    (scope: { packageId?: string; names?: readonly string[] }) => {
      const namesOnly = !scope.packageId && !!scope.names && scope.names.length > 0;
      const packageId = scope.packageId || (namesOnly ? NAMES_ONLY_SCOPE : undefined);
      if (packageId === undefined) {
        const status = getEntry('object').status;
        const served = readType('object');
        return {
          objects: composeObjects(served, readType('view')) as any[],
          served,
          missing: NO_NAMES,
          settled: status === 'ready' || status === 'error',
        };
      }
      let entry = scopesRef.current.get(packageId);
      if (!entry) {
        entry = { status: 'idle', items: [], answered: false, names: new Map(), missing: [], refused: NO_REFUSALS };
        scopesRef.current.set(packageId, entry);
      }
      const whole = getEntry('object');
      // The whole list in hand answers the scope; one in flight is waited for
      // (a record route reads it), rather than asked for twice.
      if (entry.status === 'idle') {
        if (whole.status === 'ready') {
          entry.items = namesOnly ? [] : whole.items.filter((it: any) => it?._packageId === packageId);
          entry.status = 'ready';
          entry.answered = true;
        } else if (whole.status !== 'loading') {
          if (namesOnly) {
            // No package list to wait for: the names are asked at once.
            entry.status = 'ready';
            entry.answered = true;
          } else {
            void fetchScopeList(packageId, entry);
          }
        }
      }
      let namesSettled = true;
      const failedNames: string[] = [];
      if (scope.names && scope.names.length > 0) {
        if (!entry.answered) {
          namesSettled = false;
        } else {
          for (const name of scope.names) {
            if (!name || entry.items.some((it: any) => it?.name === name)) continue;
            const state = entry.names.get(name);
            if (state === 'answered') continue;
            if (state === 'pending') {
              namesSettled = false;
              continue;
            }
            // objectui#13052 — failed once: reported, not asked again here.
            if (state === 'failed') {
              failedNames.push(name);
              continue;
            }
            if (whole.status === 'ready') {
              const item = whole.byName.get(name);
              entry.names.set(name, 'answered');
              if (item) entry.items = [...entry.items, item];
              else entry.missing = [...entry.missing, name];
              continue;
            }
            namesSettled = false;
            void fetchScopeName(packageId, entry, name);
          }
        }
      }
      // objectui#13052 — `settled` stays false while a name's read has
      // failed (a failure is not an answer, objectui#13009); `failed` names
      // those reads once nothing else is still in flight, so a reader can stop
      // waiting on them. `refused` maps each refused name in `missing` to its
      // code. Both ride beside the published shape: this package's own
      // readers read them (`appObjectScope.ts`), other readers never see them.
      const atRest = entry.answered && namesSettled;
      return {
        objects: composeObjects(entry.items, readType('view')) as any[],
        served: entry.items,
        missing: entry.missing as readonly string[],
        settled: atRest && failedNames.length === 0,
        failed: atRest && failedNames.length > 0 ? (failedNames as readonly string[]) : NO_NAMES,
        refused: entry.refused,
      };
    },
    [fetchScopeList, fetchScopeName, getEntry, readType],
  );

  const value = useMemo<MetadataContextValue>(() => {
    void version;

    const getItemsByType = (type: string): any[] => readType(type);

    const base: MetadataContextValue = {
      apps: getEntry('app').items,
      // The same list for the same stored inputs, read after read (objectui#11699).
      get objects() {
        return composeObjects(readType(TYPE_BY_STATE_KEY.objects), readType('view'));
      },
      get dashboards() {
        return readType(TYPE_BY_STATE_KEY.dashboards);
      },
      get reports() {
        return readType(TYPE_BY_STATE_KEY.reports);
      },
      get pages() {
        return readType(TYPE_BY_STATE_KEY.pages);
      },
      loading: initialLoading,
      error: initialError ?? getEntry('app').error,
      refresh,
      invalidate,
      ensureType,
      getItem,
      getItemsByType,
      readObjectScope,
      // Pure read — must NOT kick a fetch, so render-phase status checks
      // can't recurse into ensureType.
      getTypeStatus: (type: string) => getEntry(type).status,
    };

    return base;
  }, [version, initialLoading, initialError, ensureType, getItem, getEntry, refresh, invalidate, readType, readObjectScope]);

  return <MetadataCtx.Provider value={value}>{children}</MetadataCtx.Provider>;
}

export function useMetadataType(type: string): { items: any[]; loading: boolean; error: Error | null } {
  const ctx = useMetadata();
  const items = ctx.getItemsByType(type);
  return { items, loading: ctx.loading && type === 'app', error: ctx.error };
}
