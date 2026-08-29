// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Unit tests for evidence path extraction (the stale-evidence check).

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { checkCitationLines, checkEvidence, checkEvidenceAnchors, countLines, isSymbolNamed, scanEvidence } from './evidence.mts';

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
    expect(checkEvidence(undefined, none)).toEqual({ local: [], foreign: [], localCitations: [], localAnchors: [], missing: [] });
    expect(checkEvidence(42, none).missing).toEqual([]);
  });
});

// #11210: the parser used to DISCARD the `:NNN` half of a citation, so no gate
// could bound it and a consumer that moved out of a file which still exists kept
// a passing pointer. These pin the retention; the bound itself is below.
describe('scanEvidence — line citations', () => {
  it('retains the line of a bare `path:line` pointer', () => {
    expect(scanEvidence('packages/runtime/src/http-dispatcher.ts:120').localCitations)
      .toEqual([{ path: 'packages/runtime/src/http-dispatcher.ts', line: 120 }]);
  });

  it('takes the END of a `path:start-end` range', () => {
    // The end is the stricter bound AND the one that subsumes the other: a start
    // past EOF implies an end past EOF, never the reverse. Fixture path for the
    // reason given above `describe('checkCitationLines')`: this reads no file,
    // and a bare out-of-package literal reds check:cross-package-test-inputs.
    expect(scanEvidence('packages/a/src/y.ts:115-167').localCitations)
      .toEqual([{ path: 'packages/a/src/y.ts', line: 167 }]);
  });

  it('sees EVERY citation in a concatenated multi-consumer entry, not just the first', () => {
    // The house style for a property with several consumers, `+`-joined with
    // prose between. Seeing only the head would leave the tail of every such
    // chain exactly as unfalsifiable as the whole string was before.
    const r = scanEvidence(
      'packages/plugins/plugin-security/src/permission-evaluator.ts:267 (getSystemPermissions) + '
      + 'packages/plugins/plugin-sharing/src/sharing-rule-service.ts:136 (assertCanManageRules) + '
      + 'packages/plugins/plugin-hono-server/src/current-user-endpoints.ts:897',
    );
    expect(r.localCitations.map((c) => c.line)).toEqual([267, 136, 897]);
  });

  it('records several lines of ONE file separately', () => {
    // Deduping on path rather than on `path:line` would drop all but the first —
    // and a repaired entry routinely cites one file at three call sites.
    const r = scanEvidence('packages/a/src/x.ts:10 (rank) + packages/a/src/x.ts:20 (merge) + packages/a/src/x.ts:10 (again)');
    expect(r.local).toEqual(['packages/a/src/x.ts']);
    expect(r.localCitations).toEqual([
      { path: 'packages/a/src/x.ts', line: 10 },
      { path: 'packages/a/src/x.ts', line: 20 },
    ]);
  });

  it('leaves a path with no line out of the citation list', () => {
    const r = scanEvidence('packages/a/src/x.ts (prose only)');
    expect(r.local).toEqual(['packages/a/src/x.ts']);
    expect(r.localCitations).toEqual([]);
  });

  it('never bounds a FOREIGN citation — those files are legitimately absent here', () => {
    const r = scanEvidence('objectui: packages/app-shell/src/views/RecordDetailView.tsx:573');
    expect(r.localCitations).toEqual([]);
  });

  it('still reduces a realm marker written `objectui:` rather than reading it as a line', () => {
    // The trailing-punctuation pass strips `:`; only a digit suffix is a line.
    const r = scanEvidence('objectui: packages/app-shell/src/x.tsx:12');
    expect(r.foreign).toEqual(['packages/app-shell/src/x.tsx']);
    expect(r.localCitations).toEqual([]);
  });

  it('reads a citation through the punctuation an entry wraps it in', () => {
    expect(scanEvidence('(packages/a/src/x.ts:44)').localCitations).toEqual([{ path: 'packages/a/src/x.ts', line: 44 }]);
    expect(scanEvidence('packages/a/src/x.ts:44,').localCitations).toEqual([{ path: 'packages/a/src/x.ts', line: 44 }]);
    expect(scanEvidence('packages/a/src/x.ts:44.').localCitations).toEqual([{ path: 'packages/a/src/x.ts', line: 44 }]);
  });
});

