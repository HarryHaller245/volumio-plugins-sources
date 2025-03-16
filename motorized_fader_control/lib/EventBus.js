// lib/EventBus.js

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
    this.logger.debug(`${this.PLUGINSTR}: ${this.logs.EVENT.REGISTERED} ${event}`);
  }
  
  emit(event, data) {
    this.logger.debug(`${this.PLUGINSTR}: ${this.logs.EVENT.EMIT} ${event} ${JSON.stringify(data)}`);
    (this.listeners[event] || []).forEach(cb => cb(data));
  }

  emitPlaybackState(state) {
    this.emit('playback/update', state);
    this.logger.debug(`${this.PLUGINSTR}: ${this.logs.EVENT.EMIT_PLAYBACK} ${state.status}`);
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
}

module.exports = EventBus;