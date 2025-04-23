const MIDIFeedbackTracker = require('./MIDIFeedbackTracker.js');
const FaderEventEmitter = require('../events/FaderEventEmitter'); // Centralized event emitter
const MIDIQueueError = require('../errors');

class MIDIQueue extends FaderEventEmitter {
  constructor(serial, controller, delay = 0.01, timeout = 500000) {
    super(controller.config.logger); // Pass the logger to FaderEventEmitter
    this.serial = serial;
    this.queue = new Map();
    this.delay = delay;
    this.isProcessing = false;
    this.controller = controller;
    this.config = controller.config;
    this.pendingPromises = new Map();
    this.timeout = timeout;
    this.faders = controller.faders;
    this.sequenceCounters = new Map();
    this.max_batchSize = 4;
    this.currentBatch = new Set();
    this.feedbackTracker = new MIDIFeedbackTracker(controller); // Use MIDIFeedbackTracker
  }

  /**
   * Add a MIDI message to the queue.
   * @param {Array} message - The MIDI message to add.
   * @param {Object} options - Additional options for the message.
   * @returns {Promise} - Resolves when the message is processed.
   */
  add(message, options = {}) {
    return new Promise((resolve, reject) => {
      try {
        const id = Symbol();
        const timer = setTimeout(() => {
          this.pendingPromises.delete(id);
          reject(new MIDIQueueError('MIDI send timeout', { code: 'MIDI_TIMEOUT', message }));
        }, this.timeout);

        const faderIndex = this.get_index(message);

        if (!this.sequenceCounters.has(faderIndex)) {
          this.sequenceCounters.set(faderIndex, 0);
        }

        const sequenceNumber = this.sequenceCounters.get(faderIndex);
        this.sequenceCounters.set(faderIndex, sequenceNumber + 1);

        if (!this.queue.has(faderIndex)) {
          this.queue.set(faderIndex, []);
        }

        this.queue.get(faderIndex).push({
          message,
          id,
          sequenceNumber
        });

        this.pendingPromises.set(id, { resolve, reject, timer });

        // Log the added message
        if (this.config.MIDILog) {
          this.logger.debug(`Added MIDI message to queue for fader ${faderIndex}: ${JSON.stringify({
            message,
            id,
            sequenceNumber,
            options
          })}`);
        }

        // Track target position if feedback is enabled
        if (this.config.feedback_midi && !options.disableFeedback) {
          const targetPosition = this.get_position(message);
          this.feedbackTracker.trackFeedbackStart(faderIndex, targetPosition);
        }

        this.process(options);
      } catch (error) {
        this.handleError(error, { message, options });
        reject(error);
      }
    });
  }

  /**
   * Process the MIDI queue.
   * @param {Object} options - Additional options for processing.
   */
  async process(options = {}) {
    if (this.isProcessing || this.queue.size === 0) return;

    this.isProcessing = true;

    try {
      const availableFaders = [];
      for (const [faderIndex, messages] of this.queue) {
        if (!this.currentBatch.has(faderIndex) && messages.length > 0) {
          availableFaders.push(faderIndex);
          if (availableFaders.length >= this.max_batchSize) break;
        }
      }

      if (availableFaders.length === 0) {
        this.isProcessing = false;
        return;
      }

      await Promise.all(availableFaders.map(async faderIndex => {
        this.currentBatch.add(faderIndex);
        const messages = this.queue.get(faderIndex);

        if (messages && messages.length > 0) {
          const nextMessage = messages.shift();

          if (messages.length === 0) {
            this.queue.delete(faderIndex);
          }

          try {
            const index = this.get_index(nextMessage.message);
            if (!this.faders[index].touch) {
              const position = this.get_position(nextMessage.message);
              if (!this.config.feedback_midi || !this.feedbackTracker.isTrackingFeedback(index) || options.disableFeedback) {
                this.faders[index].emitMoveStart(position, Date.now());
              }
              await this.send(nextMessage.message);

              if (!this.config.feedback_midi || !this.feedbackTracker.isTrackingFeedback(index) || options.disableFeedback) {
                this.controller.getFader(index).updatePositionFeedback(position);
                this.controller.getFader(index).emitMoveComplete(this.feedbackTracker.getFeedbackStatistics(index));
              }

              this.emit('midi/sent', { message: nextMessage.message });

              if (this.pendingPromises.has(nextMessage.id)) {
                const { resolve, timer } = this.pendingPromises.get(nextMessage.id);
                clearTimeout(timer);
                resolve();
                this.pendingPromises.delete(nextMessage.id);
              }
            }
          } catch (error) {
            this.handleError(error, { message: nextMessage.message });
          }
        }

        this.currentBatch.delete(faderIndex);
      }));
    } catch (error) {
      this.handleError(error, { queueSize: this.queue.size });
    } finally {
      setTimeout(() => {
        this.isProcessing = false;
        this.process();
      }, this.delay);
    }
  }

