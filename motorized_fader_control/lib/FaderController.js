

const SerialPort = require('serialport'); // import the SerialPort module 
const MIDIParser = require('./MIDIParser'); // import the MIDIParser


// temporary winston logger //will remove
const winston = require('winston'); //logger needs to be the volumio logger instead.

const dev_logger = winston.createLogger({
  level: 'debug',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
  ],
});

if (process.env.NODE_ENV !== 'production') {
  dev_logger.add(new winston.transports.Console({
    format: winston.format.simple(),
  }));
}



class Fader {
    constructor(index) {
      this.index = index;
      this.position = 0; // 14-bit integer
      this.progression = 0; // Progression of the fader
      this.touch = false; // Whether the fader is currently being touched
      this.onTouch = null; // Callback for touch event
      this.onUntouch = null; // Callback for untouch event
      this.echo_mode = false;
    }
  
    setTouchCallback(callback) {
      this.onTouch = callback;
    }

    setUntouchCallback(callback) {
      this.onUntouch = callback;
    }

    setEchoMode(echo_mode) {
      this.echo_mode = echo_mode;
    }

    setTouch(touch) {
      //method to set the touch state of the fader
      //if the touch state changes, call the onTouch or onUntouch callback
      if (this.touch !== touch) {
        this.touch = touch;
        if (touch && this.onTouch) {
          this.onTouch(this.index);
        } else if (!touch && this.onUntouch) {
          this.onUntouch(this.index);
        }
      }
    }

    setProgression(progression) {
      this.progression = progression;
      //also update position accordingly
      this.position = this.progressionToPosition(progression);
    }

    setPosition(position) {
      this.position = position;
      //also update progression accordingly
      this.progression = this.positionToProgression(position);
    }

    positionToProgression(position) {
      // convert a 14bit integer to a 0-100 float value
    return position / 16383 * 100;
    }

    progressionToPosition(progression) {
      //convert a 0-100 float value to a 14bit integer
    return progression / 100 * 16383;
    }

    getInfoLog() {
      //returns a human readable log message for the fader at index
      const msg = "FADER INFO: index: " + this.index + " position: " + this.position + " progression: " + this.progression + " touch: " + this.touch + " echo_mode: " + this.echo_mode;
      return msg;
    }

    getInfoDict() {
      //returns a dictionary of the fader infos
      const dict = {
          "index": this.index,
          "position": this.position,
          "progression": this.progression,
          "touch": this.touch,
          "echo_mode": this.echo_mode
      };
  
      return dict;
  }

    getPosition() {
      return this.position
    }

    getProgression() {
      return this.progression
    }

    getTouchState() {
      return this.touch
    }

    getEchoState() {
      return this.echo
    }

}

class FaderController {
  constructor(logger = dev_logger, fader_count = 12) {
    this.fader_count = this.fader_count    // create an array of 12 faders of the Fader class
    this.faders = Array.from({ length: fader_count }, (_, i) => new Fader(i));
    this.ser_port = null;
    this.parser = null;
    this.logger = logger;

    this.MIDICache = [];
    this.MIDIDeviceReady = false;
    this.maxCacheDeviceReadiness = 3

    this.messageQueue = [];
    this.sendingMessage = false;
  }

  setOnTouchCallback(index, callback) {
    this.faders[index].setTouchCallback(callback);
  }

  setOnUntouchCallback(index, callback) {
    this.faders[index].setUntouchCallback(callback);
  }

  setupSerial(ser_port_path, baud_rate) {
    try {
      //method to initialize the serial port and parser
      dev_logger.debug("### Initializing SerialPort..");
      this.ser_port = new SerialPort(ser_port_path, { baudRate: baud_rate });
      this.parser = new MIDIParser();
      this.ser_port.pipe(this.parser);
      dev_logger.info("### SerialPort initialized.");
    } catch (error) {
      console.error('Error setting up serial port and parser:', error);
    }
  }

