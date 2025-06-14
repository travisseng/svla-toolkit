// main.js - Main application entry point

import { setupVideoPlayer, updateTimeMarker } from './video.js';
import { loadTranscript, updateTranscriptDisplay, updateActiveTranscript } from './transcript.js';
import { checkSceneDetection, updateScenes, toggleSceneMarkers } from './scenes.js';
import { generateChapters, updateChapters } from './chapters.js';
import { setupSearch, setupSlideSearch, toggleTimestamps, toggleFuzzySearch } from './search.js';
import { fetchOcrResults, updateSlideContentDisplay } from './ocr.js';
import { setupTabs, showError, showLoading, showNotification, openSettingsModal, closeSettingsModal, saveSettings, generateWhisperTranscript } from './ui.js';
import { processVideo, checkYoloStatus, processVideoUpload } from './api.js';
import { elements } from './elements.js';
import { initInteractiveLayer } from './interactive-layer.js';

// Global state
export const state = {
    currentTranscript: [],
    videoScenes: [],
    sceneDetectionInterval: null,
    currentVideoId: null,
    currentDebugScene: null,
    showSceneMarkers: true,
    showTimestamps: true,
    fuzzySearchEnabled: true,
    searchResults: [],
    currentSearchIndex: -1,
    ocrResults: [],
    slideSearchResults: [],
    currentSlideSearchIndex: -1,
    currentTranscriptSource: 'youtube',  // Default transcript source
    interactiveLayerActive: false,
    showTranscriptHighlighting: true,  // Default to showing transcript highlighting
    // Transcript-OCR relationship data
    transcriptOcrRelationships: null,
    ocr_to_transcript: {}, // Map for quick lookup: scene_index_ocrText -> transcript matches
    transcript_to_ocr: {}  // Map for quick lookup: transcript_index -> OCR matches
};

// Initialize the application
function initApp() {
    // Check YOLO status when the page loads
    checkYoloStatus();
    
    // Set up tabs
    setupTabs();
    
    // Set up search functionality
    setupSearch();
    
    // Set up slide search functionality
    setupSlideSearch();
    
    // Initialize interactive layer
    initInteractiveLayer();
    console.log('Interactive layer initialized');
    
    // Add event listeners
    elements.loadVideoBtn.addEventListener('click', processVideo);
    elements.uploadVideoBtn.addEventListener('click', () => {
        elements.videoFile.click();
    });
    elements.videoFile.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (file) {
            processVideoUpload(file);
        }
    });
    elements.generateSummaryBtn.addEventListener('click', generateChapters);
    elements.closeDetectionBtn.addEventListener('click', () => {
        elements.detectionOverlay.style.display = 'none';
    });
    elements.debugDetectionsBtn.addEventListener('click', () => {
        debugDetections(state.currentDebugScene, state.currentVideoId);
    });
    elements.closeDebugBtn.addEventListener('click', () => {
        elements.debugOverlay.style.display = 'none';
    });
    elements.sceneToggle.addEventListener('change', toggleSceneMarkers);
    elements.timestampToggle.addEventListener('change', toggleTimestamps);
    elements.fuzzySearchToggle.addEventListener('change', toggleFuzzySearch);
    
    // Settings modal
    elements.settingsBtn.addEventListener('click', openSettingsModal);
    elements.closeSettingsBtn.addEventListener('click', closeSettingsModal);
    elements.saveSettingsBtn.addEventListener('click', saveSettings);
    
    // Whisper transcript generation
    elements.generateWhisperBtn.addEventListener('click', () => {
        if (state.currentVideoId) {
            generateWhisperTranscript(state.currentVideoId);
        } else {
            showNotification('Please load a video first', 'error');
        }
    });
    
    // Listen for transcript loaded events
    document.addEventListener('transcriptLoaded', (event) => {
        loadTranscript(event.detail);
    });
    
    // Check for last URL in localStorage
    const lastUrl = localStorage.getItem('lastYoutubeUrl');
    if (lastUrl) {
        elements.youtubeUrl.value = lastUrl;
    }
    
    // Fetch current transcript preference
    fetch('/get_transcript_preference')
        .then(response => response.json())
        .then(data => {
            state.currentTranscriptSource = data.preference || 'youtube';
        })
        .catch(error => {
            console.error('Error fetching transcript preference:', error);
        });
}

// Debug detections function
function debugDetections(scene, videoId) {
    if (!scene) return;
    
    const sceneIndex = scene.index || 0;
    
    fetch(`/scene_detections/${videoId}/${sceneIndex}`)
        .then(response => response.json())
        .then(data => {
            console.log("Debug detection data:", data);
            
            // Show debug info in the debug overlay
            const debugContent = elements.debugContent;
            debugContent.innerHTML = `
                <h3>Detection Debug Info</h3>
                <p>Video ID: ${videoId}</p>
                <p>Scene Index: ${sceneIndex}</p>
                <p>Has detections: ${data.has_detections}</p>
                <p>Detection count: ${data.detection_count}</p>
                <pre>${JSON.stringify(data, null, 2)}</pre>
            `;
            
            elements.debugOverlay.style.display = 'block';
        })
        .catch(error => {
            console.error("Error debugging detections:", error);
            showError("Error debugging detections. See console for details.");
        });
}

// Run initialization when DOM is fully loaded
document.addEventListener('DOMContentLoaded', function() {
    // Restore the last entered YouTube URL from localStorage if available
    const lastYoutubeUrl = localStorage.getItem('lastYoutubeUrl');
    if (lastYoutubeUrl) {
        elements.youtubeUrl.value = lastYoutubeUrl;
    }
    
    initApp();
});

// Export functions and state for use in other modules
export {
    initApp,
    debugDetections
}; 