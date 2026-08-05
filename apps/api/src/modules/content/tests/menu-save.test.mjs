/**
 * Content · tests/menu-save.test.mjs
 * That a save actually advances the version.
 *
 * This pins a bug that was invisible from the screen and fatal under two
 * editors: the service passed the caller's version as BOTH the value to write
 * and the value to match, so the row never advanced and a stale save kept
 * succeeding — silently overwriting whoever saved first, which is the exact
 * failure the version column exists to prevent.
 *
 * The repository is a stand-in, because the point is the arithmetic in the
 * service rather than the SQL underneath it.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MenuService } from '../../../../dist/modules/content/application/menu-blog-service.js';

function fakeStore(initial) {
  let row = initial;
  return {
    calls: [],
    async findById() {
      return row;
    },
    async list() {
      return { nodes: [row], pageInfo: {} };
    },
    async insert(entity) {
      row = entity;
      return entity;
    },
    async takenHandles() {
      return new Set();
    },
    async update(entity, expectedVersion) {
      this.calls.push({ writes: entity.version, expects: expectedVersion });
      // What the real repository does: match on the expected version, and fail
      // the write when it does not match.
      if (expectedVersion !== row.version) {
        const error = new Error('Modified by someone else');
        error.name = 'StaleWriteError';
        throw error;
      }
      row = entity;
      return entity;
    },
  };
}

const menu = { id: 'm-1', title: 'Main', handle: 'main', items: [], version: 1 };

test('saving writes the NEXT version and matches on the current one', async () => {
  const store = fakeStore({ ...menu });
  const service = new MenuService(store);

  const saved = await service.save('m-1', 1, { title: 'Renamed' });

  // Both halves matter. Writing the caller's version leaves the row where it
  // was; matching on the next one never matches anything.
  assert.deepEqual(store.calls[0], { writes: 2, expects: 1 });
  assert.equal(saved.version, 2);
});

test('a second editor at the same version is refused', async () => {
  const store = fakeStore({ ...menu });
  const service = new MenuService(store);

  await service.save('m-1', 1, { title: 'First editor' });

  await assert.rejects(
    () => service.save('m-1', 1, { title: 'Second editor' }),
    /Modified by someone else/,
  );
});

test('an omitted field is left alone rather than erased', async () => {
  // A complete item: the domain requires a title on every one, and a stub
  // without one fails the validation rather than the behaviour under test.
  const item = { id: 'x', title: 'Shop', target: 'home', url: '/', subjectId: null, children: [] };
  const store = fakeStore({ ...menu, title: 'Keep me', items: [item] });
  const service = new MenuService(store);

  // A controller produces `undefined` for a field the caller omitted, and
  // `{...current, ...patch}` would overwrite the real value with it.
  const saved = await service.save('m-1', 1, { title: undefined, items: undefined });

  assert.equal(saved.title, 'Keep me');
  assert.deepEqual(saved.items, [item]);
});
