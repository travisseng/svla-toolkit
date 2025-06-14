// fuzzy.js - Fuzzy search implementation

/**
 * Performs a fuzzy search on a string
 * @param {string} text - The text to search in
 * @param {string} query - The search query
 * @returns {Object|null} - Match information or null if no match
 */
export function fuzzySearch(text, query) {
    if (!text || !query) return null;
    
    text = text.toLowerCase();
    query = query.toLowerCase();
    
    // Direct match check (faster path)
    const directIndex = text.indexOf(query);
    if (directIndex !== -1) {
        return {
            match: true,
            score: 1.0,  // Perfect match
            startIndex: directIndex,
            endIndex: directIndex + query.length
        };
    }
    
    // Fuzzy match implementation
    let textIndex = 0;
    let queryIndex = 0;
    let matchPositions = [];
    
    // Try to find all characters of the query in the text, in order
    while (textIndex < text.length && queryIndex < query.length) {
        if (text[textIndex] === query[queryIndex]) {
            matchPositions.push(textIndex);
            queryIndex++;
        }
        textIndex++;
    }
    
    // If we didn't match all characters in the query, return null
    if (queryIndex < query.length) {
        return null;
    }
    
    // Calculate score based on:
    // 1. Consecutive matches (higher is better)
    // 2. Proximity of matches (closer is better)
    // 3. Position of first match (earlier is better)
    
    let consecutiveMatches = 0;
    let totalGap = 0;
    
    for (let i = 1; i < matchPositions.length; i++) {
        const gap = matchPositions[i] - matchPositions[i-1];
        if (gap === 1) {
            consecutiveMatches++;
        }
        totalGap += gap;
    }
    
    // Calculate score components
    const consecutiveScore = consecutiveMatches / Math.max(1, query.length - 1);
    const proximityScore = 1 - Math.min(1, totalGap / (text.length * 2));
    const positionScore = 1 - (matchPositions[0] / text.length);
    
    // Weighted score calculation
    const score = (consecutiveScore * 0.5) + (proximityScore * 0.3) + (positionScore * 0.2);
    
    return {
        match: true,
        score: score,
        startIndex: matchPositions[0],
        endIndex: matchPositions[matchPositions.length - 1] + 1,
        matchPositions: matchPositions
    };
}

/**
 * Finds all fuzzy matches in a text
 * @param {string} text - The text to search in
 * @param {string} query - The search query
 * @param {number} threshold - Minimum score threshold (0-1)
 * @returns {Array} - Array of match objects
 */
export function findFuzzyMatches(text, query, threshold = 0.8 
) {
    if (!text || !query || query.length === 0) return [];
    
    const matches = [];
    let startIndex = 0;
    
    // For very short queries, we need to be more strict
    const adjustedThreshold = query.length <= 2 ? 0.7 : threshold;
    
    // Check for direct matches first (faster path for common case)
    let directIndex = text.toLowerCase().indexOf(query.toLowerCase());
    while (directIndex !== -1) {
        matches.push({
            match: true,
            score: 1.0,
            startIndex: directIndex,
            endIndex: directIndex + query.length
        });
        
        startIndex = directIndex + 1;
        directIndex = text.toLowerCase().indexOf(query.toLowerCase(), startIndex);
    }
    
    // If we found direct matches, return them
    if (matches.length > 0) {
        return matches;
    }
    
    // For longer texts, we'll use a sliding window approach
    // to find potential fuzzy matches
    const windowSize = Math.min(text.length, query.length * 3);
    
    for (let i = 0; i <= text.length - query.length; i++) {
        const windowEnd = Math.min(i + windowSize, text.length);
        const window = text.substring(i, windowEnd);
        
        const match = fuzzySearch(window, query);
        if (match && match.score >= adjustedThreshold) {
            // Adjust indices to be relative to the original text
            match.startIndex += i;
            match.endIndex += i;
            if (match.matchPositions) {
                match.matchPositions = match.matchPositions.map(pos => pos + i);
            }
            
            matches.push(match);
            
            // Skip ahead to avoid overlapping matches
            i += Math.max(1, Math.floor(query.length / 2));
        }
    }
    
    // Sort matches by score (highest first)
    return matches.sort((a, b) => b.score - a.score);
}

/**
 * Highlights fuzzy matches in HTML
 * @param {Element} element - The DOM element containing the text
 * @param {Array} matches - Array of match objects
 * @param {number} resultIndex - The index of this result in the overall results
 * @returns {boolean} - Whether highlighting was successful
 */
export function highlightFuzzyMatch(element, matches, resultIndex) {
    if (!element || !matches || matches.length === 0) return false;
    
    const text = element.textContent;
    
    // Sort matches by start index to process them in order
    const sortedMatches = [...matches].sort((a, b) => a.startIndex - b.startIndex);
    
    // Create document fragment to build the highlighted content
    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    
    for (const match of sortedMatches) {
        // Add text before the match
        if (match.startIndex > lastIndex) {
            fragment.appendChild(document.createTextNode(
                text.substring(lastIndex, match.startIndex)
            ));
        }
        
        // Create highlighted span for the match
        const highlightSpan = document.createElement('span');
        highlightSpan.className = 'search-highlight';
        highlightSpan.dataset.resultIndex = resultIndex;
        highlightSpan.dataset.score = match.score.toFixed(2);
        
        // If we have specific match positions, highlight each character
        if (match.matchPositions && match.matchPositions.length > 0) {
            let lastMatchPos = match.startIndex;
            
            for (const pos of match.matchPositions) {
                // Add non-matching characters
                if (pos > lastMatchPos) {
                    highlightSpan.appendChild(document.createTextNode(
                        text.substring(lastMatchPos, pos)
                    ));
                }
                
                // Add matching character with stronger highlight
                const matchChar = document.createElement('span');
                matchChar.className = 'exact-match';
                matchChar.textContent = text[pos];
                highlightSpan.appendChild(matchChar);
                
                lastMatchPos = pos + 1;
            }
            
            // Add any remaining characters
            if (lastMatchPos < match.endIndex) {
                highlightSpan.appendChild(document.createTextNode(
                    text.substring(lastMatchPos, match.endIndex)
                ));
            }
        } else {
            // Simple case: just highlight the whole match
            highlightSpan.textContent = text.substring(match.startIndex, match.endIndex);
        }
        
        fragment.appendChild(highlightSpan);
        lastIndex = match.endIndex;
    }
    
    // Add any remaining text after the last match
    if (lastIndex < text.length) {
        fragment.appendChild(document.createTextNode(
            text.substring(lastIndex)
        ));
    }
    
    // Replace the element's content with the highlighted version
    element.innerHTML = '';
    element.appendChild(fragment);
    
    return true;
} 