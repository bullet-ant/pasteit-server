import cors from "cors";
import morgan from "morgan";
import helmet from "helmet";
import cron from "node-cron";
import express, { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import MongoDBClient from "../mongodb";
import dotenv from "dotenv";
import { ObjectId } from "mongodb";

dotenv.config();

// Define custom type for the request with user
interface AuthRequest extends Request {
  user?: {
    id: string | ObjectId;
    username: string;
    role: string;
  };
}

// Initialize database client
export function initializeDbClient(uri?: string) {
  return new MongoDBClient(uri || process.env.MONGODB_URI);
}

export const dbClient = initializeDbClient();

// Create and configure Express app
export function createApp(client: MongoDBClient) {
  // Initialize app
  const app = express();

  const JWT_SECRET = process.env.JWT_SECRET || "catonkeyboard";

  // Middleware
  app.use(helmet());
  app.use(cors());
  app.use(morgan("dev"));
  app.use(express.json());

  // Authentication middleware
  const authenticateToken = (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ) => {
    const authHeader = req.headers["authorization"] as string | undefined;
    const token = authHeader && authHeader.split(" ")[1];

    if (!token) {
      return res.status(401).json({ message: "Authentication required" });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
      if (err) {
        return res.status(403).json({ message: "Invalid or expired token" });
      }

      req.user = user as AuthRequest["user"];
      next();
    });
  };

  // Optional authentication middleware (doesn't require auth but provides user if available)
  const optionalAuthenticateToken = (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ) => {
    const authHeader = req.headers["authorization"] as string | undefined;
    const token = authHeader && authHeader.split(" ")[1];

    if (token) {
      jwt.verify(token, JWT_SECRET, (err, user) => {
        if (!err) {
          req.user = user as AuthRequest["user"];
        }
      });
    }

    next();
  };

  // ----- Routes -----

  // Health check route
  app.get("/api/health", (req: Request, res: Response) => {
    res.status(200).json({ status: "OK", message: "PasteIt API is running" });
  });

  // ----- Paste Routes -----

  // Create a new paste
  app.post(
    "/api/pastes",
    optionalAuthenticateToken,
    async (req: AuthRequest, res: Response) => {
      try {
        const { title, content, syntax, visibility, expiresAt, password } =
          req.body;

        // Check if private paste and user authentication
        if (visibility === "private" && !req.user) {
          return res.status(401).json({
            message: "User must be logged in to create private pastes",
          });
        }

        const userId = req.user ? req.user.id : null;

        const paste = await dbClient.createPaste({
          title,
          content,
          syntax,
          visibility,
          expiresAt,
          userId,
          password,
        });

        // Don't return the content or password in the response
        const { content: c, password: p, ...pasteResponse } = paste;

        res.status(201).json({
          message: "Paste created successfully",
          paste: pasteResponse,
        });
      } catch (error: any) {
        res.status(400).json({ message: error.message });
      }
    }
  );

  // Get recent public pastes
  app.get("/api/pastes/recent", async (req: Request, res: Response) => {
    try {
      const page = req.query.page ? parseInt(req.query.page as string) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;
      const syntax = (req.query.syntax as string) || null;

      const result = await dbClient.getRecentPublicPastes({
        page,
        limit,
        syntax,
      });

      res.status(200).json(result);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // Search pastes
  app.get("/api/pastes/search", async (req: Request, res: Response) => {
    try {
      const query = req.query.q as string;
      const page = req.query.page ? parseInt(req.query.page as string) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;

      const result = await dbClient.searchPublicPastes({
        query,
        page,
        limit,
      });

      res.status(200).json(result);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // Get a paste by ID
  app.get(
    "/api/pastes/:shortId",
    optionalAuthenticateToken,
    async (req: AuthRequest, res: Response) => {
      try {
        const { shortId } = req.params;
        const paste = await dbClient.getPasteById(shortId);

        // Check if paste is private and user has access
        if (paste.visibility === "private") {
          if (
            !req.user ||
            (paste.userId && paste.userId.toString() !== req.user.id.toString())
          ) {
            return res.status(403).json({
              message: "You do not have permission to view this paste",
            });
          }
        }

        res.status(200).json(paste);
      } catch (error: any) {
        if (error.message === "Paste not found or has expired") {
          return res.status(404).json({ message: error.message });
        }
        if (error.message === "Invalid password") {
          return res.status(401).json({ message: error.message });
        }
        res.status(400).json({ message: error.message });
      }
    }
  );

  // Get a protected paste by ID
  app.post(
    "/api/pastes/:shortId",
    optionalAuthenticateToken,
    async (req: AuthRequest, res: Response) => {
      try {
        const { shortId } = req.params;
        const { password } = req.body;

        const paste = await dbClient.getPasteById(shortId, {
          password: password || null,
        });

        // Check if paste is private and user has access
        if (paste.visibility === "private") {
          if (
            !req.user ||
            (paste.userId && paste.userId.toString() !== req.user.id.toString())
          ) {
            return res.status(403).json({
              message: "You do not have permission to view this paste",
            });
          }
        }

        res.status(200).json(paste);
      } catch (error: any) {
        if (error.message === "Paste not found or has expired") {
          return res.status(404).json({ message: error.message });
        }
        if (error.message === "Invalid password") {
          return res.status(401).json({ message: error.message });
        }
        res.status(400).json({ message: error.message });
      }
    }
  );

  // Get raw paste content
  app.post(
    "/api/pastes/:shortId/raw",
    optionalAuthenticateToken,
    async (req: AuthRequest, res: Response) => {
      try {
        const { shortId } = req.params;
        const { password } = req.body;

        const paste = await dbClient.getPasteById(shortId, {
          password,
        });

        // Check if paste is private and user has access
        if (paste.visibility === "private") {
          if (
            !req.user ||
            (paste.userId && paste.userId.toString() !== req.user.id.toString())
          ) {
            return res.status(403).json({
              message: "You do not have permission to view this paste",
            });
          }
        }

        res.setHeader("Content-Type", "text/plain");
        res.send(paste.content);
      } catch (error: any) {
        if (error.message === "Paste not found or has expired") {
          return res.status(404).json({ message: error.message });
        }
        if (error.message === "Invalid password") {
          return res.status(401).json({ message: error.message });
        }
        res.status(400).json({ message: error.message });
      }
    }
  );

  // Delete a paste
  app.delete(
    "/api/pastes/:shortId",
    authenticateToken,
    async (req: AuthRequest, res: Response) => {
      try {
        const { shortId } = req.params;
        const userId = req.user!.id;

        const success = await dbClient.deletePasteById(shortId, userId);

        res.status(200).json({
          message: "Paste deleted successfully",
          success,
        });
      } catch (error: any) {
        if (error.message === "Paste not found") {
          return res.status(404).json({ message: error.message });
        }
        if (error.message === "Not authorized to delete this paste") {
          return res.status(403).json({ message: error.message });
        }
        res.status(400).json({ message: error.message });
      }
    }
  );

  // Update a paste
  app.put(
    "/api/pastes/:shortId",
    authenticateToken,
    async (req: AuthRequest, res: Response) => {
      try {
        const { shortId } = req.params;
        const userId = req.user!.id;
        const updates = req.body;

        const success = await dbClient.updatePasteById(
          shortId,
          userId,
          updates
        );

        res.status(200).json({
          message: "Paste updated successfully",
          success,
        });
      } catch (error: any) {
        if (error.message === "Paste not found") {
          return res.status(404).json({ message: error.message });
        }
        if (error.message === "Not authorized to update this paste") {
          return res.status(403).json({ message: error.message });
        }
        res.status(400).json({ message: error.message });
      }
    }
  );

  // ----- User Routes -----

  // User registration
  app.post("/api/auth/register", async (req: Request, res: Response) => {
    try {
      const { username, email, password } = req.body;

      // Validate input
      if (!username || !email || !password) {
        return res
          .status(400)
          .json({ message: "Username, email and password are required" });
      }

      if (password.length < 8) {
        return res
          .status(400)
          .json({ message: "Password must be at least 8 characters long" });
      }

      const result = await dbClient.createUser({ username, email, password });

      res.status(201).json({
        message: "User registered successfully",
        ...result,
      });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // User login
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;

      const result = await dbClient.loginUser({ email, password });

      res.status(200).json({
        message: "Login successful",
        ...result,
      });
    } catch (error: any) {
      res.status(401).json({ message: error.message });
    }
  });

  // Get current user profile
  app.get(
    "/api/auth/me",
    authenticateToken,
    async (req: AuthRequest, res: Response) => {
      try {
        const userId = req.user!.id;

        const user = await dbClient.getUserById(userId);

        res.status(200).json(user);
      } catch (error: any) {
        res.status(400).json({ message: error.message });
      }
    }
  );

  // Change password
  app.post(
    "/api/auth/change-password",
    authenticateToken,
    async (req: AuthRequest, res: Response) => {
      try {
        const userId = req.user!.id;
        const { oldPassword, newPassword } = req.body;
        if (newPassword.length < 8) {
          return res
            .status(400)
            .json({ message: "Password must be at least 8 characters long" });
        }
        const success = await dbClient.changePassword(
          userId,
          oldPassword,
          newPassword
        );
        if (!success) {
          return res.status(401).json({ message: "Invalid old password" });
        }
        res.status(200).json({ message: "Password changed successfully" });
      } catch (error: any) {
        res.status(400).json({ message: error.message });
      }
    }
  );

  // Update user profile
  app.put(
    "/api/auth/me",
    authenticateToken,
    async (req: AuthRequest, res: Response) => {
      try {
        const userId = req.user!.id;
        const updates = req.body;

        const success = await dbClient.updateUser(userId, updates);

        res.status(200).json({
          message: "User updated successfully",
          success,
        });
      } catch (error: any) {
        res.status(400).json({ message: error.message });
      }
    }
  );

  // Get user by ID
  app.get(
    "/api/users/:userId",
    optionalAuthenticateToken,
    async (req: AuthRequest, res: Response) => {
      try {
        const { userId } = req.params;

        const user = await dbClient.getUserById(userId);

        res.status(200).json({
          id: user._id,
          username: user.username,
          email: user.email,
          createdAt: user.createdAt,
        });
      } catch (error: any) {
        res.status(400).json({ message: error.message });
      }
    }
  );

  // Get user's pastes
  app.get(
    "/api/users/:userId/pastes",
    optionalAuthenticateToken,
    async (req: AuthRequest, res: Response) => {
      try {
        const { userId } = req.params;
        const page = req.query.page ? parseInt(req.query.page as string) : 1;
        const limit = req.query.limit
          ? parseInt(req.query.limit as string)
          : 20;
        const visibility = req.query.visibility as
          | "public"
          | "private"
          | "unlisted"
          | undefined;

        // Check permissions - only the user can see their private pastes
        let visibilityFilter = visibility;
        if (
          !req.user ||
          (req.user.id.toString() !== userId.toString() &&
            req.user.role !== "admin")
        ) {
          // Non-owner or non-admin can only see public pastes
          visibilityFilter = "public";
        }

        const result = await dbClient.getUserPastes(userId, {
          page,
          limit,
          visibility: visibilityFilter,
        });

        res.status(200).json(result);
      } catch (error: any) {
        res.status(400).json({ message: error.message });
      }
    }
  );

  // ----- Error Handling -----

  // 404 handler
  app.use((req: Request, res: Response) => {
    res.status(404).json({ message: "Route not found" });
  });

  // Global error handler
  app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    console.error(err.stack);
    res.status(500).json({
      message: "An unexpected error occurred",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  });

  return app;
}

// Initialize the Express application
export const app = createApp(dbClient);

// Start server function
export async function startServer() {
  try {
    // Connect to MongoDB
    await dbClient.connect();

    // Schedule cleanup task
    cron.schedule("0 0 * * *", async () => {
      try {
        const deletedCount = await dbClient.cleanupExpiredPastes();
        console.log(`Cleaned up ${deletedCount} expired pastes`);
      } catch (error) {
        console.error("Error in cleanup task:", error);
      }
    });

    // Start Express server
    const PORT = process.env.PORT || 3000;
    const server = app.listen(PORT, () => {
      console.log(`Server started at port ${PORT} ✅`);
    });

    return server;
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on("SIGINT", async () => {
  try {
    await dbClient.close();
    console.log("Server gracefully shutdown");
    process.exit(0);
  } catch (error) {
    console.error("Error during shutdown:", error);
    process.exit(1);
  }
});
