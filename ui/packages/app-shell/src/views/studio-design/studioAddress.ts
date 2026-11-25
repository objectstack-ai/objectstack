// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The one builder of Studio addresses (objectstack#36895, Studio redesign
 * epic #36890). Every place that produces a `/studio...` URL calls a builder
 * here; nothing else spells one by hand, and
 * `studioAddress.guard.test.ts` refuses a hand-built one anywhere under `ui/`.
 *
 * ## Why one builder first
 *
 * The epic moved objects, flows and permission sets from their pillar
 * addresses (`/studio/<package>/data?surface=object:<name>`) to metadata
 * addresses (`/studio/<package>/metadata/<type>/<name>`), one designer card at
 * a time, each switching every producer here in the PR that shipped its
 * designer. objectstack#36909 — every type has moved, so an item address is
 * always the metadata one ({@link studioItemPath}); the retired pillar
 * addresses only redirect (`studioPillarRedirectModel.ts`).
 *
 * ## Today's addresses, byte for byte
 *
 * The producers this module replaced did not agree on how to spell a
 * `?surface=` value; each spelling is named by {@link StudioSurfaceSpelling},
 * because a changed byte is a changed address (a bookmark, a test pin, a link
 * an AI was handed), and the redirects still read every one. The mapping table
 * (`studioAddressTable.ts`) lists every address family, every `?surface=`
 * spelling and every parameter, and what each became.
 *
 * ## The server's two addresses
 *
 * The draft door's review links (the CLI's `os meta register` and the MCP
 * authoring tools) are built by `studioChangesReviewLink` and
 * `studioItemReviewLink` in `@objectstack/types`, which both server packages
 * already depend on; the Console does not depend on that package, so
 * {@link studioChangesReviewPath} and {@link studioItemReviewPath} are their
 * Console halves, pinned to the same literals.
 *
 * Pure: no React, no router, so every rule is pinned without a render.
 */

// ---------------------------------------------------------------------------
// The vocabulary
// ---------------------------------------------------------------------------

/** The root every Studio address starts with. */
export const STUDIO_ROOT_PATH = '/studio';

/** The pillar a package's Studio opens on: its home. */
export const STUDIO_HOME_PILLAR = 'data';

/** The "All metadata" area's route segment, beside the pillars' (`/studio/<package>/metadata`). */
export const STUDIO_METADATA_AREA = 'metadata';

/** The reserved `/studio/<segment>` value for the "All metadata" area's cross-package leg. */
export const STUDIO_ALL_PACKAGES_SEGMENT = '~all';

/** The reserved `/studio/<segment>` value for the package-less scope (`studioScope.ts`). */
export const STUDIO_ORG_SCOPE_SEGMENT = '~org';

/**
 * objectstack#36903 — the one type the package-less scope's area serves: its
 * flows, the items that belong to no package (`studioScope.ts`).
 */
export const STUDIO_ORG_SCOPE_TYPE = 'flow';

/** The retired Interfaces pillar's route segment (objectstack#36502). No pillar answers to it any more. */
export const RETIRED_INTERFACES_SEGMENT = 'interfaces';

/** The query key that opens Studio's Changes drawer (`studioChangesLink.ts`). */
export const STUDIO_CHANGES_PARAM = 'changes';

/** The one {@link STUDIO_CHANGES_PARAM} value the surface acts on: review the pending drafts. */
export const STUDIO_CHANGES_REVIEW = 'review';

/** The query key that opens an item page's draft review in the "All metadata" area. */
export const STUDIO_ITEM_REVIEW_PARAM = 'review';

/** The one {@link STUDIO_ITEM_REVIEW_PARAM} value the item page acts on. */
export const STUDIO_ITEM_REVIEW_VALUE = '1';

/**
 * objectstack#36905 (epic decision 11) — the route segment of a package's
 * organization-wide default sharing overview (`/studio/<package>/owd`), a page
 * of its own in the menu's Access group. Not a metadata item and not a pillar.
 */
export const STUDIO_OWD_SECTION = 'owd';

/** The query key that names the object the overview scrolls to and marks (`?object=<name>`). */
export const STUDIO_OWD_OBJECT_PARAM = 'object';

/**
 * The retired pillars' route segments. objectstack#36909 — no pillar draws a
 * page any more: each address only redirects (`studioPillarRedirectModel.ts`).
 */
export type StudioPillarKey = 'data' | 'automations' | 'access';

// ---------------------------------------------------------------------------
// The one path builder
// ---------------------------------------------------------------------------

/** How the first segment after `/studio` is written. */
export type StudioSegmentEncoding =
  /** `encodeURIComponent` — what every package-id producer does. The default. */
  | 'component'
  /** As given: the segment is already in its URL form (a route param read back, a reserved `~` segment). */
  | 'verbatim';

