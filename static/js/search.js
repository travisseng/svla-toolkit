// search.js - Search functionality

import { elements } from './elements.js';
import { state } from './main.js';
import { updateTranscriptDisplay } from './transcript.js';
import { findFuzzyMatches, highlightFuzzyMatch } from './fuzzy.js';

/**
 * Sets up the transcript search functionality
 */
export function setupSearch() {
    const searchInput = elements.transcriptSearch;
    const clearBtn = elements.clearSearchBtn;
    const prevBtn = elements.prevSearchBtn;
    const nextBtn = elements.nextSearchBtn;
    
    // Show/hide clear button based on input
    searchInput.addEventListener('input', () => {
        const hasText = searchInput.value.trim().length > 0;
        clearBtn.classList.toggle('visible', hasText);
        
        if (hasText) {
            performSearch(searchInput.value);
        } else {
            clearSearch();
        }
    });
    
    // Clear search
    clearBtn.addEventListener('click', () => {
        searchInput.value = '';
        clearBtn.classList.remove('visible');
        clearSearch();
        searchInput.focus();
    });
    
    // Navigate through results
    prevBtn.addEventListener('click', () => {
        navigateSearch(-1);
    });
    
    nextBtn.addEventListener('click', () => {
        navigateSearch(1);
    });
    
    // Search on Enter key
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            if (state.searchResults.length > 0) {
                navigateSearch(1);
            } else {
                performSearch(searchInput.value);
            }
        }
    });
}

/**
 * Performs a search in the transcript
 * @param {string} query - The search query
 */
export function performSearch(query) {
    // Clear previous results
    clearSearchHighlights();
    clearSearchResultMarkers();
    
    if (!query || query.trim() === '' || !state.currentTranscript || state.currentTranscript.length === 0) {
        updateSearchResultsCount(0, 0);
        elements.prevSearchBtn.disabled = true;
        elements.nextSearchBtn.disabled = true;
        return;
    }
    
    query = query.trim();
    state.searchResults = [];
    state.currentSearchIndex = -1;
    
    // Search through transcript lines
    const transcriptLines = document.querySelectorAll('.transcript-line');
    
    transcriptLines.forEach((line, lineIndex) => {
        const textElement = line.querySelector('.transcript-text');
        if (!textElement) return;
        
        const text = textElement.textContent;
        
        if (state.fuzzySearchEnabled && query.length >= 2) {
            // Perform fuzzy search
            const matches = findFuzzyMatches(text, query);
            
            if (matches.length > 0) {
                // Add each match as a separate result
                matches.forEach(match => {
                    state.searchResults.push({
                        lineElement: line,
                        textElement: textElement,
                        lineIndex: lineIndex,
                        startIndex: match.startIndex,
                        endIndex: match.endIndex,
                        score: match.score,
                        matchPositions: match.matchPositions,
                        isFuzzy: true
                    });
                });
            }
        } else {
            // Perform exact search (case insensitive)
            const lowerText = text.toLowerCase();
            const lowerQuery = query.toLowerCase();
            let startIndex = 0;
            let index;
            
            // Find all occurrences of the query in this line
            while ((index = lowerText.indexOf(lowerQuery, startIndex)) !== -1) {
                state.searchResults.push({
                    lineElement: line,
                    textElement: textElement,
                    lineIndex: lineIndex,
                    startIndex: index,
                    endIndex: index + query.length,
                    score: 1.0,
                    isFuzzy: false
                });
                startIndex = index + 1;
            }
        }
    });
    
    // Sort results by score (highest first) if fuzzy search is enabled
    if (state.fuzzySearchEnabled) {
        state.searchResults.sort((a, b) => b.score - a.score);
    }
    
    // Highlight all results
    state.searchResults.forEach((result, index) => {
        const textElement = result.textElement;
        
        if (result.isFuzzy && result.matchPositions) {
            // Use specialized fuzzy highlighting
            highlightFuzzyMatch(textElement, [result], index);
        } else {
            // Standard highlighting for exact matches
            const text = textElement.textContent;
            const beforeMatch = text.substring(0, result.startIndex);
            const match = text.substring(result.startIndex, result.endIndex);
            const afterMatch = text.substring(result.endIndex);
            
            // Create a span with the highlighted text
            const highlightSpan = document.createElement('span');
            highlightSpan.className = 'search-highlight';
            highlightSpan.dataset.resultIndex = index;
            highlightSpan.textContent = match;
            
            // Replace the text content with the highlighted version
            textElement.innerHTML = '';
            textElement.appendChild(document.createTextNode(beforeMatch));
            textElement.appendChild(highlightSpan);
            textElement.appendChild(document.createTextNode(afterMatch));
        }
    });
    
    // Add search result markers to the timeline and progress bar
    addSearchResultMarkersToTimeline();
    
    // Update UI
    updateSearchResultsCount(0, state.searchResults.length);
    elements.prevSearchBtn.disabled = state.searchResults.length === 0;
    elements.nextSearchBtn.disabled = state.searchResults.length === 0;
    
    // If we have results, navigate to the first one
    if (state.searchResults.length > 0) {
        navigateSearch(1);
    }
}

