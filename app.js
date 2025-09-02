// DOM Elements
const sonarButton = document.getElementById('sonarButton');
const statusDisplay = document.getElementById('status-display');
const canvas = document.getElementById('visualizer');
const canvasCtx = canvas.getContext('2d');
const chirpPlayer = document.getElementById('chirp-player');

// --- TUNING VARIABLES ---
// We can be a bit stricter now that we're filtering by magnitude.
const MOTION_THRESHOLD_HZ = 30; 
// *** CRITICAL ***: The echo must be louder than this to be considered valid.
// Start at -60. If you get no detections, try -65 or -70.
const PEAK_MAGNITUDE_THRESHOLD_DB = -60; 
const PING_INTERVAL_MS = 400;

// Audio and Sonar State
let audioContext;
let analyser;
let source;
let pingInterval;
let analysisFrame;

let isSonarActive = false;
let baselineFrequency = 0;
const CHIRP_START_HZ = 15000;
const CHIRP_END_HZ = 18000;

// --- Main Control ---
sonarButton.addEventListener('click', () => {
    if (!isSonarActive) {
        startSonar();
    } else {
        stopSonar();
    }
});

// --- Sonar Functions ---

async function startSonar() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudio-Context)();
        // Generate a LOUDER chirp audio source
        const chirpURL = generateChirpWAV(0.8); // Pass in a gain value (0.0 to 1.0)
        chirpPlayer.src = chirpURL;
    }
    
    if (audioContext.state === 'suspended') {
        await audioContext.resume();
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: {
            // These settings can help reduce automatic adjustments by the browser
            echoCancellation: false,
            autoGainControl: false,
            noiseSuppression: false
        }});
        source = audioContext.createMediaStreamSource(stream);
        
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 8192;
        analyser.smoothingTimeConstant = 0.2;
        source.connect(analyser);

        isSonarActive = true;
        updateUI(true, "Calibrating...");

        analyseAudio();
        
        setTimeout(() => {
            calibrate().then((success) => {
                if (success) {
                    pingInterval = setInterval(playChirp, PING_INTERVAL_MS);
                    updateUI(true, "Active");
                } else {
                    alert("Calibration failed. No clear echo detected. Try moving closer to a reflective surface.");
                    stopSonar();
                }
            });
        }, 500);

    } catch (err) {
        alert('Microphone access denied. Please allow microphone access.');
        console.error('Error accessing microphone:', err);
    }
}

function stopSonar() {
    isSonarActive = false;
    clearInterval(pingInterval);
    cancelAnimationFrame(analysisFrame);
    if (source) source.disconnect();
    if (audioContext) audioContext.suspend(); // Suspend context to save power
    updateUI(false, "Idle");
}

function updateUI(isActive, statusText) {
    statusDisplay.textContent = `Status: ${statusText}`;
    sonarButton.textContent = isActive ? 'Stop Sonar' : 'Start Sonar';
    sonarButton.classList.toggle('active', isActive);
    statusDisplay.className = isActive ? (statusText.includes("Motion") ? 'status-alert' : 'status-active') : 'status-idle';
}

// --- Audio Generation & Analysis ---

function playChirp() {
    chirpPlayer.currentTime = 0; // Rewind to start before playing
    chirpPlayer.play().catch(e => console.error("Audio playback failed:", e));
}

function analyseAudio() {
    if (!isSonarActive) return;

    const frequencyData = new Float32Array(analyser.frequencyBinCount);
    analyser.getFloatFrequencyData(frequencyData);
    
    const peak = findPeakFrequency(frequencyData);

    if (baselineFrequency > 0) {
        const dopplerShift = peak.frequency - baselineFrequency;

        console.log(`Peak Mag: ${peak.magnitude.toFixed(1)} dB, Freq: ${peak.frequency.toFixed(1)} Hz, Shift: ${dopplerShift.toFixed(1)} Hz`);

        // Check if the echo is loud enough AND the shift is significant
        if (peak.magnitude > PEAK_MAGNITUDE_THRESHOLD_DB && Math.abs(dopplerShift) > MOTION_THRESHOLD_HZ) {
            const direction = dopplerShift > 0 ? "Approaching" : "Receding";
            updateUI(true, `Motion Detected - ${direction}!`);
        } else {
            updateUI(true, "Active");
        }
    }
    
    visualize(frequencyData);
    analysisFrame = requestAnimationFrame(analyseAudio);
}

function findPeakFrequency(data) {
    const binWidth = audioContext.sampleRate / analyser.fftSize;
    const startIndex = Math.floor(CHIRP_START_HZ / binWidth);
    const endIndex = Math.ceil(CHIRP_END_HZ / binWidth);
    let peakMagnitude = -Infinity;
    let peakIndex = -1;

    for (let i = startIndex; i <= endIndex; i++) {
        if (data[i] > peakMagnitude) {
            peakMagnitude = data[i];
            peakIndex = i;
        }
    }
    
    return { frequency: peakIndex * binWidth, magnitude: peakMagnitude };
}

