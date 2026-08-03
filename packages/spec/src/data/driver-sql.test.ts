import { describe, it, expect } from 'vitest';
import {
  SQLDialectSchema,
  DataTypeMappingSchema,
  SSLConfigSchema,
  SQLDriverConfigSchema,
  type SQLDialect,
  type DataTypeMapping,
  type SSLConfig,
  type SQLDriverConfig,
} from './driver-sql.zod';

describe('SQLDialectSchema', () => {
  it('should accept valid SQL dialects', () => {
    const validDialects = [
      'postgresql',
      'mysql',
      'sqlite',
      'mssql',
      'oracle',
      'mariadb',
    ];

    validDialects.forEach(dialect => {
      expect(() => SQLDialectSchema.parse(dialect)).not.toThrow();
    });
  });

  it('should reject invalid SQL dialects', () => {
    expect(() => SQLDialectSchema.parse('mongodb')).toThrow();
    expect(() => SQLDialectSchema.parse('redis')).toThrow();
    expect(() => SQLDialectSchema.parse('')).toThrow();
  });
});

describe('DataTypeMappingSchema', () => {
  it('should accept valid PostgreSQL data type mapping', () => {
    const mapping: DataTypeMapping = {
      text: 'VARCHAR(255)',
      number: 'NUMERIC',
      boolean: 'BOOLEAN',
      date: 'DATE',
      datetime: 'TIMESTAMP',
      json: 'JSONB',
      uuid: 'UUID',
      binary: 'BYTEA',
    };

    expect(() => DataTypeMappingSchema.parse(mapping)).not.toThrow();
  });

  it('should accept MySQL data type mapping without optional fields', () => {
    const mapping: DataTypeMapping = {
      text: 'VARCHAR(255)',
      number: 'DECIMAL(10,2)',
      boolean: 'TINYINT(1)',
      date: 'DATE',
      datetime: 'DATETIME',
    };

    expect(() => DataTypeMappingSchema.parse(mapping)).not.toThrow();
  });

  it('should require basic data type mappings', () => {
    const incomplete = {
      text: 'VARCHAR(255)',
      // missing required fields
    };

    const result = DataTypeMappingSchema.safeParse(incomplete);
    expect(result.success).toBe(false);
  });
});

describe('SSLConfigSchema', () => {
  it('should accept SSL configuration with all fields', () => {
    const sslConfig: SSLConfig = {
      rejectUnauthorized: true,
      ca: '/path/to/ca.pem',
      cert: '/path/to/cert.pem',
      key: '/path/to/key.pem',
    };

    expect(() => SSLConfigSchema.parse(sslConfig)).not.toThrow();
  });

  it('should accept minimal SSL configuration', () => {
    const sslConfig: SSLConfig = {
      rejectUnauthorized: false,
    };

    expect(() => SSLConfigSchema.parse(sslConfig)).not.toThrow();
  });

  it('should use default for rejectUnauthorized', () => {
    const sslConfig = {
      ca: '/path/to/ca.pem',
    };

    const result = SSLConfigSchema.parse(sslConfig);
    expect(result.rejectUnauthorized).toBe(true);
  });

  it('should reject SSL config with cert but no key', () => {
    const sslConfig = {
      cert: '/path/to/cert.pem',
      // missing key
    };

    const result = SSLConfigSchema.safeParse(sslConfig);
    expect(result.success).toBe(false);
  });

  it('should reject SSL config with key but no cert', () => {
    const sslConfig = {
      key: '/path/to/key.pem',
      // missing cert
    };

    const result = SSLConfigSchema.safeParse(sslConfig);
    expect(result.success).toBe(false);
  });

  it('should accept SSL config with both cert and key', () => {
    const sslConfig = {
      cert: '/path/to/cert.pem',
      key: '/path/to/key.pem',
    };

    const result = SSLConfigSchema.safeParse(sslConfig);
    expect(result.success).toBe(true);
  });
});

