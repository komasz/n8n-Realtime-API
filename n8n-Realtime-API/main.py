"""
Prosty plik uruchomieniowy dla aplikacji N8N Voice Interface z Realtime API
"""
import logging
import os
import json
from typing import Optional, Dict, Any
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn
import requests

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(
    title="N8N Voice Interface with Realtime API",
    description="A voice interface for n8n workflows using OpenAI's Realtime API",
    version="2.0.0"
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, set specific origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Store active realtime sessions
active_sessions = {}

# Constants for OpenAI API
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
REALTIME_API_URL = "https://api.openai.com/v1/realtime/sessions"

# Model for the frontend configuration
class FrontendConfig(BaseModel):
    webhook_url: str

# Realtime API session request
class RealtimeSessionRequest(BaseModel):
    webhook_url: str

# n8n response for realtime
class N8nRealtimeResponse(BaseModel):
    transcription: str
    session_id: str

# n8n response
class N8nResponse(BaseModel):
    text: str
    session_id: Optional[str] = None

# Webhook send function
async def send_to_n8n(webhook_url: str, data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Send data to n8n webhook and return the response.
    """
    try:
        logger.info(f"Sending data to n8n webhook: {webhook_url}")
        
        # Create a JSON payload
        payload = {
            "transcription": data.get("transcription", ""),
            "session_id": data.get("session_id", ""),
            "timestamp": data.get("timestamp", ""),
            "metadata": {
                "source": "n8n-voice-interface",
                "version": "2.0.0"
            }
        }
        
        # Set up headers
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json"
        }
        
        # Send the request
        response = requests.post(webhook_url, headers=headers, json=payload)
        
        # Check response
        if response.status_code == 200:
            try:
                # Try to parse as JSON
                response_text = response.text
                logger.info(f"Webhook successful. Response: {response_text}")
                
                try:
                    response_json = json.loads(response_text)
                    
                    # Check if the response has a text field
                    if isinstance(response_json, dict) and "text" in response_json:
                        return response_json
                    else:
                        # Try to extract text from different formats
                        if isinstance(response_json, dict):
                            # Try common formats
                            for key in ["message", "response", "content", "result"]:
                                if key in response_json and isinstance(response_json[key], str):
                                    return {"text": response_json[key]}
                        
                        # If response is just a string, wrap it
                        if isinstance(response_json, str):
                            return {"text": response_json}
                        
                        # If we can't find a text field, use the whole response as text
                        return {"text": response_text}
                except json.JSONDecodeError:
                    # If it's not JSON, use the raw text
                    return {"text": response_text}
            except Exception as e:
                logger.error(f"Error parsing webhook response: {str(e)}")
                return {"text": "Error parsing response from webhook"}
        else:
            error_text = response.text
            logger.error(f"Webhook failed with status {response.status_code}: {error_text}")
            return {"text": f"Webhook error {response.status_code}"}
    
    except Exception as e:
        logger.error(f"Error sending webhook: {str(e)}", exc_info=True)
        return {"text": f"Error connecting to webhook: {str(e)}"}

# Realtime session creation function
async def create_realtime_session() -> Dict[str, Any]:
    """
    Create a new Realtime API session with OpenAI.
    """
    if not OPENAI_API_KEY:
        logger.error("OpenAI API key not found in environment")
        raise Exception("OPENAI_API_KEY environment variable not set")
    
    try:
        # Setup headers for API request
        headers = {
            "Authorization": f"Bearer {OPENAI_API_KEY}",
            "Content-Type": "application/json",
            "OpenAI-Beta": "realtime=v1" # Required for beta access
        }
        
        # Session configuration - updated to remove extra_init_events
        payload = {
            "model": "gpt-4o-realtime-preview-2024-12-17",
            "voice": "ash"
            # Polish language configuration will be sent by client after connection
        }
        
        # Make the API request
        response = requests.post(REALTIME_API_URL, headers=headers, json=payload)
        
        # Check for errors
        if response.status_code != 200:
            logger.error(f"OpenAI API error: {response.status_code} - {response.text}")
            raise Exception(f"Failed to create Realtime session: {response.text}")
        
        # Return session data including ephemeral token
        session_data = response.json()
        logger.info(f"Created Realtime session with ID: {session_data.get('id')}")
        
        return session_data
        
    except Exception as e:
        logger.error(f"Error creating Realtime session: {str(e)}", exc_info=True)
        raise Exception(f"Realtime session error: {str(e)}")

# Format n8n response for Realtime API
async def format_n8n_response_for_realtime(text: str, session_id: str) -> Dict[str, Any]:
    """
    Format an n8n text response for sending through the Realtime API.
    """
    # Create a conversation.item.create event for the assistant's message
    return {
        "type": "conversation.item.create",
        "item": {
            "type": "message",
            "role": "assistant",
            "content": [
                {
                    "type": "input_text",
                    "text": text
                }
            ]
        }
    }

# Create Realtime session endpoint
@app.post("/api/realtime/session")
async def create_session(request: RealtimeSessionRequest):
    """
    Create a new Realtime API session and return ephemeral token.
    """
    try:
        # Create a new session
        session_data = await create_realtime_session()
        
        # Store webhook URL with session ID
        session_id = session_data.get('id')
        if session_id:
            active_sessions[session_id] = {
                "webhook_url": request.webhook_url
            }
        
        return session_data
    except Exception as e:
        logger.error(f"Error creating session: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

# Process n8n response for Realtime API
@app.post("/api/realtime/n8n-response")
async def process_n8n_response(response: N8nResponse):
    """
    Process a response from n8n and format it for Realtime API.
    """
    try:
        if not response.session_id:
            raise HTTPException(status_code=400, detail="Session ID is required")
            
        # Format the response for Realtime API
        realtime_event = await format_n8n_response_for_realtime(
            response.text, 
            response.session_id
        )
        
        return realtime_event
    except Exception as e:
        logger.error(f"Error processing n8n response: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

# Webhook endpoint for n8n to send transcription to
@app.post("/api/webhook/{session_id}")
async def n8n_webhook(session_id: str, request: Request):
    """
    Webhook endpoint for n8n to send responses back.
    """
    try:
        # Get the webhook URL for this session
        session = active_sessions.get(session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
            
        # Get the request body
        body = await request.json()
        
        # Return the response formatted for Realtime API
        realtime_event = await format_n8n_response_for_realtime(
            body.get("text", ""), 
            session_id
        )
        
        return realtime_event
    except Exception as e:
        logger.error(f"Error handling webhook: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

# Forward transcription to n8n webhook
@app.post("/api/forward-to-n8n")
async def forward_to_n8n(data: N8nRealtimeResponse):
    """
    Forward transcription from Realtime API to n8n webhook.
    """
    try:
        # Get the webhook URL for this session
        session = active_sessions.get(data.session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
            
        webhook_url = session["webhook_url"]
        
        # Send the transcription to n8n
        n8n_response = await send_to_n8n(webhook_url, {
            "transcription": data.transcription,
            "session_id": data.session_id
        })
        
        return n8n_response
    except Exception as e:
        logger.error(f"Error forwarding to n8n: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

# Config endpoint to get frontend configuration
@app.get("/api/config")
async def get_config():
    """
    Get configuration for the frontend.
    """
    return {
        "realtime_api_enabled": True,
        "version": "2.0.0"
    }

# Health check endpoint
@app.get("/api/health")
async def health_check():
    """
    Health check endpoint to verify the API is running.
    """
    return {"status": "ok"}

# Statyczna ścieżka do plików frontendowych
static_files_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "frontend")

# Sprawdź, czy katalog frontend istnieje
if os.path.exists(static_files_path):
    # Mount static files for the frontend
    app.mount("/", StaticFiles(directory=static_files_path, html=True), name="frontend")
else:
    logger.warning(f"Katalog frontend nie znaleziony: {static_files_path}")

# Uruchom aplikację bezpośrednio
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    print(f"Uruchamianie aplikacji na porcie {port}")
    uvicorn.run(app, host="0.0.0.0", port=port)
