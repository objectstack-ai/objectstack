/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * action:button — Smart action button driven by UIActionSchema.
 *
 * Renders a Shadcn Button wired to the ActionRunner. Supports:
 * - All 5 spec action types (script, url, modal, flow, api)
 * - Conditional visibility & enabled state
 * - Loading indicator during async execution
 * - Icon rendering via Lucide
 * - Variant / size / className overrides from schema
 */

import React, { forwardRef, useCallback, useState } from 'react';
import { ComponentRegistry } from '@object-ui/core';
import type { ActionDef } from '@object-ui/core';
import type { UIActionSchema } from '@object-ui/types';
import { useAction, useRecordContext } from '@object-ui/react';
import { useCondition, toPredicateInput, usePredicateRecordContext } from '@object-ui/react';
import { Button } from '../../ui';
import { cn } from '../../lib/utils';
import { toFormControlDomProps } from '../../lib/form-control-dom-props';
import { Loader2 } from 'lucide-react';
import { resolveIcon } from './resolve-icon';
import { hasDeclaredVisibilityGate } from './visibility-gate';
import { useAutoTriggerOnce } from './auto-trigger';
import { readStaticParamValues } from './static-params';
import { DisabledReasonTrigger, describedByWithReason, useDisabledReason } from './disabled-reason';

/** A record value: a plain object, never `null` or an array. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * The static values this button hands the runner, with the record in scope
 * attached as the Undo baseline when the action is an `undoable` update of that
 * record (objectui#11168, ruling B on objectui#11754, record 6030342264).
 *
 * The runner's `operation: 'update'` path offers Undo only when the invoking
 * surface hands it the record the update writes, under `params._rowRecord`: it
 * reads the prior value of every written field off that record
 * (`captureUpdateUndoData`). The record page's declared-actions bar, the
 * related-record bridge, `page:header` and the grid's rows already hand it one.
 * This button handed it nothing, so a declared `undoable` was dropped one hop
 * before the runner. This is the same spelling those hosts use; the dispatch
 * strips the stash before it POSTs.
 *
 * Attached only when all of these hold, and otherwise `values` is returned
 * as it came, the same object:
 *
 * - the action declares `undoable` and `operation: 'update'`, the path the
 *   ruling names. On an `api` action the console's handler reads the stash for
 *   more than Undo (it fills `{field}` tokens in the URL and seeds
 *   `recordIdParam`), and this ruling does not change that path.
 * - a record is in scope.
 * - the update writes THAT record. The id the dispatch resolves (an explicit
 *   `recordId` value, else the record's `recordIdField`, `id` by default) must
 *   be the record's own `id`, because the runner keys the Undo by
 *   `recordId ?? record.id`. A button in a record's scope that writes another
 *   record would otherwise get the scoped record's values as its Undo, and an
 *   Undo that restores the wrong values is worse than none.
 */
function withUndoBaseline(
  schema: Pick<UIActionSchema, 'undoable' | 'operation' | 'recordIdField'>,
  values: Record<string, unknown> | undefined,
  record: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!schema.undoable || schema.operation !== 'update' || !record) return values;
  const writtenId = values?.recordId ?? record[schema.recordIdField || 'id'];
  if (writtenId == null || record.id == null || String(writtenId) !== String(record.id)) return values;
  return { ...values, _rowRecord: record };
}

/**
 * The declared props. `schema` is `UIActionSchema` (objectui#4418): every key
 * this renderer forwards below — `target`, `endpoint`, `bodyExtra`,
 * `bodyShape`, `locations`, `enabled`, `size` — is declared by the modern type
 * and by no other, and the legacy `crud.ts` `ActionSchema` it used to name is
 * `@deprecated` and requires `type: 'action'` (this renderer serves
 * `'script' | 'url' | 'modal' | 'flow' | 'api'`).
 *
 * `actionType` is the DECLARED input carrying the action's execution type
 * (objectui#7415, objectstack#14490 ruling A). `type` stays on the intersection
 * as the SDUI envelope's component discriminator — `'action:button'` on every
 * authored path — and is no longer read as an action type by anything here.
 */
