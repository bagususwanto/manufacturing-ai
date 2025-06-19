import asyncio
import aiohttp
import json
from typing import List, Dict, Any, Optional, Callable, Awaitable
import logging
from concurrent.futures import ThreadPoolExecutor
import time
from tqdm import tqdm
from config import API_CONFIG, MODEL_CONFIG, SEARCH_CONFIG

# Setup logging
logger = logging.getLogger(__name__)

class MaterialService:
    def __init__(
        self,
        api_url: str = "http://wh-backend-1:5010/api/inventory-material-all",
        qdrant_url: str = API_CONFIG["QDRANT_URL"],
        model_name: str = API_CONFIG["MODEL_NAME"],
        collection_name: str = API_CONFIG["COLLECTION_NAME"]
    ):
        self.api_url = api_url
        self.qdrant_url = qdrant_url
        self.collection_name = collection_name
        self.model_name = model_name
        self._initialize_dependencies()

    def _initialize_dependencies(self):
        """Initialize required dependencies"""
        try:
            # Initialize Qdrant client
            from qdrant_client import QdrantClient
            from qdrant_client.http import models
            self.qdrant_client = QdrantClient(url=self.qdrant_url)
            self.models = models

            # Initialize sentence transformer model
            from sentence_transformers import SentenceTransformer
            logger.info(f"Loading embedding model: {self.model_name}")
            self.model = SentenceTransformer(self.model_name)
            self.vector_size = self.model.get_sentence_embedding_dimension()
            logger.info(f"Model loaded. Vector dimension: {self.vector_size}")

        except ImportError as e:
            logger.error(f"Required dependency not available: {e}")
            raise ImportError(f"Please install required dependencies: {str(e)}")
        except Exception as e:
            logger.error(f"Error initializing dependencies: {e}")
            raise

    async def fetch_materials(self) -> List[Dict[str, Any]]:
        """Fetch materials from API"""
        logger.info(f"Fetching materials from API URL: {self.api_url}")
        async with aiohttp.ClientSession() as session:
            try:
                async with session.get("http://wh-backend-1:5010/api/inventory-material-all") as response:
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

            stock_status = item.get('stockStatus', '').lower()

            text = f"""
            Material ini memiliki kode: {item.get('materialNo', '')}
            Nama material: {item.get('description', '')}
            Jenis barang: {item.get('category', '')}
            Tipe barang: {item.get('type', '')}
            Digunakan untuk: kebutuhan produksi atau maintenance

            Lokasi penyimpanan:
            - Rak: {item.get('addressRackName', '')}
            - Gudang: {item.get('storageName', '')}
            - Plant: {item.get('plant', '')}
            - Warehouse: {item.get('warehouse', '')}

            Pemasok: {item.get('supplier', '')}
            Kemasan: {packaging_info}
            Satuan: {item.get('uom', '')}
            Harga per satuan: {item.get('price', '')}
            Minimal order: {item.get('minOrder', '')}

            Manajemen stok:
            - MRP Type: {item.get('mrpType', '')}
            - Minimum Stock: {item.get('minStock', '')}
            - Maximum Stock: {item.get('maxStock', '')}
            - Jumlah stok saat ini: {stock_info}
            - status stok: {stock_status}
            - Update terakhir: {item.get('stockUpdatedAt', '')} oleh {item.get('stockUpdatedBy', '')}
            - Estimasi ketahanan stok: {item.get('leadShift', '')} shift / {item.get('leadTime', '')} jam
            """.strip()

            return text
        except Exception as e:
            logger.error(f"Error creating text representation: {e}")
            return f"Material {item.get('materialNo', 'Unknown')} - {item.get('description', 'No description')}"

    def process_item(self, item: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Process single item to create vector data"""
        try:
            text = self.create_text_representation(item)
            vector = self.model.encode(text).tolist()
            
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

    def process_batch_parallel(self, items: List[Dict[str, Any]], max_workers: int = MODEL_CONFIG["MAX_WORKERS"]) -> List[Dict[str, Any]]:
        """Process batch of items in parallel"""
        results = []
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = [executor.submit(self.process_item, item) for item in items]
            
            for future in futures:
                try:
                    result = future.result(timeout=30)
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

    async def process_all_materials(
        self,
        batch_size: int = MODEL_CONFIG["BATCH_SIZE"],
        max_workers: int = MODEL_CONFIG["MAX_WORKERS"],
        delay_between_batches: float = MODEL_CONFIG["DELAY_BETWEEN_BATCHES"],
        progress_callback: Optional[Callable[[float, int, int], Awaitable[None]]] = None
    ) -> Dict[str, Any]:
        """Process all materials with progress tracking"""
        start_time = time.time()
        
        try:
            # Fetch materials
            logger.info("Fetching materials from API...")
            materials = await self.fetch_materials()
            total_materials = len(materials)
            logger.info(f"Found {total_materials} materials to process")
            
            # Initialize collection
            self.init_collection()
            logger.info("Vector collection initialized")
            
            # Calculate total batches
            total_batches = (total_materials + batch_size - 1) // batch_size
            
            # Initialize progress tracking
            total_processed = 0
            total_failed = 0
            current_batch = 0
            
            # Create progress bar
            with tqdm(total=total_materials, desc="Processing Materials", unit="items") as pbar:
                for i in range(0, total_materials, batch_size):
                    current_batch += 1
                    batch = materials[i:i + batch_size]
                    batch_num = i // batch_size + 1
                    
                    logger.info(f"Processing batch {batch_num}/{total_batches} ({len(batch)} items)")
                    
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
                    
                    # Update progress
                    pbar.update(len(batch))
                    progress = min(((i + batch_size) / total_materials) * 100, 100)
                    
                    # Log detailed progress
                    logger.info(
                        f"Progress: {progress:.1f}% | "
                        f"Processed: {total_processed}/{total_materials} | "
                        f"Failed: {total_failed} | "
                        f"Batch: {batch_num}/{total_batches}"
                    )
                    
                    # Call progress callback if provided
                    if progress_callback:
                        try:
                            await progress_callback(progress, total_processed, total_materials)
                        except Exception as e:
                            logger.error(f"Error in progress callback: {e}")
                    
                    # Delay between batches
                    if i + batch_size < total_materials:
                        await asyncio.sleep(delay_between_batches)
            
            # Calculate final statistics
            end_time = time.time()
            duration = (end_time - start_time) / 60
            
            # Log final statistics
            logger.info("Processing completed:")
            logger.info(f"  - Total materials: {total_materials}")
            logger.info(f"  - Successfully processed: {total_processed}")
            logger.info(f"  - Failed: {total_failed}")
            logger.info(f"  - Duration: {duration:.1f} minutes")
            logger.info(f"  - Average speed: {total_processed/duration:.1f} items/minute")
            
            return {
                "total_materials": total_materials,
                "processed": total_processed,
                "failed": total_failed,
                "duration_minutes": round(duration, 2),
                "success": total_failed < total_materials,
                "average_speed": round(total_processed/duration, 1)
            }
            
        except Exception as e:
            logger.error(f"Fatal error in process_all_materials: {e}")
            raise

    def search_similar(
        self,
        query_text: str,
        limit: int = SEARCH_CONFIG["DEFAULT_LIMIT"],
        score_threshold: float = SEARCH_CONFIG["SCORE_THRESHOLD"],
        status: str = None  # default None
    ) -> List[Any]:
        """Search for similar materials"""
        if status:
            logger.info(f"Received status: {status} (type: {type(status)})")
        else: 
            logger.info(f"Status not provided")
        try:
            query_vector = self.model.encode(query_text).tolist()
            query_filter = None
            if status and isinstance(status, str):
                 query_filter = self.models.Filter(
                must=[
                    self.models.FieldCondition(
                        key="stockStatus",
                        match=self.models.MatchValue(value=status.strip())
                    )
                ]
               
            )
                 
            logger.info(f"Using query_filter: {query_filter}")

            
            return self.qdrant_client.search(
                collection_name=self.collection_name,
                query_vector=query_vector,
                limit=limit,
                score_threshold=score_threshold,
                with_payload=True,
                with_vectors=False,
                query_filter=query_filter 
            )
            
        except Exception as e:
            logger.error(f"Error in search: {e}")
            raise 