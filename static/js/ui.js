// ui.js - UI-related functions

import { elements } from './elements.js';
import { state } from './main.js';

/**
 * Shows an error message
 * @param {string} message - The error message to display
 */
export function showError(message) {
    elements.errorAlert.textContent = message;
    elements.errorAlert.style.display = message ? 'block' : 'none';
    
    if (message) {
        setTimeout(() => {
            elements.errorAlert.style.display = 'none';
        }, 5000);
    }
}

/**
 * Shows or hides the loading indicator
 * @param {boolean} isLoading - Whether to show the loading indicator
 */
export function showLoading(isLoading) {
    elements.loadingIndicator.style.display = isLoading ? 'block' : 'none';
}

/**
 * Sets up the tab switching functionality
 */
export function setupTabs() {
    elements.tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            // Remove active class from all buttons and panes
            elements.tabButtons.forEach(btn => btn.classList.remove('active'));
            elements.tabPanes.forEach(pane => pane.classList.remove('active'));
            
            // Add active class to clicked button
            button.classList.add('active');
            
            // Show corresponding pane
            const tabId = button.getAttribute('data-tab');
            document.getElementById(`${tabId}-tab`).classList.add('active');
        });
    });
}

/**
 * Shows a notification message
 * @param {string} message - The message to display
 * @param {string} type - The type of notification (info, success, error)
 */
export function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    // Fade in
    setTimeout(() => {
        notification.style.opacity = '1';
    }, 10);
    
    // Fade out and remove after 3 seconds
    setTimeout(() => {
        notification.style.opacity = '0';
        setTimeout(() => {
            document.body.removeChild(notification);
        }, 500);
    }, 3000);
}

/**
 * Opens the settings modal
 */
export function openSettingsModal() {
    elements.settingsModal.style.display = 'flex';
    
    // Set the current OCR preference
    fetch('/get_ocr_preference')
        .then(response => response.json())
        .then(data => {
            const preference = data.preference || 'tesseract';
            document.querySelector(`input[name="ocrPreference"][value="${preference}"]`).checked = true;
        })
        .catch(error => {
            console.error('Error fetching OCR preference:', error);
        });
    
    // Set the current transcript preference
    fetch('/get_transcript_preference')
        .then(response => response.json())
        .then(data => {
            const preference = data.preference || 'youtube';
            document.querySelector(`input[name="transcriptPreference"][value="${preference}"]`).checked = true;
            
            // Show/hide whisper controls based on preference
            elements.whisperControls.style.display = preference === 'whisper' ? 'block' : 'none';
        })
        .catch(error => {
            console.error('Error fetching transcript preference:', error);
        });
    
    // Set the current fuzzy search preference
    const settingsFuzzyToggle = document.getElementById('settingsFuzzyToggle');
    if (settingsFuzzyToggle) {
        settingsFuzzyToggle.checked = state.fuzzySearchEnabled;
    }
    
    // Add event listeners for transcript preference radios
    elements.transcriptPreferenceRadios.forEach(radio => {
        radio.addEventListener('change', function() {
            elements.whisperControls.style.display = this.value === 'whisper' ? 'block' : 'none';
        });
    });
}

/**
 * Closes the settings modal
 */
export function closeSettingsModal() {
    elements.settingsModal.style.display = 'none';
}

/**
 * Saves the settings
 */
export function saveSettings() {
    // Get OCR preference
    const ocrPreference = document.querySelector('input[name="ocrPreference"]:checked').value;
    
    // Get transcript preference
    const transcriptPreference = document.querySelector('input[name="transcriptPreference"]:checked').value;
    
    // Get fuzzy search preference
    const fuzzySearchEnabled = document.getElementById('settingsFuzzyToggle')?.checked || state.fuzzySearchEnabled;
    
    // Update fuzzy search state
    state.fuzzySearchEnabled = fuzzySearchEnabled;
    if (elements.fuzzySearchToggle) {
        elements.fuzzySearchToggle.checked = fuzzySearchEnabled;
        
        // Trigger the change event to update search results
        const event = new Event('change');
        elements.fuzzySearchToggle.dispatchEvent(event);
    }
    
    // Save OCR preference to server
    fetch('/set_ocr_preference', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ preference: ocrPreference }),
    })
    .then(response => response.json())
    .then(data => {
        if (!data.success) {
            showNotification('Failed to save OCR settings: ' + data.error, 'error');
        }
    })
    .catch(error => {
        console.error('Error saving OCR settings:', error);
        showNotification('Error saving OCR settings', 'error');
    });
    
    // Save transcript preference to server
    fetch('/set_transcript_preference', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ preference: transcriptPreference }),
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showNotification('Settings saved successfully', 'success');
            closeSettingsModal();
            
            // If current video is loaded and transcript preference changed, reload transcript
            if (state.currentVideoId && transcriptPreference !== state.currentTranscriptSource) {
                loadCurrentTranscript(state.currentVideoId, transcriptPreference);
            }
        } else {
            showNotification('Failed to save transcript settings: ' + data.error, 'error');
        }
    })
    .catch(error => {
        console.error('Error saving transcript settings:', error);
        showNotification('Error saving transcript settings', 'error');
    });
}

