import { crossSolved, f2lSolved, invert, played, simplify, slotSolved, slots, solved } from './cube.js';
import { planPair, planRoute } from './planner.js';
import { canStartSolve, matchesPieces, phasePieces, randomScramble, RecordedTurns, splitSolve } from './solve-session.js';

export class FullSolve {
  phase = 'idle';
  completed = 0;
  generation = 0;
  report = null;
  selected = -1;
  targetSlot = null;
  crossReached = false;

  constructor(trainer, change, finished) {
    this.trainer = trainer;
    this.change = change;
    this.finished = finished;
  }

  get step() { return this.report?.steps[this.selected]; }

  interrupt(message = '') {
    const active = this.phase !== 'idle' && this.phase !== 'review';
    ++this.generation;
    this.trainer.free();
    if (active) {
      this.phase = this.report ? 'review' : 'idle';
      this.error = message;
    }
    this.log = null;
    this.change();
  }

  startCurrent() {
    if (!canStartSolve(this.trainer.cube)) {
      this.error = 'The first two layers are already solved. Scramble the cube to start.';
      this.change();
      return;
    }
    ++this.generation;
    this.trainer.free();
    this.arm('ready');
    this.change();
  }

  arm(phase, mark = null) {
    this.log = new RecordedTurns(this.trainer.cube, mark);
    this.error = '';
    this.phase = phase;
    if (phase === 'ready') {
      this.targetSlot = null;
      this.crossReached = crossSolved(this.trainer.cube);
    }
  }

  async scramble() {
    const generation = ++this.generation;
    this.trainer.free();
    const snapshot = this.trainer.cube.clone();
    let setup, target;
    do {
      setup = randomScramble();
      target = played(solved, setup);
    } while (crossSolved(target) || slots.some((_, slot) => slotSolved(target, slot)));
    this.phase = 'planning-scramble';
    this.error = '';
    this.change();
    let route = setup;
    if (!snapshot.isSolved()) route = await planRoute(snapshot, { setup }).catch(() => undefined);
    if (generation !== this.generation) return;
    if (snapshot.asString() !== this.trainer.cube.asString() || !route ||
        played(snapshot, route).asString() !== target.asString()) {
      this.interrupt('Could not prepare this scramble. Keep the cube still and try again.');
      return;
    }
    this.phase = 'scrambling';
    this.trainer.guide(route, cube => cube.asString() === target.asString(), () => this.arm('ready'));
  }

  record(transition) {
    if (transition.guided) return;
    const cube = this.trainer.cube;
    if (this.phase === 'ready' || this.phase === 'solving') {
      this.log.add(transition);
      this.phase = 'solving';
      if (crossSolved(cube)) {
        this.crossReached = true;
        if (this.targetSlot !== null && slotSolved(cube, this.targetSlot)) this.targetSlot = null;
      }
      if (f2lSolved(cube)) this.finish();
    } else if (this.phase === 'drill-ready' || this.phase === 'drilling') {
      this.log.add(transition);
      this.phase = 'drilling';
      if (matchesPieces(cube, this.step.end, phasePieces(this.step.targetSlots))) {
        this.phase = 'drill-result';
        this.lastDrill = { step: this.step, end: cube.asString(), moves: this.log.moves };
        this.finished('drill', this.log, this.step);
      }
    }
  }

  finish() {
    const report = splitSolve(this.log);
    this.completed++;
    this.finished('full', this.log, report);
    this.review(report);
  }

  review(report) {
    this.report = report;
    this.selected = -1;
    this.phase = 'review';
    this.error = '';
    this.lastDrill = null;
    for (const step of report.steps) {
      if (!step.slots.length) continue;
      step.analysis = null;
      planPair(step.start, step.end, step.targetSlots, step.moves).catch(() => undefined).then(result => {
        step.analysis = result ?? { solutions: [], optimal: false };
        if (this.report === report && (this.phase === 'review' || this.step === step)) this.change();
      });
    }
    this.change();
  }

  clearReport() {
    this.report = null;
    this.lastDrill = null;
    this.selected = -1;
    if (this.phase.includes('drill') || this.phase === 'review') {
      this.phase = 'idle';
      this.interrupt();
    }
  }

  showStep(index) {
    if (!this.report?.steps[index]?.slots.length) return;
    this.selected = index;
    this.change();
  }

  backToReview() {
    this.interrupt();
    this.phase = 'review';
    this.error = '';
    this.change();
  }

  async drill() {
    const step = this.step;
    if (!step) return;
    const generation = ++this.generation;
    this.trainer.free();
    const snapshot = this.trainer.cube.clone();
    const pieces = phasePieces(step.targetSlots);
    const reached = cube => matchesPieces(cube, step.start, pieces);
    this.phase = 'planning-drill';
    this.error = '';
    this.change();
    let route = [];
    if (!reached(snapshot)) {
      let fallback;
      if (this.lastDrill?.step === step && this.lastDrill.end === snapshot.asString()) fallback = simplify(invert(this.lastDrill.moves));
      else if (f2lSolved(snapshot)) fallback = simplify(invert(step.suffix));
      else if (step.end.asString() === snapshot.asString()) fallback = simplify(invert(step.moves));
      const analysis = await planPair(snapshot, step.start, step.targetSlots, fallback, 1).catch(() => undefined);
      route = analysis?.solutions[0] ?? fallback;
      if (generation !== this.generation) return;
      if (!route || !reached(played(snapshot, route))) route = await planRoute(snapshot, { target: step.start }).catch(() => undefined);
    }
    if (generation !== this.generation) return;
    if (!route || snapshot.asString() !== this.trainer.cube.asString() || !reached(played(snapshot, route))) {
      this.interrupt('Could not prepare this pair. Keep the cube still and try again.');
      return;
    }
    this.phase = 'drill-setup';
    this.trainer.guide(route, reached, mark => this.arm('drill-ready', mark));
  }
}
