import { describe, it, expect } from 'vitest';
import {
  ViewModeSchema,
  MetadataViewerContributionSchema,
  SidebarGroupContributionSchema,
  ActionContributionLocationSchema,
  ActionContributionSchema,
  MetadataIconContributionSchema,
  PanelLocationSchema,
  PanelContributionSchema,
  CommandContributionSchema,
  StudioPluginContributionsSchema,
  ActivationEventSchema,
  StudioPluginManifestSchema,
  defineStudioPlugin,
} from './plugin.zod';

describe('ViewModeSchema', () => {
  it('should accept all valid view modes', () => {
    const modes = ['preview', 'design', 'code', 'data'];
    modes.forEach(m => {
      expect(() => ViewModeSchema.parse(m)).not.toThrow();
    });
  });

  it('should reject invalid mode', () => {
    expect(() => ViewModeSchema.parse('edit')).toThrow();
  });
});

describe('MetadataViewerContributionSchema', () => {
  it('should accept minimal viewer with defaults', () => {
    const viewer = {
      id: 'object-explorer',
      metadataTypes: ['object'],
      label: 'Object Explorer',
    };
    const result = MetadataViewerContributionSchema.parse(viewer);
    expect(result.priority).toBe(0);
    expect(result.modes).toEqual(['preview']);
  });

  it('should accept full viewer', () => {
    const viewer = {
      id: 'flow-canvas',
      metadataTypes: ['flow', 'workflow'],
      label: 'Flow Canvas',
      priority: 100,
      modes: ['design', 'code'],
    };
    expect(() => MetadataViewerContributionSchema.parse(viewer)).not.toThrow();
  });

  it('should reject empty metadataTypes (min 1)', () => {
    expect(() => MetadataViewerContributionSchema.parse({
      id: 'x', metadataTypes: [], label: 'X',
    })).toThrow();
  });

  it('should reject missing required fields', () => {
    expect(() => MetadataViewerContributionSchema.parse({ id: 'x' })).toThrow();
  });
});

describe('SidebarGroupContributionSchema', () => {
  it('should accept minimal group with defaults', () => {
    const group = { key: 'data', label: 'Data', metadataTypes: ['object', 'field'] };
    const result = SidebarGroupContributionSchema.parse(group);
    expect(result.order).toBe(100);
    expect(result.icon).toBeUndefined();
  });

  it('should accept full group', () => {
    const group = { key: 'automation', label: 'Automation', icon: 'workflow', metadataTypes: ['flow'], order: 50 };
    expect(() => SidebarGroupContributionSchema.parse(group)).not.toThrow();
  });

  it('should reject missing metadataTypes', () => {
    expect(() => SidebarGroupContributionSchema.parse({ key: 'x', label: 'X' })).toThrow();
  });
});

describe('ActionContributionLocationSchema', () => {
  it('should accept all valid locations', () => {
    ['toolbar', 'contextMenu', 'commandPalette'].forEach(loc => {
      expect(() => ActionContributionLocationSchema.parse(loc)).not.toThrow();
    });
  });

  it('should reject invalid location', () => {
    expect(() => ActionContributionLocationSchema.parse('sidebar')).toThrow();
  });
});

describe('ActionContributionSchema', () => {
  it('should accept minimal action with defaults', () => {
    const action = { id: 'deploy', label: 'Deploy', location: 'toolbar' };
    const result = ActionContributionSchema.parse(action);
    expect(result.metadataTypes).toEqual([]);
    expect(result.icon).toBeUndefined();
  });

  it('should accept full action', () => {
    const action = {
      id: 'delete-object',
      label: 'Delete',
      icon: 'trash',
      location: 'contextMenu',
      metadataTypes: ['object'],
    };
    expect(() => ActionContributionSchema.parse(action)).not.toThrow();
  });

  it('should reject missing location', () => {
    expect(() => ActionContributionSchema.parse({ id: 'x', label: 'X' })).toThrow();
  });
});

describe('MetadataIconContributionSchema', () => {
  it('should accept valid icon contribution', () => {
    const icon = { metadataType: 'object', label: 'Objects', icon: 'database' };
    expect(() => MetadataIconContributionSchema.parse(icon)).not.toThrow();
  });

  it('should reject missing required fields', () => {
    expect(() => MetadataIconContributionSchema.parse({ metadataType: 'x' })).toThrow();
    expect(() => MetadataIconContributionSchema.parse({})).toThrow();
  });
});

describe('PanelLocationSchema', () => {
  it('should accept all valid panel locations', () => {
    ['bottom', 'right', 'modal'].forEach(loc => {
      expect(() => PanelLocationSchema.parse(loc)).not.toThrow();
    });
  });

  it('should reject invalid location', () => {
    expect(() => PanelLocationSchema.parse('top')).toThrow();
  });
});

