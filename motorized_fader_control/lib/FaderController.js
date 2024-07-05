const SerialPort = require('serialport'); // import the SerialPort module 
const MIDIParser = require('./MIDIParser'); // import the MIDIParser


//! temporary winston logger //will remove
//! pass the volumio logger to the FaderController Module instead
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





/**
 * Represents a fader object. Holds the information of a motorized fader
 */
class Fader {
  /**
   * Creates a new instance of the Fader class.
   * @param {number} index - The index of the fader.
   */
  constructor(index) {
    this.index = index;
    this.position = 0; // 14-bit integer
    this.progression = 0; // Progression of the fader
    this.touch = false; // Whether the fader is currently being touched
    this.onTouch = null; // Callback for touch event
    this.onUntouch = null; // Callback for untouch event
    this.echo_mode = false;
  }

  /**
   * Sets the callback function for the touch event.
   * @param {Function} callback - The callback function to be called when the fader is touched.
   */
  setTouchCallback(callback) {
    this.onTouch = callback;
  }

  /**
   * Sets the callback function for the untouch event.
   * @param {Function} callback - The callback function to be called when the fader is untouched.
   */
  setUntouchCallback(callback) {
    this.onUntouch = callback;
  }

  /**
   * Sets the echo mode of the fader.
   * @param {boolean} echo_mode - The echo mode to be set.
   */
  setEchoMode(echo_mode) {
    this.echo_mode = echo_mode;
  }

  /**
   * Sets the touch state of the fader.
   * If the touch state changes, calls the onTouch or onUntouch callback.
   * @param {boolean} touch - The touch state to be set.
   */
  setTouch(touch) {
    if (this.touch !== touch) {
      this.touch = touch;
      if (touch && this.onTouch) {
        this.onTouch(this.index);
      } else if (!touch && this.onUntouch) {
        this.onUntouch(this.index);
      }
    }
  }

  /**
   * Sets the progression of the fader.
   * Also updates the position accordingly.
   * @param {number} progression - The progression value to be set.
   */
  setProgression(progression) {
    this.progression = progression;
    // also update position accordingly
    this.position = this.progressionToPosition(progression);
  }

  /**
   * Sets the position of the fader.
   * Also updates the progression accordingly.
   * @param {number} position - The position value to be set.
   */
  setPosition(position) {
    this.position = position;
    // also update progression accordingly
    this.progression = this.positionToProgression(position);
  }

  /**
   * Converts a position value to a progression value.
   * @param {number} position - The position value to be converted.
   * @returns {number} The converted progression value.
   */
  positionToProgression(position) {
    // convert a 14-bit integer to a 0-100 float value
    return (position / 16383) * 100;
  }

  /**
   * Converts a progression value to a position value.
   * @param {number} progression - The progression value to be converted.
   * @returns {number} The converted position value.
   */
  progressionToPosition(progression) {
    if (progression < 0 || progression > 100) {
        throw new Error('Progression must be between 0 and 100');
    }
    // convert a 0-100 float value to a 14-bit integer
    return Math.round((progression / 100) * 16383);
}

  /**
   * Returns a human-readable log message for the fader.
   * @returns {string} The log message.
   */
  getInfoLog() {
    const msg =
      "FADER INFO: index: " +
      this.index +
      " position: " +
      this.position +
      " progression: " +
      this.progression +
      " touch: " +
      this.touch +
      " echo_mode: " +
      this.echo_mode;
    return msg;
  }

  /**
   * Returns a dictionary of the fader information.
   * @returns {Object} The dictionary containing the fader information.
   */
  getInfoDict() {
    const dict = {
      index: this.index,
      position: this.position,
      progression: this.progression,
      touch: this.touch,
      echo_mode: this.echo_mode,
    };

    return dict;
  }

  /**
   * Returns the position of the fader.
   * @returns {number} The position value.
   */
  getPosition() {
    return this.position;
  }

  /**
   * Returns the progression of the fader.
   * @returns {number} The progression value.
   */
  getProgression() {
    return this.progression;
  }

  /**
   * Returns the touch state of the fader.
   * @returns {boolean} The touch state.
   */
  getTouchState() {
    return this.touch;
  }

  /**
   * Returns the echo state of the fader.
   * @returns {boolean} The echo state.
   */
  getEchoState() {
    return this.echo;
  }
}



/**
 * Represents a fader move operation.
 */
