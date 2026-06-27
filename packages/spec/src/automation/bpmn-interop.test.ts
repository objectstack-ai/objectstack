import { describe, it, expect } from 'vitest';
import {
  BpmnElementMappingSchema,
  BpmnUnmappedStrategySchema,
  BpmnImportOptionsSchema,
  BpmnVersionSchema,
  BpmnExportOptionsSchema,
  BpmnDiagnosticSchema,
  BpmnInteropResultSchema,
  BUILT_IN_BPMN_MAPPINGS,
  type BpmnImportOptions,
  type BpmnExportOptions,
  type BpmnInteropResult,
} from './bpmn-interop.zod';

// ---------------------------------------------------------------------------
// BpmnElementMappingSchema
// ---------------------------------------------------------------------------
describe('BpmnElementMappingSchema', () => {
  it('should accept a valid mapping', () => {
    const mapping = BpmnElementMappingSchema.parse({
      bpmnType: 'bpmn:parallelGateway',
      flowNodeAction: 'parallel_gateway',
    });
    expect(mapping.bpmnType).toBe('bpmn:parallelGateway');
    expect(mapping.bidirectional).toBe(true); // default
  });

  it('should accept mapping with notes', () => {
    const mapping = BpmnElementMappingSchema.parse({
      bpmnType: 'bpmn:serviceTask',
      flowNodeAction: 'http',
      bidirectional: true,
      notes: 'Maps HTTP/connector tasks',
    });
    expect(mapping.notes).toBe('Maps HTTP/connector tasks');
  });

  it('should reject without required fields', () => {
    expect(() => BpmnElementMappingSchema.parse({})).toThrow();
  });
});

// ---------------------------------------------------------------------------
// BpmnUnmappedStrategySchema
// ---------------------------------------------------------------------------
describe('BpmnUnmappedStrategySchema', () => {
  it('should accept all strategies', () => {
    ['skip', 'warn', 'error', 'comment'].forEach(s => {
      expect(BpmnUnmappedStrategySchema.parse(s)).toBe(s);
    });
  });
});

// ---------------------------------------------------------------------------
// BpmnImportOptionsSchema
// ---------------------------------------------------------------------------
describe('BpmnImportOptionsSchema', () => {
  it('should accept empty options with defaults', () => {
    const opts: BpmnImportOptions = BpmnImportOptionsSchema.parse({});
    expect(opts.unmappedStrategy).toBe('warn');
    expect(opts.importLayout).toBe(true);
    expect(opts.importDocumentation).toBe(true);
    expect(opts.validateAfterImport).toBe(true);
  });

  it('should accept custom import options', () => {
    const opts = BpmnImportOptionsSchema.parse({
      unmappedStrategy: 'error',
      customMappings: [
        { bpmnType: 'bpmn:businessRuleTask', flowNodeAction: 'script' },
      ],
      importLayout: false,
      importDocumentation: true,
      flowName: 'imported_approval_flow',
      validateAfterImport: true,
    });
    expect(opts.unmappedStrategy).toBe('error');
    expect(opts.customMappings).toHaveLength(1);
    expect(opts.flowName).toBe('imported_approval_flow');
  });
});

// ---------------------------------------------------------------------------
// BpmnExportOptionsSchema
// ---------------------------------------------------------------------------
describe('BpmnExportOptionsSchema', () => {
  it('should accept empty options with defaults', () => {
    const opts: BpmnExportOptions = BpmnExportOptionsSchema.parse({});
    expect(opts.version).toBe('2.0');
    expect(opts.includeLayout).toBe(true);
    expect(opts.includeExtensions).toBe(false);
    expect(opts.prettyPrint).toBe(true);
    expect(opts.namespacePrefix).toBe('bpmn');
  });

  it('should accept custom export options', () => {
    const opts = BpmnExportOptionsSchema.parse({
      version: '2.0.2',
      includeLayout: true,
      includeExtensions: true,
      prettyPrint: false,
      namespacePrefix: 'bpmn2',
    });
    expect(opts.version).toBe('2.0.2');
    expect(opts.includeExtensions).toBe(true);
    expect(opts.namespacePrefix).toBe('bpmn2');
  });
});