/**
 * Navigates through search results
 * @param {number} direction - The direction to navigate (1 for next, -1 for previous)
 */
export function navigateSearch(direction) {
    if (state.searchResults.length === 0) return;
    
    // Remove active class from current result
    if (state.currentSearchIndex >= 0 && state.currentSearchIndex < state.searchResults.length) {
        const currentHighlight = document.querySelector(`.search-highlight[data-result-index="${state.currentSearchIndex}"]`);
        if (currentHighlight) {
            currentHighlight.classList.remove('active');
        }
        
        // Remove active class from current marker
        const currentMarker = document.querySelector(`.search-result-marker[data-result-index="${state.currentSearchIndex}"]`);
        if (currentMarker) {
            currentMarker.classList.remove('active');
        }
        
        // Remove active class from timeline indicator
        const currentIndicator = document.querySelector(`.search-indicator[data-result-index="${state.currentSearchIndex}"]`);
        if (currentIndicator) {
            currentIndicator.classList.remove('active');
        }
    }
    
    // Calculate new index with wrapping
    state.currentSearchIndex = (state.currentSearchIndex + direction) % state.searchResults.length;
    if (state.currentSearchIndex < 0) state.currentSearchIndex = state.searchResults.length - 1;
    
    // Highlight new current result
    const newHighlight = document.querySelector(`.search-highlight[data-result-index="${state.currentSearchIndex}"]`);
    if (newHighlight) {
        newHighlight.classList.add('active');
        
        // Highlight corresponding marker
        const newMarker = document.querySelector(`.search-result-marker[data-result-index="${state.currentSearchIndex}"]`);
        if (newMarker) {
            newMarker.classList.add('active');
        }
        
        // Highlight corresponding timeline indicator
        const newIndicator = document.querySelector(`.search-indicator[data-result-index="${state.currentSearchIndex}"]`);
        if (newIndicator) {
            newIndicator.classList.add('active');
        }
        
        // Scroll to the result
        const result = state.searchResults[state.currentSearchIndex];
        result.lineElement.scrollIntoView({
            behavior: 'smooth',
            block: 'center'
        });
        
        // Jump to the timestamp in the video
        const lineIndex = result.lineIndex;
        if (lineIndex >= 0 && lineIndex < state.currentTranscript.length) {
            const time = parseFloat(state.currentTranscript[lineIndex].start);
            if (!isNaN(time)) {
                elements.videoPlayer.currentTime = time;
            }
        }
    }
    
    // Update counter
    updateSearchResultsCount(state.currentSearchIndex + 1, state.searchResults.length);
}

/**
 * Clears the search results
 */
export function clearSearch() {
    clearSearchHighlights();
    clearSearchResultMarkers();
    state.searchResults = [];
    state.currentSearchIndex = -1;
    updateSearchResultsCount(0, 0);
    elements.prevSearchBtn.disabled = true;
    elements.nextSearchBtn.disabled = true;
}

/**
 * Clears search highlights from the transcript
 */
