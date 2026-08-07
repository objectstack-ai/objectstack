// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * SBOM (Software Bill of Materials) Generator
 *
 * Generates a CycloneDX-compatible SBOM in JSON format for all packages in the monorepo.
 * Run with: tsx scripts/generate-sbom.ts
 */

import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');

interface SBOMComponent {
  type: string;
  name: string;
  version: string;
  purl: string;
  licenses: Array<{ license: { id: string } }>;
  description?: string;
}

interface SBOM {
  bomFormat: string;
  specVersion: string;
  version: number;
  metadata: {
    timestamp: string;
    tools: Array<{ name: string; version: string }>;
    component: {
      type: string;
      name: string;
      version: string;
    };
  };
  components: SBOMComponent[];
}

const ALLOWED_LICENSES = [
  'MIT',
  'Apache-2.0',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'CC0-1.0',
  'Unlicense',
  'BlueOak-1.0.0',
  'CC-BY-4.0',
  'Python-2.0',
];

function findPackageJsonFiles(dir: string): string[] {
  const results: string[] = [];
  
  // Monorepo root
  const rootPkg = path.join(dir, 'package.json');
  if (fs.existsSync(rootPkg)) {
    results.push(rootPkg);
  }

  // Workspace packages
  const workspaceDirs = [
    path.join(dir, 'packages'),
    path.join(dir, 'apps'),
  ];

  for (const wsDir of workspaceDirs) {
    if (!fs.existsSync(wsDir)) continue;
    for (const entry of fs.readdirSync(wsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      
      // Check nested dirs (e.g., packages/adapters/hono)
      const nestedPkg = path.join(wsDir, entry.name, 'package.json');
      if (fs.existsSync(nestedPkg)) {
        results.push(nestedPkg);
      }
      
      // Check for sub-workspace packages
      const subDir = path.join(wsDir, entry.name);
      for (const subEntry of fs.readdirSync(subDir, { withFileTypes: true })) {
        if (!subEntry.isDirectory()) continue;
        const subPkg = path.join(subDir, subEntry.name, 'package.json');
        if (fs.existsSync(subPkg)) {
          results.push(subPkg);
        }
      }
    }
  }

  return results;
}

function collectDependencies(pkgFiles: string[]): Map<string, { version: string; license?: string }> {
  const deps = new Map<string, { version: string; license?: string }>();

  for (const pkgFile of pkgFiles) {
    const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf-8'));
    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.peerDependencies,
    };

    for (const [name, version] of Object.entries(allDeps)) {
      if (typeof version !== 'string') continue;
      if (version.startsWith('workspace:')) continue; // Skip workspace deps
      if (!deps.has(name)) {
        deps.set(name, { version: String(version).replace(/^[\^~]/, '') });
      }
    }
  }

  return deps;
}

function resolveLicense(name: string): string {
  // Try to find the license from node_modules
  const possiblePaths = [
    path.join(ROOT, '..', '..', 'node_modules', name, 'package.json'),
    path.join(ROOT, 'node_modules', name, 'package.json'),
  ];

  for (const p of possiblePaths) {
    try {
      const pkg = JSON.parse(fs.readFileSync(p, 'utf-8'));
      return pkg.license || 'UNKNOWN';
    } catch {
      // continue
    }
  }
  return 'UNKNOWN';
}

// ─── Execution ──────────────────────────────────────────────────────

const monoRoot = path.resolve(ROOT, '..', '..');
const pkgFiles = findPackageJsonFiles(monoRoot);
const rootPkg = JSON.parse(fs.readFileSync(path.join(monoRoot, 'package.json'), 'utf-8'));

console.log('📋 Generating SBOM (CycloneDX format)...');
console.log(`  Found ${pkgFiles.length} package.json files`);

const deps = collectDependencies(pkgFiles);
console.log(`  Found ${deps.size} external dependencies`);

const components: SBOMComponent[] = [];
const licenseIssues: Array<{ name: string; license: string }> = [];

for (const [name, info] of deps) {
  const license = resolveLicense(name);
  
  components.push({
    type: 'library',
    name,
    version: info.version,
    purl: `pkg:npm/${encodeURIComponent(name)}@${info.version}`,
    licenses: license !== 'UNKNOWN' ? [{ license: { id: license } }] : [],
    description: undefined,
  });

  if (license !== 'UNKNOWN' && !ALLOWED_LICENSES.includes(license)) {
    licenseIssues.push({ name, license });
  }
}

const sbom: SBOM = {
  bomFormat: 'CycloneDX',
  specVersion: '1.4',
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    tools: [{ name: '@objectstack/spec-sbom-generator', version: '1.0.0' }],
    component: {
      type: 'application',
      name: rootPkg.name || '@objectstack/spec-monorepo',
      version: rootPkg.version || '0.0.0',
    },
  },
  components: components.sort((a, b) => a.name.localeCompare(b.name)),
};

// Write SBOM
const outPath = path.join(monoRoot, 'sbom.json');
fs.writeFileSync(outPath, JSON.stringify(sbom, null, 2));
console.log(`\n✅ SBOM generated: ${outPath}`);
console.log(`   Components: ${components.length}`);

// License validation
if (licenseIssues.length > 0) {
  console.log(`\n⚠️  License compatibility issues (${licenseIssues.length}):`);
  for (const issue of licenseIssues) {
    console.log(`   ${issue.name}: ${issue.license}`);
  }
  console.log(`\n   Allowed licenses: ${ALLOWED_LICENSES.join(', ')}`);
} else {
  console.log(`\n✅ All resolved licenses are compatible`);
}
