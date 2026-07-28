// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Unit tests for evidence path extraction (the stale-evidence check).

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { checkEvidence, scanEvidence } from './evidence.mts';

const here = dirname(fileURLToPath(import.meta.url));
const specRoot = resolve(here, '../..');
const repoRoot = resolve(specRoot, '../..');
const ledgerRoot = join(specRoot, 'liveness');

const none = () => false;
const all = () => true;

describe('scanEvidence — path extraction', () => {
  it('extracts a bare `path:line` pointer', () => {
    expect(scanEvidence('packages/runtime/src/http-dispatcher.ts:120').local)
      .toEqual(['packages/runtime/src/http-dispatcher.ts']);
  });

  it('extracts a path followed by parenthetical prose (the old parser\'s blind spot)', () => {
    // `split(':')[0]` returned the whole string here, which never exists.
    const r = scanEvidence('packages/spec/src/stack.zod.ts (mergeActionsIntoObjects stable-sorts each group)');
    expect(r.local).toEqual(['packages/spec/src/stack.zod.ts']);
  });

  it('extracts every path from a multi-pointer string', () => {
    const r = scanEvidence(
      'packages/objectql/src/validation/rule-validator.ts (UPDATE strip); packages/metadata-protocol/src/protocol.ts (INSERT ingress strip)',
    );
    expect(r.local).toEqual([
      'packages/objectql/src/validation/rule-validator.ts',
      'packages/metadata-protocol/src/protocol.ts',
    ]);
  });

  it('ignores prose that merely contains a slash', () => {
    const r = scanEvidence('objectui: components action-button/-group/-icon/-menu gate the Button');
    expect(r.local).toEqual([]);
    expect(r.foreign).toEqual([]);
  });

  it('ignores a path that is not repo-rooted (another repo\'s internal layout)', () => {
    expect(scanEvidence('objectui: app-shell/MetadataProvider.tsx reads it').local).toEqual([]);
  });
});

describe('scanEvidence — cross-repo attribution', () => {
  it('attributes paths after an `objectui:` marker to objectui', () => {
    const r = scanEvidence('objectui: packages/app-shell/src/views/RecordDetailView.tsx:573');
    expect(r.foreign).toEqual(['packages/app-shell/src/views/RecordDetailView.tsx']);
    expect(r.local).toEqual([]);
  });

  it('handles the parenthesised marker form', () => {
    const r = scanEvidence('registered into ActionEngine.shortcuts[] (objectui packages/core/src/actions/ActionEngine.ts:150) but no caller');
    expect(r.foreign).toEqual(['packages/core/src/actions/ActionEngine.ts']);
    expect(r.local).toEqual([]);
  });

  it('ends a realm at the clause boundary so a later framework path is still resolved', () => {
    const r = scanEvidence(
      'objectui RecordDetailView gates the tab (historyEnabled memo); pairs with packages/plugins/plugin-audit/src/audit-writers.ts',
    );
    expect(r.foreign).toEqual([]);
    expect(r.local).toEqual(['packages/plugins/plugin-audit/src/audit-writers.ts']);
  });

  it('treats the closed cloud runtime as foreign wherever it appears', () => {
    const r = scanEvidence('packages/services/service-ai/src/agent-runtime.ts:264');
    expect(r.foreign).toEqual(['packages/services/service-ai/src/agent-runtime.ts']);
    expect(r.local).toEqual([]);
    // …but its open-edition siblings are local.
    expect(scanEvidence('packages/services/service-automation/src/engine.ts:44').local).toHaveLength(1);
  });

  it('lets `framework` switch attribution back explicitly', () => {
    const r = scanEvidence('objectui packages/app-shell/src/x.tsx framework packages/runtime/src/y.ts');
    expect(r.foreign).toEqual(['packages/app-shell/src/x.tsx']);
    expect(r.local).toEqual(['packages/runtime/src/y.ts']);
  });
});

describe('checkEvidence', () => {
  it('reports only unresolvable LOCAL paths', () => {
    const r = checkEvidence('packages/a/src/x.ts (prose) objectui: packages/b/src/y.tsx', none);
    expect(r.missing).toEqual(['packages/a/src/x.ts']);
  });

  it('is silent when every local path resolves', () => {
    expect(checkEvidence('packages/a/src/x.ts', all).missing).toEqual([]);
  });

  it('tolerates a non-string evidence value', () => {
    expect(checkEvidence(undefined, none)).toEqual({ local: [], foreign: [], missing: [] });
    expect(checkEvidence(42, none).missing).toEqual([]);
  });
});

// Contract test against the REAL ledgers: the gate reports these, so a rotted
// pointer committed to a ledger fails here too.
describe('shipped ledgers', () => {
  it('every local evidence path resolves', () => {
    const missing: string[] = [];
    let local = 0;
    for (const f of readdirSync(ledgerRoot).filter((x) => x.endsWith('.json'))) {
      const ledger = JSON.parse(readFileSync(join(ledgerRoot, f), 'utf8'));
      const visit = (key: string, entry: any) => {
        if (entry?.status !== 'live' || typeof entry?.evidence !== 'string') return;
        const r = checkEvidence(entry.evidence, (p) => existsSync(join(repoRoot, p)));
        local += r.local.length;
        r.missing.forEach((m) => missing.push(`${ledger.type}/${key} → ${m}`));
      };
      for (const [key, entry] of Object.entries<any>(ledger.props || {})) {
        visit(key, entry);
        for (const [ck, centry] of Object.entries<any>(entry?.children || {})) visit(`${key}.${ck}`, centry);
      }
    }
    expect(missing).toEqual([]);
    // Guard against the parser silently degrading to "extracts nothing" — that
    // would make the assertion above vacuously true.
    expect(local).toBeGreaterThan(100);
  });
});
