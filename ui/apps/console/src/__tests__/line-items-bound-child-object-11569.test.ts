/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11569 — the page compile accepts a `record:line_items` node whose
 * `dataSource` binding names the child object, with no `childObject` of its own.
 *
 * `@objectstack/spec`'s `ComponentPropsMap['record:line_items']` makes
 * `childObject` optional "because the component-level `dataSource` binding can
 * supply the object instead", and the runtime agrees: the registration is
 * gate-wrapped, and `RECORD_LINE_ITEMS_DATA_SOURCE` lands `dataSource.object` on
 * `childObject` before `LineItemsPanel` reads the node. The registration still
 * declared `{ name: 'childObject', required: true }`, and the page compile reads
 * the registration, so it refused that node with `missing-required-prop` at
 * error severity: `ok: false` at the save gate, for a node the spec row, the zod
 * faces and the renderer all accept.
 *
 * The manifest has no vocabulary for "one of these is required"
 * (`ComponentInput` in `@object-ui/types` and `ManifestInput` in
 * `@object-ui/sdui-parser` carry a boolean `required` and nothing beside it), so
 * the registration stops requiring the key (triage ruling on objectui#11569).
 *
 * Judged against the manifest the console SHIPS: `emitSduiManifest` over the
 * registry `dev/manifest-registry.ts` loads, read back from the written
 * `sdui.manifest.json`. That file is what a host registers as the page-save
 * gate's manifest (objectui#11403), so these rows read the gate's own input,
 * not a hand-built list.
 *
 * Rows:
 * 1. The published entry declares `childObject`, not required, with a
 *    description that names the binding; `relationshipField` and `columns`
 *    stay required (the two members the row requires).
 * 2. A node bound by `dataSource` with no `childObject` compiles `ok` with no
 *    diagnostic, and the binding is recorded as a site the server resolves.
 * 3. Control: the same node naming `childObject` and no binding compiles `ok`.
 * 4. Control: the gate still judges requiredness on this tag. A node naming
 *    `childObject` without `relationshipField` is refused with exactly one
 *    `missing-required-prop`, so the empty list in row 2 is a reading of THIS
 *    entry, not of an unresolved tag or an emptied input list. It names
 *    `childObject`, so it holds before and after the fix alike.
 * 5. A node with neither `childObject` nor a binding draws no compile
 *    diagnostic about `childObject`: the ruling leaves that node to the runtime,
 *    whose configuration hint is pinned by `LineItemsPanel.childObjectDecline`
 *    in `@object-ui/plugin-form`.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { compile, type Manifest } from '@object-ui/sdui-parser';
// Module scope, not a hook: the whole registration graph loads at import time.
import '../../dev/manifest-registry';
import { emitSduiManifest } from '../../scripts/emit-sdui-manifest';

const scratchDir = mkdtempSync(join(tmpdir(), 'sdui-manifest-11569-'));
afterAll(() => {
  rmSync(scratchDir, { recursive: true, force: true });
});

/** The shipped `sdui.manifest.json`, read back as the host reads it. */
const shipped = JSON.parse(readFileSync(emitSduiManifest(scratchDir), 'utf8')) as Manifest;

const TAG = 'record:line_items';
const COLUMNS = '{[{ name: "qty", label: "Qty", type: "number" }]}';

const lineItems = (props: string) => `<${TAG} ${props} columns=${COLUMNS} />`;

const inputNamed = (name: string) => shipped.components[TAG]?.inputs.find((input) => input.name === name);

const diagnosticsOf = (source: string) =>
  compile(source, shipped).diagnostics.map((d) => [d.severity, d.code, d.message]);

describe('objectui#11569 — record:line_items does not require childObject at the page compile', () => {
  it('the published entry declares childObject as not required, and names the binding that can supply it', () => {
    const childObject = inputNamed('childObject');
    expect(childObject, `${TAG} publishes no childObject input`).toBeDefined();
    expect(childObject?.required).not.toBe(true);
    const description = childObject?.description ?? '';
    expect(description).toContain('`dataSource`');
    expect(description).toContain('`dataSource.object`');
    // The two members the spec row requires stay required.
    expect(inputNamed('relationshipField')?.required).toBe(true);
    expect(inputNamed('columns')?.required).toBe(true);
  });

  it('a dataSource-bound node with no childObject compiles ok, and the binding is a resolved site', () => {
    const result = compile(lineItems('dataSource={{ object: "po_line" }} relationshipField="po"'), shipped);
    expect(result.diagnostics.map((d) => [d.severity, d.code, d.message])).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.bindings).toEqual([
      { tag: TAG, input: 'dataSource', kind: 'object', value: { object: 'po_line' } },
    ]);
  });

  it('control: the same node naming childObject, with no binding, compiles ok', () => {
    const result = compile(lineItems('childObject="po_line" relationshipField="po"'), shipped);
    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('control: the gate still judges requiredness on this tag — a missing relationshipField is refused', () => {
    // Names `childObject`, so this row reads the same before and after the
    // fix: it is a control on the gate, not a second pin.
    const source = lineItems('childObject="po_line"');
    expect(diagnosticsOf(source)).toEqual([
      ['error', 'missing-required-prop', `<${TAG}> is missing required prop "relationshipField"`],
    ]);
    expect(compile(source, shipped).ok).toBe(false);
  });

  it('a node with neither childObject nor a binding draws no compile diagnostic about childObject', () => {
    // The ruling leaves this node to the runtime: `LineItemsPanel` shows the
    // configuration hint naming `childObject` and loads nothing, pinned by
    // `LineItemsPanel.childObjectDecline.test.tsx` in `@object-ui/plugin-form`.
    const messages = diagnosticsOf(lineItems('relationshipField="po"')).map(([, , message]) => message);
    expect(messages.filter((message) => message.includes('"childObject"'))).toEqual([]);
  });
});
