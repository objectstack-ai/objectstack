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
// [#31985] A tool has followed them.
//
// The registry's own pins (`registry-bare-name-one-holder-ai-family.test.ts`)
// drive the engine's package door and the item seam in-process. This file
// drives the rule at the doors a deployment reaches:
//
//   - the cold boot of a deployment where two `AppPlugin` packages of two
//     namespaces, `alpha` and `beta`, ship one agent, one skill and one tool
//     under the same names boots, and logs NO bare-name warning: none of the
//     three is a clash between two namespaces;
//   - [#31680, ADR-0150 D3] the by-name read that names no package —
//     `/meta/agent/NAME`, `/meta/skill/NAME`, `/meta/tool/NAME` — refuses
//     `409 RESOURCE_CONFLICT` naming both holders; the read that names the
//     package (`?package=`) serves each package's own;
//   - [#31692, ADR-0150 D6] over the live MCP transport, `prompts/get` of the
//     bare skill name is refused naming both faces, each face (`NS-NAME`)
//     serves its own package's skill (`agent_prompt` is the stdio transport's
//     alone: its faces are pinned beside it, in `packages/mcp`);
//   - `POST /marketplace/install-local` of a package of a THIRD namespace
//     declaring the held agent, skill and tool names installs; of a co-owner
//     of `alpha`'s namespace declaring any of them is 422
//     PLUGIN_REGISTER_FAILED naming the holder, as before (the agent's and the
//     skill's with the rename; the tool's with the namespace co-owner rule's
//     sentence, which refuses it first), and does not install;
//   - CONTROL: a package declaring fresh agent, skill and tool names installs,
//     and every AI door serves it as before;
//   - [#32151, ADR-0150 D3/D4] on the ARTIFACT door (a second boot of its own,
//     the door `os dev` and `os start` load a compiled artifact through, which
//     registers every package body's items into the metadata service), the
//     metadata service keeps each package's agent, skill and tool ([#31985]),
//     and the layered read `/meta/TYPE/NAME/layers?package=` serves each
//     package's own code layer (it served the package registered last for the
//     agent and the skill; a tool's was already its own, and stays pinned);
//   - [#31985, #32741] a package-less tool row saved before two namespaces'
//     packages install the name is declined at each holder's exact address
//     (a tool is sealed: no environment overlay), both install orders,
//     before and after the read-side hydrator.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { AppPlugin, HttpDispatcher } from '@objectstack/runtime';
import { MarketplaceInstallLocalPlugin } from '@objectstack/cloud-connection';
import { MCPServerPlugin } from '@objectstack/mcp';
import { MetadataPlugin } from '@objectstack/metadata';
import { composeStacks, defineStack } from '@objectstack/spec';
import { PROTOCOL_MAJOR } from '@objectstack/spec/kernel';
import { bootShowcase } from './showcase-boot.js';
import { writeBuildShapedArtifact } from './build-shaped-artifact.js';

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

