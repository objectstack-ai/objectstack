/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#10109 — an INCREMENTAL edit stays an edit across a cache-fallback
 * reload.
 *
 * `apply_edit` answers `kind: 'edit'` and may list the `app` artifact it
 * re-staged in `drafted[]`; `apply_blueprint` carries no `kind`. The cache
 * does not keep the raw tool output: it re-mints a compact envelope from the
 * derived `DraftReview` (`sanitizeChatMessagesForCache`). If that envelope
 * drops the producer's `kind`, the reloaded edit reads as a whole-app build
 * to every reader that answers "whole-app?" — so the round trip must keep it.
 *
 * Driven through the real production path: live map → cache → JSON (as
 * localStorage does) → cache-fallback re-map. The envelope shapes are the
 * producer's declaration as recorded on objectui#10109; the producer lives
 * outside this repository.
 */
import { describe, it, expect } from 'vitest';
import {
  detectBuiltAppPackage,
  uiMessageToChatMessage,
} from '@object-ui/plugin-chatbot';
import { sanitizeChatMessagesForCache } from '../useChatConversation';

const liveMessage = (toolName: string, output: object) => ({
  id: 'a1',
  role: 'assistant' as const,
  parts: [
    { type: 'text', text: 'Done.' },
    {
      type: `tool-${toolName}`,
      toolCallId: 'tc-1',
      state: 'output-available' as const,
      input: {},
      output,
    },
  ],
});

/** Live render → cache → JSON round trip → the cached tool part's output. */
function cachedOutputOf(toolName: string, output: object) {
  const live = uiMessageToChatMessage(liveMessage(toolName, output));
  const persisted = JSON.parse(JSON.stringify(sanitizeChatMessagesForCache([live]))) as ReturnType<
    typeof sanitizeChatMessagesForCache
  >;
  const part = persisted[0]?.parts.find((p) => p.type === `tool-${toolName}`);
  return { persisted, output: part?.output };
}

describe('sanitizeChatMessagesForCache — the producer kind survives the cache round trip (objectui#10109)', () => {
  const editOutput = {
    status: 'drafted',
    kind: 'edit',
    packageId: 'app.k9',
    drafted: [
      { type: 'object', name: 'k9_invoice' },
      { type: 'app', name: 'k9_app' },
    ],
  };
  const blueprintOutput = {
    status: 'drafted',
    packageId: 'app.k9',
    drafted: [
      { type: 'app', name: 'k9_app' },
      { type: 'object', name: 'k9_task' },
    ],
  };

  it('a cached apply_edit keeps kind edit, so the reloaded edit is still not a built app', () => {
    const { persisted, output } = cachedOutputOf('apply_edit', editOutput);
    expect(output).toMatchObject({ status: 'drafted', kind: 'edit', packageId: 'app.k9' });
    expect(detectBuiltAppPackage(output)).toBeUndefined();

    const reloaded = uiMessageToChatMessage(persisted[0]);
    expect(reloaded.toolInvocations?.[0]?.draftReview).toMatchObject({ kind: 'edit', packageId: 'app.k9' });
    expect(reloaded.buildProgress).toBeUndefined();
  });

  it('control: a cached apply_blueprint build carries no kind and is still a built app', () => {
    const { persisted, output } = cachedOutputOf('apply_blueprint', blueprintOutput);
    expect(output).toMatchObject({ status: 'drafted', packageId: 'app.k9' });
    expect(output).not.toHaveProperty('kind');
    expect(detectBuiltAppPackage(output)).toBe('app.k9');

    const reloaded = uiMessageToChatMessage(persisted[0]);
    expect(reloaded.toolInvocations?.[0]?.draftReview).not.toHaveProperty('kind');
    expect(reloaded.buildProgress).toMatchObject({ phase: 'done', appLabel: 'K9 App' });
  });
});
