// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `FilesystemLoader.save()` annotates a `typescript`-format file with the spec
 * type of the item's metadata type, through the package-internal
 * `serializeTypeScriptForMetadataType`. This file holds that annotation to the
 * one property that makes it worth writing: it is never false.
 *
 * Every annotated metadata type is compiled here with `tsc`, twice:
 *  - a spec-valid body must type-check with no diagnostic at all;
 *  - the same body plus one undeclared key must fail with exactly TS2353. That
 *    is what makes the annotation a check: a spec type that is `unknown` (as
 *    `ViewMetadata` is) would pass the first file and the second.
 *
 * `@objectstack/spec` is resolved the way a consumer of a saved file resolves
 * it, through this package's `node_modules` and the `exports` map's `types`,
 * so this reads spec's BUILT `dist/*.d.ts`. `turbo test` builds it first
 * (`^build`); a bare `vitest run` needs `pnpm --filter @objectstack/spec build`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { MetadataTypeSchema, getMetadataTypeSchema } from '@objectstack/spec/kernel';
import { TypeScriptSerializer, serializeTypeScriptForMetadataType } from './typescript-serializer.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** One spec-valid body per metadata type the serializer annotates. */
const REPRESENTATIVE: Record<string, Record<string, unknown>> = {
  object: { name: 'account', label: 'Account', fields: { name: { type: 'text', label: 'Name' } } },
  field: { name: 'title', type: 'text', label: 'Title' },
  hook: { name: 'account_audit', object: 'account', events: ['beforeInsert'], handler: 'audit_account' },
  seed: { object: 'account', records: [{ name: 'Acme' }] },
  mapping: { name: 'account_import', targetObject: 'account', fieldMapping: [] },
  datasource: { name: 'warehouse', driver: 'sqlite', config: {} },
  analytics_cube: { name: 'account_cube', sql: 'account', measures: {}, dimensions: {} },
  page: { name: 'account_home', label: 'Account Home', regions: [] },
  dashboard: { name: 'ops', label: 'Ops', widgets: [] },
  app: { name: 'sales', label: 'Sales' },
  action: { name: 'close_account', label: 'Close', type: 'script', target: 'close_account' },
  report: { name: 'hours_by_status', label: 'Hours by status', dataset: 'task_metrics', rows: ['status'], values: ['est_hours'] },
  dataset: { name: 'account_ds', label: 'Accounts', object: 'account', dimensions: [], measures: [] },
  flow: { name: 'notify_owner', label: 'Notify owner', type: 'autolaunched', nodes: [], edges: [] },
  webhook: { name: 'account_hook', object: 'account', triggers: ['create'], url: 'https://example.com/hook' },
  job: { name: 'nightly_sweep', schedule: { type: 'cron', expression: '0 2 * * *' }, handler: 'sweep' },
  translation: { locale: 'en', objects: { account: { label: 'Account' } } },
  email_template: { name: 'welcome', label: 'Welcome', subject: 'Welcome', bodyHtml: 'Hello' },
  doc: { name: 'getting_started', label: 'Getting Started', content: '# Hello' },
  api: { name: 'ping', path: '/api/v1/apps/demo/ping', method: 'GET', type: 'object_operation', target: 'account' },
  permission: { name: 'sales_user', label: 'Sales user', objects: {} },
  sharing_rule: {
    name: 'share_accounts', object: 'account', type: 'criteria', condition: 'true',
    sharedWith: { type: 'team', value: 'sales' }, accessLevel: 'read',
  },
  capability: { name: 'manage_accounts', label: 'Manage accounts' },
  position: { name: 'sales_rep', label: 'Sales rep' },
  agent: { name: 'support_agent', label: 'Support', role: 'Support', instructions: 'Help users.', skills: ['case_management'] },
  tool: { name: 'list_records', label: 'List records', description: 'Lists records', parameters: {} },
  skill: { name: 'case_management', label: 'Case management', tools: [] },
  connector: { name: 'status_api', label: 'Status API', type: 'api', authentication: { type: 'none' } },
};

/** Stack collections `getMetadataTypeSchema()` binds that are not `MetadataTypeSchema` members. */
const NON_MEMBER_TYPES = ['webhook', 'connector', 'sharing_rule', 'analytics_cube'];

const serializer = new TypeScriptSerializer('typescript');
const annotates = (metadataType: string): boolean =>
  serializeTypeScriptForMetadataType({ name: 'x' }, metadataType).startsWith('import type {');

