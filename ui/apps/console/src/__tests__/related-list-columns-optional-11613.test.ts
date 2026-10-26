/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11613 — the page compile accepts a `record:related_list` node that
 * authors no `columns`.
 *
 * `@objectstack/spec`'s `ComponentPropsMap['record:related_list'].columns` is
 * optional, and its describe says what an omitted list means ("columns derive
 * from the related object's highlightFields / default list columns"). The
 * registration in `@object-ui/plugin-detail` still declared
 * `{ name: 'columns', required: true }`, and the page compile (`compile()` in
 * `@object-ui/sdui-parser`, whose `ok` is the save gate) reads the
 * registration, so it refused two nodes the row and the renderer accept:
 *
 * - a node whose `dataSource` binding names a VIEW, which supplies the view's
 *   columns (the block's binding map carries `columns: true`);
 * - a node with neither, which `RelatedList` answers by deriving its columns
 *   from the related object.
 *
 * Triage ruling on objectui#11613 (after objectui#11605's ruling (a)): the
 * registration may not be stricter than the row it publishes, so it stops
 * requiring the key. What each node DRAWS is pinned beside the renderer, in
 * `RecordRelatedListRenderer.columnsOptional-11613.test.tsx` in
 * `@object-ui/plugin-detail`; this file pins the gate.
 *
 * Judged against the manifest the console SHIPS: `emitSduiManifest` over the
 * registry `dev/manifest-registry.ts` loads, read back from the written
 * `sdui.manifest.json`, the file a host registers as the page-save gate's
 * manifest (objectui#11403).
 *
 * Rows:
 * 1. The published entry declares `columns`, not required, with a description
 *    that names both other sources (the named view, the derivation);
 *    `objectName` and `relationshipField` stay required, as the row requires.
 * 2. A view-bound node with no `columns` compiles `ok` with no diagnostic, and
 *    the binding is recorded.
 * 3. The neither node compiles `ok` with no diagnostic: unbound, and bound by
 *    object alone (no view).
 * 4. Control: authored `columns` beside a view still compile `ok`.
 * 5. Controls on what stays refused: a node without `relationshipField`, and a
 *    node without `objectName`. Both author `columns`, so they read the same
 *    before and after the change: they are readings of the gate, not pins.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { compile, type Manifest } from '@object-ui/sdui-parser';
// Module scope, not a hook: the whole registration graph loads at import time.
import '../../dev/manifest-registry';
import { emitSduiManifest } from '../../scripts/emit-sdui-manifest';

const scratchDir = mkdtempSync(join(tmpdir(), 'sdui-manifest-11613-'));
afterAll(() => {
  rmSync(scratchDir, { recursive: true, force: true });
});

/** The shipped `sdui.manifest.json`, read back as the host reads it. */
const shipped = JSON.parse(readFileSync(emitSduiManifest(scratchDir), 'utf8')) as Manifest;

const TAG = 'record:related_list';

const relatedList = (props: string) => `<${TAG} ${props} />`;

const inputNamed = (name: string) => shipped.components[TAG]?.inputs.find((input) => input.name === name);

const diagnosticsOf = (source: string) =>
  compile(source, shipped).diagnostics.map((d) => [d.severity, d.code, d.message]);

describe('objectui#11613 — record:related_list does not require columns at the page compile', () => {
  it('the published entry declares columns as not required, and names where columns come from without it', () => {
    const columns = inputNamed('columns');
    expect(columns, `${TAG} publishes no columns input`).toBeDefined();
    expect(columns?.required).not.toBe(true);
    const description = columns?.description ?? '';
    expect(description).toContain('`dataSource`');
    expect(description).toContain('highlightFields');
    // The two members the spec row requires stay required.
    expect(inputNamed('objectName')?.required).toBe(true);
    expect(inputNamed('relationshipField')?.required).toBe(true);
  });

  it('a view-bound node with no columns compiles ok, and the binding is recorded', () => {
    const result = compile(
      relatedList('objectName="task" relationshipField="account" dataSource={{ object: "task", view: "open_tasks" }}'),
      shipped,
    );
    expect(result.diagnostics.map((d) => [d.severity, d.code, d.message])).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.bindings).toEqual([
      { tag: TAG, input: 'dataSource', kind: 'object', value: { object: 'task', view: 'open_tasks' } },
    ]);
  });

  it('the neither node (no columns, no view) compiles ok', () => {
    const result = compile(relatedList('objectName="task" relationshipField="account"'), shipped);
    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('the neither node bound by object alone (no view) compiles ok', () => {
    const result = compile(
      relatedList('objectName="task" relationshipField="account" dataSource={{ object: "task" }}'),
      shipped,
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('control: authored columns beside a named view still compile ok', () => {
    const result = compile(
      relatedList(
        'objectName="task" relationshipField="account" columns={["priority"]} dataSource={{ object: "task", view: "open_tasks" }}',
      ),
      shipped,
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('control: a node without relationshipField is still refused', () => {
    const source = relatedList('objectName="task" columns={["subject"]}');
    expect(diagnosticsOf(source)).toEqual([
      ['error', 'missing-required-prop', `<${TAG}> is missing required prop "relationshipField"`],
    ]);
    expect(compile(source, shipped).ok).toBe(false);
  });

  it('control: a node without objectName is still refused, bound or not', () => {
    // The row requires `objectName`, so a binding's object does not waive it
    // on this tag (objectui#11605's control, read here beside the change).
    for (const source of [
      relatedList('relationshipField="account" columns={["subject"]}'),
      relatedList('relationshipField="account" columns={["subject"]} dataSource={{ object: "task" }}'),
    ]) {
      expect(diagnosticsOf(source)).toEqual([
        ['error', 'missing-required-prop', `<${TAG}> is missing required prop "objectName"`],
      ]);
      expect(compile(source, shipped).ok).toBe(false);
    }
  });
});
