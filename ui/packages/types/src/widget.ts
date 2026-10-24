/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types - Widget Manifest & Registry Types
 *
 * Defines the RuntimeWidgetManifest interface for runtime widget registration,
 * plugin auto-discovery from server metadata, and custom widget registry
 * for user-defined components.
 *
 * @module widget
 * @packageDocumentation
 */

import type { ComponentInputControlType } from './base.js';

/**
 * Widget manifest describing a runtime-loadable widget — what
 * `@object-ui/core`'s `WidgetRegistry` registers, and what the designer palette
 * lists.
 *
 * A manifest provides all metadata needed to discover, load, and render
 * a widget without requiring an upfront import of its code.
 *
 * Today this is objectui's ONLY widget-registration contract: no published
 * `@objectstack/spec` schema models one.
 *
 * HISTORY — why the `Runtime` prefix exists, and why it stays.
 * `@objectstack/spec/ui` ONCE exported a **field-widget plugin**
 * `WidgetManifest` (beside its `FieldWidgetProps`), and this interface was
 * renamed off that name to end the collision (objectstack#4115). ⚠️ That schema
 * is GONE — its keys are deliberately no longer enumerated here, and the
 * prefix is not evidence that a spec twin exists: protocol 17 retired the whole
 * widget-registration vocabulary — `WidgetManifest`, `WidgetLifecycle`,
 * `WidgetEvent`, `WidgetProperty`, `WidgetSource` — under ADR-0049
 * enforce-or-remove (objectstack#5055, maintainer ruling 2026-08-06). There is
 * no tombstone key to migrate, because there was never a carrier key: the
 * record is the D3 `SemanticMigration` `ui-widget-i18n-family-retired` plus
 * `ui/WidgetManifest` in the spec's `RETIRED_DEFS_BY_MAJOR` for 17. That entry
 * states the relationship these two types always had, verbatim: "objectui's
 * registry has always carried its own runtime manifest for that
 * (`RuntimeWidgetManifest` / `RuntimeWidgetSource` in `@object-ui/types`,
 * objectui#3161 / [objectstack-ai/objectstack#4115]), which models different keys and never derived from
 * these". `field.widget` is still what it always was — a `z.string()` naming a
 * component the RENDERER has registered.
 *
 * So the bare name is now owned by NOBODY, and the prefix is kept BY CHOICE: a
 * freed word is not a reason to spend a second breaking rename taking it back
 * (objectstack#4988 precedent; the unlock is recorded, not taken —
 * objectui#4164).
 *
 * Tripwire: `__tests__/page-nav-misc-spec-parity.test.ts`. Its "the spec no
 * longer owns `WidgetManifest`" row is the LIVE assertion of that vacancy —
 * read it, not this comment, for what the spec owns today; it goes red if the
 * spec ever re-publishes the name while this package holds it.
 *
 * @example
 * ```ts
 * const manifest: RuntimeWidgetManifest = {
 *   name: 'custom-chart',
 *   version: '1.0.0',
 *   type: 'chart',
 *   label: 'Custom Chart Widget',
 *   description: 'A custom chart powered by D3.',
 *   category: 'data-visualization',
 *   icon: 'BarChart',
 *   source: { type: 'module', url: '/widgets/custom-chart.js' },
 * };
 * ```
 */
export interface RuntimeWidgetManifest {
  /** Unique widget identifier (e.g., 'custom-chart', 'org.acme.table') */
  name: string;

  /** Semver version string */
  version: string;

  /** Component type key used for schema rendering (e.g., 'chart', 'grid') */
  type: string;

  /** Human-readable label for the widget */
  label: string;

  /** Short description of the widget */
  description?: string;

  /** Category for grouping in the designer palette */
  category?: string;

  /** Icon name (Lucide icon name) or SVG string */
  icon?: string;

  /** Thumbnail image URL for the designer palette */
  thumbnail?: string;

  /** Widget loading source configuration */
  source: RuntimeWidgetSource;

  /** Required peer dependencies (e.g., { 'react': '^18.0.0' }) */
  peerDependencies?: Record<string, string>;

  /** Dependencies on other widgets by name */
  dependencies?: string[];

  /** Default props to apply when the widget is first dropped in the designer */
  defaultProps?: Record<string, unknown>;

  /** Input schema for the widget's configurable properties */
  inputs?: WidgetInput[];