export function clearSearchHighlights() {
    // Restore original text content for all transcript lines
    const transcriptLines = document.querySelectorAll('.transcript-line');
    
    transcriptLines.forEach((line, index) => {
        const textElement = line.querySelector('.transcript-text');
        if (!textElement) return;
        
        // If there are highlights, remove them and restore original text
        if (textElement.querySelector('.search-highlight')) {
            const originalText = textElement.textContent;
            textElement.innerHTML = originalText;
        }
    });
}

/**
 * Adds search result markers to the timeline and progress bar
 */
export function addSearchResultMarkersToTimeline() {
    // Clear any existing markers first
    clearSearchResultMarkers();
    
    if (state.searchResults.length === 0) return;
    
    // Get unique timestamps from search results
    const timestamps = new Set();
    const timestampToResultIndex = {};
    
    state.searchResults.forEach((result, index) => {
        const lineIndex = result.lineIndex;
        if (lineIndex >= 0 && lineIndex < state.currentTranscript.length) {
            const time = parseFloat(state.currentTranscript[lineIndex].start);
            if (!isNaN(time)) {
                timestamps.add(time);
                timestampToResultIndex[time] = index;
            }
        }
    });
    
    // Add markers to the progress bar
    const progressBar = elements.videoProgress;
    const videoDuration = elements.videoPlayer.duration;
    
    timestamps.forEach(time => {
        const position = (time / videoDuration) * 100;
        const marker = document.createElement('div');
        marker.className = 'search-result-marker';
        marker.style.left = `${position}%`;
        marker.dataset.time = time;
        marker.dataset.resultIndex = timestampToResultIndex[time];
        
        marker.addEventListener('click', () => {
            elements.videoPlayer.currentTime = time;
            
            // Navigate to the corresponding search result
            const resultIndex = parseInt(marker.dataset.resultIndex);
            if (!isNaN(resultIndex) && resultIndex >= 0 && resultIndex < state.searchResults.length) {
                // Set current index to one before so navigateSearch(1) will land on the right one
                state.currentSearchIndex = resultIndex - 1;
                navigateSearch(1);
            }
        });
        
        progressBar.appendChild(marker);
    });
    
    // Add indicators to timeline thumbnails
    const thumbnails = document.querySelectorAll('.timeline-item');
    
    thumbnails.forEach((item, index) => {
        if (index < state.videoScenes.length) {
            const sceneTime = state.videoScenes[index].time_seconds;
            const nextSceneTime = index < state.videoScenes.length - 1 ? 
                state.videoScenes[index + 1].time_seconds : videoDuration;
            
            // Check if any search result falls within this scene's time range
            let hasSearchResult = false;
            let resultIndex = -1;
            
            timestamps.forEach(time => {
                if (time >= sceneTime && time < nextSceneTime) {
                    hasSearchResult = true;
                    resultIndex = timestampToResultIndex[time];
                }
            });
            
            if (hasSearchResult) {
                const indicator = document.createElement('div');
                indicator.className = 'search-indicator';
                indicator.dataset.resultIndex = resultIndex;
                item.appendChild(indicator);
            }
        }
    });
}

/**
 * Clears search result markers from the timeline and progress bar
 */
export function clearSearchResultMarkers() {
    // Remove markers from progress bar
    const markers = document.querySelectorAll('.search-result-marker');
    markers.forEach(marker => marker.remove());
    
    // Remove indicators from timeline thumbnails
    const indicators = document.querySelectorAll('.search-indicator');
    indicators.forEach(indicator => indicator.remove());
}

/**
 * Updates the search results count display
 * @param {number} current - The current result index
 * @param {number} total - The total number of results
 */
export function updateSearchResultsCount(current, total) {
    elements.searchResultsCount.textContent = total > 0 ? `${current}/${total}` : '0/0';
}

/**
 * Sets up the slide search functionality
 */
