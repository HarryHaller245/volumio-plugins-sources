'use strict';

const packageInfo = require('./package.json'); 
var libQ = require('kew');
var fs=require('fs-extra');
var config = new (require('v-conf'))();
var exec = require('child_process').exec;
var execSync = require('child_process').execSync;
var {
    BaseService,
    VolumeService,
    TrackService,
    AlbumService,
    EventBus,
    StateCache,
    FaderController,
    FaderMove,
    CustomLogger
} = require('./lib');

const io = require('socket.io-client');
const { stat } = require('fs');
const { get } = require('http');
const { info } = require('console');
const { create } = require('domain');

module.exports = motorizedFaderControl;

function motorizedFaderControl(context) {
    const self = this;

    this.context = context;
    this.commandRouter = this.context.coreCommand;
    this.configManager = this.context.configManager;
    this.config = config;

    this.logs = null;
    this.PLUGINSTR = 'motorized_fader_control';
    this.logger = this.createLogger(this.context.logger, 'motorized_fader_control', 'MAIN');

    this.faderController = null;
    this.eventBus = null;
    this.stateCache = null;
    this.services = null;

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

    this.boundVolumeHandler = this.handleVolumeUpdate.bind(this);
    this.volumeUpdateCallback = null;

};

//* START ################################################################################

motorizedFaderControl.prototype.onVolumioStart = function() {
    const self = this;

    var configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
    
    self.config = new (require('v-conf'))();
    self.config.loadFile(configFile);

    return libQ.resolve();
};

motorizedFaderControl.prototype.onStart = function() {
    const self = this;
    const defer = libQ.defer();

    try {
        // Initialize logs first
        self.initializeLogs();
        self.logger.info(`${self.logs.LOGS.SEPARATOR}`);
        self.logger.info(`${self.logs.LOGS.START.HEADER} ${packageInfo.name}...`);
        self.logger.info(`Version: ${packageInfo.version}`);
        self.logger.info(`Description: ${packageInfo.description}`);
        self.logger.info(`${self.logs.LOGS.SEPARATOR}`);

        // Initialize core components
        self.logger.info(`Initializing core components...`);
        const eventBusLogger = self.createLogger(self.context.logger, 'motorized_fader_control', 'EVENTBUS');
        self.eventBus = new EventBus(eventBusLogger, self.logs, self.PLUGINSTR);
        const stateCacheLogger = self.createLogger(self.context.logger, 'motorized_fader_control', 'STATECACHE');
        self.stateCache = new StateCache(stateCacheLogger, self.logs, self.PLUGINSTR);
        self.services = new Map();

        // Sequential startup procedure
        self.logger.info(`${self.logs.LOGS.START.SETUP}`);
        
        self.setupFaderController()
            .then(() => {
                self.logger.info(`${self.logs.LOGS.START.FADER_CONTROLLER}`);
                self.faderMoveAggregatorInitialize()
                return self.startFaderController();
            })
            .then(() => {
                self.logger.info(`Starting Event connections...`);
                // self.setupStateValidation();
                self.setupFaderCommandEvents();
                self.registerVolumeUpdateCallback();
                self.setupVolumioBridge();
                self.setupErrorHandling();
                self.logger.info(`Starting Services connections...`);
                self.setupServices();
                self.logger.info(`${self.logs.LOGS.START.SUCCESS}`);
                defer.resolve();
            })
            .catch(criticalError => {
                self.logger.error(criticalError.stack);
                defer.reject(new Error(`${self.logs.LOGS.START.ERROR}: ${error.message}}`));
            })
            .finally(() => {
                self.logger.info(`${self.logs.LOGS.SEPARATOR}`);
                self.logger.info(`${self.logs.LOGS.SEPARATOR}`);
            });
    } catch (criticalError) {
        self.logger.error(`Critical initialization error: ${criticalError.message}`);
        self.logger.error(criticalError.stack);
        defer.reject(new Error(`${self.logs.LOGS.ERRORS.CRITICAL_ERROR}: ${criticalError.message}`));
    }

    return defer.promise;
};

motorizedFaderControl.prototype.onStop = function() {
    const self = this;
    const defer = libQ.defer();

    self.logger.info(`${self.logs.LOGS.SEPARATOR}`);
    self.logger.info(`${self.logs.LOGS.STOP.HEADER}`);
    self.logger.info(`${self.logs.LOGS.SEPARATOR}`);

    self._stopServices()
        .then(() => {
            return self._stopFaderController();
        })
        .then(() => {
            self.logger.info(`${self.logs.LOGS.STOP.FADER_CONTROLLER}`);

            // Remove error handlers
            self.logger.info(`Removing error handlers...`);
            process.removeAllListeners('unhandledRejection');

            // Clear any remaining intervals or timeouts
            if (self.aggregationTimeout) {
                clearTimeout(self.aggregationTimeout);
                self.aggregationTimeout = null;
            }

            self.logger.info(`${self.logs.LOGS.STOP.SERVICES}`);
            self.logger.info(`${self.logs.LOGS.STOP.SUCCESS}`);
            self.logger.info(`${self.logs.LOGS.SEPARATOR}`);
            defer.resolve();
        })
        .catch(error => {
            self.logger.error(`${self.logs.LOGS.STOP.ERROR} ${error.message}`);
            defer.reject(error);
        });

    return defer.promise;
};