class FaderMove {
  /**
   * Creates a new instance of the FaderMove class.
   * @param {number|Array<number>} idx - The index or indexes of the faders.
   * @param {number|Array<number>} targetProgression - The target progression value(s).
   * @param {number|Array<number>} speed - The speed(s) of the fader move operation(s). From 0-100. 0 being no move 100 being instant
   */
  constructor(idx, targetProgression, speed) {
    this.idx = Array.isArray(idx) ? idx : [idx];
    this.targetProgression = Array.isArray(targetProgression) ? targetProgression : Array(this.idx.length).fill(targetProgression);
    this.speed = Array.isArray(speed) ? speed : Array(this.idx.length).fill(speed);
  }

  /**
   * Returns a dictionary representation of the fader move operation.
   * @returns {Object} - The dictionary representation of the fader move operation.
   */
  getDict() { //! deprecated use the class object
    return {
      idx: this.idx,
      targetProgression: this.targetProgression,
      speed: this.speed
    };
  }
}

/**
 * Represents a fader controller.
 */
class FaderController {
  /**
   * Creates a new instance of the FaderController class.
   * @param {Object} logger - The logger object for logging messages.
   * @param {number} fader_count - The number of faders.
   * @param {number} messageRateLimit - The rate limit for sending messages.
   * @param {boolean} MIDILog - Whether to log MIDI messages.
   * @param {Array<number>} speeds - The standard speeds used. [fastSpeed, mediumSpeed, slowSPeed]
   * 
   */
  constructor(logger = dev_logger, fader_count = 1, messageRateLimit = 100, MIDILog = false, speeds = [80, 50, 10]) {
    this.fader_count = fader_count;
    this.faders = null;
    this.ser_port = null;
    this.parser = null;
    this.logger = logger;
    this.MIDILog = MIDILog

    this.MIDICache = [];
    this.MIDIDeviceReady = false;
    this.maxCacheDeviceReadiness = 3;

    this.messageQueue = [];
    this.messageQueues = [];
    this.sendingMessage = false;

    this.lastMessageTime = 0;
    this.messageRateLimit = messageRateLimit; // Limit

    this.speedFast = speeds[0]
    this.speedMedium = speeds[1]
    this.speedSlow = speeds[2]
  }

  /**
   * Method to update the config of a running FaderController.
   * Only variables can be modified by this method, such as the messageRateLimit.
   *
   * @param {number} messageRateLimit - The new message rate limit value.
   * @param {array} speeds - The standard speeds used. [fastSpeed, mediumSpeed, slowSPeed]
   */
  configure_vars(messageRateLimit, speeds) {
    //method to update the config of a running FaderController
    //I.e only variables can be modified by this
    // messageRateLimit for example
    this.messageRateLimit = messageRateLimit;
    this.speedFast = speeds[0]
    this.speedMedium = speeds[1]
    this.speedSlow = speeds[2]
  }

  configure() {
    //method setting the startup config
    this.setupFadersArray(this.fader_count);
  }


  /**
   * Sets the callback function for the touch event of a fader.
   * @param {number} index - The index of the fader.
   * @param {Function} callback - The callback function to be called when the fader is touched.
   */
  setOnTouchCallback(index, callback) {
    //! update this to accept an array of indexes as well
    this.faders[index].setTouchCallback(callback);
  }

  /**
   * Sets the callback function for the untouch event of a fader.
   * @param {number} index - The index of the fader.
   * @param {Function} callback - The callback function to be called when the fader is untouched.
   */
  setOnUntouchCallback(index, callback) {
    //! update this to accept an array of indexes as well
    this.faders[index].setUntouchCallback(callback);
  }

  setupFadersArray(fader_count) {
    return new Promise((resolve, reject) => {
      if (fader_count < 0 || fader_count > 16) {
        reject(new Error('Invalid fader count. The fader count must be between 0 and 16.'));
      } else {
        if (fader_count > 4) {
          logger.warn('Configured with more than 4 faders. The tested MIDIDevice only supports 4 faders.');
          logger.warn('The tested MIDIDevice is an arduino micro running: https://tttapa.github.io/Pages/Arduino/Control-Theory/Motor-Fader/');
        }
        this.faders = Array.from({ length: fader_count }, (_, i) => new Fader(i));
        resolve();
      }
    });
  }

