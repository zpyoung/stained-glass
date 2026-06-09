#!/usr/bin/env node
import {
  appendBridgeEvent,
  createBridgeEvent,
  normalizeArtifactToolCall,
  normalizeReplyToolCall,
  normalizeStatusToolCall
} from './schema.mjs';

export const SERVER_METADATA = {
  name: 'stained-glass-claude-bridge',
  version: '0.1.0',
  protocol: 'mcp-stdio-spike',
  capabilities: {
    experimental: {
      'claude/channel': {},
      'claude/channel/permission': {
        enabled: false,
        reason: 'Deferred until live Claude Code permission relay is validated.'
      }
    },
    tools: {
      listChanged: false
    }
  }
};

export const TOOL_DEFINITIONS = [
  {
    name: 'stained_glass_reply',
    description: 'Send a markdown reply from Claude Code to the Stained Glass bridge/UI event stream.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        taskId: { type: 'string' },
        messageId: { type: 'string' },
        text: { type: 'string' },
        format: { type: 'string', enum: ['markdown', 'text'] },
        artifacts: { type: 'array', items: { type: 'object' } }
      },
      required: ['text']
    }
  },
  {
    name: 'stained_glass_status',
    description: 'Send a Claude Code task/session status update to Stained Glass.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        taskId: { type: 'string' },
        state: { type: 'string' },
        label: { type: 'string' },
        detail: { type: 'string' },
        progress: { type: 'number' }
      },
      required: ['state']
    }
  },
  {
    name: 'stained_glass_artifact',
    description: 'Record a Claude-produced artifact for the local bridge/UI stream.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        taskId: { type: 'string' },
        messageId: { type: 'string' },
        name: { type: 'string' },
        mimeType: { type: 'string' },
        content: { type: 'string' },
        uri: { type: 'string' }
      },
      required: ['name']
    }
  }
];

export function buildChannelNotification({ message, sender = 'stained-glass', taskId = null }) {
  const messageId = `sg_msg_${Date.now()}`;
  return {
    jsonrpc: '2.0',
    method: 'notifications/claude/channel',
    params: {
      channel: 'stained-glass',
      sender,
      messageId,
      taskId,
      content: [
        {
          type: 'text',
          text: message
        }
      ],
      metadata: {
        bridge: SERVER_METADATA.name,
        ui: 'stained-glass'
      }
    }
  };
}

export async function recordChannelNotification({ eventLog, notification }) {
  return appendBridgeEvent(
    eventLog,
    createBridgeEvent({
      source: 'stained-glass',
      type: 'channel.notification.sent',
      claude: {
        taskId: notification.params.taskId,
        messageId: notification.params.messageId
      },
      payload: { notification },
      recoverability: {
        replayable: true,
        durable: true,
        reason: 'The app-originated message can be resent while the Claude Code session is still live.'
      }
    })
  );
}

export async function handleToolCall({ name, arguments: args = {}, eventLog }) {
  const event = normalizeToolCall(name, args);
  if (eventLog) {
    await appendBridgeEvent(eventLog, event);
  }
  return {
    content: [
      {
        type: 'text',
        text: `recorded ${event.type}`
      }
    ],
    structuredContent: {
      event
    }
  };
}

export function normalizeToolCall(name, args = {}) {
  if (name === 'stained_glass_reply') return normalizeReplyToolCall(args);
  if (name === 'stained_glass_status') return normalizeStatusToolCall(args);
  if (name === 'stained_glass_artifact') return normalizeArtifactToolCall(args);
  throw new Error(`Unknown Stained Glass bridge tool: ${name}`);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'metadata') {
    console.log(JSON.stringify(SERVER_METADATA, null, 2));
    return;
  }

  if (command === 'notify') {
    const options = parseArgs(args);
    const notification = buildChannelNotification({
      message: options.message ?? '',
      sender: options.sender ?? 'stained-glass',
      taskId: options.taskId ?? null
    });
    if (options.eventLog) {
      await recordChannelNotification({ eventLog: options.eventLog, notification });
    }
    console.log(JSON.stringify(notification, null, 2));
    return;
  }

  if (command === 'tool-call') {
    const options = parseArgs(args);
    const payload = options.json
      ? JSON.parse(options.json)
      : JSON.parse(await readStdin());
    const result = await handleToolCall({
      name: payload.name,
      arguments: payload.arguments,
      eventLog: options.eventLog
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  await serveJsonRpc();
}

async function serveJsonRpc() {
  let buffer = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const request = JSON.parse(line);
      const response = await handleJsonRpc(request);
      if (response) {
        process.stdout.write(`${JSON.stringify(response)}\n`);
      }
    }
  }
}

async function handleJsonRpc(request) {
  if (request.method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        protocolVersion: request.params?.protocolVersion ?? '2025-06-18',
        serverInfo: {
          name: SERVER_METADATA.name,
          version: SERVER_METADATA.version
        },
        capabilities: SERVER_METADATA.capabilities
      }
    };
  }
  if (request.method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id: request.id,
      result: { tools: TOOL_DEFINITIONS }
    };
  }
  if (request.method === 'tools/call') {
    return {
      jsonrpc: '2.0',
      id: request.id,
      result: await handleToolCall({
        name: request.params?.name,
        arguments: request.params?.arguments
      })
    };
  }
  if (request.id === undefined) return null;
  return {
    jsonrpc: '2.0',
    id: request.id,
    error: {
      code: -32601,
      message: `Unsupported method: ${request.method}`
    }
  };
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    parsed[key] = args[index + 1];
    index += 1;
  }
  return parsed;
}

async function readStdin() {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    input += chunk;
  }
  return input;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  });
}
