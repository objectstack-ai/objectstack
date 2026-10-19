// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Declared sharing rules, read from the registry — ADR-0131 D2, ADR-0057 D6.
 *
 * A stack's `sharingRules` are code. They used to be COPIED into
 * `sys_sharing_rule` at every boot by a seeder (`bootstrapDeclaredSharingRules`,
 * retired by ADR-0131 D2 at C3 stage 9 — its retirement note is the ADR-0087
 * `sharing-rule-declared-mirror-retired` entry). Enforcement now reads the
 * declaration itself, here, on every read of the rule set
 * (`SharingRuleService.listRules` / `getRule` / the orphan sweep), and
 * `sys_sharing_rule` holds only the rules an organization authors.
 *
 * ## Where the declaration is read
 *
 * The same two in-process readers, in the same order, the seeder read:
 *
 *  1. ObjectQL's `SchemaRegistry` (`engine.registry.listItems('sharing_rule')`),
 *     which `AppPlugin.init()` fills from every manifest's `sharingRules` —
 *     forward-converted before registration, so `sharedWith.type` and
 *     `accessLevel` already carry their current spellings. A disabled
 *     package's items are hidden by `listItems` itself.
 *  2. The kernel `metadata` service (`list('sharing_rule')`), only when the
 *     registry holds no rule at all — the registry-less host.
 *
 * `sharing_rule` needs no registered metadata kind for either read: the
 * registry keys items by the type string `METADATA_ARRAY_KEYS` maps
 * `sharingRules` to, and the metadata service binds the type through its
 * unregistered-kind schema.
 *
 * ## The shape enforcement reads (ADR-0057 D6)
 *
 * The RUNTIME shape is canonical, so each declaration is translated into it
 * ({@link translateDeclaredSharingRule}): CEL `condition` → `criteria`
 * FilterCondition through the one canonical compiler, `sharedWith{type,value}`
 * → `recipient_type` / `recipient_id`. The registry copy carries `condition`
 * as the authored bare string and the metadata door's copy as
 * `{ dialect, source }`; the compiler takes both, so the two copies translate
 * to the same rule. What the runtime cannot enforce is SKIPPED (logged once
 * per rule per process), never served as a match-all rule — silently
 * over-sharing would be worse than not enforcing (ADR-0049):
 *   - a CEL `condition` the canonical compiler cannot lower (functions,
 *     cross-object traversal) — ADR-0058 D2. Compound predicates (AND/OR,
 *     comparisons, null, in) DO lower and are enforced (ADR-0058 D3).
 *   - a missing or empty `condition`, or one that lowers to no predicate at
 *     all — it would share every record of the object.
 *   - defensively, any stale pre-built package that still registers an old
 *     `owner`-type / unmapped-recipient shape.
 */

import type { SharingRuleRecipientType, ShareAccessLevel } from '@objectstack/spec/contracts';
import { compileCelToFilter } from '@objectstack/formula';
import type { CelFilterFailReason } from '@objectstack/formula';
import { isMatchAllCriteria } from './rule-criteria.js';
import { FIELD_NAME_GRAMMAR } from './sharing-rule-service.js';

type Logger = { info?: (m: string, meta?: any) => void; warn?: (m: string, meta?: any) => void };

/** Map the spec `sharedWith.type` onto a runtime recipient_type, or null. */
function mapRecipientType(t: unknown): SharingRuleRecipientType | null {
  switch (t) {
    case 'user': return 'user';
    // Flat sys_team membership (ADR-0090 D3 vocabulary; the pre-D3 `group`
    // spelling was retired) — expanded by TeamGraphService in expandRecipient.
    case 'team': return 'team';
    case 'position': return 'position';
    // ADR-0057 D5: business-unit subtree recipient.
    case 'business_unit': return 'business_unit' as SharingRuleRecipientType;
    case 'unit_and_subordinates': return 'unit_and_subordinates' as SharingRuleRecipientType;
    // [#15072] The RECORD-RELATIVE recipient (#14103, maintainer ruling B):
    // `value` is a field NAME, held to the `FieldSchema.name` grammar at parse,
    // and `SharingRuleService` reads that column on each matched record.
    case 'field': return 'field';
    // Defensive only: the authoring enum matches the cases above 1:1, but a
    // stale pre-built package could still register a retired shape — skip,
    // never seed match-all.
    default: return null;
  }
}

/**
 * Compile a sharing-rule CEL `condition` into the runtime `criteria_json`
 * FilterCondition (ADR-0058 D1, the substance of #1887).
 *
 * Delegates to the ONE canonical CEL → FilterCondition pushdown compiler in
 * `@objectstack/formula`. A sharing condition is a pure record predicate — no
 * `current_user.*` — so it resolves with the default `record` field root and an
 * empty variable scope. This lowers the full pushdown subset (`==`/`!=`,
 * comparisons, `in`, `&&`/`||`/`!`, `== null`, string ops), not just the former
 * `record.field == <literal>` shape, so compound criteria now SEED and ENFORCE
 * instead of being skipped as experimental. Anything non-pushdownable (functions,
 * cross-object traversal) still returns null → the caller skips it (logged),
 * never seeding a permissive match-all (ADR-0049).
 */
