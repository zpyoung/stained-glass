#!/usr/bin/env node
import {
  buildChannelNotification,
  handleToolCall,
  recordChannelNotification,
  TOOL_DEFINITIONS
} from './channel-server.mjs';

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command !== 'simulate') {
    throw new Error('Usage: node bridge/claude/harness.mjs simulate --event-log <path> --message <text>');
  }

  const options = parseArgs(args);
  if (!options.eventLog) {
    throw new Error('--event-log is required.');
  }

  const notification = buildChannelNotification({
    message: options.message ?? 'Hello from Stained Glass',
    sender: 'stained-glass-harness',
    taskId: 'sg_task_harness'
  });
  await recordChannelNotification({ eventLog: options.eventLog, notification });

  await handleToolCall({
    name: 'stained_glass_reply',
    arguments: {
      sessionId: 'claude-session-1',
      taskId: 'sg_task_harness',
      messageId: notification.params.messageId,
      text: 'Stubbed Claude reply recorded by the local harness.',
      format: 'markdown'
    },
    eventLog: options.eventLog
  });

  await handleToolCall({
    name: 'stained_glass_status',
    arguments: {
      sessionId: 'claude-session-1',
      taskId: 'sg_task_harness',
      state: 'working',
      label: 'Harness status',
      detail: 'Stubbed status path from Claude to Stained Glass event stream.'
    },
    eventLog: options.eventLog
  });

  console.log(JSON.stringify({
    notification,
    replyTool: TOOL_DEFINITIONS.find((tool) => tool.name === 'stained_glass_reply'),
    statusTool: TOOL_DEFINITIONS.find((tool) => tool.name === 'stained_glass_status')
  }, null, 2));
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

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
});
