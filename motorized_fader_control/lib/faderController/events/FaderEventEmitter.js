const EventEmitter = require('events');

class FaderEventEmitter extends EventEmitter {
  constructor(logger, config = {}) {
    super();
    this.logger = logger;
    this.noLogEvents = new Set(); // Set of events to exclude from logging
    this.disableInternalEventLogging = config.disableInternalEventLogging || false; // Config flag
    this.disableEventLogging = config.disableEventLogging || false; // Config flag
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
      if (!this.noLogEvents.has(event) && !this.disableEventLogging) {
        if (isInternal && this.disableInternalEventLogging) {
          // Skip logging for internal events if disabled
          return super.emit(event, ...args);
        }

        if (event === 'error') {
          const error = args[0];
          this.logger.error(`Error emitted: ${error.message}`, error);
        } else {
          const logMessage = isInternal
            ? `[EVENT] [INTERNAL] emitted: ${event} args: ${JSON.stringify(args)}`
            : `[EVENT] [EXTERNAL] emitted: ${event} args: ${JSON.stringify(args[0])}`; //only log the first argument for external events
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
    if (!this.noLogEvents.has(event) && !this.disableEventLogging) {
      this.logger.debug(`Event registered: ${event}`);
    }
    super.on(event, listener);
  }

  /**
   * Remove an event listener with optional logging.
   * @param {string} event - The event name.
   * @param {Function} listener - The event listener function.
   */
  off(event, listener) {
    if (!this.noLogEvents.has(event) && !this.disableEventLogging) {
      this.logger.debug(`Listener removed for event: ${event}`);
    }
    super.off(event, listener);
  }
}

module.exports = FaderEventEmitter;