export function setupSlideSearch() {
    const searchInput = elements.slideSearch;
    const clearBtn = elements.clearSlideSearchBtn;
    const prevBtn = elements.prevSlideSearchBtn;
    const nextBtn = elements.nextSlideSearchBtn;
    
    // Show/hide clear button based on input
    searchInput.addEventListener('input', () => {
        const hasText = searchInput.value.trim().length > 0;
        clearBtn.classList.toggle('visible', hasText);
        
        if (hasText) {
            performSlideSearch(searchInput.value);
        } else {
            clearSlideSearch();
        }
    });
    
    // Clear search
    clearBtn.addEventListener('click', () => {
        searchInput.value = '';
        clearBtn.classList.remove('visible');
        clearSlideSearch();
        searchInput.focus();
    });
    
    // Navigate through results
    prevBtn.addEventListener('click', () => {
        navigateSlideSearch(-1);
    });
    
    nextBtn.addEventListener('click', () => {
        navigateSlideSearch(1);
    });
    
    // Search on Enter key
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            if (state.slideSearchResults.length > 0) {
                navigateSlideSearch(1);
            } else {
                performSlideSearch(searchInput.value);
            }
        }
    });
}

/**
 * Performs a search in the slide content
 * @param {string} query - The search query
 */
export function performSlideSearch(query) {
    // Clear previous results
    clearSlideSearchHighlights();
    clearSearchResultMarkers();
    
    if (!query || query.trim() === '' || !state.ocrResults || state.ocrResults.length === 0) {
        updateSlideSearchResultsCount(0, 0);
        elements.prevSlideSearchBtn.disabled = true;
        elements.nextSlideSearchBtn.disabled = true;
        return;
    }
    
    query = query.trim();
    state.slideSearchResults = [];
    state.currentSlideSearchIndex = -1;
    
    // Search through OCR text elements
    const ocrItems = document.querySelectorAll('.ocr-item');
    
    ocrItems.forEach((item, itemIndex) => {
        const textElement = item.querySelector('.ocr-text');
        if (!textElement) return;
        
        const text = textElement.textContent;
        
        if (state.fuzzySearchEnabled && query.length >= 2) {
            // Perform fuzzy search
            const matches = findFuzzyMatches(text, query);
            
            if (matches.length > 0) {
                // Add each match as a separate result
                matches.forEach(match => {
                    state.slideSearchResults.push({
                        itemElement: item,
                        textElement: textElement,
                        itemIndex: itemIndex,
                        startIndex: match.startIndex,
                        endIndex: match.endIndex,
                        score: match.score,
                        matchPositions: match.matchPositions,
                        isFuzzy: true
                    });
                });
            }
        } else {
            // Perform exact search (case insensitive)
            const lowerText = text.toLowerCase();
            const lowerQuery = query.toLowerCase();
            let startIndex = 0;
            let index;
            
            // Find all occurrences of the query in this OCR text
            while ((index = lowerText.indexOf(lowerQuery, startIndex)) !== -1) {
                state.slideSearchResults.push({
                    itemElement: item,
                    textElement: textElement,
                    itemIndex: itemIndex,
                    startIndex: index,
                    endIndex: index + query.length,
                    score: 1.0,
                    isFuzzy: false
                });
                startIndex = index + 1;
            }
        }
    });
    
    // Sort results by score (highest first) if fuzzy search is enabled
    if (state.fuzzySearchEnabled) {
        state.slideSearchResults.sort((a, b) => b.score - a.score);
    }
    
    // Highlight all results
    state.slideSearchResults.forEach((result, index) => {
        const textElement = result.textElement;
        
        if (result.isFuzzy && result.matchPositions) {
            // Use specialized fuzzy highlighting
            highlightFuzzyMatch(textElement, [result], index);
        } else {
            // Standard highlighting for exact matches
            const text = textElement.textContent;
            const beforeMatch = text.substring(0, result.startIndex);
            const match = text.substring(result.startIndex, result.endIndex);
            const afterMatch = text.substring(result.endIndex);
            
            // Create a span with the highlighted text
            const highlightSpan = document.createElement('span');
            highlightSpan.className = 'search-highlight';
            highlightSpan.dataset.resultIndex = index;
            highlightSpan.textContent = match;
            
            // Replace the text content with the highlighted version
            textElement.innerHTML = '';
            textElement.appendChild(document.createTextNode(beforeMatch));
            textElement.appendChild(highlightSpan);
            textElement.appendChild(document.createTextNode(afterMatch));
        }
    });
    
    // Add search result markers to the timeline and progress bar
    addSlideSearchResultMarkersToTimeline();
    
    // Update UI
    updateSlideSearchResultsCount(0, state.slideSearchResults.length);
    elements.prevSlideSearchBtn.disabled = state.slideSearchResults.length === 0;
    elements.nextSlideSearchBtn.disabled = state.slideSearchResults.length === 0;
    
    // If we have results, navigate to the first one
    if (state.slideSearchResults.length > 0) {
        navigateSlideSearch(1);
    }
}

