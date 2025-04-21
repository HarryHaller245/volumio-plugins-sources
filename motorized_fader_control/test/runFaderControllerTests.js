'use strict';
const fs = require('fs');
const path = require('path');
const { FaderController, FaderMove, CustomLogger } = require('../lib');

const configPath = 'config.json';
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

async function testEchoResponse(faderController, logger, faderIndex) {
    // Test parameters
    const testMoves = [
        { target: 100, speed: 50 },  // Fast move to 100
        { target: 0, speed: 10 },     // Slower move back to 0
        { target: 50, speed: 5 },    // Medium position at lower speed
        { target: 100, speed: 5 }    // Very slow move to 100
    ];

    // Data collection
    const testResults = {
        sentCommands: [],
        receivedEchoes: [],
        timingData: [],
        discrepancies: []
    };

    // Override MIDI handler to capture echoes
    const originalHandler = faderController.midiHandler.controller.handleMIDIMessage;
    faderController.midiHandler.controller.handleMIDIMessage = function(message) {
        if (message.type === 'PITCH_BEND') {
            const position = (message.data2 << 7) | message.data1;
            const timestamp = Date.now();
            testResults.receivedEchoes.push({
                index: message.channel,
                position,
                raw: message.raw,
                timestamp
            });
            
            if (faderController.config.MIDILog) {
                logger.debug(`ECHO RECV: Fader ${message.channel} -> ${position}`);
            }
        }
        originalHandler.call(this, message);
    };

    try {
        logger.info(`=== Starting Echo Response Test ===`);
        logger.info(`Testing fader ${faderIndex} with ${testMoves.length} moves`);

        for (const [i, move] of testMoves.entries()) {
            const moveStart = Date.now();
            logger.info(`Move ${i+1}: ${move.target}% at speed ${move.speed}`);
            
            // Record sent command
            const moveCmd = new FaderMove(faderIndex, move.target, move.speed);
            testResults.sentCommands.push({
                index: faderIndex,
                target: move.target,
                speed: move.speed,
                timestamp: moveStart,
                command: moveCmd
            });

            // Execute move
            await faderController.moveFaders(moveCmd, false); //dont interrupt
            
            // Wait for echoes to settle (empirical value based on your logs)
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Analyze echoes for this move
            const echoes = testResults.receivedEchoes.filter(
                e => e.index === faderIndex && e.timestamp >= moveStart
            );
            
            if (echoes.length === 0) {
                logger.warn(`No echoes received for move ${i+1}`);
                continue;
            }

            // Calculate statistics
            const firstEcho = echoes[0];
            const lastEcho = echoes[echoes.length - 1];
            const duration = lastEcho.timestamp - moveStart;
            const finalPosition = lastEcho.position;
            const targetPosition = faderController.getFader(faderIndex).progressionToPosition(move.target);
            const positionError = Math.abs(finalPosition - targetPosition);
            
            // Calculate unit/s (14-bit integers per second)
            const positionDelta = Math.abs(lastEcho.position - firstEcho.position);
            const unitsPerSecond = (positionDelta / (duration / 1000)).toFixed(2);

            testResults.timingData.push({
                move: i + 1,
                echoesReceived: echoes.length,
                responseTime: firstEcho.timestamp - moveStart,
                completionTime: duration,
                finalPosition,
                positionError,
                positionDelta,
                unitsPerSecond // Add this to the results
            });

            if (positionError > 5) { // Threshold for significant error
                testResults.discrepancies.push({
                    move: i+1,
                    expected: targetPosition,
                    actual: finalPosition,
                    error: positionError
                });
            }
            logger.info(`Move ${i + 1}: Units per second: ${unitsPerSecond}`);
        }

        // Generate report
        logger.info(`=== Echo Test Results ===`);
        logger.info(`Total echoes received: ${testResults.receivedEchoes.length}`);
        
        // Print timing table
        logger.info(`Movement Timing Analysis:`);
        logger.info(`Move | Echoes | Resp(ms) | Comp(ms) | Final Pos | Error`);
        logger.info(`-----|--------|----------|----------|-----------|------`);
        testResults.timingData.forEach(t => {
            logger.info(
                `${t.move.toString().padEnd(4)} | ${t.echoesReceived.toString().padEnd(6)} | ` +
                `${t.responseTime.toString().padEnd(8)} | ${t.completionTime.toString().padEnd(8)} | ` +
                `${t.finalPosition.toString().padEnd(9)} | ${t.positionError}`
            );
        });

        // Print discrepancies if any
        if (testResults.discrepancies.length > 0) {
            logger.warn(`Position Discrepancies Found:`);
            testResults.discrepancies.forEach(d => {
                logger.warn(
                    `Move ${d.move}: Expected ${d.expected}, got ${d.actual} ` +
                    `(error: ${d.error})`
                );
            });
        } else {
            logger.info(`All moves reached their targets within tolerance`);
        }

        // Calculate echo latency statistics
        const latencies = testResults.timingData.map(t => t.responseTime);
        const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
        const maxLatency = Math.max(...latencies);
        
        logger.info(`Echo Latency Statistics:`);
        logger.info(`Average: ${avgLatency.toFixed(2)}ms`);
        logger.info(`Maximum: ${maxLatency}ms`);

        // Calculate echo rate during movements
        const activePeriods = testResults.timingData
            .filter(t => t.echoesReceived > 1)
            .map(t => ({
                duration: t.completionTime - t.responseTime,
                echoes: t.echoesReceived - 1 // Exclude initial response
            }));
        
        if (activePeriods.length > 0) {
            const echoRates = activePeriods.map(p => 
                (p.echoes / (p.duration / 1000)).toFixed(2)
            );
            logger.info(`Echo Rates During Movement:`);
            logger.info(`Move | Echoes/sec`);
            logger.info(`-----|-----------`);
            activePeriods.forEach((p, i) => {
                logger.info(`${i+1}    | ${echoRates[i]}`);
            });
        }

        return testResults;

    } catch (error) {
        logger.error(`Echo test failed: ${error.message}`);
        throw error;
    } finally {
        // Restore original handler
        faderController.midiHandler.controller.handleMIDIMessage = originalHandler;
        
        // Reset fader to 0
        await faderController.moveFaders(
            new FaderMove(faderIndex, 0, 50),
            true
        );
        
        logger.info(`=== Echo Test Complete ===`);
    }
}

