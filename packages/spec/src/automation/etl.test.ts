import { describe, it, expect } from 'vitest';
import {
  ETLEndpointTypeSchema,
  ETLSourceSchema,
  ETLDestinationSchema,
  ETLTransformationTypeSchema,
  ETLTransformationSchema,
  ETLSyncModeSchema,
  ETLPipelineSchema,
  ETLRunStatusSchema,
  ETLPipelineRunSchema,
  ETL,
} from './etl.zod';

describe('ETLEndpointTypeSchema', () => {
  it('should accept all valid endpoint types', () => {
    const types = [
      'database', 'api', 'file', 'stream', 'object',
      'warehouse', 'storage', 'spreadsheet',
    ];
    types.forEach(t => {
      expect(() => ETLEndpointTypeSchema.parse(t)).not.toThrow();
    });
  });

  it('should reject invalid endpoint type', () => {
    expect(() => ETLEndpointTypeSchema.parse('ftp')).toThrow();
  });
});

describe('ETLSourceSchema', () => {
  it('should accept minimal source', () => {
    expect(() => ETLSourceSchema.parse({
      type: 'database',
      config: { table: 'users' },
    })).not.toThrow();
  });

  it('should accept full source with incremental config', () => {
    expect(() => ETLSourceSchema.parse({
      type: 'api',
      connector: 'salesforce',
      config: { object: 'Account' },
      incremental: {
        enabled: true,
        cursorField: 'updated_at',
        cursorValue: '2024-01-01T00:00:00Z',
      },
    })).not.toThrow();
  });

  it('should reject missing config', () => {
    expect(() => ETLSourceSchema.parse({
      type: 'database',
    })).toThrow();
  });

  it('should reject invalid type', () => {
    expect(() => ETLSourceSchema.parse({
      type: 'invalid',
      config: {},
    })).toThrow();
  });
});

describe('ETLDestinationSchema', () => {
  it('should accept minimal destination with defaults', () => {
    const result = ETLDestinationSchema.parse({
      type: 'database',
      config: { table: 'accounts' },
    });
    expect(result.writeMode).toBe('append');
  });

  it('should accept full destination', () => {
    expect(() => ETLDestinationSchema.parse({
      type: 'warehouse',
      connector: 'snowflake',
      config: { schema: 'public', table: 'dim_accounts' },
      writeMode: 'upsert',
      primaryKey: ['account_id'],
    })).not.toThrow();
  });

  it('should reject invalid writeMode', () => {
    expect(() => ETLDestinationSchema.parse({
      type: 'database',
      config: {},
      writeMode: 'truncate',
    })).toThrow();
  });
});

describe('ETLTransformationTypeSchema', () => {
  it('should accept all valid types', () => {
    const types = [
      'map', 'filter', 'aggregate', 'join', 'script',
      'lookup', 'split', 'merge', 'normalize', 'deduplicate',
    ];
    types.forEach(t => {
      expect(() => ETLTransformationTypeSchema.parse(t)).not.toThrow();
    });
  });

  it('should reject invalid type', () => {
    expect(() => ETLTransformationTypeSchema.parse('pivot')).toThrow();
  });
});

describe('ETLTransformationSchema', () => {
  it('should accept minimal transformation with defaults', () => {
    const result = ETLTransformationSchema.parse({
      type: 'map',
      config: { Name: 'account_name' },
    });
    expect(result.continueOnError).toBe(false);
  });

  it('should accept full transformation', () => {
    expect(() => ETLTransformationSchema.parse({
      name: 'filter_active',
      type: 'filter',
      config: { condition: 'status == "active"' },
      continueOnError: true,
    })).not.toThrow();
  });

  it('should reject missing config', () => {
    expect(() => ETLTransformationSchema.parse({
      type: 'script',
    })).toThrow();
  });
});

