'use strict';

var libQ = require('kew');
var fs = require('fs-extra');
var config = new (require('v-conf'))();
var exec = require('child_process').exec;
var execSync = require('child_process').execSync;
const { FaderController, FaderMove } = require('../lib/FaderController');

module.exports = motorizedFaderControl;

function motorizedFaderControl(context) {
    var self = this;

    this.context = context;
    this.commandRouter = this.context.coreCommand;
    this.logger = this.context.logger;
    this.configManager = this.context.configManager;

    // Initialize FaderController
    this.faderController = null;

	//caches
}

const { FaderController, FaderMove } = require('../lib/FaderController');

// Use fader and midiParser in your plugin

//start function


//stop function





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

    // connect to websocket ?
    // connect onPushState callbacks ?
    // Initialize FaderController with configurations

    return defer.promise;
};

motorizedFaderControl.prototype.onStop = function() {
    var self = this;
    var defer = libQ.defer();

    // Stop FaderController
    self.faderController.stop().then(() => {
        self.faderController.closeSerial();
        defer.resolve();
    });

    return defer.promise;
};

motorizedFaderControl.prototype.onRestart = function() {
    var self = this;
    // Optional, use if you need it
};

// Configuration Methods -----------------------------------------------------------------------------

motorizedFaderControl.prototype.getUIConfig = function() {
    var defer = libQ.defer();
    var self = this;

    var lang_code = this.commandRouter.sharedVars.get('language_code');

    self.commandRouter.i18nJson(__dirname + '/i18n/strings_' + lang_code + '.json',
        __dirname + '/i18n/strings_en.json',
        __dirname + '/UIConfig.json')
        .then(function(uiconf) {
            defer.resolve(uiconf);
        })
        .fail(function() {
            defer.reject(new Error());
        });

    return defer.promise;
};

motorizedFaderControl.prototype.getConfigurationFiles = function() {
    return ['config.json'];
}

motorizedFaderControl.prototype.setUIConfig = function(data) {
    var self = this;
    // Perform your installation tasks here
};

motorizedFaderControl.prototype.getConf = function(varName) {
    var self = this;
    // Perform your installation tasks here
};

motorizedFaderControl.prototype.setConf = function(varName, varValue) {
    var self = this;
    // Perform your installation tasks here
};

// Playback Controls ---------------------------------------------------------------------------------------

motorizedFaderControl.prototype.clearAddPlayTrack = function(track) {
    var self = this;
    self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'motorizedFaderControl::clearAddPlayTrack');

    self.commandRouter.logger.info(JSON.stringify(track));

    return self.sendSpopCommand('uplay', [track.uri]);
};

motorizedFaderControl.prototype.seek = function(timepos) {
    this.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'motorizedFaderControl::seek to ' + timepos);

    return this.sendSpopCommand('seek ' + timepos, []);
};

// Stop
motorizedFaderControl.prototype.stop = function() {
    var self = this;
    self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'motorizedFaderControl::stop');
    // Add fader stop logic here
};

// Spop pause
motorizedFaderControl.prototype.pause = function() {
    var self = this;
    self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'motorizedFaderControl::pause');
    // Add fader pause logic here
};

// Get state
motorizedFaderControl.prototype.getState = function() {
    var self = this;
    self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'motorizedFaderControl::getState');
    
};

//Parse state
motorizedFaderControl.prototype.parseState = function(State) {
    var self = this;
    self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'motorizedFaderControl::parseState');
    // Use this method to parse the state and eventually send it with the following function
};

// Announce updated State
motorizedFaderControl.prototype.pushState = function(state) {
    var self = this;
    self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'motorizedFaderControl::pushState');

    return self.commandRouter.servicePushState(state, self.servicename);
};

// Event Handling ---------------------------------------------------------------------------------------

motorizedFaderControl.prototype.onPlay = function() {
    var self = this;
    self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'motorizedFaderControl::onPlay');
    // Add logic to handle fader movements on play
};

