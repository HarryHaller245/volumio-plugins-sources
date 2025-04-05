# Developer Documentation: Motorized Fader Control Plugin

## Overview

This document provides an in-depth explanation of the code structure, key components, and functionality of the **Motorized Fader Control Plugin** for Volumio. It is intended for developers who want to understand, maintain, or extend the plugin.

---

## Code Structure

The plugin is organized into the following key files and directories:

### 1. **`index.js`**
   - **Purpose**: The main entry point of the plugin. It initializes the plugin, sets up configurations, and handles the core logic for fader control.
   - **Key Functions**:
     - `setupFaderController`: Initializes the `FaderController` and its dependencies.
     - `queueFaderMove`: Adds fader movement commands to a queue for processing.
     - `processFaderMoveQueue`: Processes the queued fader movements and sends commands to the hardware.
     - `setupStateValidation`: Middleware to validate Volumio's playback state and avoid unnecessary updates.

   - **Core Logic**:
     - Handles fader movement aggregation and prioritization.
     - Interfaces with the `FaderController` for hardware communication.
     - Manages plugin lifecycle events (e.g., startup, shutdown).

---

### 2. **`lib/FaderControllerV2.js`**
   - **Purpose**: Implements the `FaderController` class, which manages the motorized faders and their interactions with the hardware.
   - **Key Classes**:
     - `Fader`: Represents an individual fader, including its position, progression, and touch state.
     - `FaderMove`: Encapsulates movement commands for one or more faders.
     - `MIDIHandler`: Handles MIDI message parsing and communication.
     - `MIDIQueue`: Manages a queue of MIDI messages for serial communication.

   - **Core Methods**:
     - `setProgressionMap`: Configures the mapping of fader progression to physical positions.
     - `updatePosition`: Updates the fader's position and emits events for movement.
     - `progressionToPosition`: Converts progression percentages to hardware positions.
     - `setupSerial`: Initializes the serial port for communication with the fader hardware.

---

### 3. **`lib/services/`**
   - **Purpose**: Contains service classes for interacting with Volumio's playback state and other subsystems.
   - **Key Services**:
     - `BaseService`: A base class for shared functionality across services.
     - `VolumeService`: Handles volume-related operations.
     - `TrackService`: Manages track-related operations.
     - `AlbumService`: Provides album-level operations.

---

### 4. **`lib/EventBus.js`**
   - **Purpose**: Implements an event bus for inter-component communication.
   - **Key Features**:
     - Allows components to subscribe to and emit events.
     - Used for decoupling logic between the fader controller and Volumio state updates.

---

### 5. **`lib/StateCache.js`**
   - **Purpose**: Caches Volumio's playback state to reduce redundant updates.
   - **Key Features**:
     - Tracks the current playback state.
     - Provides middleware for validating state changes.

---

### 6. **`config.json`**
   - **Purpose**: Defines the plugin's configuration options.
   - **Key Settings**:
     - `SERIAL_PORT`: Specifies the serial port for the fader hardware.
     - `BAUD_RATE`: Configures the baud rate for serial communication.
     - `FADER_CONTROLLER_SPEED_HIGH`, `MEDIUM`, `LOW`: Defines movement speeds for the faders.
     - `FADER_BEHAVIOR`: Maps fader indexes to specific behaviors (e.g., volume, seek).

---

## Key Concepts

### 1. **Fader Movement Aggregation**
   - The `processFaderMoveQueue` function aggregates fader movement commands to prioritize the latest commands and avoid redundant updates.
   - Uses a `Map` to store the latest move for each fader.

### 2. **MIDI Communication**
   - The `MIDIHandler` class parses incoming MIDI messages and translates them into fader commands.
   - The `MIDIQueue` ensures that MIDI messages are sent to the hardware in a controlled manner, avoiding overflows.

### 3. **Touch and Untouch Events**
   - The `Fader` class tracks the touch state of each fader.
   - Emits `touch` and `untouch` events when the state changes, allowing for real-time feedback.

### 4. **Calibration**
   - The plugin supports automatic calibration of faders during startup.
   - Calibration ensures that fader positions are mapped accurately to progression percentages.

---

## Plugin Lifecycle

1. **Startup**:
   - The `index.js` file initializes the plugin and sets up the `FaderController`.
   - Serial communication is established with the hardware.

2. **Runtime**:
   - Fader movements are queued and processed in real-time.
   - Playback state changes are validated and synchronized with the faders.

3. **Shutdown**:
   - Serial communication is closed.
   - All active timers and event listeners are cleared.

---

## Extending the Plugin

### Adding a New Fader Behavior
1. Update the `FADER_BEHAVIOR` configuration in `config.json` to define the new behavior.
2. Modify the `processFaderMoveQueue` function in `index.js` to handle the new behavior.
3. Add any necessary logic to the `FaderController` or `services` directory.

### Supporting Additional MIDI Messages
1. Extend the `MIDIHandler` class in `lib/FaderControllerV2.js` to parse the new message type.
2. Update the `process` method in `MIDIQueue` to handle the new message.

---

## Debugging

### Viewing Logs
Run the following command to view plugin logs:
```bash
journalctl -u volumio -f | grep motorized_fader_control