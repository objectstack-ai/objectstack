// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { EventSchema } from './core.zod';

// ==========================================
// Dead Letter Queue
// ==========================================

/**
 * Dead Letter Queue Entry Schema
 * Represents a failed event in the dead letter queue
 */
import { lazySchema } from '../../shared/lazy-schema';
export const DeadLetterQueueEntrySchema = lazySchema(() => z.object({
  /**
   * Entry identifier
   */
  id: z.string().describe('Unique entry identifier'),
  
  /**
   * Original event
   */
  event: EventSchema.describe('Original event'),
  
  /**
   * Failure reason
   */
  error: z.object({
    message: z.string().describe('Error message'),
    stack: z.string().optional().describe('Error stack trace'),
    code: z.string().optional().describe('Error code'),
  }).describe('Failure details'),
  
  /**
   * Retry count
   */
  retries: z.number().int().min(0).describe('Number of retry attempts'),
  
  /**
   * Timestamps
   */
  firstFailedAt: z.string().datetime().describe('When event first failed'),
  lastFailedAt: z.string().datetime().describe('When event last failed'),
  
  /**
   * Handler that failed
   */
  failedHandler: z.string().optional().describe('Handler ID that failed'),
}));

export type DeadLetterQueueEntry = z.infer<typeof DeadLetterQueueEntrySchema>;
/** Post-parse shape of {@link DeadLetterQueueEntry} — defaults applied, transforms run (ADR-0122). */
export type DeadLetterQueueEntryParsed = z.infer<typeof DeadLetterQueueEntrySchema>;

// ==========================================
// Event Log
// ==========================================

/**
 * Event Log Entry Schema
 * Represents a logged event
 */
export const EventLogEntrySchema = lazySchema(() => z.object({
  /**
   * Log entry ID
   */
  id: z.string().describe('Unique log entry identifier'),
  
  /**
   * Event
   */
  event: EventSchema.describe('The event'),
  
  /**
   * Status
   */
  status: z.enum(['pending', 'processing', 'completed', 'failed']).describe('Processing status'),
  
  /**
   * Handlers executed
   */
  handlersExecuted: z.array(z.object({
    handlerId: z.string().describe('Handler identifier'),
    status: z.enum(['success', 'failed', 'timeout']).describe('Handler execution status'),
    durationMs: z.number().int().optional().describe('Execution duration'),
    error: z.string().optional().describe('Error message if failed'),
  })).optional().describe('Handlers that processed this event'),
  
  /**
   * Timestamps
   */
  receivedAt: z.string().datetime().describe('When event was received'),
  processedAt: z.string().datetime().optional().describe('When event was processed'),
  
  /**
   * Total duration
   */
  totalDurationMs: z.number().int().optional().describe('Total processing time'),
}));

export type EventLogEntry = z.infer<typeof EventLogEntrySchema>;
/** Post-parse shape of {@link EventLogEntry} — defaults applied, transforms run (ADR-0122). */
export type EventLogEntryParsed = z.infer<typeof EventLogEntrySchema>;
