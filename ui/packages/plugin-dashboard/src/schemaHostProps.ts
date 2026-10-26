/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { toDomProps, type DomProps } from '@object-ui/core';

/**
 * The props `SchemaRenderer` hands a widget that are NOT DOM attributes
 * (objectui#4357).
 *
 * A dashboard widget is two things at once: an SDUI block reached through
 * `SchemaRenderer`, and a plain React component a host may render directly.
 * The React half wants a `...props` spread onto its root element so callers can
 * pass `aria-*`, `data-*`, `id`, `role`, `className`. The SDUI half means that
 * spread also receives the node's own metadata — and React writes unknown
 * lowercase attributes straight to the DOM, stringifying object values. That is
 * how every KPI card ended up with `schema="[object Object]"`.
 *
 * MEASURED at the call site (`packages/react/src/SchemaRenderer.tsx`, the
 * `React.createElement(Component, …)` block), one render carrying every SDUI key
 * at once. What a widget receives, and the attribute each one emitted:
 *
 *   | prop              | emitted as                   | what it is                           |
 *   |-------------------|------------------------------|--------------------------------------|
 *   | `schema`          | `schema="[object Object]"`   | the node itself, injected EVERY render |
 *   | `events`          | `events="[object Object]"`   | SDUI action metadata (`onClick: […]`) |
 *   | `props`           | `props="[object Object]"`    | the props container — the renderer already spreads its CONTENTS separately, so the container is pure metadata |
 *   | `bind`            | `bind="data.revenue"`        | SDUI data-binding path                |
 *   | `ariaLabel`       | `arialabel="…"`              | camelCase authored form; the renderer already emits the resolved `aria-label` |
 *   | `ariaDescribedBy` | `ariadescribedby="…"`        | ditto for `aria-describedby`          |
 *   | `dataSource`      | `datasource="[object Object]"` | the injected data-source ADAPTER    |
 *
 * `dataSource` is the one a schema-only measurement misses, and the only one
 * that leaks on a *production* dashboard rather than an authored edge case.
 * It does not come from the node: `SchemaRenderer` strips the schema's own
 * `dataSource` BINDING by name (objectstack#5576) — this is the adapter object
 * `DashboardRenderer` hands its `SchemaRenderer` call, which arrives through the
 * renderer's trailing `...props` and lands on whatever the widget spreads onto.
 * A dashboard rendered without a data source (every test fixture) leaves it
 * `undefined` and nothing shows; a dashboard rendered with one — every live
 * deployment — put `datasource="[object Object]"` on the card.
 *
 * The line this type draws is **"is the key an HTML attribute name"**. None of
 * the seven is (the two dashed `aria-*` forms the renderer emits itself are, and
 * they keep flowing). Removing the spread instead would have been the wrong fix —
 * it is the component's only accessibility passthrough.
 *
 * ⚠️ That line was a DENY-LIST, and on the renderer's door it is no longer the
 * judge. It stripped every one of the seven and the leak gate
 * (`packages/app-shell/src/__tests__/widget-dom-leak-sweep.test.tsx`) still
 * found the OPEN TAIL on both components — an authored key neither declares
 * (`zzcanary`, `reference_to`, a `props: { colorVariant }` on `metric-card`, a
 * `label` on `metric-card`) and `name` all landed as attributes, because a
 * deny-list can only name what already exists. Per objectui#4425's phase-2
 * ruling, what a component reached through `SchemaRenderer` may put on its
 * element is decided by `toDomProps`' WHITELIST — see {@link hostDomProps}
 * below. The seven are still destructured by name: they are this type's keys,
 * and on the direct React door (below) the destructure is still what keeps them
 * off the element.
 *
 * The renderer strips its own schema metadata (`type` / `children` / `visible` /
 * the schema's `dataSource` binding / …) before spreading, so those never
 * arrive; this type covers only what survives that strip — including the
 * adapter, which arrives by a different door. Declared here rather than in each component
 * because two copies of one key list is how a list becomes two disagreeing
 * lists — the same reason `colorVariants` was extracted. The pin that keeps the
 * declaration honest for BOTH components is
 * `__tests__/MetricWidget.domProps.test.tsx`.
 */
export interface SchemaHostProps {
  /** The widget's own schema node, injected by `SchemaRenderer` on every render. */
  schema?: unknown;
  /** SDUI data-binding path (`'user.address.city'`). */
  bind?: unknown;
  /** SDUI event handlers (`{ onClick: [ActionDef, …] }`) — data, not DOM. */
  events?: unknown;
  /** The schema's props container; its contents are spread separately. */
  props?: unknown;
  /** Authored camelCase ARIA; the renderer emits the resolved `aria-label`. */
  ariaLabel?: unknown;
  /** Authored camelCase ARIA; the renderer emits `aria-describedby`. */
  ariaDescribedBy?: unknown;
  /**
   * The injected data-source adapter, forwarded by `DashboardRenderer` through
   * `SchemaRenderer`'s trailing props. Neither metric component reads it — the
   * async, object-aware KPI is `ObjectMetricWidget`.
   */
  dataSource?: unknown;
}

/**
 * What a KPI card may spread onto its host element, decided by the DOOR the
 * render came through (objectui#4425, phase-2 ruling: "a registered SDUI
 * widget's host element receives only what passes the `toDomProps` whitelist").
 *
 * Both metric components have two doors, and they hand the component two
 * different populations:
 *
 *   - **The renderer's door.** `SchemaRenderer` — the registry render path, and
 *     so also an app that registers the exported component under a key of its
 *     own — hands the component the authored node's own keys, the contents of
 *     its `props` container, the runtime props it injects and its host's
 *     trailing props. That set is unbounded, so only the whitelist may decide
 *     what reaches the element: `toDomProps` keeps the SDUI contract's declared
 *     pass-through set (`SDUI_DOM_PASS_THROUGH_KEYS`) and the `aria-*` /
 *     `data-*` families, and drops everything else — `name`, `disabled`, the
 *     injected adapter, every authored key neither component declares. One
 *     executor, `@object-ui/core`'s, the
 *     one `DashboardRenderer`'s grid container and `plugin-chatbot`'s
 *     registrations already use — not a third list.
 *   - **The direct React door.** A host rendering the exported component passes
 *     typed props, and both props interfaces DECLARE `React.HTMLAttributes` as
 *     their DOM pass-through (objectui#4426). That declaration is the
 *     objectui#4435 pattern the ruling keeps available, so this door stays as it
 *     was: narrowing it at runtime while the exported interface still extends
 *     `HTMLAttributes` would type-check a `title` or an `onMouseEnter` and drop
 *     it — declared but not delivered. Narrowing the interface itself is a
 *     public prop-surface change, which this card's fence excludes.
 *
 * The discriminator is `schema`: the one key `SchemaRenderer` injects on EVERY
 * render (the table above), declared on this type as the renderer's private
 * door and never on either exported props interface. A direct consumer that
 * passes it anyway has chosen the renderer's door and gets the whitelist, so a
 * mistaken reading DROPS an attribute and never leaks one. If the renderer ever
 * stopped injecting it, every canary the leak gate plants would reach the DOM
 * again and the gate would go red — that sweep is what holds this function to
 * its claim, alongside `__tests__/MetricWidget.domProps.test.tsx`.
 */
export function hostDomProps<P extends object>(schema: unknown, rest: P): P | DomProps<P> {
  return schema === undefined ? rest : toDomProps(rest);
}