function processTestResults(testResults) {
    const summary = {
        totalMoves: testResults.timingData.length,
        totalEchoes: testResults.receivedEchoes.length,
        averageResponseTime: 0,
        maxResponseTime: 0,
        averageCompletionTime: 0,
        maxCompletionTime: 0,
        averagePositionError: 0,
        maxPositionError: 0,
        averageUnitsPerSecond: 0,
        maxUnitsPerSecond: 0,
        discrepancies: testResults.discrepancies.length,
        successRate: 0 // Percentage of moves within tolerance
    };

    if (testResults.timingData.length > 0) {
        // Calculate averages and maximums
        const responseTimes = testResults.timingData.map(t => t.responseTime);
        const completionTimes = testResults.timingData.map(t => t.completionTime);
        const positionErrors = testResults.timingData.map(t => t.positionError);

        summary.averageResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
        summary.maxResponseTime = Math.max(...responseTimes);

        summary.averageCompletionTime = completionTimes.reduce((a, b) => a + b, 0) / completionTimes.length;
        summary.maxCompletionTime = Math.max(...completionTimes);

        summary.averagePositionError = positionErrors.reduce((a, b) => a + b, 0) / positionErrors.length;
        summary.maxPositionError = Math.max(...positionErrors);

        summary.averageUnitsPerSecond = testResults.timingData.reduce((sum, t) => sum + parseFloat(t.unitsPerSecond), 0) / testResults.timingData.length;
        summary.maxUnitsPerSecond = Math.max(...testResults.timingData.map(t => parseFloat(t.unitsPerSecond)));

        // Calculate success rate
        const successfulMoves = testResults.timingData.filter(t => t.positionError <= 50); // Tolerance threshold
        summary.successRate = (successfulMoves.length / testResults.timingData.length) * 100;
    }

    return summary;
}

