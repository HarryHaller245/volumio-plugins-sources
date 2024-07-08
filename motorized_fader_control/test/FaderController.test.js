// FaderController.test.js
const { FaderController, FaderMove } = require('../lib/FaderController');

const fader_count = 2;


const messageDelay = 0.1; //! messageDelay in ms
const MIDILog = false;
const ValueLog = false;
const MoveLog = false;

const speedHigh = 100;
const speedMedium = 50;
const speedLow = 5;
const speeds = [speedHigh, speedMedium, speedLow];
const TrimMap = [0,100] //applies a fader range trim to 0-100 is full range

const heapdump = require('heapdump');

jest.setTimeout(30000000); // 30 seconds

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

  test('FaderController tests movement', async () => {
    //test 1: move faders to a position
    const indexes = [0,1];
    const progression = 70;

    const moveA = new FaderMove(indexes, progression, 50); 
    await faderController.moveFaders(moveA, false);
    expect(faderController.getFaderProgressions(indexes)).toEqual([progression, progression]);

    // test 4: Speed Calibration
    const startProgression = 0;
    const endProgression = 100;
    const count = 20; //! this creates memory problems when high, better do one per fader
    const startSpeed = 1;
    const endSpeed = 100;
    const results = await faderController.calibrateSpeeds(1, startProgression, endProgression, count, startSpeed, endSpeed);
    
    //test 5: Find fastest speed 0-100 with visual confirmation
    // we will make a move from 0-100-0 in from speeds 0-100, each time waiting for user confirmation
    // yes - fader reached 100, no - fader reached maximum speed and did not reach 100

    //test 6: echo mode
    // we will enable echo mode on both fader 0,1 and let the user manipulate them by hand
    // the faders should keep the set posiiton. We will give 45 seconds of time to test this

  }, 500000);
});