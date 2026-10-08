// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @module automation/flow-value-slot-template
 *
 * **The `{…}` template dialect, retired from flow VALUE slots** (#19939 — the
 * C half of #11182 ruling D, on the protocol-18 line).
 *
 * A value slot is a config position whose authored value BECOMES a value: the
 * expression ledger's `value` role (`assignment.assignments.*`,
 * `create_record.fields.*`, `update_record.fields.*` —
 * `FLOW_NODE_EXPRESSION_PATHS`), plus the two legacy `assignment` shapes the
 * executor still reads (the `assignments: [{ variable, value }]` array and the
 * bare `{ <variable>: <value> }` config). Until this retirement every string
 * there ran through `{token}` interpolation, and since #19938 the same slots
 * also evaluate a CEL value envelope — two dialects for one job, with two
 * function sets and two meanings of `/`. This module is the ONE judge of the
 * retirement: a value that carries a `{…}` token the interpolator would
 * resolve is REFUSED, and the refusal names the CEL spelling of each token.
 * `FlowValueSlotSchema` composes it (so the contract says it), and
 * `AutomationEngine.registerFlow`, `objectstack validate` and the executors
 * call it — ⛔ never a second reading of the dialect anywhere.
 *
 * ## Refused, not converted (ADR-0087 D2)
 *
 * D2 lets a conversion rewrite only what maps LOSSLESSLY. Every token spelling
 * that occurs in authored flows was measured through the shipped interpolator
 * AND the shipped CEL engine over the same variables, and each one has an
 * input on which the two answers differ:
 *
 *  - a path (`{x}`, `{a.b}`, `{list.0}`) — CEL refuses an absent variable,
 *    key or index where the template wrote nothing;
 *  - text with holes (`'Hello {o.name}'`) — CEL refuses `+ null` where the
 *    template rendered nothing;
 *  - arithmetic (`{round(x * 100) / 100}`) — CEL divides two integers as
 *    integers (`123.46` becomes `123`);
 *  - `{NOW()}` / `{TODAY()}` — CEL yields a Timestamp, not the ISO text;
 *  - `{$User.Id}` — the flow CEL scope binds no user.
 *
 * So no spelling is converted: each is refused with its remedy, and the author
 * judges the absent case the template used to decide silently. Only a token
 * with no variable in it (`{100}`) maps losslessly, and none is authored.
 *
 * ## Two spellings are KEPT, deliberately — not yet refused
 *
 * A refusal must name what to write instead, and for two spellings CEL has
 * nothing to name yet:
 *
 *  - the date macros — `{NOW()}`, `{TODAY()}`, with an optional `± N` day
 *    offset. CEL's `now()` / `today()` / `daysFromNow()` / `addDays()` yield a
 *    Timestamp, which reaches the data engine as a `Date` object rather than
 *    the ISO text the macro wrote, and CEL has no `string(timestamp)` to render
 *    one;
 *  - the run user — `{$User.<path>}`. The flow CEL scope binds no user, so
 *    `current_user.id` is an unknown variable in a flow.
 *
 * A string whose every token is one of these keeps its 17.x meaning; a string
 * that mixes one with any other token keeps it too, because the other half
 * could not be moved without it. Refusing them now would remove a capability
 * with nothing to replace it. Each is retired when CEL can spell it — a string
 * form for a Timestamp, and a user binding in the flow CEL scope.
 *
 * ## The token grammar is the interpolator's
 *
 * Which `{…}` the interpolator substitutes (`/\{([^{}]+)\}/`), and how it
 * dispatches a token — date macro, then `$User.`, then a variable path, then
 * arithmetic — are the regexes of `resolveToken` in `service-automation`'s
 * `builtin/template.ts`, copied here because the spec cannot import a
 * runtime. `value-slot-template-grammar.test.ts` in that package drives the
 * interpolator over the kept spellings and the refused ones, so the two
 * readings cannot drift apart unnoticed.
 */

import { isExpressionEnvelopeShaped, resolveFlowNodeValueSlots } from './flow-node-expression-paths';

