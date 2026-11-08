// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#30803] One name, one package holder for an agent and a skill — the AI
// family, the series' last (maintainer ruling C on #30798, phase 1; ADR-0048
// §3.4 narrowed, P1.9; `packages/objectql/src/bare-name-one-holder.ts`), on a
// booted showcase. The data, request and flow families' booted pins are
// `bare-name-one-holder.dogfood.test.ts`,
// `bare-name-one-holder-request-family.dogfood.test.ts` and
// `bare-name-one-holder-flow-family.dogfood.test.ts`.
//
// The registry's own pins (`registry-bare-name-one-holder-ai-family.test.ts`)
// drive the engine's package door and the item seam in-process. This file
// drives the rule at the doors a deployment reaches:
//
//   - the cold boot of a deployment that already holds the clash — two
//     `AppPlugin` packages, `alpha` and `beta`, shipping one agent and one
//     skill under the same names — boots, and logs ONE bare-name warning line
//     naming both, both packages and the rename for each; the readers keep
//     serving the first-registered package's item, as before: `/meta/agent/NAME`
//     and the skill an MCP client's `prompts/get` resolves;
//   - `POST /marketplace/install-local` of a third package declaring the held
//     agent name, and of a fourth declaring the held skill name, is 422
//     PLUGIN_REGISTER_FAILED naming both holders and the rename, and installs
//     nothing;
//   - CONTROL: a package declaring fresh agent and skill names installs — and
//     so does its tool under the name both boot packages' tools share: a tool
//     is not covered.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { AppPlugin } from '@objectstack/runtime';
import { MarketplaceInstallLocalPlugin } from '@objectstack/cloud-connection';
import { listSkillPrompts } from '@objectstack/mcp';
import { defineStack } from '@objectstack/spec';
import { PROTOCOL_MAJOR } from '@objectstack/spec/kernel';
import { bootShowcase } from './showcase-boot.js';

const AGENT = 'qa_shared_agent';
const SKILL = 'qa_shared_skill';
const TOOL = 'qa_shared_tool';

const item = (p: string) => ({
  name: `${p}_item`, label: `${p} item`, sharingModel: 'public_read_write',
  fields: { name: { type: 'text', label: 'Name' } },
});
const agent = (p: string, name = AGENT) => ({ name, label: `${p} agent`, role: `${p} role`, instructions: `${p} agent instructions` });
const skill = (p: string, name = SKILL) => ({ name, label: `${p} skill`, description: `${p} skill`, instructions: `${p} skill instructions`, tools: [] });
const tool = (p: string, name = TOOL) => ({ name, label: `${p} tool`, description: `${p} tool`, parameters: { type: 'object', properties: {} } });

/** One of the two packages the cold boot registers, each shipping the shared agent, skill and tool names. */
function bootPackage(p: 'alpha' | 'beta') {
  return defineStack({
    manifest: { id: `com.qa.bare.${p}`, namespace: p, name: `qa_bare_${p}`, version: '1.0.0', type: 'app' },
    objects: [item(p)],
    agents: [agent(p)],
    skills: [skill(p)],
    tools: [tool(p)],
  } as never);
}

/** An inline install-local manifest. */
const inline = (p: string, collections: Record<string, unknown[]>) => ({
  manifest: {
    id: `com.qa.bare.${p}`, namespace: p, name: `qa_bare_${p}`, version: '1.0.0', type: 'app', scope: 'project',
    engines: { protocol: `^${PROTOCOL_MAJOR}` },
    objects: [item(p)],
    ...collections,
  },
});

/** Every line the process writes while `run` is in flight (security-catalog-one-holder-http's instrument). */
async function captureOutput<T>(run: () => Promise<T>): Promise<{ value: T; lines: string[] }> {
  const chunks: string[] = [];
  const stdout = process.stdout.write.bind(process.stdout);
  const stderr = process.stderr.write.bind(process.stderr);
  const warn = console.warn;
  (process.stdout as any).write = (chunk: unknown, ...rest: any[]) => { chunks.push(String(chunk)); return stdout(chunk as any, ...rest); };
  (process.stderr as any).write = (chunk: unknown, ...rest: any[]) => { chunks.push(String(chunk)); return stderr(chunk as any, ...rest); };
  console.warn = (...args: unknown[]) => { chunks.push(`WARN ${args.map(String).join(' ')}\n`); warn(...args); };
  try {
    const value = await run();
    return { value, lines: chunks.join('').split('\n') };
  } finally {
    (process.stdout as any).write = stdout;
    (process.stderr as any).write = stderr;
    console.warn = warn;
  }
}

/** The level of one kernel-logger line (`<ISO time> <LEVEL> <message> …`), or `undefined`. */
function levelOf(line: string): string | undefined {
  return /^(?:\S+Z\s+)?(DEBUG|INFO|WARN|ERROR|FATAL)\b/.exec(line.trim())?.[1];
}

const codeOf = (body: any) =>
  (body?.error && typeof body.error === 'object' ? body.error.code : undefined) ?? body?.code ?? null;

