// services/AlbumService.js
const BaseService = require('./BaseService');

class AlbumService extends BaseService {
  constructor(faderIdx, eventBus, stateCache, config, logger, logs, pluginStr) {
    super(faderIdx, eventBus, stateCache, config, logger, logs, pluginStr);
    
    // Existing album cache integration
    this.lastAlbumUri = null;
    
    this.eventBus.on('playback/update', (state) => {
      if(this.shouldUpdateHardware(state)) {
        const position = this.calculatePosition(state);
        this.updateHardware(position);
        this.logger.debug(`${this.PLUGINSTR}: ${this.logs.SERVICES.UPDATE_HARDWARE} ${this.faderIdx}`);
      }
    });
  }

  calculatePosition(state) {
    // Preserve your existing progression logic
    if(this.config.get('SEEK_TYPE') === 'album') {
      return this.calculateAlbumProgression(state);
    }
    return (state.seek / state.duration) * 100;
  }

  calculateAlbumProgression(state) {
    // Integrate your existing album progression logic
    if(this.stateCache.get('currentAlbum')?.uri !== state.uri) {
      this.fetchAlbumInfo(state);
    }
    
    // ... rest of your existing album logic
    //! realtime seek integration
  }

  handleMove(faderInfo) {
    const position = faderInfo.progression;
    this.logger.debug(`${this.PLUGINSTR}: ${this.logs.SERVICES.HANDLE_MOVE} ${this.faderIdx}`);
  }

}

module.exports = AlbumService;