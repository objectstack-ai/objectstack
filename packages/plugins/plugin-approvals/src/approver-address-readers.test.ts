// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The enumeration pin for the slot-address equivalence (`approver-address.ts`).
 *
 * The defect family behind it (#21350, #21379) was never one wrong comparison.
 * It was the same comparison — "does this slot address belong to the caller?"
 * — written at several readers, each keying on the bare user id or on one
 * literal spelling, each drifting on its own. So this pin holds two things.
 *
 * 1. THE READERS, by name. Every reader of the equivalence is listed in
 *    `READERS` with the `approver-address.ts` export it must read, and the pin
 *    asserts each named method in `approval-service.ts` reads it. A reader
 *    rewritten to compare a slot on its own (say, `can_act` back to
 *    `pending.includes(uid)`) loses that read and goes red here, besides
 *    turning its own behavioural pin red in `approval-service.test.ts`.
 *
 * 2. NO COMPARISON ELSEWHERE. It parses every non-test `.ts` file under this
 *    package's `src/` except `approver-address.ts` with the TypeScript compiler
 *    and collects every site of a shape that compares a slot address with
 *    something:
 *      - a membership call (`includes`, `indexOf`, `has`, `some`, `find`,
 *        `filter`, …) on a receiver whose text names a pending slate
 *        (`/pending/i` — `pending`, `pendingApprovers`, `pending_approvers`);
 *      - a slot column (`approver`, `actor_id`, `pending_approvers`) set in a
 *        query predicate — an object literal under a `where` / `filter`
 *        property or variable, or an assignment to `where.<column>`;
 *      - a declarative filter row naming a slot column (`field:
 *        'pending_approvers'` under a `filter` in object metadata).
 *    Every collected site must be classified in `SLOT_SITES`, by its enclosing
 *    function and its exact source text. A NEW site — a fresh
 *    `pending.includes(actorId)`, a `where: { actor_id: uid }` — is
 *    unclassified and fails with its location; a classified site that changed
 *    text or disappeared fails too, so the ledger cannot rot. Classifying a
 *    site is a review act: a reader that compares a slot with a CALLER takes
 *    its addresses from `approver-address.ts` and is listed as a `reader`; a
 *    site that compares a slot with another SLOT (a hand-off target, a token's
 *    bound slot) is `slot-vs-slot` with its reason.
 *
 * What it does not see: a comparison spelled with none of those shapes (a
 * hand-written loop over a slate with `===`). The shapes are the ones every
 * reader in this file's history has used; a new spelling is caught in review,
 * and the fix is to add its shape here.
 */

import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const EQUIVALENCE_MODULE = 'approver-address.ts';
const SERVICE = 'approval-service.ts';

/** Every reader of the equivalence, and what it reads (an `approver-address.ts` export, or `takenSlot` over one). */
const READERS: ReadonlyArray<{ reader: string; method: string; reads: string }> = [
  { reader: 'acting path — may the caller act under a named address', method: 'resolveActor', reads: 'positionAddresses' },
  { reader: '"My Pending" list filter', method: 'approverRequestIds', reads: 'equivalentApproverAddresses' },
  { reader: 'participant gate — current approver and already acted', method: 'visibleRequestIds', reads: 'actingAddresses' },
  { reader: 'can_act', method: 'attachViewers', reads: 'heldSlot' },
  { reader: 'decision slot test', method: 'takenSlot', reads: 'heldSlot' },
  { reader: 'decision slot test — approve / reject', method: 'decideNode', reads: 'takenSlot' },
  { reader: 'decision slot test — send back', method: 'sendBack', reads: 'takenSlot' },
  { reader: 'decision slot test — reassign', method: 'reassign', reads: 'takenSlot' },
  { reader: 'decision slot test — request info', method: 'requestInfo', reads: 'takenSlot' },
  { reader: 'decision slot test — comment', method: 'comment', reads: 'takenSlot' },
];

type SiteRole = 'reader' | 'slot-vs-slot' | 'declarative';

/**
 * Every slot-comparison site outside `approver-address.ts`, keyed
 * `<file> · <enclosing function> · <source text>`.
 */
const SLOT_SITES: Readonly<Record<string, { role: SiteRole; why: string }>> = {
  'approval-service.ts · approverRequestIds · approver: addresses[0]': {
    role: 'reader',
    why: '"My Pending": `addresses` is the caller\'s ask expanded through equivalentApproverAddresses',
  },
  'approval-service.ts · approverRequestIds · approver: { $in: addresses }': {
    role: 'reader',
    why: 'the same filter, several addresses',
  },
  'approval-service.ts · visibleRequestIds · actor_id: acting.length === 1 ? acting[0] : { $in: acting }': {
    role: 'reader',
    why: 'already-acted probe: `acting` is actingAddresses(caller), the current-approver probe\'s set',
  },
  'approval-service.ts · reassign · pending.includes(to)': {
    role: 'slot-vs-slot',
    why: 'is the hand-off TARGET already on the slate — no caller identity involved',
  },
  'approval-service.ts · reassign · pending.includes(from)': {
    role: 'slot-vs-slot',
    why: '`from` names the slot being moved (the taken slot by default); the caller is judged by takenSlot',
  },
  "approval-service.ts · remind · pending.filter(a => a && !a.includes(':'))": {
    role: 'slot-vs-slot',
    why: 'partitions the slate by shape for the reminder fan-out',
  },
  "approval-service.ts · remind · pending.filter(a => a && a.includes(':'))": {
    role: 'slot-vs-slot',
    why: 'the other half of that partition',
  },
  'approval-service.ts · issueActionTokens · pending.includes(approverId)': {
    role: 'slot-vs-slot',
    why: 'server code names the slot a token is minted for; tokens bind a slot, not a caller',
  },
  'approval-service.ts · resolveActionToken · (request.pending_approvers ?? []).includes(token.approver_id)': {
    role: 'slot-vs-slot',
    why: 'is the token\'s bound slot still on the slate (ADR-0043 invalidation)',
  },
  "sys-approval-request.object.ts · (module) · field: 'pending_approvers'": {
    role: 'declarative',
    why: 'the `my_pending` list view\'s substring filter on {current_user_id}; served only by the generic data '
      + 'door, which a member without read on sys_approval_request is refused (measured 403 on #21379). The '
      + 'inbox route is "My Pending"\'s owner and reads the equivalence; metadata cannot',
  },
};

const MEMBERSHIP = new Set(['includes', 'indexOf', 'lastIndexOf', 'has', 'some', 'every', 'find', 'findIndex', 'filter']);
const SLATE = /pending/i;
const SLOT_COLUMNS = new Set(['approver', 'actor_id', 'pending_approvers']);
const PREDICATE_NAMES = new Set(['where', 'filter']);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && name !== EQUIVALENCE_MODULE) out.push(path);
  }
  return out;
}

