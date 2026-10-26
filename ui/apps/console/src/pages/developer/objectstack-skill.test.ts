import { describe, it, expect } from 'vitest';

import {
  renderObjectStackSkill,
  OBJECTSTACK_SKILL_NAME,
  OBJECTSTACK_SKILL_DESCRIPTION,
} from './objectstack-skill';

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

describe('renderObjectStackSkill', () => {
  it('emits valid SKILL.md frontmatter (name + description)', () => {
    const fm = frontmatter(renderObjectStackSkill());
    expect(fm.name).toBe(OBJECTSTACK_SKILL_NAME);
    expect(fm.description).toBe(OBJECTSTACK_SKILL_DESCRIPTION);
  });

  it('slots the env MCP URL and drops the placeholder', () => {
    const md = renderObjectStackSkill({ mcpUrl: 'https://acme.objectos.app/api/v1/mcp' });
    expect(md).toContain('https://acme.objectos.app/api/v1/mcp');
    expect(md).not.toContain('<YOUR_ENV_MCP_URL>');
  });

  it('falls back to a placeholder when no URL is given', () => {
    expect(renderObjectStackSkill()).toContain('<YOUR_ENV_MCP_URL>');
  });

  it('documents x-api-key auth, not Bearer', () => {
    const md = renderObjectStackSkill();
    expect(md).toContain('x-api-key');
    expect(md).not.toMatch(/Authorization:\s*Bearer/);
  });

  it('lists all object-CRUD tools and instructs live discovery', () => {
    const md = renderObjectStackSkill();
    for (const t of [
      'list_objects',
      'describe_object',
      'query_records',
      'get_record',
      'create_record',
      'update_record',
      'delete_record',
    ]) {
      expect(md).toContain(t);
    }
    expect(md).toContain('discovered live');
  });

  it('includes the env name when provided', () => {
    expect(renderObjectStackSkill({ envName: 'Acme CRM' })).toContain('**Acme CRM**');
  });
});
