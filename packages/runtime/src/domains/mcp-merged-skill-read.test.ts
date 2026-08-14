// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { HttpDispatcher } from '../http-dispatcher.js';

/**
 * [#8726 — the HTTP half of #8328] `buildMcpBridge.listSkills` must read the
 * protocol layer's MERGED listing, not `IMetadataService.list('skill')`.
 *
 * ── The defect ────────────────────────────────────────────────────────────
 *
 * `PUT /api/v1/meta/skill/<name>` with `{active:true}` returns 200 and lands a
 * `sys_metadata` overlay row. `GET /api/v1/meta/skill` serves the flip, because
 * it goes through the protocol's `getMetaItems`, which merges overlays. The MCP
 * prompt bridge on THIS endpoint read `metadataService.list('skill')` — the
 * registry/loader listing, one layer BELOW where any merging happens — so the
 * flip never reached MCP prompts and step 3 of #8328's reproduction answered
 * `{"prompts":[]}`.
 *
 * #8328's stdio half (PR #8724, `packages/mcp`) fixed the long-lived server.
 * This is the per-request HTTP surface the reproduction actually runs through.
 *
 * ── Why the fakes are shaped the way they are ─────────────────────────────
 *
 * The registry listing and the merged listing are given DELIBERATELY DIFFERENT
 * rows for the same skill name. That is the whole point: an assertion that only
 * checked "some rows came back" would pass against the defect. Every pin below
 * discriminates on WHICH layer answered.
 *
 * ── Reverse verification (direction predicted BEFORE running) ─────────────
 *
 * Predicted, on restoring `return (await meta?.list?.('skill')) ?? []`:
 * 6 red / 4 green. MEASURED: 6 red / 4 green — the four greens are the
 * absent-host paths (no protocol service, no metadata service) and the two
 * multi-environment pins, which are invariants of the per-request seam and
 * hold in both directions by construction. Numbers recorded here so a later
 * reader can re-run the ablation and compare.
 */

/** A `skill` row as the REGISTRY/loader layer has it — packaged, inactive. */
const PACKAGED_SKILL = {
  name: 'case_triage',
  label: 'Case Triage',
  instructions: 'Triage first.',
  active: false,
};

/**
 * The SAME skill as the MERGED layer has it — the `{active:true}` runtime PUT
 * applied. Different `label` too, so a pin can name which layer answered
 * without relying on `active` alone.
 */
const MERGED_SKILL = {
  name: 'case_triage',
  label: 'Case Triage (overridden)',
  instructions: 'Triage first.',
  active: true,
};

interface KernelOpts {
  /** Register a `protocol` service carrying the merged read. */
  withProtocol?: boolean;
  /** Register a `metadata` service at all (absent = the load-bearing `?? []`). */
  withMetadata?: boolean;
  /** What the merged read does. Default: answer `{ type, items }`. */
  getMetaItems?: (req: any) => Promise<any>;
  /** `IMetadataService.listDiagnosed` — omit to model a service predating it. */
  listDiagnosed?: (type: string) => Promise<any>;
  /** Records every `metadataService.list(type)` call, for provenance pins. */
  listCalls?: string[];
}

function makeKernel(opts: KernelOpts = {}) {
  const listCalls = opts.listCalls ?? [];
  const metadata: any = {
    listObjects: async () => [],
    getObject: async () => null,
    list: async (type: string) => {
      listCalls.push(type);
      return type === 'skill' ? [PACKAGED_SKILL] : [];
    },
  };
  if (opts.listDiagnosed) metadata.listDiagnosed = opts.listDiagnosed;

  const protocol: any = {
    getMetaItems:
      opts.getMetaItems ??
      (async (req: any) => ({ type: req.type, items: req.type === 'skill' ? [MERGED_SKILL] : [] })),
  };

  const mcpService: any = {
    lastOpts: undefined,
    handleHttpRequest: async (_req: Request, o: any) => {
      mcpService.lastOpts = o;
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    },
  };

  const services: Record<string, any> = { mcp: mcpService };
  if (opts.withMetadata !== false) services.metadata = metadata;
  if (opts.withProtocol) services.protocol = protocol;

  const kernel: any = {
    getService: (n: string) => services[n],
    getServiceAsync: async (n: string) => services[n],
  };
  return { kernel, mcpService, listCalls };
}

