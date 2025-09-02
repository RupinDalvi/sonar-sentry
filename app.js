// DOM Elements
const sonarButton = document.getElementById('sonarButton');
const statusDisplay = document.getElementById('status-display');
const canvas = document.getElementById('visualizer');
const canvasCtx = canvas.getContext('2d');

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
const MOTION_THRESHOLD_HZ = 35; // Sensitivity for motion detection

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
    // Initialize the Audio Context after a user gesture (button click)
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    // Request microphone access
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        source = audioContext.createMediaStreamSource(stream);
        
        // Setup the Analyser node
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 8192; // Higher FFT size for better frequency resolution
        analyser.smoothingTimeConstant = 0.1; // Smoothen the data a bit
        source.connect(analyser);

        isSonarActive = true;
        updateUI(true, "Calibrating...");

        // Start the analysis and visualization loop
        analyseAudio();
        
        // Start chirping after a short delay
        setTimeout(() => {
             // Calibration phase
            calibrate().then(() => {
                pingInterval = setInterval(createChirp, 500); // Ping every 500ms
                updateUI(true, "Active");
            });
        }, 500);

    } catch (err) {
        alert('Microphone access denied. Please allow microphone access to use the app.');
        console.error('Error accessing microphone:', err);
    }
}

function stopSonar() {
    isSonarActive = false;
    clearInterval(pingInterval);
    cancelAnimationFrame(analysisFrame);
    
    // Disconnect nodes to stop processing
    if (source) source.disconnect();
    
    updateUI(false, "Idle");
}

function updateUI(isActive, statusText) {
    statusDisplay.textContent = `Status: ${statusText}`;
    sonarButton.textContent = isActive ? 'Stop Sonar' : 'Start Sonar';
    sonarButton.classList.toggle('active', isActive);

    if (statusText.includes("Motion")) {
        statusDisplay.className = 'status-alert';
    } else if (isActive) {
        statusDisplay.className = 'status-active';
    } else {
        statusDisplay.className = 'status-idle';
    }
}


// --- Audio Generation & Analysis ---

function createChirp() {
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    const chirpDuration = 0.05;

    oscillator.frequency.setValueAtTime(CHIRP_START_HZ, audioContext.currentTime);
    oscillator.frequency.linearRampToValueAtTime(CHIRP_END_HZ, audioContext.currentTime + chirpDuration);
    oscillator.type = 'sine';

    gainNode.gain.setValueAtTime(0, audioContext.currentTime);
    gainNode.gain.linearRampToValueAtTime(1, audioContext.currentTime + 0.01);
    gainNode.gain.linearRampToValueAtTime(0, audioContext.currentTime + chirpDuration);

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + chirpDuration);
}

function analyseAudio() {
    if (!isSonarActive) return;

    const frequencyData = new Float32Array(analyser.frequencyBinCount);
    analyser.getFloatFrequencyData(frequencyData); // Get frequency data in dB

    const peak = findPeakFrequency(frequencyData);

    // Only run Doppler check if calibration is complete
    if (baselineFrequency > 0) {
        const dopplerShift = peak.frequency - baselineFrequency;
        if (Math.abs(dopplerShift) > MOTION_THRESHOLD_HZ && peak.magnitude > -50) { // Check magnitude to avoid noise
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
    const sampleRate = audioContext.sampleRate;
    const binWidth = sampleRate / analyser.fftSize;
    
    // Convert our chirp Hz range to array indices
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
    
    return {
        frequency: peakIndex * binWidth,
        magnitude: peakMagnitude
    };
}

async function calibrate() {
    // Play a few chirps and average the peak echo frequency to find a stable baseline
    let totalFrequency = 0;
    const calibrationCycles = 5;

    for (let i = 0; i < calibrationCycles; i++) {
        createChirp();
        await new Promise(resolve => setTimeout(resolve, 150)); // Wait for echo
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
        const barHeight = (frequencyData[startIndex + i] + 100) * 2; // Normalize dB to a visual height
        canvasCtx.fillRect(i * barWidth, canvas.height - barHeight, barWidth, barHeight);
    }
}
