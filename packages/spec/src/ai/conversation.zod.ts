// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { TokenUsageSchema } from './usage.zod';

/**
 * AI Conversation Memory Protocol
 * 
 * Multi-turn AI conversations with token budget management.
 * Enables context preservation, conversation history, and token optimization.
 */

/**
 * Message Role
 */
import { lazySchema } from '../shared/lazy-schema';
export const MessageRoleSchema = lazySchema(() => z.enum([
  'system',
  'user',
  'assistant',
  'function',
  'tool',
]));

/**
 * Message Content Type
 */
export const MessageContentTypeSchema = lazySchema(() => z.enum([
  'text',
  'image',
  'file',
  'code',
  'structured',
]));

/**
 * Message Content - Discriminated Union
 */
export const TextContentSchema = lazySchema(() => z.object({
  type: z.literal('text'),
  text: z.string().describe('Text content'),
  metadata: z.record(z.string(), z.unknown()).optional(),
}));

export const ImageContentSchema = lazySchema(() => z.object({
  type: z.literal('image'),
  imageUrl: z.string().url().describe('Image URL'),
  detail: z.enum(['low', 'high', 'auto']).optional().default('auto'),
  metadata: z.record(z.string(), z.unknown()).optional(),
}));

export const FileContentSchema = lazySchema(() => z.object({
  type: z.literal('file'),
  fileUrl: z.string().url().describe('File attachment URL'),
  mimeType: z.string().describe('MIME type'),
  fileName: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}));

export const CodeContentSchema = lazySchema(() => z.object({
  type: z.literal('code'),
  text: z.string().describe('Code snippet'),
  language: z.string().optional().default('text'),
  metadata: z.record(z.string(), z.unknown()).optional(),
}));

export const MessageContentSchema = lazySchema(() => z.union([
  TextContentSchema,
  ImageContentSchema,
  FileContentSchema,
  CodeContentSchema
]));

/**
 * Function Call
 */
export const FunctionCallSchema = lazySchema(() => z.object({
  name: z.string().describe('Function name'),
  arguments: z.string().describe('JSON string of function arguments'),
  result: z.string().optional().describe('Function execution result'),
}));

/**
 * Tool Call
 */
export const ToolCallSchema = lazySchema(() => z.object({
  id: z.string().describe('Tool call ID'),
  type: z.enum(['function']).default('function'),
  function: FunctionCallSchema,
}));

/**
 * Conversation Message
 */
export const ConversationMessageSchema = lazySchema(() => z.object({
  /** Identity */
  id: z.string().describe('Unique message ID'),
  timestamp: z.string().datetime().describe('ISO 8601 timestamp'),
  
  /** Content */
  role: MessageRoleSchema,
  content: z.array(MessageContentSchema).describe('Message content (multimodal array)'),
  
  /** Function/Tool Calls */
  functionCall: FunctionCallSchema.optional().describe('Legacy function call'),
  toolCalls: z.array(ToolCallSchema).optional().describe('Tool calls'),
  toolCallId: z.string().optional().describe('Tool call ID this message responds to'),
  
  /** Metadata */
  name: z.string().optional().describe('Name of the function/user'),
  tokens: TokenUsageSchema.optional().describe('Token usage for this message'),
  cost: z.number().nonnegative().optional().describe('Cost for this message in USD'),
  
  /** Context Management */
  pinned: z.boolean().optional().default(false).describe('Prevent removal during pruning'),
  importance: z.number().min(0).max(1).optional().describe('Importance score for pruning'),
  embedding: z.array(z.number()).optional().describe('Vector embedding for semantic search'),
  
  /** Annotations */
  metadata: z.record(z.string(), z.unknown()).optional(),
}));

/**
 * Token Budget Strategy
 */
export const TokenBudgetStrategySchema = lazySchema(() => z.enum([
  'fifo',              // First-in-first-out (oldest messages dropped)
  'importance',        // Drop by importance score
  'semantic',          // Keep semantically relevant messages
  'sliding_window',    // Fixed window of recent messages
  'summary',           // Summarize old context
]));

/**
 * Token Budget Configuration
 */
