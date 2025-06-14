// interactive-layer.js - Interactive layer functionality for manipulating video elements

import { elements } from './elements.js';
import { state } from './main.js';
import { findSceneAtTime } from './scenes.js';

// Store extracted elements
const extractedElements = [];
let activeElement = null;
let isLayerActive = false;
let lastSceneIndex = null; // Track the last scene index for scene change detection

// Add configuration for auto-extract types
const autoExtractConfig = {
    textElements: true,     // Whether to extract text elements (obj-text)
    unmatchedText: false,    // Whether to extract unmatched text
    otherElements: true      // Whether to extract other elements (non-text)
};

// Add configuration for UI elements
const uiConfig = {
    showElementControls: false,  // Whether to show delete and lock buttons on elements
    useTextMode: false           // Whether to show OCR elements as text instead of canvas
};

/**
 * Ensures video controls remain accessible
 */
function ensureVideoControlsAccessible() {
    // Find the video container and controls
    const videoContainer = document.querySelector('.video-wrapper');
    if (!videoContainer) return;
    
    // Check for standard video controls
    const videoControls = videoContainer.querySelector('.video-controls');
    if (videoControls) {
        // Set extremely high z-index to ensure controls are always on top
        videoControls.style.setProperty('z-index', '9999', 'important');
        videoControls.style.setProperty('position', 'relative', 'important');
        videoControls.style.setProperty('pointer-events', 'auto', 'important');
        
        // Make sure all child elements of video controls are also clickable
        const controlElements = videoControls.querySelectorAll('*');
        controlElements.forEach(element => {
            element.style.setProperty('pointer-events', 'auto', 'important');
            element.style.setProperty('z-index', '9999', 'important');
        });
    }
    
    // Check for any other control elements that might be present
    const allControls = videoContainer.querySelectorAll('button, input, .control, .progress-bar, .volume-control, .time-display, .fullscreen-btn');
    allControls.forEach(control => {
        if (control.closest('.interactive-layer-controls') === null) {
            // Only apply to controls that aren't part of our interactive layer
            control.style.setProperty('z-index', '9999', 'important');
            control.style.setProperty('position', 'relative', 'important');
            control.style.setProperty('pointer-events', 'auto', 'important');
        }
    });
    
    // Make sure the video player itself can receive clicks
    const videoPlayer = elements.videoPlayer;
    if (videoPlayer) {
        videoPlayer.style.setProperty('z-index', '10', 'important');
        videoPlayer.style.setProperty('pointer-events', 'auto', 'important');
    }
    
    // Ensure the interactive layer doesn't block video controls
    const interactiveLayer = document.getElementById('interactiveLayer');
    if (interactiveLayer) {
        // Set pointer-events to none for the parts of the layer that overlap with controls
        if (videoControls) {
            const controlsRect = videoControls.getBoundingClientRect();
            const layerRect = interactiveLayer.getBoundingClientRect();
            
            // If the controls are at the bottom of the video (common case)
            if (controlsRect.bottom >= layerRect.bottom - 10) {
                // Create or update a style element to add a non-interactive zone at the bottom
                let styleElement = document.getElementById('interactive-layer-styles');
                if (!styleElement) {
                    styleElement = document.createElement('style');
                    styleElement.id = 'interactive-layer-styles';
                    document.head.appendChild(styleElement);
                }
                
                // Calculate the height of the controls
                const controlsHeight = controlsRect.height;
                
                // Add CSS to create a non-interactive zone at the bottom of the interactive layer
                styleElement.textContent = `
                    #interactiveLayer::after {
                        content: '';
                        position: absolute;
                        bottom: 0;
                        left: 0;
                        width: 100%;
                        height: ${controlsHeight + 10}px;
                        pointer-events: none;
                        z-index: 9998;
                    }
                `;
            }
        }
    }
    
    // Add a periodic check to ensure controls remain accessible
    if (!window.controlsAccessibilityInterval) {
        window.controlsAccessibilityInterval = setInterval(() => {
            if (isLayerActive) {
                // Re-apply accessibility settings
                if (videoControls) {
                    videoControls.style.setProperty('z-index', '9999', 'important');
                    videoControls.style.setProperty('pointer-events', 'auto', 'important');
                }
            } else {
                // Clear the interval if the layer is no longer active
                clearInterval(window.controlsAccessibilityInterval);
                window.controlsAccessibilityInterval = null;
            }
        }, 1000);
    }
    
    console.log('Ensured video controls remain accessible');
}

/**
 * Initialize the interactive layer
 */
export function initInteractiveLayer() {
    console.log('Initializing interactive layer');
    
    // Initialize auto-extract config from state if available
    if (state && state.autoExtractConfig) {
        autoExtractConfig.textElements = state.autoExtractConfig.textElements !== undefined ? 
            state.autoExtractConfig.textElements : false;
        autoExtractConfig.unmatchedText = state.autoExtractConfig.unmatchedText !== undefined ? 
            state.autoExtractConfig.unmatchedText : false;
        autoExtractConfig.otherElements = state.autoExtractConfig.otherElements !== undefined ? 
            state.autoExtractConfig.otherElements : true;
    }
    
    // Initialize UI config from state if available
    if (state && state.uiConfig) {
        uiConfig.showElementControls = state.uiConfig.showElementControls !== undefined ?
            state.uiConfig.showElementControls : true;
        uiConfig.useTextMode = state.uiConfig.useTextMode !== undefined ?
            state.uiConfig.useTextMode : false;
    }
    
    // Initialize text mode from direct state property if available (for backward compatibility)
    if (state && state.useTextMode !== undefined) {
        uiConfig.useTextMode = state.useTextMode;
    }
    
    // Add CSS styles for the interactive layer
    addInteractiveLayerStyles();
    
    // Create the interactive layer container if it doesn't exist
    createInteractiveLayerContainer();
    
    // Add event listeners for the interactive layer controls
    setupInteractiveLayerControls();
    
    // Add event listener for video time updates to sync extracted elements
    elements.videoPlayer.addEventListener('timeupdate', syncExtractedElements);
    
    // Add a direct event listener to the video detection overlay
    setupVideoDetectionOverlayListener();
    
    // Ensure video controls are accessible
    ensureVideoControlsAccessible();
    
    // Apply element controls visibility
    updateElementControlsVisibility();
    
    // Start the animation loop for smooth canvas updates
    startCanvasAnimationLoop();
}

/**
 * Adds CSS styles for the interactive layer
 */
function addInteractiveLayerStyles() {
    // Check if styles already exist
    if (document.getElementById('interactive-layer-global-styles')) {
        // Add only the transcript-related styles if the main styles already exist
        const transcriptStyleElement = document.createElement('style');
        transcriptStyleElement.id = 'transcript-ocr-relation-styles';
        
        transcriptStyleElement.textContent = `
            /* Transcript-related element highlighting */
            .extracted-video-element.transcript-related {
                border-color: rgba(0, 255, 0, 0.9) !important;
                box-shadow: 0 0 20px rgba(0, 255, 0, 0.8) !important;
                animation: pulseHighlight 1.5s infinite alternate !important;
                z-index: 301 !important; /* Make it appear above other elements */
                background-color: rgba(0, 255, 0, 0.1) !important;
                transform: scale(1.05) !important;
                transition: all 0.3s ease !important;
            }
            
            /* Transcript line highlighting */
            .transcript-related {
                background-color: rgba(0, 255, 0, 0.1) !important;
                border-left: 3px solid rgba(0, 255, 0, 0.9) !important;
                box-shadow: 0 0 10px rgba(0, 255, 0, 0.3) !important;
                animation: pulseHighlightTranscript 1.5s infinite alternate !important;
            }
            
            /* OCR text content styles */
            .ocr-text-content {
                width: 100%;
                height: 100%;
                padding: 5px;
                overflow: auto;
                position: absolute;
                top: 0;
                left: 0;
                background-color: rgba(255, 255, 255, 0.9);
                color: #000;
                font-family: Arial, sans-serif;
                line-height: 1.4;
                cursor: text;
                transition: background-color 0.3s ease;
                border-radius: 2px;
                z-index: 50; /* Ensure it's above the canvas */
            }
            
            .ocr-text-content:focus {
                outline: none;
                background-color: rgba(255, 255, 255, 1);
                box-shadow: inset 0 0 3px rgba(0, 0, 0, 0.2);
            }
            
            /* OCR text class styling */
            .ocr-text-content.ocr-title {
                font-weight: bold;
                font-size: 1.2em;
            }
            
            .ocr-text-content.ocr-caption {
                font-style: italic;
                font-size: 0.9em;
            }
            
            .ocr-text-content.ocr-page-text {
                font-size: 1.0em;
            }
            
            @keyframes pulseHighlight {
                from { border-color: rgba(0, 255, 0, 0.8); box-shadow: 0 0 20px rgba(0, 255, 0, 0.5); }
                to { border-color: rgba(0, 255, 0, 1); box-shadow: 0 0 30px rgba(0, 255, 0, 0.9); }
            }
            
            @keyframes pulseHighlightTranscript {
                from { background-color: rgba(0, 255, 0, 0.05); border-left-color: rgba(0, 255, 0, 0.8); }
                to { background-color: rgba(0, 255, 0, 0.15); border-left-color: rgba(0, 255, 0, 1); }
            }
        `;
        
        document.head.appendChild(transcriptStyleElement);
        return;
    }
    
    // Create a style element
    const styleElement = document.createElement('style');
    styleElement.id = 'interactive-layer-global-styles';
    
    // Add CSS rules
    styleElement.textContent = `
        /* Interactive layer container */
        .interactive-layer {
            position: fixed !important; /* Changed from absolute to fixed */
            top: 0 !important;
            left: 0 !important;
            width: 100vw !important; /* Changed from 100% to 100vw */
            height: 100vh !important; /* Changed from 100% to 100vh */
            pointer-events: none; /* Allow clicks to pass through by default */
            z-index: 9000 !important; /* Increased z-index to be above everything */
        }
        
        /* Interactive layer content area (where elements can be dragged) */
        .interactive-content-area {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
        }
        
        /* Tab area container */
        .tab-area-container {
            display: flex;
            justify-content: space-between;
            align-items: center;
            width: 100%;
            margin-bottom: 10px;
        }
        
        /* Video tabs */
        .video-tabs {
            margin-bottom: 10px;
        }
        
        /* Tab buttons */
        .video-tab-buttons {
            display: flex;
            gap: 5px;
        }
        
        /* Controls panel */
        .interactive-layer-controls {
            display: flex;
            align-items: flex-start;
            z-index: 9000;
            margin-left: 15px;
            pointer-events: auto;
            position: relative;
        }
        
        /* Toggle button for controls */
        .controls-toggle-btn {
            width: 36px;
            height: 36px;
            border-radius: 50%;
            background: var(--primary-color);
            color: white;
            border: 2px solid white;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 16px;
            box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
            transition: all 0.3s ease;
            z-index: 9001;
        }

        .controls-toggle-btn:hover {
            background: var(--primary-dark);
            transform: scale(1.1);
        }

        .controls-toggle-btn.active {
            background: var(--accent-color);
            transform: rotate(180deg);
        }
        
        /* Expanded controls */
        .layer-controls-expanded {
            position: absolute;
            top: 0;
            right: 45px;
            display: flex;
            gap: 8px;
            align-items: center;
            padding: 8px 16px;
            background-color: white;
            border: 2px solid var(--primary-color);
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
            opacity: 0;
            visibility: hidden;
            transform: translateX(20px);
            transition: all 0.3s ease;
        }

        .layer-controls-expanded.visible {
            opacity: 1;
            visibility: visible;
            transform: translateX(0);
        }
        
        /* Make buttons in the controls more compact */
        .layer-controls-expanded button {
            padding: 6px 12px;
            font-size: 0.9em;
            white-space: nowrap;
        }
        
        /* Make toggle container more compact */
        .layer-controls-expanded .toggle-container {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 0.9em;
            white-space: nowrap;
            margin-left: 5px;
        }
        
        /* Extracted elements */
        .extracted-video-element {
            border: 2px solid rgba(0, 255, 0, 0.7);
            position: absolute;
            overflow: hidden;
            z-index: 200;
            pointer-events: auto; /* Make extracted elements clickable */
            transition: transform 0.3s ease, z-index 0s;
            transform-origin: center;
        }
        
        /* Hover effect for extracted elements */
        .extracted-video-element:hover {
            transform: scale(1.5);
            tranform: translateZ(0);
            z-index: 300 !important;
            box-shadow: 0 0 20px rgba(0, 0, 0, 0.3);
        }
        
        /* When element is being dragged or resized, disable hover effect */
        .extracted-video-element.active-drag:hover,
        .extracted-video-element.active-resize:hover {
            transform: none;
        }
        
        /* Transcript-related element highlighting */
        .extracted-video-element.transcript-related {
            border-color: rgba(0, 255, 0, 0.9) !important;
            box-shadow: 0 0 20px rgba(0, 255, 0, 0.8) !important;
            animation: pulseHighlight 1.5s infinite alternate !important;
            z-index: 301 !important; /* Make it appear above other elements */
            background-color: rgba(0, 255, 0, 0.1) !important;
            transform: scale(1.05) !important;
            transition: all 0.3s ease !important;
        }
        
        @keyframes pulseHighlight {
            from { border-color: rgba(0, 255, 0, 0.8); box-shadow: 0 0 20px rgba(0, 255, 0, 0.5); }
            to { border-color: rgba(0, 255, 0, 1); box-shadow: 0 0 30px rgba(0, 255, 0, 0.9); }
        }
        
        /* Element controls */
        .element-controls {
            position: absolute;
            top: 5px;
            right: 5px;
            display: flex;
            gap: 5px;
            z-index: 300;
            pointer-events: auto; /* Make element controls clickable */
        }
        
        /* Resize handles */
        .resize-handle {
            position: absolute;
            width: 10px;
            height: 10px;
            background-color: rgba(0, 255, 0, 0.7);
            border: 1px solid white;
            z-index: 250;
            pointer-events: auto;
        }
        
        .nw-handle {
            top: -5px;
            left: -5px;
            cursor: nw-resize;
        }
        
        .ne-handle {
            top: -5px;
            right: -5px;
            cursor: ne-resize;
        }
        
        .sw-handle {
            bottom: -5px;
            left: -5px;
            cursor: sw-resize;
        }
        
        .se-handle {
            bottom: -5px;
            right: -5px;
            cursor: se-resize;
        }
        
        /* Video controls - ensure they're always on top */
        .video-controls, 
        .video-controls * {
            z-index: 9999 !important;
            position: relative !important;
            pointer-events: auto !important;
        }
        
        /* Create a safe area at the bottom of the video for controls */
        .interactive-layer::after {
            content: '';
            position: absolute;
            bottom: 0;
            left: 0;
            width: 100%;
            height: 50px; /* Default height, will be adjusted dynamically */
            pointer-events: none;
        }
        
        /* Non-interactive area for video controls */
        .non-interactive-area {
            position: absolute;
            bottom: 0;
            left: 0;
            width: 100%;
            pointer-events: none !important;
            background: transparent;
        }
        
        /* Video detection overlay adjustments */
        .video-detection-overlay {
            z-index: 100;
            pointer-events: none; /* By default, let clicks pass through */
        }
        
        /* Only make detection boxes clickable when in selection mode */
        .video-detection-overlay.selection-mode {
            pointer-events: auto;
        }
        
        /* Make detection boxes clickable */
        .video-detection-box.selectable {
            pointer-events: auto !important;
            cursor: pointer !important;
        }
        
        /* Make sure video player can receive clicks */
        video {
            z-index: 10 !important;
            pointer-events: auto !important;
        }
        
        /* Highlight the extract all button when auto-extract is enabled */
        #extractAllBtn.auto-active {
            background-color: #28a745;
            color: white;
        }
    `;
    
    // Add the styles to the head
    document.head.appendChild(styleElement);
    
    // Add styles for transcript highlighting toggle
    const toggleStyles = document.createElement('style');
    toggleStyles.id = 'transcript-highlight-toggle-styles';
    toggleStyles.textContent = `
        .toggle-container {
            display: flex;
            align-items: center;
            gap: 8px;
            margin: 8px;
            // color: white;
        }
        
        .toggle-switch {
            position: relative;
            display: inline-block;
            width: 40px;
            height: 20px;
        }
        
        .toggle-switch input {
            opacity: 0;
            width: 0;
            height: 0;
        }
        
        .toggle-slider {
            position: absolute;
            cursor: pointer;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background-color: #ccc;
            transition: .4s;
            border-radius: 20px;
        }
        
        .toggle-slider:before {
            position: absolute;
            content: "";
            height: 16px;
            width: 16px;
            left: 2px;
            bottom: 2px;
            background-color: white;
            transition: .4s;
            border-radius: 50%;
        }
        
        input:checked + .toggle-slider {
            background-color: #2196F3;
        }
        
        input:checked + .toggle-slider:before {
            transform: translateX(20px);
        }
    `;
    document.head.appendChild(toggleStyles);
}

