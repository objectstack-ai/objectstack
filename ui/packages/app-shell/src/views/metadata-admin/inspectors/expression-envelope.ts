// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * expression-envelope — how an inspector READS and WRITES an ADR-0089
 * expression-shaped metadata value (`hook.condition`, `action.visible` /
 * `action.disabled`, `validation.condition`, every `*When` predicate …).
 *
 * All of those are `ExpressionInputSchema` in `@objectstack/spec`: a bare
 * authored string is NORMALIZED at parse time into `{ dialect: 'cel', source }`,
 * so the ENVELOPE — not the string — is what a persisted artifact carries.
 *
 * ## Read
 *
 * {@link expressionSource} does not decide anything; it delegates to
 * `conditionText`, the ONE reader objectui#3216 settled on. Adding a second
 * `typeof c === 'string'` here is precisely the bug class #3216 closed
 * (four hand-rolled readers, two of which reported a spec-canonical envelope as
 * "no condition"), so this file deliberately owns no read logic of its own.
 *
 * ## Write
 *
 * #3216 never had to answer the write side. objectui#3218 did, and the ruling
 * on that issue is binding — editing `source` must not silently destroy the
 * rest of the envelope:
 *
 * | key       | when `source` is edited                                       |
 * |:----------|:--------------------------------------------------------------|
 * | `dialect` | **preserved** — see below                                     |
 * | `meta`    | **preserved** (ADR-0089 `rationale` / `generatedBy`)          |
 * | `source`  | replaced with the edited text                                 |
 * | `ast`     | **discarded** — it was compiled from the OLD source           |
 *
 * `dialect` is the load-bearing one. The rejected alternative was "commit a
 * bare string and let the spec's pipe normalize it", but that pipe hardcodes
 * `dialect: 'cel'`: a `cron` or `template` guard would come back as `cel` —
 * the author believes they retyped an expression and has in fact swapped the
 * evaluation engine. Silent, and it passes schema validation.
 *
 * `ast` must go rather than ride along: keeping a stale AST means the engine
 * evaluates the OLD guard while the UI shows the new source (spec phase M9.2+,
 * where `ast` becomes the authoritative build output). Dropping it still
 * satisfies `ExpressionSchema`'s `source || ast` refinement, because `source`
 * is present; `objectstack compile` refills it.
 *
 * With no prior envelope to preserve there is nothing to lose, so the write
 * emits the bare-string shorthand — which the spec's pipe normalizes to
 * exactly `{ dialect: 'cel', source }`. That also keeps this helper safe for
 * the generic SchemaForm condition widget, which serves plain-`string`
 * predicate fields as well as `ExpressionInput` ones: the shape it was handed
 * is the shape it hands back.
 */

import type { EvaluatedExpressionInput, ExpressionInput } from '@objectstack/spec/shared';
import { conditionText } from '../previews/flow-canvas-layout.js';

/** The object arm of `ExpressionInput` — the envelope itself. */
type ExpressionEnvelope = Exclude<ExpressionInput, string>;

/** The object arm of `EvaluatedExpressionInput` — an envelope whose `source` is present. */
type EvaluatedExpressionEnvelope = Exclude<EvaluatedExpressionInput, string>;

/**
 * The editable source text of an expression-shaped value, for a control that
 * takes a `string` (`ConditionBuilder`, `VariableTextInput`).
 *
 * Empty means "nothing readable": absent, a boolean (`action.disabled` is
 * `boolean | ExpressionInput`), or an AST-only envelope that has no `source`
 * yet — never a stringified object.
 */
export function expressionSource(value: unknown): string {
  return conditionText(value as ExpressionInput | undefined) ?? '';
}

/** The prior value as an envelope, or `undefined` when there is none to preserve. */
function priorEnvelope(value: unknown): ExpressionEnvelope | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  // `dialect` is what makes it an envelope: the spec requires it, and a
  // `{ source }`-only object is a shape the spec rejects, not one to propagate.
  const candidate = value as Partial<ExpressionEnvelope>;
  return typeof candidate.dialect === 'string' ? (value as ExpressionEnvelope) : undefined;
}

/**
 * Write an edited `source` back into `previous`, per the table above.
 *
 * @param previous the draft's current value for this key — the envelope whose
 *                 `dialect` / `meta` must survive the edit
 * @param source   the edited text; empty clears the value (`undefined`)
 *
 * The return type is the EVALUATED input, `EvaluatedExpressionInput`, not the
 * persistence contract `ExpressionInput`, because it says what this function
 * produces: every value it returns is either the non-empty string itself or an
 * envelope carrying that string as `source`. It never returns an `ast`-only
 * envelope. So the result can go into an evaluated slot, such as the flow
 * designer's edge `condition` (objectui#8946), as well as into any slot typed
 * by the persistence contract, which is the wider of the two.
 */
export function writeExpressionSource(
  previous: unknown,
  source: string,
): EvaluatedExpressionInput | undefined {
  if (!source) return undefined;
  const prior = priorEnvelope(previous);
  if (!prior) return source;
  const next: EvaluatedExpressionEnvelope = { ...prior, source };
  // Derived from the OLD source — never carried across an edit.
  delete next.ast;
  return next;
}
