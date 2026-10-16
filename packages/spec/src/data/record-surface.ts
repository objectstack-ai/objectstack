// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Record-surface derivation — the single source for *how* an object's
 * create / edit / detail record opens by DEFAULT. ADR-0085 §5 "one shared
 * derivation, every surface". The size axis comes from the record's weight
 * ({@link deriveRecordSurface}: field-heavy or mobile → `'page'`, otherwise a
 * side drawer); what that means per flow is {@link deriveRecordFlowSurface}'s:
 *   - viewing a record: a routed full page when field-heavy (or on mobile),
 *     otherwise a drawer;
 *   - creating / editing one: always an overlay — a modal when field-heavy
 *     or on mobile (full-screen on mobile, bounded on desktop), otherwise a
 *     drawer.
 *
 * Why the default is a derivation, not an authored object key
 * -----------------------------------------------------------
 * ADR-0085 §2's admission test rejects per-surface presentation toggles on the
 * object: the size of the surface is not a business fact a machine cannot
 * infer — it is exactly inferable from how heavy the record is. So the
 * platform derives a sensible default here and AI authors write nothing in the
 * common case. The renderer uses this ONLY as the default and lets explicit
 * config win: a view's navigation config, an assigned page, and the
 * object's `editMode` (`'modal' | 'page'`, declared in `object.zod.ts` by
 * commit f11fc61c5's maintainer ruling as edit-interaction intent, which the
 * renderer applies; nothing in this file reads it).
 *
 * The rule is deliberately simple and predictable (a single field-count
 * threshold + a mobile override) because an unpredictable heuristic is its own
 * kind of "silently wrong" for an AI-authored system.
 *
 * Pure and dependency-free, tolerant of bare/un-parsed metadata records (same
 * contract as {@link deriveFieldGroupLayout}) so every consumer can call it.
 */

import { FIELD_GROUP_SYSTEM_FIELDS } from './field-group-layout';

/** The presentation surface a record's create/edit/detail opens on. */
export type RecordSurface = 'page' | 'modal' | 'drawer';

/** Viewport hint; overlays are cramped on phones, so mobile always pages. */
export type RecordSurfaceViewport = 'mobile' | 'desktop';

export interface RecordSurfaceOptions {
  /** Viewport hint. `'mobile'` forces `'page'` (overlays are cramped). */
  viewport?: RecordSurfaceViewport;
  /**
   * Authorable-field count at/above which the record opens as a full page.
   * Defaults to {@link RECORD_SURFACE_PAGE_THRESHOLD}. Exposed so a host can
   * tune the break point without forking the rule.
   */
  pageThreshold?: number;
}

/**
 * Default break point: at/above this many authorable (visible, non-system)
 * fields, a record is "heavy" enough to warrant a full page rather than an
 * overlay. ~12 fields overflow a comfortable two-column modal; beyond it a
 * page (with its own URL, scroll and back button) reads better.
 */
export const RECORD_SURFACE_PAGE_THRESHOLD = 12;

type AnyRec = Record<string, unknown>;

/**
 * Count the fields a user actually fills on a form: visible (not `hidden`) and
 * not an audit/system field. Mirrors the visibility rules of the field-group
 * layout so the two derivations agree on what "the fields" are.
 */
export function countAuthorableFields(def: unknown): number {
  if (!def || typeof def !== 'object' || Array.isArray(def)) return 0;
  const fields = (def as AnyRec).fields;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return 0;
  let n = 0;
  for (const [name, f] of Object.entries(fields as Record<string, AnyRec | undefined>)) {
    if (f?.hidden === true) continue;
    if (FIELD_GROUP_SYSTEM_FIELDS.has(name)) continue;
    n++;
  }
  return n;
}

/**
 * Derive the DEFAULT record surface for an object definition (or any bare
 * metadata record shaped like one).
 *
 * Rule:
 *   - `viewport: 'mobile'` → `'page'` (overlays are cramped on phones);
 *   - authorable field count ≥ threshold → `'page'` (field-heavy);
 *   - otherwise → `'drawer'` (a light side overlay — the historical default).
 *
 * `'modal'` is never emitted by the heuristic; it remains in the return type
 * because an explicit form config can still select it and consumers switch on
 * the full set. Renderers must treat this as a default only — an explicit
 * `formType` / `navigation.mode` wins.
 */