/**
 * Starts the animation loop for smooth canvas updates
 */
function startCanvasAnimationLoop() {
    // Store the animation frame ID so we can cancel it if needed
    let animationFrameId = null;
    
    // Function to update all canvas elements
    function updateCanvases() {
        const videoPlayer = elements.videoPlayer;
        if (!videoPlayer) return;
        
        // Only update canvases if the interactive layer is active
        if (isLayerActive) {
            // Update each extracted element with a canvas
            extractedElements.forEach(elementInfo => {
                if (elementInfo.isCanvasView) {
                    const elementContainer = document.getElementById(elementInfo.id);
                    if (!elementContainer || elementContainer.style.display === 'none') return;
                    
                    const canvas = elementContainer.querySelector('.video-canvas');
                    if (canvas) {
                        // Get the source coordinates from the element info
                        const { x, y, width, height } = elementInfo.sourceCoords;
                        
                        // Draw the current video frame to the canvas
                        drawVideoToCanvas(canvas, videoPlayer, x, y, width, height);
                    }
                }
            });
        }
        
        // Request the next animation frame
        animationFrameId = requestAnimationFrame(updateCanvases);
    }
    
    // Start the animation loop
    animationFrameId = requestAnimationFrame(updateCanvases);
    
    // Store the animation frame ID in the window object so we can cancel it if needed
    window.canvasAnimationFrameId = animationFrameId;
}

/**
 * Creates the interactive layer container
 */
function createInteractiveLayerContainer() {
    const videoContainer = document.querySelector('.video-wrapper');
    
    // Check if container already exists
    if (document.getElementById('interactiveLayer')) {
        return;
    }
    
    // Create a tab container if it doesn't exist
    let tabContainer = document.querySelector('.video-tabs');
    if (!tabContainer) {
        tabContainer = document.createElement('div');
        tabContainer.className = 'video-tabs';
        
        // Create tab buttons
        const tabButtons = document.createElement('div');
        tabButtons.className = 'video-tab-buttons';
        
        // Normal video tab button
        const normalTabBtn = document.createElement('button');
        normalTabBtn.className = 'video-tab-btn active';
        normalTabBtn.id = 'normalVideoTab';
        normalTabBtn.innerHTML = '<i class="fas fa-video"></i> Normal Video';
        
        // Interactive layer tab button
        const interactiveTabBtn = document.createElement('button');
        interactiveTabBtn.className = 'video-tab-btn';
        interactiveTabBtn.id = 'interactiveVideoTab';
        interactiveTabBtn.innerHTML = '<i class="fas fa-layer-group"></i> Interactive Layer';
        
        // Add buttons to tab buttons container
        tabButtons.appendChild(normalTabBtn);
        tabButtons.appendChild(interactiveTabBtn);
        
        // Add tab buttons to tab container
        tabContainer.appendChild(tabButtons);
        
        // Insert tab container before the video container
        videoContainer.parentNode.insertBefore(tabContainer, videoContainer);
        
        // Set up tab switching
        normalTabBtn.addEventListener('click', () => {
            switchToNormalTab();
        });
        
        interactiveTabBtn.addEventListener('click', () => {
            switchToInteractiveTab();
        });
    }
    
    // Create the interactive layer container
    const layerContainer = document.createElement('div');
    layerContainer.id = 'interactiveLayer';
    layerContainer.className = 'interactive-layer';
    
    // Create the content area that will contain draggable elements
    const contentArea = document.createElement('div');
    contentArea.className = 'interactive-content-area';
    layerContainer.appendChild(contentArea);
    
    // Create the controls panel - Position it next to the tab buttons
    const controlsPanel = document.createElement('div');
    controlsPanel.className = 'interactive-layer-controls';
    
    // Add a toggle button for the controls
    const toggleControlsBtn = document.createElement('button');
    toggleControlsBtn.className = 'controls-toggle-btn';
    toggleControlsBtn.innerHTML = '<i class="fas fa-cog"></i>';
    toggleControlsBtn.title = 'Toggle Controls';
    controlsPanel.appendChild(toggleControlsBtn);

    // Create the expanded controls container
    const expandedControls = document.createElement('div');
    expandedControls.id = 'layerControlsExpanded';
    expandedControls.className = 'layer-controls-expanded';
    expandedControls.innerHTML = `
            <button id="extractElementBtn" class="btn btn-secondary">
                <i class="fas fa-cut"></i> Extract Element
            </button>
            <button id="extractAllBtn" class="btn btn-secondary">
                <i class="fas fa-object-group"></i> Extract All
            </button>
            <button id="autoExtractConfigBtn" class="btn btn-secondary">
                <i class="fas fa-cog"></i> Config
            </button>
            <button id="clearElementsBtn" class="btn btn-danger">
                <i class="fas fa-trash"></i> Clear All
            </button>
            <div class="toggle-container">
                <label class="toggle-switch">
                    <input type="checkbox" id="showBoundingBoxes">
                    <span class="toggle-slider"></span>
                </label>
                <span>Show Boxes</span>
            </div>
            <div class="toggle-container">
                <label class="toggle-switch">
                    <input type="checkbox" id="autoExtractElements" checked>
                    <span class="toggle-slider"></span>
                </label>
                <span>Auto-Extract</span>
        </div>
    `;
    controlsPanel.appendChild(expandedControls);

    // Add click handler for toggle button
    toggleControlsBtn.addEventListener('click', () => {
        expandedControls.classList.toggle('visible');
        toggleControlsBtn.classList.toggle('active');
    });
    
    // Find the tab buttons container to place our controls next to it
    const tabButtons = tabContainer.querySelector('.video-tab-buttons');
    
    if (tabButtons) {
        // Create a container for the tab area that will hold both tab buttons and controls
        const tabAreaContainer = document.createElement('div');
        tabAreaContainer.className = 'tab-area-container';
        
        // Move the tab buttons to the new container
        tabContainer.removeChild(tabButtons);
        tabAreaContainer.appendChild(tabButtons);
        
        // Add the controls panel to the tab area container
        tabAreaContainer.appendChild(controlsPanel);
        
        // Add the tab area container to the tab container
        tabContainer.appendChild(tabAreaContainer);
    } else {
        // If no tab buttons exist, just add the controls to the tab container
        tabContainer.appendChild(controlsPanel);
    }
    
    // Add the layer container to document body to make it cover the entire viewport
    document.body.appendChild(layerContainer);
    
    // Initially hide the layer
    layerContainer.style.display = 'none';
    controlsPanel.style.display = 'none';
    
    // Ensure video controls are accessible
    ensureVideoControlsAccessible();
}

/**
 * Switches to the normal video tab
 */
function switchToNormalTab() {
    // Update tab buttons
    const normalTabBtn = document.getElementById('normalVideoTab');
    const interactiveTabBtn = document.getElementById('interactiveVideoTab');
    
    if (normalTabBtn) normalTabBtn.classList.add('active');
    if (interactiveTabBtn) interactiveTabBtn.classList.remove('active');
    
    // Deactivate interactive layer if it's active
    if (isLayerActive) {
        toggleInteractiveLayer();
        console.log('Toggled interactive layer off');
    } else {
        console.log('Already inactive');
        // If already inactive, ensure masks are hidden but not removed
        const maskContainer = document.getElementById('videoMaskContainer');
        if (maskContainer) {
            maskContainer.style.display = 'none';
        }
        
        // Hide extracted elements
        extractedElements.forEach(elementInfo => {
            const element = document.getElementById(elementInfo.id);
            if (element) {
                element.style.display = 'none';
            }
        });
    }
    
    // Show notification
    showNotification('Switched to normal video mode', 'info');
}

/**
 * Switches to the interactive layer tab
 */
function switchToInteractiveTab() {
    // Update tab buttons
    const normalTabBtn = document.getElementById('normalVideoTab');
    const interactiveTabBtn = document.getElementById('interactiveVideoTab');
    
    if (normalTabBtn) normalTabBtn.classList.remove('active');
    if (interactiveTabBtn) interactiveTabBtn.classList.add('active');
    
    // Activate interactive layer if it's not active
    if (!isLayerActive) {
        toggleInteractiveLayer();
    } else {
        // If already active, ensure masks are updated for the current scene
        const videoPlayer = elements.videoPlayer;
        if (videoPlayer) {
            const currentTime = videoPlayer.currentTime;
            const currentScene = findSceneAtTime(currentTime);
            
            if (currentScene) {
                // Show the mask container
                const maskContainer = document.getElementById('videoMaskContainer');
                if (maskContainer) {
                    maskContainer.style.display = 'block';
                    
                    // Update masks for the current scene
                    updateMasksForCurrentScene(currentScene.index);
                }
                
                // Show extracted elements for the current scene
                const sceneElements = extractedElements.filter(el => el.sceneIndex === currentScene.index);
                sceneElements.forEach(elementInfo => {
                    const element = document.getElementById(elementInfo.id);
                    if (element) {
                        element.style.display = 'block';
                    }
                });
            }
        }
    }
    
    // Show notification
    showNotification('Switched to interactive layer mode', 'info');
}

/**
 * Sets up event listeners for the interactive layer controls
 */
function setupInteractiveLayerControls() {
    console.log('Setting up interactive layer controls');
    // Extract element button
    const extractBtn = document.getElementById('extractElementBtn');
    if (extractBtn) {
        extractBtn.addEventListener('click', showElementSelectionUI);
    }
    
    // Extract all elements button
    const extractAllBtn = document.getElementById('extractAllBtn');
    if (extractAllBtn) {
        extractAllBtn.addEventListener('click', extractAllElements);
    }
    
    // Clear all elements button
    const clearBtn = document.getElementById('clearElementsBtn');
    if (clearBtn) {
        clearBtn.addEventListener('click', clearAllElements);
    }
    
    // Toggle bounding boxes
    const boxesToggle = document.getElementById('showBoundingBoxes');
    if (boxesToggle) {
        boxesToggle.addEventListener('change', toggleBoundingBoxes);
    }
    
    // Toggle auto-extract
    const autoExtractToggle = document.getElementById('autoExtractElements');
    if (autoExtractToggle) {
        // Initialize from state if available
        if (state.autoExtractElements !== undefined) {
            autoExtractToggle.checked = state.autoExtractElements;
        }
        
        // Update the extract all button style initially
        updateExtractAllButtonStyle(autoExtractToggle.checked);
        
        autoExtractToggle.addEventListener('change', function() {
            // Store the preference in state
            state.autoExtractElements = this.checked;
            
            // Update the extract all button style
            updateExtractAllButtonStyle(this.checked);
            
            // Show notification
            showNotification(
                this.checked ? 'Auto-extraction enabled. All detected elements will be extracted automatically.' : 'Auto-extraction disabled.',
                'info'
            );
        });
    }
    
    // Add auto-extract config button
    const autoExtractConfigBtn = document.getElementById('autoExtractConfigBtn');
    if (autoExtractConfigBtn) {
        autoExtractConfigBtn.addEventListener('click', showAutoExtractConfig);
    }
    
    // Add toggle for transcript highlighting
    const transcriptHighlightToggle = document.createElement('div');
    transcriptHighlightToggle.className = 'toggle-container';
    transcriptHighlightToggle.innerHTML = `
        <label class="toggle-switch">
            <input type="checkbox" id="transcriptHighlightToggle" ${state.showTranscriptHighlighting ? 'checked' : ''}>
            <span class="toggle-slider"></span>
        </label>
        <span>Highlight OCR</span>
    `;
    
    // Add event listener for the toggle
    const toggleInput = transcriptHighlightToggle.querySelector('#transcriptHighlightToggle');
    toggleInput.addEventListener('change', (e) => {
        state.showTranscriptHighlighting = e.target.checked;
        if (!e.target.checked) {
            // Remove all highlights when toggled off
            document.querySelectorAll('.extracted-video-element.transcript-related').forEach(element => {
                element.classList.remove('transcript-related');
            });
        }
    });
    console.log('Transcript highlight toggle added');
    
    // Add toggle for text mode
    const textModeToggle = document.createElement('div');
    textModeToggle.className = 'toggle-container';
    textModeToggle.innerHTML = `
        <label class="toggle-switch">
            <input type="checkbox" id="textModeToggle" ${uiConfig.useTextMode ? 'checked' : ''}>
            <span class="toggle-slider"></span>
        </label>
        <span>Text Mode</span>
    `;
    
    // Add event listener for the text mode toggle
    const textModeInput = textModeToggle.querySelector('#textModeToggle');
    textModeInput.addEventListener('change', (e) => {
        uiConfig.useTextMode = e.target.checked;
        // Store the setting in state if available
        if (state) {
            state.useTextMode = e.target.checked;
        }
        
        // Apply the change to all existing OCR elements
        toggleOcrTextMode(e.target.checked);
        
        // Show notification
        showNotification(
            e.target.checked ? 'Text mode enabled. OCR elements will display as editable text.' : 'Text mode disabled. OCR elements will display as video content.',
            'info'
        );
    });
    console.log('Text mode toggle added');
    
    // Add the toggles to the controls
    const controlsContainer = document.querySelector('.layer-controls-expanded');
    if (controlsContainer) {
        // Check if toggles already exist to prevent duplicates
        if (!controlsContainer.querySelector('#transcriptHighlightToggle')) {
            controlsContainer.appendChild(transcriptHighlightToggle);
        }
        if (!controlsContainer.querySelector('#textModeToggle')) {
            controlsContainer.appendChild(textModeToggle);
        }
    }
}

/**
 * Toggles OCR elements between canvas view and text view
 * @param {boolean} useTextMode - Whether to use text mode
 */
function toggleOcrTextMode(useTextMode) {
    // Update all extracted elements that have OCR text
    extractedElements.forEach(elementInfo => {
        if (elementInfo.ocrResult && elementInfo.ocrResult.text) {
            const element = document.getElementById(elementInfo.id);
            if (!element) return;
            
            // Toggle between canvas and text view
            if (useTextMode) {
                // Switch to text view
                convertElementToTextMode(element, elementInfo);
            } else {
                // Switch to canvas view
                convertElementToCanvasMode(element, elementInfo);
            }
        }
    });
}

/**
 * Converts an element to text mode
 * @param {HTMLElement} element - The element container
 * @param {Object} elementInfo - The element information
 */
