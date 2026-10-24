/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Retirement pin — `PermissionGuardConfig` (objectui#8024).
 *
 * The type was declared in `../permissions.ts` and published twice — re-exported
 * by this package's root barrel AND by `@object-ui/permissions`'s — while nothing
 * constructed, accepted or read one. The only shipped guard, `PermissionGuard`,
 * reads its own `PermissionGuardProps`, which disagreed with this type on its key
 * names and its `fallback` union and never had a `'redirect'` fallback or a
 * `redirectPath`.
 * objectui#8024 removes the declaration and both re-exports; the retirement note
 * that replaces the declaration names `PermissionGuardProps` as the shape to
 * author against.
 *
 * ## Why this pin is type-level and source-level only
 *
 * Same shape as `mobile-residue-retired-7519.test.ts`, for the same reason:
 * `../permissions.ts` has never had a `zod/` twin, so no mirror ever parsed this
 * shape and there is no parse verdict for the deletion to change. The only
 * channel a consumer of the name ever had was the compiler, and that is the
 * channel pinned: TS2694 through the `import('…')` spelling below.
 *
 * ## How the `@ts-expect-error` lines stay honest
 *
 * Each directive sits on a line whose ONLY possible diagnostic is the missing
 * export: the probe value is used, so no unused-local error can consume the
 * directive, and the literal type-checks cleanly against the declaration that
 * was removed (`permission` was its one required key). Each probe is paired
 * with a LIVE name reached through the identical `import('…')` spelling and no
 * directive, so a broken specifier — which would satisfy the directive for the
 * wrong reason (TS2307) — turns the control red instead. Real enforcement
 * because `tsconfig.test.json` compiles this file under this package's
 * `type-check` script.
 *
 * The second `describe` reads both barrels, the declaring file and the guard
 * component off disk — a source read, not an import, because `@object-ui/types`
 * has zero deps and must not take one on `@object-ui/permissions`. That leg is
 * what keeps the `@object-ui/permissions` barrel honest, which the compiler leg
 * cannot reach from this package, and it carries the control that the shape the
 * retirement note points authors at is still declared and still exported.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(resolve(here, rel), 'utf8');

describe('objectui#8024 — `PermissionGuardConfig` is gone from the compile-time surface', () => {
  it('no longer resolves from the root barrel or from `./permissions`', () => {
    // @ts-expect-error RETIRED (objectui#8024): `@object-ui/types` no longer exports `PermissionGuardConfig`
    const viaBarrel: import('../index.js').PermissionGuardConfig = { permission: 'read' };
    // @ts-expect-error RETIRED (objectui#8024): `./permissions` no longer declares `PermissionGuardConfig`
    const viaModule: import('../permissions.js').PermissionGuardConfig = { permission: 'read' };
    expect(viaBarrel).toEqual(viaModule);
  });

  it('the neighbours it stood beside still resolve through the same spelling (control)', () => {
    // No directive on purpose: if `../index.js` or `../permissions.js` stopped
    // resolving, the directives above would be satisfied by TS2307 for the
    // wrong reason — these lines go red first.
    const viaBarrel: import('../index.js').PermissionContext = {
      user: { id: 'u1', roles: ['admin'] },
      object: 'account',
      action: 'read',
    };
    const viaModule: import('../permissions.js').PermissionContext = viaBarrel;
    expect(viaModule.action).toBe('read');
  });
});

describe('objectui#8024 — `PermissionGuardConfig` is gone from both barrels and the declaring file', () => {
  const typesBarrel = read('../index.ts');
  const permissionsBarrel = read('../../../permissions/src/index.ts');
  const declaring = read('../permissions.ts');
  const guard = read('../../../permissions/src/PermissionGuard.tsx');

  // A re-export block entry: the bare name alone on its line, followed by a
  // comma. The retirement pointers left in both barrels are `//` lines, which
  // this cannot match — the name must start right after the indent.
  const reexport = (name: string): RegExp => new RegExp(`^\\s*${name},\\s*$`, 'm');
  const declaration = (name: string): RegExp => new RegExp(`^export (interface|type) ${name}\\b`, 'm');

  it('`@object-ui/types` root barrel no longer re-exports it (control stays in)', () => {
    expect(typesBarrel).not.toMatch(reexport('PermissionGuardConfig'));
    expect(typesBarrel).toMatch(reexport('PermissionContext'));
  });

  it('`@object-ui/permissions` root barrel no longer re-exports it (control stays in)', () => {
    expect(permissionsBarrel).not.toMatch(reexport('PermissionGuardConfig'));
    expect(permissionsBarrel).toMatch(reexport('PermissionContext'));
  });

  it('`PermissionGuardProps` — the shape the note points at — is still declared and exported (control)', () => {
    expect(guard).toMatch(declaration('PermissionGuardProps'));
    expect(permissionsBarrel).toMatch(
      /^export \{[^}]*\btype PermissionGuardProps\b[^}]*\} from '\.\/PermissionGuard\.js';$/m,
    );
  });

  it('`permissions.ts` no longer declares it, and records why in a `//` note naming the live shape', () => {
    expect(declaring).not.toMatch(declaration('PermissionGuardConfig'));
    expect(declaring).toMatch(declaration('PermissionContext'));
    // A `//` note, so declaration emit strips it and no published `.d.ts`
    // carries a pointer at a declaration that is not there (the objectui#7519
    // form). It must still exist in SOURCE and name the shape to author against.
    const note = declaring.match(/^\/\/ RETIRED \(objectui#8024[\s\S]*?(?=\n(?!\/\/))/m)?.[0] ?? '';
    expect(note).toMatch(/`PermissionGuardConfig`/);
    expect(note).toMatch(/`PermissionGuardProps`/);
  });
});
