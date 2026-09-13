import { describe, it, expect } from 'vitest';
import {
  LogLevel,
  LogFormat,
  LoggerConfigSchema,
  LogEntrySchema,
  ExtendedLogLevel,
  LogDestinationType,
  ConsoleDestinationConfigSchema,
  FileDestinationConfigSchema,
  HttpDestinationConfigSchema,
  ExternalServiceDestinationConfigSchema,
  LogDestinationSchema,
  LogEnrichmentConfigSchema,
  StructuredLogEntrySchema,
  LoggingConfigSchema,
  type LoggerConfig,
  type LogEntry,
  type LogDestination,
  type StructuredLogEntry,
  type LoggingConfig,
} from './logging.zod';

describe('LogLevel', () => {
  it('should accept valid log levels', () => {
    const levels = ['debug', 'info', 'warn', 'error', 'fatal'];
    
    levels.forEach((level) => {
      expect(() => LogLevel.parse(level)).not.toThrow();
    });
  });

  it('should reject invalid log levels', () => {
    expect(() => LogLevel.parse('invalid')).toThrow();
    expect(() => LogLevel.parse('trace')).toThrow(); // trace is only in ExtendedLogLevel
  });
});

describe('LogFormat', () => {
  it('should accept valid log formats', () => {
    const formats = ['json', 'text', 'pretty'];
    
    formats.forEach((format) => {
      expect(() => LogFormat.parse(format)).not.toThrow();
    });
  });

  it('should reject invalid log formats', () => {
    expect(() => LogFormat.parse('invalid')).toThrow();
  });
});

describe('LoggerConfigSchema', () => {
  it('should accept minimal configuration', () => {
    const config = LoggerConfigSchema.parse({});
    
    expect(config.level).toBe('info');
    expect(config.format).toBe('json');
    expect(config.sourceLocation).toBe(false);
  });

  it('should accept full configuration', () => {
    const config: LoggerConfig = {
      name: 'my-logger',
      level: 'debug',
      format: 'pretty',
      redact: ['apiKey', 'password'],
      sourceLocation: true,
      file: '/var/log/app.log',
      rotation: {
        maxSize: '50m',
        maxFiles: 10,
      },
    };
    
    expect(() => LoggerConfigSchema.parse(config)).not.toThrow();
  });

  it('should apply defaults', () => {
    const config = LoggerConfigSchema.parse({});
    
    expect(config.redact).toEqual(['password', 'token', 'secret', 'key']);
  });
});

describe('LogEntrySchema', () => {
  it('should accept minimal log entry', () => {
    const entry: LogEntry = {
      timestamp: '2024-01-15T10:30:00.000Z',
      level: 'info',
      message: 'Application started',
    };
    
    expect(() => LogEntrySchema.parse(entry)).not.toThrow();
  });

  it('should accept full log entry', () => {
    const entry: LogEntry = {
      timestamp: '2024-01-15T10:30:00.000Z',
      level: 'error',
      message: 'Database connection failed',
      context: { database: 'postgres', attempt: 3 },
      error: { message: 'Connection timeout' },
      traceId: 'abc123',
      spanId: 'def456',
      service: 'api-server',
      component: 'database-pool',
    };
    
    expect(() => LogEntrySchema.parse(entry)).not.toThrow();
  });
});

describe('ExtendedLogLevel', () => {
  it('should accept valid log levels', () => {
    const levels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
    
    levels.forEach((level) => {
      expect(() => ExtendedLogLevel.parse(level)).not.toThrow();
    });
  });

  it('should reject invalid log levels', () => {
    expect(() => ExtendedLogLevel.parse('invalid')).toThrow();
  });
});

describe('LogDestinationType', () => {
  it('should accept valid destination types', () => {
    const types = [
      'console', 'file', 'syslog', 'elasticsearch', 'cloudwatch',
      'stackdriver', 'azure_monitor', 'datadog', 'splunk', 'loki',
      'http', 'kafka', 'redis', 'custom',
    ];
    
    types.forEach((type) => {
      expect(() => LogDestinationType.parse(type)).not.toThrow();
    });
  });
});

