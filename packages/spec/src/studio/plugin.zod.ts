// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @module studio/plugin
 * 
 * Studio Plugin Protocol
 * 
 * Defines the specification for Studio plugins — a VS Code-like extension model
 * that allows each metadata type to contribute custom viewers, designers, 
 * sidebar groups, actions, and commands.
 * 
 * ## Architecture
 * 
 * Like VS Code extensions, Studio plugins have two layers:
 * 1. **Manifest (Declarative)** — JSON-serializable contribution points
 * 2. **Activation (Imperative)** — Runtime registration of React components & handlers
 * 
 * ```
 * ┌─────────────────────────────────────────────────────────┐
 * │                    Studio Host                          │
 * │  ┌───────────────────────────────────────────────────┐  │
 * │  │              Plugin Registry                      │  │
 * │  │  ┌──────────┐ ┌──────────┐ ┌──────────┐         │  │
 * │  │  │ Object   │ │  Flow    │ │  Agent   │  ...     │  │
 * │  │  │ Plugin   │ │  Plugin  │ │  Plugin  │         │  │
 * │  │  └──────────┘ └──────────┘ └──────────┘         │  │
 * │  └───────────────────────────────────────────────────┘  │
 * │                                                         │
 * │  ┌─── Sidebar ───┐  ┌──── Main Panel ────────────────┐ │
 * │  │ [plugin icons] │  │  PluginHost renders viewer     │ │
 * │  │ [plugin groups]│  │  from highest-priority plugin  │ │
 * │  └────────────────┘  └────────────────────────────────┘ │
 * └─────────────────────────────────────────────────────────┘
 * ```
 * 
 * @example
 * ```typescript
 * import { StudioPluginManifestSchema } from '@objectstack/spec/studio';
 * 
 * const manifest = StudioPluginManifestSchema.parse({
 *   id: 'objectstack.object-designer',
 *   name: 'Object Designer',
 *   version: '1.0.0',
 *   contributes: {
 *     metadataViewers: [{
 *       id: 'object-explorer',
 *       metadataTypes: ['object', 'objects'],
 *       label: 'Object Explorer',
 *       priority: 100,
 *       modes: ['preview', 'design', 'data'],
 *     }],
 *   },
 * });
 * ```
 */

import { z } from 'zod';

// ─── View Mode ───────────────────────────────────────────────────────

/** Supported view modes for metadata viewers */
import { lazySchema } from '../shared/lazy-schema';
import { strictObject } from '../shared/strict-object';

/**
 * Shared history for this file (#4001).
 *
 * A Studio plugin manifest is the `package.json` of an extension — declarative,
 * hand-written, and parsed once by `defineStudioPlugin`. A dropped key here does
 * not fail the plugin: it loads, activates, and simply contributes less than its
 * author declared. A viewer that never appears in the switcher looks like a
 * registration bug, not a spelling one.
 */
const STUDIO_PLUGIN_HISTORY =
  'Until #4001 closed these shapes an unknown key was dropped silently — the plugin still '
  + 'loaded and activated, contributing less than its manifest declared.';

export const ViewModeSchema = lazySchema(() => z.enum(['preview', 'design', 'code', 'data', 'history']));
export type ViewMode = z.input<typeof ViewModeSchema>;

// ─── Metadata Viewer Contribution ────────────────────────────────────

/**
 * Declares a metadata viewer/designer component.
 * The runtime component is registered imperatively during plugin activation.
 */
export const MetadataViewerContributionSchema = lazySchema(() => strictObject({
  surface: 'this metadata view contribution',
  history: STUDIO_PLUGIN_HISTORY,
}, {
  /** Unique viewer ID (namespaced: `pluginId.viewerId`) */
  id: z.string().describe('Unique viewer identifier'),

  /** Metadata type(s) this viewer handles (e.g., "object", "flow", "agent") */
  metadataTypes: z.array(z.string()).min(1).describe('Metadata types this viewer can handle'),

  /** Human-readable label shown in the view switcher */
  label: z.string().describe('Viewer display label'),

  /** Priority — highest-priority viewer becomes default. Built-in default = 0 */
  priority: z.number().default(0).describe('Viewer priority (higher wins)'),

  /** View modes this viewer supports */
  modes: z.array(ViewModeSchema).default(['preview']).describe('Supported view modes'),
}));

export type MetadataViewerContribution = z.input<typeof MetadataViewerContributionSchema>;
/** Post-parse shape of {@link MetadataViewerContribution} — defaults applied, transforms run (ADR-0122). */
export type MetadataViewerContributionParsed = z.infer<typeof MetadataViewerContributionSchema>;