describe('PanelContributionSchema', () => {
  it('should accept minimal panel with defaults', () => {
    const panel = { id: 'terminal', label: 'Terminal' };
    const result = PanelContributionSchema.parse(panel);
    expect(result.location).toBe('bottom');
    expect(result.icon).toBeUndefined();
  });

  it('should accept full panel', () => {
    const panel = { id: 'output', label: 'Output', icon: 'terminal', location: 'right' };
    expect(() => PanelContributionSchema.parse(panel)).not.toThrow();
  });

  it('should reject missing required fields', () => {
    expect(() => PanelContributionSchema.parse({})).toThrow();
  });
});

describe('CommandContributionSchema', () => {
  it('should accept minimal command', () => {
    const cmd = { id: 'myPlugin.openSettings', label: 'Open Settings' };
    const result = CommandContributionSchema.parse(cmd);
    expect(result.shortcut).toBeUndefined();
    expect(result.icon).toBeUndefined();
  });

  it('should accept full command', () => {
    const cmd = { id: 'myPlugin.save', label: 'Save', shortcut: 'Ctrl+S', icon: 'save' };
    expect(() => CommandContributionSchema.parse(cmd)).not.toThrow();
  });

  it('should reject missing id', () => {
    expect(() => CommandContributionSchema.parse({ label: 'X' })).toThrow();
  });
});

describe('StudioPluginContributionsSchema', () => {
  it('should accept empty object with all defaults', () => {
    const result = StudioPluginContributionsSchema.parse({});
    expect(result.metadataViewers).toEqual([]);
    expect(result.sidebarGroups).toEqual([]);
    expect(result.actions).toEqual([]);
    expect(result.metadataIcons).toEqual([]);
    expect(result.panels).toEqual([]);
    expect(result.commands).toEqual([]);
  });

  it('should accept full contributions', () => {
    const contrib = {
      metadataViewers: [{ id: 'v1', metadataTypes: ['object'], label: 'Viewer' }],
      sidebarGroups: [{ key: 'g1', label: 'Group', metadataTypes: ['object'] }],
      actions: [{ id: 'a1', label: 'Action', location: 'toolbar' }],
      metadataIcons: [{ metadataType: 'object', label: 'Object', icon: 'db' }],
      panels: [{ id: 'p1', label: 'Panel' }],
      commands: [{ id: 'c1', label: 'Cmd' }],
    };
    expect(() => StudioPluginContributionsSchema.parse(contrib)).not.toThrow();
  });
});

describe('ActivationEventSchema', () => {
  it('should accept valid activation events', () => {
    // [#4653] The four events this file documented pre-v17, in the structured
    // form they converged onto. Every one still expresses what it used to.
    const events = [
      { type: 'onStartup', pattern: '*' },            // was '*'
      { type: 'onMetadataType', pattern: 'object' },  // was 'onMetadataType:object'
      { type: 'onCommand', pattern: 'myPlugin.do' },  // was 'onCommand:myPlugin.do'
      { type: 'onView', pattern: 'myPanel' },         // was 'onView:myPanel'
    ];
    events.forEach(e => {
      expect(() => ActivationEventSchema.parse(e)).not.toThrow();
    });
  });

  it('should reject the pre-v17 bare-string form', () => {
    // Loud, not silently coerced — the manual migration depends on this.
    expect(() => ActivationEventSchema.parse('onMetadataType:object')).toThrow();
    expect(() => ActivationEventSchema.parse('*')).toThrow();
    expect(() => ActivationEventSchema.parse(123)).toThrow();
  });

  it('should reject an unknown trigger type', () => {
    // The capability the old `z.string()` declaration could never provide.
    expect(() => ActivationEventSchema.parse({ type: 'onMetadatType', pattern: 'flow' })).toThrow();
  });
});

describe('StudioPluginManifestSchema', () => {
  const minimalManifest = {
    id: 'objectstack.my-plugin',
    name: 'My Plugin',
  };

  it('should accept minimal manifest with defaults', () => {
    const result = StudioPluginManifestSchema.parse(minimalManifest);
    expect(result.version).toBe('0.0.1');
    // [#4653] Eager activation, structured. FROM `['*']`.
    expect(result.activationEvents).toEqual([{ type: 'onStartup', pattern: '*' }]);
    expect(result.contributes).toBeDefined();
    expect(result.description).toBeUndefined();
    expect(result.author).toBeUndefined();
  });

  it('should accept full manifest', () => {
    const manifest = {
      id: 'objectstack.object-designer',
      name: 'Object Designer',
      version: '1.0.0',
      description: 'A full object designer plugin',
      author: 'ObjectStack Team',
      contributes: {
        metadataViewers: [{
          id: 'object-explorer',
          metadataTypes: ['object'],
          label: 'Object Explorer',
          priority: 100,
          modes: ['preview', 'design', 'data'],
        }],
      },
      activationEvents: [{ type: 'onMetadataType', pattern: 'object' }],
    };
    expect(() => StudioPluginManifestSchema.parse(manifest)).not.toThrow();
  });

  it('rejects a manifest still carrying the pre-v17 string activation events', () => {
    // The migration is manual (no conversion can reach a studio plugin
    // manifest — it is a root schema, never part of a stack), so the ONLY
    // thing standing between a stale manifest and a wrong-shaped plugin is
    // this parse failing. Pinned so it can never soften into a coercion.
    expect(() => StudioPluginManifestSchema.parse({
      ...minimalManifest,
      activationEvents: ['onMetadataType:object'],
    })).toThrow();
  });

  it('should reject invalid id format', () => {
    expect(() => StudioPluginManifestSchema.parse({ id: 'Invalid ID!', name: 'Test' })).toThrow();
    expect(() => StudioPluginManifestSchema.parse({ id: 'UPPERCASE', name: 'Test' })).toThrow();
    expect(() => StudioPluginManifestSchema.parse({ id: '123start', name: 'Test' })).toThrow();
  });

  it('should accept valid id formats', () => {
    const validIds = ['my-plugin', 'objectstack.flow-designer', 'org.sub.plugin-name'];
    validIds.forEach(id => {
      expect(() => StudioPluginManifestSchema.parse({ id, name: 'Test' })).not.toThrow();
    });
  });

  it('should reject missing required fields', () => {
    expect(() => StudioPluginManifestSchema.parse({})).toThrow();
    expect(() => StudioPluginManifestSchema.parse({ id: 'test' })).toThrow();
  });
});

