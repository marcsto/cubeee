import '@fontsource-variable/manrope/wght.css';
import '@fontsource/space-mono/latin-400.css';
import '@fontsource/space-mono/latin-700.css';
import './style.css';
import { Activity, ArrowRight, Bluetooth, Box, Check, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, CircleHelp, Clock, History, Keyboard, LayoutGrid, Move, Pause, Play, RefreshCw, RotateCcw, Scan, Star, Target, UserRound, Zap, X, createElement } from 'lucide';
import { ActivityHistory, recentLimit, restoreReport, savedAttempt, savedReport } from './activity.js';
import { algorithmMoveCount, crossSolved, faces, invert, isCubeRotation, played, slotFaces, slotSolved, slots, solved, turnFace } from './cube.js';
import { cubeSkillsGuide, cubeSkillsSolutions, simplifyOpeningUTurns } from './cubeskills.js';
import { caseThumbnail, CubeView } from './cube-view.js';
import { BluetoothCube, normalizeAddress } from './bluetooth.js';
import { FullSolve } from './full-solve.js';
import { canonicalCube, frontColors, getGrip, gripMove } from './grip.js';
import { caseGroups, practiceDays, PracticeOrder } from './practice-order.js';
import { planPair } from './planner.js';
import { elapsedBetween, matchesPieces, phasePieces, pieceState } from './solve-session.js';
import { Trainer, cases } from './trainer.js';
import firebaseConfig from './firebase-config.json';

const icons = { Activity, ArrowRight, Bluetooth, Box, Check, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, CircleHelp, Clock, History, Keyboard, LayoutGrid, Move, Pause, Play, RefreshCw, RotateCcw, Scan, Star, Target, UserRound, Zap, X };
const $ = selector => document.querySelector(selector);
const icon = name => `<span data-icon="${name}" aria-hidden="true"></span>`;
const hydrate = (root = document) => root.querySelectorAll('[data-icon]:empty').forEach(node => {
  const shape = icons[node.dataset.icon];
  if (shape) node.append(createElement(shape, { 'aria-hidden': true }));
});
const number = id => String(id).padStart(2, '0');
const showMove = move => move.replace("'", '′');
const notation = moves => moves.map(showMove).join(' ');
const time = ms => (ms / 1000).toFixed(2);
const caseCount = count => `${count} ${count === 1 ? 'case' : 'cases'}`;
const repCount = count => `${count} ${count === 1 ? 'rep' : 'reps'}`;
const libraryGroups = caseGroups.filter(group => ['all', 'easy', 'fundamentals', 'in-slot', 'advanced'].includes(group.id));
const caseListOffsets = new Map();
const thumbnails = new Map();
const historyDate = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const missedPracticeTurn = 'A Bluetooth turn was missed. Restart the case to record a complete attempt.';
const halfTurnWindow = 200;
const faceNames = { U: 'top', R: 'right', F: 'front', D: 'bottom', L: 'left', B: 'back' };
const stickerNames = { U: 'yellow', D: 'white', F: 'green', R: 'orange', L: 'red', B: 'blue' };
const colorLabel = face => stickerNames[face][0].toUpperCase() + stickerNames[face].slice(1);
const work = $('#work-panel');
const live = new CubeView($('#live-canvas'));
const dialog = $('#dialog');

const activity = new ActivityHistory(activityChanged, showNotice);
const order = new PracticeOrder(activity.preferences.order);
let sessionCount = 0;
let page = 'practice';
let mode = 'practice';
let virtualPracticeIssue = '';
let practiceGestureTurn;
let filter = libraryGroups[0];
let modifier = '';
let noticeTimer;
let demo;
let demoGrip;
let preview = null;
let previewTimer;
let gripOverride;
let revealedAttempt;
let renderedPracticeStart;
let renderedFullLog;
let fullHint;
let addressRequest;
let renderedCubeStatus;
let renderedBattery;
let accountBusy = false;
let exportDays = '30';
let historyView = 'cases';
let historyDay;

const physicalTrainer = new Trainer(transition => {
  if (trainer === physicalTrainer) update(transition);
}, recordPractice);
const virtualTrainer = new Trainer(update, recordPractice);
let practiceTrainer = physicalTrainer;
let trainer = practiceTrainer;

function recordPractice(result) {
  sessionCount++;
  activity.record(savedAttempt('practice', result, result.sequence, {
    caseId: result.id,
    slots: [0],
    start: trainer.caseStart.asString(),
    assisted: Boolean(trainer.solveLog.assisted),
    bestKnownMoves: Math.min(...trainer.item.solutions.map(algorithmMoveCount)),
  }));
}

const full = new FullSolve(physicalTrainer, () => {
  if (page === 'full') renderWork();
}, (kind, log, result) => {
  const details = { start: log.start.asString(), assisted: Boolean(log.assisted) };
  if (kind === 'full') {
    Object.assign(details, savedReport(result));
    const think = result.steps.reduce((sum, step) => sum + step.timing.think, 0);
    activity.record(savedAttempt(kind, { think, execution: result.total - think, total: result.total }, result.moves, details));
    return;
  }
  activity.record(savedAttempt(kind, log.timing(), log.moves, { ...details, slots: result.slots }));
});

const bluetooth = new BluetoothCube({
  change() {
    if (renderConnection() && (page === 'practice' || page === 'full')) renderWork();
  },
  sync(cube, force, turnsSkipped) {
    if (trainer === virtualTrainer) {
      const stateChanged = cube.asString() !== physicalTrainer.cube.asString();
      physicalTrainer.sync(cube, force, true);
      if (!force && (turnsSkipped || stateChanged)) interruptVirtualPractice(missedPracticeTurn);
      if (force && trainer.phase === 'solving') {
        interruptVirtualPractice('The Bluetooth cube connected during this attempt. Restart the case to use it for turns.');
      }
      return;
    }
    if (mode === 'full' && (force || cube.asString() !== trainer.cube.asString())) {
      full.interrupt('The cube state changed. Start a new attempt to record accurate splits.');
    }
    trainer.sync(cube, force, mode === 'full');
  },
  disconnect: resetAfterDisconnect,
  missedTurn() {
    if (trainer === virtualTrainer) interruptVirtualPractice(missedPracticeTurn);
  },
  turn(move, local = performance.now(), device) {
    if (trainer === virtualTrainer) {
      physicalTrainer.turn(move, local, device);
      if (handlePracticeGesture(move, local, device)) return;
    }
    trainer.turn(move, local, device);
  },
  error: showNotice,
  address: askAddress,
  async addressStore(deviceName) {
    await accountReady;
    return activity.cloud?.cubeAddressStore(deviceName);
  },
});

function resetAfterDisconnect() {
  practiceGestureTurn = undefined;
  if (mode === 'full') {
    full.interrupt('The cube disconnected. Reconnect or start a new attempt in virtual mode.');
    update();
  } else if (trainer === virtualTrainer) {
    interruptVirtualPractice('The Bluetooth cube disconnected. Reconnect or restart with the on-screen controls.');
  } else startPractice(trainer.item);
}

function interruptVirtualPractice(message) {
  if (!practiceIsSolving()) return;
  virtualPracticeIssue = message;
  virtualTrainer.free();
  update();
}

function update(transition) {
  if (preview?.scope === 'practice' && preview.start !== trainer.caseStart) clearPreview();
  const previousPhase = full.phase;
  if (mode === 'full' && transition) full.record(transition);
  live.show(trainer.cube, trainer.expected, transition);
  if (page === 'practice') updatePractice();
  if (page === 'full') updateFull(previousPhase);
  renderTargetGuide();
  renderSessionCount();
}

function practiceIsSolving() {
  return trainer.phase === 'ready' || trainer.phase === 'solving';
}

function drillIsSolving() {
  return full.phase === 'drill-ready' || full.phase === 'drilling';
}

function fullIsSolving() {
  return full.phase === 'ready' || full.phase === 'solving';
}

function solutionAttempt() {
  if (page === 'practice' && practiceIsSolving()) return trainer.caseStart;
  if (page === 'full') return drillIsSolving() ? full.log : fullIsSolving() ? fullHint : undefined;
}

function solutionsAreOpen() {
  const attempt = solutionAttempt();
  return Boolean(attempt && attempt === revealedAttempt);
}

function updateTimedPair(panel, phase, status, turns) {
  if (panel.dataset.timedPair !== phase) {
    panel.querySelector('h3').textContent = status.title;
    panel.querySelector('.phase-copy').textContent = status.description;
    panel.querySelector('.ready-block small').textContent = status.timerLabel;
    panel.dataset.timedPair = phase;
  }
  const log = panel.querySelector('[data-practice-turns]');
  log.hidden = turns.length === 0;
  log.querySelector('code').textContent = notation(turns);
}

