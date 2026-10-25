/* ADR-0080: headless dump of the public-tier component manifest.
 * Registers everything the console does, then serializes getPublicConfigs().
 *
 * The registration graph — `src/register-plugins.ts` plus every plugin loaded
 * eagerly, and why the two lists must agree — is `./manifest-registry.ts`. The
 * console build reads the same module when it writes `dist/sdui.manifest.json`
 * (objectui#11403), so this page and the shipped manifest load one list. */
import './manifest-registry';
import { ComponentRegistry } from '@object-ui/core';
import { assertFullyLoaded, manifestFromConfigs } from '@object-ui/sdui-parser';
import { nodeSlotsFor } from '@object-ui/types';

const out = document.getElementById('out')!;
const win = window as unknown as { __MANIFEST?: string; __MANIFEST_ERROR?: string };

try {
  const configs = ComponentRegistry.getPublicConfigs() as never;
  assertFullyLoaded(configs);
  // `slotsFor` (objectui#11170): the dumped manifest carries each entry's node
  // slots from the one declaration in `@object-ui/types`, as the shipped
  // `sdui.manifest.json` does.
  const json = JSON.stringify(manifestFromConfigs(configs, { slotsFor: nodeSlotsFor }), null, 2);
  out.textContent = json;
  win.__MANIFEST = json;
} catch (err) {
  // Surface the failure instead of leaving `__MANIFEST` unset — the dump script
  // waits for one of these two, and would otherwise just time out with no clue.
  const message = err instanceof Error ? err.message : String(err);
  out.textContent = message;
  win.__MANIFEST_ERROR = message;
}
