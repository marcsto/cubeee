if (navigator.wakeLock) {
  let lock;
  let pending = false;

  async function keepScreenAwake() {
    if (document.visibilityState !== 'visible' || pending || (lock && !lock.released)) return;
    pending = true;
    try {
      lock = await navigator.wakeLock.request('screen');
    } catch {
      // Power-saving settings can deny a request. Retry on the next visit or tap.
    } finally {
      pending = false;
    }
  }

  document.addEventListener('visibilitychange', keepScreenAwake);
  document.addEventListener('click', keepScreenAwake, { capture: true });
  keepScreenAwake();
}
