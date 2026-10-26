/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { resolvePageVarTokens } from '../resolvePageVarTokens';

const vars = {
  workspaceName: 'Acme',
  seats: 5,
  active: true,
  subdomain: 'acme',
  owner: { id: 'u_1', name: 'Ada' },
  tags: ['a', 'b'],
};

describe('resolvePageVarTokens', () => {
  it('returns the value unchanged when there is no snapshot', () => {
    const input = { a: '{{page.workspaceName}}' };
    expect(resolvePageVarTokens(input, undefined)).toEqual(input);
    expect(resolvePageVarTokens(input, null)).toEqual(input);
  });

  it('replaces a whole-value token with the raw typed value (type-preserving)', () => {
    expect(resolvePageVarTokens('{{page.workspaceName}}', vars)).toBe('Acme');
    expect(resolvePageVarTokens('{{page.seats}}', vars)).toBe(5);
    expect(resolvePageVarTokens('{{page.active}}', vars)).toBe(true);
    expect(resolvePageVarTokens('{{ page.seats }}', vars)).toBe(5); // tolerant of inner spaces
  });

  it('preserves object / array values for whole-value tokens', () => {
    expect(resolvePageVarTokens('{{page.owner}}', vars)).toEqual({ id: 'u_1', name: 'Ada' });
    expect(resolvePageVarTokens('{{page.tags}}', vars)).toEqual(['a', 'b']);
  });

  it('string-interpolates embedded tokens', () => {
    expect(resolvePageVarTokens('/orgs/{{page.subdomain}}/setup', vars)).toBe('/orgs/acme/setup');
    expect(resolvePageVarTokens('{{page.workspaceName}} ({{page.seats}})', vars)).toBe('Acme (5)');
  });

  it('resolves dotted paths into object variables', () => {
    expect(resolvePageVarTokens('{{page.owner.name}}', vars)).toBe('Ada');
    expect(resolvePageVarTokens('owner: {{page.owner.id}}', vars)).toBe('owner: u_1');
  });

  it('resolves a missing whole-value token to an empty string and drops missing embedded tokens', () => {
    expect(resolvePageVarTokens('{{page.nope}}', vars)).toBe('');
    expect(resolvePageVarTokens('x={{page.nope}}', vars)).toBe('x=');
  });

  it('walks nested objects and arrays', () => {
    const input = {
      workspace_name: '{{page.workspaceName}}',
      seats: '{{page.seats}}',
      nested: { slug: '{{page.subdomain}}', list: ['{{page.workspaceName}}', 'static'] },
      untouched: 7,
    };
    expect(resolvePageVarTokens(input, vars)).toEqual({
      workspace_name: 'Acme',
      seats: 5,
      nested: { slug: 'acme', list: ['Acme', 'static'] },
      untouched: 7,
    });
  });

  it('leaves non-token strings and non-string leaves untouched', () => {
    expect(resolvePageVarTokens('plain', vars)).toBe('plain');
    expect(resolvePageVarTokens('{single}', vars)).toBe('{single}'); // not a {{page}} token
    expect(resolvePageVarTokens(42, vars)).toBe(42);
    expect(resolvePageVarTokens(null, vars)).toBe(null);
  });

  it('does not mutate the input object', () => {
    const input = { a: '{{page.workspaceName}}' };
    const out = resolvePageVarTokens(input, vars);
    expect(input.a).toBe('{{page.workspaceName}}');
    expect(out).not.toBe(input);
  });
});