function updatePractice() {
  const solve = $('[data-timed-pair]');
  if (renderedPracticeStart === trainer.caseStart && practiceIsSolving() && solve) {
    const turns = trainer.turns;
    updateTimedPair(solve, trainer.phase, practiceSolveStatus(), turns);
    $('[data-metric="moves"]').textContent = turns.length || '—';
  } else if (trainer.phase !== 'results' || renderedPracticeStart !== trainer.caseStart || !$('[data-practice-result]')) {
    renderWork();
  }
}

function updateFull(previousPhase) {
  if (fullHint && (!fullIsSolving() || fullHint.slots[0] !== full.targetSlot || fullHint.log !== full.log)) {
    clearFullHint();
    renderWork();
    return;
  }
  const drill = $('[data-timed-pair]');
  const solve = $('[data-full-solve]');
  if (renderedFullLog === full.log && drillIsSolving() && drill) {
    updateTimedPair(drill, full.phase, drillSolveStatus(), full.log.moves);
  } else if (renderedFullLog === full.log && fullIsSolving() && solve) {
    solve.querySelector('h3').textContent = full.phase === 'ready' ? 'Ready to solve' : 'Solve the cross and F2L';
    solve.querySelector('[data-cross-status]').textContent = crossSolved(trainer.cube) ? 'Solved' : 'Open';
    solve.querySelector('[data-pair-count]').textContent = `${slots.filter((_, slot) => slotSolved(trainer.cube, slot)).length} / 4`;
    const log = solve.querySelector('[data-practice-turns]');
    log.hidden = !full.log.first;
    log.querySelector('code').textContent = notation(full.log.moves);
    const target = $('#full-target');
    target.closest('.target-control').hidden = !full.crossReached;
    target.value = full.targetSlot ?? '';
    for (const option of [...target.options].slice(1)) option.disabled = slotSolved(trainer.cube, Number(option.value));
  } else if (full.phase !== 'review' || previousPhase !== full.phase) renderWork();
}

function visibleTargets() {
  if (page === 'practice') return trainer === virtualTrainer ? [] : [0];
  if (page !== 'full') return [];
  if (full.phase === 'review' || full.phase.includes('drill')) return full.step?.slots ?? [];
  return full.targetSlot !== null && (full.phase === 'ready' || full.phase === 'solving') ? [full.targetSlot] : [];
}

function pairColors(slot) {
  return [...`D${slotFaces[slot]}`].map(face => stickerNames[face]);
}

function renderTargetGuide() {
  const targets = visibleTargets();
  live.setTargets(targets);
  const guide = $('#pair-guide');
  const key = targets.join(',');
  if ((guide.dataset.targets ?? '') === key) return;
  guide.dataset.targets = key;
  guide.hidden = targets.length === 0;
  guide.innerHTML = targets.length ? `<div class="target-details"><span class="target-caption">${targets.length === 1 ? 'Target pair' : 'Target pairs'}</span>
    ${targets.map(slot => `<div class="target-row"><span class="pair-colors" aria-hidden="true">${pairColors(slot).map(color => `<i data-color="${color}"></i>`).join('')}</span><strong>${slots[slot]}</strong><span>${pairColors(slot).join(', ')}</span></div>`).join('')}
    <small><i class="marker-key"></i> Pieces <i class="marker-key destination"></i> Slot</small></div>
    <button class="button ghost solution-toggle" data-action="find-pair">${icon('Target')} Find ${targets.length === 1 ? 'pair' : 'pairs'}</button>` : '';
  hydrate(guide);
}

function renderSessionCount() {
  $('#session-count').textContent = page === 'full'
    ? `${full.completed} ${full.completed === 1 ? 'solve' : 'solves'}`
    : `${sessionCount} ${sessionCount === 1 ? 'rep' : 'reps'}`;
}

