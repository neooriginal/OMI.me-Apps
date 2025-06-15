# OMIApps Collection

A collection of AI-powered applications designed to enhance human-computer interaction. This repository contains three main applications: Brain, Friend, and Jarvis - all powered by Supabase for robust, scalable data management.

Originally made for OMI.me

## Applications

### 🧠 Brain
An intelligent memory graph system that helps organize and connect information in a brain-like network. It processes conversations and text to extract entities and relationships, creating a dynamic knowledge graph that grows with use.

**Features:**
- Entity and relationship extraction from text
- Visual memory graph representation
- Interactive node management
- GPT-4 powered analysis
- Content enrichment with images and descriptions
- Session-based authentication with secure cookie management
- Comprehensive input validation and sanitization
- Auto-table creation on startup
- Real-time memory graph updates

<img width="1355" alt="Bildschirmfoto 2025-06-15 um 22 16 54" src="https://github.com/user-attachments/assets/8f1c25ae-bb36-48d1-aeaf-7891d41c9b32" />


### 👥 Friend
A conversational AI companion that provides engaging and meaningful interactions. Built with natural language processing capabilities to maintain context-aware conversations.

**Features:**
- Natural conversation flow with persistent storage
- Context awareness with conversation history
- Advanced user analytics and engagement tracking
- JSONB-based flexible data storage
- Memory retention and personality customization
- Auto-table creation with optimized indexes

![image](https://github.com/user-attachments/assets/ba3846fd-a6b0-4c0a-855d-97195b28adfe)


### 🎯 Jarvis
A focused AI assistant that responds to specific triggers and provides targeted assistance. Inspired by Tony Stark's AI companion, it offers efficient and precise responses.

**Features:**
- Trigger-based responses with persistent message buffering
- Task automation and message queuing
- Efficient message processing with timestamp handling
- Customizable command system
- In-memory processing with database persistence

## Setup Instructions

### Prerequisites
- Node.js (v16 or higher)
- A Supabase account and project
- npm or yarn package manager

### Database Setup

1. **Create a Supabase Project:**
   - Go to [supabase.com](https://supabase.com) and create a new project
   - Note your project URL and anon key from the project settings

2. **Run Database Setup:**
   ```bash
   # Connect to your Supabase project and run the setup script
   # Copy the contents of setup-supabase.sql and run it in your Supabase SQL editor
   ```

   The setup script will create:
   - All required tables with proper schemas
   - Indexes for optimal performance  
   - Row Level Security (RLS) policies
   - An `exec_sql` function for programmatic table creation

### Installation

1. **Clone the repository:**
```bash
git clone https://github.com/neooriginal/OMI.me-Apps.git
cd "OMI.me-Apps"
```

2. **Set up each application:**

#### Brain App
```bash
cd Brain
npm install
```

Create a `.env` file with:
```env
SUPABASE_URL=your_supabase_project_url
SUPABASE_ANON_KEY=your_supabase_anon_key
OPENROUTER_API_KEY=your_openrouter_api_key
SESSION_SECRET=your_secure_session_secret
FRONTEND_URL=http://localhost:3000
PORT=3000
NODE_ENV=development
```

#### Friend App
```bash
cd ../Friend
npm install
```

Create a `.env` file with:
```env
SUPABASE_URL=your_supabase_project_url
SUPABASE_ANON_KEY=your_supabase_anon_key
OPENROUTER_API_KEY=your_openrouter_api_key
PORT=5000
```

#### Jarvis App
```bash
cd ../Jarvis
npm install
```

Create a `.env` file with:
```env
SUPABASE_URL=your_supabase_project_url
SUPABASE_ANON_KEY=your_supabase_anon_key
PORT=8000
```

### Running the Applications

Each application can be run independently and will auto-create required tables on startup:

```bash
# For Brain (with session management)
cd Brain
npm start

# For Friend (with analytics)
cd Friend
npm start

# For Jarvis (with message buffering)  
cd Jarvis
npm start
```

**Note:** On first startup, each app will automatically create its required database tables. Check the console output to confirm successful table creation.

### OMI App Integration

#### Brain App
- Memory Creation Trigger:
/api/process-text

#### Friend App
- Transcription Processed:
/webhook

- Enable Notifications

#### Jarvis App
- Transcription Processed:
/webhook

- Enable Notifications


## Environment Variables

### Brain App
- `SUPABASE_URL`: Your Supabase project URL
- `SUPABASE_ANON_KEY`: Your Supabase anon key  
- `OPENROUTER_API_KEY`: OpenRouter API key for GPT-4 access
- `SESSION_SECRET`: Secure secret for session encryption (auto-generated if not provided)
- `FRONTEND_URL`: Frontend URL for CORS (default: http://localhost:3000)
- `PORT`: Server port (default: 3000)
- `NODE_ENV`: Environment (development/production)

### Friend App
- `SUPABASE_URL`: Your Supabase project URL
- `SUPABASE_ANON_KEY`: Your Supabase anon key
- `OPENROUTER_API_KEY`: OpenRouter API key for AI responses
- `PORT`: Server port (default: 5000)

### Jarvis App
- `PORT`: Server port (default: 5000)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

All applications are licensed under the MIT License with Attribution Requirements - see the LICENSE file in each application directory for details.

**Attribution Requirements:**
- Any derivative works, modifications, or distributions must prominently credit Neo (github.com/neooriginal)
- Credit must be visible in user-facing documentation, about pages, or similar locations
- Credit must include a link to the original repository or author's GitHub profile

## Disclaimer

THIS SOFTWARE IS PROVIDED "AS IS" AND ANY EXPRESSED OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

The applications in this repository may use external APIs and services (such as OpenRouter, OpenAI, Supabase, etc.). Users are responsible for:
- Obtaining their own API keys and database access
- Complying with the terms of service of these external services
- Managing any associated costs or usage limits
- Ensuring compliance with data protection and privacy regulations in their jurisdiction

While efforts have been made to secure these applications, users should perform their own security review before deploying in production environments.

## Author

Neo (github.com/neooriginal) - Copyright © 2025
