# production/api.py
from fastapi import APIRouter, HTTPException
from typing import Dict, Any
import logging
from config import SERVER_CONFIG

# Setup logging
logger = logging.getLogger(__name__)

# Create APIRouter
router = APIRouter(
    prefix="/production",
    tags=["production"],
    responses={404: {"description": "Not found"}},
)

@router.get("/")
async def production_root():
    """Root endpoint for production service"""
    return {
        "message": "Production Service API",
        "status": "running",
        "version": "1.0.0",
        "debug_mode": SERVER_CONFIG["DEBUG"]
    }

@router.get("/status")
async def status():
    """Get production service status"""
    return {
        "module": "production",
        "status": "ok",
        "version": "1.0.0",
        "server": {
            "host": SERVER_CONFIG["HOST"],
            "port": SERVER_CONFIG["PORT"],
            "debug": SERVER_CONFIG["DEBUG"]
        }
    }

@router.get("/health")
async def health_check():
    """Health check endpoint"""
    try:
        return {
            "status": "healthy",
            "service": "production",
            "version": "1.0.0",
            "server": {
                "host": SERVER_CONFIG["HOST"],
                "port": SERVER_CONFIG["PORT"]
            }
        }
    except Exception as e:
        logger.error(f"Health check failed: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Health check failed: {str(e)}"
        )