function convertElementToTextMode(element, elementInfo) {
    // Check if already in text mode
    if (element.querySelector('.ocr-text-content')) return;
    
    // Completely hide the canvas (ensuring it doesn't show through)
    const canvas = element.querySelector('.video-canvas');
    if (canvas) {
        canvas.style.display = 'none';
        canvas.style.visibility = 'hidden';
        canvas.style.opacity = '0';
    }
    
    // Add a white background to completely cover any image
    element.style.backgroundColor = 'rgb(255, 255, 255)';
    
    // Create text content element
    const textContent = document.createElement('div');
    textContent.className = 'ocr-text-content';
    textContent.contentEditable = true;
    textContent.spellcheck = false;
    textContent.textContent = elementInfo.ocrResult.text;
    
    // Add language support attributes for better editing experience
    textContent.setAttribute('lang', 'auto'); // Auto-detect language
    textContent.setAttribute('translate', 'yes'); // Allow browser translation
    textContent.setAttribute('dir', 'auto'); // Auto-detect text direction for RTL languages
    
    // Add data attribute to store original text for auto-sizing
    textContent.dataset.originalText = elementInfo.ocrResult.text;
    
    // Initial font size based on element size (responsive)
    const initialFontSize = calculateOptimalFontSize(element, elementInfo.ocrResult.text);
    textContent.style.fontSize = `${initialFontSize}px`;
    
    // // Apply styles based on OCR class if available
    // if (elementInfo.ocrResult.ocr_class) {
    //     const ocrClass = elementInfo.ocrResult.ocr_class.toLowerCase();
    //     textContent.classList.add(`ocr-${ocrClass}`);
        
    //     // Apply specific styling based on class
    //     switch (ocrClass) {
    //         case 'title':
    //             textContent.style.fontWeight = 'bold';
    //             break;
    //         case 'caption':
    //             textContent.style.fontStyle = 'italic';
    //             break;
    //         case 'page-text':
    //             // Standard styling for regular text
    //             break;
    //         case 'math':
    //             textContent.style.fontFamily = 'serif';
    //             // Add MathJax support if available
    //             if (window.MathJax) {
    //                 setTimeout(() => {
    //                     try {
    //                         window.MathJax.typeset([textContent]);
    //                     } catch (e) {
    //                         console.warn('Error typesetting math:', e);
    //                     }
    //                 }, 100);
    //             }
    //             break;
    //         case 'code':
    //             textContent.style.fontFamily = 'monospace';
    //             textContent.style.whiteSpace = 'pre';
    //             break;
    //     }
    // }
    
    // Add toolbar for text formatting
    const toolbar = document.createElement('div');
    toolbar.className = 'ocr-text-toolbar';
    toolbar.innerHTML = `
        <button title="Increase Font Size">A+</button>
        <button title="Decrease Font Size">A-</button>
        <button title="Bold" style="font-weight:bold">B</button>
        <button title="Italic" style="font-style:italic">I</button>
        <button title="Auto-fit Text" style="font-size:0.8em">Auto</button>
        <button title="Copy Text"><i class="fas fa-copy"></i></button>
    `;
    
    // Style the toolbar
    toolbar.style.display = 'none'; // Initially hidden, show on hover
    toolbar.style.position = 'absolute';
    toolbar.style.top = '0';
    toolbar.style.right = '0';
    toolbar.style.background = 'rgba(255,255,255,0.9)';
    toolbar.style.borderRadius = '3px';
    toolbar.style.padding = '2px';
    toolbar.style.zIndex = '350';
    toolbar.style.boxShadow = '0 0 3px rgba(0,0,0,0.2)';
    
    // Add event listeners for toolbar buttons
    toolbar.querySelectorAll('button').forEach(button => {
        button.style.padding = '2px 5px';
        button.style.margin = '0 2px';
        button.style.background = 'none';
        button.style.border = '1px solid #ccc';
        button.style.borderRadius = '2px';
        button.style.cursor = 'pointer';
        
        button.addEventListener('click', e => {
            e.stopPropagation();
            const title = button.getAttribute('title');
            
            switch (title) {
                case 'Increase Font Size':
                    // Get current font size and increase it
                    const currentSize = parseFloat(window.getComputedStyle(textContent).fontSize);
                    textContent.style.fontSize = `${currentSize + 1}px`;
                    break;
                case 'Decrease Font Size':
                    // Get current font size and decrease it
                    const currentFontSize = parseFloat(window.getComputedStyle(textContent).fontSize);
                    textContent.style.fontSize = `${Math.max(8, currentFontSize - 1)}px`;
                    break;
                case 'Bold':
                    // Toggle bold
                    if (textContent.style.fontWeight === 'bold') {
                        textContent.style.fontWeight = 'normal';
                    } else {
                        textContent.style.fontWeight = 'bold';
                    }
                    break;
                case 'Italic':
                    // Toggle italic
                    if (textContent.style.fontStyle === 'italic') {
                        textContent.style.fontStyle = 'normal';
                    } else {
                        textContent.style.fontStyle = 'italic';
                    }
                    break;
                case 'Auto-fit Text':
                    // Auto-fit text to the container
                    const optimalSize = calculateOptimalFontSize(element, textContent.textContent);
                    textContent.style.fontSize = `${optimalSize}px`;
                    break;
                case 'Copy Text':
                    // Copy text to clipboard
                    navigator.clipboard.writeText(textContent.textContent)
                        .then(() => showNotification('Text copied to clipboard', 'success'))
                        .catch(err => {
                            console.error('Error copying text: ', err);
                            showNotification('Failed to copy text', 'error');
                        });
                    break;
            }
        });
    });
    
    // Show toolbar on hover
    element.addEventListener('mouseenter', () => {
        toolbar.style.display = 'flex';
    });
    
    element.addEventListener('mouseleave', () => {
        toolbar.style.display = 'none';
    });
    
    // Add event listener to store changes
    textContent.addEventListener('input', () => {
        elementInfo.ocrResult.text = textContent.textContent;
        console.log(`Updated OCR text to: ${textContent.textContent}`);
    });
    
    // Add the text content and toolbar to the element
    element.appendChild(textContent);
    element.appendChild(toolbar);
    
    // Set up resize observer to adjust font size when element is resized
    const resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
            if (entry.target === element) {
                // Calculate new font size
                const optimalSize = calculateOptimalFontSize(element, textContent.textContent);
                textContent.style.fontSize = `${optimalSize}px`;
            }
        }
    });
    
    // Start observing the element
    resizeObserver.observe(element);
    
    // Store the resize observer in the element info for cleanup
    elementInfo.textResizeObserver = resizeObserver;
    
    // Update element info
    elementInfo.isTextMode = true;
}

/**
 * Calculates the optimal font size to fit text within a container
 * @param {HTMLElement} container - The container element
 * @param {string} text - The text to fit
 * @returns {number} - The optimal font size in pixels
 */
function calculateOptimalFontSize(container, text) {
    // Get container dimensions
    const containerWidth = container.offsetWidth - 10; // Subtract padding
    const containerHeight = container.offsetHeight - 10; // Subtract padding
    
    // Estimate character count per line (rough approximation)
    const avgCharWidth = 0.6; // Average character width in em units
    const lineHeight = 1.4; // Line height multiplier
    
    // Create a temporary element to measure text
    const testElement = document.createElement('div');
    testElement.style.visibility = 'hidden';
    testElement.style.position = 'absolute';
    testElement.style.width = `${containerWidth}px`;
    testElement.style.fontFamily = 'Arial, sans-serif';
    testElement.style.lineHeight = lineHeight.toString();
    testElement.textContent = text;
    document.body.appendChild(testElement);
    
    // Start with a reasonable size
    let fontSize = 16;
    
    // Use binary search to find optimal font size
    let minSize = 8;
    let maxSize = 48;
    let iterations = 0;
    const maxIterations = 10; // Prevent infinite loops
    
    while (minSize <= maxSize && iterations < maxIterations) {
        fontSize = Math.floor((minSize + maxSize) / 2);
        testElement.style.fontSize = `${fontSize}px`;
        
        if (testElement.scrollHeight > containerHeight || testElement.scrollWidth > containerWidth) {
            // Text is too big, decrease max size
            maxSize = fontSize - 1;
        } else {
            // Text fits, try a larger size
            minSize = fontSize + 1;
        }
        
        iterations++;
    }
    
    // Clean up
    document.body.removeChild(testElement);
    
    // Return the largest size that fits
    return Math.max(8, fontSize - 1); // Ensure minimum font size of 8px
}

/**
 * Converts an element back to canvas mode
 * @param {HTMLElement} element - The element container
 * @param {Object} elementInfo - The element information
 */
function convertElementToCanvasMode(element, elementInfo) {
    // Remove text content if it exists
    const textContent = element.querySelector('.ocr-text-content');
    if (textContent) {
        element.removeChild(textContent);
    }
    
    // Remove toolbar if it exists
    const toolbar = element.querySelector('.ocr-text-toolbar');
    if (toolbar) {
        element.removeChild(toolbar);
    }
    
    // Remove any other text-mode related elements
    element.querySelectorAll('.text-mode-element').forEach(el => {
        element.removeChild(el);
    });
    
    // Show the canvas and restore all visibility properties
    const canvas = element.querySelector('.video-canvas');
    if (canvas) {
        canvas.style.display = 'block';
        canvas.style.visibility = 'visible';
        canvas.style.opacity = '1';
    }
    
    // Remove the white background
    element.style.removeProperty('background-color');
    
    // Stop the resize observer if it exists
    if (elementInfo.textResizeObserver) {
        elementInfo.textResizeObserver.disconnect();
        delete elementInfo.textResizeObserver;
    }
    
    // Update element info
    elementInfo.isTextMode = false;
}

/**
 * Shows the auto-extract configuration dialog
 */
function showAutoExtractConfig() {
    // Check if dialog already exists
    let configDialog = document.getElementById('autoExtractConfigDialog');
    
    if (!configDialog) {
        // Create the dialog
        configDialog = document.createElement('div');
        configDialog.id = 'autoExtractConfigDialog';
        configDialog.className = 'config-dialog';
        configDialog.innerHTML = `
            <div class="config-dialog-content">
                <h3>Auto-Extract Configuration</h3>
                <p>Select which types of elements to auto-extract:</p>
                
                <div class="config-option">
                    <label class="toggle-switch">
                        <input type="checkbox" id="extractTextElements" ${autoExtractConfig.textElements ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                    </label>
                    <span>Text Elements (obj-text)</span>
                </div>
                
                <div class="config-option">
                    <label class="toggle-switch">
                        <input type="checkbox" id="extractUnmatchedText" ${autoExtractConfig.unmatchedText ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                    </label>
                    <span>Unmatched Text</span>
                </div>
                
                <div class="config-option">
                    <label class="toggle-switch">
                        <input type="checkbox" id="extractOtherElements" ${autoExtractConfig.otherElements ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                    </label>
                    <span>Other Elements</span>
                </div>
                
                <h3>UI Configuration</h3>
                <div class="config-option">
                    <label class="toggle-switch">
                        <input type="checkbox" id="showElementControls" ${uiConfig.showElementControls ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                    </label>
                    <span>Show Element Controls (Delete/Lock)</span>
                </div>
                
                <div class="config-option">
                    <label class="toggle-switch">
                        <input type="checkbox" id="useTextMode" ${uiConfig.useTextMode ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                    </label>
                    <span>Text Mode (Show OCR as editable text)</span>
                </div>
                
                <div class="config-buttons">
                    <button id="saveConfigBtn" class="btn btn-primary">Save</button>
                    <button id="cancelConfigBtn" class="btn btn-secondary">Cancel</button>
                </div>
            </div>
        `;
        
        // Add styles for the dialog
        const styleElement = document.createElement('style');
        styleElement.textContent = `
            .config-dialog {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background-color: rgba(0, 0, 0, 0.5);
                display: flex;
                justify-content: center;
                align-items: center;
                z-index: 9999;
            }
            
            .config-dialog-content {
                background-color: white;
                padding: 20px;
                border-radius: 5px;
                box-shadow: 0 0 10px rgba(0, 0, 0, 0.3);
                max-width: 400px;
                width: 100%;
            }
            
            .config-option {
                display: flex;
                align-items: center;
                margin-bottom: 10px;
            }
            
            .config-option span {
                margin-left: 10px;
            }
            
            .config-buttons {
                display: flex;
                justify-content: flex-end;
                margin-top: 20px;
                gap: 10px;
            }
        `;
        
        document.head.appendChild(styleElement);
        document.body.appendChild(configDialog);
        
        // Add event listeners
        const saveBtn = configDialog.querySelector('#saveConfigBtn');
        const cancelBtn = configDialog.querySelector('#cancelConfigBtn');
        
        saveBtn.addEventListener('click', () => {
            // Save the configuration
            autoExtractConfig.textElements = configDialog.querySelector('#extractTextElements').checked;
            autoExtractConfig.unmatchedText = configDialog.querySelector('#extractUnmatchedText').checked;
            autoExtractConfig.otherElements = configDialog.querySelector('#extractOtherElements').checked;
            
            // Save UI configuration
            const showControlsOld = uiConfig.showElementControls;
            uiConfig.showElementControls = configDialog.querySelector('#showElementControls').checked;
            
            // Save text mode configuration
            const textModeOld = uiConfig.useTextMode;
            uiConfig.useTextMode = configDialog.querySelector('#useTextMode').checked;
            
            // Update existing elements if the show controls setting changed
            if (showControlsOld !== uiConfig.showElementControls) {
                updateElementControlsVisibility();
            }
            
            // Update existing elements if the text mode setting changed
            if (textModeOld !== uiConfig.useTextMode) {
                toggleOcrTextMode(uiConfig.useTextMode);
                
                // Also update the text mode toggle button
                const textModeToggle = document.getElementById('textModeToggle');
                if (textModeToggle) {
                    textModeToggle.checked = uiConfig.useTextMode;
                }
            }
            
            // Store in state if available
            if (state) {
                state.autoExtractConfig = { ...autoExtractConfig };
                state.uiConfig = { ...uiConfig };
            }
            
            // Close the dialog
            configDialog.remove();
            
            // Show notification
            showNotification('Configuration saved', 'success');
        });
        
        cancelBtn.addEventListener('click', () => {
            // Close the dialog without saving
            configDialog.remove();
        });
    } else {
        // Update the existing dialog with current values
        configDialog.querySelector('#extractTextElements').checked = autoExtractConfig.textElements;
        configDialog.querySelector('#extractUnmatchedText').checked = autoExtractConfig.unmatchedText;
        configDialog.querySelector('#extractOtherElements').checked = autoExtractConfig.otherElements;
        configDialog.querySelector('#showElementControls').checked = uiConfig.showElementControls;
        configDialog.querySelector('#useTextMode').checked = uiConfig.useTextMode;
    }
}

/**
 * Updates the visibility of element controls for all extracted elements
 */
function updateElementControlsVisibility() {
    // Get all element controls
    const allControls = document.querySelectorAll('.element-controls');
    
    // Update visibility based on config
    allControls.forEach(control => {
        // Force !important to override any other styles
        if (uiConfig.showElementControls) {
            control.style.setProperty('display', 'flex', 'important');
            control.style.removeProperty('visibility');
        } else {
            control.style.setProperty('display', 'none', 'important');
            control.style.setProperty('visibility', 'hidden', 'important');
        }
    });
    
    // Also update CSS to ensure new elements follow the same rule
    let styleElement = document.getElementById('element-controls-visibility-style');
    if (!styleElement) {
        styleElement = document.createElement('style');
        styleElement.id = 'element-controls-visibility-style';
        document.head.appendChild(styleElement);
    }
    
    // Set global CSS rule for element controls
    styleElement.textContent = `
        .element-controls {
            display: ${uiConfig.showElementControls ? 'flex' : 'none'} !important;
            visibility: ${uiConfig.showElementControls ? 'visible' : 'hidden'} !important;
        }
    `;
    
    console.log(`Element controls ${uiConfig.showElementControls ? 'shown' : 'hidden'} for ${allControls.length} elements`);
}

/**
 * Toggles the interactive layer on/off
 */
export function toggleInteractiveLayer() {
    const layerContainer = document.getElementById('interactiveLayer');
    const expandedControls = document.getElementById('layerControlsExpanded');
    const controlsPanel = document.querySelector('.interactive-layer-controls');
    const maskContainer = document.getElementById('videoMaskContainer');
    
    if (!layerContainer) return;
    
    isLayerActive = !isLayerActive;
    
    if (isLayerActive) {
        console.log('Activating interactive layer');
        layerContainer.style.display = 'block';
        
        // Set pointer-events to none by default to allow clicks to pass through to the video
        // We'll selectively enable pointer-events only for the elements we want to be interactive
        layerContainer.style.pointerEvents = 'none';
        
        // Show the controls panel
        if (controlsPanel) controlsPanel.style.display = 'flex';
        
        // Show the expanded controls
        if (expandedControls) expandedControls.classList.add('visible');
        
        // Update tab buttons if they exist
        const normalTabBtn = document.getElementById('normalVideoTab');
        const interactiveTabBtn = document.getElementById('interactiveVideoTab');
        
        if (normalTabBtn) normalTabBtn.classList.remove('active');
        if (interactiveTabBtn) interactiveTabBtn.classList.add('active');
        
        // Add a class to the body to indicate the interactive layer is active
        document.body.classList.add('interactive-layer-active');
        
        // Update state
        state.interactiveLayerActive = true;
        
        // Initialize the show bounding boxes toggle state
        // const showBoxesToggle = document.getElementById('showBoundingBoxes');
        // if (showBoxesToggle) {
        //     // Set the toggle to match the state (if available) or default to checked
        //     const shouldShowBoxes = state.showBoundingBoxes !== undefined ? state.showBoundingBoxes : true;
        //     showBoxesToggle.checked = shouldShowBoxes;
            
        //     // Apply the current toggle state
        //     toggleBoundingBoxes();
        // }
        
        // Initialize the auto-extract toggle state
        const autoExtractToggle = document.getElementById('autoExtractElements');
        if (autoExtractToggle) {
            // Set the toggle to match the state (if available) or default to checked (changed from false to true)
            const shouldAutoExtract = state.autoExtractElements !== undefined ? state.autoExtractElements : true;
            autoExtractToggle.checked = shouldAutoExtract;
            
            // Update the extract all button style
            updateExtractAllButtonStyle(shouldAutoExtract);
            
            // Store the preference in state
            state.autoExtractElements = shouldAutoExtract;
        }
        
        // Apply element controls visibility
        updateElementControlsVisibility();
        
        // Reset the last scene index to force scene change detection
        lastSceneIndex = null;
        
        // Ensure the video detection overlay is visible to select elements
        const videoDetectionOverlay = document.getElementById('videoDetectionOverlay');
        const toggleDetectionBtn = document.getElementById('toggleVideoDetectionsBtn');
        
        // if (videoDetectionOverlay) {
        //     if (videoDetectionOverlay.style.display === 'none') {
        //         console.log('Detection overlay is hidden, showing it');
        //         videoDetectionOverlay.style.display = 'block';
                
        //         // Update the toggle button state if it exists
        //         if (toggleDetectionBtn && !toggleDetectionBtn.classList.contains('active')) {
        //             toggleDetectionBtn.classList.add('active');
        //             toggleDetectionBtn.innerHTML = '<i class="fas fa-eye-slash"></i> Hide Detections';
        //         }
        //     }
            
        //     // Make detection boxes clickable for selection
        //     setTimeout(() => {
        //         makeDetectionBoxesSelectable();
                
        //         // Check if auto-extract is enabled and extract all elements if it is
        //         const autoExtractToggle = document.getElementById('autoExtractElements');
        //         if (autoExtractToggle && autoExtractToggle.checked) {
        //             console.log('Auto-extract is enabled, extracting all elements');
        //             extractAllElements();
        //         }
        //     }, 500);
        // }
        
        // Show extracted elements for the current scene
        const videoPlayer = elements.videoPlayer;
        if (videoPlayer) {
            const currentTime = videoPlayer.currentTime;
            const currentScene = findSceneAtTime(currentTime);
            
            if (currentScene) {
                // Show the mask container and update masks for the current scene
                if (maskContainer) {
                    maskContainer.style.display = 'block';
                    updateMasksForCurrentScene(currentScene.index);
                }
                
                // Show extracted elements for the current scene
                const sceneElements = extractedElements.filter(el => el.sceneIndex === currentScene.index);
                sceneElements.forEach(elementInfo => {
                    const element = document.getElementById(elementInfo.id);
                    if (element) {
                        element.style.display = 'block';
                    }
                });
            }
        }
        
        // Ensure video controls remain accessible - call this AFTER everything else
        // setTimeout(() => {
        //     ensureVideoControlsAccessible();
        // }, 500);
        
        // Restart the canvas animation loop if it was stopped
        if (!window.canvasAnimationFrameId) {
            startCanvasAnimationLoop();
        }
        
        // Show notification
        showNotification('Interactive layer activated. Elements will be automatically extracted.', 'info');
    } else {
        console.log('Deactivating interactive layer');
        layerContainer.style.display = 'none';
        if (maskContainer) {
            maskContainer.style.display = 'none';
        }
        
        // Hide the controls panel
        if (controlsPanel) controlsPanel.style.display = 'none';
        
        // Hide the expanded controls
        if (expandedControls) expandedControls.classList.remove('visible');
        
        // Update tab buttons if they exist
        const normalTabBtn = document.getElementById('normalVideoTab');
        const interactiveTabBtn = document.getElementById('interactiveVideoTab');
        
        if (normalTabBtn) normalTabBtn.classList.add('active');
        if (interactiveTabBtn) interactiveTabBtn.classList.remove('active');
        
        // Remove the class from the body
        document.body.classList.remove('interactive-layer-active');
        
        // Update state
        state.interactiveLayerActive = false;
        
        // Reset detection boxes to non-selectable
        resetDetectionBoxesSelectable();
        
        // Stop the canvas animation loop to save resources
        stopCanvasAnimationLoop();
        
        // Clear any control accessibility interval
        if (window.controlsAccessibilityInterval) {
            clearInterval(window.controlsAccessibilityInterval);
            window.controlsAccessibilityInterval = null;
        }
        
        // Remove any interactive layer styles
        const styleElement = document.getElementById('interactive-layer-styles');
        if (styleElement) {
            styleElement.remove();
        }
        
        // Hide the mask container (but don't remove the masks)
        if (maskContainer) {
            maskContainer.style.display = 'none';
        }
        
        // Show notification
        showNotification('Interactive layer deactivated', 'info');
    }
}