describe('one package holder per agent and skill name, on a booted showcase', () => {
  let stack: VerifyStack;
  let admin: string;
  let storageDir: string;
  let bootLines: string[] = [];

  const packageIds = async () => {
    const r = await stack.apiAs(admin, 'GET', '/packages');
    expect(r.status).toBe(200);
    const body = (await r.json()) as any;
    const rows = (body?.data?.packages ?? body?.packages ?? body?.data ?? body ?? []) as any[];
    return rows.map((p: any) => p?.manifest?.id ?? p?.id ?? p?.packageId).filter(Boolean).sort();
  };

  const installLocal = async (payload: unknown) => {
    const res = await stack.apiAs(admin, 'POST', '/marketplace/install-local', payload);
    return { status: res.status, body: (await res.json()) as any };
  };

  /** The package whose item `GET /meta/TYPE/NAME` serves. */
  const metaPackage = async (type: string, name: string): Promise<string | undefined> => {
    const r = await stack.apiAs(admin, 'GET', `/meta/${type}/${name}`);
    expect(r.status).toBe(200);
    const body = (await r.json()) as any;
    const d = body?.data ?? body;
    return d?._packageId ?? d?.item?._packageId;
  };

  /** The skill an MCP client's `prompts/get` of `name` resolves: the MCP prompt projection over the merged `skill` list. */
  const skillPromptTitle = async (name: string): Promise<string | undefined> => {
    const r = await stack.apiAs(admin, 'GET', '/meta/skill');
    expect(r.status).toBe(200);
    const body = (await r.json()) as any;
    const rows = (body?.data?.items ?? body?.data ?? body?.items ?? []) as unknown[];
    const prompts = await listSkillPrompts({ listSkills: async () => rows });
    return prompts.find((p) => p.name === name)?.title;
  };

  beforeAll(async () => {
    storageDir = mkdtempSync(join(tmpdir(), 'dogfood-bare-name-ai-'));
    const booted = await captureOutput(() => bootShowcase({
      extraPlugins: [
        new AppPlugin(bootPackage('alpha') as never),
        new AppPlugin(bootPackage('beta') as never),
        new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir }),
      ],
    }));
    stack = booted.value;
    bootLines = booted.lines;
    admin = await stack.signIn();
  }, 300_000);

  afterAll(async () => {
    await stack?.stop();
    if (storageDir) rmSync(storageDir, { recursive: true, force: true });
  });

  it('the cold boot of a deployment holding the clash boots, and warns once naming the agent and the skill, both packages and the rename for each', async () => {
    const warnings = bootLines.filter((l) => l.includes('Bare-name conflict at boot'));
    expect(warnings, 'one warning line').toHaveLength(1);
    const line = warnings[0]!;
    expect(levelOf(line)).toBe('WARN');
    expect(line).toContain(`the agent "${AGENT}"`);
    expect(line).toContain(`the skill "${SKILL}"`);
    for (const name of [AGENT, SKILL]) expect(line, `the rename of ${name}`).toContain(`"beta_${name}"`);
    expect(line).toContain('package "com.qa.bare.alpha"');
    expect(line).toContain('package "com.qa.bare.beta"');
    // A tool is not covered: never named.
    expect(line).not.toContain(TOOL);
    expect(await packageIds(), 'both packages booted').toEqual(expect.arrayContaining(['com.qa.bare.alpha', 'com.qa.bare.beta']));
    // Unchanged by the rule: the readers keep serving the first-registered package's item.
    expect(await metaPackage('agent', AGENT)).toBe('com.qa.bare.alpha');
    expect(await metaPackage('skill', SKILL)).toBe('com.qa.bare.alpha');
    expect(await skillPromptTitle(SKILL)).toBe('alpha skill');
  });

  it('install-local of a third package declaring a held agent name is 422 PLUGIN_REGISTER_FAILED naming both holders and the rename; nothing is installed', async () => {
    const before = await packageIds();
    const { status, body } = await installLocal(inline('gamma', { agents: [agent('gamma')] }));
    expect([status, codeOf(body)], JSON.stringify(body)).toEqual([422, 'PLUGIN_REGISTER_FAILED']);
    const message = String(body?.error?.message ?? '');
    expect(message).toContain(`the agent "${AGENT}"`);
    expect(message).toContain('com.qa.bare.alpha');
    expect(message).toContain('com.qa.bare.beta');
    expect(message).toContain(`"gamma_${AGENT}"`);
    expect(await packageIds(), 'the package list is unchanged').toEqual(before);
    expect(await metaPackage('agent', AGENT)).toBe('com.qa.bare.alpha');
  });

  it('install-local of a package declaring a held skill name is refused the same way; the skill prompt is untouched', async () => {
    const before = await packageIds();
    const { status, body } = await installLocal(inline('delta', { skills: [skill('delta')] }));
    expect([status, codeOf(body)], JSON.stringify(body)).toEqual([422, 'PLUGIN_REGISTER_FAILED']);
    const message = String(body?.error?.message ?? '');
    expect(message).toContain(`the skill "${SKILL}"`);
    expect(message).toContain('com.qa.bare.alpha');
    expect(message).toContain('com.qa.bare.beta');
    expect(message).toContain(`"delta_${SKILL}"`);
    expect(await packageIds(), 'the package list is unchanged').toEqual(before);
    expect(await skillPromptTitle(SKILL)).toBe('alpha skill');
  });

  it('CONTROL — install-local of a package declaring fresh agent and skill names, and the shared tool name, installs', async () => {
    const { status, body } = await installLocal(inline('epsilon', {
      agents: [agent('epsilon', 'epsilon_agent')],
      skills: [skill('epsilon', 'epsilon_skill')],
      tools: [tool('epsilon')],
    }));
    expect(status, JSON.stringify(body)).toBeLessThan(300);
    expect(await packageIds()).toContain('com.qa.bare.epsilon');
    expect(await metaPackage('agent', 'epsilon_agent')).toBe('com.qa.bare.epsilon');
    expect(await skillPromptTitle('epsilon_skill')).toBe('epsilon skill');
  });
});
