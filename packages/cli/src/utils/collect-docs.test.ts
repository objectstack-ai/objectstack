// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolveBookTree } from '@objectstack/spec/system';
import { collectDocsFromSrc, lintDocs, collectAndLintDocs, lintMetadataEmbeds, type DocItem } from './collect-docs.js';

// ── ADR-0051: ```metadata embed lint (body shape + reference liveness) ──────
describe('lintMetadataEmbeds (ADR-0051)', () => {
  const FENCE = '```';
  const embed = (body: string) => [`${FENCE}metadata`, body, FENCE].join('\n');
  const STACK = {
    manifest: { namespace: 'crm' },
    objects: [{ name: 'crm_lead', validations: [{ type: 'state_machine', name: 'crm_lead_stage' }] }],
    flows: [{ name: 'crm_onboard' }],
    permissions: [{ name: 'crm_rep' }],
  };
  const lintOne = (content: string) => lintMetadataEmbeds([{ name: 'crm_guide', content } as DocItem], STACK);

  it('passes valid state_machine / flow / permission embeds', () => {
    const content = [
      embed('type: state_machine\nobject: crm_lead\nname: crm_lead_stage'),
      embed('type: flow\nname: crm_onboard'),
      embed('type: permission\nname: crm_rep'),
    ].join('\n\n');
    expect(lintOne(content)).toHaveLength(0);
  });

  it('flags an unknown type with a did-you-mean', () => {
    const issues = lintOne(embed('type: state_machien\nobject: crm_lead\nname: crm_lead_stage'));
    expect(issues).toHaveLength(1);
    expect(issues[0].rule).toBe('docs/metadata-embed');
    expect(issues[0].message).toMatch(/did you mean .?state_machine/);
  });

  it('flags a missing name and a missing object', () => {
    expect(lintOne(embed('type: flow'))[0].message).toMatch(/missing `name`/);
    expect(lintOne(embed('type: state_machine\nname: crm_lead_stage'))[0].message).toMatch(/missing `object`/);
  });

  it('flags a dead object reference with a did-you-mean', () => {
    const issues = lintOne(embed('type: state_machine\nobject: crm_leed\nname: crm_lead_stage'));
    expect(issues[0].rule).toBe('docs/metadata-embed-ref');
    expect(issues[0].message).toMatch(/crm_leed.*did you mean .?crm_lead/);
  });

  it('flags a state_machine rule name absent on a real object', () => {
    const issues = lintOne(embed('type: state_machine\nobject: crm_lead\nname: crm_lead_stge'));
    expect(issues[0].rule).toBe('docs/metadata-embed-ref');
    expect(issues[0].message).toMatch(/did you mean .?crm_lead_stage/);
  });

  it('flags dead flow and permission references', () => {
    expect(lintOne(embed('type: flow\nname: nope'))[0].rule).toBe('docs/metadata-embed-ref');
    expect(lintOne(embed('type: permission\nname: nope'))[0].rule).toBe('docs/metadata-embed-ref');
  });

  it('ignores non-metadata fenced blocks', () => {
    expect(lintOne('```ts\nconst x = 1\n```\n\n```mermaid\nA-->B\n```')).toHaveLength(0);
  });

  it('checks embeds inside locale variants', () => {
    const doc: DocItem = { name: 'crm_guide', content: 'ok', translations: { zh: { content: embed('type: flow\nname: nope') } } };
    const issues = lintMetadataEmbeds([doc], STACK);
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toMatch(/zh/);
  });
});

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

  it('reads frontmatter `order:` as a number and ignores non-numeric values', () => {
    write('crm_a.md', '---\norder: 3\n---\n\n# A');
    write('crm_b.md', '---\norder: not-a-number\n---\n\n# B');
    write('crm_c.md', '---\norder: 0\n---\n\n# C');
    const { docs, issues } = collectDocsFromSrc(configPath);
    expect(issues).toHaveLength(0);
    expect(docs.find((d) => d.name === 'crm_a')!.order).toBe(3); // parsed to number
    expect(docs.find((d) => d.name === 'crm_b')!.order).toBeUndefined(); // NaN → dropped
    expect(docs.find((d) => d.name === 'crm_c')!.order).toBe(0); // zero is a valid order
  });

  it('reads frontmatter `group:` as a string; absent leaves order/group undefined', () => {
    write('crm_grouped.md', '---\ngroup: crm_admin\n---\n\n# Grouped');
    write('crm_bare.md', '# Bare\n\nNo frontmatter.');
    const { docs, issues } = collectDocsFromSrc(configPath);
    expect(issues).toHaveLength(0);
    expect(docs.find((d) => d.name === 'crm_grouped')!.group).toBe('crm_admin');
    const bare = docs.find((d) => d.name === 'crm_bare')!;
    expect(bare.order).toBeUndefined();
    expect(bare.group).toBeUndefined();
  });

  it('reads frontmatter `tags:` in the inline list form', () => {
    write('crm_inline.md', '---\ntitle: Inline\ntags: [tutorial, beginner]\n---\n\n# Inline');
    const { docs, issues } = collectDocsFromSrc(configPath);
    expect(issues).toHaveLength(0);
    const doc = docs.find((d) => d.name === 'crm_inline')!;
    expect(doc.tags).toEqual(['tutorial', 'beginner']);
    expect(doc.content).not.toContain('tags:'); // frontmatter stripped
  });

  it('reads frontmatter `tags:` in the block list form without swallowing the next key', () => {
    write('crm_block.md', '---\ntitle: Block\ntags:\n  - tutorial\n  - advanced\ngroup: crm_admin\n---\n\n# Block');
    const { docs, issues } = collectDocsFromSrc(configPath);
    expect(issues).toHaveLength(0);
    const doc = docs.find((d) => d.name === 'crm_block')!;
    expect(doc.tags).toEqual(['tutorial', 'advanced']);
    expect(doc.group).toBe('crm_admin'); // the sequence ends at the next key
  });

  it('unquotes list items; an authored empty list is no tags and no complaint', () => {
    write('crm_quoted.md', '---\ntags: [\'tutorial\', "deep-dive"]\n---\n\n# Q');
    write('crm_none.md', '---\ntags: []\n---\n\n# N');
    const { docs, issues } = collectDocsFromSrc(configPath);
    expect(issues).toHaveLength(0); // `[]` parses — nothing was dropped
    expect(docs.find((d) => d.name === 'crm_quoted')!.tags).toEqual(['tutorial', 'deep-dive']);
    expect(docs.find((d) => d.name === 'crm_none')!.tags).toBeUndefined();
  });

  // The loud half. A `tags:` spelling this deliberately minimal reader cannot
  // parse must be REPORTED, never dropped — a silent drop is the defect the
  // key exists to fix, and a warning nothing asserts is a warning that can
  // quietly stop firing.
  it.each([
    ['a bare scalar', 'crm_scalar.md', '---\ntags: tutorial\n---\n\n# S', 'tags: tutorial'],
    ['an unterminated inline list', 'crm_open.md', '---\ntags: [tutorial, beginner\n---\n\n# O', 'tags: [tutorial, beginner'],
    ['a key with nothing under it', 'crm_naked.md', '---\ntags:\ndescription: d\n---\n\n# B', 'no list items follow'],
  ])('warns when `tags:` is present but unreadable — %s', (_label, file, content, found) => {
    write(file, content);
    const { docs, issues } = collectDocsFromSrc(configPath);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].rule).toBe('docs/frontmatter-tags');
    expect(issues[0].path).toBe(`src/docs/${file}`);
    expect(issues[0].message).toContain('include: { tag }'); // names the consequence
    expect(issues[0].message).toContain(found); // quotes what it actually found
    expect(docs).toHaveLength(1); // the doc is still collected; only its tags are missing
    expect(docs[0].tags).toBeUndefined();
  });

  it('warns when a locale variant declares `tags:` — tags are doc-level, not per translation', () => {
    write('crm_guide.md', '---\ntags: [tutorial]\n---\n\n# Guide');
    write('crm_guide.zh.md', '---\ntags: [tutorial]\n---\n\n# Zh');
    const { docs, issues } = collectDocsFromSrc(configPath);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].rule).toBe('docs/frontmatter-tags');
    expect(issues[0].path).toBe('src/docs/crm_guide.zh.md');
    expect(issues[0].message).toContain('crm_guide.md'); // points at the base file
    const base = docs.find((d) => d.name === 'crm_guide')!;
    expect(base.tags).toEqual(['tutorial']); // the base doc still carries them
    expect(Object.keys(base.translations ?? {})).toEqual(['zh']); // folding unaffected
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