/**
 * The one sentence every refusal of a `{…}` token in a value slot leads with —
 * the same words in every value slot and at every door (`FlowValueSlotSchema`,
 * `registerFlow`, `objectstack validate`, the executors), so an author (or an
 * agent reading the failure) meets the rule before the per-token remedy.
 */
export const VALUE_SLOT_TEMPLATE_REFUSAL =
  'A value slot no longer reads the `{…}` template dialect: a string here is the literal text it spells, so a '
  + '`{…}` token in it is refused rather than stored with its braces. Compute the value with a CEL value envelope, '
  + '`{ dialect: \'cel\', source: \'…\' }`.';

/** The interpolator's token — `interpolateString`'s `/\{([^{}]+)\}/g`. */
const TEMPLATE_TOKEN = /\{([^{}]+)\}/g;

/** `resolveToken`'s `dateFnMatch`, verbatim: `NOW()` / `TODAY()` with an optional `± N` day offset. */
const DATE_MACRO = /^(NOW|TODAY)\s*\(\s*\)\s*(?:([+\-])\s*(\S+))?$/;

/** `resolveToken`'s direct-path test, verbatim: a variable and its dotted path, numeric segments included. */
const VARIABLE_PATH = /^[A-Za-z_$][\w$]*(?:\.(?:[A-Za-z_$][\w$]*|\d+))*$/;

