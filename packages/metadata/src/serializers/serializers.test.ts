import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NodeMetadataManager } from '../node-metadata-manager.js';
import { JSONSerializer } from '../serializers/json-serializer.js';
import { YAMLSerializer } from '../serializers/yaml-serializer.js';
import { TypeScriptSerializer, serializeTypeScriptForMetadataType } from '../serializers/typescript-serializer.js';
import type { MetadataFormat } from '@objectstack/spec/system';
import type { MetadataSerializer } from '../serializers/serializer-interface.js';
import { FilesystemLoader } from '../loaders/filesystem-loader.js';

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
    const plain = (item: unknown) =>
      `export const metadata = ${JSON.stringify(item, null, 2)};\n\nexport default metadata;\n`;
    // Exactly what `FilesystemLoader.save('object', …)` wrote before this fix, and still writes.
    const annotatedObject =
      `import type { ServiceObject } from '@objectstack/spec/data';\n\n` +
      `export const metadata: ServiceObject = ${JSON.stringify(object, null, 2)};\n\n` +
      `export default metadata;\n`;

    it('should serialize to TypeScript module', () => {
      const data = { name: 'test', value: 42 };
      const result = serializer.serialize(data);
      expect(result).toContain('export const metadata');
      expect(result).toContain('export default metadata');
    });

    it('the public serialize() writes no annotation, even for an object: it does not know the metadata type', () => {
      expect(serializer.serialize(object)).toBe(plain(object));
      expect(serializer.serialize(view)).toBe(plain(view));
    });

    it('writes a view with no annotation: no ServiceObject, no import type', () => {
      const result = serializeTypeScriptForMetadataType(view, 'view');
      expect(result).not.toContain('ServiceObject');
      expect(result).toBe(plain(view));
    });

    it('still annotates an object ServiceObject, byte-identical to the earlier output', () => {
      expect(serializeTypeScriptForMetadataType(object, 'object')).toBe(annotatedObject);
    });

    it.each([
      ['a metadata type the spec has no type for', 'external_catalog'],
      ['a metadata type whose spec type is narrower than its schema', 'book'],
      ['a plugin-registered metadata type', 'acme_widget'],
      ['a plural spelling', 'objects'],
    ])('writes no annotation for %s', (_label, metadataType) => {
      expect(serializeTypeScriptForMetadataType({ name: 'x' }, metadataType)).toBe(plain({ name: 'x' }));
    });

    it('the javascript format never annotates', () => {
      expect(new TypeScriptSerializer('javascript').serialize(object)).toBe(plain(object));
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
        expect(serializer.deserialize(serializeTypeScriptForMetadataType(item, metadataType))).toEqual(item);
        expect(serializer.deserialize(serializer.serialize(item))).toEqual(item);
      }
    });

    it('FilesystemLoader.save() annotates by metadata type: the view file is unannotated, the object file is ServiceObject', async () => {
      const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'objectstack-ts-serializer-'));
      try {
        const manager = new NodeMetadataManager({ rootDir, watch: false });
        await manager.save('view', 'all_accounts', view);
        await manager.save('object', 'account', object);
        const viewFile = await fs.readFile(path.join(rootDir, 'view', 'all_accounts.ts'), 'utf-8');
        const objectFile = await fs.readFile(path.join(rootDir, 'object', 'account.ts'), 'utf-8');
        expect(viewFile).not.toContain('ServiceObject');
        expect(viewFile).toBe(plain(view));
        expect(objectFile).toBe(annotatedObject);
      } finally {
        await fs.rm(rootDir, { recursive: true, force: true });
      }
    });

    it('FilesystemLoader.save() calls a custom serializer registered for typescript as it always did', async () => {
      const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'objectstack-ts-serializer-custom-'));
      try {
        const seen: unknown[] = [];
        const custom: MetadataSerializer = {
          serialize: (item, options) => {
            seen.push(options);
            return `// custom\nexport const metadata = ${JSON.stringify(item)};\n`;
          },
          deserialize: (content) => serializer.deserialize(content),
          getExtension: () => '.ts',
          canHandle: (format) => format === 'typescript',
          getFormat: () => 'typescript',
        };
        const loader = new FilesystemLoader(rootDir, new Map<MetadataFormat, MetadataSerializer>([['typescript', custom]]));
        await loader.save('object', 'account', object);
        const file = await fs.readFile(path.join(rootDir, 'object', 'account.ts'), 'utf-8');
        expect(file).toBe(`// custom\nexport const metadata = ${JSON.stringify(object)};\n`);
        expect(seen).toEqual([{ prettify: true, indent: 2, sortKeys: false }]);
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
