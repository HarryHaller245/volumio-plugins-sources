/**
 * @module FaderController
 * 
 * This module provides functionality to control and manage faders in a MIDI controller environment.
 * 
 * The main class in this module is `FaderController`, which handles the initialization, state management,
 * and interaction with fader controls.
 * 
 * 
 * 
 * @requires events
 **/



//! TODO: develop fader range trim further, not functional at the moment, maybe it is easiest to map
//! at the lowest level, right before a command goes out. However we need to make sure
//! the positions and progressions are all mapped when acessed
//? defer

const SerialPort = require('serialport'); // import the SerialPort module 
const MIDIParser = require('./MIDIParser'); // import the MIDIParser
const os = require('os'); // import the os module

//! temporary winston logger //will remove
//! pass the volumio logger to the FaderController Module instead
const winston = require('winston'); //logger needs to be the volumio logger instead.
const { get } = require('http');

const dev_logger = winston.createLogger({
  level: 'info',
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
    this.echo_mode = false; //echo mode for a fader, means it will immediately mirror any adjustment made to it by hand
    this.ProgressionMap = [0,100]; // mapping range values for the fader, [0,100] means no trim and is the max range
    //! this produces an array length error atm, or memory leak not sure, might be a problem with the way jest tests are run

    this.MovementSpeedFactor = 1; // The speed factor for the fader movement. Standard is One
  }

  /**
   * Sets the progression map for the fader controller.
   *
   * @param {Object} ProgressionMap - The progression map object.
   */
  set_ProgressionMap(ProgressionMap) {
    this.ProgressionMap = ProgressionMap;
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

  setMovementSpeedFactor(MovementSpeedFacor) {
    this.MovementSpeedFactor = MovementSpeedFacor;  }


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
    this.setProgressionOnly(progression)
    // also update position accordingly
    const position = this.progressionToPosition(progression);
    this.setPositionOnly(position)
  }

  setProgressionOnly(progression) {
    this.progression = this.mapProgressionToTrimRange(progression);
  }


  /**
   * Sets the position of the fader.
   * Also updates the progression accordingly.
   * @param {number} position - The position value to be set.
   */
  setPosition(position) {
    // map the position to the trim range
    this.setPositionOnly(position)
    // also update progression accordingly
    const progression = this.positionToProgression(position);
    this.setProgressionOnly(progression)
  }

  /**
   * Sets the position value of the fader
   *
   * @param {number} position - The position value to set.
   */
  setPositionOnly(position) {
    // only sets the position value
    this.position = this.mapPositionToTrimRange(position);
  }

  /**
   * Maps a progression value to the trim range.
   * @param {number} progression - The progression value to be mapped.
   * @returns {number} The mapped progression value.
   */
  mapProgressionToTrimRange(progression) {
    const lower = this.ProgressionMap[0];
    const upper = this.ProgressionMap[1];
    return lower + (progression / 100) * (upper - lower);
  }

  mapPositionToTrimRange(position) {
    const lower = this.progressionToPosition(this.ProgressionMap[0]);
    const upper = this.progressionToPosition(this.ProgressionMap[1]);
    return lower + ((position - lower) / (upper - lower)) * (upper - lower);
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
      this.echo_mode +
      " ProgressionMap: " +
      this.ProgressionMap +
      " MovementSpeedFactor: " +
      this.MovementSpeedFactor;
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
      ProgressionMap: this.ProgressionMap,
      MovementSpeedFactor: this.MovementSpeedFactor
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

  getProgressionMap() {
    return this.ProgressionMap;
  }
  getMovementSpeedFactor() {
    return this.MovementSpeedFactor;
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
   * @param {boolean} MoveLog - Whether to log the verbose movement values in high amounts.
   * @param {boolean} CalibrationOnStart - Whether to calibrate the faders on start.
   */
  constructor(logger = dev_logger, fader_count = 1, messageDelay = 100, MIDILog = false, speeds = [80, 50, 10], ValueLog = false, MoveLog = false, CalibrationOnStart = true) {
    this.fader_count = fader_count;
    this.faders = null;
    this.ser_port = null;
    this.parser = null;

    this.logger = logger;
    this.MIDILog = MIDILog
    this.ValueLog = ValueLog;
    this.MoveLog = MoveLog;

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

    this.CalibrationOnStart = CalibrationOnStart;
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

  configureFaderObject() {
    //method setting the startup config
    this.setupFadersArray(this.fader_count);
  }

  /**
   * Sets the progression maps for one or more faders.
   * 
   * @param {number[]} indexes - The indexes of the faders to set the progression maps for.
   * @param {Object} ProgressionMap - The progression map to set for the faders.
   */
  setFaderProgressionMap(indexes, ProgressionMap) {
    //sets the passed progression maps for one or more faders
    indexes = this.normalizeIndexes(indexes);
    indexes.map(index => {
      this.faders[index].set_ProgressionMap(ProgressionMap);
    });
  }


  setOnTouchCallback(indexes, callback) {
    indexes = this.normalizeIndexes(indexes);
    indexes.forEach(index => {
      this.faders[index].setTouchCallback(callback);
    });
  }

  setOnUntouchCallback(indexes, callback) {
    indexes = this.normalizeIndexes(indexes);
    indexes.forEach(index => {
      this.faders[index].setUntouchCallback(callback);
    });
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
   * Starts the FaderController.
   * 
   * @param {boolean} [calibrationOnStartParam=null] - Indicates whether to perform calibration on start.
   * @throws {Error} If the serial port and parser are not set up.
   * @returns {Promise<void>} A promise that resolves when the FaderController is started.
   */
  async start(calibrationOnStartParam = false) {
    const CalibrationOnStart = calibrationOnStartParam || this.CalibrationOnStart;
    try {
      this.logger.debug("### Starting the FaderController...");

      if (!this.ser_port || !this.parser) {
        this.logger.error("Serial port and parser not set up.");
        throw new Error("Serial port and parser not set up.");
      }

      this.configureFaderObject();

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

      if (CalibrationOnStart == true) {
        await this.calibrate_old()
      }

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
        await this.reset();
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
  getFadersInfo(indexes) {
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

  getFaderInfoLog(indexes) {
    if (indexes === undefined) {
      indexes = Object.keys(this.faders).map(Number);
    } else if (!Array.isArray(indexes)) {
      indexes = [indexes]; // If indexes is not an array, convert it to an array
    }
    const log = indexes.map(index => {
      if (this.faders[index]) {
        return `Fader ${index}: ${this.faders[index].getInfoLog()}`;
      }
      return `Fader ${index}: No information available`;
    }).filter(log => log !== null);
    return log.join('\n');
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

  getMidiMessageDelay() {
    return this.messageDelay;
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
        this.sendingMessage = false;
        this.messageQueues.shift();
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

  clearAllMessageQueues() {
    this.messageQueues = [];
  }

  clearMessagesByFaderIndexes(indexes) {
    this.messageQueue = this.messageQueue.filter((message) => {
      return !indexes.includes(message.index);
    });
  }

  ///
      
  echo_midi(midiDataArr) {   //! needs fixing not fully implemented
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
   * Sends MIDI messages to set the positions faders simultaneously.
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
              const trimmedPosition = this.faders[index].mapPositionToTrimRange(positions[positionIndex]);
              const message = [
                0xE0 | (index),
                trimmedPosition & 0x7F,
                (trimmedPosition >> 7) & 0x7F
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

  // CALIBRATION ########################################
  
  /**
   * Performs a standard calibration of all faders.
   * This will move all faders to the top and then back to the bottom on 2 speeds.
   *
   * @param {Array<number>|number} indexes - The indexes of the faders to calibrate. If not provided, all faders will be calibrated.
   * @returns {Promise<void>} A promise that resolves when the calibration is complete, or rejects with an error if an error occurs.
   */
  async calibrate_old(indexes) {
    indexes = this.normalizeIndexes(indexes);
    const move1 = new FaderMove(indexes, 100, this.speedMedium);
    const move2 = new FaderMove(indexes, 0, this.speedSlow);

    try {
      this.logger.debug(`OLD FADERCAlIBRATION: Calibrating faders: ${indexes} with moves: ${JSON.stringify([move1, move2])}`);
      await this.moveFaders(move1, false);
      await this.moveFaders(move2, false);
    } catch (error) {
      throw error;
    }
  }

  /**
   * Manual Calibration to find the physical Faders Max speed.
   * Performs a calibration method where the fader will perform several moves from 0-100-0 at different increasing speeds.
   * For each 0-100-0 move, the user will be prompted via a callback or if configured, console input to confirm if the fader reached the top before it returned.
   * The goal is to calibrate the top speed for the fader to reach the top, avoiding performing non-full moves.
   * The user will be prompted to press enter when the fader reached the top after a move from 0-100-0 at a certain speed (y or n).
   * The speed will increase for each move until endSpeed or failure.
   *
   * @param {Array<number>} indexes - The indexes of the faders to calibrate.
   * @param {number} count - The number of calibration moves to perform.
   * @param {number} startSpeed - The starting speed for the calibration moves.
   * @param {number} endSpeed - The ending speed for the calibration moves.
   * @param {Function} [userConfirmationCallback=null] - The callback function for user confirmation.
   * @param {boolean} [consoleInput=true] - Indicates whether to use console input for user confirmation.
   * @returns {Promise<Object>} - A promise that resolves to an object containing the calibration results.
   * @throws {Error} - If no method for user confirmation is provided.
   */
  async UserCalibration(indexes, count, startSpeed, endSpeed, userConfirmationCallback = null, consoleInput = true) {
    indexes = this.normalizeIndexes(indexes);
    const StartPosition = 0;
    const EndPosition = 100;
    const results = {};
    const speedStep = (endSpeed - startSpeed) / (count - 1);

    try {
      // Move faders to 0 before calibration
      await this.reset(indexes);

      for (let i = 0; i < count; i++) {
        const currentSpeed = startSpeed + i * speedStep;
        const moveUp = new FaderMove(indexes, EndPosition, currentSpeed);
        const moveDown = new FaderMove(indexes, StartPosition, currentSpeed);

        // Perform the move from 0 to 100
        await this.moveFaders(moveUp, false);

        let userConfirmed;
        if (consoleInput) {
          const readline = require('readline');
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
          });

          const question = (query) => new Promise(resolve => rl.question(query, resolve));
          const answer = await question(`Did the fader reach the top position at speed ${currentSpeed}? (y/n): `);
          userConfirmed = answer.toLowerCase() === 'y';
          rl.close();
        } else if (userConfirmationCallback) {
          userConfirmed = await userConfirmationCallback(`Did the fader reach the top position at speed ${currentSpeed}?`);
        } else {
          throw new Error("No method for user confirmation provided.");
        }

        results[currentSpeed] = userConfirmed;
        if (!userConfirmed) {
          break;
        }

        // Perform the move back from 100 to 0
        await this.moveFaders(moveDown, false);
      }

      return results;
    } catch (error) {
      console.error('Error during calibration:', error);
      throw error; // Rethrow the error after logging it
    }
  } 

  /**
   * Calibrates the faders.
   * 
   * @param {number[]} indexes - The indexes of the faders to calibrate.
   * @param {number} [start=0] - The start position of the faders (default: 0).
   * @param {number} [end=100] - The end position of the faders (default: 100).
   * @param {number} [count=10] - The number of moves to perform (default: 10).
   * @param {number} [startSpeed=1] - The starting speed of the moves (default: 1).
   * @param {number} [endSpeed=100] - The ending speed of the moves (default: 100).
   * @param {number} [DurationGoalMaxSpeed=100] - The desired duration for max speed movement in ms.
   * @param {number} [CalibrationTolerance=1] - The tolerance for the calibration.
   * @param {boolean} [runInParallel=true] - Indicates whether to run the calibration in parallel.
   * @returns {Object} - The results dictionary containing the durations for each index and speed.
   * @throws {Error} If an error occurs during calibration.
   */
  async calibrate(indexes, start = 0, end = 100, count = 10, startSpeed = 1, endSpeed = 100, DurationGoalMaxSpeed = 100, CalibrationTolerance = 1, runInParallel = true) {
    try {
      indexes = this.normalizeIndexes(indexes);
      this.logger.info('Calibrating faders...');
      this.reset(indexes);
  
      // Calibrate Speed Durations
      let movementSpeedFactors = await this._calibrateSpeedDuration(indexes, start, end, count, startSpeed, endSpeed, DurationGoalMaxSpeed, runInParallel);
      
      this.logger.info('Validating Calibration Results...');
      await this._delay(3000);
  
      // Validate Calibration
      let validationResult = await this._validateSpeedCalibration(indexes, movementSpeedFactors, DurationGoalMaxSpeed, CalibrationTolerance, runInParallel);
  
      this.logger.info('Fader calibration complete.');
      
      // Log the calibration report
      this._logCalibrationReport(indexes, movementSpeedFactors, validationResult);
      
      return validationResult;
    } catch (error) {
      this.logger.error(`Fader calibration failed: ${error.message}`);
      throw new Error('Fader calibration failed: ' + error.message);
    }
  }

  _logCalibrationReport(indexes, movementSpeedFactors, validationResult) {
    const midiMessageDelay = this.getMidiMessageDelay();
    const reportLines = [
      '--- FADER CALIBRATION REPORT ---',
      `System: ${os.type()} ${os.release()} (${os.arch()})`,
      `Node.js: ${process.version}`,
      `Initialized Faders: ${this.getFaderCount()}`,
      `Fader Indexes: ${indexes.join(', ')}`,
      `${this.getFaderInfoLog(indexes)}`,
      `MIDI Device Ready: ${this.isMIDIDeviceReady()}`,
      `MIDI Message Delay: ${midiMessageDelay}ms`,
      '--------------------------------',
      'Fader Index | Speed Factor | Validation Result',
      '--------------------------------'
    ];

    indexes.forEach(index => {
      const speedFactor = movementSpeedFactors[index] || 'N/A';
      const validation = validationResult[index] ? 'Passed' : 'Failed';
      reportLines.push(`${index}           | ${speedFactor}       | ${validation}`);
    });

    reportLines.push('--------------------------------');
    reportLines.push('--- END CALIBRATION REPORT. ---');
    this.logger.info(reportLines.join('\n'));
  }
  
  // Generate moves for faders
  _generateMoves(indexes, start, end, count, startSpeed, endSpeed) {
    const moves = [];
    const speedStep = (endSpeed - startSpeed) / (count - 1);
  
    for (let i = 0; i < count; i++) {
      const positions = (i % 2 === 0) ? [end, start] : [start, end];
      const speed = startSpeed + i * speedStep;
  
      // Ensure positions and speed are valid
      if (!positions || positions.length === 0) {
        throw new Error(`Invalid positions array at count ${i}`);
      }
      if (speed === undefined || speed === null) {
        throw new Error(`Invalid speed value at count ${i}`);
      }
  
      moves.push({ idx: indexes, target: positions, speed: [speed, speed] });
    }
    this.logger.debug(`Generated moves: ${JSON.stringify(moves)}`);
    return moves;
  } 

  // Move faders based on parallel or sequential mode
  async _moveFadersCalibration(moves, indexes, runInParallel) {
    const results = {};
    if (runInParallel) {
      await Promise.all(moves.map(async (move) => {
        if (!move.target || !move.speed) {
          throw new Error('Invalid move configuration: positions or speed missing');
        }
        this.logger.debug(`Moving Faders: ${move.idx} to ${move.target} with speed: ${move.speed} Interrupting: false`);
        const duration = await this.moveFaders(move, false);
        this._updateResults(results, move.idx, move.speed[0], duration);
      }));
    } else {
      for (let move of moves) {
        for (let index of move.idx) {
          if (!move.target || !Array.isArray(move.target) || move.target.length === 0) {
            throw new Error(`Invalid positions for fader ${index}: ${JSON.stringify(move.target)}`);
          }
          if (!move.speed || !Array.isArray(move.speed) || move.speed.length === 0) {
            throw new Error(`Invalid speed for fader ${index}: ${JSON.stringify(move.speed)}`);
          }
  
          const singlePosition = move.target[0];
          this.logger.debug(`Moving Fader ${index} to ${singlePosition} with speed: ${move.speed[0]} Interrupting: false`);
          const singleMove = { idx: [index], target: [singlePosition], speed: [move.speed[0]] };
          const duration = await this.moveFaders(singleMove, false);
          this._updateResults(results, [index], move.speed[0], duration);
        }
      }
    }
    this.logger.debug(`Results after _moveFadersCalibration: ${JSON.stringify(results)}`);
    return results;
  }
  
  // Update results for each fader
  _updateResults(results, indexes, speed, duration) {
    indexes.forEach(index => {
      results[index] = results[index] || {};
      results[index][speed] = duration;
      this.logger.debug(`Updated results for fader ${index} at speed ${speed}: ${duration}ms`);
    });
  }

  // Helper function for delaying
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  async _calibrateSpeedDuration(indexes, start, end, count, startSpeed, endSpeed, DurationGoalMaxSpeed, runInParallel) {
    indexes = this.normalizeIndexes(indexes);
    this.logger.debug(`Normalized indexes: ${indexes}`);
  
    const moves = this._generateMoves(indexes, start, end, count, startSpeed, endSpeed);
    const results = await this._moveFadersCalibration(moves, indexes, runInParallel);
    const movementSpeedFactors = this._calculateMovementSpeedFactors(indexes, results, DurationGoalMaxSpeed);
  
    return movementSpeedFactors;
  }
    
  // Calculate movement speed factors for each fader
  _calculateMovementSpeedFactors(indexes, results, DurationGoalMaxSpeed) {
    const movementSpeedFactors = {};
  
    indexes.forEach(index => {
      if (!results[index]) {
        this.logger.error(`No calibration results for fader index ${index}`);
        return;
      }
  
      const maxSpeed = Math.max(...Object.keys(results[index]).map(Number));
      const durationAtMaxSpeed = results[index][maxSpeed];
  
      if (durationAtMaxSpeed === undefined) {
        this.logger.error(`Duration at max speed for index ${index} is undefined`);
        return;
      }
  
      const movementSpeedFactor = durationAtMaxSpeed / DurationGoalMaxSpeed;
      movementSpeedFactors[index] = movementSpeedFactor;
      this.faders[index].setMovementSpeedFactor(movementSpeedFactor);
      
      this.logger.debug(`Set SPEED FACTOR for fader ${index} to ${movementSpeedFactor}`);
    });
  
    this.logger.debug(`MovementSpeedFactors: ${JSON.stringify(movementSpeedFactors)}`);
    return movementSpeedFactors;
  }
  
  // Validate speed calibration
  async _validateSpeedCalibration(indexes, movementSpeedFactors, DurationGoalMaxSpeed, CalibrationTolerance, runInParallel) {
    const results = {};
  
    if (runInParallel) {
      await this._validateParallel(indexes, movementSpeedFactors, DurationGoalMaxSpeed, CalibrationTolerance, results);
    } else {
      await this._validateSequential(indexes, movementSpeedFactors, DurationGoalMaxSpeed, CalibrationTolerance, results);
    }
  
    return results;
  }
  
  async _validateParallel(indexes, movementSpeedFactors, DurationGoalMaxSpeed, CalibrationTolerance, results) {
    const move = new FaderMove(indexes, 100, 100);
    await this.reset(indexes);
    await this._delay(3000);
  
    const duration = await this.moveFaders(move, false);
    this._performValidation(indexes, duration, DurationGoalMaxSpeed, CalibrationTolerance, results);
  }
  
  async _validateSequential(indexes, movementSpeedFactors, DurationGoalMaxSpeed, CalibrationTolerance, results) {
    for (let index of indexes) {
      const move = new FaderMove([index], 100, 100);
      await this.reset([index]);
      await this._delay(3000);
  
      const duration = await this.moveFaders(move, false);
      this._performValidation([index], duration, DurationGoalMaxSpeed, CalibrationTolerance, results);
    }
  }
  
  _performValidation(indexes, duration, DurationGoalMaxSpeed, CalibrationTolerance, results) {
    indexes.forEach(index => {
      const speed = 100;
      const movementSpeedFactorGoal = DurationGoalMaxSpeed / duration;
      const tolerance = movementSpeedFactorGoal * CalibrationTolerance;
      const isValid = movementSpeedFactorGoal >= (movementSpeedFactorGoal - tolerance) && movementSpeedFactorGoal <= (movementSpeedFactorGoal + tolerance);
  
      results[index] = { speed, duration, speedScaleValue: movementSpeedFactorGoal, isValid };
      this.logger.info(`Speed Calibration Validation for fader ${index}: ${isValid}`);
    });
  }
  
// MOVEMENT BASICS #################################

  /**
   * Resets the faders to 0.
   * @param {Array<number>|number} indexes - The indexes of the faders to reset. If not provided, all faders will be calibrated.
   * @returns {Promise<void>} A promise that resolves when the faders are reset, or rejects with an error if an error occurs.
   *
   */
  async reset(indexes) {
    indexes = this.normalizeIndexes(indexes);
    const resetMove = new FaderMove(indexes, 0, this.speedMedium);
    try {
      this.logger.info(`Resetting faders: ${indexes}`);
      await this.moveFaders(resetMove, true, 1);
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

  /**
   * Moves the faders to the specified target positions with optional interrupting and movement speed factor.
   * 
   * @param {Object} move - The move object containing the fader indexes, target positions, and speed.
   * @param {boolean} [interrupting=false] - Indicates whether to clear messages by fader indexes.
   * @param {number} [MovementSpeedFactor] - The movement speed factor to scale the speed of each fader.
   * @returns {Promise<number>} - A promise that resolves with the duration of the fader movement in milliseconds.
   * @throws {Error} - If there is an error moving the faders.
   */
  async moveFaders(move, interrupting = false, MovementSpeedFactor = undefined) {
    if (interrupting) {
      this.clearMessagesByFaderIndexes(move.idx);
    }
  
    this.logger.debug(`Moving Faders: ${move.idx} to ${move.target} with speed: ${move.speed} Interrupting: ${interrupting}`);
  
    this.target = this.ensureCorrectLength(move.target, move.idx.length);
    this.speed = this.ensureCorrectLength(move.speed, move.idx.length);
  
    move.distance = move.idx.map((idx, i) => Math.abs(this.faders[idx].progression - move.target[i]));
  
    // Here we need to introduce the movement speed factor
    // If none provided, we will use the MovementSpeedFactor in the faders[idx] object
    // If provided, we use MovementSpeedFactor
    const effectiveSpeeds = move.speed.map((speed, i) => {
      let speedFactor;
      if (MovementSpeedFactor !== undefined) {
        speedFactor = MovementSpeedFactor;
      } else {
        speedFactor = this.faders[move.idx[i]].MovementSpeedFactor;
        if (speedFactor === undefined || speedFactor === null || isNaN(speedFactor)) {
          this.logger.warn(`MovementSpeedFactor for fader ${move.idx[i]} is invalid: ${speedFactor}. Using fallback value of 1.`);
          speedFactor = 1;
        }
      }
      return speed * speedFactor;
    });
  
    move.steps = move.distance.map((distance, i) => Math.max(Math.round(distance / (effectiveSpeeds[i] / 100) + 1), 1));
    move.stepSize = move.distance.map((distance, i) => distance / move.steps[i]);
  
    move.ramps = move.idx.map((idx, i) => {
      if (this.ValueLog) {
        this.logger.debug(`Generating ramp for fader ${idx} from ${this.faders[idx].progression} to ${move.target[i]} with ${move.steps[i]} steps`);
      }
      return this.generateRamp(this.faders[idx].progression, move.target[i], move.steps[i]);
    });
  
    if (this.ValueLog) {
      this.logger.debug(`Ramps created: ${JSON.stringify(move.ramps)}`);
    }
  
    const progressionsDict = move.idx.reduce((dict, idx, i) => ({ ...dict, [idx]: move.ramps[i] }), {});
  
    try {
      const startTime = Date.now();
      await this.sendFaderProgressionsDict(progressionsDict);
      const endTime = Date.now();
      const duration = endTime - startTime;
  
      if (this.MoveLog) {
        const rampStartActual = move.idx.map((idx, i) => move.ramps[i][0]);
        const rampEndActual = move.idx.map((idx, i) => move.ramps[i][move.ramps[i].length - 1]);
        this.logger.debug(`FADER MOVE PROTOCOL: 
        Moved Faders: ${JSON.stringify(move.idx)}
        StartPoints: ${JSON.stringify(this.faders.map(fader => fader.progression))}
        Targets: ${JSON.stringify(move.target)}
        RampStartActual: ${JSON.stringify(rampStartActual)}
        RampEndActual: ${JSON.stringify(rampEndActual)}
        Speeds: ${JSON.stringify(effectiveSpeeds)}
        StepSize: ${JSON.stringify(move.stepSize)}
        Steps: ${JSON.stringify(move.steps)}
        Duration: ${duration}ms
        FaderInfo: \n${Jthis.getInfoLog(move.idx)}`);
      }
      return duration;
  
    } catch (error) {
      this.logger.error(`Error moving faders: ${error}`);
      throw error;
    }
  }
  
  // HELPER METHODS #############

  /**
   * Ensures that the given array has the correct length.
   * If the array is not an array, it will be repeated to match the desired length.
   * If the array length doesn't match the desired length, a warning will be logged and the first value will be used to fill the array.
   * If the array length matches the desired length, it will be used as is.
   *
   * @param {any[]} arr - The array to be checked and modified.
   * @param {number} length - The desired length of the array.
   * @returns {any[]} - The modified array with the correct length.
   */
  ensureCorrectLength(arr, length) {
    if (!Array.isArray(arr)) {
      // If arr is not an array, repeat its value length times
      return Array(length).fill(arr);
    } else if (arr.length !== length) {
      // If arr is an array but its length doesn't match, log a warning and use the first value
      this.logger.debug('Array length does not match idx length. Using first value.');
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