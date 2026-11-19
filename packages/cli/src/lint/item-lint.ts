// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#34777] `os lint --item <file> --type <type>` — the author-time rules that
 * can judge ONE metadata item without the rest of its stack, and the names of
 * the ones that cannot.
 *
 * ## Who this is for
 *
 * A developer or an AI client that authors metadata item by item from the
 * command line (`os meta register --data <file>`), against a runtime, with no
 * project on disk. `os lint` judges a whole stack; such a client has one JSON
 * body and nothing to hand it. This mode places the body alone in a stack of
 * its own and runs the shared rule table over it.
 *
 * ## How a rule is classified — measured, per run, from what the rule reads
 *
 * Every entry of the shared author-time rule table (`authoringRulesFor('lint')`,
 * the table `os lint`, `os build` and `os validate` run) is a function of the
 * stack it is handed. Each entry is run on the one-item stack through a proxy
 * that records every top-level stack key the entry reads (a property read, an
 * `in` test, an own-property probe) and records an enumeration of the stack's
 * keys as a read of EVERY key. The engine filter judge the table is handed
 * (`judgeFilter`, built from the stack's objects) is recorded as a read of
 * `objects` when the entry calls it. Then:
 *
 *  - read the item's own collection and nothing else ⇒ JUDGED: the entry's
 *    findings are reported, exactly as `os lint` would report them;
 *  - read the item's own collection AND any other key ⇒ NOT JUDGED: the
 *    entry's verdict on this item depends on metadata this run does not have,
 *    so its findings are dropped and the entry is named, with the keys it read;
 *  - never read the item's own collection ⇒ the entry does not judge this
 *    type, and is neither run nor named.
 *
 * The classification is therefore of the code path the entry took on THIS
 * item, not a hand-kept list, and a rule added to the table is classified by
 * the same measurement with no edit here.
 *
 * ## What the measurement cannot see, stated
 *
 *  - It is per top-level key. An entry that resolves the item's references to
 *    OTHER items of the item's own type (an object's lookup to another object)
 *    reads only the item's own collection and is classified JUDGED; in this
 *    mode it sees no such other item.
 *  - It is conservative in the other direction: an entry that walks every
 *    collection and judges each item by itself also reads the other keys, and
 *    is named as not judged although it would have judged this item alone.
 *
 * ## `os lint`'s own rubric
 *
 * The hand-written checks `lintConfig` runs beside the table are not entries
 * of it, so they are classified here from their code: the per-entry naming,
 * label and structure checks (`entryConventionIssues`) read each entry alone
 * and run; the families below read the package or the whole stack and are
 * named as not run. The package-manifest checks (the `engines` range, the
 * dependency ranges), the hook-lowering check (it reads inline functions, which
 * a JSON body cannot carry) and the package docs (files beside a config) have
 * nothing to judge on one item and are neither run nor named.
 */

import { normalizeStackInput, type ConversionNotice } from '@objectstack/spec';
import { PLURAL_TO_SINGULAR, SINGULAR_TO_PLURAL } from '@objectstack/spec/shared';
import { authoringRulesFor, type AuthoringFinding, type AuthoringRuleContext } from '@objectstack/lint';
import { lowerCallables } from '../utils/lower-callables.js';
import { stackFilterJudge } from '../utils/authoring-filter-judge.js';

type AnyRec = Record<string, unknown>;

/** The key a read of every stack key is recorded under (an enumeration of the stack). */
export const EVERY_KEY = '(every key)';

/** One rule-table entry this run could not judge the item with, and what it read. */
export interface ItemRuleNotJudged {
  /** The table entry's name — the id `authoring-rules.ts` registers it under. */
  rule: string;
  /** The top-level stack keys the entry read, sorted; {@link EVERY_KEY} for an enumeration. */
  reads: string[];
}

/** One `os lint` rubric family this mode does not run, and why. */
export interface ItemFamilyNotRun {
  family: string;
  reason: string;
}

export interface ItemLintResult {
  /** The canonical singular type the item was judged as. */
  type: string;
  /** The stack key the item was placed under. */
  stackKey: string;
  /** Findings of the rule-table entries that judged the item alone, in table order. */
  findings: AuthoringFinding[];
  /** The rule-table entries that judged the item alone, in table order. */
  judged: string[];
  /** The rule-table entries whose verdict needs more than the item, in table order. */
  notJudged: ItemRuleNotJudged[];
  /** `os lint`'s own rubric families this mode does not run. */
  familiesNotRun: ItemFamilyNotRun[];
  /** The one-item stack as normalized (ADR-0087 D2 conversions applied). */
  stack: AnyRec;
  /** The ADR-0087 D2 conversions the normalization applied to the item. */
  conversions: ConversionNotice[];
}