describe('ConsoleDestinationConfigSchema', () => {
  it('should apply defaults', () => {
    const config = ConsoleDestinationConfigSchema.parse({});
    
    expect(config.stream).toBe('stdout');
    expect(config.colors).toBe(true);
    expect(config.prettyPrint).toBe(false);
  });

  it('should accept custom values', () => {
    const config = ConsoleDestinationConfigSchema.parse({
      stream: 'stderr',
      colors: false,
      prettyPrint: true,
    });
    
    expect(config.stream).toBe('stderr');
    expect(config.colors).toBe(false);
    expect(config.prettyPrint).toBe(true);
  });
});

describe('FileDestinationConfigSchema', () => {
  it('should accept valid file configuration', () => {
    const config = FileDestinationConfigSchema.parse({
      path: '/var/log/app.log',
    });
    
    expect(config.path).toBe('/var/log/app.log');
    expect(config.encoding).toBe('utf8');
    expect(config.append).toBe(true);
  });

  it('should accept rotation configuration', () => {
    const config = FileDestinationConfigSchema.parse({
      path: '/var/log/app.log',
      rotation: {
        maxSize: '50m',
        maxFiles: 10,
        compress: true,
        interval: 'daily',
      },
    });
    
    expect(config.rotation?.maxSize).toBe('50m');
    expect(config.rotation?.maxFiles).toBe(10);
    expect(config.rotation?.compress).toBe(true);
  });
});

describe('HttpDestinationConfigSchema', () => {
  it('should accept valid HTTP configuration', () => {
    const config = HttpDestinationConfigSchema.parse({
      url: 'https://logs.example.com/v1/logs',
    });
    
    expect(config.url).toBe('https://logs.example.com/v1/logs');
    expect(config.method).toBe('POST');
    // `timeout` → `timeoutMs` (#17782, ruling A on #15939 executing #14478).
    // The 30000 default this pins is unchanged; only the key it is read under
    // moved, so the pin follows the key rather than being dropped.
    expect(config.timeoutMs).toBe(30000);
  });

  it('should accept authentication', () => {
    const config = HttpDestinationConfigSchema.parse({
      url: 'https://logs.example.com/v1/logs',
      auth: {
        type: 'bearer',
        token: 'secret-token',
      },
    });
    
    expect(config.auth?.type).toBe('bearer');
    expect(config.auth?.token).toBe('secret-token');
  });

  it('should accept batch configuration', () => {
    const config = HttpDestinationConfigSchema.parse({
      url: 'https://logs.example.com/v1/logs',
      batch: {
        maxSize: 500,
        // `batch.flushInterval` → `batch.flushIntervalMs` (#17782, ruling A on
        // #15939 executing #14478). Same 10000 milliseconds, new key.
        flushIntervalMs: 10000,
      },
    });
    
    expect(config.batch?.maxSize).toBe(500);
    expect(config.batch?.flushIntervalMs).toBe(10000);
  });
});

describe('LogDestinationSchema', () => {
  it('should accept valid console destination', () => {
    const destination: LogDestination = {
      name: 'console_output',
      type: 'console',
      console: {
        stream: 'stdout',
      },
    };
    
    expect(() => LogDestinationSchema.parse(destination)).not.toThrow();
  });

  it('should accept valid file destination', () => {
    const destination: LogDestination = {
      name: 'file_output',
      type: 'file',
      file: {
        path: '/var/log/app.log',
      },
    };
    
    expect(() => LogDestinationSchema.parse(destination)).not.toThrow();
  });

  it('should apply defaults', () => {
    const destination = LogDestinationSchema.parse({
      name: 'test_dest',
      type: 'console',
    });
    
    expect(destination.level).toBe('info');
    expect(destination.enabled).toBe(true);
    expect(destination.format).toBe('json');
  });

  it('should enforce snake_case naming', () => {
    expect(() => LogDestinationSchema.parse({
      name: 'camelCase',
      type: 'console',
    })).toThrow();

    expect(() => LogDestinationSchema.parse({
      name: 'kebab-case',
      type: 'console',
    })).toThrow();
  });
});

