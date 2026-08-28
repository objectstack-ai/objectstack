import { describe, it, expect } from 'vitest';
import {
  DriverCapabilitiesSchema,
  DriverInterfaceSchema,
  type DriverCapabilities,
  type DriverInterface,
} from './driver.zod';

/**
 * The 31 capability bits retired in 17.0.0 (#4634, ADR-0049 enforce-or-remove).
 * Kept as a literal list so the pins below cannot drift from the PR's audit
 * table silently — adding a 32nd tombstone (or resurrecting one of these)
 * must touch this file.
 */
const RETIRED_BITS = [
  'create',
  'read',
  'update',
  'delete',
  'bulkCreate',
  'bulkUpdate',
  'bulkDelete',
  'transactions',
  'savepoints',
  'isolationLevels',
  'queryFilters',
  'queryAggregations',
  'querySorting',
  'queryPagination',
  'queryWindowFunctions',
  'querySubqueries',
  'queryCTE',
  'joins',
  'fullTextSearch',
  'jsonQuery',
  'geospatialQuery',
  'streaming',
  'jsonFields',
  'arrayFields',
  'vectorSearch',
  'schemaSync',
  'migrations',
  'indexes',
  'connectionPooling',
  'preparedStatements',
  'queryCache',
] as const;

/** The bits that survive — each with a named engine reader. */
const LIVE_BITS = ['queryDateGranularity', 'autonumber', 'batchSchemaSync'] as const;

describe('DriverCapabilitiesSchema', () => {
  it('accepts the live capability bits', () => {
    const capabilities: DriverCapabilities = {
      queryDateGranularity: { day: true, week: false, month: true, quarter: true, year: true },
      autonumber: true,
      batchSchemaSync: true,
    };

    expect(() => DriverCapabilitiesSchema.parse(capabilities)).not.toThrow();
  });

  it('accepts an empty capabilities object — every live bit is opt-in (absence = false)', () => {
    const parsed = DriverCapabilitiesSchema.parse({});
    // `batchSchemaSync` dropped its `.default(false)` in #4634: absence already
    // meant false at both readers (`supports?.batchSchemaSync` truthiness), and
    // the default forced every capability object to spell out dead weight.
    expect(parsed).not.toHaveProperty('batchSchemaSync');
    expect(parsed).not.toHaveProperty('autonumber');
  });

  it('declares exactly the audited shape: 3 live bits + 31 tombstones', () => {
    const shape = (DriverCapabilitiesSchema as unknown as { shape: Record<string, unknown> }).shape;
    const keys = Object.keys(shape).sort();
    expect(keys).toEqual([...RETIRED_BITS, ...LIVE_BITS].slice().sort());
  });
});

// ===========================================================================
// Retired capability bits (#4634, ADR-0049 enforce-or-remove)
// ===========================================================================

describe('[#4634] the 31 inert capability bits are tombstoned, not stripped', () => {
  it.each(RETIRED_BITS)('REJECTS an authored `%s`, with the prescription in the message', (bit) => {
    const value = bit === 'isolationLevels' ? ['read-committed'] : true;
    expect(() => DriverCapabilitiesSchema.parse({ [bit]: value })).toThrow(
      new RegExp(`DriverCapabilities\\.${bit}.*removed.*Delete the key`, 's'),
    );
  });

  it('the streaming prescription carries the #4484 findStream story and the paged-find fix', () => {
    expect(() => DriverCapabilitiesSchema.parse({ streaming: true })).toThrow(
      /DriverCapabilities\.streaming.*removed.*findStream.*`find\(\)` with `limit`\/`offset`.*Delete the key/s,
    );
  });

  it('the queryFilters prescription names the real mechanism — find() executes the full QueryAST', () => {
    expect(() => DriverCapabilitiesSchema.parse({ queryFilters: false })).toThrow(
      /DriverCapabilities\.queryFilters.*removed.*full QueryAST.*never built.*Delete the key/s,
    );
  });

  it('the transactions prescription points at method presence, not a replacement bit', () => {
    expect(() => DriverCapabilitiesSchema.parse({ transactions: true })).toThrow(
      /DriverCapabilities\.transactions.*removed.*METHOD PRESENCE.*beginTransaction.*Delete the key/s,
    );
  });

  it('still parses the live bits cleanly — the tombstones reject a key, not the record', () => {
    const parsed = DriverCapabilitiesSchema.parse({
      // z.record over the DateGranularity enum parses exhaustively — a partial
      // advertisement is expressed with explicit `false`, as SqlDriver does.
      queryDateGranularity: { day: true, week: false, month: true, quarter: true, year: true },
      autonumber: true,
      batchSchemaSync: false,
    });
    expect(parsed.autonumber).toBe(true);
    expect(parsed.batchSchemaSync).toBe(false);
    for (const bit of RETIRED_BITS) {
      expect(parsed).not.toHaveProperty(bit);
    }
  });
});