motorizedFaderControl.prototype.onRestart = function() {
    const self = this;
    var defer = libQ.defer();

    self.logger.info(`${self.logs.LOGS.SEPARATOR}`);
    self.logger.info(`${self.logs.LOGS.RESTART.HEADER}`);

    self.onStop()
        .then(() => {
            self.logger.info(`${self.logs.LOGS.RESTART.FADER_CONTROLLER}`);
            return self.onStart();
        })
        .then(() => {
            self.logger.info(`${self.logs.LOGS.RESTART.SERVICES}`);
            self.logger.info(`${self.logs.LOGS.RESTART.SUCCESS}`);
            self.logger.info(`${self.logs.LOGS.SEPARATOR}`);
            defer.resolve();
        })
        .fail(error => { // Change .catch() to .fail()
            self.logger.error(`${self.logs.LOGS.RESTART.ERROR} ${error.message}`);
            defer.reject(error);
        });

    return defer.promise;
};

motorizedFaderControl.prototype._stopFaderController = async function() {
    const self = this;

    try {
        if (!self.faderController) {
            self.logger.info(`Fader Controller not started, skipping stop`);
            return;
        }

        self.logger.info(`Stopping FaderController...`);

        try {
            await self.faderController.stop();
            self.logger.info(`Fader Controller stopped successfully`);
        } catch (stopError) {
            self.logger.error(`Error stopping FaderController: ${stopError.message}`);
            throw stopError; // Re-throw to propagate the error
        }

    } catch (error) {
        self.logger.error(`Error during FaderController stop process: ${error.message}`);

        // Attempt to close the serial connection as a fallback
        if (self.faderController) {
            try {
                await self.faderController.closeSerial();
                self.logger.warn(`Serial connection closed as part of fallback cleanup.`);
            } catch (closeError) {
                self.logger.error(`Error closing serial connection: ${closeError.message}`);
            }
        }

        // Re-throw the original error to propagate it
        throw error;
    }
};

motorizedFaderControl.prototype._stopServices = function() {
    const self = this;

    return new Promise((resolve, reject) => {
        try {
            // Disconnect from Volumio
            // volumioBridge sets most of these up
            if (self.socket) {
                self.socket.disconnect();
                self.socket = null;
            }
            // unregister volume
            self.unregisterVolumeUpdateCallback();

            // Clear event bus listeners
            if (self.eventBus) {
                self.eventBus.removeAllListeners();
                self.eventBus.clear();
                self.eventBus = null;
            }

            // Clear state cache
            if (self.stateCache) {
                self.stateCache.clear();
                self.stateCache = null;
            }
            // Clear services
            if (self.services) {
                self.services.forEach(service => service.stop());
              }

            resolve();
        } catch (error) {
            reject(error);
        }
    });
};

//* UI CONFIGURATION #####################################################################

