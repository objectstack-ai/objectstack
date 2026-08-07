// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { CronExpressionInputSchema } from '../shared/expression.zod';

/**
 * Backup Strategy Schema
 *
 * Defines backup methods for disaster recovery.
 *
 * - **full**: Complete snapshot of all data
 * - **incremental**: Only changes since last backup
 * - **differential**: All changes since last full backup
 *
 * @example
 * ```typescript
 * const backup: BackupConfig = {
 *   strategy: 'incremental',
 *   schedule: '0 2 * * *',
 *   retention: { days: 30, minCopies: 3 },
 *   encryption: { enabled: true, algorithm: 'AES-256-GCM' },
 * };
 * ```
 */
import { lazySchema } from '../shared/lazy-schema';
export const BackupStrategySchema = lazySchema(() => z.enum([
  'full',
  'incremental',
  'differential',
]).describe('Backup strategy type'));

export type BackupStrategy = z.infer<typeof BackupStrategySchema>;

/**
 * Backup Retention Policy Schema
 */
export const BackupRetentionSchema = lazySchema(() => z.object({
  /** Number of days to retain backups */
  days: z.number().min(1).describe('Retention period in days'),
  /** Minimum number of backup copies to keep regardless of age */
  minCopies: z.number().min(1).default(3).describe('Minimum backup copies to retain'),
  /** Maximum number of backup copies */
  maxCopies: z.number().optional().describe('Maximum backup copies to store'),
}).describe('Backup retention policy'));

export type BackupRetention = z.infer<typeof BackupRetentionSchema>;
/** Post-parse shape of {@link BackupRetention} — defaults applied, transforms run (ADR-0122). */
export type BackupRetentionParsed = z.infer<typeof BackupRetentionSchema>;

/**
 * Backup Configuration Schema
 */
export const BackupConfigSchema = lazySchema(() => z.object({
  /** Backup strategy */
  strategy: BackupStrategySchema.default('incremental').describe('Backup strategy'),
  /** Cron schedule for automated backups */
  schedule: CronExpressionInputSchema.optional().describe('Cron expression for backup schedule — cron`0 2 * * *`'),
  /** Retention policy */
  retention: BackupRetentionSchema.describe('Backup retention policy'),
  /** Storage destination */
  destination: z.object({
    type: z.enum(['s3', 'gcs', 'azure_blob', 'local']).describe('Storage backend type'),
    bucket: z.string().optional().describe('Cloud storage bucket/container name'),
    path: z.string().optional().describe('Storage path prefix'),
    region: z.string().optional().describe('Cloud storage region'),
  }).describe('Backup storage destination'),
  /** Encryption settings */
  encryption: z.object({
    enabled: z.boolean().default(true).describe('Enable backup encryption'),
    algorithm: z.enum(['AES-256-GCM', 'AES-256-CBC', 'ChaCha20-Poly1305']).default('AES-256-GCM')
      .describe('Encryption algorithm'),
    keyId: z.string().optional().describe('KMS key ID for encryption'),
  }).optional().describe('Backup encryption settings'),
  /** Compression settings */
  compression: z.object({
    enabled: z.boolean().default(true).describe('Enable backup compression'),
    algorithm: z.enum(['gzip', 'zstd', 'lz4', 'snappy']).default('zstd').describe('Compression algorithm'),
  }).optional().describe('Backup compression settings'),
  /** Verify backup integrity after creation */
  verifyAfterBackup: z.boolean().default(true).describe('Verify backup integrity after creation'),
}).describe('Backup configuration'));

export type BackupConfig = z.infer<typeof BackupConfigSchema>;
/** Post-parse shape of {@link BackupConfig} — defaults applied, transforms run (ADR-0122). */
export type BackupConfigParsed = z.infer<typeof BackupConfigSchema>;
export type BackupConfigInput = z.input<typeof BackupConfigSchema>;

