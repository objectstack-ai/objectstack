// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * Logging Protocol - Comprehensive Observability Logging
 * 
 * Unified logging protocol that combines:
 * - Basic kernel logging (LoggerConfig)
 * - Enterprise-grade features (LoggingConfig)
 * - Multiple log destinations (file, console, external services)
 * - Structured logging with enrichment
 * - Log aggregation and forwarding
 * - Integration with external log management systems
 */

// ============================================================================
// Basic Logger Protocol (formerly from logger.zod.ts)
// ============================================================================

/**
 * Log Level Enum
 * Standard RFC 5424 severity levels (simplified)
 */
import { lazySchema } from '../shared/lazy-schema';
export const LogLevel = z.enum([
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
  'silent'
]).describe('Log severity level');

export type LogLevel = z.infer<typeof LogLevel>;

/**
 * Log Format Enum
 */
export const LogFormat = z.enum([
  'json',   // Structured JSON for machine parsing
  'text',   // Simple text format
  'pretty'  // Colored human-readable output for CLI/console
]).describe('Log output format');

export type LogFormat = z.infer<typeof LogFormat>;

/**
 * Logger Configuration Schema
 * Configuration for the Kernel's internal logger
 */
export const LoggerConfigSchema = lazySchema(() => z.object({
  /**
   * Logger name
   */
  name: z.string().optional().describe('Logger name identifier'),

  /**
   * Minimum level to log
   */
  level: LogLevel.optional().default('info'),

  /**
   * Output format
   */
  format: LogFormat.optional().default('json'),

  /**
   * Redact sensitive keys
   */
  redact: z.array(z.string()).optional().default(['password', 'token', 'secret', 'key'])
    .describe('Keys to redact from log context'),

  /**
   * Enable source location (file/line)
   */
  sourceLocation: z.boolean().optional().default(false)
    .describe('Include file and line number'),

  /**
   * Log to file (optional)
   */
  file: z.string().optional().describe('Path to log file'),

  /**
   * Log rotation config (if file is set)
   */
  rotation: z.object({
      maxSize: z.string().optional().default('10m'),
      maxFiles: z.number().optional().default(5)
  }).optional()
}));

export type LoggerConfig = z.infer<typeof LoggerConfigSchema>;
/** Post-parse shape of {@link LoggerConfig} — defaults applied, transforms run (ADR-0122). */
export type LoggerConfigParsed = z.infer<typeof LoggerConfigSchema>;

/**
 * Log Entry Schema
 * The shape of a structured log record
 */
export const LogEntrySchema = lazySchema(() => z.object({
  timestamp: z.string().datetime().describe('ISO 8601 timestamp'),
  level: LogLevel,
  message: z.string().describe('Log message'),
  context: z.record(z.string(), z.unknown()).optional().describe('Structured context data'),
  error: z.record(z.string(), z.unknown()).optional().describe('Error object if present'),
  
  /** Tracing */
  traceId: z.string().optional().describe('Distributed trace ID'),
  spanId: z.string().optional().describe('Span ID'),
  
  /** Source */
  service: z.string().optional().describe('Service name'),
  component: z.string().optional().describe('Component name (e.g. plugin id)'),
}));

export type LogEntry = z.infer<typeof LogEntrySchema>;

// ============================================================================
// Extended Logging Protocol (enterprise features)
// ============================================================================

/**
 * Extended Log Level Enum
 * Standard RFC 5424 severity levels with trace
 */
export const ExtendedLogLevel = z.enum([
  'trace',    // Very detailed debugging information
  'debug',    // Debugging information
  'info',     // Informational messages
  'warn',     // Warning messages
  'error',    // Error messages
  'fatal',    // Fatal errors causing shutdown
]).describe('Extended log severity level');

export type ExtendedLogLevel = z.infer<typeof ExtendedLogLevel>;

/**
 * Log Destination Type Enum
 * Where logs can be sent
 */
export const LogDestinationType = z.enum([
  'console',        // Standard output/error
  'file',           // File system
  'syslog',         // System logger
  'elasticsearch',  // Elasticsearch
  'cloudwatch',     // AWS CloudWatch
  'stackdriver',    // Google Cloud Logging
  'azure_monitor',  // Azure Monitor
  'datadog',        // Datadog
  'splunk',         // Splunk
  'loki',           // Grafana Loki
  'http',           // HTTP endpoint
  'kafka',          // Apache Kafka
  'redis',          // Redis streams
  'custom',         // Custom implementation
]).describe('Log destination type');

export type LogDestinationType = z.infer<typeof LogDestinationType>;

