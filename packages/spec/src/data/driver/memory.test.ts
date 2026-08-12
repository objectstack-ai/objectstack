import { describe, it, expect } from 'vitest';
import {
  MemoryConfigSchema,
  MemoryPersistenceConfigSchema,
  MemoryDriverSpec,
  PersistenceTypeSchema,
  FilePersistenceConfigSchema,
  LocalStoragePersistenceConfigSchema,
  CustomPersistenceConfigSchema,
  PersistenceAdapterSchema,
  AutoPersistenceConfigSchema,
} from './memory.zod';

describe('MemoryConfigSchema', () => {
  // Persistence is OPT-IN (#815 requirement #1, restored in #4065). This
  // schema previously defaulted to `'auto'`, which on Node.js resolves to file
  // persistence — so an unconfigured memory driver wrote
  // `.objectstack/data/memory-driver.json` into the process CWD and reloaded it
  // on the next boot. The spec and the driver agreed on `'auto'`, which is why
  // the drift survived; what neither checked was whether `'auto'` was the
  // default #815 accepted. It was not.
  it('should default persistence to false (pure in-memory) when empty config', () => {
    const config = MemoryConfigSchema.parse({});

    expect(config.strictMode).toBe(false);
    expect(config.initialData).toBeUndefined();
    expect(config.persistence).toBe(false);
  });

  it('still accepts "auto" as an explicit opt-in to the previous behaviour', () => {
    const config = MemoryConfigSchema.parse({ persistence: 'auto' });

    expect(config.persistence).toBe('auto');
  });

  it('should accept persistence: false to disable persistence', () => {
    const config = MemoryConfigSchema.parse({
      persistence: false,
    });

    expect(config.persistence).toBe(false);
  });

  it('should accept config with initial data', () => {
    const config = MemoryConfigSchema.parse({
      initialData: {
        users: [
          { id: '1', name: 'Alice', email: 'alice@example.com' },
          { id: '2', name: 'Bob', email: 'bob@example.com' },
        ],
        posts: [
          { id: '1', title: 'Hello World', author_id: '1' },
        ],
      },
    });

    expect(config.initialData).toBeDefined();
    expect(config.initialData!.users).toHaveLength(2);
    expect(config.initialData!.posts).toHaveLength(1);
  });

  it('should accept config with strict mode', () => {
    const config = MemoryConfigSchema.parse({
      strictMode: true,
    });

    expect(config.strictMode).toBe(true);
  });

  it('should accept persistence shorthand "file"', () => {
    const config = MemoryConfigSchema.parse({
      persistence: 'file',
    });

    expect(config.persistence).toBe('file');
  });

  it('should accept persistence shorthand "local"', () => {
    const config = MemoryConfigSchema.parse({
      persistence: 'local',
    });

    expect(config.persistence).toBe('local');
  });

  it('should accept persistence shorthand "auto"', () => {
    const config = MemoryConfigSchema.parse({
      persistence: 'auto',
    });

    expect(config.persistence).toBe('auto');
  });

  it('should accept persistence with file object config', () => {
    const config = MemoryConfigSchema.parse({
      persistence: {
        type: 'file',
        path: '/tmp/data.json',
        autoSaveInterval: 10000,
      },
    });

    expect(config.persistence).toBeDefined();
    const p = config.persistence as { type: 'file'; path?: string; autoSaveInterval: number };
    expect(p.type).toBe('file');
    expect(p.path).toBe('/tmp/data.json');
    expect(p.autoSaveInterval).toBe(10000);
  });

  it('should apply file persistence autoSaveInterval default', () => {
    const config = MemoryConfigSchema.parse({
      persistence: {
        type: 'file',
        path: '/tmp/data.json',
      },
    });

    const p = config.persistence as { type: 'file'; autoSaveInterval: number };
    expect(p.autoSaveInterval).toBe(2000);
  });

  it('should accept persistence with local object config', () => {
    const config = MemoryConfigSchema.parse({
      persistence: {
        type: 'local',
        key: 'myapp:db',
      },
    });

    const p = config.persistence as { type: 'local'; key?: string };
    expect(p.type).toBe('local');
    expect(p.key).toBe('myapp:db');
  });

  it('should accept persistence with auto object config', () => {
    const config = MemoryConfigSchema.parse({
      persistence: {
        type: 'auto',
        path: '/var/data/memory.json',
        key: 'myapp:db',
        autoSaveInterval: 5000,
      },
    });

    const p = config.persistence as { type: 'auto'; path?: string; key?: string; autoSaveInterval?: number };
    expect(p.type).toBe('auto');
    expect(p.path).toBe('/var/data/memory.json');
    expect(p.key).toBe('myapp:db');
    expect(p.autoSaveInterval).toBe(5000);
  });

  it('should accept auto persistence without overrides', () => {
    const config = MemoryConfigSchema.parse({
      persistence: {
        type: 'auto',
      },
    });

    const p = config.persistence as { type: 'auto' };
    expect(p.type).toBe('auto');
  });

  it('should accept persistence with custom adapter', () => {
    const mockAdapter = {
      load: async () => null,
      save: async () => {},
      flush: async () => {},
    };
    const config = MemoryConfigSchema.parse({
      persistence: { adapter: mockAdapter },
    });

    expect(config.persistence).toBeDefined();
    const p = config.persistence as { adapter: any };
    expect(typeof p.adapter.load).toBe('function');
    expect(typeof p.adapter.save).toBe('function');
    expect(typeof p.adapter.flush).toBe('function');
  });

  // `indexes` and `maxRecordsPerObject` were declared here and read by nobody:
  // `InMemoryDriverConfig` has no field for either, the driver keeps no indexes
  // (every read is a linear Mingo scan) and evicts nothing. These tests used to
  // assert they were "accepted" — which was true, and meant nothing. #4410 gave
  // `config` a gate, so a key inside it now claims to be honoured; both were
  // removed rather than blessed, and the rejection carries the reason.
  it('rejects `indexes`, which the memory driver never kept', () => {
    const result = MemoryConfigSchema.safeParse({
      indexes: { users: ['email', 'role'] },
    });

    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.message).toContain('the memory driver keeps no indexes');
  });

  it('rejects `maxRecordsPerObject`, which the memory driver never enforced', () => {
    const result = MemoryConfigSchema.safeParse({ maxRecordsPerObject: 10000 });

    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.message).toContain('the memory driver evicts nothing');
  });

  it('should accept full config with all options', () => {
    const config = MemoryConfigSchema.parse({
      initialData: {
        users: [{ id: '1', name: 'Alice' }],
      },
      strictMode: true,
      persistence: {
        type: 'file',
        path: '/var/data/memory.json',
        autoSaveInterval: 3000,
      },
    });

    expect(config.strictMode).toBe(true);
    expect(config.initialData!.users).toHaveLength(1);
    const p = config.persistence as { type: 'file'; path?: string };
    expect(p.path).toBe('/var/data/memory.json');
  });

  it('should reject file persistence with invalid autoSaveInterval', () => {
    expect(() => MemoryConfigSchema.parse({
      persistence: {
        type: 'file',
        path: '/tmp/data.json',
        autoSaveInterval: 50, // Below minimum of 100
      },
    })).toThrow();
  });

  it('should reject invalid persistence string', () => {
    expect(() => MemoryConfigSchema.parse({
      persistence: 'indexeddb',
    })).toThrow();
  });

  it('should reject maxRecordsPerObject less than 1', () => {
    expect(() => MemoryConfigSchema.parse({
      maxRecordsPerObject: 0,
    })).toThrow();
  });

  it('should reject strictMode with invalid type', () => {
    expect(() => MemoryConfigSchema.parse({
      strictMode: 'yes',
    })).toThrow();
  });
});

