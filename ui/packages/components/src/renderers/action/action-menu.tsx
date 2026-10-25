/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * action:menu — Dropdown menu for overflow actions.
 *
 * Renders a Shadcn DropdownMenu populated from UIActionSchema[].
 * Each menu item triggers the corresponding action via ActionRunner.
 */

import React, { forwardRef, useCallback, useMemo, useState } from 'react';
import { ComponentRegistry } from '@object-ui/core';
import type { ActionDef } from '@object-ui/core';
import type { UIActionSchema } from '@object-ui/types';
import { useAction } from '@object-ui/react';
import { useCondition, toPredicateInput, usePredicateRecordContext } from '@object-ui/react';
import { useObjectTranslation } from '@object-ui/i18n';
import { Button } from '../../ui';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../ui';
import { cn } from '../../lib/utils';
import { Loader2, MoreHorizontal } from 'lucide-react';
import { resolveIcon } from './resolve-icon';
import { hasDeclaredVisibilityGate } from './visibility-gate';
import { useAutoTriggerOnce } from './auto-trigger';
import { readActionEntryParamValues } from './static-params';
import { DisabledReasonMenuLabel, menuItemReasonAria, useDisabledReason } from './disabled-reason';

function useMoreActionsLabel(): string {
  // useObjectTranslation is provider-safe (never throws); no try/catch, which
  // would wrap the hook call and violate rules-of-hooks. The 'More actions'
  // fallback still applies when the key is missing/untranslated.
  const { t } = useObjectTranslation();
  const v = t('detail.moreActions');
  return !v || v === 'detail.moreActions' ? 'More actions' : v;
}

export interface ActionMenuSchema {
  type: 'action:menu';
  /** Menu trigger label (defaults to icon-only) */
  label?: string;
  /** Menu trigger icon (defaults to more-horizontal) */
  icon?: string;
  /** Actions to render as menu items */
  actions?: UIActionSchema[];
  /** Trigger variant */
  variant?: string;
  /** Trigger size */
  size?: string;
  /** Visibility predicate: a boolean, a CEL string, or a `{ dialect, source }` envelope */
  visible?: boolean | string | { dialect: string; source?: string };
  /** Custom CSS class */
  className?: string;
  [key: string]: any;
}

/**
 * One menu action's own `visible` verdict — shared by the item that renders it
 * and by the headless auto-trigger that may run it (objectui#4191), so the two
 * cannot answer the same predicate differently.
 *
 * The row is bound the canonical way (`record.status`). The item used to pass
 * `undefined`, i.e. no record at all, so every row-scoped predicate an author
 * wrote here faulted on its root (objectui#4075). See
 * `usePredicateRecordContext`. The verdict fails CLOSED on a throwing
 * predicate — mirrors ActionEngine's getActionsForLocation contract (see
 * action-button.tsx for rationale).
 */
function useMenuActionVisible(action: UIActionSchema, record: unknown) {
  const recordData = usePredicateRecordContext(record);
  const isVisible = useCondition(toPredicateInput(action.visible), recordData, {
    throwOnError: true,
    label: `action "${action.name ?? action.label ?? 'action:menu item'}" (visible)`,
  });
  return { recordData, isVisible };
}

/**
 * One action inside an `action:menu`. Exported for its pin tests only (it is
 * not re-exported from the package index) — mirrors `DropdownActionItem` in
 * `action-group.tsx`, whose gate is the same one.
 */
