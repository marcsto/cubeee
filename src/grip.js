import { faces, invert, isCubeRotation, played, solved, turnFace } from './cube.js';

const faceRotations = { R: 'x', L: 'x', U: 'y', D: 'y', F: 'z', B: 'z' };

const grips = new Map();
const queue = [{ cube: solved, rotation: [] }];
for (const { cube, rotation } of queue) {
  const colors = cube.center.map(center => faces[center]);
  const top = colors[0];
  const front = colors[2];
  const id = top + front;
  if (grips.has(id)) continue;
  const display = Object.fromEntries(colors.map((color, index) => [color, faces[index]]));
  grips.set(id, { id, top, front, colors, display, rotation });
  for (const turn of ['x', 'y']) queue.push({ cube: played(cube, [turn]), rotation: [...rotation, turn] });
}

export function getGrip(id) {
  return grips.get(id) ?? grips.get('UF');
}

export function frontColors(top) {
  return [...'FRBLUD'].filter(front => grips.has(top + front));
}

export function cubeGrip(cube) {
  return getGrip(faces[cube.center[0]] + faces[cube.center[2]]);
}

export function canonicalCube(cube) {
  const { rotation } = cubeGrip(cube);
  return rotation.length ? played(cube, invert(rotation)) : cube;
}

export function gripMove(move, grip) {
  const [turn, modifier] = move;
  const face = grip.display[turnFace(move)];
  if (isCubeRotation(move)) {
    const reverse = 'LDB'.includes(face) && modifier !== '2';
    return faceRotations[face] + (reverse ? (modifier ? '' : "'") : modifier ?? '');
  }
  return (turn === turn.toUpperCase() ? face : face.toLowerCase()) + (modifier ?? '');
}
