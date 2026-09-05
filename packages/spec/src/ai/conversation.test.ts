import { describe, it, expect } from 'vitest';
import {
  MessageRoleSchema,
  MessageContentTypeSchema,
  MessageContentSchema,
  FunctionCallSchema,
  ToolCallSchema,
  ConversationMessageSchema,
  TokenBudgetStrategySchema,
  TokenBudgetConfigSchema,
  TokenUsageStatsSchema,
  ConversationContextSchema,
  ConversationSessionSchema,
  ConversationSummarySchema,
  MessagePruningEventSchema,
  ConversationAnalyticsSchema,
  type ConversationMessage,
  type ConversationSession,
  type TokenBudgetConfig,
} from './conversation.zod';

describe('MessageRoleSchema', () => {
  it('should accept all valid roles', () => {
    const roles = ['system', 'user', 'assistant', 'function', 'tool'] as const;
    
    roles.forEach(role => {
      expect(() => MessageRoleSchema.parse(role)).not.toThrow();
    });
  });

  it('should reject invalid roles', () => {
    expect(() => MessageRoleSchema.parse('invalid')).toThrow();
  });
});

describe('MessageContentTypeSchema', () => {
  it('should accept all valid content types', () => {
    const types = ['text', 'image', 'file', 'code', 'structured'] as const;
    
    types.forEach(type => {
      expect(() => MessageContentTypeSchema.parse(type)).not.toThrow();
    });
  });
});

describe('MessageContentSchema', () => {
  it('should accept text content', () => {
    const content = {
      type: 'text',
      text: 'Hello world',
    };
    expect(() => MessageContentSchema.parse(content)).not.toThrow();
  });

  it('should accept image content', () => {
    const content = {
      type: 'image',
      imageUrl: 'https://example.com/image.png',
      mimeType: 'image/png',
    };
    expect(() => MessageContentSchema.parse(content)).not.toThrow();
  });
});

describe('ConversationMessageSchema', () => {
  it('should accept minimal message', () => {
    const message = {
      id: 'msg-1',
      timestamp: '2024-01-15T10:00:00Z',
      role: 'user',
      content: [{ type: 'text', text: 'Hello, how are you?' }],
    };
    expect(() => ConversationMessageSchema.parse(message)).not.toThrow();
  });

  it('should accept message with multimodal content', () => {
    const message = {
      id: 'msg-2',
      timestamp: '2024-01-15T10:01:00Z',
      role: 'user',
      content: [
        { type: 'text', text: 'What is in this image?' },
        { type: 'image', imageUrl: 'https://example.com/photo.jpg' },
      ],
    };
    expect(() => ConversationMessageSchema.parse(message)).not.toThrow();
  });

  it('should accept assistant message with token stats', () => {
    const message = {
      id: 'msg-3',
      timestamp: '2024-01-15T10:02:00Z',
      role: 'assistant',
      content: [{ type: 'text', text: 'I am doing well, thank you!' }],
      tokens: {
        promptTokens: 15,
        completionTokens: 8,
        totalTokens: 23,
      },
    };
    expect(() => ConversationMessageSchema.parse(message)).not.toThrow();
  });

  it('should accept message with tool calls', () => {
    const message = {
      id: 'msg-4',
      timestamp: '2024-01-15T10:03:00Z',
      role: 'assistant',
      content: [],
      toolCalls: [
        {
          id: 'call-1',
          type: 'function',
          function: {
            name: 'get_weather',
            arguments: '{"location": "San Francisco"}',
          },
        },
      ],
    };
    expect(() => ConversationMessageSchema.parse(message)).not.toThrow();
  });

  it('should accept pinned message with importance', () => {
    const message = {
      id: 'msg-5',
      timestamp: '2024-01-15T10:04:00Z',
      role: 'system',
      content: [{ type: 'text', text: 'You are a helpful assistant.' }],
      pinned: true,
      importance: 1.0,
    };
    const result = ConversationMessageSchema.parse(message);
    expect(result.pinned).toBe(true);
    expect(result.importance).toBe(1.0);
  });

  it('should accept message with embedding', () => {
    const message = {
      id: 'msg-6',
      timestamp: '2024-01-15T10:05:00Z',
      role: 'user',
      content: [{ type: 'text', text: 'Important information' }],
      embedding: [0.1, 0.2, 0.3, 0.4, 0.5],
    };
    expect(() => ConversationMessageSchema.parse(message)).not.toThrow();
  });
});