describe('LogEnrichmentConfigSchema', () => {
  it('should apply defaults', () => {
    const config = LogEnrichmentConfigSchema.parse({});
    
    expect(config.addHostname).toBe(true);
    expect(config.addProcessId).toBe(true);
    expect(config.addEnvironment).toBe(true);
    expect(config.addCaller).toBe(false);
    expect(config.addCorrelationIds).toBe(true);
  });

  it('should accept static fields', () => {
    const config = LogEnrichmentConfigSchema.parse({
      staticFields: {
        application: 'my-app',
        version: '1.0.0',
      },
    });
    
    expect(config.staticFields?.application).toBe('my-app');
    expect(config.staticFields?.version).toBe('1.0.0');
  });
});

describe('StructuredLogEntrySchema', () => {
  it('should accept minimal log entry', () => {
    const entry: StructuredLogEntry = {
      timestamp: '2024-01-15T10:30:00.000Z',
      level: 'info',
      message: 'Application started',
    };
    
    expect(() => StructuredLogEntrySchema.parse(entry)).not.toThrow();
  });

  it('should accept full log entry with all fields', () => {
    const entry: StructuredLogEntry = {
      timestamp: '2024-01-15T10:30:00.000Z',
      level: 'error',
      message: 'Database connection failed',
      context: { database: 'postgres', attempt: 3 },
      error: {
        name: 'ConnectionError',
        message: 'Connection timeout',
        stack: 'Error: ...',
      },
      trace: {
        traceId: 'abc123',
        spanId: 'def456',
      },
      source: {
        service: 'api-server',
        component: 'database-pool',
        file: 'db.ts',
        line: 42,
      },
      host: {
        hostname: 'server-01',
        pid: 1234,
      },
      environment: 'production',
      user: {
        id: 'user-123',
        username: 'john',
      },
    };
    
    expect(() => StructuredLogEntrySchema.parse(entry)).not.toThrow();
  });
});

describe('LoggingConfigSchema', () => {
  it('should accept minimal configuration', () => {
    const config: LoggingConfig = {
      name: 'default_logging',
      label: 'Default Logging',
      destinations: [
        {
          name: 'console',
          type: 'console',
        },
      ],
    };
    
    expect(() => LoggingConfigSchema.parse(config)).not.toThrow();
  });

  it('should accept configuration with default logger', () => {
    const config: LoggingConfig = {
      name: 'app_logging',
      label: 'Application Logging',
      default: {
        level: 'info',
        format: 'json',
      },
      destinations: [
        {
          name: 'console',
          type: 'console',
        },
      ],
    };
    
    const parsed = LoggingConfigSchema.parse(config);
    expect(parsed.default).toBeDefined();
    expect(parsed.default?.level).toBe('info');
  });

  it('should accept configuration with named loggers', () => {
    const config: LoggingConfig = {
      name: 'multi_logger',
      label: 'Multi Logger',
      default: {
        level: 'info',
      },
      loggers: {
        database: {
          level: 'debug',
          format: 'json',
        },
        http: {
          level: 'warn',
          format: 'text',
        },
      },
      destinations: [],
    };
    
    const parsed = LoggingConfigSchema.parse(config);
    expect(parsed.loggers).toBeDefined();
    expect(parsed.loggers?.database).toBeDefined();
    expect(parsed.loggers?.database.level).toBe('debug');
    expect(parsed.loggers?.http.level).toBe('warn');
  });

  it('should apply defaults', () => {
    const config = LoggingConfigSchema.parse({
      name: 'test_logging',
      label: 'Test Logging',
      destinations: [],
    });
    
    expect(config.enabled).toBe(true);
    expect(config.level).toBe('info');
    expect(config.redact).toContain('password');
    expect(config.redact).toContain('apiKey');
  });

  it('should accept full configuration', () => {
    const config: LoggingConfig = {
      name: 'production_logging',
      label: 'Production Logging',
      enabled: true,
      level: 'warn',
      default: {
        level: 'info',
        format: 'json',
      },
      loggers: {
        app: {
          level: 'debug',
        },
      },
      destinations: [
        {
          name: 'console_dest',
          type: 'console',
          level: 'info',
        },
        {
          name: 'file_dest',
          type: 'file',
          file: {
            path: '/var/log/app.log',
            rotation: {
              maxSize: '100m',
              maxFiles: 7,
            },
          },
        },
      ],
      enrichment: {
        staticFields: { app: 'my-app' },
        addHostname: true,
      },
      sampling: {
        enabled: true,
        rate: 0.8,
      },
      buffer: {
        enabled: true,
        size: 5000,
        // `buffer.flushInterval` → `buffer.flushIntervalMs` (#17782, ruling A
        // on #15939 executing #14478). Same 2000 milliseconds, new key.
        flushIntervalMs: 2000,
      },
    };
    
    expect(() => LoggingConfigSchema.parse(config)).not.toThrow();
  });

  it('should enforce snake_case naming', () => {
    expect(() => LoggingConfigSchema.parse({
      name: 'CamelCase',
      label: 'Test',
      destinations: [],
    })).toThrow();
  });

  it('should enforce max length for name', () => {
    const longName = 'a'.repeat(65);
    expect(() => LoggingConfigSchema.parse({
      name: longName,
      label: 'Test',
      destinations: [],
    })).toThrow();
  });
});

