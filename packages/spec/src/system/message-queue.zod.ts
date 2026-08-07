// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * Message queue protocol for async communication
 * Supports Kafka, RabbitMQ, AWS SQS, Redis Pub/Sub
 */
import { lazySchema } from '../shared/lazy-schema';
export const MessageQueueProviderSchema = lazySchema(() => z.enum([
  'kafka',
  'rabbitmq',
  'aws-sqs',
  'redis-pubsub',
  'google-pubsub',
  'azure-service-bus',
]).describe('Supported message queue backend provider'));

export type MessageQueueProvider = z.input<typeof MessageQueueProviderSchema>;

export const TopicConfigSchema = lazySchema(() => z.object({
  name: z.string().describe('Topic name identifier'),
  partitions: z.number().default(1).describe('Number of partitions for parallel consumption'),
  replicationFactor: z.number().default(1).describe('Number of replicas for fault tolerance'),
  retentionMs: z.number().optional().describe('Message retention period in milliseconds'),
  compressionType: z.enum(['none', 'gzip', 'snappy', 'lz4']).default('none').describe('Message compression algorithm'),
}).describe('Configuration for a message queue topic'));

export type TopicConfig = z.input<typeof TopicConfigSchema>;
/** Post-parse shape of {@link TopicConfig} — defaults applied, transforms run (ADR-0122). */
export type TopicConfigParsed = z.infer<typeof TopicConfigSchema>;

export const ConsumerConfigSchema = lazySchema(() => z.object({
  groupId: z.string().describe('Consumer group identifier'),
  autoOffsetReset: z.enum(['earliest', 'latest']).default('latest').describe('Where to start reading when no offset exists'),
  enableAutoCommit: z.boolean().default(true).describe('Automatically commit consumed offsets'),
  maxPollRecords: z.number().default(500).describe('Maximum records returned per poll'),
}).describe('Consumer group configuration for topic consumption'));

export type ConsumerConfig = z.input<typeof ConsumerConfigSchema>;
/** Post-parse shape of {@link ConsumerConfig} — defaults applied, transforms run (ADR-0122). */
export type ConsumerConfigParsed = z.infer<typeof ConsumerConfigSchema>;

export const DeadLetterQueueSchema = lazySchema(() => z.object({
  enabled: z.boolean().default(false).describe('Enable dead letter queue for failed messages'),
  maxRetries: z.number().default(3).describe('Maximum delivery attempts before sending to DLQ'),
  queueName: z.string().describe('Name of the dead letter queue'),
}).describe('Dead letter queue configuration for unprocessable messages'));

export type DeadLetterQueue = z.input<typeof DeadLetterQueueSchema>;
/** Post-parse shape of {@link DeadLetterQueue} — defaults applied, transforms run (ADR-0122). */
export type DeadLetterQueueParsed = z.infer<typeof DeadLetterQueueSchema>;

export const MessageQueueConfigSchema = lazySchema(() => z.object({
  provider: MessageQueueProviderSchema.describe('Message queue backend provider'),
  topics: z.array(TopicConfigSchema).describe('List of topic configurations'),
  consumers: z.array(ConsumerConfigSchema).optional().describe('Consumer group configurations'),
  deadLetterQueue: DeadLetterQueueSchema.optional().describe('Dead letter queue for failed messages'),
  ssl: z.boolean().default(false).describe('Enable SSL/TLS for broker connections'),
  sasl: z.object({
    mechanism: z.enum(['plain', 'scram-sha-256', 'scram-sha-512']).describe('SASL authentication mechanism'),
    username: z.string().describe('SASL username'),
    password: z.string().describe('SASL password'),
  }).optional().describe('SASL authentication configuration'),
}).describe('Top-level message queue configuration'));

export type MessageQueueConfig = z.input<typeof MessageQueueConfigSchema>;
/** Post-parse shape of {@link MessageQueueConfig} — defaults applied, transforms run (ADR-0122). */
export type MessageQueueConfigParsed = z.infer<typeof MessageQueueConfigSchema>;