motorizedFaderControl.prototype.getUIConfig = function() {
    const defer = libQ.defer();
    const self = this;
    const lang_code = self.commandRouter.sharedVars.get('language_code');
    
    self.logger.debug(`Getting UI Config for language code: ` + lang_code);

    // Load the UIConfig from specified i18n and UIConfig files
    self.commandRouter.i18nJson(
        __dirname + '/i18n/strings_' + lang_code + '.json',
        __dirname + '/i18n/strings_en.json',
        __dirname + '/UIConfig.json'
    )
    .then(uiconf => {
        self.logger.info(`Successfully loaded UIConfig.`);
        
        // Validate sections
        if (!uiconf.sections || uiconf.sections.length === 0) {
            const errorMsg = `UIConfig does not contain any sections.`;
            self.logger.error(errorMsg);
            defer.reject(new Error(errorMsg));
            return;
        }

        // Populate the UIConfig with values from the config
        uiconf.sections.forEach(section => {
            if (self.config.get('DEBUG_MODE', false)) { 
                self.logger.debug(`Processing section: ` + (section.label || 'Unnamed Section'));
            }
            if (section.content) {
                self.populateSectionContent(section.content);
                // Additional unpacking for fader settings
                if (section.id === "section_fader_behavior") {
                    if (self.config.get('DEBUG_MODE', false)) { 
                        self.logger.debug(`Unpacking fader config for section: ` + section.id);
                    }
                    self.unpackFaderConfig(section.content);
                }
            } else {
                self.logger.warn(`No content found in section: ` + (section.label || 'Unnamed Section'));
            }
        });

        defer.resolve(uiconf);
    })
    .fail(error => {
        const errorMsg = `Failed to parse UI Configuration page for plugin Motorized Fader Control: ` + error;
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
                self.logger.debug(`Set value for ${element.id}: ${JSON.stringify(element.value)}`);
            }
        } else {
            if (self.config.get('DEBUG_MODE', false)) { 
                self.logger.debug(`No value found in config for: ${element.id}`);
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
        const faderTrimMap = JSON.parse(self.config.get('FADER_TRIM_MAP')) || {};

        // Loop through each configured fader index
        for (let i = 0; i < 4; i++) { // Assuming a maximum of 4 faders
            // Check if the current fader index is configured
            if (faderIdxs.includes(i)) {
                const fader = faderBehavior.find(f => f.FADER_IDX === i) || { CONTROL_TYPE: "volume" };
                
                self.logger.debug(`Fader ${i} configuration: ${JSON.stringify(fader)}`);
                
                // Update configured status
                self.updateFaderElement(content, `FADER_${i}_CONFIGURED`, true);

                // Map CONTROL_TYPE to BEHAVIOR
                const controlType = fader.CONTROL_TYPE || "volume";
                self.updateFaderElement(content, `FADER_${i}_BEHAVIOR`, controlType);

                // Update FADER TRIM using the parsed faderTrimMap
                const faderTrim = faderTrimMap[i] || [0, 100];
                self.updateFaderElement(content, `FADER_${i}_TRIM`, faderTrim);

            } else {
                // If the fader is not configured, update its status accordingly
                self.updateFaderElement(content, `FADER_${i}_CONFIGURED`, false);
                self.updateFaderElement(content, `FADER_${i}_BEHAVIOR`, "volume"); // Default to volume
                self.updateFaderElement(content, `FADER_${i}_TRIM`, [0, 100]); // Default trim
            }
        }
    } catch (error) {
        const errorMsg = `Error unpacking fader configuration: ` + error;
        self.logger.error(errorMsg);
        throw new Error(errorMsg);
    }
};

motorizedFaderControl.prototype.updateFaderElement = function(content, elementId, value) {
    const self = this;
    const element = content.find(elem => elem.id === elementId);
    
    if (element) {
        if (elementId.includes("TRIM")) {
            element.config.bars[0].value = value; 
            self.logger.debug(`${elementId} updated to : ${JSON.stringify(element.config.bars[0].value)}`);
            return;
        } else {
            element.value = (typeof value === 'string') 
                ? { value: value, label: self.getLabelForSelect(element.options, value) }
                : value;
        }
        self.logger.debug(`${elementId} updated to : ${JSON.stringify(element.value)}`);
    } else {
        self.logger.warn(`${elementId} not found.`);
    }
};

motorizedFaderControl.prototype.getLabelForSelect = function(options, key) {
    const option = options.find(opt => opt.value === key);
    return option ? option.label : 'SELECT OPTION';
};

//* UIConfig Saving #####################################################################

motorizedFaderControl.prototype.saveFaderElement = async function(data) {
    const self = this;

    try {
        self.logger.info(`Saving fader elements: `);

        // Repack fader configuration
        self.repackAndSaveFaderBehaviorConfig(data);

        await self.onRestart();
        self.commandRouter.pushToastMessage('success', 'Fader elements saved and plugin restarted successfully.');
    } catch (error) {
        self.logger.error(`Error saving fader elements: ${error.message}`);
        throw error;
    }
};

motorizedFaderControl.prototype.repackAndSaveFaderBehaviorConfig = function(data) {
    const self = this;

    try {
        self.logger.debug(`Repacking fader configuration.`);

        let faderBehavior = [];
        let faderIdxs = [];
        let faderTrimMap = {};

        // Iterate over the fader data and repack the information
        for (let i = 0; i < 4; i++) {  // Assuming a maximum of 4 faders
            self.logger.debug(`Processing fader ${i}...`);
            // Log the raw data for this fader
            self.logger.debug(`Fader ${i} raw data: ${JSON.stringify({
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

            // Add fader behavior to the array
            faderBehavior.push({
                FADER_IDX: i,
                CONTROL_TYPE: faderBehaviorValue
            });
            
            // Add fader index to configured list if configured
            if (faderConfigured) {
                faderTrimMap[i] = faderTrim;
                faderIdxs.push(i);
                self.logger.debug(`Fader ${i} is configured.`);
            } else {
                self.logger.debug(`Fader ${i} is not configured.`);
            }

            if (self.config.get('DEBUG_MODE', false)) { 
                self.logger.debug(`Repacked Fader ${i} configuration: CONTROL_TYPE=${faderBehaviorValue}, CONFIGURED=${faderConfigured}, TRIM=${faderTrim}`);
            }
        }

        // Log the final fader behavior array
        self.logger.debug(`Final fader behavior array: ${JSON.stringify(faderBehavior)}`);

        // Log the final fader indexes array
        self.logger.debug(`Final fader indexes array: ${JSON.stringify(faderIdxs)}`);

        // Log the final fader trim map
        self.logger.debug(`Final fader trim map: ${JSON.stringify(faderTrimMap)}`);

        // Save the repacked configuration back to the config
        self.config.set('FADER_BEHAVIOR', JSON.stringify(faderBehavior));
        self.config.set('FADERS_IDXS', JSON.stringify(faderIdxs));
        self.config.set('FADER_TRIM_MAP', JSON.stringify(faderTrimMap));

        self.logger.debug(`Fader configuration saved successfully.`);
    } catch (error) {
        self.logger.error(`Error repacking fader configuration: ` + error.message);
        self.logger.error(`Stack trace: ` + error.stack);
        throw error;
    }
};

motorizedFaderControl.prototype.saveFaderControllerSettingsRestart = async function(data) {
    const self = this;
    self.logger.info(`Saving fader controller settings and restarting...`);

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
    await self.onRestart();
    self.logger.info(`Fader controller settings saved and restarted successfully`);
};

motorizedFaderControl.prototype.saveGeneralSettingsRestart = async function(data) {
    const self = this;
    self.logger.info(`Saving general settings and restarting plugin...`);

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
    await self.onRestart();
    self.logger.info(`Fader controller settings saved and restarted successfully`);
};

motorizedFaderControl.prototype.getConfigurationFiles = function() {
    return ['config.json'];
};

//* UI BUTTONS ACTIONS #####################################################################

motorizedFaderControl.prototype.RunManualCalibration = async function() {
    const self = this;

    try {
        // Run a full calibration
        const calibrationIndexes = JSON.parse(self.config.get('FADERS_IDXS', '[]'));

        if (!calibrationIndexes) {
            self.commandRouter.pushToastMessage('error', 'No fader configured.');
            return;
        }

        self.commandRouter.pushToastMessage('info', 'Starting Calibration');
        await self.faderController.advancedCalibration(calibrationIndexes);
       

        self.commandRouter.pushToastMessage('info', 'Finished Calibration');
        await self.onRestart()
    } catch (error) {
        self.logger.error(`Error during calibration: ${error.message}`);
        self.commandRouter.pushToastMessage('error', 'Calibration Failed', 'Please check logs for details.');
    }
};

//* logging: #####################################################################

motorizedFaderControl.prototype.setupLogLevel = function() {
    const self = this;

    // Ensure config and logger are initialized
    if (!self.config || !self.logger) {
        console.warn(`Config or Logger not initialized.`);
        return;
    }

    try {
        // Get log level from configuration, defaulting to 'info'
        self.log_level = self.config.get('LOG_LEVEL', 'info');
        
        // Cache the current log level and set the new one
        self.cacheLogLevel();
        self.setLogLevel(self.log_level);
    } catch (error) {
        self.logger.error(`Error setting up log level: ${error.message}`);
    }
};

motorizedFaderControl.prototype.setLogLevel = function(level) {
    const self = this;

    // Ensure logger exists and has at least one transport
    if (self.logger && self.logger.transports.length > 0) {
        // Change the log level for the first transport
        self.logger.transports[0].level = level;
        self.logger.info(`Log level changed to: ${level}`);
    } else {
        self.logger.error(`Logger or console transport not initialized properly.`);
    }
};

motorizedFaderControl.prototype.cacheLogLevel = function() {
    const self = this;

    // Ensure logger exists
    if (self.logger) {
        // Cache the current log level only once
        if (!self.cachedLogLevel) {
            self.cachedLogLevel = self.logger.transports[0].level;
        }
    } else {
        console.error(`Logger not initialized properly or no console transport found.`);
    }
};

motorizedFaderControl.prototype.getLogLevel = function() {
    const self = this;

    if (self.logger && self.logger.transports.length > 0) {
        const level = self.logger.transports[0].level;
        if (level) {
            return level;
        } else {
            self.logger.error(`Retrieved log level is invalid.`);
            return null;
        }
    } else {
        self.logger.error(`Logger or console transport not initialized properly.`);
        return null;
    }
};

motorizedFaderControl.prototype.getCachedLogLevel = function() {
    const self = this;

    if (self.cachedLogLevel) {
        self.logger.info(`Returning cached log level: ${self.cachedLogLevel}`);
        return self.cachedLogLevel;
    } else {
        self.logger.warn(`No cached log level found.`);
        return null;
    }
};

motorizedFaderControl.prototype.initializeLogs = function() {
    const self = this;

    // Set up log level (if needed)
    self.setupLogLevel();

    // Load log-specific i18n file (logs_en.json)
    try {
        self.logs = require(__dirname + '/i18n/logs_en.json');
        self.logger.info(`Log messages initialized successfully.`);
    } catch (error) {
        self.logger.error(`Failed to load log messages: ${error.message}`);
        throw error; // Stop plugin if logs cannot be loaded
    }
};

motorizedFaderControl.prototype.createLogger = function(logger, name = this.PLUGINSTR, subname = '') {
    return new CustomLogger(logger, name, subname);
};

//* ADAPTER LAYER #####################################################################

motorizedFaderControl.prototype.setupServices = function() {
    const self = this;

    try { 
        const faderBehavior = JSON.parse(this.config.get('FADER_BEHAVIOR')) || [];
        faderBehavior.forEach(({FADER_IDX, CONTROL_TYPE}) => {
            const ServiceClass = this.getServiceClass(CONTROL_TYPE);
            if (!ServiceClass) {
                self.logger.warn(`No service found for fader ${FADER_IDX} (control type: ${CONTROL_TYPE})`);
                return;
            }
            const serviceLogger = self.createLogger(self.context.logger, 'motorized_fader_control', `${CONTROL_TYPE}Service`);
            const service = new ServiceClass(
                FADER_IDX,
                self.eventBus,
                self.stateCache,
                self.config,
                serviceLogger,
                self.logs,
                self.PLUGINSTR
            );

            self.services.set(FADER_IDX, service);

            // Connect to fader events
            self.eventBus.on(`fader/${FADER_IDX}/move`, data => {
                service.handleMove(data);
            });

            self.eventBus.on(`fader/${FADER_IDX}/move/end`, data => {
                service.handleMoved(data);
                service.unblockUpdateInterval();
                service.unblockServiceHardwareUpdates();
            });

            self.eventBus.on(`fader/${FADER_IDX}/touch`, data => {
                service.handleTouch(data);
                service.blockUpdateInterval();
                service.blockServiceHardwareUpdates();
            });

            self.eventBus.on(`fader/${FADER_IDX}/untouch`, data => {
                // service.handleUntouch(data);
                service.unblockUpdateInterval();
                service.unblockServiceHardwareUpdates();
            });

            // Connect to state updates
            self.eventBus.on('validated/state', state => {
                service.handleStateUpdate(state);
            });

        });
    } catch (error) {
        self.logger.error(`${self.logs.LOGS.SETUP.SERVICES.ERROR}: ${error.message}`);
        throw error; // Rethrow the error
    }
};

motorizedFaderControl.prototype.getServiceClass = function(controlType) {
    return {
        volume: VolumeService,
        track: TrackService,
        album: AlbumService
    }[controlType];
};

//* Volumio Bridge #####################################################################

motorizedFaderControl.prototype.setupVolumioBridge = function () {
    const self = this;

    try {
        self.socket = io.connect(`http://${self.config.get('VOLUMIO_VOLUMIO_HOST')}:${self.config.get('VOLUMIO_VOLUMIO_PORT')}`, {
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000
        });

        self.logger.debug(`Connected to Volumio at ${self.config.get('VOLUMIO_VOLUMIO_HOST')}:${self.config.get('VOLUMIO_VOLUMIO_PORT')}`);

        // Unified State Handler

        const handleStateUpdate = (state) => {
            const validState = self.stateCache.cachePlaybackState(state);

            if (!validState) return;

            const statusEvents = {
                play: 'playback/playing',
                pause: 'playback/paused',
                stop: 'playback/stopped'
            };

            const event = statusEvents[validState.status];
            if (event) {
                self.eventBus.emit(event, state);
            }
        };

        // WebSocket Event Handling
        self.socket.on('pushState', handleStateUpdate);
        self.socket.on('pushQueue', queue => {
            self.stateCache.set('queue', 'current', queue);
        });

        self.eventBus.on('command/volumio/seek', (seekPosition) => {
            // wait on a state response from volumio, if the state is there we can assume the seek was successful
            const timeout = setTimeout(() => {
                self.logger.error(`Timeout while waiting for seek response.`);
                self.eventBus.emit('playback/seek/error', { message: 'Timeout while waiting for seek response.' });
            }
            , 1000); // 5-second timeout test this timeout
            self.socket.once('pushState', (state) => {
                clearTimeout(timeout);
                const validState = self.stateCache.cachePlaybackState(state);
                if (!validState) {
                    self.logger.error(`Invalid state received from Volumio.`);
                    self.eventBus.emit('playback/seek/error', { message: 'Invalid state received from Volumio.' });
                    return;
                }
                self.logger.debug(`Received state from Volumio: ${JSON.stringify(validState)}`);
                self.eventBus.emit('playback/seek', validState);
            }
            );
            // Emit the seek event to Volumio
            self.socket.emit('seek', seekPosition);
        });

        self.eventBus.on('command/volumio/getState', () => {
            const timeout = setTimeout(() => {
                self.logger.error(`Timeout while waiting for state response.`);
                self.eventBus.emit('playback/state/error', { message: 'Timeout while waiting for state response.' });
            }
            , 5000); // 5-second timeout
            self.socket.once('pushState', (state) => {
                clearTimeout(timeout);
                const validState = self.stateCache.cachePlaybackState(state);
                if (!validState) {
                    self.logger.error(`Invalid state received from Volumio.`);
                    self.eventBus.emit('playback/state/error', { message: 'Invalid state received from Volumio.' });
                    return;
                }
                self.logger.debug(`Received state from Volumio: ${JSON.stringify(validState)}`);
                self.eventBus.emit('playback/state', validState);
            }
            );
            self.socket.emit('getState');
        }
        );
        // Album Info Order Event
        self.eventBus.on('command/volumio/getAlbumInfo', (state) => {
            const timeout = setTimeout(() => {
                self.logger.error(`Timeout while waiting for album info response.`);
                self.eventBus.emit('album/info/error', { message: 'Timeout while waiting for album info response.' });
            }, 5000); // 5-second timeout

            self.socket.once('pushBrowseLibrary', (response) => {
                clearTimeout(timeout);

                if (response.navigation && response.navigation.info && response.navigation.info.uri === state.uri) {
                    const albumInfo = {
                        uri: response.navigation.info.uri,
                        album: response.navigation.info.album,
                        artist: response.navigation.info.artist,
                        service: response.navigation.info.service,
                        songs: response.navigation.lists[0]?.items.map(item => ({
                            title: item.title,
                            duration: item.duration,
                            uri: item.uri
                        })) || []
                    };
                    const stateWithAlbumInfo = { ...state, albumInfo };
                    self.eventBus.emit('album/info', stateWithAlbumInfo);
                } else {
                    self.logger.error(`Received unexpected response for album info.`);
                    self.eventBus.emit('album/info/error', { message: 'Unexpected response for album info.' });
                }
            });
            self.socket.emit('goTo', {type: 'album'})
        });

        //Queue Info Order Event
        self.eventBus.on('command/volumio/getQueueInfo', (state) => {
            const timeout = setTimeout(() => {
                self.logger.error(`Timeout while waiting for queue info response.`);
                self.eventBus.emit('queue/info/error', { message: 'Timeout while waiting for queue info response.' });
            }, 5000); // 5-second timeout

            self.socket.once('pushQueue', (response) => {
                clearTimeout(timeout);

                if (response.navigation && response.navigation.info && response.navigation.info.uri === state.uri) {
                    const queueInfo = {
                        uri: response.navigation.info.uri,
                        service: response.navigation.info.service,
                        items: response.navigation.lists[0]?.items || []
                    };
                    const stateWithQueueInfo = { ...state, queueInfo };
                    self.eventBus.emit('queue/info', stateWithQueueInfo);
                } else {
                    self.logger.error(`Received unexpected response for queue info.`);
                    self.eventBus.emit('queue/info/error', { message: 'Unexpected response for queue info.' });
                }
            });
            self.socket.emit('goTo', {type: 'queue'})
        });

        //Playlist Info Order Event

        // Initial state sync
        self.socket.emit('getState');
    } catch (error) {
        self.logger.error(`Error setting up Volumio bridge: ${error.message}`);
        throw error;
    }
};

motorizedFaderControl.prototype.unregisterVolumeUpdateCallback = function() {

    try {
        // Unregister the volume update callback
        if (this.volumeUpdateCallback) {
            this.commandRouter.volumioRemoveCallback('volumioupdatevolume', self.volumeUpdateCallback);
            this.volumeUpdateCallback = null;
        }
    } catch (error) {
        this.logger.error(`Error while unregistering volume update callback: ${error.message}`);
    }
};

motorizedFaderControl.prototype.registerVolumeUpdateCallback = function() {
    const self = this;
    try {
        // First remove any existing callback
        if (self.volumeUpdateCallback) {
            self.unregisterVolumeUpdateCallback();
        }
        
        // Register new callback
        self.volumeUpdateCallback = self.boundVolumeHandler;
        self.commandRouter.addCallback('volumioupdatevolume', self.volumeUpdateCallback);
        self.logger.info('Volume update callback registered successfully');
    } catch (error) {
        self.logger.error('Failed to register volume callback:', error);
        throw error;
    }
};

// State Validation Middleware //! deprecated, there is a validation in cachePlaybackState
//* avoid unnecesary state updates
motorizedFaderControl.prototype.setupStateValidation = function() {
    const self = this;

    this.eventBus.on('playback/update', state => {
        if (!this.validateState(state)) {
            self.logger.info('Invalid state update received:', state);
            return;
        }

        // Cache the validated state
        self.stateCache.set('playback', 'state', state);

        // Emit validated state
        self.eventBus.emit('validated/state', state);
    });
};

motorizedFaderControl.prototype.validateState = function(state) {
    const self = this;
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
                this.logger.debug(`validateState: Checking seek and duration: seek=${seek}, duration=${duration}`);

                // Check if seek is larger than duration
                if (seek > duration) {
                    this.logger.warn(`validateState: Invalid state: seek (${seek} ms) is larger than duration (${duration} ms)`);
                    return false;
                }
            }
            return true;
        }
    }
    return false; // Return false if state is invalid or status doesn't match
};