// ─── Sidebar Group Contribution ──────────────────────────────────────

/**
 * Declares a sidebar group that organizes metadata types.
 * Plugins can add new groups or extend existing ones.
 */
export const SidebarGroupContributionSchema = lazySchema(() => strictObject({
  surface: 'this sidebar group contribution',
  history: STUDIO_PLUGIN_HISTORY,
}, {
  /** Unique group key */
  key: z.string().describe('Unique group key'),

  /** Display label */
  label: z.string().describe('Group display label'),

  /** Lucide icon name (e.g., "database", "workflow") */
  icon: z.string().optional().describe('Lucide icon name'),

  /** Metadata types belonging to this group */
  metadataTypes: z.array(z.string()).describe('Metadata types in this group'),

  /** Sort order — lower values appear first */
  order: z.number().default(100).describe('Sort order (lower = higher)'),
}));

export type SidebarGroupContribution = z.input<typeof SidebarGroupContributionSchema>;
/** Post-parse shape of {@link SidebarGroupContribution} — defaults applied, transforms run (ADR-0122). */
export type SidebarGroupContributionParsed = z.infer<typeof SidebarGroupContributionSchema>;

// ─── Action Contribution ─────────────────────────────────────────────

/**
 * Where an action CONTRIBUTION appears inside the Studio IDE shell.
 *
 * [#4737] This was exported as `ActionLocationSchema` until v17 — the same
 * name `@objectstack/spec/ui` exports for a DIFFERENT concept: the
 * platform-canonical vocabulary for where an action renders in a running
 * application's UI (`list_toolbar`, `record_header`, …, `record_section`;
 * 7 values at the time of the rename, 6 since #6888 retired `global_nav`), whose
 * docblock declares it "single source of truth for the whole platform". This
 * one is the 3-value Studio IDE surface enum consumed only by
 * `ActionContributionSchema.location` below. Same name, disjoint
 * vocabularies: which type you got depended on nothing but the import path —
 * the #4411 trap (dual-source ledger #4535, cluster C17). Per ADR-0112 D9(a)
 * the studio side takes the domain-specific name; the ui side keeps the bare
 * name. Do NOT re-export the ui enum under the old name here: that would tell
 * studio plugin authors the app-UI vocabulary is valid in a manifest.
 */
export const ActionContributionLocationSchema = lazySchema(() => z.enum(['toolbar', 'contextMenu', 'commandPalette']));
export type ActionContributionLocation = z.input<typeof ActionContributionLocationSchema>;

/**
 * Declares an action that can be triggered on metadata items.
 * The handler is registered imperatively during activation.
 */
export const ActionContributionSchema = lazySchema(() => strictObject({
  surface: 'this action contribution',
  history: STUDIO_PLUGIN_HISTORY,
}, {
  /** Unique action ID */
  id: z.string().describe('Unique action identifier'),

  /** Display label */
  label: z.string().describe('Action display label'),

  /** Lucide icon name */
  icon: z.string().optional().describe('Lucide icon name'),

  /** Where this action appears */
  location: ActionContributionLocationSchema.describe('UI location'),

  /** Metadata types this action applies to (empty = all types) */
  metadataTypes: z.array(z.string()).default([]).describe('Applicable metadata types'),
}));

export type ActionContribution = z.input<typeof ActionContributionSchema>;
/** Post-parse shape of {@link ActionContribution} — defaults applied, transforms run (ADR-0122). */
export type ActionContributionParsed = z.infer<typeof ActionContributionSchema>;

// ─── Metadata Icon Contribution ──────────────────────────────────────

/**
 * Declares an icon and label for a metadata type.
 * Used by the sidebar and breadcrumbs.
 */
export const MetadataIconContributionSchema = lazySchema(() => strictObject({
  surface: 'this metadata icon contribution',
  history: STUDIO_PLUGIN_HISTORY,
}, {
  /** Metadata type this icon represents */
  metadataType: z.string().describe('Metadata type'),

  /** Human-readable label */
  label: z.string().describe('Display label'),

  /** Lucide icon name */
  icon: z.string().describe('Lucide icon name'),
}));

export type MetadataIconContribution = z.input<typeof MetadataIconContributionSchema>;

// ─── Panel Contribution ──────────────────────────────────────────────

/** Where a panel can be placed */
export const PanelLocationSchema = lazySchema(() => z.enum(['bottom', 'right', 'modal']));
export type PanelLocation = z.input<typeof PanelLocationSchema>;

/**
 * Declares an auxiliary panel (like VS Code's Terminal, Problems, Output panels).
 */
