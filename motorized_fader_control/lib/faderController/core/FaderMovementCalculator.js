class MovementCalculator {
  static calculateMovements(fader, target, speed, resolution, speedMultiplier) {
    const MIN_STEP = 10; // Minimum movement step
    const MAX_STEPS = 16383; // Maximum 14-bit value

    const currentPos = fader.position;
    const targetPos = fader.progressionToPosition(target);

    // If already at target or very close
    if (Math.abs(currentPos - targetPos) <= MIN_STEP) {
      return [{ index: fader.index, value: targetPos }];
    }

    // Calculate number of steps based on speed and speedMultiplier
    const steps = this.calculateSteps(currentPos, targetPos, speed, speedMultiplier, MAX_STEPS);

    // Generate intermediate positions
    const positions = this.generatePositions(currentPos, targetPos, steps, fader.index);

    // Apply resolution filter
    return this.applyResolutionFilter(positions, resolution, currentPos, targetPos);
  }

  static calculateSteps(currentPos, targetPos, speed, speedMultiplier, maxSteps) {
    const speedRatio = speed / 100; // Normalize speed to 0-1 range
    return Math.max(
      2, // Minimum 2 steps (start + end)
      Math.min(
        Math.ceil((1 - speedRatio) * speedMultiplier * 100), // Steps based on speed and multiplier
        maxSteps // Maximum steps to prevent excessive messages
      )
    );
  }

  static generatePositions(currentPos, targetPos, steps, faderIndex) {
    const stepSize = (targetPos - currentPos) / (steps - 1);
    const positions = [];

    for (let i = 1; i < steps; i++) { // Start from 1 to skip the first position
      const value = Math.round(currentPos + stepSize * i);
      positions.push({ index: faderIndex, value });
    }

    return positions;
  }

  static applyResolutionFilter(steps, resolution, startPos, endPos) {
    if (resolution >= 1 || steps.length <= 2) {
      return steps;
    }

    const keepRatio = Math.min(1, Math.max(0.01, resolution));
    const keepCount = Math.max(2, Math.ceil(steps.length * keepRatio));

    const filtered = [steps[0]]; // Always include the first position
    const stepInterval = (steps.length - 2) / (keepCount - 2);

    for (let i = 1; i < keepCount - 1; i++) {
      const index = Math.round(1 + i * stepInterval);
      filtered.push(steps[index]);
    }

    filtered.push(steps[steps.length - 1]); // Always include the last position
    return filtered;
  }
}

module.exports = MovementCalculator;