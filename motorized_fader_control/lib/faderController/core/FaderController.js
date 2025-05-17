const SerialPort = require('serialport');
const EventEmitter = require('events');
const Mutex = require('async-mutex').Mutex;

const MIDIParser = require('../midi/MIDIParser');
const MovementCalculator = require('./FaderMovementCalculator');
const Fader = require('./Fader'); // Import the outsourced Fader class
const FaderMove = require('./FaderMove');

const MIDIQueue = require('../midi/MIDIQueue');
const MIDIFeedbackTracker = require('../midi/MIDIFeedbackTracker')
const MIDIHandler = require('../midi/MIDIHandler')

const CalibrationEngine = require('../calibration/CalibrationEngine'); // Import the CalibrationEngine

const FaderEventEmitter = require('../events/FaderEventEmitter'); // Import the CalibrationEngine


const {
  FaderControllerError,
  SerialPortError,
  MIDIError,
  CalibrationError,
  MIDIQueueError,
  MIDIFeedbackTrackerError,
  FaderErrors,
  SerialErrors
} = require('../errors');


/**
 * Emitted Events:
 * - 'touch'(index, faderInfo) - Fader touched
 * - 'untouch'(index, faderInfo) - Fader released  
 * - 'move'(index, faderInfo) - Fader position changed
 * - 'error'(Error) - Critical failure
 * - 'midi'(rawData) - Raw MIDI input
 * - 'ready' - Fader controller is ready
 * - 'configChange'(index, config) - Fader configuration changed
 * - 'calibration'(index, calibrationData) - Fader calibration data
 */
class FaderController extends FaderEventEmitter {
  constructor(config = {}) {
    super(config.logger, config);

    // Default calibration configuration
    const defaultCalibrationConfig = {
      startProgression: 0,
      endProgression: 100,
      calibrationCount: 20,
      startSpeed: 10,
      endSpeed: 100,
      resolutions: [1, 0.8, 0.5, 0.2], // Default resolutions
      warmupRuns: 1, // Default warmup runs
      measureRuns: 2 // Default measure runs
    };

    // Merge provided calibration config with defaults
    this.calibrationConfig = {
      ...defaultCalibrationConfig,
      ...(config.calibrationConfig || {})
    };

    this.config = {
      logger: console,
      MIDILog: false,
      ValueLog: false,
      MoveLog: false,
      messageDelay: 0.0001,
      speeds: [60, 30, 10],
      faderIndexes: [0, 1, 2, 3],
      queueOverflow: 16383,
      calibrateOnStart: true,
      feedback_midi: true, // enable if midi device supports feedback
      feedback_tolerance: 10, // tolerance for feedback
      disableInternalEventLogging: false, // Disable internal event logging
      disableEventLogging: false, // Disable all event logging
      ...config
    };

    this.faders = this.createFaders();
    this.listenFaders(this.faders)

    this.midiHandler = null;
    this.midiQueue = null;
    
    this.queueMutex = new Mutex();
    this.reconnectAttempts = 5;
    this.serial = null;
    this.initMIDIState();

    this.speedMultiplier = 1; //! Adjust this value to control speed
  }

  //* INIT CONF AND INSTANCES #############################################

  logConfig() {
    //loop through config and log the values
    if (this.config.logger) {
      this.config.logger.seperator('debug');
      for (const [key, value] of Object.entries(this.config)) {
        if (key !== 'logger') {
          this.config.logger.debug(`${key}: ${value}`);
        }
      }
      // also log fader infos for each fader
      this.faders.forEach(fader => {
        this.config.logger.debug(`Fader ${fader.index}: ${JSON.stringify(fader.info)}`);
      });
      this.config.logger.seperator('debug');
    }
  }

//* FADER SETUP #############################################

  setFaderTrim(index, min, max) {
  this.getFader(index).setProgressionMap([min, max]);
  }

  createFaders() {
    return this.config.faderIndexes.map(index => {
      return new Fader(index, this.config);
    });
  }

  setFaderProgressionMap(index, range) { // make this accept multiple indexes optionally
    const fader = this.getFader(index);
    if (!fader) throw new Error(`Fader ${index} not found`);
    fader.setProgressionMap(range);
  }

