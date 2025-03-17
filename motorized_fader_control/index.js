'use strict';

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
    FaderMove
} = require('./lib');

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

};

//TODO: Implement and Use i18n logs_en.json: EXAMPLE: self.logger.info(`${self.PLUGINSTR}: ${self.logs.LOGS.START.HEADER}
//TODO: Add Logging to services and eventbus
//TODO: Remove additional LOGS. in logs_en.js and logs

//* START ################################################################################

motorizedFaderControl.prototype.onVolumioStart = function() {
    var self = this;

    var configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
    
    this.config = new (require('v-conf'))();
    this.config.loadFile(configFile);

    return libQ.resolve();
};

motorizedFaderControl.prototype.onStart = function() {
    const self = this;
    const defer = libQ.defer();

    try {
        // Initialize logs first
        self.initializeLogs();
        self.logger.info(`${self.PLUGINSTR}: ${self.logs.LOGS.SEPARATOR}`);
        self.logger.info(`${self.PLUGINSTR}: ${self.logs.LOGS.START.HEADER}`);
        self.logger.info(`${self.PLUGINSTR}: ${self.logs.LOGS.SEPARATOR}`);

        // Initialize core components
        self.logger.info(`${self.PLUGINSTR}: Initializing core components...`);
        self.eventBus = new EventBus(self.logger, self.logs, self.PLUGINSTR);
        self.stateCache = new StateCache(self.logger, self.logs, self.PLUGINSTR);
        self.services = new Map();

        // Sequential startup procedure
        self.logger.info(`${self.PLUGINSTR}: ${self.logs.LOGS.START.SETUP}`);
        
        self.setupFaderController()
            .then(() => {
                self.logger.info(`${self.PLUGINSTR}: ${self.logs.LOGS.START.FADER_CONTROLLER}`);
                self.faderMoveAggregatorInitialize()
                return self.startFaderController();
            })
            .then(() => {
                self.logger.info(`${self.PLUGINSTR}: Starting service connections...`);
                // self.setupStateValidation();
                self.setupVolumioBridge();
                self.setupServiceRouter();
                self.logger.info(`${self.PLUGINSTR}: ${self.logs.LOGS.START.SUCCESS}`);
                defer.resolve();
            })
            .catch(error => {
                self.logger.error(error.stack);
                defer.reject(new Error(`${self.logs.LOGS.START.ERROR}: ${error.message}}`));
            })
            .finally(() => {
                self.logger.info(`${self.PLUGINSTR}: ${self.logs.LOGS.SEPARATOR}`);
            });
    } catch (criticalError) {
        self.logger.error(`${self.PLUGINSTR}: Critical initialization error: ${criticalError.message}`);
        self.logger.error(criticalError.stack);
        defer.reject(new Error(`${self.logs.LOGS.ERRORS.CRITICAL_ERROR}: ${criticalError.message}`));
    }

    return defer.promise;
};

motorizedFaderControl.prototype.onStop = function() {
    var self = this;
    var defer = libQ.defer();
    self.logger.info(`${self.PLUGINSTR}: ${self.logs.LOGS.SEPARATOR}`);
    self.logger.info(`${self.PLUGINSTR}: ${self.logs.LOGS.STOP.HEADER}`);
    self.logger.info(`${self.PLUGINSTR}: ${self.logs.LOGS.SEPARATOR}`);

    self._stopFaderController()
        .then(() => {
            self.logger.info(`${self.PLUGINSTR}: ${self.logs.LOGS.STOP.FADER_CONTROLLER}`);
            return self._stopServices();
        })
        .then(() => {
            self.logger.info(`${self.PLUGINSTR}: ${self.logs.LOGS.STOP.SERVICES}`);
            self.logger.info(`${self.PLUGINSTR}: ${self.logs.LOGS.STOP.SUCCESS}`);
            self.logger.info(`${self.PLUGINSTR}: ${self.logs.LOGS.SEPARATOR}`);
            defer.resolve();
        })
        .catch(error => {
            self.logger.error(`${self.PLUGINSTR}: ${self.logs.LOGS.STOP.ERROR} ${error.message}`);
            defer.reject(error);
        });

    return defer.promise;
};

