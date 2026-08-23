import { describe, it, expect } from 'vitest';
import { 
  MappingSchema, 
  ImportFieldMappingSchema, 
  TransformType,
  type Mapping, 
  type ImportFieldMapping 
} from './mapping.zod';

describe('TransformType', () => {
  it('should accept valid transform types', () => {
    const validTypes = ['none', 'constant', 'lookup', 'split', 'join', 'javascript', 'map'];
    
    validTypes.forEach(type => {
      expect(() => TransformType.parse(type)).not.toThrow();
    });
  });

  it('should reject invalid transform types', () => {
    expect(() => TransformType.parse('custom')).toThrow();
    expect(() => TransformType.parse('transform')).toThrow();
    expect(() => TransformType.parse('')).toThrow();
  });
});

describe('ImportFieldMappingSchema', () => {
  it('should accept valid minimal field mapping', () => {
    const validMapping: ImportFieldMapping = {
      source: 'first_name',
      target: 'firstName'
    };

    expect(() => ImportFieldMappingSchema.parse(validMapping)).not.toThrow();
  });

  it('should accept field mapping with single source and target', () => {
    const mapping = ImportFieldMappingSchema.parse({
      source: 'email',
      target: 'email_address',
      transform: 'none'
    });

    expect(mapping.source).toBe('email');
    expect(mapping.target).toBe('email_address');
  });

  it('should accept field mapping with array sources', () => {
    const mapping = ImportFieldMappingSchema.parse({
      source: ['first_name', 'last_name'],
      target: 'full_name',
      transform: 'join',
      params: { separator: ' ' }
    });

    expect(mapping.source).toEqual(['first_name', 'last_name']);
  });

  it('should accept field mapping with array targets', () => {
    const mapping = ImportFieldMappingSchema.parse({
      source: 'full_name',
      target: ['first_name', 'last_name'],
      transform: 'split',
      params: { separator: ' ' }
    });

    expect(mapping.target).toEqual(['first_name', 'last_name']);
  });

  it('should apply default transform type', () => {
    const mapping = ImportFieldMappingSchema.parse({
      source: 'field1',
      target: 'field2'
    });

    expect(mapping.transform).toBe('none');
  });

  it('should accept constant transform', () => {
    const mapping = ImportFieldMappingSchema.parse({
      source: 'unused',
      target: 'status',
      transform: 'constant',
      params: { value: 'active' }
    });

    expect(mapping.transform).toBe('constant');
    expect(mapping.params?.value).toBe('active');
  });

  it('should accept lookup transform (a pass-through with no params of its own)', () => {
    const mapping = ImportFieldMappingSchema.parse({
      source: 'account_name',
      target: 'account_id',
      transform: 'lookup',
    });

    expect(mapping.transform).toBe('lookup');
  });

  // ── `params` lookup keys retired in the 17.x line (#10329, ADR-0049) ───────
  //
  // `object` / `fromField` / `toField` / `autoCreate` declared a per-entry
  // reference-resolution dialect the import path never implemented: `lookup`
  // copies the cell through and resolution runs afterwards off the target
  // field's own metadata. These pin the REJECTION carrying the prescription,
  // not just the absence — the schema is strict, so a bare "unrecognized key"
  // would already fail; what must survive refactors is the guidance.

  const lookupEntry = { source: 'account_name', target: 'account_id', transform: 'lookup' as const };

  it('rejects the retired `params.object` with the target-field-metadata prescription', () => {
    expect(() => ImportFieldMappingSchema.parse({
      ...lookupEntry,
      params: { object: 'account' },
    })).toThrow(/params\.object.*removed.*TARGET FIELD/s);
  });

  it('rejects the retired `params.fromField` with the display-value-matching prescription', () => {
    expect(() => ImportFieldMappingSchema.parse({
      ...lookupEntry,
      params: { fromField: 'name' },
    })).toThrow(/params\.fromField.*removed.*display.*value/s);
  });

  it('rejects the retired `params.toField` with the record-id prescription', () => {
    expect(() => ImportFieldMappingSchema.parse({
      ...lookupEntry,
      params: { toField: 'id' },
    })).toThrow(/params\.toField.*removed.*record.*id/s);
  });

  it('rejects the retired `params.autoCreate` saying what ACTUALLY happens (row fails)', () => {
    // The one with teeth: the key read as "create the referenced record when
    // nothing matches". Nothing was ever created — the row fails with an
    // unresolved-reference error either way — so the prescription must say so
    // rather than merely "removed".
    const parse = () => ImportFieldMappingSchema.parse({
      ...lookupEntry,
      params: { autoCreate: true },
    });
    expect(parse).toThrow(/params\.autoCreate.*removed/s);
    expect(parse).toThrow(/nothing was ever created/is);
    expect(parse).toThrow(/import_reference_not_found/s);
  });

  it('routes the retired ALIAS spellings to the same prescriptions', () => {
    // The alias table used to fold eleven spellings onto the four keys. Leaving
    // them as aliases would answer "did you mean `fromField`?" — a rename
    // suggestion pointing at a key that is also gone, i.e. a second rejection.
    expect(() => ImportFieldMappingSchema.parse({
      ...lookupEntry, params: { lookupObject: 'account' },
    })).toThrow(/params\.object.*removed/s);
    expect(() => ImportFieldMappingSchema.parse({
      ...lookupEntry, params: { matchOn: 'name' },
    })).toThrow(/params\.fromField.*removed/s);
    expect(() => ImportFieldMappingSchema.parse({
      ...lookupEntry, params: { returnField: 'id' },
    })).toThrow(/params\.toField.*removed/s);
    expect(() => ImportFieldMappingSchema.parse({
      ...lookupEntry, params: { createIfMissing: true },
    })).toThrow(/params\.autoCreate.*removed/s);
  });

  it('leaves the surviving params surface intact', () => {
    const mapping = ImportFieldMappingSchema.parse({
      source: 'status',
      target: 'status_code',
      transform: 'map',
      params: { valueMap: { Open: 'open' } },
    });
    expect(mapping.params).not.toHaveProperty('object');
    expect(mapping.params).not.toHaveProperty('fromField');
    expect(mapping.params).not.toHaveProperty('toField');
    expect(mapping.params).not.toHaveProperty('autoCreate');
    expect(mapping.params?.valueMap).toHaveProperty('Open', 'open');
  });

  it('should accept map transform', () => {
    const mapping = ImportFieldMappingSchema.parse({
      source: 'status',
      target: 'status_code',
      transform: 'map',
      params: {
        valueMap: {
          'Open': 'open',
          'In Progress': 'in_progress',
          'Closed': 'closed'
        }
      }
    });

    expect(mapping.transform).toBe('map');
    expect(mapping.params?.valueMap).toHaveProperty('Open', 'open');
  });

  it('should accept split transform', () => {
    const mapping = ImportFieldMappingSchema.parse({
      source: 'full_name',
      target: ['first_name', 'last_name'],
      transform: 'split',
      params: { separator: ' ' }
    });

    expect(mapping.transform).toBe('split');
    expect(mapping.params?.separator).toBe(' ');
  });

  it('should accept join transform', () => {
    const mapping = ImportFieldMappingSchema.parse({
      source: ['street', 'city', 'zip'],
      target: 'full_address',
      transform: 'join',
      params: { separator: ', ' }
    });

    expect(mapping.transform).toBe('join');
    expect(mapping.params?.separator).toBe(', ');
  });

  it('should accept javascript transform', () => {
    const mapping = ImportFieldMappingSchema.parse({
      source: 'raw_data',
      target: 'processed_data',
      transform: 'javascript',
      params: { value: 'return value.toUpperCase();' }
    });

    expect(mapping.transform).toBe('javascript');
  });
});