  /**
   * Sets up the serial port and parser.
   * @param {string} ser_port_path - The path of the serial port.
   * @param {number} baud_rate - The baud rate of the serial port.
   * @returns {Promise} A promise that resolves when the serial port and parser are successfully set up.
   */
  setupSerial(ser_port_path, baud_rate) {
    return new Promise((resolve, reject) => {
      try {
        this.logger.info("### Initializing SerialPort: " + ser_port_path + " at baud rate: " + baud_rate);
        this.ser_port = new SerialPort(ser_port_path, { baudRate: baud_rate });
        this.parser = new MIDIParser();
        this.ser_port.pipe(this.parser);
        this.logger.info("### SerialPort initialized.");
        resolve();
      } catch (error) {
        console.error("Error setting up serial port and parser:", error);
        this.parser = null;
        this.ser_port = null;
        reject(error);
      }
    });
  }

  /**
   * Starts the fader controller.
   * @returns {Promise} A promise that resolves if the controller was started successfully, or rejects if an error occurs.
   */
start() {
    return new Promise(async (resolve, reject) => {
      try {
        this.logger.debug("### Starting the FaderController...");

        if (!this.ser_port || !this.parser) {
          this.logger.error("Serial port and parser not set up.");
          reject(new Error("Serial port and parser not set up."));
          return;
        }

        this.configure();

        this.setupPortListeners();

        // Start reading data
        this.parser.on("readable", () => {
          this.readAndParseData();
        });
        
        this.logger.info("### FaderController started!");

        resolve();
      } catch (error) {
        this.logger.error("Error starting FaderController: ", error);
        reject(error);
      }
    });
  }

  /**
   * Sets up the listeners for the serial port events.
   */
  setupPortListeners() {
    this.ser_port.on("open", () => {
      this.logger.debug("SerialPort is opened: " + this.ser_port.path);
    });

    this.ser_port.on("err", (err) => {
      this.logger.error("SerialPort error: " + err);
    });
  }

  /**
   * Closes the serial port.
   */
  closeSerial() {
    this.ser_port.close((err) => {
      if (err) {
        this.logger.error("Error closing serial port: ", err);
      } else {
        this.logger.info("SerialPort is closed");
      }
    });
  }

  /**
   * Handles the case when the MIDI did not report readiness.
   */
  handleMIDIDeviceNotReady() {

    this.logger.error("MIDI device did not report readiness.");
    this.emit('MIDIDeviceNotReady');
    
  }

  /**
   * Stops the fader controller.
   * Resets the faders, waits for all messages to be sent, then closes the serial port.
   * @returns {Promise} A promise that resolves when the fader controller is stopped.
   */
  stop() {
    this.logger.info("### Stopping the FaderController...");
    return new Promise(async (resolve, reject) => {
      try {
        await this.reset(undefined);
        this.ser_port.removeAllListeners();
        this.logger.info("### FaderController stopped");
        resolve();
      } catch (error) {
        this.logger.error("An error occurred while stopping the FaderController: " + error);
        reject(error);
      }
    });
  }

