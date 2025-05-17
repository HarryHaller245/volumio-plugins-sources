const EventEmitter = require('events');

class FaderEventEmitter extends EventEmitter {
  constructor(logger) {
    super();
    this.logger = logger;
    this.noLogEvents = new Set(); // Set of events to exclude from logging
  }

  /**
   * Add events to the no-log list.
   * @param {string[]} events - Array of event names to exclude from logging.
   */
  excludeFromLogging(events) {
    events.forEach(event => this.noLogEvents.add(event));
  }

  /**
   * Emit an event with optional logging and error handling.
   * @param {string} event - The event name.
   * @param {...any} args - Arguments to pass to the event listeners.
   * @returns {boolean} - Indicates if the event had listeners.
   */
  emit(event, ...args) {
    try {
      const isInternal = event.startsWith('internal:');
      if (!this.noLogEvents.has(event)) {
        if (event === 'error') {
          const error = args[0];
          this.logger.error(`Error emitted: ${error.message}`, error);
        } else {
          const logMessage = isInternal
            ? `Internal event emitted: ${event} args: ${JSON.stringify(args)}`
            : `External event emitted: ${event} args: ${JSON.stringify(args)}`;
          this.logger.debug(logMessage, ...args);
        }
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
    if (!this.noLogEvents.has(event)) {
      this.logger.debug(`Listener registered for event: ${event}`);
    }
    super.on(event, listener);
  }

  /**
   * Remove an event listener with optional logging.
   * @param {string} event - The event name.
   * @param {Function} listener - The event listener function.
   */
  off(event, listener) {
    if (!this.noLogEvents.has(event)) {
      this.logger.debug(`Listener removed for event: ${event}`);
    }
    super.off(event, listener);
  }
}

module.exports = FaderEventEmitter;