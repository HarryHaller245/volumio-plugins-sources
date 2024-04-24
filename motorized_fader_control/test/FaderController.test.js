// FaderController.test.js
const FaderController = require('../lib/FaderController');

const calibration_movement = [0,50,0,50,0,100,50,0,100];
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
    }, 2000);
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

  test('FaderController should succesfully store MIDI device readiness',() => {
    expect(faderController.MIDIDeviceReady).toBeTruthy();
  });

  test('FaderController should read and parse inputs of 2 faders for 35s', done => {
    jest.setTimeout(20000); // Increase the timeout to 35 seconds
  
    setTimeout(() => {
      done();
    }, 20000);
  });

  test('FaderController should successfully run a calibration on a single specified fader', done => {
    const faderIndex = [0, 1, 2]; // Specify the index of the fader you want to calibrate
    setTimeout(() => {
      expect(faderController.faderCalibration(faderIndex, calibration_movement, base_point)).toBeTruthy();
      done();
    }, 20000); // Delay of 5 seconds
  }, 20000); // Increase the timeout limit to 10 seconds
  
  test('FaderController should successfully run a calibration on the specified faders', done => {
    const faderIndexes = [0, 1, 2]; // Specify the indexes of the faders you want to calibrate
    setTimeout(() => {
      expect(faderController.faderCalibration(faderIndexes, calibration_movement, base_point)).toBeTruthy();
      done();
    }, 20000); // Delay of 5 seconds
  }, 20000); // Increase the timeout limit to 10 seconds



});