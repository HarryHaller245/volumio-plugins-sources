const SerialPort = require('serialport');
const MIDIParser = require('./MIDIParser');
const EventEmitter = require('events');
const Mutex = require('async-mutex').Mutex;

// Error codes enumeration
const FaderErrors = {
  CONNECTION_FAILED: 'CONNECTION_FAILED',
  INVALID_CONFIG: 'INVALID_CONFIG',
  MOVEMENT_ERROR: 'MOVEMENT_ERROR',
  CALIBRATION_FAILED: 'CALIBRATION_FAILED',
  DEVICE_NOT_READY: 'DEVICE_NOT_READY',
  QUEUE_OVERFLOW: 'QUEUE_OVERFLOW',
  SEND_POS_ERROR: 'SEND_POSITIONS_ERROR',
  QUEUE_CLEAR_ERROR: 'QUEUE_CLEAR_ERROR',
};

class Fader extends EventEmitter {
  constructor(index) {
    super();
    this.index = index;
    this.position = 0;
    this.progression = 0;
    this.touch = false;
    this.echoMode = false;
    this.progressionMap = [0, 100];
    this.speedFactor = 1;
  }

  setProgressionMap([min, max]) {
    try {
      if (min >= max || min < 0 || max > 100) {
        throw new Error('Invalid progression map range');
      }
      this.progressionMap = [min, max];
      this.emit('configChange', this.index, {
        progressionMap: this.progressionMap
      });
    } catch (error) {
      this.emit('error', Object.assign(error, {
        code: FaderErrors.INVALID_CONFIG,
        details: { index: this.index, min, max }
      }));
    }
  }

  mapProgression(externalProg) {
    const [min, max] = this.progressionMap;
    return ((externalProg - min) / (max - min)) * 100;
  }

  mapPosition(position) {
    const minPos = this.progressionToPosition(this.progressionMap[0]);
    const maxPos = this.progressionToPosition(this.progressionMap[1]);
    return Math.round(minPos + (position / 16383) * (maxPos - minPos));
  }

  updateTouchState(touch) { //bool
    if (this.touch !== touch) {
      this.touch = touch;
      this.emit(touch ? 'touch' : 'untouch', this.index, this.info);
    }
  }

  updatePosition(position) {
    this.position = position;
    this.progression = (position / 16383) * 100;
    if (this.touch) {
      this.emit('move', this.index, this.info);
    }
  }

  get info() {
    return {
      index: this.index,
      position: this.mapPosition(this.position),
      progression: this.mapProgression(this.progression),
      rawPosition: this.position,
      rawProgression: this.progression,
      touch: this.touch,
      echoMode: this.echoMode,
      progressionMap: [...this.progressionMap],
      speedFactor: this.speedFactor
    };
  }

  progressionToPosition(progression) {
    return Math.round((progression / 100) * 16383);
  }

  setEchoMode(echo) {
    this.echoMode = echo;
    this.emit('configChange', this.index, {
      echoMode: this.echoMode
    });
    this.emit(echo ? 'echo/on' : 'echo/off', this.index, {
      echoMode: this.echoMode
    });
  }
}

class FaderMove {
  constructor(indexes, targets, speeds, resolution = 1) {
    this.indexes = Array.isArray(indexes) ? indexes : [indexes];
    this.targets = this.normalizeValues(targets, this.indexes.length);
    this.speeds = this.normalizeValues(speeds, this.indexes.length);
    this.resolution = resolution;
  }

  normalizeValues(values, length) {
    return Array.isArray(values) 
      ? values.slice(0, length)
      : Array(length).fill(values);
  }
}

class MIDIHandler {
  constructor(controller) {
    this.controller = controller;
    this.parser = new MIDIParser();
    this.setupHandlers();
    this.MODULESTR = `[${this.constructor.name}]`;
  }

  setupHandlers() {
    this.parser.on('data', data => {
      const message = this.parseMessage(data);
      if (this.controller.config.MIDILog) {
        this.controller.config.logger.debug(`[FaderController] MIDI RECV: ${JSON.stringify(message)}`);
      }
      this.controller.handleMIDIMessage(message);
    });
  }