  CheckMIDIDeviceReady(callback, max_cache) {
    return new Promise((resolve, reject) => {
      let cacheCount = 0;
      let received102 = false;
      let received116 = true; // ! for some reason doesnt work atm, something blocks 

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
            resolve(true);
            return;
          }
        }

        cacheCount++;
        if (cacheCount >= max_cache) {
          this.logger.debug("Max Cache reached." + cacheCount + " of " + max_cache + " messages read.");
          callback(false);
          this.MIDIDeviceReady = false;
          resolve(false);
          return;
        }
      }
    });
  }

  cacheProgramChangeMessages(midiDataArr) {
    // Cache MIDI Messages that are Program Change Messages
    // They are expected to be the first 10 or so
    if (this.parser.translateParsedType(midiDataArr[0]) === 'PROGRAM_CHANGE') {
        this.MIDICache.push(midiDataArr);
    }
  }

  /**
   * Reads and parses MIDI data.
   */
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

  // info handling ################################

  /**
   * Returns a dictionary containing the information for the specified faders.
   * If it is more than 1 fader, it contains an array of dictionaries.
   *
   * @param {number[]|number} [indexes] - The indexes of the faders to get information for.
   * If not provided, information for all faders will be returned.
   * @returns {Object[]} - An array of dictionaries containing the information for the specified faders.
   * If an invalid fader index is encountered, it will be skipped and not included in the result.
   */
  getInfoDict(indexes) {
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
        this.echo_midi(midiDataArr);
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

    /**
   * Sends an array of MIDI messages.
   *
   * Each MIDI message should be an array of three numbers:
   * - The first number is the status byte, which should be between 128 and 255.
   * - The second and third numbers are the data bytes, which should be between 0 and 127.
   *
   * @param {Array<Array<number>>} messages - An array of MIDI messages to send.
   * @returns {Promise} A Promise that resolves when all messages have been sent.
   */
  sendMIDIMessages(messages) {
    //sends an array of messageArrays
    return new Promise(async (resolve, reject) => {
      // Add a new queue for the messages
      this.messageQueues.push({ messages, resolve, reject });
  
      // Start sending the messages
      try {
        await this.sendNextMessage();
      } catch (error) {
        reject(error);
      }
    });
  }

  sendNextMessage() {
    if (this.sendingMessage || this.messageQueues.length === 0) {
      return;
    }

    const now = Date.now();
    if (now - this.lastMessageTime < this.messageRateLimit) {
      setTimeout(() => this.sendNextMessage(), this.messageRateLimit - (now - this.lastMessageTime));
      return;
    }

    this.lastMessageTime = now;
    this.sendingMessage = true;

    // Get the next queue and message
    const queue = this.messageQueues[0];
    const messageArr = queue.messages.shift();

    this.ser_port.write([messageArr[0], messageArr[1], messageArr[2]], (err) => {
      this.sendingMessage = false;

      if (err) {
        this.logger.error('Error on write: ' + err.message);
        queue.reject(err);
      } else {
        const msg = this.parser.formatMIDIMessageLogArr(messageArr);
        if (this.MIDILog == true) {
          this.logger.debug('Sent: ' + msg);
        }
        // If the queue is empty, remove it and resolve the Promise
        if (queue.messages.length === 0) {
          this.messageQueues.shift();
          queue.resolve();
        }

        // Send the next message
        this.sendNextMessage();
      }
    });
  }    

  allMessagesSent() {
    return new Promise((resolve) => {
      const checkMessagesSent = () => {
        if (this.sendingMessage || this.messageQueue.length > 0) {
          // If a message is being sent or the queue is not empty, check again later
          setTimeout(checkMessagesSent, 10);
        } else {
          // If no message is being sent and the queue is empty, all messages have been sent
          resolve();
        }
      };
      checkMessagesSent();
    });
  }

  clearMessageQueue() {
    this.messageQueue = [];
  }

  clearMessagesByFaderIndexes(indexes) {
    this.messageQueue = this.messageQueue.filter((message) => {
      return !indexes.includes(message.index);
    });
  }

  ///
      
  echo_midi(midiDataArr) {   //! needs fixing
    //method to echo the MIDI messages back to the faders
    //we need to reverse engineer the parsing. and then send it back
    midiDataArr[0] = midiDataArr[0] | midiDataArr[1];
    message = [midiDataArr[0], midiDataArr[2], midiDataArr[3]];
    this.sendMIDIMessages([message]);
  }
  
  // MOVEMENT INTERMEDIATE MESSAGING LOGIC

  /**
   * Sends a progression value to one or more faders.
   * This function takes an index or an array of indexes and a progression or an array of progressions.
   * @param {Object} progressionsDict - A dictionary where the keys are fader indexes and the values are the progressions to send to the faders.
   */
  sendFaderProgressionsDict(progressionsDict) {
    //for example {0: [1,2,3,4,5], 1 : [1,2,3,4,5]}
    return new Promise(async (resolve, reject) => {
      const positionsDict = {};
      for (const [index, progressions] of Object.entries(progressionsDict)) {
        positionsDict[index] = progressions.map(progression => {
          const position = this.faders[index].progressionToPosition(progression);
          return position;
        });
      }
      const msg = Object.entries(positionsDict).map(([index, positions]) => {
        return `${index}: ${positions.length}`;
      }).join(', ');
      this.logger.debug(`(faderIdx):(AmountPositions): ${msg}`);

      this.logger.debug('Sending Progressions to faders: ' + JSON.stringify(progressionsDict));

      try {
        await this.sendFaderPositionsDict(positionsDict);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Sends MIDI messages to set the positions of multiple faders simultaneously.
   *
   * @param {Object} positionsDict - A dictionary where the keys are fader indexes and the values are the positions to set the faders to.
   * @returns {Promise} A promise that resolves when all MIDI messages have been sent, or rejects if an error occurs.
   */
  sendFaderPositionsDict(positionsDict) {
    return new Promise(async (resolve, reject) => {
      const messages = [];
      const maxPositions = Math.max(...Object.values(positionsDict).map(positions => positions.length));
      // iterate over the positions first and then the faders. This way, you'll send the first position for all faders, then the second position for all faders, and so on
      for (let positionIndex = 0; positionIndex < maxPositions; positionIndex++) {
        for (const [index, positions] of Object.entries(positionsDict)) {
          if (positions[positionIndex] !== undefined) {
            try {
              this.faders[index].setPosition(positions[positionIndex]);
              // Construct a Midi Message
              const message = [
                0xE0 | (index),
                positions[positionIndex] & 0x7F,
                (positions[positionIndex] >> 7) & 0x7F
              ];
              messages.push(message);
            } catch (error) {
              this.logger.error('Error setting fader position: ', error);
              reject(error);
              return;
            }
          }
        }
      }
  
      try {
        await this.sendMIDIMessages(messages);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }

  // FADER MOVEMENT ###################################

  /**
   * Sets the echo mode of the specified fader indexes to the provided echo_mode.
   *
   * @param {number|Array<number>} indexes - The index or an array of indexes of the faders to set the echo mode for.
   * @param {boolean} echo_mode - The echo mode to set for the specified faders.
   */
  set_echoMode(indexes, echo_mode) {
    //sets the echo mode of the specified fader indexes to echo_mode
    if (!Array.isArray(indexes)) {
      indexes = [indexes]; // This will create an array with the single index
    }
    indexes.map(index => {
      this.faders[index].setEchoMode(echo_mode);
    });

  }

  /**
   * Sets the echo mode for each fader according to the provided dictionary.
   * @param {Object} faderdict - The dictionary containing the fader index as the key and the echo mode as the value.
   */
  set_echoMode_dict(faderdict) {
    //sets the echo mode according to the dictionary index:mode(bool)
    for (const [index, echo_mode] of Object.entries(faderdict)) {
      this.faders[index].setEchoMode(echo_mode);
    }
  }

  /**
   * Performs a standard calibration of all faders.
   * This will move all faders to the top and then back to the bottom on 2 speeds.
   *
   * @param {Array<number>|number} indexes - The indexes of the faders to calibrate. If not provided, all faders will be calibrated.
   * @returns {Promise<void>} A promise that resolves when the calibration is complete, or rejects with an error if an error occurs.
   */
  calibrate(indexes) {
    //performs a standard calibration of all faders
    //this will move all faders to the top and then back to the bottom
    //on 2 speeds
    return new Promise(async (resolve, reject) => {
      //get an array of all configured faders
      indexes = this.normalizeIndexes(indexes);
      const move1 = new FaderMove(indexes, 100, this.speedMedium);
      const move2 = new FaderMove(indexes, 0, this.speedSlow);
      const moves = [move1, move2];
      try {
        this.logger.info('Calibrating faders: ' + indexes + ' with moves: ' + JSON.stringify(moves));
        await this.move_faders(moves, false);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Resets the faders to 0.
   * @param {Array<number>|number} indexes - The indexes of the faders to calibrate. If not provided, all faders will be calibrated.
   * @returns {Promise<void>} A promise that resolves when the faders are reset, or rejects with an error if an error occurs.
  */
  reset(indexes) {
    //resets the faders to the base position
    return new Promise(async (resolve, reject) => {
      indexes = this.normalizeIndexes(indexes);
      const resetMove = new FaderMove(indexes, 0, this.speedMedium);
      try {
        this.logger.info('Resetting faders: ' + indexes)
        await this.move_faders(resetMove, true);
        resolve();
      } catch (error) {
        reject(error);
      }
    });

  }

  /**
   * Generates a ramp of progression values between a start and end value.
   * @param {number} start - The start value of the ramp.
   * @param {number} end - The end value of the ramp.
   * @param {number} steps - The number of steps in the ramp.
   */
  generateRamp(start, end, steps) {
    const ramp = [];
    const stepSize = (end - start) / (steps - 1);
    for (let i = 0; i < steps; i++) {
      ramp.push(start + i * stepSize);
    }
    ramp[ramp.length - 1] = end; // Ensure last value is end
    return ramp;
  }

  /**
   * Moves the faders according to the provided move specifications.
   * @param {Array<{idx: number, target: number, speed: number}>} moves - The move specifications.
   * usage example:
   * const move1 = new FaderMove(0, 50, 100);
   * const move2 = new FaderMove(1, 75, 50);
   * const moves = [move1, move2].map(move => move.getDict());
   * move_faders(moves, true);
   */
  move_faders(moves, interrupting = false) {   //! deprecated, way to complicated
    return new Promise(async (resolve, reject) => {
      if (!Array.isArray(moves)) {
        moves = [moves];
      }

      if (interrupting) {
        this.clearMessagesByFaderIndexes(moves.map(move => move.idx));
      }
      this.logger.debug('Moving Fader with Move(s) : ' + JSON.stringify(moves) + ' Interrupting: ' + interrupting);
      
    let expectedProgressions = this.faders.map(fader => fader.progression);

    this.logger.debug('Initial Current Progressions: \n' + expectedProgressions.map((progression, idx) => {
      return `Fader ${idx}: Current = ${progression}`;
    }).join('\n'));

    moves.forEach((move, i) => {
      move.idx.forEach((idx, j) => {
        expectedProgressions[idx] = move.targetProgression[j];
      });
    });

    this.logger.debug('Current and Target Progressions: \n' + moves.flatMap((move, i) => {
      return move.idx.map((idx, j) => {
        let currentProgression = expectedProgressions[idx];
        let targetProgression = move.targetProgression[j];
        return `Fader ${idx}: Current = ${currentProgression}, Target = ${targetProgression}`;
      });
    }).join('\n'));
      
      const distances = moves.flatMap(move => {
        return move.idx.map((idx, j) => {
          const distance = Math.abs(expectedProgressions[idx] - move.targetProgression[j]);
          expectedProgressions[idx] = move.targetProgression[j]; // Update expectedProgressions here
          return distance;
        });
      });
      
      this.logger.debug('Updated Current Progressions: \n' + expectedProgressions.map((progression, idx) => {
        return `Fader ${idx}: Current = ${progression}`;
      }).join('\n'));

      const steps = distances.map((distance, i) => {
        const moveIndex = Math.floor(i / moves[0].idx.length);
        const speedIndex = i % moves[0].idx.length;
        const speed = moves[moveIndex].speed[speedIndex];
        return Math.max(Math.round(distance / (speed / 100) + 1), 1);
      });

      const ramps = moves.flatMap((move, i) => {
        return move.idx.map((idx, j) => {
          this.logger.debug('Generating ramp for fader ' + idx + ' from ' + expectedProgressions[idx] + ' to ' + move.targetProgression[j] + ' with ' + steps[i * move.idx.length + j] + ' steps');
          return this.generateRamp(expectedProgressions[idx], move.targetProgression[j], steps[i * move.idx.length + j]);
        });
      });

      this.logger.debug('Ramps created: ' + JSON.stringify(ramps));

      const progressionsDict = {};
      moves.forEach((move, i) => {
        move.idx.forEach((idx, j) => {
          progressionsDict[idx] = ramps[i * move.idx.length + j];
        });
      });

      try {
        const startTime = Date.now();
        await this.sendFaderProgressionsDict(progressionsDict);
        const endTime = Date.now();
        const duration = endTime - startTime;
        this.logger.debug('FADER MOVE PROTOCOL: \n Moves: ' + JSON.stringify(moves) + '\n Interrupting: ' + interrupting + '\n Distances: ' + distances + '\n Steps: ' + steps + '\n Progressions Dict: ' + JSON.stringify(progressionsDict) + '\n Duration: ' + duration + 'ms');
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }

  moveFaders(move, interrupting = false) {
    return new Promise(async (resolve, reject) => {
      // the moves is no array this time. 
      // however we will accept an array of indexes and targets
      // each index will have a corresponding target, if it is only one target, it will be repeated for all indexes
      // we will also accept an array of speeds, if it is only one speed, it will be repeated for all indexes
      // the FaderMove class values look something like this {idx: [0,1,2], target: [50, 75, 100], speed: [100, 50, 25]}
      // or for one target and one speed {idx: [0,1,2], target: 50, speed: 100}
    if (interrupting) {
      //use the idx key and values to clear the message queue
      this.clearMessagesByFaderIndexes(move.idx);
    }

    this.logger.debug('Moving Faders: ' + move.idx + ' to ' + move.target + ' with speed: ' + move.speed + ' Interrupting: ' + interrupting);
  });
  }

  /**
   * Normalizes the indexes array.
   *
   * @param {Array<number>|number} indexes - The indexes to normalize.
   * @returns {Array<number>} The normalized indexes array.
   */
  normalizeIndexes(indexes) {
    if (indexes === undefined) {
        return Object.values(this.faders).map(fader => fader.index);
    } else if (!Array.isArray(indexes)) {
        return [indexes];
    } else {
        return indexes;
    }
  }

}

module.exports = { FaderController, FaderMove };