// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0015 amendment D7] The borrow every door of this package makes for a
 * datasource that names a connector instance in `external.connector`: the
 * boot and runtime connect (`DatasourceConnectionService`), the connection
 * probe, and the create / update judgement. One copy, so the three cannot
 * disagree about whether a datasource can borrow.
 *
 * The source is the automation service's (`CONNECTOR_CREDENTIAL_SOURCE_SERVICE`,
 * `@objectstack/types`), read structurally: this package imports no
 * automation package, which is the dependency direction the D7 runtime seam
 * chose.
 */

import type { ConnectorCredentialHandle, IConnectorCredentialSource } from '@objectstack/types';

/** The connector instance `external` names, or `undefined` when it names none. */
export function borrowedConnectorOf(external: unknown): string | undefined {
  if (typeof external !== 'object' || external === null) return undefined;
  const connector = (external as { connector?: unknown }).connector;
  return typeof connector === 'string' && connector.length > 0 ? connector : undefined;
}

/** A borrow's outcome: the handle, or the operator-facing reason it was refused. */
export type ConnectorCredentialBorrow =
  | { ok: true; handle: ConnectorCredentialHandle }
  | { ok: false; reason: string; cause?: unknown };

/**
 * Borrow `connector`'s credential from `source`. Never throws: a missing
 * source and a refused borrow both come back as a reason, which names the
 * instance and the fix and never a value — the source's refusals are written
 * that way, and nothing else is interpolated.
 */
export async function borrowConnectorCredential(
  source: IConnectorCredentialSource | undefined,
  connector: string,
): Promise<ConnectorCredentialBorrow> {
  if (!source || typeof source.borrow !== 'function') {
    return {
      ok: false,
      reason: `this datasource borrows the credential of connector instance '${connector}' (external.connector), but no `
        + 'connector credential source is registered. The automation service (@objectstack/service-automation) lends '
        + "connector credentials; add it to the stack's plugins.",
    };
  }
  try {
    return { ok: true, handle: await source.borrow(connector) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: message, cause: err };
  }
}