export function celToFilter(cel: unknown): Record<string, unknown> | null {
  return celToFilterOutcome(cel).filter;
}

/**
 * Why a declared rule's `condition` produced no criteria — the compiler's OWN
 * answer, carried instead of discarded. [#13943]
 *
 * `compileCelToFilter` already returns `{ reason, detail }` on every refusal;
 * `celToFilter` used to consume `!ok` and collapse the rest to `null` one line
 * before the only WARN that could surface it — so an operator whose declared
 * rule was silently not granting got the fact ("skipped") and the source text
 * back, but not WHICH shape the compiler refused or why. The extra member is
 * this FILE's own drop (the ADR-0049 match-all guard at the call site), which
 * the compiler reports as a success — same skip, same silence, so it joins the
 * same vocabulary rather than staying unnamed (the `empty-membership`
 * precedent in `plugin-security/src/rls-compiler.ts`, #13639).
 */
type SharingSkipReason = CelFilterFailReason | 'match-all-criteria';

/** A skipped rule's cause: the compiler's `reason` (the aggregatable category) plus its human `detail` (the concrete fault). */
interface SharingSkipCause {
  reason: SharingSkipReason;
  detail: string;
}

/** {@link celToFilterOutcome}'s answer: the filter, or why there is none. */
type CelToFilterOutcome =
  | { filter: Record<string, unknown>; cause?: undefined }
  | { filter: null; cause: SharingSkipCause };

/**
 * [#13943] {@link celToFilter}'s answer WITH the reason it refused.
 *
 * Same compile, same decision, same returned filter — the only difference is
 * that the compiler's `{ reason, detail }` survives to the caller instead of
 * being collapsed into `null` at the `!result.ok` line. `celToFilter` stays
 * exactly as published (`Record | null`) and delegates here — the
 * `compileExpressionOutcome` shape from `plugin-security/src/rls-compiler.ts`
 * (#13942), one seam over.
 */
export function celToFilterOutcome(cel: unknown): CelToFilterOutcome {
  const result = compileCelToFilter(cel as string | { source?: string }, { variables: {} });
  if (!result.ok) return { filter: null, cause: { reason: result.reason, detail: result.detail } };
  return { filter: result.filter as Record<string, unknown> };
}


/** One declared rule in the runtime shape enforcement reads (ADR-0057 D6). */
export interface DeclaredSharingRule {
  name: string;
  label: string;
  description: string | null;
  object: string;
  criteria: Record<string, unknown>;
  recipientType: SharingRuleRecipientType;
  recipientId: string;
  accessLevel: ShareAccessLevel;
  active: boolean;
}

/** Why a declaration is not served: the compiler's own refusal, or a shape the runtime has no slot for. */
export type DeclaredSharingRuleSkip =
  | { kind: 'unnamed' }
  | { kind: 'unmappable-recipient'; sharedWith: unknown }
  | { kind: 'owner-rule' }
  | { kind: 'condition'; cause: SharingSkipCause };

/**
 * Translate ONE declaration into the runtime shape, or say why it is not
 * served. Pure: no read, no log — {@link createDeclaredSharingRuleSource} owns
 * the once-per-rule warning.
 */
export function translateDeclaredSharingRule(
  r: any,
): { rule: DeclaredSharingRule; skip?: undefined } | { rule?: undefined; skip: DeclaredSharingRuleSkip } {
  if (!r?.name || !r?.object) return { skip: { kind: 'unnamed' } };
  const recipientType = mapRecipientType(r.sharedWith?.type);
  if (!recipientType || !r.sharedWith?.value) {
    return { skip: { kind: 'unmappable-recipient', sharedWith: r.sharedWith?.type } };
  }
  // [#15072] A `field` recipient names a column, held to the `FieldSchema.name`
  // grammar — the check `defineRule` applied to the seeder's input. The
  // registry copy is not re-parsed, so a dotted path (`owner.manager_id`, a
  // graph walk spelled as a value) is refused here, not served to share with
  // nobody in silence.
  if (recipientType === 'field' && !FIELD_NAME_GRAMMAR.test(String(r.sharedWith.value))) {
    return { skip: { kind: 'unmappable-recipient', sharedWith: r.sharedWith?.type } };
  }
  // Defensive: `owner`-type rules were removed from the authoring spec
  // (live-membership-dependent, no static criteria equivalent) — this guards
  // stale pre-built packages that still register the old shape.
  if (r.type === 'owner') return { skip: { kind: 'owner-rule' } };
  // [#3896] A missing / empty condition is refused like any other condition
  // that does not lower: the authoring schema requires `condition`, so reaching
  // here means a hand-crafted `{ dialect, source: '' }` envelope or a stale
  // pre-built package, and neither earns a match-all.
  const outcome = celToFilterOutcome(r.condition);
  if (outcome.filter === null) return { skip: { kind: 'condition', cause: outcome.cause } };
  if (isMatchAllCriteria(outcome.filter)) {
    return {
      skip: {
        kind: 'condition',
        // The compiler answered `ok`, so there is no compiler detail to carry —
        // this drop is THIS file's match-all guard, and it names itself.
        cause: {
          reason: 'match-all-criteria',
          detail:
            `the condition lowered to ${JSON.stringify(outcome.filter)}, which constrains nothing — ` +
            'serving it would share every record of the object (ADR-0049)',
        },
      },
    };
  }
  return {
    rule: {
      name: String(r.name),
      label: String(r.label ?? r.name),
      description: r.description ?? null,
      object: String(r.object),
      criteria: outcome.filter,
      recipientType,
      recipientId: String(r.sharedWith.value),
      accessLevel: (r.accessLevel ?? 'read') as ShareAccessLevel,
      active: r.active !== false,
    },
  };
}

