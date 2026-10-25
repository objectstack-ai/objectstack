/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ⭐ THE CHEAP DEFENCE-IN-DEPTH PIN — objectui#6837 half 2.
 *
 * Maintainer ruling, 2026-08-31 (第 6 场总监席决裁批 #14). The half-2 delivery
 * requirement, 原文照录:
 *
 * > 防御深度钉(便宜):读者遇到遗留键时 dev 模式警告一次并指向本裁定——协议之
 * > 外的键不解析,但不无声。
 *
 * Half 2 deleted the per-reader `reference_to` fallback arms. What makes that
 * deletion survivable for a served legacy def is the ingestion choke point,
 * which folds whichever legacy spelling arrived onto `reference`. But a choke point that absorbs a
 * producer's bug SILENTLY is the AGENTS.md #0.1 failure mode by another name —
 * so it now says so, once, in dev.
 *
 * ## What each case here is actually measuring
 *
 * The three pins the card names, plus the two controls without which they would
 * be satisfiable by a warning that never fires (or one that fires always):
 *
 *   1. fires on a legacy-only def          — the pin
 *   2. does NOT fire on a canonical def    — the negative control
 *   3. does NOT fire twice                 — the flood control
 *   4. names the field and the ruling      — the message is the deliverable,
 *                                            not the call count
 *   5. the FOLD still runs                 — the guard that this file is
 *                                            testing an addition, not a
 *                                            behaviour change
 *
 * ⚠️ Case 5 is the one that would go missing. The ruling asked for an audible
 * warning, NOT for the normalizer to start refusing anything: the def must
 * still come out carrying `reference`, with the legacy key it arrived with
 * left in place. A warning that also dropped the key, or skipped the fold,
 * would pass 1-4 and be a regression.
 *
 * ⚠️ Case 5 used to read "the STAMP is unchanged" and assert that BOTH
 * snake_case keys came out of a legacy-only def. objectui#11070 round 4
 * retired the `reference_to` stamp (ObjectUI writes and reads `reference`
 * only), so the `referenceTo` pin below now asserts the fold to `reference`
 * and NO `reference_to`; the `reference_to` pin keeps its input key because
 * the pass never drops one.
 *
 * ## Warn-once GRANULARITY — the memo key, stated exactly, and pinned
 *
 * The card says "once-per-process". This implementation memoises per
 * **(object name, field name, legacy spelling, target value)**, and every
 * segment of that key is pinned below in both directions so the granularity is
 * a measured fact rather than a claim in a comment:
 *
 *   same object+field+spelling+value, twice   -> ONE warning
 *   same field+spelling, DIFFERENT value      -> TWO warnings
 *   same field+spelling+value, TWO OBJECTS    -> TWO warnings, each naming its object
 *   a def normalized with no object in scope  -> warns under a placeholder
 *
 * ⚠️ An earlier revision keyed on (field, spelling, value) with no object
 * segment and no object in the message. It was described in the PR and the
 * changeset as "per (field name, legacy spelling)" — which was wrong twice over:
 * it under-reported (the value was in the key, so one field with two stale
 * targets warned twice) AND it over-reported (the same field name on N objects
 * collided into ONE warning that could not say which object). Neither behaviour
 * was pinned, because the original pins held the value constant and used
 * distinct field names — so both were invisible. The object segment closes the
 * gap; these tests exist so the next revision cannot reopen it silently.
 *
 * ## ⛔ WHAT THIS WARNING DOES NOT COVER
 *
 * It fires only where `normalizeSchemaReferenceKeys` runs, which in production
 * is exactly the three ingestion choke points (objectui#7650 added the third,
 * `MetadataProvider.getItem`) — all of which also FOLD the def, so it fires
 * where nothing is broken. A hand-written schema served through any
 * other `DataSource` reaches a reader raw and warns nothing. The reader-side
 * diagnostic that would cover that is still open on objectui#6837.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  normalizeFieldReferenceKeys,
  normalizeSchemaReferenceKeys,
  resetReferenceKeyWarnings,
} from '../reference-keys';

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetReferenceKeyWarnings();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
  resetReferenceKeyWarnings();
});

