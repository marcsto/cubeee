import { faces, played, solved } from './cube.js';

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

export function gripMove(move, grip) {
  return grip.display[move[0]] + move.slice(1);
}
