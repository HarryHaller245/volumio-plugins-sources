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

    getChannelMidiDataArr(midiDataArr) {
        //returns the channel of a parsed midi Data Array
        //similiar to getFaderIndexParsedArr but the index is 1 based
        if (midiDataArr[0] === 0xE0) {
            //Message is pitch bend
            return midiDataArr[1];
        } else if (midiDataArr[0] === 0x90 || midiDataArr[0] === 0x80) {
            return midiDataArr[2] - 104;
        } else {
            //not a Pitch Bend or Control Change message
            return false;
        }
    }

    formatParsedLogMessageArr(midiDataArr) {
        const type = this.translateParsedType(midiDataArr[0]);
        const channel = this.getChannelMidiDataArr(midiDataArr)
        const msg = "MIDI DATA: TYPE: " + type + " CHANNEL: " + channel + " DATA1: " + midiDataArr[2] + " DATA2: " + midiDataArr[3];
        return msg;
    }

    formatParsedLogMessageObject(midiDataObject) { //!! deprecated
        // Convert the MIDI message object to an array and returns a log message
        const msg = this.formatParsedMidiDataToArray(midiDataObject);
        return this.formatParsedLogMessageArr(msg);
    }

    formatParsedMidiDataToArray(midiDataObject) {
        // convert MidiDataObject to Array
        const midiData = [midiDataObject.type, midiDataObject.channel, midiDataObject.data1, midiDataObject.data2];
        return midiData;
    }

    formatParsedMidiDataArrToObject(midiDataArray) {
        // convert MidiData Array to MidiDataObject
        const midiData = {
            type: midiDataArray[0],
            channel: midiDataArray[1],
            data1: midiDataArray[2],
            data2: midiDataArray[3]
        };
    return midiData 
    }


    // MIDI MESSAGE TOOLS

    getChannelMIDIMessage(midiMessageArr) {
        // use the MIDI message to retrieve the channel of a midi message array containing the 3 bytes
        return midiMessageArr[0] & 0x0F;
    }
    
    getChannelNOTEMessage(midiMessageArr) {
        // use the MIDI message to retrieve the channel of a midi message array containing the 3 bytes
        // in case of a note on/off message the channel is the second byte - 103
        return midiMessageArr[1] - 104;
    }
    
    formatMIDIMessageLogArr(midiMessageArr) {
        //formats a Midi Message array, consisting of the 3 bytes into readable string to be logged
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
    
    translateStatusByte(StatusByte) {
        const messageType = StatusByte & 0xF0; // Get the message type by masking the channel bits
        const channel = StatusByte & 0x0F; // Get the channel by masking the message type bits
    
        let Status;
        switch (messageType) {
          case 0x80:
            Status = 'NOTE_OFF';
            break;
          case 0x90:
            Status = 'NOTE_ON';
            break;
          case 0xA0:
            Status = 'POLYPHONIC_AFTERTOUCH';
            break;
          case 0xB0:
            Status = 'CONTROL_CHANGE';
            break;
          case 0xC0:
            Status = 'PROGRAM_CHANGE';
            break;
          case 0xD0:
            Status = 'CHANNEL_AFTERTOUCH';
            break;
          case 0xE0:
            Status = 'PITCH_BEND';
            break;
          default:
            Status = messageType;
        }
    
        return Status;
    }
}
module.exports = MIDIParser;