// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

// ==========================================
// Webhook Integration
// ==========================================

/**
 * Event Webhook Configuration Schema
 * Configuration for sending events to webhooks
 * 
 * @example
 * {
 *   "eventPattern": "order.*",
 *   "url": "https://api.example.com/webhooks/orders",
 *   "method": "POST",
 *   "headers": { "Authorization": "Bearer token" }
 * }
 */
import { lazySchema } from '../../shared/lazy-schema';
export const EventWebhookConfigSchema = lazySchema(() => z.object({
  /**
   * Webhook identifier
   */
  id: z.string().optional().describe('Unique webhook identifier'),
  
  /**
   * Event pattern to match
   */
  eventPattern: z.string().describe('Event name pattern (supports wildcards)'),
  
  /**
   * Target URL
   */
  url: z.string().url().describe('Webhook endpoint URL'),
  
  /**
   * HTTP method
   */
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH']).default('POST').describe('HTTP method'),
  
  /**
   * Headers
   */
  headers: z.record(z.string(), z.string()).optional().describe('HTTP headers'),
  
  /**
   * Authentication
   */
  authentication: z.object({
    type: z.enum(['none', 'bearer', 'basic', 'api-key']).describe('Auth type'),
    credentials: z.record(z.string(), z.string()).optional().describe('Auth credentials'),
  }).optional().describe('Authentication configuration'),
  
  /**
   * Retry policy
   */
  retryPolicy: z.object({
    maxRetries: z.number().int().min(0).default(3).describe('Max retry attempts'),
    backoffStrategy: z.enum(['fixed', 'linear', 'exponential']).default('exponential'),
    initialDelayMs: z.number().int().positive().default(1000).describe('Initial retry delay'),
    maxDelayMs: z.number().int().positive().default(60000).describe('Max retry delay'),
  }).optional().describe('Retry policy'),
  
  /**
   * Timeout
   */
  timeoutMs: z.number().int().positive().default(30000).describe('Request timeout in milliseconds'),
  
  /**
   * Event transformation
   */
  transform: z.unknown()
    .optional()
    .describe('Transform event before sending'),
  
  /**
   * Enabled
   */
  enabled: z.boolean().default(true).describe('Whether webhook is enabled'),
}));

export type EventWebhookConfig = z.input<typeof EventWebhookConfigSchema>;
/** Post-parse shape of {@link EventWebhookConfig} — defaults applied, transforms run (ADR-0122). */
export type EventWebhookConfigParsed = z.infer<typeof EventWebhookConfigSchema>;

// ==========================================
// Message Queue Integration
// ==========================================

/**
 * Event Message Queue Configuration Schema
 * Configuration for publishing events to message queues
 * 
 * @example
 * {
 *   "provider": "kafka",
 *   "topic": "events",
 *   "eventPattern": "*",
 *   "partitionKey": "metadata.tenantId"
 * }
 */
export const EventMessageQueueConfigSchema = lazySchema(() => z.object({
  /**
   * Provider
   */
  provider: z.enum(['kafka', 'rabbitmq', 'aws-sqs', 'redis-pubsub', 'google-pubsub', 'azure-service-bus'])
    .describe('Message queue provider'),
  
  /**
   * Topic/Queue name
   */
  topic: z.string().describe('Topic or queue name'),
  
  /**
   * Event pattern
   */
  eventPattern: z.string().default('*').describe('Event name pattern to publish (supports wildcards)'),
  
  /**
   * Partition key
   */
  partitionKey: z.string().optional().describe('JSON path for partition key (e.g., "metadata.tenantId")'),
  
  /**
   * Message format
   */
  format: z.enum(['json', 'avro', 'protobuf']).default('json').describe('Message serialization format'),
  
  /**
   * Include metadata
   */
  includeMetadata: z.boolean().default(true).describe('Include event metadata in message'),
  
  /**
   * Compression
   */
  compression: z.enum(['none', 'gzip', 'snappy', 'lz4']).default('none').describe('Message compression'),
  
  /**
   * Batch size
   */
  batchSize: z.number().int().min(1).default(1).describe('Batch size for publishing'),
  
  /**
   * Flush interval
   */
  flushIntervalMs: z.number().int().positive().default(1000).describe('Flush interval for batching'),
}));

export type EventMessageQueueConfig = z.input<typeof EventMessageQueueConfigSchema>;
/** Post-parse shape of {@link EventMessageQueueConfig} — defaults applied, transforms run (ADR-0122). */
export type EventMessageQueueConfigParsed = z.infer<typeof EventMessageQueueConfigSchema>;

// ==========================================
// Real-time Notifications
// ==========================================

/**
 * Real-time Notification Configuration Schema
 * Configuration for real-time event notifications via WebSocket/SSE
 * 
 * @example
 * {
 *   "enabled": true,
 *   "protocol": "websocket",
 *   "eventPattern": "notification.*",
 *   "userFilter": true
 * }
 */
export const RealTimeNotificationConfigSchema = lazySchema(() => z.object({
  /**
   * Enable real-time notifications
   */
  enabled: z.boolean().default(true).describe('Enable real-time notifications'),
  
  /**
   * Protocol
   */
  protocol: z.enum(['websocket', 'sse', 'long-polling']).default('websocket')
    .describe('Real-time protocol'),
  
  /**
   * Event pattern
   */
  eventPattern: z.string().default('*').describe('Event pattern to broadcast'),
  
  /**
   * User-specific filtering
   */
  userFilter: z.boolean().default(true).describe('Filter events by user'),
  
  /**
   * Tenant-specific filtering
   */
  tenantFilter: z.boolean().default(true).describe('Filter events by tenant'),
  
  /**
   * Channels
   */
  channels: z.array(z.object({
    name: z.string().describe('Channel name'),
    eventPattern: z.string().describe('Event pattern for channel'),
    filter: z.unknown()
      .optional()
      .describe('Additional filter function'),
  })).optional().describe('Named channels for event broadcasting'),
  
  /**
   * Rate limiting
   */
  rateLimit: z.object({
    maxEventsPerSecond: z.number().int().positive().describe('Max events per second per client'),
    windowMs: z.number().int().positive().default(1000).describe('Rate limit window'),
  }).optional().describe('Rate limiting configuration'),
}));

export type RealTimeNotificationConfig = z.input<typeof RealTimeNotificationConfigSchema>;
/** Post-parse shape of {@link RealTimeNotificationConfig} — defaults applied, transforms run (ADR-0122). */
export type RealTimeNotificationConfigParsed = z.infer<typeof RealTimeNotificationConfigSchema>;
