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

from backend.webhook import send_to_n8n
from backend.realtime import create_realtime_session, format_n8n_response_for_realtime

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

# Model for the frontend configuration
class FrontendConfig(BaseModel):
    webhook_url: str

# Realtime API session request
class RealtimeSessionRequest(BaseModel):
    webhook_url: str
    model_type: Optional[str] = "standard"  # "standard" lub "mini"

# n8n response for realtime
class N8nRealtimeResponse(BaseModel):
    transcription: str
    session_id: str

# n8n response
class N8nResponse(BaseModel):
    text: str
    session_id: Optional[str] = None

# Create Realtime session endpoint
@app.post("/api/realtime/session")
async def create_session(request: RealtimeSessionRequest):
    """
    Create a new Realtime API session and return ephemeral token.
    """
    try:
        # Log webhook URL and model type
        logger.info(f"Creating session with webhook URL: {request.webhook_url}")
        logger.info(f"Using model type: {request.model_type}")
        
        # Create a new session with specified model type
        session_data = await create_realtime_session(model_type=request.model_type)
        
        # Store webhook URL with session ID
        session_id = session_data.get('id')
        if session_id:
            active_sessions[session_id] = {
                "webhook_url": request.webhook_url
            }
            logger.info(f"Stored webhook URL for session {session_id}: {request.webhook_url}")
            logger.info(f"Active sessions now: {active_sessions}")
        else:
            logger.error("No session ID received from create_realtime_session")
        
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
            logger.error(f"Session {session_id} not found in active sessions for webhook endpoint")
            logger.info(f"Active sessions: {active_sessions}")
            raise HTTPException(status_code=404, detail="Session not found")
            
        # Get the request body
        body = await request.json()
        logger.info(f"Received webhook request from n8n: {body}")
        
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
        logger.info(f"Received transcription to forward: {data.transcription}")
        logger.info(f"Session ID: {data.session_id}")
        
        # Get the webhook URL for this session
        session = active_sessions.get(data.session_id)
        if not session:
            logger.error(f"Session {data.session_id} not found in active sessions")
            logger.info(f"Active sessions: {active_sessions}")
            raise HTTPException(status_code=404, detail="Session not found")
            
        webhook_url = session["webhook_url"]
        logger.info(f"Found webhook URL for session: {webhook_url}")
        
        # Send the transcription to n8n
        logger.info(f"Sending to n8n: {data.transcription}")
        n8n_response = await send_to_n8n(webhook_url, {
            "transcription": data.transcription,
            "session_id": data.session_id
        })
        
        logger.info(f"Received response from n8n: {n8n_response}")
        return n8n_response
    except Exception as e:
        logger.error(f"Error forwarding to n8n: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

# Config endpoint to get frontend configuration
@app.get("/api/config")
async def get_config():
    """
    Get configuration for the frontend.
    """
    return {
        "realtime_api_enabled": True,
        "version": "2.0.0",
        "available_models": ["standard", "mini"]  # Dodano dostępne modele
    }

# Health check endpoint
@app.get("/api/health")
async def health_check():
    """
    Health check endpoint to verify the API is running.
    """
    return {"status": "ok"}

# Mount static files for the frontend
app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")

# Run the application
if __name__ == "__main__":
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("app:app", host="0.0.0.0", port=port, reload=True)
