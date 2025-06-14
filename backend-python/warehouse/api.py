# warehouse/api.py
from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel
from typing import Dict, Any
import logging
import traceback
import config

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Global processor instance
processor = None
initialization_error = None

class ProcessingRequest(BaseModel):
    api_url: str = config.API_URL
    qdrant_url: str = config.QDRANT_URL
    model_name: str = config.MODEL_NAME
    collection_name: str = config.COLLECTION_NAME
    batch_size: int = 20
    max_workers: int = 5
    delay_between_batches: float = 0.1

class SearchRequest(BaseModel):
    query: str
    limit: int = 5
    score_threshold: float = 0.5

# Job status tracking
job_status: Dict[str, Dict[str, Any]] = {}

def check_dependencies():
    """Check if all required dependencies are available"""
    missing_deps = []
    deps_info = {}
    
    # Check NumPy
    try:
        import numpy as np
        deps_info["numpy"] = {"status": "available", "version": np.__version__}
    except ImportError as e:
        missing_deps.append("numpy")
        deps_info["numpy"] = {"status": "missing", "error": str(e)}
    
    # Check PyTorch
    try:
        import torch
        deps_info["torch"] = {"status": "available", "version": torch.__version__}
    except ImportError as e:
        missing_deps.append("torch")
        deps_info["torch"] = {"status": "missing", "error": str(e)}
    
    # Check Sentence Transformers
    try:
        from sentence_transformers import SentenceTransformer
        deps_info["sentence_transformers"] = {"status": "available"}
    except ImportError as e:
        missing_deps.append("sentence-transformers")
        deps_info["sentence_transformers"] = {"status": "missing", "error": str(e)}
    
    # Check Qdrant Client
    try:
        from qdrant_client import QdrantClient
        deps_info["qdrant_client"] = {"status": "available"}
    except ImportError as e:
        missing_deps.append("qdrant-client")
        deps_info["qdrant_client"] = {"status": "missing", "error": str(e)}
    
    # Check aiohttp
    try:
        import aiohttp
        deps_info["aiohttp"] = {"status": "available", "version": aiohttp.__version__}
    except ImportError as e:
        missing_deps.append("aiohttp")
        deps_info["aiohttp"] = {"status": "missing", "error": str(e)}
    
    return {
        "all_available": len(missing_deps) == 0,
        "missing_dependencies": missing_deps,
        "dependencies_info": deps_info,
        "install_command": f"pip install {' '.join(missing_deps)}" if missing_deps else None
    }

async def initialize_processor():
    """Initialize the processor"""
    global processor, initialization_error
    
    # If already initialized or failed, don't try again
    if processor is not None or initialization_error is not None:
        return
    
    try:
        # Check dependencies first
        deps_check = check_dependencies()
        if not deps_check["all_available"]:
            error_msg = f"Missing dependencies: {', '.join(deps_check['missing_dependencies'])}\n"
            error_msg += f"Install command: {deps_check['install_command']}"
            initialization_error = error_msg
            logger.error(f"Initialization failed: {error_msg}")
            return
        
        # Import MaterialVectorProcessor only after checking dependencies
        try:
            from warehouse.material_processor import MaterialVectorProcessor
            processor = MaterialVectorProcessor()
            logger.info("Material Vector Processor initialized successfully")
            initialization_error = None
        except Exception as e:
            initialization_error = f"Failed to initialize processor: {str(e)}"
            logger.error(f"Processor initialization failed: {e}")
            logger.error(traceback.format_exc())
            
    except Exception as e:
        initialization_error = f"Initialization error: {str(e)}"
        logger.error(f"Initialization failed: {e}")
        logger.error(traceback.format_exc())

async def ensure_processor_initialized():
    """Ensure processor is initialized before use"""
    if processor is None and initialization_error is None:
        await initialize_processor()

# Processor will be initialized when first endpoint is called
# No initialization during module import

# Create APIRouter
router = APIRouter()

@router.get("/")
async def warehouse_root():
    await ensure_processor_initialized()
    return {
        "message": "Material Vector Processing API", 
        "status": "running" if processor else "initialization_failed",
        "initialization_error": initialization_error
    }

@router.get("/dependencies")
async def check_dependencies_endpoint():
    """Check system dependencies"""
    return check_dependencies()

