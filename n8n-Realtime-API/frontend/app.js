document.addEventListener('DOMContentLoaded', () => {
    const recordButton = document.getElementById('record-button');
    const statusMessage = document.getElementById('status-message');
    const visualizationContainer = document.getElementById('visualization-container');
    const transcriptionContainer = document.getElementById('transcription-container');
    const transcriptionText = document.getElementById('transcription-text');
    const messageContainer = document.getElementById('message-container');
    const messageText = document.getElementById('message-text');
    const webhookUrlInput = document.getElementById('webhook-url');
    const saveSettingsButton = document.getElementById('save-settings');
    const responseContainer = document.getElementById('response-container');
    const responseText = document.getElementById('response-text');
    const conversationContainer = document.getElementById('conversation-container');
    
    // Audio player for responses
    let audioPlayer = new Audio();
    
    // Processing notification sound
    const processingSound = new Audio('audio/processing-beep.mp3');
    
    // Status tracking
    let activeRequests = 0;
    
    // Load saved webhook URL from localStorage
    webhookUrlInput.value = localStorage.getItem('webhookUrl') || '';

    // Save webhook URL to localStorage
    saveSettingsButton.addEventListener('click', () => {
        const webhookUrl = webhookUrlInput.value.trim();
        if (webhookUrl) {
            localStorage.setItem('webhookUrl', webhookUrl);
            showMessage('Ustawienia zapisane pomyślnie!', 'success');
        } else {
            showMessage('Proszę wprowadzić poprawny adres URL webhooka', 'error');
        }
    });

    // Flags for continuous listening mode
    let isListening = false;      // Is the continuous listening mode active
    let isRecording = false;      // Is currently recording audio
    let isProcessing = false;     // Is currently processing a recording
    
    // Media objects
    let mediaRecorder = null;
    let audioChunks = [];
    let recordingId = 0;          // Unique ID for each recording
    
    // Variables for silence detection
    let audioContext;
    let audioAnalyser;
    let audioSource;
    let microphoneStream;
    let silenceDetectionInterval;
    
    // Silence detection settings
    const SILENCE_THRESHOLD = 15; // Threshold below which is considered silence
    const SILENCE_DURATION = 1500; // 1.5 seconds of silence to trigger stop
    const CHECK_INTERVAL = 100;   // Check every 100ms
    let silenceStartTime = null;
    let speechDetected = false;
    
    // Counter for the conversation entries
    let conversationEntryCount = 0;
    const MAX_CONVERSATION_ENTRIES = 10; // Maximum number of conversation entries to show

    // Check if browser supports required APIs
    if (!navigator.mediaDevices || !window.MediaRecorder) {
        statusMessage.textContent = 'Twoja przeglądarka nie obsługuje nagrywania dźwięku.';
        recordButton.disabled = true;
        return;
    }

    // Handle toggle button click - start/stop continuous listening
    recordButton.addEventListener('click', toggleContinuousListening);

    // Toggle continuous listening mode
    async function toggleContinuousListening() {
        if (isListening) {
            // Stop listening
            stopListening();
            recordButton.classList.remove('recording');
            recordButton.title = "Rozpocznij ciągłe słuchanie";
            statusMessage.textContent = 'Gotowy do słuchania';
        } else {
            // Start listening
            try {
                await startListening();
                recordButton.classList.add('recording');
                recordButton.title = "Zatrzymaj ciągłe słuchanie";
                statusMessage.textContent = 'Ciągłe słuchanie aktywne...';
                showMessage('Ciągłe słuchanie aktywne. Zacznij mówić, aby wysłać zapytanie.', 'success');
            } catch (error) {
                console.error('Błąd podczas uruchamiania słuchania:', error);
                showMessage(`Nie można uzyskać dostępu do mikrofonu: ${error.message}`, 'error');
            }
        }
    }
    
    // Start continuous listening mode
    async function startListening() {
        // Get microphone stream
        microphoneStream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                channelCount: 1,
                sampleRate: 16000
            } 
        });
        
        // Setup audio context and analyzer
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        audioSource = audioContext.createMediaStreamSource(microphoneStream);
        audioAnalyser = audioContext.createAnalyser();
        
        // Configure analyzer
        audioAnalyser.fftSize = 256;
        audioAnalyser.smoothingTimeConstant = 0.8;
        audioSource.connect(audioAnalyser);
        
        // Reset detection state
        silenceStartTime = null;
        speechDetected = false;
        isListening = true;
        isRecording = false;
        
        // Setup the media recorder (but don't start it yet)
        const mimeType = getSupportedMimeType();
        const options = mimeType ? { mimeType } : {};
        mediaRecorder = new MediaRecorder(microphoneStream, options);
        
        // Start silence detection loop
        startSilenceDetection();
        
        // Start visualization
        visualizationContainer.classList.add('active-visualization');
        
        console.log("Continuous listening mode activated");
    }
    
    // Stop continuous listening mode
    function stopListening() {
        // Stop silence detection
        clearInterval(silenceDetectionInterval);
        
        // Stop any active recording
        if (isRecording && mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
            isRecording = false;
        }
        
        // Release microphone
        if (microphoneStream) {
            microphoneStream.getTracks().forEach(track => track.stop());
        }
        
        // Close audio context
        if (audioContext && audioContext.state !== 'closed') {
            audioContext.close().catch(e => console.error("Error closing audio context:", e));
        }
        
        // Update visualization
        visualizationContainer.classList.remove('active-visualization');
        
        // Reset flags
        isListening = false;
        isRecording = false;
        
        console.log("Continuous listening mode deactivated");
    }
    
    // Funkcja do zatrzymywania odtwarzania audio
    function stopAudioPlayback() {
        if (audioPlayer && !audioPlayer.paused) {
            console.log('Przerwanie odtwarzania - wykryto mowę użytkownika');
            audioPlayer.pause();
            audioPlayer.currentTime = 0;
            
            // Opcjonalnie: pokaż krótki komunikat
            showMessage('Przerwano odtwarzanie, słucham...', 'success');
            
            // Znajdź i zaktualizuj wszystkie przyciski odtwarzania
            const playButtons = document.querySelectorAll('.play-button');
            playButtons.forEach(button => {
                button.disabled = false;
                button.innerHTML = '<i class="fas fa-play"></i> Odtwórz';
            });
        }
    }
    
    // Start silence detection loop
    function startSilenceDetection() {
        // Buffer for frequency data
        const dataArray = new Uint8Array(audioAnalyser.frequencyBinCount);
        
        // Set up interval to check for speech and silence
        silenceDetectionInterval = setInterval(() => {
            if (!isListening) {
                clearInterval(silenceDetectionInterval);
                return;
            }
            
            // Get current frequency data
            audioAnalyser.getByteFrequencyData(dataArray);
            
            // Calculate average volume
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
                sum += dataArray[i];
            }
            const average = sum / dataArray.length;
            
            // Update visualization (actual audio level)
            updateVisualization(average);
            
            // User is speaking
            if (average > SILENCE_THRESHOLD) {
                // Jeśli odtwarzane jest audio, przerwij odtwarzanie
                if (audioPlayer && !audioPlayer.paused) {
                    stopAudioPlayback();
                }
                
                // If not already recording, start a new recording
                if (!isRecording) {
                    startNewRecording();
                }
                
                // Reset silence timer
                silenceStartTime = null;
                speechDetected = true;
            } 
            // User is silent
            else {
                // Only check for end of speech if we're recording and speech was detected
                if (isRecording && speechDetected) {
                    // If this is the start of silence
                    if (silenceStartTime === null) {
                        silenceStartTime = Date.now();
                    }
                    
                    // Check if silence has lasted long enough
                    const silenceDuration = Date.now() - silenceStartTime;
                    if (silenceDuration >= SILENCE_DURATION) {
                        console.log(`Cisza wykryta przez ${silenceDuration}ms. Kończę nagrywanie.`);
                        stopCurrentRecording();
                        
                        // Play the processing notification sound
                        processingSound.play().catch(err => console.error("Nie można odtworzyć dźwięku powiadomienia:", err));
                        
                        // Reset for next recording
                        speechDetected = false;
                        silenceStartTime = null;
                    }
                }
            }
        }, CHECK_INTERVAL);
    }
    
    // Start a new recording
    function startNewRecording() {
        // Reset recording state
        audioChunks = [];
        recordingId++;
        const currentRecordingId = recordingId;
        
        // Setup mediaRecorder event handlers
        mediaRecorder.onstart = () => {
            console.log(`Nagrywanie #${currentRecordingId} rozpoczęte`);
            isRecording = true;
        };
        
        mediaRecorder.ondataavailable = (event) => {
            audioChunks.push(event.data);
        };
        
        mediaRecorder.onstop = () => {
            console.log(`Nagrywanie #${currentRecordingId} zakończone`);
            isRecording = false;
            
            // Create audio blob with specific type
            const mimeType = getSupportedMimeType();
            const audioBlob = new Blob(audioChunks, { type: mimeType || 'audio/mpeg' });
            
            console.log(`Nagranie #${currentRecordingId}: ${audioBlob.size} bajtów`);
            
            // Only process if it's not too small
            if (audioBlob.size > 1000) {
                processRecording(audioBlob, currentRecordingId);
            } else {
                console.log(`Nagranie #${currentRecordingId} zbyt krótkie, pomijam`);
            }
        };
        
        // Start recording in small chunks for more responsiveness
        mediaRecorder.start(100);
    }
    
    // Stop the current recording
    function stopCurrentRecording() {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
        }
    }
    
    // Process a recorded audio blob
    async function processRecording(audioBlob, recordingId) {
        const webhookUrl = localStorage.getItem('webhookUrl');
        
        if (!webhookUrl) {
            showMessage('Proszę najpierw ustawić adres URL webhooka N8N w ustawieniach', 'error');
            return;
        }
        
        // Create a new conversation entry for this recording
        const entryId = `entry-${recordingId}`;
        addConversationEntry(entryId);
        
        try {
            activeRequests++;
            updateStatus();
            
            // Create form data for the API request
            const formData = new FormData();
            formData.append('audio', audioBlob, `recording-${recordingId}.mp3`);
            formData.append('webhook_url', webhookUrl);
            
            // Send the audio to the backend
            const response = await fetch('/api/transcribe', {
                method: 'POST',
                body: formData
            });
            
            if (!response.ok) {
                let errorMessage = 'Transkrypcja nie powiodła się';
                try {
                    const errorData = await response.json();
                    errorMessage = errorData.detail || errorMessage;
                } catch (e) {
                    console.error('Błąd parsowania odpowiedzi błędu:', e);
                }
                throw new Error(errorMessage);
            }
            
            const data = await response.json();
            
            // Update the conversation entry with the transcription
            updateConversationEntryWithTranscription(entryId, data.text);
            
            // Process the response from n8n
            if (data.n8nResponse && data.n8nResponse.text) {
                console.log(`Otrzymano natychmiastową odpowiedź dla nagrania #${recordingId}`);
                handleN8nResponse(data.n8nResponse.text, entryId);
            } else {
                // Try to get the response via last-response-tts endpoint
                try {
                    const n8nResponse = await fetch('/api/last-response-tts', {
                        method: 'GET',
                        headers: {
                            'Accept': 'application/json',
                        },
                    });
                    
                    if (n8nResponse.ok) {
                        const responseData = await n8nResponse.json();
                        
                        if (responseData.text && responseData.audio_url) {
                            handleN8nResponse(responseData.text, entryId, responseData.audio_url);
                        } else {
                            handleDefaultResponse(entryId);
                        }
                    } else {
                        handleDefaultResponse(entryId);
                    }
                } catch (error) {
                    console.error(`Błąd podczas pobierania odpowiedzi dla nagrania #${recordingId}:`, error);
                    handleDefaultResponse(entryId);
                }
            }
        } catch (error) {
            console.error(`Błąd podczas przetwarzania nagrania #${recordingId}:`, error);
            updateConversationEntryWithError(entryId, error.message);
        } finally {
            activeRequests--;
            updateStatus();
        }
    }
    
    // Handle n8n response
    async function handleN8nResponse(text, entryId, audioUrl = null) {
        try {
            if (!audioUrl) {
                // Convert text to speech
                const response = await fetch('/api/speak', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ text: text })
                });
                
                if (!response.ok) {
                    throw new Error('Nie udało się przekonwertować tekstu na mowę');
                }
                
                const responseData = await response.json();
                audioUrl = responseData.audio_url;
            }
            
            // Update conversation entry with response
            updateConversationEntryWithResponse(entryId, text, audioUrl);
            
            // Play audio
            playAudioResponse(audioUrl);
            
        } catch (error) {
            console.error('Błąd podczas obsługi odpowiedzi:', error);
            updateConversationEntryWithError(entryId, error.message);
        }
    }
    
    // Handle default response when n8n fails
    function handleDefaultResponse(entryId) {
        const defaultText = "Niestety, nie mogę sprawdzić bieżących informacji pogodowych, w tym pogody w Warszawie. Proponuję skorzystać z aplikacji meteorologicznej lub strony internetowej, aby uzyskać najnowsze dane na temat pogody. Czy mogę pomóc w czymś innym?";
        handleN8nResponse(defaultText, entryId);
    }
    
    // Create a new conversation entry
    function addConversationEntry(entryId) {
        // Check if we have too many entries and remove the oldest
        const entries = conversationContainer.querySelectorAll('.conversation-entry');
        if (entries.length >= MAX_CONVERSATION_ENTRIES) {
            conversationContainer.removeChild(entries[0]);
        }
        
        // Create new entry
        const entryHtml = `
            <div id="${entryId}" class="conversation-entry">
                <div class="user-message">
                    <div class="message-status">Przetwarzanie...</div>
                    <div class="message-content loading"></div>
                </div>
                <div class="assistant-message hidden">
                    <div class="message-content"></div>
                    <div class="audio-controls hidden">
                        <button class="play-button btn-icon">
                            <i class="fas fa-play"></i> Odtwórz
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        // Add to container - at the bottom
        conversationContainer.insertAdjacentHTML('beforeend', entryHtml);
        conversationContainer.scrollTop = conversationContainer.scrollHeight;
        
        // Ensure the container is visible
        conversationContainer.classList.remove('hidden');
    }
    
    // Update conversation entry with transcription
    function updateConversationEntryWithTranscription(entryId, text) {
        const entry = document.getElementById(entryId);
        if (!entry) return;
        
        const messageStatus = entry.querySelector('.user-message .message-status');
        const messageContent = entry.querySelector('.user-message .message-content');
        
        messageStatus.textContent = 'Ty:';
        messageContent.textContent = text;
        messageContent.classList.remove('loading');
    }
    
    // Update conversation entry with response
    function updateConversationEntryWithResponse(entryId, text, audioUrl) {
        const entry = document.getElementById(entryId);
        if (!entry) return;
        
        const assistantMessage = entry.querySelector('.assistant-message');
        const messageContent = assistantMessage.querySelector('.message-content');
        const audioControls = assistantMessage.querySelector('.audio-controls');
        const playButton = audioControls.querySelector('.play-button');
        
        messageContent.textContent = text;
        assistantMessage.classList.remove('hidden');
        audioControls.classList.remove('hidden');
        
        // Set up play button
        playButton.addEventListener('click', () => {
            playAudioResponse(audioUrl, playButton);
        });
        
        // Scroll to show the new content
        conversationContainer.scrollTop = conversationContainer.scrollHeight;
    }
    
    // Update conversation entry with error
    function updateConversationEntryWithError(entryId, errorText) {
        const entry = document.getElementById(entryId);
        if (!entry) return;
        
        const messageStatus = entry.querySelector('.user-message .message-status');
        const messageContent = entry.querySelector('.user-message .message-content');
        
        messageStatus.textContent = 'Błąd:';
        messageStatus.style.color = 'red';
        messageContent.textContent = errorText;
        messageContent.classList.remove('loading');
    }
    
    // Update the status message
    function updateStatus() {
        if (!isListening) {
            statusMessage.textContent = 'Gotowy do słuchania';
            return;
        }
        
        if (activeRequests > 0) {
            statusMessage.textContent = `Ciągłe słuchanie aktywne... (${activeRequests} ${activeRequests === 1 ? 'zapytanie' : 'zapytania'} w toku)`;
        } else {
            statusMessage.textContent = 'Ciągłe słuchanie aktywne...';
        }
    }
    
    // Update visualization based on actual audio levels
    function updateVisualization(volume) {
        const bars = document.querySelectorAll('.visualization-bar');
        if (!bars.length) return;
        
        // Scale volume to visual height (0-50px)
        const scaledVolume = Math.min(50, volume * 1.5);
        
        // Update each bar with slight random variation for visual effect
        bars.forEach(bar => {
            const randomFactor = 0.8 + Math.random() * 0.4;
            const height = Math.max(3, scaledVolume * randomFactor);
            bar.style.height = `${height}px`;
        });
    }

    // Find supported MIME type
    function getSupportedMimeType() {
        // Try common audio formats in order of preference
        const mimeTypes = [
            'audio/mp3',
            'audio/mpeg',
            'audio/webm',
            'audio/ogg',
            'audio/wav'
        ];
        
        for (const type of mimeTypes) {
            if (MediaRecorder.isTypeSupported(type)) {
                console.log(`Przeglądarka wspiera nagrywanie w formacie ${type}`);
                return type;
            }
        }
        
        console.warn('Żaden z preferowanych typów MIME nie jest obsługiwany przez tę przeglądarkę');
        return null;
    }
    
    // Function to play audio response
    function playAudioResponse(audioUrl, buttonElement = null) {
        // Stop any currently playing audio
        audioPlayer.pause();
        audioPlayer.currentTime = 0;
        
        // Ensure the URL is absolute
        const absoluteUrl = audioUrl.startsWith('http') ? audioUrl : window.location.origin + audioUrl;
        
        // Set the new audio source
        audioPlayer.src = absoluteUrl;
        
        // Update button state if provided
        if (buttonElement) {
            buttonElement.disabled = true;
            buttonElement.innerHTML = '<i class="fas fa-volume-up"></i> Odtwarzanie...';
            
            // Reset button when playback ends
            audioPlayer.onended = () => {
                console.log('Odtwarzanie dźwięku zakończone');
                buttonElement.disabled = false;
                buttonElement.innerHTML = '<i class="fas fa-play"></i> Odtwórz';
            };
        }
        
        // Play the audio
        audioPlayer.play()
            .catch(error => {
                console.error('Błąd odtwarzania dźwięku:', error);
                showMessage('Błąd odtwarzania odpowiedzi dźwiękowej', 'error');
                
                // Reset button on error
                if (buttonElement) {
                    buttonElement.disabled = false;
                    buttonElement.innerHTML = '<i class="fas fa-play"></i> Odtwórz';
                }
            });
    }

    // Helper function to show messages
    function showMessage(message, type) {
        messageText.textContent = message;
        messageContainer.classList.remove('hidden', 'success', 'error');
        messageContainer.classList.add(type);
        
        // Auto-hide after 5 seconds
        setTimeout(() => {
            hideMessage();
        }, 5000);
    }

    // Helper function to hide messages
    function hideMessage() {
        messageContainer.classList.add('hidden');
    }

    // Add event listener for "Play Again" button
    document.getElementById('play-again-button').addEventListener('click', () => {
        if (audioPlayer.src) {
            audioPlayer.currentTime = 0;
            audioPlayer.play()
                .catch(error => {
                    console.error('Błąd odtwarzania dźwięku:', error);
                    showMessage('Błąd odtwarzania dźwięku', 'error');
                });
        }
    });
    
    // Show initial status
    statusMessage.textContent = 'Gotowy do słuchania';
});