function go(destination, practiceItem = practiceTrainer.item) {
  page = destination;
  const [title, description] = {
    practice: ['F2L Practice', 'Train recognition and execution, one pair at a time.'],
    full: ['Cross + F2L', 'Solve the first two layers on your own and review each split.'],
    library: ['Case Library', 'Explore standard F2L cases and pairs trapped in the wrong slot.'],
    history: ['Training History', 'Review your practice, pair retries, and Cross + F2L solves.'],
  }[page];
  $('#page-title').textContent = title;
  $('#page-description').textContent = description;
  document.querySelectorAll('.nav-item').forEach(button => {
    if (button.dataset.view === destination) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  $('#recent-panel').hidden = page === 'history' || page === 'full';
  if (destination === 'full' && mode !== 'full') {
    clearPreview();
    mode = 'full';
    trainer = physicalTrainer;
    trainer.free();
    live.show(trainer.cube, null);
  } else if (destination === 'practice' && mode === 'full') {
    clearPreview();
    clearFullHint();
    mode = 'practice';
    full.interrupt();
    trainer = practiceTrainer;
    startPractice(practiceItem);
  }
  renderConnection();
  renderSessionCount();
  renderWork();
}

function renderConnection() {
  const virtual = trainer === virtualTrainer;
  const awaitingState = bluetooth.awaitingState;
  const status = `${bluetooth.status}:${virtual}:${awaitingState}`;
  const statusChanged = renderedCubeStatus !== status;
  if (!statusChanged && renderedBattery === bluetooth.battery) return false;
  renderedCubeStatus = status;
  renderedBattery = bluetooth.battery;
  const connected = bluetooth.status === 'connected';
  const connecting = bluetooth.status === 'connecting';
  const label = $('#connect-label');
  label.textContent = connected ? 'GAN i4 connected' : connecting ? 'Connecting…' : 'Connect GAN i4';
  $('#connect-button').classList.toggle('connected', connected);
  $('#connect-button').disabled = connecting;
  $('.live-badge').classList.toggle('connected', connected && !awaitingState);
  $('#cube-title').textContent = virtual ? 'Virtual cube' : 'Live cube';
  $('#cube-status').textContent = awaitingState ? 'Sync needed' : connected
    ? virtual ? 'Bluetooth controls' : 'Synced via Bluetooth'
    : connecting ? 'Connecting' : 'On-screen controls';
  $('#cube-input').innerHTML = connected
    ? `<span class="input-caption">${icon('Bluetooth')} Turn your physical cube</span><span class="history-meta">${Number.isFinite(bluetooth.battery) ? `${bluetooth.battery}% battery` : 'Bluetooth active'}</span><button class="settings-link" data-action="resync">${icon('RefreshCw')} Sync state</button>`
    : `<span class="input-caption">${icon('Keyboard')} Cube controls</span><div class="keys" aria-label="Turn the virtual cube">
       ${[...'URFDLB'].map(face => `<button class="key" data-turn="${face}" aria-label="Turn ${faceNames[face]} face">${face}</button>`).join('')}
       <span class="key-separator"></span><button class="key" data-modifier="prime" title="Counterclockwise (Shift)" aria-label="Counterclockwise modifier" aria-pressed="${modifier === "'"}">′</button><button class="key" data-modifier="double" title="Half turn (Alt)" aria-label="Half-turn modifier" aria-pressed="${modifier === '2'}">2</button>
       </div><button class="settings-link" data-action="help" title="Keyboard shortcuts" aria-label="Keyboard shortcuts">${icon('CircleHelp')}</button>`;
  hydrate($('#cube-input'));
  return statusChanged;
}

function setModifier(value) {
  modifier = value;
  document.querySelector('[data-modifier="prime"]')?.setAttribute('aria-pressed', String(modifier === "'"));
  document.querySelector('[data-modifier="double"]')?.setAttribute('aria-pressed', String(modifier === '2'));
}

function renderWork() {
  const focused = work.contains(document.activeElement) ? document.activeElement : null;
  const oldList = work.querySelector('.case-list');
  const gripOptionsOpen = work.querySelector('.grip-more')?.open;
  if (oldList) caseListOffsets.set(oldList.dataset.group, oldList.scrollTop);
  const previewOpen = preview?.scope === page &&
    (solutionsAreOpen() || (page === 'practice' && trainer.phase === 'results') ||
      (page === 'full' && (full.phase === 'review' || full.phase === 'drill-result')));
  const grip = previewOpen ? solutionGrip(preview.context) : undefined;
  const angle = demo && grip === demoGrip ? [demo.yaw, demo.pitch] : null;
  demo?.destroy();
  demo = undefined;
  renderedPracticeStart = page === 'practice' ? trainer.caseStart : undefined;
  renderedFullLog = page === 'full' ? full.log : undefined;
  work.innerHTML = { practice: practiceMarkup, full: fullMarkup, library: libraryMarkup, history: historyMarkup }[page]();
  hydrate(work);
  if (gripOptionsOpen) work.querySelector('.grip-more')?.setAttribute('open', '');
  const list = work.querySelector('.case-list');
  if (list) list.scrollTop = caseListOffsets.get(list.dataset.group) ?? 0;
  if (focused) {
    const replacement = focused.id ? work.querySelector(`#${CSS.escape(focused.id)}`)
      : focused.dataset.filter ? work.querySelector(`[data-filter="${focused.dataset.filter}"]`)
        : [...work.querySelectorAll('button')].find(candidate => candidate.outerHTML.split('>')[0] === focused.outerHTML.split('>')[0]);
    replacement?.focus({ preventScroll: true });
  }
  if (previewOpen) {
    demo = new CubeView($('#demo-canvas'), { compact: true, followArrows: false });
    demoGrip = grip;
    if (angle) [demo.yaw, demo.pitch] = angle;
    demo.setTargets(preview.targets);
    updatePreview();
  }
  renderTargetGuide();
  renderAccount();
  tick();
}

function practiceMarkup() {
  const { item, phase, result } = trainer;
  const virtualPractice = trainer === virtualTrainer;
  const solving = practiceIsSolving();
  const stages = virtualPractice ? ['Solve', 'Review'] : ['Setup', 'Solve', 'Review'];
  const stage = stages.indexOf(phase === 'results' ? 'Review' : virtualPractice || solving ? 'Solve' : 'Setup');
  return `<div class="practice-controls">
    <div class="practice-order">
      <label for="practice-order">Practice order</label>
      <div class="select-wrap"><select id="practice-order">
        ${order.mode === 'review' ? `<option value="review" selected>Review set · ${caseCount(order.group.items.length)}</option>` : ''}
        <option value="ordered" ${order.mode === 'ordered' ? 'selected' : ''}>In order</option>
        <optgroup label="Random practice">${caseGroups.map(group => `<option value="${group.id}" ${order.mode === group.id ? 'selected' : ''}>Random · ${group.label}</option>`).join('')}</optgroup>
      </select>${icon('ChevronDown')}</div>
      ${order.mode === 'review' ? '<button class="text-button" data-action="end-review">End review</button>' : ''}
    </div>
    <button id="virtual-practice" class="button ghost practice-mode" data-action="virtual-practice" aria-pressed="${virtualPractice}" title="Load each case directly on the virtual cube">${icon('Box')} Virtual cube</button>
  </div>
  <div class="case-head">
    <div class="case-top"><div class="case-kicker">CASE ${number(item.id)} ${categoryBadge(item.category)}</div>
      <div class="case-nav"><button class="icon-button" data-action="previous" title="Previous case" aria-label="Previous case" ${order.canGoBack ? '' : 'disabled'}>${icon('ChevronLeft')}</button><button class="icon-button" data-action="next" title="Next case" aria-label="Next case">${icon('ChevronRight')}</button></div>
    </div>
    <h2>${item.title}</h2><p>${item.detail}</p>
  </div>
  <div class="stepper" aria-label="Practice progress">${stages.map((name, index) => `<div class="step ${index === stage ? 'active' : index < stage ? 'done' : ''}" ${index === stage ? 'aria-current="step"' : ''}><i>${index < stage ? icon('Check') : index + 1}</i>${name}</div>`).join('')}</div>
  ${phase === 'results' ? reviewMarkup() : solving ? solveMarkup() : virtualPractice ? interruptedPracticeMarkup() : setupMarkup()}
  <div class="metrics" aria-label="Current attempt statistics">${metric('Thinking', result ? time(result.think) : '—', result ? 's' : '', 'Clock', 'thinking')}${metric('Execution', result ? time(result.execution) : '—', result ? 's' : '', 'Zap', 'execution')}${metric('Moves', result?.moves ?? (phase === 'solving' ? trainer.turns.length : '—'), '', 'Move', 'moves')}</div>`;
}

function categoryBadge(category) {
  return `<span class="case-category ${category === 'Advanced' ? 'advanced' : ''}">${category}</span>`;
}

function metric(label, value, unit = '', visual = null, field = null) {
  return `<div class="metric"><div class="metric-label">${visual ? icon(visual) : ''}${label}</div><div class="metric-value"${field ? ` data-metric="${field}"` : ''}>${value}${unit ? `<span>${unit}</span>` : ''}</div></div>`;
}

function setupMarkup(kind = 'case') {
  if (trainer.phase === 'planning') return `<div class="phase-card"><h3>Finding a setup</h3><p class="phase-copy">Hold your cube still while cubeee reads the current position.</p><div class="ready-block"><small>Calculating turns…</small></div></div>`;
  if (trainer.phase === 'error') return `<div class="phase-card"><h3>Setup unavailable</h3><p class="phase-copy">Sync the cube again, or solve it and retry the setup.</p><div class="actions"><button class="button secondary" data-action="retry">${icon('RefreshCw')} Recalculate setup</button></div></div>`;
  const { route, progress, partial, mistakes, expected } = trainer;
  const guide = mistakes.length ? invert(mistakes) : route;
  const position = mistakes.length ? 0 : progress;
  const lead = Math.min(Math.max(position - 2, 0), Math.max(guide.length - 7, 0));
  const limit = Math.min(lead + 7, guide.length);
  const direction = expected[1] === '2' ? ' by 180°' : expected[1] === "'" ? ' counterclockwise' : ' clockwise';
  const instruction = mistakes.length ? `Wrong turn. Do <b>${showMove(expected)}</b> to ${mistakes.length > 1 ? 'continue correcting the sequence.' : 'return to the setup.'}`
    : partial ? `One more quarter-turn. Turn the ${faceNames[expected[0]]} face${direction}.` : `Turn the ${faceNames[expected[0]]} face${direction}.`;
  const title = kind === 'scramble' ? 'Scramble the cube' : 'Set up the pair';
  const finishButton = kind === 'case' ? '<button class="button ghost" data-action="browse">Browse cases</button>'
    : `<button class="button ghost" data-action="${kind === 'scramble' ? 'full-cancel' : 'full-back'}">Cancel</button>`;
  const virtual = bluetooth.status !== 'connected';
  return `<div class="phase-card">
    <div class="section-line"><h3>${title}</h3><span class="phase-counter">${progress + 1} / ${route.length} moves</span></div>
    <p class="phase-copy">Follow the turns with white down and green facing you.</p>
    <div class="sequence" aria-label="${mistakes.length ? 'Correction sequence' : 'Setup sequence'}">
      ${lead ? '<span class="omitted">…</span>' : ''}${guide.slice(lead, limit).map((move, index) => {
        const step = lead + index;
        const status = step < position ? 'done' : step === position ? mistakes.length ? 'corrective' : 'current' : '';
        return `<span class="move-token ${status}" ${step === position ? 'aria-current="step"' : ''}>${showMove(step === position && partial && !mistakes.length ? expected : move)}</span>`;
      }).join('')}${limit < guide.length ? '<span class="omitted">…</span>' : ''}
    </div>
    <div class="progress-track" role="progressbar" aria-label="Setup progress" aria-valuemax="${route.length}" aria-valuenow="${progress}"><i style="width:${(progress + (partial ? 0.5 : 0)) / route.length * 100}%"></i></div>
    <div class="instruction ${mistakes.length ? 'error' : ''}" ${mistakes.length ? 'role="alert"' : 'aria-live="polite"'}>${icon(mistakes.length ? 'CircleAlert' : 'RotateCcw')}<span>${instruction}</span></div>
    ${virtual || kind !== 'case' ? `<div class="actions">${virtual ? `<button class="button" data-action="apply">${mistakes.length ? 'Apply correction' : 'Apply next turn'} ${icon('ArrowRight')}</button>${kind !== 'case' ? '<button class="button secondary" data-action="apply-all">Apply all</button>' : ''}` : ''}${finishButton}</div>` : '<p class="phase-copy">Waiting for your GAN i4 to send the next turn.</p>'}
  </div>`;
}

function practiceSolveStatus() {
  const description = trainer !== virtualTrainer ? 'Your first turn ends thinking time and starts execution.' : bluetooth.status === 'connected'
    ? 'Watch the virtual cube and turn your Bluetooth cube. Your first turn starts execution.'
    : 'Use the face buttons or keyboard. Your first turn starts execution.';
  return trainer.phase === 'ready'
    ? { title: 'Ready to solve', description, timerLabel: 'Thinking time' }
    : { title: 'Solving the pair', description: 'Finish the front-right pair and restore the white cross and any solved slots.', timerLabel: 'Execution time' };
}

function interruptedPracticeMarkup() {
  const awaitingState = bluetooth.awaitingState;
  return `<div class="phase-card"><h3>Attempt interrupted</h3>
    <p class="phase-copy" role="status">${awaitingState ? 'Sync your Bluetooth cube before starting another attempt.' : virtualPracticeIssue}</p>
    <div class="actions">${awaitingState ? `<button class="button" data-action="resync">${icon('RefreshCw')} Sync state</button>` : `<button class="button" data-action="retry">${icon('RotateCcw')} Restart case</button>`}</div></div>`;
}

function solveMarkup() {
  const { title, description, timerLabel } = practiceSolveStatus();
  const turns = trainer.turns;
  return `<div class="phase-card" data-timed-pair="${trainer.phase}">
    <div class="section-line">
      <h3>${title}</h3>
      ${solutionToggleMarkup()}
    </div>
    <p class="phase-copy">${description}</p>
    ${solutionsAreOpen() ? '' : preferredGripMarkup(trainer.item)}
    <div class="ready-block"><strong data-timer>${time(0)} s</strong><small>${timerLabel}</small></div>
    <p class="your-turns" data-practice-turns ${turns.length ? '' : 'hidden'}>Your turns <code>${notation(turns)}</code></p>
    ${duringSolveSolutions(practiceSolutionsMarkup)}
    <div class="actions"><button class="button secondary" data-action="retry">${icon('RotateCcw')} Restart case</button><button class="button ghost" data-action="next">Next case ${icon('ChevronRight')}</button></div>
  </div>`;
}

function reviewMarkup() {
  const gestureHint = trainer === virtualTrainer && bluetooth.status === 'connected'
    ? '<p class="phase-copy">Turn the left or right face for the next case. Turn the top layer to retry.</p>' : '';
  return `<div class="phase-card" data-practice-result><div class="section-line"><h3>Pair solved</h3><span class="live-badge connected">${icon('Check')} Complete</span></div>
    ${gestureHint}
    <p class="your-turns">Your turns <code>${notation(trainer.result.sequence)}</code></p>
    ${replayMarkup('practice')}
    ${practiceSolutionsMarkup()}
    <div class="actions"><button class="button" data-action="retry">${icon('RotateCcw')} Try again</button><button class="button secondary" data-action="next">Next case ${icon('ArrowRight')}</button></div>
  </div>`;
}

function solutionToggleMarkup() {
  const open = solutionsAreOpen();
  return `<button class="button secondary solution-toggle" data-action="show-solutions" id="show-solutions" aria-expanded="${open}" aria-controls="during-solve-solutions">${open ? 'Hide solutions' : 'Show solutions'}</button>`;
}

function duringSolveSolutions(markup) {
  const open = solutionsAreOpen();
  return `<section id="during-solve-solutions" ${open ? '' : 'hidden'}>${open ? markup() : ''}</section>`;
}

function replayMarkup(scope) {
  return `<button class="button secondary solution-toggle replay-attempt" id="replay-attempt" data-action="replay-attempt" aria-pressed="${preview?.scope === scope && preview.choice === 'attempt'}">${icon('Play')} Replay your moves</button>`;
}

function practiceSolutionsMarkup() {
  const { item } = trainer;
  const { choice: preferred } = preferredSolution(item);
  const grip = solutionGrip(item);
  return `<p class="phase-copy">Select a solution to save it as preferred and watch it on the cube.</p>
    ${gripMarkup(grip)}
    <div class="solutions" role="group" aria-label="Suggested solutions">${item.solutions.map((moves, index) => {
      const credit = item.cubeSkills.has(moves.join(' ')) ? ' · CubeSkills' : '';
      return `<button class="solution" data-solution="${index}" id="practice-solution-${index}" aria-pressed="${(preview?.choice ?? preferred) === index}">${icon(index === preferred ? 'Star' : 'Play')}<code>${gripNotation(moves, grip)}</code><small>${algorithmMoveCount(moves)} turns${credit}${index === preferred ? ' · Preferred' : ''}</small></button>`;
    }).join('')}</div>
    ${item.cubeSkills.size ? cubeSkillsCredit() : ''}
    ${preview?.scope === 'practice' ? walkthroughMarkup() : ''}`;
}

function cubeSkillsCredit() {
  return `<p class="algorithm-credit"><a href="${cubeSkillsGuide}" target="_blank" rel="noopener">CubeSkills F2L guide</a> · Opening U turns are aligned to the case.</p>`;
}

function gripNotation(moves, grip) {
  return notation(moves.map(move => gripMove(move, grip)));
}

function holdLabel(grip) {
  return `${grip.top === 'U' ? 'White down' : `${colorLabel(grip.top)} up`} · ${colorLabel(grip.front)} front`;
}

function preferredGripMarkup(context) {
  const { grip } = preferredSolution(context);
  if (grip.id === 'UF') return '';
  return `<p class="preferred-grip">Preferred grip <strong>${holdLabel(grip)}</strong></p>`;
}

function gripMarkup(grip) {
  return `<div class="grip-picker">
    <p class="grip-hold">Hold your cube <strong>${holdLabel(grip)}</strong></p>
    <div class="grip-front" role="group" aria-label="Front color">
      <span>Front color</span>
      ${frontColors(grip.top).map(face => `<button id="grip-front-${face}" class="filter grip-color" data-grip="${grip.top}${face}" aria-pressed="${face === grip.front}">
        <span class="pair-colors" aria-hidden="true"><i data-color="${stickerNames[face]}"></i></span>${colorLabel(face)}</button>`).join('')}
    </div>
    <details class="grip-more"><summary>More orientations</summary>
      <div class="grip-top"><label for="grip-top">Top color</label>
        <div class="select-wrap"><select id="grip-top">
          ${[...faces].map(face => `<option value="${face}" ${face === grip.top ? 'selected' : ''}>${colorLabel(face)}</option>`).join('')}
        </select>${icon('ChevronDown')}</div>
      </div>
    </details>
  </div>`;
}

function walkthroughMarkup() {
  return `<div class="demo"><div class="demo-stage"><canvas id="demo-canvas" role="img" aria-label="Solution walkthrough cube. Drag to see other faces."></canvas></div><div class="demo-toolbar">
      <button class="icon-button" data-action="demo-reset" aria-label="Reset walkthrough" title="Reset walkthrough">${icon('RotateCcw')}</button>
      <button class="icon-button" data-action="demo-back" aria-label="Previous walkthrough turn" title="Previous walkthrough turn">${icon('ChevronLeft')}</button>
      <button class="icon-button" data-action="demo-play" id="demo-play" aria-label="Play walkthrough" title="Play walkthrough">${icon('Play')}</button>
      <button class="icon-button" data-action="demo-forward" aria-label="Next walkthrough turn" title="Next walkthrough turn">${icon('ChevronRight')}</button>
      <span class="demo-progress" id="demo-progress"></span>
    </div></div>`;
}

function fullMarkup() {
  const { phase, log, step, report, error } = full;
  const warning = error ? `<p class="instruction error" role="alert">${error}</p>` : '';
  if (phase === 'review') return fullReviewMarkup(warning);
  if (phase === 'scrambling') return setupMarkup('scramble');
  if (phase === 'drill-setup') return setupMarkup('drill');
  if (phase === 'planning-scramble' || phase === 'planning-drill') {
    const drill = phase === 'planning-drill';
    return `<div class="phase-card"><h3>${drill ? 'Finding a short pair setup' : 'Preparing a scramble'}</h3>
      <p class="phase-copy">Hold your cube still while cubeee plans the turns.</p>
      <div class="actions"><button class="button ghost" data-action="${drill ? 'full-back' : 'full-cancel'}">Cancel</button></div></div>`;
  }
  if (phase === 'drill-result') {
    const { think, execution, total } = log.timing();
    return `<div class="phase-card"><h3>${step.slots.length === 1 ? 'Pair solved' : 'Pairs solved'}</h3><p class="phase-copy">${step.slots.map(slot => slots[slot]).join(' · ')}</p>
      <p class="your-turns">Your turns <code>${notation(log.moves)}</code> · ${log.moves.length} moves</p>
      ${replayMarkup('full')}
      <div class="split-metrics">${metric('Thinking', time(think), 's')}${metric('Execution', time(execution), 's')}${metric('Total', time(total), 's')}</div>
      ${fullSolutionsMarkup(step)}
      <div class="actions"><button class="button" data-action="full-drill">Try again</button><button class="button secondary" data-action="full-back">Back to breakdown</button></div></div>`;
  }
  if (drillIsSolving()) {
    const { title, description, timerLabel } = drillSolveStatus();
    return `<div class="phase-card" data-timed-pair="${phase}">
      <div class="section-line"><h3>${title}</h3>${solutionToggleMarkup()}</div>
      <p class="phase-copy">${description}</p>
      ${solutionsAreOpen() ? '' : preferredGripMarkup(step)}
      <div class="ready-block"><strong data-full-timer>0.00 s</strong><small>${timerLabel}</small></div>
      ${fullTurnLog(log)}
      ${duringSolveSolutions(() => fullSolutionsMarkup(step))}
      <div class="actions"><button class="button ghost" data-action="full-back">Cancel attempt</button></div></div>`;
  }
  if (fullIsSolving()) {
    return `<div class="phase-card" data-full-solve>
      <h3>${phase === 'ready' ? 'Ready to solve' : 'Solve the cross and F2L'}</h3>
      <p class="phase-copy">The timer starts on your first turn and stops when F2L is complete.</p>
      <div class="ready-block"><strong data-full-timer>0.00 s</strong><small>Cross + F2L time</small></div>
      <div class="split-status"><span>White cross <b data-cross-status>${crossSolved(trainer.cube) ? 'Solved' : 'Open'}</b></span>
        <span>Pairs <b data-pair-count>${slots.filter((_, slot) => slotSolved(trainer.cube, slot)).length} / 4</b></span></div>
      ${fullTargetMarkup()}
      ${full.targetSlot !== null ? `<div class="target-solutions">${solutionToggleMarkup()}</div>
        ${duringSolveSolutions(() => `<p class="phase-copy">These solutions start from the position where you opened the panel.</p>${fullSolutionsMarkup(fullHint)}`)}` : ''}
      ${fullTurnLog(log)}
      <div class="actions"><button class="button ghost" data-action="full-cancel">Cancel attempt</button></div></div>`;
  }
  return `<div class="view-head"><h2>Start a timed solve</h2><p>Use a guided scramble or start from your cube’s current state. Hold white down with green facing you.</p></div>
    <div class="phase-card full-start">${warning}
      <div class="actions"><button class="button" data-action="full-scramble">${icon('Move')} New scramble</button><button class="button secondary" data-action="full-start">Use current cube</button></div>
      ${report ? '<div class="actions"><button class="text-button" data-action="full-back">View last breakdown</button></div>' : ''}
    </div>`;
}

function drillSolveStatus() {
  return full.phase === 'drill-ready'
    ? { title: 'Ready to retry the pair', description: 'Thinking time is running. Your first turn starts execution.', timerLabel: 'Thinking time' }
    : { title: 'Solving the pair', description: 'Insert the pair and restore the cross and earlier pairs.', timerLabel: 'Execution time' };
}

function fullTurnLog(log) {
  return `<p class="your-turns full-turns" data-practice-turns ${log.first ? '' : 'hidden'}>Your turns <code>${notation(log.moves)}</code></p>`;
}

function fullTargetMarkup() {
  return `<div class="target-control" ${full.crossReached ? '' : 'hidden'}>
    <label for="full-target">Target pair</label>
    <div class="select-wrap"><select id="full-target">
      <option value="">Any unsolved pair</option>
      ${slots.map((label, slot) => `<option value="${slot}" ${full.targetSlot === slot ? 'selected' : ''} ${slotSolved(trainer.cube, slot) ? 'disabled' : ''}>${label} · ${pairColors(slot).join(', ')}</option>`).join('')}
    </select>${icon('ChevronDown')}</div></div>`;
}

function fullReviewMarkup(warning) {
  const { report, step, selected } = full;
  const cross = report.steps.find(entry => entry.kind === 'cross');
  return `<div class="view-head"><h2>Solve breakdown</h2><p>Select a pair to see solutions and set it up again.</p></div>
    ${warning}
    <div class="history-summary">${metric('Total time', time(report.total), 's')}${metric('Cross time', time(cross.timing.total), 's')}${metric('Total moves', report.moves.length)}</div>
    ${report.alreadySolved.length ? `<p class="split-note">Already solved at the start: ${report.alreadySolved.map(slot => slots[slot].toLowerCase()).join(', ')}.</p>` : ''}
    <div class="history-scroll"><table class="attempts split-table">
      <thead><tr><th scope="col">Phase</th><th scope="col">Thinking</th><th scope="col">Execution</th><th scope="col">Total</th><th scope="col">Moves</th></tr></thead>
      <tbody>${report.steps.map((entry, index) => {
        const { timing, analysis } = entry;
        const detail = entry.already ? 'Already solved' : entry.slots.map(slot => slots[slot]).join(' · ');
        const phaseTitle = entry.kind === 'cross' && entry.slots.length ? `White cross + ${entry.slots.length}` : entry.title;
        const label = `<strong>${phaseTitle}</strong>${detail ? `<small>${detail}</small>` : ''}`;
        const best = analysis?.solutions[0];
        return `<tr class="${index === selected ? 'selected' : ''}"><th scope="row">
          ${entry.slots.length ? `<button class="text-button split-step" data-step="${index}" aria-pressed="${index === selected}"><span>${label}</span>${icon('ChevronRight')}</button>` : label}
          ${entry.moves.length ? `<code>${notation(entry.moves)}</code>` : ''}
          </th><td>${time(timing.think)} s</td><td>${time(timing.execution)} s</td><td>${time(timing.total)} s</td>
          <td>${entry.moves.length}${best ? `<small>${best.length} ${analysis.optimal ? 'optimal' : 'best found'}</small>` : analysis === null ? '<small>Comparing…</small>' : ''}</td></tr>`;
      }).join('')}</tbody></table></div>
    ${step ? fullStepMarkup(step) : ''}
    <div class="phase-card full-start"><div class="actions"><button class="button" data-action="full-scramble">${icon('Move')} New scramble</button><button class="button secondary" data-action="full-start">Use current cube</button></div></div>`;
}

function fullStepMarkup(step) {
  return `<div class="phase-card split-review">
    <h3>${step.slots.map(slot => slots[slot]).join(' · ')}</h3>
    <p class="your-turns">Your turns <code>${notation(step.moves)}</code> · ${step.moves.length} moves</p>
    ${replayMarkup('full')}
    ${fullSolutionsMarkup(step)}
    <div class="actions"><button class="button" data-action="full-drill">${icon('RotateCcw')} Practice this pair</button></div>
  </div>`;
}

function fullPreferenceKey(step) {
  const pieces = phasePieces([...step.targetSlots].sort());
  return `${[...step.slots].sort().join(',')}|${pieces.map(piece => `${piece}:${pieceState(step.start, piece)}`).join(',')}`;
}

function preferredSolution(context) {
  const isCase = Number.isInteger(context.id);
  const key = isCase ? `case:${context.id}` : `pair:${fullPreferenceKey(context)}`;
  const value = activity.preferences[key];
  const choice = typeof value === 'number' || Array.isArray(value) ? value : value?.choice;
  const valid = isCase ? Number.isInteger(choice) && context.solutions[choice]
    : Array.isArray(choice) && choice.length > 0 && choice.every(move => typeof move === 'string' && /^[URFDLBurfdlbxyz][2']?$/.test(move));
  if (!valid) return { key, choice: undefined, grip: getGrip() };
  return { key, choice: isCase ? choice : simplifyOpeningUTurns(choice), grip: getGrip(value?.grip) };
}

function solutionGrip(context) {
  return gripOverride?.context === context ? gripOverride.grip : preferredSolution(context).grip;
}

function fullSolutions(step) {
  const { analysis } = step;
  const preferred = preferredSolution(step).choice ?? [];
  const preferredText = preferred.join(' ');
  const computed = analysis?.solutions ?? [];
  const guide = step.slots.length === 1 ? cubeSkillsSolutions(step.start, step.end, step.slots[0], step.targetSlots) : [];
  const fromGuide = new Set(guide.map(moves => moves.join(' ')));
  const candidates = new Map([...computed, ...guide].map(moves => [moves.join(' '), moves]));
  const options = [...candidates].map(([text, moves], index) => ({
    moves,
    label: index < computed.length ? (analysis.optimal && moves.length === computed[0].length ? 'Optimal' : index === 0 ? 'Best found' : 'Alternative') : '',
    preferred: text === preferredText,
    cubeSkills: fromGuide.has(text),
  }));
  if (preferred.length && !options.some(option => option.preferred) &&
      matchesPieces(canonicalCube(played(step.start, preferred)), step.end, phasePieces(step.targetSlots))) {
    options.push({ moves: preferred, label: 'Saved', preferred: true });
  }
  return options;
}

function fullSolutionsMarkup(step) {
  const options = fullSolutions(step);
  const grip = solutionGrip(step);
  const notice = options.length ? 'Select a solution to save it as preferred and watch it on the cube.'
    : step.analysis === null ? 'Finding solutions that restore the cross and earlier pairs.' : 'Solution comparison is unavailable for this split.';
  return `<p class="phase-copy">${notice}</p>
    ${options.length ? `${gripMarkup(grip)}<div class="solutions" role="group" aria-label="Suggested solutions">${options.map(({ moves, label, preferred, cubeSkills }, index) => {
      const details = [`${algorithmMoveCount(moves)} moves`, label, cubeSkills && 'CubeSkills', preferred && 'Preferred'].filter(Boolean);
      return `<button class="solution" data-full-solution="${index}" id="full-solution-${index}" aria-pressed="${preview?.context === step && preview.choice === moves.join(' ')}">${icon(preferred ? 'Star' : 'Play')}<code>${gripNotation(moves, grip)}</code><small>${details.join(' · ')}</small></button>`;
    }
    ).join('')}</div>` : ''}
    ${options.some(option => option.cubeSkills) ? cubeSkillsCredit() : ''}
    ${preview?.scope === 'full' ? walkthroughMarkup() : ''}`;
}

function caseRow(item, reps) {
  if (!thumbnails.has(item.id)) thumbnails.set(item.id, caseThumbnail(item.start));
  const thumbnail = thumbnails.get(item.id);
  const count = reps === undefined ? '' : ` · <b class="case-reps">${repCount(reps)}</b>`;
  return `<li><button class="case-item" ${reps === undefined ? 'data-case' : 'data-review-case'}="${item.id}">
    <img class="case-thumbnail" src="${thumbnail.src}" alt="${thumbnail.description}" width="60" height="55" loading="lazy" decoding="async">
    <span><span class="case-number">${number(item.id)}</span><strong>${item.title}</strong><small>${item.detail}${count}</small></span>
    ${categoryBadge(item.category)}${icon('ChevronRight')}</button></li>`;
}

function libraryMarkup() {
  return `<div class="view-head"><h2>Choose a case</h2><p>${filter.items.length} cases · White down · Target pair highlighted</p></div>
    <div class="library-controls" aria-label="Filter cases">${libraryGroups.map(group => `<button class="filter" data-filter="${group.id}" aria-pressed="${filter === group}">${group.label}</button>`).join('')}</div>
    <ol class="case-list" data-group="${filter.id}">${filter.items.map(item => caseRow(item)).join('')}</ol>`;
}

const activePracticeDay = days => days.get(historyDay) ?? days.values().next().value;

function historyMarkup() {
  return `<div class="history-tabs" role="group" aria-label="History view">
    <button id="history-cases-tab" class="filter" data-history-view="cases" aria-pressed="${historyView === 'cases'}">Case practice</button>
    <button id="history-attempts-tab" class="filter" data-history-view="attempts" aria-pressed="${historyView === 'attempts'}">All attempts</button>
    </div>
    ${historyView === 'cases' ? practiceHistoryMarkup() : attemptHistoryMarkup()}
    <div class="history-tools"><p class="history-meta" data-sync-status role="status"></p>
    ${historyView === 'attempts' ? `<div class="actions"><label for="export-days">Export range</label><select id="export-days">
        ${[['7', 'Past 7 days'], ['30', 'Past 30 days'], ['90', 'Past 90 days'], ['all', 'All available']].map(([value, label]) => `<option value="${value}" ${exportDays === value ? 'selected' : ''}>${label}</option>`).join('')}
      </select><button class="button secondary" data-action="export-history">Export JSON</button></div>` : ''}
    </div>`;
}

function practiceHistoryMarkup() {
  const days = practiceDays(activity.attempts);
  const selected = activePracticeDay(days);
  if (!selected) return '<div class="view-head"><h2>Practiced cases</h2><p>Completed F2L practice cases will appear here.</p></div>';

  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const todayKey = today.toDateString();
  const yesterdayKey = yesterday.toDateString();
  return `<div class="view-head"><h2>Practiced cases</h2><p>${caseCount(selected.counts.size)} · ${repCount(selected.reps)} completed${activity.attempts.length === recentLimit ? ` · Based on your latest ${recentLimit} saved attempts` : ''}</p></div>
    <div class="history-day">
      <div class="history-day-field">
        <label for="practice-day">Practice day</label>
        <div class="select-wrap"><select id="practice-day">${[...days.values()].map(day => {
          const prefix = day.key === todayKey ? 'Today · ' : day.key === yesterdayKey ? 'Yesterday · ' : '';
          return `<option value="${day.key}" ${day === selected ? 'selected' : ''}>${prefix}${historyDate.format(day.date)}</option>`;
        }).join('')}</select>${icon('ChevronDown')}</div>
      </div>
      <button class="button" data-action="review-day">${icon('RotateCcw')} ${selected.counts.size === 1 ? 'Practice this case' : 'Practice these cases'}</button>
    </div>
    <ol class="case-list practice-history-list" data-group="${selected.key}" aria-label="Cases practiced that day">${[...selected.counts].map(([item, reps]) => caseRow(item, reps)).join('')}</ol>`;
}

function attemptHistoryMarkup() {
  const counts = { practice: 0, full: 0, drill: 0 };
  for (const { kind } of activity.attempts) counts[kind]++;
  return `<div class="view-head"><h2>Attempts</h2><p>Showing up to ${recentLimit} recent attempts. ${activity.user ? 'Export a date range for analysis.' : 'Sign in to save future attempts across computers.'}</p></div>
    <div class="history-summary">${metric('F2L practice', counts.practice)}${metric('Cross + F2L', counts.full)}${metric('Pair retries', counts.drill)}</div>
    <div class="history-body">${attemptTable(activity.attempts, true)}</div>`;
}

function reviewPracticeDay(caseId) {
  const selected = activePracticeDay(practiceDays(activity.attempts));
  if (!selected) return;
  const items = [...selected.counts.keys()];
  const item = items.find(item => item.id === caseId) ?? items[0];
  order.review(items, item);
  select(item);
}

function attemptTable(attempts, dates = false) {
  return `<div class="history-scroll"><table class="attempts"><thead><tr><th>Attempt</th>${dates ? '<th>Date</th>' : '<th>Result</th>'}<th>Thinking</th><th>Execution</th>${dates ? '<th>Total</th>' : ''}<th>Moves</th></tr></thead><tbody>
    ${attempts.length ? attempts.map(result => {
      const item = cases[result.caseId - 1];
      const fullSolve = result.kind === 'full' && /^[\da-f-]{36}$/.test(result.id);
      const name = item ? `<button class="text-button case-link" data-case="${item.id}">${number(item.id)} · ${item.title}</button>`
        : fullSolve ? `<button class="text-button case-link" data-report="${result.id}">Cross + F2L ${icon('ChevronRight')}</button>`
          : `Pair retry · ${result.slots?.map(slot => slots[slot]).join(' + ') ?? ''}`;
      return `<tr><td>${name}${result.assisted ? '<small class="attempt-note">Hints used</small>' : ''}</td>
        <td>${dates ? new Date(result.time).toLocaleDateString() : 'Solved'}</td><td>${time(result.think)} s</td><td>${time(result.execution)} s</td>
        ${dates ? `<td>${time(result.total)} s</td>` : ''}<td>${Number(result.moves)}</td></tr>`;
    }).join('') : `<tr><td class="empty" colspan="${dates ? 6 : 5}">Completed attempts will appear here.</td></tr>`}
  </tbody></table></div>`;
}

function renderRecent() {
  const recent = $('#recent-panel');
  recent.innerHTML = `<div class="panel-heading"><div class="heading-with-icon">${icon('History')}<h2 id="recent-title">Recent attempts</h2></div><button class="text-button" data-view="history">View history ${icon('ArrowRight')}</button></div>${attemptTable(activity.attempts.slice(0, 4))}`;
  hydrate(recent);
}

function showNotice(message) {
  const notice = $('#notice');
  notice.textContent = message;
  notice.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice.hidden = true; }, 7200);
}

function openDialog(title, content) {
  if (dialog.open) dialog.close();
  dialog.innerHTML = `<div class="dialog-head"><h2 id="dialog-title">${title}</h2><button class="icon-button" data-action="close" aria-label="Close dialog">${icon('X')}</button></div>${content}`;
  hydrate(dialog);
  dialog.showModal();
}

function renderAccount() {
  const button = $('#account-button');
  button.disabled = accountBusy || !activity.cloud;
  $('#account-label').textContent = activity.user ? 'Account' : 'Sign in';
  button.setAttribute('aria-label', activity.user ? 'Open account' : 'Sign in with Google');
  button.title = activity.user ? 'Account' : 'Sign in with Google';
  document.querySelectorAll('[data-sync-status]').forEach(node => { node.textContent = activity.status; });
}

function activityChanged({ attempts, preferences, account }) {
  if (account) {
    gripOverride = undefined;
    historyDay = undefined;
    if (order.mode === 'review') order.reset(activity.preferences.order, trainer.item);
    clearPreview();
    clearFullHint();
    full.clearReport();
    if (mode === 'practice' && trainer.phase === 'results') startPractice(trainer.item);
    sessionCount = 0;
    full.completed = 0;
    if ($('#account-email') && dialog.open) dialog.close();
    renderSessionCount();
    renderTargetGuide();
  }
  if (preferences && order.mode !== 'review') {
    const mode = activity.preferences.order ?? 'ordered';
    if (order.mode !== mode) order.reset(mode, trainer.item);
  }
  if (attempts) renderRecent();
  if ((attempts && page === 'history') || (preferences && (page === 'practice' || page === 'full'))) renderWork();
  renderAccount();
}

async function accountAction() {
  if (activity.user) {
    openDialog('Your account', `<p id="account-email"></p><p data-sync-status role="status"></p>
      <div class="actions"><button class="button secondary" data-action="sign-out">Sign out</button><button class="button ghost" data-action="close">Done</button></div>`);
    $('#account-email').textContent = activity.user.email ?? activity.user.displayName ?? 'Signed in with Google';
    renderAccount();
    return;
  }
  accountBusy = true;
  renderAccount();
  try {
    await activity.cloud.signIn();
  } catch (error) {
    if (error.code === 'auth/popup-blocked') showNotice('Allow pop-ups for this site to sign in with Google.');
    else if (error.code !== 'auth/popup-closed-by-user' && error.code !== 'auth/cancelled-popup-request') showNotice('Google sign-in could not complete. Try again.');
  } finally {
    accountBusy = false;
    renderAccount();
  }
}

async function exportHistory() {
  const since = exportDays === 'all' ? 0 : Date.now() - Number(exportDays) * 86400000;
  try {
    const output = await activity.exportSince(since);
    const url = URL.createObjectURL(new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' }));
    const download = document.createElement('a');
    download.href = url;
    download.download = `cubeee-history-${output.exportedAt.slice(0, 10)}.json`;
    download.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    showNotice('Could not export your history. Check your connection and try again.');
  }
}

function openSavedReport(id) {
  const attempt = activity.attempts.find(item => item.id === id && item.kind === 'full');
  if (!attempt) return;
  try {
    const report = restoreReport(attempt);
    clearPreview();
    clearFullHint();
    full.interrupt();
    go('full');
    full.review(report);
    renderTargetGuide();
  } catch {
    showNotice('Could not open this saved solve.');
  }
}

function askAddress(deviceName) {
  openDialog('Enter your cube’s Bluetooth address', `<form id="mac-form"><p id="mac-device"></p><p>Find the Bluetooth MAC address in CubeStation’s device details, then disconnect the cube from CubeStation before pairing here.</p><label>Bluetooth MAC address<input name="mac" placeholder="AA:BB:CC:DD:EE:FF" required autocomplete="off" autofocus></label><div class="actions"><button type="submit" class="button">Pair cube</button><button type="button" class="button ghost" data-action="close">Cancel</button></div></form>`);
  $('#mac-device').textContent = `Selected device: ${deviceName}`;
  return new Promise(resolve => { addressRequest = resolve; });
}

function showHelp() {
  openDialog('Cube controls', `<p>Hold the training cube with white down and green facing you. Keep this orientation as you follow the setup.</p><ul>
    <li>To wake the GAN i4, turn its white face. Open this site in Chrome or Edge and choose <strong>Connect GAN i4</strong>.</li>
    <li>Choose <strong>Virtual cube</strong> in F2L Practice to load each case on screen. Watch the screen and use your connected cube to turn.</li>
    <li>With the GAN disconnected, press U, R, F, D, L, or B to turn a face. Hold Shift for a counterclockwise turn or Alt for a half turn. Use Enter to apply the next guided turn.</li>
    <li>Drag either cube to see its other faces.</li>
    <li>In Cross + F2L, the solve starts on the first turn. For each pair, thinking runs from the previous split to your next turn. Two consecutive quarter turns in the same direction count as one half turn.</li>
    </ul><div class="actions"><button class="button secondary" data-action="close">Done</button></div>`);
}

function stopPreview() {
  clearInterval(previewTimer);
  previewTimer = undefined;
}

function clearPreview() {
  stopPreview();
  preview = null;
}

function clearFullHint() {
  if (revealedAttempt === fullHint) revealedAttempt = undefined;
  fullHint = undefined;
  if (preview?.hint) clearPreview();
}

async function showFullHint() {
  full.log.assisted = true;
  const slot = full.targetSlot;
  const start = trainer.cube.clone();
  const preserve = slots.map((_, index) => index).filter(index => index !== slot && slotSolved(start, index));
  const hint = { log: full.log, start, end: solved, slots: [slot], targetSlots: [slot, ...preserve], analysis: null };
  fullHint = hint;
  revealedAttempt = hint;
  renderWork();
  hint.analysis = await planPair(hint.start, hint.end, hint.targetSlots).catch(() => undefined) ?? { solutions: [], optimal: false };
  if (fullHint === hint && page === 'full' && fullIsSolving()) renderWork();
}

function select(item) {
  clearPreview();
  gripOverride = undefined;
  const needsPracticeMode = mode !== 'practice';
  if (page !== 'practice') go('practice', item);
  if (!needsPracticeMode) startPractice(item);
}

function startPractice(item) {
  const virtual = trainer === virtualTrainer;
  practiceGestureTurn = undefined;
  virtualPracticeIssue = '';
  trainer.select(item, { virtual });
  if (virtual && bluetooth.awaitingState) interruptVirtualPractice(missedPracticeTurn);
}

function nextPracticeCase() {
  select(order.next(trainer.item));
}

function handlePracticeGesture(move, local, device) {
  const previous = practiceGestureTurn;
  practiceGestureTurn = undefined;
  const face = turnFace(move);
  if (page !== 'practice' || !['U', 'L', 'R'].includes(face)) return false;

  // The GAN can report a half turn as two quarter turns.
  if (trainer.phase === 'ready' && previous?.move === move && elapsedBetween(previous, { local, device }) <= halfTurnWindow) return true;
  if (trainer.phase !== 'results') return false;

  if (face === 'U') select(trainer.item);
  else nextPracticeCase();
  if (move[1] !== '2') practiceGestureTurn = { move, local, device };
  return true;
}

function updatePreview(transition) {
  if (!demo || !preview) return;
  const { index, moves } = preview;
  const grip = demoGrip;
  const next = moves[index] && gripMove(moves[index], grip);
  const cube = played(preview.start, [...moves.slice(0, index), ...grip.rotation]);
  const animation = transition && { before: played(transition.before, grip.rotation), move: gripMove(transition.move, grip) };
  demo.show(cube, next, animation);
  const face = turnFace(next);
  const moveScope = !next ? '' : isCubeRotation(next) ? 'whole cube'
    : face !== next[0] ? `${faceNames[face]} two layers` : stickerNames[faces[cube.center[faces.indexOf(face)]]];
  $('#demo-progress').textContent = next ? `${index} / ${moves.length} · Next ${showMove(next)} (${moveScope})`
    : `Complete · ${algorithmMoveCount(moves)} turns`;
  $('[data-action="demo-back"]').disabled = index === 0;
  $('[data-action="demo-forward"]').disabled = index === moves.length;
  const play = $('#demo-play');
  play.setAttribute('aria-label', previewTimer ? 'Pause walkthrough' : 'Play walkthrough');
  play.innerHTML = icon(previewTimer ? 'Pause' : 'Play');
  hydrate(play);
}

function playPreview() {
  if (previewTimer) {
    stopPreview();
    updatePreview();
    return;
  }
  if (preview.index === preview.moves.length) preview.index = 0;
  previewTimer = setInterval(() => {
    const before = played(preview.start, preview.moves.slice(0, preview.index));
    const move = preview.moves[preview.index++];
    if (preview.index === preview.moves.length) stopPreview();
    updatePreview({ before, move });
  }, 570);
  updatePreview();
}

function chooseSolution(index, remember = true) {
  const item = trainer.item;
  if (remember) saveSolution(item, index, solutionGrip(item));
  openPreview('practice', trainer.caseStart, trainer.item.solutions[index], index, [0]);
}

function chooseFullSolution(index, remember = true) {
  const hint = fullIsSolving();
  const step = hint ? fullHint : full.step;
  const { moves } = fullSolutions(step)[index];
  if (remember) saveSolution(step, moves, solutionGrip(step));
  const start = hint || full.phase === 'review' ? step.start : full.log.start;
  openPreview('full', start, moves, moves.join(' '), step.slots, hint);
}

function solutionContext() {
  return page === 'practice' ? trainer.item : fullIsSolving() ? fullHint : full.step;
}

function saveSolution(context, choice, grip) {
  const { key } = preferredSolution(context);
  activity.setPreference(key, { choice, grip: grip.id });
}

function chooseGrip(id) {
  const context = solutionContext();
  const grip = getGrip(id);
  if (!context) return;
  if (grip === solutionGrip(context) && preview?.context === context) {
    demo?.focusFace('F');
    return;
  }
  gripOverride = { context, grip };
  const preferred = preferredSolution(context);
  if (preferred.choice !== undefined && preferred.grip !== grip) saveSolution(context, preferred.choice, grip);
  if (preview?.context === context) {
    stopPreview();
    renderWork();
  } else if (page === 'practice') {
    chooseSolution(preferred.choice ?? 0, false);
  } else {
    const options = fullSolutions(context);
    if (options.length) chooseFullSolution(Math.max(0, options.findIndex(option => option.preferred)), false);
    else renderWork();
  }
}

function replayAttempt() {
  if (page === 'practice') {
    openPreview('practice', trainer.caseStart, trainer.result.sequence, 'attempt', [0]);
  } else {
    const { step } = full;
    const { start, moves } = full.phase === 'review' ? step : full.log;
    openPreview('full', start, moves, 'attempt', step.slots);
  }
}

function openPreview(scope, start, moves, choice, targets, hint = false) {
  stopPreview();
  preview = { scope, context: solutionContext(), start, moves, choice, targets, hint, index: 0 };
  renderWork();
}

const action = {
  camera: () => live.focusFace(trainer.expected?.[0]),
  'find-pair': () => live.focusTargets(),
  help: showHelp,
  account: accountAction,
  'sign-out': () => activity.cloud.signOut().catch(() => showNotice('Could not sign out. Try again.')),
  'export-history': exportHistory,
  'review-day': () => reviewPracticeDay(),
  'end-review': () => {
    order.reset(activity.preferences.order, trainer.item);
    renderWork();
    $('#practice-order').focus({ preventScroll: true });
  },
  close: () => dialog.close(),
  browse: () => go('library'),
  next: nextPracticeCase,
  previous: () => select(order.previous(trainer.item)),
  retry: () => select(trainer.item),
  'virtual-practice': () => {
    const item = trainer.item;
    trainer.free();
    practiceTrainer = trainer === virtualTrainer ? physicalTrainer : virtualTrainer;
    trainer = practiceTrainer;
    renderConnection();
    select(item);
  },
  'replay-attempt': replayAttempt,
  'show-solutions': () => {
    if (page === 'full' && fullIsSolving()) {
      if (!solutionsAreOpen()) {
        showFullHint();
        return;
      }
      clearFullHint();
      renderWork();
      return;
    }
    if (solutionsAreOpen()) {
      revealedAttempt = undefined;
      clearPreview();
    } else {
      revealedAttempt = solutionAttempt();
      const log = page === 'practice' ? trainer.solveLog : full.log;
      if (log) log.assisted = true;
    }
    renderWork();
  },
  apply: () => {
    if (bluetooth.status !== 'connected' && trainer.expected) trainer.turn(trainer.expected);
  },
  'apply-all': () => {
    if (bluetooth.status === 'connected') return;
    const limit = trainer.route.length + trainer.mistakes.length + 1;
    for (let i = 0; trainer.expected && i < limit; i++) trainer.turn(trainer.expected);
  },
  'full-scramble': () => { clearPreview(); clearFullHint(); full.scramble(); },
  'full-start': () => { clearPreview(); clearFullHint(); full.startCurrent(); },
  'full-cancel': () => { clearPreview(); clearFullHint(); full.interrupt(); update(); },
  'full-back': () => { clearPreview(); full.backToReview(); update(); },
  'full-drill': () => { clearPreview(); full.drill(); },
  connect: () => {
    if (bluetooth.status === 'connected') {
      openDialog('GAN i4 connected', `<p id="device-name"></p><div class="actions"><button class="button secondary" data-action="resync">${icon('RefreshCw')} Sync state</button><button class="button ghost" data-action="disconnect">Disconnect</button></div>`);
      $('#device-name').textContent = bluetooth.name;
    } else {
      bluetooth.connect();
    }
  },
  disconnect: () => {
    bluetooth.disconnect();
    dialog.close();
    resetAfterDisconnect();
  },
  resync: () => {
    if (dialog.open) dialog.close();
    bluetooth.resync().then(() => showNotice('Cube state synced.')).catch(error => showNotice(error.message));
  },
  'demo-play': playPreview,
  'demo-reset': () => { stopPreview(); preview.index = 0; updatePreview(); },
  'demo-back': () => { stopPreview(); preview.index--; updatePreview(); },
  'demo-forward': () => {
    stopPreview();
    const before = played(preview.start, preview.moves.slice(0, preview.index));
    const move = preview.moves[preview.index++];
    updatePreview({ before, move });
  },
};

document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  const { view, turn, modifier: nextModifier, action: command, filter: nextFilter, case: caseId, solution, step, fullSolution, report, historyView: nextHistoryView, reviewCase, grip } = button.dataset;
  if (view) {
    stopPreview();
    go(view);
  } else if (turn && bluetooth.status !== 'connected') {
    trainer.turn(turn + modifier);
    setModifier('');
  } else if (nextModifier) {
    const flag = nextModifier === 'prime' ? "'" : '2';
    setModifier(modifier === flag ? '' : flag);
  } else if (command) action[command]?.();
  else if (nextHistoryView) {
    if (historyView !== nextHistoryView) {
      historyView = nextHistoryView;
      renderWork();
    }
  } else if (grip) chooseGrip(grip);
  else if (reviewCase) reviewPracticeDay(Number(reviewCase));
  else if (nextFilter) {
    const group = libraryGroups.find(item => item.id === nextFilter);
    if (group && group !== filter) { filter = group; renderWork(); }
  } else if (caseId) {
    const item = cases[Number(caseId) - 1];
    order.reset(order.mode === 'review' ? activity.preferences.order : order.mode, item);
    select(item);
  } else if (report) openSavedReport(report);
  else if (solution !== undefined) chooseSolution(Number(solution));
  else if (step !== undefined) {
    clearPreview();
    full.showStep(Number(step));
    $('.split-review')?.scrollIntoView({ block: 'nearest' });
  } else if (fullSolution !== undefined) chooseFullSolution(Number(fullSolution));
});

document.addEventListener('change', event => {
  if (event.target.id === 'grip-top') {
    const top = event.target.value;
    const allowed = frontColors(top);
    const { front } = solutionGrip(solutionContext());
    chooseGrip(top + (allowed.includes(front) ? front : allowed[0]));
    return;
  }
  if (event.target.id === 'export-days') exportDays = event.target.value;
  if (event.target.id === 'practice-day') {
    historyDay = event.target.value;
    renderWork();
    return;
  }
  if (event.target.id === 'full-target') {
    clearFullHint();
    full.targetSlot = event.target.value === '' ? null : Number(event.target.value);
    renderWork();
    return;
  }
  if (event.target.id !== 'practice-order' || event.target.value === 'review') return;
  order.reset(event.target.value);
  activity.setPreference('order', order.mode);
  if (order.group) select(order.next(trainer.item));
  else renderWork();
  $('#practice-order')?.focus({ preventScroll: true });
});

document.addEventListener('keydown', event => {
  if (dialog.open || bluetooth.status === 'connected' || event.repeat || event.ctrlKey || event.metaKey || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;
  const key = event.key.toUpperCase();
  if (/^[URFDLB]$/.test(key)) {
    event.preventDefault();
    trainer.turn(key + (event.altKey ? '2' : event.shiftKey ? "'" : modifier));
    setModifier('');
  } else if (event.key === 'Enter' && (page === 'practice' || page === 'full') && event.target.tagName !== 'BUTTON') {
    action.apply();
  }
});

dialog.addEventListener('submit', event => {
  if (event.target.id !== 'mac-form') return;
  event.preventDefault();
  const input = event.target.elements.mac;
  const value = normalizeAddress(input.value);
  if (!value) {
    input.setCustomValidity('Enter a valid 12-digit Bluetooth MAC address.');
    input.reportValidity();
    return;
  }
  const resolve = addressRequest;
  addressRequest = null;
  dialog.close();
  resolve?.(value);
});
dialog.addEventListener('input', event => event.target.setCustomValidity?.(''));
dialog.addEventListener('close', () => {
  addressRequest?.(null);
  addressRequest = null;
});

function tick() {
  const fullTimer = $('[data-full-timer]');
  if (fullTimer && full.log) {
    const start = full.log.first ?? full.log.readyAt;
    fullTimer.textContent = `${time(start ? Math.max(0, performance.now() - start.local) : 0)} s`;
  }
  const timer = $('[data-timer]');
  if (!timer || !['ready', 'solving'].includes(trainer.phase)) return;
  const thinking = trainer.phase === 'ready';
  const delta = Math.max(0, performance.now() - (thinking ? trainer.readyAt : trainer.first.local));
  timer.textContent = `${time(delta)} s`;
  const thinkingValue = thinking ? time(delta) : time(Math.max(0, trainer.first.local - trainer.readyAt));
  $('[data-metric="thinking"]').innerHTML = `${thinkingValue}<span>s</span>`;
  if (!thinking) $('[data-metric="execution"]').innerHTML = `${time(delta)}<span>s</span>`;
}

setInterval(tick, 33);
hydrate();
renderConnection();
renderRecent();
startPractice(order.group ? order.next() : cases[0]);
const accountReady = activity.connect(firebaseConfig);
