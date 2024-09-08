const fs = require('fs');
const path = require('path');
const { FaderController, FaderMove } = require('../lib/FaderController');

// Load configuration
const configPath = 'config.json';
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const fader_count = config.faderSettings.faderCount;
const messageDelay = config.faderSettings.messageDelay;
const MIDILog = config.faderSettings.MIDILog;
const ValueLog = config.faderSettings.ValueLog;
const MoveLog = config.faderSettings.MoveLog;
const CalibrationOnStartParam = config.faderSettings.CalibrationOnStart;
const speeds = [config.faderSettings.speeds.high, config.faderSettings.speeds.medium, config.faderSettings.speeds.low];
const TrimMap = config.faderSettings.trimMap;

jest.setTimeout(config.testSettings.jestTimeout);

describe('FaderController', () => {
  let faderController;

  beforeAll(done => {
    faderController = new FaderController(undefined, fader_count, messageDelay, MIDILog, speeds, ValueLog, MoveLog);
    faderController.setupSerial(config.serialSettings.port, config.serialSettings.baudRate);

    // Add a delay before starting the FaderController
    new Promise(resolve => setTimeout(resolve, 5000))
      .then(async () => {
        await faderController.start(CalibrationOnStartParam);
        faderController.setFaderProgressionMap(undefined, TrimMap);
        done();
      });
  });

  afterAll(async () => {
    // Then stop the controller
    await faderController.stop();
    faderController.closeSerial();
  });

  test('FaderController should be defined', () => {
    expect(faderController).toBeDefined();
  });

  test('FaderController should move faders to a position', async () => {
    const indexes = [0, 1];
    const progression = 50;

    const moveA = new FaderMove(indexes, progression, 50);
    await faderController.moveFaders(moveA, false);
    expect(faderController.getFaderProgressions(indexes)).toEqual([progression, progression]); // i might get an error here due to the trim mapping functionality
  }, 500000);

  test('FaderController should perform a complete calibration with a time goal', async () => {
    const calibrationindexes = [0,1]; //fader indexes to clibrate
    const startProgression = config.calibrationSettings.startProgression;
    const endProgression = config.calibrationSettings.endProgression;
    const count = config.calibrationSettings.count; // this creates memory problems when high, better do one per fader
    const startSpeed = config.calibrationSettings.startSpeed;
    const endSpeed = config.calibrationSettings.endSpeed;
    const timeGoal = config.calibrationSettings.timeGoal; // time goal for 100% speed in ms for tthe specified progression distance
    const CalibrationTolerance = config.calibrationSettings.tolerance; // 10% tolerance
    const runInParallel = config.calibrationSettings.runInParallel;
    const results3 = await faderController.calibrate(calibrationindexes, startProgression, endProgression, count, startSpeed, endSpeed, timeGoal, CalibrationTolerance, runInParallel);

    expect(results3).toBeDefined();
  }, 500000);
});