// services/VolumeService.js
class VolumeService extends BaseService {
  constructor(faderIdx, eventBus, stateCache, config) {
      super(faderIdx, eventBus, stateCache, config);
      
      // Subscribe to volume updates
      this.eventBus.on('volume/update', this.handleVolumeUpdate.bind(this));
  }

  handleMove(position) {
      const volume = Math.round(position);
      this.eventBus.emit('command/volume', volume);
      this.stateCache.set('volume', 'current', volume);
  }

  handleVolumeUpdate(volume) {
      if (this.stateCache.get('volume', 'current') === volume) return;
      
      this.updateHardware(volume);
      this.stateCache.set('volume', 'current', volume);
  }

  updateHardware(volume) {
      this.eventBus.emit('hardware/update', {
          fader: this.faderIdx,
          position: volume
      });
  }
}