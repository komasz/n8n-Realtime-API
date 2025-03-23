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

# Dostępne modele
MODELS = {
    "standard": "gpt-4o-transcribe",
    "mini": "gpt-4o-mini-transcribe"
}

async def create_realtime_session(model_type="standard") -> Dict[str, Any]:
    """
    Create a new Realtime API session with OpenAI.
    
    Args:
        model_type: Typ modelu do użycia ("standard" lub "mini")
    
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
        
        # Wybierz model na podstawie parametru model_type
        model = MODELS.get(model_type, MODELS["standard"])
        
        # Konfiguracja sesji
        payload = {
            "model": model,  # Używamy modelu transkrypcji
            "voice": "alloy",  # Użyj głosu alloy
        }
        
        logger.info(f"Creating Realtime session with payload: {payload}")
        
        # Make the API request
        response = requests.post(API_URL, headers=headers, json=payload)
        
        # Check for errors
        if response.status_code != 200:
            logger.error(f"OpenAI API error: {response.status_code} - {response.text}")
            raise Exception(f"Failed to create Realtime session: {response.text}")
        
        # Return session data including ephemeral token
        session_data = response.json()
        logger.info(f"Created Realtime session with ID: {session_data.get('id')}")
        logger.info(f"Using model: {model}")
        logger.info(f"Session data: {session_data}")
        
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
    logger.info(f"Formatting n8n response for Realtime API: {text}")
    
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
