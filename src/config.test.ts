import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset environment variables
    delete process.env.CALLBACK_PORT;
    delete process.env.CALLBACK_HOST;
    delete process.env.PROXMOX_ADMIN_PATH;
    delete process.env.DEFAULT_VM_TEMPLATE;
    delete process.env.DEFAULT_TIMEOUT;
    delete process.env.DEFAULT_CPU;
    delete process.env.DEFAULT_MEMORY;
    delete process.env.DEFAULT_DISK;
    delete process.env.HEARTBEAT_THRESHOLD_SECONDS;
    delete process.env.CLEANUP_INTERVAL_SECONDS;
  });

  afterEach(() => {
    // Restore original environment
    Object.keys(process.env).forEach(key => {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    });
    Object.assign(process.env, originalEnv);
  });

  it('returns default values when no env vars set', () => {
    const config = loadConfig();

    expect(config.callbackPort).toBe(8765);
    expect(config.callbackHost).toBe('0.0.0.0');
    expect(config.proxmoxAdminPath).toBe('./node_modules/mcp-proxmox-admin/dist/index.js');
    expect(config.defaultVmTemplate).toBe('agent-template');
    expect(config.defaultTimeout).toBe(3600);
    expect(config.defaultCpu).toBe(2);
    expect(config.defaultMemory).toBe('2G');
    expect(config.defaultDisk).toBe('10G');
    expect(config.heartbeatThresholdSeconds).toBe(120);
    expect(config.cleanupIntervalSeconds).toBe(30);
  });

  it('reads CALLBACK_PORT from env', () => {
    process.env.CALLBACK_PORT = '9999';
    const config = loadConfig();
    expect(config.callbackPort).toBe(9999);
  });

  it('reads CALLBACK_HOST from env', () => {
    process.env.CALLBACK_HOST = '192.168.1.1';
    const config = loadConfig();
    expect(config.callbackHost).toBe('192.168.1.1');
  });

  it('reads PROXMOX_ADMIN_PATH from env', () => {
    process.env.PROXMOX_ADMIN_PATH = '/custom/path/index.js';
    const config = loadConfig();
    expect(config.proxmoxAdminPath).toBe('/custom/path/index.js');
  });

  it('reads DEFAULT_VM_TEMPLATE from env', () => {
    process.env.DEFAULT_VM_TEMPLATE = 'custom-template';
    const config = loadConfig();
    expect(config.defaultVmTemplate).toBe('custom-template');
  });

  it('reads DEFAULT_TIMEOUT from env', () => {
    process.env.DEFAULT_TIMEOUT = '7200';
    const config = loadConfig();
    expect(config.defaultTimeout).toBe(7200);
  });

  it('reads DEFAULT_CPU from env', () => {
    process.env.DEFAULT_CPU = '4';
    const config = loadConfig();
    expect(config.defaultCpu).toBe(4);
  });

  it('reads DEFAULT_MEMORY from env', () => {
    process.env.DEFAULT_MEMORY = '8G';
    const config = loadConfig();
    expect(config.defaultMemory).toBe('8G');
  });

  it('reads DEFAULT_DISK from env', () => {
    process.env.DEFAULT_DISK = '50G';
    const config = loadConfig();
    expect(config.defaultDisk).toBe('50G');
  });

  it('reads HEARTBEAT_THRESHOLD_SECONDS from env', () => {
    process.env.HEARTBEAT_THRESHOLD_SECONDS = '300';
    const config = loadConfig();
    expect(config.heartbeatThresholdSeconds).toBe(300);
  });

  it('reads CLEANUP_INTERVAL_SECONDS from env', () => {
    process.env.CLEANUP_INTERVAL_SECONDS = '60';
    const config = loadConfig();
    expect(config.cleanupIntervalSeconds).toBe(60);
  });

  it('reads all env vars together', () => {
    process.env.CALLBACK_PORT = '8080';
    process.env.CALLBACK_HOST = '10.0.0.1';
    process.env.PROXMOX_ADMIN_PATH = '/path/to/admin';
    process.env.DEFAULT_VM_TEMPLATE = 'my-template';
    process.env.DEFAULT_TIMEOUT = '1800';
    process.env.DEFAULT_CPU = '8';
    process.env.DEFAULT_MEMORY = '16G';
    process.env.DEFAULT_DISK = '100G';
    process.env.HEARTBEAT_THRESHOLD_SECONDS = '180';
    process.env.CLEANUP_INTERVAL_SECONDS = '45';

    const config = loadConfig();

    expect(config.callbackPort).toBe(8080);
    expect(config.callbackHost).toBe('10.0.0.1');
    expect(config.proxmoxAdminPath).toBe('/path/to/admin');
    expect(config.defaultVmTemplate).toBe('my-template');
    expect(config.defaultTimeout).toBe(1800);
    expect(config.defaultCpu).toBe(8);
    expect(config.defaultMemory).toBe('16G');
    expect(config.defaultDisk).toBe('100G');
    expect(config.heartbeatThresholdSeconds).toBe(180);
    expect(config.cleanupIntervalSeconds).toBe(45);
  });

  it('throws on invalid port (too low)', () => {
    process.env.CALLBACK_PORT = '0';
    expect(() => loadConfig()).toThrow();
  });

  it('throws on invalid port (too high)', () => {
    process.env.CALLBACK_PORT = '70000';
    expect(() => loadConfig()).toThrow();
  });

  it('throws on invalid timeout (less than 1)', () => {
    process.env.DEFAULT_TIMEOUT = '0';
    expect(() => loadConfig()).toThrow();
  });

  it('throws on invalid cpu (less than 1)', () => {
    process.env.DEFAULT_CPU = '0';
    expect(() => loadConfig()).toThrow();
  });

  it('throws on invalid heartbeat threshold (less than 30)', () => {
    process.env.HEARTBEAT_THRESHOLD_SECONDS = '10';
    expect(() => loadConfig()).toThrow();
  });

  it('throws on invalid cleanup interval (less than 10)', () => {
    process.env.CLEANUP_INTERVAL_SECONDS = '5';
    expect(() => loadConfig()).toThrow();
  });
});
