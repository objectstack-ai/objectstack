/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/core - Action Runner
 * 
 * Executes actions defined in ActionSchema and EventHandler.
 *
 * Dispatches every `@objectstack/spec` `ActionType` — `script`, `url`, `modal`,
 * `flow`, `api`, `form` — plus the one declared renderer-local alias,
 * `navigation` (see `ObjectUiLocalActionType`). The table that does it is typed
 * against that vocabulary, so this list cannot go stale the way the old comment
 * had (it still claimed five types after `form` shipped).
 *
 * Features: conditional execution, confirmation, toast notifications,
 * redirect handling, action chaining, custom handler registration.
 */

import type { ActionContext, ActionResult, RunnableActionType, UIActionSchema } from '@object-ui/types';
import type { Action as SpecActionInput } from '@objectstack/spec/ui';
import { ExpressionEvaluator } from '../evaluator/ExpressionEvaluator.js';
import { actionCopySource, fillTemplateHoles, hasTemplateHoles, type ActionCopyTemplate } from './actionCopyTemplate.js';
import { hasDeclaredPredicate } from '../evaluator/declaredPredicate.js';
import { globalUndoManager } from './UndoManager.js';
import { warnOnDeprecatedObjectParams, warnOnUnknownActionKeys } from './actionKeys.js';
import { readActionPayload } from './actionResponse.js';
import { classifyNavigationTarget } from './navigationTarget.js';
import { toPredicateRecord, type FieldContainerLike } from '../utils/predicate-record.js';

/**
 * What a navigation target outside `classifyNavigationTarget`'s admitted set
 * answers (objectui#12191). It names the admitted set, so the author learns the
 * fix from the refusal. ⚠️ Nothing derives this text from the classifier: a
 * change to the set changes this sentence by hand.
 * `navigationTarget.mailto-12191.test.ts` pins that it names each admitted kind.
 */
const NAVIGATION_TARGET_REFUSAL =
  'Invalid URL scheme. Only http://, https://, mailto: and in-app relative paths (/path, ./path) are allowed.';

/**
 * What an action handler returns and the runner reads — ONE authority, in
 * `@object-ui/types` (objectui#6349, batch 4), re-exported here exactly as
 * {@link ActionContext} is below. The members this module used to declare
 * (`reload`, `redirect`, `modal`, `silent`, `undo`) moved down with it, and
 * `UndoableOperation`, which types `undo`, moved down beside it
 * (`./UndoManager.js` re-exports that one). The gate that counts authorities is
 * `scripts/__tests__/one-authority-per-exported-name-6273.test.ts`; a re-export
 * is not one.
 */
export type { ActionResult } from '@object-ui/types';

/**
 * The context a runner executes actions in — ONE authority, in
 * `@object-ui/types` (objectui#6349, batch 4). This module RE-EXPORTS that
 * declaration instead of declaring a second one, so an import of
 * `ActionContext` from `@object-ui/core` and one from `@object-ui/types` are
 * the same type. `@object-ui/types` is the dependency-legal side: it depends on
 * no `@object-ui/*` package, and this package depends on it.
 *
 * A re-export is not a second authority —
 * `scripts/__tests__/one-authority-per-exported-name-6273.test.ts` counts
 * declarations and ALIASING re-exports, never `export type { X } from …` —
 * which is why this convergence takes `ActionContext` off that gate's
 * `KNOWN_COLLISIONS` baseline. The member drift it removed is recorded on the
 * declaration itself.
 */
export type { ActionContext } from '@object-ui/types';

/**
 * API configuration for complex requests.
 */
export interface ApiConfig {
  /** API endpoint URL */
  url: string;
  /** HTTP method */
  method?: string;
  /** Request headers */
  headers?: Record<string, string>;
  /** Request body (will be JSON-stringified if object) */
  body?: any;
  /** Query parameters */
  queryParams?: Record<string, string>;
  /** Response type */
  responseType?: 'json' | 'text' | 'blob';
}

/**
 * Action definition accepted by the runner.
 * Compatible with both UIActionSchema (spec v2.0.1) and legacy crud.ts ActionSchema.
 *
 * ── CLOSED since objectstack#4075 step 3 ──────────────────────────────────────
 *
 * This interface used to end with `[key: string]: any`, so it accepted any key
 * of any type: deleting `execute` from it produced ZERO compile errors, a typo
 * (`targt`, `exectue`) type-checked, and a tombstoned key sailed through to a
 * runner that then silently did nothing — the objectstack#2169 "Mark Done does
 * nothing" shape. The index signature is gone. Every key this type accepts is
 * now written down below, and `tsc` rejects the rest at any site that AUTHORS an
 * action literal in code.
 *
 * What it does NOT reach, and what still covers that: stored `sys_metadata` rows
 * are rehydrated UNPARSED (objectstack#3903), so authored metadata arrives at
 * `runner.execute()` as a plain object the compiler never saw. The dev-mode
 * `warnOnUnknownActionKeys` shim from step 1 therefore STAYS — it is not
 * redundant with the closed type, it is the other half of the same surface, and
 * the two halves catch disjoint populations (code-authored literals vs. stored
 * rows).
 *
 * {@link ActionContext} keeps ITS index signature, deliberately. It is a runtime
 * data bag whose keys are genuinely open (`data`, `record`, `pageVariables`,
 * `user`, plus whatever a host passes); this is a declared metadata contract
 * mirroring `@objectstack/spec`'s `ActionSchema`. Open key set on a data bag is
 * correct; open key set on a contract is the bug above.
 */
export interface ActionDef {
  /** Action type identifier — a `RunnableActionType` (the spec's six plus the
   *  `navigation` alias of `url`) or a custom type with a registered handler. */
  type?: string;
  /**
   * Legacy action type field.
   *
   * @deprecated objectui dialect — use the spec spelling `type`. Both are read,
   * `type` first (objectstack#4075 step 2).
   */
  actionType?: string;
  /** Action name (from UIActionSchema) */
  name?: string;
  /** Display label */
  label?: string;
  /**
   * Human description of the action, shown as the param-collection dialog's
   * subtitle (`useConsoleActionRuntime` reads it beside `label`).
   *
   * objectui vocabulary, not spec: `@objectstack/spec`'s `ActionSchema` has no
   * `description`, so this derives from `@object-ui/types`' renderer view of an
   * action (`UIActionSchema`, `ui-action.ts`) — the same "authorable for a
   * declared surface" source `check:action-forward-parity` derives its owed set
   * from, which is why that gate already requires all four action renderers to
   * forward this key (objectui#4192: `action:menu`'s dialog titled itself
   * "Action parameters" instead of naming the action).
   *
   * Promoted by step 3 (objectstack#4075): the key was authorable, forwarded
   * and read, but `ActionDef` never declared it, so it reached its reader only
   * through `[key: string]: any`. Deleting the index signature is what surfaced
   * it — the two TS2353s the deletion produced repo-wide were both this key.
   */
  description?: UIActionSchema['description'];
  /**
   * Confirmation text — shows a confirm dialog before executing. The ONE
   * confirm spelling: `@objectstack/spec`'s action surface and the
   * TranslationBundle key (`{ns}.objects.{obj}._actions.{name}.confirmText`)
   * both stand on it.
   *
   * A string or the `template` envelope (objectui#13367, the renderer half of
   * objectstack#24814): its `{{ }}` holes are filled over `record` and
   * `params`, and a sentence with none is shown as written — a `${…}` token is
   * text (objectui#13476). See `confirmMessage`.
   */
  confirmText?: ActionCopyTemplate;
  /**
   * RETIRED (objectui#4314): the structured confirm object used to sit here
   * and its `message` OUTRANKED `confirmText` — untranslated, since no bundle
   * key exists for it. `?: never` so constructing an action with it is a tsc
   * error rather than a silently-ignored key; the authorable twin
   * (`@object-ui/types` `crud.ts`) carries the same tombstone.
   * @deprecated Retired — author `confirmText` instead.
   */
  confirm?: never;
  /**
   * Condition predicate — the action executes only while it holds.
   *
   * A boolean, a bare CEL string, a `${…}` template, or the normalized
   * `{ dialect, source }` envelope `objectstack build` emits. Declared and
   * FALSE skips the action; not declared at all (absent / empty predicate)
   * executes. `boolean` is spelled out here because the execution gate now
   * honours `condition: false` as the verdict it plainly is (objectui#3872) —
   * the same widening `disabled` already carries below.
   */
  condition?: string | boolean;
  /**
   * Disabled predicate — the control renders inert while it holds.
   *
   * Same three arms as {@link ActionDef.visible}, derived from the same spec
   * field, because the 2026-08-06 maintainer ruling on objectstack#4075 gave
   * both keys ONE shape: `boolean | string(CEL) | { dialect, source }` —
   * "boolean = 条件的退化形字面量,string = CEL 简写,信封 = 完整形". The
   * envelope arm arrived in `@objectstack/spec` 17.0.0-rc.6 (objectstack
   * `97e7e3caa`); until then this was a hand-written `string | boolean`
   * that could not describe the envelope, which is why `DeclaredActionsBar`
   * read it through an `(action as any).disabled` cast. Derived, not restated,
   * so the two keys cannot drift apart again.
   */
  disabled?: SpecActionInput['disabled'];
  /**
   * API endpoint (string URL or complex config).
   *
   * @deprecated objectui dialect — the spec spells an `api` action's endpoint
   * `target` (with the verb in `method`). `executeAPI` resolves
   * `api || endpoint || target`, so `target` alone is sufficient. The
   * `ApiConfig` object form has no spec counterpart and is objectui-only
   * (objectstack#4075 step 2).
   */
  api?: string | ApiConfig;
  /**
   * API endpoint URL.
   *
   * @deprecated objectui dialect — this was the "spec v2.0.1 alias", but spec 17
   * spells it `target`. `executeAPI` resolves `api || endpoint || target`
   * (objectstack#4075 step 2).
   */
  endpoint?: string;
  /** HTTP method */
  method?: string;
  /**
   * Navigation target — a nested envelope carrying the `navigation` alias's own
   * spelling (`to` / `external` / `newTab` / `replace`).
   *
   * @deprecated objectui dialect — the spec has no nested navigation envelope;
   * it spells a navigation action `{ type: 'url', target, openIn }`.
   * `executeNavigation` reads `navigate.to || navigate.target || navigate.redirect`,
   * falling back to the same keys on the action itself, so a flat `target` works
   * today (objectstack#4075 step 2).
   */
  navigate?: any;

  // ── The `navigation` alias's own spelling, promoted by step 3 ──────────────
  //
  // objectstack#4075 step 3. Step 1's inventory established these four as a
  // REAL objectui dialect rather than undeclared drift — `executeNavigation`
  // reads them off the action itself when no nested `navigate` envelope is
  // present, and `NAVIGATION_ALIAS_KEYS` in `actionKeys.ts` has listed them as
  // legitimate since then, with a tripwire that fires if the spec ever adopts
  // one of the names. But step 2 promoted only the 18 SPEC-owned keys, so these
  // four kept reaching their own reader through `[key: string]: any`. Deleting
  // the index signature is what surfaced that: `nav.to`, `source.external`,
  // `source.newTab` and `source.replace` were the four TS2339s the deletion
  // produced inside this file.
  //
  // Declared, deliberately NOT `@deprecated`: step 2's acceptance ruled the
  // dispatch wrong on exactly this point — "navigation 别名四键不标弃用(第 1 步
  // 盘点已判定其合法,派发指令有误)". They are objectui vocabulary the runner
  // itself implements, not an alias of a spec spelling an author should prefer.
  // Hand-written rather than derived because there is no spec field to derive
  // FROM — that is what makes them dialect. `replace` is the load-bearing case:
  // it is documented at its read site as "the one thing the `navigation` shape
  // carries that `ActionSchema` has no field for".

  /** `navigation` alias: the target URL. `executeNavigation` resolves
   *  `to || target || redirect`, so a flat spec-style `target` also works. */
  to?: string;
  /** `navigation` alias: force the external-URL treatment that the scheme
   *  heuristic would otherwise decide. */
  external?: boolean;
  /** `navigation` alias: open in a new tab. The first-class spec switch is
   *  `openIn: 'new-tab'`, which WINS over this one — prefer it in new metadata.
   *  Unrelated to the retired `params.newTab` read (objectui#4097). */
  newTab?: boolean;
  /** `navigation` alias: replace the current history entry instead of pushing
   *  a new one. No `ActionSchema` counterpart in any spelling. */
  replace?: boolean;

  /** onClick callback (legacy) */
  onClick?: () => void | Promise<void>;
  /** Whether to reload data after success */
  reload?: boolean;
  /** Whether to close dialog after success */
  close?: boolean;
  /** Redirect URL expression */
  redirect?: string;
  /** Toast configuration */
  toast?: { showOnSuccess?: boolean; showOnError?: boolean; duration?: number };
  /** Success message (from UIActionSchema). The success toast's second rung,
   *  after {@link outcomeMessages}. A string or the `template` envelope
   *  (objectui#13367): `{{ }}` holes over `result` and `record`; a sentence
   *  with none is shown as written, `${…}` tokens included (objectui#13476). */
  successMessage?: ActionCopyTemplate;
  /** Error message (from UIActionSchema). A string or the `template`
   *  envelope (objectui#13367); shown as written — no scope is declared for
   *  its holes yet. */
  errorMessage?: ActionCopyTemplate;
  /** Whether to refresh data after execution (from UIActionSchema) */
  refreshAfter?: boolean;
  /** Single-record update actions: offer an Undo affordance on success. */
  undoable?: boolean;
  /** Params object (for custom handlers) */
  params?: Record<string, any>;
  /** ActionParam definitions to collect from user before execution (from spec ActionSchema.params) */
  actionParams?: ActionParamDef[];
  /**
   * Result dialog spec — when present and the action succeeds, the runner
   * suppresses the successMessage toast and asks the consumer to open a
   * reveal dialog rendering `result.data` (see ResultDialogSpec).
   */
  resultDialog?: ResultDialogSpec;
  /**
   * The one handler slot: script name/expression for `type: 'script'`, URL for
   * `'url'`, flow name for `'flow'`, modal/page for `'modal'`, endpoint for
   * `'api'`, FormView name for `'form'`.
   *
   * The `execute` alias was REMOVED in @objectstack/spec 17 (objectstack-ai/objectstack#3855) and is not
   * read here (objectstack-ai/objectstack#3856) — don't re-add it. Two handler slots is how one action ran
   * one script server-side and a different one client-side (objectstack-ai/objectstack#3713).
   */
  target?: string;
  /**
   * Action body (spec `ActionSchema.body` — `HookBodySchema`). Opaque here:
   * bodies are a SERVER-side execution surface and this runner never
   * interprets one.
   *
   * L2 (`language: 'js'`) is defined as a function body run inside an isolated
   * VM enforcing declared capabilities, `timeoutMs` and `memoryMb`. A browser
   * has no such isolate, so "enforcing" those client-side would be decoration.
   * L1 (`language: 'expression'`) is formula-engine (CEL) source, a different
   * dialect from this package's `${…}` ExpressionEvaluator — running it here
   * would diverge silently rather than fail.
   *
   * Consumers dispatch bodies by registering a `script` handler that POSTs to
   * `/api/v1/actions/{object}/{action}`; the server runs the body through its
   * sandbox. Build that handler with `createServerActionHandler` (#2904) —
   * app-shell's `useConsoleActionRuntime` and `RecordDetailView` both do.
   */
  body?: unknown;
  /** For type: 'url' — where to open `target`. `'new-tab'` forces a new
   *  browser tab/window, `'self'` forces same-page navigation. When omitted,
   *  external URLs open in a new tab and relative URLs navigate in place.
   *  This is the public, static "open in new tab" switch (ActionSchema.openIn),
   *  distinct from the async-handler `opensInNewTab` pre-open dance. */
  openIn?: 'self' | 'new-tab';
  /** Modal schema to open (for type: 'modal') */
  modal?: any;
  /** Chained actions to execute after this one */
  chain?: ActionDef[];
  /** Chain execution mode */
  chainMode?: 'sequential' | 'parallel';
  /** Callback on failure */
  onFailure?: ActionDef | ActionDef[];
  /** When true, the runner pre-opens about:blank synchronously on click so the
   *  handler can drive it to a returned `redirectUrl` after an awaited fetch
   *  without tripping popup blockers. Used by actions like `sso_as_owner`. */
  opensInNewTab?: boolean;
  /** Zero-roundtrip new-tab target: a path template (`{recordId}` placeholder)
   *  the handler navigates the pre-opened tab to IMMEDIATELY on click, skipping
   *  the action POST entirely. Only valid with `opensInNewTab`; the endpoint
   *  must perform all auth/authz itself (e.g. the cloud `/sso-open` endpoint,
   *  which re-runs every check the POST half would have done). */
  newTabUrl?: string;

