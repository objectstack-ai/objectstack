import { describe, it, expect } from 'vitest';
import { MongoConfigSchema, MongoDriverSpec } from './mongo.zod';

describe('MongoConfigSchema', () => {
  it('should accept valid minimal config', () => {
    const config = MongoConfigSchema.parse({
      database: 'mydb',
    });

    expect(config.database).toBe('mydb');
  });

  it('should accept config with connection URI', () => {
    const config = MongoConfigSchema.parse({
      url: 'mongodb://user:pass@host1:27017/mydb?authSource=admin',
      database: 'mydb',
    });

    expect(config.url).toBe('mongodb://user:pass@host1:27017/mydb?authSource=admin');
  });

  it('should accept config with all fields', () => {
    const config = MongoConfigSchema.parse({
      url: 'mongodb://localhost:27017',
      database: 'production',
      host: 'db.example.com',
      port: 27018,
      username: 'admin',
      password: 'secret',
      authSource: 'admin',
      options: {
        ssl: true,
        poolSize: 20,
        retryWrites: true,
      },
    });

    expect(config.database).toBe('production');
    expect(config.host).toBe('db.example.com');
    expect(config.port).toBe(27018);
    expect(config.username).toBe('admin');
    expect(config.authSource).toBe('admin');
    expect(config.options).toBeDefined();
    expect(config.options!.ssl).toBe(true);
  });

  it('should have correct optional field defaults', () => {
    const config = MongoConfigSchema.parse({
      database: 'testdb',
    });

    expect(config.url).toBeUndefined();
    expect(config.username).toBeUndefined();
    expect(config.password).toBeUndefined();
    expect(config.authSource).toBeUndefined();
    expect(config.options).toBeUndefined();
  });

  it('should reject config without database', () => {
    expect(() => MongoConfigSchema.parse({})).toThrow();
    expect(() => MongoConfigSchema.parse({ host: 'localhost' })).toThrow();
  });

  it('should reject config with empty database', () => {
    expect(() => MongoConfigSchema.parse({ database: '' })).toThrow();
  });

  it('should reject config with invalid port type', () => {
    expect(() => MongoConfigSchema.parse({
      database: 'mydb',
      port: 'not_a_number',
    })).toThrow();
  });

  it('should reject config with non-integer port', () => {
    expect(() => MongoConfigSchema.parse({
      database: 'mydb',
      port: 27017.5,
    })).toThrow();
  });

  it('should accept config with extra driver options', () => {
    const config = MongoConfigSchema.parse({
      database: 'mydb',
      options: {
        replicaSet: 'rs0',
        readPreference: 'secondaryPreferred',
        w: 'majority',
        wtimeout: 5000,
      },
    });

    expect(config.options!.replicaSet).toBe('rs0');
  });
});

describe('MongoDriverSpec', () => {
  // `mongodb` since #6345: the canonical driver id was renamed to the spelling
  // both boot hosts and `@objectstack/driver-mongodb` already used, so driver
  // selection and config-contract selection are one string. `mongo` stays an
  // accepted ALIAS — pinned in `config-registry.test.ts`.
  it('should have correct id', () => {
    expect(MongoDriverSpec.id).toBe('mongodb');
  });

  it('should have correct label', () => {
    expect(MongoDriverSpec.label).toBe('MongoDB');
  });

  it('should have a description', () => {
    expect(MongoDriverSpec.description).toBeDefined();
    expect(typeof MongoDriverSpec.description).toBe('string');
  });

  it('should have an icon', () => {
    expect(MongoDriverSpec.icon).toBe('database');
  });
});
