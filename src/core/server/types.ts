import { z } from 'zod';

/**
 * Configuration for the MCP server
 */
export interface McpServerConfig {
  /** Connection timeout in milliseconds */
  connectionTimeoutMs: number;
  /** Transport mode */
  transportMode: 'stdio' | 'sse' | 'rest';
  /** Port number */
  port: number;
  /** Host name */
  host: string;
  /** Maximum file size in bytes */
  maxFileSizeBytes: number;
  /** REST endpoint */
  endpoint?: string;
  
  // URL Upload Configuration (Phase 1)
  /** Maximum file size in bytes for URL uploads */
  maxUrlFileSizeBytes: number;
  /** Allowed URL schemes (e.g., ['https', 'http']) */
  allowedUrlSchemes: string[];
  /** Timeout for URL fetching in milliseconds */
  urlFetchTimeoutMs: number;
  /** Whether to allow URLs from any domain */
  allowAllUrlDomains: boolean;
  /** List of allowed domains (only used if allowAllUrlDomains is false) */
  allowedUrlDomains?: string[];
}

/**
 * Configuration for URL-based uploads
 */
export interface UrlUploadConfig {
  /** Maximum file size in bytes for URL uploads */
  maxUrlFileSizeBytes: number;
  /** Allowed URL schemes (e.g., ['https', 'http']) */
  allowedUrlSchemes: string[];
  /** Timeout for URL fetching in milliseconds */  
  urlFetchTimeoutMs: number;
  /** Whether to allow URLs from any domain */
  allowAllUrlDomains: boolean;
  /** List of allowed domains (only used if allowAllUrlDomains is false) */
  allowedUrlDomains?: string[];
}

/**
 * MCP tool definition
 */
export interface McpTool {
  /** Name of the tool */
  name: string;
  /** Description of the tool */
  description: string;
  /** Input schema for the tool */
  inputSchema: z.ZodObject<any, any, any, any>;
  /** Handler function for the tool */
  // @eslint-disable-next-line @typescript-eslint/no-unused-vars
  handler: (input: z.AnyZodObject) => Promise<{
    content: { type: string; text: string; error?: boolean }[];
  }>;
}