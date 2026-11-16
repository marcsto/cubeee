import { cases } from './trainer.js';

export const caseGroups = [
  { id: 'all', label: 'All cases', items: cases },
  { id: 'easy', label: 'Easy inserts', items: cases.filter(item => item.title === 'Easy insert') },
  { id: 'fundamentals', label: 'Fundamentals', items: cases.filter(item => item.category === 'Fundamentals') },
  { id: 'white-up', label: 'White facing up', items: cases.filter(item => item.title === 'White facing up') },
  { id: 'in-slot', label: 'In-slot cases', items: cases.filter(item => item.category === 'In slot') },
  { id: 'advanced', label: 'Advanced cases', items: cases.filter(item => item.category === 'Advanced') },
  { id: 'wrong-edge', label: 'Edges in wrong slots', items: cases.filter(item => item.title === 'Edge in the wrong slot' || item.title === 'Pair in wrong slots') },
  { id: 'wrong-corner', label: 'Corners in wrong slots', items: cases.filter(item => item.title === 'Corner in the wrong slot' || item.title === 'Pair in wrong slots') },
];

export function practiceDays(attempts) {
  const days = new Map();
  for (const { kind, caseId, time } of attempts) {
    const item = cases[caseId - 1];
    if (kind !== 'practice' || !item || !Number.isFinite(time)) continue;
    const date = new Date(time);
    if (!Number.isFinite(date.getTime())) continue;
    const key = date.toDateString();
    if (!days.has(key)) days.set(key, { key, date, reps: 0, counts: new Map() });
    const day = days.get(key);
    day.reps++;
    day.counts.set(item, (day.counts.get(item) ?? 0) + 1);
  }
  return days;
}

function shuffled(items) {
  const deck = [...items];
  for (let index = deck.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1));
    [deck[index], deck[other]] = [deck[other], deck[index]];
  }
  return deck;
}

export class PracticeOrder {
  constructor(mode) {
    this.reset(mode);
  }

  reset(mode, current) {
    this.group = caseGroups.find(group => group.id === mode);
    this.resetDeck(current);
  }

  review(items, current) {
    this.group = { id: 'review', items };
    this.resetDeck(current);
  }

  resetDeck(current) {
    this.mode = this.group?.id ?? 'ordered';
    const included = this.group?.items.includes(current);
    this.history = included ? [current] : [];
    this.position = this.history.length - 1;
    this.remaining = this.group ? shuffled(this.group.items.filter(item => item !== current)) : [];
  }

  get canGoBack() {
    return !this.group || this.position > 0;
  }

  next(current) {
    if (!this.group) return cases[current.id % cases.length];
    if (this.position === this.history.length - 1) {
      const newPass = !this.remaining.length || !this.history.length;
      if (!this.remaining.length) this.remaining = shuffled(this.group.items);
      // Starting a new pass should immediately give the learner a different case.
      const last = this.remaining.length - 1;
      if (newPass && last > 0 && this.remaining[last] === current) {
        [this.remaining[last], this.remaining[0]] = [this.remaining[0], this.remaining[last]];
      }
      this.history.push(this.remaining.pop());
    }
    return this.history[++this.position];
  }

  previous(current) {
    if (!this.group) return cases[(current.id + cases.length - 2) % cases.length];
    if (this.canGoBack) return this.history[--this.position];
    return current;
  }
}
