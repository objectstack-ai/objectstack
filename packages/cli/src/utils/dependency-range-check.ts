// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import {
  checkDeclaredDependencies,
  DEPENDENCY_RANGE_GRAMMAR,
  type DependencyDeclaringManifest,
  type InstalledDependencyRecord,
  type UnmetDependency,
} from '@objectstack/metadata-core';

/**
 * ADR-0141 D2, author side — the `manifest.dependencies` ranges an author
 * hears about at build instead of from a refused install.
 *
 * Two findings, both judged on the packages ONE install act would deliver:
 *
 *  1. **An unreadable range** — a value outside {@link DEPENDENCY_RANGE_GRAMMAR}.
 *  2. **An in-artifact range mismatch** — inside one ADR-0130 artifact, an
 *     entry naming a SIBLING package whose own `manifest.version` the range
 *     does not admit (core bumped to `2.0.0` while a module still declares
 *     `^1.0.0`). The install judges a co-delivered entry for presence only, so
 *     this is the mismatch's only reporter.
 *
 * Entries naming a package outside the artifact are judged for readability
 * only: whether such a package is installed, and at what version, is a fact of
 * the target environment, which no build can see (ADR-0141 §Consequences).
 *
 * ## ⛔ One reader — this module parses nothing
 *
 * D2 allows one dependency-range reader, never a second. Every verdict here is
 * `@objectstack/metadata-core`'s `checkDeclaredDependencies`, the predicate the
 * install doors call. Each delivered package is handed to it ALONE, with its
 * siblings standing in for the registry: a sibling then reads as "installed at
 * its declared version", so the predicate's own `out-of-range` arm is the
 * in-artifact mismatch, and its `unreadable-range` arm is finding 1. Its
 * `absent` arm is an out-of-artifact entry this module does not judge, and is
 * dropped.
 *
 * ## Which packages are judged — the install door's selection
 *
 * `packages[].manifest` when the stack carries `packages[]`, the top-level
 * `manifest` otherwise — the selection the artifact install door hands the same
 * predicate (`marketplace-install-local-plugin.ts`). An artifact's own wrapper
 * manifest is not a package and is not judged, there or here.
 *
 * ## Severity follows the install's verdict, and nothing else
 *
 * - `error` — exactly the entries the install refuses whatever the target
 *   environment holds: an unreadable range on an out-of-artifact entry (fail
 *   closed — no installed version can satisfy it), and a `dependencies` that
 *   is not a record. `os build` refusing them refuses nothing the install
 *   would accept.
 * - `warning` — what the install ADMITS: a co-delivered entry (presence only)
 *   whose range is unreadable, or does not admit the sibling's version, or
 *   whose sibling declares no readable version. ⛔ Raising these to `error`
 *   would narrow what `os build` accepts past what the platform installs.
 */

/** The four findings, by the fact the author acts on. */
export type DependencyRangeCode =
  | 'dependency_range_unreadable'
  | 'dependency_declaration_unreadable'
  | 'dependency_range_unmet_in_artifact'
  | 'dependency_version_unreadable_in_artifact';

export interface DependencyRangeDiagnostic {
  readonly code: DependencyRangeCode;
  readonly severity: 'error' | 'warning';
  /** The delivered package that declares the entry. */
  readonly packageId: string;
  /** The declared dependency id; absent for `dependency_declaration_unreadable`. */
  readonly dependency?: string;
  /** The declared range, as written. */
  readonly range?: string;
  /** Whether `dependency` is a package of this same artifact. */
  readonly inArtifact?: boolean;
  /** The sibling's declared `manifest.version`, when `dependency` is one and declares it. */
  readonly siblingVersion?: string;
  /** Where the entry sits in the authored stack. */
  readonly path: string;
  readonly message: string;
  readonly fix: string;
}

type Bag = Record<string, unknown>;

const isBag = (value: unknown): value is Bag => !!value && typeof value === 'object' && !Array.isArray(value);

/** The id a delivered manifest installs under — `id || name`, the registry's key. */
function deliveredId(manifest: Bag): string | undefined {
  const id = manifest.id || manifest.name;
  return typeof id === 'string' && id !== '' ? id : undefined;
}

/**
 * The packages one install act would deliver, with the path prefix each is
 * authored at. Exported for the install-door agreement pin.
 */
export function deliveredPackages(stack: unknown): Array<{ manifest: Bag; at: string }> {
  if (!isBag(stack)) return [];
  if (Array.isArray(stack.packages)) {
    return stack.packages.flatMap((entry, index) =>
      isBag(entry) && isBag(entry.manifest) ? [{ manifest: entry.manifest, at: `packages[${index}].manifest` }] : []);
  }
  return isBag(stack.manifest) ? [{ manifest: stack.manifest, at: 'manifest' }] : [];
}

