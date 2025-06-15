# OMIApps Collection

A collection of AI-powered applications designed to enhance human-computer interaction. This repository contains three main applications: Brain, Friend, and Jarvis.

Originally made for OMI.me

## Applications

### 🧠 Brain
An intelligent memory graph system that helps organize and connect information in a brain-like network. It processes conversations and text to extract entities and relationships, creating a dynamic knowledge graph that grows with use.

Features:
- Entity and relationship extraction from text
- Visual memory graph representation
- Interactive node management
- GPT-4 powered analysis
- Content enrichment with images and descriptions

### 👥 Friend
A conversational AI companion that provides engaging and meaningful interactions. Built with natural language processing capabilities to maintain context-aware conversations.

Features:
- Natural conversation flow
- Context awareness
- Personality customization
- Memory retention

### 🎯 Jarvis
A focused AI assistant that responds to specific triggers and provides targeted assistance. Inspired by Tony Stark's AI companion, it offers efficient and precise responses.

Features:
- Trigger-based responses
- Task automation
- Efficient message processing
- Customizable command system

## Setup Instructions

### Prerequisites
- Node.js (v14 or higher)
- MySQL (v8.0 or higher)
- npm or yarn package manager

### Installation

1. Clone the repository:
```bash
git clone https://github.com/neooriginal/OMI.me-Apps.git
cd "OMI.me-Apps"
```

2. Set up each application:

#### Brain App
```bash
cd Brain
npm install
cp .env.example .env
# Edit .env with your configuration
```

#### Friend App
```bash
cd ../Friend
npm install
cp .env.example .env
# Edit .env with your configuration
```

#### Jarvis App
```bash
cd ../Jarvis
npm install
cp .env.example .env
# Edit .env with your configuration
```

3. Configure environment variables:
- Each app has its own `.env.example` file
- Copy and rename to `.env`
- Fill in the required values

### Running the Applications

Each application can be run independently:

```bash
# For Brain
cd Brain
npm start

# For Friend
cd Friend
npm start

# For Jarvis
cd Jarvis
npm start
```

4. Add to OMI App

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
- `SUPABASE_URL`: Supabase URL
- `SUPABASE_ANON_KEY`: Supabase ANON Api Key
- `OPENROUTER_API_KEY`: OpenRouter API key
- `PORT`: Server port (default: 3000)
- `NODE_ENV`: Environment (development/production)

### Friend App
- `SUPABASE_URL`: Supabase URL
- `SUPABASE_ANON_KEY`: Supabase ANON Api Key
- `OPENROUTER_API_KEY`: OpenRouter API key
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

The applications in this repository may use external APIs and services (such as OpenRouter, OpenAI, etc.). Users are responsible for:
- Obtaining their own API keys
- Complying with the terms of service of these external services
- Managing any associated costs or usage limits
- Ensuring compliance with data protection and privacy regulations in their jurisdiction

While efforts have been made to secure these applications, users should perform their own security review before deploying in production environments.

## Author

Neo (github.com/neooriginal) - Copyright © 2025
