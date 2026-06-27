// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @module automation/bpmn-interop
 *
 * BPMN XML Interoperability Protocol
 *
 * Defines the specification for importing and exporting BPMN 2.0 XML
 * process definitions. This enables interoperability with external BPM
 * tools (Camunda, Activiti, jBPM, etc.) via a plugin-based approach.
 *
 * **Priority:** Low — long-term planning, not a core requirement.
 */

import { z } from 'zod';

// ─── BPMN Element Mapping ────────────────────────────────────────────

/**
 * Mapping between a BPMN XML element type and an ObjectStack FlowNodeAction.
 * Used during import/export to translate between the two models.
 */
import { lazySchema } from '../shared/lazy-schema';
export const BpmnElementMappingSchema = lazySchema(() => z.object({
  /** BPMN XML element type (e.g., "bpmn:parallelGateway", "bpmn:serviceTask") */
  bpmnType: z.string().describe('BPMN XML element type (e.g., "bpmn:parallelGateway")'),

  /** Corresponding ObjectStack FlowNodeAction */
  flowNodeAction: z.string().describe('ObjectStack FlowNodeAction value'),

  /** Whether this mapping is bidirectional (supports both import and export) */
  bidirectional: z.boolean().default(true).describe('Whether the mapping supports both import and export'),

  /** Notes about mapping limitations or special handling */
  notes: z.string().optional().describe('Notes about mapping limitations'),
}).describe('Mapping between BPMN XML element and ObjectStack FlowNodeAction'));

export type BpmnElementMapping = z.infer<typeof BpmnElementMappingSchema>;

// ─── BPMN Import Options ─────────────────────────────────────────────

/**
 * Strategy for handling BPMN elements that have no direct ObjectStack mapping.
 */
export const BpmnUnmappedStrategySchema = lazySchema(() => z.enum([
  'skip',     // Skip unmapped elements silently
  'warn',     // Import with warnings
  'error',    // Fail on unmapped elements
  'comment',  // Import as annotation/comment nodes
]).describe('Strategy for unmapped BPMN elements during import'));

export type BpmnUnmappedStrategy = z.infer<typeof BpmnUnmappedStrategySchema>;

/**
 * Options for importing a BPMN 2.0 XML process definition into an ObjectStack flow.
 */
export const BpmnImportOptionsSchema = lazySchema(() => z.object({
  /** Strategy for unmapped BPMN elements */
  unmappedStrategy: BpmnUnmappedStrategySchema.default('warn')
    .describe('How to handle unmapped BPMN elements'),

  /** Custom element mappings (override or extend built-in mappings) */
  customMappings: z.array(BpmnElementMappingSchema).optional()
    .describe('Custom element mappings to override or extend defaults'),

  /** Whether to import BPMN DI (diagram interchange) layout positions */
  importLayout: z.boolean().default(true)
    .describe('Import BPMN DI layout positions into canvas node coordinates'),

  /** Whether to import BPMN documentation as node descriptions */
  importDocumentation: z.boolean().default(true)
    .describe('Import BPMN documentation elements as node descriptions'),

  /** Target flow name (if not derived from BPMN process name) */
  flowName: z.string().optional()
    .describe('Override flow name (defaults to BPMN process name)'),

  /** Whether to validate the imported flow against ObjectStack schema */
  validateAfterImport: z.boolean().default(true)
    .describe('Validate imported flow against FlowSchema after import'),
}).describe('Options for importing BPMN 2.0 XML into an ObjectStack flow'));

export type BpmnImportOptions = z.infer<typeof BpmnImportOptionsSchema>;

// ─── BPMN Export Options ─────────────────────────────────────────────

/**
 * BPMN XML target version for export.
 */
export const BpmnVersionSchema = lazySchema(() => z.enum([
  '2.0',       // BPMN 2.0 (most common, default)
  '2.0.2',     // BPMN 2.0.2 (latest revision)
]).describe('BPMN specification version for export'));

export type BpmnVersion = z.infer<typeof BpmnVersionSchema>;

/**
 * Options for exporting an ObjectStack flow as BPMN 2.0 XML.
 */
