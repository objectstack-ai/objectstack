// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The RUNTIME publish gate over the author-time rule registry (#4463).
 *
 * ## The hole this closes
 *
 * #4409/#4445 put 26 author-time rules behind one table and made `os validate`,
 * `os build` and `os lint` run it by construction. All three are CLI commands.
 * The metadata WRITE path — Studio's designer, REST `/meta` item CRUD, an
 * MCP/AI author — reaches `saveMetaItem`, which ran a per-type Zod `safeParse`
 * and nothing else. Zero of the 26 rules ran there. For a tenant that is not
 * one weak door among four, it is the ONLY door: `os lint` cannot see a
 * `sys_metadata` overlay row at all, so there was no command they could run
 * instead.
 *
 * It also happens to be the door AI authors use. That is the axis the #4463
 * ruling weighted highest: metadata written by a model is exactly the metadata
 * most likely to be subtly wrong, and it was arriving through the one entrance
 * with no checks on it.
 *
 * ## Shape
 *
 * This module is a GATE, not a rule engine. It owns no judgement: every finding
 * it returns came from {@link AUTHORING_RULES}, the same array the three CLI
 * commands run. Delete a rule from that table and this gate stops enforcing it
 * in the same commit — which is the property the issue asked for, and the
 * reason a second "runtime rule list" was never on the table.
 *
 * ## Why it evaluates DIFFERENTIALLY
 *
 * The rules are `(stack) => findings`. A runtime write is one ITEM. The gate
 * therefore builds a per-write snapshot — the written item, plus the live
 * registry's objects as resolution context — and runs the rules TWICE: once on
 * the context alone, once with the item grafted in. Only findings the item
 * ADDED are attributable to this write.
 *
 * That is not defensive padding, it is the D4 requirement made structural:
 *
 * - a tenant's existing `sys_metadata` rows may already violate a rule that did
 *   not exist when they were written, and the read path must keep serving them
 *   (ADR-0087's asymmetry). Gating on the absolute finding set would make an
 *   unrelated legacy row block every future save;
 * - the context is resolution material, not subject matter. Without the
 *   subtraction, saving flow A would 422 because object B — untouched, already
 *   stored, possibly shipped in a package — has a bad predicate.
 *
 * The cost is two passes over a small in-memory snapshot, on a PUBLISH (not on
 * a draft autosave). That is the correct place to spend it.
 */

import {
  AUTHORING_RULES,
  type AuthoringFinding,
  type AuthoringRule,
  type AuthoringRuleContext,
} from './authoring-rules.js';

type AnyRec = Record<string, unknown>;

/**
 * The stack-key each gated metadata type occupies in a stack view.
 *
 * Only the types some rule declares in `runtimeTypes` need an entry; the guard
 * in `authoring-rule-wiring.test.ts` fails if a declared type is missing one,
 * so widening the gate cannot half-land.
 */
const TYPE_TO_STACK_KEY: Readonly<Record<string, string>> = {
  flow: 'flows',
  object: 'objects',
  view: 'views',
  action: 'actions',
  page: 'pages',
  dashboard: 'dashboards',
  agent: 'agents',
  hook: 'hooks',
  // [#7576] `data`, NOT `seeds`. The metadata TYPE is `seed`; the stack KEY that
  // holds seeds is `data` (`ObjectStackDefinitionSchema.data: z.array(SeedSchema)`)
  // — a stack has no `seeds` key at all, and `PLURAL_TO_SINGULAR` declares no
  // mapping onto one either.
  //
  // The wrong spelling was INERT rather than harmless, and it is the #4449 shape
  // one surface over: the wiring guard asks only that a declared type HAS a
  // mapping, never that the mapping names a key some rule reads. So it would
  // have stayed green while the gate built `{ objects, seeds: [item] }` for
  // every seed write and every rule reading `stack.data` saw nothing — wired,
  // and running on nothing, with `rulesRun` reporting the rules as having run.
  // Nothing declares `seed` in `runtimeTypes` today, so correcting it changes no
  // behaviour now; it is corrected here, with the measurement that found it
  // (#7576), rather than left for the rollout card to trip over.
  seed: 'data',
};

/** Everything the gate needs from the host runtime to build a snapshot. */
export interface RuntimeStackContext {
  /**
   * The live object declarations (registry + tenant overlay), as authored.
   *
   * Objects are the resolution universe almost every rule needs: `record.<field>`
   * in a CEL predicate, a flow node's target object, a template path. This is
   * where the runtime is strictly BETTER informed than `os lint`, which sees one
   * package's config file and has to hedge.
   */
  objects?: readonly unknown[];
}

/** One rule's verdict at the runtime surface, carrying which rule produced it. */
export interface RuntimeGateResult {
  /** Findings the written item ADDED, severity `error` — the reason to refuse the write. */
  errors: AuthoringFinding[];
  /** Findings the written item added at `warning` / `info`. Never blocks (#4463 P1). */
  advisories: AuthoringFinding[];
  /** Names of the registry rules that actually ran, in registry order. */
  rulesRun: string[];
}

/**
 * The rules the runtime publish gate runs for a write of `type` — read off
 * {@link AUTHORING_RULES}, never a list of its own.
 *
 * @param type Singular metadata type name (`flow`, `object`, …).
 */
export function runtimeAuthoringRulesFor(type: string): readonly AuthoringRule[] {
  return AUTHORING_RULES.filter(
    (r) => r.surfaces.includes('runtime-publish') && (r.runtimeTypes ?? []).includes(type),
  );
}

/** Every singular metadata type at least one rule gates at the runtime surface. */
export function runtimeGatedTypes(): string[] {
  const types = new Set<string>();
  for (const rule of AUTHORING_RULES) {
    if (!rule.surfaces.includes('runtime-publish')) continue;
    for (const t of rule.runtimeTypes ?? []) types.add(t);
  }
  return [...types].sort();
}

/** The stack key a metadata type occupies in a stack view, or null when unmapped. */
export function stackKeyForType(type: string): string | null {
  return TYPE_TO_STACK_KEY[type] ?? null;
}

/** Stable identity of a finding, so two rule passes can be set-differenced. */
const fingerprint = (f: AuthoringFinding) => `${f.rule}\u0000${f.where}\u0000${f.path}\u0000${f.message}`;

function runRules(
  rules: readonly AuthoringRule[],
  stack: AnyRec,
  ctx: AuthoringRuleContext,
): AuthoringFinding[] {
  const findings: AuthoringFinding[] = [];
  for (const rule of rules) {
    // A rule that throws on an unexpected runtime body must not take the write
    // down with it: the gate's job is to REFUSE bad metadata, and an internal
    // error is not a verdict about the author's document. Surfaced as a
    // warning-tier finding so it is neither silent nor fatal.
    try {
      findings.push(...rule.run(stack, ctx));
    } catch (err) {
      findings.push({
        severity: 'warning',
        rule: 'authoring-rule-threw',
        where: rule.name,
        path: rule.source,
        message: `rule ${rule.name} threw while judging this write: ${err instanceof Error ? err.message : String(err)}`,
        hint:
          'This is a bug in the rule, not in the metadata — the write was not blocked by it. '
          + 'Please report it with the body that triggered it.',
      });
    }
  }
  return findings;
}

/**
 * Judge one about-to-be-published metadata item against the shared registry.
 *
 * Returns an empty `errors` array when the item is clean OR when no rule gates
 * its type — callers must not treat "no rules ran" as a failure, and
 * `rulesRun` is there so a caller can tell the two apart.
 *
 * Pure: no I/O, no `process.env`, no logging. The escape hatch and the HTTP
 * status live at the call site, where the request context is.
 */
export function runRuntimeAuthoringRules(args: {
  /** Singular metadata type of the item being written. */
  type: string;
  /** The item body as it will be persisted. */
  item: unknown;
  /** Live resolution context from the host runtime. */
  context?: RuntimeStackContext;
  /** ADR-0080 SDUI manifest, when the host has one. */
  sduiManifest?: unknown;
}): RuntimeGateResult {
  const rules = runtimeAuthoringRulesFor(args.type);
  const empty: RuntimeGateResult = { errors: [], advisories: [], rulesRun: [] };
  if (rules.length === 0) return empty;

  const stackKey = stackKeyForType(args.type);
  if (!stackKey) return empty;
  if (!args.item || typeof args.item !== 'object') return empty;

  const item = args.item as AnyRec;
  const itemName = typeof item.name === 'string' ? item.name : undefined;
  const contextObjects = (args.context?.objects ?? []) as AnyRec[];
  const ctx: AuthoringRuleContext = { sduiManifest: args.sduiManifest };

  // When the written type IS the context collection (an `object` write), the
  // item must REPLACE its stored self rather than erase the other objects —
  // otherwise every lookup in the tenant's model reads as dangling. Written
  // generally so widening `runtimeTypes` to `object` is a data edit, not a
  // rewrite of this function.
  const writesIntoContext = stackKey === 'objects';
  const baselineObjects = writesIntoContext
    ? contextObjects.filter((o) => !itemName || o?.name !== itemName)
    : contextObjects;

  // Baseline: the resolution context WITHOUT the written item. Anything found
  // here is somebody else's pre-existing condition and is not this write's to
  // answer for (#4463 D4 — the gate blocks new writes, never stored rows).
  const baseline: AnyRec = { objects: baselineObjects };
  // Candidate: the same context with this write's item added. For a non-object
  // type it is the SOLE member of its own collection, so index-0 paths in the
  // findings are unambiguously this write.
  const candidate: AnyRec = writesIntoContext
    ? { objects: [...baselineObjects, item] }
    : { objects: baselineObjects, [stackKey]: [item] };

  const before = new Set(runRules(rules, baseline, ctx).map(fingerprint));
  const added = runRules(rules, candidate, ctx).filter((f) => !before.has(fingerprint(f)));

  return {
    errors: added.filter((f) => f.severity === 'error'),
    advisories: added.filter((f) => f.severity !== 'error'),
    rulesRun: rules.map((r) => r.name),
  };
}
