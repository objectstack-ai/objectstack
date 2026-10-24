/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * action:group — Toolbar or button group for organizing related actions.
 *
 * Supports two display modes:
 * - 'inline': Renders all actions as a horizontal button row
 * - 'dropdown': Renders a primary button + dropdown for overflow
 *
 * Filters actions by location when `location` prop is provided.
 */

import React, { forwardRef, useCallback, useState } from 'react';
import { ComponentRegistry } from '@object-ui/core';
import type { ActionDef } from '@object-ui/core';
import type { UIActionSchema, ActionLocation } from '@object-ui/types';
import { ACTION_LOCATIONS, actionRendersAt } from '@object-ui/types';
import { useAction } from '@object-ui/react';
import { useCondition, toPredicateInput, usePredicateRecordContext } from '@object-ui/react';
import { Button } from '../../ui';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../ui';
import { cn } from '../../lib/utils';
import { Loader2, ChevronDown } from 'lucide-react';
import { resolveIcon } from './resolve-icon';
import { hasDeclaredVisibilityGate } from './visibility-gate';
import { readActionEntryParamValues } from './static-params';
import {
  DisabledReasonMenuLabel,
  DisabledReasonTrigger,
  menuItemReasonAria,
  useDisabledReason,
} from './disabled-reason';

// No group-level `name` (objectui#11168): nothing renders, forwards or keys on
// it, and `@objectstack/spec` refuses it on this block, so the registration
// below stopped publishing it. Each MEMBER's own `name` is what identifies it.
export interface ActionGroupSchema {
  type: 'action:group';
  /** Group label */
  label?: string;
  /** Group icon */
  icon?: string;
  /** Actions in this group */
  actions?: UIActionSchema[];
  /** Display mode: inline button row or dropdown */
  display?: 'dropdown' | 'inline';
  /** Filter actions by location */
  location?: ActionLocation;
  /** Group visibility predicate: a boolean, a CEL string, or a `{ dialect, source }` envelope */
  visible?: boolean | string | { dialect: string; source?: string };
  /** Button variant for inline actions */
  variant?: string;
  /** Button size for inline actions */
  size?: string;
  /** Custom CSS class */
  className?: string;
  [key: string]: any;
}

/**
 * One member's `visible` verdict — shared by both display modes' leaves, so the
 * same member cannot be hidden in one mode and shown in the other.
 *
 * It fails CLOSED on a predicate that FAULTS (`throwOnError`), the policy
 * `action:button`, `action:menu` and `action:bar` already apply to `visible`
 * (objectui#11212, Rider 1 of objectui#4421): a precondition that cannot be
 * evaluated hides the action rather than showing one whose guard is broken, and
 * the fault is reported once, naming the action. It is the KEY's policy, not a
 * special case for any one call: `current_user.can(…)` while the permissions
 * payload has not loaded and an unbound root (`nope.x == 1`) both hide. These
 * leaves used to fail SOFT to `true`, SHOWING an action whose gate could not be
 * answered. Pinned three-state in `app-shell`'s
 * `currentUserCan-failClosed-11212.render.test.tsx`.
 */
function useMemberVisible(action: UIActionSchema, recordData: Record<string, unknown>): boolean {
  return useCondition(toPredicateInput(action.visible), recordData, {
    throwOnError: true,
    label: `action "${action.name ?? action.label ?? 'action:group member'}" (visible)`,
  });
}

/**
 * Inline action button within a group.
 */
