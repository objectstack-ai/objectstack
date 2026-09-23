import { describe, expect, it } from 'vitest';
import { PROTOCOL_MAJOR } from '@objectstack/spec/kernel';
import { lintConfig } from '../src/commands/lint';

const RULE = 'protocol/missing-engines-range';
const protocolIssues = (config: any) => lintConfig(config).filter((i) => i.rule === RULE);

/**
 * ADR-0087 D1 — `objectstack lint` nudges a package with no `engines.protocol`
 * range to declare one (the ratchet that closes handshake grandfathering).
 */
describe('lint protocol/missing-engines-range', () => {
  it('warns when a manifest declares no compatibility range', () => {
    const issues = protocolIssues({
      manifest: { id: 'com.example.demo', namespace: 'demo', version: '1.0.0', name: 'Demo', type: 'app' },
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe('warning');
    expect(issues[0]!.fix).toBe(`engines: { protocol: '^${PROTOCOL_MAJOR}' }`);
  });

  it('accepts engines.protocol', () => {
    expect(
      protocolIssues({
        manifest: { id: 'com.example.demo', engines: { protocol: `^${PROTOCOL_MAJOR}` } },
      }),
    ).toEqual([]);
  });

  it('accepts the engines.platform and legacy engine.objectstack fallbacks', () => {
    expect(protocolIssues({ manifest: { id: 'com.example.a', engines: { platform: '>=15' } } })).toEqual([]);
    expect(protocolIssues({ manifest: { id: 'com.example.b', engine: { objectstack: '^15.0.0' } } })).toEqual([]);
  });

  it('stays silent for a bare metadata fragment with no manifest', () => {
    expect(protocolIssues({ objects: [{ name: 'x', label: 'X', fields: { a: { label: 'A' } } }] })).toEqual([]);
  });
});
