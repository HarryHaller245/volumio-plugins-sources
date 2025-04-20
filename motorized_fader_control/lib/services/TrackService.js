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
      // this.updatePosition(); //send a direct update avoiding the interval
      this.startUpdateInterval();
      this.logger.info(`${this.logs.LOGS.SERVICES.HANDLE_PLAY} ${this.faderIdx}`);
    }
  }

  validateStatePlaying(state) {
    return state.status === 'play' && 
           typeof state.seek === 'number' &&
           typeof state.duration === 'number' &&
           state.duration > 0;
  }

  updatePosition() {
    try {
      // maybe if (this.stateCache.hasActiveUserInput(this.faderIdx)) return;
      if (this.DebugMode) {
        this.logger.debug(`${this.logs.LOGS.SERVICES.UPDATE_POSITION} ${this.faderIdx}`);
      }
      const state = this.stateCache.getPlaybackState();
      if (!state || state.status !== 'play') return; // probably redundant

      const progression = (state.currentPosition / state.originalDuration) * 100;
      this.updateHardware(progression);
      // this.stateCache.cacheSeekProgression(this.faderIdx, progression); // seems unnecessary
    } catch (error) {
      this.logger.error(`${this.logs.LOGS.SERVICES.UPDATE_POSITION_ERROR} ${this.faderIdx} - ${error.message}`);
      this.eventBus.emit('error', error);
    }
  }

  handleMove(data) {
    const faderInfo = data.faderInfo;
    const position = faderInfo.progression;
    let seekPosition = null
    if (this.config.get('UPDATE_SEEK_ON_MOVE', false)) {
      const state = this.stateCache.get('playback', 'current');
      seekPosition = (position / 100) * state.duration;
      this.eventBus.emit('command/seek', seekPosition);
      this.logger.debug(`${this.logs.LOGS.SERVICES.HANDLE_SEEK} ${this.faderIdx} -> seek: ${seekPosition}`);
    } else {
       //propably not needed we just use the event for move/end
      return
    }

    this.stateCache.cacheSeekProgression(this.faderIdx, position); // seems unnecessary
  }

  handleMoved(data) {
    const faderInfo = data.faderInfo;
    const state = this.stateCache.get('playback', 'current');
    const seekPosition = (faderInfo.progression / 100) * state.duration;
    this.eventBus.emit('command/seek', seekPosition);
    // this.stateCache.clear('fader', `fader_${faderInfo.index}`);
    if (this.DebugMode) {
      this.logger.debug(`${this.logs.LOGS.SERVICES.HANDLE_SEEK} ${this.faderIdx} -> seek: ${seekPosition}`);
    }
  }
}

module.exports = TrackService;