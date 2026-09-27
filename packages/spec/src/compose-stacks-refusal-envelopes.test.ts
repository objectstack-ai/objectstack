// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Every authored-entity refusal `composeStacks` raises carries an ADR-0112
 * envelope (#16348).
 *
 * ## What was wrong
 *
 * `defineStack`'s seven refusal sites got `code` / `status` in #15963. Its
 * sibling in the same file did not: `composeStacks` refused six authored-entity
 * conflicts with `new Error(message)`, both fields `undefined`. Two refusal
 * families that are the same thing to an author — a stack refused at authoring
 * time — and two different things to a consumer branching on `error.code`.
 *
 * Five of the six raise inside HELPER functions 300-800 lines above
 * `composeStacks`' own body, which is why the family is located by its
 * `composeStacks conflict:` MESSAGE PREFIX and not by reading the function the
 * card names.
 *
 * ## What is pinned
 *
 * Per site: the ENVELOPE (`code`, `status: 422`); the message prefix
 * byte-for-byte, through the finding the site now also carries structurally;
 * `issues`, one entry per finding; and the CONTROL — the same composition with
 * the one offending detail removed is ACCEPTED, so a refusal cannot satisfy the
 * assertions for the wrong reason.
 *
 * The full message TEXT of these six is pinned, unchanged, by the suites that
 * already read it: `compose-stacks-merge-collection-refusal.test.ts` and
 * `compose-stacks-action-key-collision.test.ts` assert whole messages with
 * `toBe`, `compose-stacks-i18n-merge.test.ts` and
 * `compose-key-dispositions-export.pin.test.ts` assert the prose of the
 * single-value refusal. This change adds fields; it rewords no sentence, and
 * those suites are what proves it.
 *
 * Then a census over the whole file: six distinct `STACK_COMPOSE_*` codes, every
 * `status` 422, no `name` spelled `ValidationError` (which
 * `validationFailureDetails` in `@objectstack/types` duck-types as a RECORD
 * validation failure and answers `400 VALIDATION_FAILED` + `fields[]` for),
 * every code a member of the closed `ErrorCode` union — and the A/B SPLIT
 * itself: exactly ONE bare `Error` is left in `stack.zod.ts`, the internal
 * bookkeeping invariant, which stays bare deliberately. A seventh authored-entity
 * refusal added bare would fail that census.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { composeStacks, defineStack, type ObjectStackDefinition } from './stack.zod';
import { ERROR_CODE_LEDGER, ErrorCode } from './api/error-code-ledger.zod';

/** The error shape every assertion below reads — the ADR-0112 envelope. */
type Envelope = Error & { code?: string; status?: number; issues?: readonly unknown[] };

/** The thrown value, or `null` when the composition is accepted. */
function refusal(fn: () => unknown): Envelope | null {
  try {
    fn();
    return null;
  } catch (e) {
    return e as Envelope;
  }
}

const mf = (id: string) => ({ id, name: id.split('.').pop()!, version: '1.0.0', type: 'app' as const });

const act = (name: string, extra: Record<string, unknown> = {}) =>
  ({ name, label: name, type: 'script' as const, target: 'noop', ...extra });

// `as const` on the field type is load-bearing (see stack.test.ts): hoisted
// without it the literal widens to `string`, which the input type refuses.
const obj = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  label: name,
  fields: { title: { type: 'text' as const } },
  ...extra,
});

/** A stack object that is NOT schema-validated — lets a case declare a partial key. */
function raw(overrides: Record<string, unknown>): ObjectStackDefinition {
  return defineStack(overrides as never, { strict: false });
}

const A0 = "'com.example.a' (stack #0)";
const B1 = "'com.example.b' (stack #1)";

/** The prefix the whole family carries, and the string this card located it by. */
const PREFIX = 'composeStacks conflict: ';

/**
 * One row per refusal site. `refused` and `accepted` differ by the one detail
 * the site checks; `finding` is the ENTIRE entry the refusal must carry in
 * `issues`, and also the text that must follow the prefix in the message.
 */
