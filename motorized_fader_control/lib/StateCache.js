/**
 * StateCache class provides a caching mechanism for various states with support for namespaces, TTL (Time-To-Live), and subscriptions.
 * It is designed to handle playback states, user input locks, and seek progression tracking.
 * 
 * @class StateCache
 * @param {Object} logger - Logger instance for logging cache operations.
 * @param {Object} logs - Log messages object containing various log message templates.
 * @param {string} pluginStr - String representing the plugin name, used for logging.
 * 
 * @method namespace - Retrieves or creates a namespace for caching.
 * @method set - Sets a cache value with an optional TTL.
 * @method get - Retrieves a cache value if it has not expired.
 * @method get_timestamp - Retrieves the timestamp of a cache value if it has not expired.
 * @method subscribe - Subscribes to changes in a namespace.
 * @method clear - Clears all cache values in a namespace.
 * @method cachePlaybackState - Caches the playback state with a specific TTL.
 * @method getPlaybackState - Retrieves the current playback state, calculating the current position if playing.
 * @method validatePlaybackState - Validates the structure of a playback state.
 * @method setUserInputLock - Sets a user input lock for a specific fader index with a TTL.
 * @method hasActiveUserInput - Checks if there is an active user input lock for a specific fader index.
 * @method cacheSeekProgression - Caches the seek progression for a specific fader index.
 * @method getSeekProgression - Retrieves the seek progression for a specific fader index.
 */
class StateCache {
  constructor(logger, logs, pluginStr) {
    this.namespaces = new Map();
    this.defaultTTL = 30000;
    this.logger = logger;
    this.logs = logs;
    this.PLUGINSTR = pluginStr;
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
      this.logger.debug(`${this.PLUGINSTR}: ${this.logs.LOGS.CACHE.EXPIRED} ns: ${ns}, key: ${key}`);
      return null;
    }
    return namespace.ttl.get(key);
  }

  /**
   * Subscribes a callback function to a specific namespace for state change notifications.
   *
   * @param {string} ns - The namespace to subscribe to.
   * @param {Function} callback - The callback function to be invoked when the state changes in the specified namespace.
   * @returns {Function} A function to unsubscribe the callback from the namespace.
   */
  subscribe(ns, callback) {
    const namespace = this.namespace(ns);
    namespace.subscriptions.add(callback);
    this.logger.debug(`${this.PLUGINSTR}: ${this.logs.LOGS.CACHE.SUBSCRIBED.replace('${ns}', ns)}`);
    return () => {
      namespace.subscriptions.delete(callback);
      this.logger.debug(`${this.PLUGINSTR}: ${this.logs.LOGS.CACHE.UNSUBSCRIBED.replace('${ns}', ns)}`);
    };
  }

  /**
   * Clears all cache values in a namespace or all namespaces if no namespace is specified.
   * 
   * @param {string} [ns] - The namespace to clear. If undefined, all namespaces will be cleared.
   */
  clear(ns) {
    if (ns) {
      const namespace = this.namespace(ns);
      namespace.data.clear();
      namespace.ttl.clear();
      this.logger.debug(`${this.PLUGINSTR}: ${this.logs.LOGS.CACHE.CLEAR.replace('${ns}', ns)}`);
    } else {
      this.namespaces.forEach((namespace, nsKey) => {
        namespace.data.clear();
        namespace.ttl.clear();
        this.logger.debug(`${this.PLUGINSTR}: ${this.logs.LOGS.CACHE.CLEAR.replace('${ns}', nsKey)}`);
      });
    }
  }

  /**
   * Caches the playback state with a specific TTL (Time-To-Live).
   * This method is specialized to include elapsed state durations for the seek value.
   * It is useful for real-time updating of playback state without requiring a new state push from the Volumio system.
   * 
   * @param {Object} state - The playback state to cache.
   * @returns {Object|null} The cached playback state with timing information, or null if the state is invalid.
   */
  cachePlaybackState(state) {
    const validState = this.validatePlaybackState(state);
    if (!validState) return null;
    
    const stateWithTiming = {
      ...validState,
      timestamp: Date.now(),
      originalDuration: validState.duration * 1000 // Convert to ms
    };
    this.set('playback', 'current', stateWithTiming, 60000000); // 1 minute TTL
    this.logger.debug(`${this.PLUGINSTR}: ${this.logs.LOGS.CACHE.CACHE_PLAYBACK_STATE} timestamp: ${Date.now()}`);
    return stateWithTiming;
  }

  /**
   * Retrieves the current playback state, calculating the current position if playing.
   * This method is specialized to provide real-time updates for the seek value based on the elapsed time since the last state update.
   * 
   * @returns {Object|null} The current playback state with the updated seek value, or null if no state is cached.
   */
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

  /**
   * Validates the playback state object to ensure it contains valid properties and values.
   *
   * @param {Object} state - The playback state object to validate.
   * @returns {Object|null} - Returns the validated state object if valid, otherwise returns null.
   */
  validatePlaybackState(state) {
      if (state && typeof state === 'object' && state.hasOwnProperty("status")) {
        const PlaybackStatus = state.status; 
        // Check if the PlaybackStatus is one of the valid states
        if (PlaybackStatus === 'play' || PlaybackStatus === 'pause' || PlaybackStatus === 'stop') {

            if (state.hasOwnProperty("seek") && state.hasOwnProperty("duration")) {
                const seek = state.seek;
                const duration = state.duration * 1000; // convert to ms

                if (seek > duration) {
                    this.logger.warn(`${this.PLUGINSTR}: validateState: Invalid state: seek (${seek} ms) is larger than duration (${duration} ms)`);
                    return state;
                }
            }
            return state;
          }
        }
      return null;
    }

  // User input management
  setUserInputLock(faderIdx, timeout = 10) {
    this.set('locks', `userInput_${faderIdx}`, true, timeout);
    this.logger.debug(`${this.PLUGINSTR}: ${this.logs.LOGS.CACHE.SET_USER_INPUT_LOCK.replace('${faderIdx}', faderIdx)}`);
  }

  hasActiveUserInput(faderIdx) {
    return !!this.get('locks', `userInput_${faderIdx}`);
  }

  // Seek progression tracking
  cacheSeekProgression(faderIdx, progression) {
    this.set('seek', `fader_${faderIdx}`, progression, 300000); 
    this.logger.debug(`${this.PLUGINSTR}: ${this.logs.LOGS.CACHE.CACHE_SEEK_PROGRESSION.replace('${faderIdx}', faderIdx).replace('${progression}', progression)}`);
  }

  getSeekProgression(faderIdx) {
    return this.get('seek', `fader_${faderIdx}`) || 0;
  }

  // Cache fader info - ! i hope this will not be used since this is state cache
  cacheFaderInfo(faderInfo) {
    this.set('fader', `fader_${faderInfo.index}`, faderInfo, 300000);
    this.logger.debug(`${this.PLUGINSTR}: ${this.logs.LOGS.CACHE.CACHE_FADER_INFO.replace('${faderInfo}', JSON.stringify(faderInfo))}`);
  }

  //cache fader info and untouch and what to do after untouch maybe put into
  cacheFaderInfoCommand(faderInfo, command) {
    this.set('fader', `fader_${faderInfo.index}`, { faderInfo, command }, 300000);
    this.logger.debug(`${this.PLUGINSTR}: ${this.logs.LOGS.CACHE.CACHE_FADER_INFO_COMMAND.replace('${faderInfo}', JSON.stringify(faderInfo)).replace('${command}', command)}`);
  }

}

module.exports = StateCache;