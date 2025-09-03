// DOM Elements
const sonarButton = document.getElementById('sonarButton');
const statusDisplay = document.getElementById('status-display');
const canvas = document.getElementById('visualizer');
const canvasCtx = canvas.getContext('2d');
const chirpPlayer = document.getElementById('chirp-player');

// --- TUNING VARIABLES ---
const MOTION_THRESHOLD_HZ = 10; 
const PEAK_MAGNITUDE_THRESHOLD_DB = -55; // Slightly more forgiving for laptops
const PING_INTERVAL_MS = 400; 
const CHIRP_DURATION_S = 0.1; // Longer chirp for a stronger echo

// --- NEW FREQUENCY RANGE ---
const CHIRP_START_HZ = 2000;
const CHIRP_END_HZ = 5000;

// Audio and Sonar State
let audioContext;
let analyser;
let source;
let pingInterval;
let analysisInterval; // Separate interval for analysis
let visualizerFrame;

let isSonarActive = false;
let baselineFrequency = 0;

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
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const chirpURL = generateChirpWAV(0.8);
        chirpPlayer.src = chirpURL;
    }
    
    if (audioContext.state === 'suspended') {
        await audioContext.resume();
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: {
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

        // Start the VISUALIZER loop only. The analysis loop will start after calibration.
        visualize();
        
        setTimeout(() => {
            calibrate().then((success) => {
                if (success) {
                    pingInterval = setInterval(playChirp, PING_INTERVAL_MS);
                    // Start the separate, slower ANALYSIS loop.
                    analysisInterval = setInterval(runDopplerAnalysis, 100); // Analyze 10 times/sec
                    updateUI(true, "Active");
                } else {
                    alert("Calibration failed. No clear echo detected. Try a different room or get closer to a wall.");
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
    clearInterval(analysisInterval); // Stop the analysis interval
    cancelAnimationFrame(visualizerFrame);
    if (source) source.disconnect();
    if (audioContext) audioContext.suspend();
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
    chirpPlayer.currentTime = 0;
    chirpPlayer.play().catch(e => console.error("Audio playback failed:", e));
}

// NEW: This is the dedicated, high-load analysis function
function runDopplerAnalysis() {
    if (!isSonarActive || !baselineFrequency) return;

    const frequencyData = new Float32Array(analyser.frequencyBinCount);
    analyser.getFloatFrequencyData(frequencyData);
    
    const peak = findPeakFrequency(frequencyData);
    const dopplerShift = peak.frequency - baselineFrequency;

    console.log(`Peak Mag: ${peak.magnitude.toFixed(1)} dB, Freq: ${peak.frequency.toFixed(1)} Hz, Shift: ${dopplerShift.toFixed(1)} Hz`);

    if (peak.magnitude > PEAK_MAGNITUDE_THRESHOLD_DB && Math.abs(dopplerShift) > MOTION_THRESHOLD_HZ) {
        const direction = dopplerShift > 0 ? "Approaching" : "Receding";
        updateUI(true, `Motion Detected - ${direction}!`);
    } else {
        updateUI(true, "Active");
    }
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
    const calibrationCycles = 10;
    updateUI(true, "Calibrating... Do not move.");

    for (let i = 0; i < calibrationCycles; i++) {
        playChirp();
        // Wait longer to account for the longer chirp and echo return time
        await new Promise(resolve => setTimeout(resolve, 200)); 
        const frequencyData = new Float32Array(analyser.frequencyBinCount);
        analyser.getFloatFrequencyData(frequencyData);
        const peak = findPeakFrequency(frequencyData);
        
        if (peak.magnitude > PEAK_MAGNITUDE_THRESHOLD_DB) {
            validReadings.push(peak.frequency);
        }
    }

    if (validReadings.length >= 3) { // Be more lenient with valid readings
        baselineFrequency = validReadings.reduce((a, b) => a + b, 0) / validReadings.length;
        console.log(`Calibration successful. Baseline frequency: ${baselineFrequency.toFixed(2)} Hz`);
        return true;
    } else {
        console.error("Calibration failed: Could not find a consistent, strong echo.");
        return false;
    }
}

// NEW: This loop is ONLY for drawing, ensuring the UI is never blocked.
function visualize() {
    const frequencyData = new Float32Array(analyser.frequencyBinCount);
    analyser.getFloatFrequencyData(frequencyData);
    
    const binWidth = audioContext.sampleRate / analyser.fftSize;
    const startIndex = Math.floor(CHIRP_START_HZ / binWidth);
    const endIndex = Math.ceil(CHIRP_END_HZ / binWidth);
    const range = endIndex - startIndex;
    
    canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
    canvasCtx.fillStyle = 'rgba(0, 255, 127, 0.5)';
    const barWidth = canvas.width / range;

    for (let i = 0; i < range; i++) {
        const barHeight = Math.max(0, (frequencyData[startIndex + i] - PEAK_MAGNITUDE_THRESHOLD_DB) * 4);
        canvasCtx.fillRect(i * barWidth, canvas.height - barHeight, barWidth, barHeight);
    }
    
    // Keep the animation loop running as long as the sonar is active
    if (isSonarActive) {
        visualizerFrame = requestAnimationFrame(visualize);
    }
}

// --- WAV File Generation (Now with longer duration) ---
function generateChirpWAV(gain = 0.8) {
    const duration = CHIRP_DURATION_S;
    const sampleRate = audioContext.sampleRate;
    const numFrames = duration * sampleRate;
    const audioBuffer = audioContext.createBuffer(1, numFrames, sampleRate);
    const channelData = audioBuffer.getChannelData(0);

    for (let i = 0; i < numFrames; i++) {
        const time = i / sampleRate;
        const freq = CHIRP_START_HZ + (CHIRP_END_HZ - CHIRP_START_HZ) * (time / duration);
        const phase = 2 * Math.PI * (CHIRP_START_HZ * time + (CHIRP_END_HZ - CHIRP_START_HZ) * time * time / (2 * duration));
        channelData[i] = Math.sin(phase) * gain;
    }

    // Apply a fade in/out envelope
    for (let i = 0; i < sampleRate * 0.01; i++) {
        channelData[i] *= (i / (sampleRate * 0.01));
        channelData[numFrames - 1 - i] *= (i / (sampleRate * 0.01));
    }

    return bufferToWave(audioBuffer, numFrames);
}

function bufferToWave(abuffer, len) {
    // This function is unchanged and remains the same as the previous version.
    let numOfChan = abuffer.numberOfChannels,
        length = len * numOfChan * 2 + 44,
        buffer = new ArrayBuffer(length),
        view = new DataView(buffer),
        channels = [], i, sample,
        offset = 0,
        pos = 0;

    setUint32(0x46464952); setUint32(length - 8); setUint32(0x45564157);
    setUint32(0x20746d66); setUint32(16); setUint16(1); setUint16(numOfChan);
    setUint32(abuffer.sampleRate); setUint32(abuffer.sampleRate * 2 * numOfChan);
    setUint16(numOfChan * 2); setUint16(16); setUint32(0x61746164);
    setUint32(length - pos - 4);

    for (i = 0; i < abuffer.numberOfChannels; i++) channels.push(abuffer.getChannelData(i));

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