motorizedFaderControl.prototype.onRestart = function() {
    var self = this;
    var defer = libQ.defer();

    self.logger.info(`${self.PLUGINSTR}: ${self.logs.LOGS.SEPARATOR}`);
    self.logger.info(`${self.PLUGINSTR}: ${self.logs.LOGS.RESTART.HEADER}`);

    self.onStop()
        .then(() => {
            self.logger.info(`${self.PLUGINSTR}: ${self.logs.LOGS.RESTART.FADER_CONTROLLER}`);
            return self.onStart();
        })
        .then(() => {
            self.logger.info(`${self.PLUGINSTR}: ${self.logs.LOGS.RESTART.SERVICES}`);
            self.logger.info(`${self.PLUGINSTR}: ${self.logs.LOGS.RESTART.SUCCESS}`);
            self.logger.info(`${self.PLUGINSTR}: ${self.logs.LOGS.SEPARATOR}`);
            defer.resolve();
        })
        .fail(error => { // Change .catch() to .fail()
            self.logger.error(`${self.PLUGINSTR}: ${self.logs.LOGS.RESTART.ERROR} ${error.message}`);
            defer.reject(error);
        });

    return defer.promise;
};

motorizedFaderControl.prototype._stopFaderController = async function() {
    var self = this;

    try {
        if (self.faderController == null || self.faderController == false) {
            self.logger.info(`${self.PLUGINSTR}: Fader Controller not started, skipping stop`);
            return;
        }

        self.logger.info(`${self.PLUGINSTR}: Stopping FaderController...`);

        const stopPromise = self.faderController.stop().catch(error => {
            self.logger.error(`${self.PLUGINSTR}: Error stopping FaderController: ${error.message}`);
            throw error; // Re-throw to propagate the error
        });

        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => {
                reject(new Error(`${self.PLUGINSTR}: Fader Controller stop timed out after 10 seconds.`));
            }, 5000);
        });

        await Promise.race([stopPromise, timeoutPromise]);
        await self.faderController.closeSerial().catch(error => {
            self.logger.error(`${self.PLUGINSTR}: Error closing serial connection: ${error.message}`);
            throw error; // Re-throw to propagate the error
        });

        self.logger.info(`${self.PLUGINSTR}: Fader Controller stopped successfully`);
    } catch (error) {
        self.logger.error(`${self.PLUGINSTR}: Error stopping Fader Controller: ${error.message}`);
        if (self.faderController) {
            await self.faderController.closeSerial().catch(error => {
                self.logger.error(`${self.PLUGINSTR}: Error closing serial connection: ${error.message}`);
            });
            self.logger.warn(`${self.PLUGINSTR}: An error occurred trying to stop the FaderController. Forced closing serial connection.`);
        }
        throw error;
    }
};

motorizedFaderControl.prototype._stopServices = function() {
    var self = this;

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
    const lang_code = this.commandRouter.sharedVars.get('language_code');
    
    self.logger.debug(`${self.PLUGINSTR}: Getting UI Config for language code: ` + lang_code);

    // Load the UIConfig from specified i18n and UIConfig files
    self.commandRouter.i18nJson(
        __dirname + '/i18n/strings_' + lang_code + '.json',
        __dirname + '/i18n/strings_en.json',
        __dirname + '/UIConfig.json'
    )
    .then(uiconf => {
        self.logger.info(`${self.PLUGINSTR}: Successfully loaded UIConfig.`);
        
        // Validate sections
        if (!uiconf.sections || uiconf.sections.length === 0) {
            const errorMsg = `${self.PLUGINSTR}: UIConfig does not contain any sections.`;
            self.logger.error(errorMsg);
            defer.reject(new Error(errorMsg));
            return;
        }

        // Populate the UIConfig with values from the config
        uiconf.sections.forEach(section => {
            if (self.config.get('DEBUG_MODE', false)) { 
                self.logger.debug(`${self.PLUGINSTR}: Processing section: ` + (section.label || 'Unnamed Section'));
            }
            if (section.content) {
                self.populateSectionContent(section.content);
                // Additional unpacking for fader settings
                if (section.id === "section_fader_behavior") {
                    if (self.config.get('DEBUG_MODE', false)) { 
                        self.logger.debug(`${self.PLUGINSTR}: Unpacking fader config for section: ` + section.id);
                    }
                    self.unpackFaderConfig(section.content);
                }
            } else {
                self.logger.warn(`${self.PLUGINSTR}: No content found in section: ` + (section.label || 'Unnamed Section'));
            }
        });

        defer.resolve(uiconf);
    })
    .fail(error => {
        const errorMsg = `${self.PLUGINSTR}: Failed to parse UI Configuration page for plugin Motorized Fader Control: ` + error;
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
                self.logger.debug(`${self.PLUGINSTR}: Set value for ${element.id}: ${JSON.stringify(element.value)}`);
            }
        } else {
            if (self.config.get('DEBUG_MODE', false)) { 
                self.logger.debug(`${self.PLUGINSTR}: No value found in config for: ${element.id}`);
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
                
                self.logger.debug(`${self.PLUGINSTR}: Fader ${i} configuration: ${JSON.stringify(fader)}`);
                
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
        const errorMsg = `${self.PLUGINSTR}: Error unpacking fader configuration: ` + error;
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
            self.logger.debug(`${self.PLUGINSTR}: ${elementId} updated to : ${JSON.stringify(element.config.bars[0].value)}`);
            return;
        } else {
            element.value = (typeof value === 'string') 
                ? { value: value, label: self.getLabelForSelect(element.options, value) }
                : value;
        }
        self.logger.debug(`${self.PLUGINSTR}: ${elementId} updated to : ${JSON.stringify(element.value)}`);
    } else {
        self.logger.warn(`${self.PLUGINSTR}: ${elementId} not found.`);
    }
};

