// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The design surface's own picker. Moved out of `StudioNavItemInspector.tsx`
 * unchanged when objectstack#36502 retired the Interfaces pillar, whose nav-item
 * inspector was its other caller: the *New object* and *New automation*
 * dialogs still pick with it.
 */

import * as React from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@object-ui/components';

/** The item value of a stored value none of the options carries. */
const OUTSIDE_OPTIONS = 'outside';

/**
 * objectui#11865 — one of the design surface's own pickers, drawn with the
 * shared `Select`, the control the rest of Studio picks with: the record
 * sharing and trigger pickers of the *New object* and *New automation*
 * dialogs (and, until objectstack#36502, the Interfaces nav-item inspector's
 * object, target and *Open in* pickers). They
 * used to be browser-native select elements. What a pick writes is unchanged:
 * `onPick` receives the picked option's own `value`, the string the native
 * control's `change` carried, and re-picking the current option writes
 * nothing, as it did there.
 *
 * - Items carry their option's INDEX, not its value. The trigger picker opens
 *   on an option whose value is `''` ("Choose later on the Start node"),
 *   which `SelectItem` refuses; an index cannot collide with a real value, as
 *   any stand-in string could.
 * - A value none of the options carries gets an item of its own, labelled
 *   with the value, so the trigger shows what the entry holds. The native
 *   control showed its first option there.
 *   Picking that item writes nothing.
 * - Read-only has no state here: a read-only package offers neither *New*
 *   entry, so neither dialog opens there.
 * - Each caller keeps the name its native control had: a `<label htmlFor>`
 *   names the trigger by `id`, and a wrapping `<label>` names it as it named
 *   the native control.
 */
export function StudioPicker({
  id,
  value,
  options,
  onPick,
  className,
  testId,
}: {
  id?: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onPick: (value: string) => void;
  className: string;
  testId?: string;
}): React.ReactElement {
  const at = options.findIndex((o) => o.value === value);
  const outside = at === -1 && value !== '';
  return (
    <Select
      value={at !== -1 ? String(at) : outside ? OUTSIDE_OPTIONS : ''}
      onValueChange={(token) => {
        // `undefined` for the outside item: it is the stored value, so there is nothing to write.
        const picked = options[Number(token)];
        if (picked) onPick(picked.value);
      }}
    >
      <SelectTrigger id={id} data-testid={testId} className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {outside && <SelectItem value={OUTSIDE_OPTIONS}>{value}</SelectItem>}
        {options.map((o, i) => (
          <SelectItem key={`${i}:${o.value}`} value={String(i)}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