  start() {
    try {
      dev_logger.debug('### Starting the FaderController...');

      if (!this.ser_port) {
        dev_logger.error('SerialPort is not initialized');
        return;
      }
      
      // Set up the serial port listeners
      this.setupPortListeners();

      // Start reading data
      this.parser.on('readable', () => {
          this.readAndParseData();
      });
      
      dev_logger.info('### FaderController started!')
    } catch (error) {
      dev_logger.error('Error starting FaderController: ', error);
    }
  }

  // better option is to set the stream callbacks listeners in a seperate method for
  // open, close, err, readable...
  setupPortListeners() {
    this.ser_port.on('open', () => {
      this.logger.debug('SerialPort is opened: ' + this.ser_port.path);
    });

    this.ser_port.on('err', (err) => {
      this.logger.error('SerialPort error: ' + err);
    });
  }

  closeSerial() {
    //close serial port
    this.ser_port.close((err) => {
      if (err) {
        this.logger.error('Error closing serial port: ', err);
      } else {
        this.logger.info('SerialPort is closed');
      }
    });

  }

  handleMIDIDeviceNotReady() {
    this.logger.error('MIDI device did not report readiness. Stopping FaderController...');
    this.stop();
  }

  async stop() {
    // Method to stop the FaderController
    // Resets the faders, waits for all messages to be sent, then closes the serial port
    dev_logger.info("### Stopping the FaderController...");
    try {
      this.resetFaders();
  
      // Wait for all messages to be sent
      await this.allMessagesSent();
  
      this.ser_port.removeAllListeners();
      this.closeSerial();
      this.logger.info("### FaderController stopped");
    } catch (error) {
      this.logger.error("An error occurred while stopping the FaderController: " + error);
    }
  }



  CheckMIDIDeviceReady(callback, max_cache) {
    let cacheCount = 0;
    let received102 = false;
    let received116 = true; //fir sime reason doesnt work atm, something blocks 

    // Assuming midiCache is an array of MIDI messages
    for (let message of this.MIDICache) {
      this.logger.debug("Waiting for MIDI device ready...")
        if (this.parser.translateParsedType(message[0]) === 'PROGRAM_CHANGE' && message[2] === 160) {
            if (message[3] === 102) {
                received102 = true;
            } else if (message[3] === 116) {
                received116 = true;
            }

            if (received102 || received116) {
                this.logger.info('MIDI device is ready');
                this.MIDIDeviceReady = true;
                callback(true);
                return true;
            }
        }

        cacheCount++;
        if (cacheCount >= max_cache) {
            this.logger.debug("Max Cache reached." + cacheCount + " of " + max_cache + " messages read.");
            callback(false);
            this.MIDIDeviceReady = false;
            return false;
        }
    }
  }
  cacheProgramChangeMessages(midiDataArr) {
    // Cache MIDI Messages that are Program Change Messages
    // They are expected to be the first 10 or so
    if (this.parser.translateParsedType(midiDataArr[0]) === 'PROGRAM_CHANGE') {
        this.MIDICache.push(midiDataArr);
    }
  }

  readAndParseData() {
    let midiDataArr;
    try {
        midiDataArr = this.parser.read();
        if (midiDataArr) {
            const logMessage = this.parser.formatParsedLogMessageArr(midiDataArr);
            this.logger.debug(logMessage);
            this.updateFaderInfo(midiDataArr);
            if (this.MIDIDeviceReady === false) {
              this.cacheProgramChangeMessages(midiDataArr);
              this.CheckMIDIDeviceReady((isReady) => {
                  if (!isReady) {
                      this.handleMIDIDeviceNotReady(); 
                  }
              }, this.maxCacheDeviceReadiness);
            }
        }
    } catch (error) {
      this.logger.error('Error reading data:' + error);
    }
  }

  //info handling ################################

  getInfoDict(indexes) {
    //returns a dictionary containing the information for the specified faders
    //if it is more than 1 fader, it contains an array of dictionaries
    //we can use this.faders.getInfoDict() for each fader obj
    if (indexes === undefined) {
        indexes = Object.keys(this.faders).map(Number);
    } else if (!Array.isArray(indexes)) {
        indexes = [indexes]; // If indexes is not an array, convert it to an array
    }

    const dicts = indexes.map(index => {
        if (this.faders[index]) {
            return this.faders[index].getInfoDict();
        } else {
            this.logger.error('Invalid fader index: ' + index);
            return null;
        }
    }).filter(dict => dict !== null);

    return dicts;
  }

