// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { FieldType } from '../data/field.zod';
import { SnakeCaseIdentifierSchema } from '../shared/identifiers.zod';
import { ExpressionInputSchema } from '../shared/expression.zod';
import { I18nLabelSchema, AriaPropsSchema } from './i18n.zod';
import { HookBodySchema } from '../data/hook-body.zod';

/**
 * Action Parameter Schema
 *
 * Defines inputs required before executing an action.
 *
 * Two declaration modes:
 *
 * 1. **Field-backed** (preferred) — reference an existing object field; the
 *    runtime resolves the field's label (i18n), type, validation rules,
 *    options, placeholder, help text, and widget mapping from object
 *    metadata. Cross-object references use `objectOverride`.
 *
 *    ```ts
 *    params: [
 *      { field: 'email' },                                 // same object
 *      { field: 'role', objectOverride: 'sys_member' },    // different object
 *    ]
 *    ```
 *
 * 2. **Inline** (legacy / bespoke) — declare `name`, `label`, `type` etc.
 *    inline when no matching object field exists. Inline values may also be
 *    used alongside `field` to override individual properties.
 *
 * `name` is required unless `field` is provided (in which case it defaults
 * to the field name and is used as the request-body key).
 */
import { lazySchema } from '../shared/lazy-schema';
export const ActionParamSchema = lazySchema(() => z.object({
  /** Request-body key. Defaults to `field` when `field` is set. */
  name: z.string().optional(),
  /** Reference an existing object field for label/type/validation/options. */
  field: SnakeCaseIdentifierSchema.optional(),
  /** Object that owns the referenced field (defaults to the action's parent object). */
  objectOverride: SnakeCaseIdentifierSchema.optional(),
  /** Overrides the resolved field label (or sets it for inline params). */
  label: I18nLabelSchema.optional(),
  /** Overrides the resolved field type (or sets it for inline params). */
  type: FieldType.optional(),
  /**
   * Required override; when omitted defaults to `false`. Consumers that wish
   * to inherit the underlying field's `required` flag should leave this
   * undefined in the source schema and resolve at runtime (the dialog
   * renderers check truthiness, so `false === undefined` for UI purposes).
   */
  required: z.boolean().optional().default(false),
  /** Select/picklist options override. */
  options: z.array(z.object({ label: I18nLabelSchema, value: z.string() })).optional(),
  /** Placeholder override. */
  placeholder: z.string().optional(),
  /** Help/description override. */
  helpText: z.string().optional(),
  /** Default value for the dialog input. */
  defaultValue: z.unknown().optional(),
  /**
   * When true, the param's default value is pulled from the current row record
   * (key = the resolved field name) when the action runs from a list_item
   * context. Useful for edit dialogs that pre-fill from the selected row.
   */
  defaultFromRow: z.boolean().optional(),
}).refine(
  (p) => Boolean(p.name) || Boolean(p.field),
  { message: 'ActionParam requires either "name" or "field"' },
));

/**
 * Action type enum values.
 */
export const ActionType = z.enum(['script', 'url', 'modal', 'flow', 'api', 'form']);

/**
 * Action types that require a `target` field.
 * Derived from ActionType, excluding 'script' which allows inline handlers.
 * These types reference an external resource (URL, flow, modal, or API endpoint)
 * and cannot function without a target binding.
 */
const TARGET_REQUIRED_TYPES: ReadonlySet<string> = new Set(
  ActionType.options.filter((t) => t !== 'script'),
);

/**
 * Action Schema
 * 
 * **NAMING CONVENTION:**
 * Action names are machine identifiers used in code and must be lowercase snake_case.
 * 
 * **TARGET BINDING:**
 * The `target` field is the canonical way to bind an action to its handler.
 * - `type: 'script'` — `target` is recommended (references a script/function name).
 * - `type: 'url'`    — `target` is **required** (the URL to navigate to).
 * - `type: 'flow'`   — `target` is **required** (the flow name to invoke).
 * - `type: 'modal'`  — `target` is **required** (the modal/page name to open).
 * - `type: 'api'`    — `target` is **required** (the API endpoint to call).
 * - `type: 'form'`   — `target` is **required** (the FormView name to open, routed to `/console/forms/:name`).
 * 
 * The `execute` field is **deprecated** and will be removed in a future version.
 * If `execute` is provided without `target`, it is automatically migrated to `target`.
 * 
 * @example Good action names
 * - 'on_close_deal'
 * - 'send_welcome_email'
 * - 'approve_contract'
 * - 'export_report'
 * 
 * @example Bad action names (will be rejected)
 * - 'OnCloseDeal' (PascalCase)
 * - 'sendEmail' (camelCase)
 * - 'Send Email' (spaces)
 * 
 * Note: The action name is the configuration ID. JavaScript function names can use camelCase,
 * but the metadata ID must be lowercase snake_case.
 */
