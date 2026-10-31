// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @module automation/flow-value-slot-template
 *
 * **The `{…}` template dialect, retired from flow VALUE slots** (#19939 — the
 * C half of #11182 ruling D, on the protocol-18 line).
 *
 * A value slot is a config position whose authored value BECOMES a value: the
 * expression ledger's `value` role (`assignment.assignments.*`,
 * `create_record.fields.*`, `update_record.fields.*`, the three maps a node
 * hands to a callee — `subflow.input.*`, `map.input.*`, `script.inputs.*` —
 * a `screen`'s three positions that hand a value to the client —
 * `defaults.*`, `fields[].defaultValue`, `recordId` — the list a `loop`
 * and a `map` iterate, their `collection` — a `notify` node's computed
 * values — `recipients` (each entry of a list), `templateData.*` and
 * `sourceId` — an `http` node's `body` — and each operand of a CRUD node's
 * `filter` — `FLOW_NODE_EXPRESSION_PATHS`), plus the two legacy
 * `assignment` shapes the executor still reads (the
 * `assignments: [{ variable, value }]` array and the bare
 * `{ <variable>: <value> }` config). Until this retirement every string
 * there ran through `{token}` interpolation, and since #19938 the same slots
 * also evaluate a CEL value envelope — two dialects for one job, with two
 * function sets and two meanings of `/`. This module is the ONE judge of the
 * retirement: a value that carries a `{…}` token the interpolator would
 * resolve is REFUSED, and the refusal names the CEL spelling of each token.
 * `FlowValueSlotSchema` composes it (so the contract says it), and
 * `AutomationEngine.registerFlow`, `objectstack validate` and the executors
 * call it — ⛔ never a second reading of the dialect anywhere.
 *
 * ## The doors that run it — and why `FlowSchema.parse` is not one (#23320)
 *
 * The judge runs at every door that reports a flow's refusals per slot:
 * `AutomationEngine.registerFlow`, after its parse; the `validateStackExpressions`
 * rule (`expression-invalid` at `error`), which `objectstack validate`,
 * `objectstack compile` and the runtime publish gate of an `active` metadata
 * save run; and every run, through the node contracts that compose
 * `FlowValueSlotSchema` and the `assignment` executor's own call. The flow
 * parse does NOT run it: `FlowSchema.parse`, and so `defineStack`,
 * `ObjectStackDefinitionSchema`, the `flow` metadata type's schema and an
 * artifact's parse, accept a value-slot token. The parse
 * parses the node contracts too (`flowNodeConfigRefusals`' value arm), and
 * that arm stands aside at exactly the paths this judge refuses
 * (`slotJudgeRefusedPaths`, #23260), so the parse leaves the token to the
 * doors above, on purpose. Two measured reasons, taken by running this judge
 * and the text-slot judge in `FlowSchema`'s refinement and reverting it:
 *
 *  - **The located refusal.** `registerFlow` parses first, and a parse
 *    refusal reaches its caller as the parse's own issue list. A token
 *    refused at the parse would replace `registerFlow`'s located line — the
 *    node's id and type, the slot's label, the config path, the remedy and the
 *    `source:` — at registration and in the boot's log, and `objectstack
 *    validate` and `objectstack compile`, which parse the stack before their
 *    rules run, would stop at the parse before the `expression-invalid`
 *    finding. Those doors' pins of the located refusal went red.
 *  - **The stored pass.** The parse is also the stored-flow canonicalization
 *    (`AutomationEngine.canonicalizeStoredFlow`) that `os migrate meta
 *    --stored` runs on each flow row, and a parse refusal reports the row
 *    `failed`, which flips `storedMigrationClean`: a non-zero exit that no run
 *    of the command can clear, because no conversion rewrites the token (the
 *    next section). A refusal after the parse is listed instead, as a TODO —
 *    a value-slot site under the step-18 D3 entry
 *    `flow-value-slot-template-dialect-refused` (`conversions/refused-shapes.ts`),
 *    a text-slot site under `registerFlow` — and the verdict does not move.
 *    The pins that a braced slot parses and is listed went red.
 *
 * What this leaves: a stack built by `defineStack` and handed to none of those
 * doors — `os dev` and `os serve` load it and boot — reaches `registerFlow` at
 * boot, which refuses the flow with its located line and does not register it.
 * The judge can join the parse once `registerFlow` reports a parse refusal as
 * located as its own and the stored pass lists a slot the parse refuses
 * rather than failing its row; the contract arm's exemption then keeps each
 * token reported once.
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
 *    fraction, which the two engines truncate at different places;
 *  - a `loop` or `map` `collection` (#19939): an absent variable fails the node
 *    either way, but as a returned failure under the template (the step's
 *    `NODE_FAILURE`, "did not resolve to an array") and as an evaluation fault
 *    under CEL (`EXECUTION_ERROR`, naming the variable) — and a variable's bare
 *    name there, which the structured `loop` and `map` never read (every run
 *    failed at the node), would iterate under an envelope.
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
 * ## A callee's input — the guarded form SUPPLIES `null`
 *
 * Three value slots hand their map to a callee as its inputs: a `subflow`'s
 * and a `map`'s `input` (the child flow's input variables — each item's child,
 * for a `map`) and a `script`'s `inputs` (the registered function's `input`).
 * There a whole token that resolved to nothing handed the callee NOTHING —
 * the template wrote `undefined` — and the child flow then seeded the
 * variable from its `defaultValue` (`AutomationEngine.seedDeclaredVariables`
 * applies the default only when the supplied value is `undefined`). The
 * guarded form the remedy names hands `null` instead, and a supplied `null` is
 * a value: it wins over the default. So at a top-level value of those maps,
 * where the remedy names a guard or a run-user read, the refusal adds the
 * callee sentence: write the child variable's default in the guard's `null`
 * branch to keep it, or leave the key out where the value is never meant to
 * be supplied — and, for a function, that it is handed `null` where it was
 * handed `undefined`. A `$User` path that never resolved handed nothing in
 * every run, so there the callee sentence says the default applied every
 * time, and leaving the key out keeps exactly that. The positions are the
 * ledger's (`CALLEE_INPUT_SLOTS`, keyed by the entry), so the sentence
 * reaches the build doors through {@link flowNodeValueTemplateRefusals}; the
 * executor's contract parse, which judges a value with no position, names the
 * remedy without it.
 *
 * ## A screen's prefill and record id — evaluated before the screen is served
 *
 * Three value slots hand their value to the CLIENT: an object form's
 * `defaults` (its fields' prefill), a flat field's `defaultValue`, and an
 * object form's `recordId` (the record `edit` mode opens). The `screen`
 * executor evaluates each envelope before the screen goes on the wire, so the
 * client receives the value, never the envelope. Where a whole token resolved
 * to nothing, the template served NOTHING there, and each position answers
 * the guarded form's `null` its own way, so the refusal at a top-level value
 * adds the screen sentence (`SCREEN_VALUE_SLOTS`, keyed by the ledger entry):
 *
 *  - `defaults.<field>`: the object form seeded a field the prefill left out
 *    from the object's declared `defaultValue`, and takes a `null` prefill as
 *    a value — it opens the field blank over that default. So: write the
 *    default in the guard's `null` branch to keep it.
 *  - `fields[i].defaultValue`: the screen now carries `null` where it carried
 *    nothing, which a client seeds the field with and submits back.
 *  - `recordId`: it must evaluate to the record's id, a non-blank string; the
 *    executor refuses anything else at the screen, `null` included, where the
 *    template served the screen with no record id (an `edit` form then opens
 *    empty and cannot save). So: route around a screen whose record may be
 *    absent rather than guarding the id.
 *
 * A `$User` path that never resolved served nothing in every run, and the
 * sentence says leaving the value out keeps exactly that.
 *
 * ## A `loop`'s or a `map`'s collection — the list must be one
 *
 * A `collection` is the list the node iterates (`COLLECTION_SLOTS`, keyed by
 * the ledger entry). Its literal is an inline array, iterated AS WRITTEN: the
 * executors never interpolated one, so its strings are data, and this judge
 * reads only the value itself — a string carrying a token. The remedy is the
 * collection's own ({@link ValueSlotTemplateOptions.collection}): the value
 * must evaluate to a list, and anything else fails the node, as a whole token
 * that resolved to nothing did under the template, so a guard answers `[]` —
 * iterating nothing — rather than `null`, which fails the node too. Any other
 * token never computed a list (the template wrote text or a single value
 * there), so every run failed at the node, and the refusal says so rather
 * than spelling a concatenation or a date no list can be. A token-free
 * string is a variable's bare name or no list at all; the collection's
 * contract refuses it (`FlowCollectionSlotSchema`), not this judge.
 *
 * ## A `notify` node's recipients — dropped when `null`, flattened when a list
 *
 * `recipients` is one value or a list of them (the ledger's `eachElement`), so
 * this judge reads each entry of a list at its own index (`recipients[1]`), as
 * a top-level value, where an envelope evaluates. At such a position a refused
 * whole token's remedy ends with the recipient sentence (`RECIPIENT_SLOTS`):
 * an envelope that evaluates to `null` or a blank string adds no recipient, as
 * the template dropped a token that resolved to nothing, and one that
 * evaluates to a list adds each of its recipients — the template handed a
 * whole token holding a list, written as a list entry, on as ONE recipient
 * joined with commas.
 *
 * ## A CRUD node's filter operands — the query placeholders stay
 *
 * Each operand of a `get_record`, `update_record` or `delete_record` node's
 * `filter` is a value slot (the ledger's `filterOperands`, read through
 * `flowFilterOperands`): a field's value, an operator's comparand, each element
 * of a list comparand. Two `{…}` vocabularies met there, and the 17.x executor
 * told them apart at run time: a flow token resolved against the run's
 * variables, and a whole-string token no variable resolved that IS a query
 * placeholder (`{current_user_id}`, `{today}`, `{30_days_ago}` —
 * `isKnownFilterToken`) was handed to the query engine untouched. The
 * placeholders stay — they are the query-filter surface, which the query
 * engine resolves and ADR-0032 puts out of its scope — and the flow token is
 * retired, so the split is now static and is drawn by ONE classifier,
 * {@link classifyFlowFilterOperandString}: a whole-string placeholder the query
 * engine resolves passes, and every other string carrying a `{…}` token is
 * refused with its CEL spelling (judged with
 * {@link ValueSlotTemplateOptions.filterOperand}). A flow variable that shares
 * a placeholder's name no longer shadows it: the placeholder is the query
 * engine's, and the variable is read with an envelope.
 *
 * Where a whole token resolved to nothing, the 17.x executor refused the node
 * — an absent condition does not narrow a query, it widens it (#3810) — and so
 * does an operand envelope that evaluates to `null`. So the remedy at a filter
 * operand names no guard that answers `null`: where the value may be absent,
 * the node is routed around.
 *
 * ## The token grammar is the interpolator's
 *
 * Which `{…}` the interpolator substitutes, and how it dispatches a token, is
 * read in ONE place, `flow-template-token.ts` — shared with the text-slot
 * judge (`flow-text-slot-template.ts`, #22110), so the two retirements cannot
 * read the dialect two ways.
 */

import {
  isExpressionEnvelopeShaped,
  resolveFlowNodeValueSlots,
  type FlowNodeExpressionBlock,
  type FlowNodeSiblingBlocks,
} from './flow-node-expression-paths';
// [#19939] The query placeholders a flow filter operand hands on untouched —
// the vocabulary the query engine's own resolver reads (`resolveFilterTokens`
// in `@objectstack/core`), never re-spelled here.
import { FILTER_TOKEN_WRAPPED_RE, classifyFilterToken, isKnownFilterToken } from '../data/context-tokens.zod';
import {
  CEL_KEYWORDS,
  CEL_RUN_USER_ID,
  CEL_RUN_USER_ID_GUARDED,
  TEMPLATE_TOKEN,
  celDateMacro,
  celExpression,
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
 * A `has()` guard for a path of keys — the absent-variable and absent-key
 * remedy. `has()` refuses an index as the last step of its argument
 * (`has(a[0])`, `has(vars["$x"])`) when it runs; an index before the last
 * step is a presence test like any other (`has(a[0].b)`). The guard tests
 * every step of the path, and a numeric segment, a `$`-named head or a keyword
 * segment is read by index, so one of its tests would end on that index: such
 * a path gets no guard.
 *
 * The guard tests one step at a time, from `vars`, which holds only the
 * variables the run has bound: `has(vars.source) && has(vars.source.id) ?
 * vars.source.id : null`. `has()` evaluates everything but its last selection,
 * so `has(source.id)` fails the run (`Unknown variable`) when `source` was
 * never bound — an `isInput` variable the caller left out, with no default —
 * and `has(vars.source.id)` fails it too (`No such key`). The chain answers
 * `null` there, and where a key on the way is absent, `null`, or not a map
 * (`&&` stops at the first `false`). A path whose head CEL or the flow scope
 * claims (`celHeadReadsThroughVars` in the token module) is selected off
 * `vars` like any other (`has(vars.list) && has(vars.list.tags)`).
 */
function guardOf(path: string, fallback = 'null'): string | undefined {
  const segments = path.split('.');
  if (segments[0]!.startsWith('$') || segments.some((s) => /^\d+$/.test(s) || CEL_KEYWORDS.has(s))) return undefined;
  const steps = segments.map((_, at) => `vars.${segments.slice(0, at + 1).join('.')}`);
  return `${steps.map((step) => `has(${step})`).join(' && ')} ? ${steps[steps.length - 1]} : ${fallback}`;
}

const ABSENT_SENTENCE =
  'CEL refuses an absent variable or key where the template wrote nothing, so guard one that may be absent with '
  + '`has()`, a step at a time from `vars`, which holds only the variables the run has bound';

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

/**
 * The remedy for a `{…}` token at a `loop`'s or a `map`'s `collection` (see the
 * module docblock): a whole variable path is that path in an envelope, with a
 * guard answering `[]` where the list may be absent; any other token never
 * computed a list.
 */
function collectionRemedy(value: string, tokens: readonly Token[]): string {
  const whole = wholeTokenOf(value, tokens);
  if (whole?.kind !== 'path') {
    return (
      `\`${value}\` never computed a list: the template wrote text or a single value here, so every run failed at `
      + 'this node. Name the list in a CEL value envelope, `{ dialect: \'cel\', source: \'…\' }`, or write the items '
      + 'as an inline array.'
    );
  }
  const guard = guardOf(whole.inner, '[]');
  return (
    `Write \`${whole.text}\` as ${envelopeOf(celPath(whole.inner))}. \`collection\` must evaluate to a list, and `
    + 'anything else fails the node — an absent variable or key included, which CEL refuses where the token '
    + 'resolved to nothing and failed the node as well'
    + (guard === undefined
      ? '.'
      : `. Where the list may be absent, a guard answering \`[]\` iterates nothing instead: \`${guard}\`.`)
  );
}