export const BpmnExportOptionsSchema = lazySchema(() => z.object({
  /** Target BPMN version */
  version: BpmnVersionSchema.default('2.0')
    .describe('Target BPMN specification version'),

  /** Whether to include BPMN DI (diagram interchange) layout data */
  includeLayout: z.boolean().default(true)
    .describe('Include BPMN DI layout data from canvas positions'),

  /** Whether to include ObjectStack-specific extensions as BPMN extension elements */
  includeExtensions: z.boolean().default(false)
    .describe('Include ObjectStack extensions in BPMN extensionElements'),

  /** Custom element mappings (override built-in for export) */
  customMappings: z.array(BpmnElementMappingSchema).optional()
    .describe('Custom element mappings for export'),

  /** Whether to pretty-print the XML output */
  prettyPrint: z.boolean().default(true)
    .describe('Pretty-print XML output with indentation'),

  /** XML namespace prefix for BPMN elements */
  namespacePrefix: z.string().default('bpmn')
    .describe('XML namespace prefix for BPMN elements'),
}).describe('Options for exporting an ObjectStack flow as BPMN 2.0 XML'));

export type BpmnExportOptions = z.infer<typeof BpmnExportOptionsSchema>;

// ─── BPMN Import/Export Result ───────────────────────────────────────

/**
 * Diagnostic message from BPMN import/export operations.
 */
export const BpmnDiagnosticSchema = lazySchema(() => z.object({
  /** Severity level */
  severity: z.enum(['info', 'warning', 'error']).describe('Diagnostic severity'),

  /** Human-readable message */
  message: z.string().describe('Diagnostic message'),

  /** BPMN element ID (if applicable) */
  bpmnElementId: z.string().optional().describe('BPMN element ID related to this diagnostic'),

  /** ObjectStack node ID (if applicable) */
  nodeId: z.string().optional().describe('ObjectStack node ID related to this diagnostic'),
}).describe('Diagnostic message from BPMN import/export'));

export type BpmnDiagnostic = z.infer<typeof BpmnDiagnosticSchema>;

/**
 * Result of a BPMN import or export operation.
 */
export const BpmnInteropResultSchema = lazySchema(() => z.object({
  /** Whether the operation completed successfully */
  success: z.boolean().describe('Whether the operation completed successfully'),

  /** Diagnostic messages (warnings, errors, info) */
  diagnostics: z.array(BpmnDiagnosticSchema).default([])
    .describe('Diagnostic messages from the operation'),

  /** Number of elements successfully mapped */
  mappedCount: z.number().int().min(0).default(0)
    .describe('Number of elements successfully mapped'),

  /** Number of elements skipped or unmapped */
  unmappedCount: z.number().int().min(0).default(0)
    .describe('Number of elements that could not be mapped'),
}).describe('Result of a BPMN import/export operation'));

export type BpmnInteropResult = z.infer<typeof BpmnInteropResultSchema>;

// ─── Built-in Element Mappings ───────────────────────────────────────

/**
 * Built-in element mappings between BPMN 2.0 XML types and ObjectStack FlowNodeAction.
 * Import/export plugins should use these as defaults, with user overrides applied on top.
 */
export const BUILT_IN_BPMN_MAPPINGS: BpmnElementMapping[] = [
  { bpmnType: 'bpmn:startEvent', flowNodeAction: 'start', bidirectional: true },
  { bpmnType: 'bpmn:endEvent', flowNodeAction: 'end', bidirectional: true },
  { bpmnType: 'bpmn:exclusiveGateway', flowNodeAction: 'decision', bidirectional: true },
  { bpmnType: 'bpmn:parallelGateway', flowNodeAction: 'parallel_gateway', bidirectional: true },
  { bpmnType: 'bpmn:serviceTask', flowNodeAction: 'http', bidirectional: true, notes: 'Maps HTTP/connector tasks' },
  { bpmnType: 'bpmn:scriptTask', flowNodeAction: 'script', bidirectional: true },
  { bpmnType: 'bpmn:userTask', flowNodeAction: 'screen', bidirectional: true },
  { bpmnType: 'bpmn:callActivity', flowNodeAction: 'subflow', bidirectional: true },
  { bpmnType: 'bpmn:intermediateCatchEvent', flowNodeAction: 'wait', bidirectional: true, notes: 'Timer/signal/message catch events' },
  { bpmnType: 'bpmn:boundaryEvent', flowNodeAction: 'boundary_event', bidirectional: true },
  { bpmnType: 'bpmn:task', flowNodeAction: 'assignment', bidirectional: true, notes: 'Generic BPMN task maps to assignment' },
];
