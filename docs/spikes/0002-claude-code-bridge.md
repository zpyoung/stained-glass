# Claude Code Bridge Spike

Issue: #27

## Goal

This spike proves the smallest local bridge shape for a Stained Glass companion app that uses Claude Code channels and hooks instead of terminal scraping as the primary integration point. It is intentionally not production UI.

## Recommended Architecture

```text
Stained Glass UI
  ⇄ local Stained Glass Claude bridge
       ├─ channel MCP server over stdio
       │    ├─ declares capabilities.experimental["claude/channel"]
       │    ├─ declares capabilities.experimental["claude/channel/permission"] disabled/deferred
       │    ├─ accepts Stained Glass-originated messages
       │    ├─ emits notifications/claude/channel
       │    └─ exposes stained_glass_reply/status/artifact tools
       └─ hook receiver command
            ├─ reads Claude Code hook JSON on stdin
            ├─ normalizes lifecycle/tool/notification events
            └─ appends the shared bridge/UI event stream
  ⇄ running local Claude Code session
```

The production app should keep the bridge local to the developer machine. Channels are the ingress path for user/app messages into an already-running Claude Code session. Explicit tools are the Claude-to-Stained-Glass path for replies, statuses, and artifacts. Hooks are deterministic telemetry for lifecycle and tool-use events, including states Claude may not decide to report through a reply tool.

## Prototype Files

- `bridge/claude/channel-server.mjs`: stdlib-only channel server prototype, metadata declaration, channel notification builder, and reply/status/artifact tool contracts.
- `bridge/claude/schema.mjs`: internal event schema plus normalization helpers.
- `bridge/claude/harness.mjs`: local no-credentials harness that simulates an app message and stubbed Claude reply/status tool calls.
- `bridge/claude/hook-normalizer.mjs`: command hook receiver that reads hook JSON from stdin and appends normalized events.
- `scripts/check-claude-bridge.mjs`: deterministic test harness for the spike contract.

## Internal Event Schema

Every normalized bridge event is one NDJSON line:

```json
{
  "id": "sg_evt_<uuid>",
  "timestamp": "2026-06-09T00:00:00.000Z",
  "source": "stained-glass | claude | claude-hook",
  "type": "channel.notification.sent | claude.reply | claude.status | claude.artifact | hook.*",
  "claude": {
    "sessionId": "optional Claude session id",
    "taskId": "optional bridge/Claude task id",
    "messageId": "optional channel message id"
  },
  "payload": {},
  "recoverability": {
    "replayable": true,
    "durable": true,
    "reason": "human-readable recovery note"
  }
}
```

The future Tauri frontend should consume this event stream through a local bridge process or Rust-side supervisor and render it as status, transcript, and artifact updates.

## Channel Capabilities

The prototype declares:

```json
{
  "capabilities": {
    "experimental": {
      "claude/channel": {},
      "claude/channel/permission": {
        "enabled": false,
        "reason": "Deferred until live Claude Code permission relay is validated."
      }
    },
    "tools": {
      "listChanged": false
    }
  }
}
```

`claude/channel/permission` is documented but disabled because permission relay needs live Claude Code validation before it should be a production dependency.

## Channel Notification Contract

