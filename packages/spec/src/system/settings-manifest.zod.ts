// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';
import { SnakeCaseIdentifierSchema } from '../shared/identifiers.zod';
import { ExpressionInputSchema } from '../shared/expression.zod';
import { I18nLabelSchema } from '../ui/i18n.zod';

/**
 * Settings Manifest Protocol
 *
 * Declarative description of a single namespace of platform settings
 * (e.g. `mail`, `branding`, `feature_flags`). Modelled on Apple's
 * `Settings.bundle/Root.plist` PreferenceSpecifiers — a small, closed
 * set of specifier types that the system-owned renderer turns into a
 * uniform Settings page.
 *
 * Storage for values is the generic `sys_setting` K/V table; manifests
 * themselves are NEVER persisted — they ship with plugin code.
 *
 * See ADR-0007 (Settings Manifest + K/V Store + Resolver).
 *
 * Resolution order (handled by `SettingsService.get`):
 *   1. process.env override   (source='env',     locked=true)
 *   2. sys_setting scope=tenant
 *   3. sys_setting scope=user
 *   4. manifest specifier.default
 */

// ---------------------------------------------------------------------------
// Specifier types — the closed enum of UI building blocks
// ---------------------------------------------------------------------------

export const SpecifierType = z.enum([
  // Layout
  'group',          // section header + divider
  'child_pane',     // nav row → sub-namespace
  'info_banner',    // static guidance (markdown)
  'title_value',    // read-only label

  // Inputs
  'text',
  'textarea',
  'password',       // implicit encrypted=true
  'email',
  'url',
  'phone',
  'number',
  'toggle',
  'select',
  'radio',
  'multiselect',
  'slider',
  'color',
  'json',

  // Actions
  'action_button',  // calls handler (test connection / rotate / etc.)
]);
export type SpecifierType = z.infer<typeof SpecifierType>;

const SPECIFIERS_REQUIRING_KEY: ReadonlySet<SpecifierType> = new Set([
  'text', 'textarea', 'password', 'email', 'url', 'phone',
  'number', 'toggle', 'select', 'radio', 'multiselect',
  'slider', 'color', 'json',
]);

// ---------------------------------------------------------------------------
// Sub-schemas
// ---------------------------------------------------------------------------

export const SpecifierOptionSchema = lazySchema(() => z.object({
  value: z.union([z.string(), z.number(), z.boolean()]).describe('Stored value'),
  label: I18nLabelSchema.describe('Display label'),
  description: z.string().optional().describe('Optional helper text'),
  icon: z.string().optional().describe('Optional Lucide icon name'),
}));
export type SpecifierOption = z.infer<typeof SpecifierOptionSchema>;

/**
 * Action handler descriptor for `action_button` specifiers.
 *
 * - `http`     — server-side endpoint (e.g. POST /api/settings/mail/test).
 *                The renderer POSTs `body` (with `${...}` template
 *                interpolation against the current namespace value map +
 *                request context) and shows a toast with the result.
 * - `action`   — registered action machine name (delegated to ActionEngine).
 * - `navigate` — client-side navigation to a URL or route.
 */
export const SpecifierHandlerSchema = lazySchema(() => z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('http'),
    method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).default('POST'),
    url: z.string().describe('Endpoint URL; supports ${...} interpolation'),
    body: z.record(z.string(), z.unknown()).optional().describe('Optional JSON body; supports ${...} interpolation'),
    confirmText: I18nLabelSchema.optional().describe('Confirm dialog text before invoking (omit = no confirm)'),
  }),
  z.object({
    kind: z.literal('action'),
    name: z.string().describe('Registered action machine name'),
    params: z.record(z.string(), z.unknown()).optional(),
    confirmText: I18nLabelSchema.optional(),
  }),
  z.object({
    kind: z.literal('navigate'),
    url: z.string().describe('Target URL or in-app route'),
    target: z.enum(['_self', '_blank']).default('_self'),
  }),
]));
export type SpecifierHandler = z.infer<typeof SpecifierHandlerSchema>;

/**
 * Scope of a specifier value.
 *
 * - `tenant`  — value applies to the whole tenant (the common case).
 *               In project-kernel mode this is per-project; in
 *               control-plane mode this is per-tenant. The resolver
 *               abstracts the difference.
 * - `user`    — value is per-user; the resolver scopes reads/writes
 *               to ctx.user_id.
 */