export const ActionMenuItem: React.FC<{
  action: UIActionSchema;
  onExecute: (action: UIActionSchema) => Promise<void>;
  /**
   * The row this menu is mounted over, forwarded by the host. Optional: an
   * object-level menu genuinely has no row, and a predicate over an empty
   * record is still evaluable (objectui#4075 — the failure being fixed is a
   * predicate that FAULTS on an unbound root, not one that reads a missing
   * field).
   */
  record?: unknown;
}> = ({ action, onExecute, record }) => {
  const { recordData, isVisible } = useMenuActionVisible(action, record);
  // Spec `disabled` (boolean | CEL — disabled when TRUE) primary, legacy
  // non-spec `enabled` fallback (objectstack-ai/objectstack#1885 follow-through — only action-button
  // was wired; this renderer ignored a spec-authored `disabled`).
  const isDisabledPred = useCondition(toPredicateInput((action as any).disabled), recordData);
  const isEnabled = useCondition(toPredicateInput(action.enabled), recordData);
  // The reason a greyed-out item gives (objectui#11839): only its DECLARED
  // `disabled` predicate, evaluated true — the rule `action:button` follows —
  // drawn the menu-item way: a visible second line that is the item's
  // description. See `./disabled-reason`.
  const disabledReason = useDisabledReason(
    hasDeclaredVisibilityGate(action.disabled) && isDisabledPred,
  );

  const iconElement = useMemo(() => {
    const Icon = resolveIcon(action.icon);
    // eslint-disable-next-line react-hooks/static-components -- Icon is resolved from a stable icon registry
    return Icon ? <Icon className="mr-2 h-4 w-4" /> : null;
  }, [action.icon]);

  // A DECLARED gate decides; truthiness would read `visible: false` as ungated
  // and render it (objectui#3812) — the same gate `action:group`'s two member
  // leaves read. `false` short-circuits at the evaluation entry, so the
  // `throwOnError` posture above still only applies to real predicates.
  if (hasDeclaredVisibilityGate(action.visible) && !isVisible) return null;

  return (
    <DropdownMenuItem
      // Declared-gate test, the same definition the `visible` gate above reads
      // and the same one `action:group`'s two leaves read (objectui#3842 ruling
      // applied here by #3849 — historic name kept, no alias). `disabled: ''`
      // is not a gate: the evaluation entry reads an empty predicate as "no
      // condition → true", which on this key means DISABLE, so `!= null` alone
      // greyed the item out forever. The negated legacy `enabled` leg is
      // behaviour-preserving under the same definition.
      disabled={hasDeclaredVisibilityGate((action as any).disabled)
        ? isDisabledPred
        : hasDeclaredVisibilityGate(action.enabled)
          ? !isEnabled
          : false}
      {...menuItemReasonAria(disabledReason)}
      onSelect={(e) => {
        e.preventDefault();
        onExecute(action);
      }}
      className={cn(
        (action.variant as string) === 'destructive' && 'text-destructive focus:text-destructive',
        action.className,
      )}
    >
      {iconElement}
      <DisabledReasonMenuLabel reason={disabledReason}>{action.label || action.name}</DisabledReasonMenuLabel>
    </DropdownMenuItem>
  );
};

ActionMenuItem.displayName = 'ActionMenuItem';

/**
 * The menu's `autoTrigger` consumption point (#4162) — renders NOTHING and
 * executes its action once, through the same `handleExecute` a click uses.
 *
 * ## Why a headless component per action, and not the item
 *
 * The consumption point has to be where the action provably ARRIVES, which is
 * this renderer receiving it in `schema.actions`. It cannot be `ActionMenuItem`:
 * the items live inside `DropdownMenuContent`, which Radix mounts only when the
 * dropdown OPENS, so an effect there would wait on the very click the flag
 * exists to avoid — and would make the trigger's open state, not the action,
 * decide whether a deep link runs. These mount with the menu itself.
 *
 * ## Why a component rather than a loop of hooks
 *
 * One `useAutoTriggerOnce` per action is the point (the guard is per action, so
 * two flagged actions each run once), and hooks cannot be called in a loop.
 * One instance per action, keyed by name, gives each its own guard ref for the
 * menu's lifetime. They are rendered for EVERY action, not only the flagged
 * ones, so the ref survives the flag flipping — mounting on the flip and
 * unmounting on the flip-back would hand a true→false→true action a fresh ref
 * and fire it twice, where `action:button`'s long-lived ref fires once.
 */
const ActionAutoTrigger: React.FC<{
  action: UIActionSchema;
  onExecute: (action: UIActionSchema) => Promise<void>;
  /** The row the menu is mounted over — the same context the item's gate reads. */
  record?: unknown;
}> = ({ action, onExecute, record }) => {
  // The item's own `visible` verdict, computed the same way `ActionMenuItem`
  // computes it: the action's declared gate outranks the flag (objectui#4191),
  // and the refusal branch lives in the shared hook so `action:button` refuses
  // identically.
  const { isVisible } = useMenuActionVisible(action, record);
  const run = useCallback(() => onExecute(action), [action, onExecute]);
  useAutoTriggerOnce(action, isVisible, run);
  return null;
};

ActionAutoTrigger.displayName = 'ActionAutoTrigger';

