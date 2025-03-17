/**
 * BaseService class provides a base implementation for fader services.
 * It includes common functionality for managing playback state and updating hardware.
 * 
 * @class BaseService
 * @param {number} faderIdx - Index of the fader this service controls.
 * @param {Object} eventBus - EventBus instance for handling events.
 * @param {Object} stateCache - StateCache instance for caching state.
 * @param {Object} config - Configuration object.
 * @param {Object} logger - Logger instance for logging service operations.
 * @param {Object} logs - Log messages object containing various log message templates.
 * @param {string} pluginStr - String representing the plugin name, used for logging.
 * 
 * @method startUpdateInterval - Starts the interval for updating the fader position.
 * @method stopUpdateInterval - Stops the interval for updating the fader position.
 * @method handleStateUpdate - To be overridden by child classes to handle state updates.
 * @method calculateDynamicProgression - To be overridden by child classes to calculate progression.
 * @method handlePlay - To be overridden by child classes to handle play state.
 * @method handlePause - To be overridden by child classes to handle pause state.
 * @method handleStop - To be overridden by child classes to handle stop state.
 * @method handleMove - To be overridden by child classes to handle fader movement.
 * @method updateHardware - Sends a command to update the hardware fader position.
 */
class BaseService {
  constructor(faderIdx, eventBus, stateCache, config, logger, logs, pluginStr) {
    this.faderIdx = faderIdx;
    this.eventBus = eventBus;
    this.stateCache = stateCache;
    this.config = config;
    this.logger = logger;
    this.logs = logs;
    this.PLUGINSTR = pluginStr;
    this.updateInterval = null;
    this.stopped = false;
    this.subscriptions = [];
    // Common event subscriptions
    this.subscriptions.push(
      this.eventBus.on('playback/playing', this.handlePlay.bind(this)),
      this.eventBus.on('playback/paused', this.handlePause.bind(this)),
      this.eventBus.on('playback/stopped', this.handleStop.bind(this))
    );
  }

  // Common interval management
  startUpdateInterval() {
    this.stopUpdateInterval();
    this.updateInterval = setInterval(() => {
      this.updatePosition();
    }, this.config.get('FADER_REALTIME_SEEK_INTERVAL'), 100);
    this.logger.debug(`${this.PLUGINSTR}: ${this.logs.LOGS.SERVICES.BASE.START_INTERVAL} ${this.faderIdx} with ${this.config.get('FADER_REALTIME_SEEK_INTERVAL')}ms interval`);
  }

  stopUpdateInterval() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
      this.logger.debug(`${this.PLUGINSTR}: ${this.logs.LOGS.SERVICES.BASE.STOP_INTERVAL} ${this.faderIdx}`);
    }
  }

  // To be overridden by child classes
  handleStateUpdate(state) {}
  calculateDynamicProgression() {}
  handlePlay(state) {}
  handlePause() {}
  handleStop() {}
  handleMove(faderInfo) {}
  updatePosition() {}
  
  // Common hardware update method
  updateHardware(progression) {
    this.logger.debug(`${this.PLUGINSTR}: ${this.logs.LOGS.SERVICES.UPDATE_HARDWARE} ${this.faderIdx} ${progression}`);
    const indexes = [this.faderIdx];
    const targets = [progression];
    const speeds = [this.config.get('FADER_SPEED_HIGH', 100)];
    this.eventBus.emit('fader/update', {indexes, targets, speeds});
  }

  stop() {
    this.stopUpdateInterval();
    this.subscriptions.forEach(unsub => unsub());
  }

  clear() {
    //dont know if needed
  }

}

module.exports = BaseService;