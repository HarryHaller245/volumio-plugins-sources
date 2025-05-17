const EventEmitter = require('events');
const FaderEventEmitter = require('../events/FaderEventEmitter'); // Use the new FaderEventEmitter module

class Fader extends FaderEventEmitter {
  constructor(index, config) {
    super(config.logger);
    
    this.index = index;
    this.position = 0;
    this.progression = 0;
    this.touch = false;
    this.echoMode = false;
    this.progressionMap = [0, 100];
    this.speedFactor = 1;

    this.excludeFromLogging(['internal:move/step/start', 'internal:move/step/complete']);

  }

  setProgressionMap([min, max]) {
    try {
      if (min >= max || min < 0 || max > 100) {
        throw new Error('Invalid progression map range');
      }
      this.progressionMap = [min, max];
      this.emit('configChange', this.index, {
        progressionMap: this.progressionMap
      });
    } catch (error) {
      this.emit('error', Object.assign(error, {
        code: 'INVALID_CONFIG',
        details: { index: this.index, min, max }
      }));
    }
  }

  mapProgression(externalProg) {
    const [min, max] = this.progressionMap;
    return ((externalProg - min) / (max - min)) * 100;
  }

  mapPosition(position) {
    const minPos = this.progressionToPosition(this.progressionMap[0]);
    const maxPos = this.progressionToPosition(this.progressionMap[1]);
    return Math.round(minPos + (position / 16383) * (maxPos - minPos));
  }

  updateTouchState(touch) {
    if (this.touch !== touch) {
      this.touch = touch;
      this.emit(touch ? 'internal:touch' : 'internal:untouch', this.index, this.info);
    }
  }

  updatePositionUser(position) {
    this.position = position;
    this.progression = (position / 16383) * 100;
    if (this.touch) {
      this.emit('internal:move', this.index, this.info);
    }
  }

  updatePositionFeedback(position) {
    this.position = position;
    this.progression = (position / 16383) * 100;
  }

  emitMoveComplete(statistics) {
    this.info.statistics = statistics;
    this.emit('internal:move/complete', this.index, this.info); // Internal event
  }
  
  emitMoveStart(targetPosition, startTime) {
    this.info.targetPosition = targetPosition;
    this.info.startTime = startTime;
    this.emit('internal:move/start', this.index, this.info); // Internal event
  }
  
  emitMoveStepStart(targetPosition, startTime) {
    this.info.targetPosition = targetPosition;
    this.info.startTime = startTime;
    this.emit('internal:move/step/start', this.index, this.info); // Internal event
  }
  
  emitMoveStepComplete(statistics) {
    this.info.statistics = statistics;
    this.emit('internal:move/step/complete', this.index, this.info); // Internal event
  }

  get info() {
    return {
      index: this.index,
      position: this.mapPosition(this.position),
      progression: this.mapProgression(this.progression),
      rawPosition: this.position,
      rawProgression: this.progression,
      touch: this.touch,
      echoMode: this.echoMode,
      progressionMap: [...this.progressionMap],
      speedFactor: this.speedFactor
    };
  }

  progressionToPosition(progression) {
    return Math.round((progression / 100) * 16383);
  }

  setEchoMode(echo) {
    this.echoMode = echo;
    this.emit('internal:configChange', this.index, {
      echoMode: this.echoMode
    });
    this.emit(echo ? 'internal:echo/on' : 'internal:echo/off', this.index, {
      echoMode: this.echoMode
    });
  }
}

module.exports = Fader;