/**
 * [#19939] What a string at an operand of a CRUD node's `filter` is — the ONE
 * classifier the node contracts, `AutomationEngine.registerFlow`,
 * `objectstack validate` and the executors' contract parse all read, through
 * {@link valueSlotTemplateRefusals} (see the module docblock, "A CRUD node's
 * filter operands"):
 *
 *  - `'placeholder'` — the whole string is ONE query placeholder the query
 *    engine resolves on the server, a context token or a date macro
 *    (`isKnownFilterToken`), in the wrapped spelling its resolver recognises
 *    (`FILTER_TOKEN_WRAPPED_RE`: `{today}`, `${today}`). Handed to the query
 *    untouched, as the 17.x executor handed a placeholder no flow variable
 *    resolved — and now whatever the run's variables hold: no flow token is
 *    read here, so none shadows it;
 *  - `'flow-token'` — any other string carrying a `{…}` token of the retired
 *    flow template dialect (`TEMPLATE_TOKEN`). Refused, with its CEL spelling;
 *  - `'literal'` — a string with no `{…}` token, handed to the query as
 *    written.
 *
 * A record page's placeholder (`{record_id}`) is not one the server resolves
 * — the query engine refuses it on every server path — so here it is a token
 * of the flow dialect like any other, as the 17.x executor read it.
 */
