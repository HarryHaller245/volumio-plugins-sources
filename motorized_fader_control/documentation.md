# Developer Documentation: Motorized Fader Control Plugin

## Introduction

The **Motorized Fader Control Plugin** for Volumio bridges the gap between physical motorized faders and Volumio's digital audio controls. By leveraging MIDI over serial communication, the plugin allows users to control playback progression, volume, and other audio features using physical faders. 

This plugin is designed to provide real-time feedback, ensuring that the physical position of the faders reflects the current state of Volumio. It also supports advanced calibration and multiple seek modes, making it a versatile tool for audio enthusiasts and developers.

This document serves as a comprehensive guide for developers who wish to understand, maintain, or extend the plugin.

---

## Chapters

1. [Overview](#overview)
2. [Code Structure](#code-structure)
3. [Extending the Plugin](#extending-the-plugin)
4. [Debugging](#debugging)
5. [Known Issues](#known-issues)
6. [Hardware Compatibility](#hardware-compatibility)
7. [Firmware Requirements](#firmware-requirements)
8. [Additional Notes](#additional-notes)

---

## Overview

The plugin integrates motorized faders with Volumio's audio controls, enabling physical faders to control volume, playback progression, and other features via MIDI over serial communication. It supports real-time feedback, calibration, and multiple seek modes.

---

## Code Structure

### 1. **`index.js`**
   - **Purpose**: The main entry point of the plugin. It initializes the plugin, sets up configurations, and handles the core logic for fader control.
   - **Key Functions**:
     - `setupFaderController`: Initializes the `FaderController` and its dependencies.
     - `queueFaderMove`: Adds fader movement commands to a queue for processing.
     - `processFaderMoveQueue`: Processes the queued fader movements and sends commands to the hardware.
     - `setupVolumioBridge`: Establishes communication with Volumio's WebSocket API.
     - `setupServices`: Initializes service classes for handling playback and state updates.
     - `registerVolumeUpdateCallback`: Registers a callback to synchronize fader movements with Volumio's volume changes.

### 2. **`lib/faderController/`**
   - **Purpose**: Handles the core fader logic for motorized fader control, including MIDI communication, fader calibration, and movement processing.
   - **Key Components**:
     - `FaderController`: Manages fader operations, including movement, calibration, and MIDI handling.
     - `CalibrationEngine`: Provides advanced calibration functionality for faders.
     - `MIDIHandler`: Parses and processes incoming MIDI messages.
     - `MIDIQueue`: Manages the queue of MIDI messages to ensure smooth communication with the hardware.

### 3. **`lib/services/`**
   - **Purpose**: Contains service classes to handle specific playback and state-related operations.
   - **Key Services**:
     - `BaseService`: A base class providing common functionality for all services.
     - `TrackService`: Handles track-related operations, such as seeking and playback state updates.
     - `AlbumService`: Manages album-related operations, such as fetching album information.
     - `VolumeService`: Synchronizes fader movements with Volumio's volume control.

### 4. **`config.json`**
   - **Purpose**: Stores plugin configuration, including fader behaviors, MIDI settings, and calibration parameters.
   - **Key Configuration Options**:
     - `FADER_BEHAVIOR`: Defines the behavior of each fader (e.g., volume, track seek).
     - `FADER_SPEED_FACTOR`: Specifies the speed factors for fader movements.
     - `CALIBRATION_*`: Parameters for fader calibration, such as start/end progression and speed.

---

## Extending the Plugin

### Adding a New Fader Behavior
1. Update the `FADER_BEHAVIOR` configuration in `config.json` to define the new behavior.
2. Modify the `setupServices` function in `index.js` to assign the Service used for the new behavior.
3. Add any necessary logic to the `services` directory. Such as a new Service for example `PlaylistService`
4. Update `UIConfig.json` and `strings_en.json`

### Supporting Additional MIDI Messages
1. Extend the `MIDIHandler` modules in `lib/faderController/` to parse the new message type.
2. Update the `process` method in `lib/midi/MIDIQueue` to handle the new message.

### Adding a New Service
1. Create a new service class in the `lib/services/` directory by extending the `BaseService` class.
2. Implement the required methods, such as `handlePlay`, `handlePause`, and `updatePosition`.
3. Register the new service in the `setupServices` method in `index.js`.

---

## Debugging

### Viewing Logs
Run the following command to view plugin logs:
```bash
journalctl -u volumio -f | grep motorized_fader_control
or
journalctl -f | grep -e motorized_fader_control -e FaderController
```

### Common Debugging Scenarios
- **Fader Not Responding**: Check the serial connection and ensure the correct port is configured in `config.json`.
- **MIDI Messages Not Processed**: Verify that the MIDI device is properly connected and recognized by the system.
- **Calibration Issues**: Ensure the calibration parameters in `config.json` are correctly set and the hardware is functioning as expected.

---

## Known Issues

- **Album Seek Validation**: False negatives may occur during album seek validation.
- **Slow Response**: Track output seek may experience delays under certain conditions.

---

## Hardware Compatibility

The plugin has been tested with the following hardware:
- Arduino Nano running: [Harry Haller's Control Surface Motor Fader Firmware](https://github.com/HarryHaller245/Control-Surface-Motor-Fader)
- Hardware built using: [Control Theory Motor Fader Guide](https://tttapa.github.io/Pages/Arduino/Control-Theory/Motor-Fader/)
- Open Source PCB Board using Arduino Nano: [Old Version](https://github.com/tttapa/Control-Surface-Motor-Fader/discussions/20#discussioncomment-8327277)

---

## Firmware Requirements

For precise calibration and full MIDI echo support, the plugin requires the firmware provided by [Harry Haller's Control Surface Motor Fader](https://github.com/HarryHaller245/Control-Surface-Motor-Fader). This firmware ensures that the MIDI device reports back the actual physical position of the faders, enabling accurate synchronization and calibration.

### Key Features of the Firmware:
- **MIDI Echo Support**: Reports the physical position of the faders back to the plugin.
- **Real-Time Feedback**: Ensures that the fader positions are always in sync with Volumio's state.
- **Advanced Calibration**: Supports precise calibration for smooth and accurate fader movements.

---

## Additional Notes

- **Logging**: The plugin uses a extended logging system to provide detailed debug information. Logs can be configured in `config.json` using the `LOG_LEVEL` parameter.
- **Event Handling**: The plugin uses an `EventBus` to manage communication between components. Events are emitted for fader movements, playback state changes, and errors.
- **Calibration**: Advanced calibration features are available to fine-tune fader movements. Use the `RunManualCalibration` method in `index.js` to initiate calibration. For now reading the console log is the way to access those results.