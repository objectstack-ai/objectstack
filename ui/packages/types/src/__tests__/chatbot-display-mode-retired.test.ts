/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ChatbotSchema.displayMode` — and its copy on `ChatbotFloatingSchema` — is
 * an ADR-0049 RETIREMENT TOMBSTONE (objectui#7654, maintainer ruling B,
 * 2026-09-05), and its refusal is TYPE-LEVEL ONLY. Both halves are pinned here.
 *
 * ## What was measured
 *
 * `displayMode?: 'inline' | 'floating'` was declared on both chatbot faces,
 * offered as a "Display Mode" control in the `chatbot-floating` registration's
 * `inputs`, seeded as `'floating'` by that registration's `defaultProps` — and
 * read by nothing. `chatbot-floating` renders `<FloatingChatbot>`
 * unconditionally and `chatbot` never looked at the key: the node `type` is
 * the one selector of presentation, and this key was a second spelling of it.
 * Whole-repo `git grep` census, tracked files, build output excluded: the
 * declarations, the doc comments and ledger entries beside them, one historical
 * CHANGELOG line and two unrelated `displayMode` props on `GridField` /
 * `MasterDetailForm`; the same pass over `floatingConfig`, a key that IS read,
 * returned 79 lines, so the instrument was not blind. The control and the seed
 * are gone in the same change; the restatement of that control is the
 * tombstone plus the release note (objectui#7070).
 *
 * ## Why a tombstone, and what it buys on THIS carrier
 *
 * `ChatbotSchema` extends `BaseSchema`, which carried `[key: string]: any`
 * when this was written. On such a carrier deleting an optional member was
 * SILENT in every value shape — the index signature defeated both
 * excess-property checking and the weak-type check — so the usual "a fresh
 * literal would at least trip TS2353" comfort did not exist. Measured on this
 * member then with
 * `tsc -p tsconfig.test.json`, `FloatingChatbotConfig` (no index signature)
 * lit as the control carrier in the same run:
 *
 *   | route      | fresh `'floating'` | fresh `'bogus'` | widened `'floating'` | undeclared key |
 *   |------------|--------------------|-----------------|----------------------|----------------|
 *   | declared   | clean              | TS2322          | clean                | clean          |
 *   | DELETED    | clean              | **clean**       | clean                | clean          |
 *   | TOMBSTONED | TS2322             | TS2322          | TS2322               | clean          |
 *   | control    | —                  | —               | —                    | TS2353 / TS2559|
 *
 * Deleted, the member read as `any` and even a wrong-typed value went quiet.
 * objectui#8347 removed the signature, so a deletion now trips TS2353 on a
 * fresh literal, unnamed, and still rides a widened value clean. Tombstoned,
 * PRESENCE with any value is a compile error in every shape, by name. The
 * routes were loud-vs-silent, and through a widened value they still are, which is the discriminator's carrier branch as corrected
 * on objectui#7678. Prong 2 licenses the tombstone: the key was advertised in
 * the 3.3.0 release record (`CHANGELOG.md:578`) and its comment taught it as
 * the presentation switch.
 *
 * The `@ts-expect-error` directives are REAL enforcement: this package
 * type-checks its tests through `tsconfig.test.json`, so re-widening the
 * declaration fails the build on the unused directive. A green `vitest` run is
 * NOT evidence about them — type assertions are erased before it runs. The
 * "deleted" row is pinned LIVE below, as an undeclared key (refused on the
 * fresh literal, carried by the widened value), so the contrast cannot rot
 * into prose.
 */

import { describe, it, expect } from 'vitest';
import type {
  ChatMessage,
  ChatbotFloatingSchema as TsChatbotFloatingSchema,
  ChatbotSchema as TsChatbotSchema,
  FloatingChatbotConfig,
} from '../complex';
import { ChatbotFloatingSchema, ChatbotSchema } from '../zod/complex.zod';

/* ── type-level pins: the `tsc` channel ──────────────────────────────────── */

/** Invariant equality — `extends` both ways would accept a narrowing. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

/**
 * What the member READS as under the tombstone: `undefined`, not `never` —
 * `?: never` without `exactOptionalPropertyTypes` is `never | undefined`,
 * which collapses. `Equal` still tells that apart from the `any` a deletion
 * leaves behind (measured: deleted, `Equal<…, any>` is the row that goes
 * green), so this pin reddens on a deletion as well as on a re-widening.
 */
export type assertionDisplayModeReadsAsTombstone = [
  Expect<Equal<TsChatbotSchema['displayMode'], undefined>>,
  Expect<Equal<TsChatbotFloatingSchema['displayMode'], undefined>>,
];

const messages: ChatMessage[] = [{ id: 'm1', role: 'user', content: 'hi' }];

describe('the `displayMode` tombstone makes authoring a `tsc` error on both faces', () => {
  it('refuses the value that used to be VALID, in a fresh literal — presence is the error, not the value', () => {
    const onChatbot: TsChatbotSchema = {
      type: 'chatbot',
      messages,
      // @ts-expect-error `displayMode` is a retirement tombstone (objectui#7654) — select the presentation with `type`
      displayMode: 'floating',
    };
    const onFloating: TsChatbotFloatingSchema = {
      type: 'chatbot-floating',
      messages,
      // @ts-expect-error `displayMode` is a retirement tombstone (objectui#7654) — a `chatbot-floating` node IS the floating presentation
      displayMode: 'floating',
    };
    expect(onChatbot.type).toBe('chatbot');
    expect(onFloating.type).toBe('chatbot-floating');
  });

  it('refuses a wrong-typed value too — the row that went SILENT under deletion', () => {
    const onChatbot: TsChatbotSchema = {
      type: 'chatbot',
      messages,
      // @ts-expect-error `displayMode` is a retirement tombstone (objectui#7654)
      displayMode: 'bogus',
    };
    expect(onChatbot.type).toBe('chatbot');
  });

  it('refuses it through a WIDENED value — the shape no excess-property check ever reaches', () => {
    const rawChatbot = { type: 'chatbot' as const, messages, displayMode: 'floating' as const };
    // @ts-expect-error `displayMode` is a retirement tombstone (objectui#7654), reached through a widened value
    const onChatbot: TsChatbotSchema = rawChatbot;
    const rawFloating = { type: 'chatbot-floating' as const, messages, displayMode: 'floating' as const };
    // @ts-expect-error `displayMode` is a retirement tombstone (objectui#7654), reached through a widened value
    const onFloating: TsChatbotFloatingSchema = rawFloating;
    expect(onChatbot.type).toBe('chatbot');
    expect(onFloating.type).toBe('chatbot-floating');
  });

  it('keeps the LIVE keys writable — the non-vacuity control', () => {
    // Without this, a change that broke either face would satisfy every
    // assertion above by accident. `floatingConfig` is the key the floating
    // registration actually reads; `processVisibility` is a typed union
    // `ChatbotSchema` still declares.
    const onFloating: TsChatbotFloatingSchema = {
      type: 'chatbot-floating',
      messages,
      floatingConfig: { position: 'bottom-left', defaultOpen: true, title: 'Chat' },
    };
    const onChatbot: TsChatbotSchema = {
      type: 'chatbot',
      messages,
      processVisibility: 'debug',
    };
    expect(onFloating.floatingConfig?.title).toBe('Chat');
    expect(onChatbot.processVisibility).toBe('debug');
  });

  it('an UNDECLARED key is refused on a fresh literal and still rides a widened value — the DELETED row, live', () => {
    // This is where `displayMode` would sit had it been deleted instead of
    // tombstoned. Until objectui#8347 `BaseSchema`'s `[key: string]: any`
    // absorbed the key at any value in every shape, so a deletion produced no
    // diagnostic at all. The signature is gone: a fresh literal is refused,
    // with no name for the remedy, while a widened value is still not
    // re-checked (no excess-property check on a non-fresh object).
    // @ts-expect-error — `ChatbotSchema` declares no `bogusUndeclared` (objectui#8347)
    const fresh: TsChatbotSchema = { type: 'chatbot', messages, bogusUndeclared: 1 };
    const raw = { type: 'chatbot' as const, messages, bogusUndeclared: 1 };
    const widened: TsChatbotSchema = raw;
    expect(fresh.type).toBe('chatbot');
    expect(widened.type).toBe('chatbot');
  });

  it('…and the same undeclared key IS refused on a carrier without an index signature — the instrument control', () => {
    // `FloatingChatbotConfig` has no index signature, so the compiler's two
    // ordinary guards are visible here: excess-property checking on a fresh
    // literal (TS2353) and the weak-type check on a lone-key widened value
    // (TS2559). Their firing proves the silence above is the index signature,
    // not a blind run.
    const fresh: FloatingChatbotConfig = {
      title: 'Chat',
      // @ts-expect-error TS2353 — `FloatingChatbotConfig` has no index signature, so a fresh undeclared key is refused
      bogusUndeclared: 1,
    };
    const loneKey = { bogusUndeclared: 1 };
    // @ts-expect-error TS2559 — the weak-type check fires on a lone-key widened value without an index signature
    const widened: FloatingChatbotConfig = loneKey;
    expect(fresh.title).toBe('Chat');
    expect(widened).toBeDefined();
  });
});

/* ── the runtime channel: DELIBERATELY unchanged, and a tripwire if that ends ─ */

// Both faces declared `displayMode` and NEITHER twin has an arm for it, so the
// tripwire parses both nodes, each through its own twin.
describe.each([
  ['chatbot', ChatbotSchema],
  ['chatbot-floating', ChatbotFloatingSchema],
] as const)('there is NO zod refusal of `displayMode` on a `%s` node, and that is deliberate (objectui#7654)', (type, twin) => {
  const node = { type, messages };

  it(`a ${type} node carrying \`displayMode: 'floating'\` — what every designer-created node carried — still parses GREEN`, () => {
    // Runtime validation of this key is ZERO before and after the retirement:
    // `displayMode` sits in the `UnmirroredDeclared` ledger for both twins
    // (`zod-mirror-parity.test.ts`) and `BaseSchema` is `.passthrough()`, so a
    // stored document the designer wrote parses exactly as it did before the
    // ruling and the value is dropped at render time, as it always was.
    expect(twin.safeParse({ ...node, displayMode: 'floating' }).success).toBe(true);
    expect(twin.safeParse({ ...node, displayMode: 'anything-at-all' }).success).toBe(true);
  });

  it('the twin really has no `displayMode` arm — the SHAPE pin, one of the TWO assertions a minted arm reddens', () => {
    // ⚠️ TRIPWIRE: if objectui#6152 ever mints an arm for `displayMode`, this
    // assertion goes red — and so does the parse-green line above. That was
    // MEASURED on this pair, not transposed from another one. Minting the arm a
    // scalar union takes on `ChatbotSchema`'s twin — an optional `z.enum` over
    // `'inline' | 'floating'` — reddened BOTH instruments in the same tree:
    // `tsc -p packages/types/tsconfig.test.json` with exactly one error, at
    // `zod-mirror-parity.test.ts(1586,14)`, and `vitest` with exactly two
    // failures — this shape pin AND the parse-green line, which asserts that
    // `'anything-at-all'` parses, and an enum arm refuses it. So it does NOT
    // take a `.strict()` mirror to redden the parse line here: the tripwire
    // fires harder than "shape pin only". (The strict-vs-non-strict split is
    // real for OBJECT-mirror shapes, which is what objectui#7678 item 2
    // measured; `displayMode` is a scalar union and that reading does not
    // transpose onto it.) Red is the intended signal, not a nuisance: whoever
    // lands the mirror adds the `retirementTombstone()` half for `displayMode`
    // at the same time, and flips this control rather than deleting it into a
    // vacuum.
    const shape = (twin as unknown as { shape: Record<string, unknown> }).shape;
    expect(shape.displayMode).toBeUndefined();
    // Lit control: a key the twin DOES declare is in its shape, so the reading
    // above is a measurement and not an empty object.
    expect(shape.messages).toBeDefined();
  });

  it('a live key on the same twin is validated — the non-vacuity control for `.passthrough()`', () => {
    // `messages` is an arm on both twins: a wrong value is refused, so the
    // green readings above are the absence of an arm, not a twin that accepts
    // everything.
    expect(twin.safeParse({ ...node, messages: 'not-an-array' }).success).toBe(false);
  });
});
