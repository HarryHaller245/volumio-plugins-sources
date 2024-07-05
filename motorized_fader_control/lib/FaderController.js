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
    this.trim = [0,100], // Trim values for the fader, [0,100] means no trim
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
   * Sets the progression value for the fader.
   *
   * @param {number} progression - The progression value to set.
   */
  setPositionOnly(position) {
    // map the position to the trim range
    position = this.mapPositionToTrimRange(position);
    // only sets the position value
    this.position = position;
  }

  /**
   * Sets the position of the fader.
   * Also updates the progression accordingly.
   * @param {number} position - The position value to be set.
   */
  setPosition(position) {
    // map the position to the trim range
    position = this.mapPositionToTrimRange(position);
    this.position = position;
    // also update progression accordingly
    this.progression = this.positionToProgression(position);
  }

  /**
   * Sets the position value of the fader
   *
   * @param {number} position - The position value to set.
   */
  setPositionOnly(position) {
    // only sets the position value
    this.position = position;
  }

  /**
   * Maps a progression value to the trim range.
   * @param {number} progression - The progression value to be mapped.
   * @returns {number} The mapped progression value.
   */
  mapProgressionToTrimRange(progression) {
    const lower = this.trim[0];
    const upper = this.trim[1];
    // map the progression to the trim range
    return lower + (progression / 100) * (upper - lower);
}

  /**
   * Maps a position value to the trim range.
   * @param {number} position - The position value to be mapped.
   * @returns {number} The mapped position value.
   */
  mapPositionToTrimRange(position) {
    const lower = this.progressionToPosition(this.trim[0]);
    const upper = this.progressionToPosition(this.trim[1]);
    // map the position to the trim range
    const progression = this.positionToProgression(position);
    const trimmedProgression = this.mapProgressionToTrimRange(progression);
    return this.progressionToPosition(trimmedProgression);
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
   * @param {number|Array<number>} target - The target progression value(s).
   * @param {number|Array<number>} speed - The speed(s) of the fader move operation(s). From 0-100. 0 being no move 100 being instant
   */
  constructor(idx, target, speed) {
    this.idx = Array.isArray(idx) ? idx : [idx];
    this.target = Array.isArray(target) ? target : Array(this.idx.length).fill(target);
    this.speed = Array.isArray(speed) ? speed : Array(this.idx.length).fill(speed);
  }

  /**
   * Returns a dictionary representation of the fader move operation.
   * @returns {Object} - The dictionary representation of the fader move operation.
   */
  getDict() { //! deprecated use the class object
    return {
      idx: this.idx,
      target: this.target,
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
   * @param {number} messageDelay - The rate limit for sending messages.
   * @param {boolean} MIDILog - Whether to log MIDI messages.
   * @param {Array<number>} speeds - The standard speeds used. [fastSpeed, mediumSpeed, slowSPeed]
   * @param {boolean} ValueLog - Whether to log the verbose values in high amounts.
   */
  constructor(logger = dev_logger, fader_count = 1, messageDelay = 100, MIDILog = false, speeds = [80, 50, 10], ValueLog = false) {
    this.fader_count = fader_count;
    this.faders = null;
    this.ser_port = null;
    this.parser = null;

    this.logger = logger;
    this.MIDILog = MIDILog
    this.ValueLog = ValueLog

    this.MIDICache = [];
    this.MIDIDeviceReady = false;
    this.maxCacheDeviceReadiness = 3;

    this.messageQueue = [];
    this.messageQueues = [];
    this.sendingMessage = false;

    this.lastMessageTime = 0;
    this.messageDelay = messageDelay; // Limit

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
    this.messageDelay = messageRateLimit;
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
  async start() {
    try {
      this.logger.debug("### Starting the FaderController...");

      if (!this.ser_port || !this.parser) {
        this.logger.error("Serial port and parser not set up.");
        throw new Error("Serial port and parser not set up.");
      }

      this.configure();

      this.setupPortListeners();

      // Start reading data
      await new Promise((resolve, reject) => {
        this.parser.on("readable", async () => {
          try {
            await this.readAndParseData();
            resolve();
          } catch (error) {
            reject(error);
          }
        });
      });

      // we need to wait here for a mididevice ready before continuing
      await this.calibrate()

      this.logger.info("### FaderController started!");
    } catch (error) {
      this.logger.error("Error starting FaderController: ", error);
      throw error;
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
    return new Promise((resolve, reject) => {
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
              } else {
                resolve();
              }
            }, this.maxCacheDeviceReadiness);
          } else {
            resolve();
          }
        }
      } catch (error) {
        this.logger.error('Error reading data:' + error);
        reject(error);
      }
    });
  }

  // info handling ################################

  /**
   * Retrieves the progressions of the faders at the specified indexes.
   * If the indexes parameter is not an array, it will be converted into an array with a single index.
   *
   * @param {number|Array<number>} indexes - The indexes of the faders to retrieve progressions for.
   * @returns {Array<number>} An array of fader progressions.
   */
  getFaderProgressions(indexes) {
    if (!Array.isArray(indexes)) {
      indexes = [indexes]; // This will create an array with the single index
    }
    return indexes.map(index => this.faders[index].getProgression());
  }


  /**
   * Returns a dictionary containing the information for the specified faders.
   * If it is more than 1 fader, it contains an array of dictionaries.
   *
   * @param {number[]|number} [indexes] - The indexes of the faders to get information for.
   * If not provided, information for all faders will be returned.
   * @returns {Object[]} - An array of dictionaries containing the information for the specified faders.
   * If an invalid fader index is encountered, it will be skipped and not included in the result.
   */
  getFaderInfoDict(indexes) {
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

  //send MIDI MESSAGES #############################################

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
    if (now - this.lastMessageTime < this.messageDelay) {
      setTimeout(() => this.sendNextMessage(), this.messageDelay - (now - this.lastMessageTime));
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
      this.logger.debug(`ProgressionsDict sent analysis (faderIdx):(AmountPositions): ${msg}`);

      if (this.ValueLog == true) {
        this.logger.debug('Sending Progressions to faders: ' + JSON.stringify(progressionsDict));
      }

      try {
        await this.sendFaderPositionsDict(positionsDict, progressionsDict);
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
sendFaderPositionsDict(positionsDict, progressionsDict) {
  return new Promise(async (resolve, reject) => {
    const messages = [];
    const maxPositions = Math.max(...Object.values(positionsDict).map(positions => positions.length));
    for (let positionIndex = 0; positionIndex < maxPositions; positionIndex++) {
      for (const [index, positions] of Object.entries(positionsDict)) {
        if (positions[positionIndex] !== undefined) {
          try {
            // If progressionsDict is provided, update the progression
            if (progressionsDict && progressionsDict[index]) {
              this.faders[index].setProgressionOnly(progressionsDict[index][positionIndex]);
              this.faders[index].setPositionOnly(positions[positionIndex]);
            } else {
              // If progressionsDict is not provided, use the standard setPosition method
              this.faders[index].setPosition(positions[positionIndex]);
            }
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
  async calibrate(indexes) {
    indexes = this.normalizeIndexes(indexes);
    const move1 = new FaderMove(indexes, 100, this.speedMedium);
    const move2 = new FaderMove(indexes, 0, this.speedSlow);

    try {
      this.logger.info(`Calibrating faders: ${indexes} with moves: ${JSON.stringify([move1, move2])}`);
      await this.moveFaders(move1, false);
      await this.moveFaders(move2, false);
    } catch (error) {
      throw error;
    }
  }

  async calibrateSpeeds(indexes, start = 0, end = 100, count = 10, startSpeed = 1, endSpeed = 100) {
      indexes = this.normalizeIndexes(indexes);

      const moves = [];
      const distance = Math.abs(start - end);
      const results = {};
      const speedStep = (endSpeed - startSpeed) / (count - 1);

      for (let i = 0; i < count; i++) {
          const positions = [];
          // If i is even, move from end to start, otherwise move from start to end
          if (i % 2 === 0) {
              positions.push(end);
              positions.push(start);
          } else {
              positions.push(start);
              positions.push(end);
          }
          const speed = startSpeed + i * speedStep;
          const move = new FaderMove(indexes, positions, speed);
          moves.push(move);
      }

      const log = [];
      for (let move of moves) {
          try {
              const duration = await this.moveFaders(move, false);
              log.push(`TIME: ${duration}ms @SPEEDS: ${move.speed}% @DISTANCE: ${distance}%`);
              // Store the result in the results dictionary
              for (let index of indexes) {
                  if (!results[index]) {
                      results[index] = {};
                  }
                  results[index][move.speed] = duration;
              }
          } catch (error) {
              throw error;
          }
      }

      this.logger.info(`\n--- START FADER CALIBRATION REPORT ---`);
      this.logger.info(`Faders: ${indexes.join(',')}`);
      this.logger.info(`Moves: ${count}`);
      this.logger.info(`Distance: ${distance}% Start: ${start}% to End: ${end}%`);
      this.logger.info(`@Speeds: ${moves.map(move => move.speed).join(', ')} %`);
      this.logger.info(`------------------------------------\n`);
      for (let line of log) {
          this.logger.info(line);
      }

      // Initialize min and max durations and their corresponding speeds
      let minDuration = Infinity;
      let maxDuration = -Infinity;
      let minSpeed = -1;
      let maxSpeed = -1;

      // Iterate over the results dictionary
      for (let index in results) {
          for (let speed in results[index]) {
              const duration = results[index][speed];
              if (duration < minDuration) {
                  minDuration = duration;
                  minSpeed = speed;
              }
              if (duration > maxDuration) {
                  maxDuration = duration;
                  maxSpeed = speed;
              }
          }
      }

      // Log the min and max durations and their corresponding speeds
      this.logger.info(`Min duration: ${minDuration}ms at speed: ${minSpeed}%`);
      this.logger.info(`Max duration: ${maxDuration}ms at speed: ${maxSpeed}%`);
      this.logger.info(`--- END FADER CALIBRATION REPORT ---\n`);

      // Return the results dictionary
      return results;
  }

  /**
   * Resets the faders to 0.
   * @param {Array<number>|number} indexes - The indexes of the faders to calibrate. If not provided, all faders will be calibrated.
   * @returns {Promise<void>} A promise that resolves when the faders are reset, or rejects with an error if an error occurs.
   *
   */
  async reset(indexes) {
    indexes = this.normalizeIndexes(indexes);
    const resetMove = new FaderMove(indexes, 0, this.speedMedium);
    try {
      this.logger.info(`Resetting faders: ${indexes}`);
      await this.moveFaders(resetMove, true);
    } catch (error) {
      throw error
    }
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

  async moveFaders(move, interrupting = false) {
    if (interrupting) {
      this.clearMessagesByFaderIndexes(move.idx);
    }

    this.logger.debug(`Moving Faders: ${move.idx} to ${move.target} with speed: ${move.speed} Interrupting: ${interrupting}`);

    this.target = this.ensureCorrectLength(move.target, move.idx.length);
    this.speed = this.ensureCorrectLength(move.speed, move.idx.length);

    move.distance = move.idx.map((idx, i) => Math.abs(this.faders[idx].progression - move.target[i]));

    
    move.steps = move.distance.map((distance, i) => Math.max(Math.round(distance / (move.speed[i] / 100) + 1), 1));
    move.stepSize = move.distance.map((distance, i) => distance / move.steps[i]);

    move.ramps = move.idx.map((idx, i) => {
      if (this.ValueLog == true) {
      this.logger.debug(`Generating ramp for fader ${idx} from ${this.faders[idx].progression} to ${move.target[i]} with ${move.steps[i]} steps`);
      }
      return this.generateRamp(this.faders[idx].progression, move.target[i], move.steps[i]);
    });

    if (this.ValueLog == true) {
      this.logger.debug(`Ramps created: ${JSON.stringify(move.ramps)}`);
    }
    
    const progressionsDict = move.idx.reduce((dict, idx, i) => ({ ...dict, [idx]: move.ramps[i] }), {});

    try {
      const startTime = Date.now();
      await this.sendFaderProgressionsDict(progressionsDict);
      const endTime = Date.now();
      const duration = endTime - startTime;

    const rampStartActual = move.idx.map(idx => move.ramps[idx][0]);
    const rampEndActual = move.idx.map(idx => move.ramps[idx][move.ramps[idx].length - 1]);

    this.logger.debug(`FADER MOVE PROTOCOL: 
    Moved Faders: ${JSON.stringify(move.idx)}
    StartPoints: ${JSON.stringify(this.faders.map(fader => fader.progression))}
    Targets: ${JSON.stringify(move.target)}
    RampStartActual: ${JSON.stringify(rampStartActual)}
    RampEndActual: ${JSON.stringify(rampEndActual)}
    Speeds: ${JSON.stringify(move.speed)}
    StepSize: ${JSON.stringify(move.stepSize)}
    Steps: ${JSON.stringify(move.steps)}
    Duration: ${duration}ms
    FaderInfo: ${JSON.stringify(this.getFaderInfoDict(move.idx))}`
    )
    return duration

    } catch (error) {
      throw error;
    }
  }

// HELPER METHODS #############

  ensureCorrectLength(arr, length) {
    if (!Array.isArray(arr)) {
      // If arr is not an array, repeat its value length times
      return Array(length).fill(arr);
    } else if (arr.length !== length) {
      // If arr is an array but its length doesn't match, log a warning and use the first value
      console.warn('Array length does not match idx length. Using first value.');
      return Array(length).fill(arr[0]);
    } else {
      // If arr is an array and its length matches, use it as is
      return arr;
    }
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