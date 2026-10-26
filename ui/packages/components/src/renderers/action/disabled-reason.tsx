/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The reason an action greyed out by its DECLARED `disabled` predicate gives
 * (objectui#11839) — one helper for the four `action:*` renderers beside it
 * (`action:button`, `action:icon`, `action:group`, `action:menu`).
 *
 * The same shape objectui#11811 gave the record header (`page:header`), the
 * section bar (`record:quick_actions`) and `DeclaredActionsBar`, with the same
 * key, `actions.notAvailableForRecord`:
 *
 * - **A button** gets a focusable wrapper `span` as the tooltip trigger. A
 *   natively `disabled` button fires no pointer or focus events, and the
 *   Button primitive adds `disabled:pointer-events-none` on top, so a tooltip
 *   (or a native `title`) on the button itself never opens: the hit target at
 *   its centre is its parent. The span takes the hover, and `tabIndex={0}`
 *   lets a keyboard user focus it, which opens the tooltip too. The reason is
 *   ALSO a persistent accessible description: the button and the span both
 *   point `aria-describedby` at an `sr-only` copy, so a screen reader hears it
 *   with the tooltip closed.
 * - **A menu item** shows the reason as a visible second line under its label,
 *   and that line is the item's description while its name stays the label
 *   (`aria-labelledby`). A tooltip there cannot open: the menu item primitive
 *   adds `data-[disabled]:pointer-events-none`, so the hover lands on the menu,
 *   and the menu's roving focus skips a disabled item, so the keyboard never
 *   reaches it.
 *
 * Which `disabled` earns the reason is each caller's to say, and the answer is
 * the same at all four: only the DECLARED `disabled` predicate, evaluated true.
 * That verdict is a fact about the record. The host's forwarded `disabled` and
 * an execution in flight are the host's own state, and the legacy non-spec
 * `enabled` leg is not the spec key the objectui#11811 surfaces read, so none of
 * them says "not available for this record".
 *
 * Module-private on purpose: nothing here is re-exported from the package
 * entry, so the public surface is unchanged. `containers.tsx`, `app-shell` and
 * `plugin-detail` keep their own copies of the wrapper; sharing one across
 * packages would need an export.
 */

import React from 'react';
import { useSafeTranslate } from '@object-ui/i18n';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../ui';

/** A reason to show, with the ids the control's ARIA attributes point at. */
export interface DisabledReason {
  /** The localized reason text. */
  text: string;
  /** Id of the element holding the reason — the control's description. */
  id: string;
  /** Id of a menu item's label element — the item's name when it shows a reason. */
  labelId: string;
}

/**
 * The reason for a control, or `undefined` when it gives none.
 *
 * `disabledByPredicate` is the caller's DECLARED-`disabled` verdict alone, never
 * the OR it hands the control's `disabled` prop. A hook, so call it with the
 * other hooks, ahead of any early return.
 */
export function useDisabledReason(disabledByPredicate: boolean): DisabledReason | undefined {
  const tt = useSafeTranslate();
  const id = React.useId();
  if (!disabledByPredicate) return undefined;
  return {
    text: tt('actions.notAvailableForRecord', 'Not available for this record'),
    id: `${id}-reason`,
    labelId: `${id}-label`,
  };
}

/**
 * The control's `aria-describedby`: an id it already carries (an authored
 * `ariaDescribedBy` reaches `action:button` and `action:icon` through their DOM
 * pass-through) followed by the reason's, or `undefined` when there is neither.
 */
export function describedByWithReason(
  existing: unknown,
  reason: DisabledReason | undefined,
): string | undefined {
  const ids = [typeof existing === 'string' ? existing : '', reason?.id ?? '']
    .map((id) => id.trim())
    .filter((id) => id !== '');
  return ids.length > 0 ? ids.join(' ') : undefined;
}

/**
 * Wraps a disabled button in the tooltip trigger that carries its reason, or
 * returns the button alone when there is no reason. `heading` is shown above
 * the reason inside the tooltip; `action:icon` passes its label there, since an
 * icon-only control has no visible name and its own label tooltip cannot open
 * while it is disabled.
 */
export function DisabledReasonTrigger({
  reason,
  heading,
  children,
}: {
  reason: DisabledReason | undefined;
  heading?: React.ReactNode;
  children: React.ReactElement;
}): React.ReactElement {
  if (!reason) return children;
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            aria-describedby={reason.id}
            data-disabled-reason=""
            className="inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {children}
            <span id={reason.id} className="sr-only">{reason.text}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {heading ? <p className="font-medium">{heading}</p> : null}
          <p>{reason.text}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** The ARIA a menu item carries while it shows a reason; none otherwise. */
export function menuItemReasonAria(
  reason: DisabledReason | undefined,
): { 'aria-labelledby'?: string; 'aria-describedby'?: string } {
  return reason ? { 'aria-labelledby': reason.labelId, 'aria-describedby': reason.id } : {};
}

/**
 * A menu item's label, with the reason as a visible second line under it when
 * there is one. Pair it with `menuItemReasonAria` on the item.
 */
export function DisabledReasonMenuLabel({
  reason,
  children,
}: {
  reason: DisabledReason | undefined;
  children: React.ReactNode;
}): React.ReactElement {
  if (!reason) return <span>{children}</span>;
  return (
    <span className="flex min-w-0 flex-col">
      <span id={reason.labelId}>{children}</span>
      <span id={reason.id} className="text-xs text-muted-foreground">{reason.text}</span>
    </span>
  );
}
