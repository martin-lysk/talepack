import { openSync, readSync, closeSync, fstatSync } from "fs";
import { ChunkBlockDeflate, SeekInflate } from "@talepack/zlib-random-access";
import { join } from "path";

export interface RedeflateBlobOptions {
	/**
	 * The path to the .git directory
	 */
	gitPath: string;
	/**
	 * The blob hash (full 40-character hash)
	 */
	blobUid: string;
	/**
	 * The block size for chunking (default: 4096)
	 */
	blockSize?: number;
	/**
	 * The compression level (default: 6)
	 */
	compressionLevel?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
}

/**
 * Reads a git blob object, extracts the header, and re-deflates it in blocks
 * with the header as a separate small chunk followed by fixed-size data chunks.
 *
 * This function reads the compressed blob directly from the file without loading
 * the entire inflated content into memory, making it memory-efficient for large blobs.
 *
 * @param options - The options for redeflating the blob
 * @returns The re-deflated compressed data as a Buffer
 */
export function redeflateBlob(options: RedeflateBlobOptions): Buffer {
	const {
		gitPath,
		blobUid,
		blockSize = 4096,
		compressionLevel = 6,
	} = options;

	// Resolve the object path
	const objectPath = join(gitPath, "objects", blobUid.slice(0, 2), blobUid.slice(2));

	// Open the file and get its size
	const fd = openSync(objectPath, "r");
	const stats = fstatSync(fd);
	const fileSize = stats.size;

	try {
		// Create a reader function for SeekInflate
		const reader = (buffer: Uint8Array, start: number, end: number) => {
			const bytesToRead = Math.min(end - start, fileSize - start);
			const bytesRead = readSync(fd, buffer, 0, bytesToRead, start);
			return bytesRead;
		};

		// Create SeekInflate instance
		const seekInflate = new SeekInflate({
			inputChunkSize: 200,
			reader,
		});

		// Read the header (first 100 bytes should be enough for git header like "blob 106496\0")
		// Probe the file size to ensure we don't read more than available
		const headerBufferSize = Math.min(100, fileSize);
		const headerBuffer = Buffer.alloc(headerBufferSize);
		const headerBytesRead = seekInflate.inflateRange(headerBuffer, 0, headerBufferSize);
		const headerStr = headerBuffer.subarray(0, headerBytesRead).toString("utf-8");

		// Extract header up to and including the null byte
		const headerEnd = headerStr.indexOf("\0") + 1;
		if (headerEnd === 0) {
			throw new Error("Invalid git blob header: null terminator not found");
		}
		const headerBytes = headerBuffer.subarray(0, headerEnd);

		// Parse the size from the header ("blob <size>\0")
		const sizeMatch = headerStr.match(/^blob (\d+)\0/);
		if (!sizeMatch || !sizeMatch[1]) {
			throw new Error("Invalid git blob header format");
		}
		const contentSize = parseInt(sizeMatch[1], 10);

		// Create ChunkBlockDeflate and push the header
		const chunkDeflate = new ChunkBlockDeflate({ level: compressionLevel });
		chunkDeflate.pushChunk(headerBytes, "header");

		// Use the remaining bytes from the initial header read as the start of the first data chunk
		const remainingFromHeader = headerBuffer.subarray(headerEnd, headerBytesRead);

		// Create the first chunk: start with remaining bytes, then inflate more to reach blockSize
		const firstChunk = Buffer.alloc(blockSize);
		let firstChunkSize = remainingFromHeader.length;
		remainingFromHeader.copy(firstChunk);

		// If we don't have a full block, inflate more bytes
		// Pass the amount of data we've consumed so far (remainingFromHeader.length)
		if (firstChunkSize < blockSize && firstChunkSize < contentSize) {
			const bytesNeeded = Math.min(blockSize - firstChunkSize, contentSize - firstChunkSize);
			const additionalBuffer = Buffer.alloc(bytesNeeded);
			const additionalBytes = seekInflate.inflateRange(
				additionalBuffer,
				firstChunkSize,  // Position in the inflated stream (after the remaining data)
				bytesNeeded
			);
			additionalBuffer.copy(firstChunk, firstChunkSize);
			firstChunkSize += additionalBytes;
		}

		// Push the first chunk (check if it's the last chunk)
		const isFirstChunkLast = firstChunkSize >= contentSize;
		if (firstChunkSize > 0) {
			chunkDeflate.pushChunk(
				firstChunk.subarray(0, firstChunkSize),
				"chunk-0",
				isFirstChunkLast
			);
		}

		// If first chunk was the last one, we're done
		if (isFirstChunkLast) {
			return Buffer.concat(chunkDeflate.chunks);
		}

		// Loop through the remaining blocks
		let totalDataRead = firstChunkSize;
		let chunkIndex = 1;

		while (totalDataRead < contentSize) {
			const chunkBuffer = Buffer.alloc(blockSize);
			const bytesToRead = Math.min(blockSize, contentSize - totalDataRead);

			// Read the next chunk - pass the position we've consumed so far
			const bytesRead = seekInflate.inflateRange(
				chunkBuffer,
				totalDataRead,
				bytesToRead
			);

			if (bytesRead === 0) break;

			const dataChunk = chunkBuffer.subarray(0, bytesRead);
			const isLastChunk = totalDataRead + bytesRead >= contentSize;

			// Push chunk with last=true if this is the final chunk
			chunkDeflate.pushChunk(dataChunk, `chunk-${chunkIndex}`, isLastChunk);

			totalDataRead += bytesRead;
			chunkIndex++;

			// If this was the last chunk, break
			if (isLastChunk) break;
		}

		// Concatenate all chunks
		const redeflatedCompressed = Buffer.concat(chunkDeflate.chunks);

		return redeflatedCompressed;
	} finally {
		closeSync(fd);
	}
}