/**
 * Stops the canvas animation loop
 */
function stopCanvasAnimationLoop() {
    if (window.canvasAnimationFrameId) {
        cancelAnimationFrame(window.canvasAnimationFrameId);
        window.canvasAnimationFrameId = null;
        console.log('Canvas animation loop stopped');
    }
}

/**
 * Makes detection boxes selectable for extraction
 */
function makeDetectionBoxesSelectable() {
    // First, ensure the detection overlay is visible
    const videoDetectionOverlay = document.getElementById('videoDetectionOverlay');
    if (!videoDetectionOverlay) {
        console.error('Video detection overlay not found');
        showNotification('Detection overlay not found. Please enable object detection first.', 'error');
        return;
    }
    
    console.log('Making detection boxes selectable');
    
    // Force the overlay to be visible and in selection mode
    videoDetectionOverlay.style.display = 'block';
    videoDetectionOverlay.classList.add('selection-mode');
    
    // Find the video controls to create a non-interactive area
    const videoContainer = document.querySelector('.video-wrapper');
    const videoControls = videoContainer ? videoContainer.querySelector('.video-controls') : null;
    const videoPlayer = elements.videoPlayer;
    
    // Create a transparent overlay for the video player to handle play/pause clicks
    const videoClickHandler = document.createElement('div');
    videoClickHandler.id = 'videoClickHandler';
    videoClickHandler.style.position = 'absolute';
    videoClickHandler.style.top = '0';
    videoClickHandler.style.left = '0';
    videoClickHandler.style.width = '100%';
    videoClickHandler.style.height = videoControls ? `calc(100% - ${videoControls.offsetHeight}px)` : '100%';
    videoClickHandler.style.zIndex = '20';
    videoClickHandler.style.cursor = 'pointer';
    
    // Add click handler to play/pause the video
    videoClickHandler.addEventListener('click', (e) => {
        // Ignore clicks on detection boxes
        if (e.target.classList.contains('video-detection-box') || 
            e.target.closest('.video-detection-box')) {
            return;
        }
        
        // Play/pause the video
        if (videoPlayer) {
            if (videoPlayer.paused) {
                videoPlayer.play().catch(err => console.warn('Error playing video:', err));
            } else {
                videoPlayer.pause();
            }
        }
    });
    
    // Add the click handler to the video container
    videoContainer.appendChild(videoClickHandler);
    
    if (videoControls) {
        // Get the position and dimensions of the controls
        const controlsRect = videoControls.getBoundingClientRect();
        const overlayRect = videoDetectionOverlay.getBoundingClientRect();
        
        // Create a non-interactive area at the bottom of the overlay for controls
        const nonInteractiveArea = document.createElement('div');
        nonInteractiveArea.className = 'non-interactive-area';
        nonInteractiveArea.style.position = 'absolute';
        nonInteractiveArea.style.bottom = '0';
        nonInteractiveArea.style.left = '0';
        nonInteractiveArea.style.width = '100%';
        nonInteractiveArea.style.height = `${controlsRect.height + 10}px`;
        nonInteractiveArea.style.pointerEvents = 'none';
        nonInteractiveArea.style.zIndex = '9998';
        
        // Add the non-interactive area to the overlay
        videoDetectionOverlay.appendChild(nonInteractiveArea);
    }
    
    // Add a direct click handler to the overlay
    videoDetectionOverlay.onclick = function(e) {
        // Check if we clicked on a video control
        if (e.target.closest('.video-controls') || 
            e.target.tagName === 'BUTTON' || 
            e.target.tagName === 'INPUT' ||
            e.target.classList.contains('progress-bar') ||
            e.target.classList.contains('volume-control') ||
            e.target.classList.contains('time-display') ||
            e.target.classList.contains('fullscreen-btn') ||
            e.target.closest('.progress-bar') ||
            e.target.closest('.volume-control') ||
            e.target.closest('.time-display') ||
            e.target.closest('.fullscreen-btn')) {
            // Don't handle clicks on video controls
            console.log('Clicked on video control, ignoring');
            return;
        }
        
        // If we clicked on the overlay itself (not a detection box), pass the click to the video
        if (e.target === this) {
            console.log('Clicked on overlay, passing to video');
            if (videoPlayer) {
                if (videoPlayer.paused) {
                    videoPlayer.play().catch(err => console.warn('Error playing video:', err));
                } else {
                    videoPlayer.pause();
                }
            }
            return;
        }
        
        console.log('Overlay clicked at', e.clientX, e.clientY);
        
        // Find the detection box at this position
        const boxes = this.querySelectorAll('.video-detection-box');
        let targetBox = null;
        
        // Check each box to see if it contains the click position
        boxes.forEach(box => {
            const rect = box.getBoundingClientRect();
            if (e.clientX >= rect.left && e.clientX <= rect.right &&
                e.clientY >= rect.top && e.clientY <= rect.bottom) {
                targetBox = box;
            }
        });
        
        // If we found a box, extract it
        if (targetBox) {
            console.log('Found box at click position, extracting');
            
            // Store the video's playing state
            const wasPlaying = !videoPlayer.paused;
            
            // Extract the element
            extractElementFromBox(targetBox);
            
            // Resume playback if it was playing
            if (wasPlaying) {
                setTimeout(() => {
                    try {
                        videoPlayer.play().catch(e => console.warn('Error resuming video playback:', e));
                    } catch (e) {
                        console.warn('Error resuming video playback:', e);
                    }
                }, 100);
            }
        } else {
            console.log('No box found at click position');
        }
    };
    
    // Get all detection boxes
    const detectionBoxes = document.querySelectorAll('.video-detection-box');
    console.log(`Found ${detectionBoxes.length} detection boxes`);
    
    // Check if auto-extract is enabled
    const autoExtractToggle = document.getElementById('autoExtractElements');
    const shouldAutoExtract = autoExtractToggle && autoExtractToggle.checked;
    
    // If auto-extract is enabled, extract all elements immediately
    if (shouldAutoExtract && detectionBoxes.length > 0) {
        console.log('Auto-extract is enabled, extracting all elements');
        extractAllElements();
    } else {
        // Otherwise, make boxes clickable for manual extraction
    // Force all detection boxes to be clickable
    detectionBoxes.forEach((box, index) => {
        // Apply styles directly to make boxes clickable
        box.style.setProperty('pointer-events', 'auto', 'important');
        box.style.setProperty('cursor', 'pointer', 'important');
        box.style.setProperty('z-index', '100', 'important');
        
        // Add selection effect
        box.classList.add('selectable');
        
        // Add a direct click handler
        box.onclick = function(e) {
                // Check if we clicked on a video control area
                const videoControls = document.querySelector('.video-controls');
                if (videoControls) {
                    const controlsRect = videoControls.getBoundingClientRect();
                    if (e.clientY >= controlsRect.top) {
                        console.log('Click in video controls area, ignoring');
                        return;
                    }
                }
                
                console.log(`Box ${index} clicked`);
            e.stopPropagation();
            
            // Store the video's playing state
            const videoPlayer = elements.videoPlayer;
            const wasPlaying = !videoPlayer.paused;
            
            // Extract the element
            extractElementFromBox(this);
            
            // Resume playback if it was playing
            if (wasPlaying) {
                setTimeout(() => {
                    try {
                        videoPlayer.play().catch(e => console.warn('Error resuming video playback:', e));
                    } catch (e) {
                        console.warn('Error resuming video playback:', e);
                    }
                }, 100);
            }
        };
        });
    }
    
    // Ensure video controls remain accessible
    ensureVideoControlsAccessible();
    
    // Set up a periodic check to ensure boxes remain clickable and controls accessible
    if (window.boxCheckInterval) {
        clearInterval(window.boxCheckInterval);
    }
    
    window.boxCheckInterval = setInterval(() => {
        if (!isLayerActive) {
            clearInterval(window.boxCheckInterval);
            
            // Remove the video click handler
            const videoClickHandler = document.getElementById('videoClickHandler');
            if (videoClickHandler) {
                videoClickHandler.remove();
            }
            
            return;
        }
        
        // Re-ensure video controls are accessible
        ensureVideoControlsAccessible();
        
        const currentBoxes = document.querySelectorAll('.video-detection-box:not(.selectable)');
        if (currentBoxes.length > 0) {
            console.log(`Found ${currentBoxes.length} new detection boxes, making them selectable`);
            currentBoxes.forEach((box, index) => {
                box.style.setProperty('pointer-events', 'auto', 'important');
                box.style.setProperty('cursor', 'pointer', 'important');
                box.style.setProperty('z-index', '100', 'important');
                box.classList.add('selectable');
                
                box.onclick = function(e) {
                    // Check if we clicked on a video control area
                    const videoControls = document.querySelector('.video-controls');
                    if (videoControls) {
                        const controlsRect = videoControls.getBoundingClientRect();
                        if (e.clientY >= controlsRect.top) {
                            console.log('Click in video controls area, ignoring');
                            return;
                        }
                    }
                    
                    console.log(`New box ${index} clicked`);
                    e.stopPropagation();
                    
                    // Store the video's playing state
                    const videoPlayer = elements.videoPlayer;
                    const wasPlaying = !videoPlayer.paused;
                    
                    // Extract the element
                    extractElementFromBox(this);
                    
                    // Resume playback if it was playing
                    if (wasPlaying) {
                        setTimeout(() => {
                            try {
                                videoPlayer.play().catch(e => console.warn('Error resuming video playback:', e));
                            } catch (e) {
                                console.warn('Error resuming video playback:', e);
                            }
                        }, 100);
                    }
                };
            });
        }
    }, 1000);
    
    // Show notification to guide the user
    showNotification('Click on any detected element in the video to extract it', 'info');
}

/**
 * Shows the element selection UI
 */
function showElementSelectionUI() {
    console.log('Showing element selection UI');
    
    // Get the video detection overlay
    const videoDetectionOverlay = document.getElementById('videoDetectionOverlay');
    
    if (!videoDetectionOverlay) {
        showNotification('No detection overlay found. Please enable detections first.', 'error');
        return;
    }
    
    // Add a class to indicate selection mode
    videoDetectionOverlay.classList.add('selection-mode');
    
    // Make the overlay clickable
    videoDetectionOverlay.style.pointerEvents = 'auto';
    
    // Add a click handler to the overlay
    videoDetectionOverlay.onclick = function(e) {
        // Check if we clicked on a video control area
        const videoControls = document.querySelector('.video-controls');
        if (videoControls) {
            const controlsRect = videoControls.getBoundingClientRect();
            if (e.clientY >= controlsRect.top) {
                console.log('Click in video controls area, ignoring');
                return;
            }
        }
        
        // Find the detection box at this position
        const boxes = this.querySelectorAll('.video-detection-box');
        let targetBox = null;
        
        // Check each box to see if it contains the click position
        boxes.forEach(box => {
            const rect = box.getBoundingClientRect();
            if (e.clientX >= rect.left && e.clientX <= rect.right &&
                e.clientY >= rect.top && e.clientY <= rect.bottom) {
                targetBox = box;
            }
        });
        
        // If we found a box, extract it
        if (targetBox) {
            console.log('Found box at click position, extracting');
            
            // Store the video's playing state
            const wasPlaying = !videoPlayer.paused;
            
            // Extract the element (this already creates a mask with the average color)
            extractElementFromBox(targetBox);
            
            // Ensure the mask container exists, but don't create a duplicate mask
            let maskContainer = document.getElementById('videoMaskContainer');
            if (!maskContainer) {
                maskContainer = document.createElement('div');
                maskContainer.id = 'videoMaskContainer';
                maskContainer.style.position = 'absolute';
                maskContainer.style.top = '0';
                maskContainer.style.left = '0';
                maskContainer.style.width = '100%';
                maskContainer.style.height = '100%';
                maskContainer.style.pointerEvents = 'none';
                maskContainer.style.zIndex = '1'; // Between video and interactive layer
                
                // Add the mask container to the video container
                const videoContainer = document.querySelector('.video-wrapper');
                if (videoContainer) {
                    videoContainer.appendChild(maskContainer);
                }
            }
            
            // No need to create another mask here since extractElementFromBox already does that
            // with the average color calculation
            
            // Resume playback if it was playing
            if (wasPlaying) {
                setTimeout(() => {
                    try {
                        videoPlayer.play().catch(e => console.warn('Error resuming video playback:', e));
                    } catch (e) {
                        console.warn('Error resuming video playback:', e);
                    }
                }, 100);
        }
    } else {
            console.log('No box found at click position');
        }
    };
}

/**
 * Creates a manual selection mode when no detection boxes are found
 */
