/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Spec-aligned renderers for the `element:*` component namespace defined
 * by `@objectstack/spec` (`framework/packages/spec/src/ui/component.zod.ts`).
 *
 * Maps:
 *   - ElementTextProps    -> element:text
 *   - ElementNumberProps  -> element:number     (object aggregate)
 *   - ElementImageProps   -> element:image
 *   - element:divider                            (no-props separator)
 *   - ElementButtonProps  -> element:button
 *
 * Heavier interactive elements (element:form) live in their owning plugins and
 * are left to those packages. element:record_picker — which writes its
 * selection into a page variable — ships alongside in `./record-picker`.
 *
 * All props are read off `schema.properties` per the spec's
 * `UIComponent.properties` convention; `schema.props` is also accepted
 * as a fallback so authors transitioning between conventions keep working.
 * `element:number` reads its query from the node-level `dataSource` binding
 * ONLY: its `object` and its `filter` (objectui#10909, objectui#11880).
 */

import * as React from 'react';
import { ComponentRegistry, elementDataSourceBlock, toFilterNodeSafely } from '@object-ui/core';
import type { ActionDef, FilterOperatorError } from '@object-ui/core';
import {
  ElementDataSourceErrorPanel,
  ElementDataSourceLoadingPanel,
  resolveInlineAriaProps,
  useAdapter,
  useAction,
  useActionTextLocalizer,
  useDataInvalidation,
  useElementDataSource,
  useFilterScope,
  useResolvedFilter,
} from '@object-ui/react';
import {
  useObjectTranslation,
  pickLocalized,
  useLocalization,
  useDisplayLocale,
  formatDisplayNumber,
  type DisplayNumberFormatOptions,
} from '@object-ui/i18n';
import type { AriaProps, TextSchema } from '@object-ui/types';
import { cn } from '../../lib/utils';
import { LazyIcon } from '../../lib/lazy-icon';
import { renderInlineMarkdown } from '../../lib/inline-markdown';
import { Button, Separator, Skeleton } from '../../ui';
import { readProps } from './readProps';
import { readActionEntryParamValues } from '../action/static-params';

// ---------------------------------------------------------------------------
// The `aria` bag (objectui#11051)
// ---------------------------------------------------------------------------
//
// `element:text`, `element:image`, `element:button` and `element:number` each
// declare the spec's `AriaPropsSchema` as their `aria` prop. Every read site
// below spreads `resolveInlineAriaProps(props.aria, locale)` from
// `@object-ui/react` with the display locale, and this file keeps no mapping of
// its own. A local helper used to put `aria-` in front of each key as written,
// so `ariaLabel` reached the DOM as `aria-arialabel`, an attribute no assistive
// technology reads, and a locale map was written as `[object Object]`.

// ---------------------------------------------------------------------------
// element:text
// ---------------------------------------------------------------------------

const ALIGN_CLASS = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
} as const;

