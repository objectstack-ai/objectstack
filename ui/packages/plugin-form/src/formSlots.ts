/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Form slots: a place in a header form's layout where its HOST draws something
 * the form does not own (objectstack#35889).
 *
 * The one producer is `MasterDetailForm`: a child collection a field group of
 * the parent places (`fieldGroups[].relatedList`, the spec's
 * `fieldGroupsPlaceRelationship` reading) is drawn at that group's position in
 * the parent's form, as the record page draws the same table at the same
 * group (`bodyTablePlacement` in `@object-ui/plugin-detail`). The header form
 * draws an empty `form-slot` row there; the host renders the collection into
 * that row's element through a portal, so the collection stays out of the
 * header's React tree (a header keystroke never re-renders the lines, and the
 * lines never re-render the header, #1581).
 *
 * Both halves are runtime-only hand-off state, typed here where producer and
 * consumer live and never on the `ObjectFormSchema` authoring face (ui
 * AGENTS.md #0.1).
 */

import { fieldGroupsPlaceRelationship } from '@objectstack/spec/data';
import type { FormField } from '@object-ui/types';

/** The row type the form renderer draws as an empty slot element. */
export const FORM_SLOT_ROW_TYPE = 'form-slot';

/** One collection the host asks the form to place. */
export interface FormSlotRequest {
  /** The host's stable identity of the collection (a detail entry id). */
  id: string;
  /** The child object the collection lists. */
  childObject: string;
  /** The child's FK to the parent; absent, only a bare child-name group places it. */
  relationshipField?: string;
}

/**
 * Where the form reports what it placed. `refFor(id)` is the element callback
 * of one slot row; `claim(ids)` names every slot the drawn layout carries, and
 * is called once per drawn layout (`[]` when it places none), never while the
 * form is still loading — so a remounting header keeps the previous claim and
 * the collections do not jump below the form and back.
 *
 * `refusedKey()` names the collections the last refused save was refused on
 * (one id per line, `''` for none), and `subscribe` tells a layout that it
 * moved: a tabbed form marks the tab that holds such a collection, as it
 * marks the tab of a refused field.
 */
export interface FormSlotHost {
  refFor(id: string): (el: HTMLElement | null) => void;
  claim(ids: readonly string[]): void;
  refusedKey(): string;
  subscribe(listener: () => void): () => void;
}

/** The hand-off key a host sets on the header form's schema. */
export interface FormSlotHandoff {
  formSlots?: { requests: readonly FormSlotRequest[]; host: FormSlotHost };
}

/**
 * The index, among the object's declared `fieldGroups`, of the first group
 * whose `relatedList` names this collection; `null` when none does.
 */
export function formSlotGroupIndex(fieldGroups: unknown, request: FormSlotRequest): number | null {
  if (!Array.isArray(fieldGroups)) return null;
  const index = fieldGroups.findIndex((group) =>
    fieldGroupsPlaceRelationship([group], request.childObject, request.relationshipField ?? ''),
  );
  return index === -1 ? null : index;
}

/**
 * The declared group that places this collection (its key and authored
 * label), the name a form gives the collection's place; `null` when none does.
 */
export function formSlotGroup(fieldGroups: unknown, request: FormSlotRequest): { key: string; label?: string } | null {
  const index = formSlotGroupIndex(fieldGroups, request);
  const group = index === null ? undefined : (fieldGroups as Array<{ key?: unknown; label?: unknown }>)[index];
  if (typeof group?.key !== 'string') return null;
  return { key: group.key, label: typeof group.label === 'string' ? group.label : undefined };
}

export type FormSlotSequenceItem<S> = { section: S } | { slot: FormSlotRequest };

/**
 * Lay a form's sections and the placed collections out in one sequence, by
 * the record page's rule (`bodyTablePlacement`): a collection a group places
 * comes after the sections of the groups declared before that group and
 * before those declared after it; a section that names no declared group (the
 * ungrouped bucket, an authored section of its own) counts as after every
 * group. Sections keep their order; collections at one position keep the
 * request order.
 *
 * A layout none of whose sections names a declared group has no position to
 * give, so it places nothing and every collection stays where the host draws
 * it. `placed` lists the ids placed.
 */
export function placeFormSlots<S>(
  sections: readonly S[],
  sectionGroupKey: (section: S) => string | undefined,
  fieldGroups: unknown,
  requests: readonly FormSlotRequest[] | undefined,
): { sequence: FormSlotSequenceItem<S>[]; placed: string[] } {
  const plain = { sequence: sections.map((section) => ({ section })), placed: [] as string[] };
  if (!requests?.length || !Array.isArray(fieldGroups)) return plain;
  const groupIndex = new Map<string, number>();
  fieldGroups.forEach((group, index) => {
    const key = group && typeof group === 'object' ? (group as { key?: unknown }).key : undefined;
    if (typeof key === 'string' && !groupIndex.has(key)) groupIndex.set(key, index);
  });
  const indexOf = (section: S): number => {
    const key = sectionGroupKey(section);
    return (key !== undefined ? groupIndex.get(key) : undefined) ?? Number.POSITIVE_INFINITY;
  };
  if (!sections.some((section) => Number.isFinite(indexOf(section)))) return plain;

  const slots = requests
    .map((slot, order) => ({ slot, order, at: formSlotGroupIndex(fieldGroups, slot) }))
    .filter((s): s is { slot: FormSlotRequest; order: number; at: number } => s.at !== null)
    .sort((a, b) => a.at - b.at || a.order - b.order);
  if (slots.length === 0) return plain;

  const sequence: FormSlotSequenceItem<S>[] = [];
  let next = 0;
  for (const section of sections) {
    const at = indexOf(section);
    while (next < slots.length && slots[next].at < at) sequence.push({ slot: slots[next++].slot });
    sequence.push({ section });
  }
  while (next < slots.length) sequence.push({ slot: slots[next++].slot });
  return { sequence, placed: slots.map((s) => s.slot.id) };
}

/**
 * The form row of one slot. `slotRef` is the host's element callback, read
 * by the form renderer's `form-slot` branch; like a divider row's `onToggle`
 * it is written by the host and never authored, so it stays off `FormField`.
 */
export type FormSlotRow = FormField & {
  slotRef: (el: HTMLElement | null) => void;
  /** The last save was refused on this collection: its tab is marked. */
  slotRefused?: true;
};

/**
 * The row a placed collection takes in the header form's field list. A
 * `label` (its group's) makes the row a stop of the form's section
 * navigation, between the headings it sits between.
 */
export function formSlotRow(request: FormSlotRequest, host: FormSlotHost, label = ''): FormSlotRow {
  const refused = host.refusedKey().split('\n').includes(request.id);
  return {
    name: `__form_slot__${request.id}`,
    label,
    type: FORM_SLOT_ROW_TYPE,
    slotRef: host.refFor(request.id),
    ...(refused ? { slotRefused: true } : {}),
  } as FormSlotRow;
}

/**
 * The host half: the slot elements the header form has mounted and the ids
 * its drawn layout claims, for `useSyncExternalStore`. One instance per host,
 * held in a ref, so `refFor` hands out one callback per id for the store's
 * lifetime.
 */
export class FormSlotStore implements FormSlotHost {
  private readonly elements = new Map<string, HTMLElement>();
  private readonly refs = new Map<string, (el: HTMLElement | null) => void>();
  private claimed: ReadonlySet<string> | null = null;
  private refused = '';
  private readonly listeners = new Set<() => void>();
  private version = 0;

  refFor(id: string): (el: HTMLElement | null) => void {
    let ref = this.refs.get(id);
    if (!ref) {
      ref = (el) => {
        if (el ? this.elements.get(id) === el : !this.elements.has(id)) return;
        if (el) this.elements.set(id, el);
        else this.elements.delete(id);
        this.emit();
      };
      this.refs.set(id, ref);
    }
    return ref;
  }

  claim(ids: readonly string[]): void {
    const prev = this.claimed;
    if (prev && prev.size === ids.length && ids.every((id) => prev.has(id))) return;
    this.claimed = new Set(ids);
    this.emit();
  }

  /**
   * The collections the last refused save was refused on; `[]` when a save
   * gets past validation, so a mark lasts exactly as long as a refused
   * field's.
   */
  refuse(ids: readonly string[]): void {
    const key = [...new Set(ids)].sort().join('\n');
    if (key === this.refused) return;
    this.refused = key;
    this.emit();
  }

  refusedKey = (): string => this.refused;

  /**
   * Where the host draws collection `id`: `'inline'` (no layout has claimed
   * it: in the host's own place), the slot element, or `null` (claimed, its
   * element not mounted this moment: drawn nowhere until it is).
   */
  placement(id: string): 'inline' | HTMLElement | null {
    if (!this.claimed?.has(id)) return 'inline';
    return this.elements.get(id) ?? null;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getVersion = (): number => this.version;

  private emit(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }
}
