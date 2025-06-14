// api.js - API interaction functionality

import { elements } from './elements.js';
import { state } from './main.js';
import { extractVideoId } from './utils.js';
import { showError, showLoading, showNotification } from './ui.js';
import { setupVideoPlayer } from './video.js';
import { loadTranscript } from './transcript.js';
import { updateChapters } from './chapters.js';
import { checkSceneDetection } from './scenes.js';
import { fetchOcrResults } from './ocr.js';

/**
 * Resets all video-related states when loading a new video
 */
function resetVideoStates() {
    // Reset SSE connection if it exists
    if (window.sseConnection) {
        console.log('Closing existing SSE connection');
        window.sseConnection.close();
        window.sseConnection = null;
    }
    
    // Reset OCR state
    state.ocrResults = [];
    
    // Remove any existing progress containers
    const progressContainer = document.getElementById('ocrProgressContainer');
    if (progressContainer) {
        progressContainer.remove();
    }

    // Reset video player
    const videoPlayer = elements.videoPlayer;
    videoPlayer.pause();
    videoPlayer.removeAttribute('src');
    videoPlayer.load();

    // Clear existing transcript and chapters
    elements.transcriptContainer.innerHTML = '';
    elements.chaptersContainer.innerHTML = '<p>Click "Generate Summary" to create chapter markers from the transcript.</p>';
    
    // Reset chapter state
    state.videoChapters = [];
    
    // Reset scene detection state
    if (state.sceneDetectionInterval) {
        clearInterval(state.sceneDetectionInterval);
        state.sceneDetectionInterval = null;
    }
    state.videoScenes = [];
    
    // Reset slide content and disable search
    elements.slideContentContainer.innerHTML = `
        <div class="coming-soon">
            <i class="fas fa-cogs"></i>
            <h3>Processing Text Elements</h3>
            <p>Text detection and OCR will begin after scene detection is complete.</p>
        </div>
    `;
    elements.slideSearch.disabled = true;
    elements.slideSearch.value = '';
    elements.clearSlideSearchBtn.classList.remove('visible');
    elements.slideSearchResultsCount.textContent = '0/0';
    elements.prevSlideSearchBtn.disabled = true;
    elements.nextSlideSearchBtn.disabled = true;

    // Reset search states
    state.searchResults = [];
    state.currentSearchIndex = -1;
    state.slideSearchResults = [];
    state.currentSlideSearchIndex = -1;

    // Reset transcript-OCR relationships
    state.transcriptOcrRelationships = null;
    state.ocr_to_transcript = {};
    state.transcript_to_ocr = {};

    // Reset current transcript
    state.currentTranscript = [];
}

/**
 * Processes a YouTube video
 */
export async function processVideo() {
    const url = elements.youtubeUrl.value;
    const videoId = extractVideoId(url);
    
    if (!videoId) {
        showError('Invalid YouTube URL');
        return;
    }

    // Save the URL to localStorage
    localStorage.setItem('lastYoutubeUrl', url);

    showError('');
    showLoading(true);
    elements.generateSummaryBtn.disabled = true;

    try {
        // Reset all video-related states
        resetVideoStates();

        const response = await fetch(`/download/${videoId}`);
        const data = await response.json();

        if (!data.success) {
            throw new Error(data.error);
        }

        // Set new source and wait for metadata to load
        await new Promise((resolve, reject) => {
            elements.videoPlayer.src = data.video_url;
            
            elements.videoPlayer.onloadedmetadata = () => {
                setupVideoPlayer(elements.videoPlayer);
                resolve();
            };
            
            elements.videoPlayer.onerror = () => {
                reject(new Error('Failed to load video'));
            };
        });

        // Store video ID
        state.currentVideoId = videoId;
        
        // Check transcript availability
        const hasYoutubeTranscript = data.has_youtube_transcript;
        const hasWhisperTranscript = data.has_whisper_transcript;
        
        // Determine which transcript to use based on preference and availability
        let transcriptToUse = data.transcript;
        let transcriptSource = state.currentTranscriptSource;
        
        if (transcriptSource === 'whisper' && !hasWhisperTranscript) {
            // If whisper is preferred but not available, show notification
            if (hasYoutubeTranscript) {
                showNotification('Whisper transcript not available. Using YouTube transcript instead.', 'info');
                transcriptSource = 'youtube';
            } else {
                showNotification('No transcripts available. Please generate a Whisper transcript in Settings.', 'info');
                transcriptSource = null;
            }
        } else if (transcriptSource === 'youtube' && !hasYoutubeTranscript) {
            // If youtube is preferred but not available, try whisper
            if (hasWhisperTranscript) {
                showNotification('YouTube transcript not available. Using Whisper transcript instead.', 'info');
                transcriptSource = 'whisper';
                
                // Fetch Whisper transcript
                const whisperResponse = await fetch(`/get_transcript/${videoId}/whisper`);
                const whisperData = await whisperResponse.json();
                if (whisperData.success) {
                    transcriptToUse = whisperData.transcript;
                }
            } else {
                showNotification('No transcripts available. Please generate a Whisper transcript in Settings.', 'info');
                transcriptSource = null;
            }
        }
        
        // Update current transcript source
        state.currentTranscriptSource = transcriptSource;

        if (transcriptToUse) {
            state.currentTranscript = transcriptToUse;
            
            // Check for existing summary
            const summaryResponse = await fetch(`/summary/${videoId}`);
            const summaryData = await summaryResponse.json();
            
            if (summaryData.success && summaryData.exists) {
                // Load existing summary
                updateChapters(summaryData.chapters);
            } else {
                elements.chaptersContainer.innerHTML = '<p>Click "Generate Summary" to create chapter markers from the transcript.</p>';
            }

            // Update transcript display
            loadTranscript(transcriptToUse);

            // Enable generate summary button if transcript is available
            elements.generateSummaryBtn.disabled = false;
        } else {
            elements.transcriptContainer.innerHTML = '<p>No transcript available for this video.</p>';
            elements.generateSummaryBtn.disabled = true;
        }

        // Start polling for scene detection results
        if (state.sceneDetectionInterval) {
            clearInterval(state.sceneDetectionInterval);
        }
        
        elements.scenesContainer.innerHTML = '<p>Detecting scene changes...</p>';
        
        // Check immediately and then every 2 seconds
        await checkSceneDetection(videoId);
        state.sceneDetectionInterval = setInterval(() => checkSceneDetection(videoId), 2000);
        
        // Fetch OCR results (will connect to SSE for real-time updates)
        fetchOcrResults(videoId);

        // Load transcript-OCR relationships if available
        loadTranscriptOcrRelationships(videoId);

    } catch (error) {
        showError(`Error: ${error.message}`);
    } finally {
        showLoading(false);
    }
}

