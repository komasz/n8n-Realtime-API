"""
Punkt wejścia dla Replit dla N8N Voice Interface z OpenAI Realtime API
"""
import os
import sys

# Dodaj bieżący katalog do ścieżki, aby importować z backend
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# Importuj i uruchom aplikację
from n8n_voice_interface.backend.app import app
import uvicorn

if __name__ == "__main__":
    # Pobierz port ze środowiska (Replit ustawia to)
    port = int(os.environ.get("PORT", 8080))
    
    print("Uruchamianie N8N Voice Interface z Realtime API...")
    print(f"Port: {port}")
    
    # Uruchom aplikację
    uvicorn.run(
        "n8n_voice_interface.backend.app:app", 
        host="0.0.0.0", 
        port=port,
        reload=False
    )
