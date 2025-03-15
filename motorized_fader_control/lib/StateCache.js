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

  clear(ns) {
    const namespace = this.namespace(ns);
    namespace.data.clear();
    namespace.ttl.clear();
  }

  // Specialized playback state methods
  cachePlaybackState(state) {
    const validState = this.validatePlaybackState(state);
    if (!validState) return null;
    
    const stateWithTiming = {
      ...validState,
      timestamp: Date.now(),
      originalDuration: validState.duration * 1000 // Convert to ms
    };
    
    this.set('playback', 'current', stateWithTiming, 60000); // 1 minute TTL
    return stateWithTiming;
  }

  getPlaybackState() {
    const state = this.get('playback', 'current');
    if (!state) return null;
    
    // Calculate elapsed time since last update
    const elapsed = Date.now() - state.timestamp;
    return {
      ...state,
      currentPosition: state.status === 'play' 
        ? Math.min(state.seek + elapsed, state.originalDuration)
        : state.seek
    };
  }

  validatePlaybackState(state) {
    return state && 
      typeof state.seek === 'number' &&
      typeof state.duration === 'number' &&
      ['play', 'pause', 'stop'].includes(state.status);
  }

  // User input management
  setUserInputLock(faderIdx, timeout = 30000) {
    this.set('locks', `userInput_${faderIdx}`, true, timeout);
  }

  hasActiveUserInput(faderIdx) {
    return !!this.get('locks', `userInput_${faderIdx}`);
  }

  // Seek progression tracking
  cacheSeekProgression(faderIdx, progression) {
    this.set('seek', `fader_${faderIdx}`, progression, 300000); // 5 minutes
  }

  getSeekProgression(faderIdx) {
    return this.get('seek', `fader_${faderIdx}`) || 0;
  }
}

module.exports = StateCache;