export const SpecifierScopeSchema = z.enum(['tenant', 'user']);
export type SpecifierScope = z.infer<typeof SpecifierScopeSchema>;

// ---------------------------------------------------------------------------
// Specifier schema (the unit of UI in a manifest)
// ---------------------------------------------------------------------------

/**
 * A single specifier in a manifest. The set of recognised fields is the
 * union of all specifier types' needs; type-specific cross-field
 * validation runs in the manifest superRefine below.
 */
export const SpecifierSchema = lazySchema(() => z.object({
  /** Specifier variant — drives renderer and validation rules. */
  type: SpecifierType.describe('Specifier variant'),

  /**
   * Stable identifier (snake_case) used for i18n translation lookup,
   * action routing, and test selectors. Orthogonal to `key` (which is
   * the storage path). Recommended for `group` and `action_button`
   * specifiers so their labels can be translated and so action
   * handlers have stable hook keys. Must be unique within a manifest.
   */
  id: SnakeCaseIdentifierSchema.optional().describe('Stable identifier (snake_case)'),

  /**
   * Storage key (snake_case). Required for all value-bearing specifiers;
   * MUST be omitted for layout-only specifiers (`group`, `info_banner`,
   * `child_pane`, `title_value`, `action_button`).
   */
  key: SnakeCaseIdentifierSchema.optional().describe('Storage key (snake_case)'),

  /** Display label. */
  label: I18nLabelSchema.describe('Display label'),

  /** Optional helper text shown beneath the field. */
  description: z.string().optional().describe('Help text'),

  /** Optional Lucide icon name (for groups, buttons, child panes). */
  icon: z.string().optional().describe('Icon name (Lucide)'),

  /** Default value used when neither env, tenant, nor user has a value set. */
  default: z.unknown().optional().describe('Default value'),

  /**
   * Visibility expression evaluated against the live namespace value map
   * (e.g. "${data.provider === 'smtp'}"). Hidden specifiers are not
   * rendered AND their values are not validated.
   */
  visible: ExpressionInputSchema.optional().describe('Visibility expression'),

  /** Mark the field required (renderer + server-side validation). */
  required: z.boolean().default(false).describe('Required field'),

  /**
   * Encrypt-at-rest hint to `SettingsService` and storage. Implicit
   * `true` for `password` specifiers; explicit on others (e.g. JSON
   * blobs that hold credentials).
   */
  encrypted: z.boolean().optional().describe('Encrypt value at rest (forced true for password)'),

  /** Scope of this value. Defaults to manifest-level scope. */
  scope: SpecifierScopeSchema.optional().describe('Override manifest scope for this key'),

  /** Permission name required to read this specifier (defaults to manifest read). */
  readPermission: z.string().optional().describe('Permission required to read this specifier'),

  /** Permission name required to write this specifier (defaults to manifest write). */
  writePermission: z.string().optional().describe('Permission required to write this specifier'),

  /** Deprecation marker — renderer shows a warning chip. */
  deprecated: z.boolean().optional().describe('Mark deprecated'),

  /** When deprecated, the new key callers should migrate to. */
  replacedBy: z.string().optional().describe('Replacement key (used when deprecated=true)'),

  // ----- Type-specific options -------------------------------------------

  /** Options for `select` / `radio` / `multiselect`. */
  options: z.array(SpecifierOptionSchema).optional().describe('Options for select/radio/multiselect'),

  /** `number` / `slider`: numeric bounds and step. */
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),

  /** `text` / `textarea`: length and pattern constraints. */
  minLength: z.number().int().min(0).optional(),
  maxLength: z.number().int().min(1).optional(),
  pattern: z.string().optional().describe('Regex pattern (text only)'),

  /** `textarea`: visual rows. */
  rows: z.number().int().min(1).optional(),

  /** `action_button`: handler invoked on click. */
  handler: SpecifierHandlerSchema.optional().describe('Action handler (action_button)'),

  /** `child_pane`: namespace of the sub-manifest to navigate to. */
  childNamespace: SnakeCaseIdentifierSchema.optional().describe('Sub-namespace (child_pane)'),

  /** `info_banner`: markdown body + severity. */
  bannerText: z.string().optional().describe('Markdown body (info_banner)'),
  bannerSeverity: z.enum(['info', 'success', 'warning', 'error']).optional(),
}).superRefine((spec, ctx) => {
  // Value-bearing specifiers must have a key.
  if (SPECIFIERS_REQUIRING_KEY.has(spec.type) && !spec.key) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['key'],
      message: `Specifier of type '${spec.type}' requires a 'key'.`,
    });
  }
  // Layout-only specifiers must NOT have a key.
  if (!SPECIFIERS_REQUIRING_KEY.has(spec.type) && spec.key) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['key'],
      message: `Specifier of type '${spec.type}' must not declare a 'key'.`,
    });
  }
  // select/radio/multiselect require options.
  if (['select', 'radio', 'multiselect'].includes(spec.type)) {
    if (!spec.options || spec.options.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['options'],
        message: `Specifier of type '${spec.type}' requires non-empty 'options'.`,
      });
    }
  }
  // action_button requires a handler.
  if (spec.type === 'action_button' && !spec.handler) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['handler'],
      message: `Specifier of type 'action_button' requires a 'handler'.`,
    });
  }
  // child_pane requires a childNamespace.
  if (spec.type === 'child_pane' && !spec.childNamespace) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['childNamespace'],
      message: `Specifier of type 'child_pane' requires a 'childNamespace'.`,
    });
  }
  // info_banner requires bannerText.
  if (spec.type === 'info_banner' && !spec.bannerText) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['bannerText'],
      message: `Specifier of type 'info_banner' requires 'bannerText'.`,
    });
  }
  // min/max ordering.
  if (typeof spec.min === 'number' && typeof spec.max === 'number' && spec.min > spec.max) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['min'],
      message: `'min' must be ≤ 'max'.`,
    });
  }
  // minLength/maxLength ordering.
  if (typeof spec.minLength === 'number' && typeof spec.maxLength === 'number' && spec.minLength > spec.maxLength) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['minLength'],
      message: `'minLength' must be ≤ 'maxLength'.`,
    });
  }
  // deprecated→replacedBy
  if (spec.deprecated && !spec.replacedBy) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['replacedBy'],
      message: `Deprecated specifiers should declare 'replacedBy'.`,
    });
  }
}));
export type Specifier = z.infer<typeof SpecifierSchema>;

