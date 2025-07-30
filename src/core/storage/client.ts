import {
  StorageClient,
  StorageConfig,
  UploadResult,
  RetrieveResult,
  UploadOptions,
  UploadFile,
  UploadFileFromUrl,
  UrlUploadConfig,
  RetrieveOptions,
} from './types.js';
import * as Storage from '@storacha/client';
import { StoreMemory } from '@storacha/client/stores/memory';
import { DirectoryEntryLink } from '@ipld/unixfs/directory';
import {
  defaultHeaders,
  accessServiceConnection,
  uploadServiceConnection,
  filecoinServiceConnection,
  gatewayServiceConnection,
} from '@storacha/client/service';
import { DEFAULT_GATEWAY_URL } from './config.js';
import { Principal } from '@ucanto/interface';
import { DID } from '@ucanto/core';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseIpfsPath, streamToBase64, base64ToBytes } from './utils.js';
import { CID, UnknownLink } from 'multiformats';
import { CarReader } from '@ipld/car';
import { exporter } from 'ipfs-unixfs-exporter';
import { Readable } from 'node:stream';

/**
 * The Storage Service Identifier which will verify the delegation.
 */
const STORAGE_SERVICE_DID = 'did:web:web3.storage';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '../../..');
const packageJson = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf-8'));

/**
 * Add the major version of the MCP server to the headers of the Storacha client.
 * It needs to be done only once.
 */
defaultHeaders['X-Client'] += ` MCP/${packageJson.version.split('.')[0]}`;

/**
 * Implementation of the StorageClient interface for Storacha network
 */
export class StorachaClient implements StorageClient {
  private config: StorageConfig;
  private initialized: Promise<void> | null = null;
  private storage: Storage.Client | null = null;
  /** Service ID that will be used to verify the delegation */
  private serviceID: Principal;

  constructor(config: StorageConfig) {
    this.config = {
      ...config,
      gatewayUrl: config.gatewayUrl || new URL(DEFAULT_GATEWAY_URL),
    };
    this.serviceID = DID.parse(STORAGE_SERVICE_DID);
  }

  /**
   * Initialize the storage client and establish connection based on the storage config
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return this.initialized;
    }

    if (!this.config.signer) {
      throw new Error('Private key is required');
    }

    if (!this.config.delegation) {
      throw new Error('Delegation is required');
    }

    this.initialized = (async () => {
      try {
        const store = new StoreMemory();
        this.storage = await Storage.create({
          principal: this.config.signer,
          store,
          serviceConf: {
            access: accessServiceConnection({
              id: this.serviceID,
            }),
            upload: uploadServiceConnection({
              id: this.serviceID,
            }),
            filecoin: filecoinServiceConnection({
              id: this.serviceID,
            }),
            gateway: gatewayServiceConnection(),
          },
        });
        await this.storage.addSpace(this.config.delegation);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        throw new Error(`Failed to initialize storage client: ${message}`, { cause: error });
      }
    })();

    return this.initialized;
  }

  /**
   * Get the storage client
   * @returns The storage client
   */
  getStorage(): Storage.Client | null {
    return this.storage;
  }

  /**
   * Check if the client is connected and ready
   */
  isConnected(): boolean {
    return this.initialized !== null;
  }

  /**
   * Get the storage config
   * @returns The storage config
   */
  getConfig(): StorageConfig {
    return this.config;
  }

  /**
   * Get the configured gateway URL
   * @returns The configured gateway URL
   * @throws Error if gateway URL is not set
   */
  getGatewayUrl(): URL {
    if (!this.config.gatewayUrl) {
      throw new Error('Gateway URL is not set');
    }
    return this.config.gatewayUrl;
  }

  /**
   * Upload files to Storacha network from base64 content
   * The Storage Client needs to be initialized to upload files.
   *
   * @param files - Array of files to upload
   * @param options - Upload options
   * @returns The uploaded files' Content ID and URL
   */
  async uploadFiles(files: UploadFile[], options: UploadOptions = {}): Promise<UploadResult> {
    if (!this.initialized || !this.storage) {
      throw new Error('Client not initialized');
    }

    if (options.signal?.aborted) {
      throw new Error('Upload aborted');
    }

    const fileObjects = files.map(file => {
      const bytes = base64ToBytes(file.content);
      return new File([bytes], file.name);
    });

    return this.performUpload(fileObjects, options);
  }

  /**
   * Upload files to Storacha network from URLs (Phase 1)
   * @param files - Array of files to upload from URLs
   * @param options - Upload options
   * @param urlConfig - URL upload configuration
   */
  async uploadFilesFromUrls(
    files: UploadFileFromUrl[], 
    options: UploadOptions = {},
    urlConfig?: UrlUploadConfig
  ): Promise<UploadResult> {
    if (!this.initialized || !this.storage) {
      throw new Error('Client not initialized');
    }

    if (options.signal?.aborted) {
      throw new Error('Upload aborted');
    }

    // Fetch files from URLs and convert to File objects
    const fileObjects = await Promise.all(
      files.map(async (fileSpec) => {
        const file = await this.fetchFileFromUrl(fileSpec, urlConfig, options.signal);
        return file;
      })
    );

    return this.performUpload(fileObjects, options);
  }

