const { FaderController, FaderMove } = require('../lib/FaderController');

const fader_count = 2;

const messageDelay = 0.001; // messageDelay in ms
const MIDILog = false;
const ValueLog = false;
const MoveLog = false;

const CalibrationOnStartParam = false;

const speedHigh = 100;
const speedMedium = 50;
const speedLow = 10;
const speeds = [speedHigh, speedMedium, speedLow];
const TrimMap = [0, 100]; // applies a fader range trim 0-100 is full range

jest.setTimeout(3000000); // 30 seconds

describe('FaderController', () => {
  let faderController;

  beforeAll(done => {
    faderController = new FaderController(undefined, fader_count, messageDelay, MIDILog, speeds, ValueLog, MoveLog);
    faderController.setupSerial('/dev/ttyUSB0', 1000000)

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
    // runs the speed factor calibration and verifies the speed factor to calibrate the max speed to the time goal
    // since we dont have an accuratet representation of the physical fader, we only calibrate the mididevice and the software timing
    // for physical calibration we need user feedback or trust into the fader hardware
    const calibrationindexes = [0,1]; //fader indexes to clibrate
    const startProgression = 0;
    const endProgression = 100;
    const count = 10; // this creates memory problems when high, better do one per fader
    const startSpeed = 10;
    const endSpeed = 100;
    const timeGoal = 50; // time goal for 100% speed in ms for tthe specified progression distance
    const CalibrationTolerance = 0.1; // 10% tolerance
    const runInParallel = false;
    const results3 = await faderController.calibrate(calibrationindexes, startProgression, endProgression, count, startSpeed, endSpeed, timeGoal, CalibrationTolerance, runInParallel);

    expect(results3).toBeDefined();
  }, 500000);

  

});
