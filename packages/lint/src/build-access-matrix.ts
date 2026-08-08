// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0090 D6] Access-matrix snapshot — authoring-time companion to the
 * runtime explain engine.
 *
 * `buildAccessMatrix(stack)` derives, PURELY from metadata, one row per
 * (permission set × object) the stack declares: the CRUD/VAMA bits, the
 * depth axes, and the object's OWD for context. The matrix is snapshotted to
 * `access-matrix.json` and diffed on every compile: an unchanged matrix
 * auto-passes; a changed one fails the build until the snapshot is updated —
 * so every capability change becomes a REVIEWABLE, semantic diff
 * ("`crm_admin` gains delete on `crm_lead`") instead of a buried JSON hunk.
 * This is the publish-gate substrate the AI-authoring safety story needs:
 * AI may draft grants freely; it cannot silently change who can do what.
 */

import type { AccessMatrixParsed, AccessMatrixEntry } from '@objectstack/spec/security';

type AnyRec = Record<string, unknown>;

function asArray(v: unknown): AnyRec[] {
  if (Array.isArray(v)) return v as AnyRec[];
  if (v && typeof v === 'object') {
    return Object.entries(v as AnyRec).map(([name, def]) => ({ name, ...(def as AnyRec) }));
  }
  return [];
}

/** Build the sorted access matrix for a normalized stack. */
export function buildAccessMatrix(stack: AnyRec): AccessMatrixParsed {
  const entries: AccessMatrixEntry[] = [];
  if (!stack || typeof stack !== 'object') return { version: 1, entries };

  const owdByObject = new Map<string, string>();
  for (const obj of asArray(stack.objects)) {
    const name = typeof obj.name === 'string' ? obj.name : '';
    if (!name) continue;
    const owd = (obj.sharingModel ?? (obj.security as AnyRec | undefined)?.sharingModel) as string | undefined;
    if (typeof owd === 'string') owdByObject.set(name, owd);
  }

  for (const ps of asArray(stack.permissions)) {
    const psName = typeof ps.name === 'string' ? ps.name : '';
    if (!psName) continue;
    const objects = (ps.objects && typeof ps.objects === 'object' ? ps.objects : {}) as AnyRec;
    for (const [objName, rawPerm] of Object.entries(objects)) {
      const p = (rawPerm ?? {}) as AnyRec;
      const entry: AccessMatrixEntry = {
        permissionSet: psName,
        object: objName,
        create: p.allowCreate === true,
        read: p.allowRead === true || p.viewAllRecords === true || p.modifyAllRecords === true,
        edit: p.allowEdit === true || p.modifyAllRecords === true,
        delete: p.allowDelete === true || p.modifyAllRecords === true,
        viewAllRecords: p.viewAllRecords === true,
        modifyAllRecords: p.modifyAllRecords === true,
      };
      if (typeof p.readScope === 'string') entry.readScope = p.readScope;
      if (typeof p.writeScope === 'string') entry.writeScope = p.writeScope;
      const owd = owdByObject.get(objName);
      if (owd) entry.sharingModel = owd;
      entries.push(entry);
    }
  }

  entries.sort((a, b) =>
    a.permissionSet === b.permissionSet
      ? a.object.localeCompare(b.object)
      : a.permissionSet.localeCompare(b.permissionSet),
  );
  return { version: 1, entries };
}

const BIT_LABELS: Array<[keyof AccessMatrixEntry, string]> = [
  ['create', 'create'],
  ['read', 'read'],
  ['edit', 'edit'],
  ['delete', 'delete'],
  ['viewAllRecords', 'View All Data'],
  ['modifyAllRecords', 'Modify All Data'],
];

/**
 * Semantic diff between two matrices — human-review lines, empty = identical.
 * Ordered: removals, additions, then per-entry bit/scope changes.
 */
export function diffAccessMatrix(before: AccessMatrixParsed, after: AccessMatrixParsed): string[] {
  const lines: string[] = [];
  const key = (e: AccessMatrixEntry) => `${e.permissionSet}\u0000${e.object}`;
  const beforeMap = new Map((before?.entries ?? []).map((e) => [key(e), e]));
  const afterMap = new Map((after?.entries ?? []).map((e) => [key(e), e]));

  for (const [k, b] of beforeMap) {
    if (!afterMap.has(k)) {
      lines.push(`'${b.permissionSet}' loses ALL access to '${b.object}' (entry removed)`);
    }
  }
  for (const [k, a] of afterMap) {
    const b = beforeMap.get(k);
    if (!b) {
      const grants = BIT_LABELS.filter(([bit]) => a[bit] === true).map(([, label]) => label);
      lines.push(`'${a.permissionSet}' gains access to '${a.object}' (${grants.join(', ') || 'no bits set'})`);
      continue;
    }
    for (const [bit, label] of BIT_LABELS) {
      if (b[bit] !== a[bit]) {
        lines.push(`'${a.permissionSet}' ${a[bit] ? 'gains' : 'loses'} ${label} on '${a.object}'`);
      }
    }
    if ((b.readScope ?? 'own') !== (a.readScope ?? 'own')) {
      lines.push(`'${a.permissionSet}' read depth on '${a.object}': ${b.readScope ?? 'own'} → ${a.readScope ?? 'own'}`);
    }
    if ((b.writeScope ?? 'own') !== (a.writeScope ?? 'own')) {
      lines.push(`'${a.permissionSet}' write depth on '${a.object}': ${b.writeScope ?? 'own'} → ${a.writeScope ?? 'own'}`);
    }
    if ((b.sharingModel ?? '') !== (a.sharingModel ?? '')) {
      lines.push(`'${a.object}' record baseline (OWD): ${b.sharingModel ?? '(unset)'} → ${a.sharingModel ?? '(unset)'} (affects every principal)`);
    }
  }
  return lines;
}