describe('PersistenceTypeSchema', () => {
  it('should accept file type', () => {
    expect(PersistenceTypeSchema.parse('file')).toBe('file');
  });

  it('should accept local type', () => {
    expect(PersistenceTypeSchema.parse('local')).toBe('local');
  });

  it('should accept auto type', () => {
    expect(PersistenceTypeSchema.parse('auto')).toBe('auto');
  });

  it('should reject invalid type', () => {
    expect(() => PersistenceTypeSchema.parse('indexeddb')).toThrow();
  });
});

describe('FilePersistenceConfigSchema', () => {
  it('should accept valid file persistence config', () => {
    const config = FilePersistenceConfigSchema.parse({
      type: 'file',
      path: '/data/store.json',
      autoSaveInterval: 10000,
    });

    expect(config.type).toBe('file');
    expect(config.path).toBe('/data/store.json');
    expect(config.autoSaveInterval).toBe(10000);
  });

  it('should apply default autoSaveInterval', () => {
    const config = FilePersistenceConfigSchema.parse({
      type: 'file',
      path: '/data/store.json',
    });

    expect(config.autoSaveInterval).toBe(2000);
  });

  it('should accept without path (uses default)', () => {
    const config = FilePersistenceConfigSchema.parse({
      type: 'file',
    });

    expect(config.type).toBe('file');
    expect(config.path).toBeUndefined();
  });

  // #4001 batch B: this shape was a bare `z.object` — an unrecognised key was
  // silently stripped and the file adapter came up on its defaults with no
  // signal at all. `.strict()` makes that loud.
  it('rejects an unrecognised key instead of silently stripping it', () => {
    const result = FilePersistenceConfigSchema.safeParse({
      type: 'file',
      path: '/data/store.json',
      filepath: '/data/other.json', // typo'd key, not a real field
    });

    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.message).toContain(
      "this memory datasource's file persistence config",
    );
    expect(result.error!.issues[0]!.message).toContain('filepath');
  });
});

