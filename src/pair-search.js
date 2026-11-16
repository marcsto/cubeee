import { faces, played, solved } from './cube.js';
import { crossPieces, pairPieces, phasePieces, pieceState, matchesPieces } from './solve-session.js';

const moves = [...faces].flatMap(face => [face, face + "'", face + '2']);
const statesPerPiece = 24;
const patternSize = statesPerPiece ** 4;
const databases = new Map();

// A cubie's move depends only on its type, position and orientation.
function transitionTable(corner) {
  const orientations = corner ? 3 : 2;
  return moves.flatMap(move => {
    const effect = played(solved, [move]);
    const permutation = corner ? effect.cp : effect.ep;
    const orientation = corner ? effect.co : effect.eo;
    return Array.from({ length: statesPerPiece }, (_, state) => {
      const position = permutation.indexOf(Math.floor(state / orientations));
      return position * orientations + (state % orientations + orientation[position]) % orientations;
    });
  });
}

const cornerTransitions = new Uint8Array(transitionTable(true));
const edgeTransitions = new Uint8Array(transitionTable(false));
const tableFor = piece => piece < 8 ? cornerTransitions : edgeTransitions;
const encode = (a, b, c, d) => ((a * 24 + b) * 24 + c) * 24 + d;

function distances(pieces, goal) {
  const key = pieces.map((piece, i) => `${piece < 8 ? 'c' : 'e'}${goal[i]}`).join('/');
  const cached = databases.get(key);
  if (cached) {
    databases.delete(key);
    databases.set(key, cached);
    return cached;
  }

  const [tableA, tableB, tableC, tableD] = pieces.map(tableFor);
  const db = new Uint8Array(patternSize).fill(255);
  const queue = new Uint32Array(patternSize);
  const first = encode(...goal);
  let count = 1;
  queue[0] = first;
  db[first] = 0;
  for (let index = 0; index < count; index++) {
    const state = queue[index];
    const d = state % 24;
    const c = Math.floor(state / 24) % 24;
    const b = Math.floor(state / 576) % 24;
    const a = Math.floor(state / 13824);
    const distance = db[state] + 1;
    for (let offset = 0; offset < moves.length * 24; offset += 24) {
      const next = encode(tableA[offset + a], tableB[offset + b], tableC[offset + c], tableD[offset + d]);
      if (db[next] !== 255) continue;
      db[next] = distance;
      queue[count++] = next;
    }
  }
  if (databases.size >= 28) databases.delete(databases.keys().next().value);
  databases.set(key, db);
  return db;
}

function patterns(slots) {
  const groups = [crossPieces];
  const pairs = slots.map(pairPieces);
  for (const [index, pair] of pairs.entries()) {
    groups.push([...pair, crossPieces[0], crossPieces[2]], [...pair, crossPieces[1], crossPieces[3]]);
    for (const other of pairs.slice(index + 1)) groups.push([...pair, ...other]);
  }
  return groups;
}

/**
 * Search in half-turn metric. Each pattern gives a lower bound for a
 * subset of the requested pieces, so their maximum is admissible.
 */
export function searchPair(start, target, slots, { fallback, limit = 3, budget = 1400 } = {}) {
  const pieces = phasePieces(slots);
  const known = fallback && matchesPieces(played(start, fallback), target, pieces) ? fallback : null;
  if (matchesPieces(start, target, pieces)) return { solutions: [[]], optimal: true };
  const checks = patterns(slots).map(group => ({
    indexes: group.map(piece => pieces.indexOf(piece)),
    table: distances(group, group.map(piece => pieceState(target, piece))),
  }));
  const tables = pieces.map(tableFor);
  const layers = Array.from({ length: 16 }, () => new Uint8Array(pieces.length));
  layers[0].set(pieces.map(piece => pieceState(start, piece)));
  const paths = [];
  const path = [];
  const expires = performance.now() + budget;
  let nodes = 0;
  let expired = false;

  function lowerBound(state, max = Infinity) {
    let distance = 0;
    for (const { indexes: [a, b, c, d], table } of checks) {
      distance = Math.max(distance, table[encode(state[a], state[b], state[c], state[d])]);
      if (distance > max) break;
    }
    return distance;
  }

  function visit(depth, remaining, previousFace) {
    if ((++nodes & 2047) === 0 && performance.now() > expires) {
      expired = true;
      return true;
    }
    const state = layers[depth];
    const estimate = lowerBound(state, remaining);
    if (estimate > remaining) return false;
    if (!estimate) {
      if (!remaining) paths.push(path.slice(0, depth));
      return paths.length >= limit;
    }

    const next = layers[depth + 1];
    for (let index = 0; index < moves.length; index++) {
      const face = Math.floor(index / 3);
      // Opposite faces commute. Keeping one order avoids equivalent algorithms.
      if (face === previousFace || previousFace - face === 3) continue;
      const offset = index * 24;
      for (let p = 0; p < pieces.length; p++) next[p] = tables[p][offset + state[p]];
      path[depth] = moves[index];
      if (visit(depth + 1, remaining - 1, face)) return true;
    }
    return false;
  }

  const maxDepth = Math.min(14, known ? known.length + (limit > 1 ? 3 : 0) : 14);
  for (let depth = lowerBound(layers[0]); depth <= maxDepth; depth++) {
    if (visit(0, depth, -1) || (paths.length && depth >= paths[0].length + 3)) break;
  }

  const optimal = paths.length > 0;
  if (known && paths.length < limit && !paths.some(path => path.join(' ') === known.join(' '))) paths.push(known);
  paths.sort((a, b) => a.length - b.length);
  return { solutions: paths, optimal: optimal || Boolean(known && !expired && known.length <= maxDepth) };
}
