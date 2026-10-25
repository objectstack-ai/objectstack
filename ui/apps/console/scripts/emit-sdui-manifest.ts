/**
 * Write the console's SDUI component manifest into a build output directory as
 * `sdui.manifest.json` (objectui#11403).
 *
 * The one generator is `packages/sdui-parser/scripts/gen-manifest.ts`: this
 * calls its `buildArtifacts` and serializes nothing itself, so the shipped file
 * is byte for byte what that generator writes for the registry loaded in this
 * process. The caller registers that registry first — the generator's
 * PREREQUISITE — by importing `../dev/manifest-registry.ts`.
 *
 * `buildArtifacts` writes two more files, `sdui-intrinsics.d.ts` and
 * `sdui-blocks.md`. Neither is asked of the Console's `dist` — objectui#11403
 * names the manifest alone — and `dist` is published, so the generator writes
 * into a scratch directory and only the manifest is copied out.
 */
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildArtifacts } from '../../../packages/sdui-parser/scripts/gen-manifest.ts';

export const SDUI_MANIFEST_FILE = 'sdui.manifest.json';

/** Returns the path written. */
export function emitSduiManifest(outDir: string): string {
  const scratch = mkdtempSync(join(tmpdir(), 'console-sdui-manifest-'));
  try {
    buildArtifacts(scratch);
    const target = join(outDir, SDUI_MANIFEST_FILE);
    copyFileSync(join(scratch, SDUI_MANIFEST_FILE), target);
    return target;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
