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

function alignMoves(turn, moves) {
  if (!turn) return moves;
  return moves[0][0] === 'U' ? [...simplify([turn, moves[0]]), ...moves.slice(1)] : [turn, ...moves];
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
      const moves = alignMoves(turn, source).map(move => gripMove(move, inverse));
      if (matchesPieces(canonicalCube(played(start, moves)), end, pieces)) {
        used.add(source);
        options.push(moves);
      }
    }
  }
  return options;
}