export const PanelContributionSchema = lazySchema(() => strictObject({
  surface: 'this panel contribution',
  history: STUDIO_PLUGIN_HISTORY,
}, {
  /** Unique panel ID */
  id: z.string().describe('Unique panel identifier'),

  /** Display label */
  label: z.string().describe('Panel display label'),

  /** Lucide icon name */
  icon: z.string().optional().describe('Lucide icon name'),

  /** Panel placement */
  location: PanelLocationSchema.default('bottom').describe('Panel location'),
}));

export type PanelContribution = z.input<typeof PanelContributionSchema>;
/** Post-parse shape of {@link PanelContribution} — defaults applied, transforms run (ADR-0122). */
export type PanelContributionParsed = z.infer<typeof PanelContributionSchema>;

// ─── Command Contribution ────────────────────────────────────────────

/**
 * Declares a command that can be invoked from the command palette
 * or programmatically by other plugins.
 */
export const CommandContributionSchema = lazySchema(() => strictObject({
  surface: 'this command contribution',
  history: STUDIO_PLUGIN_HISTORY,
}, {
  /** Unique command ID (namespaced: `pluginId.commandName`) */
  id: z.string().describe('Unique command identifier'),

  /** Display label */
  label: z.string().describe('Command display label'),

  /** Keyboard shortcut (e.g., "Ctrl+Shift+P") */
  shortcut: z.string().optional().describe('Keyboard shortcut'),

  /** Lucide icon name */
  icon: z.string().optional().describe('Lucide icon name'),
}));

export type CommandContribution = z.input<typeof CommandContributionSchema>;

// ─── Studio Plugin Contributions ─────────────────────────────────────

/**
 * All contribution points a Studio plugin can declare.
 * Analogous to VS Code's `contributes` section in `package.json`.
 */
export const StudioPluginContributionsSchema = lazySchema(() => strictObject({
  surface: 'this studio plugin contributions',
  history: STUDIO_PLUGIN_HISTORY,
}, {
  /** Metadata viewer/designer components */
  metadataViewers: z.array(MetadataViewerContributionSchema).default([]),

  /** Sidebar navigation groups */
  sidebarGroups: z.array(SidebarGroupContributionSchema).default([]),

  /** Toolbar / context menu / command palette actions */
  actions: z.array(ActionContributionSchema).default([]),

  /** Metadata type icons & labels */
  metadataIcons: z.array(MetadataIconContributionSchema).default([]),

  /** Auxiliary panels */
  panels: z.array(PanelContributionSchema).default([]),

  /** Command palette entries */
  commands: z.array(CommandContributionSchema).default([]),
}));

export type StudioPluginContributions = z.input<typeof StudioPluginContributionsSchema>;
/** Post-parse shape of {@link StudioPluginContributions} — defaults applied, transforms run (ADR-0122). */
export type StudioPluginContributionsParsed = z.infer<typeof StudioPluginContributionsSchema>;

// ─── Activation Events — REMOVED (#4657, ADR-0049) ───────────────────
//
// The `activationEvents` key (and the `ActivationEventSchema` it embedded,
// which #4653 had just converged onto the kernel's structured `{ type,
// pattern }` form) is retired: no Studio host — no runtime in any repo — ever
// read it. Every plugin has always loaded and activated immediately on
// registration, so the key's declared semantics ("when to load this plugin")
// were a lie an author had no way to detect: `activationEvents:
// [{ type: 'onMetadataType', pattern: 'flow' }]` parsed clean and deferred
// nothing. The strict manifest parse below now rejects the key with the
// prescription (see `guidance`). Lazy activation, if ever built, returns via
// the enforce route of ADR-0049: executor first, vocabulary second.

const STUDIO_ACTIVATION_EVENTS_RETIRED =
  '`studioPluginManifest.activationEvents` was removed in @objectstack/spec 17.0.0 '
  + '(#4657, ADR-0049) — no Studio host ever read it: every plugin loads and activates '
  + 'immediately on registration, so the declared lazy-activation window never existed. '
  + 'Delete the key; `activate()` still runs at registration time. Lazy activation, if '
  + 'built, returns via the enforce route of ADR-0049 with a vocabulary its executor '
  + 'actually honours.';

// ─── Studio Plugin Manifest ──────────────────────────────────────────

/**
 * The declarative manifest for a Studio plugin.
 * 
 * This is the "package.json" equivalent for Studio extensions.
 * All contribution points are declared here; runtime components
 * are registered imperatively during the `activate()` call.
 */
