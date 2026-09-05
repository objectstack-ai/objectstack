import { describe, expect, it } from 'vitest';
import {
  SemanticVersionSchema,
  VersionConstraintSchema,
  CompatibilityLevelSchema,
  BreakingChangeSchema,
  DeprecationNoticeSchema,
  CompatibilityMatrixEntrySchema,
  PluginCompatibilityMatrixSchema,
  DependencyConflictSchema,
  PluginDependencyResolutionResultSchema,
  MultiVersionSupportSchema,
  PluginVersionMetadataSchema,
} from './plugin-versioning.zod';

describe('Plugin Versioning Schemas', () => {
  describe('SemanticVersionSchema', () => {
    it('should validate semantic version', () => {
      const version = {
        major: 1,
        minor: 2,
        patch: 3,
      };
      const result = SemanticVersionSchema.parse(version);
      expect(result.major).toBe(1);
      expect(result.minor).toBe(2);
      expect(result.patch).toBe(3);
    });

    it('should validate version with pre-release', () => {
      const version = {
        major: 2,
        minor: 0,
        patch: 0,
        preRelease: 'beta.1',
      };
      const result = SemanticVersionSchema.parse(version);
      expect(result.preRelease).toBe('beta.1');
    });

    it('should validate version with build metadata', () => {
      const version = {
        major: 1,
        minor: 0,
        patch: 0,
        build: '20240203.1',
      };
      const result = SemanticVersionSchema.parse(version);
      expect(result.build).toBe('20240203.1');
    });

    it('should reject negative version numbers', () => {
      expect(() => SemanticVersionSchema.parse({ major: -1, minor: 0, patch: 0 })).toThrow();
    });
  });

  describe('VersionConstraintSchema', () => {
    it('should validate exact version', () => {
      expect(() => VersionConstraintSchema.parse('1.2.3')).not.toThrow();
    });

    it('should validate caret range', () => {
      expect(() => VersionConstraintSchema.parse('^1.2.3')).not.toThrow();
    });

    it('should validate tilde range', () => {
      expect(() => VersionConstraintSchema.parse('~1.2.3')).not.toThrow();
    });

    it('should validate comparison operators', () => {
      expect(() => VersionConstraintSchema.parse('>=1.2.3')).not.toThrow();
      expect(() => VersionConstraintSchema.parse('>1.2.3')).not.toThrow();
      expect(() => VersionConstraintSchema.parse('<=1.2.3')).not.toThrow();
      expect(() => VersionConstraintSchema.parse('<1.2.3')).not.toThrow();
    });

    it('should validate range', () => {
      expect(() => VersionConstraintSchema.parse('1.2.3 - 2.3.4')).not.toThrow();
    });

    it('should validate wildcards', () => {
      expect(() => VersionConstraintSchema.parse('*')).not.toThrow();
      expect(() => VersionConstraintSchema.parse('latest')).not.toThrow();
    });
  });

  describe('CompatibilityLevelSchema', () => {
    it('should validate all compatibility levels', () => {
      expect(() => CompatibilityLevelSchema.parse('fully-compatible')).not.toThrow();
      expect(() => CompatibilityLevelSchema.parse('backward-compatible')).not.toThrow();
      expect(() => CompatibilityLevelSchema.parse('deprecated-compatible')).not.toThrow();
      expect(() => CompatibilityLevelSchema.parse('breaking-changes')).not.toThrow();
      expect(() => CompatibilityLevelSchema.parse('incompatible')).not.toThrow();
    });
  });

  describe('BreakingChangeSchema', () => {
    it('should validate breaking change', () => {
      const change = {
        introducedIn: '2.0.0',
        type: 'api-removed' as const,
        description: 'Removed deprecated getUser method',
        migrationGuide: 'Use getUserById instead',
        deprecatedIn: '1.8.0',
        removedIn: '2.0.0',
        automatedMigration: true,
        severity: 'major' as const,
      };
      const result = BreakingChangeSchema.parse(change);
      expect(result.type).toBe('api-removed');
      expect(result.severity).toBe('major');
    });

    it('should validate all breaking change types', () => {
      const types = [
        'api-removed',
        'api-renamed',
        'api-signature-changed',
        'behavior-changed',
        'dependency-changed',
        'configuration-changed',
        'protocol-changed',
      ] as const;

      types.forEach((type) => {
        const change = {
          introducedIn: '2.0.0',
          type,
          description: 'Test change',
          severity: 'minor' as const,
        };
        expect(() => BreakingChangeSchema.parse(change)).not.toThrow();
      });
    });
  });

  describe('DeprecationNoticeSchema', () => {
    it('should validate deprecation notice', () => {
      const notice = {
        feature: 'getUser',
        deprecatedIn: '1.8.0',
        removeIn: '2.0.0',
        reason: 'Replaced with more efficient getUserById',
        alternative: 'getUserById',
        migrationPath: 'Replace getUser() calls with getUserById()',
      };
      const result = DeprecationNoticeSchema.parse(notice);
      expect(result.feature).toBe('getUser');
      expect(result.alternative).toBe('getUserById');
    });
  });

  describe('CompatibilityMatrixEntrySchema', () => {
    it('should validate compatibility matrix entry', () => {
      const entry = {
        from: '1.0.0',
        to: '2.0.0',
        compatibility: 'breaking-changes' as const,
        breakingChanges: [
          {
            introducedIn: '2.0.0',
            type: 'api-removed' as const,
            description: 'Removed old API',
            severity: 'major' as const,
          },
        ],
        migrationRequired: true,
        migrationComplexity: 'moderate' as const,
        estimatedMigrationTime: 8,
        migrationScript: './scripts/migrate-v1-to-v2.ts',
        testCoverage: 95,
      };
      const result = CompatibilityMatrixEntrySchema.parse(entry);
      expect(result.compatibility).toBe('breaking-changes');
      expect(result.migrationRequired).toBe(true);
      expect(result.estimatedMigrationTime).toBe(8);
    });
  });

  describe('PluginCompatibilityMatrixSchema', () => {
    it('should validate plugin compatibility matrix', () => {
      const matrix = {
        pluginId: 'com.acme.plugin',
        currentVersion: '2.0.0',
        compatibilityMatrix: [
          {
            from: '1.0.0',
            to: '2.0.0',
            compatibility: 'breaking-changes' as const,
            migrationRequired: true,
          },
        ],
        supportedVersions: [
          {
            version: '2.0.0',
            supported: true,
            securitySupport: true,
          },
          {
            version: '1.9.0',
            supported: true,
            securitySupport: true,
          },
          {
            version: '1.0.0',
            supported: false,
            endOfLife: new Date('2025-12-31').toISOString(),
            securitySupport: false,
          },
        ],
        minimumCompatibleVersion: '1.8.0',
      };
      const result = PluginCompatibilityMatrixSchema.parse(matrix);
      expect(result.currentVersion).toBe('2.0.0');
      expect(result.supportedVersions).toHaveLength(3);
    });
  });

  describe('DependencyConflictSchema', () => {
    it('should validate version mismatch conflict', () => {
      const conflict = {
        type: 'version-mismatch' as const,
        plugins: [
          {
            pluginId: 'com.acme.plugin-a',
            version: '1.0.0',
            requirement: '^2.0.0 of com.acme.shared',
          },
          {
            pluginId: 'com.acme.plugin-b',
            version: '1.0.0',
            requirement: '^1.0.0 of com.acme.shared',
          },
        ],
        description: 'Plugin A requires v2.x of shared, but Plugin B requires v1.x',
        resolutions: [
          {
            strategy: 'upgrade' as const,
            description: 'Upgrade Plugin B to version that supports shared v2.x',
            automaticResolution: false,
            riskLevel: 'medium' as const,
          },
        ],
        severity: 'error' as const,
      };
      const result = DependencyConflictSchema.parse(conflict);
      expect(result.type).toBe('version-mismatch');
      expect(result.plugins).toHaveLength(2);
      expect(result.resolutions).toHaveLength(1);
    });

    it('should validate circular dependency conflict', () => {
      const conflict = {
        type: 'circular-dependency' as const,
        plugins: [
          {
            pluginId: 'com.acme.plugin-a',
            version: '1.0.0',
          },
          {
            pluginId: 'com.acme.plugin-b',
            version: '1.0.0',
          },
        ],
        description: 'Plugin A depends on Plugin B, which depends on Plugin A',
        severity: 'critical' as const,
      };
      const result = DependencyConflictSchema.parse(conflict);
      expect(result.type).toBe('circular-dependency');
      expect(result.severity).toBe('critical');
    });
  });

  describe('PluginDependencyResolutionResultSchema', () => {
    it('should validate successful resolution', () => {
      const result = {
        success: true,
        resolved: [
          {
            pluginId: 'com.acme.plugin-a',
            version: '^1.0.0',
            resolvedVersion: '1.2.3',
          },
          {
            pluginId: 'com.acme.plugin-b',
            version: '~2.0.0',
            resolvedVersion: '2.0.5',
          },
        ],
        installationOrder: ['com.acme.plugin-b', 'com.acme.plugin-a'],
        dependencyGraph: {
          'com.acme.plugin-a': ['com.acme.plugin-b'],
          'com.acme.plugin-b': [],
        },
      };
      const parsed = PluginDependencyResolutionResultSchema.parse(result);
      expect(parsed.success).toBe(true);
      expect(parsed.resolved).toHaveLength(2);
      expect(parsed.installationOrder).toEqual(['com.acme.plugin-b', 'com.acme.plugin-a']);
    });

    it('should validate failed resolution with conflicts', () => {
      const result = {
        success: false,
        conflicts: [
          {
            type: 'version-mismatch' as const,
            plugins: [
              { pluginId: 'plugin-a', version: '1.0.0' },
              { pluginId: 'plugin-b', version: '1.0.0' },
            ],
            description: 'Version conflict',
            severity: 'error' as const,
          },
        ],
        warnings: ['Plugin C is deprecated'],
      };
      const parsed = PluginDependencyResolutionResultSchema.parse(result);
      expect(parsed.success).toBe(false);
      expect(parsed.conflicts).toHaveLength(1);
    });
  });

  describe('MultiVersionSupportSchema', () => {
    it('should validate multi-version support with defaults', () => {
      const config = MultiVersionSupportSchema.parse({});
      expect(config.enabled).toBe(false);
      expect(config.maxConcurrentVersions).toBe(2);
      expect(config.selectionStrategy).toBe('latest');
    });

    it('should validate multi-version with routing', () => {
      const config = {
        enabled: true,
        maxConcurrentVersions: 3,
        selectionStrategy: 'custom' as const,
        routing: [
          {
            condition: 'tenant.isPremium',
            version: '2.0.0',
            priority: 100,
          },
          {
            condition: 'user.betaTester',
            version: '2.1.0-beta',
            priority: 200,
          },
        ],
        rollout: {
          enabled: true,
          strategy: 'canary' as const,
          percentage: 10,
          durationMs: 3600000,
        },
      };
      const result = MultiVersionSupportSchema.parse(config);
      expect(result.enabled).toBe(true);
      expect(result.routing).toHaveLength(2);
      expect(result.rollout?.strategy).toBe('canary');
    });
  });

  describe('PluginVersionMetadataSchema', () => {
    it('should validate complete version metadata', () => {
      const metadata = {
        pluginId: 'com.acme.plugin',
        version: {
          major: 1,
          minor: 2,
          patch: 3,
        },
        versionString: '1.2.3',
        releaseDate: new Date().toISOString(),
        releaseNotes: 'Bug fixes and improvements',
        breakingChanges: [
          {
            introducedIn: '1.2.0',
            type: 'api-signature-changed' as const,
            description: 'Changed method signature',
            severity: 'minor' as const,
          },
        ],
        securityFixes: [
          {
            cve: 'CVE-2024-12345',
            severity: 'high' as const,
            description: 'XSS vulnerability',
            fixedIn: '1.2.3',
          },
        ],
        statistics: {
          downloads: 10000,
          installations: 5000,
          ratings: 4.5,
        },
        support: {
          status: 'active' as const,
          securitySupport: true,
        },
      };
      const result = PluginVersionMetadataSchema.parse(metadata);
      expect(result.versionString).toBe('1.2.3');
      expect(result.statistics?.downloads).toBe(10000);
      expect(result.support.status).toBe('active');
    });
  });

  describe('Integration scenarios', () => {
    it('should handle major version upgrade with breaking changes', () => {
      const matrixEntry = CompatibilityMatrixEntrySchema.parse({
        from: '1.9.0',
        to: '2.0.0',
        compatibility: 'breaking-changes',
        breakingChanges: [
          {
            introducedIn: '2.0.0',
            type: 'api-removed',
            description: 'Removed legacy API',
            severity: 'critical',
          },
        ],
        migrationRequired: true,
        migrationComplexity: 'major',
        estimatedMigrationTime: 40,
      });
      expect(matrixEntry.migrationRequired).toBe(true);
      expect(matrixEntry.migrationComplexity).toBe('major');
    });

    it('should handle dependency conflict resolution', () => {
      const resolution = PluginDependencyResolutionResultSchema.parse({
        success: false,
        conflicts: [
          {
            type: 'incompatible-versions',
            plugins: [
              { pluginId: 'plugin-a', version: '1.0.0' },
              { pluginId: 'plugin-b', version: '2.0.0' },
            ],
            description: 'Incompatible versions',
            resolutions: [
              {
                strategy: 'upgrade',
                description: 'Upgrade plugin-a',
                automaticResolution: true,
                riskLevel: 'low',
              },
            ],
            severity: 'warning',
          },
        ],
      });
      expect(resolution.conflicts?.[0].resolutions?.[0].strategy).toBe('upgrade');
    });
  });
});