export type FlowFilterOperandStringKind = 'placeholder' | 'flow-token' | 'literal';

/** Classify one string at a filter operand — see {@link FlowFilterOperandStringKind}. */
export function classifyFlowFilterOperandString(value: string): FlowFilterOperandStringKind {
  const wrapped = FILTER_TOKEN_WRAPPED_RE.exec(value);
  if (wrapped !== null && isKnownFilterToken(wrapped[1]!)) return 'placeholder';
  return tokensOf(value).length > 0 ? 'flow-token' : 'literal';
}

/**
 * The query placeholder a refused whole-string token at a filter operand
 * resembles, when it resembles one the server resolves — the placeholder
 * written with spaces inside its braces, or a near-miss the placeholder
 * vocabulary's own suggestion table names (`{current_user}` →
 * `{current_user_id}`) — or `undefined`.
 */
function placeholderSuggestion(value: string): string | undefined {
  const wrapped = FILTER_TOKEN_WRAPPED_RE.exec(value);
  if (wrapped === null) return undefined;
  const trimmed = wrapped[1]!.trim();
  if (trimmed !== wrapped[1] && isKnownFilterToken(trimmed)) return `{${trimmed}}`;
  const verdict = classifyFilterToken(value);
  if (verdict?.kind !== 'unknown' || verdict.suggestion === undefined) return undefined;
  return isKnownFilterToken(verdict.suggestion) ? `{${verdict.suggestion}}` : undefined;
}

