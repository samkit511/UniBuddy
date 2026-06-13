import os
import sys
import json
import hashlib
from dataclasses import dataclass
from typing import Optional, List, Dict, Any

# Minimal RAGSystem kept for backend use. CLI removed.
import faiss
from sentence_transformers import SentenceTransformer
try:
    from langchain_text_splitters import RecursiveCharacterTextSplitter
except ImportError:
    from langchain.text_splitter import RecursiveCharacterTextSplitter

try:
    from src.config import settings
    from src.database import db_manager
except ImportError:
    from config import settings
    from database import db_manager

@dataclass
class RetrievalResult:
    content: str
    score: float
    source: str
    extra_metadata: Optional[Dict[str, Any]] = None

class RAGSystem:
    """Retrieval-Augmented Generation system for university data."""
    def __init__(self):
        self.embedding_model = None
        self.vector_db = None
        self.text_splitter = None
        self.index_to_doc_map = {}
        self.is_initialized = False

    def _initialize(self):
        if self.is_initialized:
            return
        try:
            self.embedding_model = SentenceTransformer('all-MiniLM-L6-v2')
            self.text_splitter = RecursiveCharacterTextSplitter(
                chunk_size=settings.CHUNK_SIZE,
                chunk_overlap=settings.CHUNK_OVERLAP,
                separators=["\n\n", "\n", ". ", " ", ""]
            )
            self._load_or_create_index()
            self.is_initialized = True
        except Exception as e:
            print(f"Error initializing RAG system: {e}")
            self.is_initialized = False

    def _load_or_create_index(self):
        index_path = os.path.join(settings.VECTOR_DB_PATH, "index.faiss")
        metadata_path = os.path.join(settings.VECTOR_DB_PATH, "metadata.json")
        if os.path.exists(index_path) and os.path.exists(metadata_path):
            try:
                self.vector_db = faiss.read_index(index_path)
                with open(metadata_path, 'r', encoding='utf-8') as f:
                    self.index_to_doc_map = json.load(f)
                print(f"Loaded existing FAISS index with {self.vector_db.ntotal} vectors")
            except Exception as e:
                print(f"Error loading index: {e}. Creating new index.")
                self._create_new_index()
        else:
            self._create_new_index()

    def _create_new_index(self):
        os.makedirs(settings.VECTOR_DB_PATH, exist_ok=True)
        embedding_dim = 384
        self.vector_db = faiss.IndexFlatL2(embedding_dim)
        self.index_to_doc_map = {}
        print("Created new FAISS index")

    def _save_index(self):
        if not self.vector_db:
            return
        os.makedirs(settings.VECTOR_DB_PATH, exist_ok=True)
        index_path = os.path.join(settings.VECTOR_DB_PATH, "index.faiss")
        metadata_path = os.path.join(settings.VECTOR_DB_PATH, "metadata.json")
        faiss.write_index(self.vector_db, index_path)
        with open(metadata_path, 'w', encoding='utf-8') as f:
            json.dump(self.index_to_doc_map, f, ensure_ascii=False, indent=2)
        print(f"Saved FAISS index with {self.vector_db.ntotal} vectors")

    def get_context_for_query(self, query: str, max_context_length: int = 2000) -> str:
        self._initialize()
        if not self.vector_db or self.vector_db.ntotal == 0:
            return "No relevant information found in the university database."
        # simple search wrapper
        try:
            query_embedding = self.embedding_model.encode([query])[0]
            scores, indices = self.vector_db.search(query_embedding.reshape(1, -1), min(settings.TOP_K_RESULTS, self.vector_db.ntotal))
            context_parts = []
            current_length = 0
            for score, idx in zip(scores[0], indices[0]):
                if idx == -1:
                    continue
                doc_data = self.index_to_doc_map.get(str(idx))
                if not doc_data:
                    continue
                similarity_score = 1.0 / (1.0 + score)
                source_info = f"[Source: {doc_data.get('title','Unknown')}]"
                full_content = f"{source_info}\n{doc_data.get('content','')}"
                if current_length + len(full_content) > max_context_length:
                    break
                context_parts.append(full_content)
                current_length += len(full_content)
            context = "\n\n---\n\n".join(context_parts)
            return f"Relevant information from university database:\n\n{context}\n\nPlease use this information to answer the user's question." if context_parts else "No relevant information found in the university database."
        except Exception as e:
            print(f"Error during RAG search: {e}")
            return "No relevant information found in the university database."

# expose a global rag_system for other modules
rag_system = RAGSystem()
