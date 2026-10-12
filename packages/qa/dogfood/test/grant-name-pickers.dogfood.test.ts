// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15204 B2, ADR-0131 D4] The two grant forms pick their name from the
 * security catalog, as SERVED.
 *
 * A grant names its position / permission set, and the catalog (not a
 * `sys_position` / `sys_permission_set` row) is where those names live. The
 * user page's related-list `add` pickers could list object rows only, so they
 * are gone; "New" opens the grant form, and the form's name field carries a
 * widget hint the console resolves to a catalog picker (`field:position-ref`
 * lists `GET /meta/position`, `field:permission-ref` lists
 * `GET /meta/permission`). The legacy `permission_set_id` lookup grants
 * nothing and is hidden from the forms (maintainer ruling, 2026-10-12).
 *
 * Read from `GET /meta/object/<name>` on a booted showcase: what the console
 * actually receives, not the source declaration, so the pin fails if the spec
 * strips the hint or a later layer drops it.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

type ServedField = { widget?: unknown; hidden?: unknown; type?: unknown };

describe('[#15204 B2] grant forms pick names from the catalog', () => {
  let stack: VerifyStack;
  const served: Record<string, Record<string, ServedField>> = {};

  beforeAll(async () => {
    stack = await bootShowcase({});
    const token = await stack.signIn();
    for (const object of ['sys_user_position', 'sys_user_permission_set']) {
      const res = await stack.apiAs(token, 'GET', `/meta/object/${object}`);
      expect(res.status, `GET /meta/object/${object}`).toBe(200);
      const body = (await res.json()) as { item?: { fields?: Record<string, ServedField> } };
      served[object] = body.item?.fields ?? {};
    }
  }, 240_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  it('sys_user_position.position is served with the position picker hint', () => {
    expect(served.sys_user_position?.position?.widget).toBe('position-ref');
  });

  it('sys_user_permission_set.permission_set is served with the permission picker hint', () => {
    expect(served.sys_user_permission_set?.permission_set?.widget).toBe('permission-ref');
  });

  it('permission_set_id is served hidden, and the name field it sits beside is not', () => {
    expect(served.sys_user_permission_set?.permission_set_id?.hidden).toBe(true);
    // Control: the read is not answering `hidden` for every field.
    expect(served.sys_user_permission_set?.permission_set?.hidden).not.toBe(true);
  });
});
