class MIDIFeedbackTracker {
  constructor(controller) {
    this.controller = controller;
    this.feedbackTracking = new Map();
    this.feedbackStatistics = new Map();
    this.softwareFeedback = false; // Software feedback only, move is considered complete as soon as sent
  }

  isTrackingFeedback(faderIndex) {
    return this.feedbackTracking.has(faderIndex);
  }

  clearFeedback(faderIndex) {
    if (this.feedbackTracking.has(faderIndex)) {
      this.controller.config.logger.debug(`Clearing feedback for fader ${faderIndex}`);
      this.feedbackTracking.delete(faderIndex);
    } else {
      this.controller.config.logger.debug(`No feedback to clear for fader ${faderIndex}`);
    }
  }

  clearAllFeedback() {
    this.trackedFeedback.clear();
  }

  getTargetPosition(faderIndex) {
    return this.feedbackTracking.get(faderIndex);
  }
  
  enableSoftwareFeedback() {
    this.softwareFeedback = true;
  }

  disableSoftwareFeedback() {
    this.softwareFeedback = false;
  }

  trackFeedbackStart(faderIndex, targetPosition) {
    if (!this.feedbackStatistics.has(faderIndex)) {
      this.feedbackStatistics.set(faderIndex, []);
    }

    this.feedbackStatistics.get(faderIndex).push({
      targetPosition,
      startTime: Date.now(),
      completed: false,
      started: false // New flag to track if the movement has started
    });

    this.feedbackTracking.set(faderIndex, { targetPosition });
  }

  handleFeedbackMessage(faderIndex, currentPosition) {
    if (this.feedbackTracking.has(faderIndex)) {
      const { targetPosition } = this.feedbackTracking.get(faderIndex);
      const stats = this.feedbackStatistics.get(faderIndex).find(stat => stat.targetPosition === targetPosition && !stat.completed);

      if (stats && !stats.started) {
        stats.started = true;
        stats.startTime = Date.now();
        this.controller.getFader(faderIndex).emitMoveStepStart(targetPosition, stats.startTime);
      }

      if (Math.abs(currentPosition - targetPosition) <= this.controller.config.feedback_tolerance) {
        this.markMovementComplete(faderIndex);
      }
    }
  }

  markMovementComplete(faderIndex) {
    if (this.softwareFeedback) {
      const fader = this.controller.getFader(faderIndex);
      fader.updatePositionFeedback(fader.position);
      fader.emitMoveStepComplete(this.getFeedbackStatistics(faderIndex));
      fader.emitMoveComplete(this.getFeedbackStatistics(faderIndex));
  
      // Log statistics if MoveLog is enabled
      if (this.controller.config.MoveLog) {
        this.logMoveStatistics(faderIndex);
      }
      return;
    }
  
    if (this.feedbackTracking.has(faderIndex)) {
      const { targetPosition } = this.feedbackTracking.get(faderIndex);
      this.feedbackTracking.delete(faderIndex);
  
      const stats = this.feedbackStatistics.get(faderIndex).find(stat => stat.targetPosition === targetPosition && !stat.completed);
      if (stats) {
        stats.completed = true;
        stats.endTime = Date.now();
        stats.duration = stats.endTime - stats.startTime;
      }
  
      const fader = this.controller.getFader(faderIndex);
      fader.emitMoveStepComplete(this.getFeedbackStatistics(faderIndex));
      fader.emitMoveComplete(this.getFeedbackStatistics(faderIndex));
  
      // Log statistics if MoveLog is enabled
      if (this.controller.config.MoveLog) {
        this.logMoveStatistics(faderIndex);
      }
    }
  }

  handleMoveStart(faderIndex, targetPosition) {
    const fader = this.controller.getFader(faderIndex);
    fader.emitMoveStart(targetPosition, Date.now());
  }

  handleMoveStep(faderIndex, position, isLastStep = false) {
    const fader = this.controller.getFader(faderIndex);

    // Emit 'move/step/start'
    fader.emitMoveStepStart(position, Date.now());

    // Emit 'move/step/complete'
    fader.emitMoveStepComplete(this.getFeedbackStatistics(faderIndex));

    // Emit 'move/complete' if this is the last step
    if (isLastStep) {
      fader.emitMoveComplete(this.getFeedbackStatistics(faderIndex));
    }
  }

  getFeedbackStatistics(faderIndex) {
    return this.feedbackStatistics.get(faderIndex) || [];
  }

  logMoveStatistics(faderIndex) {
    const stats = this.getFeedbackStatistics(faderIndex);
    if (stats && stats.length > 0) {
      const lastStat = stats[stats.length - 1]; // Get the most recent statistics
      this.controller.config.logger.debug('========== MOVE STATISTICS ==========');
      this.controller.config.logger.debug(`Fader Index: ${faderIndex}`);
      this.controller.config.logger.debug(`Target Position: ${lastStat.targetPosition}`);
      this.controller.config.logger.debug(`Start Time: ${new Date(lastStat.startTime).toISOString()}`);
      this.controller.config.logger.debug(`End Time: ${new Date(lastStat.endTime).toISOString()}`);
      this.controller.config.logger.debug(`Duration: ${lastStat.duration} ms`);
      this.controller.config.logger.debug(`Tracking Type: ${this.softwareFeedback ? 'Software' : 'Hardware'}`);
      this.controller.config.logger.debug('=====================================');
    } else {
      this.controller.config.logger.debug(`No statistics available for fader ${faderIndex}`);
    }
  }

}

module.exports = MIDIFeedbackTracker;