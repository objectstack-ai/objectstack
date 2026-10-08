// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @module automation/flow-text-slot-template
 *
 * **The flow TEXT slots read ADR-0032 §3's `{{ }}` delimiter** (#22110 —
 * Decision 3, "One delimiter, `{{ }}`; single `{ }` deleted", executed on the
 * protocol-18 line).
 *
 * A text slot is a config position whose rendered value is definitionally
 * text for a person to read: a `notify` node's `title` and `message`, a
 * `screen` node's `title` and `description`, and a refusing `end` node's
 * `message` ({@link FLOW_NODE_TEXT_SLOTS}). Until 18 the flow interpolator
 * rendered them with its single-brace `{token}` dialect while the spec already
 * typed the notify pair as `template` slots — the dialect whose delimiter §3
 * fixes as `{{ }}`. They now render through the formula template engine:
 * `{{ path }}` and `{{ path | formatter[:arg] }}` holes over the flow's
 * variables (`{{ record.name }}`, `{{ $error.message }}`,
 * `{{ amount | currency }}`), never logic.
 *
 * This module is the ONE judge of what the slots still carry from the old
 * dialect: a single-brace `{…}` token is refused, and the refusal names the
 * `{{ }}` spelling of each token or, for a token no hole can spell, where to
 * compute it. The contracts compose it (`NotifyConfigSchema`,
 * `ScreenConfigSchema`, `EndConfigSchema`), and `AutomationEngine.registerFlow`
 * and `objectstack validate` call {@link flowNodeTextTemplateRefusals} — ⛔
 * never a second reading of the dialect anywhere. Those two doors also compile
 * every slot's `{{ }}` holes (`validateExpression('template', …)`), which the
 * spec cannot do itself: the template engine is a runtime.
 *
 * ## Refused, not converted (ADR-0087 D2)
 *
 * D2 lets a conversion rewrite only what maps LOSSLESSLY. Every token spelling
 * was rendered through the 17.x interpolator and through the template engine
 * over the same variables (#22110's measurement). A path — `{x}`, `{a.b}`,
 * `{list.0}`, a node output `{n1.result}` — renders the same text for a
 * string, a number, a boolean, `null`, an absent key or variable, an ISO date
 * string, an object or an array, but not for every input:
 *
 *  - a `Date` value (what a CEL `now()` / `today()` assignment stores):
 *    the interpolator wrote it JSON-quoted (`"2026-10-08T09:30:00.000Z"`,
 *    quotes included), the engine writes the ISO text;
 *  - in a screen `title` / `description` or an `end` `message`, a slot that
 *    is ONE token holding an object, an array or a `Date`: the interpolator
 *    wrote `String(value)` (`[object Object]`, `a,b`, the locale date), the
 *    engine writes JSON or the ISO text;
 *  - a `$`-named variable (`{$error.message}`) had no `{{ }}` spelling at all
 *    until the engine's hole grammar admitted `$` in a name (this card).
 *
 * The other kinds have no hole spelling: arithmetic and function calls
 * (`{amount * 2}`, `{round(x)}`) are logic, which §3 keeps out of holes; the
 * date macros (`{NOW()}`, `{TODAY() + 1}`) and the run user (`{$User.Id}`)
 * are not variables. So no spelling is converted: each is refused with its
 * remedy, and the author re-reads the text the slot will send.
 *
 * ## No spelling is kept
 *
 * Unlike the value slots, which keep the date macros and `{$User.*}` because
 * CEL cannot write them yet, a text slot keeps nothing: each of those has a
 * remedy that renders the same text — compute it into a variable with an
 * `assignment` node, whose value slot still reads that spelling, and write the
 * variable as a hole. So the single brace is deleted from the text slots
 * whole, and the two dialects never share one string.
 */

import { celExpression, templateTokensOf, type TemplateToken } from './flow-template-token';

/**
 * The one sentence every refusal of a `{…}` token in a text slot leads with —
 * the same words in every text slot and at every door (the three node
 * contracts, `registerFlow`, `objectstack validate`), so an author (or an
 * agent reading the failure) meets the rule before the per-token remedy.
 */
export const TEXT_SLOT_TEMPLATE_REFUSAL =
  'A flow text slot reads `{{ }}` template holes (ADR-0032 §3), not the single-brace `{…}` dialect: a `{…}` token '
  + 'here is no placeholder any more and would be sent as literal text, so it is refused.';

/** One text slot of a builtin flow node — a config key whose value renders to text. */
export interface FlowNodeTextSlot {
  /** Registry node type the slot belongs to (`node.type`). */
  readonly nodeType: string;
  /** The config key (`config.<key>`). */
  readonly key: string;
  /** Author-facing label for diagnostics, e.g. `notify title`. */
  readonly label: string;
}

/**
 * Every flow node text slot — the positions the template engine renders.
 *
 * Measured from the executors, not assumed: these are the keys whose rendered
 * value is only ever used as text (`notify-node.ts` stringifies `title` /
 * `message`; `screen-nodes.ts` and the engine's `end` handling render through
 * one text renderer). Every OTHER string the flow interpolator reads keeps its
 * single-brace dialect: a value-like position whose single token hands its
 * resolved value over with its TYPE (`recipients`, `actionUrl`, `sourceId`,
 * `payload`, `templateData`, a screen's `recordId` / `defaults` / field
 * `defaultValue`, `subflow.input`, `script.inputs`, `map.input`, `http`, the
 * `loop` / `map` `collection`, a `filter`) is not a text template, and the
 * value slots (`fields.*`, `assignments.*`) are CEL's (#19939).
 */
export const FLOW_NODE_TEXT_SLOTS: readonly FlowNodeTextSlot[] = [
  { nodeType: 'notify', key: 'title', label: 'notify title' },
  { nodeType: 'notify', key: 'message', label: 'notify message' },
  { nodeType: 'screen', key: 'title', label: 'screen title' },
  { nodeType: 'screen', key: 'description', label: 'screen description' },
  { nodeType: 'end', key: 'message', label: 'end message' },
];

/**
 * The text a text-slot value carries — the string itself, or the `source` of a
 * `{ dialect: 'template', source }` envelope (what the `tmpl` helper builds
 * for the notify pair). Anything else carries no text this judge reads: the
 * slot's own contract refuses its shape.
 */
export function textSlotSource(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const envelope = value as { dialect?: unknown; source?: unknown };
    if (envelope.dialect === 'template' && typeof envelope.source === 'string') return envelope.source;
  }
  return undefined;
}

