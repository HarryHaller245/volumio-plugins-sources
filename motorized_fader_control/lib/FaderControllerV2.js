const SerialPort = require('serialport');
const MIDIParser = require('./faderController/MIDIParser');
const EventEmitter = require('events');
const Mutex = require('async-mutex').Mutex;

// Error codes enumeration
const FaderErrors = {
  CONNECTION_FAILED: 'CONNECTION_FAILED',
  INVALID_CONFIG: 'INVALID_CONFIG',
  MOVEMENT_ERROR: 'MOVEMENT_ERROR',
  CALIBRATION_FAILED: 'CALIBRATION_FAILED',
  DEVICE_NOT_READY: 'DEVICE_NOT_READY',
  QUEUE_OVERFLOW: 'QUEUE_OVERFLOW'
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
      this.emit('configChange');
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
}

class FaderMove {
  constructor(indexes, targets, speeds) {
    this.indexes = Array.isArray(indexes) ? indexes : [indexes];
    this.targets = this.normalizeValues(targets, this.indexes.length);
    this.speeds = this.normalizeValues(speeds, this.indexes.length);
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
  }

  setupHandlers() {
    this.parser.on('data', data => {
      const message = this.parseMessage(data);
      if (this.controller.config.MIDILog) {
        this.controller.config.logger.debug(`[Fader_Controller]: MIDI RECV: ${JSON.stringify(message)}`);
      }
      this.controller.handleMIDIMessage(message);
    });
  }

