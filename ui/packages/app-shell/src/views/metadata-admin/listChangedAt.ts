// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The metadata list's 「修改时间」 (objectstack#36898, epic objectstack#36890
 * decision 2): when each listed item last changed, read off the list answer's
 * `changedAt` sibling (`GetMetaItemsResponseSchema.changedAt`, keyed by the
 * item's name, objectstack#36894).
 *
 * Only an item served from a stored row has a time. A code-shipped item has
 * none and its cell is empty — never an error, never a stand-in such as the
 * read time — and it sorts after every item that has one, whichever way the
 * list sorts.
 */

import * as React from 'react';
import type { MetadataClient, MetadataListOptions } from '@object-ui/data-objectstack';

/** The instant `iso` names, in ms; `null` for none or one that does not parse. */
export function changedAtTime(iso: string | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * The `changed` sort's comparison: older first for `asc`, newer first for
 * `desc`; a missing time after any present one in both directions. `0` for
 * equal times or two missing ones (the caller breaks the tie).
 */
export function compareChangedAt(a: string | undefined, b: string | undefined, dir: 'asc' | 'desc'): number {
  const ta = changedAtTime(a);
  const tb = changedAtTime(b);
  if (ta === null || tb === null) return ta === tb ? 0 : ta === null ? 1 : -1;
  return dir === 'desc' ? tb - ta : ta - tb;
}

const FORMATS = new Map<string, Intl.DateTimeFormat>();

/** The cell's text for `iso` in `locale`; `null` for no time. */
export function formatChangedAt(iso: string | undefined, locale: string): string | null {
  const ms = changedAtTime(iso);
  if (ms === null) return null;
  let format = FORMATS.get(locale);
  if (!format) {
    format = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
    FORMATS.set(locale, format);
  }
  return format.format(ms);
}

/**
 * The `changedAt` map of `type`'s list, read with the same request the list
 * page's items come from (`listResponse` and `list` share one in-flight GET).
 * `null` while unread; empty when the read fails or the server serves no
 * times — every cell is then empty, which is what an unknown time draws.
 */
export function useListChangedAt(
  client: MetadataClient,
  type: string,
  options: MetadataListOptions | undefined,
  refreshKey: unknown,
): Readonly<Record<string, string>> | null {
  const [read, setRead] = React.useState<{ type: string; changedAt: Record<string, string> } | null>(null);
  const include = options?.include;
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const answer = await client.listResponse(type, include ? { include } : undefined);
        if (!cancelled) setRead({ type, changedAt: answer.changedAt ?? {} });
      } catch {
        if (!cancelled) setRead({ type, changedAt: {} });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, type, include, refreshKey]);
  return read?.type === type ? read.changedAt : null;
}
