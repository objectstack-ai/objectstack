import { describe, it, expect } from 'vitest';
import { SeedSchema, SeedMode, type Seed } from './seed.zod';

describe('SeedMode', () => {
  it('should accept valid dataset modes', () => {
    const validModes = ['insert', 'update', 'upsert', 'replace', 'ignore'];
    
    validModes.forEach(mode => {
      expect(() => SeedMode.parse(mode)).not.toThrow();
    });
  });

  it('should reject invalid modes', () => {
    expect(() => SeedMode.parse('merge')).toThrow();
    expect(() => SeedMode.parse('delete')).toThrow();
    expect(() => SeedMode.parse('')).toThrow();
  });
});

describe('SeedSchema', () => {
  it('should accept valid minimal dataset', () => {
    const validDataset: Seed = {
      object: 'user',
      records: [
        { name: 'John', email: 'john@example.com' },
        { name: 'Jane', email: 'jane@example.com' }
      ]
    };

    expect(() => SeedSchema.parse(validDataset)).not.toThrow();
  });

  it('should accept dataset with all fields', () => {
    const fullDataset: Seed = {
      object: 'account',
      externalId: 'code',
      mode: 'upsert',
      env: ['prod', 'dev', 'test'],
      records: [
        { code: 'ACC001', name: 'Acme Corp' },
        { code: 'ACC002', name: 'Beta Inc' }
      ]
    };

    expect(() => SeedSchema.parse(fullDataset)).not.toThrow();
  });

  it('should apply default values', () => {
    const dataset = SeedSchema.parse({
      object: 'product',
      records: [{ name: 'Widget' }]
    });

    expect(dataset.externalId).toBe('name');
    expect(dataset.mode).toBe('upsert');
    expect(dataset.env).toEqual(['prod', 'dev', 'test']);
  });

  it('should validate object name format (snake_case)', () => {
    expect(() => SeedSchema.parse({
      object: 'valid_object_name',
      records: []
    })).not.toThrow();

    expect(() => SeedSchema.parse({
      object: 'InvalidObject',
      records: []
    })).toThrow();

    expect(() => SeedSchema.parse({
      object: 'invalid-object',
      records: []
    })).toThrow();
  });

  it('should accept different modes', () => {
    const modes: Array<Seed['mode']> = ['insert', 'update', 'upsert', 'replace', 'ignore'];
    
    modes.forEach(mode => {
      const dataset = SeedSchema.parse({
        object: 'test_object',
        mode,
        records: []
      });
      expect(dataset.mode).toBe(mode);
    });
  });

  it('should accept environment scopes', () => {
    const dataset1 = SeedSchema.parse({
      object: 'test_object',
      env: ['dev'],
      records: []
    });
    expect(dataset1.env).toEqual(['dev']);

    const dataset2 = SeedSchema.parse({
      object: 'test_object',
      env: ['prod', 'test'],
      records: []
    });
    expect(dataset2.env).toEqual(['prod', 'test']);
  });

  it('should reject invalid environment values', () => {
    expect(() => SeedSchema.parse({
      object: 'test_object',
      env: ['production'],
      records: []
    })).toThrow();

    expect(() => SeedSchema.parse({
      object: 'test_object',
      env: ['staging'],
      records: []
    })).toThrow();
  });

  it('should accept empty records array', () => {
    const dataset = SeedSchema.parse({
      object: 'empty_table',
      records: []
    });

    expect(dataset.records).toEqual([]);
  });

  it('should accept records with various data types', () => {
    const dataset = SeedSchema.parse({
      object: 'mixed_data',
      records: [
        {
          string: 'text',
          number: 42,
          boolean: true,
          null_value: null,
          object: { nested: 'value' },
          array: [1, 2, 3]
        }
      ]
    });

    expect(dataset.records[0]).toHaveProperty('string', 'text');
    expect(dataset.records[0]).toHaveProperty('number', 42);
    expect(dataset.records[0]).toHaveProperty('boolean', true);
  });

  it('should validate externalId field name', () => {
    const validExternalIds = ['name', 'code', 'external_id', 'username', 'slug'];

    validExternalIds.forEach(externalId => {
      expect(() => SeedSchema.parse({
        object: 'test_object',
        externalId,
        records: []
      })).not.toThrow();
    });
  });

  it('should accept a composite externalId (join-table natural key, #3434)', () => {
    const dataset = SeedSchema.parse({
      object: 'team_project_membership',
      externalId: ['team', 'project'],
      mode: 'ignore',
      records: [{ team: 'Experience', project: 'Website Relaunch' }],
    });

    expect(dataset.externalId).toEqual(['team', 'project']);
    expect(dataset.mode).toBe('ignore');
  });

  it('should reject an empty composite externalId', () => {
    expect(() => SeedSchema.parse({
      object: 'test_object',
      externalId: [],
      records: [],
    })).toThrow();
  });

  it('should handle seed data use case', () => {
    const seedData = SeedSchema.parse({
      object: 'country',
      externalId: 'code',
      mode: 'upsert',
      env: ['prod', 'dev', 'test'],
      records: [
        { code: 'US', name: 'United States' },
        { code: 'CA', name: 'Canada' },
        { code: 'MX', name: 'Mexico' }
      ]
    });

    expect(seedData.records).toHaveLength(3);
    expect(seedData.mode).toBe('upsert');
  });

  it('should handle demo data use case', () => {
    const demoData = SeedSchema.parse({
      object: 'project',
      externalId: 'name',
      mode: 'replace',
      env: ['dev'],
      records: [
        { name: 'Demo Project 1', status: 'active' },
        { name: 'Demo Project 2', status: 'completed' }
      ]
    });

    expect(demoData.env).toEqual(['dev']);
    expect(demoData.mode).toBe('replace');
  });

  it('should handle test data use case', () => {
    const testData = SeedSchema.parse({
      object: 'test_user',
      mode: 'ignore',
      env: ['test'],
      records: [
        { name: 'Test User', email: 'test@example.com' }
      ]
    });

    expect(testData.env).toEqual(['test']);
    expect(testData.mode).toBe('ignore');
  });

  it('should reject dataset without required fields', () => {
    expect(() => SeedSchema.parse({
      records: []
    })).toThrow();

    expect(() => SeedSchema.parse({
      object: 'test_object'
    })).toThrow();
  });

  it('should reject invalid mode value', () => {
    expect(() => SeedSchema.parse({
      object: 'test_object',
      mode: 'invalid_mode',
      records: []
    })).toThrow();
  });

  // ── Locale scope (#16510) ────────────────────────────────────────────────
  //
  // The shape is `strictObject`, so before this key existed an app could not
  // add it at all: `locale` was REJECTED, and the only place to select between
  // two language markets' datasets was application code, at config-assembly
  // time. These pin the accept/reject behaviour that changed.

  describe('locale scope', () => {
    const withLocale = (locale: unknown) =>
      SeedSchema.safeParse({ object: 'plan', locale, records: [] });

    it('accepts a locale scope', () => {
      // Key REACHABILITY: the shape is strict, so a key it does not declare
      // surfaces as `unrecognized_keys`. Assert the WHOLE parse succeeds, so
      // this cannot pass while the key is rejected for some other reason.
      const parsed = withLocale(['zh-CN']);
      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data.locale).toEqual(['zh-CN']);
    });

    it('accepts a multi-locale scope', () => {
      const parsed = withLocale(['en', 'en-GB']);
      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data.locale).toEqual(['en', 'en-GB']);
    });

    it('leaves locale ABSENT when it is not written — absence is "every locale"', () => {
      // Deliberately NOT defaulted the way `env` is: locales are open-ended
      // BCP-47 tags with no enumerable universe to spell out as a default, so
      // the unrestricted spelling has to be absence.
      const parsed = SeedSchema.parse({ object: 'plan', records: [] });
      expect(parsed.locale).toBeUndefined();
      expect('locale' in parsed).toBe(false);
    });

    it('rejects an empty locale array — a dataset that applies nowhere is a mistake', () => {
      expect(withLocale([]).success).toBe(false);
    });

    it('rejects a bare string — the scope is a LIST, like env', () => {
      expect(withLocale('zh-CN').success).toBe(false);
    });

    it('points the plural and language spellings at `locale`', () => {
      for (const alias of ['locales', 'language', 'languages']) {
        const parsed = SeedSchema.safeParse({
          object: 'plan',
          [alias]: ['zh-CN'],
          records: [],
        });
        expect(parsed.success, `${alias} should be rejected`).toBe(false);
        const message = parsed.success ? '' : JSON.stringify(parsed.error.issues);
        expect(message, `${alias} should be pointed at \`locale\``).toContain('locale');
      }
    });
  });

  it('should handle large datasets', () => {
    const largeDataset = SeedSchema.parse({
      object: 'bulk_data',
      records: Array.from({ length: 1000 }, (_, i) => ({
        id: i,
        name: `Record ${i}`
      }))
    });

    expect(largeDataset.records).toHaveLength(1000);
  });
});
