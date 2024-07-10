// FaderControllerTest.js
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

const runTest = async () => {
  let faderController;

  try {
    faderController = new FaderController(undefined, fader_count, messageDelay, MIDILog, speeds, ValueLog, MoveLog);
    await faderController.setupSerial('/dev/ttyUSB0', 1000000);

    // Add a delay before starting the FaderController
    await new Promise(resolve => setTimeout(resolve, 5000));

    await faderController.start();
    faderController.setFaderProgressionMap(undefined, TrimMap);

    console.log('FaderController initialized successfully.');

    // Test: move faders to a position
    const indexes = [0, 1];
    const progression = 70;

    const moveA = new FaderMove(indexes, progression, 50);
    await faderController.moveFaders(moveA, false);

    const faderProgressions = faderController.getFaderProgressions(indexes);
    console.log(`Fader progressions: ${faderProgressions}`);
    if (JSON.stringify(faderProgressions) === JSON.stringify([progression, progression])) {
      console.log('Fader movement test passed.');
    } else {
      console.log('Fader movement test failed.');
    }

    // Test: Speed Calibration Time Goal
    const calibrationindexes = 1;
    const startProgression = 0;
    const endProgression = 100;
    const count = 10; // this creates memory problems when high, better do one per fader
    const startSpeed = 1;
    const endSpeed = 100;
    const timeGoal = 10; // time goal for 100% speed in ms
    const results = await faderController.calibrateSpeeds(calibrationindexes, startProgression, endProgression, count, startSpeed, endSpeed);

    const results2 = await faderController.calibrateSpeedDuration(calibrationindexes, startProgression, endProgression, count, startSpeed, endSpeed, timeGoal);

    console.log('Speed Calibration Time Goal results:', results2);

  } catch (error) {
    console.error('Error during tests:', error);
  } finally {
    if (faderController) {
      try {
        await faderController.stop();
        faderController.closeSerial();
        console.log('FaderController stopped and serial connection closed.');
      } catch (cleanupError) {
        console.error('Error during cleanup:', cleanupError);
      }
    }
  }
};

runTest();
