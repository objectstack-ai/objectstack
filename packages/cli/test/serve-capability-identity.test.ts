// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7652 — the capability resolver must compare provider IDENTITIES, not name
 * fragments.
 *
 * The defect: `hasPluginMatching` tested each `nameMatch` entry with
 * `String.includes()`, so a capability counted as "already provided" by any
 * loaded plugin whose name merely CONTAINED one of the fragments. The general
 * hazard that opens is not one unlucky collision — it is that a plugin which
 * CONSUMES a capability is conventionally named after the capability, so a
 * consumer reliably suppresses the provider it depends on. The stock showcase
 * loads `com.objectstack.connector.mcp` (the outbound MCP *client* connector),
 * `'mcp'` is a substring of it, `MCPServerPlugin` therefore never loaded, and
 * the endpoint the boot banner advertises answered 501.
 *
 * This file pins BOTH directions, which is the part that makes it a fix rather
 * than a mute:
 *
 *  - the consumer must NOT satisfy the capability (the bug), and
 *  - every real provider must STILL satisfy its own capability (the regression
 *    a tightened match invites — a resolver that matches nothing would make
 *    every capability load its default provider and look green in the repro).
 *
 * The provider identities are also DRIFT-CHECKED against the packages
 * themselves: the registry now names literal `plugin.name` ids, so a provider
 * renaming itself would silently return the resolver to double-loading. The
 * last describe block imports each provider package and compares.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Serve from '../src/commands/serve.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');

/** Minimal stand-in for a loaded plugin: what the resolver actually reads. */
function plugin(name: string, ctorName: string): { name: string } {
  const Ctor = { [ctorName]: class { name: string; constructor(n: string) { this.name = n; } } }[ctorName]!;
  return new Ctor(name) as { name: string };
}

describe('#7652: providesCapability compares identities, not substrings', () => {
  const MCP = Serve.CAPABILITY_PROVIDERS.mcp;

  it('the outbound MCP CLIENT connector does not satisfy the `mcp` capability', () => {
    // The exact plugin the showcase loads (`packages/connectors/connector-mcp`).
    const consumer = plugin('com.objectstack.connector.mcp', 'ConnectorMcpPlugin');
    expect(
      Serve.providesCapability([consumer], MCP.identities),
      'a consumer named after the capability must never suppress its provider',
    ).toBe(false);
  });

  it('the real MCP server plugin still satisfies it — by name and by class', () => {
    expect(Serve.providesCapability([plugin('com.objectstack.mcp', 'MCPServerPlugin')], MCP.identities)).toBe(true);
    // A host that constructs the class under another id (or a subclass) is still
    // recognised through whichever identity survives.
    expect(Serve.providesCapability([plugin('com.acme.custom-mcp', 'MCPServerPlugin')], MCP.identities)).toBe(true);
    expect(Serve.providesCapability([plugin('com.objectstack.mcp', 'WrappedMcp')], MCP.identities)).toBe(true);
  });

  it('rejects the near-misses substring matching used to accept', () => {
    for (const near of [
      plugin('com.objectstack.connector.mcp.v2', 'ConnectorMcpPlugin'),
      plugin('com.objectstack.mcp-inspector', 'McpInspectorPlugin'),
      plugin('com.acme.mcp', 'AcmeMcpBridgePlugin'),
      // Class-name containment was exposed the same way: anything ENDING in a
      // provider class name used to match it.
      plugin('com.acme.thing', 'FakeMCPServerPlugin'),
    ]) {
      expect(Serve.providesCapability([near], MCP.identities), `${near.name} must not satisfy \`mcp\``).toBe(false);
    }
  });

  it('an empty identity list never matches, and empty strings are ignored', () => {
    expect(Serve.providesCapability([plugin('com.objectstack.mcp', 'MCPServerPlugin')], [])).toBe(false);
    expect(Serve.providesCapability([plugin('', 'Anon')], [''])).toBe(false);
  });

  it('survives plugins with no name / a null-prototype object', () => {
    expect(Serve.providesCapability([{}, null, undefined, Object.create(null)], MCP.identities)).toBe(false);
    expect(Serve.providesCapability([{ name: 'com.objectstack.mcp' }], MCP.identities)).toBe(true);
  });
});

/**
 * The measured provider identities. Each entry is the `plugin.name` the package
 * actually assigns — read out of the provider packages, not guessed. The drift
 * block below re-derives these from the packages at run time; this table exists
 * so the registry's intent is reviewable in one place.
 */
const EXPECTED_PROVIDER_NAME: Record<string, string> = {
  automation: 'com.objectstack.service-automation',
  analytics: 'com.objectstack.service-analytics',
  audit: 'com.objectstack.audit',
  cache: 'com.objectstack.service.cache',
  storage: 'com.objectstack.service.storage',
  queue: 'com.objectstack.service.queue',
  job: 'com.objectstack.service.job',
  messaging: 'com.objectstack.service.messaging',
  triggers: 'com.objectstack.trigger.record-change',
  realtime: 'com.objectstack.service.realtime',
  mcp: 'com.objectstack.mcp',
  marketplace: 'package-service',
  email: 'com.objectstack.service.email',
  sms: 'com.objectstack.service.sms',
  sharing: 'com.objectstack.service.sharing',
  'pinyin-search': 'com.objectstack.plugin.pinyin-search',
  reports: 'com.objectstack.service.reports',
  approvals: 'com.objectstack.service.approvals',
  settings: 'com.objectstack.service.settings',
  webhooks: 'com.objectstack.plugin-webhook-outbox',
};