const InlineActionButton: React.FC<{
  action: UIActionSchema;
  variant?: string;
  size?: string;
  onExecute: (action: UIActionSchema) => Promise<void>;
  /** The row the group is mounted over — see `DropdownActionItem` (objectui#4075). */
  record?: unknown;
  /**
   * The GROUP's host-evaluated enablement verdict, which the group takes by
   * name and hands to every member it draws (objectui#11182). A group-level
   * `disabled` has no control of its own to land on in inline mode — the
   * wrapper is a `div` — so the members are what it disables.
   */
  hostDisabled?: boolean;
}> = ({ action, variant, size, onExecute, record, hostDisabled }) => {
  const [loading, setLoading] = useState(false);
  // The row bound the three canonical ways — `record.status`, bare `status`,
  // `data.status`. This leaf used to evaluate against nothing at all, so a
  // row-scoped predicate faulted on its root (objectui#4075).
  const recordData = usePredicateRecordContext(record);
  // `visible` fails CLOSED on a predicate that faults, as on `action:button` and
  // `action:menu` (objectui#11212): one fault policy per key on every action
  // `visible` leg. See `useMemberVisible`.
  const isVisible = useMemberVisible(action, recordData);
  // Spec field is `disabled` (boolean | CEL — disabled when TRUE). objectstack-ai/objectstack#1885 wired
  // it in action-button only; this leaf kept reading the legacy non-spec
  // `enabled`, so a spec-authored `disabled` guard did nothing here. `disabled`
  // is now the primary control; `enabled` stays as a deprecated fallback.
  const isDisabledPred = useCondition(toPredicateInput((action as any).disabled), recordData);
  const isEnabled = useCondition(toPredicateInput(action.enabled), recordData);
  // The reason a greyed-out member gives (objectui#11839): only its DECLARED
  // `disabled` predicate, evaluated true. The group's `hostDisabled` and this
  // member's `loading` disable it without one. See `./disabled-reason`.
  const disabledReason = useDisabledReason(
    hasDeclaredVisibilityGate(action.disabled) && isDisabledPred,
  );

  const Icon = resolveIcon(action.icon);
  const btnVariant = (action.variant as string) === 'primary' ? 'default' : (action.variant || variant || 'outline');
  const btnSize = action.size === 'md' ? 'default' : (action.size || size || 'sm');

  const handleClick = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      await onExecute(action);
    } finally {
      setLoading(false);
    }
  }, [action, onExecute, loading]);

  // A DECLARED gate decides; truthiness would read `visible: false` as ungated
  // and render it (objectui#3812) — see `hasDeclaredVisibilityGate`.
  if (hasDeclaredVisibilityGate(action.visible) && !isVisible) return null;

  const button = (
    <Button
      type="button"
      variant={btnVariant as any}
      size={btnSize as any}
      className={action.className}
      // Is a `disabled` / `enabled` gate DECLARED? Same question as the
      // `visible` gate above, so it reads the same definition (historic name
      // kept, not aliased — objectui#3842 ruling, applied here by #3849). On
      // this key `!= null` alone was a live defect: an empty predicate reaches
      // the evaluation entry as "no condition → true", which means DISABLE
      // here, so `disabled: ''` greyed the button out forever. The legacy
      // `enabled` leg is negated and therefore behaviour-preserving under the
      // same definition — derivation in
      // `__tests__/action-disabled-declared-gate.test.tsx`.
      //
      // `hostDisabled` leads the OR (objectui#9131, applied to the group by
      // objectui#11182): the group's host verdict is a reason to disable,
      // never a reason to enable. See `action:button`.
      disabled={hostDisabled || (
        hasDeclaredVisibilityGate((action as any).disabled)
          ? isDisabledPred
          : hasDeclaredVisibilityGate(action.enabled)
            ? !isEnabled
            : false
      ) || loading}
      aria-describedby={disabledReason?.id}
      onClick={handleClick}
    >
      {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      {/* eslint-disable-next-line react-hooks/static-components -- resolveIcon returns a stable icon component from a static registry, not one created during render */}
      {!loading && Icon && <Icon className={cn('h-4 w-4', action.label && 'mr-2')} />}
      {action.label}
    </Button>
  );
  return <DisabledReasonTrigger reason={disabledReason}>{button}</DisabledReasonTrigger>;
};

InlineActionButton.displayName = 'InlineActionButton';

/**
 * One action inside an `action:group`'s dropdown (overflow) menu. Extracted
 * into its own component so the action's `visible`/`enabled` CEL predicate can
 * be evaluated with a hook (`useCondition`) without violating the
 * rules-of-hooks inside a `.map()`. Mirrors `InlineActionButton` (the
 * inline-mode leaf) so BOTH display modes honor `visible`/`enabled`
 * identically — previously the dropdown branch rendered every action
 * unconditionally, so an action with `visible: "record.role != 'owner'"`
 * showed even when its predicate was false.
 */
