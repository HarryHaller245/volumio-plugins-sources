//errors.js

// Error codes enumeration
const FaderErrors = {
    CONNECTION_FAILED: 'CONNECTION_FAILED',
    INVALID_CONFIG: 'INVALID_CONFIG',
    MOVEMENT_ERROR: 'MOVEMENT_ERROR',
    CALIBRATION_FAILED: 'CALIBRATION_FAILED',
    DEVICE_NOT_READY: 'DEVICE_NOT_READY',
    QUEUE_OVERFLOW: 'QUEUE_OVERFLOW',
    SEND_POS_ERROR: 'SEND_POSITIONS_ERROR',
    QUEUE_CLEAR_ERROR: 'QUEUE_CLEAR_ERROR',
    MIDI_FEEDBACK_ERROR: 'MIDI_FEEDBACK_ERROR',
    MIDI_INDEX_ERROR: 'MIDI_INDEX_ERROR',
    MIDI_POSITION_ERROR: 'MIDI_POSITION_ERROR',
    MIDI_SEND_ERROR: 'MIDI_SEND_ERROR',
  };
  
  const SerialErrors = {
    SERIAL_PORT_NOT_OPEN: 'SERIAL_PORT_NOT_OPEN',
    SERIAL_PORT_NOT_FOUND: 'SERIAL_PORT_NOT_FOUND',
    SERIAL_PORT_NOT_CLOSED: 'SERIAL_PORT_NOT_CLOSED',
    SERIAL_PORT_DISCONNECTED: 'SERIAL_PORT_DISCONNECTED',
    SERIAL_PORT_CONNECTION_FAILED: 'SERIAL_PORT_CONNECTION_FAILED'
  };

class FaderControllerError extends Error {
    constructor(code, message, details) {
      super(message);
      this.code = code;
      this.details = details;
      this.name = 'FaderControllerError';
    }
}

class SerialPortError extends Error {
    constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
    this.name = 'SerialPortError';
    }
}

class MIDIError extends Error {
    constructor(code, message, details) {
        super(message);
        this.code = code;
        this.details = details;
        this.name = 'MIDIError';
    }
}

class CalibrationError extends Error {
    constructor(code, message, details) {
        super(message);
        this.code = code;
        this.details = details;
        this.name = 'CalibrationError';
    }
}
class MIDIQueueError extends Error {
    constructor(code, message, details) {
        super(message);
        this.code = code;
        this.details = details;
        this.name = 'QueueError';
    }
}

class MIDIFeedbackTrackerError extends Error {
    constructor(code, message, details) {
        super(message);
        this.code = code;
        this.details = details;
        this.name = 'MIDIFeedbackTrackerError';
    }
}

module.exports = {FaderControllerError, SerialPortError, MIDIError, CalibrationError, MIDIQueueError, MIDIFeedbackTrackerError}