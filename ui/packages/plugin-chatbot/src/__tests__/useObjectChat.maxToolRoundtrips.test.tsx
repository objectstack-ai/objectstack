/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#5605 — `maxToolRoundtrips` is RETIRED behind a tombstone (ADR-0049,
 * arm A of the seat ruling on the card).
 *
 * The key was declared on all three chat nodes, threaded by the renderer into
 * `useObjectChat`, and dropped there. Enforcing it was measured and is not
 * reachable from a chat node: the tool loop runs on the server agent inside ONE
 * streamed response (the hook gives `useChat` no client tool loop), `useChat`
 * has no numeric round-trip cap, and neither chat request schema in
 * `@objectstack/spec` carries a cap field. The platform's cap is the agent's
 * `planning.maxIterations`.
 *
 * So the key is refused BY NAME on every chat node, and the refusal points at
 * the agent. A tombstone rather than a deletion: `BaseSchema` is
 * `.passthrough()`, so a deleted arm would KEEP an authored value in silence.
 *
 * Driven through the published union entry point (`safeValidateSchema`), so the
 * arm under test is the one an authored document actually reaches. The root
 * vitest config aliases `@object-ui/types/zod` to the package SOURCE, so this
 * reads `packages/types/src` and never resolves through a `dist/`.
 */
import { describe, it, expect } from 'vitest';
import { safeValidateSchema } from '@object-ui/types/zod';
import type { UseObjectChatOptions } from '../useObjectChat';

const NODES = ['chatbot', 'chatbot-enhanced', 'chatbot-floating'] as const;

const doc = (type: (typeof NODES)[number], extra: Record<string, unknown> = {}) => ({
  type,
  messages: [{ id: 'm1', role: 'user', content: 'hi' }],
  api: '/api/v1/ai/agents/demo/chat',
  ...extra,
});

describe('maxToolRoundtrips is retired behind a tombstone on every chat node (objectui#5605)', () => {
  for (const type of NODES) {
    it(`${type}: an authored maxToolRoundtrips is refused at its own key, naming planning.maxIterations`, () => {
      const result = safeValidateSchema(doc(type, { maxToolRoundtrips: 1 }));

      expect(result.success).toBe(false);
      const issue = result.error?.issues.find((i) => i.path.join('.') === 'maxToolRoundtrips');
      expect(issue, JSON.stringify(result.error?.issues)).toBeDefined();
      // The tombstone's code: `z.never` reports `invalid_type` at the key.
      expect(issue?.code).toBe('invalid_type');
      // The remedy an author needs: where the cap actually lives.
      expect(issue?.message).toContain('planning.maxIterations');
    });

    it(`CONTROL ${type}: the same node without the key parses green`, () => {
      const result = safeValidateSchema(doc(type));
      expect(result.success, JSON.stringify(result.success ? [] : result.error.issues)).toBe(true);
    });
  }
});

describe('the chat hook no longer accepts the option (objectui#5605)', () => {
  it('UseObjectChatOptions has no maxToolRoundtrips (type-level; measured by type-check)', () => {
    // The assertion is the ANNOTATION: while the option is declared, its type
    // is `never` and `tsc -p tsconfig.test.json` refuses the `true` below. The
    // runtime `expect` only keeps the binding used; it cannot fail.
    const optionIsGone: 'maxToolRoundtrips' extends keyof UseObjectChatOptions ? never : true = true;
    expect(optionIsGone).toBe(true);
  });
});