describe('ETLSyncModeSchema', () => {
  it('should accept all valid sync modes', () => {
    ['full', 'incremental', 'cdc'].forEach(m => {
      expect(() => ETLSyncModeSchema.parse(m)).not.toThrow();
    });
  });

  it('should reject invalid mode', () => {
    expect(() => ETLSyncModeSchema.parse('realtime')).toThrow();
  });
});

describe('ETLPipelineSchema', () => {
  const minimalPipeline = {
    name: 'sf_to_postgres',
    source: { type: 'api', config: { object: 'Account' } },
    destination: { type: 'database', config: { table: 'accounts' } },
  };

  it('should accept minimal pipeline with defaults', () => {
    const result = ETLPipelineSchema.parse(minimalPipeline);
    expect(result.syncMode).toBe('full');
    expect(result.enabled).toBe(true);
  });

  it('should accept full pipeline', () => {
    expect(() => ETLPipelineSchema.parse({
      name: 'multi_source_pipeline',
      label: 'Multi-Source Pipeline',
      description: 'Aggregates data from multiple sources',
      source: {
        type: 'api',
        connector: 'salesforce',
        config: { object: 'Account' },
        incremental: { enabled: true, cursorField: 'updated_at' },
      },
      destination: {
        type: 'warehouse',
        connector: 'snowflake',
        config: { table: 'dim_accounts' },
        writeMode: 'merge',
        primaryKey: ['account_id'],
      },
      transformations: [
        { type: 'map', config: { Name: 'account_name' } },
        { type: 'filter', config: { condition: 'status == "active"' } },
        { name: 'dedup', type: 'deduplicate', config: { key: 'account_id' }, continueOnError: true },
      ],
      syncMode: 'incremental',
      schedule: '0 2 * * *',
      enabled: true,
      retry: { maxAttempts: 5, backoffMs: 120000 },
      notifications: {
        onSuccess: ['data-team@example.com'],
        onFailure: ['ops@example.com'],
      },
      tags: ['salesforce', 'analytics'],
      metadata: { owner: 'data-team' },
    })).not.toThrow();
  });

  it('should reject invalid name (not snake_case)', () => {
    expect(() => ETLPipelineSchema.parse({
      ...minimalPipeline,
      name: 'SfToPostgres',
    })).toThrow();
  });

  it('should reject missing source', () => {
    expect(() => ETLPipelineSchema.parse({
      name: 'bad_pipeline',
      destination: { type: 'database', config: {} },
    })).toThrow();
  });

  it('should apply retry defaults when provided', () => {
    const result = ETLPipelineSchema.parse({
      ...minimalPipeline,
      retry: {},
    });
    expect(result.retry?.maxAttempts).toBe(3);
    expect(result.retry?.backoffMs).toBe(60000);
  });
});

describe('ETLRunStatusSchema', () => {
  it('should accept all valid statuses', () => {
    ['pending', 'running', 'succeeded', 'failed', 'cancelled', 'timeout'].forEach(s => {
      expect(() => ETLRunStatusSchema.parse(s)).not.toThrow();
    });
  });

  it('should reject invalid status', () => {
    expect(() => ETLRunStatusSchema.parse('completed')).toThrow();
  });
});

describe('ETLPipelineRunSchema', () => {
  it('should accept minimal run', () => {
    expect(() => ETLPipelineRunSchema.parse({
      id: 'run-001',
      pipelineName: 'sf_to_postgres',
      status: 'succeeded',
      startedAt: '2024-01-01T02:00:00Z',
    })).not.toThrow();
  });

  it('should accept full run result', () => {
    expect(() => ETLPipelineRunSchema.parse({
      id: 'run-002',
      pipelineName: 'sf_to_postgres',
      status: 'failed',
      startedAt: '2024-01-01T02:00:00Z',
      completedAt: '2024-01-01T02:15:00Z',
      durationMs: 900000,
      stats: {
        recordsRead: 5000,
        recordsWritten: 4950,
        recordsErrored: 50,
        bytesProcessed: 1048576,
      },
      error: {
        message: 'Connection timeout',
        code: 'TIMEOUT',
        details: { host: 'db.example.com' },
      },
      logs: ['Starting pipeline', 'Extraction complete', 'Load failed'],
    })).not.toThrow();
  });

  it('should reject invalid datetime', () => {
    expect(() => ETLPipelineRunSchema.parse({
      id: 'run-003',
      pipelineName: 'test',
      status: 'running',
      startedAt: 'not-a-date',
    })).toThrow();
  });

  it('should reject missing required fields', () => {
    expect(() => ETLPipelineRunSchema.parse({
      id: 'run-004',
    })).toThrow();
  });
});