motorizedFaderControl.prototype.validatePlayingState = function(state) { //TODO integrate into the actual stateCache ? or services ?
    // checkPlayingState gives false negatives
    if (state && state.hasOwnProperty("status")) {
        const PlaybackStatus = state.status;
        if (PlaybackStatus === 'play') {
            return true;
        } else if (PlaybackStatus === 'pause' || PlaybackStatus === 'stop') {
            return false;
        }
    }
    return false;
};
  
// Unified Volume Handling
motorizedFaderControl.prototype.handleVolumeUpdate = async function(volumeData) {
    const self = this;
    // New state management
    self.stateCache.set('system', 'volume', {
        value: volumeData.vol,
        muted: volumeData.mute,
        updated: Date.now()
    });

    // New service-based update
    self.eventBus.emit('volume/update', volumeData.vol);
};

//* FADER LAYER ########################################################################

motorizedFaderControl.prototype.setupFaderCommandEvents = function() {
    const self = this;
    
    self.eventBus.on('command/fader/move', ({indexes, targets, speeds, resolution}) => {
        if (self.faderController) {
            // Create FaderMove instance before queuing
            const move = new FaderMove(indexes, targets, speeds, resolution);
            self.queueFaderMove(move);
        }
    });

    self.eventBus.on('command/fader/echo/off', (index) => {
        if (self.faderController) {
            self.faderController.setFaderEchoMode(index, false);
        }
    }
    );
    self.eventBus.on('command/fader/echo/on', (index) => {
        if (self.faderController) {
            self.faderController.setFaderEchoMode(index, true);
        }
    }
    );

};

