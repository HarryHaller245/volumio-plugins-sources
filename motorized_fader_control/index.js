'use strict';

var libQ = require('kew');
var fs=require('fs-extra');
var config = new (require('v-conf'))();
var exec = require('child_process').exec;
var execSync = require('child_process').execSync;
var { FaderController, FaderMove } = require('./lib/FaderController');
const { setFlagsFromString } = require('v8');

const io = require('socket.io-client');
const { stat } = require('fs');
const { get } = require('http');
const { info } = require('console');

module.exports = motorizedFaderControl;

function motorizedFaderControl(context) {
	var self = this;

	this.context = context;
	this.commandRouter = this.context.coreCommand;
	this.logger = this.context.logger;
	this.configManager = this.context.configManager;
    this.config = config;

    this.faderController = null;

    //caches
    this.state = {};
    this.lastActiveStateUpdate =null; // time in ms since last Active state update
    this.cachedState = {};
    this.cachedQueue = {};
    this.cachedAlbumInfo = {};
    this.cachedSeekProgression = {};// dictionary of faderIdxs with last seek progression

    this.cachedVolume = {}; // last volumes
    this.cachedFaderVolume = {}; // dictionary of faderIdxs with last volumes

    this.cachedFaderInfo = {};

    this.cachedFaderRealtimeSeekInterval = null;

    this.isSeeking = false; // is seeking flag

};

//! TO DOs
//TODO checkStateUpdate, does not seem to work!
//TODO checkPlaying does not work ?
//TODO refactor and optimize Code, reduce nesting
//TODO START with input seek
//TODO START with input volume
//* input volume is now running, badly but running, using a listener for volume updates, and send via websocket


//TODO albumseek

//TODO queueseek
// easy

//TODO playlistseek
// defer

//TODO General
//* reevaluate callstack structure. Maybe seperate FaderHandlers and ProdgessionHandlers ?
//* simplify callstack, especially plugin start/stop/lifecycle

//TODO add translations to Toasts
//TODO toasts dont work sometimes

//TODO low prio
//TODO FaderController Module: Fix setFaderProgressionMapsTrimMap
//TODO FaderController Module: Fix echo mode 


//* PLUGIN LIFECYCLE ----------------------------------------------------

motorizedFaderControl.prototype.setupPlugin = async function() {
    var self = this;
    self.logger.debug('[motorized_fader_control]: Setting up plugin...');
    
    try {
        self.setupLogLevel();
        //! dev checking for available objects
        //self.logger.debug('CommandRouterObjects:' + Object.keys(self.commandRouter));
        //self.logger.debug('CommandRouterPluginManager:' + Object.keys(self.commandRouter.pluginManager));
        //self.logger.debug('CommandRouterStateMachineCurrentAlbum:' + (self.commandRouter.stateMachine.currentAlbum));

        // handle debug mode
        if (self.config.get("DEBUG_MODE", false)) {
            //* slow down timings
            self.cachedFaderRealtimeSeekInterval = self.config.get("FADER_REALTIME_SEEK_INTERVAL", 100);
            self.config.set("FADER_REALTIME_SEEK_INTERVAL", 5000);
        }

        // Now we set the volumio log level according to our settings
        const faderControllerSetup = await self.setupFaderController();
        if (faderControllerSetup !== null) {
            self.logger.debug('[motorized_fader_control]: FaderController setup completed successfully.');
            return libQ.resolve();
        } else {
            throw new Error('Error setting up FaderController Module');
        }
    } catch (error) {
        self.logger.error('[motorized_fader_control]: Error setting up faderController: ' + error.message);
        return libQ.reject(error);
    }
};

motorizedFaderControl.prototype.startMotorizedFaderControl = async function() {
    var self = this;
    this.logger.info('[motorized_fader_control]: -------- Starting... --------');

    try {
        // Start Plugin
        await self.setupPlugin();

        await self.startFaderController();
        
        const useWebSocket = self.config.get('VOLUMIO_USE_WEB_SOCKET');
        self.logger.info('Using WebSocket: ' + useWebSocket);
        self.setupWebSocket();

        self.registerVolumioVolumeChangeListener()

        this.logger.info('[motorized_fader_control]: -------- Started successfully. --------');
        return libQ.resolve();
    } catch (error) {
        this.logger.error('[motorized_fader_control]: Error starting plugin: ' + error);
        self.commandRouter.pushToastMessage('error', 'Error starting plugin', 'Please check plugin settings');
        return libQ.reject(error);
    }
};

motorizedFaderControl.prototype.stopMotorizedFaderControl = async function() {
    var self = this;
    self.logger.info('[motorized_fader_control]: -------- Stopping... --------');
    // Stop Plugin
    try {
        self.stopContinuousSeekUpdate();
        self.removeWebSocket();
        self.unregisterVolumioVolumeChangeListener();
        await self.stopFaderController();
        
        if (config.get("DEBUG_MODE", false)) {
            self.config.set("FADER_REALTIME_SEEK_INTERVAL",  self.cachedFaderRealtimeSeekInterval)
        }


        self.setLogLevel("verbose");
        self.logger.info('[motorized_fader_control]: -------- Stopped --------');
    } catch (error) {
        self.logger.error('[motorized_fader_control]: Error stopping plugin: ' + error);
        return libQ.reject(error);
    }
    return libQ.resolve();
};

motorizedFaderControl.prototype.restartMotorizedFaderControl = async function() {
    var self = this;
    self.logger.info('[motorized_fader_control]: Restarting...');

    try {
        await self.stopMotorizedFaderControl();
        await self.startMotorizedFaderControl();
        self.setupLogLevel();
        self.logger.info('[motorized_fader_control]: Restarted successfully.');
    } catch (error) {
        self.logger.error('[motorized_fader_control]: Error restarting plugin: ' + error);
        return libQ.reject(error);
    }

    return libQ.resolve();
};

//* FADERCONTROLLER LIFECYCLE ----------------------------------------------------

// FADER CONTROLLER SETUP

motorizedFaderControl.prototype.setupFaderController = function() {
    var self = this;
    self.logger.info('[motorized_fader_control]: Setting up FaderController...');

    try {
        // Accessing settings using getConfigParam
        const messageDelay = self.config.get('FADER_CONTROLLER_MESSAGE_DELAY', 0.001);
        const MIDILog = self.config.get('FADER_CONTROLLER_MIDI_LOG', false);
        const ValueLog = self.config.get('FADER_CONTROLLER_VALUE_LOG', false);
        const MoveLog = self.config.get('FADER_CONTROLLER_MOVE_LOG', false);
        const trimMap = JSON.parse(self.config.get('FADER_TRIM_MAP', '{}'));
        const speedHigh = self.config.get('FADER_CONTROLLER_SPEED_HIGH', 100);
        const speedMedium = self.config.get('FADER_CONTROLLER_SPEED_MEDIUM', 50);
        const speedLow = self.config.get('FADER_CONTROLLER_SPEED_LOW', 20);
        const CalibrationOnStart = self.config.get('FADER_CONTROLLER_CALIBRATION_ON_START', true);

        const faderIndexes = JSON.parse(self.config.get('FADERS_IDXS', '[]'));
        // If the faderIndexes are not set, it is probably on purpose
        if (faderIndexes === undefined || faderIndexes.length === 0) {
            self.logger.warn('[motorized_fader_control]: Fader indexes not set. Please enable a atleast one Fader. FADER_IDXS: ' + JSON.stringify(faderIndexes));
            self.commandRouter.pushToastMessage('warning', 'No fader configured!', 'Check your settings.');
            return false;
        }

        self.faderController = new FaderController(
            self.logger,
            messageDelay,
            MIDILog,
            [speedHigh, speedMedium, speedLow],
            ValueLog,
            MoveLog,
            CalibrationOnStart,
            faderIndexes
        );
        if (self.config.get('DEBUG_MODE', false)) {
            self.logFaderControllerConfig(self.config);
        }
        self.logger.info('[motorized_fader_control]: FaderController initialized successfully.');

        if (Object.keys(trimMap).length !== 0) {
            //! self.faderController.setFaderProgressionMapsTrimMap(trimMap);d
        }

        // Set the MovementSpeedFactors according to config
        const faderSpeedFactorConfig = self.config.get('FADER_SPEED_FACTOR', '[]');
        let faderSpeedFactors;
        try {
            faderSpeedFactors = JSON.parse(faderSpeedFactorConfig);
            faderSpeedFactors.forEach(factorConfig => {
                const index = Object.keys(factorConfig)[0];
                const factor = factorConfig[index];
                self.faderController.setFadersMovementSpeedFactor(index, factor);
            });
            self.logger.debug('[motorized_fader_control]: Fader speed factors set successfully.');
        } catch (error) {
            self.logger.error(`[motorized_fader_control]: Failed to parse FADER_SPEED_FACTOR config: ${error.message}`);
        }

        return true;
    } catch (error) {
        self.logger.error('[motorized_fader_control]: Error setting up FaderController: ' + error);
        return false;
    }
};

motorizedFaderControl.prototype.startFaderController = async function() {
    var self = this;
    try {

        // Access the flattened serial port and baud rate settings
        const serialPort = self.config.get("SERIAL_PORT");
        const baudRate = self.config.get("BAUD_RATE");

        // Access the calibration setting
        const calibrationOnStart = self.config.get("FADER_CONTROLLER_CALIBRATION_ON_START", true);

        // Setup the fader controller with the serial settings
        //! this can throw a serial error Error Resource temporarily unavailable Cannot lock port
        // we need to handle this, maybe retry
        await self.faderController.setupSerial(serialPort, baudRate);

        // Start the fader controller, passing the calibration setting
        await self.faderController.start(calibrationOnStart);

        self.setupFaderControllerTouchCallbacks();

    } catch (error) {
        // Log the error message and rethrow it
        self.logger.error('[motorized_fader_control]: Error starting Fader Controller: ' + error.message);
        throw error;
    }
};

motorizedFaderControl.prototype.stopFaderController = async function() {
    var self = this;
    try {
        if (!self.faderController) {
            self.logger.info('[motorized_fader_control]: Fader Controller not started, skipping stop');
            return;
        }

        // Create a promise for stopping the controller
        const stopPromise = self.faderController.stop(); // if this fails due to reset not being able to work
        
        // Create a timeout promise
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => {
                reject(new Error('[motorized_fader_control]: Fader Controller stop timed out after 10 seconds.'));
            }, 5000); // 5 seconds timeout
        });

        // Wait for either the stop or the timeout
        await Promise.race([stopPromise, timeoutPromise]);

        // Proceed to close the serial connection
        await self.faderController.closeSerial();
        self.logger.info('[motorized_fader_control]: Fader Controller stopped successfully');
    } catch (error) {
        self.logger.error('[motorized_fader_control]: Error stopping Fader Controller: ' + error.message);
        // Ensure serial connection is closed if it exists
        if (self.faderController) {
            await self.faderController.closeSerial(); // Ensure this happens even if the stop fails
            self.logger.warn('[motorized_fader_control]: An error occurred trying to stop the FaderController. Forced closing serial connection.');
        }
        throw error; // Ensure the error is propagated
    }
};

