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
 * and `objectstack validate` call it on every slot
 * {@link flowNodeTextSlotSources} finds — ⛔ never a second reading of the
 * dialect anywhere. Those two doors then compile each slot's `{{ }}` holes
 * (`validateExpression('template', …)`), which the spec cannot do itself: the
 * template engine is a runtime.
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
 *
 * ## A `$` root is the engine's (#22477)
 *
 * The hole grammar admits `$` in a name so that the engine's own variables
 * have a spelling (`{{ $error.message }}`), which also makes `{{ $User.Id }}`
 * a well-formed hole — over a root no flow variable answers to, so it rendered
 * a blank fragment with the run reporting success, while `{$User.Id}` was
 * refused here with its remedy. The `$` names are reserved for the engine (a
 * resume signal may not write one — `IAutomationService.resume`'s
 * `INVALID_SIGNAL`), so this judge also refuses a hole whose root is a `$`
 * name the engine does not bind ({@link FLOW_ENGINE_VARIABLES}), and a
 * single-brace path token over one gets the same remedy instead of a
 * `{{ }}` rewrite that would be refused in turn. `{{ $User.<path> }}` gets
 * the very sentence `{$User.<path>}` gets: compute it with an `assignment`
 * node, then write `{{ v }}`. ⛔ The template engine does not learn `$User`
 * (or any new `$` root) instead — that would widen the flow's variable set
 * with no declaration behind it.
 */

import { celExpression, templateTokenKind, templateTokensOf, type TemplateToken } from './flow-template-token';

/**
 * The one sentence every refusal of a `{…}` token in a text slot leads with —
 * the same words in every text slot and at every door (the three node
 * contracts, `registerFlow`, `objectstack validate`), so an author (or an
 * agent reading the failure) meets the rule before the per-token remedy.
 */
export const TEXT_SLOT_TEMPLATE_REFUSAL =
  'A flow text slot reads `{{ }}` template holes (ADR-0032 §3), not the single-brace `{…}` dialect: a `{…}` token '
  + 'here is no placeholder any more and would be sent as literal text, so it is refused.';

/**
 * The `$`-named variables the flow engine binds — the only `$` roots a text
 * slot's hole may name. One enumerated list, measured from where
 * `service-automation` binds them, because the spec cannot import a runtime:
 *
 *  - `$record`, `$runId`, `$flowName`, `$flowLabel` — seeded at the start of
 *    every run attempt (`AutomationEngine.seedRunVariables`; `$record` when
 *    the run has a trigger record);
 *  - `$error` — published by the engine when a node fails, the value a
 *    `fault` edge's handler and a `try_catch` region read;
 *  - `$loopItems`, `$loopIndex` — bound by a flat-graph `loop` with no `body`
 *    (`loop-node.ts`'s legacy branch).
 *
 * `text-slot-template.test.ts` in that package scans its sources for every
 * `$`-named variable they bind by name and asserts this judge admits a hole
 * over each, so a root the engine starts binding without a line here reddens
 * there. A node output is not a `$` root: it is addressed by its node id
 * (`{{ lookup.result }}`). ⛔ Package-internal on purpose — the refusal names
 * the list, and a published copy would be a second public answer to a
 * question the engine owns.
 */
const FLOW_ENGINE_VARIABLES: readonly string[] = [
  '$record',
  '$runId',
  '$flowName',
  '$flowLabel',
  '$error',
  '$loopItems',
  '$loopIndex',
];

const ENGINE_VARIABLE_SET: ReadonlySet<string> = new Set(FLOW_ENGINE_VARIABLES);

/**
 * The sentence every refusal of a `{{ }}` hole over an unbound `$` root leads
 * with — the same words at every door, as {@link TEXT_SLOT_TEMPLATE_REFUSAL}
 * is for the single brace.
 */