describe('LocalStoragePersistenceConfigSchema', () => {
  it('should accept valid localStorage persistence config', () => {
    const config = LocalStoragePersistenceConfigSchema.parse({
      type: 'local',
      key: 'myapp:db',
    });

    expect(config.type).toBe('local');
    expect(config.key).toBe('myapp:db');
  });

  it('should accept without key (uses default)', () => {
    const config = LocalStoragePersistenceConfigSchema.parse({
      type: 'local',
    });

    expect(config.type).toBe('local');
    expect(config.key).toBeUndefined();
  });

  // #4001 batch B — see the FilePersistenceConfigSchema case above.
  it('rejects an unrecognised key instead of silently stripping it', () => {
    const result = LocalStoragePersistenceConfigSchema.safeParse({
      type: 'local',
      storageKey: 'myapp:db', // typo'd key, not a real field
    });

    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.message).toContain(
      "this memory datasource's localStorage persistence config",
    );
    expect(result.error!.issues[0]!.message).toContain('storageKey');
  });
});

describe('CustomPersistenceConfigSchema', () => {
  it('should accept valid custom adapter', () => {
    const config = CustomPersistenceConfigSchema.parse({
      adapter: {
        load: async () => null,
        save: async () => {},
        flush: async () => {},
      },
    });

    expect(typeof config.adapter.load).toBe('function');
    expect(typeof config.adapter.save).toBe('function');
    expect(typeof config.adapter.flush).toBe('function');
  });

  // #4001 batch B — see the FilePersistenceConfigSchema case above.
  it('rejects an unrecognised key instead of silently stripping it', () => {
    const result = CustomPersistenceConfigSchema.safeParse({
      adapter: {
        load: async () => null,
        save: async () => {},
        flush: async () => {},
      },
      options: { retries: 3 }, // not a real field on this shape
    });

    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.message).toContain(
      "this memory datasource's custom-adapter persistence config",
    );
    expect(result.error!.issues[0]!.message).toContain('options');
  });
});

describe('PersistenceAdapterSchema', () => {
  it('should accept a valid adapter (load/save/flush)', () => {
    const config = PersistenceAdapterSchema.parse({
      load: async () => null,
      save: async () => {},
      flush: async () => {},
    });

    expect(typeof config.load).toBe('function');
    expect(typeof config.save).toBe('function');
    expect(typeof config.flush).toBe('function');
  });

  // #4001 batch B: this shape was a bare `z.object` — an unrecognised key
  // (e.g. a typo'd lifecycle method) was silently stripped instead of being
  // reported, so a custom adapter missing `flush` because the author wrote
  // `close` instead got a clean parse and a driver that never persisted on
  // shutdown.
  it('rejects an unrecognised key instead of silently stripping it', () => {
    const result = PersistenceAdapterSchema.safeParse({
      load: async () => null,
      save: async () => {},
      flush: async () => {},
      close: async () => {}, // not a real field on this shape
    });

    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.message).toContain(
      "this memory datasource's custom persistence adapter",
    );
    expect(result.error!.issues[0]!.message).toContain('close');
  });
});

