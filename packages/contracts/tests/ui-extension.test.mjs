/**
 * Contracts · tests/ui-extension.test.mjs
 * What an extension may say, and everything it may not.
 *
 * Written as an attacker rather than as an author. The validator runs on data
 * that arrived from a third party's worker, so the cases that matter are the
 * shapes a compromised extension would send — not the typos an honest one makes.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  EXTENSION_COMPONENTS,
  MAX_TREE_DEPTH,
  MAX_TREE_NODES,
  actionsIn,
  assertTreeValid,
} from '../dist/ui-extension.js';

const ok = {
  component: 'Stack',
  props: { direction: 'vertical', gap: '200' },
  children: [
    { component: 'Heading', props: { content: 'Shipping estimate' } },
    { component: 'Text', props: { content: 'Arrives in 3 days', tone: 'subdued' } },
    { component: 'Button', props: { label: 'Recalculate', action: 'recalculate' } },
  ],
};

test('a well-formed tree passes', () => {
  assert.doesNotThrow(() => assertTreeValid(ok));
});

test('a component outside the vocabulary is refused BY NAME', () => {
  // Named, so an author who typed `Card` is told rather than left watching
  // their extension render nothing.
  assert.throws(
    () => assertTreeValid({ component: 'Card' }),
    /"Card" is not a component extensions may use/,
  );
  assert.throws(() => assertTreeValid({ component: 'script' }), /not a component/);
  assert.throws(() => assertTreeValid({ component: 'iframe' }), /not a component/);
});

test('the props that would let markup through do not exist', () => {
  // The single check that stops an extension injecting anything at all.
  for (const prop of ['dangerouslySetInnerHTML', 'innerHTML', 'style', 'onClick', 'href', 'src']) {
    assert.throws(
      () => assertTreeValid({ component: 'Text', props: { [prop]: 'x' } }),
      new RegExp(`does not take a "${prop}" prop`),
      `<Text> must refuse ${prop}`,
    );
  }
});

test('a Button cannot carry a URL', () => {
  // A button an extension points anywhere is an open redirect with a
  // merchant's session attached. Extensions raise an action id; the host
  // decides what it means.
  assert.throws(
    () => assertTreeValid({ component: 'Button', props: { label: 'Go', url: 'https://evil.test' } }),
    /does not take a "url" prop/,
  );
  assert.doesNotThrow(() =>
    assertTreeValid({ component: 'Button', props: { label: 'Go', action: 'go' } }),
  );
});

test('a prop cannot carry a nested structure', () => {
  // A prop that can hold an object is a prop that can hold something the host
  // spreads into a real component.
  assert.throws(
    () => assertTreeValid({ component: 'Text', props: { content: { toString: 'x' } } }),
    /must be text, a number or true\/false/,
  );
  assert.throws(
    () => assertTreeValid({ component: 'Text', props: { content: ['a'] } }),
    /must be text, a number or true\/false/,
  );
});

test('enumerated props are checked against their list', () => {
  assert.doesNotThrow(() =>
    assertTreeValid({ component: 'Banner', props: { title: 'Hi', tone: 'warning' } }),
  );
  assert.throws(
    () => assertTreeValid({ component: 'Banner', props: { title: 'Hi', tone: 'evil' } }),
    /must be one of info, success, warning, critical, subdued/,
  );
});

test('depth is bounded, so a recursive generator cannot blow the renderer', () => {
  const nest = (depth) =>
    depth === 0
      ? { component: 'Text', props: { content: 'end' } }
      : { component: 'Stack', children: [nest(depth - 1)] };

  assert.doesNotThrow(() => assertTreeValid(nest(MAX_TREE_DEPTH - 1)));
  assert.throws(() => assertTreeValid(nest(MAX_TREE_DEPTH + 2)), /nests deeper than/);
});

test('node count is bounded, so an extension cannot flood the admin', () => {
  const many = {
    component: 'Stack',
    children: Array.from({ length: MAX_TREE_NODES + 10 }, () => ({
      component: 'Badge',
      props: { content: 'x' },
    })),
  };
  assert.throws(() => assertTreeValid(many), /more than 300 nodes/);
});

test('text length is bounded', () => {
  assert.throws(
    () => assertTreeValid({ component: 'Text', props: { content: 'x'.repeat(5000) } }),
    /is longer than 2000/,
  );
});

test('a node that is not an object is refused', () => {
  for (const bad of ['<script>', 42, null, ['Text'], true]) {
    assert.throws(() => assertTreeValid(bad), /must be an object|needs a component name/);
  }
});

test('the vocabulary contains nothing that renders markup or takes a URL', () => {
  // A guard on the list itself: the next person to add a component should have
  // to change this test, and think about why.
  assert.deepEqual([...EXTENSION_COMPONENTS], [
    'Stack', 'Text', 'Heading', 'Badge', 'Button',
    'Divider', 'Banner', 'List', 'ListItem', 'Field',
  ]);
});

test('actions are collectable, so a host wires only what it declared', () => {
  assert.deepEqual(actionsIn(ok), ['recalculate']);
});
