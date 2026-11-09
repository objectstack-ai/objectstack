// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#30803] One name, one package holder for an agent and a skill — the AI
// family, the series' last (maintainer ruling C on #30798, phase 1; ADR-0048
// §3.4 narrowed, P1.9; `packages/objectql/src/bare-name-one-holder.ts`) — and
// [#31414] for a tool, which joined after it (P1.10), on a booted showcase. The data, request and flow families' booted pins are
// `bare-name-one-holder.dogfood.test.ts`,
// `bare-name-one-holder-request-family.dogfood.test.ts` and
// `bare-name-one-holder-flow-family.dogfood.test.ts`.
//
// [#31701, ADR-0150 D2/D9, child B] An agent and a skill have since narrowed
// to the namespace: two packages of two namespaces may each hold the name.
// A tool has not.
//
// The registry's own pins (`registry-bare-name-one-holder-ai-family.test.ts`)
// drive the engine's package door and the item seam in-process. This file
// drives the rule at the doors a deployment reaches:
//
//   - the cold boot of a deployment where two `AppPlugin` packages of two
//     namespaces, `alpha` and `beta`, ship one agent, one skill and one tool
//     under the same names boots, and logs ONE bare-name warning line naming
//     the tool alone: the agent and the skill are no clash between two
//     namespaces;
//   - [#31680, ADR-0150 D3] the by-name read that names no package —
//     `/meta/agent/NAME`, `/meta/skill/NAME`, `/meta/tool/NAME` — refuses
//     `409 RESOURCE_CONFLICT` naming both holders; the read that names the
//     package (`?package=`) serves each package's own;
//   - [#31692, ADR-0150 D6] over the live MCP transport, `prompts/get` of the
//     bare skill name is refused naming both faces, each face (`NS-NAME`)
//     serves its own package's skill (`agent_prompt` is the stdio transport's
//     alone: its faces are pinned beside it, in `packages/mcp`);
//   - `POST /marketplace/install-local` of a package of a THIRD namespace
//     declaring the held agent and skill names installs; of a co-owner of
//     `alpha`'s namespace declaring either is 422 PLUGIN_REGISTER_FAILED
//     naming the holder and the rename, as before; of a package declaring the
//     held tool name is the same 422 naming both holders; none installs;
//   - CONTROL: a package declaring fresh agent, skill and tool names installs,
//     and every AI door serves it as before.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { AppPlugin } from '@objectstack/runtime';
import { MarketplaceInstallLocalPlugin } from '@objectstack/cloud-connection';
import { MCPServerPlugin } from '@objectstack/mcp';
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

/**
 * An inline install-local manifest of package `p`, in namespace `ns` (its own
 * by default). A package of another package's namespace is its co-owner: it
 * declares the dependency the namespace gate requires, and its object carries
 * that namespace's prefix.
 */
