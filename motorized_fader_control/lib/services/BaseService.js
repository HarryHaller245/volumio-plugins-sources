// services/BaseService.js
class BaseService {
    constructor(faderIdx, eventBus, stateCache) {
      this.faderIdx = faderIdx;
      this.eventBus = eventBus;
      this.stateCache = stateCache;
    }
  
    handleMove(position) {
      /* To be overridden */
    }
  
    updateHardware(position) {
      this.eventBus.emit('hardware/update', {
        fader: this.faderIdx,
        position
      });
    }
  }
  
module.exports = BaseService;