// ocr.js - OCR functionality

import { elements } from './elements.js';
import { state } from './main.js';
import { showNotification } from './ui.js';

// Store the SSE connection globally so it can be accessed from api.js
window.sseConnection = null;

/**
 * Connects to the SSE endpoint for OCR progress updates
 * @param {string} videoId - The YouTube video ID
 */
function connectToSSE(videoId) {
    // Close any existing connection
    if (window.sseConnection) {
        window.sseConnection.close();
        window.sseConnection = null;
    }
    
    // Create a new EventSource connection
    window.sseConnection = new EventSource(`/ocr_progress/${videoId}`);
    
    // Handle connection open
    window.sseConnection.onopen = () => {
        console.log('SSE connection established');
    };
    
    // Handle messages
    window.sseConnection.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            handleSSEEvent(data, videoId);
        } catch (error) {
            console.error('Error parsing SSE message:', error);
        }
    };
    
    // Handle errors
    window.sseConnection.onerror = (error) => {
        console.error('SSE connection error:', error);
        // Try to reconnect after a delay
        setTimeout(() => {
            if (window.sseConnection) {
                window.sseConnection.close();
                connectToSSE(videoId);
            }
        }, 5000);
    };
    
    return window.sseConnection;
}

/**
 * Handles SSE events for OCR progress
 * @param {Object} data - The event data
 * @param {string} videoId - The YouTube video ID
 */
function handleSSEEvent(data, videoId) {
    const slideContentContainer = elements.slideContentContainer;
    
    // Handle different event types
    switch (data.event) {
        case 'connected':
            console.log('SSE connection established:', data.data.message);
            break;
            
        case 'ocr_progress':
            // Update progress display
            updateProgressDisplay(data.data);
            
            // If we have partial OCR results, update the slide content
            if (data.data.partial_results) {
                updatePartialOcrResults(data.data.partial_results, videoId);
            }
            break;
            
        case 'ocr_complete':
            console.log('OCR processing complete:', data.data.message);
            
            // If we have final results in the event, update immediately
            if (data.data.final_results) {
                updatePartialOcrResults(data.data.final_results, videoId, true);
            } else {
                // Otherwise fetch the updated OCR results
                fetchOcrResults(videoId);
            }
            break;
            
        case 'ocr_error':
            console.error('OCR processing error:', data.data.error);
            // Show error notification
            showNotification('Error during OCR processing: ' + data.data.error, 'error');
            break;
            
        default:
            console.log('Unknown SSE event:', data);
    }
}

/**
 * Updates the progress display based on SSE updates
 * @param {Object} progressData - The progress data
 */
function updateProgressDisplay(progressData) {
    const slideContentContainer = elements.slideContentContainer;
    
    // Find or create progress container
    let progressContainer = document.getElementById('ocrProgressContainer');
    if (!progressContainer) {
        // Create progress container if it doesn't exist
        progressContainer = document.createElement('div');
        progressContainer.id = 'ocrProgressContainer';
        progressContainer.className = 'ocr-progress-container';
        
        // Add to the slide content container at the top
        if (slideContentContainer.firstChild) {
            slideContentContainer.insertBefore(progressContainer, slideContentContainer.firstChild);
        } else {
            slideContentContainer.appendChild(progressContainer);
        }
    }
    
    // Find or create progress bar for this type
    const progressId = `ocrProgress_${progressData.type}`;
    let progressElement = document.getElementById(progressId);
    
    if (!progressElement) {
        // Create progress element if it doesn't exist
        progressElement = document.createElement('div');
        progressElement.id = progressId;
        progressElement.className = 'ocr-progress';
        
        // Create header with type
        const header = document.createElement('div');
        header.className = 'ocr-progress-header';
        header.innerHTML = `
            <i class="fas fa-spinner fa-spin"></i>
            <span>${progressData.type === 'tesseract' ? 'Tesseract' : 'Surya'} OCR Progress</span>
        `;
        
        // Create progress bar
        const progressBar = document.createElement('div');
        progressBar.className = 'ocr-progress-bar';
        
        // Create progress fill
        const progressFill = document.createElement('div');
        progressFill.className = 'ocr-progress-fill';
        progressBar.appendChild(progressFill);
        
        // Create progress text
        const progressText = document.createElement('div');
        progressText.className = 'ocr-progress-text';
        
        // Add all elements to the progress element
        progressElement.appendChild(header);
        progressElement.appendChild(progressBar);
        progressElement.appendChild(progressText);
        
        // Add to the progress container
        progressContainer.appendChild(progressElement);
    }
    
    // Update progress bar
    const progressFill = progressElement.querySelector('.ocr-progress-fill');
    if (progressFill) {
        progressFill.style.width = `${progressData.percent}%`;
    }
    
    // Update progress text
    const progressText = progressElement.querySelector('.ocr-progress-text');
    if (progressText) {
        progressText.textContent = progressData.message;
    }
    
    // If progress is 100%, update the header to show completion
    if (progressData.percent === 100) {
        const header = progressElement.querySelector('.ocr-progress-header');
        if (header) {
            header.innerHTML = `
                <i class="fas fa-check-circle"></i>
                <span>${progressData.type === 'tesseract' ? 'Tesseract' : 'Surya'} OCR Complete</span>
            `;
        }
    }
}