/**
 * Action Location — where an action is allowed to surface in the UI.
 *
 * Canonical list (single source of truth for the whole platform). Renderers,
 * the ActionEngine, the Studio designer dropdowns, and `objectui` consumers
 * MUST import from this constant rather than re-declaring their own enum —
 * adding a new location should require touching this one file only.
 *
 * Semantics:
 * - `list_toolbar`    — header/toolbar of a list view (bulk actions, "New", export).
 * - `list_item`       — per-row action on a list/grid row (Salesforce row-level menu).
 * - `record_header`   — primary actions in the record-detail title bar.
 * - `record_more`     — overflow menu under the "More" / ⋯ button on a record.
 * - `record_related`  — actions on a related list section inside a record.
 * - `record_section`  — actions surfaced inside a body section/tab of a record
 *                       (e.g. a Security tab grouping change-password, 2FA, etc.).
 * - `global_nav`      — global navigation/command-palette level actions.
 */
export const ACTION_LOCATIONS = [
  'list_toolbar',
  'list_item',
  'record_header',
  'record_more',
  'record_related',
  'record_section',
  'global_nav',
] as const;

export const ActionLocationSchema = z.enum(ACTION_LOCATIONS);
export type ActionLocation = z.infer<typeof ActionLocationSchema>;

/**
 * Tool category values for {@link ActionAiSchema.category}.
 *
 * Mirrors `ToolCategorySchema` in `../ai/tool.zod`. Kept **inline** rather
 * than imported to avoid a `ui → ai` import cycle (`ai/*.form.ts` already
 * imports `defineForm` from `ui/view.zod`). If you change the canonical
 * tool categories, update both sides.
 */
const ActionAiCategorySchema = z.enum([
  'data',
  'action',
  'flow',
  'integration',
  'vector_search',
  'analytics',
  'utility',
]);

/**
 * AI exposure block (ADR-0011 "Actions as AI Tools").
 *
 * **Opt-in, default off.** An action becomes an AI-callable tool only when
 * `exposed: true`. This is a deliberate governance gate: in an AI-authoring
 * world the platform's value is that a human can govern exactly which
 * capabilities the agent fleet is allowed to invoke — a half-finished or
 * unreviewed action must never be silently armed.
 *
 * When exposed, `description` is **required** — it is the LLM-facing contract
 * (when/why to call), authored explicitly rather than derived from the
 * UI `label`. The bridge in `@objectstack/service-ai` translates this block
 * into an `AIToolDefinition`.
 */
export const ActionAiSchema = z.object({
  /**
   * Expose this action to AI agents as a callable tool. Default `false`.
   * Setting `true` REQUIRES `description`.
   */
  exposed: z.boolean().default(false).describe('Expose this action to AI agents. Requires `description` when true.'),

  /**
   * LLM-facing description: tells the model when and why to call this action.
   * Distinct from the UI `label`. Plain English, ≥ 40 chars for useful tool
   * selection. Required whenever `exposed` is true.
   */
  description: z.string().min(40).optional().describe('LLM-facing description (≥40 chars). Required when exposed.'),

  /**
   * Override the derived tool category. Defaults to `action` (side-effect).
   * Use `data` for read-only actions, `analytics` for aggregations, etc.
   */
  category: ActionAiCategorySchema.optional().describe('Tool category override (defaults to "action").'),

  /**
   * Per-parameter AI hints, keyed by param name (or the injected `recordId`).
   * Tightens the JSON Schema the LLM sees (e.g. add `enum`, override
   * `description`, supply `examples`) WITHOUT changing the UI-facing field
   * metadata. Keys must match a declared `params[].name` (or `recordId`).
   */
  paramHints: z.record(z.string(), z.object({
    description: z.string().optional(),
    enum: z.array(z.union([z.string(), z.number()])).optional(),
    examples: z.array(z.unknown()).optional(),
  })).optional().describe('Per-parameter AI hints keyed by param name.'),

  /**
   * Output JSON Schema for the action's return value. Enables structured
   * downstream tool chaining (one action's output feeds another's input) and
   * is summarised into the tool description so the model knows what it gets
   * back. Optional — when omitted the return value is treated as freeform.
   */
  outputSchema: z.record(z.string(), z.unknown()).optional().describe('JSON Schema for the action return value.'),

  /**
   * Override confirmation for AI calls. When unset, the bridge defaults to
   * `true` for actions that look destructive (`confirmText` set, `mode:'delete'`,
   * or `variant:'danger'`). Set explicitly to `false` to assert a destructive-
   * looking action is safe to run without human approval, or `true` to force a
   * human-in-the-loop gate on an otherwise-safe action.
   */
  requiresConfirmation: z.boolean().optional().describe('Override HITL confirmation for AI invocations.'),
});

