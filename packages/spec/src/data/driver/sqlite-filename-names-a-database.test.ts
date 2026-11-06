// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #30400 — a SQLite `filename` must name a database: exactly `:memory:`, or a
 * file path. `''` and a `:`-prefixed name other than exactly `:memory:` are
 * refused by `SqliteConfigSchema` and `SqliteWasmConfigSchema`.
 *
 * ## What was wrong
 *
 * Both schemas typed `filename` as any placeholder-free string. The New
 * datasource dialog's prefilled `:memory:` with a path typed after it
 * (`:memory:/srv/data/parts.db`) passed, and every layer reads a leading `:`
 * as fileless: native sqlite opened it as a relative path whose directory does
 * not exist (every statement fails), and sqlite-wasm opened a throwaway
 * in-memory database (writes vanish on reconnect). The datasource admin doors
 * refuse it at runtime since #30331, but two doors validate against the spec
 * schema alone and kept storing it:
 *
 *   - the build door: `os build` parses the stack with
 *     `ObjectStackDefinitionSchema` (`packages/cli/src/commands/compile.ts`),
 *     and `defineStack` raises the same parse as `STACK_SCHEMA_INVALID`;
 *   - the metadata door: `PUT /api/v1/meta/datasource/:name` judges the item
 *     with the registered `datasource` type schema
 *     (`getMetadataTypeSchema('datasource')`, `DatasourceSchema`) and answers
 *     its issues as `422 INVALID_METADATA`.
 *
 * ## What is pinned
 *
 *   - refusals on both schemas: one `custom` issue at `filename`, whose message
 *     names the value, says why, and prescribes the fix; no tracker number;
 *   - both doors' schemas carry the refusal, located under the datasource;
 *   - a misspelled alias (`path:`) is still refused as an unknown key pointing
 *     at `filename`, and the renamed value meets this refusal;
 *   - CONTROLS: `:memory:`, the default, relative and absolute paths, a
 *     Windows drive path and a `file:` name still parse unchanged.
 *
 * The filesystem arm (a path that can be neither opened nor created) is not
 * judgeable from the string and stays in the runtime, pinned in
 * `packages/services/service-datasource/src/__tests__/sqlite-filename-neither-memory-nor-path.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { DatasourceSchema } from '../datasource.zod';
import { defineStack, ObjectStackDefinitionSchema } from '../../stack.zod';
import { getMetadataTypeSchema } from '../../kernel/metadata-type-schemas';
import { getDriverConfigSchema } from './config-registry.zod';
import { SqliteConfigSchema, SqliteWasmConfigSchema } from './sqlite.zod';

const SCHEMAS = [
  { driver: 'sqlite', schema: SqliteConfigSchema },
  { driver: 'sqlite-wasm', schema: SqliteWasmConfigSchema },
] as const;

/** The refused values, and the sentence each refusal opens with. */
const REFUSED = [
  { value: ':memory:/srv/data/parts.db', opens: "':memory:/srv/data/parts.db' is neither ':memory:' nor a file path." },
  { value: ':memory:parts.db', opens: "':memory:parts.db' is neither ':memory:' nor a file path." },
  { value: ':mem', opens: "':mem' is neither ':memory:' nor a file path." },
  { value: '::memory:', opens: "'::memory:' is neither ':memory:' nor a file path." },
  { value: ':', opens: "':' is neither ':memory:' nor a file path." },
  { value: '', opens: "'' is empty and names no database file." },
] as const;

/** The values that name a database, and stay accepted byte for byte. */
const ACCEPTED = [
  ':memory:',
  'data/app.db',
  './.objectstack/data/dev.db',
  '/var/lib/objectstack/app.db',
  'C:\\data\\app.db',
  'file:app.db',
  'memory.db',
] as const;

type Envelope = Error & {
  code?: string;
  status?: number;
  issues?: ReadonlyArray<{ code?: string; path?: readonly PropertyKey[]; message?: string }>;
};

function refusal(fn: () => unknown): Envelope | null {
  try {
    fn();
    return null;
  } catch (e) {
    return e as Envelope;
  }
}

const manifest = { id: 'com.example.fx', name: 'fx', version: '1.0.0', type: 'app' as const };

describe('SQLite `filename` refuses a value that names no database', () => {
  for (const { driver, schema } of SCHEMAS) {
    describe(driver, () => {
      it('is the schema the driver registry answers for the driver id', () => {
        expect(getDriverConfigSchema(driver)).toBe(schema);
      });

      for (const { value, opens } of REFUSED) {
        it(`refuses ${JSON.stringify(value)}: one custom issue at \`filename\` naming the value, why, and the fix`, () => {
          const result = schema.safeParse({ filename: value });
          expect(result.success).toBe(false);
          const issues = result.error!.issues;
          expect(issues).toHaveLength(1);
          expect(issues[0]!.code).toBe('custom');
          expect(issues[0]!.path).toEqual(['filename']);
          const message = issues[0]!.message;
          expect(message.startsWith(opens), message).toBe(true);
          // The prescription: `:memory:` for an ephemeral database, or a file path.
          expect(message).toContain("':memory:' for an ephemeral");
          expect(message).toContain('the path of a database file');
          expect(message).not.toMatch(/#\d{3,}/);
        });
      }

      it('a `:`-prefixed refusal says why: a leading `:` is not read as a file', () => {
        const message = schema.safeParse({ filename: ':memory:/tmp/x.db' }).error!.issues[0]!.message;
        expect(message).toContain("A name that starts with ':' is not read as a file, so this datasource would store nothing");
        expect(message).toContain("use exactly ':memory:'");
      });

      it('composes with the placeholder refusal: a `:${…}` value reports both', () => {
        const result = schema.safeParse({ filename: ':${DATA_DIR}/app.db' });
        expect(result.success).toBe(false);
        expect(result.error!.issues).toHaveLength(2);
        expect(result.error!.issues.every((i) => i.path.join('.') === 'filename')).toBe(true);
        expect(result.error!.issues.some((i) => i.message.includes('is neither'))).toBe(true);
      });

      it('a misspelled alias is still refused as an unknown key pointing at `filename`; renamed, it meets the refusal', () => {
        const aliased = schema.safeParse({ path: ':memory:/tmp/x.db' });
        expect(aliased.success).toBe(false);
        expect(aliased.error!.issues).toHaveLength(1);
        expect(aliased.error!.issues[0]!.code).toBe('unrecognized_keys');
        expect(aliased.error!.issues[0]!.message).toContain('filename');

        const renamed = schema.safeParse({ filename: ':memory:/tmp/x.db' });
        expect(renamed.success).toBe(false);
        expect(renamed.error!.issues[0]!.path).toEqual(['filename']);
      });

      for (const value of ACCEPTED) {
        it(`CONTROL: ${JSON.stringify(value)} still parses unchanged`, () => {
          const result = schema.safeParse({ filename: value });
          expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
          expect(result.data!.filename).toBe(value);
        });
      }

      it('CONTROL: an absent `filename` still defaults to `:memory:`', () => {
        const result = schema.safeParse({});
        expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
        expect(result.data!.filename).toBe(':memory:');
      });
    });
  }
});