describe('AutoPersistenceConfigSchema', () => {
  it('should accept minimal auto config', () => {
    const config = AutoPersistenceConfigSchema.parse({
      type: 'auto',
    });

    expect(config.type).toBe('auto');
    expect(config.path).toBeUndefined();
    expect(config.key).toBeUndefined();
    expect(config.autoSaveInterval).toBeUndefined();
  });

  it('should accept auto config with all overrides', () => {
    const config = AutoPersistenceConfigSchema.parse({
      type: 'auto',
      path: '/data/store.json',
      key: 'myapp:db',
      autoSaveInterval: 5000,
    });

    expect(config.type).toBe('auto');
    expect(config.path).toBe('/data/store.json');
    expect(config.key).toBe('myapp:db');
    expect(config.autoSaveInterval).toBe(5000);
  });

  it('should reject auto config with invalid autoSaveInterval', () => {
    expect(() => AutoPersistenceConfigSchema.parse({
      type: 'auto',
      autoSaveInterval: 50, // Below minimum of 100
    })).toThrow();
  });

  // #4001 batch B — see the FilePersistenceConfigSchema case above.
  it('rejects an unrecognised key instead of silently stripping it', () => {
    const result = AutoPersistenceConfigSchema.safeParse({
      type: 'auto',
      interval: 5000, // meant `autoSaveInterval`, not a real field
    });

    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.message).toContain(
      "this memory datasource's auto-detect persistence config",
    );
    expect(result.error!.issues[0]!.message).toContain('interval');
  });
});

describe('MemoryPersistenceConfigSchema', () => {
  it('should accept shorthand "file"', () => {
    const config = MemoryPersistenceConfigSchema.parse('file');
    expect(config).toBe('file');
  });

  it('should accept shorthand "local"', () => {
    const config = MemoryPersistenceConfigSchema.parse('local');
    expect(config).toBe('local');
  });

  it('should accept shorthand "auto"', () => {
    const config = MemoryPersistenceConfigSchema.parse('auto');
    expect(config).toBe('auto');
  });

  it('should accept file object config', () => {
    const config = MemoryPersistenceConfigSchema.parse({
      type: 'file',
      path: '/tmp/data.json',
    });
    expect(config).toEqual({ type: 'file', path: '/tmp/data.json', autoSaveInterval: 2000 });
  });

  it('should accept local object config', () => {
    const config = MemoryPersistenceConfigSchema.parse({
      type: 'local',
      key: 'myapp:db',
    });
    expect(config).toEqual({ type: 'local', key: 'myapp:db' });
  });

  it('should accept auto object config', () => {
    const config = MemoryPersistenceConfigSchema.parse({
      type: 'auto',
      path: '/data/store.json',
      key: 'myapp:db',
    });
    expect(config).toEqual({ type: 'auto', path: '/data/store.json', key: 'myapp:db' });
  });

  it('should accept custom adapter', () => {
    const adapter = {
      load: async () => null,
      save: async () => {},
      flush: async () => {},
    };
    const config = MemoryPersistenceConfigSchema.parse({ adapter });
    expect((config as any).adapter).toBeDefined();
  });

  it('should reject invalid string', () => {
    expect(() => MemoryPersistenceConfigSchema.parse('redis')).toThrow();
  });
});

describe('MemoryDriverSpec', () => {
  it('should have correct id', () => {
    expect(MemoryDriverSpec.id).toBe('memory');
  });

  it('should have correct label', () => {
    expect(MemoryDriverSpec.label).toBe('In-Memory');
  });

  it('should have a description', () => {
    expect(MemoryDriverSpec.description).toBeDefined();
    expect(typeof MemoryDriverSpec.description).toBe('string');
  });

  it('should have an icon', () => {
    expect(MemoryDriverSpec.icon).toBe('memory');
  });
});
