// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#34686] The data loop `GET /mcp/skill` serves is the published ask-data
 * skill's, byte for byte: one source.
 *
 * The served page renders `ASK_SKILL_DATA_LOOP` (`ask-skill.generated.ts`)
 * under `ASK_SECTION_HEADING`; `scripts/gen-mcp-ask-skill.mjs` writes that
 * module from `skills/objectstack-ask/SKILL.md`. This file reads the skill
 * itself and holds both halves equal to it: the generated module, and the
 * section of the page `renderSkillMarkdown` returns (the render the route
 * serves). A skill edit without a regeneration, or a hand edit of the module,
 * goes red here.
 *
 * The section rides the dataset tools' gate unchanged: only a host whose bridge
 * carries the pair (`datasetTools: true`), and only for a grant that admits
 * `data:read` or names no scopes, as `registerDatasetTools` registers them.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  MCP_OAUTH_SCOPE_DATA_READ,
  MCP_OAUTH_SCOPE_DATA_WRITE,
  MCP_OAUTH_SCOPE_METADATA_WRITE,
} from '@objectstack/spec/ai';

import { ASK_SKILL_DATA_LOOP } from './ask-skill.generated.js';
import { ASK_SECTION_HEADING, renderSkillMarkdown } from './skill-md.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_PATH = resolve(HERE, '../../../skills/objectstack-ask/SKILL.md');

/**
 * The skill's body after its one H1 title line, blank lines at either end
 * dropped: the same rule `scripts/gen-mcp-ask-skill.mjs` states.
 */
function skillDataLoop(): string {
  const lines = readFileSync(SKILL_PATH, 'utf8').replace(/\r\n/g, '\n').split('\n');
  const title = lines.findIndex((line) => line.startsWith('# '));
  expect(title, 'skills/objectstack-ask/SKILL.md has no title line').toBeGreaterThan(0);
  return lines.slice(title + 1).join('\n').replace(/^\n+/, '').replace(/\n+$/, '');
}

const REGENERATE = 'run `node scripts/gen-mcp-ask-skill.mjs` and commit packages/mcp/src/ask-skill.generated.ts';
const CONVENTIONS = '\n## Conventions & gotchas';

/** The text the page serves under the ask heading, up to the next fixed section. */
function servedDataLoop(md: string): string | undefined {
  const start = md.indexOf(`\n${ASK_SECTION_HEADING}\n`);
  if (start === -1) return undefined;
  const end = md.indexOf(CONVENTIONS, start);
  expect(end, 'the ask section is followed by the conventions section').toBeGreaterThan(start);
  return md.slice(start + ASK_SECTION_HEADING.length + 2, end).replace(/^\n+/, '').replace(/\n+$/, '');
}

describe('[#34686] /mcp/skill data loop: the published ask-data skill is its one source', () => {
  it('the generated module equals the skill\'s data loop', () => {
    expect(ASK_SKILL_DATA_LOOP, REGENERATE).toBe(skillDataLoop());
  });

  it('the served section equals the skill\'s data loop, for every grant that is taught the dataset pair', () => {
    const skill = skillDataLoop();
    const renders = [
      renderSkillMarkdown({ datasetTools: true }),
      renderSkillMarkdown({ datasetTools: true, mcpUrl: 'https://acme.example/api/v1/mcp', fileTools: true, newRecordUploadLinks: true }),
      renderSkillMarkdown({ datasetTools: true, grantedScopes: [MCP_OAUTH_SCOPE_DATA_READ] }),
      renderSkillMarkdown({
        datasetTools: true,
        grantedScopes: [MCP_OAUTH_SCOPE_DATA_READ, MCP_OAUTH_SCOPE_METADATA_WRITE],
        authoringTools: [{ name: 'create_object', description: 'Create a draft object.' }],
      }),
    ];
    for (const md of renders) expect(servedDataLoop(md), REGENERATE).toBe(skill);
  });

  it('the gate still drops it: no section without data:read, and none where the host carries no dataset pair', () => {
    const skill = skillDataLoop();
    const firstStep = skill.split('\n').find((line) => line.startsWith('## '));
    expect(firstStep).toBeDefined();
    const dropped = [
      renderSkillMarkdown({ datasetTools: true, grantedScopes: [MCP_OAUTH_SCOPE_DATA_WRITE] }),
      renderSkillMarkdown({ datasetTools: true, grantedScopes: [MCP_OAUTH_SCOPE_METADATA_WRITE] }),
      renderSkillMarkdown({ datasetTools: true, grantedScopes: [] }),
      renderSkillMarkdown({}),
      renderSkillMarkdown({ datasetTools: false, grantedScopes: [MCP_OAUTH_SCOPE_DATA_READ] }),
    ];
    for (const md of dropped) {
      expect(servedDataLoop(md)).toBeUndefined();
      expect(md).not.toContain(firstStep!);
      expect(md).not.toContain('list_datasets');
    }
  });
});
