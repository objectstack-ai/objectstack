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
 * `message` ({@link FLOW_NODE_TEXT_SLOTS}) — and, since #19939, a `notify`
 * node's `actionUrl`, the link a person follows from the notification, text
 * with holes (`/crm_case/{{ record.id }}`), and an `http` node's `url` and
 * each of its `headers` values, the request line and headers it sends
 * (`https://api.example.com/v1/orders/{{ record.id }}`). Until 18 the flow interpolator
 * rendered them with its single-brace `{token}` dialect while the spec already
 * typed the notify pair as `template` slots — the dialect whose delimiter §3
 * fixes as `{{ }}`. They now render through the formula template engine:
 * `{{ path }}` and `{{ path | formatter[:arg] }}` holes over the flow's
 * variables (`{{ record.name }}`, `{{ $error.message }}`,
 * `{{ amount | currency }}`), never logic.
 *
 * Since #28054 the flow itself carries two text slots besides its nodes'
 * ({@link FLOW_TEXT_SLOTS}): `successMessage` and `errorMessage`, the terminal
 * text the run hands its caller. The engine renders each at the run's terminal
 * exit, over the variables as the run left them, through the renderer the
 * refusing `end` node's `message` uses — so the doors judge them exactly as
 * they judge a node's text slot ({@link flowTextSlotSources}).
 *
 * This module is the ONE judge of what the slots still carry from the old
 * dialect: a single-brace `{…}` token is refused, and the refusal names the
 * `{{ }}` spelling of each token or, for a token no hole can spell, where to
 * compute it. The contracts compose it (`NotifyConfigSchema`,
 * `HttpConfigSchema`, `ScreenConfigSchema`, `EndConfigSchema`), and
 * `AutomationEngine.registerFlow` and the `validateStackExpressions` rule
 * (`objectstack validate`, `objectstack compile`, the runtime publish gate of
 * an `active` metadata save) call it on every slot
 * {@link flowNodeTextSlotSources} and {@link flowTextSlotSources} find — ⛔ never a second reading of the
 * dialect anywhere. Those doors then compile each slot's `{{ }}` holes
 * (`validateExpression('template', …)`), which the spec cannot do itself: the
 * template engine is a runtime.
 *
 * ## Not at `FlowSchema.parse`, but for an `end` node (#23320)
 *
 * The flow parse runs this judge on one slot: a top-level `end` node's
 * `message`, because `end` has no executor, so its contract, `EndConfigSchema`,
 * has no door but the parse (`parseEndNodeConfig` in `flow.zod.ts`). On every
 * other text slot the parse leaves the token to the doors above, as it leaves
 * a value-slot token to the value-slot judge's: `flowNodeConfigRefusals`'
 * value arm stands aside at the paths this judge refuses
 * (`slotJudgeRefusedPaths`, #23260), and the parse calls no slot judge of its
 * own. The reasons are measured once, for both judges, in
 * `flow-value-slot-template.ts` ("The doors that run it"): a refusal at the
 * parse would replace `registerFlow`'s located line and `objectstack
 * validate`'s `expression-invalid` finding with the parse's issue list, and
 * would fail the row in the stored pass (`os migrate meta --stored`), which
 * lists a text-slot refusal made after the parse as a TODO under
 * `registerFlow` and leaves its verdict unmoved. The flow's own two slots
 * ({@link FLOW_TEXT_SLOTS}) are left to the doors for the same reasons:
 * `registerFlow` reads them straight off the parsed flow, so unlike an `end`
 * node they never lack a door after the parse.
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
 *  - in a screen `title` / `description`, an `end` `message` or a notify
 *    `actionUrl`, a slot that is ONE token holding an object, an array or a
 *    `Date`: the interpolator wrote `String(value)` (`[object Object]`, `a,b`,
 *    the locale date), the engine writes JSON or the ISO text;
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
 * A text slot keeps nothing: each token has a remedy that renders the same
 * text — compute it into a variable with an `assignment` node's CEL value
 * envelope, and write the variable as a hole. A date macro is its CEL string
 * form there (`isoDate(today())`, `isoDatetime(now())`; the value slots refuse
 * the macros since #19939's third pass), and the run user's id is
 * `current_user.id` (refused there since its second); every other
 * `{$User.<path>}` never resolved, and its remedy says so. So the single
 * brace is deleted from the text slots whole, and the two dialects never
 * share one string.
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
 * the very sentence `{$User.<path>}` gets: for `$User.Id`, compute
 * `current_user.id` with an `assignment` node's CEL envelope, then write
 * `{{ v }}`. ⛔ The template engine does not learn `$User`
 * (or any new `$` root) instead — that would widen the flow's variable set
 * with no declaration behind it.
 *
 * ## A closed scope reads the same grammar (#24798)
 *
 * A template text slot outside a flow whose renderer binds a FIXED set of
 * roots — today a bulk action's `confirmText`, over `count` and the def's
 * params — is judged here too, by {@link closedScopeTemplateRefusal}: the same
 * single-brace reading, the same hole grammar, the same root rule, with the
 * scope's roots in place of the flow's open one. ⛔ Never a second reading of
 * the dialect for such a slot; give it a {@link ClosedTemplateScope}.
 */

import {
  CEL_RUN_USER_ID,
  CEL_RUN_USER_ID_GUARDED,
  celDateMacro,
  celExpression,
  isRunUserIdToken,
  runUserPathNeverResolved,
  templateTokenKind,
  templateTokensOf,
  type TemplateToken,
} from './flow-template-token';

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
  /**
   * [#19939] The key holds a MAP whose every value is a text slot of its own —
   * today an `http` node's `headers` (`{ <header name>: <text> }`, names the
   * author's own). {@link flowNodeTextSlotSources} emits each value at its own
   * path (`headers.X-Request-Id`); without it the key's value is the slot.
   */
  readonly eachValue?: true;
}

/**
 * Every flow node text slot — the positions the template engine renders.
 *
 * Measured from the executors, not assumed: these are the keys whose rendered
 * value is only ever used as text (`notify-node.ts` renders `title`,
 * `message` and, since #19939, `actionUrl` — the 17.x executor stringified
 * it, `String(…)`, so a whole token never handed a typed value on;
 * `screen-nodes.ts` and the engine's `end` handling render through one text
 * renderer; and since #19939 `http-nodes.ts` renders `url` and each `headers`
 * value — the 17.x contract, parsed after the interpolation, refused
 * anything but a string there, so a whole token never handed a typed value
 * on either). Every OTHER position the 17.x flow interpolator read is no
 * text template: the value slots (`fields.*`, `assignments.*`, the callee
 * maps `subflow.input.*`, `map.input.*`, `script.inputs.*`, a screen's
 * `defaults.*`, field `defaultValue` and `recordId`, the `loop` / `map`
 * `collection`, a notify node's `recipients`, `templateData.*` and
 * `sourceId`, an http node's `body`, and each operand of a CRUD node's
 * `filter`) are CEL's (#19939), and a notify node's `sourceObject`, `actorId`
 * and `payload` and an http node's `method`, `durable`, `timeoutMs` and
 * `signingSecret` are literals, read as written (#19939). The interpolator
 * itself is deleted (#19939, ADR-0032 Sequencing 6).
 */
export const FLOW_NODE_TEXT_SLOTS: readonly FlowNodeTextSlot[] = [
  { nodeType: 'notify', key: 'title', label: 'notify title' },
  { nodeType: 'notify', key: 'message', label: 'notify message' },
  { nodeType: 'notify', key: 'actionUrl', label: 'notify actionUrl' },
  { nodeType: 'http', key: 'url', label: 'http url' },
  { nodeType: 'http', key: 'headers', label: 'http header', eachValue: true },
  { nodeType: 'screen', key: 'title', label: 'screen title' },
  { nodeType: 'screen', key: 'description', label: 'screen description' },
  { nodeType: 'end', key: 'message', label: 'end message' },
];

/**
 * The text a text-slot value carries — the string itself, or the `source` of a
 * `{ dialect: 'template', source }` envelope (what the `tmpl` helper builds
 * for the notify pair, and what a parsed template slot holds). Anything else
 * carries no text this judge reads: the slot's own contract refuses its shape.
 * Exported (#24798) so a door judging a template slot outside a flow reads the
 * slot the way this module does — one reading of the envelope, not two.
 */
export function templateSlotSource(value: unknown): string | undefined {
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
 * The root of a variable path — its first segment as the engine resolves it
 * (`[i]` read as `.i`), so `$User.Id`, `$User[0]` and `$User` all root at
 * `$User`, and `tier.label` at `tier`.
 */
function pathRoot(path: string): string | undefined {
  return path.replace(/\[(\w+)\]/g, '.$1').split('.').find((segment) => segment !== '');
}

/**
 * The `$` root of a variable path when the engine does not bind it, else
 * `undefined`.
 */
function unboundEngineRoot(path: string): string | undefined {
  const root = pathRoot(path);
  if (root === undefined || !root.startsWith('$') || ENGINE_VARIABLE_SET.has(root)) return undefined;
  return root;
}

/** One `{{ }}` hole of a text whose path compiles, as written and as its trimmed path. */
interface PathHole {
  /** The hole as written (`{{ count | number }}`). */
  readonly text: string;
  /** Its variable path, trimmed (`count`). */
  readonly path: string;
}

/**
 * Every hole of `text` whose path compiles ({@link HOLE_PATH}), in order — a
 * formatter after `|` is not part of the path. A hole that does not compile is
 * the compile step's to name, so it is not returned.
 */
function pathHoles(text: string): PathHole[] {
  const out: PathHole[] = [];
  for (const match of text.matchAll(HOLE)) {
    const inner = match[1]!;
    const pipe = inner.indexOf('|');
    const path = (pipe === -1 ? inner : inner.slice(0, pipe)).trim();
    if (HOLE_PATH.test(path)) out.push({ text: match[0], path });
  }
  return out;
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
  for (const hole of pathHoles(text)) {
    const root = unboundEngineRoot(hole.path);
    if (root !== undefined) out.push({ ...hole, root });
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

/** A flow text slot's spellable token: a path not rooted at a `$` name the engine does not bind. */
function flowSpellable(token: TemplateToken): boolean {
  return token.kind === 'path' && unboundRootOf(token) === undefined;
}

/**
 * `text` with each single-brace token `spellable` admits written as a hole —
 * the spelling a refusal prescribes for it. Every other token stays as
 * written: its hole would be refused too, so its remedy is its own sentence,
 * never a rewrite. In a flow text slot the spellable tokens are the PATH
 * tokens not rooted at a `$` name the engine does not bind
 * ({@link flowSpellable}); in a closed scope, the path tokens over a bound root.
 */
function doubled(text: string, tokens: readonly TemplateToken[], spellable: (token: TemplateToken) => boolean): string {
  let out = '';
  let at = 0;
  for (const token of tokens) {
    out += text.slice(at, token.index) + (spellable(token) ? `{{ ${token.inner} }}` : token.text);
    at = token.index + token.text.length;
  }
  return out + text.slice(at);
}

/** The remedy for one token no `{{ }}` hole can spell. */
function unspellableRemedy(token: TemplateToken): string {
  switch (token.kind) {
    case 'date-macro': {
      const macro = celDateMacro(token.inner)!;
      return (
        `\`${token.text}\` is not a variable, so no hole spells it: compute its ISO text into a variable with an `
        + `\`assignment\` node's CEL value envelope (\`assignments: { v: { dialect: 'cel', source: '${macro.source}' } }\`) `
        + 'and write `{{ v }}` here.' + (macro.edge ? ` ${macro.edge}` : '')
      );
    }
    case 'user':
      if (!isRunUserIdToken(token.inner)) return runUserPathNeverResolved(token.text, (path) => `\`{{ ${path} }}\``);
      return (
        `\`${token.text}\` is not a variable, so no hole spells it: compute the run user's id into a variable with an `
        + `\`assignment\` node's CEL value envelope (\`assignments: { v: { dialect: 'cel', source: '${CEL_RUN_USER_ID}' } }\`) `
        + 'and write `{{ v }}` here. In a flow that can run without a user `current_user` is `null` and that read '
        + `fails the run, so compute \`${CEL_RUN_USER_ID_GUARDED}\` there, which renders nothing where the template did.`
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
  if (tokens.some(flowSpellable)) {
    parts.push(`Write \`${text}\` as \`${doubled(text, tokens, flowSpellable)}\`.`);
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

/**
 * One text slot of the FLOW itself (#28054) — a top-level `FlowSchema` key
 * whose value the engine renders to text.
 */
export interface FlowTextSlot {
  /** The flow key (`flow.<key>`). */
  readonly key: 'successMessage' | 'errorMessage';
  /** Author-facing label for diagnostics, e.g. `flow successMessage`. */
  readonly label: string;
}

/**
 * Every text slot of the flow itself — the terminal text the run hands its
 * caller (#28054). Measured from the engine, as {@link FLOW_NODE_TEXT_SLOTS}
 * is from the executors: `successMessage` is rendered at every terminal
 * success exit (`execute()`, a retried attempt's, the resume's) over the
 * variables the run finished with, and `errorMessage` at every terminal
 * failure exit over the variables at the failure point, both through the
 * renderer the refusing `end` node's `message` goes through. The keys are the
 * flow-level keys of the `flows` translation face (`FLOW_TERMINAL_MESSAGE_KEYS`
 * in `system/i18n-resolver.ts`), which the engine picks in the run's locale
 * before it fills the holes. Until #28054 both were copied onto the result
 * verbatim, so a `{{ }}` hole reached the user as written.
 */
export const FLOW_TEXT_SLOTS: readonly FlowTextSlot[] = [
  { key: 'successMessage', label: 'flow successMessage' },
  { key: 'errorMessage', label: 'flow errorMessage' },
];

/** One text slot present in a node's config — or, from {@link flowTextSlotSources}, on the flow — with the text it carries. */
export interface FlowNodeTextSlotSource {
  /** Path into `node.config` — the slot's key; from {@link flowTextSlotSources}, the flow key. */
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
 * whose value is neither a string nor a template envelope, is skipped. A map
 * slot ({@link FlowNodeTextSlot.eachValue}) yields each of its values at its
 * own path (`headers.X-Request-Id`), and nothing when the key holds no map.
 */
export function flowNodeTextSlotSources(nodeType: string, config: unknown): FlowNodeTextSlotSource[] {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) return [];
  const out: FlowNodeTextSlotSource[] = [];
  for (const slot of FLOW_NODE_TEXT_SLOTS) {
    if (slot.nodeType !== nodeType) continue;
    const value = (config as Record<string, unknown>)[slot.key];
    if (slot.eachValue) {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) continue;
      for (const [name, entry] of Object.entries(value as Record<string, unknown>)) {
        const source = templateSlotSource(entry);
        if (source !== undefined) out.push({ path: `${slot.key}.${name}`, label: slot.label, source });
      }
      continue;
    }
    const source = templateSlotSource(value);
    if (source !== undefined) out.push({ path: slot.key, label: slot.label, source });
  }
  return out;
}

/**
 * The text slots the FLOW itself carries ({@link FLOW_TEXT_SLOTS}), with their
 * template text — the flow-level sibling of {@link flowNodeTextSlotSources},
 * judged by the same doors in the same two steps: {@link textSlotTemplateRefusal},
 * then the `template` compile. A slot that is absent or not a string is
 * skipped (`FlowSchema` refuses any other shape).
 */
export function flowTextSlotSources(flow: unknown): FlowNodeTextSlotSource[] {
  if (flow === null || typeof flow !== 'object' || Array.isArray(flow)) return [];
  const out: FlowNodeTextSlotSource[] = [];
  for (const slot of FLOW_TEXT_SLOTS) {
    const value = (flow as Record<string, unknown>)[slot.key];
    if (typeof value === 'string') out.push({ path: slot.key, label: slot.label, source: value });
  }
  return out;
}

// ─── A CLOSED scope (#24798) ────────────────────────────────────────────────

/**
 * A template text slot whose holes read a CLOSED scope — a fixed set of roots
 * the slot's renderer binds, and nothing else. A flow text slot's scope is
 * open (any flow variable, any node output, so only a `$` root is judged);
 * a closed slot binds a handful of names its contract declares, so any other
 * root renders a blank fragment and is judged by name.
 *
 * Two families read a closed scope (ADR-0032 Decisions 2–3): a bulk
 * action's `confirmText` (`ui/bulk-action.zod.ts`), whose roots are
 * `bulkConfirmTemplateRoots(def)` — `count` and the def's params by name —
 * and (#24814) the action copy slots, an action's `confirmText`,
 * `successMessage` and `errorMessage` (`ui/action-copy-template.ts`),
 * whose roots are what the console's action runner binds for each.
 */
export interface ClosedTemplateScope {
  /** The slot as a sentence names it, capitalised: ``A bulk action's `confirmText` ``. */
  readonly slot: string;
  /**
   * Every root a hole may name, in the order a refusal lists them. Empty for a
   * slot whose renderer fills no hole and shows its text as written.
   */
  readonly roots: readonly string[];
}

/** `roots`, each in backticks, joined for a sentence. */
function rootList(roots: readonly string[]): string {
  return roots.map((root) => `\`${root}\``).join(', ');
}

/**
 * Whether `token` is written `${…}` — a `$` directly before its brace (#24814).
 * The action copy slots carried that spelling before they were typed: the
 * console's runner filled it in a sentence with no `{{ }}` hole (through its
 * `${…}` evaluator for `confirmText`, over `result` for `successMessage`), and
 * the platform's own sentences were written in it. Read as a bare single-brace
 * token, its prescription kept the `$` (`Delete ${{ record.name }}?`), a
 * spelling that renders a stray `$`; so a closed scope reads the `$` as part
 * of the token, and the token's hole replaces both.
 */
function isDollarToken(text: string, token: TemplateToken): boolean {
  return token.index > 0 && text[token.index - 1] === '$';
}

/** `token` as the author wrote it — its `$` included when it is a `${…}` token. */
function writtenToken(text: string, token: TemplateToken): string {
  return isDollarToken(text, token) ? `$${token.text}` : token.text;
}

/**
 * `text` with each single-brace token `spellable` admits written as a hole, a
 * `${…}` token's `$` replaced with it — {@link doubled} for a closed scope.
 */
function closedDoubled(text: string, tokens: readonly TemplateToken[], spellable: (token: TemplateToken) => boolean): string {
  let out = '';
  let at = 0;
  for (const token of tokens) {
    const dollar = isDollarToken(text, token);
    const from = dollar ? token.index - 1 : token.index;
    out += text.slice(at, from) + (spellable(token) ? `{{ ${token.inner} }}` : writtenToken(text, token));
    at = token.index + token.text.length;
  }
  return out + text.slice(at);
}

/** The remedy for one single-brace token a closed scope cannot spell as a hole. */
function closedUnspellableRemedy(written: string, token: TemplateToken, scope: ClosedTemplateScope): string {
  if (scope.roots.length === 0) return `\`${written}\` is not filled here: reword the sentence without it.`;
  if (token.kind === 'path') {
    return (
      `\`${written}\` names \`${pathRoot(token.inner) ?? token.inner}\`, which this slot does not bind, so no hole `
      + `spells it: name one of ${rootList(scope.roots)}, or reword the sentence.`
    );
  }
  if (token.kind === 'expression') {
    return (
      `\`${written}\` is logic, and a hole is a bound path with an optional whitelisted formatter `
      + '(`{{ path | formatter }}`), never logic (ADR-0032 §3): reword the sentence around a bound hole.'
    );
  }
  return (
    `\`${written}\` is not one of the roots this slot binds (${rootList(scope.roots)}), so no hole spells it: `
    + 'delete it or reword the sentence (a text slot has no escape for literal braces).'
  );
}

/**
 * The sentence a closed scope's refusal of its single-brace and `${…}` tokens
 * leads with. A scope with no root fills no hole at all — the slot's text is
 * shown as written — so for it every token is literal text, whatever its
 * spelling.
 */
function closedTokenLead(scope: ClosedTemplateScope, dollar: boolean, plain: boolean): string {
  const spelled = dollar && plain ? '`${…}` or `{…}`' : dollar ? '`${…}`' : '`{…}`';
  if (scope.roots.length === 0) {
    return `${scope.slot} binds no root, so it fills no hole: its text is shown as written, and a ${spelled} token `
      + 'there is shown as literal text.';
  }
  const dialect = dollar && plain
    ? 'the `${…}` spelling or the single-brace `{…}` dialect'
    : dollar ? 'the `${…}` spelling' : 'the single-brace `{…}` dialect';
  const clauses = [
    ...(dollar ? ['write each `${…}` token as the `{{ }}` hole it names'] : []),
    ...(plain ? ['a `{…}` token there is no placeholder and is shown as literal text'] : []),
  ];
  return `${scope.slot} reads \`{{ }}\` template holes (ADR-0032 §3), not ${dialect}: ${clauses.join(', and ')}.`;
}

/**
 * Why `text` — the template of a slot that reads `scope` — is refused, or
 * `undefined` when it carries neither a single-brace `{…}` token nor a hole
 * over a root `scope` does not bind.
 *
 * The same reading as {@link textSlotTemplateRefusal}, over the same token and
 * hole grammar: a single-brace token is found exactly as there (a token
 * touching another brace is left to the compile step), and a hole's root is
 * its path's first segment, a formatter not included. What differs is the
 * scope: a path token over a bound root is prescribed its `{{ }}` spelling,
 * any other token its own remedy, and every hole whose root is not in
 * `scope.roots` is named. A token written `${…}` is read with its `$`
 * ({@link isDollarToken}): its prescription is the hole alone. A hole that
 * does not compile as a path (logic, an unknown formatter) is left to
 * `validateExpression('template', …)`, which every door runs next.
 *
 * A scope with no root (`roots: []`) is a slot whose renderer shows its text
 * as written: every token and every hole is named as literal text there, and
 * none is prescribed a hole.
 */
export function closedScopeTemplateRefusal(text: string, scope: ClosedTemplateScope): string | undefined {
  const bound = new Set(scope.roots);
  const spellable = (token: TemplateToken): boolean => {
    if (token.kind !== 'path') return false;
    const root = pathRoot(token.inner);
    return root !== undefined && bound.has(root);
  };
  const refusals: string[] = [];

  const tokens = singleBraceTokens(text);
  if (tokens.length > 0) {
    const dollar = tokens.some((token) => isDollarToken(text, token));
    const plain = tokens.some((token) => !isDollarToken(text, token));
    const parts = [closedTokenLead(scope, dollar, plain)];
    if (tokens.some(spellable)) parts.push(`Write \`${text}\` as \`${closedDoubled(text, tokens, spellable)}\`.`);
    const seen = new Set<string>();
    for (const token of tokens) {
      const written = writtenToken(text, token);
      if (spellable(token) || seen.has(written)) continue;
      seen.add(written);
      parts.push(closedUnspellableRemedy(written, token, scope));
    }
    refusals.push(parts.join(' '));
  }

  const unbound: string[] = [];
  for (const hole of pathHoles(text)) {
    const root = pathRoot(hole.path);
    if (root === undefined || bound.has(root) || unbound.includes(hole.text)) continue;
    unbound.push(hole.text);
  }
  if (unbound.length > 0) {
    const holes = unbound.map((hole) => `\`${hole}\``).join(', ');
    refusals.push(
      scope.roots.length === 0
        ? `${scope.slot} binds no root, so it fills no hole and a hole is shown as literal text: ${holes} — reword `
          + 'the sentence without it.'
        : `${scope.slot} binds only ${rootList(scope.roots)}, so a hole over any other root renders a blank fragment: `
          + `${holes} — name one of those roots, or reword the sentence.`,
    );
  }
  return refusals.length === 0 ? undefined : refusals.join(' ');
}