/**
 * Navigates through slide search results
 * @param {number} direction - The direction to navigate (1 for next, -1 for previous)
 */
export function navigateSlideSearch(direction) {
    if (state.slideSearchResults.length === 0) return;
    
    // Remove active class from current result
    if (state.currentSlideSearchIndex >= 0 && state.currentSlideSearchIndex < state.slideSearchResults.length) {
        const currentHighlight = document.querySelector(`.ocr-item .search-highlight[data-result-index="${state.currentSlideSearchIndex}"]`);
        if (currentHighlight) {
            currentHighlight.classList.remove('active');
        }
        
        // Remove active class from current marker
        const currentMarker = document.querySelector(`.search-result-marker[data-result-index="${state.currentSlideSearchIndex}"]`);
        if (currentMarker) {
            currentMarker.classList.remove('active');
        }
        
        // Remove active class from timeline indicator
        const currentIndicator = document.querySelector(`.search-indicator[data-result-index="${state.currentSlideSearchIndex}"]`);
        if (currentIndicator) {
            currentIndicator.classList.remove('active');
        }
    }
    
    // Calculate new index with wrapping
    state.currentSlideSearchIndex = (state.currentSlideSearchIndex + direction) % state.slideSearchResults.length;
    if (state.currentSlideSearchIndex < 0) state.currentSlideSearchIndex = state.slideSearchResults.length - 1;
    
    // Highlight new current result
    const newHighlight = document.querySelector(`.ocr-item .search-highlight[data-result-index="${state.currentSlideSearchIndex}"]`);
    if (newHighlight) {
        newHighlight.classList.add('active');
        
        // Highlight corresponding marker
        const newMarker = document.querySelector(`.search-result-marker[data-result-index="${state.currentSlideSearchIndex}"]`);
        if (newMarker) {
            newMarker.classList.add('active');
        }
        
        // Highlight corresponding timeline indicator
        const newIndicator = document.querySelector(`.search-indicator[data-result-index="${state.currentSlideSearchIndex}"]`);
        if (newIndicator) {
            newIndicator.classList.add('active');
        }
        
        // Scroll to the result
        const result = state.slideSearchResults[state.currentSlideSearchIndex];
        result.itemElement.scrollIntoView({
            behavior: 'smooth',
            block: 'center'
        });
        
        // Find the corresponding OCR result to get the timestamp
        const ocrItemIndex = Array.from(document.querySelectorAll('.ocr-item')).indexOf(result.itemElement);
        if (ocrItemIndex >= 0 && ocrItemIndex < state.ocrResults.length) {
            const time = state.ocrResults[ocrItemIndex].time_seconds;
            if (!isNaN(time)) {
                elements.videoPlayer.currentTime = time;
            }
        }
    }
    
    // Update counter
    updateSlideSearchResultsCount(state.currentSlideSearchIndex + 1, state.slideSearchResults.length);
}

/**
 * Adds slide search result markers to the timeline and progress bar
 */