/**
 * What an operand envelope that evaluates to nothing does — the #3810 refusal,
 * kept — and so why a filter operand's remedy names no guard answering `null`.
 */
const FILTER_OPERAND_ABSENT_SENTENCE =
  'An operand that evaluates to `null` refuses the node, as a token that resolved to nothing did — an absent '
  + 'condition does not narrow a query, it widens it — and CEL refuses an absent variable or key outright, so '
  + 'where the value may be absent, route around the node with a `decision` rather than guarding it.';

/**
 * The remedy for a `{…}` token at a filter operand (see the module docblock,
 * "A CRUD node's filter operands"): the operand's CEL envelope, evaluated
 * before the query, and — where the value may be absent — what `null` does
 * there, since a guard answering `null` refuses the node; then the query
 * placeholder the token resembles, if any.
 */
function filterOperandRemedy(value: string, tokens: readonly Token[]): string {
  const whole = wholeTokenOf(value, tokens);
  const sentences: string[] = [];
  if (whole?.kind === 'path') {
    sentences.push(
      `Write \`${whole.text}\` as ${envelopeOf(celPath(whole.inner))}: an operand envelope is evaluated before the `
      + 'query.',
      FILTER_OPERAND_ABSENT_SENTENCE,
    );
  } else if (whole?.kind === 'expression') {
    sentences.push(
      `Write \`${whole.text}\` as ${envelopeOf(celExpression(whole.inner))}: an operand envelope is evaluated before `
      + 'the query. Every division keeps a decimal operand: CEL divides two integers as integers, so '
      + '`round(x * 100) / 100` drops the decimals where `round(x * 100) / 100.0` keeps them.',
      FILTER_OPERAND_ABSENT_SENTENCE,
    );
  } else if (whole?.kind === 'user' && isRunUserIdToken(whole.inner)) {
    sentences.push(
      `Write \`${whole.text}\` as ${envelopeOf(CEL_RUN_USER_ID)}: \`current_user\` is the run's user. In a flow that `
      + 'can run without a user (a schedule, or a record change made by a system write) `current_user` is `null` '
      + 'and that read fails the run, so skip the node there with a `decision` on `current_user != null`: an '
      + 'operand that evaluates to `null` refuses the node.',
    );
  } else {
    sentences.push(remedyFor(value, tokens, envelopeOf));
  }
  const placeholder = placeholderSuggestion(value);
  if (placeholder !== undefined) {
    sentences.push(`If you meant the query placeholder \`${placeholder}\`, write it so: the query engine resolves it.`);
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
  /**
   * [#19939] The position is a `loop`'s or a `map`'s `collection`, the list
   * the node iterates, whose literal is an inline array iterated AS WRITTEN —
   * never interpolated — so only the value itself is judged: a string
   * carrying a `{…}` token is refused with the collection's remedy (see the
   * module docblock), and an array, a token-free string and every other value
   * are left to the collection's contract. Default `false`.
   */
  readonly collection?: boolean;
  /**
   * [#19939] The position is an operand of a CRUD node's `filter` (the
   * ledger's `filterOperands`): a string that is one whole query placeholder
   * ({@link classifyFlowFilterOperandString}) is the query engine's and is not
   * judged, at any depth, and every other `{…}` token is refused with the
   * filter operand's remedy, which names no guard answering `null` — an
   * operand that evaluates to `null` refuses the node. Default `false`.
   */
  readonly filterOperand?: boolean;
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
  if (options.collection === true) {
    if (typeof value !== 'string') return [];
    const tokens = tokensOf(value);
    if (tokens.length === 0) return [];
    return [{ path: [], message: `${VALUE_SLOT_TEMPLATE_REFUSAL} ${collectionRemedy(value, tokens)}`, source: value }];
  }
  const legacy = options.envelopeIsLiteral === true;
  const filter = options.filterOperand === true;
  if (!legacy && isExpressionEnvelopeShaped(value)) return [];
  const out: ValueSlotTemplateRefusal[] = [];
  const seen = new Set<object>();
  const visit = (node: unknown, path: (string | number)[]): void => {
    if (typeof node === 'string') {
      // [#19939] At a filter operand a whole query placeholder is the query
      // engine's, handed on untouched — the one classifier decides.
      if (filter && classifyFlowFilterOperandString(node) === 'placeholder') return;
      const tokens = tokensOf(node);
      if (tokens.length === 0) return;
      const lead = literalPositionLead(node, tokens, path, legacy);
      const remedy = lead === undefined
        ? (filter ? filterOperandRemedy(node, tokens) : remedyFor(node, tokens, envelopeOf))
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
  /**
   * [#27968] The node block {@link FlowNodeValueTemplateRefusal.path} is inside:
   * `config`, or — for a `connector_action` node's `input` map — `connectorConfig`.
   */
  readonly block: FlowNodeExpressionBlock;
  /**
   * Path into the node's {@link FlowNodeValueTemplateRefusal.block} — `fields.total`, `assignments.digest`,
   * `assignments[0].value`, `total`, `fields.meta.note`, `input.ticket`.
   */
  readonly path: string;
  /** The slot, as a door names it — `create_record field value`, `assignment value`. */
  readonly label: string;
  /** {@link VALUE_SLOT_TEMPLATE_REFUSAL}, then the remedy. */
  readonly message: string;
  /** The refused string, as authored. */
  readonly source: string;
}

/**
 * Who receives a value slot's map, for the slots that hand it to a callee —
 * keyed by the ledger entry (`<nodeType> <path>`), so the sentence follows
 * the ledger's declaration rather than a second list of node types (see the
 * module docblock, "A callee's input").
 */
type Callee = 'child-flow' | 'item-flow' | 'function';

const CALLEE_INPUT_SLOTS: Readonly<Record<string, Callee>> = {
  'subflow input.*': 'child-flow',
  'map input.*': 'item-flow',
  'script inputs.*': 'function',
};

/**
 * The callee sentence for a refused TOP-LEVEL value of a callee's input map
 * — what the remedy's guarded form, or a run-user read, changes for the
 * callee — or `undefined` where the remedy hands the callee nothing new: a
 * date macro (never absent), text with holes (a string), braces that are
 * neither a path nor an expression.
 *
 * Measured through the engine (`callee-input-value-slots.test.ts` in
 * `service-automation`): a whole token that resolved to nothing handed the
 * child `undefined`, so `seedDeclaredVariables` seeded the child variable
 * from its `defaultValue`; an envelope's `null` is a supplied value and the
 * default does not apply; a function was handed `undefined` and is handed
 * `null`.
 */
function calleeSentence(callee: Callee, mapKey: string, key: string, token: Token): string | undefined {
  const flow = callee === 'child-flow' ? 'the child flow' : callee === 'item-flow' ? 'each item\'s child flow' : undefined;
  const absent = absentCaseOf(token);
  if (absent === undefined) return undefined;
  const neverResolved = absent === 'never-resolved';
  if (flow === undefined) {
    return neverResolved
      ? `\`${mapKey}.${key}\` is the function's \`input.${key}\`, which the template handed \`undefined\` in every run: `
        + `leaving the key out of \`${mapKey}\` hands it nothing, as the template did.`
      : `\`${mapKey}.${key}\` is the function's \`input.${key}\`: where the template handed \`undefined\`, the guarded `
        + 'form hands `null`.';
  }
  return neverResolved
    ? `\`${mapKey}.${key}\` is ${flow}'s input variable \`${key}\`, which the template handed nothing in every run, so `
      + `the child seeded \`${key}\` from its \`defaultValue\`: leaving the key out of \`${mapKey}\` keeps exactly that.`
    : `\`${mapKey}.${key}\` is ${flow}'s input variable \`${key}\`. Where the template handed nothing, the child seeded `
      + `\`${key}\` from its \`defaultValue\`; the guarded form hands \`null\`, a supplied value, which wins over that `
      + 'default. To keep the default, write it in the guard\'s `null` branch; leave the key out of '
      + `\`${mapKey}\` only where the value is never meant to be supplied.`;
}

/**
 * What a refused whole token's remedy changes where the value was ABSENT —
 * the case a callee's input and a screen's value slots each answer their own
 * way — or `undefined` where the remedy changes nothing there: a date macro
 * (never absent), braces that are neither a path nor an expression.
 *
 *  - `'null'`: the template wrote nothing for a token that resolved to
 *    nothing, and the remedy's guarded form writes `null` — a path, an
 *    expression, the run user's id;
 *  - `'never-resolved'`: a `$User` path other than the id, which wrote
 *    nothing in every run.
 */
function absentCaseOf(token: Token): 'null' | 'never-resolved' | undefined {
  if (token.kind === 'user') return isRunUserIdToken(token.inner) ? 'null' : 'never-resolved';
  return token.kind === 'path' || token.kind === 'expression' ? 'null' : undefined;
}

/**
 * Which of a `screen`'s value slots a ledger entry is — keyed by the entry
 * (`<nodeType> <path>`), like {@link CALLEE_INPUT_SLOTS}, so the sentence
 * follows the ledger's declaration (see the module docblock, "A screen's
 * prefill and record id").
 */
type ScreenSlot = 'form-default' | 'field-default' | 'record-id';

const SCREEN_VALUE_SLOTS: Readonly<Record<string, ScreenSlot>> = {
  'screen defaults.*': 'form-default',
  'screen fields[].defaultValue': 'field-default',
  'screen recordId': 'record-id',
};

/**
 * The ledger entries (`<nodeType> <path>`) that are a node's COLLECTION — the
 * list a `loop` or a `map` iterates (#19939; see the module docblock, "A
 * `loop`'s or a `map`'s collection") — judged with
 * {@link ValueSlotTemplateOptions.collection}.
 */
const COLLECTION_SLOTS: ReadonlySet<string> = new Set(['loop collection', 'map collection']);

/**
 * [#19939] The ledger entries (`<nodeType> <path>`) that name who a `notify`
 * node's notification goes to — `recipients`, judged per element of a list
 * (the ledger's `eachElement`) — whose refusal ends with
 * {@link recipientSentence}.
 */
const RECIPIENT_SLOTS: ReadonlySet<string> = new Set(['notify recipients']);

/**
 * The recipient sentence for a refused TOP-LEVEL value at a `notify`
 * `recipients` position, located at `at` (`recipients`, `recipients[1]`) —
 * what the guarded form's `null`, and a list, do there — or `undefined` where
 * the remedy changes nothing there ({@link absentCaseOf}).
 *
 * Measured through the engine (`notify-value-slots.test.ts` in
 * `service-automation`): a whole token that resolved to nothing was dropped
 * from the audience, and so is an envelope's `null` or blank string; a whole
 * token holding a list, written as a list ENTRY, was handed on as ONE
 * recipient joined with commas (`'u1,u2'`), where an entry that evaluates to a
 * list adds each of its recipients.
 */
function recipientSentence(at: string, token: Token): string | undefined {
  const absent = absentCaseOf(token);
  if (absent === undefined) return undefined;
  return absent === 'never-resolved'
    ? `\`${at}\` names who the notification goes to, and the template dropped it from the audience in every run: `
      + 'leaving it out keeps exactly that.'
    : `\`${at}\` names who the notification goes to: an envelope there that evaluates to \`null\` or a blank string `
      + 'adds no recipient, as a token that resolved to nothing did, and one that evaluates to a list adds each of '
      + 'its recipients.';
}

/**
 * The screen sentence for a refused TOP-LEVEL value of one of a `screen`'s
 * value slots, located at `at` (`defaults.account`, `fields[0].defaultValue`,
 * `recordId`) — what the client is served where the template served nothing —
 * or `undefined` where the remedy changes nothing there (text with holes is a
 * string; see {@link absentCaseOf}).
 *
 * Measured through the engine (`screen-value-slots.test.ts` in
 * `service-automation`): an unresolved whole token served nothing (the key
 * left off the wire); a guarded envelope's `null` is served as `null`; a
 * `recordId` that evaluates to anything but a non-blank string fails the run
 * at the screen. And at objectui's pinned console: an object form seeds a
 * field a prefill leaves out from the object's declared `defaultValue` and
 * keeps a `null` prefill as a value; a flat field's `defaultValue` seeds the
 * field and is submitted back; an `edit` form with no `recordId` opens with
 * nothing read and refuses to save.
 */
function screenSentence(slot: ScreenSlot, at: string, token: Token): string | undefined {
  const absent = absentCaseOf(token);
  if (absent === undefined) return undefined;
  if (slot === 'record-id') {
    return absent === 'never-resolved'
      ? '`recordId` names the record an `edit` form opens, and the template served this screen with no record id in '
        + 'every run, so the form opened with no record and could not save: compute the id of the record it should '
        + 'open.'
      : '`recordId` names the record an `edit` form opens, so the envelope must evaluate to that record\'s id, a '
        + 'non-blank string: anything else — the guarded form\'s `null` included — fails the run at this screen, '
        + 'where the template served it with no record id and the `edit` form opened with no record and could not '
        + 'save. Where the record may be absent, route around the screen with a `decision` on the value rather '
        + 'than guarding the id.';
  }
  if (slot === 'form-default') {
    const field = at.slice('defaults.'.length);
    return absent === 'never-resolved'
      ? `\`${at}\` prefills the object form's \`${field}\` field, which the template prefilled with nothing in every `
        + 'run, so the form seeded it from the object\'s declared `defaultValue`: leaving the key out of `defaults` '
        + 'keeps exactly that.'
      : `\`${at}\` prefills the object form's \`${field}\` field. Where the template prefilled nothing, the form `
        + 'seeded that field from the object\'s declared `defaultValue`; the guarded form prefills `null`, which the '
        + 'form keeps as a value and opens the field blank over that default. To keep the default, write it in the '
        + 'guard\'s `null` branch; leave the key out of `defaults` only where the field is never meant to be '
        + 'prefilled.';
  }
  return absent === 'never-resolved'
    ? `\`${at}\` prefills this screen field, which the template prefilled with nothing in every run: leaving `
      + '`defaultValue` out keeps exactly that.'
    : `\`${at}\` prefills this screen field. Where the template prefilled nothing, the guarded form prefills `
      + '`null`, a value the field is seeded with and that is submitted back where the field held none. To prefill '
      + 'a value of your own when the value is absent, write it in the guard\'s `null` branch.';
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
 *
 * At a top-level value of a map the node hands to a callee (`subflow.input`,
 * `map.input`, `script.inputs`), a remedy that names a guard or a run-user
 * read ends with the callee sentence: what the callee is handed instead of
 * nothing (see the module docblock). At a top-level value of a `screen`'s value
 * slots (`defaults.*`, `fields[].defaultValue`, `recordId`) it ends with the
 * screen sentence: what the client is served instead of nothing. At a `loop`'s
 * (with a `body`) or a `map`'s `collection` only the value itself is judged,
 * with the collection's remedy: the list it must evaluate to. At a `notify`
 * node's `recipients` — the value, or each entry of a list — it ends with the
 * recipient sentence: what `null` and a list add to the audience. At each
 * operand of a CRUD node's `filter` a whole query placeholder passes, and a
 * token is refused with the filter operand's remedy
 * ({@link ValueSlotTemplateOptions.filterOperand}).
 *
 * [#27968] A value slot rooted in a sibling block — a `connector_action`
 * node's `connectorConfig.input` — is reached through `siblings` (pass the
 * node itself), and each refusal names its block; a caller that hands none is
 * answered for `config` only.
 */
export function flowNodeValueTemplateRefusals(
  nodeType: string,
  config: unknown,
  siblings?: FlowNodeSiblingBlocks,
): FlowNodeValueTemplateRefusal[] {
  const out: FlowNodeValueTemplateRefusal[] = [];
  const judge = (
    path: string,
    label: string,
    value: unknown,
    options: ValueSlotTemplateOptions = {},
    callee?: (refusal: ValueSlotTemplateRefusal) => string | undefined,
    block: FlowNodeExpressionBlock = 'config',
  ): void => {
    for (const refusal of valueSlotTemplateRefusals(value, options)) {
      const sentence = callee?.(refusal);
      const message = sentence === undefined ? refusal.message : `${refusal.message} ${sentence}`;
      out.push({ block, path: joinPath(path, refusal.path), label, message, source: refusal.source });
    }
  };
  for (const found of resolveFlowNodeValueSlots(nodeType, config, siblings)) {
    const entryKey = `${found.entry.nodeType} ${found.entry.path}`;
    if (found.block !== 'config') {
      // [#27968] A sibling block's value slot — today a `connector_action`
      // node's `connectorConfig.input` — takes the generic remedy: the action
      // was handed the token's text as written, so no sentence about what a
      // callee received instead of nothing applies.
      judge(found.path, found.entry.label, found.value, {}, undefined, found.block);
      continue;
    }
    if (COLLECTION_SLOTS.has(entryKey)) {
      judge(found.path, found.entry.label, found.value, { collection: true });
      continue;
    }
    if (found.entry.filterOperands) {
      judge(found.path, found.entry.label, found.value, { filterOperand: true });
      continue;
    }
    const receiver = CALLEE_INPUT_SLOTS[entryKey];
    const screenSlot = SCREEN_VALUE_SLOTS[entryKey];
    // The map's own key (`input.<key>`) — a callee entry's path ends in its `*`.
    const mapKey = found.entry.path.slice(0, -2);
    const key = found.path.slice(found.entry.path.length - 1);
    const sentenceFor = receiver !== undefined
      ? (whole: Token): string | undefined => calleeSentence(receiver, mapKey, key, whole)
      : screenSlot !== undefined
        ? (whole: Token): string | undefined => screenSentence(screenSlot, found.path, whole)
        : RECIPIENT_SLOTS.has(entryKey)
          ? (whole: Token): string | undefined => recipientSentence(found.path, whole)
          : undefined;
    const sentence = sentenceFor === undefined
      ? undefined
      : (refusal: ValueSlotTemplateRefusal): string | undefined => {
        if (refusal.path.length > 0) return undefined;
        const whole = wholeTokenOf(refusal.source, tokensOf(refusal.source));
        return whole === undefined ? undefined : sentenceFor(whole);
      };
    judge(found.path, found.entry.label, found.value, {}, sentence);
  }
  if (nodeType === 'assignment' && config !== null && typeof config === 'object' && !Array.isArray(config)) {
    const raw = (config as Record<string, unknown>).assignments;
    if (Array.isArray(raw)) {
      raw.forEach((item, index) => {
        if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
          judge(`assignments[${index}].value`, 'assignment value', (item as Record<string, unknown>).value, { envelopeIsLiteral: true });
        }
      });
    } else if (!(raw !== null && typeof raw === 'object')) {
      for (const [key, value] of Object.entries(config as Record<string, unknown>)) {
        judge(key, 'assignment value', value, { envelopeIsLiteral: true });
      }
    }
  }
  return out;
}