  parseMessage(buffer) {
    try {
      //MIDI PARSER in the module is already parsing messages to
      // const buffer = Buffer.from([this.type, this.channel, this.data1, this.data2]);
      if (!buffer || buffer.length < 3) return null;

      const message = {
          raw: buffer,
          type: this.parser.translateStatusByte(buffer[0]),
          channel: buffer[1],
          data1: buffer[2],
          data2: buffer[3]
      };

      // Special handling for different message types
      switch(message.type) {
          case 'PROGRAM_CHANGE':
          case 'NOTE_ON':
              // Note on off messages parse the channel differently
              message.channel = buffer[2] - 104;
          case 'NOTE_OFF':
              message.channel = buffer[2] - 104;
          case 'CHANNEL_AFTERTOUCH':
              message.data2 = undefined;
              break;
      }

      return message;
    } catch (error) {
        this.controller.emit('error', {
            ...error,
            code: 'MIDI_PARSE_ERROR',
            rawData: buffer
        });
        return null;
    }
}

  formatForLog(message) {
    return this.parser.formatMIDIMessageLogArr([
      message.raw[0],
      message.data1,
      message.data2
    ]);
  }
}

class MIDIQueue {
  constructor(serial, controller, delay = 0.01, timeout = 500000) {
    this.serial = serial;
    this.queue = new Map(); // Using Map to track sequences per fader
    this.delay = delay;
    this.isProcessing = false;
    this.controller = controller;
    this.config = controller.config;
    this.pendingPromises = new Map();
    this.timeout = timeout;
    this.faders = controller.faders;
    this.sequenceCounters = new Map(); // Track sequence numbers per fader
    this.max_batchSize = 4; // Number of faders to process in parallel
    this.currentBatch = new Set(); // Currently processing faders
  }

  add(message) {
    return new Promise((resolve, reject) => {
      const id = Symbol();
      const timer = setTimeout(() => {
        this.pendingPromises.delete(id);
        reject(new Error('MIDI send timeout'));
      }, this.timeout);

      const faderIndex = this.get_index(message);
      
      // Initialize sequence counter if not exists
      if (!this.sequenceCounters.has(faderIndex)) {
        this.sequenceCounters.set(faderIndex, 0);
      }
      
      const sequenceNumber = this.sequenceCounters.get(faderIndex);
      this.sequenceCounters.set(faderIndex, sequenceNumber + 1);

      // Initialize queue for fader if not exists
      if (!this.queue.has(faderIndex)) {
        this.queue.set(faderIndex, []);
      }

      this.queue.get(faderIndex).push({ 
        message, 
        id,
        sequenceNumber 
      });

      this.pendingPromises.set(id, { resolve, reject, timer });
      this.process();
    });
  }

  async process() {
    if (this.isProcessing || this.queue.size === 0) return;
    
    this.isProcessing = true;

    try {
      // Find available faders for parallel processing
      const availableFaders = [];
      for (const [faderIndex, messages] of this.queue) {
        if (!this.currentBatch.has(faderIndex) && messages.length > 0) {
          availableFaders.push(faderIndex);
          if (availableFaders.length >= this.max_batchSize) break;
        }
      }

      if (availableFaders.length === 0) {
        this.isProcessing = false;
        return;
      }

      // Process messages in parallel
      await Promise.all(availableFaders.map(async faderIndex => {
        this.currentBatch.add(faderIndex);
        const messages = this.queue.get(faderIndex);
        
        if (messages && messages.length > 0) {
          // Get the next message in sequence for this fader
          const nextMessage = messages.shift();
          
          if (messages.length === 0) {
            this.queue.delete(faderIndex);
          }

          try {
            // Dont send message if the fader at the indexes is being touched
            const index = this.get_index(nextMessage.message);
            if (!this.faders[index].touch) {
              await this.send(nextMessage.message);
              const position = this.get_position(nextMessage.message);
              this.controller.getFader(index).updatePosition(position);

              this.controller.emit('midi/sent', {
                message: nextMessage.message
              });
            }

            if (this.pendingPromises.has(nextMessage.id)) {
              const { resolve, timer } = this.pendingPromises.get(nextMessage.id);
              clearTimeout(timer);
              resolve();
              this.pendingPromises.delete(nextMessage.id);
            }
          } catch (error) {
            if (this.pendingPromises.has(nextMessage.id)) {
              const { reject, timer } = this.pendingPromises.get(nextMessage.id);
              clearTimeout(timer);
              reject(error);
              this.pendingPromises.delete(nextMessage.id);
            }
            this.controller.emit('error', {
              ...error,
              code: 'MIDI_SEND_ERROR',
              message: nextMessage.message
            });
          }
        }
        
        this.currentBatch.delete(faderIndex);
      }));

    } finally {
      setTimeout(() => {
        this.isProcessing = false;
        this.process();
      }, this.delay);
    }
  }