/** `resolveToken`'s arithmetic character set, verbatim — outside it a token resolves to nothing. */
const ARITHMETIC_CHARSET = /^[\w\s+\-*/%().,?:<>=!&|"'$]+$/;

/**
 * An operator, or a call — any name in call position. The dialect resolves
 * only its six CEL-mirrored functions and refuses every other name at run
 * time, but either way the token is an expression, and its CEL spelling is
 * the same text: an unknown name is then refused by the envelope's own CEL
 * check, with a did-you-mean.
 */
const EXPRESSION_SHAPE = /[+\-*/%<>=!&|?]|[A-Za-z_$][\w$.]*\s*\(/;

/** What the interpolator does with one token — the dispatch order of `resolveToken`. */
type TokenKind = 'date-macro' | 'user' | 'path' | 'expression' | 'unresolvable';

function tokenKind(inner: string): TokenKind {
  const trimmed = inner.trim();
  if (!trimmed) return 'unresolvable';
  if (DATE_MACRO.test(trimmed)) return 'date-macro';
  if (trimmed.startsWith('$User.')) return 'user';
  if (VARIABLE_PATH.test(trimmed)) return 'path';
  if (ARITHMETIC_CHARSET.test(trimmed) && EXPRESSION_SHAPE.test(trimmed)) return 'expression';
  return 'unresolvable';
}

/** The kinds CEL cannot spell yet, kept until it can (see the module docblock). */
const KEPT_KINDS: ReadonlySet<TokenKind> = new Set<TokenKind>(['date-macro', 'user']);

/** One `{…}` token of a string, as authored. */
interface Token {
  readonly text: string;
  readonly inner: string;
  readonly kind: TokenKind;
}

function tokensOf(value: string): Token[] {
  const out: Token[] = [];
  for (const match of value.matchAll(TEMPLATE_TOKEN)) {
    out.push({ text: match[0], inner: match[1]!.trim(), kind: tokenKind(match[1]!) });
  }
  return out;
}

/** A template path as CEL: `a.b.0` → `a.b[0]`; a `$`-named variable is read through `vars`. */
function celPath(path: string): string {
  const [head, ...rest] = path.split('.');
  let out = head!.startsWith('$') ? `vars["${head}"]` : head!;
  for (const segment of rest) out += /^\d+$/.test(segment) ? `[${segment}]` : `.${segment}`;
  return out;
}

/** A template expression as CEL: every integer divisor written as a double, so CEL divides as the template did. */
function celExpression(inner: string): string {
  return inner.replace(/\/\s*(\d+)(?![\d.])/g, '/ $1.0');
}

/** A CEL single-quoted string literal. */
function celString(text: string): string {
  return `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** How an envelope with `source` is written in the remedy — double-quoted when the source holds a single quote. */
function envelopeOf(source: string): string {
  const quoted = source.includes("'") ? JSON.stringify(source) : `'${source}'`;
  return `{ dialect: 'cel', source: ${quoted} }`;
}

/** A `has()` guard for a path whose last segment is a key — the absent-key remedy. */
function guardOf(path: string): string | undefined {
  const segments = path.split('.');
  const last = segments[segments.length - 1]!;
  if (segments[0]!.startsWith('$') || /^\d+$/.test(last)) return undefined;
  const read = segments.length === 1 ? `vars.${path}` : celPath(path);
  return `has(${read}) ? ${read} : null`;
}

const ABSENT_SENTENCE =
  'CEL refuses an absent variable or key where the template wrote nothing, so guard one that may be absent with `has()`';

/** The remedy for one string — the CEL spelling of what the template computed. */
function remedyFor(value: string, tokens: readonly Token[]): string {
  const whole = tokens.length === 1 && tokens[0]!.text === value ? tokens[0]! : undefined;
  if (tokens.some((t) => t.kind === 'unresolvable')) {
    const junk = tokens.find((t) => t.kind === 'unresolvable')!;
    return (
      `\`${junk.text}\` is neither a variable path nor an expression. If the braces are literal text, write the `
      + `value as a CEL string literal, ${envelopeOf(celString(value))}; otherwise compute it in a CEL envelope.`
    );
  }
  if (whole?.kind === 'path') {
    const guard = guardOf(whole.inner);
    return (
      `Write \`${whole.text}\` as ${envelopeOf(celPath(whole.inner))}. ${ABSENT_SENTENCE}`
      + (guard ? `: \`${guard}\` (the guarded form writes \`null\`).` : '.')
    );
  }
  if (whole?.kind === 'expression') {
    return (
      `Write \`${whole.text}\` as ${envelopeOf(celExpression(whole.inner))}. Every division keeps a decimal operand: `
      + 'CEL divides two integers as integers, so `round(x * 100) / 100` drops the decimals where '
      + '`round(x * 100) / 100.0` keeps them. ' + ABSENT_SENTENCE + '.'
    );
  }
  // Text with holes: one CEL concatenation.
  const parts: string[] = [];
  let at = 0;
  for (const match of value.matchAll(TEMPLATE_TOKEN)) {
    const literal = value.slice(at, match.index);
    if (literal) parts.push(celString(literal));
    const inner = match[1]!.trim();
    parts.push(tokenKind(inner) === 'path' ? celPath(inner) : `(${celExpression(inner)})`);
    at = (match.index ?? 0) + match[0].length;
  }
  const tail = value.slice(at);
  if (tail) parts.push(celString(tail));
  return (
    `\`${value}\` is text with holes: write it as one CEL concatenation, ${envelopeOf(parts.join(' + '))}. Wrap a `
    + 'hole that is not a string in `string(…)`, and one that may be null in `coalesce(…, \'\')` — the template '
    + 'rendered null as nothing, and CEL refuses `+ null`.'
  );
}

/** One refused string inside a value slot's value. */
export interface ValueSlotTemplateRefusal {
  /** Where the string sits inside the value — `[]` for the value itself, `['meta', 'note']`, `[0]`. */
  readonly path: readonly (string | number)[];
  /** The rule sentence, then the CEL spelling of this string's tokens. */
  readonly message: string;
  /** The refused string, as authored. */
  readonly source: string;
}

/** How {@link valueSlotTemplateRefusals} reads its value. */
export interface ValueSlotTemplateOptions {
  /**
   * The position is one of the two legacy `assignment` shapes, where an
   * envelope-shaped object is a LITERAL (the ledger does not declare them, so
   * nothing evaluates it) and its strings were interpolated like any other.
   * Default `false`: in a declared value slot a top-level envelope is an
   * expression, judged by the envelope rule and not here.
   */
  readonly envelopeIsLiteral?: boolean;
}