export const TokenBudgetConfigSchema = lazySchema(() => z.object({
  /** Budget Limits */
  maxTokens: z.number().int().positive().describe('Maximum total tokens'),
  maxPromptTokens: z.number().int().positive().optional().describe('Max tokens for prompt'),
  maxCompletionTokens: z.number().int().positive().optional().describe('Max tokens for completion'),
  
  /** Buffer & Reserves */
  reserveTokens: z.number().int().nonnegative().default(500).describe('Reserve tokens for system messages'),
  bufferPercentage: z.number().min(0).max(1).default(0.1).describe('Buffer percentage (0.1 = 10%)'),
  
  /** Pruning Strategy */
  strategy: TokenBudgetStrategySchema.default('sliding_window'),
  
  /** Strategy-Specific Options */
  slidingWindowSize: z.number().int().positive().optional().describe('Number of recent messages to keep'),
  minImportanceScore: z.number().min(0).max(1).optional().describe('Minimum importance to keep'),
  semanticThreshold: z.number().min(0).max(1).optional().describe('Semantic similarity threshold'),
  
  /** Summarization */
  enableSummarization: z.boolean().default(false).describe('Enable context summarization'),
  summarizationThreshold: z.number().int().positive().optional().describe('Trigger summarization at N tokens'),
  summaryModel: z.string().optional().describe('Model ID for summarization'),
  
  /** Monitoring */
  warnThreshold: z.number().min(0).max(1).default(0.8).describe('Warn at % of budget (0.8 = 80%)'),
}));

/**
 * Token Usage Stats
 */
export const TokenUsageStatsSchema = lazySchema(() => z.object({
  promptTokens: z.number().int().nonnegative().default(0),
  completionTokens: z.number().int().nonnegative().default(0),
  totalTokens: z.number().int().nonnegative().default(0),
  
  /** Budget Status */
  budgetLimit: z.number().int().positive(),
  budgetUsed: z.number().int().nonnegative().default(0),
  budgetRemaining: z.number().int().nonnegative(),
  budgetPercentage: z.number().min(0).max(1).describe('Usage as percentage of budget'),
  
  /** Message Stats */
  messageCount: z.number().int().nonnegative().default(0),
  prunedMessageCount: z.number().int().nonnegative().default(0),
  summarizedMessageCount: z.number().int().nonnegative().default(0),
}));

/**
 * Conversation Context
 */
export const ConversationContextSchema = lazySchema(() => z.object({
  /** Identity */
  sessionId: z.string().describe('Conversation session ID'),
  userId: z.string().optional().describe('User identifier'),
  agentId: z.string().optional().describe('AI agent identifier'),
  
  /** Context Data */
  object: z.string().optional().describe('Related object (e.g., "case", "project")'),
  recordId: z.string().optional().describe('Related record ID'),
  scope: z.record(z.string(), z.unknown()).optional().describe('Additional context scope'),
  
  /** System Instructions */
  systemMessage: z.string().optional().describe('System prompt/instructions'),
  
  /** Metadata */
  metadata: z.record(z.string(), z.unknown()).optional(),
}));

/**
 * Conversation Session
 */
export const ConversationSessionSchema = lazySchema(() => z.object({
  /** Identity */
  id: z.string().describe('Unique session ID'),
  name: z.string().optional().describe('Session name/title'),
  
  /** Configuration */
  context: ConversationContextSchema,
  modelId: z.string().optional().describe('AI model ID'),
  tokenBudget: TokenBudgetConfigSchema,
  
  /** Messages */
  messages: z.array(ConversationMessageSchema).default([]),
  
  /** Token Tracking */
  tokens: TokenUsageStatsSchema.optional(),
  totalTokens: TokenUsageSchema.optional().describe('Total tokens across all messages'),
  totalCost: z.number().nonnegative().optional().describe('Total cost for this session in USD'),
  
  /** Session Status */
  status: z.enum(['active', 'paused', 'completed', 'archived']).default('active'),
  
  /** Timestamps */
  createdAt: z.string().datetime().describe('ISO 8601 timestamp'),
  updatedAt: z.string().datetime().describe('ISO 8601 timestamp'),
  expiresAt: z.string().datetime().optional().describe('ISO 8601 timestamp'),
  metadata: z.record(z.string(), z.unknown()).optional(),
}));

/**
 * Conversation Summary
 */
export const ConversationSummarySchema = lazySchema(() => z.object({
  /** Summary Content */
  summary: z.string().describe('Conversation summary'),
  keyPoints: z.array(z.string()).optional().describe('Key discussion points'),
  
  /** Token Savings */
  originalTokens: z.number().int().nonnegative().describe('Original token count'),
  summaryTokens: z.number().int().nonnegative().describe('Summary token count'),
  tokensSaved: z.number().int().nonnegative().describe('Tokens saved'),
  
  /** Source Messages */
  messageRange: z.object({
    startIndex: z.number().int().nonnegative(),
    endIndex: z.number().int().nonnegative(),
  }).describe('Range of messages summarized'),
  
  /** Metadata */
  generatedAt: z.string().datetime().describe('ISO 8601 timestamp'),
  modelId: z.string().optional().describe('Model used for summarization'),
}));