export function deriveRecordSurface(def: unknown, opts: RecordSurfaceOptions = {}): RecordSurface {
  if (opts.viewport === 'mobile') return 'page';
  const threshold = opts.pageThreshold ?? RECORD_SURFACE_PAGE_THRESHOLD;
  if (countAuthorableFields(def) >= threshold) return 'page';
  return 'drawer';
}

/**
 * The record flow being opened. `view` shows state; the other four perform a
 * task (create/change a record). For `child-*` flows — a subtable / related-
 * list child created or edited from its PARENT's detail — pass the CHILD
 * object's def: the overlay sizes to the record being edited, while the
 * return target is always the parent (#2604 D3).
 */
export type RecordFlow = 'view' | 'create' | 'edit' | 'child-create' | 'child-edit';

/** How the surface is mounted: a navigated route, or an overlay over the origin. */
export type RecordFlowContainer = 'route' | 'overlay';

export interface RecordFlowSurface {
  /**
   * `'route'` only ever for flow `'view'` (a record is shareable state —
   * deep-linkable, refresh-safe). Every task flow is an `'overlay'`: close
   * returns to the origin with its context (scroll / filters / tab) intact,
   * which is the #2604 return-flow invariant — and a create/edit URL would be
   * a false promise anyway (refresh loses the draft).
   */
  container: RecordFlowContainer;
  surface: RecordSurface;
  /** Maps onto `navigation.size` / `FormView.modalSize`; routes ignore it. */
  size: 'auto' | 'full';
}

/**
 * Derive the DEFAULT surface for a record FLOW (#2604; extends
 * {@link deriveRecordSurface}, ADR-0085 §5 "one shared derivation").
 *
 * Rule — the two axes are independent:
 *   - how BIG (field count, via {@link deriveRecordSurface}) is unchanged;
 *   - whether it ROUTES is decided by what the flow *is*: viewing a record is
 *     state → route-capable; making/changing one is a task → always overlay.
 *
 * So `view` keeps the #2578 behavior verbatim (`'page'` → route), while the
 * task flows map the derived `'page'` to a MODAL — overlay return semantics.
 * This mapping is why `'modal'` exists in {@link RecordSurface} without the
 * base heuristic ever emitting it. How big that modal is follows the viewport:
 *   - desktop (the default): a BOUNDED modal, `size: 'auto'` — the renderer's
 *     own `lg` / `xl` bound applies, so a field-heavy form is not stretched to
 *     the window edge;
 *   - `viewport: 'mobile'`: a FULL-SCREEN modal, `size: 'full'` (an overlay on
 *     a phone has no room to be anything else).
 * The split is by viewport only. A field-heavy form with an embedded child /
 * line-items table takes the same bounded modal on desktop: #2604 D1 sized
 * task flows by field count alone and scoped the in-form `inlineEdit` grid out
 * of its design, so it never chose full-screen for that case.
 *
 * #2604 D1 (2026-07-05) mapped a field-heavy task flow to a full-screen modal
 * on every viewport.
 * Amended 2026-10-15 by objectui#12521 ruling 6203721639 (letter B): on
 * desktop the field-heavy task flow is a bounded modal; mobile keeps
 * full-screen.
 *
 * Like the base derivation this is a DEFAULT only, read from `def.fields`,
 * `flow` and `opts` and nothing else: the renderer lets explicit
 * config win over it — `navigation.mode` / `navigation.size`, an assigned
 * page, and the object's `editMode` (`'modal' | 'page'`, declared in
 * `object.zod.ts` as the object's edit-interaction intent, which the renderer
 * applies; not read here).
 */
export function deriveRecordFlowSurface(
  def: unknown,
  flow: RecordFlow,
  opts: RecordSurfaceOptions = {},
): RecordFlowSurface {
  const surface = deriveRecordSurface(def, opts);
  if (flow === 'view') {
    return { container: surface === 'page' ? 'route' : 'overlay', surface, size: 'auto' };
  }
  // Task flows (create / edit / child-*): never a route. The base derivation
  // says 'page' when field-heavy or mobile → a modal: full-screen on mobile,
  // bounded (`'auto'`, the renderer's lg/xl bound) on desktop.
  if (surface === 'page') {
    return { container: 'overlay', surface: 'modal', size: opts.viewport === 'mobile' ? 'full' : 'auto' };
  }
  return { container: 'overlay', surface, size: 'auto' };
}