function createManualSelectionMode() {
    console.log('Creating manual selection mode');
    
    // Get the video container
    const videoWrapper = document.querySelector('.video-wrapper');
    if (!videoWrapper) {
        console.error('Video wrapper not found');
        showNotification('Video wrapper not found', 'error');
        return;
    }
    
    // Get the video player
    const videoPlayer = elements.videoPlayer;
    if (!videoPlayer) {
        console.error('Video player not found');
        showNotification('Video player not found', 'error');
        return;
    }
    
    // Store the video's playing state
    const wasPlaying = !videoPlayer.paused;
    
    // Pause the video during selection
    if (wasPlaying) {
        try {
            videoPlayer.pause();
        } catch (e) {
            console.warn('Error pausing video:', e);
        }
    }
    
    // Create or get the detection overlay
    let videoDetectionOverlay = document.getElementById('videoDetectionOverlay');
    if (!videoDetectionOverlay) {
        videoDetectionOverlay = document.createElement('div');
        videoDetectionOverlay.id = 'videoDetectionOverlay';
        videoDetectionOverlay.className = 'video-detection-overlay';
        videoWrapper.appendChild(videoDetectionOverlay);
    }
    
    // Make sure the overlay is visible
    videoDetectionOverlay.style.display = 'block';
    videoDetectionOverlay.style.setProperty('pointer-events', 'auto', 'important');
    videoDetectionOverlay.classList.add('selection-mode');
    
    // Clear any existing content
    videoDetectionOverlay.innerHTML = '';
    
    // Show notification to guide the user
    showNotification('No detection boxes found. Click and drag to select an area of the video.', 'info');
    
    // Add manual selection functionality
    let isSelecting = false;
    let startX, startY;
    let selectionBox = null;
    
    // Add mousedown event to start selection
    videoDetectionOverlay.onmousedown = function(e) {
        // Check if we clicked on a video control
        if (e.target.closest('.video-controls') || 
            e.target.tagName === 'BUTTON' || 
            e.target.tagName === 'INPUT') {
            // Don't handle clicks on video controls
            return;
        }
        
        // Get position relative to the overlay
        const rect = this.getBoundingClientRect();
        startX = e.clientX - rect.left;
        startY = e.clientY - rect.top;
        
        // Create selection box
        selectionBox = document.createElement('div');
        selectionBox.className = 'video-detection-box manual-selection';
        selectionBox.style.position = 'absolute';
        selectionBox.style.left = startX + 'px';
        selectionBox.style.top = startY + 'px';
        selectionBox.style.width = '0';
        selectionBox.style.height = '0';
        selectionBox.style.border = '2px dashed rgba(255, 255, 0, 0.7)';
        selectionBox.style.backgroundColor = 'rgba(255, 255, 0, 0.2)';
        selectionBox.style.pointerEvents = 'none';
        
        // Add to overlay
        this.appendChild(selectionBox);
        
        isSelecting = true;
    };
    
    // Add mousemove event to update selection
    videoDetectionOverlay.onmousemove = function(e) {
        if (!isSelecting || !selectionBox) return;
        
        // Get position relative to the overlay
        const rect = this.getBoundingClientRect();
        const currentX = e.clientX - rect.left;
        const currentY = e.clientY - rect.top;
        
        // Calculate dimensions
        const width = Math.abs(currentX - startX);
        const height = Math.abs(currentY - startY);
        
        // Calculate position (handle selection in any direction)
        const left = Math.min(startX, currentX);
        const top = Math.min(startY, currentY);
        
        // Update selection box
        selectionBox.style.left = left + 'px';
        selectionBox.style.top = top + 'px';
        selectionBox.style.width = width + 'px';
        selectionBox.style.height = height + 'px';
    };
    
    // Add mouseup event to complete selection
    videoDetectionOverlay.onmouseup = function(e) {
        if (!isSelecting || !selectionBox) return;
        
        isSelecting = false;
        
        // Get final dimensions
        const width = parseInt(selectionBox.style.width);
        const height = parseInt(selectionBox.style.height);
        
        // Only process if selection is large enough
        if (width > 20 && height > 20) {
            // Remove the temporary selection box
            this.removeChild(selectionBox);
            
            // Create a proper detection box
            const detectionBox = document.createElement('div');
            detectionBox.className = 'video-detection-box selectable';
            detectionBox.style.position = 'absolute';
            detectionBox.style.left = selectionBox.style.left;
            detectionBox.style.top = selectionBox.style.top;
            detectionBox.style.width = selectionBox.style.width;
            detectionBox.style.height = selectionBox.style.height;
            detectionBox.style.border = '2px solid rgba(255, 255, 0, 0.9)';
            detectionBox.style.backgroundColor = 'rgba(255, 255, 0, 0.2)';
            detectionBox.style.pointerEvents = 'auto';
            detectionBox.style.cursor = 'pointer';
            detectionBox.style.zIndex = '100';
            
            // Add click handler
            detectionBox.onclick = function(e) {
                e.stopPropagation();
                extractElementFromBox(this);
                
                // Resume video playback if it was playing before
                if (wasPlaying) {
                    setTimeout(() => {
                        try {
                            videoPlayer.play().catch(e => console.warn('Error resuming video playback:', e));
                        } catch (e) {
                            console.warn('Error resuming video playback:', e);
                        }
                    }, 100);
                }
            };
            
            // Add to overlay
            this.appendChild(detectionBox);
            
            // Show notification
            showNotification('Selection created. Click on it to extract this element.', 'success');
        } else {
            // Selection too small, remove it
            this.removeChild(selectionBox);
            showNotification('Selection too small. Please try again with a larger area.', 'warning');
            
            // Resume video playback if it was playing before
            if (wasPlaying) {
                setTimeout(() => {
                    try {
                        videoPlayer.play().catch(e => console.warn('Error resuming video playback:', e));
                    } catch (e) {
                        console.warn('Error resuming video playback:', e);
                    }
                }, 100);
            }
        }
        
        selectionBox = null;
        
        // Ensure video controls remain accessible
        ensureVideoControlsAccessible();
    };
    
    // Add mouseleave event to cancel selection
    videoDetectionOverlay.onmouseleave = function(e) {
        if (isSelecting && selectionBox) {
            isSelecting = false;
            this.removeChild(selectionBox);
            selectionBox = null;
            
            // Resume video playback if it was playing before
            if (wasPlaying) {
                setTimeout(() => {
                    try {
                        videoPlayer.play().catch(e => console.warn('Error resuming video playback:', e));
                    } catch (e) {
                        console.warn('Error resuming video playback:', e);
                    }
                }, 100);
            }
            
            // Ensure video controls remain accessible
            ensureVideoControlsAccessible();
        }
    };
    
    // Ensure video controls remain accessible
    ensureVideoControlsAccessible();
}

/**
 * Extracts an element from a detection box
 * @param {HTMLElement} box - The detection box element
 */
function extractElementFromBox(box) {
    const videoPlayer = elements.videoPlayer;
    const layerContainer = document.getElementById('interactiveLayer');
    const videoContainer = document.querySelector('.video-wrapper');
    const contentArea = layerContainer.querySelector('.interactive-content-area');
    
    // Get the current time to identify the scene
    const currentTime = videoPlayer.currentTime;
    const currentScene = findSceneAtTime(currentTime);
    
    if (!currentScene) {
        showNotification('Could not identify the current scene', 'error');
        return;
    }
    
    // Get the box position and dimensions
    const boxRect = box.getBoundingClientRect();
    const videoRect = videoPlayer.getBoundingClientRect();
    const containerRect = videoContainer.getBoundingClientRect();
    
    // Calculate position relative to the video with higher precision
    const relativeLeft = (boxRect.left - videoRect.left) / videoRect.width;
    const relativeTop = (boxRect.top - videoRect.top) / videoRect.height;
    const relativeWidth = boxRect.width / videoRect.width;
    const relativeHeight = boxRect.height / videoRect.height;
    
    // Store the exact pixel positions relative to the video
    const exactPixelLeft = Math.floor(boxRect.left - videoRect.left);
    const exactPixelTop = Math.floor(boxRect.top - videoRect.top);
    const exactPixelWidth = Math.ceil(boxRect.width);
    const exactPixelHeight = Math.ceil(boxRect.height);
    
    // Calculate mask position relative to the video container
    const maskLeft = Math.floor(boxRect.left - containerRect.left);
    const maskTop = Math.floor(boxRect.top - containerRect.top);
    const maskWidth = Math.ceil(boxRect.width);
    const maskHeight = Math.ceil(boxRect.height);
    
    // Create a unique ID for this element
    const elementId = `extracted-element-${Date.now()}`;
    
    // Create the extracted element container
    const elementContainer = document.createElement('div');
    elementContainer.id = elementId;
    elementContainer.className = 'extracted-video-element';
    elementContainer.style.position = 'absolute';
    elementContainer.contentEditable = 'true';
    
    // Position using exact pixel values
    elementContainer.style.left = `${exactPixelLeft}px`;
    elementContainer.style.top = `${exactPixelTop}px`;
    elementContainer.style.width = `${exactPixelWidth}px`;
    elementContainer.style.height = `${exactPixelHeight}px`;
    elementContainer.style.overflow = 'hidden';
    elementContainer.style.transform = 'translate3d(0,0,0)'; // Force GPU acceleration for sharper rendering
    
    // Store the exact pixel values as data attributes
    elementContainer.dataset.exactPixelLeft = exactPixelLeft;
    elementContainer.dataset.exactPixelTop = exactPixelTop;
    elementContainer.dataset.exactPixelWidth = exactPixelWidth;
    elementContainer.dataset.exactPixelHeight = exactPixelHeight;
    
    // Check if we should show borders based on the toggle state
    const showBoxesToggle = document.getElementById('showBoundingBoxes');
    if (showBoxesToggle && !showBoxesToggle.checked) {
        elementContainer.style.border = 'none';
    } else {
        elementContainer.style.border = '2px solid rgba(0, 255, 0, 0.7)';
    }
    
    elementContainer.style.zIndex = '200';
    
    // Create a canvas element to display the video content
    const canvas = document.createElement('canvas');
    canvas.className = 'video-canvas';
    
    // Set canvas dimensions to match the exact pixel dimensions
    canvas.width = exactPixelWidth;
    canvas.height = exactPixelHeight;
    
    // Set the canvas display size to match exactly
    canvas.style.width = `${exactPixelWidth}px`;
    canvas.style.height = `${exactPixelHeight}px`;
    canvas.style.imageRendering = 'pixelated';
    canvas.style.transform = 'translate3d(0,0,0)'; // Force GPU acceleration
    
    // Calculate source coordinates in the actual video dimensions
    const sourceX = Math.floor(videoPlayer.videoWidth * relativeLeft);
    const sourceY = Math.floor(videoPlayer.videoHeight * relativeTop);
    const sourceWidth = Math.ceil(videoPlayer.videoWidth * relativeWidth);
    const sourceHeight = Math.ceil(videoPlayer.videoHeight * relativeHeight);
    
    // Store these values as data attributes for later use
    canvas.dataset.sourceX = sourceX;
    canvas.dataset.sourceY = sourceY;
    canvas.dataset.sourceWidth = sourceWidth;
    canvas.dataset.sourceHeight = sourceHeight;
    
    // Add controls to the element container
    const controls = document.createElement('div');
    controls.className = 'element-controls';
    controls.innerHTML = `
        <button class="delete-element-btn" title="Delete Element">
            <i class="fas fa-trash"></i>
        </button>
        <button class="lock-element-btn" title="Lock/Unlock Element">
            <i class="fas fa-lock-open"></i>
        </button>
    `;
    
    // Set visibility of controls based on config
    if (uiConfig.showElementControls) {
        controls.style.setProperty('display', 'flex', 'important');
        controls.style.removeProperty('visibility');
    } else {
        controls.style.setProperty('display', 'none', 'important');
        controls.style.setProperty('visibility', 'hidden', 'important');
    }
    
    // Add elements to the container
    elementContainer.appendChild(canvas);
    elementContainer.appendChild(controls);
    
    // Add the element container to the layer
    layerContainer.appendChild(elementContainer);
    
    // Create or get the mask container
    let maskContainer = document.getElementById('videoMaskContainer');
    if (!maskContainer) {
        maskContainer = document.createElement('div');
        maskContainer.id = 'videoMaskContainer';
        maskContainer.style.position = 'absolute';
        maskContainer.style.top = '0';
        maskContainer.style.left = '0';
        maskContainer.style.width = `${containerRect.width}px`; // Use container dimensions
        maskContainer.style.height = `${containerRect.height}px`;
        maskContainer.style.pointerEvents = 'none';
        maskContainer.style.zIndex = '50';
        maskContainer.style.transform = 'translate3d(0,0,0)'; // Force GPU acceleration
        
        videoContainer.appendChild(maskContainer);
    }
    
    // Calculate the average color of the surrounding pixels
    const avgColor = calculateSurroundingAverageColor(
        videoPlayer, sourceX, sourceY, sourceWidth, sourceHeight
    );
    
    // Create a mask for this element
    const mask = document.createElement('div');
    mask.className = 'video-element-mask';
    mask.dataset.elementId = elementId;
    mask.dataset.sceneIndex = currentScene.index;
    
    // Store both relative and exact pixel positions
    mask.dataset.relativeLeft = relativeLeft;
    mask.dataset.relativeTop = relativeTop;
    mask.dataset.relativeWidth = relativeWidth;
    mask.dataset.relativeHeight = relativeHeight;
    mask.dataset.maskLeft = maskLeft;
    mask.dataset.maskTop = maskTop;
    mask.dataset.maskWidth = maskWidth;
    mask.dataset.maskHeight = maskHeight;
    
    // Position the mask using exact pixel values relative to the container
    mask.style.position = 'absolute';
    mask.style.left = `${maskLeft}px`;
    mask.style.top = `${maskTop}px`;
    mask.style.width = `${maskWidth}px`;
    mask.style.height = `${maskHeight}px`;
    mask.style.backgroundColor = avgColor;
    mask.style.pointerEvents = 'none';
    mask.style.transform = 'translate3d(0,0,0)'; // Force GPU acceleration
    
    // Add the mask to the container
    maskContainer.appendChild(mask);
    
    // Store the extracted element info with both relative and exact pixel positions
    const elementInfo = {
        id: elementId,
        sceneTime: currentTime,
        sceneIndex: currentScene.index,
        position: {
            relative: { left: relativeLeft, top: relativeTop },
            pixel: { left: exactPixelLeft, top: exactPixelTop },
            mask: { left: maskLeft, top: maskTop }
        },
        size: {
            relative: { width: relativeWidth, height: relativeHeight },
            pixel: { width: exactPixelWidth, height: exactPixelHeight },
            mask: { width: maskWidth, height: maskHeight }
        },
        sourceCoords: { x: sourceX, y: sourceY, width: sourceWidth, height: sourceHeight },
        videoSrc: videoPlayer.src,
        isLocked: false,
        isCanvasView: true,
        isTextMode: false,
        ocrResult: box.detection && box.detection.ocr_text ? {
            text: box.detection.ocr_text,
            ocr_class: box.detection.ocr_class || null
        } : (box.ocrResult ? {
            text: box.ocrResult.text,
            ocr_class: box.ocrResult.ocr_class || null
        } : null)
    };
    
    extractedElements.push(elementInfo);
    
    // Make the element draggable and resizable
    makeElementDraggable(elementContainer);
    makeElementResizable(elementContainer);
    
    // Add event listeners for the controls
    setupElementControls(elementContainer, elementInfo);
    
    // Reset selection mode
    resetDetectionBoxesSelectable();
    
    // Draw the initial frame
    drawVideoToCanvas(canvas, videoPlayer, sourceX, sourceY, sourceWidth, sourceHeight);
    
    // Add resize observer to maintain pixel-perfect alignment when video size changes
    const resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
            if (entry.target === videoPlayer) {
                const newVideoRect = videoPlayer.getBoundingClientRect();
                const newContainerRect = videoContainer.getBoundingClientRect();
                
                // Calculate new positions
                const newLeft = Math.floor(newVideoRect.left + (relativeLeft * newVideoRect.width));
                const newTop = Math.floor(newVideoRect.top + (relativeTop * newVideoRect.height));
                const newWidth = Math.ceil(relativeWidth * newVideoRect.width);
                const newHeight = Math.ceil(relativeHeight * newVideoRect.height);
                
                // Calculate new mask positions
                const newMaskLeft = Math.floor(newLeft - newContainerRect.left);
                const newMaskTop = Math.floor(newTop - newContainerRect.top);
                
                // Update element position and size
                elementContainer.style.left = `${newLeft}px`;
                elementContainer.style.top = `${newTop}px`;
                elementContainer.style.width = `${newWidth}px`;
                elementContainer.style.height = `${newHeight}px`;
                
                // Update canvas dimensions
                canvas.width = newWidth;
                canvas.height = newHeight;
                canvas.style.width = `${newWidth}px`;
                canvas.style.height = `${newHeight}px`;
                
                // Update mask container size
                if (maskContainer) {
                    maskContainer.style.width = `${newContainerRect.width}px`;
                    maskContainer.style.height = `${newContainerRect.height}px`;
                }
                
                // Update mask position and size
                if (mask) {
                    mask.style.left = `${newMaskLeft}px`;
                    mask.style.top = `${newMaskTop}px`;
                    mask.style.width = `${newWidth}px`;
                    mask.style.height = `${newHeight}px`;
                }
                
                // Redraw the canvas
                drawVideoToCanvas(canvas, videoPlayer, sourceX, sourceY, sourceWidth, sourceHeight);
            }
        }
    });
    
    // Start observing the video player
    resizeObserver.observe(videoPlayer);
    
    // Store the observer in the element info for cleanup
    elementInfo.resizeObserver = resizeObserver;
    
    // Show success notification
    showNotification('Element extracted successfully', 'success');
    
    // Apply text mode if enabled
    if (uiConfig.useTextMode && elementInfo.ocrResult && elementInfo.ocrResult.text) {
        convertElementToTextMode(elementContainer, elementInfo);
    }
    
    return elementInfo;
}

/**
 * Draws a portion of the video to a canvas
 * @param {HTMLCanvasElement} canvas - The canvas to draw to
 * @param {HTMLVideoElement} video - The video source
 * @param {number} sourceX - The x coordinate in the source video
 * @param {number} sourceY - The y coordinate in the source video
 * @param {number} sourceWidth - The width of the source region
 * @param {number} sourceHeight - The height of the source region
 */