//! maybe put the faderMoveAggrefator and faderMoveQueue in the faderController class
//* FADER MOVE AGGREGATPR #####################################################################

motorizedFaderControl.prototype.faderMoveAggregatorInitialize = function() {
    const self = this;
    self.faderMoveQueue = [];
    self.aggregationTimeout = null;
    self.aggregationDelay = Math.max(
        self.config.get('FADER_AGGREGATION_DELAY') || 0.001, 
        0.001 // Minimum 1ms delay
    ) * 1000; // Convert seconds to ms
    self.disableAggregation = self.config.get('DISABLE_FADER_AGGREGATION', false); // New setting
};

motorizedFaderControl.prototype.queueFaderMove = function(move) {
    const self = this;
    if (!(move instanceof FaderMove)) {
        self.logger.error(`Invalid move object queued`);
        return;
    }

    if (self.disableAggregation) {
        // If aggregation is disabled, send the move immediately
        self.logger.debug(`Aggregation disabled, sending move immediately: ${JSON.stringify(move)}`);
        self.faderController.moveFaders(move, false, false).catch(error => {
            self.logger.error(`Fader move rejected: ${error.message}`);
            self.eventBus.emit('fader/move/error', {
                error: error.message,
                move: move
            });
        });
        return;
    }

    self.faderMoveQueue.push({
        move,
        timestamp: Date.now()
    });

    if (!self.aggregationTimeout) {
        self.aggregationTimeout = setTimeout(() => {
            self.processFaderMoveQueue();
        }, self.aggregationDelay);
    }
};

