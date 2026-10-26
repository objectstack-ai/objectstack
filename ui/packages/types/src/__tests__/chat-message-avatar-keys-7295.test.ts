/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#7295 — `ChatMessage.avatar` / `ChatMessage.avatarFallback`, the two
 * per-message keys a human author writes by hand.
 *
 * ## The defect
 *
 * `packages/plugin-chatbot/src/index.tsx:173–178` reads
 * `message.avatar || userAvatarUrl` and
 * `message.avatarFallback || userAvatarFallback` (and the assistant twins), the
 * authoring-to-runtime seam spreads every unlisted key through
 * (`chatMessageAdapter.ts`, `...passthrough`), and the SDUI renderer feeds the
 * authored `messages[]` straight in — so a per-message avatar override
 * RENDERS. But neither face of the authoring contract declared the keys: not
 * the TypeScript interface in `../complex.ts`, not the zod mirror in
 * `../zod/complex.zod.ts`. objectui#4424's `RuntimeOnlyMessageKeys` named the
 * three keys API mode lifts out of the stream and never these two.
 *
 * ## Two things differ from the `BaseSchema` cases this file's form comes from
 *
 * (`undeclared-but-consumed-keys-6150.test.ts`,
 * `checkbox-wrapper-class-6938.test.ts`) — both MEASURED on `446d93d` before
 * this card, through the built `packages/types/dist`, not assumed:
 *
 *   1. `ChatMessage` has NO index signature (objectui#5155 records why one must
 *      not be added). So the TS face did not admit the key unexamined — it
 *      REFUSED it: an author annotating `ChatbotSchema.messages` got
 *      `TS2353: 'avatarFallback' does not exist in type 'ChatMessage'` on a
 *      value that renders (five of them on
 *      `content/docs/plugins/plugin-chatbot.mdx`, which is why PR #7294 left
 *      three example blocks unannotated).
 *   2. `ChatMessageSchema` is a plain `z.object` with no catchall — STRIP mode,
 *      not `.passthrough()`. An authored `avatar` parsed green through
 *      `ChatMessageSchema`, through `ChatbotSchema` and through
 *      `safeValidateSchema`, and was DROPPED from the parsed output every time;
 *      the runtime honoured it only because the renderer receives the
 *      un-parsed document. `avatar: 42` was admitted-and-stripped, never
 *      refused.
 *
 * So declaring the keys moves BOTH faces: the TS face stops refusing a correct
 * value, and the mirror starts KEEPING the value and REFUSING a wrong-typed
 * one. The CONTROL key is what proves nothing else moved: a plausible
 * per-message key the plugin never reads — derived from the renderer's
 * `message.KEY` read set off disk, not asserted from memory — stays undeclared
 * on the TS face and is still admitted-and-stripped by the mirror, exactly as
 * before.
 *
 * `SeamChatMessage` (`plugin-chatbot`) inherits both keys through its
 * `ChatMessage` half; that is verified by that package's `type-check` against
 * the rebuilt types dist, not here — `@object-ui/types` has no dependency on
 * the plugin and must not gain one.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { ChatMessageSchema, ChatbotSchema } from '../zod/complex.zod';
import { safeValidateSchema } from '../zod/index.zod';
import type { ChatMessage as TsChatMessage, ChatbotSchema as TsChatbotSchema } from '../complex';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
const READER = 'packages/plugin-chatbot/src/index.tsx';
const SEAM = 'packages/plugin-chatbot/src/chatMessageAdapter.ts';
const DOC = 'content/docs/plugins/plugin-chatbot.mdx';

const KEYS = ['avatar', 'avatarFallback'] as const;
type Key = (typeof KEYS)[number];

/**
 * Exact source text of each read, as it stands today. Line numbers drift and
 * live in the docblocks' prose only; the READ is the fact.
 */
const READ_TEXT: Record<Key, readonly string[]> = {
  avatar: ['message.avatar || userAvatarUrl', 'message.avatar || assistantAvatarUrl'],
  avatarFallback: [
    'message.avatarFallback || userAvatarFallback',
    'message.avatarFallback || assistantAvatarFallback',
  ],
};
/** The seam spread that carries an unlisted authored key to the renderer. */
const SEAM_TEXT = 'const { role, timestamp, toolInvocations, ...passthrough } = message;';

