/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `usePageAssignment` — resolve the record PageSchema that should be rendered
 * for a given object. Walks the metadata cache exposed by `<MetadataProvider>`,
 * keeps the PageSchemas whose `type === 'record'` and `object` matches the
 * requested name, and returns the object's DEFAULT record page among them
 * (`isDefault: true`), else the first of them.
 *
 * Returns a discriminated result by `PageSchema.kind`:
 *   - `kind === 'full'` (default): the schema fully describes the page;
 *     the result populates `page` and the caller renders it as-is.
 *   - `kind === 'slotted'`: the schema only provides slot overrides;
 *     the result populates `slots` and the caller feeds them to
 *     `buildDefaultPageSchema(objectDef, { slots })` so omitted slots
 *     fall through to synthesized defaults.
 *
 * Selection is by the declared `PageSchema.isDefault`, then by DECLARATION
 * ORDER among pages that are not the default: the spec allows one default
 * record page per object, so the flag needs no tie-break here, and with no
 * default the first matching page wins. No match returns null, so callers can
 * deterministically fall back to the auto-generated DetailView when no record
 * Page is authored.
 *
 * Future work (deferred): recordType / profile / app / formFactor filtering.
 * Any further author-driven ordering would have to be DECLARED on
 * `PageSchema` in `@objectstack/spec` first — see the note on the selection
 * itself below.
 */

import { useEffect, useMemo, useState } from 'react';
import { defaultRecordPageObject } from '@objectstack/spec/ui';
import { useMetadata } from '../context/AppShellContext.js';

export interface PageAssignmentOptions {
  /** Salesforce-style record type filter (reserved for future use). */
  recordType?: string;
  /** User profile filter (reserved for future use). */
  profile?: string;
  /** Owning app filter (reserved for future use). */
  app?: string;
  /** Form factor filter (reserved for future use). */
  formFactor?: 'desktop' | 'tablet' | 'phone';
  /** Optional explicit page name override; bypasses object-based lookup. */
  pageName?: string;
}

export interface PageAssignmentResult {
  /**
   * Resolved full PageSchema, or null when none is available.
   *
   * Populated only when the matched page has `kind === 'full'` (the
   * default — see `PageSchema.kind`). Slotted pages do NOT populate
   * this field; callers should branch on `slots` instead.
   */
  page: any | null;
  /**
   * Slot override map for the matched slotted page, or null when no
   * slotted page matched.
   *
   * Populated only when the matched page has `kind === 'slotted'`.
   * The caller is expected to feed these slots to the default-page
   * synthesizer (`buildDefaultPageSchema(objectDef, { slots })`) so
   * that omitted slots fall through to synthesized defaults.
   */
  slots: any | null;
  /** True while the metadata cache is still loading the `page` type. */
  loading: boolean;
  /** Loader error, if any. */
  error: Error | null;
}

/**
 * True when `page` is a record page bound to `objectName`: its `type` is
 * `'record'` and its `object` names that object.
 *
 * This is the ONE reading of "a record page of object O" in the console. The
 * object-based lookup below filters its candidates with it, and a route that
 * names a page explicitly (the console's named record page route,
 * objectui#12715) asks it before rendering the named page for a record of O,
 * so a name that is a page of another object, or not a record page at all, is
 * refused rather than rendered. The `pageName` override of
 * {@link usePageAssignment} does not ask it: that option returns the page with
 * that name whatever it is, and a caller that renders a record on the page it
 * gets back asks this first.
 *
 * `type` is the one discriminator, as the lookup's own comment explains
 * (objectui#9674): `pageType` is a key `PageSchema` refuses, so it is not read.
 */
export function isRecordPageOf(page: unknown, objectName: string | undefined | null): boolean {
  if (!page || typeof page !== 'object' || !objectName) return false;
  const p = page as { type?: unknown; object?: unknown };
  return p.type === 'record' && p.object === objectName;
}

function matchesAssignment(_page: any, _opts: PageAssignmentOptions): boolean {
  // Placeholder — every page matches until rules-based assignment lands.
  return true;
}

/**
 * Resolve the record PageSchema for the given object name. Returns `null`
 * when no record Page is configured, signalling the caller to fall back
 * to the auto-generated detail view.
 */
