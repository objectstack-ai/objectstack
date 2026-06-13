// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { collectDocsFromSrc, lintDocs, collectAndLintDocs, type DocItem } from './collect-docs.js';

let tmp: string;
let configPath: string;
let docsDir: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'os-docs-'));
  configPath = path.join(tmp, 'objectstack.config.ts');
  fs.writeFileSync(configPath, '// stub');
  docsDir = path.join(tmp, 'src', 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const write = (name: string, content: string) => fs.writeFileSync(path.join(docsDir, name), content);

describe('collectDocsFromSrc (ADR-0046 §3.2)', () => {
  it('compiles each flat .md file into a doc item (stem = name)', () => {
    write('crm_index.md', '# CRM Overview\n\nWhat it is.');
    write('crm_lead_guide.md', '---\ntitle: Lead Guide\n---\n\nBody here.');
    const { docs, issues } = collectDocsFromSrc(configPath);
    expect(issues).toHaveLength(0);
    expect(docs.map((d) => d.name).sort()).toEqual(['crm_index', 'crm_lead_guide']);
    const index = docs.find((d) => d.name === 'crm_index')!;
    expect(index.label).toBe('CRM Overview'); // first # heading
    const guide = docs.find((d) => d.name === 'crm_lead_guide')!;
    expect(guide.label).toBe('Lead Guide'); // frontmatter title wins
    expect(guide.content).not.toContain('title:'); // frontmatter stripped
  });

  it('reads optional frontmatter `description:` (and omits it when absent)', () => {
    write('crm_index.md', '---\ntitle: CRM\ndescription: Start here.\n---\n\n# CRM\n\nBody.');
    write('crm_plain.md', '# Plain\n\nNo frontmatter.');
    const { docs, issues } = collectDocsFromSrc(configPath);
    expect(issues).toHaveLength(0);
    const index = docs.find((d) => d.name === 'crm_index')!;
    expect(index.description).toBe('Start here.');
    expect(index.content).not.toContain('description:'); // frontmatter stripped
    const plain = docs.find((d) => d.name === 'crm_plain')!;
    expect(plain.description).toBeUndefined(); // absent → omitted, not ''
  });

  it('errors on subdirectories — flatness is the contract', () => {
    fs.mkdirSync(path.join(docsDir, 'user'));
    write('crm_index.md', '# x');
    const { docs, issues } = collectDocsFromSrc(configPath);
    expect(issues.some((i) => i.rule === 'docs/flat-directory' && i.severity === 'error')).toBe(true);
    expect(docs).toHaveLength(1); // the valid file still collects
  });

  it('errors on non-snake_case filename stems', () => {
    write('Lead-Guide.md', '# x');
    const { docs, issues } = collectDocsFromSrc(configPath);
    expect(issues.some((i) => i.rule === 'docs/filename')).toBe(true);
    expect(docs).toHaveLength(0);
  });

  it('ignores non-markdown files and returns empty when src/docs is absent', () => {
    write('notes.txt', 'not a doc');
    expect(collectDocsFromSrc(configPath).docs).toHaveLength(0);
    fs.rmSync(docsDir, { recursive: true });
    expect(collectDocsFromSrc(configPath).docs).toHaveLength(0);
  });
});

describe('lintDocs (ADR-0046 §3.2–§3.4)', () => {
  const doc = (name: string, content: string): DocItem => ({ name, content });

  it('requires manifest.namespace when docs ship', () => {
    const issues = lintDocs([doc('crm_index', 'x')], undefined);
    expect(issues.some((i) => i.rule === 'docs/namespace-required')).toBe(true);
  });

  it('requires the namespace prefix on every doc name', () => {
    const issues = lintDocs([doc('lead_guide', 'x')], 'crm');
    const hit = issues.find((i) => i.rule === 'docs/namespace-prefix');
    expect(hit?.severity).toBe('error');
    expect(hit?.message).toContain('crm_lead_guide');
  });

  it('rejects duplicate names across inline + collected docs', () => {
    const issues = lintDocs([doc('crm_index', 'a'), doc('crm_index', 'b')], 'crm');
    expect(issues.some((i) => i.rule === 'docs/duplicate-name')).toBe(true);
  });

  it('bans image references (v1 text-only)', () => {
    const issues = lintDocs([doc('crm_index', 'See ![screenshot](https://x/y.png)')], 'crm');
    expect(issues.some((i) => i.rule === 'docs/no-images')).toBe(true);
  });

  it('bans MDX/JSX but tolerates code blocks that mention it', () => {
    expect(
      lintDocs([doc('crm_a', 'Use <Tabs items={x}> here')], 'crm')
        .some((i) => i.rule === 'docs/no-mdx'),
    ).toBe(true);
    expect(
      lintDocs([doc('crm_b', 'Example:\n\n```jsx\n<Tabs items={x} />\n```\n\nplain prose')], 'crm')
        .some((i) => i.rule === 'docs/no-mdx'),
    ).toBe(false);
  });

  it('resolves same-package relative links and flags broken ones', () => {
    const docs = [
      doc('crm_index', 'See the [guide](./crm_lead_guide.md#start) and [missing](./crm_nope.md).'),
      doc('crm_lead_guide', 'Back to [index](crm_index.md).'),
    ];
    const issues = lintDocs(docs, 'crm');
    const broken = issues.filter((i) => i.rule === 'docs/broken-link');
    expect(broken).toHaveLength(1);
    expect(broken[0].message).toContain('crm_nope');
  });

  it('leaves cross-package links (foreign prefix) to publish-time checks', () => {
    const issues = lintDocs([doc('crm_index', 'See [billing](./billing_setup.md).')], 'crm');
    expect(issues.some((i) => i.rule === 'docs/broken-link')).toBe(false);
  });
});

describe('collectAndLintDocs', () => {
  it('merges inline stack docs with collected files and lints the union', () => {
    write('crm_admin_setup.md', '# Admin Setup\n\nSee [index](./crm_index.md).');
    const stack = {
      manifest: { namespace: 'crm' },
      docs: [{ name: 'crm_index', content: '# CRM' }],
    };
    const { docs, issues } = collectAndLintDocs(configPath, stack);
    expect(docs.map((d) => d.name).sort()).toEqual(['crm_admin_setup', 'crm_index']);
    expect(issues).toHaveLength(0);
  });
});
