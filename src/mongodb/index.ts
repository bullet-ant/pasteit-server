// src/mongodb/index.ts
import { MongoClient, ObjectId, Db, Collection } from "mongodb";
import shortid from "shortid";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import {
  User,
  Paste,
  PasteOptions,
  GetPasteOptions,
  SearchOptions,
  PaginationOptions,
  UserCredentials,
  PaginationResult,
  LoginResult,
  RegisterResult,
} from "../types";

dotenv.config();

const PASTES_DB = "pastes";
const PASTES_COLLECTION = "pastes";
const USERS_COLLECTION = "users";
const SALT_ROUNDS = 10;
const JWT_SECRET = process.env.JWT_SECRET || "catonkeyboard";

class MongoDBClient {
  private uri: string;
  private client: MongoClient | null = null;
  private db: Db | null = null;

  constructor(uri?: string) {
    this.uri = uri || "mongodb://localhost:27017";
  }

  async connect(): Promise<Db> {
    try {
      this.client = new MongoClient(this.uri);
      await this.client.connect();
      this.db = this.client.db(PASTES_DB);
      console.log("Connected to MongoDB @", this.uri);

      await this._createIndexes();

      return this.db;
    } catch (error) {
      console.error("MongoDB connection error:", error);
      throw error;
    }
  }

