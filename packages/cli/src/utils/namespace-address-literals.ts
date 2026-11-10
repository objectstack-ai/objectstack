// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D5, child G1] `os validate`'s and `os build`'s half of the rule
 * that no package namespace spells a literal segment of the address grammar
 * (`actions`, `connectors`, `global`, `hooks`, `oauth`, `trigger`): the router
 * reads the literal before any namespace, so such a package's qualified
 * addresses would never reach it.
 *
 * ## One judge, not a second rule
 *
 * The verdict and its sentence are the spec's
 * (`validateNamespaceNotAddressLiteral`, `@objectstack/spec/kernel`) — the SAME
 * call the package door (`SchemaRegistry.installPackage`) and `defineStack`
 * make. What this module owns is the WALK: which namespaces one artifact
 * declares (each `packages[]` body's, and the stack's own
 * `manifest.namespace`).
 *
 * ⚠️ Bound, stated rather than hidden: the install door refuses such a
 * namespace, while a package the server's boot registers is only warned there,
 * so a deployment already holding one keeps booting. This check is the earlier
 * point at which a NEW package is refused, before it ships.
 */

import { resolveArtifactPackageOrder } from '@objectstack/core';
import { validateNamespaceNotAddressLiteral } from '@objectstack/spec/kernel';

/**
 * One refused namespace: the namespace, the package declaring it (when it
 * names itself), and the judge's sentence, verbatim. No wire code: these
 * commands answer no request.
 */
export interface NamespaceAddressLiteralRefusalRow {
  readonly namespace: string;
  readonly packageId?: string;
  readonly message: string;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

const stringOf = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

/**
 * Every namespace one artifact declares that spells an address literal, once
 * per namespace. `[]` for a stack the install door accepts on this axis.
 */
export function findNamespaceAddressLiteralRefusals(parsed: Record<string, unknown>): NamespaceAddressLiteralRefusalRow[] {
  const rows: NamespaceAddressLiteralRefusalRow[] = [];
  const seen = new Set<string>();
  const judge = (body: Record<string, unknown> | undefined): void => {
    const namespace = stringOf(body?.namespace);
    if (!namespace || seen.has(namespace)) return;
    seen.add(namespace);
    const message = validateNamespaceNotAddressLiteral(namespace);
    if (message === null) return;
    const packageId = stringOf(body?.id) ?? stringOf(body?.name);
    rows.push({ namespace, ...(packageId ? { packageId } : {}), message });
  };

  if (parsed.packages !== undefined) {
    for (const body of resolveArtifactPackageOrder(parsed)) judge(asRecord(body));
  }
  judge(asRecord(parsed.manifest));
  return rows;
}