// `…RendererProps`, not `ActionButtonProps` (objectui#11073): `@objectstack/spec/ui` 17.5.0 exports
// `ActionButtonProps` as the block's AUTHORED property bag (`actionType`, `label`, `variant`, …).
// This is the React envelope that carries a node (`schema`, `context`, `disabled`, an open
// tail) — a different layer, named as objectui#7265 named `RecordAlertRendererProps`.
export interface ActionButtonRendererProps {
  schema: UIActionSchema & { type: string; className?: string; actionType?: string };
  className?: string;
  /** Override context for this specific action */
  context?: Record<string, any>;
  /**
   * The host-EVALUATED enablement verdict, declared rather than left to the
   * index signature (objectui#9131). `SchemaRenderer` evaluates the node's
   * `disabled` / `disabledOn` and forwards the answer under this name as
   * `disabled: __disabled || undefined`. It is consumed by name below and
   * therefore never reaches the DOM spread — see the destructure.
   */
  disabled?: boolean;
  [key: string]: any;
}

// `PropsWithoutRef` would collapse `ActionButtonRendererProps` to its bare index
// signature, so the type argument carries the declared props WITHOUT it (each
// derived off `ActionButtonRendererProps`, so the two cannot drift) and the index
// signature stays on the parameter annotation — mechanism note on `action:bar`
// (objectui#4422), pinned by
// `__tests__/forwardref-props-annotation.guard.test.ts`.
const ActionButtonRenderer = forwardRef<
  HTMLButtonElement,
  {
    schema: ActionButtonRendererProps['schema'];
    className?: ActionButtonRendererProps['className'];
    context?: ActionButtonRendererProps['context'];
  }
