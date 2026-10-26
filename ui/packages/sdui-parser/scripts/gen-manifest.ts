/**
 * Build-time codegen (ADR-0080 M4): serialize the registry's CONTRACT surface into
 *   - sdui.manifest.json   (the contract — save-gate + parser whitelist)
 *   - sdui-intrinsics.d.ts (the JSX type surface for authoring)
 *   - sdui-blocks.md       (the human 清单)
 *
 * `getPublicConfigs()` returns two tiers (objectui#10735): the curated PUBLIC
 * tier (`PUBLIC_BLOCKS`), and the html tier's registered intrinsic elements
 * (`HTML_TIER_INTRINSICS`) stamped `tier: 'html'`. The manifest carries both —
 * a `kind:'html'` page may author `<h1>` / `<p>` / `<a>` and the gate that
 * whitelists its tags reads this file — and the stamp is what keeps the second
 * tier out of the curated vocabulary: the block list sections on it, the
 * `kind:'react'` scope skips it. Nothing here filters; the marker travels.
 *
 * PREREQUISITE: all plugins must be EAGERLY registered before this runs —
 * import the app's plugin modules first so getPublicConfigs() sees the full
 * set with its `inputs`, e.g.:
 *   import '@object-ui/plugin-kanban';   // side-effectful registration
 * A plugin that is only lazily registered has no renderer and no `inputs` yet;
 * `assertFullyLoaded` fails the build rather than emitting it as a propless
 * block. Then run with tsx. Mirrors the build-skill-docs pattern.
 */
import { writeFileSync } from 'node:fs';
import { ComponentRegistry } from '@object-ui/core';
import { nodeSlotsFor } from '@object-ui/types';
import { assertFullyLoaded, generateBlockList, generateDts, manifestFromConfigs, type RegistryConfigLike } from '../src/index.js';

export function buildArtifacts(outDir: string): void {
  const configs = ComponentRegistry.getPublicConfigs() as unknown as RegistryConfigLike[];
  assertFullyLoaded(configs);
  // `slotsFor` (objectui#11170): every entry carries the node slots its renderer
  // reads besides `children`, from the one declaration in `@object-ui/types`, so
  // the shipped manifest lets `validateTree` judge slot-held nodes.
  const manifest = manifestFromConfigs(configs, { slotsFor: nodeSlotsFor });
  writeFileSync(`${outDir}/sdui.manifest.json`, JSON.stringify(manifest, null, 2));
  writeFileSync(`${outDir}/sdui-intrinsics.d.ts`, generateDts(manifest));
  writeFileSync(`${outDir}/sdui-blocks.md`, generateBlockList(manifest));
}
