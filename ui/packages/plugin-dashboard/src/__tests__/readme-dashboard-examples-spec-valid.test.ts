/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Every dashboard example on this package's front page must survive the SHIPPED
 * contract — `@object-ui/types/zod`'s `DashboardComponentSchema`, the
 * tolerant mirror whose strict twin `objectui validate` runs.
 *
 * ## The hole this closes (objectui#7035)
 *
 * The README taught two widgets spelled `type: 'card'` with a nested `body`.
 * `'card'` is not a member of `DashboardWidgetTypeName` — the vocabulary
 * objectui#4600 closed — so `DashboardComponentSchema.safeParse` refused the
 * whole document, and a reader who copied the block got a rejection. Three
 * gates were green on it the whole time, each for a stated reason:
 *
 *   - `check:doc-snippets` compiles fenced `ts` against the built `dist/`, and
 *     these blocks are untyped `const schema = { … }` literals, so nothing was
 *     annotated for tsc to refuse. Its own header names schema-key validity as
 *     the question it does NOT answer.
 *   - `check:doc-types` asks whether a `type` literal names a REGISTERED
 *     component, and its surface is `content/docs/**` plus the root README —
 *     package READMEs are outside it. (`card` is registered anyway; what
 *     rejected the widget was the widget vocabulary, not the registry.)
 *   - `check:readme-exports` judges import bindings, not metadata literals.
 *
 * So the one question nobody was asking is the one this file asks: does the
 * example still validate. It is deliberately narrow — this document only.
 *
 * ## Why the blocks are evaluated rather than parsed as JSON
 *
 * They are TypeScript object literals with comments and trailing prose, not
 * JSON. Evaluating them is what keeps this test reading the BYTES a reader
 * copies instead of a hand-maintained twin that drifts from the page.
 *
 * A block this harness cannot evaluate FAILS — it is never skipped. An
 * unexaminable block that reads as a clean one is the failure shape the doc
 * gate family exists to prevent (objectui#4846), and the fix when a new block
 * needs an ambient name is to add it to `AMBIENT` below, deliberately.
 *
 * `plugin-gantt`'s `readme-navigation-example.test.ts` is the same idea one
 * package over — its README's `json` fence against the shipped navigation
 * schema — so this is that pattern applied here, not a new one.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { DashboardComponentSchema } from '@object-ui/types/zod';

const README = resolve(dirname(fileURLToPath(import.meta.url)), '../../README.md');

/**
 * Names a block uses without declaring — supplied so the literal can be
 * evaluated. Values are inert stand-ins: this test asks about the SHAPE the
 * page teaches, not about what an adapter returns.
 */
const AMBIENT: Record<string, unknown> = {
  createObjectStackAdapter: () => ({ kind: 'stub-datasource' }),
};

interface Block {
  heading: string;
  /** 1-based line of the block's first code line, for a failure message that points at the page. */
  line: number;
  source: string;
}

function dashboardBlocks(markdown: string): Block[] {
  const lines = markdown.split('\n');
  const blocks: Block[] = [];
  let heading = '(top)';
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('#')) heading = lines[i].replace(/^#+\s*/, '');
    if (!lines[i].startsWith('```')) continue;
    const end = lines.indexOf('```', i + 1);
    if (end === -1) break;
    const source = lines.slice(i + 1, end).join('\n');
    if (/const\s+schema\b/.test(source) && /type:\s*'dashboard'/.test(source)) {
      blocks.push({ heading, line: i + 2, source });
    }
    i = end;
  }
  return blocks;
}

/** Strip the TypeScript a bare `new Function` cannot read, leaving the literal. */
function toEvaluable(source: string): string {
  return source
    .split('\n')
    .filter((l) => !/^\s*import\b/.test(l))
    .join('\n')
    // `declare const widgets: DashboardWidgetSchema[];` — a declared-elsewhere
    // array the block spreads into `widgets`.
    .replace(/^\s*declare\s+const\s+(\w+)\s*:[^=;]*;/gm, 'const $1 = [];')
    // `type MetricCardEntry = { … } & ComponentProps<…>;` — a one-line type
    // alias the block annotates with; types carry no value (objectui#10859
    // batch 8 put the Metric Card example inside a dashboard, so it is judged).
    .replace(/^\s*type\s+\w+\s*=[^;]*;/gm, '')
    // `const schema: DashboardComponentSchema = {` — drop the annotation.
    .replace(/^(\s*const\s+\w+)\s*:\s*[\w<>[\]| ]+\s*=/gm, '$1 =');
}

const blocks = dashboardBlocks(readFileSync(README, 'utf8'));

describe('plugin-dashboard README dashboard examples', () => {
  // A silent zero would make every assertion below vacuous — the extractor
  // failing is indistinguishable from the page being clean without this.
  it('finds the dashboard examples to judge', () => {
    expect(blocks.length).toBeGreaterThanOrEqual(6);
  });

  it.each(blocks.map((b) => [`:${b.line} ${b.heading}`, b] as const))(
    '%s validates against the shipped DashboardComponentSchema',
    (_label, block) => {
      // Not wrapped in a try/catch: the evaluator's own error names the
      // offending identifier and is thrown from this line, and the test's own
      // name already carries the README line and heading — which is louder
      // than anything a re-throw could add. (A wrapper would also have to
      // attach the caught error as a `cause` to satisfy `preserve-caught-error`,
      // and `Error.cause` is ES2022 — above this project's ES2020 lib. Same
      // reasoning, same route as `plugin-gantt`'s README example test.)
      //
      // A block that throws here therefore FAILS. That is the point: the fix is
      // to add the name it needs to `AMBIENT`, deliberately.
      const doc: unknown = new Function(
        ...Object.keys(AMBIENT),
        `${toEvaluable(block.source)}\n; return schema;`,
      )(...Object.values(AMBIENT));

      const result = DashboardComponentSchema.safeParse(doc);
      const issues = result.success
        ? ''
        : result.error.issues
            .map((i) => `${i.code} at widgets${i.path.slice(1).join('.')}: ${i.message}`)
            .join('; ');
      expect(issues, `README.md:${block.line} ("${block.heading}") is refused`).toBe('');
      expect(result.success).toBe(true);
    },
  );
});
