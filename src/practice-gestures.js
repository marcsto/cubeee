import { turnFace } from './cube.js';
import { elapsedBetween } from './solve-session.js';

const halfTurnWindow = 200;

export class PracticeGestures {
  reset() { this.previous = undefined; }

  handle(turn, { ready, complete, retry, next }) {
    const previous = this.previous;
    this.reset();
    const face = turnFace(turn.move);
    if (!['U', 'L', 'R'].includes(face)) return false;

    // The GAN can report a shortcut's half turn as two quarter turns.
    if (ready && previous?.move === turn.move && elapsedBetween(previous, turn) <= halfTurnWindow) return true;
    if (!complete) return false;

    if (face === 'U') retry();
    else if (next) next();
    else return true;
    if (turn.move[1] !== '2') this.previous = turn;
    return true;
  }
}