motorizedFaderControl.prototype.getLabelForSelect = function(options, key) {
    const option = options.find(opt => opt.value === key);
    return option ? option.label : 'SELECT OPTION';
};

//* UIConfig Saving #####################################################################

motorizedFaderControl.prototype.saveFaderElement = async function(data) {
    var self = this;

    try {
        self.logger.info(`${self.PLUGINSTR}: Saving fader elements: `);

        // Repack fader configuration
        self.repackAndSaveFaderBehaviorConfig(data);

        await self.onRestart();
        self.commandRouter.pushToastMessage('success', 'Fader elements saved and plugin restarted successfully.');
    } catch (error) {
        self.logger.error(`${self.PLUGINSTR}: Error saving fader elements: ${error.message}`);
        throw error;
    }
};

motorizedFaderControl.prototype.repackAndSaveFaderBehaviorConfig = function(data) {
    var self = this;

    try {
        self.logger.debug(`${self.PLUGINSTR}: Repacking fader configuration.`);

        let faderBehavior = [];
        let faderIdxs = [];
        let faderTrimMap = {};

        // Iterate over the fader data and repack the information
        for (let i = 0; i < 4; i++) {  // Assuming a maximum of 4 faders
            self.logger.debug(`${self.PLUGINSTR}: Processing fader ${i}...`);

            // Log the raw data for this fader
            self.logger.debug(`${self.PLUGINSTR}: Fader ${i} raw data: ${JSON.stringify({
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

            // Add fader trim to the trim map
            faderTrimMap[i] = faderTrim;

            // Add fader index to configured list if configured
            if (faderConfigured) {
                faderIdxs.push(i);
                self.logger.debug(`${self.PLUGINSTR}: Fader ${i} is configured.`);
            } else {
                self.logger.debug(`${self.PLUGINSTR}: Fader ${i} is not configured.`);
            }

            if (self.config.get('DEBUG_MODE', false)) { 
                self.logger.debug(`${self.PLUGINSTR}: Repacked Fader ${i} configuration: CONTROL_TYPE=${faderBehaviorValue}, CONFIGURED=${faderConfigured}, TRIM=${faderTrim}`);
            }
        }

        // Log the final fader behavior array
        self.logger.debug(`${self.PLUGINSTR}: Final fader behavior array: ${JSON.stringify(faderBehavior)}`);

        // Log the final fader indexes array
        self.logger.debug(`${self.PLUGINSTR}: Final fader indexes array: ${JSON.stringify(faderIdxs)}`);

        // Log the final fader trim map
        self.logger.debug(`${self.PLUGINSTR}: Final fader trim map: ${JSON.stringify(faderTrimMap)}`);

        // Save the repacked configuration back to the config
        self.config.set('FADER_BEHAVIOR', JSON.stringify(faderBehavior));
        self.config.set('FADERS_IDXS', JSON.stringify(faderIdxs));
        self.config.set('FADER_TRIM_MAP', JSON.stringify(faderTrimMap));

        self.logger.debug(`${self.PLUGINSTR}: Fader configuration saved successfully.`);
    } catch (error) {
        self.logger.error(`${self.PLUGINSTR}: Error repacking fader configuration: ` + error.message);
        self.logger.error(`${self.PLUGINSTR}: Stack trace: ` + error.stack);
        throw error;
    }
};

motorizedFaderControl.prototype.saveFaderControllerSettingsRestart = async function(data) {
    var self = this;
    self.logger.info(`${self.PLUGINSTR}: Saving fader controller settings and restarting...`);

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
    self.logger.info(`${self.PLUGINSTR}: Fader controller settings saved and restarted successfully`);
};

motorizedFaderControl.prototype.saveGeneralSettingsRestart = async function(data) {
    var self = this;
    self.logger.info(`${self.PLUGINSTR}: Saving general settings and restarting plugin...`);

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
    self.logger.info(`${self.PLUGINSTR}: Fader controller settings saved and restarted successfully`);
};

motorizedFaderControl.prototype.getConfigurationFiles = function() {
    return ['config.json'];
};

//* UI BUTTONS ACTIONS #####################################################################

motorizedFaderControl.prototype.RunManualCalibration = async function() { //! propably deprecated or not really needed OR wanted
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
        self.logger.error(`${self.PLUGINSTR}: Error during calibration: ${error.message}`);
        self.commandRouter.pushToastMessage('error', 'Calibration Failed', 'Please check logs for details.');
    }
};

//* logging: #####################################################################

motorizedFaderControl.prototype.setupLogLevel = function() {
    var self = this;

    // Ensure config and logger are initialized
    if (!self.config || !self.logger) {
        console.warn(`${self.PLUGINSTR}: Config or Logger not initialized.`);
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
        self.logger.warn(`${self.PLUGINSTR}: Error setting up log level: ${error.message}`);
    }
};

motorizedFaderControl.prototype.setLogLevel = function(level) {
    var self = this;

    // Ensure logger exists and has at least one transport
    if (self.logger && self.logger.transports.length > 0) {
        // Change the log level for the first transport
        self.logger.transports[0].level = level;
        self.logger.info(`${self.PLUGINSTR}: Log level changed to: ${level}`);
    } else {
        self.logger.error(`${self.PLUGINSTR}: Logger or console transport not initialized properly.`);
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
        console.error(`${self.PLUGINSTR}: Logger not initialized properly or no console transport found.`);
    }
};

motorizedFaderControl.prototype.getLogLevel = function() {
    var self = this;

    if (self.logger && self.logger.transports.length > 0) {
        const level = self.logger.transports[0].level;
        if (level) {
            return level;
        } else {
            self.logger.error(`${self.PLUGINSTR}: Retrieved log level is invalid.`);
            return null;
        }
    } else {
        self.logger.error(`${self.PLUGINSTR}: Logger or console transport not initialized properly.`);
        return null;
    }
};

motorizedFaderControl.prototype.getCachedLogLevel = function() {
    var self = this;

    if (self.cachedLogLevel) {
        self.logger.info(`${self.PLUGINSTR}: Returning cached log level: ${self.cachedLogLevel}`);
        return self.cachedLogLevel;
    } else {
        self.logger.warn(`${self.PLUGINSTR}: No cached log level found.`);
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
    const self = this;

    try { 
        const faderBehavior = JSON.parse(this.config.get('FADER_BEHAVIOR')) || [];
        faderBehavior.forEach(({FADER_IDX, CONTROL_TYPE}) => {
            const ServiceClass = this.getServiceClass(CONTROL_TYPE);
            if (!ServiceClass) {
                self.logger.warn(`No service found for fader ${FADER_IDX} (control type: ${CONTROL_TYPE})`);
                return;
            }

            const service = new ServiceClass(
                FADER_IDX,
                this.eventBus,
                this.stateCache,
                this.config,
                this.logger,
                this.logs,
                this.PLUGINSTR
            );

            this.services.set(FADER_IDX, service);

            // Connect to fader events
            this.eventBus.on(`fader/${FADER_IDX}/move`, position => {
                if (this.isSeeking) return;
                service.handleMove(position);
            });

            // Connect to state updates
            this.eventBus.on('validated/state', state => {
                service.handleStateUpdate(state);
            });
        });
    } catch (error) {
        self.logger.error(`${self.PLUGINSTR}: ${self.logs.LOGS.SETUP.SERVICES.ERROR}: ${error.message}`);
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

motorizedFaderControl.prototype.setupVolumioBridge = function() { //! add error handling, if volumio websocket doesnt connect its a critical fail
    const self = this;

    try {
        self.socket = io.connect(`http://${self.config.get('VOLUMIO_VOLUMIO_HOST')}:${self.config.get('VOLUMIO_VOLUMIO_PORT')}`, {
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000
        });

        // Log connection
        self.logger.debug(`${self.PLUGINSTR}: Connected to Volumio at ${self.config.get('VOLUMIO_VOLUMIO_HOST')}:${self.config.get('VOLUMIO_VOLUMIO_PORT')}`);

        // Emit a getState on connect
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
            self.cachedQueue = queue;
            self.stateCache.set('queue', 'current', queue);
        });

        // Automatic Reconnect Handling
        self.socket.on('reconnect', () => {
            self.logger.info('WebSocket reconnected, resyncing state...');
            self.socket.emit('getState');
            self.socket.emit('getQueue');
        });

        // Command Proxy
        self.eventBus.on('command/*', (command, ...args) => {
            const method = command.split('/')[1];
            if (typeof self.socket.emit[method] === 'function') {
                self.socket.emit(method, ...args);
            }
        });

        // Store the callback function in a variable
        self.volumeUpdateCallback = (volumeData) => {
            self.eventBus.emit('volume/update', volumeData);
        };

        // Register the callback
        self.commandRouter.addCallback('volumioupdatevolume', self.volumeUpdateCallback);

        // Initial state sync
        self.socket.emit('getState');
    } catch (error) {
        self.logger.error(`${self.PLUGINSTR}: Error setting up Volumio bridge: ${error.message}`);
        throw error; // Propagate the error
    }
};