const ENGINE_VARIABLE_HOLE_REFUSAL =
  'A `{{ }}` hole in a flow text slot may name a `$` variable only when the flow engine binds it — the `$` names '
  + 'are reserved for the engine — so a hole over any other `$` name is refused rather than sent as a blank fragment.';

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
function textSlotSource(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const envelope = value as { dialect?: unknown; source?: unknown };
    if (envelope.dialect === 'template' && typeof envelope.source === 'string') return envelope.source;
  }
  return undefined;
}

/**
 * The single-brace tokens of `text` — every `{…}` the 17.x interpolator
 * substituted, minus any that touch another brace.
 *
 * Touching on BOTH sides is the inside of a `{{ }}` hole. Touching on ONE side
 * (`Total {{ amount }`, `Total { amount }}`) is a hole with a brace missing,
 * not an old token: doubling it would prescribe a three-brace "fix" the engine
 * refuses too. So it is left to the compile step every door runs next
 * (`validateExpression('template', …)`), which names the unbalanced hole.
 */
function singleBraceTokens(text: string): TemplateToken[] {
  return templateTokensOf(text).filter((token) =>
    text[token.index - 1] !== '{' && text[token.index + token.text.length] !== '}');
}

/**
 * A `{{ … }}` hole — the template engine's `HOLE_RE` (`@objectstack/formula`
 * `template-engine.ts`), verbatim: the inner content, no `}` inside.
 */
const HOLE = /\{\{([^}]*)\}\}/g;

/**
 * A hole's path — the engine's `PATH_ONLY_RE`, verbatim. A hole whose path
 * fails it does not compile, and the compile step every door runs next names
 * it; this judge reads only the holes that do.
 */
const HOLE_PATH = /^[\w$.[\]]+$/;

/**
 * The `$` root of a variable path when the engine does not bind it, else
 * `undefined`. The root is the path's first segment as the engine resolves it
 * (`[i]` read as `.i`), so `$User.Id`, `$User[0]` and `$User` all root at
 * `$User`.
 */
function unboundEngineRoot(path: string): string | undefined {
  const root = path.replace(/\[(\w+)\]/g, '.$1').split('.').find((segment) => segment !== '');
  if (root === undefined || !root.startsWith('$') || ENGINE_VARIABLE_SET.has(root)) return undefined;
  return root;
}

/** One `{{ }}` hole of a text slot whose root is a `$` name the engine does not bind. */
interface UnboundRootHole {
  /** The hole as written (`{{ $User.Id }}`). */
  readonly text: string;
  /** Its variable path, trimmed (`$User.Id`). */
  readonly path: string;
  /** The path's `$` root (`$User`). */
  readonly root: string;
}

/** Every hole of `text` that compiles as a path and roots at a `$` name the engine does not bind, in order. */
function unboundRootHoles(text: string): UnboundRootHole[] {
  const out: UnboundRootHole[] = [];
  for (const match of text.matchAll(HOLE)) {
    const inner = match[1]!;
    const pipe = inner.indexOf('|');
    const path = (pipe === -1 ? inner : inner.slice(0, pipe)).trim();
    if (!HOLE_PATH.test(path)) continue;
    const root = unboundEngineRoot(path);
    if (root !== undefined) out.push({ text: match[0], path, root });
  }
  return out;
}

/**
 * The remedy for a `$` root the engine does not bind, written as `written` —
 * a hole or a single-brace token. Names the engine's variables, since that is
 * the list the author's `$` name was read against.
 */
