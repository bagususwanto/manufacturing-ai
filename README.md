# Manufacturing AI

A modern manufacturing management system powered by AI, built with NestJS and Python microservices architecture.

## Project Overview

This project implements an intelligent manufacturing management system that combines modern web technologies with AI capabilities. It consists of two main backend services:

### Backend Services

1. **NestJS Backend** (`/backend-nest`)

   - Main REST API service
   - Modules:
     - Warehouse Management
     - Production Management
     - Material Processing
     - OpenWebUI Integration
     - Ollama LLM Integration

2. **Python Backend** (`/backend-python`)

   - AI and Machine Learning processing
   - Production API
   - Warehouse Management
   - Material Processing Services

### Frontend Services

**Repository:** https://github.com/bagususwanto/fe-manai

## System Architecture

The system uses a microservices architecture with:

- Docker containerization
- Separate backend services for different concerns
- Integration with AI/ML capabilities
- Database integration
- HTTP communication between services

## Getting Started

### Prerequisites

- Node.js (for NestJS backend)
- Python 3.x
- Docker and Docker Compose
- PostgreSQL (or your configured database)

### Installation

1. Clone the repository:

```bash
git clone https://github.com/bagususwanto/manufacturing-ai.git
cd manufacturing-ai
```

2. Start the services using Docker Compose:

```bash
docker network create my-network
docker-compose up -d
```

3. Processing Data to Qdrant with Postman

```bash
{{NEST_URL}}/warehouse/material-processing/process
```

access Qdrant collections at
http://localhost:6333/dashboard

### Development Setup

#### NestJS Backend

```bash
cd backend-nest
npm install
npm run start:dev
```

#### Python Backend

```bash
cd backend-python
pip install -r requirements.txt
python main.py
```

## Features

- AI-Powered Decision Making
- Integration with OpenWebUI
- LLM Integration via Ollama

## Project Structure

```
├── backend-nest/          # NestJS Backend Service
│   ├── src/
│   │   ├── modules/      # Feature modules
│   │   └── shared/       # Shared resources
├── backend-python/        # Python Backend Service
│   ├── production/       # Production related services
│   └── warehouse/        # Warehouse management
├── qdrant_storage/        # Qdrant Storage
│   └── aliases/           # Qdrant aliases
|   └── collections/       # Qdrant collections
└── docker-compose.yml    # Docker composition
```
