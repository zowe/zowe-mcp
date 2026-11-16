# Zowe MCP documentation

The documentation is grouped by what you want to do.

## Use Zowe MCP

For people who use Zowe MCP with their own AI assistant and z/OS user ID.

| Document | Read it to |
| --- | --- |
| [README](../README.md) | Install Zowe MCP and connect to z/OS |
| [VS Code extension](../packages/zowe-mcp-vscode/README.md) | Configure Zowe MCP in VS Code |
| [VS Code and GitHub Copilot](copilot-setup-guide.md) | Check that GitHub Copilot sees the Zowe tools |
| [Standalone server guide](standalone-mcp.md) | Use Zowe MCP with any other MCP client, and look up server options |
| [Claude Code](claude-code-mcp.md), [Kiro](kiro-mcp.md) | Apply the client-specific settings |
| [Mock mode](mock-mode.md) | Try Zowe MCP without a mainframe |
| [MCP reference](mcp-reference.md) | Look up a tool, prompt, or resource |
| [Safety and security principles](mcp-safety-security-principles.md) | Understand what limits the AI assistant |

## Run a remote server

For administrators who run one Zowe MCP server for a team.

| Document | Read it to |
| --- | --- |
| [Remote server guide](remote-mcp-server.md) | Start a remote server. Read this first. |
| [Authentication and z/OS access](mcp-authentication-oauth.md) | Configure token validation and the per-user connection store |
| [Remote HTTP MCP: registry and clients](remote-http-mcp-registry.md) | Configure the reverse proxy, clients, and MCP registry entries |
| [Remote server test environment with Keycloak](remote-dev-keycloak.md) | Run a complete test environment on one machine |
| [Local MCP registry](local-registry-setup.md) | Run a test MCP registry on one machine |

## Develop and contribute

For people who change Zowe MCP.

| Document | Read it to |
| --- | --- |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | Set up a clone, validate a change, and open a pull request. Read this first. |
| [AGENTS.md](../AGENTS.md) | Follow the project's coding rules |
| [Mock z/OS host](mock-zos-host.md) | Test the SSH path without a mainframe |
| [How to add a CLI plug-in](how-to-add-cli-plugin.md) | Expose a Zowe CLI plug-in as MCP tools |
| [Evaluation harness](../packages/zowe-mcp-evals/README.md) | Measure how well AI models use the tools |
| [Evaluation scoreboard](eval-scoreboard.md) | See recorded evaluation results |
| [Manual QA](manual-qa.md) | Test the VS Code extension by hand |
| [End-to-end tests](../packages/zowe-mcp-e2e/README.md) | Run the automated VS Code and Copilot tests |
| [RELEASING.md](../RELEASING.md) | Publish a release |