  // ── Spec-owned keys, promoted out of the index signature ───────────────────
  //
  // objectstack#4075 step 2. Step 1's inventory found 18 keys that
  // `@objectstack/spec`'s `ActionSchema` owns and that authored metadata
  // carries today, but that `ActionDef` never declared — so they reached
  // readers only through `[key: string]: any`, and the two `ActionEngine`
  // actually reads (`visible`, `locations`) had to be read through an `as any`
  // cast. Declaring them is what removes those casts.
  //
  // Every type below is DERIVED from the spec via `SpecActionInput[...]`, never
  // hand-copied: a hand-written duplicate of a spec shape is a second contract
  // that drifts silently, which is the failure this whole issue is about.
  //
  // Derived from `z.input`, not `z.infer`, and the difference is load-bearing
  // rather than stylistic. `ActionSchema` is a `ZodPipe` whose transforms narrow
  // the authored shape — `visible` is authored as `string | { dialect, source }`
  // but INFERS to the object form alone. This runner consumes authored/stored
  // rows, which objectstack-ai/objectstack#3903 established are rehydrated UNPARSED, so it sees the input
  // shape. Deriving from the `z.infer` side would type-error the raw-string
  // predicate that `ActionEngine` explicitly supports and that
  // `ActionEngine.visibility.test.ts` pins.
  //
  // WHICH SPEC NAME carries `z.input` changed under us in `@objectstack/spec`
  // 17.0.0-rc.6: up to rc.5 it was `ActionInput` (with `Action` = `z.infer`),
  // and rc.6 retired every `…Input` alias and moved the bare name onto the input
  // side (`Action` = `z.input`, `ActionParsed` = `z.infer`). The import above is
  // therefore `Action as SpecActionInput` — the local alias keeps naming the
  // side this file needs, so every derivation below is unchanged in meaning.
  //
  // `shortcut` and `bulkEnabled` land here as `undefined`, not as a usable type
  // — that is correct and deliberate. Spec 17 retired both as `retiredKey()`
  // tombstones (`z.never()`), so authoring either is a hard parse rejection.
  // Deriving rather than hand-writing turns that rejection into a COMPILE error
  // for free; hand-copying would have re-legitimized two dead keys.

  /** Where this action renders (`record_header`, `list_toolbar`, …). Read by
   *  `ActionEngine.registerActions` to seed the location filter. */
  locations?: SpecActionInput['locations'];
  /**
   * Visibility predicate, evaluated against the runner's context.
   *
   * Three arms — `boolean | string(CEL) | { dialect, source }` — and all three
   * now come from the spec. Step 2 had to write `SpecActionInput['visible'] |
   * boolean` because the literal `visible: true` / `false` that
   * `ActionEngine.getActionsForLocation` honours (pinned by
   * `ActionEngine.visibility.test.ts`) was objectui tolerance the spec did not
   * share, and it left the open question step 3 was blocked on: does the spec
   * adopt the boolean, or does objectui drop it?
   *
   * The maintainer ruled ADOPT on 2026-08-06 (objectstack#4075): "统一形状,
   * spec 采纳 —— `visible` / `disabled` 两键在 spec 侧统一收敛为
   * `boolean | string(CEL) | {dialect, source}`(boolean = 条件的退化形字面量,
   * string = CEL 简写,信封 = 完整形)". `@objectstack/spec` 17.0.0-rc.6 carries
   * it (objectstack `97e7e3caa`), so the local `| boolean` is no
   * longer a tolerance to declare — it is part of the derived type, and adding
   * it back would restate a spec arm rather than widen anything.
   */
  visible?: SpecActionInput['visible'];
  /** System permissions the caller must ALL hold for the action to be offered
   *  (ADR-0066 D4 UI half — the server enforces the source of truth). */
  requiredPermissions?: SpecActionInput['requiredPermissions'];
  /** Icon name for the rendered control. */
  icon?: SpecActionInput['icon'];
  /** Visual emphasis of the rendered control (`primary`, `danger`, …). */
  variant?: SpecActionInput['variant'];
  /** Sort weight among sibling actions. */
  order?: SpecActionInput['order'];
  /** Which renderer surfaces the action (`action:button`, `action:menu`, …). */
  component?: SpecActionInput['component'];
  /** Object this action is declared against. */
  objectName?: SpecActionInput['objectName'];
  /** AI affordance metadata (tool exposure, prompts). */
  ai?: SpecActionInput['ai'];
  /** Extra properties merged into the request body alongside the collected params. */
  bodyExtra?: SpecActionInput['bodyExtra'];
  /** How collected params are shaped into the request body (`flat` or nested). */
  bodyShape?: SpecActionInput['bodyShape'];
  /**
   * The declarative single-record field write — a parallel key BESIDE `type`,
   * never a member of it.
   *
   * `ActionType` did not gain a member: the spec materializes `type: 'script'`
   * on an `operation: 'update'` action, because the write is performed on the
   * platform action route — `POST /api/v1/actions/{object}/{action}`, the route
   * the registered `script` dispatch already posts — as the CALLER, so the
   * caller's permissions, the object's hooks and its validations all fire as
   * for a user edit. That is why {@link execute} reads this key BEFORE `type`:
   * by the time `type` is consulted an update action is indistinguishable from
   * any other script action, and it would run without the update path's Undo
   * capture and its no-route refusal.
   */
  operation?: SpecActionInput['operation'];
  /**
   * For `operation: 'update'` — static field values written to the current
   * record, merged UNDER the collected `params` so a fixed value can be
   * declared without exposing it in the dialog. The spec refuses it on an
   * action without `operation: 'update'`, where it would be silently dropped.
   *
   * The ROUTE applies it, from the declaration it resolves by name; this
   * runner never sends it (objectui#12941) and reads it only to know which
   * fields an Undo must restore.
   *
   * It is a DECLARATION's key here: a host that dispatches an object's action
   * whole hands it along. No action renderer forwards a page row's own `patch`
   * (objectui#13022, following `@objectstack/spec` 18's retirement of the row
   * key), and the runner reads the host-published declaration ahead of this
   * one (`declaredUpdatePatch`).
   */
  patch?: SpecActionInput['patch'];
  /** Execution mode of the action. */
  mode?: SpecActionInput['mode'];
  /** Field on the record supplying the record id sent to the endpoint. */
  recordIdField?: SpecActionInput['recordIdField'];
  /** Request-parameter name carrying the record id. */
  recordIdParam?: SpecActionInput['recordIdParam'];
  /** Auth/tenancy feature the action requires before it is offered. */
  requiresFeature?: SpecActionInput['requiresFeature'];
  /**
   * Declared post-success navigation — the spec's closed strict
   * `{ navigate, openIn }` block (`ActionSchema.onSuccess`, authorable since
   * `@objectstack/spec` 17.1.0, objectui#5328). Read by `handlePostExecution`
   * → `readOnSuccessNavigation` → `navigateOnSuccess`.
   *
   * This key carried a SECOND, older meaning until objectui#5934: the runner's
   * own chained-callback channel, `ActionDef | ActionDef[]`, dispatched through
   * `executeChain`. The maintainer retired that channel on 2026-08-31 — the
   * spec strict-refuses a callback shape here (`{ type: … }` fails parse with
   * `unrecognized_keys`, so no validated metadata could ever reach it), and the
   * census found zero producers outside the channel's own pins. `onSuccess`
   * now means exactly what the contract declares, nothing else; a callback
   * shape gets NO reading (not a fallback, not an error — the same "a shape
   * the spec refuses gets no new reading here" rule the discrimination branch
   * used to apply, now with nothing left to discriminate). `onFailure`, in the
   * runner-native section above, is untouched: the spec declares no such key,
   * so it has only ever had its one runner-native meaning.
   */
  onSuccess?: SpecActionInput['onSuccess'];
  /**
   * Success copy per handler outcome (`ActionSchema.outcomeMessages`, ruling A
   * on objectstack-ai/cloud#2315): the server answers with a closed `outcome`
   * fact and this map holds the sentence for each, keyed by the snake_case
   * outcome name. Read by `handlePostExecution` → `composeSuccessMessage`, the
   * success toast's FIRST rung: the entry named by the payload's top-level
   * `outcome` (the payload `${result.*}` reads), then {@link successMessage},
   * then the runner's own default text.
   *
   * Derived, so an entry is an `I18nLabel` — a string or an inline per-locale
   * map. The runner composes from strings only: the host's localizer
   * (`useActionTextLocalizer` in `@object-ui/react`) resolves each entry to the
   * active language before dispatch, because the runner has no language.
   */
  outcomeMessages?: SpecActionInput['outcomeMessages'];
  /**
   * @deprecated Retired in `@objectstack/spec` 17 as a `retiredKey()` tombstone —
   * authoring it is a hard parse rejection, so this resolves to `undefined` and
   * assigning a value is a compile error. A HOST may still pass a shortcut
   * explicitly via `ActionEngine.registerAction(action, { shortcut })`; it is
   * only no longer sourced from authored metadata. No replacement key.
   */
  shortcut?: SpecActionInput['shortcut'];
  /**
   * @deprecated Retired in `@objectstack/spec` 17 as a `retiredKey()` tombstone —
   * authoring it is a hard parse rejection, so this resolves to `undefined` and
   * assigning a value is a compile error. Use the list view's `bulkActions` /
   * `bulkActionDefs` instead; `ActionEngine.registerAction(action, { bulkEnabled })`
   * remains available to a HOST passing it explicitly.
   */
  bulkEnabled?: SpecActionInput['bulkEnabled'];
}

/**
 * A handler registered with {@link ActionRunner} — the client-side action
 * dispatch seam: given an authored `ActionDef` and the invocation context,
 * produce an `ActionResult`.
 *
 * NOT the spec's `ActionHandler` (`@objectstack/spec/ui`), whose name this type
 * carried until objectstack#4115. That one is the SERVER-side objectql action
 * handler — a different calling convention entirely (`(ctx) => unknown`, with
 * validated params and a trusted engine facade on `ctx`) and a different
 * execution site.
 *
 * `refuseBeforeInput` is optional. When the handler the runner will dispatch
 * to carries it, the runner asks it BEFORE the confirmation and the param
 * dialog (objectui#13384), with the same context the dispatch will get. An
 * answer refuses the run there: its `error` is toasted, translated through
 * {@link ActionRunner.setTranslator}'s translator when it names an `errorKey`,
 * and nothing is dispatched. `undefined` lets the run go on as before. The
 * server-action handler uses it for its row-count refusal, so a single-record
 * action launched with 0 or several rows selected never opens a dialog only
 * to refuse after Confirm.
 */
export type ActionRunnerHandler = ((
  action: ActionDef,
  context: ActionContext
) => Promise<ActionResult> | ActionResult) & {
  refuseBeforeInput?: (
    action: ActionDef,
    context: ActionContext,
  ) => { error: string; errorKey?: string } | undefined;
};

/**
 * Confirmation handler — replaces window.confirm.
 * Consumers can provide an async implementation (e.g., Shadcn AlertDialog).
 *
 * `options` is LIVE, and its producer is not in this file — searching the
 * runner alone will tell you otherwise. The only call site here passes one
 * argument (the structured `confirm` arm that used to forward a bag was
 * retired, objectui#4314), so a runner-scoped sweep reads this parameter as
 * declared-but-never-produced and files it for removal. That has already
 * happened once: objectui#5205, ruled KEEP on 2026-08-22.
 *
 * The producer bypasses the runner entirely. `handleDeleteView` in
 * `packages/app-shell/src/views/ObjectView.tsx` — the admin "delete saved
 * view" confirmation — invokes a `ConfirmationHandler` with all three fields
 * populated and localized (`console.objectView.deleteViewTitle` / `.delete` /
 * `.cancel`), and `app-shell`'s `ActionConfirmDialog.tsx` renders them in
 * place of its generic `actionConfirm.*` fallbacks. Line numbers are left out
 * on purpose: #5205's pointer had already drifted by the time it was executed.
 * The record delete is a second producer (objectui#11695): `app-shell`'s
 * `useObjectActions` (the list's row and bulk Delete) and `RecordDetailView`
 * (the record page's Delete) hand it `recordDelete.confirmCopy`'s title and
 * confirm label with `destructive: true`, which paints the confirm button in
 * the destructive button style.
 *
 * So re-measure across the repo, not this package: grep for two-argument
 * calls of `ConfirmationHandler`-typed values (`confirmHandler(`, `onConfirm(`)
 * in `app-shell` as well as here. Dropping `options` costs that dialog its
 * title and both button labels, and narrows a published `.d.ts` against the
 * natural `(message, options) => …` spelling — which TypeScript rejects
 * against a one-parameter target unless the second parameter is written
 * optional.
 */
export type ConfirmationHandler = (message: string, options?: {
  title?: string;
  confirmText?: string;
  cancelText?: string;
  /** The confirmed action destroys data: paint the confirm button destructive. */
  destructive?: boolean;
}) => Promise<boolean>;

/**
 * Toast handler — consumers can wire to Sonner or any toast library.
 */
export type ToastHandler = (message: string, options?: {
  type?: 'success' | 'error' | 'info' | 'warning';
  duration?: number;
  /** When set, the toast offers an "Undo" affordance (the runner has already
   *  pushed the operation onto the global UndoManager). */
  undo?: { label?: string };
}) => void;

/**
 * The text the runner writes itself, and so the only text
 * {@link ActionRunner.setTranslator}'s translator is asked for. In each entry
 * `key` names the locale-pack entry (`@object-ui/i18n`'s packs define it) and
 * `defaultValue` is the English source, which is also what shows when no
 * translator is installed.
 *
 * - `completedSuccessfully` — the success toast when the author supplied no
 *   copy for it: no `outcomeMessages` entry for the answer's `outcome` and no
 *   `successMessage` (objectui#10900, objectui#11344).
 * - `failed` — the error toast when the error that reached the toast carries
 *   no readable message, and a parallel chain's result when its last action
 *   rejected (objectui#10969).
 * - `parallelFailed` — a parallel chain's error when no failed action reported
 *   one of its own (objectui#10969).
 * - `undo` — the label the runner hands the toast handler for an undoable
 *   success toast's Undo affordance (objectui#10969).
 *
 * The translator is also asked for one text this table does not hold: a
 * handler's early refusal that names an `errorKey` (`ActionRunnerHandler`'s
 * `refuseBeforeInput`, objectui#13384). Its `error` is the English source.
 *
 * An author's `outcomeMessages` / `successMessage` / `errorMessage` and an
 * action's own error are never in this table: the host localizes authored copy
 * before dispatch, and the runner only fills in their holes (`{{ }}` in
 * `successMessage`, `${result.*}` in `outcomeMessages`).
 */
const RUNNER_TEXT = {
  completedSuccessfully: {
    key: 'actions.completedSuccessfully',
    defaultValue: 'Action completed successfully',
  },
  failed: {
    key: 'actions.failed',
    defaultValue: 'Action failed',
  },
  parallelFailed: {
    key: 'actions.parallelFailed',
    defaultValue: 'One or more parallel actions failed',
  },
  undo: {
    key: 'actions.undo',
    defaultValue: 'Undo',
  },
} as const;

type RunnerText = { readonly key: string; readonly defaultValue: string };

/**
 * Modal handler — consumers provide to render modal dialogs.
 */
export type ModalHandler = (schema: any, context: ActionContext) => Promise<ActionResult>;

/**
 * Navigation handler — consumers provide for SPA-aware routing.
 */
export type NavigationHandler = (url: string, options?: {
  external?: boolean;
  newTab?: boolean;
  replace?: boolean;
}) => void;

/**
 * Param collection handler — consumers provide to show a dialog
 * for collecting ActionParam values before action execution.
 * Returns collected values, or null if cancelled.
 *
 * `interpolate` fills the `${...}` holes of the dialog's authored copy (the
 * action's `description`, each param's `helpText`) in the same template scope
 * the runner reads `confirmText` in — for a row dispatch, the row is `record`
 * (see `templateEvaluatorFor`). The runner cannot fill them itself before the
 * call: the handler localizes that copy AFTER it receives it (a translation
 * bundle entry or an inline per-locale map), so the hole has to be filled on
 * the text the user will actually read (objectui#12967).
 *
 * `run` lets the handler keep its dialog open until the run its values start
 * has an outcome (objectui#13161). Called with the collected values, it
 * dispatches the action with them and resolves with that run's
 * {@link ActionResult} (a dispatch that throws resolves as a refused run, the
 * way `execute` reports one). A refused run has already had its
 * post-execution (the error toast, `onFailure`), so the handler can show the
 * refusal beside the values the user typed and call `run` again with the
 * edited values. A successful run's post-execution (success toast, result
 * dialog, chain, `onSuccess`) waits until the handler settles its promise,
 * so the dialog is closed before any of it shows. A call made while an
 * earlier one is still in flight returns that earlier run, and dispatches
 * nothing new.
 *
 * Once `run` has been called, the handler's own promise only ends the
 * session: the runner never dispatches the values it resolves with. `null`
 * after a refused run is a cancel, reported exactly as a cancel before any
 * run. A handler that never calls `run` keeps the old contract: the runner
 * dispatches once with the values it resolves.
 */
