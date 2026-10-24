// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * One named, importable authoring-face type per `plugin-chatbot` registration
 * (objectui#7655, under the objectui#6169 / #6172 family ruling: every
 * component node has exactly one named, importable authoring-face type).
 *
 * ## What was wrong
 *
 * `packages/plugin-chatbot/src/renderer.tsx` registers three components —
 * `chatbot`, `chatbot-enhanced`, `chatbot-floating` — and `@object-ui/types`
 * published ONE face for the family, `ChatbotSchema`, with `type` pinned to
 * `'chatbot'`. An author annotating a `chatbot-floating` node either dropped to
 * untyped JSON or annotated with `ChatbotSchema` and lied about `type`; the
 * docs' floating example had to be a `json` fence because no `tsx` fence could
 * compile. The two registrations' real key sets lived in anonymous
 * `ChatbotSchema & { ... }` intersections local to the renderer.
 *
 * ## The shape, and why not the smaller diff
 *
 * One interface per registration — `ChatbotEnhancedSchema`,
 * `ChatbotFloatingSchema` — not `ChatbotSchema['type']` widened to the union
 * of the three keys. The union would give three nodes ONE type and re-open what
 * #6169 closed: a single interface declaring keys only some of its own `type`
 * values read. Each new face declares what ITS registration reads, censused per
 * key on the PR's base with lit controls, and the keys all three read (twenty
 * at objectui#7655, nineteen since objectui#5605 retired `maxToolRoundtrips`)
 * are picked off `ChatbotSchema` by name (`ChatbotSharedKey`) so they stay one
 * declaration.
 *
 * ## Two channels, stated so nobody reads the wrong one
 *
 * The `export type assertion…` blocks below are COMPILE-TIME: they are checked
 * by `tsc -p tsconfig.test.json` (this package's `type-check` script chains it)
 * and are erased before vitest runs. A green vitest run says nothing about
 * them — the same instrument split `zod-mirror-parity.test.ts` documents, and
 * the same one `chatbot-authoring-face-keys.test.ts` (objectui#6169) uses for
 * its `@ts-expect-error` pins. The `it` blocks are the RUNTIME channel: the Zod
 * twins' accept sets.
 *
 * ## `displayMode` and `floatingConfig` live on BOTH faces; `displayMode` is a tombstone on both
 *
 * `ChatbotSchema` kept `floatingConfig` exactly as it had it, and
 * `ChatbotFloatingSchema` declares the same member. (objectui#6152 round 5 has
 * since RETIRED `ChatbotSchema.floatingConfig` on both faces — the `chatbot`
 * registration never read it — so the member is live on the floating face only;
 * the pins below read that.) `displayMode` was carried
 * the same way — declared verbatim on both faces, untouched by this card —
 * until objectui#7654 RETIRED it (maintainer ruling B, 2026-09-05): it is a
 * `?: never` tombstone on both faces now, the designer control and the
 * `defaultProps` seed in the `chatbot-floating` registration are gone, and the
 * key stays UNMIRRORED on both twins. The runtime pin below still asserts it
 * parses green with any value, as a tripwire; objectui#6152 round 4 kept the
 * refusal TypeScript-only under that ruling, so no arm is owed. The
 * tombstone's own pins are in `chatbot-display-mode-retired.test.ts`.
 *
 * ## The census counts NAMED reads; the floating registration has a second channel
 *
 * `assertionFloatingDeclaresWhatItReads` pins the named-read instrument —
 * `schema.KEY` inside the `chatbot-floating` registration body — and nothing
 * else. That registration used to ALSO end its `FloatingChatbot` element with a
 * raw `{...props}` spread, so every authored key `SchemaRenderer` forwards
 * reached the panel's `ChatbotEnhanced` unfiltered, and `processVisibility`,
 * `surface` and `showAvatars` were LIVE on a `chatbot-floating` node (measured
 * through the real host with lit/dark pairs, `chatbot-enhanced`'s
 * `toDomProps`-filtered spread as the control). The face never declared them:
 * that channel was accidental, and objectui#7708 ruled FENCE — the spread is
 * filtered through `toDomProps` and moved to the head of the element, so the
 * named-read census is now the whole channel and the three keys are dark there.
 * The tripwires that pinned them live, in `plugin-chatbot`'s
 * `renderer.authoring-faces-7655.test.tsx`, flipped to dark with that fix.
 * `showAvatars` was subsequently retired from `ChatbotSchema` altogether
 * (objectui#7703, `__tests__/chatbot-dark-keys-retired-7703.test.ts`).
 */

import { describe, it, expect } from 'vitest';
import type { BaseSchema } from '../base';
import type {
  ChatMessage,
  ChatbotEnhancedSchema,
  ChatbotFloatingSchema,
  ChatbotSchema,
  ChatbotSharedKey,
  FloatingChatbotConfig,
} from '../complex';
import {
  ChatbotEnhancedSchema as ChatbotEnhancedZod,
  ChatbotFloatingSchema as ChatbotFloatingZod,
  ChatbotSchema as ChatbotZod,
  ComplexSchema as ComplexZod,
} from '../zod/complex.zod';
import type { ExpressionWire } from '../expression';

/* ── Type-level helpers (the `tsc` channel) ──────────────────────────────── */

/** Invariant equality — `extends` both ways would accept a narrowing. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

/** Declared keys, read past any index signature (`BaseSchema` carried one until objectui#8347). */
type WithoutIndexSignature<D> = {
  [K in keyof D as string extends K ? never : number extends K ? never : K]: D[K];
};
type DeclaredKeys<D> = Extract<keyof WithoutIndexSignature<D>, string>;
/**
 * Every face's declared keys are `BaseSchema`'s plus exactly its own census, so
 * each pin below is spelled `BaseKeys | <census>`. A union rather than a
 * subtraction on purpose: `placeholder` is declared on the base AND redeclared
 * on `ChatbotSchema` (hence picked onto both new faces), and a subtraction
 * would silently drop it from the census it belongs to — measured, not
 * assumed, with a compiler probe before this file was written.
 */
type BaseKeys = DeclaredKeys<BaseSchema>;

/**
 * The nineteen keys every registration reads, spelled out so the alias is pinned to a list and not to itself.
 * `maxToolRoundtrips` left this census when objectui#5605 retired it: no registration reads it now, and all
 * three faces carry it as the same picked tombstone instead (`RetiredOnEveryFace` below).
 */
type SharedKeys =
  | 'messages' | 'placeholder' | 'api' | 'conversationId' | 'systemPrompt' | 'model'
  | 'streamingEnabled' | 'headers' | 'requestBody' | 'onError'
  | 'showTimestamp' | 'userAvatarUrl' | 'userAvatarFallback' | 'assistantAvatarUrl'
  | 'assistantAvatarFallback' | 'autoResponse' | 'autoResponseText' | 'autoResponseDelay'
  | 'onSend';

/* ── The discriminants: one node, one type ───────────────────────────────── */

export type assertionOneDiscriminantPerFace = [
  Expect<Equal<ChatbotSchema['type'], 'chatbot'>>,
  Expect<Equal<ChatbotEnhancedSchema['type'], 'chatbot-enhanced'>>,
  Expect<Equal<ChatbotFloatingSchema['type'], 'chatbot-floating'>>,
];

/* ── The census, as EXACT key sets (both directions) ─────────────────────── */

export type assertionSharedKeyAliasIsTheCensus = Expect<Equal<ChatbotSharedKey, SharedKeys>>;

/** The objectui#5605 tombstone, declared (as `?: never`) on all three faces by one pick. */
type RetiredOnEveryFace = 'maxToolRoundtrips';

/** `chatbot-enhanced`: the shared nineteen + the tombstone + `maxHeight`, `processVisibility`, and its four own keys. */
export type assertionEnhancedDeclaresWhatItReads = Expect<
  Equal<
    DeclaredKeys<ChatbotEnhancedSchema>,
    | BaseKeys | SharedKeys | RetiredOnEveryFace
    | 'maxHeight' | 'processVisibility' | 'enableMarkdown' | 'enableFileUpload' | 'surface' | 'onClear'
  >
>;

/**
 * `chatbot-floating`, NAMED reads only: the shared nineteen + the tombstone + its three own keys +
 * the two keys it declares alongside `ChatbotSchema`. NO `maxHeight`,
 * `processVisibility` or `surface` — no named read; the raw-spread channel is NOT
 * what this pin measures (see the header).
 */
export type assertionFloatingDeclaresWhatItReads = Expect<
  Equal<
    DeclaredKeys<ChatbotFloatingSchema>,
    | BaseKeys | SharedKeys | RetiredOnEveryFace
    | 'enableMarkdown' | 'enableFileUpload' | 'onClear' | 'displayMode' | 'floatingConfig'
  >
>;

/**
 * `chatbot` keeps its WHOLE face — the six legacy keys (`loading` … `height`),
 * the `onSendMessage` and (since objectui#7654) `displayMode` tombstones, and
 * `floatingConfig` (a tombstone too since objectui#6152 round 5) — exactly where
 * they were. A `?: never` member is still a declared key, so the census does not
 * move when a key is tombstoned. This card declared faces; it retired and moved
 * nothing.
 */
export type assertionChatbotKeepsItsWholeFace = Expect<
  Equal<
    DeclaredKeys<ChatbotSchema>,
    | BaseKeys | SharedKeys | RetiredOnEveryFace
    | 'loading' | 'onSendMessage' | 'showAvatars' | 'userAvatar' | 'assistantAvatar'
    | 'markdown' | 'processVisibility' | 'height' | 'maxHeight' | 'displayMode' | 'floatingConfig'
  >
>;

/**
 * The two floating keys stay DECLARED on `ChatbotSchema` — as tombstones now. Read
 * off the member, not the key set: while `BaseSchema` carried its index signature, a
 * member that fell off the declaration did not go missing here — it read as `any`,
 * and any value compiled on a `chatbot` node (measured on #7655's first cut, which
 * moved the keys off this face by DELETION). `Equal` is what caught the `any`; since
 * objectui#8347 a member that falls off fails to compile at the indexed access.
 * `displayMode` reads as `undefined` since objectui#7654 tombstoned it, and
 * `floatingConfig` since objectui#6152 round 5 RETIRED it on this face (the `chatbot`
 * registration never read it): `?: never` without `exactOptionalPropertyTypes` is
 * `never | undefined`, which collapses — a reading `Equal` still tells apart from
 * the `any` a deletion would leave.
 */
export type assertionFloatingKeysStayTypedOnChatbot = [
  Expect<Equal<ChatbotSchema['displayMode'], undefined>>,
  Expect<Equal<ChatbotSchema['floatingConfig'], undefined>>,
];

/* ── One declaration per shared key: a pick, not a copy ──────────────────── */

export type assertionSharedKeysAreOneDeclaration = [
  Expect<Equal<ChatbotEnhancedSchema['onSend'], ChatbotSchema['onSend']>>,
  Expect<Equal<ChatbotFloatingSchema['onSend'], ChatbotSchema['onSend']>>,
  Expect<Equal<ChatbotEnhancedSchema['messages'], ChatMessage[]>>,
  Expect<Equal<ChatbotFloatingSchema['requestBody'], ChatbotSchema['requestBody']>>,
  Expect<Equal<ChatbotEnhancedSchema['processVisibility'], ChatbotSchema['processVisibility']>>,
];

/*
 * ── `maxToolRoundtrips`: retired on all three faces (objectui#5605) ──────────
 *
 * `?: never` reads `undefined` (without `exactOptionalPropertyTypes`), which
 * `Equal` tells apart from the `any` a DELETION left through `BaseSchema`'s
 * index signature until objectui#8347 (a deletion fails to compile here now) —
 * the reading that says the tombstone is
 * there, and one declaration, on every face.
 */
export type assertionMaxToolRoundtripsIsATombstoneOnEveryFace = [
  Expect<Equal<ChatbotSchema['maxToolRoundtrips'], undefined>>,
  Expect<Equal<ChatbotEnhancedSchema['maxToolRoundtrips'], undefined>>,
  Expect<Equal<ChatbotFloatingSchema['maxToolRoundtrips'], undefined>>,
];

/* ── `displayMode`: one type on both faces; `floatingConfig`: live on the floating face only ── */

/**
 * `floatingConfig` had one type on both faces until objectui#6152 round 5 retired the
 * `chatbot` face's copy; the floating face never inherited it (its `Pick` leaves it
 * out) and keeps its own declaration. The second row is the half that must NOT move.
 */
export type assertionFloatingKeysHaveOneTypeOnBothFaces = [
  Expect<Equal<ChatbotFloatingSchema['displayMode'], ChatbotSchema['displayMode']>>,
  // Both faces carry the objectui#7654 tombstone, so both read `undefined`.
  Expect<Equal<ChatbotFloatingSchema['displayMode'], undefined>>,
  Expect<Equal<ChatbotFloatingSchema['floatingConfig'], FloatingChatbotConfig | undefined>>,
];

/* ── `surface` has one vocabulary; `disabled` stays the inherited union ──── */

export type assertionSurfaceVocabulary = Expect<
  Equal<ChatbotEnhancedSchema['surface'], 'card' | 'plain' | undefined>
>;

/**
 * Neither face redeclares `disabled` (objectui#6169, #7087): the host evaluates
 * it for every node type, and a `boolean` redeclaration would narrow away the
 * expression-string half. `visible` beside it is the twin control, so a face
 * that dropped both keys cannot pass vacuously.
 */
export type assertionDisabledStaysTheBaseUnion = [
  // `boolean | string` until objectui#7530 declared the CEL envelope on the base union.
  Expect<Equal<ChatbotEnhancedSchema['disabled'], boolean | ExpressionWire | undefined>>,
  Expect<Equal<ChatbotFloatingSchema['disabled'], boolean | ExpressionWire | undefined>>,
  Expect<Equal<ChatbotEnhancedSchema['visible'], BaseSchema['visible']>>,
  Expect<Equal<ChatbotFloatingSchema['visible'], BaseSchema['visible']>>,
];

/* ── Runtime: the TypeScript face accepts what it declares, refuses the lie ─ */

const baseMessages: ChatMessage[] = [{ id: '1', role: 'user', content: 'hi' }];

describe('the two faces annotate the nodes their registrations render (objectui#7655)', () => {
  it('a fully authored `chatbot-enhanced` node type-checks against `ChatbotEnhancedSchema`', () => {
    const node: ChatbotEnhancedSchema = {
      type: 'chatbot-enhanced',
      messages: baseMessages,
      api: '/api/v1/ai/chat',
      requestBody: { tenant: 'acme' },
      maxHeight: '600px',
      processVisibility: 'debug',
      enableMarkdown: true,
      enableFileUpload: true,
      surface: 'plain',
      onClear: () => undefined,
      onSend: (content, messages) => {
        expect(typeof content).toBe('string');
        expect(Array.isArray(messages)).toBe(true);
      },
    };
    expect(node.type).toBe('chatbot-enhanced');
    expect(node.surface).toBe('plain');
    node.onSend?.('hello', baseMessages);
  });

  it('a fully authored `chatbot-floating` node type-checks against `ChatbotFloatingSchema`', () => {
    const node: ChatbotFloatingSchema = {
      type: 'chatbot-floating',
      messages: baseMessages,
      floatingConfig: { position: 'bottom-left', defaultOpen: true, panelHeight: 520, title: 'Support' },
      enableMarkdown: false,
      onClear: () => undefined,
    };
    expect(node.floatingConfig?.title).toBe('Support');
  });

  it('the lie the card was filed on is now a `tsc` error: `ChatbotSchema` cannot annotate the other two nodes, and vice versa', () => {
    const wrongOnChatbot: ChatbotSchema = {
      // @ts-expect-error `ChatbotSchema` pins `type` to `'chatbot'` — annotate with `ChatbotFloatingSchema`
      type: 'chatbot-floating',
      messages: baseMessages,
    };
    const wrongOnEnhanced: ChatbotEnhancedSchema = {
      // @ts-expect-error `ChatbotEnhancedSchema` pins `type` to `'chatbot-enhanced'`
      type: 'chatbot',
      messages: baseMessages,
    };
    const wrongOnFloating: ChatbotFloatingSchema = {
      // @ts-expect-error `ChatbotFloatingSchema` pins `type` to `'chatbot-floating'`
      type: 'chatbot-enhanced',
      messages: baseMessages,
    };
    expect([wrongOnChatbot, wrongOnEnhanced, wrongOnFloating]).toHaveLength(3);
  });

  it('a wrong-typed value on a DECLARED key is refused — the field is no longer `any` through the index signature', () => {
    const enhanced: ChatbotEnhancedSchema = {
      type: 'chatbot-enhanced',
      messages: baseMessages,
      // @ts-expect-error `enableFileUpload` is declared `boolean`
      enableFileUpload: 'yes',
    };
    const floating: ChatbotFloatingSchema = {
      type: 'chatbot-floating',
      messages: baseMessages,
      // @ts-expect-error `panelHeight` is a number of pixels, not a CSS length
      floatingConfig: { panelHeight: '520px' },
    };
    // …and on `ChatbotSchema` too: a wrong value on a key it declares as a
    // union is refused there, not swallowed as `any`. (`displayMode` used to
    // be this pin's key; it is a tombstone since objectui#7654, and a tombstone
    // refuses PRESENCE, which is a different pin — see
    // `chatbot-display-mode-retired.test.ts`.)
    const chatbot: ChatbotSchema = {
      type: 'chatbot',
      messages: baseMessages,
      // @ts-expect-error `processVisibility` is the typed union on `ChatbotSchema`
      processVisibility: 'bogus',
    };
    expect(enhanced.type).toBe('chatbot-enhanced');
    expect(floating.type).toBe('chatbot-floating');
    expect(chatbot.type).toBe('chatbot');
  });
});

/* ── Runtime: the Zod twins, in lockstep with the declarations ───────────── */

describe('`ChatbotEnhancedSchema` (zod) validates what the face declares', () => {
  const node = {
    type: 'chatbot-enhanced',
    messages: [{ id: '1', role: 'user', content: 'hi' }],
  };

  it('parses a fully authored node green', () => {
    const result = ChatbotEnhancedZod.safeParse({
      ...node,
      api: '/api/v1/ai/chat',
      requestBody: { tenant: 'acme' },
      maxHeight: '600px',
      processVisibility: 'summary',
      enableMarkdown: true,
      enableFileUpload: false,
      surface: 'plain',
    });
    expect(result.success).toBe(true);
  });

  it('refuses the other two discriminants — the twin is for THIS node', () => {
    for (const type of ['chatbot', 'chatbot-floating']) {
      const result = ChatbotEnhancedZod.safeParse({ ...node, type });
      expect(result.success, type).toBe(false);
      expect(result.error?.issues.some((i) => i.path.join('.') === 'type'), type).toBe(true);
    }
  });

  it("refuses a `surface` outside 'card' | 'plain', and a non-boolean `enableMarkdown` — mirrored, not passed through", () => {
    const surface = ChatbotEnhancedZod.safeParse({ ...node, surface: 'frameless' });
    expect(surface.success).toBe(false);
    expect(surface.error?.issues.some((i) => i.path.join('.') === 'surface')).toBe(true);

    const markdown = ChatbotEnhancedZod.safeParse({ ...node, enableMarkdown: 'yes' });
    expect(markdown.success).toBe(false);
    expect(
      markdown.error?.issues.some((i) => i.path.join('.') === 'enableMarkdown' && i.code === 'invalid_type'),
    ).toBe(true);
  });

  it('mirrors `requestBody` under the key the renderer reads, and refuses a non-object', () => {
    // `ChatbotSchema`'s twin used to mirror this under `body`, colliding with the
    // base children slot; objectui#8572 retired that arm, and since objectui#6152
    // round 4 all three twins share one `requestBody` arm through the pick.
    expect(ChatbotEnhancedZod.shape.requestBody).toBeDefined();
    const result = ChatbotEnhancedZod.safeParse({ ...node, requestBody: 'tenant=acme' });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.path.join('.') === 'requestBody')).toBe(true);
  });

  it('`onClear` is a RUNTIME SLOT the twin refuses by name (objectui#6124), like `onError` and `onSend`', () => {
    for (const key of ['onClear', 'onError', 'onSend']) {
      const result = ChatbotEnhancedZod.safeParse({ ...node, [key]: () => undefined });
      expect(result.success, key).toBe(false);
      const issue = result.error?.issues.find((i) => String(i.path[0]) === key);
      expect(issue?.code, key).toBe('custom');
      expect(issue?.message, key).toContain(`\`${key}\` is a RUNTIME SLOT`);
    }
  });
});

describe('`ChatbotFloatingSchema` (zod) validates what the face declares, and leaves `displayMode` unmirrored', () => {
  const node = {
    type: 'chatbot-floating',
    messages: [{ id: '1', role: 'user', content: 'hi' }],
  };

  it('parses a fully authored floating node green', () => {
    const result = ChatbotFloatingZod.safeParse({
      ...node,
      floatingConfig: { position: 'bottom-left', defaultOpen: true, panelWidth: 400, panelHeight: 520, title: 'Support', triggerSize: 56 },
      enableMarkdown: true,
      enableFileUpload: true,
      requestBody: { tenant: 'acme' },
    });
    expect(result.success).toBe(true);
  });

  it('refuses the other two discriminants', () => {
    for (const type of ['chatbot', 'chatbot-enhanced']) {
      const result = ChatbotFloatingZod.safeParse({ ...node, type });
      expect(result.success, type).toBe(false);
    }
  });

  it('TRIPWIRE — `displayMode` stays unmirrored here as on `ChatbotSchema`: any value still parses green (retired by objectui#7654; the refusal stays TypeScript-only under that ruling, objectui#6152 round 4)', () => {
    // objectui#7654 retired the key (maintainer ruling B, 2026-09-05): a
    // `?: never` tombstone on both TypeScript faces, designer control and seed
    // removed. The RUNTIME face was deliberately left alone — the key has no
    // mirror arm on either twin and `BaseSchema` is `.passthrough()`, so a
    // stored document carrying it parses exactly as it did before the ruling.
    // BOTH assertions below are tripwires, not just the shape pin. Measured on
    // `ChatbotSchema`'s twin, which carries the key on the same terms this one
    // does: minting the arm a scalar union takes — an optional `z.enum` over
    // `'inline' | 'floating'` — reddened `tsc -p` on this package's
    // `tsconfig.test.json` with exactly one error, at
    // `zod-mirror-parity.test.ts(1586,14)`, AND `vitest` with exactly two
    // failures: the shape pin and the parse-green line, since an enum arm
    // refuses `'anything-at-all'`. It does NOT take a `.strict()` mirror. (The
    // strict-vs-non-strict split objectui#7678 item 2 records was measured on
    // OBJECT-mirror shapes; transposing it onto this scalar union is wrong.)
    // Red here is the signal to add the `retirementTombstone()` half at the
    // same time, not to delete the pin. The tombstone's own pins are in
    // `chatbot-display-mode-retired.test.ts`.
    expect((ChatbotFloatingZod.shape as Record<string, unknown>).displayMode).toBeUndefined();
    expect(ChatbotFloatingZod.safeParse({ ...node, displayMode: 'anything-at-all' }).success).toBe(true);
    // Lit control on the same instrument: a key the twin DOES declare is in its
    // shape and DOES refuse a wrong value, so "undefined" above is a reading.
    expect(ChatbotFloatingZod.shape.enableMarkdown).toBeDefined();
    expect(ChatbotFloatingZod.safeParse({ ...node, enableMarkdown: 'anything-at-all' }).success).toBe(false);
  });

  it('`floatingConfig` is mirrored here since objectui#6152 round 4, and a wrong member value is refused at its path', () => {
    // This registration is the one that reads the key. `ChatbotSchema`'s twin,
    // whose registration never does, had no arm for it until objectui#6152 round 5
    // RETIRED it there — a tombstone that refuses ANY value, the valid one this
    // twin accepts included. Pinned on both twins so neither half can move alone.
    expect((ChatbotFloatingZod.shape as Record<string, unknown>).floatingConfig).toBeDefined();
    const wrong = ChatbotFloatingZod.safeParse({ ...node, floatingConfig: { panelHeight: '520px' } });
    expect(wrong.success).toBe(false);
    expect(wrong.error?.issues.some((i) => i.path.join('.') === 'floatingConfig.panelHeight')).toBe(true);
    const valid = { panelHeight: 520, title: 'Support' };
    expect(ChatbotFloatingZod.safeParse({ ...node, floatingConfig: valid }).success).toBe(true);
    const onChatbot = ChatbotZod.safeParse({ ...node, type: 'chatbot', floatingConfig: valid });
    expect(onChatbot.success).toBe(false);
    expect(onChatbot.error?.issues.map((i) => [i.path.join('.'), i.code])).toEqual([['floatingConfig', 'invalid_type']]);
  });

  it('`onClear` / `onError` / `onSend` are refused by name here too', () => {
    for (const key of ['onClear', 'onError', 'onSend']) {
      const result = ChatbotFloatingZod.safeParse({ ...node, [key]: () => undefined });
      expect(result.success, key).toBe(false);
      expect(result.error?.issues.find((i) => String(i.path[0]) === key)?.code, key).toBe('custom');
    }
  });
});

describe('the census is structural: picked off `ChatbotSchema`, never copied', () => {
  const shared: readonly ChatbotSharedKey[] = [
    'messages', 'placeholder', 'api', 'conversationId', 'systemPrompt', 'model', 'streamingEnabled',
    'headers', 'requestBody', 'onError', 'showTimestamp', 'userAvatarUrl', 'userAvatarFallback',
    'assistantAvatarUrl', 'assistantAvatarFallback', 'autoResponse', 'autoResponseText',
    'autoResponseDelay', 'onSend',
  ];

  it('every shared arm on the two twins carries `ChatbotSchema`\'s own description — one spelling', () => {
    const describe_ = (shape: Record<string, { description?: string }>, key: string) => shape[key]?.description;
    for (const key of shared) {
      expect(describe_(ChatbotEnhancedZod.shape, key), key).toBe(describe_(ChatbotZod.shape, key));
      expect(describe_(ChatbotFloatingZod.shape, key), key).toBe(describe_(ChatbotZod.shape, key));
      expect(describe_(ChatbotZod.shape, key), key).toBeDefined();
    }
  });

  it('the keys a registration never reads are NOT on its twin — with `ChatbotSchema` as the lit control', () => {
    const enhanced = ChatbotEnhancedZod.shape as Record<string, unknown>;
    const floating = ChatbotFloatingZod.shape as Record<string, unknown>;
    const chatbot = ChatbotZod.shape as Record<string, unknown>;
    for (const legacy of ['loading', 'showAvatars', 'userAvatar', 'assistantAvatar', 'markdown', 'height', 'onSendMessage']) {
      expect(enhanced[legacy], legacy).toBeUndefined();
      expect(floating[legacy], legacy).toBeUndefined();
      expect(chatbot[legacy], legacy).toBeDefined();
    }
    for (const enhancedOnly of ['maxHeight', 'processVisibility', 'surface']) {
      expect(enhanced[enhancedOnly], enhancedOnly).toBeDefined();
      expect(floating[enhancedOnly], enhancedOnly).toBeUndefined();
    }
  });

  it('`ComplexSchema` routes each discriminant to its own arm', () => {
    const messages = [{ id: '1', role: 'user', content: 'hi' }];
    expect(ComplexZod.safeParse({ type: 'chatbot-floating', messages }).success).toBe(true);
    expect(ComplexZod.safeParse({ type: 'chatbot-enhanced', messages }).success).toBe(true);
    // Routed to the ENHANCED arm — a `surface` refusal can only come from there.
    const routed = ComplexZod.safeParse({ type: 'chatbot-enhanced', messages, surface: 'frameless' });
    expect(routed.success).toBe(false);
    expect(routed.error?.issues.some((i) => i.path.join('.') === 'surface')).toBe(true);
  });
});
