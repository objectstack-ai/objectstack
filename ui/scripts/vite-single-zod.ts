// Build-time guard: the console bundle carries exactly ONE zod instance
// (objectui#11327).
//
// Two zod instances split zod's internals: a spec schema built by one and walked
// by the other (`z.toJSONSchema`) throws, and every spec-derived Studio form lost
// its fields — at the console pin objectui#11327 was reported against, the New
// Package dialog could not create a package. Two copies that happen to agree,
// even on a version, are still two instances, so the rule is ONE, not
// "matching".
//
// `resolve.dedupe` cannot deliver it, measured on objectui#11327 against the
// real console config: Vite resolves a deduped package from its ROOT, the
// console's root (`apps/console`) declares no `zod`, the root lookup finds
// nothing, and Vite silently falls back to the importer's own copy. So this
// guard MEASURES the outcome on the emitted chunks rather than trusting any
// mechanism, in every console build.
//
// Moved out of `vite-objectstack-spec-dist.ts` when that module's
// `OBJECTSTACK_SPEC_DIST` injection left with the objectstack pin
// (objectstack#25711): in the objectstack workspace the console's
// `@objectstack/*` are `workspace:^` links, so there is no out-of-tree spec to
// inject and no second install tree for zod to come from — but one lockfile can
// still resolve two zod versions, and this guard is what says so.

import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

/** The name `assertSingleZodInstance`'s plugin registers under. */
export const SINGLE_ZOD_GUARD_NAME = 'assert-single-zod-instance';

/**
 * The `zod` package directory a module id lives in, or `null`.
 *
 * The LAST `node_modules/zod/` segment wins, so pnpm's store path
 * (`…/.pnpm/zod@4.6.5/node_modules/zod/v4/core/core.js`) and a copy nested
 * under another package both answer with the directory that IS the package.
 * A sibling such as `zod-to-json-schema` does not match: the segment must be
 * exactly `zod`. A leading `\0` (a virtual-module marker) and a query are
 * dropped first, so one copy reached two ways is not counted twice.
 */
export function zodPackageDirOf(id: string): string | null {
  const match = /^(.*[\\/]node_modules[\\/]zod)[\\/]/.exec(id.replace(/^\0/, '').split('?')[0]);
  return match ? match[1] : null;
}

/** The minimal slice of a bundle `assertSingleZodInstance` reads. */
interface GuardOutput {
  type: string;
  fileName: string;
  modules?: Record<string, unknown>;
}

/** The minimal slice of the plugin context `assertSingleZodInstance` reads. */
interface GuardContext {
  error(message: string): never;
  getModuleInfo?(id: string): { importers?: readonly string[] } | null;
}

/**
 * Build-time guard: the console bundle carries exactly ONE zod instance.
 *
 * Counted on what the build EMITTED — every module id rendered into a chunk,
 * grouped by the `zod` package directory it lives in — never on how the
 * resolver was configured, because the configuration is exactly what fooled
 * the first fix attempt (see the file header). Two directories fail the build
 * naming each copy, its version, the chunks it landed in and who imported it;
 * two directories holding the SAME version fail too, since an instance is what
 * the crash keys on, not a version.
 *
 * Zero directories fail as well, as a counter-probe: the console always bundles
 * zod (the `@object-ui/types` validators, the metadata-admin schema modules), so
 * zero means this matcher has gone blind, and a negative guard that cannot see
 * its subject would read green forever — the shape `assertLazyLinterStaysLazy`
 * in the console config refuses for the same reason.
 */
export function assertSingleZodInstance(): Plugin {
  return {
    name: SINGLE_ZOD_GUARD_NAME,
    apply: 'build',
    generateBundle(_options, bundle) {
      const context = this as unknown as GuardContext;
      const copies = new Map<string, { chunks: Set<string>; importers: Set<string> }>();
      let chunkCount = 0;
      for (const output of Object.values(bundle as Record<string, GuardOutput>)) {
        if (output.type !== 'chunk') continue;
        chunkCount += 1;
        for (const id of Object.keys(output.modules ?? {})) {
          const dir = zodPackageDirOf(id);
          if (!dir) continue;
          const copy = copies.get(dir) ?? { chunks: new Set<string>(), importers: new Set<string>() };
          copies.set(dir, copy);
          copy.chunks.add(output.fileName);
          for (const importer of context.getModuleInfo?.(id)?.importers ?? []) {
            if (zodPackageDirOf(importer) !== dir) copy.importers.add(importer);
          }
        }
      }

      if (copies.size === 0) {
        context.error(
          `[${SINGLE_ZOD_GUARD_NAME}] counter-probe failed: none of the ${chunkCount} chunks holds a module ` +
            `under a \`node_modules/zod/\` directory, so this guard can no longer fail. The console always ` +
            `bundles zod (the \`@object-ui/types\` validators, the metadata-admin schema modules), so zero ` +
            `is a statement about this matcher — zod reached through a path without that segment — never ` +
            `a clean bundle (objectui#11327)`
        );
      }
      if (copies.size > 1) {
        const lines = [...copies.entries()].map(([dir, copy]) => {
          let version = '?';
          try {
            version = String(
              (JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as { version?: unknown }).version
            );
          } catch {
            // The listing still names the directory; the version is a courtesy.
          }
          const importers = [...copy.importers].slice(0, 3);
          return (
            `  - zod ${version} at \`${dir}\` — in ${[...copy.chunks].join(', ')}` +
            (importers.length > 0 ? `; imported by ${importers.join(', ')}` : '')
          );
        });
        context.error(
          `[${SINGLE_ZOD_GUARD_NAME}] the console bundle carries ${copies.size} zod instances and must ` +
            `carry exactly one (objectui#11327):\n${lines.join('\n')}\n` +
            `A schema built by one instance and walked by another holds only while their internals happen ` +
            `to agree — when they did not, \`z.toJSONSchema\` over a spec schema threw and the Studio's ` +
            `spec-derived forms lost their fields — and two copies that agree, even on a version, are ` +
            `still two instances. The workspace lockfile resolves zod twice for the console's closure; ` +
            `dedupe it. Adding \`zod\` to ` +
            `\`resolve.dedupe\` is not a fix: the console root declares no zod, so Vite falls back to each ` +
            `importer's own copy without a word.`
        );
      }
    },
  };
}