export const DropdownActionItem: React.FC<{
  action: UIActionSchema;
  index: number;
  onSelect: (action: UIActionSchema) => void | Promise<void>;
  /**
   * The row this group is mounted over, forwarded by the host. Optional: an
   * object-level group genuinely has no row, and a predicate over an empty
   * record is still evaluable (objectui#4075).
   */
  record?: unknown;
}> = ({ action, index, onSelect, record }) => {
  // Same three-way binding as `InlineActionButton` — one action cannot resolve
  // its predicate in one display mode and fault in the other (objectui#4075,
  // the binding half of the objectui#3812 / #3842 "one leaf, one answer" rule).
  const recordData = usePredicateRecordContext(record);
  // Same fail-closed `visible` as `InlineActionButton` — one member, one answer
  // in both display modes (objectui#11212).
  const isVisible = useMemberVisible(action, recordData);
  // Spec `disabled` primary, legacy non-spec `enabled` fallback (see
  // InlineActionButton above — objectstack-ai/objectstack#1885 follow-through).
  const isDisabledPred = useCondition(toPredicateInput((action as any).disabled), recordData);
  const isEnabled = useCondition(toPredicateInput(action.enabled), recordData);
  // The same reason as `InlineActionButton`'s, on the same verdict
  // (objectui#11839), drawn the menu-item way: a visible second line that is the
  // item's description. See `./disabled-reason`.
  const disabledReason = useDisabledReason(
    hasDeclaredVisibilityGate(action.disabled) && isDisabledPred,
  );
  // Same declared-gate rule as `InlineActionButton` above — one action cannot be
  // hidden in one display mode and shown in the other (objectui#3812).
  if (hasDeclaredVisibilityGate(action.visible) && !isVisible) return null;
  const Icon = resolveIcon(action.icon);
  // Declared-gate test, same definition as `InlineActionButton` above: one
  // action cannot be greyed out in one display mode and clickable in the other
  // (objectui#3842 / #3849). `disabled: ''` is not a declared gate — an empty
  // predicate is nothing to evaluate, and on this key the evaluation entry's
  // "no condition → true" means DISABLE.
  const isDisabled = hasDeclaredVisibilityGate((action as any).disabled)
    ? isDisabledPred
    : hasDeclaredVisibilityGate(action.enabled)
      ? !isEnabled
      : false;
  const showSeparator = action.tags?.includes('separator-before') && index > 0;
  return (
    <>
      {showSeparator && <DropdownMenuSeparator />}
      <DropdownMenuItem
        disabled={isDisabled}
        {...menuItemReasonAria(disabledReason)}
        onSelect={async (e) => {
          e.preventDefault();
          if (isDisabled) return;
          await onSelect(action);
        }}
        className={cn(
          (action.variant as string) === 'destructive' && 'text-destructive focus:text-destructive',
          action.className,
        )}
      >
        {/* Dynamic icon resolution from Lucide, not component creation during render */}
        {/* eslint-disable-next-line react-hooks/static-components */}
        {Icon && <Icon className="mr-2 h-4 w-4" />}
        <DisabledReasonMenuLabel reason={disabledReason}>{action.label || action.name}</DisabledReasonMenuLabel>
      </DropdownMenuItem>
    </>
  );
};

DropdownActionItem.displayName = 'DropdownActionItem';