/** The single-brace tokens of `text` — every `{…}` the 17.x interpolator substituted, minus the inside of a `{{ }}` hole. */
function singleBraceTokens(text: string): TemplateToken[] {
  return templateTokensOf(text).filter((token) =>
    !(text[token.index - 1] === '{' && text[token.index + token.text.length] === '}'));
}

/** `text` with each single-brace PATH token written as a hole — the spelling a refusal prescribes for it. */
function doubled(text: string, tokens: readonly TemplateToken[]): string {
  let out = '';
  let at = 0;
  for (const token of tokens) {
    out += text.slice(at, token.index) + (token.kind === 'path' ? `{{ ${token.inner} }}` : token.text);
    at = token.index + token.text.length;
  }
  return out + text.slice(at);
}

/** The remedy for one token no `{{ }}` hole can spell. */
function unspellableRemedy(token: TemplateToken): string {
  switch (token.kind) {
    case 'date-macro':
    case 'user':
      return (
        `\`${token.text}\` is not a variable, so no hole spells it: compute it into a variable with an \`assignment\` `
        + `node, whose value slot still reads it (\`assignments: { v: '${token.text}' }\`), and write \`{{ v }}\` here.`
      );
    case 'expression':
      return (
        `\`${token.text}\` is logic, and a hole is a variable path with an optional formatter (\`{{ v | number:2 }}\`), `
        + 'never logic: compute it into a variable with an `assignment` node\'s CEL value envelope '
        + `(\`assignments: { v: { dialect: 'cel', source: ${JSON.stringify(celExpression(token.inner))} } }\`) and `
        + 'write `{{ v }}` here.'
      );
    default:
      return (
        `\`${token.text}\` is neither a variable path nor an expression, and the 17.x renderer wrote nothing in its `
        + 'place: delete it (a text slot has no escape for literal braces).'
      );
  }
}

/**
 * Why `text` — a text slot's template — is refused, or `undefined` when it
 * carries no single-brace token. The message leads with
 * {@link TEXT_SLOT_TEMPLATE_REFUSAL}, then names the `{{ }}` spelling of every
 * path token (the whole text rewritten) and the remedy for every token no hole
 * can spell.
 */
export function textSlotTemplateRefusal(text: string): string | undefined {
  const tokens = singleBraceTokens(text);
  if (tokens.length === 0) return undefined;
  const parts: string[] = [];
  if (tokens.some((token) => token.kind === 'path')) {
    parts.push(`Write \`${text}\` as \`${doubled(text, tokens)}\`.`);
  }
  const seen = new Set<string>();
  for (const token of tokens) {
    if (token.kind === 'path' || seen.has(token.text)) continue;
    seen.add(token.text);
    parts.push(unspellableRemedy(token));
  }
  return `${TEXT_SLOT_TEMPLATE_REFUSAL} ${parts.join(' ')}`;
}

/** One text slot present in a node's config, with the text it carries. */
export interface FlowNodeTextSlotSource {
  /** Path into `node.config` — the slot's key. */
  readonly path: string;
  /** The slot, as a door names it — `notify title`. */
  readonly label: string;
  /** The template text. */
  readonly source: string;
}

/**
 * The text slots one node's `config` carries, with their template text — what
 * a door compiles as a `template` (`validateExpression('template', …)`) and
 * what {@link flowNodeTextTemplateRefusals} judges. A slot that is absent, or
 * whose value is neither a string nor a template envelope, is skipped.
 */
export function flowNodeTextSlotSources(nodeType: string, config: unknown): FlowNodeTextSlotSource[] {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) return [];
  const out: FlowNodeTextSlotSource[] = [];
  for (const slot of FLOW_NODE_TEXT_SLOTS) {
    if (slot.nodeType !== nodeType) continue;
    const source = textSlotSource((config as Record<string, unknown>)[slot.key]);
    if (source !== undefined) out.push({ path: slot.key, label: slot.label, source });
  }
  return out;
}

/** One refused text slot in a node's config, located for a door's report. */
export interface FlowNodeTextTemplateRefusal extends FlowNodeTextSlotSource {
  /** {@link TEXT_SLOT_TEMPLATE_REFUSAL}, then the remedy. */
  readonly message: string;
}

/**
 * Every single-brace refusal in one node's `config` — the call the build door
 * (`objectstack validate`) and `AutomationEngine.registerFlow` share, so the
 * two give one verdict, and the one the three node contracts give at parse.
 */
export function flowNodeTextTemplateRefusals(nodeType: string, config: unknown): FlowNodeTextTemplateRefusal[] {
  const out: FlowNodeTextTemplateRefusal[] = [];
  for (const slot of flowNodeTextSlotSources(nodeType, config)) {
    const message = textSlotTemplateRefusal(slot.source);
    if (message !== undefined) out.push({ ...slot, message });
  }
  return out;
}
