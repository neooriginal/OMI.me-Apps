/*
 * Copyright (c) 2025 Neo (github.com/neooriginal)
 * All rights reserved.
 */

require('dotenv').config();
const express = require('express');
const OpenAI = require('openai');
const bodyParser = require('body-parser');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const sanitizeHtml = require('sanitize-html');
const { URL } = require('url');
const fetch = require('node-fetch');
const crypto = require('crypto');

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);


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
        console.log('Setting up Brain app tables...');

        // Create brain_users table
        const { error: error1 } = await supabase.rpc('exec_sql', {
            sql_query: `
                CREATE TABLE IF NOT EXISTS brain_users (
                    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                    uid TEXT UNIQUE NOT NULL,
                    code_check TEXT,
                    has_key BOOLEAN DEFAULT false,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                );
            `
        });

        await supabase.rpc('exec_sql', {
            sql_query: `ALTER TABLE brain_users ADD COLUMN IF NOT EXISTS code_check TEXT;`
        });

        await supabase.rpc('exec_sql', {
            sql_query: `ALTER TABLE brain_users ADD COLUMN IF NOT EXISTS has_key BOOLEAN DEFAULT false;`
        });

        // Create memory_nodes table
        const { error: error2 } = await supabase.rpc('exec_sql', {
            sql_query: `
                CREATE TABLE IF NOT EXISTS memory_nodes (
                    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                    uid TEXT NOT NULL,
                    node_id TEXT NOT NULL,
                    type TEXT,
                    name TEXT,
                    connections INTEGER DEFAULT 0,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    UNIQUE(uid, node_id)
                );
            `
        });

        // Create memory_relationships table
        const { error: error3 } = await supabase.rpc('exec_sql', {
            sql_query: `
                CREATE TABLE IF NOT EXISTS memory_relationships (
                    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                    uid TEXT NOT NULL,
                    source TEXT NOT NULL,
                    target TEXT NOT NULL,
                    action TEXT,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                );
            `
        });

        if (error1 || error2 || error3) {
            console.log('Tables may already exist or exec_sql function not found.');
            console.log('Please run the setup-supabase.sql script in your Supabase SQL editor.');
        } else {
            console.log('Brain app tables created successfully!');
        }
    } catch (err) {
        console.log('Auto-table creation failed. Please run setup-supabase.sql manually.');
        console.log('Error:', err.message);
    }
}

createTables().catch(console.error);

function decryptText(payload, keyB64) {
    try {
        const [ivB64, dataB64] = payload.split(':');
        const iv = Buffer.from(ivB64, 'base64');
        const data = Buffer.from(dataB64, 'base64');
        const key = Buffer.from(keyB64, 'base64');
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        const ciphertext = data.slice(0, -16);
        const authTag = data.slice(-16);
        decipher.setAuthTag(authTag);
        const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        return decrypted.toString('utf8');
    } catch {
        return null;
    }
}

const app = express();
app.set('trust proxy', 1); // Trust Render's proxy for secure cookies
const port = process.env.PORT || 3000;


// Configure AI client - support both OpenRouter and OpenAI
const useOpenRouter = process.env.OPENROUTER_API_KEY && !process.env.FORCE_OPENAI;
const openai = new OpenAI({
    apiKey: useOpenRouter 
        ? process.env.OPENROUTER_API_KEY 
        : (process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.trim() : ''),
    baseURL: useOpenRouter ? 'https://openrouter.ai/api/v1' : undefined
});

app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ limit: '10mb', extended: true }));
app.use(cookieParser());

// Session configuration for production
const sessionConfig = {
    secret: process.env.SESSION_SECRET || 'brain-app-default-secret-please-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production', // Only use secure cookies in production
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax'
    }
};

// Add domain setting for production if specified
if (process.env.SESSION_DOMAIN) {
    sessionConfig.cookie.domain = process.env.SESSION_DOMAIN;
}

app.use(session(sessionConfig));
app.use(express.static(__dirname + '/public'));

app.get("/privacy", (req, res) => {
    res.sendFile(__dirname + '/public/privacy.html');
});

