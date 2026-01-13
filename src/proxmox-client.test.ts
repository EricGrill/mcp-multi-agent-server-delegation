import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { JobManifest } from './types.js';

// Mock modules at the top level
const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockClose = vi.fn().mockResolvedValue(undefined);
const mockCallTool = vi.fn();

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class MockClient {
    connect = mockConnect;
    close = mockClose;
    callTool = mockCallTool;
  },
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: class MockTransport {
    constructor() {}
  },
}));

// Import after mocking
import { ProxmoxClient } from './proxmox-client.js';

describe('ProxmoxClient', () => {
  let client: ProxmoxClient;

  const testManifest: JobManifest = {
    task: 'Run tests',
    agentType: 'script',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    client = new ProxmoxClient('/path/to/proxmox', 'http://callback:8765');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('connect', () => {
    it('creates transport and connects client', async () => {
      await client.connect();
      expect(mockConnect).toHaveBeenCalled();
    });
  });

  describe('disconnect', () => {
    it('closes client when connected', async () => {
      await client.connect();
      await client.disconnect();
      expect(mockClose).toHaveBeenCalled();
    });

    it('handles disconnect when not connected', async () => {
      await client.disconnect();
      // Should complete without error - close called on null client is safe with optional chaining
    });
  });

  describe('createVM', () => {
    it('throws when not connected', async () => {
      await expect(client.createVM('job-1', testManifest)).rejects.toThrow('Client not connected');
    });

    it('creates VM with correct parameters', async () => {
      mockCallTool.mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify({ vmid: 100, node: 'pve1' }),
        }],
      });

      await client.connect();
      const vm = await client.createVM('job-1', testManifest);

      expect(vm.vmId).toBe('100');
      expect(vm.node).toBe('pve1');
      expect(vm.status).toBe('created');

      expect(mockCallTool).toHaveBeenCalledWith({
        name: 'proxmox_vm_create',
        arguments: expect.objectContaining({
          template: 'agent-template',
          name: 'job-job-1',
          cpu: 2,
          memory: '2G',
          disk: '10G',
        }),
      });
    });

    it('uses custom resources from manifest', async () => {
      mockCallTool.mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify({ vmid: 101, node: 'pve2' }),
        }],
      });

      const customManifest: JobManifest = {
        task: 'Heavy task',
        agentType: 'claude',
        vmTemplate: 'custom-template',
        resources: { cpu: 8, memory: '16G', disk: '100G' },
      };

      await client.connect();
      await client.createVM('job-2', customManifest);

      expect(mockCallTool).toHaveBeenCalledWith({
        name: 'proxmox_vm_create',
        arguments: expect.objectContaining({
          template: 'custom-template',
          cpu: 8,
          memory: '16G',
          disk: '100G',
        }),
      });
    });

    it('handles vmId response format', async () => {
      mockCallTool.mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify({ vmId: '200', node: 'pve1' }),
        }],
      });

      await client.connect();
      const vm = await client.createVM('job-3', testManifest);

      expect(vm.vmId).toBe('200');
    });

    it('throws on unexpected response format (no content)', async () => {
      mockCallTool.mockResolvedValue({});

      await client.connect();
      await expect(client.createVM('job-4', testManifest)).rejects.toThrow('Unexpected response format');
    });

    it('throws on unexpected response format (empty content)', async () => {
      mockCallTool.mockResolvedValue({ content: [] });

      await client.connect();
      await expect(client.createVM('job-4', testManifest)).rejects.toThrow('Unexpected response format');
    });

    it('throws on unexpected response type', async () => {
      mockCallTool.mockResolvedValue({
        content: [{ type: 'image', data: 'xyz' }],
      });

      await client.connect();
      await expect(client.createVM('job-5', testManifest)).rejects.toThrow('Unexpected response type');
    });
  });

  describe('startVM', () => {
    it('throws when not connected', async () => {
      await expect(client.startVM('100')).rejects.toThrow('Client not connected');
    });

    it('starts VM with correct vmid', async () => {
      mockCallTool.mockResolvedValue({});

      await client.connect();
      await client.startVM('100');

      expect(mockCallTool).toHaveBeenCalledWith({
        name: 'proxmox_vm_start',
        arguments: { vmid: '100' },
      });
    });
  });

  describe('destroyVM', () => {
    it('throws when not connected', async () => {
      await expect(client.destroyVM('100')).rejects.toThrow('Client not connected');
    });

    it('stops then destroys VM', async () => {
      mockCallTool.mockResolvedValue({});

      await client.connect();
      await client.destroyVM('100');

      expect(mockCallTool).toHaveBeenCalledTimes(2);
      expect(mockCallTool).toHaveBeenNthCalledWith(1, {
        name: 'proxmox_vm_stop',
        arguments: { vmid: '100' },
      });
      expect(mockCallTool).toHaveBeenNthCalledWith(2, {
        name: 'proxmox_vm_destroy',
        arguments: { vmid: '100', confirm: true },
      });
    });

    it('continues to destroy even if stop fails', async () => {
      mockCallTool
        .mockRejectedValueOnce(new Error('VM already stopped'))
        .mockResolvedValueOnce({});

      await client.connect();
      await client.destroyVM('100');

      expect(mockCallTool).toHaveBeenCalledTimes(2);
      expect(mockCallTool).toHaveBeenNthCalledWith(2, {
        name: 'proxmox_vm_destroy',
        arguments: { vmid: '100', confirm: true },
      });
    });
  });

  describe('cloud-init generation', () => {
    // Helper to extract and decode the run.sh script from cloud-init
    const getDecodedRunScript = (cloudInit: string): string => {
      const runShMatch = cloudInit.match(/path: \/opt\/job-runner\/run\.sh\n\s+content: ([A-Za-z0-9+/=]+)/);
      if (!runShMatch) return '';
      return Buffer.from(runShMatch[1], 'base64').toString('utf-8');
    };

    it('includes manifest files in cloud-init', async () => {
      mockCallTool.mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify({ vmid: 100, node: 'pve1' }),
        }],
      });

      const manifestWithFiles: JobManifest = {
        task: 'Build project',
        agentType: 'script',
        files: [
          { path: '/workspace/code.py', content: 'cHJpbnQoImhlbGxvIik=' },
        ],
      };

      await client.connect();
      await client.createVM('job-files', manifestWithFiles);

      const cloudInit = mockCallTool.mock.calls[0][0].arguments.cloudInit;
      expect(cloudInit).toContain('/workspace/code.py');
    });

    it('includes environment variables in job runner', async () => {
      mockCallTool.mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify({ vmid: 100, node: 'pve1' }),
        }],
      });

      const manifestWithEnv: JobManifest = {
        task: 'Build project',
        agentType: 'script',
        env: { NODE_ENV: 'production', DEBUG: 'true' },
      };

      await client.connect();
      await client.createVM('job-env', manifestWithEnv);

      const cloudInit = mockCallTool.mock.calls[0][0].arguments.cloudInit;
      const runScript = getDecodedRunScript(cloudInit);
      expect(runScript).toContain('export NODE_ENV="production"');
      expect(runScript).toContain('export DEBUG="true"');
    });

    it('uses custom timeout in job runner', async () => {
      mockCallTool.mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify({ vmid: 100, node: 'pve1' }),
        }],
      });

      const manifestWithTimeout: JobManifest = {
        task: 'Long task',
        agentType: 'script',
        timeout: 7200,
      };

      await client.connect();
      await client.createVM('job-timeout', manifestWithTimeout);

      const cloudInit = mockCallTool.mock.calls[0][0].arguments.cloudInit;
      const runScript = getDecodedRunScript(cloudInit);
      expect(runScript).toContain('TIMEOUT=7200');
    });

    it('generates claude agent command', async () => {
      mockCallTool.mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify({ vmid: 100, node: 'pve1' }),
        }],
      });

      const claudeManifest: JobManifest = {
        task: 'Analyze code',
        agentType: 'claude',
      };

      await client.connect();
      await client.createVM('job-claude', claudeManifest);

      const cloudInit = mockCallTool.mock.calls[0][0].arguments.cloudInit;
      const runScript = getDecodedRunScript(cloudInit);
      expect(runScript).toContain('claude --print');
    });

    it('generates script agent command', async () => {
      mockCallTool.mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify({ vmid: 100, node: 'pve1' }),
        }],
      });

      const scriptManifest: JobManifest = {
        task: 'npm test',
        agentType: 'script',
        agent: { command: 'bash -c "npm test"' },
      };

      await client.connect();
      await client.createVM('job-script', scriptManifest);

      const cloudInit = mockCallTool.mock.calls[0][0].arguments.cloudInit;
      const runScript = getDecodedRunScript(cloudInit);
      expect(runScript).toContain('bash -c "npm test"');
    });

    it('generates custom agent command', async () => {
      mockCallTool.mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify({ vmid: 100, node: 'pve1' }),
        }],
      });

      const customManifest: JobManifest = {
        task: 'Custom task',
        agentType: 'custom',
        agent: { command: '/opt/custom/runner' },
      };

      await client.connect();
      await client.createVM('job-custom', customManifest);

      const cloudInit = mockCallTool.mock.calls[0][0].arguments.cloudInit;
      const runScript = getDecodedRunScript(cloudInit);
      expect(runScript).toContain('/opt/custom/runner');
    });

    it('uses default status mode', async () => {
      mockCallTool.mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify({ vmid: 100, node: 'pve1' }),
        }],
      });

      await client.connect();
      await client.createVM('job-default', testManifest);

      const cloudInit = mockCallTool.mock.calls[0][0].arguments.cloudInit;
      const runScript = getDecodedRunScript(cloudInit);
      expect(runScript).toContain('STATUS_MODE="simple"');
    });

    it('uses custom status mode', async () => {
      mockCallTool.mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify({ vmid: 100, node: 'pve1' }),
        }],
      });

      const detailedManifest: JobManifest = {
        task: 'Task',
        agentType: 'script',
        statusMode: 'streaming',
      };

      await client.connect();
      await client.createVM('job-streaming', detailedManifest);

      const cloudInit = mockCallTool.mock.calls[0][0].arguments.cloudInit;
      const runScript = getDecodedRunScript(cloudInit);
      expect(runScript).toContain('STATUS_MODE="streaming"');
    });
  });
});
