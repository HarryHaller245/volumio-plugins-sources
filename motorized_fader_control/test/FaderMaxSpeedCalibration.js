const { FaderController, FaderMove } = require('../lib/FaderController');
const readline = require('readline');

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Function to get user input
const getUserInput = (question) => {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
};

(async () => {
  const fader_count = 2;
  const messageDelay = 0.001 // messageDelay in ms
  const MIDILog = false;
  const ValueLog = false;
  const MoveLog = false;
  const CalibrationOnStartParam = false;
  const speeds = [100, 50, 5];
  const TrimMap = [0, 100]; // applies a fader range trim 0-100 is full range

  const faderController = new FaderController(undefined, fader_count, messageDelay, MIDILog, speeds, ValueLog, MoveLog);

  try {
    await faderController.setupSerial('/dev/ttyUSB0', 1000000);
    await new Promise(resolve => setTimeout(resolve, 5000)); // Add a delay before starting the FaderController
    await faderController.start(CalibrationOnStartParam);
    faderController.setFaderProgressionMap(undefined, TrimMap);

    const calibrationIndexes = [0, 1];
    const startProgression = 0;
    const endProgression = 100;
    const calibrationCount = 20;
    const calibrationStartSpeed = 1;
    const calibrationEndSpeed = 100;
    const timeGoal = 50; // time goal for 100% speed in ms for the specified progression distance
    const calibrationTolerance = 0.1; // 10% tolerance

    // Run standard calibration to specify the max speed of the fader
    const calibrationResults = await faderController.calibrate(
      calibrationIndexes,
      startProgression,
      endProgression,
      calibrationCount,
      calibrationStartSpeed,
      calibrationEndSpeed,
      timeGoal,
      calibrationTolerance
    );

    console.log('Standard calibration results:', calibrationResults);

    const indexes = [0, 1];
    const count = 10;
    const startSpeed = 50;
    const endSpeed = 100;

    // Run user calibration to specify the max speed of the fader
    const results = await faderController.UserCalibration(indexes, count, startSpeed, endSpeed, getUserInput, false);
    console.log('User calibration results:', results);
  } catch (error) {
    console.error('Error during calibration:', error);
  } finally {
    await faderController.stop();
    await faderController.closeSerial();
    rl.close();
  }
})();