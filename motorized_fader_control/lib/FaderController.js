const SerialPort = require('serialport'); // import the SerialPort module 
const MIDIParser = require('./MIDIParser'); // import the MIDIParser


//! temporary winston logger //will remove
//! pass a logger to the FaderController Module instead
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
 * Represents a fader object.
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
 * Represents a fader controller.
 */
class FaderController {
  /**
   * Creates a new instance of the FaderController class.
   * @param {Object} logger - The logger object for logging messages.
   * @param {number} fader_count - The number of faders.
   * @param {number} messageRateLimit - The rate limit for sending messages.
   */
  constructor(logger = dev_logger, fader_count = 12, messageRateLimit = 100) {
    this.fader_count = this.fader_count; // create an array of 12 faders of the Fader class
    this.faders = Array.from({ length: fader_count }, (_, i) => new Fader(i));
    this.ser_port = null;
    this.parser = null;
    this.logger = logger;

    this.MIDICache = [];
    this.MIDIDeviceReady = false;
    this.maxCacheDeviceReadiness = 3;

    this.messageQueue = [];
    this.messageQueues = [];
    this.sendingMessage = false;

    this.lastMessageTime = 0;
    this.messageRateLimit = messageRateLimit; // Limit
  }

  /**
   * Sets the callback function for the touch event of a fader.
   * @param {number} index - The index of the fader.
   * @param {Function} callback - The callback function to be called when the fader is touched.
   */
  setOnTouchCallback(index, callback) {
    this.faders[index].setTouchCallback(callback);
  }

  /**
   * Sets the callback function for the untouch event of a fader.
   * @param {number} index - The index of the fader.
   * @param {Function} callback - The callback function to be called when the fader is untouched.
   */
  setOnUntouchCallback(index, callback) {
    this.faders[index].setUntouchCallback(callback);
  }

  /**
   * Sets up the serial port and parser.
   * @param {string} ser_port_path - The path of the serial port.
   * @param {number} baud_rate - The baud rate of the serial port.
   */
  setupSerial(ser_port_path, baud_rate) {
    try {
      this.logger.debug("### Initializing SerialPort..");
      this.ser_port = new SerialPort(ser_port_path, { baudRate: baud_rate });
      this.parser = new MIDIParser();
      this.ser_port.pipe(this.parser);
      this.logger.info("### SerialPort initialized.");
    } catch (error) {
      console.error("Error setting up serial port and parser:", error);
    }
  }

