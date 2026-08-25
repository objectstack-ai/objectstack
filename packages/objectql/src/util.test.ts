import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  toTitleCase,
  convertIntrospectedSchemaToObjects,
} from './util';
import type { IntrospectedSchema } from './util';

describe('toTitleCase', () => {
  it('should convert snake_case to Title Case', () => {
    expect(toTitleCase('first_name')).toBe('First Name');
    expect(toTitleCase('project_task')).toBe('Project Task');
  });

  it('should capitalize single words', () => {
    expect(toTitleCase('name')).toBe('Name');
    expect(toTitleCase('status')).toBe('Status');
  });

  it('should handle multiple underscores', () => {
    expect(toTitleCase('long_multi_word_name')).toBe('Long Multi Word Name');
  });

  it('should handle empty string', () => {
    expect(toTitleCase('')).toBe('');
  });
});

describe('convertIntrospectedSchemaToObjects', () => {
  const sampleSchema: IntrospectedSchema = {
    dialect: 'sqlite',
    introspectedAt: '2026-08-22T00:00:00.000Z',
    tables: {
      users: {
        name: 'users',
        columns: [
          { name: 'id', type: 'integer', nullable: false, primaryKey: true },
          { name: 'name', type: 'varchar', nullable: false, primaryKey: false, maxLength: 255 },
          { name: 'email', type: 'varchar', nullable: false, primaryKey: false, isUnique: true, maxLength: 320 },
          { name: 'bio', type: 'text', nullable: true, primaryKey: false },
          { name: 'age', type: 'integer', nullable: true, primaryKey: false },
          { name: 'is_active', type: 'boolean', nullable: false, primaryKey: false, defaultValue: true },
          { name: 'created_at', type: 'timestamp', nullable: false, primaryKey: false },
          { name: 'updated_at', type: 'timestamp', nullable: true, primaryKey: false },
        ],
        foreignKeys: [],
        primaryKeys: ['id'],
      },
      posts: {
        name: 'posts',
        columns: [
          { name: 'id', type: 'integer', nullable: false, primaryKey: true },
          { name: 'title', type: 'varchar', nullable: false, primaryKey: false, maxLength: 500 },
          { name: 'body', type: 'text', nullable: true, primaryKey: false },
          { name: 'author_id', type: 'integer', nullable: false, primaryKey: false },
          { name: 'metadata', type: 'jsonb', nullable: true, primaryKey: false },
          { name: 'published_at', type: 'date', nullable: true, primaryKey: false },
          { name: 'created_at', type: 'timestamp', nullable: false, primaryKey: false },
          { name: 'updated_at', type: 'timestamp', nullable: true, primaryKey: false },
        ],
        foreignKeys: [
          {
            columnName: 'author_id',
            referencedTable: 'users',
            referencedColumn: 'id',
            constraintName: 'fk_posts_author',
          },
        ],
        primaryKeys: ['id'],
      },
    },
  };

  it('should convert all tables by default', () => {
    const objects = convertIntrospectedSchemaToObjects(sampleSchema);
    expect(objects).toHaveLength(2);
    expect(objects.map((o) => o.name)).toEqual(['users', 'posts']);
  });

  it('should skip system columns by default', () => {
    const objects = convertIntrospectedSchemaToObjects(sampleSchema);
    const users = objects.find((o) => o.name === 'users')!;
    const fieldNames = Object.keys(users.fields);
    expect(fieldNames).not.toContain('id');
    expect(fieldNames).not.toContain('created_at');
    expect(fieldNames).not.toContain('updated_at');
    expect(fieldNames).toContain('name');
    expect(fieldNames).toContain('email');
  });

  it('should include system columns when skipSystemColumns=false', () => {
    const objects = convertIntrospectedSchemaToObjects(sampleSchema, {
      skipSystemColumns: false,
    });
    const users = objects.find((o) => o.name === 'users')!;
    const fieldNames = Object.keys(users.fields);
    expect(fieldNames).toContain('id');
    expect(fieldNames).toContain('created_at');
    expect(fieldNames).toContain('updated_at');
  });

  it('should map varchar to text and text to textarea', () => {
    const objects = convertIntrospectedSchemaToObjects(sampleSchema);
    const users = objects.find((o) => o.name === 'users')!;
    expect(users.fields.name.type).toBe('text');
    expect(users.fields.bio.type).toBe('textarea');
  });

  it('should map integer to number', () => {
    const objects = convertIntrospectedSchemaToObjects(sampleSchema);
    const users = objects.find((o) => o.name === 'users')!;
    expect(users.fields.age.type).toBe('number');
  });

  it('should map boolean to boolean', () => {
    const objects = convertIntrospectedSchemaToObjects(sampleSchema);
    const users = objects.find((o) => o.name === 'users')!;
    expect(users.fields.is_active.type).toBe('boolean');
    expect(users.fields.is_active.defaultValue).toBe(true);
  });

  it('should map jsonb to json', () => {
    const objects = convertIntrospectedSchemaToObjects(sampleSchema);
    const posts = objects.find((o) => o.name === 'posts')!;
    expect(posts.fields.metadata.type).toBe('json');
  });

  it('should map date to date', () => {
    const objects = convertIntrospectedSchemaToObjects(sampleSchema);
    const posts = objects.find((o) => o.name === 'posts')!;
    expect(posts.fields.published_at.type).toBe('date');
  });

  it('should map foreign keys to lookup fields', () => {
    const objects = convertIntrospectedSchemaToObjects(sampleSchema);
    const posts = objects.find((o) => o.name === 'posts')!;
    expect(posts.fields.author_id.type).toBe('lookup');
    expect(posts.fields.author_id.reference).toBe('users');
  });

  it('should set unique constraint', () => {
    const objects = convertIntrospectedSchemaToObjects(sampleSchema);
    const users = objects.find((o) => o.name === 'users')!;
    expect(users.fields.email.unique).toBe(true);
  });

  it('should set maxLength for text fields', () => {
    const objects = convertIntrospectedSchemaToObjects(sampleSchema);
    const users = objects.find((o) => o.name === 'users')!;
    expect(users.fields.name.maxLength).toBe(255);
    expect(users.fields.email.maxLength).toBe(320);
  });

  it('should set required based on nullable', () => {
    const objects = convertIntrospectedSchemaToObjects(sampleSchema);
    const users = objects.find((o) => o.name === 'users')!;
    expect(users.fields.name.required).toBe(true);
    expect(users.fields.bio.required).toBe(false);
  });

  it('should generate labels from table/field names', () => {
    const objects = convertIntrospectedSchemaToObjects(sampleSchema);
    const users = objects.find((o) => o.name === 'users')!;
    expect(users.label).toBe('Users');
    expect(users.fields.is_active.label).toBe('Is Active');
  });

  it('should exclude tables when excludeTables is specified', () => {
    const objects = convertIntrospectedSchemaToObjects(sampleSchema, {
      excludeTables: ['posts'],
    });
    expect(objects).toHaveLength(1);
    expect(objects[0].name).toBe('users');
  });

  it('should include only specified tables when includeTables is specified', () => {
    const objects = convertIntrospectedSchemaToObjects(sampleSchema, {
      includeTables: ['posts'],
    });
    expect(objects).toHaveLength(1);
    expect(objects[0].name).toBe('posts');
  });

  it('should handle empty schema', () => {
    const objects = convertIntrospectedSchemaToObjects({
      dialect: 'sqlite',
      introspectedAt: '2026-08-22T00:00:00.000Z',
      tables: {},
    });
    expect(objects).toHaveLength(0);
  });

  it('should handle numeric types (float, decimal, real)', () => {
    const schema: IntrospectedSchema = {
      dialect: 'sqlite',
      introspectedAt: '2026-08-22T00:00:00.000Z',
      tables: {
        metrics: {
          name: 'metrics',
          columns: [
            { name: 'price', type: 'decimal', nullable: false, primaryKey: false },
            { name: 'weight', type: 'float', nullable: true, primaryKey: false },
            { name: 'score', type: 'real', nullable: true, primaryKey: false },
            { name: 'quantity', type: 'bigint', nullable: false, primaryKey: false },
          ],
          foreignKeys: [],
          primaryKeys: [],
        },
      },
    };
    const objects = convertIntrospectedSchemaToObjects(schema);
    const metrics = objects[0];
    expect(metrics.fields.price.type).toBe('number');
    expect(metrics.fields.weight.type).toBe('number');
    expect(metrics.fields.score.type).toBe('number');
    expect(metrics.fields.quantity.type).toBe('number');
  });

  describe('a foreign key whose target carries referencedSchema is refused, loudly (#11377)', () => {
    /**
     * The card's measured shape: `cross_child.p` references
     * `os11377_far.remote_parent`, a table outside the introspecting
     * session's resolution scope, so the driver's answer carries
     * `referencedSchema` beside the BARE `referencedTable`. `q` is the
     * in-scope control — no `referencedSchema`, wired exactly as before.
     */
    const crossSchema: IntrospectedSchema = {
      dialect: 'postgres',
      introspectedAt: '2026-08-24T00:00:00.000Z',
      tables: {
        cross_child: {
          name: 'cross_child',
          columns: [
            { name: 'id', type: 'varchar', nullable: false, primaryKey: true },
            { name: 'p', type: 'varchar', nullable: true, primaryKey: false, maxLength: 64 },
            { name: 'q', type: 'varchar', nullable: false, primaryKey: false },
          ],
          foreignKeys: [
            {
              columnName: 'p',
              referencedTable: 'remote_parent',
              referencedColumn: 'id',
              constraintName: 'fk_cross',
              referencedSchema: 'os11377_far',
            },
            {
              columnName: 'q',
              referencedTable: 'local_parent',
              referencedColumn: 'id',
              constraintName: 'fk_local',
            },
          ],
          primaryKeys: ['id'],
        },
      },
    };

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('creates NO lookup field — the column converts as a plain field instead', () => {
      const logger = { warn: vi.fn() };
      const objects = convertIntrospectedSchemaToObjects(crossSchema, {
        skipSystemColumns: false,
        logger,
      });

      // The whole field, strictly: not a lookup, no `reference` key at all —
      // a lookup wired to the bare name is exactly the #11201 wrong-object
      // collision this refusal exists to prevent. The plain path still reads
      // the column's own facts (`maxLength`, nullability).
      expect(objects[0].fields.p).toStrictEqual({
        name: 'p',
        type: 'text',
        label: 'P',
        required: false,
        maxLength: 64,
      });
      expect(Object.keys(objects[0].fields.p)).not.toContain('reference');
    });

    it('flags the refusal through options.logger, naming the constraint, the address and the remedy', () => {
      const logger = { warn: vi.fn() };
      convertIntrospectedSchemaToObjects(crossSchema, { skipSystemColumns: false, logger });

      expect(logger.warn).toHaveBeenCalledTimes(1);
      const [message, meta] = logger.warn.mock.calls[0]!;
      // The pinned message: what was refused, why, and what to do.
      expect(message).toContain('[convert-introspected-schema]');
      expect(message).toContain('foreign key fk_cross on cross_child.p');
      expect(message).toContain('references os11377_far.remote_parent');
      expect(message).toContain("OUTSIDE the introspecting session's resolution scope");
      expect(message).toContain('NO lookup field was created');
      expect(message).toContain('converted as a plain field');
      expect(message).toContain("Re-introspect with the parent's schema on the session's search path");
      expect(meta).toStrictEqual({
        table: 'cross_child',
        column: 'p',
        constraint: 'fk_cross',
        referencedSchema: 'os11377_far',
        referencedTable: 'remote_parent',
      });
    });

    it('is loud with NO logger passed — the flag defaults to console.warn', () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      convertIntrospectedSchemaToObjects(crossSchema, { skipSystemColumns: false });

      expect(spy).toHaveBeenCalledTimes(1);
      expect(String(spy.mock.calls[0]![0])).toContain('[convert-introspected-schema]');
    });

    it('keeps wiring a resolvable foreign key byte-identically, with no flag', () => {
      const logger = { warn: vi.fn() };
      const objects = convertIntrospectedSchemaToObjects(crossSchema, {
        skipSystemColumns: false,
        logger,
      });

      // The in-scope control: the pre-#11377 lookup shape, the whole object.
      expect(objects[0].fields.q).toStrictEqual({
        name: 'q',
        type: 'lookup',
        reference: 'local_parent',
        label: 'Q',
        required: true,
      });
      // ONE warn — the cross-schema refusal above, nothing about `q`.
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(String(logger.warn.mock.calls[0]![0])).not.toContain('fk_local');
    });
  });

  it('should handle time type', () => {
    const schema: IntrospectedSchema = {
      dialect: 'sqlite',
      introspectedAt: '2026-08-22T00:00:00.000Z',
      tables: {
        schedule: {
          name: 'schedule',
          columns: [
            { name: 'start_time', type: 'time', nullable: false, primaryKey: false },
          ],
          foreignKeys: [],
          primaryKeys: [],
        },
      },
    };
    const objects = convertIntrospectedSchemaToObjects(schema);
    expect(objects[0].fields.start_time.type).toBe('time');
  });
});
