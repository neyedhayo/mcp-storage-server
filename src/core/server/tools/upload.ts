import { z } from 'zod';
import { StorachaClient } from '../../storage/client.js';
import { parseDelegation, base64ToBytes } from '../../storage/utils.js';
import { StorageConfig, UploadResult, UploadFileFromUrl, UrlUploadConfig } from 'src/core/storage/types.js';
import { McpServerConfig } from '../types.js';
import * as dagJSON from '@ipld/dag-json';

const uploadInputSchema = z.object({
  // Either file or url must be provided (but not both)
  file: z
    .string()
    .min(1, 'File content cannot be empty')
    .refine(
      str => {
        try {
          base64ToBytes(str);
          return true;
        } catch (error) {
          return false;
        }
      },
      {
        message: 'Invalid base64 format',
      }
    )
    .describe('The content of the file encoded as a base64 string')
    .optional(),
  
  url: z
    .string()
    .url('Invalid URL format')
    .describe('URL to fetch the file from (alternative to providing file content)')
    .optional(),
  
  name: z
    .string()
    .describe('Name for the uploaded file (must include file extension for MIME type detection)'),
  
  delegation: z
    .string()
    .optional()
    .describe(
      'Delegation proof (optional, will use the default server delegation if not provided)'
    ),
  
  gatewayUrl: z
    .string()
    .optional()
    .describe('Custom gateway URL (optional, will use the default gateway if not provided)'),
  
  publishToFilecoin: z
    .boolean()
    .optional()
    .describe(
      'Whether to publish the file to the Filecoin Network. When true, the file will be published to the Filecoin network, making it publicly accessible. When false (default), the file will only be available within the Storacha network.'
    ),
  
  mimeType: z
    .string()
    .optional()
    .describe('Optional MIME type override (only used with URL uploads)')
}).refine(
  (data) => {
    // Exactly one of file or url must be provided
    const hasFile = !!data.file;
    const hasUrl = !!data.url;
    return hasFile !== hasUrl; // XOR: one must be true, the other false
  },
  {
    message: 'Either file content or URL must be provided, but not both',
    path: ['file'], // Associate error with file field
  }
);

export const uploadTool = (storageConfig: StorageConfig, serverConfig?: McpServerConfig) => ({
  name: 'upload',
  description:
    'Upload a file to the Storacha Network. The file can be provided as a base64 encoded string or fetched from a URL. The file name should include the extension (e.g., "document.pdf") to enable automatic MIME type detection.',
  inputSchema: uploadInputSchema,
  handler: async (input: z.infer<typeof uploadInputSchema>) => {
    try {
      // Validate that we have a delegation from either the request or config
      if (!input.delegation && !storageConfig.delegation) {
        throw new Error(
          'Delegation is required. Please provide it either in the request or via the DELEGATION environment variable.'
        );
      }

      const client = new StorachaClient({
        signer: storageConfig.signer,
        delegation: input.delegation
          ? await parseDelegation(input.delegation)
          : storageConfig.delegation,
        gatewayUrl: input.gatewayUrl ? new URL(input.gatewayUrl) : storageConfig.gatewayUrl,
      });
      await client.initialize();

      let result: UploadResult;

      if (input.file) {
        // Upload from base64 content
        result = await client.uploadFiles(
          [
            {
              name: input.name,
              content: input.file,
            },
          ],
          {
            retries: 3,
            publishToFilecoin: input.publishToFilecoin ?? false,
          }
        );
      } else if (input.url) {
        // Upload from URL
        const urlUploadFile: UploadFileFromUrl = {
          name: input.name,
          url: input.url,
          mimeType: input.mimeType,
        };

        // Create URL config from server config if available
        let urlConfig: UrlUploadConfig | undefined;
        if (serverConfig) {
          urlConfig = {
            maxUrlFileSizeBytes: serverConfig.maxUrlFileSizeBytes,
            allowedUrlSchemes: serverConfig.allowedUrlSchemes,
            urlFetchTimeoutMs: serverConfig.urlFetchTimeoutMs,
            allowAllUrlDomains: serverConfig.allowAllUrlDomains,
            allowedUrlDomains: serverConfig.allowedUrlDomains,
          };
        }

        result = await client.uploadFilesFromUrls(
          [urlUploadFile],
          {
            retries: 3,
            publishToFilecoin: input.publishToFilecoin ?? false,
          },
          urlConfig
        );
      } else {
        // This should never happen due to schema validation, but TypeScript needs it
        throw new Error('Either file content or URL must be provided');
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: dagJSON.stringify({
              root: result.root,
              url: result.url.toString(), // DAG JSON doesn't support URLs, so we convert to string
              files: result.files,
            }),
          },
        ],
      };
    } catch (error) {
      console.error('Failed to upload resource:', error);

      // If it's a Zod validation error, extract the message
      if (error instanceof z.ZodError) {
        const firstError = error.errors[0];
        return {
          content: [
            {
              error: true,
              type: 'text' as const,
              text: JSON.stringify({
                name: 'Error',
                message: firstError.message,
                cause: null,
              }),
            },
          ],
        };
      }

      return {
        content: [
          {
            error: true,
            type: 'text' as const,
            text: JSON.stringify({
              name: error instanceof Error ? error.name : 'Error',
              message: error instanceof Error ? error.message : 'Unknown error',
              cause: error instanceof Error && error.cause ? (error.cause as Error).message : null,
            }),
          },
        ],
      };
    }
  },
});