// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22727 — the authoring producer of a formula field's declared result.
 *
 * `FieldSchema.returnType` is "stamped from the inferred CEL type". For the
 * four scalar members that inference is {@link inferExpressionType}. A money
 * result needs more than a CEL type: cel-js types `record.amount * 0.1` as a
 * plain `double`, so the type checker can never say "this is an amount, and
 * here is its currency". This module answers exactly that question, over the
 * host object's declared fields, and hands the stamp the whole declaration to
 * write — `returnType: 'currency'` plus the currency, copied from the source
 * field's own `currencyConfig` the way a currency field carries it.
 *
 * ## Why authoring, and not a read-time derivation
 *
 * The alternative — a renderer that, finding a `currency` formula with no
 * currency of its own, reads the currency of some field the expression
 * references — is a `??` fallback in a consumer (AGENTS.md Prime Directive
 * #12). Nothing would check it, two consumers could pick two different source
 * fields, and an AI author could never see what it declared. So the currency
 * is a DECLARATION on the formula (`currencyConfig`, the same schema a currency
 * field uses, checked at the save door) and this function is where "taken from
 * the source field" happens: once, when the formula is authored.
 *
 * ## What "provably money" means here — dimensional analysis, conservative
 *
 * Every sub-expression gets a dimension: an amount in one currency (a
 * `currency` field, or a formula declared `currency`), a plain quantity (a
 * numeric non-money field: `number`, `percent`, `rating`, `slider`,
 * `progress`, or a formula declared `number`), a numeric constant (a literal,
 * which adopts the unit it is added to — `amount + 10`, `x == null ? 0 : x`),
 * the `null` literal, or unproven. The rules are the ones a unit-checker
 * applies:
 *
 *  - `+` / `-`, a ternary's two branches, `min` / `max` / `coalesce`: two
 *    amounts in the SAME currency stay that amount; an amount with a constant
 *    stays the amount; an amount with a plain quantity is unproven (`amount +
 *    quantity` adds two different units).
 *  - `*`: an amount times a quantity or constant is the amount; two amounts
 *    multiplied are unproven.
 *  - `/`: an amount divided by a quantity or constant is the amount; an amount
 *    divided by an amount in the same currency is a plain ratio; anything
 *    divided BY an amount is unproven.
 *  - `abs` / `round` / `floor` / `ceil` / `int` / `double` (and the `dyn`
 *    wrapper the parser adds to a `cond ? value : null` guard) keep the unit.
 *  - Everything else — a string, a comparison, a function this list does not
 *    name, a field whose type or currency cannot be read, two different
 *    currencies meeting — is unproven.
 *
 * Unproven is never guessed into money, and on the numeric path it is never
 * answered `number` either (#35631): a `number` answer means "proved not
 * money", so a stamp may withdraw a declared `currency` on it. A numeric
 * expression is answered by {@link inferExpressionType} only when the unit
 * proof succeeds (a plain quantity or constant), or when every read of the
 * record — `record.x`, `record['x']`, `record.?x`, `record[?'x']`, or a bare
 * `x` — is ONE segment naming a field the map declares, whose unit can be read
 * and is not money. Anything else answers `{}`, unproven:
 *
 *  - a read of a `currency` field, a formula declared `currency`, or a
 *    `summary` other than a `count` (a roll-up passed without its
 *    `summaryOperations` included) that the proof could not follow;
 *  - a formula that declares no `returnType` — its unit cannot be read;
 *  - a hop through a reference (`record.account.balance`) — the leaf's type is
 *    not on this object;
 *  - a read whose key is computed, or a name the map does not declare.
 *
 * So a numeric formula over declared quantities stays `number`. The CEL type
 * still decides once the proof succeeds: a bare ratio of two amounts in one
 * currency (`record.amount / record.tax`) is proven a plain number, but cel-js
 * types it `dyn`, so it answers `{}` and a declared `currency` is kept. A
 * `summary` field is not read as a quantity: a roll-up of a currency field is
 * itself money, and its source type is not on this object.
 */

import { CurrencyConfigSchema, NUMERIC_VALUE_TYPES, type Field } from '@objectstack/spec/data';
import { inferCelType, parseCelToAst, rewriteNullableTernary } from './cel-engine';
import { inferExpressionType, type ExprInput } from './validate';

/**
 * The slice of a host-object field the inference reads — an entry of
 * `ObjectSchema.fields`, as declared. Pass the object's field map unchanged.
 */
export interface FormulaSourceField {
  readonly type?: string;
  /** `formula` only — its declared result type; a formula over a formula reads it. */
  readonly returnType?: string;
  /** A currency field's (or a currency formula's) `currencyConfig`, as declared. Absent ⇒ dynamic. */
  readonly currencyConfig?: unknown;
  /**
   * `summary` only — its roll-up, as declared. A `count` is a plain number;
   * any other function, or a roll-up passed without this member, may be money.
   */
  readonly summaryOperations?: unknown;
}

/**
 * A formula field's declared result, as far as the expression proves it.
 *
 * - `returnType` — absent means NO verdict, never "declares nothing": the
 *   expression proves no type (`{}`, unproven), and a stamp keeps what the
 *   author declared (a `currency`, a `percent`). `number` means proved not
 *   money.
 * - With a `currency` answer the pair is the declaration: the stamp writes
 *   `currencyConfig` exactly as answered and removes one the answer leaves
 *   out (a `dynamic` result). A stamp that writes any other type removes a
 *   stale `currencyConfig` — a formula edited from money to a count loses it.
 * - `currencyConfig` — present only for a `currency` result whose currency is
 *   `fixed`, or `record` (ADR-0144 D2: each record's own currency, carried as
 *   the same `currencyField` its source amounts name). A `dynamic` result (the
 *   tenant default currency) declares no config, exactly as a `dynamic`
 *   currency field may carry none.
 */
export interface FormulaReturnDeclaration {
  readonly returnType?: NonNullable<Field['returnType']>;
  readonly currencyConfig?:
    | { readonly currencyMode: 'fixed'; readonly defaultCurrency: string }
    | { readonly currencyMode: 'record'; readonly currencyField: string };
}

type MoneyCurrency =
  | { readonly mode: 'dynamic' }
  | { readonly mode: 'fixed'; readonly code: string }
  // [ADR-0144 D2] Each record's own currency, the code in the sibling field
  // `field` names. Two record-mode amounts are one currency only when they
  // name the same code field.
  | { readonly mode: 'record'; readonly field: string };

type Dim =
  | { readonly kind: 'money'; readonly currency: MoneyCurrency }
  | { readonly kind: 'quantity' }
  | { readonly kind: 'constant' }
  | { readonly kind: 'null' }
  | { readonly kind: 'unproven' };

const QUANTITY: Dim = { kind: 'quantity' };
const CONSTANT: Dim = { kind: 'constant' };
const NULL: Dim = { kind: 'null' };
const UNPROVEN: Dim = { kind: 'unproven' };

/**
 * Numeric field types whose value is a plain quantity: the numeric class minus
 * `currency` (an amount) and `summary` (whose unit is its child field's).
 */
const QUANTITY_FIELD_TYPES: ReadonlySet<string> = new Set(
  [...NUMERIC_VALUE_TYPES].filter((t) => t !== 'currency' && t !== 'summary'),
);

/** One-argument calls that keep their argument's unit. `dyn` is the parser's own null-guard wrapper. */
const UNIT_PRESERVING_CALLS: ReadonlySet<string> = new Set(['dyn', 'double', 'int', 'abs', 'round', 'floor', 'ceil']);

/** Two-argument calls whose result is one of their arguments. */
const UNIT_JOINING_CALLS: ReadonlySet<string> = new Set(['min', 'max', 'coalesce']);

/** CEL result types a money value can carry (`dyn`: an operator over two field reads). */
const MONEY_CEL_TYPES: ReadonlySet<string> = new Set(['int', 'uint', 'double', 'dyn']);

type Node = { readonly op: string; readonly args: unknown };

function isNode(v: unknown): v is Node {
  return typeof v === 'object' && v !== null && typeof (v as Node).op === 'string';
}

function sameCurrency(a: MoneyCurrency, b: MoneyCurrency): boolean {
  if (a.mode === 'fixed' && b.mode === 'fixed') return a.code === b.code;
  if (a.mode === 'record' && b.mode === 'record') return a.field === b.field;
  return a.mode === b.mode;
}

/**
 * A field's currency, read through the schema a currency field is parsed with — or `null` when it does not parse.
 * A `fixed` config with no code does not parse (the schema refuses it rather than filling in a code), so the
 * `defaultCurrency` guard below only narrows the type the refinement already guarantees.
 */
function currencyOf(config: unknown): MoneyCurrency | null {
  const parsed = CurrencyConfigSchema.safeParse(config ?? {});
  if (!parsed.success) return null;
  if (parsed.data.currencyMode === 'fixed') {
    return parsed.data.defaultCurrency === undefined ? null : { mode: 'fixed', code: parsed.data.defaultCurrency };
  }
  // [ADR-0144 D2] A `record`-mode amount is in the currency its sibling code
  // field holds — never the tenant default a `dynamic` stamp would claim. The
  // schema requires the pointer under `record`, so a parsed config carries it.
  if (parsed.data.currencyMode === 'record') {
    return parsed.data.currencyField ? { mode: 'record', field: parsed.data.currencyField } : null;
  }
  return { mode: 'dynamic' };
}

/** Is `d` a number that is not an amount (a quantity or a constant)? */
function isPlainNumber(d: Dim): boolean {
  return d.kind === 'quantity' || d.kind === 'constant';
}

function plainNumber(a: Dim, b: Dim): Dim {
  return a.kind === 'constant' && b.kind === 'constant' ? CONSTANT : QUANTITY;
}

/** Two values that may each be the result: ternary branches, `min` / `max` / `coalesce`. */
function join(a: Dim, b: Dim): Dim {
  if (a.kind === 'unproven' || b.kind === 'unproven') return UNPROVEN;
  if (a.kind === 'null') return b;
  if (b.kind === 'null') return a;
  if (a.kind === 'money' && b.kind === 'money') return sameCurrency(a.currency, b.currency) ? a : UNPROVEN;
  if (a.kind === 'money') return b.kind === 'constant' ? a : UNPROVEN;
  if (b.kind === 'money') return a.kind === 'constant' ? b : UNPROVEN;
  return plainNumber(a, b);
}

function sum(a: Dim, b: Dim): Dim {
  return a.kind === 'null' || b.kind === 'null' ? UNPROVEN : join(a, b);
}

function product(a: Dim, b: Dim): Dim {
  if (a.kind === 'money') return isPlainNumber(b) ? a : UNPROVEN;
  if (b.kind === 'money') return isPlainNumber(a) ? b : UNPROVEN;
  return isPlainNumber(a) && isPlainNumber(b) ? plainNumber(a, b) : UNPROVEN;
}

function quotient(a: Dim, b: Dim): Dim {
  if (a.kind === 'money' && b.kind === 'money') return sameCurrency(a.currency, b.currency) ? QUANTITY : UNPROVEN;
  if (a.kind === 'money') return isPlainNumber(b) ? a : UNPROVEN;
  return isPlainNumber(a) && isPlainNumber(b) ? plainNumber(a, b) : UNPROVEN;
}

function remainder(a: Dim, b: Dim): Dim {
  return isPlainNumber(a) && isPlainNumber(b) ? plainNumber(a, b) : UNPROVEN;
}

function unitKept(d: Dim): Dim {
  return d.kind === 'money' || isPlainNumber(d) ? d : UNPROVEN;
}

function fieldDim(name: string, fields: Readonly<Record<string, FormulaSourceField>>): Dim {
  const field = Object.prototype.hasOwnProperty.call(fields, name) ? fields[name] : undefined;
  if (!field) return UNPROVEN;
  const type = field.type === 'formula' ? field.returnType : field.type;
  if (type === 'currency') {
    const currency = currencyOf(field.currencyConfig);
    return currency ? { kind: 'money', currency } : UNPROVEN;
  }
  return typeof type === 'string' && QUANTITY_FIELD_TYPES.has(type) ? QUANTITY : UNPROVEN;
}

function dimOf(node: unknown, fields: Readonly<Record<string, FormulaSourceField>>): Dim {
  if (!isNode(node)) return UNPROVEN;
  const args = node.args;
  const two = (combine: (a: Dim, b: Dim) => Dim): Dim =>
    Array.isArray(args) && args.length === 2 ? combine(dimOf(args[0], fields), dimOf(args[1], fields)) : UNPROVEN;
  switch (node.op) {
    case 'value':
      if (args === null) return NULL;
      return typeof args === 'number' || typeof args === 'bigint' ? CONSTANT : UNPROVEN;
    case 'id':
      // A bare `<field>` resolves like `record.<field>`, as `inferExpressionType` reads it.
      return typeof args === 'string' ? fieldDim(args, fields) : UNPROVEN;
    case '.': {
      if (!Array.isArray(args) || args.length !== 2) return UNPROVEN;
      const [base, member] = args;
      return isNode(base) && base.op === 'id' && base.args === 'record' && typeof member === 'string'
        ? fieldDim(member, fields)
        : UNPROVEN;
    }
    case '-_':
      return unitKept(dimOf(args, fields));
    case '+':
    case '-':
      return two(sum);
    case '*':
      return two(product);
    case '/':
      return two(quotient);
    case '%':
      return two(remainder);
    case '?:':
      return Array.isArray(args) && args.length === 3 ? join(dimOf(args[1], fields), dimOf(args[2], fields)) : UNPROVEN;
    case 'call': {
      if (!Array.isArray(args) || typeof args[0] !== 'string' || !Array.isArray(args[1])) return UNPROVEN;
      const [fn, callArgs] = args as [string, unknown[]];
      if (UNIT_PRESERVING_CALLS.has(fn) && callArgs.length === 1) return unitKept(dimOf(callArgs[0], fields));
      if (UNIT_JOINING_CALLS.has(fn) && callArgs.length === 2) return join(dimOf(callArgs[0], fields), dimOf(callArgs[1], fields));
      return UNPROVEN;
    }
    default:
      return UNPROVEN;
  }
}

/**
 * Can the unit of the host field `name` be read, and is it not money? A
 * declared non-`currency` field, a formula that declares a non-`currency`
 * `returnType`, or a `count` roll-up. Undeclared, untyped, a `currency`
 * field, a formula with no `returnType`, or any other roll-up: no (#35631).
 */
function hasPlainUnit(name: string, fields: Readonly<Record<string, FormulaSourceField>>): boolean {
  const field = Object.prototype.hasOwnProperty.call(fields, name) ? fields[name] : undefined;
  if (!field || typeof field.type !== 'string') return false;
  if (field.type === 'currency') return false;
  if (field.type === 'formula') return typeof field.returnType === 'string' && field.returnType !== 'currency';
  if (field.type === 'summary') {
    const ops = field.summaryOperations;
    return !!ops && typeof ops === 'object' && (ops as { function?: unknown }).function === 'count';
  }
  return true;
}

/** The four spellings of one member read (`relationship-traversal.ts` reads them alike). */
const MEMBER_READ_OPS: ReadonlySet<string> = new Set(['.', '.?']);
const INDEX_READ_OPS: ReadonlySet<string> = new Set(['[]', '[?]']);

/** `{ receiver, name }` for `x.name`, `x.?name`, `x['name']`, `x[?'name']`; `null` for a computed key. */
function memberRead(node: Node): { receiver: unknown; name: string } | null {
  if (!Array.isArray(node.args) || node.args.length < 2) return null;
  const [receiver, key] = node.args;
  if (MEMBER_READ_OPS.has(node.op)) return typeof key === 'string' ? { receiver, name: key } : null;
  if (isNode(key) && key.op === 'value' && typeof key.args === 'string') return { receiver, name: key.args };
  return null;
}

/**
 * Is every read of the record one segment naming a declared host field whose
 * unit can be read and is not money ({@link hasPlainUnit})? A hop, a
 * computed key, a read off anything but `record`, or a bare `record` is not.
 */
function readsOnlyPlainFields(node: unknown, fields: Readonly<Record<string, FormulaSourceField>>): boolean {
  if (Array.isArray(node)) return node.every((n) => readsOnlyPlainFields(n, fields));
  if (!isNode(node)) return true;
  if (MEMBER_READ_OPS.has(node.op) || INDEX_READ_OPS.has(node.op)) {
    const read = memberRead(node);
    const onRecord = !!read && isNode(read.receiver) && read.receiver.op === 'id' && read.receiver.args === 'record';
    return onRecord && hasPlainUnit(read!.name, fields);
  }
  if (node.op === 'id') return typeof node.args === 'string' && node.args !== 'record' && hasPlainUnit(node.args, fields);
  return readsOnlyPlainFields(node.args, fields);
}

function sourceOf(input: ExprInput): string | null {
  const source = typeof input === 'string'
    ? input
    : input && typeof (input as { source?: unknown }).source === 'string'
      ? (input as { source: string }).source
      : null;
  return source !== null && source.trim() ? source : null;
}

/**
 * The declaration authoring stamps onto a `formula` field whose expression is
 * `input`, judged over the host object's declared `fields` (its
 * `ObjectSchema.fields` map, passed unchanged).
 *
 * - Provably money ⇒ `{ returnType: 'currency' }`, plus
 *   `currencyConfig: { currencyMode: 'fixed', defaultCurrency }` when the
 *   source amounts are in one fixed currency, or
 *   `currencyConfig: { currencyMode: 'record', currencyField }` when they are
 *   record-mode amounts naming one code field (ADR-0144 D2). Sources in two
 *   different currencies are not provably one amount, and fall through.
 * - A numeric expression the unit proof does not prove a plain number, with a
 *   record read that is not one segment naming a declared field of a
 *   readable, non-money unit (a `currency` field, a `currency` formula, a
 *   formula with no `returnType`, a non-`count` roll-up, a reference hop, a
 *   computed key, an undeclared name) ⇒ `{}`, unproven. `number` is never
 *   the answer there: a stamp reads it as "proved not money".
 * - Otherwise ⇒ the {@link inferExpressionType} answer as `returnType`
 *   (`number` / `text` / `boolean` / `date`), or `{}` when that is `unknown`
 *   (a bare same-currency ratio such as `record.amount / record.tax` types
 *   `dyn`), so a numeric formula over declared quantities stays `number`.
 *
 * Pure and conservative: it never throws, and an expression that does not
 * type-check is never money.
 */
export function inferFormulaReturn(
  input: ExprInput,
  fields: Readonly<Record<string, FormulaSourceField>> = {},
): FormulaReturnDeclaration {
  const names = Object.keys(fields);
  const source = sourceOf(input);
  if (source !== null) {
    // Type-checked in the form the engine evaluates: the canonical front end
    // (`parseCelToAst`, and every evaluation) wraps a `cond ? value : null`
    // guard's value branch in `dyn(...)`, without which cel-js refuses the
    // ternary outright — so the guard idiom would never be judged at all.
    const celType = inferCelType(rewriteNullableTernary(source), names);
    if (celType !== null && MONEY_CEL_TYPES.has(celType)) {
      const ast = parseCelToAst(source);
      const dim = dimOf(ast, fields);
      if (dim.kind === 'money') {
        if (dim.currency.mode === 'fixed') {
          return { returnType: 'currency', currencyConfig: { currencyMode: 'fixed', defaultCurrency: dim.currency.code } };
        }
        if (dim.currency.mode === 'record') {
          return { returnType: 'currency', currencyConfig: { currencyMode: 'record', currencyField: dim.currency.field } };
        }
        return { returnType: 'currency' };
      }
      // #35631 — `number` means proved not money: unless the unit proof
      // succeeded, every record read must name a declared field whose unit
      // can be read and is not money, or the answer is unproven.
      if (!isPlainNumber(dim) && !readsOnlyPlainFields(ast, fields)) return {};
    }
  }
  const plain = inferExpressionType(input, { fields: names });
  return plain === 'unknown' ? {} : { returnType: plain };
}
