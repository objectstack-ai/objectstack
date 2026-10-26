/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

"use client"

import * as React from "react"
import { ResponsiveContainer, Tooltip, Legend } from "recharts"
import { useDisplayLocale } from "@object-ui/i18n"

// Utility function to merge class names (inline to avoid external dependency)
const cn = (...classes: (string | undefined)[]) => classes.filter(Boolean).join(' ')

// Format: { THEME_NAME: CSS_SELECTOR }
const THEMES = { light: "", dark: ".dark" } as const

/**
 * Per-series presentation for `<ChartContainer>`: a map from series dataKey to
 * the legend label, icon and colour (or per-theme colours) that key renders
 * with. Shadcn's chart primitive, kept in this package's own copy of it.
 *
 * Named `ChartContainerConfig`, not `ChartConfig` (objectui#3161,
 * objectstack#4115 ledger batch 7). `@objectstack/spec/ui` owns `ChartConfig`
 * for the authored chart METADATA — `type: bar | line | pie | …`, `xAxis`,
 * `yAxis`, `series`, `showLegend`, `annotations` — and the collision was not
 * theoretical here: `AdvancedChartImpl.tsx` declares `config?: ChartConfig`
 * meaning THIS map, three lines above doc comments that say "Spec
 * `ChartConfig.yAxis`" and "Spec `ChartConfig.showLegend`" meaning the other
 * one. One identifier, two concepts, one file. `normalizeChartSchema` is the
 * seam between them: it reads the authored spec chart and produces the
 * renderer's axes/series, of which this map is the styling half.
 */
export type ChartContainerConfig = {
  [k in string]: {
    label?: React.ReactNode
    icon?: React.ComponentType
  } & (
    | { color?: string; theme?: never }
    | { color?: never; theme: Record<keyof typeof THEMES, string> }
  )
}

type ChartContextProps = {
  config: ChartContainerConfig
}

const ChartContext = React.createContext<ChartContextProps | null>(null)

/**
 * The height floor a chart falls back to when its consumer declares none.
 *
 * ## Why it is set on the ResponsiveContainer and not only on the wrapper
 *
 * Recharts measures ITS OWN div — `SizeDetectorContainer` renders
 * `<div class="recharts-responsive-container" style="width:100%;height:100%">`,
 * observes THAT element, and renders no children at all while the box it reads
 * is non-positive (`ResponsiveContainerContextProvider` returns `null` for a
 * non-positive size). A percentage height resolves against the containing
 * block's `height`; `min-height` never makes that height definite (CSS 2.1
 * §10.5 — a percentage height against a containing block whose height is not
 * specified explicitly computes to `auto`). So a floor on the WRAPPER cannot
 * reach the element that is measured: the wrapper obediently grows to 280, and
 * the div inside it stays at its content height, which is 0 because Recharts'
 * inner sizing div is deliberately zero-size + overflow-visible.
 *
 * Measured in Chromium 141 on the dashboard chart path, with the wrapper's
 * `h-[350px]` neutralised so the fallback is the only thing holding the box up:
 *
 *   wrapper `[data-slot="chart"]`      638 x 280   ← floor applied, looks fine
 *   `.recharts-responsive-container`   638 x   0   ← the measured element
 *   → 0 `.recharts-surface`, 0 marks, and NO refusal, NO empty state, NO
 *     loading state: a widget card with its title over a blank 280px area.
 *
 * That is the whole failure mode, and it is PERMANENT rather than a race: the
 * box never changes, so no ResizeObserver notification ever arrives to heal it.
 * (Recharts 3 does heal a genuinely late measurement — a chart mounted inside a
 * `display:none` subtree paints every mark the moment the subtree is revealed,
 * measured on the same rig. Which is why "mounts unmeasured and never redraws"
 * is NOT what blanks these charts; being measured at a real, permanent zero is.)
 *
 * The rule this encodes: **the floor belongs on the element that is measured.**
 * Both call sites below are gated on the same `hasDeclaredHeight`, so a
 * consumer's explicit height still wins in both places and nothing an author
 * sized deliberately is floored.
 *
 * ## How a chart loses its height in the first place
 *
 * `cn` in this file is a plain join, NOT `tailwind-merge`, so a consumer
 * `className` carrying a height utility does not REPLACE `h-[350px]` — both
 * land in the class attribute and the winner is decided by stylesheet order,
 * not by intent. Measured on the same rig: a dashboard chart carrying
 * `DashboardRenderer`'s `"h-[200px] sm:h-[250px] md:h-[300px]"` renders at
 * 300px, i.e. the CONSUMER's height wins over this file's `h-[350px]`.
 *
 * So whether the wrapper ends up with a definite height is decided by whichever
 * height utility a consumer happens to pass. `DashboardGridLayout` passes
 * `className: "h-full"`, and `h-full` is `height: 100%` — definite only while
 * some ancestor supplies a definite height. Whether that particular chain
 * collapses in production is NOT measured here; what is measured is that when
 * any such chain does resolve to `auto`, the result is the invisible chart
 * above. Untangling the className collision belongs upstream in the consumers;
 * this floor is what makes a collision cost a shorter chart rather than an
 * invisible one.
 */
