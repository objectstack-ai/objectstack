// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * "Clone to customize" for a permission set — the call to the server's clone
 * door (objectui#7611, PR-4). The dialog that asks for the copy's new machine
 * name and label is `PermissionSetCloneDialog.tsx`.
 *
 * ## The door
 *
 * `POST /api/v1/security/permission-sets/:name/clone`, body `{ name, label }`
 * (objectstack#22881, ADR-0126 §7.1). The server reads the source set from the
 * security catalog, copies its WHOLE definition under the new name, drops the
 * keys it declares (the provenance envelope, `packageId`, `managedBy`,
 * `protection`, `adminScope`, `isDefault`), and saves the copy as an ordinary
 * permission set authored in this environment. It answers `{ permissionSet,
 * notice }`: the saved copy, and a sentence naming what was not copied.
 *
 * So this module sends a name and a label and nothing else (the seat's ruling
 * on objectui#7611, 6097763840: "objectui calling it with a name and a label").
 * ⛔ No facet is read or sent from here: which keys ride onto a copy is the
 * server's one declaration, and a client list of them would be a second home
 * for a security policy. ⛔ No `sys_permission_set` row is read either — the
 * door reads the catalog, so a set with no row clones like any other.
 *
 * The door is server-only (there is no client SDK method for it), so it is
 * called the way this package calls its sibling server-only doors
 * (`catalog-activation.ts`, Setup's packaged-automation clone): `fetch` against
 * {@link apiBase}, the ADR-0112 envelope read by `actionErrorDetail`.
 *
 * ## Refusals reach the admin verbatim
 *
 * `400` (a malformed name, the name rule), `401`, `403` (no `manage_metadata`),
 * `404` (no such source), `409` (the name is taken — the message explains why
 * and suggests a free one), `501` and `503`: every one is the server's own
 * sentence, shown in the dialog as sent. The fallback string is used only when
 * the answer carried no message at all.
 */

import { actionErrorDetail } from '@object-ui/core';
import { apiBase } from '../../utils/apiBase.js';
import { envelopeData, envelopeRefused } from '../setup/packagedFlows.js';

/** What a clone that the server accepted reports back. */
export interface PermissionSetCloned {
  /** The copy's machine name, as the server saved it. */
  name: string;
  /** The server's sentence on what was not copied; empty when it sent none. */
  notice: string;
}

/**
 * Clone `source` through the door. Resolves to the saved copy's name (empty
 * when the answer names none) and the server's notice. A refusal rejects with
 * the server's own message; `fallback` words one only when the answer has none.
 */
export async function clonePermissionSet(
  source: string,
  target: { name: string; label: string },
  fallback: (status: number) => string,
): Promise<PermissionSetCloned> {
  const res = await fetch(`${apiBase()}/security/permission-sets/${encodeURIComponent(source)}/clone`, {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    // ⛔ Exactly the two keys the clone body declares; the door refuses any
    // other by name.
    body: JSON.stringify({ name: target.name, label: target.label }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || envelopeRefused(json)) throw new Error(actionErrorDetail(json, fallback(res.status)));
  const data = envelopeData(json);
  const created = (data.permissionSet as { name?: unknown } | null | undefined)?.name;
  return {
    name: typeof created === 'string' ? created : '',
    notice: typeof data.notice === 'string' ? data.notice : '',
  };
}