function diagnosticOf(
  entry: UnmetDependency,
  at: string,
  siblings: ReadonlyMap<string, Bag>,
): DependencyRangeDiagnostic | null {
  if (entry.found === 'unreadable-declaration') {
    return {
      code: 'dependency_declaration_unreadable',
      severity: 'error',
      packageId: entry.packageId,
      path: `${at}.dependencies`,
      message:
        `Package '${entry.packageId}' declares \`dependencies\` in a shape that is not a `
        + '{ "PACKAGE_ID": "VERSION_RANGE" } record, so every install of it is refused.',
      fix: "Write `dependencies` as a record of package id to version range, e.g. { 'com.acme.core': '^1.0.0' }.",
    };
  }
  // Out-of-artifact and not installed: a question for the target environment.
  if (entry.found === 'absent') return null;
  const { packageId, dependency, range } = entry;
  const inArtifact = siblings.has(dependency);
  const path = `${at}.dependencies[${JSON.stringify(dependency)}]`;
  const siblingVersion = entry.installedVersion;
  const base = { packageId, dependency, range, inArtifact, path };
  // The predicate reads a sibling's missing version as an installed record
  // with none, which names the version side as unreadable.
  if (entry.found === 'unreadable-range') {
    return {
      ...base,
      code: 'dependency_range_unreadable',
      severity: inArtifact ? 'warning' : 'error',
      ...(siblingVersion === undefined ? {} : { siblingVersion }),
      message: inArtifact
        ? `Package '${packageId}' depends on '${dependency}' with the range '${range}', which is not a readable `
          + 'version range. This artifact delivers that package, so its install is judged for presence only, '
          + 'but no standalone install of this package can satisfy the range.'
        : `Package '${packageId}' depends on '${dependency}' with the range '${range}', which is not a readable `
          + 'version range, so every install of this package is refused: no installed version can satisfy it.',
      fix: `Rewrite the range in the supported grammar: ${DEPENDENCY_RANGE_GRAMMAR}.`,
    };
  }
  if (entry.found === 'out-of-range') {
    return {
      ...base,
      code: 'dependency_range_unmet_in_artifact',
      severity: 'warning',
      ...(siblingVersion === undefined ? {} : { siblingVersion }),
      message:
        `Package '${packageId}' depends on '${dependency}' ${range}, but this artifact delivers '${dependency}' `
        + `at version ${siblingVersion}, outside that range. The install admits it (a package the same artifact `
        + 'delivers is judged for presence only), so nothing else reports the mismatch.',
      fix: `Widen the range in '${packageId}' to admit ${siblingVersion}, or set '${dependency}' to a version inside ${range}.`,
    };
  }
  return {
    ...base,
    code: 'dependency_version_unreadable_in_artifact',
    severity: 'warning',
    ...(siblingVersion === undefined ? {} : { siblingVersion }),
    message:
      `Package '${packageId}' depends on '${dependency}' ${range}, and this artifact delivers '${dependency}' `
      + `with ${siblingVersion === undefined ? 'no version' : `the version '${siblingVersion}'`} — not a readable `
      + 'MAJOR.MINOR.PATCH version (a prerelease is outside the grammar), so the range cannot be judged against it.',
    fix: `Give '${dependency}' a MAJOR.MINOR.PATCH \`manifest.version\`.`,
  };
}

/**
 * Every `dependencies` finding for the packages `stack` delivers, in package
 * then declaration order — empty when there is nothing to report. Pure; reads
 * a parsed or a normalized stack alike.
 */
export function checkDependencyRanges(stack: unknown): DependencyRangeDiagnostic[] {
  const delivered = deliveredPackages(stack);
  const byId = new Map<string, Bag>();
  for (const { manifest } of delivered) {
    const id = deliveredId(manifest);
    if (id !== undefined && !byId.has(id)) byId.set(id, manifest);
  }
  const diagnostics: DependencyRangeDiagnostic[] = [];
  for (const { manifest, at } of delivered) {
    const ownId = deliveredId(manifest);
    const siblings = new Map([...byId].filter(([id]) => id !== ownId));
    const unmet = checkDeclaredDependencies({
      delivered: [manifest as DependencyDeclaringManifest],
      getInstalled: (id): InstalledDependencyRecord | undefined => {
        const sibling = siblings.get(id);
        return sibling === undefined ? undefined : { manifest: { version: sibling.version } };
      },
    });
    for (const entry of unmet) {
      const diagnostic = diagnosticOf(entry, at, siblings);
      if (diagnostic !== null) diagnostics.push(diagnostic);
    }
  }
  return diagnostics;
}

/** One diagnostic as a printed line: `[code] path: message Fix: fix`. */
export function formatDependencyRangeDiagnostic(d: DependencyRangeDiagnostic): string {
  return `[${d.code}] ${d.path}: ${d.message} Fix: ${d.fix}`;
}
