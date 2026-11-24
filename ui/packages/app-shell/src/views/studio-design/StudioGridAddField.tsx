// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#34794 — the Records tab's always-visible "Add field": a button at
 * the start of the records grid's own toolbar row (`ListView`'s host prop
 * `toolbarLeading`), opening the Data pillar's `AddFieldPopover` from itself.
 * The grid's trailing "+" column stays; the toolbar entry is the one that is on
 * screen however wide the object is.
 *
 * It draws only where the trailing "+" column draws: the grid's field-authoring
 * context carries `onAddColumn` exactly when the pillar's `canAddFields` holds
 * (not on a read-only package, not on an external object), so the two entries
 * cannot disagree about who may add a field.
 */

import * as React from 'react';
import { useGridFieldAuthoring } from '@object-ui/components';
import { Plus } from 'lucide-react';
import { AddFieldPopover, type AddFieldPopoverProps } from './AddFieldPopover.js';

/** What the toolbar's popover creates with: the pillar's own `addField` inputs. */
export type StudioGridAddFieldValue = Pick<AddFieldPopoverProps, 'onCreate' | 'takenNames' | 'extensionField'>;

const StudioGridAddFieldContext = React.createContext<StudioGridAddFieldValue | null>(null);

/** Provided by the Data pillar around its records grid. */
export const StudioGridAddFieldProvider = StudioGridAddFieldContext.Provider;

/** The toolbar entry; draws nothing outside a pillar that may add a field. */
export function StudioGridAddFieldButton(): React.ReactElement | null {
  const authoring = useGridFieldAuthoring();
  const create = React.useContext(StudioGridAddFieldContext);
  if (!authoring?.onAddColumn || !create) return null;
  const label = authoring.addColumnLabel ?? 'Add field';
  return (
    <AddFieldPopover
      onCreate={create.onCreate}
      takenNames={create.takenNames}
      extensionField={create.extensionField}
      align="start"
    >
      <button
        type="button"
        data-testid="data-records-add-field"
        className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-primary/10 px-2.5 text-xs font-medium text-primary transition-colors hover:bg-primary/15"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden="true" /> {label}
      </button>
    </AddFieldPopover>
  );
}