/**
 * Console Destination Configuration
 */
export const ConsoleDestinationConfigSchema = lazySchema(() => z.object({
  /**
   * Output stream
   */
  stream: z.enum(['stdout', 'stderr']).optional().default('stdout'),

  /**
   * Enable colored output
   */
  colors: z.boolean().optional().default(true),

  /**
   * Pretty print JSON
   */
  prettyPrint: z.boolean().optional().default(false),
}).describe('Console destination configuration'));

export type ConsoleDestinationConfig = z.infer<typeof ConsoleDestinationConfigSchema>;
/** Post-parse shape of {@link ConsoleDestinationConfig} — defaults applied, transforms run (ADR-0122). */
export type ConsoleDestinationConfigParsed = z.infer<typeof ConsoleDestinationConfigSchema>;

/**
 * File Destination Configuration
 */
export const FileDestinationConfigSchema = lazySchema(() => z.object({
  /**
   * File path
   */
  path: z.string().describe('Log file path'),

  /**
   * Enable log rotation
   */
  rotation: z.object({
    /**
     * Maximum file size before rotation (e.g., '10m', '100k', '1g')
     */
    maxSize: z.string().optional().default('10m'),

    /**
     * Maximum number of files to keep
     */
    maxFiles: z.number().int().positive().optional().default(5),

    /**
     * Compress rotated files
     */
    compress: z.boolean().optional().default(true),

    /**
     * Rotation interval (e.g., 'daily', 'weekly')
     */
    interval: z.enum(['hourly', 'daily', 'weekly', 'monthly']).optional(),
  }).optional(),

  /**
   * File encoding
   */
  encoding: z.string().optional().default('utf8'),

  /**
   * Append to existing file
   */
  append: z.boolean().optional().default(true),
}).describe('File destination configuration'));

export type FileDestinationConfig = z.infer<typeof FileDestinationConfigSchema>;
/** Post-parse shape of {@link FileDestinationConfig} — defaults applied, transforms run (ADR-0122). */
export type FileDestinationConfigParsed = z.infer<typeof FileDestinationConfigSchema>;

/**
 * HTTP Destination Configuration
 */
export const HttpDestinationConfigSchema = lazySchema(() => z.object({
  /**
   * HTTP endpoint URL
   */
  url: z.string().url().describe('HTTP endpoint URL'),

  /**
   * HTTP method
   */
  method: z.enum(['POST', 'PUT']).optional().default('POST'),

  /**
   * Headers to include
   */
  headers: z.record(z.string(), z.string()).optional(),

  /**
   * Authentication
   */
  auth: z.object({
    type: z.enum(['basic', 'bearer', 'api_key']).describe('Auth type'),
    username: z.string().optional(),
    password: z.string().optional(),
    token: z.string().optional(),
    apiKey: z.string().optional(),
    apiKeyHeader: z.string().optional().default('X-API-Key'),
  }).optional(),

  /**
   * Batch configuration
   */
  batch: z.object({
    /**
     * Maximum batch size
     */
    maxSize: z.number().int().positive().optional().default(100),

    /**
     * Flush interval in milliseconds
     */
    flushInterval: z.number().int().positive().optional().default(5000),
  }).optional(),

  /**
   * Retry configuration
   */
  retry: z.object({
    /**
     * Maximum retry attempts
     */
    maxAttempts: z.number().int().positive().optional().default(3),

    /**
     * Initial retry delay in milliseconds
     */
    initialDelay: z.number().int().positive().optional().default(1000),

    /**
     * Backoff multiplier
     */
    backoffMultiplier: z.number().positive().optional().default(2),
  }).optional(),

  /**
   * Timeout in milliseconds
   */
  timeout: z.number().int().positive().optional().default(30000),
}).describe('HTTP destination configuration'));

export type HttpDestinationConfig = z.infer<typeof HttpDestinationConfigSchema>;
/** Post-parse shape of {@link HttpDestinationConfig} — defaults applied, transforms run (ADR-0122). */
export type HttpDestinationConfigParsed = z.infer<typeof HttpDestinationConfigSchema>;

/**
 * External Service Destination Configuration
 * Generic configuration for cloud logging services
 */
export const ExternalServiceDestinationConfigSchema = lazySchema(() => z.object({
  /**
   * Service-specific endpoint
   */
  endpoint: z.string().url().optional(),

  /**
   * Region (for cloud services)
   */
  region: z.string().optional(),

  /**
   * Credentials
   */
  credentials: z.object({
    accessKeyId: z.string().optional(),
    secretAccessKey: z.string().optional(),
    apiKey: z.string().optional(),
    environmentId: z.string().optional(),
  }).optional(),

  /**
   * Log group/stream/index name
   */
  logGroup: z.string().optional(),
  logStream: z.string().optional(),
  index: z.string().optional(),

  /**
   * Service-specific configuration
   */
  config: z.record(z.string(), z.unknown()).optional(),
}).describe('External service destination configuration'));