motorizedFaderControl.prototype.processFaderMoveQueue = async function() {
    const self = this;
    if (self.faderMoveQueue.length === 0) return;

    try {
        const activeFaders = JSON.parse(self.config.get('FADERS_IDXS', '[]'));
        const faderData = new Map();

        // Process moves in order (newest last)
        self.faderMoveQueue.forEach(({move}) => {
            if (!(move instanceof FaderMove)) {
                self.logger.error(`Invalid move object in queue`);
                return;
            }

            // DEBUG: Log original move data
            self.logger.debug(`Original move data: ${JSON.stringify({
                indexes: move.indexes,
                targets: move.targets,
                speeds: move.speeds,
                resolution: move.resolution
            })}`);

            move.indexes.forEach((faderIndex, i) => {
                if (activeFaders.includes(faderIndex)) {
                    faderData.set(faderIndex, {
                        target: move.targets[i],
                        speed: move.speeds[i], // Ensure speed is preserved
                        resolution: move.resolution
                    });
                }
            });
        });

        // Build final move with proper speed values
        const indexes = Array.from(faderData.keys());
        const targets = indexes.map(i => faderData.get(i).target);
        const speeds = indexes.map(i => faderData.get(i).speed);
        const resolution = Math.max(...indexes.map(i => faderData.get(i).resolution));

        // DEBUG: Log before creating FaderMove
        self.logger.debug(`Creating FaderMove with: ${JSON.stringify({
            indexes,
            targets,
            speeds,
            resolution
        })}`);

        const finalMove = new FaderMove(indexes, targets, speeds, resolution);
        await self.faderController.moveFaders(finalMove, false).catch(error => {
            self.logger.error(`Fader move rejected: ${error.message}`);
            self.eventBus.emit('fader/move/error', {
                error: error.message,
                move: finalMove
            });
        });

    } catch (error) {
        self.logger.error(`Move processing failed: ${error.stack}`);
    } finally {
        self.faderMoveQueue = [];
        clearTimeout(self.aggregationTimeout);
        self.aggregationTimeout = null;
    }
};

