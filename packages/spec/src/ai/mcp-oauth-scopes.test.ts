// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#26464] The MCP OAuth scope vocabulary, with `metadata:write` beside the
 * three tool-family scopes, and the consent copy declared with it.
 *
 * Three facts pinned here, each read by a different consumer:
 *   1. `MCP_OAUTH_SCOPES` carries the four scopes with the three originals in
 *      their original order — the authorization server advertises this list
 *      verbatim (`scopes_supported`), the runtime's up-front 403 names it, and
 *      a client can request only what is advertised.
 *   2. Every scope has one consent sentence — the consent screen renders the
 *      raw scope string for anything unmapped, and that spelling tells the user
 *      nothing about what they are granting. Keyed by the scope type, so the
 *      compiler holds it too; this pin holds the content.
 *   3. `metadata:write` is a tool-surface grant and NOT a data grant: alone it
 *      maps to the no-object-access floor, and beside a data scope it changes
 *      nothing about the data ceiling. An authoring scope that widened the
 *      data layer would be the bypass the triage line forbids.
 */

import { describe, it, expect } from 'vitest';
import {
  MCP_AGENT_PERMISSION_SET_READ,
  MCP_AGENT_PERMISSION_SET_RESTRICTED,
  MCP_AGENT_PERMISSION_SET_WRITE,
  MCP_OAUTH_SCOPE_ACTIONS,
  MCP_OAUTH_SCOPE_CONSENT_COPY,
  MCP_OAUTH_SCOPE_DATA_READ,
  MCP_OAUTH_SCOPE_DATA_WRITE,
  MCP_OAUTH_SCOPE_METADATA_WRITE,
  MCP_OAUTH_SCOPES,
  scopesToAgentPermissionSets,
} from './mcp.zod';

describe('[#26464] MCP OAuth scopes — metadata:write', () => {
  it('is spelled metadata:write and advertised after the three tool-family scopes, which keep their order', () => {
    expect(MCP_OAUTH_SCOPE_METADATA_WRITE).toBe('metadata:write');
    expect([...MCP_OAUTH_SCOPES]).toEqual([
      MCP_OAUTH_SCOPE_DATA_READ,
      MCP_OAUTH_SCOPE_DATA_WRITE,
      MCP_OAUTH_SCOPE_ACTIONS,
      MCP_OAUTH_SCOPE_METADATA_WRITE,
    ]);
    expect([...MCP_OAUTH_SCOPES].slice(0, 3)).toEqual(['data:read', 'data:write', 'actions:execute']);
  });

  it('every advertised scope has exactly one consent sentence, and no sentence is for a scope that is not advertised', () => {
    expect(Object.keys(MCP_OAUTH_SCOPE_CONSENT_COPY).sort()).toEqual([...MCP_OAUTH_SCOPES].sort());
    for (const scope of MCP_OAUTH_SCOPES) {
      const copy = MCP_OAUTH_SCOPE_CONSENT_COPY[scope];
      expect(copy.trim().length, scope).toBeGreaterThan(0);
      expect(copy, scope).not.toContain('\n');
      // Each sentence carries the bound the server enforces.
      expect(copy, scope).toMatch(/within your own permissions/);
      // Runtime strings carry no tracker number.
      expect(copy, scope).not.toMatch(/#\d+/);
    }
    // The authoring sentence states the landing posture the ruling fixed: drafts a person publishes.
    expect(MCP_OAUTH_SCOPE_CONSENT_COPY[MCP_OAUTH_SCOPE_METADATA_WRITE]).toMatch(/drafts/);
    expect(MCP_OAUTH_SCOPE_CONSENT_COPY[MCP_OAUTH_SCOPE_METADATA_WRITE]).toMatch(/publishes/);
  });

  it('the three original sentences are the ones the Console consent page already renders', () => {
    expect(MCP_OAUTH_SCOPE_CONSENT_COPY[MCP_OAUTH_SCOPE_DATA_READ]).toBe('Read records, within your own permissions');
    expect(MCP_OAUTH_SCOPE_CONSENT_COPY[MCP_OAUTH_SCOPE_DATA_WRITE]).toBe(
      'Create, change and delete records, within your own permissions',
    );
    expect(MCP_OAUTH_SCOPE_CONSENT_COPY[MCP_OAUTH_SCOPE_ACTIONS]).toBe('Run actions on your behalf, within your own permissions');
  });

  it('is a tool-surface grant, not a data grant: alone it maps to the no-object-access floor', () => {
    expect(scopesToAgentPermissionSets([MCP_OAUTH_SCOPE_METADATA_WRITE])).toEqual([MCP_AGENT_PERMISSION_SET_RESTRICTED]);
    expect(scopesToAgentPermissionSets([MCP_OAUTH_SCOPE_METADATA_WRITE, MCP_OAUTH_SCOPE_ACTIONS])).toEqual([
      MCP_AGENT_PERMISSION_SET_RESTRICTED,
    ]);
  });

  it('beside a data scope it changes nothing about the data ceiling', () => {
    expect(scopesToAgentPermissionSets([MCP_OAUTH_SCOPE_DATA_READ, MCP_OAUTH_SCOPE_METADATA_WRITE])).toEqual([
      MCP_AGENT_PERMISSION_SET_READ,
    ]);
    expect(scopesToAgentPermissionSets([MCP_OAUTH_SCOPE_DATA_WRITE, MCP_OAUTH_SCOPE_METADATA_WRITE])).toEqual([
      MCP_AGENT_PERMISSION_SET_WRITE,
    ]);
    // Control: the pre-existing mapping is untouched.
    expect(scopesToAgentPermissionSets([MCP_OAUTH_SCOPE_DATA_READ])).toEqual([MCP_AGENT_PERMISSION_SET_READ]);
    expect(scopesToAgentPermissionSets([MCP_OAUTH_SCOPE_DATA_WRITE])).toEqual([MCP_AGENT_PERMISSION_SET_WRITE]);
    expect(scopesToAgentPermissionSets([MCP_OAUTH_SCOPE_ACTIONS])).toEqual([MCP_AGENT_PERMISSION_SET_RESTRICTED]);
    expect(scopesToAgentPermissionSets(undefined)).toEqual([MCP_AGENT_PERMISSION_SET_RESTRICTED]);
  });
});
