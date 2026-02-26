# Proposal: Zowe MCP Status Bar

This document describes the **status bar** functionality of the Zowe MCP VS Code extension from the end user’s perspective and proposes it as a standard part of the extension.

## Purpose

The status bar gives users a single, always-visible place to see **which z/OS system (connection) is active** for MCP tools (e.g. Copilot Chat). Users can **change the active system with one click** without leaving the editor or opening settings.

## Where It Appears

- A **status bar item** on the **right** side of the VS Code status bar (near Copilot Chat and other MCP-related UI).
- It shows an **icon** and **text** (connection spec or a short message).

## What the User Sees

### Icon and badge

- **Mainframe-style icon**: A simple “rack” shape (frame with horizontal dividers) that suggests a mainframe/3270-style terminal.
- **Status badge**: A small circle in the bottom-right of the icon:
  - **Filled dot** → MCP server is **connected**; the active system is known and in use.
  - **Outline (ring)** → MCP server is **not connected** yet, or the selection is pending.

So at a glance:

- **Icon with filled badge** = “Zowe MCP is connected; this is the active system.”
- **Icon with outline badge** = “Zowe MCP is not connected yet” or “this is your chosen system, but the server hasn’t started.”

### Text and tooltips

| State | Text example | Tooltip (summary) |
|-------|----------------|-------------------|
| Server connected, system active | `user@host.example.com` | Active z/OS connection (MCP server connected). Click to change. |
| Server connected, no system selected | `Zowe MCP: No active system` | Active z/OS connection. Click to change. |
| Server not connected, user already picked a system | `user@host.example.com` | Selected system (MCP server not connected yet). Use Copilot chat to start it. Click to change. |
| Server not connected, nothing selected | `Zowe MCP: Server not yet started` | MCP server has not connected yet. Use Copilot chat to start it. Click to select a system. |

Tooltips clarify whether the server is connected and what “click” will do (change or select system).

## What the User Can Do

### Click to change or select the active system

- **Clicking** the status bar item opens a **quick pick**:
  - **Title**: “Select active z/OS system”
  - **Items**: All known systems/connections (from the MCP server when connected, or from **Zowe MCP** settings when the server has not sent context yet).
  - When there are multiple connections to the same host, each connection (e.g. `user1@host`, `user2@host`) appears as a separate option.
  - The **active** connection can be indicated in the list (e.g. “Active” in the detail).

- **Choosing an item**:
  - Sets that system/connection as active (for the MCP server when it is running).
  - **Persists** the choice in **workspace state** so it survives reloads and restarts.
  - If the server was not connected yet, the choice is **pending**: it is applied as soon as the MCP server connects (e.g. when the user opens Copilot Chat). A short message can inform the user: “Selection will be sent to the MCP server when it connects.”

So from the user’s point of view: **one click → pick system → done**. No need to edit settings or run commands from the palette for the common case.

### When no systems are configured

- If the user clicks and there are **no** connections (server not connected and no entries in settings), the extension can show an informational message explaining that the MCP server has not connected yet and that they should add connections in Zowe MCP settings and/or use Copilot Chat to start the server.

## Behavior Summary

1. **Always visible** – The status bar item is shown as soon as the extension is active so users always see “Zowe MCP” and the current (or pending) system.
2. **Server-driven when connected** – When the MCP server is connected and sends context, the status bar reflects the **actual** active system and uses the “connected” icon/badge.
3. **Settings fallback when not connected** – When the server has not connected yet, the list in the quick pick is built from **Zowe MCP** settings (e.g. `zoweMCP.nativeConnections`), and the status bar can show the **last selected** (stored) system with the “disconnected” icon/badge.
4. **Persistence** – The last chosen system is stored per workspace and **restored** when the user reopens the workspace or when the MCP server connects after a restart. No need to reselect after every reload.
5. **Pending selection** – If the user selects a system before the server has started, that selection is sent to the server automatically when it connects, so the status bar and the server stay in sync.

## Proposed as Standard Functionality

This behavior is proposed as the **default** status bar experience for the Zowe MCP extension:

- **Discoverable**: Users see the active (or pending) system without opening any panel or settings.
- **One-click change**: Switching the active z/OS system is a single click and a quick pick choice.
- **Clear state**: Icon and badge (filled vs outline) plus tooltips make “connected vs not” and “selected vs not” obvious.
- **Robust across startup**: Works when the server is already connected, when it connects later (e.g. via Copilot), and when the user has pre-selected a system in settings before the server runs.

Storing the proposal in this document allows product and UX to review, adjust wording or behavior, and align with other Zowe MCP docs (e.g. Copilot setup, pipe events) before treating the status bar as a committed, user-facing feature.
