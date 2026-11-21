import assert from 'node:assert/strict';
import test from 'node:test';
import { played, restoredPair, slotSolved, solved } from '../src/cube.js';
import { canonicalCube } from '../src/grip.js';
import { PracticeOrder } from '../src/practice-order.js';
import { cases, practicePosition, Trainer } from '../src/trainer.js';

test('position variants preserve every catalog solution and its preference index', () => {
  for (const item of cases) {
    for (let slot = 0; slot < 4; slot++) {
      for (let top = 0; top < 4; top++) {
        const variant = practicePosition(item, slot, top);
        assert.deepEqual(variant.start.center, solved.center);
        assert.equal(slotSolved(variant.start, slot), false);
        assert.equal(variant.preserve.length, item.preserve.length);
        assert.equal(variant.solutions.length, item.solutions.length);
        variant.solutions.forEach((moves, index) => {
          const end = canonicalCube(played(variant.start, moves));
          assert.ok(restoredPair(end, variant.preserve, slot), `Case ${item.id}, slot ${slot}, top ${top}`);
          assert.equal(variant.cubeSkills.has(moves.join(' ')), item.cubeSkills.has(item.solutions[index].join(' ')));
        });
      }
    }
  }
});

test('a new draw varies a single-case group, and navigating back restores its position', () => {
  for (const item of [cases[0], cases.at(-1)]) {
    const order = new PracticeOrder();
    order.review([item], item);
    const first = order.next(item);
    const second = order.next(first);
    assert.notEqual(first.pattern, second.pattern);
    assert.equal(order.previous(second), first);
    assert.equal(order.next(first), second);
  }
});

test('guided and virtual retries can restore every sticker of a nonstandard start', async () => {
  const item = practicePosition(cases[0], 2, 1);
  // A physical cube can match the case while having different last-layer stickers.
  const original = played(played(solved, ['U']), item.setup);
  const trainer = new Trainer(() => {}, () => {});
  trainer.cube = original.clone();
  await trainer.select(item);
  assert.equal(trainer.phase, 'ready');
  const exactStart = trainer.caseStart;
  for (const move of item.solutions[0]) trainer.turn(move);
  assert.equal(trainer.phase, 'results');
  await trainer.select(item, { exactStart });
  while (trainer.expected) trainer.turn(trainer.expected);
  assert.equal(trainer.phase, 'ready');
  assert.equal(trainer.cube.asString(), original.asString());
  trainer.turn('L');
  await trainer.select(item, { virtual: true, exactStart });
  assert.equal(trainer.cube.asString(), original.asString());
});
