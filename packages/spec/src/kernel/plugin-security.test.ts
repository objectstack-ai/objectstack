import { describe, it, expect } from 'vitest';
import {
  SecurityVulnerabilitySchema,
  SecurityScanResultSchema,
  SecurityPolicySchema,
  DependencyGraphSchema,
  PackageDependencyResolutionResultSchema,
  SBOMSchema,
  PluginProvenanceSchema,
  PluginTrustScoreSchema,
} from './plugin-security.zod';

describe('Plugin Security Protocol', () => {
  describe('SecurityVulnerability', () => {
    it('should validate vulnerability with CVE', () => {
      const validVuln = {
        cve: 'CVE-2024-12345',
        id: 'GHSA-xxxx-yyyy-zzzz',
        title: 'SQL Injection Vulnerability',
        description: 'A vulnerability that allows SQL injection',
        severity: 'high' as const,
        cvss: 7.5,
        package: {
          name: 'com.example.plugin',
          version: '1.0.0',
        },
        vulnerableVersions: '<1.2.0',
        patchedVersions: '>=1.2.0',
        references: [
          {
            type: 'advisory' as const,
            url: 'https://github.com/advisories/GHSA-xxxx',
          },
        ],
        cwe: ['CWE-89'],
      };

      const result = SecurityVulnerabilitySchema.safeParse(validVuln);
      expect(result.success).toBe(true);
    });
  });

  describe('SecurityScanResult', () => {
    it('should validate scan result with vulnerabilities', () => {
      const validScan = {
        scanId: '550e8400-e29b-41d4-a716-446655440000',
        plugin: {
          id: 'com.acme.crm',
          version: '1.0.0',
        },
        scannedAt: '2024-01-01T12:00:00Z',
        scanner: {
          name: 'snyk',
          version: '1.0.0',
        },
        status: 'warning' as const,
        vulnerabilities: [
          {
            id: 'GHSA-xxxx',
            title: 'Test Vulnerability',
            description: 'A test vulnerability',
            severity: 'medium' as const,
            package: {
              name: 'dependency-package',
              version: '2.0.0',
            },
            vulnerableVersions: '<3.0.0',
            references: [],
            cwe: [],
          },
        ],
        summary: {
          critical: 0,
          high: 0,
          medium: 1,
          low: 0,
          info: 0,
          total: 1,
        },
        licenseIssues: [],
      };

      const result = SecurityScanResultSchema.safeParse(validScan);
      expect(result.success).toBe(true);
    });
  });

  describe('SecurityPolicy', () => {
    it('should validate security policy', () => {
      const validPolicy = {
        id: 'default-policy',
        name: 'Default Security Policy',
        autoScan: {
          enabled: true,
          frequency: 'daily' as const,
        },
        thresholds: {
          maxCritical: 0,
          maxHigh: 0,
          maxMedium: 5,
        },
        allowedLicenses: ['MIT', 'Apache-2.0'],
        prohibitedLicenses: ['GPL-3.0'],
        sandbox: {
          networkAccess: 'allowlist' as const,
          allowedDestinations: ['api.example.com'],
          filesystemAccess: 'temp-only' as const,
          maxMemoryMB: 512,
          maxCPUSeconds: 30,
        },
      };

      const result = SecurityPolicySchema.safeParse(validPolicy);
      expect(result.success).toBe(true);
    });
  });

  describe('DependencyGraph', () => {
    it('should validate dependency graph', () => {
      const validGraph = {
        root: {
          id: 'com.acme.app',
          version: '1.0.0',
        },
        nodes: [
          {
            id: 'com.acme.app',
            version: '1.0.0',
            dependencies: [
              {
                name: 'com.acme.lib',
                versionConstraint: '^2.0.0',
                type: 'required' as const,
                resolvedVersion: '2.1.0',
              },
            ],
            depth: 0,
            isDirect: true,
          },
          {
            id: 'com.acme.lib',
            version: '2.1.0',
            dependencies: [],
            depth: 1,
            isDirect: false,
          },
        ],
        edges: [
          {
            from: 'com.acme.app',
            to: 'com.acme.lib',
            constraint: '^2.0.0',
          },
        ],
        stats: {
          totalDependencies: 2,
          directDependencies: 1,
          maxDepth: 1,
        },
      };

      const result = DependencyGraphSchema.safeParse(validGraph);
      expect(result.success).toBe(true);
    });
  });

  describe('PackageDependencyResolutionResult', () => {
    it('should validate successful resolution', () => {
      const validResult = {
        status: 'success' as const,
        graph: {
          root: {
            id: 'com.acme.app',
            version: '1.0.0',
          },
          nodes: [],
          edges: [],
          stats: {
            totalDependencies: 0,
            directDependencies: 0,
            maxDepth: 0,
          },
        },
        conflicts: [],
        errors: [],
        installOrder: ['com.acme.app'],
        resolvedInMs: 150,
      };

      const result = PackageDependencyResolutionResultSchema.safeParse(validResult);
      expect(result.success).toBe(true);
    });

    it('should validate resolution with conflicts', () => {
      const validResult = {
        status: 'conflict' as const,
        conflicts: [
          {
            package: 'com.acme.lib',
            conflicts: [
              {
                version: '1.0.0',
                requestedBy: ['com.acme.app'],
                constraint: '^1.0.0',
              },
              {
                version: '2.0.0',
                requestedBy: ['com.acme.plugin'],
                constraint: '^2.0.0',
              },
            ],
            resolution: {
              strategy: 'pick-highest' as const,
              version: '2.0.0',
              reason: 'Using highest compatible version',
            },
            severity: 'warning' as const,
          },
        ],
        errors: [],
        installOrder: [],
      };

      const result = PackageDependencyResolutionResultSchema.safeParse(validResult);
      expect(result.success).toBe(true);
    });
  });

  describe('SBOM', () => {
    it('should validate Software Bill of Materials', () => {
      const validSBOM = {
        format: 'cyclonedx' as const,
        version: '1.4',
        plugin: {
          id: 'com.acme.crm',
          version: '1.0.0',
          name: 'Advanced CRM',
        },
        components: [
          {
            name: 'lodash',
            version: '4.17.21',
            license: 'MIT',
            hashes: {
              sha256: 'abcd1234...',
            },
            externalRefs: [
              {
                type: 'repository' as const,
                url: 'https://github.com/lodash/lodash',
              },
            ],
          },
        ],
        generatedAt: '2024-01-01T00:00:00Z',
        generator: {
          name: 'cyclonedx-cli',
          version: '0.24.0',
        },
      };

      const result = SBOMSchema.safeParse(validSBOM);
      expect(result.success).toBe(true);
    });
  });

  describe('PluginProvenance', () => {
    it('should validate plugin provenance', () => {
      const validProvenance = {
        pluginId: 'com.acme.crm',
        version: '1.0.0',
        build: {
          timestamp: '2024-01-01T00:00:00Z',
          environment: {
            os: 'linux',
            arch: 'x64',
            nodeVersion: '18.0.0',
          },
          source: {
            repository: 'https://github.com/acme/crm',
            commit: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
            branch: 'main',
            tag: 'v1.0.0',
          },
          builder: {
            name: 'GitHub Actions',
            email: 'ci@acme.com',
          },
        },
        artifacts: [
          {
            filename: 'plugin.tar.gz',
            sha256: 'abcd1234...',
            size: 1048576,
          },
        ],
        signatures: [
          {
            algorithm: 'rsa' as const,
            publicKey: '-----BEGIN PUBLIC KEY-----...',
            signature: 'signature-data',
            signedBy: 'release-bot@acme.com',
            timestamp: '2024-01-01T00:05:00Z',
          },
        ],
        attestations: [
          {
            type: 'security-scan' as const,
            status: 'passed' as const,
            url: 'https://scans.acme.com/123',
            timestamp: '2024-01-01T00:10:00Z',
          },
        ],
      };

      const result = PluginProvenanceSchema.safeParse(validProvenance);
      expect(result.success).toBe(true);
    });
  });

  describe('PluginTrustScore', () => {
    it('should validate plugin trust score', () => {
      const validScore = {
        pluginId: 'com.acme.crm',
        score: 85,
        components: {
          vendorReputation: 90,
          securityScore: 85,
          codeQuality: 80,
          communityScore: 85,
          maintenanceScore: 90,
        },
        level: 'trusted' as const,
        badges: ['verified-vendor', 'security-scanned', 'popular'] as const,
        updatedAt: '2024-01-01T00:00:00Z',
      };

      const result = PluginTrustScoreSchema.safeParse(validScore);
      expect(result.success).toBe(true);
    });
  });
});