/**
 * Processes a video file upload
 */
export async function processVideoUpload(file) {
    showError('');
    showLoading(true);
    elements.generateSummaryBtn.disabled = true;

    try {
        // Reset all video-related states
        resetVideoStates();

        // Create FormData and append file
        const formData = new FormData();
        formData.append('video', file);

        const response = await fetch('/upload_video', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();

        if (!data.success) {
            throw new Error(data.error);
        }

        // Set new source and wait for metadata to load
        await new Promise((resolve, reject) => {
            elements.videoPlayer.src = data.video_url;
            
            elements.videoPlayer.onloadedmetadata = () => {
                setupVideoPlayer(elements.videoPlayer);
                resolve();
            };
            
            elements.videoPlayer.onerror = () => {
                reject(new Error('Failed to load video'));
            };
        });

        // Store video ID
        state.currentVideoId = data.video_id;
        
        // Check if we have an existing transcript in the response
        console.log("check transcript", data.transcript)
        if (data.transcript) {
            console.log('Using existing transcript');
            state.currentTranscript = data.transcript;
            state.currentTranscriptSource = data.has_whisper_transcript ? 'whisper' : 'youtube';
            
            // Update transcript display
            loadTranscript(data.transcript);
            
            // Enable generate summary button
            elements.generateSummaryBtn.disabled = false;
            
            // Check for existing summary
            const summaryResponse = await fetch(`/summary/${data.video_id}`);
            const summaryData = await summaryResponse.json();
            
            if (summaryData.success && summaryData.exists) {
                // Load existing summary
                updateChapters(summaryData.chapters);
            } else {
                elements.chaptersContainer.innerHTML = '<p>Click "Generate Summary" to create chapter markers from the transcript.</p>';
            }
        }
        // If transcript is being generated, show progress
        else if (data.transcript_in_progress) {
            // Show a message in the transcript container
            elements.transcriptContainer.innerHTML = `
                <div class="transcript-processing">
                    <i class="fas fa-spinner fa-spin"></i>
                    <p>Generating transcript with Whisper AI. This may take several minutes...</p>
                </div>
            `;
            
            // Start polling for transcript completion
            const checkWhisperTranscript = async () => {
                try {
                    const whisperResponse = await fetch(`/whisper_transcript_status/${data.video_id}`);
                    const whisperData = await whisperResponse.json();
                    
                    if (whisperData.status === 'complete') {
                        clearInterval(whisperCheckInterval);
                        
                        // Transcript is ready, update UI
                        showNotification('Whisper transcript generation complete!', 'success');
                        
                        // Update current transcript
                        state.currentTranscript = whisperData.transcript;
                        state.currentTranscriptSource = 'whisper';
                        
                        // Update transcript display
                        loadTranscript(whisperData.transcript);
                        
                        // Enable generate summary button
                        elements.generateSummaryBtn.disabled = false;
                    } else if (whisperData.status === 'error') {
                        clearInterval(whisperCheckInterval);
                        showError(`Error generating transcript: ${whisperData.error}`);
                    } else if (whisperData.status === 'in_progress' && whisperData.progress) {
                        // Update progress indicator
                        elements.transcriptContainer.innerHTML = `
                            <div class="transcript-processing">
                                <i class="fas fa-spinner fa-spin"></i>
                                <div class="progress-container">
                                    <div class="progress-bar">
                                        <div class="progress-fill" style="width: ${whisperData.progress}%"></div>
                                    </div>
                                    <div class="progress-text">${Math.round(whisperData.progress)}%</div>
                                </div>
                                <p>Generating transcript with Whisper AI...</p>
                            </div>
                        `;
                    }
                } catch (error) {
                    console.error('Error checking Whisper transcript status:', error);
                }
            };
            
            // Check immediately and then every 5 seconds
            checkWhisperTranscript();
            const whisperCheckInterval = setInterval(checkWhisperTranscript, 5000);
        }
        // No transcript available and not being generated
        else {
            elements.transcriptContainer.innerHTML = '<p>No transcript available for this video.</p>';
            elements.generateSummaryBtn.disabled = true;
        }
        
        // Start polling for scene detection results
        if (state.sceneDetectionInterval) {
            clearInterval(state.sceneDetectionInterval);
        }
        
        elements.scenesContainer.innerHTML = '<p>Detecting scene changes...</p>';
        
        // Check immediately and then every 2 seconds
        await checkSceneDetection(data.video_id);
        state.sceneDetectionInterval = setInterval(() => checkSceneDetection(data.video_id), 2000);
        
        // Fetch OCR results (will connect to SSE for real-time updates)
        fetchOcrResults(data.video_id);
        loadTranscriptOcrRelationships(data.video_id);

    } catch (error) {
        showError(`Error: ${error.message}`);
    } finally {
        showLoading(false);
    }
}

/**
 * Checks the status of the YOLO model
 */
export async function checkYoloStatus() {
    try {
        const response = await fetch('/yolo_status');
        const data = await response.json();
        
        if (!data.loaded) {
            console.warn("YOLO model not loaded:", data.error);
            showError('Object detection (YOLO) is not available: ' + data.error);
        }
    } catch (error) {
        console.error("Error checking YOLO status:", error);
    }
}

/**
 * Loads the transcript-OCR relationships for a video
 * @param {string} videoId - The YouTube video ID
 * @returns {Promise<boolean>} - Whether the relationships were loaded successfully
 */
export async function loadTranscriptOcrRelationships(videoId) {
    try {
        console.log('Loading transcript-OCR relationships...');
        const response = await fetch(`/get_transcript_ocr_relationships/${videoId}`);
        const data = await response.json();
        
        if (data.success) {
            // Store relationships in state for later use
            state.transcriptOcrRelationships = data;
            
            // Store for quick lookups
            state.ocr_to_transcript = {};
            if (data.ocr_to_transcript_relationships) {
                data.ocr_to_transcript_relationships.forEach(rel => {
                    // Create key using scene_index and ocr_text
                    const key = `${rel.scene_index}_${rel.ocr_text}`;
                    state.ocr_to_transcript[key] = rel.matches;
                });
            }
            
            // Store transcript to OCR relationships for quick lookups
            state.transcript_to_ocr = {};
            if (data.transcript_to_ocr_relationships) {
                data.transcript_to_ocr_relationships.forEach(rel => {
                    state.transcript_to_ocr[rel.transcript_index] = rel.matches;
                });
            }
            console.log('Transcript-OCR relationships loaded successfully');
            return true;
        } else if (data.error === "Embeddings not computed yet") {
            // Trigger computation of embeddings
            console.log('Triggering computation of transcript-OCR relationships...');
            const computeResponse = await fetch(`/compute_embeddings/${videoId}`, {
                method: 'POST'
            });
            
            if (computeResponse.ok) {
                // Set up polling to check for completion
                const checkEmbeddings = async () => {
                    const statusResponse = await fetch(`/embeddings_status/${videoId}`);
                    const statusData = await statusResponse.json();
                    
                    if (statusData.success) {
                        if (statusData.status === 'completed') {
                            clearInterval(checkInterval);
                            // Load the completed relationships
                            return loadTranscriptOcrRelationships(videoId);
                        } else if (statusData.status === 'failed') {
                            clearInterval(checkInterval);
                            console.error('Failed to compute transcript-OCR relationships:', statusData.error);
                            return false;
                        }
                        // Still in progress, continue polling
                    } else {
                        clearInterval(checkInterval);
                        console.error('Failed to check embedding status:', statusData.error);
                        return false;
                    }
                };
                
                // Check every 3 seconds
                const checkInterval = setInterval(checkEmbeddings, 3000);
                
                // Also check immediately
                await checkEmbeddings();
                return true;
            } else {
                console.error('Failed to trigger transcript-OCR relationship computation');
                return false;
            }
        } else {
            console.error('Failed to load transcript-OCR relationships:', data.error);
            return false;
        }
    } catch (error) {
        console.error('Error loading transcript-OCR relationships:', error);
        return false;
    }
} 