// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// A change saved in Studio to an item the app ships is an item of the app's
// paired `.custom` package, stored in the environment's database (ADR-0146
// D2) — never in `src/`, so `build` and the Dockerfile leave it behind. The
// scaffold's two docs a developer and their coding agent read first must say
// so, name the command that takes it out (`os package export`), and tell the
// agent to make app changes in `src/`. Both are static files `index.ts`
// copies, so a source-text pin is what covers them.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const templatesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'templates');
const AGENTS_MD = fs.readFileSync(path.join(templatesDir, 'AGENTS.md'), 'utf8');
const README = fs.readFileSync(path.join(templatesDir, 'blank', 'README.md'), 'utf8');

/** The section under the heading that matches `heading`, up to the next heading of that level or higher. */
function section(markdown: string, heading: RegExp, level: number): string {
  const lines = markdown.split('\n');
  const at = lines.findIndex((l) => heading.test(l));
  if (at === -1) return '';
  const stop = new RegExp(`^#{1,${level}} `);
  const end = lines.findIndex((l, i) => i > at && stop.test(l));
  return lines.slice(at, end === -1 ? undefined : end).join('\n');
}

describe.each([
  ['the scaffold AGENTS.md', section(AGENTS_MD, /^## .*Studio/, 2)],
  ['the blank README', section(README, /^### .*Studio/, 3)],
])('%s says a Studio change does not travel with the build', (_doc, text) => {
  it('has the section (vacuity guard)', () => {
    expect(text.length).toBeGreaterThan(200);
  });

  it('says where the change lives and that the build leaves it behind', () => {
    expect(text).toContain('.custom');
    expect(text).toMatch(/database/);
    expect(text).toContain('src/');
    expect(text).toContain('Dockerfile');
  });

  it('names the command that takes it out, and the install on the target', () => {
    expect(text).toContain('os package export');
    expect(text).toContain('os package install');
  });
});

describe('the scaffold AGENTS.md tells the agent where app changes go', () => {
  it('makes app changes in src/, not through Studio', () => {
    const text = section(AGENTS_MD, /^## .*Studio/, 2);
    expect(text).toMatch(/\*\*Make every change to the app in `src\/`\*\*, never through Studio/);
  });
});
