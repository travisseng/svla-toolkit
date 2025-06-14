// scenes.js - Scene detection functionality

import { elements } from './elements.js';
import { state } from './main.js';
import { updateTimelineHighlight } from './video.js';
import { fetchOcrResults } from './ocr.js';

// Add state variable for label visibility
let labelsVisible = true;

// Add a cache for scene lookups
const sceneCache = {
    lastTime: null,
    lastScene: null,
    timeRanges: [] // Array of [startTime, endTime, sceneIndex] for binary search
};

/**
 * Checks the status of scene detection for a video
 * @param {string} videoId - The YouTube video ID
 */
export async function checkSceneDetection(videoId) {
    try {
        const response = await fetch(`/scenes/${videoId}`);
        const data = await response.json();
        
        if (data.success) {
            const videoPlayer = elements.videoPlayer;
            
            if (data.complete) {
                // Scene detection is complete
                
                // Clear the scene cache before updating scenes
                clearSceneCache();
                
                updateScenes(data.scenes, videoPlayer);
                // Clear the interval
                if (state.sceneDetectionInterval) {
                    clearInterval(state.sceneDetectionInterval);
                    state.sceneDetectionInterval = null;
                }
                
                // Update the scenes container
                if (data.scenes.length === 0) {
                    elements.scenesContainer.innerHTML = '<p>No scene changes detected.</p>';
                    elements.thumbnailTimeline.innerHTML = '<p>No scenes available for timeline.</p>';
                }
                
                // Continue checking for YOLO detections
                startDetectionPolling(videoId);
            } else {
                // Still processing
                elements.scenesContainer.innerHTML = '<p>Detecting scene changes...</p>';
                elements.thumbnailTimeline.innerHTML = '<p>Generating visual timeline...</p>';
            }
        }
    } catch (error) {
        console.error('Error checking scene detection:', error);
        showError('Error checking scene detection. Please try again.');
    }
}

/**
 * Updates the scenes display with new scene data
 * @param {Array} scenes - The scene data
 * @param {HTMLVideoElement} videoPlayer - The video player element
 */
export function updateScenes(scenes, videoPlayer) {
    // Clear the scene cache when scenes are updated
    clearSceneCache();
    
    state.videoScenes = scenes;
    const scenesContainer = elements.scenesContainer;
    const progressContainer = elements.videoProgress;
    const timelineContainer = elements.thumbnailTimeline;
    
    // Clear existing scenes but keep the time marker and hover time
    scenesContainer.innerHTML = '';
    const timeMarker = elements.timeMarker;
    const hoverTime = elements.progressHoverTime;
    // Remove scene markers from the progress bar
    const sceneMarkers = progressContainer.querySelectorAll('.scene-marker');
    sceneMarkers.forEach(marker => marker.remove());
    // Make sure the time marker and hover time are still present
    if (!progressContainer.contains(timeMarker)) {
        progressContainer.appendChild(timeMarker);
    }
    if (!progressContainer.contains(hoverTime)) {
        progressContainer.appendChild(hoverTime);
    }
    
    // Clear timeline
    timelineContainer.innerHTML = '';
    
    if (scenes.length === 0) {
        scenesContainer.innerHTML = '<p>No scene changes detected.</p>';
        timelineContainer.innerHTML = '<p>No scenes available for timeline.</p>';
        return;
    }
    
    // Initialize time ranges for binary search
    initializeTimeRanges(scenes);
    
    // Add scene markers to the progress bar
    const duration = videoPlayer.duration;
    
    // Use all scenes for thumbnails
    let displayScenes = scenes;
    
    // Add all scene markers to progress bar if toggle is on
    if (state.showSceneMarkers) {
        scenes.forEach((scene, index) => {
            // Add visual marker to progress bar
            const marker = document.createElement('div');
            marker.className = 'scene-marker';
            marker.style.left = (scene.time_seconds / duration * 100) + '%';
            progressContainer.appendChild(marker);
        });
    }
    
    // Add scene to list
    scenes.forEach((scene, index) => {
        const div = document.createElement('div');
        div.className = 'scene-item';
        div.innerHTML = `
            <span class="scene-timestamp">${scene.timestamp}</span>
            <span>Scene ${index + 1}</span>
        `;
        div.onclick = () => {
            videoPlayer.currentTime = scene.time_seconds;
        };
        scenesContainer.appendChild(div);
    });
    
    // Add all thumbnails to timeline
    displayScenes.forEach((scene, index) => {
        // Add index to scene object for reference
        scene.index = index;
        
        if (scene.thumbnail) {
            const timelineItem = document.createElement('div');
            timelineItem.className = 'timeline-item';
            timelineItem.dataset.index = index;
            
            const img = document.createElement('img');
            img.className = 'timeline-thumbnail';
            img.src = scene.thumbnail;
            img.alt = `Scene at ${scene.timestamp}`;
            img.dataset.time = scene.time_seconds;
            
            // Add detection badge if available
            if (scene.yolo_detections && scene.yolo_detections.success) {
                const detections = scene.yolo_detections.detections;
                if (detections && detections.length > 0) {
                    console.log(`Adding badge for scene ${index} with ${detections.length} detections`);
                    const badge = document.createElement('div');
                    badge.className = 'detection-badge';
                    badge.textContent = detections.length;
                    
                    // Add tooltip with detection summary
                    const detectionCounts = {};
                    detections.forEach(detection => {
                        const className = detection.class;
                        detectionCounts[className] = (detectionCounts[className] || 0) + 1;
                    });
                    
                    const tooltip = Object.entries(detectionCounts)
                        .map(([cls, count]) => `${cls}: ${count}`)
                        .join(', ');
                    
                    badge.title = tooltip;
                    timelineItem.appendChild(badge);
                }
            }
            
            const timestamp = document.createElement('div');
            timestamp.className = 'timeline-timestamp';
            timestamp.textContent = scene.timestamp;
            
            timelineItem.appendChild(img);
            timelineItem.appendChild(timestamp);
            
            // Set click handler for seeking
            timelineItem.onclick = () => {
                videoPlayer.currentTime = scene.time_seconds;
            };
            
            // Set double-click handler for showing detections
            timelineItem.ondblclick = (e) => {
                e.stopPropagation();
                showDetectionOverlay(scene);
            };
            
            timelineContainer.appendChild(timelineItem);
        }
    });
    
    // Remove any existing timeupdate listeners to avoid duplicates
    videoPlayer.removeEventListener('timeupdate', updateTimelineHighlight);
    
    // Add timeupdate listener to highlight current thumbnail
    videoPlayer.addEventListener('timeupdate', updateTimelineHighlight);
}

/**
 * Starts polling for YOLO detections
 * @param {string} videoId - The YouTube video ID
 */
function startDetectionPolling(videoId) {
    console.log("Starting detection polling");
    // Check for updates every 3 seconds
    const detectionInterval = setInterval(async () => {
        try {
            const response = await fetch(`/scenes/${videoId}`);
            const data = await response.json();
            
            if (data.success && data.complete) {
                // Check if any scenes have YOLO detections
                let hasDetections = false;
                let allProcessed = true;
                
                for (const scene of data.scenes) {
                    if (scene.yolo_detections) {
                        hasDetections = true;
                    }
                }
                if (data.processed) {
                    allProcessed = true;
                }
                
                if (hasDetections) {
                    // Clear the scene cache before updating scenes
                    clearSceneCache();
                    
                    // Update the UI with the latest detection data
                    const videoPlayer = elements.videoPlayer;
                    updateScenes(data.scenes, videoPlayer);
                    
                    // Fetch OCR results if we have detections
                    fetchOcrResults(videoId);
                }
                
                if (allProcessed) {
                    // All scenes have been processed, stop polling
                    console.log("All scenes processed with YOLO, stopping detection polling");
                    clearInterval(detectionInterval);
                    
                    // // Final fetch of OCR results
                    // fetchOcrResults(videoId);
                }
            }
        } catch (error) {
            console.error('Error polling for detections:', error);
            clearInterval(detectionInterval);
        }
    }, 3000);
}

/**
 * Shows the detection overlay for a scene
 * @param {Object} scene - The scene data
 */
