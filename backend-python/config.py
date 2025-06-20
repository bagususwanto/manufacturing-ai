import os
from typing import Dict, Any

# API Configuration
API_CONFIG: Dict[str, Any] = {
    "API_URL": os.getenv("API_URL", "http://wh-backend-1:5010/api/inventory-material-all"),
    "QDRANT_URL": os.getenv("QDRANT_URL", "http://qdrant:6333"),
    "MODEL_NAME": os.getenv("MODEL_NAME", "intfloat/multilingual-e5-small"),
    "COLLECTION_NAME": os.getenv("COLLECTION_NAME", "material_vectors"),
}

# Server Configuration
SERVER_CONFIG: Dict[str, Any] = {
    "HOST": os.getenv("HOST", "0.0.0.0"),
    "PORT": int(os.getenv("PORT", "8000")),
    "DEBUG": os.getenv("DEBUG", "False").lower() == "true",
}

# Model Configuration
MODEL_CONFIG: Dict[str, Any] = {
    "BATCH_SIZE": int(os.getenv("BATCH_SIZE", "20")),
    "MAX_WORKERS": int(os.getenv("MAX_WORKERS", "5")),
    "DELAY_BETWEEN_BATCHES": float(os.getenv("DELAY_BETWEEN_BATCHES", "0.1")),
    "DEFAULT_LIMIT": int(os.getenv("MODEL_DEFAULT_LIMIT", "5")),
    "SCORE_THRESHOLD": float(os.getenv("MODEL_SCORE_THRESHOLD", "0.5")),
}

# Search Configuration
SEARCH_CONFIG: Dict[str, Any] = {
    "DEFAULT_LIMIT": int(os.getenv("SEARCH_DEFAULT_LIMIT", "5")),
    "SCORE_THRESHOLD": float(os.getenv("SEARCH_SCORE_THRESHOLD", "0.5")),
}

# Export individual variables for backward compatibility
API_URL = API_CONFIG["API_URL"]
QDRANT_URL = API_CONFIG["QDRANT_URL"]
MODEL_NAME = API_CONFIG["MODEL_NAME"]
COLLECTION_NAME = API_CONFIG["COLLECTION_NAME"]