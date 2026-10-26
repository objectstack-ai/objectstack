// Hook parameters are annotated explicitly throughout: Vite types each hook as
// `ObjectHook<Fn>` (a function-or-object union), and TypeScript cannot
// contextually infer parameters across such a union — same reason
// `scripts/vite-declared-lazy-views.ts` spells its types out.
import type { Plugin, Rollup } from 'vite';

/**
 * Keeps the `types-zod` chunk OUT of the console's eager closure and INSIDE
 * `plugin-map`'s reach, and fails the build when either half stops holding
 * (objectui#10065).
 *
 * ## The measurement this exists for
 *
 * `advancedChunks`'s `framework` group claims every `packages/types/` module
 * wherever it is reached from, and that chunk is eager because `core` and
 * `react` are reached from the entry. Measured on `0c2eb5eee` from the console
 * build's own visualizer: the nine `packages/types/src/zod/**` modules rolldown
 * emitted were 140,541 rendered bytes of a 372,430-byte `framework` chunk,
 * while their ONE live consumer in that bundle —
 * `packages/plugin-map/src/ObjectMap.tsx`, importing `ObjectMapConfigSchema`
 * from `@object-ui/types/zod` — sat in a chunk the eager walk never enters. So
 * every page load fetched validators only the object-map view reads.
 *
 * The console config now gives that directory its own group. This guard is what
 * makes the result a property of the BUNDLE rather than of a regex.
 *
 * ## Why the reachability half is stated FIRST
 *
 * The two failures are not symmetric in how they present.
 *
 * A chunk that rejoins the eager closure is loud: the per-chunk budget in
 * `scripts/check-eager-closure-budget.mjs` weighs it, the aggregate moves, and
 * somebody reads a bigger number. That half is checked here anyway, because the
 * budget answers "how many bytes" and never "which boundary broke".
 *
 * A chunk that stops being REACHABLE is silent, and it is silent in the
 * flattering direction. If the validators are dropped from the graph entirely —
 * a `sideEffects` declaration that shakes too hard, an import rewritten to
 * `import type`, a group whose test starts matching nothing — the eager closure
 * gets SMALLER, every byte ceiling goes greener, and the object-map view throws
 * at runtime for a schema that is no longer in the bundle. A saving and a
 * deletion look identical from the byte side. They do not look identical from
 * here.
 *
 * ⇒ this file asserts that the validators are STILL THERE and still reached
 * through the map view's own lazy boundary, and only then that the boundary is
 * still a boundary.
 *
 * ## Every probe below fails CLOSED
 *
 * Both verdicts are NEGATIVE or conditional on a match, so a matcher that
 * matches nothing agrees with a correct bundle on both. The three counter-probes
 * refuse a verdict rather than publish one — the same refusal
 * `assertLazyLinterStaysLazy` and `emitEagerClosureReport` make in the console
 * config, and for the same reason: a walk that finds too little produces good
 * news.
 */

/** The subject: the validator modules that must stay lazy and stay reachable. */
export const TYPES_ZOD_TEST = /[\\/]packages[\\/]types[\\/]src[\\/]zod[\\/]/;

/**
 * The only live consumer of {@link TYPES_ZOD_TEST} in the console bundle.
 *
 * ⚠️ Named as a package directory rather than as `ObjectMap.tsx` alone: the
 * validators are reachable from the map view whichever of that package's
 * modules does the importing, and pinning one file would red on a refactor
 * that moved the import next door without changing anything this guard is
 * about.
 */
export const CONSUMER_TEST = /[\\/]packages[\\/]plugin-map[\\/]src[\\/]/;

/**
 * A module that is eager BY CONSTRUCTION — nothing in the console renders
 * without react-dom, and `advancedChunks` routes it to `vendor-react`, so it is
 * a known member of the eager closure that is not the entry chunk. If the walk
 * cannot see it, the walk is wrong and its "not eager" verdict means nothing.
 */
export const EAGER_WALK_CONTROL = /[\\/]node_modules[\\/]react-dom[\\/]/;

/** One emitted chunk, reduced to what this guard reads. */
export interface ChunkFacts {
  fileName: string;
  isEntry: boolean;
  /** STATIC imports only — `dynamicImports` is the boundary under test. */
  imports: readonly string[];
  moduleIds: readonly string[];
}

export interface TypesZodVerdict {
  ok: boolean;
  /** Printed on success; the failure text otherwise. */
  message: string;
}

