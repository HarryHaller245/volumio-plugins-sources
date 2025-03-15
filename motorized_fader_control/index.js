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

    this.logs = null;
    this.PLUGINSTR = '[motorized_fader_control]'

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

//* START-------------------------------------------------------

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
    
    // Initialize logs
    self.initializeLogs();
    // Existing initialization
    this.initializeFaderController();

    // New initialization
    this.setupVolumioBridge();
    this.setupServiceRouter();
    return defer.promise;
};

motorizedFaderControl.prototype.onStop = function() {
    var self = this; // Maintain reference to `this`
    var defer = libQ.defer();


    return defer.promise;
};;

motorizedFaderControl.prototype.onRestart = function() {
    var self = this;
    // Optional, use if you need it
};


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
        const faderTrimMap = JSON.parse(self.config.get('FADER_TRIM_MAP')) || {}; // Parse the stringified JSON object

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

                // Update FADER TRIM using the parsed faderTrimMap
                const faderTrim = faderTrimMap[i] || [0, 100]; // Access the trim map using the fader index as a key, this somehow results in a nested FADER_0_TRIM updated: [[0,56]]
                self.updateFaderElement(content, `FADER_${i}_TRIM`, faderTrim);

            } else {
                // If the fader is not configured, update its status accordingly
                self.updateFaderElement(content, `FADER_${i}_CONFIGURED`, false);
                self.updateFaderElement(content, `FADER_${i}_BEHAVIOR`, ""); // Default to volume
                // Update FADER TRIM, default to [0, 100]
                self.updateFaderElement(content, `FADER_${i}_TRIM`, [0, 100]);
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
        if (elementId.includes("TRIM")) {
            // For equalizer elements, set the value as a nested array (e.g., [[0, 100]])
            element.config.bars[0].value = value; // Wrap the value in an array //! wrror: Error unpacking fader configuration: TypeError: Cannot set property 'value' of undefined
        } else {
            // For other elements, assign the value directly
            element.value = (typeof value === 'string') 
                ? { value: value, label: self.getLabelForSelect(element.options, value) }
                : value;
        }
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
        let faderTrimMap = {};

        // Iterate over the fader data and repack the information
        for (let i = 0; i < 4; i++) {  // Assuming a maximum of 4 faders
            self.logger.debug(`[motorized_fader_control]: Processing fader ${i}...`);

            // Log the raw data for this fader
            self.logger.debug(`[motorized_fader_control]: Fader ${i} raw data: ${JSON.stringify({
                configured: data[`FADER_${i}_CONFIGURED`],
                behavior: data[`FADER_${i}_BEHAVIOR`],
                trim: data[`FADER_${i}_TRIM`]
            })}`);

            let faderConfigured = data[`FADER_${i}_CONFIGURED`];
            let faderBehaviorValue = data[`FADER_${i}_BEHAVIOR`]?.value || "volume";
            let faderTrimMapValue = data[`FADER_${i}_TRIM`];

            // Unnest the trim value if it's in the `bars` array format
            let faderTrim = Array.isArray(faderTrimMapValue) && faderTrimMapValue.length > 0
                ? faderTrimMapValue[0]  // Extract the nested array
                : [0, 100];  // Default to [0, 100] if invalid

            // Map behavior to output/input/seek_type
            const output = faderBehaviorValue === "volume" ? "volume" : "seek";
            const input = output; // Input always matches output
            const seekType = faderBehaviorValue === "volume" ? "" : faderBehaviorValue;

            self.logger.debug(`[motorized_fader_control]: Fader ${i} mapped values: OUTPUT=${output}, INPUT=${input}, SEEK_TYPE=${seekType}`);

            // Add fader behavior to the array
            faderBehavior.push({
                FADER_IDX: i,
                OUTPUT: output,
                INPUT: input,
                SEEK_TYPE: seekType
            });

            // Add fader trim to the trim map
            faderTrimMap[i] = faderTrim;

            // Add fader index to configured list if configured
            if (faderConfigured) {
                faderIdxs.push(i);
                self.logger.debug(`[motorized_fader_control]: Fader ${i} is configured.`);
            } else {
                self.logger.debug(`[motorized_fader_control]: Fader ${i} is not configured.`);
            }

            if (self.config.get('DEBUG_MODE', false)) { 
                self.logger.debug(`[motorized_fader_control]: Repacked Fader ${i} configuration: OUTPUT=${output}, INPUT=${input}, SEEK_TYPE=${seekType}, CONFIGURED=${faderConfigured}, TRIM=${faderTrim}`);
            }
        }

        // Log the final fader behavior array
        self.logger.debug(`[motorized_fader_control]: Final fader behavior array: ${JSON.stringify(faderBehavior)}`);

        // Log the final fader indexes array
        self.logger.debug(`[motorized_fader_control]: Final fader indexes array: ${JSON.stringify(faderIdxs)}`);

        // Log the final fader trim map
        self.logger.debug(`[motorized_fader_control]: Final fader trim map: ${JSON.stringify(faderTrimMap)}`);

        // Save the repacked configuration back to the config
        self.config.set('FADER_BEHAVIOR', JSON.stringify(faderBehavior));
        self.config.set('FADERS_IDXS', JSON.stringify(faderIdxs));
        self.config.set('FADER_TRIM_MAP', JSON.stringify(faderTrimMap)); // Save as stringified JSON

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
    self.onRestart();
};

