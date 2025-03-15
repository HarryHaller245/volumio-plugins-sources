// lib/EventBus.js
class EventBus {
    constructor() {
      this.listeners = {};
    }
  
    on(event, callback) {
      if (!this.listeners[event]) this.listeners[event] = [];
      this.listeners[event].push(callback);
    }
  
    emit(event, data) {
      (this.listeners[event] || []).forEach(cb => cb(data));
    }

    emitPlaybackState(state) {
      this.emit('playback/update', state);
      switch(state.status) {
        case 'play': 
          this.emit('playback/playing', state);
          break;
        case 'pause':
          this.emit('playback/paused');
          break;
        case 'stop':
          this.emit('playback/stopped');
          break;
      }
    }
  }

module.exports = EventBus;