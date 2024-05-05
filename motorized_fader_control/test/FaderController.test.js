// FaderController.test.js
const FaderController = require('../lib/FaderController');

const calibration_movement = [0,50,0,50];
const base_point = 0;
const fader_index = 1;


describe('FaderController', () => {
  let faderController;

  beforeAll(done => {
    faderController = new FaderController();
    faderController.setupSerial('/dev/ttyUSB0', 1000000);
  
    // Add a delay before starting the FaderController
    setTimeout(() => {
      faderController.start();
      done();
    }, 3000);
  });

  afterAll(async () => {
    // Wait for all messages to be sent
    await faderController.allMessagesSent();
  
    // Then stop the controller
    faderController.stop();
  });

  test('FaderController should be defined', () => {
    expect(faderController).toBeDefined();
  }); 

  test('FaderController tests movement', async () => {
    const indexes = [0,1];
    const progression = 100;
  
    // Test 1: sendFaderProgression
    faderController.sendFaderProgression(indexes, progression);
    await faderController.allMessagesSent();
  
    indexes.forEach(index => {
      const actualPosition = faderController.faders[index].getProgression();
      expect(actualPosition).toEqual(progression);
    });
  
    // Test 2: faderCalibration
    const calibration = calibration_movement;
    await faderController.allMessagesSent();
    faderController.faderCalibration(indexes, calibration, 0)
  });

});