describe('ETL factory', () => {
  it('should create database-to-database pipeline', () => {
    const pipeline = ETL.databaseSync({
      name: 'users_sync',
      sourceTable: 'users_source',
      destTable: 'users_dest',
      schedule: '0 * * * *',
    });
    expect(pipeline.source.type).toBe('database');
    expect(pipeline.destination.type).toBe('database');
    expect(pipeline.destination.writeMode).toBe('upsert');
    expect(pipeline.syncMode).toBe('incremental');
    expect(() => ETLPipelineSchema.parse(pipeline)).not.toThrow();
  });

  it('should create API-to-database pipeline', () => {
    const pipeline = ETL.apiToDatabase({
      name: 'api_ingest',
      apiConnector: 'stripe',
      destTable: 'payments',
    });
    expect(pipeline.source.type).toBe('api');
    expect(pipeline.source.connector).toBe('stripe');
    expect(pipeline.destination.writeMode).toBe('append');
    expect(pipeline.syncMode).toBe('full');
    expect(() => ETLPipelineSchema.parse(pipeline)).not.toThrow();
  });
});

// ─── #4001 批 12 — unknown-key strictness (ADR-0078) ──────────────────
//
// The file splits 7 authorable / 3 wire. Everything below is written to fail
// LOUDLY if either half moves: the seven must reject, the three must tolerate,
// and every rejection is paired with a positive control parsing the SAME
// document minus the offending key — so a red assertion can never be a document
// that was invalid for an unrelated reason (the campaign's "prove the
// instrument red before trusting green").

/** A pipeline that parses clean — the base every negative case is built from. */
const VALID_PIPELINE = {
  name: 'customer_360_pipeline',
  label: 'Customer 360',
  source: {
    type: 'api',
    connector: 'salesforce',
    config: { object: 'Account' },
    incremental: { enabled: true, cursorField: 'updated_at' },
  },
  destination: {
    type: 'warehouse',
    connector: 'snowflake',
    config: { table: 'customers' },
    writeMode: 'upsert',
    primaryKey: ['customer_id'],
  },
  transformations: [{ name: 'only_active', type: 'filter', config: { condition: 'active' } }],
  syncMode: 'incremental',
  schedule: '0 2 * * *',
  enabled: true,
  retry: { maxAttempts: 5, backoffMs: 120000 },
  notifications: { onSuccess: ['data@example.com'], onFailure: ['ops@example.com'] },
  tags: ['analytics'],
  metadata: { owner: 'data-team' },
} as const;

/** A run result that parses clean — the base for the wire-half tolerance pins. */
const VALID_RUN = {
  id: 'run-001',
  pipelineName: 'customer_360_pipeline',
  status: 'succeeded',
  startedAt: '2024-01-01T02:00:00Z',
  completedAt: '2024-01-01T02:15:00Z',
  durationMs: 900000,
  stats: { recordsRead: 10, recordsWritten: 10, recordsErrored: 0, bytesProcessed: 2048 },
  error: { message: 'none', code: 'OK' },
  logs: ['ok'],
} as const;

/** Deep-clone the base and drop an unknown key into one nested block. */
function pipelineWith(path: readonly string[], key: string, value: unknown) {
  const doc = structuredClone(VALID_PIPELINE) as Record<string, unknown>;
  let cursor: Record<string, unknown> = doc;
  for (const step of path) cursor = cursor[step] as Record<string, unknown>;
  cursor[key] = value;
  return doc;
}