const messages = (): string[] => warn.mock.calls.map((c: unknown[]) => String(c[0]));

describe('the choke point warns, in dev, when a def spells ONLY a legacy target key (objectui#6837)', () => {
  describe('the pin — a legacy-only def is audible', () => {
    it('warns on a `reference_to`-only def', () => {
      normalizeFieldReferenceKeys({ type: 'lookup', reference_to: 'crm_account' }, 'account');
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('warns on a `referenceTo`-only def', () => {
      normalizeFieldReferenceKeys({ type: 'lookup', referenceTo: 'crm_account' }, 'account');
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('names the FIELD, the offending key, and the ruling that asked for this', () => {
      // The message is the deliverable. A warning that fires but says nothing
      // actionable would satisfy a bare call-count assertion and help nobody.
      normalizeFieldReferenceKeys({ type: 'lookup', reference_to: 'crm_account' }, 'account');
      const m = messages()[0];
      expect(m).toContain('`account`');
      expect(m).toContain('reference_to');
      expect(m).toContain('reference');
      expect(m).toContain('objectui#6837');
    });

    it('falls back to the def\'s own `name` when the container gave no key', () => {
      // The array-shaped `fields` container carries the name on the def.
      normalizeSchemaReferenceKeys({
        fields: [{ name: 'owner_account', type: 'lookup', reference_to: 'crm_account' }],
      });
      expect(messages()[0]).toContain('`owner_account`');
    });

    it('takes the field name from the MAP key when the container is a map', () => {
      normalizeSchemaReferenceKeys({
        fields: { billing_account: { type: 'lookup', reference_to: 'crm_account' } },
      });
      expect(messages()[0]).toContain('`billing_account`');
    });
  });

  describe('negative controls — without these the pin above is satisfiable by a warning that always fires', () => {
    it('does NOT warn on a canonical `reference` def', () => {
      normalizeFieldReferenceKeys({ type: 'lookup', reference: 'crm_account' }, 'account');
      expect(warn).not.toHaveBeenCalled();
    });

    it('does NOT warn when a legacy key sits BESIDE `reference` — nothing was absorbed', () => {
      normalizeFieldReferenceKeys(
        { type: 'lookup', reference: 'crm_account', reference_to: 'crm_account' },
        'account',
      );
      expect(warn).not.toHaveBeenCalled();
    });

    it('does NOT warn on a non-relational field', () => {
      normalizeFieldReferenceKeys({ type: 'text' }, 'subject');
      expect(warn).not.toHaveBeenCalled();
    });

    it('does NOT warn on an empty legacy target — there is no target to lose', () => {
      normalizeFieldReferenceKeys({ type: 'lookup', reference_to: '' }, 'account');
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe('flood control — a console that scrolls is a console nobody reads', () => {
    it('does NOT fire twice for the same field and spelling', () => {
      normalizeFieldReferenceKeys({ type: 'lookup', reference_to: 'crm_account' }, 'account');
      normalizeFieldReferenceKeys({ type: 'lookup', reference_to: 'crm_account' }, 'account');
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('does NOT fire again when the SAME def is re-normalized (the adapter re-serves a cached schema)', () => {
      const def = { type: 'lookup', reference_to: 'crm_account' };
      normalizeFieldReferenceKeys(def, 'account');
      normalizeFieldReferenceKeys(def, 'account');
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('DOES name a second, different offender — three producer bugs are three fixes', () => {
      // Flip the memo to a single global flag and this goes red.
      normalizeSchemaReferenceKeys({
        name: 'crm_account',
        fields: {
          billing_account: { type: 'lookup', reference_to: 'crm_account' },
          owner: { type: 'lookup', referenceTo: 'sys_user' },
        },
      });
      expect(warn).toHaveBeenCalledTimes(2);
      expect(messages().join('\n')).toContain('`billing_account`');
      expect(messages().join('\n')).toContain('`owner`');
    });

    it('DOES fire twice for one field carrying two DIFFERENT stale targets — the value is in the key', () => {
      // Previously true but undisclosed and unpinned: the PR described the key
      // as (field, spelling), which would predict ONE warning here. It is two,
      // and it should be — two stale targets on one field name are two
      // producer sites. `column-identity.ts` keys on the value for the same
      // reason. Drop the value segment and this goes red.
      normalizeSchemaReferenceKeys({ name: 'crm_account', fields: { owner: { type: 'lookup', reference_to: 'a' } } });
      normalizeSchemaReferenceKeys({ name: 'crm_account', fields: { owner: { type: 'lookup', reference_to: 'b' } } });
      expect(warn).toHaveBeenCalledTimes(2);
    });

    it('DOES fire once PER OBJECT for the same field, spelling and value, naming each object', () => {
      // The gap the object segment closes. Before it, these two collided into
      // ONE warning that named the field and could not say which object — so a
      // tenant with `owner: { reference_to: 'sys_user' }` on forty objects got
      // one line and thirty-nine silences. Drop the object segment and this
      // goes red in BOTH assertions.
      normalizeSchemaReferenceKeys({ name: 'crm_account', fields: { owner: { type: 'lookup', reference_to: 'sys_user' } } });
      normalizeSchemaReferenceKeys({ name: 'crm_contact', fields: { owner: { type: 'lookup', reference_to: 'sys_user' } } });
      expect(warn).toHaveBeenCalledTimes(2);
      const all = messages().join('\n');
      expect(all).toContain('`crm_account`');
      expect(all).toContain('`crm_contact`');
    });

    it('still fires only ONCE when object, field, spelling and value all repeat', () => {
      // The control for the three cases above: without it, a memo that had
      // stopped de-duplicating at all would satisfy every "fires twice" case.
      const schema = { name: 'crm_account', fields: { owner: { type: 'lookup', reference_to: 'sys_user' } } };
      normalizeSchemaReferenceKeys(schema);
      normalizeSchemaReferenceKeys({ name: 'crm_account', fields: { owner: { type: 'lookup', reference_to: 'sys_user' } } });
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('names the object it was given, and a placeholder when there is none', () => {
      normalizeSchemaReferenceKeys({ name: 'crm_account', fields: { owner: { type: 'lookup', reference_to: 'sys_user' } } });
      expect(messages()[0]).toContain('Object `crm_account`');
      resetReferenceKeyWarnings();
      warn.mockClear();
      // A bare field-level call has no object in scope. It must still warn,
      // under a placeholder, rather than being merged into a real object's key.
      normalizeFieldReferenceKeys({ type: 'lookup', reference_to: 'sys_user' }, 'owner');
      expect(messages()[0]).toContain('(unknown object)');
    });
  });

  describe('⛔ the FOLD still runs — the warning is an addition, not a behaviour change', () => {
    it('folds a `reference_to`-only def onto `reference`, and keeps the key it arrived with', () => {
      const def: Record<string, unknown> = { type: 'lookup', reference_to: 'crm_account' };
      normalizeFieldReferenceKeys(def, 'account');
      expect(def.reference).toBe('crm_account');
      expect(def.reference_to).toBe('crm_account');
    });

    it('folds a `referenceTo`-only def onto `reference`, and stamps no `reference_to` (objectui#11070 round 4)', () => {
      const def: Record<string, unknown> = { type: 'lookup', referenceTo: 'crm_account' };
      normalizeFieldReferenceKeys(def, 'account');
      expect(def.reference).toBe('crm_account');
      expect('reference_to' in def).toBe(false);
    });

    it('is silent AND still folds under NODE_ENV=production', () => {
      // The warning is a dev affordance; the fold is the contract. A
      // production build must keep the second and lose only the first.
      vi.stubEnv('NODE_ENV', 'production');
      try {
        const def: Record<string, unknown> = { type: 'lookup', reference_to: 'crm_account' };
        normalizeFieldReferenceKeys(def, 'account');
        expect(warn).not.toHaveBeenCalled();
        expect(def.reference).toBe('crm_account');
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });
});