  setFadersMovementSpeedFactor(index, speedFactor) {
    const fader = this.getFader(index);
    if (!fader) throw new Error(`Fader ${index} not found`);
    if (typeof speedFactor !== 'number' || speedFactor <= 0 || speedFactor === null) {
        this.config.logger.warn(`Invalid speedFactor for fader ${index}. Resetting to default (1).`);
        speedFactor = 1; // Reset to default if invalid
    }
    fader.speedFactor = speedFactor;
  }

  setFaderEchoMode(index, echoMode) {
    const fader = this.getFader(index);
    if (!fader) throw new Error(`Fader ${index} not found`);
    fader.setEchoMode(echoMode);
  }

  listenFaders(faders) { // pass events of faders
    faders.forEach(fader => {
      fader.on('internal:touch', (index, info) => this.emit('touch', index, info));
      fader.on('internal:untouch', (index, info) => this.emit('untouch', index, info));
      fader.on('internal:echo/on', (index, echoMode) => this.emit('echo/on', index, echoMode));
      fader.on('internal:echo/off', (index, echoMode) => this.emit('echo/off', index, echoMode));
      fader.on('internal:move', (index, info) => this.emit('move', index, info)); // user move
      fader.on('internal:move/start', (index, info) => this.emit('move/start', index, info)); // External event
      fader.on('internal:move/complete', (index, info) => this.emit('move/complete', index, info)); // External event
      fader.on('internal:move/step/start', (index, info) => this.emit('move/step/start', index, info)); // External event
      fader.on('internal:move/step/complete', (index, info) => this.emit('move/step/complete', index, info)); // External event
      fader.on('internal:configChange', (index, config) => this.emit('configChange', index, config));
    });
  }

  listenMIDI(midiHandler) {
    midiHandler.on('midi', rawData => this.emit('midi', rawData));
    midiHandler.on('error', error => this.emit('error', error));
  }

  listenMIDIQueue(MIDIQueue) {
    return
  }

  listenMIDIFeedback(MIDIFeedbackTracker) {
    return
  }

  //* MIDI Handling #############################################
  initMIDIState() {
    this.midiDeviceReady = false;
    this.midiCache = [];
  }

  handleDisconnect() {
    this.emit('error', Object.assign(error, {
      code: SerialErrors.SERIAL_PORT_DISCONNECTED
    }));
    const reconnect = () => {
      if(this.reconnectAttempts++ < 5) {
        this.setupSerial(this.lastSerialConfig).catch(() => 
          setTimeout(reconnect, 2000)
        );
      }
    };
    
    reconnect();
  }

  handleMIDIMessage(message) {
    try {
      if (this.MIDILog) {
      this.config.logger.debug(`MIDI HANDLE: ${message.type}`); 
      }
      
      switch(message.type) {
        case 'PITCH_BEND':
          this.handleFaderMove(message);
          break;
        case 'NOTE_ON':
        case 'NOTE_OFF':
          this.handleTouch(message);
          break;
        case 'PROGRAM_CHANGE':
          this.cacheMIDIStatus(message.raw);
          break;
      }
    } catch (error) {
      this.emit('error', error);
    }
  }

  handleFaderMove(message) {
    const position = (message.data2 << 7) | message.data1;
    const fader = this.getFader(message.channel);
  
    if (fader) {
      // Check if this is feedback for a software-driven movement
      if (!fader.touch && this.midiQueue.feedbackTracker.isTrackingFeedback(message.channel)) {
        
        this.midiQueue.feedbackTracker.handleFeedbackMessage(message.channel, position);
        fader.updatePositionFeedback(position);

      } else {
        // Handle user-driven movement
        fader.updatePositionUser(position);
        if (fader.echoMode) {
          const mappedPos = fader.mapPosition(position);
          const options = {
            disableFeedback: true
          };
          this.midiQueue.add([
            message.channel,
            mappedPos & 0x7F,
            (mappedPos >> 7) & 0x7F
          ], options);
        }
      }
    }
  }

