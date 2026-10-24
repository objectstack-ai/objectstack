/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * action:icon — Icon-only action button for dense layouts.
 *
 * Renders a Shadcn Button (size="icon") with tooltip and ActionRunner integration.
 */

import React, { forwardRef, useCallback, useState } from 'react';
import { ComponentRegistry } from '@object-ui/core';
import type { ActionDef } from '@object-ui/core';
import type { UIActionSchema } from '@object-ui/types';
import { useAction } from '@object-ui/react';
import { useCondition, toPredicateInput, usePredicateRecordContext } from '@object-ui/react';
import { Button } from '../../ui';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../ui';
import { cn } from '../../lib/utils';
import { toFormControlDomProps } from '../../lib/form-control-dom-props';
import { Loader2 } from 'lucide-react';
import { resolveIcon } from './resolve-icon';
import { hasDeclaredVisibilityGate } from './visibility-gate';
import { useAutoTriggerOnce } from './auto-trigger';
import { readStaticParamValues } from './static-params';
import { DisabledReasonTrigger, describedByWithReason, useDisabledReason } from './disabled-reason';

/**
 * The declared props. `schema` is `UIActionSchema` (objectui#4418) for the same
 * reason as `action:button`'s: `target`, `endpoint`, `bodyExtra`, `bodyShape`,
 * `locations`, `enabled` and `size` are all modern-only keys this renderer
 * forwards, and the legacy `crud.ts` `ActionSchema` is `@deprecated` and pins
 * `type: 'action'` where this renderer's own registry `inputs` declare
 * `'script' | 'url' | 'modal' | 'flow' | 'api'`. `actionType` is the DECLARED
 * input carrying that execution type (objectui#7415), for the same reason it is
 * on `action:button`; `type` stays on the intersection as the SDUI envelope's
 * component discriminator and is not read as an action type here.
 */
// `…RendererProps`, not `ActionIconProps` (objectui#11073): `@objectstack/spec/ui` 17.5.0 exports
// `ActionIconProps` as the block's AUTHORED property bag (`actionType`, `label`, `variant`, …).
// This is the React envelope that carries a node (`schema`, `context`, `disabled`, an open
// tail) — a different layer, named as objectui#7265 named `RecordAlertRendererProps`.
export interface ActionIconRendererProps {
  schema: UIActionSchema & { type: string; className?: string; actionType?: string };
  className?: string;
  context?: Record<string, any>;
  /**
   * The host-EVALUATED enablement verdict — see `ActionButtonRendererProps` for the
   * mechanism (objectui#9131). Declared rather than left to the index
   * signature, consumed by name below, never re-spread onto the DOM.
   */
  disabled?: boolean;
  [key: string]: any;
}

// Index signature on the parameter annotation, not on the `forwardRef` type
// argument — mechanism note on `action:bar` (objectui#4422), pinned by
// `__tests__/forwardref-props-annotation.guard.test.ts`.
const ActionIconRenderer = forwardRef<
  HTMLButtonElement,
  {
    schema: ActionIconRendererProps['schema'];
    className?: ActionIconRendererProps['className'];
    context?: ActionIconRendererProps['context'];
  }
