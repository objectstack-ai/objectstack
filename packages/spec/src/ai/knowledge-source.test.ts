// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `KnowledgeSourceSchema` — pins for the governed `knowledge_source` type
// (ADR-0161 K4, K5, K6).
//
// One schema serves every door: the stack's `knowledgeSources`, a `/meta` save,
// and a registration in code. So what these pins hold is what each door
// refuses:
//
// - the shape is strict at every level — an unknown key is refused, never
//   dropped;
// - the six renamed or removed keys are tombstones, each refused with its own
//   prescription, and the `file` / `http` kinds are refused with theirs;
// - a prescription that names `os migrate meta` first names the door every
//   source written against 18 came through, a registration in code, which
//   that command does not walk, and says the edit is made there;
// - `content` is a non-empty list of field names, and `'*'` is refused;
// - `name` takes the router-addressable grammar (ADR-0150 D5).
//
// The registry row, the stack collection and the conversions have their own
// tests; the type-level half (a registration writing `id` does not compile)
// is the last case here.

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '../kernel/metadata-plugin.zod';
import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';
import { ObjectStackDefinitionSchema } from '../stack.zod';
import {
  KnowledgeSourceSchema,
  type KnowledgeSource,
  type KnowledgeSourceParsed,
} from './knowledge-source.zod';

const SOURCE: KnowledgeSource = {
  name: 'kb_articles',
  label: 'KB articles',
  adapter: 'memory',
  source: { kind: 'object', object: 'kb_article', content: ['title', 'body'] },
};

/** The issues of a refused parse, as `[code, path, message]`. */
function issuesOf(input: unknown): Array<[string, string, string]> {
  const r = KnowledgeSourceSchema.safeParse(input);
  expect(r.success, 'the input should be refused').toBe(false);
  if (r.success) return [];
  return r.error.issues.map((i) => [i.code, i.path.join('.'), i.message]);
}

/**
 * The door every source written against 18 came through: a registration in
 * code. No stack could hold `knowledgeSources` before the type, and
 * `os migrate meta` walks a stack's collections, so it lists no edit for one.
 */
const CODE_DOOR = ['`KnowledgeServicePlugin({ sources })`', '`registerSource`', 'in the registration itself'];

/** `message` names the code door and where the edit is made, before the sentence that names the command. */
function expectCodeDoorBeforeCommand(message: string): void {
  const command = message.indexOf('Run `os migrate meta --from 18`');
  expect(command, 'the prescription names the command').toBeGreaterThan(-1);
  for (const named of CODE_DOOR) {
    const at = message.indexOf(named);
    expect(at, `${named} is named`).toBeGreaterThan(-1);
    expect(at, `${named} is named before the command`).toBeLessThan(command);
  }
}

describe('KnowledgeSourceSchema — the one schema of the knowledge_source type', () => {
  it('positive control: a source parses, with its defaults stated', () => {
    const parsed: KnowledgeSourceParsed = KnowledgeSourceSchema.parse(SOURCE);
    expect(parsed).toEqual({
      ...SOURCE,
      source: { ...SOURCE.source, metadataFields: [] },
      refresh: {},
      aiExposed: true,
    });
  });

  it('is the schema the metadata-type registry maps `knowledge_source` to — no second schema', () => {
    expect(getMetadataTypeSchema('knowledge_source')).toBe(KnowledgeSourceSchema);
  });

  it('is registered runtime-creatable, versioned, and with no environment overlay (ADR-0161 K4 clause 2)', () => {
    const row = DEFAULT_METADATA_TYPE_REGISTRY.find((t) => t.type === 'knowledge_source');
    expect(row).toMatchObject({
      type: 'knowledge_source',
      domain: 'ai',
      allowRuntimeCreate: true,
      allowEnvironmentOverlay: false,
      supportsVersioning: true,
      filePatterns: ['**/*.knowledge-source.ts', '**/*.knowledge-source.yml'],
    });
  });

  it('is the stack collection `knowledgeSources`, parsed by the same schema', () => {
    const ok = ObjectStackDefinitionSchema.safeParse({ knowledgeSources: [SOURCE] });
    expect(ok.success, ok.success ? '' : JSON.stringify(ok.error.issues)).toBe(true);

    const refused = ObjectStackDefinitionSchema.safeParse({ knowledgeSources: [{ ...SOURCE, bogus: 1 }] });
    expect(refused.success).toBe(false);
    if (!refused.success) {
      expect(refused.error.issues.map((i) => [i.code, i.path.join('.')])).toContainEqual([
        'unrecognized_keys',
        'knowledgeSources.0',
      ]);
    }
  });
});

