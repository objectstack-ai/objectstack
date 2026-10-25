import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, getLazyIcon } from '@object-ui/components';
import { cn } from '@object-ui/components';
// The percent display path, read from the same package `renderFieldValue` in
// this file's own package already reads it from (objectui#5607).
// `@object-ui/fields` publishes one implementation, whose scaling half is
// `percentDisplayValue` in `@object-ui/core` at a STATED storage — so this adds
// no dependency edge, and no second percent rule.
import { formatPercent } from '@object-ui/fields';
import {
  createSafeTranslation,
  useDisplayLocale,
  useObjectTranslation,
  pickLocalized,
  formatDisplayNumber,
  type DisplayNumberFormatOptions,
} from '@object-ui/i18n';
import type { I18nLabel } from '@object-ui/types';
import { ArrowDownIcon, ArrowUpIcon, MinusIcon, AlertCircle, Loader2 } from 'lucide-react';
import { VARIANT_ICON_CLASSES, VARIANT_TEXT_CLASSES, type MetricColorVariant } from './colorVariants';
import { hostDomProps, type SchemaHostProps } from './schemaHostProps';
import { METRIC_TILE_CONTAINER_CLASS, METRIC_TILE_TITLE_CLASS, metricTileValueClass, metricTileValueTitle } from './metricTile';
import { formatMetricDeltaPercent, type MetricDelta } from './utils';

const TREND_LABEL_DEFAULTS: Record<string, string> = {
  'dashboard.trend.vsLastQuarter': 'vs last quarter',
  'dashboard.trend.vsLastMonth': 'vs last month',
  'dashboard.trend.vsLastWeek': 'vs last week',
  'dashboard.trend.vsLastYear': 'vs last year',
  'dashboard.trend.vsYesterday': 'vs yesterday',
  'dashboard.trend.vsPreviousPeriod': 'vs previous period',
};

const useTrendT = createSafeTranslation(TREND_LABEL_DEFAULTS, 'dashboard.trend.vsLastQuarter');

/**
 * Map a server-provided English trend phrase ("vs last quarter") to its
 * canonical i18n key so we can translate it without requiring backends to
 * emit `{key, defaultValue}` objects.
 */
function trendLabelKey(label: string): string | undefined {
  const normalized = label.trim().toLowerCase().replace(/\s+/g, ' ');
  switch (normalized) {
    case 'vs last quarter':
    case 'vs previous quarter':
      return 'dashboard.trend.vsLastQuarter';
    case 'vs last month':
    case 'vs previous month':
      return 'dashboard.trend.vsLastMonth';
    case 'vs last week':
    case 'vs previous week':
      return 'dashboard.trend.vsLastWeek';
    case 'vs last year':
    case 'vs previous year':
      return 'dashboard.trend.vsLastYear';
    case 'vs yesterday':
      return 'dashboard.trend.vsYesterday';
    case 'vs previous period':
    case 'vs prior period':
      return 'dashboard.trend.vsPreviousPeriod';
    default:
      return undefined;
  }
}

/**
 * Lightweight numeric formatter for metric widgets.
 *
 * Honors a numeral.js-style `format` pattern:
 * - `'0,0'` / `'0,0.00'` → thousands separators with explicit decimals
 * - leading `$/¥/€/£` or `currency` prop → currency formatting
 * - trailing `%` → percent, handed WHOLE to `formatPercent`
 *   (`@object-ui/fields`) at the storage the PATTERN states: numeral's `%`
 *   multiplies by 100, so the value is a fraction. `formatPercent` owns the
 *   scaling and the locale's percent convention — see the branch's own note
 *   (objectui#9165, objectui#11475). A host that holds the field the value was
 *   aggregated from renders the percent itself at that field's storage
 *   (`ObjectMetricWidget`), the way it renders a currency.
 *
 * When no format is given but the value is a finite number, defaults to
 * thousands separators with no decimals — that's what users expect for
 * KPI cards (`1,930,000` not `1930000`).
 */
/**
 * The decimal places a numeral.js-style pattern fixes (`'0,0.00'` → 2,
 * `'0.0%'` → 1, `'0,0'` → 0) — the one parse this tile's formatter makes, read
 * by `ObjectMetricWidget` too when it renders a percent aggregate itself, so the
 * two never read one authored pattern at two widths.
 */
export function metricPatternDecimals(format: string | undefined): number {
  const decimalsMatch = (format || '').trim().match(/0\.(0+)/);
  return decimalsMatch ? decimalsMatch[1].length : 0;
}