motorizedFaderControl.prototype.restartFaderController = async function() {
    var self = this;
    self.logger.info('[motorized_fader_control]: Restarting Fader Controller...');

    try {
        self.stopContinuousSeekUpdate();
        self.clearCachedFaderInfo();
        await self.stopFaderController();

        if (self.setupFaderController()) {
            await self.startFaderController();
            await self.getStateFrom('websocket');
        }
        self.setupFaderControllerTouchCallbacks();
        return libQ.resolve();
    } catch (error) {
        self.logger.error('[motorized_fader_control]: Error restarting Fader Controller: ' + error);
        await self.stopMotorizedFaderControl();
        return libQ.reject(); // Ensure the error is propagated
    }
};

//* CALLBACKS ----------------------------------------------------

motorizedFaderControl.prototype.setupFaderControllerTouchCallbacks = function() {
    var self = this;
    self.logger.debug('[motorized_fader_control]: Setting up fader controller touch callbacks...');

    try {
        // Retrieve and parse the fader behavior configuration
        const faderBehavior = JSON.parse(this.config.get('FADER_BEHAVIOR')) || [];
        const fadersIdxs = JSON.parse(this.config.get('FADERS_IDXS')) || [];

        if (!Array.isArray(faderBehavior)) {
            throw new Error('FADER_BEHAVIOR configuration is not an array');
        }

        if (!Array.isArray(fadersIdxs)) {
            throw new Error('FADERS_IDXS configuration is not an array');
        }

        // Assign callbacks to the faders depending on the configuration
        faderBehavior.forEach(fader => {
            if (!fader || typeof fader !== 'object') {
                self.logger.warn('[motorized_fader_control]: Invalid fader configuration: ' + JSON.stringify(fader));
                return;
            }

            const faderIdx = fader.FADER_IDX;

            // Check if the fader is enabled
            if (!fadersIdxs.includes(faderIdx)) {
                return;
            }

            // Use the helper method to determine the input type
            const input = self.getFaderInputType(faderIdx);

            if (input === 'seek') {
                self.setFaderCallbacks(faderIdx, 'seek');
            } else if (input === 'volume') {
                self.setFaderCallbacks(faderIdx, 'volume');
            } else {
                self.logger.warn(`[motorized_fader_control]: Unknown input type for fader ${faderIdx}: ${input}`);
            }
        });

        self.logger.debug('[motorized_fader_control]: Fader controller touch callbacks setup complete.');
    } catch (error) {
        self.logger.error('[motorized_fader_control]: Error setting up FaderController: ' + error.message);
        throw error; // Re-throw the error after logging it
    }
};

motorizedFaderControl.prototype.setFaderCallbacks = function(faderIdx, type) {
    var self = this;
    const UPDATE_VOLUME_ON_MOVE = self.config.get('UPDATE_VOLUME_ON_MOVE', false);
    const UPDATE_SEEK_ON_MOVE = self.config.get('UPDATE_SEEK_ON_MOVE', false);
    try {
        // const updateOnMove = self.
        if (type === 'seek') {
            self.faderController.setOnTouchCallbacks(faderIdx, self.OnTouchSeek(UPDATE_SEEK_ON_MOVE));
            self.faderController.setOnUntouchCallbacks(faderIdx, self.OnUntouchSeek());
        } else if (type === 'volume') {
            self.faderController.setOnTouchCallbacks(faderIdx, self.OnTouchVolume(UPDATE_VOLUME_ON_MOVE));
            self.faderController.setOnUntouchCallbacks(faderIdx, self.OnUntouchVolume());
        } else {
            self.logger.warn(`[motorized_fader_control]: Unknown callback type for fader ${faderIdx}: ${type}`);
        }
        self.logger.info(`[motorized_fader_control]: Callbacks set successfully for fader ${faderIdx} of type ${type}`);
    } catch (error) {
        self.logger.error(`[motorized_fader_control]: Error setting callbacks for fader ${faderIdx}: ${error}`);
        throw error; // Re-throw the error after logging it
    }
};

motorizedFaderControl.prototype.handleInputSeek = async function(faderIdx, state) {
    const self = this;
    const faderInfo = self.getCachedFaderInfo(faderIdx);
    const faderBehavior = JSON.parse(self.config.get('FADER_BEHAVIOR', '[]'));
    const faderConfig = faderBehavior.find(fader => fader.FADER_IDX === faderIdx);

    if (!faderConfig) {
        self.logger.warn(`[motorized_fader_control]: handleSeek: No configuration found for fader ${faderIdx}`);
        return;
    }

    const seekType = faderConfig.SEEK_TYPE.toLowerCase();

    try {

        // Delegate to the correct seek handler based on the seek type
        switch (seekType) {
            case 'track':
                self.handleSetTrackSeek(faderInfo, state);
                break;
            case 'album':
                self.handleSetAlbumSeek(faderInfo, state);
                break;
            case 'queue':
                self.handleSetQueueSeek(faderInfo, state);
                break;
            case 'playlist':
                self.handleSetPlaylistSeek(faderInfo, state);
                break;
            default:
                self.logger.warn(`[motorized_fader_control]: handleSeek: Unsupported seek type: ${seekType}`);
        }

    } catch (error) {
        self.logger.error(`[motorized_fader_control]: handleSeek: Error: ${error.message}`);
    }
};

motorizedFaderControl.prototype.OnTouchSeek = function(updateOnMove = false) {
    var self = this;
    self.touchIntervals = self.touchIntervals || {};

    return async (faderIdx) => {
        self.logger.info(`[motorized_fader_control]: OnTouchSeek: Handling touch event for fader ${faderIdx}`);
        
        self.isSeeking = true;
        self.stopContinuousSeekUpdate();

        // Clear any existing interval for this fader
        if (self.touchIntervals[faderIdx]) {
            clearInterval(self.touchIntervals[faderIdx]);
        }

        // Activate echo mode for the fader to avoid an instant jump back to the setpoint
        self.faderController.set_echoMode(faderIdx, true);

        const state = await self.getExclusiveState();
        if (!state || Object.keys(state).length === 0) {
            self.logger.warn(`[motorized_fader_control]: handleSeek: Unable to fetch state or state is empty`);
            return;
        }
        // Set an interval to continuously cache the fader info
        self.touchIntervals[faderIdx] = setInterval(async () => {
            if (self.checkFaderInfoChanged(faderIdx)) {
                self.cacheFaderInfo(faderIdx);
                self.logger.debug(`[motorized_fader_control]: OnTouchSeek: Fader info changed for fader ${faderIdx}, info cached ${JSON.stringify(self.getCachedFaderInfo(faderIdx))}`);

                if (updateOnMove) {
                    await self.handleInputSeek(faderIdx, state);
                }
            }
        }, 100); // Adjust the interval time as needed

        self.logger.debug(`[motorized_fader_control]: OnTouchSeek: Completed handling touch event for fader ${faderIdx}`);
    };
};

motorizedFaderControl.prototype.OnUntouchSeek = function() {
    var self = this;
    self.touchIntervals = self.touchIntervals || {};

    const clearTouchInterval = (faderIdx) => {
        if (self.touchIntervals[faderIdx]) {
            clearInterval(self.touchIntervals[faderIdx]);
            delete self.touchIntervals[faderIdx];
            self.logger.debug(`[motorized_fader_control]: OnUntouchSeek: Stopped caching fader info for fader ${faderIdx}`);
        }
    };

    return async (faderIdx) => {
        self.logger.info(`[motorized_fader_control]: OnUntouchSeek: Handling untouch event for fader ${faderIdx}`);
        self.faderController.set_echoMode(faderIdx, false);

        // Check if this fader untouch state has changed
        if (self.checkFaderInfoChanged(faderIdx, "touch")) {
            self.logger.debug(`[motorized_fader_control]: OnUntouchSeek: Fader untouch state changed for fader ${faderIdx}`);
            try {
                const state = await self.getExclusiveState();
                if (!state || Object.keys(state).length === 0) {
                    self.logger.warn(`[motorized_fader_control]: OnUntouchSeek: Unable to fetch state or state is empty`);
                    return;
                }
                await self.handleInputSeek(faderIdx, state);
                self.isSeeking = false;
            } catch (error) {
                self.logger.error(`[motorized_fader_control]: OnUntouchSeek: Error fetching state: ${error.message}`);
                self.isSeeking = false;
                return;
            }
        }

        clearTouchInterval(faderIdx);
        // Clear the cache for the current fader index
        self.logger.debug(`[motorized_fader_control]: OnUntouchSeek: Clearing cache for fader ${faderIdx}`);
        self.clearCachedFaderInfo(faderIdx);

        self.logger.debug(`[motorized_fader_control]: OnUntouchSeek: Completed handling untouch event for fader ${faderIdx}`);
    };
};

motorizedFaderControl.prototype.handleSetTrackSeek = function(faderInfo, state) {
    const duration = state.duration || 0;
    const seekPosition = (faderInfo.progression / 100) * duration;
    this.setSeek(seekPosition);
    this.logger.info(`[motorized_fader_control]: handleTrackSeek: Seek set to ${seekPosition} ms for track`);
};

motorizedFaderControl.prototype.handleSetAlbumSeek = function(faderInfo, state) {
    // Implement album seek logic here
    this.logger.info(`[motorized_fader_control]: handleAlbumSeek: Handling album seek for fader progression ${faderInfo.progression}`);
    this.logger.error(`[motorized_fader_control]: handleAlbumSeek: Album seek not implemented yet`);
};

motorizedFaderControl.prototype.handleSetQueueSeek = function(faderInfo, state) {
    // Implement queue seek logic here
    //! not sure this even works, since the queue will basically change when seeking
    this.logger.info(`[motorized_fader_control]: handleQueueSeek: Handling queue seek for fader progression ${faderInfo.progression}`);
    this.logger.error(`[motorized_fader_control]: handleAlbumSeek: Queue seek not implemented yet`);
};

motorizedFaderControl.prototype.handleSetPlaylistSeek = function(faderInfo, state) {
    // Implement playlist seek logic here
    this.logger.info(`[motorized_fader_control]: handlePlaylistSeek: Handling playlist seek for fader progression ${faderInfo.progression}`);
    this.logger.error(`[motorized_fader_control]: handleAlbumSeek: Playlist seek not implemented yet`);
};

/**
 * Handles the touch event for volume control.
 * 
 * @param {boolean} updateOnMove - If true, updates the volume as soon as the fader is touched and moved.
 * @returns {Function} An async function that takes a fader index and caches the fader info.
 */
motorizedFaderControl.prototype.OnTouchVolume = function(updateOnMove = false) {
    const self = this;
    self.touchIntervals = self.touchIntervals || {};

    return async (faderIdx) => {
        self.logger.info(`[motorized_fader_control]: OnTouchVolume: Handling touch event for fader ${faderIdx}`);

        // Clear any existing interval for this fader
        if (self.touchIntervals[faderIdx]) {
            clearInterval(self.touchIntervals[faderIdx]);
        }

        // Activate echo mode for the fader to avoid an instant jump back to the setpoint
        self.faderController.set_echoMode(faderIdx, true);

        // Set an interval to continuously cache the fader info
        self.touchIntervals[faderIdx] = setInterval(async () => {
            if (self.checkFaderInfoChanged(faderIdx, "progression")) {
                self.cacheFaderInfo(faderIdx);
                self.logger.debug(`[motorized_fader_control]: OnTouchVolume: Fader info changed for fader ${faderIdx}, info cached ${JSON.stringify(self.getCachedFaderInfo(faderIdx))}`);

                if (updateOnMove) {
                    const faderInfo = self.getCachedFaderInfo(faderIdx);
                    const volume = parseInt(faderInfo.progression, 10); // Convert to integer
                    self.logger.info(`[motorized_fader_control]: OnTouchVolume: Setting volume to ${volume}`);
                    self.setVolume(volume);
                    const move = new FaderMove(faderIdx, volume, 100);
                    await self.faderController.moveFaders(move, true);
                }
            }
        }, 100); // Adjust the interval time as needed

        self.logger.info(`[motorized_fader_control]: OnTouchVolume: Completed handling touch event for fader ${faderIdx}`);
    };
};

