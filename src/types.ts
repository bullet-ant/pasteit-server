import { ObjectId } from "mongodb";

export interface User {
  _id?: ObjectId | string;
  username: string;
  email: string;
  password: string;
  createdAt: Date;
  lastLogin: Date | null;
  role: "user" | "admin";
  isActive: boolean;
  preferences: {
    defaultSyntax: string;
    defaultExpiration: string;
    defaultVisibility: string;
  };
}

export interface Paste {
  _id?: ObjectId;
  shortId: string;
  title: string | null;
  content: string;
  syntax: string;
  visibility: "public" | "private" | "unlisted";
  createdAt: Date;
  updatedAt?: Date;
  expiresAt: Date | null;
  userId: ObjectId | null;
  views: number;
  password: string | null;
  isDeleted: boolean;
  tags: string[];
  isProtected?: boolean;
}

export interface PasteOptions {
  title?: string | null;
  content: string;
  syntax?: string;
  visibility?: "public" | "private" | "unlisted";
  expiresAt?: Date | null;
  userId?: string | ObjectId | null;
  password?: string | null;
  tags?: string[];
}

export interface GetPasteOptions {
  incrementViews?: boolean;
  password?: string | null;
}

export interface SearchOptions {
  query?: string;
  page?: number;
  limit?: number;
  syntax?: string | null;
  tags?: string[];
}

export interface PaginationOptions {
  page?: number;
  limit?: number;
  visibility?: "public" | "private" | "unlisted" | null;
  syntax?: string | null;
}

export interface UserCredentials {
  username?: string;
  email: string;
  password: string;
}

export interface PaginationResult<T> {
  pastes: T[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    pages: number;
  };
}

export interface LoginResult {
  user: Omit<User, "password">;
  token: string;
}

export interface RegisterResult {
  user: Omit<User, "password">;
  token: string;
}