export function showDetectionOverlay(scene) {
    if (!scene || !scene.fullsize) return;
    
    // Store the current scene for debugging
    state.currentDebugScene = scene;
    
    const overlay = elements.detectionOverlay;
    const imageContainer = elements.detectionImageContainer;
    const detectionList = elements.detectionList;
    
    // Clear previous content
    imageContainer.innerHTML = '';
    detectionList.innerHTML = '';
    
    // Add full-size image
    const img = document.createElement('img');
    img.className = 'detection-image';
    img.src = scene.fullsize;
    imageContainer.appendChild(img);
    
    // Check if we have YOLO detections
    const hasYoloDetections = scene.yolo_detections && scene.yolo_detections.success;
    const hasSuryaOcr = scene.surya_ocr && scene.surya_ocr.success;
    
    if (!hasYoloDetections && !hasSuryaOcr) {
        detectionList.innerHTML = '<p>No detections available for this scene.</p>';
        overlay.style.display = 'flex';
        return;
    }
    
    const detections = hasYoloDetections ? scene.yolo_detections.detections || [] : [];
    const suryaResults = hasSuryaOcr ? scene.surya_ocr.results || [] : [];
    
    // Count text detections with OCR and unmatched Surya results
    let textDetectionCount = 0;
    let ocrTextCount = 0;
    let unmatchedSuryaCount = 0;
    
    detections.forEach(detection => {
        if (detection.class.toLowerCase().includes('text') || 
            ['title', 'page-text', 'other-text', 'caption'].includes(detection.class.toLowerCase())) {
            textDetectionCount++;
            if (detection.ocr_text) {
                ocrTextCount++;
            }
        }
    });
    
    // Count unmatched Surya OCR results
    suryaResults.forEach(result => {
        if (!result.matched && result.text && result.text.trim()) {
            unmatchedSuryaCount++;
        }
    });
    
    // Add detection list header
    let headerText = '';
    if (detections.length > 0) {
        headerText += `${detections.length} objects detected`;
        if (textDetectionCount > 0) {
            headerText += `, including ${textDetectionCount} text elements`;
        }
    }
    
    if (unmatchedSuryaCount > 0) {
        if (headerText) {
            headerText += '<br>';
        }
        headerText += `${unmatchedSuryaCount} additional text elements detected by Surya OCR`;
    }
    
    detectionList.innerHTML = `
        <h4>${headerText || 'No YOLO detections available'}</h4>
        ${ocrTextCount > 0 ? `<p>${ocrTextCount} text elements have OCR results</p>` : ''}
        <div class="detection-controls">
            <button id="resetDetectionsBtn" class="btn btn-secondary">
                <i class="fas fa-undo"></i> Reset View
            </button>
            <button id="createBackgroundBtn" class="btn btn-primary">
                <i class="fas fa-paint-brush"></i> Create Clean Background
            </button>
            <div class="toggle-container">
                <label class="toggle-switch">
                    <input type="checkbox" id="showTextToggle" checked>
                    <span class="toggle-slider"></span>
                </label>
                <span>Show Text as Text</span>
            </div>
        </div>
        <div class="image-resize-controls">
            <div class="slider-container">
                <label for="imageResizeSlider">Image Size: <span id="sizeValue">100%</span></label>
                <input type="range" id="imageResizeSlider" min="50" max="200" value="100" class="resize-slider">
            </div>
        </div>
        <div class="text-controls">
            <div class="slider-container">
                <label for="fontSizeSlider">Text Size: <span id="fontSizeValue">100%</span></label>
                <input type="range" id="fontSizeSlider" min="50" max="200" value="100" class="resize-slider">
            </div>
            <div class="font-controls">
                <button id="boldTextBtn" class="font-control-btn" title="Bold">
                    <i class="fas fa-bold"></i>
                </button>
                <button id="italicTextBtn" class="font-control-btn" title="Italic">
                    <i class="fas fa-italic"></i>
                </button>
                <button id="underlineTextBtn" class="font-control-btn" title="Underline">
                    <i class="fas fa-underline"></i>
                </button>
            </div>
        </div>
        <div class="add-element-controls">
            <button id="addTextBtn" class="btn btn-primary">
                <i class="fas fa-plus"></i> Add Text
            </button>
            <button id="addImageBtn" class="btn btn-primary">
                <i class="fas fa-image"></i> Add Image
            </button>
            <input type="file" id="imageUpload" accept="image/*" style="display: none;">
        </div>
    `;
    
    // Create a wrapper for the image and detections
    const imageWrapper = document.createElement('div');
    imageWrapper.className = 'image-wrapper';
    imageWrapper.style.transformOrigin = 'top left';
    imageWrapper.style.position = 'relative';
    
    // Move the image into the wrapper
    imageContainer.removeChild(img);
    imageWrapper.appendChild(img);
    imageContainer.appendChild(imageWrapper);
    
    // Add event listener for reset button
    document.getElementById('resetDetectionsBtn').addEventListener('click', () => {
        // Reset the image size to 100%
        document.getElementById('imageResizeSlider').value = 100;
        imageWrapper.style.transform = 'scale(1)';
        document.getElementById('sizeValue').textContent = '100%';
        
        // Reset font size
        document.getElementById('fontSizeSlider').value = 100;
        document.getElementById('fontSizeValue').textContent = '100%';
        
        // Reset all text elements font size
        const textElements = imageWrapper.querySelectorAll('.text-content');
        textElements.forEach(el => {
            el.style.fontSize = '1em';
            el.style.fontWeight = 'normal';
            el.style.fontStyle = 'normal';
            el.style.textDecoration = 'none';
        });
        
        // Reset all font style buttons
        document.querySelectorAll('.font-control-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        
        // Remove background if it exists
        const bgContainer = imageWrapper.querySelector('.background-container');
        if (bgContainer) {
            bgContainer.remove();
        }
        
        // Reset all detection boxes to their original positions
        const boxes = imageWrapper.querySelectorAll('.detection-box');
        boxes.forEach(box => {
            if (box.dataset.originalX1 && box.dataset.originalY1) {
                const x1 = parseFloat(box.dataset.originalX1);
                const y1 = parseFloat(box.dataset.originalY1);
                const x2 = parseFloat(box.dataset.originalX2);
                const y2 = parseFloat(box.dataset.originalY2);
                
                box.style.left = `${x1}px`;
                box.style.top = `${y1}px`;
                box.style.width = `${x2 - x1}px`;
                box.style.height = `${y2 - y1}px`;
                
                // Find and reset the label
                const boxIndex = Array.from(imageWrapper.querySelectorAll('.detection-box')).indexOf(box);
                const label = imageWrapper.querySelectorAll('.detection-label')[boxIndex];
                if (label) {
                    label.style.left = `${x1}px`;
                    label.style.top = `${y1 - 20}px`;
                }
                
                // Reset the text content if it exists
                if (box.dataset.textContentId) {
                    const textContent = document.getElementById(box.dataset.textContentId);
                    if (textContent) {
                        textContent.style.left = `${x1}px`;
                        textContent.style.top = `${y1}px`;
                        textContent.style.width = `${x2 - x1}px`;
                        textContent.style.height = `${y2 - y1}px`;
                    }
                }
                
                // Reset the extracted image if it exists
                if (box.dataset.extractedImageId) {
                    const extractedImg = document.getElementById(box.dataset.extractedImageId);
                    if (extractedImg) {
                        extractedImg.style.left = `${x1}px`;
                        extractedImg.style.top = `${y1}px`;
                        extractedImg.style.width = `${x2 - x1}px`;
                        extractedImg.style.height = `${y2 - y1}px`;
                    }
                }
            }
        });
        
        // Show notification
        showNotification('View reset to original state', 'info');
    });
    
    // Add event listener for text toggle
    const showTextToggle = document.getElementById('showTextToggle');
    showTextToggle.addEventListener('change', () => {
        const textElements = imageWrapper.querySelectorAll('.text-content');
        textElements.forEach(el => {
            el.style.display = showTextToggle.checked ? 'block' : 'none';
        });
    });
    
    // Add event listener for image resize slider
    const resizeSlider = document.getElementById('imageResizeSlider');
    resizeSlider.addEventListener('input', () => {
        const scale = resizeSlider.value / 100;
        imageWrapper.style.transform = `scale(${scale})`;
        document.getElementById('sizeValue').textContent = `${resizeSlider.value}%`;
    });
    
    // Add event listener for font size slider
    const fontSizeSlider = document.getElementById('fontSizeSlider');
    fontSizeSlider.addEventListener('input', () => {
        const scale = fontSizeSlider.value / 100;
        const textElements = imageWrapper.querySelectorAll('.text-content');
        textElements.forEach(el => {
            el.style.fontSize = `${scale}em`;
        });
        document.getElementById('fontSizeValue').textContent = `${fontSizeSlider.value}%`;
    });
    
    // Add event listeners for font style buttons
    document.getElementById('boldTextBtn').addEventListener('click', () => {
        toggleTextStyle('fontWeight', 'bold', 'normal');
    });
    
    document.getElementById('italicTextBtn').addEventListener('click', () => {
        toggleTextStyle('fontStyle', 'italic', 'normal');
    });
    
    document.getElementById('underlineTextBtn').addEventListener('click', () => {
        toggleTextStyle('textDecoration', 'underline', 'none');
    });
    
    // Function to toggle text styles
    function toggleTextStyle(property, valueOn, valueOff) {
        const textElements = imageWrapper.querySelectorAll('.text-content');
        const button = document.querySelector(`[id$="${property.charAt(0).toUpperCase() + property.slice(1)}Btn"]`);
        
        // Check if any element has the style already
        let hasStyle = false;
        textElements.forEach(el => {
            if (getComputedStyle(el)[property] === valueOn) {
                hasStyle = true;
            }
        });
        
        // Toggle the style
        textElements.forEach(el => {
            el.style[property] = hasStyle ? valueOff : valueOn;
        });
        
        // Toggle button active state
        if (button) {
            button.classList.toggle('active', !hasStyle);
        }
    }
    
    // Add detection boxes and labels
    img.onload = function() {
        const imgWidth = img.offsetWidth;
        const imgHeight = img.offsetHeight;
        const imgNaturalWidth = img.naturalWidth;
        const imgNaturalHeight = img.naturalHeight;
        
        // Scale factor for drawing boxes
        const scaleX = imgWidth / imgNaturalWidth;
        const scaleY = imgHeight / imgNaturalHeight;
        
        // Add YOLO detection boxes
        detections.forEach((detection, index) => {
            const [x1, y1, x2, y2] = detection.bbox;
            
            // Scale coordinates to match displayed image size
            const scaledX1 = x1 * scaleX;
            const scaledY1 = y1 * scaleY;
            const scaledX2 = x2 * scaleX;
            const scaledY2 = y2 * scaleY;
            
            // Create detection box
            const box = document.createElement('div');
            box.className = 'detection-box';
            box.dataset.originalX1 = scaledX1;
            box.dataset.originalY1 = scaledY1;
            box.dataset.originalX2 = scaledX2;
            box.dataset.originalY2 = scaledY2;
            
            // Special styling for text detections
            const isTextDetection = detection.class.toLowerCase().includes('text') || 
                                   ['title', 'page-text', 'other-text', 'caption'].includes(detection.class.toLowerCase());
            
            if (isTextDetection) {
                box.classList.add('text-detection');
                
                // Add specific class for different text types
                if (detection.ocr_class) {
                    box.classList.add(`${detection.ocr_class}-detection`);
                }
            }
            
            box.style.left = `${scaledX1}px`;
            box.style.top = `${scaledY1}px`;
            box.style.width = `${scaledX2 - scaledX1}px`;
            box.style.height = `${scaledY2 - scaledY1}px`;
            
            // Make box interactive (movable and resizable)
            box.classList.add('interactive-box');
            
            // Add resize handles
            const handles = ['nw', 'ne', 'sw', 'se'];
            handles.forEach(handle => {
                const resizeHandle = document.createElement('div');
                resizeHandle.className = `resize-handle ${handle}-handle`;
                box.appendChild(resizeHandle);
            });
            
            // For non-text detections, create an image element with the cropped content
            let extractedImg = null;
            if (!isTextDetection) {
                // Create a canvas to extract the image content
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                
                // Set canvas dimensions to match the detection box
                canvas.width = (x2 - x1);
                canvas.height = (y2 - y1);
                
                // Draw the portion of the image onto the canvas
                ctx.drawImage(
                    img,
                    x1, y1, (x2 - x1), (y2 - y1),
                    0, 0, (x2 - x1), (y2 - y1)
                );
                
                // Create an image container for the extracted content
                extractedImg = document.createElement('div');
                extractedImg.className = 'extracted-image-container';
                extractedImg.style.backgroundImage = `url(${canvas.toDataURL('image/png')})`;
                extractedImg.style.left = `${scaledX1}px`;
                extractedImg.style.top = `${scaledY1}px`;
                extractedImg.style.width = `${scaledX2 - scaledX1}px`;
                extractedImg.style.height = `${scaledY2 - scaledY1}px`;
                
                // Add the extracted image to the wrapper
                imageWrapper.appendChild(extractedImg);
                
                // Link the extracted image to the box for synchronized movement
                box.dataset.extractedImageId = `extracted-image-${index}`;
                extractedImg.id = `extracted-image-${index}`;
            }
            
            imageWrapper.appendChild(box);
            
            // Create detection label
            const label = document.createElement('div');
            label.className = 'detection-label';
            
            if (isTextDetection) {
                label.classList.add('text-detection-label');
                
                // Add specific class for different text types
                if (detection.ocr_class) {
                    label.classList.add(`${detection.ocr_class}-label`);
                }
            }
            
            // Position label at top of box
            label.style.left = `${scaledX1}px`;
            label.style.top = `${scaledY1 - 20}px`;
            
            // Label content
            let labelText = `${detection.class} (${Math.round(detection.confidence * 100)}%)`;
            if (detection.ocr_text) {
                labelText += `: "${detection.ocr_text.substring(0, 20)}${detection.ocr_text.length > 20 ? '...' : ''}"`;
            }
            label.textContent = labelText;
            
            // Add extract button
            const extractBtn = document.createElement('button');
            extractBtn.className = 'extract-btn';
            extractBtn.innerHTML = '<i class="fas fa-download"></i>';
            extractBtn.title = 'Extract this element';
            extractBtn.onclick = (e) => {
                e.stopPropagation();
                extractElement(box, detection.class);
            };
            label.appendChild(extractBtn);
            
            // Add delete button
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'delete-btn';
            deleteBtn.innerHTML = '<i class="fas fa-trash"></i>';
            deleteBtn.title = 'Delete this element';
            deleteBtn.onclick = (e) => {
                e.stopPropagation();
                box.remove();
                label.remove();
                if (box.dataset.textContentId) {
                    const textContent = document.getElementById(box.dataset.textContentId);
                    if (textContent) {
                        textContent.remove();
                    }
                }
                if (box.dataset.extractedImageId) {
                    const extractedImg = document.getElementById(box.dataset.extractedImageId);
                    if (extractedImg) {
                        extractedImg.remove();
                    }
                }
            };
            label.appendChild(deleteBtn);
            
            imageWrapper.appendChild(label);
            
            // For text detections with OCR, add actual text content
            let textContent = null;
            if (isTextDetection && detection.ocr_text) {
                textContent = document.createElement('div');
                textContent.className = 'text-content';
                textContent.textContent = detection.ocr_text;
                textContent.style.left = `${scaledX1}px`;
                textContent.style.top = `${scaledY1}px`;
                textContent.style.width = `${scaledX2 - scaledX1}px`;
                textContent.style.height = `${scaledY2 - scaledY1}px`;
                textContent.contentEditable = true; // Make text editable
                textContent.spellcheck = false;
                
                // Add specific class for different text types for styling
                if (detection.ocr_class) {
                    textContent.classList.add(`${detection.ocr_class}-text`);
                }
                
                // Add edit indicator and instructions
                textContent.addEventListener('focus', () => {
                    textContent.classList.add('editing');
                });
                
                textContent.addEventListener('blur', () => {
                    textContent.classList.remove('editing');
                });
                
                imageWrapper.appendChild(textContent);
                
                // Link the text content to the box for synchronized movement
                box.dataset.textContentId = `text-content-${index}`;
                textContent.id = `text-content-${index}`;
            }
            
            // Make the box draggable with the appropriate linked element
            if (isTextDetection && textContent) {
                makeElementDraggable(box, label, imageWrapper, textContent);
            } else if (extractedImg) {
                makeElementDraggable(box, label, imageWrapper, extractedImg);
            } else {
                makeElementDraggable(box, label, imageWrapper);
            }
            
            // Make the box resizable with the appropriate linked element
            if (isTextDetection && textContent) {
                makeElementResizable(box, imageWrapper, textContent);
            } else if (extractedImg) {
                makeElementResizable(box, imageWrapper, extractedImg);
            } else {
                makeElementResizable(box, imageWrapper);
            }
        });
        
        // Add unmatched Surya OCR boxes
        suryaResults.forEach((result, index) => {
            if (!result.matched && result.text && result.text.trim() && result.bbox && result.bbox.length === 4) {
                const [x1, y1, x2, y2] = result.bbox;
                
                // Scale coordinates to match displayed image size
                const scaledX1 = x1 * scaleX;
                const scaledY1 = y1 * scaleY;
                const scaledX2 = x2 * scaleX;
                const scaledY2 = y2 * scaleY;
                
                // Create detection box
                const box = document.createElement('div');
                box.className = 'detection-box unmatched-detection interactive-box';
                box.dataset.originalX1 = scaledX1;
                box.dataset.originalY1 = scaledY1;
                box.dataset.originalX2 = scaledX2;
                box.dataset.originalY2 = scaledY2;
                
                box.style.left = `${scaledX1}px`;
                box.style.top = `${scaledY1}px`;
                box.style.width = `${scaledX2 - scaledX1}px`;
                box.style.height = `${scaledY2 - scaledY1}px`;
                
                // Add resize handles
                const handles = ['nw', 'ne', 'sw', 'se'];
                handles.forEach(handle => {
                    const resizeHandle = document.createElement('div');
                    resizeHandle.className = `resize-handle ${handle}-handle`;
                    box.appendChild(resizeHandle);
                });
                
                imageWrapper.appendChild(box);
                
                // Create detection label
                const label = document.createElement('div');
                label.className = 'detection-label unmatched-label';
                
                // Position label at top of box
                label.style.left = `${scaledX1}px`;
                label.style.top = `${scaledY1 - 20}px`;
                
                // Label content
                let labelText = `Unmatched (Surya): "${result.text.substring(0, 20)}${result.text.length > 20 ? '...' : ''}"`;
                label.textContent = labelText;
                
                // Add extract button
                const extractBtn = document.createElement('button');
                extractBtn.className = 'extract-btn';
                extractBtn.innerHTML = '<i class="fas fa-download"></i>';
                extractBtn.title = 'Extract this element';
                extractBtn.onclick = (e) => {
                    e.stopPropagation();
                    extractElement(box, 'text');
                };
                label.appendChild(extractBtn);
                
                // Add delete button
                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'delete-btn';
                deleteBtn.innerHTML = '<i class="fas fa-trash"></i>';
                deleteBtn.title = 'Delete this element';
                deleteBtn.onclick = (e) => {
                    e.stopPropagation();
                    box.remove();
                    label.remove();
                    if (box.dataset.textContentId) {
                        const textContent = document.getElementById(box.dataset.textContentId);
                        if (textContent) {
                            textContent.remove();
                        }
                    }
                };
                label.appendChild(deleteBtn);
                
                imageWrapper.appendChild(label);
                
                // Add actual text content
                const textContent = document.createElement('div');
                textContent.className = 'text-content unmatched-text';
                textContent.textContent = result.text;
                textContent.style.left = `${scaledX1}px`;
                textContent.style.top = `${scaledY1}px`;
                textContent.style.width = `${scaledX2 - scaledX1}px`;
                textContent.style.height = `${scaledY2 - scaledY1}px`;
                textContent.contentEditable = true; // Make text editable
                textContent.spellcheck = false;
                
                // Add edit indicator and instructions
                textContent.addEventListener('focus', () => {
                    textContent.classList.add('editing');
                });
                
                textContent.addEventListener('blur', () => {
                    textContent.classList.remove('editing');
                });
                
                imageWrapper.appendChild(textContent);
                
                // Link the text content to the box for synchronized movement
                box.dataset.textContentId = `surya-text-content-${index}`;
                textContent.id = `surya-text-content-${index}`;
                
                // Make the box draggable
                makeElementDraggable(box, label, imageWrapper, textContent);
                
                // Make the box resizable
                makeElementResizable(box, imageWrapper, textContent);
            }
        });
    };
    
    // Add OCR results section if we have text detections with OCR or unmatched Surya results
    if (ocrTextCount > 0 || unmatchedSuryaCount > 0) {
        const ocrSection = document.createElement('div');
        ocrSection.className = 'ocr-results-section';
        ocrSection.innerHTML = `<h3>OCR Results (${ocrTextCount + unmatchedSuryaCount})</h3>`;
        
        const ocrList = document.createElement('ul');
        ocrList.className = 'ocr-results-list';
        
        // Group OCR results by class
        const ocrByClass = {
            'title': [],
            'page-text': [],
            'other-text': [],
            'caption': [],
            'unmatched': [], // For unmatched Surya OCR results
            'text': [] // Default class
        };
        
        // Add YOLO detection OCR results
        detections.forEach(detection => {
            if (detection.ocr_text) {
                const ocrClass = detection.ocr_class || 'text';
                if (!ocrByClass[ocrClass]) {
                    ocrByClass[ocrClass] = [];
                }
                ocrByClass[ocrClass].push(detection);
            }
        });
        
        // Add unmatched Surya OCR results
        suryaResults.forEach(result => {
            if (!result.matched && result.text && result.text.trim()) {
                ocrByClass['unmatched'].push({
                    text: result.text,
                    bbox: result.bbox,
                    confidence: result.confidence,
                    ocr_class: 'unmatched',
                    ocr_source: 'surya'
                });
            }
        });
        
        // Sort results by y position first (top to bottom), then by x position (left to right)
        Object.keys(ocrByClass).forEach(ocrClass => {
            const classResults = ocrByClass[ocrClass];
            if (classResults.length === 0) return;
            
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
            
            // Add class header
            const classHeader = document.createElement('li');
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
            ocrList.appendChild(classHeader);
            
            // Add each OCR result for this class
            classResults.forEach(detection => {
                const ocrItem = document.createElement('li');
                ocrItem.className = 'ocr-result-item';
                
                // Add source indicator for unmatched results
                let sourceInfo = '';
                if (ocrClass === 'unmatched') {
                    sourceInfo = ` <span class="ocr-source">(Surya OCR)</span>`;
                } else if (detection.ocr_source) {
                    sourceInfo = ` <span class="ocr-source">(${detection.ocr_source})</span>`;
                }
                
                // Use the correct property based on the source (ocr_text for YOLO detections, text for unmatched Surya)
                const textContent = ocrClass === 'unmatched' ? detection.text : detection.ocr_text;
                ocrItem.innerHTML = `${textContent}${sourceInfo}`;
                ocrList.appendChild(ocrItem);
            });
        });
        
        ocrSection.appendChild(ocrList);
        detectionList.appendChild(ocrSection);
    }
    
    // Add event listener for add text button
    document.getElementById('addTextBtn').addEventListener('click', () => {
        // Create a new text element
        const textContent = document.createElement('div');
        textContent.className = 'text-content new-text';
        textContent.textContent = 'New Text';
        textContent.contentEditable = true;
        textContent.spellcheck = false;
        
        // Position in the center of the image
        const imgWidth = imageWrapper.offsetWidth;
        const imgHeight = imageWrapper.offsetHeight;
        const textWidth = 150;
        const textHeight = 50;
        
        textContent.style.left = `${(imgWidth / 2) - (textWidth / 2)}px`;
        textContent.style.top = `${(imgHeight / 2) - (textHeight / 2)}px`;
        textContent.style.width = `${textWidth}px`;
        textContent.style.height = `${textHeight}px`;
        
        // Add edit indicator and instructions
        textContent.addEventListener('focus', () => {
            textContent.classList.add('editing');
        });
        
        textContent.addEventListener('blur', () => {
            textContent.classList.remove('editing');
        });
        
        // Create a box for the text
        const box = document.createElement('div');
        box.className = 'detection-box text-detection interactive-box new-element';
        box.style.left = textContent.style.left;
        box.style.top = textContent.style.top;
        box.style.width = textContent.style.width;
        box.style.height = textContent.style.height;
        
        // Add resize handles
        const handles = ['nw', 'ne', 'sw', 'se'];
        handles.forEach(handle => {
            const resizeHandle = document.createElement('div');
            resizeHandle.className = `resize-handle ${handle}-handle`;
            box.appendChild(resizeHandle);
        });
        
        // Create a label for the text
        const label = document.createElement('div');
        label.className = 'detection-label text-detection-label';
        label.textContent = 'New Text';
        label.style.left = textContent.style.left;
        label.style.top = `${parseInt(textContent.style.top) - 20}px`;
        
        // Add extract button
        const extractBtn = document.createElement('button');
        extractBtn.className = 'extract-btn';
        extractBtn.innerHTML = '<i class="fas fa-download"></i>';
        extractBtn.title = 'Extract this element';
        extractBtn.onclick = (e) => {
            e.stopPropagation();
            extractElement(box, 'new-text');
        };
        label.appendChild(extractBtn);
        
        // Add delete button
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-btn';
        deleteBtn.innerHTML = '<i class="fas fa-trash"></i>';
        deleteBtn.title = 'Delete this element';
        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            box.remove();
            label.remove();
            textContent.remove();
        };
        label.appendChild(deleteBtn);
        
        // Generate a unique ID for the text content
        const textId = `new-text-${new Date().getTime()}`;
        box.dataset.textContentId = textId;
        textContent.id = textId;
        
        // Add elements to the image wrapper
        imageWrapper.appendChild(box);
        imageWrapper.appendChild(label);
        imageWrapper.appendChild(textContent);
        
        // Make the box draggable
        makeElementDraggable(box, label, imageWrapper, textContent);
        
        // Make the box resizable
        makeElementResizable(box, imageWrapper, textContent);
        
        // Focus the text content for immediate editing
        textContent.focus();
    });
    
    // Add event listener for add image button
    document.getElementById('addImageBtn').addEventListener('click', () => {
        // Trigger file input
        document.getElementById('imageUpload').click();
    });
    
    // Add event listener for image upload
    document.getElementById('imageUpload').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = function(event) {
                // Create a new image element
                const img = new Image();
                img.src = event.target.result;
                
                img.onload = function() {
                    // Create a container for the image
                    const imgContainer = document.createElement('div');
                    imgContainer.className = 'custom-image-container';
                    
                    // Set a reasonable size for the image (max 300px width/height)
                    const maxSize = 300;
                    let width = img.width;
                    let height = img.height;
                    
                    if (width > height && width > maxSize) {
                        height = (height / width) * maxSize;
                        width = maxSize;
                    } else if (height > width && height > maxSize) {
                        width = (width / height) * maxSize;
                        height = maxSize;
                    }
                    
                    // Position in the center of the image wrapper
                    const imgWrapperWidth = imageWrapper.offsetWidth;
                    const imgWrapperHeight = imageWrapper.offsetHeight;
                    
                    imgContainer.style.left = `${(imgWrapperWidth / 2) - (width / 2)}px`;
                    imgContainer.style.top = `${(imgWrapperHeight / 2) - (height / 2)}px`;
                    imgContainer.style.width = `${width}px`;
                    imgContainer.style.height = `${height}px`;
                    
                    // Set the image as background
                    imgContainer.style.backgroundImage = `url(${event.target.result})`;
                    
                    // Create a box for the image
                    const box = document.createElement('div');
                    box.className = 'detection-box interactive-box new-element custom-image-box';
                    box.style.left = imgContainer.style.left;
                    box.style.top = imgContainer.style.top;
                    box.style.width = imgContainer.style.width;
                    box.style.height = imgContainer.style.height;
                    
                    // Add resize handles
                    const handles = ['nw', 'ne', 'sw', 'se'];
                    handles.forEach(handle => {
                        const resizeHandle = document.createElement('div');
                        resizeHandle.className = `resize-handle ${handle}-handle`;
                        box.appendChild(resizeHandle);
                    });
                    
                    // Create a label for the image
                    const label = document.createElement('div');
                    label.className = 'detection-label';
                    label.textContent = 'Custom Image';
                    label.style.left = imgContainer.style.left;
                    label.style.top = `${parseInt(imgContainer.style.top) - 20}px`;
                    
                    // Add extract button
                    const extractBtn = document.createElement('button');
                    extractBtn.className = 'extract-btn';
                    extractBtn.innerHTML = '<i class="fas fa-download"></i>';
                    extractBtn.title = 'Extract this element';
                    extractBtn.onclick = (e) => {
                        e.stopPropagation();
                        extractElement(box, 'custom-image');
                    };
                    label.appendChild(extractBtn);
                    
                    // Add delete button
                    const deleteBtn = document.createElement('button');
                    deleteBtn.className = 'delete-btn';
                    deleteBtn.innerHTML = '<i class="fas fa-trash"></i>';
                    deleteBtn.title = 'Delete this element';
                    deleteBtn.onclick = (e) => {
                        e.stopPropagation();
                        box.remove();
                        label.remove();
                        imgContainer.remove();
                    };
                    label.appendChild(deleteBtn);
                    
                    // Generate a unique ID for the image container
                    const imgId = `custom-image-${new Date().getTime()}`;
                    box.dataset.imageContainerId = imgId;
                    imgContainer.id = imgId;
                    
                    // Add elements to the image wrapper
                    imageWrapper.appendChild(imgContainer);
                    imageWrapper.appendChild(box);
                    imageWrapper.appendChild(label);
                    
                    // Make the box draggable with the image container
                    makeElementDraggable(box, label, imageWrapper, imgContainer);
                    
                    // Make the box resizable with the image container
                    makeElementResizable(box, imageWrapper, imgContainer);
                    
                    // Reset the file input
                    e.target.value = '';
                };
            };
            reader.readAsDataURL(file);
        }
    });
    
    // Add event listener for create background button
    document.getElementById('createBackgroundBtn').addEventListener('click', () => {
        createCleanBackground(scene, imageWrapper, img);
    });
    
    overlay.style.display = 'flex';
}

