function workerRequests(create) {
  let worker;
  let request = 0;
  const pending = new Map();
  return input => {
    if (!worker) {
      worker = create();
      worker.onmessage = ({ data: { id, result } }) => pending.get(id)?.(result);
      worker.onerror = () => {
        for (const settle of pending.values()) settle();
        worker.terminate();
        worker = null;
      };
    }
    return new Promise(resolve => {
      const id = ++request;
      const timeout = setTimeout(() => pending.get(id)?.(), 20000);
      pending.set(id, result => {
        clearTimeout(timeout);
        pending.delete(id);
        resolve(result);
      });
      worker.postMessage({ id, ...input });
    });
  };
}

const route = workerRequests(() => new Worker(new URL('./route.worker.js', import.meta.url), { type: 'module' }));
const pair = workerRequests(() => new Worker(new URL('./pair-search.worker.js', import.meta.url), { type: 'module' }));

export async function planRoute(current, { setup, target } = {}) {
  return route({ current: current.asString(), setup, target: target?.asString() });
}

export async function planPair(start, target, slots, fallback, limit = 3) {
  return pair({ start: start.asString(), target: target.asString(), slots, fallback, limit });
}