function drawVideoToCanvas(canvas, video, sourceX, sourceY, sourceWidth, sourceHeight) {
    if (!canvas || !video) return;
    
    // Skip drawing if video is not ready or if the source dimensions are invalid
    if (video.readyState < 2 || sourceWidth <= 0 || sourceHeight <= 0) return;
    
    // Get the 2D context once and reuse it
    const ctx = canvas.getContext('2d', { alpha: false }); // Disable alpha for better performance
    if (!ctx) return;
    
    try {
        // Ensure canvas dimensions match the display size for better quality
        if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
            canvas.width = canvas.clientWidth;
            canvas.height = canvas.clientHeight;
        }
        
        // Draw the video region to the canvas
        ctx.drawImage(
            video,
            sourceX, sourceY, sourceWidth, sourceHeight, // Source coordinates
            0, 0, canvas.width, canvas.height // Destination coordinates
        );
    } catch (e) {
        // Only log errors if they're not the common "The video element has no source" error
        if (e.name !== 'InvalidStateError') {
            console.warn('Error drawing video to canvas:', e);
        }
    }
}

/**
 * Sets up controls for an extracted element
 * @param {HTMLElement} elementContainer - The element container
 * @param {Object} elementInfo - The element information
 */
function setupElementControls(elementContainer, elementInfo) {
    // Delete button
    const deleteBtn = elementContainer.querySelector('.delete-element-btn');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteElement(elementInfo.id);
        });
    }
    
    // Lock/unlock button
    const lockBtn = elementContainer.querySelector('.lock-element-btn');
    if (lockBtn) {
        lockBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleElementLock(elementInfo.id);
        });
    }
    
    // Make the element active when clicked
    elementContainer.addEventListener('mousedown', () => {
        setActiveElement(elementInfo.id);
    });

    // Add click handler for transcript highlighting
    elementContainer.addEventListener('click', (e) => {
        // Don't trigger if clicking on controls
        if (e.target.closest('.element-controls')) {
            return;
        }
        highlightTranscriptSegmentsForOcr(elementInfo);
    });
}

/**
 * Makes an element draggable
 * @param {HTMLElement} element - The element to make draggable
 */
function makeElementDraggable(element) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    let isDragging = false;
    
    element.onmousedown = dragMouseDown;
    
    // Add wheel event listener for zoom functionality
    element.addEventListener('wheel', handleElementZoom);
    
    function handleElementZoom(e) {
        e.preventDefault();
        
        // Get the element info
        const elementId = element.id;
        const elementInfo = extractedElements.find(el => el.id === elementId);
        
        // Don't allow zooming if locked
        if (elementInfo && elementInfo.isLocked) {
            return;
        }
        
        // Set as active element when zooming
        setActiveElement(elementId);
        
        // Get current dimensions and position
        const currentWidth = element.offsetWidth;
        const currentHeight = element.offsetHeight;
        const currentLeft = element.offsetLeft;
        const currentTop = element.offsetTop;
        
        // Calculate zoom factor based on wheel delta
        // Negative delta means zoom in (wheel down/pinch in)
        const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
        
        // Calculate new dimensions while preserving aspect ratio
        let newWidth = currentWidth * zoomFactor;
        let newHeight = currentHeight * zoomFactor;
        
        // Get original aspect ratio
        const aspectRatio = currentWidth / currentHeight;
        
        // Enforce minimum dimensions while maintaining aspect ratio
        if (newWidth < 20) {
            newWidth = 20;
            newHeight = newWidth / aspectRatio;
        }
        
        if (newHeight < 20) {
            newHeight = 20;
            newWidth = newHeight * aspectRatio;
        }
        
        // Calculate position adjustment to keep the element centered on cursor during zoom
        const rect = element.getBoundingClientRect();
        const cursorXRelative = e.clientX - rect.left; // Cursor position relative to element
        const cursorYRelative = e.clientY - rect.top;
        
        const cursorXRatio = cursorXRelative / currentWidth; // Position ratio within element
        const cursorYRatio = cursorYRelative / currentHeight;
        
        // Calculate new position to maintain cursor position over same content point
        const newLeft = currentLeft - ((newWidth - currentWidth) * cursorXRatio);
        const newTop = currentTop - ((newHeight - currentHeight) * cursorYRatio);
        
        // Apply new dimensions and position
        element.style.width = `${newWidth}px`;
        element.style.height = `${newHeight}px`;
        element.style.left = `${newLeft}px`;
        element.style.top = `${newTop}px`;
        
        // Update the element info
        if (elementInfo) {
            // Use viewport width/height for relative sizing and positioning
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            
            elementInfo.position.left = newLeft / viewportWidth;
            elementInfo.position.top = newTop / viewportHeight;
            elementInfo.size.width = newWidth / viewportWidth;
            elementInfo.size.height = newHeight / viewportHeight;
            
            // Update the corresponding mask position and size
            updateMaskPosition(elementId, elementInfo.position.left, elementInfo.position.top, elementInfo.size.width, elementInfo.size.height);
            
            // Check if this is a canvas view
            if (elementInfo.isCanvasView) {
                // Update the canvas dimensions and redraw
                const canvas = element.querySelector('.video-canvas');
                if (canvas) {
                    // Keep the same source coordinates but update the canvas size
                    const { x, y, width, height } = elementInfo.sourceCoords;
                    
                    // Draw the current video frame to the canvas with the new dimensions
                    const videoPlayer = elements.videoPlayer;
                    drawVideoToCanvas(canvas, videoPlayer, x, y, width, height);
                }
            }
        }
        
        // Show aspect ratio is being preserved
        element.classList.add('preserving-ratio');
        
        // Briefly add a visual indication of zooming
        element.classList.add('zooming');
        setTimeout(() => {
            element.classList.remove('zooming');
            element.classList.remove('preserving-ratio');
        }, 1000);
    }
    
    function dragMouseDown(e) {
        e = e || window.event;
        
        // Check if we're clicking on a resize handle or control button
        if (e.target.classList.contains('resize-handle') || 
            e.target.classList.contains('element-controls') ||
            e.target.closest('.element-controls')) {
            return;
        }
        
        // Prevent default only if not clicking on a control
        e.preventDefault();
        
        // Get the element info
        const elementId = element.id;
        const elementInfo = extractedElements.find(el => el.id === elementId);
        
        // Don't allow dragging if locked
        if (elementInfo && elementInfo.isLocked) {
            return;
        }
        
        // Get the mouse cursor position at startup
        pos3 = e.clientX;
        pos4 = e.clientY;
        
        // Set up the document events
        document.onmouseup = closeDragElement;
        document.onmousemove = elementDrag;
        
        // Add active class
        element.classList.add('active-drag');
        
        // Set as active element
        setActiveElement(elementId);
        
        // Set dragging flag
        isDragging = true;
        
        // Log that we're starting to drag
        console.log(`Starting to drag element ${elementId}`);
    }
    
    function elementDrag(e) {
        if (!isDragging) return;
        
        e = e || window.event;
        e.preventDefault();
        
        // Calculate the new cursor position
        pos1 = pos3 - e.clientX;
        pos2 = pos4 - e.clientY;
        pos3 = e.clientX;
        pos4 = e.clientY;
        
        // Calculate new position in pixels
        const newTop = element.offsetTop - pos2;
        const newLeft = element.offsetLeft - pos1;
        
        // REMOVED: Container boundary constraints - allow elements to move freely
        // Now elements can be dragged anywhere in the viewport
        
        // Set the element's new position
        element.style.top = `${newTop}px`;
        element.style.left = `${newLeft}px`;
        
        // Update the element info
        const elementId = element.id;
        const elementInfo = extractedElements.find(el => el.id === elementId);
        if (elementInfo) {
            // Use viewport width/height for relative positioning
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            
            // Calculate position as percentage of viewport
            elementInfo.position.left = newLeft / viewportWidth;
            elementInfo.position.top = newTop / viewportHeight;
            
            // Update the corresponding mask position (if within video area)
            updateMaskPosition(elementId, elementInfo.position.left, elementInfo.position.top, elementInfo.size.width, elementInfo.size.height);
        }
    }
    
    function closeDragElement() {
        // Stop moving when mouse button is released
        document.onmouseup = null;
        document.onmousemove = null;
        
        // Remove active class
        element.classList.remove('active-drag');
        
        // Clear dragging flag
        isDragging = false;
    }
}

/**
 * Updates the position and size of a mask for an element
 * @param {string} elementId - The ID of the element
 * @param {number} left - The left position (0-1)
 * @param {number} top - The top position (0-1)
 * @param {number} width - The width (0-1)
 * @param {number} height - The height (0-1)
 */
function updateMaskPosition(elementId, left, top, width, height) {
    // Find the mask for this element
    const mask = document.querySelector(`.video-element-mask[data-element-id="${elementId}"]`);
    if (!mask) {
        console.warn(`Mask for element ${elementId} not found`);
        return;
    }
    
    // We don't update the mask position - it should stay at the original position
    // This ensures masks always appear at the original detection positions
    
    // Log the update
    console.log(`Mask position for element ${elementId} remains at original position`);
}

/**
 * Makes an element resizable
 * @param {HTMLElement} element - The element to make resizable
 */
function makeElementResizable(element) {
    const handles = element.querySelectorAll('.resize-handle');
    
    // If handles already exist, just set up the events
    if (handles.length > 0) {
        setupResizeHandles(handles, element);
        return;
    }
    
    // Create resize handles if they don't exist
    const handlePositions = ['nw', 'ne', 'sw', 'se'];
    handlePositions.forEach(position => {
        const resizeHandle = document.createElement('div');
        resizeHandle.className = `resize-handle ${position}-handle`;
        
        // Apply initial visibility based on the show boxes toggle
        const showBoxesToggle = document.getElementById('showBoundingBoxes');
        if (showBoxesToggle && !showBoxesToggle.checked) {
            resizeHandle.style.display = 'none';
        }
        
        element.appendChild(resizeHandle);
    });
    
    // Set up events for the newly created handles
    const newHandles = element.querySelectorAll('.resize-handle');
    setupResizeHandles(newHandles, element);
}

/**
 * Sets up resize behavior for element handles
 * @param {NodeList} handles - The resize handles
 * @param {HTMLElement} element - The element to resize
 */
function setupResizeHandles(handles, element) {
    const videoPlayer = elements.videoPlayer;
    
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
            
            // Store original aspect ratio
            const aspectRatio = startWidth / startHeight;
            
            const handleClass = handle.className;
            const isNorth = handleClass.includes('nw-handle') || handleClass.includes('ne-handle');
            const isWest = handleClass.includes('nw-handle') || handleClass.includes('sw-handle');
            
            // Check if shift key is pressed to toggle aspect ratio preservation
            let maintainAspectRatio = true;
            
            // Add event listener to check if shift key state changes during resize
            const checkShiftKey = (keyEvent) => {
                if (keyEvent.key === 'Shift') {
                    maintainAspectRatio = !keyEvent.shiftKey;
                    if (maintainAspectRatio) {
                        element.classList.add('preserving-ratio');
                    } else {
                        element.classList.remove('preserving-ratio');
                    }
                }
            };
            
            document.addEventListener('keydown', checkShiftKey);
            document.addEventListener('keyup', checkShiftKey);
            
            // Initially add the preserving-ratio class
            element.classList.add('preserving-ratio');
            
            // Get the element info
            const elementId = element.id;
            const elementInfo = extractedElements.find(el => el.id === elementId);
            
            // Add active class
            element.classList.add('active-resize');
            
            function resize(e) {
                let newWidth, newHeight, newLeft, newTop;
                
                // Calculate new dimensions based on mouse movement
                if (isWest) {
                    newWidth = startWidth - (e.clientX - startX);
                    newLeft = startLeft + (e.clientX - startX);
                } else {
                    newWidth = startWidth + (e.clientX - startX);
                    newLeft = startLeft;
                }
                
                if (isNorth) {
                    newHeight = startHeight - (e.clientY - startY);
                    newTop = startTop + (e.clientY - startY);
                } else {
                    newHeight = startHeight + (e.clientY - startY);
                    newTop = startTop;
                }
                
                // Adjust dimensions to maintain aspect ratio if enabled
                if (maintainAspectRatio) {
                    // Determine which dimension is driving the resize
                    const widthChange = Math.abs(newWidth - startWidth);
                    const heightChange = Math.abs(newHeight - startHeight);
                    
                    if (widthChange >= heightChange) {
                        // Width is driving the resize
                        newHeight = newWidth / aspectRatio;
                        
                        // Adjust top position if resizing from top edge
                        if (isNorth) {
                            newTop = startTop + (startHeight - newHeight);
                        }
                    } else {
                        // Height is driving the resize
                        newWidth = newHeight * aspectRatio;
                        
                        // Adjust left position if resizing from left edge
                        if (isWest) {
                            newLeft = startLeft + (startWidth - newWidth);
                        }
                    }
                }
                
                // Enforce minimum dimensions
                if (newWidth < 20) {
                    newWidth = 20;
                    if (maintainAspectRatio) {
                        newHeight = newWidth / aspectRatio;
                        if (isNorth) {
                            newTop = startTop + (startHeight - newHeight);
                        }
                    }
                    if (isWest) {
                        newLeft = startLeft + (startWidth - newWidth);
                    }
                }
                
                    if (newHeight < 20) {
                        newHeight = 20;
                    if (maintainAspectRatio) {
                        newWidth = newHeight * aspectRatio;
                        if (isWest) {
                            newLeft = startLeft + (startWidth - newWidth);
                        }
                    }
                    if (isNorth) {
                        newTop = startTop + (startHeight - newHeight);
                    }
                }
                
                // Update the element dimensions and position
                element.style.width = `${newWidth}px`;
                element.style.height = `${newHeight}px`;
                element.style.left = `${newLeft}px`;
                element.style.top = `${newTop}px`;
                
                // Check if this is a canvas view or a clipped video
                if (elementInfo && elementInfo.isCanvasView) {
                    // Update the canvas dimensions
                    const canvas = element.querySelector('.video-canvas');
                    if (canvas) {
                        // Keep the same source coordinates but update the canvas size
                        const { x, y, width, height } = elementInfo.sourceCoords;
                        
                        // Draw the current video frame to the canvas with the new dimensions
                        drawVideoToCanvas(canvas, videoPlayer, x, y, width, height);
                    }
                }
                
                // Update the element info
                if (elementInfo) {
                    // Use viewport width/height for relative sizing and positioning
                    const viewportWidth = window.innerWidth;
                    const viewportHeight = window.innerHeight;
                    
                    elementInfo.position.left = newLeft / viewportWidth;
                    elementInfo.position.top = newTop / viewportHeight;
                    elementInfo.size.width = newWidth / viewportWidth;
                    elementInfo.size.height = newHeight / viewportHeight;
                    
                    // Update the corresponding mask position and size
                    updateMaskPosition(elementId, elementInfo.position.left, elementInfo.position.top, elementInfo.size.width, elementInfo.size.height);
                }
            }
            
            function stopResize() {
                document.removeEventListener('mousemove', resize);
                document.removeEventListener('mouseup', stopResize);
                document.removeEventListener('keydown', checkShiftKey);
                document.removeEventListener('keyup', checkShiftKey);
                
                // Remove active class and aspect ratio indication
                element.classList.remove('active-resize');
                element.classList.remove('preserving-ratio');
            }
            
            document.addEventListener('mousemove', resize);
            document.addEventListener('mouseup', stopResize);
        });
    });
}

/**
 * Synchronizes extracted elements with the video playback
 */
