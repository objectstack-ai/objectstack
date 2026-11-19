/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The user import's mapping targets are the import-users endpoint's columns
 * (objectstack#34536).
 *
 * `identityImportFields` is the only list of columns the wizard can map, and a
 * column it does not offer never reaches the request: the wizard sends mapped
 * columns only. `POST /api/v1/auth/admin/import-users`
 * (`@objectstack/plugin-auth`, `admin-import-users.ts`) reads two kinds of
 * column by name:
 *
 *   - the second-pass columns, each declared as one `const <X>_COLUMN = '<name>'`
 *     (`manager_id`, `positions`), read off the row and resolved after every
 *     row lands;
 *   - the `sys_user` columns its create path reads (`data.<name>` inside
 *     `createData`).
 *
 * The console does not depend on that server plugin, so this file reads its
 * source and compares both directions: a column the endpoint gains and the
 * wizard does not offer, and a column the wizard offers and the endpoint does
 * not read, are both red. Each extraction asserts it found its anchor first, so
 * a refactor that moves the reads fails here rather than comparing nothing.
 *
 * Deliberately outside the set: the profile fields an upsert may update on an
 * existing user but the create path does not read (`image`, `locale` in
 * `SYS_USER_IMPORT_UPDATE_FIELDS`), and the phone column's legacy aliases
 * (`phoneNumber`, `phone`), which the endpoint folds into `phone_number`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { identityImportFields } from '../IdentityImportPanels';

const here = path.dirname(fileURLToPath(import.meta.url));
const ENDPOINT_SOURCE = path.resolve(here, '../../../../../../packages/plugins/plugin-auth/src/admin-import-users.ts');

const source = readFileSync(ENDPOINT_SOURCE, 'utf8');

/** `const MANAGER_COLUMN = 'manager_id';` → `manager_id`, one per declaration. */
function declaredColumns(src: string): string[] {
  return [...src.matchAll(/^const [A-Z_]+_COLUMN = '([a-z_]+)';$/gm)].map((m) => m[1]);
}

/** The `data.<name>` reads between `async createData(` and `async updateData(`. */
function createPathColumns(src: string): string[] {
  const start = src.indexOf('async createData(');
  const end = src.indexOf('async updateData(');
  expect(start, 'admin-import-users.ts no longer declares `async createData(`').toBeGreaterThan(-1);
  expect(end, '`async updateData(` must follow `async createData(`').toBeGreaterThan(start);
  return [...new Set([...src.slice(start, end).matchAll(/\bdata\.([a-z_]+)\b/g)].map((m) => m[1]))];
}

describe('identityImportFields: the wizard offers exactly the columns import-users reads (objectstack#34536)', () => {
  const offered = identityImportFields(undefined).map((f) => f.name);

  it('reads the endpoint\'s second-pass columns, manager_id among them', () => {
    const declared = declaredColumns(source);
    expect(declared).toEqual(expect.arrayContaining(['manager_id', 'positions']));
  });

  it('reads the endpoint\'s create-path columns, email among them', () => {
    expect(createPathColumns(source)).toEqual(expect.arrayContaining(['email', 'name']));
  });

  it('offers every column the endpoint reads, and nothing else', () => {
    const accepted = [...new Set([...declaredColumns(source), ...createPathColumns(source)])];
    expect([...offered].sort()).toEqual([...accepted].sort());
  });

  it('offers each column once', () => {
    expect(new Set(offered).size).toBe(offered.length);
  });
});