/**
 * Every string inside a value-slot value that carries the retired `{…}`
 * template dialect — the value itself when it is a string, and every string at
 * any depth of an array or a plain object (a literal's strings were
 * interpolated too). A top-level envelope-shaped value is not judged here: it
 * is an expression, and `FlowValueSlotSchema`'s envelope rule owns it — unless
 * {@link ValueSlotTemplateOptions.envelopeIsLiteral}. A string whose tokens
 * include a kept spelling (a date macro, a `$User` path) is not refused — see
 * the module docblock. Cycle-safe: a flow built in code may hold a
 * self-reference.
 */
export function valueSlotTemplateRefusals(
  value: unknown,
  options: ValueSlotTemplateOptions = {},
): ValueSlotTemplateRefusal[] {
  if (!options.envelopeIsLiteral && isExpressionEnvelopeShaped(value)) return [];
  const out: ValueSlotTemplateRefusal[] = [];
  const seen = new Set<object>();
  const visit = (node: unknown, path: (string | number)[]): void => {
    if (typeof node === 'string') {
      const tokens = tokensOf(node);
      if (tokens.length === 0 || tokens.some((t) => KEPT_KINDS.has(t.kind))) return;
      out.push({ path, message: `${VALUE_SLOT_TEMPLATE_REFUSAL} ${remedyFor(node, tokens)}`, source: node });
      return;
    }
    if (node === null || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) node.forEach((element, index) => visit(element, [...path, index]));
    else for (const [key, element] of Object.entries(node as Record<string, unknown>)) visit(element, [...path, key]);
  };
  visit(value, []);
  return out;
}

/** One refused string in a node's config, located for a door's report. */
export interface FlowNodeValueTemplateRefusal {
  /** Path into `node.config` — `fields.total`, `assignments.digest`, `assignments[0].value`, `total`, `fields.meta.note`. */
  readonly path: string;
  /** The slot, as a door names it — `create_record field value`, `assignment value`. */
  readonly label: string;
  /** {@link VALUE_SLOT_TEMPLATE_REFUSAL}, then the remedy. */
  readonly message: string;
  /** The refused string, as authored. */
  readonly source: string;
}

function joinPath(prefix: string, inner: readonly (string | number)[]): string {
  let out = prefix;
  for (const segment of inner) out += typeof segment === 'number' ? `[${segment}]` : (out ? `.${segment}` : segment);
  return out;
}

/**
 * Every `{…}` template-dialect refusal in one node's `config` — the call the
 * build door (`objectstack validate`) and `AutomationEngine.registerFlow`
 * share, so the two give one verdict.
 *
 * The positions are the ledger's `value` slots ({@link resolveFlowNodeValueSlots})
 * and, on an `assignment` node, the two legacy shapes its executor still
 * reads, normalised exactly as the executor normalises them: an `assignments`
 * ARRAY (`[{ variable, value }]` — each element's `value`), and, when
 * `assignments` is neither an array nor an object, the bare config whose
 * top-level keys are the variables. An envelope there is a literal, as it
 * always was, so its strings are judged like any literal's; a `{…}` token
 * there is refused like anywhere else, so the legacy shapes are no way around
 * the retirement.
 */
export function flowNodeValueTemplateRefusals(nodeType: string, config: unknown): FlowNodeValueTemplateRefusal[] {
  const out: FlowNodeValueTemplateRefusal[] = [];
  const judge = (path: string, label: string, value: unknown, envelopeIsLiteral = false): void => {
    for (const refusal of valueSlotTemplateRefusals(value, { envelopeIsLiteral })) {
      out.push({ path: joinPath(path, refusal.path), label, message: refusal.message, source: refusal.source });
    }
  };
  for (const found of resolveFlowNodeValueSlots(nodeType, config)) judge(found.path, found.entry.label, found.value);
  if (nodeType === 'assignment' && config !== null && typeof config === 'object' && !Array.isArray(config)) {
    const raw = (config as Record<string, unknown>).assignments;
    if (Array.isArray(raw)) {
      raw.forEach((item, index) => {
        if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
          judge(`assignments[${index}].value`, 'assignment value', (item as Record<string, unknown>).value, true);
        }
      });
    } else if (!(raw !== null && typeof raw === 'object')) {
      for (const [key, value] of Object.entries(config as Record<string, unknown>)) judge(key, 'assignment value', value, true);
    }
  }
  return out;
}