>(
  ({ schema, className, context: localContext, ...props }: ActionIconRendererProps, ref) => {
    const {
      'data-obj-id': dataObjId,
      'data-obj-type': dataObjType,
      style,
      // The row `action:bar` forwards to its members. Destructured for TWO
      // reasons: it is the predicate context below (objectui#4075 — this
      // renderer evaluated `visible` / `disabled` / `enabled` against NOTHING,
      // so not even the bare-field shorthand resolved, let alone the canonical
      // `record.` root), and it must not reach `...rest`, which is spread onto
      // the DOM button.
      data,
      // The host's EVALUATED verdict, taken by name — same repair, same
      // mechanism, same card as `action:button` (objectui#9131; the sanctioned
      // fix is objectui#7238's on `ui:button` / `form`). `SchemaRenderer`
      // forwards `disabled: __disabled || undefined` with the key
      // unconditional, `toFormControlDomProps` forwards `disabled` by design,
      // and `pickDomProps` iterates `Object.keys` — so spread after the
      // computed value, a PRESENT `undefined` re-declared it and this
      // renderer's verdict never reached the DOM. Taking it off `rest` removes
      // that second writer; the gate below consumes it instead.
      disabled: hostDisabled,
      ...rest
    } = props;

    const { execute } = useAction();
    const [loading, setLoading] = useState(false);

    // The row bound the three canonical ways — see `usePredicateRecordContext`.
    const recordData = usePredicateRecordContext(data);

    // `visible` fails CLOSED on a predicate that FAULTS, as on `action:button`
    // (objectui#11212, Rider 1 of objectui#4421): a precondition that cannot be
    // evaluated hides the icon and is reported once, rather than showing an
    // action whose guard is broken. The key's policy, not a `can()` special
    // case — `current_user.can(…)` before the permissions payload loads and an
    // unbound root both hide. This leg used to fail SOFT to `true`.
    const isVisible = useCondition(toPredicateInput(schema.visible), recordData, {
      throwOnError: true,
      label: `action "${schema.name ?? schema.label ?? 'action:icon'}" (visible)`,
    });
    // Spec `disabled` (boolean | CEL — disabled when TRUE) primary, legacy
    // non-spec `enabled` fallback (objectstack-ai/objectstack#1885 follow-through — only action-button
    // was wired; this renderer ignored a spec-authored `disabled`). Uncast
    // since objectui#8648 — see `action-button.tsx` for the reading.
    const isDisabledPred = useCondition(toPredicateInput(schema.disabled), recordData);
    const isEnabled = useCondition(toPredicateInput(schema.enabled), recordData);
    // The reason a greyed-out icon gives (objectui#11839) — the same rule as
    // `action:button`: only the DECLARED `disabled` predicate, evaluated true,
    // earns it. See `./disabled-reason`.
    const disabledReason = useDisabledReason(
      hasDeclaredVisibilityGate(schema.disabled) && isDisabledPred,
    );

    const Icon = resolveIcon(schema.icon);
    const variant = schema.variant === 'primary' ? 'default' : (schema.variant || 'ghost');
    const size = 'icon';

    const handleClick = useCallback(async () => {
      if (loading) return;
      setLoading(true);
      try {
        // UI-local escape hatch: direct callback, bypass ActionEngine — the
        // branch `action:menu` and `action:button` take (see action-button.tsx
        // for why it is invoked here rather than forwarded). Neither called nor
        // forwarded, a code-composed `onClick` was silently inert on this
        // surface (objectui#4202).
        if (typeof schema.onClick === 'function') {
          await schema.onClick();
          return;
        }

        // Annotated binding, not an inline literal — see action-button.tsx for
        // the mechanism. `localContext` is `any` (the `PropsWithoutRef` collapse
        // of an index-signature props interface), and a literal that spreads an
        // `any` is not excess-property checked, so this site absorbed unknown
        // keys while `action:group` / `action:menu` rejected them
        // (objectui#4281). `...localContext` is still merged last, so the object
        // reaching `execute` is unchanged.
        const staticValues = readStaticParamValues(schema, 'action:icon');
        const paramsPayload: ActionDef = Array.isArray(schema.params)
          ? { actionParams: schema.params as any, params: staticValues }
          : { params: staticValues };
        const forwarded: ActionDef = {
          // The declared input (objectui#7415). It used to be spelled `type`,
          // which collides with the SDUI envelope's component discriminator:
          // `action:bar` already had to rename it as it spreads a member
          // (`type: componentType, actionType: action.type`), and reading
          // `schema.type` alone on that path handed the runner
          // `type: 'action:icon'` — no handler, no builtin, a click that did
          // nothing with no error and no toast (objectui#6306). The collision is
          // now removed at the source: `actionType` is what the registry
          // `inputs` below declare, so it is the one spelling on every path.
          // No `|| schema.type` fallback — the objectstack#14490 ruling is a
          // rename with no alias and no transition window, and post-rename
          // `schema.type` is the component id on every authored path anyway.
          type: schema.actionType,
          name: schema.name,
          // See action-button.tsx — the param-collection dialog reads its title
          // and description off these (objectui#4192, measured on `action:menu`
          // and found here by `check:action-forward-parity`).
          label: schema.label,
          description: (schema as any).description,
          target: schema.target,
          openIn: (schema as any).openIn,
          endpoint: schema.endpoint,
          method: schema.method,
          // The same two-channel routing as `action:button` (objectui#10289,
          // ruling A): `params` is only the `ActionParam[]` input list, and the
          // static values come from `properties.params`. See `./static-params`.
          ...paramsPayload,
          // See action-button.tsx — the `type: 'api'` payload key (objectstack#6837).
          bodyExtra: schema.bodyExtra,
          // See action-button.tsx — the body-WRAPPING key (objectstack#6938).
          bodyShape: schema.bodyShape,
          // The declarative single-record field write: `operation` alone, for the
          // reasons spelled out at `action:button`'s forward. The runner
          // dispatches on `operation` ahead of `type`; the route writes the
          // named declaration's `patch`, never this node's, so ⛔ no `patch`
          // (objectui#13022).
          operation: schema.operation,
          confirmText: schema.confirmText,
          successMessage: schema.successMessage,
          // See action-button.tsx — success copy per handler outcome, the
          // toast's first rung (objectui#11344).
          outcomeMessages: schema.outcomeMessages,
          errorMessage: schema.errorMessage,
          refreshAfter: schema.refreshAfter,
          // Placement declaration — see action-button.tsx (#2210).
          locations: (schema as any).locations,
          toast: schema.toast,
          // See action-button.tsx — the one-shot reveal spec (2FA setup, fresh
          // OAuth secret). Without it the runner falls back to the success
          // toast and the value the user was meant to copy is gone. The READ is
          // uncast since objectui#8648; the write-side narrowing that stood
          // here went with `43c0d1710`, which made `ResultDialogSpec` derive
          // its label members from the contract. ⛔ Never widen either end back
          // to `as any`.
          resultDialog: schema.resultDialog,
          // See action-button.tsx — the declared post-success hop
          // (objectui#5493). The runner reads it off the forwarded def; dropped
          // here the action succeeds and the authored navigation never runs.
          // Uncast since objectui#5934 (legacy callback channel retired).
          onSuccess: schema.onSuccess,
          // See action-button.tsx — the object the action declares it acts on;
          // dropped here, a retargeted action silently acted on the page's
          // object (objectui#4202). Cast for the same reason as there.
          objectName: (schema as any).objectName,
        };

        await execute({ ...forwarded, ...localContext });
      } finally {
        setLoading(false);
      }
    }, [schema, execute, loading, localContext]);

    // Client-side auto-trigger (#844), through the one shared hook in
    // `./auto-trigger` (objectui#10274). `action:bar` renders an inline member
    // with the renderer its `component` names and spreads the whole action onto
    // that renderer's schema, so an action authored `component: 'action:icon'`
    // arrives HERE carrying the host-composed `autoTrigger` exactly as a default
    // member arrives at `action:button` with it. This renderer used to read
    // neither the flag nor the hook, so a `?runAction=` deep link that the host
    // had already consumed ran nothing and said nothing. The flag's contract is
    // "execute once on mount by whichever renderer receives the action" (#4162),
    // so this renderer consumes it the way its two siblings do.
    //
    // `run` is this icon's own click handler, so an auto-triggered run and a
    // click reach the runner identically (confirm, param dialogs, toasts).
    // `isVisible` is the verdict the early return below consults, so an icon
    // its author hid is refused and reported rather than run (objectui#4191).
    // That verdict carries this renderer's error policy on a faulting predicate
    // (fail-CLOSED since objectui#11212, as on `action:button`): the trigger
    // follows whatever this icon itself renders, and the policy is not decided
    // here.
    useAutoTriggerOnce(schema, isVisible, handleClick);

    // Same gate, same reachability as action-button.tsx (objectui#3823): an
    // `action:icon` member of an `action:bar` gets the author's `visible`
    // spread onto its own schema, and truthiness read a declared `false` as
    // "no gate". See `hasDeclaredVisibilityGate`.
    if (hasDeclaredVisibilityGate(schema.visible) && !isVisible) return null;

    const button = (
      <Button
        ref={ref}
        type="button"
        variant={variant as any}
        size={size}
        className={cn('h-8 w-8', schema.className, className)}
        // Is a `disabled` / `enabled` gate DECLARED? The same question the
        // `visible` gate above asks, so it reads the same definition — the name
        // is historic (objectui#3492 arrived through `visible`), the predicate
        // is key-neutral: "declared" is `!= null && !== ''`. Deliberately NOT
        // renamed or aliased (objectui#3842 ruling, applied here by #3849).
        //
        // `!= null` alone was a live defect on `disabled` in a way it is not on
        // `visible`: the evaluation entry reads an empty predicate as "no
        // condition → true", which means SHOW on `visible` (harmless) but
        // DISABLE here — `disabled: ''` was a permanently greyed-out button.
        // The legacy `enabled` leg is negated, so its `''` case already landed
        // on "not disabled"; routing it through the same definition is
        // behaviour-preserving (derivation table in
        // `__tests__/action-disabled-declared-gate.test.tsx`) and leaves one
        // spelling of "declared" on both legs.
        //
        // `hostDisabled` leads the OR (objectui#9131): the host verdict is a
        // reason to disable, never a reason to enable — `SchemaRenderer` emits
        // `true` or `undefined`, never `false`. See `action:button`.
        disabled={hostDisabled || (
          hasDeclaredVisibilityGate(schema.disabled)
            ? isDisabledPred
            : hasDeclaredVisibilityGate(schema.enabled)
              ? !isEnabled
              : false
        ) || loading}
        onClick={handleClick}
        aria-label={schema.label || schema.name}
        {...toFormControlDomProps(rest)}
        // After the pass-through, so an authored `ariaDescribedBy` and the
        // reason are both kept (objectui#11839). The reason is the icon's
        // DESCRIPTION; its name stays the `aria-label` above.
        aria-describedby={describedByWithReason(rest['aria-describedby'], disabledReason)}
        {...{ 'data-obj-id': dataObjId, 'data-obj-type': dataObjType, style }}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : Icon ? (
          <Icon className="h-4 w-4" />
        ) : (
          <span className="text-xs">{schema.label?.charAt(0) || '?'}</span>
        )}
      </Button>
    );

    // A predicate-disabled icon (objectui#11839): its label tooltip below can
    // never open, since the trigger is the disabled button itself, so the
    // wrapper's tooltip carries the label above the reason.
    if (disabledReason) {
      return (
        <DisabledReasonTrigger reason={disabledReason} heading={schema.label || schema.description}>
          {button}
        </DisabledReasonTrigger>
      );
    }

    // Wrap with tooltip if label is provided
    if (schema.label || schema.description) {
      return (
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>{button}</TooltipTrigger>
            <TooltipContent>
              <p>{schema.label || schema.description}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }

    return button;
  },
);