async function calibrate() {
    let validReadings = [];
    const calibrationCycles = 10; // More cycles for better averaging
    updateUI(true, "Calibrating... Do not move.");

    for (let i = 0; i < calibrationCycles; i++) {
        playChirp();
        await new Promise(resolve => setTimeout(resolve, 150));
        const frequencyData = new Float32Array(analyser.frequencyBinCount);
        analyser.getFloatFrequencyData(frequencyData);
        const peak = findPeakFrequency(frequencyData);
        // Only accept the reading if it's loud enough to be a real echo
        if (peak.magnitude > PEAK_MAGNITUDE_THRESHOLD_DB) {
            validReadings.push(peak.frequency);
        }
    }

    if (validReadings.length > calibrationCycles / 2) { // Require at least half the readings to be valid
        baselineFrequency = validReadings.reduce((a, b) => a + b, 0) / validReadings.length;
        console.log(`Calibration successful. Baseline frequency: ${baselineFrequency.toFixed(2)} Hz`);
        return true;
    } else {
        console.error("Calibration failed: Could not find a consistent, strong echo.");
        return false;
    }
}

function visualize(frequencyData) {
    const binWidth = audioContext.sampleRate / analyser.fftSize;
    const startIndex = Math.floor(CHIRP_START_HZ / binWidth);
    const endIndex = Math.ceil(CHIRP_END_HZ / binWidth);
    const range = endIndex - startIndex;
    canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
    canvasCtx.fillStyle = 'rgba(0, 255, 127, 0.5)';
    const barWidth = canvas.width / range;
    for (let i = 0; i < range; i++) {
        const barHeight = Math.max(0, (frequencyData[startIndex + i] - PEAK_MAGNITUDE_THRESHOLD_DB) * 4); // Scale relative to threshold
        canvasCtx.fillRect(i * barWidth, canvas.height - barHeight, barWidth, barHeight);
    }
}

// --- WAV File Generation (Now with gain control) ---
function generateChirpWAV(gain = 0.5) { // Default gain is 50%
    const duration = 0.05;
    const sampleRate = audioContext.sampleRate;
    const numFrames = duration * sampleRate;
    const audioBuffer = audioContext.createBuffer(1, numFrames, sampleRate);
    const channelData = audioBuffer.getChannelData(0);

    for (let i = 0; i < numFrames; i++) {
        const time = i / sampleRate;
        const freq = CHIRP_START_HZ + (CHIRP_END_HZ - CHIRP_START_HZ) * (time / duration);
        const phase = 2 * Math.PI * (CHIRP_START_HZ * time + (CHIRP_END_HZ - CHIRP_START_HZ) * time * time / (2 * duration));
        channelData[i] = Math.sin(phase) * gain; // Apply gain here
    }

    // Apply a fade in/out envelope to prevent clicking
    for (let i = 0; i < sampleRate * 0.01; i++) {
        channelData[i] *= (i / (sampleRate * 0.01));
        channelData[numFrames - 1 - i] *= (i / (sampleRate * 0.01));
    }

    return bufferToWave(audioBuffer, numFrames);
}

function bufferToWave(abuffer, len) {
    let numOfChan = abuffer.numberOfChannels,
        length = len * numOfChan * 2 + 44,
        buffer = new ArrayBuffer(length),
        view = new DataView(buffer),
        channels = [], i, sample,
        offset = 0,
        pos = 0;

    setUint32(0x46464952); // "RIFF"
    setUint32(length - 8); 
    setUint32(0x45564157); // "WAVE"
    setUint32(0x20746d66); // "fmt "
    setUint32(16);
    setUint16(1); 
    setUint16(numOfChan);
    setUint32(abuffer.sampleRate);
    setUint32(abuffer.sampleRate * 2 * numOfChan);
    setUint16(numOfChan * 2);
    setUint16(16);
    setUint32(0x61746164); // "data"
    setUint32(length - pos - 4);

    for (i = 0; i < abuffer.numberOfChannels; i++)
        channels.push(abuffer.getChannelData(i));

    while (pos < length) {
        for (i = 0; i < numOfChan; i++) {
            sample = Math.max(-1, Math.min(1, channels[i][offset]));
            sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
            view.setInt16(pos, sample, true);
            pos += 2;
        }
        offset++;
    }

    return "data:audio/wav;base64," + btoa(String.fromCharCode.apply(null, new Uint8Array(buffer)));

    function setUint16(data) { view.setUint16(pos, data, true); pos += 2; }
    function setUint32(data) { view.setUint32(pos, data, true); pos += 4; }
}
