// services/AlbumService.js
const BaseService = require('./BaseService');

class AlbumService extends BaseService {
  constructor(faderIdx, eventBus, stateCache, config, logger, logs, pluginStr) {
    super(faderIdx, eventBus, stateCache, config, logger, logs, pluginStr);
    
    this.lastAlbumUri = null;
    this.eventBus.on('album/info', stateWithAlbumInfo => {
      this.handleAlbumInfo(stateWithAlbumInfo);
    });
  }

  async handlePlay(state) {
    if (!this.validateStatePlaying(state)) return;
    
    this.lastValidState = state;
    this.stateCache.set('playback', 'lastValid', {
      ...state,
      timestamp: Date.now()
    });

    const currentAlbum = this.stateCache.get('album', 'current');
    if (this.validateAlbumCurrent(state, currentAlbum)) {
      this.logger.debug(`${this.logs.LOGS.SERVICES.ALBUM_INFO} ${this.faderIdx} -> albumInfo: ${JSON.stringify(currentAlbum)}`);
      this.startUpdateInterval();
    } else {
      this.orderAlbumInfo(state);
      this.logger.info(`${this.logs.LOGS.SERVICES.HANDLE_PLAY} ${this.faderIdx}`);
    }
  }

  validateStatePlaying(state) {
    return state?.status === 'play' && 
           Number.isFinite(state?.seek) &&
           Number.isFinite(state?.duration) &&
           state.duration > 0;
  }

  validateAlbumCurrent(state, albumInfo) {
    return !!albumInfo?.songUriSet?.has(state.uri) &&
           Array.isArray(albumInfo.songs) &&
           albumInfo.songs.length > 0;
  }

  orderAlbumInfo(state) {
    if (!state?.uri || this.lastAlbumUri === state.uri) return;
    
    this.lastAlbumUri = state.uri;
    this.eventBus.emit('command/volumio/getAlbumInfo', state);
    this.logger.debug(`${this.logs.LOGS.SERVICES.FETCH_ALBUM_INFO} ${this.faderIdx} -> uri: ${state.uri}`);
  }

  handleAlbumInfo(stateWithAlbumInfo) {
    if (!stateWithAlbumInfo?.albumInfo?.songs) return;

    const albumInfo = stateWithAlbumInfo.albumInfo;
    albumInfo.songUriSet = new Set(albumInfo.songs.map(song => song.uri));
    
    this.stateCache.set('album', 'current', {
      ...albumInfo,
      timestamp: Date.now()
    });

    this.logger.debug(`${this.logs.LOGS.SERVICES.ALBUM_INFO} ${this.faderIdx} -> albumInfo: ${JSON.stringify(albumInfo)}`);
    
    // Only trigger handlePlay if we have valid state
    if (stateWithAlbumInfo.state) {
      this.handlePlay(stateWithAlbumInfo.state);
    }
  }

  calculatePosition(state, currentAlbum) {
    if (!state || !currentAlbum?.songs) return 0;

    const trackIndex = currentAlbum.songs.findIndex(song => song.uri === state.uri);
    if (trackIndex === -1) {
      this.logger.warn(`Track not found in album`);
      return 0;
    }

    // Pre-compute durations in ms once
    const songsWithDurationMs = currentAlbum.songs.map(song => ({
      ...song,
      durationMs: song.duration * 1000
    }));

    const previousTracksDuration = songsWithDurationMs
      .slice(0, trackIndex)
      .reduce((acc, song) => acc + song.durationMs, 0);

    const currentPosition = previousTracksDuration + (state.seek || 0);
    const totalAlbumDuration = songsWithDurationMs.reduce((acc, song) => acc + song.durationMs, 0);

    if (totalAlbumDuration <= 0) return 0;

    const progression = (currentPosition / totalAlbumDuration) * 100;

    if (this.config.get("DEBUG_MODE", false)) {
      this.logger.debug(`Album progression: ${progression}%`);
    }

    return Math.min(100, Math.max(0, progression)); // Clamp between 0-100
  }

  updatePosition() {
    try {
      const state = this.stateCache.get('playback', 'current');
      const currentAlbum = this.stateCache.get('album', 'current');

      if (!state || state.status !== 'play' || !this.validateAlbumCurrent(state, currentAlbum)) {
        return;
      }

      const progression = this.calculatePosition(state, currentAlbum);
      this.updateHardware(progression);

    } catch (error) {
      this.logger.error(`Position update failed - ${error.message}`);
      this.eventBus.emit('error', error);
    }
  }

  handleMove(data) {
    if (!this.config.get('UPDATE_SEEK_ON_MOVE', false)) return;

    const state = this.stateCache.get('playback', 'current');
    if (!state || !state.duration || state.duration <= 0) return;

    const progression = Math.min(100, Math.max(0, data.faderInfo.progression));
    const seekPosition = (progression / 100) * state.duration;

    this.eventBus.emit('command/seek', seekPosition);
    this.stateCache.set('fader', `fader_${this.faderIdx}`, { progression });
  }

  handleMoved(data) {
    this.handleMove(data); // Reuse the same logic
  }
}

module.exports = AlbumService;