// Load memory graph from database
async function loadMemoryGraph(uid) {
    const nodes = new Map();
    const relationships = [];

    try {
        // Load nodes
        const { data: dbNodes } = await supabase
            .from('memory_nodes')
            .select()
            .eq('uid', uid);

        dbNodes.forEach(node => {
            nodes.set(node.node_id, {
                id: node.node_id,
                type: node.type,
                name: node.name,
                connections: node.connections
            });
        });

        // Load relationships
        const { data: dbRelationships } = await supabase
            .from('memory_relationships')
            .select()
            .eq('uid', uid);

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
    try {
        // Save new nodes
        for (const entity of newData.entities) {
            await supabase
                .from('memory_nodes')
                .upsert([
                    {
                        uid: uid,
                        node_id: entity.id,
                        type: entity.type,
                        name: entity.name,
                        connections: entity.connections
                    }
                ]);
        }

        for (const rel of newData.relationships) {
            await supabase
                .from('memory_relationships')
                .upsert([
                    {
                        uid: uid,
                        source: rel.source,
                        target: rel.target,
                        action: rel.action
                    }
                ]);
        }
    } catch (error) {
        throw error;
    }
}

// Process chat with efficient context
async function processChatWithGPT(message, context) {
    const idToNode = new Map(context.nodes.map(n => [n.id, n]));
    const contextString = `People and Places: ${context.nodes.map(n => n.name).join(', ')}\n` +
        `Facts: ${context.relationships.map(r => `${idToNode.get(r.source)?.name || r.source} ${r.action} ${idToNode.get(r.target)?.name || r.target}`).join('. ')}`;

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

Memory Status: ${context.nodes.length > 0 ?
            `I've got quite a collection here - ${context.nodes.length} memories all connected in interesting ways!` :
            "I don't have any memories stored yet, but I'm excited to learn!"}`;

    try {
        const completion = await openai.chat.completions.create({
            model: useOpenRouter ? "openai/gpt-4o-mini" : "gpt-4o-mini",
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


// Process text with GPT-4 to extract entities and relationships
async function processTextWithGPT(text, existingMemory = { nodes: new Map(), relationships: [] }) {
    // Convert existing nodes to a more usable format for the prompt
    const existingNodes = Array.from(existingMemory.nodes.values());
    const existingRelationships = existingMemory.relationships;
    
    // Create context strings for existing memory
    const existingNodesContext = existingNodes.length > 0 ?
        `\nEXISTING NODES (REUSE THESE IDs WHEN POSSIBLE):\n${existingNodes.map(n => `- ${n.id}: ${n.name} (${n.type})`).join('\n')}` :
        '';
    
    const existingRelationshipsContext = existingRelationships.length > 0 ?
        `\nEXISTING RELATIONSHIPS (REUSE THESE PATTERNS):\n${existingRelationships.map(r => `- ${r.source} → ${r.target}: ${r.action}`).slice(0, 20).join('\n')}` :
        '';

    const prompt = `Analyze this text like a human brain processing new information. Extract key entities and their relationships, focusing on logical connections and cognitive patterns.

IMPORTANT: Before creating new entities, check if they already exist in the memory graph below. If an entity matches or is very similar to an existing one, REUSE the existing node ID instead of creating a new one.

${existingNodesContext}${existingRelationshipsContext}

Text to analyze: "${text}"

Format response as JSON:
{
    "entities": [
        {
            "id": "ORB-EntityName OR existing-node-id",
            "type": "person|location|event|concept",
            "name": "Original Name"
        }
    ],
    "relationships": [
        {
            "source": "node-id-1",
            "target": "node-id-2",
            "action": "description of relationship"
        }
    ]
}

Guidelines for brain-like processing:
1. Entity Recognition Priority:
   - FIRST: Check if entity matches existing nodes (same person, place, concept)
   - If match found: Use existing node ID, keep existing name
   - If no match: Create new entity with ORB-EntityName format
   - People: Identify as agents (ORB-FirstName format for new ones)
   - Locations: Places that provide spatial context
   - Events: Temporal markers connecting other entities
   - Concepts: Abstract ideas linking multiple entities

2. Relationship Analysis:
   - Check existing relationships for similar patterns
   - Reuse similar action descriptions when appropriate
   - Focus on cause and effect, temporal sequences
   - Include contextual links and logical dependencies

3. Memory Integration Rules:
   - Prioritize connecting to existing nodes over creating new ones
   - If uncertain about entity match, favor reusing existing nodes
   - Only create new entities for genuinely new information
   - Link new information to existing patterns when possible

4. Quality Control:
   - Only extract significant, memorable information
   - Focus on actionable relationships
   - Avoid creating duplicate or near-duplicate entities
   - Ensure relationships make logical sense

Return empty arrays if no meaningful patterns found.`;

    try {
        const completion = await openai.chat.completions.create({
            model: useOpenRouter ? "openai/gpt-4o-mini" : "gpt-4o-mini",
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
    if (!req.session) {
        return res.status(401).json({ error: 'No session - please login again' });
    }

    if (!req.session.userId) {
        return res.status(401).json({ error: 'Session invalid - please login again' });
    }

    req.uid = req.session.userId;
    next();
}

// Input validation middleware
function validateUid(req, res, next) {
    // Handle both JSON and form data
    const uid = req.body.uid || req.query.uid;
    if (!uid || typeof uid !== 'string' || uid.length < 3 || uid.length > 50) {
        return res.status(400).json({ error: 'Invalid user ID format' });
    }
    req.uid = uid.replace(/[^a-zA-Z0-9-_]/g, '');
    next();
}

function validateTextInput(req, res, next) {
    const { message, transcript_segments } = req.body;

    if (message && (typeof message !== 'string' || message.length > 5000)) {
        return res.status(400).json({ error: 'Invalid message format or too long' });
    }

    if (transcript_segments && (!Array.isArray(transcript_segments) || transcript_segments.length > 100)) {
        return res.status(400).json({ error: 'Invalid transcript format or too many segments' });
    }

    next();
}

function validateNodeData(req, res, next) {
    const { name, type } = req.body;

    if (!name || typeof name !== 'string' || name.length > 1000) {
        return res.status(400).json({ error: 'Invalid node name' });
    }

    if (!type || typeof type !== 'string' || type.length > 1000) {
        return res.status(400).json({ error: 'Invalid node type' });
    }

    next();
}

app.get("/overview", (req, res) => {
    res.sendFile(__dirname + '/public/overview.html');
});

app.get("/", (req, res) => {
    res.sendFile(__dirname + '/public/main.html');
});

// Login route
app.get("/login", (req, res) => {
    res.sendFile(__dirname + '/public/login.html');
});

// Auth endpoints
app.post("/api/auth/login", validateUid, async (req, res) => {
    try {
        const uid = req.uid;

        await supabase
            .from('brain_users')
            .upsert([
                {
                    uid: uid
                }
            ]);

        const { data: userRow } = await supabase
            .from('brain_users')
            .select('has_key')
            .eq('uid', uid)
            .single();

        req.session.userId = uid;
        req.session.loginTime = new Date().toISOString();

        req.session.save((err) => {
            if (err) {
                console.error('Session save error:', err);
                return res.status(500).json({ error: 'Login failed' });
            }

            res.json({
                success: true,
                uid: uid,
                hasKey: userRow?.has_key || false
            });
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

app.post("/api/auth/logout", (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ error: 'Logout failed' });
        }
        res.clearCookie('connect.sid');
        res.json({ success: true });
    });
});

// Profile endpoint
app.get('/api/profile', requireAuth, async (req, res) => {
    try {
        const uid = req.uid;
        const { data: rows } = await supabase
            .from('brain_users')
            .select()
            .eq('uid', uid);

        if (rows && rows.length > 0) {
            res.json({
                uid: rows[0].uid,
                loginTime: req.session.loginTime
            });
        } else {
            res.status(404).json({ error: 'User not found' });
        }
    } catch (error) {
        console.error('Profile error:', error);
        res.status(500).json({ error: 'Error fetching profile' });
    }
});

app.get('/api/code-check', requireAuth, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('brain_users')
            .select('code_check')
            .eq('uid', req.uid)
            .single();
        if (error) {
            return res.json({ cipher: null });
        }
        res.json({ cipher: data.code_check });
    } catch (err) {
        res.json({ cipher: null });
    }
});

app.post('/api/code-check', requireAuth, async (req, res) => {
    try {
        const { cipher } = req.body;
        await supabase
            .from('brain_users')
            .update({ code_check: cipher, has_key: true })
            .eq('uid', req.uid);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to save verification' });
    }
});

app.get("/setup", async (req, res) => {
    res.json({ 'is_setup_completed': true });
});

// Edit node endpoint
app.put('/api/node/:nodeId', requireAuth, validateNodeData, async (req, res) => {
    try {
        const { nodeId } = req.params;
        const { name, type } = req.body;
        const uid = req.uid;

        if (!nodeId || typeof nodeId !== 'string' || nodeId.length > 100) {
            return res.status(400).json({ error: 'Invalid node ID' });
        }

        await supabase
            .from('memory_nodes')
            .update({
                name: name,
                type: type
            })
            .eq('uid', uid)
            .eq('node_id', nodeId);

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
    const { nodeId } = req.params;
    const uid = req.uid;

    if (!nodeId || typeof nodeId !== 'string' || nodeId.length > 100) {
        return res.status(400).json({ error: 'Invalid node ID' });
    }

    try {
        await supabase
            .from('memory_relationships')
            .delete()
            .eq('uid', uid)
            .or(`source.eq.${nodeId},target.eq.${nodeId}`);

        await supabase
            .from('memory_nodes')
            .delete()
            .eq('uid', uid)
            .eq('node_id', nodeId);

        // Get updated memory graph
        const memoryGraph = await loadMemoryGraph(uid);
        const visualizationData = {
            nodes: Array.from(memoryGraph.nodes.values()),
            relationships: memoryGraph.relationships
        };

        res.json(visualizationData);
    } catch (error) {
        console.error('Error deleting node:', error);
        res.status(500).json({ error: 'Error deleting node' });
    }
});

// Protected API endpoints
app.post('/api/chat', requireAuth, validateTextInput, async (req, res) => {
    try {
        const { message, context, key } = req.body;

        if (!message || typeof message !== 'string') {
            return res.status(400).json({ error: 'Message is required' });
        }

        let finalContext = context;

        if (key) {
            const memoryGraph = await loadMemoryGraph(req.uid);
            const nodes = [];
            for (const node of memoryGraph.nodes.values()) {
                nodes.push({
                    id: node.id,
                    type: decryptText(node.type, key),
                    name: decryptText(node.name, key),
                    connections: node.connections
                });
            }
            const relationships = memoryGraph.relationships.map(r => ({
                source: r.source,
                target: r.target,
                action: decryptText(r.action, key)
            }));
            finalContext = { nodes, relationships };
        }

        const response = await processChatWithGPT(message, finalContext || { nodes: [], relationships: [] });
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
        const uid = req.uid;
        const sample = req.query.sample === 'true';

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

app.post('/api/memory-graph', requireAuth, async (req, res) => {
    try {
        const uid = req.uid;
        await saveMemoryGraph(uid, req.body);
        res.json({ success: true });
    } catch (error) {
        console.error('Error saving memory graph:', error);
        res.status(500).json({ error: 'Error saving memory graph' });
    }
});

app.post('/api/process-text', requireAuth, validateTextInput, async (req, res) => {
    try {
        const { transcript_segments } = req.body;
        const uid = req.uid;

        if (!transcript_segments || !Array.isArray(transcript_segments)) {
            return res.status(400).json({ error: 'Transcript segments are required' });
        }

        let text = '';
        for (const segment of transcript_segments) {
            if (segment.speaker && segment.text) {
                text += segment.speaker + ': ' + segment.text + '\n';
            }
        }

        if (!text.trim()) {
            return res.status(400).json({ error: 'No valid text content found' });
        }

        // Load existing memory graph to avoid creating duplicates
        const existingMemory = await loadMemoryGraph(uid);
        
        const processedData = await processTextWithGPT(text, existingMemory);
        res.json(processedData);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error processing text' });
    }
});

// Delete all user data
async function deleteAllUserData(uid) {
    try {
        await supabase
            .from('memory_relationships')
            .delete()
            .eq('uid', uid);

        await supabase
            .from('memory_nodes')
            .delete()
            .eq('uid', uid);

        await supabase
            .from('brain_users')
            .delete()
            .eq('uid', uid);

        return true;
    } catch (error) {
        console.error('Error deleting user data:', error);
        throw error;
    }
}

// API Endpoints
app.post('/api/delete-all-data', requireAuth, async (req, res) => {
    try {
        const uid = req.uid;
        await deleteAllUserData(uid);

        // Destroy session since user data is deleted
        req.session.destroy((err) => {
            if (err) {
                console.error('Session destruction error:', err);
            }
        });

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

        if (!node || !node.name || !node.type) {
            return res.status(400).json({ error: 'Invalid node data' });
        }

        if (!connections || !Array.isArray(connections)) {
            return res.status(400).json({ error: 'Invalid connections data' });
        }

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
            model: useOpenRouter ? "openai/gpt-4o-mini" : "gpt-4o-mini",
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
    console.log(`Server running on port ${port}`);
});
