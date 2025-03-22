# PasteIt Server

A feature-rich pastebin API server built with Node.js, Express, TypeScript, and MongoDB.

## Features

- Create, read, update, and delete pastes
- User authentication with JWT
- Public, private, and unlisted pastes
- Password-protected pastes
- Syntax highlighting support
- Paste expiration
- Tagging system
- Search functionality
- User preferences

## Tech Stack

- **Runtime**: Node.js
- **API Framework**: Express
- **Language**: TypeScript
- **Database**: MongoDB
- **Authentication**: JWT (JSON Web Tokens)
- **Testing**: Jest, Supertest

## Getting Started

### Prerequisites

- Node.js (>= 18.0.0)
- MongoDB

### Installation

1. Clone the repository:

```bash
git clone https://github.com/bullet-ant/pasteit-server.git
cd pasteit-server
```

2. Install dependencies:

```bash
npm install
```

3. Create a `.env` file in the root directory with the following variables:

```
PORT=3000
MONGODB_URI=mongodb://localhost:27017/pastes
JWT_SECRET=your_jwt_secret_key
```

4. Start the development server:

```bash
npm run dev
```

## Building for Production

```bash
npm run build
npm start
```

## API Endpoints

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Register a new user |
| POST | `/api/auth/login` | Login with email and password |
| GET | `/api/auth/me` | Get current user profile |
| PUT | `/api/auth/me` | Update user profile |

### Pastes

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/pastes` | Create a new paste |
| GET | `/api/pastes/recent` | Get recent public pastes |
| GET | `/api/pastes/:shortId` | Get a paste by ID |
| POST | `/api/pastes/:shortId` | Access a protected paste (with password) |
| GET | `/api/pastes/:shortId/raw` | Get raw paste content |
| PUT | `/api/pastes/:shortId` | Update a paste |
| DELETE | `/api/pastes/:shortId` | Delete a paste |
| GET | `/api/pastes/search` | Search for pastes |

### Users

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/users/:userId` | Get user profile |
| GET | `/api/users/:userId/pastes` | Get pastes created by a user |

### System

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check endpoint |

## Testing

Run the test suite with:

```bash
npm test
```

## Project Structure

```
.
├── src/
│   ├── api/        # Express routes and API handlers
│   ├── mongodb/    # MongoDB connection and data access
│   ├── types.ts    # TypeScript type definitions
│   └── index.ts    # Application entry point
├── test/           # Test files
└── package.json    # Project dependencies and scripts
```

## License

This project is licensed under the ISC License.