/**
 * `element:text`'s `variant` — ONE vocabulary with `ui:text` (objectui#7450,
 * ruling B of 2026-09-07, landed in two spec releases as routed on 2026-09-09).
 *
 * ## The published nine
 *
 * `element:text` takes the nine values `@object-ui/types` publishes for its
 * text node, `TextSchema.variant`: `h1`-`h6`, `body`, `caption`, `overline`.
 * `@objectstack/spec` 17.5.0 widened `ElementTextPropsSchema.variant` to the
 * same nine (objectstack#17108, release 1). That pin is what lets this file
 * offer them: before it, the contract refused seven of the nine, and declaring
 * a value the installed contract refuses is the consumer-side widening
 * AGENTS.md #0.1 bans (`registry-inputs-spec-parity.test.ts` catches it).
 *
 * Each value maps the way `ui:text` maps it (`./text.tsx`): the six heading
 * values render the heading element they name, and every one of the nine
 * carries `ui:text`'s class for that value. The one deliberate difference is
 * the element of `body`, `caption` and `overline`. `ui:text` wraps inline
 * content in a `<span>`. This is a page block, and it has always rendered a
 * paragraph for its non-heading values (`body` and `caption` included), and
 * `ALIGN_CLASS` above carries no `block`, so a `<span>` would leave `align`
 * with nothing to align.
 * `__tests__/element-text-published-variants-7450.test.tsx` renders both
 * renderers for all nine and asserts they agree, so this map cannot drift from
 * `ui:text`'s without going red.
 *
 * ## `heading` / `subheading` — retired with the spec, in 17.7.0
 *
 * Through 17.6.0 the contract still ACCEPTED the two pre-convergence
 * spellings, and no objectui face refuses a value before the spec does, so they
 * rendered as they always had (`heading` an `<h2>`, `subheading` an `<h3>`).
 * `@objectstack/spec` 17.7.0 retires them through the value-level retirement
 * mechanism (objectstack#17109; objectstack#21015 refuses both by name, and
 * `os migrate meta` rewrites them to `h2` / `h3`), so they left this map and
 * the registry `inputs` below at that bump (objectui#11717), as
 * `__tests__/element-text-published-variants-7450.test.tsx` instructed. A
 * stored value outside the contract renders as `body`, as the read site says.
 * Migration: `heading` -> `h2`, `subheading` -> `h3`, or the level the document
 * means.
 *
 * ## Absence is `body` here, and only here
 *
 * `props.variant ?? 'body'` stays. `ui:text` deliberately does NOT synthesise
 * `body` for an absent `variant` (objectui#6942), so its unannotated corpus
 * nodes keep the shape they had. This is a different component: a page block
 * that has always rendered a body paragraph when no variant is authored, and
 * `@objectstack/spec` declares `.default('body')` on this key, so the contract
 * materialises the same value this renderer reads. Converging the vocabulary
 * moves what absence means on neither side.
 */
type ElementTextVariant = NonNullable<TextSchema['variant']>;

const VARIANT_CLASS: Record<ElementTextVariant, string> = {
  h1: 'text-4xl font-semibold tracking-tight',
  h2: 'text-3xl font-semibold tracking-tight',
  h3: 'text-2xl font-semibold tracking-tight',
  h4: 'text-xl font-semibold tracking-tight',
  h5: 'text-lg font-semibold tracking-tight',
  h6: 'text-base font-semibold tracking-tight',
  body: 'text-sm text-foreground',
  caption: 'text-xs text-muted-foreground',
  overline: 'text-xs font-medium uppercase tracking-widest text-muted-foreground',
};

const VARIANT_TAG: Record<ElementTextVariant, 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'p'> = {
  h1: 'h1',
  h2: 'h2',
  h3: 'h3',
  h4: 'h4',
  h5: 'h5',
  h6: 'h6',
  body: 'p',
  caption: 'p',
  overline: 'p',
};

// The spec declares `content` as "Text or Markdown content" (objectui#12778).
// The tag is one `p` or `h1`-`h6`, so the subset is the inline one: links,
// emphasis and code. Block syntax (`#`, `- `, a fence) prints as typed. A
// same-site path, `mailto:` and `tel:` stay in this tab; an `http(s):` link
// opens a new one.
const ELEMENT_TEXT_MARKDOWN = {
  classNames: {
    code: 'rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em]',
    strong: 'font-semibold',
    link: 'text-primary underline underline-offset-2 hover:no-underline',
  },
  newTab: 'external',
} as const;

