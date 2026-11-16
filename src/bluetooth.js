import { connectGanCube } from 'gan-web-bluetooth';
import { ganMove, ganState, validFacelets } from './cube.js';

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

  constructor(callbacks) {
    this.callbacks = callbacks;
  }

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
      this.conn = await connectGanCube(async (device, fallback) => {
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
      connection.sendCubeCommand({ type: 'REQUEST_BATTERY' }).catch(() => {});
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

  async resync() {
    if (!this.conn) return;
    if (this.syncing) return this.syncing;
    this.syncing = this.requestState();
    try {
      await this.syncing;
    } finally {
      this.syncing = null;
    }
  }

  async requestState() {
    const response = new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.waiting?.(new DOMException('No valid state received. Wake the cube and check its Bluetooth MAC address.', 'TimeoutError')), 6000);
      this.waiting = (error, cube) => {
        clearTimeout(timer);
        this.waiting = null;
        if (error) reject(error);
        else resolve(cube);
      };
    });
    await Promise.all([response, this.conn.sendCubeCommand({ type: 'REQUEST_FACELETS' }).catch(error => this.waiting?.(error))]);
  }

  handle(event) {
    if (event.type === 'DISCONNECT') {
      this.disconnect(false);
      this.callbacks.disconnect();
      this.callbacks.error('Cube disconnected. Reconnect to continue tracking your GAN.');
    } else if (event.type === 'FACELETS' && validFacelets(event.facelets)) {
      const cube = ganState(event.facelets);
      const wasConnected = this.status === 'connected';
      this.status = 'connected';
      this.lastSerial = event.serial;
      this.callbacks.sync(cube, !wasConnected);
      this.waiting?.(null, cube);
      this.callbacks.change();
    } else if (event.type === 'MOVE' && this.status === 'connected') {
      if (event.serial === this.lastSerial) return;
      if (((event.serial - this.lastSerial + 256) % 256) !== 1) {
        this.callbacks.error('A turn was missed. Refreshing the cube state.');
        this.resync().catch(error => this.callbacks.error(error.message));
        return;
      }
      this.lastSerial = event.serial;
      this.callbacks.turn(ganMove(event.move), event.localTimestamp ?? event.timestamp, event.cubeTimestamp);
    } else if (event.type === 'BATTERY') {
      this.battery = event.batteryLevel;
      this.callbacks.change();
    }
  }

  async disconnect(close = true) {
    const connection = this.conn;
    this.sub?.unsubscribe();
    this.conn = null;
    this.status = 'disconnected';
    this.battery = undefined;
    if (this.waiting) this.waiting(new Error('Bluetooth connection closed.'));
    this.callbacks.change();
    if (connection && close) await connection.disconnect().catch(() => {});
  }
}
