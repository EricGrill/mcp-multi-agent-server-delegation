# MCP Multi-Agent Server Delegation

An MCP server that delegates tasks to isolated Proxmox VMs for secure execution.

## Features

- Execute untrusted code in isolated VMs
- Support for Claude, scripts, or custom agents
- HTTP callback status reporting
- Configurable VM lifecycle (ephemeral/persistent)
- Automatic timeout and cleanup

## Installation

```bash
npm install
npm run build
```

## Configuration

Copy `.env.example` to `.env` and configure:

- `CALLBACK_PORT` - Port for callback server (default: 8765)
- `PROXMOX_ADMIN_PATH` - Path to mcp-proxmox-admin

## Usage

### As MCP Server

Add to your MCP client config:

```json
{
  "mcpServers": {
    "delegation": {
      "command": "node",
      "args": ["/path/to/dist/index.js"],
      "env": {
        "CALLBACK_PORT": "8765",
        "PROXMOX_ADMIN_PATH": "/path/to/mcp-proxmox-admin"
      }
    }
  }
}
```

### Available Tools

- `submit_job` - Submit a job for execution
- `get_job_status` - Check job status
- `get_job_result` - Get completed job results
- `cancel_job` - Cancel a job
- `list_jobs` - List all jobs

## Development

```bash
npm run dev      # Run in development mode
npm test         # Run tests
npm run build    # Build for production
```
