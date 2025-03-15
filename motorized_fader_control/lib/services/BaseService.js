// services/BaseService.js
class BaseService {
  constructor(faderIdx, eventBus, stateCache, config) {
    this.faderIdx = faderIdx;
    this.eventBus = eventBus;
    this.stateCache = stateCache;
    this.config = config;
    this.updateInterval = null;
    
    // Common event subscriptions
    this.eventBus.on('playback/playing', this.handlePlay.bind(this));
    this.eventBus.on('playback/paused', this.handlePause.bind(this));
    this.eventBus.on('playback/stopped', this.handleStop.bind(this));
  }

  // Common interval management
  startUpdateInterval() {
    this.stopUpdateInterval();
    this.updateInterval = setInterval(() => {
      this.updatePosition();
    }, this.config.get('FADER_REALTIME_SEEK_INTERVAL'));
  }

  stopUpdateInterval() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  // To be overridden by child classes
  calculateDynamicProgression() {}
  handlePlay(state) {}
  handlePause() {}
  handleStop() {}
  
  // Common hardware update method
  updateHardware(position) {
    const move = new FaderMove(
      this.faderIdx,
      position,
      this.config.get('FADER_CONTROLLER_SPEED_HIGH')
    );
    this.eventBus.emit('hardware/command', move);
  }
}
module.exports = BaseService;