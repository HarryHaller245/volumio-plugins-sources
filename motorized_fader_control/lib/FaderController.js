

const { SerialPort } = require('serialport'); // import the SerialPort module 
const MIDIParser = require('./MIDIParser'); // import the MIDIParser


const winston = require('winston');

const logger = winston.createLogger({
  level: 'debug',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
  ],
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple(),
  }));
}



class Fader {
    constructor(index) {
      this.index = index;
      this.position = 0; // 14-bit integer
      this.progression = 0; // Progression of the fader
      this.touch = false; // Whether the fader is currently being touched
      this.onTouch = null; // Callback for touch event
      this.onUntouch = null; // Callback for untouch event
      this.echo_mode = false;
    }
  
    setTouchCallback(callback) {
      this.onTouch = callback;
    }

    setUntouchCallback(callback) {
      this.onUntouch = callback;
    }

    setEchoMode(echo_mode) {
      this.echo_mode = echo_mode;
    }

    setProgression(progression) {
        this.progression = progression;
        //also update position accordingly
        this.position = this.progressiontoPosition(progression);
    }
    setPosition(position) {
        this.position = position;
        //also update progression accordingly
        this.progression = this.postitiontoProgression(position);
    }

    postitiontoProgression(position) {
      // convert a 14bit integer to a 0-100 float value
    return position / 16383 * 100;
    }

    progressiontoPosition(progression) {
      //convert a 0-100 float value to a 14bit integer
    return progression / 100 * 16383;
    }

    // missing method to return a fader object at the index


    // missing method to return a fader object log msg for a fader at index


}


class FaderController() {
    
    constructor() {
      const fader_count = 12;
      // create an array of 12 faders of the Fader class
      this.faders = Array.from({ length: fader_count }, (_, i) => new Fader(i));
      logger.debug("Fader Array created with: " + fader_count)

    }

    setupSerial(ser_port_path, baud_rate) {
        try {
          //method to initialize the serial port and parser
          logger.debug("### Initializing SerialPort..")
          this.ser_port = new SerialPort(ser_port_path, { baudRate: baud_rate });
          this.parser = new MIDIParser();
          this.ser_port.pipe(this.parser);
          logger.info("### SerialPort initialized,")
        } catch (error) {
          console.error('Error setting up serial port and parser:', error);
        }
    }

    start() {
        try {
          logger.debug('### Starting the FaderController...');
      
          if (!this.ser_port) {
            logger.error('SerialPort is not initialized');
            return;
          }
      
          this.ser_port.open((err) => {
            if (err) {
              logger.error('Error opening serial port: ', err);
            } else {
              logger.info('SerialPort is open: ' + this.ser_port.path);
            }
          });

            // Start reading data
            this.parser.on('readable', () => {
                this.readAndParseData();
            });
          
          logger.info('### FaderController started!')
        } catch (error) {
          logger.error('Error starting FaderController: ', error);
        }
      }

    // better option is to set the stream callbacks listeners in a seperate method for
    // open, close, err, readable...
    setupPortListeners() {
      this.ser_port.on('open') => {
        logger.debug('SerialPort is opened: ' + this.ser_port.path);
      }

      this.ser_port.on('err') => {
        logger.error('SerialPort caused error: ' + err) /// not correct
      }


    }

    setupParserListeners() {
      this.parser.on('readable',() = >{
        this.readAndParseData();
      })
    }

    closeSerial() {
      //close serial port

    }

    stopAllListener() {
      //stop all listeners Parser AND Port
    }

    stop() {
        //method to stop the FaderController
        //resets the faders and closes the serial port
        logger.info("### Stopping the FaderController...");
        try {
            this.resetFaders();
            this.stopAllListeners();
            this.closeSerial();
            logger.info("### FaderController stopped");
        } catch (error) {
            logger.error("An error occurred while stopping the FaderController: " + error);
        }
    }

    readAndParseData() {
        let data;
        try {
            data = this.parser.read();
            if (data) {
                const midiData = {
                    type: data[0],
                    channel: data[1],
                    data1: data[2],
                    data2: data[3]
                };
                // Get the formatted log message
                const logMessage = this.parser.formatLogMessage(midiData);
                logger.debug(logMessage);
                this.updateFaderInfo(midiData);
            }
        } catch (error) {
            logger.error('Error reading data:' + error);
        }
    }

    //info handling

    updateFaderInfo(midiData) {
      if (translateType(parsedData.type) === "PITCH_BEND") {
        fader.setPosition(this.parser.data1 | (this.parser.data2 << 7));
        if (fader.echo_mode) {
          this.echo(parsedData);
        }
      } else if (translateType(parsedData.type) === "NOTE_ON") {
        let faderIndex = this.parser.data1 - 104;
        this.faders[faderIndex].setTouch(true);
      } else if (translateType(parsedData.type)=== "NOTE_OFF") {
        let faderIndex = this.parser.data1 - 104;
        this.faders[faderIndex].setTouch(false);
      }
    }


    //send message #############################################

    sendMessage(index, message) {
        this.ser_port.write([message.type, message.data1, message.data2]);
        logger.debug('Message sent to fader at index: ', index, ', message: ', message);
    } 
      
    echo(parsedData) {
        const message = {
            type: parsedData.type,
            channel: parsedData.channel,
            data1: parsedData.data1,
            data2: parsedData.data2,
        };
        this.sendMessage(parsedData.channel, message);
    }
      
    setFaderProgression(index, progression) {
        this.faders[index].setProgression(progression);
        const position = this.faders[index].position;
        const message = {
            type: 0xE0 | index,
            channel: index,
            data1: position & 0x7F,
            data2: position >> 7
        };
        this.sendMessage(index, message);
    }

    //movement

    echo(parsedData) {
        //method to echo the MIDI messages back to the faders
        if (parsedData.type === "PITCH BEND") {
          // Convert the 14-bit MIDI value back into a progression value
          let value = (parsedData.data1 | (parsedData.data2 << 7)) / 16383 * 100;
          this.setProgression(parsedData.channel, value);
        }
    }

    faderCalibration(index, movement, base_point) {
        //method to calibrate a fader
        //movement is the amount of movement in the fader
        //base_point is the base point of the fader
      
        if (index === undefined) {
          // If no index is provided, calibrate all faders
          this.faders.forEach((fader, i) => {
            this.faderCalibration(i, movement, base_point);
          });
        } else {
          // If an index is provided, calibrate the fader at that index
          const fader = this.faders[index];
          logger.info('Calibrating fader with index: ', index);
          for (let i = 0; i < movement.length; i++) {
            this.setProgression(index, movement[i]);
          }
          this.setProgression(index, base_point);
        }
      }





















}


module.exports = FaderController;