function syncExtractedElements() {
    const videoPlayer = elements.videoPlayer;
    if (!videoPlayer) return;
    
    const currentTime = videoPlayer.currentTime;
    const currentScene = findSceneAtTime(currentTime);
    
    // Check if we need to auto-extract elements for a new scene
    if (currentScene) {
        // Check if the scene has changed
        const sceneChanged = lastSceneIndex !== null && lastSceneIndex !== currentScene.index;
        
        // Update the last scene index
        lastSceneIndex = currentScene.index;
        
        // Get the mask container
        const maskContainer = document.getElementById('videoMaskContainer');
        
        // Check if we need to update masks for the current scene
        const needMaskUpdate = !maskContainer || 
                              !maskContainer.dataset.lastUpdatedScene || 
                              parseInt(maskContainer.dataset.lastUpdatedScene) !== currentScene.index;
        
        // Check if auto-extract is enabled
        const autoExtractToggle = document.getElementById('autoExtractElements');
        const shouldAutoExtract = autoExtractToggle && autoExtractToggle.checked;
        
        if (shouldAutoExtract && isLayerActive) {
            // Check if we already have elements for this scene
            const hasElementsForScene = extractedElements.some(el => el.sceneIndex === currentScene.index);
            
            // If we don't have elements for this scene yet, extract them
            if (!hasElementsForScene) {
                console.log(`New scene detected (index: ${currentScene.index}). Auto-extracting elements.`);
                extractAllElements();
                // Use setTimeout to avoid blocking the UI
                // setTimeout(() => {
                    
                // }, 100);
            } else if (sceneChanged || needMaskUpdate) {
                console.log(`Scene changed to scene ${currentScene.index}, elements already exist`);
                
                // Only update masks if we're in interactive mode
                if (isLayerActive) {
                    updateMasksForCurrentScene(currentScene.index);
                }
            }
        } else if (sceneChanged || needMaskUpdate) {
            // Even if auto-extract is disabled, we need to update masks when scene changes
            // but only if we're in interactive mode
            if (isLayerActive) {
                updateMasksForCurrentScene(currentScene.index);
            }
        }
    }
    
    // Update each extracted element
    extractedElements.forEach(elementInfo => {
        const elementContainer = document.getElementById(elementInfo.id);
        if (!elementContainer) return;
        
        // Check if we should show/hide based on scene
        if (currentScene) {
            // Show the element if it's from the current scene
            if (currentScene.index === elementInfo.sceneIndex) {
                elementContainer.style.display = 'block';
                
                // If this is a canvas view, update the canvas with the current video frame
                if (elementInfo.isCanvasView) {
                    const canvas = elementContainer.querySelector('.video-canvas');
                    if (canvas) {
                        // Get the source coordinates from the element info
                        const { x, y, width, height } = elementInfo.sourceCoords;
                        
                        // Draw the current video frame to the canvas
                        drawVideoToCanvas(canvas, videoPlayer, x, y, width, height);
                    }
                } else {
                    // This is a legacy clipped video element
                    const clippedVideo = elementContainer.querySelector('.clipped-video');
                    if (clippedVideo) {
                        // Sync the video time - use a larger threshold for seeking
                        // This prevents constant seeking which can cause performance issues
                        if (Math.abs(clippedVideo.currentTime - currentTime) > 0.5) {
                            try {
                                clippedVideo.currentTime = currentTime;
                            } catch (e) {
                                console.warn('Error syncing video time:', e);
                            }
                        }
                        
                        // Ensure the video is playing if the main video is playing
                        if (!videoPlayer.paused && clippedVideo.paused) {
                            try {
                                clippedVideo.play().catch(e => {
                                    console.warn('Error playing clipped video:', e);
                                });
                            } catch (e) {
                                console.warn('Error playing clipped video:', e);
                            }
                        } else if (videoPlayer.paused && !clippedVideo.paused) {
                            try {
                                clippedVideo.pause();
                            } catch (e) {
                                console.warn('Error pausing clipped video:', e);
                            }
                        }
                    }
                }
            } else {
                elementContainer.style.display = 'none';
                
                // If this is a legacy clipped video, pause it when not visible
                if (!elementInfo.isCanvasView) {
                    const clippedVideo = elementContainer.querySelector('.clipped-video');
                    if (clippedVideo && !clippedVideo.paused) {
                        try {
                            clippedVideo.pause();
                        } catch (e) {
                            console.warn('Error pausing clipped video:', e);
                        }
                    }
                }
            }
        }
    });
    
    // Highlight OCR elements related to the current transcript
    highlightTranscriptRelatedElements(currentTime, currentScene);
}

/**
 * Highlights OCR elements related to the currently active transcript
 * @param {number} currentTime - Current video playback time
 * @param {Object} currentScene - Current scene information
 */
function highlightTranscriptRelatedElements(currentTime, currentScene) {
    // Only proceed if highlighting is enabled and we have relationships and a current scene
    if (!state.showTranscriptHighlighting || 
        !state.transcript_to_ocr || 
        Object.keys(state.transcript_to_ocr).length === 0 || 
        !currentScene) {
        return;
    }
    
    // First, remove highlight from all text elements
    document.querySelectorAll('.extracted-video-element.transcript-related').forEach(element => {
        element.classList.remove('transcript-related');
    });
    
    // Find the current transcript based on time
    const currentTranscriptIndex = state.currentTranscript.findIndex((item, index) => {
        const currentStart = item.start;
        const nextStart = index < state.currentTranscript.length - 1 
            ? state.currentTranscript[index + 1].start 
            : currentStart + item.duration;
        return currentTime >= currentStart && currentTime < nextStart;
    });
    
    // If we found a transcript entry, highlight related OCR elements
    if (currentTranscriptIndex !== -1) {
        // Get the related OCR items
        const relatedOcr = state.transcript_to_ocr[currentTranscriptIndex];
        
        if (relatedOcr && relatedOcr.length > 0) {
            // Filter for OCR items in the current scene
            const currentSceneOcr = relatedOcr.filter(match => match.scene_index === currentScene.index);
            
            if (currentSceneOcr.length > 0) {
                console.log(`Found ${currentSceneOcr.length} OCR items related to transcript at index ${currentTranscriptIndex}`);
                
                // Add highlight to related elements in the current scene
                currentSceneOcr.forEach(match => {
                    // For each extracted element, check if it matches the OCR text
                    extractedElements.forEach(elementInfo => {
                        // Check if this is an OCR element that matches and is not a Title
                        if (elementInfo.sceneIndex === currentScene.index && 
                            elementInfo.ocrResult && 
                            elementInfo.ocrResult.text === match.text &&
                            (!elementInfo.ocrResult.ocr_class || elementInfo.ocrResult.ocr_class !== 'title')) {  // Exclude Title elements
                            
                            // Find the DOM element and add highlight class
                            const element = document.getElementById(elementInfo.id);
                            if (element) {
                                element.classList.add('transcript-related');
                                console.log(`Highlighted element ${elementInfo.id} with text "${match.text}" related to transcript`);
                            }
                        }
                    });
                });
            }
        }
    }
}

/**
 * Updates masks for the current scene
 * @param {number} sceneIndex - The current scene index
 */
function updateMasksForCurrentScene(sceneIndex) {
    // Don't update masks if we're not in interactive mode
    if (!isLayerActive) {
        console.log('Skipping mask update - not in interactive mode');
        return;
    }

    console.log(`Updating masks for scene ${sceneIndex}`);
    
    // Get the mask container
    const maskContainer = document.getElementById('videoMaskContainer');
    if (!maskContainer) return;
    
    // Make sure the mask container is visible
    maskContainer.style.display = 'block';
    
    // Clear all masks
    maskContainer.innerHTML = '';
    
    // Get elements for the current scene
    const sceneElements = extractedElements.filter(el => el.sceneIndex === sceneIndex);
    
    if (sceneElements.length === 0) {
        console.log(`No elements found for scene ${sceneIndex}`);
        return;
    }
    
    console.log(`Found ${sceneElements.length} elements for scene ${sceneIndex}`);
    
    // Get the video player
    const videoPlayer = elements.videoPlayer;
    if (!videoPlayer) return;
    
    // Create masks for each element in the current scene
    sceneElements.forEach(elementInfo => {
        const element = document.getElementById(elementInfo.id);
        if (!element) return;
        
        // Get the original source coordinates for this element
        const { x, y, width, height } = elementInfo.sourceCoords;
        
        // Calculate the average color of the surrounding pixels
        const avgColor = calculateSurroundingAverageColor(videoPlayer, x, y, width, height);
        
        // Create a mask element
        const mask = document.createElement('div');
        mask.className = 'video-element-mask';
        mask.dataset.elementId = elementInfo.id; // Store the element ID for later reference
        mask.dataset.sceneIndex = sceneIndex; // Store the scene index for reference
        
        // Use the original position and size from sourceCoords
        const originalLeft = x / videoPlayer.videoWidth;
        const originalTop = y / videoPlayer.videoHeight;
        const originalWidth = width / videoPlayer.videoWidth;
        const originalHeight = height / videoPlayer.videoHeight;
        
        // Store original position and size in the mask's dataset
        mask.dataset.originalLeft = originalLeft;
        mask.dataset.originalTop = originalTop;
        mask.dataset.originalWidth = originalWidth;
        mask.dataset.originalHeight = originalHeight;
        
        // Position the mask at the original position
        mask.style.position = 'absolute';
        mask.style.left = `${originalLeft * 100}%`;
        mask.style.top = `${originalTop * 100}%`;
        mask.style.width = `${originalWidth * 100}%`;
        mask.style.height = `${originalHeight * 100}%`;
        
        // Use the average color instead of semi-transparent black
        mask.style.backgroundColor = avgColor;
        mask.style.pointerEvents = 'none';
        
        // Add the mask to the container
        maskContainer.appendChild(mask);
        
        console.log(`Created mask for element ${elementInfo.id} with color ${avgColor} at original position`);
    });
    
    // Store the last updated scene index to avoid unnecessary updates
    maskContainer.dataset.lastUpdatedScene = sceneIndex;
}

/**
 * Deletes an extracted element
 * @param {string} elementId - The ID of the element to delete
 */
function deleteElement(elementId) {
    console.log(`Deleting element ${elementId}`);
    
    // Find the element in the array
    const elementIndex = extractedElements.findIndex(el => el.id === elementId);
    
    if (elementIndex === -1) {
        console.warn(`Element ${elementId} not found in extractedElements array`);
        return;
    }
    
    // Get the element info
    const elementInfo = extractedElements[elementIndex];
    
    // Remove the element from the DOM
    const element = document.getElementById(elementId);
    if (element) {
        element.remove();
    }
    
    // Remove the element from the array
    extractedElements.splice(elementIndex, 1);
    
    // If this was the active element, clear the active element
    if (activeElement === elementId) {
        activeElement = null;
    }
    
    // Remove the corresponding mask
    const maskContainer = document.getElementById('videoMaskContainer');
    if (maskContainer && elementInfo) {
        // Find the mask that corresponds to this element's position
        const masks = maskContainer.querySelectorAll('.video-element-mask');
        masks.forEach(mask => {
            // Compare positions to find the matching mask
            if (mask.style.left === `${elementInfo.position.left * 100}%` && 
                mask.style.top === `${elementInfo.position.top * 100}%` &&
                mask.style.width === `${elementInfo.size.width * 100}%` &&
                mask.style.height === `${elementInfo.size.height * 100}%`) {
                mask.remove();
            }
        });
    }
    
    // Show notification
    showNotification('Element deleted', 'success');
}

/**
 * Toggles the lock state of an element
 * @param {string} elementId - The ID of the element to toggle
 */
function toggleElementLock(elementId) {
    // Find the element info
    const elementInfo = extractedElements.find(el => el.id === elementId);
    if (!elementInfo) return;
    
    // Toggle the lock state
    elementInfo.isLocked = !elementInfo.isLocked;
    
    // Update the UI
    const element = document.getElementById(elementId);
    if (element) {
        const lockBtn = element.querySelector('.lock-element-btn');
        if (lockBtn) {
            const icon = lockBtn.querySelector('i');
            if (elementInfo.isLocked) {
                icon.className = 'fas fa-lock';
                element.classList.add('locked');
            } else {
                icon.className = 'fas fa-lock-open';
                element.classList.remove('locked');
            }
        }
    }
    
    // Show notification
    showNotification(
        elementInfo.isLocked ? 'Element locked' : 'Element unlocked', 
        'info'
    );
}

/**
 * Sets the active element
 * @param {string} elementId - The ID of the element to set as active
 */
function setActiveElement(elementId) {
    // Remove active class from all elements
    document.querySelectorAll('.extracted-video-element').forEach(el => {
        el.classList.remove('active');
    });
    
    // Add active class to the selected element
    const element = document.getElementById(elementId);
    if (element) {
        element.classList.add('active');
    }
    
    // Update the active element reference
    activeElement = elementId;
}

/**
 * Clears all extracted elements
 */
function clearAllElements() {
    console.log('Clearing all extracted elements');
    
    // Remove all extracted elements from the DOM
    extractedElements.forEach(elementInfo => {
        const element = document.getElementById(elementInfo.id);
        if (element) {
            element.remove();
        }
    });
    
    // Clear the extracted elements array
    extractedElements.length = 0;
    
    // Clear the active element
    activeElement = null;
    
    // Clear all masks
    const maskContainer = document.getElementById('videoMaskContainer');
    if (maskContainer) {
        maskContainer.innerHTML = '';
    }
    
    // Show notification
    showNotification('All elements cleared', 'success');
}

/**
 * Toggles the display of bounding boxes
 */
function toggleBoundingBoxes() {
    const showBoxes = document.getElementById('showBoundingBoxes').checked;
    
    // Update all extracted elements
    document.querySelectorAll('.extracted-video-element').forEach(el => {
        if (showBoxes) {
            el.style.border = '2px solid rgba(0, 255, 0, 0.7)';
            
            // Also show resize handles
            const handles = el.querySelectorAll('.resize-handle');
            handles.forEach(handle => {
                handle.style.display = 'block';
            });
        } else {
            el.style.border = 'none';
            
            // Also hide resize handles
            const handles = el.querySelectorAll('.resize-handle');
            handles.forEach(handle => {
                handle.style.display = 'none';
            });
        }
    });
    
    // Store the preference in state
    if (state) {
        state.showBoundingBoxes = showBoxes;
    }
    
    // Show notification
    showNotification(showBoxes ? 'Showing element borders' : 'Hiding element borders', 'info');
}

/**
 * Shows a notification message
 * @param {string} message - The message to display
 * @param {string} type - The notification type (success, error, info, warning)
 */
function showNotification(message, type = 'info') {
    // Create notification element
    // const notification = document.createElement('div');
    // notification.className = `notification ${type}`;
    // notification.textContent = message;
    
    // // Add to document
    // document.body.appendChild(notification);
    
    // // Show notification
    // setTimeout(() => {
    //     notification.style.opacity = '1';
    // }, 10);
    
    // // Hide and remove after 5 seconds
    // setTimeout(() => {
    //     notification.style.opacity = '0';
    //     setTimeout(() => {
    //         notification.remove();
    //     }, 300);
    // }, 5000);
}

/**
 * Sets up a direct event listener on the video detection overlay
 */
function setupVideoDetectionOverlayListener() {
    // We need to wait for the DOM to be fully loaded
    document.addEventListener('DOMContentLoaded', () => {
        // Try to find the overlay
        let videoDetectionOverlay = document.getElementById('videoDetectionOverlay');
        
        // If it doesn't exist yet, we'll set up a mutation observer to watch for it
        if (!videoDetectionOverlay) {
            console.log('Video detection overlay not found, setting up observer');
            
            const observer = new MutationObserver((mutations, obs) => {
                const overlay = document.getElementById('videoDetectionOverlay');
                if (overlay) {
                    console.log('Video detection overlay found, adding click listener');
                    addOverlayClickListener(overlay);
                    obs.disconnect(); // Stop observing once we've found it
                }
            });
            
            // Start observing the document body for changes
            observer.observe(document.body, {
                childList: true,
                subtree: true
            });
        } else {
            console.log('Video detection overlay found, adding click listener');
            addOverlayClickListener(videoDetectionOverlay);
        }
    });
    
    // Also try to add the listener now in case the DOM is already loaded
    const overlay = document.getElementById('videoDetectionOverlay');
    if (overlay) {
        console.log('Video detection overlay found immediately, adding click listener');
        addOverlayClickListener(overlay);
    }
}

/**
 * Adds a click listener to the video detection overlay
 * @param {HTMLElement} overlay - The video detection overlay element
 */
function addOverlayClickListener(overlay) {
    overlay.addEventListener('click', (e) => {
        // Only process clicks when in selection mode
        if (!isLayerActive || !overlay.classList.contains('selection-mode')) {
            return;
        }
        
        // Check if we clicked on a detection box
        let target = e.target;
        
        // If we clicked directly on the overlay, check if there's a box at this position
        if (target === overlay) {
            console.log('Clicked on overlay, checking for boxes at this position');
            
            // Get all detection boxes
            const boxes = overlay.querySelectorAll('.video-detection-box');
            
            // Check if any box contains the click position
            for (const box of boxes) {
                const rect = box.getBoundingClientRect();
                if (e.clientX >= rect.left && e.clientX <= rect.right &&
                    e.clientY >= rect.top && e.clientY <= rect.bottom) {
                    console.log('Found box at click position');
                    target = box;
                    break;
                }
            }
        }
        
        // If we found a detection box, extract it
        if (target.classList && target.classList.contains('video-detection-box')) {
            console.log('Clicked on detection box, extracting');
            e.stopPropagation();
            extractElementFromBox(target);
        }
    });
}

/**
 * Resets detection boxes to non-selectable
 */
function resetDetectionBoxesSelectable() {
    // Remove the selection mode class from the overlay
    const videoDetectionOverlay = document.getElementById('videoDetectionOverlay');
    if (videoDetectionOverlay) {
        videoDetectionOverlay.classList.remove('selection-mode');
        videoDetectionOverlay.style.removeProperty('pointer-events');
        videoDetectionOverlay.onclick = null;
    }
    
    // Reset all detection boxes
    const detectionBoxes = document.querySelectorAll('.video-detection-box');
    
    detectionBoxes.forEach(box => {
        box.style.removeProperty('pointer-events');
        box.style.removeProperty('cursor');
        box.style.removeProperty('z-index');
        box.classList.remove('selectable');
        
        // Remove click events
        box.onclick = null;
        box.onmousedown = null;
    });
    
    // Remove the video click handler
    const videoClickHandler = document.getElementById('videoClickHandler');
    if (videoClickHandler) {
        videoClickHandler.remove();
    }
    
    // Remove any non-interactive areas
    const nonInteractiveAreas = document.querySelectorAll('.non-interactive-area');
    nonInteractiveAreas.forEach(area => area.remove());
    
    // Clear the interval
    if (window.boxCheckInterval) {
        clearInterval(window.boxCheckInterval);
        window.boxCheckInterval = null;
    }
}