export type ParamCollectionHandler = (
  params: ActionParamDef[],
  action?: ActionDef,
  interpolate?: (text: string) => string,
  run?: (values: Record<string, any>) => Promise<ActionResult>,
) => Promise<Record<string, any> | null>;

/**
 * The contract's own result-dialog block, and one entry of its field list.
 *
 * ⭐ The two interfaces below DERIVE their label members from these instead of
 * restating them, and that is the whole repair of `43c0d1710`: the three
 * label members were hand-written `string` while the producer declares each as
 * `I18nLabel` — a plain string **or** an inline per-locale map, both authorized
 * and neither deprecated — so this mirror refused what the platform accepts
 * while its own docblock claimed the alignment. A hand copy can drift again the
 * moment the contract moves; a derived member makes `tsc` re-check the claim on
 * every build instead of trusting a sentence written once.
 *
 * ⛔ Local, deliberately not exported: the two interfaces below stay the only
 * names this module publishes for the block.
 */
type SpecResultDialog = NonNullable<SpecActionInput['resultDialog']>;
type SpecResultDialogField = NonNullable<SpecResultDialog['fields']>[number];

/**
 * Result dialog spec — declarative description of how to render a
 * one-shot reveal of an action's API response. Mirrors
 * `Action.resultDialog` in @objectstack/spec — derived from it member by
 * member for the labels, so the claim in this sentence is enforced rather
 * than asserted.
 *
 * When set on an action and the action succeeds, the runner suppresses
 * the success toast and awaits a ResultDialogHandler instead. Used for
 * values the user must copy NOW (2FA secret, OAuth client_secret, backup
 * codes).
 */
export interface ResultDialogFieldSpec {
  path: string;
  /**
   * Derived `I18nLabel` — a plain string, or an inline per-locale map. A
   * renderer must RESOLVE it (`resolveI18nLabel` in `@objectstack/spec/ui`)
   * before it reaches the DOM; passed through as-is, the map arm is an object
   * and React refuses an object as a child.
   */
  label?: SpecResultDialogField['label'];
  format?: 'qrcode' | 'code-list' | 'secret' | 'text' | 'json';
}
export interface ResultDialogSpec {
  /** Derived `I18nLabel` — see `ResultDialogFieldSpec.label` on resolving it. */
  title?: SpecResultDialog['title'];
  /** Derived `I18nLabel` — see `ResultDialogFieldSpec.label` on resolving it. */
  description?: SpecResultDialog['description'];
  /** Derived `I18nLabel` — see `ResultDialogFieldSpec.label` on resolving it. */
  acknowledge?: SpecResultDialog['acknowledge'];
  format?: 'qrcode' | 'code-list' | 'secret' | 'text' | 'json';
  fields?: ResultDialogFieldSpec[];
}

/**
 * Result dialog handler — consumers provide to render the post-success
 * reveal dialog. Returns a promise that resolves when the user
 * acknowledges. Errors / rejections are treated as acknowledge for
 * cleanup purposes (the action already succeeded).
 */
export type ResultDialogHandler = (
  spec: ResultDialogSpec,
  data: unknown,
  action?: ActionDef,
) => Promise<void>;

/**
 * One entry of a param's option list, as the RESOLVED param carries it.
 *
 * `label` / `value` are the two keys this layer itself reads and rewrites (i18n
 * translation of the label, value matching). Everything else an option declares
 * rides along in the catch-all and reaches the widgets untouched: per-option
 * `visibleWhen` (the CEL predicate `resolveVisibleOptions()` filters on —
 * ADR-0058 / #2284), `color`, `icon`, `disabled`.
 *
 * The catch-all is deliberate rather than a closed key list (`fbc23e094`).
 * A field's option vocabulary is owned by the field metadata (`@objectstack/spec`'s
 * `SelectOptionSchema`) and read by the option widgets; a param's option list is
 * only a CONDUIT between the two. When this type restated that vocabulary as
 * `{ label, value }`, the resolver dutifully rebuilt every inherited option to
 * match and a field's `visibleWhen` stopped narrowing the dialog's list — the
 * same field metadata behaving two ways on two surfaces. Naming the two keys
 * this layer uses and passing the rest through is what keeps that from
 * recurring; it is NOT an invitation to author new resolved-only option keys
 * (the spec's schema is the authoring gate, and it is `.strict()`).
 */
export type ActionParamOption = {
  label: string;
  value: string;
  [key: string]: unknown;
};

/**
 * ActionParam definition accepted by the runner.
 * Compatible with @objectstack/spec ActionParam.
 *
 * The RESOLVED shape — what `resolveActionParams()` emits and `ActionParamDialog`
 * reads, after a field-backed param's `{ field }` reference has been inlined.
 * The AUTHORING counterpart is `@object-ui/types`' `ActionParam` (objectui#3174).
 *
 * `validation?: string` used to sit here too, and was removed by objectui#3201:
 * no producer ever wrote it (it was never a key of `resolveActionParams()`'s
 * `RawActionParam`, and the runtime field metadata a field-backed param inherits
 * from carries no `validation` either) and no consumer ever read it —
 * `paramToField()` did not map it, so it never reached the field widgets, whose
 * rules `buildValidationRules()` builds from `required` / `minLength` /
 * `maxLength` / `pattern`. Declaring it on the resolved side only invited the
 * authoring side to declare it back.
 */
export interface ActionParamDef {
  name: string;
  label: string;
  type: string;
  required?: boolean;
  options?: ActionParamOption[];
  defaultValue?: unknown;
  helpText?: string;
  placeholder?: string;
  /**
   * Visibility predicate (CEL) evaluated against the same scope as action
   * `visible` (`current_user` / `data` / `features` — ⛔ not `app`, unbound by
   * objectui#8155). When it evaluates
   * false the param dialog omits this param — used to hide a param the backend
   * only accepts under an opt-in capability (e.g. `create_user.phoneNumber`
   * gated on `features.phoneNumber`). Absent = always visible.
   */
  visible?: string;
  /**
   * Carry-over declaration — `@objectstack/spec`'s `ActionParamSchema.carryOver`
   * (the 2026-08-25 ruling whose spec half is objectstack `0e4e51b0a`,
   * objectui#6246), passed through unchanged by
   * `resolveActionParams()`. The param's value is carried through the dialog
   * rather than collected from the user: seeded from the row (the spec refuses
   * the key without `defaultFromRow: true`), rendered by `ActionParamDialog` as
   * a collapsed read-only summary with no editing affordance, and submitted
   * verbatim.
   *
   * ⛔ Not a styling hint. The permission-set Clone action declares it on its
   * JSON permission facets because an editable facet lets a hand-edited but
   * valid blob clone a set that grants MORE than its base; a renderer that
   * merely greys the control out still offers that edit.
   */
  carryOver?: boolean;

  // ── Widget config (shared form field-widget renderer) ─────────────
  // `ActionParamDialog` renders every param through the same field widgets
  // the object form uses (ADR-0059), so params carry the widget-relevant
  // config for their type. Mirrors `ActionParamSchema` in @objectstack/spec.
  /** Accepted upload types (MIME types / extensions) for `file`/`image` params. */
  accept?: string[];
  /** Max upload size in bytes for `file`/`image` params. */
  maxSize?: number;
  /** Allow multiple values (file/image/lookup/user params → array value). */
  multiple?: boolean;

  // ── Lookup-/reference-type metadata ───────────────────────────────
  // Populated by `resolveActionParams()` when a field-backed param resolves
  // to a `lookup` or `reference` field. Forwarded to `<LookupField>` inside
  // `ActionParamDialog` so the user gets a real record picker (popover +
  // RecordPickerDialog) instead of a plain text input.
  /** Object name the lookup picker queries (`reference` on the field). */
  referenceTo?: string;
  /** Field on the referenced record used as the human label (default `name`). */
  displayField?: string;
  /** Field used as the option value (default `id`). */
  idField?: string;
  /** Optional secondary line shown under the label in the picker. */
  descriptionField?: string;
  /** Template (e.g. `{first_name} {last_name}`) used to build the label. */
  titleFormat?: string;
  /** Column definitions surfaced in the enterprise `RecordPickerDialog`. */
  lookupColumns?: unknown[];
  /** Server-side filters applied when querying lookup candidates. */
  lookupFilters?: unknown[];
  /** Page size for the typeahead popover. */
  lookupPageSize?: number;
  /** Form-field dependencies that gate / parameterise the picker query. */
  dependsOn?: unknown[];

  // ── Resolution failure ────────────────────────────────────────────
  /**
   * Set by `resolveActionParams()` when a FIELD-BACKED param (`{ field }`)
   * named a field that is not in the object metadata the resolver was given,
   * carrying `<object>.<field>` — the pair that could not be resolved.
   *
   * It exists because the alternative is a SILENT one. Without it the resolver
   * hands back `type: param.type ?? 'text'`, and every downstream reader of the
   * degradation is blind to it: the param is a `text` param by then, so
   * `paramDegradesWithoutTarget()` answers false, `paramToField()` emits no
   * "no reference target" warning, and the objectstack-ai/objectstack#3405 "paste a record id" hints do
   * not apply either. A lookup param that should have rendered a record picker
   * renders an unannotated empty box instead — no options, no dropdown, and no
   * request for the referenced object on the wire, because no picker was ever
   * built (`6cc910b6d`).
   *
   * ⛔ It is not a widget config key and `paramToField()` deliberately does not
   * map it: the whole point is that the param's type is UNKNOWN, so there is no
   * widget to configure. `ActionParamDialog` reads it and refuses.
   */
  unresolvedField?: string;
}

/**
 * Bind the server-CEL-parity `os.user` identity alias into an action context
 * (#2358 trap 1). `@objectstack/spec` documents the canonical CEL identity
 * scope as `os.user.*` (server formula / validation / sharing), while client
 * contexts historically only bound `user`. Deriving the alias here means an
 * action `visible` predicate authored as `os.user.role == "admin"` evaluates
 * identically on client and server instead of throwing (and being fail-closed
 * hidden). `os.user` always tracks `context.user`; other consumer-provided
 * keys under `os` are preserved.
 */
function withIdentityAlias(context: ActionContext): ActionContext {
  const user = context.user;
  if (user === undefined) return context;
  const os = context.os;
  if (os && typeof os === 'object' && os.user === user) return context;
  return { ...context, os: { ...(os && typeof os === 'object' ? os : {}), user } };
}

/**
 * The query param naming the record a form route opens (`?recordId=<id>`).
 *
 * The console's reserved-param registry (`@object-ui/app-shell`,
 * `src/urlParams.ts` → `RECORD_DRAWER_PARAM`) owns this spelling and
 * `apps/console`'s `FormPage` re-declares it as `FORM_RECORD_ID_PARAM`. It is a
 * literal in all three places because `@object-ui/core` sits BELOW both in the
 * dependency graph and cannot import either; the console's `FormPage.test.ts`
 * pins the spellings equal so they cannot drift apart in silence.
 */
const FORM_RECORD_ID_PARAM = 'recordId';

/**
 * The query param carrying the OBJECT the forwarded {@link FORM_RECORD_ID_PARAM}
 * belongs to (objectui#4292).
 *
 * It is an ASSERTION, never an override: the form's object always comes from the
 * FormView metadata, and this param exists solely so the consumer can refuse
 * when the two disagree. (The registry's `formObject` is the other thing — it
 * SELECTS which object the record-form overlay edits. Same `<param>Object`
 * naming, deliberately opposite powers, which is why they are separate names on
 * separate surfaces.) Widening it into a selector would hand any hand-authored
 * URL the ability to point a form at an arbitrary object — the hole this closes,
 * re-opened from the other side.
 */
const FORM_RECORD_OBJECT_PARAM = 'recordObject';

/**
 * The object the firing context's record belongs to, or `undefined` when the
 * host did not say (objectui#4292).
 *
 * `context.objectName` is MEASURED to be this repo's one spelling of that fact,
 * not a new convention invented here:
 *
 *  - `@object-ui/react`'s `ActionProvider` documents the flat trio `record`,
 *    `user`, `objectName` and mirrors it into the canonical `ctx.*` scope;
 *  - `useConsoleActionRuntime` seeds `context: { ...(objectName ? { objectName }
 *    : {}), … }` — so every console surface that fires a record action
 *    (`DeclaredActionsBar`, `ObjectView`, `RecordDetailView`) already publishes
 *    it, and `RecordDetailView` passes it explicitly a second time;
 *  - `app-shell`'s `recordFormNavigation` resolver already reads exactly this
 *    key as its last precedence step for `navigate_create` / `navigate_edit`.
 *
 * `action.objectName` is deliberately NOT consulted. It declares which object an
 * ACTION belongs to, which is a statement about the action's placement, not
 * about the record the id was read from — and trusting metadata about the action
 * to describe the record is precisely the conflation that made this defect
 * possible.
 */
function readContextObjectName(context: ActionContext): string | undefined {
  const name = context.objectName;
  return typeof name === 'string' && name.trim() !== '' ? name.trim() : undefined;
}

/**
 * The field definitions the host published for `objectName`, or `undefined`
 * (objectui#11122).
 *
 * A host publishes `objectFields` BESIDE `objectName` (`useConsoleActionRuntime`
 * and `RecordDetailView` both do), so the pair names one object and its fields.
 * They are answered only for THAT object: an action that retargets another
 * object (a related-list row on the record page carries the child's
 * `objectName`) gets no field map rather than the host object's, because
 * reading one object's field types against another object's row would decide
 * which of its fields are relations by the wrong schema.
 */
function readContextObjectFields(context: ActionContext, objectName: string): FieldContainerLike {
  if (readContextObjectName(context) !== objectName) return undefined;
  const fields: unknown = context.objectFields;
  return fields && typeof fields === 'object' ? (fields as FieldContainerLike) : undefined;
}

/**
 * The declared actions the host published for `objectName`, or `undefined`
 * (objectui#13022).
 *
 * A host publishes `objectActions` (the object's `actions` list, the
 * declarations the platform action route resolves an action's `name` against)
 * beside `objectName` and `objectFields`; `useConsoleActionRuntime` and
 * `RecordDetailView` both do. Answered only for THAT object, for the reason
 * {@link readContextObjectFields} gives: a dispatch that retargets another
 * object names a declaration this list does not hold.
 */
function readContextObjectActions(
  context: ActionContext,
  objectName: string | undefined,
): readonly unknown[] | undefined {
  if (!objectName || readContextObjectName(context) !== objectName) return undefined;
  const actions: unknown = context.objectActions;
  return Array.isArray(actions) ? actions : undefined;
}

/** A `patch` as the route reads one: a plain object's own members, else none. */
function patchMembers(patch: unknown): Record<string, unknown> {
  return patch && typeof patch === 'object' && !Array.isArray(patch)
    ? { ...(patch as Record<string, unknown>) }
    : {};
}

/**
 * The static values the platform action route writes for an
 * `operation: 'update'` dispatch: the `patch` of the DECLARATION the action's
 * `name` names (objectui#13022).
 *
 * The route resolves that declaration by the dispatch's object and the
 * action's `name`, and writes its `patch` under the params it is sent
 * (`declarativeUpdateWrite`). A page action row's own `patch` is never that
 * write: `@objectstack/spec` 18 retires the key on `action:button`,
 * `action:icon` and the `action:group` / `action:menu` member, and none of
 * those renderers forwards it. So the declaration is read from one of two
 * places, and no third:
 *
 *  1. The declarations the host published for the dispatch's object
 *     ({@link readContextObjectActions}), when they name this action: the
 *     lookup the route performs. A declaration with no `patch` writes the
 *     collected params alone.
 *  2. Otherwise the def itself. A host that dispatches an object's action whole
 *     (`ObjectGrid`'s rows, `DeclaredActionsBar`, `RelatedRecordActionsBridge`,
 *     `page:header`) hands the runner the declaration, `patch` included. A page
 *     row reaches the runner through a renderer, which forwards no `patch`, so
 *     this reads nothing for one.
 *
 * Read for the Undo snapshot only; ⛔ never sent (objectui#12941).
 */
function declaredUpdatePatch(
  action: ActionDef,
  context: ActionContext,
  objectName: string | undefined,
): Record<string, unknown> {
  const name = typeof action.name === 'string' && action.name !== '' ? action.name : undefined;
  const declared = name === undefined
    ? undefined
    : readContextObjectActions(context, objectName)?.find(
      (candidate) =>
        !!candidate && typeof candidate === 'object' && (candidate as { name?: unknown }).name === name,
    );
  return patchMembers(declared ? (declared as { patch?: unknown }).patch : action.patch);
}

/**
 * Whether opening FormView `viewName` from a record of `contextObject` would
 * cross an object boundary (objectui#4292).
 *
 * View identity is `<object>.<key>` (ADR-0017; `viewEnvelope` builds exactly
 * that, `defaultListViewId` compares exactly this way), so the question is
 * answered as a PREFIX match against the object we already hold rather than by
 * parsing an object name out of the view name — the target's object is a fact
 * the metadata owns, and this runner only asks whether it is the one in hand.
 *
 * Answers `false` — "not comparable, carry on" — whenever either end is missing:
 * no `contextObject` (host published none), or an unqualified `viewName` (no
 * dot, so it names no object). Only a qualified name under a DIFFERENT object
 * is a boundary crossing.
 */