>(
  ({ schema, className, context: localContext, ...props }: ActionButtonRendererProps, ref) => {
    const {
      'data-obj-id': dataObjId,
      'data-obj-type': dataObjType,
      style,
      data,
      // The host's EVALUATED verdict, taken by name — and taking it OFF `rest`
      // is the load-bearing half (objectui#9131, the repair objectui#7238 made
      // on `ui:button` and `form`). `toFormControlDomProps` forwards `disabled`
      // deliberately (this host IS a form control) and `pickDomProps` iterates
      // `Object.keys`, so a `disabled` key PRESENT with the value `undefined`
      // re-declares and wins. `SchemaRenderer` always hands down exactly that
      // shape — `disabled: __disabled || undefined`, key unconditional, only
      // the value conditional — so spread after the computed value it
      // overwrote this renderer's own verdict with `undefined` on the way to
      // the DOM. The legacy `enabled` leg took the whole loss: the node gate
      // never consults `enabled`, so its forwarded value is `undefined` for
      // every `enabled` shape, and a control the author declared disabled
      // stayed pressable on the ordinary `SchemaRenderer` path — fail-OPEN.
      // Destructuring it here removes that second writer; the gate below is now
      // the only one, and it consumes this verdict instead of losing to it.
      disabled: hostDisabled,
      ...rest
    } = props;

    const { execute } = useAction();
    const [loading, setLoading] = useState(false);

    // Record data may be passed from SchemaRenderer (e.g. DetailView passes
    // record data), bound the three canonical ways — `record.status`, bare
    // `status`, `data.status` (objectui#4075). This used to be the row spread
    // flat, so the CANONICAL `record.` root threw `record is not defined` and
    // the fail-closed `visible` below turned that into "hidden".
    const recordData = usePredicateRecordContext(data);

    // The record in scope for an `undoable` update's Undo baseline
    // (objectui#11168, see `withUndoBaseline`): the row the host binds through
    // `data` (a table's row, `DetailView`'s header, an `action:bar` member),
    // else the record page's own record. An authored record page renders this
    // node through `SchemaRenderer` with no `data`; its record is the
    // `RecordContext` one, the record `${record.*}` in `properties` reads.
    const recordContext = useRecordContext();
    const recordInScope = asRecord(data) ?? asRecord(recordContext?.data);

    // Evaluate visibility and disabled conditions with record data context.
    // `visible` fails CLOSED on a throwing predicate (mirrors ActionEngine's
    // getActionsForLocation) — a precondition that can't be evaluated should
    // hide the action, not silently show one whose guard is broken.
    const isVisible = useCondition(toPredicateInput(schema.visible), recordData, {
      throwOnError: true,
      label: `action "${schema.name ?? schema.label ?? 'action:button'}" (visible)`,
    });
    // Spec field is `disabled` (boolean | CEL predicate — disabled when TRUE).
    // It previously had zero consumers (the renderer only read a non-spec
    // `enabled`), so a spec-authored `disabled` guard did nothing (objectstack-ai/objectstack#1885,
    // ADR-0049). We now consume `disabled` as the primary control and keep the
    // legacy non-spec `enabled` as a deprecated fallback so existing metadata
    // keeps working. Uncast since objectui#8648: the mirror declares `disabled`
    // by derivation from the contract, so the three arms the spec accepts
    // (boolean, raw CEL, `{ dialect, source }` envelope) are the compiler's
    // business here instead of `any`'s.
    const isDisabled = useCondition(toPredicateInput(schema.disabled), recordData);
    const isEnabled = useCondition(toPredicateInput(schema.enabled), recordData);
    // The reason a greyed-out button gives (objectui#11839): only the DECLARED
    // `disabled` predicate, evaluated true, earns it — the verdict that is a
    // fact about the record. `hostDisabled`, `loading` and the legacy `enabled`
    // leg disable the button without one. See `./disabled-reason`.
    const disabledReason = useDisabledReason(
      hasDeclaredVisibilityGate(schema.disabled) && isDisabled,
    );

    // Resolve icon
    const Icon = resolveIcon(schema.icon);

    // Map schema variant to Shadcn button variant
    const variant = schema.variant === 'primary' ? 'default' : (schema.variant || 'default');
    const size = schema.size === 'md' ? 'default' : (schema.size || 'default');

    const handleClick = useCallback(async () => {
      if (loading) return;
      setLoading(true);

      try {
        // UI-local escape hatch: direct callback, bypass ActionEngine — the
        // same branch `action:menu`'s `handleExecute` and `page:header` take,
        // with the precedence `UIActionSchema.onClick` documents ("takes
        // precedence over `type` / `target`"). It is a function, so it only
        // ever arrives from a code-composed schema (an `action:bar` member is
        // spread onto this node whole). Forwarding it instead would not honour
        // that precedence: the runner reads `onClick` only as a LAST fallback,
        // after a registered handler or builtin executor for the declared type
        // has already run. Neither called nor forwarded, it was silently inert
        // here while the same action in the overflow menu ran (objectui#4202).
        if (typeof schema.onClick === 'function') {
          await schema.onClick();
          return;
        }

        // Route params (objectui#10289, ruling A):
        // - `params` is only ever the `ActionParam[]` input list → forwarded as
        //   `actionParams` for collection.
        // - Static execution values come from `properties.params` (see
        //   `./static-params`) → forwarded as the runner's `params`. A
        //   node-level OBJECT `params` is not read as values; it is ignored
        //   with a development warning.
        //
        // Annotated rather than inferred: a spread SOURCE's own keys are not
        // excess-property checked through the spread, so an invented key in
        // either branch would be absorbed silently. Measured on objectui#4281 —
        // `const p = cond ? { actionParams } : { zzBogus }` is accepted by an
        // `ActionDef` literal that spreads it; annotating `p` rejects it here.
        //
        // The two channels are independent, so the input-list branch forwards
        // the static values too.
        //
        // An `undoable` update of the record in scope also carries that record
        // as its Undo baseline (objectui#11168); see `withUndoBaseline`.
        const staticValues = withUndoBaseline(
          schema,
          readStaticParamValues(schema, 'action:button'),
          recordInScope,
        );
        const paramsPayload: ActionDef = Array.isArray(schema.params)
          ? { actionParams: schema.params as any, params: staticValues }
          : { params: staticValues };

        // ── Why this is a named `ActionDef` binding and not an inline literal ──
        //
        // `ActionDef` is CLOSED (objectui#4046 / objectstack#4075 step 3), so an
        // invented or misspelled key at a forward site is a TS2353 — but only
        // where TypeScript actually RUNS the excess-property (freshness) check.
        // It does not run it on a literal that spreads a value of type `any`,
        // and `localContext` is exactly that: `PropsWithoutRef` collapses
        // `ActionButtonRendererProps` (which carries an `[key: string]: any` index
        // signature) to a pure index-signature type, so every destructured prop
        // arrives as `any`. Spreading it into the payload made this site absorb
        // unknown keys in silence while `action:group` / `action:menu` — same
        // payload, no spread — rejected them (objectui#4281, measured in both
        // directions).
        //
        // Hoisting the explicit keys into this annotated binding restores the
        // check on them, independently of what the composed spreads are typed
        // as. Key ORDER is deliberately unchanged (`...paramsPayload` keeps its
        // original position and `...localContext` is still merged last), so the
        // object that reaches `execute` is identical — see
        // `__tests__/action-forward-precedence.test.tsx`.
        const forwarded: ActionDef = {
          // The declared input, renamed off the colliding `type` spelling by
          // objectui#7415: on the SDUI envelope `type` is the component
          // discriminator, so on every authored path (`SchemaRenderer`, the
          // react-page wrapper, `action:bar`'s member spread) `schema.type` is
          // `'action:button'` and never an action type. No `|| schema.type`
          // fallback — the ruling is a rename with no alias and no transition
          // window; a declaration that omits `actionType` now leaves this
          // `undefined` and `ActionRunner.execute` falls through to its
          // `action.name` leg, instead of being handed the component id.
          type: schema.actionType,
          name: schema.name,
          // Forward the human label/description so a param-collection dialog
          // can title itself as the action ("Create Environment") instead of a
          // generic "Action parameters" prompt.
          label: schema.label,
          description: (schema as any).description,
          target: schema.target,
          // Static "open in new tab" switch for url actions — forward so the
          // runner's executeUrl honors it (dropped, the toggle is silently lost).
          openIn: (schema as any).openIn,
          endpoint: schema.endpoint,
          method: schema.method,
          ...paramsPayload,
          // Static request body of a `type: 'api'` action, merged last by the
          // runner. Separate key from `params` by the objectstack#5777 ruling —
          // dropping it here left a declared action whose payload lives only in
          // `bodyExtra` POSTing nothing (objectstack#6837).
          bodyExtra: schema.bodyExtra,
          // How that body is SHAPED — `'flat'` or `{ wrap: key }`. Read
          // unconditionally by the console apiHandler and by the runner's own
          // executeAPI, so dropping it here did not fail: the action POSTed a
          // flat body while its declaration said `{ wrap: 'data' }`
          // (objectstack#6938). Sibling of `bodyExtra` above, same whitelist,
          // same failure mode.
          bodyShape: schema.bodyShape,
          // The declarative single-record field write. `operation` is authored
          // BESIDE `type`, not inside it — the spec materializes `type: 'script'`
          // here and `ActionType` gained no member — so a forward that carries
          // `type` alone tells the runner nothing about this action.
          // `@object-ui/core`'s runner dispatches on `operation` ahead of `type`.
          //
          // ⛔ No `patch` (objectui#13022). The route writes the `patch` of the
          // DECLARATION this node's `name` names, never a row's own:
          // `@objectstack/spec` 18 retires the row key. The runner reads that
          // declaration by name from what its host publishes, for the Undo
          // snapshot only; the request has carried no `patch` since
          // objectui#12941.
          operation: schema.operation,
          confirmText: schema.confirmText,
          successMessage: schema.successMessage,
          // Success copy per handler outcome (spec 17.6.0, objectui#11344): the
          // runner's success toast reads the entry named by the answer's
          // `outcome` ahead of `successMessage`. An action-bar member is spread
          // onto this node whole, so a registered action's map arrives here
          // and, dropped, would never reach the toast — the objectstack#6837
          // shape on the copy instead of the payload.
          outcomeMessages: schema.outcomeMessages,
          errorMessage: schema.errorMessage,
          refreshAfter: schema.refreshAfter,
          // Forward `undoable` (and the row id field) so update actions can
          // offer an Undo affordance — without this the flag is dropped and the
          // handler never builds the undo operation. Both uncast since
          // objectui#8648: `@objectstack/spec`'s `Action` declares each, so the
          // mirror declares each, and the forward is compiler-checked against
          // `ActionDef` instead of arriving as `any`.
          undoable: schema.undoable,
          recordIdField: schema.recordIdField,
          // Forward the placement declaration — the console runtime uses it to
          // tell record-scoped actions (also mounted on rows) from pure
          // object-level toolbar actions when no row is selected (#2210).
          locations: (schema as any).locations,
          toast: schema.toast,
          // One-shot reveal dialog for actions whose response is shown
          // exactly once (2FA setup, OAuth client_secret, regenerated
          // backup codes). Without this forward the ActionRunner falls
          // back to the success toast and the user loses the value.
          //
          // Both ends uncast: the READ since objectui#8648 (`resultDialog` is
          // declared on the mirror, so the compiler types it as the contract's
          // own block), and the WRITE since `43c0d1710` retired the narrowing
          // assertion that stood here — `ActionDef['resultDialog']` now DERIVES
          // its label members from the contract instead of hand-writing them as
          // `string`, so the whole forward type-checks against one declared
          // meaning. ⛔ Never widen either end back to `as any`: that one
          // spelling hid the missing declaration AND the drifted mirror at once.
          resultDialog: schema.resultDialog,
          // Declared post-success navigation — spec's closed strict
          // `{ navigate, openIn }` block, authorable on `ActionSchema` since
          // @objectstack/spec 17.1.0 (objectui#5328). The runner reads it off
          // the FORWARDED def at execute time (`handlePostExecution` →
          // `readOnSuccessNavigation` → `navigateOnSuccess`, which hops through
          // the app's own `navigationHandler`). Dropped here, the action
          // succeeded and the declared hop silently never happened —
          // objectui#5493, the same shape as `bodyShape` / `resultDialog`
          // above. Uncast since objectui#5934 retired the runner's legacy
          // chained-callback meaning: both ends now derive the spec block
          // (`UIActionSchema.onSuccess` on the read side,
          // `ActionDef.onSuccess` on the write side), so the forward
          // type-checks against the one declared meaning instead of hiding
          // behind `as any`.
          onSuccess: schema.onSuccess,
          // The object the action declares it acts on (spec `ActionSchema`:
          // "Target object this action belongs to"). The console resolves its
          // dispatch target as `action.objectName || <page object>` — in the
          // generic api handler, the flow handler, the param dialog's i18n scope
          // and `createServerActionHandler`'s `/api/v1/actions/{object}/…` URL —
          // so dropped here, an action retargeting another object (a child
          // record's action rendered on its parent's page) silently acted on
          // the PAGE's object instead, with no error (objectui#4202). An action
          // that declares none still falls back to the page object, exactly as
          // before. Cast because the `@object-ui/types` mirror does not declare
          // the key on `UIActionSchema` (tsc refuses the bare read with TS2339);
          // the write is checked against `ActionDef`, which does.
          objectName: (schema as any).objectName,
        };

        await execute({ ...forwarded, ...localContext });
      } finally {
        setLoading(false);
      }
    }, [schema, execute, loading, localContext, recordInScope]);

    // Client-side auto-trigger (#844): a caller (e.g. a welcome-page CTA that
    // deep-links into "create") can mark an action `autoTrigger: true` to run
    // it once as soon as the button receives it — the exact same execute path
    // as a click, so param dialogs / confirms / entitlement gates all still
    // apply. The guard and the flag test live in `./auto-trigger` because this
    // is no longer the only consumer: `action:menu` runs the same contract for
    // the actions that spill past `action:bar`'s `maxVisible` (#4162), and
    // once-ness written twice is two behaviours waiting to drift.
    //
    // It is handed this button's own `visible` verdict — the one the early
    // return below consults — because the action's declared gate outranks the
    // flag (objectui#4191): a hidden action is refused and reported, not run.
    useAutoTriggerOnce(schema, isVisible, handleClick);

    // A declared boolean `visible: false` is a verdict, not a missing gate —
    // truthiness classified it as "ungated" and rendered the action for
    // everyone (objectui#3823). Reachable because `action:bar` bypasses
    // `SchemaRenderer` and spreads the whole member action onto this schema, so
    // this gate is the only one on that path. See `hasDeclaredVisibilityGate`.
    if (hasDeclaredVisibilityGate(schema.visible) && !isVisible) return null;

    const button = (
      <Button
        ref={ref}
        type="button"
        variant={variant as any}
        size={size as any}
        className={cn(schema.className, className)}
        // Is a `disabled` / `enabled` gate DECLARED? Same question as the
        // `visible` gate above, so it reads the same definition — the name is
        // historic (objectui#3492 arrived through `visible`); the predicate is
        // key-neutral: "declared" means `!= null && !== ''`, an empty predicate
        // is nothing to evaluate and therefore no gate. Deliberately NOT
        // renamed or aliased for this call site (objectui#3842 ruling): one
        // implementation under two names is how a repo grows dialects.
        //
        // `!= null` alone was a live defect here in a way it is not on
        // `visible` (objectui#3842). The evaluation entry reads an empty
        // predicate as "no condition → true"; on `visible` that `true` means
        // SHOW, so an over-broad "declared" test cancels out, while here it
        // means DISABLE — `disabled: ''` was a permanently greyed-out button.
        //
        // The legacy `enabled` leg is negated (`!isEnabled`), so its `''` case
        // already landed on "not disabled" by double negation; routing it
        // through the same definition is behaviour-preserving for all four
        // shapes (derivation table in
        // `__tests__/action-disabled-declared-gate.test.tsx`) and keeps one
        // spelling of "declared" on both legs.
        //
        // `hostDisabled` leads the OR (objectui#9131): the host verdict is a
        // reason to disable, never a reason to enable. `SchemaRenderer` emits
        // `true` or `undefined` and never `false`, so OR-ing it is exactly
        // "the node gate said disable, or this renderer's own gate did, or an
        // execution is in flight" — one carrier, three sources, no re-declare.
        disabled={hostDisabled || (
          hasDeclaredVisibilityGate(schema.disabled)
            ? isDisabled
            : hasDeclaredVisibilityGate(schema.enabled)
              ? !isEnabled
              : false
        ) || loading}
        onClick={handleClick}
        {...toFormControlDomProps(rest)}
        // After the pass-through, so an authored `ariaDescribedBy` and the
        // reason are both kept (objectui#11839).
        aria-describedby={describedByWithReason(rest['aria-describedby'], disabledReason)}
        {...{ 'data-obj-id': dataObjId, 'data-obj-type': dataObjType, style }}
      >
        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {!loading && Icon && <Icon className={cn('h-4 w-4', schema.label && 'mr-2')} />}
        {schema.label}
      </Button>
    );
    // A predicate-disabled button is wrapped in the trigger that carries its
    // reason (objectui#11839); any other button is returned as it was.
    return <DisabledReasonTrigger reason={disabledReason}>{button}</DisabledReasonTrigger>;
  },
);