/**
 * Handles the untouch event for volume control.
 * 
 * @returns {Function} An async function that takes a fader index, checks if the touch state has changed, and clears the cache.
 */
motorizedFaderControl.prototype.OnUntouchVolume = function() {
    const self = this;
    self.touchIntervals = self.touchIntervals || {};

    const clearTouchInterval = (faderIdx) => {
        if (self.touchIntervals[faderIdx]) {
            clearInterval(self.touchIntervals[faderIdx]);
            delete self.touchIntervals[faderIdx];
            self.logger.info(`[motorized_fader_control]: OnUntouchVolume: Stopped caching fader info for fader ${faderIdx}`);
        }
    };

    return async (faderIdx) => {
        self.logger.debug(`[motorized_fader_control]: OnUntouchVolume: Handling untouch event for fader ${faderIdx}`);
        
        // Check if this fader untouch state was changed
        if (self.checkFaderInfoChanged(faderIdx, "touch")) {
            self.logger.debug(`[motorized_fader_control]: OnUntouchVolume: Fader untouch state changed for fader ${faderIdx}`);
            
            const faderInfo = self.getCachedFaderInfo(faderIdx);
            const volume = parseInt(faderInfo.progression, 10); // Convert to integer
            self.logger.info(`[motorized_fader_control]: OnUntouchVolume: Setting volume to ${volume}`);

            self.faderController.set_echoMode(faderIdx, false);
            self.setVolume(volume);
            const move = new FaderMove(faderIdx, volume, 100);
            await self.faderController.moveFaders(move, true);
        }

        clearTouchInterval(faderIdx);
        self.logger.debug(`[motorized_fader_control]: OnUntouchVolume: Clearing cache for fader ${faderIdx}`);
        self.clearCachedFaderInfo(faderIdx);

        self.logger.debug(`[motorized_fader_control]: OnUntouchVolume: Completed handling untouch event for fader ${faderIdx}`);
    };
};
//* VOLUMIO INTERACTION ----------------------------------------------------

motorizedFaderControl.prototype.setupWebSocket = function() {
    var self = this;
    self.logger.info('[motorized_fader_control]: Setting up WebSocket connection...');
    const volumioHost = this.config.get('VOLUMIO_VOLUMIO_HOST', 'localhost');
    const volumioPort = this.config.get('VOLUMIO_VOLUMIO_PORT', 3000);
    self.socket = io.connect(`http://${volumioHost}:${volumioPort}`);

    self.socket.on('connect', function() {
        self.logger.info('[motorized_fader_control]: WebSocket connected');

        self.socket.emit('getState');
    });

    // Handle Volumio state updates
    self.socket.on('pushState', function(state) {
        self.onPushState(state);  // Delegate state handling to the onPushState function
    });

    // Subscribe to other Volumio events as necessary (e.g., volume changes, playlist changes, etc.)
    self.socket.on('pushVolume', function(volume) {
        self.logger.debug('[motorized_fader_control]: Received pushVolume update');
        // ! deprecated
        // self.handleVolumeUpdate(volume);  
    });

    self.socket.on('pushQueue', function(queue) { //!
        self.logger.debug('[motorized_fader_control]: Received pushQueue update');
        // self.handlePushQueue(queue);  // Add function to handle queue updates
    });

    self.socket.on('pushBrowseLibrary', function(browseLibrary) {
        self.logger.debug('[motorized_fader_control]: Received pushBrowseLibrary update');
        //! deprecated, we are doing this on demand with a socket.once in getAlbumInfoPlaying
    });

    //* Handle WebSocket disconnection and reconnection attempts
    self.socket.on('disconnect', function() {
        self.logger.warn('[motorized_fader_control]: WebSocket disconnected');
    });

    self.socket.on('reconnect', function() {
        self.logger.info('## [motorized_fader_control]: WebSocket reconnected');
        self.socket.emit('getState');  // Request the state again upon reconnection
    });

    self.socket.on('error', function(error) {
        self.logger.error('[motorized_fader_control]: WebSocket error: ' + error.message);
    });

    self.socket.on('reconnect', function(attemptNumber) {
        self.logger.info('[motorized_fader_control]: WebSocket reconnected successfully on attempt ' + attemptNumber);
    });
};

motorizedFaderControl.prototype.removeWebSocket = function() {
    var self = this;
    if (self.socket) {
        self.socket.off();
    }
};

motorizedFaderControl.prototype.handlePushQueue = function(queue) {
    var self = this;
    self.logger.info('[motorized_fader_control]: handlePushQueue triggered');
    self.cacheQueue(queue);
    self.logger.info('[motorized_fader_control]: Handling queue update');
    //TODO Add your queue update handling logic here
    self.logger.info('[motorized_fader_control]: handlePushQueue completed');
};

motorizedFaderControl.prototype.getStateFrom = function(source = 'websocket') {
    var self = this;

    return new Promise((resolve, reject) => {
        try {
            if (source === 'websocket') {
                // Emit the request to get the state via WebSocket
                self.socket.emit('getState');

                // Set a short timeout (e.g., 500ms) to wait for the response
                const timeout = setTimeout(() => {
                    // If no response, reject the promise with an error
                    reject(new Error('Timeout waiting for state from WebSocket'));
                }, 50);

                // Listen for the state response from WebSocket
                self.socket.once('pushState', (state) => {
                    clearTimeout(timeout); // Clear the timeout
                    self.cacheState(state); // Cache the received state
                    resolve(state);    // Resolve the promise with the updated state
                });
            } else {
                resolve(self.state);
            }
        } catch (error) {
            self.logger.error('[motorized_fader_control]: Error in getStateFrom: ' + error.message);
            reject(error);
        }
    });
};

motorizedFaderControl.prototype.getExclusiveState = function() {
    const self = this;

    return new Promise((resolve, reject) => {
        let originalPushStateListeners; // Track original listeners

        try {
            // 1. Capture and remove existing listeners to isolate this request
            originalPushStateListeners = self.socket.listeners('pushState');
            self.socket.removeAllListeners('pushState');

            // 2. Set up timeout cleanup
            const timeout = setTimeout(() => {
                restoreListeners();
                reject(new Error('Timeout waiting for state from WebSocket'));
            }, 50); // Short timeout for responsiveness

            // 3. Temporary state listener
            self.socket.once('pushState', (state) => {
                clearTimeout(timeout);
                restoreListeners();
                resolve(state); // Return state without caching
            });

            // 4. Request fresh state
            self.socket.emit('getState');

        } catch (error) {
            // 5. Ensure cleanup on error
            if (originalPushStateListeners) restoreListeners();
            self.logger.error(`[motorized_fader_control]: getExclusiveState error: ${error.message}`);
            reject(error);
        }

        function restoreListeners() {
            if (originalPushStateListeners) {
                originalPushStateListeners.forEach(listener => {
                    self.socket.on('pushState', listener);
                });
            }
        }
    });
};

motorizedFaderControl.prototype.setSeek = function(seek) {
    var self = this;
    self.logger.info('[motorized_fader_control]: Setting seek to ' + seek);
    try {
        self.socket.emit('seek', seek);
    } catch (error) {
        self.logger.error('[motorized_fader_control]: Error in setSeek: ' + error.message);
        return false
    }
};

//* VOLUME CONTROL ----------------------------------------------------

motorizedFaderControl.prototype.registerVolumioVolumeChangeListener = function() { //! still not sure if this is actually better han state usage
    var self = this;

    // Unregister any existing listener to avoid duplicates
    self.unregisterVolumioVolumeChangeListener();

    // Register the new listener
    self.logger.debug('[motorized_fader_control]: Registering Volumio volume change listener');
    self.commandRouter.addCallback('volumioupdatevolume', self.volumeChangeListener.bind(self));

};

motorizedFaderControl.prototype.handleVolumeUpdate = async function(volume) {
    const self = this;
    self.logger.info('[motorized_fader_control]: handleVolumeUpdate: volume received:' + JSON.stringify(volume));

    if (volume.vol !== undefined) {
        if (volume.vol === "" || volume.vol === null) {
            self.logger.warn('[motorized_fader_control]: handleVolumeUpdate: Volume is empty');
            return;
        }
        volume = volume.vol;
    } else if (volume === "") {
        self.logger.warn('[motorized_fader_control]: handleVolumeUpdate: Volume is empty');
        return;
    }

    self.cacheVolume(volume);

    const faderBehavior = JSON.parse(self.config.get('FADER_BEHAVIOR', '[]'));
    const configuredFaders = JSON.parse(self.config.get('FADERS_IDXS', '[]'));
    const faderMoves = [];
    let combinedMove = false;

    for (let i = 0; i < configuredFaders.length; i++) {
        const fader = faderBehavior[i];
        const faderIdx = configuredFaders[i];
        const output = fader.OUTPUT.toLowerCase();

        if (self.config.get('DEBUG_MODE', false)) {
            self.logger.debug(`[motorized_fader_control]: handleVolumeUpdate: Processing fader ${faderIdx}`);
        }

        if (output === 'volume' && volume !== null && self.hasOutputVolumeChanged(faderIdx, volume)) {
            const speed = self.config.get('FADER_CONTROLLER_SPEED_HIGH', 100);
            faderMoves.push(new FaderMove(faderIdx, volume, speed));
        }
    }

    if (faderMoves.length > 0) {
        combinedMove = self.faderController.combineMoves(faderMoves);
    }

    if (combinedMove) {
        try {
            await self.faderController.moveFaders(combinedMove, true);
        } catch (error) {
            self.logger.error(`[motorized_fader_control]: Error executing fader moves: ${error.message}`);
        }
    } else {
        self.logger.debug('[motorized_fader_control]: No valid fader moves to execute');
    }

    self.logger.debug('[motorized_fader_control]: handleVolumeUpdate completed');
};

motorizedFaderControl.prototype.unregisterVolumioVolumeChangeListener = function() {
    var self = this;
    
    // Check if the listener exists
    if (!self.volumeChangeListener) {
        return; // Nothing to unregister
    }

    const callbacks = self.commandRouter.callbacks['volumioupdatevolume'];
    if (callbacks) {
        const oldCount = callbacks.length;
        self.logger.debug(`[motorized_fader_control]: Removing Volumio callbacks for 'volumioupdatevolume'. Current count: ${oldCount}`);
        
        // Filter out the listener
        self.commandRouter.callbacks['volumioupdatevolume'] = callbacks.filter((listener) => listener !== self.volumeChangeListener);
        const newCount = self.commandRouter.callbacks['volumioupdatevolume'].length;
        self.logger.debug(`[motorized_fader_control]: Removed ${oldCount - newCount} Volumio callbacks for 'volumioupdatevolume'.`);
    }
};