// Index signature on the parameter annotation, not on the `forwardRef` type
// argument — see the mechanism note on `action:bar` (objectui#4422), pinned by
// `__tests__/forwardref-props-annotation.guard.test.ts`. `disabled` is the
// host-EVALUATED enablement verdict, declared rather than left to the index
// signature, as `ActionButtonRendererProps` declares it (objectui#9131).
const ActionMenuRenderer = forwardRef<HTMLButtonElement, { schema: ActionMenuSchema; className?: string }>(
  ({ schema, className, ...props }: { schema: ActionMenuSchema; className?: string; disabled?: boolean; [key: string]: any }, ref) => {
    const {
      'data-obj-id': dataObjId,
      'data-obj-type': dataObjType,
      style,
      // The row the host mounted this menu over — the predicate context for
      // this menu's own `visible` AND for every item in it (objectui#4075).
      // Also keeps `data` out of `...rest`, which is spread onto the DOM
      // trigger button.
      data,
      // The host's EVALUATED verdict, taken by name — the objectui#9131 rule
      // `action:button` and `action:icon` follow (objectui#11182).
      // `SchemaRenderer` forwards `disabled: __disabled || undefined` with the
      // key unconditional, and `...rest` is spread after the trigger's own
      // `disabled`, so a PRESENT `undefined` re-declared it: through
      // `SchemaRenderer` an in-flight menu's trigger read `disabled=false`
      // while its spinner showed, and a second execution could start. Taking
      // it off `rest` removes that second writer; the trigger consumes it.
      disabled: hostDisabled,
      ...rest
    } = props;

    const { execute } = useAction();
    const [loading, setLoading] = useState(false);
    const moreActionsLabel = useMoreActionsLabel();

    // The row bound the three canonical ways — see `usePredicateRecordContext`.
    const recordData = usePredicateRecordContext(data);

    // Fails CLOSED on a throwing predicate — mirrors ActionEngine's
    // getActionsForLocation contract (see action-button.tsx for rationale).
    const isVisible = useCondition(toPredicateInput(schema.visible), recordData, {
      throwOnError: true,
      label: `action:menu "${schema.label ?? schema.icon ?? 'menu'}" (visible)`,
    });

    const TriggerIcon = resolveIcon(schema.icon) || MoreHorizontal;
    const variant = schema.variant || 'ghost';
    const size = schema.size || 'icon';

    const handleExecute = useCallback(
      async (action: UIActionSchema) => {
        setLoading(true);
        try {
          // UI-local escape hatch: direct callback, bypass ActionEngine
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
          // member prescription, objectui#11638). That holds for an `action:bar`
          // member spilled into this menu too.
          const paramsPayload: ActionDef = Array.isArray(action.params)
            ? { actionParams: action.params as any }
            : { params: readActionEntryParamValues(action, action.type, 'action:menu') };
          await execute({
            type: action.type,
            name: action.name,
            // See action-button.tsx — the param-collection dialog titles itself
            // from these two (`title: action?.label` and
            // `description: …action?.description`, in the `setParamState` call
            // of `useConsoleActionRuntime`'s `paramCollectionHandler` and of the
            // second copy in `RecordDetailView`). The title used to read
            // `action?.label || action?.title`; that fallback named a key no
            // action surface declares and no renderer forwards, and was removed
            // by objectui#4282 and objectui#5610. Dropped here, an overflow
            // action opened an untitled dialog while the SAME declaration
            // rendered inline named itself, so the split that decides which
            // renderer an action gets — `action:bar`'s `maxVisible`, 3 desktop
            // / 1 mobile — changed the dialog's title (objectui#4192).
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
            // The declarative single-record field write: `operation` alone, for
            // the reasons spelled out at `action:button`'s forward. The runner
            // dispatches on `operation` ahead of `type`; the route writes the
            // named declaration's `patch`, never this member's, so ⛔ no
            // `patch` (objectui#13022).
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
            // See action-button.tsx — overflow-menu actions need the
            // resultDialog spec forwarded too or the one-shot reveal is lost.
            resultDialog: (action as any).resultDialog,
            // See action-button.tsx — the declared post-success hop
            // (objectui#5493). An overflow action must hop like its inline
            // twin, or the `action:bar` `maxVisible` split decides whether the
            // declared navigation runs.
            // Uncast since objectui#5934 (legacy callback channel retired).
            onSuccess: action.onSuccess,
            // See action-button.tsx — the object the action declares it acts
            // on (objectui#4202). An overflow action must act on the same
            // object as its inline twin, or the `action:bar` `maxVisible` split
            // decides which object a write lands on. Cast for the same reason
            // as there.
            objectName: (action as any).objectName,
          });
        } finally {
          setLoading(false);
        }
      },
      [execute],
    );

    if (schema.visible && !isVisible) return null;

    // `UIActionSchema` by declaration now (objectui#4418) — the exported
    // `ActionMenuSchema.actions` key used to say the legacy `ActionSchema`
    // while every item below was written against the modern one. The local
    // restates the declared type; both `.map()` callbacks still infer from it.
    const actions: UIActionSchema[] = schema.actions || [];
    if (actions.length === 0) return null;

    return (
      <>
        {/*
          `autoTrigger` is a property of the ACTION, so this renderer honours it
          for the actions it receives — an action does not lose its auto-trigger
          for having sorted past `action:bar`'s `maxVisible` (#4162). Executing
          is the whole consumption: the dropdown is deliberately NOT opened, so
          a transport flag never moves what the user sees. Rendered outside
          `DropdownMenuContent` on purpose — see `ActionAutoTrigger`.

          Placed after this renderer's early returns, which is the same rule
          `action:bar` already follows: a container that renders nothing mounts
          no children, so a hidden bar's inline `autoTrigger` button never fires
          either. Container visibility governs mounting; the action's OWN
          declared `visible` gate refuses the trigger and reports the refusal
          (objectui#4191) — identically to `action:button`, through the same
          shared hook.
        */}
        {actions.map((action, index) => (
          <ActionAutoTrigger
            key={`auto-trigger:${action.name || index}`}
            action={action}
            onExecute={handleExecute}
            record={data}
          />
        ))}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              ref={ref}
              type="button"
              variant={variant as any}
              size={size as any}
              className={cn(
                size === 'icon' && 'h-8 w-8',
                schema.className,
                className,
              )}
              // `hostDisabled` leads the OR (objectui#9131): the host verdict is
              // a reason to disable, never a reason to enable — `SchemaRenderer`
              // emits `true` or `undefined`, never `false`. The menu declares no
              // enablement gate of its own, so the only other source is an
              // execution in flight. See `action:button`.
              disabled={hostDisabled || loading}
              aria-label={schema.label || moreActionsLabel}
              {...rest}
              {...{ 'data-obj-id': dataObjId, 'data-obj-type': dataObjType, style }}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  {/* eslint-disable-next-line react-hooks/static-components -- resolveIcon returns a stable icon component from a static registry, not one created during render */}
                  <TriggerIcon className={cn('h-4 w-4', schema.label && 'mr-2')} />
                  {schema.label && <span>{schema.label}</span>}
                </>
              )}
            </Button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end">
            {actions.map((action, index) => {
              // Render separator for actions tagged with 'separator-before'
              const showSeparator = action.tags?.includes('separator-before') && index > 0;
              return (
                <React.Fragment key={action.name || index}>
                  {showSeparator && <DropdownMenuSeparator />}
                  <ActionMenuItem action={action} onExecute={handleExecute} record={data} />
                </React.Fragment>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </>
    );
  },
);

ActionMenuRenderer.displayName = 'ActionMenuRenderer';

ComponentRegistry.register('menu', ActionMenuRenderer, {
  namespace: 'action',
  skipFallback: true,
  label: 'Action Menu',
  // objectui#11168 slice 1 — each key below was decided by measuring what this
  // renderer reads through the real `SchemaRenderer`, against the installed
  // `ComponentPropsMap['action:menu']` row; the pins live in
  // `__tests__/action-group-menu-inputs-11168.test.tsx`. `actions` is a LIST of
  // action objects (the renderer reads `schema.actions || []`, then `.map`),
  // and the spec refuses the `object` kind this entry used to declare.
  inputs: [
    { name: 'label', type: 'string' },
    { name: 'icon', type: 'string' },
    {
      name: 'actions',
      type: 'array',
      of: 'object',
      description:
        'The menu\'s actions, in order. Each member is an action object the menu draws and runs itself (`name`, `label`, `icon`, `type`, `target`, `visible`, `disabled`, `tags`, …); a member\'s executor is its own `type`',
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
      description: 'Trigger button size (renderer default: `icon`)',
    },
    {
      name: 'visible',
      type: ['boolean', 'string', 'object'],
      description:
        'Visibility predicate for the whole menu: `true`/`false`, a bare CEL expression, or the `{ dialect: \'cel\', source }` envelope, evaluated against the row the host binds; a predicate that fails to evaluate hides it. Omit for always-visible',
    },
    { name: 'className', type: 'string' },
  ],
  defaultProps: {
    variant: 'ghost',
    actions: [],
  },
});