export function usePageAssignment(
  objectName: string | undefined | null,
  opts: PageAssignmentOptions = {},
): PageAssignmentResult {
  const meta = useMetadata();
  const [ensured, setEnsured] = useState(false);
  const [ensureError, setEnsureError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!meta.ensureType) {
      setEnsured(true);
      return;
    }
    meta
      .ensureType('page')
      .then(() => {
        if (!cancelled) {
          setEnsured(true);
          setEnsureError(null);
        }
      })
      .catch(err => {
        if (!cancelled) {
          setEnsureError(err instanceof Error ? err : new Error(String(err)));
          setEnsured(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [meta]);

  const matched = useMemo(() => {
    if (!objectName && !opts.pageName) return null;
    const pages: any[] = Array.isArray(meta.pages) ? meta.pages : [];
    if (!pages.length) return null;

    // Explicit page name override wins.
    if (opts.pageName) {
      return pages.find(p => p?.name === opts.pageName) ?? null;
    }

    const candidates = pages.filter(p => {
      if (!p) return false;
      // `type` is the ONE discriminator: only `type: 'record'` is a
      // user-facing record-detail page, and every other page type
      // (`home` / `app` / `utility` / `list`) is skipped.
      //
      // `pageType` is deliberately NOT read (objectui#9674). `PageSchema` is
      // a `strictObject` that refuses `pageType` by name — it is a declared
      // ALIAS of `type`, and a page carrying it is a hard parse error that
      // names `type` as the key to write — so no page that parses carries it,
      // and reading it would teach the refused spelling onward. A consumer-side
      // alias for a refused key is the fallback AGENTS.md #0.1 rules out. The
      // designer-side `'record_detail'` is not expressible either: it left
      // `PageTypeSchema` (framework#2265), so `type: 'record_detail'` is an
      // invalid enum value.
      if (!isRecordPageOf(p, objectName)) return false;
      return matchesAssignment(p, opts);
    });

    if (!candidates.length) return null;

    // The object's DEFAULT record page decides; with none, declaration order.
    //
    // At most one `isDefault: true` record page may exist for an object in a
    // deployment. That is the spec's rule on `PageSchema.isDefault` (maintainer
    // ruling A on objectstack#23015, record 6134056653), and the platform
    // refuses a second default, naming both pages, at every door that can add
    // one: `defineStack` / `composeStacks` (so `os validate` and a source boot),
    // package registration, and metadata save. So this hook honours the flag
    // with NO tie-break of its own. It asks `defaultRecordPageObject`, the one
    // reading of "the default record page of an object" each of those doors
    // asks, so the page the platform judges to be the default is the page that
    // opens. Replacing a platform record page stays an ADR-0005 overlay by name
    // (the same page, not a second default) or host composition; neither a
    // second default nor an earlier position in the served list overrides one.
    //
    // Boundary, stated rather than left implicit: at a cold boot every package
    // registers before the environment's stored pages hydrate, so a stored
    // default saved while no package held that object's default, and a package
    // that adds one later, both reach the registry unrefused
    // (objectstack#23213, closed not_planned). This hook invents no precedence
    // for that pair (no layer, package or recency rung); served order stays the
    // only order it has, so the first default served wins.
    //
    // Among pages that are not the default, declaration order is the last
    // resort: the first match wins. This used to sort on a `priority` key read
    // off the candidate. No author could ever set it: `PageSchema` is a
    // `strictObject` and does not declare `priority`, so a page carrying one is
    // a HARD PARSE ERROR, not a page that sorts first. Every candidate therefore
    // read `0`, the comparator returned `0` for every pair, and a stable sort
    // left declaration order untouched — the sort documented an affordance the
    // schema refuses (objectui#7298).
    return candidates.find(p => defaultRecordPageObject(p) === objectName) ?? candidates[0];
  }, [meta.pages, objectName, opts.pageName, opts.recordType, opts.profile, opts.app, opts.formFactor]);

  // Discriminate by `kind`: full pages populate `page`, slotted pages
  // populate `slots`. Missing `kind` defaults to 'full' for backwards
  // compatibility with pre-Phase-I metadata.
  const { page, slots } = useMemo(() => {
    if (!matched) return { page: null, slots: null };
    if (matched.kind === 'slotted') {
      return { page: null, slots: matched.slots ?? {} };
    }
    return { page: matched, slots: null };
  }, [matched]);

  return {
    page,
    slots,
    loading: meta.loading || !ensured,
    error: ensureError ?? meta.error ?? null,
  };
}

export default usePageAssignment;