/**
 * Message Pruning Event
 */
export const MessagePruningEventSchema = lazySchema(() => z.object({
  /** Event Details */
  timestamp: z.string().datetime().describe('Event timestamp'),
  /** Pruned Messages */
  prunedMessages: z.array(z.object({
    messageId: z.string(),
    role: MessageRoleSchema,
    tokens: z.number().int().nonnegative(),
    importance: z.number().min(0).max(1).optional(),
  })),
  
  /** Impact */
  tokensFreed: z.number().int().nonnegative(),
  messagesRemoved: z.number().int().nonnegative(),
  
  /** Post-Pruning State */
  remainingTokens: z.number().int().nonnegative(),
  remainingMessages: z.number().int().nonnegative(),
}));

/**
 * Conversation Analytics
 */
export const ConversationAnalyticsSchema = lazySchema(() => z.object({
  /** Session Info */
  sessionId: z.string(),
  
  /** Message Statistics */
  totalMessages: z.number().int().nonnegative(),
  userMessages: z.number().int().nonnegative(),
  assistantMessages: z.number().int().nonnegative(),
  systemMessages: z.number().int().nonnegative(),
  
  /** Token Statistics */
  totalTokens: z.number().int().nonnegative(),
  averageTokensPerMessage: z.number().nonnegative(),
  peakTokenUsage: z.number().int().nonnegative(),
  
  /** Efficiency Metrics */
  pruningEvents: z.number().int().nonnegative().default(0),
  summarizationEvents: z.number().int().nonnegative().default(0),
  tokensSavedByPruning: z.number().int().nonnegative().default(0),
  tokensSavedBySummarization: z.number().int().nonnegative().default(0),
  
  /** Duration */
  duration: z.number().nonnegative().optional().describe('Session duration in seconds'),
  firstMessageAt: z.string().datetime().optional().describe('ISO 8601 timestamp'),
  lastMessageAt: z.string().datetime().optional().describe('ISO 8601 timestamp'),
}));

export type MessageRole = z.input<typeof MessageRoleSchema>;
export type MessageContentType = z.input<typeof MessageContentTypeSchema>;
export type MessageContent = z.input<typeof MessageContentSchema>;
/** Post-parse shape of {@link MessageContent} — defaults applied, transforms run (ADR-0122). */
export type MessageContentParsed = z.infer<typeof MessageContentSchema>;
export type FunctionCall = z.input<typeof FunctionCallSchema>;
export type ToolCall = z.input<typeof ToolCallSchema>;
/** Post-parse shape of {@link ToolCall} — defaults applied, transforms run (ADR-0122). */
export type ToolCallParsed = z.infer<typeof ToolCallSchema>;
export type ConversationMessage = z.input<typeof ConversationMessageSchema>;
/** Post-parse shape of {@link ConversationMessage} — defaults applied, transforms run (ADR-0122). */
export type ConversationMessageParsed = z.infer<typeof ConversationMessageSchema>;
export type TokenBudgetStrategy = z.input<typeof TokenBudgetStrategySchema>;
export type TokenBudgetConfig = z.input<typeof TokenBudgetConfigSchema>;
/** Post-parse shape of {@link TokenBudgetConfig} — defaults applied, transforms run (ADR-0122). */
export type TokenBudgetConfigParsed = z.infer<typeof TokenBudgetConfigSchema>;
export type TokenUsageStats = z.input<typeof TokenUsageStatsSchema>;
/** Post-parse shape of {@link TokenUsageStats} — defaults applied, transforms run (ADR-0122). */
export type TokenUsageStatsParsed = z.infer<typeof TokenUsageStatsSchema>;
export type ConversationContext = z.input<typeof ConversationContextSchema>;
export type ConversationSession = z.input<typeof ConversationSessionSchema>;
/** Post-parse shape of {@link ConversationSession} — defaults applied, transforms run (ADR-0122). */
export type ConversationSessionParsed = z.infer<typeof ConversationSessionSchema>;
export type ConversationSummary = z.input<typeof ConversationSummarySchema>;
export type MessagePruningEvent = z.input<typeof MessagePruningEventSchema>;
export type ConversationAnalytics = z.input<typeof ConversationAnalyticsSchema>;
/** Post-parse shape of {@link ConversationAnalytics} — defaults applied, transforms run (ADR-0122). */
export type ConversationAnalyticsParsed = z.infer<typeof ConversationAnalyticsSchema>;
export type FileContent = z.input<typeof FileContentSchema>;
export type TextContent = z.input<typeof TextContentSchema>;
