/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Every designer registration lists, as `inputs`, exactly the node members its
 * component reads (objectui#11434's sweep).
 *
 * `inputs` is an authoring surface: the html-tier page compiler builds its
 * manifest from every known registration, and its `validateTree` answers
 * `unknown-prop` for a node key no input names. A member the component reads
 * but `inputs` omits is therefore warned off although it works — which the
 * sweep measured on four of the six registrations (`process-designer` listed
 * neither `version` nor `lanes`, and only `page-designer` listed `canvas`).
 *
 * The expected set per type is the node declaration's members less what no
 * input should name: `type`, the two content channels every designer refuses
 * (`body`, `children`), and the retired tombstones (`autoLayout`,
 * `previewMode`).
 *
 * Every row also declares the KIND its value has. A `code` row is judged as a
 * string, so the same compiler answered `type-mismatch` ("expected a string")
 * on every legal array or object a designer takes — the shape objectui#10993
 * settled on the registration row. The last block builds that compiler's
 * manifest the way `page.tsx` does (every known type, its registered inputs)
 * and runs its own `validateTree` over one legal document per designer.
 */

import { describe, it, expect } from 'vitest';
import { ComponentRegistry } from '@object-ui/core';
// Relative, as other packages' tests reach a sibling's source: this package
// declares no dependency on the parser, and the test is the only reader.
import { manifestFromConfigs, validateTree } from '../../../sdui-parser/src/index';
import '../index';

const EXPECTED: Record<string, string[]> = {
  'page-designer': ['canvas', 'components', 'palette', 'propertyEditor', 'showComponentTree', 'undoRedo', 'readOnly'],
  'data-model-designer': ['entities', 'relationships', 'canvas', 'showRelationshipLabels', 'readOnly'],
  'process-designer': ['processName', 'version', 'nodes', 'edges', 'lanes', 'canvas', 'showMinimap', 'showToolbar', 'readOnly'],
  'report-designer': ['reportName', 'objectName', 'pageSize', 'orientation', 'margins', 'sections', 'showToolbar', 'showPropertyPanel', 'readOnly'],
  'object-manager': ['objects', 'showSystemObjects', 'readOnly'],
  'field-designer': ['objectName', 'fields', 'readOnly'],
};

describe('designer registrations list the members their components read (objectui#11434)', () => {
  it.each(Object.keys(EXPECTED))('`%s` inputs are exactly its read node members', (type) => {
    const config = ComponentRegistry.getConfig(type);
    expect(config, `no registration for ${type}`).toBeDefined();
    const names = (config?.inputs ?? []).map((input) => input.name);
    expect([...names].sort()).toEqual([...EXPECTED[type]].sort());
  });

  it('each row the sweep added declares the kind its value has', () => {
    const kind = (type: string, name: string) =>
      ComponentRegistry.getConfig(type)?.inputs?.find((input) => input.name === name)?.type;
    expect(kind('page-designer', 'palette')).toBe('array');
    expect(kind('page-designer', 'propertyEditor')).toBe('boolean');
    expect(kind('data-model-designer', 'canvas')).toBe('object');
    expect(kind('data-model-designer', 'showRelationshipLabels')).toBe('boolean');
    expect(kind('process-designer', 'version')).toBe('string');
    expect(kind('process-designer', 'lanes')).toBe('array');
    expect(kind('process-designer', 'canvas')).toBe('object');
    expect(kind('report-designer', 'margins')).toBe('object');
  });

  it('the two enumerated report inputs offer the declared vocabularies', () => {
    const inputs = ComponentRegistry.getConfig('report-designer')?.inputs ?? [];
    expect(inputs.find((i) => i.name === 'pageSize')?.enum).toEqual(['A4', 'A3', 'Letter', 'Legal', 'Tabloid']);
    expect(inputs.find((i) => i.name === 'orientation')?.enum).toEqual(['portrait', 'landscape']);
  });
});

/** One legal value for every input of each designer, by the node declarations in `@object-ui/types`. */
const LEGAL: Record<string, Record<string, unknown>> = {
  'page-designer': {
    canvas: { width: 800, height: 600 }, components: [], palette: [], propertyEditor: true,
    showComponentTree: true, undoRedo: true, readOnly: false,
  },
  'data-model-designer': {
    entities: [], relationships: [], canvas: { width: 800, height: 600 }, showRelationshipLabels: true, readOnly: false,
  },
  'process-designer': {
    processName: 'Order Approval', version: '1.2', nodes: [], edges: [], lanes: [], canvas: { width: 800, height: 600 },
    showMinimap: true, showToolbar: true, readOnly: false,
  },
  'report-designer': {
    reportName: 'Pipeline', objectName: 'opportunity', pageSize: 'A4', orientation: 'portrait',
    margins: { top: 40, right: 40, bottom: 40, left: 40 }, sections: [], showToolbar: true, showPropertyPanel: true, readOnly: false,
  },
  'object-manager': { objects: [], showSystemObjects: true, readOnly: false },
  'field-designer': { objectName: 'account', fields: [], readOnly: false },
};

/** The html-tier compiler's manifest, built as `page.tsx` builds it: every known type with its registered inputs. */
function htmlTierManifest() {
  const configs = ComponentRegistry.getKnownTypes().map((type) => {
    const meta = ComponentRegistry.getMeta(type);
    return { type, namespace: meta?.namespace, isContainer: meta?.isContainer, inputs: meta?.inputs };
  });
  return manifestFromConfigs(configs as unknown as Parameters<typeof manifestFromConfigs>[0]);
}

describe('no designer row draws a diagnostic on a legal value (objectui#11434, the objectui#10993 shape)', () => {
  const manifest = htmlTierManifest();

  it.each(Object.keys(LEGAL))('a legal `%s` document draws no `type-mismatch` and no `unknown-prop`', (type) => {
    // The document names every input, so no row escapes the judgment.
    expect(Object.keys(LEGAL[type]).sort()).toEqual([...EXPECTED[type]].sort());
    const { diagnostics } = validateTree({ type, ...LEGAL[type] } as never, manifest);
    const flagged = diagnostics.filter((d) => d.code === 'type-mismatch' || d.code === 'unknown-prop').map((d) => d.message);
    expect(flagged).toEqual([]);
  });

  it('the instrument fires: a string where a designer takes an array is a `type-mismatch`', () => {
    const { diagnostics } = validateTree({ type: 'process-designer', ...LEGAL['process-designer'], nodes: 'n1' } as never, manifest);
    const mismatches = diagnostics.filter((d) => d.code === 'type-mismatch');
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].message).toContain('"nodes"');
  });
});
