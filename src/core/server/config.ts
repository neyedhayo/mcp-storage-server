import 'dotenv/config';
import { McpServerConfig } from './types.js';
// Required for REST transport mode in MCP.so Cloud
import { getParamValue } from '@chatmcp/sdk/utils/index.js';

export const loadConfig = (): McpServerConfig => {
  const port = parseInt(getParamValue('port') || process.env.MCP_SERVER_PORT || '3001', 10);
  const host = process.env.MCP_SERVER_HOST?.trim() || '0.0.0.0';
  const connectionTimeoutMs = parseInt(process.env.MCP_CONNECTION_TIMEOUT || '30000', 10);
  const transportMode =
    getParamValue('transportMode') || process.env.MCP_TRANSPORT_MODE?.trim() || 'stdio';
  const maxFileSizeBytes = parseInt(process.env.MAX_FILE_SIZE || '104857600', 10);
  const endpoint = getParamValue('endpoint') || process.env.MCP_ENDPOINT?.trim() || '/rest';

  // URL Upload Configuration (Phase 1)
  const maxUrlFileSizeBytes = parseInt(process.env.MAX_URL_FILE_SIZE || '1073741824', 10); // Default: 1GB
  const allowedUrlSchemes = (process.env.ALLOWED_URL_SCHEMES || 'https,http')
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0);
  const urlFetchTimeoutMs = parseInt(process.env.URL_FETCH_TIMEOUT || '300000', 10); // Default: 5 minutes
  const allowAllUrlDomains = process.env.ALLOW_ALL_URL_DOMAINS?.toLowerCase() === 'true';
  const allowedUrlDomains = process.env.ALLOWED_URL_DOMAINS
    ? process.env.ALLOWED_URL_DOMAINS.split(',').map(d => d.trim()).filter(d => d.length > 0)
    : undefined;

  // Existing validation
  if (isNaN(port) || port < 0 || port > 65535) {
    throw new Error('Invalid port number');
  }

  if (isNaN(connectionTimeoutMs) || connectionTimeoutMs < 0) {
    throw new Error('Invalid connection timeout');
  }

  if (transportMode !== 'stdio' && transportMode !== 'sse' && transportMode !== 'rest') {
    throw new Error('Invalid transport mode');
  }

  if (isNaN(maxFileSizeBytes) || maxFileSizeBytes < 0) {
    throw new Error('Invalid max file size');
  }

  // URL configuration validation
  if (isNaN(maxUrlFileSizeBytes) || maxUrlFileSizeBytes < 0) {
    throw new Error('Invalid max URL file size');
  }

  if (isNaN(urlFetchTimeoutMs) || urlFetchTimeoutMs < 0) {
    throw new Error('Invalid URL fetch timeout');
  }

  if (allowedUrlSchemes.length === 0) {
    throw new Error('At least one URL scheme must be allowed');
  }

  // Validate URL schemes
  const validSchemes = ['http', 'https', 'ftp', 'ftps'];
  for (const scheme of allowedUrlSchemes) {
    if (!validSchemes.includes(scheme)) {
      throw new Error(`Invalid URL scheme: ${scheme}. Allowed schemes: ${validSchemes.join(', ')}`);
    }
  }

  return {
    port,
    host,
    connectionTimeoutMs,
    transportMode: transportMode as 'stdio' | 'sse' | 'rest',
    maxFileSizeBytes,
    endpoint: endpoint || '/',
    // URL Upload Configuration
    maxUrlFileSizeBytes,
    allowedUrlSchemes,
    urlFetchTimeoutMs,
    allowAllUrlDomains,
    allowedUrlDomains,
  };
};