export function addSlideSearchResultMarkersToTimeline() {
    // Clear any existing markers first
    clearSearchResultMarkers();
    
    if (state.slideSearchResults.length === 0) return;
    
    // Get unique timestamps from search results
    const timestamps = new Set();
    const timestampToResultIndex = {};
    
    state.slideSearchResults.forEach((result, index) => {
        const ocrItemIndex = Array.from(document.querySelectorAll('.ocr-item')).indexOf(result.itemElement);
        if (ocrItemIndex >= 0 && ocrItemIndex < state.ocrResults.length) {
            const time = state.ocrResults[ocrItemIndex].time_seconds;
            if (!isNaN(time)) {
                timestamps.add(time);
                timestampToResultIndex[time] = index;
            }
        }
    });
    
    // Add markers to the progress bar
    const progressBar = elements.videoProgress;
    const videoDuration = elements.videoPlayer.duration;
    
    timestamps.forEach(time => {
        const position = (time / videoDuration) * 100;
        const marker = document.createElement('div');
        marker.className = 'search-result-marker';
        marker.style.left = `${position}%`;
        marker.dataset.time = time;
        marker.dataset.resultIndex = timestampToResultIndex[time];
        
        marker.addEventListener('click', () => {
            elements.videoPlayer.currentTime = time;
            
            // Navigate to the corresponding search result
            const resultIndex = parseInt(marker.dataset.resultIndex);
            if (!isNaN(resultIndex) && resultIndex >= 0 && resultIndex < state.slideSearchResults.length) {
                // Set current index to one before so navigateSearch(1) will land on the right one
                state.currentSlideSearchIndex = resultIndex - 1;
                navigateSlideSearch(1);
            }
        });
        
        progressBar.appendChild(marker);
    });
    
    // Add indicators to timeline thumbnails
    const thumbnails = document.querySelectorAll('.timeline-item');
    
    thumbnails.forEach((item, index) => {
        if (index < state.videoScenes.length) {
            const sceneTime = state.videoScenes[index].time_seconds;
            const nextSceneTime = index < state.videoScenes.length - 1 ? 
                state.videoScenes[index + 1].time_seconds : videoDuration;
            
            // Check if any search result falls within this scene's time range
            let hasSearchResult = false;
            let resultIndex = -1;
            
            timestamps.forEach(time => {
                if (time >= sceneTime && time < nextSceneTime) {
                    hasSearchResult = true;
                    resultIndex = timestampToResultIndex[time];
                }
            });
            
            if (hasSearchResult) {
                const indicator = document.createElement('div');
                indicator.className = 'search-indicator';
                indicator.dataset.resultIndex = resultIndex;
                item.appendChild(indicator);
            }
        }
    });
}

/**
 * Clears the slide search results
 */
export function clearSlideSearch() {
    clearSlideSearchHighlights();
    clearSearchResultMarkers();
    state.slideSearchResults = [];
    state.currentSlideSearchIndex = -1;
    updateSlideSearchResultsCount(0, 0);
    elements.prevSlideSearchBtn.disabled = true;
    elements.nextSlideSearchBtn.disabled = true;
}

/**
 * Clears search highlights from the slide content
 */
export function clearSlideSearchHighlights() {
    // Restore original text content for all OCR items
    const ocrItems = document.querySelectorAll('.ocr-item');
    
    ocrItems.forEach((item) => {
        const textElement = item.querySelector('.ocr-text');
        if (!textElement) return;
        
        // If there are highlights, remove them and restore original text
        if (textElement.querySelector('.search-highlight')) {
            const originalText = textElement.textContent;
            textElement.innerHTML = originalText;
        }
    });
}

/**
 * Updates the slide search results count display
 * @param {number} current - The current result index
 * @param {number} total - The total number of results
 */
export function updateSlideSearchResultsCount(current, total) {
    elements.slideSearchResultsCount.textContent = total > 0 ? `${current}/${total}` : '0/0';
}

/**
 * Toggles the display of timestamps in the transcript
 */
export function toggleTimestamps() {
    state.showTimestamps = elements.timestampToggle.checked;
    
    // Update the transcript display
    if (state.currentTranscript.length > 0) {
        updateTranscriptDisplay();
    }
}

/**
 * Toggles fuzzy search functionality
 */
export function toggleFuzzySearch() {
    state.fuzzySearchEnabled = elements.fuzzySearchToggle.checked;
    
    // Re-run current searches with new setting
    const transcriptQuery = elements.transcriptSearch.value.trim();
    if (transcriptQuery) {
        performSearch(transcriptQuery);
    }
    
    const slideQuery = elements.slideSearch.value.trim();
    if (slideQuery) {
        performSlideSearch(slideQuery);
    }
} 