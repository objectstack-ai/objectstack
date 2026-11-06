// @vitest-environment node
import { describe, it, expect } from 'vitest';

// The canonical renderer, imported from source by relative path: the console
// does not depend on `@objectstack/mcp` (it is not browser-safe), and the
// comparison below is the whole point of this file.
import {
  renderSkillMarkdown,
  OBJECTSTACK_MCP_SERVER_NAME as CANONICAL_MCP_SERVER_NAME,
  OBJECTSTACK_SKILL_DESCRIPTION as CANONICAL_SKILL_DESCRIPTION,
  OBJECTSTACK_SKILL_NAME as CANONICAL_SKILL_NAME,
} from '../../../../../../packages/mcp/src/skill-md';
import {
  renderObjectStackSkill,
  OBJECTSTACK_MCP_SERVER_NAME,
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

/** The tool names the skill's `## Tools` section teaches, in order. */
function toolNames(md: string): string[] {
  const section = md.split('\n## Tools\n')[1]?.split('\n## ')[0] ?? '';
  return [...section.matchAll(/^- \*\*([a-z_]+)\(/gm)].map((m) => m[1]);
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

  it('documents the x-api-key header for headless clients', () => {
    expect(renderObjectStackSkill()).toContain('x-api-key: <YOUR_API_KEY>');
  });

  it('lists every data and action tool and instructs live discovery', () => {
    const md = renderObjectStackSkill();
    expect(toolNames(md)).toEqual([
      'list_objects',
      'describe_object',
      'validate_expression',
      'query_records',
      'get_record',
      'create_record',
      'update_record',
      'delete_record',
      'delete_records',
      'list_actions',
      'run_action',
      'resume_run',
    ]);
    expect(md).toContain('discovered live');
  });

  it('teaches delete_record with confirm: true, which the server requires', () => {
    const md = renderObjectStackSkill();
    expect(md).toContain('**delete_record({ objectName, recordId, confirm })**');
    expect(md).toContain('The server REFUSES a call without `confirm: true`');
    expect(md).not.toContain('delete_record({ objectName, recordId })');
  });

  it('includes the env name when provided', () => {
    expect(renderObjectStackSkill({ envName: 'Acme CRM' })).toContain('**Acme CRM**');
  });
});

// Drift pin: the download must be the SKILL.md the server serves to a caller
// with no OAuth scopes (an API key or a session), byte for byte.
describe('renderObjectStackSkill mirrors renderSkillMarkdown', () => {
  it('shares the canonical identity constants', () => {
    expect(OBJECTSTACK_SKILL_NAME).toBe(CANONICAL_SKILL_NAME);
    expect(OBJECTSTACK_SKILL_DESCRIPTION).toBe(CANONICAL_SKILL_DESCRIPTION);
    expect(OBJECTSTACK_MCP_SERVER_NAME).toBe(CANONICAL_MCP_SERVER_NAME);
  });

  it.each([
    ['no options', {}],
    ['an MCP URL', { mcpUrl: 'https://acme.objectos.app/api/v1/mcp' }],
    ['an env name', { envName: 'Acme CRM' }],
    ['both, padded with whitespace', { mcpUrl: '  https://acme.objectos.app/api/v1/mcp ', envName: ' Acme CRM ' }],
    ['blank values', { mcpUrl: '   ', envName: '' }],
  ])('renders the canonical text for %s', (_label, options) => {
    expect(renderObjectStackSkill(options)).toBe(renderSkillMarkdown(options));
  });
});
