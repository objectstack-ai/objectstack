// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14969] `SharingRuleEvaluationResult.grantsRefused?: number` — the OPTIONAL
 * seventh key, lifted into the contract because the wire already carried it:
 * `POST /api/v1/sharing/rules/:idOrName/evaluate` answers the service's return
 * value unfiltered (ledgered `sdk` / `shares.rules.evaluate`), so the declared
 * client type lagged the route by exactly this key and the count could not be
 * read without a cast.
 *
 * Three things are pinned, because each drifts on its own:
 *
 *  1. **Optionality, in both directions, at the type level.** The six counts
 *     stay REQUIRED and `grantsRefused` is the ONE optional key. Making it
 *     required would break every other `ISharingRuleService` implementer,
 *     in-tree and out; a second optional key, or a drift of the value type
 *     away from `number`, turns the exported aliases red under
 *     `check:test-typecheck`, which compiles this file under
 *     `tsconfig.test.json`.
 *  2. **The covariant narrowing composes.** A subtype that REQUIRES the key
 *     (`@objectstack/plugin-sharing`'s `SharingRuleReconcilePassResult`) is
 *     still a legal `evaluateRule` return type, and a six-key implementation
 *     keeps compiling untouched — the two facts the card's "optional, not
 *     required" rests on.
 *  3. **The JSDoc carries the absent-is-not-zero rule.** "Unset" means "this
 *     implementation does not report refusals", never "no grant was refused".
 *     Prose is unassertable except by reading it, so the contract source is
 *     read and the doc block above the key is required to say so, and to name
 *     what a refusal IS (`ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED` on an
 *     organization-less insert into a tenant-scoped `sys_record_share`).
 *
 * ⛔ Not pinned, deliberately: whether any implementation COUNTS refusals.
 * That is the services half (`@objectstack/plugin-sharing`'s own
 * `reconcile-refused-grant-continues.test.ts`); this file pins the contract.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import type { ISharingRuleService, SharingRuleEvaluationResult } from './sharing-service';

/** Type-level identity: true iff A and B are the same type. */
type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
/** Compile error when the argument is not `true`. */
type Assert<T extends true> = T;

/**
 * `-?` strips optionality, then `object extends Pick<T, K>` is true exactly
 * when K was optional — so the union is the mandatory keys (the
 * `sharing-service.test.ts` #5858 idiom).
 */
type RequiredKeys<T> = { [K in keyof T]-?: object extends Pick<T, K> ? never : K }[keyof T];
/** The complement: the keys a literal of T may omit. */
type OptionalKeys<T> = Exclude<keyof T, RequiredKeys<T>>;

/**
 * The six counts every implementation reports, spelled once. `satisfies`
 * proves each is a key; the `Eq` below proves the mandatory set is exactly
 * these and nothing else.
 */
export const SHARING_RULE_EVALUATION_REQUIRED_KEYS = [
  'ruleId',
  'matchedRecords',
  'expandedUsers',
  'grantsCreated',
  'grantsUpdated',
  'grantsRevoked',
] as const satisfies readonly (keyof SharingRuleEvaluationResult)[];

/**
 * Exported deliberately — an unread alias inside a test body is TS6196, and a
 * pin no program compiles is no pin at all.
 */
export type SixCountsStayRequired = Assert<
  Eq<RequiredKeys<SharingRuleEvaluationResult>, (typeof SHARING_RULE_EVALUATION_REQUIRED_KEYS)[number]>
>;
/** `grantsRefused` is the ONE optional key — a second one fails here by name. */
export type GrantsRefusedIsTheOnlyOptionalKey = Assert<Eq<OptionalKeys<SharingRuleEvaluationResult>, 'grantsRefused'>>;
/** …and it is a number when present, exactly `number | undefined` as read. */
export type GrantsRefusedIsANumberWhenPresent = Assert<Eq<SharingRuleEvaluationResult['grantsRefused'], number | undefined>>;

/**
 * The plugin-local narrowing, re-declared here under its own name so the
 * composition is pinned against the SHAPE, not against an import of
 * `@objectstack/plugin-sharing` (spec must not depend on a plugin).
 */
interface RequiresTheCount extends SharingRuleEvaluationResult {
  grantsRefused: number;
}

describe('[#14969] SharingRuleEvaluationResult.grantsRefused is optional, and absent is not zero', () => {
  it('reads a non-empty required set (anti-vacuity)', () => {
    expect(SHARING_RULE_EVALUATION_REQUIRED_KEYS).toHaveLength(6);
    const pinned: [SixCountsStayRequired, GrantsRefusedIsTheOnlyOptionalKey, GrantsRefusedIsANumberWhenPresent] = [true, true, true];
    expect(pinned).toEqual([true, true, true]);
  });

  it('a six-key result and a seven-key result are both members (compile-time)', () => {
    // An implementation that does not count refusals: the key is ABSENT.
    const silent: SharingRuleEvaluationResult = {
      ruleId: 'rule_1',
      matchedRecords: 3,
      expandedUsers: 2,
      grantsCreated: 2,
      grantsUpdated: 0,
      grantsRevoked: 1,
    };
    // An implementation that does, and refused nothing this pass: a PRESENT 0.
    const counted: SharingRuleEvaluationResult = { ...silent, grantsRefused: 0 };
    // …and one that refused two grants and CONTINUED — not a failed pass.
    const refused: SharingRuleEvaluationResult = { ...silent, grantsRefused: 2 };

    // @ts-expect-error `grantsRefused` is a count — a string is not a member (#14969)
    const notACount: SharingRuleEvaluationResult = { ...silent, grantsRefused: 'x' };

    // The runtime shape of the distinction the JSDoc draws: `'grantsRefused' in`
    // separates "does not report" from "reported 0"; a `?? 0` consumer would
    // collapse exactly this and is the reading the contract forbids.
    expect('grantsRefused' in silent).toBe(false);
    expect(silent.grantsRefused).toBeUndefined();
    expect('grantsRefused' in counted).toBe(true);
    expect(counted.grantsRefused).toBe(0);
    expect(refused.grantsRefused).toBe(2);
    expect(notACount.ruleId).toBe('rule_1');
  });

  it('the required-narrowing subtype composes with ISharingRuleService (compile-time)', async () => {
    // A subtype that REQUIRES the key is still a member of the contract type…
    const narrowed: RequiresTheCount = {
      ruleId: 'rule_1',
      matchedRecords: 1,
      expandedUsers: 1,
      grantsCreated: 0,
      grantsUpdated: 0,
      grantsRevoked: 0,
      grantsRefused: 1,
    };
    const widened: SharingRuleEvaluationResult = narrowed;

    // …and a service whose `evaluateRule` returns the narrowed type is still an
    // `ISharingRuleService['evaluateRule']` — the covariant return the card
    // names as the reason the key must be optional in the spec.
    const evaluateNarrowed = async (): Promise<RequiresTheCount> => narrowed;
    const evaluateRule: ISharingRuleService['evaluateRule'] = evaluateNarrowed;

    // The mirror: a six-key implementation keeps compiling untouched, which is
    // exactly what a REQUIRED key would break (in-tree and out).
    const evaluateSilent: ISharingRuleService['evaluateRule'] = async (idOrName) => ({
      ruleId: idOrName,
      matchedRecords: 0,
      expandedUsers: 0,
      grantsCreated: 0,
      grantsUpdated: 0,
      grantsRevoked: 0,
    });

    // @ts-expect-error the narrowed subtype cannot OMIT the key it requires (#14969)
    const narrowedWithoutCount: RequiresTheCount = { ...widened, grantsRefused: undefined };

    expect(widened.grantsRefused).toBe(1);
    expect((await evaluateRule('rule_1', { userId: 'usr_1' })).grantsRefused).toBe(1);
    expect((await evaluateSilent('rule_1', { userId: 'usr_1' })).grantsRefused).toBeUndefined();
    expect(narrowedWithoutCount.ruleId).toBe('rule_1');
  });

  it('the contract JSDoc states absent-is-not-zero beside the key', () => {
    const source = readFileSync(fileURLToPath(new URL('./sharing-service.ts', import.meta.url)), 'utf8');
    const declaration = 'grantsRefused?: number;';
    const at = source.indexOf(declaration);
    expect(at).toBeGreaterThan(-1);
    // Exactly one declaration — a second spelling of the key is drift.
    expect(source.indexOf(declaration, at + 1)).toBe(-1);
    // The doc block immediately above the declaration — from its last `/**`,
    // unwrapped: each continuation line's ` * ` prefix becomes one space, so a
    // sentence the author re-wraps is still read as one sentence.
    const docStart = source.lastIndexOf('/**', at);
    const doc = source.slice(docStart, at).replace(/\s*\n\s*\*\s?/g, ' ');
    // What a refusal IS, in the card's own terms.
    expect(doc).toContain('`ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED` on an organization-less insert');
    expect(doc).toContain('tenant-scoped `sys_record_share`');
    // The rule the optionality carries: absent, not 0; unset = not reported.
    expect(doc).toContain('ABSENT — not `0` — from any implementation that does not count refusals');
    expect(doc).toContain('read "unset" as "this implementation does not report refusals"');
    expect(doc).toContain('never as "no grant was refused"');
    // A refused grant is not a failed pass.
    expect(doc).toContain('NOT "the pass failed"');
  });
});
