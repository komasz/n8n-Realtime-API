import logging
import json
import aiohttp
from typing import Dict, Any, Optional, Union

# Configure logging
logger = logging.getLogger(__name__)

async def send_to_n8n(webhook_url: str, data: Dict[str, Any]) -> Union[Dict[str, Any], bool]:
    """
    Send data to n8n webhook and return the response if available.
    
    Args:
        webhook_url: The n8n webhook URL to send data to
        data: The data to send (will be converted to JSON)
    
    Returns:
        The n8n response as a dict if available, or True/False for success/failure
    """
    try:
        logger.info(f"Sending data to n8n webhook: {webhook_url}")
        
        # Create a JSON payload
        payload = {
            "transcription": data.get("transcription", ""),
            "timestamp": data.get("timestamp", ""),
            "metadata": {
                "source": "n8n-voice-interface",
                "version": "1.0.0"
            }
        }
        
        # Set up headers
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json"
        }
        
        # Send the request
        async with aiohttp.ClientSession() as session:
            async with session.post(
                webhook_url, 
                data=json.dumps(payload),
                headers=headers
            ) as response:
                # Check response
                if response.status == 200:
                    try:
                        # Try to parse the response as JSON
                        response_text = await response.text()
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
                        return True
                else:
                    error_text = await response.text()
                    logger.error(f"Webhook failed with status {response.status}: {error_text}")
                    return False
    
    except Exception as e:
        logger.error(f"Error sending webhook: {str(e)}", exc_info=True)
        return False