/**
 * Updates the state with partial OCR results and refreshes the display
 * @param {Array} partialResults - Array of new OCR results
 * @param {string} videoId - The YouTube video ID
 * @param {boolean} isFinal - Whether these are the final results
 */
function updatePartialOcrResults(partialResults, videoId, isFinal = false) {
    if (!partialResults || !Array.isArray(partialResults) || partialResults.length === 0) {
        return;
    }
    
    console.log(`Received ${partialResults.length} partial OCR results`);
    
    // Initialize ocrResults array if it doesn't exist
    if (!state.ocrResults) {
        state.ocrResults = [];
    }
    
    // Add new results to the state
    // For each new result, check if it already exists (by scene_index and text)
    // and only add if it's new
    partialResults.forEach(newResult => {
        const isDuplicate = state.ocrResults.some(existingResult => 
            existingResult.scene_index === newResult.scene_index && 
            existingResult.text === newResult.text &&
            existingResult.ocr_class === newResult.ocr_class
        );
        
        if (!isDuplicate) {
            state.ocrResults.push(newResult);
        }
    });
    
    // Enable slide search if we have OCR results
    if (state.ocrResults.length > 0) {
        elements.slideSearch.disabled = false;
    }
    
    // Update the slide content display
    // If these are final results, indicate no pending OCR tasks
    updateSlideContentDisplay(isFinal ? 0 : null);
}

/**
 * Fetches OCR results for a video
 * @param {string} videoId - The YouTube video ID
 */
export async function fetchOcrResults(videoId) {
    try {
        // Connect to SSE for real-time updates if not already connected
        if (!window.sseConnection) {
            connectToSSE(videoId);
        }
        
        const response = await fetch(`/ocr_text/${videoId}`);
        const data = await response.json();
        
        if (data.success) {
            console.log(`Fetched ${data.ocr_count} OCR results, ${data.pending_ocr_count} pending OCR tasks`);
            state.ocrResults = data.ocr_results || [];
            
            // Enable slide search if we have OCR results
            if (state.ocrResults.length > 0) {
                elements.slideSearch.disabled = false;
            }
            
            // Update the slide content display
            updateSlideContentDisplay(data.pending_ocr_count);
            
            // If OCR processing is not complete, we'll get updates via SSE
            // No need to poll anymore
            
            // Add a button to trigger Surya OCR if we have no unmatched results yet
            const hasUnmatchedResults = state.ocrResults.some(result => result.ocr_class === 'unmatched');
            const slideContentContainer = elements.slideContentContainer;
            
            // Only add the button if we don't already have unmatched results and OCR processing is complete
            if (!hasUnmatchedResults && data.processing_complete) {
                // Check if the button already exists
                if (!document.getElementById('processSuryaBtn')) {
                    const suryaButton = document.createElement('button');
                    suryaButton.id = 'processSuryaBtn';
                    suryaButton.className = 'btn btn-accent';
                    suryaButton.innerHTML = '<i class="fas fa-magic"></i> Process with Surya OCR';
                    suryaButton.style.marginBottom = '16px';
                    
                    // Add click handler to trigger Surya OCR
                    suryaButton.addEventListener('click', async () => {
                        try {
                            suryaButton.disabled = true;
                            suryaButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing with Surya OCR...';
                            
                            const response = await fetch(`/process_surya_ocr/${videoId}`, {
                                method: 'POST'
                            });
                            const data = await response.json();
                            
                            if (data.success) {
                                // Show success message
                                const successMessage = document.createElement('div');
                                successMessage.className = 'alert alert-info';
                                successMessage.style.display = 'block';
                                successMessage.innerHTML = `
                                    <i class="fas fa-check-circle"></i>
                                    ${data.message}. Results will appear shortly.
                                `;
                                slideContentContainer.insertBefore(successMessage, suryaButton);
                                
                                // Remove the button
                                suryaButton.remove();
                                
                                // We'll get updates via SSE, no need to poll
                            } else {
                                // Show error message
                                suryaButton.innerHTML = '<i class="fas fa-magic"></i> Process with Surya OCR';
                                suryaButton.disabled = false;
                                
                                const errorMessage = document.createElement('div');
                                errorMessage.className = 'alert alert-error';
                                errorMessage.style.display = 'block';
                                errorMessage.innerHTML = `
                                    <i class="fas fa-exclamation-circle"></i>
                                    Error: ${data.error || 'Failed to process with Surya OCR'}
                                `;
                                slideContentContainer.insertBefore(errorMessage, suryaButton);
                                
                                // Remove error message after 5 seconds
                                setTimeout(() => errorMessage.remove(), 5000);
                            }
                        } catch (error) {
                            console.error('Error triggering Surya OCR:', error);
                            suryaButton.innerHTML = '<i class="fas fa-magic"></i> Process with Surya OCR';
                            suryaButton.disabled = false;
                        }
                    });
                    
                    // Add the button to the slide content container
                    slideContentContainer.prepend(suryaButton);
                }
            }
        } else {
            console.error('Error fetching OCR results:', data.error);
        }
    } catch (error) {
        console.error('Error fetching OCR results:', error);
    }
}