// ---------------------------------------------------------------------------
// BpmnVersionSchema
// ---------------------------------------------------------------------------
describe('BpmnVersionSchema', () => {
  it('should accept valid versions', () => {
    expect(BpmnVersionSchema.parse('2.0')).toBe('2.0');
    expect(BpmnVersionSchema.parse('2.0.2')).toBe('2.0.2');
  });

  it('should reject invalid version', () => {
    expect(() => BpmnVersionSchema.parse('1.0')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// BpmnDiagnosticSchema
// ---------------------------------------------------------------------------
describe('BpmnDiagnosticSchema', () => {
  it('should accept a warning diagnostic', () => {
    const diag = BpmnDiagnosticSchema.parse({
      severity: 'warning',
      message: 'BPMN element bpmn:businessRuleTask has no direct mapping',
      bpmnElementId: 'Task_12345',
    });
    expect(diag.severity).toBe('warning');
    expect(diag.bpmnElementId).toBe('Task_12345');
  });

  it('should accept all severities', () => {
    ['info', 'warning', 'error'].forEach(s => {
      expect(() => BpmnDiagnosticSchema.parse({
        severity: s,
        message: 'test',
      })).not.toThrow();
    });
  });
});

// ---------------------------------------------------------------------------
// BpmnInteropResultSchema
// ---------------------------------------------------------------------------
describe('BpmnInteropResultSchema', () => {
  it('should accept a successful result', () => {
    const result: BpmnInteropResult = BpmnInteropResultSchema.parse({
      success: true,
      mappedCount: 15,
      unmappedCount: 0,
    });
    expect(result.success).toBe(true);
    expect(result.diagnostics).toEqual([]); // default
  });

  it('should accept a result with diagnostics', () => {
    const result = BpmnInteropResultSchema.parse({
      success: true,
      diagnostics: [
        { severity: 'warning', message: 'Unmapped element: bpmn:textAnnotation' },
        { severity: 'info', message: 'Imported 12 nodes and 15 edges' },
      ],
      mappedCount: 12,
      unmappedCount: 1,
    });
    expect(result.diagnostics).toHaveLength(2);
    expect(result.unmappedCount).toBe(1);
  });

  it('should accept a failed result', () => {
    const result = BpmnInteropResultSchema.parse({
      success: false,
      diagnostics: [
        { severity: 'error', message: 'Invalid BPMN XML: missing process element' },
      ],
    });
    expect(result.success).toBe(false);
    expect(result.diagnostics[0].severity).toBe('error');
  });
});

// ---------------------------------------------------------------------------
// BUILT_IN_BPMN_MAPPINGS
// ---------------------------------------------------------------------------
describe('BUILT_IN_BPMN_MAPPINGS', () => {
  it('should validate all built-in mappings', () => {
    BUILT_IN_BPMN_MAPPINGS.forEach(m => {
      expect(() => BpmnElementMappingSchema.parse(m)).not.toThrow();
    });
  });

  it('should include BPMN parallel gateway mapping', () => {
    const parallel = BUILT_IN_BPMN_MAPPINGS.find(m => m.bpmnType === 'bpmn:parallelGateway');
    expect(parallel).toBeDefined();
    expect(parallel?.flowNodeAction).toBe('parallel_gateway');
  });

  it('should include boundary event mapping', () => {
    const boundary = BUILT_IN_BPMN_MAPPINGS.find(m => m.bpmnType === 'bpmn:boundaryEvent');
    expect(boundary).toBeDefined();
    expect(boundary?.flowNodeAction).toBe('boundary_event');
  });

  it('should include wait/intermediate catch event mapping', () => {
    const wait = BUILT_IN_BPMN_MAPPINGS.find(m => m.bpmnType === 'bpmn:intermediateCatchEvent');
    expect(wait).toBeDefined();
    expect(wait?.flowNodeAction).toBe('wait');
  });

  it('should map all core BPMN elements', () => {
    const bpmnTypes = BUILT_IN_BPMN_MAPPINGS.map(m => m.bpmnType);
    expect(bpmnTypes).toContain('bpmn:startEvent');
    expect(bpmnTypes).toContain('bpmn:endEvent');
    expect(bpmnTypes).toContain('bpmn:exclusiveGateway');
    expect(bpmnTypes).toContain('bpmn:parallelGateway');
    expect(bpmnTypes).toContain('bpmn:serviceTask');
    expect(bpmnTypes).toContain('bpmn:scriptTask');
    expect(bpmnTypes).toContain('bpmn:userTask');
    expect(bpmnTypes).toContain('bpmn:callActivity');
    expect(bpmnTypes).toContain('bpmn:boundaryEvent');
  });
});