function ElementTextRenderer({ schema }: { schema: any }) {
  const props = readProps<{
    content?: unknown;
    variant?: ElementTextVariant;
    align?: 'left' | 'center' | 'right';
    aria?: AriaProps;
  }>(schema);
  const { language } = useObjectTranslation();
  const locale = useDisplayLocale();
  const variant = props.variant ?? 'body';
  const align = props.align ?? 'left';
  // A value outside the contract is refused by every gate before it gets here;
  // if one arrives anyway it renders as `body` did before this change.
  const Tag = VARIANT_TAG[variant] ?? 'p';
  return (
    <Tag
      className={cn(VARIANT_CLASS[variant] ?? VARIANT_CLASS.body, ALIGN_CLASS[align], schema?.className)}
      {...resolveInlineAriaProps(props.aria, locale)}
    >
      {renderInlineMarkdown(pickLocalized(props.content, language), ELEMENT_TEXT_MARKDOWN)}
    </Tag>
  );
}

ComponentRegistry.register('text', ElementTextRenderer, {
  namespace: 'element',
  skipFallback: true,
  label: 'Text',
  category: 'content',
  inputs: [
    // Two arms, because the contract has two (objectui#3832 mechanism,
    // objectui#4970 specimen). The spec accepts a plain string OR an inline
    // translation map here — measured against `ComponentPropsMap['element:text']`
    // on the 17.0.0 GA pin, where `content` is `string | Record< string, string >`
    // — and the renderer resolves the map form through `pickLocalized` at the read
    // site above. While this said `type: 'string'` the manifest gate reported
    // `type-mismatch` on the map form, which is the shape this input's own
    // description teaches the author to write.
    { name: 'content', type: ['string', 'object'], required: true, description: 'Accepts an inline translation map ({ en, "zh-CN", … })' },
    // The installed contract's accept set, member for member: the published nine
    // (objectui#7450). This list is not only an offer. It is what the html tier
    // compiles against (`page.tsx` builds its JSX manifest from these `inputs`,
    // and an `invalid-enum` there fails the whole page), and what the published
    // `sdui.manifest.json` hands the platform's JSX gate. The two pre-convergence
    // spellings `heading` / `subheading` stood here, after the nine, until the
    // spec refused them: `@objectstack/spec` 17.7.0 retires both (objectstack#21015),
    // and they left at that bump (objectui#11717), when
    // `registry-inputs-spec-parity.test.ts` went red as it promised to.
    {
      name: 'variant',
      type: 'enum',
      enum: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'body', 'caption', 'overline'],
      description:
        'One of the nine text styles ui:text uses: h1-h6 (rendered as that heading level), body, caption or overline. '
        + 'The earlier spellings heading and subheading are refused; write h2 or h3 instead.',
    },
    { name: 'align', type: 'enum', enum: ['left', 'center', 'right'] },
  ],
});

// ---------------------------------------------------------------------------
// element:divider
// ---------------------------------------------------------------------------

function ElementDividerRenderer({ schema }: { schema: any }) {
  return <Separator className={cn('my-4', schema?.className)} />;
}

ComponentRegistry.register('divider', ElementDividerRenderer, {
  namespace: 'element',
  skipFallback: true,
  label: 'Divider',
  category: 'content',
});

// ---------------------------------------------------------------------------
// element:image
// ---------------------------------------------------------------------------

const FIT_CLASS: Record<string, string> = {
  cover: 'object-cover',
  contain: 'object-contain',
  fill: 'object-fill',
};

function ElementImageRenderer({ schema }: { schema: any }) {
  const props = readProps<{
    src?: string;
    alt?: string;
    fit?: 'cover' | 'contain' | 'fill';
    height?: number;
    aria?: AriaProps;
  }>(schema);
  // Before the early return below, so the hook order is the same with and
  // without a `src`.
  const locale = useDisplayLocale();
  // objectui#12910 — the no-`src` placeholder reads the bundle; it was the
  // English literal "no image source".
  const { t } = useObjectTranslation();
  const fit = props.fit ?? 'cover';
  if (!props.src) {
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded-md border border-dashed bg-muted/30 text-xs text-muted-foreground',
          schema?.className,
        )}
        style={{ height: props.height ?? 120 }}
        data-testid="element-image-no-source"
      >
        {t('element.image.noSource', { defaultValue: 'No image source' })}
      </div>
    );
  }
  return (
    <img
      src={props.src}
      alt={props.alt ?? ''}
      className={cn('w-full rounded-md', FIT_CLASS[fit] ?? FIT_CLASS.cover, schema?.className)}
      style={props.height ? { height: props.height } : undefined}
      {...resolveInlineAriaProps(props.aria, locale)}
    />
  );
}