/** A value each declaration admits — the documented per-message override. */
const LEGAL: Record<Key, string> = {
  avatar: 'https://example.com/special-avatar.jpg',
  avatarFallback: 'SP',
};

/**
 * A plausible per-message key the plugin never reads: the chatbot-level config
 * spells the URL `userAvatarUrl`, so `avatarUrl` is the spelling an author
 * would guess for the per-message override — and it does nothing. It stays
 * undeclared on both faces.
 */
const CONTROL_KEY = 'avatarUrl';

/** A declared-keys-only message; every assertion below is a delta on it. */
const MESSAGE = { id: '1', role: 'assistant', content: 'Message content' } as const;
/** The same message inside a `chatbot` node, for the published entry point. */
const chatbotNode = (message: Record<string, unknown>) => ({ type: 'chatbot', messages: [message] });

/* ── Type-level pins (invariant equality, house form) ─────────────────────── */

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;
/** The canonical `any` detector: only `any` absorbs `1 &` down to something `0` extends. */
type IsAny<T> = 0 extends (1 & T) ? true : false;
type HasKey<T, K extends PropertyKey> = K extends keyof T ? true : false;
/** An object with no keys is assignable to `Pick<T, K>` only when `K` is optional on `T`. */
type IsOptional<T, K extends keyof T> = Record<string, never> extends Pick<T, K> ? true : false;

// Declared as `string`, optional, and not `any`. Were a member removed, the
// indexed access below would not fall back to an index signature (there is
// none) — it would stop compiling, which is the type-level leg of the pin.
export type _AvatarIsString = Expect<Equal<NonNullable<TsChatMessage['avatar']>, string>>;
export type _AvatarIsNotAny = Expect<Equal<IsAny<TsChatMessage['avatar']>, false>>;
export type _AvatarIsOptional = Expect<IsOptional<TsChatMessage, 'avatar'>>;
export type _AvatarFallbackIsString = Expect<Equal<NonNullable<TsChatMessage['avatarFallback']>, string>>;
export type _AvatarFallbackIsNotAny = Expect<Equal<IsAny<TsChatMessage['avatarFallback']>, false>>;
export type _AvatarFallbackIsOptional = Expect<IsOptional<TsChatMessage, 'avatarFallback'>>;

// The per-message keys are typed exactly like the chatbot-level keys they
// override (`ChatbotSchema.userAvatarUrl` / `.userAvatarFallback`): the
// renderer folds the two together with `||`, so a wider or narrower
// per-message type would be a second contract for the same slot.
export type _AvatarMatchesChatbotUrlKey =
  Expect<Equal<NonNullable<TsChatMessage['avatar']>, NonNullable<TsChatbotSchema['userAvatarUrl']>>>;
export type _AvatarFallbackMatchesChatbotFallbackKey =
  Expect<Equal<NonNullable<TsChatMessage['avatarFallback']>, NonNullable<TsChatbotSchema['userAvatarFallback']>>>;

// ⛔ No index signature (objectui#5155): `keyof ChatMessage` must stay a union
// of literal names. `[key: string]: any` would make `string extends keyof T`
// true — and would make every pin above vacuous, since an undeclared key would
// resolve to `any` instead of failing to compile.
export type _ChatMessageHasNoIndexSignature = Expect<Equal<HasKey<TsChatMessage, string>, false>>;
// The control key is NOT declared. Declaring it turns this red — which is the point.
export type _ControlKeyIsUndeclared = Expect<Equal<HasKey<TsChatMessage, typeof CONTROL_KEY>, false>>;

// The TS face accepts the declared spelling on a literal — the exact shape the
// doc page's `supportChat` / `salesBot` / `multiAgentChat` examples author.
const literal: TsChatMessage = { ...MESSAGE, avatar: LEGAL.avatar, avatarFallback: LEGAL.avatarFallback };
// …and, with no index signature to absorb it, REFUSES the control key on a
// literal (TS2353). This directive goes unused — and the type-check goes red
// with TS2578 — the moment an index signature is added or the control key is
// declared.
// @ts-expect-error — `avatarUrl` is not a member of `ChatMessage` and nothing reads it
const controlLiteral: TsChatMessage = { id: '2', role: 'user', content: 'x', avatarUrl: LEGAL.avatar };

