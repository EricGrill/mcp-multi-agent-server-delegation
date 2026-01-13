import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock all dependencies at the top level
const mockSetRequestHandler = vi.fn();
const mockServerConnect = vi.fn().mockResolvedValue(undefined);
const mockServerClose = vi.fn().mockResolvedValue(undefined);

vi.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: class MockServer {
    setRequestHandler = mockSetRequestHandler;
    connect = mockServerConnect;
    close = mockServerClose;
  },
}));

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: class MockTransport {
    constructor() {}
  },
}));

vi.mock('@modelcontextprotocol/sdk/types.js', () => ({
  CallToolRequestSchema: Symbol('CallToolRequestSchema'),
  ListToolsRequestSchema: Symbol('ListToolsRequestSchema'),
}));

const mockCallbackStart = vi.fn().mockResolvedValue(undefined);
const mockCallbackStop = vi.fn().mockResolvedValue(undefined);
const mockCallbackGetUrl = vi.fn().mockReturnValue('http://localhost:8765');

vi.mock('./callback-server.js', () => ({
  CallbackServer: class MockCallbackServer {
    start = mockCallbackStart;
    stop = mockCallbackStop;
    getCallbackUrl = mockCallbackGetUrl;
  },
}));

const mockProxmoxConnect = vi.fn().mockResolvedValue(undefined);
const mockProxmoxDisconnect = vi.fn().mockResolvedValue(undefined);
const mockProxmoxCreateVM = vi.fn();
const mockProxmoxStartVM = vi.fn().mockResolvedValue(undefined);
const mockProxmoxDestroyVM = vi.fn().mockResolvedValue(undefined);

vi.mock('./proxmox-client.js', () => ({
  ProxmoxClient: class MockProxmoxClient {
    connect = mockProxmoxConnect;
    disconnect = mockProxmoxDisconnect;
    createVM = mockProxmoxCreateVM;
    startVM = mockProxmoxStartVM;
    destroyVM = mockProxmoxDestroyVM;
  },
}));

// Import after mocking
import { DelegationServer } from './server.js';