ComponentRegistry.register('image', ElementImageRenderer, {
  namespace: 'element',
  skipFallback: true,
  label: 'Image',
  category: 'content',
});

// ---------------------------------------------------------------------------
// element:button
// ---------------------------------------------------------------------------

const SHADCN_BUTTON_VARIANT: Record<string, string> = {
  primary: 'default',
  secondary: 'secondary',
  danger: 'destructive',
  ghost: 'ghost',
  link: 'link',
};

const SHADCN_BUTTON_SIZE: Record<string, string> = {
  small: 'sm',
  medium: 'default',
  large: 'lg',
};


function ElementButtonRenderer({ schema }: { schema: any }) {
  const props = readProps<{
    label?: unknown;
    variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'link';
    size?: 'small' | 'medium' | 'large';
    icon?: string;
    iconPosition?: 'left' | 'right';
    disabled?: boolean;
    aria?: AriaProps;
    /**
     * Optional action executed on click. Any ActionDef the ActionRunner
     * understands — `url`/`navigation` (link to another page), `api`/`script`
     * (POST a cloud route, with optional param collection + redirect), `modal`,
     * `flow`. This is what makes a standalone-page button interactive: without
     * it the button renders inert (back-compat). Executed via `useAction`,
     * which falls back to a local runner when no ActionProvider is mounted, so
     * adding the hook never throws in non-page contexts.
     */
    action?: Record<string, any>;
  }>(schema);
  const variant = (SHADCN_BUTTON_VARIANT[props.variant ?? 'primary'] ?? 'default') as any;
  const size = (SHADCN_BUTTON_SIZE[props.size ?? 'medium'] ?? 'default') as any;
  const { language } = useObjectTranslation();
  const locale = useDisplayLocale();
  const label = pickLocalized(props.label, language);
  const iconPosition = props.iconPosition ?? 'left';
  const icon = props.icon ? <LazyIcon name={props.icon} className="h-4 w-4" /> : null;

  const { execute } = useAction();
  const localizeActionTexts = useActionTextLocalizer();
  const [running, setRunning] = React.useState(false);
  const declaredAction = props.action;

  const handleClick = React.useCallback(async () => {
    if (!declaredAction || running) return;
    setRunning(true);
    try {
      // The inline action's copy (`label`, `confirmText`, `successMessage`,
      // `errorMessage`) is an `I18nLabel` in the spec, so it is resolved in the
      // user's locale by the same localizer every other action surface uses,
      // before it reaches the runner and the param dialog, which have no
      // language (objectui#12757). A page carries no host object, so only the
      // action's own name keys the bundle.
      const action = localizeActionTexts(undefined, declaredAction);
      // Mirror action:button's param routing: an array of {name,type,…} defs is
      // forwarded for in-dialog collection. A plain object is passed as values
      // only for `type: 'api'` (the objectstack#5777 payload window); on any
      // other type it is not forwarded (objectui#10462, ruling A on #10289).
      //
      // Annotated `ActionDef`, not bare: a spread SOURCE's own keys are not
      // excess-property checked THROUGH the spread (objectui#4281 probe Q —
      // `const p = cond ? { actionParams } : { zzBogus }` is absorbed whole by
      // the literal that spreads it). The payload below being checked therefore
      // does not cover these two branches; this annotation is what does.
      const paramsPayload: ActionDef = Array.isArray(action.params)
        ? { actionParams: action.params }
        : { params: readActionEntryParamValues(action, action.actionType || action.type, 'element:button') };
      // ── Why there is no `as any` here (objectui#4321) ────────────────────
      //
      // This literal used to close with `as any`. An assertion asks only for
      // comparability, so it switched the excess-property (freshness) check OFF
      // for every key below — `ActionDef` being closed (objectui#4046) bought
      // this surface nothing, and a typo added to this list would have compiled,
      // published, and reached a runner that silently does nothing
      // (objectstack#2169's shape). Measured on TypeScript 6.0.3: dropping the
      // cast type-checks clean as-is — every key written here is declared on
      // `ActionDef` — and an invented key is now a TS2353.
      //
      // The direct `execute(…)` argument is contextually typed by
      // `execute(action: ActionDef)`, which is what runs the check; no hoist to
      // a named binding is needed because this payload spreads nothing typed
      // `any` (`...paramsPayload` resolves to object literals and keeps the
      // check ON). Same shape as `action:group` / `action:menu`, the two
      // surfaces objectui#4281 measured as already correct.
      await execute({
        type: action.actionType || action.type,
        name: action.name,
        label: action.label,
        description: action.description,
        target: action.target,
        openIn: (action as any).openIn,
        endpoint: action.endpoint,
        method: action.method,
        navigate: action.navigate,
        to: action.to,
        opensInNewTab: action.opensInNewTab,
        // The static request body of a `type: 'api'` action. `params` is the
        // parameter DEFINITION array and carries no payload (objectstack#5777
        // ruling, direction A), so without this forward an inline action's
        // payload has no way through: it validates, publishes, and is dropped
        // exactly here, one hop before the runner (objectstack#6837). With it,
        // this list matches spec's `InlineActionSchema` pick list field for
        // field — that pick list is the contract this whitelist mirrors.
        bodyExtra: action.bodyExtra,
        confirmText: action.confirmText,
        successMessage: action.successMessage,
        errorMessage: action.errorMessage,
        refreshAfter: action.refreshAfter,
        ...paramsPayload,
      });
    } finally {
      setRunning(false);
    }
  }, [declaredAction, execute, localizeActionTexts, running]);

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      disabled={props.disabled || running}
      className={cn(schema?.className)}
      onClick={declaredAction ? handleClick : undefined}
      {...resolveInlineAriaProps(props.aria, locale)}
    >
      {iconPosition === 'left' && icon}
      {label}
      {iconPosition === 'right' && icon}
    </Button>
  );
}

