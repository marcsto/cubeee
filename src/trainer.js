import catalogue from './cases.json' with { type: 'json' };
import { Cube, f2lPattern, f2lSolved, invert, played, restoredPair, simplify, slotSolved, solved, turnPower } from './cube.js';
import { cubeSkillsSolutions } from './cubeskills.js';
import { planRoute } from './planner.js';
import { RecordedTurns } from './solve-session.js';

export const cases = catalogue.map(item => {
  const setup = item.setup.split(' ');
  const start = played(new Cube(), setup);
  const preserve = [1, 2, 3].filter(slot => slotSolved(start, slot));
  const guide = new Set(cubeSkillsSolutions(start, solved, 0, [0, ...preserve]).map(moves => moves.join(' ')));
  const solutions = [...new Set([...item.solutions, ...guide])].map(text => text.split(' '));
  return { ...item, setup, start, pattern: f2lPattern(start), preserve, solutions, cubeSkills: guide };
});

export class Trainer {
  cube = new Cube();
  journal = [];
  item = cases[0];
  generation = 0;
  route = [];
  mistakes = [];
  progress = 0;
  partial = 0;
  phase = 'setup';

  constructor(onUpdate, onResult) {
    this.onUpdate = onUpdate;
    this.onResult = onResult;
  }

  get expected() {
    if (this.phase !== 'setup') return null;
    if (this.mistakes.length) return invert(this.mistakes).at(0);
    const next = this.route[this.progress];
    if (this.partial) return next[0] + (this.partial === 1 ? '' : "'");
    return next;
  }

  get turns() { return this.solveLog?.moves ?? []; }

  free() {
    ++this.generation;
    this.phase = 'free';
    this.guided = undefined;
  }

  guide(route, reached, complete) {
    this.free();
    this.route = route;
    this.progress = 0;
    this.partial = 0;
    this.mistakes = [];
    this.guided = { reached, complete };
    this.phase = 'setup';
    if (reached(this.cube)) this.finishSetup({ local: performance.now(), device: null });
    this.onUpdate();
  }

  async select(item, { virtual = false } = {}) {
    const generation = ++this.generation;
    this.item = item;
    this.phase = 'planning';
    this.guided = undefined;
    this.route = [];
    this.progress = 0;
    this.mistakes = [];
    this.partial = 0;
    this.readyAt = undefined;
    this.first = undefined;
    this.solveLog = undefined;
    this.result = undefined;
    this.caseStart = undefined;
    if (virtual) this.cube = item.start.clone();
    if (virtual || f2lPattern(this.cube) === item.pattern) {
      this.arm({ local: performance.now(), device: null });
      this.onUpdate();
      return;
    }

    if (f2lSolved(this.cube)) this.journal = [];
    let route = this.journal && simplify([...invert(this.journal), ...item.setup]);
    if (!route || route.length > item.setup.length + 12) {
      const current = this.cube.asString();
      this.onUpdate();
      let planned;
      try {
        planned = await planRoute(this.cube, { setup: item.setup });
      } catch {
        // The recorded route remains available when a worker cannot start.
      }
      if (generation !== this.generation || current !== this.cube.asString()) return;
      if (planned && (!route || planned.length < route.length)) route = planned;
    }
    if (!route || f2lPattern(played(this.cube, route)) !== item.pattern) {
      this.phase = 'error';
    } else {
      let target = this.cube;
      const firstMatch = route.findIndex(move => {
        target = played(target, [move]);
        return f2lPattern(target) === item.pattern;
      });
      this.route = route.slice(0, firstMatch + 1);
      this.phase = 'setup';
    }
    this.onUpdate();
  }

  sync(cube, force = false, free = false) {
    if (!force && this.cube.asString() === cube.asString()) return;
    this.cube = cube;
    this.journal = f2lSolved(cube) ? [] : null;
    if (free) {
      this.free();
      this.onUpdate();
    } else this.select(this.item);
  }

  finishSetup(mark) {
    if (!this.guided) {
      this.arm(mark);
      return;
    }
    const { complete } = this.guided;
    this.free();
    complete(mark);
  }

  arm(mark) {
    this.phase = 'ready';
    this.caseStart = this.cube.clone();
    this.journal = [...this.item.setup];
    this.readyAt = mark.local;
    this.solveLog = new RecordedTurns(this.cube, mark);
    this.progress = this.route.length;
    this.mistakes = [];
    this.partial = 0;
  }

  turn(move, local = performance.now(), device = null) {
    const before = this.cube.clone();
    const guided = this.phase === 'setup';
    this.cube.move(move);
    if (this.journal) this.journal = simplify([...this.journal, move]);
    if (f2lSolved(this.cube)) this.journal = [];

    if (this.phase === 'planning' || this.phase === 'error') {
      this.select(this.item);
    } else if (this.phase === 'setup') {
      this.trackSetup(move, before, { local, device });
    } else if (this.phase === 'ready' || this.phase === 'solving') {
      this.trackSolve(move, local, device);
    }
    this.onUpdate({ before, move, local, device, guided });
  }

  trackSetup(move, before, mark) {
    const reached = this.guided ? this.guided.reached(this.cube) : f2lPattern(this.cube) === this.item.pattern;
    if (reached) {
      this.finishSetup(mark);
      return;
    }
    if (this.mistakes.length) {
      this.mistakes = this.checkpoint === this.cube.asString() ? [] : simplify([...this.mistakes, move]);
      return;
    }
    const target = this.route[this.progress];
    if (target[1] === '2' && target[0] === move[0]) {
      this.partial = (this.partial + turnPower(move)) % 4;
      if (this.partial === 2) {
        this.progress++;
        this.partial = 0;
      }
    } else if (move === target) {
      this.progress++;
    } else {
      this.checkpoint = before.asString();
      this.mistakes = [move];
    }
  }

  trackSolve(move, local, device) {
    this.solveLog.add({ move, local, device });
    if (this.phase === 'ready') {
      this.first = this.solveLog.first;
      this.phase = 'solving';
    }
    if (!restoredPair(this.cube, this.item.preserve)) return;
    const { think, execution } = this.solveLog.timing();
    const sequence = this.solveLog.moves;
    this.result = {
      id: this.item.id,
      time: Date.now(),
      think,
      execution,
      moves: sequence.length,
      sequence,
    };
    this.phase = 'results';
    this.onResult(this.result);
  }
}