  /**
   * Starts the fader controller.
   */
  start() {
    try {
      this.logger.debug("### Starting the FaderController...");

      if (!this.ser_port) {
        this.logger.error("SerialPort is not initialized");
        return;
      }

      // Set up the serial port listeners
      this.setupPortListeners();

      // Start reading data
      this.parser.on("readable", () => {
        this.readAndParseData();
      });

      this.logger.info("### FaderController started!");
    } catch (error) {
      this.logger.error("Error starting FaderController: ", error);
    }
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
   * Handles the case when the MIDI device is not ready.
   */
  handleMIDIDeviceNotReady() {
    this.logger.error("MIDI device did not report readiness. Stopping FaderController...");
    this.stop();
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
        await this.resetFaders();
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
        this.logger.debug('Sent: ' + msg);
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
      
  echo(midiDataArr) {   //! needs fixing
    //method to echo the MIDI messages back to the faders
    //we need to reverse engineer the parsing. and then send it back
    midiDataArr[0] = midiDataArr[0] | midiDataArr[1];
    message = [midiDataArr[0], midiDataArr[2], midiDataArr[3]];
    this.sendMIDIMessages([message]);
  }
  /**
   * Sends a progression value to one or more faders.
   *
   * This function takes an index or an array of indexes and a progression or an array of progressions.
   * It converts the progressions to positions using the progressionToPosition method of the Fader class.
   * Then, it sends the positions to the faders using the sendFaderPosition method.
   *
   * If an error occurs while sending the positions, the Promise is rejected with the error.
   * Otherwise, the Promise is resolved when all positions have been sent.
   *
   * @param {number|Array<number>} indexes - The index or indexes of the faders to set.
   * @param {number|Array<number>} progressions - The progression or progressions to send to the faders.
   * @returns {Promise} A Promise that resolves when all positions have been sent.
   * @throws {Error} If an error occurs while sending the positions.
   */
  sendFaderProgression(indexes, progressions) {
    return new Promise(async (resolve, reject) => {
      if (!Array.isArray(indexes)) {
        indexes = [indexes]; // This will create an array with the single index
      }
  
      if (!Array.isArray(progressions)) {
        progressions = [progressions]; // This will create an array with the single progression
      }
  
      this.logger.debug('Sending PROGRESSION ' + progressions + ' to fader with index(es): ' + indexes);
  
      const positions = progressions.map(progression => this.faders[indexes[0]].progressionToPosition(progression)); // Convert progressions to positions
  
      try {
        await this.sendFaderPosition(indexes, positions);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
 * Sets the position of one or more faders.
 *
 * This function sends MIDI messages to set the position of one or more faders.
 * Each fader is identified by its index, and the new position is specified as a 14-bit integer (0-16383).
 * You can provide either a single index and position, or arrays of indexes and positions.
 * If you provide arrays, each index will be paired with the corresponding position.
 * If there are more positions than indexes, the extra positions will be ignored.
 * If there are more indexes than positions, the extra indexes will be set to the last position.
 *
 * This function returns a Promise that resolves when all MIDI messages have been sent.
 * If an error occurs while setting a fader position or sending a MIDI message, the Promise is rejected with the error.
 *
 * @param {number|Array<number>} indexes - The index or indexes of the faders to set.
 * @param {number|Array<number>} positions - The new position or positions for the faders.
 * @returns {Promise} A Promise that resolves when all MIDI messages have been sent.
 * @throws {Error} If an error occurs while setting a fader position or sending a MIDI message.
 */
  sendFaderPosition(indexes, positions) {
    return new Promise(async (resolve, reject) => {
      if (!Array.isArray(indexes)) {
        indexes = [indexes]; // This will create an array with the single index
      }

      if (!Array.isArray(positions)) {
        positions = [positions]; // This will create an array with the single position
      }

      const promises = indexes.map((index) => {
        return positions.map(async (position) => {
          try {
            this.faders[index].setPosition(position);
            // Construct a Midi Message
            const message = [
              0xE0 | (index),
              position & 0x7F,
              (position >> 7) & 0x7F
            ];
            await this.sendMIDIMessages([message]);
          } catch (error) {
            this.logger.error('Error setting fader position: ', error);
            reject(error);
          }
        });
      });

      Promise.all(promises.flat()).then(() => resolve()).catch((error) => reject(error));
    });
  }
  
sendFaderProgressionsDict(progressionsDict) {
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

  resetFaders(indexes) {
    return new Promise(async (resolve, reject) => {
      // If indexes is undefined, reset all faders
      if (indexes === undefined) {
        indexes = Object.keys(this.faders).map(Number);
      } else if (!Array.isArray(indexes)) {
        indexes = [indexes]; // If indexes is not an array, convert it to an array
      }
  
      this.logger.debug("Resetting faders with indexes: "+ indexes);
  
      // For each index, reset the fader at that index
      const promises = indexes.map(async (index) => {
        if (this.faders[index]) {
          try {
            await this.sendFaderProgression(index, 0);
          } catch (error) {
            this.logger.error('Error sending progression to fader: ' + index);
            return Promise.reject(error);
          }
        } else {
          this.logger.error('Invalid fader index: ' + index);
          return Promise.reject(new Error('Invalid fader index: ' + index));
        }
      });
  
      Promise.all(promises)
        .then(() => resolve())
        .catch((error) => {
          this.logger.error('Error resetting faders: ', error);
          reject(error);
        });
    });
  }
  //MOVEMENT ###################################

  /**
   * Calibrates one or more faders.
   *
   * This function takes an index or an array of indexes and a movement or an array of movements.
   * It sends the movements to the faders using the sendFaderProgression method.
   * When all movements have been sent to all faders, it resolves the returned Promise.
   *
   * @param {number|Array<number>} indexes - The index or indexes of the faders to calibrate.
   * @param {number|Array<number>} movement - The movement or movements to send to the faders.
   * @param {number} base_point - The base point for the calibration.
   * @returns {Promise} A Promise that resolves when all movements have been sent.
   * @throws {Error} If an error occurs while sending the movements.
   */
  faderCalibration(indexes, movement, base_point) {
    return new Promise(async (resolve, reject) => {
      // If indexes is undefined, calibrate all faders
      if (indexes === undefined) {
        indexes = Object.keys(this.faders); // Use the indices of this.faders
      } else if (!Array.isArray(indexes)) {
        indexes = [indexes]; // If indexes is not an array, convert it to an array
      }

      // For each index, calibrate the fader at that index
      const promises = indexes.map(async (index, idx) => {
        if (this.faders[index]) {
          this.logger.info('Calibrating fader with index: '+ index);
          try {
            return await Promise.all(movement.map((m, i) => this.sendFaderProgression(index, m + base_point)));
          } catch (error) {
            this.logger.error('Error sending progression to fader: ' + index);
            return Promise.reject(error);
          }
        } else {
          this.logger.error('Invalid fader index: ' + index);
          return Promise.reject(new Error('Invalid fader index: ' + index));
        }
      });

      Promise.all(promises)
        .then(() => resolve())
        .catch((error) => {
          this.logger.error('Error calibrating fader: ', error);
          reject(error);
        });
    });
  }

  /**
   * Calibrates multiple faders simultaneously.
   *
   * @param {Array|number} indexes - The index or indexes of the faders to calibrate.
   * @param {Array} movement - The array of movements for the calibration.
   * @param {number} base_point - The base point for the calibration.
   * @returns {Promise} A promise that resolves when all faders have been calibrated, or rejects if an error occurs.
   */
  faderCalibrationParallel(indexes, movement, base_point) {
    return new Promise(async (resolve, reject) => {
      // If indexes is undefined, calibrate all faders
      if (indexes === undefined) {
        indexes = Object.keys(this.faders); // Use the indices of this.faders
      } else if (!Array.isArray(indexes)) {
        indexes = [indexes]; // If indexes is not an array, convert it to an array
      }
  
      try {
        for (let i = 0; i < movement.length; i++) {
          // Create a dictionary of fader positions for each movement
          const positionsDict = {};
          for (const index of indexes) {
            if (this.faders[index]) {
              positionsDict[index] = movement[i] + base_point;
            } else {
              this.logger.error('Invalid fader index: ' + index);
              reject(new Error('Invalid fader index: ' + index));
              return;
            }
          }
  
          // Send all fader positions simultaneously
          await this.sendFaderPositionsDict(positionsDict);
        }
  
        resolve();
      } catch (error) {
        this.logger.error('Error calibrating faders: ', error);
        reject(error);
      }
    });
  }


  /// DEPRECATED
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

  /**
   * Generates a ramp of progression values between a start and end value.
   * @param {number} start - The start value of the ramp.
   * @param {number} end - The end value of the ramp.
   * @param {number} steps - The number of steps in the ramp.
   */
  generateRamp(start, end, steps) {
    const stepSize = (end - start) / steps;
    return Array.from({ length: steps }, (_, i) => start + i * stepSize);
  }

  
  //move fader with index, speed, targetProgression specified, interrupting (clearing messages that have the same fader idxs)
  move_fader(indexes, targetProgressions, speed, interrupting = false) {
    //method to move the fader using a specified speed and target progression
    //the indexes and the targetProgressions should be arrays
    //the method should also work with only single values
    //the speed is a float value between 0 and 100
    //is the slowest (no movement) and 100 is the fastest (instant movement at the rate limit of the midi messages)
    //if interrupting is true it will clear all messages that have the same fader indexes
    //we will write a method for clearing specific midi messages from the queue
    return new Promise(async (resolve, reject) => {
      if (!Array.isArray(indexes)) {
        indexes = [indexes]; // This will create an array with the single index
      }
      if (!Array.isArray(targetProgressions)) {
        targetProgressions = [targetProgressions]; // This will create an array with the single targetProgression
      }
      if (interrupting) {
        this.clearMessagesByFaderIndexes(indexes);
      }
      // we will need to construct the fader dict and then send it to the sendFaderProgressionDict method
      // since this method is capable close to parallel command it is better to use this method
      // however we will send A LOT OF MESSAGES per movement, depending on the speed
      // we can use generateRamp to generate the progressions

      // first we will figure out the number of steps needed for the movement
      // this is dependent of the speed and the distance between the current position and the target position
      const distances = indexes.map((index, i) => {
        return this.faders[index].progression - targetProgressions[i];
      });
        // we will use the distances and our speed to calculate the number of steps
        // 0 means no movement, 100 means instant movement. Instant as in no ramping
      const steps = distances.map((distance, i) => {
        // Calculate the number of steps based on the speed and distance
        // A lower speed or a greater distance results in more steps
        // A higher speed or a smaller distance results in fewer steps
        // The '+ 1' ensures that there is at least one step even at the highest speed
        // The 'Math.max' ensures that the number of steps is not less than 1
        return Math.max(Math.round(distance / (speed / 100) + 1), 1);
      });
      // we will use the steps to generate the ramps
      const ramps = indexes.map((index, i) => {
        return this.generateRamp(this.faders[index].progression, targetProgressions[i], steps[i]);
      });

      // we will construct the fader dict
      const progressionsDict = {};
      indexes.forEach((index, i) => {
        progressionsDict[index] = ramps[i];
      });

      this.logger.debug('Move Fader Protocol: \n Indexes: ' + indexes + '\n Target Progressions: ' + targetProgressions + '\n Speed: ' + speed + '\n Interrupting: ' + interrupting + '\n Distances: ' + distances + '\n Steps: ' + steps + '\n Progressions Dict: ' + progressionsDict);


      // we will send the fader dict to the sendFaderProgressionsDict method
      try {
        await this.sendFaderProgressionsDict(progressionsDict);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }




}

module.exports = FaderController;