/** Where enforcement reads declared rules. Read on every call: the registry is the authority, never a snapshot of it. */
export interface DeclaredSharingRuleSource {
  list(): Promise<DeclaredSharingRule[]>;
}

/** The registry, as this read uses it — ObjectQL's `SchemaRegistry` (`engine.registry`) satisfies it. */
interface DeclaredRuleRegistry {
  listItems(type: string): readonly unknown[] | undefined;
}

/** The kernel `metadata` service, as this read uses it. */
interface DeclaredRuleMetadataService {
  list(type: string): unknown;
}

export interface DeclaredSharingRuleSourceOptions {
  /** The ObjectQL engine — its public `registry` is read. */
  engine: { registry?: DeclaredRuleRegistry } | null | undefined;
  /** The kernel `metadata` service, resolved at read time (it may register after this plugin). */
  metadata?: () => DeclaredRuleMetadataService | null | undefined;
  logger?: Logger;
}

const SKIP_WARN: Record<DeclaredSharingRuleSkip['kind'], string> = {
  unnamed: '[sharing-rule] declared rule not served (no name or object)',
  'unmappable-recipient': '[sharing-rule] declared rule not served (unmappable recipient) [experimental]',
  'owner-rule': '[sharing-rule] declared owner-based rule not served (retired authoring shape — use a criteria rule)',
  condition:
    '[sharing-rule] declared rule not served (missing or untranslatable CEL condition — never served as match-all) [experimental]',
};

/**
 * The declared-rule read enforcement uses (module doc): the registry first,
 * the metadata service only when the registry holds no rule.
 *
 * Translation is memoised per definition OBJECT, so a registry item is
 * compiled once however often the rule set is read, and a re-registered item
 * (a new object) is compiled again. A rule that is not served says so once
 * per name and cause per process, not on every read.
 */
export function createDeclaredSharingRuleSource(opts: DeclaredSharingRuleSourceOptions): DeclaredSharingRuleSource {
  const memo = new WeakMap<object, ReturnType<typeof translateDeclaredSharingRule>>();
  const warned = new Set<string>();

  const readRegistry = (): unknown[] => {
    const items = opts.engine?.registry?.listItems?.('sharing_rule');
    return Array.isArray(items) ? items.filter(Boolean) : [];
  };
  const readMetadata = async (): Promise<unknown[]> => {
    const service = opts.metadata?.();
    if (!service?.list) return [];
    const listed: any = service.list('sharing_rule');
    const items = typeof listed?.then === 'function' ? await listed : listed;
    return Array.isArray(items) ? items.filter(Boolean) : [];
  };
  const translate = (def: unknown): ReturnType<typeof translateDeclaredSharingRule> => {
    if (def === null || typeof def !== 'object') return translateDeclaredSharingRule(def);
    let out = memo.get(def);
    if (!out) {
      out = translateDeclaredSharingRule(def);
      memo.set(def, out);
    }
    return out;
  };
  const warnOnce = (def: any, skip: DeclaredSharingRuleSkip): void => {
    const cause = skip.kind === 'condition' ? skip.cause.reason : skip.kind;
    const key = `${String(def?.name ?? '')}::${cause}`;
    if (warned.has(key)) return;
    warned.add(key);
    const meta: Record<string, unknown> = { rule: def?.name };
    if (skip.kind === 'unmappable-recipient') meta.sharedWith = skip.sharedWith;
    if (skip.kind === 'condition') {
      // [#13943] The skip keeps its REASON: the shape the compiler refused and
      // why, not only the fact and the source text.
      Object.assign(meta, { condition: def?.condition, reason: skip.cause.reason, detail: skip.cause.detail });
    }
    opts.logger?.warn?.(SKIP_WARN[skip.kind], meta);
  };

  return {
    async list(): Promise<DeclaredSharingRule[]> {
      let defs = readRegistry();
      if (defs.length === 0) defs = await readMetadata();
      const out: DeclaredSharingRule[] = [];
      const names = new Set<string>();
      for (const def of defs) {
        const translated = translate(def);
        if (translated.skip) {
          warnOnce(def, translated.skip);
          continue;
        }
        // One rule per name: the registry already refuses a second package
        // registering a held name, so a duplicate here is the same item twice.
        if (names.has(translated.rule.name)) continue;
        names.add(translated.rule.name);
        out.push(translated.rule);
      }
      return out;
    },
  };
}