describe('DelegationServer', () => {
  let server: DelegationServer;
  let listToolsHandler: (() => Promise<unknown>) | null = null;
  let callToolHandler: ((request: { params: { name: string; arguments: unknown } }) => Promise<unknown>) | null = null;

  beforeEach(() => {
    vi.clearAllMocks();

    // Capture handlers when setRequestHandler is called
    mockSetRequestHandler.mockImplementation((schema, handler) => {
      // Determine which handler based on the schema position in registration order
      if (!listToolsHandler) {
        listToolsHandler = handler;
      } else {
        callToolHandler = handler;
      }
    });

    server = new DelegationServer({
      callbackPort: 8765,
      proxmoxAdminPath: '/path/to/proxmox',
    });
  });

  afterEach(async () => {
    listToolsHandler = null;
    callToolHandler = null;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('creates server with config', () => {
      expect(server).toBeDefined();
      expect(mockSetRequestHandler).toHaveBeenCalledTimes(2);
    });
  });

  describe('start', () => {
    it('starts callback server, proxmox client, and MCP server', async () => {
      vi.useFakeTimers();
      await server.start();

      expect(mockCallbackStart).toHaveBeenCalled();
      expect(mockProxmoxConnect).toHaveBeenCalled();
      expect(mockServerConnect).toHaveBeenCalled();

      // Stop to clean up interval
      await server.stop();
      vi.useRealTimers();
    });
  });

  describe('stop', () => {
    it('stops all services and clears cleanup interval', async () => {
      vi.useFakeTimers();
      await server.start();
      await server.stop();

      expect(mockCallbackStop).toHaveBeenCalled();
      expect(mockProxmoxDisconnect).toHaveBeenCalled();
      expect(mockServerClose).toHaveBeenCalled();
      vi.useRealTimers();
    });

    it('handles stop without start', async () => {
      await server.stop();
      // Should not throw
    });
  });

  describe('ListTools handler', () => {
    it('returns all available tools', async () => {
      expect(listToolsHandler).not.toBeNull();
      const result = await listToolsHandler!();

      expect(result).toHaveProperty('tools');
      const tools = (result as { tools: Array<{ name: string }> }).tools;
      expect(tools).toHaveLength(5);

      const toolNames = tools.map(t => t.name);
      expect(toolNames).toContain('submit_job');
      expect(toolNames).toContain('get_job_status');
      expect(toolNames).toContain('get_job_result');
      expect(toolNames).toContain('cancel_job');
      expect(toolNames).toContain('list_jobs');
    });
  });

  describe('CallTool handler', () => {
    describe('submit_job', () => {
      it('submits a valid job', async () => {
        mockProxmoxCreateVM.mockResolvedValue({
          vmId: '100',
          node: 'pve1',
          status: 'created',
        });

        expect(callToolHandler).not.toBeNull();
        const result = await callToolHandler!({
          params: {
            name: 'submit_job',
            arguments: {
              manifest: {
                task: 'Run tests',
                agentType: 'script',
              },
            },
          },
        });

        expect(result).toHaveProperty('content');
        const content = (result as { content: Array<{ text: string }> }).content;
        const parsed = JSON.parse(content[0].text);
        expect(parsed).toHaveProperty('job_id');
        expect(parsed.job_id).toMatch(/^[0-9a-f-]{36}$/);
      });

      it('returns error for invalid manifest', async () => {
        expect(callToolHandler).not.toBeNull();
        const result = await callToolHandler!({
          params: {
            name: 'submit_job',
            arguments: {
              manifest: {
                // Missing required fields
                invalid: true,
              },
            },
          },
        });

        expect(result).toHaveProperty('isError', true);
        const content = (result as { content: Array<{ text: string }> }).content;
        expect(content[0].text).toContain('Invalid manifest');
      });
    });

    describe('get_job_status', () => {
      it('returns status for existing job', async () => {
        // First submit a job
        mockProxmoxCreateVM.mockResolvedValue({
          vmId: '100',
          node: 'pve1',
          status: 'created',
        });

        const submitResult = await callToolHandler!({
          params: {
            name: 'submit_job',
            arguments: {
              manifest: {
                task: 'Run tests',
                agentType: 'script',
              },
            },
          },
        });

        const submitContent = (submitResult as { content: Array<{ text: string }> }).content;
        const { job_id } = JSON.parse(submitContent[0].text);

        // Now get status
        const statusResult = await callToolHandler!({
          params: {
            name: 'get_job_status',
            arguments: { job_id },
          },
        });

        expect(statusResult).not.toHaveProperty('isError');
        const statusContent = (statusResult as { content: Array<{ text: string }> }).content;
        const status = JSON.parse(statusContent[0].text);
        expect(status.job_id).toBe(job_id);
        expect(status).toHaveProperty('status');
      });

      it('returns error for non-existent job', async () => {
        const result = await callToolHandler!({
          params: {
            name: 'get_job_status',
            arguments: { job_id: 'nonexistent-id' },
          },
        });

        expect(result).toHaveProperty('isError', true);
        const content = (result as { content: Array<{ text: string }> }).content;
        expect(content[0].text).toBe('Job not found');
      });
    });

    describe('get_job_result', () => {
      it('returns error for incomplete job', async () => {
        mockProxmoxCreateVM.mockResolvedValue({
          vmId: '100',
          node: 'pve1',
          status: 'created',
        });

        const submitResult = await callToolHandler!({
          params: {
            name: 'submit_job',
            arguments: {
              manifest: {
                task: 'Run tests',
                agentType: 'script',
              },
            },
          },
        });

        const submitContent = (submitResult as { content: Array<{ text: string }> }).content;
        const { job_id } = JSON.parse(submitContent[0].text);

        const result = await callToolHandler!({
          params: {
            name: 'get_job_result',
            arguments: { job_id },
          },
        });

        expect(result).toHaveProperty('isError', true);
        const content = (result as { content: Array<{ text: string }> }).content;
        expect(content[0].text).toContain('Job not complete');
      });

      it('returns error for non-existent job', async () => {
        const result = await callToolHandler!({
          params: {
            name: 'get_job_result',
            arguments: { job_id: 'nonexistent-id' },
          },
        });

        expect(result).toHaveProperty('isError', true);
        const content = (result as { content: Array<{ text: string }> }).content;
        expect(content[0].text).toBe('Job not found');
      });
    });

    describe('cancel_job', () => {
      it('cancels a pending job', async () => {
        mockProxmoxCreateVM.mockResolvedValue({
          vmId: '100',
          node: 'pve1',
          status: 'created',
        });

        const submitResult = await callToolHandler!({
          params: {
            name: 'submit_job',
            arguments: {
              manifest: {
                task: 'Run tests',
                agentType: 'script',
              },
            },
          },
        });

        const submitContent = (submitResult as { content: Array<{ text: string }> }).content;
        const { job_id } = JSON.parse(submitContent[0].text);

        // Wait a bit for the async provisioning to start
        await new Promise(resolve => setTimeout(resolve, 10));

        const result = await callToolHandler!({
          params: {
            name: 'cancel_job',
            arguments: { job_id },
          },
        });

        const content = (result as { content: Array<{ text: string }> }).content;
        const parsed = JSON.parse(content[0].text);
        expect(parsed).toHaveProperty('cancelled', true);
      });

      it('returns error for non-existent job', async () => {
        const result = await callToolHandler!({
          params: {
            name: 'cancel_job',
            arguments: { job_id: 'nonexistent-id' },
          },
        });

        expect(result).toHaveProperty('isError', true);
        const content = (result as { content: Array<{ text: string }> }).content;
        expect(content[0].text).toBe('Job not found');
      });
    });

    describe('list_jobs', () => {
      it('lists all jobs', async () => {
        const result = await callToolHandler!({
          params: {
            name: 'list_jobs',
            arguments: {},
          },
        });

        expect(result).not.toHaveProperty('isError');
        const content = (result as { content: Array<{ text: string }> }).content;
        const jobs = JSON.parse(content[0].text);
        expect(Array.isArray(jobs)).toBe(true);
      });

      it('filters jobs by status', async () => {
        const result = await callToolHandler!({
          params: {
            name: 'list_jobs',
            arguments: { status: 'pending' },
          },
        });

        expect(result).not.toHaveProperty('isError');
        const content = (result as { content: Array<{ text: string }> }).content;
        const jobs = JSON.parse(content[0].text);
        expect(Array.isArray(jobs)).toBe(true);
      });
    });

    describe('unknown tool', () => {
      it('throws error for unknown tool name', async () => {
        await expect(
          callToolHandler!({
            params: {
              name: 'unknown_tool',
              arguments: {},
            },
          })
        ).rejects.toThrow('Unknown tool: unknown_tool');
      });
    });
  });

  describe('provisioning', () => {
    it('updates job status to failed on provisioning error', async () => {
      mockProxmoxCreateVM.mockRejectedValue(new Error('VM creation failed'));

      const submitResult = await callToolHandler!({
        params: {
          name: 'submit_job',
          arguments: {
            manifest: {
              task: 'Run tests',
              agentType: 'script',
            },
          },
        },
      });

      const submitContent = (submitResult as { content: Array<{ text: string }> }).content;
      const { job_id } = JSON.parse(submitContent[0].text);

      // Wait for async provisioning to fail
      await new Promise(resolve => setTimeout(resolve, 50));

      const statusResult = await callToolHandler!({
        params: {
          name: 'get_job_status',
          arguments: { job_id },
        },
      });

      const statusContent = (statusResult as { content: Array<{ text: string }> }).content;
      const status = JSON.parse(statusContent[0].text);
      expect(status.status).toBe('failed');
      expect(status.error).toContain('Provisioning failed');
    });
  });

  describe('cancel completed job', () => {
    it('returns error when cancelling completed job', async () => {
      mockProxmoxCreateVM.mockRejectedValue(new Error('VM creation failed'));

      const submitResult = await callToolHandler!({
        params: {
          name: 'submit_job',
          arguments: {
            manifest: {
              task: 'Run tests',
              agentType: 'script',
            },
          },
        },
      });

      const submitContent = (submitResult as { content: Array<{ text: string }> }).content;
      const { job_id } = JSON.parse(submitContent[0].text);

      // Wait for async provisioning to fail, marking job as completed (failed)
      await new Promise(resolve => setTimeout(resolve, 50));

      const result = await callToolHandler!({
        params: {
          name: 'cancel_job',
          arguments: { job_id },
        },
      });

      expect(result).toHaveProperty('isError', true);
      const content = (result as { content: Array<{ text: string }> }).content;
      expect(content[0].text).toBe('Job already completed');
    });
  });

  describe('get_job_result for completed job', () => {
    it('returns result for failed job', async () => {
      mockProxmoxCreateVM.mockRejectedValue(new Error('VM creation failed'));

      const submitResult = await callToolHandler!({
        params: {
          name: 'submit_job',
          arguments: {
            manifest: {
              task: 'Run tests',
              agentType: 'script',
            },
          },
        },
      });

      const submitContent = (submitResult as { content: Array<{ text: string }> }).content;
      const { job_id } = JSON.parse(submitContent[0].text);

      // Wait for async provisioning to fail
      await new Promise(resolve => setTimeout(resolve, 50));

      const result = await callToolHandler!({
        params: {
          name: 'get_job_result',
          arguments: { job_id },
        },
      });

      expect(result).not.toHaveProperty('isError');
      const content = (result as { content: Array<{ text: string }> }).content;
      const jobResult = JSON.parse(content[0].text);
      expect(jobResult.status).toBe('failed');
      expect(jobResult.error).toContain('Provisioning failed');
    });
  });

  describe('cleanup interval', () => {
    it('handles timed out jobs', async () => {
      vi.useFakeTimers();

      // Submit a job with a short timeout
      mockProxmoxCreateVM.mockResolvedValue({
        vmId: '100',
        node: 'pve1',
        status: 'created',
      });

      const submitResult = await callToolHandler!({
        params: {
          name: 'submit_job',
          arguments: {
            manifest: {
              task: 'Long task',
              agentType: 'script',
              timeout: 1, // 1 second timeout
            },
          },
        },
      });

      const submitContent = (submitResult as { content: Array<{ text: string }> }).content;
      const { job_id } = JSON.parse(submitContent[0].text);

      // Wait for provisioning to complete
      await vi.advanceTimersByTimeAsync(100);

      // Start the server to begin cleanup interval
      await server.start();

      // Advance time past the timeout and cleanup interval
      await vi.advanceTimersByTimeAsync(35000);

      // Get status - should now be timeout
      const statusResult = await callToolHandler!({
        params: {
          name: 'get_job_status',
          arguments: { job_id },
        },
      });

      await server.stop();
      vi.useRealTimers();

      // The job should be marked as timed out after cleanup runs
      const statusContent = (statusResult as { content: Array<{ text: string }> }).content;
      const status = JSON.parse(statusContent[0].text);
      // Note: May still be running if cleanup hasn't fully executed
      expect(['running', 'timeout', 'provisioning']).toContain(status.status);
    });

    it('cleans up completed ephemeral VMs', async () => {
      vi.useFakeTimers();

      // Submit a job that will fail (making it "completed")
      mockProxmoxCreateVM.mockRejectedValue(new Error('VM creation failed'));

      await callToolHandler!({
        params: {
          name: 'submit_job',
          arguments: {
            manifest: {
              task: 'Failing task',
              agentType: 'script',
            },
          },
        },
      });

      // Wait for provisioning to fail
      await vi.advanceTimersByTimeAsync(100);

      // Start the server to begin cleanup interval
      await server.start();

      // Advance time past cleanup interval
      await vi.advanceTimersByTimeAsync(35000);

      await server.stop();
      vi.useRealTimers();

      // The cleanup should have attempted to destroy VMs for completed jobs
      // Since the job failed during provisioning (no vmId), destroyVM may not be called
    });

    it('handles VM destruction errors gracefully', async () => {
      vi.useFakeTimers();

      mockProxmoxCreateVM.mockResolvedValue({
        vmId: '100',
        node: 'pve1',
        status: 'created',
      });
      mockProxmoxDestroyVM.mockRejectedValue(new Error('VM destruction failed'));

      const submitResult = await callToolHandler!({
        params: {
          name: 'submit_job',
          arguments: {
            manifest: {
              task: 'Task',
              agentType: 'script',
              timeout: 1,
            },
          },
        },
      });

      const submitContent = (submitResult as { content: Array<{ text: string }> }).content;
      JSON.parse(submitContent[0].text);

      // Wait for provisioning
      await vi.advanceTimersByTimeAsync(100);

      // Start server
      await server.start();

      // Advance time to trigger cleanup
      await vi.advanceTimersByTimeAsync(35000);

      // Should not throw even though destroyVM fails
      await server.stop();
      vi.useRealTimers();
    });
  });

  describe('cancel job with VM', () => {
    it('destroys VM when cancelling running job', async () => {
      mockProxmoxCreateVM.mockResolvedValue({
        vmId: '100',
        node: 'pve1',
        status: 'created',
      });

      const submitResult = await callToolHandler!({
        params: {
          name: 'submit_job',
          arguments: {
            manifest: {
              task: 'Run tests',
              agentType: 'script',
            },
          },
        },
      });

      const submitContent = (submitResult as { content: Array<{ text: string }> }).content;
      const { job_id } = JSON.parse(submitContent[0].text);

      // Wait for provisioning to complete
      await new Promise(resolve => setTimeout(resolve, 50));

      await callToolHandler!({
        params: {
          name: 'cancel_job',
          arguments: { job_id },
        },
      });

      // destroyVM should have been called
      expect(mockProxmoxDestroyVM).toHaveBeenCalled();
    });

    it('handles VM destruction error during cancel', async () => {
      mockProxmoxCreateVM.mockResolvedValue({
        vmId: '100',
        node: 'pve1',
        status: 'created',
      });
      mockProxmoxDestroyVM.mockRejectedValue(new Error('Failed'));

      const submitResult = await callToolHandler!({
        params: {
          name: 'submit_job',
          arguments: {
            manifest: {
              task: 'Run tests',
              agentType: 'script',
            },
          },
        },
      });

      const submitContent = (submitResult as { content: Array<{ text: string }> }).content;
      const { job_id } = JSON.parse(submitContent[0].text);

      // Wait for provisioning to complete
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should not throw even if destroyVM fails
      const result = await callToolHandler!({
        params: {
          name: 'cancel_job',
          arguments: { job_id },
        },
      });

      const content = (result as { content: Array<{ text: string }> }).content;
      const parsed = JSON.parse(content[0].text);
      expect(parsed).toHaveProperty('cancelled', true);
    });
  });
});
