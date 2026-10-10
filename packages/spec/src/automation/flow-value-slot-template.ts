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
 * AND the shipped CEL engine over the same variables, and each one but the
 * plainest date macros (below) has an input on which the two answers differ:
 *
 *  - a path (`{x}`, `{a.b}`, `{list.0}`) — CEL refuses an absent variable,
 *    key or index where the template wrote nothing;
 *  - text with holes (`'Hello {o.name}'`) — CEL refuses `+ null` where the
 *    template rendered nothing;
 *  - arithmetic (`{round(x * 100) / 100}`) — CEL divides two integers as
 *    integers (`123.46` becomes `123`);
 *  - `{$User.Id}` — in a run with no user the template wrote nothing, while
 *    `current_user` is `null` there, so `current_user.id` fails the run and
 *    its guarded form writes `null`;
 *  - a date macro with an offset the template read as 0 — a variable it did
 *    not find, a value that is not a number, text that is neither — or a
 *    fraction, which the two engines truncate at different places.
 *
 * So no spelling is converted: each is refused with its remedy, and the author
 * judges the absent case the template used to decide silently. Only a token
 * with no variable in it (`{100}`) maps losslessly, and none is authored —
 * and the date macros with no offset or a whole-number one, whose CEL
 * spelling (below) writes their text byte for byte. They are refused with
 * that spelling like every other token: one dialect per slot, and the ruling
 * for this retirement refuses rather than rewrites.
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
 * ## The date macros — `{NOW()}`, `{TODAY()}`, `± N` days — are refused too
 *
 * The CEL stdlib writes a Timestamp as the text the macros wrote: `isoDate(t)`
 * (`YYYY-MM-DD`) and `isoDatetime(t)` (`YYYY-MM-DDTHH:mm:ss.sssZ`), on the UTC
 * calendar. So `{TODAY()}` is `isoDate(today())`, `{TODAY() + N}` /
 * `{TODAY() - N}` are `isoDate(daysFromNow(N))` / `isoDate(daysAgo(N))`,
 * `{NOW()}` is `isoDatetime(now())`, and `{NOW() ± N}` is
 * `isoDatetime(addDays(now(), ±N))` — `daysFromNow` would land on midnight.
 * The refusal names where the template and its spelling part: a fractional
 * offset, a variable offset the template silently read as 0, and an offset
 * that is neither (`celDateMacro` in the token module). No spelling is kept:
 * a value slot reads no `{…}` token at all.
 *
 * ## Where an envelope is literal data, the remedy names none
 *
 * An envelope evaluates only as the TOP-LEVEL value of a declared slot — the
 * `assignments` map's values and the `fields` map's values. Two positions this
 * judge reads hold data instead, as the executors read them: a string INSIDE
 * an object or list literal (`fields.payload.note`, `assignments.o.who`), and
 * either legacy `assignment` shape (an `assignments` ARRAY element's `value`,
 * the bare config's keys). An envelope written there is stored as the object
 * it spells, so the refusal there prescribes none: a nested string's remedy
 * builds the WHOLE value as one envelope, a CEL map or list literal holding
 * the string's CEL spelling at its place; a legacy shape's remedy moves the
 * node's assignments into the canonical map, where an envelope evaluates.
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
  celDateMacro,
  celExpression,
  celHeadReadsThroughVars,
  celPath,
  isRunUserIdToken,
  runUserPathNeverResolved,
  templateTokenKind as tokenKind,
  templateTokensOf as tokensOf,
  type TemplateToken as Token,
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

/** A CEL single-quoted string literal. */
function celString(text: string): string {
  return `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** How an envelope with `source` is written in the remedy — double-quoted when the source holds a single quote. */
function envelopeOf(source: string): string {
  const quoted = source.includes("'") ? JSON.stringify(source) : `'${source}'`;
  return `{ dialect: 'cel', source: ${quoted} }`;
}

/** How a CEL source is named where no envelope may be written — a code span. */
function spanOf(source: string): string {
  return `\`${source}\``;
}

/**
 * How a remedy writes a CEL source: as an envelope where the position
 * evaluates one, and as a bare CEL spelling inside the literal that builds the
 * whole value where it does not ({@link literalPositionLead}).
 */
type Write = (source: string) => string;

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
function runUserIdRemedy(text: string, write: Write): string {
  return (
    `Write \`${text}\` as ${write(CEL_RUN_USER_ID)}: \`current_user\` is the run's user. In a flow that can run `
    + 'without a user (a schedule, or a record change made by a system write) `current_user` is `null` and that '
    + `read fails the run, so write ${write(CEL_RUN_USER_ID_GUARDED)} there. The guarded form writes \`null\` `
    + 'where the template wrote nothing, which on `update_record` clears a stored value the template left alone.'
  );
}

/** The remedy for a date macro as a whole value — its CEL string form, and where the two part. */
function dateMacroRemedy(token: Token, write: Write): string {
  const macro = celDateMacro(token.inner)!;
  const today = /^TODAY/.test(token.inner);
  const offset = /[+-]/.test(token.inner);
  return (
    `Write \`${token.text}\` as ${write(macro.source)}: \`${today ? 'isoDate' : 'isoDatetime'}\` writes the `
    + `${today ? 'date' : 'timestamp'} as the ISO text the macro wrote, on the UTC calendar.`
    + (!today && offset ? ' `addDays(now(), …)` keeps the time of day, where `daysFromNow` would land on midnight.' : '')
    + (macro.edge ? ` ${macro.edge}` : '')
  );
}

/** How a text-with-holes remedy writes one token, or `undefined` for a hole it leaves out. */
function holeOf(token: Token): string | undefined {
  if (token.kind === 'path') return celPath(token.inner);
  if (token.kind === 'user') return isRunUserIdToken(token.inner) ? CEL_RUN_USER_ID : undefined;
  if (token.kind === 'date-macro') return celDateMacro(token.inner)!.source;
  return `(${celExpression(token.inner)})`;
}

/** `value` with no token kind of its own as one string — the string, as text with holes. */
function concatenationOf(value: string): string {
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
  return parts.length > 0 ? parts.join(' + ') : "''";
}

/** The one token `value` is, when it is nothing but that token. */
function wholeTokenOf(value: string, tokens: readonly Token[]): Token | undefined {
  return tokens.length === 1 && tokens[0]!.text === value ? tokens[0] : undefined;
}

/**
 * The CEL source whose value is what the template wrote for `value` — the
 * spelling a literal-data position holds inside the whole value's literal —
 * or `undefined` for a `$User` path that never resolved, which has none.
 */
function celSourceOf(value: string, tokens: readonly Token[]): string | undefined {
  if (tokens.some((t) => t.kind === 'unresolvable')) return celString(value);
  const whole = wholeTokenOf(value, tokens);
  if (!whole) return concatenationOf(value);
  if (whole.kind === 'path') return celPath(whole.inner);
  if (whole.kind === 'user') return isRunUserIdToken(whole.inner) ? CEL_RUN_USER_ID : undefined;
  if (whole.kind === 'date-macro') return celDateMacro(whole.inner)!.source;
  return celExpression(whole.inner);
}

/** The remedy for one string — the CEL spelling of what the template computed, written by `write`. */
function remedyFor(value: string, tokens: readonly Token[], write: Write): string {
  const whole = wholeTokenOf(value, tokens);
  if (tokens.some((t) => t.kind === 'unresolvable')) {
    const junk = tokens.find((t) => t.kind === 'unresolvable')!;
    return (
      `\`${junk.text}\` is neither a variable path nor an expression. If the braces are literal text, write the `
      + `value as a CEL string literal, ${write(celString(value))}; otherwise compute it in CEL.`
    );
  }
  if (whole?.kind === 'path') {
    const guard = guardOf(whole.inner);
    return (
      `Write \`${whole.text}\` as ${write(celPath(whole.inner))}. ${ABSENT_SENTENCE}`
      + (guard ? `: \`${guard}\` (the guarded form writes \`null\`).` : '.')
    );
  }
  if (whole?.kind === 'user') {
    return isRunUserIdToken(whole.inner)
      ? runUserIdRemedy(whole.text, write)
      : runUserPathNeverResolved(whole.text, write);
  }
  if (whole?.kind === 'date-macro') return dateMacroRemedy(whole, write);
  if (whole?.kind === 'expression') {
    return (
      `Write \`${whole.text}\` as ${write(celExpression(whole.inner))}. Every division keeps a decimal operand: `
      + 'CEL divides two integers as integers, so `round(x * 100) / 100` drops the decimals where '
      + '`round(x * 100) / 100.0` keeps them. ' + ABSENT_SENTENCE + '.'
    );
  }
  // Text with holes: one CEL concatenation. A `$User` path other than the
  // id rendered nothing in every shipped run, so the concatenation leaves it
  // out, and a sentence after it says what to read for the value it meant. A
  // date macro is its string form, and where that parts from the template it
  // says so.
  const sentences = [
    `\`${value}\` is text with holes: write it as one CEL concatenation, ${write(concatenationOf(value))}. Wrap a `
    + 'hole that is not a string in `string(…)`, and one that may be null in `coalesce(…, \'\')` — the template '
    + 'rendered null as nothing, and CEL refuses `+ null`.',
  ];
  const seen = new Set<string>();
  for (const token of tokens) {
    if (seen.has(token.text)) continue;
    seen.add(token.text);
    if (token.kind === 'user') {
      sentences.push(
        isRunUserIdToken(token.inner)
          ? `\`${token.text}\` is \`${CEL_RUN_USER_ID}\`, the run's user. In a flow that can run without a user `
            + '`current_user` is `null` and that read fails the run, so write the hole as '
            + '`(current_user != null ? current_user.id : \'\')` there, which renders nothing where the template did.'
          : `${runUserPathNeverResolved(token.text, spanOf)} The concatenation above leaves it out, `
            + 'as the template did.',
      );
    } else if (token.kind === 'date-macro') {
      const macro = celDateMacro(token.inner)!;
      sentences.push(
        `\`${token.text}\` is \`${macro.source}\`, the ISO text the macro wrote on the UTC calendar.`
        + (macro.edge ? ` ${macro.edge}` : ''),
      );
    }
  }
  return sentences.join(' ');
}

/** A CEL map or list literal holding `source` at `path`, as the example of a whole value built in CEL. */
function literalAlong(path: readonly (string | number)[], source: string): string {
  let out = source;
  for (let at = path.length - 1; at >= 0; at--) {
    const segment = path[at]!;
    out = typeof segment === 'number' ? `[${out}]` : `{${celString(segment)}: ${out}}`;
  }
  return out;
}

/**
 * What a refusal says first at a position where an envelope is literal data
 * (see the module docblock): a legacy `assignment` shape, and a string inside
 * an object or list literal. `undefined` at a position that evaluates one.
 */
function literalPositionLead(
  value: string,
  tokens: readonly Token[],
  path: readonly (string | number)[],
  legacy: boolean,
): string | undefined {
  if (!legacy && path.length === 0) return undefined;
  const sentences: string[] = [];
  if (legacy) {
    sentences.push(
      'This `assignment` shape — the legacy `assignments: [{ variable, value }]` array, or variables written as '
      + 'the config\'s own keys — evaluates nothing: an envelope written in it is stored as the object it spells. '
      + 'Move the node\'s assignments into the canonical map, `assignments: { … }`, whose values an envelope '
      + 'computes, and write this variable there' + (path.length === 0 ? ':' : '.'),
    );
  }
  if (path.length > 0) {
    const source = celSourceOf(value, tokens);
    sentences.push(
      `\`${value}\` sits inside an object or list literal, where nothing evaluates: an envelope written in its `
      + 'place is stored as the object it spells. Compute the whole value as one CEL envelope that builds it, a '
      + 'CEL map or list literal holding this string\'s CEL spelling at its place, with the value\'s other entries '
      + 'beside it'
      + (source !== undefined ? ` — for this string alone, ${envelopeOf(literalAlong(path, source))}.` : '.')
      + ' CEL holds every value of one map, and every element of one list, to one type: where they mix — a '
      + 'literal beside a computed value included — wrap each one in `dyn(…)`. The spelling:',
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
   * nothing evaluates it) and its strings were interpolated like any other —
   * so a refusal there names the canonical map, where an envelope evaluates,
   * rather than an envelope at the position itself.
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
 * {@link ValueSlotTemplateOptions.envelopeIsLiteral}. No token is kept: the
 * date macros are refused with their CEL string form, like every other token
 * (see the module docblock). A string inside an object or list literal, or in
 * a legacy shape, sits where an envelope is data, so its remedy names the
 * envelope that builds the whole value or the canonical map instead.
 * Cycle-safe: a flow built in code may hold a self-reference.
 */
export function valueSlotTemplateRefusals(
  value: unknown,
  options: ValueSlotTemplateOptions = {},
): ValueSlotTemplateRefusal[] {
  const legacy = options.envelopeIsLiteral === true;
  if (!legacy && isExpressionEnvelopeShaped(value)) return [];
  const out: ValueSlotTemplateRefusal[] = [];
  const seen = new Set<object>();
  const visit = (node: unknown, path: (string | number)[]): void => {
    if (typeof node === 'string') {
      const tokens = tokensOf(node);
      if (tokens.length === 0) return;
      const lead = literalPositionLead(node, tokens, path, legacy);
      const remedy = lead === undefined
        ? remedyFor(node, tokens, envelopeOf)
        : `${lead} ${remedyFor(node, tokens, path.length > 0 ? spanOf : envelopeOf)}`;
      out.push({ path, message: `${VALUE_SLOT_TEMPLATE_REFUSAL} ${remedy}`, source: node });
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
 * the retirement — and its remedy moves the node's assignments into the
 * canonical map, the one shape whose values an envelope computes.
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
