import assert from 'node:assert/strict';
import test from 'node:test';
import { invert, played, slotSolved, solved } from '../src/cube.js';
import { FullSolve } from '../src/full-solve.js';
import { PracticeGestures } from '../src/practice-gestures.js';
import { RecordedTurns, splitSolve } from '../src/solve-session.js';
import { Trainer } from '../src/trainer.js';

function pairPractice() {
  const moves = ['R', 'U', "R'"];
  const start = played(solved, invert(moves));
  const original = new RecordedTurns(start);
  moves.forEach((move, i) => original.add({ move, local: i * 100, device: null }));
  const results = [];
  const trainer = new Trainer(transition => { if (transition) full.record(transition); });
  const full = new FullSolve(trainer, () => {}, (...result) => results.push(result));
  full.report = splitSolve(original);
  full.showStep(1);
  const gestures = new PracticeGestures();
  const physical = new Trainer(() => {});
  physical.free();
  physical.cube.move('B D L');
  let local = performance.now();
  const turn = move => {
    const mark = { move, local: local += 300, device: null };
    physical.turn(move, mark.local);
    const handled = gestures.handle(mark, {
      ready: full.phase === 'drill-ready', complete: full.phase === 'drill-result',
      retry: () => full.drill({ virtual: true }),
    });
    if (!handled) trainer.turn(move, mark.local);
  };
  return { full, trainer, physical, results, moves, start, turn };
}

test('virtual practice loads the exact split, records timing, and leaves the source report intact', async () => {
  const { full, trainer, results, moves, start } = pairPractice();
  trainer.cube.move('F D2 B');
  await full.drill({ virtual: true });
  assert.equal(full.phase, 'drill-ready');
  assert.equal(trainer.cube.asString(), start.asString());
  assert.equal(trainer.expected, null);
  assert.notEqual(trainer.cube, full.step.start);
  const ready = full.log.readyAt.local;
  moves.forEach((move, index) => trainer.turn(move, ready + 500 + index * 100));
  assert.equal(full.phase, 'drill-result');
  assert.equal(results.length, 1);
  assert.equal(results[0][0], 'drill');
  const timing = full.log.timing();
  assert.ok(Math.abs(timing.think - 500) < 0.001);
  assert.ok(Math.abs(timing.execution - 200) < 0.001);
  assert.ok(Math.abs(timing.total - 700) < 0.001);
  assert.deepEqual(full.log.moves, moves);
  assert.equal(full.step.start.asString(), start.asString());
});

test('retries reset unfinished and completed attempts without changing the selected split', async () => {
  const { full, trainer, start, moves, results } = pairPractice();
  await full.drill({ virtual: true });
  const selected = full.step;
  trainer.turn('F');
  const abandoned = full.log;
  await full.drill({ virtual: true });
  assert.notEqual(full.log, abandoned);
  assert.deepEqual(full.log.moves, []);
  assert.equal(results.length, 0);
  moves.forEach(move => trainer.turn(move));
  await full.drill({ virtual: true });
  assert.equal(full.step, selected);
  assert.equal(trainer.cube.asString(), start.asString());
  assert.equal(full.phase, 'drill-ready');
  assert.equal(results.length, 1);
});

test('solving the target must also restore earlier pairs and the cross', async () => {
  const { full, trainer, moves, results } = pairPractice();
  await full.drill({ virtual: true });
  trainer.turn('L');
  moves.forEach(move => trainer.turn(move));
  assert.equal(slotSolved(trainer.cube, 0), true);
  assert.equal(slotSolved(trainer.cube, 1), false);
  assert.equal(full.phase, 'drilling');
  assert.equal(results.length, 0);
  [...invert(moves), "L'", ...moves].forEach(move => trainer.turn(move));
  assert.equal(full.phase, 'drill-result');
});

test('Bluetooth next gestures are ignored on pair results while the physical cube keeps tracking', async () => {
  const { full, trainer, physical, moves, start, turn, results } = pairPractice();
  const physicalStart = physical.cube.clone();
  await full.drill({ virtual: true });
  moves.forEach(turn);
  const result = trainer.cube.asString();
  ['L', 'R', "L'", 'R2'].forEach(turn);
  assert.equal(full.phase, 'drill-result');
  assert.equal(trainer.cube.asString(), result);
  assert.deepEqual(full.log.moves, moves);
  turn('U');
  assert.equal(full.phase, 'drill-ready');
  assert.equal(trainer.cube.asString(), start.asString());
  assert.deepEqual(full.log.moves, []);
  assert.equal(results.length, 1);
  assert.equal(physical.cube.asString(), played(physicalStart, [...moves, 'L', 'R', "L'", 'R2', 'U']).asString());
  moves.forEach(turn);
  assert.equal(results.length, 2);
});

test('shortcut half turns do not leak into the new attempt; later top turns do', () => {
  for (const move of ['U', "U'"]) {
    const gestures = new PracticeGestures();
    let retries = 0;
    const state = { complete: true, ready: false, retry: () => retries++ };
    assert.equal(gestures.handle({ move, local: 1000, device: 1000 }, state), true);
    Object.assign(state, { complete: false, ready: true });
    assert.equal(gestures.handle({ move, local: 1050, device: 1050 }, state), true);
    assert.equal(gestures.handle({ move, local: 1400, device: 1400 }, state), false);
    assert.equal(retries, 1);
  }
});

test('normal virtual practice still advances with either side face and retries with U2', () => {
  for (const move of ['L', "R'", 'U2']) {
    const gestures = new PracticeGestures();
    let action;
    const state = { complete: true, ready: false, retry: () => { action = 'retry'; }, next: () => { action = 'next'; } };
    assert.equal(gestures.handle({ move, local: 1000 }, state), true);
    assert.equal(action, move === 'U2' ? 'retry' : 'next');
    Object.assign(state, { complete: false, ready: true });
    assert.equal(gestures.handle({ move, local: 1050 }, state), move !== 'U2');
    gestures.reset();
    assert.equal(gestures.handle({ move, local: 1100 }, state), false);
  }
});

test('guided practice still accepts a physical cube already at the selected setup', async () => {
  const { full, trainer, start } = pairPractice();
  trainer.cube = start.clone();
  await full.drill();
  assert.equal(full.phase, 'drill-ready');
  assert.equal(trainer.cube.asString(), start.asString());
  full.interrupt('Connection lost');
  assert.equal(full.phase, 'review');
  assert.equal(full.error, 'Connection lost');
  assert.equal(full.log, null);
});
