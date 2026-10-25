/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { withoutDeniedFields } from '@object-ui/core';

/**
 * The owner a card shows as an avatar (objectui#12619).
 *
 * Written by `ObjectKanban` onto the card it hands the board as `cardOwner`,
 * read by `KanbanImpl`. A package-local hand-off: no caller outside this
 * package writes it, so it is typed here, where both ends live, and not on the
 * published `KanbanCard`.
 */
export interface KanbanCardOwner {
  /** The person's name: the avatar's tooltip, its accessible name and its initials. */
  name: string;
  /** The person's picture, when the viewer may read it. */
  image?: string;
}

/** What a field-level policy answers, as `withoutDeniedFields` reads it. */
type FieldPolicy = Parameters<typeof withoutDeniedFields>[1];

/**
 * The owner of one record, read off its owner field's EXPANDED value.
 *
 * A bare id is a reference this board did not resolve, so it draws no avatar
 * rather than a face for an id. The person is drawn as the viewer may read
 * them: fields the policy denies on the person's object are removed first, the
 * way the grid's user cell removes them. A person with no name draws nothing.
 */
export function resolveCardOwner(
  value: unknown,
  policy: FieldPolicy,
  personObject: string,
): KanbanCardOwner | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const person = withoutDeniedFields(value as Record<string, unknown>, policy, personObject) as Record<string, unknown>;
  const rawName = person.name ?? person.username;
  const name = typeof rawName === 'string' ? rawName.trim() : '';
  if (!name) return undefined;
  const image = typeof person.image === 'string' && person.image ? person.image : undefined;
  return image ? { name, image } : { name };
}

/** Up to two initials of a name, for the avatar with no picture. */
export function ownerInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}