motorizedFaderControl.prototype.volumeChangeListener = function(volumeData) {
    var self = this;
    self.logger.debug('[motorized_fader_control]: volumeChangeListener triggered');
    // we need to unpack the data to something the handleVolumeUpdate can handle, so
    const vol = volumeData.vol
    const mute = volumeData.mute
    const disableVolumeControl = volumeData.disableVolumeControl
    self.handleVolumeUpdate(vol, mute, disableVolumeControl);
};

motorizedFaderControl.prototype.setVolume = function(volume, source = 'websocket') {
    var self = this;
    try {
        if (source == 'websocket') {
            self.socket.emit('volume', volume);
            self.cacheVolume(volume);
            return true
        } else {
            self.cacheVolume(self.commandRouter.volumiosetVolume(volume));
            return true
        };
    } catch (error) {
        self.logger.error('motorizedFaderControl: Error in setVolume Commandrouter: ' + error.message);
        return false
    }
};

//* HANDLE STATE ----------------------------------------------------

motorizedFaderControl.prototype.onPushState = function(state) {
    const self = this;
    self.logger.debug(`[motorized_fader_control]: onPushState: state received: ${JSON.stringify(state)}`);
    // Validate state integrity first
    if (!self.validateState(state)) {
        self.logger.debug('[motorized_fader_control]: State invalid, skipping');
        if (self.config.get('DEBUG_MODE', false)) {
            self.logger.debug(`[motorized_fader_control]: Invalid state: ${JSON.stringify(state)}`);
        }
        return;
    }

    // Skip processing if state hasn't meaningfully changed
    if (!self.checkStateChanged(state)) {
        self.logger.info('[motorized_fader_control]: State unchanged, skipping update');
        return;
    }
    self.logger.info(`[motorized_fader_control]: onPushState: state received`);
    self.logger.debug(`[motorized_fader_control]: onPushState: changed state received`);
    // Stop any active seek updates
    self.stopContinuousSeekUpdate();

    // Only trigger fader updates if not in seek mode
    if (!self.isSeeking) {
        self.handleFaderOnStateUpdate(state);
        if (self.checkPlayingState(state)) {
            self.cacheTimeLastActiveStateUpdate();
            self.startContinuousSeekUpdate(state);
        }
    }
};

motorizedFaderControl.prototype.startContinuousSeekUpdate = function(state) {
    var self = this;
    const interval = self.config.get("FADER_REALTIME_SEEK_INTERVAL", 500);
    // Clear any existing interval to prevent multiple intervals running
    self.stopContinuousSeekUpdate();

    // Retrieve FADER_BEHAVIOR configuration
    const configuredFaders = JSON.parse(self.config.get('FADERS_IDXS', "[0,1]"));

    self.logger.info('[motorized_fader_control]: Started Realtime Seek Update');
    // Set up an interval to continuously update the fader based on elapsed time
    self.seekUpdateInterval = setInterval(async () => {
        try {
            const elapsedTime = self.getTimeSinceLastActiveStateUpdate();
            const faderMoves = [];
s
            // Update each fader's progression based on elapsed time
            for (const faderIdx of configuredFaders) {
                try {
                    // Use the helper method to get the input type for the fader
                    const inputType = self.getFaderInputType(faderIdx);

                    // Check if fader is configured for seek
                    if (inputType.toLowerCase() !== 'seek') {
                        continue;
                    }

                    const seekType = this.getFaderSeekType(faderIdx)

                    const newProgression = await self.getRealtimeOutputSeek(state, elapsedTime, faderIdx, seekType);

                    if (newProgression !== null && self.hasCachedProgressionChanged(faderIdx, newProgression)) {
                        const speed = self.config.get('FADER_CONTROLLER_SPEED_HIGH', 100);
                        faderMoves.push(new FaderMove(faderIdx, newProgression, speed));
                    }
                } catch (error) {
                    self.logger.error(`[motorized_fader_control]: Error updating fader ${faderIdx}: ${error.message}`);
                }
            }

            // Combine the fader moves into one if there are any
            if (faderMoves.length > 0) {
                const combinedMove = self.faderController.combineMoves(faderMoves);
                await self.faderController.moveFaders(combinedMove, true);
            }

            // Stop the interval if playback has stopped 
            //! checkPlayingState gives false negatives
            if (!self.checkPlayingState(self.state)) {
                // self.logger.debug('[motorized_fader_control]: Stopping continuous seek update due to playback stop');
                // self.stopContinuousSeekUpdate(); 
            }

        } catch (error) {
            self.logger.error(`[motorized_fader_control]: Error in continuous seek update: ${error.message}`);
            self.stopContinuousSeekUpdate();
        }
    }, interval); // Update every 100ms or adjust as needed
};

//* GetRealtimeProgressions -------------------------------------------------------------------

motorizedFaderControl.prototype.getRealtimeOutputSeek = async function(state, elapsedTime, faderIdx, seekType) {
    const self = this;
    let progression = null;

    switch (seekType.toLowerCase()) {
        case 'track':
            progression = self.getRealtimeOutputSeekTrack(state, elapsedTime, faderIdx);
            break;
        case 'album':
            //! check if state is on repeatSingle:true or random:true, if yes, log warning and return the self.getTrackProgression
            //! if state is on random AND repeat:false we can still run this normally
            //! also check if the state is even registered as an album, if no fallback to self.getTrackProgression
            progression = await self.getRealtimeOutputSeekAlbum(state, elapsedTime, faderIdx);
            break;
        case 'queue':
            progression = self.getRealtimeOutputSeekQueue(state, elapsedTime, faderIdx);
            //! check if state is on repeatSingle:true or random:true, if yes, log warning and return the self.getTrackProgression
            //! if state is on random AND repeat:false we can still run this normally
            break;
        case 'playlist':
            //! check if state is on repeatSingle:true or random:true, if yes, log warning and return the self.getTrackProgression
            //! if state is on random AND repeat:false we can still run this normally
            //! also check if the state is even registered as an album, if no fallback to
            progression = self.getRealtimeOutputSeekPlaylist(state, elapsedTime, faderIdx);
            break;
        default:
            self.logger.warn(`[motorized_fader_control]: Unknown seek type "${seekType}" for fader ${faderIdx}`);
    }

    return progression;
};

motorizedFaderControl.prototype.getRealtimeOutputSeekTrack = function(state, elapsedTime, faderIdx) {
    var self = this;
    const duration = (state.duration || 0) * 1000; // Convert duration to ms
    const state_seek = state.seek || 0;

    if (duration > 0) {
        // Calculate the new progression using state.seek as the starting point
        const newProgression = Math.min(100, ((state_seek + elapsedTime) / duration) * 100);
        if (self.config.get('DEBUG_MODE', false)) {
            this.logger.debug(`[motorized_fader_control]: Calculating Realtime Progression with state_seek: ${state_seek} ms, elapsedTime: ${elapsedTime} ms, and duration: ${duration} ms`);
        }
        return newProgression;
    } else {
        self.logger.warn(`[motorized_fader_control]: Invalid duration for fader ${faderIdx}: ${duration} ms`);
        return null;
    }
};

motorizedFaderControl.prototype.getRealtimeOutputSeekAlbum = async function(state, elapsedTime, faderIdx) {
    var self = this;

    try {
        let albumInfo;
        if (!self.checkAlbumInfoValid(this.cachedAlbumInfo, state)) {
            albumInfo = await self.getAlbumInfoPlayingGoTo(state);
            self.cachedAlbumInfo = albumInfo; // Cache the new album info
            //! we need to check here if it is still invalid, if yes skip or revert to track
            //! log error

        } else {
            albumInfo = self.cachedAlbumInfo;
        }

        if (!albumInfo || !albumInfo.songs) {
            self.logger.error('[motorized_fader_control]: Album info or songs are undefined');
            return null;
        }

        const seekInAlbum = self.getSeekInAlbum(albumInfo, state); //! this is static since our state seek is not really updating
        //! this is the seekInAlbum by state, not by lastState and elapsed time. 
        //! this works, but is confusing in naming and handling
        //! this works because we use the elapsed time if used in realtime, and we use a up to datte seekInAlbum if not.
        if (seekInAlbum === null) {
            return null;
        }

        const duration = (albumInfo.duration || 0) * 1000; // Convert duration to ms
        return self.calculateAlbumProgression(seekInAlbum, duration, elapsedTime);
    } catch (error) {
        self.logger.error(`[motorized_fader_control]: Error calculating album progression: ${error.message}`);
        return null;
    }
};

motorizedFaderControl.prototype.getRealtimeOutputSeekQueue = async function(state, elapsedTime, faderIdx) {
    var self = this;
    //logic to retrieve the queue duration off the current playing track
    //propably a lot easier since we can just send a pushGetQueue and calculate its duration
    //this will also work fairly well for an album maybe
    self.logger.warn(`[motorized_fader_control]: Queue seek not implemented`);
    //the queue always contains all tracks, even played ones, so we need to subtract their duration, they are ordered i think, up until the current track, i.e.
    //just count the duration of current duration, current state seek, and the playlist duration onward
    //first lets get the queue
    self.commandRouter.pushGetQueue();

};

motorizedFaderControl.prototype.getRealtimeOutputSeekPlaylist = function(state, elapsedTime, faderIdx) {
    //logic to retrieve the playlist duration off the current playing track
    //even worse than album, since we need to find the playlist and then calculate its duration, not sure this is possible
    self.logger.warn(`[motorized_fader_control]: Playlist seek not implemented. Not planned`);
};

motorizedFaderControl.prototype.stopContinuousSeekUpdate = function() {
    var self = this;
    if (self.seekUpdateInterval) {
        self.logger.debug(`[motorized_fader_control]: Stopping ContinuousSeekUpdate`);
        // Optionally clear the interval if a critical error occurs
        clearInterval(self.seekUpdateInterval);
        self.seekUpdateInterval = null; // Reset the interval reference
        self.logger.info('[motorized_fader_control]: Stopped Realtime Seek Update');
    };
};

//* handleFaderBehaviour ----------------------------------------------------
motorizedFaderControl.prototype.handleFaderOnStateUpdate = async function(state) {
    const self = this;
    const faderBehavior = JSON.parse(self.config.get('FADER_BEHAVIOR'));
    const configuredFaders = JSON.parse(self.config.get('FADERS_IDXS', false));
    const faderMoves = [];

    for (let i = 0; i < configuredFaders.length; i++) {
        const fader = faderBehavior[i];
        const faderIdx = configuredFaders[i];
        const output = fader.OUTPUT.toLowerCase();

        if (self.config.get('DEBUG_MODE', false)) {
            self.logger.debug(`[motorized_fader_control]: handleFaderOnStateUpdate Fader: ${faderIdx} with output type ${output}`);
        }

        let progression = null;
        let volume = null;

        switch (output) {
            case 'seek':
                // Use the helper method to get the seek type for the fader
                // const seekType = self.getFaderInputType(faderIdx);
                const seekType = self.getFaderSeekType(faderIdx);
                progression = await self.getOutputSeek(state, seekType);
                break;
            case 'volume':
                volume = state.volume;
                if (self.config.get('DEBUG_MODE', false)) {
                    self.logger.debug(`[motorized_fader_control]: handleFaderOnStateUpdate Fader: ${faderIdx}: State Volume: ${volume}`);
                }
                break;
            default:
                self.logger.info(`[motorized_fader_control]: handleFaderOnStateUpdate Fader: ${faderIdx}: has no output assigned`);
                break;
        }

        if (progression && self.hasCachedProgressionChanged(faderIdx, progression)) {
            const speed = self.config.get('FADER_CONTROLLER_SPEED_HIGH');
            faderMoves.push(new FaderMove(faderIdx, progression, speed));
        } else if (volume && output === 'volume') {
            const volumeObject = {
                vol: volume,
                mute: state.mute || false,
                disableVolumeControl: state.disableVolumeControl || false
            };
            await self.handleVolumeUpdate(volumeObject);
        }
    }

    const combinedMove = self.faderController.combineMoves(faderMoves);

    if (combinedMove) {
        try {
            await self.faderController.moveFaders(combinedMove, true);
        } catch (error) {
            self.logger.error(`[motorized_fader_control]: Error executing fader moves: ${error.message}`);
        }
    } else {
        self.logger.debug('[motorized_fader_control]: No valid fader moves to execute');
    }
};

