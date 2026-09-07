import { describe, it, expect } from 'vitest';
import {
  BackupStrategySchema,
  BackupRetentionSchema,
  BackupConfigSchema,
  FailoverModeSchema,
  FailoverConfigSchema,
  RPOSchema,
  RTOSchema,
  DisasterRecoveryPlanSchema,
  type BackupConfig,
  type FailoverConfig,
  type DisasterRecoveryPlan,
} from './disaster-recovery.zod';

describe('BackupStrategySchema', () => {
  it('should accept valid strategies', () => {
    const strategies = ['full', 'incremental', 'differential'] as const;
    strategies.forEach(s => {
      expect(() => BackupStrategySchema.parse(s)).not.toThrow();
    });
  });

  it('should reject invalid strategy', () => {
    expect(() => BackupStrategySchema.parse('snapshot')).toThrow();
  });
});

describe('BackupRetentionSchema', () => {
  it('should accept valid retention policy', () => {
    const result = BackupRetentionSchema.parse({ days: 30 });
    expect(result.days).toBe(30);
    expect(result.minCopies).toBe(3);
  });

  it('should reject zero days', () => {
    expect(() => BackupRetentionSchema.parse({ days: 0 })).toThrow();
  });

  it('should accept full retention config', () => {
    const result = BackupRetentionSchema.parse({ days: 90, minCopies: 5, maxCopies: 30 });
    expect(result.maxCopies).toBe(30);
  });
});

describe('BackupConfigSchema', () => {
  it('should accept minimal backup config', () => {
    const config: z.input<typeof BackupConfigSchema> = {
      retention: { days: 30 },
      destination: { type: 's3', bucket: 'my-backups' },
    };

    const result = BackupConfigSchema.parse(config);
    expect(result.strategy).toBe('incremental');
    expect(result.verifyAfterBackup).toBe(true);
  });

  it('should accept full backup config with encryption', () => {
    const config = BackupConfigSchema.parse({
      strategy: 'full',
      schedule: '0 2 * * 0',
      retention: { days: 365, minCopies: 12 },
      destination: { type: 'gcs', bucket: 'backups', region: 'us-central1' },
      encryption: { enabled: true, algorithm: 'AES-256-GCM', keyId: 'kms-key-123' },
      compression: { enabled: true, algorithm: 'zstd' },
    });

    expect(config.strategy).toBe('full');
    expect(config.encryption?.algorithm).toBe('AES-256-GCM');
    expect(config.compression?.algorithm).toBe('zstd');
  });

  it('should accept all destination types', () => {
    const types = ['s3', 'gcs', 'azure_blob', 'local'] as const;
    types.forEach(type => {
      expect(() => BackupConfigSchema.parse({
        retention: { days: 7 },
        destination: { type },
      })).not.toThrow();
    });
  });
});

describe('FailoverModeSchema', () => {
  it('should accept all failover modes', () => {
    const modes = ['active_passive', 'active_active', 'pilot_light', 'warm_standby'] as const;
    modes.forEach(mode => {
      expect(() => FailoverModeSchema.parse(mode)).not.toThrow();
    });
  });
});

describe('FailoverConfigSchema', () => {
  it('should accept minimal failover config', () => {
    const config = FailoverConfigSchema.parse({
      regions: [
        { name: 'us-east-1', role: 'primary' },
        { name: 'us-west-2', role: 'secondary' },
      ],
    });

    expect(config.mode).toBe('active_passive');
    expect(config.autoFailover).toBe(true);
    expect(config.regions).toHaveLength(2);
  });

  it('should reject fewer than 2 regions', () => {
    expect(() => FailoverConfigSchema.parse({
      regions: [{ name: 'us-east-1', role: 'primary' }],
    })).toThrow();
  });

  it('should accept failover with DNS config', () => {
    const config = FailoverConfigSchema.parse({
      mode: 'active_active',
      regions: [
        { name: 'us-east-1', role: 'primary', priority: 1 },
        { name: 'eu-west-1', role: 'secondary', priority: 2 },
      ],
      dns: { ttl: 30, provider: 'route53' },
    });

    expect(config.dns?.provider).toBe('route53');
  });
});

describe('RPOSchema / RTOSchema', () => {
  it('should accept RPO with defaults', () => {
    const result = RPOSchema.parse({ value: 15 });
    expect(result.unit).toBe('minutes');
  });

  it('should accept RTO with explicit unit', () => {
    const result = RTOSchema.parse({ value: 1, unit: 'hours' });
    expect(result.value).toBe(1);
    expect(result.unit).toBe('hours');
  });

  it('should reject negative values', () => {
    expect(() => RPOSchema.parse({ value: -1 })).toThrow();
  });
});

