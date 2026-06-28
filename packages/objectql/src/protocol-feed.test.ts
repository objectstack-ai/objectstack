// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { ObjectQL } from './engine.js';
import type { IFeedService } from '@objectstack/spec/contracts';

/**
 * Mock IFeedService for testing feed route handlers.
 */
function createMockFeedService(): IFeedService {
  return {
    listFeed: vi.fn().mockResolvedValue({
      items: [{ id: 'feed_1', type: 'comment', body: 'Hello world', createdAt: '2026-01-01T00:00:00Z' }],
      total: 1,
      hasMore: false,
    }),
    createFeedItem: vi.fn().mockResolvedValue({
      id: 'feed_new',
      type: 'comment',
      body: 'New comment',
      createdAt: '2026-01-01T00:00:00Z',
    }),
    updateFeedItem: vi.fn().mockResolvedValue({
      id: 'feed_1',
      type: 'comment',
      body: 'Updated comment',
      createdAt: '2026-01-01T00:00:00Z',
    }),
    deleteFeedItem: vi.fn().mockResolvedValue(undefined),
    getFeedItem: vi.fn().mockResolvedValue({
      id: 'feed_1',
      type: 'comment',
      body: 'Hello world',
      createdAt: '2026-01-01T00:00:00Z',
    }),
    addReaction: vi.fn().mockResolvedValue([
      { emoji: '👍', users: ['current_user'], count: 1 },
    ]),
    removeReaction: vi.fn().mockResolvedValue([]),
    subscribe: vi.fn().mockResolvedValue({
      id: 'sub_1',
      object: 'account',
      recordId: 'rec_123',
      userId: 'current_user',
      events: ['all'],
      channels: ['in_app'],
    }),
    unsubscribe: vi.fn().mockResolvedValue(true),
    getSubscription: vi.fn().mockResolvedValue(null),
  };
}