describe('defineStudioPlugin', () => {
  it('should return a parsed manifest', () => {
    const result = defineStudioPlugin({
      id: 'objectstack.flow-designer',
      name: 'Flow Designer',
    });
    expect(result.id).toBe('objectstack.flow-designer');
    expect(result.version).toBe('0.0.1');
    // [#4653] FROM `['*']` — eager activation, now structured.
    expect(result.activationEvents).toEqual([{ type: 'onStartup', pattern: '*' }]);
  });

  it('should throw on invalid input', () => {
    expect(() => defineStudioPlugin({ id: 'BAD ID', name: 'Test' })).toThrow();
  });
});

// ─── [#4653] Dual-source regression pin ──────────────────────────────
//
// RUNTIME assertions, deliberately. #4642 established that a compile-time pin
// in `packages/spec` is a no-op: `tsconfig.json` excludes `**/*.test.ts` and
// `vitest.config.ts` never enables `typecheck`, so neither path type-checks a
// test file — a conditional-type pin here would be dead text. These run.
//
// What they defend: `ActivationEventSchema` naming ONE declaration across both
// published entries. Re-introducing a local declaration in `studio/plugin.zod.ts`
// (the pre-v17 `z.string()`, or any other) re-creates the #4411 trap where the
// validation an author gets depends on which subpath they imported from, and
// puts the name straight back on `dual-source-exports.baseline.json`.
describe('[#4653] ActivationEventSchema is single-source across ./kernel and ./studio', () => {
  it('both entry points export the very same declaration', async () => {
    const kernelEntry = await import('../kernel/index');
    const studioEntry = await import('../studio/index');

    // Identity, not shape: `lazySchema` returns one Proxy per declaration site,
    // so two declarations can never be `toBe`-equal however alike they look.
    // This is exactly what check:dual-source-exports measures (symbol identity
    // after alias resolution) — asserted here at runtime so a re-split fails
    // `pnpm test` too, not only the gate.
    expect(studioEntry.ActivationEventSchema).toBe(kernelEntry.ActivationEventSchema);
  });

  it('the shared declaration is the structured kernel form on BOTH entries', async () => {
    const kernelEntry = await import('../kernel/index');
    const studioEntry = await import('../studio/index');

    for (const [entry, schema] of [
      ['./kernel', kernelEntry.ActivationEventSchema],
      ['./studio', studioEntry.ActivationEventSchema],
    ] as const) {
      // Structured form accepted...
      expect(
        schema.parse({ type: 'onMetadataType', pattern: 'flow' }),
        `${entry} must accept the structured form`,
      ).toEqual({ type: 'onMetadataType', pattern: 'flow' });
      // ...bare string rejected, on both paths, identically.
      expect(
        () => schema.parse('onMetadataType:flow'),
        `${entry} must reject the pre-v17 string form`,
      ).toThrow();
    }
  });

  it('the trigger vocabulary is the union of both pre-v17 vocabularies', async () => {
    const studioEntry = await import('../studio/index');
    // 7 from kernel + `onMetadataType` / `onView` rescued from studio's docs.
    // Losing either of the last two would silently drop a capability studio
    // authors were already using.
    const union = [
      'onCommand', 'onRoute', 'onObject', 'onEvent',
      'onService', 'onSchedule', 'onStartup',
      'onMetadataType', 'onView',
    ];
    for (const type of union) {
      expect(
        () => studioEntry.ActivationEventSchema.parse({ type, pattern: '*' }),
        `'${type}' must stay in the vocabulary`,
      ).not.toThrow();
    }
    // And it is exactly that set — a tenth value would mean an undeclared
    // vocabulary change slipped in (e.g. cloud-v1's `onInstall` / `onWebhook`,
    // deliberately not adopted: nothing reads them, see ADR-0049 / #4657).
    const options = (studioEntry.ActivationEventSchema as unknown as {
      shape: { type: { options: string[] } };
    }).shape.type.options;
    expect([...options].sort()).toEqual([...union].sort());
  });
});
