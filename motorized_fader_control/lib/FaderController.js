/**
 * @module FaderController
 * 
 * This module provides functionality to control and manage motorized faders controlled by MIDI over serial.
 * 
 * The main class in this module is `FaderController`, which handles the initialization, state management,
 * and interaction with fader controls. It supports various operations such as calibration, movement, and
 * MIDI message handling.
 * 
 * Features:
 * - Initialization and setup of faders
 * - Calibration of faders
 * - Movement control with speed and position management
 * - MIDI message handling and echo mode
 * - Logging and debugging support
 * - Trim Maps for faders
 * 
 * Dependencies:
 * - events: Node.js EventEmitter for handling events
 * - serialport: For serial communication with the MIDI device
 * - readline: For user input during calibration
 * 
 * Example usage:
 * 
 * ```javascript
 * const { FaderController, FaderMove } = require('./FaderController');
 * 
 * // Initialize FaderController
 * const faderController = new FaderController(undefined, 4, 10, true, [10, 20, 30], true, true);
 * faderController.setupSerial('/dev/ttyUSB0', 9600);
 * 
 * // Start the FaderController
 * faderController.start(true).then(() => {
 *   faderController.setFaderProgressionMapsTrimMap({ 0: 0, 1: 10, 2: 20, 3: 30 });
 *   console.log('FaderController started and configured.');
 * }).catch(error => {
 *   console.error('Error starting [FaderController]:', error);
 * });
 * 
 * // Move faders to a position
 * const indexes = [0, 1];
 * const target = [50, 20];
 * const moveA = new FaderMove(indexes, target, [10, 100]);
 * faderController.moveFaders(moveA, false).then(() => {
 *   console.log('Faders moved to positions:', target);
 * }).catch(error => {
 *   console.error('Error moving faders:', error);
 * });
 * 
 * // Perform calibration
 * const calibrationIndexes = [0, 1];
 * faderController.calibrate(calibrationIndexes, 0, 100, 10, 1, 100, 100, 1, true).then(results => {
 *   console.log('Calibration results:', results);
 * }).catch(error => {
 *   console.error('Error during calibration:', error);
 * });
 * 
 * // Stop the FaderController
 * faderController.stop().then(() => {
 *   faderController.closeSerial();
 *   console.log('FaderController stopped and serial port closed.');
 * }).catch(error => {
 *   console.error('Error stopping [FaderController]:', error);
 * });
 * ```
 * 
 * @requires events
 * @requires serialport
 * @requires readline
 * 
 * @version 1.0.0
 * @license MIT
 * 
 * @see {@link https://github.com/your-repo/motorized_fader_control|GitHub Repository}
 * 
 * @author
 * HarryHaller245
 * HarryHaller245@github
 * 
 * @fileoverview This file contains the implementation of the FaderController class and related helper functions.
 */

const SerialPort = require('serialport'); // import the SerialPort module 
const MIDIParser = require('./MIDIParser'); // import the MIDIParser
const os = require('os'); // import the os module
const EventEmitter = require('events');

//TODO: Simplify and Optimize Module
//TODO: organize

/**
 * Represents a fader object. Holds the information of a motorized fader.
 * 
 * The `Fader` class encapsulates the details of a motorized fader, including its index, position, progression,
 * touch state, echo mode, and movement speed factor. It provides methods to set and get these properties,
 * as well as to map progression and position values.
 * 
 * Example usage:
 * 
 * ```javascript
 * const fader = new Fader(0);
 * 
 * // Set progression and position
 * fader.setProgression(50);
 * fader.setPosition(8192);
 * 
 * // Set touch and untouch callbacks
 * fader.setTouchCallback(() => console.log('Fader touched'));
 * fader.setUntouchCallback(() => console.log('Fader untouched'));
 * 
 * // Set echo mode and movement speed factor
 * fader.setEchoMode(true);
 * fader.setMovementSpeedFactor(1.5);
 * 
 * // Get fader information
 * console.log(fader.getInfoLog());
 * console.log(fader.getInfoDict());
 * ```
 * 
 * @class
 * @param {number} index - The index of the fader.
 */
class Fader extends EventEmitter {
  constructor(index) {
    super();
    this.index = index;
    this.position = 0; // 14-bit integer
    this.progression = 0; // Progression of the fader
    this.touch = false; // Whether the fader is currently being touched
    this.onTouch = null; // Callback for touch event
    this.onUntouch = null; // Callback for untouch event
    this.echo_mode = false; // Echo mode for a fader, means it will immediately mirror any adjustment made to it by hand
    this.ProgressionMap = [0, 100]; // Mapping range values for the fader, [0, 100] means no trim and is the max range
    this.MovementSpeedFactor = 1; // The speed factor for the fader movement. Standard is one
  }

  /**
   * Sets the progression map for the fader controller.
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

  /**
   * Sets the movement speed factor for the fader.
   * @param {number} MovementSpeedFactor - The movement speed factor to be set.
   */
  setMovementSpeedFactor(MovementSpeedFactor) {
    this.MovementSpeedFactor = MovementSpeedFactor;
  }

  setTouch(touch) {
    if (this.touch !== touch) {
      this.touch = touch;
      if (touch) {
        // Emit 'touch' event with fader index and info
        this.emit('touch', this.index, this.getInfoDict());
        if (this.onTouch) {
          this.onTouch(this.index, this.getInfoDict());
        }
      } else {
        // Emit 'untouch' event with fader index and info
        this.emit('untouch', this.index, this.getInfoDict());
        if (this.onUntouch) {
          this.onUntouch(this.index, this.getInfoDict());
        }
      }
    }
  }

  /**
   * Sets the progression of the fader.
   * Also updates the position accordingly.
   * @param {number} progression - The progression value to be set.
   */
  setProgression(progression) {
    this.setProgressionOnly(progression);
    // Also update position accordingly
    const position = this.progressionToPosition(progression);
    this.setPositionOnly(position);
  }

  /**
   * Sets the progression value of the fader without updating the position.
   * @param {number} progression - The progression value to be set.
   */
  setProgressionOnly(progression) {
    this.progression = this.mapProgressionToTrimRange(progression);
  }

  /**
   * Sets the position of the fader.
   * Also updates the progression accordingly.
   * @param {number} position - The position value to be set.
   */
  setPosition(position) {
    // Map the position to the trim range
    this.setPositionOnly(position);
    // Also update progression accordingly
    const progression = this.positionToProgression(position);
    this.setProgressionOnly(progression);
  }