describe('DisasterRecoveryPlanSchema', () => {
  const minimalPlan = {
    rpo: { value: 15, unit: 'minutes' },
    rto: { value: 1, unit: 'hours' },
    backup: {
      retention: { days: 30 },
      destination: { type: 's3', bucket: 'backups' },
    },
  };

  it('should accept minimal DR plan', () => {
    const result = DisasterRecoveryPlanSchema.parse(minimalPlan);
    expect(result.enabled).toBe(false);
    expect(result.rpo.value).toBe(15);
    expect(result.rto.value).toBe(1);
  });

  it('should accept full DR plan', () => {
    const fullPlan: z.input<typeof DisasterRecoveryPlanSchema> = {
      enabled: true,
      rpo: { value: 5, unit: 'minutes' },
      rto: { value: 30, unit: 'minutes' },
      backup: {
        strategy: 'incremental',
        schedule: '0 */6 * * *',
        retention: { days: 90, minCopies: 5 },
        destination: { type: 's3', bucket: 'dr-backups', region: 'us-east-1' },
        encryption: { enabled: true },
        compression: { enabled: true },
      },
      failover: {
        mode: 'active_passive',
        autoFailover: true,
        healthCheckIntervalSeconds: 30,
        failureThreshold: 3,
        regions: [
          { name: 'us-east-1', role: 'primary', endpoint: 'https://primary.example.com' },
          { name: 'us-west-2', role: 'secondary', endpoint: 'https://secondary.example.com' },
          { name: 'eu-west-1', role: 'witness' },
        ],
        dns: { ttl: 60, provider: 'route53' },
      },
      replication: {
        mode: 'asynchronous',
        maxLagSeconds: 30,
        excludeObjects: ['temp_data', 'session_store'],
      },
      testing: {
        enabled: true,
        schedule: '0 3 1 * *',
        notificationChannel: '#dr-alerts',
      },
      runbookUrl: 'https://docs.example.com/dr-runbook',
      contacts: [
        { name: 'Alice', role: 'DBA', email: 'alice@example.com' },
        { name: 'Bob', role: 'SRE Lead', phone: '+1-555-0100' },
      ],
    };

    const result = DisasterRecoveryPlanSchema.parse(fullPlan);
    expect(result.enabled).toBe(true);
    expect(result.failover?.regions).toHaveLength(3);
    expect(result.replication?.mode).toBe('asynchronous');
    expect(result.testing?.enabled).toBe(true);
    expect(result.contacts).toHaveLength(2);
  });

  it('should accept DR plan without failover', () => {
    const result = DisasterRecoveryPlanSchema.parse(minimalPlan);
    expect(result.failover).toBeUndefined();
  });

  it('should accept different replication modes', () => {
    const modes = ['synchronous', 'asynchronous', 'semi_synchronous'] as const;
    modes.forEach(mode => {
      expect(() => DisasterRecoveryPlanSchema.parse({
        ...minimalPlan,
        replication: { mode },
      })).not.toThrow();
    });
  });
});

// Need z import for z.input type usage in tests
import { z } from 'zod';

// #15679 (stack card 4/6 of #14478) — ruling B. The old spelling is a
// `retiredKey()` tombstone; asserted on the issue CODE and the prescription,
// never on a bare `toThrow()`. The second case is the load-bearing half: the
// neighbouring `dns.ttl` is a DECLARED `externalVocabulary` mirror and must
// survive this rename untouched, and no gate can catch its loss (the marker
// exempts the key either way), so the pin is the only guard.
describe('FailoverConfig.healthCheckInterval carries its unit (#15679)', () => {
  const regions = [
    { name: 'us-east-1', role: 'primary' as const },
    { name: 'eu-west-1', role: 'secondary' as const },
  ];

  it('REFUSES the retired `healthCheckInterval` with the rename in the message', () => {
    const result = FailoverConfigSchema.safeParse({ regions, healthCheckInterval: 30 });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === 'healthCheckInterval');
    expect(issue).toBeDefined();
    expect(issue!.code).not.toBe('unrecognized_keys');
    expect(issue!.message).toContain(
      '`FailoverConfig.healthCheckInterval` was renamed to `healthCheckIntervalSeconds`',
    );
  });

  it('accepts `healthCheckIntervalSeconds` and keeps the 30 default', () => {
    expect(FailoverConfigSchema.parse({ regions, healthCheckIntervalSeconds: 15 })
      .healthCheckIntervalSeconds).toBe(15);
    expect(FailoverConfigSchema.parse({ regions }).healthCheckIntervalSeconds).toBe(30);
  });

  it('leaves the sibling `dns.ttl` bare — it is a declared externalVocabulary mirror', () => {
    const parsed = FailoverConfigSchema.parse({
      regions,
      dns: { ttl: 60, provider: 'route53' },
    });
    expect(parsed.dns?.ttl).toBe(60);
  });
});