ActionIconRenderer.displayName = 'ActionIconRenderer';

ComponentRegistry.register('icon', ActionIconRenderer, {
  namespace: 'action',
  skipFallback: true,
  label: 'Action Icon',
  // objectui#11168 slice 1 — the keys after `className` are the spec keys this
  // block's `ComponentPropsMap` row declares, each published because it was
  // measured HONOURED through the block path, exactly as on `action:button`
  // (see its registration). The pins live in
  // `__tests__/action-button-icon-inputs-11168.test.tsx`. `endpoint` stays
  // unpublished for the reason recorded there: the console's own `api`
  // handler reads `target` and never `endpoint`. `outcomeMessages` is
  // forwarded but unpublished, for the reason `action:button` records
  // (objectui#11344).
  inputs: [
    { name: 'name', type: 'string' },
    { name: 'label', type: 'string' },
    { name: 'icon', type: 'string' },
    {
      name: 'actionType',
      type: 'enum',
      enum: ['script', 'url', 'modal', 'flow', 'api'],
    },
    { name: 'target', type: 'string' },
    {
      name: 'variant',
      type: 'enum',
      enum: ['default', 'secondary', 'destructive', 'outline', 'ghost'],
    },
    { name: 'className', type: 'string' },
    {
      name: 'visible',
      type: ['boolean', 'string', 'object'],
      description:
        'Visibility predicate: `true`/`false`, a bare CEL expression, or the `{ dialect: \'cel\', source }` envelope, evaluated against the row the host binds; the icon is not rendered when it is false. Omit for always-visible',
    },
    {
      name: 'disabled',
      type: ['boolean', 'string', 'object'],
      description:
        'Disabled predicate, in the same three shapes as `visible`: the icon is shown but cannot be pressed while it holds. Omit for never-disabled',
    },
    {
      name: 'params',
      type: 'array',
      description:
        'The parameters to collect from the user before the action runs (`ActionParam` objects: `name`, `type`, `label`, …); each collected value reaches the executor under its parameter `name`. Static execution values ride `properties.params` instead',
    },
    {
      name: 'description',
      type: 'string',
      description:
        'Action description — the tooltip text when there is no `label`, and what the parameter dialog shows under its title',
    },
    {
      name: 'openIn',
      type: 'enum',
      enum: ['self', 'new-tab'],
      description: 'For a `url` action: `self` navigates in place, `new-tab` opens a new browser tab',
    },
    {
      name: 'method',
      type: 'string',
      description: 'HTTP method of an `api` action (`POST` when omitted)',
    },
    {
      name: 'bodyExtra',
      type: 'object',
      description:
        'Static request-body fields of an `api` action, merged last, so a constant here overrides a collected value of the same name',
    },
    {
      name: 'bodyShape',
      type: ['enum', 'object'],
      enum: ['flat'],
      description:
        'How an `api` action shapes its request body: `flat` (the default) or `{ wrap: KEY }` to nest the collected values under that key, with `bodyExtra` beside it',
    },
    // objectui#12971: no `patch` input. `@objectstack/spec` retired a row's own
    // `patch` (objectstack#24394): the row runs the declared action its `name`
    // names, and the route writes THAT action's `patch`.
    {
      name: 'operation',
      type: 'enum',
      enum: ['update'],
      description:
        '`update` declares a single-record field write: the row runs the declared action its `name` names, so it needs a `name`. The runner posts the collected values to the platform action route under that name, and the route writes that action\'s own `patch`',
    },
    {
      name: 'confirmText',
      type: 'string',
      description: 'Confirmation question asked before the action runs; the action runs only if it is confirmed',
    },
    {
      name: 'successMessage',
      type: 'string',
      description: 'Toast text when the action succeeds; a `${result.*}` token reads the handler\'s answer (e.g. `${result.id}`)',
    },
    {
      name: 'errorMessage',
      type: 'string',
      description: 'Toast text when the action fails, in place of the raw error',
    },
    {
      name: 'refreshAfter',
      type: 'boolean',
      description: 'Refresh the surrounding data after the action succeeds',
    },
    {
      name: 'locations',
      type: 'array',
      of: 'string',
      description:
        'The placements the action declares (`list_toolbar`, `list_item`, `record_header`, …). A `script` or `flow` action declared record-scoped (`list_item`, `record_header`, `record_more` or `record_section`) refuses to run when no record or single selection is in scope, instead of running without one',
    },
    {
      name: 'toast',
      type: 'object',
      description:
        'Toast behaviour: `{ showOnSuccess?, showOnError?, duration? }` — `false` suppresses that toast, `duration` is handed to the toast',
    },
    {
      name: 'resultDialog',
      type: 'object',
      description:
        'One-shot result dialog for a value the response shows exactly once (a 2FA code, a fresh secret); it replaces the success toast',
    },
    {
      name: 'onSuccess',
      type: 'object',
      description:
        'Post-success navigation `{ navigate, openIn? }`: `navigate` is a route template that can read `${result.*}`, `openIn` is `self` (the default) or `newTab`',
    },
    {
      name: 'objectName',
      type: 'string',
      description: "Object the action acts on — dispatch goes to this object instead of the page's. Omit to act on the page's object",
    },
  ],
  defaultProps: {
    icon: 'play',
    actionType: 'script',
    variant: 'ghost',
  },
});
