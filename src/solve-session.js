import { countedMoves, crossSolved, f2lSolved, slots, slotSolved } from './cube.js';

export const crossPieces = [12, 13, 14, 15];
export const pairPieces = slot => [slot + 4, slot + 16];
export const phasePieces = targetSlots => [...crossPieces, ...targetSlots.flatMap(pairPieces)];

export function pieceState(cube, piece) {
  const corner = piece < 8;
  const position = corner ? cube.cp.indexOf(piece) : cube.ep.indexOf(piece - 8);
  return corner ? position * 3 + cube.co[position] : position * 2 + cube.eo[position];
}

export function matchesPieces(cube, target, pieces) {
  return pieces.every(piece => pieceState(cube, piece) === pieceState(target, piece));
}

export function elapsedBetween(first, last) {
  const elapsed = Math.max(0, last.local - first.local);
  if (!Number.isFinite(first.device) || !Number.isFinite(last.device)) return elapsed;
  const hardware = (last.device - first.device) >>> 0;
  return hardware <= elapsed + 5000 ? hardware : elapsed;
}

export class RecordedTurns {
  turns = [];

  constructor(start, readyAt = null) {
    this.start = start.clone();
    this.readyAt = readyAt;
  }

  add({ move, local, device }) {
    this.turns.push({ move, local, device });
  }

  get moves() { return countedMoves(this.turns.map(turn => turn.move)); }
  get first() { return this.turns[0]; }
  timing(from = 0, to = this.turns.length) {
    if (from === to) return { think: 0, execution: 0, total: 0 };
    const first = this.turns[from];
    const previous = this.turns[from - 1] ?? this.readyAt ?? first;
    const think = elapsedBetween(previous, first);
    const execution = elapsedBetween(first, this.turns[to - 1]);
    return { think, execution, total: think + execution };
  }
}

export function splitSolve(log) {
  const moves = log.turns.map(turn => turn.move);
  const cube = log.start.clone();
  let cross = crossSolved(cube);
  let completed = cross ? slots.map((_, index) => index).filter(slot => slotSolved(cube, slot)) : [];
  const alreadySolved = [...completed];
  const steps = [];
  let from = 0;
  let start = log.start;

  function addStep(kind, newSlots, to) {
    const targetSlots = [...newSlots, ...completed];
    const pairNumber = completed.length + 1;
    const title = kind === 'cross' ? 'White cross'
      : newSlots.length === 1 ? `Pair ${pairNumber}` : `Pairs ${pairNumber}–${pairNumber + newSlots.length - 1}`;
    steps.push({ kind, title, slots: newSlots, targetSlots, start, end: cube.clone(), moves: countedMoves(moves.slice(from, to)),
      timing: log.timing(from, to), suffix: countedMoves(moves.slice(from)), already: kind === 'cross' && to === 0 });
    from = to;
    start = cube.clone();
    completed = targetSlots;
  }

  if (cross) addStep('cross', [], 0);
  for (const [index, move] of moves.entries()) {
    cube.move(move);
    if (!crossSolved(cube) || !completed.every(slot => slotSolved(cube, slot))) continue;
    const newSlots = slots.map((_, slot) => slot).filter(slot => !completed.includes(slot) && slotSolved(cube, slot));
    if (!cross || newSlots.length) addStep(cross ? 'pair' : 'cross', newSlots, index + 1);
    cross = true;
  }

  return {
    steps,
    alreadySolved,
    moves: steps.flatMap(step => step.moves),
    total: steps.reduce((total, step) => total + step.timing.total, 0),
  };
}

export function randomScramble() {
  const moves = [];
  while (moves.length < 22) {
    const options = [...'URFDLB'].filter(face => moves.at(-1)?.[0] !== face &&
      !(moves.at(-2)?.[0] === face && Math.abs('URFDLB'.indexOf(face) - 'URFDLB'.indexOf(moves.at(-1)[0])) === 3));
    const face = options[Math.floor(Math.random() * options.length)];
    moves.push(face + ['', '2', "'"][Math.floor(Math.random() * 3)]);
  }
  return moves;
}

export function canStartSolve(cube) {
  return !f2lSolved(cube);
}