function unboundRootRemedy(written: string, root: string): string {
  return (
    `\`${written}\` names \`${root}\`, which is not one of the flow engine's own variables `
    + `(${FLOW_ENGINE_VARIABLES.map((name) => `\`${name}\``).join(', ')}), so no hole spells it: write the variable `
    + 'that holds the value — one the flow binds itself (a declared variable, an `assignment` target, an '
    + '`outputVariable`, a `try_catch` `errorVariable`) is named without the `$` — or compute the value into a '
    + 'variable with an `assignment` node and write `{{ v }}` here.'
  );
}

/** A single-brace PATH token over a `$` root the engine does not bind — no hole spells it either. */
function unboundRootOf(token: TemplateToken): string | undefined {
  return token.kind === 'path' ? unboundEngineRoot(token.inner) : undefined;
}

/**
 * `text` with each single-brace PATH token written as a hole — the spelling a
 * refusal prescribes for it. A path over a `$` root the engine does not bind
 * stays as written: its hole would be refused too, so its remedy is
 * {@link unboundRootRemedy}, never a rewrite.
 */
function doubled(text: string, tokens: readonly TemplateToken[]): string {
  let out = '';
  let at = 0;
  for (const token of tokens) {
    const spellable = token.kind === 'path' && unboundRootOf(token) === undefined;
    out += text.slice(at, token.index) + (spellable ? `{{ ${token.inner} }}` : token.text);
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

/** The refusal of `text`'s single-brace tokens, or `undefined` when it carries none. */
function singleBraceRefusal(text: string): string | undefined {
  const tokens = singleBraceTokens(text);
  if (tokens.length === 0) return undefined;
  const parts: string[] = [];
  if (tokens.some((token) => token.kind === 'path' && unboundRootOf(token) === undefined)) {
    parts.push(`Write \`${text}\` as \`${doubled(text, tokens)}\`.`);
  }
  const seen = new Set<string>();
  for (const token of tokens) {
    if (seen.has(token.text)) continue;
    if (token.kind === 'path') {
      const root = unboundRootOf(token);
      if (root === undefined) continue;
      seen.add(token.text);
      parts.push(unboundRootRemedy(token.text, root));
      continue;
    }
    seen.add(token.text);
    parts.push(unspellableRemedy(token));
  }
  return `${TEXT_SLOT_TEMPLATE_REFUSAL} ${parts.join(' ')}`;
}

/**
 * The refusal of `text`'s holes over a `$` root the engine does not bind, or
 * `undefined` when it has none. A `$User.<path>` hole gets the remedy its
 * single-brace spelling gets, word for word, so the two spellings answer
 * alike; any other root gets {@link unboundRootRemedy}.
 */
function unboundRootHoleRefusal(text: string): string | undefined {
  const holes = unboundRootHoles(text);
  if (holes.length === 0) return undefined;
  const parts: string[] = [];
  const seen = new Set<string>();
  for (const hole of holes) {
    if (seen.has(hole.text)) continue;
    seen.add(hole.text);
    const single = `{${hole.path}}`;
    parts.push(
      templateTokenKind(hole.path) === 'user'
        ? unspellableRemedy({ text: single, inner: hole.path, kind: 'user', index: 0 })
        : unboundRootRemedy(hole.text, hole.root),
    );
  }
  return `${ENGINE_VARIABLE_HOLE_REFUSAL} ${parts.join(' ')}`;
}

/**
 * Why `text` — a text slot's template — is refused, or `undefined` when it
 * carries neither a single-brace token nor a hole over a `$` root the engine
 * does not bind.
 *
 * A single-brace token leads with {@link TEXT_SLOT_TEMPLATE_REFUSAL}, then the
 * `{{ }}` spelling of every path token (the whole text rewritten) and the
 * remedy for every token no hole can spell. A hole such as `{{ $User.Id }}`
 * leads with its own sentence (the `$` names are the engine's), then the
 * remedy for each such hole — `{{ $User.Id }}` gets the one `{$User.Id}`
 * gets. A text carrying both gets both, single brace first.
 */
export function textSlotTemplateRefusal(text: string): string | undefined {
  const refusals = [singleBraceRefusal(text), unboundRootHoleRefusal(text)].filter(
    (refusal): refusal is string => refusal !== undefined,
  );
  return refusals.length === 0 ? undefined : refusals.join(' ');
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
 * a door judges with {@link textSlotTemplateRefusal} and then compiles as a
 * `template` (`validateExpression('template', …)`). A slot that is absent, or
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
