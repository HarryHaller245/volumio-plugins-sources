// FaderController.test.js
const FaderController = require('../lib/FaderController');

const calibration_movement = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90];
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
    }, 10000);
  });

  afterAll(() => {
    faderController.stop();
  });

  test('FaderController should be defined', () => {
    expect(faderController).toBeDefined();
  });

  test('FaderController should successfully open the SerialPort', () => {
    expect(faderController.ser_port.isOpen).toBeTruthy();
  });


  test('FaderController should be able to read incoming MIDI Messages', done => {
    //for this we just need to let in run for 20 seconds
    faderController.setEchoMode(fader_index, true);
    setTimeout(() => {
      done();
    }, 20000);
  });

  test('FaderController should be able to run a calibration routine', done => {
    const initialPosition = faderController.get_position(fader_index);
  
    faderController.calibrate(fader_index, calibration_movement, 50, () => {
      const finalPosition = faderController.get_position(fader_index);
  
      // Check that the fader's position has changed
      expect(finalPosition).not.toEqual(initialPosition);
  
      done();
    });
  });



});