  handleTouch(message) {
    const fader = this.getFader(message.channel);
    if (fader && message.type == "NOTE_ON") {
      fader.updateTouchState(true);
    } else if (fader && message.type == "NOTE_OFF") {
      fader.updateTouchState(false);
    }
  }

  cacheMIDIStatus(data) {
    if (data[0] === 0xC0) {
      this.midiCache.push(data);
      if (this.midiCache.length > 10) this.midiCache.shift();
    }
  }

  //* Movement Control #############################################
  async moveFaders(move, interrupt = false, disableFeedback = false) {
    try {
      if (interrupt) this.clearQueue(move.indexes);
  
      // Enable feedback simulation if feedback is disabled
      if (!this.config.feedback_midi || disableFeedback) {
        this.midiQueue.feedbackTracker.enableSoftwareFeedback();
      } else {
        this.midiQueue.feedbackTracker.disableSoftwareFeedback();
      }
  
      const movements = move.indexes.map((index, i) => {
        const fader = this.getFader(index);
        const effectiveSpeed = this.calculateEffectiveSpeed(
          move.speeds[i],
          fader.speedFactor,
          fader.progression,
          move.targets[i]
        );
  
        return {
          index,
          target: fader.mapProgression(move.targets[i]),
          speed: effectiveSpeed,
          resolution: move.resolution
        };
      });
  
      const positions = this.calculateMovements(movements);
      const options = { disableFeedback };
  
      await this.sendPositions(positions, options);
      this._LogMove(positions, options, movements, interrupt);
  
    } catch (error) {
      this.config.logger.error(`Error in moveFaders: ${error.message}`, {
        move,
        error
      });
      this.emit('error', Object.assign(error, {
        code: FaderErrors.MOVEMENT_ERROR,
        move
      }));
      throw error;
    }
  }

  _LogMove(positions, options, movements, interrupt) {
    if (this.config.MoveLog) {
      this.config.logger.debug('========== MOVE LOG ==========');
  
      // Log general movement details
      this.config.logger.debug(`Interrupt: ${interrupt}`);
      this.config.logger.debug(`Feedback Disabled: ${options.disableFeedback}`);
      this.config.logger.debug(`Number of Positions: ${positions.length}`);
  
      // Log detailed movement information for each fader
      movements.forEach((movement, i) => {
        const position = positions.find(pos => pos.index === movement.index);
        this.config.logger.debug(`Fader ${movement.index}:`);
        this.config.logger.debug(`  Target Position: ${movement.target}`);
        this.config.logger.debug(`  Effective Speed: ${movement.speed}`);
        this.config.logger.debug(`  Resolution: ${movement.resolution}`);
        if (position) {
          this.config.logger.debug(`  Final Position Sent: ${position.value}`);
        }
      });
  
      this.config.logger.debug('==============================');
    }
  
    if (this.config.ValueLog) {
      this.config.logger.debug('========== MOVE VALUE LOG ==========');
      positions.forEach(pos => {
        this.config.logger.debug(`Fader ${pos.index}: Position Sent: ${pos.value}`);
      });
      this.config.logger.debug('====================================');
    }
  }

  calculateEffectiveSpeed(requestedSpeed, speedFactor, currentPos, targetPos) {
    // Apply speed factor
    return Math.max(0.1, requestedSpeed * speedFactor);
  }

  calculateMovements(movements) {
    const positions = [];
  
    movements.forEach(move => {
      // Validate input
      if (typeof move.speed !== 'number' || move.speed <= 0 || move.speed > 100) {
        throw new Error(`Invalid speed ${move.speed} for fader ${move.index} - must be >0 and <=100`);
      }
  
      const fader = this.getFader(move.index);
      const faderPositions = MovementCalculator.calculateMovements(
        fader,
        move.target,
        move.speed,
        move.resolution,
        this.speedMultiplier
      );
  
      positions.push(...faderPositions);
    });
  
    return positions;
  }

