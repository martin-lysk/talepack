import * as pako from "pako";
import type { BlockDeflationInfo } from "./BlockDeflationInfo.js";

/**
 * A class that extends the pako.Deflate class to handle deflation in chunks.
 *
 * Sends a full flush after each chunk is pushed and stores the offset and lenght of each chunk within the deflated data.
 *
 * This allows for random access to the deflated data.
 */
export class ChunkBlockDeflate extends pako.Deflate {
	bytesCurrentBlock: number = 0;
	deflationInfo: BlockDeflationInfo = {
		header: new Uint8Array(2),
		blockSize: -1,
		blocks: [],
		hash: "not-set",
	};

	currentOffset = 0;

	chunks: Uint8Array[] = [];

	constructor(options?: pako.DeflateOptions) {
		super(options);
		// @ts-expect-error -- chunks is just not part of the ts type
		super.chunks = this.chunks;
	}

	/**
	 * @param data the data to push, which will be deflated
	 * @param contentHash the hash of the content
	 * @param last indicates if this is the last chunk to push
	 * @returns true if the data was pushed successfully
	 */
	pushChunk(
		data: Uint8Array,
		contentHash: string,
		last?: pako.FlushValues | boolean
	): boolean {
		this.deflationInfo.blocks.push({
			hash: contentHash,
			start: this.deflationInfo.blocks.length === 0 ? 2 : this.currentOffset,
			end: -1,
		});
		return super.push(
			data,
			last ? last : (pako.constants.Z_FULL_FLUSH as pako.FlushValues)
		);
	}

	/**
	 * Handles the deflated data chunk.
	 *
	 * @param {Uint8Array} chunk - The deflated data chunk.
	 */
	override onData(chunk: Uint8Array): void {
		this.chunks.push(chunk);
		if (this.chunks.length === 1) {
			// get the header from the first block
			this.deflationInfo.header = this.chunks[0]!.subarray(0, 2);
		}
		let deflatedEndOffset = 0;
		for (let i = 0, l = this.chunks.length; i < l; i++) {
			deflatedEndOffset += this.chunks[i]!.length;
		}

		this.deflationInfo.blocks[this.deflationInfo.blocks.length - 1]!.end =
			deflatedEndOffset;
		this.currentOffset = deflatedEndOffset;
	}

	/**
	 * Handles the end of the deflation process.
	 *
	 * @param {number} status - The status code of the deflation process.
	 */
	override onEnd(status: number): void {
		super.onEnd(status);

		this.bytesCurrentBlock = 0;
	}
}
