import os
import importlib
import logging
from fastapi import FastAPI
import uvicorn
from config import SERVER_CONFIG

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(
    title="ManufactureAI",
    description="Manufacturing AI Platform API",
    version="1.0.0",
    debug=SERVER_CONFIG["DEBUG"]
)

# Directories to skip (non-service)
SKIP_DIRS = {"venv", "__pycache__", "utils", "tests"}

def load_routers():
    """Load all router modules from service directories"""
    base_dir = os.path.dirname(os.path.abspath(__file__))
    loaded_routers = []
    failed_routers = []

    for folder in os.listdir(base_dir):
        folder_path = os.path.join(base_dir, folder)
        if os.path.isdir(folder_path) and folder not in SKIP_DIRS:
            try:
                # Import module: <folder>.api
                module = importlib.import_module(f"{folder}.api")
                router = getattr(module, "router", None)
                
                if router:
                    app.include_router(router, prefix=f"/{folder}")
                    loaded_routers.append(folder)
                    logger.info(f"✅ Router from '{folder}.api' loaded successfully")
                else:
                    failed_routers.append(folder)
                    logger.warning(f"⚠️  Module {folder}.api has no 'router' attribute")
            except ModuleNotFoundError:
                failed_routers.append(folder)
                logger.error(f"⛔ Module not found: {folder}.api")
            except Exception as e:
                failed_routers.append(folder)
                logger.error(f"❌ Error loading {folder}.api: {str(e)}")

    return loaded_routers, failed_routers

# Load all routers
loaded_routers, failed_routers = load_routers()

@app.get("/")
async def read_root():
    """Root endpoint with service status"""
    return {
        "message": "Welcome to ManufactureAI API",
        "version": "1.0.0",
        "loaded_services": loaded_routers,
        "failed_services": failed_routers,
        "server": {
            "host": SERVER_CONFIG["HOST"],
            "port": SERVER_CONFIG["PORT"],
            "debug": SERVER_CONFIG["DEBUG"]
        }
    }

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host=SERVER_CONFIG["HOST"],
        port=SERVER_CONFIG["PORT"],
        reload=SERVER_CONFIG["DEBUG"],
        reload_dirs=[os.path.dirname(os.path.abspath(__file__))]
    )