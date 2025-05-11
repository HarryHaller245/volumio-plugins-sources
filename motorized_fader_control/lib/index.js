// gather imports and export them
var { BaseService, VolumeService, TrackService, AlbumService } = require('./services');
const EventBus = require('./EventBus');
const StateCache = require('./StateCache');
var { FaderController, FaderMove} = require('./FaderController');
const CustomLogger = require('./CustomLogger');

module.exports = {
  BaseService,
  VolumeService,
  TrackService,
  AlbumService,
  EventBus,
  StateCache,
  FaderController,
  FaderMove,
  CustomLogger
};