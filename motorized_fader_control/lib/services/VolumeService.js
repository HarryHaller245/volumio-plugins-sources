// services/VolumeService.js
const BaseService = require('./BaseService');

class VolumeService extends BaseService {
  constructor(faderIdx, eventBus, stateCache, config, logger, logs, pluginStr) {
    super(faderIdx, eventBus, stateCache, config, logger, logs, pluginStr);
    
    // Subscribe to volume updates
    this.eventBus.on('volume/update', this.handleVolumeUpdate.bind(this));
  }

  handleMove(position) {
    const volume = Math.round(position);
    this.eventBus.emit('command/volume', volume);
    this.stateCache.set('volume', 'current', volume);
    this.logger.info(`${this.PLUGINSTR}: ${this.logs.SERVICES.HANDLE_MOVE} ${this.faderIdx}`);
  }

  handleVolumeUpdate(volume) {
    if (this.stateCache.get('volume', 'current') === volume) return;
    
    this.updateHardware(volume);
    this.stateCache.set('volume', 'current', volume);
    this.logger.info(`${this.PLUGINSTR}: ${this.logs.SERVICES.HANDLE_UPDATE} ${this.faderIdx}`);
  }

  updateHardware(volume) {
    this.eventBus.emit('hardware/update', {
      fader: this.faderIdx,
      position: volume
    });
    this.logger.info(`${this.PLUGINSTR}: ${this.logs.SERVICES.UPDATE_HARDWARE} ${this.faderIdx}`);
  }
}

module.exports = VolumeService;