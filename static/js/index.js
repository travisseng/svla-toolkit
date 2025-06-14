// index.js - Entry point for non-module environments
// This file is used to import all modules and expose them to the global scope

import { initApp } from './main.js';
import { elements } from './elements.js';

// Example videos that have been pre-processed
const exampleVideos = [
    {
        title: "Intro to Large Language Models",
        url: "https://www.youtube.com/watch?v=zjkBMFhNj_g",
        description: "Andrej Karpathy's lecture on Large Language Models"
    },
    // {
    //     title: "Stanford CS224N: NLP with Deep Learning",
    //     url: "https://www.youtube.com/watch?v=8rXD5-xhemo",
    //     description: "Natural Language Processing lecture by Professor Christopher Manning"
    // },
    // Add more example videos here
];

// Initialize example videos dropdown
function initExampleVideos() {
    const container = document.createElement('div');
    container.className = 'example-videos-container';
    container.innerHTML = `
        <select id="exampleVideos" class="example-videos-select" title="Select an example video">
            <option value="">Examples ▾</option>
            ${exampleVideos.map(video => `
                <option value="${video.url}">${video.title}</option>
            `).join('')}
        </select>
    `;

    // Insert the container at the start of the input section
    const inputSection = document.querySelector('.input-section');
    inputSection.insertBefore(container, inputSection.firstChild);

    // Add event listener for selection change
    const select = container.querySelector('#exampleVideos');
    
    select.addEventListener('change', (e) => {
        const selectedVideo = exampleVideos.find(v => v.url === e.target.value);
        if (selectedVideo) {
            elements.youtubeUrl.value = selectedVideo.url;
            // Show a notification with the video description
            const notification = document.createElement('div');
            notification.className = 'notification info';
            notification.textContent = selectedVideo.description;
            document.body.appendChild(notification);
            notification.style.opacity = '1';
            setTimeout(() => {
                notification.style.opacity = '0';
                setTimeout(() => notification.remove(), 300);
            }, 3000);
        }
    });
}

// Initialize the application when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    initApp();
    initExampleVideos();
}); 