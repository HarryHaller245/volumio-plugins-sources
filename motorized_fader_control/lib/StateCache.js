// lib/StateCache.js (Enhanced)
class StateCache {
  constructor() {
    this.namespaces = new Map();
    this.defaultTTL = 300000; // 300 seconds
  }

  namespace(ns) {
    if (!this.namespaces.has(ns)) {
      this.namespaces.set(ns, {
        data: new Map(),
        ttl: new Map(),
        subscriptions: new Set()
      });
    }
    return this.namespaces.get(ns);
  }

  set(ns, key, value, ttl = this.defaultTTL) {
    const namespace = this.namespace(ns);
    namespace.data.set(key, value);
    namespace.ttl.set(key, Date.now() + ttl);
    namespace.subscriptions.forEach(cb => cb({ ns, key, value }));
    //timestamp ?
  }

  get(ns, key) {
    const namespace = this.namespace(ns);
    if (namespace.ttl.get(key) < Date.now()) {
      namespace.data.delete(key);
      namespace.ttl.delete(key);
      return null;
    }
    return namespace.data.get(key);
  }

  get_timestamp(ns, key) {
    const namespace = this.namespace(ns);
    if (namespace.ttl.get(key) < Date.now()) {
      namespace.data.delete(key);
      namespace.ttl.delete(key);
      return null;
    }
    return namespace.ttl.get(key);
  }

  subscribe(ns, callback) {
    const namespace = this.namespace(ns);
    namespace.subscriptions.add(callback);
    return () => namespace.subscriptions.delete(callback);
  }
}


module.exports = StateCache;