/** This package's `exports` entries, as the source modules tsup builds them from. */
const PACKAGE_ROOT = resolve(HERE, '../..');
const EXPORT_ENTRY_SOURCES: string[] = Object.values(
  JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')).exports as Record<string, { import: { default: string } }>,
).map((entry) => join(PACKAGE_ROOT, entry.import.default.replace(/^\.\/dist\//, 'src/').replace(/\.js$/, '.ts')));

/** Type-check in-memory files as if they sat in this directory. */
function typeCheck(files: ReadonlyMap<string, string>): readonly ts.Diagnostic[] {
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    types: [],
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  };
  const host = ts.createCompilerHost(options, true);
  const { getSourceFile, fileExists, readFile } = host;
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
    const text = files.get(fileName);
    return text === undefined
      ? getSourceFile.call(host, fileName, languageVersion, onError, shouldCreate)
      : ts.createSourceFile(fileName, text, languageVersion, true);
  };
  host.fileExists = (fileName) => files.has(fileName) || fileExists.call(host, fileName);
  host.readFile = (fileName) => files.get(fileName) ?? readFile.call(host, fileName);
  return ts.getPreEmitDiagnostics(ts.createProgram([...files.keys()], options, host));
}

describe('TypeScriptSerializer annotation, per metadata type', () => {
  it('every representative body is valid for its metadata type', () => {
    for (const [metadataType, item] of Object.entries(REPRESENTATIVE)) {
      const result = getMetadataTypeSchema(metadataType)?.safeParse(item);
      expect(result?.success, metadataType).toBe(true);
    }
  });

  it('annotates exactly the representative metadata types, and never view, book or external_catalog', () => {
    const universe = new Set([...MetadataTypeSchema.options, ...NON_MEMBER_TYPES, ...Object.keys(REPRESENTATIVE)]);
    const annotated = [...universe].filter(annotates).sort();
    expect(annotated).toEqual(Object.keys(REPRESENTATIVE).sort());
    for (const metadataType of ['view', 'book', 'external_catalog']) {
      expect(annotates(metadataType), metadataType).toBe(false);
    }
  });

  it('the public TypeScriptSerializer.serialize() annotates none of them', () => {
    for (const item of Object.values(REPRESENTATIVE)) {
      expect(serializer.serialize(item).startsWith('export const metadata = {')).toBe(true);
    }
  });

  it('no exports entry of the package re-exports the internal channel', async () => {
    expect(EXPORT_ENTRY_SOURCES.length).toBe(5);
    for (const source of EXPORT_ENTRY_SOURCES) {
      const entry = (await import(source)) as Record<string, unknown>;
      expect(Object.keys(entry).length, source).toBeGreaterThan(0);
      expect(Object.keys(entry), source).not.toContain('serializeTypeScriptForMetadataType');
    }
  });

  it('round-trips every annotated body through serialize and deserialize', () => {
    for (const [metadataType, item] of Object.entries(REPRESENTATIVE)) {
      expect(serializer.deserialize(serializeTypeScriptForMetadataType(item, metadataType)), metadataType).toEqual(item);
    }
  });

  it('tsc: a valid body type-checks and an undeclared key is refused (TS2353), for every annotation', () => {
    const dir = join(HERE, '__annotation_type_check__');
    const files = new Map<string, string>();
    for (const [metadataType, item] of Object.entries(REPRESENTATIVE)) {
      const valid = serializeTypeScriptForMetadataType(item, metadataType);
      files.set(join(dir, `${metadataType}.ts`), valid);
      files.set(join(dir, `${metadataType}.undeclared-key.ts`), valid.replace('= {', '= {\n  "undeclared_key": 1,'));
    }
    const diagnostics = typeCheck(files);
    const byFile = new Map<string, number[]>();
    const unattributed: string[] = [];
    for (const d of diagnostics) {
      if (!d.file) {
        unattributed.push(ts.flattenDiagnosticMessageText(d.messageText, '\n'));
        continue;
      }
      byFile.set(d.file.fileName, [...(byFile.get(d.file.fileName) ?? []), d.code]);
    }
    const report = ts.formatDiagnostics(diagnostics, {
      getCanonicalFileName: (f) => f,
      getCurrentDirectory: () => dir,
      getNewLine: () => '\n',
    });
    expect(unattributed, report).toEqual([]);
    expect([...byFile.keys()].filter((f) => !files.has(f)), report).toEqual([]);
    for (const metadataType of Object.keys(REPRESENTATIVE)) {
      expect(byFile.get(join(dir, `${metadataType}.ts`)) ?? [], report).toEqual([]);
      expect(byFile.get(join(dir, `${metadataType}.undeclared-key.ts`)) ?? [], report).toEqual([2353]);
    }
  }, 60_000);
});
