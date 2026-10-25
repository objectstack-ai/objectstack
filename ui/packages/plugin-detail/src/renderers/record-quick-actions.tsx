/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `record:quick_actions` — Salesforce Lightning-style quick action bar.
 * Consumes the spec's `ActionDef[]` (see `packages/spec/src/ui/action.zod.ts`)
 * via `useActionEngine`, which handles location filtering, shortcut binding,
 * bulk mode, condition evaluation, and the execution pipeline (api / navigate
 * / onClick / toast / reload / redirect, etc.).
 *
 * Default location is `record_header` — drop this component into a page:header
 * region (or page:tabs/toolbar) to surface the per-record action set.
 */

import React from 'react';
import { useRecordContext, useActionEngine, useMetadataItem, useCondition, toPredicateInput, useActionTextLocalizer, usePreviewMode } from '@object-ui/react';
import { usePermissions } from '@object-ui/permissions';
import {
  Button,
  type ButtonProps,
  cn,
  hasDeclaredVisibilityGate,
  resolveIcon,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@object-ui/components';
import { useSafeTranslate } from '@object-ui/i18n';
import { Loader2 } from 'lucide-react';
import type { ActionDef, ActionLocation } from '@object-ui/core';
import { resolveDeclaredActionIds } from '@object-ui/types';
import type { DeclaredActionsRefusal } from '@object-ui/types';
import { useRecordAriaProps, type AuthoredRecordAria } from './recordComponentAria';
import { recordBindingBlock } from './recordBinding';

const splitDesigner = (props: Record<string, any>) => {
  const { 'data-obj-id': id, 'data-obj-type': type, style, ...rest } = props || {};
  return { designer: { 'data-obj-id': id, 'data-obj-type': type, style }, rest };
};

type QuickActionButtonVariant = NonNullable<ButtonProps['variant']>;

/**
 * An action's spec `variant` (`ActionSchema.variant`: `primary | secondary |
 * danger | ghost | link`, where "danger = destructive") mapped onto the
 * `Button` primitive's vocabulary — the same reading the record header and
 * the row menu give it (objectui#12986). Without it `danger` and `primary`
 * reached `Button` raw, matched no cva variant, and drew unstyled. Kept
 * local: no package this one depends on exports the mapping.
 */
const SPEC_ACTION_TO_BUTTON_VARIANT: Record<
  NonNullable<ActionDef['variant']>,
  QuickActionButtonVariant
> = {
  primary: 'default',
  secondary: 'secondary',
  danger: 'destructive',
  ghost: 'ghost',
  link: 'link',
};

/** A stable empty array, so an absent `actions` / `actionNames` does not mint one per render. */
const EMPTY_DECLARED_ACTIONS: readonly unknown[] = Object.freeze([]);

/**
 * Warn-once ledger for a refused action array (objectui#7182), keyed by
 * object, key and verdict so one page cannot spam the console across
 * re-renders — the `page:header` reporter keeps the same ledger shape.
 */
const _refusedDeclaredActions = new Set<string>();

/**
 * Report an `actions` / `actionNames` array `resolveDeclaredActionIds` refused
 * — a mixed id/object array, or an element that is neither (objectui#7182,
 * maintainer ruling 2026-09-02, option C).
 *
 * `console.error`, not `warn`: a refused array is metadata the contract does
 * not accept, and this bar draws NONE of its authored actions rather than the
 * half it could. The message names the offending index so the fix is a
 * one-element edit, and the surface, so the same array refused by
 * `page:header` reads as the same rule.
 */
function reportRefusedQuickActions(
  objectName: string,
  key: 'actionNames' | 'actions',
  refusal: DeclaredActionsRefusal,
): void {
  const ledgerKey = `${objectName}::${key}::${refusal.index}::${refusal.message}`;
  if (_refusedDeclaredActions.has(ledgerKey)) return;
  _refusedDeclaredActions.add(ledgerKey);
  console.error(
    `[record:quick_actions] ${key} refused at index ${refusal.index} — ${refusal.message}. ` +
    'None of the authored actions is rendered. `actionNames` is a list of ACTION IDS resolved ' +
    "from the object's own `actions`; an inline action object is the host's runtime channel " +
    'and must not share an array with ids.',
  );
}

export interface RecordQuickActionsRendererProps {
  schema?: {
    actions?: ActionDef[];
    location?: ActionLocation;
    requiredPermissions?: string[];
    align?: 'start' | 'center' | 'end';
    size?: 'sm' | 'default' | 'lg';
    variant?: 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive' | 'link';
    /**
     * Accessible name for the toolbar. `ariaLabel` is the spelling
     * `@objectstack/spec`'s `AriaPropsSchema` accepts; `label` is that shape's
     * alias entry, refused on parse. objectui#4663 kept `label` as a
     * back-compat read for documents written before the contract closed, and
     * objectui#9945 retired that read: a served `label` is reported, not read.
     *
     * ⚠️ `RecordQuickActionsProps` in `@objectstack/spec` declares NO `aria`
     * key at all — measured, not recalled, by
     * `__tests__/recordComponentAria-9556.test.tsx`, whose census reads the
     * installed artifact. So the contract REFUSES this bag on this block
     * (`unrecognized_keys`), and no contract-valid document reaches the read
     * below. The read is kept, and typed as the family's bag rather than
     * re-spelled, because the protocol's own refusal message names objectui's
     * renderer as the thing that has to move first. ⛔ Do not mirror this key
     * onto a published `@object-ui/types` face: that would declare, on this
     * repo's contract face, a key the protocol refuses.
     */
    aria?: AuthoredRecordAria;
    properties?: Record<string, any>;
    [k: string]: any;
  };
  className?: string;
  [k: string]: any;
}

const RecordQuickActionsBody: React.FC<RecordQuickActionsRendererProps> = ({
  schema = {} as any,
  className,
  ...props
}) => {
  const ctx = useRecordContext();
  const { designer } = splitDesigner(props);
  /**
   * The toolbar's ARIA, through the family's ONE read point (objectui#9556).
   *
   * Called up here with the other hooks because two early returns sit below
   * (the permission gate and the empty-bar placeholder).
   *
   * objectui#4663 made this bar read canonical `aria.ariaLabel` first, the
   * refused `aria.label` alias behind it, the built-in name when neither
   * resolves. It used to be spelled here and only here, which is how five
   * sibling blocks came to read nothing and `record:path` came to read only the
   * alias. The family now shares the canonical half; objectui#9945 retired the
   * alias half, so `aria.ariaLabel` or the built-in name is all this reads.
   *
   * `SchemaRenderer`'s generic ARIA channel is no escape hatch on this surface:
   * it reads the FLAT `schema.ariaLabel` and injects `aria-label` as a
   * component PROP, which `splitDesigner` above drops with every other
   * non-designer prop. The nested bag is the only live path for an authored
   * name here.
   *
   * `role="toolbar"` is passed as the DEFAULT rather than written on the
   * element, so an author's `aria.role` can override it — the precedence
   * `ListView` ships — while a document that declares no `aria` still renders
   * the toolbar role this bar has always had.
   */
  const toolbarAria = useRecordAriaProps(schema.aria, {
    defaultRole: 'toolbar',
    defaultLabel: 'Quick actions',
    // Named so a served `aria.label` is REPORTED (objectui#9945). objectui#4663
    // gave this bar a fold for that spelling, for documents written before the
    // shape closed; objectui#9945 retired it. Such a document now gets the
    // built-in name above, and the report says why.
    block: 'record:quick_actions',
  });
  const perms = usePermissions();
  /**
   * Is this bar drawn on a design / metadata preview surface (the Studio page
   * canvas) rather than a live runtime route? The existing `@object-ui/react`
   * signal, set by the preview surfaces that mount `PreviewModeProvider`; it
   * defaults to `false`, so every runtime view reads "not authoring". Read up
   * here with the other hooks because of the early returns below
   * (objectui#12995).
   */
  const authoring = usePreviewMode();
  // The ONE resolver for a declared action's authored strings (objectui#4265).
  // This bar used to localize the button `label` only, while `executeAction`
  // ran the RAW def looked up out of the object's metadata — so its confirm
  // dialog rendered the authored English `confirmText` next to a translated
  // button, from the same `_actions.<name>` bundle entry.
  const localizeActionTexts = useActionTextLocalizer();

  // Spec bridge inlines `properties.*` onto the node but also preserves the
  // raw bag. Read from both for compatibility.
  const rawActions: readonly unknown[] = Array.isArray(schema.actions)
    ? schema.actions
    : Array.isArray(schema.properties?.actions)
      ? schema.properties!.actions
      : EMPTY_DECLARED_ACTIONS;
  const actionNames: readonly unknown[] = Array.isArray(schema.actionNames)
    ? schema.actionNames
    : Array.isArray(schema.properties?.actionNames)
      ? schema.properties!.actionNames
      : EMPTY_DECLARED_ACTIONS;

  const objectName = ctx?.objectName || '';

  // A record context that names an object but NO record has nothing to run a
  // record action against. That is what a `dataSource` binding matching no row
  // provides (objectui#12294, `./recordBinding`): the bar then offers no action
  // and draws nothing, the 0-row semantics of a bound record block (the empty
  // bar's rules are below, objectui#12995).
  // The record page always names its record, so its bar is unaffected.
  const noRecord = ctx != null && ctx.recordId == null;

  // ONE array, ONE rule (objectui#7182, maintainer ruling 2026-09-02, option C).
  // `actionNames` is the spec-declared spelling (`RecordQuickActionsProps`:
  // action ids, resolved from the object's own `actions`); `actions` is the
  // host's runtime channel (`layout:page-header` delegation, the page
  // synthesizer). Whichever is authored, its SHAPE and its resolution are
  // `resolveDeclaredActionIds`'s call — the same function `page:header` calls —
  // so an array is all ids or all inline objects, and a mixed
  // `['convert', { … }]` is REFUSED with the offending index named, not
  // half-drawn. This bar used to switch on the WHOLE array
  // (`every(a => typeof a === 'string')`): a mixed array took the object path
  // and the bare string reached the engine as an "ActionDef" that rendered
  // nothing, while `page:header` normalised per element and drew both — one
  // authored array, two meanings.
  const declaredKey: 'actionNames' | 'actions' = actionNames.length > 0 ? 'actionNames' : 'actions';
  const declaredElements = actionNames.length > 0 ? actionNames : rawActions;
  // Registry-independent verdict first — the same function, called with no
  // registry: `kind` and `ids` are final from the shape alone, which is all
  // the hook-order question needs (`useMetadataItem` runs every render, so the
  // read is requested or skipped before the registry exists; `null` is its
  // documented no-op).
  const declaredShape = resolveDeclaredActionIds<ActionDef>(declaredElements, undefined);
  // Lookup-by-name path: resolve the ActionDef[] from the object's own
  // metadata. Keeps page schemas DRY — actions stay defined once on the object.
  const needsLookup = declaredShape.kind === 'ids' && declaredShape.ids.length > 0 && !!objectName;
  const { item: objectMeta } = useMetadataItem('object', needsLookup ? objectName : null);
  const declared = resolveDeclaredActionIds<ActionDef>(
    declaredElements,
    Array.isArray(objectMeta?.actions) ? (objectMeta!.actions as ActionDef[]) : [],
  );
  if (declared.kind === 'refused') reportRefusedQuickActions(objectName, declaredKey, declared);
  const authoredActions: ActionDef[] = declared.kind === 'refused' ? [] : declared.actions;

  /**
   * Localize once, before the defs reach `useActionEngine` (objectui#4265).
   *
   * `executeAction(name)` runs the def out of THIS array, and the button below
   * renders `action.label` out of the same array — so localizing here is what
   * keeps the button and the confirm dialog on one bundle entry. Resolving only
   * the display label (what this renderer used to do) left `executeAction`
   * dispatching the untranslated `confirmText` / `successMessage` straight from
   * the object's metadata.
   */
  const actions: ActionDef[] = authoredActions.map((a, idx) =>
    localizeActionTexts(objectName || undefined, a, { fallbackLabel: `Action ${idx + 1}` }),
  );
  const required: string[] = Array.isArray(schema.requiredPermissions)
    ? schema.requiredPermissions
    : [];

  const location: ActionLocation = (schema.location as ActionLocation) || 'record_header';

  // useActionEngine now shares the surrounding ActionProvider's runner
  // (see packages/react/src/hooks/useActionEngine.ts) so executeAction
  // automatically picks up confirm/param/modal/result-dialog/toast handlers
  // — no need to thread a separate globalExecute.
  const { getActionsForLocation, executeAction } = useActionEngine({
    actions,
    context: {
      record: ctx?.data,
      recordId: ctx?.recordId as any,
      objectName: ctx?.objectName,
    } as any,
  });

  /**
   * Block-level ADR-0066 CAPABILITY gate — evaluated AFTER all hooks
   * (`useActionEngine` above must run every render) so hook order stays
   * stable.
   *
   * `requiredPermissions` on a record block is a **system capability set** —
   * the one meaning the word carries on `action`, `app`, `field` and
   * `bulkAction` — so it is read through the permission context's capability
   * path (`hasCapabilities` over the reported `systemPermissions`) and gates
   * **fail-closed** (objectui#10058, ruling batch #192 item 5 letter B): an
   * unheld or unrecognised capability withholds every action, and an
   * insufficient-permissions notice (`role="status"`) renders in the bar's
   * place — the bar is not hidden. That is what the contract's shared
   * record-block describe says ("an insufficient-permissions notice takes its
   * place"), and the registration publishes that describe verbatim
   * (objectui#10224). Capabilities that are never REPORTED open the gate
   * instead; the ⚠️ paragraph below says why.
   *
   * ⛔ NOT `perms.can(objectName, name)`. That call's second argument is the
   * closed object-action enum, and the stock `/me/permissions` provider maps
   * only eight verbs (`read`, `view`, `create`, `update`, `edit`, `delete`,
   * `import`, `export`) before its `?? 'allowRead'` tail sends everything
   * else to the object's read bit. Measured on the stock provider with an
   * empty capability set and `allowRead: true`: `crm.manage`, `manage_users`,
   * and the enum's own `manage` / `admin` / `share` / `configure` / `execute`
   * all answered `true` — a declared permission gate that passed for every
   * reader of the object, with no refusal, no warning and no log. The lit
   * control in the same reading: `create` and `delete` answered `false` off
   * their own bits, so that tail is a live fallback rather than an artefact.
   *
   * ⛔ The object name is deliberately ABSENT from the verdict. A system
   * capability is not object-scoped, and the old `&& objectName` guard was a
   * second silent fail-open: a bar rendered outside a record context skipped
   * its declared gate entirely.
   *
   * ⚠️ A provider that never REPORTS capabilities (`systemPermissions`
   * `undefined` — the role-based `PermissionProvider`, a backend predating
   * ADR-0066, or no provider at all) still opens this gate. That is
   * `hasCapabilities`'s own ruled doctrine for unreported-vs-empty, shared
   * with every other capability gate in the tree; "reported, holds nothing"
   * (`[]`) is a real answer and gates strictly.
   */
  if (required.length > 0 && !perms.hasCapabilities(required)) {
    return (
      <div className={className} {...designer} role="status" aria-live="polite">
        <p className="text-sm text-muted-foreground italic">
          Insufficient permissions to view quick actions.
        </p>
      </div>
    );
  }

  const visibleActions = actions.length > 0 && !noRecord ? getActionsForLocation(location) : [];

  /**
   * The empty bar (objectui#12995). Three different facts reach an empty
   * `visibleActions`, and only one of them is an authoring slip:
   *
   *   - the block NAMES actions (`actions` above is the block's own declared
   *     list, resolved — before the engine's location / capability / `visible`
   *     filters ran) and every one was withheld, hidden or has no record to
   *     run against → draw NOTHING, as the record header and the row menu do
   *     for a fully withheld set. The block is told apart from "named none" by
   *     its declared list, ⛔ never by re-running the capability check: that
   *     check is `getActionsForLocation`'s alone.
   *   - the block names NO action (or only ids that resolve to none) → the
   *     dashed placeholder is developer copy, so it is drawn on a design /
   *     preview surface only; a runtime view draws nothing.
   *   - the declared array was REFUSED (objectui#7182) → the console error
   *     above names it in every view; the dashed "refused at index N" box is
   *     developer copy too, so it is drawn on a design / preview surface only
   *     and a runtime view draws nothing (objectui#13000).
   *
   * Only an authoring surface reaches the placeholder at all, and there only
   * when nothing was named that could be withheld.
   */
  if (visibleActions.length === 0) {
    if (!authoring || (declared.kind !== 'refused' && actions.length > 0)) return null;
    return (
      <div className={className} {...designer}>
        <div className="text-xs text-muted-foreground italic px-3 py-2 border border-dashed rounded">
          {declared.kind === 'refused'
            ? `record:quick_actions — ${declaredKey} refused at index ${declared.index} (see console)`
            : 'record:quick_actions — no actions configured'}
        </div>
      </div>
    );
  }

  const align = schema.align || 'end';
  const justify =
    align === 'start' ? 'justify-start' : align === 'center' ? 'justify-center' : 'justify-end';
  // When sitting in the record_header region right below the page:header
  // (the canonical Salesforce Lightning placement), pull the toolbar up so
  // it visually pairs with the title instead of orphaning on its own row.
  // Disabled when rendered inline inside page:header's own action slot
  // (the `inline` flag is set by PageHeader's first-class `actions` prop).
  const inlineWithHeader = location === 'record_header' && !schema.inline;

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2',
        inlineWithHeader && '-mt-12 sm:-mt-14 mb-2 relative z-10',
        justify,
        className,
      )}
      {...toolbarAria}
      {...designer}
    >
      {visibleActions.map((action, idx) => (
        <QuickActionButton
          key={action.name || `qa-${idx}`}
          action={action}
          record={ctx?.data}
          // A declared action variant is spec vocabulary and is mapped; the
          // block's own `variant` (Button vocabulary) is the fallback only
          // for an action that declares none.
          variant={
            action.variant
              ? SPEC_ACTION_TO_BUTTON_VARIANT[action.variant]
              : schema.variant || 'default'
          }
          size={(action as any).size || schema.size || 'sm'}
          // Already resolved (with the confirm/success strings that ride the
          // same dispatch) in the `actions` memo above — objectui#4265.
          label={(action.label as string) || `Action ${idx + 1}`}
          onRun={async () => {
            if (typeof action.onClick === 'function') await action.onClick();
            else if (action.name) await executeAction(action.name);
          }}
        />
      ))}
    </div>
  );
};

