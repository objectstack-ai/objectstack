/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `FloatingChatbotConfig.triggerIcon` is an ADR-0049 RETIREMENT TOMBSTONE
 * (objectui#7654), and — unlike every other tombstone in this package — its
 * refusal is TYPE-LEVEL ONLY. Both halves of that sentence are pinned here.
 *
 * ## What was measured
 *
 * `triggerIcon` was declared `?: string` with `@default 'MessageCircle'` and
 * read by nothing. `FloatingChatbot` destructures six of the interface's seven
 * keys (`position`, `defaultOpen`, `panelWidth`, `panelHeight`, `title`,
 * `triggerSize`) and never this one, and `FloatingChatbotTrigger` takes no icon
 * prop, so the advertised default never rendered. A whole-repo `git grep`
 * census over tracked files, build output excluded, returned the declaration
 * and one historical CHANGELOG line and nothing else; the same pass over
 * `triggerSize` returned ten sites across four files, so the instrument was not
 * blind. It is absent from the `chatbot-floating` registration's `inputs` and
 * from its `defaultProps`, so no designer control offered it and no
 * designer-created node carries it — TypeScript was the only way to reach it.
 *
 * ## Why a tombstone, when the usual reason does not apply
 *
 * The other tombstones here argue from the mirror: an undeclared key is
 * silently STRIPPED by a non-strict `z.object`, so deletion trades one silent
 * no-op for another. That argument needs a mirror, and this key has none (see
 * the runtime section below). The tombstone earns its place on the `tsc`
 * channel alone, measured both ways on the retiring PR's merge-base:
 *
 *   | route      | fresh object literal          | widened (non-fresh) value |
 *   |------------|-------------------------------|---------------------------|
 *   | deleted    | TS2353 excess-property error  | **compiles CLEAN**        |
 *   | tombstoned | TS2322                        | TS2322                    |
 *
 * Excess-property checking only reaches a FRESH literal, so deleting the key
 * would have left the widened path silently accepting it. The declared `never`
 * makes the assignment itself ill-typed, so freshness stops mattering. That
 * contrast is not prose here — it is pinned live: the `bogusUndeclared` control
 * below IS the "deleted" row, carrying no directive because a key this
 * interface does not declare really does ride the widened path unchallenged.
 *
 * The `@ts-expect-error` directives are REAL enforcement: this package
 * type-checks its tests through `tsconfig.test.json`, so re-widening the
 * declaration fails the build on the unused directive. A green `vitest` run is
 * NOT evidence about them — type assertions are erased before it runs.
 *
 * ⚠️ AMENDED by objectui#6152 round 4: "type-level only" now holds on a `chatbot`
 * node alone. That round minted the `FloatingChatbotConfig` mirror on the
 * `chatbot-floating` twin — the registration that reads `floatingConfig` — with
 * the `retirementTombstone()` half this file's tripwire asked for, so a
 * `chatbot-floating` node refuses `triggerIcon` at runtime as well. The runtime
 * section below pins the two twins apart.
 *
 * ⚠️ AMENDED again by objectui#6152 round 5, which RETIRED
 * `ChatbotSchema.floatingConfig` on both faces (zero reads on a `chatbot` node).
 * The `chatbot` half of this file was the TRIPWIRE for that member's absence from
 * the mirror; it is flipped, not deleted: a `chatbot` node now refuses the WHOLE
 * `floatingConfig` key, a live config included, at compile time and at parse
 * time. "Type-level only" therefore holds on no node any more — the one face that
 * still declares `FloatingChatbotConfig` is `chatbot-floating`, where both halves
 * of the `triggerIcon` refusal hold.
 */

import { describe, it, expect } from 'vitest';
import type {
  ChatbotFloatingSchema as TsChatbotFloatingSchema,
  ChatbotSchema as TsChatbotSchema,
  FloatingChatbotConfig,
} from '../complex';
import { ChatbotFloatingSchema, ChatbotSchema } from '../zod/complex.zod';

/* ── type-level pins: the `tsc` channel ──────────────────────────────────── */

describe('the `triggerIcon` tombstone makes authoring a `tsc` error', () => {
  it('refuses it in a FRESH object literal', () => {
    const config: FloatingChatbotConfig = {
      title: 'Chat',
      // @ts-expect-error `triggerIcon` is a retirement tombstone (objectui#7654)
      triggerIcon: 'Sparkles',
    };
    expect(config.title).toBe('Chat');
  });

  it('refuses it through a WIDENED value too — the half a deletion would have missed', () => {
    const raw = { title: 'Chat', triggerIcon: 'Sparkles' };
    // @ts-expect-error `triggerIcon` is a retirement tombstone (objectui#7654)
    const config: FloatingChatbotConfig = raw;
    expect(config.title).toBe('Chat');
  });

  it('keeps the six LIVE keys writable — the non-vacuity control', () => {
    // Without this, a change that broke the whole interface would satisfy both
    // assertions above by accident. These six are the keys `FloatingChatbot`
    // actually destructures.
    const config: FloatingChatbotConfig = {
      position: 'bottom-right',
      defaultOpen: false,
      panelWidth: 400,
      panelHeight: 520,
      title: 'Chat',
      triggerSize: 56,
    };
    expect(config.triggerSize).toBe(56);
  });

  it('reaches a `chatbot-floating` node through its face; on a `chatbot` node the WHOLE `floatingConfig` key is refused since objectui#6152 round 5', () => {
    // The pins above sit on `FloatingChatbotConfig` directly, so a face that LOST
    // the member would not turn them red — while `BaseSchema` carried its index
    // signature the member read as `any` and the literal compiled clean (since
    // objectui#8347 the literal is refused as undeclared instead). That is
    // what #7655's contract review measured on its first cut, which DELETED the key
    // off `ChatbotSchema`; pinned on the nodes since.
    const onFloating: TsChatbotFloatingSchema = {
      type: 'chatbot-floating',
      messages: [],
      // @ts-expect-error `triggerIcon` is a retirement tombstone (objectui#7654), reached through `ChatbotFloatingSchema.floatingConfig`
      floatingConfig: { title: 'Chat', triggerIcon: 'Sparkles' },
    };
    // Lit control: a LIVE config type-checks on the floating face, so the
    // directive above is about `triggerIcon` and not about the key.
    const liveOnFloating: TsChatbotFloatingSchema = {
      type: 'chatbot-floating',
      messages: [],
      floatingConfig: { title: 'Chat', triggerSize: 56 },
    };
    // The flipped tripwire, TS half: `ChatbotSchema.floatingConfig` is a `?: never`
    // tombstone (objectui#6152 round 5), so even the LIVE config the line above
    // accepts is refused on a `chatbot` node — the tombstone was not deleted into
    // the index signature, where this literal would compile clean.
    const onChatbot: TsChatbotSchema = {
      type: 'chatbot',
      messages: [],
      // @ts-expect-error `floatingConfig` is RETIRED on `chatbot` (objectui#6152 round 5) — author `type: 'chatbot-floating'`
      floatingConfig: { title: 'Chat', triggerSize: 56 },
    };
    expect(onChatbot.type).toBe('chatbot');
    expect(onFloating.type).toBe('chatbot-floating');
    expect(liveOnFloating.floatingConfig?.triggerSize).toBe(56);
  });

  it('a key the interface never declared still rides the widened path — the DELETED row', () => {
    // This carries NO directive on purpose. It is the measured contrast that
    // justifies `?: never` over deletion: an undeclared key IS refused in a
    // fresh literal but is NOT refused here. Had `triggerIcon` been deleted
    // rather than tombstoned, it would sit exactly where this line sits.
    const raw = { title: 'Chat', bogusUndeclared: 1 };
    const config: FloatingChatbotConfig = raw;
    expect(config.title).toBe('Chat');
  });
});

/* ── the runtime channel: refused on BOTH nodes — `triggerIcon` on `chatbot-floating`, the whole key on `chatbot` ─ */

// Both faces declared `floatingConfig` — `ChatbotSchema` always had, and
// objectui#7655 declared it on `ChatbotFloatingSchema`, the face of the one
// registration that reads it. Until objectui#6152 round 4 NEITHER twin had an arm
// for it, and this file's runtime half pinned that on both, as a TRIPWIRE: whoever
// minted a `FloatingChatbotConfig` mirror had to add the `retirementTombstone()`
// half for `triggerIcon` in the same change, and flip these controls rather than
// delete them into a vacuum. Round 4 minted it on the `chatbot-floating` twin only
// (that registration reads the key; `chatbot`'s never does), and round 5 RETIRED
// the key on the `chatbot` twin. Both flips are below; neither twin's control was
// deleted.
describe('a `chatbot` node REFUSES the whole `floatingConfig` key at runtime (objectui#6152 round 5 retired it there)', () => {
  const node = {
    type: 'chatbot',
    messages: [{ id: 'm1', role: 'user' as const, content: 'hi' }],
  };

  it('a chatbot node carrying `floatingConfig.triggerIcon` is refused at `floatingConfig` itself', () => {
    // The flipped tripwire: this line asserted `success: true` until round 5,
    // when `ChatbotSchema.floatingConfig` rode through `.passthrough()` unvalidated.
    const result = ChatbotSchema.safeParse({
      ...node,
      floatingConfig: { title: 'Chat', triggerIcon: 'Sparkles' },
    });
    expect(result.success).toBe(false);
    const issues = (result.error?.issues ?? []).map((i) => [i.path.join('.'), i.code]);
    expect(issues, JSON.stringify(result.error?.issues)).toEqual([['floatingConfig', 'invalid_type']]);
  });

  it('a LIVE `floatingConfig` is refused too — the tombstone refuses the key, not a member — and the refusal names the node that reads it', () => {
    // The flipped non-vacuity control: until round 5 this parsed green.
    const result = ChatbotSchema.safeParse({
      ...node,
      floatingConfig: { title: 'Chat', triggerSize: 56 },
    });
    expect(result.success).toBe(false);
    const issues = (result.error?.issues ?? []).filter((i) => i.path.join('.') === 'floatingConfig');
    expect(issues.length, JSON.stringify(result.error?.issues)).toBe(1);
    expect(issues[0].message).toContain('chatbot-floating');
  });

  it('a chatbot node WITHOUT `floatingConfig` still parses green — the control', () => {
    expect(ChatbotSchema.safeParse(node).success).toBe(true);
  });

  it('the mirror declares `floatingConfig` as a MEMBER tombstone, not an undeclared key', () => {
    // The load-bearing fact behind the refusals above, asserted rather than
    // assumed. Until round 5 this read `undefined`: the TRIPWIRE fired here.
    const shape = (ChatbotSchema as unknown as { shape: Record<string, unknown> }).shape;
    expect(shape.floatingConfig).toBeDefined();
    // Lit control: a key the mirror declares as a live arm sits beside it.
    expect(shape.messages).toBeDefined();
  });
});

describe('a `chatbot-floating` node REFUSES `floatingConfig.triggerIcon` at runtime (objectui#6152 round 4 minted the mirror)', () => {
  const node = {
    type: 'chatbot-floating',
    messages: [{ id: 'm1', role: 'user' as const, content: 'hi' }],
  };

  it('`floatingConfig.triggerIcon` is refused at its own path, and the refusal says the key was never read', () => {
    // The flipped tripwire: this line used to assert `success: true`.
    const result = ChatbotFloatingSchema.safeParse({
      ...node,
      floatingConfig: { title: 'Chat', triggerIcon: 'Sparkles' },
    });
    expect(result.success).toBe(false);
    const issues = (result.error?.issues ?? []).filter((i) => i.path.join('.') === 'floatingConfig.triggerIcon');
    expect(issues.length, JSON.stringify(result.error?.issues)).toBe(1);
    expect(issues[0].code).toBe('invalid_type');
    expect(issues[0].message).toContain('objectui#7654');
  });

  it('a live `floatingConfig` parses green — the non-vacuity control', () => {
    const result = ChatbotFloatingSchema.safeParse({
      ...node,
      floatingConfig: { title: 'Chat', triggerSize: 56 },
    });
    expect(result.success).toBe(true);
  });

  it('the mirror declares `floatingConfig`, and its `triggerIcon` is a MEMBER tombstone, not an undeclared key', () => {
    const shape = (ChatbotFloatingSchema as unknown as { shape: Record<string, unknown> }).shape;
    expect(shape.floatingConfig).toBeDefined();
    const inner = (shape.floatingConfig as { unwrap: () => { shape: Record<string, unknown> } }).unwrap().shape;
    expect(inner.triggerIcon).toBeDefined();
    // Lit control: a live member sits beside it.
    expect(inner.triggerSize).toBeDefined();
  });
});
