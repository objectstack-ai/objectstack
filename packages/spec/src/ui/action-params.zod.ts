// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The action DISPATCH contract: what the platform validates on the way in, and
 * what it hands the handler on the way out.
 *
 * Two halves, one surface. **Inbound** — action-param VALUE validation
 * (ADR-0104 D2), below. **Outbound** — the runtime context an action body /
 * handler receives: {@link ActionSessionSchema} (the `ctx.session` contract,
 * #5697), {@link ActionEngineFacade}, {@link ActionHandlerContext} and
 * {@link ActionHandler}.
 *
 * ## Inbound — action-param VALUE validation (ADR-0104 D2)
 *
 * An action's declared `params[]` is a complete value contract — `type`,
 * `required`, `multiple`, `options`, `reference` — but before this it only
 * informed the client dialog: the server passed `reqBody.params` straight to
 * the handler, unvalidated (`http-dispatcher.ts`). This module is the pure
 * contract that lets the REST and MCP dispatch paths enforce that declaration
 * BEFORE the handler runs, reusing the D1 field value-shape contract
 * (`valueSchemaFor`).
 *
 * Purity: schema derivation only (Prime Directive #2). Field-backed params are
 * resolved to their effective value-shape inputs by the CALLER (the runtime,
 * which holds the object metadata registry); this module validates the already
 * resolved descriptors.
 */

import { z } from 'zod';

import { valueSchemaFor } from '../data/field-value.zod';
import type { FieldErrorCode } from '../api/errors.zod';
import { lazySchema } from '../shared/lazy-schema';

/**
 * A declared action param resolved to its effective value-shape inputs. A
 * field-backed param (`{ field: 'x' }`) is resolved by the caller through the
 * referenced object field (type/multiple/options/required inherited); an
 * inline param carries them directly.
 */
export interface ResolvedActionParam {
  /** Request-body key (inline `name`, or the resolved field name). */
  name: string;
  /** Effective field type; when unknown the value shape is left open. */
  type?: string;
  /** Array-valued when true (or an inherently-multi type). */
  multiple?: boolean;
  /** Whether a value must be present. */
  required?: boolean;
  /** Option set for select-like params (membership is enforced). */
  options?: Array<{ value: string | number } | string | number>;
}

export interface ActionParamIssue {
  /** The offending param key. */
  param: string;
  /**
   * Which constraint the value violated, from the field-level catalog
   * (ADR-0114). Typed as `FieldErrorCode` rather than a local literal union so
   * an action param and a record field cannot drift into two vocabularies for
   * the same three conditions — `required` and `invalid_shape` were already
   * shared verbatim before the catalog existed.
   *
   * `unknown_param` folded into `unknown_field` (ADR-0114 D2): the `param` key
   * beside it already says what was addressed, so the code did not need to.
   */
  code: FieldErrorCode;
  message: string;
}

/**
 * Keys the dispatcher merges into the params bag itself (never authored by the
 * caller) — always permitted, never flagged as unknown.
 *
 * `_selectedIds` is injected by the renderer's aggregate bulk dispatch
 * (objectui#3139): a `bulkActionDefs` entry with `execution: 'aggregate'`
 * calls the action ONCE for the whole selection, carrying every selected
 * record id in this key so the handler can produce a single aggregate
 * artifact (zip of QR codes, merged PDF…). Server handlers read it from
 * `ctx.params._selectedIds`; it is never authored as a declared param.
 */
export const ACTION_PARAM_BUILTIN_KEYS: readonly string[] = ['recordId', 'objectName', '_selectedIds'];

function isPresent(v: unknown): boolean {
  return v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '');
}

/**
 * Validate a params bag against an action's resolved param declarations.
 * Returns the list of issues (empty = conformant). Does NOT throw — this is a
 * pure check, and the disposition belongs to the caller: the dispatcher rejects
 * with a 400 by default (ADR-0104 D2, strict since 17.0), while an authoring or
 * preview surface may want to render the same issues without failing.
 *
 * Enforced: `required` presence, per-type value shape (via the D1
 * `valueSchemaFor`, so option membership / `multiple` arrays / reference-id
 * shape all ride the one contract), and unknown keys (not declared, not a
 * built-in). A param with no resolvable `type` leaves its value shape open.
 */
export function validateActionParams(
  resolved: ResolvedActionParam[],
  bag: Record<string, unknown>,
  opts?: { builtinKeys?: readonly string[] },
): ActionParamIssue[] {
  const issues: ActionParamIssue[] = [];
  const declared = new Map<string, ResolvedActionParam>();
  for (const p of resolved) if (p?.name) declared.set(p.name, p);
  const allow = new Set<string>(opts?.builtinKeys ?? ACTION_PARAM_BUILTIN_KEYS);

  for (const p of declared.values()) {
    const value = bag[p.name];
    if (!isPresent(value)) {
      if (p.required) {
        issues.push({ param: p.name, code: 'required', message: `Action param "${p.name}" is required` });
      }
      continue;
    }
    // `type ?? ''` → the value contract's open default for an unresolvable type
    // (field-backed param whose field is gone, or an inline param with no type).
    const schema = valueSchemaFor({ type: p.type ?? '', multiple: p.multiple, options: p.options }, 'stored');
    const result = schema.safeParse(value);
    if (!result.success) {
      const detail = result.error.issues[0]?.message ?? 'invalid value';
      issues.push({
        param: p.name,
        code: 'invalid_shape',
        message: `Action param "${p.name}"${p.type ? ` (${p.type})` : ''}: ${detail}`,
      });
    }
  }

  for (const key of Object.keys(bag)) {
    if (declared.has(key) || allow.has(key)) continue;
    issues.push({
      param: key,
      code: 'unknown_field',
      message: `Unknown action param "${key}" — not declared on this action`,
    });
  }

  return issues;
}

/**
 * The slim engine facade an action handler's `ctx.engine` exposes. TRUSTED —
 * context-less, RLS/FLS-bypassing by design (#2849); the boundary is enforced
 * at invoke time (`ai.exposed` + the ADR-0066 D4 capability gate), not here.
 */
export interface ActionEngineFacade {
  insert(object: string, data: Record<string, unknown>): Promise<{ id: string }>;
  update(object: string, id: string, data: Record<string, unknown>): Promise<void>;
  delete(object: string, id: string): Promise<void>;
  find(object: string, query: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
}

/**
 * The caller session an action BODY / handler reads as `ctx.session`.
 *
 * This is the CONTRACT for what `packages/runtime`'s `buildActionSession()`
 * (`src/action-execution.ts`) hands an action body. It arrived in two steps of
 * #5613's contract-first ruling: phase 1 (#5697) DECLARED the shape exactly as
 * the runtime already built it, and phase 2's spec half (#5779) added the
 * canonical `positions` key and demoted `roles` to a deprecated alias of it.
 *
 * ## Two spellings, one value — the #5613 deprecation window
 *
 * `positions` and `roles` are the SAME array (`ExecutionContext.positions`)
 * under two names. `positions` is canonical — it is the ADR-0090 D3 vocabulary
 * the rest of the platform already uses — and `roles` is the alias kept alive
 * only for the length of the window, then removed on the path
 * `session.tenantId` already walked (#3280 deprecate → #3290 removed in v11).
 * The announcement a reader migrates from is the ADR-0087 semantic migration
 * `action-session-roles-to-positions`. Two live spellings is the MIGRATION,
 * not the destination; phase 1 withheld `positions` precisely so that the
 * window would open once, deliberately, with a removal path attached.
 *
 * Contract-first means the two halves land apart, and this file is the first
 * of them. The PRODUCER change — `buildActionSession()` emitting both keys —
 * is #5613's runtime half and is NOT in yet. Read that literally: a session
 * built today still carries only `roles`, so an action body cannot yet rely on
 * `positions` being PRESENT, only on its meaning being fixed. Every key here
 * is `.optional()`, which is what lets a declaration lead its producer at all
 * — and, concretely, what keeps the runtime consistency pin (below) green
 * across this change instead of red, since a non-strict parse of a session
 * without `positions` neither gains the key nor rejects the object.
 *
 * Why a declaration was worth its own change: `actionContext` is a bare `any`
 * at both dispatch sites (`domains/actions.ts`, `action-execution.ts`) and the
 * sandbox seam types `ScriptContext.session` as `unknown`, so this key set
 * reached no schema, no gate and no generated reference page. It was
 * declared-nowhere / produced-anyway — which is how the `roles` spelling below
 * survived a vocabulary ban and a sibling retirement without either being
 * noticed. A shape nothing declares is a shape nothing can catch drifting.
 *
 * ## Read the shape exactly — absent means the KEY IS ABSENT
 *
 * All four keys are optional and the builder emits them by CONDITIONAL
 * SPREAD, so a missing value means the key is **not present**:
 * `'organizationId' in ctx.session` answers `false`, not `undefined`. The hook
 * path's `input.id` on a bulk write is the OPPOSITE case — key present, value
 * `undefined`, because the engine builds it with a shorthand (#5668). The two
 * are not interchangeable; do not port an `in` test between them.
 *
 * The session as a whole is `undefined` — never `{}` — for a call carrying
 * neither `userId` nor `tenantId`, so a body can distinguish "no identity
 * envelope at all" from "an anonymous caller" the same way a hook does
 * (#3712). One consequence worth knowing: neither `positions` nor `roles` can
 * ever appear on its own, because a context with positions but no user and no
 * org yields no session at all.
 *
 * ## NOT the hook `ctx.session`
 *
 * `HookContextSchema.session` (`@objectstack/spec/data`) is a DIFFERENT object,
 * with a different key set (`actor`, `accessToken`, `isSystem`, the skip flags)
 * from a different producer (ObjectQL's `buildSession()`). The
 * `buildActionSession()` docblock still says it mirrors the hook shape; that
 * sentence stopped being true at #5050, and correcting it belongs to #5613's
 * runtime half — it is a statement about the PRODUCER, so it rides with the
 * producer change, not with this contract.
 *
 * The two sessions do now agree on one thing, which is the point of the rename
 * rather than a coincidence: `HookContext.session.positions` was declared in
 * #5605 (PR #5722) with the same ADR-0090 D3 vocabulary and the same
 * "descriptive, never an authorization input" boundary. After the window
 * closes, one platform will have one spelling for one value on both surfaces.
 *
 * ## Deliberately NOT strict
 *
 * A runtime shape the platform hands a body, never authored — same posture and
 * same reason as `HookContextSchema`: making an engine-side enrichment a
 * breaking parse for whoever parses a context they were GIVEN inverts the
 * contract. What the non-strict posture still buys is the pin in
 * `packages/runtime/src/action-session-shape-contract.test.ts`: parsing the
 * real built object must return it UNCHANGED, so any key the builder starts
 * producing without declaring here is stripped and the pin goes red.
 */
export const ActionSessionSchema = lazySchema(() => z.object({
  /**
   * The invoking user's id (`ExecutionContext.userId`, stringified). Absent for
   * a call with no user — a service/system invocation scoped only to an org.
   */
  userId: z.string().optional().describe('Invoking user id (absent when the call carries no user)'),

  /**
   * Active organization id — the blessed developer-facing name for the
   * caller's current org, the same value as the `organization_id` column and
   * `current_user.organizationId` (RLS). Sourced from
   * `ExecutionContext.tenantId`, which is the distinct driver-level isolation
   * axis and keeps its own name; the deprecated `session.tenantId` alias
   * (#3280) was removed in v11 (#3290) and must not come back.
   */
  organizationId: z.string().optional().describe('Active organization id (blessed developer-facing name; absent when the call is org-less)'),

  /**
   * Position names held by the caller — the CANONICAL spelling of this value
   * at the action boundary, and the key an action body should read. Sourced
   * verbatim from `ExecutionContext.positions` (ADR-0090 D3; that schema's own
   * comment reads "Formerly `roles`"), so the action surface now speaks the
   * same vocabulary as the execution context, the sharing service and — since
   * #5605 / PR #5722 — the hook `ctx.session`.
   *
   * Added by #5613 phase 2's spec half (#5779), which is what lifted phase 1's
   * deliberate prohibition on minting this key early. The prohibition was
   * never about the name: it was about opening a two-spelling window without a
   * closing date. This key opens it WITH one — see the deprecated `roles`
   * below and the ADR-0087 semantic migration `action-session-roles-to-positions`.
   *
   * ## Presence, during the window
   *
   * Once #5613's runtime half lands, `buildActionSession()` emits the same
   * array under both keys, so a body reading either sees identical values and
   * migrating is a change of key and nothing else. Until it lands the producer
   * still emits only `roles` — the contract leads, the producer follows — so
   * treat this key as MEANING-fixed but not yet presence-guaranteed. A reader
   * that must work across both sides of that seam reads `positions` and falls
   * back to `roles` for the window's duration only; that fallback expires with
   * the alias and must not outlive it.
   *
   * ⚠️ Never gate PRIVILEGE on this array — ask the security service, which
   * evaluates capability grants, placements and the derived posture
   * (ADR-0095), never a name-string comparison. The caution belongs to the
   * VALUE, not to the spelling, so it survives the rename intact: an author
   * who rewrites `roles.includes('admin')` as `positions.includes('admin')`
   * has migrated the defect rather than the read.
   */
  positions: z.array(z.string()).optional().describe(
    'Position names held by the caller (ADR-0090 D3 vocabulary; the value of '
    + '`ExecutionContext.positions`, whose schema comment reads "Formerly `roles`") — the CANONICAL '
    + 'spelling at this boundary and the key an action body should read. Within the #5613 '
    + 'deprecation window `buildActionSession()` emits the same array under both this key and the '
    + 'deprecated `roles`, so migrating is a change of key and nothing else; `roles` is then removed '
    + 'on the v11 session-alias removal path (#3280 deprecate → #3290 remove: one window, then gone). '
    + 'Never gate PRIVILEGE on this array — ask the security service, which evaluates capability '
    + 'grants, placements and the derived posture (ADR-0095), never a position-name string '
    + 'comparison.',
  ),

  /**
   * @deprecated Use `positions`. Deprecated ALIAS — the same array under the
   * one spelling ADR-0090 D3 forbids. Migration prescription and acceptance
   * criteria: the ADR-0087 semantic migration
   * `action-session-roles-to-positions`. Removal follows the `session.tenantId`
   * alias precedent (#3280 deprecated → #3290 removed in v11), i.e. one
   * deprecation window after #5613's runtime half lands, not before.
   *
   * Why it is still declared at all: it is what the runtime produces today,
   * and the entire point of a deprecation window is that a body reading it
   * keeps working while its author migrates. Phase 1 (#5697) declared it as
   * current reality — declaring is not endorsing — and every reason it must
   * not survive the window is unchanged: ADR-0090 D3 makes `role` a
   * reserved-forbidden word, #4839 deleted the last two
   * `roles.includes('admin')` readers, and #5050 retired the hook-side
   * `HookContext.session.roles` outright, so until this closes a body author
   * still meets two different answers to one key name on one platform.
   *
   * ⚠️ Never gate PRIVILEGE on this array — see `positions` above. The caution
   * is a property of the value, so it applies identically to both spellings.
   */
  roles: z.array(z.string()).optional().describe(
    'DEPRECATED alias of `positions` — the same caller position names under the one spelling '
    + 'ADR-0090 D3 forbids (the value is `ExecutionContext.positions`, "Formerly `roles`"). Read '
    + '`positions` instead: within the #5613 deprecation window `buildActionSession()` emits both '
    + 'keys with identical values, so migrating is a change of key and nothing else. The migration '
    + 'prescription and its acceptance criteria are the ADR-0087 semantic migration '
    + '`action-session-roles-to-positions`; removal follows the v11 session-alias removal path '
    + '(#3280 deprecated → #3290 removed). Never gate PRIVILEGE on this array — ask the '
    + 'security service, which evaluates capability grants, placements and the derived posture '
    + '(ADR-0095), never a role-name string comparison.',
  ),
}).describe('Action-body `ctx.session` — the caller identity an action body reads (runtime shape, never authored)'));

/**
 * The parsed action-body `ctx.session`. `ActionHandlerContext.session` is this
 * type, so the schema and the handler-facing type cannot drift into two shapes
 * for one object.
 */
export type ActionSession = z.infer<typeof ActionSessionSchema>;

/**
 * The runtime context an action handler receives (ADR-0104 D2). `params` is
 * validated against the action's declared param contract at dispatch BEFORE
 * the handler runs, so its values conform to the declared value shapes — it is
 * typed as a bag because resolving per-name value types would require the
 * literal `params` array the registration seam does not carry (a DX nicety
 * deferred; the runtime guarantee holds regardless).
 *
 * Authoring an action handler? Annotate it with `ActionHandler` instead of an
 * inline `(ctx: any)` — that is what retires the untyped-bag pattern this
 * design targets.
 */
export interface ActionHandlerContext<
  TParams extends Record<string, unknown> = Record<string, unknown>,
  TRecord extends Record<string, unknown> = Record<string, unknown>,
> {
  /** The subject record (loaded under the caller's read scope), or `{}`. */
  record: TRecord;
  /** The validated action params (plus dispatcher-injected recordId/objectName). */
  params: TParams;
  /** The invoking principal. */
  user: { id: string; name?: string; email?: string; organizationId?: string; [k: string]: unknown };
  /**
   * Caller session — {@link ActionSessionSchema}, the declared contract for
   * what `buildActionSession()` produces. Absent entirely for a call with no
   * identity envelope.
   *
   * Previously an inline literal carrying a `[k: string]: unknown` catch-all
   * and the claim that it mirrors the hook `ctx.session`. Both are gone: the
   * shape now has ONE declaration (#5697), and it does not mirror the hook
   * session — see the schema's docblock. Dropping the catch-all narrows no
   * live call site (measured across objectstack / objectui / cloud: this
   * interface has zero importers outside its own module today); the SCHEMA
   * stays non-strict, so an extra key at runtime still parses — it just stops
   * being something the type invites an author to invent.
   */
  session?: ActionSession;
  /** Trusted engine facade for cross-object writes (see {@link ActionEngineFacade}). */
  engine: ActionEngineFacade;
}

/**
 * A typed action handler. Replaces the `(ctx: any) => any` shape at authoring
 * sites; the objectql registration seam still accepts untyped handlers, so
 * this is opt-in and non-breaking.
 */
export type ActionHandler<
  TParams extends Record<string, unknown> = Record<string, unknown>,
> = (ctx: ActionHandlerContext<TParams>) => unknown | Promise<unknown>;
