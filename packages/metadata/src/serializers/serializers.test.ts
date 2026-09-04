import { describe, it, expect } from 'vitest';
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

    it('should serialize to TypeScript module', () => {
      const data = { name: 'test', value: 42 };
      const result = serializer.serialize(data);
      expect(result).toContain('import type');
      expect(result).toContain('export const metadata');
      expect(result).toContain('export default metadata');
    });

    it('should get correct extension', () => {
      const ts = new TypeScriptSerializer('typescript');
      expect(ts.getExtension()).toBe('.ts');

      const js = new TypeScriptSerializer('javascript');
      expect(js.getExtension()).toBe('.js');
    });
  });
});