// #4642 established that a compile-time conditional-type pin in this package was
// a no-op until #5286 (tsconfig excluded `**/*.test.ts`; vitest never enables `typecheck`),
// so the load-bearing tsc-channel proof is the compiler-API test below, with
// anti-vacuity guards; sabotage-verified in the PR (S1: re-adding a live
// `streaming: z.boolean()` turns it red).
describe('[#4634] tsc channel: the retired bits are unwritable in DriverCapabilities', () => {
  it('types every retired bit as authored-unwritable and every live bit as writable', async () => {
    const ts = (await import('typescript')).default;
    const { resolve, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');

    const dataEntry = resolve(dirname(fileURLToPath(import.meta.url)), './index.ts');
    const program = ts.createProgram([dataEntry], {
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      skipLibCheck: true,
      noEmit: true,
      strict: true,
    });
    const checker = program.getTypeChecker();
    const sf = program.getSourceFile(dataEntry);
    const moduleSym = sf && checker.getSymbolAtLocation(sf);
    // Anti-vacuity: a resolution failure must fail loudly, not pass everything.
    expect(moduleSym, './data module symbol must resolve').toBeTruthy();

    const exports = checker.getExportsOfModule(moduleSym!);
    const capsAlias = exports.find((e) => e.getName() === 'DriverCapabilities');
    expect(capsAlias, 'DriverCapabilities must stay exported from ./data').toBeTruthy();

    const capsType = checker.getDeclaredTypeOfSymbol(capsAlias!);
    const props = new Map(capsType.getProperties().map((p) => [p.getName(), p]));

    // Anti-vacuity: the walked shape is the audited 34-key shape.
    expect([...props.keys()].sort()).toEqual([...RETIRED_BITS, ...LIVE_BITS].slice().sort());

    const decl = capsAlias!.declarations?.[0];
    expect(decl, 'DriverCapabilities alias declaration must exist').toBeTruthy();
    const typeAt = (name: string) =>
      checker.typeToString(checker.getTypeOfSymbolAtLocation(props.get(name)!, decl!));

    for (const bit of RETIRED_BITS) {
      // `retiredKey()` is `z.never().optional()`: the property type collapses
      // to `undefined` — there is no value an author can write. A resurrected
      // live bit reads `boolean` (or wider) here and turns this red.
      expect(typeAt(bit), `retired bit ${bit} must be unwritable`).toBe('undefined');
    }
    for (const bit of LIVE_BITS) {
      expect(typeAt(bit), `live bit ${bit} must stay writable`).not.toBe('undefined');
    }
  });
});

// ===========================================================================
// DriverInterfaceSchema — the structural contract
// ===========================================================================

/** A minimal, contract-complete driver object for the structural tests. */
const baseDriver = {
  name: 'test-driver',
  version: '1.0.0',
  connect: async () => {},
  disconnect: async () => {},
  checkHealth: async () => true,
  execute: async () => ({}),
  find: async () => [],
  findOne: async () => null,
  create: async () => ({}),
  update: async () => ({}),
  upsert: async () => ({}),
  delete: async () => true,
  count: async () => 0,
  bulkCreate: async () => [],
  bulkUpdate: async () => [],
  bulkDelete: async () => {},
  beginTransaction: async () => ({}),
  commit: async () => {},
  rollback: async () => {},
  syncSchema: async () => {},
  dropTable: async () => {},
  supports: {},
};

describe('DriverInterfaceSchema', () => {
  describe('Basic Properties', () => {
    it('should require name and version', () => {
      const incomplete = {
        name: 'postgresql',
        // missing version and other required fields
      };

      const result = DriverInterfaceSchema.safeParse(incomplete);
      expect(result.success).toBe(false);
    });

    it('should accept a contract-complete driver', () => {
      expect(() => DriverInterfaceSchema.parse(baseDriver)).not.toThrow();
    });
  });

  describe('CRUD Operations', () => {
    it('should validate find method signature', () => {
      const driver = {
        ...baseDriver,
        find: async (object: string, query: any) => [
          { id: '1', name: 'Record 1' },
          { id: '2', name: 'Record 2' },
        ],
      };

      expect(() => DriverInterfaceSchema.parse(driver)).not.toThrow();
    });

    it('should validate create method signature', () => {
      const driver = {
        ...baseDriver,
        create: async (object: string, data: any) => ({
          ...data,
          id: 'generated-id',
          created_at: new Date(),
        }),
      };

      expect(() => DriverInterfaceSchema.parse(driver)).not.toThrow();
    });

    it('should validate update method signature', () => {
      const driver = {
        ...baseDriver,
        update: async (object: string, id: any, data: any) => ({
          id,
          ...data,
          updated_at: new Date(),
        }),
      };

      expect(() => DriverInterfaceSchema.parse(driver)).not.toThrow();
    });
  });

  describe('Bulk Operations', () => {
    it('should validate bulk method signatures', () => {
      const driver = {
        ...baseDriver,
        bulkCreate: async (object: string, data: any[]) =>
          data.map((item, i) => ({ ...item, id: `generated-${i}` })),
        bulkUpdate: async (object: string, updates: any[]) =>
          updates.map((u) => ({ ...u.data, id: u.id, updated_at: new Date() })),
        bulkDelete: async (object: string, ids: any[]) => {},
      };

      expect(() => DriverInterfaceSchema.parse(driver)).not.toThrow();
    });
  });

  describe('DDL Operations', () => {
    it('should validate syncSchema and dropTable methods', () => {
      const driver = {
        ...baseDriver,
        syncSchema: async (object: string, schema: any) => {},
        dropTable: async (object: string) => {},
      };

      expect(() => DriverInterfaceSchema.parse(driver)).not.toThrow();
    });
  });

  describe('Capability advertisement', () => {
    it('accepts a driver that advertises the live bits', () => {
      // The shape SqlDriver actually returns after #4634: native date buckets,
      // driver-owned autonumber, no batched DDL.
      const sqlLike: DriverInterface = {
        ...baseDriver,
        name: 'sql-like',
        supports: {
          queryDateGranularity: { day: true, week: true, month: true, quarter: true, year: true },
          autonumber: true,
          batchSchemaSync: false,
        },
      };
      expect(() => DriverInterfaceSchema.parse(sqlLike)).not.toThrow();
    });

    it('accepts a driver that advertises nothing — capability bits are opt-in', () => {
      // The shape InMemoryDriver returns after #4634. "Supports transactions"
      // etc. is expressed by the methods it implements, not by booleans.
      const memoryLike: DriverInterface = { ...baseDriver, name: 'memory-like', supports: {} };
      expect(() => DriverInterfaceSchema.parse(memoryLike)).not.toThrow();
    });

    it('REJECTS a driver whose supports still authors a retired bit', () => {
      const legacy = {
        ...baseDriver,
        supports: { transactions: true, streaming: true },
      };
      expect(() => DriverInterfaceSchema.parse(legacy)).toThrow(/removed.*Delete the key/s);
    });
  });

  // ===========================================================================
  // Retired surface (#4484, ADR-0049 enforce-or-remove)
  // ===========================================================================

  describe('findStream (retired in 17.0.0)', () => {
    it('is no longer part of the declared driver shape', () => {
      expect(DriverInterfaceSchema.shape).not.toHaveProperty('findStream');
    });

    it('deliberately carries no tombstone — nothing ever parsed a driver with it', () => {
      // The other retirements in this major tombstone their key so authoring it
      // fails loudly. That would be noise here: `DriverInterfaceSchema` describes
      // a TypeScript contract that drivers IMPLEMENT, and nothing in either
      // repository ever ran a driver object through `.parse()` — the prescription
      // would have no one to reach. The enforced channel is tsc on `IDataDriver`
      // (see contracts/data-driver.test.ts), which breaks callers, and there were
      // none. A stray `findStream` on a driver object therefore just parses and
      // is dropped, exactly as any other non-contract method on it always has.
      // (Contrast `DriverCapabilities`, whose keys ARE tombstoned: capability
      // records DO get parsed, via DriverConfigSchema.capabilities.)
      const withLegacyMethod = {
        ...baseDriver,
        name: 'legacy',
        findStream: async function* () {},
      };

      const parsed = DriverInterfaceSchema.parse(withLegacyMethod);
      expect(parsed).not.toHaveProperty('findStream');
    });
  });
});
