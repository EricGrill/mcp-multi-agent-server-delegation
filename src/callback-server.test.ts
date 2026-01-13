import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { CallbackServer } from './callback-server.js';
import { JobStore } from './store.js';

describe('CallbackServer', () => {
  let server: CallbackServer;
  let store: JobStore;
  let jobId: string;
  const port = 9876;
  const baseUrl = `http://localhost:${port}`;

  beforeAll(async () => {
    store = new JobStore();
    server = new CallbackServer(store, port);
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  beforeEach(() => {
    jobId = store.createJob({ task: 'test', agentType: 'script' });
    store.updateJob(jobId, { status: 'running', startedAt: new Date() });
  });

  it('receives completion callback', async () => {
    const response = await fetch(`${baseUrl}/callback/${jobId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_id: jobId,
        status: 'success',
        exit_code: 0,
        output: 'Done!',
        duration_seconds: 10,
      }),
    });

    expect(response.status).toBe(200);
    const job = store.getJob(jobId);
    expect(job?.status).toBe('success');
    expect(job?.output).toBe('Done!');
  });

  it('receives status update', async () => {
    const response = await fetch(`${baseUrl}/callback/${jobId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_id: jobId,
        progress: 'Step 2 of 5',
      }),
    });

    expect(response.status).toBe(200);
    const job = store.getJob(jobId);
    expect(job?.progress).toBe('Step 2 of 5');
  });

  it('receives heartbeat', async () => {
    const response = await fetch(`${baseUrl}/callback/${jobId}/heartbeat`, {
      method: 'POST',
    });

    expect(response.status).toBe(200);
    const job = store.getJob(jobId);
    expect(job?.lastHeartbeat).toBeDefined();
  });

  it('rejects unknown job id for complete', async () => {
    const response = await fetch(`${baseUrl}/callback/unknown-id/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_id: 'unknown-id',
        status: 'success',
        exit_code: 0,
        output: 'Done!',
        duration_seconds: 10,
      }),
    });

    expect(response.status).toBe(404);
  });

  it('health endpoint returns ok', async () => {
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ status: 'ok' });
  });

  it('rejects invalid complete payload', async () => {
    const response = await fetch(`${baseUrl}/callback/${jobId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invalid: 'payload' }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('Invalid payload');
  });

  it('rejects invalid status payload', async () => {
    const response = await fetch(`${baseUrl}/callback/${jobId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invalid: 'payload' }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('Invalid payload');
  });

  it('receives status update with output', async () => {
    const response = await fetch(`${baseUrl}/callback/${jobId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_id: jobId,
        progress: 'Step 3 of 5',
        output: 'Partial output',
      }),
    });

    expect(response.status).toBe(200);
    const job = store.getJob(jobId);
    expect(job?.progress).toBe('Step 3 of 5');
    expect(job?.output).toBe('Partial output');
  });

  it('rejects unknown job id for status', async () => {
    const response = await fetch(`${baseUrl}/callback/unknown-id/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_id: 'unknown-id',
        progress: 'Test',
      }),
    });

    expect(response.status).toBe(404);
  });

  it('rejects unknown job id for heartbeat', async () => {
    const response = await fetch(`${baseUrl}/callback/unknown-id/heartbeat`, {
      method: 'POST',
    });

    expect(response.status).toBe(404);
  });

  it('handles failed status callback', async () => {
    const response = await fetch(`${baseUrl}/callback/${jobId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_id: jobId,
        status: 'failed',
        exit_code: 1,
        output: 'Error output',
        error: 'Something went wrong',
        duration_seconds: 5,
      }),
    });

    expect(response.status).toBe(200);
    const job = store.getJob(jobId);
    expect(job?.status).toBe('failed');
    expect(job?.error).toBe('Something went wrong');
  });

  it('getCallbackUrl returns correct URL', () => {
    expect(server.getCallbackUrl()).toBe(`http://localhost:${port}`);
  });
});

describe('CallbackServer lifecycle', () => {
  it('stop resolves when server is null', async () => {
    const store = new JobStore();
    const server = new CallbackServer(store, 9999);
    // Don't start the server, just stop it
    await expect(server.stop()).resolves.toBeUndefined();
  });
});