const CHART_MIN_HEIGHT = 280

function useChart() {
  const context = React.useContext(ChartContext)

  if (!context) {
    throw new Error("useChart must be used within a <ChartContainer />")
  }

  return context
}

function ChartContainer({
  id,
  className,
  children,
  config,
  disableSettleRemount,
  style,
  ...props
}: React.ComponentProps<"div"> & {
  config: ChartContainerConfig
  children: React.ComponentProps<
    typeof ResponsiveContainer
  >["children"]
  /**
   * Skip the settle re-mount below. Set by callers that render their series with
   * `isAnimationActive={false}` (e.g. dashboard charts, see #2756): with no
   * entrance-animation tween there is nothing to "heal", so re-mounting would
   * only cost a needless 1-frame ResponsiveContainer reflow on first paint.
   */
  disableSettleRemount?: boolean
}) {
  const uniqueId = React.useId()
  const chartId = `chart-${id || uniqueId.replace(/:/g, "")}`

  // Re-mount the chart exactly ONCE, after its container has settled at a real,
  // non-zero size. Why: a Recharts bar/area/line entrance animation is a
  // requestAnimationFrame tween that starts at height 0 (see recharts'
  // JavascriptAnimate: `useState(isActive ? 0 : 1)`). Inside a react-grid-layout
  // dashboard the widget's box settles over several frames right after mount,
  // and the tween kicked off during that churn can be interrupted before it ever
  // advances past 0 — so the chart paints its axes/labels but the bars stay stuck
  // at height 0. Any *unrelated* later re-render (a theme toggle, a manual
  // resize) mints a fresh Recharts `animationId`, which re-keys the tween and
  // lets it replay to completion — which is why the bars "appear on resize". We
  // reproduce that single healing re-render automatically: once the ResizeObserver
  // reports that size changes have stopped at a positive box, we bump
  // `settleNonce`, which re-keys the ResponsiveContainer below so the whole chart
  // performs one clean re-mount in a quiet window. The entrance animation then
  // runs uninterrupted and the bars actually draw on first paint.
  //
  // The nonce only ever bumps under a genuine layout engine (a positive, stable
  // box). Headless/jsdom/happy-dom renders report a 0×0 box, so `settleNonce`
  // stays 0 and those tests see a single, ordinary render. See
  // dashboard-chart-empty-first-render.
  //
  // NOTE (#2756): the settle re-mount only *heals* an interrupted entrance
  // animation — it bets that a clean re-mount replays the tween to completion.
  // In a live react-grid-layout dashboard that bet doesn't hold (the re-mount
  // itself can land back in the grid/measurement churn), so dashboard charts
  // instead render with `isAnimationActive={false}` and pass
  // `disableSettleRemount` — there is no tween to heal and no reflow to pay for.
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const [settleNonce, setSettleNonce] = React.useState(0)
  React.useEffect(() => {
    if (disableSettleRemount) return
    const el = containerRef.current
    if (el == null || typeof ResizeObserver === "undefined") return

    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const observer = new ResizeObserver((entries) => {
      if (settled) return
      const box = entries[0]?.contentRect
      if (box == null || box.width <= 0 || box.height <= 0) return
      // Debounce: only re-mount once size changes have STOPPED, so we replay the
      // entrance animation after the grid finishes settling — not midway through
      // it (which would just re-arm the same race).
      if (timer != null) clearTimeout(timer)
      timer = setTimeout(() => {
        settled = true
        observer.disconnect()
        setSettleNonce((n) => n + 1)
      }, 80)
    })
    observer.observe(el)
    return () => {
      settled = true
      if (timer != null) clearTimeout(timer)
      observer.disconnect()
    }
  }, [disableSettleRemount])

  // The min-size fallback exists so Recharts' ResponsiveContainer always has a
  // non-zero box to measure: a consumer that overrides our `h-[350px]` class
  // (e.g. a dashboard widget wrapping the chart in flex/grid without an explicit
  // child height) would otherwise leave the container at 0, Recharts would
  // measure width/height = -1, and the chart would render invisibly.
  //
  // It is applied in TWO places, and both are load-bearing — see
  // CHART_MIN_HEIGHT for the measurement that says why one is not enough.
  //
  // The merge is written out explicitly and `style` is destructured out of the
  // rest props above, so which side wins is no longer decided by JSX attribute
  // order. It used to be: `style={{ minHeight: 280, ... }}` was written BEFORE
  // `{...props}`, and `props` still carried the consumer's `style`, so the later
  // spread replaced the whole object — both fallbacks silently vanished and the
  // `...props.style` merge inside it never ran at all (objectstack#7026).
  //
  // Precedence: an author's explicit size WINS. Injecting `minHeight: 280`
  // next to an authored `height: 100` would floor that 100 to 280, so each half
  // of the fallback applies only when the consumer style declares neither of its
  // own keys — `height`/`minHeight` for the height half, `width`/`minWidth` for
  // the width half. A key set to `undefined`/`null` counts as not declared. All
  // other consumer style keys pass through untouched.
  const hasDeclaredHeight = style?.height != null || style?.minHeight != null
  const hasDeclaredWidth = style?.width != null || style?.minWidth != null
  const containerStyle: React.CSSProperties = {
    ...(hasDeclaredHeight ? {} : { minHeight: CHART_MIN_HEIGHT }),
    ...(hasDeclaredWidth ? {} : { minWidth: 0 }),
    ...style,
  }

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        ref={containerRef}
        data-slot="chart"
        data-chart={chartId}
        className={cn(
          // Block (not flex) so Recharts' ResponsiveContainer child fills the
          // box. Under `flex ... justify-center` the container collapsed to its
          // content width (0) on first paint inside react-grid-layout, so
          // Recharts measured width(-1) and rendered nothing until a later
          // resize fired its ResizeObserver — leaving dashboard charts blank.
          "block w-full h-[350px] text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground",
          className
        )}
        // Merged above, NOT here: `style` is destructured out of `props`, so the
        // spread below can no longer replace it (objectstack#7026).
        style={containerStyle}
        {...props}
      >
        <ChartStyle id={chartId} config={config} />
        <ResponsiveContainer
          key={settleNonce}
          width="100%"
          height="100%"
          // The SAME floor, on the element that is actually measured. See
          // CHART_MIN_HEIGHT: a floor on the wrapper above cannot reach this
          // div, because this div sizes itself from `height: 100%`.
          {...(hasDeclaredHeight ? {} : { minHeight: CHART_MIN_HEIGHT })}
        >
          {children}
        </ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  )
}

