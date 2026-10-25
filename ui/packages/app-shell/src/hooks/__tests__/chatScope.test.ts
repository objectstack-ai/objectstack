// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  chatConversationScope,
  chatProductOfAgent,
  type ChatProduct,
} from '../chatScope';

describe('chatProductOfAgent (ADR-0063 binding axis)', () => {
  it('maps the authoring agent (and its legacy alias) to `build`', () => {
    expect(chatProductOfAgent('build')).toBe('build');
    expect(chatProductOfAgent('metadata_assistant')).toBe('build');
  });

  it('maps the data agent (and its legacy alias) to `ask`', () => {
    expect(chatProductOfAgent('ask')).toBe('ask');
    expect(chatProductOfAgent('data_chat')).toBe('ask');
  });

  it('treats an unknown/custom agent as `ask` (never a third product)', () => {
    expect(chatProductOfAgent('support_bot')).toBe('ask');
  });

  it('treats an unresolved (undefined) agent as `ask`', () => {
    expect(chatProductOfAgent(undefined)).toBe('ask');
  });
});

describe('chatConversationScope (ADR-0057 `(app, product)` key)', () => {
  it('keys on app + product when an app id is known', () => {
    expect(chatConversationScope({ appId: 'app.acme.crm', product: 'build' })).toBe(
      'app:app.acme.crm:build',
    );
    expect(chatConversationScope({ appId: 'app.acme.crm', product: 'ask' })).toBe(
      'app:app.acme.crm:ask',
    );
  });

  it('degrades to the product alone when no app id is known', () => {
    expect(chatConversationScope({ product: 'build' })).toBe('build');
    expect(chatConversationScope({ product: 'ask' })).toBe('ask');
    expect(chatConversationScope({ appId: undefined, product: 'ask' })).toBe('ask');
  });

  it('separates threads per app and per product', () => {
    const keys = new Set([
      chatConversationScope({ appId: 'app.a', product: 'build' }),
      chatConversationScope({ appId: 'app.a', product: 'ask' }),
      chatConversationScope({ appId: 'app.b', product: 'build' }),
    ]);
    expect(keys.size).toBe(3);
  });

  it('UNIFIES the Studio copilot and the full-page focus view for one app+product', () => {
    // The forked-conversation bug this ADR fixes: the Studio design copilot
    // (packageId = X, build) and the full-page `/ai/build?package=X` focus view
    // (editPackageId = X, build) must resolve to the SAME conversation key.
    const packageId = 'app.acme.crm';
    const product: ChatProduct = chatProductOfAgent('build');
    const studioScope = chatConversationScope({ appId: packageId, product });
    const focusScope = chatConversationScope({ appId: packageId, product });
    expect(studioScope).toBe(focusScope);
    expect(studioScope).toBe('app:app.acme.crm:build');
  });

  it('no longer carries the legacy `studio:` surface prefix', () => {
    const scope = chatConversationScope({ appId: 'app.acme.crm', product: 'build' });
    expect(scope.startsWith('studio:')).toBe(false);
  });
});