describe('TokenBudgetStrategySchema', () => {
  it('should accept all valid strategies', () => {
    const strategies = ['fifo', 'importance', 'semantic', 'sliding_window', 'summary'] as const;
    
    strategies.forEach(strategy => {
      expect(() => TokenBudgetStrategySchema.parse(strategy)).not.toThrow();
    });
  });
});

describe('TokenBudgetConfigSchema', () => {
  it('should accept minimal budget config', () => {
    const config: TokenBudgetConfig = {
      maxTokens: 4096,
    };
    const result = TokenBudgetConfigSchema.parse(config);
    expect(result.strategy).toBe('sliding_window');
    expect(result.reserveTokens).toBe(500);
    expect(result.bufferPercentage).toBe(0.1);
  });

  it('should accept full budget config with sliding window', () => {
    const config: TokenBudgetConfig = {
      maxTokens: 8192,
      maxPromptTokens: 6144,
      maxCompletionTokens: 2048,
      reserveTokens: 1000,
      bufferPercentage: 0.15,
      strategy: 'sliding_window',
      slidingWindowSize: 10,
      enableSummarization: false,
    };
    expect(() => TokenBudgetConfigSchema.parse(config)).not.toThrow();
  });

  it('should accept importance-based strategy', () => {
    const config: TokenBudgetConfig = {
      maxTokens: 4096,
      strategy: 'importance',
      minImportanceScore: 0.3,
    };
    expect(() => TokenBudgetConfigSchema.parse(config)).not.toThrow();
  });

  it('should accept semantic strategy', () => {
    const config: TokenBudgetConfig = {
      maxTokens: 4096,
      strategy: 'semantic',
      semanticThreshold: 0.75,
    };
    expect(() => TokenBudgetConfigSchema.parse(config)).not.toThrow();
  });

  it('should accept summarization config', () => {
    const config: TokenBudgetConfig = {
      maxTokens: 16000,
      strategy: 'summary',
      enableSummarization: true,
      summarizationThreshold: 12000,
      summaryModel: 'gpt-3.5-turbo',
    };
    expect(() => TokenBudgetConfigSchema.parse(config)).not.toThrow();
  });
});

describe('TokenUsageStatsSchema', () => {
  it('should accept valid usage stats', () => {
    const stats = {
      promptTokens: 1500,
      completionTokens: 800,
      totalTokens: 2300,
      budgetLimit: 4096,
      budgetUsed: 2300,
      budgetRemaining: 1796,
      budgetPercentage: 0.56,
      messageCount: 10,
      prunedMessageCount: 2,
      summarizedMessageCount: 0,
    };
    expect(() => TokenUsageStatsSchema.parse(stats)).not.toThrow();
  });

  it('should default to zero for optional counts', () => {
    const stats = {
      budgetLimit: 4096,
      budgetRemaining: 4096,
      budgetPercentage: 0,
    };
    const result = TokenUsageStatsSchema.parse(stats);
    expect(result.promptTokens).toBe(0);
    expect(result.completionTokens).toBe(0);
    expect(result.totalTokens).toBe(0);
  });
});

describe('ConversationContextSchema', () => {
  it('should accept minimal context', () => {
    const context = {
      sessionId: 'session-123',
    };
    expect(() => ConversationContextSchema.parse(context)).not.toThrow();
  });

  it('should accept full context', () => {
    const context = {
      sessionId: 'session-123',
      userId: 'user-456',
      agentId: 'support_agent',
      object: 'case',
      recordId: 'case-789',
      scope: {
        department: 'support',
        priority: 'high',
      },
      systemMessage: 'You are a helpful customer support agent.',
      metadata: {
        source: 'web',
      },
    };
    expect(() => ConversationContextSchema.parse(context)).not.toThrow();
  });
});