// #15939 ruling A (executing #14478) — the four duration keys on this file that
// named milliseconds in a source JSDoc and nowhere an author or a reference-page
// reader could see it: `.describe()` was absent on all four, so
// `content/docs/references/system/logging.mdx` published a bare number. Each is
// renamed with the unit in the key and the old spelling left as a `retiredKey`
// tombstone — none of the four enclosing objects is `.strict()`, so a bare
// deletion would have stripped the value in silence.
//
// `flushInterval` was declared TWICE on this file, in two different defs with
// two different defaults, so each def is pinned separately below: they are
// different keys and each carries its own prescription.
describe('logging duration keys → *Ms (#17782, #15939, #14478)', () => {
  describe('HttpDestinationConfig.batch.flushInterval → flushIntervalMs', () => {
    it('REFUSES the retired spelling with a rename naming `flushIntervalMs`', () => {
      const result = HttpDestinationConfigSchema.safeParse({
        url: 'https://logs.example.com/v1/logs',
        batch: { flushInterval: 5000 },
      });
      expect(result.success).toBe(false);
      const issue = result.error!.issues.find((i) => i.path.join('.') === 'batch.flushInterval');
      expect(issue).toBeDefined();
      expect(issue!.message).toMatch(
        /`HttpDestinationConfig\.batch\.flushInterval` was renamed.*Rename the key to `flushIntervalMs`/s,
      );
    });

    it('accepts the suffixed key at the magnitude the retired key carried, with the same default', () => {
      const parsed = HttpDestinationConfigSchema.parse({
        url: 'https://logs.example.com/v1/logs',
        batch: { flushIntervalMs: 10000 },
      });
      expect(parsed.batch?.flushIntervalMs).toBe(10000);
      expect(parsed.batch).not.toHaveProperty('flushInterval');
      expect(
        HttpDestinationConfigSchema.parse({
          url: 'https://logs.example.com/v1/logs',
          batch: {},
        }).batch?.flushIntervalMs,
      ).toBe(5000);
    });

    it('publishes the unit in the describe — the text the reference pages render', () => {
      const batch = HttpDestinationConfigSchema.shape.batch.unwrap();
      expect(batch.shape.flushIntervalMs.description).toBe('Flush interval in milliseconds');
    });
  });

  describe('HttpDestinationConfig.retry.initialDelay → initialDelayMs', () => {
    it('REFUSES the retired spelling with a rename naming `initialDelayMs`', () => {
      const result = HttpDestinationConfigSchema.safeParse({
        url: 'https://logs.example.com/v1/logs',
        retry: { initialDelay: 1000 },
      });
      expect(result.success).toBe(false);
      const issue = result.error!.issues.find((i) => i.path.join('.') === 'retry.initialDelay');
      expect(issue).toBeDefined();
      expect(issue!.message).toMatch(
        /`HttpDestinationConfig\.retry\.initialDelay` was renamed.*Rename the key to `initialDelayMs`/s,
      );
    });

    it('accepts the suffixed key at the magnitude the retired key carried, with the same default', () => {
      const parsed = HttpDestinationConfigSchema.parse({
        url: 'https://logs.example.com/v1/logs',
        retry: { initialDelayMs: 2500 },
      });
      expect(parsed.retry?.initialDelayMs).toBe(2500);
      expect(parsed.retry).not.toHaveProperty('initialDelay');
      expect(
        HttpDestinationConfigSchema.parse({
          url: 'https://logs.example.com/v1/logs',
          retry: {},
        }).retry?.initialDelayMs,
      ).toBe(1000);
    });

    it('publishes the unit in the describe — the text the reference pages render', () => {
      const retry = HttpDestinationConfigSchema.shape.retry.unwrap();
      expect(retry.shape.initialDelayMs.description).toBe('Initial retry delay in milliseconds');
    });
  });

  describe('HttpDestinationConfig.timeout → timeoutMs (the one TOP-LEVEL key of the four)', () => {
    it('REFUSES the retired spelling with a rename naming `timeoutMs`', () => {
      const result = HttpDestinationConfigSchema.safeParse({
        url: 'https://logs.example.com/v1/logs',
        timeout: 30000,
      });
      expect(result.success).toBe(false);
      const issue = result.error!.issues.find((i) => i.path.join('.') === 'timeout');
      expect(issue).toBeDefined();
      expect(issue!.message).toMatch(
        /`HttpDestinationConfig\.timeout` was renamed.*Rename the key to `timeoutMs`/s,
      );
    });

    it('accepts the suffixed key at the magnitude the retired key carried, with the same default', () => {
      const parsed = HttpDestinationConfigSchema.parse({
        url: 'https://logs.example.com/v1/logs',
        timeoutMs: 45000,
      });
      expect(parsed.timeoutMs).toBe(45000);
      expect(parsed).not.toHaveProperty('timeout');
      expect(
        HttpDestinationConfigSchema.parse({ url: 'https://logs.example.com/v1/logs' }).timeoutMs,
      ).toBe(30000);
    });

    it('publishes the unit in the describe — the text the reference pages render', () => {
      expect(HttpDestinationConfigSchema.shape.timeoutMs.description)
        .toBe('Timeout in milliseconds');
    });
  });

  describe('LoggingConfig.buffer.flushInterval → flushIntervalMs (a different key from the batch one)', () => {
    const base = { name: 'app_logging', label: 'App logging', destinations: [] };

    it('REFUSES the retired spelling with a rename naming `flushIntervalMs`', () => {
      const result = LoggingConfigSchema.safeParse({
        ...base,
        buffer: { flushInterval: 1000 },
      });
      expect(result.success).toBe(false);
      const issue = result.error!.issues.find((i) => i.path.join('.') === 'buffer.flushInterval');
      expect(issue).toBeDefined();
      expect(issue!.message).toMatch(
        /`LoggingConfig\.buffer\.flushInterval` was renamed.*Rename the key to `flushIntervalMs`/s,
      );
    });

    it('accepts the suffixed key at the magnitude the retired key carried, with its OWN default', () => {
      const parsed = LoggingConfigSchema.parse({ ...base, buffer: { flushIntervalMs: 2000 } });
      expect(parsed.buffer?.flushIntervalMs).toBe(2000);
      expect(parsed.buffer).not.toHaveProperty('flushInterval');
      // 1000 here, 5000 on `HttpDestinationConfig.batch` — the two same-named
      // keys never shared a default and do not share one now.
      expect(LoggingConfigSchema.parse({ ...base, buffer: {} }).buffer?.flushIntervalMs).toBe(1000);
    });

    it('publishes the unit in the describe — the text the reference pages render', () => {
      const buffer = LoggingConfigSchema.shape.buffer.unwrap();
      expect(buffer.shape.flushIntervalMs.description).toBe('Flush interval in milliseconds');
    });
  });
});