const ChartStyle = ({ id, config }: { id: string; config: ChartContainerConfig }) => {
  const colorConfig = Object.entries(config).filter(
    ([, config]) => config.theme || config.color
  )

  if (!colorConfig.length) {
    return null
  }

  return (
    <style
      dangerouslySetInnerHTML={{
        __html: Object.entries(THEMES)
          .map(
            ([theme, prefix]) => `
${prefix} [data-chart=${id}] {
${colorConfig
  .map(([key, itemConfig]) => {
    const color =
      itemConfig.theme?.[theme as keyof typeof itemConfig.theme] ||
      itemConfig.color
    return color ? `  --color-${key}: ${color};` : null
  })
  .join("\n")}
}
`
          )
          .join("\n"),
      }}
    />
  )
}

const ChartTooltip = Tooltip

function ChartTooltipContent({
  active,
  payload,
  className,
  indicator = "dot",
  hideLabel = false,
  hideIndicator = false,
  label,
  labelFormatter,
  labelClassName,
  formatter,
  color,
  nameKey,
  labelKey,
}: any) {
  const { config } = useChart()
  // The tooltip value is a number face a user reads off the chart, so it is
  // formatted in the display locale like the axis ticks beside it — a bare
  // `toLocaleString()` handed `Intl` the MACHINE's locale (objectui#9909).
  const displayLocale = useDisplayLocale()

  const tooltipLabel = React.useMemo(() => {
    if (hideLabel || !payload?.length) {
      return null
    }

    const [item] = payload
    const key = `${labelKey || item?.dataKey || item?.name || "value"}`
    const itemConfig = getPayloadConfigFromPayload(config, item, key)
    const value =
      !labelKey && typeof label === "string"
        ? config[label as keyof typeof config]?.label || label
        : itemConfig?.label

    if (labelFormatter) {
      return (
        <div className={cn("font-medium", labelClassName)}>
          {labelFormatter(value, payload)}
        </div>
      )
    }

    if (!value) {
      return null
    }

    return <div className={cn("font-medium", labelClassName)}>{value}</div>
  }, [
    label,
    labelFormatter,
    payload,
    hideLabel,
    labelClassName,
    config,
    labelKey,
  ])

  if (!active || !payload?.length) {
    return null
  }

  const nestLabel = payload.length === 1 && indicator !== "dot"

  return (
    <div
      className={cn(
        "border-border/50 bg-background grid min-w-[8rem] items-start gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs shadow-xl",
        className
      )}
    >
      {!nestLabel ? tooltipLabel : null}
      <div className="grid gap-1.5">
        {payload
          .filter((item: any) => item.type !== "none")
          .map((item: any, index: number) => {
            const key = `${nameKey || item.name || item.dataKey || "value"}`
            const itemConfig = getPayloadConfigFromPayload(config, item, key)
            const indicatorColor = color || item.payload.fill || item.color

            return (
              <div
                key={item.dataKey}
                className={cn(
                  "[&>svg]:text-muted-foreground flex w-full flex-wrap items-stretch gap-2 [&>svg]:h-2.5 [&>svg]:w-2.5",
                  indicator === "dot" ? "items-center" : ""
                )}
              >
                {formatter && item?.value !== undefined && item.name ? (
                  formatter(item.value, item.name, item, index, item.payload)
                ) : (
                  <>
                    {itemConfig?.icon ? (
                      <itemConfig.icon />
                    ) : (
                      !hideIndicator && (
                        <div
                          className={cn(
                            "shrink-0 rounded-[2px] border-(--color-border) bg-(--color-bg)",
                            indicator === "dot" ? "h-2.5 w-2.5" : "",
                            indicator === "line" ? "w-1" : "",
                            indicator === "dashed" ? "w-0 border-[1.5px] border-dashed bg-transparent" : "",
                            (nestLabel && indicator === "dashed") ? "my-0.5" : "",
                          )}
                          style={

                            {
                              "--color-bg": indicatorColor,
                              "--color-border": indicatorColor,
                            } as React.CSSProperties
                          }
                        />
                      )
                    )}
                    <div
                      className={cn(
                        "flex flex-1 justify-between leading-none",
                        nestLabel ? "items-end" : "items-center"
                      )}
                    >
                      <div className="grid gap-1.5">
                        {nestLabel ? tooltipLabel : null}
                        <span className="text-muted-foreground">
                          {itemConfig?.label || item.name}
                        </span>
                      </div>
                      {item.value && (
                        <span className="text-foreground font-mono font-medium tabular-nums">
                          {item.value.toLocaleString(displayLocale)}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            )
          })}
      </div>
    </div>
  )
}

const ChartLegend = Legend

function ChartLegendContent({
  className,
  hideIcon = false,
  payload,
  verticalAlign = "bottom",
  nameKey,
}: any) {
  const { config } = useChart()

  if (!payload?.length) {
    return null
  }

  return (
    <div
      className={cn(
        "flex items-center justify-center gap-4",
        verticalAlign === "top" ? "pb-3" : "pt-3",
        className
      )}
    >
      {payload
        .filter((item: any) => item.type !== "none")
        .map((item: any) => {
          const key = `${nameKey || item.dataKey || "value"}`
          const itemConfig = getPayloadConfigFromPayload(config, item, key)

          return (
            <div
              key={item.value}
              className={cn(
                "[&>svg]:text-muted-foreground flex items-center gap-1.5 [&>svg]:h-3 [&>svg]:w-3"
              )}
            >
              {itemConfig?.icon && !hideIcon ? (
                <itemConfig.icon />
              ) : (
                // The series colour is author-declared, so it reaches the DOM
                // only as a custom property a static utility consumes — the
                // same shape as the tooltip indicator above (AGENTS.md styling
                // carve-out; objectui#10021).
                <div
                  className="h-2 w-2 shrink-0 rounded-[2px] bg-(--color-bg)"
                  style={
                    {
                      "--color-bg": item.color,
                    } as React.CSSProperties
                  }
                />
              )}
              {/* Fall back to the series name recharts itself put on the
                  legend item (objectui#7248). The config lookup above is an
                  OVERRIDE layer, so a miss must not erase the label: the
                  swatch renders unconditionally, and a swatch with no text is
                  an unidentifiable coloured dot — on a scatter it read as a
                  stray data point plotted outside the plot area.

                  This is the general form of the pie bug the helper below
                  documents ("legend swatches with NO text at all"). That one
                  was closed by making one family's key resolve; this closes
                  the class, because `item.value` IS the `name` the mark
                  declared and is the last thing standing between a reader and
                  an anonymous dot. Charts whose config already resolves are
                  unaffected — only a currently-EMPTY label changes. */}
              {itemConfig?.label ?? item.value}
            </div>
          )
        })}
    </div>
  )
}

// Helper to extract item config from a payload.
function getPayloadConfigFromPayload(
  config: ChartContainerConfig,
  payload: unknown,
  key: string
) {
  if (typeof payload !== "object" || payload === null) {
    return undefined
  }

  const payloadPayload =
    "payload" in payload &&
    typeof payload.payload === "object" &&
    payload.payload !== null
      ? payload.payload
      : undefined

  let configLabelKey: string = key

  // The DATA ROW wins over the legend/tooltip item's own same-named prop.
  // Recharts item entries carry `type` (the legend ICON shape, e.g. "rect"),
  // `color`, `dataKey` and `value` of their own, so a pie whose category
  // dimension is literally named `type` (`nameKey="type"`) used to resolve to
  // "rect", miss the config, and render legend swatches with NO text at all —
  // a pie of unlabelled colour dots (#3135). Reading the row first keys off the
  // actual category ("设备"), which is what `nameKey` was pointing at.
  if (
    payloadPayload &&
    key in payloadPayload &&
    typeof payloadPayload[key as keyof typeof payloadPayload] === "string"
  ) {
    configLabelKey = payloadPayload[
      key as keyof typeof payloadPayload
    ] as string
  } else if (
    key in payload &&
    typeof payload[key as keyof typeof payload] === "string"
  ) {
    configLabelKey = payload[key as keyof typeof payload] as string
  }

  return configLabelKey in config
    ? config[configLabelKey]
    : config[key as keyof typeof config]
}

export {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  ChartStyle,
}