// The reason the key exists (ADR-0046 §5/§6, #4509): a book group's
// `include: { tag }` must be able to match docs authored on the flat
// `src/docs/*.md` path. Before the reader had a list case, every such group
// resolved to zero entries and the docs fell into *Uncategorized* — with no
// diagnostic on either side saying so.
describe('frontmatter tags reach the book resolver', () => {
  it("lets a group's include: { tag } match docs authored in either list form", () => {
    write('crm_inline.md', '---\ntitle: Inline\ntags: [tutorial, beginner]\n---\n\n# Inline');
    write('crm_block.md', '---\ntitle: Block\ntags:\n  - tutorial\n---\n\n# Block');
    write('crm_reference.md', '---\ntitle: Reference\ntags: [reference]\n---\n\n# Reference');
    const { docs, issues } = collectDocsFromSrc(configPath);
    expect(issues).toHaveLength(0);

    const tree = resolveBookTree(
      { name: 'crm_book', groups: [{ key: 'tutorials', label: 'Tutorials', include: { tag: 'tutorial' } }] },
      docs,
    );
    const tutorials = tree.groups.find((g) => g.key === 'tutorials')!;
    expect(tutorials.entries.map((e) => e.doc).sort()).toEqual(['crm_block', 'crm_inline']);
    // The untagged-by-this-rule doc is not dropped — it lands in Uncategorized.
    const uncategorized = tree.groups.find((g) => g.key === 'uncategorized')!;
    expect(uncategorized.entries.map((e) => e.doc)).toEqual(['crm_reference']);
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

describe('locale variants (ADR-0046 i18n)', () => {
  it('folds `<base>.<locale>.md` into the base doc translations', () => {
    write('crm_index.md', '# Overview\n\nEnglish body.'); // no frontmatter → exact content
    write('crm_index.zh.md', '---\ntitle: 概览\ndescription: 从这里开始。\n---\n\n# 概览\n\n中文正文。');
    write('crm_index.pt-BR.md', '# Visão geral\n\nCorpo PT.');
    const { docs, issues } = collectDocsFromSrc(configPath);
    expect(issues).toHaveLength(0);
    expect(docs).toHaveLength(1); // variants do NOT become separate docs
    const doc = docs[0];
    expect(doc.name).toBe('crm_index');
    expect(doc.content).toBe('# Overview\n\nEnglish body.'); // base = default
    expect(doc.translations?.zh?.label).toBe('概览'); // frontmatter title
    expect(doc.translations?.zh?.description).toBe('从这里开始。');
    expect(doc.translations?.zh?.content).toContain('中文正文。'); // frontmatter stripped
    expect(doc.translations?.zh?.content).not.toContain('title:');
    expect(doc.translations?.['pt-BR']?.content).toBe('# Visão geral\n\nCorpo PT.');
  });

  it('errors on an orphan variant with no base file', () => {
    write('crm_index.zh.md', '# 概览');
    const { docs, issues } = collectDocsFromSrc(configPath);
    expect(docs).toHaveLength(0);
    expect(issues.some((i) => i.rule === 'docs/orphan-translation' && i.severity === 'error')).toBe(true);
  });

  it('applies the v1 MDX/image bans to variant content too', () => {
    write('crm_index.md', '# ok');
    write('crm_index.zh.md', '# 概览\n\n![img](./x.png)');
    const issues = lintDocs(collectDocsFromSrc(configPath).docs, 'crm');
    expect(issues.some((i) => i.rule === 'docs/no-images' && i.path.endsWith('.zh'))).toBe(true);
  });
});
