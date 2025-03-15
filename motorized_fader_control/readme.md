# Motorized Fader Control Plugin for Volumio

A Volumio plugin for integrating motorized faders to control volume and playback progression. 
This plugin enables physical faders to interact with Volumio's audio controls via MIDI over serial communication,
supporting real-time feedback and multiple seek modes.


## Features

- **Fader Control**: 
  - Volume adjustment via dedicated faders
  - Playback progression (seek) control for tracks/albums/queues
  - Configurable touch/untouch behavior with echo mode
- **Multiple Seek Modes**:
  - *Track Seek*: Control progression within current track
  - *Album Seek*: Navigate through entire album duration *(Partially implemented)*
  - *Queue Seek*: Control progression through playback queue *(Placeholder)*
  - *Playlist Seek*: Navigate through playlists *(Placeholder)*
- **Real-Time Sync**:
  - Automatic fader position updates during playback
  - WebSocket integration with Volumio's state system
- **Hardware Integration**:
  - Serial port configuration for fader controllers
  - Customizable movement speeds and calibration routines

## Installation

1. **Prerequisites**:
   - Volumio 3.x or later
   - Compatible motorized fader hardware (e.g., MIDI fader controller)
   - USB connection for fader controller

2. **Installation**:
   ```bash
   # Clone repository into Volumio plugins directory
   git clone https://github.com/yourusername/volumio-motorized-fader-control.git \
     /volumio/app/plugins/system_controller/motorized_fader_control
   
   # Install dependencies
   npm install
   ```

3. **Enable Plugin**:
   - Through Volumio UI: *Plugins → System Controllers → Motorized Fader Control*
   - Configure serial port and fader settings in plugin configuration

## Configuration

### Essential Settings

| Section | Key | Description |
|---------|-----|-------------|
| **General** | `SERIAL_PORT` | Device path for fader controller (e.g., `/dev/ttyACM0`) |
|         | `FADERS_IDXS` | Array of active fader indexes (e.g., `[0,1]`) |
| **Fader Behavior** | `FADER_X_OUTPUT` | Fader function: `volume` or `seek` |
|                 | `FADER_X_SEEK_TYPE` | Seek mode: `track`/`album`/`queue`/`playlist` |
| **Advanced** | `FADER_REALTIME_SEEK_INTERVAL` | Update frequency for seek faders (ms) |
|             | `FADER_CONTROLLER_SPEED_HIGH` | Maximum fader movement speed |

## Usages

### Basic Operations
1. **Volume Control**:
   - Touch fader → volume adjustment
   - Configurable update-on-move behavior

2. **Seek Control**:
   - Track Mode: Direct track position control
   - Album Mode: Full album navigation *(Under development)*
   - Queue Mode: Playback queue progression *(Planned)*
   - Playlist Mode: Playback Playlists progression *(Planned)*

### Advanced Features
- **Calibration**: Run Calibration through UI *(Partial)* **propably not needed**
- **Speed Profiles**: Configure different movement speeds for precision/rapid adjustments **propably not needed**

## Development Notes

### Code Structure
```
index.js
├── Plugin Lifecycle
├── Fader Controller Management
├── Volumio Interaction (WebSocket/State)
├── Seek/Volume Handlers
└── Configuration UI
```

### Key Components
1. **FaderController** (`lib/FaderController.js`):
   - Manages hardware communication
   - Handles fader movements and calibration
   - Implements echo mode and speed control

2. **State Management**:
   - `pushState` WebSocket handler for real-time updates
   - Cached state comparison for efficient updates

3. **Seek Handlers**:
   - Track: `getTrackProgression()`
   - Album: `getAlbumProgression()` *(Partial)*
   - Queue: `getQueueProgression()` *(Stub)*

### TODOs & Next Steps
- **High Priority**:
  - handle serial pport is already closed
  - Plugin crashes to unresponse when no fadder is configured and saved, warning message works, but we gett an error during stop UnhandledPromiseRejectionWarning
  - Test Fader Trim Settings
  - Implement album/queue seek logic
  - Improve seek position accuracy
  - restructure UI

- **Enhancements**:
  - Playlist support
  - Queue support
  - german translation stringss

- **Optimizations**:
  - Refactor With one State Listener and Subscription structure ?
  - Just reduce nesting

## Support

**Known Issues**:
- Intermittent WebSocket disconnects
- Album seek validation false negatives
- Volume jitter during rapid changes
- Slow Response on Track Output Seek

**Debugging**:
```bash
journalctl -u volumio -f | grep motorized_fader_control
```

**Hardware Compatibility**:
Tested with:
- build doc
---
