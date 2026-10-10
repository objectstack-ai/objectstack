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
 *  - `{$User.Id}` — in a run with no user the template wrote nothing, while
 *    `current_user` is `null` there, so `current_user.id` fails the run and
 *    its guarded form writes `null`.
 *
 * So no spelling is converted: each is refused with its remedy, and the author
 * judges the absent case the template used to decide silently. Only a token
 * with no variable in it (`{100}`) maps losslessly, and none is authored.
 *
 * ## The run user — `{$User.<path>}` — is refused too, with two remedies
 *
 * The flow CEL scope binds `current_user` (ADR-0068's canonical root): the
 * run's `EvalUser` — `id`, `positions`, `organizationId`, `isPlatformAdmin` —
 * when the run has a user, and `null` when it has none, never a pseudo-user
 * (ADR-0118 D1, D4). So `{$User.Id}` is refused, naming `current_user.id`,
 * and for a flow that can run without a user the guard
 * `current_user != null ? current_user.id : null`, with what it changes: the
 * guarded form writes `null` where the template wrote nothing, which on
 * `update_record` clears a stored value the template left alone.
 *
 * Every other `{$User.<path>}` (`{$User.Email}`, `{$User.Name}`, …) read a
 * user object no run carries, so it never resolved in any shipped run: its
 * refusal says so, and names the read of the user record by `current_user.id`
 * for an email or a name. `current_user` carries only what the run holds.
 *
 * ## One spelling is KEPT, deliberately — not yet refused
 *
 * A refusal must name what to write instead, and for one spelling CEL has
 * nothing to name yet: the date macros — `{NOW()}`, `{TODAY()}`, with an
 * optional `± N` day offset. CEL's `now()` / `today()` / `daysFromNow()` /
 * `addDays()` yield a Timestamp, which reaches the data engine as a `Date`
 * object rather than the ISO text the macro wrote, and CEL has no
 * `string(timestamp)` to render one.
 *
 * A string whose every token is one keeps its 17.x meaning; a string that
 * mixes one with any other token keeps it too, because the other half could
 * not be moved without it. Refusing it now would remove a capability with
 * nothing to replace it. It is retired when CEL can spell it — a string form
 * for a Timestamp.
 *
 * ## The token grammar is the interpolator's
 *
 * Which `{…}` the interpolator substitutes, and how it dispatches a token, is
 * read in ONE place, `flow-template-token.ts` — shared with the text-slot
 * judge (`flow-text-slot-template.ts`, #22110), so the two retirements cannot
 * read the dialect two ways.
 */

import { isExpressionEnvelopeShaped, resolveFlowNodeValueSlots } from './flow-node-expression-paths';
import {
  CEL_KEYWORDS,
  CEL_RUN_USER_ID,
  CEL_RUN_USER_ID_GUARDED,
  TEMPLATE_TOKEN,
  celExpression,
  celHeadReadsThroughVars,
  celPath,
  isRunUserIdToken,
  runUserPathNeverResolved,
  templateTokenKind as tokenKind,
  templateTokensOf as tokensOf,
  type TemplateToken as Token,
  type TemplateTokenKind as TokenKind,
} from './flow-template-token';

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

/** The kind CEL cannot spell yet, kept until it can (see the module docblock). */
const KEPT_KINDS: ReadonlySet<TokenKind> = new Set<TokenKind>(['date-macro']);

/** A CEL single-quoted string literal. */
function celString(text: string): string {
  return `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** How an envelope with `source` is written in the remedy — double-quoted when the source holds a single quote. */
function envelopeOf(source: string): string {
  const quoted = source.includes("'") ? JSON.stringify(source) : `'${source}'`;
  return `{ dialect: 'cel', source: ${quoted} }`;
}

/**
 * A `has()` guard for a path of keys — the absent-key remedy. `has()` takes a
 * field selection over names alone: an index anywhere in its argument
 * (`has(a[0].b)`, `has(vars["$x"].y)`) is refused when it runs, so a path with
 * a numeric segment, a `$`-named head or a keyword segment gets no guard. A
 * bare variable, and a path whose head CEL or the flow scope claims
 * ({@link celHeadReadsThroughVars}), is selected off `vars`
 * (`has(vars.list.tags)`, `has(vars.vars.tags)`).
 */
function guardOf(path: string): string | undefined {
  const segments = path.split('.');
  if (segments[0]!.startsWith('$') || segments.some((s) => /^\d+$/.test(s) || CEL_KEYWORDS.has(s))) return undefined;
  const read = segments.length === 1 || celHeadReadsThroughVars(segments[0]!) ? `vars.${path}` : path;
  return `has(${read}) ? ${read} : null`;
}

const ABSENT_SENTENCE =
  'CEL refuses an absent variable or key where the template wrote nothing, so guard one that may be absent with `has()`';

/**
 * The remedy for `{$User.Id}` as a whole value: `current_user.id`, and for a
 * flow that can run without a user the guard, with what it changes.
 */
function runUserIdRemedy(text: string): string {
  return (
    `Write \`${text}\` as ${envelopeOf(CEL_RUN_USER_ID)}: \`current_user\` is the run's user. In a flow that can run `
    + 'without a user (a schedule, or a record change made by a system write) `current_user` is `null` and that '
    + `read fails the run, so write ${envelopeOf(CEL_RUN_USER_ID_GUARDED)} there. The guarded form writes \`null\` `
    + 'where the template wrote nothing, which on `update_record` clears a stored value the template left alone.'
  );
}

/** How a text-with-holes remedy writes one token, or `undefined` for a hole it leaves out. */
function holeOf(token: Token): string | undefined {
  if (token.kind === 'path') return celPath(token.inner);
  if (token.kind === 'user') return isRunUserIdToken(token.inner) ? CEL_RUN_USER_ID : undefined;
  return `(${celExpression(token.inner)})`;
}

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
  if (whole?.kind === 'user') {
    return isRunUserIdToken(whole.inner)
      ? runUserIdRemedy(whole.text)
      : runUserPathNeverResolved(whole.text, (path) => envelopeOf(path));
  }
  if (whole?.kind === 'expression') {
    return (
      `Write \`${whole.text}\` as ${envelopeOf(celExpression(whole.inner))}. Every division keeps a decimal operand: `
      + 'CEL divides two integers as integers, so `round(x * 100) / 100` drops the decimals where '
      + '`round(x * 100) / 100.0` keeps them. ' + ABSENT_SENTENCE + '.'
    );
  }
  // Text with holes: one CEL concatenation. A `$User` path other than the
  // id rendered nothing in every shipped run, so the concatenation leaves it
  // out, and a sentence after it says what to read for the value it meant.
  const parts: string[] = [];
  let at = 0;
  for (const match of value.matchAll(TEMPLATE_TOKEN)) {
    const literal = value.slice(at, match.index);
    if (literal) parts.push(celString(literal));
    const inner = match[1]!.trim();
    const hole = holeOf({ text: match[0], inner, kind: tokenKind(inner), index: match.index ?? 0 });
    if (hole !== undefined) parts.push(hole);
    at = (match.index ?? 0) + match[0].length;
  }
  const tail = value.slice(at);
  if (tail) parts.push(celString(tail));
  const sentences = [
    `\`${value}\` is text with holes: write it as one CEL concatenation, `
    + `${envelopeOf(parts.length > 0 ? parts.join(' + ') : "''")}. Wrap a `
    + 'hole that is not a string in `string(…)`, and one that may be null in `coalesce(…, \'\')` — the template '
    + 'rendered null as nothing, and CEL refuses `+ null`.',
  ];
  const seen = new Set<string>();
  for (const token of tokens) {
    if (token.kind !== 'user' || seen.has(token.text)) continue;
    seen.add(token.text);
    sentences.push(
      isRunUserIdToken(token.inner)
        ? `\`${token.text}\` is \`${CEL_RUN_USER_ID}\`, the run's user. In a flow that can run without a user `
          + '`current_user` is `null` and that read fails the run, so write the hole as '
          + '`(current_user != null ? current_user.id : \'\')` there, which renders nothing where the template did.'
        : `${runUserPathNeverResolved(token.text, (path) => `\`${path}\``)} The concatenation above leaves it out, `
          + 'as the template did.',
    );
  }
  return sentences.join(' ');
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
 * include the kept spelling (a date macro) is not refused — see
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
