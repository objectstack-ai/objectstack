// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';

import {
  renderSkillMarkdown,
  OBJECTSTACK_SKILL_NAME,
  OBJECTSTACK_SKILL_DESCRIPTION,
  OBJECTSTACK_MCP_SERVER_NAME,
} from './skill-md.js';
// The Console's "Download skill" mirror, imported from source by relative
// path: the Console cannot import this package (it is not browser-safe), so it
// carries a copy that must stay byte-identical to the render below.
import {
  renderObjectStackSkill,
  OBJECTSTACK_SKILL_NAME as CONSOLE_SKILL_NAME,
  OBJECTSTACK_SKILL_DESCRIPTION as CONSOLE_SKILL_DESCRIPTION,
  OBJECTSTACK_MCP_SERVER_NAME as CONSOLE_MCP_SERVER_NAME,
} from '../../../ui/apps/console/src/pages/developer/objectstack-skill.js';

/** Pull the YAML frontmatter block (between the first two `---` lines). */
function frontmatter(md: string): Record<string, string> {
  const m = md.match(/^---\n([\s\S]*?)\n---/);
  if (!m) throw new Error('no frontmatter');
  const out: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

describe('renderSkillMarkdown', () => {
  it('emits valid SKILL.md frontmatter with name + description', () => {
    const fm = frontmatter(renderSkillMarkdown());
    expect(fm.name).toBe(OBJECTSTACK_SKILL_NAME);
    expect(fm.description).toBe(OBJECTSTACK_SKILL_DESCRIPTION);
  });

  it('slots the env MCP URL into the connect section', () => {
    const md = renderSkillMarkdown({ mcpUrl: 'https://acme.objectos.app/api/v1/mcp' });
    expect(md).toContain('https://acme.objectos.app/api/v1/mcp');
    expect(md).not.toContain('<YOUR_ENV_MCP_URL>');
  });

  it('names the MCP server in its connect command by the one exported constant', () => {
    // `os dev`'s boot banner reads the same constant (packages/cli
    // dev-mcp-connect-hint-origin.test.ts pins that half), so one endpoint is
    // never registered under two names.
    expect(OBJECTSTACK_MCP_SERVER_NAME).toBe('objectstack');
    const md = renderSkillMarkdown({ mcpUrl: 'https://acme.objectos.app/api/v1/mcp' });
    const names = [...md.matchAll(/claude mcp add --transport http (\S+) /g)].map((m) => m[1]);
    expect(names).toEqual([OBJECTSTACK_MCP_SERVER_NAME]);
  });

  it('falls back to a clearly-marked placeholder when no URL is given', () => {
    expect(renderSkillMarkdown()).toContain('<YOUR_ENV_MCP_URL>');
  });

  it('includes the env name in the intro when provided', () => {
    expect(renderSkillMarkdown({ envName: 'Acme CRM' })).toContain('**Acme CRM**');
  });

  it('documents BOTH auth tracks: OAuth (interactive) and x-api-key (headless)', () => {
    const md = renderSkillMarkdown();
    // OAuth is the human-client track (#2698): self-serve, browser login.
    expect(md).toContain('OAuth');
    expect(md).toMatch(/authorization\s+server/);
    // API key stays the headless track, unchanged.
    expect(md).toContain('x-api-key');
    expect(md).toContain('Authorization: ApiKey');
  });

  it('lists the full native tool surface (CRUD + business actions) and a discover-first instruction', () => {
    const md = renderSkillMarkdown();
    for (const tool of [
      'list_objects',
      'describe_object',
      'query_records',
      'get_record',
      'create_record',
      'update_record',
      'delete_record',
      'delete_records',
      'list_actions',
      'run_action',
      'resume_run',
    ]) {
      expect(md).toContain(tool);
    }
    expect(md.toLowerCase()).toContain('discover');
  });

  it('teaches action preference — run a matching business action instead of hand-editing records', () => {
    const md = renderSkillMarkdown();
    expect(md).toContain('Prefer actions over hand-edits');
    expect(md).toContain('run_action({ actionName, objectName?, recordId?, params?, confirm? })');
    // [#15942] The signature owes `confirm`, and the skill owes the sentence
    // that makes it usable: an agent that learns the member exists but not that
    // the server REFUSES without it has learned nothing it can act on.
    expect(md).toContain('ACTION_CONFIRMATION_REQUIRED');
    expect(md).toContain('requiresConfirmation');
  });

  it('is generic — it does not enumerate any concrete schema', () => {
    // The skill must not bake in tenant object/field names; it points to live
    // discovery instead. Sanity: no stray "objectName: <something concrete>".
    const md = renderSkillMarkdown({ mcpUrl: 'https://x.objectos.app/api/v1/mcp' });
    expect(md).toContain('discovered live');
  });

  it('trims whitespace in the provided URL', () => {
    const md = renderSkillMarkdown({ mcpUrl: '  https://x.objectos.app/api/v1/mcp  ' });
    expect(md).toContain('https://x.objectos.app/api/v1/mcp');
    expect(md).not.toContain('  https://');
  });
});

// Drift pin, the server's half: the Console download must be the SKILL.md this
// package serves to a caller with no OAuth scopes (an API key or a session),
// byte for byte. The Console carries the same comparison in
// ui/apps/console/src/pages/developer/objectstack-skill.test.ts, which runs
// only when Test UI does; a diff confined to this package starts Test Core and
// not Test UI, so this half is what runs on it. Every input of the render
// (DELETE_RECORDS_MAX_PER_CALL in mcp-http-tools.ts included) lives in this
// package or upstream of it, so any change to one runs this file.
describe('renderSkillMarkdown is mirrored by the Console download', () => {
  it('shares the identity constants', () => {
    expect(CONSOLE_SKILL_NAME).toBe(OBJECTSTACK_SKILL_NAME);
    expect(CONSOLE_SKILL_DESCRIPTION).toBe(OBJECTSTACK_SKILL_DESCRIPTION);
    expect(CONSOLE_MCP_SERVER_NAME).toBe(OBJECTSTACK_MCP_SERVER_NAME);
  });

  it.each([
    ['no options', {}],
    ['an MCP URL', { mcpUrl: 'https://acme.objectos.app/api/v1/mcp' }],
    ['an env name', { envName: 'Acme CRM' }],
    ['both, padded with whitespace', { mcpUrl: '  https://acme.objectos.app/api/v1/mcp ', envName: ' Acme CRM ' }],
    ['blank values', { mcpUrl: '   ', envName: '' }],
  ])('renders the served text for %s', (_label, options) => {
    expect(renderObjectStackSkill(options)).toBe(renderSkillMarkdown(options));
  });
});
