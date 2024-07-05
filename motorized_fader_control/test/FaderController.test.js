// FaderController.test.js
const { FaderController, FaderMove } = require('../lib/FaderController');

const fader_count = 2;


const messageDelay = 0; //! produces maybe crashes with a limit below 5 ?
const MIDILog = false;
const ValueLog = false;

const speedHigh = 30;
const speedMedium = 20;
const speedLow = 10;
const speeds = [speedHigh, speedMedium, speedLow];

jest.setTimeout(30000); // 30 seconds

describe('FaderController', () => {
  let faderController;

  beforeAll(done => {
    faderController = new FaderController(undefined, fader_count, messageDelay, MIDILog, speeds, ValueLog);
    faderController.setupSerial('/dev/ttyUSB0', 1000000);
  
    // Add a delay before starting the FaderController
    new Promise(resolve => setTimeout(resolve, 5000))
      .then(async () => {
        await faderController.start();
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

  test('FaderController tests movement', async () => {
    //test 1: move faders to a position
    const indexes = [0,1];
    const progression = 70;

    const moveA = new FaderMove(indexes, progression, 10); 
    await faderController.moveFaders(moveA, false);
    expect(faderController.getFaderProgressions(indexes)).toEqual([progression, progression]);

    //test 4: Speed Calibration
    await faderController.calibrateSpeeds(indexes, 0, 100, 20, 1, 20);
    
  }, 50000);
});