import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const TYPE_MAP = new Map([
  ['SessionStart', 'hook.session_start'],
  ['UserPromptSubmit', 'hook.user_prompt_submit'],
  ['PreToolUse', 'hook.pre_tool_use'],
  ['PostToolUse', 'hook.post_tool_use'],
  ['Notification', 'hook.notification'],
  ['Stop', 'hook.stop'],
  ['PreCompact', 'hook.pre_compact'],
  ['SessionEnd', 'hook.session_end']
]);

export function createBridgeEvent({
  source,
  type,
  payload,
  claude = {},
  recoverability = {}
}) {
  if (!source || !type || !payload) {
    throw new Error('Bridge events require source, type, and payload.');
  }

  return {
    id: `sg_evt_${randomUUID()}`,
    timestamp: new Date().toISOString(),
    source,
    type,
    claude: {
      sessionId: claude.sessionId ?? null,
      taskId: claude.taskId ?? null,
      messageId: claude.messageId ?? null
    },
    payload,
    recoverability: {
      replayable: recoverability.replayable ?? false,
      durable: recoverability.durable ?? false,
      reason: recoverability.reason ?? null
    }
  };
}

export async function appendBridgeEvent(eventLog, event) {
  await mkdir(dirname(eventLog), { recursive: true });
  await appendFile(eventLog, `${JSON.stringify(event)}\n`, 'utf8');
  return event;
}

export function normalizeReplyToolCall(args = {}) {
  return createBridgeEvent({
    source: 'claude',
    type: 'claude.reply',
    claude: {
      sessionId: args.sessionId,
      taskId: args.taskId,
      messageId: args.messageId
    },
    payload: {
      text: args.text ?? '',
      format: args.format ?? 'markdown',
      artifacts: Array.isArray(args.artifacts) ? args.artifacts : []
    },
    recoverability: {
      replayable: false,
      durable: true,
      reason: 'Persisted bridge event can be replayed to the UI, but not resent to Claude.'
    }
  });
}

export function normalizeStatusToolCall(args = {}) {
  return createBridgeEvent({
    source: 'claude',
    type: 'claude.status',
    claude: {
      sessionId: args.sessionId,
      taskId: args.taskId
    },
    payload: {
      state: args.state ?? 'working',
      label: args.label ?? null,
      detail: args.detail ?? null,
      progress: typeof args.progress === 'number' ? args.progress : null
    },
    recoverability: {
      replayable: false,
      durable: true,
      reason: 'Status is useful after restart, but stale states must be reconciled with a live session.'
    }
  });
}

export function normalizeArtifactToolCall(args = {}) {
  return createBridgeEvent({
    source: 'claude',
    type: 'claude.artifact',
    claude: {
      sessionId: args.sessionId,
      taskId: args.taskId,
      messageId: args.messageId
    },
    payload: {
      name: args.name ?? 'artifact',
      mimeType: args.mimeType ?? 'text/plain',
      content: args.content ?? '',
      uri: args.uri ?? null
    },
    recoverability: {
      replayable: false,
      durable: true,
      reason: 'Artifact event is durable when the event log is retained.'
    }
  });
}

export function normalizeHookEvent(input = {}) {
  const hookName = input.hook_event_name ?? input.event ?? 'Unknown';
  return createBridgeEvent({
    source: 'claude-hook',
    type: TYPE_MAP.get(hookName) ?? 'hook.unknown',
    claude: {
      sessionId: input.session_id,
      taskId: input.task_id
    },
    payload: {
      hookEventName: hookName,
      transcriptPath: input.transcript_path ?? null,
      cwd: input.cwd ?? null,
      toolName: input.tool_name ?? null,
      toolInput: input.tool_input ?? null,
      toolResponse: input.tool_response ?? null,
      notification: input.notification ?? null,
      raw: input
    },
    recoverability: {
      replayable: true,
      durable: true,
      reason: 'Hook telemetry is append-only and can be replayed into the UI event stream.'
    }
  });
}