  /**
   * Fetch a file from a URL with validation and streaming (Phase 1)
   */
  private async fetchFileFromUrl(
    fileSpec: UploadFileFromUrl,
    urlConfig?: UrlUploadConfig,
    signal?: AbortSignal
  ): Promise<File> {
    const { url: urlString, name, mimeType } = fileSpec;

    // Parse URL
    let url: URL;
    try {
      url = new URL(urlString);
    } catch (error) {
      throw new Error(`Invalid URL: ${urlString}`);
    }

    // Validate URL scheme
    if (urlConfig?.allowedUrlSchemes && !urlConfig.allowedUrlSchemes.includes(url.protocol.slice(0, -1))) {
      throw new Error(
        `URL scheme '${url.protocol.slice(0, -1)}' is not allowed. Allowed schemes: ${urlConfig.allowedUrlSchemes.join(', ')}`
      );
    }

    // Validate domain
    if (urlConfig && !urlConfig.allowAllUrlDomains) {
      if (!urlConfig.allowedUrlDomains || urlConfig.allowedUrlDomains.length === 0) {
        throw new Error('No domains are allowed for URL uploads');
      }
      
      const hostname = url.hostname.toLowerCase();
      const isAllowed = urlConfig.allowedUrlDomains.some(allowedDomain => 
        hostname === allowedDomain.toLowerCase() || 
        hostname.endsWith(`.${allowedDomain.toLowerCase()}`)
      );
      
      if (!isAllowed) {
        throw new Error(
          `Domain '${hostname}' is not allowed. Allowed domains: ${urlConfig.allowedUrlDomains.join(', ')}`
        );
      }
    }

    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = urlConfig?.urlFetchTimeoutMs 
      ? setTimeout(() => controller.abort(), urlConfig.urlFetchTimeoutMs)
      : null;

    // Combine timeout signal with external signal
    const combinedSignal = signal || controller.signal;
    if (signal) {
      signal.addEventListener('abort', () => controller.abort());
    }

    try {
      // First, make a HEAD request to check content length
      const headResponse = await fetch(url, {
        method: 'HEAD',
        signal: combinedSignal,
      });

      if (!headResponse.ok) {
        throw new Error(`Failed to fetch URL headers: ${headResponse.status} ${headResponse.statusText}`);
      }

      // Check content length
      const contentLength = headResponse.headers.get('content-length');
      if (contentLength && urlConfig?.maxUrlFileSizeBytes) {
        const size = parseInt(contentLength, 10);
        if (size > urlConfig.maxUrlFileSizeBytes) {
          throw new Error(
            `File size (${size} bytes) exceeds maximum allowed size (${urlConfig.maxUrlFileSizeBytes} bytes)`
          );
        }
      }

      // Get the actual file
      const response = await fetch(url, {
        method: 'GET',
        signal: combinedSignal,
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
      }

      // Get content type
      const contentType = mimeType || response.headers.get('content-type') || 'application/octet-stream';

      // Stream the response body
      if (!response.body) {
        throw new Error('Response body is empty');
      }

      // Convert stream to ArrayBuffer with size checking
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let totalSize = 0;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          totalSize += value.length;
          
          // Check size limit during download
          if (urlConfig?.maxUrlFileSizeBytes && totalSize > urlConfig.maxUrlFileSizeBytes) {
            throw new Error(
              `File size (${totalSize} bytes) exceeds maximum allowed size (${urlConfig.maxUrlFileSizeBytes} bytes)`
            );
          }

          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }

      // Combine all chunks
      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const combined = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }

      // Create File object
      return new File([combined], name, { type: contentType });

    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('URL fetch timeout or aborted');
      }
      throw error;
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  /**
   * Common upload logic for both base64 and URL uploads
   */
  private async performUpload(fileObjects: File[], options: UploadOptions): Promise<UploadResult> {
    const uploadedFiles: Map<string, UnknownLink> = new Map();

    const root = await this.storage!.uploadDirectory(fileObjects, {
      // Only set pieceHasher as undefined if we don't want to publish to Filecoin
      ...(options.publishToFilecoin === true ? {} : { pieceHasher: undefined }),
      retries: options.retries ?? 3,
      signal: options.signal,
      onDirectoryEntryLink: (entry: DirectoryEntryLink) => {
        if (entry.name && entry.name !== '') {
          uploadedFiles.set(entry.name, entry.cid);
        }
      },
    });

    return {
      root: root,
      url: new URL(`/ipfs/${root.toString()}`, this.getGatewayUrl()),
      files: uploadedFiles,
    };
  }

  /**
   * Retrieve a file from the gateway
   * @param filepath - Path string in the format "cid/filename", "/ipfs/cid/filename", or "ipfs://cid/filename"
   * @param options - Retrieve options
   * @returns The file data and metadata
   * @throws Error if the response is not successful
   */
  async retrieve(filepath: string, options?: RetrieveOptions): Promise<RetrieveResult> {
    // Parse the filepath into a Resource object
    const resource = parseIpfsPath(filepath);

    // Construct the URL from the Resource object components
    const pathWithCid = `${resource.cid.toString()}${resource.pathname}`;
    const response = await fetch(new URL(`/ipfs/${pathWithCid}?format=car`, this.getGatewayUrl()));

    if (!response.ok) {
      throw new Error(`Error fetching file: ${response.status} ${response.statusText}`);
    }

    // Read the CAR file and extract the content
    const bytes = new Uint8Array(await response.arrayBuffer());
    const reader = await CarReader.fromBytes(bytes);
    const entry = await exporter(pathWithCid, {
      async get(cid: CID) {
        const block = await reader.get(cid);
        if (!block) throw new Error(`not found: ${cid}`);
        return block.bytes;
      },
    });

    // Convert the content to a base64 string based on the options
    const useMultiformatBase64 = options?.useMultiformatBase64 ?? false;
    const base64Data = await streamToBase64(Readable.from(entry.content()), useMultiformatBase64);
    const contentType = response.headers.get('content-type');

    return {
      data: base64Data,
      type: contentType || undefined,
    };
  }
}