  send(message) {
    return new Promise((resolve, reject) => {
      const buffer = Buffer.from(message);
  
      if (this.controller.config.MIDILog) {
        this.controller.config.logger.debug(`[FaderController]: MIDI SEND: ${JSON.stringify(message)}`);
      }
  
      if (!this.serial.isOpen) {
        const err = new Error('Serial port not open');
        this.controller.emit('error', {
          ...err,
          code: FaderErrors.CONNECTION_FAILED
        });
        return reject(err);
      }
  
      this.serial.write(buffer, (err) => {
        if (err) {
          this.controller.emit('error', {
            ...err,
            code: FaderErrors.CONNECTION_FAILED
          });
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  flush(faderIndex = null) {
    try {
      if (faderIndex === null) {
        // Clear entire queue if no fader specified
        this.queue.clear(); // Clear the Map
        for (const [id, { resolve, timer }] of this.pendingPromises) {
          clearTimeout(timer);
          resolve(); // Fulfill the promise instead of rejecting
          this.pendingPromises.delete(id);
        }
            } else {
        // Clear only messages for the specified fader
        if (!this.queue.has(faderIndex)) {
          this.config.logger.info(`Queue is empty for fader ${faderIndex}`);
          return;
        }
        this.queue.delete(faderIndex); // Remove the fader's queue

        // Fulfill pending promises for the specified fader
        for (const [id, { resolve, timer, message }] of this.pendingPromises) {
          const msgFaderIndex = this.get_index(message);
          if (msgFaderIndex === faderIndex) {
            clearTimeout(timer);
            resolve(); // Fulfill the promise instead of rejecting
            this.pendingPromises.delete(id);
          }
        }
            }
            this.isProcessing = false;
          } catch (error) {
            this.controller.emit('error', {
        ...error,
        code: FaderErrors.QUEUE_CLEAR_ERROR,
        faderIndex
            });
            throw error;
          }
        }

  get_index(message) {
    const faderIndex = message[0] & 0x0F;
    return faderIndex;
  }

  get_position(message) {
    const position = (message[1] << 7) | message[2];
    return position;
  }

}

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
class FaderController extends EventEmitter {
  constructor(config = {}) {
    super();

    // Default configuration
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
      ...config
    };
    this.MODULESTR = `[${this.constructor.name}]`; //! deprecated
    this.faders = this.createFaders();
    this.midiHandler = null;
    this.midiQueue = null;
    this.queueMutex = new Mutex();
    this.reconnectAttempts = 5;
    this.serial = null;
    this.initMIDIState();

    this.speedMultiplier = 1; // Adjust this value to control speed
  }

  // INIT CONF AND INSTANCES #############################################

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

  setFaderTrim(index, min, max) {
    this.getFader(index).setProgressionMap([min, max]);
  }

  createFaders() {
    return this.config.faderIndexes.map(index => {
      const fader = new Fader(index);
      ['touch', 'move', 'untouch', 'configChange', 'echo/on', 'echo/off'].forEach(evt => {
        fader.on(evt, (index, info) => {
          this.emit(evt, index, info);
          this.config.logger.debug(`emitting ${evt} for fader ${index}: ${JSON.stringify(info)}`);
        });
      });
      return fader;
    });
  }

  // MIDI Handling #############################################
  initMIDIState() {
    this.midiDeviceReady = false;
    this.midiCache = [];
  }

  handleDisconnect() {
    this.emit('error', new Error('Serial port disconnected'));
    
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
    // MIDI pitch bend uses 14-bit value (0-16383)
    // LSB is first data byte, MSB is second data byte
    const position = (message.data2 << 7) | message.data1;
    const fader = this.getFader(message.channel);
    
    if (fader) {
        fader.updatePosition(position);
        if (fader.echoMode) {
            // Use mapped position for echo
            const mappedPos = fader.mapPosition(position);
            this.midiQueue.add([
                message.channel, // MIDI channels 0-15
                mappedPos & 0x7F,             // LSB
                (mappedPos >> 7) & 0x7F       // MSB
            ]);
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

  // Movement Control #############################################
  async moveFaders(move, interrupt = false) {
    try {
      if (interrupt) this.clearQueue(move.indexes);
      
      if (this.config.MoveLog) {
          this.config.logger.debug(`Move: ${JSON.stringify(move)}`);
      }

      const movements = move.indexes.map((index, i) => {
          const fader = this.getFader(index);
          const effectiveSpeed = this.calculateEffectiveSpeed(
              move.speeds[i], 
              fader.speedFactor,
              fader.progression,
              move.targets[i]
          );
          
          if (this.config.MoveLog) {
              this.config.logger.debug(`Fader ${index} ` +
                  `speedFactor: ${fader.speedFactor.toFixed(2)}, ` +
                  `effectiveSpeed: ${effectiveSpeed.toFixed(2)}`);
          }

          return {
              index,
              target: fader.mapProgression(move.targets[i]),
              speed: effectiveSpeed,
              resolution: move.resolution
          };
      });

      const positions = this.calculateMovements(movements);
      if (this.config.MoveLog) {
        //log the number of positions per fader
        const positionsPerFader = positions.reduce((acc, pos) => {
          acc[pos.index] = (acc[pos.index] || 0) + 1;
          return acc;
        }, {});
        this.config.logger.debug(`Generated ${JSON.stringify(positionsPerFader)} positions`);
      }
      if (this.config.ValueLog) {
        this.config.logger.debug(`Positions: ${JSON.stringify(positions)}`);
      }
      
      await this.sendPositions(positions);
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

  calculateEffectiveSpeed(requestedSpeed, speedFactor, currentPos, targetPos) {
    // Apply speed factor
    return Math.max(0.1, requestedSpeed * speedFactor);
  }

  calculateMovements(movements) {
      const positions = [];
      const MIN_STEP = 10; // Minimum movement step (1)
      const MAX_STEPS = 16383; // Maximum 14-bit value
  
      movements.forEach(move => {
          // Validate input
          if (typeof move.speed !== 'number' || move.speed <= 0 || move.speed > 100) {
              throw new Error(`Invalid speed ${move.speed} for fader ${move.index} - must be >0 and <=100`);
          }
  
          const fader = this.getFader(move.index);
          const currentPos = fader.position;
          const targetPos = fader.progressionToPosition(move.target);
  
          if (Math.abs(currentPos - targetPos) <= MIN_STEP) {
              // Already at target (or very close)
              positions.push({
                  index: move.index,
                  value: targetPos
              });
              return;
          }
  
          // Calculate number of steps based on speed and speedMultiplier
          const speedRatio = move.speed / 100; // Normalize speed to 0-1 range
          const numSteps = Math.max(
              2, // Minimum 2 steps (start + end)
              Math.min(
                  Math.ceil((1 - speedRatio) * this.speedMultiplier * 100), // Steps based on speed and multiplier
                  MAX_STEPS // Maximum steps to prevent excessive messages
              )
          );
          
          // Generate intermediate positions (excluding the first position)
          const stepSize = (targetPos - currentPos) / (numSteps - 1);
          for (let i = 1; i < numSteps; i++) { // Start from 1 to skip the first position
              const value = Math.round(currentPos + (stepSize * i));
              positions.push({
                  index: move.index,
                  value: value
              });
          }
  
          // Apply resolution filter
          const filteredSteps = this.applyResolutionFilter(
              positions.filter(p => p.index === move.index),
              move.resolution,
              currentPos,
              targetPos
          );
  
          // Replace positions for this fader with filtered ones
          positions.splice(
              positions.findIndex(p => p.index === move.index),
              positions.filter(p => p.index === move.index).length,
              ...filteredSteps
          );
      });
  
      return positions;
  }

  applyResolutionFilter(steps, resolution, startPos, endPos) {
    if (resolution >= 1 || steps.length <= 2) {
        return steps;
    }
  
    // Convert resolution (0-1) to a step selection ratio
    const keepRatio = Math.min(1, Math.max(0.01, resolution));
    const keepCount = Math.max(2, Math.ceil(steps.length * keepRatio));
    
    // Always include first and last positions
    const filtered = [steps[0]];
    
    // Distribute remaining steps evenly
    const stepInterval = (steps.length - 2) / (keepCount - 2);
    for (let i = 1; i < keepCount - 1; i++) {
        const index = Math.round(1 + (i * stepInterval));
        filtered.push(steps[index]);
    }
    
    filtered.push(steps[steps.length - 1]);
    return filtered;
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
  async sendPositions(positions) {
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
          count: positionGroups.length
        });
        positions.splice(this.config.queueOverflow);
      }

      await Promise.all(positions.map(pos => {
        const message = [
          0xE0 | pos.index,
          pos.value & 0x7F,
          (pos.value >> 7) & 0x7F
        ];
        return this.midiQueue.add(message);
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
  async advancedCalibration(indexes) {
    // Validate input
    if (!Array.isArray(indexes) || indexes.length === 0) {
        const error = new Error('Invalid calibration indexes - must be a non-empty array');
        this.config.logger.error(`CALIBRATION ERROR: ${error.message}`, { indexes });
        throw Object.assign(error, {
            code: FaderErrors.INVALID_INPUT,
            indexes
        });
    }

    // Configuration from parameters
    const testParams = this.config.calibrationConfig;

    // Generate test speeds based on start and end speed
    const speedStep = (testParams.endSpeed - testParams.startSpeed) / (testParams.calibrationCount - 1);
    const testSpeeds = Array.from({ length: testParams.calibrationCount }, (_, i) =>
        Math.round(testParams.startSpeed + i * speedStep)
    );

    this.config.logger.info(`=== STARTING CALIBRATION ===`);
    this.config.logger.info(`Faders: ${indexes.join(', ')}`);
    this.config.logger.info(`Testing speeds: ${testSpeeds.join(', ')}`);
    this.config.logger.info(`Testing resolutions: ${testParams.resolutions.join(', ')}`);

    const calibrationTimeout = setTimeout(() => {
        const error = new Error('Calibration timeout');
        this.config.logger.error(`CALIBRATION TIMEOUT: ${error.message}`);
        this.emit('error', Object.assign(error, {
            code: FaderErrors.CALIBRATION_FAILED,
            timeout: 300000000
        }));
    }, 300000000);

    try {
        const calibrationResults = {};
        const logTable = [];

        for (const index of indexes) {
            calibrationResults[index] = {};
            const fader = this.getFader(index);

            for (const resolution of testParams.resolutions) {
                calibrationResults[index][resolution] = {};
                this.config.logger.info(`Testing Fader ${index} at resolution ${resolution}`);

                for (const speed of testSpeeds) {
                    this.config.logger.info(`Speed ${speed}%:`);
                    const runTimes = [];

                    // Warmup runs (discarded)
                    for (let i = 0; i < testParams.warmupRuns; i++) {
                        await this.runCalibrationMove(
                            index,
                            testParams.startProgression,
                            testParams.endProgression,
                            speed,
                            resolution
                        );
                    }

                    // Measured runs
                    for (let i = 0; i < testParams.measureRuns; i++) {
                        const duration = await this.runCalibrationMove(
                            index,
                            testParams.startProgression,
                            testParams.endProgression,
                            speed,
                            resolution
                        );
                        runTimes.push(duration);

                        this.config.logger.info(`Run ${i + 1}: ${duration}ms`);
                    }

                    // Calculate statistics
                    const avgTime = runTimes.reduce((a, b) => a + b, 0) / runTimes.length;
                    const variance = runTimes.reduce((a, b) => a + Math.pow(b - avgTime, 2), 0) / runTimes.length;
                    const stdDev = Math.sqrt(variance);
                    const effectiveSpeed = (testParams.endProgression - testParams.startProgression) / (avgTime / 1000);

                    // Store results
                    calibrationResults[index][resolution][speed] = {
                        runTimes,
                        avgTime,
                        stdDev,
                        effectiveSpeed
                    };

                    // Add to log table
                    logTable.push({
                        Fader: index,
                        Resolution: resolution,
                        Speed: speed,
                        'Avg Time (ms)': Math.round(avgTime),
                        'Std Dev (ms)': stdDev.toFixed(1),
                        'Effective Speed (units/s)': effectiveSpeed.toFixed(1)
                    });
                }
            }

            // Calculate optimal resolution and speed factor
            const optimal = this.calculateOptimalSettings(calibrationResults[index]);
            fader.speedFactor = optimal.speedFactor;
            fader.optimalResolution = optimal.resolution;

            this.config.logger.info(`Fader ${index} calibration complete:`);
            this.config.logger.info(`- Optimal resolution: ${optimal.resolution}`);
            this.config.logger.info(`- Speed factor: ${optimal.speedFactor.toFixed(2)}`);
        }

        // Print summary table
        this.printCalibrationTable(logTable);

        this.emit('calibration', calibrationResults);
        return Promise.resolve(calibrationResults);

    } catch (error) {
        this.config.logger.error(`CALIBRATION FAILED: ${error}`);
        this.emit('error', Object.assign(error, {
            code: FaderErrors.CALIBRATION_FAILED,
            indexes
        }));
        return Promise.reject(error);
    } finally {
        clearTimeout(calibrationTimeout);
        this.config.logger.info(`\n=== CALIBRATION COMPLETE ===`);
        await this.reset(indexes);
    }
}

  async runCalibrationMove(index, start, end, speed, resolution) {
      const startTime = Date.now();
      await this.moveFaders(new FaderMove(index, start, speed), true); // Move to start
      await this.moveFaders(new FaderMove(index, end, speed, resolution), true); // Timed move
      return Date.now() - startTime;
  }

  calculateOptimalSettings(faderData) {
      // Find resolution with best consistency (lowest average std deviation)
      let bestResolution = 1;
      let bestConsistency = Infinity;
      
      for (const [resolution, data] of Object.entries(faderData)) {
          const avgStdDev = Object.values(data).reduce((sum, test) => sum + test.stdDev, 0) / Object.keys(data).length;
          if (avgStdDev < bestConsistency) {
              bestConsistency = avgStdDev;
              bestResolution = Number(resolution);
          }
      }

      // Calculate speed factor based on best resolution's 100% speed test
      const refSpeed = 100; // Our target speed
      const effectiveSpeed = faderData[bestResolution][refSpeed].effectiveSpeed;
      const speedFactor = refSpeed / effectiveSpeed;

      return {
          resolution: bestResolution,
          speedFactor,
          consistency: bestConsistency
      };
  }

  printCalibrationTable(data) {
    const columns = [
        { field: 'Fader', title: 'Fader' },
        { field: 'Resolution', title: 'Resolution' },
        { field: 'Speed', title: 'Speed %' },
        { field: 'Avg Time (ms)', title: 'Avg Time (ms)' },
        { field: 'Std Dev (ms)', title: '±Dev' },
        { field: 'Effective Speed (units/s)', title: 'Speed (u/s)' }
    ];

    // Find max widths for each column
    const widths = columns.map(col => {
        const headerWidth = col.title.length;
        const contentWidth = Math.max(...data.map(row => String(row[col.field]).length));
        return Math.max(headerWidth, contentWidth) + 2; // Add padding for readability
    });

    // Print header
    let header = '';
    columns.forEach((col, i) => {
        header += col.title.padEnd(widths[i]);
    });
    this.config.logger.info(`${header}`);
    this.config.logger.info(`${'-'.repeat(header.length)}`);

    // Print rows
    data.forEach(row => {
        let line = '';
        columns.forEach((col, i) => {
            line += String(row[col.field]).padEnd(widths[i]);
        });
        this.config.logger.info(`${line}`);
    });
  }

  calculateSpeedFactor(speedData) {
      // Calculate average effective speed across all test speeds
      const speeds = Object.values(speedData);
      const avgEffectiveSpeed = speeds.reduce((sum, test) => sum + test.effectiveSpeed, 0) / speeds.length;
      
      return 100 / avgEffectiveSpeed; // Normalize to target speed of 100 units/s
  }

  // Utility method for delays
  delay(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
  }

  async testCalibrationMoves(indexes, speed_up = 100, speed_down = 50, resolution = 1) {
    let moves = [
      new FaderMove(indexes, 0, 100, resolution),
      new FaderMove(indexes, 100, speed_up, resolution),
      new FaderMove(indexes, 0, speed_down, resolution)
    ];
    for (let i = 0; i < moves.length; i++) {
      await this.moveFaders(moves[i], false);
    }
  }

  processCalibrationData(data) {
    return Object.entries(data).reduce((result, [index, readings]) => {
      const fader = this.getFader(Number(index));
      const durations = [];
      
      for (let i = 1; i < readings.length; i++) {
        durations.push(readings[i].time - readings[i-1].time);
      }
      
      const avgDuration = durations.reduce((sum, d) => sum + d, 0) / durations.length;
      fader.speedFactor = 1000 / avgDuration;
      result[index] = fader.speedFactor;
      this.emit('calibration', index, {
        index,
        speedFactor: fader.speedFactor,
        readings
      });
      return result;
    }, {});
  }

  //* basic calibration #############################################
  async calibrate(indexes) {
    this.config.logger.debug(`Calibrating...`);
    return await this.testCalibrationMoves(indexes);
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
        this.midiQueue = new MIDIQueue(this.serial, this, this.config.messageDelay);
        this.serial.on('close', () => this.handleDisconnect());
        this.serial.pipe(this.midiHandler.parser);
        
        await new Promise((resolve, reject) => {
          this.serial.once('open', resolve);
          this.serial.once('error', reject);
        });
        
        return;
      } catch (err) {
        const attemptError = Object.assign(err, {
          code: FaderErrors.CONNECTION_FAILED,
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
      this.emit('ready');
      this.config.logger.info(`FaderController started successfully`);
    } catch (error) {
      this.config.logger.error('Startup failed:', error);
      throw error;
    }
  }

  async stop() {
    try {
      await this.reset(this.config.faderIndexes);
      await this.closeSerial();
      this.config.logger.info('FaderController stopped successfully');
    } catch (error) {
      this.config.logger.error('Shutdown error:', error);
      throw error;
    }
  }

  reset(indexes) {
    return this.moveFaders(
      new FaderMove(indexes, 0, this.config.speeds[1], 1),
      true
    );
  }

  combineMoves(moves) {
    const validMoves = moves.filter(m => m instanceof FaderMove);
    if (!validMoves.length) return null;
  
    const combined = validMoves.reduce((acc, move) => {
      acc.indexes.push(...move.indexes);
      acc.targets.push(...move.targets);
      acc.speeds.push(...move.speeds);
      // Push resolution (default to 1 if not specified)
      acc.resolutions.push(move.resolution !== undefined ? move.resolution : 1);
      return acc;
    }, { indexes: [], targets: [], speeds: [], resolutions: [] });
  
    // Use the highest resolution among all moves (or average if preferred)
    const finalResolution = Math.max(...combined.resolutions);
  
    return new FaderMove(
      combined.indexes.slice(0, 4),
      combined.targets.slice(0, 4),
      combined.speeds.slice(0, 4),
      finalResolution
    );
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
    if (this.serial?.isOpen) {
      await new Promise(resolve => this.serial.close(resolve));
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

module.exports = { FaderController, FaderMove, FaderErrors };