  isMIDIDeviceReady() {
    return this.MIDIDeviceReady
  }

  getFaderCount() {
    return this.fader_count
  }

  getFaderIndexMidiDataArr(midiDataArr) {
    //method to return the 0 based fader index from a parsed midi DataArr
    let index = this.parser.getChannelMidiDataArr(midiDataArr)
    return index
  }

  updateFaderInfo(midiDataArr) {
    let messageType = this.parser.translateParsedType(midiDataArr[0]);
    let faderIndex;
  
    if (messageType === "PITCH_BEND") {
      faderIndex = this.getFaderIndexMidiDataArr(midiDataArr);
      this.faders[faderIndex].setPosition(midiDataArr[2] | (midiDataArr[3] << 7));
      if (this.faders[faderIndex].echo_mode) {
        this.echo(midiDataArr);
      }
    } else if (messageType === "NOTE_ON") {
      faderIndex = this.getFaderIndexMidiDataArr(midiDataArr);
      this.faders[faderIndex].setTouch(true);
    } else if (messageType === "NOTE_OFF") {
      faderIndex = this.getFaderIndexMidiDataArr(midiDataArr);
      this.faders[faderIndex].setTouch(false);
    }
  
    if (faderIndex !== undefined) {
      const msg = this.faders[faderIndex].getInfoLog();
      this.logger.debug("FADER INFO UPDATED: " + msg);
    }
  }



  //send message #############################################

  sendMessageObj(messageObj) {  // ! dont use this anymoe ! deprecated
      this.ser_port.write([messageObj.type, messageObj.data1, messageObj.data2]);
      const msg = this.parser.formatParsedLogMessageObject(messageObj);
      this.logger.debug('Message Sent: ' + msg);
  }

  sendMIDIMessageArr(messageArr) {
    this.messageQueue.push(messageArr);
    this.sendNextMessage();
  }

  sendNextMessage() {
    return new Promise((resolve, reject) => {
      if (this.sendingMessage || this.messageQueue.length === 0) {
        resolve();
        return;
      }
  
      this.sendingMessage = true;
      const messageArr = this.messageQueue.shift();
  
      this.ser_port.write([messageArr[0], messageArr[1], messageArr[2]], (err) => {
        this.sendingMessage = false;
  
        if (err) {
          this.logger.error('Error on write: ' + err.message);
          reject(err);
        } else {
          const msg = this.parser.formatMIDIMessageLogArr(messageArr);
          this.logger.debug('MIDI Message Sent: ' + msg);
          this.logger.debug('MIDI Message sent: ' + messageArr[0] + " : " + messageArr[1] + " : " + messageArr[2])
          resolve();
        }
  
        // Send the next message in the queue
        this.sendNextMessage();
      });
    });
  }

  allMessagesSent() {
    return new Promise((resolve) => {
      const checkMessagesSent = () => {
        if (this.sendingMessage || this.messageQueue.length > 0) {
          // If a message is being sent or the queue is not empty, check again later
          setTimeout(checkMessagesSent, 100);
        } else {
          // If no message is being sent and the queue is empty, all messages have been sent
          resolve();
        }
      };
  
      checkMessagesSent();
    });
  }
      
  echo(midiDataArr) {   // needs fixing
    //method to echo the MIDI messages back to the faders
    //we need to reverse engineer the parsing. and then send it back
    midiDataArr[0] = midiDataArr[0] | midiDataArr[1];
    message = [midiDataArr[0], midiDataArr[2], midiDataArr[3]];
    this.sendMIDIMessageArr(message);
  }
    
  sendFaderProgression(indexes, progression) {
    if (!Array.isArray(indexes)) {
      indexes = [indexes]; // This will create an array with the single index
    }
    this.logger.debug('Sending PROGRESSION ' + progression + ' to fader with index(es): ' + indexes)
    for (let index of indexes) {
      this.faders[index].setProgression(progression);
      const position = this.faders[index].position;
      this.sendFaderPosition([index], position);
    }

  }
  