function formatMetricValue(
  value: string | number,
  format?: string,
  currency?: string,
  locale?: string,
): string {
  if (value == null) return '';
  if (typeof value === 'string') {
    // If the string is a pure number, format it; else pass through.
    const n = Number(value);
    if (!isFinite(n) || value.trim() === '') return value;
    return formatMetricValue(n, format, currency, locale);
  }
  if (!isFinite(value as number)) return String(value);

  const symbolMap: Record<string, string> = { '$': 'USD', '¥': 'JPY', '€': 'EUR', '£': 'GBP' };
  const trimmed = (format || '').trim();
  const isCurrency = !!currency || (trimmed.length > 0 && symbolMap[trimmed[0]] !== undefined);
  const isPercent = trimmed.endsWith('%');

  // Determine decimals from the format pattern (e.g. '0,0.00' → 2)
  const decimals = metricPatternDecimals(trimmed);

  // Compact / abbreviated notation (numeral.js 'a' convention, e.g. '0.0a' →
  // "1.1M", '$0a' → "$1M"). Keeps big KPI numbers from overflowing a tile.
  const isCompact = /a/i.test(trimmed);
  if (isCompact) {
    const opts: DisplayNumberFormatOptions = {
      locale,
      notation: 'compact',
      maximumFractionDigits: decimals || 1,
    };
    if (isCurrency) { opts.currency = currency || symbolMap[trimmed[0]] || 'USD'; }
    try { return formatDisplayNumber(value as number, opts); } catch { /* fall through */ }
  }

  if (isCurrency) {
    const code = currency || symbolMap[trimmed[0]] || 'USD';
    try {
      return formatDisplayNumber(value as number, {
        locale,
        currency: code,
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
    } catch {
      return `${code} ${(value as number).toFixed(decimals)}`;
    }
  }

  if (isPercent) {
    // objectui#9165 — the percent decision is NOT made here any more.
    //
    // This branch held a SECOND copy of the repo's percent display rule,
    // spelled inside out, which is why objectui#9071's census could not see it:
    //
    //   const v = value > 1 ? value : value * 100;
    //   return `${v.toFixed(decimals)}%`;
    //
    // `percentDisplayValue` in `@object-ui/core` is the symmetric
    // `value > -1 && value < 1`; written this way round it scaled everything at
    // or BELOW 1 and passed through everything above, so the negative half was
    // unguarded and the boundary sat on the wrong side of 1. Measured against
    // the list cell in the same run: a stored `1` read `100%` on the tile and
    // `1%` in the cell beside it, `-1` read `-100%`, `-5` read `-500%`. A user
    // reports that as a data bug, not a formatting one.
    //
    // The raw stored value now goes to `formatPercent` — the identical call
    // `renderFieldValue` in this same package already makes (objectui#5607),
    // and the one the list-view percent cell makes (`PercentCellRenderer`).
    // It carries BOTH halves `percentDisplayValue`'s doc comment demands of a
    // third surface:
    //  - the SCALING, so the fraction/points boundary has one home; and
    //  - the CONVENTION, via `style: 'percentPoints'`, so the percent affix is
    //    the LOCALE's and not a literal '%'. Taking only the first is the drift
    //    objectui#4576 already paid for once: `1.234,5 %` in a German list cell
    //    beside `1.234,5%` from a dashboard, the same number under two
    //    conventions.
    //
    // `decimals` still comes from this surface's numeral PATTERN (`'0.00%'` →
    // 2), an author declaration on the widget, not a magnitude heuristic.
    //
    // objectui#11475 — and so does the STORAGE. This tile holds no field, only
    // a value and a pattern, and numeral's `%` multiplies by 100: the pattern
    // states a fraction. `formatPercent` used to guess the storage from the
    // value's magnitude, so a ratio of exactly 1 read `1%` here (objectui#3136
    // was the same guess on the dataset measure). An aggregate over a
    // `percent` field never reaches this branch with its own storage lost:
    // `ObjectMetricWidget` renders that tile itself, at the field's storage.
    return formatPercent(value as number, 'fraction', decimals, locale);
  }

  // MEASURED EXCEPTION to objectui#4033's ordinal no-grouping default, and the
  // reason this call passes no `scale`. `decimals` above is parsed out of a
  // numeral.js format PATTERN (`'0,0.00'` → 2), not out of a field's declared
  // scale — and it is 0 for the commonest KPI patterns (`'0,0'`, or no format
  // at all). Grouping is load-bearing here, as this function's own contract
  // says: "defaults to thousands separators with no decimals — that's what
  // users expect for KPI cards (`1,930,000` not `1930000`)". Suppressing it
  // would turn every unformatted dashboard aggregate into an unreadable digit
  // run. The `en-US` locale hardcode IS fixed; the grouping default is not
  // applied to this surface.
  return formatDisplayNumber(value as number, {
    locale,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * The variant vocabulary and its two class tables now live in
 * `./colorVariants` — the dataset-bound KPI (`DatasetWidget`, objectui#3359)
 * paints the SAME accents, and two copies of a palette is how a
 * declared-but-unenforced key becomes two disagreeing declarations. Re-exported
 * here because this module was the type's original home.
 */
export type { MetricColorVariant };

/**
 * DOM PASS-THROUGH (objectui#4426). `MetricWidget` ends its prop list with a
 * `...domProps` spread onto the Shadcn `Card` — a `div` — so `id`, `role`,
 * `aria-*`, `data-*`, `tabIndex`, `title` and the DOM event handlers reach the
 * element. objectui#4357 (PR #4428) deliberately KEPT that spread: it is the
 * component's only accessibility passthrough, and removing it would delete the
 * only way a host can put an `id` or an `aria-label` on a KPI card.
 *
 * Until now the type refused what the runtime accepted. A TypeScript consumer
 * importing the component directly could not write `<MetricWidget id="revenue"
 * role="region" aria-label="Revenue KPI" … />` without a cast, while a JS
 * consumer and every SDUI author going through `SchemaRenderer` (untyped at
 * that boundary) got the passthrough for free. This `extends` is that
 * declaration — the mirror image of #4357, closing the same question from the
 * other side: renderer metadata was reaching the DOM because the spread is
 * open; DOM attributes were unreachable because the type was closed.
 *
 * Measured convention, not an invented spelling: an exported `*Props` interface
 * that spreads onto a host element extends `React.HTMLAttributes<HTMLDivElement>`
 * here — `PageHeaderComponentProps` (whose own doc says "it extends
 * `HTMLAttributes` so every DOM prop rides along"), `ChatbotProps`,
 * `ChatbotEnhancedProps`, `TypingIndicatorProps`, `RefreshIndicatorProps`,
 * `FieldProps`, and shadcn's own `BadgeProps`.
 *
 * What this does NOT declare, deliberately: the schema-shaped keys
 * `SchemaRenderer` injects (`schema` / `bind` / `events` / `props` /
 * `ariaLabel` / `ariaDescribedBy` / `dataSource`). None of them is an HTML
 * attribute name, all seven are destructured out and never reach the DOM, and
 * declaring them here would re-assert as a public contract exactly what #4357
 * stripped. They stay in `SchemaHostProps`, intersected in at the component's
 * own signature — the renderer's private door, not the consumer's front door.
 * The narrower `FieldWidgetDomProps` shape (objectui#3221) is the other spelling
 * in this repo, but it exists to be bound key-by-key to a runtime whitelist
 * (`toDomProps`) in both directions, and this declaration is the DIRECT React
 * door's, which keeps no whitelist.
 *
 * The renderer's door does (objectui#4425, phase 2): rendered through
 * `SchemaRenderer`, this component's element receives only what `toDomProps`
 * passes, so an authored key it does not declare — or `name`, or an authored
 * `title` — no longer reaches the `Card`. This declaration governs the direct
 * door only, and what it promises still arrives there. Both doors, and how the
 * component tells them apart, are `hostDomProps` in `./schemaHostProps`.
 */
export interface MetricWidgetProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * The KPI's heading, in @objectstack/spec's `I18nLabel` vocabulary — a plain
   * string or an inline per-locale map (`{ en: 'Revenue', 'zh-CN': '收入' }`).
   *
   * Was `string | { key?, defaultValue? }` — the key-reference form
   * objectstack#5055 RETIRED. It is not accepted here any more because the spec
   * rejects it at authoring time, and because reading it was never the point:
   * the private resolver behind it ended `defaultValue || key` and never
   * consulted a bundle, so the escape hatch was declared and inert
   * (objectui#4032).
   */
  label: string | I18nLabel;
  value: string | number;
  trend?: {
    value: number;
    label?: string | I18nLabel;
    direction?: 'up' | 'down' | 'neutral';
  };
  /**
   * The `compareTo`-derived trend a host computed with `computeMetricDelta`
   * (`ObjectMetricWidget`); it replaces `trend` outright when set. Host state,
   * ⛔ not a node key: its `value` may be `null` — a zero baseline, which has
   * no percentage and draws as a dash (objectui#12677) — while the authored
   * `trend.value` stays the number the spec declares.
   */
  derivedTrend?: MetricDelta & { label?: string };
  icon?: React.ReactNode | string;
  className?: string;
  description?: string | I18nLabel;
  /** When true, the widget is in a loading state (fetching data from server). */
  loading?: boolean;
  /** Error message from a failed data fetch. When set, the widget shows an error state. */
  error?: string | null;
  /** Visual color variant — tints the icon container while keeping the card neutral. */
  colorVariant?: MetricColorVariant;
  /** numeral.js-style format pattern (e.g. `'0,0'`, `'0,0.00'`, `'$0,0'`, `'0%'`). */
  format?: string;
  /** ISO currency code (e.g. `'USD'`); enables currency formatting on numeric values. */
  currency?: string;
  /**
   * Static prefix appended in front of the formatted value (e.g. `'$'`, `'¥'`).
   *
   * Same name, same `string` type as the inherited RDFa `prefix` attribute, and
   * this declaration wins: the component reads it and destructures it out, so
   * it never reaches the DOM. That is the accurate contract — it was already
   * true before this interface declared its passthrough.
   */
  prefix?: string;
  /** Static suffix appended after the formatted value (e.g. `' /mo'`). */
  suffix?: string;
  /**
   * When set, the entire card becomes clickable and emits this handler.
   *
   * Deliberately NARROWER than the inherited `MouseEventHandler<HTMLDivElement>`:
   * the KPI card treats a click as "the tile was activated" and wires the same
   * handler to Enter/Space, where there is no mouse event to hand over. A
   * zero-arg function is assignable to the inherited signature, so consumers
   * already passing `(e) => …` keep compiling; this only stops the component
   * from promising an event object its keyboard path cannot produce.
   */
  onClick?: () => void;
  /**
   * Layout variant. `'card'` (default) is the bordered KPI card; `'bare'` drops
   * all card chrome and renders a large tinted number + label — the dense
   * big-number look data-screens (大屏) want, while staying data-bound.
   */
  variant?: 'card' | 'bare';
}

export const MetricWidget = ({
  label,
  value,
  trend,
  derivedTrend,
  icon,
  className,
  description,
  loading,
  error,
  colorVariant = 'default',
  format,
  currency,
  prefix,
  suffix,
  onClick,
  variant = 'card',
  // Schema-shaped props `SchemaRenderer` injects, destructured out so the
  // spread below cannot write them to the DOM (objectui#4357). Named and
  // measured in `./schemaHostProps`; `schema` alone put a
  // `schema="[object Object]"` attribute on every KPI card.
  // Kept under its old binding name, so the exported signature's declaration
  // text is unchanged; it is READ now, as the door discriminator below.
  schema: _schema,
  bind: _bind,
  events: _events,
  props: _propsBag,
  ariaLabel: _ariaLabel,
  ariaDescribedBy: _ariaDescribedBy,
  dataSource: _dataSource,
  ...domProps
}: MetricWidgetProps & SchemaHostProps) => {
  // What the `Card` may carry (objectui#4425): on the renderer's door, only
  // what `toDomProps` passes — the open tail of authored keys this component
  // does not declare stops here; on the direct React door, the declared
  // `HTMLAttributes` pass-through, unchanged. See `hostDomProps`.
  const hostProps = hostDomProps(_schema, domProps);
  const shownTrend = derivedTrend ?? trend;
  const iconClasses = VARIANT_ICON_CLASSES[colorVariant] || VARIANT_ICON_CLASSES.default;
  const { t: tTrend } = useTrendT();
  // Two locale channels, deliberately distinct. `useDisplayLocale` is the
  // NUMBER locale (objectui#4033 — tenant regional default outranks UI
  // language); `language` is the UI language, which is what label text follows.
  // Keep them separate: swapping either for the other silently changes the
  // other surface's behaviour.
  const locale = useDisplayLocale();
  const { language } = useObjectTranslation();

  const resolvedLabel = useMemo(() => pickLocalized(label, language) || undefined, [label, language]);

  const localizedTrendLabel = useMemo(() => {
    const raw = pickLocalized(description, language) || pickLocalized(shownTrend?.label, language) || undefined;
    if (!raw) return raw;
    const key = trendLabelKey(raw);
    return key ? tTrend(key) : raw;
  }, [description, shownTrend?.label, tTrend, language]);

  const displayValue = useMemo(() => {
    const formatted = typeof value === 'number' || (typeof value === 'string' && value.trim() !== '' && isFinite(Number(value)))
      ? formatMetricValue(value, format, currency, locale)
      : (value ?? '');
    const formattedStr = String(formatted);
    // Avoid duplicating a currency-style prefix/suffix that the formatter
    // already produced (e.g. format='$0,0' + prefix='$' → '$$0').
    const effectivePrefix = prefix && formattedStr.startsWith(prefix) ? '' : (prefix ?? '');
    const effectiveSuffix = suffix && formattedStr.endsWith(suffix) ? '' : (suffix ?? '');
    return `${effectivePrefix}${formattedStr}${effectiveSuffix}`;
  }, [value, format, currency, prefix, suffix, locale]);

  // Resolve icon if it's a string — uses lazy resolver so we don't pull
  // the entire lucide-react namespace into the bundle.
  const resolvedIcon = useMemo(() => {
    if (typeof icon === 'string') {
      const IconComponent = getLazyIcon(icon);
      // eslint-disable-next-line react-hooks/static-components -- getLazyIcon returns a module-cached stable component per name, not one created during render
      return IconComponent ? <IconComponent className="h-4 w-4" /> : null;
    }
    return icon;
  }, [icon]);

  if (variant === 'bare') {
    const textClasses = VARIANT_TEXT_CLASSES[colorVariant] || VARIANT_TEXT_CLASSES.default;
    return (
      <div
        className={cn('flex flex-col gap-1 min-w-0', onClick && 'cursor-pointer', className)}
        onClick={onClick}
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
        onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
      >
        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground" data-testid="metric-loading">
            <Loader2 className="h-4 w-4 animate-spin" /><span className="text-sm">Loading…</span>
          </div>
        ) : error ? (
          <div className="flex items-center gap-2" data-testid="metric-error" role="alert">
            <AlertCircle className="h-4 w-4 text-destructive shrink-0" /><span className="text-xs text-destructive truncate">{error}</span>
          </div>
        ) : (
          <>
            <div className={cn('text-[2rem] leading-none font-extrabold tabular-nums tracking-tight truncate', textClasses)}>{displayValue}</div>
            <div className="text-xs font-medium text-muted-foreground truncate">{resolvedLabel}</div>
          </>
        )}
      </div>
    );
  }

  return (
    <Card
      className={cn(
        "h-full overflow-hidden",
        // objectui#12623 — the tile's own box is what the title, value and
        // label rules in `./metricTile` measure.
        METRIC_TILE_CONTAINER_CLASS,
        onClick && "cursor-pointer transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        className,
      )}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      } : undefined}
      {...hostProps}
    >
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className={METRIC_TILE_TITLE_CLASS} title={resolvedLabel}>
          {resolvedLabel}
        </CardTitle>
        {resolvedIcon && (
          <div
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-md shrink-0",
              iconClasses,
            )}
          >
            {resolvedIcon}
          </div>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground" data-testid="metric-loading">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading…</span>
          </div>
        ) : error ? (
          <div className="flex items-center gap-2" data-testid="metric-error" role="alert">
            <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
            <span className="text-xs text-destructive truncate">{error}</span>
          </div>
        ) : (
          <>
            <div className={cn('font-bold tracking-tight', metricTileValueClass(displayValue))} title={metricTileValueTitle(displayValue)}>{displayValue}</div>
            {(shownTrend || description) && (
              <div className="text-xs text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
                {shownTrend && (
                  <span className={cn(
                    "flex items-center shrink-0 font-medium",
                    shownTrend.direction === 'up' && "text-emerald-600 dark:text-emerald-400",
                    shownTrend.direction === 'down' && "text-rose-600 dark:text-rose-400",
                    shownTrend.direction === 'neutral' && "text-muted-foreground"
                  )}>
                    {shownTrend.direction === 'up' && <ArrowUpIcon className="h-3 w-3 mr-1" />}
                    {shownTrend.direction === 'down' && <ArrowDownIcon className="h-3 w-3 mr-1" />}
                    {shownTrend.direction === 'neutral' && <MinusIcon className="h-3 w-3 mr-1" />}
                    {formatMetricDeltaPercent(shownTrend.value)}
                  </span>
                )}
                <span className="truncate min-w-0">{localizedTrendLabel}</span>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};