/** The parts after the path. */
export interface StudioPathOptions {
  /** The query without its `?`, or a `URLSearchParams` (serialised as `toString()` does). Empty adds nothing. */
  query?: string | URLSearchParams | null;
  /**
   * A search string appended exactly as given, `?` included (`location.search`).
   * For a producer that carries the current query over untouched; not with `query`.
   */
  search?: string | null;
  /** The fragment, `#` included. */
  hash?: string | null;
  /** How the first segment is written. Default `'component'`. */
  segmentEncoding?: StudioSegmentEncoding;
}

/**
 * A Studio address: `/studio`, then the scope segment (a package id, `~org`,
 * `~all`), then a section (a pillar key, `metadata`), then a rest path already
 * in its URL form (`object/account`), then the query and the fragment. Every
 * part is optional from the right; a part after an absent one is not allowed
 * (a section names nothing without its scope).
 *
 * An empty segment counts as absent and drops the section and rest with it, so
 * `studioHomePath('')` is `/studio`, not `/studio//data`. Callers guard a
 * missing package themselves; the builder does not stand in for that check.
 */
export function studioPath(
  segment?: string | null,
  section?: string | null,
  rest?: string | null,
  options: StudioPathOptions = {},
): string {
  let path = STUDIO_ROOT_PATH;
  if (segment) {
    path += `/${options.segmentEncoding === 'verbatim' ? segment : encodeURIComponent(segment)}`;
    if (section) {
      path += `/${section}`;
      if (rest) path += `/${rest}`;
    }
  }
  const query = typeof options.query === 'string' ? options.query : options.query ? options.query.toString() : '';
  if (query) path += `?${query}`;
  if (options.search) path += options.search;
  if (options.hash) path += options.hash;
  return path;
}

// ---------------------------------------------------------------------------
// Landing, package, pillar
// ---------------------------------------------------------------------------

/** The Studio landing, `/studio`, optionally with a query (`new=package`). */
export function studioLandingPath(options: Omit<StudioPathOptions, 'segmentEncoding'> = {}): string {
  return studioPath(null, null, null, options);
}

/** A package's Studio, `/studio/<package>`: the route lands it on {@link STUDIO_HOME_PILLAR}. */
export function studioPackagePath(packageId: string): string {
  return studioPath(packageId);
}

/** One pillar (or other section) of a scope, `/studio/<package>/<pillar>`. */
export function studioPillarPath(segment: string, pillar: string, options: StudioPathOptions = {}): string {
  return studioPath(segment, pillar, null, options);
}

/** A package's Studio home, `/studio/<package>/data`. */
export function studioHomePath(packageId: string, options: StudioPathOptions = {}): string {
  return studioPillarPath(packageId, STUDIO_HOME_PILLAR, options);
}

/**
 * A package's organization-wide default sharing overview,
 * `/studio/<package>/owd`, optionally on one object (`?object=<name>`).
 */
export function studioOwdOverviewPath(
  packageId: string,
  options: { object?: string | null; query?: string | URLSearchParams | null; segmentEncoding?: StudioSegmentEncoding } = {},
): string {
  const query = new URLSearchParams(typeof options.query === 'string' ? options.query : options.query ?? undefined);
  if (options.object) query.set(STUDIO_OWD_OBJECT_PARAM, options.object);
  return studioPath(packageId, STUDIO_OWD_SECTION, null, { query, segmentEncoding: options.segmentEncoding });
}

// ---------------------------------------------------------------------------
// The retired `?surface=` deep link
// ---------------------------------------------------------------------------

/**
 * How a producer wrote a retired pillar's `?surface=<type>:<name>` value.
 * Three spellings reached the same surface, and every one still redirects
 * (`studioPillarRedirectModel.ts` reads them all through `parseSurfaceParam`):
 *
 *  - `'component'`: the whole value through `encodeURIComponent`,
 *    `surface=object%3Aaccount`. The default; most producers.
 *  - `'name'`: the type and colon as written, the name through
 *    `encodeURIComponent`, `surface=object:account` (the app → Studio bridge,
 *    `appStudioObjectPath`).
 *  - `'form'`: `URLSearchParams` serialisation, with any qualifiers after
 *    it in the order given, `surface=object%3Aaccount&action=approve`
 *    (`switchedOffActionPath`). It differs from `'component'` for a space
 *    (`+`) and for `!'()~`.
 */
export type StudioSurfaceSpelling = 'component' | 'name' | 'form';

// ---------------------------------------------------------------------------
// The "All metadata" area
// ---------------------------------------------------------------------------

/** The area's root of a scope, `/studio/<package or ~all>/metadata`. */
export function studioMetadataAreaRoot(segment: string): string {
  return studioPath(segment, STUDIO_METADATA_AREA);
}

/**
 * A path below the area's root, `rest` already in its URL form (`flow`,
 * `object/account`, `''` for the root itself).
 */
export function studioMetadataAreaAddress(segment: string, rest: string, options: StudioPathOptions = {}): string {
  return studioPath(segment, STUDIO_METADATA_AREA, rest, options);
}

