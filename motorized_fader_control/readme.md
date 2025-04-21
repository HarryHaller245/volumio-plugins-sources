# Motorized Fader Control Plugin for Volumio

A Volumio plugin for integrating motorized faders to control volume and playback progression. 
This plugin enables physical faders to interact with Volumio's audio controls via MIDI over serial communication,
supporting real-time feedback and multiple seek modes.

### Basic Operations
1. **Volume Control**:
   - Touch fader → volume adjustment
   - Configurable update-on-move behavior

2. **Seek Control**:
   - Track Mode: Direct track position control IN
   - Album Mode: Full album navigation *(Under development)*
   - Queue Mode: Playback queue progression *(Planned)*
   - Playlist Mode: Playback Playlists progression *(Planned)*

### Advanced Features
- **Calibration**: Run Calibration through UI *(Partial)* **propably not needed**
- **Speed Profiles**: Configure different movement speeds for precision/rapid adjustments **propably not needed**

### TODOs & Next Steps
- **High Priority**:
  - FIX something is wrong with touch callbacks and indexing/channel parsing on recv ? 
  - Implement album/queue seek logic

- **Enhancements**:
  - Playlist support
  - Queue support
  - german translation stringss

- **Optimizations**:
  - calibration ui

## Support

**Known Issues**:
- Album seek validation false negatives
- Slow Response on Track Output Seek

**Debugging**:
```bash
journalctl -u volumio -f | grep motorized_fader_control
```

**Hardware Compatibility**:
Tested with:
- TODO: build doc
---
