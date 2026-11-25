import { ganMove, ganOrientation, ganState, validFacelets } from './cube.js';

const batteryKey = 'cubeee:lastBattery';
const idleTimeout = 60 * 60_000;
const batteryRefresh = 60_000;
const batteryRetry = 5000;
const validLevel = level => Number.isInteger(level) && level >= 0 && level <= 100;

export function normalizeAddress(value) {
  if (typeof value !== 'string') return '';
  const compact = value.trim().replace(/[:\s-]/g, '');
  return /^[\da-f]{12}$/i.test(compact) ? compact.toUpperCase().match(/../g).join(':') : '';
}

async function readSavedAddress(store) {
  if (!store) return '';
  let timer;
  try {
    const address = await Promise.race([
      store.then(account => account?.read()),
      new Promise(resolve => { timer = setTimeout(resolve, 3000); }),
    ]);
    return normalizeAddress(address);
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

export class BluetoothCube {
  status = 'disconnected';
  retryAddressFor = new Set();

  constructor(connectGanCube, callbacks) {
    this.connectGanCube = connectGanCube;
    this.callbacks = callbacks;
    try {
      const saved = JSON.parse(localStorage.getItem(batteryKey));
      if (saved?.deviceId && validLevel(saved.level)) this.lastBattery = saved;
    } catch { /* Storage can be disabled. */ }
  }

  get batteryLabel() {
    if (validLevel(this.battery)) return `Battery ${this.battery}%`;
    if (this.lastBattery) return `${this.lastBattery.level}% last seen`;
    return 'Battery —';
  }

  get awaitingState() { return this.status === 'connected' && this.lastSerial === null; }

  async connect() {
    if (this.status !== 'disconnected') return;
    if (!navigator.bluetooth) {
      this.callbacks.error('Web Bluetooth is unavailable here. Open cubeee in Chrome or Edge with Bluetooth enabled.');
      return;
    }
    this.status = 'connecting';
    this.callbacks.change();
    let deviceId, account, accountAddress, usedSavedAddress;
    try {
      this.conn = await this.connectGanCube(async (device, fallback) => {
        if (fallback) return this.callbacks.address(device.name ?? 'GAN i4');
        deviceId = device.id;
        if (device.name) account = this.callbacks.addressStore(device.name).catch(() => undefined);
        if (this.retryAddressFor.has(deviceId)) return null;
        let cached;
        try { cached = normalizeAddress(localStorage.getItem(`cubeee:mac:${deviceId}`)); } catch { /* Storage can be disabled. */ }
        if (!cached) accountAddress = await readSavedAddress(account);
        const saved = cached || accountAddress;
        usedSavedAddress = Boolean(saved);
        return saved || null;
      });
      const connection = this.conn;
      this.name = connection.deviceName || 'GAN i4';
      this.deviceId = deviceId;
      if (this.lastBattery && this.lastBattery.deviceId !== deviceId) {
        this.lastBattery = undefined;
        try { localStorage.removeItem(batteryKey); } catch { /* Storage can be disabled. */ }
        this.callbacks.change();
      }
      this.sub = connection.events$.subscribe(event => this.handle(event));
      await this.resync();
      if (this.conn !== connection) return;

      this.retryAddressFor.delete(deviceId);
      const address = normalizeAddress(connection.deviceMAC);
      if (address) {
        try { localStorage.setItem(`cubeee:mac:${deviceId}`, address); } catch { /* Storage can be disabled. */ }
        if (address !== accountAddress) {
          account?.then(store => store?.save(address))
            .catch(() => this.callbacks.error('The cube is connected. Its Bluetooth address could not sync to your account.'));
        }
      }
      this.requestBattery();
      this.batteryRetryTimer = setTimeout(() => {
        if (this.battery === undefined) this.requestBattery();
      }, batteryRetry);
    } catch (error) {
      const retryAddress = this.conn && usedSavedAddress && error.name === 'TimeoutError';
      if (retryAddress) {
        this.retryAddressFor.add(deviceId);
        try { localStorage.removeItem(`cubeee:mac:${deviceId}`); } catch { /* Storage can be disabled. */ }
      }
      await this.disconnect();
      if (retryAddress) this.callbacks.error('The cube did not respond with the saved address. Wake it and reconnect to try a fresh address.');
      else if (error.name !== 'NotFoundError') this.callbacks.error(error.message || 'Could not connect to the GAN cube.');
    }
  }

  async resync({ resetToSolved = false } = {}) {
    if (!this.conn) throw new Error('Connect the cube before syncing its state.');
    if (resetToSolved && this.syncing) throw new Error('A sync is in progress. Try calibration again when it finishes.');
    if (this.syncing) return this.syncing;
    this.syncing = this.requestState(this.conn, resetToSolved);
    try {
      return await this.syncing;
    } finally {
      this.syncing = null;
    }
  }

  requestBattery() {
    if (!this.conn || this.syncing || this.batteryRequest) return;
    this.nextBatteryRequest = Date.now() + (this.battery === undefined ? batteryRetry : batteryRefresh);
    const request = this.conn.sendCubeCommand({ type: 'REQUEST_BATTERY' });
    this.batteryRequest = request;
    request.catch(() => {}).finally(() => {
      if (this.batteryRequest === request) this.batteryRequest = null;
    });
  }

  resetIdleTimer() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.disconnect();
      this.callbacks.disconnect();
      this.callbacks.error('Cube disconnected after 1 hour without a turn. Reconnect when you’re ready.');
    }, idleTimeout);
  }

  async requestState(connection, resetToSolved) {
    if (this.batteryRequest) await this.batteryRequest.catch(() => {});
    if (connection !== this.conn) throw new Error('Bluetooth connection closed.');
    if (resetToSolved) {
      await connection.sendCubeCommand({ type: 'REQUEST_RESET' });
      if (connection !== this.conn) throw new Error('Bluetooth connection closed.');
    }
    let timer;
    const response = new Promise((resolve, reject) => {
      const timeoutMessage = resetToSolved
        ? 'The cube did not confirm a solved state. Keep it still and try calibration again.'
        : 'No valid state received. Wake the cube and check its Bluetooth MAC address.';
      timer = setTimeout(() => reject(new DOMException(timeoutMessage, 'TimeoutError')), 6000);
      this.waiting = (error, cube) => {
        if (error) reject(error);
        else if (!resetToSolved || cube.isSolved()) resolve(cube);
      };
    });
    try {
      const [cube] = await Promise.all([response, connection.sendCubeCommand({ type: 'REQUEST_FACELETS' })]);
      return cube;
    } finally {
      clearTimeout(timer);
      this.waiting = null;
    }
  }

  handle(event) {
    if (event.type === 'DISCONNECT') {
      this.disconnect(false);
      this.callbacks.disconnect();
      this.callbacks.error('Cube disconnected. Reconnect to continue tracking your GAN.');
    } else if (event.type === 'FACELETS' && validFacelets(event.facelets)) {
      const cube = ganState(event.facelets);
      const wasConnected = this.status === 'connected';
      const serial = event.serial & 0xff;
      const turnsSkipped = wasConnected && serial !== this.lastSerial;
      this.status = 'connected';
      this.lastSerial = serial;
      if (!wasConnected) this.resetIdleTimer();
      this.callbacks.sync(cube, !wasConnected, turnsSkipped);
      this.waiting?.(null, cube);
      this.callbacks.change();
    } else if (event.type === 'MOVE' && this.status === 'connected') {
      const serial = event.serial & 0xff;
      if (this.awaitingState || serial === this.lastSerial) return;
      this.resetIdleTimer();
      if (serial !== ((this.lastSerial + 1) & 0xff)) {
        this.lastSerial = null;
        this.callbacks.missedTurn();
        this.callbacks.change();
        this.callbacks.error('A turn was missed. Refreshing the cube state.');
        this.resync().catch(error => this.callbacks.error(error.message));
        return;
      }
      this.lastSerial = serial;
      this.callbacks.turn(ganMove(event.move), event.localTimestamp ?? event.timestamp, event.cubeTimestamp);
      if (Date.now() >= this.nextBatteryRequest) this.requestBattery();
    } else if (event.type === 'GYRO') {
      const orientation = ganOrientation(event.quaternion);
      if (!orientation) return;
      this.orientation = orientation;
      this.callbacks.orientation();
    } else if (event.type === 'BATTERY' && validLevel(event.batteryLevel)) {
      clearTimeout(this.batteryRetryTimer);
      this.nextBatteryRequest = Date.now() + batteryRefresh;
      this.battery = event.batteryLevel;
      this.lastBattery = { deviceId: this.deviceId, level: this.battery };
      try { localStorage.setItem(batteryKey, JSON.stringify(this.lastBattery)); } catch { /* Storage can be disabled. */ }
      this.callbacks.change();
    }
  }

  async disconnect(close = true) {
    const connection = this.conn;
    clearTimeout(this.idleTimer);
    clearTimeout(this.batteryRetryTimer);
    this.batteryRequest = null;
    this.sub?.unsubscribe();
    this.conn = null;
    this.status = 'disconnected';
    this.battery = undefined;
    this.orientation = undefined;
    if (this.waiting) this.waiting(new Error('Bluetooth connection closed.'));
    this.callbacks.change();
    if (connection && close) await connection.disconnect().catch(() => {});
  }
}