@router.get("/health")
async def health_check():
    """Health check endpoint"""
    await ensure_processor_initialized()
    
    if initialization_error:
        return {
            "status": "unhealthy", 
            "error": initialization_error,
            "dependencies": check_dependencies()
        }
    
    if processor is None:
        return {
            "status": "unhealthy", 
            "error": "Processor not initialized",
            "dependencies": check_dependencies()
        }
    
    try:
        # Test model loading
        test_text = "test embedding"
        test_vector = processor.model.encode(test_text)
        
        return {
            "status": "healthy",
            "model": getattr(processor.model, 'model_name', 'unknown'),
            "vector_dimension": len(test_vector),
            "qdrant_url": processor.qdrant_url,
            "dependencies": check_dependencies()
        }
    except Exception as e:
        return {
            "status": "unhealthy", 
            "error": str(e),
            "dependencies": check_dependencies()
        }

@router.post("/process-materials")
async def process_materials(request: ProcessingRequest, background_tasks: BackgroundTasks):
    """Process materials endpoint"""
    await ensure_processor_initialized()
    
    if initialization_error:
        raise HTTPException(
            status_code=500, 
            detail=f"System not properly initialized: {initialization_error}"
        )
    
    if processor is None:
        raise HTTPException(status_code=500, detail="Processor not initialized")
    
    # Generate job ID
    import uuid
    job_id = str(uuid.uuid4())
    
    # Initialize job status
    job_status[job_id] = {
        "status": "queued",
        "progress": 0,
        "message": "Job queued",
        "start_time": None,
        "end_time": None,
        "error": None,
        "processed": 0,
        "failed": 0,
        "total": 0
    }
    
    # Add background task
    background_tasks.add_task(
        process_materials_background,
        job_id,
        request
    )
    
    return {"job_id": job_id, "message": "Processing started in background"}

async def process_materials_background(job_id: str, request: ProcessingRequest):
    """Background task for processing materials"""
    import time
    
    try:
        # Update job status
        job_status[job_id].update({
            "status": "running",
            "start_time": time.time(),
            "message": "Processing materials..."
        })
        
        # Import MaterialVectorProcessor
        from warehouse.material_processor import MaterialVectorProcessor
        
        # Create processor with custom config
        custom_processor = MaterialVectorProcessor(
            api_url=request.api_url,
            qdrant_url=request.qdrant_url,
            model_name=request.model_name,
            collection_name=request.collection_name
        )
        
        # Progress callback
        async def progress_callback(progress, processed, total):
            job_status[job_id].update({
                "progress": progress,
                "processed": processed,
                "total": total,
                "message": f"Processing... {progress:.1f}% ({processed}/{total})"
            })
        
        # Process materials
        result = await custom_processor.process_all_materials(
            batch_size=request.batch_size,
            max_workers=request.max_workers,
            delay_between_batches=request.delay_between_batches,
            progress_callback=progress_callback
        )
        
        # Update job status
        job_status[job_id].update({
            "status": "completed",
            "progress": 100,
            "end_time": time.time(),
            "message": "Processing completed successfully",
            "result": result,
            "processed": result.get("processed", 0),
            "failed": result.get("failed", 0),
            "total": result.get("total_materials", 0)
        })
        
    except Exception as e:
        error_msg = f"Processing failed: {str(e)}"
        logger.error(f"Job {job_id} failed: {e}")
        logger.error(traceback.format_exc())
        
        job_status[job_id].update({
            "status": "failed",
            "end_time": time.time(),
            "error": error_msg,
            "message": error_msg,
            "traceback": traceback.format_exc()
        })

@router.get("/job-status/{job_id}")
async def get_job_status(job_id: str):
    """Get job status"""
    if job_id not in job_status:
        raise HTTPException(status_code=404, detail="Job not found")
    
    status = job_status[job_id].copy()
    
    # Calculate duration if job has started
    if status.get("start_time"):
        import time
        if status.get("end_time"):
            status["duration"] = status["end_time"] - status["start_time"]
        else:
            status["duration"] = time.time() - status["start_time"]
    
    return status

@router.post("/search")
async def search_materials(request: SearchRequest):
    """Search for similar materials"""
    await ensure_processor_initialized()
    
    if initialization_error:
        raise HTTPException(
            status_code=500, 
            detail=f"System not properly initialized: {initialization_error}"
        )
    
    if processor is None:
        raise HTTPException(status_code=500, detail="Processor not initialized")
    
    try:
        results = processor.search_similar(
            query_text=request.query,
            limit=request.limit,
            score_threshold=request.score_threshold
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
    return {"jobs": job_status}

@router.get("/system-info")
async def system_info():
    """Get system information"""
    import platform
    import sys
    
    return {
        "platform": platform.platform(),
        "python_version": sys.version,
        "dependencies": check_dependencies(),
        "processor_initialized": processor is not None,
        "initialization_error": initialization_error
    }