/**
 * Updates the slide content display with OCR results
 * @param {number} pendingOcrCount - The number of pending OCR tasks
 */
export function updateSlideContentDisplay(pendingOcrCount = null) {
    const slideContentContainer = elements.slideContentContainer;
    
    // Save the progress container if it exists
    const progressContainer = document.getElementById('ocrProgressContainer');
    
    // Save the Surya button if it exists
    const suryaButton = document.getElementById('processSuryaBtn');
    
    // Clear existing content
    slideContentContainer.innerHTML = '';
    
    // Restore the progress container if it existed
    if (progressContainer) {
        slideContentContainer.appendChild(progressContainer);
    }
    
    // If pendingOcrCount is null, don't change the pending notice
    // This is used for partial updates where we don't know the current pending count
    if (pendingOcrCount !== null) {
        // Remove any existing pending notice
        const existingNotice = document.getElementById('pendingOcrNotice');
        if (existingNotice) {
            existingNotice.remove();
        }
        
        // If we have pending OCR tasks, show a notice
        if (pendingOcrCount > 0) {
            const pendingNotice = document.createElement('div');
            pendingNotice.id = 'pendingOcrNotice';
            pendingNotice.className = 'alert alert-info';
            pendingNotice.style.display = 'block';
            pendingNotice.innerHTML = `
                <i class="fas fa-spinner fa-spin"></i>
                OCR processing in progress: ${pendingOcrCount} more text elements are being processed.
            `;
            slideContentContainer.appendChild(pendingNotice);
        }
    }
    
    if (!state.ocrResults || state.ocrResults.length === 0) {
        // Show the "coming soon" message if no OCR results
        if (pendingOcrCount > 0 || pendingOcrCount === null) {
            // Show loading indicator if OCR is in progress
            const comingSoon = document.createElement('div');
            comingSoon.className = 'coming-soon';
            comingSoon.innerHTML = `
                <i class="fas fa-spinner fa-spin"></i>
                <h3>Processing Text Elements</h3>
                <p>OCR is in progress. Text elements are being processed and will appear here as they become available.</p>
            `;
            slideContentContainer.appendChild(comingSoon);
        } else {
            const comingSoon = document.createElement('div');
            comingSoon.className = 'coming-soon';
            comingSoon.innerHTML = `
                <i class="fas fa-cogs"></i>
                <h3>Processing Text Elements</h3>
                <p>No text elements have been detected yet. This may take some time as scenes are processed.</p>
            `;
            slideContentContainer.appendChild(comingSoon);
        }
        
        // Restore the Surya button if it existed
        if (suryaButton) {
            slideContentContainer.appendChild(suryaButton);
        }
        
        return;
    }
    
    // Group OCR results by scene
    const resultsByScene = {};
    state.ocrResults.forEach(result => {
        const sceneIndex = result.scene_index;
        if (!resultsByScene[sceneIndex]) {
            resultsByScene[sceneIndex] = [];
        }
        resultsByScene[sceneIndex].push(result);
    });
    
    // Create sections for each scene
    Object.keys(resultsByScene).sort((a, b) => parseInt(a) - parseInt(b)).forEach(sceneIndex => {
        const sceneResults = resultsByScene[sceneIndex];
        const timestamp = sceneResults[0].timestamp;
        
        const sceneSection = document.createElement('div');
        sceneSection.className = 'ocr-scene-section';
        
        // Add scene header
        const sceneHeader = document.createElement('div');
        sceneHeader.className = 'ocr-scene-header';
        sceneHeader.innerHTML = `
            <span class="ocr-scene-timestamp">${timestamp}</span>
            <span>Scene ${parseInt(sceneIndex) + 1} (${sceneResults.length} text elements)</span>
        `;
        sceneSection.appendChild(sceneHeader);
        
        // Group results by OCR class
        const resultsByClass = {};
        sceneResults.forEach(result => {
            const ocrClass = result.ocr_class || 'text';
            if (!resultsByClass[ocrClass]) {
                resultsByClass[ocrClass] = [];
            }
            resultsByClass[ocrClass].push(result);
        });
        
        // Create sections for each OCR class
        Object.keys(resultsByClass).forEach(ocrClass => {
            const classResults = resultsByClass[ocrClass];
            if (classResults.length === 0) return;
            
            // Sort results by y position first (top to bottom), then by x position (left to right)
            classResults.sort((a, b) => {
                // Make sure bbox exists and has at least 2 elements
                if (!a.bbox || a.bbox.length < 2) return -1;
                if (!b.bbox || b.bbox.length < 2) return 1;
                
                // Get y coordinates (y1) from bbox [x1, y1, x2, y2]
                const aY = a.bbox[1];
                const bY = b.bbox[1];
                
                // If y positions are similar (within 20 pixels), sort by x position
                if (Math.abs(aY - bY) < 20) {
                    return a.bbox[0] - b.bbox[0]; // Sort by x1 (left to right)
                }
                
                // Otherwise sort by y position (top to bottom)
                return aY - bY;
            });
            const classHeader = document.createElement('div');
            classHeader.className = 'ocr-class-header';
            
            // Get appropriate icon and label for each class
            let icon, label;
            switch(ocrClass) {
                case 'title':
                    icon = 'fa-heading';
                    label = 'Titles';
                    break;
                case 'page-text':
                    icon = 'fa-file-alt';
                    label = 'Page Text';
                    break;
                case 'caption':
                    icon = 'fa-quote-right';
                    label = 'Captions';
                    break;
                case 'other-text':
                    icon = 'fa-font';
                    label = 'Other Text';
                    break;
                case 'unmatched':
                    icon = 'fa-question-circle';
                    label = 'Unmatched Text (Surya)';
                    break;
                default:
                    icon = 'fa-text-height';
                    label = 'Text';
            }
            
            classHeader.innerHTML = `
                <i class="fas ${icon}"></i>
                <span>${label} (${classResults.length})</span>
            `;
            
            sceneSection.appendChild(classHeader);
            
            // Add each OCR result for this class
            classResults.forEach(result => {
                const ocrItem = document.createElement('div');
                ocrItem.className = `ocr-item ocr-${ocrClass}`;
                
                // Add source indicator for unmatched results
                let sourceInfo = '';
                if (ocrClass === 'unmatched') {
                    sourceInfo = `<div class="ocr-source">(Surya OCR)</div>`;
                } else if (result.ocr_source) {
                    sourceInfo = ` <span class="ocr-source">(${result.ocr_source})</span>`;
                }
                
                ocrItem.innerHTML = `
                    <div class="ocr-text">${result.text}</div>
                    ${sourceInfo}
                `;
                
                // Add click handler to jump to timestamp
                ocrItem.addEventListener('click', () => {
                    elements.videoPlayer.currentTime = result.time_seconds;
                });
                
                // Add highlight animation for new items
                if (result.isNew) {
                    ocrItem.classList.add('ocr-item-new');
                    // Remove the isNew flag after animation
                    setTimeout(() => {
                        result.isNew = false;
                    }, 2000);
                }
                
                sceneSection.appendChild(ocrItem);
            });
        });
        
        slideContentContainer.appendChild(sceneSection);
    });
    
    // Restore the Surya button if it existed
    if (suryaButton) {
        slideContentContainer.appendChild(suryaButton);
    }
}

