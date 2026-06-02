# The Crafted Game Server

This is the backend server for The Crafted Game, deployed on Render.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Set environment variables (optional for local development):
```bash
cp .env.example .env
```

3. Start the server:
```bash
npm start
```

## Deployment

This server is configured for deployment on Render. The `render.yaml` file contains the deployment configuration.

To deploy:
1. Push this repository to GitHub
2. Connect the repository to Render
3. Render will automatically detect and deploy using `render.yaml`

## Architecture

- **Express.js**: Web server framework
- **Socket.io**: Real-time WebSocket communication for multiplayer game state
- **In-memory storage**: Room state stored in memory (consider Redis for production scaling)

## API

The server uses Socket.io for real-time communication. See `src/script/network.js` in the client for the event protocol.
