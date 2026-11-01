// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The per-package customization read the Studio landing draws on each
 * read-only base's card (ADR-0146 D3: one line per package, "n customized,
 * m switched off").
 *
 * The numbers are the server's: `GET /api/v1/packages/:id/customizations`
 * (ADR-0146 D8 item 4) answers, for one installed base, the items its paired
 * `<base>.custom` package overrides, the members that pair adds to the base's
 * objects and the base's items switched off in this deployment, each with its
 * count. This reader computes no count of its own: "customized" is the served
 * `counts.overrides` plus the served `counts.extensions`, the two kinds of
 * change the pair carries, and "switched off" is the served
 * `counts.switchedOff`.
 *
 * The answer is judged by the route's own declaration,
 * `GetPackageCustomizationsResponseSchema` (strict at every level): an answer
 * it refuses is a failed read, never a count read out of an off-contract body.
 * A failure carries the server's sentence by the rule every package reader in
 * this folder uses (`readEnvelopeFailureText`), else `HTTP <status>`.
 *
 * ⛔ A pair id is never sent: the route refuses one by its shape
 * (`400 VALIDATION_ERROR` naming its base), so this reader refuses it first,
 * without a request.
 */

import { GetPackageCustomizationsResponseSchema } from '@objectstack/spec/api';
import { isCustomizationPackage } from '@objectstack/spec/kernel';
import { readEnvelopeFailureText } from '../../utils/apiErrorEnvelope.js';

/** What the landing draws for one base: two served numbers. */
export interface PackageCustomizationCounts {
  /** Served overrides plus served extensions of the base's pair. */
  customized: number;
  /** Served switched-off items of the base. */
  switchedOff: number;
}

/** The route of the read, for one base package id. */
export const packageCustomizationsUrl = (baseId: string) =>
  `/api/v1/packages/${encodeURIComponent(baseId)}/customizations`;

/**
 * Read one installed base's customization counts.
 *
 * Rejects with the server's sentence on a failed read, and with a sentence of
 * its own on an answer the route's declaration refuses; resolves only with
 * counts the server served.
 */
export async function fetchPackageCustomizationCounts(baseId: string): Promise<PackageCustomizationCounts> {
  if (isCustomizationPackage(baseId)) {
    throw new Error(`Package '${baseId}' is a customization package: customizations are read for its base.`);
  }
  const res = await fetch(packageCustomizationsUrl(baseId), {
    credentials: 'include',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  const payload = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    throw new Error(readEnvelopeFailureText(payload) ?? `HTTP ${res.status}`);
  }
  // The dispatcher envelope `{ success, data }`; the declaration is the `data`.
  const parsed = GetPackageCustomizationsResponseSchema.safeParse(payload?.data);
  if (!parsed.success) {
    throw new Error(`The customization read for '${baseId}' answered a body its declaration refuses.`);
  }
  const { counts } = parsed.data;
  return { customized: counts.overrides + counts.extensions, switchedOff: counts.switchedOff };
}