  /**
   * Sends an array of fader positions to the MIDI queue for processing.
   *
   * @async
   * @param {Array<{index: number, value: number}>} positions - An array of position objects.
   * Each object should have the following properties:
   *   - `index` {number}: The index of the fader (0-15).
   *   - `value` {number}: The position value of the fader (0-16383).
   * 
   * @throws {Error} Throws an error if the queue lock cannot be acquired or if a queue overflow occurs.
   * The error object will include additional properties:
   *   - `code` {string}: Error code ('QUEUE_LOCK_ERROR' or 'QUEUE_OVERFLOW').
   *   - `positions` {Array} (for 'QUEUE_LOCK_ERROR'): The positions array that caused the error.
   *   - `count` {number} (for 'QUEUE_OVERFLOW'): The number of messages in the queue.
   * 
   * @emits error - Emits an 'error' event with the error object and additional details.
   */
  async sendPositions(positions, options = {}) {
    const release = await this.queueMutex.acquire().catch(error => {
      this.emit('error', Object.assign(error, {
        code: 'QUEUE_LOCK_ERROR',
        positions
      }));
      throw error;
    });
  
    try {
      if (positions.length > this.config.queueOverflow) {
        this.emit('error', new Error('Queue overflow'), {
          code: FaderErrors.QUEUE_OVERFLOW,
          count: positions.length
        });
        positions.splice(this.config.queueOverflow);
      }
  
      await Promise.all(positions.map(pos => {
        const message = [
          0xE0 | pos.index,
          pos.value & 0x7F,
          (pos.value >> 7) & 0x7F
        ];
        return this.midiQueue.add(message, options); // Pass options here
      }));
    } catch (error) {
      this.emit('error', Object.assign(error, {
        code: FaderErrors.SEND_POS_ERROR,
        positions
      }));
      throw error;
    } finally {
      release();
    }
  }

  //* Calibration System #############################################
  //! deprecated and outsourced
  async advancedCalibration(indexes) {
    this.calibrationEngine = new CalibrationEngine(this);
    return this.calibrationEngine.runCalibration(indexes); // Delegate to CalibrationEngine
  }

  async runCalibrationMove(index, StartProgression, EndProgression, speed, resolution) {
    const fader = this.getFader(index);
    const faderMove = new FaderMove([index], [StartProgression], [EndProgression], speed, resolution);
    await this.moveFaders(faderMove, false, false);

    return duration
  }

  //* basic calibration #############################################
  async calibrate(indexes) {
    this.config.logger.debug(`Calibrating...`);
    return await this.testCalibrationMoves(indexes);
  }

  async testCalibrationMoves(indexes, speed_up = 50, speed_down = 10, resolution = 1) {
    try {
      let moves = [
        new FaderMove(indexes, 100, speed_up, resolution),
        new FaderMove(indexes, 0, speed_down, resolution)
      ];
      await this.reset(indexes);
      for (let i = 0; i < moves.length; i++) {
        await this.moveFaders(moves[i], false, false);
      }
    } catch (error) {
      this.config.logger.error(`Error during testCalibrationMoves: ${error.message}`, {
        indexes,
        speed_up,
        speed_down,
        resolution,
        error
      });
      this.emit('error', Object.assign(error, {
        code: FaderErrors.CALIBRATION_FAILED,
        details: { indexes, speed_up, speed_down, resolution }
      }));
      throw error;
    }
  }

  //* Public API #############################################

