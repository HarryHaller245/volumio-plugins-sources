// FaderController.test.js
const { FaderController, FaderMove } = require('../lib/FaderController');

const fader_count = 2;

const messageRateLimit = 10; //! produces mybe crashes with a limit below 5 ?
const MIDILog = false;
const speeds = [80, 50, 10];

describe('FaderController', () => {
  let faderController;

  beforeAll(done => {
    faderController = new FaderController(undefined, fader_count, messageRateLimit, MIDILog, speeds);
    faderController.setupSerial('/dev/ttyUSB0', 1000000);
  
    // Add a delay before starting the FaderController
    setTimeout(async () => {
      await faderController.start();
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

    //test 0 
    await faderController.calibrate(undefined)

    //test 1: move faders to a position
    const indexes = [0,1];
    const progression = 100;

    const moveA = new FaderMove(indexes, 100, 10); 
    await faderController.move_faders(moveA, false);

  }, 50000);
});