// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The panel behind the design mode's 「Header buttons」 (objectstack#36366),
 * loaded only once the mode is on (`DesignModeHeaderPins.tsx` loads it
 * lazily): a scope's actions in two parts, 「Pinned to header」 (at most
 * three) and 「Other」 (the header's 「More」 menu), each dragged into order.
 * A dot beside each action moves it between the two; pinning a fourth is
 * refused with a toast and changes nothing. A name the object's arrangement
 * sets that the scope no longer offers is listed as left out.
 *
 * The change is staged under the object's key (`pinsChangeKey`), both scopes
 * in one value, each arm written whole (`{ pinned, more }`), and the mode's
 * 「Save」 writes it (`designModeHeaderPinsSave.ts`); 「Cancel」 drops it.
 *
 * @module
 */

import * as React from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Circle, CircleDot, GripVertical, PanelTop } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Popover, PopoverContent, PopoverTrigger, cn } from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import { useMetadataClient } from '../views/metadata-admin/useMetadata.js';
import { useDesignModeChange } from './designMode.js';
import {
  PIN_LIMIT,
  movePin,
  pinCandidates,
  pinsChangeKey,
  servedPins,
  shownArrangement,
  staleNames,
  togglePin,
  type ObjectPins,
  type ShownArrangement,
} from './designModeHeaderPins.js';
import { consoleObjectPinsDoors, saveObjectPins } from './designModeHeaderPinsSave.js';
import type { DesignModeHeaderPinsProps } from './DesignModeHeaderPins.js';

/** Both scopes of `pins` as one comparable string, whatever order its keys were set in. */
function pinsKey(pins: ObjectPins): string {
  return JSON.stringify([pins.list ?? null, pins.record ?? null]);
}

