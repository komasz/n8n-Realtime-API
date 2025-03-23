document.addEventListener('DOMContentLoaded', () => {
    // UI elements
    const startButton = document.getElementById('start-button');
    const recordButton = document.getElementById('record-button');
    const stopButton = document.getElementById('stop-button');
    const statusMessage = document.getElementById('status-message');
    const connectionStatus = document.getElementById('connection-status');
    const visualizationContainer = document.getElementById('visualization-container');
    const conversationContainer = document.getElementById('conversation-container');
    const messageContainer = document.getElementById('message-container');
    const messageText = document.getElementById('message-text');
    const webhookUrlInput = document.getElementById('webhook-url');
    const saveSettingsButton = document.getElementById('save-settings');
    
    // Application state
    let peerConnection = null;
    let dataChannel = null;
    let audioElement = null;
    let localStream = null;
    let ephemeralToken = null;
    let sessionId = null;
    let isListening = false;
    let conversationEntryCount = 0;
    const MAX_CONVERSATION_ENTRIES = 10;
    let isProcessingTranscription = false;
    
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

    // Start button - Initialize WebRTC session
    startButton.addEventListener('click', async () => {
        await initializeRealtimeSession();
    });

    // Record button - Toggle listening mode
    recordButton.addEventListener('click', () => {
        if (!isListening) {
            startListening();
        } else {
            stopListening();
        }
    });

    // Stop button - End WebRTC session
    stopButton.addEventListener('click', () => {
        endRealtimeSession();
    });

    // Initialize Realtime session via WebRTC
    async function initializeRealtimeSession() {
        try {
            const webhookUrl = localStorage.getItem('webhookUrl');
            if (!webhookUrl) {
                showMessage('Proszę najpierw ustawić adres URL webhooka N8N w ustawieniach', 'error');
                return;
            }
            
            statusMessage.textContent = 'Inicjalizacja sesji Realtime...';
            updateConnectionStatus('Łączenie...');
            
            // Disable start button during initialization
            startButton.disabled = true;
            
            // Request ephemeral token from our backend
            const tokenResponse = await fetch('/api/realtime/session', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    webhook_url: webhookUrl
                })
            });
            
            if (!tokenResponse.ok) {
                throw new Error('Nie udało się utworzyć sesji Realtime');
            }
            
            const data = await tokenResponse.json();
            ephemeralToken = data.client_secret.value;
            sessionId = data.id;
            
            console.log(`Uzyskano token sesji: ${sessionId}`);
            
            // Create WebRTC peer connection
            await setupWebRTC();
            
            // Update UI
            statusMessage.textContent = 'Sesja Realtime zainicjalizowana';
            recordButton.disabled = false;
            stopButton.disabled = false;
            startButton.disabled = true;
            updateConnectionStatus('Połączony');
            showMessage('Sesja Realtime zainicjalizowana. Kliknij mikrofon, aby zacząć mówić.', 'success');
            
            // Configure session for Polish language
            setTimeout(() => {
                sendPolishLanguageConfig();
            }, 1000); // Wait a second before sending configuration
            
        } catch (error) {
            console.error('Błąd podczas inicjalizacji sesji:', error);
            showMessage(`Błąd: ${error.message}`, 'error');
            startButton.disabled = false;
            updateConnectionStatus('Błąd połączenia');
            statusMessage.textContent = 'Błąd inicjalizacji';
        }
    }
    
    // Send Polish language configuration
    function sendPolishLanguageConfig() {
        if (!dataChannel || dataChannel.readyState !== 'open') {
            console.error('Kanał danych nie jest otwarty');
            return;
        }
        
        // Send session update with Polish language configuration
        const polishConfig = {
            type: "session.update",
            session: {
                instructions: "Będziesz prowadzić rozmowy po polsku. Gdy użytkownik mówi po polsku, odpowiadaj również po polsku. Staraj się mówić naturalnym, konwersacyjnym językiem.",
                turn_detection: {
                    type: "semantic_vad",
                    eagerness: "high", 
                    create_response: true,
                    interrupt_response: true
                },
                include: ["item.input_audio_transcription.logprobs"]
            }
        };
        
        console.log('Wysyłanie konfiguracji języka polskiego:', polishConfig);
        dataChannel.send(JSON.stringify(polishConfig));
    }
    
    // Setup WebRTC connection
    async function setupWebRTC() {
        try {
            // Create a peer connection
            peerConnection = new RTCPeerConnection();
            
            // Setup data channel for events
            dataChannel = peerConnection.createDataChannel('oai-events');
            dataChannel.onopen = handleDataChannelOpen;
            dataChannel.onmessage = handleDataChannelMessage;
            dataChannel.onclose = handleDataChannelClose;
            dataChannel.onerror = handleDataChannelError;
            
            // Set up audio element for playing remote audio
            audioElement = new Audio();
            audioElement.autoplay = true;
            
            // Handle remote tracks (audio from OpenAI)
            peerConnection.ontrack = (event) => {
                console.log('Otrzymano zdalną ścieżkę audio');
                audioElement.srcObject = event.streams[0];
            };
            
            // Setup local audio for WebRTC
            localStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });
            
            // Add local stream to peer connection
            localStream.getTracks().forEach(track => {
                peerConnection.addTrack(track, localStream);
            });
            
            // Create and set local description (offer)
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            
            // Send SDP offer to OpenAI Realtime API
            const baseUrl = "https://api.openai.com/v1/realtime";
            const model = "gpt-4o-realtime-preview-2024-12-17";
            const sdpResponse = await fetch(`${baseUrl}?model=${model}`, {
                method: "POST",
                body: offer.sdp,
                headers: {
                    Authorization: `Bearer ${ephemeralToken}`,
                    "Content-Type": "application/sdp"
                },
            });
            
            if (!sdpResponse.ok) {
                const errorText = await sdpResponse.text();
                throw new Error(`Błąd SDP: ${errorText}`);
            }
            
            // Get and set remote description (answer)
            const answer = {
                type: "answer",
                sdp: await sdpResponse.text(),
            };
            await peerConnection.setRemoteDescription(answer);
            
            console.log('Połączenie WebRTC ustanowione');
            
        } catch (error) {
            console.error('Błąd podczas konfiguracji WebRTC:', error);
            throw error;
        }
    }
    
    // Start listening mode
    function startListening() {
        if (!peerConnection || !dataChannel) {
            showMessage('Sesja nie została zainicjalizowana', 'error');
            return;
        }
        
        isListening = true;
        recordButton.classList.add('recording');
        statusMessage.textContent = 'Słucham...';
        visualizationContainer.classList.add('active-visualization');
        
        // Start animation for visualization
        animateVisualization();
        
        showMessage('Możesz zacząć mówić. System automatycznie wykryje koniec wypowiedzi.', 'success');
    }
    
    // Stop listening mode
    function stopListening() {
        isListening = false;
        recordButton.classList.remove('recording');
        statusMessage.textContent = 'Wstrzymano słuchanie';
        visualizationContainer.classList.remove('active-visualization');
        
        showMessage('Słuchanie wstrzymane.', 'info');
    }
    
    // End the WebRTC session
    function endRealtimeSession() {
        // Stop listening if active
        if (isListening) {
            stopListening();
        }
        
        // Close data channel
        if (dataChannel) {
            dataChannel.close();
            dataChannel = null;
        }
        
        // Close peer connection
        if (peerConnection) {
            peerConnection.close();
            peerConnection = null;
        }
        
        // Stop local media tracks
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
            localStream = null;
        }
        
        // Reset audio element
        if (audioElement) {
            audioElement.srcObject = null;
            audioElement = null;
        }
        
        // Reset application state
        ephemeralToken = null;
        sessionId = null;
        isListening = false;
        
        // Update UI
        startButton.disabled = false;
        recordButton.disabled = true;
        stopButton.disabled = true;
        statusMessage.textContent = 'Sesja zakończona';
        updateConnectionStatus('Rozłączony');
        
        showMessage('Sesja Realtime zakończona.', 'info');
    }
    
    // Handle data channel events
    function handleDataChannelOpen(event) {
        console.log('Kanał danych otwarty', event);
    }
    
    function handleDataChannelClose(event) {
        console.log('Kanał danych zamknięty', event);
    }
    
    function handleDataChannelError(event) {
        console.error('Błąd kanału danych', event);
        showMessage('Błąd komunikacji z OpenAI', 'error');
    }
    
    // Process messages from OpenAI
    async function handleDataChannelMessage(event) {
        try {
            const data = JSON.parse(event.data);
            console.log('Otrzymano wiadomość:', data);
            
            // Handle different event types
            switch (data.type) {
                case 'session.created':
                    console.log('Sesja utworzona', data);
                    break;
                    
                case 'session.updated':
                    console.log('Sesja zaktualizowana', data);
                    break;
                    
                case 'input_audio_buffer.speech_started':
                    console.log('Rozpoczęcie mowy wykryte');
                    // Add new conversation entry placeholder
                    if (!isProcessingTranscription) {
                        const entryId = `entry-${Date.now()}`;
                        addConversationEntry(entryId, 'user');
                        isProcessingTranscription = true;
                    }
                    break;
                    
                case 'input_audio_buffer.speech_stopped':
                    console.log('Koniec mowy wykryty');
                    break;
                    
                case 'conversation.item.created':
                    console.log('Element konwersacji utworzony', data);
                    break;
                    
                case 'conversation.item.input_audio_transcription.completed':
                    handleTranscriptionCompleted(data);
                    break;
                    
                case 'response.created':
                    console.log('Odpowiedź utworzona', data);
                    // Add assistant entry placeholder
                    const responseEntryId = `response-${Date.now()}`;
                    addConversationEntry(responseEntryId, 'assistant');
                    break;
                    
                case 'response.text.delta':
                    // Update assistant message with incremental text
                    updateAssistantMessage(data);
                    break;
                    
                case 'response.done':
                    console.log('Odpowiedź zakończona', data);
                    isProcessingTranscription = false;
                    break;
                    
                default:
                    console.log('Nieobsługiwany typ zdarzenia:', data.type);
            }
        } catch (error) {
            console.error('Błąd podczas przetwarzania wiadomości:', error);
        }
    }
    
    // Handle transcription completed event
    async function handleTranscriptionCompleted(data) {
        console.log('Transkrypcja zakończona', data);
        
        try {
            // Extract transcription text and item ID
            const transcription = data.transcript;
            const itemId = data.item_id;
            
            // Update conversation UI with transcription
            updateUserMessage(itemId, transcription);
            
            // Forward transcription to n8n
            if (sessionId) {
                // Send transcription to our backend to forward to n8n
                const response = await fetch('/api/forward-to-n8n', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        transcription: transcription,
                        session_id: sessionId
                    })
                });
                
                if (!response.ok) {
                    throw new Error('Nie udało się przekazać transkrypcji do n8n');
                }
                
                console.log('Transkrypcja przekazana do n8n');
            }
        } catch (error) {
            console.error('Błąd podczas obsługi transkrypcji:', error);
            showMessage(`Błąd: ${error.message}`, 'error');
        }
    }
    
    // Send event to OpenAI via data channel
    function sendEvent(event) {
        if (dataChannel && dataChannel.readyState === 'open') {
            dataChannel.send(JSON.stringify(event));
        } else {
            console.error('Kanał danych nie jest otwarty');
        }
    }
    
    // Create a new conversation entry
    function addConversationEntry(entryId, role) {
        // Check if we have too many entries and remove the oldest
        const entries = conversationContainer.querySelectorAll('.conversation-entry');
        if (entries.length >= MAX_CONVERSATION_ENTRIES) {
            conversationContainer.removeChild(entries[0]);
        }
        
        // Create new entry
        const entryHtml = role === 'user' 
            ? `
                <div id="${entryId}" class="conversation-entry user-entry">
                    <div class="user-message">
                        <div class="message-status">Ty:</div>
                        <div class="message-content loading"></div>
                    </div>
                </div>
            `
            : `
                <div id="${entryId}" class="conversation-entry assistant-entry">
                    <div class="assistant-message">
                        <div class="message-status">Asystent:</div>
                        <div class="message-content loading"></div>
                    </div>
                </div>
            `;
        
        // Add to container - at the bottom
        conversationContainer.insertAdjacentHTML('beforeend', entryHtml);
        conversationContainer.scrollTop = conversationContainer.scrollHeight;
        
        // Ensure the container is visible
        conversationContainer.classList.remove('hidden');
    }
    
    // Update user message with transcription
    function updateUserMessage(itemId, text) {
        // Find the most recent user entry
        const entries = document.querySelectorAll('.user-entry');
        if (entries.length === 0) return;
        
        const entry = entries[entries.length - 1];
        const messageContent = entry.querySelector('.message-content');
        
        if (messageContent) {
            messageContent.textContent = text;
            messageContent.classList.remove('loading');
            
            // Set data-item-id to correlate with OpenAI item
            entry.dataset.itemId = itemId;
        }
    }
    
    // Update assistant message with text
    function updateAssistantMessage(data) {
        // Find the most recent assistant entry
        const entries = document.querySelectorAll('.assistant-entry');
        if (entries.length === 0) return;
        
        const entry = entries[entries.length - 1];
        const messageContent = entry.querySelector('.message-content');
        
        if (messageContent) {
            // If it's still showing loading, remove that and set initial text
            if (messageContent.classList.contains('loading')) {
                messageContent.textContent = data.delta;
                messageContent.classList.remove('loading');
            } else {
                // Append delta text
                messageContent.textContent += data.delta;
            }
            
            // Scroll to bottom of conversation
            conversationContainer.scrollTop = conversationContainer.scrollHeight;
        }
    }
    
    // Animate visualization
    function animateVisualization() {
        if (!isListening) return;
        
        const bars = document.querySelectorAll('.visualization-bar');
        
        bars.forEach(bar => {
            const height = Math.floor(Math.random() * 30) + 5;
            bar.style.height = `${height}px`;
        });
        
        requestAnimationFrame(animateVisualization);
    }
    
    // Update connection status display
    function updateConnectionStatus(status) {
        connectionStatus.textContent = status;
    }
    
    // Helper function to show messages
    function showMessage(message, type) {
        messageText.textContent = message;
        messageContainer.classList.remove('hidden', 'success', 'error', 'info');
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
});
