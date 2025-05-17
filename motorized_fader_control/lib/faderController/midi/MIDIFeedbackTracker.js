class MIDIFeedbackTracker {
  constructor(controller) {
    this.controller = controller;
    this.feedbackTracking = new Map(); // Track feedback for each fader
    this.feedbackStatistics = new Map(); // Track statistics for each fader
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

  trackFeedbackStart(faderIndex, targetPosition) {
    try {
      // Initialize statistics for the fader if not already present
      if (!this.feedbackStatistics.has(faderIndex)) {
        this.feedbackStatistics.set(faderIndex, []);
      }
      this.feedbackStatistics.get(faderIndex).push({
        targetPosition,
        startTime: Date.now(),
        completed: false,
      });
  
      // Track feedback for the fader
      this.feedbackTracking.set(faderIndex, { targetPosition });
  
      this.controller.config.logger.debug(`Starting feedbackTracker for fader ${faderIndex}`);
      this.controller.getFader(faderIndex).emitMoveStart(targetPosition, Date.now());
  
      // Set a timeout for the first feedback message
      setTimeout(() => {
        if (this.feedbackTracking.has(faderIndex)) {
          this.controller.emit('error', {
            code: 'MIDI_FEEDBACK_ERROR',
            message: `Feedback timeout for fader ${faderIndex}`,
            faderIndex,
            targetPosition
          });
  
          // Disable feedback watching and continue
          this.markMovementComplete(faderIndex);
          this.controller.config.feedback_midi = true;
          this.controller.config.logger.warn(`Disabling feedback watching due to timeout for fader ${faderIndex}`);
        }
      }, 5000); 
    } catch (error) {
      this.controller.emit('error', {
        ...error,
        code: 'MIDI_FEEDBACK_TRACK_ERROR',
        message: `Failed to track feedback for fader ${faderIndex}`,
        details: { faderIndex, targetPosition }
      });
    }
  }

  markMovementComplete(faderIndex) {
    try {
      if (this.feedbackTracking.has(faderIndex)) {
        const { targetPosition } = this.feedbackTracking.get(faderIndex);
        this.feedbackTracking.delete(faderIndex);

        // Update statistics
        const stats = this.feedbackStatistics.get(faderIndex);
        if (stats) {
          const currentStat = stats.find(stat => stat.targetPosition === targetPosition && !stat.completed);
          if (currentStat) {
            currentStat.completed = true;
            currentStat.endTime = Date.now();
            currentStat.duration = currentStat.endTime - currentStat.startTime;
            currentStat.unitsPerSecond = Math.abs(targetPosition - this.controller.getFader(faderIndex).position) / (currentStat.duration / 1000);
          }
        }
        this.controller.getFader(faderIndex).emitMoveComplete(this.getFeedbackStatistics(faderIndex));
      }
    } catch (error) {
      this.controller.emit('error', {
        ...error,
        code: 'MIDI_MARK_COMPLETE_ERROR',
        message: `Failed to mark movement complete for fader ${faderIndex}`,
        details: { faderIndex }
      });
    }
  }

  getFeedbackStatistics(faderIndex) {
    return this.feedbackStatistics.get(faderIndex) || [false];
  }

}

module.exports = MIDIFeedbackTracker;