function makeContext(overrides: any = {}) {
  return {
    request: new Request('http://localhost/api/v1/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: '{}',
    }),
    response: {},
    environmentId: undefined,
    executionContext: { userId: 'u1', isSystem: false, positions: [], permissions: [] },
    ...overrides,
  };
}

/** Drive the real HTTP entry point and hand back the bridge the runtime built. */
async function bridgeFor(kernel: any, context: any = makeContext()) {
  const d = new HttpDispatcher(kernel, undefined, { enforceProjectMembership: false });
  const res = await d.handleMcp({ jsonrpc: '2.0', id: 1, method: 'prompts/list' }, context);
  expect(res.response.status, 'precondition: the MCP route must have been served').toBe(200);
  return (kernel.getService('mcp') as any).lastOpts.bridge;
}

describe('buildMcpBridge.listSkills reads the merged metadata listing (#8726)', () => {
  const prev = process.env.OS_MCP_SERVER_ENABLED;
  beforeEach(() => {
    process.env.OS_MCP_SERVER_ENABLED = 'true';
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.OS_MCP_SERVER_ENABLED;
    else process.env.OS_MCP_SERVER_ENABLED = prev;
    vi.restoreAllMocks();
  });

  it('serves the OVERLAY row — a runtime meta PUT reaches MCP prompts', async () => {
    // The exact defect: the registry row says `active:false`, the merged row
    // says `active:true`. `projectSkillPrompt` drops `active:false`, so serving
    // the registry row is what made the reproduction answer `{"prompts":[]}`.
    const { kernel } = makeKernel({ withProtocol: true });
    const rows: any[] = await (await bridgeFor(kernel)).listSkills();
    expect(rows).toEqual([MERGED_SKILL]);
    expect(rows[0].active, 'the {active:true} flip must be reflected').toBe(true);
  });

  it('does NOT serve the un-merged registry row when a merged read exists', async () => {
    // Provenance asserted two ways, because the content pin alone would also
    // pass if BOTH layers happened to agree — and `list` not being called is a
    // claim that discriminates here (the merged branch never calls it).
    const listCalls: string[] = [];
    const { kernel } = makeKernel({ withProtocol: true, listCalls });
    const rows: any[] = await (await bridgeFor(kernel)).listSkills();
    expect(rows).not.toContainEqual(PACKAGED_SKILL);
    expect(rows[0].label).toBe('Case Triage (overridden)');
    expect(listCalls, 'the un-merged listing must not be consulted at all').toEqual([]);
  });

  it('accepts the bare-array answer shape as well as `{ type, items }`', async () => {
    // The slot is filled by name from a host-owned registry; the stdio half of
    // this same read accepts both, and the two surfaces answering one question
    // must not disagree about the shape they accept.
    const { kernel } = makeKernel({
      withProtocol: true,
      getMetaItems: async () => [MERGED_SKILL],
    });
    expect(await (await bridgeFor(kernel)).listSkills()).toEqual([MERGED_SKILL]);
  });

  it('⛔ does NOT fall back to the un-merged listing when the merged read throws', async () => {
    // Falling back would answer registry rows in the shape of merged ones —
    // this exact defect, restored silently at the moment the overlay store is
    // unreadable, which is when an overlay is most likely to be what is missed.
    const listCalls: string[] = [];
    const { kernel } = makeKernel({
      withProtocol: true,
      listCalls,
      getMetaItems: async () => {
        throw new Error('sys_metadata unreadable');
      },
    });
    const bridge = await bridgeFor(kernel);
    await expect(bridge.listSkills()).rejects.toThrow('sys_metadata unreadable');
    expect(listCalls, 'the failure must NOT be papered over with registry rows').toEqual([]);
  });

  it('falls back to the registry listing when the host has NO merged read', async () => {
    // Structural absence is not degradation: a host assembled without the
    // metadata protocol has no merged read to offer, so nothing was skipped.
    const { kernel } = makeKernel({ withProtocol: false });
    expect(await (await bridgeFor(kernel)).listSkills()).toEqual([PACKAGED_SKILL]);
  });

  it('answers [] when the host has no metadata service at all', async () => {
    // The load-bearing `?? []`: this path must read exactly as it did before.
    const { kernel } = makeKernel({ withProtocol: false, withMetadata: false });
    expect(await (await bridgeFor(kernel)).listSkills()).toEqual([]);
  });

  describe('per-environment resolution (multi-tenant hosts)', () => {
    /**
     * The merged read must be resolved on the SAME per-environment seam
     * `getMeta()` uses — never captured once at boot, which would serve one
     * environment's overlay rows to every other one. Modelled the way the
     * dispatcher actually resolves a scoped service: `getServiceAsync(name,
     * scopeId)` on the shared kernel.
     */
    function makeScopedKernel() {
      const seen: string[] = [];
      const mcpService: any = {
        lastOpts: undefined,
        handleHttpRequest: async (_req: Request, o: any) => {
          mcpService.lastOpts = o;
          return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
        },
      };
      const perEnv = (envId: string) => ({
        getMetaItems: async (req: any) => {
          seen.push(envId);
          return { type: req.type, items: [{ ...MERGED_SKILL, name: `skill_of_${envId}` }] };
        },
      });
      const kernel: any = {
        getService: (n: string) => (n === 'mcp' ? mcpService : undefined),
        getServiceAsync: async (n: string, scopeId?: string) => {
          if (n === 'mcp') return mcpService;
          if (n === 'protocol' && scopeId) return perEnv(scopeId);
          if (n === 'metadata' && scopeId) return { list: async () => [], listObjects: async () => [] };
          return undefined;
        },
      };
      return { kernel, mcpService, seen };
    }

    it('serves each environment its OWN skills', async () => {
      const { kernel, seen } = makeScopedKernel();
      const envA = await bridgeFor(kernel, makeContext({ environmentId: 'env_a' }));
      const rowsA: any[] = await envA.listSkills();
      const envB = await bridgeFor(kernel, makeContext({ environmentId: 'env_b' }));
      const rowsB: any[] = await envB.listSkills();

      expect(rowsA[0].name).toBe('skill_of_env_a');
      expect(rowsB[0].name).toBe('skill_of_env_b');
      expect(seen).toEqual(['env_a', 'env_b']);
    });

    it('does not let one environment see another\'s skills', async () => {
      const { kernel } = makeScopedKernel();
      const envA = await bridgeFor(kernel, makeContext({ environmentId: 'env_a' }));
      const rowsA: any[] = await envA.listSkills();
      expect(rowsA.map((r) => r.name)).not.toContain('skill_of_env_b');
    });
  });

  describe('#6504 completeness verdict — the gap this read never had', () => {
    it('warns when the metadata service reports a known-partial read', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { kernel } = makeKernel({
        withProtocol: true,
        listDiagnosed: async () => ({ items: [], degraded: true, errors: ['loader "hr" unreachable'] }),
      });
      await (await bridgeFor(kernel)).listSkills();
      expect(warn).toHaveBeenCalledTimes(1);
      const [message, detail] = warn.mock.calls[0];
      expect(String(message)).toContain('INCOMPLETE');
      // Missing, NOT undeclared — the distinction the verdict exists to carry.
      expect(String(message)).toContain('missing, NOT');
      expect(detail).toMatchObject({ readable: 1, errors: ['loader "hr" unreachable'] });
    });

    it('stays silent when the read is complete', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { kernel } = makeKernel({
        withProtocol: true,
        listDiagnosed: async () => ({ items: [MERGED_SKILL], degraded: false, errors: [] }),
      });
      await (await bridgeFor(kernel)).listSkills();
      expect(warn).not.toHaveBeenCalled();
    });

    it('stays silent on a metadata service that predates listDiagnosed', async () => {
      // Optional member (#5840): a service that cannot report the distinction
      // is read exactly as before and reports nothing degraded.
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { kernel } = makeKernel({ withProtocol: true });
      expect(await (await bridgeFor(kernel)).listSkills()).toEqual([MERGED_SKILL]);
      expect(warn).not.toHaveBeenCalled();
    });

    it('a failing verdict probe does not fail a read whose items succeeded', async () => {
      // Observability must not buy a new failure mode. The inability to judge
      // completeness is reported as exactly that — never flattened into a
      // completeness claim the code did not earn.
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { kernel } = makeKernel({
        withProtocol: true,
        listDiagnosed: async () => {
          throw new Error('loader registry down');
        },
      });
      expect(await (await bridgeFor(kernel)).listSkills()).toEqual([MERGED_SKILL]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain('could not be determined');
    });
  });
});
