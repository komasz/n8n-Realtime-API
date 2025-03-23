"""
Punkt wejścia dla Replit dla N8N Voice Interface z OpenAI Realtime API
"""
import os
import sys

# Dodaj bieżący katalog i potencjalne podkatalogi do ścieżki Python
current_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.append(current_dir)

# Jeśli katalog backend jest w podkatalogu n8n-voice-interface
if os.path.exists(os.path.join(current_dir, 'n8n-voice-interface')):
    sys.path.append(os.path.join(current_dir, 'n8n-voice-interface'))

# Sprawdź, czy katalog backend istnieje bezpośrednio w głównym katalogu
if os.path.exists(os.path.join(current_dir, 'backend')):
    # Importuj bezpośrednio z backend
    from backend.app import app
else:
    # Spróbuj importować z n8n-voice-interface/backend
    from n8n_voice_interface.backend.app import app

import uvicorn

if __name__ == "__main__":
    # Pobierz port ze środowiska (Replit ustawia to)
    port = int(os.environ.get("PORT", 8080))
    
    print("Uruchamianie N8N Voice Interface z Realtime API...")
    print(f"Port: {port}")
    
    # Lokalizuj app dynamicznie
    app_module = "backend.app:app"
    
    # Uruchom aplikację
    uvicorn.run(
        app_module, 
        host="0.0.0.0", 
        port=port,
        reload=False
    )