describe('MappingSchema', () => {
  it('should accept valid minimal mapping', () => {
    const validMapping: Mapping = {
      name: 'csv_import',
      targetObject: 'contact',
      fieldMapping: [
        { source: 'email', target: 'email' }
      ]
    };

    expect(() => MappingSchema.parse(validMapping)).not.toThrow();
  });

  it('should accept mapping with all fields', () => {
    const fullMapping: Mapping = {
      name: 'contact_import',
      label: 'Contact CSV Import',
      sourceFormat: 'csv',
      targetObject: 'contact',
      fieldMapping: [
        { source: 'email', target: 'email' },
        { source: 'name', target: 'full_name' }
      ],
      mode: 'upsert',
      upsertKey: ['email']
    };

    expect(() => MappingSchema.parse(fullMapping)).not.toThrow();
  });

  it('should validate mapping name format (snake_case)', () => {
    expect(() => MappingSchema.parse({
      name: 'valid_mapping_name',
      targetObject: 'object',
      fieldMapping: []
    })).not.toThrow();

    expect(() => MappingSchema.parse({
      name: 'InvalidMapping',
      targetObject: 'object',
      fieldMapping: []
    })).toThrow();

    expect(() => MappingSchema.parse({
      name: 'invalid-mapping',
      targetObject: 'object',
      fieldMapping: []
    })).toThrow();
  });

  it('should apply default values', () => {
    const mapping = MappingSchema.parse({
      name: 'test_mapping',
      targetObject: 'contact',
      fieldMapping: []
    });

    expect(mapping.sourceFormat).toBe('csv');
    expect(mapping.mode).toBe('insert');
  });

  it('should accept different source formats', () => {
    const formats: Array<Mapping['sourceFormat']> = ['csv', 'json', 'xml', 'sql'];
    
    formats.forEach(format => {
      const mapping = MappingSchema.parse({
        name: 'test_mapping',
        sourceFormat: format,
        targetObject: 'object',
        fieldMapping: []
      });
      expect(mapping.sourceFormat).toBe(format);
    });
  });

  it('should accept different modes', () => {
    const modes: Array<Mapping['mode']> = ['insert', 'update', 'upsert'];
    
    modes.forEach(mode => {
      const mapping = MappingSchema.parse({
        name: 'test_mapping',
        targetObject: 'object',
        fieldMapping: [],
        mode
      });
      expect(mapping.mode).toBe(mode);
    });
  });

  it('should accept upsertKey with multiple fields', () => {
    const mapping = MappingSchema.parse({
      name: 'test_mapping',
      targetObject: 'contact',
      fieldMapping: [],
      mode: 'upsert',
      upsertKey: ['email', 'phone']
    });

    expect(mapping.upsertKey).toEqual(['email', 'phone']);
  });

  // ── Retired in 17.0.0 (#4509, ADR-0049) ───────────────────────────────────
  //
  // `extractQuery` / `errorPolicy` / `batchSize` parsed and controlled nothing.
  // These pin the REJECTION, not just the absence: the schema is strict, so a
  // bare "unrecognized key" would already fail the parse — what has to survive
  // refactors is that the author is handed the prescription. Two of the three
  // were unwarnable (schema defaults materialise at parse, so the liveness lint
  // could never distinguish authored from supplied), which made this rejection
  // the ONLY channel that reaches them.

  const base = { name: 'test_mapping', targetObject: 'object', fieldMapping: [] };

  it('rejects the retired `extractQuery` with the export-path prescription', () => {
    expect(() => MappingSchema.parse({
      ...base,
      extractQuery: { object: 'contact', fields: ['id', 'email'] },
    })).toThrow(/extractQuery.*removed.*17\.0\.0.*export path that does not exist/s);
  });

  it('rejects the retired `errorPolicy` and points at the import request', () => {
    expect(() => MappingSchema.parse({ ...base, errorPolicy: 'abort' }))
      .toThrow(/errorPolicy.*removed.*17\.0\.0.*import REQUEST/s);
  });

  it('rejects the retired `batchSize` WITHOUT offering a rename', () => {
    // The trap this pins: `batchSize` is a live, enforced key on bulk-action,
    // connector, sync, offline, the seed loader and the NoSQL driver cursor. An
    // author (or an agent) reading "removed" is one step from relocating the
    // value onto one of those, so the message must name them as DIFFERENT keys
    // rather than as a migration target. Same shape as the `datasource`
    // `retryPolicy` → `hook`/`job` `backoffMs` trap defused in #4583.
    const parse = () => MappingSchema.parse({ ...base, batchSize: 100 });
    expect(parse).toThrow(/batchSize.*removed.*17\.0\.0/s);
    // NB: matched against the serialised ZodError, where inner quotes arrive
    // escaped — so the assertion deliberately avoids the quoted word.
    expect(parse).toThrow(/this by relocating the value to a neighbouring/s);
    expect(parse).toThrow(/connector\.batchSize|sync\.batchSize/s);
  });

  it('routes the retired ALIAS spellings to the same prescriptions', () => {
    // `onError` / `batch` / `query` aliased the three removed keys. Leaving them
    // in `aliases` would have answered "did you mean `errorPolicy`?" — a rename
    // suggestion pointing at a key that is also gone, i.e. a second rejection.
    expect(() => MappingSchema.parse({ ...base, onError: 'abort' }))
      .toThrow(/errorPolicy.*removed/s);
    expect(() => MappingSchema.parse({ ...base, chunkSize: 100 }))
      .toThrow(/batchSize.*removed/s);
    expect(() => MappingSchema.parse({ ...base, query: {} }))
      .toThrow(/extractQuery.*removed/s);
  });

  it('leaves the surviving mapping surface intact', () => {
    const mapping = MappingSchema.parse({
      ...base,
      targetObject: 'contact',
      fieldMapping: [{ source: 'Email', target: 'email' }],
      mode: 'upsert',
      upsertKey: ['email'],
    });
    expect(mapping).not.toHaveProperty('errorPolicy');
    expect(mapping).not.toHaveProperty('batchSize');
    expect(mapping).not.toHaveProperty('extractQuery');
    expect(mapping.upsertKey).toEqual(['email']);
  });

  it('should handle CSV import mapping', () => {
    const csvMapping = MappingSchema.parse({
      name: 'csv_contact_import',
      sourceFormat: 'csv',
      targetObject: 'contact',
      fieldMapping: [
        { source: 'Email', target: 'email' },
        { source: 'First Name', target: 'first_name' },
        { source: 'Last Name', target: 'last_name' }
      ],
      mode: 'upsert',
      upsertKey: ['email']
    });

    expect(csvMapping.sourceFormat).toBe('csv');
    expect(csvMapping.fieldMapping).toHaveLength(3);
  });

  it('should handle JSON import mapping', () => {
    const jsonMapping = MappingSchema.parse({
      name: 'json_import',
      sourceFormat: 'json',
      targetObject: 'product',
      fieldMapping: [
        { source: 'sku', target: 'product_code' },
        { source: 'name', target: 'product_name' }
      ]
    });

    expect(jsonMapping.sourceFormat).toBe('json');
  });

  it('should handle complex field mappings', () => {
    const complexMapping = MappingSchema.parse({
      name: 'complex_import',
      targetObject: 'contact',
      fieldMapping: [
        { 
          source: 'email', 
          target: 'email',
          transform: 'none'
        },
        { 
          source: 'unused', 
          target: 'status',
          transform: 'constant',
          params: { value: 'active' }
        },
        {
          // `lookup` is a pass-through: the import pipeline resolves the
          // reference from the target field's own metadata (#10329).
          source: 'account_name',
          target: 'account_id',
          transform: 'lookup'
        },
        {
          source: ['first_name', 'last_name'],
          target: 'full_name',
          transform: 'join',
          params: { separator: ' ' }
        }
      ]
    });

    expect(complexMapping.fieldMapping).toHaveLength(4);
  });

  it('should reject mapping without required fields', () => {
    expect(() => MappingSchema.parse({
      targetObject: 'object',
      fieldMapping: []
    })).toThrow();

    expect(() => MappingSchema.parse({
      name: 'test_mapping',
      fieldMapping: []
    })).toThrow();

    expect(() => MappingSchema.parse({
      name: 'test_mapping',
      targetObject: 'object'
    })).toThrow();
  });

  it('should reject invalid source format', () => {
    expect(() => MappingSchema.parse({
      name: 'test_mapping',
      sourceFormat: 'excel',
      targetObject: 'object',
      fieldMapping: []
    })).toThrow();
  });

  it('should reject invalid mode', () => {
    expect(() => MappingSchema.parse({
      name: 'test_mapping',
      targetObject: 'object',
      fieldMapping: [],
      mode: 'merge'
    })).toThrow();
  });

  it('should reject invalid error policy', () => {
    expect(() => MappingSchema.parse({
      name: 'test_mapping',
      targetObject: 'object',
      fieldMapping: [],
      errorPolicy: 'ignore'
    })).toThrow();
  });
});
