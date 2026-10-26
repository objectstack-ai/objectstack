/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Retirement pin — the six `ChatbotSchema` members no `plugin-chatbot`
 * registration reads are REFUSED, not silently ignored (objectui#7703,
 * ADR-0049 enforce-or-remove, one decision per key).
 *
 * ## The failure this pin exists to prevent
 *
 * `loading`, `showAvatars`, `userAvatar`, `assistantAvatar`, `markdown` and
 * `height` were declared on `ChatbotSchema`, mirrored on its Zod twin, and read
 * by NOTHING — two of them (`showAvatars`, `markdown`) advertising a
 * `@default true` for a switch that did not exist. An author, or an AI author
 * reading the `.d.ts`, wrote `showAvatars: true` or `height: 400` on a
 * `chatbot` node, got no error on either published face, and saw no change.
 *
 * The instrument, re-measured on this branch's base (`21d7989fb`, i.e. AFTER
 * objectui#7708's fence landed as PR #8077): one `schema.KEY` count per
 * `ComponentRegistry.register(...)` body of
 * `packages/plugin-chatbot/src/renderer.tsx`, the file split at the three
 * register calls. All six read 0 / 0 / 0 across
 * `chatbot` / `chatbot-enhanced` / `chatbot-floating`. Lit controls on the same
 * instrument in the same pass — `placeholder` 1 / 1 / 1, `messages` 1 / 1 / 1,
 * `userAvatarUrl` 1 / 1 / 1, `maxHeight` 1 / 1 / 0, `floatingConfig` 0 / 0 / 1,
 * `processVisibility` 0 / 1 / 0 — so the zeros are readings, not a blind grep.
 *
 * ⭐ `showAvatars` is the one key whose provenance differs, and the difference
 * is recorded rather than smoothed over: `<ChatbotEnhanced>` HAS a
 * `showAvatars` prop, and until objectui#7708 the `chatbot-floating`
 * registration's raw trailing `{...props}` spread delivered an authored value
 * to it unfiltered. That card was ruled FENCE and landed as PR #8077 — the
 * spread is filtered through `toDomProps` at the head of the element now — so
 * `showAvatars` is a key the FENCE turned dark, not a key nothing ever read.
 * The other five were live on no channel at any time: they are not
 * `ChatbotEnhancedProps` members either (`markdown` exists there only as
 * `enableMarkdown`), so the spread had nothing to land them on.
 *
 * ⛔ `processVisibility` is NOT part of this retirement — `chatbot-enhanced`
 * reads it (0 / 1 / 0). It is pinned live below as a control, so the boundary
 * cannot rot into prose.
 *
 * ## Why tombstones and not deletions
 *
 * All six HAVE a Zod arm, which is what decides the route here: `BaseSchema` is
 * `.passthrough()` on the Zod side (and carried a `[key: string]: any` index
 * signature on the TS side until objectui#8347), so an UNDECLARED key is not
 * refused there, it is KEPT.
 * Deleting the members would hand the authored spelling exactly the silent
 * no-op this card exists to close. `?: never` + `retirementTombstone()` is this
 * package's convention — `MarkdownSchema.sanitize` / `.components`
 * (objectui#6972), `TimelineSchema.timeScale` (objectui#6355),
 * `ObjectKanbanSchema` item ① (objectui#7322), `ObjectViewSchema.viewTabBar`
 * (objectui#7779) — and it is lockstep: both halves or neither. The "deleted"
 * row is pinned live below as a control.
 *
 * ## Why not ENFORCE, per key — the other arm, refused six times
 *
 * `<Chatbot>` (`plugin-chatbot/src/index.tsx`), the component THIS
 * registration renders, declares `messages`, `placeholder`, `onSendMessage`,
 * `disabled`, `showTimestamp`, `userAvatarUrl`, `userAvatarFallback`,
 * `assistantAvatarUrl`, `assistantAvatarFallback` and `maxHeight` — not one of
 * the six. Enforcing any of them means growing a component prop (a feature) or
 * publishing a SECOND spelling of a key that already works (AGENTS.md #0.1).
 * Per key: `loading` is runtime state the chat runtime owns; `showAvatars` has
 * no target on `<Chatbot>` and re-declaring it on the faces that DO reach
 * `<ChatbotEnhanced>` would re-open by declaration the channel objectui#7708
 * closed by fence; `userAvatar` / `assistantAvatar` / `height` / `markdown`
 * each have a live sibling (`userAvatarUrl`, `assistantAvatarUrl`, `maxHeight`,
 * `enableMarkdown`) that the registrations already read.
 *
 * The `@ts-expect-error` directives are REAL enforcement: this package
 * type-checks its tests through `tsconfig.test.json`, so re-widening a
 * declaration fails the build on the unused directive (TS2578). A green
 * `vitest` run is NOT evidence about them — type assertions are erased before
 * it runs.
 */

import { describe, it, expect } from 'vitest';
import {
  ChatbotSchema as ChatbotZod,
  ChatbotEnhancedSchema as ChatbotEnhancedZod,
  ChatbotFloatingSchema as ChatbotFloatingZod,
} from '../zod/complex.zod.js';
import type {
  ChatbotSchema as ChatbotSchemaTS,
  ChatbotEnhancedSchema as ChatbotEnhancedSchemaTS,
  ChatbotFloatingSchema as ChatbotFloatingSchemaTS,
} from '../complex.js';

/**
 * The retired keys, each with the values an author would plausibly have
 * written, the FULL guidance string (pinned as a literal so the derived
 * assertions below cannot all drift together), and the prescriptive half — the
 * sentence that tells the author what is true and what to write instead.
 */
const RETIRED = {
  loading: {
    values: [true, false] as const,
    guidance:
      'RETIRED (ADR-0049) — never read: chat progress is runtime state the chat runtime owns '
      + '(the registration derives it from `useObjectChat` as `isLoading`), and `<Chatbot>` declares no `loading` '
      + 'prop for an authored value to land on. There is no authored spelling that sets it; delete the key.',
    prescriptive: 'There is no authored spelling that sets it; delete the key.',
  },
  showAvatars: {
    values: [true, false] as const,
    guidance:
      'RETIRED (ADR-0049) — no registration reads or forwards this key by name, and a `chatbot` '
      + 'node renders `<Chatbot>`, which has no `showAvatars` prop; the one channel that did deliver it — the '
      + "`chatbot-floating` registration's unfiltered props spread — was fenced. Delete the key: "
      + 'a `chatbot` node already renders an avatar beside every message, and the images are `userAvatarUrl` / '
      + '`assistantAvatarUrl` with their `userAvatarFallback` / `assistantAvatarFallback` siblings.',
    prescriptive: 'was fenced.',
  },
  userAvatar: {
    values: ['https://example.com/me.png', ''] as const,
    guidance:
      'RETIRED (ADR-0049) — never read: this spelling has zero hits anywhere in '
      + '`packages/plugin-chatbot`. Write `userAvatarUrl` instead (with `userAvatarFallback` for the text shown '
      + 'while the image loads or fails), the key all three chatbot registrations read.',
    prescriptive: 'Write `userAvatarUrl` instead',
  },
  assistantAvatar: {
    values: ['https://example.com/bot.png', ''] as const,
    guidance:
      'RETIRED (ADR-0049) — never read: this spelling has zero hits anywhere in '
      + '`packages/plugin-chatbot`. Write `assistantAvatarUrl` instead (with `assistantAvatarFallback` for the '
      + 'text shown while the image loads or fails), the key all three chatbot registrations read.',
    prescriptive: 'Write `assistantAvatarUrl` instead',
  },
  markdown: {
    values: [true, false] as const,
    guidance:
      'RETIRED (ADR-0049) — never read: a `chatbot` node renders `<Chatbot>`, which prints message '
      + 'content as text and has no markdown path for this switch to reach. Author `type: "chatbot-enhanced"` '
      + '(or `"chatbot-floating"`) with `enableMarkdown` instead — markdown is those nodes\' capability, and '
      + '`enableMarkdown` is the key their registrations read.',
    prescriptive: 'with `enableMarkdown` instead',
  },
  height: {
    // Both arms of the retired `string | number` union — a deletion would have
    // left the numeric one riding `.passthrough()` exactly like the string one.
    values: ['400px', 400] as const,
    guidance:
      'RETIRED (ADR-0049) — never read: `<Chatbot>` has no `height` prop. Write `maxHeight` '
      + 'instead (a CSS length string, default "500px"), the key the `chatbot` and `chatbot-enhanced` '
      + 'registrations forward; size a `chatbot-floating` panel with `floatingConfig.panelHeight`, a number of '
      + 'pixels, which is what that panel reads.',
    prescriptive: 'Write `maxHeight` instead',
  },
} as const;

type RetiredKey = keyof typeof RETIRED;

const RETIRED_KEYS = Object.keys(RETIRED) as RetiredKey[];

/** A minimal document that is valid TODAY and stays valid — the inside of the boundary. */
const VALID_CHATBOT = {
  type: 'chatbot',
  messages: [{ id: '1', role: 'assistant', content: 'Hello! How can I help you today?' }],
} as const;

const shapeOf = (schema: unknown): Record<string, unknown> =>
  (schema as { shape: Record<string, unknown> }).shape;

const describeOf = (schema: unknown, key: string): string | undefined =>
  (shapeOf(schema)[key] as { description?: string } | undefined)?.description;

/* ── the Zod half: refused BY NAME, with the guidance in the message ─────── */

describe.each(RETIRED_KEYS)(
  'ChatbotSchema.%s is RETIRED — the Zod half of the tombstone (objectui#7703)',
  (key) => {
    const { values, guidance, prescriptive } = RETIRED[key];

    it.each(values.map((v) => [JSON.stringify(v), v] as const))(
      'REFUSES `%s`, naming the retired key in the path — every value, not one spelling',
      (_label, value) => {
        // The pin. Before this retirement the same document parsed GREEN — the
        // six arms were `z.boolean()` / `z.string()` / `z.union([z.string(),
        // z.number()])`, all `.optional()`, measured ACCEPTED on this branch's
        // base. Asserting the ENVELOPE — not merely `success:false` — so the
        // pin cannot be satisfied by an unrelated rejection.
        const result = ChatbotZod.safeParse({ ...VALID_CHATBOT, [key]: value });
        expect(
          result.success,
          `an authored \`${key}: ${JSON.stringify(value)}\` was ACCEPTED — it parses green and changes nothing`,
        ).toBe(false);
        if (result.success) return;

        const issue = result.error.issues.find((i) => i.path[0] === key);
        expect(issue, `parse failed, but not on the \`${key}\` path`).toBeTruthy();
        // The accept-set contract: same address, same code a bare `z.never()`
        // reports — `retirementTombstone()` customises the MESSAGE only.
        expect(issue?.code).toBe('invalid_type');
        expect((issue as { expected?: string } | undefined)?.expected).toBe('never');
        expect(issue?.path).toEqual([key]);
      },
    );

    it("the refusal CARRIES the guidance — the prescriptive sentence, not zod's generic message", () => {
      const result = ChatbotZod.safeParse({ ...VALID_CHATBOT, [key]: values[0] });
      expect(result.success).toBe(false);
      if (result.success) return;

      const issue = result.error.issues.find((i) => i.path[0] === key);
      expect(issue?.message).not.toContain('Invalid input: expected never, received ');
      // The half an author acts on: what is TRUE and what to write INSTEAD.
      // Pinned as text because the wording is the contract here — a message
      // that only said "retired" would leave the author with no next step, and
      // for `showAvatars` it would erase the one fact that distinguishes this
      // key from the other five (objectui#7708 fenced it; it was not always
      // dark).
      expect(issue?.message).toContain(prescriptive);
      expect(issue?.message).toBe(guidance);
      // ONE string, BOTH channels — asserted derived, so the parse message and
      // the generated-docs metadata cannot drift apart.
      expect(issue?.message).toBe(describeOf(ChatbotZod, key));
    });

    it('keeps the key DECLARED on the mirror — a tombstone, not a deletion', () => {
      // The route guard. `BaseSchema` is `.passthrough()`, so removing the key
      // from the mirror would make the authored spelling parse green again and
      // do nothing — the silent no-op reintroduced by the very edit meant to
      // remove it.
      expect(
        Object.keys(shapeOf(ChatbotZod)),
        `${key} left the mirror — under .passthrough() the retired key becomes a SILENT no-op again`,
      ).toContain(key);
      expect(describeOf(ChatbotZod, key)).toContain('RETIRED (ADR-0049) —');
    });

    it('does NOT appear on the two sibling twins — the retirement declares nothing new', () => {
      // objectui#7655 gave `chatbot-enhanced` and `chatbot-floating` their own
      // faces, censused per key, and deliberately left all six off both. A
      // tombstone is a REFUSAL, and adding one where the key was never declared
      // would be a new declaration — the opposite of retiring. Their twins must
      // stay untouched, so a stored `chatbot-enhanced` node carrying the key
      // keeps riding `.passthrough()` exactly as it did.
      expect(shapeOf(ChatbotEnhancedZod)[key], key).toBeUndefined();
      expect(shapeOf(ChatbotFloatingZod)[key], key).toBeUndefined();
    });
  },
);

/* ── the inside of the boundary: everything else is untouched ────────────── */

describe('the retirement narrows exactly the six keys and nothing else (objectui#7703)', () => {
  it('a document that wrote none of them parses GREEN — `absent` stays valid', () => {
    // `.optional()` on all six tombstones. The retirement narrows exactly six
    // keys, and every one of them stays omittable.
    const result = ChatbotZod.safeParse(VALID_CHATBOT);
    expect(result.success ? null : result.error.issues).toBe(null);
  });

  it('still ACCEPTS every live sibling the retired keys point at — the lit control', () => {
    // Without this leg the six refusals above would be satisfied by a schema
    // that refuses every optional key: a narrowing that refuses too much passes
    // a refusal-only test. These are the exact replacement spellings the
    // guidance strings name, plus the shared keys the registrations read.
    const result = ChatbotZod.safeParse({
      ...VALID_CHATBOT,
      placeholder: 'Type a message...',
      showTimestamp: true,
      userAvatarUrl: 'https://example.com/me.png',
      userAvatarFallback: 'JD',
      assistantAvatarUrl: 'https://example.com/bot.png',
      assistantAvatarFallback: 'AI',
      maxHeight: '400px',
    });
    expect(result.success ? null : result.error.issues).toBe(null);
  });

  it('still ACCEPTS `processVisibility` — the seventh key, deliberately NOT retired', () => {
    // The scope boundary, pinned rather than argued. `processVisibility` reads
    // 0 / 1 / 0 on the same instrument — `chatbot-enhanced` forwards it by name
    // — and objectui#7655 left the `ChatbotSchema` member as it was. It is a
    // different question from this card and is not folded in.
    const result = ChatbotZod.safeParse({ ...VALID_CHATBOT, processVisibility: 'debug' });
    expect(result.success ? null : result.error.issues).toBe(null);
    // And it is still VALIDATED, not merely accepted — so "untouched" is a
    // reading about a live arm, not about a hole.
    expect(ChatbotZod.safeParse({ ...VALID_CHATBOT, processVisibility: 'loud' }).success).toBe(false);
  });

  it('still REFUSES a wrong `messages` — the mirror did not stop validating', () => {
    // Counter-probe in the other direction: the schema is not `z.any()` in
    // disguise, so the green results above are readings.
    const result = ChatbotZod.safeParse({ type: 'chatbot', messages: 'not an array' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.find((i) => i.path[0] === 'messages')).toBeTruthy();
  });

  it('an UNDECLARED key still rides `.passthrough()` — the DELETED row, measured live', () => {
    // This is the contrast that justifies `?: never` over deletion, pinned
    // rather than argued: a key the mirror does not declare is neither refused
    // nor stripped, it is KEPT. Had the six been deleted instead of tombstoned,
    // an authored value would sit exactly where this one sits — green,
    // forwarded, and read by nothing.
    const result = ChatbotZod.safeParse({ ...VALID_CHATBOT, notAKeyAtAll: 'anything' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toHaveProperty('notAKeyAtAll', 'anything');
  });

  it('a stored `chatbot-enhanced` / `chatbot-floating` node carrying a retired key still parses GREEN', () => {
    // The blast radius, stated as a measurement. The two sibling faces never
    // declared these keys, so their twins have no arm to refuse one and
    // `.passthrough()` keeps it — before this change and after it. The
    // retirement moves the `chatbot` node's accept set and nothing else.
    for (const key of RETIRED_KEYS) {
      const enhanced = ChatbotEnhancedZod.safeParse({
        type: 'chatbot-enhanced',
        messages: VALID_CHATBOT.messages,
        [key]: RETIRED[key].values[0],
      });
      expect(enhanced.success, `chatbot-enhanced rejected \`${key}\``).toBe(true);
      const floating = ChatbotFloatingZod.safeParse({
        type: 'chatbot-floating',
        messages: VALID_CHATBOT.messages,
        [key]: RETIRED[key].values[0],
      });
      expect(floating.success, `chatbot-floating rejected \`${key}\``).toBe(true);
    }
  });
});

/* ── the TS half: the `tsc` channel ──────────────────────────────────────── */

describe('the six keys are RETIRED on the TypeScript face too (objectui#7703)', () => {
  it('refuses each retired key at compile time, with a live sibling as the counter-probe', () => {
    // On the pre-fix tree each member carried its own value type, so every
    // assignment below was LEGAL, the directives were unused, and `tsc` failed
    // the build with TS2578 naming the key — these legs are red before the fix
    // in `type-check`, not in vitest, which strips types.

    // @ts-expect-error — `loading` is RETIRED (objectui#7703): declared `?: never`, so no value is authorable.
    const retiredLoading: ChatbotSchemaTS['loading'] = true;
    // @ts-expect-error — `showAvatars` is RETIRED (objectui#7703); objectui#7708 fenced the one channel that read it.
    const retiredShowAvatars: ChatbotSchemaTS['showAvatars'] = true;
    // @ts-expect-error — `userAvatar` is RETIRED (objectui#7703); write `userAvatarUrl`.
    const retiredUserAvatar: ChatbotSchemaTS['userAvatar'] = 'https://example.com/me.png';
    // @ts-expect-error — `assistantAvatar` is RETIRED (objectui#7703); write `assistantAvatarUrl`.
    const retiredAssistantAvatar: ChatbotSchemaTS['assistantAvatar'] = 'https://example.com/bot.png';
    // @ts-expect-error — `markdown` is RETIRED (objectui#7703); author `chatbot-enhanced` with `enableMarkdown`.
    const retiredMarkdown: ChatbotSchemaTS['markdown'] = true;
    // @ts-expect-error — `height` is RETIRED (objectui#7703); write `maxHeight`.
    const retiredHeight: ChatbotSchemaTS['height'] = '400px';

    // Counter-probes on the same surface: the live siblings each guidance
    // string names still accept their values, so the directives above pin the
    // KEYS' retirement and not a blanket narrowing of the interface.
    const liveUserAvatarUrl: ChatbotSchemaTS['userAvatarUrl'] = 'https://example.com/me.png';
    const liveAssistantAvatarUrl: ChatbotSchemaTS['assistantAvatarUrl'] = 'https://example.com/bot.png';
    const liveMaxHeight: ChatbotSchemaTS['maxHeight'] = '400px';
    const liveProcessVisibility: ChatbotSchemaTS['processVisibility'] = 'debug';

    expect([
      retiredLoading, retiredShowAvatars, retiredUserAvatar, retiredAssistantAvatar,
      retiredMarkdown, retiredHeight,
      liveUserAvatarUrl, liveAssistantAvatarUrl, liveMaxHeight, liveProcessVisibility,
    ]).toHaveLength(10);
  });

  it('refuses them in the form authors actually write — a fresh document literal', () => {
    // The leg that proved the tombstones survive `BaseSchema`'s
    // `[key: string]: any` while it stood (objectui#8347 removed it): if the
    // index signature had won, each key would have widened back to `any`
    // here and every directive would have gone unused (TS2578).
    const retiredDocument: ChatbotSchemaTS = {
      type: 'chatbot',
      messages: [],
      // @ts-expect-error — `showAvatars` is RETIRED (objectui#7703); a `chatbot` node renders `<Chatbot>`, which has no such prop.
      showAvatars: true,
      // @ts-expect-error — `height` is RETIRED (objectui#7703); write `maxHeight`.
      height: 400,
      // @ts-expect-error — `markdown` is RETIRED (objectui#7703); author `chatbot-enhanced` with `enableMarkdown`.
      markdown: true,
    };

    // The migrated document — every retired key replaced by the live spelling
    // its guidance names — still type-checks.
    const migratedDocument: ChatbotSchemaTS = {
      type: 'chatbot',
      messages: [],
      userAvatarUrl: 'https://example.com/me.png',
      assistantAvatarUrl: 'https://example.com/bot.png',
      maxHeight: '400px',
    };

    expect([retiredDocument, migratedDocument]).toHaveLength(2);
  });

  it('refuses them through a WIDENED value too — the half a deletion would have missed', () => {
    // Excess-property checking only reaches a FRESH literal (objectui#7654
    // measured the contrast on this very carrier): a deleted key would ride a
    // widened value silently, and on a `BaseSchema` carrier even a wrong-TYPED
    // value went quiet while the index signature defeated the weak-type check as
    // well (until objectui#8347). The declared `never` makes the assignment itself ill-typed, so
    // freshness stops mattering.
    const raw = { type: 'chatbot' as const, messages: [], userAvatar: 'https://example.com/me.png' };
    // @ts-expect-error — `userAvatar` is RETIRED (objectui#7703), reached through a non-fresh value.
    const document: ChatbotSchemaTS = raw;
    expect(document.type).toBe('chatbot');
  });

  it('leaves the two sibling faces alone on the TS channel as well', () => {
    // The mirror leg above measured this on the Zod face; this is the same
    // boundary on the `tsc` face. `ChatbotEnhancedSchema` and
    // `ChatbotFloatingSchema` reach `ChatbotSchema` only through
    // `Pick<..., ChatbotSharedKey | ...>`, and none of the six is a picked key,
    // so no tombstone can travel to them: the keys stay UNDECLARED there — no
    // member at all, where a tombstone would be a `?: never` member. Until
    // objectui#8347 they rode `BaseSchema`'s index signature, and a
    // directive-free annotated literal was this leg's instrument. With the
    // signature gone an undeclared key is refused on a fresh literal as well,
    // so the leg reads membership instead, which separates the two.
    type IsMember<T, K extends PropertyKey> = K extends keyof T ? true : false;
    const undeclared: [IsMember<ChatbotEnhancedSchemaTS, 'showAvatars'>, IsMember<ChatbotFloatingSchemaTS, 'height'>] = [
      false,
      false,
    ];
    // Control: a picked key IS a member of each sibling, so `false` is a reading.
    const picked: [IsMember<ChatbotEnhancedSchemaTS, 'messages'>, IsMember<ChatbotFloatingSchemaTS, 'messages'>] = [
      true,
      true,
    ];
    expect([...undeclared, ...picked]).toEqual([false, false, true, true]);
  });
});
