// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.

/**
 * The snippet gate (#4917).
 *
 * Every snippet this extension contributes is a metadata *producer*: whatever
 * it expands to is the first `.object.ts` / `.view.ts` an author ever writes.
 * Until this file existed nothing parsed that output, so the snippets drifted
 * out of the spec in silence — `os-view-grid` shipped `list.defaultSort` /
 * `list.pageSize` (keys `ListViewSchema` never declared), and the #4001
 * strictness batches turned that from a silent strip into a hard 422 without
 * anything going red. Four more snippets were equally stale.
 *
 * So the contract here is: **expand each snippet, then judge it with the same
 * schema the runtime uses.** Three independent ways to fail:
 *
 *  1. the expansion does not evaluate (a factory rejected it, or it is not
 *     valid TypeScript);
 *  2. the authored literal does not `safeParse` against its spec schema;
 *  3. it imports a binding `@objectstack/spec` does not export — the failure a
 *     runtime check cannot see, and the one five snippets were carrying.
 *
 * Plus two structural guards: every shipped snippet must be planned here (a new
 * snippet cannot arrive ungated), and the negative case must actually fail (a
 * gate nobody proved red is a gate that is green for the wrong reason).
 */

import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

import {
  collectImports,
  declaredExportSurface,
  evaluateSnippetModule,
  expandSnippetBody,
  readSnippets,
  type RawSnippet,
} from './snippet-harness.js';

/**
 * Just enough of a Zod schema to judge a snippet. Structural rather than
 * `import type { ZodType } from 'zod'`: the extension has no runtime dependency
 * on the spec (it ships snippets and a language client), and this gate should
 * not be the reason it acquires zod's type surface as a build input.
 */
interface ParsableSchema {
  safeParse(value: unknown): { success: true } | {
    success: false;
    error: { issues: ReadonlyArray<{ path: PropertyKey[]; message: string }> };
  };
}

const require = createRequire(import.meta.url);
const specRoot = require('@objectstack/spec') as Record<string, ParsableSchema>;
const specData = require('@objectstack/spec/data') as Record<string, ParsableSchema>;
const specUi = require('@objectstack/spec/ui') as Record<string, ParsableSchema>;
const specAutomation = require('@objectstack/spec/automation') as Record<string, ParsableSchema>;
const specAi = require('@objectstack/spec/ai') as Record<string, ParsableSchema>;

/**
 * What each snippet claims to scaffold, and which spec schema judges it.
 *
 * `kind: 'module'` — the snippet is a whole file; it must call a validating
 * factory, and the literal handed to that factory is what gets parsed.
 * `kind: 'field'` — the snippet is a fragment pasted inside an object's
 * `fields: { … }`; it is wrapped into a module and its one value parsed.
 */
interface SnippetPlan {
  kind: 'module' | 'field';
  schema: ParsableSchema;
  /** Human-readable name of the schema, for failure messages. */
  schemaName: string;
  /** For `module` snippets: the factory the snippet must go through. */
  factory?: string;
}

const PLANS: Record<string, SnippetPlan> = {
  'os-object': {
    kind: 'module', schema: specData.ObjectSchema, schemaName: 'Data.ObjectSchema',
    factory: 'ObjectSchema.create',
  },
  'os-field-text': { kind: 'field', schema: specData.FieldSchema, schemaName: 'Data.FieldSchema' },
  'os-field-select': { kind: 'field', schema: specData.FieldSchema, schemaName: 'Data.FieldSchema' },
  'os-field-lookup': { kind: 'field', schema: specData.FieldSchema, schemaName: 'Data.FieldSchema' },
  'os-view-grid': {
    kind: 'module', schema: specUi.ViewSchema, schemaName: 'UI.ViewSchema', factory: 'defineView',
  },
  'os-flow': {
    kind: 'module', schema: specAutomation.FlowSchema, schemaName: 'Automation.FlowSchema',
    factory: 'defineFlow',
  },
  'os-stack': {
    kind: 'module', schema: specRoot.ObjectStackDefinitionSchema,
    schemaName: 'ObjectStackDefinitionSchema', factory: 'defineStack',
  },
  'os-agent': {
    kind: 'module', schema: specAi.AgentSchema, schemaName: 'AI.AgentSchema', factory: 'defineAgent',
  },
};

const snippets = readSnippets();
const entries = Object.entries(snippets) as Array<[string, RawSnippet]>;

/** Wrap a `fields: { … }` fragment into a module the harness can evaluate. */
function asFieldModule(expanded: string): string {
  return `export default {\n${expanded}\n};`;
}

