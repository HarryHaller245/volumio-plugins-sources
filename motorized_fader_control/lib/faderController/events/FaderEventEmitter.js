const EventEmitter = require('events');

class FaderEventEmitter extends EventEmitter {
  constructor(logger) {
    super();
    this.logger = logger;
  }

  /**
   * Emit an event with optional logging and error handling.
   * @param {string} event - The event name.
   * @param {...any} args - Arguments to pass to the event listeners.
   * @returns {boolean} - Indicates if the event had listeners.
   */
  emit(event, ...args) {
    try {
      if (event === 'error') {
        const error = args[0];
        this.logger.error(`Error emitted: ${error.message}`, error);
      } else {
        this.logger.debug(`Event emitted: ${event} args: ${JSON.stringify(args)}`, ...args);
      }
      return super.emit(event, ...args);
    } catch (err) {
      this.logger.error(`Failed to emit event: ${event}`, err);
      return false;
    }
  }

  /**
   * Register an event listener with optional logging.
   * @param {string} event - The event name.
   * @param {Function} listener - The event listener function.
   */
  on(event, listener) {
    this.logger.debug(`Listener registered for event: ${event}`);
    super.on(event, listener);
  }

  /**
   * Remove an event listener with optional logging.
   * @param {string} event - The event name.
   * @param {Function} listener - The event listener function.
   */
  off(event, listener) {
    this.logger.debug(`Listener removed for event: ${event}`);
    super.off(event, listener);
  }
}

module.exports = FaderEventEmitter;