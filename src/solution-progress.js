import { faces, isCubeRotation, solved, turnPower } from './cube.js';

// GAN and keyboard turns use fixed centers. A wide turn moves the opposite
// outer face in that frame and changes the grip for all subsequent notation.
export function solutionFaceTurns(moves) {
  const frame = solved.clone();
  return moves.map(move => {
    if (isCubeRotation(move)) {
      frame.move(move);
      return '';
    }
    const face = faces.indexOf(move[0].toUpperCase());
    const wide = move[0] !== faces[face];
    const physical = faces[frame.center[wide ? (face + 3) % 6 : face]] + move.slice(1);
    if (wide) frame.move(move);
    return physical;
  });
}

export function matchedSolutionMoves(expected, turns) {
  let cursor = 0;
  let matched = 0;
  for (const [index, move] of expected.entries()) {
    // A regrip is inferred only once a turn in the new grip agrees.
    if (!move) continue;
    const turn = turns[cursor++];
    if (turn !== move) {
      if (!move.endsWith('2') || turn?.[0] !== move[0] || turn !== turns[cursor++]) break;
    }
    matched = index + 1;
  }
  return matched;
}

export function recordedFaceTurns(turns) {
  const result = [];
  for (const { move } of turns) {
    const previous = result.at(-1);
    if (previous?.[0] === move[0] && (turnPower(previous) + turnPower(move)) % 4 === 0) result.pop();
    else result.push(move);
  }
  return result;
}