motorizedFaderControl.prototype.getOutputSeek = async function (state, seekType) {
    const self = this;
    self.logger.debug(`[motorized_fader_control]: Getting seek progression for ${seekType}`);

    switch (seekType.toLowerCase()) {
        case 'track':
            return self.getTrackProgression(state);
        case 'album':
            //! check if state is on repeatSingle:true or random:true, if yes, log warning and return the self.getTrackProgression
            this.checkPlayingStateRandom()
            this.checkPlayingStateRepeat()
            this.checkPlayingStateRepeatSingle()
            //! if state is on random AND repeat:false we can still run this normally
            //! also check if the state is even registered as an album, if no fallback to self.getTrackProgression
            return await self.getAlbumProgression(state);
        case 'queue':
            //! check if state is on repeatSingle:true or random:true, if yes, log warning and return the self.getTrackProgression
            //! if state is on random AND repeat:false we can still run this normally
            return self.getQueueProgression(state);
        case 'playlist':
            //! check if state is on repeatSingle:true, log warning and return the self.getTrackProgression
            //! if state is on random AND repeat:false we can still run this normally
            return self.getPlaylistProgression(state);
        default:
            self.logger.warn(`[motorized_fader_control]: Unknown seekType: ${seekType}`);
            return null;
    }
};

motorizedFaderControl.prototype.hasCachedProgressionChanged = function (faderIdx, newProgression) { //! ensure this works
    var self = this;
    // Ensure cachedSeekProgression is initialized
    if (!self.cachedSeekProgression) {
        self.cachedSeekProgression = {};
    }

    const cachedProgression = self.cachedSeekProgression[faderIdx] || 0;

    if (newProgression !== cachedProgression) {
        self.cachedSeekProgression[faderIdx] = newProgression;
        return true;
    }

    return false;
};

motorizedFaderControl.prototype.hasOutputVolumeChanged = function (faderIdx, newVolume) {
    var self = this;
    self.logger.debug(`[motorized_fader_control]: hasOutputVolumeChanged: Checking if output volume has changed for fader ${faderIdx}`);

    // Ensure cachedVolume is initialized
    if (!self.cachedFaderVolume) {
        self.cachedFaderVolume = {};
    }

    const cachedVolume = self.cachedFaderVolume[faderIdx] || 0;
    if (self.config.get('DEBUG_MODE', false)) {
        self.logger.debug(`[motorized_fader_control]: hasOutputVolumeChanged: Previous volume: ${cachedVolume}, New volume: ${newVolume}`);
    }

    if (newVolume !== cachedVolume) {
        self.cachedFaderVolume[faderIdx] = newVolume;
        self.logger.debug(`[motorized_fader_control]: hasOutputVolumeChanged: Output volume has changed for fader ${faderIdx}`);
        return true;
    }
    self.logger.debug(`[motorized_fader_control]: hasOutputVolumeChanged: Output volume has not changed for fader ${faderIdx}`);
    return false;
};

//* GET PROGRESSIONS ----------------------------------------------------

motorizedFaderControl.prototype.getTrackProgression = function(state) {
    const self = this;

    try {
        const seek = state.seek || 0;
        const duration = (state.duration || 0) * 1000; // Convert duration to ms

        if (self.config.get('DEBUG_MODE', false)) { 
            self.logger.debug(`[motorized_fader_control]: Calculating progression with seek: ${seek} and duration: ${duration} ms`);
        }

        if (duration === 0) {
            self.logger.warn('[motorized_fader_control]: Track duration is zero, cannot calculate progression');
            return null;
        }
        // Calculate the progression as a percentage
        const progression = (seek / duration) * 100; // This gives a float value between 0 and 100
        self.logger.debug(`[motorized_fader_control]: Track progression calculated: ${progression}%`);
        return progression;
    } catch (error) {
        self.logger.error(`[motorized_fader_control]: Error calculating track progression: ${error.message}`);
        return null;
    }
};

motorizedFaderControl.prototype.getAlbumProgression = async function (state) {
    var self = this;

    try {
        let albumInfo;
        if (!self.checkAlbumInfoValid(this.cachedAlbumInfo, state)) {
            albumInfo = await self.getAlbumInfoPlayingGoTo(state);
            self.cachedAlbumInfo = albumInfo; // Cache the new album info
            //! we need to check here if it is still invalid, if yes skip or switch to track seek
            //! and use a fallback method of retrieving the data, i.e. getAlbumInfoPlayingBrowse(state)
            //! log error
        } else {
            albumInfo = self.cachedAlbumInfo;
            if (self.config.get('DEBUG_MODE', false)) {
                self.logger.debug(`[motorized_fader_control]: Using cached album info: ${JSON.stringify(albumInfo)}`);
            }
        }

        if (!albumInfo || !albumInfo.songs) {
            self.logger.error('[motorized_fader_control]: Album info or songs are undefined');
            return null;
        }

        const seekInAlbum = self.getSeekInAlbum(albumInfo, state);
        if (seekInAlbum === null) {
            return null;
        }

        const duration = (albumInfo.duration || 0) * 1000; // Convert duration to ms
        return self.calculateAlbumProgression(seekInAlbum, duration);
    } catch (error) {
        self.logger.error(`[motorized_fader_control]: Error calculating album progression: ${error.message}`);
        return null;
    }
};

motorizedFaderControl.prototype.getQueueProgression = async function (state) {
    //TODO implement this
};

motorizedFaderControl.prototype.getPlaylistProgression = async function (state) {
    //TODO implement this
};


//* ALBUM INFO LOGIC

motorizedFaderControl.prototype.getAlbumInfoPlayingGoTo = function (state) {
    var self = this;

    return new Promise((resolve, reject) => {
        try {
            self.logger.debug('[motorized_fader_control]: Starting getAlbumInfoPlayingGoTo process.');

            let call = 'goTo';
            let args = { type: 'album' };

            // If state.service is "spop", pass data.album as "value": "data.album"
            if (state.service === "spop") {
                self.logger.debug('[motorized_fader_control]: Detected spop service, setting args.value to state.album');
                args.value = state.album;
            }

            self.logger.debug(`[motorized_fader_control]: Emitting WebSocket call: ${call} with args: ${JSON.stringify(args)}`);
            self.socket.emit(call, args);

            const timeout = setTimeout(() => {
                self.logger.error('[motorized_fader_control]: Timeout waiting for response from WebSocket: goTo');
                reject(new Error('[motorized_fader_control]: Timeout waiting for response from WebSocket: goTo'));
            }, 1000);

            // Listen for the response from WebSocket
            self.socket.once('pushBrowseLibrary', (response) => {
                clearTimeout(timeout); // Clear the timeout once response is received
                self.logger.debug('[motorized_fader_control]: Received response from WebSocket: pushBrowseLibrary');

                if (response.navigation && response.navigation.lists) {
                    self.logger.debug('[motorized_fader_control]: Valid response structure received from WebSocket');
                    // Extract album information
                    const album = response.navigation.info.album;
                    const artist = response.navigation.info.artist;
                    const service = response.navigation.info.service;
                    const uri = response.navigation.info.uri;
                    const songDurations = response.navigation.lists[0].items.map(item => item.duration);
                    const duration = songDurations.reduce((sum, duration) => sum + duration, 0);

                    // Extract songs information
                    const songs = response.navigation.lists[0].items.map(item => ({
                        title: item.title,
                        artist: item.artist,
                        duration: item.duration,
                        uri: item.uri,
                        albumart: item.albumart
                    }));

                    const albumInfo = {
                        uri,
                        album,
                        artist,
                        service,
                        duration,
                        songs
                    };
                    
                    if (self.config.get('DEBUG_MODE', false)) {
                        self.logger.debug('[motorized_fader_control]: Extracted album information: ' + JSON.stringify(albumInfo));
                    }

                    // Cache album info
                    self.cacheAlbumInfo(albumInfo);

                    resolve(albumInfo); // Resolve the promise with the album information
                } else {
                    self.logger.error('[motorized_fader_control]: Invalid response structure from WebSocket: goTo');
                    reject(new Error('[motorized_fader_control]: Invalid response structure from WebSocket: goTo'));
                }
            });
        } catch (error) {
            self.logger.error('[motorized_fader_control]: Error in getAlbumInfoPlayingGoTo: ' + error.message);
            reject(error);
        }
    });
};

motorizedFaderControl.prototype.getAlbumInfoPlayingBrowse = function (state) {
    //* fallback method if goTo fails to get the album info.
    //! refer to TestVolumioWebSocket.test.js
    var self = this;

    //! const args = // refer to test

    return new Promise((resolve, reject) => {
        try {
            self.socket.emit('browseLibrary', args);

            //! getting errors when used with spotify
            // Set a timeout to wait for the response, e.g., 1000ms
            const timeout = setTimeout(() => {
                reject(new Error('[motorized_fader_control]: Timeout waiting for response from WebSocket: goTo'));
            }, 1000);

            // Listen for the response from WebSocket
            self.socket.once('pushBrowseLibrary', (response) => {
                clearTimeout(timeout); // Clear the timeout once response is received
                if (response.navigation && response.navigation.lists) {
                    // Extract album information
                    const album = response.navigation.info.album;
                    const artist = response.navigation.info.artist;
                    const service = response.navigation.info.service;
                    const uri = response.navigation.info.uri;
                    const songDurations = response.navigation.lists[0].items.map(item => item.duration);
                    const duration = songDurations.reduce((sum, duration) => sum + duration, 0);

                    // Extract songs information
                    const songs = response.navigation.lists[0].items.map(item => ({
                        title: item.title,
                        artist: item.artist,
                        duration: item.duration,
                        uri: item.uri,
                        albumart: item.albumart
                    }));

                    const albumInfo = {
                        uri,
                        album,
                        artist,
                        service,
                        duration,
                        songs
                    };

                    // Cache album info
                    self.cacheAlbumInfo(albumInfo);

                    resolve(albumInfo); // Resolve the promise with the album information
                } else {
                    reject(new Error('[motorized_fader_control]: Invalid response structure from WebSocket: goTo'));
                }
            });
        } catch (error) {
            self.logger.error('[motorized_fader_control]: Error in getAlbumInfoPlaying: ' + error.message);
            reject(error);
        }
    });
};