function crossesObjectBoundary(viewName: string, contextObject: string | undefined): boolean {
  if (!contextObject) return false;
  if (!viewName.includes('.')) return false;
  return !viewName.startsWith(`${contextObject}.`);
}

/**
 * Is this the declarative single-record field write?
 *
 * Asks the AUTHORED key, not `type`: the spec materializes `type: 'script'`
 * here and refuses every other explicit spelling, so `type` cannot answer the
 * question — see the dispatch comment in {@link ActionRunner.execute}.
 *
 * `'update'` is the only member the spec declares (`'delete'` and `'custom'`
 * have no row-level form), and an unrecognized spelling is a parse rejection
 * upstream. This reads the ONE member rather than "any truthy `operation`" so a
 * future member cannot silently inherit the update write path — the dispatch
 * table's own guard reasoning, applied to this key.
 */
function isUpdateOperationAction(action: ActionDef): boolean {
  return action.operation === 'update';
}

/**
 * The row a dispatch carries — the clicked row a row surface stashes under
 * `params._rowRecord` — or `undefined` when it carries none. The record its
 * copy templates bind as `record` (see `ActionRunner.templateEvaluatorFor`).
 */
function dispatchRow(action: ActionDef): Record<string, unknown> | undefined {
  const params = action.params;
  const row = params && typeof params === 'object' && !Array.isArray(params)
    ? (params as Record<string, unknown>)._rowRecord
    : undefined;
  return row && typeof row === 'object' && !Array.isArray(row) ? row as Record<string, unknown> : undefined;
}

/**
 * Whether the action declares its own success copy, read the way
 * `composeSuccessMessage` reads its `successMessage` rung: a non-empty string,
 * or a `template` envelope whose `source` is one (objectui#13367). A
 * navigation toasts only then (objectui#12755).
 */
function declaresSuccessMessage(action: ActionDef): boolean {
  const text = actionCopySource(action.successMessage);
  return text !== undefined && text.trim() !== '';
}

/**
 * The fields an `operation: 'update'` action writes, and their prior values.
 *
 * `undoable` promises to restore EXACTLY the fields the action wrote, so the
 * captured set is the effective payload — `patch` merged under the collected
 * `params` — and never `patch` alone: a param-collected field left out of the
 * capture would make Undo restore SOME of the edit and report a full one, which
 * is worse than offering no Undo at all.
 *
 * Prior values come from the row record the invoking surface stashed under
 * `params._rowRecord` (the same client-side stash the record-id dance reads).
 * A field the row carries as `null` is captured as `null`: it was empty, and
 * clearing it back to empty is what restoring it means on the data plane.
 *
 * ⛔ A field the row does not CARRY is never captured as `null`
 * (objectui#10404). Absent is not empty: a list row is projected by `$select`,
 * and a written field no column shows is missing from the row while the server
 * holds a real value for it. Recording `null` there made Undo write `null` over
 * the value it existed to restore. The list harvest (`listViewPredicates`) now
 * asks for the written fields of an `undoable` action, so a projected row
 * carries them; this is the backstop for the ones it cannot ask for (a field
 * the object does not declare or the principal may not read, a row no harvest
 * shaped). "Carries" means an own key whose value is not `undefined`: JSON
 * cannot send `undefined`, so such a value says nothing about what is stored.
 *
 * Answers `undefined` when any written field is not carried, and the caller
 * then offers no Undo at all. Capturing only the carried fields is not an
 * option, for the reason above: a partial restore reported as a full one is
 * worse than no Undo.
 *
 * ⛔ A relation's prior value is its STORED id, never the record `$expand`
 * put in its place (objectui#11122). Surfaces read rows with `$expand` on the
 * relations they show (a grid, its visible and grouping columns; the record
 * page, every relation the reader may read), and the server replaces the id
 * in place with the related record. Copied verbatim, that record became the
 * Undo value and Undo wrote it into the reference slot, which stores an id:
 * refused under a strict value-shape posture, stored as corruption under the
 * lenient one. So each carried value goes through `toPredicateRecord`, the one
 * rule that binds a fetched record the way the server stores it: a field the
 * object DECLARES relational (`EXPANDABLE_FIELD_TYPES`, the set that decides
 * what is expanded in the first place) collapses to its id, element-wise for a
 * `multiple` relation, and every other field is left exactly as the row
 * carries it. It is read from `fields`, never from the value's shape: a `json`
 * field may hold an object with an `id`, and that object is its stored value.
 *
 * `fields` is the written object's field definitions (`objectSchema.fields`,
 * either served shape), and it is REQUIRED so that a caller without them has
 * to say so: `undefined` collapses nothing, because a caller that cannot name
 * the relations must not guess them.
 *
 * Exported (objectui#11082) because it is THE rule, not this runner's: every
 * surface that builds an `update` Undo snapshot itself calls it rather than
 * restating it. Today that is the console runtime's `api` handler
 * (`useConsoleActionRuntime`) and the record page's own `api` handler
 * (`RecordDetailView`), which reads prior values off the page's loaded record;
 * that record lacks a written field when field-level security hides it from
 * the reader. To name the fields that blocked a capture, ask per field:
 * `captureUpdateUndoData([field], rowRecord, fields) === undefined`.
 */
export function captureUpdateUndoData(
  writtenFields: readonly string[],
  rowRecord: Record<string, unknown>,
  fields: FieldContainerLike,
): Record<string, unknown> | undefined {
  if (!writtenFields.every((field) => rowCarries(rowRecord, field))) return undefined;
  const stored = toPredicateRecord(rowRecord, fields);
  return Object.fromEntries(writtenFields.map((field) => [field, stored[field]]));
}

/** Whether the row CARRIES `field`: an own key whose value is not `undefined`. */
function rowCarries(rowRecord: Record<string, unknown>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(rowRecord, field) && rowRecord[field] !== undefined;
}

/*
 * ## The two predicate gates in `execute`, and the one question they ask first
 *
 * `execute` gates on `condition` and on `disabled`, and both need ONE question
 * answered before evaluating — "is a gate DECLARED here, i.e. is there a
 * condition to reach a verdict on?" — for OPPOSITE reasons, which is exactly why
 * the question has to be asked separately from the verdict:
 *
 *   - `disabled` (objectui#3848): an EMPTY predicate must not be handed to
 *     `evaluateCondition`, whose answer for "no condition" is `true` = BLOCKED.
 *     Measured consequence of asking `!= null && !== false` instead:
 *     `disabled: ''` returned `{ success: false, error: 'Action is disabled' }`
 *     and the handler never ran.
 *   - `condition` (objectui#3872): a DECLARED-FALSE predicate must not be
 *     skipped by a truthiness test. `if (action.condition)` never asked whether
 *     a gate was declared, so `condition: false` — the most explicit "never
 *     execute" an author can write — landed on `if (false)`, the evaluator was
 *     never consulted, and the action RAN. Measured on `origin/main` @
 *     `2937bcf7d`: `condition: false` → `{"success":true}`, handler ran, while
 *     the semantically identical `{ dialect: 'cel', source: 'false' }` was
 *     refused. Asking "declared?" routes `false` to `evaluateCondition`, which
 *     short-circuits booleans (`if (typeof condition === 'boolean') return
 *     condition`) and blocks.
 *
 * Both read {@link hasDeclaredPredicate} — the repo's one definition of that
 * question, in `evaluator/declaredPredicate.ts` beside the normalizer it is
 * derived from, with the scope objectui#3850 ruled on (`''` / whitespace-only /
 * empty-`source` envelope are NOT declared; a declared `false` IS) and the
 * third state objectui#11358 added (a present value with no evaluable `source`
 * — `0`, `{}`, an array, an `ast`-only envelope — IS declared, and faults).
 * This gate arrived here first as a module-private helper with a
 * scope note saying it stayed private until that ruling landed; it has, so the
 * definition moved down a layer and the renderer side reads the same one
 * (`components/renderers/action/visibility-gate.ts` re-exports it as
 * `hasDeclaredVisibilityGate`, `SchemaRenderer`'s `disabled` chain calls it).
 *
 * ## Why the gates normalize to DECIDE but evaluate the RAW value
 *
 * Historically the two were not interchangeable for a string already spelled as
 * a `${…}` template: `toPredicateInput` assumed a bare expression and wrapped
 * unconditionally, so `'${x}'` became `'${${x}}'`, which no longer matched the
 * single-template fast path and did not parse — leaving a constant verdict whose
 * direction was set by the caller's error policy (fail-soft got the unparsed
 * string back, `Boolean(…)` = `true`; fail-closed got a throw). On `disabled`
 * that meant "always blocked", on `condition` the opposite ("always execute").
 * That defect was objectui#3871, fixed at the normalizer: an already-`${…}`
 * string is returned untouched, the normalizer is idempotent, and
 * `evaluateCondition(toPredicateInput(raw))` agrees with
 * `evaluateCondition(raw)` on every shape these gates accept.
 *
 * The gates still read the raw value. Nothing forces the change now that the two
 * agree, and it would be churn on the execution path rather than a fix — but the
 * reason has shifted from "must" to "no reason to", so the equality is pinned
 * next to each gate's suite (`ActionRunner.disabledGate.test.ts` /
 * `ActionRunner.conditionGate.test.ts`, the two cases that replaced the
 * objectui#3871 tripwires) instead of being assumed. Every non-empty shape —
 * boolean, bare CEL, `${…}` template, `{ dialect, source }` envelope — keeps the
 * verdict it reaches today.
 *
 * The `visible`-filter template in `ActionEngine.getActionsForLocation` used to
 * be the one place this scope was NOT shared: its non-predicate branch kept a
 * historical `Boolean(raw)` coercion, so `0` there meant "hidden" — fail-CLOSED
 * on junk, the opposite of what this module committed to for `disabled`
 * (`catch { isDisabled = false }`). That filter now reads
 * {@link hasDeclaredPredicate} too (objectui#3957), so the two entries answer
 * a value that is not a predicate at all the same way. Since objectui#11358
 * that answer is "declared, and faulting" rather than "no gate": `0` / `{}` /
 * an `ast`-only envelope reach `evaluateCondition`, which reports them and
 * answers its fail-soft `true` — so `disabled` refuses the action (its closed
 * direction, as for any faulting `disabled`) and `condition` lets it run (the
 * direction a faulting `condition` has always taken), and the engine filter
 * hides it (`throwOnError`). Pinned in `ActionRunner.disabledGate.test.ts` /
 * `ActionRunner.conditionGate.test.ts`.
 */

export class ActionRunner {
  private handlers = new Map<string, ActionRunnerHandler>();
  private scripts = new Map<string, ActionRunnerHandler>();
  private evaluator: ExpressionEvaluator;
  private context: ActionContext;
  private confirmHandler: ConfirmationHandler;
  private toastHandler: ToastHandler | null;
  private modalHandler: ModalHandler | null;
  private navigationHandler: NavigationHandler | null;
  private paramCollectionHandler: ParamCollectionHandler | null;
  private resultDialogHandler: ResultDialogHandler | null;
  private translate: ((key: string, options: { defaultValue: string }) => string) | null;

  /**
   * Built-in dispatch, one entry per runnable action type.
   *
   * A table rather than a `switch` because the type annotation is the guard:
   * `Record<RunnableActionType, …>` stops compiling the moment
   * `@objectstack/spec` adds an `ActionType` this runner has no executor for.
   * That is the whole Tier-2 failure class for actions — a spec name that
   * validates at save and then does nothing at run time (#2942) — converted
   * into a build error. It also rejects the reverse: an executor keyed by a
   * name that is neither in the spec nor a declared local alias.
   *
   * `navigation` is that declared alias (see `ObjectUiLocalActionType`); it
   * shares `url`'s navigator.
   */
  private readonly builtinExecutors: Record<
    RunnableActionType,
    (action: ActionDef) => Promise<ActionResult>
  > = {
    script: (action) => this.executeScript(action),
    url: (action) => this.executeUrl(action),
    modal: (action) => this.executeModal(action),
    flow: (action) => this.executeFlow(action),
    api: (action) => this.executeAPI(action),
    form: (action) => this.executeForm(action),
    navigation: (action) => this.executeNavigation(action),
  };

  constructor(context: ActionContext = {}) {
    this.context = withIdentityAlias(context);
    this.evaluator = new ExpressionEvaluator(this.context);
    // Default confirmation: window.confirm (can be overridden)
    this.confirmHandler = async (message: string) => window.confirm(message);
    this.toastHandler = null;
    this.modalHandler = null;
    this.navigationHandler = null;
    this.paramCollectionHandler = null;
    this.resultDialogHandler = null;
    this.translate = null;
  }

  /**
   * Set the translator for the text the runner supplies itself — the host's
   * `t`, injected so this package takes no i18n dependency. That text is the
   * `RUNNER_TEXT` table in this file: the generic success toast shown when an
   * action declares neither an `outcomeMessages` entry for the answer nor a
   * `successMessage`, the error fallbacks when no readable error message
   * reached the runner, and the Undo label of an undoable success toast. An
   * author's `outcomeMessages` / `successMessage` / `errorMessage` and an
   * action's own error never go through this translator: the host localizes
   * authored copy before dispatch. The one handler text it does translate is
   * an early refusal that names its key (`ActionRunnerHandler`'s
   * `refuseBeforeInput`). With no translator the text stays English.
   */
  setTranslator(translate: (key: string, options: { defaultValue: string }) => string): void {
    this.translate = translate;
  }

  /**
   * Set a custom confirmation handler (e.g., Shadcn AlertDialog).
   */
  setConfirmHandler(handler: ConfirmationHandler): void {
    this.confirmHandler = handler;
  }

  /**
   * Set a custom toast handler (e.g., Sonner).
   */
  setToastHandler(handler: ToastHandler): void {
    this.toastHandler = handler;
  }

  /**
   * Set a modal handler (e.g., render a Dialog via React state).
   */
  setModalHandler(handler: ModalHandler): void {
    this.modalHandler = handler;
  }

  /**
   * Set a navigation handler (e.g., React Router navigate).
   */
  setNavigationHandler(handler: NavigationHandler): void {
    this.navigationHandler = handler;
  }

  /**
   * Set a param collection handler — shows a dialog to collect
   * ActionParam values before action execution.
   */
  setParamCollectionHandler(handler: ParamCollectionHandler): void {
    this.paramCollectionHandler = handler;
  }

  /**
   * Set a result dialog handler — shows a one-shot reveal dialog after
   * a successful action whose spec declares `resultDialog`. Used for
   * values the user must copy now (2FA codes, OAuth client_secret).
   */
  setResultDialogHandler(handler: ResultDialogHandler): void {
    this.resultDialogHandler = handler;
  }

  registerHandler(actionName: string, handler: ActionRunnerHandler): void {
    this.handlers.set(actionName, handler);
  }

  unregisterHandler(actionName: string): void {
    this.handlers.delete(actionName);
  }

  /**
   * Register a named script handler. When a `script` action's
   * `target`/`execute` matches the registered name, the handler runs
   * instead of the expression evaluator. Lets dashboards/views wire
   * symbolic action names (e.g. 'export_dashboard_pdf') to JS callbacks.
   */
  registerScript(scriptName: string, handler: ActionRunnerHandler): void {
    this.scripts.set(scriptName, handler);
  }

  unregisterScript(scriptName: string): void {
    this.scripts.delete(scriptName);
  }

