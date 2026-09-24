// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ONE `sortKeys` sort every serializer that honours it as a plain-JSON
 * key sort (not a format-native one, like `js-yaml`'s own `sortKeys` option)
 * shares — `JSONSerializer` and the `typescript`/`javascript` module body
 * `TypeScriptSerializer` wraps. Recursive: every nested object's keys sort
 * too, not just the top level. Arrays keep their element order; only object
 * keys sort. Not published from any `@objectstack/metadata` `exports` entry
 * — an internal helper two in-package serializers share, never a second
 * implementation of the same sort.
 */
export function sortObjectKeys(obj: any): any {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => sortObjectKeys(item));
  }

  const sorted: Record<string, any> = {};
  const keys = Object.keys(obj).sort();

  for (const key of keys) {
    sorted[key] = sortObjectKeys(obj[key]);
  }

  return sorted;
}