/**
 * The types this mode accepts: every stack collection the spec declares
 * (`SINGULAR_TO_PLURAL`, the `defineStack()` collection map), sorted. A type
 * outside it has no place in a stack, so no rule can read it.
 */
export function itemLintTypes(): string[] {
  return Object.keys(SINGULAR_TO_PLURAL).sort();
}

/**
 * The canonical singular type and its stack key for a `--type` argument (a
 * singular, or the collection's plural spelling), or a refusal naming the
 * accepted types.
 */
export function resolveItemType(
  raw: string,
): { ok: true; type: string; stackKey: string } | { ok: false; message: string } {
  const value = raw.trim();
  const type = Object.hasOwn(SINGULAR_TO_PLURAL, value)
    ? value
    : Object.hasOwn(PLURAL_TO_SINGULAR, value) ? PLURAL_TO_SINGULAR[value] : undefined;
  if (type === undefined) {
    return {
      ok: false,
      message:
        `'${raw}' is not a metadata type --item can judge. --type takes one of: ${itemLintTypes().join(', ')}.`,
    };
  }
  return { ok: true, type, stackKey: SINGULAR_TO_PLURAL[type] };
}

/** The stack, behind a proxy that records each top-level key read into `reads`. */
function recordingStack(stack: AnyRec, reads: Set<string>): AnyRec {
  return new Proxy(stack, {
    get(target, key, receiver) {
      if (typeof key === 'string') reads.add(key);
      return Reflect.get(target, key, receiver);
    },
    has(target, key) {
      if (typeof key === 'string') reads.add(key);
      return Reflect.has(target, key);
    },
    getOwnPropertyDescriptor(target, key) {
      if (typeof key === 'string') reads.add(key);
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
    // A copy or a walk of the stack sees every key a full stack would carry,
    // and what it reads through the copy is not seen here: every key.
    ownKeys(target) {
      reads.add(EVERY_KEY);
      return Reflect.ownKeys(target);
    },
  });
}

/** The `os lint` rubric families this mode does not run for `type` (see the header). */
function familiesNotRunFor(type: string): ItemFamilyNotRun[] {
  const families: ItemFamilyNotRun[] = [
    {
      family: 'naming/namespace-prefix',
      reason: 'judges a name against its package manifest\'s namespace and the package\'s other declarations',
    },
    {
      family: 'i18n coverage',
      reason: 'judges labels against the stack\'s locales and translation bundles',
    },
  ];
  if (type === 'object') {
    families.push({
      family: 'data-model best practices',
      reason: 'indexes the relationship fields of every object in the stack (lintDataModel)',
    });
  }
  return families;
}

/**
 * Judge one item: place it alone under its stack key, normalize it as
 * `os lint` normalizes a config, and run each rule-table entry through the
 * recording proxy (see the header for the classification).
 */
export function lintItem(item: AnyRec, type: string, stackKey: string): ItemLintResult {
  const conversions: ConversionNotice[] = [];
  const stack = normalizeStackInput({ [stackKey]: [item] } as Record<string, unknown>, {
    onConversionNotice: (n) => conversions.push(n),
  }) as AnyRec;
  // The tiers `lintConfig` hands the table: `normalized`, and the lowered
  // view for `parsed` entries (a JSON body has no callable to lower, so this
  // is the same stack in every case a file can carry).
  const { lowered, loweredHookRefs } = lowerCallables(stack);
  const judge = stackFilterJudge(lowered as AnyRec);

  const findings: AuthoringFinding[] = [];
  const judged: string[] = [];
  const notJudged: ItemRuleNotJudged[] = [];
  for (const rule of authoringRulesFor('lint')) {
    const reads = new Set<string>();
    const tier = rule.input === 'normalized' ? stack : (lowered as AnyRec);
    const ctx: AuthoringRuleContext = {
      loweredHookRefs,
      judgeFilter: ((...args: Parameters<typeof judge>) => {
        reads.add('objects');
        return judge(...args);
      }) as AuthoringRuleContext['judgeFilter'],
    };
    const ruleFindings = rule.run(recordingStack(tier, reads), ctx);
    if (!reads.has(stackKey) && !reads.has(EVERY_KEY)) continue;
    const others = [...reads].filter((key) => key !== stackKey);
    if (others.length > 0) {
      notJudged.push({ rule: rule.name, reads: [...reads].sort() });
      continue;
    }
    judged.push(rule.name);
    findings.push(...ruleFindings);
  }
  return {
    type,
    stackKey,
    findings,
    judged,
    notJudged,
    familiesNotRun: familiesNotRunFor(type),
    stack,
    conversions,
  };
}