const rows: Array<{
  site: string;
  code: string;
  finding: string;
  refused: () => unknown;
  accepted: () => unknown;
}> = [
  {
    site: 'single-valued top-level key — two stacks declare it differently (composeSingleValue)',
    code: 'STACK_COMPOSE_KEY_CONFLICT',
    finding: `top-level key 'i18n' is declared with different values by ${A0} and ${B1}.`,
    // `raw`: a partial `i18n` is the subject, not the shape — the sibling
    // i18n suite reaches for the same escape for the same reason.
    refused: () =>
      composeStacks([
        raw({ manifest: mf('com.example.a'), i18n: { defaultLocale: 'en' } }),
        raw({ manifest: mf('com.example.b'), i18n: { defaultLocale: 'zh-CN' } }),
      ]),
    accepted: () =>
      composeStacks([
        raw({ manifest: mf('com.example.a'), i18n: { defaultLocale: 'en' } }),
        raw({ manifest: mf('com.example.b'), i18n: { defaultLocale: 'en' } }),
      ]),
  },
  {
    site: "functions shape — the map form in one stack, the array form in another (composeFunctions)",
    code: 'STACK_COMPOSE_FUNCTIONS_SHAPE_CONFLICT',
    finding: `top-level key 'functions' is declared in the map form by ${A0} and in the array form by ${B1}.`,
    refused: () =>
      composeStacks([
        raw({ manifest: mf('com.example.a'), functions: { refresh: () => 1 } }),
        raw({ manifest: mf('com.example.b'), functions: [{ name: 'export' }] }),
      ]),
    accepted: () =>
      composeStacks([
        raw({ manifest: mf('com.example.a'), functions: { refresh: () => 1 } }),
        raw({ manifest: mf('com.example.b'), functions: { export: () => 2 } }),
      ]),
  },
  {
    site: 'function name — two stacks define one handler name (composeFunctions)',
    code: 'STACK_COMPOSE_FUNCTION_CONFLICT',
    finding: `function 'refresh' is defined by both ${A0} and ${B1}.`,
    refused: () =>
      composeStacks([
        raw({ manifest: mf('com.example.a'), functions: { refresh: () => 1 } }),
        raw({ manifest: mf('com.example.b'), functions: { refresh: () => 2 } }),
      ]),
    accepted: () =>
      composeStacks([
        raw({ manifest: mf('com.example.a'), functions: { refresh: () => 1 } }),
        raw({ manifest: mf('com.example.b'), functions: { export: () => 2 } }),
      ]),
  },
  {
    site: "object collection under objectConflict: 'merge' (refuseUnmergeableCollections)",
    code: 'STACK_COMPOSE_COLLECTION_CONFLICT',
    finding:
      `object 'shared' is defined in multiple stacks and its 'actions' ` +
      `is declared with different values by ${A0} and ${B1}.`,
    refused: () =>
      composeStacks(
        [
          defineStack({ manifest: mf('com.example.a'), objects: [obj('shared', { actions: [act('approve')] })] }),
          defineStack({ manifest: mf('com.example.b'), objects: [obj('shared', { actions: [act('archive')] })] }),
        ],
        { objectConflict: 'merge' },
      ),
    accepted: () =>
      composeStacks(
        [
          defineStack({ manifest: mf('com.example.a'), objects: [obj('shared', { actions: [act('approve')] })] }),
          defineStack({ manifest: mf('com.example.b'), objects: [obj('shared')] }),
        ],
        { objectConflict: 'merge' },
      ),
  },
  {
    site: "object name under the default objectConflict: 'error' (mergeObjects)",
    code: 'STACK_COMPOSE_OBJECT_CONFLICT',
    finding: "object 'shared' is defined in multiple stacks.",
    refused: () =>
      composeStacks([
        defineStack({ manifest: mf('com.example.a'), objects: [obj('shared')] }),
        defineStack({ manifest: mf('com.example.b'), objects: [obj('shared')] }),
      ]),
    accepted: () =>
      composeStacks([
        defineStack({ manifest: mf('com.example.a'), objects: [obj('a_item')] }),
        defineStack({ manifest: mf('com.example.b'), objects: [obj('b_item')] }),
      ]),
  },
  {
    site: 'cross-stack action key collision (collectComposedActionKeyCollisions)',
    code: 'STACK_COMPOSE_ACTION_KEY_COLLISION',
    finding:
      "Action key 'global:shared_refresh' is declared by 2 stacks: " +
      `${A0} at stack.actions[0] and ${B1} at stack.actions[0].`,
    refused: () =>
      composeStacks([
        defineStack({ manifest: mf('com.example.a'), objects: [obj('a_item')], actions: [act('shared_refresh')] }),
        defineStack({ manifest: mf('com.example.b'), objects: [obj('b_item')], actions: [act('shared_refresh')] }),
      ]),
    accepted: () =>
      composeStacks([
        defineStack({ manifest: mf('com.example.a'), objects: [obj('a_item')], actions: [act('a_refresh')] }),
        defineStack({ manifest: mf('com.example.b'), objects: [obj('b_item')], actions: [act('b_refresh')] }),
      ]),
  },
];

