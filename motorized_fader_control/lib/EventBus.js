/**
 * EventBus class provides a mechanism for registering and emitting events.
 * It supports logging of event registration and emission.
 * 
 * @class EventBus
 * @param {Object} logger - Logger instance for logging event operations.
 * @param {Object} logs - Log messages object containing various log message templates.
 * @param {string} pluginStr - String representing the plugin name, used for logging.
 * 
 * @method on - Registers a callback for a specific event.
 * @method emit - Emits an event with optional data.
 * @method emitPlaybackState - Emits playback state events based on the state status.
 * @method removeAllListeners - Removes all listeners for a specific event.
 */
class EventBus {
  constructor(logger, logs, pluginStr) {
    this.listeners = {};
    this.logger = logger;
    this.logs = logs;
    this.PLUGINSTR = pluginStr;
  }
  
  on(event, callback) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(callback);
    this.logger.debug(`${this.logs.LOGS.EVENT.REGISTERED} ${event}`);
    
    // Return an unsubscribe function
    return () => {
      if (!this.listeners[event]) return;
      this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
      this.logger.debug(`Unsubscribed from event: ${event}`);
    };
  }

  once(event, callback) {
    const onceWrapper = (data) => {
      callback(data);
      this.off(event, onceWrapper);
    };
    this.on(event, onceWrapper);
    this.logger.debug(`${this.logs.LOGS.EVENT.REGISTERED_ONCE} ${event}`);
  }

  off(event, callback) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
    this.logger.debug(`${this.logs.LOGS.EVENT.UNREGISTERED} ${event}`);
  }
  
  emit(event, data) {
    this.logger.debug(`${this.logs.LOGS.EVENT.EMIT} ${event}: ${JSON.stringify(data)}`);
    (this.listeners[event] || []).forEach(cb => cb(data));
  }

  emitPlaybackState(state) {
    this.emit('playback/update', state);
    this.logger.debug(`${this.logs.LOGS.EVENT.EMIT_PLAYBACK}`);
    switch(state.status) {
      case 'play': 
        this.emit('playback/playing', state);
        break;
      case 'pause':
        this.emit('playback/paused');
        break;
      case 'stop':
        this.emit('playback/stopped');
        break;
    }
  }

  clear() {
    this.listeners = {};
    this.logger.debug(`${this.logs.LOGS.EVENT.CLEARED}`);
  }

  removeAllListeners(event) {
    if (this.listeners[event]) {
      delete this.listeners[event];
      this.logger.debug(`Removed all listeners for event: ${event}`);
    }
    // If no event is specified, clear all listeners
    else {
      this.listeners = {};
      this.logger.debug(`Removed all listeners for all events`);
    }
  }
}

module.exports = EventBus;