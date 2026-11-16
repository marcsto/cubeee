import { writeFileSync } from 'node:fs';
import { f2lPattern, invert, played, simplify, slotSolved, slots, solved } from '../src/cube.js';

const auf = ['U', 'U2', "U'"];
const turns = ['R', "R'", 'F', "F'", 'L', "L'", 'B', "B'"];
const triggers = turns.flatMap(open => auf.map(top => [open, top, ...invert([open])]));
const groups = new Map();
const primary = "R U' R'";

function pair(cube) {
  const c = cube.cp.indexOf(4);
  const e = cube.ep.indexOf(8);
  return { c, co: cube.co[c], e, eo: cube.eo[e] };
}

function save(cube, moves) {
  if (slotSolved(cube, 0)) return;
  const standard = [1, 2, 3].every(slot => slotSolved(cube, slot));
  const { c, e } = pair(cube);
  if (!standard && c < 5 && e < 9) return;
  const pattern = f2lPattern(cube);
  let group = groups.get(pattern);
  if (!group) {
    group = { cube, standard, paths: new Map() };
    groups.set(pattern, group);
  }
  // Final U turns do not affect the solved layers. Omit them from the alternatives.
  const solution = invert(moves);
  if (solution.at(-1)?.startsWith('U')) solution.pop();
  const text = solution.join(' ');
  group.paths.set(text, solution.length);
  if (group.paths.size > 12) {
    const worst = [...group.paths].sort((a, b) => b[1] - a[1] || Number(!b[0].includes('F')) - Number(!a[0].includes('F')))[0];
    group.paths.delete(worst[0]);
  }
}

function walk(cube, moves, depth, lastAuf, activeTriggers) {
  if (depth === 0) return;
  for (const macro of (lastAuf ? activeTriggers : [...activeTriggers, ...auf.map(move => [move])])) {
    const path = simplify([...moves, ...macro]);
    if (path.length <= moves.length || (path.length > 12 && depth > 1)) continue;
    const next = played(cube, macro);
    save(next, path);
    walk(next, path, depth - 1, macro.length === 1, activeTriggers);
  }
}

walk(solved, [], 4, true, triggers);
walk(solved, [], 6, true, triggers.filter(([open]) => open === 'R' || open === "F'"));

function label({ c, co, e, eo }, length) {
  if (c >= 5 && e >= 9) return ['Advanced', 'Pair in wrong slots', `Corner in the ${slots[c - 4].toLowerCase()} slot · Edge in the ${slots[e - 8].toLowerCase()} slot`];
  if (e >= 9) return ['Advanced', 'Edge in the wrong slot', `Edge in the ${slots[e - 8].toLowerCase()} slot${eo ? ' · Flipped edge' : ''}`];
  if (c >= 5) return ['Advanced', 'Corner in the wrong slot', `Corner in the ${slots[c - 4].toLowerCase()} slot${co ? ' · Twisted corner' : ''}`];
  if (c === 4 && e === 8) return ['In slot', eo ? 'Flipped edge in slot' : 'Twisted corner in slot', 'Both pieces in the front-right slot'];
  if (e === 8) return ['In slot', eo ? 'Flipped edge in slot' : 'Edge in slot', 'Corner in the top layer'];
  if (c === 4) return ['In slot', co ? 'Twisted corner in slot' : 'Corner in slot', 'Edge in the top layer'];
  if (length <= 4) return ['Fundamentals', 'Easy insert', 'Both pieces in the top layer'];
  if (!co) return ['Fundamentals', 'White facing up', 'Both pieces in the top layer'];
  return ['Fundamentals', 'Pair in the top layer', 'White sticker facing the side'];
}

const unique = new Map();
for (const group of groups.values()) {
  const { cube, standard, paths } = group;
  const variants = [cube, ...auf.map(move => played(cube, [move]))];
  const orbit = variants.map(f2lPattern).sort()[0];
  const ordered = [...paths].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
  const first = ordered.find(([text]) => invert(text.split(' ')).join(' ') === primary) ?? ordered[0];
  const score = Number(invert(first[0].split(' ')).join(' ') === primary) * 100 + 32 - first[1] + Math.min(ordered.length, 3) / 4;
  if ((unique.get(orbit)?.score ?? -1) >= score) continue;
  const alternatives = ordered.filter(([text]) => text !== first[0]);
  const differentGrip = alternatives.find(([text, count]) => count <= first[1] + 4 && text.replace(/^U[2']? /, '')[0] !== first[0].replace(/^U[2']? /, '')[0]);
  const choices = [first, ...new Set([...(differentGrip ? [differentGrip] : []), ...alternatives])].slice(0, 3).map(([text]) => text);
  const [category, title, detail] = label(pair(cube), first[1]);
  unique.set(orbit, { category, title, detail, setup: invert(first[0].split(' ')).join(' '), solutions: choices, score, standard, ...pair(cube) });
}

const ranked = [...unique.values()].sort((a, b) => b.score - a.score);
const advanced = [];
for (const position of [9, 10, 11]) {
  advanced.push(...ranked.filter(c => c.e === position && c.c < 5).slice(0, 4));
}
for (const position of [5, 6, 7]) {
  advanced.push(...ranked.filter(c => c.c === position && c.e < 9).slice(0, 3));
}
advanced.push(...ranked.filter(c => c.e >= 9 && c.c >= 5).slice(0, 3));
const standard = ranked.filter(c => c.standard);
const cases = [...standard, ...advanced].map(({ category, title, detail, setup, solutions }, index) => ({ id: index + 1, category, title, detail, setup, solutions }));
writeFileSync(new URL('../src/cases.json', import.meta.url), '[\n' + cases.map(item => '  ' + JSON.stringify(item)).join(',\n') + '\n]\n');
console.log(`${standard.length} standard, ${advanced.length} advanced. Alternatives: ${cases.filter(c => c.solutions.length === 3).length}/${cases.length}`);