/** A type's list in the area, `/studio/<package>/metadata/<type>`. */
export function studioMetadataTypePath(segment: string, type: string): string {
  return studioMetadataAreaAddress(segment, encodeURIComponent(type));
}

/** An item's generic page in the area, `/studio/<package>/metadata/<type>/<name>`. */
export function studioMetadataItemAddress(segment: string, type: string, name: string, options: StudioPathOptions = {}): string {
  return studioMetadataAreaAddress(segment, `${encodeURIComponent(type)}/${encodeURIComponent(name)}`, options);
}

// ---------------------------------------------------------------------------
// The item address
// ---------------------------------------------------------------------------

/** Options of an item address ({@link studioItemPath}). */
export interface StudioItemOptions {
  /** The metadata address's query (objectstack#36904: `?action=` opens the object designer's Actions tab on it). */
  qualifiers?: Readonly<Record<string, string>>;
  /** How the scope segment is written. Default `'component'`. */
  segmentEncoding?: StudioSegmentEncoding;
}

/**
 * Where one item of a package opens: its page in the "All metadata" area,
 * where an object, a flow and a permission set open their designers
 * full-screen. `qualifiers` are the address's query.
 */
export function studioItemPath(packageId: string, type: string, name: string, options: StudioItemOptions = {}): string {
  return studioMetadataItemAddress(packageId, type, name, {
    segmentEncoding: options.segmentEncoding,
    query: options.qualifiers ? new URLSearchParams(options.qualifiers as Record<string, string>) : null,
  });
}

// ---------------------------------------------------------------------------
// The draft review links
// ---------------------------------------------------------------------------

/** A package's Changes drawer, opened from outside its Studio: `/studio/<package>/data?changes=review`. */
export function studioChangesReviewPath(packageId: string): string {
  return studioHomePath(packageId, { query: `${STUDIO_CHANGES_PARAM}=${STUDIO_CHANGES_REVIEW}` });
}

/** An item's draft review in the area: `/studio/<package>/metadata/<type>/<name>?review=1`. */
export function studioItemReviewPath(packageId: string, type: string, name: string): string {
  return studioMetadataItemAddress(packageId, type, name, {
    query: `${STUDIO_ITEM_REVIEW_PARAM}=${STUDIO_ITEM_REVIEW_VALUE}`,
  });
}

// ---------------------------------------------------------------------------
// "Came from Studio": an app page opened from a Studio list
// ---------------------------------------------------------------------------

/**
 * The query key an app page carries when Studio opened it (objectstack#36906,
 * epic #36890 decision 15). Its value is the Studio address to return to: the
 * list the author left, with its filters and sort. It lives in the address,
 * not in navigation state, so after a reload the page's × still goes back to
 * Studio.
 *
 * Registered with the console's reserved params (`urlParams.ts`).
 */
export const STUDIO_RETURN_PARAM = 'studio';

/**
 * `appPath` (an app address; its own query and fragment are kept) with
 * {@link STUDIO_RETURN_PARAM} set to `studioAddress`. A value that is not a
 * Studio address is not carried: `appPath` comes back unchanged.
 */
export function withStudioReturn(appPath: string, studioAddress: string): string {
  if (!isStudioAddress(studioAddress)) return appPath;
  const hashAt = appPath.indexOf('#');
  const hash = hashAt >= 0 ? appPath.slice(hashAt) : '';
  const beforeHash = hashAt >= 0 ? appPath.slice(0, hashAt) : appPath;
  const queryAt = beforeHash.indexOf('?');
  const path = queryAt >= 0 ? beforeHash.slice(0, queryAt) : beforeHash;
  const params = new URLSearchParams(queryAt >= 0 ? beforeHash.slice(queryAt + 1) : '');
  params.set(STUDIO_RETURN_PARAM, studioAddress);
  return `${path}?${params.toString()}${hash}`;
}

/**
 * The Studio address that an app page's {@link STUDIO_RETURN_PARAM} names.
 * Returns `null` when the param is missing, or when its value is anything
 * other than a Studio address on this origin. The value comes from the
 * address bar, so it is untrusted and is never followed outside Studio.
 */
export function readStudioReturn(search: string | URLSearchParams | null | undefined): string | null {
  if (!search) return null;
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const value = params.get(STUDIO_RETURN_PARAM);
  return value && isStudioAddress(value) ? value : null;
}

/** Whether `value` is a Studio address on this origin: `/studio` or a path below it, nothing else. */
function isStudioAddress(value: string): boolean {
  if (!value.startsWith(STUDIO_ROOT_PATH) || value.includes('\\')) return false;
  const next = value.charAt(STUDIO_ROOT_PATH.length);
  if (next !== '' && next !== '/' && next !== '?' && next !== '#') return false;
  try {
    const base = 'http://studio.invalid';
    const url = new URL(value, base);
    return url.origin === base && (url.pathname === STUDIO_ROOT_PATH || url.pathname.startsWith(`${STUDIO_ROOT_PATH}/`));
  } catch {
    return false;
  }
}
