const fs = require('fs');
const path = require('path');
const { FaderController, FaderMove } = require('../lib/FaderController');

// Load configuration
const configPath = 'config.json';
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// Access the flattened configuration values
const FADER_COUNT = config.FADER_CONTROLLER_FADER_COUNT.value;
const MESSAGE_DELAY = config.FADER_CONTROLLER_MESSAGE_DELAY.value;
const MIDI_LOG = true;
const VALUE_LOG = config.FADER_CONTROLLER_VALUE_LOG.value;
const MOVE_LOG = config.FADER_CONTROLLER_MOVE_LOG.value;
const CALIBRATION_ON_START = config.FADER_CONTROLLER_CALIBRATION_ON_START.value;
const SPEEDS = [config.FADER_CONTROLLER_SPEED_HIGH.value, config.FADER_CONTROLLER_SPEED_MEDIUM.value, config.FADER_CONTROLLER_SPEED_LOW.value];
const TRIM_MAP = JSON.parse(config.FADER_TRIM_MAP.value);
const FADER_IDXS = [0,1]
jest.setTimeout(config.TEST_JEST_TIMEOUT.value);

describe('FaderController', () => {
  let faderController;

  beforeAll(done => {
    faderController = new FaderController(undefined, MESSAGE_DELAY, MIDI_LOG, SPEEDS, VALUE_LOG, MOVE_LOG, true, FADER_IDXS);
    faderController.setupSerial(
      config.SERIAL_PORT.value,
      config.BAUD_RATE.value
    );

    new Promise(resolve => setTimeout(resolve, 5000))
      .then(async () => {
        await faderController.start(CALIBRATION_ON_START);
        faderController.setFaderProgressionMapsTrimMap(TRIM_MAP);
        done();
      })
      .catch(err => {
        console.error('Setup error:', err);
        done(err); // Ensures Jest proceeds to teardown on error
      });
  });

  afterAll(async () => {
    try {
      await faderController.stop();
    } catch (stopErr) {
      console.error('Error stopping controller:', stopErr);
    }
    try {
      await faderController.closeSerial(); // Ensure this is awaited
    } catch (closeErr) {
      console.error('Error closing serial port:', closeErr);
    }
  });
  test('FaderController should be defined', () => {
    expect(faderController).toBeDefined();
  });

  test('FaderController should move faders to a position', async () => {
    const indexes = [0, 1];
    const target = [50, 20];

    const moveA = new FaderMove(indexes, target, [10, 100]);
    await faderController.moveFaders(moveA, false);
    expect(faderController.getFaderProgressions(indexes)).toEqual([target, target]); // May need adjustments based on trim mapping
  }, 500000);

  test('FaderController should enable echo mode for 30 seconds', async () => {
    const indexes = [0,1];
    await faderController.set_echoMode(indexes, true);
    
    // Wait for 30 seconds
    await new Promise(resolve => setTimeout(resolve, 20000));
    
    const FaderInfo = faderController.getFadersInfo(indexes);
    expect(FaderInfo[0].echo_mode).toBe(true);
}, 50000);
});