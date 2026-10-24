/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types - CRUD Component Schemas
 * 
 * Type definitions for Create, Read, Update, Delete operations.
 * These schemas enable building complete data management interfaces.
 * 
 * @module crud
 * @packageDocumentation
 */

import type { BaseSchema, SchemaNode } from './base.js';

/**
 * Action execution mode for chaining
 */
export type ActionExecutionMode = 'sequential' | 'parallel';

// `ActionCallback` — the Phase-2 callback object the legacy `ActionSchema.onSuccess` /
// `onFailure` keys carried — was DELETED by `6bca0e4e8` (the objectui#7664 route for
// a standalone retired type: name gone from both faces and from the barrels, absence
// pinned). The two keys below stay declared as `?: never` tombstones so an authored
// callback is a `tsc` error at the site instead of a silent index-signature admit;
// `__tests__/action-callback-retired-7068.test.ts` pins both faces.

/**
 * Action button configuration for CRUD operations
 * Enhanced with Phase 2 features: ajax, confirm, dialog, chaining, conditional execution
 *
 * @deprecated Use `UIActionSchema` from `@object-ui/types` (re-exported from `ui-action.ts`) for new code.
 * This legacy interface will be removed in a future major version.
 */
export interface ActionSchema extends BaseSchema {
  type: 'action';
  /**
   * Action label
   */
  label: string;
  /**
   * Action type/level.
   *
   * NO `@default`, deliberately (objectui#8318). The tag published `'default'`
   * and nothing applies it. `type: 'action'` is not a rendered node type --
   * `register('action'` matches nothing repo-wide, exit 1, with
   * `register('detail'` as the firing control (it resolves to
   * `plugin-detail/src/index.tsx:387`). Nor does the channel that makes the
   * neighbouring `ActionSchema` keys live read this one: in
   * `packages/core/src/actions/ActionRunner.ts` the spellings `action.level`
   * and `schema.level` have zero hits repo-wide, exit 1, with `action.method`
   * as the firing control (`ActionRunner.ts:1788` and `:1794`). Until
   * objectui#7735 the zod mirror's `.default('default')` substituted the value
   * into a parsed document; with that gone the tag described nothing that runs.
   * Whether the key should exist at all is the ADR-0049 liveness worklist's
   * question (objectui#4631, objectui#7963), not this card's.
   */
  level?: 'primary' | 'secondary' | 'success' | 'warning' | 'danger' | 'info' | 'default';
  /**
   * Icon to display (lucide-react icon name)
   */
  icon?: string;
  /**
   * Action variant
   */
  variant?: 'default' | 'outline' | 'ghost' | 'link';
  /**
   * Action type
   * Enhanced in Phase 2 with 'ajax', 'confirm', 'dialog'
   */
  actionType?: 'button' | 'link' | 'dropdown' | 'ajax' | 'confirm' | 'dialog';
  /**
   * API endpoint to call (for ajax actions)
   */
  api?: string;
  /**
   * HTTP method
   * @default 'POST'
   */
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  /**
   * Request body/data
   */
  data?: any;
  /**
   * Request headers
   */
  headers?: Record<string, string>;
  /**
   * RETIRED (objectui#4314, maintainer ruling 2026-08-17, ADR-0049
   * enforce-or-remove): the structured confirm object
   * (`{ title, message, confirmText, cancelText, confirmVariant }`) had zero
   * producers, and in `ActionRunner` its `message` OUTRANKED `confirmText` —
   * the only spelling the translation bundle knows
   * (`{ns}.objects.{obj}._actions.{name}.confirmText`) — so a dialog authored
   * this way silently lost localization. `?: never` is this package's
   * tombstone convention (see `complex.ts` `DashboardWidgetSchema`): authoring
   * the key is a tsc error here and a parse rejection in the Zod twin
   * (`zod/crud.zod.ts`); reading it still type-checks (`never | undefined`)
   * during migration. Reopen condition, recorded on objectui#4314: real demand
   * for structured confirm dialogs — the arm returns WITH its bundle keys
   * (`_actions.{name}.confirm.*`) designed in, never before.
   * @deprecated Retired — author `confirmText` instead.
   */
  confirm?: never;
  /**
   * Confirmation message — shows a confirm dialog before executing.
   * The ONE confirm spelling: `@objectstack/spec`'s action surface and the
   * TranslationBundle both stand on `confirmText`.
   */
  confirmText?: string;
  /**
   * Dialog configuration (for dialog actions)
   */
  dialog?: {
    /**
     * Dialog title
     */
    title?: string;
    /**
     * Dialog content
     */
    content?: SchemaNode | SchemaNode[];
    /**
     * Dialog size
     */
    size?: 'sm' | 'default' | 'lg' | 'xl' | 'full';
    /**
     * Dialog actions
     */
    actions?: ActionSchema[];
  };
  /**
   * Success message after execution
   */
  successMessage?: string;
  /**
   * Error message on failure
   */
  errorMessage?: string;
  /**
   * RETIRED (`6bca0e4e8`, ADR-0049 enforce-or-remove) — the Phase-2 success
   * callback, an `ActionCallback` object (`{ type: 'toast' | 'message' | 'redirect'
   * | 'reload' | 'custom' | 'ajax' | 'dialog', message?, url?, api?, method?,
   * dialog?, handler? }`). Measured before the retirement: zero producers outside
   * this package's own test fixture and two docs pages, and zero runtime readers —
   * `ActionRunner` never consumed this shape (its retired channel wanted full
   * `ActionDef`s, and `{ type: 'toast' }` is not a registered action type), and
   * `@objectstack/spec`'s `ActionSchema` refuses it at publish (`invalid_type` at
   * `onSuccess.navigate` plus `unrecognized_keys` on the block). It was the THIRD
   * meaning of this key; objectui#5934 had already converged the runner on the
   * spec's post-success block. Maintainer ruling option 1 (2026-09-05), immediate,
   * no deprecation window.
   *
   * Where the live meaning lives: the spec's `onSuccess` block `{ navigate, openIn }`,
   * declared on `UIActionSchema` (`ui-action.ts`) and forwarded to the runner. A
   * success notice is {@link ActionSchema.successMessage}. `?: never` rather than a
   * deletion because {@link BaseSchema} carried an index signature that would ADMIT
   * a deleted key unchecked (since objectui#8347 a widened value still would); the zod twin (`zod/crud.zod.ts`) refuses it by name.
   * @deprecated Not part of this contract — write the spec's `onSuccess` block on `UIActionSchema`, or `successMessage`.
   */
  onSuccess?: never;
  /**
   * RETIRED (`6bca0e4e8`, ADR-0049 enforce-or-remove) — the Phase-2 failure
   * callback, the same `ActionCallback` object shape {@link ActionSchema.onSuccess}
   * carried. Zero producers, zero runtime readers (measured, see `onSuccess`), and
   * `@objectstack/spec`'s `ActionSchema` declares no `onFailure` at all — an
   * authored one is refused at publish as an unrecognized key. Maintainer ruling
   * option 1 (2026-09-05), immediate, no deprecation window. A failure notice is
   * {@link ActionSchema.errorMessage}; the zod twin refuses this key by name.
   * @deprecated Not part of this contract — write `errorMessage`.
   */
  onFailure?: never;
  /**
   * Action chaining - actions to execute after this one (Phase 2)
   */
  chain?: ActionSchema[];
  /**
   * Chain execution mode
   * @default 'sequential'
   */
  chainMode?: ActionExecutionMode;
  /**
   * Execution gate — the action runs only while this predicate holds.
   *
   * A boolean, a bare CEL string, a `${…}` template, or the normalized
   * `{ dialect, source }` envelope `objectstack build` emits. Declared and
   * FALSE skips the action; not declared at all executes it. Same three arms
   * `ActionRunner`'s own `ActionDef.condition` carries (`@object-ui/core`),
   * because this is the authoring twin of that gate.
   *
   * RETIRED (objectui#3917): this key used to be typed `ActionCondition`, an
   * `{ expression, then, else }` branch DSL. NOTHING in the repo ever read
   * `expression` / `then` / `else` — `ActionRunner` reads this key as the
   * predicate above, and an object with no `source` normalizes to "no gate
   * declared", so an author who followed the docs ("amounts over 1000 go to
   * manager approval") got UNCONDITIONAL execution with zero diagnostics.
   * Retired under enforce-or-remove rather than honoured, so one key has one
   * reading. Conditional BRANCHING is expressed as separate actions, each
   * carrying its own `condition`.
   */
  condition?: boolean | string | { dialect?: string; source: string };
  /**
   * Whether to reload data after action
   * @default true
   */
  reload?: boolean;
  /**
   * Whether to close dialog/modal after action
   * @default true
   */
  close?: boolean;
  /**
   * Custom click handler — RUNTIME SLOT (objectui#7344, the objectui#6124
   * shape): a host-supplied function, NOT authorable metadata. `ActionRunner`
   * awaits `action.onClick()` and the action renderers guard
   * `typeof action.onClick === 'function'`, so the callable stays; the zod
   * twin, which accepted `z.any()`, now refuses the key by name.
   */
  onClick?: () => void | Promise<void>;
  /**
   * Redirect URL after success
   */
  redirect?: string;
  /**
   * Action logging/tracking (Phase 2)
   */
  tracking?: {
    /**
     * Enable tracking
     */
    enabled?: boolean;
    /**
     * Event name
     */
    event?: string;
    /**
     * Additional metadata
     */
    metadata?: Record<string, any>;
  };
  /**
   * Timeout in milliseconds
   */
  timeout?: number;
  /**
   * Retry configuration
   */
  retry?: {
    /**
     * Maximum retry attempts
     */
    maxAttempts?: number;
    /**
     * Delay between retries (in ms)
     */
    delay?: number;
  };
}