describe('ObjectStackProtocolImplementation - Feed Operations', () => {
  let protocol: ObjectStackProtocolImplementation;
  let engine: ObjectQL;
  let feedService: IFeedService;

  beforeEach(() => {
    engine = new ObjectQL();
    feedService = createMockFeedService();
    protocol = new ObjectStackProtocolImplementation(engine, undefined, () => feedService);
  });

  // ==========================================
  // Discovery
  // ==========================================

  it('should show feed service as unavailable when not registered', async () => {
    const protocolNoFeed = new ObjectStackProtocolImplementation(engine);
    const discovery = await protocolNoFeed.getDiscovery();

    expect(discovery.services.feed).toBeDefined();
    expect(discovery.services.feed.enabled).toBe(false);
    expect(discovery.services.feed.status).toBe('unavailable');
  });

  it('should show feed service as available when registered', async () => {
    const mockServices = new Map<string, any>();
    mockServices.set('feed', {});
    const protocolWithFeed = new ObjectStackProtocolImplementation(engine, () => mockServices, () => feedService);
    const discovery = await protocolWithFeed.getDiscovery();

    expect(discovery.services.feed).toBeDefined();
    expect(discovery.services.feed.enabled).toBe(true);
    expect(discovery.services.feed.status).toBe('available');
  });

  // ==========================================
  // Feed CRUD
  // ==========================================

  it('listFeed should delegate to feedService.listFeed', async () => {
    const result = await protocol.listFeed({ object: 'account', recordId: 'rec_123' });

    expect(result.success).toBe(true);
    expect(result.data.items).toHaveLength(1);
    expect(feedService.listFeed).toHaveBeenCalledWith(
      expect.objectContaining({ object: 'account', recordId: 'rec_123' })
    );
  });

  it('createFeedItem should delegate to feedService.createFeedItem', async () => {
    const result = await protocol.createFeedItem({
      object: 'account',
      recordId: 'rec_123',
      type: 'comment',
      body: 'New comment',
    });

    expect(result.success).toBe(true);
    expect(result.data.id).toBe('feed_new');
    expect(feedService.createFeedItem).toHaveBeenCalledWith(
      expect.objectContaining({ object: 'account', recordId: 'rec_123', type: 'comment', body: 'New comment' })
    );
  });

  it('updateFeedItem should delegate to feedService.updateFeedItem', async () => {
    const result = await protocol.updateFeedItem({
      object: 'account',
      recordId: 'rec_123',
      feedId: 'feed_1',
      body: 'Updated',
    });

    expect(result.success).toBe(true);
    expect(result.data.body).toBe('Updated comment');
    expect(feedService.updateFeedItem).toHaveBeenCalledWith('feed_1', expect.objectContaining({ body: 'Updated' }));
  });

  it('deleteFeedItem should delegate to feedService.deleteFeedItem', async () => {
    const result = await protocol.deleteFeedItem({
      object: 'account',
      recordId: 'rec_123',
      feedId: 'feed_1',
    });

    expect(result.success).toBe(true);
    expect(result.data.feedId).toBe('feed_1');
    expect(feedService.deleteFeedItem).toHaveBeenCalledWith('feed_1');
  });

  // ==========================================
  // Reactions
  // ==========================================

  it('addReaction should delegate to feedService.addReaction', async () => {
    const result = await protocol.addReaction({
      object: 'account',
      recordId: 'rec_123',
      feedId: 'feed_1',
      emoji: '👍',
    });

    expect(result.success).toBe(true);
    expect(result.data.reactions).toHaveLength(1);
    expect(feedService.addReaction).toHaveBeenCalledWith('feed_1', '👍', 'current_user');
  });

  it('removeReaction should delegate to feedService.removeReaction', async () => {
    const result = await protocol.removeReaction({
      object: 'account',
      recordId: 'rec_123',
      feedId: 'feed_1',
      emoji: '👍',
    });

    expect(result.success).toBe(true);
    expect(result.data.reactions).toHaveLength(0);
    expect(feedService.removeReaction).toHaveBeenCalledWith('feed_1', '👍', 'current_user');
  });

  // ==========================================
  // Pin / Star
  // ==========================================

  it('pinFeedItem should verify item exists and return pinned status', async () => {
    const result = await protocol.pinFeedItem({
      object: 'account',
      recordId: 'rec_123',
      feedId: 'feed_1',
    });

    expect(result.success).toBe(true);
    expect(result.data.feedId).toBe('feed_1');
    expect(result.data.pinned).toBe(true);
    expect(result.data.pinnedAt).toBeDefined();
  });

  it('unpinFeedItem should verify item exists and return unpinned status', async () => {
    const result = await protocol.unpinFeedItem({
      object: 'account',
      recordId: 'rec_123',
      feedId: 'feed_1',
    });

    expect(result.success).toBe(true);
    expect(result.data.feedId).toBe('feed_1');
    expect(result.data.pinned).toBe(false);
  });

  it('starFeedItem should verify item exists and return starred status', async () => {
    const result = await protocol.starFeedItem({
      object: 'account',
      recordId: 'rec_123',
      feedId: 'feed_1',
    });

    expect(result.success).toBe(true);
    expect(result.data.feedId).toBe('feed_1');
    expect(result.data.starred).toBe(true);
    expect(result.data.starredAt).toBeDefined();
  });

  it('unstarFeedItem should verify item exists and return unstarred status', async () => {
    const result = await protocol.unstarFeedItem({
      object: 'account',
      recordId: 'rec_123',
      feedId: 'feed_1',
    });

    expect(result.success).toBe(true);
    expect(result.data.feedId).toBe('feed_1');
    expect(result.data.starred).toBe(false);
  });

  // ==========================================
  // Search & Changelog
  // ==========================================

  it('searchFeed should filter items by query text', async () => {
    const result = await protocol.searchFeed({
      object: 'account',
      recordId: 'rec_123',
      query: 'hello',
    });

    expect(result.success).toBe(true);
    expect(result.data.items).toHaveLength(1);
    expect(result.data.hasMore).toBe(false);
  });

  it('getChangelog should return field change entries', async () => {
    const result = await protocol.getChangelog({
      object: 'account',
      recordId: 'rec_123',
    });

    expect(result.success).toBe(true);
    expect(result.data.entries).toBeDefined();
    expect(feedService.listFeed).toHaveBeenCalledWith(
      expect.objectContaining({ filter: 'changes_only' })
    );
  });

  // ==========================================
  // Subscriptions
  // ==========================================

  it('feedSubscribe should delegate to feedService.subscribe', async () => {
    const result = await protocol.feedSubscribe({
      object: 'account',
      recordId: 'rec_123',
      events: ['all'],
      channels: ['in_app'],
    });

    expect(result.success).toBe(true);
    expect(result.data.object).toBe('account');
    expect(feedService.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ object: 'account', recordId: 'rec_123' })
    );
  });

  it('feedUnsubscribe should delegate to feedService.unsubscribe', async () => {
    const result = await protocol.feedUnsubscribe({
      object: 'account',
      recordId: 'rec_123',
    });

    expect(result.success).toBe(true);
    expect(result.data.unsubscribed).toBe(true);
    expect(feedService.unsubscribe).toHaveBeenCalledWith('account', 'rec_123', 'current_user');
  });

  // ==========================================
  // Error handling
  // ==========================================

  it('should throw when feed service is not available', async () => {
    const protocolNoFeed = new ObjectStackProtocolImplementation(engine);

    await expect(protocolNoFeed.listFeed({ object: 'a', recordId: 'b' }))
      .rejects.toThrow('Feed service not available');
  });

  it('pinFeedItem should throw when feed item not found', async () => {
    (feedService.getFeedItem as any).mockResolvedValue(null);

    await expect(protocol.pinFeedItem({ object: 'a', recordId: 'b', feedId: 'nonexistent' }))
      .rejects.toThrow('Feed item nonexistent not found');
  });
});