async function testHardwarePerformance(faderController, logger, faderIndex) {
    // Test parameters: speeds and target positions
    const testSpeeds = [5, 10, 25, 50, 75, 100]; // Different speeds to test
    const testTargets = [0, 100]; // Test from 0% to 100% and back
    const testResults = [];
    logger.info(`=== Starting Hardware Performance Test ===`);
    logger.info(`Testing fader ${faderIndex} with speeds: ${testSpeeds.join(', ')}`);

    // Ensure echoes array exists
    if (!faderController.midiHandler.controller.echoes) {
        faderController.midiHandler.controller.echoes = [];
    }

    // Override MIDI handler to capture echoes
    const originalHandler = faderController.midiHandler.controller.handleMIDIMessage;
    faderController.midiHandler.controller.handleMIDIMessage = function(message) {
        if (message.type === 'PITCH_BEND') {
            const position = (message.data2 << 7) | message.data1;
            const timestamp = Date.now();
            faderController.midiHandler.controller.echoes.push({
                index: message.channel,
                position,
                raw: message.raw,
                timestamp
            });

            if (faderController.config.MIDILog) {
                logger.debug(`ECHO RECV: Fader ${message.channel} -> ${position}`);
            }
        }
        originalHandler.call(this, message);
    };

    for (const speed of testSpeeds) {
        for (let i = 0; i < testTargets.length - 1; i++) {
            const startTarget = testTargets[i];
            const endTarget = testTargets[i + 1];

            logger.info(`[TestLogger] [MAIN] Testing move from ${startTarget}% to ${endTarget}% at speed ${speed}`);
            const moveStart = Date.now();

            // Create and execute the move command
            const moveCmd = new FaderMove(faderIndex, endTarget, speed);
            await faderController.moveFaders(moveCmd, false);

            // Wait for echoes to settle
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Analyze echoes for this move
            const echoes = faderController.midiHandler.controller.echoes.filter(
                e => e.index === faderIndex && e.timestamp >= moveStart
            );

            if (echoes.length === 0) {
                logger.warn(`[TestLogger] [MAIN] No echoes received for move from ${startTarget}% to ${endTarget}% at speed ${speed}`);
                continue;
            }

            // Calculate completion time
            const lastEcho = echoes[echoes.length - 1];
            const completionTime = lastEcho.timestamp - moveStart;

            // Calculate unit/s (14-bit integers per second)
            const positionDelta = Math.abs(lastEcho.position - echoes[0].position);
            const unitsPerSecond = (positionDelta / (completionTime / 1000)).toFixed(2);

            logger.info(`[TestLogger] [MAIN] Move completed in ${completionTime} ms with ${unitsPerSecond} units/s`);

            // Record the result
            testResults.push({
                speed,
                startTarget,
                endTarget,
                completionTime,
                unitsPerSecond // Add this to the results
            });
            await faderController.reset(faderIndex);
        }
    }

    // Restore original MIDI handler
    faderController.midiHandler.controller.handleMIDIMessage = originalHandler;

    // Save results to a file
    const resultsFilePath = path.join(__dirname, 'hardwarePerformanceResults.json');
    fs.writeFileSync(resultsFilePath, JSON.stringify(testResults, null, 2), 'utf8');
    logger.info(`[TestLogger] [MAIN] Hardware performance results saved to ${resultsFilePath}`);

    return testResults;
}

(async function runAllTests() {
    const logger = new CustomLogger(console, 'TestLogger', 'MAIN');

    try {
        const faderController = new FaderController({ logger, MIDILog: false, MoveLog: false });
        const faderIndex = 0; // Change this to the desired fader index
        const serialConfig = {
            port: "/dev/ttyUSB0",
            baudRate: 1000000,
            retries: 5 // Added retry capability from V2
        };

        // Use new setupSerial interface
        await faderController.setupSerial(serialConfig);

        // Start with calibration flag from config
        await faderController.start();
        // === Run Echo Response Test ===
        logger.info(`[TestLogger] [MAIN] === Running Echo Response Test ===`);
        const echoTestResults = await testEchoResponse(faderController, logger, faderIndex);

        // Process and log the results of the echo response test
        const echoSummary = processTestResults(echoTestResults);
        const echoSummaryFilePath = path.join(__dirname, 'echoTestSummary.json');
        fs.writeFileSync(echoSummaryFilePath, JSON.stringify(echoSummary, null, 2), 'utf8');
        logger.info(`[TestLogger] [MAIN] Echo test summary saved to ${echoSummaryFilePath}`);

        logger.info(`[TestLogger] [MAIN] === Echo Test Summary ===`);
        logger.info(JSON.stringify(echoSummary, null, 2));

        // === Run Hardware Performance Test ===
        logger.info(`[TestLogger] [MAIN] === Running Hardware Performance Test ===`);
        const performanceResults = await testHardwarePerformance(faderController, logger, faderIndex);

        // Analyze results to find the fastest completion time
        const fastestMove = performanceResults.reduce((fastest, current) => {
            return current.completionTime < fastest.completionTime ? current : fastest;
        }, performanceResults[0]);

        logger.info(`[TestLogger] [MAIN] === Fastest Move ===`);
        logger.info(`[TestLogger] [MAIN] Speed: ${fastestMove.speed}`);
        logger.info(`[TestLogger] [MAIN] Start Target: ${fastestMove.startTarget}%`);
        logger.info(`[TestLogger] [MAIN] End Target: ${fastestMove.endTarget}%`);
        logger.info(`[TestLogger] [MAIN] Completion Time: ${fastestMove.completionTime} ms`);

        // Save performance results
        const performanceResultsFilePath = path.join(__dirname, 'hardwarePerformanceResults.json');
        fs.writeFileSync(performanceResultsFilePath, JSON.stringify(performanceResults, null, 2), 'utf8');
        logger.info(`[TestLogger] [MAIN] Hardware performance results saved to ${performanceResultsFilePath}`);

    } catch (error) {
        logger.error(`[TestLogger] [MAIN] Error during tests: ${error.message}`);
    } finally {
        logger.info(`[TestLogger] [MAIN] === All Tests Complete ===`);
    }
})();