function formatIssues(schemaName: string, error: { issues: ReadonlyArray<{ path: PropertyKey[]; message: string }> }): string {
  return `${schemaName} rejected the expanded snippet:\n` +
    error.issues.map((i) => `  · ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
}

describe('VS Code snippets are valid ObjectStack metadata (#4917)', () => {
  it('plans every snippet the extension ships — a new snippet cannot arrive ungated', () => {
    const shipped = entries.map(([, s]) => s.prefix).sort();
    expect(Object.keys(PLANS).sort()).toEqual(shipped);
  });

  describe.each(entries)('%s', (_name, snippet) => {
    const plan = PLANS[snippet.prefix];
    const expanded = expandSnippetBody(snippet.body);

    it(`[${snippet.prefix}] expands to metadata ${plan.schemaName} accepts`, () => {
      const source = plan.kind === 'field' ? asFieldModule(expanded) : expanded;
      const evaluated = evaluateSnippetModule(source);

      let authored: unknown;
      if (plan.kind === 'field') {
        const fields = evaluated.exported as Record<string, unknown>;
        const keys = Object.keys(fields);
        expect(keys, 'a field snippet declares exactly one field').toHaveLength(1);
        authored = fields[keys[0]];
      } else {
        // The snippet must route through a validating factory, not a bare
        // `: Type` literal. A bare literal is precisely what `os-view-grid`
        // used to be — it type-annotated a shape nothing ever parsed, so the
        // spec could close two keys underneath it without a single diagnostic.
        const call = evaluated.calls.find((c) => c.factory === plan.factory);
        expect(
          call,
          `expected the snippet to author through \`${plan.factory}\`, but it called ` +
          `[${evaluated.calls.map((c) => c.factory).join(', ') || 'nothing'}]`,
        ).toBeDefined();
        authored = call!.config;
      }

      const result = plan.schema.safeParse(authored);
      if (!result.success) throw new Error(formatIssues(plan.schemaName, result.error));
      expect(result.success).toBe(true);
    });

    it(`[${snippet.prefix}] imports only bindings @objectstack/spec still exports`, () => {
      for (const imported of collectImports(expanded)) {
        expect(
          imported.specifier,
          'snippets may only import from @objectstack/spec',
        ).toMatch(/^@objectstack\/spec(\/|$)/);

        const surface = declaredExportSurface(imported.specifier);
        for (const binding of imported.named) {
          expect(
            surface.has(binding),
            `\`${binding}\` is not exported by '${imported.specifier}'. Root namespace ` +
            're-exports (Data / UI / AI / Automation …) were removed as untree-shakeable — ' +
            'import from the subpath instead (see packages/spec/src/index.ts).',
          ).toBe(true);
        }
      }
    });
  });

  /**
   * The `os-stack` scaffold stamps the protocol handshake range
   * (ADR-0087 D1), and a hardcoded major is exactly the kind of literal that
   * rots the way this whole issue rotted. `create-objectstack`'s template is
   * kept in lockstep by `scripts/sync-template-versions.mjs`, which does not
   * know about this file — so the lockstep is asserted here instead.
   */
  it('os-stack stamps the CURRENT protocol major in engines.protocol', () => {
    const major = (require('@objectstack/spec/package.json') as { version: string })
      .version.split('.')[0];
    const stack = entries.find(([, s]) => s.prefix === 'os-stack')![1];
    expect(stack.body.join('\n')).toContain(`engines: { protocol: '^${major}' }`);
  });
});

/**
 * Bidirectional proof. A gate is only worth its runtime if it goes red on the
 * thing it claims to catch, so re-introduce the exact #4917 defect — the keys
 * #4001 closed — and require a rejection. If this test starts passing "for
 * free", the gate above has stopped judging anything.
 */
describe('the gate rejects a stale snippet (negative control, #4917)', () => {
  const STALE_VIEW_BODY = [
    "import { defineView } from '@objectstack/spec';",
    '',
    'export const ${1:MyObject}Views = defineView({',
    "  object: '${2:my_object}',",
    '  list: {',
    "    type: 'grid',",
    "    columns: [{ field: 'name', width: 200 }],",
    "    defaultSort: { field: 'name', direction: 'asc' },",
    '    pageSize: 25,',
    '  },',
    '});',
  ];

  it('rejects `list.defaultSort` / `list.pageSize` — the keys #4001 closed', () => {
    const source = expandSnippetBody(STALE_VIEW_BODY);
    // `defineView` parses eagerly, so the stale shape throws before we even get
    // to safeParse — which is the behaviour an author sees, and the proof that
    // the positive tests above are not passing on an inert code path.
    expect(() => evaluateSnippetModule(source)).toThrowError(/defaultSort|pageSize/);
  });

  it('rejects an import binding the spec no longer exports', () => {
    const source = expandSnippetBody([
      "import { Data } from '@objectstack/spec';",
      '',
      'export const Broken = Data;',
    ]);
    const [imported] = collectImports(source);
    expect(declaredExportSurface(imported.specifier).has('Data')).toBe(false);
  });

  it('refuses a placeholder form the expander does not model', () => {
    expect(() => expandSnippetBody(['const f = ${TM_FILENAME};']))
      .toThrowError(/Unsupported snippet placeholder syntax/);
  });
});