motorizedFaderControl.prototype.getAlbumInfoPlayingSearch = function (state) {
    //use the api search call to get an album uri,
    //then use browse to get the album info
    //! refer to TestVolumioWebsocket.test.js
}

motorizedFaderControl.prototype.getSeekInAlbum = function(albumInfo, state) {
    const self = this;
    let seekInAlbum = 0;

    self.logger.debug('[motorized_fader_control]: Starting getSeekInAlbum process.');

    // Check if the track is in the album's songs
    const currentTrackIndex = albumInfo.songs.findIndex(song => self.isTrackInAlbum({ songs: [song], service: albumInfo.service }, state));

    if (currentTrackIndex === -1) {
        self.logger.warn(`[motorized_fader_control]: Current track not found in album: ${JSON.stringify(state)}`);
        //this gives false negatives: 
    }

    self.logger.debug(`[motorized_fader_control]: Current track index: ${currentTrackIndex}`);

    // Sum up the durations of the preceding tracks
    for (let i = 0; i < currentTrackIndex; i++) {
        seekInAlbum += albumInfo.songs[i].duration * 1000; // Convert duration to ms
    }

    // Add the seek position within the current track
    seekInAlbum += state.seek || 0;
    if (config.get("DEBUG_MODE", false)) {
    self.logger.debug(`[motorized_fader_control]: Adding seek position within current track: ${state.seek || 0} ms`);
    self.logger.debug(`[motorized_fader_control]: Final seek position in album: ${seekInAlbum} ms`);
    }

    return seekInAlbum;
};

motorizedFaderControl.prototype.calculateAlbumProgression = function(seekInAlbum, duration, time = 0) {
    const self = this;
    if (duration === 0) {
        self.logger.warn(`[motorized_fader_control]: Album duration is zero, cannot calculate progression`);
        return null;
    }

    // Calculate the new progression using seekInAlbum as the starting point
    const newProgression = Math.min(100, ((seekInAlbum + time) / duration) * 100);
    if (self.config.get('DEBUG_MODE', false)) {
        self.logger.debug(`[motorized_fader_control]: Calculating album progression with seekInAlbum: ${seekInAlbum} ms, time: ${time} ms, and duration: ${duration} ms`);
    }
    return newProgression;
};

//* START-------------------------------------------------------
// volumio plugin manager interface

motorizedFaderControl.prototype.onVolumioStart = function() {
    var self = this;

    var configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
    
    this.config = new (require('v-conf'))();
    this.config.loadFile(configFile);

    return libQ.resolve();
};

motorizedFaderControl.prototype.onStart = function() {
    var self = this;
    var defer = libQ.defer();
    
    self.startMotorizedFaderControl()  //! maybe move the setup into the start
        .then(() => {
            self.logger.info('[motorized_fader_control]: plugin started successfully.');
            defer.resolve();
        })
        .catch((error) => {
            self.logger.error('Error starting motorized_fader_control plugin: ' + error);
            self.stopMotorizedFaderControl();
            defer.reject(error);
        });
    return defer.promise;
};

motorizedFaderControl.prototype.onStop = function() {
    var self = this; // Maintain reference to `this`
    var defer = libQ.defer();

    self.logger.info('Stopping motorized_fader_control plugin...');
    self.stopMotorizedFaderControl()
        .then(() => {
            self.logger.info('motorized_fader_control plugin stopped successfully.');
            defer.resolve();
        })
        .catch((error) => {
            self.logger.error('Error stopping motorized_fader_control plugin: ' + error);
            defer.reject(error);
        });

    return defer.promise;
};;

motorizedFaderControl.prototype.onRestart = function() {
    var self = this;
    // Optional, use if you need it
};

//* UI CONFIGURATION ------------------------------------------

//* UI CONFIGURATION ------------------------------------------

motorizedFaderControl.prototype.getUIConfig = function() {
    const defer = libQ.defer();
    const self = this;
    const lang_code = this.commandRouter.sharedVars.get('language_code');
    
    self.logger.debug('[motorized_fader_control]: Getting UI Config for language code: ' + lang_code);

    // Load the UIConfig from specified i18n and UIConfig files
    self.commandRouter.i18nJson(
        __dirname + '/i18n/strings_' + lang_code + '.json',
        __dirname + '/i18n/strings_en.json',
        __dirname + '/UIConfig.json'
    )
    .then(uiconf => {
        self.logger.info('[motorized_fader_control]: Successfully loaded UIConfig.');
        
        // Validate sections
        if (!uiconf.sections || uiconf.sections.length === 0) {
            const errorMsg = '[motorized_fader_control]: UIConfig does not contain any sections.';
            self.logger.error(errorMsg);
            defer.reject(new Error(errorMsg));
            return;
        }

        // Populate the UIConfig with values from the config
        uiconf.sections.forEach(section => {
            if (self.config.get('DEBUG_MODE', false)) { 
                self.logger.debug('[motorized_fader_control]: Processing section: ' + (section.label || 'Unnamed Section'));
            }
            if (section.content) {
                self.populateSectionContent(section.content);
                // Additional unpacking for fader settings
                if (section.id === "section_fader_behavior") {
                    if (self.config.get('DEBUG_MODE', false)) { 
                        self.logger.debug('[motorized_fader_control]: Unpacking fader config for section: ' + section.id);
                    }
                    self.unpackFaderConfig(section.content);
                }
            } else {
                self.logger.warn('[motorized_fader_control]: No content found in section: ' + (section.label || 'Unnamed Section'));
            }
        });

        defer.resolve(uiconf);
    })
    .fail(error => {
        const errorMsg = '[motorized_fader_control]: Failed to parse UI Configuration page for plugin Motorized Fader Control: ' + error;
        self.logger.error(errorMsg);
        defer.reject(new Error(errorMsg));
    });

    return defer.promise;
};

motorizedFaderControl.prototype.populateSectionContent = function(content) {
    const self = this;
    content.forEach(element => {
        const configValue = self.config.get(element.id);
        if (configValue !== undefined) {
            element.value = (element.element === 'select') 
                ? self.getSelectValue(element, configValue)
                : configValue; // Directly set value for non-select elements
            if (self.config.get('DEBUG_MODE', false)) { 
                self.logger.debug(`[motorized_fader_control]: Set value for ${element.id}: ${JSON.stringify(element.value)}`);
            }
        } else {
            if (self.config.get('DEBUG_MODE', false)) { 
                self.logger.debug(`[motorized_fader_control]: No value found in config for: ${element.id}`);
            }
        }
    });
};

motorizedFaderControl.prototype.getSelectValue = function(element, selectedValue) {
    const self = this;    
    const selectedLabel = self.getLabelForSelect(element.options, selectedValue);
    const result = { value: selectedValue, label: selectedLabel }; // Return both value and label for select
    return result;
};

motorizedFaderControl.prototype.retrieveSelectValue = function(element) {
    if (!element || typeof element.value === 'undefined') {
        return false;  // Return null if the element or value is undefined
    }
    return element.value;
};

motorizedFaderControl.prototype.unpackFaderConfig = function(content) {
    const self = this;
    try {
        const faderBehavior = JSON.parse(self.config.get('FADER_BEHAVIOR')) || [];
        const faderIdxs = JSON.parse(self.config.get('FADERS_IDXS')) || [];

        // Loop through each configured fader index
        for (let i = 0; i < 4; i++) { // Assuming a maximum of 4 faders
            // Check if the current fader index is configured
            if (faderIdxs.includes(i)) {
                const fader = faderBehavior.find(f => f.FADER_IDX === i) || { OUTPUT: "", INPUT: "", SEEK_TYPE: "" };
                
                self.logger.debug(`[motorized_fader_control]: Fader ${i} configuration: ${JSON.stringify(fader)}`);
                
                // Update configured status
                self.updateFaderElement(content, `FADER_${i}_CONFIGURED`, true); // Set to true since it's configured

                // Map OUTPUT/INPUT/SEEK_TYPE to BEHAVIOR
                const behavior = fader.OUTPUT === "volume" ? "volume" : fader.SEEK_TYPE;
                self.updateFaderElement(content, `FADER_${i}_BEHAVIOR`, behavior);
            } else {
                // If the fader is not configured, update its status accordingly
                self.updateFaderElement(content, `FADER_${i}_CONFIGURED`, false);
                self.updateFaderElement(content, `FADER_${i}_BEHAVIOR`, "volume"); // Default to volume
            }
        }
    } catch (error) {
        const errorMsg = '[motorized_fader_control]: Error unpacking fader configuration: ' + error;
        self.logger.error(errorMsg);
        throw new Error(errorMsg); // Re-throw the error after logging it
    }
};

motorizedFaderControl.prototype.updateFaderElement = function(content, elementId, value) {
    const self = this;
    const element = content.find(elem => elem.id === elementId);
    
    if (element) {
        element.value = (typeof value === 'string') 
            ? { value: value, label: self.getLabelForSelect(element.options, value) }
            : value; // Set configured status directly
        self.logger.debug(`[motorized_fader_control]: ${elementId} updated: ${JSON.stringify(element.value)}`);
    } else {
        self.logger.warn(`[motorized_fader_control]: ${elementId} not found.`);
    }
};

motorizedFaderControl.prototype.getLabelForSelect = function(options, key) {
    const option = options.find(opt => opt.value === key);
    return option ? option.label : 'SELECT OPTION';
};

//* UIConfig Saving

motorizedFaderControl.prototype.saveFaderElement = async function(data) {
    var self = this;

    try {
        self.logger.info('[motorized_fader_control]: Saving fader elements: ');

        // Repack fader configuration
        self.repackAndSaveFaderBehaviorConfig(data);

        await self.restartFaderController();

    } catch (error) {
        self.logger.error('[motorized_fader_control]: Error saving fader elements: ' + error);
        throw error;
    }
};

motorizedFaderControl.prototype.repackAndSaveFaderBehaviorConfig = function(data) {
    var self = this;

    try {
        self.logger.debug('[motorized_fader_control]: Repacking fader configuration.');

        let faderBehavior = [];
        let faderIdxs = [];

        // Iterate over the fader data and repack the information
        for (let i = 0; i < 4; i++) {  // Assuming a maximum of 4 faders
            self.logger.debug(`[motorized_fader_control]: Processing fader ${i}...`);

            // Log the raw data for this fader
            self.logger.debug(`[motorized_fader_control]: Fader ${i} raw data: ${JSON.stringify({
                configured: data[`FADER_${i}_CONFIGURED`],
                behavior: data[`FADER_${i}_BEHAVIOR`]
            })}`);

            let faderConfigured = data[`FADER_${i}_CONFIGURED`];
            let faderBehaviorValue = data[`FADER_${i}_BEHAVIOR`]?.value || "volume";

            self.logger.debug(`[motorized_fader_control]: Fader ${i} behavior value: ${faderBehaviorValue}`);

            // Map behavior to output/input/seek_type
            const output = faderBehaviorValue === "volume" ? "volume" : "seek";
            const input = output; // Input always matches output
            const seekType = faderBehaviorValue === "volume" ? "" : faderBehaviorValue;

            self.logger.debug(`[motorized_fader_control]: Fader ${i} mapped values: OUTPUT=${output}, INPUT=${input}, SEEK_TYPE=${seekType}`);

            faderBehavior.push({
                FADER_IDX: i,
                OUTPUT: output,
                INPUT: input,
                SEEK_TYPE: seekType
            });

            if (faderConfigured) {
                faderIdxs.push(i);
                self.logger.debug(`[motorized_fader_control]: Fader ${i} is configured.`);
            } else {
                self.logger.debug(`[motorized_fader_control]: Fader ${i} is not configured.`);
            }

            if (self.config.get('DEBUG_MODE', false)) { 
                self.logger.debug(`[motorized_fader_control]: Repacked Fader ${i} configuration: OUTPUT=${output}, INPUT=${input}, SEEK_TYPE=${seekType}`);
            }
        }

        // Log the final fader behavior array
        self.logger.debug(`[motorized_fader_control]: Final fader behavior array: ${JSON.stringify(faderBehavior)}`);

        // Log the final fader indexes array
        self.logger.debug(`[motorized_fader_control]: Final fader indexes array: ${JSON.stringify(faderIdxs)}`);

        // Save the repacked configuration back to the config
        self.config.set('FADER_BEHAVIOR', JSON.stringify(faderBehavior));
        self.config.set('FADERS_IDXS', JSON.stringify(faderIdxs));

        self.logger.debug('[motorized_fader_control]: Fader configuration saved successfully.');
    } catch (error) {
        self.logger.error('[motorized_fader_control]: Error repacking fader configuration: ' + error.message);
        self.logger.error('[motorized_fader_control]: Stack trace: ' + error.stack);
        throw error;
    }
};

