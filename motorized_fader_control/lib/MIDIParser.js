

// Path: lib/MIDIParser.js
// MIDIParser.js


const { Transform } = require('stream');



class MIDIParser extends Transform {
    
    constructor(options) {
        super(options);
        this.expecting = "status";
        this.type = 0;
        this.channel = 0;
        this.data1 = 0;
        this.data2 = 0;
        this.buffer = []; // Add a buffer to store incoming MIDI messages
    }

    _transform(chunk, encoding, callback) {
        for (let i = 0; i < chunk.length; i++) {
            this.buffer.push(chunk[i]); // Add each byte to the buffer
    
            // Only parse the message when a complete MIDI message has been received
            if (this.buffer.length >= 3) {
                if (this.parse(this.buffer)) {
                    const midiData = {
                        type: this.buffer[0], // Send the type as a binary value
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

    translateType(type) {
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



    // missing method to translate a MIDImessage into a log

    // missing methods
    formatLogMessage(midiData) {
        const type = translateType(midiData[0])
        const msg = "MIDI MESSAGE: TYPE: " + midiData.[0] 
    }

}

module.exports = MIDIParser;