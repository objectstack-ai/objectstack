// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * TypeScript/JavaScript Metadata Serializer
 * 
 * Handles TypeScript/JavaScript module format serialization and deserialization
 */

import type { z } from 'zod';
import type { MetadataFormat } from '@objectstack/spec/system';
import type { MetadataSerializer, SerializeOptions } from './serializer-interface.js';

/**
 * The spec type a `typescript`-format file's `metadata` constant is annotated
 * with, per metadata type: `[type name, @objectstack/spec subpath]`.
 *
 * An emitted annotation must never be false. So a metadata type is listed only
 * when the spec exports a type that IS the input type of the schema
 * `getMetadataTypeSchema()` resolves for it (`z.input<typeof XSchema>`, the
 * ADR-0122 authoring name): then any body that metadata type's contract accepts
 * also type-checks. A metadata type that is not listed (a plugin's own type,
 * a misspelling, or one whose spec type is narrower than its schema) gets no
 * annotation and no `import type`, never `any`, `unknown` or another type's
 * shape.
 *
 * Two metadata types are deliberately absent:
 * - `view`: `ViewMetadataSchema` is a `z.preprocess`, so its input type, and
 *   with it `ViewMetadata`, is `unknown`. Annotating with it would check
 *   nothing.
 * - `book`: `Book` is written by hand and lacks the `_packageId` /
 *   `_provenance` protection keys `BookSchema` accepts, so a book the loader
 *   has stamped would fail against it.
 *
 * `typescript-serializer-annotation.test.ts` compiles every entry with `tsc`:
 * a valid body must type-check and an undeclared key must not, so a renamed,
 * moved or widened-to-`unknown` spec type fails there instead of in a saved
 * file.
 */
const ANNOTATION_BY_METADATA_TYPE: ReadonlyMap<string, readonly [typeName: string, subpath: string]> = new Map([
  ['object', ['ServiceObject', 'data']],
  ['field', ['Field', 'data']],
  ['hook', ['Hook', 'data']],
  ['seed', ['Seed', 'data']],
  ['mapping', ['Mapping', 'data']],
  ['datasource', ['Datasource', 'data']],
  ['analytics_cube', ['Cube', 'data']],
  ['page', ['Page', 'ui']],
  ['dashboard', ['Dashboard', 'ui']],
  ['app', ['App', 'ui']],
  ['action', ['Action', 'ui']],
  ['report', ['Report', 'ui']],
  ['dataset', ['Dataset', 'ui']],
  ['flow', ['Flow', 'automation']],
  ['webhook', ['Webhook', 'automation']],
  ['job', ['Job', 'system']],
  ['translation', ['TranslationItem', 'system']],
  ['email_template', ['EmailTemplateDefinition', 'system']],
  ['doc', ['Doc', 'system']],
  ['api', ['ApiEndpoint', 'api']],
  ['permission', ['PermissionSet', 'security']],
  ['sharing_rule', ['SharingRule', 'security']],
  ['capability', ['CapabilityDeclarationInput', 'security']],
  ['position', ['Position', 'identity']],
  ['agent', ['Agent', 'ai']],
  ['tool', ['Tool', 'ai']],
  ['skill', ['Skill', 'ai']],
  ['connector', ['DeclarativeConnectorEntry', 'integration']],
]);

export class TypeScriptSerializer implements MetadataSerializer {
  constructor(private format: 'typescript' | 'javascript' = 'typescript') {}

  serialize<T>(item: T, options?: SerializeOptions): string {
    const { prettify = true, indent = 2, metadataType } = options || {};

    const jsonStr = JSON.stringify(item, null, prettify ? indent : 0);

    const annotation =
      this.format === 'typescript' && metadataType !== undefined
        ? ANNOTATION_BY_METADATA_TYPE.get(metadataType)
        : undefined;
    if (annotation) {
      const [typeName, subpath] = annotation;
      return `import type { ${typeName} } from '@objectstack/spec/${subpath}';\n\n` +
        `export const metadata: ${typeName} = ${jsonStr};\n\n` +
        `export default metadata;\n`;
    }
    return `export const metadata = ${jsonStr};\n\n` +
      `export default metadata;\n`;
  }

  deserialize<T>(content: string, schema?: z.ZodSchema): T {
    // For TypeScript/JavaScript files, we need to extract the exported object
    // Note: This is a simplified parser that works with JSON-like object literals
    // For complex TypeScript with nested objects, consider using a proper TypeScript parser
    
    // Try to find the object literal in various export patterns
    // Pattern 1: export const metadata = {...};
    let objectStart = content.indexOf('export const');
    if (objectStart === -1) {
      // Pattern 2: export default {...};
      objectStart = content.indexOf('export default');
    }
    
    if (objectStart === -1) {
      throw new Error(
        'Could not parse TypeScript/JavaScript module. ' +
        'Expected export pattern: "export const metadata = {...};" or "export default {...};"'
      );
    }

    // Find the first opening brace after the export statement
    const braceStart = content.indexOf('{', objectStart);
    if (braceStart === -1) {
      throw new Error('Could not find object literal in export statement');
    }

    // Find the matching closing brace by counting braces
    // Handle string literals to avoid counting braces inside strings
    let braceCount = 0;
    let braceEnd = -1;
    let inString = false;
    let stringChar = '';
    
    for (let i = braceStart; i < content.length; i++) {
      const char = content[i];
      const prevChar = i > 0 ? content[i - 1] : '';
      
      // Track string literals (simple handling of " and ')
      if ((char === '"' || char === "'") && prevChar !== '\\') {
        if (!inString) {
          inString = true;
          stringChar = char;
        } else if (char === stringChar) {
          inString = false;
          stringChar = '';
        }
      }
      
      // Count braces only when not inside strings
      if (!inString) {
        if (char === '{') braceCount++;
        if (char === '}') {
          braceCount--;
          if (braceCount === 0) {
            braceEnd = i;
            break;
          }
        }
      }
    }

    if (braceEnd === -1) {
      throw new Error('Could not find matching closing brace for object literal');
    }

    // Extract the object literal
    const objectLiteral = content.substring(braceStart, braceEnd + 1);

    try {
      // Parse as JSON
      const parsed = JSON.parse(objectLiteral);

      if (schema) {
        return schema.parse(parsed) as T;
      }

      return parsed as T;
    } catch (error) {
      throw new Error(
        `Failed to parse object literal as JSON: ${error instanceof Error ? error.message : String(error)}. ` +
        'Make sure the TypeScript/JavaScript object uses JSON-compatible syntax (no functions, comments, or trailing commas).'
      );
    }
  }

  getExtension(): string {
    return this.format === 'typescript' ? '.ts' : '.js';
  }

  canHandle(format: MetadataFormat): boolean {
    return format === 'typescript' || format === 'javascript';
  }

  getFormat(): MetadataFormat {
    return this.format;
  }
}