export type ExternalServiceDestinationConfig = z.infer<typeof ExternalServiceDestinationConfigSchema>;

/**
 * Log Destination Schema
 * Configuration for a single log destination
 */
export const LogDestinationSchema = lazySchema(() => z.object({
  /**
   * Destination name
   */
  name: z.string()
    .regex(/^[a-z_][a-z0-9_]*$/)
    .describe('Destination name (snake_case)'),

  /**
   * Destination type
   */
  type: LogDestinationType.describe('Destination type'),

  /**
   * Minimum log level for this destination
   */
  level: ExtendedLogLevel.optional().default('info'),

  /**
   * Enabled flag
   */
  enabled: z.boolean().optional().default(true),

  /**
   * Console configuration
   */
  console: ConsoleDestinationConfigSchema.optional(),

  /**
   * File configuration
   */
  file: FileDestinationConfigSchema.optional(),

  /**
   * HTTP configuration
   */
  http: HttpDestinationConfigSchema.optional(),

  /**
   * External service configuration
   */
  externalService: ExternalServiceDestinationConfigSchema.optional(),

  /**
   * Format for this destination
   */
  format: z.enum(['json', 'text', 'pretty']).optional().default('json'),

  /**
   * Filter function reference (runtime only)
   */
  filterId: z.string().optional().describe('Filter function identifier'),
}).describe('Log destination configuration'));

export type LogDestination = z.infer<typeof LogDestinationSchema>;
/** Post-parse shape of {@link LogDestination} — defaults applied, transforms run (ADR-0122). */
export type LogDestinationParsed = z.infer<typeof LogDestinationSchema>;

/**
 * Log Enrichment Configuration
 * Add contextual data to all log entries
 */
export const LogEnrichmentConfigSchema = lazySchema(() => z.object({
  /**
   * Static fields to add to all logs
   */
  staticFields: z.record(z.string(), z.unknown()).optional().describe('Static fields added to every log'),

  /**
   * Dynamic field enrichers (runtime only)
   * References to functions that add dynamic context
   */
  dynamicEnrichers: z.array(z.string()).optional().describe('Dynamic enricher function IDs'),

  /**
   * Add hostname
   */
  addHostname: z.boolean().optional().default(true),

  /**
   * Add process ID
   */
  addProcessId: z.boolean().optional().default(true),

  /**
   * Add environment info
   */
  addEnvironment: z.boolean().optional().default(true),

  /**
   * Add timestamp in additional formats
   */
  addTimestampFormats: z.object({
    unix: z.boolean().optional().default(false),
    iso: z.boolean().optional().default(true),
  }).optional(),

  /**
   * Add caller information (file, line, function)
   */
  addCaller: z.boolean().optional().default(false),

  /**
   * Add correlation IDs
   */
  addCorrelationIds: z.boolean().optional().default(true),
}).describe('Log enrichment configuration'));

export type LogEnrichmentConfig = z.infer<typeof LogEnrichmentConfigSchema>;
/** Post-parse shape of {@link LogEnrichmentConfig} — defaults applied, transforms run (ADR-0122). */
export type LogEnrichmentConfigParsed = z.infer<typeof LogEnrichmentConfigSchema>;

/**
 * Structured Log Entry Schema
 * Enhanced structured log record with enrichment
 */