/**
 * The module graph, narrowed to the one question the failure text needs:
 * which modules import this one STATICALLY.
 *
 * Chunk-level `imports` says WHICH FILE pulled the validators back onto the
 * eager line; it cannot say which source module did, and that is the only fact
 * an author can act on. objectui#10065's own first counterfactual build is why
 * this parameter exists: the chunk-level message named `plugin-grid` and the
 * source-level cause was not in `packages/plugin-grid/` at all.
 */
export type StaticImportersOf = (moduleId: string) => readonly string[];

export function chunkFactsFrom(bundle: Rollup.OutputBundle): ChunkFacts[] {
  const facts: ChunkFacts[] = [];
  for (const output of Object.values(bundle)) {
    if (output.type !== 'chunk') continue;
    facts.push({
      fileName: output.fileName,
      isEntry: output.isEntry,
      imports: output.imports ?? [],
      moduleIds: Object.keys(output.modules ?? {}),
    });
  }
  return facts;
}

/** Chunks reachable from `seeds` by STATIC imports, `seeds` included. */
function closure(chunks: ReadonlyMap<string, ChunkFacts>, seeds: readonly string[]): Set<string> {
  const reached = new Set<string>();
  const queue = [...seeds];
  while (queue.length > 0) {
    const fileName = queue.pop() as string;
    if (reached.has(fileName)) continue;
    reached.add(fileName);
    for (const imported of chunks.get(fileName)?.imports ?? []) {
      if (!reached.has(imported)) queue.push(imported);
    }
  }
  return reached;
}

/**
 * The whole policy, as a pure function over the emitted chunks — so the
 * verdicts are exercisable without a console build, the same split
 * `scripts/check-eager-closure-budget.mjs` keeps from `emitEagerClosureReport`'s
 * walk.
 */
