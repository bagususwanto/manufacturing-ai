import os
import importlib
from fastapi import FastAPI
import uvicorn

app = FastAPI(title="ManufactureAI")

# Direktori yang harus di-skip (non-service)
SKIP_DIRS = {"venv", "__pycache__", "utils"}

# Loop semua folder dalam direktori ini
base_dir = os.path.dirname(os.path.abspath(__file__))

for folder in os.listdir(base_dir):
    folder_path = os.path.join(base_dir, folder)
    if os.path.isdir(folder_path) and folder not in SKIP_DIRS:
        try:
            # Import modul: <folder>.api
            module = importlib.import_module(f"{folder}.api")
            router = getattr(module, "router", None)
            if router:
                app.include_router(router, prefix=f"/{folder}")
                print(f"✅ Router dari '{folder}.api' di-load.")
            else:
                print(f"⚠️  Modul {folder}.api tidak punya 'router'.")
        except ModuleNotFoundError:
            print(f"⛔ Tidak ditemukan: {folder}.api")
        except Exception as e:
            print(f"❌ Error load {folder}.api: {e}")

# Tambahkan endpoint root di sini
@app.get("/")
def read_root():
    return {"message": "Welcome to ManufactureAI API."}

if __name__ == "__main__":
    uvicorn.run(
        "script:app",  # Format: "filename:app_variable"
        host="0.0.0.0", 
        port=8000,
        reload=True,  # Enable auto-reload
        reload_dirs=[base_dir]  # Watch current directory
    )