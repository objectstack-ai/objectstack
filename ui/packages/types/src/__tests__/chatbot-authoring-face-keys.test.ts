/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ChatbotSchema` declares the `chatbot` node's local-display and legacy
 * auto-response keys by name (objectui#6169, the #6172 family ruling: every
 * component node has exactly one named, importable authoring-face type).
 *
 * Before this file, `showTimestamp`, `userAvatarUrl`, `userAvatarFallback`,
 * `assistantAvatarUrl`, `assistantAvatarFallback`, `maxHeight`,
 * `autoResponse`, `autoResponseText`, `autoResponseDelay` and `onSend` lived
 * ONLY in an anonymous inline intersection at
 * `packages/plugin-chatbot/src/renderer.tsx`'s `chatbot` registration site —
 * nothing outside that one file could reference, validate, or document them.
 * Each was read-site-censused before being declared here (renderer.tsx and/or
 * `useObjectChat.ts` read every one); none were dead, so none took the
 * ADR-0049 route.
 *
 * `disabled` — also in the original intersection — is deliberately NOT
 * redeclared: it is already `BaseSchema.disabled` (`boolean | string`), read
 * generically by `SchemaRenderer` for every node type. Redeclaring it here as
 * `boolean` only would have narrowed away the expression-string half of an
 * inherited field for no reason; the last `it` below pins that it stays wide.
 *
 * ## Why the TS half is real enforcement, not decoration
 *
 * `BaseSchema` carried `[key: string]: any` (objectui#5155) until
 * objectui#8347. Before this
 * change, `autoResponseDelay: 'not-a-number'` on a `ChatbotSchema`-typed
 * object type-checked FINE — the index signature swallowed the unlisted key
 * as `any`. Declaring the field with its real type is what makes a wrong
 * value refusable at the type level; the `@ts-expect-error` below is checked
 * by `tsc -p tsconfig.test.json` (this package's `type-check` script chains
 * it), so a regression that widens the field back toward `any` — or deletes
 * it, letting the index signature re-absorb it — fails the build on the
 * now-unused directive. A green test RUN cannot show this; only a green
 * type-check can (AGENTS.md: "A green type-check is the proof a tombstone
 * bites; a green test run is not" — the same instrument, applied to a
 * declaration rather than a retirement).
 *
 * ## Why the Zod half is real enforcement, not decoration
 *
 * `BaseSchema`'s Zod mirror is `.passthrough()`, inherited through
 * `.extend()`. Before this change `ChatbotSchema.safeParse({ ...,
 * autoResponseDelay: 'not-a-number' })` returned `success: true` — an
 * undeclared key rides through passthrough UNVALIDATED, wrong type and all.
 * Mirroring the field is what turns that into a refusal.
 */

import { describe, it, expect } from 'vitest';
import type { ChatbotSchema, ChatMessage } from '../complex';
import { ChatbotSchema as ChatbotZodSchema } from '../zod/complex.zod';

const baseMessages: ChatMessage[] = [
  { id: '1', role: 'user', content: 'hi' },
];

describe('ChatbotSchema: the ten local-display/legacy keys are declared, not anonymous (objectui#6169)', () => {
  it('accepts every key at its declared type on the TypeScript interface', () => {
    const onSend: ChatbotSchema['onSend'] = (content, messages) => {
      expect(typeof content).toBe('string');
      expect(Array.isArray(messages)).toBe(true);
    };

    const node: ChatbotSchema = {
      type: 'chatbot',
      messages: baseMessages,
      showTimestamp: true,
      userAvatarUrl: 'https://example.com/user.png',
      userAvatarFallback: 'You',
      assistantAvatarUrl: 'https://example.com/assistant.png',
      assistantAvatarFallback: 'AI',
      maxHeight: '500px',
      autoResponse: true,
      autoResponseText: 'Thanks!',
      autoResponseDelay: 1000,
      onSend,
    };

    expect(node.showTimestamp).toBe(true);
    expect(node.autoResponseDelay).toBe(1000);
    node.onSend?.('hello', baseMessages);
  });

  it('refuses a wrong-typed value on a declared key — proof the field is no longer `any` via the index signature', () => {
    const node: ChatbotSchema = {
      type: 'chatbot',
      messages: baseMessages,
      // @ts-expect-error `autoResponseDelay` is declared `number`; before this
      // field was named, `[key: string]: any` on `BaseSchema` swallowed any
      // value at any unlisted key and this line type-checked.
      autoResponseDelay: 'not-a-number',
    };
    // Runtime shape is unaffected by the type-level assertion above.
    expect(node.type).toBe('chatbot');
  });

  it('keeps `disabled` inherited from BaseSchema (`boolean | string`), not redeclared narrower', () => {
    // `BaseSchema.disabled` accepts an expression STRING (evaluated by
    // `evaluator.evaluateCondition`), not just a boolean. If this key were
    // redeclared inside the new group as `boolean` only, this line would be
    // the one to catch it.
    const node: ChatbotSchema = {
      type: 'chatbot',
      messages: baseMessages,
      disabled: 'record.locked === true',
    };
    expect(node.disabled).toBe('record.locked === true');
  });

  it('accepts every key at its declared type through the Zod mirror', () => {
    const result = ChatbotZodSchema.safeParse({
      type: 'chatbot',
      messages: [{ id: '1', role: 'user', content: 'hi' }],
      showTimestamp: true,
      userAvatarUrl: 'https://example.com/user.png',
      userAvatarFallback: 'You',
      assistantAvatarUrl: 'https://example.com/assistant.png',
      assistantAvatarFallback: 'AI',
      maxHeight: '500px',
      autoResponse: true,
      autoResponseText: 'Thanks!',
      autoResponseDelay: 1000,
    });

    expect(result.success).toBe(true);
  });

  it('`onSend` is a RUNTIME SLOT the Zod mirror refuses by name; the TypeScript face above is its channel (objectui#6124)', () => {
    // `onSend: () => {}` used to sit in the green fixture above. objectui#6124
    // replaced every `on*: z.function()` arm with a named refusal: a JSON face
    // has no function value, and `plugin-chatbot` reads `schema.onSend` through
    // the TypeScript interface (which keeps the callable member — see the first
    // `it` in this file), never through `safeParse`.
    const result = ChatbotZodSchema.safeParse({
      type: 'chatbot',
      messages: [{ id: '1', role: 'user', content: 'hi' }],
      onSend: () => {},
    });
    expect(result.success).toBe(false);
    const issue = result.error?.issues.find((i) => String(i.path[0]) === 'onSend');
    expect(issue?.code).toBe('custom');
    expect(issue?.message).toContain('`onSend` is a RUNTIME SLOT');
  });

  it('refuses a wrong-typed value on a declared key through the Zod mirror (was silently passed through before)', () => {
    const result = ChatbotZodSchema.safeParse({
      type: 'chatbot',
      messages: [],
      autoResponseDelay: 'not-a-number',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some(
          (issue) => issue.path.join('.') === 'autoResponseDelay' && issue.code === 'invalid_type',
        ),
      ).toBe(true);
    }
  });

  it('lists all ten keys in the Zod mirror shape (mirrored, not merely passed through)', () => {
    const shapeKeys = Object.keys(ChatbotZodSchema.shape);
    for (const key of [
      'showTimestamp',
      'userAvatarUrl',
      'userAvatarFallback',
      'assistantAvatarUrl',
      'assistantAvatarFallback',
      'maxHeight',
      'autoResponse',
      'autoResponseText',
      'autoResponseDelay',
      'onSend',
    ]) {
      expect(shapeKeys).toContain(key);
    }
    // `disabled` DOES appear here too — `.extend()`'s `.shape` merges the
    // parent's fields into the child's, so BaseSchema's `disabled` shows up
    // without this file's `.extend({...})` call ever naming it. That merge is
    // exactly why it was correct not to re-declare `disabled` above: doing so
    // would have SHADOWED the inherited `boolean | string` entry with a
    // narrower one, rather than adding a new key.
    expect(shapeKeys).toContain('disabled');
  });
});