describe('agent, skill and tool names held per namespace, on a booted showcase', () => {
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

  it('two namespaces\' packages holding one agent, skill and tool name both boot, with no bare-name warning', async () => {
    expect(await packageIds(), 'both packages booted').toEqual(expect.arrayContaining(['com.qa.bare.alpha', 'com.qa.bare.beta']));
    // [#31701, #31985] Two namespaces' agents, skills and tools are no clash.
    // The capture itself is live: it saw the boot's own output.
    expect(bootLines.some((l) => levelOf(l) !== undefined), 'the capture saw the kernel logger').toBe(true);
    expect(bootLines.filter((l) => l.includes('Bare-name conflict at boot'))).toEqual([]);
  });

  it('the bare by-name read refuses 409 naming both holders; `?package=` serves each package\'s own', async () => {
    for (const [type, name] of [['agent', AGENT], ['skill', SKILL], ['tool', TOOL]] as const) {
      await expectMetaRefused(type, name);
      expect(await metaAt(type, name, 'com.qa.bare.alpha')).toEqual(['com.qa.bare.alpha', `alpha ${type}`]);
      expect(await metaAt(type, name, 'com.qa.bare.beta')).toEqual(['com.qa.bare.beta', `beta ${type}`]);
    }
  });

  // [ADR-0150 D5, G1 #31691] The address form of `?package=`, on both
  // transports: the REST route manager over the booted socketless app, and the
  // runtime dispatcher's `/meta` domain over the same booted kernel. Each
  // namespace's address serves its own agent and skill; `_env` serves only an
  // environment item, so for a name only packages hold it is refused naming
  // them; the bare read stays the 409 naming both.
  it('the qualified read `/meta/TYPE/:ns/NAME` serves each namespace\'s own agent, skill and tool, `_env` none, on both transports', async () => {
    const dispatcher = new HttpDispatcher(stack.kernel as never);
    const viaDispatcher = async (path: string) => {
      const answered = await dispatcher.handleMetadata(path, {
        request: {},
        executionContext: { userId: 'u_dogfood_admin', systemPermissions: ['manage_metadata'] },
      } as never, 'GET');
      const response = answered?.response as { status?: number; body?: any } | undefined;
      return { status: response?.status, body: response?.body };
    };
    const viaRest = async (path: string) => {
      const r = await stack.apiAs(admin, 'GET', `/meta${path}`);
      return { status: r.status, body: (await r.json()) as any };
    };
    const itemOf = (body: any) => { const d = body?.data ?? body; return d?.item ?? d; };
    const messageOf = (body: any) => String(typeof body?.error === 'string' ? body.error : body?.error?.message ?? body?.message ?? '');
    for (const [transport, read] of [['rest', viaRest], ['dispatcher', viaDispatcher]] as const) {
      for (const [type, name] of [['agent', AGENT], ['skill', SKILL], ['tool', TOOL]] as const) {
        for (const ns of ['alpha', 'beta'] as const) {
          const answer = await read(`/${type}/${ns}/${name}`);
          expect([transport, type, ns, answer.status], JSON.stringify(answer.body)).toEqual([transport, type, ns, 200]);
          expect([itemOf(answer.body)?._packageId, itemOf(answer.body)?.label]).toEqual([`com.qa.bare.${ns}`, `${ns} ${type}`]);
        }
        for (const path of [`/${type}/_env/${name}`, `/${type}/${name}`]) {
          const refused = await read(path);
          expect([transport, path, refused.status], JSON.stringify(refused.body)).toEqual([transport, path, 409]);
          for (const holder of ['com.qa.bare.alpha', 'com.qa.bare.beta']) expect(messageOf(refused.body)).toContain(holder);
        }
      }
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

  // [#31985] A tool is also the namespace co-owner rule's type (child N), which
  // refuses a co-owner's tool ahead of the bare-name rule, with its own sentence.
  it('install-local of a co-owner of `alpha`\'s namespace declaring the held tool name is 422 PLUGIN_REGISTER_FAILED naming the namespace\'s holder, as before; nothing is installed', async () => {
    const before = await packageIds();
    const { status, body } = await installLocal(inline('alphatool', { tools: [tool('alphatool')] }, 'alpha'));
    expect([status, codeOf(body)], JSON.stringify(body)).toEqual([422, 'PLUGIN_REGISTER_FAILED']);
    const message = String(body?.error?.message ?? '');
    expect(message).toContain('Namespace name conflict');
    expect(message).toContain(`the tool "${TOOL}" in namespace "alpha", already held there by package "com.qa.bare.alpha"`);
    expect(message).not.toContain('com.qa.bare.beta');
    expect(await packageIds(), 'the package list is unchanged').toEqual(before);
    expect(await metaAt('tool', TOOL, 'com.qa.bare.alpha')).toEqual(['com.qa.bare.alpha', 'alpha tool']);
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

  it('[#31701, #31985] install-local of a package of a THIRD namespace declaring the held agent, skill and tool names installs; the bare read then names all three holders', async () => {
    const { status, body } = await installLocal(inline('gamma', { agents: [agent('gamma')], skills: [skill('gamma')], tools: [tool('gamma')] }));
    expect(status, JSON.stringify(body)).toBeLessThan(300);
    expect(await packageIds()).toContain('com.qa.bare.gamma');
    expect(await metaAt('agent', AGENT, 'com.qa.bare.gamma')).toEqual(['com.qa.bare.gamma', 'gamma agent']);
    expect(await metaAt('skill', SKILL, 'com.qa.bare.gamma')).toEqual(['com.qa.bare.gamma', 'gamma skill']);
    expect(await metaAt('tool', TOOL, 'com.qa.bare.gamma')).toEqual(['com.qa.bare.gamma', 'gamma tool']);
    const all = ['com.qa.bare.alpha', 'com.qa.bare.beta', 'com.qa.bare.gamma'];
    await expectMetaRefused('agent', AGENT, all);
    await expectMetaRefused('skill', SKILL, all);
    await expectMetaRefused('tool', TOOL, all);
    expect(await metaAt('tool', TOOL, 'com.qa.bare.alpha')).toEqual(['com.qa.bare.alpha', 'alpha tool']);
    // The first packages' items are unchanged.
    expect(await metaAt('agent', AGENT, 'com.qa.bare.alpha')).toEqual(['com.qa.bare.alpha', 'alpha agent']);
    expect(await promptText(`alpha-${SKILL}`)).toContain('alpha skill instructions');
    expect(await promptText(`gamma-${SKILL}`)).toContain('gamma skill instructions');
  });

  /**
   * [#31985, epic ruling 3 on 6840825374; #32741's sealed-type rule, epic
   * ruling 6817768147] A `tool` is a sealed managed type (no environment
   * overlay), so a package-less row saved under a name two namespaces' packages
   * then install is declined at each holder's exact address: each serves its
   * own item, plain and layered (`overlay: null`), before and after the
   * read-side hydrator, and the bare read refuses naming both. Both install
   * orders: `kappa` then `lambda` for one name, `lambda` then `iota` for the
   * other. FROM (this branch before `main`'s #32741 was merged in): the
   * first-installed holder's exact address served the package-less row as its
   * own; the second served its own.
   */
  it('[#31985] a package-less tool row saved before two namespaces\' packages install the name is declined at each holder\'s exact address, both install orders, before and after the hydrator; the bare read refuses naming both', async () => {
    const UP = 'qa_row_tool_up';
    const DOWN = 'qa_row_tool_down';
    for (const name of [UP, DOWN]) {
      const saved = await stack.apiAs(admin, 'PUT', `/meta/tool/${name}`, tool('env', name));
      expect(saved.status, await saved.text()).toBeLessThan(300);
    }
    for (const [p, tools] of [['kappa', [UP]], ['lambda', [UP, DOWN]], ['iota', [DOWN]]] as const) {
      const { status, body } = await installLocal(inline(p, { tools: tools.map((n) => tool(p, n)) }));
      expect(status, `${p}: ${JSON.stringify(body)}`).toBeLessThan(300);
    }
    const layeredAt = async (name: string, pkg: string) => {
      const r = await stack.apiAs(admin, 'GET', `/meta/tool/${name}/layers?package=${pkg}`);
      const body = (await r.json()) as any;
      return [r.status, body?.overlay ?? null, body?.effective?.label];
    };
    for (const when of ['before the hydrator', 'after the hydrator']) {
      if (when === 'after the hydrator') expect((await stack.apiAs(admin, 'GET', '/meta/tool')).status).toBe(200);
      for (const [name, holders] of [[UP, ['kappa', 'lambda']], [DOWN, ['lambda', 'iota']]] as const) {
        for (const p of holders) {
          const pkg = `com.qa.bare.${p}`;
          expect(await metaAt('tool', name, pkg), `${when}: ${name} at ${p}`).toEqual([pkg, `${p} tool`]);
          expect(await layeredAt(name, pkg), `${when}: ${name} layered at ${p}`).toEqual([200, null, `${p} tool`]);
        }
        await expectMetaRefused('tool', name, holders.map((p) => `com.qa.bare.${p}`));
      }
    }
  });
});

/**
 * [#32151, ADR-0150 D3/D4] The artifact door, which the boot above does not
 * reach: `bootStack` mounts `AppPlugin` as the stack's one registrar and a
 * `MetadataPlugin` with no artifact, so the metadata service there holds no
 * agent or skill at all. [#31985] A tool joins the same slots in the change
 * that narrows it, so each pin here runs for the tool too. `os dev` (HMR) and `os start` load the compiled
 * artifact through `MetadataPlugin`'s artifact door instead, which registers
 * every package body's items into the metadata service, stamped
 * `_packageId`. Its in-memory store was keyed by bare name for these types, so
 * the package registered last overwrote the other: on main 45f0f81f every
 * `get` of the name, the one naming the other package included, answered the
 * survivor, and `GET /meta/TYPE/NAME/layers?package=<the other>` served the
 * survivor's body as both the code and the effective layer, under the
 * survivor's `packageId`. (For a tool the layered read already served each
 * package's own: it judges the code layer at the exact address, and its pin
 * stays green with `tool` taken back out of the slotted store.)
 *
 * The one narrowing the slots bring is a read of the metadata service naming
 * a package that holds no slot of the name: it was answered the stored item
 * (the one holder's, or the survivor), and is now answered nothing. The HTTP
 * read naming such a package was already refused `409` (ADR-0150 D5) before
 * the service was asked, and still is.
 */
describe('the artifact door keeps each namespace\'s agent, skill and tool in the metadata service, and the layered read serves each package its own (#32151, #31985)', () => {
  const ALPHA = 'com.qa.bare.alpha';
  const BETA = 'com.qa.bare.beta';
  const SOLO_AGENT = 'qa_solo_agent';
  const SOLO_SKILL = 'qa_solo_skill';
  const SOLO_TOOL = 'qa_solo_tool';
  const TYPES = ['agent', 'skill', 'tool'] as const;
  type SlottedType = (typeof TYPES)[number];
  const SHARED: Record<SlottedType, string> = { agent: AGENT, skill: SKILL, tool: TOOL };
  const SOLO: Record<SlottedType, string> = { agent: SOLO_AGENT, skill: SOLO_SKILL, tool: SOLO_TOOL };
  const artifactPackage = (p: 'alpha' | 'beta') => defineStack({
    manifest: { id: `com.qa.bare.${p}`, namespace: p, name: `qa_bare_${p}`, version: '1.0.0', type: p === 'alpha' ? 'app' : 'module' },
    objects: [item(p)],
    agents: [agent(p), ...(p === 'alpha' ? [agent(p, SOLO_AGENT)] : [])],
    skills: [skill(p), ...(p === 'alpha' ? [skill(p, SOLO_SKILL)] : [])],
    tools: [tool(p), ...(p === 'alpha' ? [tool(p, SOLO_TOOL)] : [])],
  } as never);
  const artifact = composeStacks([artifactPackage('alpha'), artifactPackage('beta')], { manifest: 'preserve' });

  let stack: VerifyStack;
  let admin: string;
  let dir: string;
  let metadata: {
    get(type: string, name: string, packageId?: string): Promise<any>;
    getDiagnosed(type: string, name: string, packageId?: string): Promise<{ data: unknown; degraded: boolean; errors: string[] }>;
    list(type: string): Promise<any[]>;
  };

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'dogfood-slotted-store-ai-'));
    const artifactPath = join(dir, 'objectstack.json');
    writeBuildShapedArtifact(artifact as unknown as Record<string, unknown>, artifactPath);
    stack = await bootStack(artifact, {
      extraPlugins: [
        new MetadataPlugin({
          rootDir: dir, watch: false, artifactWatch: false, registerSystemObjects: false,
          artifactSource: { mode: 'local-file', path: artifactPath },
        }),
      ],
    });
    admin = await stack.signIn();
    metadata = await stack.kernel.getServiceAsync('metadata');
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  const layers = async (type: string, name: string, pkg?: string) => {
    const r = await stack.apiAs(admin, 'GET', `/meta/${type}/${name}/layers${pkg ? `?package=${pkg}` : ''}`);
    const body = (await r.json()) as any;
    return { status: r.status, code: body?.code?.label, effective: body?.effective?.label, packageId: body?.packageId, body };
  };

  it.each(TYPES)('%s: `/layers?package=` serves each package\'s own code and effective layer (BASE: agent and skill served the package registered last; a tool was already served its own)', async (type) => {
    const name = SHARED[type];
    for (const p of ['alpha', 'beta'] as const) {
      const read = await layers(type, name, `com.qa.bare.${p}`);
      expect([read.status, read.code, read.effective, read.packageId], JSON.stringify(read.body).slice(0, 300))
        .toEqual([200, `${p} ${type}`, `${p} ${type}`, `com.qa.bare.${p}`]);
    }
  });

  it.each(TYPES)('%s: the metadata service holds both packages\' items: a read naming each package answers its own, and the read naming none is refused naming both (BASE: every read answered the package registered last)', async (type) => {
    const name = SHARED[type];
    expect((await metadata.get(type, name, ALPHA))?.label).toBe(`alpha ${type}`);
    expect((await metadata.get(type, name, BETA))?.label).toBe(`beta ${type}`);
    expect((await metadata.list(type)).filter((i) => i?.name === name).map((i) => i?.label).sort()).toEqual([`alpha ${type}`, `beta ${type}`]);
    const refused = await metadata.get(type, name).then(() => undefined, (e: any) => e);
    expect([refused?.code, refused?.status], 'never one of them picked').toEqual(['RESOURCE_CONFLICT', 409]);
    for (const holder of [ALPHA, BETA]) expect(String(refused?.message)).toContain(holder);
  });

  it.each(TYPES)('CONTROL — %s: the doors that already resolved by package answer as before: the bare read and the bare layered read refuse naming both, `?package=` serves each package\'s own', async (type) => {
    const name = SHARED[type];
    for (const path of [`/meta/${type}/${name}`, `/meta/${type}/${name}/layers`]) {
      const r = await stack.apiAs(admin, 'GET', path);
      const text = await r.text();
      const body = JSON.parse(text);
      expect([r.status, codeOf(body)], path).toEqual([409, 'RESOURCE_CONFLICT']);
      for (const holder of [ALPHA, BETA]) expect(text, path).toContain(holder);
    }
    for (const p of ['alpha', 'beta'] as const) {
      const r = await stack.apiAs(admin, 'GET', `/meta/${type}/${name}?package=com.qa.bare.${p}`);
      const it = ((await r.json()) as any)?.item;
      expect([r.status, it?.label, it?._packageId]).toEqual([200, `${p} ${type}`, `com.qa.bare.${p}`]);
    }
  });

  it.each(TYPES)('%s: a read of the metadata service naming a package that holds no slot of the name answers nothing (BASE: the one holder\'s item, or the survivor of two)', async (type) => {
    const solo = SOLO[type];
    expect(await metadata.get(type, solo, BETA), 'one holder').toBeUndefined();
    expect(await metadata.getDiagnosed(type, solo, BETA)).toEqual({ data: undefined, degraded: false, errors: [] });
    expect(await metadata.get(type, SHARED[type], 'com.qa.bare.gamma'), 'two holders').toBeUndefined();
  });

  it.each(TYPES)('CONTROL — %s: `/layers?package=` a package that holds no slot is refused 409 naming the holder (D5), for one holder and for two, as before', async (type) => {
    for (const [name, pkg, holders] of [
      [SOLO[type], BETA, [ALPHA]],
      [SHARED[type], 'com.qa.bare.gamma', [ALPHA, BETA]],
    ] as const) {
      const read = await layers(type, name, pkg);
      expect([read.status, codeOf(read.body)], JSON.stringify(read.body).slice(0, 300)).toEqual([409, 'RESOURCE_CONFLICT']);
      for (const holder of holders) expect(JSON.stringify(read.body), name).toContain(holder);
    }
  });

  it.each(TYPES)('CONTROL — %s: one holder per name: every read answers the one package\'s item, bare or by its package', async (type) => {
    const name = SOLO[type];
    expect((await metadata.get(type, name))?.label).toBe(`alpha ${type}`);
    expect((await metadata.get(type, name, ALPHA))?.label).toBe(`alpha ${type}`);
    const bare = await layers(type, name);
    expect([bare.status, bare.code, bare.packageId]).toEqual([200, `alpha ${type}`, ALPHA]);
    const r = await stack.apiAs(admin, 'GET', `/meta/${type}/${name}`);
    const it = ((await r.json()) as any)?.item;
    expect([r.status, it?.label, it?._packageId]).toEqual([200, `alpha ${type}`, ALPHA]);
  });
});