Stained Glass-originated messages are emitted as:

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/claude/channel",
  "params": {
    "channel": "stained-glass",
    "sender": "stained-glass",
    "messageId": "sg_msg_<timestamp>",
    "taskId": "optional task id",
    "content": [{ "type": "text", "text": "user/app message" }],
    "metadata": { "bridge": "stained-glass-claude-bridge", "ui": "stained-glass" }
  }
}
```

The local harness records this notification as `channel.notification.sent` before it simulates Claude tool calls.

## Claude-to-Bridge Tool Contract

The server exposes three explicit tools:

- `stained_glass_reply`: records a markdown/text reply with optional artifact references as `claude.reply`.
- `stained_glass_status`: records task/session state as `claude.status`.
- `stained_glass_artifact`: records inline content or a local URI as `claude.artifact`.

Live Claude validation is not required for local development because `bridge/claude/harness.mjs` stubs `stained_glass_reply` and `stained_glass_status` into the same event stream.

## Hook Contract

`bridge/claude/hook-normalizer.mjs` reads one Claude Code hook JSON payload from stdin and writes a normalized event. Known hook names normalize to:

- `SessionStart` -> `hook.session_start`
- `UserPromptSubmit` -> `hook.user_prompt_submit`
- `PreToolUse` -> `hook.pre_tool_use`
- `PostToolUse` -> `hook.post_tool_use`
- `Notification` -> `hook.notification`
- `Stop` -> `hook.stop`
- `PreCompact` -> `hook.pre_compact`
- `SessionEnd` -> `hook.session_end`

Example local hook command:

```bash
printf '%s\n' '{"hook_event_name":"PostToolUse","session_id":"claude-session-1","tool_name":"Read","tool_response":{"filePath":"README.md"}}' \
  | node bridge/claude/hook-normalizer.mjs --event-log /tmp/stained-glass-claude-events.ndjson
```

## Local Validation

No production credentials are required for the local harness:

```bash
npm run check:claude-bridge
node bridge/claude/channel-server.mjs metadata
node bridge/claude/harness.mjs simulate \
  --event-log /tmp/stained-glass-claude-events.ndjson \
  --message "Summarize the current pane"
printf '%s\n' '{"hook_event_name":"PostToolUse","session_id":"claude-session-1","tool_name":"Read"}' \
  | node bridge/claude/hook-normalizer.mjs --event-log /tmp/stained-glass-claude-events.ndjson
cat /tmp/stained-glass-claude-events.ndjson
```

Full lightweight repository validation:

```bash
test -f README.md
npm run check:scaffold
npm run check:claude-bridge
npm run check:stain
node --check scripts/check-scaffold.mjs
node --check scripts/check-claude-bridge.mjs
node --check scripts/check-stain-cli.mjs
node --check bridge/claude/schema.mjs
node --check bridge/claude/channel-server.mjs
node --check bridge/claude/harness.mjs
node --check bridge/claude/hook-normalizer.mjs
node --check src/ipc.js
node --check src/terminal.js
node --check src/preview.js
python3 -m json.tool src-tauri/tauri.conf.json >/dev/null
```

## Live Claude Code Validation

Claude Code channels are a research-preview feature. Live validation requires:

- Claude Code v2.1.80+.
- Anthropic auth through claude.ai or a Console API key.
- Channel enablement for the user/org.
- Development channel loading with `--dangerously-load-development-channels`.
- A Claude Code version whose custom channel protocol still matches this spike.

Suggested live validation command shape:

```bash
claude --dangerously-load-development-channels server:stained-glass \
  --channels server:stained-glass
```

The exact server registration/config path still needs live Claude Code validation. On this host, live validation was blocked because `claude` was not available on `PATH`.

## Research-Preview Constraints

Channels only deliver into an open Claude Code session. They are not a session launcher, background supervisor, auth manager, durable queue, or cloud session integration. The channel flag syntax and protocol may change during the research preview. Managed organizations may block channels unless an admin enables them. Development channels are intentionally local/testing-only.

Hooks are better for deterministic telemetry and policy-adjacent events. Channel reply tools are better for user-visible Claude-authored content. Permission relay should be capability-gated and deferred until validated.

## Production Follow-Ups

- session launching/supervision: own the lifecycle for starting, naming, monitoring, and stopping local Claude Code sessions.
- durable recovery: persist Claude session id, bridge task ids, transcript/log path, event log, cwd, branch/worktree, channel message ids, and permission request ids.
- permission UX: validate `claude/channel/permission`, decide fallback behavior, and design a clear local approval surface.
- frontend polish: stream bridge events into Tauri and add focused status/reply/artifact UI instead of an NDJSON harness.
- MCP/channel config: replace the newline JSON-RPC spike with the exact framing/config expected by the validated Claude Code channel runtime.
