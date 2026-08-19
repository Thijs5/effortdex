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
}

globalThis.localStorage = new MemoryStorage();
