import { Cube } from './cube.js';
import { searchPair } from './pair-search.js';

self.onmessage = ({ data: { id, start, target, slots, fallback, limit } }) => {
  try {
    const result = searchPair(Cube.fromString(start), Cube.fromString(target), slots, { fallback, limit });
    self.postMessage({ id, result });
  } catch {
    self.postMessage({ id });
  }
};
