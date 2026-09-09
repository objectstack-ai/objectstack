// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import type { IExportService } from './export-service';

describe('Export Service Contract', () => {
  it('should allow a minimal IExportService implementation with all required methods', () => {
    const service: IExportService = {
      createExportJob: async () => ({
        jobId: 'job_001',
        status: 'pending',
        createdAt: new Date().toISOString(),
      }),
      getExportJobProgress: async () => null,
      getExportJobDownload: async () => null,
      cancelExportJob: async () => false,
      listExportJobs: async () => ({ jobs: [], hasMore: false }),
      scheduleExport: async () => ({
        name: 'test_schedule',
        object: 'account',
        schedule: { timezone: 'UTC' },
        delivery: { method: 'storage' },
        enabled: true,
      }),
    };

    expect(typeof service.createExportJob).toBe('function');
    expect(typeof service.getExportJobProgress).toBe('function');
    expect(typeof service.getExportJobDownload).toBe('function');
    expect(typeof service.cancelExportJob).toBe('function');
    expect(typeof service.listExportJobs).toBe('function');
    expect(typeof service.scheduleExport).toBe('function');
  });

  it('should create and track an export job', async () => {
    const jobs = new Map<string, any>();
    let counter = 0;

    const service: IExportService = {
      createExportJob: async (input) => {
        const jobId = `job_${++counter}`;
        const job = {
          jobId,
          status: 'pending' as const,
          estimatedRecords: input.limit,
          createdAt: new Date().toISOString(),
        };
        jobs.set(jobId, { ...job, input });
        return job;
      },
      getExportJobProgress: async (jobId) => {
        const job = jobs.get(jobId);
        if (!job) return null;
        return {
          success: true,
          data: {
            jobId,
            status: job.status,
            format: job.input.format ?? 'csv',
            processedRecords: 0,
            percentComplete: 0,
          },
        };
      },
      getExportJobDownload: async () => null,
      cancelExportJob: async (jobId) => {
        if (jobs.has(jobId)) {
          jobs.get(jobId).status = 'cancelled';
          return true;
        }
        return false;
      },
      listExportJobs: async () => ({
        jobs: Array.from(jobs.values()).map((j) => ({
          jobId: j.jobId,
          object: j.input.object,
          status: j.status,
          format: j.input.format ?? 'csv',
          createdAt: j.createdAt,
        })),
        hasMore: false,
      }),
      scheduleExport: async () => ({
        name: 'test',
        object: 'account',
        schedule: { timezone: 'UTC' },
        delivery: { method: 'storage' },
        enabled: true,
      }),
    };

    const result = await service.createExportJob({
      object: 'account',
      format: 'csv',
      fields: ['name', 'email'],
      limit: 1000,
    });

    expect(result.jobId).toBe('job_1');
    expect(result.status).toBe('pending');

    const progress = await service.getExportJobProgress(result.jobId);
    expect(progress).not.toBeNull();
    expect(progress!.data.jobId).toBe('job_1');

    const list = await service.listExportJobs();
    expect(list.jobs).toHaveLength(1);
    expect(list.hasMore).toBe(false);

    const cancelled = await service.cancelExportJob(result.jobId);
    expect(cancelled).toBe(true);
  });

  it('should support optional template methods', () => {
    const service: IExportService = {
      createExportJob: async () => ({
        jobId: 'job_1',
        status: 'pending',
        createdAt: new Date().toISOString(),
      }),
      getExportJobProgress: async () => null,
      getExportJobDownload: async () => null,
      cancelExportJob: async () => false,
      listExportJobs: async () => ({ jobs: [], hasMore: false }),
      scheduleExport: async () => ({
        name: 'test',
        object: 'account',
        schedule: { timezone: 'UTC' },
        delivery: { method: 'storage' },
        enabled: true,
      }),
      getTemplate: async () => null,
      listTemplates: async () => [],
    };

    expect(typeof service.getTemplate).toBe('function');
    expect(typeof service.listTemplates).toBe('function');
  });
});