export default function HeaderPinsPanel({ objectDef, page, actions, builtins = [] }: DesignModeHeaderPinsProps) {
  const { t } = useObjectTranslation();
  const client = useMetadataClient();
  const objectName = typeof objectDef.name === 'string' ? objectDef.name : '';
  const packageId = typeof objectDef._packageId === 'string' ? objectDef._packageId : '';
  const change = useDesignModeChange<ObjectPins>(pinsChangeKey(objectName));
  const served = React.useMemo(() => servedPins(objectDef), [objectDef]);
  const current = change.value ?? served;
  const candidates = React.useMemo(() => pinCandidates(actions as never, page, builtins), [actions, page, builtins]);
  const shown = shownArrangement(current, page, actions as never, candidates);
  const stale = staleNames(current, page, candidates);
  const labelOf = React.useCallback(
    (id: string) => candidates.find((c) => c.id === id)?.label ?? id,
    [candidates],
  );
  const { pinned, more } = shown;

  const texts = React.useMemo(
    () => ({
      notListed: t('designMode.pins.notListed', {
        defaultValue: "This object's package is not listed, so its header buttons cannot be saved.",
      }),
      pendingDraft: t('designMode.pins.pendingDraft', {
        defaultValue: 'This object has unpublished changes in Studio. Publish or discard them there, then save again.',
      }),
      unknown: (name: string) =>
        t('designMode.pins.unknown', { name, defaultValue: '"{{name}}" is no longer an action of this object. Unpin it, then save again.' }),
      notPlaced: (name: string) =>
        t('designMode.pins.notPlaced', { name, defaultValue: '"{{name}}" is no longer offered on this page. Unpin it, then save again.' }),
    }),
    [t],
  );
  const stage = change.stage;
  const unstage = change.unstage;
  const update = React.useCallback(
    (nextShown: ShownArrangement) => {
      // An arrangement that draws as the served one does is the served arm
      // (or none), so moving back stages nothing.
      const servedShown = shownArrangement(served, page, actions as never, candidates);
      const asServed = JSON.stringify(servedShown) === JSON.stringify(nextShown);
      const { [page]: _dropped, ...otherScope } = current;
      const next: ObjectPins = asServed
        ? { ...otherScope, ...(served[page] ? { [page]: served[page] } : {}) }
        : { ...current, [page]: { pinned: nextShown.pinned, more: nextShown.more } };
      if (pinsKey(next) === pinsKey(served)) {
        unstage();
        return;
      }
      stage(next, (value) =>
        saveObjectPins({ objectName, packageId, served: objectDef, pins: value }, texts, consoleObjectPinsDoors(client as never)),
      );
    },
    [current, page, served, actions, candidates, stage, unstage, objectName, packageId, objectDef, texts, client],
  );

  const toggle = (id: string) => {
    const next = togglePin(shown, id);
    if (next === null) {
      toast.info(
        t('designMode.pins.full', {
          cap: PIN_LIMIT,
          defaultValue: 'At most {{cap}} buttons are pinned to the header. Unpin one first.',
        }),
      );
      return;
    }
    update(next);
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  // One list per part: a drag reorders within its own part; the dot moves
  // between them.
  const onDragEnd = (part: 'pinned' | 'more') => (event: DragEndEvent) => {
    const list = shown[part];
    const from = list.indexOf(String(event.active.id));
    const to = event.over ? list.indexOf(String(event.over.id)) : -1;
    if (from < 0 || to < 0 || from === to) return;
    update({ ...shown, [part]: movePin(list, from, to) });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="shadow-none h-7 gap-1 px-2 text-sm font-normal border-dashed"
          data-testid="design-header-pins"
        >
          <PanelTop className="h-3.5 w-3.5" />
          <span>{t('designMode.pins.button', { defaultValue: 'Header buttons' })}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0" data-testid="design-header-pins-panel">
        <section className="p-2" data-testid="design-header-pins-pinned">
          <h3 className="flex items-center justify-between px-2 py-1 text-xs font-medium text-muted-foreground">
            <span>{t('designMode.pins.pinned', { defaultValue: 'Pinned to header' })}</span>
            <span>{`${pinned.length}/${PIN_LIMIT}`}</span>
          </h3>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd('pinned')}>
            <SortableContext items={pinned} strategy={verticalListSortingStrategy}>
              <ul>
                {pinned.map((id) => (
                  <ArrangedRow key={id} id={id} label={labelOf(id)} pinned onToggle={() => toggle(id)} t={t} />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
          {pinned.length === 0 && (
            <p className="px-2 py-1 text-xs text-muted-foreground">
              {t('designMode.pins.nonePinned', { defaultValue: 'No button is pinned: every action is in More.' })}
            </p>
          )}
        </section>
        <section className="border-t p-2" data-testid="design-header-pins-other">
          <h3 className="px-2 py-1 text-xs font-medium text-muted-foreground">
            {t('designMode.pins.other', { defaultValue: 'Other' })}
          </h3>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd('more')}>
            <SortableContext items={more} strategy={verticalListSortingStrategy}>
              <ul>
                {more.map((id) => (
                  <ArrangedRow key={id} id={id} label={labelOf(id)} pinned={false} onToggle={() => toggle(id)} t={t} />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
          {more.length === 0 && (
            <p className="px-2 py-1 text-xs text-muted-foreground">
              {t('designMode.pins.noneOther', { defaultValue: 'Every action is pinned.' })}
            </p>
          )}
        </section>
        {stale.length > 0 && (
          <p className="border-t px-4 py-2 text-xs text-muted-foreground" data-testid="design-header-pins-stale">
            {t('designMode.pins.stale', {
              names: stale.join(', '),
              defaultValue: 'No longer offered here, left out when you save: {{names}}',
            })}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}

function ArrangedRow({
  id,
  label,
  pinned,
  onToggle,
  t,
}: {
  id: string;
  label: string;
  pinned: boolean;
  onToggle: () => void;
  t: ReturnType<typeof useObjectTranslation>['t'];
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent', isDragging && 'opacity-60')}
      data-testid={`design-header-pin-${id}`}
    >
      <button
        type="button"
        className="cursor-grab text-muted-foreground"
        aria-label={t('designMode.pins.drag', { name: label, defaultValue: 'Drag {{name}} to reorder' })}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <button
        type="button"
        className={cn('rounded p-0.5 hover:text-foreground', pinned ? 'text-primary' : 'text-muted-foreground')}
        aria-label={
          pinned
            ? t('designMode.pins.unpin', { name: label, defaultValue: 'Move {{name}} to More' })
            : t('designMode.pins.pin', { name: label, defaultValue: 'Pin {{name}} to the header' })
        }
        onClick={onToggle}
        data-testid="design-header-pin-toggle"
      >
        {pinned ? <CircleDot className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
      </button>
    </li>
  );
}
