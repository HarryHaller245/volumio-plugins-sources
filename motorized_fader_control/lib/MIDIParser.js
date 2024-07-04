
// Path: lib/MIDIParser.js

const { Transform } = require('stream');


/**
 * A class that extends Transform stream to parse MIDI messages.
 */
class MIDIParser extends Transform {
    
    /**
     * Constructs a new MIDIParser instance.
     * @param {Object} options - The options for the Transform stream.
     */
    constructor(options) {
        super(options);
        this.expecting = "status";
        this.type = 0;
        this.channel = 0;
        this.data1 = 0;
        this.data2 = 0;
        this.buffer = []; // Add a buffer to store incoming MIDI messages
    }

    /**
     * Transforms the incoming chunk of data.
     * @param {Buffer} chunk - The chunk of data to be transformed.
     * @param {string} encoding - The encoding of the chunk.
     * @param {Function} callback - The callback function to be called when the transformation is complete.
     */
    _transform(chunk, encoding, callback) {
        for (let i = 0; i < chunk.length; i++) {
            this.buffer.push(chunk[i]); // Add each byte to the buffer
    
            // Only parse the message when a complete MIDI message has been received
            if (this.buffer.length >= 3) {
                if (this.parse(this.buffer)) {
                    const midiData = {
                        type: this.buffer[0],
                        channel: this.channel,
                        data1: this.data1,
                        data2: this.data2
                    };
    
                    // Convert midiData to a Buffer
                    const buffer = Buffer.from([this.type, this.channel, this.data1, this.data2]);
    
                    this.push(buffer);
                }
    
                // Clear the buffer
                this.buffer = [];
            }
        }
        callback();
    }

    /**
     * Parses the MIDI message from the buffer.
     * @param {Array} buffer - The buffer containing the MIDI message.
     * @returns {boolean} - True if a complete MIDI message has been parsed, false otherwise.
     */
    parse(buffer) {
        for (let i = 0; i < buffer.length; i++) {
            let byte = buffer[i];
            if (this.expecting === "status") {
                if (byte & 0x80) {
                    this.type = byte & 0xF0;
                    this.channel = (byte & 0x0F);
                    this.expecting = "data1";
                }
            } else if (this.expecting === "data1") {
                this.data1 = byte;
                this.expecting = "data2";
            } else if (this.expecting === "data2") {
                this.data2 = byte;
                this.expecting = "status";
                return true; // Return true when a complete MIDI message has been parsed
            }
        }
        return false; // Return false if the buffer does not contain a complete MIDI message
    }

    /**
     * Translates the parsed MIDI message type to a human-readable string.
     * @param {number} type - The parsed MIDI message type.
     * @returns {string} - The translated MIDI message type.
     */
    translateParsedType(type) {
        switch (type) {
            case 0x80:
                return 'NOTE_OFF';
            case 0x90:
                return 'NOTE_ON';
            case 0xA0:
                return 'POLYPHONIC_AFTERTOUCH';
            case 0xB0:
                return 'CONTROL_CHANGE';
            case 0xC0:
                return 'PROGRAM_CHANGE';
            case 0xD0:
                return 'CHANNEL_AFTERTOUCH';
            case 0xE0:
                return 'PITCH_BEND';
            default:
                return 'Unknown';
        }
    }

    /**
     * Gets the channel of a parsed MIDI data array.
     * @param {Array} midiDataArr - The parsed MIDI data array.
     * @returns {number|boolean} - The channel of the MIDI data array, or false if it is not a valid message.
     */
    getChannelMidiDataArr(midiDataArr) {
        if (midiDataArr[0] === 0xE0) {
            // Message is pitch bend
            return midiDataArr[1];
        } else if (midiDataArr[0] === 0x90 || midiDataArr[0] === 0x80) {
            return midiDataArr[2] - 104;
        } else {
            // Not a Pitch Bend or Control Change message
            return false;
        }
    }

