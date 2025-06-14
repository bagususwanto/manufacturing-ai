import asyncio
import aiohttp
import json
from typing import List, Dict, Any, Optional
import logging
from concurrent.futures import ThreadPoolExecutor
import time
import config

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class MaterialVectorProcessor:
    def __init__(
    self, 
    api_url: str = config.API_URL,
    qdrant_url: str = config.QDRANT_URL,
    model_name: str = config.MODEL_NAME,
    collection_name: str = config.COLLECTION_NAME
    ):
        
        self.api_url = api_url
        self.qdrant_url = qdrant_url
        self.collection_name = collection_name
        
        # Check dependencies first
        self._check_dependencies()
        
        # Initialize Qdrant client
        try:
            from qdrant_client import QdrantClient
            from qdrant_client.http import models
            self.qdrant_client = QdrantClient(url=qdrant_url)
            self.models = models
        except ImportError as e:
            logger.error(f"Qdrant client not available: {e}")
            raise ImportError("Please install qdrant-client: pip install qdrant-client")
        
        # Initialize sentence transformer model
        try:
            from sentence_transformers import SentenceTransformer
            logger.info(f"Loading embedding model: {model_name}")
            self.model = SentenceTransformer(model_name)
            self.vector_size = self.model.get_sentence_embedding_dimension()
            logger.info(f"Model loaded. Vector dimension: {self.vector_size}")
        except ImportError as e:
            logger.error(f"Sentence transformers not available: {e}")
            raise ImportError("Please install sentence-transformers: pip install sentence-transformers")
        except Exception as e:
            logger.error(f"Error loading model: {e}")
            raise
    
    def _check_dependencies(self):
        """Check if all required dependencies are available"""
        missing_deps = []
        
        try:
            import numpy
            logger.info(f"NumPy version: {numpy.__version__}")
        except ImportError:
            missing_deps.append("numpy")
        
        try:
            import torch
            logger.info(f"PyTorch version: {torch.__version__}")
        except ImportError:
            missing_deps.append("torch")
        
        try:
            from sentence_transformers import SentenceTransformer
            logger.info("SentenceTransformers available")
        except ImportError:
            missing_deps.append("sentence-transformers")
        
        try:
            from qdrant_client import QdrantClient
            logger.info("Qdrant client available")
        except ImportError:
            missing_deps.append("qdrant-client")
        
        if missing_deps:
            error_msg = f"Missing dependencies: {', '.join(missing_deps)}\n"
            error_msg += "Please install them using:\n"
            error_msg += f"pip install {' '.join(missing_deps)}"
            logger.error(error_msg)
            raise ImportError(error_msg)
        
        logger.info("All dependencies are available")
        
    async def fetch_materials(self) -> List[Dict[str, Any]]:
        """Fetch materials from API"""
        async with aiohttp.ClientSession() as session:
            try:
                async with session.get(self.api_url) as response:
                    if response.status == 200:
                        data = await response.json()
                        logger.info(f"Fetched {len(data)} materials from API")
                        return data
                    else:
                        raise Exception(f"Failed to fetch materials: {response.status}")
            except Exception as e:
                logger.error(f"Error fetching materials: {e}")
                raise
    
    def init_collection(self):
        """Initialize Qdrant collection"""
        try:
            # Check if collection exists
            collections = self.qdrant_client.get_collections()
            collection_exists = any(col.name == self.collection_name for col in collections.collections)
            
            if not collection_exists:
                logger.info(f"Creating collection: {self.collection_name}")
                self.qdrant_client.create_collection(
                    collection_name=self.collection_name,
                    vectors_config=self.models.VectorParams(
                        size=self.vector_size,
                        distance=self.models.Distance.COSINE
                    )
                )
            else:
                logger.info(f"Collection {self.collection_name} already exists")
                
        except Exception as e:
            logger.error(f"Error initializing collection: {e}")
            raise
    
    def create_text_representation(self, item: Dict[str, Any]) -> str:
        """Create text representation of material item"""
        try:
            packaging_info = "tidak ada"
            if item.get('packaging'):
                packaging_info = f"{item.get('packagingUnit', '')} {item.get('uom', '')} dalam kemasan {item['packaging']}"
            
            stock_info = "tidak diketahui"
            if item.get('stock') is not None:
                stock_info = f"{item['stock']} {item.get('uom', '')}"
            
            text = f"""
Material dengan kode {item.get('materialNo', '')}, yaitu {item.get('description', '')}, adalah barang jenis {item.get('category', '')} tipe {item.get('type', '')}.
Biasanya digunakan untuk kebutuhan produksi atau maintenance. Barang ini disimpan di rak {item.get('addressRackName', '')} di gudang {item.get('storageName', '')}, plant {item.get('plant', '')}, warehouse {item.get('warehouse', '')}.
Dipasok oleh {item.get('supplier', '')}, dikemas dalam {packaging_info}, dengan satuan {item.get('uom', '')}.
Harga per {item.get('uom', '')}: {item.get('price', '')}, dan minimal order sebanyak {item.get('minOrder', '')}.
Material ini dikelola dengan MRP type {item.get('mrpType', '')}, minimum stock {item.get('minStock', '')}, maksimum stock {item.get('maxStock', '')}.
Update stok terakhir tercatat sebanyak {stock_info} pada {item.get('stockUpdatedAt', '')} oleh {item.get('stockUpdatedBy', '')}.
Saat ini stok berstatus {item.get('stockStatus', '')}, dan diperkirakan dapat mencukupi kebutuhan selama {item.get('leadShift', '')} atau sekitar {item.get('leadTime', '')}.
""".strip()

            
            # Clean up whitespace
            return ' '.join(text.split())
        except Exception as e:
            logger.error(f"Error creating text representation: {e}")
            return f"Material {item.get('materialNo', 'Unknown')} - {item.get('description', 'No description')}"
    
    def process_item(self, item: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Process single item to create vector data"""
        try:
            text = self.create_text_representation(item)
            
            # Encode text to vector with error handling
            try:
                vector = self.model.encode(text).tolist()
            except Exception as e:
                logger.error(f"Error encoding text for item {item.get('materialNo', 'unknown')}: {e}")
                return None
            
            return {
                "id": int(item.get('id', 0)),
                "text": text,
                "vector": vector,
                "payload": {
                    "materialCode": item.get('materialNo'),
                    "name": item.get('description'),
                    "addressRackName": item.get('addressRackName'),
                    "storageName": item.get('storageName'),
                    "supplier": item.get('supplier'),
                    "plant": item.get('plant'),
                    "warehouse": item.get('warehouse'),
                    "packaging": item.get('packaging'),
                    "packagingUnit": item.get('packagingUnit'),
                    "uom": item.get('uom'),
                    "price": item.get('price'),
                    "type": item.get('type'),
                    "category": item.get('category'),
                    "minOrder": item.get('minOrder'),
                    "mrpType": item.get('mrpType'),
                    "minStock": item.get('minStock'),
                    "maxStock": item.get('maxStock'),
                    "stock": item.get('stock'),
                    "stockStatus": item.get('stockStatus'),
                    "leadShift": item.get('leadShift'),
                    "leadTime": item.get('leadTime'),
                    "stockUpdatedAt": item.get('stockUpdatedAt'),
                    "stockUpdatedBy": item.get('stockUpdatedBy'),
                    "text": text
                }
            }
        except Exception as e:
            logger.error(f"Error processing item {item.get('materialNo', 'unknown')}: {e}")
            return None
    
    def process_batch_parallel(self, items: List[Dict[str, Any]], max_workers: int = 5) -> List[Dict[str, Any]]:
        """Process batch of items in parallel"""
        results = []
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = [executor.submit(self.process_item, item) for item in items]
            
            for future in futures:
                try:
                    result = future.result(timeout=30)  # Add timeout
                    if result:
                        results.append(result)
                except Exception as e:
                    logger.error(f"Error in parallel processing: {e}")
        
        return results
    
    def upsert_vectors(self, vector_data: List[Dict[str, Any]]):
        """Upsert vectors to Qdrant"""
        if not vector_data:
            return
        
        points = []
        for data in vector_data:
            try:
                points.append(
                    self.models.PointStruct(
                        id=data["id"],
                        vector=data["vector"],
                        payload=data["payload"]
                    )
                )
            except Exception as e:
                logger.error(f"Error creating point for id {data.get('id', 'unknown')}: {e}")
                continue
        
        if not points:
            logger.warning("No valid points to upsert")
            return
        
        try:
            self.qdrant_client.upsert(
                collection_name=self.collection_name,
                points=points
            )
            logger.info(f"Successfully upserted {len(points)} vectors")
        except Exception as e:
            logger.error(f"Error upserting vectors: {e}")
            raise
    
    async def process_all_materials(self, 
                                  batch_size: int = 20, 
                                  max_workers: int = 5, 
                                  delay_between_batches: float = 0.1,
                                  progress_callback=None):
        """Main function to process all materials"""
        start_time = time.time()
        
        try:
            # Fetch materials
            logger.info("Starting to load materials...")
            materials = await self.fetch_materials()
            
            # Initialize collection
            self.init_collection()
            logger.info("Vector collection initialized")
            
            # Process in batches
            total_processed = 0
            total_failed = 0
            
            for i in range(0, len(materials), batch_size):
                batch = materials[i:i + batch_size]
                batch_num = i // batch_size + 1
                
                logger.info(f"Processing batch {batch_num}/{(len(materials) + batch_size - 1) // batch_size}...")
                
                try:
                    # Process batch in parallel
                    vector_data = self.process_batch_parallel(batch, max_workers)
                    
                    # Upsert to Qdrant
                    if vector_data:
                        logger.info(f"Upserting {len(vector_data)} vectors for batch {batch_num}...")
                        self.upsert_vectors(vector_data)
                        total_processed += len(vector_data)
                    
                    failed_in_batch = len(batch) - len(vector_data)
                    total_failed += failed_in_batch
                    
                    if failed_in_batch > 0:
                        logger.warning(f"Batch {batch_num}: {failed_in_batch} items failed to process")
                    
                except Exception as e:
                    logger.error(f"Error processing batch {batch_num}: {e}")
                    total_failed += len(batch)
                    continue
                
                # Progress update
                progress = min(((i + batch_size) / len(materials)) * 100, 100)
                logger.info(f"Progress: {progress:.1f}% ({min(i + batch_size, len(materials))}/{len(materials)})")
                
                # Call progress callback if provided
                if progress_callback:
                    try:
                        await progress_callback(progress, total_processed, len(materials))
                    except Exception as e:
                        logger.error(f"Error in progress callback: {e}")
                
                # Delay between batches
                if i + batch_size < len(materials):
                    await asyncio.sleep(delay_between_batches)
            
            # Final statistics
            end_time = time.time()
            duration = (end_time - start_time) / 60
            
            logger.info(f"Processing completed:")
            logger.info(f"  - Total materials: {len(materials)}")
            logger.info(f"  - Successfully processed: {total_processed}")
            logger.info(f"  - Failed: {total_failed}")
            logger.info(f"  - Duration: {duration:.1f} minutes")
            
            return {
                "total_materials": len(materials),
                "processed": total_processed,
                "failed": total_failed,
                "duration_minutes": round(duration, 2),
                "success": total_failed < len(materials)  # Success if not all failed
            }
            
        except Exception as e:
            logger.error(f"Fatal error in process_all_materials: {e}")
            raise
    
    def search_similar(self, query_text: str, limit: int = 5, score_threshold: float = 0.5):
        """Search for similar materials"""
        try:
            query_vector = self.model.encode(query_text).tolist()
            
            search_result = self.qdrant_client.search(
                collection_name=self.collection_name,
                query_vector=query_vector,
                limit=limit,
                score_threshold=score_threshold,
                with_payload=True,
                with_vectors=False
            )
            
            return search_result
            
        except Exception as e:
            logger.error(f"Error in search: {e}")
            raise

# Health check function
def check_system_health():
    """Check if all dependencies are available"""
    try:
        processor = MaterialVectorProcessor()
        return {"status": "healthy", "message": "All dependencies available"}
    except Exception as e:
        return {"status": "unhealthy", "error": str(e)}

if __name__ == "__main__":
    # Test the system
    health = check_system_health()
    print(f"System health: {health}")