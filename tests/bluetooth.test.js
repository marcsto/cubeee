import assert from 'node:assert/strict';
import test from 'node:test';
import { BluetoothCube } from '../src/bluetooth.js';
import { ganState, solved } from '../src/cube.js';

async function connectCube(t) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  Object.defineProperty(navigator, 'bluetooth', { value: {}, configurable: true });
  t.after(() => { delete navigator.bluetooth; });
  const device = { state: solved.clone().move('B R U'), serial: 24, acceptsReset: true };
  const commands = [];
  let emit;
  const connection = {
    events$: { subscribe(handler) { emit = handler; return { unsubscribe() { emit = undefined; } }; } },
    async sendCubeCommand({ type }) {
      commands.push(type);
      if (type === 'REQUEST_RESET' && device.acceptsReset) device.state = solved.clone();
      if (type === 'REQUEST_FACELETS') emit({ type: 'FACELETS', facelets: device.state.asString(), serial: device.serial });
    },
    async disconnect() {},
  };
  const cube = new BluetoothCube(async () => connection, {
    sync(state) { device.displayed = state.clone(); },
    turn(move) { device.displayed.move(move); },
    change() {}, disconnect() {}, error() {},
  });
  await cube.connect();
  t.after(() => cube.disconnect());
  const turn = move => {
    device.state.move(move);
    emit({ type: 'MOVE', move, serial: ++device.serial });
  };
  return { cube, device, commands, turn };
}

test('sync reads the GAN, solved calibration corrects its baseline, and turns stay aligned', async t => {
  const { cube, device, commands, turn } = await connectCube(t);
  assert.equal((await cube.resync()).isSolved(), false);
  assert.equal(commands.includes('REQUEST_RESET'), false);
  assert.equal((await cube.resync({ resetToSolved: true })).isSolved(), true);
  assert.deepEqual(commands.slice(-2), ['REQUEST_RESET', 'REQUEST_FACELETS']);
  assert.equal(device.displayed.isSolved(), true);
  for (const move of ['R', 'D', "F'", 'U', 'L', 'B']) {
    turn(move);
    assert.equal(device.displayed.asString(), ganState(device.state.asString()).asString());
  }
  assert.equal((await cube.resync()).asString(), device.displayed.asString());
});

test('calibration requires the GAN to report solved and permits a retry', async t => {
  const { cube, device } = await connectCube(t);
  device.acceptsReset = false;
  const calibration = cube.resync({ resetToSolved: true });
  await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.tick(6000);
  await assert.rejects(calibration, /did not confirm a solved state/);
  assert.equal(device.displayed.isSolved(), false);
  device.acceptsReset = true;
  assert.equal((await cube.resync({ resetToSolved: true })).isSolved(), true);
});

test('each physical turn starts a new one-hour idle timeout', async t => {
  const { cube, turn } = await connectCube(t);
  t.mock.timers.tick(59 * 60_000);
  assert.equal(cube.status, 'connected');
  turn('F');
  t.mock.timers.tick(60 * 60_000 - 1);
  assert.equal(cube.status, 'connected');
  t.mock.timers.tick(1);
  assert.equal(cube.status, 'disconnected');
});