motorizedFaderControl.prototype.unregisterVolumeUpdateCallback = function() {
    var self = this;

    // Check if the callback exists
    if (self.volumeUpdateCallback) {
        const callbacks = self.commandRouter.callbacks['volumioupdatevolume'];
        if (callbacks) {
            const oldCount = callbacks.length;
            self.logger.debug(`[motorized_fader_control]: Removing Volumio callbacks for 'volumioupdatevolume'. Current count: ${oldCount}`);
            
            // Filter out the callback
            self.commandRouter.callbacks['volumioupdatevolume'] = callbacks.filter((listener) => listener !== self.volumeUpdateCallback);
            const newCount = self.commandRouter.callbacks['volumioupdatevolume'].length;
            self.logger.debug(`[motorized_fader_control]: Removed ${oldCount - newCount} Volumio callbacks for 'volumioupdatevolume'.`);
        }
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
                this.logger.debug(`${self.PLUGINSTR}: validateState: Checking seek and duration: seek=${seek}, duration=${duration}`);

                // Check if seek is larger than duration
                if (seek > duration) {
                    this.logger.warn(`${self.PLUGINSTR}: validateState: Invalid state: seek (${seek} ms) is larger than duration (${duration} ms)`);
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

motorizedFaderControl.prototype.setupFaderFeedback = function() {
    const self = this;
    
    this.eventBus.on('fader/update', ({indexes, targets, speeds}) => {
        if (this.faderController) {
            // Create FaderMove instance before queuing
            const move = new FaderMove(indexes, targets, speeds);
            this.queueFaderMove(move);
        }
    });
};

motorizedFaderControl.prototype.faderMoveAggregatorInitialize = function() {
    this.faderMoveQueue = [];
    this.aggregationTimeout = null;
    this.aggregationDelay = Math.max(
        this.config.get('FADER_CONTROLLER_MESSAGE_DELAY') || 0.001, 
        0.001 // Minimum 1ms delay
    ) * 1000; // Convert seconds to ms
};

motorizedFaderControl.prototype.queueFaderMove = function(move) {
    if (!(move instanceof FaderMove)) {
        this.logger.error('Invalid move object queued');
        return;
    }
    
    this.faderMoveQueue.push({
        move,
        timestamp: Date.now()
    });
    
    if (!this.aggregationTimeout) {
        this.aggregationTimeout = setTimeout(() => {
            this.processFaderMoveQueue();
        }, this.aggregationDelay);
    }
};

motorizedFaderControl.prototype.processFaderMoveQueue = function() {
    if (this.faderMoveQueue.length === 0) return;

    try {
        const activeFaders = JSON.parse(this.config.get('FADERS_IDXS', '[]'));
        const latestMoves = new Map();

        // Process moves in reverse to prioritize newer commands
        [...this.faderMoveQueue].reverse().forEach(({ move }) => {
            move.idx.forEach((faderIndex, i) => {
                if (activeFaders.includes(faderIndex) && !latestMoves.has(faderIndex)) {
                    latestMoves.set(faderIndex, {
                        target: move.target[i],
                        speed: move.speed[i]
                    });
                }
            });
        });

        // Build final move
        const indexes = Array.from(latestMoves.keys());
        const targets = indexes.map(idx => latestMoves.get(idx).target);
        const speeds = indexes.map(idx => latestMoves.get(idx).speed);
        
        if (indexes.length > 0) {
            const finalMove = new FaderMove(indexes, targets, speeds);
            this.faderController.moveFaders(finalMove, true);
            
            if (this.config.get('DEBUG_MODE')) {
                this.logger.debug(`${this.PLUGINSTR}: Sent latest moves for faders ${indexes}`);
            }
        }
    } catch (error) {
        this.logger.error(`${this.PLUGINSTR}: Move processing failed: ${error}`);
    } finally {
        this.faderMoveQueue = [];
        clearTimeout(this.aggregationTimeout);
        this.aggregationTimeout = null;
    }
};

//* FADERCONTROLLER #####################################################################

motorizedFaderControl.prototype.setupFaderController = function() {
    var self = this;
    self.logger.info('${self.PLUGINSTR}: Setting up FaderController...');

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
                self.logger.warn(`${self.PLUGINSTR}: Fader indexes not set. Please enable at least one Fader.`);
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
                //log this
                self.logger.debug(`${self.PLUGINSTR}: Fader trims set successfully: ${JSON.stringify(trimMap)}`);
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
                self.logger.debug(`${self.PLUGINSTR}: Fader speed factors set successfully.`);
            } catch (error) {
                self.logger.error(`${self.PLUGINSTR}: Failed to parse FADER_SPEED_FACTOR config: ${error.message}`);
            }

            // New adapter connection
            this.setupFaderAdapter();
            this.setupFaderFeedback();

            resolve(true); // Resolve the promise on successful setup
        } catch (error) {
            self.logger.error(`${self.PLUGINSTR}: Error setting up FaderController: ` + error.message);
            reject(error); // Reject the promise on failure
        }
    });
};

