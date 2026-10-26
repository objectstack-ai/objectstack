// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * What the Studio form designer's drag-and-drop says to a screen reader
 * (objectui#11802).
 *
 * dnd-kit voices every drag through a live region and reads its default
 * sentences to a screen reader on focus and on every drag event. Those
 * defaults name the draggable and the droppable by their ids, in English
 * whatever the locale: the designer's ids are `f:<field>` and `g:<group>`, so
 * an author heard "Draggable item f:name was dropped over droppable area
 * g:new_group". This builds the `accessibility` prop the designer hands its
 * `DndContext` instead. Every sentence names the field and the group by the
 * labels the author sees on the canvas, and the place as "N of M" inside that
 * group. Nothing here moves a field; the designer's drag handlers do that, and
 * the place each sentence names comes from the designer, read when dnd-kit
 * asks.
 *
 * Its own module rather than a function in `ObjectFormDesigner.tsx`, which
 * exports components only (`react-refresh/only-export-components`, the same
 * reason as `formFieldType.ts`). Not on the package entry: Studio-internal.
 */

import type { Announcements, ScreenReaderInstructions, UniqueIdentifier } from '@dnd-kit/core';
import { t, tFormat } from '../metadata-admin/i18n.js';

/** A field's place in one group, in the words the author reads. */
export interface FormDndSlot {
  /** Which group, for comparing two places. Never spoken. */
  container: string;
  /** The group's label, through the resolver the section headers render from. */
  group: string;
  /** 1-based, in the group's field order. */
  position: number;
  /** How many fields the group holds with the dragged field in it. */
  total: number;
}

/** What the announcements read from the designer. */
export interface FormDndLookups {
  /** The field's label, through the resolver the field cards render from. */
  fieldLabel(fieldId: string): string;
  /** Where the field is in the designer's live layout. */
  slotOf(fieldId: string): FormDndSlot | null;
  /** Where a drop of the field on `overId` lands. `null`: the drop moves nothing. */
  dropSlot(fieldId: string, overId: string): FormDndSlot | null;
  /** Where the field is in the draft: where a cancelled or missed drop leaves it. */
  committedSlotOf(fieldId: string): FormDndSlot | null;
}

/** The `accessibility` prop of the designer's `DndContext`. */
export interface FormDndAccessibility {
  announcements: Announcements;
  screenReaderInstructions: ScreenReaderInstructions;
}

const NOT_OVER_A_GROUP = 'not-over-a-group';

export function formDndAccessibility(locale: string, lookups: FormDndLookups): FormDndAccessibility {
  // The last place this drag announced. dnd-kit puts every sentence into the
  // live region at once, replacing the one before. A pointer drag's first
  // `onDragOver` is the field over its own card, the place `onDragStart` has
  // just named; a second sentence about that place would replace the pick-up
  // sentence before a screen reader reads it. Returning `undefined` leaves the
  // region as it is, which dnd-kit's `Announcements` contract allows. The
  // designer rebuilds this object when its layout or labels change, which
  // drops the memory; that costs at most one repeated sentence, and every
  // sentence stays true without it.
  let lastPlace: string | undefined;
  const placeOf = (slot: FormDndSlot) => JSON.stringify([slot.container, slot.position, slot.total]);
  const say = (key: string, field: string, slot: FormDndSlot) =>
    tFormat(key, locale, { field, group: slot.group, position: slot.position, total: slot.total });
  const idOf = (id: UniqueIdentifier) => String(id);

  return {
    screenReaderInstructions: { draggable: t('engine.studio.formDnd.instructions', locale) },
    announcements: {
      onDragStart({ active }) {
        const slot = lookups.slotOf(idOf(active.id));
        lastPlace = slot ? placeOf(slot) : undefined;
        return slot ? say('engine.studio.formDnd.start', lookups.fieldLabel(idOf(active.id)), slot) : undefined;
      },
      onDragOver({ active, over }) {
        const field = lookups.fieldLabel(idOf(active.id));
        const slot = over ? lookups.dropSlot(idOf(active.id), idOf(over.id)) : null;
        const place = slot ? placeOf(slot) : NOT_OVER_A_GROUP;
        if (place === lastPlace) return undefined;
        lastPlace = place;
        return slot
          ? say('engine.studio.formDnd.over', field, slot)
          : tFormat('engine.studio.formDnd.overNone', locale, { field });
      },
      onDragEnd({ active, over }) {
        lastPlace = undefined;
        const field = lookups.fieldLabel(idOf(active.id));
        const slot = over ? lookups.dropSlot(idOf(active.id), idOf(over.id)) : null;
        if (slot) return say('engine.studio.formDnd.end', field, slot);
        const home = lookups.committedSlotOf(idOf(active.id));
        return home ? say('engine.studio.formDnd.endNone', field, home) : undefined;
      },
      onDragCancel({ active }) {
        lastPlace = undefined;
        const home = lookups.committedSlotOf(idOf(active.id));
        return home ? say('engine.studio.formDnd.cancel', lookups.fieldLabel(idOf(active.id)), home) : undefined;
      },
    },
  };
}
