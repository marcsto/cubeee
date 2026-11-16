import { connectGanCube } from 'gan-web-bluetooth';
import { ganMove, ganState, validFacelets } from './cube.js';

const addressPattern = /^(?:[\da-f]{2}:){5}[\da-f]{2}$/i;

export function normalizeAddress(value) {
  const compact = value.trim().replace(/[:\s-]/g, '');
  return /^[\da-f]{12}$/i.test(compact) ? compact.toUpperCase().match(/../g).join(':') : '';
}

export class BluetoothCube {
  status = 'disconnected';

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
    try {
      this.conn = await connectGanCube(async (device, fallback) => {
        this.deviceId = device.id;
        let cached;
        try { cached = localStorage.getItem(`cubeee:mac:${device.id}`); } catch { /* Storage can be disabled. */ }
        if (addressPattern.test(cached ?? '')) return cached;
        return fallback ? this.callbacks.address(device.name ?? 'GAN i4') : null;
      });
      this.name = this.conn.deviceName || 'GAN i4';
      this.sub = this.conn.events$.subscribe(event => this.handle(event));
      await this.resync();
      if (this.conn) this.conn.sendCubeCommand({ type: 'REQUEST_BATTERY' }).catch(() => {});
    } catch (error) {
      if (this.conn && this.deviceId && this.status !== 'connected') {
        try { localStorage.removeItem(`cubeee:mac:${this.deviceId}`); } catch { /* Storage can be disabled. */ }
      }
      await this.disconnect();
      if (error.name !== 'NotFoundError') this.callbacks.error(error.message || 'Could not connect to the GAN cube.');
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
      const timer = setTimeout(() => this.waiting?.(new Error('No valid state received. Wake the cube and check its Bluetooth MAC address.')), 6000);
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
      if (this.deviceId) {
        try { localStorage.setItem(`cubeee:mac:${this.deviceId}`, this.conn.deviceMAC); } catch { /* Storage can be disabled. */ }
      }
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
