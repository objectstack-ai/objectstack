// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PRE-PARSE authoring lint for DEPRECATED ALIASES (#3743).
 *
 * A deprecated alias is resolved by the parse itself: `ActionSchema`'s transform
 * folds `execute` into `target` and DROPS it from the output (#3713 / #3742). So
 * every check that runs on parsed metadata — the CLI's `lintFlowPatterns`,
 * `lintViewRefs`, `@objectstack/lint`'s validators, a renderer, the runtime — is
 * structurally blind to the one thing worth reporting here: that the author
 * declared the alias at all, let alone that they put a *different* value in it.
 *
 * That leaves exactly one window: **after `normalizeStackInput`, before the
 * parse.** This module is the rule set for that window, kept in `spec` rather
 * than in a lint package because the two places that own that window both live
 * upstream of `@objectstack/lint`:
 *
 *   1. `defineStack` (`stack.zod.ts`) — the dominant authoring path, and the one
 *      that consumes the alias EARLIEST. It parses inside the author's own
 *      config module, so by the time `os build` loads that module the alias is
 *      already gone. A CLI-only warning would therefore never fire for a
 *      `defineStack` app — i.e. for almost every app.
 *   2. The CLI's `os build` / `os validate` pre-parse pass — which is where a
 *      stack that did NOT go through strict `defineStack` gets caught: a plain
 *      object default-export, `defineStack(…, { strict: false })`, or an inline
 *      function handler (`z.string()` rejects those, so they cannot pass through
 *      strict `defineStack` at all and are lowered by the CLI instead).
 *
 * Each layer warns only for the discards IT performs, so an authored conflict
 * produces exactly one warning no matter which path the stack takes.
 *
 * ── Scope: every fold-and-drop alias in the spec ──────────────────────────────
 *
 * A rule belongs here when the transform makes the alias *unrepresentable* on
 * the parsed output — that is what puts it out of reach of every downstream
 * check. The spec has exactly three such transforms, and all three share one
 * failure mode: declare both slots with different values and the alias is
 * discarded without a word.
 *
 *   action-target-execute-conflict — WARNING
 *     `ActionSchema` (#3713 / #3742). The discarded `execute` names a handler
 *     that never runs.
 *
 *   field-requiredwhen-conditionalrequired-conflict — WARNING
 *     `FieldSchema` (#3754 / #3764). The discarded `conditionalRequired` is a
 *     predicate that never gates the field.
 *
 *   agent-knowledge-sources-topics-conflict — WARNING
 *     `AIKnowledgeSchema` (#1878 / #1891). The discarded `topics` names RAG
 *     sources the agent never recruits from.
 *
 * All three are advisory rather than fatal, because the resulting stack is
 * well-defined and shippable; the cost is a value that never takes effect, not
 * a broken build. Identical values in both slots are harmless duplication —
 * nothing the author wrote is lost — and stay quiet. `severity` is modelled and
 * honoured by every call site, so promoting a rule gates both CLI surfaces at
 * once (#3782) with no rewiring.
 */

export interface DeprecatedAliasFinding {
  /** Author-facing location, e.g. `action 'convert' on object 'crm_deal'`. */
  where: string;
  /** What was discarded and why — states the precedence explicitly. */
  message: string;
  /** The one-line fix. */
  hint: string;
  /** Stable rule id, e.g. {@link ACTION_TARGET_EXECUTE_CONFLICT}. */
  rule: string;
  /**
   * `'error'` FAILS the build; `'warning'` (the default when absent) prints and
   * continues. `os build` and `os validate` both filter on this field, so a rule
   * promoted here gates both surfaces at once (#3782).
   */
  severity?: 'error' | 'warning';
}

type AnyRec = Record<string, unknown>;

export const ACTION_TARGET_EXECUTE_CONFLICT = 'action-target-execute-conflict';
export const FIELD_REQUIREDWHEN_CONDITIONALREQUIRED_CONFLICT = 'field-requiredwhen-conditionalrequired-conflict';
export const AGENT_KNOWLEDGE_SOURCES_TOPICS_CONFLICT = 'agent-knowledge-sources-topics-conflict';

/** Normalise a record-or-map metadata slot into an array, injecting `name` from
 *  the map key (mirrors the helper in the CLI's sibling authoring lints). */
function asArray(v: unknown): AnyRec[] {
  if (Array.isArray(v)) return v as AnyRec[];
  if (v && typeof v === 'object') return Object.entries(v as AnyRec).map(([name, def]) => ({ name, ...(def as AnyRec) }));
  return [];
}

/** A handler slot counts as declared when it holds a non-empty string ref or an
 *  inline callable. Both forms are authorable and both resolve by the same
 *  `target`-wins precedence. */
function isDeclaredHandler(v: unknown): boolean {
  return typeof v === 'function' || (typeof v === 'string' && v.length > 0);
}

/** Render a handler slot for an author-facing message. An inline function has no
 *  useful printable value — naming the shape is what makes the message land. */
function describeHandler(v: unknown): string {
  return typeof v === 'function' ? 'an inline function' : `'${String(v)}'`;
}

/** Pull the predicate text out of an `ExpressionInput` — a bare string, or the
 *  `{ dialect, source }` envelope it is lowered into. Anything else is not an
 *  authored predicate. */
function expressionSource(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && typeof (v as AnyRec).source === 'string') return (v as AnyRec).source as string;
  return undefined;
}

function isDeclaredExpression(v: unknown): boolean {
  const src = expressionSource(v);
  return typeof src === 'string' && src.length > 0;
}

function describeExpression(v: unknown): string {
  return `\`${expressionSource(v)}\``;
}

/** A knowledge slot counts as declared when it holds a non-empty string array. */
function isDeclaredList(v: unknown): boolean {
  return Array.isArray(v) && v.length > 0;
}

function describeList(v: unknown): string {
  return `[${(v as unknown[]).map((s) => `'${String(s)}'`).join(', ')}]`;
}

/** Set-equality: `sources: ['a','b']` beside `topics: ['b','a']` recruits the
 *  same context, so nothing the author wrote is lost and the rule stays quiet.
 *  Order and repetition are not meaningful for either slot. */
function sameMembers(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => [...new Set((v as unknown[]).map((x) => String(x)))].sort().join('\u0000');
  return norm(a) === norm(b);
}

/** The one shape every rule here reports. Sharing the skeleton keeps the three
 *  messages phrased identically where they say the same thing (which slot wins,
 *  that the alias is dropped, delete it) while each still names what its own
 *  discarded value would have done. */
interface AliasConflict {
  /** Sentence subject, e.g. `Action`, `Field`, `Agent knowledge`. */
  subject: string;
  where: string;
  canonicalKey: string;
  aliasKey: string;
  /** Rendered values, already quoted/bracketed for display. */
  canonical: string;
  alias: string;
  /** What the discarded value would have done, e.g. "never runs". */
  lost: string;
  /** Rule-specific half of the hint. */
  fix: string;
  rule: string;
}

function aliasFinding(c: AliasConflict): DeprecatedAliasFinding {
  return {
    where: c.where,
    message:
      `${c.subject} declares both '${c.canonicalKey}' (${c.canonical}) and the deprecated alias ` +
      `'${c.aliasKey}' (${c.alias}). '${c.canonicalKey}' wins: '${c.aliasKey}' is dropped while the stack ` +
      `is compiled and never reaches the runtime or a renderer, so ${c.alias} ${c.lost}.`,
    hint:
      `Delete '${c.aliasKey}' — it is a deprecated alias of '${c.canonicalKey}', not a second value. ${c.fix}`,
    rule: c.rule,
    severity: 'warning',
  };
}

/**
 * Collect deprecated-alias findings from a NORMALIZED (not yet parsed) stack.
 *
 * Pure and side-effect free: callers decide how to surface the findings —
 * `defineStack` warns on the console, the CLI folds them into its authoring-lint
 * block. Safe to call on a stack that still holds inline functions.
 */
export function lintDeprecatedAliases(stack: AnyRec): DeprecatedAliasFinding[] {
  const findings: DeprecatedAliasFinding[] = [];

  // An action commonly appears BOTH top-level and nested under its object (the
  // loader auto-populates `objects[*].actions` from `actions[*].objectName`),
  // and a field can be declared on an object and again on an extension of it.
  // Dedupe by rule + identity + both slot values: one authored mistake, one
  // finding. `\u0000` is written as an escape, never as a raw byte — a literal
  // NUL makes ripgrep treat the whole file as binary and silently drop it from
  // every grep-based lint (`scripts/check-nul-bytes.mjs` enforces this).
  const seen = new Set<string>();
  const firstTime = (rule: string, ...parts: string[]) => {
    const key = [rule, ...parts].join('\u0000');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };

  // ── action.target vs action.execute (#3713 / #3742) ────────────────────────
  const checkAction = (action: AnyRec, ownerObject?: string) => {
    if (!action) return;
    const { target, execute } = action;
    if (!isDeclaredHandler(target) || !isDeclaredHandler(execute)) return;
    // Same value in both slots (equal strings, or the very same function): the
    // alias is redundant, not contradictory, and nothing the author wrote is
    // lost. Staying quiet keeps the rule's signal-to-noise at 1.
    if (target === execute) return;

    const name = typeof action.name === 'string' && action.name ? action.name : '(unnamed)';
    const canonical = describeHandler(target);
    const alias = describeHandler(execute);
    if (!firstTime(ACTION_TARGET_EXECUTE_CONFLICT, name, canonical, alias)) return;

    findings.push(aliasFinding({
      subject: 'Action',
      where: ownerObject ? `action '${name}' on object '${ownerObject}'` : `action '${name}'`,
      canonicalKey: 'target',
      aliasKey: 'execute',
      canonical,
      alias,
      lost: 'never runs',
      fix: `If ${alias} is the handler you meant to bind, put it in 'target' instead.`,
      rule: ACTION_TARGET_EXECUTE_CONFLICT,
    }));
  };

  // ── field.requiredWhen vs field.conditionalRequired (#3754 / #3764) ────────
  const checkField = (field: AnyRec, ownerLabel: string) => {
    if (!field) return;
    const { requiredWhen, conditionalRequired } = field;
    if (!isDeclaredExpression(requiredWhen) || !isDeclaredExpression(conditionalRequired)) return;
    // Compare the predicate TEXT, not the wrapper: `'record.paid'` and
    // `{ dialect: 'cel', source: 'record.paid' }` are the same predicate written
    // two ways, and neither loses anything.
    if (expressionSource(requiredWhen) === expressionSource(conditionalRequired)) return;

    const name = typeof field.name === 'string' && field.name ? field.name : '(unnamed)';
    const canonical = describeExpression(requiredWhen);
    const alias = describeExpression(conditionalRequired);
    if (!firstTime(FIELD_REQUIREDWHEN_CONDITIONALREQUIRED_CONFLICT, name, canonical, alias)) return;

    findings.push(aliasFinding({
      subject: 'Field',
      where: `field '${name}' on ${ownerLabel}`,
      canonicalKey: 'requiredWhen',
      aliasKey: 'conditionalRequired',
      canonical,
      alias,
      lost: 'never gates the field',
      fix: `If ${alias} is the predicate you meant, put it in 'requiredWhen' instead.`,
      rule: FIELD_REQUIREDWHEN_CONDITIONALREQUIRED_CONFLICT,
    }));
  };

  // ── agent.knowledge.sources vs .topics (#1878 / #1891) ─────────────────────
  const checkAgent = (agent: AnyRec) => {
    const knowledge = agent?.knowledge;
    if (!knowledge || typeof knowledge !== 'object') return;
    const { sources, topics } = knowledge as AnyRec;
    if (!isDeclaredList(sources) || !isDeclaredList(topics)) return;
    if (sameMembers(sources, topics)) return;

    const name = typeof agent.name === 'string' && agent.name ? agent.name : '(unnamed)';
    const canonical = describeList(sources);
    const alias = describeList(topics);
    if (!firstTime(AGENT_KNOWLEDGE_SOURCES_TOPICS_CONFLICT, name, canonical, alias)) return;

    findings.push(aliasFinding({
      subject: 'Agent knowledge',
      where: `agent '${name}' knowledge`,
      canonicalKey: 'sources',
      aliasKey: 'topics',
      canonical,
      alias,
      lost: 'is never recruited into RAG context',
      fix: `If ${alias} names the sources you meant, put them in 'sources' instead.`,
      rule: AGENT_KNOWLEDGE_SOURCES_TOPICS_CONFLICT,
    }));
  };

  // Object-nested actions first so the retained (deduped) finding keeps object
  // context; the same object walk covers its fields.
  for (const obj of asArray(stack.objects)) {
    const object = typeof obj.name === 'string' ? obj.name : undefined;
    for (const action of asArray(obj.actions)) checkAction(action, object);
    for (const field of asArray(obj.fields)) checkField(field, `object '${object ?? '(unnamed)'}'`);
  }
  for (const action of asArray(stack.actions)) checkAction(action);
  // An extension adds/overrides fields on an object owned by another package —
  // same `FieldSchema`, same transform, same silent discard.
  for (const ext of asArray(stack.objectExtensions)) {
    const target = typeof ext.objectName === 'string' ? ext.objectName
      : typeof ext.name === 'string' ? ext.name
      : '(unnamed)';
    for (const field of asArray(ext.fields)) checkField(field, `object extension '${target}'`);
  }
  for (const agent of asArray(stack.agents)) checkAgent(agent);

  return findings;
}

/** One-line console rendering, shared so `defineStack` and any other
 *  console-bound caller phrase the warning identically. */
export function formatDeprecatedAliasFinding(f: DeprecatedAliasFinding): string {
  return `${f.where}: ${f.message}\n  ${f.hint}\n  rule: ${f.rule}`;
}
