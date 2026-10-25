/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The slotted-pages guide's "customize only the header" example writes a
 * `page:header` node the contract accepts (objectui#11165).
 *
 * ## The hole this closes
 *
 * `content/docs/guide/slotted-pages.md` taught `slots.header` with two keys
 * `PageHeaderProps` refuses: `eyebrow`, which it never declared, and `icon`,
 * an ADR-0087 D2 tombstone (no renderer ever read it). A reader who copied the
 * example got a node `safeValidateSchema` refuses, and the docs gates were
 * green on it the whole time:
 *
 *   - `check:doc-snippets` compiles the fence against the `Page` type, and
 *     that type carries a component's `properties` as an open record, so
 *     nothing in the annotation refuses a key inside it.
 *   - The whole page parses green under `@objectstack/spec`'s `PageSchema`
 *     too, for the same reason: the page shape does not judge a component's
 *     `properties` by its `type`. Only the component's own row does, so that
 *     row is what this file asks.
 *
 * ## Why the node is read from the page rather than restated here
 *
 * A hand-copied twin of the example would stay green while the page drifts.
 * The fence under the section heading is evaluated instead, the way
 * `plugin-dashboard`'s `readme-dashboard-examples-spec-valid.test.ts` reads its
 * README: drop the `import type` line and the `: Page` annotation, then
 * evaluate the literal. A fence this harness cannot find or evaluate FAILS; it
 * is never skipped.
 *
 * ## What is pinned
 *
 *   1. The example's header node passes objectui's schema mirror
 *      (`safeValidateSchema`, the tolerant face).
 *   2. Its `properties` pass the spec row `ComponentPropsMap['page:header']`
 *      in a FULL parse, so values are judged as well as keys.
 *   3. CONTROL: the same node with `eyebrow` and `icon` put back, which is the
 *      node the page taught before objectui#11165, is refused by both judges on
 *      exactly those two keys. Without it, a judge that stopped judging would
 *      pass 1 and 2 as well.
 *
 * The example carried `breadcrumb: true` until the `@objectstack/spec` 17.6.0
 * bump (objectui#11438), when the contract began refusing it by name
 * (objectstack#20758); it left the example then. This file only asks that
 * every key the example writes is one the contract accepts today.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { safeValidateSchema } from '@object-ui/types/zod';
import { ComponentPropsMap } from '@objectstack/spec/ui';

// Rooted at this file, never at the cwd (AGENTS.md: a test that reads the
// filesystem roots at its own file). Same spelling as
// `catalog-gallery-render.test.tsx` in this directory.
const SELF_DEPTH_BELOW_REPO_ROOT = 4; // examples / schema-catalog / test / this file
const REPO_ROOT = decodeURIComponent(new URL(import.meta.url).pathname)
  .split('/')
  .slice(0, -SELF_DEPTH_BELOW_REPO_ROOT)
  .join('/');
const GUIDE = join(REPO_ROOT, 'content/docs/guide/slotted-pages.md');
const HEADING = '## Example: customize only the header';

interface HeaderNode {
  type?: unknown;
  properties?: Record<string, unknown>;
  [key: string]: unknown;
}

/** The first `ts` fence inside the section, or a thrown error naming what was missing. */
function exampleSource(markdown: string): string {
  const section = markdown.indexOf(`\n${HEADING}\n`);
  if (section === -1) throw new Error(`slotted-pages.md has no "${HEADING}" section`);
  const nextSection = markdown.indexOf('\n## ', section + 1);
  const open = markdown.indexOf('\n```ts\n', section);
  if (open === -1 || (nextSection !== -1 && open > nextSection)) {
    throw new Error(`"${HEADING}" holds no \`ts\` fence`);
  }
  const start = open + '\n```ts\n'.length;
  const close = markdown.indexOf('\n```\n', start);
  if (close === -1) throw new Error(`"${HEADING}"'s fence is never closed`);
  return markdown.slice(start, close);
}

/** Evaluate the fence's exported page literal. */
function evaluatePage(source: string): Record<string, unknown> {
  const body = source
    .split('\n')
    .filter((line) => !/^\s*import\b/.test(line))
    .join('\n')
    // `export const AccountDetailPage: Page = {` -> `const AccountDetailPage = {`
    .replace(/^export\s+const\s+(\w+)\s*:\s*\w+\s*=/m, 'const $1 =');
  const name = /^const\s+(\w+)\s*=/m.exec(body)?.[1];
  if (!name) throw new Error(`"${HEADING}"'s fence declares no exported page constant`);
  return new Function(`${body}\n; return ${name};`)() as Record<string, unknown>;
}

const page = evaluatePage(exampleSource(readFileSync(GUIDE, 'utf8')));
const slots = page.slots as Record<string, unknown> | undefined;
const header = (): HeaderNode => slots?.header as HeaderNode;

/** Every issue as `path: code`, plus the keys an `unrecognized_keys` names. */
const issuesOf = (result: {
  success: boolean;
  error?: { issues: ReadonlyArray<{ path: PropertyKey[]; code: string; keys?: string[] }> };
}): string[] =>
  result.success
    ? []
    : (result.error?.issues ?? []).map(
        (i) => `${i.path.map(String).join('.')}: ${i.code}${i.keys ? ` ${i.keys.join(',')}` : ''}`,
      );

describe('slotted-pages "customize only the header" example (objectui#11165)', () => {
  const row = ComponentPropsMap['page:header'];

  it('LIT CONTROL: the example is a slotted record page with a `page:header` in `slots.header`', () => {
    // Without this, a page whose fence moved or emptied would leave every
    // assertion below judging `undefined`.
    expect(page.kind).toBe('slotted');
    expect(header()?.type).toBe('page:header');
    expect(Object.keys(header()?.properties ?? {})).toContain('title');
  });

  it('the header node passes objectui’s schema mirror (`safeValidateSchema`)', () => {
    expect(issuesOf(safeValidateSchema(header()))).toEqual([]);
  });

  it('the header’s `properties` pass the `page:header` spec row in a full parse', () => {
    expect(issuesOf(row.safeParse(header().properties))).toEqual([]);
  });

  it('CONTROL: the node the page used to teach is refused on `eyebrow` and `icon`', () => {
    const old = {
      ...header(),
      properties: { ...header().properties, eyebrow: 'ACCOUNT', icon: 'building-2' },
    };
    expect(issuesOf(safeValidateSchema(old)).sort()).toEqual(
      ['properties.icon: invalid_type', 'properties: unrecognized_keys eyebrow'].sort(),
    );
    expect(issuesOf(row.safeParse(old.properties)).sort()).toEqual(
      ['icon: invalid_type', ': unrecognized_keys eyebrow'].sort(),
    );
  });
});
