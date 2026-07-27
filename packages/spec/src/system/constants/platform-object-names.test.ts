// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Conformance ratchet for PLATFORM_PROVIDED_OBJECT_NAMES (issue #3583).
//
// The registry replaces a prefix heuristic (`startsWith('sys_')`) with a
// curated list, which is only an improvement while the list is TRUE: consumers
// now treat "platform-prefixed but absent" as a probable typo, so a stale entry
// turns a real object into a false warning, and a missing entry lets a
// fictional reference (the `sys_approval_process` case) ship silently again.
//
// This test is the thing that keeps it true. It scans every `*.object.ts` in
// the monorepo for its `ObjectSchema.create({ name })` declaration and asserts
// the registry matches, per owning package. Scanning source (rather than
// importing the packages) keeps the check here, next to the data, without
// inverting the spec → * dependency direction.
//
// If this fails: you added/removed/moved a platform object. Update
// PLATFORM_OBJECTS_BY_PACKAGE in ./platform-object-names.ts to match.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PLATFORM_OBJECTS_BY_PACKAGE,
  PLATFORM_PROVIDED_OBJECT_NAMES,
  CLOUD_PROVIDED_OBJECT_NAMES,
  hasPlatformObjectPrefix,
  isPlatformProvidedObjectName,
} from './platform-object-names';

const HERE = dirname(fileURLToPath(import.meta.url));
/** …/packages/spec/src/system/constants → repo root */
const REPO_ROOT = resolve(HERE, '../../../../..');
const PACKAGES_DIR = join(REPO_ROOT, 'packages');

/**
 * Packages whose `*.object.ts` files are FIXTURES, not platform contributions:
 * a downstream-contract QA harness and the `create-objectstack` scaffolding
 * templates (the `blank` starter's `note.object.ts`). Neither ships objects
 * into a running platform, so neither belongs in the registry.
 */
const FIXTURE_PACKAGES = new Set(['qa', 'create-objectstack']);

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    let isDir: boolean;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (isDir) walk(full, out);
    else if (entry.endsWith('.object.ts')) out.push(full);
  }
  return out;
}

/** The object name declared by an `ObjectSchema.create({ name: '…' })` file. */
function declaredObjectName(source: string): string | undefined {
  const idx = source.indexOf('ObjectSchema.create({');
  if (idx === -1) return undefined;
  const m = /name:\s*'([a-z0-9_]+)'/.exec(source.slice(idx));
  return m?.[1];
}

/** `packages/plugins/plugin-audit/src/x.object.ts` → `plugin-audit`. */
function owningPackage(file: string): string | undefined {
  const rel = file.slice(PACKAGES_DIR.length + 1);
  const parts = rel.split(/[\\/]/);
  const srcAt = parts.indexOf('src');
  if (srcAt < 1) return undefined;
  return parts[srcAt - 1];
}

function scanDeclaredObjects(): Map<string, Set<string>> {
  const byPackage = new Map<string, Set<string>>();
  for (const file of walk(PACKAGES_DIR)) {
    const pkg = owningPackage(file);
    if (!pkg) continue;
    const rel = file.slice(PACKAGES_DIR.length + 1);
    const topLevel = rel.split(/[\\/]/)[0];
    if (FIXTURE_PACKAGES.has(topLevel) || FIXTURE_PACKAGES.has(pkg)) continue;
    const name = declaredObjectName(readFileSync(file, 'utf8'));
    if (!name) continue;
    if (!byPackage.has(pkg)) byPackage.set(pkg, new Set());
    byPackage.get(pkg)!.add(name);
  }
  return byPackage;
}

const sorted = (v: Iterable<string>) => [...v].sort();

describe('PLATFORM_PROVIDED_OBJECT_NAMES — conformance with what packages register', () => {
  const declared = scanDeclaredObjects();

  it('finds the platform object sources (guards against a broken scan)', () => {
    // A silently-empty scan would make every assertion below vacuously pass.
    expect(declared.size).toBeGreaterThan(5);
    expect(declared.get('platform-objects')?.has('sys_user')).toBe(true);
  });

  it('registers exactly the objects each package declares', () => {
    for (const [pkg, names] of declared) {
      const registered = PLATFORM_OBJECTS_BY_PACKAGE[pkg];
      expect(registered, `package "${pkg}" declares objects but has no registry group`).toBeDefined();
      expect(sorted(registered ?? []), `registry group "${pkg}" is out of date`).toEqual(sorted(names));
    }
  });

  it('has no registry group for a package that declares no objects', () => {
    for (const pkg of Object.keys(PLATFORM_OBJECTS_BY_PACKAGE)) {
      expect(declared.has(pkg), `registry group "${pkg}" no longer matches any package`).toBe(true);
    }
  });

  it('every registered name carries a reserved platform prefix', () => {
    for (const name of PLATFORM_PROVIDED_OBJECT_NAMES) {
      expect(hasPlatformObjectPrefix(name), `"${name}" is not platform-prefixed`).toBe(true);
    }
  });

  it('cloud-only names are registered but not declared in this repo', () => {
    // They live in @objectstack/service-tenant (cloud repo, ADR-0003). If one
    // ever moves here, the group assertions above would flag it as unregistered.
    const allDeclared = new Set([...declared.values()].flatMap((s) => [...s]));
    for (const name of CLOUD_PROVIDED_OBJECT_NAMES) {
      expect(isPlatformProvidedObjectName(name)).toBe(true);
      expect(allDeclared.has(name), `"${name}" is now declared here — move it out of CLOUD_PROVIDED_OBJECT_NAMES`).toBe(false);
    }
  });
});

describe('platform-object predicates', () => {
  it('separates a real platform object from a fictional one', () => {
    // The exact bug the registry exists to catch: both are `sys_`-prefixed, so
    // the old heuristic exempted both. Only one is real.
    expect(isPlatformProvidedObjectName('sys_user')).toBe(true);
    expect(isPlatformProvidedObjectName('sys_approval_request')).toBe(true);
    expect(isPlatformProvidedObjectName('sys_approval_process')).toBe(false);
    expect(hasPlatformObjectPrefix('sys_approval_process')).toBe(true);
  });

  it('treats an unprefixed name as neither', () => {
    expect(hasPlatformObjectPrefix('crm_lead')).toBe(false);
    expect(isPlatformProvidedObjectName('user')).toBe(false);
  });
});