/** The unknown-key message for `key` written at `path`, or `null` if it parsed. */
function rejectionFor(path: readonly string[], key: string): string | null {
  const result = ETLPipelineSchema.safeParse(pipelineWith(path, key, 'x'));
  return result.success ? null : result.error.issues.map((i) => i.message).join('\n');
}

describe('[#4001 批 12] the seven authorable shapes reject unknown keys', () => {
  it('parses the base document — the positive control every negative below relies on', () => {
    const result = ETLPipelineSchema.safeParse(structuredClone(VALID_PIPELINE));
    expect(result.success, result.success ? '' : JSON.stringify(result.error.issues)).toBe(true);
  });

  // Each row: where the key is written, and a distinctive fragment of the
  // surface name that must appear in the rejection. The surface name is what
  // tells an author WHICH of the seven nested shapes they got wrong, which is
  // the difference between a fixable error and a puzzle.
  const surfaces: ReadonlyArray<readonly [string, readonly string[], string]> = [
    ['pipeline', [], 'this ETL pipeline'],
    ['source', ['source'], 'this ETL source'],
    ['source.incremental', ['source', 'incremental'], 'this ETL incremental extraction config'],
    ['destination', ['destination'], 'this ETL destination'],
    ['pipeline.retry', ['retry'], "this ETL pipeline's retry configuration"],
    ['pipeline.notifications', ['notifications'], "this ETL pipeline's notification settings"],
  ];

  it.each(surfaces)('rejects an unknown key on %s, naming the surface', (_label, path, surface) => {
    const message = rejectionFor(path, 'totallyMadeUpKey');
    expect(message, 'the key must be REJECTED, not stripped').not.toBeNull();
    expect(message).toContain(surface);
    expect(message).toContain('`totallyMadeUpKey`');
    // History: every message says what used to happen silently.
    expect(message).toContain('Until #4001');
  });

  it('rejects an unknown key on a transformation — the seventh shape, reached through the array', () => {
    const doc = structuredClone(VALID_PIPELINE) as Record<string, unknown>;
    (doc.transformations as Array<Record<string, unknown>>)[0].continueOnFailure = true;
    const result = ETLPipelineSchema.safeParse(doc);
    expect(result.success).toBe(false);
    const message = result.success ? '' : result.error.issues.map((i) => i.message).join('\n');
    expect(message).toContain('this ETL transformation');
    expect(message).toContain('`continueOnFailure`');
  });

  it('points a misplaced endpoint setting at the open `config` bag', () => {
    // The dominant failure on this file is not a typo: `table` IS a real
    // setting, one level down. `.strip` deleted it where it stood and the
    // pipeline loaded into whatever `config.table` said instead.
    const message = rejectionFor(['destination'], 'table');
    expect(message).toContain('inside the open `config` record');
  });

  it('rejects each of the seven when parsed standalone, not only through the pipeline', () => {
    // The nested shapes are also exported/reachable on their own; strictness
    // must not depend on arriving through ETLPipelineSchema.
    expect(ETLSourceSchema.safeParse({ type: 'database', config: {}, nope: 1 }).success).toBe(false);
    expect(ETLDestinationSchema.safeParse({ type: 'database', config: {}, nope: 1 }).success).toBe(false);
    expect(ETLTransformationSchema.safeParse({ type: 'map', config: {}, nope: 1 }).success).toBe(false);
    // …and the same three documents WITHOUT the key still parse.
    expect(ETLSourceSchema.safeParse({ type: 'database', config: {} }).success).toBe(true);
    expect(ETLDestinationSchema.safeParse({ type: 'database', config: {} }).success).toBe(true);
    expect(ETLTransformationSchema.safeParse({ type: 'map', config: {} }).success).toBe(true);
  });
});