describe('#16348 — every composeStacks conflict refusal carries an ADR-0112 envelope', () => {
  for (const row of rows) {
    describe(row.site, () => {
      it(`refuses with code ${row.code} and status 422`, () => {
        const refused = refusal(row.refused);
        expect(refused).toBeInstanceOf(Error);
        expect(refused?.code).toBe(row.code);
        expect(refused?.status).toBe(422);
      });

      it('carries the finding in `issues`, one entry per finding', () => {
        const refused = refusal(row.refused);
        expect(refused?.issues).toEqual([row.finding]);
      });

      it('keeps the message byte-for-byte — the family prefix, then the finding', () => {
        const message = refusal(row.refused)?.message ?? '';
        // The action-key collision renders its findings as `✗` lines under a
        // counted header; the other five open with the finding itself.
        const opening =
          row.code === 'STACK_COMPOSE_ACTION_KEY_COLLISION'
            ? `${PREFIX}cross-stack action key collision (1 issue):`
            : `${PREFIX}${row.finding}`;
        expect(message.startsWith(opening)).toBe(true);
        expect(message).toContain(row.finding);
      });

      it('the same composition without the one offending detail is ACCEPTED — the control', () => {
        expect(refusal(row.accepted)).toBeNull();
      });
    });
  }

  describe('census over all six composition refusal sites', () => {
    it('six sites, six distinct STACK_COMPOSE_* codes, every status 422', () => {
      const envelopes = rows.map((row) => refusal(row.refused));
      for (const envelope of envelopes) {
        expect(envelope).toBeInstanceOf(Error);
        expect(envelope?.code).toMatch(/^STACK_COMPOSE_[A-Z_]+$/);
        expect(envelope?.status).toBe(422);
      }
      expect(new Set(envelopes.map((e) => e?.code)).size).toBe(6);
    });

    it('no site is named `ValidationError` — the record-validation duck-type in @objectstack/types', () => {
      for (const row of rows) {
        expect(refusal(row.refused)?.name).not.toBe('ValidationError');
      }
    });

    it('every code is a member of the closed `ErrorCode` union, registered under @objectstack/spec', () => {
      // The #16404 ruling: a code that ships in `dist` is the published face,
      // door or no door — so each refusal's spelling is a ledger row, and a
      // consumer's `switch (e.code)` is exhaustive over the union it ships with.
      for (const row of rows) {
        const code = refusal(row.refused)?.code;
        expect(ErrorCode.safeParse(code).success, `${code} parses against ErrorCode`).toBe(true);
        expect(ERROR_CODE_LEDGER['@objectstack/spec']).toContain(code);
      }
    });

    it('every message still carries the `composeStacks conflict:` prefix the family is located by', () => {
      for (const row of rows) {
        expect(refusal(row.refused)?.message.startsWith(PREFIX)).toBe(true);
      }
    });
  });

  describe('the A/B split — the internal invariant stays a bare Error', () => {
    // A source census, because the class B site is unreachable from the public
    // API by construction: it fires only when `mergeObjects` records an object
    // and `collectComposedActionKeyCollisions` then fails to find it, which is
    // an edit to this file rather than an authored input. What can regress is
    // a SEVENTH authored-entity refusal arriving bare — this is what catches it.
    const source = readFileSync(fileURLToPath(new URL('./stack.zod.ts', import.meta.url)), 'utf8');

    it('exactly one bare `throw new Error(` is left in stack.zod.ts', () => {
      const bare = source.split('\n').filter((line) => line.includes('throw new Error('));
      expect(bare).toHaveLength(1);
      expect(bare[0]).toContain('composeStacks internal error: no source stack recorded');
    });

    it('it is an internal-invariant message, NOT an authored-entity refusal', () => {
      // `composeStacks conflict:` is the authored-entity family; the internal
      // invariant deliberately carries a different prefix and no envelope,
      // because a 422 would tell an author their stack is unprocessable when
      // the defect is ours.
      const bare = source.split('\n').filter((line) => line.includes('throw new Error('))[0] ?? '';
      expect(bare).not.toContain(PREFIX);
    });
  });
});
