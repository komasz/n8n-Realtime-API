import os
import logging
import requests
from typing import Dict, Any, Optional

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Constants
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
API_URL = "https://api.openai.com/v1/realtime/sessions"

async def create_realtime_session() -> Dict[str, Any]:
    """
    Create a new Realtime API session with OpenAI.
    
    Returns:
        A dictionary containing session details, including client_secret token
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
        
        # Session configuration - setup for Polish language
        # Without using extra_init_events which is not supported
        payload = {
            "model": "gpt-4o-realtime-preview-2024-12-17", # Use the latest available model
            "voice": "ash", # Voice to use for TTS
            # Instructions for Polish language will be sent as a session.update event
            # after the session is created by the client
        }
        
        # Make the API request
        response = requests.post(API_URL, headers=headers, json=payload)
        
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

async def format_n8n_response_for_realtime(text: str, session_id: str) -> Dict[str, Any]:
    """
    Format an n8n text response for sending through the Realtime API.
    
    Args:
        text: The text response from n8n
        session_id: The Realtime session ID
    
    Returns:
        A dictionary formatted for the Realtime API
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
