import request from "supertest";
import { ObjectId } from "mongodb";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import MongoDBClient from "../../src/mongodb";
import { Paste, User } from "../../src/types";

// Mock external dependencies to isolate the tests
jest.mock("../../src/mongodb");

describe("Express Server Tests", () => {
  // Load environment variables
  dotenv.config();

  // Reference to the Express app
  let app: any;
  // Mock JWT secret
  const JWT_SECRET = "test-secret";

  // Mock user for authentication tests
  const mockUser = {
    _id: new ObjectId().toString(),
    username: "testuser",
    email: "test@example.com",
    role: "user" as "user",
  };

  // Generate a valid JWT token for the mock user
  function generateAuthToken() {
    return jwt.sign(
      { id: mockUser._id, username: mockUser.username, role: mockUser.role },
      JWT_SECRET,
      { expiresIn: "1h" }
    );
  }

  // Mock paste data
  const mockPaste: Paste = {
    _id: new ObjectId(),
    shortId: "mockPasteId",
    title: "Test Paste",
    content: "Test content",
    syntax: "plaintext",
    visibility: "public",
    createdAt: new Date(),
    expiresAt: null,
    userId: new ObjectId(mockUser._id),
    views: 0,
    password: null,
    isDeleted: false,
    tags: ["test", "mock"],
  };

  // Setup for all tests
  beforeAll(async () => {
    // Mock environment variables
    process.env.JWT_SECRET = JWT_SECRET;

    // Mock MongoDB client methods
    const mockMongoClient = MongoDBClient as jest.MockedClass<
      typeof MongoDBClient
    >;
    mockMongoClient.prototype.connect = jest.fn().mockResolvedValue({} as any);
    mockMongoClient.prototype.close = jest.fn().mockResolvedValue(undefined);
    mockMongoClient.prototype.createPaste = jest
      .fn()
      .mockResolvedValue(mockPaste);
    mockMongoClient.prototype.getPasteById = jest
      .fn()
      .mockResolvedValue(mockPaste);
    mockMongoClient.prototype.getRecentPublicPastes = jest
      .fn()
      .mockResolvedValue({
        pastes: [mockPaste],
        pagination: { total: 1, page: 1, limit: 20, pages: 1 },
      });
    mockMongoClient.prototype.deletePasteById = jest
      .fn()
      .mockResolvedValue(true);
    mockMongoClient.prototype.updatePasteById = jest
      .fn()
      .mockResolvedValue(true);
    mockMongoClient.prototype.searchPublicPastes = jest.fn().mockResolvedValue({
      pastes: [mockPaste],
      pagination: { total: 1, page: 1, limit: 20, pages: 1 },
    });
    mockMongoClient.prototype.createUser = jest.fn().mockResolvedValue({
      _id: mockUser._id,
      username: mockUser.username,
      email: mockUser.email,
      role: mockUser.role,
      createdAt: new Date(),
      lastLogin: null,
      isActive: true,
      preferences: {
        defaultSyntax: "plaintext",
        defaultExpiration: "never",
        defaultVisibility: "public",
      },
    });
    mockMongoClient.prototype.loginUser = jest.fn().mockResolvedValue({
      user: {
        _id: mockUser._id,
        username: mockUser.username,
        email: mockUser.email,
        role: mockUser.role,
        createdAt: new Date(),
        lastLogin: new Date(),
        isActive: true,
        preferences: {
          defaultSyntax: "plaintext",
          defaultExpiration: "never",
          defaultVisibility: "public",
        },
      },
      token: generateAuthToken(),
    });
    mockMongoClient.prototype.getUserById = jest.fn().mockResolvedValue({
      _id: mockUser._id,
      username: mockUser.username,
      email: mockUser.email,
      role: mockUser.role,
      createdAt: new Date(),
      lastLogin: new Date(),
      isActive: true,
      preferences: {
        defaultSyntax: "plaintext",
        defaultExpiration: "never",
        defaultVisibility: "public",
      },
    });
    mockMongoClient.prototype.updateUser = jest.fn().mockResolvedValue(true);
    mockMongoClient.prototype.getUserPastes = jest.fn().mockResolvedValue({
      pastes: [mockPaste],
      pagination: { total: 1, page: 1, limit: 20, pages: 1 },
    });
    mockMongoClient.prototype.cleanupExpiredPastes = jest
      .fn()
      .mockResolvedValue(0);

    // Import the app after setting up mocks
    // We need to use dynamic import to ensure mocks are set up first
    const module = await import("../../src/api");
    app = module.app;

    // Wait for app to be fully initialized if needed
    // This ensures any async initialization in the app is complete
    if (module.startServer) {
      await module.startServer();
    }
  });

  afterAll(async () => {
    // Clean up if needed
    if (app && app.close) {
      await new Promise<void>((resolve) => {
        app.close(() => {
          resolve();
        });
      });
    }

    jest.resetAllMocks();
  });

  describe("API Health Check", () => {
    test("GET /api/health should return 200 OK", async () => {
      const response = await request(app).get("/api/health");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("status", "ok");
      expect(response.body).toHaveProperty("message");
    });
  });

  describe("Authentication", () => {
    test("POST /api/auth/register should create a new user", async () => {
      const userData = {
        username: "newuser",
        email: "newuser@example.com",
        password: "password123",
      };

      const response = await request(app)
        .post("/api/auth/register")
        .send(userData);

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty("message");
      expect(response.body).toHaveProperty("user");
      expect(response.body.user).toHaveProperty("username", userData.username);
      expect(response.body.user).toHaveProperty("email", userData.email);
      expect(response.body.user).not.toHaveProperty("password");
    });

    test("POST /api/auth/register should validate required fields", async () => {
      const response = await request(app)
        .post("/api/auth/register")
        .send({ username: "incomplete" });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty("message");
    });

    test("POST /api/auth/login should authenticate user and return token", async () => {
      const loginData = {
        email: "test@example.com",
        password: "password123",
      };

      const response = await request(app)
        .post("/api/auth/login")
        .send(loginData);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("message");
      expect(response.body).toHaveProperty("user");
      expect(response.body).toHaveProperty("token");
    });

    test("GET /api/auth/me should return user profile when authenticated", async () => {
      const token = generateAuthToken();

      const response = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("username", mockUser.username);
    });

    test("GET /api/auth/me should return 401 when not authenticated", async () => {
      const response = await request(app).get("/api/auth/me");

      expect(response.status).toBe(401);
    });
  });

  describe("Paste Operations", () => {
    const token = generateAuthToken();

    test("POST /api/pastes should create a new paste", async () => {
      const pasteData = {
        title: "New Paste",
        content: "This is a test paste",
        syntax: "plaintext",
        visibility: "public",
        tags: ["test"],
      };

      const response = await request(app).post("/api/pastes").send(pasteData);

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty("message");
      expect(response.body).toHaveProperty("paste");
      expect(response.body.paste).toHaveProperty("title", pasteData.title);
      expect(response.body.paste).not.toHaveProperty("content");
      expect(response.body.paste).not.toHaveProperty("password");
    });

    test("POST /api/pastes should require authentication for private pastes", async () => {
      const pasteData = {
        title: "Private Paste",
        content: "This is a private paste",
        visibility: "private",
      };

      const response = await request(app).post("/api/pastes").send(pasteData);

      expect(response.status).toBe(401);
    });

    test("POST /api/pastes should allow private pastes with authentication", async () => {
      const pasteData = {
        title: "Private Paste",
        content: "This is a private paste",
        visibility: "private",
      };

      const response = await request(app)
        .post("/api/pastes")
        .set("Authorization", `Bearer ${token}`)
        .send(pasteData);

      expect(response.status).toBe(201);
    });

    test("GET /api/pastes/recent should return recent public pastes", async () => {
      const response = await request(app).get("/api/pastes/recent");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("pastes");
      expect(response.body).toHaveProperty("pagination");
      expect(Array.isArray(response.body.pastes)).toBe(true);
    });

    test("GET /api/pastes/:shortId should return a paste by ID", async () => {
      const response = await request(app).get(
        `/api/pastes/${mockPaste.shortId}`
      );

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("shortId", mockPaste.shortId);
      expect(response.body).toHaveProperty("content");
    });

    test("GET /api/pastes/:shortId/raw should return raw content", async () => {
      const response = await request(app).get(
        `/api/pastes/${mockPaste.shortId}/raw`
      );

      expect(response.status).toBe(200);
      expect(response.text).toBe(mockPaste.content);
    });

    test("PUT /api/pastes/:shortId should update a paste when authorized", async () => {
      const updateData = {
        title: "Updated Title",
        content: "Updated content",
      };

      const response = await request(app)
        .put(`/api/pastes/${mockPaste.shortId}`)
        .set("Authorization", `Bearer ${token}`)
        .send(updateData);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("message");
      expect(response.body).toHaveProperty("success", true);
    });

    test("DELETE /api/pastes/:shortId should delete a paste when authorized", async () => {
      const response = await request(app)
        .delete(`/api/pastes/${mockPaste.shortId}`)
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("message");
      expect(response.body).toHaveProperty("success", true);
    });

    test("GET /api/pastes/search should search for pastes", async () => {
      const response = await request(app)
        .get("/api/pastes/search")
        .query({ query: "test" });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("pastes");
      expect(response.body).toHaveProperty("pagination");
    });
  });

  describe("User Operations", () => {
    const token = generateAuthToken();

    test("PUT /api/auth/me should update user profile when authenticated", async () => {
      const updateData = {
        username: "updateduser",
      };

      const response = await request(app)
        .put("/api/auth/me")
        .set("Authorization", `Bearer ${token}`)
        .send(updateData);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("message");
      expect(response.body).toHaveProperty("success", true);
    });

    test("GET /api/users/:userId/pastes should return user pastes", async () => {
      const response = await request(app)
        .get(`/api/users/${mockUser._id}/pastes`)
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("pastes");
      expect(response.body).toHaveProperty("pagination");
    });

    test("GET /api/users/:userId/pastes should restrict visibility for non-owners", async () => {
      // Mock implementation to verify visibility filter is set to public
      (
        MongoDBClient.prototype.getUserPastes as jest.Mock
      ).mockImplementationOnce((userId, options) => {
        expect(options.visibility).toBe("public");
        return Promise.resolve({
          pastes: [mockPaste],
          pagination: { total: 1, page: 1, limit: 20, pages: 1 },
        });
      });

      const otherUserId = new ObjectId().toString();
      const response = await request(app).get(
        `/api/users/${otherUserId}/pastes`
      );

      expect(response.status).toBe(200);
    });
  });

  describe("Error Handling", () => {
    test("Should return 404 for undefined routes", async () => {
      const response = await request(app).get("/api/nonexistent-route");
      expect(response.status).toBe(404);
    });

    test("Should handle errors gracefully", async () => {
      // Force an error
      (MongoDBClient.prototype.getPasteById as jest.Mock).mockRejectedValueOnce(
        new Error("Simulated error")
      );

      const response = await request(app).get(
        `/api/pastes/${mockPaste.shortId}`
      );

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty("message");
    });
  });
});
