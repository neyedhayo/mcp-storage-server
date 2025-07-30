import { Capabilities, Delegation } from '@ucanto/interface';
import { Signer } from '@ucanto/principal/ed25519';
import { CID, UnknownLink } from 'multiformats';

/**
 * Configuration options for the storage client
 */
export interface StorageConfig {
  /** Private key for storacha-client authentication */
  signer: Signer.EdSigner;
  /** Delegation for storage access */
  delegation: Delegation<Capabilities>;
  /** Optional gateway URL for file retrieval */
  gatewayUrl?: URL;
}

/**
 * Configuration for URL-based uploads
 */
export interface UrlUploadConfig {
  /** maximum file size in bytes for URL uploads */
  maxUrlFileSizeBytes: number;
  /** allowed url schemes (e.g., ['https', 'http']) */
  allowedUrlSchemes: string[];
  /** timeout for url fetching in milliseconds */
  urlFetchTimeoutMs: number;
  /** whether to allow urls from any domain */
  allowAllUrlDomains: boolean;
  /** list of allowed domains (only used if allowedAllurlDomoains is false) */
  allowedUrlDomains?: string[];
}

/**
 * Represents a structured IPFS resource with protocol, CID, and pathname
 */
export interface Resource {
  /** Protocol identifier, currently only 'ipfs:' is supported */
  protocol: 'ipfs:'; // Could potentially support IPNS in the future
  /** Content Identifier of the resource */
  cid: CID;
  /** Path to the resource, including leading slash and any subfolders/query params */
  pathname: string;
}

/**
 * Parsing error for IPFS paths
 */
export class IpfsPathError extends Error {
  constructor(
    message: string,
    public readonly path: string
  ) {
    super(message);
    this.name = 'IpfsPathError';
  }
}

/**
 * File to upload (base64 content)
 */
export interface UploadFile {
  /** Name of the file */
  name: string;
  /** Content of the file (base64 encoded) */
  content: string;
}

/**
 * File to upload from URL
 */
export interface UploadFileFromUrl {
  /** Name of the file */
  name: string;
  /** url to fetch the file from */
  url: string;
  /** optional MIME type override */
  mimeTyp?: string;
}

/**
 * Upload options for storage operations
 */
export interface UploadOptions {
  /** Signal to abort the upload */
  signal?: AbortSignal;
  /** Number of retries for failed uploads */
  retries?: number;
  /** Whether to publish the file to the Filecoin Network (default: false) */
  publishToFilecoin?: boolean;
}

/**
 * Result of a file upload operation
 */
export interface UploadResult {
  /** Root CID of the directory containing the uploaded file */
  root: UnknownLink;
  /** HTTP gateway URL for accessing the file */
  url: URL;
  /** Map of files uploaded in the directory */
  files: Map<string, UnknownLink>;
}

/**
 * Result of a file retrieval operation
 */
export interface RetrieveResult {
  /** Base64 encoded file data */
  data: string;
  /** MIME type of the file */
  type?: string;
}

/**
 * Options for retrieving files
 */
export interface RetrieveOptions {
  /** Whether to use multiformat base64 encoding instead of standard base64 */
  useMultiformatBase64?: boolean;
}

/**
 * Interface for storage operations
 */
export interface StorageClient {
  /** Initialize the storage client */
  initialize(): Promise<void>;

  /** Check if the client is connected and ready */
  isConnected(): boolean;

  /**
   * Upload files to storage
   * @param files - Array of files to upload
   * @param options - Upload options
   */
  uploadFiles(files: UploadFile[], options?: UploadOptions): Promise<UploadResult>;

  /**
   * upload files to storage
   * @param files - Array of files to upload from URLs
   * @param options - Upload options
   * @param urlConfig - URL upload configuration
   */
  uploadFiles(files: UploadFileFromUrl[], options?: UploadOptions, urlConfig?: UrlUploadConfig): Promise<UploadResult>;

  /**
   * Retrieve a file from storage
   * @param filepath - Path string in the format "cid/filename", "/ipfs/cid/filename", or "ipfs://cid/filename"
   * @param options - Retrieve options
   */
  retrieve(filepath: string, options?: RetrieveOptions): Promise<RetrieveResult>;
}
