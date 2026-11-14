// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ruling 6844187236, B] The user table opts its records into the AI read
 * tools, so a member's agent can find a colleague to fill a person field.
 *
 * What an agent is served is decided by the gates every read runs (row-level
 * security, field security), not by this declaration; those are pinned end to
 * end in `@objectstack/dogfood`'s `colleague-lookup-over-mcp.dogfood.test.ts`.
 * This file pins the declaration and what it leaves closed.
 */

import { describe, expect, it } from 'vitest';
import { isAiReadExposed } from '@objectstack/spec/data';
import { SysUser } from './sys-user.object.js';

describe('[ruling B] sys_user AI read declaration', () => {
  it('declares read-only AI exposure, read through the one reading the MCP bridges ask', () => {
    expect(SysUser.enable?.aiReadable).toBe(true);
    expect(isAiReadExposed(SysUser)).toBe(true);
  });

  it('opens no generic create or delete: the declaration changes no write surface', () => {
    // The one generic write on the table stays the self-service profile edit
    // (ADR-0092 D4); no MCP write tool admits a sys_* object either way.
    expect(SysUser.enable?.apiMethods).toEqual(['get', 'list', 'update', 'bulk']);
  });
});
