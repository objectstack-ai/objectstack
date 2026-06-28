// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { ObjectQL } from './engine.js';

describe('ObjectStackProtocolImplementation - Dynamic Service Discovery', () => {
  let protocol: ObjectStackProtocolImplementation;
  let engine: ObjectQL;
  
  beforeEach(() => {
    engine = new ObjectQL();
  });

  it('should return unavailable auth service when no services registered', async () => {
    // Create protocol without service registry
    protocol = new ObjectStackProtocolImplementation(engine);
    
    const discovery = await protocol.getDiscovery();
    
    expect(discovery.services.auth).toBeDefined();
    expect(discovery.services.auth.enabled).toBe(false);
    expect(discovery.services.auth.status).toBe('unavailable');
    expect(discovery.services.auth.message).toContain('plugin-auth');
    // capabilities removed — derive from services
    expect(discovery.services.workflow).toBeDefined();
    expect(discovery.services.workflow.enabled).toBe(false);
  });

  it('should return available auth service when auth is registered', async () => {
    // Mock service registry with auth service
    const mockServices = new Map<string, any>();
    mockServices.set('auth', { /* mock auth service */ });
    
    protocol = new ObjectStackProtocolImplementation(engine, () => mockServices);
    
    const discovery = await protocol.getDiscovery();
    
    expect(discovery.services.auth).toBeDefined();
    expect(discovery.services.auth.enabled).toBe(true);
    expect(discovery.services.auth.status).toBe('available');
    expect(discovery.services.auth.route).toBe('/api/v1/auth');
    expect(discovery.services.auth.provider).toBe('plugin-auth');
    expect(discovery.routes.auth).toBe('/api/v1/auth');
  });

  it('should return available automation service when registered', async () => {
    const mockServices = new Map<string, any>();
    mockServices.set('automation', { /* mock automation service */ });
    
    protocol = new ObjectStackProtocolImplementation(engine, () => mockServices);
    
    const discovery = await protocol.getDiscovery();
    
    expect(discovery.services.automation).toBeDefined();
    expect(discovery.services.automation.enabled).toBe(true);
    expect(discovery.services.automation.status).toBe('available');
  });

  it('should return multiple available services when registered', async () => {
    const mockServices = new Map<string, any>();
    mockServices.set('auth', {});
    mockServices.set('realtime', {});
    mockServices.set('ai', {});
    
    protocol = new ObjectStackProtocolImplementation(engine, () => mockServices);
    
    const discovery = await protocol.getDiscovery();
    
    // Check auth
    expect(discovery.services.auth.enabled).toBe(true);
    expect(discovery.services.auth.status).toBe('available');
    
    // Check realtime
    expect(discovery.services.realtime.enabled).toBe(true);
    expect(discovery.services.realtime.status).toBe('available');
    
    // Check AI
    expect(discovery.services.ai.enabled).toBe(true);
    expect(discovery.services.ai.status).toBe('available');
    
    // Routes should include available services
    expect(discovery.routes.auth).toBe('/api/v1/auth');
    expect(discovery.routes.realtime).toBe('/api/v1/realtime');
    expect(discovery.routes.ai).toBe('/api/v1/ai');
  });

  it('should always show core services as available', async () => {
    protocol = new ObjectStackProtocolImplementation(engine);
    
    const discovery = await protocol.getDiscovery();
    
    // Core services should always be available
    expect(discovery.services.metadata.enabled).toBe(true);
    expect(discovery.services.metadata.status).toBe('available');
    expect(discovery.services.data.enabled).toBe(true);
    expect(discovery.services.data.status).toBe('available');
    expect(discovery.services.analytics.enabled).toBe(true);
    expect(discovery.services.analytics.status).toBe('available');
  });

  it('should map file-storage service to storage route', async () => {
    const mockServices = new Map<string, any>();
    mockServices.set('file-storage', {});
    
    protocol = new ObjectStackProtocolImplementation(engine, () => mockServices);
    
    const discovery = await protocol.getDiscovery();
    
    expect(discovery.services['file-storage'].enabled).toBe(true);
    expect(discovery.services['file-storage'].status).toBe('available');
    expect(discovery.routes.storage).toBe('/api/v1/storage');
  });

  it('should use consistent /api/v1/ route prefix for all services', async () => {
    const mockServices = new Map<string, any>();
    mockServices.set('auth', {});
    mockServices.set('automation', {});
    mockServices.set('ai', {});
    
    protocol = new ObjectStackProtocolImplementation(engine, () => mockServices);
    
    const discovery = await protocol.getDiscovery();
    
    // All routes should use consistent /api/v1/ prefix
    expect(discovery.routes.data).toBe('/api/v1/data');
    expect(discovery.routes.metadata).toBe('/api/v1/meta');
    expect(discovery.routes.auth).toBe('/api/v1/auth');
    expect(discovery.routes.automation).toBe('/api/v1/automation');
    expect(discovery.routes.ai).toBe('/api/v1/ai');
    expect(discovery.routes.analytics).toBe('/api/v1/analytics');
    
    // Service routes should match the routes map
    expect(discovery.services.data.route).toBe('/api/v1/data');
    expect(discovery.services.metadata.route).toBe('/api/v1/meta');
    expect(discovery.services.auth.route).toBe('/api/v1/auth');
    expect(discovery.services.analytics.route).toBe('/api/v1/analytics');
  });

  it('should return capabilities field populated from registered services', async () => {
    const mockServices = new Map<string, any>();
    mockServices.set('workflow', {});
    
    protocol = new ObjectStackProtocolImplementation(engine, () => mockServices);
    const discovery = await protocol.getDiscovery();
    
    // capabilities field should now exist in the response
    expect(discovery.capabilities).toBeDefined();
    // workflow is registered but doesn't map to a well-known capability directly
    expect(discovery.services.workflow.enabled).toBe(true);
    // All well-known capabilities should be disabled since workflow doesn't map to any
    expect(discovery.capabilities!.feed).toEqual({ enabled: false });
    expect(discovery.capabilities!.comments).toEqual({ enabled: false });
    expect(discovery.capabilities!.automation).toEqual({ enabled: false });
    expect(discovery.capabilities!.cron).toEqual({ enabled: false });
    expect(discovery.capabilities!.search).toEqual({ enabled: false });
    expect(discovery.capabilities!.export).toEqual({ enabled: false });
    expect(discovery.capabilities!.chunkedUpload).toEqual({ enabled: false });
  });

  it('should set all capabilities to false when no services are registered', async () => {
    protocol = new ObjectStackProtocolImplementation(engine);
    const discovery = await protocol.getDiscovery();

    expect(discovery.capabilities).toBeDefined();
    expect(discovery.capabilities!.feed).toEqual({ enabled: false });
    expect(discovery.capabilities!.comments).toEqual({ enabled: false });
    expect(discovery.capabilities!.automation).toEqual({ enabled: false });
    expect(discovery.capabilities!.cron).toEqual({ enabled: false });
    expect(discovery.capabilities!.search).toEqual({ enabled: false });
    expect(discovery.capabilities!.export).toEqual({ enabled: false });
    expect(discovery.capabilities!.chunkedUpload).toEqual({ enabled: false });
  });

  it('should dynamically set capabilities based on registered services', async () => {
    const mockServices = new Map<string, any>();
    mockServices.set('feed', {});
    mockServices.set('automation', {});
    mockServices.set('search', {});
    mockServices.set('file-storage', {});

    protocol = new ObjectStackProtocolImplementation(engine, () => mockServices);
    const discovery = await protocol.getDiscovery();

    expect(discovery.capabilities!.feed).toEqual({ enabled: true });
    expect(discovery.capabilities!.comments).toEqual({ enabled: true });
    expect(discovery.capabilities!.automation).toEqual({ enabled: true });
    expect(discovery.capabilities!.cron).toEqual({ enabled: false });
    expect(discovery.capabilities!.search).toEqual({ enabled: true });
    expect(discovery.capabilities!.export).toEqual({ enabled: true });
    expect(discovery.capabilities!.chunkedUpload).toEqual({ enabled: true });
  });

  it('should enable cron capability when job service is registered', async () => {
    const mockServices = new Map<string, any>();
    mockServices.set('job', {});

    protocol = new ObjectStackProtocolImplementation(engine, () => mockServices);
    const discovery = await protocol.getDiscovery();

    expect(discovery.capabilities!.cron).toEqual({ enabled: true });
  });

  it('should enable export capability when queue service is registered', async () => {
    const mockServices = new Map<string, any>();
    mockServices.set('queue', {});

    protocol = new ObjectStackProtocolImplementation(engine, () => mockServices);
    const discovery = await protocol.getDiscovery();

    expect(discovery.capabilities!.export).toEqual({ enabled: true });
  });
});