/**
 * Failover Mode Schema
 *
 * Defines how traffic is routed between primary and secondary systems.
 *
 * - **active_passive**: Secondary is standby, activated on primary failure
 * - **active_active**: Both primary and secondary handle traffic
 * - **pilot_light**: Minimal secondary with quick scale-up capability
 * - **warm_standby**: Reduced-capacity secondary, faster failover than pilot light
 */
export const FailoverModeSchema = lazySchema(() => z.enum([
  'active_passive',
  'active_active',
  'pilot_light',
  'warm_standby',
]).describe('Failover mode'));

export type FailoverMode = z.infer<typeof FailoverModeSchema>;

/**
 * Failover Configuration Schema
 */
export const FailoverConfigSchema = lazySchema(() => z.object({
  /** Failover mode */
  mode: FailoverModeSchema.default('active_passive').describe('Failover mode'),
  /** Automatic failover enabled */
  autoFailover: z.boolean().default(true).describe('Enable automatic failover'),
  /** Health check interval in seconds */
  healthCheckInterval: z.number().default(30).describe('Health check interval in seconds'),
  /** Number of consecutive failures before triggering failover */
  failureThreshold: z.number().default(3).describe('Consecutive failures before failover'),
  /** Regions/zones for disaster recovery */
  regions: z.array(z.object({
    name: z.string().describe('Region identifier (e.g., "us-east-1", "eu-west-1")'),
    role: z.enum(['primary', 'secondary', 'witness']).describe('Region role'),
    endpoint: z.string().optional().describe('Region endpoint URL'),
    priority: z.number().optional().describe('Failover priority (lower = higher priority)'),
  })).min(2).describe('Multi-region configuration (minimum 2 regions)'),
  /** DNS failover configuration */
  dns: z.object({
    ttl: z.number().default(60).describe('DNS TTL in seconds for failover'),
    provider: z.enum(['route53', 'cloudflare', 'azure_dns', 'custom']).optional()
      .describe('DNS provider for automatic failover'),
  }).optional().describe('DNS failover settings'),
}).describe('Failover configuration'));

export type FailoverConfig = z.infer<typeof FailoverConfigSchema>;
/** Post-parse shape of {@link FailoverConfig} — defaults applied, transforms run (ADR-0122). */
export type FailoverConfigParsed = z.infer<typeof FailoverConfigSchema>;
export type FailoverConfigInput = z.input<typeof FailoverConfigSchema>;

/**
 * Recovery Point Objective (RPO) Schema
 *
 * Maximum acceptable amount of data loss measured in time.
 */
export const RPOSchema = lazySchema(() => z.object({
  /** RPO value */
  value: z.number().min(0).describe('RPO value'),
  /** RPO time unit */
  unit: z.enum(['seconds', 'minutes', 'hours']).default('minutes').describe('RPO time unit'),
}).describe('Recovery Point Objective (maximum acceptable data loss)'));

export type RPO = z.infer<typeof RPOSchema>;
/** Post-parse shape of {@link RPO} — defaults applied, transforms run (ADR-0122). */
export type RPOParsed = z.infer<typeof RPOSchema>;

/**
 * Recovery Time Objective (RTO) Schema
 *
 * Maximum acceptable time to restore service after a disaster.
 */
export const RTOSchema = lazySchema(() => z.object({
  /** RTO value */
  value: z.number().min(0).describe('RTO value'),
  /** RTO time unit */
  unit: z.enum(['seconds', 'minutes', 'hours']).default('minutes').describe('RTO time unit'),
}).describe('Recovery Time Objective (maximum acceptable downtime)'));

export type RTO = z.infer<typeof RTOSchema>;
/** Post-parse shape of {@link RTO} — defaults applied, transforms run (ADR-0122). */
export type RTOParsed = z.infer<typeof RTOSchema>;

