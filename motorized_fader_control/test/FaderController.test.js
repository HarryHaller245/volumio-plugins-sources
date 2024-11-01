const fs = require('fs');
const path = require('path');
const { FaderController, FaderMove } = require('../lib/FaderController');

// Load configuration
const configPath = 'config.json';
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// Access the flattened configuration values
const FADER_COUNT = config.FADER_CONTROLLER_FADER_COUNT.value;
const MESSAGE_DELAY = config.FADER_CONTROLLER_MESSAGE_DELAY.value;
const MIDI_LOG = config.FADER_CONTROLLER_MIDI_LOG.value;
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

    // Add a delay before starting the FaderController
    new Promise(resolve => setTimeout(resolve, 5000))
      .then(async () => {
        await faderController.start(CALIBRATION_ON_START);
        faderController.setFaderProgressionMapsTrimMap(TRIM_MAP);
        done();
      });
  });

  afterAll(async () => {
    // Stop the controller and close the serial port
    await faderController.stop();
    faderController.closeSerial();
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

  test('FaderController should perform a complete calibration with a time goal', async () => {
    const calibrationIndexes = [0, 1]; // Fader indexes to calibrate
    const START_PROGRESSION = config.CALIBRATION_START_PROGRESSION.value;
    const END_PROGRESSION = config.CALIBRATION_END_PROGRESSION.value;
    const COUNT = config.CALIBRATION_COUNT.value; // Consider memory management when high
    const START_SPEED = config.CALIBRATION_START_SPEED.value;
    const END_SPEED = config.CALIBRATION_END_SPEED.value;
    const TIME_GOAL = config.CALIBRATION_TIME_GOAL.value; // Time goal for 100% speed
    const TOLERANCE = config.CALIBRATION_TOLERANCE.value; // 10% tolerance
    const RUN_IN_PARALLEL = config.CALIBRATION_RUN_IN_PARALLEL.value;

    const results3 = await faderController.calibrate(calibrationIndexes, START_PROGRESSION, END_PROGRESSION, COUNT, START_SPEED, END_SPEED, TIME_GOAL, TOLERANCE, RUN_IN_PARALLEL);

    expect(results3).toBeDefined();
  }, 500000);
});