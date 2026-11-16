import guide from './cubeskills.json' with { type: 'json' };
import { Cube, faces, invert, played, simplify, solved } from './cube.js';
import { canonicalCube, cubeGrip, getGrip, gripMove } from './grip.js';
import { matchesPieces, pairPieces, phasePieces, pieceState } from './solve-session.js';

export const cubeSkillsGuide = 'https://www.cubeskills.com/uploads/pdf/tutorials/f2l.pdf';
const pairPattern = cube => pairPieces(0).map(piece => pieceState(cube, piece)).join(',');
const alignments = ['', 'U', 'U2', "U'"];
const slotGrips = ['UF', 'UL', 'UB', 'UR'].map(getGrip);

const byPattern = new Map();
for (const text of guide) {
  const moves = text.split(' ');
  const { rotation } = cubeGrip(played(solved, moves));
  const start = played(solved, [...rotation, ...invert(moves)]);
  const pattern = pairPattern(start);
  if (!byPattern.has(pattern)) byPattern.set(pattern, []);
  byPattern.get(pattern).push(moves);
}

export function simplifyOpeningUTurns(moves) {
  const firstOtherTurn = moves.findIndex(move => move[0] !== 'U' && move[0] !== 'y');
  const boundary = firstOtherTurn === -1 ? moves.length : firstOtherTurn;
  const opening = moves.slice(0, boundary);
  const topTurns = opening.filter(move => move[0] === 'U');
  if (topTurns.length < 2) return moves;
  // A y rotation leaves the U face facing up, so opening U turns can combine across it.
  const rotations = opening.filter(move => move[0] === 'y');
  return [...rotations, ...simplify(topTurns), ...moves.slice(boundary)];
}

export function cubeSkillsSolutions(start, end, slot, targetSlots) {
  const grip = slotGrips[slot];
  const inverse = getGrip(grip.display.U + grip.display.F);
  // Move the target slot to front-right and name the pieces by their new centers.
  const stickers = played(start, grip.rotation).asString();
  const aligned = Cube.fromString([...stickers].map(face => grip.display[face]).join(''));
  const pieces = phasePieces(targetSlots);
  const used = new Set();
  const options = [];
  for (const turn of alignments) {
    const pattern = pairPattern(turn ? played(aligned, [turn]) : aligned);
    for (const source of byPattern.get(pattern) ?? []) {
      if (used.has(source)) continue;
      const alignedMoves = turn ? simplifyOpeningUTurns([turn, ...source]) : source;
      const moves = alignedMoves.map(move => gripMove(move, inverse));
      if (matchesPieces(canonicalCube(played(start, moves)), end, pieces)) {
        used.add(source);
        options.push(moves);
      }
    }
  }
  return options;
}