motorizedFaderControl.prototype.onPause = function() {
    var self = this;
    self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'motorizedFaderControl::onPause');
    // Add logic to handle fader movements on pause
};

motorizedFaderControl.prototype.onStop = function() {
    var self = this;
    self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'motorizedFaderControl::onStop');
    // Add logic to handle fader movements on stop
};

motorizedFaderControl.prototype.onSeek = function(timepos) {
    var self = this;
    self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'motorizedFaderControl::onSeek to ' + timepos);
    // Add logic to handle fader movements on seek
};

motorizedFaderControl.prototype.onTrackChanged = function(track) {
    var self = this;
    self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'motorizedFaderControl::onTrackChanged');
    // Add logic to handle fader movements on track change
};




// Fader Playback Controls ---------------------------------------------------------------------------------------

motorizedFaderControl.prototype.getVolumioState = function() {
    var self = this;
    self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'motorizedFaderControl::getVolumioState');
};


/**
 * Handles the playback trace to determine the correct fader position based on the current playback state.
 *
 * This method uses the playback state to calculate the target fader progression. It logs the state and calculates
 * the target progression based on the current seek position and the total duration of the track.
 *
 * @param {Object} state - The current playback state object.
 * @param {number} state.seek - The current seek position in milliseconds.
 * @param {number} state.duration - The total duration of the track in seconds.
 * @returns {number} The target fader progression as a percentage (0-100).
 */
motorizedFaderControl.prototype.getPlaybackTrace = function(state) {
    var self = this;
    self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'motorizedFaderControl::getPlaybackTrace');

    try {
        const currentSeek = state.seek; // Current seek position in milliseconds
        const totalDurationMs = state.duration * 1000; // Convert duration from seconds to milliseconds

        const targetProgression = (currentSeek / totalDurationMs) * 100;
        return targetProgression; // This can easily be a float
    } catch (e) {
        self.commandRouter.logger.error(e);
        return 0; // Return a default value in case of error
    }
};

motorizedFaderControl.prototype.getPlaybackTraceAlbum = function(state) {
	//advanced version of the getPlaybackTrace method
	//this will try to get the current track progression based on the album progression
	var self = this;
	self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'motorizedFaderControl::handlePlaybackTrace');
	// add logic to handle fader movements on playback TRACE:
	// we use the state to determine the correct fader position.
	//calculate the progression based on the current seek in the current track in the total playlist duration


};


motorizedFaderControl.prototype.getPlaybackTracePlaylist = function(state) {
	//advanced version of the getPlaybackTrace method
	//this will try to get the current track progression based on the playlist progression
	var self = this;
	self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'motorizedFaderControl::handlePlaybackTrace');
	//this will be a bit more difficult
	//calculate the progression based on the current seek in the current track in the total playlist duration
	
};

motorizedFaderControl.prototype.getPlaybackTraceRadio = function(state) {
	//advanced version of the getPlaybackTrace method
	//this will try to get the current track progression based on the radio progression
	var self = this;
	self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'motorizedFaderControl::handlePlaybackTrace');
	//dont know if possible, radio does not have an end time
};

motorizedFaderControl.prototype.getPlaybackTraceQueue = function(state) {
	//advanced version of the getPlaybackTrace method
	//this will try to get the current track progression based on the queue progression
	var self = this;
	self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'motorizedFaderControl::handlePlaybackTrace');
	//get the complete queue duration
	//calculate the progression based on the current seek in the current track in the total queue duration
};





// FADER Touch Callbacks
// These methods are called when a fader is touched or released.
motorizedFaderControl.prototype.onFaderTouch = function(faderIndex) {
    var self = this;
    self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'motorizedFadezrControl::onFaderTouch');
    // Handle fader touch logic here
};

motorizedFaderControl.prototype.onFaderRelease = function(faderIndex) {
    var self = this;
    self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'motorizedFaderControl::onFaderRelease');
    // Handle fader release logic here
};