motorizedFaderControl.prototype.saveFaderControllerSettingsRestart = async function(data) {
    var self = this;
    self.logger.info('[motorized_fader_control]: Saving fader controller settings and restarting...');

    // Update the configuration values based on user input
    for (const key in data) {
        if (data.hasOwnProperty(key)) {
            if (self.retrieveSelectValue(data[key])) {
                self.config.set(key, data[key].value);
            } else {
                self.config.set(key, data[key]);
            }
        }
    }
    self.commandRouter.pushToastMessage('info', 'Restart Required', 'The FaderController will reset to apply the new settings.');
    await self.restartFaderController();
    self.logger.info('[motorized_fader_control]: Fader controller settings saved and restarted successfully');
};

motorizedFaderControl.prototype.saveGeneralSettingsRestart = async function(data) {
    var self = this;
    self.logger.info('[motorized_fader_control]: Saving general settings and restarting plugin...');

    for (const key in data) {
        if (data.hasOwnProperty(key)) {
            if (self.retrieveSelectValue(data[key])) {
                self.config.set(key, data[key].value);
            } else {
                self.config.set(key, data[key]);
            }
        }
    }
    self.commandRouter.pushToastMessage('info', 'Restart Required', 'The FaderController will reset to apply the new settings.');
    await self.restartMotorizedFaderControl();
};

motorizedFaderControl.prototype.getConfigurationFiles = function() {
	return ['config.json'];
};

motorizedFaderControl.prototype.setUIConfig = async function(data) { //! deprecated
    var self = this;

    // Update the configuration values based on user input
    for (const key in data) {
        if (data.hasOwnProperty(key)) {
            self.config.set(key, data[key]);
        }
    }

    await self.restartFaderController();
};

//* UI BUTTONS ACTIONS

motorizedFaderControl.prototype.RunManualCalibration = async function() { //TODO TEST THIS
    var self = this;

    // Run a full calibration
    const calibrationIndexes = self.config.get("FADER_IDXS", undefined);
    const START_PROGRESSION = self.config.get("CALIBRATION_START_PROGRESSION");
    const END_PROGRESSION = self.config.get("CALIBRATION_END_PROGRESSION");
    const COUNT = self.config.get("CALIBRATION_COUNT");
    const START_SPEED = self.config.get("CALIBRATION_START_SPEED");
    const END_SPEED = self.config.get("CALIBRATION_END_SPEED");
    const TIME_GOAL = self.config.get("CALIBRATION_TIME_GOAL");
    const TOLERANCE = self.config.get("CALIBRATION_TOLERANCE");
    const RUN_IN_PARALLEL = self.config.get("CALIBRATION_RUN_IN_PARALLEL");

    self.commandRouter.pushToastMessage('info', 'Starting Calibration');
    const results = await self.faderController.calibrate(calibrationIndexes, START_PROGRESSION, END_PROGRESSION, COUNT, START_SPEED, END_SPEED, TIME_GOAL, TOLERANCE, RUN_IN_PARALLEL);

    // Unpack results and get the index + the factor, pack this into the config
    const { indexes, movementSpeedFactors } = results;
    const speedFactorsConfig = indexes.map((index, i) => ({ [index]: movementSpeedFactors[i] }));
    self.config.set("FADER_SPEED_FACTOR", JSON.stringify(speedFactorsConfig));

    // Restart FaderController with new Settings
    self.restartFaderController();
    self.commandRouter.pushToastMessage('info', 'Finished Calibration');
};

//* CACHING ----------------------------------------------------
// helper functions for caching


/**
 * Caches the fader info for the given fader index or indexes.
 * 
 * @param {number|number[]} faderIdx - The index or indexes of the fader(s).
 * @returns {object} The cached fader info before updating.
 * @throws {Error} If the fader index is invalid.
 */
motorizedFaderControl.prototype.cacheFaderInfo = function(faderIdx) {
    var self = this;
    var cachedInfoBeforeUpdate = {};

    try {
        // Ensure faderIdx is an array
        if (!Array.isArray(faderIdx)) {
            faderIdx = [faderIdx];
        }

        // Get fader info for each index
        let faderInfoArray = this.faderController.getFadersInfo(faderIdx);


        // Cache the fader info and store the previous state
        faderIdx.forEach((idx, i) => {
            self.logger.debug('[motorized_fader_control]: Caching fader info for index: ' + idx);
            cachedInfoBeforeUpdate[idx] = this.cachedFaderInfo[idx];
            this.cachedFaderInfo[idx] = faderInfoArray[i];
        });

        return cachedInfoBeforeUpdate;
    } catch (error) {
        self.logger.error('[motorized_fader_control]: Error caching fader info: ' + error);
        throw error;
    }
};

/**
 * Clears the cached fader info for the given fader index or indexes.
 * 
 * @param {number|number[]} [faderIdx] - The index or indexes of the fader(s). If not provided, clears all cached fader info.
 * @returns {object} The cached fader info before clearing.
 * @throws {Error} If the fader index is invalid.
 */
motorizedFaderControl.prototype.clearCachedFaderInfo = function(faderIdx) {
    var self = this;
    var cachedInfoBeforeClear = {};

    try {
        // If no faderIdx is provided, clear all cached fader info
        if (faderIdx === undefined) {
            self.logger.debug('[motorized_fader_control]: Clearing all cached fader info...');
            cachedInfoBeforeClear = this.cachedFaderInfo;
            this.cachedFaderInfo = {};
            return cachedInfoBeforeClear;
        }

        // Ensure faderIdx is an array
        if (!Array.isArray(faderIdx)) {
            faderIdx = [faderIdx];
        }

        // Clear the fader info for each index and store the previous state
        faderIdx.forEach(idx => {
            cachedInfoBeforeClear[idx] = this.cachedFaderInfo[idx];
            delete this.cachedFaderInfo[idx];
        });

        self.logger.info('[motorized_fader_control]: Fader info cleared for indexes: ' + JSON.stringify(faderIdx));
        return cachedInfoBeforeClear;
    } catch (error) {
        self.logger.error('[motorized_fader_control]: Error clearing fader info: ' + error);
        throw error;
    }
};

/**
 * Checks if the fader info has changed for the given fader index or indexes.
 * If keys are provided, only those keys are compared.
 * 
 * @param {number|number[]} faderIdx - The index or indexes of the fader(s).
 * @param {string|string[]} [keys] - The key or array of keys to compare.
 * @returns {boolean} True if the fader info has changed, false otherwise.
 * @throws {Error} If the fader index is invalid.
 */
motorizedFaderControl.prototype.checkFaderInfoChanged = function(faderIdx, keys) {
    var self = this;

    if (!Array.isArray(faderIdx)) {
        faderIdx = [faderIdx];
    }

    faderIdx.forEach(idx => {
        if (typeof idx !== 'number' || idx < 0) {
            throw new Error('Invalid fader index: ' + idx);
        }
    });

    let currentFaderInfoArray = self.faderController.getFadersInfo(faderIdx);

    return faderIdx.some((idx, i) => {
        let cachedFaderInfo = this.cachedFaderInfo && this.cachedFaderInfo[idx];
        if (cachedFaderInfo) {
            if (keys) {

                keys = Array.isArray(keys) ? keys : [keys];
                return keys.some(key => currentFaderInfoArray[key] !== cachedFaderInfo[key]);
            } else {

                return JSON.stringify(currentFaderInfoArray) !== JSON.stringify(cachedFaderInfo);
            }
        }
        return true; 
    });
};

motorizedFaderControl.prototype.getCachedFaderInfo = function(faderIdx) {
    var self = this;
    self.logger.debug('[motorized_fader_control]: Getting cached fader info for index: ' + faderIdx + "info: "+ JSON.stringify(self.cachedFaderInfo[faderIdx]));
    return self.cachedFaderInfo[faderIdx];
};

motorizedFaderControl.prototype.cacheState = function(state) {
    this.cachedState = state;
    this.logger.debug('[motorized_fader_control]: State cached ');
};

motorizedFaderControl.prototype.cacheQueue = function(queue) {
    var self = this;
    self.cachedQueue = queue;
    self.logger.debug('[motorized_fader_control]: Queue cached: ' + JSON.stringify(queue));
};

motorizedFaderControl.prototype.cacheVolume = function(volume) {
    var self = this;
    self.cachedVolume = volume;
    self.logger.debug('[motorized_fader_control]: Volume cached: ' + JSON.stringify(volume));
};

motorizedFaderControl.prototype.cacheAlbumInfo = function(albumInfo) {
    var self = this;
    self.cachedAlbumInfo = albumInfo;
    self.logger.debug('[motorized_fader_control]: albumInfo cached');
};

motorizedFaderControl.prototype.clearCachedAlbumInfo = function () {
    var self = this;
    self.cachedAlbumInfo = {};
    self.logger.debug('[motorized_fader_control]: albumInfo cleared');

};

motorizedFaderControl.prototype.cacheTimeLastActiveStateUpdate = function() {
    this.lastActiveStateUpdate = Date.now();
};

motorizedFaderControl.prototype.getTimeSinceLastActiveStateUpdate = function() {
    const currentTime = Date.now();
    const elapsedTime = currentTime - this.lastActiveStateUpdate;
    return elapsedTime;
};

//* VALIDATE

motorizedFaderControl.prototype.validateState = function(state) {
    // Check if state is not null or undefined and has the key "status"
    if (state && typeof state === 'object' && state.hasOwnProperty("status")) {
        const PlaybackStatus = state.status; // Use dot notation to access 'status'
        
        // Check if the PlaybackStatus is one of the valid states
        if (PlaybackStatus === 'play' || PlaybackStatus === 'pause' || PlaybackStatus === 'stop') {
            // Check if the seek value is valid
            if (state.hasOwnProperty("seek") && state.hasOwnProperty("duration")) {
                const seek = state.seek;
                const duration = state.duration * 1000; // convert to ms

                // Log the seek and duration values
                this.logger.debug(`[motorized_fader_control]: validateState: Checking seek and duration: seek=${seek}, duration=${duration}`);

                // Check if seek is larger than duration
                if (seek > duration) {
                    this.logger.warn(`[motorized_fader_control]: validateState: Invalid state: seek (${seek} ms) is larger than duration (${duration} ms)`);
                    return false;
                }
            }
            return true;
        }
    }
    return false; // Return false if state is invalid or status doesn't match
};