// Index signature on the parameter annotation, not on the `forwardRef` type
// argument — see the mechanism note on `action:bar` (objectui#4422), pinned by
// `__tests__/forwardref-props-annotation.guard.test.ts`. `disabled` is the
// host-EVALUATED enablement verdict, declared rather than left to the index
// signature, as `ActionButtonRendererProps` declares it (objectui#9131).
const ActionGroupRenderer = forwardRef<HTMLDivElement, { schema: ActionGroupSchema; className?: string }>(
  ({ schema, className, ...props }: { schema: ActionGroupSchema; className?: string; disabled?: boolean; [key: string]: any }, ref) => {
    const {
      'data-obj-id': dataObjId,
      'data-obj-type': dataObjType,
      style,
      // The row the host mounted this group over — the predicate context for
      // this group's own `visible` AND for both display modes' leaves
      // (objectui#4075). Also keeps `data` out of `...rest`, which is spread
      // onto the DOM wrapper in inline mode.
      data,
      // The host's EVALUATED verdict, taken by name — the objectui#9131 rule
      // `action:button` and `action:icon` follow (objectui#11182).
      // `SchemaRenderer` forwards `disabled: __disabled || undefined` with the
      // key unconditional. Left on `rest`, inline mode spread it onto the
      // wrapping `div`, where a `disabled` attribute disables nothing, and
      // dropdown mode dropped it: a host-disabled group left every member
      // (inline) or its trigger (dropdown) pressable. Both modes consume it.
      disabled: hostDisabled,
      ...rest
    } = props;

    const { execute } = useAction();
    const [dropdownLoading, setDropdownLoading] = useState(false);

    // The row bound the three canonical ways — see `usePredicateRecordContext`.
    const recordData = usePredicateRecordContext(data);

    // The group's OWN gate fails CLOSED on a faulting predicate, like its
    // members' (`useMemberVisible`) and like the `action:bar` / `action:menu`
    // hosts (objectui#11212).
    const isVisible = useCondition(toPredicateInput(schema.visible), recordData, {
      throwOnError: true,
      label: `action:group "${schema.label ?? schema.icon ?? 'group'}" (visible)`,
    });

    // Placement is `actionRendersAt`'s call (objectui#3142) — this used to
    // show an action with `locations: undefined` while hiding one with
    // `locations: []`, a third reading of the same key.
    // `UIActionSchema` by declaration now (objectui#4418) — the exported
    // `ActionGroupSchema.actions` key used to say the legacy `ActionSchema`,
    // which has no `locations` for `actionRendersAt` on the very next line to
    // read. The local restates the declared type; both `.map()` callbacks
    // below still infer from it.
    const declaredActions: UIActionSchema[] = schema.actions || [];
    const actions = declaredActions.filter(a => actionRendersAt(a, schema.location));

    const handleExecute = useCallback(
      async (action: UIActionSchema) => {
        // UI-local escape hatch: direct callback, bypass ActionEngine — the
        // branch `action:menu` and `action:button` take (see action-button.tsx
        // for why it is invoked here rather than forwarded). Both display
        // modes reach the runner through this one function, so both honour it.
        // Neither called nor forwarded, a code-composed `onClick` was silently
        // inert on this surface (objectui#4202).
        if (typeof action.onClick === 'function') {
          await action.onClick();
          return;
        }
        // `params` is the `ActionParam[]` input list (ruling A on objectui#10289):
        // an array is forwarded as `actionParams`, as `action:button` does. An
        // object is forwarded as values only for `type: 'api'`, the objectstack#5777
        // payload window; any other type drops it (objectui#10462).
        //
        // A member has no other source of static values. It carries no
        // `properties` bag, and its static parameter values are not part of the
        // inline action vocabulary: an action that needs them is its own
        // `action:button` node, whose `params` object carries them (the spec's
        // member prescription, objectui#11638).
        const paramsPayload: ActionDef = Array.isArray(action.params)
          ? { actionParams: action.params as any }
          : { params: readActionEntryParamValues(action, action.type, 'action:group') };
        await execute({
          type: action.type,
          name: action.name,
          // See action-button.tsx — the param-collection dialog reads its title
          // and description off these (objectui#4192, measured on `action:menu`
          // and found here by `check:action-forward-parity`).
          label: action.label,
          description: (action as any).description,
          target: action.target,
          openIn: (action as any).openIn,
          endpoint: action.endpoint,
          method: action.method,
          ...paramsPayload,
          // See action-button.tsx — the `type: 'api'` payload key (objectstack#6837).
          bodyExtra: action.bodyExtra,
          // See action-button.tsx — the body-WRAPPING key (objectstack#6938).
          bodyShape: action.bodyShape,
          // The declarative single-record field write: `operation` alone, for the
          // reasons spelled out at `action:button`'s forward. The runner
          // dispatches on `operation` ahead of `type`; the route writes the
          // named declaration's `patch`, never this member's, so ⛔ no `patch`
          // (objectui#13022).
          operation: action.operation,
          confirmText: action.confirmText,
          successMessage: action.successMessage,
          // See action-button.tsx — success copy per handler outcome, the
          // toast's first rung (objectui#11344).
          outcomeMessages: action.outcomeMessages,
          errorMessage: action.errorMessage,
          refreshAfter: action.refreshAfter,
          // Placement declaration — see action-button.tsx (#2210).
          locations: action.locations,
          toast: action.toast,
          // See action-button.tsx — the one-shot reveal spec (2FA setup, fresh
          // OAuth secret). Without it the runner falls back to the success
          // toast and the value the user was meant to copy is gone.
          resultDialog: (action as any).resultDialog,
          // See action-button.tsx — the declared post-success hop
          // (objectui#5493). The runner reads it off the forwarded def; dropped
          // here the action succeeds and the authored navigation never runs.
          // Uncast since objectui#5934 (legacy callback channel retired).
          onSuccess: action.onSuccess,
          // See action-button.tsx — the object the action declares it acts on;
          // dropped here, a retargeted action silently acted on the page's
          // object (objectui#4202). Cast for the same reason as there.
          objectName: (action as any).objectName,
        });
      },
      [execute],
    );

    // Dropdown items share the trigger's loading spinner, so wrap execution to
    // toggle `dropdownLoading` (inline items manage their own local loading).
    const handleDropdownSelect = useCallback(
      async (action: UIActionSchema) => {
        setDropdownLoading(true);
        try {
          await handleExecute(action);
        } finally {
          setDropdownLoading(false);
        }
      },
      [handleExecute],
    );

    if (schema.visible && !isVisible) return null;
    if (actions.length === 0) return null;

    const display = schema.display || 'inline';

    // --- DROPDOWN MODE ---
    if (display === 'dropdown') {
      const TriggerIcon = resolveIcon(schema.icon);
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant={(schema.variant || 'outline') as any}
              size={(schema.size === 'md' ? 'default' : (schema.size || 'default')) as any}
              className={cn(schema.className, className)}
              // `hostDisabled` leads the OR (objectui#9131) — see `action:button`.
              disabled={hostDisabled || dropdownLoading}
              {...{ 'data-obj-id': dataObjId, 'data-obj-type': dataObjType, style }}
            >
              {dropdownLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {/* eslint-disable-next-line react-hooks/static-components -- resolveIcon returns a stable icon component from a static registry, not one created during render */}
              {!dropdownLoading && TriggerIcon && <TriggerIcon className="mr-2 h-4 w-4" />}
              {schema.label || 'Actions'}
              <ChevronDown className="ml-2 h-3 w-3 opacity-50" />
            </Button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end">
            {actions.map((action, index) => (
              <DropdownActionItem
                key={action.name || index}
                action={action}
                index={index}
                onSelect={handleDropdownSelect}
                record={data}
              />
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      );
    }

    // --- INLINE MODE (default) ---
    return (
      <div
        ref={ref}
        className={cn('flex items-center gap-2', schema.className, className)}
        {...rest}
        {...{ 'data-obj-id': dataObjId, 'data-obj-type': dataObjType, style }}
      >
        {actions.map((action) => (
          <InlineActionButton
            key={action.name}
            action={action}
            variant={schema.variant}
            size={schema.size}
            onExecute={handleExecute}
            record={data}
            hostDisabled={hostDisabled}
          />
        ))}
      </div>
    );
  },
);

ActionGroupRenderer.displayName = 'ActionGroupRenderer';

ComponentRegistry.register('group', ActionGroupRenderer, {
  namespace: 'action',
  skipFallback: true,
  label: 'Action Group',
  // objectui#11168 slice 1 — each key below was decided by measuring what this
  // renderer reads through the real `SchemaRenderer`, against the installed
  // `ComponentPropsMap['action:group']` row; the pins live in
  // `__tests__/action-group-menu-inputs-11168.test.tsx`.
  //
  // - `name` is NOT published: nothing reads a group-level `name` (inline mode
  //   only leaks it onto the wrapping `<div>`), and the spec refuses it here.
  // - `actions` is a LIST of action objects: the renderer reads
  //   `schema.actions || []` and then `.filter` / `.map`, and the spec refuses
  //   the `object` kind this entry used to declare.
  // - `size` publishes the Button primitive's four sizes, the set the spec
  //   accepts. `md` is not one of them; the renderer still maps a stored `md`
  //   to `default` in dropdown mode, as a back-compat read.
  inputs: [
    { name: 'label', type: 'string' },
    { name: 'icon', type: 'string' },
    {
      name: 'actions',
      type: 'array',
      of: 'object',
      description:
        'The actions in this group, in order. Each member is an action object the group draws and runs itself (`name`, `label`, `icon`, `type`, `target`, `locations`, `visible`, `disabled`, …); a member\'s executor is its own `type`',
    },
    {
      name: 'display',
      type: 'enum',
      enum: ['inline', 'dropdown'],
    },
    {
      name: 'location',
      type: 'enum',
      enum: [...ACTION_LOCATIONS],
      description:
        'Render only the members whose `locations` include this location. Omit to render every member',
    },
    {
      name: 'variant',
      type: 'enum',
      enum: ['default', 'secondary', 'outline', 'ghost'],
    },
    {
      name: 'size',
      type: 'enum',
      enum: ['default', 'sm', 'lg', 'icon'],
      description:
        'Button size for the dropdown trigger and for every inline member that sets none',
    },
    {
      name: 'visible',
      type: ['boolean', 'string', 'object'],
      description:
        'Visibility predicate for the whole group: `true`/`false`, a bare CEL expression, or the `{ dialect: \'cel\', source }` envelope, evaluated against the row the host binds. Omit for always-visible',
    },
    { name: 'className', type: 'string' },
  ],
  defaultProps: {
    display: 'inline',
    variant: 'outline',
    size: 'sm',
    actions: [],
  },
});