// #12516: a line citation rots IN RANGE — the consumer moves within its file and
// every check stays green. A `path#symbol` anchor moves WITH the consumer; these
// pin its extraction, and the resolution check is below.
describe('scanEvidence — symbol anchors (#12516)', () => {
  it('retains the anchor of a `path#symbol` pointer, and the path stays local', () => {
    const r = scanEvidence('packages/runtime/src/action-execution.ts#dispatchFlowAction (flow dispatch)');
    expect(r.local).toEqual(['packages/runtime/src/action-execution.ts']);
    expect(r.localAnchors).toEqual([{ path: 'packages/runtime/src/action-execution.ts', symbol: 'dispatchFlowAction' }]);
  });

  it('parses an anchor and a line together, in EITHER order', () => {
    // An order the parser refused would not fail — the token would quietly stop
    // matching PATH_RE and become prose, taking the existence check with it.
    for (const token of ['packages/a/src/x.ts#dispatch:120', 'packages/a/src/x.ts:120#dispatch']) {
      const r = scanEvidence(token);
      expect(r.local, token).toEqual(['packages/a/src/x.ts']);
      expect(r.localCitations, token).toEqual([{ path: 'packages/a/src/x.ts', line: 120 }]);
      expect(r.localAnchors, token).toEqual([{ path: 'packages/a/src/x.ts', symbol: 'dispatch' }]);
    }
  });

  it('records several anchors of ONE file separately, deduped on path#symbol', () => {
    const r = scanEvidence(
      'packages/a/src/x.ts#alpha (reads it) + packages/a/src/x.ts#beta (writes it) + packages/a/src/x.ts#alpha (again)',
    );
    expect(r.localAnchors.map((a) => a.symbol)).toEqual(['alpha', 'beta']);
  });

  it('never collects a FOREIGN anchor — the file is legitimately absent here', () => {
    const r = scanEvidence('objectui: packages/app-shell/src/x.tsx#RecordDetailView');
    expect(r.foreign).toEqual(['packages/app-shell/src/x.tsx']);
    expect(r.localAnchors).toEqual([]);
  });

  it('does not read an issue reference as an anchor', () => {
    // `(#4352` is a house-style token in evidence prose; its "path" half is
    // empty, so it is prose, exactly as before the anchor grammar existed.
    const r = scanEvidence('packages/a/src/x.ts:385 (the #4352 gate decides)');
    expect(r.local).toEqual(['packages/a/src/x.ts']);
    expect(r.localAnchors).toEqual([]);
  });

  it('retains a malformed anchor for the checker to fail, rather than dropping it', () => {
    // A dropped anchor is a silently-unheld standard — the checker must SEE it
    // to fail it (the `verifiedAt` malformed-date asymmetry).
    const r = scanEvidence('packages/a/src/x.ts#not-an-identifier');
    expect(r.localAnchors).toEqual([{ path: 'packages/a/src/x.ts', symbol: 'not-an-identifier' }]);
  });
});

describe('isSymbolNamed', () => {
  it('matches an identifier as a whole word', () => {
    expect(isSymbolNamed('await dispatchFlowAction(deps)', 'dispatchFlowAction')).toBe(true);
  });

  it('rejects a prefix of a longer identifier — identifier-bounded, not substring', () => {
    expect(isSymbolNamed('await dispatchFlowAction(deps)', 'dispatch')).toBe(false);
  });

  it('treats `$` as an identifier character, which `\\b` does not', () => {
    expect(isSymbolNamed('const foo$bar = 1', 'foo')).toBe(false);
    expect(isSymbolNamed('const foo$bar = 1', 'foo$bar')).toBe(true);
  });
});

