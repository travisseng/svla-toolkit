// elements.js - DOM element references

// DOM elements
export const elements = {
    get videoPlayer() { return document.getElementById('videoPlayer'); },
    get youtubeUrl() { return document.getElementById('youtubeUrl'); },
    get videoFile() { return document.getElementById('videoFile'); },
    get errorAlert() { return document.getElementById('errorAlert'); },
    get loadingIndicator() { return document.getElementById('loadingIndicator'); },
    get generateSummaryBtn() { return document.getElementById('generateSummaryBtn'); },
    get timeMarker() { return document.getElementById('timeMarker'); },
    get progressHoverTime() { return document.getElementById('progressHoverTime'); },
    get videoProgress() { return document.getElementById('videoProgress'); },
    get thumbnailTimeline() { return document.getElementById('thumbnailTimeline'); },
    get scenesContainer() { return document.getElementById('scenesContainer'); },
    get chaptersContainer() { return document.getElementById('chaptersContainer'); },
    get transcriptContainer() { return document.getElementById('transcriptContainer'); },
    get slideContentContainer() { return document.getElementById('slideContentContainer'); },
    get detectionOverlay() { return document.getElementById('detectionOverlay'); },
    get detectionImageContainer() { return document.getElementById('detectionImageContainer'); },
    get detectionList() { return document.getElementById('detectionList'); },
    get debugOverlay() { return document.getElementById('debugOverlay'); },
    get debugContent() { return document.getElementById('debugContent'); },
    get sceneToggle() { return document.getElementById('sceneToggle'); },
    get timestampToggle() { return document.getElementById('timestampToggle'); },
    get fuzzySearchToggle() { return document.getElementById('fuzzySearchToggle'); },
    get settingsFuzzyToggle() { return document.getElementById('settingsFuzzyToggle'); },
    get tabButtons() { return document.querySelectorAll('.tab-btn'); },
    get tabPanes() { return document.querySelectorAll('.tab-pane'); },
    get transcriptSearch() { return document.getElementById('transcriptSearch'); },
    get clearSearchBtn() { return document.getElementById('clearSearchBtn'); },
    get prevSearchBtn() { return document.getElementById('prevSearchBtn'); },
    get nextSearchBtn() { return document.getElementById('nextSearchBtn'); },
    get searchResultsCount() { return document.getElementById('searchResultsCount'); },
    get slideSearch() { return document.getElementById('slideSearch'); },
    get clearSlideSearchBtn() { return document.getElementById('clearSlideSearchBtn'); },
    get prevSlideSearchBtn() { return document.getElementById('prevSlideSearchBtn'); },
    get nextSlideSearchBtn() { return document.getElementById('nextSlideSearchBtn'); },
    get slideSearchResultsCount() { return document.getElementById('slideSearchResultsCount'); },
    get settingsBtn() { return document.getElementById('settingsBtn'); },
    get settingsModal() { return document.getElementById('settingsModal'); },
    get closeSettingsBtn() { return document.getElementById('closeSettingsBtn'); },
    get ocrPreferenceSelect() { return document.getElementById('ocrPreferenceSelect'); },
    get saveSettingsBtn() { return document.getElementById('saveSettingsBtn'); },
    get notification() { return document.getElementById('notification'); },
    get loadVideoBtn() { return document.getElementById('loadVideoBtn'); },
    get closeDetectionBtn() { return document.getElementById('closeDetectionBtn'); },
    get debugDetectionsBtn() { return document.getElementById('debugDetectionsBtn'); },
    get closeDebugBtn() { return document.getElementById('closeDebugBtn'); },
    // Transcript preference elements
    get transcriptPreferenceRadios() { return document.querySelectorAll('input[name="transcriptPreference"]'); },
    get whisperControls() { return document.getElementById('whisperControls'); },
    get generateWhisperBtn() { return document.getElementById('generateWhisperBtn'); },
    get whisperProgress() { return document.getElementById('whisperProgress'); },
    get whisperProgressFill() { return document.querySelector('#whisperProgress .progress-fill'); },
    get whisperProgressText() { return document.querySelector('#whisperProgress .progress-text'); },
    get uploadVideoBtn() { return document.getElementById('uploadVideoBtn'); }
}; 