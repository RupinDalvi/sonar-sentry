// DOM Elements
const sonarButton = document.getElementById('sonarButton');
const statusDisplay = document.getElementById('status-display');
const canvas = document.getElementById('visualizer');
const canvasCtx = canvas.getContext('2d');
const chirpPlayer = document.getElementById('chirp-player');

// --- TUNING VARIABLES ---
// Lower this to make the app more sensitive to small frequency shifts.
const MOTION_THRESHOLD_HZ = 25; 
// The echo must be louder than this dB value to be considered valid. Helps filter out noise.
const PEAK_MAGNITUDE_THRESHOLD_DB = -60; 
// How often the chirp is emitted in milliseconds.
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
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const chirpURL = generateChirpWAV();
        chirpPlayer.src = chirpURL;
    }
    
    if (audioContext.state === 'suspended') {
        await audioContext.resume();
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        source = audioContext.createMediaStreamSource(stream);
        
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 8192;
        analyser.smoothingTimeConstant = 0.1;
        source.connect(analyser);

        isSonarActive = true;
        updateUI(true, "Calibrating...");

        analyseAudio();
        
        setTimeout(() => {
            calibrate().then(() => {
                pingInterval = setInterval(playChirp, PING_INTERVAL_MS);
                updateUI(true, "Active");
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
    chirpPlayer.play().catch(e => console.error("Audio playback failed:", e));
}

function analyseAudio() {
    if (!isSonarActive) return;

    const frequencyData = new Float32Array(analyser.frequencyBinCount);
    analyser.getFloatFrequencyData(frequencyData);
    
    const peak = findPeakFrequency(frequencyData);

    // Only run Doppler check if calibration is complete
    if (baselineFrequency > 0) {
        const dopplerShift = peak.frequency - baselineFrequency;

        // --- DEBUGGING LOG ---
        // Open your browser's developer console (F12) to see this output.
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
    let totalFrequency = 0;
    const calibrationCycles = 5;
    for (let i = 0; i < calibrationCycles; i++) {
        playChirp();
        await new Promise(resolve => setTimeout(resolve, 150));
        const frequencyData = new Float32Array(analyser.frequencyBinCount);
        analyser.getFloatFrequencyData(frequencyData);
        totalFrequency += findPeakFrequency(frequencyData).frequency;
    }
    baselineFrequency = totalFrequency / calibrationCycles;
    console.log(`Calibration complete. Baseline frequency: ${baselineFrequency.toFixed(2)} Hz`);
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
        const barHeight = (frequencyData[startIndex + i] + 100) * 2; // Normalize dB for visualization
        canvasCtx.fillRect(i * barWidth, canvas.height - barHeight, barWidth, barHeight);
    }
}


// --- WAV File Generation (Unchanged) ---
// This function creates a WAV file in memory to ensure reliable playback
function generateChirpWAV() {
    const duration = 0.05;
    const sampleRate = audioContext.sampleRate;
    const numFrames = duration * sampleRate;
    const audioBuffer = audioContext.createBuffer(1, numFrames, sampleRate);
    const channelData = audioBuffer.getChannelData(0);

    const initialFreq = CHIRP_START_HZ;
    const finalFreq = CHIRP_END_HZ;
    
    for (let i = 0; i < numFrames; i++) {
        const time = i / sampleRate;
        const freq = initialFreq + (finalFreq - initialFreq) * (time / duration);
        const phase = 2 * Math.PI * (initialFreq * time + (finalFreq - initialFreq) * time * time / (2 * duration));
        channelData[i] = Math.sin(phase);
    }

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
