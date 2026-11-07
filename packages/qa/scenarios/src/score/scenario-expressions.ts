// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * What the platform's own expression front end (`@objectstack/formula`) says of
 * the expressions a built artifact carries: the reads behind the capability-tag
 * checks that ask whether an expression COMPILES or ENFORCES
 * (`scenario-tags.ts`). Each answer is the verdict of the function the platform
 * runs at that site, never a parser of this package's:
 *
 *  - a computed field's `expression` and a validation rule's predicates:
 *    `validateExpression`, the shared validator `os validate` / `os build` run
 *    over every formula and predicate (`@objectstack/lint`'s
 *    `validate-expressions.ts`), at `record` scope against the object's
 *    columns (its declared fields and the system columns the registry injects,
 *    `resolveInjectedSystemColumns`) and its declared field types, with a
 *    relationship traversal judged the way the engine serves one at both sites
 *    (`traversalHydration`: one hop through a reference, never two);
 *  - an `expression` approver: `collectCelRootIdentifiers` over the closed root
 *    set `APPROVER_EXPRESSION_ROOTS`, the pre-check plugin-approvals runs at
 *    node entry and the `approval-expression-invalid` lint mirrors;
 *  - an RLS `using`: `isSupportedRlsExpression`, the one shape gate
 *    plugin-security compiles with. `false` there is a predicate that never
 *    lowers to a filter, so its policy matches no row.
 *
 * What it does NOT re-run is the build's further site rules over the same
 * sources: the null guard, type soundness under the site's fault outcome, a
 * hop into a field the target object lacks, `label()` over an optionless
 * field. An artifact `os build` wrote has passed those; a source that parses
 * and reads only real columns passes here even where the build would also
 * have flagged one of them.
 *
 * Deterministic: no model call, no network.
 */

import { collectCelRootIdentifiers, isSupportedRlsExpression, validateExpression } from '@objectstack/formula';
import { APPROVER_EXPRESSION_ROOTS } from '@objectstack/spec/automation';
import { resolveInjectedSystemColumns } from '@objectstack/spec/data';

type Bag = Record<string, unknown>;

const isBag = (value: unknown): value is Bag => !!value && typeof value === 'object' && !Array.isArray(value);

/** The source text of an expression slot: a bare string or the `{ dialect, source }` envelope the parse writes. */
export function expressionSource(raw: unknown): string | undefined {
  const source = isBag(raw) ? raw.source : raw;
  return typeof source === 'string' && source.trim() !== '' ? source : undefined;
}

/** The columns a `record`-scoped expression on this object can read: its declared fields and the injected ones. */
function objectColumns(def: Bag): string[] {
  const declared = isBag(def.fields) ? Object.keys(def.fields) : [];
  return [...new Set([...declared, ...resolveInjectedSystemColumns(def).names])];
}

/** Declared field name → its type, the index the build's pass hands the validator (a reference type is a hop). */
function declaredFieldTypes(def: Bag): Record<string, string> {
  const types: Record<string, string> = {};
  for (const [name, field] of isBag(def.fields) ? Object.entries(def.fields) : []) {
    if (isBag(field) && typeof field.type === 'string') types[name] = field.type;
  }
  return types;
}

/**
 * Why a `record`-scoped expression of `object` does not compile, or
 * `undefined` when it does: `value` for a computed field, `predicate` for a
 * validation rule. An absent or blank source is a refusal here, never the
 * validator's vacuous pass.
 */
export function recordExpressionRefusal(role: 'value' | 'predicate', raw: unknown, object: string, def: Bag): string | undefined {
  const source = expressionSource(raw);
  if (source === undefined) return 'declares no expression';
  const verdict = validateExpression(role, isBag(raw) ? (raw as { dialect?: string; source?: string }) : source, {
    objectName: object,
    fields: objectColumns(def),
    fieldTypes: declaredFieldTypes(def),
    scope: 'record',
    traversalHydration: true,
  });
  return verdict.ok ? undefined : (verdict.errors[0]?.message ?? 'does not compile');
}

/** Why an `expression` approver cannot route, or `undefined`: it parses and reads only `current` / `trigger` / `vars`. */
export function approverExpressionRefusal(raw: unknown): string | undefined {
  const source = expressionSource(raw);
  if (source === undefined) return 'declares no expression';
  const parsed = collectCelRootIdentifiers(source);
  if (!parsed.ok) return `does not parse as CEL: ${parsed.error}`;
  const roots = new Set<string>(APPROVER_EXPRESSION_ROOTS);
  const foreign = parsed.roots.filter((r) => !roots.has(r));
  return foreign.length === 0 ? undefined : `reads ${foreign.join(', ')}, and an approver expression reads only ${[...roots].join(', ')}`;
}

/** Whether an RLS `using` lowers to a query filter, so its policy enforces (`isSupportedRlsExpression`). */
export const rlsPredicateEnforces = (using: string): boolean => isSupportedRlsExpression(using);