/**
 * Toggles the display of scene markers in the progress bar
 */
export function toggleSceneMarkers() {
    state.showSceneMarkers = elements.sceneToggle.checked;
    
    // Update the progress bar with or without scene markers
    if (state.videoScenes.length > 0 && elements.videoPlayer.duration) {
        updateScenes(state.videoScenes, elements.videoPlayer);
    }
}

/**
 * Extracts an element as a separate image
 * @param {HTMLElement} element - The element to extract
 * @param {string} className - The class name for the filename
 */
function extractElement(element, className) {
    // Create a canvas to draw the extracted element
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    // Get the original image
    const img = element.closest('.image-wrapper').querySelector('.detection-image');
    
    // Get the element's position and dimensions
    const rect = element.getBoundingClientRect();
    const imgRect = img.getBoundingClientRect();
    
    // Calculate the position relative to the image
    const x = rect.left - imgRect.left;
    const y = rect.top - imgRect.top;
    const width = rect.width;
    const height = rect.height;
    
    // Set canvas dimensions
    canvas.width = width;
    canvas.height = height;
    
    // Draw the portion of the image onto the canvas
    ctx.drawImage(
        img,
        x / (imgRect.width / img.naturalWidth),
        y / (imgRect.height / img.naturalHeight),
        width / (imgRect.width / img.naturalWidth),
        height / (imgRect.height / img.naturalHeight),
        0, 0, width, height
    );
    
    // Create a download link
    const link = document.createElement('a');
    link.download = `extracted_${className}_${new Date().getTime()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
}

/**
 * Makes an element draggable
 * @param {HTMLElement} element - The element to make draggable
 * @param {HTMLElement} label - The label element that should move with the box
 * @param {HTMLElement} container - The container element
 * @param {HTMLElement} [linkedElement] - Optional linked element to move with the box
 */
function makeElementDraggable(element, label, container, linkedElement) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    
    element.onmousedown = dragMouseDown;
    
    function dragMouseDown(e) {
        e = e || window.event;
        e.preventDefault();
        
        // Check if we're clicking on a resize handle
        if (e.target.classList.contains('resize-handle')) {
            return;
        }
        
        // Get the mouse cursor position at startup
        pos3 = e.clientX;
        pos4 = e.clientY;
        document.onmouseup = closeDragElement;
        document.onmousemove = elementDrag;
        
        // Add active class
        element.classList.add('active-drag');
    }
    
    function elementDrag(e) {
        e = e || window.event;
        e.preventDefault();
        
        // Calculate the new cursor position
        pos1 = pos3 - e.clientX;
        pos2 = pos4 - e.clientY;
        pos3 = e.clientX;
        pos4 = e.clientY;
        
        // Set the element's new position
        const newTop = (element.offsetTop - pos2);
        const newLeft = (element.offsetLeft - pos1);
        
        // Ensure the element stays within the container
        const maxLeft = container.offsetWidth - element.offsetWidth;
        const maxTop = container.offsetHeight - element.offsetHeight;
        
        const constrainedTop = Math.max(0, Math.min(newTop, maxTop));
        const constrainedLeft = Math.max(0, Math.min(newLeft, maxLeft));
        
        element.style.top = `${constrainedTop}px`;
        element.style.left = `${constrainedLeft}px`;
        
        // Move the label with the box
        if (label) {
            label.style.top = `${Math.max(0, Math.min(constrainedTop - 20, maxTop))}px`;
            label.style.left = `${constrainedLeft}px`;
        }
        
        // Move the text content with the box if it exists
        if (element.dataset.textContentId) {
            const textContent = document.getElementById(element.dataset.textContentId);
            if (textContent) {
                textContent.style.top = `${constrainedTop}px`;
                textContent.style.left = `${constrainedLeft}px`;
            }
        }
        
        // Move the extracted image with the box if it exists
        if (element.dataset.extractedImageId) {
            const extractedImg = document.getElementById(element.dataset.extractedImageId);
            if (extractedImg) {
                extractedImg.style.top = `${constrainedTop}px`;
                extractedImg.style.left = `${constrainedLeft}px`;
            }
        }
        
        // Move the linked element if it exists
        if (linkedElement) {
            linkedElement.style.top = `${constrainedTop}px`;
            linkedElement.style.left = `${constrainedLeft}px`;
        }
        
        // Move the image container if it exists
        if (element.dataset.imageContainerId) {
            const imgContainer = document.getElementById(element.dataset.imageContainerId);
            if (imgContainer) {
                imgContainer.style.top = `${constrainedTop}px`;
                imgContainer.style.left = `${constrainedLeft}px`;
            }
        }
    }
    
    function closeDragElement() {
        // Stop moving when mouse button is released
        document.onmouseup = null;
        document.onmousemove = null;
        
        // Remove active class
        element.classList.remove('active-drag');
    }
}

/**
 * Makes an element resizable
 * @param {HTMLElement} element - The element to make resizable
 * @param {HTMLElement} container - The container element
 * @param {HTMLElement} [linkedElement] - Optional linked element to resize with the box
 */
function makeElementResizable(element, container, linkedElement) {
    const handles = element.querySelectorAll('.resize-handle');
    
    handles.forEach(handle => {
        handle.addEventListener('mousedown', function(e) {
            e.stopPropagation();
            e.preventDefault();
            
            const startX = e.clientX;
            const startY = e.clientY;
            const startWidth = element.offsetWidth;
            const startHeight = element.offsetHeight;
            const startLeft = element.offsetLeft;
            const startTop = element.offsetTop;
            
            const handleClass = handle.className;
            const isNorth = handleClass.includes('nw-handle') || handleClass.includes('ne-handle');
            const isWest = handleClass.includes('nw-handle') || handleClass.includes('sw-handle');
            
            // Add active class
            element.classList.add('active-resize');
            
            function resize(e) {
                let newWidth, newHeight, newLeft, newTop;
                
                // Calculate new width and left position
                if (isWest) {
                    newWidth = startWidth - (e.clientX - startX);
                    newLeft = startLeft + (e.clientX - startX);
                    
                    // Enforce minimum width
                    if (newWidth < 20) {
                        newWidth = 20;
                        newLeft = startLeft + startWidth - 20;
                    }
                } else {
                    newWidth = startWidth + (e.clientX - startX);
                    newLeft = startLeft;
                    
                    // Enforce minimum width
                    if (newWidth < 20) {
                        newWidth = 20;
                    }
                }
                
                // Calculate new height and top position
                if (isNorth) {
                    newHeight = startHeight - (e.clientY - startY);
                    newTop = startTop + (e.clientY - startY);
                    
                    // Enforce minimum height
                    if (newHeight < 20) {
                        newHeight = 20;
                        newTop = startTop + startHeight - 20;
                    }
                } else {
                    newHeight = startHeight + (e.clientY - startY);
                    newTop = startTop;
                    
                    // Enforce minimum height
                    if (newHeight < 20) {
                        newHeight = 20;
                    }
                }
                
                // Ensure the element stays within the container
                const maxLeft = container.offsetWidth - newWidth;
                const maxTop = container.offsetHeight - newHeight;
                
                newLeft = Math.max(0, Math.min(newLeft, maxLeft));
                newTop = Math.max(0, Math.min(newTop, maxTop));
                
                // Update the element dimensions and position
                element.style.width = `${newWidth}px`;
                element.style.height = `${newHeight}px`;
                element.style.left = `${newLeft}px`;
                element.style.top = `${newTop}px`;
                
                // Update the label position
                const label = element.nextElementSibling;
                if (label && label.classList.contains('detection-label')) {
                    label.style.left = `${newLeft}px`;
                    label.style.top = `${newTop - 20}px`;
                }
                
                // Update the text content dimensions and position if it exists
                if (element.dataset.textContentId) {
                    const textContent = document.getElementById(element.dataset.textContentId);
                    if (textContent) {
                        textContent.style.width = `${newWidth}px`;
                        textContent.style.height = `${newHeight}px`;
                        textContent.style.left = `${newLeft}px`;
                        textContent.style.top = `${newTop}px`;
                    }
                }
                
                // Update the extracted image dimensions and position if it exists
                if (element.dataset.extractedImageId) {
                    const extractedImg = document.getElementById(element.dataset.extractedImageId);
                    if (extractedImg) {
                        extractedImg.style.width = `${newWidth}px`;
                        extractedImg.style.height = `${newHeight}px`;
                        extractedImg.style.left = `${newLeft}px`;
                        extractedImg.style.top = `${newTop}px`;
                    }
                }
                
                // Update the linked element if it exists
                if (linkedElement) {
                    linkedElement.style.width = `${newWidth}px`;
                    linkedElement.style.height = `${newHeight}px`;
                    linkedElement.style.left = `${newLeft}px`;
                    linkedElement.style.top = `${newTop}px`;
                }
                
                // Update the image container if it exists
                if (element.dataset.imageContainerId) {
                    const imgContainer = document.getElementById(element.dataset.imageContainerId);
                    if (imgContainer) {
                        imgContainer.style.width = `${newWidth}px`;
                        imgContainer.style.height = `${newHeight}px`;
                        imgContainer.style.left = `${newLeft}px`;
                        imgContainer.style.top = `${newTop}px`;
                    }
                }
            }
            
            function stopResize() {
                document.removeEventListener('mousemove', resize);
                document.removeEventListener('mouseup', stopResize);
                
                // Remove active class
                element.classList.remove('active-resize');
            }
            
            document.addEventListener('mousemove', resize);
            document.addEventListener('mouseup', stopResize);
        });
    });
}

/**
 * Creates a clean background by inpainting detected elements
 * @param {Object} scene - The scene data
 * @param {HTMLElement} imageWrapper - The image wrapper element
 * @param {HTMLImageElement} originalImg - The original image element
 */
function createCleanBackground(scene, imageWrapper, originalImg) {
    console.log('Creating clean background...');
    
    // Show loading indicator
    const loadingIndicator = document.createElement('div');
    loadingIndicator.className = 'inpainting-loading';
    loadingIndicator.innerHTML = `
        <div class="loading-spinner"></div>
        <p>Creating clean background...</p>
    `;
    imageWrapper.appendChild(loadingIndicator);
    
    try {
        // Remove any existing background
        const existingBg = imageWrapper.querySelector('.background-container');
        if (existingBg) {
            existingBg.remove();
        }
        
        // Create a canvas to draw the image
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        // Set canvas dimensions to match the image
        canvas.width = originalImg.naturalWidth;
        canvas.height = originalImg.naturalHeight;
        
        // Draw the original image onto the canvas
        ctx.drawImage(originalImg, 0, 0);
        
        // Get all detection boxes
        const detectionBoxes = [];
        
        // Add YOLO detections
        if (scene.yolo_detections && scene.yolo_detections.success) {
            scene.yolo_detections.detections.forEach(detection => {
                detectionBoxes.push(detection.bbox);
            });
        }
        
        // Add Surya OCR detections
        if (scene.surya_ocr && scene.surya_ocr.success) {
            scene.surya_ocr.results.forEach(result => {
                if (result.bbox && result.bbox.length === 4) {
                    detectionBoxes.push(result.bbox);
                }
            });
        }
        
        console.log('Detection boxes to inpaint:', detectionBoxes.length);
        
        // If no detections, just return
        if (detectionBoxes.length === 0) {
            loadingIndicator.remove();
            showNotification('No elements to remove for background creation', 'info');
            return;
        }
        
        // Add margin to detection boxes for better inpainting
        const margin = 3;
        const expandedBoxes = detectionBoxes.map(bbox => {
            const [x1, y1, x2, y2] = bbox;
            return [
                Math.max(0, Math.floor(x1) - margin),
                Math.max(0, Math.floor(y1) - margin),
                Math.min(canvas.width, Math.ceil(x2) + margin),
                Math.min(canvas.height, Math.ceil(y2) + margin)
            ];
        });
        
        // Process each detection box individually
        expandedBoxes.forEach((bbox, index) => {
            const [x1, y1, x2, y2] = bbox;
            const boxWidth = x2 - x1;
            const boxHeight = y2 - y1;
            
            if (boxWidth <= 0 || boxHeight <= 0) return;
            
            // Calculate the average color of the border pixels around the box
            const borderPixels = [];
            
            // Sample pixels from the top and bottom edges of the box
            for (let x = x1; x < x2; x++) {
                // Top edge (if in bounds)
                if (y1 > 0) {
                    const topIdx = ((y1 - 1) * canvas.width + x) * 4;
                    borderPixels.push([
                        ctx.getImageData(x, y1 - 1, 1, 1).data[0],
                        ctx.getImageData(x, y1 - 1, 1, 1).data[1],
                        ctx.getImageData(x, y1 - 1, 1, 1).data[2],
                        ctx.getImageData(x, y1 - 1, 1, 1).data[3]
                    ]);
                }
                
                // Bottom edge (if in bounds)
                if (y2 < canvas.height) {
                    borderPixels.push([
                        ctx.getImageData(x, y2, 1, 1).data[0],
                        ctx.getImageData(x, y2, 1, 1).data[1],
                        ctx.getImageData(x, y2, 1, 1).data[2],
                        ctx.getImageData(x, y2, 1, 1).data[3]
                    ]);
                }
            }
            
            // Sample pixels from the left and right edges of the box
            for (let y = y1; y < y2; y++) {
                // Left edge (if in bounds)
                if (x1 > 0) {
                    borderPixels.push([
                        ctx.getImageData(x1 - 1, y, 1, 1).data[0],
                        ctx.getImageData(x1 - 1, y, 1, 1).data[1],
                        ctx.getImageData(x1 - 1, y, 1, 1).data[2],
                        ctx.getImageData(x1 - 1, y, 1, 1).data[3]
                    ]);
                }
                
                // Right edge (if in bounds)
                if (x2 < canvas.width) {
                    borderPixels.push([
                        ctx.getImageData(x2, y, 1, 1).data[0],
                        ctx.getImageData(x2, y, 1, 1).data[1],
                        ctx.getImageData(x2, y, 1, 1).data[2],
                        ctx.getImageData(x2, y, 1, 1).data[3]
                    ]);
                }
            }
            
            // Calculate the average color
            let avgR = 0, avgG = 0, avgB = 0, avgA = 0;
            
            if (borderPixels.length > 0) {
                for (const pixel of borderPixels) {
                    avgR += pixel[0];
                    avgG += pixel[1];
                    avgB += pixel[2];
                    avgA += pixel[3];
                }
                
                avgR = Math.round(avgR / borderPixels.length);
                avgG = Math.round(avgG / borderPixels.length);
                avgB = Math.round(avgB / borderPixels.length);
                avgA = Math.round(avgA / borderPixels.length);
            } else {
                // If no border pixels, use a default light gray
                avgR = 240;
                avgG = 240;
                avgB = 240;
                avgA = 255;
            }
            
            // Fill the box with the average color
            ctx.fillStyle = `rgba(${avgR}, ${avgG}, ${avgB}, ${avgA / 255})`;
            ctx.fillRect(x1, y1, boxWidth, boxHeight);
        });
        
        // Create a new image from the canvas
        const bgImg = new Image();
        bgImg.onload = function() {
            // Create a background container
            const bgContainer = document.createElement('div');
            bgContainer.className = 'background-container';
            bgContainer.style.backgroundImage = `url(${bgImg.src})`;
            
            // Insert the background at the beginning of the wrapper
            imageWrapper.insertBefore(bgContainer, imageWrapper.firstChild);
            
            // Remove loading indicator
            loadingIndicator.remove();
            
            // Show notification
            showNotification('Clean background created successfully', 'success');
            
            // Log success
            console.log('Background created successfully');
        };
        bgImg.onerror = function(e) {
            console.error('Failed to load background image', e);
            loadingIndicator.remove();
            showNotification('Failed to create background image', 'error');
        };
        
        // Set the image source
        bgImg.src = canvas.toDataURL('image/png');
    } catch (e) {
        console.error('Error in background creation:', e);
        loadingIndicator.remove();
        showNotification('Error creating background: ' + e.message, 'error');
    }
}

/**
 * Shows a notification message
 * @param {string} message - The message to display
 * @param {string} type - The notification type (success, error, info, warning)
 */
function showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    
    // Add to document
    document.body.appendChild(notification);
    
    // Show notification
    setTimeout(() => {
        notification.style.opacity = '1';
    }, 10);
    
    // Hide and remove after 5 seconds
    setTimeout(() => {
        notification.style.opacity = '0';
        setTimeout(() => {
            notification.remove();
        }, 300);
    }, 5000);
}

/**
 * Toggles the display of object detection results on the video
 * @param {boolean} show - Whether to show or hide the detection results
 */
export function toggleVideoDetections(show) {
    console.log('toggleVideoDetections called with show =', show);
    
    // Log debug info
    logDebugInfo();
    
    const videoDetectionOverlay = document.getElementById('videoDetectionOverlay');
    
    if (!videoDetectionOverlay) {
        console.log('No overlay found, creating one');
        // Create the overlay if it doesn't exist
        createVideoDetectionOverlay();
    }
    
    // Show or hide the overlay
    if (videoDetectionOverlay) {
        console.log('Setting overlay display to', show ? 'block' : 'none');
        videoDetectionOverlay.style.display = show ? 'block' : 'none';
        
        // If showing, force an update of the overlay
        if (show) {
            console.log('Forcing update of detection overlay');
            
            // Check if we have scenes data
            if (!state.videoScenes || state.videoScenes.length === 0) {
                console.log('No scenes data available, loading scenes');
                loadScenesAndUpdateOverlay();
            } else {
                // Use the immediate update function instead of the throttled one
                forceImmediateOverlayUpdate();
            }
        }
    }
    
    // Update the toggle button state
    const toggleBtn = document.getElementById('toggleVideoDetectionsBtn');
    if (toggleBtn) {
        toggleBtn.classList.toggle('active', show);
        toggleBtn.innerHTML = show ? 
            '<i class="fas fa-eye-slash"></i> Hide Detections' : 
            '<i class="fas fa-eye"></i> Show Detections';
    }
    
    // Show/hide the toggle labels button
    const toggleLabelsBtn = document.getElementById('toggleLabelsBtn');
    if (toggleLabelsBtn) {
        // Make sure the button is visible when detections are shown
        toggleLabelsBtn.style.display = show ? 'inline-block' : 'none';
    } else if (show) {
        // If the button doesn't exist but detections are shown, create it
        const detectionControls = document.querySelector('.detection-video-controls');
        if (detectionControls) {
            const newToggleLabelsBtn = document.createElement('button');
            newToggleLabelsBtn.id = 'toggleLabelsBtn';
            newToggleLabelsBtn.className = 'btn btn-secondary detection-toggle-btn active';
            newToggleLabelsBtn.innerHTML = '<i class="fas fa-tag"></i> Hide Labels';
            newToggleLabelsBtn.onclick = function() {
                const isCurrentlyShown = this.classList.contains('active');
                console.log('Toggle labels button clicked, current state:', isCurrentlyShown);
                toggleLabels(!isCurrentlyShown);
            };
            
            detectionControls.appendChild(newToggleLabelsBtn);
            console.log('Toggle labels button created and added to detection controls');
        }
    }
}

/**
 * Creates a throttled function that only invokes the provided function at most once per specified interval
 * @param {Function} func - The function to throttle
 * @param {number} limit - The time limit in milliseconds
 * @returns {Function} - The throttled function
 */
function throttle(func, limit) {
    let inThrottle;
    let lastFunc;
    let lastRan;
    
    return function() {
        const context = this;
        const args = arguments;
        
        if (!inThrottle) {
            func.apply(context, args);
            lastRan = Date.now();
            inThrottle = true;
        } else {
            clearTimeout(lastFunc);
            lastFunc = setTimeout(function() {
                if ((Date.now() - lastRan) >= limit) {
                    func.apply(context, args);
                    lastRan = Date.now();
                }
            }, limit - (Date.now() - lastRan));
        }
    };
}

/**
 * Updates the content of the detection overlay with the current scene's detections
 * @param {HTMLVideoElement} videoPlayer - The video player element
 * @param {HTMLElement} overlay - The detection overlay element
 */
function updateDetectionOverlayContent(videoPlayer, overlay) {
    // Only update if the overlay is visible
    if (overlay.style.display === 'none') {
        return;
    }
    
    // Clear the overlay
    overlay.innerHTML = '';
    
    // Get the current time
    const currentTime = videoPlayer.currentTime;
    
    // Find the scene that corresponds to the current time
    const currentScene = findSceneAtTime(currentTime);
    
    if (!currentScene) {
        console.log('No scene found for time', currentTime);
        return;
    }
    
    console.log('Found scene for time', currentTime, currentScene);
    
    // Get the video's intrinsic dimensions
    const videoWidth = videoPlayer.videoWidth;
    const videoHeight = videoPlayer.videoHeight;
    
    // Get the container dimensions
    const videoRect = videoPlayer.getBoundingClientRect();
    const containerWidth = videoRect.width;
    const containerHeight = videoRect.height;
    
    // Calculate the displayed video dimensions accounting for object-fit: contain
    let displayWidth, displayHeight, offsetX = 0, offsetY = 0;
    
    // Calculate aspect ratios
    const videoAspectRatio = videoWidth / videoHeight;
    const containerAspectRatio = containerWidth / containerHeight;
    
    if (videoAspectRatio > containerAspectRatio) {
        // Video is wider than container (letterboxing on top and bottom)
        displayWidth = containerWidth;
        displayHeight = containerWidth / videoAspectRatio;
        offsetY = (containerHeight - displayHeight) / 2;
    } else {
        // Video is taller than container (letterboxing on left and right)
        displayHeight = containerHeight;
        displayWidth = containerHeight * videoAspectRatio;
        offsetX = (containerWidth - displayWidth) / 2;
    }
    
    // Calculate scaling factors based on the actual displayed video size
    const scaleX = displayWidth / videoWidth;
    const scaleY = displayHeight / videoHeight;
    
    console.log('Video dimensions:', videoWidth, 'x', videoHeight);
    console.log('Container dimensions:', containerWidth, 'x', containerHeight);
    console.log('Display dimensions:', displayWidth, 'x', displayHeight);
    console.log('Offsets:', offsetX, offsetY);
    console.log('Scale factors:', scaleX, scaleY);
    
    // Draw YOLO detections
    if (currentScene.yolo_detections && currentScene.yolo_detections.success) {
        console.log('Drawing YOLO detections:', currentScene.yolo_detections.detections.length);
        currentScene.yolo_detections.detections.forEach(detection => {
            const [x1, y1, x2, y2] = detection.bbox;
            
            // Scale coordinates to match displayed video size and add offsets for letterboxing
            const scaledX1 = x1 * scaleX + offsetX;
            const scaledY1 = y1 * scaleY + offsetY;
            const scaledX2 = x2 * scaleX + offsetX;
            const scaledY2 = y2 * scaleY + offsetY;
            
            // Create detection box
            const box = document.createElement('div');
            box.className = 'video-detection-box';
            
            // Special styling for text detections
            const isTextDetection = detection.class.toLowerCase().includes('text') || 
                                   ['title', 'page-text', 'other-text', 'caption'].includes(detection.class.toLowerCase());
            
            if (isTextDetection) {
                box.classList.add('video-text-detection');
            }
            
            box.style.left = `${scaledX1}px`;
            box.style.top = `${scaledY1}px`;
            box.style.width = `${scaledX2 - scaledX1}px`;
            box.style.height = `${scaledY2 - scaledY1}px`;
            
            // Create detection label
            const label = document.createElement('div');
            label.className = 'video-detection-label';
            
            if (isTextDetection) {
                label.classList.add('video-text-detection-label');
            }
            
            // Position label at top of box
            label.style.left = `${scaledX1}px`;
            label.style.top = `${scaledY1 - 20}px`;
            
            // Set display based on labelsVisible state
            label.style.display = labelsVisible ? 'block' : 'none';
            if (!labelsVisible) {
                label.classList.add('hidden');
            }
            
            // Label content
            let labelText = `${detection.class} (${Math.round(detection.confidence * 100)}%)`;
            if (detection.ocr_text) {
                labelText = detection.ocr_text.substring(0, 20) + (detection.ocr_text.length > 20 ? '...' : '');
            }
            label.textContent = labelText;
            
            // Add elements to the overlay
            overlay.appendChild(box);
            overlay.appendChild(label);
        });
    }
    
    // Draw Surya OCR detections
    if (currentScene.surya_ocr && currentScene.surya_ocr.success) {
        currentScene.surya_ocr.results.forEach(result => {
            if (!result.matched && result.text && result.text.trim() && result.bbox && result.bbox.length === 4) {
                const [x1, y1, x2, y2] = result.bbox;
                
                // Scale coordinates to match displayed video size and add offsets for letterboxing
                const scaledX1 = x1 * scaleX + offsetX;
                const scaledY1 = y1 * scaleY + offsetY;
                const scaledX2 = x2 * scaleX + offsetX;
                const scaledY2 = y2 * scaleY + offsetY;
                
                // Create detection box
                const box = document.createElement('div');
                box.className = 'video-detection-box video-unmatched-detection';
                
                box.style.left = `${scaledX1}px`;
                box.style.top = `${scaledY1}px`;
                box.style.width = `${scaledX2 - scaledX1}px`;
                box.style.height = `${scaledY2 - scaledY1}px`;
                
                // Create detection label
                const label = document.createElement('div');
                label.className = 'video-detection-label video-unmatched-label';
                
                // Position label at top of box
                label.style.left = `${scaledX1}px`;
                label.style.top = `${scaledY1 - 20}px`;
                
                // Set display based on labelsVisible state
                label.style.display = labelsVisible ? 'block' : 'none';
                if (!labelsVisible) {
                    label.classList.add('hidden');
                }
                
                // Label content
                const labelText = result.text.substring(0, 20) + (result.text.length > 20 ? '...' : '');
                label.textContent = labelText;
                
                // Add elements to the overlay
                overlay.appendChild(box);
                overlay.appendChild(label);
            }
        });
    }
}

/**
 * Forces an immediate update of the detection overlay, bypassing the throttling mechanism
 */
function forceImmediateOverlayUpdate() {
    console.log('Forcing immediate overlay update');
    
    const videoPlayer = elements.videoPlayer;
    const overlay = document.getElementById('videoDetectionOverlay');
    
    if (!videoPlayer || !overlay) {
        console.log('forceImmediateOverlayUpdate: No video player or overlay found');
        return;
    }
    
    // Use the shared function to update the overlay content
    updateDetectionOverlayContent(videoPlayer, overlay);
}

// Throttled version of updateVideoDetectionOverlay
const throttledUpdateOverlay = throttle(function() {
    const videoPlayer = elements.videoPlayer;
    const overlay = document.getElementById('videoDetectionOverlay');
    
    if (!videoPlayer || !overlay) {
        console.log('updateVideoDetectionOverlay: No video player or overlay found');
        return;
    }
    
    // Use the shared function to update the overlay content
    updateDetectionOverlayContent(videoPlayer, overlay);
}, 1000); // Throttle to once every 500ms

/**
 * Updates the video detection overlay based on the current video time
 * This is now a wrapper around the throttled implementation
 */
export function updateVideoDetectionOverlay() {
    throttledUpdateOverlay();
}

/**
 * Finds the scene that corresponds to the given time
 * @param {number} time - The time in seconds
 * @returns {Object|null} The scene object or null if not found
 */
export function findSceneAtTime(time) {
    // Check cache first for exact match
    if (sceneCache.lastTime === time && sceneCache.lastScene) {
        return sceneCache.lastScene;
    }
    
    // Get the scenes from state
    let scenes = state.videoScenes || [];
    
    // If no scenes are available, try to load them
    if (scenes.length === 0) {
        // Try to get the video ID from the URL
        const urlParams = new URLSearchParams(window.location.search);
        const videoId = urlParams.get('video');
        
        if (videoId) {
            // Make a synchronous request to get scenes
            const xhr = new XMLHttpRequest();
            xhr.open('GET', `/scenes/${videoId}`, false); // Synchronous request
            xhr.send();
            
            if (xhr.status === 200) {
                try {
                    const response = JSON.parse(xhr.responseText);
                    if (response.success && response.scenes) {
                        scenes = response.scenes;
                        state.videoScenes = scenes;
                        
                        // Initialize the time ranges for binary search
                        initializeTimeRanges(scenes);
                    }
                } catch (e) {
                    console.error('Error parsing scenes response:', e);
                }
            }
        }
        
        // If still no scenes, return null
        if (scenes.length === 0) {
            return null;
        }
    }
    
    // Initialize time ranges if not already done
    if (sceneCache.timeRanges.length === 0 && scenes.length > 0) {
        initializeTimeRanges(scenes);
    }
    
    // Use binary search to find the scene
    const sceneIndex = findSceneIndexByTime(time);
    
    if (sceneIndex !== -1 && sceneIndex < scenes.length) {
        const scene = scenes[sceneIndex];
        
        // Update cache
        sceneCache.lastTime = time;
        sceneCache.lastScene = scene;
        
        return scene;
    }
    
    return null;
}

/**
 * Initializes the time ranges array for binary search
 * @param {Array} scenes - The scenes array
 */
function initializeTimeRanges(scenes) {
    sceneCache.timeRanges = [];
    
    scenes.forEach((scene, index) => {
        // Convert timestamp (mm:ss) to seconds
        const sceneStartParts = scene.timestamp.split(':');
        const sceneStartSeconds = parseInt(sceneStartParts[0]) * 60 + parseInt(sceneStartParts[1]);
        
        // Convert next scene timestamp to seconds, or use Infinity if this is the last scene
        let sceneEndSeconds = Infinity;
        if (index < scenes.length - 1) {
            const nextScene = scenes[index + 1];
            const sceneEndParts = nextScene.timestamp.split(':');
            sceneEndSeconds = parseInt(sceneEndParts[0]) * 60 + parseInt(sceneEndParts[1]);
        }
        
        // Store the time range and scene index
        sceneCache.timeRanges.push([sceneStartSeconds, sceneEndSeconds, index]);
    });
}

/**
 * Finds the scene index for a given time using binary search
 * @param {number} time - The time in seconds
 * @returns {number} The scene index or -1 if not found
 */
function findSceneIndexByTime(time) {
    const timeRanges = sceneCache.timeRanges;
    
    // If we have no time ranges, return -1
    if (timeRanges.length === 0) {
        return -1;
    }
    
    // Check if time is before the first scene
    if (time < timeRanges[0][0]) {
        return -1;
    }
    
    // Check if time is after the last scene
    const lastRange = timeRanges[timeRanges.length - 1];
    if (time >= lastRange[0]) {
        return lastRange[2]; // Return the index of the last scene
    }
    
    // Binary search
    let left = 0;
    let right = timeRanges.length - 1;
    
    while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        const [startTime, endTime, sceneIndex] = timeRanges[mid];
        
        if (time >= startTime && time < endTime) {
            return sceneIndex;
        }
        
        if (time < startTime) {
            right = mid - 1;
        } else {
            left = mid + 1;
        }
    }
    
    return -1;
}

/**
 * Clears the scene cache
 * This should be called when scenes are updated
 */
export function clearSceneCache() {
    sceneCache.lastTime = null;
    sceneCache.lastScene = null;
    sceneCache.timeRanges = [];
}

/**
 * Manually loads scenes for the current video and updates the detection overlay
 */
function loadScenesAndUpdateOverlay() {
    console.log('Manually loading scenes and updating overlay');
    
    // Try to get the video ID from the URL
    const urlParams = new URLSearchParams(window.location.search);
    const videoId = urlParams.get('video');
    
    // if (!videoId) {
    //     console.error('No video ID found in URL');
    //     showNotification('Error: No video ID found', 'error');
    //     return;
    // }
    
    console.log('Loading scenes for video ID:', videoId);
    
    // Show loading notification
    showNotification('Loading scene data...', 'info');
    
    // Fetch scenes from the server
    fetch(`/scenes/${videoId}`)
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            if (data.success && data.scenes) {
                console.log('Successfully loaded scenes:', data.scenes.length);
                
                // Update global scenes variable
                window.scenes = data.scenes;
                
                // Update state if available
                if (state) {
                    state.videoScenes = data.scenes;
                }
                
                // Update the detection overlay immediately
                forceImmediateOverlayUpdate();
                
                // Show success notification
                showNotification(`Loaded ${data.scenes.length} scenes`, 'success');
                
                // Dispatch scenesLoaded event
                const event = new CustomEvent('scenesLoaded', {
                    detail: { scenes: data.scenes }
                });
                document.dispatchEvent(event);
            } else {
                console.error('Failed to load scenes:', data);
                showNotification('Error loading scenes', 'error');
            }
        })
        .catch(error => {
            console.error('Error fetching scenes:', error);
            showNotification(`Error: ${error.message}`, 'error');
        });
}

// Initialize the video detection overlay when the page loads
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOMContentLoaded: Initializing video detection overlay');
    
    // Check if scenes are already loaded in the DOM
    if (window.scenes && window.scenes.length > 0) {
        console.log('Scenes already loaded in DOM:', window.scenes.length);
    } else {
        console.log('No scenes loaded in DOM yet');
        // Try to get scenes from the state
        if (state.videoScenes && state.videoScenes.length > 0) {
            console.log('Using scenes from state:', state.videoScenes.length);
            window.scenes = state.videoScenes;
        }
    }
    
    // Add the toggle button to the video controls
    const videoControls = document.querySelector('.video-controls') || document.querySelector('.video-container');
    
    if (videoControls && !document.getElementById('toggleVideoDetectionsBtn')) {
        console.log('Adding toggle button to video controls');
        // Create a container for the detection controls if needed
        let detectionControls = document.querySelector('.detection-video-controls');
        if (!detectionControls) {
            detectionControls = document.createElement('div');
            detectionControls.className = 'detection-video-controls';
            videoControls.appendChild(detectionControls);
        }
        
        // Add toggle button
        const toggleBtn = document.createElement('button');
        toggleBtn.id = 'toggleVideoDetectionsBtn';
        toggleBtn.className = 'btn btn-secondary detection-toggle-btn';
        toggleBtn.innerHTML = '<i class="fas fa-eye"></i> Show Detections';
        toggleBtn.onclick = function() {
            const isCurrentlyShown = this.classList.contains('active');
            console.log('Toggle button clicked, current state:', isCurrentlyShown);
            toggleVideoDetections(!isCurrentlyShown);
        };
        
        detectionControls.appendChild(toggleBtn);
        console.log('Toggle button added to detection controls');
        
        // Add reload button
        const reloadBtn = document.createElement('button');
        reloadBtn.id = 'reloadScenesBtn';
        reloadBtn.className = 'btn btn-secondary detection-toggle-btn';
        reloadBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Reload Scenes';
        reloadBtn.title = 'Force reload scenes data';
        reloadBtn.onclick = function() {
            console.log('Reload scenes button clicked');
            loadScenesAndUpdateOverlay();
        };
        
        detectionControls.appendChild(reloadBtn);
        console.log('Reload button added to detection controls');
        
        // Add toggle labels button
        const toggleLabelsBtn = document.createElement('button');
        toggleLabelsBtn.id = 'toggleLabelsBtn';
        toggleLabelsBtn.className = 'btn btn-secondary detection-toggle-btn active';
        toggleLabelsBtn.innerHTML = '<i class="fas fa-tag"></i> Hide Labels';
        toggleLabelsBtn.style.display = 'none'; // Initially hidden
        toggleLabelsBtn.onclick = function() {
            const isCurrentlyShown = this.classList.contains('active');
            console.log('Toggle labels button clicked, current state:', isCurrentlyShown);
            toggleLabels(!isCurrentlyShown);
        };
        
        detectionControls.appendChild(toggleLabelsBtn);
        console.log('Toggle labels button added to detection controls');
    }
    
    // Check if detections are already visible and show the toggle labels button
    setTimeout(() => {
        const videoDetectionOverlay = document.getElementById('videoDetectionOverlay');
        const toggleLabelsBtn = document.getElementById('toggleLabelsBtn');
        const toggleDetectionsBtn = document.getElementById('toggleVideoDetectionsBtn');
        
        if (videoDetectionOverlay && toggleLabelsBtn && toggleDetectionsBtn) {
            const detectionsVisible = videoDetectionOverlay.style.display === 'block' || 
                                     toggleDetectionsBtn.classList.contains('active');
            
            if (detectionsVisible) {
                console.log('Detections are visible, showing toggle labels button');
                toggleLabelsBtn.style.display = 'inline-block';
            }
        }
    }, 500); // Short delay to ensure DOM is fully processed
    
    // Also add an event listener for when scenes are loaded
    document.addEventListener('scenesLoaded', function(e) {
        console.log('scenesLoaded event received', e.detail);
        // Update the global scenes variable
        if (e.detail && e.detail.scenes) {
            window.scenes = e.detail.scenes;
            console.log('Updated window.scenes with', e.detail.scenes.length, 'scenes');
        }
    });
    
    // Check if video player is ready
    const videoPlayer = elements.videoPlayer;
    if (videoPlayer) {
        console.log('Video player found, checking if metadata is loaded');
        if (videoPlayer.readyState >= 1) {
            console.log('Video metadata already loaded, creating overlay');
            createVideoDetectionOverlay();
        } else {
            console.log('Video metadata not loaded yet, adding event listener');
            videoPlayer.addEventListener('loadedmetadata', function() {
                console.log('Video metadata loaded, creating overlay');
                createVideoDetectionOverlay();
            });
        }
    } else {
        console.log('Video player not found yet');
    }
});

/**
 * Logs debug information about the current state of scenes and video player
 */
function logDebugInfo() {
    console.group('Debug Info');
    
    // Check window.scenes
    console.log('window.scenes:', window.scenes ? `${window.scenes.length} scenes` : 'not defined');
    
    // Check state.videoScenes
    console.log('state.videoScenes:', state.videoScenes ? `${state.videoScenes.length} scenes` : 'not defined');
    
    // Check video player
    const videoPlayer = elements.videoPlayer;
    console.log('videoPlayer:', videoPlayer ? 'found' : 'not found');
    
    if (videoPlayer) {
        console.log('videoPlayer.readyState:', videoPlayer.readyState);
        console.log('videoPlayer.currentTime:', videoPlayer.currentTime);
        console.log('videoPlayer.duration:', videoPlayer.duration);
        console.log('videoPlayer.videoWidth:', videoPlayer.videoWidth);
        console.log('videoPlayer.videoHeight:', videoPlayer.videoHeight);
    }
    
    // Check overlay
    const overlay = document.getElementById('videoDetectionOverlay');
    console.log('videoDetectionOverlay:', overlay ? 'found' : 'not found');
    
    if (overlay) {
        console.log('overlay.style.display:', overlay.style.display);
        console.log('overlay.childElementCount:', overlay.childElementCount);
    }
    
    // Check toggle button
    const toggleBtn = document.getElementById('toggleVideoDetectionsBtn');
    console.log('toggleVideoDetectionsBtn:', toggleBtn ? 'found' : 'not found');
    
    if (toggleBtn) {
        console.log('toggleBtn.classList.contains("active"):', toggleBtn.classList.contains('active'));
    }
    
    // Check URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const videoId = urlParams.get('video');
    console.log('URL video ID:', videoId || 'not found');
    
    console.groupEnd();
}

/**
 * Creates the video detection overlay and adds it to the video container
 */
export function createVideoDetectionOverlay() {
    console.log('createVideoDetectionOverlay called');
    const videoPlayer = elements.videoPlayer;
    const videoContainer = document.querySelector('.video-wrapper');
    
    console.log('videoPlayer:', videoPlayer);
    console.log('videoContainer:', videoContainer);
    
    if (!videoPlayer || !videoContainer) {
        console.log('No video player or container found');
        return;
    }
    
    // Check if overlay already exists
    let overlay = document.getElementById('videoDetectionOverlay');
    
    if (!overlay) {
        // Create the overlay element
        overlay = document.createElement('div');
        overlay.id = 'videoDetectionOverlay';
        overlay.className = 'video-detection-overlay';
        
        // Position the overlay over the video
        overlay.style.position = 'absolute';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.pointerEvents = 'none';
        overlay.style.zIndex = '5';
        
        // Add the overlay to the video container
        videoContainer.appendChild(overlay);
        console.log('Overlay added to video container');
    }
    
    overlay.style.display = 'none';
    // console.log('Overlay display set to block');
    
    // Add the toggle button to the video controls if it doesn't exist
    if (!document.getElementById('toggleVideoDetectionsBtn')) {
        const videoControls = document.querySelector('.video-controls') || document.querySelector('.video-container');
        console.log('videoControls:', videoControls);
        
        // Create a container for the detection controls if needed
        let detectionControls = document.querySelector('.detection-video-controls');
        if (!detectionControls) {
            detectionControls = document.createElement('div');
            detectionControls.className = 'detection-video-controls';
            videoControls.appendChild(detectionControls);
        }
        
        // Add toggle detections button
        const toggleBtn = document.createElement('button');
        toggleBtn.id = 'toggleVideoDetectionsBtn';
        toggleBtn.className = 'btn btn-secondary detection-toggle-btn';
        toggleBtn.innerHTML = '<i class="fas fa-eye"></i> Show Detections';
        toggleBtn.onclick = function() {
            const isCurrentlyShown = this.classList.contains('active');
            console.log('Toggle button clicked, current state:', isCurrentlyShown);
            toggleVideoDetections(!isCurrentlyShown);
        };
        
        detectionControls.appendChild(toggleBtn);
        console.log('Toggle button added to video controls');
        
        // Add toggle labels button
        const toggleLabelsBtn = document.createElement('button');
        toggleLabelsBtn.id = 'toggleLabelsBtn';
        toggleLabelsBtn.className = 'btn btn-secondary detection-toggle-btn active';
        toggleLabelsBtn.innerHTML = '<i class="fas fa-tag"></i> Hide Labels';
        toggleLabelsBtn.style.display = 'none'; // Initially hidden until detections are shown
        toggleLabelsBtn.onclick = function() {
            const isCurrentlyShown = this.classList.contains('active');
            console.log('Toggle labels button clicked, current state:', isCurrentlyShown);
            toggleLabels(!isCurrentlyShown);
        };
        
        detectionControls.appendChild(toggleLabelsBtn);
        console.log('Toggle labels button added to detection controls');
    }
    
    // Update the overlay when the video time changes - use the throttled version
    videoPlayer.addEventListener('timeupdate', updateVideoDetectionOverlay);
    
    // Add a seeked event listener to force immediate update when the user seeks
    videoPlayer.addEventListener('seeked', forceImmediateOverlayUpdate);
    
    // Update the overlay when the video is resized - force immediate update
    window.addEventListener('resize', forceImmediateOverlayUpdate);
    
    // Update the overlay when the video metadata is loaded - force immediate update
    videoPlayer.addEventListener('loadedmetadata', forceImmediateOverlayUpdate);
    
    // Initial update - force immediate update
    forceImmediateOverlayUpdate();
}

/**
 * Forces an update of the detection overlay
 */
function forceUpdateDetectionOverlay() {
    console.log('Forcing update of detection overlay');
    const videoPlayer = elements.videoPlayer;
    
    if (!videoPlayer) {
        console.log('No video player found');
        return;
    }
    
    // Get the current time
    const currentTime = videoPlayer.currentTime;
    console.log('Current video time:', currentTime);
    
    // Try to load scenes if they're not available
    if (!window.scenes || window.scenes.length === 0) {
        console.log('No scenes available, attempting to load scenes');
        // Try to get the video ID from the URL
        const urlParams = new URLSearchParams(window.location.search);
        const videoId = urlParams.get('video');
        
        if (videoId) {
            console.log('Found video ID in URL:', videoId);
            fetch(`/scenes/${videoId}`)
                .then(response => response.json())
                .then(data => {
                    if (data.success && data.scenes) {
                        window.scenes = data.scenes;
                        console.log('Loaded scenes from API:', data.scenes.length);
                        // Now update the overlay immediately
                        forceImmediateOverlayUpdate();
                    }
                })
                .catch(error => {
                    console.error('Error loading scenes:', error);
                });
        }
    } else {
        // Update the overlay immediately
        forceImmediateOverlayUpdate();
    }
}

/**
 * Toggles the visibility of detection labels
 * @param {boolean} show - Whether to show or hide the labels
 */
export function toggleLabels(show) {
    console.log('toggleLabels called with show =', show);
    
    // Update the state
    labelsVisible = show;
    
    // Get all labels in the overlay
    const labels = document.querySelectorAll('.video-detection-label');
    
    // Show or hide all labels using the hidden class
    labels.forEach(label => {
        if (show) {
            label.classList.remove('hidden');
            label.style.display = 'block';
        } else {
            label.classList.add('hidden');
            label.style.display = 'none';
        }
    });
    
    // Update the toggle button state
    const toggleBtn = document.getElementById('toggleLabelsBtn');
    if (toggleBtn) {
        toggleBtn.classList.toggle('active', show);
        toggleBtn.innerHTML = show ? 
            '<i class="fas fa-tag"></i> Hide Labels' : 
            '<i class="fas fa-tag"></i> Show Labels';
    }
} 