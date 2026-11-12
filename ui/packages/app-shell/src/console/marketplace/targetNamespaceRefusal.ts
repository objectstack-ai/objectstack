// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#32040 — which hosted unmanaged-install refusals are about the
 * namespace the operator typed, read from the refusal's code and facts.
 *
 * The same-origin `POST /api/v1/cloud-connection/install` route (and the
 * control plane behind it) refuses a `target_namespace` in three ways:
 *
 *   409 RESOURCE_CONFLICT  details.namespace        another package owns that
 *                                                   namespace: a different name
 *                                                   clears it, so the dialog
 *                                                   asks for one.
 *   400 INVALID_REQUEST    details.targetNamespace  malformed or reserved: the
 *                                                   server's sentence says why,
 *                                                   shown beside the field.
 *   409 RESOURCE_CONFLICT  details.targetPackageId  a second unmanaged copy of
 *                                                   the same package (its base
 *                                                   is always `<source>-copy`):
 *                                                   a new namespace does NOT
 *                                                   clear it, so it is a plain
 *                                                   refusal with no re-ask.
 *
 * `installPackage()` carries `code` and `details` on the error it throws; the
 * code is read with `errorCodeIs`, the console's one code reader. Anything
 * else is `null`, and the page shows the refusal as it always did.
 */

import { errorCodeIs } from '@object-ui/types';

export type TargetNamespaceRefusal =
  | { kind: 'taken'; namespace: string }
  | { kind: 'invalid'; message: string };

const detailsOf = (e: unknown): Record<string, unknown> | null => {
  const d = (e as { details?: unknown } | null | undefined)?.details;
  return d && typeof d === 'object' ? (d as Record<string, unknown>) : null;
};

export function readTargetNamespaceRefusal(e: unknown): TargetNamespaceRefusal | null {
  const details = detailsOf(e);
  if (!details) return null;
  if (errorCodeIs(e, 'RESOURCE_CONFLICT')) {
    // The copy's own base is taken: no namespace clears that.
    if (details.targetPackageId !== undefined) return null;
    const namespace = details.namespace;
    return typeof namespace === 'string' && namespace !== '' ? { kind: 'taken', namespace } : null;
  }
  if (errorCodeIs(e, 'INVALID_REQUEST') && 'targetNamespace' in details) {
    const message = (e as { message?: unknown }).message;
    return typeof message === 'string' && message !== '' ? { kind: 'invalid', message } : null;
  }
  return null;
}
