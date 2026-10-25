/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * action:bar — Location-aware action toolbar.
 *
 * Renders a set of UIActionSchema items filtered by a given location. Each
 * action's `component` decides WHERE it renders on the bar, which is the spec's
 * own reading of that key ("Defaults to 'button' or 'menu_item' based on
 * location, but can be overridden") — objectui#10345, ruling A:
 *
 * - `action:button` (the default) and `action:icon` render inline, each through
 *   the renderer of that name in the ComponentRegistry.
 * - `action:menu` places the action in the bar's one overflow "More" menu,
 *   however few actions the bar has. It never takes an inline slot.
 * - `action:group` renders the action inline, as an `action:button`, inside a
 *   button group it shares with the `action:group` members next to it in the
 *   inline row.
 *
 * Inline actions beyond the `maxVisible` threshold move into that same overflow
 * "More" menu.
 *
 * This is the "bridge" component that connects UIActionSchema metadata to the UI,
 * enabling server-driven action rendering at every location the spec declares:
 * list_toolbar, list_item, record_header, record_more, record_related and
 * record_section. (`global_nav` used to close that list; it was retired from
 * `ACTION_LOCATIONS` in @objectstack/spec 17.0.0-rc.6 — objectstack#6888 — as a
 * location no running-app surface ever rendered. The enum this component
 * publishes is `[...ACTION_LOCATIONS]`, so it followed the retirement on its
 * own; only this prose had to be aligned.)
 *
 * @example
 * ```tsx
 * <SchemaRenderer schema={{
 *   type: 'action:bar',
 *   location: 'record_header',
 *   actions: [
 *     { name: 'mark_complete', label: 'Mark Complete', type: 'script', icon: 'check', component: 'action:button' },
 *     { name: 'delete', label: 'Delete', type: 'api', icon: 'trash', variant: 'destructive', component: 'action:button' },
 *   ],
 * }} />
 * ```
 */

import React, { forwardRef, useMemo } from 'react';
import { ComponentRegistry } from '@object-ui/core';
import type { UIActionSchema, ActionBarSchema, ActionComponent } from '@object-ui/types';
import { ACTION_LOCATIONS, actionRendersAt } from '@object-ui/types';
import { useCondition, toPredicateInput, useCapabilityGate, useConfigBagEvaluator } from '@object-ui/react';
import { useObjectTranslation } from '@object-ui/i18n';
import { cn } from '../../lib/utils';
import { useIsMobile } from '../../hooks/use-mobile';
import { ButtonGroup } from '../../custom/button-group';
import { withEvaluatedProperties } from './static-params';

function useActionsLabel(): string {
  // useObjectTranslation is provider-safe (never throws); no try/catch, which
  // would wrap the hook call and violate rules-of-hooks. The 'Actions' fallback
  // still applies when the key is missing/untranslated.
  const { t } = useObjectTranslation();
  const v = t('common.actions');
  return !v || v === 'common.actions' ? 'Actions' : v;
}

// `ActionBarSchema` — the node this renderer reads — is declared in
// `@object-ui/types` (objectui#11355, the seat's ruling B: node schemas live in
// the protocol package). It carries no index signature; the one this renderer
// needs for its DOM/Shadcn pass-through is on the parameter annotation below.

// The index signature lives on the PARAMETER annotation and NOT on the
// `forwardRef` type argument. That asymmetry is load-bearing (objectui#4422) —
// see `__tests__/forwardref-props-annotation.guard.test.ts`, which pins it:
//
//   * `forwardRef` routes its type argument through `PropsWithoutRef`, which is
//     `'ref' extends keyof P ? Omit<P, 'ref'> : P`. A string index signature
//     puts `string` into `keyof P`, so the `Omit` branch ALWAYS runs, and
//     `Omit` over an index-signature type keeps only the index signature —
//     every declared property is erased. With the signature on the type
//     argument, `schema` arrived as `any`.
//   * Keeping it on the parameter annotation preserves the pass-through spread
//     (`...props` still collects arbitrary keys for the DOM/Shadcn hand-off),
//     so this is NOT the "drop the index signature" direction — no component's
//     real prop surface had to be enumerated.
//
// The annotation cannot simply repeat the type argument: once `Omit` has erased
// `schema`, a required `schema` in the annotation is a TS2345 on the render
// function itself. Removing the signature from the type argument is what makes
// the direct annotation legal, and it is consumer-neutral — this const is not
// exported and never appears in JSX, and `Registry.register` takes
// `ComponentRenderer<T = any> = T`.
const ActionBarRenderer = forwardRef<HTMLDivElement, { schema: ActionBarSchema; className?: string }>(
  ({ schema, className, ...props }: { schema: ActionBarSchema; className?: string; [key: string]: any }, ref) => {
    const actionsAriaLabel = useActionsLabel();
    const {
      'data-obj-id': dataObjId,
      'data-obj-type': dataObjType,
      style,
      data,
      // Strip schema metadata props that are consumed via `schema.*` and
      // must NOT be spread onto the underlying DOM element (avoids React
      // "unknown DOM attribute" warnings — especially for camelCase keys
      // like `systemActions`, `mobileMaxVisible`).
      actions: _schemaActions,
      systemActions: _schemaSystemActions,
      location: _schemaLocation,
      maxVisible: _schemaMaxVisible,
      mobileMaxVisible: _schemaMobileMaxVisible,
      direction: _schemaDirection,
      gap: _schemaGap,
      variant: _schemaVariant,
      size: _schemaSize,
      visible: _schemaVisible,
      ...rest
    } = props;

    // Fails CLOSED on a throwing predicate — mirrors ActionEngine's
    // getActionsForLocation contract (see action-button.tsx for rationale).
    const isVisible = useCondition(toPredicateInput(schema.visible), undefined, {
      throwOnError: true,
      label: `action:bar${schema.location ? ` (${schema.location})` : ''} (visible)`,
    });
    const isMobile = useIsMobile();
    // [ADR-0066 D4 / framework#3923] Shared capability gate — see below.
    const mayInvoke = useCapabilityGate();
    // The `SchemaRenderer` memo's `properties` evaluation, for the members this
    // bar draws itself (objectui#10290) — see `renderMember` below.
    const evaluateBag = useConfigBagEvaluator();

    // Filter business actions by location and deduplicate by name
    const filteredActions = useMemo(() => {
      // `UIActionSchema` all the way through, declaration included
      // (objectui#4418). It used to be only the local: the exported
      // `ActionBarSchema.actions` key declared the legacy `ActionSchema` while
      // this implementation was written against the modern one, and #4353's
      // annotation named that contradiction here rather than resolving it.
      // The declaration has now moved, so the local is a plain restatement of
      // `schema.actions`' own type and the chain below still infers from it.
      const actions: UIActionSchema[] = schema.actions || [];
      // [ADR-0066 D4 / framework#3923] Capability gate — this bar filters its
      // own set instead of going through `ActionEngine.getActionsForLocation`,
      // so without this a `list_toolbar` action declaring a capability nobody
      // holds rendered as a live button. Same rule as the engine; unknown
      // capabilities fail OPEN (see `useCapabilityGate`).
      const permitted = actions.filter(a => mayInvoke((a as any)?.requiredPermissions));
      // Placement is `actionRendersAt`'s call, not ours (objectui#3142): an
      // action renders here only if it DECLARES this location. This bar used
      // to show a locationless action at every location, which is how an
      // aggregate-only bulk action — one with no single-record placement by
      // construction — ended up as a list-toolbar button that could only fail.
      // `schema.location` unset still means "no location filtering".
      const located = permitted.filter(a => actionRendersAt(a, schema.location));
      // Deduplicate by action name — keep first occurrence
      const seen = new Set<string>();
      const deduped = located.filter(a => {
        if (!a.name) return true;
        if (seen.has(a.name)) return false;
        seen.add(a.name);
        return true;
      });
      // Order the actions before the inline/overflow split so the first one
      // lands in the primary-button slot. The rule (objectui#2339) is:
      //   1. `order` ascending (unset = 0; lower = more prominent)
      //   2. `variant === 'primary'` preferred as a tie-break within equal order
      //   3. original registration order (stable) for the remaining ties
      // The sort is stable and every key defaults to a no-op, so a toolbar where
      // nobody sets `order` and nobody is `primary` keeps its exact registration
      // order. This is what lets an injected Approve/Reject with a negative
      // `order` float into the primary slot instead of the "More" overflow menu
      // (objectstack-ai/objectstack#2670), lets authors declaratively promote an action via `Action.order`,
      // and — when several unordered actions tie at the default `order` 0 — lets
      // the `primary`-variant action claim the primary button without the author
      // having to also assign an `order`.
      const needsOrdering = deduped.some(
        a => a.order !== undefined || a.variant === 'primary',
      );
      if (needsOrdering) {
        return [...deduped].sort((a, b) => {
          const byOrder = (a.order ?? 0) - (b.order ?? 0);
          if (byOrder !== 0) return byOrder;
          // Tie-break: a `primary` action outranks a non-primary sibling.
          const ap = a.variant === 'primary' ? 0 : 1;
          const bp = b.variant === 'primary' ? 0 : 1;
          return ap - bp; // equal → stable sort preserves registration order
        });
      }
      return deduped;
    }, [schema.actions, schema.location, mayInvoke]);

    // System actions: always go into the overflow menu, deduped by name,
    // never filtered by location (they're chrome, not business logic).
    const systemActions = useMemo(() => {
      // Same type as `filteredActions` above, and now for the same plain
      // reason — `systemActions` declares it too.
      const actions: UIActionSchema[] = schema.systemActions || [];
      const seen = new Set<string>();
      // Chrome or not, a declared capability gates it (ADR-0066 D4) — a host
      // that puts a gated action in this slot means the same thing by it.
      return actions.filter(a => {
        if (!mayInvoke((a as any)?.requiredPermissions)) return false;
        if (!a.name) return true;
        if (seen.has(a.name)) return false;
        seen.add(a.name);
        return true;
      });
    }, [schema.systemActions, mayInvoke]);

    // Split business actions into visible inline and overflow.
    // On mobile, show fewer actions inline (default: 1).
    //
    // An action authored `component: 'action:menu'` is PLACED in the overflow
    // menu (objectui#10345, ruling A). It is taken out before the split, so it
    // never spends one of the `maxVisible` inline slots — `page:header` reads
    // the same key the same way ("forces an action into the `⋯` menu
    // regardless of the count"). It used to be handed to the `action:menu`
    // renderer as an inline member, alone; that renderer reads `schema.actions`,
    // which a single action does not carry, so it returned null: the action
    // vanished and a `?runAction=` deep link to it ran nothing.
    //
    // The overflow list keeps one stated order: the actions that spilled past
    // `maxVisible` first, then the menu-placed ones, each in the bar's own order
    // from `filteredActions` above. That is `page:header`'s order for its menu
    // too. System actions still follow, after the separator.
    const maxVisible = isMobile
      ? (schema.mobileMaxVisible ?? 1)
      : (schema.maxVisible ?? 3);
    const { inlineActions, overflowActions } = useMemo(() => {
      const menuPlaced = filteredActions.filter(a => a.component === 'action:menu');
      const rowCandidates = filteredActions.filter(a => a.component !== 'action:menu');
      return {
        inlineActions: rowCandidates.slice(0, maxVisible),
        overflowActions: [...rowCandidates.slice(maxVisible), ...menuPlaced],
      };
    }, [filteredActions, maxVisible]);

    // The inline row, with each run of ADJACENT `action:group` members folded
    // into one button group (objectui#10345, ruling A). "Adjacent" means next to
    // each other in the row this bar draws: after ordering, after the
    // `maxVisible` cut, and with the menu-placed actions already gone. Any other
    // inline member between two group members splits them into two groups.
    const inlineRow = useMemo(() => {
      const row: Array<UIActionSchema | UIActionSchema[]> = [];
      for (const action of inlineActions) {
        if (action.component !== 'action:group') {
          row.push(action);
          continue;
        }
        const last = row[row.length - 1];
        if (Array.isArray(last)) last.push(action);
        else row.push([action]);
      }
      return row;
    }, [inlineActions]);

    // Merge business overflow with system actions into a single overflow list.
    // Insert a visual separator before the first system action when both
    // groups coexist, so users can distinguish domain vs. chrome actions.
    const combinedOverflow = useMemo<UIActionSchema[]>(() => {
      if (systemActions.length === 0) return overflowActions;
      if (overflowActions.length === 0) return systemActions;
      const [firstSys, ...restSys] = systemActions;
      const firstWithSeparator: UIActionSchema = {
        ...firstSys,
        tags: [...(firstSys.tags || []), 'separator-before'],
      };
      return [...overflowActions, firstWithSeparator, ...restSys];
    }, [overflowActions, systemActions]);

    if (schema.visible && !isVisible) return null;
    if (filteredActions.length === 0 && systemActions.length === 0) return null;

    const direction = schema.direction || 'horizontal';
    const gap = schema.gap || 'gap-2';

    // Render a single overflow menu for any combination of business-overflow
    // + system actions. This guarantees at most ONE "More" button per bar.
    const MenuRenderer = combinedOverflow.length > 0 ? ComponentRegistry.get('action:menu') : null;
    const overflowMenu = MenuRenderer ? (
      // eslint-disable-next-line react-hooks/static-components -- ComponentRegistry.get returns a registered renderer (stable reference), not a component created during render
      <MenuRenderer
        schema={{
          type: 'action:menu' as const,
          actions: combinedOverflow,
          variant: schema.variant || 'ghost',
          size: schema.size || 'sm',
        }}
        // The row, same as the inline members below. Without it an action's
        // `visible` / `disabled` predicate answered a different question purely
        // because the action had spilled past `maxVisible` — and on mobile
        // `maxVisible` defaults to 1, so which actions lose their row is a
        // function of the viewport (objectui#4075).
        data={data}
      />
    ) : null;

    // One inline member, drawn by the renderer `componentType` names. The whole
    // action is spread onto that renderer's schema, so it carries its own gates
    // and its `autoTrigger` with it.
    //
    // The member is mounted without `SchemaRenderer`, so nothing else evaluates
    // its `properties`: its static values (`properties.params`, objectui#10289)
    // would reach the handler as raw `${…}` text. They are evaluated here, once,
    // with the memo's evaluator and scope (objectui#10290). An overflow member
    // is NOT evaluated here: it goes to the `action:menu` above as authored,
    // and that renderer reads no member's `properties`, so an overflow
    // member's `properties.params` does not reach the runner (objectui#11638).
    const renderMember = (action: UIActionSchema, componentType: ActionComponent) => {
      const Renderer = ComponentRegistry.get(componentType);
      if (!Renderer) return null;

      return (
        <Renderer
          key={action.name}
          schema={{
            ...withEvaluatedProperties(action, evaluateBag),
            type: componentType,
            actionType: action.type,
            variant: action.variant || schema.variant,
            size: action.size || schema.size,
          }}
          data={data}
        />
      );
    };

    return (
      <div
        ref={ref}
        className={cn(
          'flex items-center',
          direction === 'vertical' ? 'flex-col items-stretch' : 'flex-row flex-wrap',
          gap,
          schema.className,
          className,
        )}
        role="toolbar"
        aria-label={actionsAriaLabel}
        {...rest}
        {...{ 'data-obj-id': dataObjId, 'data-obj-type': dataObjType, style }}
      >
        {inlineRow.map((entry, index) => {
          if (!Array.isArray(entry)) {
            return renderMember(entry, entry.component || 'action:button');
          }
          // Each group member renders through `action:button`, the renderer an
          // ungrouped member gets, so it keeps the same `visible` / `disabled`
          // gates and the same `autoTrigger` consumption. The `action:group`
          // renderer is not used: it reads `schema.actions`, and it draws its
          // own buttons, which consume no `autoTrigger`, so a `?runAction=` deep
          // link to a grouped member would still run nothing. `empty:hidden`
          // stops a group whose members all hid themselves from leaving a gap.
          return (
            <ButtonGroup
              key={`group:${entry[0].name ?? index}`}
              orientation={direction === 'vertical' ? 'vertical' : 'horizontal'}
              className="empty:hidden"
            >
              {entry.map((action) => renderMember(action, 'action:button'))}
            </ButtonGroup>
          );
        })}

        {combinedOverflow.length > 0 && overflowMenu}
      </div>
    );
  },
);

ActionBarRenderer.displayName = 'ActionBarRenderer';

ComponentRegistry.register('bar', ActionBarRenderer, {
  namespace: 'action',
  skipFallback: true,
  label: 'Action Bar',
  inputs: [
    { name: 'actions', type: 'object' },
    { name: 'systemActions', type: 'object' },
    {
      name: 'location',
      type: 'enum',
      enum: [...ACTION_LOCATIONS],
    },
    {
      name: 'maxVisible',
      type: 'number',
    },
    {
      name: 'direction',
      type: 'enum',
      enum: ['horizontal', 'vertical'],
    },
    {
      name: 'variant',
      type: 'enum',
      enum: ['default', 'secondary', 'outline', 'ghost'],
    },
    {
      name: 'size',
      type: 'enum',
      enum: ['sm', 'md', 'lg'],
    },
    { name: 'className', type: 'string' },
  ],
  defaultProps: {
    maxVisible: 3,
    direction: 'horizontal',
    variant: 'outline',
    size: 'sm',
    actions: [],
  },
});