// ---------------------------------------------------------------------------
// Settings manifest (the unit a plugin exports)
// ---------------------------------------------------------------------------

/**
 * A SettingsManifest describes a single configurable namespace
 * (e.g. `mail`, `branding`). Plugins export one or more manifests and
 * register them with the SettingsService at boot.
 *
 * Manifests are pure data: no React, no SQL DDL, no per-namespace
 * tables. The system-owned renderer turns them into a Settings page
 * and values persist into the shared `sys_setting` K/V table.
 */
export const SettingsManifestSchema = lazySchema(() => z.object({
  /** Namespace identifier (snake_case). Globally unique. */
  namespace: SnakeCaseIdentifierSchema.describe('Namespace (snake_case, globally unique)'),

  /** Manifest version. Increment when keys are renamed/removed. */
  version: z.number().int().min(1).default(1).describe('Manifest schema version'),

  /** Human label shown in the Settings hub and nav. */
  label: I18nLabelSchema.describe('Display label'),

  /** Optional Lucide icon for the hub card and nav row. */
  icon: z.string().optional().describe('Icon (Lucide)'),

  /** One-line description shown in the hub card. */
  description: z.string().optional().describe('Short description'),

  /** Long-form markdown shown at the top of the settings page. */
  helpText: z.string().optional().describe('Markdown help text shown above specifiers'),

  /**
   * Default scope for value-bearing specifiers. Per-specifier `scope`
   * overrides this. Most namespaces should use 'tenant' — only
   * personal preference namespaces should use 'user'.
   */
  scope: SpecifierScopeSchema.default('tenant').describe('Default scope for specifiers'),

  /** Permission required to view the page (default: setup.access). */
  readPermission: z.string().default('setup.access').describe('Permission required to read'),

  /** Permission required to save changes (default: setup.write). */
  writePermission: z.string().default('setup.write').describe('Permission required to write'),

  /**
   * Hub category — groups manifests on the Settings hub landing
   * page (e.g. "Workspace", "Communication", "Security", "Beta").
   */
  category: z.string().optional().describe('Settings hub category'),

  /** Display order within the hub category (lower first). */
  order: z.number().optional().describe('Display order'),

  /** The ordered list of specifiers that make up the page. */
  specifiers: z.array(SpecifierSchema).min(1).describe('Page contents (ordered)'),

  /** Visibility predicate for the whole manifest (e.g. license gate). */
  visible: ExpressionInputSchema.optional().describe('Whole-manifest visibility'),

  /**
   * Feature flag key that gates the manifest. When set, the renderer
   * hides the manifest unless the feature flag evaluates true. Useful
   * for shipping settings UI before the corresponding feature lands.
   */
  featureFlag: z.string().optional().describe('Gate manifest visibility on a feature flag'),

  /** Marker for namespaces that are still in beta. UI shows a chip. */
  beta: z.boolean().optional().describe('Show a Beta chip on the page'),
}).superRefine((manifest, ctx) => {
  // Specifier keys within a manifest must be unique.
  const seenKey = new Set<string>();
  manifest.specifiers.forEach((spec, idx) => {
    if (!spec.key) return;
    if (seenKey.has(spec.key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['specifiers', idx, 'key'],
        message: `Duplicate specifier key '${spec.key}' in manifest '${manifest.namespace}'.`,
      });
    } else {
      seenKey.add(spec.key);
    }
  });

  // Specifier ids within a manifest must be unique (used for i18n /
  // action routing).
  const seenId = new Set<string>();
  manifest.specifiers.forEach((spec, idx) => {
    if (!spec.id) return;
    if (seenId.has(spec.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['specifiers', idx, 'id'],
        message: `Duplicate specifier id '${spec.id}' in manifest '${manifest.namespace}'.`,
      });
    } else {
      seenId.add(spec.id);
    }
  });

  // child_pane.childNamespace must differ from manifest.namespace.
  manifest.specifiers.forEach((spec, idx) => {
    if (spec.type === 'child_pane' && spec.childNamespace === manifest.namespace) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['specifiers', idx, 'childNamespace'],
        message: `child_pane cannot reference its own namespace ('${manifest.namespace}').`,
      });
    }
  });
}));
export type SettingsManifest = z.infer<typeof SettingsManifestSchema>;