export type ActionAi = z.infer<typeof ActionAiSchema>;

export const ActionSchema = lazySchema(() => z.object({
  /** Machine name of the action */
  name: SnakeCaseIdentifierSchema.describe('Machine name (lowercase snake_case)'),
  
  /** Display label */
  label: I18nLabelSchema.describe('Display label'),

  /** Target object this action belongs to (optional, snake_case) */
  objectName: z.string().regex(/^[a-z_][a-z0-9_]*$/).optional().describe('Target object this action belongs to. When set, the action is auto-merged into the object\'s actions array by defineStack().'),
  
  /** Icon name (Lucide) */
  icon: z.string().optional().describe('Icon name'),

  /** Where does this action appear? */
  locations: z.array(ActionLocationSchema).optional().describe('Locations where this action is visible'),

  /** 
   * Visual Component Type
   * Defaults to 'button' or 'menu_item' based on location,
   * but can be overridden.
   */
  component: z.enum([
    'action:button', // Standard Button
    'action:icon',   // Icon only
    'action:menu',   // Dropdown menu
    'action:group'   // Button Group
  ]).optional().describe('Visual component override'),
  
  /** What type of interaction? */
  type: ActionType.default('script').describe('Action functionality type'),
  
  /** 
   * Payload / Target — the canonical binding for the action handler.
   * Required for url, flow, modal, and api types.
   * For `script` type: prefer `body` over `target`. `target` is kept only for
   * legacy bundle.functions[name] references.
   *
   * **Interpolation** (renderer responsibility, all action types):
   * `target` MAY contain `${param.X}` and `${ctx.X}` tokens. Renderers
   * resolve them just before invocation:
   * - `${param.X}` — value collected from the action's params dialog.
   * - `${ctx.X}` — values from the action context: `ctx.origin`
   *   (window.origin), `ctx.recordId`, `ctx.user.id`, `ctx.org.id`, etc.
   * Used by redirect-style actions like `link_social`, where the target is
   * e.g. `/api/v1/auth/sign-in/social?provider=${param.provider}&callbackURL=${ctx.origin}/_console/apps/account/sys_account`.
   * Renderers MUST `encodeURIComponent` interpolated values before
   * substituting them into URL query positions.
   */
  target: z.string().optional().describe('URL, Script Name, Flow ID, or API Endpoint. Supports ${param.X} and ${ctx.X} interpolation.'),

  /**
   * Action Body (L1 expression or L2 sandboxed JS).
   *
   * Only meaningful when `type === 'script'`. When set, the runtime invokes
   * the body inside the sandbox as `(input, ctx) => Promise<output>` and
   * ignores `target`.
   *
   * - `{ language: 'expression', source: '...' }` — pure formula (L1).
   * - `{ language: 'js', source: '...', capabilities: [...] }` — sandboxed JS (L2).
   *
   * Compiled-module bodies are not supported. Outbound IO (HTTP, etc.) goes
   * through Connector recipes (separate spec).
   */
  body: HookBodySchema.optional().describe('Action body — expression (L1) or sandboxed JS (L2). Only used when type is `script`.'),

  /** 
   * @deprecated Use `target` instead. This field is auto-migrated to `target` during parsing.
   */
  execute: z.string().optional().describe('@deprecated — Use target instead. Auto-migrated to target during parsing.'),
  
  /** User Input Requirements */
  params: z.array(ActionParamSchema).optional().describe('Input parameters required from user'),
  
  /** Visual Style */
  variant: z.enum(['primary', 'secondary', 'danger', 'ghost', 'link']).optional().describe('Button visual variant for styling (primary = highlighted, danger = destructive, ghost = transparent)'),

  /** UX Behavior */
  confirmText: I18nLabelSchema.optional().describe('Confirmation message before execution'),
  successMessage: I18nLabelSchema.optional().describe('Success message to show after execution'),
  refreshAfter: z.boolean().default(false).describe('Refresh view after execution'),

  /**
   * Result Dialog — describe how to render the API response on success.
   *
   * When set and the action returns successfully, the renderer SHOULD open a
   * dialog showing the selected fields from `result.data` instead of the
   * `successMessage` toast. The dialog has an acknowledge button only — the
   * user must explicitly close it. Used for **one-shot reveals** of values
   * the user must copy now because they cannot be retrieved later:
   *
   * - TOTP enrollment URI + secret (`enable_two_factor`)
   * - Backup recovery codes (`regenerate_backup_codes`)
   * - Freshly minted OAuth `client_secret` (`rotate_client_secret`,
   *   `create_oauth_application`)
   *
   * `fields` selects what to render and how. Each entry's `path` is a dot
   * path into `result.data` (e.g. `'totpURI'`, `'backupCodes'`,
   * `'client.client_secret'`). When `fields` is omitted, the renderer falls
   * back to JSON-printing the whole response under a single block.
   *
   * `format` (dialog-level) is a default for fields that don't carry their
   * own `format`; the per-field `format` always wins.
   *
   * Renderer contract (objectui):
   * - `qrcode` — render the value as a QR code; also render the raw string
   *   underneath with a copy button (so the user can paste into apps that
   *   don't scan).
   * - `code-list` — value must be an array of strings; render each in a
   *   monospace row with per-row copy and a "Copy all" affordance.
   * - `secret` — render a single string masked by default with a reveal
   *   toggle and copy button.
   * - `text` — plain text with copy.
   * - `json` — pretty-printed JSON in a monospace block.
   *
   * The dialog SHOULD set `refreshAfter` to true on close (separate from
   * the existing `refreshAfter` flag, which fires immediately on success).
   */
  resultDialog: z.object({
    title: I18nLabelSchema.optional(),
    description: I18nLabelSchema.optional(),
    acknowledge: I18nLabelSchema.optional().describe('Acknowledge button label, e.g. "I have saved this"'),
    format: z.enum(['qrcode', 'code-list', 'secret', 'text', 'json']).optional().describe('Default format for fields without their own format. Defaults to json when omitted.'),
    fields: z.array(z.object({
      path: z.string().describe('Dot path into result.data (e.g. "totpURI", "client.client_secret").'),
      label: I18nLabelSchema.optional(),
      format: z.enum(['qrcode', 'code-list', 'secret', 'text', 'json']).optional().describe('Per-field format override.'),
    })).optional().describe('Which fields from result.data to render. Omit to dump full JSON.'),
  }).optional().describe('Render API response in a one-shot reveal dialog (suppresses successMessage when set).'),
  
  /** Access */
  visible: ExpressionInputSchema.optional().describe('Visibility predicate (CEL).'),
  disabled: z.union([z.boolean(), ExpressionInputSchema]).optional().describe('Boolean or predicate (CEL) — action is disabled when TRUE.'),

  /** Keyboard Shortcut */
  shortcut: z.string().optional().describe('Keyboard shortcut to trigger this action (e.g., "Ctrl+S")'),

  /** Bulk Operations */
  bulkEnabled: z.boolean().optional().describe('Whether this action can be applied to multiple selected records'),

  /**
   * AI exposure block (ADR-0011). Opt-in, default off: an action is exposed
   * to AI agents only when `ai.exposed === true`, in which case `ai.description`
   * is required. See {@link ActionAiSchema}.
   */
  ai: ActionAiSchema.optional().describe('AI exposure (opt-in). Set ai.exposed=true + ai.description to make this callable by agents.'),

  /**
   * Row-context: when the action runs from a list_item location, this body key
   * receives the row's id (or the field named by `recordIdField`). Defaults to
   * `id` when omitted but `recordIdField` is set; otherwise no injection.
   */
  recordIdParam: z.string().optional().describe('Body key to inject the row id into when running from a list_item context.'),
  /**
   * Row field whose value seeds `recordIdParam`. Defaults to `'id'` when
   * `recordIdParam` is set. Use this when the body key expects a non-id value
   * (e.g. `token` for `revoke-session`).
   */
  recordIdField: z.string().optional().describe('Row field whose value seeds recordIdParam. Defaults to "id".'),
  /**
   * Request-body shape. `'flat'` (default) sends collected params at the top
   * level. `{ wrap: 'data' }` nests the user-collected params under that key
   * (used by better-auth `organization/update`), while `recordIdParam` and
   * other top-level keys stay flat.
   */
  bodyShape: z.union([
    z.literal('flat'),
    z.object({ wrap: z.string() }),
  ]).optional().describe('Body wrapping: flat (default) or { wrap: key } to nest user-collected params under a key.'),
  /**
   * HTTP method to use when `type: 'api'`. Defaults to `POST`. Use `PATCH` to
   * call data-API update endpoints (e.g. `/api/v1/sys_api_key/{id}` with
   * `bodyExtra: { revoked: true }`).
   */
  method: z.enum(['POST', 'PATCH', 'PUT', 'DELETE']).optional().describe('HTTP method for type:"api" actions. Defaults to POST.'),
  /**
   * Static body fragment merged into the outgoing request body for `type:'api'`
   * actions. Useful for constants the user shouldn't (or can't) edit, e.g.
   * `bodyExtra: { resend: true }` on a resend-invitation action that reuses
   * better-auth's `invite-member` endpoint. Applied after user-collected
   * params and `recordIdParam` so constants always win.
   */
  bodyExtra: z.record(z.string(), z.unknown()).optional().describe('Constant body fields merged into the API request (applied last; overrides user params).'),
  /**
   * Semantic mode hint — UI / runtime can use this to pick confirm copy,
   * default variants, success messaging. Pure metadata; no runtime branching.
   */
  mode: z.enum(['create', 'edit', 'delete', 'custom']).optional().describe('Semantic mode of the action.'),

  /** Execution */
  timeout: z.number().optional().describe('Maximum execution time in milliseconds for the action'),

  /** ARIA accessibility attributes */
  aria: AriaPropsSchema.optional().describe('ARIA accessibility attributes'),
}).transform((data) => {
  // Auto-migrate deprecated `execute` → `target` for backward compatibility
  if (data.execute && !data.target) {
    return { ...data, target: data.execute };
  }
  return data;
}).refine((data) => {
  // Require `target` for types that reference an external resource
  if (TARGET_REQUIRED_TYPES.has(data.type) && !data.target) {
    return false;
  }
  return true;
}, {
  message: "Action 'target' is required when type is 'url', 'flow', 'modal', 'api', or 'form'.",
  path: ['target'],
}).refine((data) => {
  // ADR-0011: an exposed action must carry an LLM-facing description.
  if (data.ai?.exposed === true && !data.ai.description) {
    return false;
  }
  return true;
}, {
  message: 'ai.description is required (≥40 chars) when ai.exposed is true.',
  path: ['ai', 'description'],
}).refine((data) => {
  // ADR-0011: paramHints keys must reference a declared param (or the
  // auto-injected `recordId`), so a typo can't silently no-op.
  const hints = data.ai?.paramHints;
  if (!hints) return true;
  const known = new Set<string>(['recordId']);
  for (const p of data.params ?? []) {
    const key = p.name ?? p.field;
    if (key) known.add(key);
  }
  return Object.keys(hints).every((k) => known.has(k));
}, {
  message: 'ai.paramHints keys must match a declared param name (or "recordId").',
  path: ['ai', 'paramHints'],
}));

export type Action = z.infer<typeof ActionSchema>;
export type ActionParam = z.infer<typeof ActionParamSchema>;
export type ActionInput = z.input<typeof ActionSchema>;

/**
 * Action Factory Helper
 */
export const Action = {
  create: (config: z.input<typeof ActionSchema>): Action => ActionSchema.parse(config),
} as const;
