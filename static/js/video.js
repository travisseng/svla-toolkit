// video.js - Video player functionality

import { elements } from './elements.js';
import { formatTime } from './utils.js';
import { state } from './main.js';
import { updateActiveTranscript } from './transcript.js';

/**
 * Sets up the video progress bar
 * @param {HTMLVideoElement} videoPlayer - The video player element
 */
export function setupVideoPlayer(videoPlayer) {
    const progressBar = elements.videoProgress;
    const hoverTime = elements.progressHoverTime;

    progressBar.addEventListener('mousemove', (e) => {
        const rect = progressBar.getBoundingClientRect();
        const pos = (e.clientX - rect.left) / rect.width;
        const time = pos * videoPlayer.duration;
        hoverTime.textContent = formatTime(time);
        hoverTime.style.left = `${pos * 100}%`;
        hoverTime.style.display = 'block';
    });

    progressBar.addEventListener('mouseleave', () => {
        hoverTime.style.display = 'none';
    });

    progressBar.addEventListener('click', (e) => {
        const rect = progressBar.getBoundingClientRect();
        const pos = (e.clientX - rect.left) / rect.width;
        videoPlayer.currentTime = pos * videoPlayer.duration;
    });

    // Update time marker on timeupdate
    videoPlayer.addEventListener('timeupdate', () => {
        updateTimeMarker(videoPlayer);
    });
    
    // Add timeupdate listener to highlight current thumbnail
    videoPlayer.addEventListener('timeupdate', updateTimelineHighlight);
    
    // Add listener for transcript updates
    videoPlayer.addEventListener('timeupdate', updateActiveTranscript);
}

/**
 * Updates the time marker position
 * @param {HTMLVideoElement} videoPlayer - The video player element
 */
export function updateTimeMarker(videoPlayer) {
    const timeMarker = elements.timeMarker;
    const progress = (videoPlayer.currentTime / videoPlayer.duration) * 100;
    timeMarker.style.left = `${progress}%`;
}

/**
 * Updates the highlighted thumbnail in the timeline
 */
export function updateTimelineHighlight() {
    const videoPlayer = elements.videoPlayer;
    const currentTime = videoPlayer.currentTime;
    const thumbnails = document.querySelectorAll('.timeline-thumbnail');
    
    // Find the current scene in all scenes
    let currentThumbnailIndex = -1;
    
    // Find which thumbnail corresponds to the current time
    for (let i = 0; i < state.videoScenes.length; i++) {
        const nextIndex = i + 1;
        if (nextIndex < state.videoScenes.length) {
            if (currentTime >= state.videoScenes[i].time_seconds && 
                currentTime < state.videoScenes[nextIndex].time_seconds) {
                currentThumbnailIndex = i;
                break;
            }
        } else if (currentTime >= state.videoScenes[i].time_seconds) {
            // Last thumbnail
            currentThumbnailIndex = i;
        }
    }
    
    // Update thumbnail highlighting
    thumbnails.forEach((thumbnail, index) => {
        if (index === currentThumbnailIndex) {
            thumbnail.classList.add('active');
            
            // Scroll the active thumbnail into view if it's not visible
            const timelineContainer = elements.thumbnailTimeline;
            const thumbnailItem = thumbnail.parentElement;
            const containerRect = timelineContainer.getBoundingClientRect();
            const thumbnailRect = thumbnailItem.getBoundingClientRect();
            
            // Check if thumbnail is outside the visible area
            if (thumbnailRect.left < containerRect.left || thumbnailRect.right > containerRect.right) {
                thumbnailItem.scrollIntoView({
                    behavior: 'smooth',
                    block: 'nearest',
                    inline: 'center'
                });
            }
        } else {
            thumbnail.classList.remove('active');
        }
    });
} 