describe('SQLDriverConfigSchema', () => {
  it('should accept complete PostgreSQL driver configuration', () => {
    const config: SQLDriverConfig = {
      name: 'primary-db',
      type: 'sql',
      dialect: 'postgresql',
      connectionString: 'postgresql://user:pass@localhost:5432/mydb',
      dataTypeMapping: {
        text: 'VARCHAR(255)',
        number: 'NUMERIC',
        boolean: 'BOOLEAN',
        date: 'DATE',
        datetime: 'TIMESTAMP',
        json: 'JSONB',
        uuid: 'UUID',
        binary: 'BYTEA',
      },
      ssl: true,
      sslConfig: {
        rejectUnauthorized: true,
        ca: '/etc/ssl/certs/ca.pem',
      },
      poolConfig: {
        min: 2,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      },
      // #4634: only the live bits are authorable — the 31 inert bits the old
      // block spelled out are tombstoned and now fail the parse.
      capabilities: {
        queryDateGranularity: { day: true, week: true, month: true, quarter: true, year: true },
        autonumber: true,
        batchSchemaSync: false,
      },
    };

    expect(() => SQLDriverConfigSchema.parse(config)).not.toThrow();
  });

  it('should accept MySQL driver configuration', () => {
    const config: SQLDriverConfig = {
      name: 'mysql-db',
      type: 'sql',
      dialect: 'mysql',
      connectionString: 'mysql://user:pass@localhost:3306/mydb',
      dataTypeMapping: {
        text: 'VARCHAR(255)',
        number: 'DECIMAL(10,2)',
        boolean: 'TINYINT(1)',
        date: 'DATE',
        datetime: 'DATETIME',
        json: 'JSON',
        binary: 'BLOB',
      },
      ssl: false,
      capabilities: {
        autonumber: true,
      },
    };

    expect(() => SQLDriverConfigSchema.parse(config)).not.toThrow();
  });

  it('should require type to be "sql"', () => {
    const config = {
      name: 'test-db',
      type: 'nosql', // wrong type
      dialect: 'postgresql',
      dataTypeMapping: {
        text: 'VARCHAR(255)',
        number: 'NUMERIC',
        boolean: 'BOOLEAN',
        date: 'DATE',
        datetime: 'TIMESTAMP',
      },
      capabilities: {},
    };

    const result = SQLDriverConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('should require dialect field', () => {
    const config = {
      name: 'test-db',
      type: 'sql',
      // missing dialect
      dataTypeMapping: {
        text: 'VARCHAR(255)',
        number: 'NUMERIC',
        boolean: 'BOOLEAN',
        date: 'DATE',
        datetime: 'TIMESTAMP',
      },
      capabilities: {},
    };

    const result = SQLDriverConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('should accept SQLite driver configuration without SSL', () => {
    const config: SQLDriverConfig = {
      name: 'sqlite-db',
      type: 'sql',
      dialect: 'sqlite',
      connectionString: ':memory:',
      dataTypeMapping: {
        text: 'TEXT',
        number: 'REAL',
        boolean: 'INTEGER',
        date: 'TEXT',
        datetime: 'TEXT',
      },
      ssl: false,
      // #4634: SQLite's strftime lacks ISO week — a truthful per-granularity
      // advertisement is exactly what the live bit exists for.
      capabilities: {
        queryDateGranularity: { day: true, week: false, month: true, quarter: true, year: true },
        autonumber: true,
      },
    };

    expect(() => SQLDriverConfigSchema.parse(config)).not.toThrow();
  });

  it('should reject SQL driver config with ssl=true but no sslConfig', () => {
    const config = {
      name: 'test-db',
      type: 'sql',
      dialect: 'postgresql',
      connectionString: 'postgresql://localhost/test',
      dataTypeMapping: {
        text: 'VARCHAR(255)',
        number: 'NUMERIC',
        boolean: 'BOOLEAN',
        date: 'DATE',
        datetime: 'TIMESTAMP',
      },
      ssl: true,
      // missing sslConfig
      capabilities: {},
    };

    const result = SQLDriverConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('should accept SQL driver config with ssl=true and sslConfig provided', () => {
    const config = {
      name: 'test-db',
      type: 'sql',
      dialect: 'postgresql',
      connectionString: 'postgresql://localhost/test',
      dataTypeMapping: {
        text: 'VARCHAR(255)',
        number: 'NUMERIC',
        boolean: 'BOOLEAN',
        date: 'DATE',
        datetime: 'TIMESTAMP',
      },
      ssl: true,
      sslConfig: {
        rejectUnauthorized: true,
        ca: '/path/to/ca.pem',
      },
      capabilities: {},
    };

    const result = SQLDriverConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });
});
