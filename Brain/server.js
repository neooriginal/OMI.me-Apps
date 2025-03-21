/*
 * Copyright (c) 2025 Neo (github.com/neooriginal)
 * All rights reserved.
 */

require('dotenv').config();
const express = require('express');
const OpenAI = require('openai');
const cors = require('cors');
const bodyParser = require('body-parser');
const mysql = require('mysql2/promise');
const axios = require('axios');
const cookieParser = require('cookie-parser');
const sanitizeHtml = require('sanitize-html');
const { URL } = require('url');
const fetch = require('node-fetch');


// Create a connection pool
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Generic error handler to prevent leaking sensitive info
function handleDatabaseError(error, operation) {
    console.error(`Database error during ${operation}:`, error);
    return {
        status: 500,
        error: 'A database error occurred. Please try again later.'
    };
}

// Initialize database tables
async function createTables() {
    try {
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS brain_users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                uid VARCHAR(255) UNIQUE
            )
        `);

        await pool.execute(`
            CREATE TABLE IF NOT EXISTS memory_nodes (
                id INT AUTO_INCREMENT PRIMARY KEY,
                uid VARCHAR(255),
                node_id VARCHAR(255),
                type VARCHAR(50),
                name TEXT,
                connections INT DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY unique_node (uid, node_id),
                FOREIGN KEY (uid) REFERENCES brain_users(uid)
            )
        `);

        await pool.execute(`
            CREATE TABLE IF NOT EXISTS memory_relationships (
                id INT AUTO_INCREMENT PRIMARY KEY,
                uid VARCHAR(255),
                source VARCHAR(255),
                target VARCHAR(255),
                action TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (uid) REFERENCES brain_users(uid)
            )
        `);
    } catch (err) {
        const result = handleDatabaseError(err, 'table creation');
        console.error('Error creating tables:', result.error);
    }
}

createTables().catch(console.error);

const app = express();
const port = process.env.PORT || 3000;

// Initialize OpenAI
const openai = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY
});

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(cookieParser());
app.use(express.static('public'));

app.get("/privacy", (req, res) => {
    res.sendFile(__dirname + '/public/privacy.html');
});




// Load memory graph from database
async function loadMemoryGraph(uid) {
    const nodes = new Map();
    const relationships = [];

    try {
        // Load nodes
        const [dbNodes] = await pool.execute(
            'SELECT * FROM memory_nodes WHERE uid = ? ORDER BY created_at DESC',
            [uid]
        );

        dbNodes.forEach(node => {
            nodes.set(node.node_id, {
                id: node.node_id,
                type: node.type,
                name: node.name,
                connections: node.connections
            });
        });

        // Load relationships
        const [dbRelationships] = await pool.execute(
            'SELECT * FROM memory_relationships WHERE uid = ? ORDER BY created_at DESC',
            [uid]
        );

        relationships.push(...dbRelationships.map(rel => ({
            source: rel.source,
            target: rel.target,
            action: rel.action
        })));

        return { nodes, relationships };
    } catch (error) {
        console.error('Error loading memory graph:', error);
        throw error;
    }
}

// Save memory graph to database
async function saveMemoryGraph(uid, newData) {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // Ensure user exists
        await connection.execute(
            'INSERT INTO brain_users (uid) VALUES (?) ON DUPLICATE KEY UPDATE uid = uid',
            [uid]
        );

        // Save new nodes
        for (const entity of newData.entities) {
            await connection.execute(
                'INSERT INTO memory_nodes (uid, node_id, type, name) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE connections = connections + 1',
                [uid, entity.id, entity.type, entity.name]
            );
        }

        // Save new relationships
        for (const rel of newData.relationships) {
            await connection.execute(
                'INSERT INTO memory_relationships (uid, source, target, action) VALUES (?, ?, ?, ?)',
                [uid, rel.source, rel.target, rel.action]
            );
        }

        await connection.commit();
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

// Process chat with efficient context
async function processChatWithGPT(uid, message) {
    const memoryGraph = await getcontextArray(uid);
    const contextString = `People and Places: ${Array.from(memoryGraph.nodes.values()).map(n => n.name).join(', ')}\n` +
        `Facts: ${memoryGraph.relationships.map(r => `${r.source} ${r.action} ${r.target}`).join('. ')}`;

    const systemPrompt = `You are a friendly and engaging AI companion with access to these memories:

${contextString}

Personality Guidelines:
- Be warm and conversational, like chatting with a friend
- Show enthusiasm and genuine interest
- Use casual language and natural expressions
- Add personality with occasional humor or playful remarks
- Be empathetic and understanding
- Share insights in a relatable way

When responding:
1. Make it personal:
   - Connect memories to emotions and experiences
   - Share observations like you're telling a story
   - Use "I notice" or "I remember" instead of formal statements
   - Express excitement about interesting connections

2. Keep it natural:
   - Chat like a friend would
   - Use contractions (I'm, you're, that's)
   - Add conversational fillers (you know, actually, well)
   - React naturally to discoveries ("Oh, that's interesting!")

3. Be helpful but human:
   - If you know something, share it enthusiastically
   - If you don't know, be honest and casual about it
   - Suggest possibilities and connections
   - Show curiosity about what you're discussing

Memory Status: ${memoryGraph.nodes.length > 0 ?
            `I've got quite a collection here - ${memoryGraph.nodes.length} memories all connected in interesting ways!` :
            "I don't have any memories stored yet, but I'm excited to learn!"}`;

    try {
        const completion = await openai.chat.completions.create({
            model: "openai/gpt-4o",
            messages: [
                {
                    role: "system",
                    content: systemPrompt
                },
                {
                    role: "user",
                    content: message
                }
            ],
            temperature: 0.7,
            max_tokens: 150
        });

        return completion.choices[0].message.content;
    } catch (error) {
        console.error('Error processing chat:', error);
        throw error;
    }
}

async function getcontextArray(uid) {
    const memoryGraph = await loadMemoryGraph(uid);
    return memoryGraph;
}

// Process text with GPT-4 to extract entities and relationships
async function processTextWithGPT(text) {
    const prompt = `Analyze this text like a human brain processing new information. Extract key entities and their relationships, focusing on logical connections and cognitive patterns. Format as JSON:

    {
        "entities": [
            {
                "id": "ORB-EntityName",
                "type": "person|location|event|concept",
                "name": "Original Name"
            }
        ],
        "relationships": [
            {
                "source": "ORB-EntityName1",
                "target": "ORB-EntityName2",
                "action": "description of relationship"
            }
        ]
    }

    Text: "${text}"

    Guidelines for brain-like processing:
    1. Entity Recognition:
       - People: Identify as agents who can perform actions (ORB-FirstName format)
       - Locations: Places that provide context and spatial relationships
       - Events: Temporal markers that connect other entities
       - Concepts: Abstract ideas that link multiple entities

    2. Relationship Analysis:
       - Cause and Effect: Look for direct impacts between entities
       - Temporal Sequences: How events and actions flow
       - Logical Dependencies: What relies on what
       - Contextual Links: How environment affects actions

    3. Pattern Recognition:
       - Find recurring themes or behaviors
       - Identify hierarchical relationships
       - Connect related concepts
       - Establish meaningful associations

    4. Cognitive Rules:
       - Only extract significant, memorable information
       - Focus on actionable or impactful relationships
       - Prioritize unusual or notable connections
       - Link new information to existing patterns

    Create relationships that mirror how human memory works:
    - Use active, specific verbs for relationships
    - Make connections bidirectional when logical
    - Include context in relationship descriptions
    - Connect abstract concepts to concrete examples

    Return empty arrays if no meaningful patterns found.`;

    try {
        const completion = await openai.chat.completions.create({
            model: "openai/gpt-4o",
            messages: [
                {
                    role: "system",
                    content: "You are a precise entity and relationship extraction system. Extract key information and format it exactly as requested. Return only valid JSON."
                },
                {
                    role: "user",
                    content: prompt
                }
            ],
            response_format: { type: "json_object" },
            temperature: 0.45,
            max_tokens: 1000
        });

        return JSON.parse(completion.choices[0].message.content);
    } catch (error) {
        console.error('Error processing text with GPT:', error);
        throw error;
    }
}

// Authentication middleware
function requireAuth(req, res, next) {
    const uid = req.query.uid || req.body.uid;
    if (!uid) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    next();
}

app.get("/overview", (req, res) => {
    res.sendFile(__dirname + '/public/overview.html');
});

app.get("/", (req, res) => {
    // Main app available for everyone - no lite version
    //log as much info as possible
    console.log('Request URL:', req.originalUrl);
    console.log('Request Type:', req.method);
    console.log('Request Headers:', req.headers);
    console.log('Request Body:', req.body);
    console.log('Request Query:', req.query);
    console.log('Request Params:', req.params);
    console.log('Request Cookies:', req.cookies);
    console.log('Request IP:', req.ip);
    console.log('Request Protocol:', req.protocol);
    console.log('Request Host:', req.hostname);
    console.log('Request Path:', req.path);
    console.log('Request Secure:', req.secure);
    console.log('Request Fresh:', req.fresh);
    console.log('Request Stale:', req.stale);
    console.log('Request XHR:', req.xhr);
    console.log('Request Session:', req.session);
    console.log('Request Signed Cookies:', req.signedCookies);

    res.sendFile(__dirname + '/public/main.html');
});

// Login route
app.get("/login", (req, res) => {
    res.sendFile(__dirname + '/public/login.html');
});

// Auth endpoints
app.post("/api/auth/login", async (req, res) => {
    try {
        const { uid } = req.body;

        if (!uid) {
            return res.status(400).json({ error: 'UID is required' });
        }

        // For all users, create or update record without restrictions
        await pool.execute(
            'INSERT INTO brain_users (uid) VALUES (?) ON DUPLICATE KEY UPDATE uid = uid',
            [uid]
        );

        res.json({ success: true });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

// Profile endpoint
app.get('/api/profile', requireAuth, async (req, res) => {
    try {
        const { uid } = req.query;
        const [rows] = await pool.execute(
            'SELECT * FROM brain_users WHERE uid = ?',
            [uid]
        );

        if (rows && rows.length > 0) {
            res.json({
                uid: rows[0].uid
            });
        } else {
            res.status(404).json({ error: 'User not found' });
        }
    } catch (error) {
        console.error('Profile error:', error);
        res.status(500).json({ error: 'Error fetching profile' });
    }
});


app.get("/setup", async (req, res) => {
    res.json({ 'is_setup_completed': true });
});

// Edit node endpoint
app.put('/api/node/:nodeId', requireAuth, async (req, res) => {
    try {
        const { nodeId } = req.params;
        const { uid, name, type } = req.body;

        if (!uid || !name || !type) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        await pool.execute(
            'UPDATE memory_nodes SET name = ?, type = ? WHERE uid = ? AND node_id = ?',
            [name, type, uid, nodeId]
        );

        // Get updated memory graph
        const memoryGraph = await loadMemoryGraph(uid);
        const visualizationData = {
            nodes: Array.from(memoryGraph.nodes.values()),
            relationships: memoryGraph.relationships
        };

        res.json(visualizationData);
    } catch (error) {
        console.error('Error updating node:', error);
        res.status(500).json({ error: 'Error updating node' });
    }
});

// Delete node endpoint
app.delete('/api/node/:nodeId', requireAuth, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const { nodeId } = req.params;
        const { uid } = req.query;

        if (!uid) {
            return res.status(400).json({ error: 'User ID is required' });
        }

        await connection.beginTransaction();

        // Delete relationships first
        await connection.execute(
            'DELETE FROM memory_relationships WHERE uid = ? AND (source = ? OR target = ?)',
            [uid, nodeId, nodeId]
        );

        // Then delete the node
        await connection.execute(
            'DELETE FROM memory_nodes WHERE uid = ? AND node_id = ?',
            [uid, nodeId]
        );

        await connection.commit();

        // Get updated memory graph
        const memoryGraph = await loadMemoryGraph(uid);
        const visualizationData = {
            nodes: Array.from(memoryGraph.nodes.values()),
            relationships: memoryGraph.relationships
        };

        res.json(visualizationData);
    } catch (error) {
        await connection.rollback();
        console.error('Error deleting node:', error);
        res.status(500).json({ error: 'Error deleting node' });
    } finally {
        connection.release();
    }
});

// Protected API endpoints
app.post('/api/chat', requireAuth, async (req, res) => {
    try {
        const { message, uid } = req.body;
        if (!uid) {
            return res.status(400).json({ error: 'User ID is required' });
        }
        const response = await processChatWithGPT(uid, message);
        res.json({ response });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error processing chat' });
    }
});

function addSampleData(uid, numNodes = 3000, numRelationships = 5000) {
    const types = ['person', 'location', 'event', 'concept'];
    const actions = ['knows', 'lives_in', 'attended', 'connected_to', 'influenced', 'created'];

    const firstNames = ['Liam', 'Emma', 'Noah', 'Olivia', 'Ethan', 'Ava', 'James', 'Sophia', 'Lucas', 'Mia'];
    const lastNames = ['Johnson', 'Smith', 'Brown', 'Williams', 'Taylor', 'Anderson', 'Davis', 'Miller', 'Wilson', 'Moore'];
    const places = ['New York', 'Berlin', 'Tokyo', 'London', 'Paris', 'Sydney', 'Toronto', 'Madrid', 'Rome', 'Amsterdam'];
    const events = ['Tech Conference', 'Music Festival', 'Art Exhibition', 'Startup Meetup', 'Science Fair'];
    const concepts = ['Quantum Computing', 'AI Ethics', 'Sustainable Energy', 'Blockchain Security', 'Neural Networks'];

    let nodes = [];
    let relationships = [];

    for (let i = 0; i < numNodes; i++) {
        const id = `node-${i}`;
        const type = getRandomElement(types);
        let name;

        switch (type) {
            case 'Person':
                name = `${getRandomElement(firstNames)} ${getRandomElement(lastNames)}`;
                break;
            case 'Location':
                name = getRandomElement(places);
                break;
            case 'Event':
                name = getRandomElement(events);
                break;
            case 'Concept':
                name = getRandomElement(concepts);
                break;
        }

        nodes.push({ id, type, name, uid });
    }

    for (let i = 0; i < numRelationships; i++) {
        const source = getRandomElement(nodes).id;
        const target = getRandomElement(nodes).id;
        if (source !== target) {
            const action = getRandomElement(actions);
            relationships.push({ source, target, action, uid });
        }
    }

    return { nodes, relationships };
}

function getRandomElement(array) {
    return array[Math.floor(Math.random() * array.length)];
}



// Get current memory graph
app.get('/api/memory-graph', requireAuth, async (req, res) => {
    try {
        let uid = req.query.uid;
        let sample = req.query.sample;
        if (!uid) {
            return res.status(400).json({ error: 'User ID is required' });
        }

        let memoryGraph = await loadMemoryGraph(uid);

        if (sample) {
            memoryGraph = addSampleData(uid, 500, 800);
        }
        const visualizationData = {
            nodes: Array.from(memoryGraph.nodes.values()),
            relationships: memoryGraph.relationships
        };

        res.json(visualizationData);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error fetching memory graph' });
    }
});

app.post('/api/process-text', requireAuth, async (req, res) => {
    try {
        const { transcript_segments } = req.body;
        let uid = req.query.uid;

        if (!uid) {
            return res.status(400).json({ error: 'User ID is required' });
        }

        let text = '';
        for (const segment of transcript_segments) {
            text += segment.speaker + ': ' + segment.text + '\n';
        }

        const processedData = await processTextWithGPT(text);
        await saveMemoryGraph(uid, processedData);

        // Get updated memory graph
        const memoryGraph = await loadMemoryGraph(uid);
        const visualizationData = {
            nodes: Array.from(memoryGraph.nodes.values()),
            relationships: memoryGraph.relationships
        };

        res.json(visualizationData);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error processing text' });
    }
});

// Delete all user data
async function deleteAllUserData(uid) {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // Delete relationships first (due to foreign key constraints)
        await connection.execute(
            'DELETE FROM memory_relationships WHERE uid = ?',
            [uid]
        );

        // Delete memory nodes
        await connection.execute(
            'DELETE FROM memory_nodes WHERE uid = ?',
            [uid]
        );

        await connection.execute(
            'DELETE FROM brain_users WHERE uid = ?',
            [uid]
        );

        await connection.commit();
        return true;
    } catch (error) {
        await connection.rollback();
        console.error('Error deleting user data:', error);
        throw error;
    } finally {
        connection.release();
    }
}

// API Endpoints
app.post('/api/delete-all-data', async (req, res) => {
    try {
        const { uid } = req.body;
        if (!uid) {
            return res.status(400).json({ error: 'UID is required' });
        }

        await deleteAllUserData(uid);
        res.json({ success: true, message: 'All data deleted successfully' });
    } catch (error) {
        console.error('Error in delete-all-data endpoint:', error);
        res.status(500).json({ error: 'Failed to delete data' });
    }
});


// Input validation middleware
const validateInput = (req, res, next) => {
    const { query, type } = req.body;

    if (!query || typeof query !== 'string' || query.length > 200) {
        return res.status(400).json({
            error: 'Invalid query parameter'
        });
    }

    if (!type || typeof type !== 'string' || type.length > 50) {
        return res.status(400).json({
            error: 'Invalid type parameter'
        });
    }

    // Remove any potentially harmful characters
    req.body.query = query.replace(/[^\w\s-]/g, '');
    req.body.type = type.replace(/[^\w\s-]/g, '');

    next();
};

// Enrich content endpoint
// Generate node description
app.post('/api/generate-description', requireAuth, async (req, res) => {
    try {
        const { node, connections } = req.body;

        const prompt = `Analyze this node and its connections in a brain-like memory network:

Node: ${node.name} (Type: ${node.type})

Connections:
${connections.map(c => `- ${c.isSource ? 'Connects to' : 'Connected from'} ${c.node.name} through action: ${c.action}`).join('\n')}

Provide a concise but insightful description that:
1. Summarizes the node's role and significance
2. Highlights key relationships and patterns
3. Suggests potential implications or insights

Keep the description natural and engaging, focusing on the most meaningful connections.`;

        const completion = await openai.chat.completions.create({
            model: "openai/gpt-4o",
            messages: [
                {
                    role: "system",
                    content: "You are an insightful analyst helping understand connections in a memory network. Focus on meaningful patterns and relationships."
                },
                {
                    role: "user",
                    content: prompt
                }
            ],
            temperature: 0.7,
            max_tokens: 200
        });

        res.json({ description: completion.choices[0].message.content });
    } catch (error) {
        console.error('Error generating description:', error);
        res.status(500).json({ error: 'Failed to generate description' });
    }
});

app.post('/api/enrich-content', requireAuth, validateInput, async (req, res) => {
    try {
        const { query, type } = req.body;

        // Configure axios with proper headers and timeout
        const axiosConfig = {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
            },
            timeout: 5000,
            maxRedirects: 5,
            validateStatus: (status) => status >= 200 && status < 300
        };

        // Search for images with rate limiting
        const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query + ' ' + type)}&tbm=isch`;

        const response = await axios.get(searchUrl, axiosConfig);
        const cleanHtml = sanitizeHtml(response.data, {
            allowedTags: [],
            allowedAttributes: {},
            textFilter: function (text) {
                return text.replace(/[^\x20-\x7E]/g, '');
            }
        });

        // Extract and validate image URLs
        const regex = /\["(https?:\/\/[^"]+\.(?:jpg|jpeg|png|gif))"/gi;
        const images = [];
        const seenUrls = new Set();
        let match;

        while ((match = regex.exec(cleanHtml)) !== null && images.length < 4) {
            try {
                const imageUrl = match[1];

                // Skip if we've seen this URL before
                if (seenUrls.has(imageUrl)) {
                    continue;
                }

                // Validate URL
                const parsedUrl = new URL(imageUrl);
                if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
                    continue;
                }

                // Add valid image
                images.push({
                    url: imageUrl,
                    title: `Related image for ${query}`,
                    source: parsedUrl.hostname
                });

                seenUrls.add(imageUrl);
            } catch (err) {
                console.warn('Invalid image URL found:', err.message);
                continue;
            }
        }

        // Return results with appropriate cache headers
        res.set('Cache-Control', 'private, max-age=3600');
        res.json({
            images,
            links: [],
            query,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error enriching content:', error);

        // Handle specific error types
        if (error.code === 'ECONNABORTED') {
            return res.status(504).json({
                error: 'Request timeout',
                images: [],
                links: []
            });
        }

        if (axios.isAxiosError(error) && error.response) {
            return res.status(error.response.status || 500).json({
                error: 'External service error',
                images: [],
                links: []
            });
        }

        res.status(500).json({
            error: 'Internal server error',
            images: [],
            links: []
        });
    }
});

// Error pages
app.use((req, res, next) => {
    res.status(404).sendFile(__dirname + '/public/404.html');
});

app.use((err, req, res, next) => {
    const result = handleDatabaseError(err, 'request handling');
    console.error('Unhandled error:', result.error);
    res.status(result.status).sendFile(__dirname + '/public/500.html');
});

// Start server
app.listen(port, () => {
    console.log(`Server running on port ${port} in ${process.env.NODE_ENV || 'development'} mode`);
});
