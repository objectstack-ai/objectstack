// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The central conversion pass (ADR-0087 D2).
 *
 * {@link applyConversions} runs every registered {@link MetadataConversion}
 * against a normalized stack, threading the (immutably updated) stack through
 * each entry and turning each rewrite into a structured {@link ConversionNotice}.
 * It is wired into `normalizeStackInput`, so it fires on the single seam every
 * AUTHORING path funnels through — `defineStack`, `objectstack validate`,
 * `lint`, `info`, and `doctor`. Data-at-rest load paths reach it by their own
 * route and with `includeRetired` set; see that option below.
 */

import { ALL_CONVERSIONS } from './registry.js';
import {
  CONVERSION_CONFLICT_CODE,
  CONVERSION_NOTICE_CODE,
  type ConversionConflictNotice,
  type ConversionContext,
  type ConversionNotice,
} from './types.js';

export interface ApplyConversionsOptions {
  /**
   * Sink for each structured notice. Defaults to a no-op: converting the shape
   * is the point (zero consumer action); *surfacing* the notice is the caller's
   * choice. `objectstack validate` passes a sink that prints them.
   */
  onNotice?: (notice: ConversionNotice) => void;
  /**
   * Also apply conversions marked `retiredFromLoadPath` (default `false`).
   *
   * **Retirement is an AUTHORING-SURFACE event**, and the default posture is
   * that surface: `normalizeStackInput` — the single funnel for `defineStack`,
   * `validate`, `lint`, `compile`, `info`, `doctor`, i18n extraction and
   * scaffold validation — never sets this, so a live author meets the
   * tombstone and is taught the canonical spelling instead of having the old
   * shape silently rewritten. That funnel is the whole jurisdiction the flag
   * has; it is not a claim about every load path.
   *
   * **Data-at-rest load paths set it deliberately** — three call sites today:
   * `applyConversionsToStoredItem` (`./stored.js`), where it is *pinned*
   * rather than offered (`StoredConversionOptions` omits the key, so no caller
   * can turn it off); flow rehydration in the automation engine; and the
   * artifact-ingestion door (`applyArtifactForwardConversions` in
   * `@objectstack/metadata-core`, reached from two callers), which opens the
   * window by comparing the artifact's declared `engines.protocol` floor with
   * the running spec version. A stored row, a stored flow and a built artifact
   * have no author to teach, so each replays the FULL chain, retired entries
   * included — ADR-0087's `## Addendum (2026-07-31)` for the first two, the
   * #12772 ruling for the third. The fixture CI sets it as well, so graduated
   * transforms stay covered forever (ADR-0087 D3).
   *
   * `objectstack migrate meta` is NOT one of these callers: `applyMetaMigrations`
   * (`../migrations/chain.js`) looks each step's conversion up in
   * `ALL_CONVERSIONS` by id and calls its `apply` directly, so it never reaches
   * this option at all.
   */
  includeRetired?: boolean;
  /**
   * Sink for each structured **conflict** — a rename refused because its old
   * token is a live name in this environment (see {@link ConversionContext}).
   * Populated by the runtime load seam; absent on the build/validate seam.
   */
  onConflict?: (notice: ConversionConflictNotice) => void;
  /**
   * Node types that are live in this environment. Supplied by the runtime load
   * seam so open-namespace renames can detect a collision with a live owner
   * rather than silently clobber it.
   */
  reservedNodeTypes?: ReadonlySet<string>;
  /**
   * Conversion ids this seam refuses to replay, whatever `includeRetired`
   * says. Empty/absent by default: every seam replays the whole window it
   * opened.
   *
   * **Why a seam needs this at all.** `includeRetired` opens the window for a
   * WHOLE CLASS of caller (data at rest), and the entries inside that window
   * are not one kind. Most are lossless deletes or renames of a shape the
   * current schema now REFUSES — replaying those is the rescue the window
   * exists for, because without it the row or artifact is simply unbootable.
   * A few are DEFAULT FLIPS: the old shape still parses, still means
   * something, and the rewrite changes what it means. For those the replay is
   * not a rescue, it is a reinterpretation — and whether it is sound depends
   * on the CALLER, not on the entry: only a seam that can say "this input
   * predates the flip" as a FACT rather than a guess may apply one.
   *
   * ⇒ The entry cannot answer that (nothing in the item distinguishes a
   * machine-written row at rest from an author who wrote the same key
   * yesterday), and `retiredFromLoadPath` does not answer it either — its
   * jurisdiction is the authoring funnel and nothing else (see that flag's
   * own docblock on `MetadataConversion`). This option is where a seam says
   * which entries its own evidence cannot carry.
   *
   * ⛔ NOT a second conversion table and never a filter of convenience: the
   * registry stays the single authority on WHAT converts. A caller passing
   * this owes a written reason per id, at the call site.
   */
  excludeConversionIds?: readonly string[];
}