  async setupSerial(serialConfig) {
    const port = serialConfig.port;
    const baudRate = serialConfig.baudRate;
    const retries = serialConfig.retries || 5;
    for (let i = 1; i <= retries; i++) {
      try {
        this.serial = new SerialPort(port, { baudRate });
        this.midiHandler = new MIDIHandler(this);
        this.listenMIDI(this.midiHandler)

        this.midiQueue = new MIDIQueue(this.serial, this, this.config.messageDelay);
        this.listenMIDIQueue(this.midiQueue)

        this.serial.on('close', () => this.handleDisconnect());
        this.serial.pipe(this.midiHandler.parser);
        
        await new Promise((resolve, reject) => {
          this.serial.once('open', resolve);
          this.serial.once('error', reject);
        });
        
        return;
      } catch (err) {
        const attemptError = Object.assign(err, {
          code: SerialErrors.SERIAL_PORT_CONNECTION_FAILED,
          attempt: i,
          maxAttempts: retries
        });
        
        this.emit('error', attemptError);
        
        if (i === retries) {
          throw attemptError;
        }
        
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }

  async start() {
    if (!this.serial?.isOpen) {
      throw new Error('Serial port not initialized');
    }

    try {
      await this.checkMIDIDeviceReady();
      if (this.config.calibrateOnStart) await this.calibrate(this.config.faderIndexes);
      this.emit('internal:ready');
      this.config.logger.info(`FaderController started successfully`);
    } catch (error) {
      this.config.logger.error('Startup failed:', error);
      throw error;
    }
  }

  async stop() {
    try {
      // await this.reset(this.config.faderIndexes);
      await this.closeSerial();
      this.config.logger.info('FaderController stopped successfully');
    } catch (error) {
      this.config.logger.error('Error while stopping FaderController:', error);
      this.emit('error', { message: 'Failed to stop FaderController', details: error.message });
    }
  }

  reset(indexes) {
    return this.moveFaders(new FaderMove(indexes, 0, this.config.speeds[1], 1), true, true);
  }

  combineMoves(moves) {
    return FaderMove.combineMoves(moves)
  }

  //* Utilities #############################################
  getFader(index) {
    try {
      const fader = this.faders[index];
      if (!fader) throw new Error(`Fader ${index} not found`);
      return fader;
    } catch (error) {
      this.emit('error', Object.assign(error, {
        code: 'FADER_NOT_FOUND',
        requestedIndex: index,
        availableIndexes: this.config.faderIndexes
      }));
      throw error;
    }
  }

  clearQueue(indexes) {
    try {
      if (!Array.isArray(indexes)) {
        indexes = [indexes];
      }
      
      for (const index of indexes) {
        this.midiQueue.flush(index);
      }
    } catch (error) {
      this.config.logger.error(`Error clearing queue for indexes: ${indexes}`, error);
      this.emit('error', Object.assign(error, {
        code: FaderErrors.QUEUE_CLEAR_ERROR,
        indexes
      }));
    }
  }

  async closeSerial() {
    try {
      if (this.serial?.isOpen) {
        await new Promise((resolve, reject) => {
          this.serial.close(err => {
            if (err) {
              const error = new SerialPortError('Error closing serial port', err);
              this.config.logger.error(error.message, { originalError: err });
              return reject(error);
            }
            this.config.logger.info('Serial port closed successfully');
            resolve();
          });
        });
      } else {
        this.config.logger.info('Serial port was not open');
      }
    } catch (error) {
      const serialError = new SerialPortError('Error in closeSerial', error);
      this.config.logger.error(serialError.message, { originalError: error });
      this.emit('error', serialError); // Emit the error for higher-level handling
      throw serialError; // Re-throw the error for propagation
    }
  }

  async checkMIDIDeviceReady(maxAttempts = 10) {
    try {
        let attempts = 0;
        const READY_SIGNAL_1 = 102;  // 0x66
        const READY_SIGNAL_2 = 116;  // 0x74
        
        while (attempts < maxAttempts && !this.midiDeviceReady) {
            // Check for specific ready signals in PROGRAM_CHANGE messages
            const isReady = this.midiCache.some(msg => {
                // Validate message structure: [0xC0, channel, data1, data2]
                // For PROGRAM_CHANGE (0xC0), data1 is the program number
                if (msg[0] === 0xC0 && msg.length >= 4) {
                    return msg[3] === READY_SIGNAL_1 || msg[3] === READY_SIGNAL_2;
                }
                return false;
            });

            if (isReady) {
                this.midiDeviceReady = true;
                this.config.logger.debug(`MIDI device ready signal received`);
                return true;
            }

            await new Promise(resolve => setTimeout(resolve, 1500));  // Increased timeout
            attempts++;
            this.config.logger.debug(`Device check attempt ${attempts}/${maxAttempts}`);
        }

        throw new Error(`MIDI device not responding after ${maxAttempts} attempts`);
    } catch (error) {
        this.emit('error', {
            ...error,
            code: FaderErrors.DEVICE_NOT_READY,
            attempts: maxAttempts,
            lastMessages: this.midiCache.slice(-5)  // Include recent messages for debugging
        });
        throw error;
    }
}
}

module.exports = FaderController;