const inline = (p: string, collections: Record<string, unknown[]>, ns = p) => ({
  manifest: {
    id: `com.qa.bare.${p}`, namespace: ns, name: `qa_bare_${p}`, version: '1.0.0', type: 'app', scope: 'project',
    engines: { protocol: `^${PROTOCOL_MAJOR}` },
    objects: [item(ns === p ? p : `${ns}_${p}`)],
    ...(ns === p ? {} : { dependencies: { [`com.qa.bare.${ns}`]: '^1.0.0' } }),
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

describe('agent and skill names held per namespace, a tool name per deployment, on a booted showcase', () => {
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

  /**
   * [#31680, ADR-0150 D3] The by-name read that names no package, of a name
   * several packages hold: refused `409 RESOURCE_CONFLICT`, naming each holder.
   */
  const expectMetaRefused = async (type: string, name: string, holders = ['com.qa.bare.alpha', 'com.qa.bare.beta']) => {
    const r = await stack.apiAs(admin, 'GET', `/meta/${type}/${name}`);
    const body = (await r.json()) as any;
    expect([r.status, codeOf(body)], JSON.stringify(body)).toEqual([409, 'RESOURCE_CONFLICT']);
    // The meta door's error envelope: `{ error: <sentence>, code }`.
    const message = String(typeof body?.error === 'string' ? body.error : body?.error?.message ?? body?.message ?? '');
    for (const holder of holders) expect(message).toContain(holder);
  };

  /** The item `GET /meta/TYPE/NAME?package=PKG` serves: its package and its label. */
  const metaAt = async (type: string, name: string, pkg: string): Promise<[string | undefined, string | undefined]> => {
    const r = await stack.apiAs(admin, 'GET', `/meta/${type}/${name}?package=${pkg}`);
    expect(r.status).toBe(200);
    const body = (await r.json()) as any;
    const d = body?.data ?? body;
    const it = d?.item ?? d;
    return [it?._packageId, it?.label];
  };

  /** One JSON-RPC call over the live MCP transport. */
  const mcp = async (method: string, params: Record<string, unknown>): Promise<any> => {
    const res = await stack.api('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${admin}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    expect(res.status).toBe(200);
    return res.json();
  };

  /** The text `prompts/get` of `name` answers, or the JSON-RPC error. */
  const getPrompt = async (name: string, args?: Record<string, string>): Promise<{ text?: string; error?: any }> => {
    const rpc = await mcp('prompts/get', { name, ...(args ? { arguments: args } : {}) });
    if (rpc.error) return { error: rpc.error };
    return { text: String(rpc.result?.messages?.[0]?.content?.text ?? '') };
  };

  /** The text `prompts/get` of `name` answers; a JSON-RPC error fails, naming itself. */
  const promptText = async (name: string, args?: Record<string, string>): Promise<string> => {
    const { text, error } = await getPrompt(name, args);
    expect(error, JSON.stringify(error)).toBeUndefined();
    return text ?? '';
  };

  /** The prompt names `prompts/list` advertises. */
  const promptNames = async (): Promise<string[]> => {
    const rpc = await mcp('prompts/list', {});
    expect(rpc.error, JSON.stringify(rpc.error)).toBeUndefined();
    return ((rpc.result?.prompts ?? []) as Array<{ name: string }>).map((p) => p.name);
  };

  beforeAll(async () => {
    storageDir = mkdtempSync(join(tmpdir(), 'dogfood-bare-name-ai-'));
    const booted = await captureOutput(() => bootShowcase({
      extraPlugins: [
        new AppPlugin(bootPackage('alpha') as never),
        new AppPlugin(bootPackage('beta') as never),
        new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir }),
        new MCPServerPlugin(),
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

  it('two namespaces\' packages holding one agent, skill and tool name both boot; the cold boot warns once, naming the tool alone', async () => {
    expect(await packageIds(), 'both packages booted').toEqual(expect.arrayContaining(['com.qa.bare.alpha', 'com.qa.bare.beta']));
    const warnings = bootLines.filter((l) => l.includes('Bare-name conflict at boot'));
    expect(warnings, 'one warning line').toHaveLength(1);
    const line = warnings[0]!;
    expect(levelOf(line)).toBe('WARN');
    expect(line).toContain(`the tool "${TOOL}"`);
    expect(line).toContain(`"beta_${TOOL}"`);
    expect(line).toContain('package "com.qa.bare.alpha"');
    expect(line).toContain('package "com.qa.bare.beta"');
    // [#31701] Two namespaces' agents and skills are no clash.
    expect(line).not.toContain(`the agent "${AGENT}"`);
    expect(line).not.toContain(`the skill "${SKILL}"`);
  });

  it('the bare by-name read refuses 409 naming both holders; `?package=` serves each package\'s own', async () => {
    for (const [type, name] of [['agent', AGENT], ['skill', SKILL], ['tool', TOOL]] as const) {
      await expectMetaRefused(type, name);
      expect(await metaAt(type, name, 'com.qa.bare.alpha')).toEqual(['com.qa.bare.alpha', `alpha ${type}`]);
      expect(await metaAt(type, name, 'com.qa.bare.beta')).toEqual(['com.qa.bare.beta', `beta ${type}`]);
    }
  });

  it('MCP: each skill is listed under its own face, each face serves its own skill, and the bare name is refused naming both faces', async () => {
    const names = await promptNames();
    expect(names).toEqual(expect.arrayContaining([`alpha-${SKILL}`, `beta-${SKILL}`]));
    expect(await promptText(`alpha-${SKILL}`)).toContain('alpha skill instructions');
    expect(await promptText(`beta-${SKILL}`)).toContain('beta skill instructions');
    const bare = await getPrompt(SKILL);
    expect(bare.text, 'never silently the first package\'s skill').toBeUndefined();
    expect(bare.error?.data?.code, JSON.stringify(bare.error)).toBe('RESOURCE_CONFLICT');
    expect(bare.error?.data?.status).toBe(409);
    expect([...(bare.error?.data?.candidates ?? [])].sort()).toEqual([`alpha-${SKILL}`, `beta-${SKILL}`]);
  });

  it('install-local of a co-owner of `alpha`\'s namespace declaring the held agent or skill name is 422 PLUGIN_REGISTER_FAILED, naming the holder and the rename, as before; nothing is installed', async () => {
    for (const [p, collections, type, name] of [
      ['alphamod', { agents: [agent('alphamod')] }, 'agent', AGENT],
      ['alphaext', { skills: [skill('alphaext')] }, 'skill', SKILL],
    ] as const) {
      const before = await packageIds();
      const { status, body } = await installLocal(inline(p, collections as never, 'alpha'));
      expect([status, codeOf(body)], JSON.stringify(body)).toEqual([422, 'PLUGIN_REGISTER_FAILED']);
      const message = String(body?.error?.message ?? '');
      expect(message).toContain('Bare-name conflict');
      expect(message).toContain(`the ${type} "${name}", already held by package "com.qa.bare.alpha"`);
      expect(message).toContain(`"alpha_${name}"`);
      expect(message).not.toContain('com.qa.bare.beta');
      expect(await packageIds(), 'the package list is unchanged').toEqual(before);
    }
    expect(await metaAt('agent', AGENT, 'com.qa.bare.alpha')).toEqual(['com.qa.bare.alpha', 'alpha agent']);
  });

  it('install-local of a package declaring the held tool name is 422 PLUGIN_REGISTER_FAILED naming both holders and the rename; nothing is installed', async () => {
    const before = await packageIds();
    const { status, body } = await installLocal(inline('zeta', { tools: [tool('zeta')] }));
    expect([status, codeOf(body)], JSON.stringify(body)).toEqual([422, 'PLUGIN_REGISTER_FAILED']);
    const message = String(body?.error?.message ?? '');
    expect(message).toContain(`the tool "${TOOL}"`);
    expect(message).toContain('com.qa.bare.alpha');
    expect(message).toContain('com.qa.bare.beta');
    expect(message).toContain(`"zeta_${TOOL}"`);
    expect(await packageIds(), 'the package list is unchanged').toEqual(before);
    await expectMetaRefused('tool', TOOL);
  });

  it('CONTROL — install-local of a package declaring fresh agent, skill and tool names installs, and every AI door serves it', async () => {
    const { status, body } = await installLocal(inline('epsilon', {
      agents: [agent('epsilon', 'epsilon_agent')],
      skills: [skill('epsilon', 'epsilon_skill')],
      tools: [tool('epsilon', 'epsilon_tool')],
    }));
    expect(status, JSON.stringify(body)).toBeLessThan(300);
    expect(await packageIds()).toContain('com.qa.bare.epsilon');
    expect(await metaPackage('agent', 'epsilon_agent')).toBe('com.qa.bare.epsilon');
    expect(await metaPackage('skill', 'epsilon_skill')).toBe('com.qa.bare.epsilon');
    expect(await metaPackage('tool', 'epsilon_tool')).toBe('com.qa.bare.epsilon');
    expect(await promptText('epsilon-epsilon_skill')).toContain('epsilon skill instructions');
    expect(await promptText('epsilon_skill'), 'one holder: the bare name still answers').toContain('epsilon skill instructions');
  });

  it('[#31701] install-local of a package of a THIRD namespace declaring the held agent and skill names installs; the bare read then names all three holders', async () => {
    const { status, body } = await installLocal(inline('gamma', { agents: [agent('gamma')], skills: [skill('gamma')] }));
    expect(status, JSON.stringify(body)).toBeLessThan(300);
    expect(await packageIds()).toContain('com.qa.bare.gamma');
    expect(await metaAt('agent', AGENT, 'com.qa.bare.gamma')).toEqual(['com.qa.bare.gamma', 'gamma agent']);
    expect(await metaAt('skill', SKILL, 'com.qa.bare.gamma')).toEqual(['com.qa.bare.gamma', 'gamma skill']);
    const all = ['com.qa.bare.alpha', 'com.qa.bare.beta', 'com.qa.bare.gamma'];
    await expectMetaRefused('agent', AGENT, all);
    await expectMetaRefused('skill', SKILL, all);
    // The first packages' items are unchanged.
    expect(await metaAt('agent', AGENT, 'com.qa.bare.alpha')).toEqual(['com.qa.bare.alpha', 'alpha agent']);
    expect(await promptText(`alpha-${SKILL}`)).toContain('alpha skill instructions');
    expect(await promptText(`gamma-${SKILL}`)).toContain('gamma skill instructions');
  });
});
