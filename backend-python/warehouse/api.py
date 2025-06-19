# warehouse/api.py
from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel
from typing import Dict, Any, Optional
import logging
import traceback
from config import API_CONFIG, MODEL_CONFIG, SEARCH_CONFIG
from warehouse.services.material_service import MaterialService
from warehouse.services.job_service import JobService

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize services
material_service = None
job_service = JobService()

class ProcessingRequest(BaseModel):
    api_url: str = API_CONFIG["API_URL"]
    qdrant_url: str = API_CONFIG["QDRANT_URL"]
    model_name: str = API_CONFIG["MODEL_NAME"]
    collection_name: str = API_CONFIG["COLLECTION_NAME"]
    batch_size: int = MODEL_CONFIG["BATCH_SIZE"]
    max_workers: int = MODEL_CONFIG["MAX_WORKERS"]
    delay_between_batches: float = MODEL_CONFIG["DELAY_BETWEEN_BATCHES"]

class SearchRequest(BaseModel):
    query: str
    limit: int = SEARCH_CONFIG["DEFAULT_LIMIT"]
    score_threshold: float = SEARCH_CONFIG["SCORE_THRESHOLD"]
    status: Optional[str]

async def initialize_material_service():
    """Initialize the material service"""
    global material_service
    
    if material_service is None:
        try:
            material_service = MaterialService()
            logger.info("Material service initialized successfully")
        except Exception as e:
            logger.error(f"Failed to initialize material service: {e}")
            logger.error(traceback.format_exc())
            raise

async def ensure_material_service_initialized():
    """Ensure material service is initialized before use"""
    if material_service is None:
        await initialize_material_service()

# Create APIRouter
router = APIRouter()

@router.get("/")
async def warehouse_root():
    """Root endpoint for warehouse service"""
    await ensure_material_service_initialized()
    return {
        "message": "Material Vector Processing API",
        "status": "running" if material_service else "initialization_failed"
    }

@router.get("/health")
async def health_check():
    """Health check endpoint"""
    await ensure_material_service_initialized()
    
    try:
        # Test model loading
        test_text = "test embedding"
        test_vector = material_service.model.encode(test_text)
        
        return {
            "status": "healthy",
            "model": getattr(material_service.model, 'model_name', 'unknown'),
            "vector_dimension": len(test_vector),
            "qdrant_url": material_service.qdrant_url
        }
    except Exception as e:
        return {
            "status": "unhealthy",
            "error": str(e)
        }

@router.post("/process-materials")
async def process_materials(request: ProcessingRequest, background_tasks: BackgroundTasks):
    """Process materials endpoint"""
    await ensure_material_service_initialized()
    
    # Create new job
    job_id = job_service.create_job()
    
    # Add background task
    background_tasks.add_task(
        process_materials_background,
        job_id,
        request
    )
    
    return {"job_id": job_id, "message": "Processing started in background"}

async def process_materials_background(job_id: str, request: ProcessingRequest):
    """Background task for processing materials"""
    try:
        # Update job status
        job_service.update_job(
            job_id,
            status="running",
            message="Processing materials..."
        )
        
        # Create custom material service with request config
        custom_service = MaterialService(
            api_url=request.api_url,
            qdrant_url=request.qdrant_url,
            model_name=request.model_name,
            collection_name=request.collection_name
        )
        
        # Progress callback
        async def progress_callback(progress, processed, total):
            job_service.update_job(
                job_id,
                progress=progress,
                processed=processed,
                total=total,
                message=f"Processing... {progress:.1f}% ({processed}/{total})"
            )
        
        # Process materials
        result = await custom_service.process_all_materials(
            batch_size=request.batch_size,
            max_workers=request.max_workers,
            delay_between_batches=request.delay_between_batches,
            progress_callback=progress_callback
        )
        
        # Update job status
        job_service.update_job(
            job_id,
            status="completed",
            progress=100,
            message="Processing completed successfully",
            processed=result.get("processed", 0),
            failed=result.get("failed", 0),
            total=result.get("total_materials", 0)
        )
        
    except Exception as e:
        error_msg = f"Processing failed: {str(e)}"
        logger.error(f"Job {job_id} failed: {e}")
        logger.error(traceback.format_exc())
        
        job_service.update_job(
            job_id,
            status="failed",
            error=error_msg,
            message=error_msg
        )

@router.get("/job-status/{job_id}")
async def get_job_status(job_id: str):
    """Get job status"""
    status = job_service.get_job(job_id)
    if status is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return status

@router.post("/search")
async def search_materials(request: SearchRequest):
    """Search for similar materials"""
    await ensure_material_service_initialized()
    
    try:
        results = material_service.search_similar(
            query_text=request.query,
            limit=request.limit,
            score_threshold=request.score_threshold,
            status=request.status
        )
        
        # Format results
        formatted_results = []
        for result in results:
            formatted_results.append({
                "id": result.id,
                "score": result.score,
                "payload": result.payload
            })
        
        return {
            "query": request.query,
            "results": formatted_results,
            "total_found": len(formatted_results)
        }
        
    except Exception as e:
        logger.error(f"Search failed: {e}")
        raise HTTPException(status_code=500, detail=f"Search failed: {str(e)}")

@router.get("/jobs")
async def list_jobs():
    """List all jobs"""
    return {"jobs": job_service.list_jobs()}

@router.get("/system-info")
async def system_info():
    """Get system information"""
    import platform
    import sys
    
    return {
        "platform": platform.platform(),
        "python_version": sys.version,
        "service_initialized": material_service is not None
    }