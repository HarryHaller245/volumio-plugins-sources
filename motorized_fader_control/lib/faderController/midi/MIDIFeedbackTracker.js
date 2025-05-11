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
    this.trackedFeedback.delete(faderIndex);
  }

  clearAllFeedback() {
    this.trackedFeedback.clear();
  }

  getTargetPosition(faderIndex) {
    return this.feedbackTracking.get(faderIndex);
  }

  trackFeedbackStart(faderIndex, targetPosition) {
    try {
      if (!this.feedbackStatistics.has(faderIndex)) {
        this.feedbackStatistics.set(faderIndex, []);
      }
      this.feedbackStatistics.get(faderIndex).push({
        targetPosition,
        startTime: Date.now(),
        completed: false,
      });

      // Emit move/start event
      this.controller.getFader(faderIndex).emitMoveStepStart(targetPosition, Date.now()); //use emitMoveStepStart

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
          this.controller.config.feedback_midi = false;
          this.controller.config.logger.warn(`Disabling feedback watching due to timeout for fader ${faderIndex}`);
        }
      }, 1000); // 1-second timeout
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

        this.controller.getFader(faderIndex).emitMoveStepComplete(this.getFeedbackStatistics(faderIndex));
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
    return this.feedbackStatistics.get(faderIndex) || [];
  }

}

module.exports = MIDIFeedbackTracker;