/**
 * Creates a virtual detection box from detection data
 * @param {Object} detection - The detection data
 * @param {HTMLVideoElement} videoPlayer - The video player element
 * @returns {Object} - A virtual detection box with necessary properties
 */
function createVirtualDetectionBox(detection, videoPlayer) {
    const videoRect = videoPlayer.getBoundingClientRect();
    const [x1, y1, x2, y2] = detection.bbox;
    
    // Calculate relative coordinates (0-1)
    const relativeX1 = x1 / videoPlayer.videoWidth;
    const relativeY1 = y1 / videoPlayer.videoHeight;
    const relativeX2 = x2 / videoPlayer.videoWidth;
    const relativeY2 = y2 / videoPlayer.videoHeight;
    
    // Calculate pixel coordinates relative to the displayed video
    const pixelX1 = relativeX1 * videoRect.width + videoRect.left;
    const pixelY1 = relativeY1 * videoRect.height + videoRect.top;
    const pixelX2 = relativeX2 * videoRect.width + videoRect.left;
    const pixelY2 = relativeY2 * videoRect.height + videoRect.top;
    
    // Create a virtual box with the necessary properties
    const virtualBox = {
        getBoundingClientRect: () => ({
            left: pixelX1,
            top: pixelY1,
            right: pixelX2,
            bottom: pixelY2,
            width: pixelX2 - pixelX1,
            height: pixelY2 - pixelY1
        }),
        classList: {
            contains: (className) => {
                if (className === 'video-detection-box') {
                    return true;
                } else if (className === 'video-text-detection') {
                    // Check if this is a text detection
                    return detection.class.toLowerCase().includes('text') || 
                           ['title', 'page-text', 'other-text', 'caption'].includes(detection.class.toLowerCase());
                } else if (className === 'video-unmatched-detection') {
                    return false; // This is a YOLO detection, not an unmatched OCR detection
                }
                return false;
            }
        },
        // Store the original detection data for reference
        detection: detection
    };
    
    return virtualBox;
}

/**
 * Creates a virtual detection box from unmatched OCR data
 * @param {Object} ocrResult - The OCR result data
 * @param {HTMLVideoElement} videoPlayer - The video player element
 * @returns {Object} - A virtual detection box with necessary properties
 */
function createVirtualOCRBox(ocrResult, videoPlayer) {
    const videoRect = videoPlayer.getBoundingClientRect();
    const [x1, y1, x2, y2] = ocrResult.bbox;
    
    // Calculate relative coordinates (0-1)
    const relativeX1 = x1 / videoPlayer.videoWidth;
    const relativeY1 = y1 / videoPlayer.videoHeight;
    const relativeX2 = x2 / videoPlayer.videoWidth;
    const relativeY2 = y2 / videoPlayer.videoHeight;
    
    // Calculate pixel coordinates relative to the displayed video
    const pixelX1 = relativeX1 * videoRect.width + videoRect.left;
    const pixelY1 = relativeY1 * videoRect.height + videoRect.top;
    const pixelX2 = relativeX2 * videoRect.width + videoRect.left;
    const pixelY2 = relativeY2 * videoRect.height + videoRect.top;
    
    // Create a virtual box with the necessary properties
    const virtualBox = {
        getBoundingClientRect: () => ({
            left: pixelX1,
            top: pixelY1,
            right: pixelX2,
            bottom: pixelY2,
            width: pixelX2 - pixelX1,
            height: pixelY2 - pixelY1
        }),
        classList: {
            contains: (className) => {
                if (className === 'video-detection-box') {
                    return true;
                } else if (className === 'video-text-detection') {
                    return true; // OCR results are always text
                } else if (className === 'video-unmatched-detection') {
                    return true; // This is an unmatched OCR detection
                }
                return false;
            }
        },
        // Store the original OCR data for reference
        ocrResult: ocrResult
    };
    
    return virtualBox;
}

/**
 * Extracts all detected elements at once
 */
function extractAllElements() {
    console.log('Extracting all detected elements');
    
    // Store the video's playing state
    const videoPlayer = elements.videoPlayer;
    const wasPlaying = !videoPlayer.paused;
    
    // Pause the video during extraction
    if (wasPlaying) {
        try {
            videoPlayer.pause();
        } catch (e) {
            console.warn('Error pausing video:', e);
        }
    }
    
    // Get the current scene
    const currentTime = videoPlayer.currentTime;
    const currentScene = findSceneAtTime(currentTime);
    
    if (!currentScene) {
        console.warn('Could not identify the current scene');
        showNotification('Could not identify the current scene', 'error');
        
        // Resume playback if it was playing
        if (wasPlaying) {
            setTimeout(() => {
                try {
                    videoPlayer.play().catch(e => console.warn('Error resuming video playback:', e));
                } catch (e) {
                    console.warn('Error resuming video playback:', e);
                }
            }, 100);
        }
        
        return;
    }
    
    // Check if we already have elements for this scene
    const hasElementsForScene = extractedElements.some(el => el.sceneIndex === currentScene.index);
    
    // If we already have elements for this scene, don't extract again
    if (hasElementsForScene) {
        console.log(`Elements already exist for scene ${currentScene.index}, skipping extraction`);
        
        // Resume playback if it was playing
        if (wasPlaying) {
            setTimeout(() => {
                try {
                    videoPlayer.play().catch(e => console.warn('Error resuming video playback:', e));
                } catch (e) {
                    console.warn('Error resuming video playback:', e);
                }
            }, 100);
        }
        
        return;
    }
    
    // Create a mask container if it doesn't exist
    let maskContainer = document.getElementById('videoMaskContainer');
    if (!maskContainer) {
        maskContainer = document.createElement('div');
        maskContainer.id = 'videoMaskContainer';
        maskContainer.style.position = 'absolute';
        maskContainer.style.top = '0';
        maskContainer.style.left = '0';
        maskContainer.style.width = '100%';
        maskContainer.style.height = '100%';
        maskContainer.style.pointerEvents = 'none';
        maskContainer.style.zIndex = '50'; // Between video and interactive layer
        
        // Add the mask container to the video container
        const videoContainer = document.querySelector('.video-wrapper');
        if (videoContainer) {
            videoContainer.appendChild(maskContainer);
        }
    }
    
    // Create virtual detection boxes from scene data
    const virtualDetectionBoxes = [];
    
    // Add YOLO detections if available
    if (currentScene.yolo_detections && currentScene.yolo_detections.success) {
        currentScene.yolo_detections.detections.forEach(detection => {
            virtualDetectionBoxes.push(createVirtualDetectionBox(detection, videoPlayer));
        });
    }
    
    // Add unmatched OCR detections if available
    if (currentScene.surya_ocr && currentScene.surya_ocr.success) {
        currentScene.surya_ocr.results.forEach(result => {
            if (!result.matched && result.text && result.text.trim() && result.bbox && result.bbox.length === 4) {
                virtualDetectionBoxes.push(createVirtualOCRBox(result, videoPlayer));
            }
        });
    }
    
    if (virtualDetectionBoxes.length === 0) {
        console.warn('No detections found in the current scene');
        showNotification('No detections found in the current scene', 'warning');
        
        // Resume playback if it was playing
        if (wasPlaying) {
            setTimeout(() => {
                try {
                    videoPlayer.play().catch(e => console.warn('Error resuming video playback:', e));
                } catch (e) {
                    console.warn('Error resuming video playback:', e);
                }
            }, 100);
        }
        
        return;
    }
    
    console.log(`Found ${virtualDetectionBoxes.length} detections in the current scene`);
    
    // Extract each virtual box
    let extractedCount = 0;
    virtualDetectionBoxes.forEach((box, index) => {
        // Check if this box should be extracted based on config
        const isTextElement = box.classList.contains('video-text-detection');
        const isUnmatchedText = box.classList.contains('video-unmatched-detection');
        
        // Skip if it's a text element and text elements are disabled
        if (isTextElement && !autoExtractConfig.textElements) {
            console.log(`Skipping text element ${index} (disabled in config)`);
            return;
        }
        
        // Skip if it's an unmatched text element and unmatched text is disabled
        if (isUnmatchedText && !autoExtractConfig.unmatchedText) {
            console.log(`Skipping unmatched text ${index} (disabled in config)`);
            return;
        }
        
        // Skip if it's not a text or unmatched element and other elements are disabled
        if (!isTextElement && !isUnmatchedText && !autoExtractConfig.otherElements) {
            console.log(`Skipping non-text element ${index} (disabled in config)`);
            return;
        }
        
        // Extract the element and get the element info
        const elementInfo = extractElementFromBox(box);
        
        if (elementInfo) {
            // The mask is already created in extractElementFromBox
            extractedCount++;
        }
    });
    
    // Resume playback if it was playing
    if (wasPlaying) {
        setTimeout(() => {
            try {
                videoPlayer.play().catch(e => console.warn('Error resuming video playback:', e));
            } catch (e) {
                console.warn('Error resuming video playback:', e);
            }
        }, 100);
    }
    
    // Show notification
    if (extractedCount > 0) {
        showNotification(`Extracted ${extractedCount} elements`, 'success');
    } else {
        showNotification('No elements were extracted', 'warning');
    }
}

/**
 * Creates a mask for a detection box
 * @param {HTMLElement} box - The detection box element
 * @param {HTMLElement} maskContainer - The container for masks
 * @param {string} [elementId] - Optional element ID to associate with the mask
 */
function createMaskForBox(box, maskContainer, elementId) {
    const videoPlayer = elements.videoPlayer;
    const videoRect = videoPlayer.getBoundingClientRect();
    const boxRect = box.getBoundingClientRect();
    
    // Calculate position relative to the video
    const relativeLeft = (boxRect.left - videoRect.left) / videoRect.width;
    const relativeTop = (boxRect.top - videoRect.top) / videoRect.height;
    const relativeWidth = boxRect.width / videoRect.width;
    const relativeHeight = boxRect.height / videoRect.height;
    
    // Calculate the source coordinates in the video
    const sourceX = Math.floor(videoPlayer.videoWidth * relativeLeft);
    const sourceY = Math.floor(videoPlayer.videoHeight * relativeTop);
    const sourceWidth = Math.floor(videoPlayer.videoWidth * relativeWidth);
    const sourceHeight = Math.floor(videoPlayer.videoHeight * relativeHeight);
    
    // Calculate the average color of the surrounding pixels
    const avgColor = calculateSurroundingAverageColor(
        videoPlayer, sourceX, sourceY, sourceWidth, sourceHeight
    );
    
    // Create a mask element
    const mask = document.createElement('div');
    mask.className = 'video-element-mask';
    if (elementId) {
        mask.dataset.elementId = elementId; // Store the element ID for later reference
    }
    
    // Store the original position and size
    mask.dataset.originalLeft = relativeLeft;
    mask.dataset.originalTop = relativeTop;
    mask.dataset.originalWidth = relativeWidth;
    mask.dataset.originalHeight = relativeHeight;
    
    // Position the mask
    mask.style.position = 'absolute';
    mask.style.left = `${relativeLeft * 100}%`;
    mask.style.top = `${relativeTop * 100}%`;
    mask.style.width = `${relativeWidth * 100}%`;
    mask.style.height = `${relativeHeight * 100}%`;
    
    // Use the average color instead of semi-transparent black
    mask.style.backgroundColor = avgColor;
    mask.style.pointerEvents = 'none';
    
    // Add the mask to the container
    maskContainer.appendChild(mask);
    
    return mask;
}

/**
 * Updates the "Extract All" button style based on auto-extract state
 * @param {boolean} isAutoExtractEnabled - Whether auto-extract is enabled
 */
function updateExtractAllButtonStyle(isAutoExtractEnabled) {
    const extractAllBtn = document.getElementById('extractAllBtn');
    if (extractAllBtn) {
        if (isAutoExtractEnabled) {
            extractAllBtn.classList.add('auto-active');
            extractAllBtn.title = 'Auto-extraction is enabled';
        } else {
            extractAllBtn.classList.remove('auto-active');
            extractAllBtn.title = 'Extract all detected elements';
        }
    }
}

/**
 * Calculates the average color of the surrounding pixels of a region
 * @param {HTMLVideoElement} video - The video element
 * @param {number} x - The x coordinate of the region
 * @param {number} y - The y coordinate of the region
 * @param {number} width - The width of the region
 * @param {number} height - The height of the region
 * @param {number} padding - The padding around the region to sample
 * @returns {string} - The CSS color string
 */
function calculateSurroundingAverageColor(video, x, y, width, height, padding = 10) {
    // Create a temporary canvas to sample the video frame
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { alpha: false });
    
    // Set canvas size to the video size
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    // Draw the current video frame to the canvas
    try {
        ctx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
    } catch (e) {
        console.warn('Error drawing video to canvas for color sampling:', e);
        return 'rgb(128, 128, 128)'; // Default gray if we can't sample
    }
    
    // Define the regions to sample (top, right, bottom, left)
    const regions = [
        // Top region
        {
            sx: Math.max(0, x - padding),
            sy: Math.max(0, y - padding),
            sw: width + padding * 2,
            sh: padding
        },
        // Right region
        {
            sx: Math.min(video.videoWidth, x + width),
            sy: Math.max(0, y - padding),
            sw: padding,
            sh: height + padding * 2
        },
        // Bottom region
        {
            sx: Math.max(0, x - padding),
            sy: Math.min(video.videoHeight, y + height),
            sw: width + padding * 2,
            sh: padding
        },
        // Left region
        {
            sx: Math.max(0, x - padding),
            sy: Math.max(0, y - padding),
            sw: padding,
            sh: height + padding * 2
        }
    ];
    
    // Filter regions to ensure they're within the video bounds
    const validRegions = regions.filter(r => 
        r.sx >= 0 && r.sy >= 0 && 
        r.sx + r.sw <= video.videoWidth && 
        r.sy + r.sh <= video.videoHeight &&
        r.sw > 0 && r.sh > 0
    );
    
    if (validRegions.length === 0) {
        return 'rgb(128, 128, 128)'; // Default gray if no valid regions
    }
    
    // Sample pixels from each region and calculate the average color
    let totalR = 0, totalG = 0, totalB = 0;
    let totalPixels = 0;
    
    validRegions.forEach(region => {
        try {
            const imageData = ctx.getImageData(region.sx, region.sy, region.sw, region.sh, { willReadFrequently: true });
            const data = imageData.data;
            
            for (let i = 0; i < data.length; i += 4) {
                totalR += data[i];
                totalG += data[i + 1];
                totalB += data[i + 2];
                totalPixels++;
            }
        } catch (e) {
            console.warn('Error sampling pixels:', e);
        }
    });
    
    if (totalPixels === 0) {
        return 'rgb(128, 128, 128)'; // Default gray if no pixels sampled
    }
    
    // Calculate the average color
    const avgR = Math.round(totalR / totalPixels);
    const avgG = Math.round(totalG / totalPixels);
    const avgB = Math.round(totalB / totalPixels);
    
    return `rgb(${avgR}, ${avgG}, ${avgB})`;
} 

/**
 * Highlights transcript segments related to an OCR element
 * @param {Object} elementInfo - The element information
 */
function highlightTranscriptSegmentsForOcr(elementInfo) {
    console.log('highlightTranscriptSegmentsForOcr', elementInfo);
    // Only proceed if we have OCR text and relationships
    if (!elementInfo.ocrResult || !elementInfo.ocrResult.text || !state.ocr_to_transcript) {
        return;
    }

    // First, remove highlight from all transcript lines
    document.querySelectorAll('.transcript-line.transcript-related').forEach(line => {
        line.classList.remove('transcript-related');
    });

    // Create key for lookup using scene index and OCR text
    const key = `${elementInfo.sceneIndex}_${elementInfo.ocrResult.text}`;
    const relatedTranscript = state.ocr_to_transcript[key];

    if (relatedTranscript && relatedTranscript.length > 0) {
        console.log(`Found ${relatedTranscript.length} transcript matches for OCR text "${elementInfo.ocrResult.text}"`);

        // Get all transcript lines
        const transcriptLines = document.querySelectorAll('.transcript-line');

        // Highlight each related transcript segment
        relatedTranscript.forEach(match => {
            const transcriptIndex = match.transcript_index;
            if (transcriptIndex >= 0 && transcriptIndex < transcriptLines.length) {
                const line = transcriptLines[transcriptIndex];
                line.classList.add('transcript-related');
                
                // Scroll the first match into view
                if (match === relatedTranscript[0]) {
                    line.scrollIntoView({
                        behavior: 'smooth',
                        block: 'center'
                    });
                }
                
                console.log(`Highlighted transcript line ${transcriptIndex} with text "${match.text}"`);
            }
        });
    }
}