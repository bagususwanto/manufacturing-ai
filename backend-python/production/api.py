# production/api.py
from fastapi import APIRouter

router = APIRouter()

@router.get("/status")
def status():
    return {"module": "production", "status": "ok"}
