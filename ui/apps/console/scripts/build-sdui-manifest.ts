/**
 * Console build step (objectui#11403): ship `dist/sdui.manifest.json`, the SDUI
 * component manifest of the Console this build produced.
 *
 *   pnpm --filter @object-ui/console build   # runs this after `vite build`
 *
 * A host serving this Console registers that file under
 * `@objectstack/metadata-protocol`'s `SDUI_MANIFEST_SERVICE`, and its metadata
 * save door judges page sources against it (ADR-0080 §5). So it has to describe
 * THIS build's registry — not the framework's tracked repo-root copy, which
 * describes objectui at the framework's pin.
 *
 * Runs under Node through tsx and resolves every workspace package through its
 * `exports`, i.e. its built `dist` — the same built packages this package's
 * `tsc` step already type-checks against, and that turbo's `^build` (and every
 * CI and release caller of this script) builds from the same tree first. That
 * is why the step lives in the `build` script rather than in `vite.config.ts`:
 * the callers that run `vite build` directly (CI's E2E builds, `vercel.json`)
 * need no built packages, because the bundle aliases each one to its `src`,
 * and they never run this step.
 *
 * Plain Node has no loader for a `.css` side-effect import (plugin-dashboard,
 * plugin-map); each resolves to an empty module, the one accommodation needed.
 * The hook is registered before the registry is imported, which is why the
 * imports below are dynamic.
 */
import { existsSync } from 'node:fs';
import { register } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CSS_AS_EMPTY_MODULE =
  'export async function resolve(specifier, context, next) {\n' +
  '  if (specifier.endsWith(".css")) return { url: "data:text/javascript,", shortCircuit: true };\n' +
  '  return next(specifier, context);\n' +
  '}\n';

const distDir = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'dist');
if (!existsSync(join(distDir, 'index.html'))) {
  console.error(`✗ build-sdui-manifest: ${distDir} holds no index.html — run \`vite build\` first.`);
  process.exit(1);
}

register(`data:text/javascript,${encodeURIComponent(CSS_AS_EMPTY_MODULE)}`);
await import('../dev/manifest-registry.ts');
const { emitSduiManifest } = await import('./emit-sdui-manifest.ts');

const written = emitSduiManifest(distDir);
process.stdout.write(`✓ build-sdui-manifest: wrote ${written}\n`);
