#!/usr/bin/env node
import { appendBridgeEvent, normalizeHookEvent } from './schema.mjs';

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.eventLog) {
    throw new Error('Usage: node bridge/claude/hook-normalizer.mjs --event-log <path> < hook.json');
  }

  const input = JSON.parse(await readStdin());
  const event = normalizeHookEvent(input);
  await appendBridgeEvent(options.eventLog, event);
  console.log(JSON.stringify(event, null, 2));
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

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
});