describe('KnowledgeSourceSchema — strict: an unknown key is refused, not dropped', () => {
  it.each([
    ['the source', { ...SOURCE, bogus: 1 }, '', 'this knowledge source'],
    ['its `source`', { ...SOURCE, source: { ...SOURCE.source, bogus: 1 } }, 'source', "this knowledge source's `source`"],
    ['its `refresh`', { ...SOURCE, refresh: { bogus: 1 } }, 'refresh', 'this refresh policy'],
    [
      'its `split`',
      { ...SOURCE, source: { ...SOURCE.source, split: { strategy: 'recursive', bogus: 1 } } },
      'source.split',
      'this split',
    ],
  ])('on %s', (_label, input, path, surface) => {
    const issues = issuesOf(input);
    expect(issues).toHaveLength(1);
    const [code, at, message] = issues[0]!;
    expect([code, at]).toEqual(['unrecognized_keys', path]);
    expect(message).toContain(`Unrecognized key(s) on ${surface}: \`bogus\`.`);
  });

  it('names the key the author most likely meant', () => {
    expect(issuesOf({ ...SOURCE, title: 'KB' })[0]![2]).toContain('`title` → `label`');
    expect(issuesOf({ ...SOURCE, source: { ...SOURCE.source, fields: ['title'] } })[0]![2]).toContain(
      '`fields` → `content`',
    );
  });
});

describe('KnowledgeSourceSchema — the renamed and removed keys are tombstones (ADR-0161 K6)', () => {
  const MIGRATE =
    'Run `os migrate meta --from 18` to list the mechanical edits for existing sources; `--write` applies the '
    + 'ones it can prove, and you apply the rest by hand.';

  it.each([
    ['id', { ...SOURCE, id: 'kb_articles' }, 'id', 'use `name`'],
    [
      'source.contentFields',
      { ...SOURCE, source: { ...SOURCE.source, contentFields: ['title'] } },
      'source.contentFields',
      'use `content`',
    ],
    [
      'embedding',
      { ...SOURCE, embedding: { provider: 'openai', model: 'text-embedding-3-small' } },
      'embedding',
      'The embedder is configured once for the deployment',
    ],
    [
      'vectorStore',
      { ...SOURCE, vectorStore: { provider: 'pgvector' } },
      'vectorStore',
      'The store is the adapter the deployment installs',
    ],
    [
      'adapterConfig',
      { ...SOURCE, adapterConfig: { datasetId: 'ds_1' } },
      'adapterConfig',
      'An adapter takes its settings as options of the plugin that mounts it',
    ],
    [
      'refresh.cron',
      { ...SOURCE, refresh: { cron: '0 3 * * *' } },
      'refresh.cron',
      'call `reindexSource` from a flow or a job',
    ],
  ])('`%s` is refused at its own path with its prescription, the code door and the migrate sentence', (key, input, path, fix) => {
    const issues = issuesOf(input);
    expect(issues).toHaveLength(1);
    const [code, at, message] = issues[0]!;
    expect([code, at]).toEqual(['invalid_type', path]);
    expect(message).toContain(`\`knowledge_source.${key}\` was removed in @objectstack/spec 19.0.0 (ADR-0161 K6)`);
    expect(message).toContain(fix);
    expectCodeDoorBeforeCommand(message);
    expect(message.endsWith(MIGRATE)).toBe(true);
  });

  it.each(['file', 'http'])('the `%s` kind is refused at `source.kind` with the one-arm prescription', (kind) => {
    const issues = issuesOf({ ...SOURCE, source: { kind } });
    const atKind = issues.filter(([, path]) => path === 'source.kind');
    expect(atKind).toHaveLength(1);
    expect(atKind[0]![0]).toBe('invalid_value');
    expect(atKind[0]![2]).toContain(
      'The `file` and `http` shapes of `knowledge_source.source` were removed in @objectstack/spec 19.0.0 (ADR-0161 K4)',
    );
    expect(atKind[0]![2]).toContain("write `source: { kind: 'object', object, content }`");
  });

  it.each(['prefix', 'mimeTypes', 'urls', 'userAgent'])(
    'the retired arm key `%s` is refused on an object source, with the same prescription',
    (key) => {
      const issues = issuesOf({ ...SOURCE, source: { ...SOURCE.source, [key]: 'x' } });
      expect(issues).toHaveLength(1);
      expect([issues[0]![0], issues[0]![1]]).toEqual(['unrecognized_keys', 'source']);
      expect(issues[0]![2]).toContain(`\`${key}\``);
      expect(issues[0]![2]).toContain('The `file` and `http` shapes of `knowledge_source.source` were removed');
    },
  );
});

