// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Read one of `--flow-record` / `--flow-input`: a JSON object, or a refusal
 * naming the flag. `undefined` when the flag was not given.
 */
export function parseFlowJsonFlag(flag: string, raw: string | undefined): Record<string, unknown> | undefined {
  if (raw === undefined) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (e) {
    throw new Error(`${flag} takes a JSON object; it did not parse (${(e as Error).message})`);
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${flag} takes a JSON object, such as '{"name":"Acme"}'`);
  }
  return value as Record<string, unknown>;
}
