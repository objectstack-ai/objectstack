// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The central conversion pass (ADR-0087 D2).
 *
 * {@link applyConversions} runs every registered {@link MetadataConversion}
 * against a normalized stack, threading the (immutably updated) stack through
 * each entry and turning each rewrite into a structured {@link ConversionNotice}.
 * It is wired into `normalizeStackInput`, so it fires on the single seam every
 * load path funnels through — `defineStack`, `objectstack validate`, `lint`,
 * `info`, and `doctor`.
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
  const { onNotice, onConflict, reservedNodeTypes } = options;
  let current = stack;

  for (const conversion of ALL_CONVERSIONS) {
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
export function collectConversionNotices(stack: Record<string, unknown>): {
  stack: Record<string, unknown>;
  notices: ConversionNotice[];
} {
  const notices: ConversionNotice[] = [];
  const converted = applyConversions(stack, { onNotice: (n) => notices.push(n) });
  return { stack: converted, notices };
}
