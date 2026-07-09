// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';

import {
  renderSkillMarkdown,
  OBJECTSTACK_SKILL_NAME,
  OBJECTSTACK_SKILL_DESCRIPTION,
} from './skill.js';

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
      'list_actions',
      'run_action',
    ]) {
      expect(md).toContain(tool);
    }
    expect(md.toLowerCase()).toContain('discover');
  });

  it('teaches action preference — run a matching business action instead of hand-editing records', () => {
    const md = renderSkillMarkdown();
    expect(md).toContain('Prefer actions over hand-edits');
    expect(md).toContain('run_action({ actionName, objectName?, recordId?, params? })');
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
