# Brain API Documentation

## Authentication

All API endpoints require authentication either through UID or Discord OAuth.

### Rate Limiting
- Login: 5 attempts per 15 minutes per IP
- API endpoints: 30 requests per minute per IP

## Endpoints

### Authentication

#### POST /api/auth/login
Login with UID.

**Request Body:**
```json
{
    "uid": "string"
}
```

**Response:**
```json
{
    "success": true,
    "isLite": boolean
}
```

### Memory Graph

#### GET /api/memory-graph
Get the current memory graph.

**Query Parameters:**
- `uid`: User ID
- `sample` (optional): If true, returns sample data

**Response:**
```json
{
    "nodes": [
        {
            "id": "string",
            "type": "person|location|event|concept",
            "name": "string",
            "connections": number
        }
    ],
    "relationships": [
        {
            "source": "string",
            "target": "string",
            "action": "string"
        }
    ]
}
```

#### POST /api/process-text
Process text to extract entities and relationships.

**Query Parameters:**
- `uid`: User ID
- `lite` (optional): Boolean

**Request Body:**
```json
{
    "transcript_segments": [
        {
            "speaker": "string",
            "text": "string"
        }
    ]
}
```

**Response:** Same as GET /api/memory-graph

### Node Management

#### PUT /api/node/:nodeId
Update a node's details.

**Request Body:**
```json
{
    "uid": "string",
    "name": "string",
    "type": "person|location|event|concept"
}
```

**Response:** Same as GET /api/memory-graph

#### DELETE /api/node/:nodeId
Delete a node and its relationships.

**Query Parameters:**
- `uid`: User ID

**Response:** Same as GET /api/memory-graph

### Chat

#### POST /api/chat
Chat with the AI using the memory context.

**Request Body:**
```json
{
    "message": "string",
    "uid": "string"
}
```

**Response:**
```json
{
    "response": "string"
}
```

### Node Description

#### POST /api/generate-description
Generate an AI description for a node.

**Request Body:**
```json
{
    "node": {
        "id": "string",
        "type": "string",
        "name": "string"
    },
    "connections": [
        {
            "node": {
                "id": "string",
                "type": "string",
                "name": "string"
            },
            "action": "string",
            "isSource": boolean
        }
    ]
}
```

**Response:**
```json
{
    "description": "string"
}
```

### Content Enrichment

#### POST /api/enrich-content
Enrich content with related images.

**Request Body:**
```json
{
    "query": "string",
    "type": "string"
}
```

**Response:**
```json
{
    "images": [
        {
            "url": "string",
            "title": "string",
            "source": "string"
        }
    ],
    "links": [],
    "query": "string",
    "timestamp": "string"
}
```

### User Management

#### GET /api/profile
Get user profile information.

**Query Parameters:**
- `uid`: User ID

**Response:**
```json
{
    "uid": "string",
    "discord_id": "string|null",
    "discord_username": "string|null"
}
```

#### POST /api/delete-all-data
Delete all user data.

**Request Body:**
```json
{
    "uid": "string"
}
```

**Response:**
```json
{
    "success": true,
    "message": "string"
}
```

### System

#### GET /health
Get system health status.

**Response:**
```json
{
    "status": "healthy",
    "uptime": number,
    "timestamp": "string",
    "version": "string"
}
```

## Error Responses

All endpoints may return the following error responses:

### 400 Bad Request
```json
{
    "error": "Error message"
}
```

### 401 Unauthorized
```json
{
    "error": "Authentication required"
}
```

### 403 Forbidden
```json
{
    "error": "Access denied"
}
```

### 429 Too Many Requests
```json
{
    "error": "Too many requests, please try again later"
}
```

### 500 Internal Server Error
```json
{
    "error": "Internal server error"
}