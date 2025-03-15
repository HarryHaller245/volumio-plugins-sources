// services/VolumeService.js
class VolumeService extends BaseService {
    constructor(...args) {
      super(...args);
      this.eventBus.on('volume/update', this.handleVolumeUpdate.bind(this));
    }
  
    handleMove(position) {
      const volume = Math.round(position);
      this.eventBus.emit('command/volume', volume);
      this.stateCache.set('lastVolume', volume);
    }
  
  }

module.exports = VolumeService;