    /**
     * Formats the parsed MIDI data array into a log message.
     * @param {Array} midiDataArr - The parsed MIDI data array.
     * @returns {string} - The formatted log message.
     */
    formatParsedLogMessageArr(midiDataArr) {
        const type = this.translateParsedType(midiDataArr[0]);
        const channel = this.getChannelMidiDataArr(midiDataArr)
        const msg = "MIDI DATA: TYPE: " + type + " CHANNEL: " + channel + " DATA1: " + midiDataArr[2] + " DATA2: " + midiDataArr[3];
        return msg;
    }

    /**
     * Converts the parsed MIDI data object to an array and returns a log message.
     * @param {Object} midiDataObject - The parsed MIDI data object.
     * @returns {string} - The formatted log message.
     * @deprecated This method is deprecated. Use formatParsedLogMessageArr instead.
     */
    formatParsedLogMessageObject(midiDataObject) {
        const msg = this.formatParsedMidiDataToArray(midiDataObject);
        return this.formatParsedLogMessageArr(msg);
    }

    /**
     * Converts the MIDI data object to an array.
     * @param {Object} midiDataObject - The MIDI data object.
     * @returns {Array} - The MIDI data array.
     */
    formatParsedMidiDataToArray(midiDataObject) {
        const midiData = [midiDataObject.type, midiDataObject.channel, midiDataObject.data1, midiDataObject.data2];
        return midiData;
    }

    /**
     * Converts the MIDI data array to a MIDI data object.
     * @param {Array} midiDataArray - The MIDI data array.
     * @returns {Object} - The MIDI data object.
     */
    formatParsedMidiDataArrToObject(midiDataArray) {
        const midiData = {
            type: midiDataArray[0],
            channel: midiDataArray[1],
            data1: midiDataArray[2],
            data2: midiDataArray[3]
        };
        return midiData;
    }

    // MIDI MESSAGE TOOLS

    /**
     * Gets the channel of a MIDI message array.
     * @param {Array} midiMessageArr - The MIDI message array.
     * @returns {number} - The channel of the MIDI message.
     */
    getChannelMIDIMessage(midiMessageArr) {
        return midiMessageArr[0] & 0x0F;
    }
    
    /**
     * Gets the channel of a note message array.
     * @param {Array} midiMessageArr - The note message array.
     * @returns {number} - The channel of the note message.
     */
    getChannelNOTEMessage(midiMessageArr) {
        return midiMessageArr[1] - 104;
    }
    
    /**
     * Formats a MIDI message array into a readable string for logging.
     * @param {Array} midiMessageArr - The MIDI message array.
     * @returns {string} - The formatted log message.
     */
    formatMIDIMessageLogArr(midiMessageArr) {
        const status = this.translateStatusByte(midiMessageArr[0]);
        let channel;
        if (status === 'NOTE_ON' || status === 'NOTE_OFF') {
            channel = this.getChannelNOTEMessage(midiMessageArr);
        } else {
            channel = this.getChannelMIDIMessage(midiMessageArr);
        }
        const msg = `MIDI MESSAGE: STATUS: ${status} CHANNEL: ${channel} DATA1: ${midiMessageArr[1]} DATA2: ${midiMessageArr[2]}`;
        return msg;
    }
    
    /**
     * Translates the status byte of a MIDI message to a human-readable string.
     * @param {number} statusByte - The status byte of the MIDI message.
     * @returns {string} - The translated status byte.
     */
    translateStatusByte(statusByte) {
        const messageType = statusByte & 0xF0; // Get the message type by masking the channel bits
        const channel = statusByte & 0x0F; // Get the channel by masking the message type bits
    
        let status;
        switch (messageType) {
          case 0x80:
            status = 'NOTE_OFF';
            break;
          case 0x90:
            status = 'NOTE_ON';
            break;
          case 0xA0:
            status = 'POLYPHONIC_AFTERTOUCH';
            break;
          case 0xB0:
            status = 'CONTROL_CHANGE';
            break;
          case 0xC0:
            status = 'PROGRAM_CHANGE';
            break;
          case 0xD0:
            status = 'CHANNEL_AFTERTOUCH';
            break;
          case 0xE0:
            status = 'PITCH_BEND';
            break;
          default:
            status = messageType;
        }
    
        return status;
    }
}

module.exports = MIDIParser;