describe('ConversationSessionSchema', () => {
  it('should accept minimal session', () => {
    const session = {
      id: 'session-1',
      context: {
        sessionId: 'session-1',
      },
      tokenBudget: {
        maxTokens: 4096,
      },
      createdAt: '2024-01-15T10:00:00Z',
      updatedAt: '2024-01-15T10:00:00Z',
    };
    const result = ConversationSessionSchema.parse(session);
    expect(result.status).toBe('active');
    expect(result.messages).toEqual([]);
  });

  it('should accept full session with messages', () => {
    const session = {
      id: 'session-1',
      name: 'Support Chat - Case #123',
      context: {
        sessionId: 'session-1',
        userId: 'user-1',
        agentId: 'support_agent',
        object: 'case',
        recordId: 'case-123',
        systemMessage: 'You are a support agent.',
      },
      modelId: 'gpt-4-turbo',
      tokenBudget: {
        maxTokens: 8192,
        strategy: 'sliding_window' as const,
        slidingWindowSize: 20,
        enableSummarization: true,
      },
      messages: [
        {
          id: 'msg-1',
          timestamp: '2024-01-15T10:00:00Z',
          role: 'user',
          content: [{ type: 'text', text: 'I need help with my order' }],
        },
        {
          id: 'msg-2',
          timestamp: '2024-01-15T10:01:00Z',
          role: 'assistant',
          content: [{ type: 'text', text: 'I\'d be happy to help! What\'s your order number?' }],
        },
      ],
      tokens: {
        promptTokens: 150,
        completionTokens: 80,
        totalTokens: 230,
        budgetLimit: 8192,
        budgetUsed: 230,
        budgetRemaining: 7962,
        budgetPercentage: 0.028,
        messageCount: 2,
        prunedMessageCount: 0,
        summarizedMessageCount: 0,
      },
      status: 'active',
      createdAt: '2024-01-15T10:00:00Z',
      updatedAt: '2024-01-15T10:01:00Z',
      tags: ['support', 'order-inquiry'],
      metadata: {
        priority: 'normal',
      },
    };
    expect(() => ConversationSessionSchema.parse(session)).not.toThrow();
  });

  it('should accept session with expiry', () => {
    const session = {
      id: 'session-1',
      context: {
        sessionId: 'session-1',
      },
      tokenBudget: {
        maxTokens: 4096,
      },
      createdAt: '2024-01-15T10:00:00Z',
      updatedAt: '2024-01-15T10:00:00Z',
      expiresAt: '2024-01-16T10:00:00Z',
    };
    expect(() => ConversationSessionSchema.parse(session)).not.toThrow();
  });
});

describe('ConversationSummarySchema', () => {
  it('should accept valid summary', () => {
    const summary = {
      summary: 'User asked about order status. Agent provided tracking information.',
      keyPoints: [
        'Order number: 12345',
        'Tracking provided',
        'Expected delivery: Jan 20',
      ],
      originalTokens: 1500,
      summaryTokens: 150,
      tokensSaved: 1350,
      messageRange: {
        startIndex: 0,
        endIndex: 10,
      },
      generatedAt: '2024-01-15T11:00:00Z',
      modelId: 'gpt-3.5-turbo',
    };
    expect(() => ConversationSummarySchema.parse(summary)).not.toThrow();
  });
});

describe('MessagePruningEventSchema', () => {
  it('should accept valid pruning event', () => {
    const event = {
      timestamp: '2024-01-15T10:30:00Z',
      strategy: 'fifo' as const,
      reason: 'Token budget exceeded',
      prunedMessages: [
        {
          messageId: 'msg-1',
          role: 'user' as const,
          tokens: 50,
        },
        {
          messageId: 'msg-2',
          role: 'assistant' as const,
          tokens: 75,
          importance: 0.3,
        },
      ],
      tokensFreed: 125,
      messagesRemoved: 2,
      remainingTokens: 3500,
      remainingMessages: 15,
    };
    expect(() => MessagePruningEventSchema.parse(event)).not.toThrow();
  });
});

describe('ConversationAnalyticsSchema', () => {
  it('should accept full analytics', () => {
    const analytics = {
      sessionId: 'session-1',
      totalMessages: 50,
      userMessages: 25,
      assistantMessages: 23,
      systemMessages: 2,
      totalTokens: 5000,
      averageTokensPerMessage: 100,
      peakTokenUsage: 4500,
      pruningEvents: 3,
      summarizationEvents: 1,
      tokensSavedByPruning: 500,
      tokensSavedBySummarization: 2000,
      durationSeconds: 1800,
      firstMessageAt: '2024-01-15T10:00:00Z',
      lastMessageAt: '2024-01-15T10:30:00Z',
    };
    expect(() => ConversationAnalyticsSchema.parse(analytics)).not.toThrow();
  });

  it('should default efficiency metrics to zero', () => {
    const analytics = {
      sessionId: 'session-1',
      totalMessages: 10,
      userMessages: 5,
      assistantMessages: 5,
      systemMessages: 0,
      totalTokens: 1000,
      averageTokensPerMessage: 100,
      peakTokenUsage: 1000,
    };
    const result = ConversationAnalyticsSchema.parse(analytics);
    expect(result.pruningEvents).toBe(0);
    expect(result.summarizationEvents).toBe(0);
    expect(result.tokensSavedByPruning).toBe(0);
    expect(result.tokensSavedBySummarization).toBe(0);
  });
});

