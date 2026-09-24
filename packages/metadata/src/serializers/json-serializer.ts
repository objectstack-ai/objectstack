// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * JSON Metadata Serializer
 * 
 * Handles JSON format serialization and deserialization
 */

import type { z } from 'zod';
import type { MetadataFormat } from '@objectstack/spec/system';
import type { MetadataSerializer, SerializeOptions } from './serializer-interface.js';
import { sortObjectKeys } from './sort-object-keys.js';

export class JSONSerializer implements MetadataSerializer {
  serialize<T>(item: T, options?: SerializeOptions): string {
    const { prettify = true, indent = 2, sortKeys = false } = options || {};

    if (sortKeys) {
      // Sort keys recursively
      const sorted = this.sortObjectKeys(item);
      return prettify
        ? JSON.stringify(sorted, null, indent)
        : JSON.stringify(sorted);
    }

    return prettify
      ? JSON.stringify(item, null, indent)
      : JSON.stringify(item);
  }

  deserialize<T>(content: string, schema?: z.ZodSchema): T {
    const parsed = JSON.parse(content);

    if (schema) {
      return schema.parse(parsed) as T;
    }

    return parsed as T;
  }

  getExtension(): string {
    return '.json';
  }

  canHandle(format: MetadataFormat): boolean {
    return format === 'json';
  }

  getFormat(): MetadataFormat {
    return 'json';
  }

  /**
   * Recursively sort object keys
   *
   * #19872: the shared implementation moved to `./sort-object-keys.js`, so
   * `TypeScriptSerializer` can reuse the exact same sort instead of a second
   * one — this method is now a thin delegate, kept (rather than inlined at
   * the call site) so this class's declared shape, private members included,
   * is unchanged in the package's emitted `.d.ts`.
   */
  private sortObjectKeys(obj: any): any {
    return sortObjectKeys(obj);
  }
}
