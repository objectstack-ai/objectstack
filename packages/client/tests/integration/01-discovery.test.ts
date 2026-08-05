/**
 * Integration Test: Discovery & Connection
 * 
 * Tests the client's ability to discover and connect to an ObjectStack server.
 * These tests require a running server instance.
 * 
 * @see CLIENT_SERVER_INTEGRATION_TESTS.md for full test specification
 */

import { describe, test, expect } from 'vitest';
import { ObjectStackClient } from '../../src/index';

const TEST_SERVER_URL = process.env.TEST_SERVER_URL || 'http://localhost:3000';

describe('Discovery & Connection', () => {
  describe('TC-DISC-001: Protocol-standard Discovery via /api/v1/discovery', () => {
    test('should discover API from /api/v1/discovery', async () => {
      const client = new ObjectStackClient({
        baseUrl: TEST_SERVER_URL,
        debug: true
      });

      const discovery = await client.connect();

      expect(discovery.version).toBeDefined();
      expect(discovery.apiName).toBeDefined();
      expect(discovery.routes).toBeDefined();
      expect(discovery.services).toBeDefined();
    });
  });

  describe('TC-DISC-002: Discovery Information', () => {
    test('should provide valid API version information', async () => {
      const client = new ObjectStackClient({ baseUrl: TEST_SERVER_URL });
      const discovery = await client.connect();
      
      // Version should be a semantic version or API version string
      expect(discovery.version).toMatch(/^v?\d+/);

      // API name should be non-empty. `apiName` is optional on the discovery
      // payload (spec `protocol.zod.ts` keeps it as the deprecated alias for
      // `name`), so it is reached optionally and asserted — a missing value
      // fails `toBeGreaterThan` rather than being waved through by a `!` or a
      // `?? ''` default (#5449).
      expect(discovery.apiName?.length).toBeGreaterThan(0);
    });
  });

  describe('TC-DISC-003: Connection Failure Handling', () => {
    test('should throw error when server is unreachable', async () => {
      const client = new ObjectStackClient({ 
        baseUrl: 'http://localhost:9999' // Invalid port
      });
      
      await expect(client.connect()).rejects.toThrow();
    });
  });

  describe('TC-DISC-004: Route Resolution', () => {
    test('should resolve API routes from discovery info', async () => {
      const client = new ObjectStackClient({ baseUrl: TEST_SERVER_URL });
      await client.connect();

      // After connection, the client should have retained the discovery info.
      // `ObjectStackClient` has no public `discovery` property — the one this
      // case asserted until #5544 never existed on the class; the payload is
      // held on the private `discoveryInfo` field (`src/index.ts`), which is
      // what `getRoute()` steers every subsequent call with. It is read here
      // through the bracket-notation escape hatch, exactly as this package's
      // `src/client.hono.test.ts` already reads the same field — no public API
      // is invented on behalf of a suite no type checker had ever compiled.
      const discoveryInfo = client['discoveryInfo'];
      expect(discoveryInfo).toBeDefined();
      expect(discoveryInfo?.version).toBeDefined();

      // Route resolution is what this case is named for: the routes map
      // `getRoute()` reads has to be populated for subsequent API calls to be
      // steered at all.
      expect(discoveryInfo?.routes).toBeDefined();
    });
  });
});