  /**
   * Run `action`; with `callContext`, run it against that context for this
   * one dispatch (objectui#13063).
   *
   * The runner's context names the PAGE: its `record` and its `objectName`.
   * A dispatch that runs against some other record, such as a related-list
   * row on a record page, which is a record of the CHILD object, hands that
   * record here as `{ record, objectName }`. Every executor then reads it as
   * the record the action runs against, the way a dispatch from that record's
   * own page does: `executeForm` forwards its id and object, and its
   * boundary check compares the target view against the child object instead
   * of the page's.
   *
   * The runner's own context is not touched: the dispatch runs on a one-shot
   * runner over the merged context that shares this runner's handlers (see
   * {@link ActionRunner.scopedTo}).
   */
  async execute(action: ActionDef, callContext?: Partial<ActionContext>): Promise<ActionResult> {
    if (callContext) return this.scopedTo(callContext).execute(action);
    try {
      // `ActionDef` accepts any key of any type, so a typo (`targt`) and a
      // retired key (`execute`) both reach here having type-checked. Neither
      // binds a handler, and binding no handler silently is the objectstack-ai/objectstack#2169 "Mark Done
      // does nothing" shape. Dev-only, warn-once, changes nothing (objectstack-ai/objectstack#4075 step 1).
      warnOnUnknownActionKeys(action);

      // The compat window for the object-form `params` payload (objectstack-ai/objectstack#5777, maintainer
      // ruling 2026-08-06 direction A). Checked HERE, before the param-collection
      // block below rewrites `action.params` into a values map — after that point
      // an action that authored a legitimate ActionParam[] DEFINITION array also
      // carries an object under `params`, and the warning could no longer tell the
      // two apart. Dev-only, warn-once, changes nothing.
      warnOnDeprecatedObjectParams(action);

      // Resolve the action type
      const actionType = action.type || action.actionType || action.name || '';

      // Conditional execution. Ask "is a `condition` gate DECLARED?" — not "is
      // the raw value truthy?" (objectui#3872). Truthiness cannot answer that
      // question, and on this key it answered it in the OVER-PERMISSIVE
      // direction: `condition: false` (the most explicit "never execute" an
      // author can write, and what a template that switches an action off
      // emits) fell on `if (false)`, so the evaluator was never consulted and
      // the action executed anyway — while the semantically identical
      // `{ dialect: 'cel', source: 'false' }` was refused. `evaluateCondition`
      // short-circuits booleans, so once the gate asks the right question the
      // verdict needs no boolean branch of its own. See `hasDeclaredPredicate`
      // for the shared "declared?" scope (objectui#3850) and for why the verdict
      // still reads the RAW value (`toPredicateInput` used to double-wrap an
      // already-`${…}` string into a constant verdict — objectui#3871, fixed at
      // the normalizer; on THIS key that constant meant "always execute").
      if (hasDeclaredPredicate(action.condition)) {
        const shouldExecute = this.evaluator.evaluateCondition(action.condition);
        if (!shouldExecute) {
          return { success: false, error: 'Action condition not met' };
        }
      }

      // Ask "is a `disabled` gate DECLARED?" — not "is the key present and not
      // `false`?" (objectui#3848). The old test let every EMPTY predicate reach
      // `evaluateCondition`, whose answer for "no condition" is `true`, which on
      // this key means BLOCKED: `disabled: ''` / `'   '` /
      // `{ dialect: 'cel', source: '' }` all returned `Action is disabled` with
      // the handler never invoked. See `hasDeclaredPredicate` above for why the
      // gate normalizes to decide while the verdict below reads the RAW value
      // (historically load-bearing: `toPredicateInput` double-wrapped an
      // already-`${…}` string — objectui#3871, now fixed, so the two agree).
      if (hasDeclaredPredicate(action.disabled)) {
        // `disabled` may be a boolean, a CEL string, or the normalized envelope
        // `{ dialect, source }` (what `objectstack build` emits). The previous
        // code only evaluated the STRING form and treated any object as truthy,
        // so an envelope-disabled action was ALWAYS "disabled" — silently
        // blocking every execution (param dialog never opened, handler never
        // ran). `evaluateCondition` already handles boolean/string/envelope.
        //
        // A predicate that FAULTS — an unbound root, a misspelled field,
        // `current_user.can(…)` before the permissions payload has loaded — does
        // NOT reach the `catch` below: `evaluateCondition` handles its own
        // faults and answers its fail-soft `true`, which on this key means
        // DISABLED, so the action is refused ("Action is disabled"). That is the
        // closed direction every `disabled` leg takes (objectui#11212,
        // objectui#11242). The `catch` only covers a throw from outside that
        // fault handling, and leaves such an action not disabled.
        let isDisabled = false;
        try {
          isDisabled = this.evaluator.evaluateCondition(action.disabled as never);
        } catch {
          isDisabled = false;
        }
        if (isDisabled) {
          return { success: false, error: 'Action is disabled' };
        }
      }

      // The handler's early refusal (objectui#13384), asked before the
      // confirmation and the param dialog below. A run the handler would
      // refuse for its context — a single-record action launched with 0 or
      // several rows selected — is refused here, with the toast and the
      // post-execution the dispatch-time refusal gets, and before the user
      // has typed anything or anything is sent.
      const refusal = this.refusalBeforeInput(action, actionType);
      if (refusal !== undefined) {
        const refused: ActionResult = { success: false, error: refusal };
        await this.handlePostExecution(action, refused);
        return refused;
      }

      // Confirmation. One spelling: `confirmText` — the only one the
      // translation bundle can address (`…._actions.{name}.confirmText`). The
      // structured `confirm.message` read that used to OUTRANK it is retired
      // (objectui#4314): it had zero producers and no bundle key, so a dialog
      // authored that way silently lost localization.
      //
      // Its `{{ }}` holes read the dispatch's record (`dispatchRecord`), not
      // the runner's context alone: a row dispatch binds no `record` there, so
      // a hole the record header fills was shown raw from a list row
      // (objectui#12967).
      const confirmMessage = this.confirmMessage(action);
      if (confirmMessage !== undefined) {
        const confirmed = await this.confirmHandler(confirmMessage);
        if (!confirmed) {
          return { success: false, error: 'Action cancelled by user' };
        }
      }

      // Param collection: if the action defines ActionParam[] to collect,
      // show a dialog to gather user input before executing.
      // Spec defines this as `params: ActionParam[]`; ActionRunner historically
      // used `actionParams` to disambiguate from the static-params object that
      // some custom handlers consume. Accept both — when `params` is an array,
      // treat it as the input-collection definition.
      const paramDefs: ActionParamDef[] | undefined =
        action.actionParams && Array.isArray(action.actionParams) ? action.actionParams
          : (Array.isArray(action.params) ? (action.params as unknown as ActionParamDef[]) : undefined);
      if (paramDefs && paramDefs.length > 0) {
        if (this.paramCollectionHandler) {
          // Merge collected params into action.params as a values map for downstream consumers.
          // Preserve any pre-attached row context (`_rowRecord`) used by list_item
          // actions so downstream handlers (apiHandler) can inject the row id.
          // Read ONCE, before any run: a second `run` after a refusal merges
          // its values over the same base, not over the first run's values.
          const priorParams: Record<string, any> = Array.isArray(action.params) ? {} : (action.params as Record<string, any> || {});
          const rowRecord = priorParams._rowRecord;
          const applyCollected = (collected: Record<string, any>) => {
            action.params = { ...priorParams, ...collected };
            if (rowRecord !== undefined) (action.params as Record<string, any>)._rowRecord = rowRecord;
          };
          const cancelled: ActionResult = { success: false, error: 'Action cancelled by user (params)' };

          // The handler-driven session (objectui#13161) — see `ParamCollectionHandler`.
          // The dialog that collected the values stays open until it hears
          // how the run went, so a refusal lands beside what the user typed
          // instead of on a closed dialog.
          let lastRun: Promise<ActionResult> | undefined;
          let inFlight = false;
          const run = (values: Record<string, any>): Promise<ActionResult> => {
            if (inFlight && lastRun) return lastRun;
            inFlight = true;
            lastRun = (async () => {
              try {
                let attempt: ActionResult;
                try {
                  applyCollected(values);
                  attempt = await this.dispatchCollected(action, actionType);
                } catch (error) {
                  // A dispatch that throws is a refused run, exactly as the
                  // `catch` at the end of `execute` reports one.
                  attempt = { success: false, error: (error as Error).message };
                }
                // A refused attempt gets its post-execution now, as a lone run
                // would; a successful one waits for the session to end below.
                if (!attempt.success) await this.handlePostExecution(action, attempt);
                return attempt;
              } finally {
                inFlight = false;
              }
            })();
            return lastRun;
          };

          // The dialog's `description` / `helpText` read the dispatch's record
          // as `record`: a row dispatch binds none in the runner's context
          // (objectui#12967).
          const templates = this.templateEvaluatorFor(action);
          const collected = await this.paramCollectionHandler(
            paramDefs,
            action,
            (text: string) => String(templates.evaluate(text) ?? ''),
            run,
          );
          if (lastRun) {
            const last = await lastRun;
            if (last.success) {
              await this.handlePostExecution(action, last);
              return last;
            }
            return collected === null ? cancelled : last;
          }
          if (collected === null) {
            return cancelled;
          }
          applyCollected(collected);
        }
      }

      const result = await this.dispatchCollected(action, actionType);
      await this.handlePostExecution(action, result);
      return result;
    } catch (error) {
      const result: ActionResult = { success: false, error: (error as Error).message };
      await this.handlePostExecution(action, result);
      return result;
    }
  }

  /**
   * Dispatch an action whose params are collected, and answer what it
   * returned — WITHOUT post-execution, which each caller runs itself:
   * `execute` right after a lone run, and the param-collection session
   * (`ParamCollectionHandler`'s `run`, objectui#13161) once per refused attempt
   * and once for the successful one when the session ends.
   */
  private async dispatchCollected(action: ActionDef, actionType: string): Promise<ActionResult> {
      // ── `operation` is read BEFORE `type`, and this is the only order that
      // can work ────────────────────────────────────────────────────────────
      //
      // `operation: 'update'` is a PARALLEL key beside `type`, not a member of
      // it: `@objectstack/spec` materializes `type: 'script'` on such an action
      // (the platform action route is the script type's own route) and refuses
      // any other explicit `type`. `ActionType` therefore did not gain a
      // member, which is why `builtinExecutors` — a `Record<RunnableActionType,
      // …>` — still compiles unchanged across the bump that added this key.
      //
      // The cost of that design is paid here: by the time `actionType` is
      // consulted, an update action is indistinguishable from every other
      // script action. Dispatched on `type` it would reach the registered
      // `script` handler as a plain script action: the route still writes the
      // declared `patch` (it applies it from the declaration, never from the
      // request — objectui#12941), but no Undo snapshot of the written fields
      // would be taken, and with no `script` handler registered the action
      // would end at `executeScript`'s "No script provided" instead of the
      // update path's refusal naming the remedy. Worse, a row rehydrated from
      // `sys_metadata` UNPARSED (objectui#3903) carries no materialized `type`
      // at all, so `actionType` falls back to the action's NAME, matches no
      // executor, and the action lands in `executeActionSchema`, reported on
      // and never run. Reading `operation` first is what makes all of those
      // impossible.
      if (isUpdateOperationAction(action)) {
        return this.executeUpdateOperation(action);
      }

      // Check for a registered custom handler first
      if (actionType && this.handlers.has(actionType)) {
        const handler = this.handlers.get(actionType)!;
        return handler(action, this.context);
      }

      // Built-in action execution by type.
      const builtin = actionType
        ? this.builtinExecutors[actionType as RunnableActionType]
        : undefined;

      if (builtin) {
        return builtin(action);
      } else if (action.navigate) {
        // Legacy fallback: check for navigate, api, or onClick
        return this.executeNavigation(action);
      } else if (action.api || action.endpoint) {
        return this.executeAPI(action);
      } else if (action.onClick) {
        await action.onClick();
        return { success: true };
      }
      return this.executeActionSchema(action);
  }

  /**
   * Execute multiple actions in sequence or parallel.
   */
  async executeChain(
    actions: ActionDef[],
    mode: 'sequential' | 'parallel' = 'sequential'
  ): Promise<ActionResult> {
    if (actions.length === 0) {
      return { success: true };
    }

    if (mode === 'parallel') {
      const results = await Promise.allSettled(
        actions.map(a => this.execute(a))
      );
      const failures = results.filter(
        r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success)
      );
      if (failures.length > 0) {
        const firstFail = results.find(
          r => r.status === 'fulfilled' && !r.value.success
        ) as PromiseFulfilledResult<ActionResult> | undefined;
        return {
          success: false,
          error: firstFail?.value?.error || this.runnerText(RUNNER_TEXT.parallelFailed),
        };
      }
      const lastResult = results[results.length - 1];
      return lastResult.status === 'fulfilled'
        ? lastResult.value
        : { success: false, error: this.runnerText(RUNNER_TEXT.failed) };
    }

