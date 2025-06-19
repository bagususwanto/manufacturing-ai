from typing import Dict, Any, Optional
import time
import logging
import uuid

# Setup logging
logger = logging.getLogger(__name__)

class JobService:
    def __init__(self):
        self.jobs: Dict[str, Dict[str, Any]] = {}

    def create_job(self) -> str:
        """Create a new job and return its ID"""
        job_id = str(uuid.uuid4())
        self.jobs[job_id] = {
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
        return job_id

    def get_job(self, job_id: str) -> Optional[Dict[str, Any]]:
        """Get job status"""
        if job_id not in self.jobs:
            return None
        
        status = self.jobs[job_id].copy()
        
        # Calculate duration if job has started
        if status.get("start_time"):
            if status.get("end_time"):
                status["duration"] = status["end_time"] - status["start_time"]
            else:
                status["duration"] = time.time() - status["start_time"]
        
        return status

    def update_job(
        self,
        job_id: str,
        status: Optional[str] = None,
        progress: Optional[float] = None,
        message: Optional[str] = None,
        error: Optional[str] = None,
        processed: Optional[int] = None,
        failed: Optional[int] = None,
        total: Optional[int] = None
    ):
        """Update job status"""
        if job_id not in self.jobs:
            logger.warning(f"Job {job_id} not found")
            return

        job = self.jobs[job_id]
        
        if status == "running" and not job.get("start_time"):
            job["start_time"] = time.time()
        elif status in ["completed", "failed"] and not job.get("end_time"):
            job["end_time"] = time.time()

        if status is not None:
            job["status"] = status
        if progress is not None:
            job["progress"] = progress
        if message is not None:
            job["message"] = message
        if error is not None:
            job["error"] = error
        if processed is not None:
            job["processed"] = processed
        if failed is not None:
            job["failed"] = failed
        if total is not None:
            job["total"] = total

    def list_jobs(self) -> Dict[str, Dict[str, Any]]:
        """List all jobs"""
        return self.jobs

    def cleanup_old_jobs(self, max_age_hours: int = 24):
        """Clean up old completed or failed jobs"""
        current_time = time.time()
        jobs_to_remove = []

        for job_id, job in self.jobs.items():
            if job["status"] in ["completed", "failed"]:
                if job.get("end_time"):
                    age_hours = (current_time - job["end_time"]) / 3600
                    if age_hours > max_age_hours:
                        jobs_to_remove.append(job_id)

        for job_id in jobs_to_remove:
            del self.jobs[job_id]
            logger.info(f"Cleaned up old job: {job_id}") 