export function judgeTypesZodLazy(
  facts: readonly ChunkFacts[],
  importersOf?: StaticImportersOf,
): TypesZodVerdict {
  const chunks = new Map(facts.map((c) => [c.fileName, c]));
  const holding = (test: RegExp): string[] =>
    facts.filter((c) => c.moduleIds.some((id) => test.test(id))).map((c) => c.fileName);

  const eager = closure(chunks, facts.filter((c) => c.isEntry).map((c) => c.fileName));
  const zodChunks = holding(TYPES_ZOD_TEST);
  const consumerChunks = holding(CONSUMER_TEST);

  // Counter-probe 1 — the subject must be SOMEWHERE in this bundle.
  if (zodChunks.length === 0) {
    return {
      ok: false,
      message:
        `counter-probe failed: no chunk at all — eager or lazy — holds a module matching ` +
        `${TYPES_ZOD_TEST}, so both verdicts below are statements about this regex and not ` +
        `about the graph. The validators are reached from ObjectMap.tsx's import of ` +
        `\`@object-ui/types/zod\`, so they belong in this bundle: either that import is gone ` +
        `(retire this guard deliberately rather than leave one with no subject), or the ` +
        `module ids changed shape — the console aliases \`@object-ui/types\` to the package's ` +
        `\`src\`, and a build that resolves it to \`dist\` instead matches neither this regex ` +
        `nor the \`types-zod\` group in the console config. (chunks: ${facts.length})`,
    };
  }

  // Counter-probe 2 — the consumer must be somewhere too, or the reachability
  // verdict has no origin to walk from and would read as "unreachable" for a
  // reason that has nothing to do with the boundary.
  if (consumerChunks.length === 0) {
    return {
      ok: false,
      message:
        `counter-probe failed: no chunk at all holds a module matching ${CONSUMER_TEST}, so ` +
        `the reachability verdict below has nothing to walk from. \`@object-ui/plugin-map\` is ` +
        `registered by the console, so it belongs in this bundle; its absence means the ids ` +
        `changed shape or the plugin was dropped. (chunks: ${facts.length})`,
    };
  }

  // Counter-probe 3 — the eager walk must see something eager by construction.
  const controlChunks = holding(EAGER_WALK_CONTROL);
  if (!controlChunks.some((fileName) => eager.has(fileName))) {
    return {
      ok: false,
      message:
        `counter-probe failed: no eagerly loaded chunk holds a \`react-dom\` module. React is ` +
        `reached synchronously from the app entry, so it must be in the eager closure — its ` +
        `absence means this walk is reading the graph wrongly, not that the bundle improved. ` +
        `A walk that finds too little reports "nothing is eager", which is exactly the verdict ` +
        `this guard would otherwise publish as good news. ` +
        `(chunks holding it: ${controlChunks.join(', ') || 'NONE'}; ` +
        `eager: ${eager.size}/${facts.length})`,
    };
  }

  // Verdict 1 — REACHABILITY, stated first. Deferred bytes and deleted bytes
  // are the same number from the budget's side; they are not the same here.
  const fromConsumer = closure(chunks, consumerChunks);
  const orphaned = zodChunks.filter((fileName) => !fromConsumer.has(fileName));
  if (orphaned.length > 0) {
    return {
      ok: false,
      message:
        `the \`@object-ui/types/zod\` validators are NO LONGER REACHABLE from ` +
        `\`@object-ui/plugin-map\`: ${orphaned.join(', ')} holds them, and no chunk holding a ` +
        `plugin-map module reaches it through static imports ` +
        `(plugin-map chunks: ${consumerChunks.join(', ')}).\n\n` +
        `This is the failure that LOOKS like a saving. ObjectMap.tsx parses its config with ` +
        `\`ObjectMapConfigSchema\`; if the schema is no longer in the graph the object-map view ` +
        `throws at runtime, while every byte ceiling in ` +
        `\`scripts/check-eager-closure-budget.mjs\` reports a smaller, greener bundle. ` +
        `Check what stopped reaching it — a \`sideEffects\` declaration that shakes too hard, ` +
        `an import narrowed to \`import type\`, or a group whose test stopped matching — ` +
        `before reading any number this build produced.`,
    };
  }

  // Verdict 2 — LAZINESS. The bytes must leave the eager closure, not move to
  // another eager line.
  const eagerZod = zodChunks.filter((fileName) => eager.has(fileName));
  if (eagerZod.length > 0) {
    const why = eagerZod.flatMap((fileName) => {
      const importers = facts
        .filter((c) => eager.has(c.fileName) && c.imports.includes(fileName))
        .map((c) => c.fileName);
      const lines = [
        `  ${fileName} — statically imported by ` +
          (importers.join(', ') ||
            (chunks.get(fileName)?.isEntry
              ? 'nothing (it IS an entry chunk)'
              : 'NOTHING, so chunk grouping put it in the closure rather than an import edge')),
      ];
      // The SOURCE edge, when the graph is available. A chunk file name names
      // the co-tenant, not the cause; these lines name the cause.
      if (importersOf) {
        for (const moduleId of chunks.get(fileName)?.moduleIds ?? []) {
          const outside = importersOf(moduleId).filter((id) => !TYPES_ZOD_TEST.test(id));
          for (const importer of outside) lines.push(`      ${moduleId}  <-  ${importer}`);
        }
      }
      return lines;
    });
    return {
      ok: false,
      message:
        `the \`@object-ui/types/zod\` validators are back in the EAGER closure, so every ` +
        `console page load fetches them again — 140,541 rendered bytes when objectui#10065 ` +
        `measured them, for a view most sessions never open:\n${why.join('\n')}\n\n` +
        `A chunk is eager as soon as ANY chunk in the eager closure imports it statically. ` +
        `The usual cause is a new static edge from an eagerly reached module into ` +
        `\`packages/types/src/zod/\` — an \`import type\` that became a value import is enough. ` +
        `⛔ Do not answer this by widening a ceiling: the bytes are the remedy, and the ` +
        `\`types-zod\` group in the console config exists to keep them off the budgeted line.`,
    };
  }

  return {
    ok: true,
    message:
      `\`@object-ui/types/zod\` is lazy and still reachable: ${zodChunks.length} chunk(s) ` +
      `holding the validators, none in the eager closure ` +
      `(${eager.size}/${facts.length} chunks eager), all reached from ` +
      `${consumerChunks.length} \`@object-ui/plugin-map\` chunk(s). Why this is guarded in both ` +
      `directions: scripts/vite-types-zod-lazy.ts`,
  };
}

export function viteTypesZodLazy(): Plugin {
  return {
    name: 'assert-types-zod-stays-lazy',
    generateBundle(_outputOptions, bundle: Rollup.OutputBundle) {
      const importersOf: StaticImportersOf = (moduleId) =>
        (this.getModuleInfo(moduleId)?.importers ?? []) as readonly string[];
      const verdict = judgeTypesZodLazy(chunkFactsFrom(bundle), importersOf);
      if (!verdict.ok) this.error(`[assert-types-zod-stays-lazy] ${verdict.message}`);
      this.info(verdict.message);
    },
  };
}
