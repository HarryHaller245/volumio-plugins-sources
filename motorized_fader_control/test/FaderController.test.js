// FaderController.test.js
const { FaderController, FaderMove } = require('../lib/FaderController');


const calibration_movement = [0,50];
const base_point = 0;
const fader_index = 1;

const fader_count = 2;

const messageRateLimit = 1;
const MIDILog = false;

describe('FaderController', () => {
  let faderController;

  beforeAll(done => {
    faderController = new FaderController(undefined, fader_count, messageRateLimit, MIDILog);
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
    const progression = 100;

    // Test 1: sendFaderProgression
    await faderController.sendFaderProgression(indexes, progression);

    indexes.forEach(index => {
      const actualPosition = faderController.faders[index].getProgression();
      expect(actualPosition).toEqual(progression);
    });

    //test 5: fader move with speed
    const speed = 10
    const indexesMoveSPeed = [0,1];
    const progressionMoveSpeed = [50, 50];
    await faderController.move_fader(indexesMoveSPeed, progressionMoveSpeed, speed, false);

    //test 6: fader move with speed with faderMove class
    const move1 = new FaderMove(0, 80, 10);
    const move2 = new FaderMove(1, 80, 10);
    const moves = [move1, move2];
    await faderController.move_faders(moves, false);

  }, 50000);
});