/* ── Off-disk derivations ─────────────────────────────────────────────────── */

/** Every `message.KEY` read in the renderer, off disk. */
function messageReads(): Set<string> {
  const src = readFileSync(join(REPO_ROOT, READER), 'utf8');
  return new Set([...src.matchAll(/\bmessage\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
}

function shapeKeys(): string[] {
  return Object.keys((ChatMessageSchema as unknown as { shape: Record<string, unknown> }).shape);
}

interface Issue {
  path?: readonly (string | number)[];
  /** zod 4 `invalid_union`: the issues of every option that was tried. */
  errors?: readonly (readonly Issue[])[];
}

/**
 * Every issue path, with the nested option errors of an `invalid_union`
 * flattened in: `AnyComponentSchema` is a plain `z.union`, so a refusal inside
 * the `chatbot` arm surfaces as one root `invalid_union` issue whose `errors`
 * carry the per-arm paths.
 */
function issuePaths(issues: readonly Issue[], prefix: readonly (string | number)[] = []): string[] {
  const out: string[] = [];
  for (const issue of issues) {
    const path = [...prefix, ...(issue.path ?? [])];
    out.push(path.join('.'));
    for (const nested of issue.errors ?? []) out.push(...issuePaths(nested, path));
  }
  return out;
}

/* ── The reads ────────────────────────────────────────────────────────────── */

describe('objectui#7295 — the renderer reads `avatar` and `avatarFallback`, which is the fact the declarations record', () => {
  it('the batch is exactly the two keys a human author writes on a message', () => {
    // Non-vacuity for every per-key assertion below, and the card's own bound:
    // the three render-only keys API mode lifts out of the stream belong to
    // `RuntimeOnlyMessageKeys` (objectui#4424), not here.
    expect(KEYS).toHaveLength(2);
  });

  it.each(KEYS)('`%s` is still read, as the exact text the docblocks cite', (key) => {
    const src = readFileSync(join(REPO_ROOT, READER), 'utf8');
    for (const text of READ_TEXT[key]) {
      expect(src, `${READER} no longer reads \`message.${key}\` as \`${text}\``).toContain(text);
    }
  });

  it('the read set, derived from the renderer, contains both keys and NOT the control key', () => {
    // Non-vacuity for the control: if the plugin ever starts reading
    // `avatarUrl`, this turns red and the control must be re-chosen, not
    // declared on the way past.
    const reads = messageReads();
    for (const key of KEYS) expect(reads.has(key), `renderer no longer reads message.${key}`).toBe(true);
    expect(reads.has(CONTROL_KEY)).toBe(false);
  });

  it('the seam still spreads unlisted authored keys through to the renderer', () => {
    const src = readFileSync(join(REPO_ROOT, SEAM), 'utf8');
    expect(src, `${SEAM} no longer carries the authored message through \`...passthrough\``).toContain(SEAM_TEXT);
  });
});

/* ── The zod mirror ───────────────────────────────────────────────────────── */

describe('objectui#7295 — the zod mirror declares both keys', () => {
  it.each(KEYS)('`%s` is a member of the mirror shape', (key) => {
    // Membership is read off `.shape`, never off acceptance: under strip mode
    // acceptance cannot tell "declared" from "admitted-and-dropped".
    expect(shapeKeys()).toContain(key);
  });

  it.each(KEYS)('`%s`: accepts the declared value and the value SURVIVES the parse (it was stripped before)', (key) => {
    const r = ChatMessageSchema.safeParse({ ...MESSAGE, [key]: LEGAL[key] });
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
    if (r.success) expect((r.data as Record<string, unknown>)[key]).toBe(LEGAL[key]);
  });

  it.each(KEYS)('`%s`: …through `ChatbotSchema.messages`, the array an author actually writes', (key) => {
    const r = ChatbotSchema.safeParse(chatbotNode({ ...MESSAGE, [key]: LEGAL[key] }));
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
    if (r.success) {
      const messages = (r.data as { messages: Record<string, unknown>[] }).messages;
      expect(messages[0][key]).toBe(LEGAL[key]);
    }
  });

  it.each(KEYS)('`%s`: …and through the published union entry point, so the `chatbot` arm is the one reached', (key) => {
    const r = safeValidateSchema(chatbotNode({ ...MESSAGE, [key]: LEGAL[key] }));
    expect(r.success, r.success ? '' : JSON.stringify(r.error.issues)).toBe(true);
    if (r.success) {
      const messages = (r.data as { messages: Record<string, unknown>[] }).messages;
      expect(messages[0][key]).toBe(LEGAL[key]);
    }
  });

  it.each(KEYS)('`%s`: refuses a wrong-typed value AT the key — the enforcement mirroring adds', (key) => {
    // Before this card `avatar: 42` parsed green and was silently dropped.
    // This is the one verdict that moves toward refusal.
    const r = ChatMessageSchema.safeParse({ ...MESSAGE, [key]: 42 });
    expect(r.success).toBe(false);
    if (!r.success) expect(issuePaths(r.error.issues as readonly Issue[])).toContain(key);
  });

  it.each(KEYS)('`%s`: …and the refusal names the message inside the node through the entry point', (key) => {
    const r = safeValidateSchema(chatbotNode({ ...MESSAGE, [key]: 42 }));
    expect(r.success).toBe(false);
    if (!r.success) expect(issuePaths(r.error.issues as readonly Issue[])).toContain(`messages.0.${key}`);
  });

  it('control: the declared-keys-only message parses green, before and after', () => {
    expect(ChatMessageSchema.safeParse(MESSAGE).success).toBe(true);
    expect(safeValidateSchema(chatbotNode({ ...MESSAGE })).success).toBe(true);
  });
});

/* ── The control key ──────────────────────────────────────────────────────── */

describe('objectui#7295 — the control key stays undeclared, so nothing outside the two keys moved', () => {
  it('is ABSENT from the mirror shape', () => {
    expect(shapeKeys()).not.toContain(CONTROL_KEY);
  });

  it('the SAME wrong-typed value under the control key is still admitted-and-STRIPPED', () => {
    // The before-state of `avatar`, kept on purpose on a key that is not read:
    // the mirror is strip mode, so an undeclared key of any type parses green
    // and does NOT survive. This is the proof the mirror's unknown-key policy is
    // byte-for-byte what it was — neither `.passthrough()` nor `.strict()` was
    // reached for on the way past.
    const r = ChatMessageSchema.safeParse({ ...MESSAGE, [CONTROL_KEY]: 42 });
    expect(r.success).toBe(true);
    if (r.success) expect(CONTROL_KEY in (r.data as Record<string, unknown>)).toBe(false);
  });

  it('the type-level bindings above are referenced, so lint keeps them', () => {
    expect(literal.avatar).toBe(LEGAL.avatar);
    expect(literal.avatarFallback).toBe(LEGAL.avatarFallback);
    expect(controlLiteral.id).toBe('2');
  });
});

/* ── The doc page — the gate hole PR #7294 left ───────────────────────────── */

describe('objectui#7295 — the three example blocks PR #7294 left unannotated are annotated `ChatbotSchema` again', () => {
  const src = readFileSync(join(REPO_ROOT, DOC), 'utf8');

  it.each(['supportChat', 'salesBot', 'multiAgentChat'])('`%s` is annotated', (name) => {
    expect(src).toContain(`const ${name}: ChatbotSchema = {`);
    expect(src).not.toContain(`const ${name} = {`);
  });

  it('those blocks still document the five per-message `avatarFallback` overrides the card counted', () => {
    // The card measured exactly five TS2353 diagnostics — one per documented
    // per-message avatar — across the three blocks. If a block stops
    // documenting the override, the annotation is no longer exercising the
    // declaration and this count says so.
    const start = src.indexOf('const supportChat: ChatbotSchema = {');
    const end = src.indexOf('## Custom Avatars', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const blocks = src.slice(start, end);
    expect(blocks.match(/^\s+avatarFallback: '/gm)).toHaveLength(5);
  });
});
