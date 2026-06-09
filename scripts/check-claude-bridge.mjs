import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
const tempDir = await mkdtemp(join(tmpdir(), 'stained-glass-claude-bridge-'));
const eventLog = join(tempDir, 'events.ndjson');

try {
  const metadata = spawnNode('bridge/claude/channel-server.mjs', ['metadata']);
  assert.equal(metadata.status, 0, metadata.stderr);
  const server = JSON.parse(metadata.stdout);
  assert.equal(server.name, 'stained-glass-claude-bridge');
  assert.deepEqual(server.capabilities.experimental['claude/channel'], {});
  assert.equal(server.capabilities.experimental['claude/channel/permission'].enabled, false);

  const simulated = spawnNode('bridge/claude/harness.mjs', [
    'simulate',
    '--event-log',
    eventLog,
    '--message',
    'Summarize the current pane'
  ]);
  assert.equal(simulated.status, 0, simulated.stderr);
  const harnessResult = JSON.parse(simulated.stdout);
  assert.equal(harnessResult.notification.method, 'notifications/claude/channel');
  assert.equal(harnessResult.replyTool.name, 'stained_glass_reply');
  assert.equal(harnessResult.statusTool.name, 'stained_glass_status');

  const hook = spawnNode(
    'bridge/claude/hook-normalizer.mjs',
    ['--event-log', eventLog],
    {
      stdin: JSON.stringify({
        hook_event_name: 'PostToolUse',
        session_id: 'claude-session-1',
        transcript_path: '/tmp/transcript.jsonl',
        tool_name: 'Read',
        tool_response: { filePath: 'README.md' }
      })
    }
  );
  assert.equal(hook.status, 0, hook.stderr);

  const events = (await readFile(eventLog, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));

  assert.equal(events.length, 4);
  assert.equal(events[0].source, 'stained-glass');
  assert.equal(events[0].type, 'channel.notification.sent');
  assert.equal(events[0].payload.notification.method, 'notifications/claude/channel');
  assert.equal(events[1].source, 'claude');
  assert.equal(events[1].type, 'claude.reply');
  assert.equal(events[2].source, 'claude');
  assert.equal(events[2].type, 'claude.status');
  assert.equal(events[3].source, 'claude-hook');
  assert.equal(events[3].type, 'hook.post_tool_use');
  assert.equal(events[3].claude.sessionId, 'claude-session-1');
  assert.equal(events[3].recoverability.replayable, true);

  for (const event of events) {
    assert.match(event.id, /^sg_evt_/);
    assert.match(event.timestamp, /^\d{4}-\d{2}-\d{2}T/);
    assert.ok(event.payload);
    assert.ok(event.recoverability);
  }

  console.log(`Claude bridge check passed (${events.length} events verified).`);
} finally {
  await rm(tempDir, { force: true, recursive: true });
}

function spawnNode(relativePath, args = [], options = {}) {
  return spawnSync(process.execPath, [join(root, relativePath), ...args], {
    cwd: root,
    encoding: 'utf8',
    input: options.stdin ?? undefined
  });
}
