// services/VolumeService.js
const BaseService = require('./BaseService');

class VolumeService extends BaseService {
  constructor(faderIdx, eventBus, stateCache, config, logger, logs, pluginStr) {
    super(faderIdx, eventBus, stateCache, config, logger, logs, pluginStr);
    
    // Subscribe to volume updates
    this.eventBus.on('volume/update', this.handleVolumeUpdate.bind(this));
  }

  handleMove(faderInfo) {
    const progression = faderInfo.progression;
    // propably needs rounging
    const volume = Math.round(progression);
    this.eventBus.emit('command/volume', volume);
    this.stateCache.set('volume', 'current', volume);
    this.logger.debug(`${this.PLUGINSTR}: ${this.logs.LOGS.SERVICES.HANDLE_MOVE} ${this.faderIdx}`);
  }

  handleVolumeUpdate(volume) {
    //! needs unpacking, since the listener will give a dict data.volume will be the volume
    if (this.stateCache.get('volume', 'current') === volume) return; 
    const progression = volume; 
    this.updateHardware(progression);
    this.stateCache.set('volume', 'current', volume);
    this.logger.debug(`${this.PLUGINSTR}: ${this.logs.LOGS.SERVICES.HANDLE_UPDATE} ${this.faderIdx}`);
  }
  

  // in the future send any fader/update to eventbus gets aggregated there and send packaged to hardware if concurrent
}

module.exports = VolumeService;