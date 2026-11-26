// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { createAuthenticatedFetch } from '@object-ui/auth';

/**
 * The app segment a record of `objectName` lives under: the object's owning
 * package, read from `/api/v1/meta/object/<name>` (`_packageId`), with `setup`
 * as the fallback shell for an object no package claims. Best-effort: a failed
 * read still lands on the record. Shared by the AI chat page's record hand-off
 * (cloud#1658) and the record-write card's form hand-off (cloud#3565).
 *
 * objectstack#37242 — the read goes through the console's authenticated fetch,
 * so a session held by its bearer token alone (no cookie) still finds the
 * owning app; the bare cookie-only `fetch` was answered `401` there and every
 * hand-off fell back to `setup`.
 */
export async function appOfObject(objectName: string): Promise<string> {
  try {
    const r = await createAuthenticatedFetch()(`/api/v1/meta/object/${encodeURIComponent(objectName)}`, {
      credentials: 'include',
    });
    if (r.ok) {
      const j = (await r.json()) as { item?: { _packageId?: unknown } };
      if (typeof j?.item?._packageId === 'string' && j.item._packageId) return j.item._packageId;
    }
  } catch {
    /* resolution is best-effort; the caller's fallback still lands on the record */
  }
  return 'setup';
}