/**
 * Disaster Recovery Plan Schema
 *
 * Complete disaster recovery configuration for an ObjectStack deployment.
 * Covers backup, failover, replication, and recovery objectives.
 *
 * Aligned with industry standards:
 * - ISO 22301 (Business Continuity Management)
 * - AWS Well-Architected Framework (Reliability Pillar)
 *
 * @example
 * ```typescript
 * const drPlan: DisasterRecoveryPlan = {
 *   enabled: true,
 *   rpo: { value: 15, unit: 'minutes' },
 *   rto: { value: 1, unit: 'hours' },
 *   backup: {
 *     strategy: 'incremental',
 *     schedule: '0 0/6 * * *',
 *     retention: { days: 90, minCopies: 5 },
 *     destination: { type: 's3', bucket: 'backup-bucket', region: 'us-east-1' },
 *   },
 *   failover: {
 *     mode: 'active_passive',
 *     autoFailover: true,
 *     healthCheckInterval: 30,
 *     failureThreshold: 3,
 *     regions: [
 *       { name: 'us-east-1', role: 'primary' },
 *       { name: 'us-west-2', role: 'secondary' },
 *     ],
 *   },
 * };
 * ```
 */
export const DisasterRecoveryPlanSchema = lazySchema(() => z.object({
  /** Enable disaster recovery */
  enabled: z.boolean().default(false).describe('Enable disaster recovery plan'),

  /** Recovery Point Objective */
  rpo: RPOSchema.describe('Recovery Point Objective'),

  /** Recovery Time Objective */
  rto: RTOSchema.describe('Recovery Time Objective'),

  /** Backup configuration */
  backup: BackupConfigSchema.describe('Backup configuration'),

  /** Failover configuration */
  failover: FailoverConfigSchema.optional().describe('Multi-region failover configuration'),

  /** Data replication settings */
  replication: z.object({
    /** Replication mode */
    mode: z.enum(['synchronous', 'asynchronous', 'semi_synchronous']).default('asynchronous')
      .describe('Data replication mode'),
    /** Maximum replication lag allowed (seconds) */
    maxLagSeconds: z.number().optional().describe('Maximum acceptable replication lag in seconds'),
    /** Objects/tables to replicate (empty = all) */
    includeObjects: z.array(z.string()).optional().describe('Objects to replicate (empty = all)'),
    /** Objects/tables to exclude from replication */
    excludeObjects: z.array(z.string()).optional().describe('Objects to exclude from replication'),
  }).optional().describe('Data replication settings'),

  /** Automated recovery testing */
  testing: z.object({
    /** Enable periodic DR testing */
    enabled: z.boolean().default(false).describe('Enable automated DR testing'),
    /** Cron schedule for DR tests */
    schedule: CronExpressionInputSchema.optional().describe('Cron expression for DR test schedule'),
    /** Notification channel for test results */
    notificationChannel: z.string().optional().describe('Notification channel for DR test results'),
  }).optional().describe('Automated disaster recovery testing'),

  /** Runbook URL for manual procedures */
  runbookUrl: z.string().optional().describe('URL to disaster recovery runbook/playbook'),

  /** Contact list for DR incidents */
  contacts: z.array(z.object({
    name: z.string().describe('Contact name'),
    role: z.string().describe('Contact role (e.g., "DBA", "SRE Lead")'),
    email: z.string().optional().describe('Contact email'),
    phone: z.string().optional().describe('Contact phone'),
  })).optional().describe('Emergency contact list for DR incidents'),
}).describe('Complete disaster recovery plan configuration'));

export type DisasterRecoveryPlan = z.infer<typeof DisasterRecoveryPlanSchema>;
/** Post-parse shape of {@link DisasterRecoveryPlan} — defaults applied, transforms run (ADR-0122). */
export type DisasterRecoveryPlanParsed = z.infer<typeof DisasterRecoveryPlanSchema>;
export type DisasterRecoveryPlanInput = z.input<typeof DisasterRecoveryPlanSchema>;
