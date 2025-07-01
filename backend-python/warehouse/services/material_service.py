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
        model_name: str = API_CONFIG["MODEL_NAME"],  # intfloat/multilingual-e5-small
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
            
            # For E5 models, ensure proper device and optimization settings
            self.model = SentenceTransformer(
                self.model_name,
                device='cpu',  # or 'cuda' if GPU available
                trust_remote_code=True  # Required for some E5 variants
            )
            
            self.vector_size = self.model.get_sentence_embedding_dimension()
            logger.info(f"E5 model loaded. Vector dimension: {self.vector_size}")

        except ImportError as e:
            logger.error(f"Required dependency not available: {e}")
            raise ImportError(f"Please install required dependencies: {str(e)}")
        except Exception as e:
            logger.error(f"Error initializing dependencies: {e}")
            raise

    def _prepare_text_for_e5(self, text: str, query_type: str = "passage") -> str:
        """
        Prepare text for E5 model with proper prefixes
        E5 models require specific prefixes for optimal performance
        
        Args:
            text: Input text
            query_type: Either "query" or "passage"
        
        Returns:
            Text with appropriate E5 prefix
        """
        # Remove any existing prefixes to avoid duplication
        text = text.strip()
        if text.startswith("query:") or text.startswith("passage:"):
            text = text.split(":", 1)[1].strip()
        
        if query_type == "query":
            return f"query: {text}"
        else:
            return f"passage: {text}"

    def _encode_with_e5_prefix(self, text: str, query_type: str = "passage") -> List[float]:
        """
        Encode text using E5 model with proper prefix
        
        Args:
            text: Text to encode
            query_type: Either "query" or "passage"
            
        Returns:
            Encoded vector as list
        """
        try:
            prepared_text = self._prepare_text_for_e5(text, query_type)
            
            # For E5 models, normalization is crucial for cosine similarity
            vector = self.model.encode(
                prepared_text, 
                normalize_embeddings=True,
                convert_to_tensor=False,  # Return as numpy array
                show_progress_bar=False
            )
            
            return vector.tolist()
            
        except Exception as e:
            logger.error(f"Error encoding text with E5 model: {e}")
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
        """Initialize Qdrant collection optimized for E5 embeddings"""
        try:
            collections = self.qdrant_client.get_collections()
            collection_exists = any(col.name == self.collection_name for col in collections.collections)
            
            if not collection_exists:
                logger.info(f"Creating collection: {self.collection_name}")
                self.qdrant_client.create_collection(
                    collection_name=self.collection_name,
                    vectors_config=self.models.VectorParams(
                        size=self.vector_size,
                        distance=self.models.Distance.COSINE,  # Best for normalized E5 embeddings
                        hnsw_config=self.models.HnswConfigDiff(
                            m=16,  # Optimal for E5 embeddings
                            ef_construct=200,
                            full_scan_threshold=10000
                        )
                    ),
                    optimizers_config=self.models.OptimizersConfigDiff(
                        default_segment_number=2,
                        max_segment_size=20000,
                        memmap_threshold=20000,
                        indexing_threshold=20000,
                        flush_interval_sec=5,
                        max_optimization_threads=2
                    )
                )
                logger.info(f"Collection {self.collection_name} created with E5-optimized settings")
            else:
                logger.info(f"Collection {self.collection_name} already exists")
                # Verify collection configuration
                collection_info = self.qdrant_client.get_collection(self.collection_name)
                existing_size = collection_info.config.params.vectors.size
                if existing_size != self.vector_size:
                    logger.error(f"Collection vector size mismatch: existing={existing_size}, required={self.vector_size}")
                    raise ValueError("Vector size mismatch - recreate collection or use different name")
                
        except Exception as e:
            logger.error(f"Error initializing collection: {e}")
            raise

    def create_text_representation(self, item: Dict[str, Any]) -> str:
        """
        Create optimized text representation for E5 multilingual model
        """
        try:
            text_parts = []

            # Core identity information - most important for search
            material_no = item.get('materialNo', 'N/A')
            description = item.get('description', 'Tanpa deskripsi')
            item_type = item.get('type', 'N/A').upper()
            category = item.get('category', 'N/A')
            
            # PRIMARY BLOCK - emphasize material type early and repeatedly  
            text_parts.append(f"Material {item_type} {material_no}: {description}")
            text_parts.append(f"Tipe material {item_type} kategori {category}")

            # Stock status with contextual information
            status = item.get('stockStatus', 'unknown').lower()
            stock = item.get('stock', 'N/A')
            uom = item.get('uom', '')
            min_stock = item.get('minStock', 'N/A')
            max_stock = item.get('maxStock', 'N/A')
            
            stock_info = f"{stock} {uom}".strip()
            
            # Add material type context to stock status
            if status == "critical":
                text_parts.append(f"Stok kritis matrial {item_type} {stock_info}, material di bawah minimum {min_stock} {uom}, perlu pengadaan segera")
            elif status == "over":
                text_parts.append(f"Stok berlebih material {item_type} {stock_info}, material melebihi maksimum {max_stock} {uom}")
            elif status == "normal":
                text_parts.append(f"Stok normal material {item_type} {stock_info}, material dalam rentang {min_stock}-{max_stock} {uom}")
            else:
                text_parts.append(f"Stok material {item_type} {stock_info}, batas {min_stock}-{max_stock} {uom}")

            # Location information
            warehouse = item.get('warehouse', 'N/A')
            storage = item.get('storageName', 'N/A')
            rack = item.get('addressRackName', 'N/A')
            plant = item.get('plant', 'N/A')
            text_parts.append(f"Lokasi gudang {warehouse} area {storage} rak {rack} plant {plant}")

            # Supplier and ordering information
            supplier = item.get('supplier', 'N/A')
            min_order = item.get('minOrder', 'N/A')
            lead_time = item.get('leadTime', 'N/A')
            text_parts.append(f"Supplier {supplier}, minimum order {min_order} {uom}, lead time {lead_time} hari")

            # Additional context with type emphasis
            price = item.get('price', 'N/A')
            mrp_type = item.get('mrpType', 'N/A')
            packaging = item.get('packaging', 'N/A')
            text_parts.append(f"Harga {price}, MRP {mrp_type}, kemasan {packaging}, kategori {item_type}")
            
            # Join without "passage:" prefix - will be added in encoding
            return " | ".join(text_parts)

        except Exception as e:
            logger.error(f"Error creating text representation for item {item.get('materialNo', 'Unknown')}: {e}")
            # Fallback
            return f"Material {item.get('materialNo', 'Unknown')} {item.get('description', 'No description')}"

    def process_item(self, item: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Process single item to create vector data"""
        try:
            text = self.create_text_representation(item)
            # Use E5 model with passage prefix for document encoding
            vector = self._encode_with_e5_prefix(text, query_type="passage")
            
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
                    "type": item.get('type').lower(),
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
            logger.info("Vector collection initialized with E5 optimization")
            
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
    limit: int = 5,
    score_threshold: float = 0.3,
    filters: Optional[Dict[str, str]] = None,
        ) -> List[Any]:
            try:
                query_vector = self._encode_with_e5_prefix(query_text, query_type="query")
                
                query_filter = None
                if filters:
                    must_conditions = []
                    for key, val in filters.items():
                        if val:
                            must_conditions.append(
                                self.models.FieldCondition(
                                    key=key,
                                    match=self.models.MatchValue(value=val.strip().lower())
                                )
                            )
                    if must_conditions:
                        query_filter = self.models.Filter(must=must_conditions)
                        logger.info(f"Applied filters: {filters}")
                
                results = self.qdrant_client.search(
                    collection_name=self.collection_name,
                    query_vector=query_vector,
                    limit=limit,
                    score_threshold=score_threshold,
                    with_payload=True,
                    with_vectors=False,
                    query_filter=query_filter
                )
                logger.info(f"Search completed: {len(results)} results found")
                return results
            except Exception as e:
                logger.error(f"Error in search: {e}")
                raise


    def batch_search(
        self,
        queries: List[str],
        limit: int = SEARCH_CONFIG["DEFAULT_LIMIT"],
        score_threshold: float = SEARCH_CONFIG["SCORE_THRESHOLD"]
    ) -> List[List[Any]]:
        """
        Perform batch search for multiple queries
        """
        try:
            # Encode all queries at once for efficiency
            query_vectors = []
            for query in queries:
                vector = self._encode_with_e5_prefix(query, query_type="query")
                query_vectors.append(vector)
            
            results = []
            for i, vector in enumerate(query_vectors):
                search_results = self.qdrant_client.search(
                    collection_name=self.collection_name,
                    query_vector=vector,
                    limit=limit,
                    score_threshold=score_threshold,
                    with_payload=True,
                    with_vectors=False
                )
                results.append(search_results)
                logger.info(f"Batch search {i+1}/{len(queries)}: {len(search_results)} results")
            
            return results
            
        except Exception as e:
            logger.error(f"Error in batch search: {e}")
            raise