function parse(path: string): ts.SourceFile {
  return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
}

function enclosingFunction(node: ts.Node, sf: ts.SourceFile): string {
  for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
    if ((ts.isMethodDeclaration(p) || ts.isFunctionDeclaration(p)) && p.name) return p.name.getText(sf);
  }
  return '(module)';
}

/** Is `node` inside a query predicate — an object under a `where`/`filter` property or variable? */
function inPredicate(node: ts.Node, sf: ts.SourceFile): boolean {
  for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
    if ((ts.isPropertyAssignment(p) || ts.isVariableDeclaration(p)) && PREDICATE_NAMES.has(p.name.getText(sf))) return true;
    if (ts.isFunctionLike(p)) return false;
  }
  return false;
}

type Shape = 'membership' | 'predicate' | 'assignment' | 'declarative';

/** Walk `sf` and report every slot-comparison site, by the shape that matched. */
function detect(sf: ts.SourceFile, hit: (shape: Shape, node: ts.Node) => void): void {
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && MEMBERSHIP.has(node.expression.name.text) && SLATE.test(node.expression.expression.getText(sf))) {
      hit('membership', node);
    }
    if (ts.isPropertyAssignment(node) && SLOT_COLUMNS.has(node.name.getText(sf)) && inPredicate(node, sf)) {
      hit('predicate', node);
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isPropertyAccessExpression(node.left) && SLOT_COLUMNS.has(node.left.name.text)
      && PREDICATE_NAMES.has(node.left.expression.getText(sf))) {
      hit('assignment', node);
    }
    if (ts.isPropertyAssignment(node) && node.name.getText(sf) === 'field'
      && ts.isStringLiteralLike(node.initializer) && SLOT_COLUMNS.has(node.initializer.text)
      && inPredicate(node, sf)) {
      hit('declarative', node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

function slotSites(): { sites: string[]; files: number } {
  const files = sourceFiles(HERE);
  const sites: string[] = [];
  for (const path of files) {
    const sf = parse(path);
    const file = relative(HERE, path);
    detect(sf, (_shape, node) => {
      sites.push(`${file} · ${enclosingFunction(node, sf)} · ${node.getText(sf).replace(/\s+/g, ' ')}`);
    });
  }
  return { sites, files: files.length };
}

function method(sf: ts.SourceFile, name: string): ts.MethodDeclaration {
  const found: ts.MethodDeclaration[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isMethodDeclaration(node) && node.name.getText(sf) === name) found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  expect(found.length, `exactly one method '${name}' in ${SERVICE}`).toBe(1);
  return found[0];
}

/** Does `node` read `name` — call it, or hand it on (`flatMap(name)`)? */
function reads(node: ts.Node, name: string): boolean {
  let hit = false;
  const visit = (n: ts.Node): void => {
    if (ts.isIdentifier(n) && n.text === name) hit = true;
    if (!hit) ts.forEachChild(n, visit);
  };
  visit(node);
  return hit;
}

describe('approver-address — the readers of the equivalence, and no comparison outside them', () => {
  it('every listed reader takes its addresses from approver-address.ts', () => {
    const sf = parse(join(HERE, SERVICE));
    for (const { reader, method: name, reads: helper } of READERS) {
      expect(reads(method(sf, name), helper), `${reader}: ${name}() reads ${helper}`).toBe(true);
    }
    // Both participant-gate probes read the ONE set the method builds.
    const gate = method(sf, 'visibleRequestIds').getText(sf);
    expect(gate).toMatch(/const acting = actingAddresses\(/);
    expect(gate).toMatch(/this\.approverRequestIds\(acting,/);
  });

  it('every slot-comparison site outside approver-address.ts is classified — a new one fails with its location', () => {
    const { sites, files } = slotSites();
    // The scan ran over the package, not over nothing.
    expect(files).toBeGreaterThan(20);
    const unclassified = sites.filter((s) => !(s in SLOT_SITES));
    expect(
      unclassified,
      'a slot address is compared outside approver-address.ts: take the addresses from there (and list the reader '
      + 'in READERS), or — for a slot compared with another SLOT — classify the site in SLOT_SITES with its reason',
    ).toEqual([]);
    const stale = Object.keys(SLOT_SITES).filter((s) => !sites.includes(s));
    expect(stale, 'a classified site changed or disappeared: re-classify it').toEqual([]);
    // No site is classified twice by being written twice.
    expect(new Set(sites).size).toBe(sites.length);
  });

  it('the detector catches the shapes it names (a planted user-id comparison in each shape)', () => {
    const planted = ts.createSourceFile('planted.ts', [
      'class S {',
      '  a(pending: string[], uid: string) { return pending.includes(uid); }',
      '  b(engine: any, uid: string) { return engine.find("x", { where: { actor_id: uid } }); }',
      '  c(uid: string) { const where: any = {}; where.approver = uid; return where; }',
      '}',
      'export const V = { filter: [{ field: "pending_approvers", operator: "contains", value: "{current_user_id}" }] };',
    ].join('\n'), ts.ScriptTarget.Latest, true);
    const hits: Shape[] = [];
    detect(planted, (shape) => hits.push(shape));
    expect(hits).toEqual(['membership', 'predicate', 'assignment', 'declarative']);
  });
});
