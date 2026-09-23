import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NodeMetadataManager } from '../node-metadata-manager.js';
import { JSONSerializer } from '../serializers/json-serializer.js';
import { YAMLSerializer } from '../serializers/yaml-serializer.js';
import { TypeScriptSerializer } from '../serializers/typescript-serializer.js';

describe('Serializers', () => {
  describe('JSONSerializer', () => {
    const serializer = new JSONSerializer();

    it('should serialize to JSON', () => {
      const data = { name: 'test', value: 42 };
      const result = serializer.serialize(data);
      expect(result).toContain('"name"');
      expect(result).toContain('"test"');
    });

    it('should deserialize from JSON', () => {
      const json = '{"name":"test","value":42}';
      const result = serializer.deserialize(json);
      expect(result).toEqual({ name: 'test', value: 42 });
    });

    it('should prettify JSON', () => {
      const data = { name: 'test' };
      const result = serializer.serialize(data, { prettify: true, indent: 2 });
      expect(result).toContain('\n');
      expect(result).toContain('  ');
    });

    it('should sort keys', () => {
      const data = { zebra: 1, apple: 2, banana: 3 };
      const result = serializer.serialize(data, { sortKeys: true });
      const keys = Object.keys(JSON.parse(result));
      expect(keys).toEqual(['apple', 'banana', 'zebra']);
    });
  });

  describe('YAMLSerializer', () => {
    const serializer = new YAMLSerializer();

    it('should serialize to YAML', () => {
      const data = { name: 'test', value: 42 };
      const result = serializer.serialize(data);
      expect(result).toContain('name: test');
      expect(result).toContain('value: 42');
    });

    it('should deserialize from YAML', () => {
      const yaml = 'name: test\nvalue: 42';
      const result = serializer.deserialize(yaml);
      expect(result).toEqual({ name: 'test', value: 42 });
    });
  });

  describe('TypeScriptSerializer', () => {
    const serializer = new TypeScriptSerializer('typescript');

    // The saved-view repro: a view used to be annotated `ServiceObject`, which
    // has no top-level `type` or `columns` key, so `tsc` refused the file (TS2353).
    const view = { name: 'all_accounts', type: 'grid', object: 'account', columns: ['name'] };
    const object = { name: 'account', label: 'Account', fields: { name: { type: 'text', label: 'Name' } } };

    it('should serialize to TypeScript module', () => {
      const data = { name: 'test', value: 42 };
      const result = serializer.serialize(data);
      expect(result).toContain('export const metadata');
      expect(result).toContain('export default metadata');
    });

    it('writes a view with no annotation: no ServiceObject, no import type', () => {
      const result = serializer.serialize(view, { metadataType: 'view' });
      expect(result).not.toContain('ServiceObject');
      expect(result).toBe(
        `export const metadata = ${JSON.stringify(view, null, 2)};\n\nexport default metadata;\n`,
      );
    });

    it('still annotates an object ServiceObject, byte-identical to the earlier output', () => {
      const result = serializer.serialize(object, { metadataType: 'object' });
      expect(result).toBe(
        `import type { ServiceObject } from '@objectstack/spec/data';\n\n` +
          `export const metadata: ServiceObject = ${JSON.stringify(object, null, 2)};\n\n` +
          `export default metadata;\n`,
      );
    });

    it.each([
      ['no metadata type', undefined],
      ['a metadata type the spec has no type for', 'external_catalog'],
      ['a metadata type whose spec type is narrower than its schema', 'book'],
      ['a plugin-registered metadata type', 'acme_widget'],
      ['a plural spelling', 'objects'],
    ])('writes no annotation for %s', (_label, metadataType) => {
      const result = serializer.serialize({ name: 'x' }, { metadataType });
      expect(result.startsWith('export const metadata = {')).toBe(true);
      expect(result).not.toContain('import type');
    });

    it('the javascript format never annotates, whatever the metadata type', () => {
      const js = new TypeScriptSerializer('javascript');
      expect(js.serialize(object, { metadataType: 'object' })).toBe(
        `export const metadata = ${JSON.stringify(object, null, 2)};\n\nexport default metadata;\n`,
      );
    });

    it('reads back a file written before this fix: a view annotated ServiceObject', () => {
      const legacy =
        `import type { ServiceObject } from '@objectstack/spec/data';\n\n` +
        `export const metadata: ServiceObject = ${JSON.stringify(view, null, 2)};\n\n` +
        `export default metadata;\n`;
      expect(serializer.deserialize(legacy)).toEqual(view);
    });

    it('round-trips a view and an object through serialize and deserialize', () => {
      for (const [metadataType, item] of [['view', view], ['object', object]] as const) {
        expect(serializer.deserialize(serializer.serialize(item, { metadataType }))).toEqual(item);
      }
    });

    it('FilesystemLoader.save() passes the metadata type: the view file is unannotated, the object file is ServiceObject', async () => {
      const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'objectstack-ts-serializer-'));
      try {
        const manager = new NodeMetadataManager({ rootDir, watch: false });
        await manager.save('view', 'all_accounts', view);
        await manager.save('object', 'account', object);
        const viewFile = await fs.readFile(path.join(rootDir, 'view', 'all_accounts.ts'), 'utf-8');
        const objectFile = await fs.readFile(path.join(rootDir, 'object', 'account.ts'), 'utf-8');
        expect(viewFile).toBe(serializer.serialize(view, { metadataType: 'view' }));
        expect(viewFile).not.toContain('ServiceObject');
        expect(objectFile).toBe(serializer.serialize(object, { metadataType: 'object' }));
        expect(objectFile).toContain('export const metadata: ServiceObject = {');
      } finally {
        await fs.rm(rootDir, { recursive: true, force: true });
      }
    });

    it('should get correct extension', () => {
      const ts = new TypeScriptSerializer('typescript');
      expect(ts.getExtension()).toBe('.ts');

      const js = new TypeScriptSerializer('javascript');
      expect(js.getExtension()).toBe('.js');
    });
  });
});
