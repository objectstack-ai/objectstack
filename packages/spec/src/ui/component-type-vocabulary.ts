// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The page-component TYPE vocabulary claim (#12950, riding the #12183 ruling of
 * 2026-08-26) — which `PageComponentSchema.type` strings the spec answers for,
 * and which half of the string space stays open.
 *
 * ## The contract this file states
 *
 * `PageComponentSchema.type` is `z.union([PageComponentType, z.string()])` — an
 * open namespace for custom components, and that HALF IS DELIBERATE (maintainer
 * ruling 2026-08-05 on the props-gate direction; re-affirmed by every
 * registered-through-the-string-arm widget since: `cloud-connection:panel`,
 * `marketplace:installed-list`, `mcp:connect-agent`, the `object-*` SDUI block
 * family, objectui's kebab legacy `page-header`, and the `custom.*` shapes
 * pinned in `page.test.ts`). Collapsing the union to the enum would reject all
 * of them — measured, not assumed.
 *
 * What was NOT deliberate is that the open arm also swallowed the spec's OWN
 * namespaces: `global:serch` parsed as happily as `global:search`, validated
 * clean, and rendered the "Component Placeholder" scaffold in front of an end
 * user — the exact ADR-0078 failure shape, measured in a real browser on the
 * origin card. So the claim is namespace-shaped:
 *
 *   - **Inside a namespace the enum itself populates** (derived below, never
 *     restated), the vocabulary is CLOSED at author time: a type neither the
 *     enum, nor `ComponentPropsMap`, nor the string-arm registration ledger
 *     below declares is refused by the `component-type-unknown` authoring rule
 *     (`@objectstack/lint`).
 *   - **Everywhere else** — plugin namespaces (`mcp:`, `cloud-connection:`,
 *     `marketplace:`), block names without a namespace (`flex`, `grid`,
 *     `object-chart`), dot shapes (`custom.widget`) — the string arm stays
 *     exactly as open as it was. Custom components keep their own namespaces;
 *     the spec only answers for its own.
 *
 * The parse itself is UNCHANGED — this is a validate-time claim, not a union
 * narrowing. Stored documents keep loading, conversions keep walking, and the
 * refusal lands at the authoring doors (`os validate` / `os build` / `os lint`)
 * where the author who typed the string is still present to fix it.
 */

import { PageComponentType } from './page.zod';
import { ComponentPropsMap } from './component.zod';

/**
 * Registered renderers reachable ONLY through the type union's open string arm,
 * inside a spec-reserved namespace, with no `ComponentPropsMap` row — the
 * ledger of why each one is exempt from the closed-vocabulary claim, in the
 * `REACT_OVERLAY_SHADOWS` house shape: an exemption is deliberate, evidenced,
 * and written down next to itself, or it does not exist.
 *
 * - `record:line_items` — objectui registers it (`plugin-form/src/index.tsx`,
 *   the inline-editable child grid of objectui ADR-0001) and lists it as a
 *   public block (`core/src/registry/public-blocks.ts`); the showcase authors
 *   it (`examples/app-showcase/src/ui/pages/project-detail.page.ts`). Its
 *   row-lessness in `ComponentPropsMap` is pinned deliberately in
 *   `validate-component-props.test.ts` — a registered-but-unmeasured gap of the
 *   record-blocks class, to be measured into the map by the renderer-read-point
 *   method, not silently grandfathered by this file. When that row lands, the
 *   vocabulary test beside this file forces this entry OUT (a ledger row for a
 *   type the map declares is dead weight).
 *
 * Growing this list is a contract decision, not a convenience: every entry is a
 * type the spec's own namespace claim cannot see, so each one needs the same
 * three-part evidence face as the entry above (registration, publication,
 * authorship) written into its comment.
 */
export const STRING_ARM_REGISTERED_TYPES: readonly string[] = ['record:line_items'];

/**
 * The namespaces the enum itself populates — DERIVED, never restated, so a new
 * enum member in a new namespace claims that namespace the day it lands
 * (`vocabulary-derivation.test.ts` discipline: a restated list keeps validating
 * while the enum no longer says what it says).
 */
export const RESERVED_COMPONENT_TYPE_NAMESPACES: ReadonlySet<string> = new Set(
  PageComponentType.options.map((t) => t.slice(0, t.indexOf(':'))),
);

/**
 * Every type string the spec answers for: the enum vocabulary, every
 * `ComponentPropsMap` row (which is a superset of the enum by exactly the
 * measured string-arm registrations that DID get a row — `element:metadata_viewer`,
 * the retired-with-tombstones `element:filter` / `element:form`, the plugin
 * console widgets, the `object-*` blocks), and the string-arm ledger above.
 */
export const KNOWN_COMPONENT_TYPES: ReadonlySet<string> = new Set([
  ...PageComponentType.options,
  ...Object.keys(ComponentPropsMap),
  ...STRING_ARM_REGISTERED_TYPES,
]);

/**
 * Stable candidate list for typo suggestions — only the types an author may
 * actually write inside a reserved namespace, sorted for deterministic output.
 */
export const KNOWN_COMPONENT_TYPE_CANDIDATES: readonly string[] =
  [...KNOWN_COMPONENT_TYPES].sort();

/**
 * Is this type inside a namespace the spec's enum claims? (`record:detials` →
 * true; `mcp:connect-agent` → false; `flex` / `custom.widget` → false — no
 * colon-namespace at all.)
 */
export function hasReservedComponentNamespace(type: string): boolean {
  const colon = type.indexOf(':');
  if (colon <= 0) return false;
  return RESERVED_COMPONENT_TYPE_NAMESPACES.has(type.slice(0, colon));
}

/** Does the spec answer for this exact type string? */
export function isKnownComponentType(type: string): boolean {
  return KNOWN_COMPONENT_TYPES.has(type);
}
