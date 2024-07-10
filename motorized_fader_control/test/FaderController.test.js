const { FaderController, FaderMove } = require('../lib/FaderController');

const fader_count = 2;

const messageDelay = 0.001; // messageDelay in ms
const MIDILog = false;
const ValueLog = false;
const MoveLog = false;

const speedHigh = 100;
const speedMedium = 50;
const speedLow = 5;
const speeds = [speedHigh, speedMedium, speedLow];
const TrimMap = [0, 100]; // applies a fader range trim to 0-100 is full range

jest.setTimeout(3000000); // 30 seconds

describe('FaderController', () => {
  let faderController;

  beforeAll(done => {
    faderController = new FaderController(undefined, fader_count, messageDelay, MIDILog, speeds, ValueLog, MoveLog);
    faderController.setupSerial('/dev/ttyUSB0', 1000000)

    // Add a delay before starting the FaderController
    new Promise(resolve => setTimeout(resolve, 5000))
      .then(async () => {
        await faderController.start();
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
    const progression = 70;

    const moveA = new FaderMove(indexes, progression, 50);
    await faderController.moveFaders(moveA, false);
    expect(faderController.getFaderProgressions(indexes)).toEqual([progression, progression]);
  }, 500000);

  test('FaderController should perform speed calibration', async () => {
    const calibrationindexes = 1;
    const startProgression = 0;
    const endProgression = 100;
    const count = 10; // this creates memory problems when high, better do one per fader
    const startSpeed = 1;
    const endSpeed = 100;
    const results = await faderController.calibrateSpeeds(calibrationindexes, startProgression, endProgression, count, startSpeed, endSpeed);
    expect(results).toBeDefined();
  }, 500000);

  test('FaderController should perform speed calibration with time goal', async () => {
    const calibrationindexes = 1;
    const startProgression = 0;
    const endProgression = 100;
    const count = 10; // this creates memory problems when high, better do one per fader
    const startSpeed = 1;
    const endSpeed = 100;
    const timeGoal = 10; // time goal for 100% speed in ms
    const results2 = await faderController.calibrateSpeedDuration(calibrationindexes, startProgression, endProgression, count, startSpeed, endSpeed, timeGoal);
    expect(results2).toBeDefined();
  }, 500000);

  test('FaderController should perform a complete calibration', async () => {
    const calibrationindexes = 1;
    const startProgression = 0;
    const endProgression = 100;
    const count = 10; // this creates memory problems when high, better do one per fader
    const startSpeed = 1;
    const endSpeed = 100;
    const timeGoal = 10; // time goal for 100% speed in ms
    const CalibrationTolerance = 0.1; // 10% tolerance
    const results3 = await faderController.calibrate(calibrationindexes, startProgression, endProgression, count, startSpeed, endSpeed, timeGoal, CalibrationTolerance);

    expect(results3).toBeDefined();
  }, 500000);

});
