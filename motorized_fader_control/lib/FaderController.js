

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
      this.progression = this.postitionToProgression(position);
    }

    postitionToProgression(position) {
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

  stop() {
    //method to stop the FaderController
    //resets the faders and closes the serial port
    dev_logger.info("### Stopping the FaderController...");
    try {
        this.resetFaders();
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
        if (this.parser.translateType(message[0]) === 'PROGRAM_CHANGE' && message[1] === 2 && message[2] === 160) {
            if (message[3] === 102) {
                received102 = true;
            } else if (message[3] === 116) {
                received116 = true;
            }

            if (received102 && received116) {
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
    if (this.parser.translateType(midiDataArr[0]) === 'PROGRAM_CHANGE') {
        this.MIDICache.push(midiDataArr);
    }
  }

  readAndParseData() {
    let midiDataArr;
    try {
        midiDataArr = this.parser.read();
        if (midiDataArr) {
            const logMessage = this.parser.formatLogMessageArr(midiDataArr);
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

  updateFaderInfo(midiDataArr) {
    let messageType = this.parser.translateType(midiDataArr[0]);
    let faderIndex;
  
    if (messageType === "PITCH_BEND") {
      faderIndex = this.parser.getFaderIndex(midiDataArr);
      this.faders[faderIndex].setPosition(midiDataArr[2] | (midiDataArr[3] << 7));
      if (this.faders[faderIndex].echo_mode) {
        this.echo(midiDataArr);
      }
    } else if (messageType === "NOTE_ON") {
      faderIndex = this.parser.getFaderIndex(midiDataArr);
      this.faders[faderIndex].setTouch(true);
    } else if (messageType === "NOTE_OFF") {
      faderIndex = this.parser.getFaderIndex(midiDataArr);
      this.faders[faderIndex].setTouch(false);
    }
  
    if (faderIndex !== undefined) {
      const msg = this.faders[faderIndex].getInfoLog();
      this.logger.debug("FADER INFO UPDATED: " + msg);
    }
  }

  //send message #############################################

  sendMessageObj(index, messageObj) {
      this.ser_port.write([messageObj.type, messageObj.data1, messageObj.data2]);
      const msg = this.parser.formatLogMessageObject(messageObj);
      this.logger.debug('Message sent to fader at index: ' + index);
      this.logger.debug('Message Sent: ' + msg);
  }
  sendMessageArr(index, messageArr) {
    this.ser_port.write([messageArr[0], messageArr[2], messageArr[3]]);
    const msg = this.parser.formatLogMessageArr(messageArr);
    this.logger.debug('Message sent to fader at index: ' + index);
    this.logger.debug('Message Sent: ' + msg);
}
    
  echo(midiDataArr) {
    //method to echo the MIDI messages back to the faders
    let index = this.parser.getFaderIndex(midiDataArr);
    midiDataArr[0] = midiDataArr[0] | midiDataArr[1];
    this.sendMessageArr(index, midiDataArr);
  }
    
  setFaderProgression(indexes, progression) {
   if (!Array.isArray(indexes)) {
      indexes = [indexes]; // This will create an array with the single index
    }
  
    indexes.forEach(index => {
      this.faders[index].setProgression(progression);
      const position = this.faders[index].position;
      this.setFaderPosition([index], position);
    });
  }
  
  setFaderPosition(indexes, position) {
    if (!Array.isArray(indexes)) {
      indexes = [indexes]; // This will create an array with the single index
    }

    indexes.forEach((index, i) => {
      setTimeout(() => {
        this.faders[index].setPosition(position);
        const message = {
          type: 0xE0 | (index -1),
          channel: index,
          data1: position & 0x7F,
          data2: position >> 7
        };
        this.sendMessageObj(index, message);
        const msg = this.faders[index].getInfoLog(index);
        this.logger.debug('Fader position set to: ' + msg);
      }, i * 100); // Delay each message by 100ms
    });
  }

  resetFaders(indexes) {
    // If indexes is undefined, reset all faders
    if (indexes === undefined) {
      indexes = Object.keys(this.faders).map(Number); // Convert keys to numbers
    } else if (!Array.isArray(indexes)) {
      indexes = [indexes]; // If indexes is not an array, convert it to an array
    }
  
    this.logger.debug("Resetting faders with indexes: ", indexes);
    indexes.forEach(index => {
      if (this.faders[index]) {
        this.setFaderProgression(index, 0);
      } else {
        this.logger.error('Invalid fader index: ' + index);
      }
    });
    return true
  }

  //MOVEMENT ###################################

  echo(midiDataArr) {
      //method to echo the MIDI messages back to the faders
      if (this.parser.translateType(midiDataArr[0]) === "PITCH BEND") {
        // Convert the 14-bit MIDI value back into a progression value
        this.sendMessageArr(midiDataArr.channel, midiDataArr);
      }
  }

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
          this.setFaderProgression(index, m);
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
        this.setFaderPosition(index, targetPosition);
      } else if (speed === 0) {
        // Do nothing
      } else {
        for (let i = 0; i < numSteps; i++) {
          ((i) => {
            setTimeout(() => {
              const newPosition = currentPosition + (i * stepSize);
              this.setFaderPosition(index, newPosition);
            }, 0);
          })(i);
        }
      }
    });
  }
}

module.exports = FaderController;