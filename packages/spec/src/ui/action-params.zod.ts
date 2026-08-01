// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Action-param VALUE validation (ADR-0104 D2).
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

import { valueSchemaFor } from '../data/field-value.zod';
import type { FieldErrorCode } from '../api/errors.zod';

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
  /** Caller session (active org / roles), mirroring the hook `ctx.session`. */
  session?: { userId?: string; organizationId?: string; roles?: string[]; [k: string]: unknown };
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