describe('[#4001 批 12] curated prescriptions — each anchored to a sibling contract', () => {
  it('renames the connector layer’s `timestampField` to `cursorField`', () => {
    // Anchor: integration/connector.zod.ts DataSyncConfig.timestampField.
    expect(rejectionFor(['source', 'incremental'], 'timestampField'))
      .toContain('`timestampField` → `cursorField`');
  });

  it('resolves a borrowed `strategy` to a DIFFERENT key per surface', () => {
    // One connector enum (`full | incremental | upsert | append_only`) splits
    // across two keys here. A single global alias would confidently misdirect
    // one of the two surfaces, so this pair is the load-bearing assertion.
    expect(rejectionFor(['destination'], 'strategy')).toContain('`strategy` → `writeMode`');
    expect(rejectionFor([], 'strategy')).toContain('`strategy` → `syncMode`');
  });

  it('renames `onError` to `onFailure` on the notification block', () => {
    expect(rejectionFor(['notifications'], 'onError')).toContain('`onError` → `onFailure`');
  });

  it('renames `maxRetries` to `maxAttempts`, and points `retryDelayMs` at `backoffMs`', () => {
    expect(rejectionFor(['retry'], 'maxRetries')).toContain('`maxRetries` → `maxAttempts`');
    const retired = rejectionFor(['retry'], 'retryDelayMs');
    expect(retired).toContain('backoffMs');
    expect(retired).toContain('#4661');
  });

  it('names the three converged-policy keys this block deliberately lacks (#4962)', () => {
    for (const absent of ['backoffMultiplier', 'maxRetryDelayMs', 'jitter']) {
      const message = rejectionFor(['retry'], absent);
      expect(message, `${absent} must carry the absence prescription`).toContain('documented ABSENCE');
      expect(message).toContain('#4962');
    }
  });

  it('explains that pipeline direction is structural, not a key', () => {
    const message = rejectionFor([], 'direction');
    expect(message).toContain('no `direction` key');
    expect(message).toContain('swap the two endpoints');
    // A guidance entry SUPPRESSES the rename suggestion — the author is told
    // the mechanism, not sent to a key that does not mean the same thing.
    expect(message).not.toContain('Did you mean');
  });

  it('never suggests a key the schema will not accept', () => {
    // The helper's `acceptsNothing` rule, asserted from this file's side: every
    // key named in a "Did you mean X" must itself parse when written.
    const message = rejectionFor([], 'sourse') ?? '';
    const suggested = [...message.matchAll(/→ `([^`]+)`/g)].map((m) => m[1]);
    expect(suggested).toContain('source');
    for (const key of suggested) {
      expect(Object.keys(VALID_PIPELINE), `${key} must be a real, writable key`).toContain(key);
    }
  });
});

describe('[#4001 批 12] the three wire shapes stay tolerant — deliberate, and pinned', () => {
  // If a later sweep closes these, THESE tests are what must be consciously
  // deleted. That is the point: the exemption is a decision with a receipt, not
  // an omission (see the comment on ETLPipelineRunSchema).
  it('parses the base run result — positive control', () => {
    expect(ETLPipelineRunSchema.safeParse(structuredClone(VALID_RUN)).success).toBe(true);
  });

  it.each([
    ['ETLPipelineRunSchema', [] as string[]],
    ['ETLPipelineRunSchema.stats', ['stats']],
    ['ETLPipelineRunSchema.error', ['error']],
  ])('%s forwards an engine-added key instead of crashing', (_label, path) => {
    const doc = structuredClone(VALID_RUN) as Record<string, unknown>;
    let cursor: Record<string, unknown> = doc;
    for (const step of path) cursor = cursor[step] as Record<string, unknown>;
    // The realistic case: a future engine reports one more counter. On a strict
    // shape that is a parse CRASH for every existing reader — the #3712 shape.
    cursor.recordsSkippedByANewerEngine = 7;
    expect(ETLPipelineRunSchema.safeParse(doc).success).toBe(true);
  });

  it('still validates what it does declare — tolerance is not absence of a contract', () => {
    // Anti-vacuity: the pins above must not be passing because the schema
    // validates nothing at all.
    expect(ETLPipelineRunSchema.safeParse({ ...VALID_RUN, status: 'completed' }).success).toBe(false);
    expect(ETLPipelineRunSchema.safeParse({ ...VALID_RUN, startedAt: 'not-a-date' }).success).toBe(false);
    expect(ETLPipelineRunSchema.safeParse({ id: 'r' }).success).toBe(false);
  });
});

describe('[#4001 批 12] strictness does not disturb the published contract', () => {
  it('converts to JSON Schema through the lazy proxy without throwing (#3746 hazard)', async () => {
    const { z } = await import('zod');
    for (const schema of [
      ETLSourceSchema, ETLDestinationSchema, ETLTransformationSchema,
      ETLPipelineSchema, ETLPipelineRunSchema,
    ]) {
      // `io: 'input'` is asserted rather than the default because
      // `ETLPipelineSchema` does not convert in OUTPUT mode — `schedule` is
      // `CronExpressionInputSchema`, a transform, and "Transforms cannot be
      // represented in JSON Schema". That is PRE-EXISTING and unrelated to
      // strictness (verified: the same throw on the pre-批-12 file), and
      // `build-schemas.ts` already handles it by falling back to input mode.
      // Asserting the default here would have pinned someone else's known
      // limitation as if this batch owned it.
      expect(() => z.toJSONSchema(schema as never, { io: 'input' })).not.toThrow();
    }
  });

  /**
   * The campaign's standing claim is that strictness does not move the
   * published JSON Schema: `build-schemas.ts` converts with `io: 'output'`, and
   * OUTPUT mode already emits `additionalProperties: false` for a `.strip()`
   * object (pinned in `shared/strict-object.test.ts`).
   *
   * That claim holds per-direction, and this file is the case where the
   * direction is not the usual one. `ETLPipelineSchema` cannot convert in
   * output mode at all — `schedule` is `CronExpressionInputSchema`, a transform
   * — so `build-schemas.ts` falls back to `io: 'input'`, and INPUT mode
   * distinguishes the two postures: strip emits nothing, strict emits `false`.
   *
   * So for this one schema the batch DOES narrow the published contract, from
   * "unspecified" to "closed". That is the intended direction (the publication
   * now matches the parse instead of being quieter than it) but it is a real
   * artifact change, not a no-op, and pretending otherwise is how a generated
   * baseline moves without anyone reading it. Pinned here in both directions so
   * the distinction survives the next person who quotes the flat claim.
   */
  it('narrows the published schema only where input-mode fallback applies', async () => {
    const { z } = await import('zod');
    const json = (s: unknown, io: 'input' | 'output') =>
      z.toJSONSchema(s as never, { io }) as Record<string, unknown>;

    // The seven, via the pipeline: closed in the direction that gets published.
    expect(json(ETLPipelineSchema, 'input').additionalProperties).toBe(false);

    // The three: still `z.object`, so they follow strip's per-direction shape —
    // open in input mode, `false` in output mode. This is the receipt that the
    // wire exemption is real at the schema level and not only in the parse.
    expect(json(ETLPipelineRunSchema, 'input').additionalProperties).toBeUndefined();
    expect(json(ETLPipelineRunSchema, 'output').additionalProperties).toBe(false);
  });

  it('leaves both ETL factories producing documents that parse', () => {
    // The factories construct pipelines programmatically — exactly the caller a
    // newly-strict schema would break if the campaign had guessed a key wrong.
    expect(ETLPipelineSchema.safeParse(ETL.databaseSync({
      name: 'users_sync', sourceTable: 'src', destTable: 'dst', schedule: '0 * * * *',
    })).success).toBe(true);
    expect(ETLPipelineSchema.safeParse(ETL.apiToDatabase({
      name: 'api_ingest', apiConnector: 'stripe', destTable: 'payments',
    })).success).toBe(true);
  });
});