  parseMessage(buffer) {
    try {
      if (!buffer || buffer.length < 3) {
        throw new Error('Invalid MIDI message length');
      }
      // THIS SEEMS LIKE A DUPLICATION OF ALREADY DONE PARSING IN THE MIDIPARSER ?
      return { 
        raw: buffer, //"Buffer","data":[224,1,110,119]}
        type: this.parser.translateStatusByte(buffer[0]),
        channel: this.parser.getChannel(buffer),
        data1: buffer[2],
        data2: buffer[3],
        timestamp: Date.now() //does this eat performance
      };
    } catch (error) {
      this.controller.emit('error', Object.assign(error, {
        code: 'MIDI_PARSE_ERROR',
        rawData: buffer
      }));
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
  constructor(serial, controller, delay = 10) {
    this.serial = serial;
    this.queue = [];
    this.delay = delay;
    this.isProcessing = false;
    this.controller = controller;
  }

  add(message) {
    this.queue.push(message);
    this.process();
  }

  async process() {
    if (this.isProcessing || !this.queue.length) return;
    
    this.isProcessing = true;
    const message = this.queue.shift();
    
    try {
      await this.send(message);
    } catch (error) {
      this.controller.emit('error', Object.assign(error, {
        code: 'MIDI_SEND_ERROR',
        message: message
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
      if (this.controller.config.MIDILog) {
        this.controller.config.logger.debug(`[Fader_Controller]: MIDI SEND: ${this.formatForLog(message)}`);
      }
      this.serial.write(message, (err) => {
        if (err) {
          const wrappedError = Object.assign(err, {
            code: FaderErrors.CONNECTION_FAILED,
            message: `MIDI send failed: ${err.message}`
          });
          reject(wrappedError);
        } else {
          resolve();
        }
      });
    });
  }
}

/**
 * Emitted Events:
 * - 'touch'(index, faderInfo) - Fader touched
 * - 'untouch'(index, faderInfo) - Fader released  
 * - 'move'(index, faderInfo) - Fader position changed
 * - 'error'(Error) - Critical failure
 * - 'midi'(rawData) - Raw MIDI input
 */
class FaderController extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      logger: console,
      MIDILog: false,
      ValueLog: false,
      MoveLog: false,
      messageDelay: 10,
      speeds: [80, 50, 10],
      faderIndexes: [0, 1, 2, 3],
      ...config
    };

    this.faders = this.createFaders();
    this.midiHandler = null;
    this.midiQueue = null;
    this.queueMutex = new Mutex();
    this.serial = null;
    this.initMIDIState();
  }

  // INIT CONF AND INSTANCES #############################################

  updateConfig(newConfig) {
    Object.assign(this.config, newConfig);
    this.midiQueue.delay = this.config.messageDelay;
  }

  setFaderTrim(index, min, max) {
    this.getFader(index).setProgressionMap([min, max]);
  }

  createFaders() {
    return this.config.faderIndexes.map(index => {
      const fader = new Fader(index);
      ['touch', 'move', 'untouch', 'configChange'].forEach(evt => {
        fader.on(evt, (index, info) => {
          this.emit(evt, index, info);
          this.config.logger.debug(`[Fader_Controller]: emitting ${evt} for fader ${index}`);
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
    this.reconnectAttempts = 0;
    
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
      this.config.logger.debug(`[Fader_Controller]: MIDI HANDLE: ${message.type}`);
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

    const position = message.data1 | (message.data2 << 7);
    const fader = this.getFader(message.channel);
    
    if (fader) {
      fader.updatePosition(position);
      if (fader.echoMode) {
        this.midiQueue.add([
          message.raw[0],
          fader.mapPosition(position) & 0x7F,
          (fader.mapPosition(position) >> 7) & 0x7F
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
    if (interrupt) this.clearQueue(move.indexes);
    
    const movements = move.indexes.map((index, i) => ({
      index,
      target: this.getFader(index).mapProgression(move.targets[i]),
      speed: move.speeds[i] * this.getFader(index).speedFactor
    }));

    const positions = this.calculateMovements(movements);
    if (this.config.MoveLog) {
      this.config.logger.debug(`[Fader_Controller]: Move: ${JSON.stringify(movements)}`);
    }
    if (this.config.ValueLog) {
      this.config.logger.debug(`[Fader_Controller]: Positions: ${JSON.stringify(positions)}`);
    }
    await this.sendPositions(positions);
  }

  calculateMovements(movements) {
    const positions = [];
    const maxSteps = Math.max(...movements.map(m => 
      Math.ceil(Math.abs(m.target - this.getFader(m.index).progression) / (m.speed / 100))
    ));

    for (let step = 0; step < maxSteps; step++) {
      movements.forEach(move => {
        const fader = this.getFader(move.index);
        const progress = step / maxSteps;
        const current = fader.progression + (move.target - fader.progression) * progress;
        
        positions.push({
          index: move.index,
          value: fader.progressionToPosition(current)
        });
      });
    }

    return positions;
  }

  async sendPositions(positions) {
    const release = await this.queueMutex.acquire().catch(error => {
      this.emit('error', Object.assign(error, {
        code: 'QUEUE_LOCK_ERROR',
        positions
      }));
      throw error;
    });
    
    try {
      const messages = positions.map(pos => [
        0xE0 | pos.index,
        pos.value & 0x7F,
        (pos.value >> 7) & 0x7F
      ]);
      
      if (messages.length > 100) {
        this.emit('error', new Error('Queue overflow'), {
          code: FaderErrors.QUEUE_OVERFLOW,
          count: messages.length
        });
        messages.splice(100); // Keep only first 100 messages
      }
      
      messages.forEach(msg => this.midiQueue.add(msg));
      await this.midiQueue.process();
    } finally {
      release();
    }
  }

  // Calibration System #############################################
  //! this needs logging since it is a dev process
  async advancedCalibration(indexes) { //not sure there is a return from the mididevice if a move is sent ?
    const calibrationData = {};
    const calibrationTimeout = setTimeout(() => {
      this.emit('error', Object.assign(new Error('Calibration timeout'), {
        code: FaderErrors.CALIBRATION_FAILED,
        timeout: 30000
      }));
    }, 30000);
    const listener = (message) => {
      if (message.type === 'PITCH_BEND' && indexes.includes(message.channel)) {
        calibrationData[message.channel] = calibrationData[message.channel] || [];
        calibrationData[message.channel].push({
          position: (message.data2 << 7) | message.data1,
          time: message.timestamp
        });
      }
    };

    try {
      this.midiHandler.parser.on('data', listener);
      await this.testCalibrationMoves(indexes);
      return this.processCalibrationData(calibrationData);
    } catch (error) {
      this.emit('error', Object.assign(error, {
        code: FaderErrors.CALIBRATION_FAILED,
        indexes
      }));
      throw error;
    } finally {
      clearTimeout(calibrationTimeout);
      this.midiHandler.parser.off('data', listener);
      await this.reset(indexes);
    }
  }

  async testCalibrationMoves(indexes) {
    const moves = [
      new FaderMove(indexes, 0, 100),
      new FaderMove(indexes, 100, 1),
      new FaderMove(indexes, 0, 100)
    ];
    
    for (const move of moves) {
      await this.moveFaders(move);
      await new Promise(resolve => setTimeout(resolve, 500));
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
      
      return result;
    }, {});
  }

  //* Basic calibration #############################################
  async calibrate(indexes) {
    this.config.logger.debug('[Fader_Controller] calibrating...');
    this.testCalibrationMoves(indexes);
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
        
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  async start(calibrateOnStart = false) {
    if (!this.serial?.isOpen) {
      throw new Error('Serial port not initialized');
    }

    try {
      await this.checkMIDIDeviceReady();
      if (calibrateOnStart) await this.calibrate(this.config.faderIndexes);
      this.config.logger.info('FaderController started successfully');
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
      new FaderMove(indexes, 0, this.config.speeds[1]),
      true
    );
  }

  async calibrate_timings(indexes, speed, goal) {
    const calibrationData = await this.advancedCalibration(indexes);
    //! use speed and timegoal (ms) for a 0-100 move to calibrate movement factor
  }

  combineMoves(moves) {
    const validMoves = moves.filter(m => m instanceof FaderMove);
    if (!validMoves.length) return null;

    const combined = validMoves.reduce((acc, move) => {
      acc.indexes.push(...move.indexes);
      acc.targets.push(...move.targets);
      acc.speeds.push(...move.speeds);
      return acc;
    }, { indexes: [], targets: [], speeds: [] });

    return new FaderMove(
      combined.indexes.slice(0, 4),
      combined.targets.slice(0, 4),
      combined.speeds.slice(0, 4)
    );
  }

  setFaderProgressionMap(index, range) { //! make this accept multiple indexes optionally
    const fader = this.getFader(index);
    if (!fader) throw new Error(`Fader ${index} not found`);
    fader.setProgressionMap(range);
  }

  setFadersMovementSpeedFactor(index, speedFactor) { //! make this accept multiple indexes optionally
    const fader = this.getFader(index);
    if (!fader) throw new Error(`Fader ${index} not found`);
    if (typeof speedFactor !== 'number' || speedFactor <= 0) {
      speedFactor = 1;
    }
    fader.speedFactor = speedFactor;
  }

  // Utilities #############################################
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
    this.midiQueue.queue = this.midiQueue.queue.filter(msg => {
      const msgIndex = msg[0] & 0x0F;
      return !indexes.includes(msgIndex);
    });
  }

  async closeSerial() {
    if (this.serial?.isOpen) {
      await new Promise(resolve => this.serial.close(resolve));
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

  async checkMIDIDeviceReady(maxAttempts = 10) {
    try {
      let attempts = 0;
      while (attempts < maxAttempts && !this.midiDeviceReady) {
        if (this.midiCache.some(msg => 
          msg[3] === 102 || msg[3] === 116)
        ) {
          this.midiDeviceReady = true;
          return true;
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
        attempts++;
      }
      throw new Error('MIDI device not responding');
    } catch (error) {
      this.emit('error', Object.assign(error, {
        code: FaderErrors.DEVICE_NOT_READY,
        attempts: maxAttempts
      }));
      throw error;
    }
  }
}

module.exports = { FaderController, FaderMove, FaderErrors };