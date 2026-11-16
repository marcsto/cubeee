import { Cube, invert, played, simplify } from './cube.js';

function moves(text) {
  return text ? text.split(' ') : [];
}

let initialized = false;
self.onmessage = ({ data: { id, current, setup, target } }) => {
  try {
    if (!initialized) {
      Cube.initSolver();
      initialized = true;
    }
    const start = Cube.fromString(current);
    if (target) setup = invert(moves(Cube.fromString(target).solve()));
    const toSolved = simplify([...moves(start.solve()), ...setup]);
    // If S creates the target from solved, solving S⁻¹ × current gives the direct route.
    const relative = played(new Cube(), invert(setup)).multiply(start);
    const direct = moves(relative.solve());
    self.postMessage({ id, result: direct.length < toSolved.length ? direct : toSolved });
  } catch {
    self.postMessage({ id, error: 'Could not find a setup from that cube state.' });
  }
};
