import { describe, it, expect, beforeEach } from 'vitest';
import { JobStore } from './store.js';
import type { JobManifest } from './types.js';

describe('JobStore', () => {
  let store: JobStore;

  const testManifest: JobManifest = {
    task: 'Run tests',
    agentType: 'script',
  };

  beforeEach(() => {
    store = new JobStore();
  });

  it('creates a job and returns id', () => {
    const id = store.createJob(testManifest);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('retrieves a job by id', () => {
    const id = store.createJob(testManifest);
    const job = store.getJob(id);
    expect(job).toBeDefined();
    expect(job?.manifest.task).toBe('Run tests');
    expect(job?.status).toBe('pending');
  });

  it('returns undefined for unknown job', () => {
    const job = store.getJob('nonexistent');
    expect(job).toBeUndefined();
  });

  it('updates job status', () => {
    const id = store.createJob(testManifest);
    store.updateJob(id, { status: 'running', vmId: 'vm-123' });
    const job = store.getJob(id);
    expect(job?.status).toBe('running');
    expect(job?.vmId).toBe('vm-123');
  });

  it('lists all jobs', () => {
    store.createJob(testManifest);
    store.createJob({ ...testManifest, task: 'Build app' });
    const jobs = store.listJobs();
    expect(jobs).toHaveLength(2);
  });

  it('filters jobs by status', () => {
    const id1 = store.createJob(testManifest);
    store.createJob(testManifest);
    store.updateJob(id1, { status: 'running' });

    const running = store.listJobs('running');
    expect(running).toHaveLength(1);
  });

  it('deletes a job', () => {
    const id = store.createJob(testManifest);
    store.deleteJob(id);
    expect(store.getJob(id)).toBeUndefined();
  });

  it('returns false when updating non-existent job', () => {
    const result = store.updateJob('nonexistent', { status: 'running' });
    expect(result).toBe(false);
  });

  it('returns false when deleting non-existent job', () => {
    const result = store.deleteJob('nonexistent');
    expect(result).toBe(false);
  });

  describe('getTimedOutJobs', () => {
    it('returns empty array when no jobs exist', () => {
      const timedOut = store.getTimedOutJobs();
      expect(timedOut).toHaveLength(0);
    });

    it('returns empty array when no running jobs', () => {
      store.createJob(testManifest);
      const timedOut = store.getTimedOutJobs();
      expect(timedOut).toHaveLength(0);
    });

    it('returns empty array when running job has no timeout', () => {
      const id = store.createJob(testManifest);
      store.updateJob(id, { status: 'running', startedAt: new Date() });
      const timedOut = store.getTimedOutJobs();
      expect(timedOut).toHaveLength(0);
    });

    it('returns empty array when running job has no startedAt', () => {
      const id = store.createJob({ ...testManifest, timeout: 60 });
      store.updateJob(id, { status: 'running' });
      const timedOut = store.getTimedOutJobs();
      expect(timedOut).toHaveLength(0);
    });

    it('returns empty array when job has not timed out', () => {
      const id = store.createJob({ ...testManifest, timeout: 60 });
      store.updateJob(id, { status: 'running', startedAt: new Date() });
      const timedOut = store.getTimedOutJobs();
      expect(timedOut).toHaveLength(0);
    });

    it('returns timed out jobs', () => {
      const id = store.createJob({ ...testManifest, timeout: 60 });
      const pastTime = new Date(Date.now() - 120000); // 2 minutes ago
      store.updateJob(id, { status: 'running', startedAt: pastTime });

      const timedOut = store.getTimedOutJobs();
      expect(timedOut).toHaveLength(1);
      expect(timedOut[0].id).toBe(id);
    });

    it('accepts custom now parameter', () => {
      const id = store.createJob({ ...testManifest, timeout: 60 });
      const startTime = new Date('2024-01-01T00:00:00Z');
      store.updateJob(id, { status: 'running', startedAt: startTime });

      const futureTime = new Date('2024-01-01T00:02:00Z'); // 2 minutes later
      const timedOut = store.getTimedOutJobs(futureTime);
      expect(timedOut).toHaveLength(1);
    });
  });

  describe('getStaleJobs', () => {
    it('returns empty array when no jobs exist', () => {
      const stale = store.getStaleJobs(120);
      expect(stale).toHaveLength(0);
    });

    it('returns empty array when no running jobs', () => {
      store.createJob(testManifest);
      const stale = store.getStaleJobs(120);
      expect(stale).toHaveLength(0);
    });

    it('returns empty array when running job has no lastHeartbeat', () => {
      const id = store.createJob(testManifest);
      store.updateJob(id, { status: 'running', startedAt: new Date() });
      const stale = store.getStaleJobs(120);
      expect(stale).toHaveLength(0);
    });

    it('returns empty array when heartbeat is fresh', () => {
      const id = store.createJob(testManifest);
      store.updateJob(id, { status: 'running', lastHeartbeat: new Date() });
      const stale = store.getStaleJobs(120);
      expect(stale).toHaveLength(0);
    });

    it('returns stale jobs', () => {
      const id = store.createJob(testManifest);
      const pastTime = new Date(Date.now() - 180000); // 3 minutes ago
      store.updateJob(id, { status: 'running', lastHeartbeat: pastTime });

      const stale = store.getStaleJobs(120); // 2 minute threshold
      expect(stale).toHaveLength(1);
      expect(stale[0].id).toBe(id);
    });

    it('accepts custom now parameter', () => {
      const id = store.createJob(testManifest);
      const heartbeatTime = new Date('2024-01-01T00:00:00Z');
      store.updateJob(id, { status: 'running', lastHeartbeat: heartbeatTime });

      const futureTime = new Date('2024-01-01T00:03:00Z'); // 3 minutes later
      const stale = store.getStaleJobs(120, futureTime);
      expect(stale).toHaveLength(1);
    });
  });
});
