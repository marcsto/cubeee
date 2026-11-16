import Cube from 'cubejs';

export const recentLimit = 250;
const guestAttempts = 'cubeee:guest:attempts';
const guestPreferences = 'cubeee:guest:preferences';

function read(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function savedAttempt(kind, { think, execution, total = think + execution }, sequence, details) {
  return {
    id: crypto.randomUUID(), version: 1, kind, time: Date.now(),
    think, execution, total, moves: sequence.length, sequence, ...details,
  };
}

export function savedReport(report) {
  return {
    alreadySolved: report.alreadySolved,
    steps: report.steps.map(({ analysis, start, end, ...step }) => ({
      ...step, start: start.asString(), end: end.asString(),
    })),
  };
}

export function restoreReport(attempt) {
  const validMoves = moves => Array.isArray(moves) && moves.every(move => typeof move === 'string' && /^[URFDLB][2']?$/.test(move));
  const validSlots = slots => Array.isArray(slots) && slots.every(slot => Number.isInteger(slot) && slot >= 0 && slot < 4);
  const validFacelets = value => typeof value === 'string' && /^[URFDLB]{54}$/.test(value);
  const validTiming = timing => [timing?.think, timing?.execution, timing?.total].every(value => Number.isFinite(value) && value >= 0);
  if (!validSlots(attempt.alreadySolved) || !validMoves(attempt.sequence) || !Number.isFinite(attempt.total) ||
      !attempt.steps?.length || attempt.steps[0].kind !== 'cross') throw new Error('Invalid solve report.');

  let pairs = attempt.alreadySolved.length;
  const steps = attempt.steps.map(step => {
    const { kind, slots, targetSlots, start, end, moves, suffix, timing, already } = step;
    if (!['cross', 'pair'].includes(kind) || !validSlots(slots) || !validSlots(targetSlots) ||
        !validFacelets(start) || !validFacelets(end) || !validMoves(moves) || !validMoves(suffix) ||
        !validTiming(timing)) throw new Error('Invalid solve split.');
    const title = kind === 'cross' ? 'White cross'
      : slots.length === 1 ? `Pair ${pairs + 1}` : `Pairs ${pairs + 1}–${pairs + slots.length}`;
    pairs += slots.length;
    return { kind, title, slots, targetSlots, start: Cube.fromString(start), end: Cube.fromString(end), moves, suffix, timing, already: Boolean(already) };
  });
  return {
    alreadySolved: attempt.alreadySolved,
    total: attempt.total,
    moves: attempt.sequence,
    steps,
  };
}

export class ActivityHistory {
  user = null;
  cloud = null;
  status = 'Checking sign-in…';
  attempts = read(guestAttempts, []);
  preferences = read(guestPreferences, {});

  constructor(change, error) {
    this.change = change;
    this.error = error;
  }

  async connect(config) {
    try {
      if (!config.apiKey || !config.authDomain) {
        this.status = 'Guest history stays in this browser.';
        return;
      }
      const { connectFirebase } = await import('./firebase-store.js');
      this.cloud = connectFirebase(config, {
        account: (user) => {
          const switched = this.user?.uid !== user?.uid;
          this.user = user;
          if (switched) {
            this.attempts = user ? [] : read(guestAttempts, []);
            this.preferences = user ? {} : read(guestPreferences, {});
          }
          this.status = user ? 'Loading account history…' : 'Guest history stays in this browser.';
          this.change({ attempts: switched, preferences: switched, account: switched });
        },
        attempts: (attempts) => {
          this.attempts = attempts;
          this.change({ attempts: true });
        },
        preferences: (preferences) => {
          this.preferences = preferences;
          this.change({ preferences: true });
        },
        status: (status) => {
          this.status = status;
          this.change({});
        },
      });
    } catch {
      this.status = 'Google sign-in is currently unavailable.';
    } finally {
      this.change({});
    }
  }

  record(attempt) {
    if (this.user) {
      this.cloud.saveAttempt(this.user.uid, attempt).catch(() => this.error('This attempt could not sync to your account.'));
      return;
    }
    this.attempts = [attempt, ...this.attempts].slice(0, recentLimit);
    if (!write(guestAttempts, this.attempts)) this.error('Browser storage is unavailable. Guest history will last for this session.');
    this.change({ attempts: true });
  }

  setPreference(key, value) {
    this.preferences = { ...this.preferences, [key]: value };
    if (this.user) {
      this.cloud.savePreference(this.user.uid, key, value).catch(() => this.error('This preference could not sync to your account.'));
    } else if (!write(guestPreferences, this.preferences)) {
      this.error('Browser storage is unavailable. This preference will last for this session.');
    }
  }

  async exportSince(since) {
    const uid = this.user?.uid;
    const attempts = uid
      ? await this.cloud.exportSince(uid, since)
      : this.attempts.filter(attempt => attempt.time >= since);
    if (this.user?.uid !== uid) throw new Error('The account changed during export.');
    return {
      version: 1, exportedAt: new Date().toISOString(), since: new Date(since).toISOString(),
      preferences: this.preferences, attempts,
    };
  }
}