motorizedFaderControl.prototype.getConfigurationFiles = function() {
    return ['config.json'];
};

//* UI BUTTONS ACTIONS

motorizedFaderControl.prototype.RunManualCalibration = async function() {
    var self = this;

    try {
        // Run a full calibration
        const calibrationIndexes = JSON.parse(self.config.get('FADERS_IDXS', '[]'));
        const START_PROGRESSION = self.config.get("CALIBRATION_START_PROGRESSION");
        const END_PROGRESSION = self.config.get("CALIBRATION_END_PROGRESSION");
        const COUNT = self.config.get("CALIBRATION_COUNT");
        const START_SPEED = self.config.get("CALIBRATION_START_SPEED");
        const END_SPEED = self.config.get("CALIBRATION_END_SPEED");
        const TIME_GOAL = self.config.get("CALIBRATION_TIME_GOAL");
        const TOLERANCE = self.config.get("CALIBRATION_TOLERANCE");
        const RUN_IN_PARALLEL = self.config.get("CALIBRATION_RUN_IN_PARALLEL");

        if (!calibrationIndexes) {
            self.commandRouter.pushToastMessage('error', 'No fader configured.');
            return;
        }

        self.commandRouter.pushToastMessage('info', 'Starting Calibration');
        const results = await self.faderController.calibrate(
            calibrationIndexes, 
            START_PROGRESSION, 
            END_PROGRESSION, 
            COUNT, 
            START_SPEED, 
            END_SPEED, 
            TIME_GOAL, 
            TOLERANCE, 
            RUN_IN_PARALLEL
        );

        // Unpack results and update the configuration
        const { indexes, movementSpeedFactors, validationResult } = results;
        const speedFactorsConfig = indexes.map(index => ({ [index]: movementSpeedFactors[index] }));
        self.config.set("FADER_SPEED_FACTOR", JSON.stringify(speedFactorsConfig));

        self.commandRouter.pushToastMessage('info', 'Finished Calibration');
        await self.restartFaderController();
    } catch (error) {
        self.logger.error(`[motorized_fader_control]: Error during calibration: ${error.message}`);
        self.commandRouter.pushToastMessage('error', 'Calibration Failed', 'Please check logs for details.');
    }
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

motorizedFaderControl.prototype.initializeLogs = function() {
    var self = this;

    // Set up log level (if needed)
    self.setupLogLevel();

    // Load log-specific i18n file (logs_en.json)
    try {
        self.logs = require(__dirname + '/i18n/logs_en.json');
        self.logger.info(`${self.PLUGINSTR}: Log messages initialized successfully.`);
    } catch (error) {
        self.logger.error(`${self.PLUGINSTR}: Failed to load log messages: ${error.message}`);
        throw error; // Stop plugin if logs cannot be loaded
    }
};

//* ADAPTER LAYER #####################################################################

motorizedFaderControl.prototype.setupServiceRouter = function() {
    var self = this;

    const config = JSON.parse(this.config.get('FADER_BEHAVIOR'));
    
    config.forEach(({FADER_IDX, SEEK_TYPE}) => {
      const ServiceClass = this.getServiceClass(SEEK_TYPE);
      this.services.set(FADER_IDX, new ServiceClass(
        FADER_IDX,
        this.eventBus,
        this.stateCache
      ));
      
      this.eventBus.on(`fader/${FADER_IDX}/move`, position => {
        this.services.get(FADER_IDX).handleMove(position);
      });
    });
};   

motorizedFaderControl.prototype.getServiceClass = function(SEEK_TYPE) {
    return {
        volume: VolumeService,
        track: TrackService,
        album: AlbumService

    }[SEEK_TYPE];
};

// In index.js - Enhanced Volumio Bridge
motorizedFaderControl.prototype.setupVolumioBridge = function() {
    const self = this;
    
    this.socket = io.connect(`http://${this.config.get('VOLUMIO_HOST')}:3000`, {
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000
    });
  
    // Unified State Handler
    const handleStateUpdate = (state) => {  
      // New cache integration
      self.stateCache.set('playback', 'state', state);
  
      // Existing playback state checks
      if (self.checkPlayingState(state)) {
        self.cacheTimeLastActiveStateUpdate();
        self.eventBus.emit('playback/playing', state);
      }
    };
  
    // WebSocket Event Handling
    this.socket.on('pushState', handleStateUpdate);
    this.socket.on('pushQueue', queue => {
      self.cachedQueue = queue;
      self.stateCache.set('queue', 'current', queue);
    });
  
    // Automatic Reconnect Handling
    this.socket.on('reconnect', () => {
      self.logger.info('WebSocket reconnected, resyncing state...');
      this.socket.emit('getState');
      this.socket.emit('getQueue');
    });
  
    // Command Proxy
    this.eventBus.on('command/*', (command, ...args) => {
      const method = command.split('/')[1];
      if (typeof this.socket.emit[method] === 'function') {
        this.socket.emit(method, ...args);
      }
    });
};

// State Validation Middleware
motorizedFaderControl.prototype.setupStateValidation = function() {
    this.eventBus.on('playback/update', state => {
        if (!this.validateState(state)) {
        this.logger.warn('Invalid state update received:', state);
        return;
        }

        // New service-based handling
        this.eventBus.emit('validated/state', state);
    });
};

// Progressive Migration: Seek Progression
motorizedFaderControl.prototype.hasCachedProgressionChanged = function(faderIdx, newProgression) {
    // New cache check
    const ns = this.services.get(faderIdx)?.type === 'album' ? 'album' : 'track';
    const cached = this.stateCache.get(ns, 'progression');

    return oldChanged || cached !== newProgression;
};
  
// Unified Volume Handling
motorizedFaderControl.prototype.handleVolumeUpdate = async function(volumeData) {
    // New state management
    this.stateCache.set('system', 'volume', {
        value: volumeData.vol,
        muted: volumeData.mute,
        updated: Date.now()
    });

    // New service-based update
    this.eventBus.emit('volume/update', volumeData.vol);
};

//* FADER LAYER ########################################################################

motorizedFaderControl.prototype.initializeFaderController = function() {
    const self = this;
    
    // Existing initialization logic
    self.setupFaderController()
  
    // New adapter connection
    this.setupFaderAdapter();
    this.setupFaderFeedback();
};

motorizedFaderControl.prototype.setupFaderFeedback = function() {
    this.eventBus.on('Fader/update', ({idxs, targets, speeds}) => {
      if(this.faderController) {
        //construct Fader Move here and pass it to the controller
        move = new FaderMove(idxs, targets, speeds)
        this.faderController.moveFaders(Move, position);
      }
    });
}

motorizedFaderControl.prototype.setupFaderController = function() {
    var self = this;
    self.logger.info('[motorized_fader_control]: Setting up FaderController...');

    return new Promise(async (resolve, reject) => {
        try {
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
            if (faderIndexes === undefined || faderIndexes.length === 0) {
                self.logger.warn('[motorized_fader_control]: Fader indexes not set. Please enable at least one Fader.');
                self.commandRouter.pushToastMessage('warning', 'No fader configured!', 'Check your settings.');
                reject(new Error('No fader indexes configured.'));
                return;
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

            if (Object.keys(trimMap).length !== 0) {
                self.faderController.setFadersTrimsDict(trimMap);
            }

            const faderSpeedFactorConfig = self.config.get('FADER_SPEED_FACTOR', '[]');
            let faderSpeedFactors;
            try {
                faderSpeedFactors = JSON.parse(faderSpeedFactorConfig);
                faderSpeedFactors.forEach(factorConfig => {
                    const index = Object.keys(factorConfig)[0];
                    const factor = factorConfig[index];
                    self.faderController.setFadersMovementSpeedFactor(parseInt(index), parseFloat(factor));
                });
                self.logger.debug('[motorized_fader_control]: Fader speed factors set successfully.');
            } catch (error) {
                self.logger.error(`[motorized_fader_control]: Failed to parse FADER_SPEED_FACTOR config: ${error.message}`);
            }

            resolve(true); // Resolve the promise on successful setup
        } catch (error) {
            self.logger.error('[motorized_fader_control]: Error setting up FaderController: ' + error.message);
            reject(error); // Reject the promise on failure
        }
    });
};

// Modified adapter setup
motorizedFaderControl.prototype.setupFaderAdapter = function() {
    // Assuming FaderController emits 'move' events
    this.faderController.on('touch', (faderIdx, faderInfo) => {
        this.eventBus.emit(`fader/${faderIdx}/touch`, {
        fader: faderInfo,
        timestamp: Date.now()
        });
    });

    this.faderController.on('untouch', (faderIdx, faderInfo) => {
        this.eventBus.emit(`fader/${faderIdx}/untouch`, {
        fader: faderInfo,
        timestamp: Date.now()
        });
    });

};