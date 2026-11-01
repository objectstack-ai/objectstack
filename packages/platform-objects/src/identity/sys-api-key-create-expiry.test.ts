// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// sys_api_key's Create Key door offers the key's expiry, so the date in the
// list is one the admin saw and could choose — not one that silently appeared.
//
// What this file pins, from source:
//  - `create_api_key` declares exactly `name` (required) and `expires_at`
//    (optional): the two body keys `POST /api/v1/keys` reads, and nothing the
//    route ignores;
//  - `expires_at` carries NO `defaultValue`: a param default is a literal
//    submitted verbatim, so any date written here would override the
//    deployment's Authentication API key policy instead of following it. Left
//    empty, the route applies the policy's default life;
//  - its help text names that policy, so the dialog says what an empty field
//    means and that a later date than the maximum is refused;
//  - the param resolves to a real datetime column on this object;
//  - the reveal shows the expiry the key actually got, beside the key.
//
// The route half — the default applied when the field is empty, and a date
// past the maximum refused `400 API_KEY_EXPIRY_TOO_LONG` with the policy
// named, never clamped — is `packages/runtime/src/api-key-lifecycle.pin.test.ts`.
import { describe, expect, it } from 'vitest';
import { SysApiKey } from './sys-api-key.object.js';
import { templateSlotSource } from '@objectstack/spec/automation';

// [#27948] An action's `description`, each param's `helpText` and each
// `outcomeMessages` entry are `template` slots: the parsed object carries the
// `{ dialect: 'template', source }` envelope, so the copy is read as written
// through the template judge's one reader, `templateSlotSource` (a locale map
// is kept as it is).
function copyAsWritten<T>(declared: T): T {
  const a = declared as Record<string, any> | undefined;
  if (!a) return declared;
  const text = (v: unknown) => templateSlotSource(v) ?? v;
  return {
    ...a,
    ...(a.description !== undefined ? { description: text(a.description) } : {}),
    ...(Array.isArray(a.params)
      ? { params: a.params.map((p: any) => (p && p.helpText !== undefined ? { ...p, helpText: text(p.helpText) } : p)) }
      : {}),
    ...(a.outcomeMessages && typeof a.outcomeMessages === 'object'
      ? { outcomeMessages: Object.fromEntries(Object.entries(a.outcomeMessages).map(([k, v]) => [k, text(v)])) }
      : {}),
  } as T;
}


interface DeclaredParam {
  field?: string;
  name?: string;
  required?: boolean;
  defaultValue?: unknown;
  helpText?: string;
}

const createKey = copyAsWritten((SysApiKey.actions ?? []).find((a) => a.name === 'create_api_key')) as
  | { params?: DeclaredParam[]; resultDialog?: { fields?: Array<{ path: string }> } }
  | undefined;

describe('sys_api_key create_api_key — the expiry is declared on the dialog', () => {
  it('declares exactly the two body keys the mint route reads', () => {
    expect(createKey).toBeDefined();
    const params = createKey!.params ?? [];
    expect(params.map((p) => p.field ?? p.name)).toEqual(['name', 'expires_at']);
    expect(params.find((p) => p.field === 'name')?.required).toBe(true);
    expect(params.find((p) => p.field === 'expires_at')?.required ?? false).toBe(false);
  });

  it('leaves the default to the policy: no literal defaultValue on expires_at', () => {
    const expiry = createKey!.params!.find((p) => p.field === 'expires_at')!;
    expect(expiry.defaultValue).toBeUndefined();
    expect(expiry.helpText).toContain('Default key lifetime');
    expect(expiry.helpText).toContain('Maximum key lifetime');
  });

  it('resolves to a datetime column on this object', () => {
    expect((SysApiKey.fields as Record<string, { type: string }>).expires_at.type).toBe('datetime');
  });

  it('reveals the expiry the key got, beside the key', () => {
    expect(createKey!.resultDialog?.fields?.map((f) => f.path)).toEqual(['key', 'expires_at']);
  });
});