// Add CSS for progress bar
const style = document.createElement('style');
style.textContent = `
.ocr-progress-container {
    margin-bottom: 20px;
    width: 100%;
}

.ocr-progress {
    margin-bottom: 15px;
    background: #f5f5f5;
    border-radius: 8px;
    padding: 12px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}

.ocr-progress-header {
    display: flex;
    align-items: center;
    margin-bottom: 8px;
    font-weight: bold;
}

.ocr-progress-header i {
    margin-right: 8px;
    color: #4a6cf7;
}

.ocr-progress-bar {
    height: 10px;
    background: #e0e0e0;
    border-radius: 5px;
    overflow: hidden;
    margin-bottom: 8px;
}

.ocr-progress-fill {
    height: 100%;
    background: #4a6cf7;
    width: 0%;
    transition: width 0.3s ease;
}

.ocr-progress-text {
    font-size: 0.9em;
    color: #666;
}

/* Animation for new OCR items */
@keyframes highlightNew {
    0% { background-color: rgba(74, 108, 247, 0.2); }
    100% { background-color: transparent; }
}

.ocr-item-new {
    animation: highlightNew 2s ease-out;
}
`;
document.head.appendChild(style);

// Add event listener to close SSE connection when the user navigates away
window.addEventListener('beforeunload', () => {
    if (window.sseConnection) {
        console.log('Closing SSE connection before unload');
        window.sseConnection.close();
        window.sseConnection = null;
    }
}); 