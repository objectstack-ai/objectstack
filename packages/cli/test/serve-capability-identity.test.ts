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
    // The class-name limb is compared to the RUNTIME class name by the #8645
    // block below — this line only pins the registry's own spelling, which is
    // why it could not see `_MarketplaceProxyPlugin`.

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

/**
 * #8645 — the class-name limb must equal what the class is CALLED in the
 * SHIPPED build, and every registry that declares one is enumerated here.
 *
 * What was measured, and why the drift block above could not see it:
 * `Serve.providesCapability` recognises a provider by comparing
 * `plugin.constructor.name` against the declared identities, so a class-name
 * identity is a genuine SECOND way to recognise a provider only while it equals
 * the class's runtime `.name`. Nothing compared those two. The block above
 * asserts `identities` CONTAINS `spec.export` — the registry against the
 * registry's own spelling — and then asserts the constructed instance's `name`
 * is declared, which exercises the OTHER limb.
 *
 * For `MarketplaceProxyPlugin` the two had already parted company. The source
 * referenced the class by name inside its own body, esbuild rewrote it into
 * `var MarketplaceProxyPlugin = class _MarketplaceProxyPlugin { … }` so the
 * inner reference binds to the class binding, and the built class reported
 * `_MarketplaceProxyPlugin` — an identity nothing declares. The guard kept
 * working on its registered-`name` limb alone, without knowing that was the
 * only limb it had. A guard running on one limb it does not know it is running
 * on is one rename away from failing OPEN.
 *
 * These assertions read the BUILT package through each package's exports map,
 * because `dist/` is the artifact the class-name limb is a claim about. A
 * source-only check would have stayed green through exactly this defect.
 */

/**
 * The bare identity lists on `Serve` — the ones carrying no `pkg`/`export`
 * metadata to derive from — mapped to the export each one is a claim about.
 * The coverage test re-derives the `*_IDENTITIES` statics from `Serve` itself,
 * so a fifth list cannot be added without landing here.
 */
const IDENTITY_LISTS: Record<string, { list: readonly string[]; pkg: string; export: string }> = {
  INSTALL_LOCAL_IDENTITIES: {
    list: Serve.INSTALL_LOCAL_IDENTITIES,
    pkg: '@objectstack/cloud-connection',
    export: 'MarketplaceInstallLocalPlugin',
  },
  RUNTIME_CONFIG_IDENTITIES: {
    list: Serve.RUNTIME_CONFIG_IDENTITIES,
    pkg: '@objectstack/cloud-connection',
    export: 'RuntimeConfigPlugin',
  },
  MARKETPLACE_PROXY_IDENTITIES: {
    list: Serve.MARKETPLACE_PROXY_IDENTITIES,
    pkg: '@objectstack/cloud-connection',
    export: 'MarketplaceProxyPlugin',
  },
  CLOUD_CONNECTION_IDENTITIES: {
    // Reached through `createCloudConnectionPlugin`, but a factory is not what
    // lands in the kernel — the identity names the class the factory returns.
    list: Serve.CLOUD_CONNECTION_IDENTITIES,
    pkg: '@objectstack/cloud-connection',
    export: 'CloudConnectionPlugin',
  },
};

type IdentitySource = {
  label: string;
  pkg: string;
  export: string;
  identities: readonly string[];
};

/** Every declared class-name identity in `serve.ts`, from both registry shapes. */
const IDENTITY_SOURCES: IdentitySource[] = [
  ...Object.entries(Serve.CAPABILITY_PROVIDERS).flatMap(([cap, spec]) => [
    { label: `CAPABILITY_PROVIDERS.${cap}`, pkg: spec.pkg, export: spec.export, identities: spec.identities },
    ...(spec.extras ?? []).map((ex) => ({
      label: `CAPABILITY_PROVIDERS.${cap} → ${ex.export}`,
      pkg: ex.pkg,
      export: ex.export,
      identities: ex.identities,
    })),
  ]),
  ...Object.entries(IDENTITY_LISTS).map(([name, entry]) => ({
    label: `Serve.${name}`,
    pkg: entry.pkg,
    export: entry.export,
    identities: entry.list,
  })),
];

describe('#8645: every declared class-name identity equals the runtime class name', () => {
  it('enumerates every identity registry on Serve — a new list cannot escape', () => {
    const onServe = Object.getOwnPropertyNames(Serve).filter((k) => k.endsWith('_IDENTITIES'));
    expect(
      onServe.sort(),
      'a new `*_IDENTITIES` list on Serve must declare the export it names here, ' +
        'or its class-name limb ships unchecked',
    ).toEqual(Object.keys(IDENTITY_LISTS).sort());
  });

  it.each(IDENTITY_SOURCES)(
    '$label — the built $export is really called $export',
    async ({ label, pkg, export: exportName, identities }) => {
      const mod = (await import(/* @vite-ignore */ pkg)) as Record<string, unknown>;
      const Ctor = mod[exportName];
      expect(Ctor, `${pkg} does not export ${exportName}`).toBeTypeOf('function');

      const runtimeName = (Ctor as { name: string }).name;
      expect(
        runtimeName,
        `${label} declares the class-name identity '${exportName}', but the class ` +
          `${pkg} ships is called '${runtimeName}' — the limb matches nothing. If a ` +
          'leading underscore appears here, the class references itself by name inside ' +
          'its own body and esbuild renamed it; fix the source idiom (`this.x` / a ' +
          'module-scope constant), do not pin the bundler output.',
      ).toBe(exportName);
      expect(identities, `${label} must declare the runtime class name`).toContain(runtimeName);

      // …and the limb must actually fire through the resolver, on its own.
      // `Object.create` gives an instance of the BUILT class without running a
      // constructor, and with no own `name` — so only the class-name limb can
      // satisfy this, which is the redundancy the registry claims to have.
      const bare = Object.create((Ctor as { prototype: object }).prototype) as unknown;
      expect(
        Serve.providesCapability([bare], identities),
        `${label}: the class-name limb must recognise ${exportName} by itself`,
      ).toBe(true);
    },
  );

  it('no registry declares a class-name identity beyond the export it names', () => {
    for (const src of IDENTITY_SOURCES) {
      // `_`-prefixed spellings are matched deliberately: pinning a bundler's
      // rename (`_MarketplaceProxyPlugin`) into the registry would make the
      // assertion above pass while restating the defect as a declaration.
      const classNames = src.identities.filter((id) => /^_*[A-Z][A-Za-z0-9_]*$/.test(id));
      expect(
        classNames,
        `${src.label} declares class-name identities other than '${src.export}' — ` +
          'an identity nothing is called can never match',
      ).toEqual([src.export]);
    }
  });
});