/**
 * Loads the current transcript based on preference
 * @param {string} videoId - The video ID
 * @param {string} preference - The transcript preference (youtube or whisper)
 */
export function loadCurrentTranscript(videoId, preference) {
    fetch(`/get_transcript/${videoId}/${preference}`)
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                // Update transcript
                state.currentTranscript = data.transcript;
                state.currentTranscriptSource = preference;
                
                // Update transcript display
                const event = new CustomEvent('transcriptLoaded', { detail: data.transcript });
                document.dispatchEvent(event);
            } else {
                showNotification(`No ${preference} transcript available. Please generate one first.`, 'info');
            }
        })
        .catch(error => {
            console.error('Error loading transcript:', error);
            showNotification('Error loading transcript', 'error');
        });
}

/**
 * Generates a Whisper transcript for the current video
 * @param {string} videoId - The video ID
 */
export function generateWhisperTranscript(videoId) {
    // Show progress container
    elements.whisperProgress.style.display = 'block';
    elements.whisperProgressFill.style.width = '0%';
    elements.whisperProgressText.textContent = '0%';
    elements.generateWhisperBtn.disabled = true;
    
    // Start generation
    fetch(`/generate_whisper_transcript/${videoId}`, {
        method: 'POST'
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            // If transcript was already generated, update UI
            if (data.transcript) {
                elements.whisperProgressFill.style.width = '100%';
                elements.whisperProgressText.textContent = '100%';
                showNotification('Whisper transcript already exists', 'success');
                elements.generateWhisperBtn.disabled = false;
                return;
            }
            
            // Start polling for status
            const statusUrl = data.status_url;
            const statusInterval = setInterval(() => {
                fetch(statusUrl)
                    .then(response => response.json())
                    .then(statusData => {
                        if (statusData.status === 'complete') {
                            // Transcript generation complete
                            clearInterval(statusInterval);
                            elements.whisperProgressFill.style.width = '100%';
                            elements.whisperProgressText.textContent = '100%';
                            showNotification('Whisper transcript generated successfully', 'success');
                            elements.generateWhisperBtn.disabled = false;
                            
                            // If current preference is whisper, load the new transcript
                            const currentPreference = document.querySelector('input[name="transcriptPreference"]:checked').value;
                            if (currentPreference === 'whisper') {
                                loadCurrentTranscript(videoId, 'whisper');
                            }
                        } else if (statusData.status === 'error') {
                            // Error occurred
                            clearInterval(statusInterval);
                            showNotification('Error generating Whisper transcript: ' + statusData.error, 'error');
                            elements.generateWhisperBtn.disabled = false;
                        } else if (statusData.status === 'in_progress') {
                            // Update progress
                            const progress = statusData.progress;
                            elements.whisperProgressFill.style.width = `${progress}%`;
                            elements.whisperProgressText.textContent = `${Math.round(progress)}%`;
                        }
                    })
                    .catch(error => {
                        console.error('Error checking transcript status:', error);
                    });
            }, 2000);
        } else {
            showNotification('Failed to start Whisper transcript generation: ' + data.error, 'error');
            elements.generateWhisperBtn.disabled = false;
        }
    })
    .catch(error => {
        console.error('Error generating Whisper transcript:', error);
        showNotification('Error generating Whisper transcript', 'error');
        elements.generateWhisperBtn.disabled = false;
    });
} 