describe('#7652: every registered provider is still recognised (the other direction)', () => {
  it('covers every CAPABILITY_PROVIDERS token — the table cannot silently fall behind', () => {
    expect(Object.keys(EXPECTED_PROVIDER_NAME).sort()).toEqual(Object.keys(Serve.CAPABILITY_PROVIDERS).sort());
  });

  it.each(Object.entries(Serve.CAPABILITY_PROVIDERS))(
    '`%s` is satisfied by its own provider, by name and by class',
    (cap, spec) => {
      const realName = EXPECTED_PROVIDER_NAME[cap]!;
      expect(Serve.providesCapability([plugin(realName, 'Unrelated')], spec.identities)).toBe(true);
      expect(Serve.providesCapability([plugin('com.example.unrelated', spec.export)], spec.identities)).toBe(true);
    },
  );

  it('every entry declares its exported class name as an identity', () => {
    for (const [cap, spec] of Object.entries(Serve.CAPABILITY_PROVIDERS)) {
      expect(spec.identities, `'${cap}' must accept an explicitly-constructed ${spec.export}`).toContain(spec.export);
      for (const ex of spec.extras ?? []) {
        expect(ex.identities, `'${cap}' extra ${ex.export}`).toContain(ex.export);
      }
    }
  });

  it('no identity is a bare fragment — ids are fully qualified, class names are not ids', () => {
    for (const [cap, spec] of Object.entries(Serve.CAPABILITY_PROVIDERS)) {
      const all = [spec, ...(spec.extras ?? [])];
      for (const entry of all) {
        for (const id of entry.identities) {
          const isClassName = /^[A-Z][A-Za-z0-9]*$/.test(id);
          // A dotted id, a `-` separated id, or a PascalCase class name. What is
          // banned is the short single word that made #7652 possible.
          const isPluginId = id.includes('.') || id.includes('-');
          expect(
            isClassName || isPluginId,
            `'${cap}' identity '${id}' looks like a bare fragment — declare the full plugin id`,
          ).toBe(true);
        }
      }
    }
  });

  it('the plugins the showcase loads do not satisfy any capability they merely consume', () => {
    // Real names, from packages/connectors. Each is a CONSUMER: the automation
    // service materializes them, none of them PROVIDES a platform capability.
    const consumers = [
      plugin('com.objectstack.connector.mcp', 'ConnectorMcpPlugin'),
      plugin('com.objectstack.connector.openapi', 'ConnectorOpenApiPlugin'),
      plugin('com.objectstack.connector.rest', 'ConnectorRestPlugin'),
      plugin('com.objectstack.connector.slack', 'ConnectorSlackPlugin'),
    ];
    for (const [cap, spec] of Object.entries(Serve.CAPABILITY_PROVIDERS)) {
      expect(
        Serve.providesCapability(consumers, spec.identities),
        `a connector must not stand in for the '${cap}' provider`,
      ).toBe(false);
    }
  });
});

/**
 * Drift guard. The registry names literal plugin ids, so it is only correct as
 * long as the provider packages keep those names. Import each provider and
 * compare against what it actually registers.
 *
 * `constructor.name` alone would keep passing through a rename, which is
 * exactly the silent-double-load this file exists to prevent — so the *name* is
 * asserted too whenever the plugin can be constructed without arguments.
 */
describe('#7652: declared identities match what the provider packages register', () => {
  const entries = Object.entries(Serve.CAPABILITY_PROVIDERS).flatMap(([cap, spec]) => [
    { cap, pkg: spec.pkg, export: spec.export, identities: spec.identities },
    ...(spec.extras ?? []).map((ex) => ({ cap: `${cap}:${ex.export}`, pkg: ex.pkg, export: ex.export, identities: ex.identities })),
  ]);

  /**
   * The consumer side of the pin. `@objectstack/connector-mcp` is not a
   * dependency of this package (so it is not built by `turbo run test`), which
   * is why `serve-mcp-capability-collision.e2e.test.ts` declares the identity
   * in its fixture rather than importing the class. Read the connector's source
   * so that fixture cannot drift into testing a name nobody registers.
   */
  it('the MCP client connector still registers the name the #7652 repro uses', () => {
    const src = readFileSync(
      resolve(HERE, '../../connectors/connector-mcp/src/connector-mcp-plugin.ts'),
      'utf8',
    );
    expect(src).toContain("name = 'com.objectstack.connector.mcp'");
    expect(src).toContain('export class ConnectorMcpPlugin');
    // And that name must NOT satisfy the capability it consumes.
    expect(Serve.providesCapability(
      [plugin('com.objectstack.connector.mcp', 'ConnectorMcpPlugin')],
      Serve.CAPABILITY_PROVIDERS.mcp.identities,
    )).toBe(false);
  });

  it.each(entries)('$cap — $pkg exports $export under a declared identity', async ({ pkg, export: exportName, identities }) => {
    const mod = (await import(/* @vite-ignore */ pkg)) as Record<string, unknown>;
    const Ctor = mod[exportName];
    expect(Ctor, `${pkg} does not export ${exportName}`).toBeTypeOf('function');
    expect(identities).toContain(exportName);

    // Options-taking constructors are given an empty object; every provider
    // here defaults its options, so this is the real construction path.
    const instance = new (Ctor as new (opts?: unknown) => { name?: unknown })({});
    expect(
      typeof instance.name === 'string' ? instance.name : '(no name)',
      `${exportName} registers a name the capability registry does not declare — ` +
        'the resolver would load a SECOND copy alongside an explicitly-provided one',
    ).toSatisfy((n: string) => identities.includes(n));
  });
});