    // Sequential execution — stop on first failure
    let lastResult: ActionResult = { success: true };
    for (const action of actions) {
      lastResult = await this.execute(action);
      if (!lastResult.success) {
        return lastResult;
      }
    }
    return lastResult;
  }

  /**
   * The early refusal of the handler {@link dispatchCollected} would route
   * this action to, in the translator's language when it names a key —
   * `undefined` when there is none. An update-operation action never reaches
   * a registered handler, so it is never asked.
   */
  private refusalBeforeInput(action: ActionDef, actionType: string): string | undefined {
    if (isUpdateOperationAction(action)) return undefined;
    const handler = actionType ? this.handlers.get(actionType) : undefined;
    const refusal = handler?.refuseBeforeInput?.(action, this.context);
    if (!refusal?.error) return undefined;
    return refusal.errorKey
      ? this.runnerText({ key: refusal.errorKey, defaultValue: refusal.error })
      : refusal.error;
  }

  /**
   * One entry of `RUNNER_TEXT` (or a handler's keyed early refusal), in the
   * installed translator's language. An
   * empty answer from the translator falls back to the English source rather
   * than raising an empty toast or an empty label.
   */
  private runnerText({ key, defaultValue }: RunnerText): string {
    return this.translate?.(key, { defaultValue }) || defaultValue;
  }

  /**
   * The success toast's text, by the contract's three rungs
   * (`ActionSchema.outcomeMessages`, objectui#11344):
   *
   * 1. `outcomeMessages[outcome]`, where `outcome` is the top-level `outcome`
   *    of the handler's return value — the payload `${result.*}` reads, so it
   *    is the same fact an author writes as `${result.outcome}`;
   * 2. `successMessage`;
   * 3. the runner's own default text, in its translator's language.
   *
   * Rungs 1 and 2 are the author's copy. Both arrive already localized — the
   * host's localizer resolves the bundle entry or the inline `I18nLabel` map
   * before dispatch — and both read the same payload,
   * `readActionPayload(result.data)`, as `result`.
   *
   * Rung 1 has its `${result.*}` tokens filled in here, through the one token
   * grammar and scope `onSuccess.navigate` reads (`substituteScopeTokens`).
   * Only the sink differs: a toast is text, so a value is inserted as-is, where
   * a URL position percent-encodes it.
   *
   * Rung 2 is a `template` slot (objectui#13367, the renderer half of
   * objectstack#24814): a string or the `{ dialect: 'template', source }`
   * envelope. A sentence with a `{{ }}` hole is filled by the template engine
   * over `result` and `record` (the record the action ran against). A
   * sentence with none is shown as written: the transitional `${result.*}`
   * reading it kept is gone (objectui#13476), and objectstack's publish gate
   * refuses a `${…}` token in this copy.
   *
   * ⛔ `result.data.message` is not a rung. It used to outrank both rungs of
   * author copy, which put whatever language the server happened to write in
   * front of the user's locale; the contract names no server-message rung, and
   * an author who wants the server's sentence can still write
   * `{{ result.message }}` as the copy.
   *
   * A rung counts only when it is a non-empty string (for rung 2, or an
   * envelope whose `source` is one). An `I18nLabel` map that
   * reached the runner without passing through a localizer has no language to
   * resolve against here, so it is skipped rather than handed to the toast as
   * an object — the React #31 crash the error branch below guards against.
   */
  private composeSuccessMessage(action: ActionDef, result: ActionResult): string {
    const payload = readActionPayload(result.data);
    const outcome = payload && typeof payload === 'object'
      ? (payload as { outcome?: unknown }).outcome
      : undefined;
    const outcomeMessages = action.outcomeMessages;
    const outcomeCopy = typeof outcome === 'string'
      && outcomeMessages && typeof outcomeMessages === 'object'
      && Object.prototype.hasOwnProperty.call(outcomeMessages, outcome)
      ? (outcomeMessages as Record<string, unknown>)[outcome]
      : undefined;
    if (typeof outcomeCopy === 'string' && outcomeCopy.trim() !== '') {
      return substituteScopeTokens(outcomeCopy, { result: payload }, (value) => value);
    }
    const successCopy = actionCopySource(action.successMessage);
    if (successCopy !== undefined && successCopy.trim() !== '') {
      return hasTemplateHoles(successCopy)
        ? fillTemplateHoles(successCopy, { result: payload, record: this.dispatchRecord(action) })
        : successCopy;
    }
    return this.runnerText(RUNNER_TEXT.completedSuccessfully);
  }

  /**
   * The confirm dialog's body, or `undefined` when the action asks for no
   * confirmation (objectui#13367).
   *
   * `confirmText` is a string or the `template` envelope. A sentence with a
   * `{{ }}` hole is filled by the template engine over two roots: `record` —
   * the record the action runs against, the same one `templateEvaluatorFor`
   * binds — and `params`, the action's static params object when it has one
   * (the dialog's collected values do not exist yet: the confirmation comes
   * first). A sentence with no `{{ }}` hole is shown as written: a `${…}`
   * token in it is text, not an expression (objectui#13476 retired the
   * transitional `${…}` reading; objectstack's publish gate refuses the token).
   *
   * A declared value that carries no text — an envelope with no string
   * `source` — still gates the run: the author declared a confirmation, and
   * dropping it would let a destructive action run unasked. The dialog then
   * shows no body text, never the object, which as a React child crashes the
   * page. Every answer is a string for the same reason.
   */
  private confirmMessage(action: ActionDef): string | undefined {
    const declared: unknown = action.confirmText;
    if (!declared) return undefined;
    const text = actionCopySource(declared);
    if (text === undefined) return '';
    if (!hasTemplateHoles(text)) return text;
    const params = action.params;
    const staticParams = params && typeof params === 'object' && !Array.isArray(params)
      ? Object.fromEntries(Object.entries(params).filter(([key]) => key !== '_rowRecord'))
      : undefined;
    return fillTemplateHoles(text, { record: this.dispatchRecord(action), params: staticParams });
  }

  /**
   * The record a dispatch runs against, for its copy templates: the row the
   * dispatch carries (`params._rowRecord`), else the context's record — the
   * one rule `templateEvaluatorFor` applies (objectui#12967).
   */
  private dispatchRecord(action: ActionDef): unknown {
    return dispatchRow(action) ?? this.context.record;
  }

  /**
   * Post-execution: emit toast notifications, handle chaining, callbacks.
   */
  private async handlePostExecution(action: ActionDef, result: ActionResult): Promise<void> {
    // resultDialog SUPPRESSES the successMessage toast — these are one-shot
    // reveals (2FA codes, fresh OAuth secrets) where a toast would let the
    // user dismiss the value before copying it. The reveal dialog itself
    // requires explicit acknowledgement; we await it here so refreshAfter
    // / chain steps don't fire until the user closes the dialog.
    const hasResultDialog = !!(action.resultDialog && result.success);

    // Toast notifications
    if (this.toastHandler) {
      const showToast = action.toast ?? { showOnSuccess: true, showOnError: true };
      const duration = action.toast?.duration;

      if (result.success && !hasResultDialog && !result.silent && showToast.showOnSuccess !== false) {
        // The server returns FACTS and the console writes the sentence
        // (ruling A on objectstack-ai/cloud#2315) — see `composeSuccessMessage`.
        const message = this.composeSuccessMessage(action, result);
        // Undoable action: register the captured operation on the global
        // UndoManager and surface an "Undo" affordance on the toast (the
        // consumer's toast handler wires the button to UndoManager). The
        // button's label is the runner's own text, so it is translated here
        // rather than left to each handler's English default (objectui#10969).
        if (result.undo) {
          try { globalUndoManager.push(result.undo); } catch { /* non-fatal */ }
        }
        this.toastHandler(message, {
          type: 'success',
          duration,
          undo: result.undo ? { label: this.runnerText(RUNNER_TEXT.undo) } : undefined,
        });
      }

      if (!result.success && showToast.showOnError !== false && result.error) {
        // `result.error` is typed as a string, but a handler bug can leak an
        // error OBJECT (e.g. the ObjectStack `{ code, message }` envelope)
        // through here — and a non-string toast payload is rendered as a React
        // child, crashing the page (React #31). Coerce defensively at this
        // single sink so no handler can take the whole page down.
        // An authored `errorMessage` is shown as written — a string, or the
        // `template` envelope's `source` (objectui#13367); no scope is declared
        // for its holes yet. An envelope with no text falls to the error.
        const authored = actionCopySource(action.errorMessage);
        const raw: unknown = authored || result.error;
        const message = typeof raw === 'string'
          ? raw
          : (raw && typeof (raw as { message?: unknown }).message === 'string')
            ? (raw as { message: string }).message
            : this.runnerText(RUNNER_TEXT.failed);
        this.toastHandler(message, { type: 'error', duration });
      }
    }

    // Open the reveal dialog. If no handler is registered we still mark the
    // execution successful but log — better to lose the value visibility
    // than to silently re-toast and dismiss it.
    if (hasResultDialog) {
      if (this.resultDialogHandler) {
        try {
          await this.resultDialogHandler(action.resultDialog!, result.data, action);
        } catch (err) {
          // Acknowledgement failure is non-fatal; the underlying action already
          // succeeded. Log so consumers can wire it through their error reporter.
          console.warn('[ActionRunner] resultDialog handler rejected; treating as acknowledged', err);
        }
      } else {
        console.warn(
          '[ActionRunner] action.resultDialog set but no resultDialogHandler registered — the response value will not be shown to the user.',
          { action: action.name, data: result.data }
        );
      }
    }

    // Apply refreshAfter from UIActionSchema
    if (action.refreshAfter && result.success) {
      result.reload = true;
    }

    // Execute chained actions
    if (action.chain && action.chain.length > 0 && result.success) {
      const chainResult = await this.executeChain(
        action.chain,
        action.chainMode || 'sequential'
      );
      // Merge chain result
      if (!chainResult.success) {
        result.success = false;
        result.error = chainResult.error;
      }
      if (chainResult.data) result.data = chainResult.data;
      if (chainResult.redirect) result.redirect = chainResult.redirect;
      if (chainResult.reload) result.reload = true;
    }

    // ── ActionSchema.onSuccess — post-success navigation ────────────────────
    //
    // `053fdc8f9`, the console half of objectstack#9566/#9474. The spec
    // declares `onSuccess` as a CLOSED STRICT object
    // `{ navigate: string, openIn: 'self' | 'newTab' }`, refine-scoped to
    // `type: 'api'` and `type: 'script'` — the two types whose success event
    // carries a server response for `${result.*}` to read.
    //
    // That declared meaning is the key's ONLY meaning. The runner's older
    // chained-callback channel (`onSuccess?: ActionDef | ActionDef[]`,
    // dispatched through `executeChain`) was retired by objectui#5934
    // (maintainer ruling 2026-08-31): the spec strict-refuses a callback shape
    // at parse, so no validated metadata could ever reach it, and the census
    // found zero producers outside the channel's own pins.
    //
    // `readOnSuccessNavigation` stays as the shape guard, not as a
    // discriminator: stored rows are rehydrated UNPARSED (objectstack-ai/objectstack#3903), so the value
    // is still read as data, and a shape the spec refuses gets no reading —
    // no navigation, no callback dispatch, no lenient fallback.
    if (result.success && action.onSuccess) {
      const navigation = readOnSuccessNavigation(action.onSuccess);
      if (navigation) {
        this.navigateOnSuccess(navigation, action, result);
      }
    }
    if (!result.success && action.onFailure) {
      const callbacks = Array.isArray(action.onFailure) ? action.onFailure : [action.onFailure];
      await this.executeChain(callbacks, 'sequential');
    }
  }

  /**
   * Perform the `ActionSchema.onSuccess` hop for an action that just succeeded.
   *
   * **The router is the app's own.** `navigationHandler` is the seam every
   * navigator in this file already goes through, and the console wires it to
   * react-router's `navigate` — so `openIn: 'self'` is a real SPA route hop,
   * in place, immune to popup blocking. No `window.location` / `window.open`
   * mechanism is introduced here; the no-handler fallback is the same
   * `result.redirect` hand-off `navigateTo` already uses. The one exception is
   * shared with `navigateTo`: a `mailto:` target is not a route, so it is a
   * full-page navigation in place (objectui#12191).
   *
   * **No default is written here.** `openIn` is a materialised
   * `.default('self')` in the spec, so parse output always carries a resolved
   * member; this reads the ONE member that changes the branch and leaves the
   * other implicit. A `?? 'self'` would be a second source of truth for a
   * default the producer already resolved.
   *
   * **The two `openIn` spellings never cross.** This reads
   * `onSuccess.openIn` (`'self' | 'newTab'`) and nothing else — never the
   * top-level `type: 'url'` switch, which spells its new-tab member
   * `'new-tab'`. Spec refuses each crossover spelling with a keyed error; a
   * renderer that accepted either would be a second, looser contract than the
   * one authors are validated against.
   */
  private navigateOnSuccess(
    block: OnSuccessNavigation,
    action: ActionDef,
    result: ActionResult,
  ): void {
    // `${result.*}` reads the HANDLER's return value, one level below the
    // action envelope — the same level `readActionPayload` hands the
    // `redirectUrl` convention. Reading `result.data` raw would see the
    // `{ success, data }` envelope on pre-objectstack#3962 servers, which is
    // the "one level too shallow" bug (#2904) in a new place.
    const url = this.interpolateTarget(block.navigate, action, readActionPayload(result.data));

    // `navigate` is author-supplied metadata and lands in a URL position, so
    // it goes through the same scheme guard as every other navigator here.
    const kind = classifyNavigationTarget(url);
    if (kind === null) {
      console.warn(
        `[ActionRunner] onSuccess.navigate resolved to a URL this runner refuses to open — no navigation performed. ${NAVIGATION_TARGET_REFUSAL}`,
        { action: action.name, navigate: block.navigate, resolved: url },
      );
      return;
    }
    // `mailto:` hands off to the mail client in place, whatever `openIn` says,
    // and never through the host's router (see `navigateTo`).
    if (kind === 'mail') {
      window.location.href = url;
      return;
    }

    const newTab = block.openIn === 'newTab';
    // Same external-URL convention `navigateTo` hands the handler; `newTab`
    // stays the declared choice alone, never `?? isExternal`.
    const external = kind === 'web';

    if (this.navigationHandler) {
      this.navigationHandler(url, { external, newTab });
      return;
    }
    if (newTab) {
      window.open(url, '_blank', 'noopener,noreferrer');
    } else {
      result.redirect = url;
    }
  }

  /**
   * `operation: 'update'` — the declarative single-record field write.
   *
   * ## The write is the ROUTE's, never this client's
   *
   * This method composes a request and hands it to the registered `script`
   * dispatch; it does not touch a `DataSource`. That is a security boundary,
   * not an implementation preference. `POST /api/v1/actions/{object}/{action}`
   * runs the write AS THE CALLER — the caller's permissions, the object's hooks
   * and its validations all fire as for a user edit — while a client-side
   * `dataSource.update()` reaches the data plane having consulted none of them.
   * The spec says the same thing from its end by refusing `target`, `body`,
   * `method` and `bodyExtra` beside this key and pinning `type` to `'script'`:
   * there is exactly one execution surface for an update action, and it is the
   * route.
   *
   * Consequently, a consumer that has registered NO server-action dispatch gets
   * a loud refusal naming the remedy. The two silent alternatives were both
   * available and both wrong: falling through to `executeScript` ends at "No
   * script provided" (an update action declares no `target` — the author is
   * sent hunting for a field they were right not to write), and falling through
   * to `executeActionSchema` reports on an action that never ran.
   *
   * ## `patch` is the route's: it never rides on the wire (objectui#12941)
   *
   * The request carries the values collected for the action's declared
   * `params`, plus the transport keys the dispatch reads (`recordId`, and the
   * `_rowRecord` stash it strips before POSTing) — and NOTHING from `patch`.
   * The route applies the declared `patch` itself, from the declaration it
   * resolves by the action's name (`@objectstack/runtime`'s
   * `declarativeUpdateWrite`, which writes `{ ...patch, ...params }`). The
   * patch keys are not params the action declares, so posting them makes every
   * declarative-update button a request carrying undeclared params — the very
   * request the ADR-0104 D2 param contract refuses (objectstack#24268). A
   * client copy of `patch` on the wire also adds nothing: the server never
   * reads it.
   *
   * The spec's words for the merge the route performs: static field values
   * "merged UNDER the user-supplied `params` so a fixed value can be declared
   * without exposing it in the dialog". So a collected param of the same name
   * WINS — the author declared a default, and the user answered it. This
   * runner still computes that same merge, but only to know what the route
   * WROTE, which is what an Undo snapshot must cover; it is never sent.
   *
   * ## The `patch` in that merge is the DECLARATION's (objectui#13022)
   *
   * The route writes the `patch` of the declaration the action's `name` names,
   * so that is the `patch` the snapshot covers: read by
   * {@link declaredUpdatePatch} from the declarations the host published, else
   * off a def that is the declaration itself. A page action row's own `patch`
   * is never written (`@objectstack/spec` 18 retires it) and never covered.
   */
  private async executeUpdateOperation(action: ActionDef): Promise<ActionResult> {
    const dispatch = this.handlers.get('script');
    if (!dispatch) {
      return {
        success: false,
        error:
          'An `operation: "update"` action is written by the platform action route, which this ' +
          'client runner cannot reach: no `script` handler is registered. The write is never ' +
          'performed client-side — a direct data-plane update bypasses the route\'s permission ' +
          'floor, the object\'s hooks and its validations. Register a handler that POSTs to ' +
          '/api/v1/actions/{object}/{action} — build one with createServerActionHandler from ' +
          '@object-ui/core.',
      };
    }

    const collected: Record<string, unknown> = (action.params && !Array.isArray(action.params))
      ? { ...(action.params as Record<string, unknown>) }
      : {};
    // The object the write lands on: the action's own, else the host's.
    const objectName = action.objectName || readContextObjectName(this.context);
    // What the route WRITES: the DECLARATION's `patch` UNDER the collected
    // params, the route's own merge (see the doc above), never a page row's
    // own `patch` (objectui#13022). Read for the Undo snapshot only — ⛔ never
    // the request: the route applies `patch` from its declaration.
    const patch = declaredUpdatePatch(action, this.context, objectName);
    const written = { ...patch, ...collected };

    // The row stash and the record selector are transport mechanics, not
    // written fields: the dispatch strips `_rowRecord` before POSTing and reads
    // `recordId` as the record's address.
    const rowRecord = (collected._rowRecord && typeof collected._rowRecord === 'object')
      ? (collected._rowRecord as Record<string, unknown>)
      : undefined;
    const writtenFields = Object.keys(written).filter((k) => k !== '_rowRecord' && k !== 'recordId');

    // What the request CARRIES: the collected values alone, as a copy of its
    // own so a dispatch that edits its bag cannot reach the reads below.
    const wire = { ...collected };
    const result = await dispatch({ ...action, params: wire }, this.context);

    // A refusal is returned exactly as the dispatch reported it. The route's
    // envelope rule (`interpretActionResponse`) has already turned a 4xx/5xx
    // AND a 200-with-`success:false` business rejection into `error`, and
    // `handlePostExecution` surfaces that as the failure toast. Re-labelling it
    // here, or answering success because the POST itself completed, is the
    // objectui#2960 shape this branch exists to prevent.
    if (!result.success) return result;

    // Undo: prior values of exactly the fields this action wrote. Needs a row
    // record to read them from — without one there is nothing to restore, so
    // the affordance is correctly not offered rather than offered empty. The
    // same holds when the row lacks a written field (objectui#10404): no Undo,
    // never one that writes `null` over the stored value. A relation the row
    // carries expanded is captured as its stored id, read against the field
    // map the host published for this object (objectui#11122).
    if (action.undoable && rowRecord && writtenFields.length > 0) {
      const recordId = collected.recordId ?? rowRecord.id;
      if (objectName && recordId != null) {
        const undoData = captureUpdateUndoData(
          writtenFields,
          rowRecord,
          readContextObjectFields(this.context, objectName),
        );
        if (undoData) {
          result.undo = {
            id: `undo-${objectName}-${String(recordId)}-${Date.now()}`,
            type: 'update',
            objectName,
            recordId: String(recordId),
            timestamp: Date.now(),
            // objectui#11080 — no English verb here. The toast that reports the
            // Undo / Redo already says which one it is, from a pack key, so an
            // action that declared no label is named by the object it acted on.
            description: action.label || objectName,
            undoData,
            redoData: Object.fromEntries(writtenFields.map((k) => [k, written[k]])),
          };
        } else {
          // The success toast then carries no Undo button, which is how the
          // user learns this one cannot be undone; this names the cause for
          // the author.
          console.warn(
            '[ActionRunner] `undoable` update succeeded but offers no Undo: the row it ran on does not '
            + 'carry every field it wrote, so their prior values are unknown and an Undo would overwrite '
            + 'stored data. A list row carries a written field when the object declares it and the '
            + 'principal may read it.',
            { action: action.name, missing: writtenFields.filter((k) => !rowCarries(rowRecord, k)) },
          );
        }
      }
    }

    return result;
  }

  /**
   * Execute script action — evaluates client-side expression via ExpressionEvaluator.
   * Supports ${} template expressions referencing data, record, user context.
   */
  private async executeScript(action: ActionDef): Promise<ActionResult> {
    // `target` is the only handler slot. The `execute` alias was removed in
    // @objectstack/spec 17 (objectstack-ai/objectstack#3855), which rejects an authored `execute` at parse
    // with the rename prescription — so parsed metadata cannot carry it and a
    // `target || execute` fallback could only ever evaluate to `target` (objectstack-ai/objectstack#3856).
    const script = action.target;
    if (!script) {
      // A spec `body` IS a script — this runner just cannot run one (see the
      // `body` field docs). Saying "no script provided" would send the author
      // hunting for a missing field they actually wrote, so name the real
      // cause and the remedy instead. Checked before the retired `execute` key:
      // a `body` action ignores `target`, so "rename it" would be wrong advice.
      if (action.body != null) {
        return {
          success: false,
          error:
            'Action body must be executed server-side — this client runner does not interpret ' +
            '`body` (sandboxed JS needs an isolated VM; expression bodies use the formula engine). ' +
            'Register a `script` handler that POSTs to /api/v1/actions/{object}/{action} — ' +
            'build one with createServerActionHandler from @object-ui/core.',
        };
      }
      // Read off an UNTYPED view of the action on purpose, and this branch
      // survives step 3 on purpose (objectstack#4075).
      //
      // `ActionDef` no longer declares `execute` — nor any open index signature
      // — so `tsc` now catches the retired key at every site that AUTHORS an
      // action literal in code. That is the half of the problem the type can
      // reach. It is not this half: objectstack-ai/objectstack#3903 established that stored
      // `sys_metadata` rows are rehydrated UNPARSED, so metadata written before
      // spec 17 arrives here as a plain object the compiler never saw, still
      // carrying `execute`. Declaring the key to make this read compile would
      // re-legitimize a tombstone (objectstack-ai/objectstack#3855 removed it; the spec keeps it only to
      // reject it BY NAME), and deleting the branch would send those rows back
      // to a bare "no script provided" — which reads as "you forgot a field" to
      // an author who did write one, the objectstack#2169 shape.
      //
      // So: the cast is the honest spelling of "a key this type deliberately
      // does not have, read from a row this type never validated".
      const retiredExecute = (action as Record<string, unknown>).execute;
      if (typeof retiredExecute === 'string') {
        return {
          success: false,
          error:
            '`execute` was removed in @objectstack/spec 17 — rename the key to `target`. ' +
            'The value (a script name or expression) is unchanged. ' +
            'Run `os migrate meta --from 16` to rewrite it automatically.',
        };
      }
      return { success: false, error: 'No script provided for script action' };
    }

    // Named script registry wins over the expression evaluator. This lets
    // dashboards/views bind a symbolic action name (e.g. 'export_dashboard_pdf')
    // to a JS callback without piping the literal through ExpressionEvaluator.
    const named = this.scripts.get(script);
    if (named) {
      try {
        return await named(action, this.context);
      } catch (error) {
        return { success: false, error: `Script execution failed: ${(error as Error).message}` };
      }
    }

    try {
      let result = this.evaluator.evaluate(`\${${script}}`);
      // The expression itself is synchronous, but a formula function it calls
      // may kick off an async write and return a Promise. Await it so the
      // caller's success/failure — and the post-execution toast — reflects
      // whether that write actually completed, not just that we called it.
      if (result != null && typeof (result as any).then === 'function') {
        result = await result;
      }
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: `Script execution failed: ${(error as Error).message}` };
    }
  }

  /**
   * Execute URL action — navigate to a URL.
   * Uses navigationHandler for SPA routing, falls back to window.location.
   */
  private async executeUrl(action: ActionDef): Promise<ActionResult> {
    const rawUrl = action.target || action.redirect;
    if (!rawUrl) {
      return { success: false, error: 'No URL provided for url action' };
    }
    return this.announceNavigation(action, await this.navigateTo(action, rawUrl, action));
  }

  /**
   * A navigation announces nothing unless its action declares the copy
   * (objectui#12755).
   *
   * `type: 'url'`, its `navigation` alias and `type: 'form'` only change the
   * route: nothing was written, so there is nothing to confirm. Their
   * `{ success: true }` used to reach `handlePostExecution` like a write's, and
   * the generic `completedSuccessfully` toast ("操作已成功完成") told the user an
   * operation had completed when a page had merely opened (objectstack-ai/cloud#2909:
   * an "invite member" button that only navigated read as "invitation sent").
   *
   * The result keeps `success: true` (callers read it as "the navigation
   * happened") and is marked `silent`, the flag that already means "no success
   * toast for this result". An author who wants a toast after the navigation
   * declares `successMessage`, and that copy still shows: the declaration is the
   * only signal, so there is no separate switch to forget.
   */
  private announceNavigation(action: ActionDef, result: ActionResult): ActionResult {
    if (!result.success || declaresSuccessMessage(action)) return result;
    return { ...result, silent: true };
  }

  /**
   * The one navigator behind `type: 'url'` and its `navigation` alias.
   *
   * Both names mean "go to a location", and they had two implementations that
   * drifted: only this one interpolated `${param.X}`, promoted `/api/…` to the
   * `apiBase`, short-circuited a redirect-dance URL to a full-page load, and
   * honoured `openIn`. A `navigation` action was quietly the weaker of the two
   * (#2944 item 3). Sharing the body is what keeps the alias honest.
   *
   * `action` supplies the interpolation context (`params`) and `openIn`;
   * `source` supplies the navigation modifiers, which live on the nested
   * `action.navigate` block for the legacy shape and on the action itself
   * otherwise.
   */
  private async navigateTo(
    action: ActionDef,
    rawUrl: unknown,
    source: ActionDef,
  ): Promise<ActionResult> {
    // Apply target ${param.X} / ${ctx.X} interpolation FIRST — the
    // ExpressionEvaluator that follows would otherwise see unresolved
    // `param.provider` and either error or substitute undefined. Doing it
    // here also URL-encodes values (required for query-position params
    // like `?provider=foo+bar`).
    const interpolated = this.interpolateTarget(rawUrl as string, action);
    let url = this.evaluator.evaluate(interpolated) as string;

    const kind = classifyNavigationTarget(url);
    if (kind === null) {
      return { success: false, error: NAVIGATION_TARGET_REFUSAL };
    }

    // A `mailto:` target opens the mail client IN PLACE (objectui#12191): it
    // never opens a new tab, so `openIn` is not consulted. It does not go to
    // the host's navigation handler either. The console's handler opens every
    // `external` URL in a new tab and hands the rest to react-router, which
    // resolves `mailto:a@b.com` as a path under the current route. So this is
    // a full-page navigation here, the same mechanism as the `/api/` case below.
    if (kind === 'mail') {
      window.location.href = url;
      return { success: true };
    }

    // Promote same-origin-style `/api/...` paths to absolute when an
    // `apiBase` is provided in context (typical of split SPA + backend
    // dev setups). Without this, `window.location.href = "/api/..."`
    // hits the SPA host (e.g. Vite at :5173), the router has no match,
    // and the browser silently falls back to the home page instead of
    // following better-auth's 302 to the IdP.
    const apiBase = typeof this.context.apiBase === 'string' ? this.context.apiBase.replace(/\/+$/, '') : '';
    if (apiBase && /^\/(api|_auth|_account)\//.test(url)) {
      url = `${apiBase}${url}`;
    }

    // `source.external` is the `navigation` shape's explicit override; the
    // scheme heuristic covers every other case.
    const isExternal =
      Boolean(source.external) || classifyNavigationTarget(url) === 'web';
    // Same-origin API endpoints (most commonly the auth provider's
    // `/api/v1/auth/sign-in/social` redirect dance) issue server-side
    // 302s that must be followed by the *browser*, not the SPA router.
    // Pushing `/api/...` into React Router lands on no matching route
    // and silently falls back to the default page, so the OAuth flow
    // never starts. Short-circuit to a full-page navigation here.
    // For absolute URLs (now also produced by the apiBase prefix above),
    // we need full-page navigation for any URL that is going to issue a
    // server-side redirect dance — better-auth's `/sign-in/social` is the
    // canonical case. Detect "looks like a same-origin API path" both for
    // bare-relative input AND for the apiBase-prefixed form.
    const isApiCall = /\/(api|_auth|_account)\//.test(url) && (isExternal || url.startsWith('/'));
    if (isApiCall) {
      window.location.href = url;
      return { success: true };
    }
    // `openIn` is the first-class, declarative switch (ActionSchema.openIn);
    // it wins over the legacy `navigate.newTab` escape hatch and the
    // external-URL heuristic.
    //
    // `params.newTab` used to sit between them and is RETIRED (objectui#4097,
    // executing the objectstack#6828 maintainer ruling of 2026-08-10). It could
    // only ever fire on an OBJECT-form `params`, which the spec has always
    // refused on an action (`params` is `z.array(ActionParamSchema)`), so no
    // validated stack could reach it; and no internal caller synthesizes a
    // navigation directive into that bag — the runtime value bags carry
    // collected dialog values, `_selectedIds` and `_rowRecord`, never `newTab`.
    // Removing it also closes the collision hazard where a params dialog
    // declaring a field literally named `newTab` would have had the user's own
    // input silently steer navigation. The spec's refusal message names the
    // sanctioned spelling: `openIn: 'new-tab'`.
    const openIn = source.openIn ?? action.openIn;
    const newTab =
      openIn === 'new-tab' ? true
        : openIn === 'self' ? false
          : (source.newTab ?? isExternal);

    // History semantics, the one thing the `navigation` shape carries that
    // `ActionSchema` has no field for. Omitted from the handler call when
    // unset so hosts see the same options object they always did.
    const replace = source.replace ?? action.replace;

    if (this.navigationHandler) {
      this.navigationHandler(url, {
        external: isExternal,
        newTab,
        ...(replace === undefined ? {} : { replace: Boolean(replace) }),
      });
      return { success: true };
    }

    if (newTab) {
      window.open(url, '_blank', 'noopener,noreferrer');
    } else {
      return { success: true, redirect: url };
    }

    return { success: true };
  }

  /**
   * Execute modal action — open a dialog.
   * Delegates to the registered modalHandler; returns modal schema if no handler.
   */
  private async executeModal(action: ActionDef): Promise<ActionResult> {
    const modalSchema = action.modal || action.target || action.params?.schema;
    if (!modalSchema) {
      return { success: false, error: 'No modal schema or target provided for modal action' };
    }

    if (this.modalHandler) {
      return await this.modalHandler(modalSchema, this.context);
    }

    // Return the modal schema for the consumer to render
    return { success: true, modal: modalSchema };
  }

  /**
   * Execute flow action — trigger a workflow/automation.
   * Delegates to a registered 'flow' handler; otherwise returns not-implemented.
   */
  private async executeFlow(action: ActionDef): Promise<ActionResult> {
    const flowName = action.target || action.name;
    if (!flowName) {
      return { success: false, error: 'No flow target provided for flow action' };
    }

    // Check for a registered flow handler (consumers register via registerHandler)
    if (this.handlers.has('flow')) {
      const handler = this.handlers.get('flow')!;
      return await handler(action, this.context);
    }

    return {
      success: false,
      error: `Flow handler not registered. Cannot execute flow: ${flowName}`,
    };
  }

  /**
   * Terminal fallback for a dispatch the switch above did not recognize: no
   * known `type`, no registered handler, no `navigate` / `api` / `endpoint` /
   * `onClick`. Some schema-only shapes are still runnable here — an action
   * whose whole payload is a `redirect`, or an explicit `reload` / `close`
   * directive — so this stays a real execution path.
   *
   * What it must never do is report success for an action it did not run. It
   * used to return `{ success: true, reload: true, close: true }` for a
   * COMPLETELY EMPTY schema, which is how a legacy string row action —
   * dispatched as `{ type: '<action name>' }`, the name landing in the `type`
   * slot — reached the user as a green "Action completed successfully" toast
   * having issued zero requests (objectui#2960). An unresolvable dispatch is a
   * wiring bug; surface it instead of laundering it into a success.
   */
  private async executeActionSchema(action: ActionDef): Promise<ActionResult> {
    const hasApi = !!(action.api || action.endpoint);
    // `reload`/`close` default to true downstream, so only an EXPLICIT `true`
    // counts as declared intent — otherwise every empty schema would look like
    // it asked for a reload and slip back through this guard.
    const declaresBehavior =
      hasApi || !!action.onClick || !!action.redirect
      || action.reload === true || action.close === true;
    if (!declaresBehavior) {
      const label = action.name || action.type || action.actionType || 'action';
      return {
        success: false,
        error: `Action "${label}" is not executable: no handler is registered under that name and it declares no api, endpoint, navigate, redirect or onClick.`,
      };
    }

    const result: ActionResult = { success: true };

    if (hasApi) {
      const apiResult = await this.executeAPI(action);
      if (!apiResult.success) return apiResult;
      result.data = apiResult.data;
    }

    if (action.onClick) {
      await action.onClick();
    }

    result.reload = action.reload !== false;
    result.close = action.close !== false;

    if (action.redirect) {
      result.redirect = this.evaluator.evaluate(action.redirect) as string;
    }

    return result;
  }

  /**
   * `form` action — open a FormView as a routed page (`/forms/:name`, per the
   * spec). `target` is the FormView name. Without this case the action fell
   * through to `executeActionSchema` and silently no-opped (the "Log Time does
   * nothing" report). The current record id is forwarded as `?recordId=` for
   * hosts that support it; the form route ignores unknown query params.
   *
   * ## An id never travels without its object (objectui#4292)
   *
   * `?recordId=` names an id and nothing else, so the consumer has to pick an
   * object to resolve it against, and the only one it can pick is the FormView's
   * own target object (`/forms/:name` does exactly that since objectui#4278).
   * That is right whenever the action fired from a record OF that object, and
   * nothing here used to check that it did: `target: 'showcase_task.edit'` on an
   * Account record header is publishable metadata, and with per-table integer
   * keys `GET /data/showcase_task/42` cheerfully answers for Account 42. Before
   * #4278 the damage stopped at a duplicate insert; now that the route honours
   * the param, the same mis-scoped action PATCHes a different object's record
   * with no error anywhere. So the id is forwarded only when the two objects
   * MATCH, and the object identity rides along as the consumer's second half of
   * the check ({@link FORM_RECORD_OBJECT_PARAM}).
   *
   * The three outcomes, and why the third preserves rather than refuses:
   *
   *  - **match** — forward `?recordId=&recordObject=`. The #4278 edit path,
   *    plus the identity the consumer re-checks against its own view metadata;
   *  - **mismatch** — forward NEITHER, i.e. the bare `/forms/:name`. A "log
   *    time" action fired from a Task at another object's create view is not a
   *    broken edit, it is a CREATE that happens to be launched from a record —
   *    which is exactly what this route did before #4278 taught it to read the
   *    param. Refusing here would break a shape that works;
   *  - **not comparable** — either end unknown ⇒ forward as before. A host that
   *    publishes no `objectName`, or an unqualified target name, gives this
   *    runner nothing to compare; tightening on absent information would turn
   *    working edit flows into creates on every such host. The guard only ever
   *    fires on information it actually has, and the consumer half applies the
   *    same rule to a missing `recordObject`.
   */
  private async executeForm(action: ActionDef): Promise<ActionResult> {
    const name = this.evaluator.evaluate(action.target) as string;
    if (!name || typeof name !== 'string') {
      return { success: false, error: 'No form target (FormView name) provided for form action' };
    }
    const recordId =
      (this.context.record && (this.context.record as { id?: unknown }).id) ??
      (this.context.data && (this.context.data as { id?: unknown }).id);
    const base = `/forms/${name}`;
    const contextObject = readContextObjectName(this.context);
    const to =
      recordId == null || crossesObjectBoundary(name, contextObject)
        ? base
        : `${base}?${FORM_RECORD_ID_PARAM}=${encodeURIComponent(String(recordId))}` +
          (contextObject
            ? `&${FORM_RECORD_OBJECT_PARAM}=${encodeURIComponent(contextObject)}`
            : '');

    if (this.navigationHandler) {
      this.navigationHandler(to, { external: false });
      return this.announceNavigation(action, { success: true });
    }
    return this.announceNavigation(action, { success: true, redirect: to });
  }

  /**
   * `navigation` — objectui's alias of the spec's `url` (`ObjectUiLocalActionType`).
   *
   * Kept because `{ type: 'navigation', to: … }` is authored today
   * (`element:button` CTAs) and because deleting the case would not fail loudly:
   * the action would land in `executeActionSchema` and report success while
   * navigating nowhere. All it does now is resolve the alias's own spelling of
   * the target and hand off to the shared navigator, so the two names cannot
   * drift apart again. Prefer `type: 'url'` + `openIn` in new metadata.
   */
  private async executeNavigation(action: ActionDef): Promise<ActionResult> {
    const nav = (action.navigate || action) as ActionDef;
    const rawUrl = nav.to || nav.target || nav.redirect;
    if (!rawUrl) {
      return { success: false, error: 'No URL provided for navigation action' };
    }
    return this.announceNavigation(action, await this.navigateTo(action, rawUrl, nav));
  }

  /**
   * Assemble the request body for the runner's OWN `executeAPI` — the path taken
   * when no host registered an `api` handler.
   *
   * `bodyExtra` is merged LAST, which is the spec's documented semantics for the
   * key ("Static request-body fields for a `type:'api'` action, merged last
   * (overrides user params)") and what the console's `apiHandler` already does on
   * both of its branches. Before objectstack#6837 this path read `action.params`
   * alone and never looked at `bodyExtra` at all, so an action whose payload lives
   * entirely in `bodyExtra` — the shape the ADR-0087 conversion produces from an
   * old object-form `params` page — POSTed an empty body here.
   *
   * `params` contributes only in its DEPRECATED non-array form (the compat window
   * objectstack-ai/objectstack#5777 opened; see `warnOnDeprecatedObjectParams`). An ARRAY `params` is a
   * parameter DEFINITION list, not a payload: it reaches this method unconsumed
   * only when no `paramCollectionHandler` is mounted, and POSTing the definitions
   * as the request body was never a payload any endpoint wanted. It now falls
   * through to the context record like an absent `params` does.
   *
   * `bodyShape` then decides how that payload is WRAPPED, and the wrap covers the
   * collected payload ONLY — `bodyExtra` stays at the top level. That is the
   * spec's own wording for the key ("`{ wrap: 'data' }` nests the user-collected
   * params under that key, while `recordIdParam` and other top-level keys stay
   * flat") and what both console read-sites already do, so the key means one
   * thing on every path that honours it. Until objectstack#6938 this path did not
   * read it at all: the console `apiHandler` wrapped and the runner's own fallback
   * did not, so the same action changed body shape with the host it ran under.
   */
  private buildApiRequestBody(action: ActionDef): unknown {
    const asRecord = (value: unknown): Record<string, unknown> | undefined => (
      value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined
    );
    const bodyExtra = asRecord(action.bodyExtra);
    const base = asRecord(action.params) ?? this.context.data;
    // `'flat'` (and an absent//malformed value) means no wrapping — the same
    // predicate the console read-sites use, so an off-spec `bodyShape` degrades
    // to the documented default here too instead of producing a `{ undefined: … }`
    // key on the wire.
    const shape = action.bodyShape;
    const wrap = shape && typeof shape === 'object' && typeof shape.wrap === 'string' && shape.wrap
      ? shape.wrap
      : undefined;
    if (wrap) {
      // The payload nests; `bodyExtra` rides flat beside it. No key collision to
      // resolve in this branch — that is the point of the wrap — so "merged last"
      // is preserved by construction.
      return { [wrap]: base ?? {}, ...bodyExtra };
    }
    // Nothing to merge: hand back the historical value as-is, so a host passing a
    // non-object `context.data` still serializes exactly what it used to.
    if (!bodyExtra) return base ?? {};
    return { ...asRecord(base), ...bodyExtra };
  }

  /**
   * Execute API action — supports both simple string endpoint and complex ApiConfig.
   */
  private async executeAPI(action: ActionDef): Promise<ActionResult> {
    // Resolve the endpoint: api (string/object), endpoint, or target
    const apiConfig = action.api || action.endpoint || action.target;

    if (!apiConfig) {
      return { success: false, error: 'No API endpoint provided' };
    }

    try {
      let url: string;
      let method: string;
      let headers: Record<string, string> = { 'Content-Type': 'application/json' };
      let body: any = undefined;
      let responseType: 'json' | 'text' | 'blob' = 'json';

      if (typeof apiConfig === 'string') {
        // Simple string endpoint
        url = this.interpolateTarget(apiConfig, action);
        method = action.method || 'POST';
        body = JSON.stringify(this.buildApiRequestBody(action));
      } else {
        // Complex ApiConfig
        const config = apiConfig as ApiConfig;
        url = this.interpolateTarget(config.url, action);
        method = config.method || action.method || 'POST';
        headers = { ...headers, ...config.headers };
        responseType = config.responseType || 'json';

        // Build query params
        if (config.queryParams) {
          const searchParams = new URLSearchParams(config.queryParams);
          url = `${url}${url.includes('?') ? '&' : '?'}${searchParams.toString()}`;
        }

        // Build body
        if (config.body) {
          body = typeof config.body === 'string'
            ? config.body
            : JSON.stringify(config.body);
        } else if (method !== 'GET' && method !== 'HEAD') {
          body = JSON.stringify(this.buildApiRequestBody(action));
        }
      }

      const fetchInit: RequestInit = { method, headers };
      if (body && method !== 'GET' && method !== 'HEAD') {
        fetchInit.body = body;
      }

      const response = await fetch(url, fetchInit);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      let data: any;
      switch (responseType) {
        case 'text':
          data = await response.text();
          break;
        case 'blob':
          data = await response.blob();
          break;
        default:
          data = await response.json();
      }

      return { success: true, data };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Substitute `${param.X}` and `${ctx.X}` tokens in an action target.
   *
   * Used by executeUrl and executeAPI so metadata can produce dynamic
   * URLs without coupling to the wider ExpressionEvaluator surface
   * (which would also evaluate operators, member access, etc. — overkill
   * and unsafe for URL-position values).
   *
   * Every substituted value is `encodeURIComponent`'d, since the only
   * legitimate use case so far (better-auth `/sign-in/social?provider=…`)
   * places interpolated values in URL query positions. Callers MUST
   * therefore put tokens after a `?` or `&` — using `${param.x}` inside a
   * path segment will produce percent-encoded slashes, which is the
   * correct behaviour for opaque IDs but would break a literal path
   * fragment.
   *
   * `ctx.origin`, `ctx.user.*`, `ctx.org.*`, `ctx.recordId` are surfaced
   * implicitly from the runner's ActionContext + window, and
   * `ctx.selection.ids` / `ctx.selection.count` reflect the grid's current
   * checkbox selection (`context.selectedRecords`) — `${ctx.selection.ids}`
   * comma-joins the ids via the standard `String(array)` behaviour, so a
   * list_toolbar url/api action can carry the selection without any bulk
   * plumbing (objectui#3139). In an aggregate bulk dispatch,
   * `${param._selectedIds}` interpolates the same ids from the injected
   * param. Consumers can extend by stuffing extra keys under
   * `context.ctx = {...}` before calling `runner.execute()`.
   */
  private interpolateTarget(target: string, action: ActionDef, resultScope?: unknown): string {
    if (typeof target !== 'string' || target.indexOf('${') === -1) return target;
    // ── The `${param.X}` scope is an INTERNAL runtime value bag, not an
    //    authoring surface (objectui#4097 ruling B, 2026-08-11) ──────────────
    //
    // A non-array `params` reaches this line from ONE direction only: a host
    // synthesizing a value bag on its way into `runner.execute()` — the
    // collected values a param dialog just gathered, `_selectedIds` from an
    // aggregate bulk dispatch, `_rowRecord` from a row surface. Eight internal
    // producers, measured. No AUTHOR can put a value here: `ActionSchema.params`
    // is `z.array(ActionParamSchema)`, so the object form is refused at parse,
    // and the refusal message names the sanctioned spellings.
    //
    // That refusal is why this branch survived objectui#4097 while its two
    // siblings did not. The objectstack#6828 maintainer ruling targeted the
    // AUTHORING vocabulary — "a key with three meanings and no authorized
    // spelling for the third" — and both authored meanings are now handled
    // upstream at parse; PR objectui#4262 removed the third runtime read
    // (`params.newTab`). What is left here is a channel no author can reach or
    // observe, so removing it would spend a four-package runtime-contract
    // migration on an already-unreachable shape. Option A was declined for
    // exactly that reason: "plumbing expansion with zero pull".
    //
    // ⚠️ The hazard the ruling flagged, recorded here so the next reader sees
    // it at the code rather than in a closed thread: this line's safety rests
    // ENTIRELY on the producer refusing an authored object-form `params`. If a
    // future spec loosening ever admits one, an authored scope silently becomes
    // reachable again — and it would arrive as an interpolation source for URLs
    // and api targets, which is the shape a params dialog field named for a
    // navigation directive could steer. The guards are the upstream refusal pin
    // and the two local pins (`ActionRunner.resultDialog.test.ts`,
    // `ActionRunner.test.ts`); a spec change that turns them red is the signal,
    // not a nuisance.
    const params = (action.params && typeof action.params === 'object' && !Array.isArray(action.params))
      ? (action.params as Record<string, unknown>)
      : {};
    // The scope MAP defines the vocabulary — the pattern is built from its
    // keys, so a scope that is not in play is not a scope this call recognizes.
    //
    // `result` (the handler's own return value) is passed by exactly one caller:
    // the `ActionSchema.onSuccess` post-success hop, where a response exists.
    // Every other caller — `executeUrl`, `executeAPI` — interpolates a target
    // BEFORE the request, so there is no result to read; admitting `${result.*}`
    // there would widen the authorable surface with nothing behind it and
    // silently blank the token instead of leaving the author's mistake visible.
    //
    // The success toast's `outcomeMessages` copy is the one other caller of the
    // grammar, through `substituteScopeTokens` directly (`composeSuccessMessage`):
    // `result` only, because that is the one scope the contract declares for the
    // copy, and no encoding, because a toast is text.
    const scopes: Record<string, unknown> = { param: params, ctx: this.buildInterpolationContext() };
    if (resultScope !== undefined) scopes.result = resultScope;
    return substituteScopeTokens(target, scopes, encodeURIComponent);
  }

  /**
   * Assemble the `ctx` namespace exposed to target interpolation.
   * Built-in keys: origin, user, org, recordId. Anything the consumer
   * placed under context.ctx is merged on top.
   */
  private buildInterpolationContext(): Record<string, unknown> {
    const ctx: Record<string, unknown> = {
      origin: typeof window !== 'undefined' ? window.location.origin : '',
      // Backend API origin (typically `import.meta.env.VITE_SERVER_URL`
      // passed in from the host app). Empty string means "same-origin",
      // which collapses `${ctx.apiBase}/api/...` to a regular relative
      // path — exactly the production-deployment behaviour.
      apiBase: typeof this.context.apiBase === 'string'
        ? this.context.apiBase.replace(/\/+$/, '')
        : '',
      user: this.context.user ?? {},
      org: this.context.org ?? this.context.organization ?? {},
      recordId: this.context.record?.id ?? this.context.recordId,
      // Current list selection (published by the grid as `selectedRecords`).
      // `${ctx.selection.ids}` in a url/api target comma-joins the ids —
      // String(array) — giving toolbar actions selection access without any
      // bulk-executor involvement (objectui#3139). Empty when nothing is
      // selected, so authors can treat "" as "no selection".
      selection: {
        ids: Array.isArray(this.context.selectedRecords)
          ? this.context.selectedRecords
              .map((r: Record<string, unknown> | null | undefined) => r?.id)
              .filter((v: unknown) => v != null)
              .map(String)
          : [],
        count: Array.isArray(this.context.selectedRecords)
          ? this.context.selectedRecords.length
          : 0,
      },
    };
    if (this.context.ctx && typeof this.context.ctx === 'object') {
      Object.assign(ctx, this.context.ctx);
    }
    return ctx;
  }

  /**
   * The evaluator a dispatch's authored copy is read through: the param
   * dialog's `description` / `helpText`, via the handler's `interpolate`
   * argument. (`confirmText` reads `{{ }}` holes only, over `dispatchRecord`,
   * the same record this binds — see `confirmMessage`.)
   *
   * One rule for every door (objectui#12967): the record the action runs
   * against is `record`. The record header binds it in the runner's context
   * (`RecordDetailView`'s `ActionProvider`). A row surface does not — it
   * stashes the clicked row under `params._rowRecord` (ObjectGrid's row
   * actions, a related list's row actions, `DeclaredActionsBar`, a page
   * header, `action:button`'s update write) and fires through the shared
   * runner, whose context names the page, not the row. So when the dispatch
   * carries a row, the row is bound as `record` for this dispatch's templates,
   * and it wins over a page-level `record` (a related-list row on a record page
   * is the child, not the page's record). Nothing else in the scope changes,
   * and the runner's own context is not touched.
   *
   * A hole naming a field the record does not carry degrades the way the
   * header's always has: the evaluator reads `undefined` and the hole prints
   * empty.
   */
  private templateEvaluatorFor(action: ActionDef): ExpressionEvaluator {
    const row = dispatchRow(action);
    if (!row) return this.evaluator;
    return new ExpressionEvaluator({ ...this.context, record: row });
  }

  updateContext(newContext: Partial<ActionContext>): void {
    this.context = withIdentityAlias({ ...this.context, ...newContext });
    // Feed the merged (re-aliased) context so a refreshed `user` also
    // refreshes the derived `os.user` binding in the evaluator scope.
    this.evaluator.updateContext(this.context);
  }

  getContext(): ActionContext {
    return this.context;
  }

  /**
   * A one-shot runner for {@link ActionRunner.execute}'s `callContext`
   * (objectui#13063): this runner's context with `callContext` merged over it,
   * and this runner's handlers, translator and registries, shared rather than
   * copied, so the dispatch confirms, collects params, toasts and navigates
   * exactly as this runner does.
   *
   * Two keys follow the merge rather than the base:
   *
   *  - `ctx`, the `ctx.*` mirror `ActionProvider` publishes beside the flat
   *    keys. A `${ctx.record.…}` hole has to read the same record as a
   *    `${record.…}` one.
   *  - `objectFields` / `objectActions`. A host publishes them BESIDE
   *    `objectName`, so the pair names one object (objectui#11122,
   *    objectui#13022). When `callContext` names another object and brings no
   *    definitions of its own, the base's are dropped: the page object's field
   *    types and declarations must not answer for the child's record. That is
   *    what a dispatch with no `callContext` already gets for a retargeted
   *    action, so the update path's capture sees the same input either way.
   */
  private scopedTo(callContext: Partial<ActionContext>): ActionRunner {
    const objectChanged =
      'objectName' in callContext &&
      readContextObjectName(callContext as ActionContext) !== readContextObjectName(this.context);
    const follow = (bag: Record<string, unknown>): Record<string, unknown> => {
      const merged: Record<string, unknown> = { ...bag, ...callContext };
      if (objectChanged) {
        if (!('objectFields' in callContext)) delete merged.objectFields;
        if (!('objectActions' in callContext)) delete merged.objectActions;
      }
      return merged;
    };
    const merged = follow(this.context) as ActionContext;
    const mirror: unknown = this.context.ctx;
    if (mirror && typeof mirror === 'object' && !Array.isArray(mirror)) {
      merged.ctx = follow(mirror as Record<string, unknown>);
    }
    const scoped = new ActionRunner(merged);
    scoped.handlers = this.handlers;
    scoped.scripts = this.scripts;
    scoped.confirmHandler = this.confirmHandler;
    scoped.toastHandler = this.toastHandler;
    scoped.modalHandler = this.modalHandler;
    scoped.navigationHandler = this.navigationHandler;
    scoped.paramCollectionHandler = this.paramCollectionHandler;
    scoped.resultDialogHandler = this.resultDialogHandler;
    scoped.translate = this.translate;
    return scoped;
  }

  /**
   * Get the expression evaluator (for components that need to evaluate visibility, etc.)
   */
  getEvaluator(): ExpressionEvaluator {
    return this.evaluator;
  }
}

/**
 * Convenience function to execute a single action with a one-off runner.
 */
export async function executeAction(
  action: ActionDef,
  context: ActionContext = {}
): Promise<ActionResult> {
  const runner = new ActionRunner(context);
  return await runner.execute(action);
}

/** The `ActionSchema.onSuccess` block, as the pinned spec declares it. */
export interface OnSuccessNavigation {
  navigate: string;
  /** `'self' | 'newTab'` — read as data, so an off-contract value cannot widen the branch. */
  openIn?: unknown;
}

/**
 * Is this `onSuccess` the spec's navigation block?
 *
 * The test IS the spec's declaration: a non-array object carrying a STRING
 * `navigate`. Stored rows are rehydrated UNPARSED (objectstack-ai/objectstack#3903), so the runner reads
 * the value as data and anything else gets NO reading — since objectui#5934
 * retired the legacy chained-callback channel (`ActionDef | ActionDef[]`),
 * there is no other channel for an off-contract shape to fall into. This is a
 * shape GUARD on unparsed data, not a discriminator between two meanings.
 */
export function readOnSuccessNavigation(value: unknown): OnSuccessNavigation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const navigate = (value as { navigate?: unknown }).navigate;
  if (typeof navigate !== 'string' || navigate === '') return null;
  return value as OnSuccessNavigation;
}

/**
 * The runner's ONE `${scope.path}` token grammar — the substitution behind
 * `interpolateTarget` (url / api targets and the `onSuccess.navigate` hop) and
 * behind the success toast's `outcomeMessages` copy (`composeSuccessMessage`).
 *
 * The scope MAP defines the vocabulary: the pattern is built from its keys, so
 * a token naming a scope the caller did not pass is left in the text exactly as
 * written. A path that resolves to nothing becomes `''`. `encode` is the only
 * thing a caller varies, and it belongs to the SINK, not to the dialect: a URL
 * position percent-encodes each value, a toast inserts it as text.
 */
function substituteScopeTokens(
  template: string,
  scopes: Record<string, unknown>,
  encode: (value: string) => string,
): string {
  if (typeof template !== 'string' || template.indexOf('${') === -1) return template;
  const pattern = new RegExp(`\\$\\{(${Object.keys(scopes).join('|')})\\.([\\w.]+)\\}`, 'g');
  return template.replace(pattern, (_match, scope: string, path: string) => {
    const value = readPath(scopes[scope], path);
    if (value == null) return '';
    return encode(String(value));
  });
}

/**
 * Dot-path read used by target interpolation. Plain reduce — kept inline
 * to avoid pulling lodash for a 3-line helper.
 */
function readPath(root: unknown, path: string): unknown {
  if (root == null) return undefined;
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc == null) return undefined;
    return (acc as Record<string, unknown>)[key];
  }, root);
}