describe('Real-World Conversation Examples', () => {
  it('should accept long customer support conversation', () => {
    const session: ConversationSession = {
      id: 'support-session-789',
      name: 'Customer Support - Order Issue',
      context: {
        sessionId: 'support-session-789',
        userId: 'customer-456',
        agentId: 'support_bot',
        object: 'case',
        recordId: 'case-12345',
        systemMessage: 'You are a helpful customer support agent specialized in order management.',
      },
      modelId: 'gpt-4-turbo',
      tokenBudget: {
        maxTokens: 16000,
        maxPromptTokens: 12000,
        maxCompletionTokens: 4000,
        reserveTokens: 1000,
        bufferPercentage: 0.1,
        strategy: 'sliding_window',
        slidingWindowSize: 30,
        enableSummarization: true,
        summarizationThreshold: 12000,
        summaryModel: 'gpt-3.5-turbo',
        warnThreshold: 0.85,
      },
      messages: [
        {
          id: 'msg-system',
          timestamp: '2024-01-15T09:00:00Z',
          role: 'system',
          content: [{ type: 'text', text: 'You are a helpful customer support agent specialized in order management.' }],
          pinned: true,
          importance: 1.0,
        },
        {
          id: 'msg-1',
          timestamp: '2024-01-15T09:00:05Z',
          role: 'user',
          content: [{ type: 'text', text: 'Hi, I have an issue with my order #ORD-2024-001' }],
          tokens: { promptTokens: 15, completionTokens: 0, totalTokens: 15 },
        },
        {
          id: 'msg-2',
          timestamp: '2024-01-15T09:00:15Z',
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello! I\'d be happy to help you with your order. Let me look up the details for order #ORD-2024-001.' }],
          tokens: { promptTokens: 30, completionTokens: 25, totalTokens: 55 },
        },
      ],
      tokens: {
        promptTokens: 45,
        completionTokens: 25,
        totalTokens: 70,
        budgetLimit: 16000,
        budgetUsed: 70,
        budgetRemaining: 15930,
        budgetPercentage: 0.0044,
        messageCount: 3,
        prunedMessageCount: 0,
        summarizedMessageCount: 0,
      },
      status: 'active',
      createdAt: '2024-01-15T09:00:00Z',
      updatedAt: '2024-01-15T09:00:15Z',
      tags: ['support', 'order-issue', 'high-priority'],
      metadata: {
        priority: 'high',
        category: 'order_management',
        language: 'en',
      },
    };
    
    expect(() => ConversationSessionSchema.parse(session)).not.toThrow();
  });

  it('should accept code generation conversation with tool calls', () => {
    const session: ConversationSession = {
      id: 'code-session-123',
      name: 'Code Generation Assistant',
      context: {
        sessionId: 'code-session-123',
        userId: 'dev-789',
        agentId: 'code_generator',
        systemMessage: 'You are an expert software engineer.',
      },
      modelId: 'gpt-4-turbo',
      tokenBudget: {
        maxTokens: 8192,
        strategy: 'importance',
        minImportanceScore: 0.4,
      },
      messages: [
        {
          id: 'msg-1',
          timestamp: '2024-01-15T14:00:00Z',
          role: 'user',
          content: [{ type: 'text', text: 'Write a Python function to calculate fibonacci numbers' }],
          importance: 0.9,
        },
        {
          id: 'msg-2',
          timestamp: '2024-01-15T14:00:10Z',
          role: 'assistant',
          content: [],
          toolCalls: [
            {
              id: 'call-1',
              type: 'function',
              function: {
                name: 'generate_code',
                arguments: '{"language": "python", "task": "fibonacci"}',
                result: 'def fibonacci(n):\n    if n <= 1:\n        return n\n    return fibonacci(n-1) + fibonacci(n-2)',
              },
            },
          ],
          importance: 0.8,
        },
      ],
      status: 'active',
      createdAt: '2024-01-15T14:00:00Z',
      updatedAt: '2024-01-15T14:00:10Z',
      tags: ['code-generation', 'python'],
    };
    
    expect(() => ConversationSessionSchema.parse(session)).not.toThrow();
  });
});