motorizedFaderControl.prototype.checkAlbumInfoValid = function(albumInfo, state) {
    var self = this;

    // Check if albumInfo is not null, undefined, or an empty object
    if (!albumInfo || typeof albumInfo !== 'object' || Object.keys(albumInfo).length === 0) {
        self.logger.warn('[motorized_fader_control]: Invalid albumInfo object: ' + JSON.stringify(albumInfo));
        return false;
    }

    // Check if albumInfo has the necessary properties
    if (!albumInfo.album || !Array.isArray(albumInfo.songs)) {
        self.logger.warn('[motorized_fader_control]: albumInfo is missing required properties');
        return false;
    }

    // Check if songs array contains valid song objects
    if (albumInfo.songs.length === 0 || !albumInfo.songs.every(song => song.title && song.artist && song.duration)) {
        self.logger.warn('[motorized_fader_control]: albumInfo.songs array is invalid');
        return false;
    }

    // Check if the album name matches
    const isAlbumMatch = state.album === albumInfo.album;
    // Check if the track is in the album's songs
    const isTrackInAlbum = self.isTrackInAlbum(albumInfo, state);

    self.logger.debug(`[motorized_fader_control]: Track in album: ${isTrackInAlbum}`);

    // Return true if both checks pass, otherwise false
    return isAlbumMatch && isTrackInAlbum;
};

motorizedFaderControl.prototype.isTrackInAlbum = function(albumInfo, state) { //! we need to fix this, why is this being flagged as false:
    //Checking song - Title: The Illest Villains, Artist: Madvillain, Duration: 115, Service: jellyfin against state - Title: The Illest Villains, Artist: Madvillain, Duration: 119, Service: mpd - Match: false
    var self = this;
    const durationTolerance = 5; // Tolerance in seconds

    return albumInfo.songs.some(song => {
        const match = song.title === state.title &&
                      song.artist === state.artist &&
                      albumInfo.service === state.service &&
                      Math.abs(song.duration - state.duration) <= durationTolerance;
        if (self.config.get('DEBUG_MODE', false)) {
            self.logger.debug(`[motorized_fader_control]: Checking song - Title: ${song.title},Artist: ${song.artist},Duration: ${song.duration},Service: ${albumInfo.service} against state -Title: ${state.title},Artist: ${state.artist},Duration: ${state.duration},Service: ${state.service}-Match: ${match}`);
        }
        return match;
    });
};

motorizedFaderControl.prototype.checkStateChanged = function(state) {
    const self = this;
    if (!self.cachedState) {
        self.cachedState = {}; // Initialize if missing
        return true; // First run always triggers
    }

    // Define critical fields that affect fader behavior
    const CRITICAL_FIELDS = [
        'seek',       // Track position
        'status',     // Play/pause
        'duration',   // Track length
        'uri'         // Track identifier
    ];

    // Check if any critical field has changed
    const hasChanged = CRITICAL_FIELDS.some(field => {
        const stateValue = JSON.stringify(state[field]);
        const cachedValue = JSON.stringify(self.cachedState[field]);
        const fieldChanged = stateValue !== cachedValue;

        // Log the comparison details
        self.logger.debug(`[motorized_fader_control]: checkStateChanged: Comparing field '${field}': stateValue=${stateValue}, cachedValue=${cachedValue}, changed=${fieldChanged}`);

        return fieldChanged;
    });

    if (hasChanged) {
        self.cacheState(state);
        return true;
    }
    return false;
};

motorizedFaderControl.prototype.checkPlayingState = function(state) { //TODO FIX THIS
    // checkPlayingState gives false negatives
    if (state && state.hasOwnProperty("status")) {
        const PlaybackStatus = state.status;
        if (PlaybackStatus === 'play') {
            this.cacheTimeLastActiveStateUpdate();
            return true;
        } else if (PlaybackStatus === 'pause' || PlaybackStatus === 'stop') {
            return false;
        }
    }
    return false;
};

motorizedFaderControl.prototype.checkPlayingStateRandom = function(state) {
    //check if the random key is true
    if (state && state.hasOwnProperty("random")) {
        const random = state.random;
        if (random === "true") {
            return true
        } else if (random === "false") {
            return false
        }
    }
    return false
};

motorizedFaderControl.prototype.checkPlayingStateRandom = function(state) {
    //check if the random key is true
    if (state && state.hasOwnProperty("random")) {
        const random = state.random;
        if (random === "true") {
            return true
        } else if (random === "false" || random === "null") {
            return false
        }
    }
    return false
};

motorizedFaderControl.prototype.checkPlayingStateRepeat = function(state) {
    //check if the repeat key is true
    if (state && state.hasOwnProperty("repeat")) {
        const repeat = state.repeat;
        if (repeat === "true") {
            return true
        } else if (repeat === "false" || repeat === "null") {
            return false
        }
    }
    return false
};

motorizedFaderControl.prototype.checkPlayingStateRepeatSingle = function(state) {
    //check if the repeat key is true
    if (state && state.hasOwnProperty("repeatSingle")) {
        const repeatSingle = state.repeat;
        if (repeatSingle === "true") {
            return true
        } else if (repeatSingle === "false" || repeatSingle === "null") {
            return false
        }
    }
    return false
};

//* logging:

motorizedFaderControl.prototype.setupLogLevel = function() {
    var self = this;

    // Ensure config and logger are initialized
    if (!self.config || !self.logger) {
        console.warn('[motorized_fader_control]: Config or Logger not initialized.');
        return;
    }

    try {
        // Get log level from configuration, defaulting to 'info'
        const defaultLogLevel = 'info';
        self.log_level = self.config.get('LOG_LEVEL', defaultLogLevel);
        
        // Cache the current log level and set the new one
        self.cacheLogLevel();
        self.setLogLevel(self.log_level);
    } catch (error) {
        self.logger.warn(`[motorized_fader_control]: Error setting up log level: ${error.message}`);
    }
};

motorizedFaderControl.prototype.setLogLevel = function(level) {
    var self = this;

    // Ensure logger exists and has at least one transport
    if (self.logger && self.logger.transports.length > 0) {
        // Change the log level for the first transport
        self.logger.transports[0].level = level;
        self.logger.info(`[motorized_fader_control]: Log level changed to: ${level}`);
    } else {
        self.logger.error('[motorized_fader_control]: Logger or console transport not initialized properly.');
    }
};

motorizedFaderControl.prototype.cacheLogLevel = function() {
    var self = this;

    // Ensure logger exists
    if (self.logger) {
        // Cache the current log level only once
        if (!self.cachedLogLevel) {
            self.cachedLogLevel = self.logger.transports[0].level;
        }
    } else {
        console.error('[motorized_fader_control]: Logger not initialized properly or no console transport found.');
    }
};

motorizedFaderControl.prototype.getLogLevel = function() {
    var self = this;

    if (self.logger && self.logger.transports.length > 0) {
        const level = self.logger.transports[0].level;
        if (level) {
            return level;
        } else {
            self.logger.error('[motorized_fader_control]: Retrieved log level is invalid.');
            return null;
        }
    } else {
        self.logger.error('[motorized_fader_control]: Logger or console transport not initialized properly.');
        return null;
    }
};

motorizedFaderControl.prototype.getCachedLogLevel = function() {
    var self = this;

    if (self.cachedLogLevel) {
        self.logger.info(`[motorized_fader_control]: Returning cached log level: ${self.cachedLogLevel}`);
        return self.cachedLogLevel;
    } else {
        self.logger.warn('[motorized_fader_control]: No cached log level found.');
        return null;
    }
};

motorizedFaderControl.prototype.logFaderControllerConfig = function(config) {
    var self = this;
    self.logger.debug('[motorized_fader_control]: -------------- Fader Controller Configuration STA --------------');
    self.logger.debug('[motorized_fader_control]: Fader Count: ' + config.get('FADER_CONTROLLER_FADER_COUNT'));
    self.logger.debug('[motorized_fader_control]: Message Delay: ' + config.get('FADER_CONTROLLER_MESSAGE_DELAY'));
    self.logger.debug('[motorized_fader_control]: MIDI Log: ' + config.get('FADER_CONTROLLER_MIDI_LOG'));
    self.logger.debug('[motorized_fader_control]: Value Log: ' + config.get('FADER_CONTROLLER_VALUE_LOG'));
    self.logger.debug('[motorized_fader_control]: Move Log: ' + config.get('FADER_CONTROLLER_MOVE_LOG'));
    self.logger.debug('[motorized_fader_control]: Fader Trim Map: ' + config.get('FADER_TRIM_MAP'));
    self.logger.debug('[motorized_fader_control]: Speed High: ' + config.get('FADER_CONTROLLER_SPEED_HIGH'));
    self.logger.debug('[motorized_fader_control]: Speed Medium: ' + config.get('FADER_CONTROLLER_SPEED_MEDIUM'));
    self.logger.debug('[motorized_fader_control]: Speed Low: ' + config.get('FADER_CONTROLLER_SPEED_LOW'));
    self.logger.debug('[motorized_fader_control]: Calibration on Start: ' + config.get('FADER_CONTROLLER_CALIBRATION_ON_START'));
    self.logger.debug('[motorized_fader_control]: -------------- Fader Controller Configuration END --------------');
};

//* HELPERS ----------------------------------------------------
/**
 * Helper method to get the correct input/output type for a fader.
 * If input is not explicitly set, it defaults to the output type.
 * This ensures backward compatibility and simplifies future changes.
 * 
 * @param {number} faderIdx - The index of the fader.
 * @returns {string} - The input type for the fader.
 */
motorizedFaderControl.prototype.getFaderInputType = function(faderIdx) {
    const self = this;
    const faderBehavior = JSON.parse(self.config.get('FADER_BEHAVIOR', '[]'));
    const faderConfig = faderBehavior.find(fader => fader.FADER_IDX === faderIdx);

    if (!faderConfig) {
        self.logger.warn(`[motorized_fader_control]: No configuration found for fader ${faderIdx}`);
        return 'volume'; // Default to volume if no config is found
    }

    // Always return the output type as input type
    return faderConfig.OUTPUT;
};

/**
 * Helper method to get the correct SeekType type for a fader.
 * 
 * @param {number} faderIdx - The index of the fader.
 * @returns {string} - The input type for the fader.
 */
motorizedFaderControl.prototype.getFaderSeekType = function(faderIdx) {
    const self = this;
    const faderBehavior = JSON.parse(self.config.get('FADER_BEHAVIOR', '[]'));
    const faderConfig = faderBehavior.find(fader => fader.FADER_IDX === faderIdx);

    if (!faderConfig) {
        self.logger.warn(`[motorized_fader_control]: No configuration found for fader ${faderIdx}`);
        return 'track'; // Default to track if no config/seekTpye is found
    }

    return faderConfig.SEEK_TYPE;
};