//* FADERCONTROLLER #####################################################################

motorizedFaderControl.prototype.setupFaderController = function() {
    const self = this;
    self.logger.info(`Initializing FaderController...`);

    return new Promise(async (resolve, reject) => {
        try {
            const controllerConfig = {
                logger: self.createLogger(this.context.logger, 'motorized_fader_control', 'FaderController'),
                MIDILog: self.config.get('FADER_CONTROLLER_MIDI_LOG', false),
                ValueLog: self.config.get('FADER_CONTROLLER_VALUE_LOG', false),
                MoveLog: self.config.get('FADER_CONTROLLER_MOVE_LOG', false),
                messageDelay: self.config.get('FADER_CONTROLLER_MESSAGE_DELAY', 10),
                speeds: [
                    self.config.get('FADER_CONTROLLER_SPEED_HIGH', 100),
                    self.config.get('FADER_CONTROLLER_SPEED_MEDIUM', 50),
                    self.config.get('FADER_CONTROLLER_SPEED_LOW', 10)
                ],
                faderIndexes: JSON.parse(self.config.get('FADERS_IDXS', '[]')),
                MIDILog: self.config.get('FADER_CONTROLLER_MIDI_LOG', false),
                ValueLog: self.config.get('FADER_CONTROLLER_VALUE_LOG', false),
                MoveLog: self.config.get('FADER_CONTROLLER_MOVE_LOG', false),
                calibrateOnStart: self.config.get('FADER_CONTROLLER_CALIBRATION_ON_START', true),
                queueOverflow: self.config.get('FADER_CONTROLLER_QUEUE_OVERFLOW', 16383),
                feedback_midi: self.config.get('FADER_CONTROLLER_FEEDBACK_MIDI', true),
                feedback_tolerance: self.config.get('FADER_CONTROLLER_FEEDBACK_TOLERANCE', 10),
                calibrationConfig: {
                    startProgression: self.config.get('CALIBRATION_START_PROGRESSION', 0),
                    endProgression: self.config.get('CALIBRATION_END_PROGRESSION', 100),
                    calibrationCount: self.config.get('CALIBRATION_COUNT', 20),
                    startSpeed: self.config.get('CALIBRATION_START_SPEED', 10),
                    endSpeed: self.config.get('CALIBRATION_END_SPEED', 100),
                    resolutions: [1, 0.8, 0.5, 0.2], // Default resolutions
                    warmupRuns: self.config.get('CALIBRATION_WARMUP_RUNS', 1), // New warmup runs parameter
                    measureRuns: self.config.get('CALIBRATION_MEASURE_RUNS', 2) // New measure runs parameter
                },
                disableInternalEventLogging: self.config.get('DISABLE_INTERNAL_EVENT_LOGGING', false),
                disableEventLogging: self.config.get('DISABLE_EVENT_LOGGING', true)
            };

            if (!controllerConfig.faderIndexes?.length) {
                const errorMsg = 'No valid fader indexes configured';
                self.logger.warn(`${errorMsg}`);
                self.commandRouter.pushToastMessage('warning', 'Configuration Error', 'No faders enabled');
                return reject(new Error(errorMsg));
            }

            // Initialize controller with consolidated config
            self.faderController = new FaderController(controllerConfig);

            // Configure trims and speed factors
            await self._configurePackedFaderSettings(
                JSON.parse(self.config.get('FADER_TRIM_MAP', '{}')),
                JSON.parse(self.config.get('FADER_SPEED_FACTOR', '{}'))
            );
            if (self.config.get('DEBUG_MODE', false)) {
                self.faderController.logConfig()
            }

            // Initialize hardware connections
            self.setupFaderAdapter();

            resolve(true);
        } catch (error) {
            self.logger.error(`Controller setup failed: ${error.message}`);
            reject(error);
        }
    });
};

