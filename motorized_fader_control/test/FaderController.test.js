// FaderController.test.js
const FaderController = require('../lib/FaderController');

const calibration_movement = [0,50,0,50];
const base_point = 0;
const fader_index = 1;

const fader_count = 2;

const messageRateLimit = 100;


describe('FaderController', () => {
  let faderController;

  beforeAll(done => {
    faderController = new FaderController(undefined, fader_count, messageRateLimit);
    faderController.setupSerial('/dev/ttyUSB0', 1000000);
  
    // Add a delay before starting the FaderController
    setTimeout(() => {
      faderController.start();
      done();
    }, 3000);
  });

  afterAll(async () => {
    // Then stop the controller
    await faderController.stop();
    faderController.closeSerial();
  });

  test('FaderController should be defined', () => {
    expect(faderController).toBeDefined();
  }); 

  test('FaderController tests movement', async () => {
    const indexes = [0,1];
    const progression = 80;

    // Test 1: sendFaderProgression
    await faderController.sendFaderProgression(indexes, progression);

    indexes.forEach(index => {
      const actualPosition = faderController.faders[index].getProgression();
      expect(actualPosition).toEqual(progression);
    });

    // Test 2: faderCalibration
    const calibration = calibration_movement;

    // // Call faderCalibration and await it
    // try {
    //   await faderController.faderCalibration(indexes, calibration, 0);
    // } catch (error) {
    //   console.error('Error in faderCalibration: ', error);
    // }

    //test 3: Parallel movement
    const parallelProgression = 50;
    const parallelProgressionDict = {0: parallelProgression, 1: parallelProgression};
    await faderController.sendFaderProgressionsDict(parallelProgressionDict);

    //test 4: Parallel calibration
    await faderController.faderCalibrationParallel(indexes, calibration);

  });
});