motorizedFaderControl.prototype.startFaderController = async function() {
    var self = this;

    try {
        const serialPort = self.config.get("SERIAL_PORT");
        const baudRate = self.config.get("BAUD_RATE");
        const calibrationOnStart = self.config.get("FADER_CONTROLLER_CALIBRATION_ON_START", true);

        await self.faderController.setupSerial(serialPort, baudRate).catch(error => {
            self.logger.error(`${self.PLUGINSTR}: Error setting up serial connection: ` + error.message);
            throw error; // Re-throw to propagate the error
        });
        await self.faderController.start(calibrationOnStart).catch(error => {
            self.logger.error(`${self.PLUGINSTR}: Error starting FaderController: ` + error.message);
            throw error; // Re-throw to propagate the error
        });

        // old: self.setupFaderControllerTouchCallbacks();
    } catch (error) {
        self.logger.error(`${self.PLUGINSTR}: Error starting Fader Controller: ` + error.message);
        throw error;
    }
};
// Modified adapter setup
motorizedFaderControl.prototype.setupFaderAdapter = function() {
    // Assuming FaderController emits 'move' events
    this.faderController.on('touch', (faderIdx, faderInfo) => {
        this.eventBus.emit(`fader/${faderIdx}/touch`, {
        fader: faderInfo,
        timestamp: Date.now()
        });
        //fader is touch changed to touched
    });

    this.faderController.on('untouch', (faderIdx, faderInfo) => {
        this.eventBus.emit(`fader/${faderIdx}/untouch`, {
        fader: faderInfo,
        timestamp: Date.now()
        });
        // indicates a finished move when touch & move was emitted before
    });

    this.faderController.on('move', (faderIdx, faderInfo) => {
        this.eventBus.emit(`fader/${faderIdx}/move`, {
        fader: faderInfo,
        timestamp: Date.now()
        });
    });
};

//* EVENT ERROR/WARNINGS

motorizedFaderControl.prototype.setupErrorHandling = function() {
    const self = this;

    // Global error handler
    process.on('unhandledRejection', (error) => {
        self.logger.error('Unhandled rejection:', error);
    });

    // Event bus error handling
    this.eventBus.on('error', (error) => {
        self.logger.error('Event bus error:', error);
    });

    // Service error handling
    this.services.forEach(service => {
        if (typeof service.onError === 'function') {
            service.onError(error => {
                self.logger.error(`Service ${service.constructor.name} error:`, error);
            });
        }
    });
};