describe('checkEvidenceAnchors', () => {
  const content = (s: string) => () => s;

  it('resolves an anchor whose symbol the cited file names', () => {
    const scan = scanEvidence('packages/a/src/x.ts#alpha');
    const r = checkEvidenceAnchors(scan, content('export function alpha() {}'));
    expect(r.checked).toHaveLength(1);
    expect(r.unresolved).toEqual([]);
    expect(r.malformed).toEqual([]);
  });

  it('flags an anchor whose symbol left the file — the rot a line bound cannot see', () => {
    // The #12516 shape replayed: the consumer moved/renamed, the file still
    // exists, every line is still in range, the file may still name the key —
    // and the symbol is gone.
    const scan = scanEvidence('packages/a/src/x.ts#dispatchFlowAction');
    const r = checkEvidenceAnchors(scan, content('export function dispatchFlowActionMoved() {}'));
    expect(r.unresolved).toEqual([{ path: 'packages/a/src/x.ts', symbol: 'dispatchFlowAction' }]);
  });

  it('reports a malformed anchor instead of judging it', () => {
    const scan = scanEvidence('packages/a/src/x.ts#not-an-identifier packages/a/src/y.ts#');
    const r = checkEvidenceAnchors(scan, content('anything'));
    expect(r.malformed.map((a) => a.symbol)).toEqual(['not-an-identifier', '']);
    expect(r.checked).toEqual([]);
  });

  it('says nothing about a file it cannot read — that verdict belongs to the existence check', () => {
    const scan = scanEvidence('packages/a/src/gone.ts#alpha');
    expect(checkEvidenceAnchors(scan, () => null)).toEqual({ checked: [], unresolved: [], malformed: [] });
  });
});

describe('countLines — what a citation can address', () => {
  it('counts a trailing newline as terminating the last line, not opening a new one', () => {
    // `wc -l` semantics. The off-by-one that decides whether a 717-line file
    // "has" a line 718 to cite.
    expect(countLines('a\nb\nc\n')).toBe(3);
    expect(countLines('a\nb\nc')).toBe(3);
  });

  it('reads an empty file as zero addressable lines', () => {
    expect(countLines('')).toBe(0);
  });
});

