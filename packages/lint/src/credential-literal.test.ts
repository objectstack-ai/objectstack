// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ONE credential-shape predicate, judged pair by pair.
 *
 * Every value below is a probe sentinel, not a credential. The names are the
 * rule's own arms (R1 name, R2 value) and the controls that must stay silent
 * (a `{…}` template, an ordinary value, a non-string, a blank). The pin set a
 * whole flow draws is in `lint-flow-credential-literals.test.ts`.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { isCredentialShapedLiteral } from './credential-literal.js';
import * as barrel from './index.js';

const SRC = dirname(fileURLToPath(import.meta.url));

describe('isCredentialShapedLiteral — R1, the name', () => {
  it.each([
    'Authorization',
    'authorization',
    'Proxy-Authorization',
    'Cookie',
    'X-Api-Key',
    'x-api-key',
    'api_key',
    'apiKey',
    'X-ApiKey',
    'X-Auth-Token',
    'access_token',
    'accessKey',
    'private_key',
    'clientSecret',
    'client_secret',
    'password',
    'db_passwd',
    'credentials',
    'X-Session-Id',
    'jwt',
  ])('a literal under %s draws', (name) => {
    expect(isCredentialShapedLiteral(name, 'sentinel-value')).toBe(true);
  });

  it.each(['X-Trace-Label', 'Content-Type', 'Accept', 'method', 'path', 'OAuthScope', 'author', 'keyboard'])(
    'a literal under %s is not a credential by its name',
    (name) => {
      expect(isCredentialShapedLiteral(name, 'sentinel-value')).toBe(false);
    },
  );
});

describe('isCredentialShapedLiteral — R2, the value', () => {
  it.each(['Bearer sentinel', 'bearer sentinel', 'Basic sentinel', 'Token sentinel', 'Digest sentinel', 'ApiKey sentinel', '  Bearer sentinel'])(
    'an auth-scheme value %j draws under any name',
    (value) => {
      expect(isCredentialShapedLiteral('X-Custom', value)).toBe(true);
    },
  );

  it.each(['Bearer', 'Bearer ', 'Bearerish sentinel', 'basically fine', 'token'])(
    'a value %j without a scheme-and-credential does not draw under a plain name',
    (value) => {
      expect(isCredentialShapedLiteral('X-Custom', value)).toBe(false);
    },
  );
});

describe('isCredentialShapedLiteral — what is NOT a literal credential', () => {
  it('a `{…}` template is resolved per run, so it is not a literal — whichever arm would match', () => {
    expect(isCredentialShapedLiteral('Authorization', 'Bearer {api_token}')).toBe(false);
    expect(isCredentialShapedLiteral('X-Auth-Token', '{run_token}')).toBe(false);
    expect(isCredentialShapedLiteral('X-Custom', 'Bearer {$User.id}')).toBe(false);
    expect(isCredentialShapedLiteral('api_key', '{api_token}')).toBe(false);
  });

  it('a blank value and a non-string value draw nothing, whatever the name', () => {
    for (const value of ['', '   ', undefined, null, 0, 3600, true, false, ['x'], { v: 'x' }]) {
      expect(isCredentialShapedLiteral('Authorization', value), JSON.stringify(value)).toBe(false);
    }
  });
});

describe('one predicate, one home', () => {
  it('is exported from the package entry', () => {
    expect((barrel as Record<string, unknown>).isCredentialShapedLiteral).toBe(isCredentialShapedLiteral);
  });

  it('its name list lives in credential-literal.ts and in no other source file of this package', () => {
    // Two distinctive members of the list. A second copy of the list anywhere
    // in this package's shipped source — a rule, a helper, a renderer — would
    // carry them too, and a second list is a second rule that drifts. Test
    // files are excluded because they NAME members as inputs (above), which is
    // judging the predicate, not re-implementing it.
    const holders = readdirSync(SRC)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .filter((f) => {
        const text = readFileSync(join(SRC, f), 'utf8');
        return text.includes("'proxy-authorization'") || text.includes("'client-secret'");
      });
    expect(holders).toEqual(['credential-literal.ts']);
  });
});