/**
 * Apply the whole conversion table to a normalized stack.
 *
 * Pure and immutable: returns the original reference untouched when nothing
 * converts, otherwise a copy-on-write stack with old shapes rewritten to
 * canonical. Never throws — a conversion only rewrites shapes it positively
 * recognizes, mirroring the handshake's "never false-reject" discipline (D1).
 */
export function applyConversions(
  stack: Record<string, unknown>,
  options: ApplyConversionsOptions = {},
): Record<string, unknown> {
  const { onNotice, onConflict, reservedNodeTypes, includeRetired = false, excludeConversionIds } = options;
  const excluded = excludeConversionIds && excludeConversionIds.length > 0
    ? new Set(excludeConversionIds)
    : null;
  let current = stack;

  for (const conversion of ALL_CONVERSIONS) {
    // The seam's own refusal, read BEFORE the retirement window: a caller that
    // cannot carry a given entry's precondition does not get it back by
    // opening the window (see `excludeConversionIds`).
    if (excluded?.has(conversion.id)) continue;
    // A retired entry is graduated chain history (ADR-0087 D2 window, second
    // half): the AUTHORING funnel (`normalizeStackInput`) no longer replays it,
    // so the tombstone teaches the author instead. The data-at-rest seams —
    // stored-row rehydration, flow rehydration, the artifact-ingestion door —
    // opt back in via `includeRetired`, as do the fixture CI and any caller
    // rehydrating rows nobody can be taught (see `includeRetired` above).
    if (conversion.retiredFromLoadPath && !includeRetired) continue;
    const retiresIn = conversion.toMajor + 1;
    const context: ConversionContext = {
      reservedNodeTypes,
      reportConflict: onConflict
        ? (detail) =>
            onConflict({
              code: CONVERSION_CONFLICT_CODE,
              conversionId: conversion.id,
              surface: conversion.surface,
              token: detail.token,
              path: detail.path,
              message: `[protocol] ${detail.reason} (ADR-0087 conversion '${conversion.id}').`,
            })
        : undefined,
    };
    current = conversion.apply(
      current,
      (detail) => {
        if (!onNotice) return;
        onNotice({
          code: CONVERSION_NOTICE_CODE,
          conversionId: conversion.id,
          surface: conversion.surface,
          toMajor: conversion.toMajor,
          retiresIn,
          from: detail.from,
          to: detail.to,
          path: detail.path,
          message:
            `[protocol] converted ${conversion.surface} at ${detail.path}: ` +
            `'${detail.from}' → '${detail.to}' (deprecated; ADR-0087 conversion ` +
            `'${conversion.id}', retires from the load path in protocol ${retiresIn}). ` +
            `Update the source to '${detail.to}'.`,
        });
      },
      context,
    );
  }

  return current;
}

/**
 * Apply the conversion pass to a **single flow definition** — the shape the
 * runtime automation engine loads one at a time via `registerFlow`.
 *
 * This is the runtime load seam ADR-0087 D2 calls for: a stored flow authored
 * against an old shape (e.g. a `delete_record` node with `config.filters`, or a
 * `webhook` callout node) is canonicalized on rehydration, so the executor only
 * ever sees the canonical shape. Callers pass `reservedNodeTypes` (their live
 * executor registry) so an open-namespace rename over a live custom node becomes
 * a reported conflict, not a silent clobber. Non-object input is returned
 * unchanged.
 */
export function applyConversionsToFlow<T>(flow: T, options: ApplyConversionsOptions = {}): T {
  if (flow == null || typeof flow !== 'object' || Array.isArray(flow)) return flow;
  const converted = applyConversions({ flows: [flow as Record<string, unknown>] }, options);
  const flows = converted.flows;
  return Array.isArray(flows) && flows.length > 0 ? (flows[0] as T) : flow;
}

/**
 * Collect the notices a stack would emit without needing an external sink —
 * convenience for `validate` / `lint` / the future MCP `spec_deprecations` tool.
 */
export function collectConversionNotices(
  stack: Record<string, unknown>,
  options: Omit<ApplyConversionsOptions, 'onNotice'> = {},
): {
  stack: Record<string, unknown>;
  notices: ConversionNotice[];
} {
  const notices: ConversionNotice[] = [];
  const converted = applyConversions(stack, { ...options, onNotice: (n) => notices.push(n) });
  return { stack: converted, notices };
}
