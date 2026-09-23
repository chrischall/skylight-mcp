import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { apiPath } from '../../src/tools/_shared.js';
import { registerChoreTools } from '../../src/tools/chores.js';
import { registerListTools } from '../../src/tools/lists.js';
import { makeClient } from './_setup.js';

/**
 * fleet-audit#247: every handler built its API path by interpolating
 * model-supplied ids verbatim, and WHATWG URL parsing then honours `?`, `#` and
 * `../`. A crafted id could therefore smuggle a query past a confirm gate
 * (`id: '123?apply_to=all'` on delete_chore) or climb out of the resource the
 * tool names (`itemId: '../../../lists/5'` deletes a whole list).
 */
describe('apiPath', () => {
  it('leaves ordinary ids untouched', () => {
    expect(apiPath`/frames/${'3435252'}/chores/${5}`).toBe('/frames/3435252/chores/5');
  });

  it('keeps the static parts of the template verbatim, including a static query', () => {
    expect(apiPath`/frames/${'1'}/meals/recipes/${'2'}?include=meal_category`).toBe(
      '/frames/1/meals/recipes/2?include=meal_category',
    );
  });

  it.each([
    ['a query', '123?apply_to=all', '123%3Fapply_to%3Dall'],
    ['a fragment', '5#x', '5%23x'],
    ['a slash', '../../../lists/5', '..%2F..%2F..%2Flists%2F5'],
    ['a percent escape', '%2e%2e', '%252e%252e'],
    ['a backslash', '..\\x', '..%5Cx'],
  ])('encodes %s inside one segment', (_label, raw, encoded) => {
    expect(apiPath`/frames/1/chores/${raw}`).toBe(`/frames/1/chores/${encoded}`);
  });

  it.each(['', '.', '..'])('rejects the dot/empty segment %j outright', (raw) => {
    expect(() => apiPath`/frames/1/chores/${raw}`).toThrow(/Invalid id/);
  });
});

describe('crafted ids cannot retarget a request', () => {
  function tools(register: (s: any, g: any) => void) {
    const t: Record<string, (a: any) => Promise<any>> = {};
    const server = { registerTool: (n: string, _cfg: any, cb: any) => { t[n] = cb; } } as any;
    const { client, request } = makeClient();
    register(server, async () => client);
    return { t, request };
  }

  it('delete_chore cannot smuggle apply_to=all past the gate through the id', async () => {
    const { t, request } = tools(registerChoreTools);
    request.mockResolvedValue(undefined);
    await t.skylight_delete_chore({ id: '123?apply_to=all' });
    expect(request).toHaveBeenCalledWith('DELETE', '/frames/3435252/chores/123%3Fapply_to%3Dall', {});
  });

  it('delete_list_item cannot climb out to the parent list', async () => {
    const { t, request } = tools(registerListTools);
    request.mockResolvedValue(undefined);
    await t.skylight_delete_list_item({ listId: '7', itemId: '../../../lists/5' });
    expect(request).toHaveBeenCalledWith('DELETE', '/frames/3435252/lists/7/list_items/..%2F..%2F..%2Flists%2F5');
  });

  it('delete_list_item refuses a bare ".." id without making a request', async () => {
    const { t, request } = tools(registerListTools);
    await expect(t.skylight_delete_list_item({ listId: '7', itemId: '..' })).rejects.toThrow(/Invalid id/);
    expect(request).not.toHaveBeenCalled();
  });
});

describe('source guard', () => {
  // A new tool that interpolates into a plain template literal reopens the hole.
  // Every API path literal with an interpolation must go through apiPath.
  const dir = join(__dirname, '..', '..', 'src', 'tools');
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));

  it.each(files)('%s builds every interpolated API path with apiPath', (file) => {
    const src = readFileSync(join(dir, file), 'utf8');
    const offenders = [...src.matchAll(/(apiPath)?`\/[^`]*\$\{[^`]*`/g)]
      .filter((m) => m[1] !== 'apiPath')
      .map((m) => m[0]);
    expect(offenders).toEqual([]);
  });
});
