const io = require('socket.io-client');
const fs = require('fs');  // Import the file system module
const path = require('path');

describe('Volumio WebSocket API with live server', () => {
    let socket;
    let logFile;

    // Create a new log file with a timestamp before each test suite
    beforeAll(() => {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        logFile = path.join(__dirname, `volumioWSApi-${timestamp}.log`);
    });

    // Connect to Volumio WebSocket before each test
    beforeEach((done) => {
        socket = io.connect(`http://localhost:3000`);

        // Log connection event
        socket.on('connect', () => {
            console.log('Connected to Volumio WebSocket');
            done();
        });

        // Handle WebSocket errors
        socket.on('error', (error) => {
            console.error('WebSocket Error:', error);
        });
    });

    // Disconnect after each test
    afterEach((done) => {
        if (socket.connected) {
            socket.disconnect();
            console.log('Disconnected from Volumio WebSocket');
        }
        done();
    });

    // Helper function to log API calls, arguments, and responses
    // Helper function to log API calls, arguments, and responses
    const logResponse = (apiCall, args, response) => {
        let itemCount = null;
        let albumInfo = {};
        let queueInfo = {};

        // Log amount of items in response if browseLibrary was apiCall
        if (apiCall === 'browseLibrary' && response.navigation && response.navigation.lists) {
            itemCount = response.navigation.lists.reduce((count, list) => count + (list.items ? list.items.length : 0), 0);

            // Extract album information
            const albumUri = response.navigation.info.uri;
            const albumDuration = response.navigation.info.duration;
            const songDurations = response.navigation.lists[0].items.map(item => item.duration);
            const totalDuration = songDurations.reduce((sum, duration) => sum + duration, 0);
            const numberOfSongs = songDurations.length;

            albumInfo = {
                albumUri,
                albumDuration,
                totalDuration,
                numberOfSongs
            };
        }

        // Extract queue information if apiCall was getQueue
        if (apiCall === 'getQueue' && Array.isArray(response)) {
            const totalDuration = response.reduce((sum, item) => sum + (item.duration || 0), 0);
            const numberOfItems = response.length;

            queueInfo = {
                totalDuration,
                numberOfItems
            };
        }

        const logEntry = {
            apiCall,
            args,
            response,
            itemCount,
            albumInfo,
            queueInfo,
            timestamp: new Date().toISOString()
        };
        fs.appendFileSync(logFile, JSON.stringify(logEntry, null, 2) + ',\n', (err) => {
            if (err) {
                console.error('Error writing to log file:', err);
            } else {
                console.log(`${apiCall} Response logged to file`);
            }
        });
    };
    
    test('Should emit getState and log the state dictionary', (done) => {
        jest.setTimeout(15000);  // Set timeout to 15 seconds for this test

        const startTime = Date.now();  // Record the start time for performance logging
        
        // Emit the getState event
        const apiCall = 'getState';
        const args = {};
        socket.emit(apiCall);
        
        // Listen for the response from Volumio's WebSocket API
        socket.on('pushState', (state) => {
            const endTime = Date.now();  // Capture the end time for performance measurement
            
            console.log('State Response:', state);  // Log the state dictionary received
            console.log(`Response Time: ${endTime - startTime} ms`);  // Log the response time
    
            // Log the API call, arguments, and response
            logResponse(apiCall, args, state);
    
            // Ensure the state object has the necessary fields (for example, checking status or volume)
            expect(state).toHaveProperty('status');  // Replace with actual state properties relevant to your system
            expect(state).toHaveProperty('volume');
            
            done();  // Mark the test as done after the state response is received and verified
        });
    });

    // Test case: Emit browseLibrary and retrieve albums for an artist
    test('should emit browseLibrary using an uri', (done) => {
        jest.setTimeout(15000);  // Set timeout to 15 seconds for this test
    
        const startTime = Date.now();
        const apiCall = 'browseLibrary';
        const args = { uri: "jellyfin/karim@d94cd56570f04007acd1bdf67327cd78/albums" };  // Specify the URI for the artist's albums
    
        // Emit the browseLibrary event
        socket.emit(apiCall, args);
        
        // Set a timeout for the response
        const timeoutId = setTimeout(() => {
            console.error(`Timeout: No response received for browseLibrary after 15000 ms`);
            done(new Error('Timeout: No response for browseLibrary'));
        }, 15000);
    
        // Listen for the response
        socket.on('pushBrowseLibrary', (browseLibrary) => {
            clearTimeout(timeoutId);  // Clear the timeout once the response is received
            const endTime = Date.now();
            
            const responseLog = {
                response: browseLibrary,
                responseTime: `${endTime - startTime} ms`,
                timestamp: new Date().toISOString()
            };
            
            // Log the API call, arguments, and response
            logResponse(apiCall, args, responseLog);
    
            console.log('BrowseLibrary Response:', JSON.stringify(browseLibrary, null, 2));
            
            // Additional checks for browseLibrary response structure
            expect(browseLibrary).toHaveProperty('navigation');
            expect(browseLibrary.navigation).toHaveProperty('lists');
            expect(browseLibrary.navigation.lists.length).toBeGreaterThan(0);
    
            done();
        });
    });
    
    test('search for items and log the response time', (done) => {
        jest.setTimeout(15000);  // Set timeout to 15 seconds for this test

        const apiCall = 'search';
        const args = { value: "Ants From Up There", service: "jellyfin"};

        const startTime = Date.now();  // Start timing when the search is initiated

        // Emit the search event with the query object
        socket.emit(apiCall, args);

        // Listen for the search results response
        const timeoutId = setTimeout(() => {
            console.error(`Timeout: No response received for search after 15000 ms`);
            done(new Error('Timeout: No response for search'));
        }, 15000);  // Set a timeout of 15 seconds

        socket.on('pushBrowseLibrary', (results) => {
            clearTimeout(timeoutId);  // Clear the timeout once the response is received
            const endTime = Date.now();  // End timing when the response is received
            const responseTime = endTime - startTime;  // Calculate the response time

            console.log('Search Results:', JSON.stringify(results));  // Log the search results received
            console.log(`Response Time: ${responseTime} ms`);  // Log the response time

            // Log the API call, arguments, and response
            logResponse(apiCall, args, results);

            // Ensure there are results returned
            expect(results).toHaveProperty('navigation');  // Adjust according to the actual structure of search results
            expect(results.navigation).toHaveProperty('lists');
            expect(results.navigation.lists.length).toBeGreaterThan(0);

            done();  // Mark the test as complete once the results are received and validated
        });
    });
    
    // Test for retrieving music sources
    test('should retrieve available music sources', (done) => {
        jest.setTimeout(15000);  // Set timeout to 15 seconds for this test

        const apiCall = 'getBrowseSources';
        const args = {};

        socket.emit(apiCall);

        const timeoutId = setTimeout(() => {
            console.error(`Timeout: No response received for getBrowseSources after 15000 ms`);
            done(new Error('Timeout: No response for getBrowseSources'));
        }, 15000);  // Set a timeout of 15 seconds

        socket.on('pushBrowseSources', (sources) => {
            clearTimeout(timeoutId);  // Clear the timeout once the response is received

            // Log the API call, arguments, and response
            logResponse(apiCall, args, sources);

            console.log('Available Music Sources retrieved:', sources);
            done();
        });
    });

    // Test for goTo API call
    test('should emit goTo and log the response', (done) => {
        jest.setTimeout(15000);  // Set timeout to 15 seconds for this test
        //! this needs testing with other playback sources, spotify seems not to work
        const apiCall = 'goTo';
        const args = { type: "album" };  // Example argument, adjust as needed

        socket.emit(apiCall, args);

        const timeoutId = setTimeout(() => {
            console.error(`Timeout: No response received for goTo after 15000 ms`);
            done(new Error('Timeout: No response for goTo'));
        }, 15000);  // Set a timeout of 15 seconds

        socket.on('pushBrowseLibrary', (response) => {
            clearTimeout(timeoutId);  // Clear the timeout once the response is received

            // Log the API call, arguments, and response
            logResponse(apiCall, args, response);

            console.log('goTo Response:', response);
            done();
        });
    });

    test('Should retrieve Queue and log the response', (done) => {
        jest.setTimeout(15000);  // Set timeout to 15 seconds for this test
    
        const apiCall = 'getQueue';
        const args = {};
        
        socket.emit(apiCall);
    
        const timeoutId = setTimeout(() => {
            console.error(`Timeout: No response received for getQueue after 15000 ms`);
            done(new Error('Timeout: No response for getQueue'));
        }, 15000);  // Set a timeout of 15 seconds
    
        socket.on('pushQueue', (queue) => {
            clearTimeout(timeoutId);  // Clear the timeout once the response is received
            const endTime = Date.now();  // Capture the end time for performance measurement
    
            // Log the API call, arguments, and response
            logResponse(apiCall, args, queue);
    
            // Ensure the queue object has the necessary fields (for example, checking if it is an array)
            expect(Array.isArray(queue)).toBe(true);  // Replace with actual queue properties relevant to your system
            expect(queue.length).toBeGreaterThan(0);
    
            done();  // Mark the test as done after the queue response is received and verified
        });
    });

    // Test case to retrieve and log current volume level, i.e. trying to trigger a volume event with a volume value
    test('should emit getVolume and log the response', (done) => {
        jest.setTimeout(15000);  // Set timeout to 15 seconds for this test
        
        const apiCall = 'getState';
        const args = "testestest";

        const startTime = Date.now();  // Start timing when the request is initiated

        // Emit the getVolume event
        socket.emit(apiCall);

        // Set a timeout for the response
        const timeoutId = setTimeout(() => {
            console.error(`Timeout: No response received for getVolume after 15000 ms`);
            done(new Error('Timeout: No response for getVolume'));
        }, 15000);  // Set a timeout of 15 seconds

        // Listen for the volume response event from Volumio
        socket.on('pushState', (state) => {
            clearTimeout(timeoutId);  // Clear the timeout once the response is received
            const endTime = Date.now();  // Capture the end time for performance measurement
            
            console.log('Volume Response:', JSON.stringify(state));  // Log the volume received
            console.log(`Response Time: ${endTime - startTime} ms`);  // Log the response time

            // Log the API call, arguments, and response
            logResponse(apiCall, args, volume);

            // Ensure the volume object has the necessary fields (e.g., current volume level)
            expect(state).toHaveProperty('volume');
            expect(typeof state.volume).toBe('number');  // Volume level should be a number

            done();  // Mark the test as done after the volume response is received and verified
        });
    });

});