export const StructuredLogEntrySchema = lazySchema(() => z.object({
  /**
   * Timestamp (ISO 8601)
   */
  timestamp: z.string().datetime().describe('ISO 8601 timestamp'),

  /**
   * Log level
   */
  level: ExtendedLogLevel.describe('Log severity level'),

  /**
   * Log message
   */
  message: z.string().describe('Log message'),

  /**
   * Structured context data
   */
  context: z.record(z.string(), z.unknown()).optional().describe('Structured context'),

  /**
   * Error information
   */
  error: z.object({
    name: z.string().optional(),
    message: z.string().optional(),
    stack: z.string().optional(),
    code: z.string().optional(),
    details: z.record(z.string(), z.unknown()).optional(),
  }).optional().describe('Error details'),

  /**
   * Trace context
   */
  trace: z.object({
    traceId: z.string().describe('Trace ID'),
    spanId: z.string().describe('Span ID'),
    parentSpanId: z.string().optional().describe('Parent span ID'),
    traceFlags: z.number().int().optional().describe('Trace flags'),
  }).optional().describe('Distributed tracing context'),

  /**
   * Source information
   */
  source: z.object({
    service: z.string().optional().describe('Service name'),
    component: z.string().optional().describe('Component name'),
    file: z.string().optional().describe('Source file'),
    line: z.number().int().optional().describe('Line number'),
    function: z.string().optional().describe('Function name'),
  }).optional().describe('Source information'),

  /**
   * Host information
   */
  host: z.object({
    hostname: z.string().optional(),
    pid: z.number().int().optional(),
    ip: z.string().optional(),
  }).optional().describe('Host information'),

  /**
   * Environment
   */
  environment: z.string().optional().describe('Environment (e.g., production, staging)'),

  /**
   * User information
   */
  user: z.object({
    id: z.string().optional(),
    username: z.string().optional(),
    email: z.string().optional(),
  }).optional().describe('User context'),

  /**
   * Request information
   */
  request: z.object({
    id: z.string().optional(),
    method: z.string().optional(),
    path: z.string().optional(),
    userAgent: z.string().optional(),
    ip: z.string().optional(),
  }).optional().describe('Request context'),

  /**
   * Custom labels/tags
   */
  labels: z.record(z.string(), z.string()).optional().describe('Custom labels'),

  /**
   * Additional metadata
   */
  metadata: z.record(z.string(), z.unknown()).optional().describe('Additional metadata'),
}).describe('Structured log entry'));

export type StructuredLogEntry = z.infer<typeof StructuredLogEntrySchema>;

/**
 * Logging Configuration Schema
 * Main configuration for the logging system
 */
export const LoggingConfigSchema = lazySchema(() => z.object({
  /**
   * Configuration name
   */
  name: z.string()
    .regex(/^[a-z_][a-z0-9_]*$/)
    .max(64)
    .describe('Configuration name (snake_case, max 64 chars)'),

  /**
   * Display label
   */
  label: z.string().describe('Display label'),

  /**
   * Enable logging
   */
  enabled: z.boolean().optional().default(true),

  /**
   * Global minimum log level
   */
  level: ExtendedLogLevel.optional().default('info'),

  /**
   * Default logger configuration
   * Basic logger config for the kernel
   */
  default: LoggerConfigSchema.optional().describe('Default logger configuration'),

  /**
   * Named logger configurations
   * Map of logger name to logger config for different components/modules
   */
  loggers: z.record(z.string(), LoggerConfigSchema).optional().describe('Named logger configurations'),

  /**
   * Log destinations
   */
  destinations: z.array(LogDestinationSchema).describe('Log destinations'),

  /**
   * Log enrichment configuration
   */
  enrichment: LogEnrichmentConfigSchema.optional(),

  /**
   * Fields to redact from logs
   */
  redact: z.array(z.string()).optional().default([
    'password',
    'passwordHash',
    'token',
    'apiKey',
    'secret',
    'creditCard',
    'ssn',
    'authorization',
  ]).describe('Fields to redact'),

  /**
   * Sampling configuration
   */
  sampling: z.object({
    /**
     * Enable sampling
     */
    enabled: z.boolean().optional().default(false),

    /**
     * Sample rate (0.0 to 1.0)
     */
    rate: z.number().min(0).max(1).optional().default(1.0),

    /**
     * Sample rate by level
     */
    rateByLevel: z.record(z.string(), z.number().min(0).max(1)).optional(),
  }).optional(),

  /**
   * Buffer configuration
   */
  buffer: z.object({
    /**
     * Enable buffering
     */
    enabled: z.boolean().optional().default(true),

    /**
     * Buffer size
     */
    size: z.number().int().positive().optional().default(1000),

    /**
     * Flush interval in milliseconds
     */
    flushInterval: z.number().int().positive().optional().default(1000),

    /**
     * Flush on shutdown
     */
    flushOnShutdown: z.boolean().optional().default(true),
  }).optional(),

  /**
   * Performance configuration
   */
  performance: z.object({
    /**
     * Async logging
     */
    async: z.boolean().optional().default(true),

    /**
     * Worker threads for async logging
     */
    workers: z.number().int().positive().optional().default(1),
  }).optional(),
}).describe('Logging configuration'));

export type LoggingConfig = z.infer<typeof LoggingConfigSchema>;
/** Post-parse shape of {@link LoggingConfig} — defaults applied, transforms run (ADR-0122). */
export type LoggingConfigParsed = z.infer<typeof LoggingConfigSchema>;
