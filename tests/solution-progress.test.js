import assert from 'node:assert/strict';
import test from 'node:test';
import { played, solved } from '../src/cube.js';
import { canonicalCube } from '../src/grip.js';
import { matchedSolutionMoves, recordedFaceTurns, solutionFaceTurns } from '../src/solution-progress.js';

test('each alternative advances only through its matching prefix', () => {
  const turns = ['R', 'U', 'F'];
  assert.equal(matchedSolutionMoves(['R', 'U', "R'"], turns), 2);
  assert.equal(matchedSolutionMoves(['R', "U'", "R'"], turns), 1);
  assert.equal(matchedSolutionMoves(['F', 'R'], turns), 0);
  assert.equal(matchedSolutionMoves(['R'], []), 0);
});

test('half turns accept a single input or two quarters in either direction', () => {
  for (const turns of [['U2'], ['U', 'U'], ["U'", "U'"]]) {
    assert.equal(matchedSolutionMoves(['U2', 'R'], turns), 1);
  }
  assert.equal(matchedSolutionMoves(['U2'], ['U']), 0);
});

test('undoing a wrong turn lets a solution continue', () => {
  const turns = ['R', 'F', "F'", 'U'].map(move => ({ move }));
  assert.equal(matchedSolutionMoves(['R', 'U'], recordedFaceTurns(turns)), 2);
});

test('rotations and wide moves agree with physical face turns at each step', () => {
  const moves = "y R x' b2 u F' d2 r l' z f B2".split(' ');
  const physical = solutionFaceTurns(moves);
  for (let end = 1; end <= moves.length; end++) {
    assert.equal(played(solved, physical.slice(0, end).filter(Boolean)).asString(),
      canonicalCube(played(solved, moves.slice(0, end))).asString());
  }
  assert.equal(matchedSolutionMoves(physical, []), 0);
  assert.equal(matchedSolutionMoves(physical, [physical[1]]), 2);
  assert.equal(matchedSolutionMoves(physical, physical.filter(Boolean)), moves.length);
});
