-- Supabase setup script for OMI Apps
-- Run this in your Supabase SQL editor to set up all required tables and functions

-- Create a custom function to execute SQL (if needed)
CREATE OR REPLACE FUNCTION exec_sql(sql_query TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    EXECUTE sql_query;
    RETURN 'SQL executed successfully';
EXCEPTION
    WHEN OTHERS THEN
        RETURN 'Error: ' || SQLERRM;
END;
$$;

-- Brain App Tables
CREATE TABLE IF NOT EXISTS brain_users (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    uid TEXT UNIQUE NOT NULL,
    code_check TEXT,
    has_key BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE brain_users ADD COLUMN IF NOT EXISTS code_check TEXT;
ALTER TABLE brain_users ADD COLUMN IF NOT EXISTS has_key BOOLEAN DEFAULT false;

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

CREATE TABLE IF NOT EXISTS memory_relationships (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    uid TEXT NOT NULL,
    source TEXT NOT NULL,
    target TEXT NOT NULL,
    action TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Friend App Table
CREATE TABLE IF NOT EXISTS frienddb (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    uid TEXT UNIQUE NOT NULL,
    cooldown INTEGER DEFAULT 0,
    responsepercentage INTEGER DEFAULT 10,
    custominstruction TEXT DEFAULT '',
    personality TEXT DEFAULT '100% chill; 35% friendly; 55% teasing; 10% thoughtful; 20% humorous; 5% deep; 20% nik',
    logs JSONB DEFAULT '[]',
    listenedto INTEGER DEFAULT 0,
    rating INTEGER DEFAULT 100,
    goals JSONB DEFAULT '[]',
    analytics JSONB DEFAULT '{}',
    word_counts JSONB DEFAULT '{}',
    time_distribution JSONB DEFAULT '{"morning":0,"afternoon":0,"evening":0,"night":0}',
    total_words INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Search App Tables
CREATE TABLE IF NOT EXISTS search_queries (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    uid TEXT NOT NULL,
    session_id TEXT,
    query TEXT NOT NULL,
    reasoning TEXT,
    results JSONB DEFAULT '{}'::jsonb,
    transcript_excerpt TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS search_settings (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    uid TEXT UNIQUE NOT NULL,
    cooldown_seconds INTEGER DEFAULT 120,
    min_sentences INTEGER DEFAULT 3,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Jarvis App Table
CREATE TABLE IF NOT EXISTS jarvis_sessions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    session_id TEXT UNIQUE NOT NULL,
    user_name TEXT,
    user_facts TEXT,
    messages JSONB DEFAULT '[]',
    last_activity TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_memory_nodes_uid ON memory_nodes(uid);
CREATE INDEX IF NOT EXISTS idx_memory_nodes_node_id ON memory_nodes(node_id);
CREATE INDEX IF NOT EXISTS idx_memory_relationships_uid ON memory_relationships(uid);
CREATE INDEX IF NOT EXISTS idx_memory_relationships_source ON memory_relationships(source);
CREATE INDEX IF NOT EXISTS idx_memory_relationships_target ON memory_relationships(target);
CREATE INDEX IF NOT EXISTS idx_frienddb_uid ON frienddb(uid);
CREATE INDEX IF NOT EXISTS idx_search_queries_uid ON search_queries(uid);
CREATE INDEX IF NOT EXISTS idx_search_queries_created_at ON search_queries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jarvis_sessions_session_id ON jarvis_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_jarvis_sessions_last_activity ON jarvis_sessions(last_activity);

-- Enable Row Level Security
ALTER TABLE brain_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE frienddb ENABLE ROW LEVEL SECURITY;
ALTER TABLE search_queries ENABLE ROW LEVEL SECURITY;
ALTER TABLE search_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE jarvis_sessions ENABLE ROW LEVEL SECURITY;

-- Create basic policies
CREATE POLICY "Users can access their own data" ON brain_users FOR ALL USING (true);
CREATE POLICY "Users can access their own memory nodes" ON memory_nodes FOR ALL USING (true);
CREATE POLICY "Users can access their own relationships" ON memory_relationships FOR ALL USING (true);
CREATE POLICY "Users can access their own friend data" ON frienddb FOR ALL USING (true);
CREATE POLICY "Users can access their own search queries" ON search_queries FOR ALL USING (true);
CREATE POLICY "Users can manage their search settings" ON search_settings FOR ALL USING (true);
CREATE POLICY "Users can access their own sessions" ON jarvis_sessions FOR ALL USING (true);

SELECT 'All OMI tables and functions created successfully!' as result; 