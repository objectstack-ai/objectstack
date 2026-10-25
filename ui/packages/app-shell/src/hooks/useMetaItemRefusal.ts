/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Whether the server refused this caller a dashboard or a list view that a URL
 * names and the console's list does not carry (objectui#12112).
 *
 * Since objectstack#22731 the server applies a dashboard's and a list view's
 * `requiredPermissions`: `GET /api/v1/meta/dashboard` and `/meta/view` list
 * only what the caller may open. A withheld item and one that does not exist
 * are therefore the same absence in those lists, and a page that reads only the
 * list says "not found" over a permission refusal. The by-name read tells them
 * apart, as it does for an app: the item the caller does not hold answers `403`
 * `PERMISSION_DENIED` with a sentence naming it. This asks that read, through
 * the adapter's `probeMetaItemAccess` — the door `AppContent` already asks
 * about a missing app — once per missed name.
 *
 *  - `name` null: nothing has missed, or it may not be asked yet. Nothing is
 *    asked, and the reading says nothing.
 *  - No adapter, or one without the probe (a host DataSource, AGENTS #1):
 *    nothing is asked, so the page keeps the face it has for a missing item.
 *  - While the answer is out, `checking`: the page has nothing to say yet.
 *  - The answer is held WITH the name it is about and read back for that name
 *    only, so it never answers for the next URL.
 *  - `refusal` is set for `denied` alone. Every other verdict leaves the page's
 *    missing-item face: the server said absence, or said nothing.
 *
 * Nothing is cached across mounts: a verdict about the CALLER goes stale the
 * moment they are granted the capability.
 */

import { useEffect, useState } from 'react';
import type { MetaItemAccess } from '@object-ui/data-objectstack';
import { useAdapter } from '../providers/AdapterProvider.js';

/** A by-name refusal, as the server answered it. */
export interface MetaItemRefusal {
  /** The server's own sentence for the refusal; absent when it wrote none. */
  readonly message?: string;
}

/** What {@link useMetaItemRefusal} knows about the missed name. */
export interface MetaItemRefusalReading {
  /** The missed name is being asked about. */
  readonly checking: boolean;
  /** The server refused this caller the item; `null` for every other answer. */
  readonly refusal: MetaItemRefusal | null;
}

const NOT_REFUSED: MetaItemRefusalReading = Object.freeze({ checking: false, refusal: null });
const CHECKING: MetaItemRefusalReading = Object.freeze({ checking: true, refusal: null });

export function useMetaItemRefusal(type: 'dashboard' | 'view', name: string | null): MetaItemRefusalReading {
  const adapter = useAdapter();
  const asked = name && typeof adapter?.probeMetaItemAccess === 'function' ? name : null;
  const [answer, setAnswer] = useState<{ type: string; name: string; access: MetaItemAccess } | null>(null);

  useEffect(() => {
    if (!adapter || !asked) return;
    let cancelled = false;
    Promise.resolve(adapter.probeMetaItemAccess(type, asked))
      .then((access) => {
        if (!cancelled) setAnswer({ type, name: asked, access });
      })
      // The adapter's probe never throws, so a host probe that did has given
      // no answer: absence of an answer, never a refusal.
      .catch(() => {
        if (!cancelled) setAnswer({ type, name: asked, access: { verdict: 'unreachable' } });
      });
    return () => {
      cancelled = true;
    };
  }, [adapter, type, asked]);

  if (!asked) return NOT_REFUSED;
  if (!answer || answer.type !== type || answer.name !== asked) return CHECKING;
  if (answer.access.verdict !== 'denied') return NOT_REFUSED;
  return { checking: false, refusal: { message: answer.access.message } };
}