describe('KnowledgeSourceSchema — `content` lists fields (ADR-0161 K5)', () => {
  it("refuses `'*'` at the member's own path, with the prescription to list the fields", () => {
    const issues = issuesOf({ ...SOURCE, source: { ...SOURCE.source, content: ['title', '*'] } });
    expect(issues).toHaveLength(1);
    const [code, at, message] = issues[0]!;
    expect([code, at]).toEqual(['invalid_format', 'source.content.1']);
    expect(message).toContain("the `'*'` member was removed in @objectstack/spec 19.0.0 (ADR-0161 K5)");
    expect(message).toContain("List the fields whose text should be indexed, for example `content: ['title', 'body']`.");
    expectCodeDoorBeforeCommand(message);
  });

  it('refuses an empty list and an absent one', () => {
    expect(issuesOf({ ...SOURCE, source: { ...SOURCE.source, content: [] } }).map(([c, p]) => [c, p])).toEqual([
      ['too_small', 'source.content'],
    ]);
    const { content: _content, ...withoutContent } = SOURCE.source;
    expect(issuesOf({ ...SOURCE, source: withoutContent }).map(([c, p]) => [c, p])).toEqual([
      ['invalid_type', 'source.content'],
    ]);
  });

  it('refuses an empty-string member at its own path: it names no field and would index nothing', () => {
    const issues = issuesOf({ ...SOURCE, source: { ...SOURCE.source, content: ['title', ''] } });
    expect(issues).toHaveLength(1);
    const [code, at, message] = issues[0]!;
    expect([code, at]).toEqual(['too_small', 'source.content.1']);
    expect(message).toContain('an empty string names no field');
    // The published JSON Schema refuses it too: the constraint is a length, not a refinement.
    const published = z.toJSONSchema(KnowledgeSourceSchema, { io: 'input', unrepresentable: 'any' }) as unknown as {
      properties: { source: { properties: { content: { items: { minLength?: number } } } } };
    };
    expect(published.properties.source.properties.content.items.minLength).toBe(1);
  });

  it("a field whose name merely contains `*` is not the wildcard — only the bare `'*'` member is refused here", () => {
    // Whether such a field exists is the admission gate's question, at save
    // and at search; the parse refuses the wildcard and nothing else.
    expect(KnowledgeSourceSchema.safeParse({ ...SOURCE, source: { ...SOURCE.source, content: ['a*'] } }).success).toBe(
      true,
    );
  });
});

describe('KnowledgeSourceSchema — `name` takes the router-addressable grammar (ADR-0150 D5)', () => {
  it.each(['_internal', 'Kb', 'kb-articles', '9lives', ''])('refuses %j', (name) => {
    const issues = issuesOf({ ...SOURCE, name });
    expect(issues.map(([, path]) => path)).toEqual(['name']);
  });

  it('a leading underscore is refused with the reason: the prefix is not an author\'s to take', () => {
    expect(issuesOf({ ...SOURCE, name: '_p0123456789abcdef_kb' })[0]![2]).toContain('A leading "_" is reserved');
  });
});

describe('KnowledgeSource — the compiler is the third channel (ADR-0161 K6 item 3)', () => {
  it('a TypeScript registration that still writes `id` or `contentFields` does not compile', () => {
    const viaId: KnowledgeSource = {
      ...SOURCE,
      // @ts-expect-error — `id` is a tombstone: its type is `never`.
      id: 'kb_articles',
    };
    const viaContentFields: KnowledgeSource = {
      ...SOURCE,
      source: {
        ...SOURCE.source,
        // @ts-expect-error — `contentFields` is a tombstone: its type is `never`.
        contentFields: ['title'],
      },
    };
    const viaFileKind: KnowledgeSource = {
      ...SOURCE,
      // @ts-expect-error — `source.kind` has one arm, `object`.
      source: { kind: 'file', object: 'kb_article', content: ['title'] },
    };
    expect([viaId, viaContentFields, viaFileKind]).toHaveLength(3);
  });
});
