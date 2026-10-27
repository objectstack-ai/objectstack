// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#26464] The served `SKILL.md` names the host's authoring tools ONLY when the
 * caller's grant admits the family — the same `grantsAuthoringTools` predicate
 * that registers the tools over HTTP — and only when the host handed it a tool
 * to name. Everything else renders the data skill byte-for-byte as before, so
 * an agent is never taught a tool the server would refuse, and a reader of
 * the public skill route sees no authoring section at all.
 */

import { describe, it, expect } from 'vitest';
import {
  MCP_OAUTH_SCOPE_DATA_READ,
  MCP_OAUTH_SCOPE_DATA_WRITE,
  MCP_OAUTH_SCOPE_ACTIONS,
  MCP_OAUTH_SCOPE_METADATA_WRITE,
} from '@objectstack/spec/ai';

import {
  renderSkillMarkdown,
  OBJECTSTACK_SKILL_DESCRIPTION,
  OBJECTSTACK_SKILL_DESCRIPTION_WITH_AUTHORING,
} from './skill-md.js';

const TOOLS = [
  { name: 'create_object', description: 'Create a draft object\n  in this environment,\n  as a draft.' },
  { name: 'verify_build', description: 'Validate the drafts.' },
];
const SECTION = '## Build — authoring tools';

function frontmatterDescription(md: string): string {
  const m = md.match(/^---\n([\s\S]*?)\n---/);
  if (!m) throw new Error('no frontmatter');
  const line = m[1].split('\n').find((l) => l.startsWith('description:'));
  if (!line) throw new Error('no description');
  return line.slice('description:'.length).trim();
}

describe('[#26464] renderSkillMarkdown — the authoring section follows the grant', () => {
  const baseline = renderSkillMarkdown();

  it('renders no authoring section and the data description by default', () => {
    expect(baseline).not.toContain(SECTION);
    expect(baseline).not.toContain(MCP_OAUTH_SCOPE_METADATA_WRITE);
    expect(frontmatterDescription(baseline)).toBe(OBJECTSTACK_SKILL_DESCRIPTION);
  });

  it('a data/actions grant with tools handed in renders the data skill byte-identically', () => {
    const md = renderSkillMarkdown({
      grantedScopes: [MCP_OAUTH_SCOPE_DATA_READ, MCP_OAUTH_SCOPE_DATA_WRITE, MCP_OAUTH_SCOPE_ACTIONS],
      authoringTools: TOOLS,
    });
    expect(md).toBe(baseline);
  });

  it('the undefined grant (API key / session / public skill route) with tools handed in renders the data skill byte-identically', () => {
    expect(renderSkillMarkdown({ authoringTools: TOOLS })).toBe(baseline);
  });

  it('metadata:write with no tool to name renders the data skill byte-identically', () => {
    expect(renderSkillMarkdown({ grantedScopes: [MCP_OAUTH_SCOPE_METADATA_WRITE] })).toBe(baseline);
    expect(renderSkillMarkdown({ grantedScopes: [MCP_OAUTH_SCOPE_METADATA_WRITE], authoringTools: [] })).toBe(baseline);
  });

  it('metadata:write with tools renders the section, names every tool, and switches the description', () => {
    const md = renderSkillMarkdown({
      mcpUrl: 'https://acme.objectos.app/api/v1/mcp',
      grantedScopes: ['openid', MCP_OAUTH_SCOPE_DATA_READ, MCP_OAUTH_SCOPE_METADATA_WRITE],
      authoringTools: TOOLS,
    });
    expect(md).toContain(SECTION);
    expect(md).toContain(`\`${MCP_OAUTH_SCOPE_METADATA_WRITE}\``);
    for (const t of TOOLS) expect(md).toContain(`- **${t.name}** — `);
    // A multi-line description collapses to one bullet line.
    expect(md).toContain('- **create_object** — Create a draft object in this environment, as a draft.');
    // The build loop and the landing posture the ruling fixed: drafts a person publishes.
    expect(md).toContain('create → verify → draft');
    expect(md).toMatch(/drafts/);
    expect(md).toMatch(/publishes the drafts in the UI/);
    // Still bounded by the caller's own metadata permission — the scope is never a bypass.
    expect(md).toMatch(/scope AND your own metadata permissions/);
    expect(frontmatterDescription(md)).toBe(OBJECTSTACK_SKILL_DESCRIPTION_WITH_AUTHORING);
    expect(OBJECTSTACK_SKILL_DESCRIPTION_WITH_AUTHORING.startsWith(OBJECTSTACK_SKILL_DESCRIPTION)).toBe(true);
    expect(OBJECTSTACK_SKILL_DESCRIPTION_WITH_AUTHORING).not.toContain('\n');
  });

  it('the section is placed after the native tools and before the conventions, with the data content untouched', () => {
    const md = renderSkillMarkdown({ grantedScopes: [MCP_OAUTH_SCOPE_METADATA_WRITE], authoringTools: TOOLS });
    const tools = md.indexOf('## Tools');
    const build = md.indexOf(SECTION);
    const conventions = md.indexOf('## Conventions & gotchas');
    expect(tools).toBeGreaterThan(0);
    expect(build).toBeGreaterThan(tools);
    expect(conventions).toBeGreaterThan(build);
    // Removing the section (and the one description change) gives back the baseline.
    const withoutSection = md.replace(md.slice(build, conventions), '').replace(
      OBJECTSTACK_SKILL_DESCRIPTION_WITH_AUTHORING,
      OBJECTSTACK_SKILL_DESCRIPTION,
    );
    expect(withoutSection).toBe(baseline);
  });
});
