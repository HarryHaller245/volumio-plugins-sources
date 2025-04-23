const MIDIParser = require('./MIDIParser'); // Assuming MIDIParser is already implemented
const FaderEventEmitter = require('../events/FaderEventEmitter'); // Centralized event emitter
const MIDIError = require('../errors');

class MIDIHandler extends FaderEventEmitter {
  constructor(controller) {
    super(controller.config.logger); // Pass the logger to FaderEventEmitter
    this.controller = controller;
    this.parser = new MIDIParser();
    this.setupHandlers();
  }

  /**
   * Set up handlers for MIDI messages.
   */
  setupHandlers() {
    this.parser.on('data', data => {
      try {
        const message = this.parseMessage(data);
        if (message) {
          if (this.controller.config.MIDILog) {
            this.logger.debug(`MIDI RECV: ${JSON.stringify(message)}`);
          }
          this.emit('midi', message); // Emit the parsed MIDI message
          this.controller.handleMIDIMessage(message); // Delegate to the controller
        }
      } catch (error) {
        this.handleError(error, data);
      }
    });

    this.parser.on('error', error => {
      this.handleError(error);
    });
  }

  /**
   * Parse a raw MIDI message buffer.
   * @param {Buffer} buffer - The raw MIDI message buffer.
   * @returns {Object|null} - The parsed MIDI message or null if invalid.
   */
  parseMessage(buffer) {
    try {
      // Ensure the buffer is valid and has enough data
      if (!buffer || buffer.length < 3) {
        throw new MIDIError('Invalid MIDI message buffer', {
          code: 'MIDI_INVALID_BUFFER',
          rawData: buffer
        });
      }

      const message = {
        raw: buffer,
        type: this.parser.translateStatusByte(buffer[0]),
        channel: buffer[1],
        data1: buffer[2],
        data2: buffer[3]
      };

      // Special handling for different message types
      switch (message.type) {
        case 'PROGRAM_CHANGE':
        case 'NOTE_ON':
          // Note on/off messages parse the channel differently
          message.channel = buffer[2] - 104;
        case 'NOTE_OFF':
          message.channel = buffer[2] - 104;
        case 'CHANNEL_AFTERTOUCH':
          message.data2 = undefined;
          break;
      }

      return message;
    } catch (error) {
      this.handleError(error, buffer);
      return null;
    }
  }

  /**
   * Format a MIDI message for logging.
   * @param {Object} message - The MIDI message to format.
   * @returns {string} - The formatted message string.
   */
  formatForLog(message) {
    return this.parser.formatMIDIMessageLogArr([
      message.raw[0],
      message.data1,
      message.data2
    ]);
  }

  /**
   * Handle errors by emitting an error event and logging the error.
   * @param {Error} error - The error to handle.
   * @param {Buffer} [rawData] - Optional raw data associated with the error.
   */
  handleError(error, rawData = null) {
    const errorDetails = {
      ...error,
      code: error.code || 'MIDI_HANDLER_ERROR',
      rawData
    };

    this.logger.error(`MIDIHandler Error: ${error.message}`, errorDetails);
    this.emit('error', errorDetails); // Emit the error event
  }
}

module.exports = MIDIHandler;