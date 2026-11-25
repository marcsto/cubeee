import assert from 'node:assert/strict';
import test from 'node:test';
import { BluetoothCube } from '../src/bluetooth.js';
import { ganState, solved } from '../src/cube.js';

async function connectCube(t, adapter = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  Object.defineProperty(navigator, 'bluetooth', { value: adapter, configurable: true });
  t.after(() => { delete navigator.bluetooth; });
  const device = Object.assign(new EventTarget(), { name: 'GAN i4', id: 'paired', state: solved.clone().move('B R U'), serial: 24, acceptsReset: true });
  const selections = [];
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
  const cube = new BluetoothCube(async (address, permitted) => {
    selections.push(permitted);
    await address(permitted ?? device);
    return connection;
  }, {
    sync(state) { device.displayed = state.clone(); },
    turn(move) { device.displayed.move(move); },
    change() {}, disconnect() {}, error() {}, async addressStore() {},
  });
  await cube.connect();
  t.after(() => cube.disconnect());
  const turn = move => {
    device.state.move(move);
    emit({ type: 'MOVE', move, serial: ++device.serial });
  };
  return { cube, device, commands, turn, selections, drop: () => emit({ type: 'DISCONNECT' }) };
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

test('each physical turn starts a new 15-minute idle timeout', async t => {
  const { cube, turn } = await connectCube(t);
  t.mock.timers.tick(14 * 60_000);
  assert.equal(cube.status, 'connected');
  turn('F');
  t.mock.timers.tick(15 * 60_000 - 1);
  assert.equal(cube.status, 'connected');
  t.mock.timers.tick(1);
  assert.equal(cube.status, 'disconnected');
});

test('a tab can reconnect directly without getDevices, and can explicitly open the picker', async t => {
  const { cube, device, selections, drop } = await connectCube(t);
  drop();
  await cube.connect();
  assert.deepEqual(selections, [undefined, device]);
  await cube.disconnect();
  await cube.connect({ pick: true });
  assert.equal(selections[2], undefined);
  assert.equal(cube.status, 'connected');
});

test('restore the preferred cube, reconnect once on advertisement, and respect intentional disconnects', async t => {
  const adapter = {};
  const { cube, device, selections, drop } = await connectCube(t, adapter);
  const other = { name: 'GAN i4', id: 'other' };
  adapter.getDevices = async () => [other, device];
  let signal;
  device.watchAdvertisements = async options => { signal = options.signal; };
  drop();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(signal.aborted, false);
  const advertise = () => device.dispatchEvent(new Event('advertisementreceived'));
  advertise();
  advertise();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(signal.aborted, true);
  assert.deepEqual(selections, [undefined, device]);
  assert.equal(cube.status, 'connected');
  t.mock.timers.tick(15 * 60_000);
  await new Promise(resolve => setImmediate(resolve));
  advertise();
  assert.equal(cube.status, 'disconnected');
  assert.equal(selections.length, 2);
  await cube.connect();
  await cube.disconnect();
  advertise();
  assert.equal(selections.length, 3);
});

test('a denied advertisement watch leaves manual reconnect available, and revoked permission releases the cache', async t => {
  const adapter = {};
  const { cube, device, selections, drop } = await connectCube(t, adapter);
  adapter.getDevices = async () => [device];
  device.watchAdvertisements = async () => { throw new Error('unavailable'); };
  drop();
  await new Promise(resolve => setImmediate(resolve));
  device.dispatchEvent(new Event('advertisementreceived'));
  assert.equal(selections.length, 1);
  await cube.connect();
  assert.equal(selections[1], device);
  adapter.getDevices = async () => [];
  await cube.disconnect();
  assert.equal(cube.cachedDevice, undefined);
});

test('a freshly loaded tab resumes its permitted cube by ID before it advertises', async t => {
  const values = new Map();
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
    getItem: key => values.get(key),
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  } });
  t.after(() => { delete globalThis.sessionStorage; });
  const adapter = {};
  const { cube, device, selections } = await connectCube(t, adapter);
  cube.suspend();
  const restored = new BluetoothCube(cube.connectGanCube, cube.callbacks);
  t.after(() => restored.disconnect());
  const permitted = { id: device.id };
  adapter.getDevices = async () => [{ id: 'other', name: 'GAN i4' }, permitted];
  await restored.prepareReconnect();
  assert.equal(restored.status, 'connected');
  assert.deepEqual(selections, [undefined, permitted]);
  await restored.disconnect();
  restored.suspend();
  assert.equal(values.size, 0);
});

test('a failed reload attempt can retry on wake and never opens the picker', async t => {
  const adapter = {};
  const { cube, device } = await connectCube(t, adapter);
  await cube.disconnect();
  adapter.getDevices = async () => [device];
  let watchCount = 0;
  device.watchAdvertisements = async () => { watchCount++; };
  const attempts = [];
  const restored = new BluetoothCube(async (address, permitted) => {
    attempts.push(permitted);
    if (attempts.length === 1) throw new Error('Cube is asleep');
    return cube.connectGanCube(address, permitted);
  }, cube.callbacks);
  t.after(() => restored.disconnect());
  restored.resumeId = device.id;
  await restored.prepareReconnect();
  assert.equal(restored.status, 'disconnected');
  assert.equal(watchCount, 1);
  device.dispatchEvent(new Event('advertisementreceived'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(restored.status, 'connected');
  assert.deepEqual(attempts, [device, device]);
});
