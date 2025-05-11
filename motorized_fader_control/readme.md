# Motorized Fader Control Plugin for Volumio

A Volumio plugin for integrating motorized faders to control volume and playback progression. 
This plugin enables physical faders to interact with Volumio's audio controls via MIDI over serial communication,
supporting real-time feedback and multiple seek modes.

# write documentation

### TODOs & Next Steps
-**VERSION UPDATE PROCESS**:
  - Update documentation.md
  - Update readme.md
  - Update Version in package.json
  - Update logs & strings
  - Update logs & strings translations
  - Push Update

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