  async _createIndexes(): Promise<void> {
    if (!this.db) throw new Error("Database not connected");

    // Pastes indexes
    await this.db
      .collection(PASTES_COLLECTION)
      .createIndex({ shortId: 1 }, { unique: true });
    await this.db.collection(PASTES_COLLECTION).createIndex({ userId: 1 });
    await this.db.collection(PASTES_COLLECTION).createIndex({ createdAt: -1 });
    await this.db.collection(PASTES_COLLECTION).createIndex({ expiresAt: 1 });
    await this.db
      .collection(PASTES_COLLECTION)
      .createIndex({ visibility: 1, createdAt: -1 });
    await this.db.collection(PASTES_COLLECTION).createIndex({ tags: 1 });

    // Users indexes
    await this.db
      .collection(USERS_COLLECTION)
      .createIndex({ username: 1 }, { unique: true });
    await this.db
      .collection(USERS_COLLECTION)
      .createIndex({ email: 1 }, { unique: true });
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      console.log("MongoDB connection closed");
    }
  }

  // ----- Paste Operations -----

  async createPaste({
    title,
    content,
    syntax = "plaintext",
    visibility = "public",
    expiresAt = null,
    userId = null,
    password = null,
  }: PasteOptions): Promise<Paste> {
    try {
      if (!this.db) throw new Error("Database not connected");

      const collection = this.db.collection<Paste>(PASTES_COLLECTION);

      // Validate input
      if (!content) {
        throw new Error("Paste content is required");
      }

      // Check if private paste and user validation
      if (visibility === "private" && !userId) {
        throw new Error("User must be logged in to create private pastes");
      }

      // Handle password
      let hashedPassword: string | null = null;
      if (password) {
        hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
      }

      // Create paste document
      const paste: Paste = {
        shortId: shortid.generate(),
        title: title || null,
        content,
        syntax,
        visibility,
        createdAt: new Date(),
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        userId: userId ? new ObjectId(userId) : null,
        isProtected: !!password,
        password: hashedPassword,
        isDeleted: false,
      };

      const result = await collection.insertOne(paste);
      return { ...paste, _id: result.insertedId };
    } catch (error) {
      console.error("Error creating paste:", error);
      throw error;
    }
  }

  async getPasteById(
    shortId: string,
    { password = null }: GetPasteOptions = {}
  ): Promise<Paste> {
    try {
      if (!this.db) throw new Error("Database not connected");

      const collection = this.db.collection<Paste>(PASTES_COLLECTION);

      // Find paste by shortId and not deleted
      const paste = await collection.findOne({
        shortId,
        isDeleted: false,
        $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
      });

      if (!paste) {
        throw new Error("Paste not found or has expired");
      }

      // Check if password protected
      if (paste.password) {
        if (!password) {
          return {
            _id: paste._id,
            shortId: paste.shortId,
            title: paste.title,
            content: "", // Don't include content for protected pastes
            createdAt: paste.createdAt,
            expiresAt: paste.expiresAt,
            syntax: paste.syntax,
            visibility: paste.visibility,
            userId: paste.userId,
            isProtected: true,
            password: paste.password,
            isDeleted: paste.isDeleted,
          };
        }

        const passwordMatch = await bcrypt.compare(password, paste.password);
        if (!passwordMatch) {
          throw new Error("Invalid password");
        }
      }

      return paste;
    } catch (error) {
      console.error("Error getting paste:", error);
      throw error;
    }
  }

  async deletePasteById(
    shortId: string,
    userId: string | ObjectId
  ): Promise<boolean> {
    try {
      if (!this.db) throw new Error("Database not connected");

      const collection = this.db.collection<Paste>(PASTES_COLLECTION);

      // Find the paste first to validate ownership
      const paste = await collection.findOne({ shortId });

      if (!paste) {
        throw new Error("Paste not found");
      }

      // Check ownership - only owner or admin can delete (admin check would be in middleware)
      if (paste.userId && paste.userId.toString() !== userId.toString()) {
        throw new Error("Not authorized to delete this paste");
      }

      // Perform soft delete
      const result = await collection.updateOne(
        { shortId },
        { $set: { isDeleted: true } }
      );

      return result.modifiedCount > 0;
    } catch (error) {
      console.error("Error deleting paste:", error);
      throw error;
    }
  }

  async updatePasteById(
    shortId: string,
    userId: string | ObjectId,
    updates: Partial<Paste>
  ): Promise<boolean> {
    try {
      if (!this.db) throw new Error("Database not connected");

      const collection = this.db.collection<Paste>(PASTES_COLLECTION);

      // Find the paste first to validate ownership
      const paste = await collection.findOne({ shortId });

      if (!paste) {
        throw new Error("Paste not found");
      }

      // Check ownership - only owner can update
      if (paste.userId && paste.userId.toString() !== userId.toString()) {
        throw new Error("Not authorized to update this paste");
      }

      // Prevent updating certain fields
      const {
        _id,
        shortId: sid,
        createdAt,
        userId: uid,
        ...allowedUpdates
      } = updates;

      // Handle password update if provided
      if (updates.password) {
        (allowedUpdates as any).password = await bcrypt.hash(
          updates.password,
          SALT_ROUNDS
        );
      }

      const result = await collection.updateOne(
        { shortId },
        { $set: { ...allowedUpdates, updatedAt: new Date() } }
      );

      return result.modifiedCount > 0;
    } catch (error) {
      console.error("Error updating paste:", error);
      throw error;
    }
  }

  async getRecentPublicPastes({
    page = 1,
    limit = 20,
  }: PaginationOptions): Promise<PaginationResult<Paste>> {
    try {
      if (!this.db) throw new Error("Database not connected");

      const collection = this.db.collection<Paste>(PASTES_COLLECTION);
      const skip = (page - 1) * limit;

      // Build query - public, not deleted, not expired
      const query: any = {
        visibility: "public",
        isDeleted: false,
        $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
      };

      // First get total count for pagination
      const total = await collection.countDocuments(query);

      // Then get paginated results
      const pastes = await collection
        .find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .project<Paste>({ password: 0 }) // Exclude password from results
        .toArray();

      return {
        pastes,
        pagination: {
          total,
          page,
          limit,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      console.error("Error getting recent pastes:", error);
      throw error;
    }
  }

  async searchPublicPastes({
    query,
    page = 1,
    limit = 20,
  }: SearchOptions): Promise<PaginationResult<Paste>> {
    try {
      if (!this.db) throw new Error("Database not connected");

      const collection = this.db.collection<Paste>(PASTES_COLLECTION);
      const skip = (page - 1) * limit;

      // Build query - public, not deleted, not expired
      const searchQuery: any = {
        visibility: "public",
        isDeleted: false,
        $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
      };

      // Add text search if query provided
      if (query) {
        // First try to create text index if it doesn't exist
        try {
          await collection.createIndex({
            title: "text",
            content: "text",
          });
        } catch (err) {
          // Index might already exist, continue
          console.error("Error creating text index:", err);
        }

        searchQuery.$text = { $search: query };
      }

      // First get total count for pagination
      const total = await collection.countDocuments(searchQuery);

      // Then get paginated results
      const pastes = await collection
        .find(searchQuery)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .project<Paste>({ password: 0 }) // Exclude password from results
        .toArray();

      return {
        pastes,
        pagination: {
          total,
          page,
          limit,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      console.error("Error searching pastes:", error);
      throw error;
    }
  }

  async getUserPastes(
    userId: string,
    { page = 1, limit = 20 }: PaginationOptions
  ): Promise<PaginationResult<Paste>> {
    try {
      if (!this.db) throw new Error("Database not connected");

      const collection = this.db.collection<Paste>(PASTES_COLLECTION);
      const skip = (page - 1) * limit;

      // Build query - by user, not deleted, not expired
      const query: any = {
        userId: new ObjectId(userId),
        isDeleted: false,
        $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
      };

      // First get total count for pagination
      const total = await collection.countDocuments(query);

      // Then get paginated results
      const pastes = await collection
        .find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .project<Paste>({ password: 0 }) // Exclude password from results
        .toArray();

      return {
        pastes,
        pagination: {
          total,
          page,
          limit,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      console.error("Error getting user pastes:", error);
      throw error;
    }
  }

  // ----- User Operations -----

  async createUser({ username, email, password }: UserCredentials): Promise<{
    user: Omit<User, "password">;
    token: string;
  }> {
    try {
      if (!this.db) throw new Error("Database not connected");

      if (!username || !email || !password) {
        throw new Error("Username, email, and password are required");
      }

      const collection = this.db.collection<User>(USERS_COLLECTION);

      // Check if username or email already exists
      const existingUser = await collection.findOne({
        $or: [{ email }, { username }],
      });

      if (existingUser && existingUser.email === email) {
        throw new Error("Email or username already exists");
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

      const user: User = {
        username,
        email,
        password: hashedPassword,
        createdAt: new Date(),
        lastLogin: null,
        role: "user",
        isActive: true,
        preferences: {
          defaultSyntax: "plaintext",
          defaultExpiration: "never",
          defaultVisibility: "public",
        },
      };

      const result = await collection.insertOne(user);

      const token = jwt.sign(
        {
          id: result.insertedId,
          username: user.username,
          role: user.role,
        },
        JWT_SECRET,
        { expiresIn: "7d" }
      );

      // Return user without password
      const { password: pwd, ...userWithoutPassword } = user;

      return {
        user: userWithoutPassword,
        token,
      };
    } catch (error) {
      console.error("Error creating user:", error);
      throw error;
    }
  }

  async loginUser({ email, password }: UserCredentials): Promise<{
    user: Omit<User, "password">;
    token: string;
  }> {
    try {
      if (!this.db) throw new Error("Database not connected");

      const collection = this.db.collection<User>(USERS_COLLECTION);

      // Find user by email
      const user = await collection.findOne({ email });

      if (!user) {
        throw new Error("Invalid email or password");
      }

      // Check if user is active
      if (!user.isActive) {
        throw new Error("Account is disabled");
      }

      // Verify password
      const passwordMatch = await bcrypt.compare(password, user.password);

      if (!passwordMatch) {
        throw new Error("Invalid email or password");
      }

      // Update last login
      await collection.updateOne(
        { _id: user._id },
        { $set: { lastLogin: new Date() } }
      );

      // Generate JWT token
      const token = jwt.sign(
        {
          id: user._id,
          username: user.username,
          role: user.role,
        },
        JWT_SECRET,
        { expiresIn: "7d" }
      );

      // Return user without password
      const { password: pwd, ...userWithoutPassword } = user;
      return {
        user: userWithoutPassword,
        token,
      };
    } catch (error) {
      console.error("Error logging in user:", error);
      throw error;
    }
  }

  async getUserById(
    userId: string | ObjectId
  ): Promise<Omit<User, "password">> {
    try {
      if (!this.db) throw new Error("Database not connected");

      const collection = this.db.collection<User>(USERS_COLLECTION);

      const user = await collection.findOne({ _id: new ObjectId(userId) });

      if (!user) {
        throw new Error("User not found");
      }

      // Return user without password
      const { password, ...userWithoutPassword } = user;
      return userWithoutPassword;
    } catch (error) {
      console.error("Error getting user:", error);
      throw error;
    }
  }

  async getUserByUsername(
    username: string | ObjectId
  ): Promise<Omit<User, "password">> {
    try {
      if (!this.db) throw new Error("Database not connected");

      const collection = this.db.collection<User>(USERS_COLLECTION);

      const user = await collection.findOne({ _id: new ObjectId(username) });

      if (!user) {
        throw new Error("User not found");
      }

      // Return user without password
      const { password, ...userWithoutPassword } = user;
      return userWithoutPassword;
    } catch (error) {
      console.error("Error getting user:", error);
      throw error;
    }
  }

  async updateUser(
    userId: string | ObjectId,
    updates: Partial<User>
  ): Promise<boolean> {
    try {
      if (!this.db) throw new Error("Database not connected");

      const collection = this.db.collection<User>(USERS_COLLECTION);

      // Prevent updating certain fields
      const { _id, username, role, createdAt, password, ...allowedUpdates } =
        updates;

      // Handle password update if provided
      if (updates.password) {
        (allowedUpdates as any).password = await bcrypt.hash(
          updates.password,
          SALT_ROUNDS
        );
      }

      const result = await collection.updateOne(
        { _id: new ObjectId(userId) },
        { $set: allowedUpdates }
      );

      if (result.matchedCount === 0) {
        throw new Error("User not found");
      }

      return result.modifiedCount > 0;
    } catch (error) {
      console.error("Error updating user:", error);
      throw error;
    }
  }

  // ----- Utility Methods -----

  async cleanupExpiredPastes(): Promise<number> {
    try {
      if (!this.db) throw new Error("Database not connected");

      const collection = this.db.collection<Paste>(PASTES_COLLECTION);

      // Mark expired pastes as deleted
      const result = await collection.updateMany(
        {
          expiresAt: { $lt: new Date() },
          isDeleted: false,
        },
        { $set: { isDeleted: true } }
      );

      return result.modifiedCount;
    } catch (error) {
      console.error("Error cleaning up expired pastes:", error);
      throw error;
    }
  }
}

export default MongoDBClient;
