import Cube from 'cubejs';

export { Cube };
export const faces = 'URFDLB';
export const solved = new Cube();
export const slots = ['Front-right', 'Front-left', 'Back-left', 'Back-right'];
export const slotFaces = ['FR', 'FL', 'BL', 'BR'];
const rotationFaces = { x: 'R', y: 'U', z: 'F' };

export const turnFace = move => rotationFaces[move?.[0]] ?? move?.[0]?.toUpperCase();
export const isCubeRotation = move => Boolean(rotationFaces[move?.[0]]);
export const algorithmMoveCount = moves => moves.filter(move => !isCubeRotation(move)).length;

export function invert(moves) {
  return moves.length ? Cube.inverse(moves.join(' ')).split(' ') : [];
}

export function played(cube, moves) {
  return moves.length ? cube.clone().move(moves.join(' ')) : cube.clone();
}

export function simplify(moves) {
  const stack = [];
  for (const move of moves) {
    const last = stack.at(-1);
    if (last?.[0] !== move[0]) {
      stack.push(move);
      continue;
    }
    stack.pop();
    const power = (turnPower(move) + turnPower(last)) % 4;
    if (power) stack.push(move[0] + ['', '', '2', "'"][power]);
  }
  return stack;
}

export function turnPower(move) {
  return move[1] === '2' ? 2 : move[1] === "'" ? 3 : 1;
}

export function countedMoves(moves) {
  const result = [];
  for (const move of moves) {
    if (result.at(-1) === move && move[1] !== '2') result[result.length - 1] = move[0] + '2';
    else result.push(move);
  }
  return result;
}

export function crossSolved(cube) {
  return [4, 5, 6, 7].every(i => cube.ep[i] === i && cube.eo[i] === 0);
}

export function slotSolved(cube, slot) {
  const corner = slot + 4;
  const edge = slot + 8;
  return cube.cp[corner] === corner && cube.co[corner] === 0 && cube.ep[edge] === edge && cube.eo[edge] === 0;
}

export function f2lSolved(cube) {
  return crossSolved(cube) && slots.every((_, i) => slotSolved(cube, i));
}

// Encode pieces belonging to the first two layers and leave last-layer stickers free.
export function f2lPattern(cube) {
  let signature = '';
  for (const piece of [4, 5, 6, 7]) {
    const position = cube.cp.indexOf(piece);
    signature += String.fromCharCode(65 + 3 * position + cube.co[position]);
  }
  for (const piece of [4, 5, 6, 7, 8, 9, 10, 11]) {
    const position = cube.ep.indexOf(piece);
    signature += String.fromCharCode(65 + 2 * position + cube.eo[position]);
  }
  return signature;
}

export function restoredPair(cube, preserve, slot = 0) {
  return crossSolved(cube) && slotSolved(cube, slot) && preserve.every(other => slotSolved(cube, other));
}

export function validFacelets(facelets) {
  if (!/^[URFDLB]{54}$/.test(facelets) || [...faces].some(face => facelets.split(face).length !== 10)) return false;
  const cube = Cube.fromString(facelets);
  const permutationIsValid = list => list.every((piece, i) => Number.isInteger(piece) && piece >= 0 && piece < list.length && list.indexOf(piece) === i);
  const parity = list => list.reduce((sum, piece, index) => sum + list.slice(index + 1).filter(other => other < piece).length, 0) % 2;
  return cube.asString() === facelets && cube.center.every((center, i) => center === i)
    && permutationIsValid(cube.cp) && permutationIsValid(cube.ep)
    && cube.co.reduce((a, b) => a + b, 0) % 3 === 0 && cube.eo.reduce((a, b) => a + b, 0) % 2 === 0
    && parity(cube.cp) === parity(cube.ep);
}

// The GAN wire frame uses white up, red right, green front. Rotate around F.
const whiteDown = { U: 'D', R: 'L', F: 'F', D: 'U', L: 'R', B: 'B' };

export function ganMove(move) {
  return whiteDown[move[0]] + move.slice(1);
}

export function ganState(facelets) {
  const rotated = Cube.fromString(facelets).move('z2').asString();
  return Cube.fromString([...rotated].map(face => whiteDown[face]).join(''));
}

export function ganOrientation({ x, y, z, w } = {}) {
  const norm = Math.hypot(x, y, z, w);
  if (!Number.isFinite(norm) || !norm) return;
  // The gyro's red, blue, and white axes are −X, −Z, and −Y in the trainer.
  return [-x / norm, -z / norm, -y / norm, w / norm];
}