  sendFaderPosition(indexes, position) {
    if (!Array.isArray(indexes)) {
      indexes = [indexes]; // This will create an array with the single index
    }
  
    indexes.forEach((index) => {
      try {
        this.faders[index].setPosition(position);
        // Construct a Midi Message
        const message = [
          0xE0 | (index),
          position & 0x7F,
          (position >> 7) & 0x7F
        ];
        this.sendMIDIMessageArr(message);
        const msg = this.faders[index].getInfoLog(index);
        this.logger.debug('Fader with index: ' + index + ' position set to: ' + position);
      } catch (error) {
        this.logger.error('Error setting fader position: ', error);
      }
    });
  }

  resetFaders(indexes) {
    // If indexes is undefined, reset all faders
    if (indexes === undefined) {
      indexes = Object.keys(this.faders).map(Number);
    } else if (!Array.isArray(indexes)) {
      indexes = [indexes]; // If indexes is not an array, convert it to an array
    }
  
    this.logger.debug("Resetting faders with indexes: "+ indexes);
    indexes.forEach(index => {
      if (this.faders[index]) {
        this.sendFaderProgression(index, 0);
      } else {
        this.logger.error('Invalid fader index: ' + index);
      }
    });
    return true;
  }

  //MOVEMENT ###################################

  faderCalibration(indexes, movement, base_point) {
    // If indexes is undefined, calibrate all faders
    if (indexes === undefined) {
      indexes = Object.keys(this.faders); // Use the indices of this.faders
    } else if (!Array.isArray(indexes)) {
      indexes = [indexes]; // If indexes is not an array, convert it to an array
    }
  
    // For each index, calibrate the fader at that index
    indexes.forEach(index => {
      if (this.faders[index]) {
        this.logger.info('Calibrating fader with index: '+ index);
        movement.forEach(m => {
          this.sendFaderProgression(index, m);
        });
      } else {
        this.logger.error('Invalid fader index: ' + index);
      }
    });
    return true;
  }

  /**
   * Moves a fader to a target progression value at a given speed.
   *
   * @param {number} index - The index of the fader in the `faders` array. Or an array of indexes
   * @param {number} targetProgression - The target progression value to which the fader should be moved. This value must be between 0 and 100, inclusive.
   * @param {number} speed - The speed at which the fader should be moved. This value must be between 0 and 100, inclusive.
   * @param {number} [resolution=100] - The resolution of the movement.
   * @throws {Error} Will throw an error if `targetProgression` is less than 0 or greater than 100.
   * @throws {Error} Will throw an error if `speed` is less than 0 or greater than 100.
   */
  move_to(indexes, targetProgression, speed, resolution = 100) {
    if (targetProgression < 0 || targetProgression > 100) {
      throw new Error('Error in Move_To: Progression value must be between 0 and 100');
    }
  
    if (speed < 0 || speed > 100) {
      throw new Error('Error in Move_To: Speed value must be between 0 and 100');
    }
  
    // If indexes is undefined or not an array, convert it to an array
    if (!Array.isArray(indexes)) {
      indexes = [...this.faders.keys()]; // This will create an array [0, 1, 2, ..., n-1] where n is the number of faders
    }
  
    // For each index, move the fader at that index
    indexes.forEach(index => {
      const fader = this.faders[index];
      const currentPosition = fader.progressionToPosition(fader.progression);
      const targetPosition = fader.progressionToPosition(targetProgression);
      const totalSteps = Math.abs(targetPosition - currentPosition);
      const stepSize = totalSteps * (speed / 100);
      const numSteps = Math.ceil(totalSteps / (resolution / 100));
  
      if (speed === 100) {
        this.sendFaderPosition(index, targetPosition);
      } else if (speed === 0) {
        // Do nothing
      } else {
        for (let i = 0; i < numSteps; i++) {
          ((i) => {
            setTimeout(() => {
              const newPosition = currentPosition + (i * stepSize);
              this.sendFaderPosition(index, newPosition);
            }, 0);
          })(i);
        }
      }
    });
  }


}

module.exports = FaderController;