// services/TrackService.js
class TrackService extends BaseService {
  constructor(...args) {
    super(...args);
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
  }


  handleMove(position) {
    if (this.config.get('UPDATE_SEEK_ON_MOVE')) {
      const state = this.stateCache.get('playback', 'current');
      const seekPosition = (position / 100) * state.duration;
      this.eventBus.emit('command/seek', seekPosition);
    }
    this.stateCache.set('userInput', this.faderIdx, true, 1000); // 1s lockout
  }
}

module.exports = TrackService;