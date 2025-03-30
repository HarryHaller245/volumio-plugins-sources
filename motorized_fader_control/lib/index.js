// gather imports and export them
var { BaseService, VolumeService, TrackService, AlbumService } = require('./services');
const EventBus = require('./EventBus');
const StateCache = require('./StateCache');
const { FaderController, FaderMove} = require('./FaderControllerV2');
// const { FaderController, FaderMove} = require('./FaderController');

module.exports = {
  BaseService,
  VolumeService,
  TrackService,
  AlbumService,
  EventBus,
  StateCache,
  FaderController,
  FaderMove
};