// ---------------------------------------------------------------------------
// Resolved value (returned by SettingsService.get / REST GET)
// ---------------------------------------------------------------------------

/**
 * The shape returned by `SettingsService.get(ns, key)` and by the
 * `GET /api/settings/:namespace` endpoint per key. Carries provenance
 * so the renderer can surface env-locked fields and distinguish
 * defaults from explicit values.
 */
export const ResolvedSettingValueSchema = lazySchema(() => z.object({
  /** The effective value (after resolution). May be null when unset. */
  value: z.unknown().describe('Effective value (post-resolution)'),

  /** Which layer of the hierarchy provided the value. */
  source: z.enum(['env', 'tenant', 'user', 'default']).describe('Resolution source'),

  /**
   * True when the value cannot be overridden from the UI. Today this
   * is exactly `source === 'env'`, but tenant-locking is a planned
   * extension (e.g. control-plane locks a tenant value).
   */
  locked: z.boolean().describe('Cannot be overridden from UI'),

  /** Optional human-readable reason when locked (shown in tooltip). */
  lockedReason: z.string().optional().describe('Reason for the lock (UI tooltip)'),
}));
export type ResolvedSettingValue<T = unknown> = Omit<z.infer<typeof ResolvedSettingValueSchema>, 'value'> & { value: T };

/**
 * Bulk shape returned by `GET /api/settings/:namespace`. Carries the
 * manifest alongside the current values so the renderer needs exactly
 * one round-trip to draw the page.
 */
export const SettingsNamespacePayloadSchema = lazySchema(() => z.object({
  manifest: SettingsManifestSchema,
  values: z.record(z.string(), ResolvedSettingValueSchema).describe('Effective values keyed by specifier.key'),
}));
export type SettingsNamespacePayload = z.infer<typeof SettingsNamespacePayloadSchema>;

/**
 * Action result returned by `POST /api/settings/:namespace/:actionId`.
 * Used for "Test connection" / "Send test email" / "Rotate key" etc.
 */
export const SettingsActionResultSchema = lazySchema(() => z.object({
  ok: z.boolean().describe('Success flag'),
  message: z.string().optional().describe('Toast message'),
  severity: z.enum(['info', 'success', 'warning', 'error']).optional(),
  details: z.unknown().optional().describe('Optional structured detail (renderer-defined)'),
}));
export type SettingsActionResult = z.infer<typeof SettingsActionResultSchema>;