  /**
   * Sets the position value of the fader without updating the progression.
   * @param {number} position - The position value to set.
   */
  setPositionOnly(position) {
    // Only sets the position value
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

  /**
   * Maps a position value to the trim range.
   * @param {number} position - The position value to be mapped.
   * @returns {number} The mapped position value.
   */
  mapPositionToTrimRange(position) {
    const lower = this.progressionToPosition(this.ProgressionMap[0]);
    const upper = this.progressionToPosition(this.ProgressionMap[1]);
    const fullRange = 16383; // 14-bit range
    const scaledPosition = lower + (position / fullRange) * (upper - lower);
    return Math.round(scaledPosition);
  }

  /**
   * Converts a position value to a progression value.
   * @param {number} position - The position value to be converted.
   * @returns {number} The converted progression value.
   */
  positionToProgression(position) {
    const lower = this.progressionToPosition(this.ProgressionMap[0]);
    const upper = this.progressionToPosition(this.ProgressionMap[1]);
    const scaledProgression = ((position - lower) / (upper - lower)) * 100;
    return Math.max(0, Math.min(scaledProgression, 100)); // Clamp to 0-100
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
    // Convert a 0-100 float value to a 14-bit integer
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
   * Returns a dictionary of the fader information. Positions/Profressions are mapped by Fader Trim settings.
   * @returns {Object} The dictionary containing the fader information.
   */
  getInfoDict() {
    const dict = {
      index: this.index,
      position: this.mapPositionToTrimRange(this.position),
      progression: this.mapProgressionToTrimRange(this.progression),
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
    return this.echo_mode;
  }

  /**
   * Returns the progression map of the fader.
   * @returns {Array<number>} The progression map.
   */
  getProgressionMap() { 
    return this.ProgressionMap;
  }

  /**
   * Returns the movement speed factor of the fader.
   * @returns {number} The movement speed factor.
   */
  getMovementSpeedFactor() {
    return this.MovementSpeedFactor;
  }
}

/**
 * Represents a fader move operation.
 * 
 * The `FaderMove` class encapsulates the details of a fader move operation, including the indexes of the faders,
 * the target progression values, and the speeds of the move operations.
 * 
 * Example usage:
 * 
 * ```javascript
 * const { FaderMove } = require('./FaderController');
 * 
 * // Create a new FaderMove instance
 * const move = new FaderMove([0, 1], [50, 20], [10, 100]);
 * 
 * // Update the indexes
 * move.setIdx([2, 3]);
 * 
 * // Update the target progression values
 * move.setTarget([70, 30]);
 * 
 * // Update the speeds
 * move.setSpeed([20, 80]);
 * 
 * // Get the dictionary representation of the fader move operation
 * const moveDict = move.getDict();
 * console.log(moveDict);
 * ```
 * 
 * @class
 * @param {number|Array<number>} idx - The index or indexes of the faders.
 * @param {number|Array<number>} target - The target progression value(s).
 * @param {number|Array<number>} speed - The speed(s) of the fader move operation(s). From 0-100. 0 being no move, 100 being instant.
 */
class FaderMove {
  /**
   * Creates a new instance of the FaderMove class.
   * @param {number|Array<number>} idx - The index or indexes of the faders.
   * @param {number|Array<number>} target - The target progression value(s).
   * @param {number|Array<number>} speed - The speed(s) of the fader move operation(s). From 0-100. 0 being no move, 100 being instant.
   */
  constructor(idx, target, speed) {
    this.idx = Array.isArray(idx) ? idx : [idx];
    this.target = Array.isArray(target) ? target : Array(this.idx.length).fill(target);
    this.speed = Array.isArray(speed) ? speed : Array(this.idx.length).fill(speed);
  }

  /**
   * Returns a dictionary representation of the fader move operation.
   * @returns {Object} - The dictionary representation of the fader move operation.
   * @deprecated Use the class object directly instead.
   */
  getDict() {
    return {
      idx: this.idx,
      target: this.target,
      speed: this.speed
    };
  }

  /**
   * Sets the indexes of the faders.
   * @param {number|Array<number>} idx - The index or indexes of the faders.
   */
  setIdx(idx) {
    this.idx = Array.isArray(idx) ? idx : [idx];
  }

  /**
   * Sets the target progression values.
   * @param {number|Array<number>} target - The target progression value(s).
   */
  setTarget(target) {
    this.target = Array.isArray(target) ? target : Array(this.idx.length).fill(target);
  }

  /**
   * Sets the speeds of the fader move operations.
   * @param {number|Array<number>} speed - The speed(s) of the fader move operation(s). From 0-100. 0 being no move, 100 being instant.
   */
  setSpeed(speed) {
    this.speed = Array.isArray(speed) ? speed : Array(this.idx.length).fill(speed);
  }
}

/**
 * Represents a fader controller.
 * 
 * The `FaderController` class handles the initialization, state management, and interaction with motorized faders.
 * It supports various operations such as calibration, movement, and MIDI message handling.
 * 
 * Example usage:
 * 
 * ```javascript
 * const { FaderController, FaderMove } = require('./FaderController');
 * 
 * // Initialize FaderController
 * const faderController = new FaderController(console, 4, 10, true, [80, 50, 10], true, true, true);
 * faderController.setupSerial('/dev/ttyUSB0', 100000);
 * 
 * // Start the FaderController
 * faderController.start(true).then(() => {
 *   faderController.setFaderProgressionMapsTrimMap({ 0: 0, 1: 10, 2: 20, 3: 30 });
 *   console.log('FaderController started and configured.');
 * }).catch(error => {
 *   console.error('Error starting [FaderController]:', error);
 * });
 * 
 * // Move faders to a position
 * const indexes = [0, 1];
 * const target = [50, 20];
 * const moveA = new FaderMove(indexes, target, [10, 100]);
 * faderController.moveFaders(moveA, false).then(() => {
 *   console.log('Faders moved to positions:', target);
 * }).catch(error => {
 *   console.error('Error moving faders:', error);
 * });
 * 
 * // Perform calibration
 * const calibrationIndexes = [0, 1];
 * faderController.calibrate(calibrationIndexes, 0, 100, 10, 1, 100, 100, 1, true).then(results => {
 *   console.log('Calibration results:', results);
 * }).catch(error => {
 *   console.error('Error during calibration:', error);
 * });
 * 
 * // Stop the FaderController
 * faderController.stop().then(() => {
 *   faderController.closeSerial();
 *   console.log('FaderController stopped and serial port closed.');
 * }).catch(error => {
 *   console.error('Error stopping [FaderController]:', error);
 * });
 * ```
 */
class FaderController {
  /**
   * Creates a new instance of the FaderController class.
   * @param {Object} logger - The logger object for logging messages.
   * @param {number} messageDelay - The rate limit for sending messages.
   * @param {boolean} MIDILog - Whether to log MIDI messages.
   * @param {Array<number>} speeds - The standard speeds used. [fastSpeed, mediumSpeed, slowSpeed]
   * @param {boolean} ValueLog - Whether to log the verbose values in high amounts.
   * @param {boolean} MoveLog - Whether to log the verbose movement values in high amounts.
   * @param {boolean} CalibrationOnStart - Whether to calibrate the faders on start.
   * @param {Array<number>} faderIndexes - The ARRAY of indexes for the faders. [0, 1, 2, 3]. At least one fader is needed. 
   * 
   */
  constructor(logger = dev_logger, messageDelay = 0.0001, MIDILog = false, speeds = [80, 50, 10], ValueLog = false, MoveLog = false, CalibrationOnStart = true, faderIndexes = [0, 1, 2, 3]) {
    this.logger = logger;
    this.messageDelay = messageDelay;
    this.MIDILog = MIDILog;
    this.ValueLog = ValueLog;
    this.MoveLog = MoveLog;
    this.CalibrationOnStart = CalibrationOnStart;
    this.speeds = speeds;
    this.faderIndexes = faderIndexes;
    this.faders = [];

    this.ser_port = null;
    this.parser = null;

    this.MIDICache = [];
    this.MIDIDeviceReady = false;
    this.maxCacheDeviceReadiness = 3;

    this.messageQueue = [];
    this.messageQueues = [];
    this.sendingMessage = false;

    this.lastMessageTime = 0;

    this.speedFast = speeds[0];
    this.speedMedium = speeds[1];
    this.speedSlow = speeds[2];

    // Call configureFaderObject to initialize faders
    this.configureFaderObject();
  }

  /**
   * Method to update the config of a running FaderController.
   * Only variables can be modified by this method, such as the messageRateLimit.
   *
   * @param {number} messageRateLimit - The new message rate limit value.
   * @param {array} speeds - The standard speeds used. [fastSpeed, mediumSpeed, slowSpeed]
   */
  configure_vars(messageRateLimit, speeds) {
    this.messageDelay = messageRateLimit;
    this.speedFast = speeds[0];
    this.speedMedium = speeds[1];
    this.speedSlow = speeds[2];
  }

  /**
   * SetupFadersObject - Sets up the faders object based on the provided indexes.
   * 
   * 
   * @throws {Error} If the faderIndexes array is empty.
   */
  configureFaderObject() {
    try {
      if (!Array.isArray(this.faderIndexes)) {
        throw new Error('[FaderController]: faderIndexes should be an array.');
      }
      if (this.faderIndexes.length === 0) {
        throw new Error('[FaderController]: No Faders configured. At least one fader is needed.');
      }
      if (this.faderIndexes.length > 4) {
        throw new Error('[FaderController]: Invalid fader count. The maximum number of faders is 4. The provided faderIndexes are: ' + this.faderIndexes);
      }

      // Initialize faders and set up event forwarding
      this.faders = this.faderIndexes.map(index => {
        const fader = new Fader(index);
        // Forward fader events to the plugin's event bus
        fader.on('touch', (faderIdx, faderInfo) => {
          this.emit('touch', faderIdx, faderInfo);
        });
        fader.on('untouch', (faderIdx, faderInfo) => {
          this.emit('untouch', faderIdx, faderInfo);
        });
        return fader;
      });

      this.logger.debug('[FaderController]: Fader: ' + this.faderIndexes + ' configured.');
    } catch (error) {
      this.logger.error('[FaderController]: Error configuring fader object: ' + error);
      throw error;
    }
  }

  /**
   * Sets the progression maps for one or more faders.
   * 
   * @param {number[]} indexes - The indexes of the faders to set the progression maps for.
   * @param {Object} ProgressionMap - The progression map to set for the faders.
   */
  setFaderProgressionMap(indexes, ProgressionMap) {
    // Sets the passed progression maps for one or more faders
    indexes = this.normalizeAndFitIndexes(indexes); // Use IndexHandler to validate and filter indexes
    indexes.forEach(index => {
      const fader = this.findFaderByIndex(index); // Use findFaderByIndex to get the fader object
      if (fader) {
        fader.set_ProgressionMap(ProgressionMap);
        this.logger.debug(`[FaderController]: Set progression map for fader ${index}`);
      } else {
        this.logger.warn(`[FaderController]: Fader with index ${index} not found.`);
      }
    });
  }

  setFadersMovementSpeedFactor(indexes, factor) {
    // set the MovementSpeedfactors for the specified faders
    indexes = this.normalizeAndFitIndexes(indexes);
    indexes.forEach(index => {
      const fader = this.findFaderByIndex(index);
      if (fader) {
        fader.setMovementSpeedFactor(factor)
        this.logger.debug(`[FaderController]: Set speed factor for fader ${index}`);
      } else {
        this.logger.warn(`[FaderController]: Fader with index ${index} not found.`)
      }
    })
  }
  
  /**
   * Sets the trim/progression maps for one or more faders.
   * @param {dict} trimMap - The Trim Map as a dictionary, containing the indices as keys and the Trims as values
   */
  setFadersTrimsDict(trimMap) {
    for (const faderIdx in trimMap) {
      if (trimMap.hasOwnProperty(faderIdx)) {
        const trimValues = trimMap[faderIdx];
        const faderIndex = faderIdx; // Use the actual index
        const validIndexes = this.normalizeAndFitIndexes([faderIndex]); // Validate the index
  
        validIndexes.forEach(index => {
          const fader = this.findFaderByIndex(index); // Use findFaderByIndex to get the fader object
          if (fader) {
            this.setFaderProgressionMap([index], trimValues);
            this.logger.debug(`[FaderController]: Set progression map for fader ${index}`);
          } else {
            this.logger.warn(`[FaderController]: Fader with index ${index} not found.`);
          }
        });
      }
    }
  }

   /**
   * Sets the touch callbacks for the specified faders.
   * 
   * @param {number[]} indexes - The indexes of the faders to set the touch callbacks for.
   * @param {Function} callback - The callback function to be called when a fader is touched.
   * The callback function should accept two parameters:
   * 1. {number} index - The index of the fader that was touched.
   * 2. {Object} fader_dict - The dictionary containing the fader information.
   */
  setOnTouchCallbacks(indexes, callback) {
      indexes = this.normalizeAndFitIndexes(indexes); // Use IndexHandler to validate and filter indexes
      indexes.forEach(index => {
        const fader = this.findFaderByIndex(index); // Use findFaderByIndex to get the fader object
        if (fader) {
          fader.setTouchCallback(callback);
        } else {
          this.logger.warn(`[FaderController]: Fader with index ${index} not found.`);
        }
      });
    }
  
  /**
   * Sets the untouch callbacks for the specified faders.
   * 
   * @param {number[]} indexes - The indexes of the faders to set the untouch callbacks for.
   * @param {Function} callback - The callback function to be called when a fader is untouched.
   * The callback function should accept two parameters:
   * 1. {number} index - The index of the fader that was untouched.
   * 2. {Object} fader_dict - The dictionary containing the fader information.
   */
  setOnUntouchCallbacks(indexes, callback) {
      indexes = this.normalizeAndFitIndexes(indexes); // Use IndexHandler to validate and filter indexes
      indexes.forEach(index => {
        const fader = this.findFaderByIndex(index); // Use findFaderByIndex to get the fader object
        if (fader) {
          fader.setUntouchCallback(callback);
        } else {
          this.logger.warn(`[FaderController]: Fader with index ${index} not found.`);
        }
      });
    }

  /**
   * Sets up the serial port and parser with retry mechanism.
   * @param {string} ser_port_path - The path of the serial port.
   * @param {number} baud_rate - The baud rate of the serial port.
   * @param {number} retries - The number of retry attempts.
   * @param {number} delay - The delay between retry attempts in milliseconds.
   * @returns {Promise} A promise that resolves when the serial port and parser are successfully set up.
   */
  setupSerial(ser_port_path, baud_rate, retries = 5, delay = 1000) {
      return new Promise((resolve, reject) => {
          const attemptSetup = (attempt) => {
              this.logger.info(`[FaderController]: Attempt ${attempt} to initialize SerialPort: ${ser_port_path} at baud rate: ${baud_rate}`);
              
              this.ser_port = new SerialPort(ser_port_path, { baudRate: baud_rate }, (error) => {
                  if (error) {
                      this.logger.error(`[FaderController]: Error setting up serial port on attempt ${attempt}: ${error.message}`);
                      this.parser = null;
                      this.ser_port = null;
                      if (attempt < retries) {
                          this.logger.info(`[FaderController]: Retrying in ${delay}ms...`);
                          setTimeout(() => attemptSetup(attempt + 1), delay);
                      } else {
                          this.logger.error(`[FaderController]: All retry attempts failed. Unable to setup serial port.`);
                          reject(error);
                      }
                  } else {
                      this.parser = new MIDIParser();
                      this.ser_port.pipe(this.parser);
                      this.setupPortListeners();
                      this.logger.info(`[FaderController]: SerialPort initialized.`);
                      resolve();
                  }
              });
  
              this.ser_port.on('error', (error) => {
                  this.logger.error(`[FaderController]: SerialPort error: ${error.message}`);
                  this.parser = null;
                  this.ser_port = null;
                  if (attempt < retries) {
                      this.logger.info(`[FaderController]: Retrying in ${delay}ms...`);
                      setTimeout(() => attemptSetup(attempt + 1), delay);
                  } else {
                      this.logger.error(`[FaderController]: All retry attempts failed. Unable to setup serial port. Closing`);
                      this.closeSerial();
                      reject(error);
                  }
              });
          };
  
          attemptSetup(1);
      });
  }


  /**
   * Starts the FaderController.
   * 
   * @param {boolean} [calibrationOnStartParam=false] - Indicates whether to perform calibration on start.
   * @throws {Error} If the serial port and parser are not set up.
   * @returns {Promise<void>} A promise that resolves when the FaderController is started.
   */
  async start(calibrationOnStartParam = false) {
    const CalibrationOnStart = calibrationOnStartParam || this.CalibrationOnStart;
    try {
      this.logger.debug("[FaderController]: Starting the FaderController...");
  
      if (!this.ser_port || !this.parser) {
        this.logger.error("[FaderController]: Serial port and parser not set up.");
        throw new Error("[FaderController]: Serial port and parser not set up.");
      }
  
      // this.configureFaderObject();
      this.logger.debug('[FaderController]: Fader: ' + this.faderIndexes + ' configured.');
  
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
  
      if (CalibrationOnStart) {
        await this.calibrate_old(JSON.stringify[this.faderIndexes]);
      }
  
      this.logger.info("[FaderController]: FaderController started!");
    } catch (error) {
      this.logger.error("[FaderController]: Error starting [FaderController]: ", error);
      throw error;
    }
  }

  /**
   * Sets up the listeners for the serial port events.
   */
  setupPortListeners() {
    try {
      this.ser_port.on("open", () => {
        this.logger.debug("[FaderController]: SerialPort is opened: " + this.ser_port.path);
      });

      this.ser_port.on("err", (err) => {
        this.logger.error("[FaderController]: SerialPort error: " + err);
      });
    } catch (error) {
      this.logger.error("[FaderController]: Error setting up serial port listeners: " + error);
    }
    
  }

  /**
   * Closes the serial port.
   * @returns {Promise<void>} A promise that resolves when the serial port is closed.
   */
  closeSerial() {
    return new Promise((resolve, reject) => {
      if (this.ser_port.isOpen) {
        this.ser_port.close((err) => {
          if (err) {
            this.logger.error("[FaderController]: Error closing serial port: ", err);
            reject(err);
          } else {
            this.logger.info("[FaderController]: SerialPort closed succesfully");
            resolve();
          }
        });
      } else {
        this.logger.info("[FaderController]: SerialPort is already closed");
        resolve();
      }
    });
  }
  
  /**
   * Handles the case when the MIDI device did not report readiness.
   */
  handleMIDIDeviceNotReady() {
    this.logger.error("[FaderController]: MIDI device did not report readiness.");
    this.emit('MIDIDeviceNotReady');
  }
  
  /**
   * Stops the FaderController.
   * Resets the faders, waits for all messages to be sent, then closes the serial port.
   * @returns {Promise<void>} A promise that resolves when the FaderController is stopped.
   */
  stop() {
    this.logger.info("[FaderController]: Stopping the FaderController...");
    return new Promise(async (resolve, reject) => {
      try {
        await this.reset();
        this.ser_port.removeAllListeners();
        this.logger.info("[FaderController]: FaderController stopped");
        resolve();
      } catch (error) {
        this.ser_port.removeAllListeners();
        this.logger.error("[FaderController]: An error occurred while stopping the [FaderController]: " + error);
        reject(error);
      }
    });
  }
  /**
   * Checks if the MIDI device is ready.
   * @param {Function} callback - The callback function to be called with the readiness status.
   * @param {number} max_cache - The maximum number of cache messages to check.
   * @returns {Promise<boolean>} A promise that resolves with the readiness status of the MIDI device.
   */
  CheckMIDIDeviceReady(callback, max_cache) {
    return new Promise((resolve, reject) => {
      let cacheCount = 0;
      let received102 = false;
      let received116 = true; 
      
      for (let message of this.MIDICache) {
        if (this.ValueLog == true) {
          this.logger.debug("[FaderController]: Waiting for MIDI device ready...");
        }
        
        if (this.parser.translateParsedType(message[0]) === 'PROGRAM_CHANGE' && message[2] === 160) {
          if (message[3] === 102) {
            received102 = true;
          } else if (message[3] === 116) {
            received116 = true;
          }
  
          if (received102 || received116) {
            this.logger.info('[FaderController]: MIDI device is ready');
            this.MIDIDeviceReady = true;
            callback(true);
            resolve(true);
            return;
          }
        }
  
        cacheCount++;
        if (cacheCount >= max_cache) {
          this.logger.debug("[FaderController]: Max Cache reached. " + cacheCount + " of " + max_cache + " messages read.");
          callback(false);
          this.MIDIDeviceReady = false;
          resolve(false);
          return;
        }
      }
    });
  }
  
  /**
   * Caches MIDI messages that are Program Change messages.
   * @param {Array} midiDataArr - The MIDI data array.
   */
  cacheProgramChangeMessages(midiDataArr) {
    // Cache MIDI Messages that are Program Change Messages
    // They are expected to be the first 10 or so
    if (this.parser.translateParsedType(midiDataArr[0]) === 'PROGRAM_CHANGE') {
      this.MIDICache.push(midiDataArr);
    }
  }
  
  /**
   * Reads and parses MIDI data.
   * @returns {Promise<void>} A promise that resolves when the MIDI data is read and parsed.
   */
  readAndParseData() {
    return new Promise((resolve, reject) => {
      let midiDataArr;
      try {
        midiDataArr = this.parser.read();
        if (midiDataArr) {
          const logMessage = this.parser.formatParsedLogMessageArr(midiDataArr);
          if (this.MIDILog == true) {
            this.logger.debug("[FaderController]: " + logMessage);
            //lets also log the array form
            this.logger.debug("[FaderController]: MIDI ARR: " + JSON.stringify(midiDataArr));
          }
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
        this.logger.error('[FaderController]: Error reading data: ' + error);
        reject(error);
      }
    });
  }

  // info handling------------------------------------------------------------
  /**
   * Retrieves the progressions of the faders at the specified indexes.
   * If the indexes parameter is not an array, it will be converted into an array with a single index.
   *
   * @param {number|Array<number>} indexes - The indexes of the faders to retrieve progressions for.
   * @returns {Array<number>} An array of fader progressions.
   */
  getFaderProgressions(indexes) {
    indexes = this.normalizeAndFitIndexes(indexes); // Use IndexHandler to validate and filter indexes
    return indexes.map(index => {
      const fader = this.findFaderByIndex(index); // Use findFaderByIndex to get the fader object
      if (fader) {
        return fader.getProgression();
      } else {
        this.logger.warn(`[FaderController]: Fader with index ${index} not found.`);
        return null;
      }
    }).filter(progression => progression !== null);
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
    indexes = this.normalizeAndFitIndexes(indexes); // Use IndexHandler to validate and filter indexes
  
    const dicts = indexes.map(index => {
      const fader = this.findFaderByIndex(index); // Use findFaderByIndex to get the fader object
      if (fader) {
        return fader.getInfoDict();
      } else {
        this.logger.error('[FaderController]: Invalid fader index: ' + index);
        return null;
      }
    }).filter(dict => dict !== null);
  
    return dicts;
  }

  /**
   * Finds a fader by its index.
   * 
   * @param {number} index - The index of the fader to find.
   * @returns {Fader|null} The fader object if found, otherwise null.
   */
  findFaderByIndex(index) {
    const fader = this.faders.find(fader => fader.index === index) || null;
    return fader;
  }
  
  /**
   * Returns a log string containing the information for the specified faders.
   * If it is more than 1 fader, it contains an array of log strings.
   *
   * @param {number[]|number} [indexes] - The indexes of the faders to get information for.
   * If not provided, information for all faders will be returned.
   * @returns {string} - A log string containing the information for the specified faders.
   */
  getFaderInfoLog(indexes) {
    indexes = this.normalizeAndFitIndexes(indexes); // Use IndexHandler to validate and filter indexes
    const log = indexes.map(index => {
      const fader = this.findFaderByIndex(index); // Use findFaderByIndex to get the fader object
      if (fader) {
        return `Fader ${index}: ${fader.getInfoLog()}`;
      }
      return `Fader ${index}: No information available`;
    }).filter(log => log !== null);
    return log.join('\n');
  }
  
  /**
   * Checks if the MIDI device is ready.
   * @returns {boolean} - True if the MIDI device is ready, false otherwise.
   */
  isMIDIDeviceReady() {
    return this.MIDIDeviceReady;
  }
  
  /**
   * Gets the count of faders.
   * @returns {number} - The count of faders.
   */
  getFaderCount() {
    return this.fader_count;
  }
  
  /**
   * Gets the 0-based fader index from a parsed MIDI data array.
   * @param {Array} midiDataArr - The parsed MIDI data array.
   * @returns {number} - The 0-based fader index.
   */
  getFaderIndexMidiDataArr(midiDataArr) {
    let index = this.parser.getChannelMidiDataArr(midiDataArr);
    return index;
  }

  /**
   * Updates the fader information based on the provided MIDI data array.
   * @param {Array} midiDataArr - The MIDI data array.
   */
  updateFaderInfo(midiDataArr) {
    let messageType = this.parser.translateParsedType(midiDataArr[0]);
    let faderIndex;
  
    if (messageType === "PITCH_BEND") {
      faderIndex = this.getFaderIndexMidiDataArr(midiDataArr);
      const validIndexes = this.normalizeAndFitIndexes([faderIndex]);
      if (validIndexes.length > 0) {
        const fader = this.findFaderByIndex(faderIndex);
        if (fader) {
          fader.setPosition(midiDataArr[2] | (midiDataArr[3] << 7));
          if (fader.echo_mode) {
            this.echo_midi(midiDataArr, fader);
          }
        } else {
          this.logger.warn(`[FaderController]: Fader with index ${faderIndex} not found.`);
        }
      }
    } else if (messageType === "NOTE_ON") {
      faderIndex = this.getFaderIndexMidiDataArr(midiDataArr);
      const validIndexes = this.normalizeAndFitIndexes([faderIndex]);
      if (validIndexes.length > 0) {
        const fader = this.findFaderByIndex(faderIndex);
        if (fader) {
          fader.setTouch(true);
        } else {
          this.logger.warn(`[FaderController]: Fader with index ${faderIndex} not found.`);
        }
      }
    } else if (messageType === "NOTE_OFF") {
      faderIndex = this.getFaderIndexMidiDataArr(midiDataArr);
      const validIndexes = this.normalizeAndFitIndexes([faderIndex]);
      if (validIndexes.length > 0) {
        const fader = this.findFaderByIndex(faderIndex);
        if (fader) {
          fader.setTouch(false);
        } else {
          this.logger.warn(`[FaderController]: Fader with index ${faderIndex} not found.`);
        }
      }
    }
  
    if (faderIndex !== undefined) {
      const validIndexes = this.normalizeAndFitIndexes([faderIndex]);
      if (validIndexes.length > 0) {
        const fader = this.findFaderByIndex(faderIndex);
        if (fader) {
          const msg = fader.getInfoLog();
          if (this.ValueLog == true) {
            this.logger.debug("[FaderController]: FADER INFO UPDATED: " + msg);
          }
        } else {
          this.logger.warn(`[FaderController]: Fader with index ${faderIndex} not found.`);
        }
      }
    }
  }
  
  /**
   * Gets the MIDI message delay.
   * @returns {number} - The MIDI message delay.
   */
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
  async sendMIDIMessages(messages) {
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
  
  /**
   * Sends the next MIDI message in the queue.
   */
  sendNextMessage() {
    return new Promise((resolve, reject) => {
      if (this.sendingMessage || this.messageQueues.length === 0) {
        resolve();
        return;
      }
  
      const now = Date.now();
      if (now - this.lastMessageTime < this.messageDelay) {
        setTimeout(() => {
          this.sendNextMessage().then(resolve).catch(reject);
        }, this.messageDelay - (now - this.lastMessageTime));
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
          this.logger.error('[FaderController]: Error on write: ' + err.message);
          queue.reject(err);
          this.messageQueues.shift();
          reject(err);
        } else {
          const msg = this.parser.formatMIDIMessageLogArr(messageArr);
          if (this.MIDILog == true) {
            this.logger.debug('[FaderController]: Sent: ' + msg);
          }
          // If the queue is empty, remove it and resolve the Promise
          if (queue.messages.length === 0) {
            this.messageQueues.shift();
            queue.resolve();
          }
  
          // Send the next message
          this.sendNextMessage().then(resolve).catch(reject);
        }
      });
    });
  }

  /**
   * Returns a promise that resolves when all messages have been sent.
   * @returns {Promise<void>} A promise that resolves when all messages have been sent.
   */
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
  
  /**
   * Clears the message queue.
   */
  clearMessageQueue() {
    this.logger.info("[FaderController]: Clearing message queue.");
    this.messageQueue = [];
  }
  
  /**
   * Clears all message queues.
   */
  clearAllMessageQueues() {
    this.logger.info("[FaderController]: Clearing all message queues.");
    this.messageQueues = [];
  }
  
  /**
   * Clears messages by fader indexes.
   * @param {Array<number>} indexes - The indexes of the faders to clear messages for.
   */
  clearMessagesByFaderIndexes(indexes) {
    if (this.MoveLog == true) {
      this.logger.debug(`[FaderController]: Clearing messages for fader indexes: ${indexes.join(', ')}`); 
    }
    this.messageQueue = this.messageQueue.filter((message) => {
      return !indexes.includes(message.index);
    });
  }
  
  /**
   * Echoes the MIDI messages back to the faders.
   * @param {Array} midiDataArr - The MIDI data array.
   * @param {number} faderindex - The fader index.
   */
  echo_midi(midiDataArr, fader) {
    //method to echo the MIDI messages back to the faders
    //we need to reverse engineer the parsing. and then send it back
    const trimmedPosition = fader.mapPositionToTrimRange(midiDataArr[2] | (midiDataArr[3] << 7)); //get the mapped position
    const message = [
      midiDataArr[0],
      trimmedPosition & 0x7F,
      (trimmedPosition >> 7) & 0x7F
    ];
    midiDataArr[0] = midiDataArr[0] | midiDataArr[1];
    this.logger.debug(`[FaderController]: Echoing MIDI message: ${message}`);

    // Send the MIDI message back to the faders
    this.sendMIDIMessages([message]);
  }
  
  // MOVEMENT INTERMEDIATE MESSAGING LOGIC ----------------------------------
  
  /**
   * Sends a progression value to one or more faders.
   * This function takes an index or an array of indexes and a progression or an array of progressions.
   * @param {Object} progressionsDict - A dictionary where the keys are fader indexes and the values are the progressions to send to the faders.
   * @returns {Promise<void>} A promise that resolves when the progressions have been sent.
   */
  sendFaderProgressionsDict(progressionsDict) {
    // For example {0: [1,2,3,4,5], 1 : [1,2,3,4,5]}
    return new Promise(async (resolve, reject) => {
      const positionsDict = {};
      const indexes = Object.keys(progressionsDict).map(Number); // Convert string keys to numbers
      const validIndexes = this.normalizeAndFitIndexes(indexes);
  
      for (const [index, progressions] of Object.entries(progressionsDict)) {
        const numericIndex = Number(index); // Convert index to number
        if (validIndexes.includes(numericIndex)) {
          const fader = this.findFaderByIndex(numericIndex); // Use findFaderByIndex to get the fader object
          if (fader) {
            positionsDict[numericIndex] = progressions.map(progression => {
              const position = fader.progressionToPosition(progression);
              return position;
            });
          } else {
            this.logger.warn(`[FaderController]: Fader with index ${numericIndex} not found.`);
          }
        }
      }
  
      const msg = Object.entries(positionsDict).map(([index, positions]) => {
        return `${index}: ${positions.length}`;
      }).join(', ');
      if (this.MoveLog == true) {
        this.logger.debug(`[FaderController]: ProgressionsDict sent analysis (faderIdx):(AmountPositions): ${msg}`);
      }

      if (this.ValueLog == true) {
        this.logger.debug('[FaderController]: Sending Progressions to faders: ' + JSON.stringify(progressionsDict));
      }
  
      try {
        await this.sendFaderPositionsDict(positionsDict, progressionsDict);
        resolve();
      } catch (error) {
        this.logger.error('[FaderController]: Error sending fader progressions: ' + error);
        reject(error);
      }
    });
  }

  /**
   * Sends MIDI messages to set the positions of faders simultaneously.
   *
   * @param {Object} positionsDict - A dictionary where the keys are fader indexes and the values are the positions to set the faders to.
   * @param {Object} [progressionsDict] - A dictionary where the keys are fader indexes and the values are the progressions to set the faders to.
   * @returns {Promise} A promise that resolves when all MIDI messages have been sent, or rejects if an error occurs.
   */
  sendFaderPositionsDict(positionsDict, progressionsDict) {
    return new Promise(async (resolve, reject) => {
      const messages = [];
      const maxPositions = Math.max(...Object.values(positionsDict).map(positions => positions.length));
      const indexes = Object.keys(positionsDict).map(Number); // Convert string keys to numbers
      const validIndexes = this.normalizeAndFitIndexes(indexes);
  
      for (let positionIndex = 0; positionIndex < maxPositions; positionIndex++) {
        for (const index of validIndexes) {
          const fader = this.findFaderByIndex(index); // Use findFaderByIndex to get the fader object
          const positions = positionsDict[index];
          if (fader && positions && positions[positionIndex] !== undefined) {
            try {
              // If progressionsDict is provided, update the progression
              if (progressionsDict && progressionsDict[index]) {
                fader.setProgressionOnly(progressionsDict[index][positionIndex]);
                fader.setPositionOnly(positions[positionIndex]);
              } else {
                // If progressionsDict is not provided, use the standard setPosition method
                fader.setPosition(positions[positionIndex]);
              }
              const trimmedPosition = fader.mapPositionToTrimRange(positions[positionIndex]);
              const message = [
                0xE0 | (index),
                trimmedPosition & 0x7F,
                (trimmedPosition >> 7) & 0x7F
              ];
              messages.push(message);
            } catch (error) {
              this.logger.error('[FaderController]: Error setting fader position: ', error);
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
        this.logger.error('[FaderController]: Error sending MIDI messages: ', error);
        reject(error);
      }
    });
  }
  
  // FADER MOVEMENT ---------------------------------------------------------
  
  /**
   * Sets the echo mode of the specified fader indexes to the provided echo_mode.
   *
   * @param {number|Array<number>} indexes - The index or an array of indexes of the faders to set the echo mode for.
   * @param {boolean} echo_mode - The echo mode to set for the specified faders.
   */
  set_echoMode(indexes, echo_mode) {
    indexes = this.normalizeAndFitIndexes(indexes); // Use IndexHandler to validate and filter indexes
    indexes.forEach(index => {
      const fader = this.findFaderByIndex(index); // Use findFaderByIndex to get the fader object
      if (fader) {
        fader.setEchoMode(echo_mode);
        this.logger.debug(`[FaderController]: Set echo mode for fader ${index} to ${echo_mode}`);
      } else {
        this.logger.warn(`[FaderController]: Fader with index ${index} not found.`);
      }
    });
  }
  
  // CALIBRATION -------------------------------------------------------------
  
  /**
   * Performs a standard calibration of all faders.
   * This will move all faders to the top and then back to the bottom on 2 speeds.
   *
   * @param {Array<number>|number} indexes - The indexes of the faders to calibrate. If not provided, all faders will be calibrated.
   * @returns {Promise<void>} A promise that resolves when the calibration is complete, or rejects with an error if an error occurs.
   */
  async calibrate_old(indexes) {
    indexes = this.normalizeAndFitIndexes(indexes);
    const move1 = new FaderMove(indexes, 100, this.speedMedium);
    const move2 = new FaderMove(indexes, 0, this.speedSlow);
  
    try {
      this.logger.info(`[FaderController]: Calibrating Faders[${indexes}]...`);
      await this.moveFaders(move1, false);
      await this.moveFaders(move2, false);
    } catch (error) {
      this.logger.error(`[FaderController]: Error during calibration: ${error}`);
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
    indexes = this.normalizeAndFitIndexes(indexes);
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
      this.logger.error('[FaderController]: Error during calibration:', error);
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
   * @returns {Object} - The movementSpeedFactors for the indexes calibrated
   * @throws {Error} If an error occurs during calibration.
   */
  async calibrate(indexes, start = 0, end = 100, count = 10, startSpeed = 1, endSpeed = 100, DurationGoalMaxSpeed = 100, CalibrationTolerance = 1, runInParallel = true) {
    try {
      indexes = this.normalizeAndFitIndexes(indexes);
      this.logger.info('[FaderController]: Calibrating faders...');
      this.reset(indexes);
  
      // Calibrate Speed Durations
      let movementSpeedFactors = await this._calibrateSpeedDuration(indexes, start, end, count, startSpeed, endSpeed, DurationGoalMaxSpeed, runInParallel);
      
      this.logger.info('[FaderController]: Validating Calibration Results...');
      await this._delay(3000);
  
      // Validate Calibration
      let validationResult = await this._validateSpeedCalibration(indexes, movementSpeedFactors, DurationGoalMaxSpeed, CalibrationTolerance, runInParallel);
  
      this.logger.info('[FaderController]: Fader calibration complete.');
      
      // Log the calibration report
      this._logCalibrationReport(indexes, movementSpeedFactors, validationResult, DurationGoalMaxSpeed);
      const result = {"indexes" : indexes,
                    "movementSpeedFactors": movementSpeedFactors,
                    "validationResult": validationResult}

      return result;
    } catch (error) {
      this.logger.error(`[FaderController]: Fader calibration failed: ${error.message}`);
      throw new Error('[FaderController]: Fader calibration failed: ' + error.message);
    }
  }

  /**
   * Logs the calibration report.
   * @param {Array<number>} indexes - The indexes of the faders.
   * @param {Object} movementSpeedFactors - The movement speed factors for the faders.
   * @param {Object} validationResult - The validation results for the faders.
   */
  _logCalibrationReport(indexes, movementSpeedFactors, validationResult, DurationGoalMaxSpeed) {
    const midiMessageDelay = this.getMidiMessageDelay();
    const reportLines = [
      '[FaderController]: --- FADER CALIBRATION REPORT ---',
      `[FaderController]: System: ${os.type()} ${os.release()} (${os.arch()})`,
      `[FaderController]: Node.js: ${process.version}`,
      `[FaderController]: Initialized Faders: ${this.getFaderCount()}`,
      `[FaderController]: Fader Indexes: ${indexes.join(', ')}`,
      `[FaderController]: ${this.getFaderInfoLog(indexes)}`,
      `[FaderController]: MIDI Device Ready: ${this.isMIDIDeviceReady()}`,
      `[FaderController]: MIDI Message Delay: ${midiMessageDelay}ms`,
      `[FaderController]: Duration Goal (Max Speed): ${DurationGoalMaxSpeed}ms`,
      '[FaderController]: --------------------------------',
      '[FaderController]: Fader Index | Speed Factor | Validation Result',
      '[FaderController]: --------------------------------'
    ];
  
    indexes.forEach(index => {
      const speedFactor = movementSpeedFactors[index] || 'N/A';
      const validation = validationResult[index] ? 'Passed' : 'Failed';
      reportLines.push(`[FaderController]: ${index}           | ${speedFactor}       | ${validation}`);
    });
  
    reportLines.push('[FaderController]: --------------------------------');
    reportLines.push('[FaderController]: --- END CALIBRATION REPORT. ---');
    this.logger.info(reportLines.join('\n'));
  };
  
  /**
   * Generates moves for faders.
   * @param {Array<number>} indexes - The indexes of the faders.
   * @param {number} start - The start position of the faders.
   * @param {number} end - The end position of the faders.
   * @param {number} count - The number of moves to generate.
   * @param {number} startSpeed - The starting speed of the moves.
   * @param {number} endSpeed - The ending speed of the moves.
   * @returns {Array<Object>} The generated moves.
   */
  _generateMoves(indexes, start, end, count, startSpeed, endSpeed) {
    const moves = [];
    const speedStep = (endSpeed - startSpeed) / (count - 1);
  
    for (let i = 0; i < count; i++) {
      const positions = (i % 2 === 0) ? [end, start] : [start, end];
      const speed = startSpeed + i * speedStep;
  
      // Ensure positions and speed are valid
      if (!positions || positions.length === 0) {
        throw new Error(`[FaderController]: Invalid positions array at count ${i}`);
      }
      if (speed === undefined || speed === null) {
        throw new Error(`[FaderController]: Invalid speed value at count ${i}`);
      }
  
      moves.push({ idx: indexes, target: positions, speed: [speed, speed] });
    }
    this.logger.debug(`[FaderController]: [FaderController]: Generated moves: ${JSON.stringify(moves)}`);
    return moves;
  };
  
  /**
   * Moves faders based on parallel or sequential mode.
   * @param {Array<Object>} moves - The moves to perform.
   * @param {Array<number>} indexes - The indexes of the faders.
   * @param {boolean} runInParallel - Whether to run the moves in parallel.
   * @returns {Promise<Object>} The results of the moves.
   */
  async _moveFadersCalibration(moves, indexes, runInParallel) {
    const results = {};
    if (runInParallel) {
      await Promise.all(moves.map(async (move) => {
        if (!move.target || !move.speed) {
          throw new Error('[FaderController]: Invalid move configuration: positions or speed missing');
        }
        this.logger.debug(`[FaderController]: _moveFadersCalibration: Moving Faders: ${move.idx} to ${move.target} with speed: ${move.speed} Interrupting: false`);
        const duration = await this.moveFaders(move, false);
        this._updateResults(results, move.idx, move.speed[0], duration);
      }));
    } else {
      for (let move of moves) {
        for (let index of move.idx) {
          const fader = this.findFaderByIndex(index);
          if (!fader) {
            this.logger.error(`[FaderController]: _moveFadersCalibration Fader at index ${index} is not initialized.`);
            continue;
          }
  
          if (!move.target || !Array.isArray(move.target) || move.target.length === 0) {
            throw new Error(`[FaderController]: _moveFadersCalibration: Invalid positions for fader ${index}: ${JSON.stringify(move.target)}`);
          }
          if (!move.speed || !Array.isArray(move.speed) || move.speed.length === 0) {
            throw new Error(`[FaderController]: _moveFadersCalibration: Invalid speed for fader ${index}: ${JSON.stringify(move.speed)}`);
          }
  
          const singlePosition = move.target[0];
          this.logger.debug(`[FaderController]: _moveFadersCalibration: Moving Fader ${index} to ${singlePosition} with speed: ${move.speed[0]} Interrupting: false`);
          const singleMove = { idx: [index], target: [singlePosition], speed: [move.speed[0]] };
          const duration = await this.moveFaders(singleMove, false);
          this._updateResults(results, [index], move.speed[0], duration);
        }
      }
    }
    this.logger.debug(`[FaderController]: Results after _moveFadersCalibration: ${JSON.stringify(results)}`);
    return results;
  };
  
  _updateResults(results, indexes, speed, duration) {
    indexes.forEach(index => {
      results[index] = results[index] || {};
      results[index][speed] = duration;
      this.logger.debug(`[FaderController]: Updated results for fader ${index} at speed ${speed}: ${duration}ms`);
    });
  }

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  async _calibrateSpeedDuration(indexes, start, end, count, startSpeed, endSpeed, DurationGoalMaxSpeed, runInParallel) {
    // Filter valid indexes based on this.faders
    const validIndexes = indexes.filter(index => this.findFaderByIndex(index) !== null);
  
    if (validIndexes.length === 0) {
      this.logger.error('[FaderController]: No valid fader indexes provided for calibration.');
      return {};
    }
  
    this.logger.debug(`[FaderController]: Normalized indexes: ${validIndexes}`);
  
    const moves = this._generateMoves(validIndexes, start, end, count, startSpeed, endSpeed);
    const results = await this._moveFadersCalibration(moves, validIndexes, runInParallel);
    const movementSpeedFactors = this._calculateMovementSpeedFactors(validIndexes, results, DurationGoalMaxSpeed);
  
    return movementSpeedFactors;
  }
    
  /**
   * Calculates the movement speed factors for the specified fader indexes.
   * @param {Array<number>} indexes - The indexes of the faders.
   * @param {Object} results - The calibration results.
   * @param {number} DurationGoalMaxSpeed - The desired duration for max speed movement in ms.
   * @returns {Object} The movement speed factors for the faders.
   */
  _calculateMovementSpeedFactors(indexes, results, DurationGoalMaxSpeed) {
    const movementSpeedFactors = {};
  
    indexes.forEach(index => {
      const fader = this.findFaderByIndex(index);
      if (!fader) {
        this.logger.error(`[FaderController]: Fader at index ${index} is not initialized.`);
        return;
      }
  
      if (!results[index]) {
        this.logger.error(`[FaderController]: No calibration results for fader index ${index}`);
        return;
      }
  
      const maxSpeed = Math.max(...Object.keys(results[index]).map(Number));
      const durationAtMaxSpeed = results[index][maxSpeed];
  
      if (durationAtMaxSpeed === undefined) {
        this.logger.error(`[FaderController]: Duration at max speed for index ${index} is undefined`);
        return;
      }
  
      const movementSpeedFactor = durationAtMaxSpeed / DurationGoalMaxSpeed;
      movementSpeedFactors[index] = movementSpeedFactor;
      fader.setMovementSpeedFactor(movementSpeedFactor);
  
      this.logger.debug(`[FaderController]: Set SPEED FACTOR for fader ${index} to ${movementSpeedFactor}`);
    });
  
    this.logger.debug(`[FaderController]: MovementSpeedFactors: ${JSON.stringify(movementSpeedFactors)}`);
    return movementSpeedFactors;
  }
  
  /**
   * Validates the speed calibration for the specified fader indexes.
   * @param {Array<number>} indexes - The indexes of the faders.
   * @param {Object} movementSpeedFactors - The movement speed factors for the faders.
   * @param {number} DurationGoalMaxSpeed - The desired duration for max speed movement in ms.
   * @param {number} CalibrationTolerance - The tolerance for the calibration.
   * @param {boolean} runInParallel - Whether to run the validation in parallel.
   * @returns {Promise<Object>} The validation results.
   */
  async _validateSpeedCalibration(indexes, movementSpeedFactors, DurationGoalMaxSpeed, CalibrationTolerance, runInParallel) {
    const results = {};
  
    if (runInParallel) {
      await this._validateParallel(indexes, movementSpeedFactors, DurationGoalMaxSpeed, CalibrationTolerance, results);
    } else {
      await this._validateSequential(indexes, movementSpeedFactors, DurationGoalMaxSpeed, CalibrationTolerance, results);
    }
  
    return results;
  }
  
  /**
   * Validates the speed calibration in parallel for the specified fader indexes.
   * @param {Array<number>} indexes - The indexes of the faders.
   * @param {Object} movementSpeedFactors - The movement speed factors for the faders.
   * @param {number} DurationGoalMaxSpeed - The desired duration for max speed movement in ms.
   * @param {number} CalibrationTolerance - The tolerance for the calibration.
   * @param {Object} results - The validation results.
   */
  async _validateParallel(indexes, movementSpeedFactors, DurationGoalMaxSpeed, CalibrationTolerance, results) {
    // Filter valid indexes based on this.faders
    const validIndexes = indexes.filter(index => this.findFaderByIndex(index) !== null);
  
    if (validIndexes.length === 0) {
      this.logger.error('[FaderController]: No valid fader indexes provided for parallel validation.');
      return;
    }
  
    const move = new FaderMove(validIndexes, 100, 100);
    await this.reset(validIndexes);
    await this._delay(3000);
  
    const duration = await this.moveFaders(move, false);
    this._performValidation(validIndexes, duration, DurationGoalMaxSpeed, CalibrationTolerance, results);
  }
  
  /**
   * Validates the speed calibration sequentially for the specified fader indexes.
   * @param {Array<number>} indexes - The indexes of the faders.
   * @param {Object} movementSpeedFactors - The movement speed factors for the faders.
   * @param {number} DurationGoalMaxSpeed - The desired duration for max speed movement in ms.
   * @param {number} CalibrationTolerance - The tolerance for the calibration.
   * @param {Object} results - The validation results.
   */
  async _validateSequential(indexes, movementSpeedFactors, DurationGoalMaxSpeed, CalibrationTolerance, results) {
    for (let index of indexes) {
      const fader = this.findFaderByIndex(index);
      if (fader) {
        const move = new FaderMove([index], 100, 100);
        await this.reset([index]);
        await this._delay(3000);
  
        const duration = await this.moveFaders(move, false);
        this._performValidation([index], duration, DurationGoalMaxSpeed, CalibrationTolerance, results);
      } else {
        this.logger.error(`[FaderController]: Fader at index ${index} is not initialized.`);
      }
    }
  }
  
  /**
   * Performs the validation for the specified fader indexes.
   * @param {Array<number>} indexes - The indexes of the faders.
   * @param {number} duration - The duration of the move.
   * @param {number} DurationGoalMaxSpeed - The desired duration for max speed movement in ms.
   * @param {number} CalibrationTolerance - The tolerance for the calibration.
   * @param {Object} results - The validation results.
   */
  _performValidation(indexes, duration, DurationGoalMaxSpeed, CalibrationTolerance, results) {
    indexes.forEach(index => {
      const fader = this.findFaderByIndex(index);
      if (fader) {
        const tolerance = DurationGoalMaxSpeed * CalibrationTolerance;
        const lowerBound = DurationGoalMaxSpeed - tolerance;
        const upperBound = DurationGoalMaxSpeed + tolerance;
        const isValid = duration >= lowerBound && duration <= upperBound;
        results[index] = { duration, isValid };
        this.logger.info(`Validation for fader ${index}: ${isValid} (Duration: ${duration}ms)`);
      }
    });
  }

  // MOVEMENT BASICS ------------------------------------------------------

  /**
   * Resets the faders to 0.
   * @param {Array<number>|number} indexes - The indexes of the faders to reset. If not provided, all faders will be reset.
   * @returns {Promise<void>} A promise that resolves when the faders are reset, or rejects with an error if an error occurs.
   */
  reset(indexes) {
    return new Promise(async (resolve, reject) => {
      indexes = this.normalizeAndFitIndexes(indexes);
      const resetMove = new FaderMove(indexes, 0, this.speedMedium);
      try {
        this.logger.info(`[FaderController]: Resetting faders: ${indexes}`);
        await this.moveFaders(resetMove, true, 1);
        resolve();
      } catch (error) {
        this.logger.error(`[FaderController]: Error resetting faders: ${error}`);
        reject(error);
      }
    });
  }
  
  /**
   * Generates a ramp of progression values between a start and end value.
   * @param {number} start - The start value of the ramp.
   * @param {number} end - The end value of the ramp.
   * @param {number} steps - The number of steps in the ramp.
   * @returns {Array<number>} The generated ramp.
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
  async moveFaders(move, interrupting = false, MovementSpeedFactor = 1) {
    if (interrupting) {
      this.clearMessagesByFaderIndexes(move.idx);
    }
    this.logger.debug(`[FaderController]: moveFaders: Moving Faders: ${move.idx} to ${move.target} with speed: ${move.speed} Interrupting: ${interrupting} Factor: ${MovementSpeedFactor}`);    
    // Validate indexes
    move.idx.forEach(idx => {
      const fader = this.findFaderByIndex(idx);
      if (!fader) {
        throw new Error(`[FaderController]: Fader at index ${idx} is not initialized.`);
      }
    });
  
    this.target = this.ensureCorrectLength(move.target, move.idx.length);
    this.speed = this.ensureCorrectLength(move.speed, move.idx.length);
  
    move.distance = move.idx.map((idx, i) => {
      const fader = this.findFaderByIndex(idx);
      return Math.abs(fader.progression - move.target[i]);
    });
  
    // Here we need to introduce the movement speed factor
    // If none provided, we will use the MovementSpeedFactor in the faders[idx] object
    // If provided, we use MovementSpeedFactor
    const effectiveSpeeds = move.speed.map((speed, i) => {
      let speedFactor;
      const fader = this.findFaderByIndex(move.idx[i]);
      if (MovementSpeedFactor !== undefined) {
        speedFactor = MovementSpeedFactor;
      } else {
        speedFactor = fader.MovementSpeedFactor;
        if (speedFactor === undefined || speedFactor === null || isNaN(speedFactor)) {
          this.logger.warn(`[FaderController]: MovementSpeedFactor for fader ${move.idx[i]} is invalid: ${speedFactor}. Using fallback value of 1.`);
          speedFactor = 1;
        }
      }
      return speed * speedFactor;
    });
  
    move.steps = move.distance.map((distance, i) => Math.max(Math.round(distance / (effectiveSpeeds[i] / 100) + 1), 1));
    move.stepSize = move.distance.map((distance, i) => distance / move.steps[i]);
  
    move.ramps = move.idx.map((idx, i) => {
      const fader = this.findFaderByIndex(idx);
      if (this.ValueLog) {
        this.logger.debug(`[FaderController]: Generating ramp for fader ${idx} from ${fader.progression} to ${move.target[i]} with ${move.steps[i]} steps`);
      }
      return this.generateRamp(fader.progression, move.target[i], move.steps[i]);
    });
  
    if (this.ValueLog) {
      this.logger.debug(`[FaderController]: Ramps created: ${JSON.stringify(move.ramps)}`);
    }
  
    const progressionsDict = move.idx.reduce((dict, idx, i) => ({ ...dict, [idx]: move.ramps[i] }), {});
  
    try {
      const startTime = Date.now();
      await this.sendFaderProgressionsDict(progressionsDict);
      const endTime = Date.now();
      const duration = endTime - startTime;
  
      if (this.MoveLog == true) {
        const rampStartActual = move.idx.map((idx, i) => move.ramps[i][0]);
        const rampEndActual = move.idx.map((idx, i) => move.ramps[i][move.ramps[i].length - 1]);
        this.logger.debug(`[FaderController]: FADER MOVE PROTOCOL: 
        Moved Faders: ${JSON.stringify(move.idx)}
        Targets: ${JSON.stringify(move.target)}
        RampStartActual: ${JSON.stringify(rampStartActual)}
        RampEndActual: ${JSON.stringify(rampEndActual)}
        Speeds: ${JSON.stringify(effectiveSpeeds)}
        StepSize: ${JSON.stringify(move.stepSize)}
        Steps: ${JSON.stringify(move.steps)}
        Duration: ${duration}ms
        FaderInfo: \n${this.getFaderInfoLog(move.idx)}`);
      }
      return duration;
  
    } catch (error) {
      this.logger.error(`[FaderController]: moveFaders: Error moving faders: ${error}`);
      throw error;
    }
  }

  /**
   * Combines multiple FaderMove objects into a single FaderMove object.
   * @param {Array<FaderMove>} faderMoves - An array of FaderMove objects to combine.
   * @returns {FaderMove|null} - A new FaderMove object with combined moves, or null if invalid input.
   */
  combineMoves(faderMoves) {
    if (!Array.isArray(faderMoves) || faderMoves.length === 0) {
      this.logger.warn('[FaderController]: No fader moves provided for combination.');
      return null;
    }

    const idxArray = [];
    const targetArray = [];
    const speedArray = [];

    // Loop through each FaderMove and extract its idx, target, and speed arrays
    for (const move of faderMoves) {
      // Ensure it's a valid FaderMove object
      if (move instanceof FaderMove) {
        for (const idx of move.idx) {
          const fader = this.findFaderByIndex(idx);
          if (fader) {
            idxArray.push(idx);
            targetArray.push(move.target[move.idx.indexOf(idx)]);
            speedArray.push(move.speed[move.idx.indexOf(idx)]);
          } else {
            this.logger.error(`[FaderController]: Fader at index ${idx} is not initialized.`);
          }
        }
      } else {
        this.logger.error('[FaderController]: Invalid FaderMove object encountered.');
      }

      // Stop if we reach the maximum of 4 faders
      //! maximum is the configured faders objects length?
      if (idxArray.length >= 4) break;
    }

    // Slice arrays to a maximum length of 4 in case more were added
    return new FaderMove(idxArray.slice(0, 4), targetArray.slice(0, 4), speedArray.slice(0, 4));
  }
  
  // HELPER METHODS -------------------------------------------------------
  
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
      this.logger.debug('[FaderController]: Array length does not match idx length. Using first value.');
      return Array(length).fill(arr[0]);
    } else {
      // If arr is an array and its length matches, use it as is
      return arr;
    }
  }

  /**
   * Normalizes the indexes array.
   *
   * @param {Array<number>|number|string|Array<string>} indexes - The indexes to normalize.
   * @returns {Array<number>} The normalized indexes array.
   */
  normalizeAndFitIndexes(indexes) {  
    if (indexes === undefined) {
      const allIndexes = this.faders.map(fader => fader.index);
      return allIndexes;
    } else {
      if (!Array.isArray(indexes)) {
        indexes = [indexes];
      }

      const normalizedIndexes = indexes.map(index => {
        if (typeof index === 'string') {
          this.logger.warn(`[FaderController]: IndexHandler: Converting string index "${index}" to number.: ${[Number(index)]}`);
          return [Number(index)];
        }
        return index;
      });
  
      const validIndexes = normalizedIndexes.filter(index => {
        const fader = this.findFaderByIndex(index);
        return fader !== null;
      });

      return validIndexes;
    }
  }

};

module.exports = {
  FaderController,
  FaderMove
};