describe('the doors that judge a datasource against the spec alone refuse it', () => {
  for (const { driver } of SCHEMAS) {
    const row = (filename: string) => ({ name: 'parts', driver, config: { filename } });

    it(`${driver} · metadata door: the registered \`datasource\` type schema refuses it at config.filename`, () => {
      const typeSchema = getMetadataTypeSchema('datasource');
      expect(typeSchema).toBe(DatasourceSchema);
      const result = typeSchema!.safeParse(row(':memory:/srv/data/parts.db'));
      expect(result.success).toBe(false);
      const hits = result.error!.issues.filter((i) => i.path.join('.') === 'config.filename');
      expect(hits).toHaveLength(1);
      expect(hits[0]!.code).toBe('custom');
      expect(hits[0]!.message).toContain("':memory:/srv/data/parts.db' is neither ':memory:' nor a file path");

      const empty = typeSchema!.safeParse(row(''));
      expect(empty.success).toBe(false);
      expect(empty.error!.issues.map((i) => i.path.join('.'))).toEqual(['config.filename']);
    });

    it(`${driver} · build door: the stack parse refuses it at datasources.0.config.filename`, () => {
      const result = ObjectStackDefinitionSchema.safeParse({ manifest, datasources: [row(':memory:/srv/data/parts.db')] });
      expect(result.success).toBe(false);
      const hits = result.error!.issues.filter((i) => i.path.join('.') === 'datasources.0.config.filename');
      expect(hits).toHaveLength(1);
      expect(hits[0]!.code).toBe('custom');
      expect(hits[0]!.message).toContain('is neither');
    });

    it(`${driver} · build door: defineStack raises STACK_SCHEMA_INVALID / 422 at datasources.0.config.filename`, () => {
      const refused = refusal(() => defineStack({ manifest, datasources: [row('')] } as never));
      expect(refused?.code).toBe('STACK_SCHEMA_INVALID');
      expect(refused?.status).toBe(422);
      const hits = (refused?.issues ?? []).filter((i) => (i.path ?? []).join('.') === 'datasources.0.config.filename');
      expect(hits).toHaveLength(1);
      expect(hits[0]!.message).toContain("'' is empty and names no database file");
    });

    it(`${driver} · CONTROL: both doors still accept \`:memory:\` and a file path`, () => {
      for (const filename of [':memory:', 'data/parts.db']) {
        const meta = getMetadataTypeSchema('datasource')!.safeParse(row(filename));
        expect(meta.success, `${filename}: ${JSON.stringify(meta.error?.issues)}`).toBe(true);
        const stack = ObjectStackDefinitionSchema.safeParse({ manifest, datasources: [row(filename)] });
        expect(stack.success, `${filename}: ${JSON.stringify(stack.error?.issues)}`).toBe(true);
      }
    });
  }
});
