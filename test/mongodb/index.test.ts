import { MongoMemoryServer } from "mongodb-memory-server";
import MongoDBClient from "../../src/mongodb";

describe.skip("MongoDBClient", () => {
  let mongoServer: MongoMemoryServer;
  let mongoClient: MongoDBClient;
  let testUserId: string;
  let testPasteId: string;

  beforeAll(async () => {
    // Setup in-memory MongoDB server
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();
    mongoClient = new MongoDBClient(mongoUri);
    await mongoClient.connect();
  });

  afterAll(async () => {
    // Cleanup
    await mongoClient.close();
    await mongoServer.stop();
  });

  describe("User Operations", () => {
    const testUser = {
      username: "testuser",
      email: "test@example.com",
      password: "password123",
    };

    test("createUser should create a new user", async () => {
      const user = await mongoClient.createUser(testUser);

      expect(user).toBeDefined();
      expect(user._id).toBeDefined();
      expect(user.username).toBe(testUser.username);
      expect(user.email).toBe(testUser.email);
      expect((user as any).password).toBeUndefined(); // Password should be excluded

      testUserId = user._id!.toString();
    });

    test("createUser should reject duplicate username", async () => {
      await expect(
        mongoClient.createUser({
          ...testUser,
          email: "another@example.com",
        })
      ).rejects.toThrow("Username already exists");
    });

    test("createUser should reject duplicate email", async () => {
      await expect(
        mongoClient.createUser({
          username: "anotheruser",
          email: testUser.email,
          password: "password123",
        })
      ).rejects.toThrow("Email already exists");
    });

    test("loginUser should return user and token with correct credentials", async () => {
      const result = await mongoClient.loginUser({
        email: testUser.email,
        password: testUser.password,
      });

      expect(result).toBeDefined();
      expect(result.user).toBeDefined();
      expect(result.token).toBeDefined();
      expect(result.user.username).toBe(testUser.username);
      expect(result.user.email).toBe(testUser.email);
      expect((result.user as any).password).toBeUndefined();
    });

    test("loginUser should reject with incorrect password", async () => {
      await expect(
        mongoClient.loginUser({
          email: testUser.email,
          password: "wrongpassword",
        })
      ).rejects.toThrow("Invalid email or password");
    });

    test("getUserById should return user details", async () => {
      const user = await mongoClient.getUserById(testUserId);

      expect(user).toBeDefined();
      expect(user.username).toBe(testUser.username);
      expect(user.email).toBe(testUser.email);
      expect((user as any).password).toBeUndefined();
    });

    test("updateUser should update user details", async () => {
      const updates = {
        username: "updateduser",
      };

      const result = await mongoClient.updateUser(testUserId, updates);
      expect(result).toBe(true);

      const user = await mongoClient.getUserById(testUserId);
      expect(user.username).toBe(updates.username);
    });
  });

  describe("Paste Operations", () => {
    let pasteShortId: string;

    test("createPaste should create a new paste", async () => {
      const pasteData = {
        title: "Test Paste",
        content: "This is a test paste",
        syntax: "plaintext",
        visibility: "public" as "public",
        userId: testUserId,
        tags: ["test", "example"],
      };

      const paste = await mongoClient.createPaste(pasteData);

      expect(paste).toBeDefined();
      expect(paste._id).toBeDefined();
      expect(paste.shortId).toBeDefined();
      expect(paste.title).toBe(pasteData.title);
      expect(paste.content).toBe(pasteData.content);
      expect(paste.tags).toEqual(pasteData.tags);

      pasteShortId = paste.shortId;
    });

    test("createPaste should reject private paste without user", async () => {
      await expect(
        mongoClient.createPaste({
          content: "Private paste without user",
          visibility: "private",
        })
      ).rejects.toThrow("User must be logged in to create private pastes");
    });

    test("getPasteById should return paste details", async () => {
      const paste = await mongoClient.getPasteById(pasteShortId);

      expect(paste).toBeDefined();
      expect(paste.shortId).toBe(pasteShortId);
      expect(paste.views).toBe(1); // View should be incremented
    });

    test("getPasteById should increment views", async () => {
      const paste1 = await mongoClient.getPasteById(pasteShortId);
      const paste2 = await mongoClient.getPasteById(pasteShortId);

      expect(paste2.views).toBe(paste1.views + 1);
    });

    test("getPasteById should not increment views when specified", async () => {
      const paste1 = await mongoClient.getPasteById(pasteShortId);
      const paste2 = await mongoClient.getPasteById(pasteShortId, {
        incrementViews: false,
      });

      expect(paste2.views).toBe(paste1.views);
    });

    test("updatePasteById should update paste details", async () => {
      const updates = {
        title: "Updated Paste",
        content: "This is an updated test paste",
        tags: ["updated", "test"],
      };

      const result = await mongoClient.updatePasteById(
        pasteShortId,
        testUserId,
        updates
      );
      expect(result).toBe(true);

      const paste = await mongoClient.getPasteById(pasteShortId, {
        incrementViews: false,
      });
      expect(paste.title).toBe(updates.title);
      expect(paste.content).toBe(updates.content);
      expect(paste.tags).toEqual(updates.tags);
      expect(paste.updatedAt).toBeDefined();
    });

    test("getRecentPublicPastes should return pastes with pagination", async () => {
      // Create a few more pastes
      for (let i = 0; i < 5; i++) {
        await mongoClient.createPaste({
          title: `Paste ${i}`,
          content: `Content ${i}`,
          visibility: "public",
          userId: testUserId,
        });
      }

      const result = await mongoClient.getRecentPublicPastes({
        limit: 3,
        page: 1,
      });

      expect(result.pastes).toBeDefined();
      expect(result.pastes.length).toBeLessThanOrEqual(3);
      expect(result.pagination).toBeDefined();
      expect(result.pagination.total).toBeGreaterThanOrEqual(6); // Including the original test paste
      expect(result.pagination.pages).toBeGreaterThanOrEqual(2);
    });

    test("searchPublicPastes should find pastes by content", async () => {
      const result = await mongoClient.searchPublicPastes({
        query: "updated test",
      });

      expect(result.pastes.length).toBeGreaterThanOrEqual(1);
      const found = result.pastes.some((p) => p.shortId === pasteShortId);
      expect(found).toBe(true);
    });

    test("getUserPastes should return user pastes", async () => {
      const result = await mongoClient.getUserPastes(testUserId, {});

      expect(result.pastes).toBeDefined();
      expect(result.pastes.length).toBeGreaterThanOrEqual(6);
      const found = result.pastes.some((p) => p.shortId === pasteShortId);
      expect(found).toBe(true);
    });

    test("deletePasteById should soft delete paste", async () => {
      const result = await mongoClient.deletePasteById(
        pasteShortId,
        testUserId
      );
      expect(result).toBe(true);

      // The paste should no longer be accessible
      await expect(mongoClient.getPasteById(pasteShortId)).rejects.toThrow(
        "Paste not found or has expired"
      );
    });

    test("cleanupExpiredPastes should mark expired pastes as deleted", async () => {
      // Create a paste with expiry date in the past
      const expiredPaste = await mongoClient.createPaste({
        title: "Expired Paste",
        content: "This should be expired",
        userId: testUserId,
        expiresAt: new Date(Date.now() - 86400000), // 1 day ago
      });

      // Verify it exists
      expect(expiredPaste).toBeDefined();

      // Run cleanup
      const count = await mongoClient.cleanupExpiredPastes();
      expect(count).toBeGreaterThanOrEqual(1);

      // The paste should now be inaccessible
      await expect(
        mongoClient.getPasteById(expiredPaste.shortId)
      ).rejects.toThrow("Paste not found or has expired");
    });
  });

  describe("Password Protected Pastes", () => {
    let protectedPasteId: string;

    test("createPaste should create a password-protected paste", async () => {
      const pasteData = {
        title: "Protected Paste",
        content: "This is a password protected paste",
        password: "secret123",
        userId: testUserId,
      };

      const paste = await mongoClient.createPaste(pasteData);

      expect(paste).toBeDefined();
      expect(paste.password).toBeDefined();
      expect(paste.password).not.toBe(pasteData.password); // Should be hashed

      protectedPasteId = paste.shortId;
    });

    test("getPasteById should hide content for protected paste without password", async () => {
      const paste = await mongoClient.getPasteById(protectedPasteId);

      expect(paste).toBeDefined();
      expect(paste.isProtected).toBe(true);
      expect(paste.content).toBe(""); // Content should be hidden
    });

    test("getPasteById should return content with correct password", async () => {
      const paste = await mongoClient.getPasteById(protectedPasteId, {
        password: "secret123",
      });

      expect(paste).toBeDefined();
      expect(paste.content).toBe("This is a password protected paste");
    });

    test("getPasteById should reject with incorrect password", async () => {
      await expect(
        mongoClient.getPasteById(protectedPasteId, {
          password: "wrongpassword",
        })
      ).rejects.toThrow("Invalid password");
    });
  });
});
