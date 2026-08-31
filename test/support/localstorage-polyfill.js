// Minimal in-memory localStorage so Store (which talks to the real global
// directly) can run under `node:test` without a DOM. Node's own
// `--experimental-webstorage` requires a backing file and isn't worth the
// CI complexity for something this small.
class MemoryStorage {
  #data = new Map();

  getItem(key) {
    return this.#data.has(key) ? this.#data.get(key) : null;
  }

  setItem(key, value) {
    this.#data.set(key, String(value));
  }

  removeItem(key) {
    this.#data.delete(key);
  }

  clear() {
    this.#data.clear();
  }

  // Enumeration half of the Web Storage API — MemoCache#clearStored walks
  // localStorage by index to drop entries by key prefix.
  get length() {
    return this.#data.size;
  }

  key(index) {
    return [...this.#data.keys()][index] ?? null;
  }
}

globalThis.localStorage = new MemoryStorage();
