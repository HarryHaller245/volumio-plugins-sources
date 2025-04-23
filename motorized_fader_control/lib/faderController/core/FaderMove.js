class FaderMove {
  constructor(indexes, targets, speeds, resolution = 1) {
    this.indexes = Array.isArray(indexes) ? indexes : [indexes];
    this.targets = this.normalizeValues(targets, this.indexes.length);
    this.speeds = this.normalizeValues(speeds, this.indexes.length);
    this.resolution = resolution;
  }

  normalizeValues(values, length) {
    return Array.isArray(values) 
      ? values.slice(0, length)
      : Array(length).fill(values);
  }

  combineMoves(moves) {
    const validMoves = moves.filter(m => m instanceof FaderMove);
    if (!validMoves.length) return null;
  
    const combined = validMoves.reduce((acc, move) => {
      acc.indexes.push(...move.indexes);
      acc.targets.push(...move.targets);
      acc.speeds.push(...move.speeds);
      // Push resolution (default to 1 if not specified)
      acc.resolutions.push(move.resolution !== undefined ? move.resolution : 1);
      return acc;
    }, { indexes: [], targets: [], speeds: [], resolutions: [] });
  
    // Use the highest resolution among all moves (or average if preferred)
    const finalResolution = Math.max(...combined.resolutions);
  
    return new FaderMove(
      combined.indexes.slice(0, 4),
      combined.targets.slice(0, 4),
      combined.speeds.slice(0, 4),
      finalResolution
    );
  }
}

module.exports = FaderMove;