motorizedFaderControl.prototype._configurePackedFaderSettings = async function(trimMap, speedFactors) {
    const self = this;
    
    try {
        // Set progression maps using V2 API
        const trimPromises = Object.entries(trimMap).map(([index, range]) => 
            self.faderController.setFaderProgressionMap(parseInt(index), range)
        );
        await Promise.all(trimPromises);
        
        // Apply speed factors using V2 method
        Object.entries(speedFactors).forEach(([index, factor]) => {
            self.faderController.setFadersMovementSpeedFactor(
                parseInt(index), 
                parseFloat(factor)
            );
        });
    } catch (error) {
        self.logger.error(`Configuration error: ${error.message}`);
        throw error;
    }
};

motorizedFaderControl.prototype.startFaderController = async function() {
    const self = this;
    
    try {
        const serialConfig = {
            port: self.config.get("SERIAL_PORT"),
            baudRate: self.config.get("BAUD_RATE", 1000000),
            retries: 5 // Added retry capability from V2
        };

        // Use new setupSerial interface
        await self.faderController.setupSerial(serialConfig);
        
        // Start with calibration flag from config
        await self.faderController.start();
        
        self.logger.info(`FaderController started successfully`);

    } catch (error) {
        self.logger.error(`Startup failed: ${error.message}`);
        throw error;
    }
};

motorizedFaderControl.prototype.setupFaderAdapter = function() {
    const self = this;

    // Unified event handler factory
    const createEventHandler = (eventType) => (index, info) => {
        self.eventBus.emit(`fader/${index}/${eventType}`, {
            timestamp: Date.now(),
            state: {
                touched: eventType === 'touch'|| eventType === 'move',
                moving: eventType === 'move'
            },
            faderInfo: info
        });

        // Additional handling for touch release
        if (eventType === 'untouch') {
            // put this in the fader controller
            self.eventBus.emit(`fader/${index}/move/end`, {
                timestamp: Date.now(),
                state: {
                    touched: false,
                    moving: false
                },
                faderInfo: info
            });
        }
    };

    // Connect V2 controller events
    const eventMapping = {
        touch: createEventHandler('touch'),
        untouch: createEventHandler('untouch'),
        // move: createEventHandler('move'),
        // moveComplete: createEventHandler('move/complete'), // New event for move completion
        error: (error) => { //think this is done in event 
            self.eventBus.emit('FaderController/error', {
                message: error.message,
                code: error.code || 'UNKNOWN'
            });
        }
    };

    // Attach all event handlers
    Object.entries(eventMapping).forEach(([event, handler]) => {
        self.faderController.on(event, handler);
    });
};

//*  Add validation helper #####################################################################
motorizedFaderControl.prototype.validateFaderConfig = function(config) {
    return {
      ...config,
      faderIndexes: config.faderIndexes.filter(index => 
        Number.isInteger(index) && index >= 0 && index < 8
      ),
      speeds: config.speeds.map(s => 
        Math.min(Math.max(s, 0.1), 100)
      )
    };
  };

motorizedFaderControl.prototype.collectMetrics = function() {
    const self = this;
return {
    queueSize: self.faderMoveQueue.length,
    moveRate: self.metricsCounter.moves / 
    (Date.now() - self.startTime),
    errorRate: self.metricsCounter.errors /
    (Date.now() - self.startTime)
};
};

//* EVENT ERROR/WARNINGS #####################################################################

motorizedFaderControl.prototype.setupErrorHandling = function() {
    const self = this;

    // Fader Controller Errors:
    self.faderController.on('error', (error) => {
        self.logger.error(`FaderController error: ${error.message}`);
        if (error.details) {
            self.logger.error(`FaderController error details: ${JSON.stringify(error.details)}`);
        }

        // Check for the specific "Cannot lock port" error
        if (error.message.includes('Cannot lock port')) {
            self.logger.error('Critical error: Cannot lock port. Stopping plugin...');
            self.onStop(); // Stop the plugin gracefully
        }
    });

    // Global error handler for unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
        self.logger.error('Unhandled rejection at:', promise, 'reason:', reason);
        self.onStop(); // Attempt to stop the plugin gracefully
    });

    // Event bus error handling
    self.eventBus.on('error', (error) => {
        self.logger.error('EventBus error:', error);
    });

    // Service error handling
    self.services.forEach(service => {
        if (typeof service.onError === 'function') {
            service.onError(error => {
                self.logger.error(`Service ${service.constructor.name} error:`, error);
            });
        }
    });
};



