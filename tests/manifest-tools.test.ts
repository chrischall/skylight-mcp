import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { registerFrameTools } from '../src/tools/frames.js';
import { registerSettingsTools } from '../src/tools/settings.js';
import { registerCalendarTools } from '../src/tools/calendars.js';
import { registerMemberTools } from '../src/tools/members.js';
import { registerEventTools } from '../src/tools/events.js';
import { registerListTools } from '../src/tools/lists.js';
import { registerChoreTools } from '../src/tools/chores.js';
import { registerMealTools } from '../src/tools/meals.js';
import { registerMessageTools } from '../src/tools/messages.js';
import { registerTaskTools } from '../src/tools/tasks.js';
import { registerRewardTools } from '../src/tools/rewards.js';
import { registerAiTools } from '../src/tools/ai.js';
import { registerPhotoTools } from '../src/tools/photos.js';
import { registerHealthcheckTools } from '../src/tools/health.js';
import { makeClient } from './tools/_setup.js';

/**
 * The .mcpb manifest's `tools` array is what a client shows BEFORE install, and
 * what a reviewer reads to see what the bundle can do. It sat at the original
 * 22 while the server grew to 114 — every write, upload and delete unlisted
 * (fleet-audit#1123). So it is derived from the REGISTERED server, the same
 * registrar list `src/index.ts` passes, and this test holds the file to it.
 *
 * After adding, renaming or re-describing a tool, regenerate with:
 *   SYNC_MANIFEST=1 npx vitest run tests/manifest-tools.test.ts
 */
function registeredTools(): Array<{ name: string; description: string }> {
  const tools: Array<{ name: string; description: string }> = [];
  const server = {
    registerTool: (name: string, cfg: { description?: string }) => {
      tools.push({ name, description: cfg.description ?? '' });
    },
  } as never;
  const { client } = makeClient();
  const get = async () => client;
  for (const register of [
    registerFrameTools,
    registerSettingsTools,
    registerCalendarTools,
    registerMemberTools,
    registerEventTools,
    registerListTools,
    registerChoreTools,
    registerMealTools,
    registerMessageTools,
    registerTaskTools,
    registerRewardTools,
    registerAiTools,
    registerPhotoTools,
    registerHealthcheckTools,
  ]) {
    register(server, get as never);
  }
  return tools;
}

const manifestPath = join(__dirname, '..', 'manifest.json');

describe('manifest.json tools', () => {
  it('lists exactly the tools the server registers, with their descriptions', () => {
    const expected = registeredTools();
    const raw = readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(raw) as { tools?: unknown };
    if (process.env.SYNC_MANIFEST === '1') {
      writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, tools: expected }, null, 2)}\n`);
      return;
    }
    expect(manifest.tools).toEqual(expected);
  });

  it('covers the whole surface (guards against a registrar being dropped here)', () => {
    expect(registeredTools()).toHaveLength(114);
  });
});