/**
 * A single quick-action button. Owns its own running/loading state (a spinner +
 * disable while the action executes — a visible progress state for slow / flow
 * actions) and evaluates a CEL `disabled` predicate against the record (so an
 * action can grey out conditionally, not just hide via `visible`).
 */
function QuickActionButton({
  action, record, variant, size, label, onRun,
}: {
  action: ActionDef;
  record: Record<string, unknown> | undefined;
  variant: QuickActionButtonVariant;
  size: any;
  label: string;
  onRun: () => Promise<void> | void;
}) {
  const [running, setRunning] = React.useState(false);
  const recordCtx = React.useMemo(() => ({ record: record || {} }), [record]);
  // `disabled` may be a boolean or a CEL predicate (disabled when TRUE). Feed
  // toPredicateInput's result to useCondition WHOLE — since #2661 a CEL-dialect
  // `{dialect, source}` envelope (the shape the server compiles authored CEL
  // into) must reach useCondition intact to route to the canonical formula
  // engine. The previous `typeof === 'string'` split dropped the envelope, so
  // a spec-authored `disabled` never disabled anything on this surface.
  const isDisabledPred = useCondition(toPredicateInput((action as any).disabled), recordCtx);
  const tt = useSafeTranslate();
  const reasonId = React.useId();
  // Is a `disabled` gate DECLARED? Read from the one definition on the action
  // face rather than re-spelled here (objectui#3842 ruling, applied to this
  // site by #3849 — the historic `visible`-flavoured name is kept on purpose;
  // the predicate is key-neutral, "declared" is `!= null && !== ''`).
  //
  // `!= null` alone was a live defect on this key: `toPredicateInput('')` is
  // `undefined` and `evaluateCondition(undefined)` is `true`, which on
  // `disabled` means DISABLE — so `disabled: ''` (an empty predicate, i.e.
  // nothing declared) greyed this quick action out permanently, with no way for
  // the author to un-grey it. There is no legacy `enabled` leg on this surface.
  //
  // Kept apart from `running` (objectui#11811): only the DECLARED predicate is
  // a fact about the record, so only it earns the "not available" reason. A
  // button greyed out while its own action runs already says why — the spinner.
  const disabledByPredicate = hasDeclaredVisibilityGate((action as any).disabled) ? isDisabledPred : false;
  const isDisabled = disabledByPredicate || running;
  // The generic reason (objectui#11811). The author-written reason beside the
  // predicate is a spec question for objectstack, not a key this renderer may
  // invent, so every predicate-disabled action says the same thing for now.
  const disabledReason = disabledByPredicate
    ? tt('actions.notAvailableForRecord', 'Not available for this record')
    : undefined;
  // The declared `icon` (objectui#12772), resolved through the shared icon seam.
  // It sits beside the label and gives way to the spinner while the action
  // runs — the `action:button` order. `null` (none declared, or a name no glyph
  // answers) draws the label alone, as before.
  const ActionIcon = resolveIcon(action.icon);
  const button = (
    <Button
      variant={variant}
      size={size}
      disabled={isDisabled}
      aria-describedby={disabledReason ? reasonId : undefined}
      onClick={async () => {
        setRunning(true);
        try { await onRun(); } finally { setRunning(false); }
      }}
    >
      {running && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      {/* Resolved from the shared icon seam, not a component created during render. */}
      {/* eslint-disable-next-line react-hooks/static-components */}
      {!running && ActionIcon && <ActionIcon className="mr-2 h-4 w-4" />}
      {label}
    </Button>
  );
  if (!disabledReason) return button;
  // A natively `disabled` button fires no pointer or focus events, and the
  // Button primitive adds `disabled:pointer-events-none` on top — so a tooltip
  // (or a native `title`) on the button itself never opens: the card's "hovering
  // or focusing it shows nothing". The wrapping span is the trigger instead,
  // the idiom Radix documents for a disabled button: it takes the hover, and
  // `tabIndex={0}` lets a keyboard user focus it, which opens the tooltip too.
  // The reason is ALSO a persistent accessible description (`aria-describedby`
  // on both the button and the span, onto an `sr-only` copy), so a screen
  // reader reaching either one hears it without the tooltip being open. Same
  // shape as `DeclaredActionsBar`'s button in `@object-ui/app-shell`.
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            aria-describedby={reasonId}
            data-disabled-reason=""
            className="inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {button}
            <span id={reasonId} className="sr-only">{disabledReason}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent>{disabledReason}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * `record:quick_actions` with the spec's per-element `dataSource` binding honoured
 * (objectui#12294). Unbound, the body reads the record page's record exactly as
 * before; bound, it reads the FIRST row of the bound set. `recordBindingBlock`
 * (`./recordBinding`, which states the semantics) wraps the body in the gate and
 * the one-record scope, and passes the result through the declaration seam.
 *
 * Wraps the EXPORTED name, as `record:related_list` does, so a host that
 * imports this renderer directly gets the binding too.
 */
export const RecordQuickActionsRenderer: React.FC<RecordQuickActionsRendererProps> = recordBindingBlock(RecordQuickActionsBody, 'record:quick_actions');

export default RecordQuickActionsRenderer;
