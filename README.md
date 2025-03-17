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

## Environment Variables

### Brain App
- `DB_HOST`: MySQL host
- `DB_PORT`: MySQL port
- `DB_USER`: Database username
- `DB_PASSWORD`: Database password
- `DB_NAME`: Database name
- `OPENROUTER_API_KEY`: OpenRouter API key
- `PORT`: Server port (default: 3000)
- `NODE_ENV`: Environment (development/production)

### Friend App
- `DB_HOST`: MySQL host
- `DB_PORT`: MySQL port
- `DB_USER`: Database username
- `DB_PASSWORD`: Database password
- `DB_NAME`: Database name
- `OPENROUTER_API_KEY`: OpenRouter API key
- `PORT`: Server port (default: 5000)

### Jarvis App
- `PORT`: Server port (default: 5000)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

All applications are licensed under the MIT License - see the LICENSE file in each application directory for details.

## Author

Neo (github.com/neooriginal) - Copyright © 2025