  /**
   * Send a MIDI message.
   * @param {Array} message - The MIDI message to send.
   * @returns {Promise} - Resolves when the message is sent.
   */
  send(message) {
    return new Promise((resolve, reject) => {
      try {
        const buffer = Buffer.from(message);

        if (this.config.MIDILog) {
          this.logger.debug(`MIDI SEND: ${JSON.stringify(message)}`);
        }

        if (!this.serial.isOpen) {
          const error = new MIDIQueueError('Serial port not open', { code: 'SERIAL_NOT_OPEN' });
          this.handleError(error, { message });
          return reject(error);
        }

        this.serial.write(buffer, err => {
          if (err) {
            const error = new MIDIQueueError('Failed to send MIDI message', { code: 'MIDI_SEND_ERROR', message });
            this.handleError(error, { message });
            reject(error);
          } else {
            resolve();
          }
        });
      } catch (error) {
        this.handleError(error, { message });
        reject(error);
      }
    });
  }

  flush(faderIndex = null) {
    try {
      if (faderIndex === null) {
        // Clear the entire queue
        this.queue.clear();
        for (const [id, { resolve, timer }] of this.pendingPromises) {
          clearTimeout(timer);
          resolve();
          this.pendingPromises.delete(id);
        }
  
        // Clear feedback tracking for all faders
        if (this.config.feedback_midi) {
          this.feedbackTracker.clearAllFeedback();
        }
      } else {
        // Clear the queue for a specific fader
        if (!this.queue.has(faderIndex)) {
          return;
        }
        this.queue.delete(faderIndex);
  
        for (const [id, { resolve, timer, message }] of this.pendingPromises) {
          const msgFaderIndex = this.get_index(message);
          if (msgFaderIndex === faderIndex) {
            clearTimeout(timer);
            resolve();
            this.pendingPromises.delete(id);
          }
        }
  
        // Clear feedback tracking for the specific fader
        if (this.config.feedback_midi) {
          this.feedbackTracker.clearFeedback(faderIndex);
        }
      }
  
      this.isProcessing = false;
    } catch (error) {
      this.handleError(error, { message: 'Failed to clear MIDI Queue' });
      throw error;
    }
  }

  get_index(message) {
    try {
      const faderIndex = message[0] & 0x0F;
      return faderIndex;
    } catch (error) {
      this.handleError(error, {message: message});
      throw error;
    }
  }

  get_position(message) {
    try {
      const position = (message[1] << 7) | message[2];
      return position;
    } catch (error) {
      this.handleError(error, {message: message});
      throw error;
    }
  }

  /**
 * Handle errors by emitting an error event and logging the error.
 * @param {Error} error - The error to handle.
 * @param {Object} [details] - Additional details about the error.
 */
  handleError(error, details = {}) {
    const errorDetails = {
      ...error,
      ...details,
      code: error.code || 'MIDI_QUEUE_ERROR'
    };
    this.emit('error', errorDetails); // Emit the error event
  }

}

module.exports = MIDIQueue;