  /**
   * LAYOUT containment, carried into `ComponentMeta.isContainer` by the
   * widget registry. ⛔ Not "can contain child components": a widget that
   * renders `schema.children` declares `{ name: 'children', type: 'slot' }`
   * in `inputs` instead — see `ComponentMeta.isContainer` (objectui#9910).
   */
  isContainer?: boolean;

  /** Widget capabilities */
  capabilities?: WidgetCapabilities;

  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Describes how to load the widget's code at runtime.
 *
 * HISTORY — the same rename as {@link RuntimeWidgetManifest}, and the more
 * dangerous half of the collision it ended. `@objectstack/spec/ui` ONCE
 * exported a `WidgetSource` union too (objectstack#4115). Both WERE
 * discriminated unions on `type` that shared the member name `inline` and meant
 * opposite things by it:
 * the spec's `inline` carried source **code** to evaluate (`{ type: 'inline',
 * code: string }`), objectui's carries an **already-resolved component**
 * ({@link WidgetSourceInline}). The other members never overlapped — the spec
 * had `npm`/`remote`, objectui has `module`/`registry` — so a value of one
 * union was never a valid value of the other. ⚠️ The spec's union was retired
 * with the rest of the widget-registration vocabulary (objectstack#5055): the
 * union declared below is objectui's own, and never derived from it.
 *
 * The variant interfaces keep their `WidgetSource…` names: the spec never
 * exported those, and renaming them would churn the public surface without
 * removing a collision.
 *
 * Tripwire: `__tests__/page-nav-misc-spec-parity.test.ts` — its "the spec no
 * longer owns `WidgetSource`" row pins the vacancy.
 */
export type RuntimeWidgetSource =
  | WidgetSourceModule
  | WidgetSourceInline
  | WidgetSourceRegistry;

/**
 * Load from an ES module URL.
 *
 * ⚠️ SECURITY WARNING: Only use URLs from trusted sources.
 * Never pass user-supplied URLs directly. URLs should be validated
 * and controlled by your application. This feature uses dynamic imports
 * which bypass static analysis and may be restricted by Content Security Policy.
 */
export interface WidgetSourceModule {
  type: 'module';
  /**
   * URL to the ES module (e.g., '/widgets/chart.js' or 'https://cdn.example.com/widget.mjs')
   * Must be from a trusted source - never user input.
   */
  url: string;
  /** Named export to use (default: 'default') */
  exportName?: string;
}

/** The component is provided inline (already loaded) */
export interface WidgetSourceInline {
  type: 'inline';
  /** The React component (already resolved) */
  component: unknown;
}

/** The component is registered in the global component registry */
export interface WidgetSourceRegistry {
  type: 'registry';
  /** The component type key in the registry */
  registryKey: string;
}

/**
 * Configurable input for a widget — the authoring face of one entry in a
 * {@link RuntimeWidgetManifest}'s `inputs`.
 *
 * ## `type` names the shared arm vocabulary; it does not restate it
 *
 * `type` is {@link ComponentInputControlType}, the single declaration in
 * `./base.js` (objectui#5675). It used to spell the eleven arm literals inline,
 * which made this the third site writing out one vocabulary — after
 * objectui#3832 gave that vocabulary a name and objectui#4972 converged the
 * last structural copy of the surrounding interface onto `ComponentInput`.
 *
 * The inline restatement was member-equal to the shared declaration when it was
 * replaced — measured in both directions, quoted in the PR that did it — so
 * this is a convergence and not a widening or a narrowing: the set of values a
 * widget author may write is exactly what it was.
 *
 * What it buys is that the two can no longer drift, and one drift direction was
 * SILENT. `WidgetRegistry.load()` in `@object-ui/core` translates each
 * `WidgetInput` into a `ComponentInput` and passes `type` straight through, so
 * a member REMOVED from the shared vocabulary would break that assignment
 * loudly at compile time — while a member ADDED to it produced no error
 * anywhere: widget authoring would simply have stayed narrower than component
 * registration, with nothing in the tree saying so.
 *
 * Deliberately the SINGLE-kind form. `ComponentInput.type` also accepts an
 * ARRAY of arms, for a key whose contract is a union (objectui#3832). Widget
 * inputs have never carried that capability; granting it here would be a
 * widening rather than a convergence, so it stays out — the same disposition
 * objectui#4972 recorded when it left this face alone.
 *
 * ## Where this face still diverges from `ComponentInput` — recorded, not repaired
 *
 * Two differences remain, and the ruling on both is NOT NOW rather than "these
 * are the same thing" (objectui#5675). Widget authoring and component
 * registration are not obviously one surface, and nothing measured is pulling
 * for the merge. They are written down here so the next reader meets a
 * decision instead of an accident.
 *
 * A third entry below is NOT a divergence: item 3 records the one place the
 * two faces once disagreed and now AGREE, kept because the agreement was
 * ruled and a later reader would otherwise re-open it.
 *
 * 1. **The enum slot is spelled `options` here and `enum` on `ComponentInput`.**
 *    One concept, two names, one package. It is adapted rather than broken:
 *    `WidgetRegistry.load()` maps `enum: input.options` at the seam, and
 *    `sdui-parser`'s manifest serializer reads `enum` downstream of that. So
 *    the cost is not a value that fails to arrive — it is a hand-written rename
 *    that every reader of both faces has to know about, and that a future key
 *    added to either side can forget. Renaming either spelling is a change to a
 *    published key on a published type, which needs its own mandate.
 *
 * 2. **`ComponentInput` carries five keys this face does not** — `inputType`,
 *    `min`, `max`, `step`, `placeholder` (thirteen keys against this face's
 *    eight; `options`/`enum` above accounts for the difference in the other
 *    direction). They are not lost in translation — they are unwritable from a
 *    widget manifest to begin with, so the `ComponentInput` that
 *    `WidgetRegistry` synthesises never carries one. Measured before leaving
 *    them out: no reader in this repository consumes any of the five on
 *    `ComponentInput` either, and `sdui-parser`'s serializer forwards a fixed
 *    key list per input, `of` included since objectui#8067 (`name`, `type`,
 *    `of`, `required`, `enum`, `binding`, `description`), and none of these.
 *    Copying them here would mirror surface that nothing reads on the
 *    face it already lives on.
 *
 *    ⚠️ ALL FIVE are now ADR-0049 RETIREMENT TOMBSTONES on `ComponentInput`
 *    (`inputType` / `min` / `max` / `step` / `placeholder` — `?: never` plus a
 *    named Zod refusal, objectui#5905), so what this clause records is no
 *    longer "five keys this face declines to copy" but five keys that are
 *    UNWRITABLE on the face they already live on. Copying any of them here
 *    would mirror a refusal.
 *
 *    `inputType` was the last of the five and took its own ruling, because it
 *    was the one the repository actually authored: `plugin-markdown` wrote it
 *    while the serializer dropped it. Maintainer, 2026-08-31 (objectui#5905):
 *    delete the write — measured a no-op, so zero capability lost — and
 *    tombstone the key; teaching `sdui-parser` to forward it was REFUSED on
 *    record. ⇒ The fork this block used to report as OPEN is CLOSED; do not
 *    re-read it as a pending question.
 *
 * 3. **`label`, `defaultValue` and `advanced`: BOTH FACES AGREE — all three are
 *    ADR-0049 retirement tombstones.** They were retired on `ComponentInput`
 *    first (objectui#7493 / objectui#7781, maintainer ruling A of 2026-09-06):
 *    the manifest serializer forwards a fixed key list and none of these is on
 *    it, and no consumer of `ComponentMeta.inputs` read them, so
 *    `WidgetRegistry.load()` stopped copying them across the seam — that copy
 *    was the one non-test write of the three and it fed nothing. This face then
 *    held them for one more ruling, because a widget manifest is authored
 *    OUTSIDE this repository and the in-repo zero is only half the question.
 *    Maintainer ruling A of 2026-09-15 (objectui#7911) carried the retirement
 *    here: `?: never` on all three. The asymmetry this block used to report is
 *    CLOSED; ⛔ do not re-read it as a pending question, and ⛔ do not "restore"
 *    a member to keep the two lists different lengths.
 *
 *    ⚠️ **What the tombstone does and does not buy — stated because the
 *    difference is the whole cost of the ruling.** There is no zod mirror of
 *    this interface (measured 0 against a live `ComponentInput` control), so
 *    unlike the `ComponentInput` retirement this one has NO runtime face: it is
 *    a `tsc` error at a TypeScript authoring site and nothing else. A widget
 *    manifest that arrives as JSON is not parsed through this type by anything
 *    in this repository — `WidgetRegistry` does no validation and no
 *    deserialization — so an out-of-repo author who writes `label` today gets
 *    exactly what they got before: the key is ignored, silently. Making that
 *    refusal loud for the authors who actually exist would take a runtime
 *    mirror for the manifest face, which was offered as option C on
 *    objectui#7911 and deliberately NOT opened.
 *
 * Pin: `__tests__/widget-input-control-vocabulary.test.ts` (the vocabulary and
 * the divergence record) and `__tests__/widget-input-retired-keys-7911.test.ts`
 * (the three tombstones, in both directions).
 */
export interface WidgetInput {
  /** Input field name (maps to prop name) */
  name: string;
  /**
   * Input field type — ONE coarse control kind.
   *
   * The vocabulary is {@link ComponentInputControlType}, shared with
   * `ComponentInput` rather than restated; see this interface's own doc block
   * for why the single-kind form is deliberate.
   */
  type: ComponentInputControlType;
  /**
   * RETIRED (objectui#7911, ADR-0049) — never read on this face either.
   *
   * `WidgetRegistry.load()` is the only consumer of a manifest's `inputs` in
   * this repository, and it forwards `name`, `type`, `required`, `options`
   * (as `enum`) and `description` — not this key. Its twin on
   * `ComponentInput` is already a tombstone (objectui#7493 / objectui#7781),
   * so the copy that used to carry this value across the seam is gone and
   * nothing took its place.
   *
   * What an author writes instead: NOTHING. An input is identified by its
   * `name` on every path that reaches it, and no consumer ever rendered a
   * label for one; `description` is the published place to tell an author
   * anything about an input.
   *
   * @deprecated Not part of `WidgetInput`'s contract — the value was inert.
   */
  label?: never;
  /**
   * RETIRED (objectui#7911, ADR-0049) — never read on this face either.
   *
   * No renderer, registry or designer surface in this repository ever read a
   * declared default off a widget input; the seam that once copied it onto
   * `ComponentInput.defaultValue` was deleted when that key became a tombstone
   * (objectui#7493). Delete the key: the renderer's own fallback read IS the
   * default, and `description` — which IS forwarded — is where to state it.
   *
   * @deprecated Not part of `WidgetInput`'s contract — the value was inert.
   */
  defaultValue?: never;
  /** Whether this input is required */
  required?: boolean;
  /** Enum options (for type: 'enum') */
  options?: string[] | Array<{ label: string; value: unknown }>;
  /** Help text */
  description?: string;
  /**
   * RETIRED (objectui#7911, ADR-0049) — never read on this face either.
   *
   * No designer surface in this repository ever hid an "advanced" input, on
   * either face; its `ComponentInput` twin was retired for that reason
   * (objectui#7781) and the seam copy went with it (objectui#7493). There is
   * nothing to write instead.
   *
   * @deprecated Not part of `WidgetInput`'s contract — the value was inert.
   */
  advanced?: never;
}

/**
 * Widget capabilities flag set.
 */
export interface WidgetCapabilities {
  /** Widget supports data binding via dataSource */
  dataBinding?: boolean;
  /** Widget supports real-time updates */
  realTime?: boolean;
  /** Widget supports export (PDF, CSV, etc.) */
  export?: boolean;
  /** Widget supports responsive sizing */
  responsive?: boolean;
  /** Widget supports theming */
  themeable?: boolean;
  /** Widget supports drag and drop */
  draggable?: boolean;
  /** Widget supports resize */
  resizable?: boolean;
}

/**
 * Resolved widget: a manifest with its loaded component.
 */
export interface ResolvedWidget {
  /** The original manifest */
  manifest: RuntimeWidgetManifest;
  /** The loaded React component */
  component: unknown;
  /** Timestamp when the widget was loaded */
  loadedAt: number;
}

/**
 * Widget registry event types.
 */
export type WidgetRegistryEvent =
  | { type: 'widget:registered'; widget: RuntimeWidgetManifest }
  | { type: 'widget:unregistered'; name: string }
  | { type: 'widget:loaded'; widget: ResolvedWidget }
  | { type: 'widget:error'; name: string; error: Error };

/**
 * Widget registry event listener.
 */
export type WidgetRegistryListener = (event: WidgetRegistryEvent) => void;
