// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';

import {
  CONNECTOR_SOURCE_PROVIDERS,
  MAPPING_CONNECTOR_SOURCE_UNKNOWN,
  validateMappingConnectorSources,
} from './validate-mapping-connector-source.js';
import { explainRule } from './rule-explanations.js';
import { validateReferenceIntegrity } from './reference-integrity-suite.js';

// A mapping's `connectorSource.connector` names the connector a pull reads
// from. The executor refuses every name that is not a declared rest or openapi
// `connectors[]` entry, on every pull; this rule says so at `os validate`.

const pull = (connector: unknown, extra: Record<string, unknown> = {}) => ({
  name: 'crm_contacts',
  targetObject: 'contact',
  fieldMapping: [{ source: 'id', target: 'external_id' }],
  connectorSource: { connector, action: 'request' },
  ...extra,
});

const restConnector = { name: 'crm_api', label: 'CRM', type: 'api', provider: 'rest', providerConfig: { baseUrl: 'https://crm.example.com' } };
const legacyDb = { name: 'legacy_db', driver: 'postgres', config: {} };

describe('validateMappingConnectorSources', () => {
  it('names a datasource as a datasource, at the connector key, as a warning', () => {
    const findings = validateMappingConnectorSources({
      connectors: [restConnector],
      datasources: [legacyDb],
      mappings: [pull('legacy_db')],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'warning',
      rule: MAPPING_CONNECTOR_SOURCE_UNKNOWN,
      where: 'mapping "crm_contacts" · connector "legacy_db"',
      path: 'mappings[0].connectorSource.connector',
    });
    expect(findings[0].message).toContain('is a datasource');
  });

  it('CONTROL: a mapping naming a declared rest connector is clean, and so is an openapi one', () => {
    expect(validateMappingConnectorSources({ connectors: [restConnector], mappings: [pull('crm_api')] })).toEqual([]);
    expect(validateMappingConnectorSources({
      connectors: [{ ...restConnector, name: 'erp_api', provider: 'openapi' }],
      mappings: [pull('erp_api')],
    })).toEqual([]);
  });

  it('names a connector of another provider, and a provider-less catalog descriptor', () => {
    const findings = validateMappingConnectorSources({
      connectors: [
        { ...restConnector, name: 'crm_mcp', provider: 'mcp' },
        { name: 'crm_catalog', label: 'CRM catalog', type: 'api' },
      ],
      mappings: [pull('crm_mcp'), pull('crm_catalog', { name: 'crm_catalog_pull' })],
    });
    expect(findings.map((f) => f.path)).toEqual([
      'mappings[0].connectorSource.connector',
      'mappings[1].connectorSource.connector',
    ]);
    expect(findings[0].message).toContain('"mcp" connector');
    expect(findings[1].message).toContain('no provider');
  });

  it('names a name that is nothing, with the nearest rest connector', () => {
    const findings = validateMappingConnectorSources({ connectors: [restConnector], mappings: [pull('crm_apii')] });
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('names no connectors[] entry');
    expect(findings[0].message).toContain('Did you mean "crm_api"?');
  });

  it('resolves a connector a sibling package of the same artifact declares', () => {
    const stack = {
      mappings: [pull('crm_api')],
      packages: [{ manifest: { id: 'com.example.connectors', name: 'connectors', version: '1.0.0', connectors: [restConnector] } }],
    };
    expect(validateMappingConnectorSources(stack)).toEqual([]);
  });

  it('judges nothing without a connectorSource, or with a connector that is not a name', () => {
    expect(validateMappingConnectorSources({
      mappings: [
        { name: 'csv_import', targetObject: 'contact', fieldMapping: [] },
        pull(42),
        pull(''),
      ],
    })).toEqual([]);
  });

  it('runs inside the reference-integrity suite, which `os validate` dispatches', () => {
    const findings = validateReferenceIntegrity({ datasources: [legacyDb], mappings: [pull('legacy_db')] });
    expect(findings.filter((f) => f.rule === MAPPING_CONNECTOR_SOURCE_UNKNOWN)).toHaveLength(1);
  });

  it('mirrors the providers the connector pull reads through', () => {
    expect([...CONNECTOR_SOURCE_PROVIDERS]).toEqual(['rest', 'openapi']);
  });

  it('has an `os explain` entry', () => {
    expect(explainRule(MAPPING_CONNECTOR_SOURCE_UNKNOWN)?.rule).toBe(MAPPING_CONNECTOR_SOURCE_UNKNOWN);
  });
});