ActionButtonRenderer.displayName = 'ActionButtonRenderer';

ComponentRegistry.register('button', ActionButtonRenderer, {
  namespace: 'action',
  skipFallback: true,
  label: 'Action Button',
  // objectui#11168 slice 1 — the keys after `className` are the spec keys this
  // block's `ComponentPropsMap` row declares, each published because it was
  // measured HONOURED through the block path: the real `SchemaRenderer` hands
  // it to this renderer, which consumes it or forwards it, and the runner (or
  // the handler it dispatches to) acts on the forwarded value. The pins live
  // in `__tests__/action-button-icon-inputs-11168.test.tsx`. `action:icon`
  // publishes the same list minus `recordIdField`, which its spec row does not
  // declare (and its renderer does not forward); the two are kept literal so
  // the source readers that census registrations can still name every entry.
  //
  // `undoable` was held back by slice 1 with its measurement: the runner's
  // update path offers Undo only when the invoking surface hands it the
  // record it writes, and this block handed it none. Ruling B on objectui#11754
  // (record 6030342264) made the block deliver it: an `undoable` update of the
  // record in scope now carries that record as its Undo baseline
  // (`withUndoBaseline` above), and the key is published at the end of this
  // list. Pinned in `__tests__/action-button-undoable-11168.test.tsx`.
  // `endpoint` is not on this row: 17.6.0 refuses it in favour of `target`.
  //
  // `outcomeMessages` is FORWARDED above but not published here
  // (objectui#11344): it is an `ActionSchema` key, which reaches this renderer
  // on the `action:bar` member path, and this block's own row does not accept
  // it at the installed spec — `registry-inputs-spec-parity.test.ts` refuses an
  // input the row does not declare. The input follows the row, upstream.
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
      enum: ['default', 'primary', 'secondary', 'destructive', 'outline', 'ghost'],
    },
    // objectui#11168 slice 2 — the five sizes the spec row declares, each
    // measured through the real `SchemaRenderer`: `default`, `sm`, `lg` and
    // `icon` reach the Button primitive as-is, and `md` renders as `default`
    // (the mapping above). `default` and `icon` were unpublished, so the page
    // validator refused two values the renderer honours. Pinned in
    // `__tests__/action-button-icon-inputs-11168.test.tsx`.
    {
      name: 'size',
      type: 'enum',
      enum: ['default', 'sm', 'md', 'lg', 'icon'],
      description:
        'Button size: the Button primitive\'s `default`, `sm`, `lg` or `icon`, plus `md`, which renders as `default` (default: `default`)',
    },
    { name: 'className', type: 'string' },
    {
      name: 'visible',
      type: ['boolean', 'string', 'object'],
      description:
        'Visibility predicate: `true`/`false`, a bare CEL expression, or the `{ dialect: \'cel\', source }` envelope, evaluated against the row the host binds; the button is not rendered when it is false, nor when the predicate fails to evaluate. Omit for always-visible',
    },
    {
      name: 'disabled',
      type: ['boolean', 'string', 'object'],
      description:
        'Disabled predicate, in the same three shapes as `visible`: the button is shown but cannot be pressed while it holds. Omit for never-disabled',
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
      description: 'Action description — the parameter dialog shows it under its title',
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
    {
      name: 'recordIdField',
      type: 'string',
      description:
        'For a `script` action run against a single selected row: the row field whose value is sent as the record id (default `id`)',
    },
    {
      name: 'undoable',
      type: 'boolean',
      description:
        'Offer an Undo affordance after an update action: once an `operation: update` succeeds, its success toast offers Undo, which writes back the values the fields it wrote held on the record in scope (the record page\'s record, or the row the host binds), provided that record carries each of them. The one limit: a button with no record in scope (standalone, or writing a record other than the one in scope) offers no Undo, because there is no row to restore',
    },
  ],
  defaultProps: {
    label: 'Action',
    actionType: 'script',
    variant: 'default',
    size: 'md',
  },
});