// These assert the ARITHMETIC of the bound, with the line count injected. They
// read no file at all, so their sample paths are deliberately the fixture
// spelling (`packages/a/…`) and not the two real files whose rot they are shaped
// on — `hono-plugin.ts` for the `permission.tabPermissions` instance and
// `import-mapping.ts` for `mapping.fieldMapping`.
//
// ⛔ Do not "improve" these by restoring the real paths. `pnpm
// check:cross-package-test-inputs` reads a test's path literals as declared
// inputs, and @objectstack/spec's globs cover neither package — so naming them
// reds that gate, and the only way to satisfy it would be to declare an input
// this file does not have. The counts below come from a stub, not from those
// files: a citation whose real line count matters is asserted against the real
// ledgers in the contract test at the bottom of this file.
describe('checkCitationLines', () => {
  const lines = (n: number) => () => n;

  it('flags a citation past the end of the file and reports the real length', () => {
    // The `permission.tabPermissions` shape: line 1200 cited, 717 lines exist.
    const scan = scanEvidence('packages/a/src/x.ts:1200');
    expect(checkCitationLines(scan, lines(717))).toEqual([
      { path: 'packages/a/src/x.ts', line: 1200, lines: 717 },
    ]);
  });

  it('accepts the last line of the file — the boundary is `>`, not `>=`', () => {
    expect(checkCitationLines(scanEvidence('packages/a/src/x.ts:717'), lines(717))).toEqual([]);
    expect(checkCitationLines(scanEvidence('packages/a/src/x.ts:718'), lines(717))).toHaveLength(1);
  });

  it('flags a RANGE whose head is inside the file but whose tail overruns it', () => {
    // The shipped `mapping.fieldMapping` shape: 115 exists, 167 does not.
    const r = checkCitationLines(scanEvidence('packages/a/src/y.ts:115-167'), lines(164));
    expect(r).toEqual([{ path: 'packages/a/src/y.ts', line: 167, lines: 164 }]);
  });

  it('says nothing about a file it cannot read — that verdict belongs to the existence check', () => {
    // Reporting one rot twice teaches a reader to discount both lists.
    expect(checkCitationLines(scanEvidence('packages/a/src/gone.ts:9'), () => null)).toEqual([]);
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

  it('every local `path:NNN` citation names a line that file has', () => {
    const outOfRange: string[] = [];
    let citations = 0;
    const lineCount = (p: string): number | null => {
      const f = join(repoRoot, p);
      if (!existsSync(f)) return null;
      return countLines(readFileSync(f, 'utf8'));
    };
    for (const f of readdirSync(ledgerRoot).filter((x) => x.endsWith('.json'))) {
      const ledger = JSON.parse(readFileSync(join(ledgerRoot, f), 'utf8'));
      const visit = (key: string, entry: any) => {
        if (entry?.status !== 'live' || typeof entry?.evidence !== 'string') return;
        const scan = checkEvidence(entry.evidence, () => true);
        citations += scan.localCitations.length;
        for (const c of checkCitationLines(scan, lineCount)) {
          outOfRange.push(`${ledger.type}/${key} → ${c.path}:${c.line} (file has ${c.lines})`);
        }
      };
      for (const [key, entry] of Object.entries<any>(ledger.props || {})) {
        visit(key, entry);
        for (const [ck, centry] of Object.entries<any>(entry?.children || {})) visit(`${key}.${ck}`, centry);
      }
    }
    expect(outOfRange).toEqual([]);
    // Same non-vacuity guard as above, one level down: a parser that stopped
    // retaining lines would satisfy the assertion above by extracting nothing
    // (the #5623 lesson — "all in range" over zero citations is what a degraded
    // parser prints too). The GUARDED FAILURE MODE IS EXACTLY ZERO, so zero is
    // exactly what the floor tests, and the sibling floor above keeps its own
    // number because the `local` PATH population it guards is not draining.
    //
    // Why not a bigger number here, when this one used to be 100 (#13003): the
    // symbol-anchor migration (#12516's grammar, adopted batch by batch under
    // #13003) RETIRES line citations by design — 300 at that card's filing, 175
    // after batch 2, 82 after batch 3 — so any floor above zero reds on
    // legitimate drainage and re-opens the same escalation one batch later.
    // Ruled 2026-08-28 on #13003 (comment 5458356183): lower to `> 0`, the only
    // floor that never lies during the migration while still catching
    // extracts-nothing at full strength.
    //
    // ⛔ WHEN THIS POPULATION LEGITIMATELY REACHES ZERO — the last line citation
    // retired — DELETE this assertion AND this comment IN THE SAME PR that
    // retires it, together with the `outOfRange` assertion above, which has
    // nothing left to check. That is the conscious decision at zero the `> 0`
    // floor exists to force. Never let it pass silently on an empty population.
    expect(citations).toBeGreaterThan(0);
  });

  it('every local `path#symbol` anchor names a symbol its file contains (#12516)', () => {
    const bad: string[] = [];
    let anchors = 0;
    const readFile = (p: string): string | null => {
      const f = join(repoRoot, p);
      return existsSync(f) ? readFileSync(f, 'utf8') : null;
    };
    for (const f of readdirSync(ledgerRoot).filter((x) => x.endsWith('.json'))) {
      const ledger = JSON.parse(readFileSync(join(ledgerRoot, f), 'utf8'));
      const visit = (key: string, entry: any) => {
        for (const field of ['evidence', 'producer']) {
          if (typeof entry?.[field] !== 'string') continue;
          const scan = checkEvidence(entry[field], () => true);
          const r = checkEvidenceAnchors(scan, readFile);
          anchors += r.checked.length;
          r.unresolved.forEach((a) => bad.push(`${ledger.type}/${key} → ${a.path}#${a.symbol} (symbol gone)`));
          r.malformed.forEach((a) => bad.push(`${ledger.type}/${key} → ${a.path}#${a.symbol} (malformed)`));
        }
      };
      for (const [key, entry] of Object.entries<any>(ledger.props || {})) {
        visit(key, entry);
        for (const [ck, centry] of Object.entries<any>(entry?.children || {})) visit(`${key}.${ck}`, centry);
      }
    }
    expect(bad).toEqual([]);
    // Non-vacuity: the two #12516 repoints are the day-one anchored population;
    // a parser that stopped extracting anchors would pass the line above by
    // asking nothing.
    expect(anchors).toBeGreaterThanOrEqual(2);
  });
});