ComponentRegistry.register('button', ElementButtonRenderer, {
  namespace: 'element',
  skipFallback: true,
  label: 'Button',
  category: 'action',
  // Distinct from `action:button`, which references a DECLARED action by name
  // and gates on visible/enabled predicates. This one carries an inline
  // ActionDef — the standalone-page button.
  inputs: [
    // Two arms, on the same evidence as `element:text.content` above
    // (objectui#4970): `ComponentPropsMap['element:button'].label` is
    // `string | Record< string, string >` on the 17.0.0 GA pin, and the rendered
    // label goes through `pickLocalized`.
    { name: 'label', type: ['string', 'object'], required: true, description: 'Accepts an inline translation map ({ en, "zh-CN", … })' },
    { name: 'action', type: 'object', description: 'Inline ActionDef executed on click (url / navigation / api / script / modal / flow); omitted → renders inert' },
    { name: 'variant', type: 'enum', enum: ['primary', 'secondary', 'danger', 'ghost', 'link'] },
    { name: 'size', type: 'enum', enum: ['small', 'medium', 'large'] },
    { name: 'icon', type: 'string', description: 'Lucide icon name' },
    { name: 'iconPosition', type: 'enum', enum: ['left', 'right'] },
    { name: 'disabled', type: 'boolean' },
  ],
});

// ---------------------------------------------------------------------------
// element:number — aggregate metric pulled from an object via the adapter.
// ---------------------------------------------------------------------------

const FORMAT_OPTS: Record<string, DisplayNumberFormatOptions> = {
  number: {},
  currency: { currency: 'USD' },
  percent: { style: 'percent', maximumFractionDigits: 1 },
};