export const StudioPluginManifestSchema = lazySchema(() => strictObject({
  surface: 'this studio plugin manifest',
  history: STUDIO_PLUGIN_HISTORY,
  // This file says outright that the manifest is "the `package.json` equivalent"
  // and that `contributes` is "analogous to VS Code's". That analogy is the
  // point AND the hazard: an author who knows VS Code reaches for its
  // vocabulary, and every near-miss below is a word that is correct over there.
  aliases: {
    displayName: 'name', title: 'name',
    publisher: 'author', vendor: 'author',
    contributions: 'contributes', contribute: 'contributes',
    // NOTE: `activation` / `events` / `onActivate` used to alias
    // `activationEvents`; the target key is retired (#4657), so they moved to
    // `guidance` below — an alias must never point at a key the schema cannot
    // accept (the `triggerPhrases` suggester trap, see shared/strict-object.ts).
  },
  guidance: {
    // Retired key (#4657, ADR-0049) — the rejection carries the upgrade.
    activationEvents: STUDIO_ACTIVATION_EVENTS_RETIRED,
    // The VS Code spellings that used to alias it get the same prescription:
    // pointing them at a removed key would bounce the author off a second error.
    activation: STUDIO_ACTIVATION_EVENTS_RETIRED,
    events: STUDIO_ACTIVATION_EVENTS_RETIRED,
    onActivate: STUDIO_ACTIVATION_EVENTS_RETIRED,
    // VS Code manifest keys with no counterpart here. `main` is the dangerous
    // one: an author declares an entry point, gets a plugin that loads and
    // contributes nothing, and it looks exactly like a broken `activate()`.
    main:
      'there is no entry-point key — a Studio plugin declares its contributions here and registers '
      + 'the runtime components imperatively in its `activate()` call. Nothing is loaded from a path.',
    engines: 'there is no engine-compatibility field; a plugin carries `version` and nothing gates it',
    categories: 'there is no category taxonomy — UI grouping comes from `contributes.sidebarGroups`',
    keywords: 'there is no keyword index for Studio plugins',
    repository: 'manifest metadata is limited to `id` / `name` / `version` / `description` / `author`',
    icon: 'the manifest carries no icon — icons are Lucide names on the CONTRIBUTION (`contributes.metadataIcons`, or an action / panel / command `icon`)',
    dependencies:
      'Studio plugins declare no dependency graph — every plugin loads and activates '
      + 'immediately on registration, and contributions are independent of each other',
  },
}, {
  /** 
   * Unique plugin ID using reverse-domain notation.
   * @example "objectstack.object-designer"
   */
  id: z.string()
    .regex(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/)
    .describe('Plugin ID (dot-separated lowercase)'),

  /** Human-readable plugin name */
  name: z.string().describe('Plugin display name'),

  /** Semantic version */
  version: z.string().default('0.0.1').describe('Plugin version'),

  /** Plugin description */
  description: z.string().optional().describe('Plugin description'),

  /** Author name */
  author: z.string().optional().describe('Author'),

  /** Declarative contribution points */
  contributes: StudioPluginContributionsSchema.default({
    metadataViewers: [],
    sidebarGroups: [],
    actions: [],
    metadataIcons: [],
    panels: [],
    commands: [],
  }),

  // `activationEvents` was REMOVED here (#4657, ADR-0049) — see the section
  // comment above and the `guidance` entry that rejects it with the
  // prescription. Its pre-removal default (`[{ type: 'onStartup', pattern:
  // '*' }]`, i.e. eager) simply wrote down the only behaviour that ever
  // existed, so removing the key changes nothing at runtime.
}));

export type StudioPluginManifest = z.input<typeof StudioPluginManifestSchema>;
/** Post-parse shape of {@link StudioPluginManifest} — defaults applied, transforms run (ADR-0122). */
export type StudioPluginManifestParsed = z.infer<typeof StudioPluginManifestSchema>;

// ─── Helper: defineStudioPlugin ──────────────────────────────────────

/**
 * Type-safe helper for defining a Studio plugin manifest.
 * 
 * @example
 * ```typescript
 * const manifest = defineStudioPlugin({
 *   id: 'objectstack.flow-designer',
 *   name: 'Flow Designer',
 *   contributes: {
 *     metadataViewers: [{
 *       id: 'flow-canvas',
 *       metadataTypes: ['flows'],
 *       label: 'Flow Canvas',
 *       priority: 100,
 *       modes: ['design', 'code'],
 *     }],
 *   },
 * });
 * ```
 */
export function defineStudioPlugin(
  input: z.input<typeof StudioPluginManifestSchema>
): StudioPluginManifestParsed {
  return StudioPluginManifestSchema.parse(input);
}
