// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The knowledge base's settings surface, contributed WITH the service.
 *
 * The knowledge base is not a default capability: no deployment loads
 * `KnowledgeServicePlugin` unless its host mounts it. Its settings used to be
 * registered by `@objectstack/service-settings` on every boot all the same —
 * the `knowledge` namespace, the `ai` namespace's embedder section, both
 * "Test" buttons and the Setup entry — so every deployment showed a Knowledge
 * page, an "Embedder" section and a test button with no service behind them.
 * They now live and die with the service, the way the branding entry lives
 * with its namespace and the "Connect an AI Assistant" page with the MCP
 * capability: a deployment without this plugin serves none of them (a read or
 * write of `knowledge` answers `404 UNKNOWN_NAMESPACE`, a write of an
 * `embedder_*` key `400 UNKNOWN_KEY`), and one with it serves all of them.
 *
 * Called from `KnowledgeServicePlugin.init()`, which declares the settings
 * plugin in `optionalDependencies`: the kernel inits that plugin first when it
 * is present, so "no `settings` service" here is a fact about the composition,
 * not a guess taken while the registry is still filling.
 */

import type { PluginContext } from '@objectstack/core';
import {
  knowledgeSettingsManifest,
  knowledgeTestActionHandler,
  aiSettingsManifest,
  withAiEmbedderSection,
  aiEmbedderSettingsSpecifiers,
  aiTestEmbedderActionHandler,
  type SettingsService,
} from '@objectstack/service-settings';

/** The Setup bundle this contribution registers under. */
export const KNOWLEDGE_SETUP_NAV_BUNDLE_ID = 'com.objectstack.service.knowledge.setup-nav';

/**
 * The Setup entry for the `knowledge` namespace. Its label stays keyed
 * `apps.setup.navigation.nav_settings_knowledge` in `@objectstack/platform-objects`'
 * bundles, where the console resolves every Setup entry, contributed or static.
 * A factory, not a shared literal: the nav fold pushes contributed items into
 * the merged tree by reference.
 */
export function knowledgeSetupNavItem(): Record<string, unknown> {
  return {
    id: 'nav_settings_knowledge',
    type: 'url',
    label: 'Knowledge',
    url: '/apps/setup/system/settings/knowledge',
    icon: 'book-open',
    requiredPermissions: ['manage_platform_settings'],
  };
}

type SettingsSlot = Pick<SettingsService, 'registerManifest' | 'registerAction' | 'getManifest'>;

function keysOf(manifest: { specifiers: ReadonlyArray<{ key?: string }> }): Set<string> {
  return new Set(manifest.specifiers.map((s) => s.key).filter((k): k is string => typeof k === 'string'));
}

function embedderKeys(): string[] {
  return aiEmbedderSettingsSpecifiers.map((s) => s.key).filter((k): k is string => typeof k === 'string');
}

/** What {@link contributeKnowledgeSettings} offered on this boot. */
export interface KnowledgeSettingsContribution {
  knowledge: boolean;
  embedder: boolean;
  nav: boolean;
}

/**
 * Register the knowledge settings surface on the composition's settings
 * service, and its Setup entry on the manifest service. A composition with no
 * settings service gets none of it, Setup entry included: the entry would open
 * a page the server does not serve.
 */
export function contributeKnowledgeSettings(ctx: PluginContext, version: string): KnowledgeSettingsContribution {
  const offered: KnowledgeSettingsContribution = { knowledge: false, embedder: false, nav: false };
  let settings: SettingsSlot | undefined;
  try {
    settings = ctx.getService<SettingsSlot>('settings');
  } catch {
    // No settings service: nothing claims a settings UI for the knowledge base.
    return offered;
  }
  if (!settings || typeof settings.registerManifest !== 'function') return offered;

  settings.registerManifest(knowledgeSettingsManifest);
  settings.registerAction('knowledge', 'test', knowledgeTestActionHandler);
  offered.knowledge = true;

  // The embedder section joins the `ai` namespace — the bundled one only,
  // recognised by its keys, and registered from its DECLARATION
  // (`aiSettingsManifest`), never from the served copy `getManifest` returns
  // (that copy carries option-source tables in place of declared ones). A host
  // that registered its own `ai` manifest keeps it untouched and is told why
  // it has no embedder keys; one whose `ai` already declares them keeps those.
  let ai: ReturnType<SettingsSlot['getManifest']> | undefined;
  try {
    ai = settings.getManifest('ai');
  } catch {
    ai = undefined;
  }
  const served = ai ? keysOf(ai) : new Set<string>();
  const bundled = keysOf(aiSettingsManifest);
  const declaresEmbedder = aiEmbedderSettingsSpecifiers.some((s) => s.key !== undefined && served.has(s.key));
  const isBundled = served.size === bundled.size && [...bundled].every((k) => served.has(k));
  if (ai && (declaresEmbedder || isBundled)) {
    if (!declaresEmbedder) settings.registerManifest(withAiEmbedderSection(aiSettingsManifest));
    settings.registerAction('ai', 'test_embedder', aiTestEmbedderActionHandler);
    offered.embedder = true;
  } else {
    ctx.logger?.warn?.(
      `KnowledgeServicePlugin: ${ai ? "the registered 'ai' settings namespace is not the bundled one" : "no 'ai' settings namespace is registered"}, ` +
        `so the embedder settings (${embedderKeys().join(', ')}) are not offered. ` +
        "Declare them in the host's 'ai' manifest (aiEmbedderSettingsSpecifiers) to configure an embedder from Setup.",
    );
  }

  let manifestService: { register?(m: unknown): void } | undefined;
  try {
    manifestService = ctx.getService<{ register?(m: unknown): void }>('manifest');
  } catch {
    // No manifest service (lean kernels, tests): no app registry to contribute to.
    return offered;
  }
  if (typeof manifestService?.register !== 'function') return offered;
  manifestService.register({
    id: KNOWLEDGE_SETUP_NAV_BUNDLE_ID,
    namespace: 'sys',
    version,
    type: 'plugin',
    scope: 'system',
    name: 'Knowledge Service — Setup entries',
    description: 'Setup navigation for the knowledge settings, offered only where the knowledge service is mounted.',
    navigationContributions: [
      // After platform-objects' Configuration entries (priority 100).
      { app: 'setup', group: 'group_configuration', priority: 110, items: [knowledgeSetupNavItem()] },
    ],
  });
  offered.nav = true;
  return offered;
}