function formatValue(
  value: number | null | undefined,
  format?: string,
  prefix?: string,
  suffix?: string,
  currency?: string,
  locale?: string,
): string {
  if (value == null || Number.isNaN(value)) return '—';
  let opts = FORMAT_OPTS[format ?? 'number'] ?? FORMAT_OPTS.number;
  // A `currency`-format metric resolves its ISO code from the field/tenant
  // default (localization.currency, ADR-0053). When no currency is known,
  // render a plain number rather than guessing USD — a baked-in `$` silently
  // mis-displays non-USD orgs (e.g. RMB amounts shown as US$).
  if (format === 'currency') {
    opts = currency ? { ...FORMAT_OPTS.currency, currency } : FORMAT_OPTS.number;
  }
  // No `scale` passed: an `element:number` renders an AGGREGATE (count / sum /
  // avg), not a scale-bearing field value, so objectui#4033's ordinal
  // no-grouping default must not fire on it — a large count keeps separators.
  const body = formatDisplayNumber(value, { ...opts, locale });
  return `${prefix ?? ''}${body}${suffix ?? ''}`;
}

function ElementNumberRenderer({ schema }: { schema: any }) {
  const props = readProps<{
    field?: string;
    aggregate?: 'count' | 'sum' | 'avg' | 'min' | 'max';
    format?: 'number' | 'currency' | 'percent';
    prefix?: string;
    suffix?: string;
    aria?: AriaProps;
  }>(schema);
  const adapter = useAdapter() as any;
  // objectui#10909 — the spec's per-element binding (`PageComponentSchema
  // .dataSource`), resolved the way the element twin `element:record_picker`
  // resolves it: through `useElementDataSource`. Since objectui#11880 it is
  // the ONLY source of the metric's object and filter: the flat
  // `properties.object` / `filter` are not read (objectstack#11509, ruled
  // A-narrow).
  //
  // `object` resolves ONCE, here, and that one value is the fetch guard, the
  // `aggregate` / `find` target and the bus key below. A named `view` is
  // honoured (its filter scopes the aggregate); while it is unresolved or
  // unresolvable there is NO object, so nothing is aggregated over the wider
  // set the view was written to narrow, and the render reports instead. The
  // binding's `sort` and `limit` are deliberately not read: an aggregate has no
  // ordering, and a capped count is a wrong number.
  //
  // The renderer's own adapter is passed so the view resolves against the same
  // source the aggregate reads from.
  const dataBinding = useElementDataSource(schema, adapter);
  const composed = dataBinding.composed;
  const { t } = useObjectTranslation();
  // The filter this metric aggregates over: the binding's (which
  // `useElementDataSource` has already AND-combined with its view's), lowered
  // the way `ElementDataSourceGate` lowers a filter (`toFilterNodeSafely`). A
  // filter the converter refuses is kept as a VALUE and answered with the
  // configuration-error panel below — never read as "no filter", which would
  // count every row. Memoised for cost only: the result is read by content
  // (`useResolvedFilter` holds it by structure), never by identity
  // (AGENTS.md #10).
  const scopedFilter = React.useMemo((): { filter: unknown; refusal?: FilterOperatorError } => {
    if (!composed) return { filter: undefined };
    const bound = toFilterNodeSafely(composed.filter);
    if (!bound.ok) return { filter: undefined, refusal: bound.refusal };
    return { filter: bound.node };
  }, [composed]);
  const filterRefusal = scopedFilter.refusal;
  const unresolved = dataBinding.status === 'loading' || dataBinding.status === 'missing';
  const object = unresolved || filterRefusal ? undefined : composed?.object;
  // Tenant default currency (ADR-0053) for a `currency`-format metric; the
  // display locale resolves through the shared precedence (tenant regional
  // default → active UI language), so the metric follows a language switch even
  // when no tenant locale is configured (objectui#4033).
  const { currency: tenantCurrency } = useLocalization();
  const locale = useDisplayLocale();
  const [value, setValue] = React.useState<number | null>(null);
  const [loading, setLoading] = React.useState<boolean>(true);
  const [error, setError] = React.useState<string | null>(null);
  // objectui#10666 — the number's own `filter`, with every context token
  // (`{current_user_id}`, `{current_org_id}`, the date macros) resolved ONCE
  // through `@object-ui/core`'s shared `resolveFilterPlaceholders`, against the
  // session scope the host provides, and HELD by structure (`useResolvedFilter`
  // in `@object-ui/react`). Both reads below (the `aggregate` filter and the
  // `find` fallback's `$filter`) sent the literal token before; they and the
  // content key read THIS. What it resolves is the binding's filter above
  // (objectui#10909, objectui#11880).
  const filterScope = useFilterScope();
  const queryFilter = useResolvedFilter(scopedFilter.filter, filterScope);
  const filterKey = React.useMemo(() => (queryFilter ? JSON.stringify(queryFilter) : ''), [queryFilter]);
  // objectui#10623 — the data-invalidation bus (`notifyDataChanged` from
  // `@object-ui/react`), read the objectui#10494 way: the nonce moves when a
  // write to the object this number AGGREGATES is declared, and the effect
  // below names it, so the value is re-read. Subscribed only when the effect
  // can query: no adapter or no aggregate means no read to repeat. Keyed on the
  // RESOLVED object, so a bound metric re-reads for the object it aggregates.
  const invalidationNonce = useDataInvalidation(adapter && props.aggregate ? object : undefined);

  React.useEffect(() => {
    let cancelled = false;
    if (!adapter || !object || !props.aggregate) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    (async () => {
      try {
        if (typeof adapter.aggregate === 'function') {
          const rows = await adapter.aggregate(object, {
            field: props.field,
            function: props.aggregate,
            groupBy: '_all',
            filter: queryFilter,
          });
          const row = Array.isArray(rows) ? rows[0] : rows;
          const measureKey = props.aggregate === 'count' ? 'count' : `${props.field ?? ''}_${props.aggregate}`;
          const v =
            row?.[measureKey] ??
            row?.[props.field ?? ''] ??
            row?.value ??
            (typeof row === 'number' ? row : null);
          if (!cancelled) setValue(typeof v === 'number' ? v : v != null ? Number(v) : null);
        } else if (typeof adapter.find === 'function') {
          // Last-resort: pull all rows and aggregate client-side. Costly
          // but matches the chart renderer fallback path.
          const res = await adapter.find(object, queryFilter ? { $filter: queryFilter } : undefined);
          // `data` is the ONE rows member `QueryResult` (`@object-ui/types`)
          // declares; the bare-array arm stays because fakes at this seam
          // really do answer with a plain array. A `res?.records` arm sat
          // between them until objectui#6726 — a below-the-adapter spelling
          // (`ObjectStackAdapter.normalizeQueryResult` maps the server/SDK
          // `records` envelope to `data` before returning), so no producer
          // emits it here. Pinned by
          // `element-number.contractEnvelope-6726.test.tsx`.
          const records: any[] = res?.data ?? (Array.isArray(res) ? res : []);
          let v: number | null = null;
          if (props.aggregate === 'count') v = records.length;
          else if (props.field) {
            const nums = records.map((r) => Number(r?.[props.field as string])).filter((n) => !Number.isNaN(n));
            if (nums.length) {
              if (props.aggregate === 'sum') v = nums.reduce((a, b) => a + b, 0);
              else if (props.aggregate === 'avg') v = nums.reduce((a, b) => a + b, 0) / nums.length;
              else if (props.aggregate === 'min') v = Math.min(...nums);
              else if (props.aggregate === 'max') v = Math.max(...nums);
            }
          }
          if (!cancelled) setValue(v);
        }
      } catch (e: any) {
        // The thrown message when there is one; otherwise `''` still selects
        // the error line below, which draws the translated default in its
        // place (objectui#12910 — this was the English "aggregate failed").
        if (!cancelled) setError(e?.message ?? '');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter, object, props.field, props.aggregate, filterKey, invalidationNonce]);

  // After every hook above, so hook order stays stable across resolution
  // states. A `view` that names nothing, or a filter the merge refuses,
  // reports rather than aggregating the whole object: one confident number
  // over the wrong set is the quiet failure a metric has no second chance to
  // show.
  if (dataBinding.status === 'missing' || filterRefusal) {
    return (
      <ElementDataSourceErrorPanel
        testId="element-number"
        title={t('element.number.sourceUnresolved', {
          defaultValue: 'This metric’s data source could not be resolved',
        })}
        message={filterRefusal?.message ?? dataBinding.error}
      />
    );
  }
  if (dataBinding.status === 'loading') {
    return <ElementDataSourceLoadingPanel testId="element-number" />;
  }
  // objectui#10951 — an aggregate whose node names no `dataSource.object`
  // (objectui#11880: a flat `properties.object` names nothing any more). The
  // manifest cannot require a binding member, so the html tier does not report
  // this node: say it here rather than paint the dash. Only AUTHORED absence
  // qualifies (`absent` = no binding naming an object); a binding whose view is
  // still resolving or failed to resolve is answered by the two panels above.
  if (props.aggregate && dataBinding.status === 'absent') {
    return (
      <div
        className={cn('text-xs text-muted-foreground', schema?.className)}
        data-testid="element-number-no-object"
        {...resolveInlineAriaProps(props.aria, locale)}
      >
        {t('element.number.noObject', { defaultValue: 'No object named: set dataSource.object.' })}
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col gap-1', schema?.className)} {...resolveInlineAriaProps(props.aria, locale)}>
      {/* objectui#12889 — while the aggregate runs, a skeleton bar the height
          of the number's line and about a figure's width, not a bare `…`
          glyph at the number's size. Its accessible name is `common.loading`,
          the key the rest of the tree reads for a bare "Loading…". */}
      {loading ? (
        <Skeleton
          role="status"
          aria-label={t('common.loading', { defaultValue: 'Loading…' })}
          className="h-9 w-20"
          data-testid="element-number-loading"
        />
      ) : (
        <div className="text-3xl font-semibold tracking-tight tabular-nums">
          {formatValue(value, props.format, props.prefix, props.suffix, tenantCurrency, locale)}
        </div>
      )}
      {error !== null && (
        <div className="text-xs text-destructive" data-testid="element-number-error">
          {error || t('errors.unknown', { defaultValue: 'An unexpected error occurred.' })}
        </div>
      )}
    </div>
  );
}

// The renderer READS the node-level `dataSource` binding (objectui#10909), so it
// declares it from the seam every reader of the binding declares it from: the
// marker below makes `Registry.register` emit `ELEMENT_DATA_SOURCE_INPUT` into
// these `inputs`, and the binding is the only place the metric reads its
// object and filter from (objectui#11880). The flat `object` / `filter` are not
// published (objectui#12085): nothing reads them, and `@objectstack/spec`
// retires both as tombstones (objectstack#11509), so a published flat key
// would point an author at a spelling the contract refuses and the metric
// ignores. The seam comes from `@object-ui/core` for the measured reason
// `element:record_picker`'s registration states.
ComponentRegistry.register('number', elementDataSourceBlock(ElementNumberRenderer), {
  namespace: 'element',
  skipFallback: true,
  label: 'Number',
  category: 'content',
  inputs: [
    { name: 'aggregate', type: 'enum', enum: ['count', 'sum', 'avg', 'min', 'max'], required: true },
    { name: 'field', type: 'string', description: 'Measure field (required for every aggregate except count)' },
    { name: 'format', type: 'enum', enum: ['number', 'currency', 'percent'] },
    { name: 'prefix', type: 'string' },
    { name: 'suffix', type: 'string' },
  ],
});
