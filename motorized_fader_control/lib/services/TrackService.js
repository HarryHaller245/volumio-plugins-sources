// services/TrackService.js
const BaseService = require('./BaseService');

class TrackService extends BaseService {
  constructor(faderIdx, eventBus, stateCache, config, logger, logs, pluginStr) {
    super(faderIdx, eventBus, stateCache, config, logger, logs, pluginStr);
    this.lastValidState = null;
  }

  handlePlay(state) {
    if (this.validateStatePlaying(state)) { 
      this.lastValidState = state;
      this.stateCache.set('playback', 'lastValid', {
        ...state,
        timestamp: Date.now()
      });
      this.startUpdateInterval();
      this.logger.info(`${this.PLUGINSTR}: ${this.logs.SERVICES.HANDLE_PLAY} ${this.faderIdx}`);
    }
  }

  validateStatePlaying(state) {
    return state.status === 'play' && 
           typeof state.seek === 'number' &&
           typeof state.duration === 'number' &&
           state.duration > 0;
  }

  calculateDynamicProgression() {
    const cachedState = this.stateCache.get('playback', 'lastValid');
    if (!cachedState) return null;

    const elapsed = Date.now() - cachedState.timestamp;
    const currentPosition = cachedState.seek + elapsed;
    const progression = (currentPosition / cachedState.duration) * 100;

    return Math.min(100, Math.max(0, progression));
  }

  updatePosition() {
    if (this.stateCache.hasActiveUserInput(this.faderIdx)) return;

    const state = this.stateCache.getPlaybackState();
    if (!state || state.status !== 'play') return;

    const progression = (state.currentPosition / state.originalDuration) * 100;
    this.updateHardware(progression);
    this.stateCache.cacheSeekProgression(this.faderIdx, progression);
    this.logger.debug(`${this.PLUGINSTR}: ${this.logs.SERVICES.UPDATE_POSITION} ${this.faderIdx}`);
  }

  handleMove(faderInfo) { //! touch/untouch logic this just updates directly as soon as move
    const position = faderInfo.progression;
    if (this.config.get('UPDATE_SEEK_ON_MOVE', false)) {
      const state = this.stateCache.get('playback', 'current');
      const seekPosition = (position / 100) * state.duration;
      this.eventBus.emit('command/seek', seekPosition);
    }
    this.stateCache.set('userInput', this.faderIdx, true, 1000); // 1s lockout
    this.logger.debug(`${this.PLUGINSTR}: ${this.logs.SERVICES.HANDLE_MOVE} ${this.faderIdx}`);
  }
}

module.exports = TrackService;