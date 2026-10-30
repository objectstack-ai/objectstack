// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0146 D2 — one editor per item: a read-only package's item of an overlay
 * type is edited in place, in Studio, on that package. The draft the pillar
 * saves is the item's environment overlay (the same `PUT /meta/:type/:name`
 * draft door Setup's item page writes), the package publish applies it, and
 * Reset is the same `DELETE /meta/:type/:name`.
 *
 * Every answer here is read off two served facts and nothing else: the
 * metadata type registry (`GET /meta/types`, `allowEnvironmentOverlay`,
 * ADR-0005) and the item's layered read (`GET /meta/:type/:name/layers`, the
 * ADR-0010 protection envelope). ⛔ No client copy of the overlay tier or of
 * the lock rules: an item the envelope refuses stays read-only here, as the
 * server would refuse its save.
 */

import * as React from 'react';
import type { MetadataClient, MetadataLayered } from '@object-ui/data-objectstack';

/**
 * The overlay types the Interfaces pillar has a designer for, edited in place
 * on a read-only package: views, dashboards and reports. Translations and
 * email templates take an overlay too, but no pillar designs them (ADR-0146
 * open question 3).
 */
export const IN_PLACE_OVERLAY_TYPES: readonly string[] = ['view', 'dashboard', 'report'];

/** The member of a served type-registry entry this module reads. */
export interface OverlayTypeEntry {
  type: string;
  allowEnvironmentOverlay?: boolean;
}

/** The members of the layered read this module reads. */
export type OverlayEnvelope = Pick<MetadataLayered, 'code' | 'overlay' | 'editable' | 'deletable' | 'resettable'>;

/**
 * Whether a read-only package's item is edited in place: its type is one the
 * pillar designs ({@link IN_PLACE_OVERLAY_TYPES}), the served registry offers
 * that type an environment overlay, and the item's own envelope has a package
 * baseline to overlay (`code`) and does not refuse the write (`editable`).
 * An envelope not read yet answers `false`: nothing is offered before the
 * server has said the item can take it.
 */
export function editsOverlayInPlace(
  type: string | undefined,
  entries: readonly OverlayTypeEntry[],
  envelope: OverlayEnvelope | null,
): boolean {
  if (!type || !IN_PLACE_OVERLAY_TYPES.includes(type)) return false;
  if (!entries.some((e) => e.type === type && e.allowEnvironmentOverlay === true)) return false;
  return !!envelope && envelope.code != null && envelope.editable !== false;
}

/** "Customized in this environment": the envelope serves an overlay layer (ADR-0146 D2 — presence, never lineage). */
export function isCustomizedHere(envelope: OverlayEnvelope | null): boolean {
  return envelope?.overlay != null;
}

/**
 * The verb the item menu offers for the overlay row, from the envelope's
 * tri-state `resettable` (objectui#4886): `reset` when a package baseline
 * remains behind the overlay, `delete` when the row is the whole entry, and
 * `null` — nothing offered — when there is no overlay, the envelope refuses
 * the removal (`deletable: false`), or the server states no opinion
 * (`resettable` absent). ⛔ An absent verdict is not guessed in the server's
 * name.
 */
export function overlayRemovalVerb(envelope: OverlayEnvelope | null): 'reset' | 'delete' | null {
  if (!isCustomizedHere(envelope) || envelope?.deletable === false) return null;
  if (envelope?.resettable === true) return 'reset';
  if (envelope?.resettable === false) return 'delete';
  return null;
}

/** An item a layered read is asked for. */
export interface OverlayItemRef {
  type: string;
  name: string;
}

/** The key {@link useOverlayEnvelopes} answers by. */
export const overlayItemKey = (item: OverlayItemRef): string => `${item.type}:${item.name}`;

/**
 * The layered read of each item in `items`, keyed by {@link overlayItemKey}:
 * asked while `enabled`, again whenever `nonce` moves (a publish or a reset),
 * and only for the {@link IN_PLACE_OVERLAY_TYPES}. An item whose read failed
 * is absent from the map, as one not read yet is: no fact, no chip. One read
 * per item: no list read serves overlay presence.
 *
 * Keyed on the item keys' text, so a re-created array of the same items asks
 * nothing again (Commandment #10).
 */
export function useOverlayEnvelopes(
  client: Pick<MetadataClient, 'layered'>,
  items: readonly OverlayItemRef[],
  enabled: boolean,
  nonce: number,
): ReadonlyMap<string, OverlayEnvelope> {
  const asked = enabled ? items.filter((i) => IN_PLACE_OVERLAY_TYPES.includes(i.type)) : [];
  const askedKey = [...new Set(asked.map(overlayItemKey))].sort().join('\n');
  const [answer, setAnswer] = React.useState<{ key: string; byItem: ReadonlyMap<string, OverlayEnvelope> }>({
    key: '',
    byItem: new Map(),
  });
  React.useEffect(() => {
    if (!askedKey) return;
    let cancelled = false;
    const refs = askedKey.split('\n').map((k) => {
      const at = k.indexOf(':');
      return { type: k.slice(0, at), name: k.slice(at + 1) };
    });
    void Promise.all(
      refs.map((ref) =>
        client.layered(ref.type, ref.name).then(
          (lay) => [overlayItemKey(ref), lay] as const,
          () => null,
        ),
      ),
    ).then((rows) => {
      if (cancelled) return;
      setAnswer({
        key: `${askedKey}#${nonce}`,
        byItem: new Map(rows.filter((r): r is NonNullable<typeof r> => r !== null)),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [client, askedKey, nonce]);
  // A re-read after `nonce` moved keeps the last answer for the same items
  // until it lands, so the open item does not flip read-only for a beat.
  return askedKey && answer.key.startsWith(`${askedKey}#`) ? answer.byItem : EMPTY;
}

const EMPTY: ReadonlyMap<string, OverlayEnvelope> = new Map();

/**
 * The `type:name` ({@link overlayItemKey}) of every rail item customized in
 * this environment, for the rail rows' chip. Empty off a read-only package.
 */
export const StudioCustomizedItemsContext = React.createContext<ReadonlySet<string>>(new Set());
