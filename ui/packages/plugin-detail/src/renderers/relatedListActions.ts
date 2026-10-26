/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `record:related_list.actions` — where an authored action id lands on the list,
 * or why it is refused (objectui#11163; the maintainer's ENFORCE ruling on
 * objectstack-ai/objectstack#20665).
 *
 * The contract declares the key as `z.array(z.string())`, "Action IDs available
 * for related records". This module is the whole of its meaning, kept apart
 * from the renderer so the file that draws the block keeps exporting
 * components only:
 *
 *   - RESOLUTION is `resolveDeclaredActionIds` — the one function
 *     `page:header`, `record:quick_actions` and `record:alert` resolve an
 *     authored action id through (objectui#7182, objectui#7382) — against the
 *     RELATED object's registered `actions`. ⛔ No second lookup: the caller
 *     reads that registry through `useMetadataItem('object', …)`, the same
 *     entry `record:quick_actions.actionNames` uses.
 *   - Only the IDS arm is this key's. The inline-object arm of the shared
 *     rule is `page:header`'s transition tolerance (objectstack#11592) and is
 *     not inherited here, the choice `record:alert` made for its CTA: an
 *     object in this array would widen what a related list can run past what
 *     the object declares.
 *   - PLACEMENT is each action's own `locations`, read by `actionRendersAt`
 *     — the platform's one placement rule, and the rule the host bridge
 *     (`RelatedRecordActionsBridge.deriveActions`) already applies to this
 *     list: `list_toolbar` draws a header button; `list_item` and
 *     `record_related` draw a row-menu item (objectui#11270). This block only
 *     ever renders inside a parent record, which is the scope `record_related`
 *     names (objectstack-ai/objectstack#20937, triage `5919625056`: row
 *     placement, inside a record only). Naming an action here does not bypass
 *     location filtering (only a list view's selection bar is placed by
 *     naming), so an id whose action declares none of the three is REFUSED
 *     rather than drawn somewhere or dropped.
 *   - ORDER is the author's, within each surface.
 */

import { actionRendersAt, resolveDeclaredActionIds } from '@object-ui/types';

/**
 * An action definition as the registry holds it — the two members read here,
 * typed `unknown` because the definitions arrive straight off the metadata
 * wire (the reason `actionRendersAt` gives for its own parameter).
 */
export interface RegisteredRelatedAction {
  readonly name?: unknown;
  readonly locations?: unknown;
}

/** One reason an authored entry does not render, stated for the author. */
export type RelatedListActionRefusal =
  /** The array itself is refused: not an array, or not all action ids. */
  | { readonly kind: 'array'; readonly message: string }
  /** An id that names no registered action of the related object. */
  | { readonly kind: 'unresolved'; readonly id: string }
  /** An id that resolves, to an action declaring no location this list renders. */
  | { readonly kind: 'unplaced'; readonly id: string };

export interface PlacedRelatedListActions<T> {
  /** `list_toolbar` actions, in authored order — the list's header buttons. */
  readonly toolbar: T[];
  /** `list_item` and `record_related` actions, in authored order — each row's menu. */
  readonly row: T[];
  /** Every authored entry that renders nowhere, and why. */
  readonly refused: RelatedListActionRefusal[];
}

const NOTHING_PLACED = <T>(refused: RelatedListActionRefusal[]): PlacedRelatedListActions<T> => ({
  toolbar: [],
  row: [],
  refused,
});

/**
 * Whether an authored value has any id to look up — the registry-independent
 * half of the shared rule, so the caller requests the metadata read only when
 * it can change the answer (a `[]`, an object array or a refused array is
 * decided without it).
 */
export function relatedListActionsNeedLookup(authored: unknown): boolean {
  if (!Array.isArray(authored)) return false;
  const shape = resolveDeclaredActionIds(authored, undefined);
  return shape.kind === 'ids' && shape.ids.length > 0;
}

/**
 * Resolve and place an authored `record:related_list.actions` value.
 *
 * `registered` is the related object's `actions` once the metadata lookup has
 * ANSWERED. The caller does not call this while the lookup is in flight: every
 * id would come back unresolved and the list would refuse an id it is about to
 * resolve.
 *
 * An id authored twice renders once, at its first position — it is drawn, so
 * nothing the author asked for is dropped.
 */
export function placeAuthoredRelatedListActions<T extends RegisteredRelatedAction>(
  authored: unknown,
  registered: readonly T[] | null | undefined,
): PlacedRelatedListActions<T> {
  if (!Array.isArray(authored)) {
    return NOTHING_PLACED([
      { kind: 'array', message: '`actions` is not an array; it is a list of action ids' },
    ]);
  }
  const declared = resolveDeclaredActionIds<T>(authored, registered);
  if (declared.kind === 'refused') {
    return NOTHING_PLACED([
      { kind: 'array', message: `${declared.message} (on this block: action ids only)` },
    ]);
  }
  if (declared.kind === 'objects') {
    // `[]` classifies here too, and it is the author's choice of no actions.
    return authored.length === 0
      ? NOTHING_PLACED([])
      : NOTHING_PLACED([
          {
            kind: 'array',
            message:
              '`actions` holds inline action objects; it is a list of action ids, each the ' +
              "`name` of an action declared on the related object's own `actions`",
          },
        ]);
  }

  const toolbar: T[] = [];
  const row: T[] = [];
  const refused: RelatedListActionRefusal[] = declared.unresolved.map(({ id }) => ({
    kind: 'unresolved' as const,
    id,
  }));
  const seen = new Set<unknown>();
  for (const action of declared.actions) {
    if (seen.has(action.name)) continue;
    seen.add(action.name);
    const placement = { locations: Array.isArray(action.locations) ? action.locations : undefined };
    const onToolbar = actionRendersAt(placement, 'list_toolbar');
    const onRow =
      actionRendersAt(placement, 'list_item') || actionRendersAt(placement, 'record_related');
    if (onToolbar) toolbar.push(action);
    if (onRow) row.push(action);
    if (!onToolbar && !onRow) refused.push({ kind: 'unplaced', id: String(action.name) });
  }
  return { toolbar, row, refused };
}

/**
 * The refusal notice's text — one sentence per refused entry, naming it and
 * the related object, so the fix is a one-entry edit.
 *
 * `objectKnown` is whether the lookup found the related object at all: an id
 * cannot be "not an action of" an object whose metadata never arrived.
 */
export function describeRelatedListActionRefusals(
  refused: readonly RelatedListActionRefusal[],
  objectName: string,
  objectKnown: boolean,
): string {
  const parts = refused.map((r) => {
    if (r.kind === 'array') return r.message;
    if (r.kind === 'unplaced') {
      return (
        `"${r.id}" declares none of list_toolbar (header), list_item (row menu) or ` +
        'record_related (row menu inside a record) in its locations, so this list has ' +
        'nowhere to draw it'
      );
    }
    return objectKnown
      ? `"${r.id}" is not an action of "${objectName}"`
      : `"${r.id}" could not be resolved: no metadata for "${objectName}" was found`;
  });
  return `record:related_list — actions refused: ${parts.join('; ')}.`;
}