/**
 * Detail view component
 * Displays detailed information about a single record
 */
export interface DetailSchema extends BaseSchema {
  type: 'detail';
  /**
   * Detail title
   */
  title?: string;
  /**
   * API endpoint to fetch detail data
   */
  api?: string;
  /**
   * Resource ID to display. A record id is a `string` on every
   * boundary (objectui#9511) — a numeric primary key is converted at the
   * adapter's own boundary, so an authored `42` is refused with `'42'`
   * prescribed.
   */
  resourceId?: string;
  /**
   * Field groups for organized display
   */
  groups?: Array<{
    title?: string;
    description?: string;
    fields: Array<{
      name: string;
      label?: string;
      type?: 'text' | 'image' | 'link' | 'badge' | 'date' | 'datetime' | 'json' | 'html' | 'custom';
      format?: string;
      render?: SchemaNode;
    }>;
  }>;
  /**
   * Actions available in detail view
   */
  actions?: ActionSchema[];
  /**
   * Tabs for additional content
   */
  tabs?: Array<{
    key: string;
    label: string;
    content: SchemaNode | SchemaNode[];
  }>;
  /**
   * Show back button
   * @default true
   */
  showBack?: boolean;
  /**
   * Custom back action — RUNTIME SLOT (objectui#7344, the objectui#6124 shape):
   * a host-supplied function, NOT authorable metadata. `detail` is registered to
   * `DetailView`, whose `handleBack` calls `onBack()` when set; the zod twin,
   * which accepted `z.any()`, now refuses the key by name.
   */
  onBack?: () => void;
  /**
   * SPA navigation callback — RUNTIME SLOT (`7ca6ddd4b`, the objectui#6124
   * shape): a host-supplied function, NOT authorable metadata. `'detail'` is
   * registered to `DetailView` RAW, so an authored value reaches
   * `schema.onNavigate` by identity and `handleBack` / `handleEdit` / the
   * post-delete redirect CALL it. Until this card the key was declared on
   * NEITHER face: `BaseSchema`'s index signature typed it `any` here and the
   * zod mirror's `.passthrough()` kept it there, so an authored
   * `{ "action": "toast" }` parsed green and threw `schema.onNavigate is not a
   * function` at click. The zod twin now refuses the key by name; supply it
   * from a React host.
   *
   * Signature taken from the call site (`(url, { replace })`), which is the
   * same one `views.ts#DetailViewSchema.onNavigate` declares — one component,
   * two registrations, one contract.
   */
  onNavigate?: (url: string, options?: { replace?: boolean; newTab?: boolean }) => void;
  /**
   * New comment callback — RUNTIME SLOT (`7ca6ddd4b`), reaching the renderer
   * on a DIFFERENT channel from {@link DetailSchema.onNavigate}: `DetailView`
   * does not call it, it forwards it as a prop into `<RecordComments>`, whose
   * submit handler awaits it. Measured per key rather than per prefix, as the
   * batch #69 ruling requires.
   */
  onAddComment?: (text: string) => void | Promise<void>;
  /**
   * Force the loading skeleton.
   *
   * `DetailView.tsx:995` reads this key as a bare disjunct beside the
   * component's OWN fetch state (`const [loading, setLoading] = ...`, `:269`):
   * `if (loading || schema.loading)`. An omitted key is `undefined`, so it
   * contributes nothing to that gate -- the value the reader applies on absence
   * is `false`, not the `true` the tag published until objectui#8318. That
   * `true` arrived in `6f132f29` (2026-07-13), a bulk JSDoc pass copying the
   * zod mirror's old `.default(true)`, so it was never an authored intent, and
   * honouring it would have drawn a skeleton on every detail view that omits
   * the key. Giving the reader the `?? true` the old tag promised is a
   * behaviour change and a product question of its own (maintainer ruling
   * 2026-09-09), not opened here.
   * @default false
   */
  loading?: boolean;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `detail` reads NEITHER
   * content channel; see `children` below for the measurement.
   *
   * {@link BaseSchema} already refuses `body` (objectui#6771), but its
   * refusal names `children` as the remedy, which this node does not read
   * either. The member is restated here so the refusal points at what the
   * node renders instead.
   *
   * @deprecated Not a channel `detail` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `detail` reads NEITHER
   * content channel, so an authored child list here rendered NOTHING: no
   * render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it.
   *
   * Measured with the TypeScript type checker, not grep, over one program per
   * workspace package on a built tree (the family-D re-measure). The bare
   * `detail` key is owned by `view:detail` (`@object-ui/plugin-detail`),
   * which hands the node to `DetailView`; `DetailView` reads it as
   * `DetailViewSchema`, and no `body` or `children` read is filed under that
   * type. `SchemaRenderer` strips `body` and `children` out of the props bag
   * it spreads, so neither reaches the component by another route, and the
   * registration declares no `children` slot (objectui#9910).
   *
   * What it renders instead: the record named by `objectName` and
   * `resourceId`, laid out by `DetailView` from `fields`, `sections` and
   * `tabs`.
   *
   * @deprecated Not a channel `detail` reads — nothing renders it.
   */
  children?: never;
}

/**
 * CRUD Dialog/Modal component for CRUD operations
 * Note: For general dialog usage, use DialogSchema from overlay module
 *
 * NO RENDERER IS REGISTERED FOR `crud-dialog` (objectui#7344, re-measured for
 * objectui#8318): `register('crud-dialog'` matches nothing repo-wide, exit 1,
 * with `register('detail'` as the firing control (it resolves to
 * `plugin-detail/src/index.tsx:387`). Nothing renders a node of this type, so
 * no member below has a reader, and a `@default` on any of them would describe
 * something that does not run -- which is why the four keys that used to
 * publish one no longer do (objectui#8318). This is upstream of any per-key
 * census: a census can only report where a spelling appears, and the reason
 * these keys have no reader is that the node type never reaches a renderer at
 * all. Whether the type should exist is the ADR-0049 liveness worklist's
 * question (objectui#4631, objectui#7963), not this card's.
 */
export interface CRUDDialogSchema extends BaseSchema {
  type: 'crud-dialog';
  /**
   * Dialog title
   */
  title?: string;
  /**
   * Dialog description
   */
  description?: string;
  /**
   * Dialog content
   */
  content?: SchemaNode | SchemaNode[];
  /**
   * Dialog size.
   *
   * NO `@default`, deliberately (objectui#8318): the tag published `'default'`
   * with no reader to apply it. `.size` is one of the most common spellings in
   * this tree, so a name census answers nothing here; the interface docblock
   * above carries the fact that decides it -- there is no `crud-dialog`
   * registration, so no node of this type is ever handed to a renderer.
   */
  size?: 'sm' | 'default' | 'lg' | 'xl' | 'full';
  /**
   * Dialog actions/buttons
   */
  actions?: ActionSchema[];
  /**
   * Whether dialog is open
   */
  open?: boolean;
  /**
   * Close handler — RETIRED (objectui#7344, ADR-0049, the objectui#6124 shape):
   * no renderer is registered for `crud-dialog`, so nothing reads the key. The
   * zod twin, which accepted `z.any()`, now refuses it by name; author
   * behaviour as a node type instead.
   * @deprecated Not part of this contract — the value was inert.
   */
  onClose?: never;
  /**
   * Whether clicking outside closes dialog.
   *
   * NO `@default`, deliberately (objectui#8318): the tag published `true` with
   * no reader to apply it. Here the name census is decisive on its own -- the
   * spelling `closeOnOutsideClick` occurs NOWHERE in the tree outside this
   * declaration and its zod twin (`zod/crud.zod.ts`), so there is not even a
   * look-alike reader on some other node type to mistake for one. The missing
   * registration is in the interface docblock above.
   */
  closeOnOutsideClick?: boolean;
  /**
   * Whether pressing Escape closes dialog.
   *
   * NO `@default`, deliberately (objectui#8318): the tag published `true` with
   * no reader to apply it. `closeOnEscape` is the second of the two keys on
   * this interface whose spelling occurs nowhere outside this declaration and
   * its zod twin -- zero repo-wide hits, so nothing reads it under any node
   * type. The missing registration is in the interface docblock above.
   */
  closeOnEscape?: boolean;
  /**
   * Show close button.
   *
   * NO `@default`, deliberately (objectui#8318): the tag published `true` with
   * no reader to apply it. When that was written this key's census was NOT
   * empty: `packages/components/src/renderers/overlay/drawer.tsx` read a
   * `showClose` of its own, which was never this declaration's reader (and was
   * never declared on `DrawerSchema` either). objectui#11347 retired that
   * read, so no renderer reads `showClose` under any node type now. The
   * missing registration is in the interface docblock above.
   */
  showClose?: boolean;
}

/**
 * Union type of all CRUD schemas
 */
export type CRUDComponentSchema =
  | ActionSchema
  | DetailSchema
  | CRUDDialogSchema;
